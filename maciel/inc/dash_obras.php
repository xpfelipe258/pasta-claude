<?php
// Painel das obras (tela inicial de quem administra mais de uma obra): medição acumulada e avanço de cada obra até a data escolhida.
// A conta repete a da Medição (BM) do sistema: avanço do item = soma dos avanços das atividades × peso (cada atividade limitada a 100%);
// valor medido = avanço do item × valor do item no contrato RÓTULA; só entra o catálogo de atividades de cada empresa da obra.

/** Quem cai direto neste painel: administra (admin_obra) duas ou mais obras ativas. O perfil administrador do sistema abre a Central normalmente. */
function usuario_abre_painel_obras(array $u)
{
    if (($u['perfil'] ?? '') === 'admin') { return false; }
    return count(dashobras_obras_do_usuario($u)) >= 2;
}

/** Obras ativas que o usuário administra (administrador do sistema: todas as ativas). */
function dashobras_obras_do_usuario(array $u)
{
    $ids = obras_que_administra($u);
    if (($u['perfil'] ?? '') === 'admin') {
        return q_global("SELECT * FROM obras WHERE status = 'ativa' ORDER BY nome")->fetchAll();
    }
    if (!$ids) { return []; }
    $lista = q_global("SELECT * FROM obras WHERE status = 'ativa' AND id IN (" . implode(',', array_map('intval', $ids)) . ') ORDER BY nome')->fetchAll();
    return array_values(array_filter($lista, function ($o) use ($u) { return usuario_pode_obra($u, (int)$o['id']); }));
}

function dashobras_norm($t)
{
    $t = mb_strtoupper((string)$t, 'UTF-8');
    $t = strtr($t, ['Á' => 'A', 'À' => 'A', 'Â' => 'A', 'Ã' => 'A', 'Ä' => 'A', 'É' => 'E', 'È' => 'E', 'Ê' => 'E', 'Ë' => 'E', 'Í' => 'I', 'Ì' => 'I', 'Î' => 'I', 'Ï' => 'I',
        'Ó' => 'O', 'Ò' => 'O', 'Ô' => 'O', 'Õ' => 'O', 'Ö' => 'O', 'Ú' => 'U', 'Ù' => 'U', 'Û' => 'U', 'Ü' => 'U', 'Ç' => 'C', 'Ñ' => 'N']);
    return trim(preg_replace('/[^A-Z0-9]+/', ' ', $t));
}

function dashobras_un($u)
{
    return strtoupper(trim(str_replace(['²', '³'], ['2', '3'], (string)$u)));
}

