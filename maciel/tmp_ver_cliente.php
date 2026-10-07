<?php
require_once __DIR__ . '/inc/nucleo.php';
$cfg = config();
if (!$cfg) { http_response_code(500); echo 'config.php não encontrado'; exit; }
$pdo = conectar($cfg);

$acao = $_GET['acao'] ?? 'ver';

header('Content-Type: application/json; charset=utf-8');

if ($acao === 'ver') {
    $rows = $pdo->query("SELECT id, obra_id, servico, qtd, frente, inicio_plan, meta_dia, prazo, peso FROM cliente ORDER BY servico, frente")->fetchAll(PDO::FETCH_ASSOC);
    $obra = $pdo->query("SELECT valor FROM sistema WHERE chave = 'obra_id'")->fetchColumn();
    echo json_encode(['obra_id' => $obra, 'total' => count($rows), 'rows' => $rows], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
}
