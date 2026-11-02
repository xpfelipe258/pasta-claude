<?php
// Contas a receber e a pagar AVULSAS da empresa (fora das obras): aluguel do escritório, adiantamento de cliente, venda de equipamento, taxas, fornecedores gerais…
// No Painel financeiro elas entram no resultado geral: somam (a receber) ou descontam (a pagar) do que as obras medem, junto com impostos, folha e outros descontos.

function garantir_fin_avulsas()
{
    static $ok = false;
    if ($ok) { return; }
    $sqlite = (config()['driver'] ?? 'mysql') === 'sqlite';
    $pk = $sqlite ? 'INTEGER PRIMARY KEY AUTOINCREMENT' : 'INT AUTO_INCREMENT PRIMARY KEY';
    $longo = $sqlite ? 'TEXT' : 'MEDIUMTEXT';
    $fim = $sqlite ? '' : ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4';
    bd()->exec("CREATE TABLE IF NOT EXISTS fin_avulsas (id $pk, organizacao_id INT NOT NULL DEFAULT 0, tipo VARCHAR(1) NOT NULL, descricao VARCHAR(160) NOT NULL, categoria VARCHAR(60) NULL,
        contraparte VARCHAR(160) NULL, valor DOUBLE NOT NULL DEFAULT 0, vencimento DATE NOT NULL, baixa_data DATE NULL, valor_baixa DOUBLE NULL, forma VARCHAR(30) NULL,
        parcela VARCHAR(10) NULL, grupo VARCHAR(20) NULL, obs $longo NULL, criado_por INT NOT NULL DEFAULT 0, criado_em VARCHAR(19) NULL, atualizado_em VARCHAR(19) NULL)$fim");
    try { bd()->exec('CREATE INDEX idx_fin_avulsas ON fin_avulsas (organizacao_id, tipo, vencimento)'); } catch (Throwable $e) { /* já existe */ }
    $ok = true;
}

function fav_tipos() { return ['R' => 'Conta a receber', 'P' => 'Conta a pagar']; }

function fav_categorias($tipo)
{
    return $tipo === 'R' ? ['Adiantamento de cliente', 'Venda de equipamento / material', 'Serviço avulso', 'Reembolso', 'Aluguel recebido', 'Rendimento financeiro', 'Outros recebimentos']
        : ['Aluguel e condomínio', 'Água, luz e internet', 'Contabilidade e jurídico', 'Fornecedor', 'Impostos da empresa', 'Salários administrativos', 'Veículos e combustível', 'Marketing e comercial', 'Seguros', 'Empréstimos e financiamentos', 'Outras despesas'];
}

function fav_formas() { return ['PIX', 'Transferência', 'Boleto', 'Cartão', 'Dinheiro', 'Cheque']; }

function fav_escopo(array $u, $alias = '')
{
    list($org) = usuario_organizacao_id($u);
    $a = $alias !== '' ? $alias . '.' : '';
    if (($u['perfil'] ?? '') === 'admin') { return ['1=1', []]; }
    if ($org > 0) { return [$a . 'organizacao_id = ?', [(int)$org]]; }
    return ['(' . $a . 'organizacao_id = 0 AND ' . $a . 'criado_por = ?)', [(int)$u['id']]];
}

function fav_obter($id, array $u)
{
    garantir_fin_avulsas();
    list($w, $p) = fav_escopo($u);
    $r = q_global("SELECT * FROM fin_avulsas WHERE id = ? AND $w", array_merge([(int)$id], $p))->fetch();
    return $r ?: null;
}

/** Situação: aberta, vencida (passou do vencimento sem baixa) ou baixada (recebida / paga). */
function fav_situacao(array $r, $hoje)
{
    if (!empty($r['baixa_data'])) { return ['baixada', $r['tipo'] === 'R' ? 'Recebida' : 'Paga', 'verde']; }
    if ($r['vencimento'] < $hoje) { return ['vencida', 'Vencida há ' . (int)floor((strtotime($hoje) - strtotime($r['vencimento'])) / 86400) . ' dia(s)', 'verm']; }
    return ['aberta', $r['vencimento'] === $hoje ? 'Vence hoje' : 'Em aberto', $r['vencimento'] <= date('Y-m-d', strtotime($hoje . ' +7 days')) ? 'amarelo' : 'azul'];
}

