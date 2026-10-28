<?php
// Leitura dos documentos da obra dentro do sistema: orçamento/BM, cronograma e lista de fixadores.
// Mesma lógica do serviço Python (servico_leitura/leitores), que continua opcional.
require_once __DIR__ . '/leitura_util.php';

// ---------------------------------------------------------------- orçamento / memorial do BM

function lo_codigo($v)
{
    if (is_int($v) || is_float($v)) {
        return null;
    }
    return preg_match('/^\s*(\d+(?:[.,]\d+)*)\s*$/', lt_texto($v), $m) ? str_replace(',', '.', $m[1]) : null;
}

function lo_cabecalho(array $linhas)
{
    foreach (array_slice($linhas, 0, 30, true) as $i => $l) {
        $cel = array_map('lt_up', $l);
        $ci = null;
        foreach ($cel as $j => $c) {
            if (in_array($c, ['ITEM', 'ÍTEM', 'ITEM DE VENDA'], true)) {
                $ci = $j;
                break;
            }
        }
        $cd = null;
        foreach ($cel as $j => $c) {
            if (strpos($c, 'DESCRI') !== false) {
                $cd = $j;
                break;
            }
        }
        if ($ci === null || $cd === null) {
            continue;
        }
        $col = ['item' => $ci, 'desc' => $cd];
        foreach (array_slice($linhas, $i, 5) as $l2) {
            foreach ($l2 as $j => $c) {
                $u = lt_up($c);
                if (in_array($u, ['QTD', 'QTD.', 'QUANTIDADE', 'QTDE', 'QTDE.'], true) && !isset($col['qtd'])) {
                    $col['qtd'] = $j;
                } elseif ((strpos($u, 'UNIDADE') === 0 || in_array($u, ['UN', 'UND'], true)) && !isset($col['un'])) {
                    $col['un'] = $j;
                } elseif ((strpos($u, 'VALOR %') === 0 || $u === '% VALOR') && !isset($col['valor_pct'])) {
                    $col['valor_pct'] = $j;
                } elseif (strpos($u, 'PESO') === 0 && strpos($u, 'ATV') !== false && !isset($col['peso'])) {
                    $col['peso'] = $j;
                }
            }
        }
        if (isset($col['qtd'], $col['valor_pct'])) {
            return [$i, $col];
        }
    }
    return [null, null];
}

function lo_memorial(array $linhas)
{
    list($i0, $col) = lo_cabecalho($linhas);
    if ($col === null) {
        return null;
    }
    $total = null;
    $itens = [];
    $atual = null;
    foreach (array_slice($linhas, $i0 + 1) as $l) {
        $g = function ($k) use ($l, $col) { return isset($col[$k]) ? ($l[$col[$k]] ?? null) : null; };
        $desc = lt_texto($g('desc'));
        if ($total === null && strpos(mb_strtoupper($desc, 'UTF-8'), 'TOTAL DO CONTRATO') !== false) {
            foreach ($l as $c) {
                $n = lt_numero($c);
                if ($n !== null && $n > 1000) {
                    $total = $n;
                    break;
                }
            }
            continue;
        }
        $cod = lo_codigo($g('item'));
        $q = lt_numero($g('qtd'));
        $f = lt_numero($g('valor_pct'));
        if ($cod) {
            $itens[] = ['codigo' => $cod, 'descricao' => $desc, 'qtd' => $q, 'unidade' => lt_unidade($g('un')), 'valor_pct' => $f ?: 0.0, 'atividades' => []];
            $atual = count($itens) - 1;
        } elseif ($atual !== null && $desc !== '' && $q !== null) {
            $itens[$atual]['atividades'][] = ['descricao' => $desc, 'qtd' => $q, 'unidade' => lt_unidade($g('un')), 'valor_pct' => $f ?: 0.0, 'peso' => (isset($col['peso']) ? lt_numero($g('peso')) : null) ?: 0.0];
        }
    }
    return $itens ? ['total' => $total, 'itens' => $itens] : null;
}

