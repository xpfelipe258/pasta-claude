<?php
// Obra própria de cada empresa terceirizada.
//
// A empresa recebe uma OBRA SÓ DELA: uma cópia, feita no momento da criação, apenas do que é da empresa na obra principal
// (serviços, produção, metas, cronograma dos serviços dela, catálogo e medição do BM, apontamentos, efetivo, equipamentos,
// impactos e planos 5W2H). Como todo dado do sistema é separado por obra (obra_id), o que a empresa lança, edita ou apaga
// nessa obra NUNCA altera a obra principal — e a obra principal não altera a da empresa até o administrador pedir "Recarregar".
//
// O que a empresa não recebe: dados das outras empresas, estoque/suprimentos (cada obra tem o seu), RDO, histórico, valor do
// contrato do cliente e o preço do cliente (valor_qpc passa a valer o valor da Rótula, que é o preço da empresa).

const OE_CONFIG_NAO_COPIA = ['obra_nome', 'data_inicio', 'data_fim', 'versao', 'modificado', 'dados_legados', 'estoque_planilha', 'estoque_externo',
    'vinculos_material', 'fixadores_atividade', 'importacao_info', 'planos_5w2h'];
// Dados de projeto da obra principal que vivem em arquivos de inc/ (dados_legados = 1): a obra da empresa recebe uma cópia gravada no banco.
const OE_ARQUIVOS_LEGADOS = ['regras_baixa' => 'regras_baixa.json', 'ifc_parafusos' => 'ifc_parafusos.json', 'ifc_parafusos_locais' => 'ifc_parafusos_locais.json',
    'ifc_anexos' => 'ifc_anexos.json', 'fixadores_projeto' => 'fixadores_projeto.json', 'estrutura_projeto' => 'estrutura_projeto.json', 'frentes_montagem' => 'frentes_montagem.json', 'paginacao_telhas' => 'paginacao_telhas.json'];
// Menus que a empresa recebe ao ser criada (o administrador pode mudar em Usuários › Ver / editar acessos)
const OE_MODULOS_PADRAO = ['producao', 'gestao', 'consumo', 'financeiro', 'qualidade'];

function oe_norm($s)
{
    $s = mb_strtoupper(trim((string)$s), 'UTF-8');
    $s = strtr($s, ['Á' => 'A', 'À' => 'A', 'Â' => 'A', 'Ã' => 'A', 'Ä' => 'A', 'É' => 'E', 'È' => 'E', 'Ê' => 'E', 'Ë' => 'E', 'Í' => 'I', 'Ì' => 'I', 'Î' => 'I',
        'Ï' => 'I', 'Ó' => 'O', 'Ò' => 'O', 'Ô' => 'O', 'Õ' => 'O', 'Ö' => 'O', 'Ú' => 'U', 'Ù' => 'U', 'Û' => 'U', 'Ü' => 'U', 'Ç' => 'C', 'Ñ' => 'N']);
    return trim(preg_replace('/[^A-Z0-9]+/', ' ', $s));
}

// Dados da obra própria da empresa aberta, ou null se a obra aberta é uma obra comum.
function obra_empresa_info($obraId = null)
{
    $obraId = $obraId ?? obra_atual_id();
    if ($obraId <= 0) { return null; }
    try {
        $o = q_global('SELECT o.empresa_vinculada, o.origem_obra_id, x.nome AS origem_nome FROM obras o LEFT JOIN obras x ON x.id = o.origem_obra_id WHERE o.id = ?', [$obraId])->fetch();
    } catch (Throwable $e) {
        return null;   // banco ainda sem as colunas novas
    }
    if (!$o || trim((string)$o['empresa_vinculada']) === '') { return null; }
    return ['empresa' => $o['empresa_vinculada'], 'origem_id' => (int)$o['origem_obra_id'], 'origem_nome' => (string)($o['origem_nome'] ?? '')];
}

