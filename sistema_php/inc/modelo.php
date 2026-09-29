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
            'realizado_manual' => false,
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
            'linha' => (int)$i['id'], 'data' => $i['data'], 'servico' => $i['servico'], 'motivo' => $i['motivo'],
            'solucionado' => $i['solucionado'], 'tempo' => $i['tempo'], 'quando' => $i['quando'], 'paralisacao' => $i['paralisacao'],
        ];
    }
    $tabelas = [];
    foreach (tabelas_spec() as $nome => $campos) {
        $tabelas[$nome] = linhas_tabela($nome, $campos);
    }
    return [
        'datas' => datas_obra(),
        'empresas' => $empresas,
        'metas' => $metas,
        'cliente' => $cliente,
        'impactos' => $impactos,
        'referencia' => null,
        'tabelas' => $tabelas,
        'abas_mensais_equip' => [],
    ];
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
    $pdo->beginTransaction();
    try {
        foreach (array_merge(['producao', 'servicos', 'empresas', 'metas', 'cliente', 'impactos'], array_keys(tabelas_spec())) as $t) {
            $pdo->exec("DELETE FROM $t");
        }
        $insEmp = $pdo->prepare('INSERT INTO empresas (aba, nome, col_obs, ordem) VALUES (?, ?, ?, ?)');
        $insServ = $pdo->prepare('INSERT INTO servicos (empresa_id, col, nome, frente, id_crono, escopo, ordem) VALUES (?, ?, ?, ?, ?, ?, ?)');
        $insProd = $pdo->prepare('INSERT INTO producao (empresa_id, data, col, valor_num, valor_txt) VALUES (?, ?, ?, ?, ?)');
        foreach ($m['empresas'] as $ordem => $e) {
            $insEmp->execute([$e['aba'], $e['nome'], $e['col_obs'] ?? null, $ordem]);
            $eid = (int)$pdo->lastInsertId();
            foreach ($e['servicos'] as $o => $s) {
                $insServ->execute([$eid, $s['col'], $s['nome'], $s['frente'] ?? null, $s['id'] ?? null, numero($s['escopo'] ?? null), $o]);
            }
            foreach (($e['registros'] ?? []) as $data => $r) {
                if (!data_valida($data)) {
                    continue;
                }
                foreach (($r['v'] ?? []) as $col => $v) {
                    $n = is_string($v) ? null : numero($v);
                    $insProd->execute([$eid, $data, $col, $n, $n === null ? (string)$v : null]);
                }
                if (!empty($r['obs']) && !empty($e['col_obs'])) {
                    $insProd->execute([$eid, $data, $e['col_obs'], null, (string)$r['obs']]);
                }
            }
        }
        $ins = $pdo->prepare('INSERT INTO metas (empresa, servico, inicio, fim, corte, meta_dia, du, gap) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
        foreach ($m['metas'] as $x) {
            $ins->execute([$x['empresa'], $x['servico'], $x['inicio'], $x['fim'], data_ou_nulo($x['corte'] ?? null),
                numero($x['meta_dia']) ?: 0, numero($x['du']) ?: 0, numero($x['gap'] ?? 0) ?: 0]);
        }
        $ins = $pdo->prepare('INSERT INTO cliente (servico, qtd, inicio_plan, meta_dia, du_semana, responsavel, obs, prazo, peso, frente) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        foreach ($m['cliente'] as $x) {
            $ins->execute([$x['servico'], numero($x['qtd'] ?? null), data_ou_nulo($x['inicio_plan'] ?? null), numero($x['meta_dia'] ?? null),
                numero($x['du_semana'] ?? null), texto_ou_nulo($x['responsavel'] ?? null), texto_ou_nulo($x['obs'] ?? null),
                data_ou_nulo($x['prazo'] ?? null), numero($x['peso'] ?? 1), texto_ou_nulo($x['frente'] ?? null)]);
        }
        $ins = $pdo->prepare('INSERT INTO impactos (data, servico, motivo, solucionado, tempo, quando, paralisacao) VALUES (?, ?, ?, ?, ?, ?, ?)');
        foreach ($m['impactos'] as $x) {
            $ins->execute([texto_ou_nulo($x['data'] ?? null), texto_ou_nulo($x['servico'] ?? null), texto_ou_nulo($x['motivo'] ?? null),
                texto_ou_nulo($x['solucionado'] ?? null), texto_ou_nulo($x['tempo'] ?? null), texto_ou_nulo($x['quando'] ?? null),
                texto_ou_nulo($x['paralisacao'] ?? null)]);
        }
        foreach (tabelas_spec() as $nome => $campos) {
            $cols = array_keys($campos);
            $ins = $pdo->prepare("INSERT INTO $nome (" . implode(', ', $cols) . ') VALUES (' . implode(', ', array_fill(0, count($cols), '?')) . ')');
            foreach (($m['tabelas'][$nome] ?? []) as $x) {
                $vals = [];
                foreach ($campos as $c => $tipo) {
                    $v = $x[$c] ?? null;
                    $vals[] = $tipo === 'num' ? numero($v) : ($tipo === 'data' ? data_ou_nulo($v) : texto_ou_nulo($v));
                }
                $ins->execute($vals);
            }
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
