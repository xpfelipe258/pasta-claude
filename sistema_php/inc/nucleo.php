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
    $st = bd()->prepare($sql);
    $st->execute($params);
    return $st;
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
            'consumo_lh' => 'num', 'situacao' => 'txt', 'obs' => 'txt'],
        'usos' => ['data' => 'data', 'equipamento' => 'txt', 'empresa' => 'txt', 'uso' => 'txt', 'quantidade' => 'num',
            'custo' => 'num', 'litros' => 'num', 'preco_litro' => 'num', 'custo_combustivel' => 'num', 'operador' => 'txt',
            'obs' => 'txt', 'origem' => 'txt'],
        'bm_atividades' => ['codigo' => 'txt', 'empresa' => 'txt', 'item' => 'txt', 'item_desc' => 'txt', 'atividade' => 'txt',
            'unidade' => 'txt', 'qtd' => 'num', 'peso' => 'num', 'valor_qpc' => 'num', 'valor_rotula' => 'num',
            'controle' => 'txt', 'obs' => 'txt'],
        'bm_periodos' => ['empresa' => 'txt', 'bm' => 'num', 'corte' => 'data', 'obs' => 'txt'],
        'bm_apontamentos' => ['data' => 'data', 'empresa' => 'txt', 'codigo' => 'txt', 'quantidade' => 'num', 'obs' => 'txt'],
        'bm_deducoes' => ['empresa' => 'txt', 'bm' => 'num', 'data' => 'data', 'tipo' => 'txt', 'descricao' => 'txt',
            'valor' => 'num', 'contrato' => 'txt', 'percentual' => 'num', 'item_uso' => 'txt', 'qtd' => 'num',
            'unidade' => 'txt', 'valor_unit' => 'num'],
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
    ];
}

const ESQUEMA_VERSAO = 6;

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

function sistema_ler($chave, $padrao = null)
{
    $v = q('SELECT valor FROM sistema WHERE chave = ?', [$chave])->fetchColumn();
    return $v === false ? $padrao : $v;
}

function sistema_gravar($chave, $valor)
{
    q('DELETE FROM sistema WHERE chave = ?', [$chave]);
    q('INSERT INTO sistema (chave, valor) VALUES (?, ?)', [$chave, $valor]);
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
    if (session_status() === PHP_SESSION_NONE) {
        session_name('obra198');
        session_set_cookie_params([
            'lifetime' => 0, 'path' => '/', 'httponly' => true, 'samesite' => 'Lax',
            'secure' => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
        ]);
        session_start();
    }
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
    $t = $_POST['csrf'] ?? ($_GET['csrf'] ?? '');
    if (!is_string($t) || !hash_equals(token_csrf(), $t)) {
        http_response_code(400);
        exit('Formulário expirado. Volte e tente novamente.');
    }
}

function pagina_inicio($titulo)
{
    echo '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">';
    echo '<title>' . h($titulo) . ' · Obra 198</title><link rel="stylesheet" href="style.css"></head><body>';
}
