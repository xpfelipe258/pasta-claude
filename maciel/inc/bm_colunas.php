<?php
// Leitor de orçamento / planilha de medição POR COLUNAS (qualquer modelo de BM).
// Cada obra pode mandar a planilha num formato diferente; o sistema procura sozinho a linha de cabeçalho e as
// colunas de DESCRIÇÃO DA ATIVIDADE, PESO (%) e VALOR (R$) — e, se existirem, ITEM/CÓDIGO, QUANTIDADE e UNIDADE.
// O usuário confere/troca as colunas no pop-up "Importar orçamento" (aba Medição) e a leitura vira o mesmo formato
// de leitura_orcamento() (itens com atividades, pesos e valores), seguindo o fluxo catálogo → produção → BM.

const BMC_CAMPOS = ['desc', 'peso', 'valor', 'item', 'qtd', 'un'];

/** Abas da planilha (.xlsx/.xlsm/.csv) como linhas de células. */
function bmc_abas($arquivo, $nomeArq)
{
    $ext = strtolower(pathinfo((string)$nomeArq, PATHINFO_EXTENSION));
    if (in_array($ext, ['xlsx', 'xlsm'], true)) {
        $abas = xlsx_ler($arquivo, 5000, 40);
    } elseif (in_array($ext, ['csv', 'txt'], true)) {
        $txt = (string)file_get_contents($arquivo);
        if (!mb_check_encoding($txt, 'UTF-8')) { $txt = mb_convert_encoding($txt, 'UTF-8', 'Windows-1252'); }
        $txt = preg_replace('/^\xEF\xBB\xBF/', '', $txt);
        $prim = strtok($txt, "\n");
        $sep = substr_count($prim, ';') >= substr_count($prim, ',') ? ';' : ',';
        if (substr_count($prim, "\t") > substr_count($prim, $sep)) { $sep = "\t"; }
        $linhas = [];
        foreach (preg_split('/\r\n|\n|\r/', $txt) as $l) {
            if (count($linhas) >= 5000) { break; }
            $linhas[] = array_slice(str_getcsv($l, $sep, '"', '\\'), 0, 40);
        }
        $abas = [['nome' => 'CSV', 'linhas' => $linhas]];
    } else {
        throw new InvalidArgumentException('Envie a planilha em .xlsx, .xlsm ou .csv. Planilha .xls antiga: no Excel, Arquivo › Salvar como › Pasta de Trabalho do Excel (.xlsx).');
    }
    $abas = array_values(array_filter($abas, function ($a) {
        foreach ($a['linhas'] as $l) { foreach ((array)$l as $c) { if (lt_texto($c) !== '') { return true; } } }
        return false;
    }));
    if (!$abas) { throw new InvalidArgumentException('A planilha está vazia.'); }
    return $abas;
}

/** Nota do texto de cabeçalho para cada campo (0 = não serve). */
function bmc_nota_cab($campo, $t)
{
    $t = preg_replace('/\s+/', ' ', lt_up($t));
    if ($t === '' || mb_strlen($t) > 60) { return 0; }
    $tem = function ($re) use ($t) { return preg_match($re . 'u', $t) === 1; };
    switch ($campo) {
        case 'desc':
            if ($tem('/^DESCRI|DESCRIÇÃO DA ATIV|DISCRIMINA/')) { return 10; }
            if ($tem('/DESCRI|ATIVIDADE|SERVIÇO|SERVICO|ESPECIFICA/')) { return 6; }
            return 0;
        case 'peso':
            if ($tem('/^PESO/')) { return 10; }
            if ($tem('/PESO/')) { return 8; }
            if ($tem('/%/') && !$tem('/BDI|DESC|ACUM|MEDID|EXECUT|ANTERIOR|ATUAL|PERÍODO|PERIODO|SALDO/')) { return 5; }
            return 0;
        case 'valor':
            if ($tem('/%|UNIT|ACUM|MEDID|ANTERIOR|ATUAL|SALDO|PERÍODO|PERIODO|BDI/')) { return 0; }
            if ($tem('/VALOR TOTAL|PREÇO TOTAL|PRECO TOTAL|TOTAL \(R\$\)|TOTAL R\$/')) { return 10; }
            if ($tem('/^VALOR|^PREÇO|^PRECO|R\$/')) { return 7; }
            if ($tem('/^TOTAL$/')) { return 6; }
            return 0;
        case 'item':
            if ($tem('/^(ITEM|ÍTEM|ITEM DE VENDA|CÓD|COD|CÓDIGO|CODIGO|Nº|N°|NUM)/')) { return 10; }
            return 0;
        case 'qtd':
            if ($tem('/%|ACUM|MEDID|ANTERIOR|ATUAL|SALDO|PERÍODO|PERIODO/')) { return 0; }
            if ($tem('/^(QTD|QTDE|QUANT)/')) { return 10; }
            return 0;
        case 'un':
            if ($tem('/^(UN|UND|UNID|UNIDADE)\.?$/')) { return 10; }
            return 0;
    }
    return 0;
}

