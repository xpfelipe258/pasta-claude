<?php
ini_set('display_errors', 1);
error_reporting(E_ALL);

define('RAIZ', dirname(__DIR__));
define('ARQ_CONFIG', __DIR__ . '/inc/config.php');

$cfg = require __DIR__ . '/inc/config.php';
$pdo = new PDO('mysql:host=' . $cfg['host'] . ';dbname=' . $cfg['banco'] . ';charset=utf8mb4', $cfg['usuario'], $cfg['senha']);
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

// Check all tables
$tabelas = $pdo->query("SHOW TABLES")->fetchAll(PDO::FETCH_COLUMN);
echo "Tables: " . implode(', ', $tabelas) . "\n\n";

// Check if obras exists and has data
$obras = $pdo->query("SELECT id, nome FROM obras")->fetchAll();
echo "Obras: " . count($obras) . "\n";
foreach ($obras as $o) echo " - [{$o['id']}] {$o['nome']}\n";

// Check redefinicoes_senha table
$cols = $pdo->query("SHOW COLUMNS FROM redefinicoes_senha")->fetchAll(PDO::FETCH_COLUMN);
echo "\nredefinicoes_senha cols: " . implode(', ', $cols) . "\n";

// Test q_global equivalent
echo "\nTest usuarios_modulos: " . $pdo->query("SELECT COUNT(*) FROM usuarios_modulos")->fetchColumn() . " rows\n";
