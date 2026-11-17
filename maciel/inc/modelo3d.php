<?php
// Modelo 3D / planejamento 4D da obra.
//  • modelos_3d    — cada IFC enviado (o arquivo fica em dados_obras/{obra}/modelo3d, fora do alcance público, e só sai por modelo3d.php).
//                    O navegador converte o IFC uma vez e devolve o resultado ("cache") para o servidor: as próximas aberturas não reconvertem.
//  • m3d_grupos    — grupo de montagem: elementos do modelo com início/término previstos, situação, equipe e atividade do cronograma.
//  • m3d_elementos — vínculo GUID do elemento (GlobalId do IFC) → grupo. Um elemento fica em um grupo só por modelo.
// As três ficam fora de tabelas_spec() de propósito: são grandes e não vão no modelo geral que toda tela carrega.

if (!class_exists('ErroValidacao')) {
    class ErroValidacao extends Exception
    {
    }
}

const M3D_CACHE_VERSAO = 2;          // 2: peso e posição de cada elemento. Muda quando o formato do modelo convertido muda (o navegador reconverte)
const M3D_TAMANHO_MAX = 524288000;   // 500 MB por IFC
const M3D_PARTE_MAX = 16777216;      // 16 MB por parte enviada
const M3D_GUIDS_MAX = 80000;         // elementos por gravação

function modelos_3d_sql($pk, $fim)
{
    return "CREATE TABLE IF NOT EXISTS modelos_3d (id $pk, obra_id INT NOT NULL, nome VARCHAR(160) NOT NULL, arquivo VARCHAR(80) NULL, doc_id INT NULL,
        tamanho DOUBLE NULL, sha256 VARCHAR(64) NULL, cache_geo VARCHAR(80) NULL, cache_props VARCHAR(80) NULL, cache_v INT NOT NULL DEFAULT 0,
        n_elementos INT NOT NULL DEFAULT 0, n_unidades INT NOT NULL DEFAULT 0, frentes_auto INT NOT NULL DEFAULT 0, por VARCHAR(100) NULL, em VARCHAR(19) NULL)$fim";
}

function m3d_grupos_sql($pk, $longo, $fim)
{
    return "CREATE TABLE IF NOT EXISTS m3d_grupos (id $pk, obra_id INT NOT NULL, modelo_id INT NOT NULL, nome VARCHAR(160) NOT NULL,
        atividade VARCHAR(255) NULL, empresa VARCHAR(100) NULL, responsavel VARCHAR(100) NULL, inicio DATE NULL, fim DATE NULL,
        status VARCHAR(15) NOT NULL DEFAULT 'nao_iniciado', concluido_em DATE NULL, obs $longo NULL,
        por VARCHAR(100) NULL, em VARCHAR(19) NULL, atualizado_por VARCHAR(100) NULL, atualizado_em VARCHAR(19) NULL)$fim";
}

function m3d_elementos_sql($fim)
{
    return "CREATE TABLE IF NOT EXISTS m3d_elementos (obra_id INT NOT NULL, modelo_id INT NOT NULL, grupo_id INT NOT NULL, guid VARCHAR(40) NOT NULL,
        rotulo VARCHAR(120) NULL, PRIMARY KEY (modelo_id, guid))$fim";
}

function m3d_apontamentos_sql($pk, $fim)
{
    return "CREATE TABLE IF NOT EXISTS m3d_apontamentos (id $pk, obra_id INT NOT NULL, modelo_id INT NOT NULL, guid VARCHAR(40) NOT NULL, etapa VARCHAR(10) NOT NULL,
        data DATE NOT NULL, empresa VARCHAR(100) NULL, inferida INT NOT NULL DEFAULT 0, por VARCHAR(100) NULL, em VARCHAR(19) NULL, UNIQUE (modelo_id, guid, etapa))$fim";
}

/** Cria as tabelas se faltarem (banco instalado antes desta versão). */
function garantir_modelo3d()
{
    static $ok = false;
    if ($ok) { return; }
    $c = config();
    $mysql = ($c['driver'] ?? '') === 'mysql';
    $pk = $mysql ? 'INT AUTO_INCREMENT PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
    $fim = $mysql ? ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4' : '';
    $pdo = bd();
    $pdo->exec(modelos_3d_sql($pk, $fim));
    $pdo->exec(m3d_grupos_sql($pk, $mysql ? 'MEDIUMTEXT' : 'TEXT', $fim));
    $pdo->exec(m3d_elementos_sql($fim));
    $pdo->exec(m3d_apontamentos_sql($pk, $fim));
    if (!in_array('frentes_auto', colunas_tabela($pdo, $mysql ? 'mysql' : 'sqlite', 'modelos_3d'), true)) {   // bancos criados antes desta coluna
        $pdo->exec('ALTER TABLE modelos_3d ADD COLUMN frentes_auto INT NOT NULL DEFAULT 0');
    }
    $ok = true;
}

