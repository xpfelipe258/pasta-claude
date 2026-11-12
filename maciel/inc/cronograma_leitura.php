<?php
// Leitura de cronograma para a aba Cronograma (Gantt): PDF com texto, planilha (.xlsx/.xlsm/.csv) ou MS Project (.xml).
// Devolve a lista de atividades na ordem do arquivo:
//   ['n' => ordem, 'item' => código/EDT, 'nome', 'grupo' => [resumos acima], 'inicio', 'fim', 'dias', 'qtd', 'un', 'resumo' => bool]
// Nada é gravado aqui: a tela concilia as atividades com as que têm leitura (lançamentos e catálogo) antes de salvar.

require_once __DIR__ . '/leitura_util.php';
require_once __DIR__ . '/pdf_texto.php';

const CL_MAX_ATIVIDADES = 3000;

function cl_norm($s)
{
    $s = mb_strtoupper(trim((string)$s), 'UTF-8');
    $s = strtr($s, ['Á' => 'A', 'À' => 'A', 'Ã' => 'A', 'Â' => 'A', 'É' => 'E', 'Ê' => 'E', 'Í' => 'I', 'Ó' => 'O', 'Õ' => 'O', 'Ô' => 'O', 'Ú' => 'U', 'Ü' => 'U', 'Ç' => 'C']);
    return trim(preg_replace('/\s+/', ' ', $s));
}

function cl_mes($txt)
{
    static $m = ['JAN' => 1, 'FEV' => 2, 'FEB' => 2, 'MAR' => 3, 'ABR' => 4, 'APR' => 4, 'MAI' => 5, 'MAY' => 5, 'JUN' => 6, 'JUL' => 7, 'AGO' => 8, 'AUG' => 8, 'SET' => 9, 'SEP' => 9, 'OUT' => 10, 'OCT' => 10, 'NOV' => 11, 'DEZ' => 12, 'DEC' => 12];
    return $m[substr(cl_norm($txt), 0, 3)] ?? 0;
}

function cl_montar_data($d, $m, $a)
{
    $d = (int)$d; $m = (int)$m; $a = (int)$a;
    if ($a < 100) { $a += 2000; }
    return ($a >= 1990 && $a <= 2100 && checkdate($m, $d, $a)) ? sprintf('%04d-%02d-%02d', $a, $m, $d) : null;
}

/** Data em qualquer formato usual (17/09/26, Qui 17/09/2026 08:00, 2026-09-17T08:00:00, 17.09.2026, 17/set/26, número de série do Excel). */
function cl_data($v)
{
    if ($v instanceof DateTimeInterface) {
        return $v->format('Y-m-d');
    }
    if (is_int($v) || is_float($v)) {
        return ($v > 30000 && $v < 80000) ? gmdate('Y-m-d', (int)round(($v - 25569) * 86400)) : null;
    }
    $s = trim((string)$v);
    if ($s === '') { return null; }
    if (preg_match('/(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/', $s, $m)) {
        return cl_montar_data($m[3], $m[2], $m[1]);
    }
    if (preg_match('/(?<!\d)(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4}|\d{2})(?!\d)/', $s, $m)) {
        return cl_montar_data($m[1], $m[2], $m[3]);
    }
    if (preg_match('/(?<!\d)(\d{1,2})[\/.\- ]+(?:de +)?([A-Za-zçÇ]{3,9})\.?[\/.\- ]+(?:de +)?(\d{4}|\d{2})(?!\d)/u', $s, $m) && cl_mes($m[2])) {
        return cl_montar_data($m[1], cl_mes($m[2]), $m[3]);
    }
    if (preg_match('/^\d{5}(\.\d+)?$/', $s)) {
        return cl_data((float)$s);
    }
    return null;
}

function cl_dias_uteis($ini, $fim)
{
    $n = 0;
    $d = new DateTime($ini);
    $f = new DateTime($fim);
    for ($i = 0; $d <= $f && $i < 5000; $i++, $d->modify('+1 day')) {
        if ((int)$d->format('N') < 6) { $n++; }
    }
    return $n;
}