/** Medição acumulada e avanço de UMA obra, em várias datas de uma vez. $datas = lista 'aaaa-mm-dd'. Devolve [data => resumo]. */
function dashobras_medicao($obraId, array $datas)
{
    $antes = obra_override();
    obra_override((int)$obraId);
    try {
        $ativ = q('SELECT * FROM bm_atividades ORDER BY empresa, item, codigo')->fetchAll(PDO::FETCH_ASSOC);
        if (!$ativ) { return ['vazio' => true, 'por_data' => []]; }
        $baseFin = false;
        try { $baseFin = (int)((carregar_regras_baixa()['versao_identidade'] ?? 0)) === 1; } catch (Throwable $e) { $baseFin = false; }
        $empresas = [];
        foreach (q('SELECT id, nome FROM empresas')->fetchAll(PDO::FETCH_ASSOC) as $e) { $empresas[$e['nome']] = (int)$e['id']; }
        $servicos = [];   // empresa => [norm(nome) => ['col'=>, 'escopo'=>]]
        foreach (q('SELECT s.empresa_id, s.col, s.nome, s.escopo FROM servicos s')->fetchAll(PDO::FETCH_ASSOC) as $s) {
            $servicos[(int)$s['empresa_id']][dashobras_norm($s['nome'])] = ['col' => $s['col'], 'escopo' => (float)$s['escopo']];
        }
        // produção da grade por empresa e coluna: lista de [data, valor] (só valores numéricos)
        $prod = [];
        foreach (q('SELECT empresa_id, col, data, valor_num FROM producao WHERE valor_num IS NOT NULL ORDER BY data')->fetchAll(PDO::FETCH_ASSOC) as $r) {
            $prod[(int)$r['empresa_id'] . '|' . $r['col']][] = [substr((string)$r['data'], 0, 10), (float)$r['valor_num']];
        }
        $ap = [];   // codigo => lista de [data, quantidade]
        foreach (q('SELECT codigo, data, quantidade FROM bm_apontamentos ORDER BY data')->fetchAll(PDO::FETCH_ASSOC) as $r) {
            if ($r['data']) { $ap[$r['codigo']][] = [substr((string)$r['data'], 0, 10), (float)$r['quantidade']]; }
        }
        $somaAte = function (array $lista, $ate) { $t = 0.0; foreach ($lista as $x) { if ($x[0] <= $ate) { $t += $x[1]; } else { break; } } return $t; };
        $porCodigo = [];
        foreach ($ativ as $a) { $porCodigo[$a['empresa'] . '|' . $a['codigo']] = $a; }

        $fator = function ($a) use ($baseFin, $empresas, $servicos) {
            if (empty($a['controle'])) { return 1.0; }
            $txt = dashobras_norm(($a['item_desc'] ?? '') . ' ' . ($a['atividade'] ?? '') . ' ' . ($a['controle'] ?? ''));
            $un = dashobras_un($a['unidade'] ?? '');
            $alvo = strpos($txt, 'COBERTURA') !== false || strpos($txt, 'TELHA') !== false || strpos($txt, 'TELHAR') !== false || strpos($txt, 'FACEFELT') !== false || strpos($txt, 'FECHAMENTO LATERAL') !== false;
            if ($baseFin || ($alvo && $un === 'M2')) { return 1.0; }
            if (preg_match('/(?:m2_por_und|m²_por_und|fator_m2|fator_m²)\s*[:=]\s*([0-9]+(?:[,.][0-9]+)?)/iu', (string)($a['obs'] ?? ''), $m)) {
                $f = (float)str_replace(',', '.', $m[1]); if ($f > 0) { return $f; }
            }
            if ($un !== 'M2') { return 1.0; }
            if (dashobras_norm($a['empresa']) === 'GLOBO ACOS' && (strpos($txt, 'TELHA') !== false || strpos($txt, 'FECHAMENTO') !== false)) { return 177.32 * 0.485; }
            $sv = $servicos[$empresas[$a['empresa']] ?? 0][dashobras_norm($a['controle'])] ?? null;
            $esc = $sv ? (float)$sv['escopo'] : 0.0;
            return $esc > 0 && (float)$a['qtd'] > 0 ? (float)$a['qtd'] / $esc : 1.0;
        };
        // "facefelt/isolamento acústico" acompanha a instalação de telhas da mesma empresa e item (espelho de leitura)
        $espelhoDe = function ($a) use ($ativ) {
            if (!empty($a['controle'])) { return null; }
            $n = dashobras_norm($a['atividade'] ?? '');
            if (strpos($n, 'FACEFELT') === false && strpos($n, 'ISOLAMENTO ACUSTICO') === false) { return null; }
            foreach ($ativ as $x) {
                $nx = dashobras_norm($x['atividade'] ?? '');
                if ($x['empresa'] === $a['empresa'] && $x['item'] === $a['item'] && $x['codigo'] !== $a['codigo'] && empty($x['controle'])
                    && strpos($nx, 'INSTALACAO DE TELHAS') !== false && strpos($nx, 'ISOLAMENTO') === false && strpos($nx, 'PERFIL') === false) { return $x; }
            }
            return null;
        };
        $fatores = []; $espelhos = []; $cols = [];
        foreach ($ativ as $a) {
            $k = $a['empresa'] . '|' . $a['codigo'];
            $fatores[$k] = $fator($a); $espelhos[$k] = $espelhoDe($a);
            $sv = !empty($a['controle']) ? ($servicos[$empresas[$a['empresa']] ?? 0][dashobras_norm($a['controle'])] ?? null) : null;
            $cols[$k] = $sv ? ((int)($empresas[$a['empresa']] ?? 0) . '|' . $sv['col']) : null;
        }
        $realizado = function ($a, $ate) use ($fatores, $espelhos, $cols, $prod, $ap, $somaAte) {
            $k = $a['empresa'] . '|' . $a['codigo'];
            if (!empty($a['controle'])) { return $cols[$k] && isset($prod[$cols[$k]]) ? $somaAte($prod[$cols[$k]], $ate) * $fatores[$k] : 0.0; }
            $esp = $espelhos[$k];
            if ($esp) {   // quantidade própria no dia vale mais que a das telhas
                $dias = [];
                foreach (($ap[$esp['codigo']] ?? []) as $x) { if ($x[1] > 0) { $dias[$x[0]] = ($dias[$x[0]] ?? 0) + $x[1]; } }
                $proprios = [];
                foreach (($ap[$a['codigo']] ?? []) as $x) { $proprios[$x[0]] = ($proprios[$x[0]] ?? 0) + $x[1]; }
                foreach ($proprios as $d => $q) { $dias[$d] = $q; }
                $t = 0.0; foreach ($dias as $d => $q) { if ($d <= $ate) { $t += $q; } }
                return $t;
            }
            return isset($ap[$a['codigo']]) ? $somaAte($ap[$a['codigo']], $ate) : 0.0;
        };
        // itens (empresa + item): valor do contrato e pesos
        $itens = [];
        foreach ($ativ as $a) {
            $ik = $a['empresa'] . '|' . $a['item'];
            if (!isset($itens[$ik])) { $itens[$ik] = ['empresa' => $a['empresa'], 'valor' => (float)$a['valor_rotula'], 'xs' => [], 'sp' => 0.0]; }
            $itens[$ik]['xs'][] = $a; $itens[$ik]['sp'] += (float)$a['peso'];
        }
        $contrato = 0.0; foreach ($itens as $it) { $contrato += $it['valor']; }
        $out = ['vazio' => false, 'contrato' => $contrato, 'por_data' => []];
        foreach ($datas as $ate) {
            $medido = 0.0; $porEmp = [];
            foreach ($itens as $it) {
                $sp = $it['sp'] ?: 1.0; $pct = 0.0;
                foreach ($it['xs'] as $a) {
                    $q = (float)$a['qtd']; $r = $q > 0 ? $realizado($a, $ate) / $q : 0.0;
                    $pct += min(1.0, $r) * ((float)$a['peso']) / $sp;
                }
                $v = $pct * $it['valor']; $medido += $v;
                $porEmp[$it['empresa']]['medido'] = ($porEmp[$it['empresa']]['medido'] ?? 0) + $v;
                $porEmp[$it['empresa']]['contrato'] = ($porEmp[$it['empresa']]['contrato'] ?? 0) + $it['valor'];
            }
            $out['por_data'][$ate] = ['medido' => round($medido, 2), 'pct' => $contrato > 0 ? $medido / $contrato * 100 : 0, 'por_empresa' => $porEmp];
        }
        return $out;
    } finally {
        obra_override($antes);
    }
}

