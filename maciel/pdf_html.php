<?php
require __DIR__.'/inc/nucleo.php';

$u = exigir_login_pagina();
$obra = exigir_obra_pagina();
conferir_csrf();

if (!usuario_pode_modulo($u,'financeiro')) {
    http_response_code(403);
    exit('Sem acesso ao módulo Financeiro.');
}

require __DIR__.'/inc/tcpdf_loader.php';

if (!class_exists('TCPDF')) {
    http_response_code(500);
    exit('TCPDF não encontrado/carregado em inc/tcpdf_loader.php.');
}

$html = (string)($_POST['html'] ?? '');

if ($html === '') {
    exit('Conteúdo vazio.');
}

/*
 * Preserva o CSS enviado pelo app.js.
 * Extrai os <style> do <head> e junta ao conteúdo do <body>
 * para o TCPDF manter o design.
 */
$css = '';

if (preg_match_all('#<style[^>]*>(.*?)</style>#is', $html, $sm)) {
    $css = '<style>'.implode("\n", $sm[1]).'</style>';
}

if (preg_match('#<body[^>]*>(.*)</body>#is', $html, $m)) {
    $html = $css.$m[1];
}

/*
 * TCPDF REAL
 * A4 horizontal (landscape)
 */
$pdf = new TCPDF('L','mm','A4',true,'UTF-8',false);

$pdf->SetCreator('Sistema de Controle de Produção');
$pdf->SetAuthor((string)($u['nome'] ?? $u['login'] ?? ''));
$pdf->SetTitle(
    (string)($_POST['nome'] ?? 'Boletim de Medição')
    .' - '.
    ($obra['nome'] ?? '')
);
$pdf->SetSubject('Boletim de Medição de Obra');

$pdf->setPrintHeader(false);
$pdf->setPrintFooter(true);

$pdf->SetFooterMargin(7);
$pdf->SetMargins(8,8,8);
$pdf->SetAutoPageBreak(true,12);

$pdf->setFooterFont(array('helvetica','',7));
$pdf->setFooterData(
    array(90,100,115),
    array(220,220,220)
);

$pdf->AddPage();
$pdf->SetFont('helvetica','',8.2);

/*
 * Renderização HTML/CSS feita pelo TCPDF.
 */
$pdf->writeHTML(
    $html,
    true,
    false,
    true,
    false,
    ''
);

$nome = preg_replace(
    '/[^A-Za-z0-9_-]+/',
    '_',
    $_POST['nome'] ?? 'relatorio'
);

/*
 * I = INLINE.
 * O Chrome abre o visualizador do PDF.
 * Não chama window.print().
 */
$pdf->Output($nome.'.pdf','I');
exit;
