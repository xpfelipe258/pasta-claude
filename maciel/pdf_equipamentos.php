<?php

declare(strict_types=1);

require __DIR__ . '/inc/nucleo.php';

$u    = exigir_login_pagina();
$obra = exigir_obra_pagina();

if (!usuario_pode_modulo($u, 'consumo')) {
    http_response_code(403);
    exit('Sem acesso ao módulo Consumo.');
}

require_once __DIR__ . '/tcpdf/tcpdf.php';

if (!class_exists('TCPDF')) {
    http_response_code(500);
    exit('TCPDF não encontrado em /tcpdf/tcpdf.php.');
}


/* ============================================================
   FUNÇÕES EXCLUSIVAS DO PDF
   ============================================================ */

function pdf_h($v): string
{
    return htmlspecialchars((string)$v, ENT_QUOTES, 'UTF-8');
}

function pdf_n($v): float
{
    return is_numeric($v) ? (float)$v : 0.0;
}

function pdf_brn(float $v, int $d = 1): string
{
    return number_format($v, $d, ',', '.');
}

function pdf_brl(float $v): string
{
    return 'R$ ' . number_format($v, 0, ',', '.');
}

function pdf_dataBr(string $s): string
{
    $d = DateTime::createFromFormat('Y-m-d', $s);

    return $d ? $d->format('d/m/Y') : $s;
}

function pdf_normEmp(string $s): string
{
    $t = mb_strtoupper(trim($s), 'UTF-8');

    if ($t === 'GA' || str_starts_with($t, 'GLOBO')) {
        return 'GLOBO AÇOS';
    }

    return $t;
}

function pdf_empresasDe(string $s): array
{
    $s = preg_replace(
        '/\s+(?:E|&|AND)\s+/iu',
        '/',
        $s
    ) ?? $s;

    $partes = preg_split(
        '/[\/;,\+]+/u',
        $s
    ) ?: [];

    $out = [];

    foreach ($partes as $p) {

        $e = pdf_normEmp($p);

        if (
            $e !== '' &&
            !in_array($e, $out, true)
        ) {
            $out[] = $e;
        }
    }

    return $out;
}


/* ============================================================
   FILTROS
   ============================================================ */

$tipo      = trim((string)($_GET['tipo'] ?? 'geral'));
$ini       = trim((string)($_GET['ini'] ?? ''));
$fim       = trim((string)($_GET['fim'] ?? ''));
$usoFiltro = trim((string)($_GET['uso'] ?? 'todos'));


$validaData = static fn(string $v): bool =>
    (bool)preg_match('/^\d{4}-\d{2}-\d{2}$/', $v);


if (
    !$validaData($ini) ||
    !$validaData($fim) ||
    $fim < $ini
) {

    http_response_code(400);

    exit('Período inválido.');
}


if (
    !in_array(
        $usoFiltro,
        [
            'todos',
            'equipamento',
            'abastecimento'
        ],
        true
    )
) {
    $usoFiltro = 'todos';
}


/* ============================================================
   CONSULTA
   ============================================================ */

$rows = q(
    '
    SELECT
        data,
        equipamento,
        empresa,
        uso,
        quantidade,
        custo,
        litros,
        preco_litro,
        custo_combustivel,
        operador,
        obs,
        origem
    FROM usos
    WHERE data >= ?
      AND data <= ?
    ORDER BY
        data,
        empresa,
        equipamento
    ',
    [
        $ini,
        $fim
    ]
)->fetchAll();


/* ============================================================
   RATEIO
   ============================================================ */

$rateados = [];

