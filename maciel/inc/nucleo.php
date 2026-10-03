<?php
// Núcleo do sistema: configuração, banco de dados, sessão e utilidades. Compatível com PHP 7.4+.

define('RAIZ', dirname(__DIR__));
define('ARQ_CONFIG', __DIR__ . '/config.php');

function config()
{
    static $c = null;
    if ($c === null && file_exists(ARQ_CONFIG)) {
        $c = require ARQ_CONFIG;
    }
    return $c;
}

function conectar(array $c)
{
    if ($c['driver'] === 'sqlite') {
        $pdo = new PDO('sqlite:' . $c['sqlite_arquivo']);
        $pdo->exec('PRAGMA journal_mode=WAL');
    } else {
        $porta = !empty($c['porta']) ? ';port=' . (int)$c['porta'] : '';
        $pdo = new PDO('mysql:host=' . $c['host'] . $porta . ';dbname=' . $c['banco'] . ';charset=utf8mb4', $c['usuario'], $c['senha']);
    }
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    return $pdo;
}

function bd()
{
    static $pdo = null;
    if ($pdo === null) {
        $c = config();
        if (!$c) {
            throw new RuntimeException('Sistema não instalado. Acesse instalar.php.');
        }
        $pdo = conectar($c);
        garantir_esquema($pdo, $c);
    }
    return $pdo;
}

function q($sql, array $params = [])
{
    list($sql, $params) = aplicar_escopo_obra($sql, $params);
    $st = bd()->prepare($sql);
    $st->execute($params);
    return $st;
}

function tabelas_da_obra()
{
    return array_merge([
        'empresas', 'servicos', 'producao', 'metas', 'cliente', 'impactos', 'historico'
    ], array_keys(tabelas_spec()));
}

// Acrescenta obra_id às consultas simples usadas pelo sistema. Assim, toda a
// lógica existente continua funcionando, mas enxerga somente a obra aberta.
function aplicar_escopo_obra($sql, array $params)
{
    $tabelas = implode('|', array_map(function ($t) { return preg_quote($t, '/'); }, tabelas_da_obra()));
    if (!preg_match('/^\s*(SELECT|INSERT|UPDATE|DELETE)\b/i', $sql, $op)) {
        return [$sql, $params];
    }
    if (!preg_match('/\b(?:FROM|INTO|UPDATE)\s+(`?(?:' . $tabelas . ')`?)\b/i', $sql, $m)) {
        return [$sql, $params];
    }
    $tabela = trim($m[1], '`');
    $obraId = obra_atual_id();
    if ($obraId <= 0) {
        throw new RuntimeException('Selecione uma obra antes de acessar os dados.');
    }
    if (strcasecmp($op[1], 'INSERT') === 0) {
        $sql = preg_replace('/(INSERT\s+INTO\s+`?' . preg_quote($tabela, '/') . '`?\s*)\(/i', '$1(obra_id, ', $sql, 1);
        $sql = preg_replace('/\bVALUES\s*\(/i', 'VALUES (?, ', $sql, 1);
        array_unshift($params, $obraId);
        return [$sql, $params];
    }
    $cond = 'obra_id = ?';
    if (preg_match('/\bWHERE\b/i', $sql)) {
        $sql = preg_replace('/\b(ORDER\s+BY|GROUP\s+BY|LIMIT)\b/i', ' AND ' . $cond . ' $1', $sql, 1, $n);
        if (!$n) {
            $sql .= ' AND ' . $cond;
        }
    } else {
        $sql = preg_replace('/\b(ORDER\s+BY|GROUP\s+BY|LIMIT)\b/i', ' WHERE ' . $cond . ' $1', $sql, 1, $n);
        if (!$n) {
            $sql .= ' WHERE ' . $cond;
        }
    }
    $params[] = $obraId;
    return [$sql, $params];
}

