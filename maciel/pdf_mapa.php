<?php
require __DIR__.'/inc/nucleo.php';
$u=exigir_login_pagina(); exigir_obra_pagina(); conferir_csrf();
if(!usuario_pode_modulo($u,'producao')){http_response_code(403);exit('Sem acesso ao módulo Produção.');}
require __DIR__.'/inc/tcpdf_loader.php';
$raw=(string)($_POST['imagem']??''); if(!preg_match('#^data:image/png;base64,(.+)$#',$raw,$m)) exit('Imagem inválida.');
$bin=base64_decode($m[1],true); if($bin===false) exit('Imagem inválida.');
$pdf=new TCPDF('L','mm','A4',true,'UTF-8',false); $pdf->SetCreator('Controle de Produção'); $pdf->SetTitle($_POST['titulo']??'Mapa de montagem');
$pdf->setPrintHeader(false);$pdf->setPrintFooter(false);$pdf->SetMargins(8,8,8);$pdf->AddPage();
$pdf->SetFont('helvetica','B',12);$pdf->Cell(0,7,(string)($_POST['titulo']??'Mapa de montagem'),0,1,'C');
$pdf->Image('@'.$bin,8,18,281,0,'PNG','','',true,220,'C');
$pdf->Output('mapa_montagem_'.date('Ymd_His').'.pdf','I');
