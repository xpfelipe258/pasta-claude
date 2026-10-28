<?php
// Fixadores do projeto: LISTA em planilha × IFC.
//   REGRA DO SISTEMA: o planejado de cada fixador é o MAIOR valor entre a lista e o IFC (nunca a soma, nunca só a lista).
//   O peso unitário vem da lista (peso total ÷ quantidade, mais preciso que a coluna arredondada em 2 casas); onde a lista não traz peso
//   (A307 sai 0,00 em várias linhas) vale o da mesma bitola em outra norma e, por último, o do IFC.
// Usado pela importação de obra nova (importacao_leitura.php) e pela ferramenta ferramentas/fixadores_projeto.php (obra 198).
require_once __DIR__ . '/leitura_util.php';
require_once __DIR__ . '/leitura_docs.php';

// 1.75 -> "1 3/4" (o mesmo texto que o navegador monta para o comprimento: vcFrac em vinculos.js)
function fxc_frac_txt($v)
{
    $v = round((float)$v * 16) / 16;
    $int = (int)floor($v + 1e-9);
    $resto = (int)round(($v - $int) * 16);
    if ($resto === 0) {
        return (string)$int;
    }
    $a = $resto;
    $b = 16;
    while ($a % 2 === 0 && $b % 2 === 0) {
        $a /= 2;
        $b /= 2;
    }
    return ($int ? "$int " : '') . "$a/$b";
}

// Identifica o fixador a partir da descrição da lista ou do nome no IFC. Devolve null quando não é um fixador conhecido.
//   chave = mesma de leitura_chave_fixador (tipo|diâmetro|comprimento|norma); k = chave que o navegador usa para achar a TAG do cadastro.
function fxc_ident($descricao, $norma = '')
{
    $chave = leitura_chave_fixador($descricao, $norma);
    if ($chave === '') {
        return null;
    }
    list($tipo, $a, $b, $n) = array_pad(explode('|', $chave), 4, '');
    $nm = $n === 'GR8' ? 'GR.8' : $n;
    $info = ['chave' => $chave, 'tipo' => $tipo, 'norma' => $n, 'diametro' => $a, 'comp' => $b];
    switch ($tipo) {
        case 'parafuso':
            $c = $b !== '' ? ' X ' . fxc_frac_txt($b) . '"' : '';
            return $info + ['kind' => 'parafuso', 'k' => "P|$a|" . ($b !== '' ? fxc_frac_txt($b) : ''), 'nome' => "PARAF. Ø$a\"$c" . ($nm ? " $nm" : '')];
        case 'ab':
            return $info + ['kind' => 'parafuso', 'k' => "AB|$a|" . fxc_frac_txt($b), 'nome' => "PARAF. AB Ø$a\" X " . fxc_frac_txt($b) . '"'];
        case 'parabolt':
            return $info + ['kind' => 'parafuso', 'k' => "PB|$a|" . fxc_frac_txt($b), 'nome' => "PARABOLT Ø$a\" X " . fxc_frac_txt($b) . '"'];
        case 'cbq':
            return $info + ['kind' => 'parafuso', 'k' => "CBQ|$a|" . fxc_frac_txt($b), 'nome' => "CBQ Ø$a\" X " . fxc_frac_txt($b) . '"'];
        case 'olhal':
            return $info + ['kind' => 'parafuso', 'k' => "OL|$a|$b", 'nome' => "PARAF. OLHAL Ø$a\" X {$b}F"];
        case 'hardbolt':
            return $info + ['kind' => 'parafuso', 'k' => "HB|$a|$b", 'nome' => "HARDBOLT $a X $b"];
        case 'autobrocante':
            return $info + ['kind' => 'parafuso', 'k' => 'AUT', 'nome' => 'AUTOBROCANTE'];
        case 'arruela':
            return $info + ['kind' => 'arruela', 'k' => "ARRUELA|$a", 'nome' => "ARRUELA Ø$a\""];
        case 'porca':
            return $info + ['kind' => 'porca', 'k' => "PORCA|$a", 'nome' => "PORCA Ø$a\""];
    }
    return null;
}

// Linhas do IFC (formato da conciliação) a partir dos conjuntos que SÃO fixadores no modelo do Tekla (porca, arruela e parafuso olhal
// modelados como conjunto, sem "fix" dentro): ['descricao' => perfil, 'norma' => material, 'qtd' => 1, 'peso_unit_kg' => peso, 'fonte' => ...].
function fxc_ifc_de_conjuntos(array $conjuntos, $fonte = 'IFC')
{
    $linhas = [];
    foreach ($conjuntos as $c) {
        $prod = mb_strtoupper(lt_texto($c['produto'] ?? ''), 'UTF-8');
        if (!preg_match('/^(PORCA|ARRUELA|PARAF\.?\s+OLHAL)/u', $prod)) {
            continue;
        }
        $desc = strpos($prod, 'OLHAL') !== false ? $prod : lt_texto($c['perfil'] ?? $prod);
        $linhas[] = ['descricao' => $desc, 'norma' => lt_texto($c['material'] ?? ''), 'qtd' => 1, 'peso_unit_kg' => (float)($c['peso_kg'] ?? 0), 'fonte' => $fonte];
    }
    return $linhas;
}