function tabelas_spec()
{
    return [
        'materiais' => ['codigo' => 'txt', 'material' => 'txt', 'unidade' => 'txt', 'servico' => 'txt', 'empresa' => 'txt',
            'coef' => 'num', 'saldo_inicial' => 'num', 'data_saldo' => 'data', 'minimo' => 'num', 'fornecedor' => 'txt',
            'prazo_reposicao' => 'num', 'obs' => 'txt'],
        'movimentos' => ['data' => 'data', 'codigo' => 'txt', 'tipo' => 'txt', 'quantidade' => 'num', 'documento' => 'txt',
            'empresa' => 'txt', 'obs' => 'txt'],
        'equipamentos' => ['equipamento' => 'txt', 'tipo' => 'txt', 'locadora' => 'txt', 'cobranca' => 'txt', 'valor' => 'num',
            'consumo_lh' => 'num', 'situacao' => 'txt', 'responsavel' => 'txt', 'obs' => 'txt'],
        'usos' => ['data' => 'data', 'equipamento' => 'txt', 'empresa' => 'txt', 'uso' => 'txt', 'quantidade' => 'num',
            'custo' => 'num', 'litros' => 'num', 'preco_litro' => 'num', 'custo_combustivel' => 'num', 'operador' => 'txt',
            'obs' => 'txt', 'origem' => 'txt'],
        'bm_atividades' => ['codigo' => 'txt', 'empresa' => 'txt', 'item' => 'txt', 'item_desc' => 'txt', 'atividade' => 'txt',
            'unidade' => 'txt', 'qtd' => 'num', 'peso' => 'num', 'valor_qpc' => 'num', 'valor_rotula' => 'num',
            'controle' => 'txt', 'obs' => 'txt'],
        'bm_periodos' => ['empresa' => 'txt', 'bm' => 'num', 'corte' => 'data', 'obs' => 'txt'],
        'bm_apontamentos' => ['data' => 'data', 'empresa' => 'txt', 'codigo' => 'txt', 'quantidade' => 'num', 'obs' => 'txt'],
        'bm_deducoes' => ['empresa' => 'txt', 'bm' => 'num', 'data' => 'data', 'tipo' => 'txt', 'descricao' => 'txt',
            'valor' => 'num', 'contrato' => 'txt', 'percentual' => 'num'],
        'bm_fechamentos' => ['empresa' => 'txt', 'bm' => 'num', 'fechado_em' => 'data', 'equip' => 'num', 'comb' => 'num',
            'litros' => 'num', 'obs' => 'txt'],
        'bm_fech_atividades' => ['empresa' => 'txt', 'bm' => 'num', 'codigo' => 'txt', 'item' => 'txt', 'realizado' => 'num',
            'qtd' => 'num', 'peso' => 'num', 'valor_qpc' => 'num', 'valor_rotula' => 'num'],
        'estoque_eventos' => ['data' => 'data', 'tipo' => 'txt', 'empresa' => 'txt', 'eixo' => 'txt',
            'letra' => 'txt', 'rua' => 'txt', 'faixa' => 'txt', 'n_joists' => 'num', 'viga_id' => 'txt', 'obs' => 'txt'],
        'estoque_remessas' => ['data' => 'data', 'codigo' => 'txt', 'descricao' => 'txt', 'quantidade' => 'num',
            'documento' => 'txt', 'fornecedor' => 'txt', 'obs' => 'txt'],
        'estoque_inventario' => ['data' => 'data', 'codigo' => 'txt', 'quantidade' => 'num',
            'responsavel' => 'txt', 'obs' => 'txt'],
        'apontamentos' => ['data' => 'data', 'empresa' => 'txt', 'tipo' => 'txt', 'rua' => 'txt', 'faixa' => 'txt',
            'eixo' => 'txt', 'letra' => 'txt', 'viga_id' => 'txt', 'qtd' => 'num', 'lanca_producao' => 'txt',
            'obs' => 'txt', 'slot' => 'num'],
    ];
}

const ESQUEMA_VERSAO = 7;

// Instalações antigas ganham as tabelas novas (ex.: medição BM) sem precisar reinstalar.
function garantir_esquema(PDO $pdo, array $c)
{
    try {
        $v = $pdo->query("SELECT valor FROM sistema WHERE chave = 'esquema'")->fetchColumn();
    } catch (Exception $e) {
        return;
    }
    if ((int)$v >= ESQUEMA_VERSAO) {
        return;
    }
    criar_esquema($pdo, $c['driver']);
    garantir_multiobra($pdo, $c['driver']);
    $pdo->prepare("DELETE FROM sistema WHERE chave = 'esquema'")->execute();
    $pdo->prepare("INSERT INTO sistema (chave, valor) VALUES ('esquema', ?)")->execute([(string)ESQUEMA_VERSAO]);
}

