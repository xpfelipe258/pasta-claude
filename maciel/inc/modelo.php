<?php
// Monta o modelo de dados no mesmo formato do programa local e importa/exporta pacotes JSON.

function valor_celula($linha)
{
    if ($linha['valor_num'] !== null) {
        return numero($linha['valor_num']);
    }
    return $linha['valor_txt'];
}

function obra_info()
{
    return [
        'nome' => sistema_ler('obra_nome', 'OBRA'),
        'data_inicio' => sistema_ler('data_inicio'),
        'data_fim' => sistema_ler('data_fim'),
    ];
}

function datas_obra()
{
    $o = obra_info();
    $datas = [];
    if (!data_valida($o['data_inicio']) || !data_valida($o['data_fim'])) {
        return $datas;
    }
    $d = new DateTime($o['data_inicio']);
    $fim = new DateTime($o['data_fim']);
    while ($d <= $fim) {
        $datas[] = $d->format('Y-m-d');
        $d->modify('+1 day');
    }
    return $datas;
}

function linhas_tabela($nome, $campos)
{
    $out = [];
    foreach (q("SELECT * FROM $nome ORDER BY id")->fetchAll() as $r) {
        $item = ['linha' => (int)$r['id']];
        foreach ($campos as $campo => $tipo) {
            $v = $r[$campo];
            $item[$campo] = $tipo === 'num' ? numero($v) : ($v === '' ? null : $v);
        }
        $out[] = $item;
    }
    return $out;
}

function montar_modelo()
{
    $empresas = [];
    $porId = [];
    foreach (q('SELECT * FROM empresas ORDER BY ordem, id')->fetchAll() as $e) {
        $item = ['aba' => $e['aba'], 'nome' => $e['nome'], 'col_obs' => $e['col_obs'], 'servicos' => [], 'registros' => new stdClass()];
        $porId[$e['id']] = count($empresas);
        $empresas[] = $item;
    }
    foreach (q('SELECT * FROM servicos ORDER BY empresa_id, ordem, id')->fetchAll() as $s) {
        if (!isset($porId[$s['empresa_id']])) {
            continue;
        }
        $empresas[$porId[$s['empresa_id']]]['servicos'][] = [
            'col' => $s['col'], 'nome' => $s['nome'], 'frente' => (string)$s['frente'],
            'id' => (string)$s['id_crono'], 'escopo' => numero($s['escopo']),
        ];
    }
    $reg = [];
    foreach (q('SELECT * FROM producao ORDER BY data')->fetchAll() as $p) {
        if (!isset($porId[$p['empresa_id']])) {
            continue;
        }
        $i = $porId[$p['empresa_id']];
        $data = substr($p['data'], 0, 10);
        if (!isset($reg[$i][$data])) {
            $reg[$i][$data] = ['v' => []];
        }
        if ($p['col'] === $empresas[$i]['col_obs']) {
            $reg[$i][$data]['obs'] = $p['valor_txt'];
        } else {
            $reg[$i][$data]['v'][$p['col']] = valor_celula($p);
        }
    }
    foreach ($reg as $i => $datas) {
        foreach ($datas as $d => $r) {
            if (empty($r['v'])) {
                $datas[$d]['v'] = new stdClass();
            }
        }
        $empresas[$i]['registros'] = $datas;
    }

    $metas = [];
    foreach (q('SELECT * FROM metas ORDER BY inicio, id')->fetchAll() as $m) {
        $metas[] = [
            'linha' => (int)$m['id'], 'empresa' => $m['empresa'], 'servico' => $m['servico'],
            'inicio' => substr($m['inicio'], 0, 10), 'fim' => substr($m['fim'], 0, 10),
            'corte' => $m['corte'] ? substr($m['corte'], 0, 10) : null,
            'meta_dia' => numero($m['meta_dia']) ?: 0, 'du' => numero($m['du']) ?: 0, 'gap' => numero($m['gap']) ?: 0,
            'fase' => (string)($m['fase'] ?? ''), 'realizado_manual' => false,
        ];
    }
    $cliente = [];
    foreach (q('SELECT * FROM cliente ORDER BY id')->fetchAll() as $c) {
        $cliente[] = [
            'linha' => (int)$c['id'], 'servico' => $c['servico'], 'qtd' => numero($c['qtd']),
            'inicio_plan' => $c['inicio_plan'] ? substr($c['inicio_plan'], 0, 10) : null,
            'meta_dia' => numero($c['meta_dia']), 'du_semana' => numero($c['du_semana']),
            'responsavel' => $c['responsavel'], 'obs' => $c['obs'],
            'prazo' => $c['prazo'] ? substr($c['prazo'], 0, 10) : null,
            'peso' => numero($c['peso']) ?: 1, 'frente' => $c['frente'],
        ];
    }
    $impactos = [];
    foreach (q('SELECT * FROM impactos ORDER BY id')->fetchAll() as $i) {
        $impactos[] = [
            'linha' => (int)$i['id'], 'data' => $i['data'], 'servico' => $i['servico'], 'empresas' => $i['empresas'] ?? '', 'motivo' => $i['motivo'],
            'solucionado' => $i['solucionado'], 'tempo' => $i['tempo'], 'quando' => $i['quando'], 'paralisacao' => $i['paralisacao'],
        ];
    }
    $tabelas = [];
    foreach (tabelas_spec() as $nome => $campos) {
        $tabelas[$nome] = linhas_tabela($nome, $campos);
    }
    $inv_ifc = carregar_inventario_ifc();
    $regras = carregar_regras_baixa();
    $resumo = ($regras) ? resumir_estoque_ifc(
        $tabelas['estoque_eventos'] ?? [],
        $tabelas['estoque_remessas'] ?? [],
        $tabelas['estoque_inventario'] ?? [],
        $regras, $inv_ifc) : null;
    return [
        'datas' => datas_obra(),
        'empresas' => $empresas,
        'metas' => $metas,
        'cliente' => $cliente,
        'impactos' => $impactos,
        'referencia' => sistema_ler('referencia', null),
        'tabelas' => $tabelas,
        'abas_mensais_equip' => [],
        'estoque_externo' => json_decode((string)sistema_ler('estoque_externo', 'null'), true),
        'estoque_ifc' => ['inventario' => $inv_ifc, 'regras' => $regras, 'resumo' => $resumo],
    ];
}

