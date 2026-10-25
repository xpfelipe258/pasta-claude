<?php
// Leitura do IFC do Tekla (padrão Rótula) dentro do sistema: lê o arquivo STEP em fluxo (uma linha de cada vez) e guarda só o que interessa.
//   ROTULA CONJUNTO  -> PHASE.NAME, ASSEMBLY NAME/MARK, WEIGHT_GROSS          Tekla Assembly -> código de posição (V23/H10-H9), cota
//   RÓTULA PARTE     -> PROFILE, MATERIAL, LENGTH, WEIGHT                       Tekla Quantity -> Net surface area, Width
//   ROTULA PARAFUSO  -> NUMBER, TIPO (BOLT conta; HOLE é só furo), PRF_NAME     Tekla Bolt     -> arruelas, porcas, Location (Site = obra)
require_once __DIR__ . '/leitura_util.php';

function ifc_texto($s)
{
    $s = str_replace("''", "'", $s);
    if (strpos($s, '\\') === false) {
        return $s;
    }
    $s = preg_replace_callback('/\\\\X2\\\\((?:[0-9A-Fa-f]{4})+)\\\\X0\\\\/', function ($m) {
        return mb_convert_encoding(pack('H*', $m[1]), 'UTF-8', 'UTF-16BE');
    }, $s);
    $s = preg_replace_callback('/\\\\S\\\\(.)/s', function ($m) {          // \S\c = caractere ISO-8859-1 de código (c + 128), ex. \S\S = Ó
        return mb_convert_encoding(chr((ord($m[1]) + 128) & 255), 'UTF-8', 'ISO-8859-1');
    }, $s);
    return preg_replace_callback('/\\\\X\\\\([0-9A-Fa-f]{2})/', function ($m) {
        return mb_convert_encoding(chr(hexdec($m[1])), 'UTF-8', 'ISO-8859-1');
    }, $s);
}

function ifc_posicao($codigo)
{
    $codigo = trim((string)$codigo);
    // "V23/H10-H9" (eixos V e H) ou "05/B1-B" / "05-05a/C-B2" (eixo numerado / letras): antes da barra, o(s) eixo(s) de um sentido; depois, o(s) do outro.
    if ($codigo === '' || !preg_match('/^<?\s*([A-Za-z0-9]+)(?:\s*-\s*([A-Za-z0-9]+))?\s*\/\s*([A-Za-z0-9]+)(?:\s*-\s*([A-Za-z0-9]+))?\s*>?$/', $codigo, $m)) {
        return null;
    }
    return ['v' => [$m[1], ($m[2] ?? '') !== '' ? $m[2] : $m[1]], 'h' => [$m[3], ($m[4] ?? '') !== '' ? $m[4] : $m[3]]];
}

function ifc_eixo_num($r)
{
    return preg_match('/(\d+)/', (string)$r, $m) ? (int)$m[1] : 0;
}

function ifc_fase_info($fase)
{
    return preg_match('/^\s*(\d+(?:\.\d+)+)\s+(.*)$/u', trim((string)$fase), $m) ? [$m[1], trim($m[2])] : ['', trim((string)$fase)];
}

function ifc_tipo_fixador($nome)
{
    $n = mb_strtoupper((string)$nome, 'UTF-8');
    return strpos($n, 'ARRUELA') !== false ? 'arruela' : (strpos($n, 'PORCA') !== false ? 'porca' : 'parafuso');
}

function ifc_falso($nome)
{
    return strpos(mb_strtoupper((string)$nome, 'UTF-8'), 'FALSA') !== false;
}