foreach ($rows as $r) {

    $uso = mb_strtoupper(
        trim((string)($r['uso'] ?? '')),
        'UTF-8'
    );

    $eq = mb_strtoupper(
        trim((string)($r['equipamento'] ?? '')),
        'UTF-8'
    );

    $litros = pdf_n(
        $r['litros'] ?? 0
    );

    $comb = pdf_n(
        $r['custo_combustivel'] ?? 0
    );


    $ehAbast =
        str_contains(
            $uso,
            'ABASTECIMENTO'
        )
        ||
        $litros > 0
        ||
        $comb > 0;


    if (
        $usoFiltro === 'abastecimento' &&
        !$ehAbast
    ) {
        continue;
    }


    if (
        $usoFiltro === 'equipamento' &&
        $ehAbast
    ) {
        continue;
    }


    $emps = pdf_empresasDe(
        (string)($r['empresa'] ?? '')
    );


    $divide =
        $ehAbast
        &&
        (
            str_contains(
                $eq,
                'MUNCK'
            )
            ||
            str_contains(
                $eq,
                'SKYJACK'
            )
        );


    if (
        $divide &&
        count($emps) <= 1
    ) {
        $emps = [
            'EJ',
            'CMM'
        ];
    }


    if (!$emps) {
        $emps = [
            'NÃO INFORMADA'
        ];
    }


    foreach ($emps as $emp) {

        if (
            $tipo !== '' &&
            $tipo !== 'geral' &&
            $emp !== pdf_normEmp($tipo)
        ) {
            continue;
        }


        $div = count($emps);


        $rateados[] = [

            'data' =>
                (string)$r['data'],

            'empresa' =>
                $emp,

            'equipamento' =>
                (string)(
                    $r['equipamento']
                    ?: 'NÃO INFORMADO'
                ),

            'uso' =>
                (string)(
                    $r['uso']
                    ?? ''
                ),

            'qtd' =>
                pdf_n(
                    $r['quantidade']
                    ?? 0
                ),

            'custo' =>
                pdf_n(
                    $r['custo']
                    ?? 0
                ) / $div,

            'litros' =>
                $litros / $div,

            'comb' =>
                $comb / $div,

            'operador' =>
                (string)(
                    $r['operador']
                    ?? ''
                ),

            'obs' =>
                (string)(
                    $r['obs']
                    ?? ''
                )

        ];
    }
}


/* ============================================================
   AGRUPAMENTOS
   ============================================================ */

$porEmp = [];
$porEq  = [];
$porDia = [];


foreach ($rateados as $r) {

    $total =
        $r['custo']
        +
        $r['comb'];


    /* ========================================================
       EMPRESA
       ======================================================== */

    $e = $r['empresa'];


    if (!isset($porEmp[$e])) {

        $porEmp[$e] = [

            'custo' => 0.0,

            'litros' => 0.0,

            'comb' => 0.0,

            'total' => 0.0,

            'dias' => []

        ];
    }


    $porEmp[$e]['custo']
        += $r['custo'];

    $porEmp[$e]['litros']
        += $r['litros'];

    $porEmp[$e]['comb']
        += $r['comb'];

    $porEmp[$e]['total']
        += $total;

    $porEmp[$e]['dias'][$r['data']]
        = 1;


    /* ========================================================
       EQUIPAMENTO
       ======================================================== */

    $q = $r['equipamento'];


    if (!isset($porEq[$q])) {

        $porEq[$q] = [

            'qtd' => 0.0,

            'custo' => 0.0,

            'litros' => 0.0,

            'comb' => 0.0,

            'total' => 0.0

        ];
    }


    $porEq[$q]['qtd']
        += $r['qtd'];

    $porEq[$q]['custo']
        += $r['custo'];

    $porEq[$q]['litros']
        += $r['litros'];

    $porEq[$q]['comb']
        += $r['comb'];

    $porEq[$q]['total']
        += $total;


    /* ========================================================
       DIÁRIO
       ======================================================== */

    $k = implode(
        '|',
        [
            $r['data'],
            $r['empresa'],
            $r['equipamento'],
            $r['uso']
        ]
    );


    if (!isset($porDia[$k])) {

        $porDia[$k] = array_merge(

            $r,

            [

                'qtd' => 0.0,

                'custo' => 0.0,

                'litros' => 0.0,

                'comb' => 0.0,

                'total' => 0.0,

                'notas' => []

            ]

        );
    }


    $porDia[$k]['qtd']
        += $r['qtd'];

    $porDia[$k]['custo']
        += $r['custo'];

    $porDia[$k]['litros']
        += $r['litros'];

    $porDia[$k]['comb']
        += $r['comb'];

    $porDia[$k]['total']
        += $total;


    $nota = trim(

        $r['operador']

        .

        (
            $r['operador']
            &&
            $r['obs']

            ? ' · '

            : ''
        )

        .

        $r['obs']

    );


    if ($nota !== '') {

        $porDia[$k]['notas'][$nota]
            = 1;

    }
}