// Linhas do IFC a partir dos parafusos/porcas/arruelas que o modelo traz dentro dos conjuntos (leitura_modelo()['fixadores']).
function fxc_ifc_de_modelo(array $fixadoresModelo, $fonte = 'IFC')
{
    $linhas = [];
    foreach ($fixadoresModelo as $f) {
        $linhas[] = ['descricao' => $f['nome'], 'norma' => '', 'qtd' => (float)$f['qtd'], 'peso_unit_kg' => 0.0, 'fonte' => $f['fase'] !== '' ? $f['fase'] : $fonte];
    }
    return $linhas;
}

/**
 * Concilia a lista com o IFC.
 *   $lista: linhas da lista em planilha  ['descricao', 'norma', 'qtd', 'peso_unit_kg', 'peso_total_kg', 'fonte', 'escopo', 'mult' (opcional: joists)]
 *   $ifc:   linhas do IFC                ['descricao', 'norma', 'qtd', 'peso_unit_kg' (opcional), 'fonte']
 * Devolve ['itens' => [chave => item], 'sem_identificar' => [...descrições que não viraram fixador]].
 * item = ['chave','k','kind','tipo','nome','norma','diametro','comp','lista','ifc','planejado','origem','peso_unit','peso_fonte','por_escopo','por_fonte_ifc']
 */
function fxc_conciliar(array $lista, array $ifc)
{
    $itens = [];
    $semId = [];
    $pesoL = [];   // chave => [Σ peso total, Σ qtd com peso]
    $pesoI = [];
    $novo = function ($id) {
        return $id + ['lista' => 0.0, 'ifc' => 0.0, 'planejado' => 0.0, 'origem' => '', 'peso_unit' => 0.0, 'peso_fonte' => '', 'por_escopo' => [], 'por_fonte_ifc' => []];
    };
    foreach ($lista as $x) {
        $id = fxc_ident($x['descricao'], $x['norma'] ?? '');
        if (!$id) {
            $semId[$x['descricao']] = ($semId[$x['descricao']] ?? 0) + (float)$x['qtd'];
            continue;
        }
        $mult = (float)($x['mult'] ?? 1) ?: 1.0;
        $q = (float)$x['qtd'] * $mult;
        $c = $id['chave'];
        $itens[$c] = $itens[$c] ?? $novo($id);
        $itens[$c]['lista'] += $q;
        $esc = ($x['escopo'] ?? '') !== '' ? $x['escopo'] : ($x['fonte'] ?? 'lista');
        $itens[$c]['por_escopo'][$esc] = ($itens[$c]['por_escopo'][$esc] ?? 0) + $q;
        $pt = (float)($x['peso_total_kg'] ?? 0) * $mult;
        $pu = (float)($x['peso_unit_kg'] ?? 0);
        if ($pt > 0 && $q > 0) {
            $pesoL[$c][0] = ($pesoL[$c][0] ?? 0) + $pt;
            $pesoL[$c][1] = ($pesoL[$c][1] ?? 0) + $q;
        } elseif ($pu > 0 && $q > 0) {
            $pesoL[$c][0] = ($pesoL[$c][0] ?? 0) + $pu * $q;
            $pesoL[$c][1] = ($pesoL[$c][1] ?? 0) + $q;
        }
    }
    foreach ($ifc as $x) {
        $id = fxc_ident($x['descricao'], $x['norma'] ?? '');
        if (!$id) {
            continue;
        }
        $c = $id['chave'];
        $itens[$c] = $itens[$c] ?? $novo($id);
        $q = (float)$x['qtd'];
        $itens[$c]['ifc'] += $q;
        $f = $x['fonte'] ?? 'IFC';
        $itens[$c]['por_fonte_ifc'][$f] = ($itens[$c]['por_fonte_ifc'][$f] ?? 0) + $q;
        $pu = (float)($x['peso_unit_kg'] ?? 0);
        if ($pu > 0 && $q > 0) {
            $pesoI[$c][0] = ($pesoI[$c][0] ?? 0) + $pu * $q;
            $pesoI[$c][1] = ($pesoI[$c][1] ?? 0) + $q;
        }
    }
    // peso da mesma bitola (tipo + diâmetro + comprimento) em outra norma: a lista traz 0,00 para várias linhas A307
    $porBitola = [];
    foreach ($itens as $c => $it) {
        if (!empty($pesoL[$c][1])) {
            $b = $it['tipo'] . '|' . $it['diametro'] . '|' . $it['comp'];
            $porBitola[$b][0] = ($porBitola[$b][0] ?? 0) + $pesoL[$c][0];
            $porBitola[$b][1] = ($porBitola[$b][1] ?? 0) + $pesoL[$c][1];
        }
    }
    foreach ($itens as $c => &$it) {
        $it['lista'] = round($it['lista'], 3);
        $it['ifc'] = round($it['ifc'], 3);
        $it['planejado'] = max($it['lista'], $it['ifc']);
        $it['origem'] = $it['lista'] > 0 && $it['ifc'] > 0
            ? ($it['lista'] > $it['ifc'] ? 'lista' : ($it['ifc'] > $it['lista'] ? 'IFC' : 'igual'))
            : ($it['lista'] > 0 ? 'só lista' : 'só IFC');
        $b = $it['tipo'] . '|' . $it['diametro'] . '|' . $it['comp'];
        if (!empty($pesoL[$c][1])) {
            $it['peso_unit'] = round($pesoL[$c][0] / $pesoL[$c][1], 4);
            $it['peso_fonte'] = 'lista';
        } elseif (!empty($porBitola[$b][1])) {
            $it['peso_unit'] = round($porBitola[$b][0] / $porBitola[$b][1], 4);
            $it['peso_fonte'] = 'mesma bitola em outra norma';
        } elseif (!empty($pesoI[$c][1])) {
            $it['peso_unit'] = round($pesoI[$c][0] / $pesoI[$c][1], 4);
            $it['peso_fonte'] = 'IFC';
        }
        $it['por_escopo'] = array_map(function ($v) { return round($v, 3); }, $it['por_escopo']);
        arsort($it['por_escopo']);
    }
    unset($it);
    uasort($itens, function ($a, $b) {
        return [$a['kind'], $a['diametro'], (float)$a['comp'], $a['nome']] <=> [$b['kind'], $b['diametro'], (float)$b['comp'], $b['nome']];
    });
    return ['itens' => $itens, 'sem_identificar' => $semId];
}

