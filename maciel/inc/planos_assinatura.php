<?php
// Comercialização do sistema: PLANOS EMPRESARIAIS (nível 1, 2 e 3) contratados por EMPRESA (organização cliente).
//
// MODELO: a empresa cliente (organizacoes) assina um plano; o administrador do sistema cadastra a empresa junto com o USUÁRIO ADMINISTRADOR DELA
// (usuarios.admin_organizacao = 1). Esse administrador cria as obras da empresa e os demais usuários da empresa (empresa_usuarios.php), dentro
// dos limites do plano: obras, usuários e áreas (módulos) liberadas. Obras e usuários da empresa carregam organizacao_id.
//
// PLANO (planos_assinatura): nome, nível, preço mensal, preço anual, limite de obras, limite de usuários (0 = ilimitado), áreas liberadas
// (vazio = todas) e a lista de itens do nível (texto livre mostrado à empresa). Os limites e as áreas são lidos do plano NA HORA (mudar o nível
// vale para quem já assina); o preço cobrado fica copiado na assinatura da empresa (preço negociado não muda sozinho).
//
// REGRA: só vale quando o administrador liga "Exigir plano" (padrão desligado = nada muda para ninguém). Empresa vencida (depois da tolerância),
// suspensa ou cancelada não cria obras nem usuários novos; o que já existe continua funcionando. Quem NÃO pertence a nenhuma empresa segue a
// regra antiga: "obras de quem não tem plano".

function planos_sql($pk, $longo, $fim)
{
    return "CREATE TABLE IF NOT EXISTS planos_assinatura (id $pk, nome VARCHAR(80) NOT NULL, ciclo VARCHAR(10) NOT NULL DEFAULT 'MENSAL', preco DOUBLE NOT NULL DEFAULT 0,
        max_obras INT NOT NULL DEFAULT 1, obs VARCHAR(255) NULL, ativo INT NOT NULL DEFAULT 1, criado_em VARCHAR(19) NULL,
        nivel INT NOT NULL DEFAULT 0, preco_mensal DOUBLE NOT NULL DEFAULT 0, preco_anual DOUBLE NOT NULL DEFAULT 0, max_usuarios INT NOT NULL DEFAULT 0,
        modulos VARCHAR(200) NULL, itens $longo NULL)$fim";
}

function organizacoes_sql($pk, $longo, $fim)
{
    return "CREATE TABLE IF NOT EXISTS organizacoes (id $pk, nome VARCHAR(120) NOT NULL, documento VARCHAR(30) NULL, contato VARCHAR(120) NULL, email VARCHAR(150) NULL,
        telefone VARCHAR(30) NULL, plano_id INT NULL, ciclo VARCHAR(10) NOT NULL DEFAULT 'MENSAL', preco DOUBLE NOT NULL DEFAULT 0, obras_extra INT NOT NULL DEFAULT 0,
        usuarios_extra INT NOT NULL DEFAULT 0, inicio DATE NULL, vencimento DATE NULL, status VARCHAR(12) NOT NULL DEFAULT 'TESTE', obs $longo NULL,
        criado_em VARCHAR(19) NULL, atualizado_em VARCHAR(19) NULL)$fim";
}

function organizacoes_pagamentos_sql($pk, $fim)
{
    return "CREATE TABLE IF NOT EXISTS organizacoes_pagamentos (id $pk, organizacao_id INT NOT NULL, data_pagamento DATE NOT NULL, valor DOUBLE NOT NULL DEFAULT 0,
        periodo_ate DATE NULL, forma VARCHAR(30) NULL, obs VARCHAR(255) NULL, por VARCHAR(100) NULL, em VARCHAR(19) NULL)$fim";
}

/** Colunas novas (banco antigo): vínculo de usuários e obras com a empresa e campos novos do plano. Os planos por usuário da versão anterior ficam inativos. */
function garantir_organizacoes(PDO $pdo, $driver)
{
    $add = function ($tabela, $col, $def) use ($pdo, $driver) {
        if (!in_array($col, colunas_tabela($pdo, $driver, $tabela), true)) {
            $pdo->exec("ALTER TABLE $tabela ADD COLUMN $col $def");
        }
    };
    $add('usuarios', 'organizacao_id', 'INT NULL');
    $add('usuarios', 'admin_organizacao', 'INT NOT NULL DEFAULT 0');
    $add('obras', 'organizacao_id', 'INT NULL');
    $longo = $driver === 'sqlite' ? 'TEXT' : 'LONGTEXT';
    $add('planos_assinatura', 'nivel', 'INT NOT NULL DEFAULT 0');
    $add('planos_assinatura', 'preco_mensal', 'DOUBLE NOT NULL DEFAULT 0');
    $add('planos_assinatura', 'preco_anual', 'DOUBLE NOT NULL DEFAULT 0');
    $add('planos_assinatura', 'max_usuarios', 'INT NOT NULL DEFAULT 0');
    $add('planos_assinatura', 'modulos', 'VARCHAR(200) NULL');
    $add('planos_assinatura', 'itens', "$longo NULL");
    $pdo->exec('UPDATE planos_assinatura SET ativo = 0 WHERE nivel = 0');   // plano por usuário da versão anterior: não vale mais
}

