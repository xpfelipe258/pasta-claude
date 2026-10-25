<?php
// API JSON consumida pela interface (mesmos contratos do programa local).
require __DIR__ . '/inc/nucleo.php';
require __DIR__ . '/inc/modelo.php';

class ErroValidacao extends Exception
{
}

if (!config()) {
    responder_json(503, ['erro' => 'Sistema não instalado. Acesse instalar.php.']);
}
$usuario = autenticar_machine_token();
$via_token = ($usuario !== null);
if (!$usuario) {
    $usuario = usuario_atual();
}
if (!$usuario) {
    responder_json(401, ['erro' => 'Faça login novamente.']);
}
$obraId = $via_token ? (int)($_GET['obra_id'] ?? 0) : obra_atual_id();
$obraApi = $obraId ? q_global("SELECT * FROM obras WHERE id=? AND status='ativa'", [$obraId])->fetch() : null;
if (!$obraApi || (!$via_token && !usuario_pode_obra($usuario, $obraId))) {
    responder_json(409, ['erro' => 'Selecione uma obra na Central de Obras.']);
}
definir_obra_atual($obraId);
if ($_SERVER['REQUEST_METHOD'] === 'POST' && !$via_token) {
    conferir_csrf();
}
if (!$via_token) {
    session_write_close();
}

$rota = isset($_GET['r']) ? (string)$_GET['r'] : '';

try {
    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        if ($rota === 'versao') {
            responder_json(200, ['versao' => sistema_ler('versao', '0')]);
        }
        if ($rota === 'dados') {
            responder_json(200, [
                'versao' => sistema_ler('versao', '0'),
                'arquivo' => obra_info()['nome'] . ' · sistema online',
                'obra' => obra_ficha(),
                'modificado' => sistema_ler('modificado', date('c')),
                'usuario' => ['nome' => $usuario['nome'], 'perfil' => $usuario['perfil'], 'empresa' => $usuario['empresa'], 'modulos' => modulos_usuario($usuario)],
                'recursos' => ['importar_mensal' => false, 'exportar' => false, 'online' => true],
                'modelo' => montar_modelo(),
            ]);
        }
        if ($rota === 'atualizacao') {   // o sistema online está sempre na versão publicada
            responder_json(200, ['online' => true, 'codigo' => sistema_ler('versao', '0'), 'ativo' => false,
                'intervalo' => 0, 'resultado' => 'online', 'detalhe' => 'Sistema online: sempre na versão publicada.']);
        }
        if ($rota === 'regras-baixa') {
            $d = carregar_regras_baixa();
            if ($d === null) {
                responder_json(404, ['erro' => 'Esta obra ainda não tem regras de baixa (vêm da importação automática).']);
            }
            responder_json(200, $d);
        }
        if ($rota === 'mapa-obra') {   // mapa de peças da importação automática (posição de cada conjunto na malha V × H)
            $d = json_decode((string)sistema_ler('frentes_montagem_obra', 'null'), true);
            if (!is_array($d)) {
                responder_json(404, ['erro' => 'Esta obra não tem o mapa de peças.']);
            }
            try {   // projetos em PDF guardados na importação: a tela do mapa oferece abrir cada prancha ao lado do desenho
                require_once __DIR__ . '/inc/importacao.php';
                $d['projetos'] = array_map(function ($r) { return ['id' => (int)$r['id'], 'nome' => $r['nome_original']]; },
                    array_values(array_filter(q_global("SELECT id, nome_original FROM obra_documentos WHERE obra_id = ? AND tipo = 'projetos' AND status = 'valido' ORDER BY id", [obra_atual_id()])->fetchAll(),
                        function ($r) { return importacao_extensao($r['nome_original']) === 'pdf'; })));
            } catch (Throwable $e) {
                $d['projetos'] = [];
            }
            responder_json(200, $d);
        }
        if ($rota === 'frentes-montagem') {
            $d = frentes_montagem();
            if ($d === null) {
                responder_json(404, ['erro' => 'Mapa das frentes não publicado.']);
            }
            responder_json(200, $d);
        }
        if ($rota === 'parafusos-locais') {
            $d = dado_json_da_obra('ifc_parafusos_locais', 'ifc_parafusos_locais.json');
            if ($d === null) {
                responder_json(404, ['erro' => 'Esta obra não tem a lista de parafusos por local.']);
            }
            responder_json(200, $d);
        }
        if ($rota === 'planos') {
            responder_json(200, planos_ler());
        }
        if ($rota === 'tarefas') {
            if ($via_token) {
                responder_json(403, ['erro' => 'Tarefas não estão disponíveis por token de máquina.']);
            }
            responder_json(200, tarefas_listar($usuario));
        }
        if ($rota === 'tarefas-msgs') {
            if ($via_token) {
                responder_json(403, ['erro' => 'Tarefas não estão disponíveis por token de máquina.']);
            }
            responder_json(200, tarefas_msgs_listar($usuario, (int)($_GET['tarefa'] ?? 0)));
        }
        if ($rota === 'planejamento') {
            $d = json_decode((string)sistema_ler('planejamento', '{"setores":[]}'), true);
            responder_json(200, is_array($d) ? $d : ['setores' => []]);
        }
        if ($rota === 'dados-producao') {
            $d = json_decode((string)sistema_ler('dados_producao', 'null'), true);
            if (!is_array($d)) {
                responder_json(404, ['erro' => 'Nenhum snapshot gravado. Use o programa local para gerar os dados.']);
            }
            responder_json(200, $d);
        }
        if ($rota === 'estoque-planilha') {
            $d = estoque_planilha_ler();
            if ($d === null) {
                responder_json(404, ['erro' => 'Estoque da planilha não importado. Use Administração → Importar dados.']);
            }
            responder_json(200, $d);
        }
        responder_json(404, ['erro' => 'Rota desconhecida.']);
    }

    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        responder_json(405, ['erro' => 'Método não permitido.']);
    }
    if (stripos($_SERVER['CONTENT_TYPE'] ?? '', 'application/json') !== 0) {
        responder_json(415, ['erro' => 'Envie os dados em JSON.']);
    }
    if ($rota === 'tarefas-msgs') {   // conversa entre os usuários: não mexe nos dados da obra
        if ($via_token) {
            responder_json(403, ['erro' => 'Tarefas não estão disponíveis por token de máquina.']);
        }
        $corpoM = json_decode(file_get_contents('php://input'), true);
        if (!is_array($corpoM)) {
            throw new ErroValidacao('Dados inválidos.');
        }
        responder_json(200, acao_tarefas_msgs($corpoM, $usuario));
    }
    if ($rota === 'tarefas') {   // tarefas são pessoais/da gestão: não mexem nos dados da obra nem na versão do modelo
        if ($via_token) {
            responder_json(403, ['erro' => 'Tarefas não estão disponíveis por token de máquina.']);
        }
        $corpoT = json_decode(file_get_contents('php://input'), true);
        if (!is_array($corpoT)) {
            throw new ErroValidacao('Dados inválidos.');
        }
        responder_json(200, acao_tarefas($corpoT, $usuario));
    }
    if ($usuario['perfil'] === 'leitura') {
        responder_json(403, ['erro' => 'Seu usuário é somente leitura.']);
    }
    $corpo = json_decode(file_get_contents('php://input'), true);
    if (!is_array($corpo)) {
        throw new ErroValidacao('Dados inválidos.');
    }
    $moduloRota = [
        'producao'=>'producao','cliente-contrato'=>'producao','apontamento'=>'producao','apontamento-pecas'=>'producao','mapa-obra/atualizar'=>'producao','apontamentos/sincronizar-fase2'=>'producao','planejamento'=>'producao','planos'=>'producao','referencia'=>'producao','projecao-config'=>'financeiro','fluxo-config'=>'producao','vinculos'=>'suprimentos','fixadores-atividade'=>'suprimentos',
        'estoque/semear-materiais'=>'suprimentos','estoque-planilha/remessa'=>'suprimentos','estoque-planilha/remessa-datas'=>'suprimentos','estoque-planilha/material'=>'suprimentos','estoque-planilha/consumo'=>'suprimentos','estoque-planilha/consumo-celula'=>'suprimentos','estoque-planilha/consumo-semana'=>'suprimentos',
        'equip/importar'=>'consumo',
        'bm/apontar'=>'financeiro','bm/semear'=>'financeiro','bm/fechar'=>'financeiro','bm/reabrir'=>'financeiro',
        'metas'=>'gestao','criar-meta'=>'gestao','impacto'=>'gestao'
    ];
    if (isset($moduloRota[$rota]) && !usuario_pode_modulo($usuario, $moduloRota[$rota])) {
        responder_json(403, ['erro' => 'Seu usuário não possui acesso ao módulo ' . strtoupper($moduloRota[$rota]) . '.']);
    }
    $acoes = [
        'producao' => 'acao_producao', 'metas' => 'acao_metas', 'impacto' => 'acao_impacto',
        'registro' => 'acao_registro', 'equip/importar' => 'acao_importar_mensal',
        'bm/apontar' => 'acao_bm_apontar', 'bm/semear' => 'acao_bm_semear',
        'bm/fechar' => 'acao_bm_fechar', 'bm/reabrir' => 'acao_bm_reabrir',
        'apontamento' => 'acao_apontamento', 'apontamento-pecas' => 'acao_apontamento_pecas', 'mapa-obra/atualizar' => 'acao_mapa_obra_atualizar', 'apontamentos/sincronizar-fase2' => 'acao_sincronizar_apontamentos_fase2',
        'referencia' => 'acao_referencia',
        'estoque/semear-materiais' => 'acao_semear_materiais',
        'estoque-planilha/remessa' => 'acao_estoque_remessa', 'estoque-planilha/remessa-datas' => 'acao_estoque_remessa_datas', 'estoque-planilha/material' => 'acao_estoque_material', 'estoque-planilha/consumo' => 'acao_estoque_consumo', 'estoque-planilha/consumo-celula' => 'acao_estoque_consumo_celula', 'estoque-planilha/consumo-semana' => 'acao_estoque_consumo_semana',
        'planejamento' => 'acao_salvar_planejamento', 'planos' => 'acao_planos', 'cliente-contrato' => 'acao_cliente_contrato', 'projecao-config' => 'acao_projecao_config', 'fluxo-config' => 'acao_fluxo_config', 'vinculos' => 'acao_vinculos', 'fixadores-atividade' => 'acao_fixadores_atividade',
        'dados-producao/importar' => 'acao_importar_snapshot',
        'machine-token/gerar' => 'acao_gerar_machine_token',
        'machine-token/revogar' => 'acao_revogar_machine_token',
        'popular-qtd-cliente' => 'acao_popular_qtd_cliente',
        'popular-fase2-servicos' => 'acao_popular_fase2_servicos',
        'popular-cliente-fase2' => 'acao_popular_cliente_fase2',
        'atualizar-datas-cronograma' => 'acao_atualizar_datas_cronograma',
        'criar-meta' => 'acao_criar_meta',
    ];
    if (!isset($acoes[$rota])) {
        responder_json(404, ['erro' => 'Ação desconhecida.']);
    }
    $pdo = bd();
    $pdo->beginTransaction();
    try {
        $r = call_user_func($acoes[$rota], $corpo, $usuario);
        registrar_alteracao($rota, $corpo);
        $pdo->commit();
    } catch (Exception $e) {
        $pdo->rollBack();
        throw $e;
    }
    $extra = is_array($r) ? $r : ['celulas' => $r];
    responder_json(200, array_merge(['ok' => true, 'celulas' => 0], $extra, ['versao' => sistema_ler('versao', '0')]));
} catch (ErroValidacao $e) {
    responder_json(400, ['erro' => $e->getMessage()]);
} catch (Exception $e) {
    error_log('obra198: ' . $e->getMessage());
    responder_json(500, ['erro' => 'Falha ao gravar no banco de dados.']);
}

// ----------------------------------------------------------------- tarefas a fazer

// (listas em funções: o roteador acima roda antes de as constantes deste arquivo serem definidas)
function tarefa_status()
{
    return ['pendente', 'andamento', 'concluida', 'cancelada'];
}
function tarefa_prioridades()
{
    return ['baixa', 'normal', 'alta', 'urgente'];
}

function tarefa_agora_brt()
{
    return (new DateTimeImmutable('now', new DateTimeZone('America/Sao_Paulo')))->format('Y-m-d H:i:s');
}

// Administrador vê todas; os demais veem as que foram atribuídas a eles ou que eles mesmos criaram.
function tarefas_listar(array $usuario)
{
    garantir_tarefas();
    $admin = ($usuario['perfil'] ?? '') === 'admin';
    $sql = 'SELECT t.*, r.nome AS responsavel_nome, c.nome AS criado_por_nome,
        (SELECT COUNT(*) FROM tarefas_msgs m WHERE m.tarefa_id = t.id) AS n_msgs, (SELECT MAX(m.id) FROM tarefas_msgs m WHERE m.tarefa_id = t.id) AS ult_msg_id,
        (SELECT m2.usuario_id FROM tarefas_msgs m2 WHERE m2.id = (SELECT MAX(m3.id) FROM tarefas_msgs m3 WHERE m3.tarefa_id = t.id)) AS ult_msg_usuario FROM tarefas t
        LEFT JOIN usuarios r ON r.id = t.responsavel_id LEFT JOIN usuarios c ON c.id = t.criado_por';
    $params = [];
    if (!$admin) {
        $sql .= ' WHERE t.responsavel_id = ? OR t.criado_por = ?';
        $params = [(int)$usuario['id'], (int)$usuario['id']];
    }
    $sql .= ' ORDER BY t.data_fim, t.id';
    $linhas = q_global($sql, $params)->fetchAll();
    foreach ($linhas as &$l) {
        foreach (['id', 'criado_por', 'responsavel_id', 'aviso_dias', 'n_msgs', 'ult_msg_id', 'ult_msg_usuario'] as $k) {
            $l[$k] = (int)$l[$k];
        }
        $l['pessoal'] = $l['criado_por'] === $l['responsavel_id'];
        $l['pode_editar'] = $admin || $l['criado_por'] === (int)$usuario['id'];
    }
    unset($l);
    $usuarios = $admin ? q_global('SELECT id, nome, empresa FROM usuarios WHERE ativo = 1 ORDER BY nome')->fetchAll()
        : [['id' => (int)$usuario['id'], 'nome' => $usuario['nome'], 'empresa' => $usuario['empresa'] ?? null]];
    foreach ($usuarios as &$u) {
        $u['id'] = (int)$u['id'];
    }
    unset($u);
    $mural = q_global('SELECT id, usuario_id FROM tarefas_msgs WHERE tarefa_id = 0 ORDER BY id DESC LIMIT 1')->fetch();
    return ['usuario_id' => (int)$usuario['id'], 'admin' => $admin, 'usuarios' => $usuarios, 'tarefas' => $linhas,
        'mural_ultimo' => $mural ? (int)$mural['id'] : 0, 'mural_ultimo_usuario' => $mural ? (int)$mural['usuario_id'] : 0];
}

