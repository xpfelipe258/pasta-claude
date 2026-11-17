<?php
require __DIR__ . '/inc/nucleo.php';

function rdo_redmine_responder(int $status, array $dados): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($dados, JSON_UNESCAPED_UNICODE);
    exit;
}

function rdo_redmine_requisicao(string $url, string $chave, string $tipo = 'application/json', ?string $corpo = null): array
{
    $curl = curl_init($url);
    curl_setopt_array($curl, [
        CURLOPT_HTTPHEADER => ['X-Redmine-API-Key: ' . $chave, 'Content-Type: ' . $tipo],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_TIMEOUT => 15,
    ]);
    if ($corpo !== null) {
        curl_setopt_array($curl, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => $corpo]);
    }
    $resposta = curl_exec($curl);
    $status = (int)curl_getinfo($curl, CURLINFO_HTTP_CODE);
    curl_close($curl);
    return [$status, json_decode((string)$resposta, true)];
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    rdo_redmine_responder(405, ['erro' => 'Método não permitido.']);
}
$usuario = usuario_atual();
if (!$usuario) {
    rdo_redmine_responder(401, ['erro' => 'Faça login novamente.']);
}
conferir_csrf();
$obra = obra_atual_id();
if (!$obra || !usuario_pode_obra($usuario, $obra) || !usuario_admin_da_obra($usuario)
    || !usuario_pode_modulo($usuario, 'producao') || ($usuario['perfil'] ?? '') === 'leitura') {
    rdo_redmine_responder(403, ['erro' => 'Envio disponível para o administrador da obra.']);
}
$raizPublica = realpath((string)($_SERVER['DOCUMENT_ROOT'] ?? ''));
$configPrivada = $raizPublica ? dirname($raizPublica) . '/rdo_redmine.private.ini' : null;
$privada = $configPrivada && is_readable($configPrivada)
    ? parse_ini_file($configPrivada, false, INI_SCANNER_RAW)
    : [];
$opcao = static function (string $nome) use ($privada): string {
    return trim((string)($privada[$nome] ?? getenv($nome)));
};
$chave = $opcao('RDO_REDMINE_API_KEY');
$usuarioPermitido = (int)$opcao('RDO_REDMINE_USUARIO_ID');
$loginPermitido = $opcao('RDO_REDMINE_USUARIO_LOGIN');
$contaPermitida = $usuarioPermitido > 0
    ? $usuarioPermitido === (int)$usuario['id']
    : $loginPermitido !== '' && strcasecmp($loginPermitido, (string)($usuario['login'] ?? '')) === 0;
$obraPermitida = (int)$opcao('RDO_REDMINE_OBRA_ID');
if (!$chave || !function_exists('curl_init') || !$contaPermitida || $obraPermitida <= 0
    || $obraPermitida !== (int)$obra) {
    rdo_redmine_responder(403, ['erro' => 'A integração com o Redmine ainda não está habilitada para esta conta e obra.']);
}
if (!preg_match('/^[a-zA-Z0-9]+$/D', $chave)) {
    rdo_redmine_responder(503, ['erro' => 'A configuração da chave do Redmine é inválida.']);
}
definir_obra_atual($obra);
$base = 'https://redmine.rotula.com.br';
$projeto = 'of198-09-montagem';
$listarResponsaveis = static function () use ($base, $projeto, $chave): array {
    $usuarios = [];
    $offset = 0;
    do {
        [$status, $dados] = rdo_redmine_requisicao(
            $base . '/projects/' . $projeto . '/memberships.json?limit=100&offset=' . $offset, $chave
        );
        if ($status !== 200 || !is_array($dados['memberships'] ?? null)) {
            rdo_redmine_responder(502, ['erro' => 'Não foi possível consultar os membros do projeto. Confira as permissões da conta no Redmine.']);
        }
        foreach ($dados['memberships'] as $membro) {
            $id = (int)($membro['user']['id'] ?? 0);
            if ($id > 0) {
                $usuarios[$id] = ['id' => $id, 'nome' => (string)($membro['user']['name'] ?? $id)];
            }
        }
        $pagina = count($dados['memberships']);
        $offset += $pagina;
    } while ($pagina > 0 && $offset < (int)($dados['total_count'] ?? 0));
    return $usuarios;
};
if (($_GET['acao'] ?? '') === 'responsaveis') {
    $usuarios = array_values($listarResponsaveis());
    usort($usuarios, static fn(array $a, array $b): int => strnatcasecmp($a['nome'], $b['nome']));
    $opcoes = [];
    foreach ([
        'tipos' => ['/projects/' . $projeto . '.json?include=trackers', 'trackers'],
        'situacoes' => ['/issue_statuses.json', 'issue_statuses'],
        'prioridades' => ['/enumerations/issue_priorities.json', 'issue_priorities'],
    ] as $campo => [$rota, $chaveLista]) {
        [$http, $json] = rdo_redmine_requisicao($base . $rota, $chave);
        $lista = $campo === 'tipos' ? ($json['project'][$chaveLista] ?? null) : ($json[$chaveLista] ?? null);
        if ($http !== 200 || !is_array($lista)) {
            rdo_redmine_responder(502, ['erro' => 'Não foi possível consultar as opções do projeto no Redmine.']);
        }
        $opcoes[$campo] = array_values(array_map(static fn(array $item): array =>
            ['id' => (int)$item['id'], 'nome' => (string)$item['name']],
            array_filter($lista, static fn(array $item): bool =>
                !($item['is_closed'] ?? false) && ($item['active'] ?? true))));
    }
    rdo_redmine_responder(200, ['usuarios' => $usuarios] + $opcoes);
}
$dia = (string)($_GET['data'] ?? '');
$limitePdf = 15 * 1024 * 1024;
$multipart = stripos((string)($_SERVER['CONTENT_TYPE'] ?? ''), 'multipart/form-data') === 0;
if ($multipart) {
    $arquivoPdf = $_FILES['pdf'] ?? [];
    $pdf = ($arquivoPdf['error'] ?? null) === UPLOAD_ERR_OK && is_uploaded_file($arquivoPdf['tmp_name'])
        ? file_get_contents($arquivoPdf['tmp_name'], false, null, 0, $limitePdf + 1)
        : false;
    $assuntoInformado = is_string($_POST['assunto'] ?? null) ? trim($_POST['assunto']) : '';
    $descricao = is_string($_POST['descricao'] ?? null) ? trim($_POST['descricao']) : '';
    if ($assuntoInformado === '' || mb_strlen($assuntoInformado) > 255 || mb_strlen($descricao) > 4000) {
        rdo_redmine_responder(400, ['erro' => 'Informe um assunto de até 255 caracteres e uma descrição de até 4000 caracteres.']);
    }
} else {
    $pdf = file_get_contents('php://input', false, null, 0, $limitePdf + 1);
}
if (!data_valida($dia) || !is_string($pdf) || strncmp($pdf, '%PDF-', 5) !== 0 || strlen($pdf) > $limitePdf) {
    rdo_redmine_responder(400, ['erro' => 'Informe uma data válida e um PDF de até 15 MB.']);
}