// Resultado que a obra guarda (obra_config.fixadores_projeto) e o navegador lê (M.estoque_ifc.fixadores_projeto).
function fxc_pacote(array $conc, array $fontes)
{
    $itens = [];
    foreach ($conc['itens'] as $it) {
        $itens[] = ['chave' => $it['chave'], 'k' => $it['k'], 'kind' => $it['kind'], 'tipo' => $it['tipo'], 'nome' => $it['nome'], 'norma' => $it['norma'] === 'GR8' ? 'GR.8' : $it['norma'],
            'diametro' => $it['diametro'], 'comp' => $it['comp'], 'lista' => $it['lista'], 'ifc' => $it['ifc'], 'planejado' => $it['planejado'], 'origem' => $it['origem'],
            'peso_unit' => $it['peso_unit'], 'peso_fonte' => $it['peso_fonte'], 'por_escopo' => $it['por_escopo'], 'por_fonte_ifc' => $it['por_fonte_ifc']];
    }
    return ['versao' => 1, 'regra' => 'planejado = maior valor entre a lista em planilha e o IFC', 'fontes' => $fontes, 'itens' => $itens, 'sem_identificar' => $conc['sem_identificar']];
}

// ---------------------------------------------------------------- aplicação ao cadastro (mesma regra do navegador: vcAplicarProjeto em vinculos.js)
// Chave do item do cadastro de Materiais (produto/material) no mesmo formato de fxc_ident()['k'].
function fxc_vcfrac($x)
{
    return trim(preg_replace('/\s+/', ' ', str_replace(['"', 'Ø', '.'], ' ', (string)$x)));
}