/* ============================================================
   ORDENAÇÃO
   ============================================================ */

uasort(
    $porEmp,
    fn($a, $b) =>
        $b['total']
        <=>
        $a['total']
);


uasort(
    $porEq,
    fn($a, $b) =>
        $b['total']
        <=>
        $a['total']
);


ksort($porDia);


/* ============================================================
   TOTAIS
   ============================================================ */

$totalCusto =
    array_sum(
        array_column(
            $porEmp,
            'custo'
        )
    );


$totalComb =
    array_sum(
        array_column(
            $porEmp,
            'comb'
        )
    );


$totalLitros =
    array_sum(
        array_column(
            $porEmp,
            'litros'
        )
    );


$totalGeral =
    array_sum(
        array_column(
            $porEmp,
            'total'
        )
    );


$obraNome = trim(
    (string)(
        $obra['nome']
        ?? 'OBRA'
    )
);


$usoRotulo =

    $usoFiltro === 'abastecimento'

    ? 'Somente abastecimento'

    :

    (
        $usoFiltro === 'equipamento'

        ? 'Somente equipamento'

        : 'Equipamento + abastecimento'
    );


$tipoTitulo =

    (
        $tipo === ''
        ||
        $tipo === 'geral'
    )

    ? 'GERAL'

    : pdf_normEmp($tipo);


/* ============================================================
   CLASSE DO PDF
   ============================================================ */

class PDFEquipamentos extends TCPDF
{

    public function Footer(): void
    {

        $this->SetY(-8);

        $this->SetFont(
            'helvetica',
            '',
            6.5
        );

        $this->SetTextColor(
            105,
            125,
            140
        );


        $this->Cell(
            130,
            4,
            'Controle de Produção • Equipamentos e Consumo',
            0,
            0,
            'L'
        );


        $this->Cell(
            0,
            4,
            'Página '
            .
            $this->getAliasNumPage()
            .
            ' de '
            .
            $this->getAliasNbPages(),
            0,
            0,
            'R'
        );
    }
}


/* ============================================================
   CONFIGURAÇÃO DO TCPDF
   ============================================================ */

$pdf = new PDFEquipamentos(
    'L',
    'mm',
    'A4',
    true,
    'UTF-8',
    false
);


$pdf->SetCreator(
    'Sistema de Controle de Produção'
);


$pdf->SetAuthor(
    (string)(
        $u['nome']
        ??
        $u['login']
        ??
        ''
    )
);


$pdf->SetTitle(
    'Relatório de Equipamentos - '
    .
    $obraNome
);


$pdf->SetSubject(
    'Relatório Geral de Equipamentos'
);


$pdf->setPrintHeader(false);

$pdf->setPrintFooter(true);


$pdf->SetMargins(
    10,
    8,
    10
);


$pdf->SetAutoPageBreak(
    true,
    12
);


$pdf->SetFooterMargin(5);


$pdf->AddPage();


$pdf->SetFont(
    'helvetica',
    '',
    8
);


/* ============================================================
   CABEÇALHO
   ============================================================

   IMPORTANTE:

   O CABEÇALHO NÃO É MAIS UMA TABELA HTML.

   Portanto NÃO existe:

   border="1"
   border-collapse
   .head td
   table border
   CSS herdado

   Nada disso consegue mais criar a borda preta grossa.

   ============================================================ */


$y = $pdf->GetY();