function cl_numero($v)
{
    if (is_int($v) || is_float($v)) { return (float)$v; }
    $s = trim((string)$v);
    if ($s === '' || !preg_match('/^-?[\d.,]+$/', $s)) { return null; }
    if (strpos($s, ',') !== false) { $s = str_replace(',', '.', str_replace('.', '', $s)); }
    return is_numeric($s) ? (float)$s : null;
}

function cl_atividade($nome, $ini, $fim, array $extra = [])
{
    if ($fim < $ini) { list($ini, $fim) = [$fim, $ini]; }
    return $extra + ['item' => '', 'nome' => mb_substr(trim(preg_replace('/\s+/u', ' ', (string)$nome)), 0, 200), 'grupo' => [], 'inicio' => $ini, 'fim' => $fim,
        'dias' => cl_dias_uteis($ini, $fim), 'qtd' => null, 'un' => '', 'resumo' => false, 'nivel' => null];
}

// ---------------------------------------------------------------- MS Project (XML)

function cl_ler_xml($caminho, array &$avisos)
{
    $ant = libxml_use_internal_errors(true);
    $x = simplexml_load_file($caminho, 'SimpleXMLElement', LIBXML_NONET | LIBXML_COMPACT | LIBXML_PARSEHUGE);
    libxml_clear_errors();
    libxml_use_internal_errors($ant);
    if (!$x) {
        throw new RuntimeException('Não consegui ler o XML. No MS Project use Arquivo › Salvar como › Formato XML (*.xml).');
    }
    $ativ = [];
    $f = function ($t, $campo) { $r = $t->xpath('*[local-name()="' . $campo . '"]'); return $r ? trim((string)$r[0]) : ''; };
    foreach ($x->xpath('//*[local-name()="Tasks"]/*[local-name()="Task"]') as $t) {
        $nome = $f($t, 'Name');
        $nivel = (int)$f($t, 'OutlineLevel');
        $ini = cl_data($f($t, 'Start'));
        $fim = cl_data($f($t, 'Finish'));
        if ($nome === '' || !$ini || !$fim || $nivel < 1 || $f($t, 'IsNull') === '1') {
            continue;
        }
        $ativ[] = cl_atividade($nome, $ini, $fim, ['item' => mb_substr($f($t, 'WBS'), 0, 40), 'nivel' => $nivel, 'resumo' => $f($t, 'Summary') === '1', 'resumo_certo' => true]);
        if (count($ativ) >= CL_MAX_ATIVIDADES) { $avisos[] = 'O arquivo tem mais de ' . CL_MAX_ATIVIDADES . ' tarefas: li só as primeiras.'; break; }
    }
    return $ativ;
}

// ---------------------------------------------------------------- planilha (linhas × colunas)

function cl_cabecalho(array $linhas)
{
    foreach (array_slice($linhas, 0, 60, true) as $i => $l) {
        $c = ['nome' => null, 'ini' => null, 'fim' => null, 'item' => null, 'nivel' => null, 'qtd' => null, 'un' => null];
        foreach ($l as $j => $v) {
            $t = cl_norm(is_scalar($v) ? $v : '');
            if ($t === '' || strlen($t) > 60) { continue; }
            if ($c['nome'] === null && preg_match('/^(NOME( DA TAREFA)?|TAREFAS?|ATIVIDADES?|DESCRICAO|SERVICOS?|TASK( NAME)?|NAME)\b/', $t) && strpos($t, 'RECURSO') === false) { $c['nome'] = $j; }
            elseif ($c['ini'] === null && preg_match('/^(INICIO|START|DATA (DE )?INI|DT\.? ?INI)/', $t) && !preg_match('/LINHA DE BASE|BASELINE|REAL|ACTUAL/', $t)) { $c['ini'] = $j; }
            elseif ($c['fim'] === null && preg_match('/^(CONCLUS|TERMINO|FIM|FINAL|FINISH|END|DATA (DE )?(FIM|TERM|CONCL)|DT\.? ?FIM)/', $t) && !preg_match('/LINHA DE BASE|BASELINE|REAL|ACTUAL/', $t)) { $c['fim'] = $j; }
            elseif ($c['item'] === null && preg_match('/^(ITEM|EDT|WBS|EAP|CODIGO|COD\.?)$/', $t)) { $c['item'] = $j; }
            elseif ($c['nivel'] === null && preg_match('/^(NIVEL|OUTLINE|ESTRUTURA DE TOPICOS)/', $t)) { $c['nivel'] = $j; }
            elseif ($c['qtd'] === null && preg_match('/^(QUANT|QTD|QTDE|TOTAL DE UNID)/', $t)) { $c['qtd'] = $j; }
            elseif ($c['un'] === null && preg_match('/^(UN|UND|UNID|UNIDADE)\.?$/', $t)) { $c['un'] = $j; }
        }
        if ($c['nome'] !== null && $c['ini'] !== null && $c['fim'] !== null) {
            return [$i, $c];
        }
    }
    return null;
}

