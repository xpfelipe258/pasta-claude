<?php
// FINANÇAS: cálculos de impostos (CLT, MEI, ME/Simples) e de renda fixa. Funções puras, sem banco de dados.
// Parâmetros de 2026 concentrados aqui. São ESTIMATIVAS para planejamento: confirme com o contador.

const FIN_SALARIO_MINIMO = 1621.00;
const FIN_TETO_INSS = 8475.55;
const FIN_INSS_FAIXAS = [[1621.00, 0.075], [2902.84, 0.09], [4354.27, 0.12], [8475.55, 0.14]];
// [limite superior, alíquota, parcela a deduzir]
const FIN_IRRF_FAIXAS = [[2428.80, 0.0, 0.0], [2826.65, 0.075, 182.16], [3751.05, 0.15, 394.16], [4664.68, 0.225, 675.49], [INF, 0.275, 908.73]];
const FIN_DEDUCAO_DEPENDENTE = 189.59;
const FIN_DESCONTO_SIMPLIFICADO = 607.20;
// Lei 15.270/2025 (a partir de 2026): isenção efetiva até R$ 5.000 e redutor até R$ 7.350
const FIN_IRRF_ISENCAO_TOTAL = 5000.00;
const FIN_IRRF_LIMITE_REDUTOR = 7350.00;
const FIN_IRRF_REDUTOR_A = 978.62;
const FIN_IRRF_REDUTOR_B = 0.133145;

const FIN_MEI_LIMITE_ANUAL = 81000.00;
const FIN_MEI_ICMS = 1.00;
const FIN_MEI_ISS = 5.00;
const FIN_MEI_INSS_PERC = 0.05;

// Simples Nacional: [limite RBT12, alíquota nominal, parcela a deduzir]
const FIN_ANEXO_III = [[180000, 0.060, 0.0], [360000, 0.112, 9360.0], [720000, 0.135, 17640.0], [1800000, 0.160, 35640.0], [3600000, 0.210, 125640.0], [4800000, 0.330, 648000.0]];
const FIN_ANEXO_V = [[180000, 0.155, 0.0], [360000, 0.180, 4500.0], [720000, 0.195, 9900.0], [1800000, 0.205, 17100.0], [3600000, 0.230, 62100.0], [4800000, 0.305, 540000.0]];
const FIN_LIMITE_ME = 360000.00;
const FIN_FATOR_R_MINIMO = 0.28;

// ------------------------------------------------------------------ INSS / IRRF

function fin_inss($base)
{
    $base = min(max((float)$base, 0.0), FIN_TETO_INSS);
    $total = 0.0;
    $anterior = 0.0;
    foreach (FIN_INSS_FAIXAS as $f) {
        if ($base > $anterior) {
            $total += (min($base, $f[0]) - $anterior) * $f[1];
        }
        $anterior = $f[0];
    }
    return round($total, 2);
}

function fin_irrf($bruto, $inss, $dependentes = 0)
{
    $bruto = (float)$bruto;
    if ($bruto <= 0) {
        return 0.0;
    }
    $deducoes = max($inss + $dependentes * FIN_DEDUCAO_DEPENDENTE, FIN_DESCONTO_SIMPLIFICADO);
    $base = max($bruto - $deducoes, 0.0);
    $imposto = 0.0;
    foreach (FIN_IRRF_FAIXAS as $f) {
        if ($base <= $f[0]) {
            $imposto = max($base * $f[1] - $f[2], 0.0);
            break;
        }
    }
    if ($bruto <= FIN_IRRF_ISENCAO_TOTAL) {
        return 0.0;
    }
    if ($bruto <= FIN_IRRF_LIMITE_REDUTOR) {
        $imposto -= max(FIN_IRRF_REDUTOR_A - FIN_IRRF_REDUTOR_B * $bruto, 0.0);
    }
    return round(max($imposto, 0.0), 2);
}