// ---- conversa entre os usuários (mural da equipe e conversa de cada tarefa), só para comunicação e envio de arquivos
function tarefas_msgs_listar(array $usuario, $tarefaId)
{
    garantir_tarefas();
    $tarefaId = (int)$tarefaId;
    if (!tarefa_conversa_acesso($usuario, $tarefaId)) {
        throw new ErroValidacao('Você não participa desta tarefa.');
    }
    $l = q_global('SELECT id, tarefa_id, usuario_id, autor, texto, arquivo_nome, arquivo_tipo, arquivo_tam, (arquivo IS NOT NULL) AS tem_arquivo, criado_em
        FROM tarefas_msgs WHERE tarefa_id = ? ORDER BY id DESC LIMIT 300', [$tarefaId])->fetchAll();
    $admin = ($usuario['perfil'] ?? '') === 'admin';
    foreach ($l as &$m) {
        foreach (['id', 'tarefa_id', 'usuario_id', 'arquivo_tam'] as $k) {
            $m[$k] = (int)$m[$k];
        }
        $m['tem_arquivo'] = (bool)$m['tem_arquivo'];
        $m['minha'] = $m['usuario_id'] === (int)$usuario['id'];
        $m['pode_excluir'] = $m['minha'] || $admin;
    }
    unset($m);
    return ['tarefa' => $tarefaId, 'mensagens' => array_reverse($l), 'usuario_id' => (int)$usuario['id']];
}

function acao_tarefas_msgs(array $corpo, array $usuario)
{
    garantir_tarefas();
    $acao = (string)($corpo['acao'] ?? '');
    $tarefaId = (int)($corpo['tarefa'] ?? 0);
    if (!tarefa_conversa_acesso($usuario, $tarefaId)) {
        throw new ErroValidacao('Você não participa desta tarefa.');
    }
    if ($acao === 'enviar') {
        $texto = trim((string)($corpo['texto'] ?? ''));
        if ($texto === '' || mb_strlen($texto) > 4000) {
            throw new ErroValidacao('Escreva a mensagem (até 4.000 caracteres).');
        }
        q_global('INSERT INTO tarefas_msgs (tarefa_id, usuario_id, autor, texto, criado_em) VALUES (?, ?, ?, ?, ?)',
            [$tarefaId, (int)$usuario['id'], mb_substr((string)$usuario['nome'], 0, 100), $texto, tarefa_agora_brt()]);
    } elseif ($acao === 'excluir') {
        $m = q_global('SELECT * FROM tarefas_msgs WHERE id = ? AND tarefa_id = ?', [(int)($corpo['id'] ?? 0), $tarefaId])->fetch();
        if (!$m) {
            throw new ErroValidacao('Mensagem não encontrada.');
        }
        if ((int)$m['usuario_id'] !== (int)$usuario['id'] && ($usuario['perfil'] ?? '') !== 'admin') {
            throw new ErroValidacao('Só quem escreveu (ou o administrador) apaga a mensagem.');
        }
        q_global('DELETE FROM tarefas_msgs WHERE id = ?', [(int)$m['id']]);
        if (!empty($m['arquivo'])) {
            @unlink(tarefas_arquivos_dir() . '/' . basename((string)$m['arquivo']));
        }
    } else {
        throw new ErroValidacao('Ação inválida.');
    }
    return tarefas_msgs_listar($usuario, $tarefaId);
}

function acao_tarefas(array $corpo, array $usuario)
{
    garantir_tarefas();
    $admin = ($usuario['perfil'] ?? '') === 'admin';
    $eu = (int)$usuario['id'];
    $acao = (string)($corpo['acao'] ?? '');
    $id = isset($corpo['id']) ? (int)$corpo['id'] : 0;
    $t = $id ? q_global('SELECT * FROM tarefas WHERE id = ?', [$id])->fetch() : null;
    if ($id && !$t) {
        throw new ErroValidacao('Tarefa não encontrada. Recarregue a tela.');
    }
    $agora = tarefa_agora_brt();
    if ($acao === 'salvar') {
        if ($t && !$admin && (int)$t['criado_por'] !== $eu) {
            throw new ErroValidacao('Só quem criou a tarefa (ou o administrador) pode alterar os dados dela. Você pode mudar o andamento e escrever o retorno.');
        }
        $titulo = trim((string)($corpo['titulo'] ?? ''));
        if ($titulo === '' || mb_strlen($titulo) > 200) {
            throw new ErroValidacao('Informe o título da tarefa (até 200 caracteres).');
        }
        $ini = (string)($corpo['data_inicio'] ?? '');
        $fim = (string)($corpo['data_fim'] ?? '');
        if (!data_valida($ini)) {
            throw new ErroValidacao('Informe a data de início.');
        }
        if (!data_valida($fim)) {
            throw new ErroValidacao('Informe a data de conclusão.');
        }
        if ($fim < $ini) {
            throw new ErroValidacao('A data de conclusão não pode ser anterior à data de início.');
        }
        $aviso = isset($corpo['aviso_dias']) && $corpo['aviso_dias'] !== '' ? (int)$corpo['aviso_dias'] : 2;
        if ($aviso < 0 || $aviso > 60) {
            throw new ErroValidacao('O aviso deve ser de 0 a 60 dias antes da conclusão.');
        }
        $prio = (string)($corpo['prioridade'] ?? 'normal');
        if (!in_array($prio, tarefa_prioridades(), true)) {
            throw new ErroValidacao('Prioridade inválida.');
        }
        $resp = $eu;   // quem não é administrador só cria lembrete para si
        if ($admin && !empty($corpo['responsavel_id'])) {
            $resp = (int)$corpo['responsavel_id'];
            if (!q_global('SELECT id FROM usuarios WHERE id = ? AND ativo = 1', [$resp])->fetch()) {
                throw new ErroValidacao('Responsável inválido.');
            }
        } elseif ($t && !$admin) {
            $resp = (int)$t["responsavel_id"];
        }
        $desc = trim((string)($corpo['descricao'] ?? ''));
        if ($t) {
            q_global('UPDATE tarefas SET titulo=?, descricao=?, responsavel_id=?, data_inicio=?, data_fim=?, aviso_dias=?, prioridade=?, atualizado_em=? WHERE id=?',
                [$titulo, $desc !== '' ? $desc : null, $resp, $ini, $fim, $aviso, $prio, $agora, $id]);
        } else {
            q_global('INSERT INTO tarefas (titulo, descricao, criado_por, responsavel_id, data_inicio, data_fim, aviso_dias, prioridade, status, criado_em, atualizado_em)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [$titulo, $desc !== '' ? $desc : null, $eu, $resp, $ini, $fim, $aviso, $prio, 'pendente', $agora, $agora]);
        }
    } elseif ($acao === 'status') {
        if (!$t) {
            throw new ErroValidacao('Tarefa não encontrada.');
        }
        if (!$admin && (int)$t['criado_por'] !== $eu && (int)$t['responsavel_id'] !== $eu) {
            throw new ErroValidacao('Esta tarefa não é sua.');
        }
        $st = (string)($corpo['status'] ?? '');
        if (!in_array($st, tarefa_status(), true)) {
            throw new ErroValidacao('Situação inválida.');
        }
        $retorno = array_key_exists('retorno', $corpo) ? trim((string)$corpo['retorno']) : (string)($t['retorno'] ?? '');
        q_global('UPDATE tarefas SET status=?, retorno=?, concluida_em=?, atualizado_em=? WHERE id=?',
            [$st, $retorno !== '' ? $retorno : null, $st === 'concluida' ? $agora : null, $agora, $id]);
    } elseif ($acao === 'excluir') {
        if (!$t) {
            throw new ErroValidacao('Tarefa não encontrada.');
        }
        if (!$admin && (int)$t['criado_por'] !== $eu) {
            throw new ErroValidacao('Só quem criou a tarefa (ou o administrador) pode excluí-la.');
        }
        foreach (q_global('SELECT arquivo FROM tarefas_msgs WHERE tarefa_id = ? AND arquivo IS NOT NULL', [$id])->fetchAll() as $a) {
            @unlink(tarefas_arquivos_dir() . '/' . basename((string)$a['arquivo']));
        }
        q_global('DELETE FROM tarefas_msgs WHERE tarefa_id = ?', [$id]);
        q_global('DELETE FROM tarefas WHERE id = ?', [$id]);
    } else {
        throw new ErroValidacao('Ação de tarefa inválida.');
    }
    return tarefas_listar($usuario);
}

// ----------------------------------------------------------------- ações

function acao_producao(array $corpo, array $usuario)
{
    $emp = q('SELECT * FROM empresas WHERE aba = ?', [$corpo['aba'] ?? ''])->fetch();
    if (!$emp) {
        throw new ErroValidacao('Empresa inválida.');
    }
    if (!empty($usuario['empresa']) && $usuario['empresa'] !== $emp['nome']) {
        throw new ErroValidacao('Seu usuário só pode lançar produção da empresa ' . $usuario['empresa'] . '.');
    }
    $cols = q('SELECT col FROM servicos WHERE empresa_id = ?', [$emp['id']])->fetchAll(PDO::FETCH_COLUMN);
    $o = obra_info();
    $del = bd()->prepare('DELETE FROM producao WHERE obra_id = ? AND empresa_id = ? AND data = ? AND col = ?');
    $ins = bd()->prepare('INSERT INTO producao (obra_id, empresa_id, data, col, valor_num, valor_txt) VALUES (?, ?, ?, ?, ?, ?)');
    $n = 0;
    foreach (($corpo['alteracoes'] ?? []) as $a) {
        $data = $a['data'] ?? '';
        $col = $a['col'] ?? '';
        if (!data_valida($data) || $data < $o['data_inicio'] || $data > $o['data_fim']) {
            throw new ErroValidacao("Data fora do calendário da obra: $data");
        }
        $ehObs = $col === $emp['col_obs'];
        if (!$ehObs && !in_array($col, $cols, true)) {
            throw new ErroValidacao("Coluna inválida: $col");
        }
        $valor = $a['valor'] ?? null;
        $valor = is_string($valor) ? trim($valor) : $valor;
        $del->execute([obra_atual_id(), $emp['id'], $data, $col]);
        $n++;
        if ($valor === null || $valor === '') {
            continue;
        }
        $num = $ehObs ? null : numero($valor);
        if ($num !== null && $num < 0) {
            throw new ErroValidacao('Quantidade não pode ser negativa.');
        }
        $ins->execute([obra_atual_id(), $emp['id'], $data, $col, $num, $num === null ? mb_substr((string)$valor, 0, 255) : null]);
    }

    // Baixa automática por tipo de joist (quando tipo_joist_qtds é informado)
    $tipoJoistQtds = $corpo['tipo_joist_qtds'] ?? null;
    if (!empty($tipoJoistQtds) && is_array($tipoJoistQtds)) {
        $regras = carregar_regras_baixa();
        $csByServico = $regras['consumo_por_servico'] ?? [];
        $baixaAgrup = [];
        $descs = [];
        foreach ($tipoJoistQtds as $tipo => $qtd) {
            $qtd = (float)$qtd;
            if ($qtd <= 0) continue;
            $tipo = strtoupper(trim((string)$tipo));
            $chave = 'PREMONTAGEM_' . $tipo;
            $regra = $csByServico[$chave] ?? $csByServico['PREMONTAGEM'] ?? null;
            if (!$regra) continue;
            foreach ($regra['itens'] ?? [] as $item) {
                $cod = (string)($item['codigo'] ?? '');
                $por = (float)($item['por_unidade'] ?? 0);
                if ($cod === '' || $por <= 0) continue;
                $baixaAgrup[$cod] = ($baixaAgrup[$cod] ?? 0) + ($por * $qtd);
                $descs[$cod] = (string)($item['descricao'] ?? $cod);
            }
        }
        $baixaAuto = [];
        foreach ($baixaAgrup as $cod => $qtdTotal) {
            $baixaAuto[] = ['codigo' => $cod, 'material' => $descs[$cod] ?? $cod, 'quantidade' => round($qtdTotal, 2)];
        }
        return ['celulas' => $n, 'baixa_auto' => $baixaAuto, 'tipo_joist_qtds' => $tipoJoistQtds];
    }

    return $n;
}

function acao_metas(array $corpo)
{
    $n = 0;
    $campos = ['meta_dia', 'du', 'gap'];
    foreach (($corpo['alteracoes'] ?? []) as $a) {
        $id = (int)($a['linha'] ?? 0);
        if (!q('SELECT id FROM metas WHERE id = ?', [$id])->fetch()) {
            throw new ErroValidacao("Meta inválida: $id");
        }
        foreach ($campos as $c) {
            if (!array_key_exists($c, $a)) {
                continue;
            }
            $v = numero($a[$c]);
            if ($v === null) {
                $v = 0;
            }
            if ($v < 0 && $c !== 'gap') {
                throw new ErroValidacao("Valor inválido em $c.");
            }
            q("UPDATE metas SET $c = ? WHERE id = ?", [$v, $id]);
            $n++;
        }
    }
    return $n;
}

function acao_criar_meta(array $corpo)
{
    $obraId = obra_atual_id();
    // Auto-migração: adiciona coluna fase se não existir
    try { q("ALTER TABLE metas ADD COLUMN fase VARCHAR(1) NOT NULL DEFAULT ''", []); } catch (\Throwable $e) {}
    $criadas = 0;
    foreach ($corpo['metas'] ?? [] as $m) {
        $empresa = trim((string)($m['empresa'] ?? ''));
        $servico = trim((string)($m['servico'] ?? ''));
        $inicio  = trim((string)($m['inicio'] ?? ''));
        $du      = max(0, (int)($m['du'] ?? 5));
        $metaDia = max(0.0, (float)($m['meta_dia'] ?? 0));
        $fase    = in_array(trim((string)($m['fase'] ?? '')), ['1', '2'], true) ? trim((string)$m['fase']) : '';
        $linha   = isset($m['linha']) && $m['linha'] !== '' && $m['linha'] !== null ? (int)$m['linha'] : null;
        if (!$empresa || !$servico || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $inicio)) {
            continue;
        }
        if ($linha !== null) {
            if (!q('SELECT id FROM metas WHERE id = ? AND obra_id = ?', [$linha, $obraId])->fetch()) {
                continue;
            }
            q('UPDATE metas SET meta_dia = ?, du = ?, fase = ? WHERE id = ?', [$metaDia, $du, $fase, $linha]);
        } else {
            $existe = q('SELECT id FROM metas WHERE obra_id = ? AND empresa = ? AND servico = ? AND inicio = ? AND fase = ?',
                [$obraId, $empresa, $servico, $inicio, $fase])->fetch();
            if ($existe) {
                q('UPDATE metas SET meta_dia = ?, du = ? WHERE id = ?', [$metaDia, $du, $existe['id']]);
            } else {
                $dt = new DateTime($inicio);
                $dt->modify('+5 days');
                $fim = $dt->format('Y-m-d');
                q('INSERT INTO metas (obra_id, empresa, servico, inicio, fim, corte, meta_dia, du, gap, fase) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, 0, ?)',
                    [$obraId, $empresa, $servico, $inicio, $fim, $metaDia, $du, $fase]);
            }
        }
        $criadas++;
    }
    return ['criadas' => $criadas];
}

// A coluna impactos.setor nasce na migração do esquema 14; se por qualquer motivo ela ainda não existir, cria na hora
// (assim salvar o setor responsável nunca falha por banco desatualizado).
function garantir_coluna_impacto_setor()
{
    static $ok = false;
    if ($ok) {
        return;
    }
    $c = config();
    $pdo = bd();
    if (!in_array('setor', colunas_tabela($pdo, $c['driver'], 'impactos'), true)) {
        $pdo->exec("ALTER TABLE impactos ADD COLUMN setor VARCHAR(100) NULL");
    }
    foreach (impactos_colunas_solucao() as $col => $tipo) {
        if (!in_array($col, colunas_tabela($pdo, $c['driver'], 'impactos'), true)) {
            $pdo->exec("ALTER TABLE impactos ADD COLUMN $col $tipo");
        }
    }
    $ok = true;
}

function acao_impacto(array $corpo)
{
    garantir_coluna_impacto_setor();
    $id = isset($corpo['linha']) ? (int)$corpo['linha'] : null;
    $atual = $id !== null ? q('SELECT * FROM impactos WHERE id = ?', [$id])->fetch() : null;
    if ($id !== null && !$atual) {
        throw new ErroValidacao('Impacto não encontrado.');
    }
    if (!empty($corpo['excluir'])) {
        q('DELETE FROM impactos WHERE id = ?', [$id]);
        return 1;
    }
    $campos = ['data', 'servico', 'empresas', 'motivo', 'solucionado', 'tempo', 'quando', 'paralisacao', 'setor', 'solucao', 'solucionado_por'];
    $vals = [];
    foreach ($campos as $c) {
        if (array_key_exists($c, $corpo)) {
            $vals[$c] = texto_ou_nulo($corpo[$c]);
        }
    }
    // Impacto solucionado precisa dizer COMO foi solucionado e POR QUEM (exigido quando a solução é nova ou está sendo alterada;
    // impacto antigo já solucionado sem esses dados continua editável). Reabrir o impacto limpa a solução.
    if (array_key_exists('solucionado', $vals) || array_key_exists('solucao', $vals) || array_key_exists('solucionado_por', $vals)) {
        $dataSol = array_key_exists('solucionado', $vals) ? $vals['solucionado'] : ($atual['solucionado'] ?? null);
        if ($dataSol === null) {
            $vals['solucao'] = null; $vals['solucionado_por'] = null; $vals['solucionado_em'] = null;
        } else {
            $solucao = array_key_exists('solucao', $vals) ? $vals['solucao'] : ($atual['solucao'] ?? null);
            $por = array_key_exists('solucionado_por', $vals) ? $vals['solucionado_por'] : ($atual['solucionado_por'] ?? null);
            $mudou = !$atual || ($atual['solucionado'] ?? null) !== $dataSol || array_key_exists('solucao', $vals) && ($vals['solucao'] ?? '') !== ($atual['solucao'] ?? '');
            if ($mudou) {
                if ($solucao === null || trim((string)$solucao) === '') {
                    throw new ErroValidacao('Informe como o impacto foi solucionado.');
                }
                if ($por === null || trim((string)$por) === '') {
                    $por = (string)($GLOBALS['usuario']['nome'] ?? '');   // sem nome informado, vale quem está registrando
                    if ($por === '') { throw new ErroValidacao('Informe quem solucionou o impacto.'); }
                    $vals['solucionado_por'] = $por;
                }
                $vals['solucionado_em'] = (new DateTimeImmutable('now', new DateTimeZone('America/Sao_Paulo')))->format('Y-m-d H:i:s');
            }
        }
    }
    return gravar_linha('impactos', $id, $vals);
}

function gravar_linha($tabela, $id, array $vals)
{
    if (!$vals) {
        return 0;
    }
    if ($id === null) {
        $cols = array_keys($vals);
        q("INSERT INTO $tabela (" . implode(', ', $cols) . ') VALUES (' . implode(', ', array_fill(0, count($cols), '?')) . ')', array_values($vals));
    } else {
        $sets = implode(', ', array_map(function ($c) {
            return "$c = ?";
        }, array_keys($vals)));
        q("UPDATE $tabela SET $sets WHERE id = ?", array_merge(array_values($vals), [$id]));
    }
    return count($vals);
}

// Fixador cadastrado em Materiais entra também no consumo físico e no inventário da planilha de estoque
// (mesma TAG), para poder receber consumo e ser conferido sem precisar importar a planilha de novo.
function material_eh_fixador(array $m)
{
    if (!empty($m['tipo_editado'])) {   // tipo escolhido à mão na aba Materiais vale mais que o palpite pelo nome
        return mb_strtoupper(trim((string)($m['tipo_material'] ?? ''))) === 'FIXADOR';
    }
    $txt = mb_strtoupper(($m['tipo_material'] ?? '') . ' ' . ($m['codigo'] ?? '') . ' ' . ($m['material'] ?? '') . ' ' . ($m['obs'] ?? ''));
    foreach (['FIXADOR', 'PARAFUS', 'CHUMBADOR', 'ARRUELA', 'PORCA'] as $k) {
        if (mb_strpos($txt, $k) !== false) {
            return true;
        }
    }
    return false;
}

// Todo material cadastrado vai para as Remessas (e para a lista de materiais da planilha); o fixador vai também para
// o Consumo físico e o Inventário, com a mesma TAG. Idempotente: não duplica TAG que já existe.
function estoque_incluir_cadastro(array $m)
{
    $tag = estoque_tag($m['codigo'] ?? '');
    if ($tag === '') {
        return false;
    }
    $dados = estoque_planilha_ler();
    if ($dados === null) {
        return false;
    }
    $fix = material_eh_fixador($m);
    $produto = (string)(($m['material'] ?? '') !== '' ? $m['material'] : $tag);
    $etapa = (string)(($m['etapa'] ?? '') !== '' ? $m['etapa'] : (($m['servico'] ?? '') !== '' ? $m['servico'] : ($fix ? 'FIXADORES' : 'CADASTRO MANUAL')));
    $planejado = numero($m['saldo_inicial'] ?? null) ?: 0;
    $tem = function ($lista) use ($tag) {
        foreach ($lista as $it) {
            if (estoque_tag($it['tag'] ?? '') === $tag) {
                return true;
            }
        }
        return false;
    };
    $mudou = false;
    if (!$tem($dados['remessas']['itens'] ?? [])) {
        $dados['remessas']['itens'][] = ['tag' => $tag, 'material' => $produto, 'produto' => $produto, 'etapa' => $etapa,
            'qtd_por_remessa' => new stdClass(), 'total_recebido' => 0, 'origem_cadastro' => 'manual'];
        $mudou = true;
    }
    if (!$tem($dados['materiais'] ?? [])) {
        $dados['materiais'][] = ['tag' => $tag, 'material' => $produto, 'produto' => $produto,
            'local' => (string)(($m['local'] ?? '') !== '' ? $m['local'] : ($fix ? 'FIXADORES' : 'SUPRIMENTOS')), 'etapa' => $etapa,
            'tipo_material' => $fix ? 'FIXADOR' : (($m['tipo_material'] ?? '') !== '' ? $m['tipo_material'] : 'ESTRUTURA'),
            'planejado' => $planejado, 'chegou' => 0, 'consumido' => 0, 'estoque_pos_baixa' => 0,
            'atendimento' => $planejado ? 0 : null, 'status_logistico' => $planejado ? 'Crítico' : 'Cadastrado',
            'prioridade' => $fix ? 'FIXADOR' : '', 'origem_cadastro' => 'manual'];
        $mudou = true;
    }
    if ($fix || obra_preserva_identidade_ifc()) {
        if (!$tem($dados['consumo_fisico']['itens'] ?? [])) {
            $dados['consumo_fisico']['itens'][] = ['produto' => $produto, 'tag' => $tag, 'consumo_semanas' => new stdClass(),
                'total_consumo' => 0, 'inventarios_fisicos' => new stdClass(), 'origem_cadastro' => 'manual'];
            $mudou = true;
        }
        if (!$tem($dados['inventario'] ?? [])) {
            $dados['inventario'][] = ['material' => $produto, 'produto' => $produto, 'tag' => $tag,
                'planejado' => $planejado, 'estoque_virtual_base' => 0, 'estoque_fisico' => 0,
                'consumo_virtual' => 0, 'consumo_fisico' => 0, 'estoque_virtual_atual' => 0, 'dif_estoque' => 0, 'perda_real' => 0,
                'taxa_perda' => 0, 'acuracidade' => 1, 'status' => 'CONFORME', 'acao' => 'OK', 'obs' => '', 'origem_cadastro' => 'manual'];
            $mudou = true;
        }
    }
    if ($mudou) {
        estoque_planilha_gravar($dados);
    }
    return $mudou;
}

// Próxima TAG livre de fixador novo: FG### (fixador geral) ou FJ### (fixador de joist), contando o cadastro e a planilha.
function proximo_codigo_fixador($prefixo)
{
    $cods = q('SELECT codigo FROM materiais')->fetchAll(PDO::FETCH_COLUMN);
    $dados = estoque_planilha_ler();
    if ($dados) {
        foreach ([$dados['materiais'] ?? [], $dados['remessas']['itens'] ?? [], $dados['consumo_fisico']['itens'] ?? [], $dados['inventario'] ?? []] as $lista) {
            foreach ($lista as $it) {
                $cods[] = $it['tag'] ?? '';
            }
        }
    }
    $max = 0;
    foreach ($cods as $c) {
        if (preg_match('/^' . $prefixo . '(\d+)$/', mb_strtoupper(trim((string)$c)), $r)) {
            $max = max($max, (int)$r[1]);
        }
    }
    return sprintf('%s%03d', $prefixo, $max + 1);
}

function tag_existe($tag)
{
    if (q('SELECT id FROM materiais WHERE codigo = ? LIMIT 1', [$tag])->fetch()) {
        return true;
    }
    $dados = estoque_planilha_ler();
    foreach (($dados['materiais'] ?? []) as $it) {
        if (estoque_tag($it['tag'] ?? '') === $tag) {
            return true;
        }
    }
    return false;
}

// Ao excluir o cadastro, sai o que foi criado por ele (se ninguém lançou consumo nesse fixador).
function estoque_remover_fixador_cadastrado($codigo)
{
    $tag = estoque_tag($codigo);
    $dados = $tag === '' ? null : estoque_planilha_ler();
    if ($dados === null) {
        return;
    }
    $n0 = count($dados['consumo_fisico']['itens'] ?? []) + count($dados['inventario'] ?? []) + count($dados['remessas']['itens'] ?? []) + count($dados['materiais'] ?? []);
    $dados['consumo_fisico']['itens'] = array_values(array_filter($dados['consumo_fisico']['itens'] ?? [], function ($it) use ($tag) {
        return !(estoque_tag($it['tag'] ?? '') === $tag && ($it['origem_cadastro'] ?? '') === 'manual' && (float)($it['total_consumo'] ?? 0) == 0);
    }));
    $dados['inventario'] = array_values(array_filter($dados['inventario'] ?? [], function ($it) use ($tag) {
        return !(estoque_tag($it['tag'] ?? '') === $tag && ($it['origem_cadastro'] ?? '') === 'manual');
    }));
    $dados['remessas']['itens'] = array_values(array_filter($dados['remessas']['itens'] ?? [], function ($it) use ($tag) {
        return !(estoque_tag($it['tag'] ?? '') === $tag && ($it['origem_cadastro'] ?? '') === 'manual' && (float)($it['total_recebido'] ?? 0) == 0);
    }));
    $dados['materiais'] = array_values(array_filter($dados['materiais'] ?? [], function ($it) use ($tag) {
        return !(estoque_tag($it['tag'] ?? '') === $tag && ($it['origem_cadastro'] ?? '') === 'manual' && (float)($it['chegou'] ?? 0) == 0);
    }));
    if (count($dados['consumo_fisico']['itens']) + count($dados['inventario']) + count($dados['remessas']['itens']) + count($dados['materiais']) !== $n0) {
        estoque_planilha_gravar($dados);
    }
}

function acao_registro(array $corpo)
{
    $specs = tabelas_spec();
    $tabela = $corpo['tabela'] ?? '';
    if (!isset($specs[$tabela])) {
        throw new ErroValidacao('Tabela inválida.');
    }
    if (in_array($tabela, ['bm_fechamentos', 'bm_fech_atividades'], true)) {
        throw new ErroValidacao('O fechamento do BM é gravado por Medição (BM) > Fechar BM / Reabrir.');
    }
    $id = isset($corpo['linha']) && $corpo['linha'] !== null ? (int)$corpo['linha'] : null;
    if ($id !== null && !q("SELECT id FROM $tabela WHERE id = ?", [$id])->fetch()) {
        throw new ErroValidacao('Registro não encontrado. Recarregue a tela.');
    }
    if (!empty($corpo['excluir'])) {
        if ($tabela === 'materiais') {
            $matExcluir = q('SELECT codigo FROM materiais WHERE id = ?', [$id])->fetch();
            q("DELETE FROM $tabela WHERE id = ?", [$id]);
            if ($matExcluir && !empty($matExcluir['codigo'])) {
                q('DELETE FROM estoque_remessas WHERE codigo = ? AND documento = ? AND (quantidade IS NULL OR quantidade = 0)', [$matExcluir['codigo'], 'CADASTRO AUTOMÁTICO']);
                estoque_remover_fixador_cadastrado($matExcluir['codigo']);
            }
            return 1;
        }
        q("DELETE FROM $tabela WHERE id = ?", [$id]);
        return 1;
    }
    $campos = is_array($corpo['campos'] ?? null) ? $corpo['campos'] : [];
    if ($tabela === 'usos') {
        $l = numero($campos['litros'] ?? null);
        $p = numero($campos['preco_litro'] ?? null);
        if ($l && $p && empty($campos['custo_combustivel'])) {
            $campos['custo_combustivel'] = round($l * $p, 2);
        }
    }
    if ($tabela === 'materiais' && $id === null && material_eh_fixador($campos)) {
        // Fixador novo: TAG padronizada FG### (geral) ou FJ### (joist), gerada quando vazia e conferida quando digitada.
        $campos['tipo_material'] = 'FIXADOR';
        $cod = estoque_tag($campos['codigo'] ?? '');
        if ($cod === '') {
            $txt = mb_strtoupper(($campos['material'] ?? '') . ' ' . ($campos['etapa'] ?? '') . ' ' . ($campos['servico'] ?? '') . ' ' . ($campos['local'] ?? '') . ' ' . ($campos['obs'] ?? ''));
            $cod = proximo_codigo_fixador(mb_strpos($txt, 'JOIST') !== false ? 'FJ' : 'FG');
        } elseif (preg_match('/^(FG|FJ)[\s-]*0*(\d{1,3})$/', $cod, $r) && (int)$r[2] > 0) {
            $cod = sprintf('%s%03d', $r[1], (int)$r[2]);
        } else {
            throw new ErroValidacao('A TAG de fixador novo deve ser FG### (fixador geral) ou FJ### (fixador de joist), ex.: FG030. Deixe o campo vazio para gerar a próxima automaticamente.');
        }
        if (tag_existe($cod)) {
            throw new ErroValidacao("Já existe um material com a TAG $cod.");
        }
        $campos['codigo'] = $cod;
    }
    if ($tabela === 'materiais') {
        if (empty($campos['codigo']) && $id === null) {
            if (obra_preserva_identidade_ifc()) throw new ErroValidacao('Informe a TAG original do material. Somente fixadores recebem TAG automática nesta obra.');
            $existentes = q('SELECT codigo FROM materiais')->fetchAll(PDO::FETCH_COLUMN);
            for ($i = 1; in_array(sprintf('MAT-%03d', $i), $existentes, true); $i++) {
            }
            $campos['codigo'] = sprintf('MAT-%03d', $i);
        }
        if (!empty($campos['tipo_material'])) {
            $campos['tipo_material'] = mb_strtoupper(trim((string)$campos['tipo_material']));
        }
        if (empty($campos['tipo_material'])) {
            $txt = mb_strtoupper(($campos['codigo'] ?? '') . ' ' . ($campos['material'] ?? '') . ' ' . ($campos['obs'] ?? ''));
            $campos['tipo_material'] = (strpos($txt, 'FIXADOR') !== false || strpos($txt, 'PARAFUS') !== false || strpos($txt, 'CHUMBADOR') !== false || strpos($txt, 'ARRUELA') !== false || strpos($txt, 'PORCA') !== false) ? 'FIXADOR' : 'ESTRUTURA';
        }
    }
    if ($tabela === 'movimentos' && !empty($campos['tipo'])) {
        $campos['tipo'] = mb_strtoupper($campos['tipo']);
        if (!in_array($campos['tipo'], ['ENTRADA', 'SAÍDA', 'AJUSTE'], true)) {
            throw new ErroValidacao('Tipo de movimentação deve ser ENTRADA, SAÍDA ou AJUSTE.');
        }
    }
    if (in_array($tabela, ['bm_periodos', 'bm_apontamentos', 'bm_deducoes'], true) && !empty($campos['empresa'])) {
        $campos['empresa'] = mb_strtoupper(trim($campos['empresa']));
        if (!q('SELECT id FROM empresas WHERE nome = ?', [$campos['empresa']])->fetch()) {
            throw new ErroValidacao('Empresa inválida.');
        }
    }
    if ($tabela === 'bm_periodos' && empty($campos['corte'])) {
        throw new ErroValidacao('Informe a data de corte do BM.');
    }
    if ($tabela === 'bm_apontamentos') {
        if (isset($campos['quantidade']) && (numero($campos['quantidade']) ?? 0) < 0) {
            throw new ErroValidacao('Quantidade não pode ser negativa.');
        }
        if (!q('SELECT id FROM bm_atividades WHERE codigo = ?', [$campos['codigo'] ?? ''])->fetch()) {
            throw new ErroValidacao('Atividade não encontrada no catálogo do BM.');
        }
    }
    if ($tabela === 'bm_deducoes') {
        $campos['tipo'] = mb_strtoupper((string)($campos['tipo'] ?? 'OUTROS'));
        $campos['contrato'] = mb_strtoupper((string)($campos['contrato'] ?? 'RÓTULA'));
        if (!in_array($campos['contrato'], ['RÓTULA', 'QPC', 'AMBOS'], true)) {
            throw new ErroValidacao('Contrato deve ser RÓTULA, QPC ou AMBOS.');
        }
    }
    $vals = [];
    foreach ($specs[$tabela] as $c => $tipo) {
        if (!array_key_exists($c, $campos)) {
            continue;
        }
        $v = $campos[$c];
        if ($v === null || (is_string($v) && trim($v) === '')) {
            $vals[$c] = null;
        } elseif ($tipo === 'num') {
            $n = numero($v);
            if ($n === null) {
                throw new ErroValidacao("Valor numérico inválido em '$c': $v");
            }
            $vals[$c] = $n;
        } elseif ($tipo === 'data') {
            if (!data_valida($v)) {
                throw new ErroValidacao("Data inválida em '$c'.");
            }
            $vals[$c] = $v;
        } else {
            $vals[$c] = mb_substr(trim((string)$v), 0, $tipo === 'longo' ? 4000 : 255);
        }
    }
    $resultado = gravar_linha($tabela, $id, $vals);
    if ($tabela === 'materiais' && $id === null && !empty($vals['codigo'])) {
        $exRem = q('SELECT id FROM estoque_remessas WHERE codigo = ? AND (documento = ? OR documento IS NULL) LIMIT 1', [$vals['codigo'], 'CADASTRO AUTOMÁTICO'])->fetch();
        if (!$exRem) {
            gravar_linha('estoque_remessas', null, [
                'data' => date('Y-m-d'),
                'codigo' => $vals['codigo'],
                'descricao' => $vals['material'] ?? $vals['codigo'],
                'quantidade' => 0,
                'documento' => 'CADASTRO AUTOMÁTICO',
                'fornecedor' => $vals['fornecedor'] ?? null,
                'obs' => 'Criado automaticamente ao cadastrar o material. Lance a quantidade quando a remessa chegar.'
            ]);
        }
    }
    if ($tabela === 'materiais') {
        $mat = $id !== null
            ? q('SELECT codigo, material, tipo_material, local, etapa, servico, obs, saldo_inicial FROM materiais WHERE id = ?', [$id])->fetch()
            : q('SELECT codigo, material, tipo_material, local, etapa, servico, obs, saldo_inicial FROM materiais WHERE codigo = ? ORDER BY id DESC LIMIT 1', [$vals['codigo'] ?? ''])->fetch();
        if ($mat) {
            estoque_incluir_cadastro($mat);
        }
    }
    // Propagação bidirecional: alteração de cliente.qtd (escopo do contrato) replica em servicos.escopo
    // para que apontamento e lançamento enxerguem o mesmo valor de meta na grade de produção.
    if ($tabela === 'cliente' && array_key_exists('qtd', $vals) && $id !== null) {
        $cli = q_global('SELECT servico, frente FROM cliente WHERE id = ?', [$id])->fetch(PDO::FETCH_ASSOC);
        if ($cli && !empty($cli['servico'])) {
            $obraId = obra_atual_id();
            if ($cli['frente'] !== null) {
                q_global(
                    'UPDATE servicos s JOIN empresas e ON e.id = s.empresa_id
                     SET s.escopo = ? WHERE e.obra_id = ? AND s.nome = ? AND s.frente = ?',
                    [$vals['qtd'], $obraId, $cli['servico'], $cli['frente']]
                );
            } else {
                q_global(
                    'UPDATE servicos s JOIN empresas e ON e.id = s.empresa_id
                     SET s.escopo = ? WHERE e.obra_id = ? AND s.nome = ? AND (s.frente IS NULL OR s.frente NOT LIKE ?)',
                    [$vals['qtd'], $obraId, $cli['servico'], 'GALPÃO F%']
                );
            }
        }
    }
    return $resultado;
}

function acao_bm_apontar(array $corpo)
{
    $n = 0;
    foreach (($corpo['alteracoes'] ?? []) as $a) {
        $emp = (string)($a['empresa'] ?? '');
        $cod = (string)($a['codigo'] ?? '');
        $data = (string)($a['data'] ?? '');
        $atv = q('SELECT controle, empresa FROM bm_atividades WHERE codigo = ?', [$cod])->fetch();
        if (!$atv || $atv['empresa'] !== $emp) {
            throw new ErroValidacao("Atividade inválida para $emp: $cod");
        }
        if (!empty($atv['controle'])) {
            throw new ErroValidacao("A atividade $cod é lançada pela coluna '{$atv['controle']}' do controle de produção.");
        }
        if (!data_valida($data)) {
            throw new ErroValidacao("Data inválida: $data");
        }
        $q = ($a['quantidade'] ?? null) === null || $a['quantidade'] === '' ? null : numero($a['quantidade']);
        if ($q !== null && $q < 0) {
            throw new ErroValidacao('Quantidade não pode ser negativa.');
        }
        $ex = q('SELECT id FROM bm_apontamentos WHERE empresa = ? AND codigo = ? AND data = ?', [$emp, $cod, $data])->fetch();
        if ($q === null) {
            if ($ex) {
                q('DELETE FROM bm_apontamentos WHERE id = ?', [$ex['id']]);
                $n++;
            }
        } elseif ($ex) {
            q('UPDATE bm_apontamentos SET quantidade = ? WHERE id = ?', [$q, $ex['id']]);
            $n++;
        } else {
            q('INSERT INTO bm_apontamentos (data, empresa, codigo, quantidade) VALUES (?, ?, ?, ?)', [$data, $emp, $cod, $q]);
            $n++;
        }
    }
    return $n;
}

function acao_bm_fechar(array $corpo)
{
    $emp = (string)($corpo['empresa'] ?? '');
    $n = numero($corpo['bm'] ?? null);
    if ($n === null || !q('SELECT id FROM empresas WHERE nome = ?', [$emp])->fetch()) {
        throw new ErroValidacao('Empresa ou número do BM inválido.');
    }
    $n = (int)$n;
    $periodos = [];
    foreach (q('SELECT bm, corte FROM bm_periodos WHERE empresa = ? AND bm IS NOT NULL AND corte IS NOT NULL', [$emp])->fetchAll() as $p) {
        $periodos[(int)$p['bm']] = $p['corte'];
    }
    if (!isset($periodos[$n])) {
        throw new ErroValidacao("Cadastre a data de corte do BM$n em Períodos e deduções antes de fechar.");
    }
    $fechados = array_map('intval', q('SELECT bm FROM bm_fechamentos WHERE empresa = ?', [$emp])->fetchAll(PDO::FETCH_COLUMN));
    if (in_array($n, $fechados, true)) {
        throw new ErroValidacao("O BM$n já está fechado.");
    }
    foreach (array_keys($periodos) as $k) {
        if ($k < $n && !in_array($k, $fechados, true)) {
            throw new ErroValidacao('Feche os BMs anteriores antes deste.');
        }
    }
    $ativs = is_array($corpo['atividades'] ?? null) ? $corpo['atividades'] : [];
    $catalogo = q('SELECT codigo FROM bm_atividades WHERE empresa = ?', [$emp])->fetchAll(PDO::FETCH_COLUMN);
    if (!$ativs) {
        throw new ErroValidacao('Atividades do fechamento inválidas.');
    }
    foreach ($ativs as $a) {
        if (!in_array($a['codigo'] ?? '', $catalogo, true)) {
            throw new ErroValidacao('Atividades do fechamento inválidas.');
        }
    }
    if (!data_valida((string)($corpo['fechado_em'] ?? ''))) {
        throw new ErroValidacao('Data de fechamento inválida.');
    }
    q('INSERT INTO bm_fechamentos (empresa, bm, fechado_em, equip, comb, litros) VALUES (?, ?, ?, ?, ?, ?)',
        [$emp, $n, $corpo['fechado_em'], round(numero($corpo['equip'] ?? 0) ?: 0, 2), round(numero($corpo['comb'] ?? 0) ?: 0, 2), numero($corpo['litros'] ?? 0) ?: 0]);
    foreach ($ativs as $a) {
        q('INSERT INTO bm_fech_atividades (empresa, bm, codigo, item, realizado, qtd, peso, valor_qpc, valor_rotula) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [$emp, $n, $a['codigo'], $a['item'] ?? null, numero($a['realizado'] ?? 0) ?: 0, numero($a['qtd'] ?? null), numero($a['peso'] ?? null),
                numero($a['valor_qpc'] ?? null), numero($a['valor_rotula'] ?? null)]);
    }
    return count($ativs) + 1;
}