// Obras próprias já criadas a partir de uma obra: [empresa => linha da obra]
function obra_empresa_listar($origemId)
{
    $out = [];
    foreach (q_global("SELECT * FROM obras WHERE origem_obra_id = ? AND status <> 'excluida' ORDER BY nome", [(int)$origemId])->fetchAll() as $o) {
        $out[mb_strtoupper((string)$o['empresa_vinculada'])] = $o;
    }
    return $out;
}

function oe_ler($tabela, $obraId, $onde = '', array $params = [])
{
    return q_global("SELECT * FROM `$tabela` WHERE obra_id = ? $onde", array_merge([(int)$obraId], $params))->fetchAll(PDO::FETCH_ASSOC);
}

// Copia as linhas para a obra de destino (sem o id: o banco gera outro). $ajuste pode mudar a linha ou devolver null para pular.
function oe_gravar($tabela, $destino, array $linhas, $ajuste = null)
{
    $st = null;
    $n = 0;
    foreach ($linhas as $l) {
        unset($l['id']);
        $l['obra_id'] = (int)$destino;
        if ($ajuste) {
            $l = $ajuste($l);
            if ($l === null) { continue; }
        }
        if (!$st) {
            $cols = array_keys($l);
            $st = bd()->prepare("INSERT INTO `$tabela` (`" . implode('`, `', $cols) . '`) VALUES (' . implode(', ', array_fill(0, count($cols), '?')) . ')');
        }
        $st->execute(array_values($l));
        $n++;
    }
    return $n;
}

function oe_config_gravar($obraId, $chave, $valor)
{
    q_global('DELETE FROM obra_config WHERE obra_id = ? AND chave = ?', [(int)$obraId, $chave]);
    q_global('INSERT INTO obra_config (obra_id, chave, valor) VALUES (?, ?, ?)', [(int)$obraId, $chave, $valor]);
}

// Plano 5W2H passa a ser o plano DA empresa: a atividade dividida entre empresas fica só com a parte dela (quantidade, valor, período e "como"),
// e a atividade com várias empresas e sem divisão informada fica com partes iguais.
function oe_planos_da_empresa($json, $empresa)
{
    $doc = json_decode((string)$json, true);
    if (!is_array($doc) || empty($doc['planos'])) { return null; }
    $alvo = oe_norm($empresa);
    $planos = [];
    foreach ($doc['planos'] as $p) {
        $itens = [];
        foreach (($p['itens'] ?? []) as $it) {
            $parte = null;
            foreach (($it['divisao'] ?? []) as $d) {
                if (oe_norm($d['empresa'] ?? '') === $alvo) { $parte = $d; break; }
            }
            $nomes = array_filter(array_map('oe_norm', preg_split('/[,;\/+]|\be\b/iu', (string)($it['empresa'] ?? ''))));
            if (!$parte && !in_array($alvo, $nomes, true)) { continue; }   // atividade de outra empresa
            $qtdOrig = (float)($it['qtd'] ?? 0);
            $qtd = $qtdOrig;
            if ($parte) {
                $qtd = (float)($parte['qtd'] ?? $qtdOrig);
                if (!empty($parte['valor'])) { $it['custo'] = $parte['valor']; }
                if (!empty($parte['inicio'])) { $it['inicio'] = $parte['inicio']; }
                if (!empty($parte['fim'])) { $it['fim'] = $parte['fim']; }
                if (trim((string)($parte['como'] ?? '')) !== '') { $it['como'] = $parte['como']; }
            } elseif (count($nomes) > 1) {
                $qtd = $qtdOrig / count($nomes);
                if (!empty($it['custo'])) { $it['custo'] = $it['custo'] / count($nomes); }
            }
            $razao = $qtdOrig > 0 ? $qtd / $qtdOrig : 1;
            $it['qtd'] = round($qtd, 4);
            if (!empty($it['qtd_contrato'])) { $it['qtd_contrato'] = round($it['qtd_contrato'] * $razao, 4); }
            if (!empty($it['meta_dia'])) { $it['meta_dia'] = round($it['meta_dia'] * $razao, 4); }
            $it['empresa'] = $empresa;
            $it['quem'] = $empresa;
            $it['divisao'] = [];
            $itens[] = $it;
        }
        if ($itens) {
            $p['itens'] = $itens;
            $planos[] = $p;
        }
    }
    $doc['planos'] = $planos;
    return json_encode($doc, JSON_UNESCAPED_UNICODE);
}