function fav_data($v, $rot)
{
    $v = trim((string)$v);
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $v) || !checkdate((int)substr($v, 5, 2), (int)substr($v, 8, 2), (int)substr($v, 0, 4))) { throw new InvalidArgumentException($rot . ' inválida.'); }
    return $v;
}

/** Cria (ou edita) a conta. Em conta nova, "parcelas" gera uma conta por mês, com o mesmo valor, a partir do vencimento informado. Devolve a quantidade criada. */
function fav_salvar(array $post, array $u, $id = 0)
{
    garantir_fin_avulsas();
    $tipo = ($post['tipo'] ?? '') === 'P' ? 'P' : (($post['tipo'] ?? '') === 'R' ? 'R' : '');
    if ($tipo === '') { throw new InvalidArgumentException('Escolha se é conta a receber ou a pagar.'); }
    $desc = trim((string)($post['descricao'] ?? ''));
    if (mb_strlen($desc) < 3 || mb_strlen($desc) > 160) { throw new InvalidArgumentException('Descreva a conta (3 a 160 caracteres).'); }
    $valor = numero($post['valor'] ?? null);
    if ($valor === null || $valor <= 0) { throw new InvalidArgumentException('Informe o valor da conta (maior que zero).'); }
    $valor = round((float)$valor, 2);
    $venc = fav_data($post['vencimento'] ?? '', 'Data de vencimento');
    list($org) = usuario_organizacao_id($u);
    $campos = ['descricao' => mb_substr($desc, 0, 160), 'categoria' => mb_substr(trim((string)($post['categoria'] ?? '')), 0, 60) ?: null,
        'contraparte' => mb_substr(trim((string)($post['contraparte'] ?? '')), 0, 160) ?: null, 'obs' => mb_substr(trim((string)($post['obs'] ?? '')), 0, 2000) ?: null];
    $agora = agora();
    if ($id) {
        $a = fav_obter($id, $u);
        if (!$a) { throw new InvalidArgumentException('Conta não encontrada.'); }
        q_global('UPDATE fin_avulsas SET tipo = ?, descricao = ?, categoria = ?, contraparte = ?, valor = ?, vencimento = ?, obs = ?, atualizado_em = ? WHERE id = ?',
            [$tipo, $campos['descricao'], $campos['categoria'], $campos['contraparte'], $valor, $venc, $campos['obs'], $agora, (int)$id]);
        return 1;
    }
    $n = max(1, min(60, (int)numero($post['parcelas'] ?? 1)));
    $grupo = $n > 1 ? substr(bin2hex(random_bytes(6)), 0, 12) : null;
    for ($i = 0; $i < $n; $i++) {
        $base = new DateTimeImmutable($venc);
        $primeiro = $base->modify('first day of this month')->modify('+' . $i . ' month');
        $v = $primeiro->setDate((int)$primeiro->format('Y'), (int)$primeiro->format('n'), min((int)$base->format('j'), (int)$primeiro->format('t')));
        q_global('INSERT INTO fin_avulsas (organizacao_id, tipo, descricao, categoria, contraparte, valor, vencimento, parcela, grupo, obs, criado_por, criado_em, atualizado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
            [(int)$org, $tipo, $campos['descricao'], $campos['categoria'], $campos['contraparte'], $valor, $v->format('Y-m-d'), $n > 1 ? ($i + 1) . '/' . $n : null, $grupo, $campos['obs'], (int)$u['id'], $agora, $agora]);
    }
    return $n;
}