function criar_esquema(PDO $pdo, $driver)
{
    $pk = $driver === 'sqlite' ? 'INTEGER PRIMARY KEY AUTOINCREMENT' : 'INT AUTO_INCREMENT PRIMARY KEY';
    $fim = $driver === 'mysql' ? ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4' : '';
    $tipos = ['txt' => 'VARCHAR(255) NULL', 'num' => 'DOUBLE NULL', 'data' => 'DATE NULL'];
    $longo = $driver === 'mysql' ? 'MEDIUMTEXT' : 'TEXT';
    $sql = [
        "CREATE TABLE IF NOT EXISTS sistema (chave VARCHAR(50) PRIMARY KEY, valor $longo NULL)$fim",
        "CREATE TABLE IF NOT EXISTS usuarios (id $pk, nome VARCHAR(100) NOT NULL, login VARCHAR(50) NOT NULL UNIQUE,
            senha VARCHAR(255) NOT NULL, perfil VARCHAR(20) NOT NULL, empresa VARCHAR(100) NULL, ativo INT NOT NULL DEFAULT 1)$fim",
        "CREATE TABLE IF NOT EXISTS empresas (id $pk, aba VARCHAR(100) NOT NULL, nome VARCHAR(100) NOT NULL,
            col_obs VARCHAR(5) NULL, ordem INT NOT NULL DEFAULT 0)$fim",
        "CREATE TABLE IF NOT EXISTS servicos (id $pk, empresa_id INT NOT NULL, col VARCHAR(5) NOT NULL, nome VARCHAR(150) NOT NULL,
            frente VARCHAR(150) NULL, id_crono VARCHAR(50) NULL, escopo DOUBLE NULL, ordem INT NOT NULL DEFAULT 0)$fim",
        "CREATE TABLE IF NOT EXISTS producao (empresa_id INT NOT NULL, data DATE NOT NULL, col VARCHAR(5) NOT NULL,
            valor_num DOUBLE NULL, valor_txt VARCHAR(255) NULL, PRIMARY KEY (empresa_id, data, col))$fim",
        "CREATE TABLE IF NOT EXISTS metas (id $pk, empresa VARCHAR(100) NOT NULL, servico VARCHAR(150) NOT NULL,
            inicio DATE NOT NULL, fim DATE NOT NULL, corte DATE NULL, meta_dia DOUBLE NOT NULL DEFAULT 0,
            du DOUBLE NOT NULL DEFAULT 0, gap DOUBLE NOT NULL DEFAULT 0)$fim",
        "CREATE TABLE IF NOT EXISTS cliente (id $pk, servico VARCHAR(150) NOT NULL, qtd DOUBLE NULL, inicio_plan DATE NULL,
            meta_dia DOUBLE NULL, du_semana DOUBLE NULL, responsavel VARCHAR(100) NULL, obs VARCHAR(255) NULL,
            prazo DATE NULL, peso DOUBLE NULL, frente VARCHAR(150) NULL)$fim",
        "CREATE TABLE IF NOT EXISTS impactos (id $pk, data VARCHAR(20) NULL, servico VARCHAR(150) NULL, motivo TEXT NULL,
            solucionado VARCHAR(20) NULL, tempo VARCHAR(50) NULL, quando VARCHAR(100) NULL, paralisacao TEXT NULL)$fim",
        "CREATE TABLE IF NOT EXISTS historico (id $pk, quando VARCHAR(19) NOT NULL, usuario VARCHAR(50) NULL,
            acao VARCHAR(50) NOT NULL, detalhe TEXT NULL)$fim",
        "CREATE TABLE IF NOT EXISTS obras (id $pk, nome VARCHAR(150) NOT NULL, codigo VARCHAR(50) NULL,
            cliente VARCHAR(150) NULL, cidade VARCHAR(150) NULL, data_inicio DATE NULL, data_fim DATE NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'ativa', cor_primaria VARCHAR(20) NULL,
            cor_secundaria VARCHAR(20) NULL, logo $longo NULL, criado_em VARCHAR(19) NOT NULL)$fim",
        "CREATE TABLE IF NOT EXISTS usuarios_obras (usuario_id INT NOT NULL, obra_id INT NOT NULL,
            PRIMARY KEY (usuario_id, obra_id))$fim",
        "CREATE TABLE IF NOT EXISTS obra_config (obra_id INT NOT NULL, chave VARCHAR(50) NOT NULL, valor $longo NULL,
            PRIMARY KEY (obra_id, chave))$fim",
        "CREATE TABLE IF NOT EXISTS config_global (chave VARCHAR(50) PRIMARY KEY, valor $longo NULL)$fim",
        "CREATE TABLE IF NOT EXISTS auditoria_global (id $pk, quando VARCHAR(19) NOT NULL, usuario VARCHAR(50) NULL,
            acao VARCHAR(50) NOT NULL, detalhe TEXT NULL)$fim",
    ];
    foreach (tabelas_spec() as $nome => $campos) {
        $cols = [];
        foreach ($campos as $campo => $tipo) {
            $cols[] = "$campo " . $tipos[$tipo];
        }
        $sql[] = "CREATE TABLE IF NOT EXISTS $nome (id $pk, " . implode(', ', $cols) . ")$fim";
    }
    foreach ($sql as $s) {
        $pdo->exec($s);
    }
    garantir_multiobra($pdo, $driver);
    // instalações antigas: acrescenta as colunas que as tabelas ganharam depois
    foreach (tabelas_spec() as $nome => $campos) {
        $existentes = [];
        if ($driver === 'sqlite') {
            foreach ($pdo->query("PRAGMA table_info($nome)") as $r) {
                $existentes[] = $r['name'];
            }
        } else {
            foreach ($pdo->query("SHOW COLUMNS FROM $nome") as $r) {
                $existentes[] = $r['Field'];
            }
        }
        foreach ($campos as $campo => $tipo) {
            if (!in_array($campo, $existentes, true)) {
                $pdo->exec("ALTER TABLE $nome ADD COLUMN $campo " . $tipos[$tipo]);
            }
        }
    }
}