/* ------------------------------------------------------------
   LOGO / NOME
   ------------------------------------------------------------ */

$pdf->SetTextColor(
    11,
    65,
    107
);


$pdf->SetFont(
    'helvetica',
    'B',
    17
);


$pdf->SetXY(
    10,
    $y + 2
);


$pdf->Cell(
    55,
    7,
    'RÓTULA',
    0,
    0,
    'L'
);


$pdf->SetTextColor(
    105,
    125,
    145
);


$pdf->SetFont(
    'helvetica',
    '',
    5.8
);


$pdf->SetXY(
    10,
    $y + 10
);


$pdf->Cell(
    55,
    3,
    'ENGENHARIA',
    0,
    0,
    'L'
);


/* ------------------------------------------------------------
   TÍTULO CENTRAL
   ------------------------------------------------------------ */

$pdf->SetTextColor(
    11,
    65,
    107
);


$pdf->SetFont(
    'helvetica',
    'B',
    15
);


$pdf->SetXY(
    65,
    $y + 2
);


$pdf->Cell(
    162,
    7,
    'RELATÓRIO GERAL DE EQUIPAMENTOS',
    0,
    0,
    'C'
);


$pdf->SetTextColor(
    105,
    125,
    145
);


$pdf->SetFont(
    'helvetica',
    '',
    6.2
);


$pdf->SetXY(
    65,
    $y + 10
);


$pdf->Cell(
    162,
    3,
    'CONTROLE DE PRODUÇÃO • EQUIPAMENTOS E CONSUMO',
    0,
    0,
    'C'
);


/* ------------------------------------------------------------
   BLOCO AZUL DA DIREITA

   SOMENTE ELE TEM FUNDO.
   NÃO TEM BORDA.
   ------------------------------------------------------------ */

$pdf->SetFillColor(
    28,
    111,
    159
);


$pdf->Rect(
    232,
    $y,
    55,
    18,
    'F'
);


$pdf->SetTextColor(
    255,
    255,
    255
);


$pdf->SetFont(
    'helvetica',
    '',
    5.5
);


$pdf->SetXY(
    232,
    $y + 1
);


$pdf->Cell(
    55,
    3,
    'RELATÓRIO',
    0,
    0,
    'C'
);


$pdf->SetFont(
    'helvetica',
    'B',
    13
);


$pdf->SetXY(
    232,
    $y + 5
);


$pdf->Cell(
    55,
    6,
    $tipoTitulo,
    0,
    0,
    'C'
);


$pdf->SetFont(
    'helvetica',
    'B',
    6.5
);


$pdf->SetXY(
    232,
    $y + 12
);


$pdf->Cell(
    55,
    4,
    $obraNome,
    0,
    0,
    'C'
);


/* ------------------------------------------------------------
   LINHA AZUL CLARA ABAIXO DO CABEÇALHO

   É UMA LINHA DE 0,2 MM.
   NÃO É BORDA PRETA.
   ------------------------------------------------------------ */

$pdf->SetDrawColor(
    207,
    221,
    231
);


$pdf->SetLineWidth(
    0.2
);


$pdf->Line(
    10,
    $y + 19,
    287,
    $y + 19
);


/* ============================================================
   METADADOS
   ============================================================ */

$metaY =
    $y + 20;


$metaX = [
    10,
    80,
    150,
    220
];


$metaW = [
    70,
    70,
    70,
    67
];


$metaLabel = [
    'OBRA',
    'PERÍODO',
    'FILTRO DE USO',
    'EMITIDO EM'
];


$metaValor = [

    $obraNome,

    pdf_dataBr($ini)
    .
    ' a '
    .
    pdf_dataBr($fim),

    $usoRotulo,

    date(
        'd/m/Y, H:i:s'
    )

];


