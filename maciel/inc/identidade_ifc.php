<?php
// Identidade da importação: TAG e local são dados da fonte; GUID identifica a ocorrência.
// Funções puras, também aplicadas aos pacotes recebidos do leitor externo.
function idf_texto($s)
{
    $s = strtr(mb_strtolower((string)$s, 'UTF-8'), ['á'=>'a','à'=>'a','â'=>'a','ã'=>'a','é'=>'e','ê'=>'e','í'=>'i','ó'=>'o','ô'=>'o','õ'=>'o','ú'=>'u','ç'=>'c']);
    return trim(preg_replace('/[^a-z0-9]+/', ' ', $s));
}

function idf_grupo($produto, $local)
{
    return mb_strtoupper(preg_replace('/\s+/u', ' ', trim($produto)), 'UTF-8') . '|' . $local;
}

function idf_material(array $modelo)
{
    $grupos = [];
    $vistos = [];
    foreach ($modelo['conjuntos'] ?? [] as $c) {
        $guid = (string)($c['guid'] ?? '');
        if ($guid === '' || isset($vistos[$guid])) continue;
        $vistos[$guid] = true;
        // Não normalizar caixa, pontuação, zeros à esquerda ou o texto do local.
        $tag = (string)($c['marca'] ?? '');
        $local = (string)($c['fase'] ?? '');
        $k = json_encode([$tag, $local, $c['produto'], $c['perfil'], $c['material'], $c['comprimento_mm'] ?? 0], JSON_UNESCAPED_UNICODE);
        if (!isset($grupos[$k])) {
            $grupos[$k] = ['marca'=>$tag, 'fase'=>$local, 'produto'=>$c['produto'], 'perfil'=>$c['perfil'], 'material'=>$c['material'],
                'qtd'=>0, 'peso_kg'=>0, 'area_m2'=>0, 'comprimento_total_m'=>0, 'guids'=>[]];
        }
        $g = &$grupos[$k];
        $g['qtd']++;
        $g['peso_kg'] += (float)($c['peso_kg'] ?? 0);
        $g['area_m2'] += (float)($c['area_m2'] ?? 0);
        $g['comprimento_total_m'] += (float)($c['comprimento_mm'] ?? 0) / 1000;
        $g['peso_unit_kg'] = $g['peso_kg'] / $g['qtd'];
        $g['guids'][] = $guid;
        unset($g);
    }
    $out = array_values($grupos);
    usort($out, function ($a, $b) { return [$a['fase'],$a['marca'],$a['produto'],$a['perfil']] <=> [$b['fase'],$b['marca'],$b['produto'],$b['perfil']]; });
    return $out;
}

function idf_local_tokens($s)
{
    $s = preg_replace('/^\s*\d+(?:\.\d+)+\s*/', '', (string)$s);
    $s = str_replace(['esm', 'cobertura principal'], ['estrutura metalica', 'galpao'], idf_texto($s));
    $stop = ['estrutura','metalica','cobertura','de','da','do','das','dos','e','em','para'];
    return array_values(array_unique(array_diff(array_map(function ($w) { return rtrim($w, 's'); }, explode(' ', $s)), $stop, [''])));
}

function idf_fases_itens(array $fases, array $itens)
{
    $out = [];
    foreach ($fases as $f) {
        $A = idf_local_tokens($f['fase']);
        $rank = [];
        foreach ($itens as $i) {
            // Uma fase estrutural não pode cair na cobertura financeira só por conter "galpão".
            $estrutural = preg_match('/\b(esm|estrutura)\b/', idf_texto($f['fase']));
            if ($estrutural && preg_match('/\b(telha|telhas|zipada|tp40)\b/', idf_texto($i['descricao']))) continue;
            $B = idf_local_tokens($i['descricao']);
            $numerosA = array_values(array_filter($A, 'ctype_digit'));
            $numerosB = array_values(array_filter($B, 'ctype_digit'));
            if ($numerosA !== $numerosB) continue;
            $comuns = array_intersect($A, $B);
            if (!array_diff($comuns, $numerosA)) continue; // número de item sozinho nunca confirma
            $s = count($comuns) / max(1, count(array_unique(array_merge($A, $B))));
            if ($s >= 0.5) $rank[] = ['codigo'=>$i['codigo'], 'nota'=>$s + (($f['codigo'] ?? '') === $i['codigo'] ? 0.05 : 0)];
        }
        usort($rank, function ($a, $b) { return $b['nota'] <=> $a['nota']; });
        if ($rank && (!isset($rank[1]) || $rank[0]['nota'] - $rank[1]['nota'] >= 0.15)) $out[$f['fase']] = $rank[0]['codigo'];
    }
    return $out;
}

