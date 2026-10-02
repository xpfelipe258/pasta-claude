<?php
require __DIR__ . '/inc/nucleo.php';
if (!config()) {
    header('Location: instalar.php');
    exit;
}
iniciar_sessao();
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');
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
        $_SESSION['csrf'] = bin2hex(random_bytes(16));
        q('INSERT INTO historico (quando, usuario, acao, detalhe) VALUES (?, ?, ?, ?)', [agora(), $u['login'], 'login', null]);
        header('Location: index.php');
        exit;
    }
    sleep(1);
    $erro = 'Usuário ou senha incorretos.';
}
pagina_inicio('Entrar');
?>
<main class="pagina-login">
  <form method="post" class="bloco form-login">
    <div class="marca"><span class="marca-sigla">198</span><div><h1>Controle de Produção</h1><div class="nota"><?= h(sistema_ler('obra_nome', '')) ?></div></div></div>
    <input type="hidden" name="csrf" value="<?= h(token_csrf()) ?>">
    <label>Usuário<input name="login" autocomplete="username" required autofocus></label>
    <label>Senha<input name="senha" type="password" autocomplete="current-password" required></label>
    <?php if ($erro): ?><p class="erro-form"><?= h($erro) ?></p><?php endif; ?>
    <button class="btn primario" type="submit">Entrar</button>
  </form>
</main>
</body></html>
