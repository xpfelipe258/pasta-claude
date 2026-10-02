<?php
// Script de migração única: copia config.php de sistema_php → maciel
// DELETE este arquivo após usar.

$origem = dirname(__DIR__) . '/sistema_php/inc/config.php';
$destino = __DIR__ . '/inc/config.php';

if (file_exists($destino)) {
    echo '<p style="color:green;font-family:sans-serif">✔ config.php já existe em maciel/inc/. O sistema está instalado.</p>';
    echo '<p><a href="login.php">Ir para o login</a></p>';
    exit;
}

if (!file_exists($origem)) {
    echo '<p style="color:red;font-family:sans-serif">✘ Não encontrei ' . htmlspecialchars($origem) . '.<br>';
    echo 'A pasta sistema_php não existe mais no servidor. Use o <a href="instalar.php">instalador</a>.</p>';
    exit;
}

if (copy($origem, $destino)) {
    @chmod($destino, 0640);
    echo '<p style="color:green;font-family:sans-serif">✔ config.php copiado com sucesso! <a href="login.php">Entrar no sistema</a></p>';
    echo '<p style="font-family:sans-serif;color:#555">Apague este arquivo (<code>migrar_config.php</code>) pelo gerenciador de arquivos da hospedagem.</p>';
} else {
    echo '<p style="color:red;font-family:sans-serif">✘ Falha ao copiar. Verifique permissões da pasta inc/.</p>';
}
