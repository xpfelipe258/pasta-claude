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
                'modificado' => sistema_ler('modificado', date('c')),
                'usuario' => ['nome' => $usuario['nome'], 'perfil' => $usuario['perfil'], 'empresa' => $usuario['empresa']],
                'recursos' => ['importar_mensal' => false, 'exportar' => false, 'online' => true],
                'modelo' => montar_modelo(),
            ]);
        }
        if ($rota === 'atualizacao') {   // o sistema online está sempre na versão publicada
            responder_json(200, ['online' => true, 'codigo' => sistema_ler('versao', '0'), 'ativo' => false,
                'intervalo' => 0, 'resultado' => 'online', 'detalhe' => 'Sistema online: sempre na versão publicada.']);
        }
        if ($rota === 'regras-baixa') {
            $p = __DIR__ . '/inc/regras_baixa.json';
            if (!is_file($p)) {
                responder_json(404, ['erro' => 'regras_baixa.json não encontrado.']);
            }
            responder_json(200, json_decode(file_get_contents($p), true));
        }
        if ($rota === 'frentes-montagem') {
            $d = frentes_montagem();
            if ($d === null) {
                responder_json(404, ['erro' => 'Mapa das frentes não publicado.']);
            }
            responder_json(200, $d);
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
    if ($usuario['perfil'] === 'leitura') {
        responder_json(403, ['erro' => 'Seu usuário é somente leitura.']);
    }
    $corpo = json_decode(file_get_contents('php://input'), true);
    if (!is_array($corpo)) {
        throw new ErroValidacao('Dados inválidos.');
    }
    $acoes = [
        'producao' => 'acao_producao', 'metas' => 'acao_metas', 'impacto' => 'acao_impacto',
        'registro' => 'acao_registro', 'equip/importar' => 'acao_importar_mensal',
        'bm/apontar' => 'acao_bm_apontar', 'bm/semear' => 'acao_bm_semear',
        'bm/fechar' => 'acao_bm_fechar', 'bm/reabrir' => 'acao_bm_reabrir',
        'apontamento' => 'acao_apontamento', 'referencia' => 'acao_referencia',
        'estoque/semear-materiais' => 'acao_semear_materiais',
        'estoque-planilha/remessa' => 'acao_estoque_remessa', 'estoque-planilha/consumo' => 'acao_estoque_consumo',
        'planejamento' => 'acao_salvar_planejamento',
        'dados-producao/importar' => 'acao_importar_snapshot',
        'machine-token/gerar' => 'acao_gerar_machine_token',
        'machine-token/revogar' => 'acao_revogar_machine_token',
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

function acao_impacto(array $corpo)
{
    $id = isset($corpo['linha']) ? (int)$corpo['linha'] : null;
    if ($id !== null && !q('SELECT id FROM impactos WHERE id = ?', [$id])->fetch()) {
        throw new ErroValidacao('Impacto não encontrado.');
    }
    if (!empty($corpo['excluir'])) {
        q('DELETE FROM impactos WHERE id = ?', [$id]);
        return 1;
    }
    $campos = ['data', 'servico', 'motivo', 'solucionado', 'tempo', 'quando', 'paralisacao'];
    $vals = [];
    foreach ($campos as $c) {
        if (array_key_exists($c, $corpo)) {
            $vals[$c] = texto_ou_nulo($corpo[$c]);
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
    if ($tabela === 'materiais' && empty($campos['codigo']) && $id === null) {
        $existentes = q('SELECT codigo FROM materiais')->fetchAll(PDO::FETCH_COLUMN);
        for ($i = 1; in_array(sprintf('MAT-%03d', $i), $existentes, true); $i++) {
        }
        $campos['codigo'] = sprintf('MAT-%03d', $i);
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
            $vals[$c] = mb_substr(trim((string)$v), 0, 255);
        }
    }
    return gravar_linha($tabela, $id, $vals);
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
    $porTag = [];
    foreach ($dados['remessas']['itens'] as $i => $it) {
        $porTag[$it['tag']] = $i;
    }
    $lancamentos = [];
    foreach (itens_do_corpo($corpo) as $k => $it) {
        $n = $k + 1;
        $tag = mb_strtoupper(trim((string)($it['tag'] ?? '')));
        if ($tag === '') {
            throw new ErroValidacao("Item $n: escolha a TAG do material.");
        }
        if (!isset($porTag[$tag])) {
            throw new ErroValidacao("Item $n: TAG $tag não existe nas remessas. Escolha uma da lista.");
        }
        $lancamentos[$tag] = ($lancamentos[$tag] ?? 0) + qtd_positiva($it, $n);
    }
    if (!in_array($nome, $dados['remessas']['colunas'], true)) {
        $dados['remessas']['colunas'][] = $nome;
    }
    foreach ($lancamentos as $tag => $qtd) {
        $item = &$dados['remessas']['itens'][$porTag[$tag]];
        $item['qtd_por_remessa'][$nome] = ($item['qtd_por_remessa'][$nome] ?? 0) + $qtd;
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
    estoque_planilha_gravar($dados);
    return ['celulas' => count($lancamentos), 'salvos' => count($lancamentos)];
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
        $tag = mb_strtoupper(trim((string)($it['tag'] ?? '')));
        $empresa = mb_strtoupper(trim((string)($it['empresa'] ?? $corpo['empresa'] ?? '')));
        if ($tag === '') {
            throw new ErroValidacao("Item $n: escolha a TAG do material.");
        }
        if (!isset($porTag[$tag])) {
            throw new ErroValidacao("Item $n: TAG $tag não existe no consumo. Escolha uma da lista.");
        }
        if (!in_array($empresa, ['EJ', 'CMM'], true)) {
            throw new ErroValidacao("Item $n: empresa deve ser EJ ou CMM.");
        }
        $chave = "$tag|$empresa";
        $lancamentos[$chave] = ($lancamentos[$chave] ?? 0) + qtd_positiva($it, $n);
    }
    if (!in_array($semana, $dados['consumo_fisico']['semanas'], true)) {
        $dados['consumo_fisico']['semanas'][] = $semana;
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

// ------------------------------------------------- apontamento de montagem (joists e vigas)

// Soma `delta` na célula (empresa, serviço, dia) do controle de produção, que é de onde o BM,
// o cronograma e os dashboards leem a produção.
function soma_producao($empresaNome, $servico, $data, $delta, array $usuario)
{
    $emp = q('SELECT * FROM empresas WHERE nome = ?', [$empresaNome])->fetch();
    if (!$emp) {
        throw new ErroValidacao("Empresa $empresaNome não existe no controle de produção.");
    }
    if (!empty($usuario['empresa']) && $usuario['empresa'] !== $emp['nome']) {
        throw new ErroValidacao('Seu usuário só pode apontar montagem da empresa ' . $usuario['empresa'] . '.');
    }
    $col = q('SELECT col FROM servicos WHERE empresa_id = ? AND nome = ?', [$emp['id'], $servico])->fetchColumn();
    if (!$col) {
        throw new ErroValidacao("{$emp['nome']} não tem o serviço $servico no controle de produção.");
    }
    $atual = q('SELECT valor_num, valor_txt FROM producao WHERE empresa_id = ? AND data = ? AND col = ?',
        [$emp['id'], $data, $col])->fetch();
    if ($atual && $atual['valor_txt'] !== null) {
        throw new ErroValidacao("A célula de $servico de {$emp['nome']} em $data contém texto. Corrija em Lançamentos.");
    }
    $novo = max(0, (float)($atual['valor_num'] ?? 0) + $delta);
    q('DELETE FROM producao WHERE empresa_id = ? AND data = ? AND col = ?', [$emp['id'], $data, $col]);
    if ($novo > 0) {
        q('INSERT INTO producao (empresa_id, data, col, valor_num) VALUES (?, ?, ?, ?)', [$emp['id'], $data, $col, $novo]);
    }
    return 1;
}

// Frentes montadas fora do plano das joists (fechamento lateral, marquise, contraventamento),
// com os trechos vindos do mapa extraído do IFC.
function tipos_frente()
{
    return ['FECHAMENTO' => 'fechamento', 'MARQUISE' => 'marquise', 'CONTRAVENTAMENTO' => 'contraventamento'];
}

function frentes_montagem()
{
    $salvo = json_decode((string)sistema_ler('frentes_montagem', 'null'), true);
    if (is_array($salvo)) { return $salvo; }
    if (sistema_ler('dados_legados', '0') !== '1') { return null; }
    $p = __DIR__ . '/inc/frentes_montagem.json';
    if (!is_file($p)) {
        return null;
    }
    $d = json_decode(file_get_contents($p), true);
    return is_array($d) ? $d : null;
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
        if (isset($ja[$chave])) {
            $quando = $ja[$chave]['data'] ?? null;
            $rot = "{$parte['nome']} · $trecho" . ($etapa ? " · $etapa" : '');
            throw new ErroValidacao("$rot já foi apontado" .
                ($quando ? ' em ' . substr($quando, 8, 2) . '/' . substr($quando, 5, 2) . '/' . substr($quando, 0, 4) . '.' : '.'));
        }
        $ja[$chave] = ['data' => $data];
        $novas[] = $base + ['tipo' => $tipo, 'faixa' => $parte['id'], 'rua' => $trecho, 'letra' => $etapa ?: null, 'qtd' => 1];
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
    foreach (($corpo['lote'] ?? [$corpo]) as $item) {
        $tipo = mb_strtoupper((string)($item['tipo'] ?? ''));
        $empNome = (string)($item['empresa'] ?? $corpo['empresa'] ?? '');
        if ($empNome === '' || !q('SELECT id FROM empresas WHERE nome = ?', [$empNome])->fetch()) {
            throw new ErroValidacao('Indique a empresa que montou.');
        }
        $base = ['data' => $data, 'empresa' => $empNome, 'lanca_producao' => $lanca ? 'SIM' : 'NÃO',
            'obs' => texto_ou_nulo($corpo['obs'] ?? null)];
        $doItem = [];
        if (isset(tipos_frente()[$tipo])) {
            if (!$frentes) {
                throw new ErroValidacao('Mapa das frentes não publicado no sistema online.');
            }
            list($doItem, $servico) = frente_item($item, $frentes, $frentesJa, $base, $data);
            if (!$doItem) {
                continue;
            }
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
        } elseif ($tipo === 'VIGA') {
            $eixo = (string)($item['eixo'] ?? '');
            if (!in_array($eixo, $cfg['eixos'], true)) {
                throw new ErroValidacao('Eixo inválido (01 a 20).');
            }
            $letras = [];
            foreach (($item['letras'] ?? []) as $l) {
                $letras[mb_strtoupper((string)$l)] = true;
            }
            foreach (array_keys($letras) as $letra) {
                if (!isset($crit[$letra])) {
                    throw new ErroValidacao("Letra de viga inválida: $letra.");
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
        } else {
            throw new ErroValidacao('Tipo de apontamento inválido (JOIST, VIGA, FECHAMENTO, MARQUISE ou CONTRAVENTAMENTO).');
        }
        $novas = array_merge($novas, $doItem);
        $chave = $empNome . '|' . (string)$servico;
        if (!isset($grupos[$chave])) {
            $grupos[$chave] = ['empresa' => $empNome, 'servico' => $servico, 'delta' => 0];
        }
        $grupos[$chave]['delta'] += count($doItem);
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
    if ($lanca) {
        foreach ($grupos as $g) {
            if ($g['servico']) {
                soma_producao($g['empresa'], $g['servico'], $data, $g['delta'], $usuario);
            }
        }
    }
    return ['celulas' => count($novas), 'salvos' => count($novas), 'avisos' => [], 'linhas' => $ids];
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
    foreach ($alvo as $lin) {
        $lin = (int)$lin;
        if (!isset($porLinha[$lin])) {
            throw new ErroValidacao('Apontamento não encontrado (os dados podem ter mudado). Recarregue a tela.');
        }
        $r = $porLinha[$lin];
        $t = mb_strtoupper((string)($r['tipo'] ?? ''));
        if (mb_strtoupper((string)($r['lanca_producao'] ?? '')) === 'SIM' && !empty($r['data']) && !empty($r['empresa'])) {
            if (isset(tipos_frente()[$t])) {
                $fs = (frentes_montagem()['frentes'] ?? [])[tipos_frente()[$t]] ?? [];
                $servico = $r['letra'] ?: ($fs['servico'] ?? null);
                if (!$servico) {
                    continue;
                }
            } else {
                $servico = $t === 'JOIST' ? ($cfg['servico_joist'] ?? '') : ($cfg['servico_viga'] ?? '');
            }
            $chave = $r['empresa'] . '|' . $servico . '|' . $r['data'];
            $somas[$chave] = ($somas[$chave] ?? 0) - (float)($r['qtd'] ?? 0);
        }
    }
    foreach ($somas as $chave => $delta) {
        list($nome, $servico, $dia) = explode('|', $chave);
        soma_producao($nome, $servico, $dia, $delta, $usuario);
    }
    foreach ($alvo as $lin) {
        q('DELETE FROM apontamentos WHERE id = ?', [(int)$lin]);
    }
    return ['celulas' => count($alvo), 'avisos' => []];
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