function idf_familia($s)
{
    $s = idf_texto($s);
    // Componentes são distintos: suporte de joist não é joist, travamento não é viga.
    foreach (['contravent'=>'contraventamento','travamento'=>'travamento','espacador'=>'espacador','suporte'=>'suporte','pilarete'=>'pilarete','banzo'=>'banzo','joist'=>'joist','terca'=>'terca','viga'=>'viga','telha'=>'telha','rufo'=>'rufo','escada'=>'escada'] as $rad=>$fam) {
        if (strpos($s, $rad) !== false) return $fam;
    }
    return '';
}

function idf_atividade($produto, array $atividades)
{
    $fam = idf_familia($produto);
    if (!$fam) return null;
    $candidatas = [];
    foreach ($atividades as $a) {
        $txt = idf_texto($a['descricao']);
        $af = idf_familia($txt);
        $pre = strpos($txt, 'montagem') !== false && preg_match('/\bpre\b|premont/', $txt);
        if ($fam === 'banzo' ? ($af !== 'joist' || !$pre) : ($af !== $fam || $pre)) continue;
        if (preg_match('/\b(fabricacao|pintura|transporte|checklist|acabamento|perfilagem)\b/', $txt)) continue;
        $candidatas[] = $a;
    }
    return count($candidatas) === 1 ? $candidatas[0] : null;
}

// Um registro comercial por TAG, mantendo separadamente todas as ocorrências por local.
// Evita duplicar recebimentos globais quando a mesma TAG se repete em duas fases.
function idf_catalogo(array $material)
{
    $out = [];
    foreach ($material as $m) {
        $tag = $m['marca'];
        if (trim($tag) === '') continue;
        if (!isset($out[$tag])) $out[$tag] = ['tag'=>$tag,'produtos'=>[],'locais'=>[],'qtd'=>0,'grupos'=>[], 'especificacoes'=>[]];
        $out[$tag]['produtos'][$m['produto']] = true;
        $out[$tag]['locais'][$m['fase']] = true;
        $out[$tag]['qtd'] += $m['qtd'];
        $out[$tag]['grupos'][] = $m;
        $out[$tag]['especificacoes'][json_encode([$m['perfil'],$m['material']], JSON_UNESCAPED_UNICODE)] = true;
    }
    return $out;
}

function idf_mapa(array $modelo, array $faseItem)
{
    $pecas = [];
    $vistos = [];
    foreach ($modelo['conjuntos'] ?? [] as $c) {
        $guid = (string)($c['guid'] ?? '');
        if ($guid === '' || isset($vistos[$guid])) continue;
        $vistos[$guid] = true;
        $p = $c['pos'] ?? null;
        $xy = $c['xy'] ?? [null, null, null, null];   // posição no plano da malha (mm): início, e vetor até a outra ponta
        $pecas[] = [$c['fase'], $c['produto'], $c['marca'], $p['v'][0] ?? null, $p['v'][1] ?? null, $p['h'][0] ?? null, $p['h'][1] ?? null, $guid,
            idf_grupo($c['produto'], $c['fase']), $xy[0], $xy[1], $xy[2], $xy[3], (int)round($c['comprimento_mm'] ?? 0)];
    }
    $fases = [];
    foreach ($modelo['fases'] as $f) $fases[] = $f + ['item'=>$faseItem[$f['fase']] ?? ''];
    return ['versao'=>2,'malha'=>$modelo['malha'],'fases'=>$fases,'pecas'=>$pecas];
}
