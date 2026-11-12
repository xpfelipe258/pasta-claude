<?php
// Extração de TEXTO de PDF (só PDFs com texto selecionável; PDF escaneado/imagem não tem texto e precisa de OCR).
// 1) usa o `pdftotext -layout` quando o servidor tem; 2) senão lê o PDF por conta própria (FlateDecode, ObjStm, fontes com ToUnicode).
// Devolve o texto linha a linha (colunas separadas por espaços), na ordem das páginas.

function pdf_texto_externo($caminho)
{
    foreach (['shell_exec', 'exec', 'proc_open'] as $f) {
        if (!function_exists($f) || in_array($f, array_map('trim', explode(',', (string)ini_get('disable_functions'))), true)) { return null; }
    }
    $bin = trim((string)@shell_exec('command -v pdftotext 2>/dev/null'));
    if ($bin === '') { return null; }
    $saida = @shell_exec(escapeshellarg($bin) . ' -layout -enc UTF-8 ' . escapeshellarg($caminho) . ' - 2>/dev/null');
    return is_string($saida) && trim($saida) !== '' ? $saida : null;
}

/** Textos possíveis do PDF (leitor próprio e, se o servidor tiver, o pdftotext): quem chama escolhe o que dá mais itens. */
function pdf_textos($caminho)
{
    $r = [];
    if (filesize($caminho) <= 150 * 1024 * 1024) { $t = pdf_texto_proprio((string)file_get_contents($caminho)); if (trim($t) !== '') { $r[] = $t; } }
    $e = pdf_texto_externo($caminho);
    if ($e !== null) { $r[] = $e; }
    if (!$r && filesize($caminho) > 150 * 1024 * 1024) { throw new RuntimeException('PDF grande demais para ler no servidor (limite 150 MB): envie o ZIP com a planilha .xlsx.'); }
    return $r;
}

/** Pedaço balanceado << ... >> que começa em $pos (a posição de "<<"). */
function pdf_dic_balanceado($s, $pos)
{
    $n = strlen($s); $nivel = 0;
    for ($i = $pos; $i < $n - 1; $i++) {
        if ($s[$i] === '<' && $s[$i + 1] === '<') { $nivel++; $i++; }
        elseif ($s[$i] === '>' && $s[$i + 1] === '>') { $nivel--; $i++; if ($nivel === 0) { return substr($s, $pos, $i - $pos + 1); } }
    }
    return substr($s, $pos);
}

/** Valor de uma chave do dicionário: devolve ['dic' => '<<...>>'] ou ['ref' => N] ou ['txt' => '...']. */
function pdf_chave($dic, $chave)
{
    if (!preg_match('~' . preg_quote($chave, '~') . '(?![A-Za-z0-9])\s*~', $dic, $m, PREG_OFFSET_CAPTURE)) { return null; }
    $p = $m[0][1] + strlen($m[0][0]);
    $r = substr($dic, $p, 400);
    if (strncmp($r, '<<', 2) === 0) { return ['dic' => pdf_dic_balanceado($dic, $p)]; }
    if (preg_match('/^(\d+)\s+\d+\s+R/', $r, $mm)) { return ['ref' => (int)$mm[1]]; }
    if ($r !== '' && $r[0] === '[') {   // lista (pode ter listas dentro, como o /W das fontes)
        $nv = 0; $tt = strlen($dic);
        for ($k = $p; $k < $tt; $k++) { if ($dic[$k] === '[') { $nv++; } elseif ($dic[$k] === ']' && --$nv === 0) { break; } }
        return ['txt' => substr($dic, $p, $k - $p + 1)];
    }
    if (preg_match('/^[^\s\/<>\[\]]+/', $r, $mm)) { return ['txt' => $mm[0]]; }
    if (preg_match('~^/[^\s/<>\[\]]+~', $r, $mm)) { return ['txt' => $mm[0]]; }
    return null;
}

