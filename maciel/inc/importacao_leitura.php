<?php
require_once __DIR__ . '/leitura_pacote.php';
// Importação automática de obra nova — fase 2: leitura completa (serviço Python) e publicação do pacote na obra.
// O serviço devolve um "pacote" JSON (modelo do IFC, BM, cronograma, fixadores, pranchas). Aqui ele é guardado, revisado e publicado.

function importacao_pacote_caminho($obraId)
{
    return importacao_diretorio($obraId) . '/pacote.json';
}

function importacao_pacote($obraId)
{
    $c = importacao_pacote_caminho($obraId);
    if (!is_file($c)) {
        return null;
    }
    $p = json_decode((string)file_get_contents($c), true);
    return is_array($p) ? $p : null;
}

// Pede ao serviço de leitura a leitura completa de todos os documentos da obra (responde 202; o pacote chega pelo callback assinado).
function importacao_despachar_leitura($obraId)
{
    if (!importacao_servico_ativo()) {
        return ['ok' => false, 'erro' => 'Serviço de leitura não configurado.'];
    }
    $obra = q_global('SELECT nome FROM obras WHERE id = ?', [(int)$obraId])->fetch();
    $docs = [];
    $exp = time() + 3 * 3600;
    $base = importacao_url_base();
    foreach (importacao_documentos($obraId) as $d) {
        if ($d['status'] !== 'valido') {
            continue;
        }
        $docs[] = [
            'documento_id' => $d['id'], 'tipo' => $d['tipo'], 'nome' => $d['nome_original'], 'tamanho' => $d['tamanho'], 'sha256' => $d['sha256'],
            'url_download' => $base . '/obra_importar.php?acao=baixar&doc=' . $d['id'] . '&exp=' . $exp . '&sig=' . importacao_assinar('baixar|' . $d['id'] . '|' . $exp),
        ];
    }
    $corpo = json_encode(['obra_id' => (int)$obraId, 'nome_obra' => (string)($obra['nome'] ?? ''), 'documentos' => $docs,
        'callback' => $base . '/obra_importar.php?acao=callback_pacote'], JSON_UNESCAPED_UNICODE);
    $ch = curl_init(importacao_servico_url() . '/jobs/processar');
    curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => $corpo, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 15, CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'X-Assinatura: ' . importacao_assinar($corpo)]]);
    curl_exec($ch);
    $cod = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    if ($cod < 200 || $cod >= 300) {
        q_global("UPDATE obras SET importacao = 'erro_leitura' WHERE id = ?", [(int)$obraId]);
        file_put_contents(importacao_diretorio($obraId) . '/erro_leitura.txt', 'Serviço de leitura indisponível (' . ($err ?: 'HTTP ' . $cod) . ').');
        return ['ok' => false, 'erro' => $err ?: 'HTTP ' . $cod];
    }
    @unlink(importacao_diretorio($obraId) . '/erro_leitura.txt');
    q_global("UPDATE obras SET importacao = 'lendo' WHERE id = ?", [(int)$obraId]);
    return ['ok' => true];
}

// Callback do serviço (já com a assinatura conferida): guarda o pacote e passa a obra para a revisão.
function importacao_guardar_pacote($obraId, array $j)
{
    $obra = q_global("SELECT id FROM obras WHERE id = ? AND status = 'rascunho'", [(int)$obraId])->fetch();
    if (!$obra) {
        return false;
    }
    if (!empty($j['ok']) && is_array($j['pacote'] ?? null)) {
        $j['pacote']['modelo']['material'] = idf_material($j['pacote']['modelo']);
        $j['pacote']['cruzamentos']['fase_para_item'] = idf_fases_itens($j['pacote']['modelo']['fases'], $j['pacote']['bm']['itens']);
        file_put_contents(importacao_pacote_caminho($obraId), json_encode($j['pacote'], JSON_UNESCAPED_UNICODE));
        @unlink(importacao_diretorio($obraId) . '/erro_leitura.txt');
        q_global("UPDATE obras SET importacao = 'revisao' WHERE id = ?", [(int)$obraId]);
    } else {
        file_put_contents(importacao_diretorio($obraId) . '/erro_leitura.txt', implode("\n", array_map('strval', $j['erros'] ?? ['A leitura não devolveu o pacote.'])));
        q_global("UPDATE obras SET importacao = 'erro_leitura' WHERE id = ?", [(int)$obraId]);
    }
    return true;
}

// ------------------------------------------------------------------ utilitários da publicação

function imp_up($s)
{
    return mb_strtoupper(preg_replace('/\s+/u', ' ', trim((string)$s)), 'UTF-8');
}

function imp_tokens($s)
{
    $s = mb_strtolower((string)$s, 'UTF-8');
    $s = strtr($s, ['á' => 'a', 'à' => 'a', 'â' => 'a', 'ã' => 'a', 'é' => 'e', 'ê' => 'e', 'í' => 'i', 'ó' => 'o', 'ô' => 'o', 'õ' => 'o', 'ú' => 'u', 'ç' => 'c']);
    preg_match_all('/[a-z0-9]+/', $s, $m);
    $paradas = ['de', 'da', 'do', 'das', 'dos', 'e', 'a', 'o', 'em', 'para', 'com', 'no', 'na', 'nas', 'nos', 'ao', 'instalacao', 'montagem', 'estrutura'];
    return array_values(array_unique(array_filter($m[0], function ($w) use ($paradas) { return strlen($w) > 1 && !in_array($w, $paradas, true); })));
}