/** Resumo completo para o painel: contrato, medido acumulado até $ate, medido no mês, previsto linear pelo prazo e a curva mensal. */
function dashobras_resumo(array $obra, $ate)
{
    $id = (int)$obra['id'];
    $iniMes = substr($ate, 0, 8) . '01';
    $fimMesAnt = date('Y-m-d', strtotime($iniMes . ' -1 day'));
    $ini = !empty($obra['data_inicio']) ? substr($obra['data_inicio'], 0, 10) : null; $fim = !empty($obra['data_fim']) ? substr($obra['data_fim'], 0, 10) : null;
    $pontos = [];
    if ($ini && $fim && $fim > $ini) {   // fim de cada mês entre o início e a data (no máximo 36 pontos)
        $d = new DateTime(substr($ini, 0, 8) . '01'); $lim = new DateTime(substr($ate, 0, 8) . '01'); $n = 0;
        while ($d <= $lim && $n++ < 36) { $f = (clone $d)->modify('last day of this month')->format('Y-m-d'); $pontos[] = min($f, $ate); $d->modify('first day of next month'); }
    }
    $datas = array_values(array_unique(array_merge([$ate, $fimMesAnt], $pontos)));
    $m = dashobras_medicao($id, $datas);
    $r = ['id' => $id, 'nome' => $obra['nome'], 'sem_medicao' => !empty($m['vazio']), 'contrato' => (float)($m['contrato'] ?? 0), 'contrato_cadastro' => (float)($obra['valor_contrato'] ?? 0),
        'inicio' => $ini, 'fim' => $fim, 'curva' => []];
    if (!$r['sem_medicao']) {
        $atual = $m['por_data'][$ate]; $ant = $m['por_data'][$fimMesAnt];
        $r['medido'] = $atual['medido']; $r['pct'] = $atual['pct']; $r['no_mes'] = round($atual['medido'] - $ant['medido'], 2);
        $r['saldo'] = max(0, round($r['contrato'] - $r['medido'], 2)); $r['por_empresa'] = $atual['por_empresa'];
        foreach ($pontos as $p) { $r['curva'][] = ['data' => $p, 'real' => $m['por_data'][$p]['pct']]; }
    }
    // previsto: avanço linear pelo prazo da obra (início → fim), referência de ritmo; a Programação do cliente aparece dentro de cada obra
    if ($ini && $fim && $fim > $ini) {
        $tot = (strtotime($fim) - strtotime($ini)) / 86400; $dec = (strtotime($ate) - strtotime($ini)) / 86400;
        $r['previsto'] = max(0, min(100, $dec / $tot * 100));
        foreach ($r['curva'] as &$p) { $p['prev'] = max(0, min(100, ((strtotime($p['data']) - strtotime($ini)) / 86400) / $tot * 100)); }
        unset($p);
        if (isset($r['pct'])) { $r['desvio'] = $r['pct'] - $r['previsto']; }
    }
    $r['ultima'] = q_global('SELECT MAX(quando) FROM historico WHERE obra_id=?', [$id])->fetchColumn();
    return $r;
}