// Copia da obra $o para a obra $d só o que é da empresa $empresa. Devolve as contagens por tabela.
function oe_copiar_dados($o, $d, $empresa)
{
    $o = (int)$o;
    $d = (int)$d;
    $alvo = oe_norm($empresa);
    $cont = [];
    $e = null;
    foreach (oe_ler('empresas', $o, 'ORDER BY ordem, id') as $x) {
        if (oe_norm($x['nome']) === $alvo) { $e = $x; break; }
    }
    if (!$e) { throw new InvalidArgumentException('A empresa ' . $empresa . ' não existe na obra de origem.'); }
    $nome = $e['nome'];
    $mesma = function ($v) use ($alvo) { return oe_norm($v) === $alvo; };

    // empresa e serviços
    $antigo = (int)$e['id'];
    $e['ordem'] = 0;
    oe_gravar('empresas', $d, [$e]);
    $novo = (int)bd()->lastInsertId();
    $cont['servicos'] = oe_gravar('servicos', $d, oe_ler('servicos', $o, 'AND empresa_id = ?', [$antigo]), function ($l) use ($novo) { $l['empresa_id'] = $novo; return $l; });
    $cont['producao'] = oe_gravar('producao', $d, oe_ler('producao', $o, 'AND empresa_id = ?', [$antigo]), function ($l) use ($novo) { $l['empresa_id'] = $novo; return $l; });

    // cronograma do cliente: só os serviços da empresa; serviço feito por mais de uma empresa fica com a parte dela (÷ nº de empresas)
    $chaves = [];
    foreach (oe_ler('empresas', $o) as $x) {
        foreach (oe_ler('servicos', $o, 'AND empresa_id = ?', [(int)$x['id']]) as $s) {
            $chaves[oe_norm($s['nome']) . '|' . oe_norm($s['frente'])][$x['id']] = oe_norm($x['nome']);
        }
    }
    // parte da empresa nos serviços do galpão que têm atividade própria no catálogo do BM (quantidade da empresa ÷ soma das empresas); nos demais, partes iguais
    $catalogo = ['PREMONTAGEM' => '3.1.1-02', 'ICAMENTO JOIST' => '3.1.1-03', 'VIGAS' => '3.1.1-01'];
    $parteCatalogo = function ($servico) use ($o, $alvo, $catalogo) {
        $cod = $catalogo[oe_norm($servico)] ?? null;
        if (!$cod) { return null; }
        $tot = 0.0;
        $meu = 0.0;
        foreach (oe_ler('bm_atividades', $o, 'AND codigo LIKE ?', ['%-' . $cod]) as $a) {
            $tot += (float)$a['qtd'];
            if (oe_norm($a['empresa']) === $alvo) { $meu += (float)$a['qtd']; }
        }
        return ($tot > 0 && $meu > 0) ? $meu / $tot : null;
    };
    $cont['cliente'] = oe_gravar('cliente', $d, oe_ler('cliente', $o), function ($l) use ($chaves, $alvo, $parteCatalogo) {
        $k = oe_norm($l['servico']) . '|' . oe_norm($l['frente']);
        if (!isset($chaves[$k]) || !in_array($alvo, $chaves[$k], true)) { return null; }
        $n = count($chaves[$k]);
        $fator = $n > 1 ? (stripos((string)$l['frente'], 'COBERTURA') !== false ? ($parteCatalogo($l['servico']) ?? 1 / $n) : 1 / $n) : 1;
        if ($fator !== 1) {
            foreach (['qtd', 'meta_dia'] as $c) {
                if ($l[$c] !== null && $l[$c] !== '') { $l[$c] = round($l[$c] * $fator, 4); }
            }
        }
        return $l;
    });

    $cont['metas'] = oe_gravar('metas', $d, array_filter(oe_ler('metas', $o), function ($l) use ($mesma) { return $mesma($l['empresa']); }));
    $cont['impactos'] = oe_gravar('impactos', $d, array_filter(oe_ler('impactos', $o), function ($l) use ($alvo) {
        $lista = trim((string)$l['empresas']);
        if ($lista === '') { return false; }   // impacto sem empresa informada pode ser de qualquer uma: fica só na obra principal
        if (stripos($lista, 'todas') !== false) { return true; }
        return strpos(' ' . oe_norm($lista) . ' ', ' ' . $alvo . ' ') !== false;
    }));
    $cont['dp_efetivo'] = oe_gravar('dp_efetivo', $d, array_filter(oe_ler('dp_efetivo', $o), function ($l) use ($mesma) { return $mesma($l['empresa']); }));
    $cont['apontamentos'] = oe_gravar('apontamentos', $d, array_filter(oe_ler('apontamentos', $o), function ($l) use ($mesma) { return $mesma($l['empresa']); }));

    // equipamentos usados pela empresa
    $usos = array_filter(oe_ler('usos', $o), function ($l) use ($alvo) {
        return strpos(' ' . oe_norm($l['empresa']) . ' ', ' ' . $alvo . ' ') !== false;
    });
    $cont['usos'] = oe_gravar('usos', $d, $usos);
    $usados = array_unique(array_map(function ($l) { return oe_norm($l['equipamento']); }, $usos));
    $cont['equipamentos'] = oe_gravar('equipamentos', $d, array_filter(oe_ler('equipamentos', $o), function ($l) use ($usados, $mesma) {
        return $mesma($l['responsavel']) || in_array(oe_norm($l['equipamento']), $usados, true);
    }));

    // medição (BM): catálogo, períodos, apontamentos, deduções e fechamentos da empresa; o preço do cliente (valor_qpc) não vai
    $semCliente = function ($l) { if (array_key_exists('valor_qpc', $l)) { $l['valor_qpc'] = $l['valor_rotula'] ?? null; } return $l; };
    foreach (['bm_atividades' => $semCliente, 'bm_fech_atividades' => $semCliente, 'bm_periodos' => null, 'bm_apontamentos' => null, 'bm_deducoes' => null, 'bm_fechamentos' => null] as $t => $aj) {
        $cont[$t] = oe_gravar($t, $d, array_filter(oe_ler($t, $o), function ($l) use ($mesma) { return $mesma($l['empresa']); }), $aj);
    }

    // configurações da obra (mapa de montagem, regras de baixa, contratos editados, fluxo, projeção…)
    $legado = false;
    $presentes = [];
    foreach (q_global('SELECT chave, valor FROM obra_config WHERE obra_id = ?', [$o])->fetchAll(PDO::FETCH_ASSOC) as $c) {
        $presentes[$c['chave']] = $c['valor'];
    }
    $legado = ($presentes['dados_legados'] ?? '0') === '1';
    foreach ($presentes as $chave => $valor) {
        if (in_array($chave, OE_CONFIG_NAO_COPIA, true)) { continue; }
        oe_config_gravar($d, $chave, $valor);
    }
    if ($legado) {
        foreach (OE_ARQUIVOS_LEGADOS as $chave => $arq) {
            if (isset($presentes[$chave])) { continue; }
            $p = __DIR__ . '/' . $arq;
            if (is_file($p)) { oe_config_gravar($d, $chave, file_get_contents($p)); }
        }
    }
    $planos = isset($presentes['planos_5w2h']) ? oe_planos_da_empresa($presentes['planos_5w2h'], $nome) : null;
    if ($planos !== null) { oe_config_gravar($d, 'planos_5w2h', $planos); }
    foreach (['estoque_planilha' => '', 'estoque_externo' => '', 'vinculos_material' => '{}', 'fixadores_atividade' => '{}'] as $chave => $vazio) {
        oe_config_gravar($d, $chave, $vazio);   // valor explícito: sem ele o sistema cairia no dado global da instalação
    }
    oe_config_gravar($d, 'dados_legados', '0');
    oe_config_gravar($d, 'versao', '0');
    oe_config_gravar($d, 'modificado', date('c'));
    return $cont;
}

