<?php
// Fotos das não conformidades (área Qualidade): envio, exibição, legenda e exclusão. Os arquivos ficam em dados_obras/{obra}/qualidade (fora do alcance
// público) e só saem daqui, para quem está logado, tem acesso à obra e (se for usuário de empresa) à empresa da não conformidade.
require __DIR__ . '/inc/nucleo.php';
require __DIR__ . '/inc/importacao.php';

function nc_resp($cod, array $d)
{
    http_response_code($cod);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($d, JSON_UNESCAPED_UNICODE);
    exit;
}

if (!config()) {
    nc_resp(503, ['erro' => 'Sistema não instalado.']);
}
$u = usuario_atual();
if (!$u) {
    nc_resp(401, ['erro' => 'Faça login novamente.']);
}
$obraId = obra_atual_id();
$obra = $obraId ? q_global("SELECT id FROM obras WHERE id = ? AND status = 'ativa'", [$obraId])->fetch() : null;
if (!$obra || !usuario_pode_obra($u, $obraId)) {
    nc_resp(409, ['erro' => 'Selecione uma obra na Central de Obras.']);
}
definir_obra_atual($obraId);
obra_override(qualidade_obra_id());   // as não conformidades (e as fotos) moram na obra principal, mesmo para o usuário da obra própria de uma empresa
$obraQ = obra_atual_id();
$acao = $_GET['acao'] ?? '';
$dir = importacao_diretorio($obraQ) . '/qualidade';
$minhaEmp = trim((string)($u['empresa'] ?? ''));
$admin = ($u['perfil'] ?? '') === 'admin';

// A não conformidade precisa existir e, para usuário de empresa, ser da empresa dele.
function nc_da_foto($ncId, $minhaEmp)
{
    $nc = q('SELECT id, empresa, situacao FROM nao_conformidades WHERE id = ?', [(int)$ncId])->fetch();
    if (!$nc || ($minhaEmp !== '' && $nc['empresa'] !== $minhaEmp)) {
        nc_resp(404, ['erro' => 'Não conformidade não encontrada.']);
    }
    return $nc;
}

// Foto "antes" (registro da gestão): só a gestão e enquanto a NC não estiver concluída. Foto "depois" (correção): a empresa (ou o administrador)
// e só enquanto a NC aguarda a resposta. Vale para enviar, legendar e excluir.
function nc_pode_foto(array $nc, $tipo, $minhaEmp, $admin)
{
    if ($tipo === 'depois') {
        return ($minhaEmp !== '' || $admin) && $nc['situacao'] === 'aberta';
    }
    return $minhaEmp === '' && $nc['situacao'] !== 'concluida';
}

if ($acao === 'ver') {
    $f = q('SELECT arquivo, nc_id FROM nc_fotos WHERE id = ?', [(int)($_GET['id'] ?? 0)])->fetch();
    if ($f) {
        nc_da_foto($f['nc_id'], $minhaEmp);
    }
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
    nc_resp(405, ['erro' => 'Método não permitido.']);
}
conferir_csrf();
if (($u['perfil'] ?? '') === 'leitura' || !usuario_pode_modulo($u, 'qualidade')) {
    nc_resp(403, ['erro' => 'Seu usuário não pode alterar as não conformidades.']);
}
$agora = (new DateTimeImmutable('now', new DateTimeZone('America/Sao_Paulo')))->format('Y-m-d H:i:s');

