<?php
// Documentos dos equipamentos (ART, laudos, plano de manutenção, plano de rigging...): envio, exibição e exclusão.
// Os arquivos ficam em dados_obras/{obra}/equipamentos (fora do alcance público, nome aleatório) e só saem daqui, para quem está logado,
// tem acesso à obra e à área Consumo (onde mora o cadastro de equipamentos). Quem é somente leitura vê e baixa, mas não envia nem exclui.
require __DIR__ . '/inc/nucleo.php';

function ed_resp($cod, array $d)
{
    http_response_code($cod);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($d, JSON_UNESCAPED_UNICODE);
    exit;
}

if (!config()) {
    ed_resp(503, ['erro' => 'Sistema não instalado.']);
}
$u = usuario_atual();
if (!$u) {
    ed_resp(401, ['erro' => 'Faça login novamente.']);
}
$obraId = obra_atual_id();
$obra = $obraId ? q_global("SELECT id FROM obras WHERE id = ? AND status = 'ativa'", [$obraId])->fetch() : null;
if (!$obra || !usuario_pode_obra($u, $obraId)) {
    ed_resp(409, ['erro' => 'Selecione uma obra na Central de Obras.']);
}
definir_obra_atual($obraId);
if (!usuario_pode_modulo($u, 'consumo')) {
    ed_resp(403, ['erro' => 'Seu usuário não possui acesso à área Consumo (equipamentos).']);
}
$acao = $_GET['acao'] ?? '';
$dir = equip_docs_dir($obraId);
$EXT = ['pdf', 'jpg', 'jpeg', 'png', 'doc', 'docx', 'xls', 'xlsx', 'zip', 'dwg', 'dxf', 'txt'];
$MIME_INLINE = ['pdf' => 'application/pdf', 'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'png' => 'image/png'];

if ($acao === 'ver') {
    $d = q('SELECT arquivo, nome FROM equipamento_docs WHERE id = ?', [(int)($_GET['id'] ?? 0)])->fetch();
    $p = $d ? $dir . '/' . basename((string)$d['arquivo']) : '';
    if (!$d || !is_file($p)) {
        http_response_code(404);
        exit('Documento não encontrado.');
    }
    $ext = strtolower(pathinfo((string)$d['nome'], PATHINFO_EXTENSION));
    $nome = preg_replace('/[^\p{L}\p{N}._\- ()]/u', '_', (string)$d['nome']);
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
    ed_resp(405, ['erro' => 'Método não permitido.']);
}
conferir_csrf();
if (usuario_so_leitura($u, 'consumo')) {
    ed_resp(403, ['erro' => 'Seu usuário é somente leitura.']);
}
$agora = (new DateTimeImmutable('now', new DateTimeZone('America/Sao_Paulo')))->format('Y-m-d H:i:s');

if ($acao === 'enviar') {
    $equip = (int)($_GET['equip'] ?? 0);
    if (!$equip || !q('SELECT id FROM equipamentos WHERE id = ?', [$equip])->fetch()) {
        ed_resp(404, ['erro' => 'Equipamento não encontrado. Salve o equipamento antes de anexar documentos.']);
    }
    $tipo = mb_substr(trim((string)($_GET['tipo'] ?? '')), 0, 60);
    if ($tipo === '') {
        ed_resp(400, ['erro' => 'Escolha o tipo do documento (ART, laudo, plano de manutenção, plano de rigging…).']);
    }
    $validade = trim((string)($_GET['validade'] ?? ''));
    if ($validade !== '' && !data_valida($validade)) {
        ed_resp(400, ['erro' => 'Validade inválida.']);
    }
    $nomeOrig = mb_substr(preg_replace('/[^\p{L}\p{N}._\- ()]/u', '_', basename((string)($_GET['nome'] ?? 'documento'))), 0, 190);
    $ext = strtolower(pathinfo($nomeOrig, PATHINFO_EXTENSION));
    if (!in_array($ext, $EXT, true)) {
        ed_resp(400, ['erro' => 'Tipo de arquivo não permitido. Use PDF, imagem (JPG/PNG), Word, Excel, ZIP, DWG/DXF ou texto.']);
    }
    $bin = (string)file_get_contents('php://input');
    if ($bin === '' || strlen($bin) > 15 * 1048576) {
        ed_resp(400, ['erro' => 'Arquivo vazio ou maior que 15 MB.']);
    }
    $cab = substr($bin, 0, 8);   // o conteúdo precisa combinar com a extensão (não basta renomear)
    $ok = true;
    if ($ext === 'pdf') { $ok = strncmp($cab, '%PDF', 4) === 0; }
    elseif (in_array($ext, ['jpg', 'jpeg', 'png'], true)) { $ok = (bool)@getimagesizefromstring($bin); }
    elseif (in_array($ext, ['docx', 'xlsx', 'zip'], true)) { $ok = strncmp($cab, "PK\x03\x04", 4) === 0; }
    elseif (in_array($ext, ['doc', 'xls'], true)) { $ok = strncmp($cab, "\xD0\xCF\x11\xE0", 4) === 0; }
    elseif ($ext === 'txt') { $ok = strpos(substr($bin, 0, 4096), "\0") === false; }
    if (!$ok) {
        ed_resp(400, ['erro' => 'O conteúdo do arquivo não corresponde ao formato .' . $ext . '.']);
    }
    if (!is_dir($dir)) {
        @mkdir($dir, 0755, true);
    }
    $arq = bin2hex(random_bytes(12)) . '.dat';
    if (file_put_contents($dir . '/' . $arq, $bin) === false) {
        ed_resp(500, ['erro' => 'Não consegui gravar o arquivo no servidor.']);
    }
    $desc = mb_substr(trim((string)($_GET['descricao'] ?? '')), 0, 200);
    q('INSERT INTO equipamento_docs (equip_id, tipo, descricao, validade, arquivo, nome, tam, por, em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [$equip, $tipo, $desc !== '' ? $desc : null, $validade !== '' ? $validade : null, $arq, $nomeOrig, strlen($bin), (string)$u['nome'], $agora]);
    $id = (int)bd()->lastInsertId();
    sistema_gravar('versao', (string)((int)sistema_ler('versao', '0') + 1));
    ed_resp(200, ['ok' => true, 'id' => $id]);
}

if ($acao === 'excluir') {
    $id = (int)($_GET['id'] ?? 0);
    $d = q('SELECT arquivo FROM equipamento_docs WHERE id = ?', [$id])->fetch();
    if (!$d) {
        ed_resp(404, ['erro' => 'Documento não encontrado.']);
    }
    q('DELETE FROM equipamento_docs WHERE id = ?', [$id]);
    @unlink($dir . '/' . basename((string)$d['arquivo']));
    sistema_gravar('versao', (string)((int)sistema_ler('versao', '0') + 1));
    ed_resp(200, ['ok' => true]);
}
ed_resp(400, ['erro' => 'Ação desconhecida.']);
