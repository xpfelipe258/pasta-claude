<?php
require __DIR__ . '/inc/nucleo.php';

const REDMINE_TAREFAS_BASE = 'https://redmine.rotula.com.br';

function redmine_tarefas_responder(int $status, array $dados): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($dados, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}

function redmine_tarefas_config(): array
{
    $publica = realpath((string)($_SERVER['DOCUMENT_ROOT'] ?? ''));
    $arquivo = $publica ? dirname($publica) . '/rdo_redmine.private.ini' : '';
    $ini = $arquivo !== '' && is_readable($arquivo) ? @parse_ini_file($arquivo, false, INI_SCANNER_RAW) : [];
    $opcao = static fn(string $nome): string => trim((string)($ini[$nome] ?? getenv($nome)));
    return [
        'chave' => $opcao('RDO_REDMINE_API_KEY'),
        'usuario_id' => (int)$opcao('RDO_REDMINE_USUARIO_ID'),
        'login' => $opcao('RDO_REDMINE_USUARIO_LOGIN'),
    ];
}

function redmine_tarefas_requisicao(string $chave, string $rota, string $metodo = 'GET', ?array $corpo = null, bool $opcional = false): array
{
    $curl = curl_init(REDMINE_TAREFAS_BASE . $rota);
    curl_setopt_array($curl, [
        CURLOPT_CUSTOMREQUEST => $metodo,
        CURLOPT_HTTPHEADER => ['X-Redmine-API-Key: ' . $chave, 'Accept: application/json', 'Content-Type: application/json'],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_CONNECTTIMEOUT => 4,
        CURLOPT_TIMEOUT => 10,
    ]);
    if ($corpo !== null) {
        curl_setopt($curl, CURLOPT_POSTFIELDS, json_encode($corpo, JSON_INVALID_UTF8_SUBSTITUTE));
    }
    $resposta = curl_exec($curl);
    $status = (int)curl_getinfo($curl, CURLINFO_HTTP_CODE);
    curl_close($curl);
    $dados = json_decode((string)$resposta, true);
    if ($status === 204 || ($status === 200 && $metodo === 'PUT' && $resposta === '')) { return []; }
    if ($status >= 200 && $status < 300 && is_array($dados)) { return $dados; }
    if ($opcional && in_array($status, [403, 404], true)) { return []; }

    if ($status === 422) {
        $erros = [];
        foreach ((array)($dados['errors'] ?? []) as $erro) {
            if (is_string($erro)) { $erros[] = mb_substr(strip_tags(str_replace($chave, '[oculto]', $erro)), 0, 300); }
        }
        $erros = array_slice($erros, 0, 10);
        redmine_tarefas_responder(422, ['erro' => $erros ? implode(' · ', $erros) : 'Confira os campos exigidos pelo projeto no Redmine.']);
    }
    if ($status === 401) { redmine_tarefas_responder(502, ['erro' => 'O Redmine não aceitou a credencial configurada.']); }
    if ($status === 403) { redmine_tarefas_responder(403, ['erro' => 'A conta conectada ao Redmine não tem permissão para esta operação.']); }
    if ($status === 404) { redmine_tarefas_responder(404, ['erro' => 'A tarefa ou o projeto não está disponível para a conta conectada.']); }
    $erro = $metodo === 'GET' ? 'Não foi possível consultar o Redmine.'
        : 'O Redmine não confirmou a operação. Atualize a lista antes de tentar novamente.';
    redmine_tarefas_responder(502, ['erro' => $erro]);
}