function fav_baixar($id, array $post, array $u)
{
    $a = fav_obter($id, $u);
    if (!$a) { throw new InvalidArgumentException('Conta não encontrada.'); }
    $data = fav_data($post['baixa_data'] ?? planos_hoje(), 'Data');
    $valor = numero($post['valor_baixa'] ?? null);
    $valor = ($valor === null || $valor <= 0) ? (float)$a['valor'] : round((float)$valor, 2);
    $forma = in_array($post['forma'] ?? '', fav_formas(), true) ? $post['forma'] : null;
    q_global('UPDATE fin_avulsas SET baixa_data = ?, valor_baixa = ?, forma = ?, atualizado_em = ? WHERE id = ?', [$data, $valor, $forma, agora(), (int)$id]);
}

function fav_estornar($id, array $u)
{
    if (!fav_obter($id, $u)) { throw new InvalidArgumentException('Conta não encontrada.'); }
    q_global('UPDATE fin_avulsas SET baixa_data = NULL, valor_baixa = NULL, forma = NULL, atualizado_em = ? WHERE id = ?', [agora(), (int)$id]);
}

function fav_excluir($id, array $u, $grupo = false)
{
    $a = fav_obter($id, $u);
    if (!$a) { throw new InvalidArgumentException('Conta não encontrada.'); }
    if ($grupo && !empty($a['grupo'])) {
        list($w, $p) = fav_escopo($u);
        q_global("DELETE FROM fin_avulsas WHERE grupo = ? AND baixa_data IS NULL AND $w", array_merge([$a['grupo']], $p));
    } else { q_global('DELETE FROM fin_avulsas WHERE id = ?', [(int)$id]); }
}

/** Lista as contas de um tipo. Filtros: mes (AAAA-MM ou ''), situacao (aberta|vencida|baixada|''), q. */
function fav_listar(array $u, $tipo, array $f = [])
{
    garantir_fin_avulsas();
    list($w, $p) = fav_escopo($u);
    $where = [$w, 'tipo = ?']; $par = array_merge($p, [$tipo]);
    $mes = (string)($f['mes'] ?? '');
    if (preg_match('/^\d{4}-\d{2}$/', $mes)) { $where[] = 'vencimento >= ? AND vencimento <= ?'; $par[] = $mes . '-01'; $par[] = $mes . '-31'; }
    $q = trim((string)($f['q'] ?? ''));
    if ($q !== '') { $where[] = '(descricao LIKE ? OR contraparte LIKE ? OR categoria LIKE ?)'; array_push($par, "%$q%", "%$q%", "%$q%"); }
    $rows = q_global('SELECT * FROM fin_avulsas WHERE ' . implode(' AND ', $where) . ' ORDER BY vencimento, id', $par)->fetchAll();
    $hoje = planos_hoje();
    $sit = (string)($f['situacao'] ?? '');
    $out = [];
    foreach ($rows as $r) {
        list($k, $rot, $cls) = fav_situacao($r, $hoje);
        if ($sit !== '' && $sit !== $k) { continue; }
        $r['sit'] = $k; $r['sit_rot'] = $rot; $r['sit_cls'] = $cls;
        $out[] = $r;
    }
    return $out;
}

/** Resumo de um mês para o resultado geral: previsto (vencimento no mês), realizado (baixado no mês) e o que está em aberto/vencido até hoje. */
function fav_resumo(array $u, $ym)
{
    garantir_fin_avulsas();
    list($w, $p) = fav_escopo($u);
    $hoje = planos_hoje();
    $ini = $ym . '-01'; $fim = $ym . '-31';
    $r = ['R' => ['previsto' => 0.0, 'realizado' => 0.0, 'aberto' => 0.0, 'vencido' => 0.0, 'n_aberto' => 0, 'n_vencido' => 0], 'P' => ['previsto' => 0.0, 'realizado' => 0.0, 'aberto' => 0.0, 'vencido' => 0.0, 'n_aberto' => 0, 'n_vencido' => 0]];
    foreach (q_global("SELECT * FROM fin_avulsas WHERE $w", $p)->fetchAll() as $c) {
        $t = $c['tipo'];
        if ($c['vencimento'] >= $ini && $c['vencimento'] <= $fim) { $r[$t]['previsto'] += (float)$c['valor']; }
        if (!empty($c['baixa_data']) && $c['baixa_data'] >= $ini && $c['baixa_data'] <= $fim) { $r[$t]['realizado'] += (float)($c['valor_baixa'] ?? $c['valor']); }
        if (empty($c['baixa_data'])) {
            $r[$t]['aberto'] += (float)$c['valor']; $r[$t]['n_aberto']++;
            if ($c['vencimento'] < $hoje) { $r[$t]['vencido'] += (float)$c['valor']; $r[$t]['n_vencido']++; }
        }
    }
    foreach (['R', 'P'] as $t) { foreach (['previsto', 'realizado', 'aberto', 'vencido'] as $g) { $r[$t][$g] = round($r[$t][$g], 2); } }
    return $r;
}