function planos_hoje()
{
    return (new DateTimeImmutable('now', new DateTimeZone('America/Sao_Paulo')))->format('Y-m-d');
}

function planos_agora()
{
    return (new DateTimeImmutable('now', new DateTimeZone('America/Sao_Paulo')))->format('Y-m-d H:i:s');
}

function planos_config()
{
    $c = json_decode((string)global_ler('planos_config', '{}'), true);
    $c = is_array($c) ? $c : [];
    return [
        'exigir_plano' => !empty($c['exigir_plano']) ? 1 : 0,           // 0 = comportamento de sempre (sem limite)
        'limite_sem_plano' => max(0, (int)($c['limite_sem_plano'] ?? 0)),  // obras que quem NÃO pertence a uma empresa pode criar quando o plano é exigido
        'tolerancia_dias' => max(0, min(60, (int)($c['tolerancia_dias'] ?? 5))),   // dias depois do vencimento em que a empresa ainda cria obras e usuários
        'dias_teste' => max(1, min(90, (int)($c['dias_teste'] ?? 14))),
        'cadastro_aberto' => !array_key_exists('cadastro_aberto', $c) || !empty($c['cadastro_aberto']) ? 1 : 0,   // cadastro público de empresas (cadastro.php); padrão ligado
    ];
}

function planos_config_salvar(array $e)
{
    $c = [
        'exigir_plano' => !empty($e['exigir_plano']) ? 1 : 0,
        'limite_sem_plano' => max(0, min(1000, (int)($e['limite_sem_plano'] ?? 0))),
        'tolerancia_dias' => max(0, min(60, (int)($e['tolerancia_dias'] ?? 5))),
        'dias_teste' => max(1, min(90, (int)($e['dias_teste'] ?? 14))),
        'cadastro_aberto' => !empty($e['cadastro_aberto']) ? 1 : 0,
    ];
    global_gravar('planos_config', json_encode($c));
    return $c;
}

function planos_ciclos()
{
    return ['MENSAL' => 'Mensal', 'ANUAL' => 'Anual'];
}

function planos_status_lista()
{
    return ['TESTE' => 'Em teste', 'ATIVA' => 'Ativa', 'SUSPENSA' => 'Suspensa', 'CANCELADA' => 'Cancelada'];
}

/** Áreas do sistema que um plano pode liberar: [código => rótulo]. */
function planos_modulos_rotulos()
{
    return ['producao' => 'Produção', 'suprimentos' => 'Suprimentos', 'consumo' => 'Consumo', 'financeiro' => 'Financeiro', 'gestao' => 'Gestão', 'qualidade' => 'Qualidade', 'sesmt' => 'SESMT'];
}

function planos_listar($somenteAtivos = false)
{
    $sql = 'SELECT * FROM planos_assinatura WHERE nivel > 0' . ($somenteAtivos ? ' AND ativo = 1' : '') . ' ORDER BY nivel, nome';
    return q_global($sql)->fetchAll();
}

/** Áreas do plano como lista (vazio no cadastro = todas as áreas do sistema). */
function plano_modulos(array $p = null)
{
    $todos = modulos_sistema();
    if (!$p) {
        return $todos;
    }
    $lista = array_values(array_filter(array_map('trim', explode(',', (string)($p['modulos'] ?? '')))));
    $lista = array_values(array_intersect($todos, $lista));
    return $lista ?: $todos;
}

/** Os três níveis empresariais (valores de partida: ajuste preços, limites e áreas em Comercial › Planos). */
function planos_semear_niveis()
{
    if ((int)q_global('SELECT COUNT(*) FROM planos_assinatura WHERE nivel > 0')->fetchColumn() > 0) {
        return 0;
    }
    $niveis = [
        [1, 'Plano Empresarial — Nível 1', 297.00, 2970.00, 2, 5],
        [2, 'Plano Empresarial — Nível 2', 697.00, 6970.00, 10, 20],
        [3, 'Plano Empresarial — Nível 3', 1497.00, 14970.00, 0, 0],
    ];
    foreach ($niveis as $n) {
        q_global("INSERT INTO planos_assinatura (nome, ciclo, preco, max_obras, obs, ativo, criado_em, nivel, preco_mensal, preco_anual, max_usuarios, modulos, itens) VALUES (?, 'MENSAL', ?, ?, NULL, 1, ?, ?, ?, ?, ?, NULL, NULL)",
            [$n[1], $n[2], $n[4], planos_agora(), $n[0], $n[2], $n[3], $n[5]]);
    }
    return count($niveis);
}