function lo_periodos(array $linhas)
{
    $ach = [];
    foreach (array_slice($linhas, 0, 15) as $l) {
        foreach ($l as $c) {
            if (preg_match('/^\s*BM\s*(\d+)\s*[-–]\s*(\d{2}\/\d{2}\/\d{2,4})/iu', lt_texto($c), $m)) {
                $ach[(int)$m[1]] = lt_data_iso($m[2]);
            }
        }
    }
    ksort($ach);
    $saida = [];
    $ultimo = '';
    foreach ($ach as $k => $v) {
        if ($v && $v < $ultimo) {
            break;      // colunas de modelo sem uso (datas que voltam no tempo)
        }
        $saida[] = ['bm' => $k, 'corte' => $v];
        $ultimo = $v ?: $ultimo;
    }
    return $saida;
}

function lo_escopo(array $linhas)
{
    foreach (array_slice($linhas, 0, 60, true) as $i => $l) {
        $cel = array_map('lt_up', $l);
        $ci = array_search('ITEM', $cel, true);
        $cd = $cq = $cu = $cf = null;
        foreach ($cel as $j => $c) {
            if ($cd === null && strpos($c, 'DESCRI') !== false) { $cd = $j; }
            if ($cq === null && strpos($c, 'QTD') === 0) { $cq = $j; }
            if ($cu === null && strpos($c, 'UNID') === 0) { $cu = $j; }
            if ($cf === null && strpos($c, 'FORNEC') === 0) { $cf = $j; }
        }
        if ($ci === false || $cd === null || $cq === null) {
            continue;
        }
        $itens = [];
        foreach (array_slice($linhas, $i + 1) as $l2) {
            $cod = lo_codigo($l2[$ci] ?? null);
            $q = lt_numero($l2[$cq] ?? null);
            if (!$cod || $q === null) {
                continue;
            }
            $itens[] = ['codigo' => $cod, 'descricao' => lt_texto($l2[$cd] ?? ''), 'qtd' => $q, 'unidade' => $cu !== null ? lt_unidade($l2[$cu] ?? '') : '', 'fornecedor' => $cf !== null ? lt_texto($l2[$cf] ?? '') : ''];
        }
        if ($itens) {
            return $itens;
        }
    }
    return [];
}

function leitura_orcamento($caminho)
{
    $abas = xlsx_ler($caminho);
    $memorial = null;
    $periodos = [];
    $escopo = [];
    $aba = '';
    foreach ($abas as $a) {
        if ($memorial === null) {
            $m = lo_memorial($a['linhas']);
            if ($m) {
                foreach ($m['itens'] as $it) {
                    if ($it['atividades']) {
                        $memorial = $m;
                        $aba = $a['nome'];
                        break;
                    }
                }
            }
        }
        if (!$periodos && !preg_match('/^(PESO|MC)/i', $a['nome'])) {
            $periodos = lo_periodos($a['linhas']);
        }
        if (!$escopo) {
            $escopo = lo_escopo($a['linhas']);
        }
    }
    $avisos = [];
    $saida = ['aba' => $aba, 'periodos' => $periodos, 'escopo' => $escopo, 'avisos' => &$avisos, 'contrato_total' => null, 'itens' => []];
    if ($memorial === null) {
        if ($escopo) {
            $avisos[] = 'Só encontrei o escopo (itens e quantidades): as atividades de medição precisam ser detalhadas depois.';
            $saida['itens'] = array_map(function ($i) { return $i + ['atividades' => [], 'valor' => 0.0]; }, $escopo);
        } else {
            $avisos[] = 'Não reconheci a estrutura da planilha (item, descrição, quantidade, unidade, valor %).';
        }
        return $saida;
    }
    $total = (float)($memorial['total'] ?? 0);
    $saida['contrato_total'] = $total;
    $itens = $memorial['itens'];
    $vistos = [];
    foreach ($itens as $k => &$it) {            // código repetido na planilha: o repetido recebe o número que falta na sequência
        if (isset($vistos[$it['codigo']])) {
            $partes = explode('.', $it['codigo']);
            $ant = explode('.', $itens[$k - 1]['codigo']);
            $novo = count($ant) === count($partes) && ctype_digit(end($ant)) ? implode('.', array_merge(array_slice($partes, 0, -1), [(int)end($ant) + 1])) : $it['codigo'] . 'b';
            while (isset($vistos[$novo])) {
                $novo .= 'b';
            }
            $avisos[] = 'O item ' . $it['codigo'] . ' aparece duas vezes na planilha (' . mb_substr($it['descricao'], 0, 40) . '); o segundo foi numerado ' . $novo . '.';
            $it['codigo'] = $novo;
        }
        $vistos[$it['codigo']] = true;
    }
    unset($it);
    $codigos = array_column($itens, 'codigo');
    $folhas = [];
    foreach ($itens as $it) {
        $temFilhos = false;
        foreach ($codigos as $c) {
            if ($c !== $it['codigo'] && strpos($c, $it['codigo'] . '.') === 0) {
                $temFilhos = true;
                break;
            }
        }
        if (!$it['atividades'] && $temFilhos) {
            continue;                           // seção (3, 3.1, 3.2): só agrupa
        }
        $somaPct = array_sum(array_column($it['atividades'], 'valor_pct'));
        $va = $somaPct * $total;
        $it['valor'] = round($va ?: $it['valor_pct'] * $total, 2);
        $somaPesos = array_sum(array_column($it['atividades'], 'peso'));
        foreach ($it['atividades'] as &$a) {
            $a['valor'] = round($a['valor_pct'] * $total, 2);
            if (!$a['peso']) {
                $a['peso'] = $somaPct ? $a['valor_pct'] / $somaPct : 1.0 / count($it['atividades']);
            }
        }
        unset($a);
        if ($it['atividades'] && $somaPesos && abs($somaPesos - 1) > 0.01) {
            foreach ($it['atividades'] as &$a) {
                $a['peso'] = round($a['peso'] / $somaPesos, 6);
            }
            unset($a);
        }
        $folhas[] = $it;
    }
    $somaItens = round(array_sum(array_column($folhas, 'valor')), 2);
    if ($total && abs($somaItens - $total) / $total > 0.02) {
        $avisos[] = 'A soma dos itens lidos (R$ ' . number_format($somaItens, 2, ',', '.') . ') difere do total do contrato (R$ ' . number_format($total, 2, ',', '.') . '): confira os valores.';
    }
    $sem = array_column(array_filter($folhas, function ($i) { return !$i['atividades']; }), 'codigo');
    if ($sem) {
        $avisos[] = 'Itens sem atividades de medição: ' . implode(', ', array_slice($sem, 0, 12));
    }
    $saida['itens'] = $folhas;
    return $saida;
}

