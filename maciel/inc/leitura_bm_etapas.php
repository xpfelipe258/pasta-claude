<?php
// BM por etapas: contrato em R$ e avanço percentual, sem inventar quantidades físicas.
function lo_etapa_texto($v)
{
    return preg_replace('/\s+/u', ' ', strtr(lt_up($v), ['Á'=>'A','À'=>'A','Ã'=>'A','Â'=>'A','É'=>'E','Ê'=>'E','Í'=>'I','Ó'=>'O','Ô'=>'O','Õ'=>'O','Ú'=>'U','Ç'=>'C']));
}

function lo_etapa_codigo($v)
{
    if (is_bool($v) || $v === null) { return null; }
    $v = lt_texto($v);
    return preg_match('/^\d+(?:[.,]\d+)*$/D', $v) ? str_replace(',', '.', $v) : null;
}

function lo_etapas_cabecalho(array $linhas)
{
    foreach (array_slice($linhas, 0, 80, true) as $i => $l) {
        $ci = $cd = $cc = null;
        foreach ($l as $j => $v) {
            $v = lo_etapa_texto($v);
            if (in_array($v, ['ETAPA', 'ITEM', 'CODIGO'], true)) { $ci = $j; }
            if (strpos($v, 'DESCRI') === 0) { $cd = $j; }
            if ($v === 'CONTRATO') { $cc = $j; }
        }
        if ($ci === null || $cd === null || $cc === null) { continue; }
        $limite = count($l);
        foreach ($l as $j => $v) {
            if ($j > $cc && lo_etapa_texto($v) !== '') { $limite = $j; break; }
        }
        foreach (array_slice($linhas, $i + 1, 3, true) as $k => $l2) {
            $cp = $cv = null;
            foreach ($l2 as $j => $v) {
                if ($j < $cc || $j >= $limite) { continue; }
                $v = lo_etapa_texto($v);
                if (strpos($v, '%') !== false && strpos($v, 'ETAP') !== false) { $cp = $j; }
                if (strpos($v, 'VALOR') === 0) { $cv = $j; }
            }
            if ($cp !== null && $cv !== null) { return [$i, $k, $ci, $cd, $cv]; }
        }
    }
    return null;
}

function lo_etapas_periodos(array $linhas, $cab)
{
    $periodos = [];
    foreach ($linhas[$cab] as $j => $v) {
        if (!preg_match('/^(?:MEDICAO|BM)\s*0*(\d+)\b/u', lo_etapa_texto($v), $m)) { continue; }
        // A data deve estar na própria coluna do cabeçalho, acima dele. Não deduzir pela ordem dos BMs.
        for ($i = $cab - 1; $i >= max(0, $cab - 5); $i--) {
            $corte = lt_data_iso($linhas[$i][$j] ?? null);
            if ($corte) { $periodos[(int)$m[1]] = ['bm'=>(int)$m[1], 'corte'=>$corte]; break; }
        }
    }
    ksort($periodos);
    return array_values($periodos);
}

