<?php
// Concilia a "Lista de partes por conjunto" (planilhas do Tekla) com o IFC: planejado de cada TAG = MAIOR valor entre os dois, peso unitário da lista.
//   php ferramentas/estrutura_projeto.php --partes galpao.xlsx anexos.xlsx --ifc galpao.ifc anexo1.ifc ... --saida maciel/inc/estrutura_projeto.json [--csv comparacao.csv]
require_once __DIR__ . '/../maciel/inc/estrutura_conciliacao.php';
require_once __DIR__ . '/../maciel/inc/leitura_ifc.php';
require_once __DIR__ . '/../maciel/inc/leitura_pacote.php';

$opc = ['--partes' => [], '--ifc' => [], '--saida' => [], '--csv' => []];
$atual = null;
foreach (array_slice($argv, 1) as $a) {
    if (isset($opc[$a])) { $atual = $a; continue; }
    if ($atual) { $opc[$atual][] = $a; }
}
if (!$opc['--partes']) { fwrite(STDERR, "Informe --partes arquivo.xlsx [...]\n"); exit(1); }
$partes = [];
$fontes = ['lista' => [], 'ifc' => []];
foreach ($opc['--partes'] as $f) {
    $rot = stripos($f, 'ANEXO') !== false ? 'anexos' : (stripos($f, 'GALP') !== false ? 'galpão' : basename($f));
    $n = 0;
    foreach (xlsx_ler($f, 8000, 10) as $a) {
        $r = est_ler_partes($a['linhas'], $rot);
        $partes = array_merge($partes, $r);
        $n += count($r);
    }
    $fontes['lista'][] = ['arquivo' => basename($f), 'conjuntos' => $n, 'escopo' => $rot];
}
$leituras = [];
foreach ($opc['--ifc'] as $f) {
    $leituras[] = ifc_ler_arquivo($f, basename($f));
    $fontes['ifc'][] = ['arquivo' => basename($f)];
}
$mod = $leituras ? leitura_modelo($leituras) : ['conjuntos' => []];
$itens = est_conciliar($partes, $mod['conjuntos']);
$pacote = est_pacote($itens, $fontes);
$pacote['gerado_em'] = (new DateTimeImmutable('now', new DateTimeZone('America/Sao_Paulo')))->format('Y-m-d H:i');
if ($opc['--saida']) {
    file_put_contents($opc['--saida'][0], json_encode($pacote, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
    fwrite(STDERR, "gravado: {$opc['--saida'][0]} (" . count($itens) . " TAGs)\n");
}
if ($opc['--csv']) {
    $c = fopen($opc['--csv'][0], 'w');
    fwrite($c, "\xEF\xBB\xBF");
    fputcsv($c, ['TAG', 'Produto', 'Perfil (1ª parte)', 'Lista', 'IFC', 'Planejado (maior)', 'Origem', 'Peso unit. (kg)', 'Escopo da lista', 'Local (fase do IFC)'], ';');
    foreach ($itens as $i) {
        fputcsv($c, [$i['tag'], $i['produto'], $i['peca'], $i['lista'], $i['ifc'], $i['planejado'], $i['origem'], $i['peso_unit'], $i['fonte'], $i['local']], ';');
    }
}
printf("TAGs: %d · só lista: %d · só IFC: %d · lista maior: %d · IFC maior: %d · iguais: %d\n", count($itens),
    count(array_filter($itens, function ($i) { return $i['origem'] === 'só lista'; })), count(array_filter($itens, function ($i) { return $i['origem'] === 'só IFC'; })),
    count(array_filter($itens, function ($i) { return $i['origem'] === 'lista'; })), count(array_filter($itens, function ($i) { return $i['origem'] === 'IFC'; })),
    count(array_filter($itens, function ($i) { return $i['origem'] === 'igual'; })));