function colunas_tabela(PDO $pdo, $driver, $tabela)
{
    $out = [];
    if ($driver === 'sqlite') {
        foreach ($pdo->query("PRAGMA table_info($tabela)") as $r) { $out[] = $r['name']; }
    } else {
        foreach ($pdo->query("SHOW COLUMNS FROM `$tabela`") as $r) { $out[] = $r['Field']; }
    }
    return $out;
}

function garantir_multiobra(PDO $pdo, $driver)
{
    foreach (tabelas_da_obra() as $tabela) {
        if (!in_array('obra_id', colunas_tabela($pdo, $driver, $tabela), true)) {
            $pdo->exec("ALTER TABLE `$tabela` ADD COLUMN obra_id INT NOT NULL DEFAULT 1");
        }
        $indice = 'idx_' . $tabela . '_obra';
        $temIndice = false;
        if ($driver === 'sqlite') {
            foreach ($pdo->query("PRAGMA index_list($tabela)") as $r) {
                if ($r['name'] === $indice) { $temIndice = true; break; }
            }
        } else {
            $stIdx = $pdo->prepare("SHOW INDEX FROM `$tabela` WHERE Key_name = ?");
            $stIdx->execute([$indice]);
            $temIndice = (bool)$stIdx->fetch();
        }
        if (!$temIndice) {
            $pdo->exec("CREATE INDEX `$indice` ON `$tabela` (obra_id)");
        }
    }
    $total = (int)$pdo->query('SELECT COUNT(*) FROM obras')->fetchColumn();
    if ($total === 0) {
        $nome = $pdo->query("SELECT valor FROM sistema WHERE chave = 'obra_nome'")->fetchColumn();
        $ini = $pdo->query("SELECT valor FROM sistema WHERE chave = 'data_inicio'")->fetchColumn();
        $fim = $pdo->query("SELECT valor FROM sistema WHERE chave = 'data_fim'")->fetchColumn();
        $st = $pdo->prepare("INSERT INTO obras (nome, codigo, data_inicio, data_fim, status, cor_primaria, cor_secundaria, criado_em)
            VALUES (?, ?, ?, ?, 'ativa', '#d97706', '#111827', ?)");
        $st->execute([$nome ?: 'Obra principal', 'OBRA-001', $ini ?: null, $fim ?: null, date('Y-m-d H:i:s')]);
    }
    $obraInicial = (int)$pdo->query('SELECT id FROM obras ORDER BY id LIMIT 1')->fetchColumn();
    foreach (['obra_nome', 'data_inicio', 'data_fim', 'referencia', 'versao', 'modificado', 'estoque_externo', 'estoque_planilha'] as $chave) {
        $st = $pdo->prepare('SELECT COUNT(*) FROM obra_config WHERE obra_id = ? AND chave = ?');
        $st->execute([$obraInicial, $chave]);
        if (!(int)$st->fetchColumn()) {
            $old = $pdo->prepare('SELECT valor FROM sistema WHERE chave = ?');
            $old->execute([$chave]);
            $valor = $old->fetchColumn();
            if ($valor !== false) {
                $pdo->prepare('INSERT INTO obra_config (obra_id, chave, valor) VALUES (?, ?, ?)')->execute([$obraInicial, $chave, $valor]);
            }
        }
    }
    $st = $pdo->prepare("SELECT COUNT(*) FROM obra_config WHERE obra_id=? AND chave='dados_legados'");
    $st->execute([$obraInicial]);
    if (!(int)$st->fetchColumn()) {
        $pdo->prepare("INSERT INTO obra_config (obra_id,chave,valor) VALUES (?,'dados_legados','1')")->execute([$obraInicial]);
    }
    $pdo->exec("INSERT INTO usuarios_obras (usuario_id, obra_id)
        SELECT u.id, $obraInicial FROM usuarios u
        WHERE NOT EXISTS (SELECT 1 FROM usuarios_obras x WHERE x.usuario_id = u.id AND x.obra_id = $obraInicial)");
    $defaults = [
        'nome_sistema' => 'Núcleo de Obras', 'cor_primaria' => '#d97706',
        'cor_secundaria' => '#111827', 'cor_fundo' => '#f4f6f8', 'logo' => ''
    ];
    foreach ($defaults as $k => $v) {
        $st = $pdo->prepare('SELECT COUNT(*) FROM config_global WHERE chave = ?');
        $st->execute([$k]);
        if (!(int)$st->fetchColumn()) {
            $pdo->prepare('INSERT INTO config_global (chave, valor) VALUES (?, ?)')->execute([$k, $v]);
        }
    }
}

function sistema_ler($chave, $padrao = null)
{
    $globais = ['esquema', 'versao_codigo', 'machine_token'];
    $obraId = obra_atual_id();
    if ($obraId > 0 && !in_array($chave, $globais, true)) {
        $v = q_global('SELECT valor FROM obra_config WHERE obra_id = ? AND chave = ?', [$obraId, $chave])->fetchColumn();
        if ($v !== false) { return $v; }
    }
    $v = q_global('SELECT valor FROM sistema WHERE chave = ?', [$chave])->fetchColumn();
    return $v === false ? $padrao : $v;
}

function sistema_gravar($chave, $valor)
{
    $globais = ['esquema', 'versao_codigo', 'machine_token'];
    $obraId = obra_atual_id();
    if ($obraId > 0 && !in_array($chave, $globais, true)) {
        q_global('DELETE FROM obra_config WHERE obra_id = ? AND chave = ?', [$obraId, $chave]);
        q_global('INSERT INTO obra_config (obra_id, chave, valor) VALUES (?, ?, ?)', [$obraId, $chave, $valor]);
        return;
    }
    q_global('DELETE FROM sistema WHERE chave = ?', [$chave]);
    q_global('INSERT INTO sistema (chave, valor) VALUES (?, ?)', [$chave, $valor]);
}

function q_global($sql, array $params = [])
{
    $st = bd()->prepare($sql);
    $st->execute($params);
    return $st;
}

function global_ler($chave, $padrao = null)
{
    $v = q_global('SELECT valor FROM config_global WHERE chave = ?', [$chave])->fetchColumn();
    return $v === false ? $padrao : $v;
}

function global_gravar($chave, $valor)
{
    q_global('DELETE FROM config_global WHERE chave = ?', [$chave]);
    q_global('INSERT INTO config_global (chave, valor) VALUES (?, ?)', [$chave, $valor]);
}

function agora()
{
    return date('Y-m-d H:i:s');
}

function registrar_alteracao($acao, $detalhe)
{
    $u = usuario_atual();
    q('INSERT INTO historico (quando, usuario, acao, detalhe) VALUES (?, ?, ?, ?)',
        [agora(), $u ? $u['login'] : null, $acao, json_encode($detalhe, JSON_UNESCAPED_UNICODE)]);
    sistema_gravar('versao', (string)((int)sistema_ler('versao', '0') + 1));
    sistema_gravar('modificado', date('c'));
}

function registrar_global($acao, $detalhe = null)
{
    $u = usuario_atual();
    q_global('INSERT INTO auditoria_global (quando, usuario, acao, detalhe) VALUES (?, ?, ?, ?)', [
        agora(), $u ? $u['login'] : null, $acao,
        $detalhe === null ? null : json_encode($detalhe, JSON_UNESCAPED_UNICODE)
    ]);
}

// ----------------------------------------------------------------- utilidades

function numero($v)
{
    if ($v === null || $v === '') {
        return null;
    }
    if (is_string($v)) {
        $t = trim($v);
        if (strpos($t, ',') !== false) {
            $t = str_replace(',', '.', str_replace('.', '', $t));
        }
        if (!is_numeric($t)) {
            return null;
        }
        $v = $t;
    }
    if (!is_numeric($v)) {
        return null;
    }
    $f = (float)$v;
    return (floor($f) == $f && abs($f) < 1e15) ? (int)$f : $f;
}

function data_valida($v)
{
    if (!is_string($v) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $v)) {
        return false;
    }
    list($a, $m, $d) = array_map('intval', explode('-', $v));
    return checkdate($m, $d, $a);
}

function texto_ou_nulo($v)
{
    if ($v === null) {
        return null;
    }
    $t = trim((string)$v);
    return $t === '' ? null : $t;
}

function h($v)
{
    return htmlspecialchars((string)$v, ENT_QUOTES, 'UTF-8');
}

function responder_json($status, $dados)
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($dados, JSON_UNESCAPED_UNICODE);
    exit;
}