function acao_bm_reabrir(array $corpo)
{
    $emp = (string)($corpo['empresa'] ?? '');
    $n = numero($corpo['bm'] ?? null);
    $fechados = array_map('intval', q('SELECT bm FROM bm_fechamentos WHERE empresa = ?', [$emp])->fetchAll(PDO::FETCH_COLUMN));
    if ($n === null || !in_array((int)$n, $fechados, true)) {
        throw new ErroValidacao('Este BM não está fechado.');
    }
    foreach ($fechados as $k) {
        if ($k > (int)$n) {
            throw new ErroValidacao('Reabra primeiro os BMs posteriores.');
        }
    }
    q('DELETE FROM bm_fech_atividades WHERE empresa = ? AND bm = ?', [$emp, (int)$n]);
    q('DELETE FROM bm_fechamentos WHERE empresa = ? AND bm = ?', [$emp, (int)$n]);
    return 1;
}

function acao_bm_semear()
{
    throw new ErroValidacao('O catálogo do BM chega com a importação dos dados do programa local (Administração → Importar dados).');
}

function acao_importar_mensal()
{
    throw new ErroValidacao('A importação das abas mensais é feita no programa local (planilha). Depois use Administração → Importar dados.');
}

// ------------------------------------------------- data de referência e materiais do IFC

function acao_referencia(array $corpo)
{
    $d = (string)($corpo['data'] ?? '');
    if (!data_valida($d)) {
        throw new ErroValidacao('Data inválida.');
    }
    sistema_gravar('referencia', $d);
    return 1;
}

function acao_semear_materiais()
{
    $regras = carregar_regras_baixa();
    if (!$regras || empty($regras['consumo_por_servico'])) {
        throw new ErroValidacao('Arquivo regras_baixa.json não encontrado ou sem consumo_por_servico.');
    }
    $existentes = q('SELECT codigo FROM materiais')->fetchAll(PDO::FETCH_COLUMN);
    $novos = [];
    foreach ($regras['consumo_por_servico'] as $servico => $conf) {
        if (!is_array($conf)) {
            continue;
        }
        foreach (($conf['itens'] ?? []) as $item) {
            $cod = (string)($item['codigo'] ?? '');
            if ($cod === '' || isset($novos[$cod]) || in_array($cod, $existentes, true)) {
                continue;
            }
            $novos[$cod] = ['codigo' => $cod, 'material' => (string)($item['descricao'] ?? $cod), 'unidade' => 'UN',
                'servico' => (string)$servico, 'coef' => 0,
                'obs' => 'Cadastrado automaticamente via regras_baixa.json (baixa automática por movimentação)'];
        }
    }
    if (!$novos) {
        return ['celulas' => 0, 'materiais_criados' => 0, 'msg' => 'Todos os materiais do IFC já estão cadastrados.'];
    }
    foreach ($novos as $campos) {
        gravar_linha('materiais', null, $campos);
    }
    return ['celulas' => count($novos), 'materiais_criados' => count($novos)];
}

// ------------------------------------------------- estoque da planilha (remessas e consumo físico)

function itens_do_corpo(array $corpo)
{
    $itens = $corpo['itens'] ?? null;
    if ($itens === null) {
        $itens = [$corpo];
    }
    if (!is_array($itens) || !$itens) {
        throw new ErroValidacao('Informe ao menos um item.');
    }
    return $itens;
}

function qtd_positiva(array $item, $n)
{
    $q = numero($item['quantidade'] ?? null);
    if ($q === null || $q <= 0) {
        throw new ErroValidacao("Item $n: quantidade deve ser maior que zero.");
    }
    return $q;
}

function estoque_material(array &$dados, $tag)
{
    foreach ($dados['materiais'] as $i => $m) {
        if (($m['tag'] ?? '') === $tag) {
            return $i;
        }
    }
    return null;
}

// Remessa de CARGA (estrutura) ou de FIXADOR: são pedidos/entregas diferentes, então cada remessa tem um tipo
// (remessas.tipos[nome]); remessa antiga sem tipo continua valendo e a tela deduz pelo que ela tem.
function remessa_tag_eh_fixador(array $dados, $tag)
{
    $i = estoque_material($dados, $tag);
    $m = $i !== null ? $dados['materiais'][$i] : [];
    if (!$m) {
        $m = q('SELECT codigo, material, tipo_material, obs FROM materiais WHERE codigo = ? LIMIT 1', [$tag])->fetch() ?: [];
    }
    return material_eh_fixador(['tipo_material' => $m['tipo_material'] ?? '', 'codigo' => $tag, 'material' => $m['material'] ?? ($m['produto'] ?? ''), 'obs' => $m['obs'] ?? '', 'tipo_editado' => $m['tipo_editado'] ?? false]);
}

function acao_estoque_remessa(array $corpo)
{
    $dados = estoque_planilha_ler();
    if ($dados === null) {
        throw new ErroValidacao('Estoque da planilha não importado.');
    }
    $nome = trim((string)($corpo['remessa'] ?? ''));
    if ($nome === '') {
        throw new ErroValidacao('Nome da remessa é obrigatório.');
    }
    $original = trim((string)($corpo['original_remessa'] ?? ''));
    $substituir = !empty($corpo['substituir']);
    $tipoRem = mb_strtoupper(trim((string)($corpo['tipo'] ?? '')));
    if ($tipoRem !== '' && !in_array($tipoRem, ['CARGA', 'FIXADOR'], true)) {
        throw new ErroValidacao('Tipo de remessa inválido (CARGA ou FIXADOR).');
    }
    $tiposRem = is_array($dados['remessas']['tipos'] ?? null) ? $dados['remessas']['tipos'] : [];
    $tipoAtual = $tiposRem[$substituir && $original !== '' ? $original : $nome] ?? '';
    if ($tipoRem !== '' && $tipoAtual !== '' && $tipoAtual !== $tipoRem) {
        throw new ErroValidacao('A remessa "' . ($substituir && $original !== '' ? $original : $nome) . '" é de ' . ($tipoAtual === 'FIXADOR' ? 'fixador' : 'carga') . '. Use outro nº para a remessa de ' . ($tipoRem === 'FIXADOR' ? 'fixador' : 'carga') . '.');
    }
    if ($tipoRem !== '' && $tipoAtual === '' && !$substituir && in_array($nome, $dados['remessas']['colunas'] ?? [], true)) {
        $existeOutro = false;
        foreach ($dados['remessas']['itens'] as $it0) {
            if (!empty($it0['qtd_por_remessa'][$nome]) && remessa_tag_eh_fixador($dados, $it0['tag'] ?? '') !== ($tipoRem === 'FIXADOR')) {
                $existeOutro = true;
                break;
            }
        }
        if ($existeOutro) {
            throw new ErroValidacao('Já existe uma remessa "' . $nome . '" do outro tipo. Use outro nº.');
        }
    }
    if ($substituir) {
        $alvo = $original !== '' ? $original : $nome;
        if (!in_array($alvo, $dados['remessas']['colunas'] ?? [], true)) {
            throw new ErroValidacao('Remessa original não encontrada para edição.');
        }
        if ($alvo !== $nome) {
            foreach ($dados['remessas']['colunas'] as $idx => $col) {
                if ($col === $alvo) { $dados['remessas']['colunas'][$idx] = $nome; break; }
            }
            if (isset($dados['remessas']['datas'][$alvo]) && !isset($dados['remessas']['datas'][$nome])) {
                $dados['remessas']['datas'][$nome] = $dados['remessas']['datas'][$alvo];
            }
            unset($dados['remessas']['datas'][$alvo]);
            if (isset($tiposRem[$alvo])) {
                $tiposRem[$nome] = $tiposRem[$alvo];
                unset($tiposRem[$alvo]);
            }
            foreach ($dados['remessas']['itens'] as &$it0) {
                if (isset($it0['qtd_por_remessa'][$alvo]) && !isset($it0['qtd_por_remessa'][$nome])) {
                    $it0['qtd_por_remessa'][$nome] = $it0['qtd_por_remessa'][$alvo];
                }
                unset($it0['qtd_por_remessa'][$alvo]);
            }
            unset($it0);
        }
        foreach ($dados['remessas']['itens'] as &$it0) {
            // com tipo informado só limpa os itens do mesmo tipo (remessa antiga mista não perde o outro tipo)
            if ($tipoRem === '' || remessa_tag_eh_fixador($dados, $it0['tag'] ?? '') === ($tipoRem === 'FIXADOR')) {
                unset($it0['qtd_por_remessa'][$nome]);
            }
        }
        unset($it0);
    }
    $porTag = [];
    foreach ($dados['remessas']['itens'] as $i => $it) {
        $porTag[$it['tag']] = $i;
    }
    $lancamentos = [];
    foreach (itens_do_corpo($corpo) as $k => $it) {
        $n = $k + 1;
        $tag = estoque_tag($it['tag'] ?? '');
        if ($tag === '') {
            throw new ErroValidacao("Item $n: escolha a TAG do material.");
        }
        if (!isset($porTag[$tag])) {
            $matCad = q('SELECT codigo, material, unidade, tipo_material, local, etapa, servico, saldo_inicial FROM materiais WHERE codigo = ? LIMIT 1', [$tag])->fetch();
            if (!$matCad) {
                throw new ErroValidacao("Item $n: TAG $tag não existe nas remessas nem no cadastro de materiais.");
            }
            $novoItem = [
                'tag' => $tag,
                'material' => $matCad['material'] ?: $tag,
                'produto' => $matCad['material'] ?: $tag,
                'etapa' => $matCad['etapa'] ?: ($matCad['servico'] ?: 'CADASTRO MANUAL'),
                'qtd_por_remessa' => [],
                'total_recebido' => 0,
            ];
            $dados['remessas']['itens'][] = $novoItem;
            $porTag[$tag] = count($dados['remessas']['itens']) - 1;
            if (estoque_material($dados, $tag) === null) {
                $planejado = numero($matCad['saldo_inicial'] ?? null) ?: 0;
                $dados['materiais'][] = [
                    'tag' => $tag,
                    'material' => $matCad['material'] ?: $tag,
                    'produto' => $matCad['material'] ?: $tag,
                    'local' => $matCad['local'] ?: (($matCad['tipo_material'] ?? '') === 'FIXADOR' ? 'FIXADORES' : 'SUPRIMENTOS'),
                    'etapa' => $matCad['etapa'] ?: ($matCad['servico'] ?: 'CADASTRO MANUAL'),
                    'tipo_material' => $matCad['tipo_material'] ?: 'ESTRUTURA',
                    'planejado' => $planejado,
                    'chegou' => 0,
                    'consumido' => 0,
                    'estoque_pos_baixa' => 0,
                    'atendimento' => $planejado ? 0 : null,
                    'status_logistico' => $planejado ? 'Crítico' : 'Cadastrado',
                    'prioridade' => ($matCad['tipo_material'] ?? '') === 'FIXADOR' ? 'FIXADOR' : '',
                ];
            }
        }
        if ($tipoRem !== '' && remessa_tag_eh_fixador($dados, $tag) !== ($tipoRem === 'FIXADOR')) {
            throw new ErroValidacao("Item $n: a TAG $tag " . ($tipoRem === 'FIXADOR' ? 'não é fixador; lance-a numa remessa de carga.' : 'é fixador; lance-o numa remessa de fixador.'));
        }
        $lancamentos[$tag] = ($lancamentos[$tag] ?? 0) + qtd_positiva($it, $n);
    }
    if (!in_array($nome, $dados['remessas']['colunas'], true)) {
        $dados['remessas']['colunas'][] = $nome;
    }
    if ($tipoRem !== '') {
        $mista = false;   // remessa antiga com itens dos dois tipos continua sem tipo (aparece nas duas telas)
        foreach ($dados['remessas']['itens'] as $it0) {
            if (!empty($it0['qtd_por_remessa'][$nome]) && remessa_tag_eh_fixador($dados, $it0['tag'] ?? '') !== ($tipoRem === 'FIXADOR')) {
                $mista = true;
                break;
            }
        }
        if (!$mista) {
            $tiposRem[$nome] = $tipoRem;
        }
    }
    if ($tiposRem) {
        $dados['remessas']['tipos'] = $tiposRem;
    }
    // Datas opcionais da remessa (prevista chegada, emissão NF, chegada obra)
    $datasNova = is_array($corpo['datas'] ?? null) ? $corpo['datas'] : [];
    if (!empty(array_filter($datasNova))) {
        if (!isset($dados['remessas']['datas'])) { $dados['remessas']['datas'] = []; }
        $dados['remessas']['datas'][$nome] = [
            'prevista_chegada' => trim((string)($datasNova['prevista_chegada'] ?? '')),
            'emissao_nota'     => trim((string)($datasNova['emissao_nota'] ?? '')),
            'chegada_obra'     => trim((string)($datasNova['chegada_obra'] ?? '')),
        ];
    }
    foreach ($lancamentos as $tag => $qtd) {
        $item = &$dados['remessas']['itens'][$porTag[$tag]];
        $item['qtd_por_remessa'][$nome] = $substituir ? $qtd : (($item['qtd_por_remessa'][$nome] ?? 0) + $qtd);
        $item['total_recebido'] = array_sum($item['qtd_por_remessa']);
        $recebido = $item['total_recebido'];
        unset($item);
        $i = estoque_material($dados, $tag);
        if ($i !== null) {
            $mat = &$dados['materiais'][$i];
            $mat['chegou'] = $recebido;
            $mat['estoque_pos_baixa'] = $mat['chegou'] - ($mat['consumido'] ?? 0);
            $mat['atendimento'] = !empty($mat['planejado']) ? $mat['chegou'] / $mat['planejado'] : null;
            if ($mat['atendimento'] !== null && $mat['atendimento'] >= 1) {
                $mat['status_logistico'] = 'Atendido';
            } elseif ($mat['chegou'] > 0) {
                $mat['status_logistico'] = 'Recebimento Parcial';
            }
            unset($mat);
        }
    }
    foreach ($dados['remessas']['itens'] as &$itemRec) {
        $itemRec['total_recebido'] = array_sum($itemRec['qtd_por_remessa'] ?? []);
        $iMat = estoque_material($dados, $itemRec['tag'] ?? '');
        if ($iMat !== null) {
            $mat = &$dados['materiais'][$iMat];
            $mat['chegou'] = $itemRec['total_recebido'];
            $mat['estoque_pos_baixa'] = $mat['chegou'] - ($mat['consumido'] ?? 0);
            $mat['atendimento'] = !empty($mat['planejado']) ? $mat['chegou'] / $mat['planejado'] : null;
            if ($mat['atendimento'] !== null && $mat['atendimento'] >= 1) $mat['status_logistico'] = 'Atendido';
            elseif ($mat['chegou'] > 0) $mat['status_logistico'] = 'Recebimento Parcial';
            elseif (!empty($mat['planejado'])) $mat['status_logistico'] = 'Crítico';
            unset($mat);
        }
    }
    unset($itemRec);
    estoque_planilha_gravar($dados);
    return ['celulas' => count($lancamentos), 'salvos' => count($lancamentos), 'substituido' => $substituir];
}