function oe_apagar_dados($obraId)
{
    foreach (tabelas_da_obra() as $t) {
        q_global("DELETE FROM `$t` WHERE obra_id = ?", [(int)$obraId]);
    }
    q_global('DELETE FROM obra_config WHERE obra_id = ?', [(int)$obraId]);
}

// Cria a obra própria da empresa a partir da obra de origem. Devolve o id da nova obra.
function obra_empresa_criar($origemId, $empresa)
{
    $origem = q_global("SELECT * FROM obras WHERE id = ? AND status <> 'excluida'", [(int)$origemId])->fetch();
    if (!$origem) { throw new InvalidArgumentException('Obra de origem não encontrada.'); }
    if (trim((string)($origem['empresa_vinculada'] ?? '')) !== '') {
        throw new InvalidArgumentException('Esta já é a obra própria de uma empresa: crie a partir da obra principal.');
    }
    $nomeEmp = null;
    foreach (oe_ler('empresas', $origemId) as $x) {
        if (oe_norm($x['nome']) === oe_norm($empresa)) { $nomeEmp = $x['nome']; break; }
    }
    if ($nomeEmp === null) { throw new InvalidArgumentException('A empresa ' . $empresa . ' não existe nesta obra.'); }
    if (isset(obra_empresa_listar($origemId)[mb_strtoupper($nomeEmp)])) {
        throw new InvalidArgumentException('A ' . $nomeEmp . ' já tem obra própria.');
    }
    $pdo = bd();
    $pdo->beginTransaction();
    try {
        $nome = $origem['nome'] . ' — ' . $nomeEmp;
        $cols = ['codigo', 'cliente', 'cidade', 'endereco', 'responsavel', 'responsavel_cliente', 'encarregado', 'data_inicio', 'data_fim', 'duracao_meses',
            'cor_primaria', 'cor_secundaria', 'logo'];   // sem valor do contrato, nº do contrato e observações da obra principal
        $vals = array_map(function ($c) use ($origem) { return $origem[$c] ?? null; }, $cols);
        q_global('INSERT INTO obras (nome, ' . implode(', ', $cols) . ", status, criado_em, origem_obra_id, empresa_vinculada) VALUES (?, " . implode(', ', array_fill(0, count($cols), '?')) . ', ?, ?, ?, ?)',
            array_merge([$nome], $vals, ['ativa', agora(), (int)$origemId, $nomeEmp]));
        $id = (int)$pdo->lastInsertId();
        $conf = q_global('SELECT chave, valor FROM obra_config WHERE obra_id = ? AND chave IN (?, ?, ?)', [(int)$origemId, 'data_inicio', 'data_fim', 'referencia'])->fetchAll(PDO::FETCH_KEY_PAIR);
        oe_config_gravar($id, 'obra_nome', $nome);
        oe_config_gravar($id, 'data_inicio', (string)($conf['data_inicio'] ?? $origem['data_inicio'] ?? ''));
        oe_config_gravar($id, 'data_fim', (string)($conf['data_fim'] ?? $origem['data_fim'] ?? ''));
        $cont = oe_copiar_dados($origemId, $id, $nomeEmp);
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) { $pdo->rollBack(); }
        throw $e;
    }
    registrar_global('obra_empresa_criada', ['obra_id' => $id, 'origem' => (int)$origemId, 'empresa' => $nomeEmp, 'linhas' => $cont]);
    return $id;
}