function fin_salario_clt($bruto, $dependentes = 0, $outros = 0.0)
{
    $inss = fin_inss($bruto);
    $irrf = fin_irrf($bruto, $inss, $dependentes);
    $liquido = $bruto - $inss - $irrf - $outros;
    $terco = $bruto / 3;
    $liq13 = $bruto - $inss - $irrf;
    $brutoFerias = $bruto + $terco;
    $inssF = fin_inss($brutoFerias);
    $irF = fin_irrf($brutoFerias, $inssF, $dependentes);
    $ferias = $terco - ($inssF - $inss) - ($irF - $irrf);
    return [
        'bruto' => (float)$bruto, 'inss' => $inss, 'irrf' => $irrf, 'outros' => (float)$outros,
        'liquido' => round($liquido, 2), 'fgts' => round($bruto * 0.08, 2),
        'aliquota_efetiva' => $bruto > 0 ? ($inss + $irrf) / $bruto : 0.0,
        'anual_liquido' => round($liquido * 12 + $liq13 + $ferias, 2),
    ];
}

// ------------------------------------------------------------------------- MEI

/** atividade: 'servicos', 'comercio' ou 'ambos'. */
function fin_mei($receita, $atividade = 'servicos', $despesas = 0.0)
{
    $inss = FIN_SALARIO_MINIMO * FIN_MEI_INSS_PERC;
    $icms = in_array($atividade, ['comercio', 'ambos'], true) ? FIN_MEI_ICMS : 0.0;
    $iss = in_array($atividade, ['servicos', 'ambos'], true) ? FIN_MEI_ISS : 0.0;
    $das = $inss + $icms + $iss;
    return [
        'das' => round($das, 2), 'inss' => round($inss, 2), 'iss' => $iss, 'icms' => $icms,
        'limite_mensal' => FIN_MEI_LIMITE_ANUAL / 12, 'dentro_do_limite' => $receita * 12 <= FIN_MEI_LIMITE_ANUAL,
        'liquido' => round($receita - $das - $despesas, 2), 'receita' => (float)$receita,
    ];
}

// -------------------------------------------------------------- Simples (ME/EPP)

/** @return array [alíquota efetiva, nominal, parcela a deduzir] */
function fin_simples_aliquota($rbt12, array $tabela)
{
    if ($rbt12 <= 0) {
        return [$tabela[0][1], $tabela[0][1], 0.0];
    }
    foreach ($tabela as $f) {
        if ($rbt12 <= $f[0]) {
            return [($rbt12 * $f[1] - $f[2]) / $rbt12, $f[1], $f[2]];
        }
    }
    $f = end($tabela);
    return [($rbt12 * $f[1] - $f[2]) / $rbt12, $f[1], $f[2]];
}

/** ME no Simples: Anexo III se Fator R >= 28%, senão Anexo V (ex.: engenharia). */
function fin_me_simples($receita, $proLabore, $despesasEmpresa = 0.0, $dependentes = 0, $rbt12 = null)
{
    $rbt12 = $rbt12 !== null && $rbt12 > 0 ? (float)$rbt12 : $receita * 12;
    $fatorR = $receita > 0 ? $proLabore / $receita : 0.0;
    $anexo = $fatorR >= FIN_FATOR_R_MINIMO ? 'III' : 'V';
    list($efetiva, $nominal) = fin_simples_aliquota($rbt12, $anexo === 'III' ? FIN_ANEXO_III : FIN_ANEXO_V);
    $das = $receita * $efetiva;
    $inssPl = round(min($proLabore, FIN_TETO_INSS) * 0.11, 2);
    $irrfPl = fin_irrf($proLabore, $inssPl, $dependentes);
    $lucro = $receita - $das - $despesasEmpresa - $proLabore;
    $liquido = $proLabore - $inssPl - $irrfPl + max($lucro, 0.0);
    return [
        'anexo' => $anexo, 'receita' => (float)$receita, 'rbt12' => $rbt12, 'fator_r' => $fatorR,
        'aliquota_efetiva' => $efetiva, 'aliquota_nominal' => $nominal, 'das' => round($das, 2),
        'pro_labore' => (float)$proLabore, 'inss_pro_labore' => $inssPl, 'irrf_pro_labore' => $irrfPl,
        'despesas_empresa' => (float)$despesasEmpresa, 'lucro_distribuivel' => round($lucro, 2),
        'liquido_no_bolso' => round($liquido, 2), 'carga_total' => $receita > 0 ? ($das + $inssPl + $irrfPl) / $receita : 0.0,
        'epp' => $rbt12 > FIN_LIMITE_ME, 'pro_labore_para_fator_r' => round($receita * FIN_FATOR_R_MINIMO, 2),
    ];
}