function pdf_ascii85($s)
{
    $s = preg_replace('/\s+/', '', (string)$s);
    $fim = strpos($s, '~>');
    if ($fim !== false) { $s = substr($s, 0, $fim); }
    if (strncmp($s, '<~', 2) === 0) { $s = substr($s, 2); }
    $s = str_replace('z', '!!!!!', $s);
    $out = '';
    for ($i = 0, $n = strlen($s); $i < $n; $i += 5) {
        $g = substr($s, $i, 5);
        $falta = 5 - strlen($g);
        $g = str_pad($g, 5, 'u');
        $v = 0;
        for ($k = 0; $k < 5; $k++) { $v = $v * 85 + (ord($g[$k]) - 33); }
        $out .= substr(pack('N', $v & 0xFFFFFFFF), 0, 4 - $falta);
    }
    return $out;
}

function pdf_decodificar($dic, $bruto)
{
    if (strpos($dic, '/ASCII85Decode') !== false || preg_match('/\/A85\b/', $dic)) { $bruto = pdf_ascii85($bruto); }
    if (strpos($dic, '/FlateDecode') === false && strpos($dic, '/Fl') === false) { return $bruto; }
    $d = @gzuncompress($bruto);
    if ($d === false) { $d = @gzinflate(substr($bruto, 2)); }
    if ($d === false) { $d = @gzinflate($bruto); }
    return $d === false ? '' : $d;
}