function imp_similar($a, $b)
{
    $A = imp_tokens($a);
    $B = imp_tokens($b);
    if (!$A || !$B) {
        return 0.0;
    }
    // aceita o plural simples (TERÇA × TERÇAS) pelo radical
    $rad = function ($w) { return rtrim($w, 's'); };
    $A = array_map($rad, $A);
    $B = array_map($rad, $B);
    return count(array_intersect($A, $B)) / count(array_unique(array_merge($A, $B)));
}

function imp_dias_uteis($ini, $fim)
{
    $n = 0;
    $d = new DateTime($ini);
    $f = new DateTime($fim);
    while ($d <= $f) {
        if ((int)$d->format('N') < 6) {
            $n++;
        }
        $d->modify('+1 day');
    }
    return max(1, $n);
}

function imp_coluna($i)
{
    $i += 1;      // 0 -> B (a coluna A fica livre, como nas obras já existentes)
    $s = '';
    $n = $i;
    do {
        $s = chr(65 + $n % 26) . $s;
        $n = intdiv($n, 26) - 1;
    } while ($n >= 0);
    return $s;
}

function imp_agora()
{
    return (new DateTimeImmutable('now', new DateTimeZone('America/Sao_Paulo')))->format('Y-m-d H:i');
}

function imp_prefixo($produto)
{
    $s = strtr(imp_up($produto), ['Á' => 'A', 'À' => 'A', 'Â' => 'A', 'Ã' => 'A', 'É' => 'E', 'Ê' => 'E', 'Í' => 'I', 'Ó' => 'O', 'Ô' => 'O', 'Õ' => 'O', 'Ú' => 'U', 'Ç' => 'C']);
    $s = substr(preg_replace('/[^A-Z]/', '', $s), 0, 3);
    return $s !== '' ? str_pad($s, 3, 'X') : 'MAT';
}

function imp_tipo_material($produto, $fase)
{
    $p = imp_up($produto . ' ' . $fase);
    if (preg_match('/PORCA|ARRUELA|CHUMBADOR|PARAF|BARRA ROSCADA|\bNUT\b|WASHER/', imp_up($produto))) {
        return 'FIXADOR';
    }
    if (strpos($p, 'JOIST') !== false || preg_match('/^(BANZO|DIAGONAL|TRAVAMENTO)/', imp_up($produto))) {
        return 'JOIST';
    }
    if (strpos(imp_up($produto), 'TELHA') !== false) {
        return 'TELHA';
    }
    return 'ESTRUTURAL';
}

function imp_titulo_fase($fase)
{
    return trim(preg_replace('/^\s*\d+(?:\.\d+)+\.?\s+/u', '', (string)$fase)) ?: (string)$fase;
}

// Resumo do pacote para a tela de revisão.
function importacao_resumo_pacote(array $p)
{
    $m = $p['modelo'] ?? [];
    $bm = $p['bm'] ?? [];
    $cr = $p['cronograma'] ?? [];
    $atv = 0;
    foreach ($bm['itens'] ?? [] as $i) {
        $atv += count($i['atividades'] ?? []);
    }
    return [
        'conjuntos' => $m['totais']['conjuntos'] ?? 0, 'peso_t' => round(($m['totais']['peso_kg'] ?? 0) / 1000, 1), 'fases' => count($m['fases'] ?? []),
        'produtos' => count($m['material'] ?? []), 'parafusos' => $m['totais']['parafusos'] ?? 0, 'eixos_v' => count($m['malha']['V'] ?? []), 'eixos_h' => count($m['malha']['H'] ?? []),
        'itens_bm' => count($bm['itens'] ?? []), 'atividades_bm' => $atv, 'contrato' => $bm['contrato_total'] ?? null,
        'tarefas' => count($cr['atividades'] ?? []), 'inicio' => $cr['inicio'] ?? '', 'fim' => $cr['fim'] ?? '',
        'fixadores_lista' => count($p['fixadores']['geral'] ?? []), 'tipos_joist' => count($p['fixadores']['por_joist'] ?? []),
        'pranchas' => count($p['projetos']['pranchas'] ?? []), 'telhas' => $p['cruzamentos']['telhas']['conjuntos'] ?? 0, 'telhas_m2' => $p['cruzamentos']['telhas']['area_m2'] ?? 0,
        'avisos' => $p['avisos'] ?? [],
    ];
}

// ------------------------------------------------------------------ publicação

/**
 * Cria os dados da obra a partir do pacote já revisado: empresa e serviços, previsto do cronograma, catálogo do BM, cadastro de materiais
 * (peças do IFC e fixadores), vínculos peça → atividade, fluxo de baixa, parafusos do projeto e mapa de apontamento.
 * $op: sigla (empresa executora), empresa (nome), mapa_fase (fase do IFC => item do BM, correções feitas na revisão).
 */
