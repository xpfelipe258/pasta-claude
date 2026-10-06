<?php
require __DIR__ . '/inc/nucleo.php';
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');
if (!config()) { header('Location: instalar.php'); exit; }
iniciar_sessao();
$msg = '';
$erro = '';
$token = trim($_GET['token'] ?? ($_POST['token'] ?? ''));
$modoToken = $token !== '';
$usuarioToken = null;
$resetRow = null;
if ($modoToken) {
    $hash = hash('sha256', $token);
    $resetRow = q_global('SELECT r.*, u.nome, u.login, u.email, u.ativo FROM redefinicoes_senha r JOIN usuarios u ON u.id = r.usuario_id WHERE r.token_hash = ? AND r.usado_em IS NULL ORDER BY r.id DESC LIMIT 1', [$hash])->fetch();
    if (!$resetRow || strtotime($resetRow['expira_em']) < time() || !(int)$resetRow['ativo']) {
        $erro = 'Link inválido ou expirado. Solicite uma nova redefinição.';
        $modoToken = false;
    }
}
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    conferir_csrf();
    try {
        if ($_POST['acao'] === 'solicitar') {
            $ident = trim($_POST['identificacao'] ?? '');
            if ($ident === '') { throw new InvalidArgumentException('Informe seu login ou e-mail.'); }
            $u = q_global('SELECT id,nome,login,email,ativo FROM usuarios WHERE ativo=1 AND (login = ? OR email = ?) LIMIT 1', [$ident, $ident])->fetch();
            if ($u && !empty($u['email'])) {
                enviar_link_redefinicao($u);
            }
            $msg = 'Se o usuário existir e tiver e-mail cadastrado, enviaremos um link de redefinição.';
            $modoToken = false;
        } elseif ($_POST['acao'] === 'redefinir') {
            if (!$resetRow) { throw new InvalidArgumentException('Link inválido ou expirado.'); }
            $senha = $_POST['senha'] ?? '';
            $conf = $_POST['confirmar'] ?? '';
            if (strlen($senha) < 8) { throw new InvalidArgumentException('A nova senha precisa ter pelo menos 8 caracteres.'); }
            if ($senha !== $conf) { throw new InvalidArgumentException('As senhas não conferem.'); }
            q_global('UPDATE usuarios SET senha = ? WHERE id = ?', [password_hash($senha, PASSWORD_DEFAULT), (int)$resetRow['usuario_id']]);
            q_global('UPDATE redefinicoes_senha SET usado_em = ? WHERE id = ?', [agora(), (int)$resetRow['id']]);
            registrar_global('senha_redefinida_por_link', ['login' => $resetRow['login']]);
            $msg = 'Senha alterada com sucesso. Você já pode entrar no sistema.';
            $modoToken = false;
            $token = '';
        }
    } catch (InvalidArgumentException $e) {
        $erro = $e->getMessage();
    } catch (Exception $e) {
        $erro = 'Falha: ' . $e->getMessage();
    }
}
pagina_inicio('Redefinir senha');
$logo = global_ler('logo', '');
?>
<main class="login-premium">
  <section class="login-showcase">
    <div class="login-brand"><?php if ($logo): ?><img src="<?= h($logo) ?>" alt="Logo"><?php else: ?><span>NO</span><?php endif; ?><strong><?= h(global_ler('nome_sistema','Núcleo de Obras')) ?></strong></div>
    <div class="login-copy"><span class="eyebrow">ACESSO SEGURO</span><h1>Redefina sua senha.</h1><p>O link é enviado para o e-mail vinculado ao usuário e expira em 2 horas.</p></div>
    <div class="login-features"><span>Token único</span><span>Validade limitada</span><span>Senha criptografada</span></div>
  </section>
  <section class="login-panel"><form method="post" class="login-form">
    <div class="mobile-logo"><?php if ($logo): ?><img src="<?= h($logo) ?>" alt="Logo"><?php endif; ?></div>
    <span class="eyebrow">RECUPERAÇÃO DE ACESSO</span>
    <?php if ($modoToken): ?>
      <h2>Criar nova senha</h2><p>Defina uma nova senha para <?= h($resetRow['nome']) ?>.</p>
      <input type="hidden" name="csrf" value="<?= h(token_csrf()) ?>"><input type="hidden" name="acao" value="redefinir"><input type="hidden" name="token" value="<?= h($token) ?>">
      <label>Nova senha<div class="input-wrap"><span>◆</span><input name="senha" type="password" minlength="8" autocomplete="new-password" required autofocus></div></label>
      <label>Confirmar senha<div class="input-wrap"><span>◆</span><input name="confirmar" type="password" minlength="8" autocomplete="new-password" required></div></label>
      <?php if ($erro): ?><p class="erro-form"><?= h($erro) ?></p><?php endif; ?><?php if ($msg): ?><p class="ok-form"><?= h($msg) ?></p><?php endif; ?>
      <button class="btn primario login-button" type="submit">Salvar nova senha <span>→</span></button>
    <?php else: ?>
      <h2>Esqueci minha senha</h2><p>Informe seu login ou e-mail. Se houver e-mail vinculado, enviaremos o link de redefinição.</p>
      <input type="hidden" name="csrf" value="<?= h(token_csrf()) ?>"><input type="hidden" name="acao" value="solicitar">
      <label>Login ou e-mail<div class="input-wrap"><span>●</span><input name="identificacao" autocomplete="username email" placeholder="Seu login ou e-mail" required autofocus></div></label>
      <?php if ($erro): ?><p class="erro-form"><?= h($erro) ?></p><?php endif; ?><?php if ($msg): ?><p class="ok-form"><?= h($msg) ?></p><?php endif; ?>
      <button class="btn primario login-button" type="submit">Enviar link de redefinição <span>→</span></button>
    <?php endif; ?>
    <div class="login-links"><a href="login.php">Voltar para o login</a></div>
    <small class="login-security">O link só pode ser usado uma vez</small>
  </form></section>
</main>
</body></html>
