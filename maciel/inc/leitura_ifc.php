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
    if ($codigo === '' || !preg_match('/^<?\s*(V\d+[A-Za-z]?)(?:\s*-\s*(V\d+[A-Za-z]?))?\s*>?\s*\/\s*(H\d+[A-Za-z]?)(?:\s*-\s*(H\d+[A-Za-z]?))?\s*>?$/', $codigo, $m)) {
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
    $agreg = [];        // pai => [filhos]
    $eixos = ['V' => [], 'H' => []];
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
                if (preg_match("/^#\d+\s*=\s*IFCELEMENTASSEMBLY\('([^']*)',#\d+,(?:\\$|'((?:[^']|'')*)'),(?:\\$|'[^']*'),(?:\\$|'[^']*'),(?:#\d+|\\$),(?:\\$|'[^']*'),(?:\\$|'((?:[^']|'')*)')/", $linha, $m)) {
                    $assemb[$id] = [$m[1], ifc_texto($m[2] ?? ''), ifc_texto($m[3] ?? '')];
                }
                break;
            case 'IFCMECHANICALFASTENER':
                $tipo[$id] = 'f';
                break;
            case 'IFCGRIDAXIS':
                if (preg_match("/^#\d+\s*=\s*IFCGRIDAXIS\('([^']*)'/", $linha, $m) && in_array($m[1][0] ?? '', ['V', 'H'], true)) {
                    $eixos[$m[1][0]][$m[1]] = true;
                }
                break;
            default:
                if (isset($pecas[$tp])) {
                    $tipo[$id] = 'p';
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
    $conjuntos = [];
    $furos = 0;
    $falsos = 0;
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
    }
    return ['arquivo' => $nomeArq, 'conjuntos' => $conjuntos, 'eixos' => ['V' => array_keys($eixos['V']), 'H' => array_keys($eixos['H'])], 'furos' => $furos, 'falsos' => $falsos, 'tekla' => $tekla];
}