function importacao_publicar($obraId, array $op)
{
    $p = importacao_pacote($obraId);
    if (!$p || !empty($p['erros'])) {
        throw new InvalidArgumentException('A obra ainda não tem um pacote de leitura válido.');
    }
    $obra = q_global("SELECT * FROM obras WHERE id = ? AND status = 'rascunho'", [(int)$obraId])->fetch();
    if (!$obra) {
        throw new InvalidArgumentException('Obra não está em rascunho.');
    }
    $sigla = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', (string)($op['sigla'] ?? '')));
    $nomeEmpresa = trim((string)($op['empresa'] ?? '')) ?: $sigla;
    if (strlen($sigla) < 2 || strlen($sigla) > 10) {
        throw new InvalidArgumentException('Informe a sigla da empresa executora (2 a 10 letras ou números).');
    }
    $modelo = $p['modelo'];
    $modelo['material'] = idf_material($modelo);
    $bm = $p['bm'];
    $crono = $p['cronograma'];
    $cruz = $p['cruzamentos'];
    $faseItem = idf_fases_itens($modelo['fases'], $bm['itens']);
    foreach ((array)($op['mapa_fase'] ?? []) as $fase => $item) {
        $item = trim((string)$item);
        if ($item === '') {
            unset($faseItem[$fase]);
        } else {
            $faseItem[$fase] = $item;
        }
    }
    $anterior = obra_atual_id();
    definir_obra_atual((int)$obraId);
    $pdo = bd();
    $resumo = [];
    $pdo->beginTransaction();
    try {
        $agora = imp_agora();
        sistema_gravar('padrao_identidade_ifc', '1');

        // ---- empresa e serviços (tarefas do cronograma)
        q('INSERT INTO empresas (aba, nome, col_obs, ordem) VALUES (?, ?, ?, 0)', [$sigla, $sigla, null]);
        $empresaId = (int)$pdo->lastInsertId();
        $servicos = [];
        $nomesUsados = [];
        foreach ($crono['atividades'] ?? [] as $i => $t) {
            $nome = trim($t['nome']);
            if (isset($nomesUsados[imp_up($nome)])) {
                $nome .= ' (' . ($t['setor'] ?: $t['item'] ?: ($i + 1)) . ')';
            }
            $nomesUsados[imp_up($nome)] = true;
            $servicos[$i] = $nome;
            q('INSERT INTO servicos (empresa_id, col, nome, frente, id_crono, escopo, ordem) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [$empresaId, imp_coluna(count($servicos) - 1), $nome, $t['setor'] ?: null, $t['item'] ?: null, $t['qtd'], count($servicos)]);
        }
        $resumo['servicos'] = count($servicos);

        // ---- previsto do cliente (cronograma)
        foreach ($crono['atividades'] ?? [] as $i => $t) {
            $du = imp_dias_uteis($t['inicio'], $t['fim']);
            $meta = $t['produtividade_dia'] ?: ($t['qtd'] ? round($t['qtd'] / $du, 2) : null);
            q('INSERT INTO cliente (servico, qtd, inicio_plan, meta_dia, du_semana, responsavel, obs, prazo, peso, frente) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [$servicos[$i], $t['qtd'], $t['inicio'], $meta, 5, null, 'Importado do cronograma', $t['fim'], 1, $t['setor'] ?: null]);
        }

        // ---- catálogo do BM
        $atividadesPorItem = [];     // item => [{codigo, descricao, qtd, peso, unidade}]
        $nBm = 0;
        $ligacaoTarefa = [];         // tarefa => atividade (para o campo "controle")
        foreach ($cruz['tarefa_para_atividade'] ?? [] as $l) {
            if (!empty($l['atividade'])) {
                $ligacaoTarefa[$l['item'] . '|' . $l['atividade']] = $l['tarefa'];
            }
        }
        $tarefaServico = [];
        $usadoControle = [];
        foreach ($crono['atividades'] ?? [] as $i => $t) {
            $tarefaServico[$t['nome']] = $servicos[$i];
        }
        foreach ($bm['itens'] as $it) {
            $lista = $it['atividades'] ?: [['descricao' => $it['descricao'], 'qtd' => $it['qtd'], 'unidade' => $it['unidade'], 'peso' => 1.0, 'valor' => $it['valor'] ?? 0]];
            foreach ($lista as $k => $a) {
                $codigo = $sigla . '-' . $it['codigo'] . '-' . sprintf('%02d', $k + 1);
                $tarefa = $ligacaoTarefa[$it['codigo'] . '|' . $a['descricao']] ?? '';
                $controle = $tarefa !== '' ? ($tarefaServico[$tarefa] ?? null) : null;
                if ($controle !== null && isset($usadoControle[$controle])) {
                    $controle = null;
                }
                if ($controle !== null) {
                    $usadoControle[$controle] = true;
                }
                $valor = (float)($it['valor'] ?? 0);
                q('INSERT INTO bm_atividades (codigo, empresa, item, item_desc, atividade, unidade, qtd, peso, valor_qpc, valor_rotula, controle, obs) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    [$codigo, $sigla, $it['codigo'], $it['descricao'], $a['descricao'], $a['unidade'] ?: ($it['unidade'] ?: 'un'), $a['qtd'], $a['peso'], $valor, $valor, $controle, 'Importado do orçamento']);
                $atividadesPorItem[$it['codigo']][] = ['codigo' => $codigo, 'descricao' => $a['descricao'], 'qtd' => (float)$a['qtd'], 'peso' => (float)$a['peso'], 'unidade' => $a['unidade'], 'controle' => $controle];
                $nBm++;
            }
        }
        foreach ($bm['periodos'] ?? [] as $per) {
            q('INSERT INTO bm_periodos (empresa, bm, corte, obs) VALUES (?, ?, ?, ?)', [$sigla, $per['bm'], $per['corte'], 'Importado do boletim de medição']);
        }
        $resumo['atividades_bm'] = $nBm;

        // ---- cadastro: uma linha por TAG original; ocorrências e locais ficam na rastreabilidade.
        $catalogo = idf_catalogo($modelo['material']);
        $tagsConflitantes = array_map('strval', array_keys(array_filter($catalogo, function ($m) { return count($m['especificacoes']) > 1; })));
        $gruposPorChave = [];
        $nMat = 0;
        foreach ($catalogo as $tag => $m) {
            $produtos = implode(' / ', array_keys($m['produtos']));
            $locais = implode(' | ', array_keys($m['locais']));
            if (mb_strlen((string)$tag) > 255 || mb_strlen($produtos) > 255) {
                throw new InvalidArgumentException('TAG ou descrição do IFC excede o limite do cadastro. Revise a fonte; nenhuma TAG foi renomeada.');
            }
            q('INSERT INTO materiais (codigo, material, unidade, tipo_material, local, etapa, servico, empresa, coef, saldo_inicial, data_saldo, minimo, fornecedor, prazo_reposicao, obs) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [(string)$tag, $produtos, 'UN', imp_tipo_material($produtos, $locais), mb_strlen($locais) <= 255 ? $locais : 'Ver locais originais em Vínculos', null, null, null, 0, $m['qtd'], null, null, null, null, 'TAG original do IFC. Quantidade de projeto; recebimentos são registrados em Remessas.']);
            $nMat++;
        }
        foreach ($modelo['material'] as $m) {
            $chave = idf_grupo($m['produto'], $m['fase']);
            if (!isset($gruposPorChave[$chave])) {
                $gruposPorChave[$chave] = ['tags'=>[], 'qtd'=>0, 'fase'=>$m['fase'], 'produto'=>$m['produto'], 'local'=>$m['fase'], 'tagqtd'=>[], 'pecas'=>[]];
            }
            $g = &$gruposPorChave[$chave];
            $g['qtd'] += $m['qtd'];
            if (trim($m['marca']) !== '') {
                $g['tags'][] = $m['marca'];
                $g['tagqtd'][$m['marca']] = ($g['tagqtd'][$m['marca']] ?? 0) + $m['qtd'];
            }
            unset($g);
        }

        // ---- fixadores: a lista em planilha vale; o que só aparece no IFC entra com a quantidade do modelo
        $tagFix = [];            // chave do fixador => tag
        $cadastroFix = [];
        $somaIfc = [];
        foreach ($modelo['fixadores'] as $f) {
            if (!empty($f['chave'])) {
                $somaIfc[$f['chave']] = ($somaIfc[$f['chave']] ?? 0) + $f['qtd'];
            }
        }
        foreach ($p['fixadores']['geral'] as $f) {
            $k = $f['chave'] ?: ('lista|' . imp_up($f['descricao'] . ' ' . $f['norma']));
            $cadastroFix[$k] = ['nome' => trim($f['descricao'] . ' ' . (in_array($f['norma'], ['-', '', 'HARDBOLT'], true) ? '' : $f['norma'])), 'qtd' => ($cadastroFix[$k]['qtd'] ?? 0) + $f['qtd'], 'origem' => 'lista de fixadores'];
        }
        foreach ($somaIfc as $k => $q) {
            if (!isset($cadastroFix[$k])) {
                $nomeIfc = '';
                foreach ($p['fixadores_confronto'] ?? [] as $c) {
                    if ($c['chave'] === $k) {
                        $nomeIfc = $c['nome'];
                    }
                }
                $cadastroFix[$k] = ['nome' => $nomeIfc ?: $k, 'qtd' => $q, 'origem' => 'IFC'];
            }
        }
        $fg = 0;
        ksort($cadastroFix);
        foreach ($cadastroFix as $k => $f) {
            do { $tag = 'FG' . sprintf('%03d', ++$fg); } while (isset($catalogo[$tag]));
            q('INSERT INTO materiais (codigo, material, unidade, tipo_material, local, etapa, servico, empresa, coef, saldo_inicial, data_saldo, minimo, fornecedor, prazo_reposicao, obs) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [$tag, $f['nome'], 'UN', 'FIXADOR', 'Todos os locais', 'FIXADORES', null, null, 0, $f['qtd'], null, null, null, null, 'Importado (' . $f['origem'] . ')']);
            $tagFix[$k] = $tag;
            $nMat++;
        }
        $resumo['materiais'] = $nMat;
        $resumo['fixadores'] = count($cadastroFix);

        // ---- vínculos: atividade única por família dentro do local; ambiguidades ficam pendentes.
        $vinculos = [];
        $pendencias = [];
        foreach ($gruposPorChave as $chave => $g) {
            $item = $faseItem[$g['fase']] ?? '';
            $melhor = idf_atividade($g['produto'], $atividadesPorItem[$item] ?? []);
            // Sem local específico, joists/componentes só casam se existir UM item com a atividade.
            if (!$item && in_array(idf_familia($g['produto']), ['joist','banzo'], true)) {
                $possiveis = [];
                foreach ($atividadesPorItem as $ats) {
                    $a = idf_atividade($g['produto'], $ats);
                    if ($a) $possiveis[] = $a;
                }
                if (count($possiveis) === 1) $melhor = $possiveis[0];
            }
            $ok = $melhor && $melhor['qtd'] > 0 && array_sum($g['tagqtd']) === $g['qtd'];
            $vinculos[$chave] = ['estado'=>$ok ? 'confirmado' : 'pendente', 'atividade'=>$ok ? $melhor['codigo'] : '',
                'familia'=>$g['produto'], 'produto'=>$g['produto'], 'local'=>$g['local'], 'por'=>'Importação: família + local + catálogo', 'em'=>$agora];
            if (!$ok) $pendencias[] = $chave;
        }
        foreach ($modelo['conjuntos'] as $c) {
            if (empty($c['guid'])) continue;
            $chave = idf_grupo($c['produto'], $c['fase']);
            $kit = [];
            foreach ($c['fix'] ?? [] as $f) {
                $k = leitura_chave_fixador($f[1]);
                if ($k && isset($tagFix[$k])) $kit[$tagFix[$k]] = ($kit[$tagFix[$k]] ?? 0) + $f[2];
            }
            $gruposPorChave[$chave]['pecas'][$c['guid']] = ['tag'=>(string)$c['marca'], 'perfil'=>$c['perfil'], 'material'=>$c['material'], 'comprimento_mm'=>$c['comprimento_mm'] ?? 0, 'kit'=>(object)$kit];
        }
        $resumo['pecas_sem_tag'] = count(array_filter($modelo['conjuntos'], function ($c) { return trim((string)($c['marca'] ?? '')) === ''; }));
        $resumo['pecas_sem_posicao'] = count(array_filter($modelo['conjuntos'], function ($c) { return empty($c['pos']); }));
        $resumo['pecas_sem_kit_identificado'] = count(array_filter($modelo['conjuntos'], function ($c) { return !array_key_exists('fix', $c); }));
        $resumo['vinculos'] = count($vinculos) - count($pendencias);
        $resumo['vinculos_pendentes'] = count($pendencias);
        $resumo['servicos_com_baixa'] = count(array_unique(array_filter(array_column($vinculos, 'atividade'))));

        // ---- dados de projeto da obra (substituem os arquivos de inc/ que só valem para a obra 198)
        $locais = [];
        $fases = [];
        foreach ($modelo['material'] as $m) {
            $loc = $m['fase'] !== '' ? $m['fase'] : 'Sem fase';
            $fam = imp_up($m['produto']);
            $locais[$loc][$fam]['qtd'] = ($locais[$loc][$fam]['qtd'] ?? 0) + $m['qtd'];
            $locais[$loc][$fam]['peso_kg'] = round(($locais[$loc][$fam]['peso_kg'] ?? 0) + $m['peso_kg'], 1);
            $fases[$loc][$loc] = ($fases[$loc][$loc] ?? 0) + $m['qtd'];
        }
        sistema_gravar('ifc_anexos', json_encode(['fontes' => array_map(function ($a) { return ['arquivo' => $a['arquivo'], 'conjuntos' => $a['conjuntos'], 'projeto' => 'Importação automática']; }, $modelo['arquivos']),
            'locais' => (object)$locais, 'fases' => (object)$fases], JSON_UNESCAPED_UNICODE));
        sistema_gravar('ifc_parafusos', json_encode(importacao_parafusos($modelo), JSON_UNESCAPED_UNICODE));
        sistema_gravar('ifc_parafusos_locais', json_encode([], JSON_UNESCAPED_UNICODE));
        $regras = ['fonte' => 'Importação automática (IFC + orçamento + cronograma)', 'origem_das_quantidades' => 'IFC enviado na importação', 'observacoes' => ['Regras geradas automaticamente: confira em Suprimentos › Vínculos.'],
            'versao_identidade' => 1, 'vinculos_ifc' => (object)$gruposPorChave, 'pendencias' => $pendencias, 'tags_conflitantes' => $tagsConflitantes,
            'eventos' => [], 'consumo_por_servico' => (object)[], 'inventario_ajustes' => [], 'limites_ifc' => (object)[], 'apontamento' => (object)[]];
        sistema_gravar('regras_baixa', json_encode($regras, JSON_UNESCAPED_UNICODE));
        sistema_gravar('vinculos_material', json_encode((object)$vinculos, JSON_UNESCAPED_UNICODE));
        sistema_gravar('importacao_info', json_encode(['em' => $agora, 'por' => (string)($GLOBALS['usuario']['nome'] ?? ''), 'resumo' => importacao_resumo_pacote($p), 'publicado' => $resumo], JSON_UNESCAPED_UNICODE));
        importacao_gravar_mapa($obraId, $modelo, $faseItem);

        // ---- datas e situação da obra
        $ini = $crono['inicio'] ?? ($obra['data_inicio'] ?: date('Y-m-d'));
        $fim = $crono['fim'] ?? ($obra['data_fim'] ?: date('Y-m-d', strtotime('+1 year')));
        foreach ($bm['periodos'] ?? [] as $per) {
            if ($per['corte'] && $per['corte'] > $fim) {
                $fim = $per['corte'];
            }
        }
        sistema_gravar('data_inicio', $ini);
        sistema_gravar('data_fim', $fim);
        sistema_gravar('versao', (string)((int)sistema_ler('versao', '0') + 1));
        sistema_gravar('modificado', date('c'));
        q_global("UPDATE obras SET status = 'ativa', importacao = 'publicada', data_inicio = ?, data_fim = ? WHERE id = ?", [$ini, $fim, (int)$obraId]);
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        definir_obra_atual($anterior);
        throw $e;
    }
    definir_obra_atual($anterior);
    registrar_global('obra_importacao_publicada', ['obra_id' => (int)$obraId] + $resumo);
    return $resumo;
}

// Parafusos do modelo no mesmo formato de inc/ifc_parafusos.json (usado por Suprimentos › Vínculos).
function importacao_parafusos(array $modelo)
{
    $porTipo = [];
    $porLocal = [];
    $porLocalFase = [];
    $porArr = [];
    $porPor = [];
    foreach ($modelo['fixadores'] as $f) {
        $loc = $f['fase'] !== '' ? $f['fase'] : 'Sem fase';
        $nome = $f['nome'];
        $q = (int)$f['qtd'];
        if ($f['tipo'] === 'parafuso') {
            $porTipo[$nome]['qtd'] = ($porTipo[$nome]['qtd'] ?? 0) + $q;
            $porTipo[$nome]['locais'][$loc] = ($porTipo[$nome]['locais'][$loc] ?? 0) + $q;
            $porTipo[$nome] += ['diametro_mm' => 0, 'comprimento_mm' => 0, 'arruelas' => (object)[], 'porcas' => (object)[]];
            $porLocal[$loc]['BOLT_qtd'] = ($porLocal[$loc]['BOLT_qtd'] ?? 0) + $q;
            $porLocalFase[$loc][$loc]['parafusos'][$nome] = ($porLocalFase[$loc][$loc]['parafusos'][$nome] ?? 0) + $q;
        } elseif ($f['tipo'] === 'arruela') {
            $porArr[$nome]['qtd'] = ($porArr[$nome]['qtd'] ?? 0) + $q;
            $porArr[$nome]['locais'][$loc] = ($porArr[$nome]['locais'][$loc] ?? 0) + $q;
            $porArr[$nome] += ['parafusos' => (object)[]];
            $porLocal[$loc]['arruelas'] = ($porLocal[$loc]['arruelas'] ?? 0) + $q;
            $porLocalFase[$loc][$loc]['arruelas'][$nome] = ($porLocalFase[$loc][$loc]['arruelas'][$nome] ?? 0) + $q;
        } elseif ($f['tipo'] === 'porca') {
            $porPor[$nome]['qtd'] = ($porPor[$nome]['qtd'] ?? 0) + $q;
            $porPor[$nome]['locais'][$loc] = ($porPor[$nome]['locais'][$loc] ?? 0) + $q;
            $porPor[$nome] += ['parafusos' => (object)[]];
            $porLocal[$loc]['porcas'] = ($porLocal[$loc]['porcas'] ?? 0) + $q;
            $porLocalFase[$loc][$loc]['porcas'][$nome] = ($porLocalFase[$loc][$loc]['porcas'][$nome] ?? 0) + $q;
        }
    }
    return ['observacao' => 'Parafusos lidos do IFC na importação automática (TIPO BOLT conta; furos e peças "FALSA" ficam de fora).',
        'fontes' => array_map(function ($a) { return ['arquivo' => $a['arquivo'], 'entidades' => $a['fixadores'], 'conjuntos_parafuso' => $a['fixadores']]; }, $modelo['arquivos']),
        'por_local' => (object)$porLocal, 'por_tipo' => (object)$porTipo, 'por_local_fase' => (object)$porLocalFase, 'por_arruela' => (object)$porArr, 'por_porca' => (object)$porPor, 'por_local_tipo' => []];
}

// Mapa de apontamento: guarda, por fase, as peças com a posição na malha (V × H) para o apontamento por peça.
function importacao_gravar_mapa($obraId, array $modelo, array $faseItem)
{
    sistema_gravar('frentes_montagem_obra', json_encode(idf_mapa($modelo, $faseItem), JSON_UNESCAPED_UNICODE));
}

// ------------------------------------------------------------------ leitura dentro do sistema (PHP): lê tudo e gera a obra

// Caminho do arquivo guardado de cada documento válido, por tipo: [tipo => [[nome original, caminho], ...]].
function importacao_arquivos_por_tipo($obraId)
{
    $porTipo = [];
    foreach (importacao_documentos($obraId) as $d) {
        if ($d['status'] !== 'valido') {
            continue;
        }
        $c = importacao_diretorio($obraId) . '/' . basename((string)$d['arquivo']);
        if (is_file($c)) {
            $porTipo[$d['tipo']][] = [$d['nome_original'], $c];
        }
    }
    return $porTipo;
}

// Expande apenas os arquivos esperados de um .zip para uma pasta temporária da
// própria obra. Nunca usa o caminho interno do ZIP como destino, evitando zip-slip.
function importacao_expandir_documentos(array $arquivos, array $extensoes, $tmp, $prefixo, array &$limpar)
{
    $out = [];
    foreach ($arquivos as list($nome, $caminho)) {
        if (importacao_extensao($nome) !== 'zip') { $out[] = [$nome, $caminho]; continue; }
        if (!class_exists('ZipArchive')) throw new RuntimeException('O servidor não tem suporte a .zip.');
        $z = new ZipArchive();
        if ($z->open($caminho) !== true) throw new RuntimeException("Não consegui abrir o .zip $nome.");
        for ($i = 0; $i < $z->numFiles; $i++) {
            $interno = $z->getNameIndex($i);
            $ext = strtolower(pathinfo($interno, PATHINFO_EXTENSION));
            if (!in_array($ext, $extensoes, true)) continue;
            $destino = $tmp . '/' . $prefixo . '-' . count($out) . '.' . $ext;
            $in = $z->getStream($interno);
            if (!$in) continue;
            $dest = fopen($destino, 'wb');
            stream_copy_to_stream($in, $dest); fclose($in); fclose($dest);
            $limpar[] = $destino;
            $out[] = [basename($interno), $destino];
        }
        $z->close();
    }
    return $out;
}

/**
 * Lê todos os documentos da obra (IFC, orçamento/BM, cronograma, fixadores, pranchas) e monta o pacote.
 * Tudo roda no próprio PHP, em fluxo: o IFC é lido linha a linha (a CPDA, 11 arquivos, leva menos de 1 s).
 */
function importacao_ler_documentos($obraId, $nomeObra = '')
{
    @set_time_limit(300);
    @ini_set('memory_limit', '768M');
    $docs = importacao_arquivos_por_tipo($obraId);
    $tmp = importacao_diretorio($obraId) . '/_leitura';
    if (!is_dir($tmp)) {
        @mkdir($tmp, 0755, true);
    }
    $limpar = [];
    try {
        // Todos os tipos aceitam ZIP; cada leitor recebe apenas a extensão que entende.
        $arquivosIfc = importacao_expandir_documentos($docs['ifc'] ?? [], ['ifc'], $tmp, 'ifc', $limpar);
        if (!$arquivosIfc) {
            throw new RuntimeException('Nenhum IFC para ler.');
        }
        $leituras = [];
        foreach ($arquivosIfc as list($nome, $caminho)) {
            $leituras[] = ifc_ler_arquivo($caminho, $nome);
            gc_collect_cycles();
        }
        $modelo = leitura_modelo($leituras);
        unset($leituras);

        // orçamento: a planilha com atividades de medição manda; as demais completam escopo e boletins
        $bm = ['itens' => [], 'avisos' => [], 'periodos' => [], 'escopo' => [], 'contrato_total' => null, 'aba' => ''];
        $lidos = [];
        foreach (importacao_expandir_documentos($docs['orcamento'] ?? [], ['xlsx', 'xlsm'], $tmp, 'orcamento', $limpar) as list($nome, $caminho)) {
            $lidos[] = [$nome, leitura_orcamento($caminho)];
        }
        if ($lidos) {
            usort($lidos, function ($a, $b) {
                $f = function ($r) { return [-array_sum(array_map(function ($i) { return count($i['atividades']); }, $r['itens'])), -count($r['itens'])]; };
                return $f($a[1]) <=> $f($b[1]);
            });
            $bm = $lidos[0][1];
            foreach (array_slice($lidos, 1) as list($nome, $outro)) {
                if (!$bm['periodos'] && $outro['periodos']) {
                    $bm['periodos'] = $outro['periodos'];
                }
                if (!$bm['escopo'] && $outro['escopo']) {
                    $bm['escopo'] = $outro['escopo'];
                }
                $bm['avisos'][] = "Planilha $nome usada só como complemento (a de medição com atividades é {$lidos[0][0]}).";
            }
            $temAtiv = false;
            foreach ($bm['itens'] as $i) {
                $temAtiv = $temAtiv || $i['atividades'];
            }
            if (!$temAtiv) {
                $bm['avisos'][] = 'Nenhuma planilha de orçamento trouxe as atividades de medição (memorial de cálculo do BM): cada item vira uma única atividade.';
            }
        }
        $crono = ['atividades' => [], 'avisos' => []];
        $cronogramas = importacao_expandir_documentos($docs['cronograma'] ?? [], ['xml', 'xlsx', 'xlsm', 'pdf'], $tmp, 'cronograma', $limpar);
        if ($cronogramas) {
            $crono = leitura_cronograma($cronogramas[0][1], $cronogramas[0][0]);
        }
        $fix = ['geral' => [], 'por_joist' => [], 'avisos' => []];
        foreach (importacao_expandir_documentos($docs['fixadores'] ?? [], ['trb', 'xlsx', 'xlsm', 'csv'], $tmp, 'fixadores', $limpar) as list($nome, $caminho)) {
            $r = leitura_fixadores($caminho, $nome);
            $fix['geral'] = array_merge($fix['geral'], $r['geral']);
            $fix['por_joist'] = array_merge($fix['por_joist'], $r['por_joist']);
            $fix['avisos'] = array_merge($fix['avisos'], $r['avisos']);
        }
        // pranchas: índice pelo arquivo (o texto dos PDFs do Tekla não dá para ler sem biblioteca de PDF)
        $pranchas = [];
        foreach (importacao_expandir_documentos($docs['projetos'] ?? [], ['pdf'], $tmp, 'projeto', $limpar) as list($nome, $caminho)) {
            $bin = (string)file_get_contents($caminho, false, null, 0, 4000000);
            preg_match_all('/\/Type\s*\/Page[^s]/', $bin, $pg);
            $pranchas[] = ['arquivo' => $nome, 'codigo' => '', 'titulo' => preg_replace('/\.pdf$/i', '', $nome), 'revisao' => '', 'escala' => '', 'tem_texto' => null, 'assuntos' => [], 'paginas' => max(1, count($pg[0]))];
        }
        $pacote = leitura_montar_pacote(['modelo' => $modelo, 'bm' => $bm, 'cronograma' => $crono, 'fixadores' => $fix,
            'projetos' => ['pranchas' => $pranchas, 'listas_de_material' => [], 'avisos' => $pranchas ? ['Projetos em PDF: arquivados no índice. A leitura do texto das pranchas (títulos e listas de material) ainda não roda dentro do sistema.'] : []]], $nomeObra);
        return $pacote;
    } finally {
        foreach ($limpar as $f) {
            @unlink($f);
        }
        @rmdir($tmp);
    }
}

// Refaz o mapa de apontamento a partir dos IFC guardados da obra (posição e comprimento de cada peça na planta). Obras importadas antes da planta usam isto.
// O GUID de cada peça e o grupo (produto + local) não mudam, então apontamentos e vínculos já feitos continuam valendo.
function importacao_atualizar_mapa($obraId)
{
    @set_time_limit(300);
    @ini_set('memory_limit', '768M');
    $docs = importacao_arquivos_por_tipo($obraId);
    $tmp = importacao_diretorio($obraId) . '/_leitura';
    if (!is_dir($tmp)) {
        @mkdir($tmp, 0755, true);
    }
    $limpar = [];
    try {
        $arquivos = importacao_expandir_documentos($docs['ifc'] ?? [], ['ifc'], $tmp, 'ifc', $limpar);
        if (!$arquivos) {
            throw new RuntimeException('Os arquivos IFC desta obra não estão mais guardados no servidor; reenvie o IFC na importação.');
        }
        $leituras = [];
        foreach ($arquivos as list($nome, $caminho)) {
            $leituras[] = ifc_ler_arquivo($caminho, $nome);
            gc_collect_cycles();
        }
        $modelo = leitura_modelo($leituras);
    } finally {
        foreach ($limpar as $f) {
            @unlink($f);
        }
        @rmdir($tmp);
    }
    $atual = json_decode((string)sistema_ler('frentes_montagem_obra', 'null'), true);
    $faseItem = [];
    foreach ((is_array($atual) ? ($atual['fases'] ?? []) : []) as $f) {
        if (!empty($f['item'])) {
            $faseItem[$f['fase']] = $f['item'];
        }
    }
    importacao_gravar_mapa($obraId, $modelo, $faseItem);
    $mapa = json_decode((string)sistema_ler('frentes_montagem_obra', 'null'), true) ?: [];
    $comXY = 0;
    foreach ($mapa['pecas'] ?? [] as $p) {
        if (isset($p[9]) && $p[9] !== null) {
            $comXY++;
        }
    }
    return ['pecas' => count($mapa['pecas'] ?? []), 'com_posicao' => $comXY, 'eixos' => count($mapa['malha']['linhas'] ?? [])];
}

// Um clique: lê os documentos, guarda o pacote (relatório) e cria a obra.
function importacao_gerar($obraId, array $op)
{
    $obra = q_global("SELECT nome FROM obras WHERE id = ? AND status = 'rascunho'", [(int)$obraId])->fetch();
    if (!$obra) {
        throw new InvalidArgumentException('Obra não está em rascunho.');
    }
    $sit = importacao_situacao($obraId);
    if (!$sit['pronta']) {
        throw new InvalidArgumentException('Faltam documentos obrigatórios ou há arquivo recusado.');
    }
    $pacote = importacao_ler_documentos($obraId, (string)$obra['nome']);
    if (!empty($pacote['erros'])) {
        throw new InvalidArgumentException(implode(' ', $pacote['erros']));
    }
    file_put_contents(importacao_pacote_caminho($obraId), json_encode($pacote, JSON_UNESCAPED_UNICODE));
    return importacao_publicar($obraId, $op);
}
