<?php
// Monta o "pacote" da obra a partir do que foi lido dos documentos (mesma estrutura do serviço Python):
// lista de material por fase, fixadores, malha de eixos, cruzamentos (fase do IFC × item do BM) e resumo de telhas.
require_once __DIR__ . '/leitura_ifc.php';
require_once __DIR__ . '/leitura_docs.php';
require_once __DIR__ . '/identidade_ifc.php';

function lp_eixo_ord($a, $b)
{
    return ifc_eixo_num($a) <=> ifc_eixo_num($b) ?: strcmp($a, $b);
}

// $leituras: lista de resultados de ifc_ler_arquivo (na ordem dos arquivos). Conjuntos repetidos (mesmo GUID) contam uma vez.
function leitura_modelo(array $leituras)
{
    $conjuntos = [];
    $vistos = [];
    $dup = 0;
    $eixos = ['V' => [], 'H' => []];
    $arquivos = [];
    $fixTot = [];
    $furos = $falsos = 0;
    foreach ($leituras as $l) {
        $n = 0;
        $nfix = 0;
        foreach (['V', 'H'] as $k) {
            foreach ($l['eixos'][$k] as $e) {
                $eixos[$k][$e] = true;
            }
        }
        foreach ($l['conjuntos'] as $c) {
            if (isset($vistos[$c['guid']])) {
                $dup++;
                continue;
            }
            $vistos[$c['guid']] = true;
            foreach ($c['fix'] as $x) {
                $k = $c['fase'] . "\x01" . $x[0] . "\x01" . $x[1];
                $fixTot[$k] = ($fixTot[$k] ?? 0) + $x[2];
                $nfix++;
            }
            $conjuntos[] = $c;
            $n++;
        }
        $furos += $l['furos'];
        $falsos += $l['falsos'];
        $arquivos[] = ['arquivo' => $l['arquivo'], 'conjuntos' => $n, 'fixadores' => $nfix];
    }
    $avisos = [];
    if ($dup) {
        $avisos[] = "$dup conjunto(s) repetido(s) entre os arquivos (mesmo GUID) foram contados uma só vez.";
    }
    $fases = [];
    $agg = [];
    foreach ($conjuntos as $c) {
        $f = &$fases[$c['fase']];
        $f = $f ?? ['fase' => $c['fase'], 'conjuntos' => 0, 'peso_kg' => 0.0];
        $f['conjuntos']++;
        $f['peso_kg'] += $c['peso_kg'];
        unset($f);
        $k = $c['fase'] . "\x01" . $c['produto'] . "\x01" . $c['perfil'];
        if (!isset($agg[$k])) {
            $agg[$k] = ['fase' => $c['fase'], 'produto' => $c['produto'], 'perfil' => $c['perfil'], 'material' => $c['material'], 'qtd' => 0, 'peso_kg' => 0.0, 'comprimento_mm' => 0.0, 'area_m2' => 0.0];
        }
        $agg[$k]['qtd']++;
        $agg[$k]['peso_kg'] += $c['peso_kg'];
        $agg[$k]['comprimento_mm'] += $c['comprimento_mm'];
        $agg[$k]['area_m2'] += $c['area_m2'];
    }
    foreach ($fases as &$f) {
        list($f['codigo'], $f['titulo']) = ifc_fase_info($f['fase']);
        $f['peso_kg'] = round($f['peso_kg'], 1);
    }
    unset($f);
    $material = array_values($agg);
    foreach ($material as &$m) {
        $m['peso_kg'] = round($m['peso_kg'], 2);
        $m['peso_unit_kg'] = $m['qtd'] ? round($m['peso_kg'] / $m['qtd'], 3) : 0;
        $m['comprimento_total_m'] = round($m['comprimento_mm'] / 1000, 2);
        unset($m['comprimento_mm']);
        $m['area_m2'] = round($m['area_m2'], 2);
    }
    unset($m);
    usort($material, function ($a, $b) {
        $ca = ifc_fase_info($a['fase'])[0];
        $cb = ifc_fase_info($b['fase'])[0];
        $ka = $ca !== '' ? sprintf('%-12s', $ca) : '~' . $a['fase'];
        $kb = $cb !== '' ? sprintf('%-12s', $cb) : '~' . $b['fase'];
        return [$ka, $a['produto'], $a['perfil']] <=> [$kb, $b['produto'], $b['perfil']];
    });
    // O agrupamento comercial nunca pode apagar a marca nem misturar locais.
    $material = idf_material(['conjuntos' => $conjuntos]);
    $fixadores = [];
    ksort($fixTot);
    $parafusos = 0;
    foreach ($fixTot as $k => $q) {
        list($fase, $tipo, $nome) = explode("\x01", $k);
        $fixadores[] = ['fase' => $fase, 'tipo' => $tipo, 'nome' => $nome, 'qtd' => $q, 'chave' => leitura_chave_fixador($nome)];
        if ($tipo === 'parafuso') {
            $parafusos += $q;
        }
    }
    $ev = array_keys($eixos['V']);
    $eh = array_keys($eixos['H']);
    usort($ev, 'lp_eixo_ord');
    usort($eh, 'lp_eixo_ord');
    return ['arquivos' => $arquivos, 'malha' => ['V' => $ev, 'H' => $eh], 'fases' => array_values($fases), 'material' => $material, 'fixadores' => $fixadores,
        'fixadores_resumo' => ['furos_sem_parafuso' => $furos, 'falsos_excluidos' => $falsos], 'conjuntos' => $conjuntos,
        'totais' => ['conjuntos' => count($conjuntos), 'peso_kg' => round(array_sum(array_column($conjuntos, 'peso_kg')), 1), 'sem_posicao' => count(array_filter($conjuntos, function ($c) { return !$c['pos']; })), 'parafusos' => $parafusos],
        'avisos' => $avisos];
}