// ---------------------------------------------------------------- cronograma

function leitura_cronograma($caminho, $nomeArq)
{
    $ext = strtolower(pathinfo($nomeArq, PATHINFO_EXTENSION));
    $avisos = [];
    $ativ = [];
    if ($ext === 'xml') {
        $x = @simplexml_load_file($caminho);
        if ($x) {
            foreach ($x->xpath('//*[local-name()="Task"]') as $t) {
                $n = lt_texto($t->xpath('*[local-name()="Name"]')[0] ?? '');
                $ini = lt_data_iso(substr(lt_texto($t->xpath('*[local-name()="Start"]')[0] ?? ''), 0, 10));
                $fim = lt_data_iso(substr(lt_texto($t->xpath('*[local-name()="Finish"]')[0] ?? ''), 0, 10));
                $resumo = lt_texto($t->xpath('*[local-name()="Summary"]')[0] ?? '') === '1';
                if ($n === '' || !$ini || !$fim || $resumo) {
                    continue;
                }
                $ativ[] = ['ordem' => count($ativ) + 1, 'item' => lt_texto($t->xpath('*[local-name()="WBS"]')[0] ?? ''), 'nome' => $n, 'setor' => '', 'inicio' => $ini, 'fim' => $fim, 'qtd' => null, 'produtividade_dia' => null];
            }
        }
    } elseif (in_array($ext, ['xlsx', 'xlsm'], true)) {
        $melhor = [];
        foreach (xlsx_ler($caminho, 3000, 14) as $a) {
            $linhas = $a['linhas'];
            $cab = null;
            foreach (array_slice($linhas, 0, 40, true) as $i => $l) {
                $cel = array_map('lt_up', $l);
                $nome = $ini = $fim = $prod = $qtd = $it = null;
                foreach ($cel as $j => $c) {
                    if ($nome === null && preg_match('/^(TAREFA|ATIVIDADE|NOME|DESCRI|SERVI)/u', $c)) { $nome = $j; }
                    if ($ini === null && preg_match('/^(INICIO|INÍCIO|START|DATA INI)/u', $c)) { $ini = $j; }
                    if ($fim === null && preg_match('/^(CONCLUS|TÉRMINO|TERMINO|FIM|FINISH|DATA FIM)/u', $c)) { $fim = $j; }
                    if ($prod === null && strpos($c, 'PRODUTIVIDADE') === 0) { $prod = $j; }
                    if ($qtd === null && preg_match('/^(TOTAL DE UNID|QUANT|QTD|TOTAL)/u', $c)) { $qtd = $j; }
                    if ($it === null && in_array(trim($c), ['ITEM', 'ÍTEM'], true)) { $it = $j; }
                }
                if ($nome !== null && $ini !== null && $fim !== null) {
                    $cab = [$i, $nome, $ini, $fim, $prod, $qtd, $it];
                    break;
                }
            }
            if (!$cab) {
                continue;
            }
            list($i0, $cn, $ci, $cf, $cp, $cq, $cit) = $cab;
            $setor = '';
            $lista = [];
            foreach (array_slice($linhas, $i0 + 1) as $l) {
                $nome = lt_texto($l[$cn] ?? '');
                $d1 = lt_data_iso($l[$ci] ?? null);
                $d2 = lt_data_iso($l[$cf] ?? null);
                if ($nome === '' && $cit !== null && lt_texto($l[$cit] ?? '') !== '' && !$d1) {
                    $setor = lt_texto($l[$cit]);
                    continue;
                }
                if ($nome !== '' && $d1 && $d2) {
                    $lista[] = ['ordem' => count($lista) + 1, 'item' => $cit !== null ? lt_texto($l[$cit] ?? '') : '', 'nome' => $nome, 'setor' => $setor, 'inicio' => $d1, 'fim' => $d2,
                        'qtd' => $cq !== null ? lt_numero($l[$cq] ?? null) : null, 'produtividade_dia' => $cp !== null ? lt_numero($l[$cp] ?? null) : null];
                }
            }
            if (count($lista) > count($melhor)) {
                $melhor = $lista;
            }
        }
        $ativ = $melhor;
    } elseif ($ext === 'pdf') {
        $avisos[] = 'Cronograma em PDF não é lido automaticamente: envie o MS Project (.xml) ou a planilha (.xlsx) para gerar as datas.';
    }
    if (!$ativ && $ext !== 'pdf') {
        $avisos[] = 'Não encontrei atividades com início e término no cronograma.';
    }
    $r = ['atividades' => $ativ, 'avisos' => $avisos];
    if ($ativ) {
        $r['inicio'] = min(array_column($ativ, 'inicio'));
        $r['fim'] = max(array_column($ativ, 'fim'));
    }
    return $r;
}

