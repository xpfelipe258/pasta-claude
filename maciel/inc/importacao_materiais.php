<?php
// Cadastro de materiais, vínculos e baixa automática da obra importada (IFC Tekla).
//   TAG = marca do conjunto no Tekla (a mesma dos desenhos e da lista de material); local = fase do IFC.
//   Só os fixadores ganham TAG nova por obra (FG###). Peça sem marca definida no modelo ("nd123") recebe uma TAG gerada, avisada no relatório.
//   Cada grupo (produto + local) é ligado sozinho a uma atividade do catálogo do BM; a baixa é a quantidade da TAG no local ÷ quantidade da atividade × produção lançada.

function imp_sem_acento($s)
{
    return strtr(mb_strtoupper((string)$s, 'UTF-8'), ['Á' => 'A', 'À' => 'A', 'Â' => 'A', 'Ã' => 'A', 'É' => 'E', 'Ê' => 'E', 'Í' => 'I', 'Ó' => 'O', 'Ô' => 'O', 'Õ' => 'O', 'Ú' => 'U', 'Ç' => 'C']);
}

// Marca do Tekla sem o "(?)" de numeração incerta; vazio quando o modelo não numerou o conjunto (nd123).
function imp_marca_limpa($marca)
{
    $m = trim(preg_replace('/\(\?\)\s*$/', '', trim((string)$marca)));
    return preg_match('/^(nd\d*)?$/i', $m) ? '' : $m;
}

function imp_eh_fixador_conjunto($produto, $fase)
{
    return imp_tipo_material($produto, $fase) === 'FIXADOR';
}

function imp_codigo_fase($fase)
{
    return preg_match('/^\s*(\d+(?:\.\d+)+)/', (string)$fase, $m) ? $m[1] : '';
}

// Chave da atividade usada nas telas (Vínculos e baixa): o código sem o prefixo EJ-/CMM- (igual a vcChaveAtiv em vinculos.js).
function imp_chave_atividade($codigo)
{
    return preg_replace('/^(EJ|CMM)-/', '', (string)$codigo);
}

/**
 * Agrupa os conjuntos do IFC em linhas do cadastro: uma TAG por marca + fase (+ perfil). Fixadores ficam de fora (têm TAG por obra).
 * Devolve ['linhas' => [tag => linha], 'guid_tag' => [guid => tag], 'fixadores' => [conjuntos fixadores], 'indefinidas' => n, 'repetidas' => [...]].
 */