// ----------------------------------------------------------------- sessão e acesso

function iniciar_sessao()
{
    if (session_status() !== PHP_SESSION_NONE) {
        return;
    }
    $pasta = RAIZ . '/dados/sessoes';
    if (!is_dir($pasta) && !mkdir($pasta, 0700, true) && !is_dir($pasta)) {
        http_response_code(500);
        exit('Não foi possível criar dados/sessoes. Verifique a permissão da pasta dados.');
    }
    if (!is_writable($pasta)) {
        http_response_code(500);
        exit('A pasta dados/sessoes não possui permissão de escrita.');
    }
    session_save_path($pasta);
    ini_set('session.use_strict_mode', '1');
    ini_set('session.use_only_cookies', '1');
    session_name('gestao_obras');
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ||
        (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
    $path = str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/'));
    $path = ($path === '/' || $path === '.') ? '/' : rtrim($path, '/') . '/';
    session_set_cookie_params([
        'lifetime' => 0, 'path' => $path, 'httponly' => true, 'samesite' => 'Lax', 'secure' => $https,
    ]);
    if (!session_start()) {
        http_response_code(500);
        exit('Não foi possível iniciar a sessão PHP. Verifique dados/sessoes.');
    }
}

function obra_atual_id()
{
    iniciar_sessao();
    return max(0, (int)($_SESSION['obra_id'] ?? 0));
}

function definir_obra_atual($obraId)
{
    iniciar_sessao();
    $_SESSION['obra_id'] = max(0, (int)$obraId);
}

function obras_do_usuario(array $u)
{
    if ($u['perfil'] === 'admin') {
        return q_global("SELECT * FROM obras WHERE status <> 'excluida' ORDER BY status, nome")->fetchAll();
    }
    return q_global("SELECT o.* FROM obras o JOIN usuarios_obras uo ON uo.obra_id = o.id
        WHERE uo.usuario_id = ? AND o.status = 'ativa' ORDER BY o.nome", [(int)$u['id']])->fetchAll();
}

function usuario_pode_obra(array $u, $obraId)
{
    if ($u['perfil'] === 'admin') { return true; }
    return (bool)q_global('SELECT 1 FROM usuarios_obras WHERE usuario_id = ? AND obra_id = ?', [(int)$u['id'], (int)$obraId])->fetchColumn();
}

function obra_atual()
{
    $id = obra_atual_id();
    return $id ? (q_global("SELECT * FROM obras WHERE id = ? AND status <> 'excluida'", [$id])->fetch() ?: null) : null;
}

function exigir_obra_pagina()
{
    $u = exigir_login_pagina();
    $obra = obra_atual();
    if (!$obra || !usuario_pode_obra($u, $obra['id'])) {
        definir_obra_atual(0);
        header('Location: obras.php');
        exit;
    }
    return $obra;
}

function autenticar_machine_token()
{
    $header = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    $fornecido = (strpos($header, 'Bearer ') === 0) ? substr($header, 7) : ($_GET['mtoken'] ?? '');
    if (!$fornecido) {
        return null;
    }
    $armazenado = sistema_ler('machine_token', '');
    if (!$armazenado || !hash_equals($armazenado, trim($fornecido))) {
        return null;
    }
    return ['id' => 0, 'nome' => 'Claude (API)', 'login' => 'claude_api', 'perfil' => 'admin', 'empresa' => null];
}

function usuario_atual()
{
    static $u = false;
    if ($u !== false) {
        return $u;
    }
    iniciar_sessao();
    $u = null;
    if (!empty($_SESSION['uid'])) {
        $inativo = time() - (int)($_SESSION['ultimo'] ?? 0);
        if ($inativo > 12 * 3600) {
            $_SESSION = [];
            return $u;
        }
        $_SESSION['ultimo'] = time();
        $linha = q('SELECT id, nome, login, perfil, empresa FROM usuarios WHERE id = ? AND ativo = 1', [$_SESSION['uid']])->fetch();
        $u = $linha ?: null;
    }
    return $u;
}

function exigir_login_pagina()
{
    if (!config()) {
        header('Location: instalar.php');
        exit;
    }
    $u = usuario_atual();
    if (!$u) {
        header('Location: login.php');
        exit;
    }
    return $u;
}

function exigir_admin()
{
    $u = exigir_login_pagina();
    if ($u['perfil'] !== 'admin') {
        http_response_code(403);
        exit('Acesso restrito ao administrador.');
    }
    return $u;
}

function token_csrf()
{
    iniciar_sessao();
    if (empty($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(16));
    }
    return $_SESSION['csrf'];
}

function conferir_csrf()
{
    $t = $_POST['csrf'] ?? ($_GET['csrf'] ?? ($_SERVER['HTTP_X_CSRF_TOKEN'] ?? ''));
    if (!is_string($t) || !hash_equals(token_csrf(), $t)) {
        http_response_code(400);
        exit('Formulário expirado. Volte e tente novamente.');
    }
}

function pagina_inicio($titulo)
{
    $nome = config() ? global_ler('nome_sistema', 'Núcleo de Obras') : 'Núcleo de Obras';
    $primaria = cor_segura(config() ? global_ler('cor_primaria', '#d97706') : '#d97706', '#d97706');
    $secundaria = cor_segura(config() ? global_ler('cor_secundaria', '#111827') : '#111827', '#111827');
    $fundo = cor_segura(config() ? global_ler('cor_fundo', '#f4f6f8') : '#f4f6f8', '#f4f6f8');
    $logo = config() ? global_ler('logo', '') : '';
    echo '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">';
    echo '<title>' . h($titulo) . ' · ' . h($nome) . '</title>';
    if (is_string($logo) && strpos($logo, 'data:image/') === 0) { echo '<link rel="icon" href="' . h($logo) . '">'; }
    echo '<link rel="stylesheet" href="style.css?v=20261002c"><link rel="stylesheet" href="portal.css?v=20261002c"><style>:root{--marca:' . $primaria . ';--marca2:' . $secundaria . ';--app-fundo:' . $fundo . ';}</style></head><body>';
}

function cor_segura($cor, $padrao)
{
    return is_string($cor) && preg_match('/^#[0-9a-fA-F]{6}$/', $cor) ? strtolower($cor) : $padrao;
}

function imagem_upload_para_data_uri($campo, $atual = '')
{
    if (empty($_FILES[$campo]['tmp_name']) || ($_FILES[$campo]['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE) {
        return $atual;
    }
    if (($_FILES[$campo]['error'] ?? UPLOAD_ERR_OK) !== UPLOAD_ERR_OK || $_FILES[$campo]['size'] > 2 * 1024 * 1024) {
        throw new InvalidArgumentException('A imagem deve ter no máximo 2 MB.');
    }
    $mime = function_exists('mime_content_type') ? mime_content_type($_FILES[$campo]['tmp_name']) : '';
    if (!in_array($mime, ['image/png', 'image/jpeg', 'image/webp'], true)) {
        throw new InvalidArgumentException('Use uma imagem PNG, JPG ou WebP.');
    }
    $dados = file_get_contents($_FILES[$campo]['tmp_name']);
    if ($dados === false) { throw new InvalidArgumentException('Não foi possível ler a imagem.'); }
    return 'data:' . $mime . ';base64,' . base64_encode($dados);
}