function m3d_status()
{
    return ['nao_iniciado' => 'Não iniciado', 'em_andamento' => 'Em andamento', 'concluido' => 'Concluído'];
}

function m3d_agora()
{
    return (new DateTimeImmutable('now', new DateTimeZone('America/Sao_Paulo')))->format('Y-m-d H:i:s');
}

function m3d_dir($obraId)
{
    require_once __DIR__ . '/importacao.php';
    $d = importacao_diretorio((int)$obraId) . '/modelo3d';
    if (!is_dir($d)) { @mkdir($d, 0755, true); }
    return $d;
}

/** Caminho do IFC de um modelo (enviado aqui, ou o documento IFC guardado pela importação da obra). */
function m3d_caminho_ifc(array $m, $obraId)
{
    if (!empty($m['doc_id'])) {
        $d = q_global("SELECT arquivo FROM obra_documentos WHERE id = ? AND obra_id = ? AND tipo = 'ifc'", [(int)$m['doc_id'], (int)$obraId])->fetch();
        require_once __DIR__ . '/importacao.php';
        return $d ? importacao_diretorio((int)$obraId) . '/' . basename((string)$d['arquivo']) : '';
    }
    return $m['arquivo'] ? m3d_dir($obraId) . '/' . basename((string)$m['arquivo']) : '';
}

function m3d_modelo($id)
{
    $m = q('SELECT * FROM modelos_3d WHERE id = ?', [(int)$id])->fetch();
    return $m ?: null;
}

function m3d_modelo_publico(array $m)
{
    return ['id' => (int)$m['id'], 'nome' => $m['nome'], 'tamanho' => (float)$m['tamanho'], 'por' => $m['por'], 'em' => $m['em'],
        'cache' => ((int)$m['cache_v'] === M3D_CACHE_VERSAO && $m['cache_geo']) ? 1 : 0, 'frentes_auto' => (int)($m['frentes_auto'] ?? 0), 'elementos' => (int)$m['n_elementos'], 'unidades' => (int)$m['n_unidades']];
}

/** Modelos da obra + IFCs já guardados pela importação (que podem virar modelo sem novo envio). */
function m3d_estado(array $u)
{
    $obraId = obra_atual_id();
    $modelos = array_map('m3d_modelo_publico', q('SELECT * FROM modelos_3d ORDER BY id')->fetchAll());
    $usados = array_filter(array_map('intval', q('SELECT doc_id FROM modelos_3d WHERE doc_id IS NOT NULL')->fetchAll(PDO::FETCH_COLUMN)));
    $docs = [];
    try {
        foreach (q_global("SELECT id, nome_original, tamanho FROM obra_documentos WHERE obra_id = ? AND tipo = 'ifc' AND status = 'valido' ORDER BY id", [$obraId])->fetchAll() as $d) {
            if (strtolower(pathinfo((string)$d['nome_original'], PATHINFO_EXTENSION)) === 'ifc' && !in_array((int)$d['id'], $usados, true)) {
                $docs[] = ['id' => (int)$d['id'], 'nome' => $d['nome_original'], 'tamanho' => (float)$d['tamanho']];
            }
        }
    } catch (Throwable $e) {
        $docs = [];
    }
    return ['modelos' => $modelos, 'docs_ifc' => $docs, 'demo' => obra_eh_demo($obraId) ? 1 : 0, 'pode_editar' => m3d_pode_editar($u) ? 1 : 0, 'empresa' => usuario_empresa_restrita($u),
        'cache_versao' => M3D_CACHE_VERSAO, 'status' => m3d_status(), 'hoje' => substr(m3d_agora(), 0, 10)];
}

function m3d_pode_editar(array $u)
{
    return usuario_pode_modulo($u, 'producao') && !usuario_so_leitura($u, 'producao');
}