/** Acha a linha de cabeçalho (nas 40 primeiras) e as colunas de cada campo. */
function bmc_sugerir(array $linhas, array $salvo = [])
{
    $melhor = ['linha' => null, 'cols' => array_fill_keys(BMC_CAMPOS, null), 'nota' => 0];
    foreach (array_slice($linhas, 0, 40, true) as $i => $l) {
        $cols = array_fill_keys(BMC_CAMPOS, null);
        $nota = 0;
        foreach (BMC_CAMPOS as $campo) {
            $best = 0;
            foreach ((array)$l as $j => $c) {
                $t = lt_texto($c);
                $n = bmc_nota_cab($campo, $t);
                if (isset($salvo[$campo]) && $salvo[$campo] !== '' && lt_up($t) === lt_up($salvo[$campo])) { $n = 20; }   // nome usado na última importação
                if ($n > $best && !in_array($j, $cols, true)) { $best = $n; $cols[$campo] = $j; }
            }
            $nota += $best * (in_array($campo, ['desc', 'peso', 'valor'], true) ? 2 : 1);
        }
        if ($cols['desc'] !== null && ($cols['peso'] !== null || $cols['valor'] !== null) && $nota > $melhor['nota']) {
            $melhor = ['linha' => $i, 'cols' => $cols, 'nota' => $nota];
        }
    }
    return $melhor;
}

function bmc_letra($j)
{
    $s = '';
    for ($n = $j + 1; $n > 0; $n = intdiv($n - 1, 26)) { $s = chr(65 + ($n - 1) % 26) . $s; }
    return $s;
}

/** Colunas da linha de cabeçalho com um exemplo de valor (para os seletores do pop-up). */
function bmc_colunas_info(array $linhas, $cab)
{
    $max = 0;
    foreach (array_slice($linhas, (int)$cab, 60) as $l) { $max = max($max, count((array)$l)); }
    $out = [];
    for ($j = 0; $j < $max; $j++) {
        $ex = '';
        foreach (array_slice($linhas, (int)$cab + 1, 60) as $l) {
            $t = lt_texto($l[$j] ?? null);
            if ($t !== '') { $ex = mb_substr($t, 0, 40); break; }
        }
        $out[] = ['j' => $j, 'letra' => bmc_letra($j), 'titulo' => mb_substr(lt_texto($linhas[$cab][$j] ?? null), 0, 50), 'exemplo' => $ex];
    }
    return $out;
}

/** Código no começo do texto ("3.1.1 - Montagem") → ['3.1.1', 'Montagem']. */
function bmc_codigo_do_texto($t)
{
    if (preg_match('/^\s*(\d+(?:\.\d+)*)\s*[-–.)]?\s+(.+)$/u', $t, $m) && strlen($m[1]) <= 12) { return [$m[1], trim($m[2])]; }
    return [null, $t];
}

/**
 * Monta itens e atividades a partir das colunas escolhidas.
 * Regras: linha com código é item (ou seção, se outros códigos começam por ele); linha sem código com peso/valor é
 * atividade do item atual; sem coluna de código, linha com descrição e sem peso nem valor abre um item novo.
 * Peso de cada atividade no item = peso ÷ soma dos pesos do item (vale peso dentro do item ou do contrato);
 * sem peso, = valor ÷ soma dos valores. Sem valor e com total do contrato: valor = peso (% do contrato) × total.
 */