// ---------------------------------------------------------------- fixadores

function lf_pol($txt)
{
    $s = trim(str_replace('"', ' ', preg_replace('/(\d)\.(?=\d+\/\d)/', '$1 ', $txt)));
    $total = 0.0;
    foreach (preg_split('/\s+/', $s) as $t) {
        if ($t === '') {
            continue;
        }
        if (strpos($t, '/') !== false) {
            list($a, $b) = explode('/', $t) + [1 => 1];
            if (!is_numeric($a) || !is_numeric($b) || (float)$b == 0.0) {
                return null;
            }
            $total += $a / $b;
        } elseif (is_numeric(str_replace(',', '.', $t))) {
            $total += (float)str_replace(',', '.', $t);
        } else {
            return null;
        }
    }
    return $total ?: null;
}

// Chave comparável entre o nome do IFC (PARAF_1/2"X1"1/2_A307) e o da lista (PARAF. Ø1/2" X 1 1/2" + norma A307).
function leitura_chave_fixador($nome, $norma = '')
{
    $d = mb_strtoupper(lt_texto($nome), 'UTF-8');
    $d = str_replace(['Ø', '∅', 'HARDOBOLT'], ['', '', 'HARDBOLT'], $d);   // a lista escreve HARDOBOLT em parte das linhas
    $tipo = '';
    if (strpos($d, 'AUTOBROC') !== false) { return 'autobrocante|||'; }
    if (strpos($d, 'OLHAL') !== false) {
        return preg_match('/(\d+\/\d+|\d+)\s*(?:"|\'\')?\s*X\s*(\d+)\s*F/', $d, $m) ? "olhal|{$m[1]}|{$m[2]}|" : '';
    }
    if (strpos($d, 'PORCA') === 0) { $tipo = 'porca'; }
    elseif (strpos($d, 'ARRUELA') === 0) { $tipo = 'arruela'; }
    elseif (strpos($d, 'PARABOLT') !== false) { $tipo = 'parabolt'; }
    elseif (strpos($d, 'CBQ') === 0) { $tipo = 'cbq'; }
    elseif (strpos($d, 'HARDBOLT') !== false) { $tipo = 'hardbolt'; }
    elseif (preg_match('/^(PARAF\.?\s+)?AB\b/', $d)) { $tipo = 'ab'; }
    elseif (strpos($d, 'PARAF') === 0) { $tipo = 'parafuso'; }
    if ($tipo === '') {
        return '';
    }
    if ($tipo === 'hardbolt') {
        return preg_match('/M(\d+)\s*X\s*(\d+)/', $d, $m) ? "hardbolt|M{$m[1]}|{$m[2]}" : '';
    }
    $diam = preg_match('/(\d+\/\d+|\d+)\s*"/', $d, $m, PREG_OFFSET_CAPTURE) ? $m[1][0] : '';
    $comp = '';
    if (in_array($tipo, ['parafuso', 'parabolt', 'ab', 'cbq'], true) && $diam !== '') {
        $resto = substr($d, $m[0][1] + strlen($m[0][0]) - 1);
        if (preg_match('/"\s*X\s*([0-9"\.\/ ]+?)(?:_|\s*$|\s+[A-Z])/', $resto, $mx)) {
            $v = lf_pol($mx[1]);
            $comp = $v ? (string)round($v, 3) : '';
        }
    }
    // "Gr.8 (CLASSE 10.9)" e "GR.8" são a mesma norma; "A325N" vale A325
    $n = preg_replace('/[\s._\-]/', '', preg_replace('/\(.*?\)/', '', mb_strtoupper(lt_texto($norma), 'UTF-8')));
    $n = preg_replace('/^(A\d+)N$/', '$1', $n);
    if ($n === '' || $n === '-') {
        $n = strpos($d, '_') !== false ? preg_replace('/[\s._\-]/', '', substr($d, strrpos($d, '_') + 1)) : '';
    }
    if (in_array($n, ['HEX', 'LISA', 'ABTCP3', 'TCP3'], true) || in_array($tipo, ['porca', 'arruela', 'ab', 'parabolt'], true)) {
        $n = '';
    }
    return implode('|', [$tipo, $diam, $comp, $n]);
}