/**
 * Descontos lançados DENTRO das obras para o mês: impostos (percentual do Contas a pagar de cada obra × o que ela mediu no mês) e outras contas fixas.
 * A base do imposto é o medido do mês ANTES dos descontos de equipamento/combustível/sinal do BM (o BM exato é calculado dentro de cada obra).
 * $resumos = resumos do Painel das obras (precisam de id e no_mes).
 */
function fin_descontos_obras(array $resumos, $ym)
{
    $out = ['impostos' => 0.0, 'outros' => 0.0, 'linhas' => []];
    foreach ($resumos as $r) {
        if (!empty($r['sem_medicao'])) { $medido = 0.0; } else { $medido = max(0.0, (float)($r['no_mes'] ?? 0)); }
        $oid = (int)$r['id'];
        try {
            obra_override($oid);
            $contas = q('SELECT tipo, descricao, percentual, valor, recorrencia, comp_inicio, comp_fim FROM contas_pagar WHERE ativo = 1')->fetchAll();
            obra_override(0);
        } catch (Throwable $e) { obra_override(0); continue; }
        foreach ($contas as $c) {
            if ($c['tipo'] === 'FOLHA') { continue; }   // a folha vem do Painel pessoal
            $ci = (string)$c['comp_inicio']; $cf = (string)($c['comp_fim'] ?? '');
            $noMes = $c['recorrencia'] === 'UNICA' ? $ci === $ym : ($ci <= $ym && ($cf === '' || $cf >= $ym));
            if (!$noMes) { continue; }
            if ($c['tipo'] === 'IMPOSTO') { $v = round($medido * (float)$c['percentual'] / 100, 2); $out['impostos'] += $v; $rot = 'Imposto'; }
            else { $v = round((float)$c['valor'], 2); $out['outros'] += $v; $rot = 'Outra conta'; }
            if ($v != 0.0) { $out['linhas'][] = ['obra' => $r['nome'], 'tipo' => $rot, 'descricao' => $c['descricao'], 'valor' => $v]; }
        }
    }
    $out['impostos'] = round($out['impostos'], 2); $out['outros'] = round($out['outros'], 2);
    return $out;
}

/** Resultado geral do mês: o que as obras medem − impostos − folha − outros descontos + contas a receber avulsas − contas a pagar avulsas. */
function fin_resultado_geral(array $u, $ym, array $resumos, $tot)
{
    $desc = fin_descontos_obras($resumos, $ym);
    $av = fav_resumo($u, $ym);
    $folha = null;
    if (rh_pode_ver_salarios($u)) {
        try { $folha = (float)pessoal_consolidar($u, $ym)['tot']['total']; } catch (Throwable $e) { $folha = null; }
    }
    $medido = round((float)$tot['no_mes'], 2);
    $res = round($medido - $desc['impostos'] - (float)$folha - $desc['outros'] + $av['R']['previsto'] - $av['P']['previsto'], 2);
    return ['mes' => $ym, 'medido' => $medido, 'impostos' => $desc['impostos'], 'folha' => $folha, 'outros' => $desc['outros'], 'receber' => $av['R'], 'pagar' => $av['P'], 'resultado' => $res, 'linhas' => $desc['linhas']];
}
