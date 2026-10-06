<?php
require __DIR__ . '/inc/nucleo.php';
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');
if (!config()) {
    header('Location: instalar.php');
    exit;
}
iniciar_sessao();
$erro = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    conferir_csrf();
    $u = q('SELECT * FROM usuarios WHERE login = ? AND ativo = 1', [trim($_POST['login'] ?? '')])->fetch();
    if ($u && password_verify($_POST['senha'] ?? '', $u['senha'])) {
        if (!session_regenerate_id(true)) {
            http_response_code(500);
            exit('Não foi possível renovar a sessão. Tente novamente.');
        }
        $_SESSION['uid'] = (int)$u['id'];
        $_SESSION['ultimo'] = time();
        $_SESSION['obra_id'] = 0;
        $_SESSION['csrf'] = bin2hex(random_bytes(16));
        registrar_global('login', ['login' => $u['login']]);
        header('Location: obras.php');
        exit;
    }
    sleep(1);
    $erro = 'Usuário ou senha incorretos.';
}
pagina_inicio('Entrar');
$logo = global_ler('logo', '');
?>
<main class="login-premium">
  <section class="login-showcase">
    <div class="login-brand"><?php if ($logo): ?><img src="<?= h($logo) ?>" alt="Logo"><?php else: ?><span>NO</span><?php endif; ?><strong><?= h(global_ler('nome_sistema','Núcleo de Obras')) ?></strong></div>
    <div class="login-copy"><span class="eyebrow">GESTÃO CONECTADA</span><h1>Decisões claras.<br>Obras sob controle.</h1><p>Produção, planejamento, suprimentos, medição e indicadores reunidos em uma experiência única.</p></div>
    <div class="login-features"><span>Visão multiobras</span><span>Dados isolados</span><span>Gestão em tempo real</span></div>
  </section>
  <section class="login-panel"><form method="post" class="login-form">
    <div class="mobile-logo"><?php if ($logo): ?><img src="<?= h($logo) ?>" alt="Logo"><?php endif; ?></div>
    <span class="eyebrow">ACESSO SEGURO</span><h2>Bem-vindo de volta</h2><p>Entre para acessar sua central de obras.</p>
    <input type="hidden" name="csrf" value="<?= h(token_csrf()) ?>">
    <label>Usuário<div class="input-wrap"><span>●</span><input name="login" autocomplete="username" placeholder="Seu usuário" required autofocus></div></label>
    <label>Senha<div class="input-wrap"><span>◆</span><input name="senha" type="password" autocomplete="current-password" placeholder="Sua senha" required></div></label>
    <?php if ($erro): ?><p class="erro-form"><?= h($erro) ?></p><?php endif; ?>
    <button class="btn primario login-button" type="submit">Entrar no sistema <span>→</span></button>
    <div class="login-links"><a href="redefinir_senha.php">Esqueci minha senha</a></div>
    <small class="login-security">Sessão protegida e acesso monitorado</small>
  </form></section>
</main>
</body></html>