function pdf_texto_proprio($pdf)
{
    // ---- objetos
    $obj = [];   // num => ['dic' => string, 'fluxo' => string|null]
    $n = preg_match_all('/(\d+)\s+(\d+)\s+obj\b/', $pdf, $ms, PREG_OFFSET_CAPTURE);
    for ($i = 0; $i < $n; $i++) {
        $ini = $ms[0][$i][1] + strlen($ms[0][$i][0]);
        $fim = $i + 1 < $n ? $ms[0][$i + 1][1] : strlen($pdf);
        $corpo = substr($pdf, $ini, $fim - $ini);
        $num = (int)$ms[1][$i][0];
        $sp = strpos($corpo, 'stream');
        $fluxo = null;
        if ($sp !== false && preg_match('/stream\r?\n/', $corpo, $mm, PREG_OFFSET_CAPTURE, max(0, $sp - 1))) {
            $dic = substr($corpo, 0, $sp);
            $ini2 = $mm[0][1] + strlen($mm[0][0]);
            $ef = strrpos($corpo, 'endstream');
            $fluxo = pdf_decodificar($dic, substr($corpo, $ini2, ($ef === false ? strlen($corpo) : $ef) - $ini2));
        } else { $dic = $corpo; }
        $obj[$num] = ['dic' => $dic, 'fluxo' => $fluxo];
    }
    // objetos dentro de ObjStm (PDF 1.5+)
    foreach ($obj as $num => $o) {
        if ($o['fluxo'] !== null && strpos($o['dic'], '/ObjStm') !== false && preg_match('~/N\s+(\d+)~', $o['dic'], $mn) && preg_match('~/First\s+(\d+)~', $o['dic'], $mf)) {
            $qtd = (int)$mn[1]; $first = (int)$mf[1];
            $cab = preg_split('/\s+/', trim(substr($o['fluxo'], 0, $first)));
            for ($k = 0; $k < $qtd; $k++) {
                $on = (int)($cab[$k * 2] ?? 0); $off = (int)($cab[$k * 2 + 1] ?? 0);
                $prox = isset($cab[($k + 1) * 2 + 1]) ? (int)$cab[($k + 1) * 2 + 1] : strlen($o['fluxo']) - $first;
                if ($on > 0 && !isset($obj[$on])) { $obj[$on] = ['dic' => substr($o['fluxo'], $first + $off, $prox - $off), 'fluxo' => null]; }
            }
        }
    }
    // ---- fontes: mapa de código → unicode (ToUnicode)
    $cacheFonte = [];
    $fonte = function ($num) use (&$obj, &$cacheFonte) {
        if (isset($cacheFonte[$num])) { return $cacheFonte[$num]; }
        $f = ['map' => [], 'bytes' => 1, 'w' => [], 'dw' => null];
        $d = $obj[$num]['dic'] ?? '';
        // larguras dos caracteres (1/1000 do tamanho da fonte): fonte simples (/Widths) ou composta (/DW e /W da fonte descendente)
        $lerNum = function ($txt) { preg_match_all('/-?\d*\.?\d+/', $txt, $nn); return array_map('floatval', $nn[0]); };
        $resolve = function ($v) use (&$obj, $lerNum) { if (!$v) { return null; } if (isset($v['ref'])) { return $obj[$v['ref']]['dic'] ?? null; } return $v['txt'] ?? ($v['dic'] ?? null); };
        $desc = $d;
        $df = pdf_chave($d, '/DescendantFonts');
        if ($df && isset($df['txt']) && preg_match('/(\d+)\s+\d+\s+R/', $df['txt'], $dm)) { $desc = $obj[(int)$dm[1]]['dic'] ?? $d; }
        elseif ($df && isset($df['ref'])) { $t = $obj[$df['ref']]['dic'] ?? ''; if (preg_match('/(\d+)\s+\d+\s+R/', $t, $dm)) { $desc = $obj[(int)$dm[1]]['dic'] ?? $d; } }
        $dwv = pdf_chave($desc, '/DW'); if ($dwv && isset($dwv['txt'])) { $f['dw'] = (float)$dwv['txt']; }
        $wv = pdf_chave($desc, '/Widths');
        if ($wv && ($wt = $resolve($wv)) !== null && ($fc = pdf_chave($desc, '/FirstChar')) && isset($fc['txt'])) { $c0 = (int)$fc['txt']; foreach ($lerNum($wt) as $k => $w) { $f['w'][$c0 + $k] = $w; } }
        $wv = pdf_chave($desc, '/W');
        if ($wv && ($wt = $resolve($wv)) !== null) {   // [c [w1 w2 ...] c1 c2 w ...]
            if (preg_match_all('/(\d+)\s*\[([^\]]*)\]|(\d+)\s+(\d+)\s+(-?\d*\.?\d+)/', $wt, $wm, PREG_SET_ORDER)) {
                foreach ($wm as $m) {
                    if (($m[1] ?? '') !== '') { foreach ($lerNum($m[2]) as $k => $w) { $f['w'][(int)$m[1] + $k] = $w; } }
                    else { $lo = (int)$m[3]; $hi = min((int)$m[4], $lo + 20000); for ($c = $lo; $c <= $hi; $c++) { $f['w'][$c] = (float)$m[5]; } }
                }
            }
        }
        if (preg_match('~/Subtype\s*/Type0~', $d) || preg_match('~/Encoding\s*/Identity-H~', $d)) { $f['bytes'] = 2; }
        $tu = pdf_chave($d, '/ToUnicode');
        if ($tu && isset($tu['ref']) && isset($obj[$tu['ref']]['fluxo'])) {
            $cm = $obj[$tu['ref']]['fluxo'];
            if (preg_match('/begincodespacerange\s*<([0-9A-Fa-f]+)>/', $cm, $mc)) { $f['bytes'] = max(1, (int)(strlen($mc[1]) / 2)); }
            $hex = function ($h) { $h = preg_replace('/\s+/', '', $h); $u = @mb_convert_encoding(hex2bin(strlen($h) % 2 ? $h . '0' : $h), 'UTF-8', 'UTF-16BE'); return $u === false ? '' : $u; };
            if (preg_match_all('/beginbfchar(.*?)endbfchar/s', $cm, $blocos)) {
                foreach ($blocos[1] as $b) { if (preg_match_all('/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/', $b, $pp, PREG_SET_ORDER)) { foreach ($pp as $p) { $f['map'][hexdec($p[1])] = $hex($p[2]); } } }
            }
            if (preg_match_all('/beginbfrange(.*?)endbfrange/s', $cm, $blocos)) {
                foreach ($blocos[1] as $b) {
                    if (preg_match_all('/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(<[0-9A-Fa-f]+>|\[[^\]]*\])/', $b, $pp, PREG_SET_ORDER)) {
                        foreach ($pp as $p) {
                            $lo = hexdec($p[1]); $hi = min(hexdec($p[2]), $lo + 65535);
                            if ($p[3][0] === '[') { preg_match_all('/<([0-9A-Fa-f]+)>/', $p[3], $lista); foreach ($lista[1] as $k => $h) { $f['map'][$lo + $k] = $hex($h); } }
                            else {
                                $base = preg_replace('/\s+/', '', trim($p[3], '<>')); $ult = hexdec(substr($base, -4)); $pref = substr($base, 0, -4);
                                for ($c = $lo; $c <= $hi; $c++) { $f['map'][$c] = $hex($pref . str_pad(dechex($ult + $c - $lo), 4, '0', STR_PAD_LEFT)); }
                            }
                        }
                    }
                }
            }
        }
        return $cacheFonte[$num] = $f;
    };
    // ---- páginas na ordem da árvore
    $raiz = null;
    foreach ($obj as $num => $o) { if (preg_match('~/Type\s*/Catalog~', $o['dic'])) { $raiz = pdf_chave($o['dic'], '/Pages'); break; } }
    $paginas = [];
    $percorre = function ($num, $recursos) use (&$percorre, &$obj, &$paginas) {
        $d = $obj[$num]['dic'] ?? '';
        $rec = pdf_chave($d, '/Resources') ?: $recursos;
        if (preg_match('~/Type\s*/Pages~', $d) || (strpos($d, '/Kids') !== false && !preg_match('~/Type\s*/Page\b~', $d))) {
            if (preg_match('~/Kids\s*\[([^\]]*)\]~', $d, $mk) && preg_match_all('/(\d+)\s+\d+\s+R/', $mk[1], $filhos)) { foreach ($filhos[1] as $f) { $percorre((int)$f, $rec); } }
        } else { $paginas[] = [$num, $rec]; }
    };
    if ($raiz && isset($raiz['ref'])) { $percorre($raiz['ref'], null); }
    if (!$paginas) { foreach ($obj as $num => $o) { if (preg_match('~/Type\s*/Page\b~', $o['dic'])) { $paginas[] = [$num, pdf_chave($o['dic'], '/Resources')]; } } }
    // ---- texto de cada página
    $saida = [];
    foreach ($paginas as list($num, $rec)) {
        $d = $obj[$num]['dic'] ?? '';
        $fontes = [];   // nome => número do objeto
        $rd = $rec;
        if ($rd && isset($rd['ref'])) { $rd = ['dic' => $obj[$rd['ref']]['dic'] ?? '']; }
        if ($rd && isset($rd['dic'])) {
            $fd = pdf_chave($rd['dic'], '/Font');
            if ($fd && isset($fd['ref'])) { $fd = ['dic' => $obj[$fd['ref']]['dic'] ?? '']; }
            if ($fd && isset($fd['dic']) && preg_match_all('~/([^\s/<>\[\]()]+)\s+(\d+)\s+\d+\s+R~', $fd['dic'], $fm, PREG_SET_ORDER)) { foreach ($fm as $m) { $fontes[$m[1]] = (int)$m[2]; } }
        }
        $cont = pdf_chave($d, '/Contents');
        $refs = [];
        if ($cont && isset($cont['ref'])) { $refs[] = $cont['ref']; }
        elseif ($cont && isset($cont['txt']) && preg_match_all('/(\d+)\s+\d+\s+R/', $cont['txt'], $cr)) { $refs = array_map('intval', $cr[1]); }
        $conteudo = '';
        foreach ($refs as $r) { $conteudo .= ($obj[$r]['fluxo'] ?? '') . "\n"; }
        $saida[] = pdf_texto_pagina($conteudo, $fontes, $fonte);
    }
    return implode("\n", $saida);
}

