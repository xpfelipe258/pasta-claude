<?php
// Central da empresa: tela inicial de quem administra obras. Reúne Obras, Painel financeiro, Painel comercial (orçamentos e propostas)
// e Painel pessoal (RH consolidado das obras). Escopo: o administrador do sistema vê tudo; o administrador de uma empresa cliente
// e quem administra obras (admin_obra) veem só o que é da empresa / das obras deles.

require_once __DIR__ . '/dash_obras.php';
require_once __DIR__ . '/sinapi.php';
require_once __DIR__ . '/rh_pessoas.php';
require_once __DIR__ . '/fin_avulsas.php';

/** Quem entra na Central: administrador do sistema, administrador de empresa cliente e quem administra ao menos uma obra. */
function central_pode(array $u)
{
    return ($u['perfil'] ?? '') === 'admin' || usuario_admin_organizacao($u) || count(obras_que_administra($u)) > 0;
}

function central_exigir()
{
    $u = exigir_login_pagina();
    if (!central_pode($u)) {
        http_response_code(403);
        exit('Esta área é do administrador da empresa ou das obras.');
    }
    return $u;
}

function central_rs($v) { return 'R$ ' . number_format((float)$v, 2, ',', '.'); }
function central_dt($d) { return $d ? date('d/m/Y', strtotime($d)) : '—'; }

/** Abas da Central, na ordem em que aparecem. Configurações vale para quem administra a empresa ou obras; Painel administrativo (vendas e administração geral), só para o administrador geral; o Painel comercial (orçamentos) é o mesmo dos clientes. */
function central_lista_abas(array $eu)
{
    $abas = ['inicio' => ['Início', 'central.php'], 'obras' => ['Obras', 'obras.php?lista=1']];
    if (dashobras_obras_do_usuario($eu)) { $abas['financeiro'] = ['Painel financeiro', 'dashboard_obras.php']; }
    $abas['comercial'] = ['Painel comercial', 'comercial.php'];
    $abas['pessoal'] = ['Painel pessoal (RH)', 'pessoal.php'];
    $abas['config'] = ['Configurações', 'config_empresa.php'];
    if (($eu['perfil'] ?? '') !== 'admin' && usuario_admin_organizacao($eu)) { $abas['plano'] = ['Painel administrativo', 'plano.php']; }   // plano, pagamentos e limites da empresa assinante
    if (($eu['perfil'] ?? '') === 'admin') { $abas['sistema'] = ['Painel administrativo', 'sistema.php']; }
    return $abas;
}

/** Topo do portal + abas da Central. $ativo: inicio | obras | financeiro | comercial | pessoal. */
function central_topo($titulo, $ativo, array $eu, $sub = 'Central da empresa')
{
    $logo = global_ler('logo', '');
    $abas = central_lista_abas($eu);
    pagina_inicio($titulo);
    echo '<link rel="stylesheet" href="central.css?v=' . @filemtime(dirname(__DIR__) . '/central.css') . '">';
    echo '<div class="portal-shell"><header class="portal-topo"><div class="portal-brand">';
    echo $logo ? '<img src="' . h($logo) . '" alt="Logo">' : '<span class="brand-mark">NO</span>';
    echo '<div><strong>' . h(global_ler('nome_sistema', 'Núcleo de Obras')) . '</strong><small>' . h($sub) . '</small></div></div>';
    echo '<div class="portal-user"><span>Olá, ' . h($eu['nome']) . '</span><a class="btn ghost" href="sair.php">Sair</a></div></header>';
    echo '<nav class="ce-abas" aria-label="Painéis da empresa">';
    foreach ($abas as $k => $a) {
        echo '<a href="' . h($a[1]) . '"' . ($k === $ativo ? ' class="on" aria-current="page"' : '') . '>' . h($a[0]) . '</a>';
    }
    echo '</nav>';
}

/** Mesma barra para as telas que já têm o próprio topo (Central de obras e Painel financeiro): só as abas. */
function central_abas($ativo, array $eu)
{
    if (!central_pode($eu)) { return ''; }
    $abas = central_lista_abas($eu);
    $s = '<link rel="stylesheet" href="central.css?v=' . @filemtime(dirname(__DIR__) . '/central.css') . '"><nav class="ce-abas" aria-label="Painéis da empresa">';
    foreach ($abas as $k => $a) {
        $s .= '<a href="' . h($a[1]) . '"' . ($k === $ativo ? ' class="on" aria-current="page"' : '') . '>' . h($a[0]) . '</a>';
    }
    return $s . '</nav>';
}

// ===================================================================== COMERCIAL: orçamentos e propostas