function lp_nome_fixador($chave)
{
    $t = explode('|', $chave);
    if ($t[0] === 'hardbolt') {
        return "HARDBOLT {$t[1]}X{$t[2]}";
    }
    $frac = function ($v) {
        if ($v === '' || $v === null) {
            return '';
        }
        $x = (float)$v;
        $int = (int)$x;
        $resto = round($x - $int, 3);
        $fr = [0.125 => '1/8', 0.25 => '1/4', 0.375 => '3/8', 0.5 => '1/2', 0.625 => '5/8', 0.75 => '3/4', 0.875 => '7/8'];
        $f = $fr[(string)$resto] ?? ($fr[$resto] ?? '');
        return $int && $f ? "$int $f" : ($f ?: (string)$int);
    };
    $rot = ['parafuso' => 'PARAF.', 'parabolt' => 'PARABOLT', 'ab' => 'PARAF. AB', 'porca' => 'PORCA', 'arruela' => 'ARRUELA'][$t[0]] ?? strtoupper($t[0]);
    $nome = "$rot Ø{$t[1]}\"";
    if (!empty($t[2])) {
        $nome .= ' X ' . $frac($t[2]) . '"';
    }
    if (!empty($t[3])) {
        $nome .= ' ' . str_replace('GR8', 'Gr.8', $t[3]);
    }
    return $nome;
}

function lp_tokens($s)
{
    $s = strtr(mb_strtolower((string)$s, 'UTF-8'), ['á' => 'a', 'à' => 'a', 'â' => 'a', 'ã' => 'a', 'é' => 'e', 'ê' => 'e', 'í' => 'i', 'ó' => 'o', 'ô' => 'o', 'õ' => 'o', 'ú' => 'u', 'ç' => 'c']);
    preg_match_all('/[a-z0-9]+/', $s, $m);
    $par = ['de', 'da', 'do', 'das', 'dos', 'e', 'a', 'o', 'em', 'para', 'com', 'no', 'na', 'nas', 'nos', 'ao', 'instalacao', 'montagem', 'estrutura'];
    return array_values(array_unique(array_filter($m[0], function ($w) use ($par) { return strlen($w) > 1 && !in_array($w, $par, true); })));
}

function lp_similar($a, $b)
{
    $A = lp_tokens($a);
    $B = lp_tokens($b);
    return $A && $B ? count(array_intersect($A, $B)) / count(array_unique(array_merge($A, $B))) : 0.0;
}

