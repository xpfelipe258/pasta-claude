<?php
/**
 * Loader único do TCPDF do projeto.
 * A biblioteca oficial deve ficar na raiz em: /tcpdf/tcpdf.php
 * Não usa Composer e não usa cópias alternativas do TCPDF.
 */
$tcpdf = dirname(__DIR__) . '/tcpdf/tcpdf.php';

if (!is_file($tcpdf)) {
    http_response_code(500);
    exit('TCPDF não encontrado. Envie a biblioteca para /tcpdf/tcpdf.php.');
}

require_once $tcpdf;

if (!class_exists('TCPDF')) {
    http_response_code(500);
    exit('A biblioteca /tcpdf/tcpdf.php foi encontrada, mas a classe TCPDF não foi carregada.');
}