/** Largura aproximada (1/1000 em) quando a fonte não informa: maiúscula larga, minúscula média, estreitas finas. */
function pdf_largura_padrao($ch)
{
    if ($ch === ' ') { return 278; }
    if (strpos('iljtfIr.,;:!|\'`1()[]', $ch) !== false) { return 290; }
    if (strpos('mwMW', $ch) !== false) { return 800; }
    if (ctype_upper($ch)) { return 680; }
    if (ctype_digit($ch)) { return 556; }
    return 530;
}

/** Decodifica os bytes da string do PDF: devolve [texto UTF-8, largura em 1/1000 do tamanho da fonte]. */
function pdf_decodifica_texto($bytes, $fnt)
{
    $s = ''; $larg = 0.0;
    $t = strlen($bytes); $tb = $fnt['bytes'];
    for ($i = 0; $i < $t; $i += $tb) {
        $c = $tb === 2 ? (ord($bytes[$i]) << 8) | ord($bytes[$i + 1] ?? "\0") : ord($bytes[$i]);
        if ($fnt['map']) { $ch = $fnt['map'][$c] ?? ''; }
        else { $ch = $tb === 2 ? '' : (string)@mb_convert_encoding($bytes[$i], 'UTF-8', 'Windows-1252'); }
        $s .= $ch;
        $larg += $fnt['w'][$c] ?? ($fnt['dw'] ?? ($ch !== '' ? pdf_largura_padrao($ch) : 500));
    }
    return [$s, $larg];
}