// $docs: ['modelo' => ..., 'bm' => ..., 'cronograma' => ..., 'fixadores' => ['geral' => [], 'por_joist' => []], 'projetos' => ...]
function leitura_montar_pacote(array $p, $nomeObra = '')
{
    $modelo = $p['modelo'];
    $bm = $p['bm'];
    $crono = $p['cronograma'];
    $fix = $p['fixadores'];
    $avisos = [];
    $erros = [];
    foreach ([$bm['avisos'] ?? [], $crono['avisos'] ?? [], $fix['avisos'] ?? [], $modelo['avisos'] ?? []] as $a) {
        $avisos = array_merge($avisos, $a);
    }
    // Local e descrição precisam concordar; número repetido não confirma vínculo.
    $itens = [];
    foreach ($bm['itens'] as $i) {
        $itens[$i['codigo']] = $i;
    }
    $faseItem = idf_fases_itens($modelo['fases'], $bm['itens']);
    $semItem = [];
    foreach ($modelo['fases'] as $f) {
        if (!isset($faseItem[$f['fase']])) {
            $semItem[] = $f['fase'];
        }
    }
    $itensSemFase = array_values(array_diff(array_keys($itens), array_values($faseItem)));
    $matPorItem = [];
    foreach ($modelo['material'] as $m) {
        if (isset($faseItem[$m['fase']])) {
            $matPorItem[$faseItem[$m['fase']]][] = array_intersect_key($m, array_flip(['produto', 'perfil', 'qtd', 'peso_kg', 'area_m2', 'comprimento_total_m']));
        }
    }
    $tel = array_values(array_filter($modelo['material'], function ($m) { return stripos($m['produto'], 'TELHA') !== false; }));
    $telhas = ['conjuntos' => array_sum(array_column($tel, 'qtd')), 'area_m2' => round(array_sum(array_column($tel, 'area_m2')), 1),
        'por_produto' => array_map(function ($m) { return array_intersect_key($m, array_flip(['fase', 'produto', 'perfil', 'qtd', 'area_m2', 'comprimento_total_m'])); }, $tel)];
    $ativs = [];
    foreach ($bm['itens'] as $i) {
        foreach ($i['atividades'] as $a) {
            $ativs[] = $a + ['item' => $i['codigo']];
        }
    }
    $lig = [];
    foreach ($crono['atividades'] ?? [] as $t) {
        $melhor = null;
        $nota = 0.0;
        foreach ($ativs as $a) {
            $s = lp_similar($t['nome'], $a['descricao'] . ' ' . $itens[$a['item']]['descricao']);
            if ($s > $nota) {
                $melhor = $a;
                $nota = $s;
            }
        }
        $ok = $melhor && $nota >= 0.45;
        $lig[] = ['tarefa' => $t['nome'], 'atividade' => $ok ? $melhor['descricao'] : '', 'item' => $ok ? $melhor['item'] : '', 'confianca' => round($nota, 2)];
    }
    if ($semItem) {
        $avisos[] = 'Fases do IFC sem item correspondente no BM (ficam sem atividade de medição): ' . implode('; ', array_slice($semItem, 0, 10)) . (count($semItem) > 10 ? '…' : '');
    }
    if ($itensSemFase) {
        $avisos[] = 'Itens do BM sem fase correspondente no IFC: ' . implode(', ', array_slice($itensSemFase, 0, 10));
    }
    // fixadores: IFC × lista em planilha
    $ifc = [];
    foreach ($modelo['fixadores'] as $f) {
        if ($f['chave']) {
            $ifc[$f['chave']] = ($ifc[$f['chave']] ?? 0) + $f['qtd'];
        }
    }
    $lista = [];
    foreach ($fix['geral'] as $f) {
        if ($f['chave']) {
            $lista[$f['chave']] = ($lista[$f['chave']] ?? 0) + $f['qtd'];
        }
    }
    $conf = [];
    $chaves = array_unique(array_merge(array_keys($ifc), array_keys($lista)));
    sort($chaves);
    foreach ($chaves as $k) {
        $conf[] = ['chave' => $k, 'nome' => lp_nome_fixador($k), 'ifc' => $ifc[$k] ?? 0, 'lista' => $lista[$k] ?? 0];
    }
    $dif = count(array_filter($conf, function ($c) { return $c['ifc'] && $c['lista'] && abs($c['ifc'] - $c['lista']) / max($c['ifc'], $c['lista']) > 0.1; }));
    $soIfc = count(array_filter($conf, function ($c) { return $c['ifc'] && !$c['lista']; }));
    if ($dif || $soIfc) {
        $avisos[] = "Fixadores: $dif tipo(s) com quantidade diferente entre o IFC e a lista em planilha e $soIfc só no IFC (a lista em planilha vale onde existe).";
    }
    if (!$modelo['conjuntos']) {
        $erros[] = 'O IFC não trouxe conjuntos (IfcElementAssembly).';
    }
    return ['versao' => 2, 'gerado_em' => (new DateTimeImmutable('now', new DateTimeZone('America/Sao_Paulo')))->format('Y-m-d H:i'), 'obra' => $nomeObra,
        'modelo' => $modelo, 'bm' => $bm, 'cronograma' => $crono, 'fixadores' => $fix, 'fixadores_confronto' => $conf, 'projetos' => $p['projetos'] ?? ['pranchas' => [], 'listas_de_material' => [], 'avisos' => []],
        'cruzamentos' => ['fase_para_item' => (object)$faseItem, 'fases_sem_item' => $semItem, 'itens_sem_fase' => $itensSemFase, 'material_por_item' => (object)$matPorItem, 'telhas' => $telhas,
            'tarefa_para_atividade' => $lig, 'avisos' => []],
        'avisos' => $avisos, 'erros' => $erros];
}