function com_status_lista()
{
    return ['rascunho' => 'Em elaboração', 'enviada' => 'Enviada ao cliente', 'aprovada' => 'Aprovada', 'perdida' => 'Perdida'];
}

function garantir_comercial()
{
    static $ok = false;
    if ($ok) { return; }
    $sqlite = (config()['driver'] ?? 'mysql') === 'sqlite';
    $pk = $sqlite ? 'INTEGER PRIMARY KEY AUTOINCREMENT' : 'INT AUTO_INCREMENT PRIMARY KEY';
    $longo = $sqlite ? 'TEXT' : 'MEDIUMTEXT';
    $fim = $sqlite ? '' : ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4';
    bd()->exec("CREATE TABLE IF NOT EXISTS com_orcamentos (id $pk, organizacao_id INT NOT NULL DEFAULT 0, numero VARCHAR(20) NOT NULL, titulo VARCHAR(200) NOT NULL,
        cliente VARCHAR(200) NULL, contato VARCHAR(160) NULL, email VARCHAR(160) NULL, telefone VARCHAR(40) NULL, local_obra VARCHAR(200) NULL,
        status VARCHAR(12) NOT NULL DEFAULT 'rascunho', data_ref DATE NULL, validade_dias INT NOT NULL DEFAULT 30, prazo_dias INT NULL,
        bdi_pct DOUBLE NOT NULL DEFAULT 25, desconto_pct DOUBLE NOT NULL DEFAULT 0,
        escopo $longo NULL, exclusoes $longo NULL, pagamento $longo NULL, observacoes $longo NULL,
        obra_id INT NULL, criado_por INT NOT NULL DEFAULT 0, criado_em VARCHAR(19) NOT NULL, atualizado_em VARCHAR(19) NULL)$fim");
    bd()->exec("CREATE TABLE IF NOT EXISTS com_orcamento_itens (id $pk, orcamento_id INT NOT NULL, ordem INT NOT NULL DEFAULT 0, etapa VARCHAR(120) NULL,
        codigo VARCHAR(40) NULL, descricao VARCHAR(255) NOT NULL, unidade VARCHAR(12) NULL, quantidade DOUBLE NOT NULL DEFAULT 0,
        custo_unit DOUBLE NOT NULL DEFAULT 0, origem VARCHAR(12) NOT NULL DEFAULT 'manual')$fim");
    $ok = true;
}

/** Número digitado em pt-BR: 1.234,56 e 2.000 (= 2000) viram número; 12,5 = 12.5; 12.5 (ponto e 1 a 2 casas) = 12.5. */
function com_num($v)
{
    $t = trim(str_replace(['R$', ' ', "\xc2\xa0"], '', (string)$v));
    if ($t === '') { return 0.0; }
    if (strpos($t, ',') !== false) { $t = str_replace(['.', ','], ['', '.'], $t); }
    elseif (preg_match('/^\d{1,3}(\.\d{3})+$/', $t)) { $t = str_replace('.', '', $t); }
    return is_numeric($t) ? (float)$t : 0.0;
}

/** Organização do usuário (0 = administrador do sistema / sem empresa). */
function com_org(array $u) { return usuario_organizacao_id($u)[0]; }

function com_filtro_org(array $u, array &$params)
{
    if (($u['perfil'] ?? '') === 'admin') { return '1=1'; }
    $params[] = com_org($u);
    return 'organizacao_id = ?';
}

function com_obter($id, array $u)
{
    garantir_comercial();
    $p = [(int)$id];
    $o = q_global('SELECT * FROM com_orcamentos WHERE id = ? AND ' . com_filtro_org($u, $p), $p)->fetch();
    return $o ?: null;
}

function com_itens($id)
{
    return q_global('SELECT * FROM com_orcamento_itens WHERE orcamento_id = ? ORDER BY ordem, id', [(int)$id])->fetchAll();
}