// Argumentos STEP, respeitando strings escapadas e listas aninhadas.
function ifc_argumentos($linha)
{
    $a = strpos($linha, '('); $b = strrpos($linha, ')');
    if ($a === false || $b === false) return [];
    $s = substr($linha, $a + 1, $b - $a - 1);
    $out = []; $parte = ''; $texto = false; $nivel = 0;
    for ($i = 0, $n = strlen($s); $i < $n; $i++) {
        $c = $s[$i];
        if ($c === "'") {
            if ($texto && ($s[$i + 1] ?? '') === "'") { $parte .= "''"; $i++; continue; }
            $texto = !$texto;
        }
        if (!$texto) {
            if ($c === '(') $nivel++;
            if ($c === ')') $nivel--;
            if ($c === ',' && $nivel === 0) { $out[] = trim($parte); $parte = ''; continue; }
        }
        $parte .= $c;
    }
    $out[] = trim($parte);
    return array_map(function ($v) { return $v === '$' ? '' : (substr($v,0,1) === "'" ? ifc_texto(substr($v,1,-1)) : $v); }, $out);
}

/**
 * Lê um .ifc e devolve ['conjuntos' => [...], 'eixos' => ['V' => [...], 'H' => [...]], 'furos' => n, 'tekla' => bool].
 * Cada conjunto traz as peças e os parafusos agregados dele (fix = [[tipo, nome, qtd], ...]).
 */