$registro = 'rdo_redmine_' . $dia;
$lock = fopen(sys_get_temp_dir() . '/rdo-redmine-' . hash('sha256', __DIR__ . ':' . $obra . ':' . $dia) . '.lock', 'c');
if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) {
    rdo_redmine_responder(409, ['erro' => 'Já há um envio em andamento para este RDO.']);
}
$anterior = sistema_ler($registro, '');
if (ctype_digit((string)$anterior)) {
    rdo_redmine_responder(200, ['url' => $base . '/issues/' . $anterior, 'existente' => true]);
}
if ($anterior === 'pendente') {
    rdo_redmine_responder(409, ['erro' => 'O Redmine não confirmou um envio anterior. Confira o projeto antes de reenviar.']);
}
$responsavel = filter_var($_POST['responsavel'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
if (!$responsavel || !isset($listarResponsaveis()[$responsavel])) {
    rdo_redmine_responder(422, ['erro' => 'Selecione um usuário que pertença ao projeto no Redmine.']);
}
$camposTarefa = [];
foreach (['tracker_id', 'status_id', 'priority_id'] as $campo) {
    $valor = filter_var($_POST[$campo] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    if (!$valor) {
        rdo_redmine_responder(422, ['erro' => 'Configure o tipo, a situação e a prioridade antes de enviar.']);
    }
    $camposTarefa[$campo] = $valor;
}
$prazo = filter_var($_POST['prazo'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 0, 'max_range' => 365]]);
if ($prazo === false || !isset($descricao) || $descricao === '') {
    rdo_redmine_responder(422, ['erro' => 'Configure uma descrição e um prazo de 0 a 365 dias.']);
}
$hoje = new DateTimeImmutable('today', new DateTimeZone('America/Bahia'));
$camposTarefa['start_date'] = $hoje->format('Y-m-d');
$camposTarefa['due_date'] = $hoje->modify('+' . $prazo . ' days')->format('Y-m-d');
$arquivo = 'RDO-gestao-' . $dia . '.pdf';
[$status, $resposta] = rdo_redmine_requisicao($base . '/uploads.json?filename=' . rawurlencode($arquivo), $chave, 'application/octet-stream', $pdf);
$token = $resposta['upload']['token'] ?? '';
if ($status !== 201 || !$token) {
    rdo_redmine_responder(502, ['erro' => 'O Redmine não aceitou o PDF. Confira a chave e as permissões da conta.']);
}
$nome = q_global('SELECT nome FROM obras WHERE id = ?', [$obra])->fetchColumn() ?: 'Obra ' . $obra;
$assunto = $assuntoInformado ?? mb_substr('RDO Gestão · ' . $nome . ' · ' . date('d/m/Y', strtotime($dia)), 0, 255);
$tarefa = ['project_id' => $projeto, 'assigned_to_id' => $responsavel, 'subject' => $assunto,
    'description' => $descricao ?? 'Relatório Diário de Obra para a gestão. Consulte o PDF anexo.',
    'uploads' => [['token' => $token, 'filename' => $arquivo, 'content_type' => 'application/pdf']]];
$tarefa += $camposTarefa;
$corpo = json_encode(['issue' => $tarefa], JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
sistema_gravar($registro, 'pendente');
[$status, $resposta] = rdo_redmine_requisicao($base . '/issues.json', $chave, 'application/json', $corpo);
$id = (int)($resposta['issue']['id'] ?? 0);
if ($status !== 201 || !$id) {
    if (in_array($status, [400, 401, 403, 404, 422], true)) {
        sistema_gravar($registro, '');
        rdo_redmine_responder(422, ['erro' => 'O Redmine recusou a criação. Confira as permissões e os campos obrigatórios do projeto.']);
    }
    rdo_redmine_responder(502, ['erro' => 'O Redmine não confirmou a criação. Confira o projeto para evitar duplicidade.']);
}
sistema_gravar($registro, (string)$id);
registrar_global('rdo_redmine_envio', ['obra' => $obra, 'data' => $dia, 'tarefa' => $id, 'usuario' => $usuario['id']]);
rdo_redmine_responder(201, ['url' => $base . '/issues/' . $id]);