for ($i = 0; $i < 4; $i++) {

    /*
     * Fundo bem leve.
     * SEM BORDA.
     */

    $pdf->SetFillColor(
        247,
        250,
        252
    );


    $pdf->Rect(
        $metaX[$i],
        $metaY,
        $metaW[$i],
        10,
        'F'
    );


    $pdf->SetTextColor(
        105,
        125,
        145
    );


    $pdf->SetFont(
        'helvetica',
        'B',
        5.4
    );


    $pdf->SetXY(
        $metaX[$i] + 2,
        $metaY + 1
    );


    $pdf->Cell(
        $metaW[$i] - 4,
        3,
        $metaLabel[$i],
        0,
        0,
        'L'
    );


    $pdf->SetTextColor(
        18,
        61,
        91
    );


    $pdf->SetFont(
        'helvetica',
        'B',
        7
    );


    $pdf->SetXY(
        $metaX[$i] + 2,
        $metaY + 4
    );


    $pdf->Cell(
        $metaW[$i] - 4,
        4,
        $metaValor[$i],
        0,
        0,
        'L'
    );
}


/*
 * Posiciona o restante do relatório
 * logo abaixo dos metadados.
 */

$pdf->SetY(
    $metaY + 13
);


/* ============================================================
   CSS DO CONTEÚDO
   ============================================================ */

$css = '
<style>

body{
    font-family:helvetica;
    color:#173247;
    font-size:8px;
}


/* ============================================================
   TÍTULO DAS SEÇÕES
   ============================================================ */

.sec{
    background-color:#0b416b;
    color:#ffffff;

    font-size:8.5px;
    font-weight:bold;

    padding:4px 6px;
}


/* ============================================================
   CARDS
   ============================================================ */

.cards td{

    border:1px solid #d6e2ea;

    background-color:#f7fafc;

    padding:7px;
}


.cards .ok{

    background-color:#edf8f1;

    border:1px solid #b8dfc5;
}


.ct{

    font-size:5.8px;

    color:#6e8496;

    font-weight:bold;
}


.cv{

    font-size:14px;

    color:#0b416b;

    font-weight:bold;
}


.cn{

    font-size:5.8px;

    color:#7c8e9b;
}


/* ============================================================
   TABELAS
   ============================================================ */

th{

    background-color:#e4f0f7;

    color:#173a57;

    font-size:6.2px;

    font-weight:bold;

    border:1px solid #c8d9e4;

    padding:4px;
}


td{

    font-size:6.8px;

    border:1px solid #dce6ec;

    padding:3.5px;
}


.n{

    text-align:right;
}


.b{

    font-weight:bold;

    color:#0b416b;
}


/* ============================================================
   ASSINATURAS
   ============================================================ */

.ass td{

    border:0;

    padding:25px 18px 0;

    text-align:center;
}


.line{

    border-top:1px solid #718294;

    padding-top:4px;
}


.small{

    font-size:6px;

    color:#74899a;
}

</style>
';


/* ============================================================
   CARDS
   ============================================================ */

$cards = '

<table
    class="cards"
    cellpadding="0"
    cellspacing="0"
>

<tr>


<td width="20%">

    <span class="ct">
        CUSTO TOTAL
    </span>

    <br>

    <span class="cv">'
        .
        pdf_brl(
            $totalGeral
        )
        .
    '</span>

    <br>

    <span class="cn">
        equipamentos + combustível
    </span>

</td>


<td width="20%">

    <span class="ct">
        EQUIPAMENTOS
    </span>

    <br>

    <span class="cv">'
        .
        pdf_brl(
            $totalCusto
        )
        .
    '</span>

    <br>

    <span class="cn">'
        .
        count($porEq)
        .
        ' equipamento(s)
    </span>

</td>


<td width="20%">

    <span class="ct">
        COMBUSTÍVEL
    </span>

    <br>

    <span class="cv">'
        .
        pdf_brl(
            $totalComb
        )
        .
    '</span>

    <br>

    <span class="cn">
        custo de abastecimento
    </span>

</td>


<td width="20%">

    <span class="ct">
        VOLUME
    </span>

    <br>

    <span class="cv">'
        .
        pdf_brn(
            $totalLitros,
            1
        )
        .
        ' L
    </span>

    <br>

    <span class="cn">
        combustível registrado
    </span>

