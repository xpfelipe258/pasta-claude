<?php
require __DIR__ . '/inc/nucleo.php';
require_once __DIR__ . '/inc/verificacao_email.php';
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Referrer-Policy: no-referrer');
if (!config()) { header('Location: instalar.php'); exit; }
iniciar_sessao();

$estado = 'pendente';
if (isset($_GET['token'])) {
    $estado = verificacao_confirmar_token((string)$_GET['token']) ? 'confirmado' : 'invalido';
} elseif ($_SERVER['REQUEST_METHOD'] === 'POST') {
    conferir_csrf();
    try { verificacao_reenviar($_POST['email'] ?? ''); } catch (Throwable $e) { /* resposta genérica */ }
    $estado = 'reenviado';
} elseif (isset($_GET['enviado'])) {
    $estado = 'enviado';
}

$nomeSistema = global_ler('nome_sistema', 'Núcleo de Obras');
pagina_inicio('Verificar e-mail');
?>
<main style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f3f5f8;padding:24px;font-family:Arial,Helvetica,sans-serif;">
  <section style="width:100%;max-width:520px;background:#fff;border:1px solid #dfe5ed;border-radius:16px;overflow:hidden;box-shadow:0 18px 48px rgba(20,33,61,.1);">
    <header style="background:#14213d;color:#fff;padding:24px 30px;border-bottom:4px solid #e07a18;font-size:18px;font-weight:bold;"><?= h($nomeSistema) ?></header>
    <div style="padding:30px;color:#14213d;">
      <?php if ($estado === 'confirmado'): ?>
        <h1 style="font-size:26px;margin:0 0 12px;">E-mail confirmado!</h1>
        <p style="color:#526176;line-height:1.6;">Seu endereço foi verificado. Agora você pode entrar com o login e a senha criados no cadastro.</p>
        <p><a href="login.php" style="display:inline-block;background:#e07a18;color:#fff;padding:13px 20px;border-radius:8px;text-decoration:none;font-weight:bold;">Entrar no sistema</a></p>
      <?php else: ?>
        <h1 style="font-size:26px;margin:0 0 12px;">Confirme seu e-mail</h1>
        <?php if ($estado === 'invalido'): ?>
          <p style="color:#526176;line-height:1.6;">Este link é inválido ou expirou. Solicite um novo abaixo.</p>
        <?php elseif ($estado === 'reenviado'): ?>
          <p style="color:#526176;line-height:1.6;">Se há uma conta pendente para esse endereço, enviaremos um novo link. Aguarde alguns minutos e confira também a pasta de spam.</p>
        <?php else: ?>
          <p style="color:#526176;line-height:1.6;">Enviamos uma mensagem de boas-vindas com o link de confirmação para o e-mail informado no cadastro. Confira também a pasta de spam.</p>
        <?php endif; ?>
        <form method="post" style="margin-top:24px;">
          <input type="hidden" name="csrf" value="<?= h(token_csrf()) ?>">
          <label for="email-confirmacao" style="display:block;font-weight:bold;margin-bottom:8px;">Não recebeu? Reenvie o link</label>
          <input id="email-confirmacao" name="email" type="email" autocomplete="email" required placeholder="Seu e-mail de cadastro" style="box-sizing:border-box;width:100%;padding:13px;border:1px solid #cad3df;border-radius:8px;font-size:15px;">
          <button type="submit" style="margin-top:14px;background:#e07a18;color:#fff;border:0;border-radius:8px;padding:13px 20px;font-size:15px;font-weight:bold;cursor:pointer;">Reenviar confirmação</button>
        </form>
        <p style="margin:24px 0 0;"><a href="login.php" style="color:#14213d;">Voltar ao login</a></p>
      <?php endif; ?>
    </div>
  </section>
</main>
</body></html>