/** Totais e preço de venda de cada item. Preço do item = custo × (1 + BDI) × (1 − desconto); o total é a soma dos itens (sem diferença de centavos). */
function com_calcular(array $orc, array $itens)
{
    $bdi = (float)$orc['bdi_pct'] / 100;
    $desc = (float)$orc['desconto_pct'] / 100;
    $direto = 0.0; $bruto = 0.0; $total = 0.0; $etapas = [];
    foreach ($itens as $k => $it) {
        $d = round((float)$it['quantidade'] * (float)$it['custo_unit'], 2);
        $b = round((float)$it['quantidade'] * (float)$it['custo_unit'] * (1 + $bdi), 2);
        $v = round((float)$it['quantidade'] * (float)$it['custo_unit'] * (1 + $bdi) * (1 - $desc), 2);
        $itens[$k]['direto'] = $d;
        $itens[$k]['venda'] = $v;
        $itens[$k]['preco_unit'] = (float)$it['quantidade'] > 0 ? round($v / (float)$it['quantidade'], 2) : 0.0;
        $direto += $d; $bruto += $b; $total += $v;
        $e = trim((string)$it['etapa']) !== '' ? trim($it['etapa']) : 'Itens';
        if (!isset($etapas[$e])) { $etapas[$e] = ['direto' => 0.0, 'venda' => 0.0]; }
        $etapas[$e]['direto'] += $d; $etapas[$e]['venda'] += $v;
    }
    $direto = round($direto, 2); $bruto = round($bruto, 2); $total = round($total, 2);
    return ['itens' => $itens, 'direto' => $direto, 'bdi_valor' => round($bruto - $direto, 2), 'desconto_valor' => round($bruto - $total, 2), 'total' => $total,
        'margem' => round($total - $direto, 2), 'margem_pct' => $total > 0 ? round(($total - $direto) / $total * 100, 1) : 0.0, 'etapas' => $etapas];
}

function com_proximo_numero()
{
    $ano = (new DateTimeImmutable('now', new DateTimeZone('America/Sao_Paulo')))->format('Y');
    $max = 0;
    foreach (q_global('SELECT numero FROM com_orcamentos WHERE numero LIKE ?', ['ORC-' . $ano . '-%'])->fetchAll() as $r) {
        if (preg_match('/-(\d+)$/', $r['numero'], $m)) { $max = max($max, (int)$m[1]); }
    }
    return 'ORC-' . $ano . '-' . str_pad((string)($max + 1), 4, '0', STR_PAD_LEFT);
}

/** Valida e grava o orçamento (novo ou existente) com os itens. Devolve o id. */
function com_salvar(array $post, array $u, $id = 0)
{
    garantir_comercial();
    $titulo = trim((string)($post['titulo'] ?? ''));
    $cliente = trim((string)($post['cliente'] ?? ''));
    if (mb_strlen($titulo) < 3) { throw new InvalidArgumentException('Informe o título do orçamento (ex.: Galpão industrial — estrutura metálica).'); }
    if ($cliente === '') { throw new InvalidArgumentException('Informe o cliente.'); }
    $bdi = com_num($post['bdi_pct'] ?? 25); $desc = com_num($post['desconto_pct'] ?? 0);
    if ($bdi < 0 || $bdi > 200) { throw new InvalidArgumentException('BDI deve estar entre 0% e 200%.'); }
    if ($desc < 0 || $desc > 100) { throw new InvalidArgumentException('Desconto deve estar entre 0% e 100%.'); }
    $data = data_valida($post['data_ref'] ?? '') ? $post['data_ref'] : (new DateTimeImmutable('now', new DateTimeZone('America/Sao_Paulo')))->format('Y-m-d');
    $campos = ['titulo' => mb_substr($titulo, 0, 200), 'cliente' => mb_substr($cliente, 0, 200), 'contato' => mb_substr(trim((string)($post['contato'] ?? '')), 0, 160),
        'email' => mb_substr(trim((string)($post['email'] ?? '')), 0, 160), 'telefone' => mb_substr(trim((string)($post['telefone'] ?? '')), 0, 40),
        'local_obra' => mb_substr(trim((string)($post['local_obra'] ?? '')), 0, 200), 'data_ref' => $data,
        'validade_dias' => max(1, min(365, (int)com_num($post['validade_dias'] ?? 30))), 'prazo_dias' => (int)com_num($post['prazo_dias'] ?? 0) ?: null,
        'bdi_pct' => $bdi, 'desconto_pct' => $desc, 'escopo' => trim((string)($post['escopo'] ?? '')), 'exclusoes' => trim((string)($post['exclusoes'] ?? '')),
        'pagamento' => trim((string)($post['pagamento'] ?? '')), 'observacoes' => trim((string)($post['observacoes'] ?? ''))];
    if ($campos['email'] !== '' && !filter_var($campos['email'], FILTER_VALIDATE_EMAIL)) { throw new InvalidArgumentException('E-mail do cliente inválido.'); }
    $itens = [];
    $n = count($post['descricao'] ?? []);
    for ($i = 0; $i < $n; $i++) {
        $desc_i = trim((string)$post['descricao'][$i]);
        $q = com_num($post['qtd'][$i] ?? 0); $c = com_num($post['custo'][$i] ?? 0);
        if ($desc_i === '' && $q == 0 && $c == 0) { continue; }
        if ($desc_i === '') { throw new InvalidArgumentException('Linha ' . ($i + 1) . ': informe a descrição do item.'); }
        if ($q < 0 || $c < 0) { throw new InvalidArgumentException('Linha ' . ($i + 1) . ': quantidade e custo não podem ser negativos.'); }
        $itens[] = ['etapa' => mb_substr(trim((string)($post['etapa'][$i] ?? '')), 0, 120), 'codigo' => mb_substr(trim((string)($post['codigo'][$i] ?? '')), 0, 40),
            'descricao' => mb_substr($desc_i, 0, 255), 'unidade' => mb_substr(trim((string)($post['unidade'][$i] ?? '')), 0, 12), 'quantidade' => $q, 'custo_unit' => $c,
            'origem' => in_array($post['origem'][$i] ?? '', ['manual', 'sinapi', 'propria'], true) ? $post['origem'][$i] : 'manual'];
    }
    if (count($itens) > 500) { throw new InvalidArgumentException('Máximo de 500 itens por orçamento.'); }
    $pdo = bd();
    $pdo->beginTransaction();
    try {
        $agora = agora();
        if ($id) {
            if (!com_obter($id, $u)) { throw new InvalidArgumentException('Orçamento não encontrado.'); }
            $set = []; $vals = [];
            foreach ($campos as $k => $v) { $set[] = "$k = ?"; $vals[] = $v; }
            $vals[] = $agora; $vals[] = (int)$id;
            q_global('UPDATE com_orcamentos SET ' . implode(', ', $set) . ', atualizado_em = ? WHERE id = ?', $vals);
            q_global('DELETE FROM com_orcamento_itens WHERE orcamento_id = ?', [(int)$id]);
        } else {
            $cols = array_keys($campos);
            q_global('INSERT INTO com_orcamentos (organizacao_id, numero, status, criado_por, criado_em, ' . implode(', ', $cols) . ') VALUES (?, ?, ?, ?, ?, ' . implode(', ', array_fill(0, count($cols), '?')) . ')',
                array_merge([com_org($u), com_proximo_numero(), 'rascunho', (int)$u['id'], $agora], array_values($campos)));
            $id = (int)$pdo->lastInsertId();
        }
        foreach ($itens as $o => $it) {
            q_global('INSERT INTO com_orcamento_itens (orcamento_id, ordem, etapa, codigo, descricao, unidade, quantidade, custo_unit, origem) VALUES (?,?,?,?,?,?,?,?,?)',
                [(int)$id, $o + 1, $it['etapa'], $it['codigo'], $it['descricao'], $it['unidade'], $it['quantidade'], $it['custo_unit'], $it['origem']]);
        }
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) { $pdo->rollBack(); }
        throw $e;
    }
    return (int)$id;
}