</td>


<td
    width="20%"
    class="ok"
>

    <span class="ct">
        REGISTROS
    </span>

    <br>

    <span class="cv">'
        .
        count($porDia)
        .
    '</span>

    <br>

    <span class="cn">'
        .
        count($porEmp)
        .
        ' empresa(s)
    </span>

</td>


</tr>

</table>
';


/* ============================================================
   INÍCIO DO HTML
   ============================================================ */

$html =

    $css

    .

    '
    <div class="sec">
        RESUMO EXECUTIVO
    </div>

    <br>
    '

    .

    $cards

    .

    '

    <br>

    <div class="sec">
        RESUMO POR EMPRESA
    </div>

    <br>
    ';


/* ============================================================
   RESUMO POR EMPRESA
   ============================================================ */

$html .= '

<table cellpadding="3">

<thead>

<tr>

<th width="28%">
    EMPRESA
</th>

<th
    width="16%"
    class="n"
>
    EQUIPAMENTOS
</th>

<th
    width="13%"
    class="n"
>
    LITROS
</th>

<th
    width="16%"
    class="n"
>
    COMBUSTÍVEL
</th>

<th
    width="16%"
    class="n"
>
    TOTAL
</th>

<th
    width="11%"
    class="n"
>
    DIAS COM USO
</th>

</tr>

</thead>

<tbody>
';


if (!$porEmp) {

    $html .= '

    <tr>

        <td colspan="6">

            Sem registros no período.

        </td>

    </tr>

    ';

} else {

    foreach ($porEmp as $nomeEmp => $e) {

        $html .= '

        <tr>

            <td>'
                .
                pdf_h(
                    $nomeEmp
                )
                .
            '</td>


            <td class="n">'
                .
                pdf_brl(
                    $e['custo']
                )
                .
            '</td>


            <td class="n">'
                .
                pdf_brn(
                    $e['litros'],
                    1
                )
                .
                ' L
            </td>


            <td class="n">'
                .
                pdf_brl(
                    $e['comb']
                )
                .
            '</td>


            <td class="n b">'
                .
                pdf_brl(
                    $e['total']
                )
                .
            '</td>


            <td class="n">'
                .
                count(
                    $e['dias']
                )
                .
            '</td>

        </tr>

        ';
    }
}


$html .= '

</tbody>

</table>


<br>


<div class="sec">
    RESUMO POR EQUIPAMENTO
</div>


<br>


<table cellpadding="3">


<thead>

<tr>


<th width="28%">
    EQUIPAMENTO
</th>


<th
    width="12%"
    class="n"
>
    QTD./USOS
</th>


<th
    width="18%"
    class="n"
>
    CUSTO EQUIP.
</th>


<th
    width="13%"
    class="n"
>
    LITROS
</th>


<th
    width="15%"
    class="n"
>
    COMBUSTÍVEL
</th>


<th
    width="14%"
    class="n"
>
    TOTAL
</th>


</tr>

</thead>


<tbody>
';


/* ============================================================
   RESUMO POR EQUIPAMENTO
   ============================================================ */

if (!$porEq) {

    $html .= '

    <tr>

        <td colspan="6">

            Sem registros no período.

        </td>

    </tr>

    ';

} else {

    foreach ($porEq as $nomeEq => $e) {

        $html .= '

        <tr>


            <td>'
                .
                pdf_h(
                    $nomeEq
                )
                .
            '</td>


            <td class="n">'
                .
                pdf_brn(
                    $e['qtd'],
                    1
                )
                .
            '</td>


            <td class="n">'
                .
                pdf_brl(
                    $e['custo']
                )
                .
            '</td>


            <td class="n">'
                .
                pdf_brn(
                    $e['litros'],
                    1
                )
                .
                ' L
            </td>


            <td class="n">'
                .
                pdf_brl(
                    $e['comb']
                )
                .
            '</td>


            <td class="n b">'
                .
                pdf_brl(
                    $e['total']
                )
                .
            '</td>


        </tr>

        ';
    }
}


