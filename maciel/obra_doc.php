<?php
// Projetos em PDF da obra aberta (pranchas guardadas na importação): abre o PDF no navegador para consulta ao lado do mapa de apontamento.
// Só sai daqui para quem está logado e tem acesso à obra; o arquivo fica em dados_obras/{obra} (fora do alcance público).
require __DIR__ . '/inc/nucleo.php';
require __DIR__ . '/inc/importacao.php';

if (!config()) {
    http_response_code(503);
    exit('Sistema não instalado.');
}
$u = usuario_atual();
if (!$u) {
    http_response_code(401);
    exit('Faça login novamente.');
}
$obraId = obra_atual_id();
$obra = $obraId ? q_global("SELECT id FROM obras WHERE id = ? AND status = 'ativa'", [$obraId])->fetch() : null;
if (!$obra || !usuario_pode_obra($u, $obraId)) {
    http_response_code(409);
    exit('Selecione uma obra na Central de Obras.');
}
garantir_importacao();
$d = q_global("SELECT * FROM obra_documentos WHERE id = ? AND obra_id = ? AND tipo = 'projetos' AND status = 'valido'", [(int)($_GET['id'] ?? 0), $obraId])->fetch();
$p = $d ? importacao_diretorio($obraId) . '/' . basename((string)$d['arquivo']) : '';
if (!$d || !is_file($p) || importacao_extensao($d['nome_original']) !== 'pdf') {
    http_response_code(404);
    exit('Projeto não encontrado.');
}
session_write_close();
header('Content-Type: application/pdf');
header('Content-Length: ' . filesize($p));
header('Content-Disposition: inline; filename="' . rawurlencode(basename((string)$d['nome_original'])) . '"');
header('Cache-Control: private, max-age=3600');
readfile($p);