// ------------------------------------------------------------ renda fixa

const FIN_DIAS_UTEIS_ANO = 252;
const FIN_DIAS_UTEIS_MES = 21;
const FIN_CUSTODIA_TESOURO = 0.0020;

function fin_aliquota_ir($dias)
{
    if ($dias <= 180) {
        return 0.225;
    }
    if ($dias <= 360) {
        return 0.20;
    }
    return $dias <= 720 ? 0.175 : 0.15;
}

function fin_taxa_mensal($anual)
{
    return pow(1 + $anual, FIN_DIAS_UTEIS_MES / FIN_DIAS_UTEIS_ANO) - 1;
}

/** Selic > 8,5% a.a.: 0,5% a.m. + TR (TR ≈ 0); senão 70% da Selic. */
function fin_poupanca_anual($selic)
{
    return $selic > 0.085 ? pow(1.005, 12) - 1 : 0.70 * $selic;
}

/** $taxa = % do CDI (CDB, LCI/LCA) ou spread a.a. sobre a Selic (Tesouro). $m = ['selic','cdi','ipca'] em fração. */
function fin_taxa_bruta_anual($produto, $taxa, array $m)
{
    if ($produto === 'CDB' || $produto === 'LCI/LCA') {
        return $m['cdi'] * $taxa;
    }
    if ($produto === 'Tesouro Selic') {
        return $m['selic'] + $taxa - FIN_CUSTODIA_TESOURO;
    }
    return fin_poupanca_anual($m['selic']);
}

/** Evolução mês a mês: [mes, investido, bruto, ir, liquido]. */
function fin_simular($produto, $taxa, $inicial, $aporte, $meses, array $m)
{
    $mensal = fin_taxa_mensal(fin_taxa_bruta_anual($produto, $taxa, $m));
    $isento = in_array($produto, ['LCI/LCA', 'Poupança'], true);
    $saldo = $inicial;
    $investido = $inicial;
    $lotes = $inicial > 0 ? [[0, $inicial]] : [];
    $linhas = [['mes' => 0, 'investido' => $investido, 'bruto' => $saldo, 'ir' => 0.0, 'liquido' => $saldo]];
    for ($mes = 1; $mes <= $meses; $mes++) {
        $saldo = $saldo * (1 + $mensal) + $aporte;
        $investido += $aporte;
        if ($aporte > 0) {
            $lotes[] = [$mes, $aporte];
        }
        $ir = 0.0;
        if (!$isento) {
            foreach ($lotes as $l) {
                $ir += $l[1] * (pow(1 + $mensal, $mes - $l[0]) - 1) * fin_aliquota_ir(($mes - $l[0]) * 30);
            }
        }
        $linhas[] = ['mes' => $mes, 'investido' => $investido, 'bruto' => $saldo, 'ir' => $ir, 'liquido' => $saldo - $ir];
    }
    return $linhas;
}

/** % do CDI que um CDB precisa pagar para empatar com uma LCI/LCA isenta. */
function fin_equivalente_cdb($pctLci, $dias)
{
    return $pctLci / (1 - fin_aliquota_ir($dias));
}

/** Busca Selic meta (432), CDI a.a. (4389) e IPCA 12m (13522) no Banco Central; null se falhar. */
function fin_buscar_taxas_bcb()
{
    $ler = function ($serie) {
        $url = 'https://api.bcb.gov.br/dados/serie/bcdata.sgs.' . (int)$serie . '/dados/ultimos/1?formato=json';
        $ctx = stream_context_create(['http' => ['timeout' => 6, 'ignore_errors' => true, 'header' => "Accept: application/json\r\n"]]);
        $txt = @file_get_contents($url, false, $ctx);
        $j = $txt ? json_decode($txt, true) : null;
        if (!is_array($j) || !isset($j[0]['valor']) || !is_numeric(str_replace(',', '.', $j[0]['valor']))) {
            return null;
        }
        return (float)str_replace(',', '.', $j[0]['valor']) / 100;
    };
    $selic = $ler(432);
    $cdi = $ler(4389);
    $ipca = $ler(13522);
    return ($selic === null || $cdi === null || $ipca === null) ? null : ['selic' => $selic, 'cdi' => $cdi, 'ipca' => $ipca];
}