function imp_agrupar_pecas(array $conjuntos)
{
    $grupos = [];
    $fixadores = [];
    foreach ($conjuntos as $c) {
        if (imp_eh_fixador_conjunto($c['produto'], $c['fase'])) {
            $fixadores[] = $c;
            continue;
        }
        $local = $c['fase'] !== '' ? $c['fase'] : 'Sem fase';
        $marca = imp_marca_limpa($c['marca']);
        $k = $marca !== '' ? "M\x01$local\x01$marca\x01{$c['perfil']}" : "N\x01$local\x01" . imp_up($c['produto']) . "\x01{$c['perfil']}";
        if (!isset($grupos[$k])) {
            $grupos[$k] = ['marca' => $marca, 'local' => $local, 'fase' => $c['fase'], 'perfil' => $c['perfil'], 'material' => $c['material'], 'produtos' => [], 'qtd' => 0, 'peso_kg' => 0.0,
                'comprimento_mm' => 0.0, 'area_m2' => 0.0, 'guids' => []];
        }
        $g = &$grupos[$k];
        $g['produtos'][$c['produto']] = ($g['produtos'][$c['produto']] ?? 0) + 1;
        $g['qtd']++;
        $g['peso_kg'] += (float)$c['peso_kg'];
        $g['comprimento_mm'] += (float)$c['comprimento_mm'];
        $g['area_m2'] += (float)$c['area_m2'];
        if (!empty($c['guid'])) {
            $g['guids'][] = $c['guid'];
        }
        unset($g);
    }
    foreach ($grupos as &$g) {
        arsort($g['produtos']);
        $g['produto'] = (string)array_key_first($g['produtos']);
    }
    unset($g);
    // ordem estável: fase, produto, marca
    uasort($grupos, function ($a, $b) {
        return [imp_codigo_fase($a['fase']) === '' ? '~' . $a['local'] : sprintf('%-12s', imp_codigo_fase($a['fase'])), $a['produto'], $a['marca'], $a['perfil']]
            <=> [imp_codigo_fase($b['fase']) === '' ? '~' . $b['local'] : sprintf('%-12s', imp_codigo_fase($b['fase'])), $b['produto'], $b['marca'], $b['perfil']];
    });
    // marca em mais de um lugar: quem tem mais peças fica com a marca pura; os demais levam o código da fase (ou -2, -3 na mesma fase)
    $porMarca = [];
    foreach ($grupos as $k => $g) {
        if ($g['marca'] !== '') {
            $porMarca[$g['marca']][] = $k;
        }
    }
    $usadas = [];
    $tagDe = [];
    $repetidas = [];
    foreach ($porMarca as $marca => $ks) {
        usort($ks, function ($a, $b) use ($grupos) { return $grupos[$b]['qtd'] <=> $grupos[$a]['qtd']; });
        foreach ($ks as $i => $k) {
            $tag = $marca;
            if ($i > 0) {
                $cod = imp_codigo_fase($grupos[$k]['fase']);
                $tag = $marca . '-' . ($cod !== '' ? $cod : substr(preg_replace('/[^A-Z0-9]/', '', imp_sem_acento($grupos[$k]['local'])), 0, 6));
                $n = 1;
                $base = $tag;
                while (isset($usadas[imp_up($tag)])) {
                    $tag = $base . '-' . (++$n);
                }
                $repetidas[] = ['marca' => $marca, 'tag' => $tag, 'local' => $grupos[$k]['local']];
            }
            $usadas[imp_up($tag)] = true;
            $tagDe[$k] = $tag;
        }
    }
    // peças sem marca definida: TAG gerada pelo produto (prefixo + número), sem repetir marca real
    $contadores = [];
    $indef = 0;
    foreach ($grupos as $k => $g) {
        if ($g['marca'] !== '') {
            continue;
        }
        $pref = imp_prefixo($g['produto']);
        do {
            $contadores[$pref] = ($contadores[$pref] ?? 0) + 1;
            $tag = $pref . sprintf('%03d', $contadores[$pref]);
        } while (isset($usadas[imp_up($tag)]));
        $usadas[imp_up($tag)] = true;
        $tagDe[$k] = $tag;
        $indef++;
    }
    $linhas = [];
    $guidTag = [];
    foreach ($grupos as $k => $g) {
        $tag = $tagDe[$k];
        $g['tag'] = $tag;
        $g['indefinida'] = $g['marca'] === '';
        $linhas[$tag] = $g;
        foreach ($g['guids'] as $gu) {
            $guidTag[$gu] = $tag;
        }
    }
    return ['linhas' => $linhas, 'guid_tag' => $guidTag, 'fixadores' => $fixadores, 'indefinidas' => $indef, 'repetidas' => $repetidas];
}

// ------------------------------------------------------------------ vínculo automático peça × atividade do BM