$html .= '

</tbody>

</table>


<br>


<div class="sec">

    USO DIÁRIO POR EQUIPAMENTO E EMPRESA

</div>


<br>


<table cellpadding="3">


<thead>


<tr>


<th width="8%">
    DATA
</th>


<th width="11%">
    EMPRESA
</th>


<th width="13%">
    EQUIPAMENTO
</th>


<th width="11%">
    USO
</th>


<th
    width="7%"
    class="n"
>
    QTD.
</th>


<th
    width="11%"
    class="n"
>
    CUSTO EQUIP.
</th>


<th
    width="8%"
    class="n"
>
    LITROS
</th>


<th
    width="11%"
    class="n"
>
    COMBUSTÍVEL
</th>


<th
    width="10%"
    class="n"
>
    TOTAL
</th>


<th width="10%">
    OPERADOR / OBS.
</th>


</tr>


</thead>


<tbody>
';


/* ============================================================
   USO DIÁRIO
   ============================================================ */

if (!$porDia) {

    $html .= '

    <tr>

        <td colspan="10">

            Sem registros no período.

        </td>

    </tr>

    ';

} else {

    foreach ($porDia as $e) {

        $html .= '

        <tr>


            <td>'
                .
                pdf_dataBr(
                    $e['data']
                )
                .
            '</td>


            <td>'
                .
                pdf_h(
                    $e['empresa']
                )
                .
            '</td>


            <td>'
                .
                pdf_h(
                    $e['equipamento']
                )
                .
            '</td>


            <td>'
                .
                pdf_h(
                    $e['uso']
                )
                .
            '</td>


            <td class="n">'
                .
                pdf_brn(
                    $e['qtd'],
                    1
                )
                .
            '</td>


            <td class="n">'
                .
                pdf_brl(
                    $e['custo']
                )
                .
            '</td>


            <td class="n">'
                .
                pdf_brn(
                    $e['litros'],
                    1
                )
                .
            '</td>


            <td class="n">'
                .
                pdf_brl(
                    $e['comb']
                )
                .
            '</td>


            <td class="n b">'
                .
                pdf_brl(
                    $e['total']
                )
                .
            '</td>


            <td>'
                .
                pdf_h(
                    implode(
                        ' | ',
                        array_keys(
                            $e['notas']
                        )
                    )
                )
                .
            '</td>


        </tr>

        ';
    }
}


$html .= '

</tbody>

</table>
';


/* ============================================================
   ASSINATURAS
   ============================================================ */

if (
    $tipo !== ''
    &&
    $tipo !== 'geral'
) {

    $html .= '

    <br>


    <table class="ass">


    <tr>


        <td width="50%">


            <div class="line">


                Responsável da '
                .
                pdf_h(
                    pdf_normEmp(
                        $tipo
                    )
                )
                .
                '


                <br>


                <span class="small">

                    Nome, assinatura e data

                </span>


            </div>


        </td>


        <td width="50%">


            <div class="line">


                MTEC / Administração da obra


                <br>


                <span class="small">

                    Nome, assinatura e data

                </span>


            </div>


        </td>


    </tr>


    </table>

    ';
}


/* ============================================================
   GERAÇÃO DO CONTEÚDO
   ============================================================ */

$pdf->writeHTML(
    $html,
    true,
    false,
    true,
    false,
    ''
);


/* ============================================================
   NOME DO ARQUIVO
   ============================================================ */

$arquivo =

    'RELATORIO_EQUIPAMENTOS_'

    .

    preg_replace(

        '/[^A-Za-z0-9_-]+/',

        '_',

        $tipoTitulo
        .
        '_'
        .
        $ini
        .
        '_'
        .
        $fim

    )

    .

    '.pdf';


/* ============================================================
   EXIBE DIRETO NO NAVEGADOR
   ============================================================ */

$pdf->Output(
    $arquivo,
    'I'
);

exit;