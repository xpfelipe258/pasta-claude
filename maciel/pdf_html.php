<?php

require __DIR__ . '/inc/nucleo.php';

$u    = exigir_login_pagina();
$obra = exigir_obra_pagina();

conferir_csrf();

if (!usuario_pode_modulo($u, 'financeiro')) {
    http_response_code(403);
    exit('Sem acesso ao módulo Financeiro.');
}

/*
|--------------------------------------------------------------------------
| TCPDF
|--------------------------------------------------------------------------
*/
require_once __DIR__ . '/tcpdf/tcpdf.php';

if (!class_exists('TCPDF')) {
    http_response_code(500);
    exit('TCPDF não encontrado em /tcpdf/tcpdf.php.');
}

/*
|--------------------------------------------------------------------------
| DADOS RECEBIDOS
|--------------------------------------------------------------------------
*/
$html = (string)($_POST['html'] ?? '');

if ($html === '') {
    exit('Conteúdo vazio.');
}

$nome    = (string)($_POST['nome'] ?? 'Boletim de Medição');
$empresa = (string)($_POST['empresa'] ?? '');
$bm      = (string)($_POST['bm'] ?? '');
$periodo = (string)($_POST['periodo'] ?? '');
$status  = (string)($_POST['status'] ?? 'EM ABERTO');
$corte   = (string)($_POST['corte'] ?? '');

$obraNome = (string)($obra['nome'] ?? 'OBRA');

/*
|--------------------------------------------------------------------------
| TRATAMENTO DO HTML
|--------------------------------------------------------------------------
|
| Mantemos o CSS que veio junto com o HTML.
| O cabeçalho principal NÃO vem do HTML.
| Ele será desenhado diretamente pelo TCPDF.
|
*/

$css = '';

if (preg_match_all(
    '#<style[^>]*>(.*?)</style>#is',
    $html,
    $sm
)) {
    $css = '<style>' . implode("\n", $sm[1]) . '</style>';
}

if (preg_match(
    '#<body[^>]*>(.*)</body>#is',
    $html,
    $m
)) {
    $html = $css . $m[1];
}

/*
|--------------------------------------------------------------------------
| CLASSE PDF
|--------------------------------------------------------------------------
*/

class PDFBM extends TCPDF
{
    public function Footer(): void
    {
        $this->SetY(-7);

        $this->SetFont(
            'helvetica',
            '',
            6.5
        );

        $this->SetTextColor(
            110,
            125,
            140
        );

        $this->Cell(
            135,
            4,
            'Controle de Produção • Boletim de Medição',
            0,
            0,
            'L'
        );

        $this->Cell(
            0,
            4,
            'Página ' .
            $this->getAliasNumPage() .
            ' de ' .
            $this->getAliasNbPages(),
            0,
            0,
            'R'
        );
    }
}

/*
|--------------------------------------------------------------------------
| CRIAÇÃO DO PDF
|--------------------------------------------------------------------------
*/

$pdf = new PDFBM(
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
        ?? $u['login']
        ?? ''
    )
);

$pdf->SetTitle(
    $nome . ' - ' . $obraNome
);

$pdf->SetSubject(
    'Boletim de Medição de Obra'
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
    11
);

$pdf->SetFooterMargin(5);

$pdf->AddPage();

/*
|--------------------------------------------------------------------------
| CABEÇALHO
|--------------------------------------------------------------------------
|
| Sem borda preta.
| O layout possui:
|
| RÓTULA
| BOLETIM DE MEDIÇÃO
| BM
|
*/

$y = $pdf->GetY();

/*
|--------------------------------------------------------------------------
| LOGO / NOME EMPRESA
|--------------------------------------------------------------------------
*/

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
    48,
    8,
    'RÓTULA',
    0,
    0,
    'L'
);

/*
| Subtítulo
*/

$pdf->SetFont(
    'helvetica',
    '',
    6
);

$pdf->SetTextColor(
    105,
    125,
    145
);

$pdf->SetXY(
    10,
    $y + 10
);

$pdf->Cell(
    48,
    4,
    'ENGENHARIA',
    0,
    0,
    'L'
);

/*
|--------------------------------------------------------------------------
| TÍTULO CENTRAL
|--------------------------------------------------------------------------
*/

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
    58,
    $y + 2
);

$pdf->Cell(
    174,
    8,
    'BOLETIM DE MEDIÇÃO',
    0,
    0,
    'C'
);

$pdf->SetFont(
    'helvetica',
    '',
    6.5
);

$pdf->SetTextColor(
    105,
    125,
    145
);

$pdf->SetXY(
    58,
    $y + 11
);

$pdf->Cell(
    174,
    4,
    'CONTROLE DE PRODUÇÃO • ENGENHARIA',
    0,
    0,
    'C'
);

/*
|--------------------------------------------------------------------------
| BLOCO BM
|--------------------------------------------------------------------------
*/

$pdf->SetFillColor(
    28,
    111,
    159
);

$pdf->SetTextColor(
    255,
    255,
    255
);

/*
| Fundo azul
| SEM BORDA
*/