function com_duplicar($id, array $u)
{
    $o = com_obter($id, $u);
    if (!$o) { throw new InvalidArgumentException('Orçamento não encontrado.'); }
    $itens = com_itens($id);
    $pdo = bd(); $pdo->beginTransaction();
    try {
        q_global('INSERT INTO com_orcamentos (organizacao_id, numero, titulo, cliente, contato, email, telefone, local_obra, status, data_ref, validade_dias, prazo_dias, bdi_pct, desconto_pct, escopo, exclusoes, pagamento, observacoes, criado_por, criado_em)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            [$o['organizacao_id'], com_proximo_numero(), mb_substr($o['titulo'] . ' (cópia)', 0, 200), $o['cliente'], $o['contato'], $o['email'], $o['telefone'], $o['local_obra'], 'rascunho',
                (new DateTimeImmutable('now', new DateTimeZone('America/Sao_Paulo')))->format('Y-m-d'), $o['validade_dias'], $o['prazo_dias'], $o['bdi_pct'], $o['desconto_pct'],
                $o['escopo'], $o['exclusoes'], $o['pagamento'], $o['observacoes'], (int)$u['id'], agora()]);
        $novo = (int)$pdo->lastInsertId();
        foreach ($itens as $it) {
            q_global('INSERT INTO com_orcamento_itens (orcamento_id, ordem, etapa, codigo, descricao, unidade, quantidade, custo_unit, origem) VALUES (?,?,?,?,?,?,?,?,?)',
                [$novo, $it['ordem'], $it['etapa'], $it['codigo'], $it['descricao'], $it['unidade'], $it['quantidade'], $it['custo_unit'], $it['origem']]);
        }
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) { $pdo->rollBack(); }
        throw $e;
    }
    return $novo;
}