// O estoque importado da planilha (materiais, remessas, consumo físico, inventário) fica guardado como JSON:
// é um documento só, do mesmo formato que o programa local lê de dados/estoque_obra198.json.
function estoque_planilha_ler()
{
    $txt = sistema_ler('estoque_planilha', null);
    if ($txt === null && sistema_ler('dados_legados', '0') === '1') {
        $p = __DIR__ . '/estoque_inicial.json';
        $txt = is_file($p) ? file_get_contents($p) : null;
    }
    $d = $txt === null ? null : json_decode($txt, true);
    if (!is_array($d)) { return null; }
    // Retrocompatibilidade: se o dado do banco não tem datas de remessa,
    // mescla as datas do arquivo inicial (que sempre tem a versão atualizada).
    if (!isset($d['remessas']['datas'])) {
        $p = __DIR__ . '/estoque_inicial.json';
        if (is_file($p)) {
            $f = json_decode(file_get_contents($p), true);
            if (isset($f['remessas']['datas'])) {
                $d['remessas']['datas'] = $f['remessas']['datas'];
            }
        }
    }
    return $d;
}

function estoque_planilha_gravar(array $dados)
{
    sistema_gravar('estoque_planilha', json_encode($dados, JSON_UNESCAPED_UNICODE));
}

function carregar_inventario_ifc()
{
    if (sistema_ler('dados_legados', '0') !== '1') {
        return null;
    }
    $p = __DIR__ . '/ifc_inventario.json';
    if (!is_file($p)) {
        return null;
    }
    $d = json_decode(file_get_contents($p), true);
    return is_array($d) ? $d : null;
}

function carregar_regras_baixa()
{
    $p = __DIR__ . '/regras_baixa.json';
    if (!is_file($p)) {
        return null;
    }
    $d = json_decode(file_get_contents($p), true);
    return is_array($d) ? $d : null;
}

