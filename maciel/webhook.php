<?php
// Endpoint chamado pelo GitHub Webhook em cada push.
// Valida assinatura HMAC-SHA256, verifica o ramo e executa a atualização automática.

require __DIR__ . '/inc/nucleo.php';
require __DIR__ . '/inc/modelo.php';
require __DIR__ . '/inc/atualizar.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    exit(json_encode(['erro' => 'Método não permitido.']));
}

if (!config()) {
    http_response_code(503);
    exit(json_encode(['erro' => 'Sistema não instalado.']));
}

$segredo = sistema_ler('webhook_secret', '');
if (!$segredo) {
    http_response_code(403);
    exit(json_encode(['erro' => 'Webhook não configurado. Gere um segredo em admin.php.']));
}

$corpo = file_get_contents('php://input');
$assinatura = $_SERVER['HTTP_X_HUB_SIGNATURE_256'] ?? '';
$esperada = 'sha256=' . hash_hmac('sha256', $corpo, $segredo);
if (!hash_equals($esperada, $assinatura)) {
    http_response_code(401);
    exit(json_encode(['erro' => 'Assinatura inválida.']));
}

$payload = json_decode($corpo, true);
if (!is_array($payload)) {
    http_response_code(400);
    exit(json_encode(['erro' => 'Payload inválido.']));
}

// Só atualiza se o push for no ramo configurado
$cfg = config();
$ramoConf = $cfg['github_ramo'] ?? 'main';
$ramoEvento = ltrim($payload['ref'] ?? '', 'refs/heads/');
if ($ramoEvento !== $ramoConf) {
    http_response_code(200);
    exit(json_encode(['ok' => false, 'motivo' => "Push no ramo '$ramoEvento', ignorado (esperado '$ramoConf')."]));
}

try {
    $r = atualizar_pelo_github($cfg);
    $sha = substr($payload['after'] ?? '', 0, 7);
    $autor = $payload['pusher']['name'] ?? 'desconhecido';
    q('INSERT INTO historico (quando, usuario, acao, detalhe) VALUES (?, ?, ?, ?)',
        [agora(), 'webhook', 'deploy_automatico', json_encode(['sha' => $sha, 'autor' => $autor, 'msg' => $r['mensagem']], JSON_UNESCAPED_UNICODE)]);
    http_response_code(200);
    echo json_encode(['ok' => true, 'mensagem' => $r['mensagem'], 'sha' => $sha]);
} catch (Exception $e) {
    q('INSERT INTO historico (quando, usuario, acao, detalhe) VALUES (?, ?, ?, ?)',
        [agora(), 'webhook', 'deploy_falhou', json_encode(['erro' => $e->getMessage()], JSON_UNESCAPED_UNICODE)]);
    http_response_code(500);
    echo json_encode(['ok' => false, 'erro' => $e->getMessage()]);
}