function cl_ler_linhas(array $linhas, array &$avisos)
{
    $ativ = [];
    $cab = cl_cabecalho($linhas);
    $secao = '';
    if ($cab) {
        list($i0, $c) = $cab;
        foreach ($linhas as $i => $l) {
            if ($i <= $i0) { continue; }
            $nome = trim((string)(is_scalar($l[$c['nome']] ?? null) ? $l[$c['nome']] : ''));
            $ini = cl_data($l[$c['ini']] ?? null);
            $fim = cl_data($l[$c['fim']] ?? null);
            $item = $c['item'] !== null ? trim((string)(is_scalar($l[$c['item']] ?? null) ? $l[$c['item']] : '')) : '';
            if (!$ini || !$fim) {
                $tit = $nome !== '' ? $nome : $item;   // linha de título (setor/etapa) sem datas
                if ($tit !== '' && !cl_data($tit) && preg_match('/\p{L}/u', $tit)) { $secao = mb_substr($tit, 0, 120); }
                continue;
            }
            if ($nome === '' || !preg_match('/\p{L}/u', $nome)) { continue; }
            $nv = $c['nivel'] !== null ? cl_numero($l[$c['nivel']] ?? null) : null;
            $a = cl_atividade($nome, $ini, $fim, ['item' => mb_substr($item, 0, 40), 'nivel' => $nv !== null && $nv >= 1 ? (int)$nv : null]);
            $a['secao'] = $secao;
            $a['qtd'] = $c['qtd'] !== null ? cl_numero($l[$c['qtd']] ?? null) : null;
            $a['un'] = $c['un'] !== null ? mb_substr(trim((string)(is_scalar($l[$c['un']] ?? null) ? $l[$c['un']] : '')), 0, 12) : '';
            $ativ[] = $a;
            if (count($ativ) >= CL_MAX_ATIVIDADES) { break; }
        }
        return $ativ;
    }
    // sem cabeçalho reconhecido: em cada linha, as duas primeiras datas e o texto mais longo
    foreach ($linhas as $l) {
        $datas = []; $nome = '';
        foreach ($l as $v) {
            if (!is_scalar($v) && !($v instanceof DateTimeInterface)) { continue; }
            $d = ($v instanceof DateTimeInterface || !is_string($v) || !preg_match('/\p{L}{4,}/u', $v)) ? cl_data($v) : null;
            if ($d) { $datas[] = $d; continue; }
            $t = trim((string)$v);
            if (preg_match('/\p{L}{3,}/u', $t) && mb_strlen($t) > mb_strlen($nome)) { $nome = $t; }
        }
        if ($nome !== '' && count($datas) >= 2) {
            $ativ[] = cl_atividade($nome, $datas[0], $datas[1]);
            if (count($ativ) >= CL_MAX_ATIVIDADES) { break; }
        }
    }
    if ($ativ) { $avisos[] = 'Não achei o cabeçalho (Nome/Tarefa, Início, Término): usei, em cada linha, o texto mais longo e as duas primeiras datas. Confira.'; }
    return $ativ;
}