if ($acao === 'enviar') {
    $nc = nc_da_foto($_GET['nc'] ?? 0, $minhaEmp);
    $tipo = ($_GET['tipo'] ?? 'antes') === 'depois' ? 'depois' : 'antes';
    if (!nc_pode_foto($nc, $tipo, $minhaEmp, $admin)) {
        nc_resp(403, ['erro' => $tipo === 'depois' ? 'A foto da correção só pode ser anexada enquanto a não conformidade aguarda a resposta da empresa.' : 'As fotos do registro só são anexadas pela gestão, antes de a não conformidade ser concluída.']);
    }
    $bin = (string)file_get_contents('php://input');
    if ($bin === '' || strlen($bin) > 15 * 1048576) {
        nc_resp(400, ['erro' => 'Foto vazia ou maior que 15 MB.']);
    }
    $info = @getimagesizefromstring($bin);
    if (!$info || !in_array($info[2], [IMAGETYPE_JPEG, IMAGETYPE_PNG, IMAGETYPE_WEBP, IMAGETYPE_GIF], true)) {
        nc_resp(400, ['erro' => 'O arquivo não é uma imagem (JPEG, PNG, WebP ou GIF).']);
    }
    if (function_exists('imagecreatefromstring') && ($im = @imagecreatefromstring($bin))) {   // grava sempre JPEG, no máximo 1800 px
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
        nc_resp(400, ['erro' => 'Envie a foto em JPEG (o servidor não consegue converter outros formatos).']);
    }
    if (!is_dir($dir)) {
        @mkdir($dir, 0755, true);
    }
    $arq = bin2hex(random_bytes(10)) . '.jpg';
    if (file_put_contents($dir . '/' . $arq, $bin) === false) {
        nc_resp(500, ['erro' => 'Não consegui gravar a foto no servidor.']);
    }
    $ordem = (float)q('SELECT COALESCE(MAX(ordem), 0) FROM nc_fotos WHERE nc_id = ?', [(int)$nc['id']])->fetchColumn() + 1;
    $nome = mb_substr(preg_replace('/[^\p{L}\p{N}._\- ]/u', '', (string)($_GET['nome'] ?? 'foto')), 0, 120);
    q('INSERT INTO nc_fotos (nc_id, tipo, arquivo, nome, legenda, ordem, por, em) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [(int)$nc['id'], $tipo, $arq, $nome, null, $ordem, (string)$u['nome'], $agora]);
    $id = (int)bd()->lastInsertId();
    qualidade_versao_subir();
    nc_resp(200, ['ok' => true, 'id' => $id]);
}

if ($acao === 'legenda') {
    $id = (int)($_GET['id'] ?? 0);
    $f = q('SELECT nc_id, tipo FROM nc_fotos WHERE id = ?', [$id])->fetch();
    if (!$f) {
        nc_resp(404, ['erro' => 'Foto não encontrada.']);
    }
    $nc = nc_da_foto($f['nc_id'], $minhaEmp);
    if (!nc_pode_foto($nc, $f['tipo'] === 'depois' ? 'depois' : 'antes', $minhaEmp, $admin)) {
        nc_resp(403, ['erro' => 'Esta foto não pode mais ser alterada.']);
    }
    $corpo = json_decode((string)file_get_contents('php://input'), true);
    $leg = mb_substr(trim((string)($corpo['legenda'] ?? '')), 0, 1000);
    q('UPDATE nc_fotos SET legenda = ? WHERE id = ?', [$leg !== '' ? $leg : null, $id]);
    qualidade_versao_subir();
    nc_resp(200, ['ok' => true]);
}

if ($acao === 'excluir') {
    $id = (int)($_GET['id'] ?? 0);
    $f = q('SELECT arquivo, nc_id, tipo FROM nc_fotos WHERE id = ?', [$id])->fetch();
    if (!$f) {
        nc_resp(404, ['erro' => 'Foto não encontrada.']);
    }
    $nc = nc_da_foto($f['nc_id'], $minhaEmp);
    if (!nc_pode_foto($nc, $f['tipo'] === 'depois' ? 'depois' : 'antes', $minhaEmp, $admin)) {
        nc_resp(403, ['erro' => 'Esta foto não pode mais ser excluída.']);
    }
    q('DELETE FROM nc_fotos WHERE id = ?', [$id]);
    @unlink($dir . '/' . basename((string)$f['arquivo']));
    qualidade_versao_subir();
    nc_resp(200, ['ok' => true]);
}
nc_resp(400, ['erro' => 'Ação desconhecida.']);
