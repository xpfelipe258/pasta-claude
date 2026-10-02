<?php
require __DIR__ . '/inc/nucleo.php';
exigir_login_pagina();
$html = file_get_contents(__DIR__ . '/inc/painel.html');
$html = str_replace('<script src="chart.umd.js"></script>', "<script>window.API_BASE = 'api.php?r=';</script>\n<script src=\"chart.umd.js\"></script>", $html);
header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-store');
echo $html;