function m3d_grupos_ler($modeloId)
{
    $grupos = [];
    foreach (q('SELECT * FROM m3d_grupos WHERE modelo_id = ? ORDER BY inicio, id', [(int)$modeloId])->fetchAll() as $g) {
        $grupos[(int)$g['id']] = ['id' => (int)$g['id'], 'nome' => $g['nome'], 'atividade' => (string)$g['atividade'], 'empresa' => (string)$g['empresa'],
            'responsavel' => (string)$g['responsavel'], 'inicio' => $g['inicio'] ? substr((string)$g['inicio'], 0, 10) : '', 'fim' => $g['fim'] ? substr((string)$g['fim'], 0, 10) : '',
            'status' => $g['status'], 'concluido_em' => $g['concluido_em'] ? substr((string)$g['concluido_em'], 0, 10) : '', 'obs' => (string)$g['obs'],
            'atualizado_por' => (string)($g['atualizado_por'] ?: $g['por']), 'atualizado_em' => (string)($g['atualizado_em'] ?: $g['em']), 'guids' => []];
    }
    foreach (q('SELECT grupo_id, guid FROM m3d_elementos WHERE modelo_id = ?', [(int)$modeloId])->fetchAll() as $e) {
        if (isset($grupos[(int)$e['grupo_id']])) {
            $grupos[(int)$e['grupo_id']]['guids'][] = $e['guid'];
        }
    }
    return ['grupos' => array_values($grupos)];
}

function m3d_guids_validos($lista)
{
    if (!is_array($lista)) { throw new ErroValidacao('Lista de elementos inválida.'); }
    if (count($lista) > M3D_GUIDS_MAX) { throw new ErroValidacao('Muitos elementos de uma vez (máximo ' . M3D_GUIDS_MAX . ').'); }
    $ok = [];
    foreach ($lista as $g) {
        if (!is_string($g) || !preg_match('/^[0-9A-Za-z_$\-]{8,40}$/', $g)) { throw new ErroValidacao('Identificador de elemento inválido.'); }
        $ok[$g] = true;
    }
    return array_keys($ok);
}

/** Usuário de empresa só mexe nos grupos da própria empresa. */
function m3d_conferir_empresa(array $u, $empresaDoGrupo)
{
    $minha = usuario_empresa_restrita($u);
    if ($minha !== '' && mb_strtoupper(trim((string)$empresaDoGrupo)) !== mb_strtoupper($minha)) {
        throw new ErroValidacao('Este grupo é de outra empresa: você só altera os grupos da ' . $minha . '.');
    }
}