// Edição de um item da aba Materiais (tipo, nome, produto, local, etapa e planejado), venha ele da planilha importada ou do cadastro.
// Grava na planilha de estoque (que manda na tela) e, se a TAG também está no cadastro, no cadastro; mantém Remessas, Consumo físico e Inventário coerentes.
// Excluir um item da aba Materiais (item da planilha importada e/ou do cadastro). Sem `forcar`, só sai o item que nunca recebeu nem consumiu nada.
function estoque_excluir_material(array $dados, $tag, $forcar)
{
    $cad = q('SELECT id FROM materiais WHERE codigo = ? LIMIT 1', [$tag])->fetch() ?: null;
    if (!$cad && estoque_material($dados, $tag) === null) {
        throw new ErroValidacao("Material $tag não encontrado.");
    }
    $mov = 0.0;
    foreach ($dados['materiais'] ?? [] as $m) {
        if (estoque_tag($m['tag'] ?? '') === $tag) {
            $mov += (float)($m['chegou'] ?? 0) + (float)($m['consumido'] ?? 0);
        }
    }
    foreach ($dados['remessas']['itens'] ?? [] as $it) {
        if (estoque_tag($it['tag'] ?? '') === $tag) {
            $mov += (float)($it['total_recebido'] ?? 0);
        }
    }
    foreach ($dados['consumo_fisico']['itens'] ?? [] as $it) {
        if (estoque_tag($it['tag'] ?? '') === $tag) {
            $mov += (float)($it['total_consumo'] ?? 0);
        }
    }
    if ($mov > 0 && !$forcar) {
        throw new ErroValidacao("A TAG $tag já tem recebimento ou consumo lançado; marque a opção de excluir também os itens com movimentação para apagá-la.");
    }
    $fora = function ($it) use ($tag) {
        return estoque_tag($it['tag'] ?? '') !== $tag;
    };
    $dados['materiais'] = array_values(array_filter($dados['materiais'] ?? [], $fora));
    $dados['remessas']['itens'] = array_values(array_filter($dados['remessas']['itens'] ?? [], $fora));
    $dados['consumo_fisico']['itens'] = array_values(array_filter($dados['consumo_fisico']['itens'] ?? [], $fora));
    $dados['inventario'] = array_values(array_filter($dados['inventario'] ?? [], $fora));
    estoque_planilha_gravar($dados);
    if ($cad) {
        q('DELETE FROM materiais WHERE id = ?', [$cad['id']]);
        q('DELETE FROM estoque_remessas WHERE codigo = ? AND documento = ? AND (quantidade IS NULL OR quantidade = 0)', [$tag, 'CADASTRO AUTOMÁTICO']);
    }
    return ['excluidos' => 1];
}

function acao_estoque_material(array $corpo)
{
    $tag = estoque_tag($corpo['tag'] ?? '');
    $c = is_array($corpo['campos'] ?? null) ? $corpo['campos'] : [];
    if ($tag === '') {
        throw new ErroValidacao('Informe a TAG do material.');
    }
    $dados = estoque_planilha_ler();
    if ($dados === null) {
        throw new ErroValidacao('Estoque da planilha não importado.');
    }
    if (!empty($corpo['excluir'])) {
        return estoque_excluir_material($dados, $tag, !empty($corpo['forcar']));
    }
    $cad = q('SELECT * FROM materiais WHERE codigo = ? LIMIT 1', [$tag])->fetch() ?: null;
    if (estoque_material($dados, $tag) === null) {
        if (!$cad) {
            throw new ErroValidacao("Material $tag não encontrado.");
        }
        estoque_incluir_cadastro($cad);   // cadastro que ainda não está na planilha entra primeiro
        $dados = estoque_planilha_ler();
    }
    $i = estoque_material($dados, $tag);
    if ($i === null) {
        throw new ErroValidacao("Material $tag não encontrado.");
    }
    $mat = $dados['materiais'][$i];
    $nome = array_key_exists('material', $c) ? trim((string)$c['material']) : (string)($mat['material'] ?? $tag);
    if ($nome === '') {
        throw new ErroValidacao('O nome do material não pode ficar vazio.');
    }
    $produto = array_key_exists('produto', $c) ? trim((string)$c['produto']) : (string)($mat['produto'] ?? $nome);
    $produto = $produto !== '' ? $produto : $nome;
    $local = array_key_exists('local', $c) ? trim((string)$c['local']) : (string)($mat['local'] ?? '');
    $etapa = array_key_exists('etapa', $c) ? trim((string)$c['etapa']) : (string)($mat['etapa'] ?? '');
    $tipo = array_key_exists('tipo_material', $c) ? mb_strtoupper(trim((string)$c['tipo_material'])) : mb_strtoupper((string)($mat['tipo_material'] ?? 'ESTRUTURA'));
    if ($tipo === '' || mb_strlen($tipo) > 40) {
        throw new ErroValidacao('Informe o tipo do material (ex.: ESTRUTURA, FIXADOR, JOIST, CONSUMO).');
    }
    $planejado = (float)($mat['planejado'] ?? 0);
    if (!array_key_exists('planejado', $c) && array_key_exists('saldo_inicial', $c)) {
        $c['planejado'] = $c['saldo_inicial'];   // o pop-up chama a quantidade planejada de saldo_inicial
    }
    if (array_key_exists('planejado', $c)) {
        $p = trim((string)$c['planejado']) === '' ? 0.0 : numero($c['planejado']);
        if ($p === null || $p < 0) {
            throw new ErroValidacao('Planejado deve ser um número maior ou igual a zero.');
        }
        $planejado = (float)$p;
    }
    // trocar entre fixador e carga não pode deixar o item recebido numa remessa do outro tipo
    $eraFix = material_eh_fixador(['tipo_material' => $mat['tipo_material'] ?? '', 'codigo' => $tag, 'material' => $mat['material'] ?? '', 'tipo_editado' => $mat['tipo_editado'] ?? false]);
    $viraFix = $tipo === 'FIXADOR';
    if ($eraFix !== $viraFix) {
        $tipos = is_array($dados['remessas']['tipos'] ?? null) ? $dados['remessas']['tipos'] : [];
        foreach ($dados['remessas']['itens'] ?? [] as $it) {
            if (estoque_tag($it['tag'] ?? '') !== $tag) {
                continue;
            }
            foreach ($it['qtd_por_remessa'] ?? [] as $rem => $q) {
                if ((float)$q > 0 && isset($tipos[$rem]) && ($tipos[$rem] === 'FIXADOR') !== $viraFix) {
                    throw new ErroValidacao("A TAG $tag já recebeu quantidade na remessa \"$rem\" (" . ($tipos[$rem] === 'FIXADOR' ? 'fixador' : 'carga') . "); mude o tipo só depois de corrigir essa remessa.");
                }
            }
        }
    }
    $m =& $dados['materiais'][$i];
    $m['material'] = $nome;
    $m['produto'] = $produto;
    $m['local'] = $local;
    $m['etapa'] = $etapa;
    $m['tipo_material'] = $tipo;
    $m['tipo_editado'] = true;
    $m['planejado'] = $planejado;
    $m['prioridade'] = $viraFix ? 'FIXADOR' : (($m['prioridade'] ?? '') === 'FIXADOR' ? '' : ($m['prioridade'] ?? ''));
    $chegou = (float)($m['chegou'] ?? 0);
    $m['atendimento'] = $planejado ? $chegou / $planejado : null;
    $m['status_logistico'] = ($planejado && $chegou / $planejado >= 1) ? 'Atendido' : ($chegou > 0 ? 'Recebimento Parcial' : ($planejado ? 'Crítico' : 'Cadastrado'));
    unset($m);
    foreach ($dados['remessas']['itens'] as &$r) {
        if (estoque_tag($r['tag'] ?? '') === $tag) {
            $r['material'] = $nome;
            $r['produto'] = $produto;
            $r['etapa'] = $etapa !== '' ? $etapa : ($r['etapa'] ?? '');
        }
    }
    unset($r);
    foreach ($dados['consumo_fisico']['itens'] ?? [] as $k => $r) {
        if (estoque_tag($r['tag'] ?? '') === $tag) {
            $dados['consumo_fisico']['itens'][$k]['produto'] = $produto;
        }
    }
    foreach ($dados['inventario'] ?? [] as $k => $r) {
        if (estoque_tag($r['tag'] ?? '') === $tag) {
            $dados['inventario'][$k]['material'] = $nome;
            $dados['inventario'][$k]['produto'] = $produto;
            $dados['inventario'][$k]['planejado'] = $planejado;
        }
    }
    estoque_planilha_gravar($dados);
    // campos que só o cadastro tem (o pop-up de edição é o mesmo do "+ Cadastrar material")
    $extra = [];
    foreach (['unidade' => 'txt', 'servico' => 'txt', 'empresa' => 'txt', 'coef' => 'num', 'data_saldo' => 'data', 'minimo' => 'num', 'fornecedor' => 'txt', 'prazo_reposicao' => 'num', 'obs' => 'txt'] as $k => $t) {
        if (!array_key_exists($k, $c)) {
            continue;
        }
        $v = $c[$k];
        if ($v === null || trim((string)$v) === '') {
            $extra[$k] = null;
        } elseif ($t === 'num') {
            $n = numero($v);
            if ($n === null) {
                throw new ErroValidacao("Valor numérico inválido em '$k'.");
            }
            $extra[$k] = $n;
        } elseif ($t === 'data') {
            if (!data_valida($v)) {
                throw new ErroValidacao("Data inválida em '$k'.");
            }
            $extra[$k] = $v;
        } else {
            $extra[$k] = mb_substr(trim((string)$v), 0, 255);
        }
    }
    $base = ['material' => $nome, 'tipo_material' => $tipo, 'local' => $local !== '' ? $local : null, 'etapa' => $etapa !== '' ? $etapa : null, 'saldo_inicial' => $planejado];
    if ($cad) {
        gravar_linha('materiais', (int)$cad['id'], $base + $extra);
    } elseif (array_filter($extra, function ($v) { return $v !== null; })) {
        gravar_linha('materiais', null, ['codigo' => $tag] + $base + $extra);   // só cria o cadastro se a pessoa preencheu algo que é do cadastro
    }
    if ($viraFix) {   // fixador também existe no Consumo físico e no Inventário
        estoque_incluir_cadastro(['codigo' => $tag, 'material' => $nome, 'local' => $local, 'etapa' => $etapa, 'tipo_material' => 'FIXADOR', 'saldo_inicial' => $planejado, 'tipo_editado' => true]);
    }
    return ['salvos' => 1];
}

function acao_estoque_remessa_datas(array $corpo)
{
    $dados = estoque_planilha_ler();
    if ($dados === null) {
        throw new ErroValidacao('Estoque da planilha não importado.');
    }
    $nome = trim((string)($corpo['remessa'] ?? ''));
    if ($nome === '') {
        throw new ErroValidacao('Nome da remessa é obrigatório.');
    }
    if (!in_array($nome, $dados['remessas']['colunas'] ?? [], true)) {
        throw new ErroValidacao('Remessa não encontrada.');
    }
    $datasNova = is_array($corpo['datas'] ?? null) ? $corpo['datas'] : [];
    if (!isset($dados['remessas']['datas'])) { $dados['remessas']['datas'] = []; }
    $dados['remessas']['datas'][$nome] = [
        'prevista_chegada' => trim((string)($datasNova['prevista_chegada'] ?? '')),
        'emissao_nota'     => trim((string)($datasNova['emissao_nota'] ?? '')),
        'chegada_obra'     => trim((string)($datasNova['chegada_obra'] ?? '')),
    ];
    estoque_planilha_gravar($dados);
    return ['salvos' => 1];
}

// Data (qualquer dia da semana) em que o consumo de uma semana nomeada foi retirado: serve para ligar a semana ao calendário nos relatórios.
function semana_consumo_data_valida($v)
{
    $v = trim((string)$v);
    if (!preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $v, $m) || !checkdate((int)$m[2], (int)$m[3], (int)$m[1])) {
        throw new ErroValidacao('Data da semana inválida: use o formato aaaa-mm-dd.');
    }
    return $v;
}

// Período do consumo (data inicial e final em que o material foi retirado). Guardado em consumo_fisico.semanas_periodos[semana] = {ini, fim};
// semanas_datas[semana] acompanha a data inicial (os relatórios leem por ela).
function semana_consumo_periodo($ini, $fim)
{
    $ini = semana_consumo_data_valida($ini);
    $fim = trim((string)$fim) === '' ? $ini : semana_consumo_data_valida($fim);
    if ($fim < $ini) {
        throw new ErroValidacao('O fim do período do consumo não pode ser anterior ao início.');
    }
    return ['ini' => $ini, 'fim' => $fim];
}
function semana_consumo_gravar_periodo(array &$dados, $semana, array $per)
{
    $ps = $dados['consumo_fisico']['semanas_periodos'] ?? [];
    $ps = is_array($ps) ? $ps : [];
    $ps[$semana] = $per;
    $dados['consumo_fisico']['semanas_periodos'] = $ps;
    $ds = $dados['consumo_fisico']['semanas_datas'] ?? [];
    $ds = is_array($ds) ? $ds : [];
    $ds[$semana] = $per['ini'];
    $dados['consumo_fisico']['semanas_datas'] = $ds;
}

function acao_estoque_consumo(array $corpo)
{
    $dados = estoque_planilha_ler();
    if ($dados === null) {
        throw new ErroValidacao('Estoque da planilha não importado.');
    }
    $semana = trim((string)($corpo['semana'] ?? ''));
    if ($semana === '') {
        throw new ErroValidacao('Semana é obrigatória.');
    }
    $porTag = [];
    foreach ($dados['consumo_fisico']['itens'] as $i => $it) {
        $porTag[$it['tag']] = $i;
    }
    $lancamentos = [];
    foreach (itens_do_corpo($corpo) as $k => $it) {
        $n = $k + 1;
        $tag = estoque_tag($it['tag'] ?? '');
        $empresa = mb_strtoupper(trim((string)($it['empresa'] ?? $corpo['empresa'] ?? '')));
        if ($tag === '') {
            throw new ErroValidacao("Item $n: escolha a TAG do material.");
        }
        if (!isset($porTag[$tag])) {
            $matCad = q('SELECT codigo, material, tipo_material, local, etapa, servico, obs, saldo_inicial FROM materiais WHERE codigo = ? LIMIT 1', [$tag])->fetch();
            if ($matCad && (material_eh_fixador($matCad) || obra_preserva_identidade_ifc())) {
                estoque_incluir_cadastro($matCad);
                $dados = estoque_planilha_ler();
                $porTag = [];
                foreach ($dados['consumo_fisico']['itens'] as $i => $it0) {
                    $porTag[estoque_tag($it0['tag'])] = $i;
                }
            }
        }
        if (!isset($porTag[$tag])) {
            throw new ErroValidacao("Item $n: TAG $tag não existe no consumo. Escolha uma da lista.");
        }
        if (!in_array($empresa, estoque_empresas_consumo(), true)) {
            throw new ErroValidacao("Item $n: escolha uma empresa cadastrada nesta obra.");
        }
        $chave = "$tag|$empresa";
        $lancamentos[$chave] = ($lancamentos[$chave] ?? 0) + qtd_positiva($it, $n);
    }
    $semanaNova = !in_array($semana, $dados['consumo_fisico']['semanas'], true);
    $iniP = trim((string)($corpo['periodo_ini'] ?? $corpo['data_semana'] ?? ''));
    if ($semanaNova && $iniP === '') {
        throw new ErroValidacao('Informe o período do consumo (data inicial e final) da semana.');
    }
    $periodo = $iniP !== '' ? semana_consumo_periodo($iniP, $corpo['periodo_fim'] ?? '') : null;
    if ($semanaNova) {
        $dados['consumo_fisico']['semanas'][] = $semana;
    }
    if ($periodo) {
        semana_consumo_gravar_periodo($dados, $semana, $periodo);
    }
    foreach ($lancamentos as $chave => $qtd) {
        list($tag, $empresa) = explode('|', $chave);
        $item = &$dados['consumo_fisico']['itens'][$porTag[$tag]];
        if (!isset($item['consumo_semanas'][$semana])) {
            $item['consumo_semanas'][$semana] = ['EJ' => 0, 'CMM' => 0, 'total' => 0];
        }
        $e = &$item['consumo_semanas'][$semana];
        $e[$empresa] = ($e[$empresa] ?? 0) + $qtd;
        $e['total'] = ($e['EJ'] ?? 0) + ($e['CMM'] ?? 0);
        unset($e);
        $item['total_consumo'] = array_sum(array_column($item['consumo_semanas'], 'total'));
        $consumo = $item['total_consumo'];
        unset($item);
        $i = estoque_material($dados, $tag);
        if ($i !== null) {
            $dados['materiais'][$i]['consumido'] = $consumo;
            $dados['materiais'][$i]['estoque_pos_baixa'] = ($dados['materiais'][$i]['chegou'] ?? 0) - $consumo;
        }
    }
    estoque_planilha_gravar($dados);
    return ['celulas' => count($lancamentos), 'salvos' => count($lancamentos)];
}

// Edição direta de uma célula do Consumo físico (TAG x semana x empresa): grava o valor informado no lugar do anterior.
// Quantidade vazia ou zero limpa a célula. Recalcula o total da semana, o total do item e o consumido do material.
function acao_estoque_consumo_celula(array $corpo)
{
    $dados = estoque_planilha_ler();
    if ($dados === null) {
        throw new ErroValidacao('Estoque da planilha não importado.');
    }
    $tag = estoque_tag($corpo['tag'] ?? '');
    $semana = trim((string)($corpo['semana'] ?? ''));
    $empresa = mb_strtoupper(trim((string)($corpo['empresa'] ?? '')));
    if ($tag === '' || $semana === '') {
        throw new ErroValidacao('Informe a TAG e a semana.');
    }
    if (!in_array($empresa, estoque_empresas_consumo(), true)) {
        throw new ErroValidacao('Escolha uma empresa cadastrada nesta obra.');
    }
    $q = ($corpo['quantidade'] ?? null) === null || $corpo['quantidade'] === '' ? 0 : numero($corpo['quantidade']);
    if ($q === null || $q < 0) {
        throw new ErroValidacao('Quantidade inválida: use um número maior ou igual a zero.');
    }
    if (!in_array($semana, $dados['consumo_fisico']['semanas'] ?? [], true)) {
        throw new ErroValidacao("Semana '$semana' não existe no consumo. Use + Registrar consumo para criar uma semana nova.");
    }
    $idx = null;
    foreach ($dados['consumo_fisico']['itens'] as $i => $it) {
        if (estoque_tag($it['tag'] ?? '') === $tag) {
            $idx = $i;
            break;
        }
    }
    if ($idx === null) {
        $matCad = q('SELECT codigo, material, tipo_material, local, etapa, servico, obs, saldo_inicial FROM materiais WHERE codigo = ? LIMIT 1', [$tag])->fetch();
        if ($matCad && (material_eh_fixador($matCad) || obra_preserva_identidade_ifc())) {
            estoque_incluir_cadastro($matCad);
            $dados = estoque_planilha_ler();
            foreach ($dados['consumo_fisico']['itens'] as $i => $it) {
                if (estoque_tag($it['tag'] ?? '') === $tag) {
                    $idx = $i;
                    break;
                }
            }
        }
    }
    if ($idx === null) {
        throw new ErroValidacao("TAG $tag não existe no consumo.");
    }
    $item = &$dados['consumo_fisico']['itens'][$idx];
    if (!isset($item['consumo_semanas']) || !is_array($item['consumo_semanas'])) {
        $item['consumo_semanas'] = [];
    }
    $e = $item['consumo_semanas'][$semana] ?? ['EJ' => 0, 'CMM' => 0, 'total' => 0];
    $e[$empresa] = $q;
    $e['total'] = ($e['EJ'] ?? 0) + ($e['CMM'] ?? 0);
    if ($e['total'] > 0) {
        $item['consumo_semanas'][$semana] = $e;
    } else {
        unset($item['consumo_semanas'][$semana]);
    }
    $item['total_consumo'] = array_sum(array_column($item['consumo_semanas'], 'total'));
    $consumo = $item['total_consumo'];
    unset($item);
    $i = estoque_material($dados, $tag);
    if ($i !== null) {
        $dados['materiais'][$i]['consumido'] = $consumo;
        $dados['materiais'][$i]['estoque_pos_baixa'] = ($dados['materiais'][$i]['chegou'] ?? 0) - $consumo;
    }
    estoque_planilha_gravar($dados);
    return ['celulas' => 1, 'salvos' => 1, 'total_consumo' => $consumo];
}

