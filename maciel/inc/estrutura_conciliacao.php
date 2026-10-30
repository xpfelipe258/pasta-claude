<?php
// Estrutura do projeto: LISTA DE PARTES POR CONJUNTO (planilha do Tekla) × IFC.
//   REGRA DO SISTEMA (mesma dos fixadores): o planejado de cada TAG de conjunto é o MAIOR valor entre a lista e o IFC; o peso unitário vem da lista.
//   TAG do cadastro pode vir repartida em X, X_1, X_2 (um por local): a comparação é feita pelo total da marca e o acréscimo vai para a TAG principal.
require_once __DIR__ . '/leitura_util.php';

// "ST02(?)" -> "ST02" (o Tekla marca "(?)" quando a numeração ainda é provisória)
function est_marca($t)
{
    return trim(preg_replace('/\(\?\)\s*$/', '', trim((string)$t)));
}

// "TCX300_1" -> "TCX300"
function est_base($t)
{
    return preg_replace('/_\d+$/', '', (string)$t);
}

// Conjunto sem marca definida no modelo (nd123, ND01): não entra na comparação
function est_sem_marca($t)
{
    return (bool)preg_match('/^nd\d*$/i', est_marca($t));
}

// Fixadores modelados como conjunto (porca, arruela, olhal…) são tratados em fixadores_conciliacao.php
function est_eh_fixador_ifc($produto)
{
    return (bool)preg_match('/^(PORCA|ARRUELA|PARAF|NUT|WASHER|PINO)/iu', lt_texto($produto));
}

/**
 * Lê as linhas da "Lista de partes por conjunto": cada conjunto tem uma linha com TAG-Conjunto, Qtd, superfície e pesos,
 * seguida das partes (TAG-Acessório, descrição do perfil, comprimento). Devolve [['tag','qtd','pu','pt','peca','comp','fonte'], ...].
 */
function est_ler_partes(array $linhas, $fonte = '')
{
    $out = [];
    $cab = false;
    $atual = null;
    foreach ($linhas as $l) {
        if (lt_up($l[0] ?? '') === 'TAG-CONJUNTO') {
            $cab = true;
            continue;
        }
        if (!$cab) {
            continue;
        }
        $tag = lt_texto($l[0] ?? '');
        if ($tag !== '') {
            $q = lt_numero($l[2] ?? null);
            if ($q === null) {
                $atual = null;
                continue;
            }
            $out[] = ['tag' => $tag, 'qtd' => $q, 'pu' => (float)lt_numero($l[6] ?? null), 'pt' => (float)lt_numero($l[7] ?? null), 'peca' => '', 'comp' => 0, 'fonte' => $fonte];
            $atual = count($out) - 1;
        } elseif ($atual !== null && $out[$atual]['peca'] === '') {
            $out[$atual]['peca'] = lt_texto($l[3] ?? '');
            $out[$atual]['comp'] = (float)lt_numero($l[4] ?? null);
        }
    }
    return $out;
}

// Nome do tipo de peça a partir do prefixo da marca (quando o IFC não traz o produto)
function est_produto_do_prefixo($marca)
{
    $mapa = ['CA' => 'CALHA', 'CBB' => 'ANCORAGEM CBB', 'CBQ' => 'ANCORAGEM CBQ', 'CTH' => 'CONTRAVENTAMENTO', 'ETX' => 'ESPAÇADOR', 'ET' => 'ESPAÇADOR', 'GRP' => 'GRAPA',
        'LVX' => 'CABO DE AÇO', 'MF' => 'MÃO FRANCESA', 'MT' => 'MONTANTE', 'RDX' => 'CANTONEIRA', 'ROT-STM' => 'SUPORTE DE TERÇA', 'SPX' => 'TERÇA MARQUISE', 'SP' => 'SUPORTE',
        'ST' => 'SUPORTE DE TERÇA', 'TCX' => 'TERÇA', 'TC' => 'TERÇA MARQUISE', 'TF' => 'TERÇA FECHAMENTO', 'VC' => 'VIGA COBERTURA', 'VM' => 'VIGA MARQUISE', 'FR' => 'FRECHAL', 'L' => 'CANTONEIRA'];
    uksort($mapa, function ($a, $b) { return strlen($b) <=> strlen($a); });
    foreach ($mapa as $p => $nome) {
        if (stripos($marca, $p) === 0) {
            return $nome;
        }
    }
    return 'CONJUNTO';
}

/**
 * Concilia a lista de partes com os conjuntos do IFC.
 *   $partes: saída de est_ler_partes() (várias listas juntas); $conjuntos: conjuntos do IFC (leitura_modelo()['conjuntos']).
 * item = ['tag','lista','ifc','planejado','origem','peso_unit','peso_fonte','produto','peca','fonte','local']
 */