function cl_ler_xlsx($caminho, array &$avisos)
{
    $melhor = [];
    foreach (xlsx_ler($caminho, 6000, 40) as $aba) {
        $av = [];
        $lista = cl_ler_linhas($aba['linhas'], $av);
        if (count($lista) > count($melhor)) { $melhor = $lista; $avisosAba = $av; }
    }
    foreach ($avisosAba ?? [] as $a) { $avisos[] = $a; }
    return $melhor;
}

function cl_ler_csv($caminho, array &$avisos)
{
    $txt = (string)file_get_contents($caminho);
    if (strncmp($txt, "\xFF\xFE", 2) === 0) { $txt = mb_convert_encoding(substr($txt, 2), 'UTF-8', 'UTF-16LE'); }
    elseif (strncmp($txt, "\xEF\xBB\xBF", 3) === 0) { $txt = substr($txt, 3); }
    elseif (!mb_check_encoding($txt, 'UTF-8')) { $txt = mb_convert_encoding($txt, 'UTF-8', 'Windows-1252'); }
    $prim = strtok($txt, "\n");
    $sep = ';';
    foreach ([';' , "\t", ','] as $s) { if (substr_count((string)$prim, $s) > substr_count((string)$prim, $sep)) { $sep = $s; } }
    $linhas = [];
    $fh = fopen('php://temp', 'r+');
    fwrite($fh, $txt);
    rewind($fh);
    while (($l = fgetcsv($fh, 0, $sep, '"', '\\')) !== false && count($linhas) < 8000) { $linhas[] = $l; }
    fclose($fh);
    return cl_ler_linhas($linhas, $avisos);
}

// ---------------------------------------------------------------- PDF (texto)

/** Uma linha de texto do PDF → atividade (ou null). As duas primeiras datas da linha são início e término. */
function cl_linha_pdf($linha)
{
    if (!preg_match_all('/(?<![\d\/.\-])(?:\d{1,2}[\/.\-]\d{1,2}[\/.\-](?:\d{4}|\d{2})|\d{4}-\d{2}-\d{2}|\d{1,2}[\/.\-][A-Za-zçÇ]{3}[\/.\-](?:\d{4}|\d{2}))(?![\d\/])/u', $linha, $m, PREG_OFFSET_CAPTURE)) {
        return null;
    }
    $datas = [];
    foreach ($m[0] as $x) {
        $d = cl_data($x[0]);
        if ($d) { $datas[] = [$d, $x[1], strlen($x[0])]; }
        if (count($datas) === 2) { break; }
    }
    if (count($datas) < 2) { return null; }
    $antes = substr($linha, 0, $datas[0][1]);
    $depois = substr($linha, $datas[1][1] + $datas[1][2]);
    $nome = preg_match('/\p{L}{3,}/u', preg_replace('/\b(seg|ter|qua|qui|sex|s[aá]b|dom|mon|tue|wed|thu|fri|sat|sun)\b\.?/iu', '', $antes)) ? $antes : $depois;
    $ini = $datas[0][0]; $fim = $datas[1][0];
    $dias = cl_dias_uteis(min($ini, $fim), max($ini, $fim));
    $nome = preg_replace('/\s+/u', ' ', ' ' . $nome . ' ');
    for ($i = 0; $i < 4; $i++) {   // tira do fim: dia da semana, duração, percentual
        $nome = preg_replace('/\s(seg|ter|qua|qui|sex|s[aá]b|dom|mon|tue|wed|thu|fri|sat|sun)\.?\s*$/iu', ' ', $nome);
        $nome = preg_replace('/\s\d+(?:[.,]\d+)?\s*(?:dias?|d|days?|hrs?|horas?|h|sem|semanas?|wks?|m[eê]s|meses|mons?)\s*\??\s*$/iu', ' ', $nome);
        $nome = preg_replace('/\s\d+(?:[.,]\d+)?\s*%\s*$/u', ' ', $nome);
    }
    if (preg_match('/^(.*\p{L}.*?)\s+(\d{1,4})\s*$/u', $nome, $q)) {   // número solto no fim = coluna de duração (quando bate com os dias entre as datas)
        $n = (int)$q[2];
        $corridos = (int)((strtotime($fim) - strtotime($ini)) / 86400);
        if (abs($n - $dias) <= 1 || abs($n - $corridos) <= 1) { $nome = $q[1]; }
    }
    $nome = trim($nome, " \t-–|;:");
    if (!preg_match('/\p{L}{3,}/u', $nome)) { return null; }
    return cl_atividade($nome, $ini, $fim);
}