// Edição de uma COLUNA (semana) do Consumo físico: renomeia a semana, ajusta os valores EJ/CMM de vários itens de uma vez ou exclui a semana.
// corpo: semana (atual), novo_nome (opcional), valores: [{tag, EJ, CMM}] (vazio/zero limpa), excluir: true.
function acao_estoque_consumo_semana(array $corpo)
{
    $dados = estoque_planilha_ler();
    if ($dados === null) {
        throw new ErroValidacao('Estoque da planilha não importado.');
    }
    $semana = trim((string)($corpo['semana'] ?? ''));
    $semanas = $dados['consumo_fisico']['semanas'] ?? [];
    $pos = array_search($semana, $semanas, true);
    if ($semana === '' || $pos === false) {
        throw new ErroValidacao("Semana '$semana' não existe no consumo.");
    }
    $excluir = !empty($corpo['excluir']);
    $novo = trim((string)($corpo['novo_nome'] ?? ''));
    if (!$excluir && $novo !== '' && $novo !== $semana) {
        if (in_array($novo, $semanas, true)) {
            throw new ErroValidacao("Já existe uma semana chamada '$novo'.");
        }
        if (mb_strlen($novo) > 80) {
            throw new ErroValidacao('Nome da semana muito longo (máximo 80 caracteres).');
        }
    } else {
        $novo = $semana;
    }
    $valores = [];
    foreach ((array)($corpo['valores'] ?? []) as $v) {
        $tag = estoque_tag($v['tag'] ?? '');
        if ($tag === '') {
            continue;
        }
        foreach (estoque_empresas_consumo() as $emp) {
            if (!array_key_exists($emp, $v)) {
                continue;
            }
            $q = $v[$emp] === null || $v[$emp] === '' ? 0 : numero($v[$emp]);
            if ($q === null || $q < 0) {
                throw new ErroValidacao("Quantidade inválida em $tag ($emp): use um número maior ou igual a zero.");
            }
            $valores[$tag][$emp] = $q;
        }
    }
    foreach ($dados['consumo_fisico']['itens'] as $i => $it) {
        $tag = estoque_tag($it['tag'] ?? '');
        $cs = isset($it['consumo_semanas']) && is_array($it['consumo_semanas']) ? $it['consumo_semanas'] : [];
        $novoCs = [];
        foreach ($cs as $nome => $e) {   // reconstrói mantendo a ordem das semanas
            if ($nome === $semana) {
                if ($excluir) {
                    continue;
                }
                $nome = $novo;
            }
            $novoCs[$nome] = $e;
        }
        if (!$excluir && isset($valores[$tag])) {
            $e = $novoCs[$novo] ?? ['EJ' => 0, 'CMM' => 0, 'total' => 0];
            foreach ($valores[$tag] as $emp => $q) {
                $e[$emp] = $q;
            }
            $e['total'] = ($e['EJ'] ?? 0) + ($e['CMM'] ?? 0);
            if ($e['total'] > 0) {
                $novoCs[$novo] = $e;
            } else {
                unset($novoCs[$novo]);
            }
        }
        $dados['consumo_fisico']['itens'][$i]['consumo_semanas'] = $novoCs ?: new stdClass();
        $total = array_sum(array_column($novoCs, 'total'));
        $dados['consumo_fisico']['itens'][$i]['total_consumo'] = $total;
        $m = estoque_material($dados, $tag);
        if ($m !== null) {
            $dados['materiais'][$m]['consumido'] = $total;
            $dados['materiais'][$m]['estoque_pos_baixa'] = ($dados['materiais'][$m]['chegou'] ?? 0) - $total;
        }
    }
    if ($excluir) {
        array_splice($semanas, $pos, 1);
    } else {
        $semanas[$pos] = $novo;
    }
    $dados['consumo_fisico']['semanas'] = array_values($semanas);
    $datas = $dados['consumo_fisico']['semanas_datas'] ?? [];
    $datas = is_array($datas) ? $datas : [];
    $pers = $dados['consumo_fisico']['semanas_periodos'] ?? [];
    $pers = is_array($pers) ? $pers : [];
    if ($excluir) {
        unset($datas[$semana], $pers[$semana]);
    } else {
        if ($novo !== $semana) {
            if (isset($datas[$semana])) {
                $datas[$novo] = $datas[$semana];
                unset($datas[$semana]);
            }
            if (isset($pers[$semana])) {
                $pers[$novo] = $pers[$semana];
                unset($pers[$semana]);
            }
        }
        $temP = array_key_exists('periodo_ini', $corpo);
        if ($temP || array_key_exists('data_semana', $corpo)) {
            $ini = trim((string)($temP ? $corpo['periodo_ini'] : $corpo['data_semana']));
            if ($ini === '') {
                unset($datas[$novo], $pers[$novo]);
            } else {
                $per = semana_consumo_periodo($ini, $temP ? ($corpo['periodo_fim'] ?? '') : ($pers[$novo]['fim'] ?? ''));
                $datas[$novo] = $per['ini'];
                $pers[$novo] = $per;
            }
        }
    }
    $dados['consumo_fisico']['semanas_datas'] = $datas;
    $dados['consumo_fisico']['semanas_periodos'] = $pers;
    estoque_planilha_gravar($dados);
    return ['semana' => $excluir ? null : $novo, 'excluida' => $excluir, 'itens_ajustados' => count($valores)];
}

// ------------------------------------------------- apontamento de montagem (joists e vigas)

// Retorna 'GALPÃO F2' para eixos 01-10 (Fase 2) e 'GALPÃO F1' para eixos 11-20 (Fase 1).
function frente_galpao($eixo) {
    return (int)$eixo < 11 ? 'GALPÃO F2' : 'GALPÃO F1';
}

// Soma `delta` na célula (empresa, serviço, dia) do controle de produção, que é de onde o BM,
// o cronograma e os dashboards leem a produção.
// $frente: quando informada, filtra o servicos pela frente correta (fase 1 vs fase 2).
function soma_producao($empresaNome, $servico, $data, $delta, array $usuario, $frente = null)
{
    $emp = q('SELECT * FROM empresas WHERE nome = ?', [$empresaNome])->fetch();
    if (!$emp) {
        throw new ErroValidacao("Empresa $empresaNome não existe no controle de produção.");
    }
    if (!empty($usuario['empresa']) && $usuario['empresa'] !== $emp['nome']) {
        throw new ErroValidacao('Seu usuário só pode apontar montagem da empresa ' . $usuario['empresa'] . '.');
    }
    // Lançamento é TOTAL (galpão inteiro): a fase (F1/F2) fica só no apontamento, para rastreio. A produção vai sempre
    // para a coluna principal do serviço (a que não é "GALPÃO F2").
    $linhas = q('SELECT col, frente FROM servicos WHERE empresa_id = ? AND nome = ? ORDER BY ordem, id', [$emp['id'], $servico])->fetchAll();
    $col = null;
    $colsF2 = [];
    foreach ($linhas as $l) {
        if (stripos((string)$l['frente'], 'GALPÃO F2') === 0) {
            $colsF2[] = $l['col'];
        } elseif ($col === null) {
            $col = $l['col'];
        }
    }
    if ($col === null && $colsF2) {
        $col = array_shift($colsF2);
    }
    if ($col) {   // o que já tiver caído em coluna "Fase 2" volta para o total
        foreach ($colsF2 as $c2) {
            foreach (q('SELECT data, valor_num FROM producao WHERE empresa_id = ? AND col = ? AND valor_num IS NOT NULL AND valor_txt IS NULL', [$emp['id'], $c2])->fetchAll() as $r) {
                $ja = (float)q('SELECT valor_num FROM producao WHERE empresa_id = ? AND data = ? AND col = ?', [$emp['id'], $r['data'], $col])->fetchColumn();
                q('DELETE FROM producao WHERE empresa_id = ? AND data = ? AND col IN (?, ?)', [$emp['id'], $r['data'], $col, $c2]);
                q('INSERT INTO producao (empresa_id, data, col, valor_num) VALUES (?, ?, ?, ?)', [$emp['id'], $r['data'], $col, $ja + (float)$r['valor_num']]);
            }
        }
    }
    if (!$col && stripos((string)$servico, 'PERFILAGEM') === 0) {   // o banco guarda "PERFILAÇÃO"; a tela mostra "PERFILAGEM DE TELHAS" (modelo.php)
        $col = q("SELECT col FROM servicos WHERE empresa_id = ? AND nome LIKE 'PERFILA%'", [$emp['id']])->fetchColumn();
    }
    if (!$col) {
        throw new ErroValidacao("{$emp['nome']} não tem o serviço $servico no controle de produção.");
    }
    $atual = q('SELECT valor_num, valor_txt FROM producao WHERE empresa_id = ? AND data = ? AND col = ?',
        [$emp['id'], $data, $col])->fetch();
    if ($atual && $atual['valor_txt'] !== null) {
        throw new ErroValidacao("A célula de $servico de {$emp['nome']} em $data contém texto. Corrija em Lançamentos.");
    }
    $anterior = (float)($atual['valor_num'] ?? 0);
    $novo = max(0, $anterior + $delta);
    q('DELETE FROM producao WHERE empresa_id = ? AND data = ? AND col = ?', [$emp['id'], $data, $col]);
    if ($novo > 0) {
        q('INSERT INTO producao (empresa_id, data, col, valor_num) VALUES (?, ?, ?, ?)', [$emp['id'], $data, $col, $novo]);
    }
    // devolve o lançamento para a tela poder mostrar onde foi parar
    return ['empresa' => $emp['nome'], 'servico' => $servico, 'col' => $col, 'data' => $data,
            'delta' => $delta, 'anterior' => $anterior, 'total' => $novo];
}

// Frentes montadas fora do plano das joists (fechamento lateral, marquise, contraventamento),
// com os trechos vindos do mapa extraído do IFC.
function tipos_frente()
{
    return ['FECHAMENTO' => 'fechamento', 'MARQUISE' => 'marquise', 'CONTRAVENTAMENTO' => 'contraventamento', 'TELHA' => 'telha', 'PERFILAGEM' => 'perfilagem', 'TELHAFECH' => 'telha_fechamento'];
}

// Telhas da cobertura (Globo Aços): cada telha corre do eixo A ao H (177,32 m) e ocupa 0,485 m entre eixos ao longo do comprimento do galpão
// (eixo 01 ao 20). Uma "célula" do mapa = uma telha, numerada de 0001 em diante a partir do eixo 01; apontar = +1 em "Instalação de telhas".
function frente_telhas(array $malha, $kind = 'telha')
{
    $comp = (int)($malha['comprimento_mm'] ?? 0) ?: 427500;
    $larg = 485;
    $n = (int)ceil($comp / $larg);
    $perfil = $kind === 'perfilagem';
    $cel = [];
    for ($i = 1; $i <= $n; $i++) {
        $cel[] = ['trecho' => sprintf('%04d', $i), 'pecas' => [$perfil ? 'PERFILAGEM' : 'TELHA' => 1], 'total' => 1];
    }
    return ['titulo' => $perfil ? 'Perfilagem de telhas — Globo Aços' : 'Instalação de telhas — Globo Aços',
        'servico' => $perfil ? 'PERFILAGEM DE TELHAS' : 'Instalação de telhas', 'empresa' => 'GLOBO AÇOS',
        'telha' => ['comprimento_m' => 177.32, 'largura_mm' => $larg, 'n' => $n, 'comprimento_galpao_mm' => $comp, 'm2_por_telha' => round(177.32 * $larg / 1000, 4),
            'codigo_bm' => $perfil ? 'GLO-3.2.1-01' : 'GLO-3.2.1-02', 'fase1_ini_mm' => (int)(($malha['eixos_mm'] ?? [])['11'] ?? 225000)],
        'partes' => [['id' => 'GLOBO', 'nome' => ($perfil ? 'Perfilagem' : 'Telhas') . ' do galpão (eixo A ao H)', 'celulas' => $cel, 'total' => $n]],
        'total' => $n, 'familias' => [$perfil ? 'PERFILAGEM' : 'TELHA']];
}

// Telhas do fechamento lateral (Globo Aços): as MESMAS telhas do IFC (família TELHA FECHAMENTO) do mapa do fechamento, por lado (A, H) e oitão (01, 20).
// Cada célula é o trecho (vão entre eixos ou faixa do oitão) com as telhas dele; apontar uma célula lança todas as telhas do trecho, em m²:
// m² por telha = quantidade da atividade "Instalação das telhas" do catálogo do BM (GLO-3.2.2-01) ÷ telhas do IFC (o projeto inteiro = 100% do contrato).
// Paginação de telha do projeto (prancha OF.198-PG-02): grupos "N telhas de L mm" em cada parede. Vem do banco da obra (sistema.paginacao_telhas)
// ou, na obra 198 (dados_legados), do arquivo inc/paginacao_telhas.json.
function paginacao_telhas_ler()
{
    $salvo = json_decode((string)sistema_ler('paginacao_telhas', 'null'), true);
    if (is_array($salvo) && !empty($salvo['paredes'])) {
        return $salvo;
    }
    if (sistema_ler('dados_legados', '0') === '1') {
        $p = __DIR__ . '/inc/paginacao_telhas.json';
        if (is_file($p)) {
            $l = json_decode(file_get_contents($p), true);
            return is_array($l) && !empty($l['paredes']) ? $l : null;
        }
    }
    return null;
}

// Telhas de uma fiada pela paginação: lista [comprimento_mm, centro_mm]; o passo é o comprimento da parede ÷ nº de telhas da fiada.
function paginacao_fiada(array $grupos, $compMm)
{
    $ls = [];
    foreach ($grupos as $g) {
        for ($i = 0; $i < (int)$g[0]; $i++) {
            $ls[] = (int)$g[1];
        }
    }
    $passo = $ls ? $compMm / count($ls) : 0;
    $out = [];
    foreach ($ls as $i => $l) {
        $out[] = ['l' => $l, 'x' => ($i + .5) * $passo];
    }
    return $out;
}

function frente_telhas_fechamento(array $fech)
{
    $familia = 'TELHA FECHAMENTO';   // (constante global não serve: api.php roda as rotas antes de chegar nesta linha)
    $pag = paginacao_telhas_ler();
    if (!$pag) {   // obra que não é a legada mas tem o mesmo fechamento (lados A e H, oitões 01 e 20, contagem do IFC a ±2 telhas da prancha): usa a prancha do arquivo
        $arq = __DIR__ . '/inc/paginacao_telhas.json';
        $l = is_file($arq) ? json_decode(file_get_contents($arq), true) : null;
        if (is_array($l) && !empty($l['paredes'])) {
            $ok = true;
            foreach ($l['paredes'] as $id => $pw) {
                $esperado = isset($pw['grupos']) ? array_sum(array_column($pw['grupos'], 0)) : array_sum(array_column($pw['inferior'], 0)) + array_sum(array_column($pw['superior'], 0));
                $ifc = null;
                foreach (($fech['partes'] ?? []) as $p) {
                    if ($p['id'] === $id) {
                        $ifc = 0;
                        foreach (($p['celulas'] ?? []) as $c) { $ifc += (int)(($c['pecas'] ?? [])['TELHA FECHAMENTO'] ?? 0); }
                    }
                }
                if ($ifc === null || abs($ifc - $esperado) > 2) { $ok = false; }
            }
            $pag = $ok ? $l : null;
        }
    }
    $partes = [];
    $total = 0;
    foreach (($fech['partes'] ?? []) as $p) {
        $cel = [];
        $soma = 0;
        $pw = $pag['paredes'][$p['id']] ?? null;
        $trechos = array_column($p['celulas'] ?? [], 'trecho');
        if ($pw && $trechos) {   // projeto: cada telha com o comprimento e a posição da prancha de paginação; o trecho é o vão (lados) ou a faixa AB…GH (oitões) onde ela cai
            $comp = (float)$pw['comprimento_mm'];
            $lados = isset($pw['grupos']);
            $filas = $lados ? ['' => paginacao_fiada($pw['grupos'], $comp)] : ['inferior' => paginacao_fiada($pw['inferior'], $comp), 'superior' => paginacao_fiada($pw['superior'], $comp)];
            $nT = count($trechos);
            $porTrecho = [];
            foreach ($filas as $fila => $ts) {
                foreach ($ts as $t) {
                    $k = min($nT - 1, (int)floor($t['x'] / ($comp / $nT)));
                    $porTrecho[$k][] = $t + ['fila' => $fila];
                }
            }
            ksort($porTrecho);
            foreach ($porTrecho as $k => $ts) {
                $de = count($ts);
                foreach ($ts as $i => $t) {
                    $c = ['trecho' => $trechos[$k] . '/' . sprintf('%02d', $i + 1), 'vao' => $trechos[$k], 'n' => $i + 1, 'de' => $de, 'pecas' => [$familia => 1], 'total' => 1,
                        'l' => $t['l'], 'x' => (int)round($t['x'])];
                    if ($t['fila'] !== '') {
                        $c['fila'] = $t['fila'];
                    }
                    $cel[] = $c;
                    $soma++;
                }
            }
        } else {
            foreach (($p['celulas'] ?? []) as $c) {
                $n = (int)(($c['pecas'] ?? [])[$familia] ?? 0);
                for ($i = 1; $i <= $n; $i++) {   // sem projeto: o IFC dá a contagem por trecho; a posição dentro do trecho é a ordem
                    $cel[] = ['trecho' => $c['trecho'] . '/' . sprintf('%02d', $i), 'vao' => $c['trecho'], 'n' => $i, 'de' => $n, 'pecas' => [$familia => 1], 'total' => 1];
                    $soma++;
                }
            }
        }
        if ($cel) {
            $partes[] = ['id' => $p['id'], 'nome' => $p['nome'], 'celulas' => $cel, 'total' => $soma] + ($pw ? ['comprimento_mm' => (int)$pw['comprimento_mm']] : []);
            $total += $soma;
        }
    }
    if (!$partes) {
        return null;
    }
    $cod = 'GLO-3.2.2-01';
    $qtd = (float)q('SELECT qtd FROM bm_atividades WHERE codigo = ? AND qtd > 0 ORDER BY id LIMIT 1', [$cod])->fetchColumn() ?: 12082.65;
    return ['titulo' => 'Telhas do fechamento lateral — Globo Aços', 'servico' => 'FECHAMENTO', 'empresa' => 'GLOBO AÇOS',
        'telha' => ['n' => $total, 'm2_total_contrato' => $qtd, 'm2_por_telha' => round($qtd / $total, 4), 'codigo_bm' => $cod, 'projeto' => $pag ? ($pag['projeto'] ?? 'paginação de telha') : null],
        'partes' => $partes, 'total' => $total, 'familias' => [$familia]];
}

function frentes_montagem()
{
    $d = null;
    $salvo = json_decode((string)sistema_ler('frentes_montagem', 'null'), true);
    if (is_array($salvo)) {
        $d = $salvo;
    } elseif (sistema_ler('dados_legados', '0') === '1') {
        $p = __DIR__ . '/inc/frentes_montagem.json';
        if (is_file($p)) {
            $lido = json_decode(file_get_contents($p), true);
            $d = is_array($lido) ? $lido : null;
        }
    }
    $d = $d ?? ['frentes' => [], 'malha' => []];
    foreach (['telha', 'perfilagem'] as $k) {   // telhas e perfilagem da Globo são geradas da malha (não vêm do IFC)
        if (empty($d['frentes'][$k])) {
            $d['frentes'][$k] = frente_telhas($d['malha'] ?? [], $k);
        }
    }
    if (empty($d['frentes']['telha_fechamento']) && !empty($d['frentes']['fechamento'])) {   // telhas do fechamento lateral: vêm do mapa do fechamento (IFC)
        $tf = frente_telhas_fechamento($d['frentes']['fechamento']);
        if ($tf) {
            $d['frentes']['telha_fechamento'] = $tf;
        }
    }
    return $d;
}

// Medição (BM) da Globo Aços: a atividade "Instalação de telhas" do catálogo é medida em m² pelos apontamentos do BM (bm_apontamentos, uma linha por
// empresa + atividade + dia). Cada telha apontada no mapa soma m² (comprimento × largura) nessa linha; excluir o apontamento devolve.
function telha_cfg($tipo = 'TELHA')
{
    $k = tipos_frente()[$tipo] ?? 'telha';
    $t = ((frentes_montagem()['frentes'] ?? [])[$k]['telha'] ?? []);
    return ['m2' => (float)($t['m2_por_telha'] ?? 0) ?: round(177.32 * 0.485, 4), 'codigo' => (string)($t['codigo_bm'] ?? ($tipo === 'PERFILAGEM' ? 'GLO-3.2.1-01' : ($tipo === 'TELHAFECH' ? 'GLO-3.2.2-01' : 'GLO-3.2.1-02')))];
}
function bm_telhas_ajustar($empresa, $data, $deltaM2, $tipo = 'TELHA')
{
    $cod = telha_cfg($tipo)['codigo'];
    $atv = q('SELECT controle FROM bm_atividades WHERE empresa = ? AND codigo = ?', [$empresa, $cod])->fetch();
    if (!$atv || !empty($atv['controle']) || abs($deltaM2) < 1e-9) {
        return null;   // a empresa não tem essa atividade no catálogo (ou ela vem da grade): só a produção é lançada
    }
    $ex = q('SELECT id, quantidade FROM bm_apontamentos WHERE empresa = ? AND codigo = ? AND data = ?', [$empresa, $cod, $data])->fetch();
    $novo = round(max(0, (float)($ex['quantidade'] ?? 0) + $deltaM2), 4);
    if ($ex) {
        if ($novo > 0) {
            q('UPDATE bm_apontamentos SET quantidade = ? WHERE id = ?', [$novo, $ex['id']]);
        } else {
            q('DELETE FROM bm_apontamentos WHERE id = ?', [$ex['id']]);
        }
    } elseif ($novo > 0) {
        q('INSERT INTO bm_apontamentos (data, empresa, codigo, quantidade, obs) VALUES (?, ?, ?, ?, ?)', [$data, $empresa, $cod, $novo, ($tipo === 'PERFILAGEM' ? 'perfilagem' : ($tipo === 'TELHAFECH' ? 'telhas do fechamento lateral' : 'telhas')) . ' apontadas no mapa de montagem']);
    }
    return ['codigo' => $cod, 'data' => $data, 'total_m2' => $novo, 'delta_m2' => $deltaM2];
}

