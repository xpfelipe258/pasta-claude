<?php
// Resultado por competência no intervalo inclusivo escolhido no Painel financeiro.
function fin_periodo_meses($inicio, $fim)
{
    if (!data_valida($inicio) || !data_valida($fim) || $inicio > $fim) {
        throw new InvalidArgumentException('Informe datas válidas. O início não pode ser posterior ao fim.');
    }
    $out = [];
    for ($d = new DateTimeImmutable(substr($inicio, 0, 7) . '-01'); $d->format('Y-m-d') <= $fim; $d = $d->modify('+1 month')) {
        if (count($out) >= 120) { throw new InvalidArgumentException('Selecione um período de até 10 anos.'); }
        $de = max($inicio, $d->format('Y-m-d'));
        $ate = min($fim, $d->format('Y-m-t'));
        $dias = (new DateTimeImmutable($de))->diff(new DateTimeImmutable($ate))->days + 1;
        $out[] = ['mes' => $d->format('Y-m'), 'inicio' => $de, 'fim' => $ate, 'fracao' => $dias / (int)$d->format('t')];
    }
    return $out;
}

function fin_periodo_resumo(array $obra, $inicio, $fim)
{
    $r = dashobras_resumo($obra, $fim);
    $meses = fin_periodo_meses($inicio, $fim);
    $datas = [];
    foreach ($meses as $m) {
        $datas[] = date('Y-m-d', strtotime($m['inicio'] . ' -1 day'));
        $datas[] = $m['fim'];
    }
    $medicao = dashobras_medicao((int)$obra['id'], array_values(array_unique($datas)));
    $r['no_periodo'] = 0.0; $r['meses_medidos'] = [];
    if (empty($medicao['vazio'])) {
        foreach ($meses as $m) {
            $antes = date('Y-m-d', strtotime($m['inicio'] . ' -1 day'));
            $v = round($medicao['por_data'][$m['fim']]['medido'] - $medicao['por_data'][$antes]['medido'], 2);
            $r['meses_medidos'][$m['mes']] = $v;
            $r['no_periodo'] += $v;
        }
    }
    $r['no_periodo'] = round($r['no_periodo'], 2);
    return $r;
}

function fin_periodo_custo_pessoa(array $pessoa, array $params, array $meses)
{
    $total = 0.0;
    foreach ($meses as $m) {
        if (rh_fracao_mes($pessoa, $m['mes']) <= 0) { continue; }
        $p = $pessoa;
        $p['admissao'] = max($m['inicio'], ($p['admissao'] ?? '') ?: $m['inicio']);
        $p['desligamento'] = min($m['fim'], ($p['desligamento'] ?? '') ?: $m['fim']);
        $total += rh_custo_colaborador($p, $params, $m['mes'])['total'];
    }
    return round($total, 2);
}

function fin_periodo_folha(array $u, array $meses)
{
    if (!rh_pode_ver_salarios($u)) { return null; }
    $total = 0.0; $vistos = []; $antes = obra_override();
    try {
        sesmt_garantir_esquema();
        foreach (dashobras_obras_do_usuario($u) as $obra) {
            $principal = (int)($obra['origem_obra_id'] ?? 0) ?: (int)$obra['id'];
            if (isset($vistos[$principal])) { continue; }
            $vistos[$principal] = true;
            obra_override((int)$obra['id']);
            $params = rh_params(true);
            $sql = 'SELECT * FROM sesmt_colaboradores WHERE obra_id = ?'; $par = [sesmt_obra_id()];
            if (($esc = sesmt_escopo_empresa()) !== '') { $sql .= ' AND UPPER(TRIM(empresa)) = ?'; $par[] = $esc; }
            foreach (q_global($sql, $par)->fetchAll() as $pessoa) { $total += fin_periodo_custo_pessoa($pessoa, $params, $meses); }
        }
        obra_override($antes);
        foreach (rhp_listar($u) as $pessoa) {
            $total += fin_periodo_custo_pessoa($pessoa, rhp_params_da_obra((int)($pessoa['obra_id'] ?? 0)), $meses);
        }
    } finally { obra_override($antes); }
    return round($total, 2);
}

