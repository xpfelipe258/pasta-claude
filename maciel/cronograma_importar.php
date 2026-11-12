<?php
// Aba Cronograma (Gantt) › Importar cronograma: recebe o arquivo (PDF, planilha ou XML do MS Project), lê as atividades e devolve a lista.
// Nada é gravado aqui e o arquivo não fica guardado: a tela mostra a conciliação e só então salva pela rota "cronograma-importado" da API.
require __DIR__ . '/inc/nucleo.php';
require_once __DIR__ . '/inc/cronograma_leitura.php';

function ci_resp($cod, array $d)
{
    http_response_code($cod);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($d, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}

if (!config()) {
    ci_resp(503, ['erro' => 'Sistema não instalado.']);
}
$u = usuario_atual();
if (!$u) {
    ci_resp(401, ['erro' => 'Faça login novamente.']);
}
$obraId = obra_atual_id();
$obra = $obraId ? q_global("SELECT id FROM obras WHERE id = ? AND status = 'ativa'", [$obraId])->fetch() : null;
if (!$obra || !usuario_pode_obra($u, $obraId)) {
    ci_resp(409, ['erro' => 'Selecione uma obra na Central de Obras.']);
}
definir_obra_atual($obraId);
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    ci_resp(405, ['erro' => 'Método não permitido.']);
}
conferir_csrf();
if (!usuario_pode_modulo($u, 'producao')) {
    ci_resp(403, ['erro' => 'Seu usuário não possui acesso à área Produção.']);
}
if (usuario_so_leitura($u, 'producao')) {
    ci_resp(403, ['erro' => 'Seu usuário é somente leitura.']);
}
if (usuario_empresa_restrita($u) !== '') {
    ci_resp(403, ['erro' => 'O cronograma da obra é importado pela gestão da obra.']);
}

$nome = mb_substr(preg_replace('/[^\p{L}\p{N}._\- ()]/u', '_', basename((string)($_GET['nome'] ?? 'cronograma'))), 0, 190);
$ext = strtolower(pathinfo($nome, PATHINFO_EXTENSION));
if ($ext === 'mpp') {
    ci_resp(400, ['erro' => 'O arquivo .mpp do MS Project é um formato fechado e não pode ser lido direto. No MS Project use Arquivo › Salvar como › "Formato XML (*.xml)" e envie o .xml (ou exporte para Excel/PDF).']);
}
if ($ext === 'xls') {
    ci_resp(400, ['erro' => 'Planilha no formato antigo (.xls). Abra no Excel e salve como .xlsx.']);
}
if (!in_array($ext, ['pdf', 'xlsx', 'xlsm', 'xml', 'csv', 'txt'], true)) {
    ci_resp(400, ['erro' => 'Formato não aceito. Envie PDF, planilha (.xlsx, .xlsm, .csv) ou XML do MS Project.']);
}
$bin = (string)file_get_contents('php://input');
if ($bin === '' || strlen($bin) > 30 * 1048576) {
    ci_resp(400, ['erro' => 'Arquivo vazio ou maior que 30 MB.']);
}
$cab = substr($bin, 0, 8);
$ok = true;
if ($ext === 'pdf') { $ok = strncmp($cab, '%PDF', 4) === 0; }
elseif ($ext === 'xlsx' || $ext === 'xlsm') { $ok = strncmp($cab, "PK\x03\x04", 4) === 0; }
elseif ($ext === 'xml') { $ok = strpos(substr($bin, 0, 2000), '<') !== false && stripos(substr($bin, 0, 4000), '<!DOCTYPE') === false; }
else { $ok = strpos(substr($bin, 0, 4096), "\0") === false || strncmp($cab, "\xFF\xFE", 2) === 0; }
if (!$ok) {
    ci_resp(400, ['erro' => 'O conteúdo do arquivo não corresponde ao formato .' . $ext . '.']);
}

@set_time_limit(180);
@ini_set('memory_limit', '512M');
session_write_close();
$tmp = tempnam(sys_get_temp_dir(), 'cron');
try {
    if ($tmp === false || file_put_contents($tmp, $bin) === false) {
        ci_resp(500, ['erro' => 'Não consegui gravar o arquivo temporário no servidor.']);
    }
    unset($bin);
    $r = cronograma_ler_arquivo($tmp, $nome);
} catch (Throwable $e) {
    @unlink($tmp);
    ci_resp(400, ['erro' => $e instanceof RuntimeException ? $e->getMessage() : 'Não consegui ler o arquivo: ' . $e->getMessage()]);
}
@unlink($tmp);
if (!$r['atividades']) {
    ci_resp(422, ['erro' => implode(' ', $r['avisos']) ?: 'Não encontrei atividades com início e término no arquivo.']);
}
$r['arquivo'] = $nome;
ci_resp(200, $r);
