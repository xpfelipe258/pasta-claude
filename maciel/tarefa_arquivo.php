<?php
// Arquivos da conversa da aba Tarefas (mural da equipe e conversa de cada tarefa): envio, download e exclusão. Os arquivos ficam em dados_obras/_tarefas
// (fora do Git e fechado ao público) e só saem daqui, para quem está logado e participa da conversa.
require __DIR__ . '/inc/nucleo.php';

function tf_resp($cod, array $d)
{
    http_response_code($cod);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($d, JSON_UNESCAPED_UNICODE);
    exit;
}

if (!config()) {
    tf_resp(503, ['erro' => 'Sistema não instalado.']);
}
$u = usuario_atual();
if (!$u) {
    tf_resp(401, ['erro' => 'Faça login novamente.']);
}
garantir_tarefas();
$acao = $_GET['acao'] ?? '';
$dir = tarefas_arquivos_dir();
$EXT = ['pdf', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'doc', 'docx', 'xls', 'xlsx', 'xlsm', 'csv', 'ppt', 'pptx', 'txt', 'zip', 'rar', '7z', 'dwg', 'dxf', 'ifc', 'xml', 'rtf', 'odt', 'ods', 'msg', 'eml', 'mp4', 'mov', 'mp3', 'm4a', 'ogg', 'opus', 'wav'];
$MIME_INLINE = ['pdf' => 'application/pdf', 'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'png' => 'image/png', 'gif' => 'image/gif', 'webp' => 'image/webp'];

if ($acao === 'ver') {
    $m = q_global('SELECT * FROM tarefas_msgs WHERE id = ? AND arquivo IS NOT NULL', [(int)($_GET['id'] ?? 0)])->fetch();
    $p = $m ? $dir . '/' . basename((string)$m['arquivo']) : '';
    if (!$m || !is_file($p) || !tarefa_conversa_acesso($u, (int)$m['tarefa_id'])) {
        http_response_code(404);
        exit('Arquivo não encontrado.');
    }
    $ext = strtolower(pathinfo((string)$m['arquivo_nome'], PATHINFO_EXTENSION));
    $nome = preg_replace('/[^\p{L}\p{N}._\- ()]/u', '_', (string)$m['arquivo_nome']);
    session_write_close();
    header('X-Content-Type-Options: nosniff');
    if (isset($MIME_INLINE[$ext]) && ($_GET['baixar'] ?? '') !== '1') {
        header('Content-Type: ' . $MIME_INLINE[$ext]);
        header('Content-Disposition: inline; filename="' . $nome . '"');
    } else {
        header('Content-Type: application/octet-stream');
        header('Content-Disposition: attachment; filename="' . $nome . '"');
    }
    header('Content-Length: ' . filesize($p));
    header('Cache-Control: private, max-age=3600');
    readfile($p);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    tf_resp(405, ['erro' => 'Método não permitido.']);
}
conferir_csrf();

if ($acao === 'enviar') {
    $tarefa = (int)($_GET['tarefa'] ?? 0);
    if (!tarefa_conversa_acesso($u, $tarefa)) {
        tf_resp(403, ['erro' => 'Você não participa desta tarefa.']);
    }
    $nomeOrig = mb_substr(preg_replace('/[^\p{L}\p{N}._\- ()]/u', '_', basename((string)($_GET['nome'] ?? 'arquivo'))), 0, 190);
    $ext = strtolower(pathinfo($nomeOrig, PATHINFO_EXTENSION));
    if (!in_array($ext, $EXT, true)) {
        tf_resp(400, ['erro' => 'Tipo de arquivo não permitido (use PDF, imagem, Word, Excel, PowerPoint, texto, ZIP, DWG, IFC, áudio ou vídeo curto).']);
    }
    $bin = (string)file_get_contents('php://input');
    if ($bin === '' || strlen($bin) > 10 * 1048576) {
        tf_resp(400, ['erro' => 'Arquivo vazio ou maior que 10 MB.']);
    }
    if (in_array($ext, ['jpg', 'jpeg', 'png', 'gif', 'webp'], true) && !@getimagesizefromstring($bin)) {
        tf_resp(400, ['erro' => 'O arquivo não é uma imagem válida.']);
    }
    $arq = bin2hex(random_bytes(12)) . '.dat';
    if (file_put_contents($dir . '/' . $arq, $bin) === false) {
        tf_resp(500, ['erro' => 'Não consegui gravar o arquivo no servidor.']);
    }
    $texto = trim((string)($_GET['texto'] ?? ''));
    $agora = (new DateTimeImmutable('now', new DateTimeZone('America/Sao_Paulo')))->format('Y-m-d H:i:s');
    q_global('INSERT INTO tarefas_msgs (tarefa_id, usuario_id, autor, texto, arquivo, arquivo_nome, arquivo_tipo, arquivo_tam, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [$tarefa, (int)$u['id'], mb_substr((string)$u['nome'], 0, 100), $texto !== '' ? mb_substr($texto, 0, 1000) : null, $arq, $nomeOrig, $ext, strlen($bin), $agora]);
    tf_resp(200, ['ok' => true, 'id' => (int)bd()->lastInsertId()]);
}
tf_resp(400, ['erro' => 'Ação desconhecida.']);
