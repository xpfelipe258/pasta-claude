<?php
// Planos, assinaturas e limite de obras por usuário (comercialização do sistema).
//
// REGRA: cada usuário (que não seja administrador do sistema) tem no máximo N obras criadas por ele, conforme o plano da assinatura
// (mais as obras extras contratadas). Contam as obras que ele administra (usuarios_obras.admin_obra = 1) com situação ativa ou em importação;
// obra arquivada não conta. Assinatura vencida (depois da tolerância), suspensa ou cancelada bloqueia a CRIAÇÃO de obras novas — as obras já criadas
// continuam abrindo normalmente. A regra só vale quando o administrador liga "Exigir plano" em Administração › Planos e limites de obras.
//
// Planos: ciclo MENSAL ou ANUAL, preço por ciclo (R$ com centavos) e limite de obras (0 = ilimitado). A assinatura guarda uma cópia do preço e do limite
// do plano no momento da contratação (preço negociado e mudanças futuras no catálogo não alteram quem já assina).

function planos_sql($pk, $longo, $fim)
{
    return "CREATE TABLE IF NOT EXISTS planos_assinatura (id $pk, nome VARCHAR(80) NOT NULL, ciclo VARCHAR(10) NOT NULL DEFAULT 'MENSAL', preco DOUBLE NOT NULL DEFAULT 0,
        max_obras INT NOT NULL DEFAULT 1, obs VARCHAR(255) NULL, ativo INT NOT NULL DEFAULT 1, criado_em VARCHAR(19) NULL)$fim";
}

function assinaturas_sql($pk, $longo, $fim)
{
    return "CREATE TABLE IF NOT EXISTS assinaturas (id $pk, usuario_id INT NOT NULL UNIQUE, plano_id INT NULL, plano_nome VARCHAR(80) NULL, ciclo VARCHAR(10) NOT NULL DEFAULT 'MENSAL',
        preco DOUBLE NOT NULL DEFAULT 0, max_obras INT NOT NULL DEFAULT 1, obras_extra INT NOT NULL DEFAULT 0, inicio DATE NULL, vencimento DATE NULL,
        status VARCHAR(12) NOT NULL DEFAULT 'ATIVA', obs $longo NULL, criado_em VARCHAR(19) NULL, atualizado_em VARCHAR(19) NULL)$fim";
}

function assinaturas_pagamentos_sql($pk, $fim)
{
    return "CREATE TABLE IF NOT EXISTS assinaturas_pagamentos (id $pk, assinatura_id INT NOT NULL, data_pagamento DATE NOT NULL, valor DOUBLE NOT NULL DEFAULT 0,
        periodo_ate DATE NULL, forma VARCHAR(30) NULL, obs VARCHAR(255) NULL, por VARCHAR(100) NULL, em VARCHAR(19) NULL)$fim";
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
        'limite_sem_plano' => max(0, (int)($c['limite_sem_plano'] ?? 0)),  // obras que quem NÃO tem assinatura pode criar quando o plano é exigido
        'tolerancia_dias' => max(0, min(60, (int)($c['tolerancia_dias'] ?? 5))),   // dias depois do vencimento em que ainda pode criar obra
        'dias_teste' => max(1, min(90, (int)($c['dias_teste'] ?? 14))),
    ];
}