// ---- Apontamento por peça (obras criadas pela importação automática): cada conjunto do IFC é apontado numa atividade do catálogo do BM.
// A produção vai para o serviço do controle ligado à atividade (campo "controle") ou, sem ele, para os apontamentos do BM.
function pecas_credito($empresa, array $atv, $data, $delta, array $usuario)
{
    if (abs($delta) < 1e-9) {
        return null;
    }
    if (!empty($atv['controle'])) {
        return ['grade' => soma_producao($empresa, $atv['controle'], $data, $delta, $usuario)];
    }
    $ex = q('SELECT id, quantidade FROM bm_apontamentos WHERE empresa = ? AND codigo = ? AND data = ?', [$empresa, $atv['codigo'], $data])->fetch();
    $novo = round(max(0, (float)($ex['quantidade'] ?? 0) + $delta), 4);
    if ($ex) {
        if ($novo > 0) {
            q('UPDATE bm_apontamentos SET quantidade = ? WHERE id = ?', [$novo, $ex['id']]);
        } else {
            q('DELETE FROM bm_apontamentos WHERE id = ?', [$ex['id']]);
        }
    } elseif ($novo > 0) {
        q('INSERT INTO bm_apontamentos (data, empresa, codigo, quantidade, obs) VALUES (?, ?, ?, ?, ?)', [$data, $empresa, $atv['codigo'], $novo, 'peças apontadas no mapa de montagem']);
    }
    return ['bm' => ['codigo' => $atv['codigo'], 'data' => $data, 'total' => $novo, 'delta' => $delta]];
}

function acao_mapa_obra_atualizar(array $corpo, array $usuario)
{
    if (($usuario['perfil'] ?? '') !== 'admin') {
        throw new ErroValidacao('Só o administrador pode refazer o mapa pela leitura do IFC.');
    }
    require_once __DIR__ . '/inc/importacao.php';
    require_once __DIR__ . '/inc/importacao_leitura.php';
    try {
        return importacao_atualizar_mapa(obra_atual_id());
    } catch (RuntimeException $e) {
        throw new ErroValidacao($e->getMessage());
    }
}

function acao_apontamento_pecas(array $corpo, array $usuario)
{
    $mapa = json_decode((string)sistema_ler('frentes_montagem_obra', 'null'), true);
    if (!is_array($mapa)) {
        throw new ErroValidacao('Esta obra não tem o mapa de peças (vem da importação automática).');
    }
    if (!empty($corpo['excluir'])) {
        $ids = array_values(array_unique(array_map('intval', (array)($corpo['linhas'] ?? []))));
        if (!$ids) {
            throw new ErroValidacao('Nenhum apontamento informado.');
        }
        $somas = [];
        foreach ($ids as $id) {
            $r = q("SELECT * FROM apontamentos WHERE id = ? AND tipo = 'PECA'", [$id])->fetch();
            if (!$r) {
                throw new ErroValidacao('Apontamento não encontrado (os dados podem ter mudado). Recarregue a tela.');
            }
            if (mb_strtoupper((string)$r['lanca_producao']) === 'SIM') {
                $k = $r['empresa'] . '|' . $r['eixo'] . '|' . $r['data'];
                $somas[$k] = ($somas[$k] ?? 0) + (float)$r['qtd'];
            }
            q('DELETE FROM apontamentos WHERE id = ?', [$id]);
        }
        $lanc = [];
        foreach ($somas as $k => $v) {
            list($emp, $cod, $dia) = explode('|', $k, 3);
            $atv = q('SELECT * FROM bm_atividades WHERE codigo = ?', [$cod])->fetch();
            if ($atv) {
                $lanc[] = pecas_credito($emp, $atv, $dia, -$v, $usuario);
            }
        }
        return ['excluidos' => count($ids), 'lancamentos' => array_values(array_filter($lanc))];
    }
    $data = (string)($corpo['data'] ?? '');
    $o = obra_info();
    if (!data_valida($data) || $data < $o['data_inicio'] || $data > $o['data_fim']) {
        throw new ErroValidacao('Data fora do calendário da obra.');
    }
    $atv = q('SELECT * FROM bm_atividades WHERE codigo = ?', [(string)($corpo['atividade'] ?? '')])->fetch();
    if (!$atv) {
        throw new ErroValidacao('Escolha a atividade do catálogo do BM.');
    }
    $empresa = (string)$atv['empresa'];
    $pecas = is_array($corpo['pecas'] ?? null) ? $corpo['pecas'] : [];
    if (!$pecas || count($pecas) > 3000) {
        throw new ErroValidacao('Selecione de 1 a 3.000 peças no mapa.');
    }
    $validas = [];   // guid da peça => [fase, produto, marca] (a marca do Tekla se repete entre peças iguais; o GUID é único)
    $decisoes = ($mapa['versao'] ?? 1) >= 2 ? vinculos_material_ler() : null;
    foreach ($mapa['pecas'] ?? [] as $p) {
        if (!empty($p[7])) {
            if ($decisoes !== null) {
                $d = $decisoes[$p[8] ?? ''] ?? [];
                if (($d['estado'] ?? '') !== 'confirmado' || ($d['atividade'] ?? '') !== $atv['codigo'] || trim((string)$p[2]) === '') continue;
            }
            $validas[$p[7]] = [$p[0], $p[1], $p[2]];
        }
    }
    $ja = [];
    foreach (q("SELECT letra FROM apontamentos WHERE tipo = 'PECA' AND eixo = ?", [$atv['codigo']])->fetchAll() as $r) {
        $ja[$r['letra']] = true;
    }
    $novas = [];
    foreach ($pecas as $p) {
        $g = (string)($p['guid'] ?? '');
        if (!isset($validas[$g])) {
            throw new ErroValidacao('Peça fora do mapa da obra. Recarregue a tela.');
        }
        if (isset($ja[$g])) {
            throw new ErroValidacao('A peça ' . $validas[$g][2] . ' (' . $validas[$g][1] . ') já foi apontada nesta atividade.');
        }
        $ja[$g] = true;
        $novas[] = [$validas[$g][0], $validas[$g][1], $validas[$g][2], $g];
    }
    $n = count($novas);
    $lanca = !array_key_exists('lanca_producao', $corpo) || !empty($corpo['lanca_producao']);
    $qtdTotal = array_key_exists('quantidade', $corpo) && $corpo['quantidade'] !== null && $corpo['quantidade'] !== '' ? (float)$corpo['quantidade'] : (float)$n;
    if (!is_finite($qtdTotal) || $qtdTotal <= 0) {
        throw new ErroValidacao('Quantidade inválida.');
    }
    if (($mapa['versao'] ?? 1) >= 2 && !preg_match('/^(un|und|unid|pe[cç]a)/iu', (string)$atv['unidade']) && (!isset($corpo['quantidade']) || $corpo['quantidade'] === '')) {
        throw new ErroValidacao('Informe a quantidade na unidade do catálogo; quantidade de peças não equivale a área, peso ou comprimento.');
    }
    $porPeca = $qtdTotal / $n;
    foreach ($novas as $p) {
        gravar_linha('apontamentos', null, ['data' => $data, 'empresa' => $empresa, 'tipo' => 'PECA', 'rua' => $p[0], 'faixa' => $p[1], 'eixo' => $atv['codigo'], 'letra' => $p[3],
            'viga_id' => $p[2], 'qtd' => $porPeca, 'lanca_producao' => $lanca ? 'SIM' : 'NAO', 'obs' => ($corpo['obs'] ?? null) ?: null, 'slot' => null]);
    }
    $lanc = $lanca ? pecas_credito($empresa, $atv, $data, $qtdTotal, $usuario) : null;
    return ['salvos' => $n, 'empresa' => $empresa, 'quantidade' => $qtdTotal, 'unidade' => $atv['unidade'], 'lancamentos' => $lanc ? [$lanc] : []];
}

function frente_item(array $item, array $frentes, array &$ja, array $base, $data)
{
    $tipo = mb_strtoupper((string)($item['tipo'] ?? ''));
    $frente = $frentes['frentes'][tipos_frente()[$tipo]] ?? null;
    if (!$frente) {
        throw new ErroValidacao("Mapa da frente $tipo não publicado.");
    }
    $parte = null;
    $elev = $frente['elevacao'] ?? null;
    if ($elev) {
        // Vista elevada: o kit é identificado pela marca do Tekla (parte), pela rua (trecho) e pelo
        // trecho de letras ou lado da borda (etapa) — é o que o projeto marca na planta.
        $marca = (string)($item['parte'] ?? '');
        $kits = [];
        foreach ($elev['paineis'] as $pn) {
            if ($pn['marca'] === $marca) {
                $kits[] = [$pn['rua'], $pn['de'] . '-' . $pn['ate']];
            }
        }
        if (!$kits) {
            throw new ErroValidacao("{$frente['titulo']}: marca '$marca' não existe na elevação.");
        }
        $etapaItem = (string)($item['etapa'] ?? '');
        $celulas = [];
        foreach ($kits as list($r, $e)) {
            if ($e === $etapaItem) {
                $celulas[] = ['trecho' => $r];
            }
        }
        if (!$celulas) {
            throw new ErroValidacao("{$frente['titulo']} · $marca: trecho '$etapaItem' não existe na elevação.");
        }
        $parte = ['id' => $marca, 'nome' => "Kit $marca", 'celulas' => $celulas];
    } else {
        foreach ($frente['partes'] as $p) {
            if ($p['id'] === (string)($item['parte'] ?? '')) {
                $parte = $p;
            }
        }
    }
    if (!$parte) {
        throw new ErroValidacao("{$frente['titulo']}: parte '" . ($item['parte'] ?? '') . "' não existe no mapa.");
    }
    if ($elev) {
        $etapa = trim((string)($item['etapa'] ?? ''));
    } else {
        $etapas = $frente['etapas'] ?? [];
        $etapa = trim((string)($item['etapa'] ?? ($etapas ? $etapas[0] : '')));
        if ($etapas && !in_array($etapa, $etapas, true)) {
            throw new ErroValidacao("{$frente['titulo']}: etapa '$etapa' inválida.");
        }
    }
    $validos = array_column($parte['celulas'], 'trecho');
    $porTrecho = array_column($parte['celulas'], 'total', 'trecho');
    $telhaFech = $tipo === 'TELHAFECH';   // uma célula = uma telha ("vão/nn"); apontamento antigo do vão inteiro (sem "/nn") bloqueia as telhas dele
    $novas = [];
    $vistos = [];
    foreach (($item['trechos'] ?? []) as $trecho) {
        $trecho = (string)$trecho;
        if (isset($vistos[$trecho])) {
            continue;
        }
        $vistos[$trecho] = true;
        if (!in_array($trecho, $validos, true)) {
            throw new ErroValidacao("{$frente['titulo']} · {$parte['nome']}: trecho '$trecho' não existe no mapa.");
        }
        $chave = "$tipo|{$parte['id']}|$trecho|$etapa";
        if ($telhaFech && strpos($trecho, '/') !== false) {
            $vaoChave = "$tipo|{$parte['id']}|" . explode('/', $trecho)[0] . "|$etapa";
            if (isset($ja[$vaoChave]) && !isset($ja[$chave])) { $chave = $vaoChave; }   // o vão inteiro já tinha sido apontado
        }
        if (isset($ja[$chave])) {
            $quando = $ja[$chave]['data'] ?? null;
            $rot = "{$parte['nome']} · $trecho" . ($etapa ? " · $etapa" : '');
            throw new ErroValidacao("$rot já foi apontado" .
                ($quando ? ' em ' . substr($quando, 8, 2) . '/' . substr($quando, 5, 2) . '/' . substr($quando, 0, 4) . '.' : '.'));
        }
        $ja[$chave] = ['data' => $data];
        $novas[] = $base + ['tipo' => $tipo, 'faixa' => $parte['id'], 'rua' => $trecho, 'letra' => $etapa ?: null, 'qtd' => $telhaFech ? max(1, (int)($porTrecho[$trecho] ?? 1)) : 1];
    }
    return [$novas, $elev ? ($frente['servico'] ?? null) : ($etapa ?: ($frente['servico'] ?? null))];
}

function acao_apontamento(array $corpo, array $usuario)
{
    $spec = tabelas_spec()['apontamentos'];
    $aps = linhas_tabela('apontamentos', $spec);
    $regras = carregar_regras_baixa() ?: [];
    $cfg = $regras['apontamento'] ?? null;
    if (!empty($corpo['excluir'])) {
        return apontamento_excluir($aps, $corpo, $cfg ?: [], $usuario);
    }
    if (!empty($corpo['reatribuir'])) {
        return apontamento_reatribuir($aps, $corpo);
    }
    if (!$cfg || empty($regras['faixas_posicoes']) || empty($regras['criterio_por_letra'])) {
        throw new ErroValidacao('regras_baixa.json sem as regras de apontamento (faixas_posicoes, criterio_por_letra, apontamento).');
    }
    $crit = $regras['criterio_por_letra'];
    $data = (string)($corpo['data'] ?? '');
    $o = obra_info();
    if (!data_valida($data) || $data < $o['data_inicio'] || $data > $o['data_fim']) {
        throw new ErroValidacao('Data fora do calendário da obra.');
    }
    $lanca = !array_key_exists('lanca_producao', $corpo) || !empty($corpo['lanca_producao']);
    $limiteRua = (int)($regras['limites_ifc']['joists_por_rua_maximo'] ?? 0) ?: 43;
    $layout = [];
    foreach (($regras['layout_joists'] ?? []) as $faixa => $letras) {
        if ($faixa === 'nota' || !is_array($letras)) {
            continue;
        }
        foreach ($letras as $l) {
            $layout[] = [$faixa, $l];
        }
    }
    if (!$layout) {
        throw new ErroValidacao('regras_baixa.json sem layout_joists.');
    }
    $frentes = frentes_montagem();
    $frentesJa = [];
    foreach ($aps as $a) {
        $t = mb_strtoupper((string)($a['tipo'] ?? ''));
        if (isset(tipos_frente()[$t])) {
            $frentesJa["$t|{$a['faixa']}|{$a['rua']}|" . ($a['letra'] ?? '')] = $a;
        }
    }
    $vigasJa = [];
    $joistsRua = [];
    $slotsRua = [];
    foreach ($aps as $a) {
        $tipo = mb_strtoupper((string)($a['tipo'] ?? ''));
        if ($tipo === 'VIGA' && !empty($a['viga_id'])) {
            $vigasJa[$a['viga_id']] = $a;
        } elseif ($tipo === 'JOIST') {
            $rua = (string)($a['rua'] ?? '');
            $joistsRua[$rua] = ($joistsRua[$rua] ?? 0) + (float)($a['qtd'] ?? 0);
            if (!empty($a['slot'])) {
                $slotsRua[$rua][(int)$a['slot']] = true;
            }
        }
    }
    $novas = [];
    $grupos = [];
    $telhasEmp = [];
    foreach (($corpo['lote'] ?? [$corpo]) as $item) {
        $tipo = mb_strtoupper((string)($item['tipo'] ?? ''));
        $empNome = (string)($item['empresa'] ?? $corpo['empresa'] ?? '');
        if ($empNome === '' || !q('SELECT id FROM empresas WHERE nome = ?', [$empNome])->fetch()) {
            throw new ErroValidacao('Indique a empresa que montou.');
        }
        $base = ['data' => $data, 'empresa' => $empNome, 'lanca_producao' => $lanca ? 'SIM' : 'NÃO',
            'obs' => texto_ou_nulo($corpo['obs'] ?? null)];
        $doItem = [];
        $frente = null;
        if (isset(tipos_frente()[$tipo])) {
            if (!$frentes) {
                throw new ErroValidacao('Mapa das frentes não publicado no sistema online.');
            }
            list($doItem, $servico) = frente_item($item, $frentes, $frentesJa, $base, $data);
            if (!$doItem) {
                continue;
            }
            // Frentes externas (fechamento, marquise, contraventamento) sem separação de fase por ora.
        } elseif ($tipo === 'JOIST') {
            $rua = (string)($item['rua'] ?? '');
            if (!rua_valida($rua, $cfg['eixos'])) {
                throw new ErroValidacao('Rua inválida: use eixos consecutivos, ex.: 11-12.');
            }
            $slots = [];
            foreach (($item['slots'] ?? []) as $s) {
                if (!is_numeric($s)) {
                    throw new ErroValidacao('Joists inválidas: informe os números de 1 a ' . count($layout) . '.');
                }
                $slots[(int)$s] = true;
            }
            $slots = array_keys($slots);
            sort($slots);
            if (!$slots) {
                continue;
            }
            foreach ($slots as $s) {
                if ($s < 1 || $s > count($layout)) {
                    throw new ErroValidacao("Joist $s fora da rua (1 a " . count($layout) . ').');
                }
                if (isset($slotsRua[$rua][$s])) {
                    throw new ErroValidacao("A joist $s da rua $rua já foi apontada.");
                }
                $slotsRua[$rua][$s] = true;
                $doItem[] = $base + ['tipo' => 'JOIST', 'rua' => $rua, 'faixa' => $layout[$s - 1][0],
                    'letra' => $layout[$s - 1][1], 'qtd' => 1, 'slot' => $s];
            }
            $total = ($joistsRua[$rua] ?? 0) + count($slots);
            if ($total > $limiteRua) {
                throw new ErroValidacao("Rua $rua: $total joists apontadas, acima das $limiteRua por rua do projeto. Confira o apontamento.");
            }
            $joistsRua[$rua] = $total;
            $servico = $cfg['servico_joist'];
            // Determina fase pela rua: eixo inicial < 11 → GALPÃO F2, senão F1
            $frente = frente_galpao(explode('-', $rua)[0]);
        } elseif ($tipo === 'VIGA') {
            $eixo = (string)($item['eixo'] ?? '');
            if (!in_array($eixo, $cfg['eixos'], true)) {
                throw new ErroValidacao('Eixo inválido (01 a 20).');
            }
            $letras = [];
            foreach (($item['letras'] ?? []) as $l) {
                $letras[mb_strtoupper((string)$l)] = true;
            }
            // Eixos comuns: 13 vigas (letras A a H). Oitões (eixos 01 e 20): 21 vigas, uma por trecho do IFC.
            $ehOitao = in_array($eixo, $regras['vigas_oitao']['eixos'] ?? [], true);
            foreach (array_keys($letras) as $letra) {
                if (!isset($crit[$letra])) {
                    throw new ErroValidacao("Letra de viga inválida: $letra.");
                }
                if ($ehOitao && empty($crit[$letra]['oitao'])) {
                    throw new ErroValidacao("No oitão (eixo $eixo) as vigas são os trechos do projeto, ex.: B-A1; a letra $letra vale só nos demais eixos.");
                }
                if (!$ehOitao && !empty($crit[$letra]['oitao'])) {
                    throw new ErroValidacao("A viga $letra só existe nos oitões (eixos 01 e 20).");
                }
                $vid = "E$eixo-$letra-" . $crit[$letra]['viga'];
                if (isset($vigasJa[$vid])) {
                    $quando = $vigasJa[$vid]['data'] ?? null;
                    throw new ErroValidacao("A viga $vid já foi apontada" .
                        ($quando ? ' em ' . substr($quando, 8, 2) . '/' . substr($quando, 5, 2) . '/' . substr($quando, 0, 4) . '.' : '.'));
                }
                $vigasJa[$vid] = ['data' => $data];
                $doItem[] = $base + ['tipo' => 'VIGA', 'eixo' => $eixo, 'letra' => $letra, 'viga_id' => $vid, 'qtd' => 1];
            }
            if (!$doItem) {
                continue;
            }
            $servico = $cfg['servico_viga'];
            // Determina fase pelo eixo: eixo < 11 → GALPÃO F2, senão F1
            $frente = frente_galpao($eixo);
        } else {
            throw new ErroValidacao('Tipo de apontamento inválido (JOIST, VIGA, FECHAMENTO, MARQUISE, CONTRAVENTAMENTO, TELHA, PERFILAGEM ou TELHAFECH).');
        }
        $novas = array_merge($novas, $doItem);
        $fator = 1;
        $nQtd = count($doItem);
        if ($tipo === 'TELHA' || $tipo === 'PERFILAGEM') {   // lançamento em m²: telhas × (177,32 × 0,485)
            $telhasEmp[$tipo][$empNome] = ($telhasEmp[$tipo][$empNome] ?? 0) + count($doItem);
            $fator = telha_cfg($tipo)['m2'];
        } elseif ($tipo === 'TELHAFECH') {   // telhas do fechamento lateral: cada célula leva as telhas do trecho; m² por telha = contrato ÷ telhas do IFC
            $nQtd = array_sum(array_map(function ($l) { return (float)($l['qtd'] ?? 1); }, $doItem));
            $telhasEmp[$tipo][$empNome] = ($telhasEmp[$tipo][$empNome] ?? 0) + $nQtd;
            $fator = telha_cfg($tipo)['m2'];
        }
        $chave = $empNome . '|' . (string)$servico . '|' . ($frente ?? '');
        if (!isset($grupos[$chave])) {
            $grupos[$chave] = ['empresa' => $empNome, 'servico' => $servico, 'frente' => $frente, 'delta' => 0];
        }
        $grupos[$chave]['delta'] += $nQtd * $fator;
    }
    if (!$novas) {
        throw new ErroValidacao('Nada selecionado para apontar.');
    }
    $ids = [];
    foreach ($novas as $campos) {
        $vals = [];
        foreach ($spec as $c => $tipo) {
            $vals[$c] = $campos[$c] ?? null;
        }
        gravar_linha('apontamentos', null, $vals);
        $ids[] = (int)bd()->lastInsertId();
    }
    $lancamentos = [];
    if ($lanca) {
        foreach ($grupos as $g) {
            if ($g['servico']) {
                $lancamentos[] = soma_producao($g['empresa'], $g['servico'], $data, $g['delta'], $usuario, $g['frente'] ?? null);
            }
        }
    }
    $bmTelhas = [];
    if ($lanca) {
        foreach ($telhasEmp as $tp => $porEmp) {
            foreach ($porEmp as $emp => $qtd) {
                $r = bm_telhas_ajustar($emp, $data, $qtd * telha_cfg($tp)['m2'], $tp);
                if ($r) {
                    $bmTelhas[] = $r + ['empresa' => $emp, 'telhas' => $qtd, 'tipo' => $tp];
                }
            }
        }
    }
    return ['celulas' => count($novas), 'salvos' => count($novas), 'avisos' => [],
            'linhas' => $ids, 'lancamentos' => $lancamentos, 'bm_telhas' => $bmTelhas];
}

