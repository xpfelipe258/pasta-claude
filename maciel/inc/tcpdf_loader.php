<?php
/**
 * Loader TCPDF para PHP 8.3.
 * Prioriza instalação local sem Composer (TCPDF 6.11.3) e aceita vendor/ quando existente.
 */
$autoloads = [
    __DIR__ . '/../vendor/autoload.php',
    __DIR__ . '/../../vendor/autoload.php',
];
foreach ($autoloads as $autoload) {
    if (is_file($autoload)) {
        require_once $autoload;
        if (class_exists('TCPDF', false) || class_exists('TCPDF')) {
            return;
        }
    }
}

$tcpdfCandidatos = [
    __DIR__ . '/../tcpdf/tcpdf.php',
    __DIR__ . '/../tcpdf.php',
    __DIR__ . '/../tcpdf.8993/tcpdf.php',
    __DIR__ . '/../vendor/tecnickcom/tcpdf/tcpdf.php',
    __DIR__ . '/../../tcpdf/tcpdf.php',
];
foreach ($tcpdfCandidatos as $arq) {
    if (is_file($arq)) {
        require_once $arq;
        if (class_exists('TCPDF')) {
            return;
        }
    }
}

http_response_code(500);
exit("TCPDF não encontrado. Ambiente alvo: PHP 8.3. Para instalação sem Composer, publique o TCPDF em /tcpdf/tcpdf.php ou /tcpdf.php.\n");