/** Resumo comercial da empresa para a lista e para a tela inicial. */
function com_resumo(array $u)
{
    garantir_comercial();
    $p = [];
    $lista = q_global('SELECT * FROM com_orcamentos WHERE ' . com_filtro_org($u, $p) . ' ORDER BY id DESC', $p)->fetchAll();
    $r = ['lista' => [], 'qtd' => count($lista), 'aberto' => 0.0, 'aprovado' => 0.0, 'perdido' => 0.0, 'n_aprov' => 0, 'n_perd' => 0, 'n_aberto' => 0];
    foreach ($lista as $o) {
        $c = com_calcular($o, com_itens($o['id']));
        $o['total'] = $c['total']; $o['direto'] = $c['direto']; $o['margem_pct'] = $c['margem_pct'];
        $r['lista'][] = $o;
        if ($o['status'] === 'aprovada') { $r['aprovado'] += $c['total']; $r['n_aprov']++; }
        elseif ($o['status'] === 'perdida') { $r['perdido'] += $c['total']; $r['n_perd']++; }
        else { $r['aberto'] += $c['total']; $r['n_aberto']++; }
    }
    $dec = $r['n_aprov'] + $r['n_perd'];
    $r['conversao'] = $dec > 0 ? round($r['n_aprov'] / $dec * 100, 1) : null;
    return $r;
}

// ===================================================================== PESSOAL (RH): consolidação das obras

/** Efetivo lançado no DP da obra no mês: média por dia com lançamento e pico (soma das quantidades de todas as empresas/funções no dia). */
function pessoal_efetivo_obra($obraId, $ym)
{
    $ini = $ym . '-01';
    $fim = date('Y-m-t', strtotime($ini));
    $dias = [];
    foreach (q_global('SELECT data, SUM(quantidade) AS q FROM dp_efetivo WHERE obra_id = ? AND data >= ? AND data <= ? GROUP BY data', [(int)$obraId, $ini, $fim])->fetchAll() as $r) {
        $dias[$r['data']] = (float)$r['q'];
    }
    return ['dias' => count($dias), 'media' => $dias ? round(array_sum($dias) / count($dias), 1) : 0.0, 'pico' => $dias ? (int)max($dias) : 0];
}