function rua_valida($rua, array $eixos)
{
    $p = explode('-', (string)$rua);
    return count($p) === 2 && in_array($p[0], $eixos, true) && in_array($p[1], $eixos, true)
        && (int)$p[1] === (int)$p[0] + 1;
}

function apontamento_excluir(array $aps, array $corpo, array $cfg, array $usuario)
{
    $alvo = array_key_exists('linhas', $corpo) && $corpo['linhas'] !== null ? $corpo['linhas'] : [$corpo['linha'] ?? null];
    $porLinha = [];
    foreach ($aps as $a) {
        $porLinha[(int)$a['linha']] = $a;
    }
    if (!$alvo) {
        throw new ErroValidacao('Apontamento não encontrado. Recarregue a tela.');
    }
    $somas = [];
    $lancamentos = [];
    $bmTelhas = [];
    foreach ($alvo as $lin) {
        $lin = (int)$lin;
        if (!isset($porLinha[$lin])) {
            throw new ErroValidacao('Apontamento não encontrado (os dados podem ter mudado). Recarregue a tela.');
        }
        $r = $porLinha[$lin];
        $t = mb_strtoupper((string)($r['tipo'] ?? ''));
        if (mb_strtoupper((string)($r['lanca_producao'] ?? '')) === 'SIM' && !empty($r['data']) && !empty($r['empresa'])) {
            $frente = null;
            if (isset(tipos_frente()[$t])) {
                $fs = (frentes_montagem()['frentes'] ?? [])[tipos_frente()[$t]] ?? [];
                $servico = $r['letra'] ?: ($fs['servico'] ?? null);
                if (!$servico) {
                    continue;
                }
            } else {
                $servico = $t === 'JOIST' ? ($cfg['servico_joist'] ?? '') : ($cfg['servico_viga'] ?? '');
                if ($t === 'JOIST' && !empty($r['rua'])) {
                    $frente = frente_galpao(explode('-', (string)$r['rua'])[0]);
                } elseif ($t === 'VIGA' && !empty($r['eixo'])) {
                    $frente = frente_galpao((string)$r['eixo']);
                }
            }
            $fatorR = 1;
            if ($t === 'TELHA' || $t === 'PERFILAGEM' || $t === 'TELHAFECH') {
                $kt = $t . '|' . $r['empresa'] . '|' . $r['data'];
                $bmTelhas[$kt] = ($bmTelhas[$kt] ?? 0) - (float)($r['qtd'] ?? 1);
                $fatorR = telha_cfg($t)['m2'];
            }
            $chave = $r['empresa'] . '|' . $servico . '|' . $r['data'] . '|' . ($frente ?? '');
            if (!isset($somas[$chave])) {
                $somas[$chave] = ['nome' => $r['empresa'], 'servico' => $servico, 'dia' => $r['data'], 'frente' => $frente, 'delta' => 0];
            }
            $somas[$chave]['delta'] -= (float)($r['qtd'] ?? 0) * $fatorR;
        }
    }
    foreach ($somas as $g) {
        $lancamentos[] = soma_producao($g['nome'], $g['servico'], $g['dia'], $g['delta'], $usuario, $g['frente']);
    }
    foreach ($bmTelhas as $kt => $nTelhas) {
        list($tp, $emp, $dia) = explode('|', $kt);
        bm_telhas_ajustar($emp, $dia, $nTelhas * telha_cfg($tp)['m2'], $tp);
    }
    foreach ($alvo as $lin) {
        q('DELETE FROM apontamentos WHERE id = ?', [(int)$lin]);
    }
    return ['celulas' => count($alvo), 'avisos' => [], 'lancamentos' => $lancamentos];
}

// Define a empresa de apontamentos de regularização (histórico), que não somaram na grade de produção.
function apontamento_reatribuir(array $aps, array $corpo)
{
    $nome = (string)($corpo['empresa'] ?? '');
    if ($nome === '' || !q('SELECT id FROM empresas WHERE nome = ?', [$nome])->fetch()) {
        throw new ErroValidacao('Indique a empresa que montou.');
    }
    $linhas = $corpo['linhas'] ?? [];
    $porLinha = [];
    foreach ($aps as $a) {
        $porLinha[(int)$a['linha']] = $a;
    }
    if (!$linhas) {
        throw new ErroValidacao('Apontamento não encontrado. Recarregue a tela.');
    }
    foreach ($linhas as $lin) {
        if (!isset($porLinha[(int)$lin])) {
            throw new ErroValidacao('Apontamento não encontrado (os dados podem ter mudado). Recarregue a tela.');
        }
        if (mb_strtoupper((string)($porLinha[(int)$lin]['lanca_producao'] ?? '')) === 'SIM') {
            throw new ErroValidacao('Só dá para redefinir a empresa de apontamentos de regularização (que não somaram na produção). Exclua e refaça os demais.');
        }
    }
    foreach ($linhas as $lin) {
        q('UPDATE apontamentos SET empresa = ? WHERE id = ?', [$nome, (int)$lin]);
    }
    return ['celulas' => count($linhas), 'avisos' => [], 'salvos' => count($linhas)];
}

// --------------------------------------------------------- planejamento de montagem
function acao_salvar_planejamento(array $corpo, array $usuario)
{
    $setores = $corpo['setores'] ?? null;
    if (!is_array($setores)) {
        throw new ErroValidacao("Campo 'setores' deve ser uma lista.");
    }
    $existente = [];
    $atual = json_decode((string)sistema_ler('planejamento', '{"setores":[]}'), true) ?: [];
    foreach ($atual['setores'] ?? [] as $s) {
        $existente[$s['chave']] = $s;
    }
    foreach ($setores as $s) {
        $chave = $s['chave'] ?? null;
        if (!$chave) continue;
        if (!isset($existente[$chave])) $existente[$chave] = ['chave' => $chave];
        $existente[$chave] = array_merge($existente[$chave], $s);
    }
    sistema_gravar('planejamento', json_encode(['setores' => array_values($existente)], JSON_UNESCAPED_UNICODE));
    return ['salvos' => count($setores)];
}

// --------------------------------------------------------- planos 5W2H (aba Planejamento)
// Contrato editado direto na tabela "previsto × realizado" do Dashboard cliente. Fica guardado à parte (por frente|serviço) e vale
// sobre o catálogo do BM; apagar o valor volta ao catálogo. Não mexe em cliente.qtd nem em servicos.escopo (a grade de produção).
function acao_cliente_contrato(array $corpo)
{
    $chave = plano_texto($corpo['chave'] ?? '', 300);
    if ($chave === '') {
        throw new ErroValidacao('Atividade sem identificação. Recarregue a tela.');
    }
    $d = json_decode((string)sistema_ler('contratos_cliente', '{}'), true);
    if (!is_array($d)) {
        $d = [];
    }
    $valor = $corpo['qtd'] ?? null;
    if ($valor === null || $valor === '') {
        unset($d[$chave]);
    } else {
        $q = numero($valor);
        if ($q === null || $q <= 0) {
            throw new ErroValidacao('Informe um contrato maior que zero (ou apague o valor para voltar ao catálogo).');
        }
        $d[$chave] = $q;
    }
    sistema_gravar('contratos_cliente', json_encode($d, JSON_UNESCAPED_UNICODE));
    registrar_alteracao('contrato_cliente', ['chave' => $chave, 'qtd' => $d[$chave] ?? null]);
    return ['salvos' => 1];
}

// Configuração da aba Projeção físico-financeira (compartilhada por todos os usuários da obra):
//   kit   = equipamentos do conjunto guindaste + plataforma (lista de nomes; null = automático);
//   cob   = dias cobrados do equipamento ('uso' ou 'corridos');
//   precos = preço unitário digitado por atividade ({ chave: R$/un }).
function projecao_config_ler()
{
    $d = json_decode((string)sistema_ler('projecao_config', '{}'), true);
    return is_array($d) ? $d : [];
}

function acao_projecao_config(array $corpo)
{
    $d = projecao_config_ler();
    if (array_key_exists('kit', $corpo)) {
        if ($corpo['kit'] === null) {
            unset($d['kit']);
        } else {
            if (!is_array($corpo['kit']) || count($corpo['kit']) > 30) {
                throw new ErroValidacao('Lista de equipamentos inválida.');
            }
            $d['kit'] = array_values(array_unique(array_filter(array_map(function ($n) {
                return plano_texto($n, 120);
            }, $corpo['kit']), function ($n) {
                return $n !== '';
            })));
        }
    }
    if (isset($corpo['cob'])) {
        if (!in_array($corpo['cob'], ['uso', 'corridos'], true)) {
            throw new ErroValidacao('Forma de cobrança dos dias inválida.');
        }
        $d['cob'] = $corpo['cob'];
    }
    $precos = isset($d['precos']) && is_array($d['precos']) ? $d['precos'] : [];
    if (isset($corpo['preco']) && is_array($corpo['preco'])) {
        $chave = plano_texto($corpo['preco']['chave'] ?? '', 300);
        if ($chave === '') {
            throw new ErroValidacao('Atividade sem identificação. Recarregue a tela.');
        }
        $v = numero($corpo['preco']['valor'] ?? null);
        if ($v === null || $v <= 0) {
            unset($precos[$chave]);
        } else {
            $precos[$chave] = $v;
        }
    }
    if (isset($corpo['precos_importar']) && is_array($corpo['precos_importar'])) {   // migração única do que estava só no navegador
        foreach (array_slice($corpo['precos_importar'], 0, 300, true) as $chave => $valor) {
            $chave = plano_texto((string)$chave, 300);
            $v = numero($valor);
            if ($chave !== '' && $v !== null && $v > 0 && !isset($precos[$chave])) {
                $precos[$chave] = $v;
            }
        }
    }
    $d['precos'] = (object)$precos;
    sistema_gravar('projecao_config', json_encode($d, JSON_UNESCAPED_UNICODE));
    registrar_alteracao('projecao_config', ['kit' => $d['kit'] ?? null, 'cob' => $d['cob'] ?? null, 'precos' => count($precos)]);
    return ['salvos' => 1, 'config' => $d];
}

// Dependências entre as etapas do fluxo da obra (aba Planejamento › Fluxo da obra). Só o que difere do padrão do programa é gravado:
//   { "galpao": { "g12": { "dep": ["g9","g10"] } }, "anexo": { ... } }
// O padrão e o significado de cada etapa ficam no navegador (planos_doc.js); aqui só se valida o formato e se recusa ciclo.
function fluxo_config_ler()
{
    $d = json_decode((string)sistema_ler('fluxo_config', '{}'), true);
    return is_array($d) ? $d : [];
}

function fluxo_tem_ciclo(array $mapa)
{
    $estado = [];
    $visita = function ($id) use (&$visita, &$estado, $mapa) {
        if (($estado[$id] ?? 0) === 1) {
            return true;
        }
        if (($estado[$id] ?? 0) === 2) {
            return false;
        }
        $estado[$id] = 1;
        foreach (($mapa[$id]['dep'] ?? []) as $d) {
            if (isset($mapa[$d]) && $visita($d)) {
                return true;
            }
        }
        $estado[$id] = 2;
        return false;
    };
    foreach (array_keys($mapa) as $id) {
        if ($visita($id)) {
            return true;
        }
    }
    return false;
}

function acao_fluxo_config(array $corpo)
{
    $cfg = is_array($corpo['config'] ?? null) ? $corpo['config'] : [];
    $novo = [];
    foreach (['galpao', 'anexo'] as $fluxo) {
        $f = $cfg[$fluxo] ?? null;
        if (!is_array($f)) {
            continue;
        }
        foreach (array_slice($f, 0, 40, true) as $id => $e) {
            $id = (string)$id;
            if (!preg_match('/^[ga]\d{1,2}[a-z]?$/', $id) || !is_array($e) || !is_array($e['dep'] ?? null)) {
                continue;
            }
            $dep = [];
            foreach (array_slice($e['dep'], 0, 20) as $d) {
                $d = (string)$d;
                if (preg_match('/^[ga]\d{1,2}[a-z]?$/', $d) && $d !== $id) {
                    $dep[$d] = true;
                }
            }
            $novo[$fluxo][$id] = ['dep' => array_keys($dep)];
        }
        if (!empty($novo[$fluxo]) && fluxo_tem_ciclo($novo[$fluxo])) {
            throw new ErroValidacao('As dependências formam um ciclo (uma etapa esperando por outra que espera por ela). Revise.');
        }
    }
    sistema_gravar('fluxo_config', json_encode((object)$novo, JSON_UNESCAPED_UNICODE));
    registrar_alteracao('fluxo_config', ['etapas' => array_sum(array_map('count', $novo))]);
    return ['salvos' => 1, 'config' => (object)$novo];
}

// Vínculos material ↔ atividade (Suprimentos › Vínculos). Cada grupo (produto + local) pode ser ligado a UMA atividade do catálogo do BM; o
// vínculo vale para todas as TAGs do grupo e para os fixadores do kit da peça. Quem confirma e quando fica registrado.
//   { "TERÇA FECHAMENTO|Galpão": { "estado": "confirmado", "atividade": "3.1.2-03", "familia": "TERÇA FECHAMENTO", "produto": "...", "local": "Galpão",
//                                  "por": "Felipe", "em": "2026-10-20 14:03" } }
// A sugestão automática (nome da peça = família do IFC, local = frente) é calculada no navegador (vinculos.js); aqui só se guarda a decisão.
function vinculos_material_ler()
{
    $d = json_decode((string)sistema_ler('vinculos_material', '{}'), true);
    return is_array($d) ? $d : [];
}

function acao_vinculos(array $corpo)
{
    $itens = is_array($corpo['itens'] ?? null) ? array_slice($corpo['itens'], 0, 600) : [];
    if (!$itens) {
        throw new ErroValidacao('Nenhum vínculo informado.');
    }
    $atual = vinculos_material_ler();
    $por = trim((string)($GLOBALS['usuario']['nome'] ?? ''));
    $em = (new DateTimeImmutable('now', new DateTimeZone('America/Sao_Paulo')))->format('Y-m-d H:i');
    $n = 0;
    foreach ($itens as $it) {
        if (!is_array($it)) {
            continue;
        }
        $chave = trim((string)($it['chave'] ?? ''));
        $estado = (string)($it['estado'] ?? '');
        if ($chave === '' || mb_strlen($chave) > 600 || !in_array($estado, ['confirmado', 'ignorado', 'desfeito'], true)) {
            continue;
        }
        if ($estado === 'desfeito') {
            unset($atual[$chave]);
            $n++;
            continue;
        }
        $atividade = trim((string)($it['atividade'] ?? ''));
        if ($estado === 'confirmado' && !preg_match('/^[A-Za-z0-9_.\-]{3,40}$/', $atividade)) {
            throw new ErroValidacao('Escolha a atividade do catálogo para confirmar o vínculo.');
        }
        $regrasIfc = carregar_regras_baixa() ?: [];
        if (($regrasIfc['versao_identidade'] ?? 0) === 1) {
            if (!isset($regrasIfc['vinculos_ifc'][$chave])) throw new ErroValidacao('Grupo fora do IFC desta obra.');
            if ($estado === 'confirmado' && !q('SELECT codigo FROM bm_atividades WHERE codigo = ?', [$atividade])->fetch()) {
                throw new ErroValidacao('A atividade precisa pertencer ao catálogo desta obra.');
            }
        }
        $atual[$chave] = [
            'estado' => $estado,
            'atividade' => $estado === 'confirmado' ? $atividade : '',
            'familia' => mb_substr(trim((string)($it['familia'] ?? '')), 0, 80),
            'produto' => mb_substr(trim((string)($it['produto'] ?? '')), 0, 120),
            'local' => (string)($regrasIfc['vinculos_ifc'][$chave]['local'] ?? trim((string)($it['local'] ?? ''))),
            'por' => $por,
            'em' => $em,
        ];
        $n++;
    }
    if ($n === 0) {
        throw new ErroValidacao('Nenhum vínculo válido para gravar.');
    }
    sistema_gravar('vinculos_material', json_encode((object)$atual, JSON_UNESCAPED_UNICODE));
    registrar_alteracao('vinculos_material', ['alterados' => $n, 'total' => count($atual)]);
    return ['salvos' => $n, 'config' => (object)$atual];
}

// Fixadores por unidade de cada atividade do catálogo do BM: quando a produção da atividade é lançada, o consumo virtual
// de cada TAG sobe (por_unidade × unidades produzidas). Guardado em sistema.fixadores_atividade: {atividade: {linhas, por, em}}.
function fixadores_atividade_ler()
{
    $d = json_decode((string)sistema_ler('fixadores_atividade', '{}'), true);
    return is_array($d) ? $d : [];
}

function acao_fixadores_atividade(array $corpo)
{
    $ativ = trim((string)($corpo['atividade'] ?? ''));
    if (!preg_match('/^[A-Za-z0-9_.\-]{3,40}$/', $ativ)) {
        throw new ErroValidacao('Atividade inválida.');
    }
    $tag = function ($v, $rotulo) {
        $v = mb_strtoupper(trim((string)($v ?? '')));
        if ($v === '') {
            return '';
        }
        if (!preg_match('/^[A-Z0-9_.\-]{2,20}$/', $v)) {
            throw new ErroValidacao("TAG inválida em $rotulo: $v");
        }
        return $v;
    };
    $qtd = function ($v, $rotulo) {
        $n = numero($v);
        if ($n === null || $n < 0 || $n > 1000000) {
            throw new ErroValidacao("Quantidade inválida em $rotulo.");
        }
        return round($n, 4);
    };
    $linhas = [];
    foreach (array_slice(is_array($corpo['linhas'] ?? null) ? $corpo['linhas'] : [], 0, 60) as $l) {
        if (!is_array($l)) {
            continue;
        }
        $t = $tag($l['tag'] ?? '', 'fixador');
        if ($t === '') {
            continue;
        }
        $por = $qtd($l['por_unidade'] ?? 0, "fixador $t");
        if ($por <= 0) {
            continue;
        }
        $linha = ['tag' => $t, 'por_unidade' => $por];
        foreach (['arruela', 'porca'] as $k) {
            $tk = $tag($l[$k] ?? '', $k);
            if ($tk !== '') {
                $linha[$k] = $tk;
                $linha[$k . '_qtd'] = $qtd($l[$k . '_qtd'] ?? $por, $k . ' de ' . $t);
            }
        }
        $linha['obs'] = mb_substr(trim((string)($l['obs'] ?? '')), 0, 160);
        $linhas[] = $linha;
    }
    $atual = fixadores_atividade_ler();
    if ($linhas) {
        $atual[$ativ] = [
            'linhas' => $linhas,
            'por' => trim((string)($GLOBALS['usuario']['nome'] ?? '')),
            'em' => (new DateTimeImmutable('now', new DateTimeZone('America/Sao_Paulo')))->format('Y-m-d H:i'),
        ];
    } else {
        unset($atual[$ativ]);
    }
    sistema_gravar('fixadores_atividade', json_encode((object)$atual, JSON_UNESCAPED_UNICODE));
    registrar_alteracao('fixadores_atividade', ['atividade' => $ativ, 'linhas' => count($linhas)]);
    return ['config' => (object)$atual];
}

function planos_ler()
{
    $d = json_decode((string)sistema_ler('planos_5w2h', '{"planos":[]}'), true);
    return is_array($d) && isset($d['planos']) && is_array($d['planos']) ? $d : ['planos' => []];
}

function plano_texto($v, $max = 500)
{
    return mb_substr(trim((string)($v ?? '')), 0, $max);
}

function plano_data($v, $rotulo, $obrigatoria = false)
{
    $v = trim((string)($v ?? ''));
    if ($v === '') {
        if ($obrigatoria) {
            throw new ErroValidacao("Informe $rotulo.");
        }
        return null;
    }
    if (!data_valida($v)) {
        throw new ErroValidacao("Data inválida em $rotulo.");
    }
    return $v;
}

// Divisão da atividade por empresa (5W2H com 2 ou mais empresas): quantidade (produção), valor estimado (financeiro), como (How) e quando (When) de cada uma.
function plano_divisao($lista): array
{
    $r = [];
    if (!is_array($lista)) {
        return $r;
    }
    foreach ($lista as $d) {
        if (!is_array($d)) {
            continue;
        }
        $emp = plano_texto($d['empresa'] ?? '', 80);
        $q = numero($d['qtd'] ?? null);
        if ($emp === '' || $q === null || $q < 0) {
            continue;
        }
        $v = numero($d['valor'] ?? null);
        $ini = (string)($d['inicio'] ?? '');
        $fim = (string)($d['fim'] ?? '');
        $ini = preg_match('/^\d{4}-\d{2}-\d{2}$/', $ini) ? $ini : '';
        $fim = preg_match('/^\d{4}-\d{2}-\d{2}$/', $fim) ? $fim : '';
        if ($ini !== '' && $fim !== '' && $fim < $ini) {
            $fim = $ini;
        }
        $r[] = ['empresa' => $emp, 'qtd' => $q, 'valor' => ($v !== null && $v >= 0) ? $v : null, 'valor_manual' => !empty($d['valor_manual']),
            'como' => plano_texto($d['como'] ?? '', 300), 'inicio' => $ini, 'fim' => $fim, 'quando_manual' => !empty($d['quando_manual'])];
        if (count($r) >= 8) {
            break;
        }
    }
    return count($r) >= 2 ? $r : [];
}

// Cria, altera ou exclui um plano 5W2H. O plano guarda o período, as atividades e o 5W2H de cada uma; o realizado,
// a curva S, o que falta e a divisão por dia são calculados na tela a partir da produção lançada.
// Portões do fluxo (material chegou? descarregado? checklist?): 'sim' prossegue, 'nao' retorna.
// Data/hora e autor são carimbados aqui (horário de Brasília) quando a resposta muda.
function plano_portoes($novo, $antigo, $agora, $quem)
{
    $saida = [];
    if (!is_array($novo)) {
        return $saida;
    }
    foreach (['material', 'descarga', 'checklist'] as $g) {
        $n = is_array($novo[$g] ?? null) ? $novo[$g] : [];
        $r = (string)($n['r'] ?? '');
        if ($r !== 'sim' && $r !== 'nao') {
            continue;
        }
        $a = is_array($antigo[$g] ?? null) ? $antigo[$g] : [];
        $mudou = (string)($a['r'] ?? '') !== $r || empty($a['em']);
        $saida[$g] = [
            'r' => $r,
            'em' => $mudou ? $agora : (string)$a['em'],
            'por' => $mudou ? $quem : (string)($a['por'] ?? $quem),
            'prev' => $r === 'nao' ? plano_data($n['prev'] ?? '', 'a previsão de chegada', false) : null,
            'obs' => plano_texto($n['obs'] ?? '', 200),
        ];
    }
    return $saida;
}