function leitura_tipo_fixador($desc)
{
    $d = mb_strtoupper(lt_texto($desc), 'UTF-8');
    if (strpos($d, 'PORCA') === 0) { return 'porca'; }
    if (strpos($d, 'ARRUELA') === 0) { return 'arruela'; }
    if (strpos($d, 'HARDBOLT') !== false || strpos($d, 'HARDOBOLT') !== false) { return 'hardbolt'; }
    if (strpos($d, 'AUTOBROC') !== false) { return 'autobrocante'; }
    if (strpos($d, 'CHUMB') !== false || strpos($d, 'PARABOLT') !== false || strpos($d, 'CBQ') === 0) { return 'chumbador'; }
    if (strpos($d, 'PARAF') === 0 || strpos($d, 'AB ') === 0) { return 'parafuso'; }
    return 'outro';
}

function lf_colunas(array $l)
{
    $cel = array_map('lt_up', $l);
    $qtd = $desc = null;
    foreach ($cel as $j => $c) {
        if ($qtd === null && in_array($c, ['QTD', 'QTD.'], true)) { $qtd = $j; }
        if ($desc === null && strpos($c, 'DESCRI') === 0) { $desc = $j; }
    }
    if ($qtd === null || $desc === null) {
        return null;
    }
    $col = ['qtd' => $qtd, 'desc' => $desc];
    foreach ($cel as $j => $c) {
        if (strpos($c, 'COMP') === 0) { $col['comp'] = $j; }
        elseif (strpos($c, 'PESO UNIT') === 0) { $col['pu'] = $j; }
        elseif (strpos($c, 'PESO TOTAL') === 0) { $col['pt'] = $j; }
        elseif (strpos($c, 'MATERIAL') === 0) { $col['mat'] = $j; }
        elseif ($c === 'ESCOPO') { $col['esc'] = $j; }
    }
    if (isset($col['mat']) && ($cel[$col['mat'] + 1] ?? null) === '') {
        $col['apl'] = $col['mat'] + 1;
    }
    return $col;
}