$pdf->Rect(
    232,
    $y,
    55,
    18,
    'F'
);

/*
| BOLETIM
*/

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
    4,
    'BOLETIM',
    0,
    0,
    'C'
);

/*
| BM
*/

$pdf->SetFont(
    'helvetica',
    'B',
    14
);

$pdf->SetXY(
    232,
    $y + 5
);

$pdf->Cell(
    55,
    7,
    'BM' . $bm,
    0,
    0,
    'C'
);

/*
| OBRA
*/

$pdf->SetFont(
    'helvetica',
    'B',
    6.5
);

$pdf->SetXY(
    232,
    $y + 13
);

$pdf->Cell(
    55,
    4,
    $obraNome,
    0,
    0,
    'C'
);

/*
|--------------------------------------------------------------------------
| ESPAÇO ENTRE CABEÇALHO E INFORMAÇÕES
|--------------------------------------------------------------------------
*/

$infoY = $y + 20;

/*
|--------------------------------------------------------------------------
| INFORMAÇÕES DO BOLETIM
|--------------------------------------------------------------------------
|
| IMPORTANTE:
|
| Todos os cards utilizam EXATAMENTE o mesmo $infoY.
|
| Isso elimina o problema de:
|
| OBRA
|       PERÍODO
|               DATA
|                       SITUAÇÃO
|
| que estava acontecendo anteriormente.
|
*/

$xs = [
    10,
    80,
    150,
    220
];

$ws = [
    70,
    70,
    70,
    67
];

$labs = [
    'OBRA / EMPRESA',
    'PERÍODO DA MEDIÇÃO',
    'DATA DE CORTE',
    'SITUAÇÃO'
];

$vals = [
    trim(
        $obraNome .
        (
            $empresa
            ? ' • ' . $empresa
            : ''
        )
    ),

    $periodo,

    $corte,

    $status
];

/*
|--------------------------------------------------------------------------
| FUNDO DOS 4 CARDS
|--------------------------------------------------------------------------
*/

$pdf->SetFillColor(
    247,
    250,
    252
);

for ($i = 0; $i < 4; $i++) {

    /*
    |--------------------------------------------------------------------------
    | FUNDO
    |--------------------------------------------------------------------------
    |
    | TODOS usam $infoY.
    | Não usamos GetY() dentro do loop.
    |
    */

    $pdf->Rect(
        $xs[$i],
        $infoY,
        $ws[$i],
        10,
        'F'
    );

    /*
    |--------------------------------------------------------------------------
    | LABEL
    |--------------------------------------------------------------------------
    */

    $pdf->SetTextColor(
        105,
        125,
        145
    );

    $pdf->SetFont(
        'helvetica',
        'B',
        5.5
    );

    $pdf->SetXY(
        $xs[$i] + 2,
        $infoY + 1
    );

    $pdf->Cell(
        $ws[$i] - 4,
        3,
        $labs[$i],
        0,
        0,
        'L'
    );

    /*
    |--------------------------------------------------------------------------
    | VALOR
    |--------------------------------------------------------------------------
    */

    $pdf->SetTextColor(
        18,
        61,
        91
    );

    $pdf->SetFont(
        'helvetica',
        'B',
        7.2
    );

    $pdf->SetXY(
        $xs[$i] + 2,
        $infoY + 4
    );

    $pdf->Cell(
        $ws[$i] - 4,
        4,
        $vals[$i],
        0,
        0,
        'L'
    );
}

/*
|--------------------------------------------------------------------------
| LINHA INFERIOR SUAVE
|--------------------------------------------------------------------------
|
| Só uma linha fina para separar o cabeçalho.
| NÃO é borda preta.
|
*/

$pdf->SetDrawColor(
    218,
    228,
    236
);

$pdf->SetLineWidth(0.15);

$pdf->Line(
    10,
    $infoY + 10,
    287,
    $infoY + 10
);

/*
|--------------------------------------------------------------------------
| POSIÇÃO DO CONTEÚDO
|--------------------------------------------------------------------------
|
| Forçamos o cursor para DEPOIS dos cards.
| Não dependemos do Y alterado por Cell().
|
*/

$pdf->SetY(
    $infoY + 13
);

/*
|--------------------------------------------------------------------------
| CONTEÚDO PRINCIPAL
|--------------------------------------------------------------------------
*/

$pdf->SetFont(
    'helvetica',
    '',
    8
);

$pdf->writeHTML(
    $html,
    true,
    false,
    true,
    false,
    ''
);

/*
|--------------------------------------------------------------------------
| NOME DO ARQUIVO
|--------------------------------------------------------------------------
*/

$arquivo = preg_replace(
    '/[^A-Za-z0-9_-]+/',
    '_',
    $nome
);

if (
    $arquivo === null ||
    $arquivo === ''
) {
    $arquivo = 'boletim_medicao';
}

/*
|--------------------------------------------------------------------------
| ABRIR PDF NO NAVEGADOR
|--------------------------------------------------------------------------
*/

$pdf->Output(
    $arquivo . '.pdf',
    'I'
);

exit;