/** Folha, colaboradores e efetivo de cada obra da empresa no mês. Os salários só entram para quem tem a área Financeiro. */
function pessoal_consolidar(array $u, $ym)
{
    require_once __DIR__ . '/rh_custos.php';
    $ver = rh_pode_ver_salarios($u);
    $res = ['mes' => $ym, 'ver_salarios' => $ver, 'obras' => [], 'colaboradores' => [], 'empresas' => [],
        'tot' => ['n' => 0, 'remuneracao' => 0.0, 'encargos' => 0.0, 'provisoes' => 0.0, 'beneficios' => 0.0, 'total' => 0.0, 'sem_salario' => 0, 'efetivo_media' => 0.0, 'efetivo_pico' => 0]];
    $vistas = [];
    foreach (dashobras_obras_do_usuario($u) as $o) {
        $oid = (int)$o['id'];
        $principal = (int)($o['origem_obra_id'] ?? 0) > 0 ? (int)$o['origem_obra_id'] : $oid;
        $linha = ['id' => $oid, 'nome' => $o['nome'], 'n' => 0, 'remuneracao' => 0.0, 'encargos' => 0.0, 'provisoes' => 0.0, 'beneficios' => 0.0, 'total' => 0.0, 'sem_salario' => 0,
            'efetivo' => ['dias' => 0, 'media' => 0.0, 'pico' => 0], 'erro' => false];
        try {
            $linha['efetivo'] = pessoal_efetivo_obra($oid, $ym);
            if (isset($vistas[$principal])) { $linha['repetida'] = true; $res['obras'][] = $linha; continue; }   // dois cartões sobre o mesmo cadastro de colaboradores
            $vistas[$principal] = true;
            obra_override($oid);
            $f = rh_folha_mes($ym, rh_params(true));
            obra_override(0);
            $linha['n'] = $f['n']; $linha['sem_salario'] = $f['sem_salario'];
            foreach (['remuneracao', 'encargos', 'provisoes', 'beneficios', 'total'] as $g) { $linha[$g] = $f[$g]; }
            foreach ($f['colaboradores'] as $c) {
                $c['obra_id'] = $oid; $c['obra'] = $o['nome'];
                $res['colaboradores'][] = $c;
            }
            foreach ($f['por_empresa'] as $e => $d) {
                if (!isset($res['empresas'][$e])) { $res['empresas'][$e] = ['n' => 0, 'total' => 0.0, 'obras' => []]; }
                $res['empresas'][$e]['n'] += $d['n']; $res['empresas'][$e]['total'] += $d['total']; $res['empresas'][$e]['obras'][$o['nome']] = true;
            }
        } catch (Throwable $e) {
            obra_override(0);
            $linha['erro'] = true;
        }
        $res['obras'][] = $linha;
        foreach (['n', 'sem_salario'] as $g) { $res['tot'][$g] += $linha[$g]; }
        foreach (['remuneracao', 'encargos', 'provisoes', 'beneficios', 'total'] as $g) { $res['tot'][$g] += $linha[$g]; }
        $res['tot']['efetivo_media'] += $linha['efetivo']['media']; $res['tot']['efetivo_pico'] += $linha['efetivo']['pico'];
    }
    // colaboradores do cadastro da EMPRESA (Painel pessoal › Colaboradores): entram na linha da obra onde estão alocados ou em "Sem obra"
    $porObra = [];
    foreach ($res['obras'] as $i => $o) { $porObra[(int)$o['id']] = $i; }
    $semObra = ['id' => 0, 'nome' => 'Sem obra (quadro da empresa)', 'n' => 0, 'remuneracao' => 0.0, 'encargos' => 0.0, 'provisoes' => 0.0, 'beneficios' => 0.0, 'total' => 0.0, 'sem_salario' => 0,
        'efetivo' => ['dias' => 0, 'media' => 0.0, 'pico' => 0], 'erro' => false, 'sem_obra' => true];
    foreach (rhp_listar($u) as $pessoa) {
        $k = rhp_custo($pessoa, $ym);
        if (!$k['ativo']) { continue; }
        $oid = (int)($pessoa['obra_id'] ?? 0);
        $alvo = null;
        if ($oid > 0 && isset($porObra[$oid])) { $alvo = &$res['obras'][$porObra[$oid]]; } else { $alvo = &$semObra; }
        $alvo['n']++;
        if ($k['sem_salario']) { $alvo['sem_salario']++; $res['tot']['sem_salario']++; }
        $res['tot']['n']++;
        foreach (['remuneracao', 'encargos', 'provisoes', 'beneficios', 'total'] as $g) { $alvo[$g] += $k[$g]; $res['tot'][$g] += $k[$g]; }
        unset($alvo);
        $emp = trim((string)$pessoa['empresa']) !== '' ? mb_strtoupper(trim($pessoa['empresa']), 'UTF-8') : 'SEM EMPRESA';
        if (!isset($res['empresas'][$emp])) { $res['empresas'][$emp] = ['n' => 0, 'total' => 0.0, 'obras' => []]; }
        $res['empresas'][$emp]['n']++; $res['empresas'][$emp]['total'] += $k['total'];
        $res['empresas'][$emp]['obras'][$oid > 0 ? ($pessoa['obra_nome'] ?: 'Obra') : 'Sem obra'] = true;
        $res['colaboradores'][] = ['id' => (int)$pessoa['id'], 'pessoa_id' => (int)$pessoa['id'], 'origem' => 'p', 'nome' => $pessoa['nome'], 'empresa' => $pessoa['empresa'], 'funcao' => $pessoa['funcao'], 'status' => $pessoa['status'],
            'vinculo' => rh_rotulo_vinculo($k['vinculo']), 'sem_salario' => $k['sem_salario'], 'fracao' => round($k['fracao'], 4), 'obra_id' => $oid, 'obra' => $oid > 0 ? ($pessoa['obra_nome'] ?: 'Obra') : 'Sem obra',
            'bruto' => $k['bruto'], 'encargos' => $k['encargos'], 'provisoes' => $k['provisoes'], 'beneficios' => $k['beneficios'], 'total' => $k['total'], 'fator' => $k['fator']];
    }
    if ($semObra['n'] > 0) { $res['obras'][] = $semObra; }
    foreach (['remuneracao', 'encargos', 'provisoes', 'beneficios', 'total'] as $g) { $res['tot'][$g] = round($res['tot'][$g], 2); }
    uasort($res['empresas'], function ($a, $b) { return $b['total'] <=> $a['total']; });
    if (!$ver) {   // sem a área Financeiro, nenhum valor de remuneração sai do servidor
        foreach ($res['obras'] as &$ob) { foreach (['remuneracao', 'encargos', 'provisoes', 'beneficios', 'total'] as $g) { $ob[$g] = null; } }
        unset($ob);
        foreach ($res['colaboradores'] as &$c) { foreach (['bruto', 'encargos', 'provisoes', 'beneficios', 'total', 'fator'] as $g) { $c[$g] = null; } }
        unset($c);
        foreach ($res['empresas'] as &$e) { $e['total'] = null; }
        unset($e);
        foreach (['remuneracao', 'encargos', 'provisoes', 'beneficios', 'total'] as $g) { $res['tot'][$g] = null; }
    }
    return $res;
}