function fxc_chave_cad($produto, $material)
{
    foreach ([$produto, $material] as $txt) {
        $t = mb_strtoupper(trim(lt_texto($txt)), 'UTF-8');
        if (preg_match('/^HARD[O]?BOLT\s*M(\d+)\s*X\s*(\d+)/u', $t, $r)) { return ["HB|M{$r[1]}|{$r[2]}", '']; }
        if (strpos($t, 'AUTOBROC') === 0 || strpos($t, 'PF AB PONTA') === 0) { return ['AUT', '']; }
        if (preg_match('/OLHAL\s*Ø?\s*(\d+\/\d+)\W*[X×]?\s*(\d+)\s*F/u', $t, $r)) { return ["OL|{$r[1]}|{$r[2]}", '']; }
        if (preg_match('/^CBQ\s*Ø?(\d+\/\d+)"\s*X\s*([\d\/ ]+)"/u', $t, $r)) { return ["CBQ|{$r[1]}|" . fxc_vcfrac($r[2]), '']; }
        if (preg_match('/^PARAF\. AB Ø?(\d+\/\d+)" X ([\d\/ ]+)"/u', $t, $r)) { return ["AB|{$r[1]}|" . fxc_vcfrac($r[2]), '']; }
        if (preg_match('/^PARABOLT Ø?(\d+\/\d+)" X ([\d\/ ]+)"/u', $t, $r)) { return ["PB|{$r[1]}|" . fxc_vcfrac($r[2]), '']; }
        if (preg_match('/^PARAF\. Ø?(\d+\/\d+)" X ([\d\/ ]+)"\s*(A\d+N?|GR\.8)?/u', $t, $r)) {
            $mt = mb_strtoupper(trim(lt_texto($material)), 'UTF-8');
            $n = $r[3] ?? '';
            if ($n === '') { $n = strpos($mt, 'GR.8') !== false ? 'GR.8' : (preg_match('/A\d+/', $mt, $mm) ? $mm[0] : ''); }
            return ["P|{$r[1]}|" . fxc_vcfrac($r[2]), preg_replace('/N$/', '', $n)];
        }
        if (preg_match('/^(ARRUELA|PORCA) Ø?(\d+\/\d+|\d+)"/u', $t, $r)) { return ["{$r[1]}|{$r[2]}", '']; }
    }
    return ['', ''];
}

/** TAGs do cadastro que recebem o planejado do projeto: fixadores (tipo_material FIXADOR) e olhais, cadastrados como estrutural. */
function fxc_cadastro_chaves(array $materiais)
{
    $cad = [];
    foreach ($materiais as $i => $m) {
        if (!is_array($m)) { continue; }
        list($k, $n) = fxc_chave_cad($m['produto'] ?? '', $m['material'] ?? '');
        $fix = strtoupper(trim((string)($m['tipo_material'] ?? ''))) === 'FIXADOR' || strpos($k, 'OL|') === 0;   // olhal é cadastrado como estrutural
        if ($k !== '' && $fix) { $cad[] = ['i' => $i, 'k' => $k, 'n' => $n]; }
    }
    return $cad;
}

/** Mesma escolha de vcAcharProjeto (vinculos.js): um só TAG para a bitola recebe todas as normas; com mais de um vale a norma igual ou o TAG sem norma. */
function fxc_achar_tag(array $it, array $cad)
{
    $iguais = array_values(array_filter($cad, function ($c) use ($it) { return $c['k'] === $it['k']; }));
    if (!$iguais) { return null; }
    if (count($iguais) === 1) { return $iguais[0]; }
    foreach ($iguais as $c) { if ($c['n'] === $it['norma']) { return $c; } }
    foreach ($iguais as $c) { if ($c['n'] === '') { return $c; } }
    return null;
}

/** Itens de fixador do projeto que ainda não têm TAG no cadastro (os que o botão "Criar TAG(s) que faltam" cadastra). */
function fxc_sem_tag(array $materiais, $projeto)
{
    if (!is_array($projeto) || empty($projeto['itens'])) {
        return [];
    }
    $cad = fxc_cadastro_chaves($materiais);
    return array_values(array_filter($projeto['itens'], function ($it) use ($cad) { return fxc_achar_tag($it, $cad) === null; }));
}

/**
 * Aplica a conciliação (lista × IFC) às linhas de material da planilha: planejado = MAIOR entre o que está no cadastro e o projeto,
 * peso unitário = o da lista. Só mexe nos fixadores (tipo_material FIXADOR) que casam com um tipo do projeto.
 */
function fxc_aplicar_materiais(array $materiais, $projeto)
{
    if (!is_array($projeto) || empty($projeto['itens'])) {
        return $materiais;
    }
    $cad = fxc_cadastro_chaves($materiais);
    $acum = [];
    foreach ($projeto['itens'] as $it) {
        $achado = fxc_achar_tag($it, $cad);
        if (!$achado) { continue; }
        $a = &$acum[$achado['i']];
        $a = $a ?? ['plan' => 0.0, 'pT' => 0.0, 'pQ' => 0.0];
        $a['plan'] += (float)$it['planejado'];
        if ((float)($it['peso_unit'] ?? 0) > 0) { $a['pT'] += $it['peso_unit'] * $it['planejado']; $a['pQ'] += $it['planejado']; }
        unset($a);
    }
    foreach ($acum as $i => $a) {
        $materiais[$i]['planejado'] = max((float)($materiais[$i]['planejado'] ?? 0), $a['plan']);
        if ($a['pQ'] > 0) {
            $materiais[$i]['peso_unitario'] = round($a['pT'] / $a['pQ'], 4);
            $materiais[$i]['peso_total'] = $materiais[$i]['peso_unitario'] * $materiais[$i]['planejado'];
        }
    }
    return $materiais;
}
