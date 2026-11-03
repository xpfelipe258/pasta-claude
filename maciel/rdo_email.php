<?php
// RDO do cliente por e-mail: configuração (destinatários, envio automático, assunto e mensagem), pré-visualização do e-mail e envio com o PDF em anexo.
// Só o administrador da obra (o mesmo que valida o RDO) configura e envia; o dia precisa estar VALIDADO.
require __DIR__ . '/inc/nucleo.php';
require __DIR__ . '/inc/modelo.php';

function re_resp($cod, array $d)
{
    http_response_code($cod);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($d, JSON_UNESCAPED_UNICODE);
    exit;
}

if (!config()) { re_resp(503, ['erro' => 'Sistema não instalado.']); }
$u = usuario_atual();
if (!$u) { re_resp(401, ['erro' => 'Faça login novamente.']); }
$obraId = obra_atual_id();
$obra = $obraId ? q_global("SELECT id FROM obras WHERE id = ? AND status = 'ativa'", [$obraId])->fetch() : null;
if (!$obra || !usuario_pode_obra($u, $obraId)) { re_resp(409, ['erro' => 'Selecione uma obra na Central de Obras.']); }
definir_obra_atual($obraId);
if ($_SERVER['REQUEST_METHOD'] !== 'POST') { re_resp(405, ['erro' => 'Método não permitido.']); }
conferir_csrf();
if (($u['perfil'] ?? '') === 'leitura' || !usuario_pode_modulo($u, 'producao') || !usuario_admin_da_obra($u)) {
    re_resp(403, ['erro' => 'Só o administrador da obra configura e envia o RDO ao cliente.']);
}
$acao = $_GET['acao'] ?? '';
$agora = (new DateTimeImmutable('now', new DateTimeZone('America/Sao_Paulo')))->format('Y-m-d H:i:s');
$resumoDe = function ($s) { $r = json_decode((string)$s, true); return is_array($r) ? $r : []; };

if ($acao === 'config') {
    $c = json_decode((string)file_get_contents('php://input'), true);
    if (!is_array($c)) { re_resp(400, ['erro' => 'Dados inválidos.']); }
    list($ok, $ruins) = rdo_email_lista($c['destinatarios'] ?? '');
    if ($ruins) { re_resp(400, ['erro' => 'E-mail inválido: ' . implode(', ', array_slice($ruins, 0, 3)) . '. Confira os endereços.']); }
    if (count($ok) > 10) { re_resp(400, ['erro' => 'No máximo 10 destinatários.']); }
    $auto = !empty($c['auto']) ? 1 : 0;
    if ($auto && !$ok) { re_resp(400, ['erro' => 'Informe ao menos um e-mail de destino para ligar o envio automático.']); }
    $assunto = mb_substr(trim((string)($c['assunto'] ?? '')), 0, 160) ?: rdo_email_padroes()['assunto'];
    $mensagem = mb_substr(trim((string)($c['mensagem'] ?? '')), 0, 2000) ?: rdo_email_padroes()['mensagem'];
    $novo = ['destinatarios' => $ok, 'auto' => $auto, 'copia' => !empty($c['copia']) ? 1 : 0, 'assunto' => $assunto, 'mensagem' => $mensagem];
    sistema_gravar('rdo_email', json_encode($novo, JSON_UNESCAPED_UNICODE));
    sistema_gravar('versao', (string)((int)sistema_ler('versao', '0') + 1));
    registrar_global('rdo_email_config', ['obra' => $obraId, 'destinatarios' => count($ok), 'auto' => $auto]);
    re_resp(200, ['ok' => true, 'cfg' => $novo]);
}

if ($acao === 'previa') {
    $c = json_decode((string)file_get_contents('php://input'), true);
    $c = is_array($c) ? $c : [];
    $dia = (string)($c['data'] ?? '');
    if (!data_valida($dia)) { re_resp(400, ['erro' => 'Data inválida.']); }
    $cfg = rdo_email_cfg();
    foreach (['assunto', 'mensagem'] as $k) { if (isset($c[$k]) && trim((string)$c[$k]) !== '') { $cfg[$k] = mb_substr(trim((string)$c[$k]), 0, $k === 'assunto' ? 160 : 2000); } }
    $ant = null;
    foreach (array_reverse(rdo_email_envios($dia)) as $e) { if (!empty($e['ok'])) { $ant = $e['em']; break; } }
    $corpo = rdo_email_corpo($cfg, $dia, is_array($c['resumo'] ?? null) ? $c['resumo'] : [], $u, $ant);
    re_resp(200, ['ok' => true, 'assunto' => $corpo['assunto'], 'html' => $corpo['html'], 'para' => $cfg['destinatarios'], 'replyto' => (string)($u['email'] ?? '')]);
}

if ($acao === 'enviar') {
    $dia = (string)($_GET['data'] ?? '');
    if (!data_valida($dia)) { re_resp(400, ['erro' => 'Data inválida.']); }
    if (!rdo_dia_validacao($dia)) { re_resp(409, ['erro' => 'O RDO de ' . date('d/m/Y', strtotime($dia)) . ' ainda não foi validado. Valide antes de enviar ao cliente.']); }
    $cfg = rdo_email_cfg();
    if (!$cfg['destinatarios']) { re_resp(409, ['erro' => 'Configure o e-mail do cliente (botão "Configurar envio").']); }
    $pdf = (string)file_get_contents('php://input');
    if ($pdf === '' || strlen($pdf) > 14 * 1048576) { re_resp(400, ['erro' => 'PDF vazio ou maior que 14 MB.']); }
    if (strncmp($pdf, '%PDF', 4) !== 0) { re_resp(400, ['erro' => 'O arquivo enviado não é um PDF.']); }
    $ant = null;
    foreach (array_reverse(rdo_email_envios($dia)) as $e) { if (!empty($e['ok'])) { $ant = $e['em']; break; } }
    $corpo = rdo_email_corpo($cfg, $dia, $resumoDe($_GET['resumo'] ?? ''), $u, $ant);
    $nomePdf = 'RDO-' . $dia . '.pdf';
    $ok = $falhas = [];
    $cc = $cfg['copia'] ? (string)($u['email'] ?? '') : '';
    foreach ($cfg['destinatarios'] as $para) {
        if (rdo_email_enviar_um($para, $corpo, $pdf, $nomePdf, (string)($u['email'] ?? ''), $cc)) { $ok[] = $para; } else { $falhas[] = $para; }
    }
    $env = rdo_email_envios();
    $env[$dia][] = ['em' => $agora, 'por' => (string)$u['nome'], 'ok' => count($ok) > 0 ? 1 : 0, 'para' => $ok, 'falhas' => $falhas, 'tam' => strlen($pdf), 'auto' => !empty($_GET['auto']) ? 1 : 0];
    $env[$dia] = array_slice($env[$dia], -20);
    sistema_gravar('rdo_email_envios', json_encode((object)$env, JSON_UNESCAPED_UNICODE));
    sistema_gravar('versao', (string)((int)sistema_ler('versao', '0') + 1));
    registrar_global('rdo_email_envio', ['obra' => $obraId, 'data' => $dia, 'ok' => count($ok), 'falhas' => count($falhas), 'auto' => !empty($_GET['auto']) ? 1 : 0]);
    if (!$ok) { re_resp(502, ['erro' => 'O servidor não aceitou o envio do e-mail. Tente de novo em instantes.', 'falhas' => $falhas]); }
    re_resp(200, ['ok' => true, 'enviados' => $ok, 'falhas' => $falhas, 'copia' => $cc]);
}
re_resp(400, ['erro' => 'Ação desconhecida.']);