function consumo_evento(array $ev, array $regras)
{
    $tipo = strtoupper((string)($ev['tipo'] ?? ''));
    $letra = strtoupper((string)($ev['letra'] ?? ''));
    $faixa = strtoupper((string)($ev['faixa'] ?? ''));
    $out = [];
    if ($tipo === 'VIGA_APOIO_MONTADA' || $tipo === 'VIGA_INTERM_MONTADA') {
        foreach ($regras['eventos'] as $e) {
            if ($e['codigo'] === $tipo) {
                foreach ($e['baixa'] ?? [] as $b) {
                    $out[$b['codigo']] = ($out[$b['codigo']] ?? 0) + $b['quantidade'];
                }
                break;
            }
        }
        return $out;
    }
    if ($tipo === 'JOIST_ICADA') {
        $n = (int)($ev['n_joists'] ?? 0);
        if ($n <= 0) {
            return $out;
        }
        $crit = $regras['criterio_por_letra'] ?? [];
        $chave = isset($crit[$letra]) ? $letra : (isset($crit[$faixa]) ? $faixa : (substr($faixa, 0, 1) ?: ''));
        $par = $crit[$chave] ?? [];
        $paraf = $par['parafuso'] ?? null;
        foreach ($regras['eventos'] as $e) {
            if ($e['codigo'] !== 'JOIST_ICADA') {
                continue;
            }
            foreach ($e['baixa_por_joist'] ?? [] as $b) {
                $cod = $b['codigo'] ?? null;
                $q = ($b['quantidade'] ?? 0) * $n;
                if ($cod === 'PARAFUSO_FIX_JOIST' && $paraf) {
                    $out[$paraf] = ($out[$paraf] ?? 0) + $q;
                } elseif ($cod && $cod !== 'PARAFUSO_FIX_JOIST') {
                    $out[$cod] = ($out[$cod] ?? 0) + $q;
                }
            }
        }
    }
    return $out;
}

function resumir_estoque_ifc(array $eventos, array $remessas, array $inv, array $regras, $inv_ifc)
{
    $consumo = [];
    $consumo_por_dia = [];
    $joists = [];
    $alertas = [];
    $limite = $regras['limites_ifc']['joists_por_rua_faixa_maximo'] ?? 6;
    $letra_faixa = $regras['letra_para_faixa_do_par'] ?? [];

    foreach ($eventos as $ev) {
        $c = consumo_evento($ev, $regras);
        foreach ($c as $k => $v) {
            $consumo[$k] = ($consumo[$k] ?? 0) + $v;
        }
        $d = $ev['data'] ?? null;
        if ($d) {
            foreach ($c as $k => $v) {
                $consumo_por_dia[$d][$k] = ($consumo_por_dia[$d][$k] ?? 0) + $v;
            }
        }
        if (strtoupper((string)($ev['tipo'] ?? '')) === 'JOIST_ICADA') {
            $n = (int)($ev['n_joists'] ?? 0);
            $fx = strtoupper((string)($ev['faixa'] ?? ''));
            if (!$fx) {
                $fx = strtoupper($letra_faixa[strtoupper((string)($ev['letra'] ?? ''))] ?? '');
            }
            $chave = ($ev['rua'] ?? '') . '/' . $fx;
            $joists[$chave] = ($joists[$chave] ?? 0) + $n;
            if ($joists[$chave] > $limite) {
                $alertas[] = ['tipo' => 'joists_excedeu_ifc', 'chave' => $chave,
                    'mensagem' => "Rua/faixa $chave: {$joists[$chave]} joists apontadas (máx. IFC $limite)."];
            }
        }
    }

    $chegou = [];
    foreach ($remessas as $r) {
        $q = $r['quantidade'] ?? null;
        $cod = $r['codigo'] ?? null;
        if ($q !== null && $cod) {
            $chegou[$cod] = ($chegou[$cod] ?? 0) + (float)$q;
        }
    }

    $ultimo = [];
    foreach ($inv as $i) {
        $cod = $i['codigo'] ?? null;
        $q = $i['quantidade'] ?? null;
        $d = $i['data'] ?? null;
        if ($cod && $q !== null && $d && (!isset($ultimo[$cod]) || $d >= $ultimo[$cod]['data'])) {
            $ultimo[$cod] = ['data' => $d, 'quantidade' => (float)$q];
        }
    }

    $codigos = array_unique(array_merge(array_keys($consumo), array_keys($chegou), array_keys($ultimo)));
    sort($codigos);
    $materiais = [];
    foreach ($codigos as $cod) {
        $c = (float)($consumo[$cod] ?? 0);
        $en = (float)($chegou[$cod] ?? 0);
        $st = $en - $c;
        $fs = $ultimo[$cod]['quantidade'] ?? null;
        $perda = $fs !== null ? $fs - $st : null;
        $acu = null;
        if ($fs !== null) {
            $f = max($fs, 0); $s = max($st, 0);
            $mx = max($f, $s);
            $acu = $mx ? min($f, $s) / $mx : 1.0;
        }
        $materiais[] = ['codigo' => $cod, 'consumo_teorico' => $c, 'chegou' => $en,
            'saldo_teorico' => $st, 'fisico' => $fs,
            'data_inventario' => $ultimo[$cod]['data'] ?? null, 'perda' => $perda, 'acuracidade' => $acu];
    }

    $joists_proj = $inv_ifc['joists_projetadas']['por_rua_faixa'] ?? [];
    $ruas = [];
    foreach ($joists_proj as $ru => $faixas) {
        foreach ($faixas as $fx => $proj) {
            $ap = $joists["$ru/$fx"] ?? 0;
            $ruas[] = ['rua' => $ru, 'faixa' => $fx, 'projetado' => $proj, 'apontado' => $ap,
                'saldo' => $proj - $ap];
        }
    }

    // cobertura em dias: saldo / ritmo médio
    $datas_c = array_keys($consumo_por_dia);
    sort($datas_c);
    foreach ($materiais as &$m) {
        $m['cobertura_dias'] = null;
        if ($m['consumo_teorico'] && count($datas_c) >= 2) {
            $dias = max(1, (int)((strtotime(end($datas_c)) - strtotime(reset($datas_c))) / 86400));
            $ritmo = $m['consumo_teorico'] / $dias;
            if ($ritmo > 0 && $m['saldo_teorico'] !== null) {
                $m['cobertura_dias'] = round($m['saldo_teorico'] / $ritmo, 1);
            }
        }
    }
    unset($m);

    return ['materiais' => $materiais, 'por_rua_faixa' => $ruas,
        'consumo_por_dia' => $consumo_por_dia, 'alertas' => $alertas,
        'gerado_em' => date('Y-m-d')];
}

