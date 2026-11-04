<?php
// Verificação apenas dos administradores criados pelo cadastro público.
// Contas existentes não são marcadas como pendentes pela migração.
function verificacao_criar_token($usuarioId)
{
    $token = bin2hex(random_bytes(32));
    q_global('UPDATE usuarios SET email_verificacao_pendente = 1, email_verificacao_hash = ?, email_verificacao_expira_em = ?, email_verificacao_enviado_em = ? WHERE id = ?', [
        hash('sha256', $token), date('Y-m-d H:i:s', time() + 86400), agora(), (int)$usuarioId
    ]);
    return $token;
}

function verificacao_confirmar_token($token)
{
    if (!is_string($token) || !preg_match('/^[a-f0-9]{64}$/D', $token)) { return false; }
    $st = q_global('UPDATE usuarios SET email_verificacao_pendente = 0, email_verificado_em = ?, email_verificacao_hash = NULL, email_verificacao_expira_em = NULL WHERE email_verificacao_pendente = 1 AND email_verificacao_hash = ? AND email_verificacao_expira_em >= ?', [
        agora(), hash('sha256', $token), agora()
    ]);
    return $st->rowCount() === 1;
}

function verificacao_reenviar($email)
{
    $email = trim((string)$email);
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) { return; }
    $u = q_global('SELECT id, nome, email, email_verificacao_enviado_em FROM usuarios WHERE email = ? AND email_verificacao_pendente = 1 AND ativo = 1 ORDER BY id DESC LIMIT 1', [$email])->fetch();
    if (!$u || ($u['email_verificacao_enviado_em'] && strtotime($u['email_verificacao_enviado_em']) > time() - 300)) { return; }
    $token = verificacao_criar_token((int)$u['id']);
    require_once __DIR__ . '/cadastro_emails.php';
    $sistema = global_ler('nome_sistema', 'Núcleo de Obras');
    $link = url_base_sistema() . '/verificar_email.php?token=' . urlencode($token);
    enviar_email_sistema($u['email'], 'Confirme seu e-mail no ' . $sistema,
        cadastro_email_reenvio_verificacao(['sistema' => $sistema, 'admin_nome' => $u['nome'], 'link_verificacao' => $link]), true);
}