function ifc_ler_arquivo($caminho, $nomeArq = '')
{
    $interesse = ['PHASE.NAME', 'ASSEMBLY NAME', 'ASSEMBLY MARK', 'WEIGHT_GROSS', 'Assembly/Cast unit position code', 'Assembly/Cast unit bottom elevation', 'Assembly/Cast unit weight',
        'Assembly/Cast unit Mark', 'PROFILE', 'MATERIAL', 'LENGTH', 'WEIGHT', 'NAME', 'NUMBER', 'TIPO', 'PRF_NAME', 'Washer name', 'Washer count', 'Nut name', 'Nut count', 'Location',
        'Bolt count', 'Net surface area', 'Width'];
    $interesse = array_flip($interesse);
    $psetsOk = ['ROTULA CONJUNTO' => 'rc', 'Tekla Assembly' => 'ta', 'RÓTULA PARTE' => 'pa', 'ROTULA PARTE' => 'pa', 'ROTULA PARAFUSO' => 'pp', 'Tekla Bolt' => 'tb', 'Tekla Quantity' => 'tq'];
    $f = fopen($caminho, 'rb');
    if (!$f) {
        throw new RuntimeException('Não consegui abrir o IFC.');
    }
    $psv = [];          // id => [nome, valor]
    $pset = [];         // id => [chave, [ids das propriedades]]
    $psetsDe = [];      // objeto => [ids dos psets]
    $assemb = [];       // id => [guid, nome, tag]
    $tipo = [];         // id => 'p' (peça) | 'f' (parafuso)
    $avulsas = [];
    $agreg = [];        // pai => [filhos]
    $eixos = ['V' => [], 'H' => []];
    $pontos = $dirs = $eixoPl = $colocacao = $pecaPl = $poly = [];   // geometria: pontos, direções, sistemas de eixo, colocações (para a planta do mapa de apontamento)
    $grades = [];       // IfcGrid: [colocação, [ids dos eixos U], [ids dos eixos V]]
    $eixosGrade = [];   // id => [nome, id da polilinha]
    $tekla = false;
    $pecas = ['IFCBEAM' => 1, 'IFCCOLUMN' => 1, 'IFCMEMBER' => 1, 'IFCPLATE' => 1, 'IFCFOOTING' => 1, 'IFCSLAB' => 1, 'IFCBUILDINGELEMENTPROXY' => 1, 'IFCSTAIR' => 1, 'IFCRAMP' => 1];
    $buf = '';
    while (($linha = fgets($f)) !== false) {
        if ($buf !== '') {
            $linha = $buf . $linha;
            $buf = '';
        }
        $linha = rtrim($linha);
        if ($linha === '' || $linha[0] !== '#') {
            if (!$tekla && stripos($linha, 'tekla') !== false) {
                $tekla = true;
            }
            continue;
        }
        if (substr($linha, -1) !== ';') {
            $buf = $linha;          // entidade quebrada em várias linhas
            continue;
        }
        $eq = strpos($linha, '=');
        $ab = strpos($linha, '(', $eq);
        if ($eq === false || $ab === false) {
            continue;
        }
        $tp = strtoupper(trim(substr($linha, $eq + 1, $ab - $eq - 1)));
        $id = (int)substr($linha, 1, $eq - 1);
        switch ($tp) {
            case 'IFCPROPERTYSINGLEVALUE':
                if (!preg_match("/^#\d+\s*=\s*IFCPROPERTYSINGLEVALUE\('((?:[^']|'')*)',(?:\\$|'(?:[^']|'')*'),(?:IFC\w+\()?('(?:[^']|'')*'|[^)]*)\)?/", $linha, $m)) {
                    break;
                }
                $nome = ifc_texto($m[1]);
                if (!isset($interesse[$nome])) {
                    break;
                }
                $v = $m[2];
                $psv[$id] = [$nome, $v !== '' && $v[0] === "'" ? ifc_texto(substr($v, 1, -1)) : (is_numeric($v) ? $v + 0 : trim($v, '.'))];
                break;
            case 'IFCPROPERTYSET':
                if (preg_match("/^#\d+\s*=\s*IFCPROPERTYSET\('[^']*',#\d+,'((?:[^']|'')*)',(?:\\$|'[^']*'),\((.*)\)\);/", $linha, $m)) {
                    $n = ifc_texto($m[1]);
                    if (isset($psetsOk[$n])) {
                        preg_match_all('/#(\d+)/', $m[2], $ids);
                        $pset[$id] = [$psetsOk[$n], array_map('intval', $ids[1])];
                    }
                }
                break;
            case 'IFCRELDEFINESBYPROPERTIES':
                if (preg_match('/^#\d+\s*=\s*IFCRELDEFINESBYPROPERTIES\(\'[^\']*\',#\d+,[^,]*,[^,]*,\(([^)]*)\),#(\d+)\);/', $linha, $m) && isset($pset[(int)$m[2]])) {
                    preg_match_all('/#(\d+)/', $m[1], $objs);
                    foreach ($objs[1] as $o) {
                        $psetsDe[(int)$o][] = (int)$m[2];
                    }
                }
                break;
            case 'IFCRELAGGREGATES':
                if (preg_match('/^#\d+\s*=\s*IFCRELAGGREGATES\(\'[^\']*\',#\d+,[^,]*,[^,]*,#(\d+),\(([^)]*)\)\);/', $linha, $m)) {
                    preg_match_all('/#(\d+)/', $m[2], $fi);
                    foreach ($fi[1] as $c) {
                        $agreg[(int)$m[1]][] = (int)$c;
                    }
                }
                break;
            case 'IFCELEMENTASSEMBLY':
                $args = ifc_argumentos($linha);
                if (!empty($args[0])) $assemb[$id] = [$args[0], $args[2] ?? '', $args[7] ?? '', (int)ltrim((string)($args[5] ?? ''), '#')];
                break;
            case 'IFCMECHANICALFASTENER':
                $tipo[$id] = 'f';
                break;
            case 'IFCGRIDAXIS':
                if (preg_match("/^#\d+\s*=\s*IFCGRIDAXIS\('([^']*)',#(\d+)/", $linha, $m)) {
                    $eixosGrade[$id] = [ifc_texto($m[1]), (int)$m[2]];
                    if (in_array($m[1][0] ?? '', ['V', 'H'], true)) {
                        $eixos[$m[1][0]][$m[1]] = true;
                    }
                }
                break;
            case 'IFCGRID':
                $ga = ifc_argumentos($linha);
                if (count($ga) >= 9) {
                    preg_match_all('/#(\d+)/', $ga[7], $gu); preg_match_all('/#(\d+)/', $ga[8], $gv);
                    $grades[] = [(int)ltrim((string)$ga[5], '#'), array_map('intval', $gu[1]), array_map('intval', $gv[1])];
                }
                break;
            case 'IFCPOLYLINE':
                if (preg_match_all('/#(\d+)/', $linha, $mm) && count($mm[1]) > 1) {
                    $ids = $mm[1]; array_shift($ids);   // o primeiro #n é o próprio id da linha
                    $poly[$id] = array_slice(array_map('intval', $ids), 0, 2);
                }
                break;
            case 'IFCCARTESIANPOINT':
                if (count($pontos) < 1500000 && preg_match('/\(\(([^)]*)\)\)/', $linha, $m)) {
                    $pontos[$id] = array_map('floatval', explode(',', $m[1]));
                }
                break;
            case 'IFCDIRECTION':
                if (preg_match('/\(\(([^)]*)\)\)/', $linha, $m)) {
                    $dirs[$id] = array_map('floatval', explode(',', $m[1]));
                }
                break;
            case 'IFCAXIS2PLACEMENT3D':
            case 'IFCAXIS2PLACEMENT2D':
                if (preg_match('/\(#(\d+)(?:,(#\d+|\$))?(?:,(#\d+|\$))?\)/', $linha, $m)) {
                    $x3 = $tp === 'IFCAXIS2PLACEMENT3D';
                    $eixoPl[$id] = [(int)$m[1], $x3 && ($m[2] ?? '$') !== '$' ? (int)ltrim($m[2], '#') : 0,
                        ($x3 ? ($m[3] ?? '$') : ($m[2] ?? '$')) !== '$' ? (int)ltrim($x3 ? $m[3] : $m[2], '#') : 0];
                }
                break;
            case 'IFCLOCALPLACEMENT':
                if (preg_match('/\((#(\d+)|\$),#(\d+)\)/', $linha, $m)) {
                    $colocacao[$id] = [(int)($m[2] ?? 0), (int)$m[3]];
                }
                break;
            default:
                if (isset($pecas[$tp])) {
                    $tipo[$id] = 'p';
                    $args = ifc_argumentos($linha);
                    if (!empty($args[0])) $avulsas[$id] = [$args[0], $args[2] ?? '', $args[7] ?? '', (int)ltrim((string)($args[5] ?? ''), '#')];
                    $pecaPl[$id] = (int)ltrim((string)($args[5] ?? ''), '#');
                }
        }
    }
    fclose($f);

    // propriedades de cada objeto: chave do pset => [nome => valor]
    $props = function ($obj) use (&$psetsDe, &$pset, &$psv) {
        $r = [];
        foreach ($psetsDe[$obj] ?? [] as $pid) {
            list($chave, $ids) = $pset[$pid];
            foreach ($ids as $i) {
                if (isset($psv[$i])) {
                    $r[$chave][$psv[$i][0]] = $psv[$i][1];
                }
            }
        }
        return $r;
    };
    // ---- posição das peças no plano: colocação absoluta (matriz 3×3 + origem), levada para o sistema da malha (IfcGrid) do projeto
    $memo = [];
    $abs = function ($lid) use (&$abs, &$colocacao, &$eixoPl, &$pontos, &$dirs, &$memo) {
        if (isset($memo[$lid])) return $memo[$lid];
        $cp = $colocacao[$lid] ?? null;
        $ep = $cp ? ($eixoPl[$cp[1]] ?? null) : null;
        if (!$ep) return $memo[$lid] = null;
        $nrm = function ($v) { $n = sqrt($v[0] * $v[0] + $v[1] * $v[1] + $v[2] * $v[2]); return $n > 1e-12 ? [$v[0] / $n, $v[1] / $n, $v[2] / $n] : $v; };
        $o = $pontos[$ep[0]] ?? [0, 0, 0]; $o += [0, 0, 0];
        $z = $ep[1] && isset($dirs[$ep[1]]) ? $nrm($dirs[$ep[1]] + [0, 0, 0]) : [0, 0, 1];
        $x = $ep[2] && isset($dirs[$ep[2]]) ? ($dirs[$ep[2]] + [0, 0, 0]) : [1, 0, 0];
        $d = $x[0] * $z[0] + $x[1] * $z[1] + $x[2] * $z[2];
        $x = $nrm([$x[0] - $d * $z[0], $x[1] - $d * $z[1], $x[2] - $d * $z[2]]);
        $y = [$z[1] * $x[2] - $z[2] * $x[1], $z[2] * $x[0] - $z[0] * $x[2], $z[0] * $x[1] - $z[1] * $x[0]];
        if ($cp[0] && ($pa = $abs($cp[0]))) {
            list($po, $px, $py, $pz) = $pa;
            $f = function ($v) use ($px, $py, $pz) { return [$px[0] * $v[0] + $py[0] * $v[1] + $pz[0] * $v[2], $px[1] * $v[0] + $py[1] * $v[1] + $pz[1] * $v[2], $px[2] * $v[0] + $py[2] * $v[1] + $pz[2] * $v[2]]; };
            $fo = $f($o);
            return $memo[$lid] = [[$po[0] + $fo[0], $po[1] + $fo[1], $po[2] + $fo[2]], $f($x), $f($y), $f($z)];
        }
        return $memo[$lid] = [$o, $x, $y, $z];
    };
    $gOrig = [0, 0, 0]; $gX = [1, 0, 0]; $gY = [0, 1, 0]; $temGrade = false; $linhasMalha = [];
    foreach ($grades as $g) {   // a primeira grade com eixos define o sistema da planta (as demais repetem os mesmos eixos em outras cotas)
        $ga = $abs($g[0]);
        if (!$ga && !$g[1] && !$g[2]) continue;
        if ($ga) { $gOrig = $ga[0]; $gX = $ga[1]; $gY = $ga[2]; $temGrade = true; }
        foreach (array_merge($g[1], $g[2]) as $eid) {
            $ea = $eixosGrade[$eid] ?? null;
            $pp = $ea ? ($poly[$ea[1]] ?? null) : null;
            if (!$pp || count($pp) < 2 || !isset($pontos[$pp[0]], $pontos[$pp[1]])) continue;
            $a = $pontos[$pp[0]] + [0, 0, 0]; $b = $pontos[$pp[1]] + [0, 0, 0];
            $linhasMalha[] = [$ea[0], (int)round($a[0]), (int)round($a[1]), (int)round($b[0]), (int)round($b[1])];
        }
        if ($linhasMalha) break;
    }
    $vx = $hy = [];   // coordenada de cada eixo da malha (pelo nome): V = linha de x constante, H = linha de y constante
    foreach ($linhasMalha as $l) {
        if (abs($l[1] - $l[3]) <= abs($l[2] - $l[4])) $vx[$l[0]] = ($l[1] + $l[3]) / 2; else $hy[$l[0]] = ($l[2] + $l[4]) / 2;
    }
    $daPosicao = function ($pos) use (&$vx, &$hy) {   // quando o IFC não dá a colocação da peça: usa o código de posição (eixos) do Tekla
        if (!$pos || (!$vx && !$hy)) return null;
        $ns = array_values(array_unique(array_merge($pos['v'], $pos['h'])));
        $v = array_values(array_unique(array_filter($ns, function ($n) use (&$vx) { return isset($vx[$n]); })));
        $h = array_values(array_unique(array_filter($ns, function ($n) use (&$hy) { return isset($hy[$n]); })));
        if (!$v || !$h) return null;
        $x1 = $vx[$v[0]]; $x2 = $vx[end($v)]; $y1 = $hy[$h[0]]; $y2 = $hy[end($h)];
        return [(int)round(($x1 + $x2) / 2 - (count($v) > 1 ? ($x2 - $x1) / 2 : 0)), (int)round(($y1 + $y2) / 2 - (count($h) > 1 ? ($y2 - $y1) / 2 : 0)), count($v) > 1 ? (int)round($x2 - $x1) : 0, count($h) > 1 ? (int)round($y2 - $y1) : 0];
    };
    $noPlano = function ($pecaId, $fallbackPl) use (&$abs, &$pecaPl, &$gOrig, &$gX, &$gY, $temGrade, &$pontos, &$dirs, &$eixoPl, &$colocacao, $props) {
        $lid = $pecaId ? ($pecaPl[$pecaId] ?? 0) : 0;
        $a = ($lid ? $abs($lid) : null) ?: ($fallbackPl ? $abs($fallbackPl) : null);
        if (!$a) return null;
        $dx = [$a[0][0] - $gOrig[0], $a[0][1] - $gOrig[1], $a[0][2] - $gOrig[2]];
        $proj = function ($v) use ($gX, $gY) { return [$v[0] * $gX[0] + $v[1] * $gX[1] + $v[2] * $gX[2], $v[0] * $gY[0] + $v[1] * $gY[1] + $v[2] * $gY[2]]; };
        $p = $proj($dx);
        $e = $proj($a[3]);   // eixo do elemento (extrusão ao longo do Z local), no plano da malha
        return [$p, $e];
    };
    $conjuntos = [];
    $furos = 0;
    $falsos = 0;
    $pertenceConjunto = [];
    foreach (array_keys($assemb) as $pai) {
        $fila = [$pai]; $visitados = [];
        while ($fila) {
            $x = array_pop($fila);
            if (isset($visitados[$x])) continue;
            $visitados[$x] = true;
            foreach ($agreg[$x] ?? [] as $filho) { $pertenceConjunto[$filho] = true; $fila[] = $filho; }
        }
    }
    foreach ($assemb as $aid => $a) {
        $ps = $props($aid);
        $rc = $ps['rc'] ?? [];
        $ta = $ps['ta'] ?? [];
        $fase = trim((string)($rc['PHASE.NAME'] ?? ''));
        $nome = trim((string)($rc['ASSEMBLY NAME'] ?? $a[1]));
        $marca = (string)($rc['ASSEMBLY MARK'] ?? $ta['Assembly/Cast unit Mark'] ?? $a[2]);
        $peso = $rc['WEIGHT_GROSS'] ?? $ta['Assembly/Cast unit weight'] ?? 0;
        $perfil = $material = '';
        $comp = $area = $larg = 0.0;
        $pesoMain = -1.0;
        $mainId = 0;
        $fix = [];
        $filhos = [];       // peças e parafusos diretos; as peças de subconjuntos também contam para o perfil principal
        $fila = [[$aid, 0]];
        while ($fila) {
            list($pai, $nivel) = array_shift($fila);
            foreach ($agreg[$pai] ?? [] as $c) {
                if (isset($assemb[$c])) {
                    if ($nivel < 3) {
                        $fila[] = [$c, $nivel + 1];
                    }
                } else {
                    $filhos[] = [$c, $nivel];
                }
            }
        }
        foreach ($filhos as list($c, $nivel)) {
            $t = $tipo[$c] ?? 'p';
            if ($t === 'f' && $nivel === 0) {
                $pc = $props($c);
                $pp = $pc['pp'] ?? [];
                $tb = $pc['tb'] ?? [];
                if (strtoupper((string)($pp['TIPO'] ?? '')) === 'HOLE') {
                    $furos++;
                    continue;
                }
                if ((string)($tb['Location'] ?? 'Site') !== 'Site') {
                    continue;           // montado na oficina: não é parafuso de obra
                }
                $nm = (string)($pp['PRF_NAME'] ?? '');
                $q = (int)($pp['NUMBER'] ?? $tb['Bolt count'] ?? 1);
                if ($nm !== '') {
                    if (!ifc_falso($nm)) {
                        $fix[] = ['parafuso', $nm, $q];
                    } else {
                        $falsos += $q;
                    }
                }
                foreach ([['Washer name', 'Washer count'], ['Nut name', 'Nut count']] as $par) {
                    $nn = (string)($tb[$par[0]] ?? '');
                    $qq = (int)($tb[$par[1]] ?? 0);
                    if ($nn !== '' && $qq) {
                        if (ifc_falso($nn)) {
                            $falsos += $qq;
                        } else {
                            $fix[] = [ifc_tipo_fixador($nn), $nn, $qq];
                        }
                    }
                }
            } elseif ($t === 'p') {
                $pc = $props($c);
                $pa = $pc['pa'] ?? [];
                $p = (float)($pa['WEIGHT'] ?? 0);
                if ($pa && $p > $pesoMain) {
                    $pesoMain = $p;
                    $mainId = $c;
                    $perfil = (string)($pa['PROFILE'] ?? '');
                    $material = (string)($pa['MATERIAL'] ?? '');
                    $comp = (float)($pa['LENGTH'] ?? 0);
                    $tq = $pc['tq'] ?? [];
                    $area = (float)($tq['Net surface area'] ?? 0);
                    $larg = (float)($tq['Width'] ?? 0);
                }
            }
        }
        $conjuntos[] = ['guid' => $a[0], 'fase' => $fase, 'produto' => $nome, 'marca' => $marca, 'perfil' => $perfil, 'material' => $material,
            'comprimento_mm' => round($comp, 1), 'largura_mm' => round($larg, 1), 'area_m2' => round($area, 3), 'peso_kg' => round((float)$peso, 3),
            'pos' => ifc_posicao($ta['Assembly/Cast unit position code'] ?? ''), 'fix' => $fix];
        $xy = $noPlano($mainId, $a[3]);
        $q = null;
        if ($xy) {
            $len = (float)$comp;
            $q = [(int)round($xy[0][0]), (int)round($xy[0][1]), (int)round($xy[1][0] * $len), (int)round($xy[1][1] * $len)];
            if (abs($xy[0][0]) < 1 && abs($xy[0][1]) < 1) $q = null;   // colocação "zerada" (peça sem posição própria no modelo)
        }
        $q = $q ?: $daPosicao($conjuntos[count($conjuntos) - 1]['pos']);
        if ($q) $conjuntos[count($conjuntos) - 1]['xy'] = $q;
    }
    // Exportações sem IfcElementAssembly também entram no mapa. Componentes de conjuntos
    // já contabilizados não viram uma segunda peça/baixa.
    foreach ($avulsas as $id => $a) {
        if (isset($pertenceConjunto[$id])) continue;
        $ps = $props($id); $rc = $ps['rc'] ?? []; $pa = $ps['pa'] ?? []; $ta = $ps['ta'] ?? []; $tq = $ps['tq'] ?? [];
        $conjuntos[] = ['guid'=>$a[0], 'fase'=>(string)($rc['PHASE.NAME'] ?? ''), 'produto'=>(string)($rc['ASSEMBLY NAME'] ?? $pa['NAME'] ?? $a[1]),
            'marca'=>(string)($rc['ASSEMBLY MARK'] ?? $ta['Assembly/Cast unit Mark'] ?? $a[2]), 'perfil'=>(string)($pa['PROFILE'] ?? ''), 'material'=>(string)($pa['MATERIAL'] ?? ''),
            'comprimento_mm'=>(float)($pa['LENGTH'] ?? 0), 'largura_mm'=>(float)($tq['Width'] ?? 0), 'area_m2'=>(float)($tq['Net surface area'] ?? 0),
            'peso_kg'=>(float)($rc['WEIGHT_GROSS'] ?? $pa['WEIGHT'] ?? 0), 'pos'=>ifc_posicao($ta['Assembly/Cast unit position code'] ?? ''), 'fix'=>[], 'elemento_avulso'=>true];
        $xy = $noPlano($id, $a[3]);
        $q = null;
        if ($xy) { $len = (float)($pa['LENGTH'] ?? 0); $q = [(int)round($xy[0][0]), (int)round($xy[0][1]), (int)round($xy[1][0] * $len), (int)round($xy[1][1] * $len)]; if (abs($xy[0][0]) < 1 && abs($xy[0][1]) < 1) $q = null; }
        $q = $q ?: $daPosicao($conjuntos[count($conjuntos) - 1]['pos']);
        if ($q) $conjuntos[count($conjuntos) - 1]['xy'] = $q;
    }
    return ['arquivo' => $nomeArq, 'conjuntos' => $conjuntos, 'eixos' => ['V' => array_keys($eixos['V']), 'H' => array_keys($eixos['H'])], 'furos' => $furos, 'falsos' => $falsos, 'tekla' => $tekla, 'linhas_malha' => $linhasMalha];
}