function cl_ler_texto($texto)
{
    $ativ = [];
    foreach (preg_split('/\r\n|\r|\n|\f/', (string)$texto) as $l) {
        if (strlen($l) > 600) { continue; }
        $a = cl_linha_pdf($l);
        if ($a) { $ativ[] = $a; if (count($ativ) >= CL_MAX_ATIVIDADES) { break; } }
    }
    if (!$ativ) { return []; }
    // número da linha (Id) no começo: sai quando quase todas as linhas começam com número
    $comId = count(array_filter($ativ, function ($a) { return preg_match('/^\d{1,4}\s+\S/', $a['nome']); }));
    $tiraId = $comId >= count($ativ) * 0.7;
    foreach ($ativ as &$a) {
        if ($tiraId) { $a['nome'] = preg_replace('/^\d{1,4}\s+/', '', $a['nome']); }
        if (preg_match('/^(\d+(?:\.\d+)+)\.?\s+(\S.*)$/u', $a['nome'], $q)) { $a['item'] = $q[1]; $a['nome'] = $q[2]; }   // EDT (1.2.3) antes do nome
        $a['nome'] = trim($a['nome']);
    }
    unset($a);
    return array_values(array_filter($ativ, function ($a) { return preg_match('/\p{L}{3,}/u', $a['nome']); }));
}

function cl_ler_pdf($caminho, array &$avisos)
{
    $melhor = [];
    foreach (pdf_textos($caminho) as $t) {
        $l = cl_ler_texto($t);
        if (count($l) > count($melhor)) { $melhor = $l; }
    }
    if (!$melhor) {
        $avisos[] = 'Não encontrei linhas com nome, início e término no PDF. O PDF precisa ter texto selecionável (não pode ser imagem/escaneado). Se não der, exporte o cronograma em planilha (.xlsx) ou em XML do MS Project.';
    } else {
        $avisos[] = 'PDF: li as linhas que têm nome e duas datas. Nomes longos podem vir cortados e os grupos (resumos) são deduzidos pelas datas. Confira antes de salvar.';
    }
    return $melhor;
}

// ---------------------------------------------------------------- resumos (grupos) e caminho de cada atividade