/** Interpreta o conteúdo da página: devolve as linhas de texto (itens com mesma altura, da esquerda para a direita). */
function pdf_texto_pagina($conteudo, array $fontes, callable $obterFonte)
{
    if ($conteudo === '') { return ''; }
    preg_match_all('/\((?:[^()\\\\]|\\\\.|\((?:[^()\\\\]|\\\\.)*\))*\)|<[0-9A-Fa-f\s]*>|\[|\]|\/[^\s\/\[\]()<>]*|[-+]?\d*\.?\d+|[A-Za-z\'"*]+/s', $conteudo, $tk);
    $pilha = []; $arr = null;
    $fnt = ['map' => [], 'bytes' => 1, 'w' => [], 'dw' => null]; $tam = 10;
    $ctm = [1, 0, 0, 1, 0, 0]; $guarda = [];
    $tm = [1, 0, 0, 1, 0, 0]; $lm = [1, 0, 0, 1, 0, 0]; $lead = 0;
    $itens = [];
    $literal = function ($t) {
        $t = substr($t, 1, -1);
        return preg_replace_callback('/\\\\([0-7]{1,3}|.)/s', function ($m) {
            $c = $m[1];
            if (ctype_digit($c)) { return chr(octdec($c) & 255); }
            $mapa = ['n' => "\n", 'r' => "\r", 't' => "\t", 'b' => "\x08", 'f' => "\x0c", "\n" => '', "\r" => ''];
            return $mapa[$c] ?? $c;
        }, $t);
    };
    $texto = function ($tok) use ($literal) {
        if ($tok[0] === '(') { return $literal($tok); }
        $h = preg_replace('/\s+/', '', trim($tok, '<>'));
        return hex2bin(strlen($h) % 2 ? $h . '0' : $h) ?: '';
    };
    $emitir = function ($bytes) use (&$itens, &$tm, &$fnt, &$tam, &$ctm) {
        list($s, $larg) = pdf_decodifica_texto($bytes, $fnt);
        $esc = $tam * hypot($tm[0], $tm[1]);
        $avanco = $larg / 1000 * $esc;
        if ($s !== '') {
            $x0 = $ctm[0] * $tm[4] + $ctm[2] * $tm[5] + $ctm[4]; $y0 = $ctm[1] * $tm[4] + $ctm[3] * $tm[5] + $ctm[5];
            $x1 = $ctm[0] * ($tm[4] + $avanco) + $ctm[2] * $tm[5] + $ctm[4];
            $itens[] = [$y0, $x0, $s, abs($esc * $ctm[0]) ?: 1, $x1];
        }
        $tm[4] += $avanco;
    };
    foreach ($tk[0] as $tok) {
        $c = $tok[0];
        if ($c === '[') { $arr = []; continue; }
        if ($c === ']') { $pilha[] = $arr ?? []; $arr = null; continue; }
        if ($c === '(' || $c === '<') { if ($arr !== null) { $arr[] = $texto($tok); } else { $pilha[] = $texto($tok); } continue; }
        if ($c === '/' || is_numeric($tok)) { if ($arr !== null) { $arr[] = is_numeric($tok) ? (float)$tok : $tok; } else { $pilha[] = $c === '/' ? $tok : (float)$tok; } continue; }
        switch ($tok) {
            case 'q': $guarda[] = $ctm; break;
            case 'Q': if ($guarda) { $ctm = array_pop($guarda); } break;
            case 'cm':
                $f = (float)array_pop($pilha); $e = (float)array_pop($pilha); $d = (float)array_pop($pilha); $cc = (float)array_pop($pilha); $b = (float)array_pop($pilha); $a = (float)array_pop($pilha);
                list($A, $B, $C, $D, $E, $F) = $ctm;
                $ctm = [$a * $A + $b * $C, $a * $B + $b * $D, $cc * $A + $d * $C, $cc * $B + $d * $D, $e * $A + $f * $C + $E, $e * $B + $f * $D + $F];
                break;
            case 'BT': $tm = $lm = [1, 0, 0, 1, 0, 0]; break;
            case 'Tf': $tam = (float)(array_pop($pilha) ?: 10); $nome = ltrim((string)array_pop($pilha), '/'); $fnt = isset($fontes[$nome]) ? $obterFonte($fontes[$nome]) : ['map' => [], 'bytes' => 1, 'w' => [], 'dw' => null]; break;
            case 'TL': $lead = (float)array_pop($pilha); break;
            case 'Td': case 'TD': $ty = (float)array_pop($pilha); $tx = (float)array_pop($pilha); if ($tok === 'TD') { $lead = -$ty; }
                $lm[4] += $tx * $lm[0] + $ty * $lm[2]; $lm[5] += $tx * $lm[1] + $ty * $lm[3]; $tm = $lm; break;
            case 'Tm': $f = (float)array_pop($pilha); $e = (float)array_pop($pilha); $d = (float)array_pop($pilha); $cc = (float)array_pop($pilha); $b = (float)array_pop($pilha); $a = (float)array_pop($pilha);
                $tm = $lm = [$a, $b, $cc, $d, $e, $f]; break;
            case 'T*': $lm[4] -= $lead * $lm[2]; $lm[5] -= $lead * $lm[3]; $tm = $lm; break;
            case 'Tj': $emitir((string)array_pop($pilha)); break;
            case "'": $lm[5] -= $lead * $lm[3]; $tm = $lm; $emitir((string)array_pop($pilha)); break;
            case '"': $s = array_pop($pilha); array_pop($pilha); array_pop($pilha); $lm[5] -= $lead * $lm[3]; $tm = $lm; $emitir((string)$s); break;
            case 'TJ':
                foreach ((array)array_pop($pilha) as $e) {
                    if (is_string($e)) { $emitir($e); }
                    elseif (is_float($e)) { $tm[4] -= $e / 1000 * $tam * hypot($tm[0], $tm[1]); }   // ajuste de espaçamento (negativo = abre espaço)
                }
                break;
        }
        if (!in_array($tok, ['Tf', 'Td', 'TD', 'Tm', 'Tj', 'TJ', "'", '"', 'TL', 'T*', 'q', 'Q', 'cm'], true)) { $pilha = []; }
    }
    if (!$itens) { return ''; }
    // agrupa em linhas: mesma altura (tolerância) e ordena da esquerda para a direita
    usort($itens, function ($a, $b) { return $b[0] <=> $a[0] ?: $a[1] <=> $b[1]; });
    $linhas = []; $atual = []; $y = null;
    foreach ($itens as $it) {
        if ($y !== null && abs($it[0] - $y) > 2.5) { $linhas[] = $atual; $atual = []; }
        if (!$atual) { $y = $it[0]; }
        $atual[] = $it;
    }
    if ($atual) { $linhas[] = $atual; }
    // espaçamento normal entre linhas (percentil baixo das distâncias): distância bem maior vira uma linha em branco (separa as linhas da tabela)
    $ys = [];
    foreach ($linhas as $l) { $ys[] = $l[0][0]; }
    $dist = [];
    for ($i = 1; $i < count($ys); $i++) { $dist[] = abs($ys[$i - 1] - $ys[$i]); }
    sort($dist);
    $base = $dist ? max(1.0, $dist[(int)floor((count($dist) - 1) * 0.2)]) : 1.0;
    $out = [];
    foreach ($linhas as $idx => $l) {
        if ($idx > 0 && abs($ys[$idx - 1] - $ys[$idx]) > $base * 1.28) { $out[] = ''; }
        usort($l, function ($a, $b) { return $a[1] <=> $b[1]; });
        $s = ''; $fimX = null;
        foreach ($l as $it) {
            if ($fimX !== null && $s !== '') {
                $gap = $it[1] - $fimX;
                if ($gap > $it[3] * 1.0) { $s .= '   '; }
                elseif ($gap > $it[3] * 0.12 && substr($s, -1) !== ' ' && $it[2][0] !== ' ') { $s .= ' '; }
            }
            $s .= $it[2];
            $fimX = $it[4];
        }
        $out[] = rtrim($s);
    }
    return implode("\n", $out) . "\n";
}