function acao_planos(array $corpo, array $usuario)
{
    $doc = planos_ler();
    if (!empty($corpo['excluir'])) {
        $id = (string)$corpo['excluir'];
        $antes = count($doc['planos']);
        $doc['planos'] = array_values(array_filter($doc['planos'], function ($p) use ($id) {
            return (string)($p['id'] ?? '') !== $id;
        }));
        if (count($doc['planos']) === $antes) {
            throw new ErroValidacao('Plano não encontrado. Recarregue a tela.');
        }
        sistema_gravar('planos_5w2h', json_encode($doc, JSON_UNESCAPED_UNICODE));
        registrar_alteracao('plano_excluido', ['id' => $id]);
        return ['salvos' => 1];
    }
    $p = $corpo['plano'] ?? null;
    if (!is_array($p)) {
        throw new ErroValidacao('Plano inválido.');
    }
    $nome = plano_texto($p['nome'] ?? '', 120);
    if ($nome === '') {
        throw new ErroValidacao('Dê um nome ao planejamento.');
    }
    $ini = plano_data($p['inicio'] ?? '', 'o início do período', true);
    $fim = plano_data($p['fim'] ?? '', 'o fim do período', true);
    if ($fim < $ini) {
        throw new ErroValidacao('O fim do período não pode ser antes do início.');
    }
    $agoraBrt = (new DateTimeImmutable('now', new DateTimeZone('America/Sao_Paulo')))->format('Y-m-d H:i');
    $quemPortao = (string)($usuario['nome'] ?? $usuario['login'] ?? '');
    $itensAntigos = [];
    foreach ($doc['planos'] as $ex) {
        if ((string)($ex['id'] ?? '') === (string)($p['id'] ?? '') && ($p['id'] ?? '') !== '') {
            foreach (($ex['itens'] ?? []) as $ei) {
                $itensAntigos[(string)($ei['chave'] ?? '')] = $ei['portoes'] ?? [];
            }
        }
    }
    $rasc = (($p['status'] ?? '') === 'rascunho');   // rascunho: guarda o que já foi preenchido (sem quantidade/atividades obrigatórias) para continuar depois
    $itens = [];
    foreach (($p['itens'] ?? []) as $k => $it) {
        if (!is_array($it)) {
            continue;
        }
        if ($rasc) {
            if (trim((string)($it['inicio'] ?? '')) === '') { $it['inicio'] = $ini; }
            if (trim((string)($it['fim'] ?? '')) === '') { $it['fim'] = $fim; }
        }
        $n = $k + 1;
        $chave = plano_texto($it['chave'] ?? '', 200);
        if ($chave === '') {
            throw new ErroValidacao("Atividade $n sem identificação.");
        }
        $qtd = numero($it['qtd'] ?? null);
        $peso = numero($it['peso'] ?? null);
        if ($rasc) {
            $qtd = ($qtd !== null && $qtd > 0) ? $qtd : 0;
        } elseif ($qtd === null || $qtd <= 0) {
            throw new ErroValidacao('Atividade ' . plano_texto($it['atividade'] ?? $chave, 80) . ': informe a quantidade a executar no período (maior que zero).');
        }
        $iIni = plano_data($it['inicio'] ?? '', 'o início da atividade ' . $n, true);
        $iFim = plano_data($it['fim'] ?? '', 'o fim da atividade ' . $n, true);
        if ($iFim < $iIni) {
            throw new ErroValidacao('Atividade ' . plano_texto($it['atividade'] ?? $chave, 80) . ': o fim não pode ser antes do início.');
        }
        $itens[] = [
            'chave' => $chave, 'atividade' => plano_texto($it['atividade'] ?? $chave, 200), 'frente' => plano_texto($it['frente'] ?? '', 150),
            'empresa' => plano_texto($it['empresa'] ?? '', 150), 'unidade' => plano_texto($it['unidade'] ?? '', 12),
            'qtd_contrato' => numero($it['qtd_contrato'] ?? null), 'qtd' => $qtd, 'peso' => ($peso !== null && $peso > 0) ? $peso : 1,
            'inicio' => $iIni, 'fim' => $iFim,
            'o_que' => plano_texto($it['o_que'] ?? ''), 'por_que' => plano_texto($it['por_que'] ?? ''), 'onde' => plano_texto($it['onde'] ?? ''),
            'quem' => plano_texto($it['quem'] ?? ''), 'como' => plano_texto($it['como'] ?? ''),
            'custo' => numero($it['custo'] ?? null), 'meta_dia' => (($m = numero($it['meta_dia'] ?? null)) !== null && $m > 0) ? $m : null, 'obs' => plano_texto($it['obs'] ?? ''),
            'divisao' => plano_divisao($it['divisao'] ?? []),
            'portoes' => plano_portoes($it['portoes'] ?? [], $itensAntigos[$chave] ?? [], $agoraBrt, $quemPortao),
        ];
        if (count($itens) > 300) {
            throw new ErroValidacao('Máximo de 300 atividades por plano.');
        }
    }
    if (!$itens && !$rasc) {
        throw new ErroValidacao('Escolha ao menos uma atividade para o planejamento.');
    }
    $id = plano_texto($p['id'] ?? '', 40);
    $agora = date('c');
    $quem = (string)($usuario['nome'] ?? $usuario['login'] ?? '');
    $novo = ['id' => $id, 'nome' => $nome, 'inicio' => $ini, 'fim' => $fim, 'responsavel' => plano_texto($p['responsavel'] ?? '', 120),
        'objetivo' => plano_texto($p['objetivo'] ?? '', 800), 'status' => in_array(($p['status'] ?? ''), ['ativo', 'concluido', 'arquivado', 'rascunho'], true) ? $p['status'] : 'ativo',
        'itens' => $itens, 'atualizado_em' => $agora, 'atualizado_por' => $quem];
    $achou = false;
    if ($id !== '') {
        foreach ($doc['planos'] as $i => $ex) {
            if ((string)($ex['id'] ?? '') === $id) {
                $novo['criado_em'] = $ex['criado_em'] ?? $agora;
                $novo['criado_por'] = $ex['criado_por'] ?? $quem;
                $doc['planos'][$i] = $novo;
                $achou = true;
                break;
            }
        }
    }
    if (!$achou) {
        $novo['id'] = 'pl' . date('ymdHis') . bin2hex(random_bytes(2));
        $novo['criado_em'] = $agora;
        $novo['criado_por'] = $quem;
        $doc['planos'][] = $novo;
    }
    sistema_gravar('planos_5w2h', json_encode($doc, JSON_UNESCAPED_UNICODE));
    registrar_alteracao('plano_salvo', ['id' => $novo['id'], 'nome' => $nome, 'atividades' => count($itens)]);
    return ['salvos' => 1, 'id' => $novo['id']];
}

// --------------------------------------------------------- snapshot de produção
function acao_importar_snapshot(array $corpo, array $usuario)
{
    if (!isset($corpo['tabelas']) || !isset($corpo['empresas'])) {
        throw new ErroValidacao("Snapshot inválido: campos 'tabelas' e 'empresas' são obrigatórios.");
    }
    $corpo['gerado_em'] = date('c');
    sistema_gravar('dados_producao', json_encode($corpo, JSON_UNESCAPED_UNICODE));
    $apts = count($corpo['tabelas']['apontamentos'] ?? []);
    return ['ok' => true, 'apontamentos' => $apts];
}

// --------------------------------------------------------- sincronização apontamentos F2 → lançamentos
function acao_sincronizar_apontamentos_fase2(array $corpo, array $usuario)
{
    $data = (string)($corpo['data'] ?? '');
    $empresa = (string)($corpo['empresa'] ?? '');
    if (!data_valida($data)) throw new ErroValidacao('Data inválida.');
    if (!$empresa || !q('SELECT id FROM empresas WHERE nome = ?', [$empresa])->fetch()) {
        throw new ErroValidacao('Empresa não encontrada.');
    }

    // Busca apontamentos F2 concluídos nesta data/empresa (statusFase=concluído)
    $aps = q('SELECT * FROM apontamentos
             WHERE data = ? AND empresa = ? AND statusFase = ?
             ORDER BY id', [$data, $empresa, 'concluído'])->fetchAll();

    if (!$aps) {
        return ['ok' => false, 'msg' => 'Nenhum apontamento F2 concluído encontrado.', 'sincronizados' => 0];
    }

    $agrupado = [];
    foreach ($aps as $a) {
        $serv = (string)($a['servico'] ?? '');
        if (!$serv) continue;
        if (!isset($agrupado[$serv])) $agrupado[$serv] = 0;
        $agrupado[$serv] += (float)($a['qtd'] ?? 0);
    }

    $sincronizados = 0;
    foreach ($agrupado as $serv => $qtd) {
        // Cria ou atualiza lançamento em producao com fase='2'
        $ex = q('SELECT id FROM producao
                 WHERE data = ? AND empresa = ? AND servico = ? AND fase = ?',
                [$data, $empresa, $serv, '2'])->fetch();

        if ($ex) {
            q('UPDATE producao SET valor = valor + ?, origem_apontamento = 1 WHERE id = ?', [$qtd, $ex['id']]);
        } else {
            q('INSERT INTO producao (data, empresa, servico, fase, valor, origem_apontamento) VALUES (?, ?, ?, ?, ?, 1)',
              [$data, $empresa, $serv, '2', $qtd]);
        }
        $sincronizados++;

        // Log de auditoria
        q('INSERT INTO apontamentos_sincronizados (data, empresa, servico, fase, quantidade, sincronizado_em, usuario_id)
          VALUES (?, ?, ?, ?, ?, NOW(), ?)',
          [$data, $empresa, $serv, '2', $qtd, (int)($usuario['id'] ?? 0)]);
    }

    return ['ok' => true, 'sincronizados' => $sincronizados, 'msg' => "$sincronizados serviço(s) sincronizados."];
}

// --------------------------------------------------------- token de máquina
function acao_gerar_machine_token(array $corpo, array $usuario)
{
    if ($usuario['perfil'] !== 'admin') {
        throw new ErroValidacao('Apenas administradores podem gerar token de máquina.');
    }
    $token = bin2hex(random_bytes(32));
    sistema_gravar('machine_token', $token);
    registrar_alteracao('machine_token_gerado', ['por' => $usuario['login']]);
    return ['token' => $token, 'aviso' => 'Copie este token agora — ele não será exibido novamente.'];
}

function acao_revogar_machine_token(array $corpo, array $usuario)
{
    if ($usuario['perfil'] !== 'admin') {
        throw new ErroValidacao('Apenas administradores podem revogar token de máquina.');
    }
    sistema_gravar('machine_token', '');
    registrar_alteracao('machine_token_revogado', ['por' => $usuario['login']]);
    return ['ok' => true, 'mensagem' => 'Token revogado. Nenhuma chamada via token será aceita até gerar um novo.'];
}

function acao_popular_qtd_cliente(array $corpo, array $usuario)
{
    // q_global() evita ambiguidade de obra_id em JOIN (q() injeta obra_id sem alias)
    $obraId = obra_atual_id();
    $linhas = q_global(
        'SELECT s.nome, s.frente, SUM(s.escopo) AS total
         FROM servicos s
         JOIN empresas e ON s.empresa_id = e.id
         WHERE e.obra_id = ? AND s.escopo IS NOT NULL AND s.escopo > 0
         GROUP BY s.nome, s.frente',
        [$obraId]
    )->fetchAll(PDO::FETCH_ASSOC);
    $atualizados = 0;
    foreach ($linhas as $linha) {
        $nome   = $linha['nome'];
        $frente = $linha['frente'];
        $total  = (float)$linha['total'];
        // Verifica se já existe linha com esse (servico, frente)
        $existe = q_global(
            'SELECT id FROM cliente WHERE obra_id = ? AND servico = ?
             AND (frente = ? OR (frente IS NULL AND ? IS NULL)) LIMIT 1',
            [$obraId, $nome, $frente, $frente]
        )->fetch(PDO::FETCH_ASSOC);
        if ($existe) {
            $n = q_global(
                'UPDATE cliente SET qtd = ? WHERE obra_id = ? AND servico = ?
                 AND (frente = ? OR (frente IS NULL AND ? IS NULL))',
                [$total, $obraId, $nome, $frente, $frente]
            )->rowCount();
        } else {
            $n = q_global(
                'INSERT INTO cliente (obra_id, servico, frente, qtd) VALUES (?, ?, ?, ?)',
                [$obraId, $nome, $frente, $total]
            )->rowCount();
        }
        $atualizados += $n;
    }
    return ['atualizados' => $atualizados];
}

// Cria espelhos de todos os serviços de Fase 1 para GALPÃO F2 (eixos 01-10).
// Usa o mesmo col com sufixo '2' (ex.: "B" → "B2"). Escopos do IFC quando conhecidos.
function acao_popular_fase2_servicos(array $corpo, array $usuario)
{
    $obraId = obra_atual_id();
    $todos = q_global(
        'SELECT s.id, s.empresa_id, s.col, s.nome, s.frente, s.id_crono, s.escopo, s.ordem
         FROM servicos s JOIN empresas e ON e.id = s.empresa_id
         WHERE e.obra_id = ? ORDER BY s.empresa_id, s.ordem, s.id',
        [$obraId]
    )->fetchAll(PDO::FETCH_ASSOC);

    $temF2 = [];
    $colsUsadas = [];
    foreach ($todos as $s) {
        $colsUsadas[] = $s['col'];
        if ((string)($s['frente'] ?? '') === 'GALPÃO F2') {
            $temF2[$s['empresa_id'] . '|' . $s['nome']] = true;
        }
    }

    // Quantitativos Fase 2 do IFC (eixos 01-10, 10 ruas)
    $escopoF2 = ['IÇAMENTO JOIST' => 430, 'VIGAS' => 130];

    $criados = 0;
    foreach ($todos as $s) {
        if ((string)($s['frente'] ?? '') === 'GALPÃO F2') continue;
        $chave = $s['empresa_id'] . '|' . $s['nome'];
        if (isset($temF2[$chave])) continue;
        $temF2[$chave] = true;

        // Gera col única: original + '2', com fallbacks se já em uso
        $novaCol = $s['col'] . '2';
        foreach (['2', 'F2', 'G2', 'H2', 'I2', 'J2'] as $sfx) {
            $tentativa = $s['col'] . $sfx;
            if (!in_array($tentativa, $colsUsadas, true)) { $novaCol = $tentativa; break; }
        }
        $colsUsadas[] = $novaCol;

        $escopo = $escopoF2[$s['nome']] ?? null;
        q_global(
            'INSERT INTO servicos (obra_id, empresa_id, col, nome, frente, id_crono, escopo, ordem)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [$obraId, $s['empresa_id'], $novaCol, $s['nome'], 'GALPÃO F2',
             $s['id_crono'], $escopo, ($s['ordem'] ?? 0) + 0.5]
        );
        $criados++;
    }
    return ['criados' => $criados];
}

// Cria linhas de planejamento F2 na tabela cliente, espelhando os serviços GALPÃO F1.
// Usa quantitativos IFC F2 onde conhecidos (eixos 01-10, 10 ruas); copia prazo/inicio_plan de F1.
function acao_popular_cliente_fase2(array $corpo, array $usuario)
{
    $obraId = obra_atual_id();
    $pdo = bd();

    // Quantitativos IFC para GALPÃO F2 (eixos 01-10, 10 ruas × 43 joists/rua = 430; 13 vigas/rua = 130)
    $qtdF2 = ['IÇAMENTO JOIST' => 430, 'VIGAS' => 130];

    $linhasF1 = $pdo->prepare(
        "SELECT * FROM cliente WHERE obra_id = ? AND frente LIKE 'GALPÃO F1%' ORDER BY id"
    );
    $linhasF1->execute([$obraId]);
    $f1 = $linhasF1->fetchAll(PDO::FETCH_ASSOC);

    $stExist = $pdo->prepare(
        "SELECT servico FROM cliente WHERE obra_id = ? AND frente = 'GALPÃO F2'"
    );
    $stExist->execute([$obraId]);
    $jaExiste = array_flip(array_column($stExist->fetchAll(PDO::FETCH_ASSOC), 'servico'));

    $ins = $pdo->prepare(
        'INSERT INTO cliente (obra_id, servico, qtd, inicio_plan, meta_dia, du_semana, responsavel, obs, prazo, peso, frente)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );

    $criados = 0;
    $vistos = [];
    foreach ($f1 as $row) {
        $serv = nome_servico_padrao($row['servico']);
        if (isset($jaExiste[$serv]) || isset($vistos[$serv])) continue;
        $vistos[$serv] = true;

        $qtd = $qtdF2[$serv] ?? null;
        // meta_dia proporcional ao quantitativo F2/F1; se não houver qtd definida, copia
        $metaDia = null;
        $qtdF1 = (float)($row['qtd'] ?? 0);
        $metaF1 = (float)($row['meta_dia'] ?? 0);
        if ($qtd && $qtdF1 > 0 && $metaF1 > 0) {
            $metaDia = round($metaF1 * $qtd / $qtdF1, 2);
        } elseif ($metaF1 > 0) {
            $metaDia = $metaF1;
        }

        $ins->execute([
            $obraId, $row['servico'], $qtd,
            $row['inicio_plan'], $metaDia, $row['du_semana'],
            $row['responsavel'], null,
            $row['prazo'], $row['peso'], 'GALPÃO F2',
        ]);
        $criados++;
    }
    return ['criados' => $criados];
}

function acao_atualizar_datas_cronograma(array $corpo, array $usuario)
{
    $obraId = obra_atual_id();
    $pdo = bd();
    $force = !empty($corpo['force']);

    $duUtil = function(string $ini, string $fim): int {
        try {
            $d = new DateTime($ini); $f = new DateTime($fim); $n = 0;
            while ($d <= $f) { if ((int)$d->format('N') < 6) $n++; $d->modify('+1 day'); }
            return max($n, 1);
        } catch (\Throwable $e) { return 1; }
    };

    // [grupo, padrao_servico, inicio_plan, prazo]  — fonte: F.PLA.005 Cronograma Rótula LSF G200
    $mapa = [
        ['F1', 'IÇAMENTO JOIST', '2026-07-23', '2026-11-19'],
        ['F1', 'PREMONTAGEM',    '2026-07-23', '2026-11-16'],
        ['F1', 'PRÉ-MONTAGEM',  '2026-07-23', '2026-11-16'],
        ['F1', 'PRE-MONTAGEM',  '2026-07-23', '2026-11-16'],
        ['F1', 'VIGAS',         '2026-07-28', '2026-11-05'],
        ['F1', 'TELHAS',        '2026-09-09', '2026-12-04'],
        ['F1', 'CALHAS',        '2026-09-16', '2026-12-04'],
        ['F1', 'ARREMATES',     '2026-09-23', '2026-12-11'],
        ['F1', 'FECHAMENTO',    '2026-09-17', '2026-12-18'],
        ['F1', 'MARQUISE',      '2026-09-24', '2026-12-30'],
        ['F1', 'PERFILAÇÃO',    '2026-07-23', '2026-11-05'],
        ['F1', 'PERFILACAO',    '2026-07-23', '2026-11-05'],
        ['F2', 'IÇAMENTO JOIST', '2026-09-18', '2027-03-05'],
        ['F2', 'PREMONTAGEM',    '2026-09-25', '2027-02-26'],
        ['F2', 'PRÉ-MONTAGEM',  '2026-09-25', '2027-02-26'],
        ['F2', 'PRE-MONTAGEM',  '2026-09-25', '2027-02-26'],
        ['F2', 'VIGAS',         '2026-09-18', '2027-03-23'],
        ['F2', 'TELHAS',        '2026-11-01', '2027-04-08'],
        ['F2', 'CALHAS',        '2026-12-10', '2027-04-08'],
        ['F2', 'ARREMATES',     '2027-01-05', '2027-04-08'],
        ['F2', 'FECHAMENTO',    '2026-11-12', '2027-04-30'],
        ['F2', 'MARQUISE',      '2026-12-22', '2027-04-16'],
        ['F2', 'PERFILAÇÃO',    '2026-09-18', '2027-03-05'],
        ['F2', 'PERFILACAO',    '2026-09-18', '2027-03-05'],
        ['ANEX', 'ECLUSA',      '2026-09-08', '2026-11-16'],
        ['ANEX', 'PORTARIA',    '2026-09-17', '2026-11-25'],
        ['ANEX', 'REFEITÓRIO',  '2026-09-29', '2026-12-02'],
        ['ANEX', 'REFEITORIO',  '2026-09-29', '2026-12-02'],
        ['ANEX', 'VESTIÁRIO',   '2026-10-08', '2026-12-21'],
        ['ANEX', 'VESTIARIO',   '2026-10-08', '2026-12-21'],
        ['ANEX', 'PASSAREL',    '2026-09-08', '2027-01-07'],
        ['ANEX', 'PEDESTRE',    '2026-10-08', '2027-01-07'],
        ['ANEX', 'VIVÊNCIA',    '2026-09-08', '2027-01-07'],
        ['ANEX', 'VIVENCIA',    '2026-09-08', '2027-01-07'],
    ];

    $atualizados = 0;
    foreach ($mapa as [$grupo, $servPat, $ini, $pra]) {
        if ($grupo === 'F1') {
            $fCond = "AND frente LIKE 'GALPÃO F1%'";
        } elseif ($grupo === 'F2') {
            $fCond = "AND frente = 'GALPÃO F2'";
        } else {
            $fCond = "AND (frente IS NULL OR frente = '' OR (frente NOT LIKE 'GALPÃO F1%' AND frente NOT LIKE 'GALPÃO F2%'))";
        }
        $fxCond = $force ? '' : 'AND (inicio_plan IS NULL OR prazo IS NULL)';
        $sql = "UPDATE cliente SET inicio_plan=?, prazo=?
                WHERE obra_id=? AND servico LIKE ? COLLATE utf8mb4_unicode_ci $fCond $fxCond";
        $st = $pdo->prepare($sql);
        $st->execute([$ini, $pra, $obraId, '%' . $servPat . '%']);
        $atualizados += $st->rowCount();
    }

    // Preenche meta_dia onde está NULL: qtd / dias_úteis(inicio_plan, prazo)
    $rows = $pdo->prepare(
        "SELECT id, qtd, inicio_plan, prazo FROM cliente
         WHERE obra_id=? AND qtd>0 AND inicio_plan IS NOT NULL
           AND prazo IS NOT NULL AND (meta_dia IS NULL OR meta_dia=0)"
    );
    $rows->execute([$obraId]);
    $updMeta = $pdo->prepare('UPDATE cliente SET meta_dia=? WHERE id=?');
    foreach ($rows->fetchAll(PDO::FETCH_ASSOC) as $r) {
        $du   = $duUtil($r['inicio_plan'], $r['prazo']);
        $meta = round((float)$r['qtd'] / $du, 2);
        $updMeta->execute([$meta, $r['id']]);
        $atualizados++;
    }

    return ['atualizados' => $atualizados];
}