function cl_hierarquia(array $ativ)
{
    $n = count($ativ);
    if (!$n) { return $ativ; }
    $comNivel = count(array_filter($ativ, function ($a) { return $a['nivel'] !== null; }));
    if ($comNivel < $n) {   // nível pelo código (1, 1.1, 1.1.1) quando a maioria tem código pontuado
        $pont = count(array_filter($ativ, function ($a) { return preg_match('/^\d+(\.\d+)*$/', $a['item']); }));
        $prof = count(array_filter($ativ, function ($a) { return strpos($a['item'], '.') !== false; }));
        if ($pont >= $n * 0.8 && $prof > 0) {
            foreach ($ativ as &$a) { $a['nivel'] = preg_match('/^\d+(\.\d+)*$/', $a['item']) ? substr_count($a['item'], '.') + 1 : null; }
            unset($a);
            $comNivel = count(array_filter($ativ, function ($a) { return $a['nivel'] !== null; }));
        }
    }
    if ($comNivel >= $n * 0.8) {
        $pilha = [];   // [nivel, nome]
        $ultNivel = 1;
        foreach ($ativ as $i => &$a) {
            $nv = $a['nivel'] ?? $ultNivel;
            $ultNivel = $nv;
            while ($pilha && end($pilha)[0] >= $nv) { array_pop($pilha); }
            $a['grupo'] = array_column($pilha, 1);
            $prox = null;
            for ($j = $i + 1; $j < $n; $j++) { if ($ativ[$j]['nivel'] !== null) { $prox = $ativ[$j]['nivel']; break; } }
            if (empty($a['resumo_certo'])) { $a['resumo'] = $prox !== null && $prox > $nv; }
            if ($a['resumo']) { $pilha[] = [$nv, $a['nome']]; }
        }
        unset($a);
    } else {
        // sem nível nem código: resumo = linha cujas datas são exatamente o período das linhas seguintes que cabem dentro dela (2 ou mais)
        $pilha = [];   // [inicio, fim, nome]
        foreach ($ativ as $i => &$a) {
            while ($pilha && !($a['inicio'] >= end($pilha)[0] && $a['fim'] <= end($pilha)[1])) { array_pop($pilha); }
            $a['grupo'] = array_column($pilha, 2);
            $min = null; $max = null; $q = 0;
            for ($j = $i + 1; $j < $n; $j++) {
                $b = $ativ[$j];
                if ($b['inicio'] < $a['inicio'] || $b['fim'] > $a['fim']) { break; }
                $q++;
                $min = $min === null || $b['inicio'] < $min ? $b['inicio'] : $min;
                $max = $max === null || $b['fim'] > $max ? $b['fim'] : $max;
            }
            $a['resumo'] = $q >= 2 && $min === $a['inicio'] && $max === $a['fim'] && $a['inicio'] !== $a['fim'];
            if ($a['resumo']) { $pilha[] = [$a['inicio'], $a['fim'], $a['nome']]; }
        }
        unset($a);
    }
    foreach ($ativ as $i => &$a) {
        if (!empty($a['secao'])) { array_unshift($a['grupo'], $a['secao']); }
        $a['grupo'] = array_values(array_slice(array_map(function ($g) { return mb_substr($g, 0, 120); }, $a['grupo']), -8));
        $a['n'] = $i + 1;
        unset($a['nivel'], $a['secao'], $a['resumo_certo']);
    }
    unset($a);
    return $ativ;
}

/** Lê o arquivo de cronograma. $nomeArq define o formato pela extensão. */
function cronograma_ler_arquivo($caminho, $nomeArq)
{
    $ext = strtolower(pathinfo((string)$nomeArq, PATHINFO_EXTENSION));
    $avisos = [];
    if ($ext === 'xml') { $ativ = cl_ler_xml($caminho, $avisos); $formato = 'MS Project (XML)'; }
    elseif ($ext === 'xlsx' || $ext === 'xlsm') { $ativ = cl_ler_xlsx($caminho, $avisos); $formato = 'Planilha'; }
    elseif ($ext === 'csv' || $ext === 'txt') { $ativ = cl_ler_csv($caminho, $avisos); $formato = 'Planilha (CSV)'; }
    elseif ($ext === 'pdf') { $ativ = cl_ler_pdf($caminho, $avisos); $formato = 'PDF'; }
    else { throw new RuntimeException('Formato não aceito. Envie PDF, planilha (.xlsx, .xlsm, .csv) ou XML do MS Project.'); }
    $ativ = cl_hierarquia($ativ);
    if (!$ativ && $ext !== 'pdf') {
        $avisos[] = 'Não encontrei atividades com nome, início e término. A planilha precisa ter as colunas Nome (ou Tarefa/Atividade), Início e Término.';
    }
    $r = ['formato' => $formato, 'atividades' => $ativ, 'avisos' => $avisos];
    if ($ativ) {
        $r['inicio'] = min(array_column($ativ, 'inicio'));
        $r['fim'] = max(array_column($ativ, 'fim'));
    }
    return $r;
}