function planos_salvar(array $e, $id = 0)
{
    $nome = trim((string)($e['nome'] ?? ''));
    $nivel = (int)($e['nivel'] ?? 0);
    $pm = numero($e['preco_mensal'] ?? null);
    $pa = numero($e['preco_anual'] ?? null);
    $maxO = $e['max_obras'] ?? '';
    $maxU = $e['max_usuarios'] ?? '';
    $erros = [];
    if ($nome === '' || mb_strlen($nome, 'UTF-8') > 80) {
        $erros[] = 'Informe o nome do plano (até 80 caracteres).';
    }
    if ($nivel < 1 || $nivel > 9) {
        $erros[] = 'Nível: use um número de 1 a 9.';
    }
    if ($pm === null || $pm < 0 || $pa === null || $pa < 0) {
        $erros[] = 'Informe o preço mensal e o preço anual (zero ou maior).';
    }
    if (!is_numeric($maxO) || (int)$maxO < 0 || (int)$maxO > 10000 || !is_numeric($maxU) || (int)$maxU < 0 || (int)$maxU > 100000) {
        $erros[] = 'Limites de obras e de usuários: use números inteiros (0 = ilimitado).';
    }
    if ($erros) {
        return [0, $erros];
    }
    $todos = array_keys(planos_modulos_rotulos());
    $mods = array_values(array_intersect($todos, array_map('strval', (array)($e['modulos'] ?? []))));
    if (!$mods) {
        return [0, ['Marque ao menos uma área que o plano libera.']];
    }
    $modsTxt = count($mods) === count($todos) ? null : implode(',', $mods);   // todas = vazio (inclui áreas novas que surgirem)
    $itens = texto_ou_nulo(mb_substr((string)($e['itens'] ?? ''), 0, 4000, 'UTF-8'));
    $ativo = !empty($e['ativo']) ? 1 : 0;
    $campos = [$nome, round((float)$pm, 2), (int)$maxO, $nivel, round((float)$pm, 2), round((float)$pa, 2), (int)$maxU, $modsTxt, $itens, $ativo];
    if ($id) {
        q_global('UPDATE planos_assinatura SET nome = ?, preco = ?, max_obras = ?, nivel = ?, preco_mensal = ?, preco_anual = ?, max_usuarios = ?, modulos = ?, itens = ?, ativo = ? WHERE id = ?', array_merge($campos, [(int)$id]));
        return [(int)$id, []];
    }
    q_global("INSERT INTO planos_assinatura (nome, ciclo, preco, max_obras, nivel, preco_mensal, preco_anual, max_usuarios, modulos, itens, ativo, criado_em) VALUES (?, 'MENSAL', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        array_merge($campos, [planos_agora()]));
    return [(int)bd()->lastInsertId(), []];
}

function planos_somar_ciclo($data, $ciclo)
{
    $d = new DateTimeImmutable($data, new DateTimeZone('America/Sao_Paulo'));
    $m = (int)$d->format('n') + ($ciclo === 'ANUAL' ? 12 : 1);
    $y = (int)$d->format('Y') + intdiv($m - 1, 12);
    $m = ($m - 1) % 12 + 1;
    $dia = min((int)$d->format('j'), (int)date('t', mktime(0, 0, 0, $m, 1, $y)));
    return sprintf('%04d-%02d-%02d', $y, $m, $dia);
}

// ---------------------------------------------------------------- empresas (organizações)

/** Empresa com os dados do plano (limites e áreas lidos do plano na hora). */
function organizacao_ler($id)
{
    $o = q_global('SELECT o.*, p.nome AS plano_nome, p.nivel AS plano_nivel, p.max_obras AS plano_max_obras, p.max_usuarios AS plano_max_usuarios, p.modulos AS plano_modulos,
        p.preco_mensal AS plano_preco_mensal, p.preco_anual AS plano_preco_anual, p.itens AS plano_itens
        FROM organizacoes o LEFT JOIN planos_assinatura p ON p.id = o.plano_id WHERE o.id = ?', [(int)$id])->fetch();
    return $o ?: null;
}

/** [id da empresa do usuário (0 = nenhuma), é administrador da empresa]. O resultado é guardado durante a requisição. */
function usuario_organizacao_id(array $u)
{
    static $cache = [];
    $uid = (int)($u['id'] ?? 0);
    if (!$uid) {
        return [0, false];
    }
    if (!array_key_exists($uid, $cache)) {
        try {
            $r = q_global('SELECT organizacao_id, admin_organizacao FROM usuarios WHERE id = ?', [$uid])->fetch();
            $cache[$uid] = $r && (int)$r['organizacao_id'] > 0 ? [(int)$r['organizacao_id'], (int)$r['admin_organizacao'] === 1] : [0, false];
        } catch (Throwable $e) {
            $cache[$uid] = [0, false];   // banco ainda sem as colunas
        }
    }
    return $cache[$uid];
}

function usuario_admin_organizacao(array $u)
{
    return usuario_organizacao_id($u)[1];
}

/** Áreas que o plano da empresa do usuário libera; null = sem restrição (sem empresa, regra desligada ou administrador do sistema). */
function organizacao_modulos_do_usuario(array $u)
{
    if (($u['perfil'] ?? '') === 'admin' || !planos_config()['exigir_plano']) {
        return null;
    }
    list($oid) = usuario_organizacao_id($u);
    if (!$oid) {
        return null;
    }
    $o = organizacao_ler($oid);
    return $o ? plano_modulos(['modulos' => $o['plano_modulos']]) : null;
}

function organizacao_obras_em_uso($orgId)
{
    return (int)q_global("SELECT COUNT(*) FROM obras WHERE organizacao_id = ? AND status IN ('ativa', 'rascunho') AND (origem_obra_id IS NULL OR origem_obra_id = 0)", [(int)$orgId])->fetchColumn();
}

function organizacao_usuarios_em_uso($orgId)
{
    return (int)q_global('SELECT COUNT(*) FROM usuarios WHERE organizacao_id = ? AND ativo = 1', [(int)$orgId])->fetchColumn();
}

/** Obras que o usuário cria e administra sem empresa (regra antiga, usada quando ele não pertence a nenhuma empresa). */
function planos_obras_em_uso($usuarioId)
{
    return (int)q_global("SELECT COUNT(*) FROM obras o JOIN usuarios_obras uo ON uo.obra_id = o.id
        WHERE uo.usuario_id = ? AND uo.admin_obra = 1 AND o.status IN ('ativa', 'rascunho') AND (o.origem_obra_id IS NULL OR o.origem_obra_id = 0)", [(int)$usuarioId])->fetchColumn();
}

/** Situação financeira da empresa: rótulo, classe de cor, dias (negativo = atraso) e se ainda pode criar obras/usuários. */
function organizacao_situacao(array $o = null, array $cfg = null)
{
    $cfg = $cfg ?: planos_config();
    if (!$o) {
        return ['codigo' => 'SEM_PLANO', 'rotulo' => 'Sem plano', 'cls' => 'cinza', 'pode_criar' => false, 'dias' => null];
    }
    $hoje = planos_hoje();
    if ($o['status'] === 'CANCELADA') {
        return ['codigo' => 'CANCELADA', 'rotulo' => 'Cancelada', 'cls' => 'cinza', 'pode_criar' => false, 'dias' => null];
    }
    if ($o['status'] === 'SUSPENSA') {
        return ['codigo' => 'SUSPENSA', 'rotulo' => 'Suspensa', 'cls' => 'vermelho', 'pode_criar' => false, 'dias' => null];
    }
    if (empty($o['plano_id'])) {
        return ['codigo' => 'SEM_PLANO', 'rotulo' => 'Sem plano', 'cls' => 'cinza', 'pode_criar' => false, 'dias' => null];
    }
    $venc = $o['vencimento'];
    $dias = $venc ? (int)round((strtotime($venc) - strtotime($hoje)) / 86400) : null;
    if ($venc && $dias < 0) {
        $dentro = -$dias <= $cfg['tolerancia_dias'];
        return ['codigo' => $dentro ? 'TOLERANCIA' : 'VENCIDA', 'rotulo' => $dentro ? 'Vencida (tolerância)' : 'Vencida', 'cls' => $dentro ? 'amarelo' : 'vermelho', 'pode_criar' => $dentro, 'dias' => $dias];
    }
    if ($o['status'] === 'TESTE') {
        return ['codigo' => 'TESTE', 'rotulo' => 'Em teste', 'cls' => 'azul', 'pode_criar' => true, 'dias' => $dias];
    }
    if ($venc && $dias <= 7) {
        return ['codigo' => 'A_VENCER', 'rotulo' => 'Vence em ' . $dias . ' dia(s)', 'cls' => 'amarelo', 'pode_criar' => true, 'dias' => $dias];
    }
    return ['codigo' => 'ATIVA', 'rotulo' => 'Ativa', 'cls' => 'verde', 'pode_criar' => true, 'dias' => $dias];
}

/** Limite de obras da empresa (0 = ilimitado): plano + obras extras contratadas. */
function organizacao_limite_obras(array $o)
{
    return (int)$o['plano_max_obras'] === 0 ? 0 : (int)$o['plano_max_obras'] + max(0, (int)$o['obras_extra']);
}

function organizacao_limite_usuarios(array $o)
{
    return (int)$o['plano_max_usuarios'] === 0 ? 0 : (int)$o['plano_max_usuarios'] + max(0, (int)$o['usuarios_extra']);
}

/**
 * Pode o usuário criar mais uma obra? Devolve [ok, mensagem, info]. Administrador do sistema nunca é limitado;
 * com "Exigir plano" desligado nada muda para ninguém. Quem pertence a uma empresa usa o plano DELA.
 */
function plano_verificar_criacao(array $u)
{
    $cfg = planos_config();
    list($oid) = usuario_organizacao_id($u);
    $o = $oid ? organizacao_ler($oid) : null;
    if ($o) {
        $sit = organizacao_situacao($o, $cfg);
        $limite = organizacao_limite_obras($o);
        $usados = organizacao_obras_em_uso($oid);
        $info = ['exigido' => (bool)$cfg['exigir_plano'], 'usadas' => $usados, 'limite' => $limite, 'ilimitado' => $limite === 0, 'plano' => $o['plano_nome'], 'ciclo' => $o['ciclo'],
            'vencimento' => $o['vencimento'], 'situacao' => $sit, 'tem_assinatura' => true, 'empresa' => $o['nome'], 'org_id' => (int)$oid, 'nivel' => (int)$o['plano_nivel'],
            'usuarios_usados' => organizacao_usuarios_em_uso($oid), 'usuarios_limite' => organizacao_limite_usuarios($o), 'admin_empresa' => usuario_admin_organizacao($u)];
        if (($u['perfil'] ?? '') === 'admin' || !$cfg['exigir_plano']) {
            return [true, '', $info];
        }
        if (!$sit['pode_criar']) {
            $motivo = ['CANCELADA' => 'A assinatura da empresa foi cancelada.', 'SUSPENSA' => 'A assinatura da empresa está suspensa.', 'SEM_PLANO' => 'A empresa está sem plano.',
                'VENCIDA' => 'A assinatura da empresa venceu em ' . ($o['vencimento'] ? date('d/m/Y', strtotime($o['vencimento'])) : '—') . '.'][$sit['codigo']] ?? 'A assinatura da empresa não está ativa.';
            return [false, $motivo . ' Regularize o pagamento para criar novas obras (as obras que já existem continuam funcionando).', $info];
        }
        if ($limite !== 0 && $usados >= $limite) {
            return [false, 'A empresa atingiu o limite do ' . $o['plano_nome'] . ': ' . $usados . ' de ' . $limite . ' obra(s). Arquive uma obra ou peça ao administrador do sistema um plano maior.', $info];
        }
        return [true, '', $info];
    }
    $usados = planos_obras_em_uso($u['id']);
    $limite = $cfg['limite_sem_plano'];
    $info = ['exigido' => (bool)$cfg['exigir_plano'], 'usadas' => $usados, 'limite' => $limite, 'ilimitado' => false, 'plano' => null, 'ciclo' => null, 'vencimento' => null,
        'situacao' => organizacao_situacao(null, $cfg), 'tem_assinatura' => false, 'empresa' => null, 'org_id' => 0, 'nivel' => 0, 'usuarios_usados' => 0, 'usuarios_limite' => 0, 'admin_empresa' => false];
    if (($u['perfil'] ?? '') === 'admin' || !$cfg['exigir_plano']) {
        return [true, '', $info];
    }
    if ($usados >= $limite) {
        return [false, $limite === 0 ? 'Para criar obras é preciso que sua empresa tenha um plano. Fale com o administrador do sistema para contratar.' : 'Você atingiu o limite de ' . $limite . ' obra(s) sem plano. Fale com o administrador para contratar um plano.', $info];
    }
    return [true, '', $info];
}

/** Pode a empresa criar mais um usuário? [ok, mensagem]. Vale para a página de usuários da empresa e para a Administração da obra. */
function plano_verificar_usuario($orgId)
{
    $cfg = planos_config();
    $o = $orgId ? organizacao_ler($orgId) : null;
    if (!$o || !$cfg['exigir_plano']) {
        return [true, ''];
    }
    $sit = organizacao_situacao($o, $cfg);
    if (!$sit['pode_criar']) {
        return [false, 'A assinatura da empresa não está em dia (' . $sit['rotulo'] . '). Regularize o pagamento para criar novos usuários.'];
    }
    $lim = organizacao_limite_usuarios($o);
    $usados = organizacao_usuarios_em_uso($orgId);
    if ($lim !== 0 && $usados >= $lim) {
        return [false, 'A empresa atingiu o limite do ' . $o['plano_nome'] . ': ' . $usados . ' de ' . $lim . ' usuário(s). Desative um usuário ou peça ao administrador do sistema um plano maior.'];
    }
    return [true, ''];
}

/** Liga uma obra à empresa e dá a todos os administradores da empresa o controle dela. */
function organizacao_vincular_obra($orgId, $obraId)
{
    q_global('UPDATE obras SET organizacao_id = ? WHERE id = ?', [(int)$orgId, (int)$obraId]);
    foreach (q_global('SELECT id FROM usuarios WHERE organizacao_id = ? AND admin_organizacao = 1 AND ativo = 1', [(int)$orgId])->fetchAll(PDO::FETCH_COLUMN) as $uid) {
        organizacao_ligar_usuario_obra($uid, $obraId, 1);
    }
}

function organizacao_ligar_usuario_obra($uid, $obraId, $admin = 0)
{
    $linha = q_global('SELECT admin_obra FROM usuarios_obras WHERE usuario_id = ? AND obra_id = ?', [(int)$uid, (int)$obraId])->fetch();
    if (!$linha) {
        q_global('INSERT INTO usuarios_obras (usuario_id, obra_id, admin_obra) VALUES (?, ?, ?)', [(int)$uid, (int)$obraId, $admin ? 1 : 0]);
    } elseif ($admin && !(int)$linha['admin_obra']) {
        q_global('UPDATE usuarios_obras SET admin_obra = 1 WHERE usuario_id = ? AND obra_id = ?', [(int)$uid, (int)$obraId]);
    }
}

/** Cria o usuário (login único, senha com 8+ caracteres) já ligado à empresa; devolve [id, erros]. Não abre transação. */
function organizacao_usuario_inserir($orgId, array $e, $admin = false)
{
    $login = trim((string)($e['login'] ?? ''));
    $nome = trim((string)($e['nome'] ?? ''));
    $email = trim((string)($e['email'] ?? ''));
    $senha = (string)($e['senha'] ?? '');
    if ($nome === '' || $login === '') {
        return [0, ['Informe o nome e o login do usuário.']];
    }
    if (!preg_match('/^[A-Za-z0-9._@-]{3,50}$/', $login)) {
        return [0, ['Login: de 3 a 50 caracteres (letras, números, ponto, hífen, sublinhado ou @).']];
    }
    if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        return [0, ['Informe um e-mail válido.']];
    }
    if (strlen($senha) < 8) {
        return [0, ['A senha inicial precisa ter pelo menos 8 caracteres.']];
    }
    if (q_global('SELECT id FROM usuarios WHERE login = ?', [$login])->fetch()) {
        return [0, ['Já existe um usuário com o login “' . $login . '”.']];
    }
    $perfil = $admin ? 'editor' : (in_array($e['perfil'] ?? '', ['editor', 'leitura'], true) ? $e['perfil'] : 'editor');
    q_global('INSERT INTO usuarios (nome, login, senha, perfil, papel, empresa, email, ativo, organizacao_id, admin_organizacao) VALUES (?, ?, ?, ?, ?, NULL, ?, 1, ?, ?)',
        [$nome, $login, password_hash($senha, PASSWORD_DEFAULT), $perfil, $admin ? 'admin_empresa' : ($perfil === 'leitura' ? 'leitor' : 'editor_empresa'), texto_ou_nulo($email), (int)$orgId, $admin ? 1 : 0]);
    $uid = (int)bd()->lastInsertId();
    if ($admin) {
        foreach (q_global('SELECT id FROM obras WHERE organizacao_id = ?', [(int)$orgId])->fetchAll(PDO::FETCH_COLUMN) as $obraId) {
            organizacao_ligar_usuario_obra($uid, $obraId, 1);
        }
    }
    return [$uid, []];
}

/** Grava as áreas do usuário (limitadas às do plano da empresa). */
function organizacao_usuario_modulos($uid, array $mods, array $permitidas)
{
    q_global('DELETE FROM usuarios_modulos WHERE usuario_id = ?', [(int)$uid]);
    foreach (array_values(array_intersect($permitidas, array_map('strval', $mods))) as $m) {
        q_global('INSERT INTO usuarios_modulos (usuario_id, modulo, permitido) VALUES (?, ?, 1)', [(int)$uid, $m]);
    }
}

/**
 * Cadastra a empresa cliente junto com o usuário administrador dela. Devolve [id da empresa, erros]; usar dentro de uma transação
 * (erro no administrador lança InvalidArgumentException para a página desfazer tudo).
 * $e: nome, documento, contato, email, telefone, plano_id, ciclo, preco (vazio = preço do plano), obras_extra, usuarios_extra, status, inicio, vencimento, obs
 *     e admin_nome, admin_login, admin_email, admin_senha.
 */
function organizacao_criar(array $e)
{
    list($dados, $erros) = organizacao_validar($e);
    if ($erros) {
        return [0, $erros];
    }
    $adm = ['nome' => $e['admin_nome'] ?? '', 'login' => $e['admin_login'] ?? '', 'email' => $e['admin_email'] ?? '', 'senha' => $e['admin_senha'] ?? ''];
    if (trim($adm['nome']) === '' || trim($adm['login']) === '') {
        return [0, ['Informe o nome e o login do administrador da empresa.']];
    }
    $campos = ['nome', 'documento', 'contato', 'email', 'telefone', 'plano_id', 'ciclo', 'preco', 'obras_extra', 'usuarios_extra', 'inicio', 'vencimento', 'status', 'obs'];
    q_global('INSERT INTO organizacoes (' . implode(', ', $campos) . ', criado_em, atualizado_em) VALUES (' . implode(', ', array_fill(0, count($campos), '?')) . ', ?, ?)',
        array_merge(array_map(function ($c) use ($dados) { return $dados[$c]; }, $campos), [planos_agora(), planos_agora()]));
    $id = (int)bd()->lastInsertId();
    list($uid, $erros) = organizacao_usuario_inserir($id, $adm, true);
    if ($erros) {
        throw new InvalidArgumentException(implode(' ', $erros));
    }
    registrar_global('organizacao_criar', ['id' => $id, 'nome' => $dados['nome'], 'admin' => trim($adm['login'])]);
    return [$id, []];
}

/** Valida os campos da empresa e devolve [dados prontos para gravar, erros]. */
function organizacao_validar(array $e)
{
    $nome = trim((string)($e['nome'] ?? ''));
    $erros = [];
    if ($nome === '' || mb_strlen($nome, 'UTF-8') > 120) {
        $erros[] = 'Informe o nome da empresa (até 120 caracteres).';
    }
    $plano = q_global('SELECT * FROM planos_assinatura WHERE id = ? AND nivel > 0', [(int)($e['plano_id'] ?? 0)])->fetch();
    if (!$plano) {
        $erros[] = 'Escolha o plano da empresa.';
    }
    $ciclo = strtoupper((string)($e['ciclo'] ?? 'MENSAL'));
    if (!isset(planos_ciclos()[$ciclo])) {
        $erros[] = 'Escolha o ciclo: mensal ou anual.';
    }
    $status = strtoupper((string)($e['status'] ?? 'TESTE'));
    if (!isset(planos_status_lista()[$status])) {
        $erros[] = 'Situação inválida.';
    }
    $inicio = (string)($e['inicio'] ?? '');
    $venc = (string)($e['vencimento'] ?? '');
    if (!data_valida($inicio)) {
        $erros[] = 'Informe a data de início.';
    }
    if (!data_valida($venc)) {
        $erros[] = 'Informe o vencimento (fim do período já pago ou do teste).';
    } elseif (data_valida($inicio) && $venc < $inicio) {
        $erros[] = 'O vencimento não pode ser anterior ao início.';
    }
    $email = trim((string)($e['email'] ?? ''));
    if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        $erros[] = 'E-mail da empresa inválido.';
    }
    $precoIn = $e['preco'] ?? '';
    $preco = ($precoIn === '' || $precoIn === null) && $plano ? (float)($ciclo === 'ANUAL' ? $plano['preco_anual'] : $plano['preco_mensal']) : numero($precoIn);
    if ($preco === null || $preco < 0) {
        $erros[] = 'Informe o valor cobrado por ciclo (zero ou maior).';
    }
    if ($erros) {
        return [null, $erros];
    }
    return [[
        'nome' => $nome, 'documento' => texto_ou_nulo(mb_substr((string)($e['documento'] ?? ''), 0, 30, 'UTF-8')), 'contato' => texto_ou_nulo(mb_substr((string)($e['contato'] ?? ''), 0, 120, 'UTF-8')),
        'email' => texto_ou_nulo($email), 'telefone' => texto_ou_nulo(mb_substr((string)($e['telefone'] ?? ''), 0, 30, 'UTF-8')), 'plano_id' => (int)$plano['id'], 'ciclo' => $ciclo,
        'preco' => round((float)$preco, 2), 'obras_extra' => max(0, min(1000, (int)($e['obras_extra'] ?? 0))), 'usuarios_extra' => max(0, min(100000, (int)($e['usuarios_extra'] ?? 0))),
        'inicio' => $inicio, 'vencimento' => $venc, 'status' => $status, 'obs' => texto_ou_nulo($e['obs'] ?? null),
    ], []];
}

function organizacao_salvar(array $e)
{
    $id = (int)($e['id'] ?? 0);
    if (!q_global('SELECT id FROM organizacoes WHERE id = ?', [$id])->fetch()) {
        return ['Empresa não encontrada.'];
    }
    list($dados, $erros) = organizacao_validar($e);
    if ($erros) {
        return $erros;
    }
    $campos = ['nome', 'documento', 'contato', 'email', 'telefone', 'plano_id', 'ciclo', 'preco', 'obras_extra', 'usuarios_extra', 'inicio', 'vencimento', 'status', 'obs'];
    q_global('UPDATE organizacoes SET ' . implode(' = ?, ', $campos) . ' = ?, atualizado_em = ? WHERE id = ?',
        array_merge(array_map(function ($c) use ($dados) { return $dados[$c]; }, $campos), [planos_agora(), $id]));
    registrar_global('organizacao_salvar', ['id' => $id, 'plano' => $dados['plano_id'], 'status' => $dados['status']]);
    return [];
}

/** Registra o pagamento e renova: o novo vencimento soma um ciclo ao vencimento atual (ou à data do pagamento, se já tinha vencido). */
function organizacao_registrar_pagamento(array $e, array $admin)
{
    $o = q_global('SELECT * FROM organizacoes WHERE id = ?', [(int)($e['organizacao_id'] ?? 0)])->fetch();
    if (!$o) {
        return ['Empresa não encontrada.'];
    }
    $data = (string)($e['data_pagamento'] ?? '');
    $valor = numero($e['valor'] ?? null);
    if (!data_valida($data) || $data > planos_hoje()) {
        return ['Informe a data do pagamento (hoje ou anterior).'];
    }
    if ($valor === null || $valor <= 0) {
        return ['Informe o valor recebido (maior que zero).'];
    }
    $base = $o['vencimento'] && $o['vencimento'] >= $data ? $o['vencimento'] : $data;
    $novo = planos_somar_ciclo($base, $o['ciclo']);
    q_global('INSERT INTO organizacoes_pagamentos (organizacao_id, data_pagamento, valor, periodo_ate, forma, obs, por, em) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [(int)$o['id'], $data, round((float)$valor, 2), $novo, texto_ou_nulo(mb_substr((string)($e['forma'] ?? ''), 0, 30, 'UTF-8')), texto_ou_nulo(mb_substr((string)($e['obs'] ?? ''), 0, 255, 'UTF-8')), $admin['nome'], planos_agora()]);
    q_global("UPDATE organizacoes SET vencimento = ?, status = 'ATIVA', atualizado_em = ? WHERE id = ?", [$novo, planos_agora(), (int)$o['id']]);
    registrar_global('organizacao_pagamento', ['organizacao' => (int)$o['id'], 'valor' => round((float)$valor, 2), 'vencimento' => $novo]);
    return [];
}

/** Receita recorrente: mensal = preço; anual = preço ÷ 12. Só empresas ativas e em dia (teste não conta). */
function planos_indicadores()
{
    $cfg = planos_config();
    $ind = ['empresas' => 0, 'assinantes' => 0, 'teste' => 0, 'inadimplentes' => 0, 'a_vencer' => 0, 'mrr' => 0.0, 'arr' => 0.0, 'recebido_mes' => 0.0,
        'obras_em_uso' => 0, 'vagas_obras' => 0, 'usuarios_em_uso' => 0, 'vagas_usuarios' => 0];
    foreach (q_global('SELECT id FROM organizacoes')->fetchAll(PDO::FETCH_COLUMN) as $oid) {
        $o = organizacao_ler($oid);
        $ind['empresas']++;
        $s = organizacao_situacao($o, $cfg);
        $ind['obras_em_uso'] += organizacao_obras_em_uso($oid);
        $ind['usuarios_em_uso'] += organizacao_usuarios_em_uso($oid);
        $ind['vagas_obras'] += organizacao_limite_obras($o);
        $ind['vagas_usuarios'] += organizacao_limite_usuarios($o);
        if ($s['codigo'] === 'TESTE') {
            $ind['teste']++;
            continue;
        }
        if (in_array($s['codigo'], ['VENCIDA', 'TOLERANCIA'], true)) {
            $ind['inadimplentes']++;
        }
        if ($s['codigo'] === 'A_VENCER') {
            $ind['a_vencer']++;
        }
        if ($o['status'] === 'ATIVA') {
            $ind['assinantes']++;
            if ($s['codigo'] !== 'VENCIDA') {
                $ind['mrr'] += $o['ciclo'] === 'ANUAL' ? $o['preco'] / 12 : $o['preco'];
            }
        }
    }
    $ind['mrr'] = round($ind['mrr'], 2);
    $ind['arr'] = round($ind['mrr'] * 12, 2);
    $mes = substr(planos_hoje(), 0, 7);
    $ind['recebido_mes'] = round((float)q_global('SELECT COALESCE(SUM(valor), 0) FROM organizacoes_pagamentos WHERE data_pagamento >= ? AND data_pagamento <= ?', [$mes . '-01', $mes . '-31'])->fetchColumn(), 2);
    return $ind;
}

// ---- Configurações da empresa cliente (lidas também pela API dos relatórios) ----
function cfg_json_ler($chave)
{
    $d = json_decode((string)global_ler($chave, '{}'), true);
    return is_array($d) ? $d : [];
}

/** Identidade visual da empresa nos relatórios oficiais: ['logo' => data URI, 'cor' => '#rrggbb', 'por', 'em']. */
function cfg_identidade_ler($orgId)
{
    $t = cfg_json_ler('identidade_organizacoes');
    $d = is_array($t[(string)(int)$orgId] ?? null) ? $t[(string)(int)$orgId] : [];
    return ['logo' => (string)($d['logo'] ?? ''), 'cor' => (string)($d['cor'] ?? ''), 'cor2' => (string)($d['cor2'] ?? ''), 'por' => (string)($d['por'] ?? ''), 'em' => (string)($d['em'] ?? '')];
}
