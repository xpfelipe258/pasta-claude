<?php
// Download/visualização dos documentos anexados à ficha do colaborador. Só sai para quem administra a empresa dona do colaborador (ou o administrador do sistema).
require __DIR__ . '/inc/nucleo.php';
require __DIR__ . '/inc/modelo.php';
require __DIR__ . '/inc/central.php';

$eu = central_exigir();
$d = rhp_documento_obter((int)($_GET['id'] ?? 0), $eu);
$p = $d ? rhp_pasta_docs() . '/' . basename((string)$d['arquivo']) : '';
if (!$d || !is_file($p)) { http_response_code(404); exit('Documento não encontrado.'); }
$ext = strtolower(pathinfo((string)$d['arquivo_nome'], PATHINFO_EXTENSION));
$inline = ['pdf' => 'application/pdf', 'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'png' => 'image/png', 'webp' => 'image/webp'];
$nome = preg_replace('/[^\p{L}\p{N}._\- ()]/u', '_', (string)$d['arquivo_nome']);
session_write_close();
header('X-Content-Type-Options: nosniff');
if (isset($inline[$ext]) && ($_GET['baixar'] ?? '') !== '1') {
    header('Content-Type: ' . $inline[$ext]);
    header('Content-Disposition: inline; filename="' . $nome . '"');
} else {
    header('Content-Type: application/octet-stream');
    header('Content-Disposition: attachment; filename="' . $nome . '"');
}
header('Content-Length: ' . filesize($p));
header('Cache-Control: private, no-store');
readfile($p);