function est_conciliar(array $partes, array $conjuntos)
{
    $it = [];
    foreach ($partes as $p) {
        $t = est_marca($p['tag']);
        if ($t === '' || est_sem_marca($t)) {
            continue;
        }
        $i = &$it[$t];
        $i = $i ?? ['tag' => $t, 'lista' => 0.0, 'ifc' => 0.0, 'pT' => 0.0, 'pQ' => 0.0, 'produto' => '', 'peca' => '', 'fontes' => [], 'local' => '', 'iW' => 0.0];
        $i['lista'] += $p['qtd'];
        if ($p['pu'] > 0) {
            $i['pT'] += $p['pu'] * $p['qtd'];
            $i['pQ'] += $p['qtd'];
        }
        $i['peca'] = $i['peca'] ?: $p['peca'];
        $i['fontes'][$p['fonte']] = true;
        unset($i);
    }
    foreach ($conjuntos as $c) {
        $t = est_marca($c['marca'] ?? '');
        if ($t === '' || est_sem_marca($t) || est_eh_fixador_ifc($c['produto'] ?? '')) {
            continue;
        }
        $i = &$it[$t];
        $i = $i ?? ['tag' => $t, 'lista' => 0.0, 'ifc' => 0.0, 'pT' => 0.0, 'pQ' => 0.0, 'produto' => '', 'peca' => '', 'fontes' => [], 'local' => '', 'iW' => 0.0];
        $i['ifc'] += 1;
        $i['iW'] += (float)($c['peso_kg'] ?? 0);
        $i['produto'] = $i['produto'] ?: lt_texto($c['produto'] ?? '');
        $i['local'] = $i['local'] ?: lt_texto($c['fase'] ?? '');
        unset($i);
    }
    foreach ($it as $t => &$i) {
        $i['planejado'] = max($i['lista'], $i['ifc']);
        $i['origem'] = $i['lista'] > 0 && $i['ifc'] > 0 ? ($i['lista'] > $i['ifc'] ? 'lista' : ($i['ifc'] > $i['lista'] ? 'IFC' : 'igual')) : ($i['lista'] > 0 ? 'só lista' : 'só IFC');
        if ($i['pQ'] > 0) {
            $i['peso_unit'] = round($i['pT'] / $i['pQ'], 3);
            $i['peso_fonte'] = 'lista';
        } elseif ($i['ifc'] > 0 && $i['iW'] > 0) {
            $i['peso_unit'] = round($i['iW'] / $i['ifc'], 3);
            $i['peso_fonte'] = 'IFC';
        } else {
            $i['peso_unit'] = 0.0;
            $i['peso_fonte'] = '';
        }
        $i['produto'] = $i['produto'] ?: est_produto_do_prefixo($t);
        $i['fonte'] = implode(' + ', array_keys($i['fontes']));
        unset($i['pT'], $i['pQ'], $i['iW'], $i['fontes']);
    }
    unset($i);
    ksort($it, SORT_NATURAL);
    return $it;
}

function est_pacote(array $itens, array $fontes)
{
    return ['versao' => 1, 'regra' => 'planejado = maior valor entre a lista de partes por conjunto e o IFC', 'fontes' => $fontes, 'itens' => array_values($itens)];
}

/**
 * Aplica a conciliação às linhas de material (planilha): para cada marca, o total do cadastro (X, X_1…) passa a ser o maior entre ele,
 * a lista e o IFC; o acréscimo vai para a TAG principal. Peso unitário preenchido só onde o cadastro não tem.
 */
function est_aplicar_materiais(array $materiais, $projeto)
{
    if (!is_array($projeto) || empty($projeto['itens'])) {
        return $materiais;
    }
    $porBase = [];
    foreach ($materiais as $i => $m) {
        $t = trim((string)($m['tag'] ?? ''));
        if ($t === '' || preg_match('/^F[GJX]\d/i', $t)) {
            continue;
        }
        $porBase[strtoupper(est_base($t))][] = $i;
    }
    foreach ($projeto['itens'] as $p) {
        $idx = $porBase[strtoupper($p['tag'])] ?? [];
        if (!$idx) {
            continue;
        }
        $soma = 0.0;
        $principal = $idx[0];
        foreach ($idx as $i) {
            $soma += (float)($materiais[$i]['planejado'] ?? 0);
            if (strcasecmp((string)$materiais[$i]['tag'], $p['tag']) === 0) { $principal = $i; }
        }
        if ($p['planejado'] > $soma) {
            $materiais[$principal]['planejado'] = (float)($materiais[$principal]['planejado'] ?? 0) + ($p['planejado'] - $soma);
        }
        if ((float)$p['peso_unit'] > 0) {
            foreach ($idx as $i) {
                if (!((float)($materiais[$i]['peso_unitario'] ?? 0) > 0)) {
                    $materiais[$i]['peso_unitario'] = (float)$p['peso_unit'];
                }
            }
        }
    }
    return $materiais;
}

/** TAGs de estrutura do projeto (marca) que o cadastro de Materiais ainda não tem — as que o botão "Criar TAG(s) de estrutura" cadastra. */
function est_sem_tag(array $materiais, $projeto)
{
    if (!is_array($projeto) || empty($projeto['itens'])) {
        return [];
    }
    $bases = [];
    foreach ($materiais as $m) {
        $t = trim((string)($m['tag'] ?? ''));
        if ($t !== '' && !preg_match('/^F[GJX]\d/i', $t)) {
            $bases[strtoupper(est_base($t))] = true;
        }
    }
    return array_values(array_filter($projeto['itens'], function ($p) use ($bases) { return !isset($bases[strtoupper($p['tag'])]); }));
}