function exportar_pacote()
{
    return [
        'formato' => 'obra198', 'versao_formato' => 1, 'gerado_em' => date('c'),
        'origem' => 'sistema online', 'obra' => obra_info(), 'modelo' => montar_modelo(),
    ];
}

function data_ou_nulo($v)
{
    return data_valida($v) ? $v : null;
}

function importar_pacote(array $pacote)
{
    if (($pacote['formato'] ?? '') !== 'obra198' || empty($pacote['modelo'])) {
        throw new InvalidArgumentException('Arquivo inválido: use o JSON exportado pelo programa da obra.');
    }
    $m = $pacote['modelo'];
    $pdo = bd();
    $obraId = obra_atual_id();
    if ($obraId <= 0) {
        throw new InvalidArgumentException('Selecione a obra que receberá a importação.');
    }
    $pdo->beginTransaction();
    try {
        foreach (array_merge(['producao', 'servicos', 'empresas', 'metas', 'cliente', 'impactos'], array_keys(tabelas_spec())) as $t) {
            $stDel = $pdo->prepare("DELETE FROM $t WHERE obra_id = ?");
            $stDel->execute([$obraId]);
        }
        $insEmp = $pdo->prepare('INSERT INTO empresas (obra_id, aba, nome, col_obs, ordem) VALUES (?, ?, ?, ?, ?)');
        $insServ = $pdo->prepare('INSERT INTO servicos (obra_id, empresa_id, col, nome, frente, id_crono, escopo, ordem) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
        $insProd = $pdo->prepare('INSERT INTO producao (obra_id, empresa_id, data, col, valor_num, valor_txt) VALUES (?, ?, ?, ?, ?, ?)');
        foreach ($m['empresas'] as $ordem => $e) {
            $insEmp->execute([$obraId, $e['aba'], $e['nome'], $e['col_obs'] ?? null, $ordem]);
            $eid = (int)$pdo->lastInsertId();
            foreach ($e['servicos'] as $o => $s) {
                $insServ->execute([$obraId, $eid, $s['col'], $s['nome'], $s['frente'] ?? null, $s['id'] ?? null, numero($s['escopo'] ?? null), $o]);
            }
            foreach (($e['registros'] ?? []) as $data => $r) {
                if (!data_valida($data)) {
                    continue;
                }
                foreach (($r['v'] ?? []) as $col => $v) {
                    $n = is_string($v) ? null : numero($v);
                    $insProd->execute([$obraId, $eid, $data, $col, $n, $n === null ? (string)$v : null]);
                }
                if (!empty($r['obs']) && !empty($e['col_obs'])) {
                    $insProd->execute([$obraId, $eid, $data, $e['col_obs'], null, (string)$r['obs']]);
                }
            }
        }
        $ins = $pdo->prepare('INSERT INTO metas (obra_id, empresa, servico, inicio, fim, corte, meta_dia, du, gap) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
        foreach ($m['metas'] as $x) {
            $ins->execute([$obraId, $x['empresa'], $x['servico'], $x['inicio'], $x['fim'], data_ou_nulo($x['corte'] ?? null),
                numero($x['meta_dia']) ?: 0, numero($x['du']) ?: 0, numero($x['gap'] ?? 0) ?: 0]);
        }
        $ins = $pdo->prepare('INSERT INTO cliente (obra_id, servico, qtd, inicio_plan, meta_dia, du_semana, responsavel, obs, prazo, peso, frente) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        foreach ($m['cliente'] as $x) {
            $ins->execute([$obraId, $x['servico'], numero($x['qtd'] ?? null), data_ou_nulo($x['inicio_plan'] ?? null), numero($x['meta_dia'] ?? null),
                numero($x['du_semana'] ?? null), texto_ou_nulo($x['responsavel'] ?? null), texto_ou_nulo($x['obs'] ?? null),
                data_ou_nulo($x['prazo'] ?? null), numero($x['peso'] ?? 1), texto_ou_nulo($x['frente'] ?? null)]);
        }
        $ins = $pdo->prepare('INSERT INTO impactos (obra_id, data, servico, empresas, motivo, solucionado, tempo, quando, paralisacao) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
        foreach ($m['impactos'] as $x) {
            $ins->execute([$obraId, texto_ou_nulo($x['data'] ?? null), texto_ou_nulo($x['servico'] ?? null), texto_ou_nulo($x['empresas'] ?? null), texto_ou_nulo($x['motivo'] ?? null),
                texto_ou_nulo($x['solucionado'] ?? null), texto_ou_nulo($x['tempo'] ?? null), texto_ou_nulo($x['quando'] ?? null),
                texto_ou_nulo($x['paralisacao'] ?? null)]);
        }
        foreach (tabelas_spec() as $nome => $campos) {
            $cols = array_keys($campos);
            $ins = $pdo->prepare("INSERT INTO $nome (obra_id, " . implode(', ', $cols) . ') VALUES (' . implode(', ', array_fill(0, count($cols) + 1, '?')) . ')');
            foreach (($m['tabelas'][$nome] ?? []) as $x) {
                $vals = [];
                foreach ($campos as $c => $tipo) {
                    $v = $x[$c] ?? null;
                    $vals[] = $tipo === 'num' ? numero($v) : ($tipo === 'data' ? data_ou_nulo($v) : texto_ou_nulo($v));
                }
                array_unshift($vals, $obraId);
                $ins->execute($vals);
            }
        }
        sistema_gravar('estoque_externo', json_encode($m['estoque_externo'] ?? null, JSON_UNESCAPED_UNICODE));
        if (is_array($pacote['estoque_planilha'] ?? null)) {
            estoque_planilha_gravar($pacote['estoque_planilha']);
        }
        if (is_array($pacote['frentes_montagem'] ?? null)) {
            sistema_gravar('frentes_montagem', json_encode($pacote['frentes_montagem'], JSON_UNESCAPED_UNICODE));
        }
        if (!empty($m['referencia'])) {
            sistema_gravar('referencia', $m['referencia']);
        }
        $datas = $m['datas'] ?? [];
        $obra = $pacote['obra'] ?? [];
        sistema_gravar('data_inicio', $obra['data_inicio'] ?? ($datas ? $datas[0] : date('Y-m-d')));
        sistema_gravar('data_fim', $obra['data_fim'] ?? ($datas ? end($datas) : date('Y-m-d')));
        if (!empty($obra['nome'])) {
            sistema_gravar('obra_nome', $obra['nome']);
        }
        registrar_alteracao('importacao', ['origem' => $pacote['origem'] ?? null, 'gerado_em' => $pacote['gerado_em'] ?? null]);
        $pdo->commit();
    } catch (Exception $e) {
        $pdo->rollBack();
        throw $e;
    }
}
