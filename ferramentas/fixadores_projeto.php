<?php
// Concilia a(s) lista(s) de fixadores em planilha com o IFC e grava o resultado da obra (planejado = MAIOR valor entre lista e IFC; peso unitário da lista).
//   php ferramentas/fixadores_projeto.php --saida maciel/inc/fixadores_projeto.json \
//       --lista lista1.xlsx lista2.xlsx ... --ifc modelo.ifc [outro.ifc ...] [--trb maciel/inc/ifc_parafusos.json] [--csv comparacao.csv]
// Lista de joist com "( 817X )" no título é multiplicada pela quantidade. Para obra nova o mesmo cálculo roda sozinho na importação.
require_once __DIR__ . '/../maciel/inc/fixadores_conciliacao.php';
require_once __DIR__ . '/../maciel/inc/leitura_ifc.php';
require_once __DIR__ . '/../maciel/inc/leitura_pacote.php';

$args = array_slice($argv, 1);
$opc = ['--lista' => [], '--ifc' => [], '--trb' => [], '--saida' => [], '--csv' => []];
$atual = null;
foreach ($args as $a) {
    if (isset($opc[$a])) { $atual = $a; continue; }
    if ($atual) { $opc[$atual][] = $a; }
}
if (!$opc['--lista']) { fwrite(STDERR, "Informe --lista arquivo.xlsx [...]\n"); exit(1); }

$lista = [];
$fontes = ['lista' => [], 'ifc' => []];
foreach ($opc['--lista'] as $f) {
    $r = leitura_fixadores($f, basename($f));
    $rot = trim(preg_replace('/[_\s]+/', ' ', preg_replace('/\.(xlsx|xlsm|csv)$/i', '', preg_replace('/^(\w{8}-)?198_-_LYON_G200_-_/', '', basename($f)))));
    $n = 0;
    foreach ($r['geral'] as $x) { $x['fonte'] = $rot; $lista[] = $x; $n++; }
    foreach ($r['por_joist'] as $b) {
        foreach ($b['itens'] as $x) { $x['fonte'] = $rot; $x['mult'] = $b['quantidade_de_joists']; $x['escopo'] = $x['escopo'] ?: $b['titulo']; $lista[] = $x; $n++; }
    }
    $fontes['lista'][] = ['arquivo' => $rot, 'linhas' => $n];
    foreach ($r['avisos'] as $av) { fwrite(STDERR, "aviso ($rot): $av\n"); }
}
$ifc = [];
foreach ($opc['--ifc'] as $f) {
    $l = ifc_ler_arquivo($f, basename($f));
    $mod = leitura_modelo([$l]);
    $rot = basename($f);
    $linhas = array_merge(fxc_ifc_de_conjuntos($mod['conjuntos'], $rot), fxc_ifc_de_modelo($mod['fixadores'], $rot));
    $ifc = array_merge($ifc, $linhas);
    $fontes['ifc'][] = ['arquivo' => $rot, 'linhas' => count($linhas)];
}
foreach ($opc['--trb'] as $f) {
    $pf = json_decode(file_get_contents($f), true);
    $n = 0;
    $add = function ($nome, $q) use (&$ifc, &$n) { $ifc[] = ['descricao' => $nome, 'norma' => '', 'qtd' => (float)$q, 'peso_unit_kg' => 0.0, 'fonte' => 'modelos TRB (anexos)']; $n++; };
    foreach ($pf['por_tipo'] ?? [] as $nome => $v) { $add($nome, $v['qtd']); }
    foreach (['por_arruela', 'por_porca'] as $s) {
        foreach ($pf[$s] ?? [] as $nome => $v) { if (stripos($nome, 'FALSA') === false) { $add($nome, $v['qtd']); } }
    }
    $fontes['ifc'][] = ['arquivo' => basename($f) . ' (modelos TRB dos anexos)', 'linhas' => $n];
}
$conc = fxc_conciliar($lista, $ifc);
$pacote = fxc_pacote($conc, $fontes);
$pacote['gerado_em'] = (new DateTimeImmutable('now', new DateTimeZone('America/Sao_Paulo')))->format('Y-m-d H:i');
if ($opc['--saida']) {
    file_put_contents($opc['--saida'][0], json_encode($pacote, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
    fwrite(STDERR, "gravado: {$opc['--saida'][0]}\n");
}
$csv = $opc['--csv'] ? fopen($opc['--csv'][0], 'w') : null;
if ($csv) { fwrite($csv, "\xEF\xBB\xBF"); fputcsv($csv, ['Fixador', 'Lista', 'IFC', 'Planejado (maior)', 'Origem', 'Peso unit. (kg)', 'Fonte do peso', 'Peso total (kg)'], ';'); }
printf("%-38s %10s %10s %10s  %-9s %9s  %s\n", 'fixador', 'lista', 'ifc', 'planejado', 'origem', 'peso un', 'fonte do peso');
$pt = 0;
foreach ($conc['itens'] as $it) {
    printf("%-38s %10s %10s %10s  %-9s %9s  %s\n", mb_substr($it['nome'], 0, 38), number_format($it['lista'], 0, ',', '.'), number_format($it['ifc'], 0, ',', '.'), number_format($it['planejado'], 0, ',', '.'), $it['origem'], $it['peso_unit'] ?: '-', $it['peso_fonte']);
    $pt += $it['planejado'] * $it['peso_unit'];
    if ($csv) { fputcsv($csv, [$it['nome'], $it['lista'], $it['ifc'], $it['planejado'], $it['origem'], $it['peso_unit'], $it['peso_fonte'], round($it['planejado'] * $it['peso_unit'], 2)], ';'); }
}
printf("itens: %d · peso total planejado: %.1f t · sem identificar: %s\n", count($conc['itens']), $pt / 1000, json_encode($conc['sem_identificar'], JSON_UNESCAPED_UNICODE));