function lf_planilha(array $linhas)
{
    $geral = [];
    $blocos = [];
    $atual = null;
    $col = null;
    foreach ($linhas as $l) {
        $c = lf_colunas($l);
        if ($c) {
            $col = $c;
            continue;
        }
        $titulo = null;
        foreach ($l as $x) {
            $t = lt_texto($x);
            // "JOIST 01 (12X)" ou "JOIST DUPLA ( 817X )": lista de fixadores de UMA joist, multiplicada pela quantidade entre parênteses
            if (preg_match('/^JOIST\s*\d+/i', $t) || (preg_match('/^JOIST\b/i', $t) && preg_match('/\(\s*\d+\s*X\s*\)/i', $t))) {
                $titulo = $t;
                break;
            }
        }
        if ($titulo) {
            preg_match('/\(\s*(\d+)\s*X\s*\)/i', $titulo, $mult);
            preg_match('/^(JOIST\s*\w+)/i', $titulo, $nm);
            $blocos[] = ['joist' => strtoupper(str_replace(' ', '', $nm[1])), 'titulo' => $titulo, 'quantidade_de_joists' => (int)($mult[1] ?? 1), 'itens' => []];
            $atual = count($blocos) - 1;
            continue;
        }
        if ($col === null) {
            continue;
        }
        $q = lt_numero($l[$col['qtd']] ?? null);
        $desc = lt_texto($l[$col['desc']] ?? '');
        if ($q === null || $desc === '') {
            continue;
        }
        $norma = isset($col['mat']) ? lt_texto($l[$col['mat']] ?? '') : '';
        $r = ['qtd' => $q, 'descricao' => $desc, 'comprimento_mm' => isset($col['comp']) ? lt_numero($l[$col['comp']] ?? null) : null,
            'peso_unit_kg' => isset($col['pu']) ? lt_numero($l[$col['pu']] ?? null) : null, 'peso_total_kg' => isset($col['pt']) ? lt_numero($l[$col['pt']] ?? null) : null,
            'norma' => $norma, 'escopo' => isset($col['esc']) ? lt_texto($l[$col['esc']] ?? '') : '', 'aplicacao' => isset($col['apl']) ? lt_texto($l[$col['apl']] ?? '') : '', 'tipo' => leitura_tipo_fixador($desc), 'chave' => leitura_chave_fixador($desc, $norma)];
        if ($atual !== null) {
            $blocos[$atual]['itens'][] = $r;
        } else {
            $geral[] = $r;
        }
    }
    return [$geral, $blocos];
}

function leitura_fixadores($caminho, $nomeArq)
{
    $ext = strtolower(pathinfo($nomeArq, PATHINFO_EXTENSION));
    $geral = [];
    $joist = [];
    $avisos = [];
    if (in_array($ext, ['xlsx', 'xlsm'], true)) {
        foreach (xlsx_ler($caminho, 3000, 14) as $a) {
            list($g, $b) = lf_planilha($a['linhas']);
            $geral = array_merge($geral, $g);
            $joist = array_merge($joist, $b);
        }
    } elseif ($ext === 'csv') {
        $linhas = [];
        $f = fopen($caminho, 'r');
        $amostra = (string)fgets($f);
        rewind($f);
        $sep = substr_count($amostra, ';') >= substr_count($amostra, ',') ? ';' : ',';
        while (($l = fgetcsv($f, 0, $sep)) !== false) {
            $linhas[] = $l;
        }
        fclose($f);
        list($geral, $joist) = lf_planilha($linhas);
    } else {
        $avisos[] = 'Lista de parafusos no formato .trb não é lida: os parafusos do IFC (Bolts:On) e a lista em planilha são usados.';
    }
    if (!$geral && !$joist && $ext !== 'trb') {
        $avisos[] = 'Não encontrei a tabela de fixadores (colunas Qtd e Descrição).';
    }
    return ['geral' => $geral, 'por_joist' => $joist, 'avisos' => $avisos];
}