// Apaga o que a empresa lançou na obra própria e copia de novo da obra principal.
function obra_empresa_recarregar($obraId)
{
    $o = q_global("SELECT * FROM obras WHERE id = ? AND status <> 'excluida'", [(int)$obraId])->fetch();
    if (!$o || trim((string)$o['empresa_vinculada']) === '' || !(int)$o['origem_obra_id']) {
        throw new InvalidArgumentException('Esta não é a obra própria de uma empresa.');
    }
    $pdo = bd();
    $pdo->beginTransaction();
    try {
        oe_apagar_dados($obraId);
        $conf = q_global('SELECT chave, valor FROM obra_config WHERE obra_id = ? AND chave IN (?, ?)', [(int)$o['origem_obra_id'], 'data_inicio', 'data_fim'])->fetchAll(PDO::FETCH_KEY_PAIR);
        oe_config_gravar($obraId, 'obra_nome', $o['nome']);
        oe_config_gravar($obraId, 'data_inicio', (string)($conf['data_inicio'] ?? $o['data_inicio'] ?? ''));
        oe_config_gravar($obraId, 'data_fim', (string)($conf['data_fim'] ?? $o['data_fim'] ?? ''));
        $cont = oe_copiar_dados($o['origem_obra_id'], $obraId, $o['empresa_vinculada']);
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) { $pdo->rollBack(); }
        throw $e;
    }
    if (function_exists('importacao_apagar_pasta')) { importacao_apagar_pasta((int)$obraId); }   // fotos do RDO que a empresa tenha enviado
    registrar_global('obra_empresa_recarregada', ['obra_id' => (int)$obraId, 'linhas' => $cont]);
    return $cont;
}