function redmine_tarefas_id($valor, string $nome): int
{
    $id = filter_var($valor, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    if (!$id) { redmine_tarefas_responder(422, ['erro' => 'Selecione ' . $nome . ' válido.']); }
    return $id;
}

function redmine_tarefas_texto(array $dados, string $campo, string $nome, int $maximo, bool $obrigatorio = false): string
{
    $valor = $dados[$campo] ?? '';
    if (!is_string($valor)) { redmine_tarefas_responder(422, ['erro' => 'Confira o campo ' . $nome . '.']); }
    $valor = trim($valor);
    if (($obrigatorio && $valor === '') || mb_strlen($valor) > $maximo) {
        redmine_tarefas_responder(422, ['erro' => 'Informe ' . $nome . ' com até ' . $maximo . ' caracteres.']);
    }
    return $valor;
}

function redmine_tarefas_projeto(string $chave, int $id): array
{
    $dados = redmine_tarefas_requisicao($chave, '/projects/' . $id . '.json?include=trackers,issue_custom_fields');
    $projeto = $dados['project'] ?? [];
    if ((int)($projeto['id'] ?? 0) !== $id) {
        redmine_tarefas_responder(502, ['erro' => 'O Redmine devolveu um projeto diferente do solicitado.']);
    }
    return $projeto;
}

function redmine_tarefas_membros(string $chave, int $projeto): array
{
    $membros = [];
    $offset = 0;
    do {
        $dados = redmine_tarefas_requisicao($chave, '/projects/' . $projeto . '/memberships.json?limit=100&offset=' . $offset, 'GET', null, true);
        $pagina = $dados['memberships'] ?? [];
        foreach ($pagina as $membro) {
            $pessoa = $membro['user'] ?? $membro['group'] ?? [];
            $id = (int)($pessoa['id'] ?? 0);
            if ($id > 0) { $membros[$id] = ['id' => $id, 'name' => (string)($pessoa['name'] ?? $id)]; }
        }
        $offset += count($pagina);
    } while ($pagina && $offset < (int)($dados['total_count'] ?? 0));
    $membros = array_values($membros);
    usort($membros, static fn(array $a, array $b): int => strnatcasecmp($a['name'], $b['name']));
    return $membros;
}

function redmine_tarefas_campos(array $campos, array $permitidos): array
{
    $ids = array_map('intval', array_column($permitidos, 'id'));
    $resultado = [];
    foreach ($campos as $campo) {
        $id = redmine_tarefas_id($campo['id'] ?? null, 'um campo adicional');
        $valor = $campo['value'] ?? '';
        if (!in_array($id, $ids, true) || count((array)$valor) > 50) {
            redmine_tarefas_responder(422, ['erro' => 'Confira os campos adicionais disponíveis no projeto.']);
        }
        foreach ((array)$valor as $item) {
            if (!is_string($item) || mb_strlen($item) > 4000) {
                redmine_tarefas_responder(422, ['erro' => 'Confira os valores dos campos adicionais.']);
            }
        }
        $resultado[$id] = ['id' => $id, 'value' => is_array($valor) ? array_values($valor) : $valor];
    }
    return array_values($resultado);
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    redmine_tarefas_responder(405, ['erro' => 'Método não permitido.']);
}
$usuario = usuario_atual();
if (!$usuario) { redmine_tarefas_responder(401, ['erro' => 'Faça login novamente.']); }
conferir_csrf();
$config = redmine_tarefas_config();
$vinculado = $config['usuario_id'] > 0
    ? $config['usuario_id'] === (int)$usuario['id']
    : $config['login'] !== '' && strcasecmp($config['login'], (string)($usuario['login'] ?? '')) === 0;
if (!$vinculado || $config['chave'] === '') {
    redmine_tarefas_responder(403, ['erro' => 'Esta conta da Central de Obras não está conectada ao Redmine.']);
}
$chave = $config['chave'];
if (!preg_match('/^[a-zA-Z0-9]+$/D', $chave) || !function_exists('curl_init')) {
    redmine_tarefas_responder(503, ['erro' => 'A conexão com o Redmine precisa ser configurada no servidor.']);
}
$entrada = file_get_contents('php://input', false, null, 0, 262145);
$dados = is_string($entrada) && strlen($entrada) <= 262144 ? json_decode($entrada, true) : null;
$acao = is_array($dados) ? ($dados['acao'] ?? null) : null;
if (!in_array($acao, ['listar', 'detalhe', 'projetos', 'opcoes', 'responder', 'criar'], true)) {
    redmine_tarefas_responder(400, ['erro' => 'Ação inválida.']);
}
$permiteEditar = ($usuario['perfil'] ?? '') !== 'leitura';
if (!$permiteEditar && in_array($acao, ['responder', 'criar'], true)) {
    redmine_tarefas_responder(403, ['erro' => 'Seu usuário tem acesso somente para consulta.']);
}
if (session_status() === PHP_SESSION_ACTIVE) { session_write_close(); }

// Confirma a identidade antes de consultar o Redmine, inclusive quando há projetos públicos.
$remoto = redmine_tarefas_requisicao($chave, '/users/current.json')['user'] ?? [];
if (empty($remoto['id']) || empty($remoto['login'])) {
    redmine_tarefas_responder(502, ['erro' => 'O Redmine não confirmou a conta conectada.']);
}
$conta = ['id' => (int)$remoto['id'], 'nome' => trim(($remoto['firstname'] ?? '') . ' ' . ($remoto['lastname'] ?? '')) ?: $remoto['login']];
unset($remoto);

if ($acao === 'listar' || $acao === 'projetos') {
    $pagina = isset($dados['pagina']) ? redmine_tarefas_id($dados['pagina'], 'uma página') : 1;
    $limite = $acao === 'listar' ? 25 : 100;
    if ($pagina > intdiv(PHP_INT_MAX, $limite)) { redmine_tarefas_responder(422, ['erro' => 'Página inválida.']); }
    $filtros = ['limit' => $limite, 'offset' => ($pagina - 1) * $limite];
    if ($acao === 'listar') {
        $status = $dados['status'] ?? '*';
        $escopo = $dados['escopo'] ?? 'minhas';
        if (!in_array($status, ['open', 'closed', '*'], true) || !in_array($escopo, ['minhas', 'visiveis'], true)) {
            redmine_tarefas_responder(422, ['erro' => 'Filtros inválidos.']);
        }
        $filtros += ['status_id' => $status, 'sort' => 'updated_on:desc,id:desc'];
        if ($escopo === 'minhas') { $filtros['assigned_to_id'] = 'me'; }
        $resultado = redmine_tarefas_requisicao($chave, '/issues.json?' . http_build_query($filtros));
        $lista = ['tarefas' => $resultado['issues'] ?? [], 'conta' => $conta, 'permite_editar' => $permiteEditar];
    } else {
        $resultado = redmine_tarefas_requisicao($chave, '/projects.json?' . http_build_query($filtros));
        $lista = ['projetos' => $resultado['projects'] ?? []];
    }
    redmine_tarefas_responder(200, $lista + ['total' => (int)($resultado['total_count'] ?? 0), 'pagina' => $pagina, 'limite' => $limite]);
}

if ($acao === 'detalhe' || $acao === 'responder') {
    $id = redmine_tarefas_id($dados['id'] ?? null, 'uma tarefa');
    $rota = '/issues/' . $id . '.json';
    if ($acao === 'responder') {
        $nota = redmine_tarefas_texto($dados, 'nota', 'a resposta', 10000, true);
        $rotaHistorico = $rota . '?include=journals';
        $atual = redmine_tarefas_requisicao($chave, $rotaHistorico)['issue'] ?? [];
        $antes = $atual['journals'] ?? [];
        $responsavel = null;
        $alteracao = ['notes' => $nota];
        if (($dados['responsavel_id'] ?? '') !== '') {
            $responsavel = redmine_tarefas_id($dados['responsavel_id'], 'um responsável');
            $membros = redmine_tarefas_membros($chave, (int)($atual['project']['id'] ?? 0));
            if (!in_array($responsavel, array_column($membros, 'id'), true)) {
                redmine_tarefas_responder(422, ['erro' => 'Escolha um responsável do projeto.']);
            }
            $alteracao['assigned_to_id'] = $responsavel;
        }
        $idsAnteriores = array_column($antes, 'id');
        redmine_tarefas_requisicao($chave, $rota, 'PUT', ['issue' => $alteracao]);
        $atualizada = redmine_tarefas_requisicao($chave, $rotaHistorico)['issue'] ?? [];
        $depois = $atualizada['journals'] ?? [];
        foreach ($depois as $registro) {
            $texto = str_replace(["\r\n", "\r"], "\n", trim((string)($registro['notes'] ?? '')));
            if (!in_array($registro['id'] ?? null, $idsAnteriores, true) && (int)($registro['user']['id'] ?? 0) === $conta['id']
                && $texto === str_replace(["\r\n", "\r"], "\n", $nota)) {
                redmine_tarefas_responder(200, ['ok' => true, 'atribuicao_confirmada' => $responsavel === null || (int)($atualizada['assigned_to']['id'] ?? 0) === $responsavel]);
            }
        }
        redmine_tarefas_responder(409, ['erro' => 'A resposta não apareceu no histórico do Redmine. Confira se a conta pode adicionar notas nesta tarefa.']);
    }
    $tarefa = redmine_tarefas_requisicao($chave, $rota . '?include=journals,attachments')['issue'] ?? null;
    if (!is_array($tarefa)) { redmine_tarefas_responder(502, ['erro' => 'O Redmine não retornou os detalhes da tarefa.']); }
    foreach (($tarefa['attachments'] ?? []) as $i => $anexo) {
        $url = (string)($anexo['content_url'] ?? '');
        $partes = parse_url($url);
        if (($partes['scheme'] ?? '') !== 'https' || ($partes['host'] ?? '') !== 'redmine.rotula.com.br'
            || isset($partes['user']) || isset($partes['pass']) || isset($partes['port']) || isset($partes['query'])) {
            unset($tarefa['attachments'][$i]['content_url']);
        }
    }
    $projeto = (int)($tarefa['project']['id'] ?? 0);
    $membros = $permiteEditar && $projeto > 0 ? redmine_tarefas_membros($chave, $projeto) : [];
    redmine_tarefas_responder(200, ['tarefa' => $tarefa, 'responsaveis' => $membros]);
}

$projetoId = redmine_tarefas_id($dados['projeto_id'] ?? null, 'um projeto');
if ($acao === 'opcoes') {
    $projeto = redmine_tarefas_projeto($chave, $projetoId);
    $status = redmine_tarefas_requisicao($chave, '/issue_statuses.json')['issue_statuses'] ?? [];
    $prioridades = redmine_tarefas_requisicao($chave, '/enumerations/issue_priorities.json')['issue_priorities'] ?? [];
    redmine_tarefas_responder(200, [
        'tipos' => $projeto['trackers'] ?? [],
        'prioridades' => array_values(array_filter($prioridades, static fn(array $item): bool => $item['active'] ?? true)),
        'situacoes' => array_values(array_filter($status, static fn(array $item): bool => empty($item['is_closed']))),
        'responsaveis' => redmine_tarefas_membros($chave, $projetoId),
        'campos_personalizados' => $projeto['issue_custom_fields'] ?? [],
    ]);
}

$issue = ['project_id' => $projetoId, 'subject' => redmine_tarefas_texto($dados, 'titulo', 'o título', 255, true),
    'description' => redmine_tarefas_texto($dados, 'descricao', 'a descrição', 10000)];
foreach (['tipo_id' => 'tracker_id', 'prioridade_id' => 'priority_id', 'situacao_id' => 'status_id', 'responsavel_id' => 'assigned_to_id'] as $campo => $destino) {
    if (isset($dados[$campo]) && $dados[$campo] !== '') {
        $issue[$destino] = redmine_tarefas_id($dados[$campo], 'um valor para ' . str_replace('_id', '', $campo));
    }
}
foreach (['inicio' => 'start_date', 'prazo' => 'due_date'] as $campo => $destino) {
    $data = $dados[$campo] ?? '';
    if ($data === '') { continue; }
    if (!is_string($data) || !data_valida($data)) { redmine_tarefas_responder(422, ['erro' => 'Informe uma data válida.']); }
    $issue[$destino] = $data;
}
if (!empty($dados['campos_personalizados'])) {
    if (!is_array($dados['campos_personalizados'])) { redmine_tarefas_responder(422, ['erro' => 'Confira os campos adicionais.']); }
    $projeto = redmine_tarefas_projeto($chave, $projetoId);
    $issue['custom_fields'] = redmine_tarefas_campos($dados['campos_personalizados'], $projeto['issue_custom_fields'] ?? []);
}
$tarefa = redmine_tarefas_requisicao($chave, '/issues.json', 'POST', ['issue' => $issue])['issue'] ?? null;
if (!is_array($tarefa) || empty($tarefa['id'])) {
    redmine_tarefas_responder(502, ['erro' => 'O Redmine não confirmou a criação. Atualize a lista antes de tentar novamente.']);
}
redmine_tarefas_responder(201, ['tarefa' => $tarefa]);
