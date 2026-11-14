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

const M3D_CACHE_VERSAO = 1;          // muda quando o formato do modelo convertido muda (o navegador reconverte)
const M3D_TAMANHO_MAX = 524288000;   // 500 MB por IFC
const M3D_PARTE_MAX = 16777216;      // 16 MB por parte enviada
const M3D_GUIDS_MAX = 80000;         // elementos por gravação

function modelos_3d_sql($pk, $fim)
{
    return "CREATE TABLE IF NOT EXISTS modelos_3d (id $pk, obra_id INT NOT NULL, nome VARCHAR(160) NOT NULL, arquivo VARCHAR(80) NULL, doc_id INT NULL,
        tamanho DOUBLE NULL, sha256 VARCHAR(64) NULL, cache_geo VARCHAR(80) NULL, cache_props VARCHAR(80) NULL, cache_v INT NOT NULL DEFAULT 0,
        n_elementos INT NOT NULL DEFAULT 0, n_unidades INT NOT NULL DEFAULT 0, por VARCHAR(100) NULL, em VARCHAR(19) NULL)$fim";
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
        'cache' => ((int)$m['cache_v'] === M3D_CACHE_VERSAO && $m['cache_geo']) ? 1 : 0, 'elementos' => (int)$m['n_elementos'], 'unidades' => (int)$m['n_unidades']];
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
    return ['modelos' => $modelos, 'docs_ifc' => $docs, 'pode_editar' => m3d_pode_editar($u) ? 1 : 0, 'empresa' => usuario_empresa_restrita($u),
        'cache_versao' => M3D_CACHE_VERSAO, 'status' => m3d_status()];
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