// produto (sem acento) → atividade do item (texto procurado, em ordem de preferência)
function imp_regras_atividade()
{
    return [
        ['/^(BANZO|DIAGONAL)\b|^TRAVAMENTO (DE )?JOIST/', ['PRE.?MONTAGEM']],
        ['/JOIST/', ['INSTALACAO DE JOIST', 'JOIST']],
        ['/PILARETE|^PILAR\b|PILAR /', ['PILARETE']],
        ['/VIGA/', ['VIGA']],
        ['/ESPACADOR/', ['ESPACADOR']],
        ['/SUPORTE (DE )?TERCA|SUPORTE FECH|^SUPORTE\b/', ['SUPORTE']],
        ['/TERCA|FRECHAL|TIRANTE DE TERCA/', ['TERCA']],
        ['/CONTRAVENT|TIRANTE|MAO FRANCESA/', ['CONTRAVENT']],
        ['/RUFO|TESTEIRA|ARREMATE|PLATIBANDA/', ['RUFO']],
        ['/CALHA/', ['CALHA', 'INSTALACAO']],
        ['/TELHA/', ['TELHA']],
        ['/ESCADA|DEGRAU|PATAMAR|GUARDA CORPO|^ARO\b|CANTONEIRA_BASE|SP ESCADA/', ['ESCADA', 'INSTALACAO']],
    ];
}

/**
 * Escolhe a atividade de um item do BM para um produto. Devolve [atividade|null, confianca] (confianca: 'regra', 'nome', 'item').
 * $ativs: [{codigo, descricao, ...}] do item.
 */
function imp_escolher_atividade($produto, array $ativs)
{
    if (!$ativs) {
        return [null, ''];
    }
    $p = imp_sem_acento($produto);
    // Regra do sistema: telha nunca cai numa atividade de estrutura (terça, espaçador, suporte...). A estrutura do fechamento lateral só
    // tem terças e espaçadores; a telha é da empresa de cobertura/fechamento e se aponta na atividade de telhas dela. Sem atividade de telha no item, fica "sem par".
    if (preg_match('/TELHA/', $p)) {
        foreach ($ativs as $a) {
            if (preg_match('/TELHA/', imp_sem_acento($a['descricao']))) {
                return [$a, 'regra'];
            }
        }
        return [null, ''];
    }
    foreach (imp_regras_atividade() as list($re, $buscas)) {
        if (!preg_match($re, $p)) {
            continue;
        }
        foreach ($buscas as $b) {
            foreach ($ativs as $a) {
                if (preg_match('/' . $b . '/', imp_sem_acento($a['descricao']))) {
                    return [$a, 'regra'];
                }
            }
        }
    }
    $melhor = null;
    $nota = 0.0;
    foreach ($ativs as $a) {
        $s = imp_similar($produto, $a['descricao']);
        if ($s > $nota) {
            $melhor = $a;
            $nota = $s;
        }
    }
    if ($melhor !== null && $nota >= 0.3) {
        return [$melhor, 'nome'];
    }
    if (count($ativs) === 1) {
        return [$ativs[0], 'item'];
    }
    foreach ($ativs as $a) {   // sem pista: a primeira atividade de execução (não acabamento, checklist, perfilagem...)
        if (!preg_match('/ACABAMENTO|CHECKLIST|PERFILAGEM|ZIPAGEM|COSTURA/', imp_sem_acento($a['descricao']))) {
            return [$a, 'item'];
        }
    }
    return [null, ''];
}

// Item do BM que mais combina com um texto (fase + produto): fração das palavras do texto que aparecem no item e nas suas atividades.
// $prefixo limita a itens da mesma seção (ex.: "3.2."); $minimo = fração mínima de palavras encontradas.
function imp_item_por_nome($texto, array $itens, $minimo = 0.5, $prefixo = '')
{
    $sin = ['FECH' => 'FECHAMENTO', 'ESM' => '', 'ESTRUTURA' => '', 'METALICA' => '', 'COB' => 'COBERTURA', 'JOISTS' => 'JOIST', 'TELHAS' => 'TELHA'];
    $t = preg_replace('/[^A-Z0-9 ]/', ' ', imp_sem_acento($texto));
    foreach ($sin as $de => $para) {
        $t = preg_replace('/\b' . $de . '\b/', $para, $t);
    }
    $A = imp_tokens($t);
    if (!$A) {
        return '';
    }
    $rad = function ($w) { return rtrim($w, 's'); };
    $A = array_map($rad, $A);
    $melhor = '';
    $nota = [0.0, 0.0];
    foreach ($itens as $codigo => $desc) {
        if ($prefixo !== '' && strpos($codigo, $prefixo) !== 0) {
            continue;
        }
        $B = array_map($rad, imp_tokens($desc));
        $inter = count(array_intersect($A, $B));
        $s = [$inter / count($A), $inter / max(1, count(array_unique(array_merge($A, $B))))];
        if ($s > $nota) {
            $melhor = $codigo;
            $nota = $s;
        }
    }
    return $nota[0] >= $minimo ? $melhor : '';
}