function m3d_grupo_salvar(array $c, array $u)
{
    $modelo = m3d_modelo($c['modelo_id'] ?? 0);
    if (!$modelo) { throw new ErroValidacao('Modelo não encontrado.'); }
    $id = (int)($c['id'] ?? 0);
    $atual = $id ? q('SELECT * FROM m3d_grupos WHERE id = ? AND modelo_id = ?', [$id, (int)$modelo['id']])->fetch() : null;
    if ($id && !$atual) { throw new ErroValidacao('Grupo não encontrado.'); }
    if ($atual) { m3d_conferir_empresa($u, $atual['empresa']); }
    $nome = trim((string)($c['nome'] ?? ''));
    if (mb_strlen($nome) < 2 || mb_strlen($nome) > 160) { throw new ErroValidacao('Informe o nome do grupo de montagem (2 a 160 caracteres).'); }
    $ini = trim((string)($c['inicio'] ?? ''));
    $fim = trim((string)($c['fim'] ?? ''));
    if (!data_valida($ini) || !data_valida($fim)) { throw new ErroValidacao('Informe a data de início e a data de término previstas.'); }
    if ($fim < $ini) { throw new ErroValidacao('A data de término não pode ser antes do início.'); }
    $status = (string)($c['status'] ?? 'nao_iniciado');
    if (!isset(m3d_status()[$status])) { throw new ErroValidacao('Situação inválida.'); }
    $concl = trim((string)($c['concluido_em'] ?? ''));
    if ($status !== 'concluido') {
        $concl = '';
    } elseif ($concl === '') {
        $concl = substr(m3d_agora(), 0, 10);
    } elseif (!data_valida($concl)) {
        throw new ErroValidacao('Data de conclusão inválida.');
    }
    $empresa = mb_substr(trim((string)($c['empresa'] ?? '')), 0, 100);
    $minha = usuario_empresa_restrita($u);
    if ($minha !== '') { $empresa = $minha; }
    $campos = [$nome, mb_substr(trim((string)($c['atividade'] ?? '')), 0, 255), $empresa, mb_substr(trim((string)($c['responsavel'] ?? '')), 0, 100),
        $ini, $fim, $status, $concl ?: null, mb_substr(trim((string)($c['obs'] ?? '')), 0, 4000)];
    $agora = m3d_agora();
    if ($atual) {
        q('UPDATE m3d_grupos SET nome = ?, atividade = ?, empresa = ?, responsavel = ?, inicio = ?, fim = ?, status = ?, concluido_em = ?, obs = ?, atualizado_por = ?, atualizado_em = ? WHERE id = ?',
            array_merge($campos, [(string)$u['nome'], $agora, $id]));
    } else {
        q('INSERT INTO m3d_grupos (modelo_id, nome, atividade, empresa, responsavel, inicio, fim, status, concluido_em, obs, por, em, atualizado_por, atualizado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            array_merge([(int)$modelo['id']], $campos, [(string)$u['nome'], $agora, (string)$u['nome'], $agora]));
        $id = (int)bd()->lastInsertId();
    }
    $rot = is_array($c['rotulos'] ?? null) ? $c['rotulos'] : [];
    if (array_key_exists('guids', $c)) {   // lista completa: o grupo passa a ter exatamente estes elementos
        $guids = m3d_guids_validos($c['guids']);
        q('DELETE FROM m3d_elementos WHERE modelo_id = ? AND grupo_id = ?', [(int)$modelo['id'], $id]);
        m3d_vincular((int)$modelo['id'], $id, $guids, $rot);
    } else {
        if (!empty($c['remover'])) { m3d_desvincular((int)$modelo['id'], m3d_guids_validos($c['remover']), $id); }
        if (!empty($c['adicionar'])) { m3d_vincular((int)$modelo['id'], $id, m3d_guids_validos($c['adicionar']), $rot); }
    }
    return ['ok' => true, 'id' => $id];
}

/** Etapas do IFC viram frentes de montagem: roda uma vez por modelo, só quando ele ainda não tem frente nenhuma.
 *  Datas vêm do navegador (casadas com o cronograma pelo nome); sem casar, a frente nasce sem prazo. */
function m3d_frentes_auto(array $c, array $u)
{
    $modelo = m3d_modelo($c['modelo_id'] ?? 0);
    if (!$modelo) { throw new ErroValidacao('Modelo não encontrado.'); }
    if ((int)$modelo['frentes_auto'] === 1 || q('SELECT COUNT(*) FROM m3d_grupos WHERE modelo_id = ?', [(int)$modelo['id']])->fetchColumn() > 0) {
        q('UPDATE modelos_3d SET frentes_auto = 1 WHERE id = ?', [(int)$modelo['id']]);
        return ['ok' => true, 'criadas' => 0];
    }
    $lista = is_array($c['frentes'] ?? null) ? array_slice($c['frentes'], 0, 300) : [];
    $agora = m3d_agora();
    $minha = usuario_empresa_restrita($u);
    $criadas = 0;
    $total = 0;
    foreach ($lista as $f) {
        $nome = mb_substr(trim((string)($f['nome'] ?? '')), 0, 160);
        $guids = m3d_guids_validos($f['guids'] ?? []);
        $total += count($guids);
        if ($total > M3D_GUIDS_MAX) { throw new ErroValidacao('Modelo grande demais para criar as frentes de uma vez.'); }
        if (mb_strlen($nome) < 2 || !$guids) { continue; }
        $ini = (string)($f['inicio'] ?? '');
        $fim = (string)($f['fim'] ?? '');
        if (!data_valida($ini) || !data_valida($fim) || $fim < $ini) { $ini = null; $fim = null; }
        q('INSERT INTO m3d_grupos (modelo_id, nome, atividade, empresa, responsavel, inicio, fim, status, concluido_em, obs, por, em, atualizado_por, atualizado_em) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, NULL, ?, ?, ?, ?, ?)',
            [(int)$modelo['id'], $nome, mb_substr(trim((string)($f['atividade'] ?? '')), 0, 255), $minha, $ini, $fim, 'nao_iniciado',
                'Criada automaticamente a partir da etapa do IFC.', (string)$u['nome'], $agora, (string)$u['nome'], $agora]);
        m3d_vincular((int)$modelo['id'], (int)bd()->lastInsertId(), $guids, []);
        $criadas++;
    }
    q('UPDATE modelos_3d SET frentes_auto = 1 WHERE id = ?', [(int)$modelo['id']]);
    return ['ok' => true, 'criadas' => $criadas];
}

/** Liga os elementos ao grupo; quem já estava em outro grupo do modelo sai de lá (um elemento = um grupo). */
function m3d_vincular($modeloId, $grupoId, array $guids, array $rotulos)
{
    if (!$guids) { return; }
    m3d_desvincular($modeloId, $guids, 0);
    $obraId = obra_atual_id();
    $st = bd()->prepare('INSERT INTO m3d_elementos (obra_id, modelo_id, grupo_id, guid, rotulo) VALUES (?, ?, ?, ?, ?)');
    foreach ($guids as $g) {
        $r = isset($rotulos[$g]) && is_string($rotulos[$g]) ? mb_substr($rotulos[$g], 0, 120) : null;
        $st->execute([$obraId, $modeloId, $grupoId, $g, $r]);
    }
}

function m3d_desvincular($modeloId, array $guids, $soDoGrupo)
{
    $obraId = obra_atual_id();
    foreach (array_chunk($guids, 400) as $lote) {
        $sql = 'DELETE FROM m3d_elementos WHERE obra_id = ? AND modelo_id = ?' . ($soDoGrupo ? ' AND grupo_id = ?' : '') . ' AND guid IN (' . implode(',', array_fill(0, count($lote), '?')) . ')';
        $p = array_merge([$obraId, $modeloId], $soDoGrupo ? [(int)$soDoGrupo] : [], $lote);
        bd()->prepare($sql)->execute($p);
    }
}

// ---------------------------------------------------------------- apontamento de campo por peça (Içada, Torqueada)
function m3d_etapas_campo()
{
    return ['icada' => 'Içada', 'torqueada' => 'Torqueada'];
}

/** Apontamentos do modelo: lista compacta [guid, 1 = içada | 2 = torqueada, data, empresa, inferida]. */
function m3d_apont_ler($modeloId)
{
    $out = [];
    foreach (q('SELECT guid, etapa, data, empresa, inferida, por FROM m3d_apontamentos WHERE modelo_id = ? ORDER BY data, id', [(int)$modeloId])->fetchAll() as $a) {
        $out[] = [$a['guid'], $a['etapa'] === 'torqueada' ? 2 : 1, substr((string)$a['data'], 0, 10), (string)$a['empresa'], (int)$a['inferida'], (string)$a['por']];
    }
    return ['itens' => $out, 'vigas_aba' => m3d_vigas_da_aba((int)$modeloId)];
}

/**
 * Vigas apontadas na aba Apontar montagem, lidas direto do banco: [chave "EIXO|LETRA", data, empresa, guid ou ''].
 * A chave vem do código da viga no mapa (viga_id = E{eixo}-{letra}-{marca}) ou dos campos eixo/letra. O GUID sai do mapa de
 * vigas gravado pelo 3D (m3d_mapa_vigas: eixo + letra → peça do IFC, por quantidade e posição real).
 */
function m3d_vigas_da_aba($modeloId)
{
    $mapa = m3d_mapa_vigas_ler($modeloId);
    $out = [];
    foreach (q("SELECT data, empresa, eixo, letra, viga_id FROM apontamentos WHERE UPPER(tipo) = 'VIGA' ORDER BY data, id")->fetchAll() as $a) {
        $eixo = (string)($a['eixo'] ?? ''); $letra = (string)($a['letra'] ?? '');
        if (preg_match('/^E(\d{1,2})-(.+)-VC\d+$/i', (string)($a['viga_id'] ?? ''), $m)) { $eixo = $m[1]; $letra = $m[2]; }
        if ($eixo === '' || $letra === '') { continue; }
        $chave = str_pad($eixo, 2, '0', STR_PAD_LEFT) . '|' . mb_strtoupper(trim($letra));
        $out[] = [$chave, substr((string)$a['data'], 0, 10), (string)$a['empresa'], $mapa[$chave] ?? ''];
    }
    return $out;
}

function m3d_mapa_vigas_ler($modeloId)
{
    $todos = json_decode((string)sistema_ler('m3d_mapa_vigas', '{}'), true);
    $m = is_array($todos) ? ($todos[(string)(int)$modeloId] ?? []) : [];
    return is_array($m) ? $m : [];
}

/** Grava o mapa eixo|letra → GUID calculado pelo 3D para o modelo (vale para toda obra com IFC e malha do projeto). */
function m3d_mapa_vigas_gravar(array $c)
{
    $modelo = m3d_modelo($c['modelo_id'] ?? 0);
    if (!$modelo) { throw new ErroValidacao('Modelo não encontrado.'); }
    $mapa = [];
    foreach ((array)($c['mapa'] ?? []) as $k => $g) {
        if (preg_match('/^\d{2}\|[A-Z0-9-]{1,8}$/', (string)$k) && preg_match('/^[0-9A-Za-z_$]{22}$/', (string)$g)) { $mapa[(string)$k] = (string)$g; }
    }
    if (count($mapa) > 2000) { throw new ErroValidacao('Mapa de vigas grande demais.'); }
    $todos = json_decode((string)sistema_ler('m3d_mapa_vigas', '{}'), true);
    if (!is_array($todos)) { $todos = []; }
    $todos[(string)(int)$modelo['id']] = $mapa;
    sistema_gravar('m3d_mapa_vigas', json_encode($todos, JSON_UNESCAPED_UNICODE));
    return ['ok' => true, 'n' => count($mapa)];
}

/** Usuário de empresa só aponta peças das frentes da própria empresa. */
function m3d_conferir_guids_empresa(array $u, $modeloId, array $guids)
{
    $minha = usuario_empresa_restrita($u);
    if ($minha === '') { return; }
    $permitidos = [];
    foreach (q('SELECT e.guid FROM m3d_elementos e JOIN m3d_grupos g ON g.id = e.grupo_id WHERE e.modelo_id = ? AND UPPER(g.empresa) = ?', [(int)$modeloId, mb_strtoupper($minha)])->fetchAll(PDO::FETCH_COLUMN) as $g) {
        $permitidos[$g] = true;
    }
    foreach ($guids as $g) {
        if (empty($permitidos[$g])) { throw new ErroValidacao('Há peças de frentes de outra empresa na seleção: você só aponta as peças das frentes da ' . $minha . '.'); }
    }
}

function m3d_apontar(array $c, array $u)
{
    $modelo = m3d_modelo($c['modelo_id'] ?? 0);
    if (!$modelo) { throw new ErroValidacao('Modelo não encontrado.'); }
    $etapa = (string)($c['etapa'] ?? '');
    if (!isset(m3d_etapas_campo()[$etapa])) { throw new ErroValidacao('Etapa inválida.'); }
    $guids = m3d_guids_validos($c['guids'] ?? []);
    if (!$guids) { throw new ErroValidacao('Selecione uma ou mais peças.'); }
    $data = (string)($c['data'] ?? '');
    $hoje = substr(m3d_agora(), 0, 10);
    if (!data_valida($data)) { throw new ErroValidacao('Data do apontamento inválida.'); }
    if ($data > $hoje) { throw new ErroValidacao('Não é possível apontar em data futura.'); }
    if (function_exists('rdo_dia_validacao') && ($v = rdo_dia_validacao($data))) {
        throw new ErroValidacao(rdo_mensagem_travado($data, $v));
    }
    m3d_conferir_guids_empresa($u, (int)$modelo['id'], $guids);
    $empresa = usuario_empresa_restrita($u);
    $agora = m3d_agora();
    $existe = [];
    foreach (array_chunk($guids, 400) as $lote) {
        $st = bd()->prepare('SELECT guid, etapa, data FROM m3d_apontamentos WHERE obra_id = ? AND modelo_id = ? AND guid IN (' . implode(',', array_fill(0, count($lote), '?')) . ')');
        $st->execute(array_merge([obra_atual_id(), (int)$modelo['id']], $lote));
        foreach ($st->fetchAll() as $r) { $existe[$r['guid'] . '|' . $r['etapa']] = substr((string)$r['data'], 0, 10); }
    }
    $ins = bd()->prepare('INSERT INTO m3d_apontamentos (obra_id, modelo_id, guid, etapa, data, empresa, inferida, por, em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    $novos = 0;
    $inferidas = 0;
    $jaFeitos = 0;
    foreach ($guids as $g) {
        if (isset($existe[$g . '|' . $etapa])) { $jaFeitos++; continue; }
        if ($etapa === 'torqueada' && !isset($existe[$g . '|icada'])) {   // torque sem içamento registrado: registra o içamento no mesmo dia, marcado como inferido
            $ins->execute([obra_atual_id(), (int)$modelo['id'], $g, 'icada', $data, $empresa ?: null, 1, (string)$u['nome'], $agora]);
            $inferidas++;
        } elseif ($etapa === 'torqueada' && $existe[$g . '|icada'] > $data) {
            throw new ErroValidacao('Há peça içada depois desta data: o torque não pode ser antes do içamento.');
        }
        $ins->execute([obra_atual_id(), (int)$modelo['id'], $g, $etapa, $data, $empresa ?: null, 0, (string)$u['nome'], $agora]);
        $novos++;
    }
    return ['ok' => true, 'novos' => $novos, 'inferidas' => $inferidas, 'ja_feitos' => $jaFeitos];
}

/** Desfaz a etapa (desfazer o içamento desfaz também o torque). */
function m3d_desapontar(array $c, array $u)
{
    $modelo = m3d_modelo($c['modelo_id'] ?? 0);
    if (!$modelo) { throw new ErroValidacao('Modelo não encontrado.'); }
    $etapa = (string)($c['etapa'] ?? '');
    if (!isset(m3d_etapas_campo()[$etapa])) { throw new ErroValidacao('Etapa inválida.'); }
    $guids = m3d_guids_validos($c['guids'] ?? []);
    m3d_conferir_guids_empresa($u, (int)$modelo['id'], $guids);
    $etapas = $etapa === 'icada' ? ['icada', 'torqueada'] : ['torqueada'];
    $n = 0;
    foreach (array_chunk($guids, 400) as $lote) {
        $st = bd()->prepare('SELECT DISTINCT data FROM m3d_apontamentos WHERE obra_id = ? AND modelo_id = ? AND etapa IN (' . implode(',', array_fill(0, count($etapas), '?')) . ') AND guid IN (' . implode(',', array_fill(0, count($lote), '?')) . ')');
        $st->execute(array_merge([obra_atual_id(), (int)$modelo['id']], $etapas, $lote));
        foreach ($st->fetchAll(PDO::FETCH_COLUMN) as $d) {
            if (function_exists('rdo_dia_validacao') && ($v = rdo_dia_validacao(substr((string)$d, 0, 10)))) { throw new ErroValidacao(rdo_mensagem_travado(substr((string)$d, 0, 10), $v)); }
        }
        $st = bd()->prepare('DELETE FROM m3d_apontamentos WHERE obra_id = ? AND modelo_id = ? AND etapa IN (' . implode(',', array_fill(0, count($etapas), '?')) . ') AND guid IN (' . implode(',', array_fill(0, count($lote), '?')) . ')');
        $st->execute(array_merge([obra_atual_id(), (int)$modelo['id']], $etapas, $lote));
        $n += $st->rowCount();
    }
    return ['ok' => true, 'removidos' => $n];
}

function m3d_grupo_excluir(array $c, array $u)
{
    $g = q('SELECT * FROM m3d_grupos WHERE id = ?', [(int)($c['id'] ?? 0)])->fetch();
    if (!$g) { throw new ErroValidacao('Grupo não encontrado.'); }
    m3d_conferir_empresa($u, $g['empresa']);
    q('DELETE FROM m3d_elementos WHERE grupo_id = ?', [(int)$g['id']]);
    q('DELETE FROM m3d_grupos WHERE id = ?', [(int)$g['id']]);
    return ['ok' => true];
}

/** Tira elementos de qualquer grupo (ficam sem prazo). */
function m3d_elementos_soltar(array $c, array $u)
{
    $modelo = m3d_modelo($c['modelo_id'] ?? 0);
    if (!$modelo) { throw new ErroValidacao('Modelo não encontrado.'); }
    $guids = m3d_guids_validos($c['guids'] ?? []);
    if (usuario_empresa_restrita($u) !== '') {
        $minha = usuario_empresa_restrita($u);
        $meus = array_map('intval', q('SELECT id FROM m3d_grupos WHERE modelo_id = ? AND UPPER(empresa) = ?', [(int)$modelo['id'], mb_strtoupper($minha)])->fetchAll(PDO::FETCH_COLUMN));
        foreach ($meus as $gid) { m3d_desvincular((int)$modelo['id'], $guids, $gid); }
        return ['ok' => true];
    }
    m3d_desvincular((int)$modelo['id'], $guids, 0);
    return ['ok' => true];
}

function m3d_modelo_excluir(array $c)
{
    $m = m3d_modelo($c['id'] ?? 0);
    if (!$m) { throw new ErroValidacao('Modelo não encontrado.'); }
    $dir = m3d_dir(obra_atual_id());
    foreach (['arquivo', 'cache_geo', 'cache_props'] as $k) {
        if ($m[$k]) { @unlink($dir . '/' . basename((string)$m[$k])); }
    }
    q('DELETE FROM m3d_elementos WHERE modelo_id = ?', [(int)$m['id']]);
    q('DELETE FROM m3d_grupos WHERE modelo_id = ?', [(int)$m['id']]);
    q('DELETE FROM m3d_apontamentos WHERE modelo_id = ?', [(int)$m['id']]);
    q('DELETE FROM modelos_3d WHERE id = ?', [(int)$m['id']]);
    return ['ok' => true];
}

/** Recebe uma parte de arquivo (corpo cru) e devolve o caminho quando o arquivo fecha; null enquanto faltam partes. */
function m3d_receber_parte($dir, $uid, $offset, $total, $final)
{
    if (!preg_match('/^[a-f0-9]{16,40}$/', (string)$uid) || $total <= 0 || $total > M3D_TAMANHO_MAX) {
        throw new ErroValidacao('Envio inválido (arquivo vazio ou maior que ' . (int)(M3D_TAMANHO_MAX / 1048576) . ' MB).');
    }
    if (!is_dir($dir . '/_envio')) { @mkdir($dir . '/_envio', 0755, true); }
    foreach (glob($dir . '/_envio/*.parte') ?: [] as $velho) {   // envios abandonados há mais de um dia
        if (@filemtime($velho) < time() - 86400) { @unlink($velho); }
    }
    $parte = $dir . '/_envio/' . $uid . '.parte';
    $atual = is_file($parte) ? filesize($parte) : 0;
    if ($atual !== (int)$offset) {
        if ((int)$offset === 0) { @unlink($parte); } else { throw new ErroValidacao('Parte fora de ordem. Envie o arquivo de novo.'); }
    }
    $dados = file_get_contents('php://input');
    if ($dados === false || $dados === '' || strlen($dados) > M3D_PARTE_MAX) { throw new ErroValidacao('Parte inválida.'); }
    if (file_put_contents($parte, $dados, FILE_APPEND | LOCK_EX) === false) { throw new RuntimeException('Não consegui gravar o arquivo no servidor.'); }
    clearstatcache(true, $parte);
    if (!$final) { return null; }
    if (filesize($parte) !== (int)$total) {
        @unlink($parte);
        throw new ErroValidacao('O arquivo chegou incompleto. Envie de novo.');
    }
    return $parte;
}

/** Confere que o arquivo é um IFC em texto (STEP). */
function m3d_ifc_valido($caminho)
{
    $h = @fopen($caminho, 'rb');
    $ini = $h ? (string)fread($h, 4096) : '';
    if ($h) { fclose($h); }
    return strpos($ini, 'ISO-10303-21') !== false && stripos($ini, 'HEADER') !== false;
}

/** Um envio só: IFC enviado em "Documentos da obra" vira modelo do 3D (convertido na primeira abertura por quem edita). */
function m3d_modelo_do_documento($obraId, $docId)
{
    try {
        garantir_modelo3d();
        $d = q_global("SELECT * FROM obra_documentos WHERE id = ? AND obra_id = ? AND tipo = 'ifc' AND status = 'valido'", [(int)$docId, (int)$obraId])->fetch();
        if (!$d || strtolower(pathinfo((string)$d['nome_original'], PATHINFO_EXTENSION)) !== 'ifc') { return 0; }
        $ja = q_global('SELECT id FROM modelos_3d WHERE obra_id = ? AND (doc_id = ? OR (sha256 = ? AND sha256 <> \'\'))', [(int)$obraId, (int)$docId, (string)$d['sha256']])->fetchColumn();
        if ($ja) { return (int)$ja; }
        q_global('INSERT INTO modelos_3d (obra_id, nome, doc_id, tamanho, sha256, por, em) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [(int)$obraId, mb_substr(pathinfo((string)$d['nome_original'], PATHINFO_FILENAME), 0, 160), (int)$d['id'], (float)$d['tamanho'], (string)$d['sha256'], 'Documentos da obra', m3d_agora()]);
        return (int)bd()->lastInsertId();
    } catch (Throwable $e) {
        error_log('m3d_modelo_do_documento: ' . $e->getMessage());
        return 0;
    }
}

/** Um envio só (lado inverso): IFC enviado no Modelo 3D também entra em "Documentos da obra" (para gerar materiais, vínculos e mapa). */
function m3d_documento_do_modelo($obraId, $modeloId, $caminho, $nome, array $u)
{
    try {
        require_once __DIR__ . '/importacao.php';
        $sha = hash_file('sha256', $caminho);
        $doc = q_global("SELECT id FROM obra_documentos WHERE obra_id = ? AND tipo = 'ifc' AND sha256 = ?", [(int)$obraId, $sha])->fetchColumn();
        if (!$doc) {
            $dir = importacao_diretorio((int)$obraId);
            $arm = bin2hex(random_bytes(8)) . '.dat';
            if (!@link($caminho, $dir . '/' . $arm) && !@copy($caminho, $dir . '/' . $arm)) { return 0; }
            $tam = filesize($dir . '/' . $arm);
            $nomeIfc = preg_match('/\.ifc$/i', $nome) ? $nome : $nome . '.ifc';
            $v = importacao_validar_basico('ifc', $dir . '/' . $arm, $nomeIfc, $tam);
            q_global('INSERT INTO obra_documentos (obra_id, tipo, nome_original, arquivo, tamanho, sha256, status, mensagens, resumo, enviado_por, enviado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [
                (int)$obraId, 'ifc', $nomeIfc, $arm, $tam, $sha, $v['status'], json_encode($v['mensagens'], JSON_UNESCAPED_UNICODE), json_encode($v['resumo'], JSON_UNESCAPED_UNICODE), (int)$u['id'], m3d_agora()]);
            $doc = (int)bd()->lastInsertId();
        }
        q_global('UPDATE modelos_3d SET doc_id = ? WHERE id = ? AND obra_id = ? AND doc_id IS NULL', [(int)$doc, (int)$modeloId, (int)$obraId]);
        return (int)$doc;
    } catch (Throwable $e) {
        error_log('m3d_documento_do_modelo: ' . $e->getMessage());
        return 0;
    }
}