// Cria o usuário da empresa: perfil editor, vinculado à empresa e SOMENTE à obra própria dela.
function obra_empresa_criar_usuario($obraId, $nome, $login, $senha, $email, array $modulos)
{
    $o = q_global('SELECT * FROM obras WHERE id = ?', [(int)$obraId])->fetch();
    if (!$o || trim((string)$o['empresa_vinculada']) === '') { throw new InvalidArgumentException('Obra própria de empresa não encontrada.'); }
    $login = trim($login);
    $email = trim($email);
    if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) { throw new InvalidArgumentException('Informe um e-mail válido.'); }
    if ($login === '' || strlen($senha) < 8) { throw new InvalidArgumentException('Informe o login e uma senha com pelo menos 8 caracteres.'); }
    if (q_global('SELECT id FROM usuarios WHERE login = ?', [$login])->fetch()) { throw new InvalidArgumentException('Já existe um usuário com esse login.'); }
    q_global('INSERT INTO usuarios (nome, login, senha, perfil, empresa, email, ativo) VALUES (?, ?, ?, ?, ?, ?, 1)',
        [trim($nome) !== '' ? trim($nome) : $login, $login, password_hash($senha, PASSWORD_DEFAULT), 'editor', $o['empresa_vinculada'], $email !== '' ? $email : null]);
    $uid = (int)bd()->lastInsertId();
    q_global('INSERT INTO usuarios_obras (usuario_id, obra_id) VALUES (?, ?)', [$uid, (int)$obraId]);
    foreach (modulos_sistema() as $m) {
        if (in_array($m, $modulos, true)) { q_global('INSERT INTO usuarios_modulos (usuario_id, modulo, permitido) VALUES (?, ?, 1)', [$uid, $m]); }
    }
    registrar_global('usuario_empresa_criado', ['usuario_id' => $uid, 'login' => $login, 'obra_id' => (int)$obraId, 'empresa' => $o['empresa_vinculada']]);
    return $uid;
}