/**
 * Liga cada grupo (produto + local) a uma atividade. $faseItem: fase → item; $bm: itens do BM; $atividadesPorItem: item → [{codigo, descricao, qtd, controle...}].
 * Devolve ['vinculos' => [chave => decisão], 'grupo_atividade' => [chave => atividade], 'sem_vinculo' => [...], 'item_da_fase' => [fase => item]].
 */
function imp_vincular(array $linhas, array $faseItem, array $bmItens, array $atividadesPorItem, $agora)
{
    $itens = [];
    foreach ($bmItens as $bi) {
        $itens[$bi['codigo']] = $bi['descricao'] . ' ' . implode(' ', array_column($atividadesPorItem[$bi['codigo']] ?? [], 'descricao'));   // o item e suas atividades (ex.: "joist" só aparece nas atividades)
    }
    $descItem = [];
    foreach ($bmItens as $bi) {
        $descItem[$bi['codigo']] = $bi['descricao'];
    }
    $grupos = [];
    foreach ($linhas as $l) {
        $chave = imp_up($l['produto']) . '|' . $l['local'];
        if (!isset($grupos[$chave])) {
            $grupos[$chave] = ['chave' => $chave, 'produto' => $l['produto'], 'local' => $l['local'], 'fase' => $l['fase'], 'tags' => [], 'qtd' => 0];
        }
        $grupos[$chave]['tags'][$l['tag']] = $l['qtd'];
        $grupos[$chave]['qtd'] += $l['qtd'];
    }
    $vinc = [];
    $grupoAtiv = [];
    $sem = [];
    $itemPorTitulo = [];
    $itemFase = $faseItem;
    foreach ($grupos as $chave => $g) {
        $item = $faseItem[$g['fase']] ?? '';
        $porNome = false;
        if ($item !== '' && imp_similar(imp_titulo_fase($g['fase']), $descItem[$item] ?? '') == 0.0) {   // o número da fase coincide com o do BM, mas os nomes não têm nada em comum (ex.: 3.2.8 Linha de vida × 3.2.8 Calhas)
            $alt = imp_item_por_nome(imp_titulo_fase($g['fase']), $descItem, 0.66, preg_replace('/\d+$/', '', $item));
            if ($alt !== '' && $alt !== $item) {
                $item = $alt;
                $porNome = true;
            }
        }
        if ($item === '') {   // fase sem número: o item que combina com o nome da fase + produto; sem pista no produto, só com o nome da fase
            $item = imp_item_por_nome(imp_titulo_fase($g['fase']) . ' ' . $g['produto'], $itens);
            if ($item === '') {
                if (!array_key_exists($g['fase'], $itemPorTitulo)) {
                    $itemPorTitulo[$g['fase']] = imp_item_por_nome(imp_titulo_fase($g['fase']), $itens);
                }
                $item = $itemPorTitulo[$g['fase']];
            }
            $porNome = $item !== '';
        }
        $ativs = $item !== '' ? ($atividadesPorItem[$item] ?? []) : [];
        list($a, $conf) = imp_escolher_atividade($g['produto'], $ativs);
        if ($a === null) {
            $sem[] = ['produto' => $g['produto'], 'local' => $g['local'], 'pecas' => $g['qtd'], 'motivo' => $item === '' ? 'a fase não corresponde a nenhum item do BM' : 'o item ' . $item . ' não tem atividade para este produto'];
            continue;
        }
        $aprox = $porNome || $conf === 'item';
        $vinc[$chave] = ['estado' => 'confirmado', 'atividade' => imp_chave_atividade($a['codigo']), 'familia' => $g['produto'], 'produto' => $g['produto'], 'local' => $g['local'],
            'por' => 'Importação automática' . ($aprox ? ' (aproximado — conferir)' : ''), 'em' => $agora];
        $grupoAtiv[$chave] = $a + ['item' => $item, 'aproximado' => $aprox, 'tags' => $g['tags'], 'produto' => $g['produto'], 'local' => $g['local']];
        if (!isset($itemFase[$g['fase']]) || $itemFase[$g['fase']] === '') {
            $itemFase[$g['fase']] = $item;   // a fase (sem número) passa a mostrar as atividades do item no mapa
        }
    }
    return ['vinculos' => $vinc, 'grupo_atividade' => $grupoAtiv, 'sem_vinculo' => $sem, 'item_da_fase' => $itemFase];
}