function lo_bm_etapas(array $linhas)
{
    $cab = lo_etapas_cabecalho($linhas);
    if (!$cab) { return null; }
    list($icab, $inicio, $ci, $cd, $cv) = $cab;
    $reg = [];
    $total = null;
    $avisos = [];
    foreach (array_slice($linhas, $inicio + 1, null, true) as $n => $l) {
        $rotulo = lo_etapa_texto(($l[$ci] ?? '') . ' ' . ($l[$cd] ?? ''));
        if (preg_match('/^(VALOR TOTAL|TOTAL DO CONTRATO|TOTAL GERAL)\b/u', trim($rotulo))) {
            $total = lt_numero($l[$cv] ?? null);
            break; // rateios, antecipações e retenções após o total não são novos serviços.
        }
        $cod = lo_etapa_codigo($l[$ci] ?? null);
        $desc = lt_texto($l[$cd] ?? null);
        $valor = lt_numero($l[$cv] ?? null);
        if ($cod === null || $desc === '') { continue; }
        if ($valor === null) {
            $avisos[] = 'Linha ' . ($n + 1) . ' (' . $desc . '): sem valor de contrato; não incluída no catálogo.';
            continue;
        }
        if ($valor < 0) { throw new InvalidArgumentException('Linha ' . ($n + 1) . ': o valor contratado é negativo. Confira a planilha.'); }
        $reg[] = ['codigo'=>$cod, 'descricao'=>$desc, 'valor_original'=>$valor, 'linha'=>$n + 1];
    }
    if (!$reg) { return null; }
    $grupos = [];
    $grupo = null;
    $vistos = [];
    foreach ($reg as $r) {
        $cod = $r['codigo'];
        $titulo = preg_match('/^ETAPA\s+\d+\b/u', lo_etapa_texto($r['descricao']));
        $temFilhos = false;
        foreach ($reg as $outro) {
            if (strpos($outro['codigo'], $cod . '.') === 0) { $temFilhos = true; break; }
        }
        if ($titulo || $temFilhos) {
            if (isset($grupos[$cod])) { throw new InvalidArgumentException('Etapa ' . $cod . ' repetida: confira os títulos da planilha.'); }
            $grupo = $cod;
            $grupos[$cod] = $r + ['atividades'=>[]];
            continue;
        }
        if ($grupo === null) {
            $grupo = $cod;
            $grupos[$cod] = $r + ['atividades'=>[]];
        }
        if (isset($vistos[$cod])) {
            $avisos[] = 'Código de origem ' . $cod . ' repetido na linha ' . $r['linha'] . '. As duas atividades foram preservadas; os códigos do catálogo serão gerados por etapa e sequência.';
        }
        $vistos[$cod] = true;
        if ($cod !== $grupo && strpos($cod, $grupo . '.') !== 0) {
            $avisos[] = 'Linha ' . $r['linha'] . ': código de origem ' . $cod . ' fora da sequência da etapa ' . $grupo . '. Mantido na etapa pelo posicionamento da linha; confira a prévia.';
        }
        $grupos[$grupo]['atividades'][] = $r;
        // Uma linha avulsa não vira pai de todas as linhas seguintes.
        if ($cod === $grupo && !$titulo && !$temFilhos) { $grupo = null; }
    }
    $itens = [];
    foreach ($grupos as $g) {
        $ativs = $g['atividades'] ?: [$g];
        $soma = array_sum(array_column($ativs, 'valor_original'));
        $valor = round($g['valor_original'], 2);
        if (abs($soma - $g['valor_original']) > 0.05) {
            throw new InvalidArgumentException('Etapa ' . $g['codigo'] . ': a soma das atividades difere do valor contratado. Confira os valores antes de importar.');
        }
        $a = [];
        foreach ($ativs as $r) {
            $a[] = ['descricao'=>$r['descricao'], 'qtd'=>100.0, 'unidade'=>'%', 'peso'=>$soma > 0 ? $r['valor_original'] / $soma : 1.0 / count($ativs),
                'valor'=>round($r['valor_original'], 2), 'codigo_origem'=>$r['codigo'], 'linha_origem'=>$r['linha']];
        }
        $itens[] = ['codigo'=>$g['codigo'], 'descricao'=>$g['descricao'], 'qtd'=>100.0, 'unidade'=>'%', 'valor'=>$valor, 'atividades'=>$a];
    }
    $soma = round(array_sum(array_column($itens, 'valor')), 2);
    if ($total !== null && abs($soma - $total) > 0.05) {
        throw new InvalidArgumentException('A soma das etapas difere do total do contrato da aba. Confira os valores antes de importar.');
    }
    if ($total !== null && abs($soma - $total) >= 0.005) {
        $avisos[] = 'Arredondamento das etapas para centavos: soma dos itens R$ ' . number_format($soma, 2, ',', '.') . '; total da planilha R$ ' . number_format($total, 2, ',', '.') . '. Confira a diferença de R$ ' . number_format(abs($soma - $total), 2, ',', '.') . ' na prévia.';
    }
    array_unshift($avisos, 'Planilha por etapas e avanço percentual: cada atividade foi lida como 100%. Não há quantidades físicas nesta tabela; não foram deduzidos vãos, peças ou m² dos títulos.');
    $avisos[] = 'Valores lidos da coluna CONTRATO. Medições realizadas e acumulados não foram somados ao contrato nem importados como produção.';
    return ['itens'=>$itens, 'contrato_total'=>$total === null ? $soma : round($total, 2), 'periodos'=>lo_etapas_periodos($linhas, $icab), 'escopo'=>[], 'avisos'=>$avisos, 'formato'=>'etapas_percentuais'];
}