// ===================================================================== CONFIGURAÇÕES DA EMPRESA (aba Configurações da Central)
// Cada empresa cliente edita: dados cadastrais e textos padrão (usados nas propostas e relatórios), tema do sistema (preferência do próprio usuário),
// logo e cor dos relatórios oficiais e, pelo menu da aba, os usuários da empresa. Tudo fica em config_global (sem mudar o esquema do banco).

/** Campos extras do perfil da empresa (os básicos nome, CNPJ, contato, e-mail e telefone ficam na tabela organizacoes). */
function cfg_perfil_campos()
{
    return ['razao' => 'Razão social', 'endereco' => 'Endereço', 'cidade' => 'Cidade / UF', 'site' => 'Site', 'resp_tecnico' => 'Responsável técnico', 'crea' => 'CREA / registro',
        'rodape' => 'Rodapé dos relatórios e propostas', 'pagamento_padrao' => 'Condições de pagamento padrão', 'exclusoes_padrao' => 'Itens não incluídos (padrão)', 'obs_padrao' => 'Observações padrão da proposta'];
}

function cfg_perfil_ler($orgId)
{
    $t = cfg_json_ler('org_perfil');
    $p = is_array($t[(string)(int)$orgId] ?? null) ? $t[(string)(int)$orgId] : [];
    $o = ['validade_dias' => 30, 'bdi_pct' => 25];
    foreach (cfg_perfil_campos() as $k => $_) { $o[$k] = (string)($p[$k] ?? ''); }
    $o['validade_dias'] = max(1, min(365, (int)($p['validade_dias'] ?? 30)));
    $o['bdi_pct'] = isset($p['bdi_pct']) ? (float)$p['bdi_pct'] : 25.0;
    return $o;
}

function cfg_perfil_salvar($orgId, array $post, array $u)
{
    $nome = trim((string)($post['nome'] ?? ''));
    if (mb_strlen($nome) < 2 || mb_strlen($nome) > 120) { throw new InvalidArgumentException('Informe o nome da empresa (2 a 120 caracteres).'); }
    $email = trim((string)($post['email'] ?? ''));
    if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) { throw new InvalidArgumentException('E-mail da empresa inválido.'); }
    $site = trim((string)($post['site'] ?? ''));
    if ($site !== '' && !preg_match('#^(https?://)?[\w.-]+\.[a-z]{2,}(/\S*)?$#i', $site)) { throw new InvalidArgumentException('Site inválido (ex.: www.suaempresa.com.br).'); }
    $bdi = com_num($post['bdi_pct'] ?? 25);
    if ($bdi < 0 || $bdi > 200) { throw new InvalidArgumentException('BDI padrão deve estar entre 0% e 200%.'); }
    q_global('UPDATE organizacoes SET nome = ?, documento = ?, contato = ?, email = ?, telefone = ?, atualizado_em = ? WHERE id = ?', [
        $nome, mb_substr(trim((string)($post['documento'] ?? '')), 0, 30) ?: null, mb_substr(trim((string)($post['contato'] ?? '')), 0, 120) ?: null,
        $email ?: null, mb_substr(trim((string)($post['telefone'] ?? '')), 0, 30) ?: null, agora(), (int)$orgId]);
    $t = cfg_json_ler('org_perfil');
    $p = [];
    foreach (cfg_perfil_campos() as $k => $_) {
        $max = in_array($k, ['rodape', 'pagamento_padrao', 'exclusoes_padrao', 'obs_padrao'], true) ? 2000 : 200;
        $p[$k] = mb_substr(trim((string)($post[$k] ?? '')), 0, $max);
    }
    $p['validade_dias'] = max(1, min(365, (int)com_num($post['validade_dias'] ?? 30)));
    $p['bdi_pct'] = $bdi;
    $t[(string)(int)$orgId] = $p;
    global_gravar('org_perfil', json_encode($t, JSON_UNESCAPED_UNICODE));
    registrar_global('empresa_perfil_salvo', ['empresa' => $nome, 'por' => $u['login'] ?? '']);
}

