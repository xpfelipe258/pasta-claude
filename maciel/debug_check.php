<?php
ini_set('display_errors', 1);
error_reporting(E_ALL);
try {
    define('RAIZ', dirname(__DIR__));
    define('ARQ_CONFIG', __DIR__ . '/inc/config.php');
    $cfg = require __DIR__ . '/inc/config.php';
    echo "config OK: driver=" . $cfg['driver'] . "\n";
    $pdo = new PDO('mysql:host=' . $cfg['host'] . ';dbname=' . $cfg['banco'] . ';charset=utf8mb4', $cfg['usuario'], $cfg['senha']);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $v = $pdo->query("SELECT valor FROM sistema WHERE chave='esquema'")->fetchColumn();
    echo "DB OK: esquema=" . $v . "\n";
} catch (Throwable $e) {
    echo "ERRO: " . $e->getMessage() . "\n";
    echo "File: " . $e->getFile() . " Line: " . $e->getLine() . "\n";
}
