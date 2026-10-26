<?php
// Fotos do Relatório Diário de Obra (RDO): envio, exibição e exclusão. Os arquivos ficam em dados_obras/{obra}/rdo (fora do alcance público)
// e só saem daqui, para quem está logado e tem acesso à obra. A legenda é gravada pela rota `registro` (tabela rdo_fotos).
require __DIR__ . '/inc/nucleo.php';
require __DIR__ . '/inc/importacao.php';

function rdo_resp($cod, array $d)
{
    http_response_code($cod);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($d, JSON_UNESCAPED_UNICODE);
    exit;
}

if (!config()) {
    rdo_resp(503, ['erro' => 'Sistema não instalado.']);
}
$u = usuario_atual();
if (!$u) {
    rdo_resp(401, ['erro' => 'Faça login novamente.']);
}
$obraId = obra_atual_id();
$obra = $obraId ? q_global("SELECT id FROM obras WHERE id = ? AND status = 'ativa'", [$obraId])->fetch() : null;
if (!$obra || !usuario_pode_obra($u, $obraId)) {
    rdo_resp(409, ['erro' => 'Selecione uma obra na Central de Obras.']);
}
definir_obra_atual($obraId);
$acao = $_GET['acao'] ?? '';
$dir = importacao_diretorio($obraId) . '/rdo';

if ($acao === 'ver') {
    $f = q('SELECT arquivo FROM rdo_fotos WHERE id = ?', [(int)($_GET['id'] ?? 0)])->fetch();
    $p = $f ? $dir . '/' . basename((string)$f['arquivo']) : '';
    if (!$f || !is_file($p)) {
        http_response_code(404);
        exit('Foto não encontrada.');
    }
    session_write_close();
    header('Content-Type: image/jpeg');
    header('Content-Length: ' . filesize($p));
    header('Cache-Control: private, max-age=86400');
    readfile($p);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    rdo_resp(405, ['erro' => 'Método não permitido.']);
}
conferir_csrf();
if (($u['perfil'] ?? '') === 'leitura' || !usuario_pode_modulo($u, 'producao')) {
    rdo_resp(403, ['erro' => 'Seu usuário não pode alterar o relatório diário.']);
}
$agora = (new DateTimeImmutable('now', new DateTimeZone('America/Sao_Paulo')))->format('Y-m-d H:i:s');

if ($acao === 'enviar') {
    $data = (string)($_GET['data'] ?? '');
    if (!data_valida($data)) {
        rdo_resp(400, ['erro' => 'Data inválida.']);
    }
    if ($vRdo = rdo_dia_validacao($data)) {
        rdo_resp(403, ['erro' => rdo_mensagem_travado($data, $vRdo)]);
    }
    $bin = (string)file_get_contents('php://input');
    if ($bin === '' || strlen($bin) > 15 * 1048576) {
        rdo_resp(400, ['erro' => 'Foto vazia ou maior que 15 MB.']);
    }
    $info = @getimagesizefromstring($bin);
    if (!$info || !in_array($info[2], [IMAGETYPE_JPEG, IMAGETYPE_PNG, IMAGETYPE_WEBP, IMAGETYPE_GIF], true)) {
        rdo_resp(400, ['erro' => 'O arquivo não é uma imagem (JPEG, PNG, WebP ou GIF).']);
    }
    if (function_exists('imagecreatefromstring') && ($im = @imagecreatefromstring($bin))) {   // grava sempre JPEG, no máximo 1800 px (a tela já reduz; isto garante)
        $w = imagesx($im);
        $h = imagesy($im);
        $k = min(1, 1800 / max($w, $h));
        if ($k < 1) {
            $novo = imagescale($im, (int)round($w * $k), (int)round($h * $k));
            if ($novo) {
                imagedestroy($im);
                $im = $novo;
            }
        }
        ob_start();
        imagejpeg($im, null, 85);
        $bin = (string)ob_get_clean();
        imagedestroy($im);
    } elseif ($info[2] !== IMAGETYPE_JPEG) {
        rdo_resp(400, ['erro' => 'Envie a foto em JPEG (o servidor não consegue converter outros formatos).']);
    }
    if (!is_dir($dir)) {
        @mkdir($dir, 0755, true);
    }
    $arq = bin2hex(random_bytes(10)) . '.jpg';
    if (file_put_contents($dir . '/' . $arq, $bin) === false) {
        rdo_resp(500, ['erro' => 'Não consegui gravar a foto no servidor.']);
    }
    $ordem = (float)q('SELECT COALESCE(MAX(ordem), 0) FROM rdo_fotos WHERE data = ?', [$data])->fetchColumn() + 1;
    $nome = mb_substr(preg_replace('/[^\p{L}\p{N}._\- ]/u', '', (string)($_GET['nome'] ?? 'foto')), 0, 120);
    q('INSERT INTO rdo_fotos (data, arquivo, nome, legenda, ordem, por, em) VALUES (?, ?, ?, ?, ?, ?, ?)', [$data, $arq, $nome, null, $ordem, (string)$u['nome'], $agora]);
    $id = (int)bd()->lastInsertId();
    sistema_gravar('versao', (string)((int)sistema_ler('versao', '0') + 1));
    rdo_resp(200, ['ok' => true, 'id' => $id]);
}

if ($acao === 'excluir') {
    $id = (int)($_GET['id'] ?? 0);
    $f = q('SELECT arquivo, data FROM rdo_fotos WHERE id = ?', [$id])->fetch();
    if (!$f) {
        rdo_resp(404, ['erro' => 'Foto não encontrada.']);
    }
    if ($vRdo = rdo_dia_validacao((string)$f['data'])) {
        rdo_resp(403, ['erro' => rdo_mensagem_travado((string)$f['data'], $vRdo)]);
    }
    q('DELETE FROM rdo_fotos WHERE id = ?', [$id]);
    @unlink($dir . '/' . basename((string)$f['arquivo']));
    sistema_gravar('versao', (string)((int)sistema_ler('versao', '0') + 1));
    rdo_resp(200, ['ok' => true]);
}
rdo_resp(400, ['erro' => 'Ação desconhecida.']);