/** Confere a imagem enviada e a devolve como data URI. Reduz com GD (até 480×160) quando disponível; sem GD exige até 400 KB. */
function cfg_logo_do_upload($campo)
{
    if (empty($_FILES[$campo]['tmp_name']) || ($_FILES[$campo]['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE) { return ''; }
    if (($_FILES[$campo]['error'] ?? UPLOAD_ERR_OK) !== UPLOAD_ERR_OK || $_FILES[$campo]['size'] > 3 * 1024 * 1024) { throw new InvalidArgumentException('O logo deve ter no máximo 3 MB.'); }
    $bin = file_get_contents($_FILES[$campo]['tmp_name']);
    $info = @getimagesizefromstring($bin);
    if (!$info || !in_array($info[2], [IMAGETYPE_PNG, IMAGETYPE_JPEG, IMAGETYPE_WEBP], true) || $info[0] < 20 || $info[1] < 10 || $info[0] > 6000 || $info[1] > 6000) {
        throw new InvalidArgumentException('Envie o logo em PNG, JPG ou WEBP.');
    }
    $mimes = [IMAGETYPE_PNG => 'image/png', IMAGETYPE_JPEG => 'image/jpeg', IMAGETYPE_WEBP => 'image/webp'];
    if (function_exists('imagecreatefromstring') && function_exists('imagepng')) {
        $img = @imagecreatefromstring($bin);
        if ($img) {
            $w = imagesx($img); $h = imagesy($img);
            $f = min(1, 480 / $w, 160 / $h);
            $nw = max(1, (int)round($w * $f)); $nh = max(1, (int)round($h * $f));
            $dst = imagecreatetruecolor($nw, $nh);
            imagealphablending($dst, false); imagesavealpha($dst, true);
            imagefill($dst, 0, 0, imagecolorallocatealpha($dst, 255, 255, 255, 127));
            imagecopyresampled($dst, $img, 0, 0, 0, 0, $nw, $nh, $w, $h);
            ob_start(); imagepng($dst, null, 7); $png = ob_get_clean();
            if ($png !== '' && strlen($png) <= 400 * 1024) { return 'data:image/png;base64,' . base64_encode($png); }
        }
    }
    if (strlen($bin) > 400 * 1024) { throw new InvalidArgumentException('O logo passa de 400 KB. Use uma imagem menor (até 480 × 160 px).'); }
    return 'data:' . $mimes[$info[2]] . ';base64,' . base64_encode($bin);
}

function cfg_identidade_salvar($orgId, array $post, array $u, $removerLogo)
{
    $cor = trim((string)($post['cor'] ?? ''));
    if (!empty($post['cor_padrao'])) { $cor = ''; }
    if ($cor !== '' && !preg_match('/^#[0-9a-fA-F]{6}$/', $cor)) { throw new InvalidArgumentException('Cor inválida (use o formato #rrggbb).'); }
    $atual = cfg_identidade_ler($orgId);
    $logo = $removerLogo ? '' : $atual['logo'];
    $novo = cfg_logo_do_upload('logo');
    if ($novo !== '') { $logo = $novo; }
    $t = cfg_json_ler('identidade_organizacoes');
    if ($logo === '' && $cor === '') { unset($t[(string)(int)$orgId]); }
    else { $t[(string)(int)$orgId] = ['logo' => $logo, 'cor' => $cor, 'por' => $u['nome'] ?? '', 'em' => agora()]; }
    global_gravar('identidade_organizacoes', json_encode($t, JSON_UNESCAPED_UNICODE));
    registrar_global('empresa_identidade_salva', ['org' => (int)$orgId, 'por' => $u['login'] ?? '', 'logo' => $logo !== '', 'cor' => $cor]);
}

/** Barra de seções da aba Configurações. $ativo: empresa | aparencia | logos | usuarios. */
function cfg_sub($ativo, array $eu, $org = 0)
{
    $q = ($eu['perfil'] ?? '') === 'admin' && $org ? '?org=' . (int)$org : '';
    $e = $q === '' ? '?' : $q . '&';
    $itens = ['aparencia' => ['Tema do sistema', 'config_empresa.php' . $e . 'v=aparencia']];
    if ($org) {   // sem empresa cliente só existe o tema pessoal
        $itens = ['empresa' => ['Dados da empresa', 'config_empresa.php' . $q], 'aparencia' => $itens['aparencia'], 'logos' => ['Logos e relatórios oficiais', 'config_empresa.php' . $e . 'v=logos'],
            'usuarios' => ['Usuários da empresa', 'empresa_usuarios.php' . $q]];
    }
    $s = '<nav class="ce-sub" aria-label="Seções das configurações">';
    foreach ($itens as $k => $a) { $s .= '<a href="' . h($a[1]) . '"' . ($k === $ativo ? ' class="on" aria-current="page"' : '') . '>' . h($a[0]) . '</a>'; }
    return $s . '</nav>';
}