function planos_config_salvar(array $e)
{
    $c = [
        'exigir_plano' => !empty($e['exigir_plano']) ? 1 : 0,
        'limite_sem_plano' => max(0, min(1000, (int)($e['limite_sem_plano'] ?? 0))),
        'tolerancia_dias' => max(0, min(60, (int)($e['tolerancia_dias'] ?? 5))),
        'dias_teste' => max(1, min(90, (int)($e['dias_teste'] ?? 14))),
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

function planos_listar($somenteAtivos = false)
{
    $sql = 'SELECT * FROM planos_assinatura' . ($somenteAtivos ? ' WHERE ativo = 1' : '') . ' ORDER BY CASE WHEN ciclo = \'MENSAL\' THEN 0 ELSE 1 END, preco, nome';
    return q_global($sql)->fetchAll();
}

function planos_semear_exemplos()
{
    if ((int)q_global('SELECT COUNT(*) FROM planos_assinatura')->fetchColumn() > 0) {
        return 0;
    }
    $exemplos = [
        ['Essencial', 'MENSAL', 197.00, 1, '1 obra'],
        ['Profissional', 'MENSAL', 497.00, 5, 'até 5 obras'],
        ['Profissional anual', 'ANUAL', 4970.00, 5, 'até 5 obras — 2 meses grátis no pagamento anual'],
        ['Empresarial anual', 'ANUAL', 11940.00, 20, 'até 20 obras — 2 meses grátis no pagamento anual'],
    ];
    foreach ($exemplos as $e) {
        q_global('INSERT INTO planos_assinatura (nome, ciclo, preco, max_obras, obs, ativo, criado_em) VALUES (?, ?, ?, ?, ?, 1, ?)', array_merge($e, [planos_agora()]));
    }
    return count($exemplos);
}

function planos_salvar(array $e, $id = 0)
{
    $nome = trim((string)($e['nome'] ?? ''));
    $ciclo = strtoupper((string)($e['ciclo'] ?? ''));
    $preco = numero($e['preco'] ?? null);
    $max = $e['max_obras'] ?? '';
    $erros = [];
    if ($nome === '' || mb_strlen($nome, 'UTF-8') > 80) {
        $erros[] = 'Informe o nome do plano (até 80 caracteres).';
    }
    if (!isset(planos_ciclos()[$ciclo])) {
        $erros[] = 'Escolha o ciclo: mensal ou anual.';
    }
    if ($preco === null || $preco < 0) {
        $erros[] = 'Informe o preço do plano (zero ou maior).';
    }
    if (!is_numeric($max) || (int)$max < 0 || (int)$max > 10000) {
        $erros[] = 'Limite de obras: use um número inteiro (0 = ilimitado).';
    }
    if ($erros) {
        return [0, $erros];
    }
    $obs = texto_ou_nulo(mb_substr((string)($e['obs'] ?? ''), 0, 255, 'UTF-8'));
    $ativo = !empty($e['ativo']) ? 1 : 0;
    if ($id) {
        q_global('UPDATE planos_assinatura SET nome = ?, ciclo = ?, preco = ?, max_obras = ?, obs = ?, ativo = ? WHERE id = ?', [$nome, $ciclo, round((float)$preco, 2), (int)$max, $obs, $ativo, (int)$id]);
        return [(int)$id, []];
    }
    q_global('INSERT INTO planos_assinatura (nome, ciclo, preco, max_obras, obs, ativo, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?)', [$nome, $ciclo, round((float)$preco, 2), (int)$max, $obs, $ativo, planos_agora()]);
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

function assinatura_do_usuario($usuarioId)
{
    $a = q_global('SELECT * FROM assinaturas WHERE usuario_id = ?', [(int)$usuarioId])->fetch();
    return $a ?: null;
}

/** Obras que o usuário criou e administra e que ocupam uma vaga do plano (ativas ou em importação; arquivada e obra própria de empresa não contam). */
function planos_obras_em_uso($usuarioId)
{
    return (int)q_global("SELECT COUNT(*) FROM obras o JOIN usuarios_obras uo ON uo.obra_id = o.id
        WHERE uo.usuario_id = ? AND uo.admin_obra = 1 AND o.status IN ('ativa', 'rascunho') AND (o.origem_obra_id IS NULL OR o.origem_obra_id = 0)", [(int)$usuarioId])->fetchColumn();
}

/** Situação financeira da assinatura: ok, rótulo, classe de cor e quantos dias de atraso/restantes. */
function assinatura_situacao(array $a = null, array $cfg = null)
{
    $cfg = $cfg ?: planos_config();
    if (!$a) {
        return ['codigo' => 'SEM_PLANO', 'rotulo' => 'Sem plano', 'cls' => 'cinza', 'pode_criar' => false, 'dias' => null];
    }
    $hoje = planos_hoje();
    if ($a['status'] === 'CANCELADA') {
        return ['codigo' => 'CANCELADA', 'rotulo' => 'Cancelada', 'cls' => 'cinza', 'pode_criar' => false, 'dias' => null];
    }
    if ($a['status'] === 'SUSPENSA') {
        return ['codigo' => 'SUSPENSA', 'rotulo' => 'Suspensa', 'cls' => 'vermelho', 'pode_criar' => false, 'dias' => null];
    }
    $venc = $a['vencimento'];
    $dias = $venc ? (int)round((strtotime($venc) - strtotime($hoje)) / 86400) : null;   // negativo = dias de atraso
    if ($venc && $dias < 0) {
        $dentro = -$dias <= $cfg['tolerancia_dias'];
        return ['codigo' => $dentro ? 'TOLERANCIA' : 'VENCIDA', 'rotulo' => $dentro ? 'Vencida (tolerância)' : 'Vencida', 'cls' => $dentro ? 'amarelo' : 'vermelho', 'pode_criar' => $dentro, 'dias' => $dias];
    }
    if ($a['status'] === 'TESTE') {
        return ['codigo' => 'TESTE', 'rotulo' => 'Em teste', 'cls' => 'azul', 'pode_criar' => true, 'dias' => $dias];
    }
    if ($venc && $dias <= 7) {
        return ['codigo' => 'A_VENCER', 'rotulo' => 'Vence em ' . $dias . ' dia(s)', 'cls' => 'amarelo', 'pode_criar' => true, 'dias' => $dias];
    }
    return ['codigo' => 'ATIVA', 'rotulo' => 'Ativa', 'cls' => 'verde', 'pode_criar' => true, 'dias' => $dias];
}

function assinatura_limite(array $a = null, array $cfg = null)
{
    $cfg = $cfg ?: planos_config();
    if (!$a) {
        return $cfg['limite_sem_plano'];
    }
    return (int)$a['max_obras'] === 0 ? 0 : (int)$a['max_obras'] + max(0, (int)$a['obras_extra']);   // 0 = ilimitado
}

/**
 * Pode o usuário criar mais uma obra? Devolve [ok, mensagem, info]. Administrador do sistema nunca é limitado;
 * com "Exigir plano" desligado nada muda para ninguém.
 */
function plano_verificar_criacao(array $u)
{
    $cfg = planos_config();
    $usados = planos_obras_em_uso($u['id']);
    $a = assinatura_do_usuario($u['id']);
    $sit = assinatura_situacao($a, $cfg);
    $limite = assinatura_limite($a, $cfg);
    $info = ['exigido' => (bool)$cfg['exigir_plano'], 'usadas' => $usados, 'limite' => $limite, 'ilimitado' => $a ? $limite === 0 : false,
        'plano' => $a ? $a['plano_nome'] : null, 'ciclo' => $a ? $a['ciclo'] : null, 'vencimento' => $a ? $a['vencimento'] : null, 'situacao' => $sit, 'tem_assinatura' => (bool)$a];
    if (($u['perfil'] ?? '') === 'admin' || !$cfg['exigir_plano']) {
        return [true, '', $info];
    }
    if ($a && !$sit['pode_criar']) {
        $motivo = ['CANCELADA' => 'A assinatura foi cancelada.', 'SUSPENSA' => 'A assinatura está suspensa.', 'VENCIDA' => 'A assinatura venceu em ' . date('d/m/Y', strtotime($a['vencimento'])) . '.'][$sit['codigo']] ?? 'A assinatura não está ativa.';
        return [false, $motivo . ' Regularize o pagamento para criar novas obras (as obras que você já criou continuam funcionando).', $info];
    }
    if ($a && $limite === 0) {
        return [true, '', $info];   // plano ilimitado
    }
    if ($usados >= $limite) {
        if (!$a) {
            return [false, $limite === 0 ? 'Para criar obras é preciso ter um plano. Fale com o administrador do sistema para contratar.' : 'Você atingiu o limite de ' . $limite . ' obra(s) sem plano. Fale com o administrador para contratar um plano.', $info];
        }
        return [false, 'Você atingiu o limite do plano ' . $a['plano_nome'] . ': ' . $usados . ' de ' . $limite . ' obra(s). Arquive uma obra ou peça ao administrador um plano maior.', $info];
    }
    return [true, '', $info];
}

function assinatura_salvar(array $e)
{
    $uid = (int)($e['usuario_id'] ?? 0);
    if ($uid <= 0 || !q_global('SELECT id FROM usuarios WHERE id = ?', [$uid])->fetch()) {
        return ['Usuário não encontrado.'];
    }
    $plano = q_global('SELECT * FROM planos_assinatura WHERE id = ?', [(int)($e['plano_id'] ?? 0)])->fetch();
    if (!$plano) {
        return ['Escolha o plano.'];
    }
    $status = strtoupper((string)($e['status'] ?? 'ATIVA'));
    if (!isset(planos_status_lista()[$status])) {
        return ['Situação inválida.'];
    }
    $venc = (string)($e['vencimento'] ?? '');
    $inicio = (string)($e['inicio'] ?? '');
    if (!data_valida($inicio)) {
        return ['Informe a data de início.'];
    }
    if (!data_valida($venc)) {
        return ['Informe o vencimento (fim do período já pago).'];
    }
    if ($venc < $inicio) {
        return ['O vencimento não pode ser anterior ao início.'];
    }
    $preco = $e['preco'] === '' || !isset($e['preco']) ? (float)$plano['preco'] : numero($e['preco']);
    if ($preco === null || $preco < 0) {
        return ['Informe o valor cobrado (zero ou maior).'];
    }
    $extra = max(0, min(1000, (int)($e['obras_extra'] ?? 0)));
    $atual = assinatura_do_usuario($uid);
    $dados = [$plano['id'], $plano['nome'], $plano['ciclo'], round((float)$preco, 2), (int)$plano['max_obras'], $extra, $inicio, $venc, $status, texto_ou_nulo($e['obs'] ?? null)];
    if ($atual) {
        q_global('UPDATE assinaturas SET plano_id = ?, plano_nome = ?, ciclo = ?, preco = ?, max_obras = ?, obras_extra = ?, inicio = ?, vencimento = ?, status = ?, obs = ?, atualizado_em = ? WHERE usuario_id = ?',
            array_merge($dados, [planos_agora(), $uid]));
    } else {
        q_global('INSERT INTO assinaturas (plano_id, plano_nome, ciclo, preco, max_obras, obras_extra, inicio, vencimento, status, obs, usuario_id, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            array_merge($dados, [$uid, planos_agora(), planos_agora()]));
    }
    registrar_global($atual ? 'assinatura_salvar' : 'assinatura_criar', ['usuario' => $uid, 'plano' => $plano['nome'], 'status' => $status]);
    return [];
}

/** Registra o pagamento e renova: o novo vencimento soma um ciclo ao vencimento atual (ou à data do pagamento, se já tinha vencido). */
function assinatura_registrar_pagamento(array $e, array $admin)
{
    $a = q_global('SELECT * FROM assinaturas WHERE id = ?', [(int)($e['assinatura_id'] ?? 0)])->fetch();
    if (!$a) {
        return ['Assinatura não encontrada.'];
    }
    $data = (string)($e['data_pagamento'] ?? '');
    $valor = numero($e['valor'] ?? null);
    if (!data_valida($data) || $data > planos_hoje()) {
        return ['Informe a data do pagamento (hoje ou anterior).'];
    }
    if ($valor === null || $valor <= 0) {
        return ['Informe o valor recebido (maior que zero).'];
    }
    $base = $a['vencimento'] && $a['vencimento'] >= $data ? $a['vencimento'] : $data;
    $novo = planos_somar_ciclo($base, $a['ciclo']);
    q_global('INSERT INTO assinaturas_pagamentos (assinatura_id, data_pagamento, valor, periodo_ate, forma, obs, por, em) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [(int)$a['id'], $data, round((float)$valor, 2), $novo, texto_ou_nulo(mb_substr((string)($e['forma'] ?? ''), 0, 30, 'UTF-8')), texto_ou_nulo(mb_substr((string)($e['obs'] ?? ''), 0, 255, 'UTF-8')), $admin['nome'], planos_agora()]);
    q_global("UPDATE assinaturas SET vencimento = ?, status = 'ATIVA', atualizado_em = ? WHERE id = ?", [$novo, planos_agora(), (int)$a['id']]);
    registrar_global('assinatura_pagamento', ['assinatura' => (int)$a['id'], 'valor' => round((float)$valor, 2), 'vencimento' => $novo]);
    return [];
}

/** Receita recorrente: mensal = preço; anual = preço ÷ 12. Só assinaturas ativas pagas (teste não conta). */
function planos_indicadores()
{
    $cfg = planos_config();
    $ind = ['assinantes' => 0, 'teste' => 0, 'inadimplentes' => 0, 'a_vencer' => 0, 'mrr' => 0.0, 'arr' => 0.0, 'recebido_mes' => 0.0, 'obras_em_uso' => 0, 'vagas' => 0, 'sem_plano' => 0];
    $comAss = [];
    foreach (q_global('SELECT * FROM assinaturas')->fetchAll() as $a) {
        $comAss[(int)$a['usuario_id']] = true;
        $s = assinatura_situacao($a, $cfg);
        $ind['obras_em_uso'] += planos_obras_em_uso($a['usuario_id']);
        $lim = assinatura_limite($a, $cfg);
        $ind['vagas'] += $lim;
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
        if (in_array($a['status'], ['ATIVA'], true)) {
            $ind['assinantes']++;
            if (!in_array($s['codigo'], ['VENCIDA'], true)) {
                $ind['mrr'] += $a['ciclo'] === 'ANUAL' ? $a['preco'] / 12 : $a['preco'];
            }
        }
    }
    $ind['mrr'] = round($ind['mrr'], 2);
    $ind['arr'] = round($ind['mrr'] * 12, 2);
    $mes = substr(planos_hoje(), 0, 7);
    $ind['recebido_mes'] = round((float)q_global("SELECT COALESCE(SUM(valor), 0) FROM assinaturas_pagamentos WHERE data_pagamento >= ? AND data_pagamento <= ?", [$mes . '-01', $mes . '-31'])->fetchColumn(), 2);
    $ind['sem_plano'] = (int)q_global("SELECT COUNT(*) FROM usuarios WHERE perfil <> 'admin' AND ativo = 1 AND id NOT IN (SELECT usuario_id FROM assinaturas)")->fetchColumn();
    return $ind;
}