function bmc_montar(array $linhas, $cab, array $col, $contratoTotal = null)
{
    $g = function ($l, $campo) use ($col) { return isset($col[$campo]) && $col[$campo] !== null && $col[$campo] !== '' ? ($l[(int)$col[$campo]] ?? null) : null; };
    if (!isset($col['desc']) || $col['desc'] === null || $col['desc'] === '') { throw new InvalidArgumentException('Escolha a coluna da DESCRIÇÃO da atividade.'); }
    $temPeso = isset($col['peso']) && $col['peso'] !== null && $col['peso'] !== '';
    $temValor = isset($col['valor']) && $col['valor'] !== null && $col['valor'] !== '';
    if (!$temPeso && !$temValor) { throw new InvalidArgumentException('Escolha a coluna do PESO (%) ou a do VALOR (R$) da atividade.'); }
    $temItem = isset($col['item']) && $col['item'] !== null && $col['item'] !== '';

    // 1) linhas úteis
    $reg = [];
    $totalLido = null;
    foreach (array_slice($linhas, (int)$cab + 1, null, true) as $i => $l) {
        $desc = lt_texto($g($l, 'desc'));
        $cod = $temItem ? lo_codigo($g($l, 'item')) : null;
        $codTxt = $temItem ? lt_texto($g($l, 'item')) : '';
        if ($temItem && $cod === null && preg_match('/^\s*(\d+(?:[.,]\d+)+)\s*$/', $codTxt, $m)) { $cod = str_replace(',', '.', $m[1]); }
        if ($temItem && $cod === null && is_numeric($g($l, 'item')) && floor((float)$g($l, 'item')) == (float)$g($l, 'item')) { $cod = (string)(int)$g($l, 'item'); }
        if (!$temItem) { list($cod, $desc) = bmc_codigo_do_texto($desc); if ($cod !== null && strpos($cod, '.') === false && $cod > 999) { $cod = null; } }
        $peso = $temPeso ? lt_numero($g($l, 'peso')) : null;
        $valor = $temValor ? lt_numero($g($l, 'valor')) : null;
        if ($desc === '') { continue; }
        if (preg_match('/\bTOTAL\b/u', lt_up($desc)) && $cod === null) {
            if (strpos(lt_up($desc), 'CONTRATO') !== false || $valor !== null) {   // "TOTAL DO CONTRATO": maior número da linha
                $vt = $valor;
                if ($vt === null) { foreach ((array)$l as $c) { $nn = lt_numero($c); if ($nn !== null && $nn > 1000 && $nn > (float)$vt) { $vt = $nn; } } }
                if ($vt !== null && $vt > ($totalLido ?? 0)) { $totalLido = $vt; }
            }
            continue;
        }
        $reg[] = ['linha' => $i + 1, 'cod' => $cod, 'desc' => $desc, 'peso' => $peso, 'valor' => $valor,
            'qtd' => lt_numero($g($l, 'qtd')), 'un' => lt_unidade($g($l, 'un'))];
    }
    if (!$reg) { throw new InvalidArgumentException('Nenhuma linha com descrição abaixo do cabeçalho. Confira a linha do cabeçalho e a aba.'); }
    $total = $contratoTotal !== null && $contratoTotal > 0 ? (float)$contratoTotal : $totalLido;

    // peso em fração (0,25) ou em percentual (25)?
    $maxPeso = 0;
    foreach ($reg as $r) { if ($r['peso'] !== null) { $maxPeso = max($maxPeso, $r['peso']); } }
    $fator = $maxPeso > 1.0001 ? 0.01 : 1.0;

    // 2) agrupa em itens
    $codigos = array_values(array_filter(array_column($reg, 'cod'), 'strlen'));
    $itens = [];
    $atual = null;
    $avisos = [];
    $novoItem = function ($cod, $desc, $valor, $peso) use (&$itens) {
        $itens[] = ['codigo' => $cod, 'descricao' => $desc, 'valor_linha' => $valor, 'peso_linha' => $peso, 'atividades' => []];
        return count($itens) - 1;
    };
    foreach ($reg as $r) {
        $ehAtiv = $r['peso'] !== null || $r['valor'] !== null;
        if ($r['cod'] !== null) {
            $pai = false;
            foreach ($codigos as $c) { if ($c !== $r['cod'] && strpos($c, $r['cod'] . '.') === 0) { $pai = true; break; } }
            if ($pai) { continue; }   // seção (3, 3.1): só agrupa
            $atual = $novoItem($r['cod'], $r['desc'], $r['valor'], $r['peso']);
            continue;
        }
        if (!$ehAtiv) {
            if (!$temItem && !$codigos) { $atual = $novoItem(null, $r['desc'], null, null); }
            continue;
        }
        if ($atual === null) { $atual = $novoItem(null, 'Itens da planilha', null, null); }
        $itens[$atual]['atividades'][] = $r;
    }
    // item sem atividades abaixo dele = ele mesmo é a atividade
    foreach ($itens as &$it) {
        if (!$it['atividades'] && ($it['valor_linha'] !== null || $it['peso_linha'] !== null)) {
            $it['atividades'][] = ['linha' => 0, 'desc' => $it['descricao'], 'peso' => $it['peso_linha'], 'valor' => $it['valor_linha'], 'qtd' => null, 'un' => ''];
        }
    }
    unset($it);
    $itens = array_values(array_filter($itens, function ($i) { return $i['atividades']; }));
    if (!$itens) { throw new InvalidArgumentException('Não achei atividades com peso ou valor nas colunas escolhidas.'); }

    // 3) pesos e valores — o peso é do contrato (todos somam ~100%) ou de dentro do item (cada item soma ~100%)?
    $somaGeral = 0; $nP = 0;
    foreach ($itens as $it) { foreach ($it['atividades'] as $a) { if ($a['peso'] !== null) { $somaGeral += $a['peso'] * $fator; $nP++; } } }
    $pesoDoContrato = $nP > 0 && abs($somaGeral - 1) <= 0.03;
    if (!$temValor && $total && !$pesoDoContrato && $nP > 0) {
        $avisos[] = 'Os pesos somam 100% dentro de cada item (não do contrato): para ter os valores em R$, escolha a coluna de VALOR ou uma coluna de % do contrato (ex.: "VALOR %").';
    }
    $saida = [];
    $n = 0;
    $semValor = 0;
    foreach ($itens as $it) {
        $n++;
        $cod = $it['codigo'] ?: (string)$n;
        $ativ = [];
        $somaP = 0; $somaV = 0; $todosP = true; $todosV = true;
        foreach ($it['atividades'] as $a) {
            $p = $a['peso'] !== null ? $a['peso'] * $fator : null;
            $v = $a['valor'];
            if ($v === null && $p !== null && $total && $pesoDoContrato) { $v = $p * $total; }   // peso = % do contrato
            if ($p === null) { $todosP = false; } else { $somaP += $p; }
            if ($v === null) { $todosV = false; } else { $somaV += $v; }
            $ativ[] = ['p' => $p, 'v' => $v, 'a' => $a];
        }
        $lista = [];
        foreach ($ativ as $x) {
            if ($todosP && $somaP > 0) { $peso = $x['p'] / $somaP; }
            elseif ($todosV && $somaV > 0) { $peso = $x['v'] / $somaV; }
            else { $peso = 1 / count($ativ); }
            $v = $x['v'];
            if ($v === null) { $semValor++; }
            $qtd = $x['a']['qtd'];
            $un = $x['a']['un'];
            if (!$qtd) { $qtd = 100.0; $un = '%'; }
            $lista[] = ['descricao' => mb_substr($x['a']['desc'], 0, 250), 'qtd' => (float)$qtd, 'unidade' => mb_substr($un ?: 'un', 0, 12), 'peso' => round($peso, 6), 'valor' => round((float)$v, 2)];
        }
        $valorItem = $somaV > 0 ? $somaV : (float)($it['valor_linha'] ?? 0);
        $saida[] = ['codigo' => $cod, 'descricao' => mb_substr($it['descricao'], 0, 250), 'qtd' => null, 'unidade' => '', 'valor' => round($valorItem, 2), 'atividades' => $lista];
    }
    if ($semValor) {
        $avisos[] = $semValor . ' atividade(s) ficaram sem valor em R$: escolha a coluna de VALOR ou informe o valor total do contrato (com o peso em % do contrato).';
    }
    if (!$temValor && $total && $pesoDoContrato) {
        $avisos[] = 'Valores calculados: peso (% do contrato) × total do contrato de R$ ' . number_format($total, 2, ',', '.') . '.';
    }
    if (!$temPeso) { $avisos[] = 'Sem coluna de peso: o peso de cada atividade no item foi calculado pelo valor.'; }
    $semQtd = !isset($col['qtd']) || $col['qtd'] === null || $col['qtd'] === '';
    if ($semQtd) { $avisos[] = 'Sem coluna de quantidade: cada atividade será lançada em % de avanço (0 a 100).'; }
    return ['itens' => $saida, 'periodos' => lo_periodos($linhas), 'contrato_total' => $total, 'avisos' => $avisos, 'leitor' => 'colunas'];
}