// Baixa automática das peças: cada TAG, no seu local, baixa (quantidade ÷ quantidade da atividade) por unidade produzida na atividade.
function imp_baixa_pecas(array $grupoAtiv)
{
    $out = [];
    foreach ($grupoAtiv as $chave => $g) {
        $qa = (float)($g['qtd'] ?? 0);
        if ($qa <= 0) {
            continue;
        }
        $k = imp_chave_atividade($g['codigo']);
        foreach ($g['tags'] as $tag => $q) {
            $out[$k]['itens'][] = ['codigo' => $tag, 'local' => $g['local'], 'descricao' => $g['produto'], 'por_unidade' => round($q / $qa, 6), 'quantidade' => $q];
        }
        $out[$k]['descricao'] = ($out[$k]['descricao'] ?? '') ?: 'Baixa automática gerada da importação: quantidade da TAG no local ÷ quantidade da atividade do BM × produção lançada (limitada ao planejado).';
        $out[$k]['atividade'] = $g['descricao'];
    }
    return $out;
}

// Parafusos, arruelas e porcas de cada atividade: os do IFC que ficam nas peças ligadas a ela (por unidade da atividade).
function imp_baixa_fixadores(array $conjuntos, array $guidTag, array $tagGrupo, array $grupoAtiv, array $tagFix, $agora)
{
    $soma = [];   // chaveAtiv => tag FG => quantidade
    foreach ($conjuntos as $c) {
        if (empty($c['fix']) || empty($c['guid']) || !isset($guidTag[$c['guid']])) {
            continue;
        }
        $g = $tagGrupo[$guidTag[$c['guid']]] ?? '';
        if ($g === '' || !isset($grupoAtiv[$g])) {
            continue;
        }
        $k = imp_chave_atividade($grupoAtiv[$g]['codigo']);
        foreach ($c['fix'] as $x) {
            $tag = $tagFix[leitura_chave_fixador($x[1])] ?? '';
            if ($tag !== '') {
                $soma[$k][$tag] = ($soma[$k][$tag] ?? 0) + (int)$x[2];
            }
        }
    }
    $qtdAtiv = [];
    foreach ($grupoAtiv as $g) {
        $qtdAtiv[imp_chave_atividade($g['codigo'])] = (float)$g['qtd'];
    }
    $out = [];
    foreach ($soma as $k => $tags) {
        if (($qtdAtiv[$k] ?? 0) <= 0) {
            continue;
        }
        ksort($tags);
        $linhas = [];
        foreach ($tags as $tag => $q) {
            $linhas[] = ['tag' => $tag, 'por_unidade' => round($q / $qtdAtiv[$k], 6)];
        }
        $out[$k] = ['linhas' => $linhas, 'por' => 'Importação automática (IFC)', 'em' => $agora];
    }
    return $out;
}