function fin_periodo_contas(array $u, $inicio, $fim)
{
    garantir_fin_avulsas();
    list($w, $p) = fav_escopo($u);
    $zero = ['previsto' => 0.0, 'realizado' => 0.0, 'aberto' => 0.0, 'vencido' => 0.0, 'n_aberto' => 0, 'n_vencido' => 0];
    $r = ['R' => $zero, 'P' => $zero];
    foreach (q_global("SELECT * FROM fin_avulsas WHERE $w", $p)->fetchAll() as $c) {
        $t = $c['tipo'];
        $vence = $c['vencimento'] >= $inicio && $c['vencimento'] <= $fim;
        if ($vence) { $r[$t]['previsto'] += (float)$c['valor']; }
        if (!empty($c['baixa_data']) && $c['baixa_data'] >= $inicio && $c['baixa_data'] <= $fim) {
            $r[$t]['realizado'] += (float)($c['valor_baixa'] ?? $c['valor']);
        }
        if ($vence && (empty($c['baixa_data']) || $c['baixa_data'] > $fim)) {
            $r[$t]['aberto'] += (float)$c['valor']; $r[$t]['n_aberto']++;
            if ($c['vencimento'] < $fim) { $r[$t]['vencido'] += (float)$c['valor']; $r[$t]['n_vencido']++; }
        }
    }
    foreach ($r as &$linha) { foreach (['previsto', 'realizado', 'aberto', 'vencido'] as $k) { $linha[$k] = round($linha[$k], 2); } }
    unset($linha);
    return $r;
}

function fin_periodo_resultado(array $u, $inicio, $fim, array $resumos, array $tot)
{
    $meses = fin_periodo_meses($inicio, $fim);
    $impostos = 0.0; $outros = 0.0; $linhas = []; $antes = obra_override();
    try {
        foreach ($resumos as $r) {
            if (!empty($r['erro'])) { throw new RuntimeException('Não foi possível ler uma das obras.'); }
            obra_override((int)$r['id']);
            $contas = q('SELECT tipo, descricao, percentual, valor, recorrencia, comp_inicio, comp_fim FROM contas_pagar WHERE ativo = 1')->fetchAll();
            foreach ($meses as $m) {
                $ym = $m['mes'];
                foreach ($contas as $c) {
                    if ($c['tipo'] === 'FOLHA') { continue; }
                    $ci = (string)$c['comp_inicio']; $cf = (string)($c['comp_fim'] ?? '');
                    $ativo = $c['recorrencia'] === 'UNICA' ? $ci === $ym : ($ci <= $ym && ($cf === '' || $cf >= $ym));
                    if (!$ativo) { continue; }
                    if ($c['tipo'] === 'IMPOSTO') {
                        $valor = round(max(0, (float)($r['meses_medidos'][$ym] ?? 0)) * (float)$c['percentual'] / 100, 2);
                        $impostos += $valor; $tipo = 'Imposto';
                    } else {
                        $valor = round((float)$c['valor'] * $m['fracao'], 2);
                        $outros += $valor; $tipo = 'Outra conta (proporcional)';
                    }
                    if ($valor != 0) { $linhas[] = ['obra' => $r['nome'], 'tipo' => $tipo, 'descricao' => $c['descricao'] . ' · ' . $ym, 'valor' => $valor]; }
                }
            }
        }
    } finally { obra_override($antes); }
    $av = fin_periodo_contas($u, $inicio, $fim);
    $folha = fin_periodo_folha($u, $meses);
    $medido = round((float)$tot['no_periodo'], 2);
    $custo = $folha !== null ? round($impostos + $folha + $outros + $av['P']['previsto'], 2) : null;
    return ['medido' => $medido, 'impostos' => round($impostos, 2), 'outros' => round($outros, 2), 'folha' => $folha,
        'receber' => $av['R'], 'pagar' => $av['P'], 'custo' => $custo,
        'resultado' => $custo !== null ? round($medido + $av['R']['previsto'] - $custo, 2) : null, 'linhas' => $linhas];
}
