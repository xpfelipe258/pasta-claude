<?php
// Painel comercial: orçamentos (custo direto + BDI + desconto) e proposta comercial para o cliente.
require __DIR__ . '/inc/nucleo.php';
require __DIR__ . '/inc/modelo.php';
require __DIR__ . '/inc/central.php';
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

$eu = central_exigir();
garantir_comercial();
$msg = ''; $erro = '';
$id = (int)($_GET['id'] ?? 0);
$novo = isset($_GET['novo']);

if (isset($_GET['sinapi'])) {   // pesquisa na tabela SINAPI importada e no catálogo próprio de estrutura metálica
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(sinapi_buscar(['q' => $_GET['q'] ?? '', 'grupo' => $_GET['grupo'] ?? '', 'tipo' => $_GET['tipo'] ?? '', 'uf' => $_GET['uf'] ?? '', 'regime' => $_GET['regime'] ?? 'SD', 'ref' => $_GET['ref'] ?? '']), JSON_UNESCAPED_UNICODE);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    conferir_csrf();
    $acao = $_POST['acao'] ?? '';
    try {
        $oid = (int)($_POST['orc_id'] ?? 0);
        if ($acao === 'salvar') {
            $id = com_salvar($_POST, $eu, $oid);
            header('Location: comercial.php?id=' . $id . '&ok=salvo'); exit;
        } elseif ($acao === 'status') {
            $o = com_obter($oid, $eu);
            $st = $_POST['status'] ?? '';
            if (!$o || !isset(com_status_lista()[$st])) { throw new InvalidArgumentException('Orçamento ou situação inválida.'); }
            if (!com_itens($oid)) { throw new InvalidArgumentException('Inclua ao menos um item antes de enviar ou aprovar o orçamento.'); }
            q_global('UPDATE com_orcamentos SET status = ?, atualizado_em = ? WHERE id = ?', [$st, agora(), $oid]);
            header('Location: comercial.php?id=' . $oid . '&ok=status'); exit;
        } elseif ($acao === 'duplicar') {
            $novoId = com_duplicar($oid, $eu);
            header('Location: comercial.php?id=' . $novoId . '&ok=duplicado'); exit;
        } elseif ($acao === 'excluir') {
            $o = com_obter($oid, $eu);
            if (!$o) { throw new InvalidArgumentException('Orçamento não encontrado.'); }
            if (!empty($o['obra_id'])) { throw new InvalidArgumentException('Este orçamento já virou obra e não pode ser excluído.'); }
            q_global('DELETE FROM com_orcamento_itens WHERE orcamento_id = ?', [$oid]);
            q_global('DELETE FROM com_orcamentos WHERE id = ?', [$oid]);
            header('Location: comercial.php?ok=excluido'); exit;
        } elseif ($acao === 'criar_obra') {   // proposta aprovada → obra (nome, cliente, local e valor de contrato vêm do orçamento)
            $o = com_obter($oid, $eu);
            if (!$o) { throw new InvalidArgumentException('Orçamento não encontrado.'); }
            if ($o['status'] !== 'aprovada') { throw new InvalidArgumentException('Só um orçamento aprovado vira obra.'); }
            if (!empty($o['obra_id'])) { throw new InvalidArgumentException('Este orçamento já virou obra.'); }
            if (!usuario_pode_criar_obra($eu)) { throw new InvalidArgumentException('Seu perfil não pode criar obras.'); }
            list($planoOk, $planoMsg, $planoInfo) = plano_verificar_criacao($eu);
            if (!$planoOk) { throw new InvalidArgumentException($planoMsg); }
            $c = com_calcular($o, com_itens($oid));
            $ini = date('Y-m-d');
            $fim = date('Y-m-d', strtotime('+' . max(30, (int)($o['prazo_dias'] ?: 365)) . ' days'));
            q_global("INSERT INTO obras (nome, responsavel, cliente, cidade, valor_contrato, observacoes, data_inicio, data_fim, status, cor_primaria, cor_secundaria, criado_em) VALUES (?,?,?,?,?,?,?,?,'ativa',?,?,?)",
                [mb_substr($o['titulo'], 0, 120), $eu['nome'], $o['cliente'], $o['local_obra'], $c['total'], 'Criada a partir da proposta ' . $o['numero'], $ini, $fim,
                    cor_segura(global_ler('cor_primaria', '#d97706'), '#d97706'), cor_segura(global_ler('cor_secundaria', '#111827'), '#111827'), agora()]);
            $obraId = (int)bd()->lastInsertId();
            foreach (['obra_nome' => $o['titulo'], 'data_inicio' => $ini, 'data_fim' => $fim, 'versao' => '0', 'modificado' => date('c'), 'dados_legados' => '0'] as $k => $v) {
                q_global('INSERT INTO obra_config (obra_id, chave, valor) VALUES (?, ?, ?)', [$obraId, $k, $v]);
            }
            q_global('INSERT INTO usuarios_obras (usuario_id, obra_id, admin_obra) VALUES (?, ?, 1)', [(int)$eu['id'], $obraId]);
            if (!empty($planoInfo['org_id'])) { organizacao_vincular_obra((int)$planoInfo['org_id'], $obraId); }
            q_global('UPDATE com_orcamentos SET obra_id = ?, atualizado_em = ? WHERE id = ?', [$obraId, agora(), $oid]);
            registrar_global('obra_criada', ['obra_id' => $obraId, 'nome' => $o['titulo'], 'orcamento' => $o['numero']]);
            header('Location: comercial.php?id=' . $oid . '&ok=obra'); exit;
        }
    } catch (Throwable $e) {
        $erro = $e instanceof InvalidArgumentException ? $e->getMessage() : 'Não foi possível concluir a operação.';
        if ($acao === 'salvar') { $id = (int)($_POST['orc_id'] ?? 0); $novo = $id === 0; }
    }
}
$okMsg = ['salvo' => 'Orçamento salvo.', 'status' => 'Situação atualizada.', 'duplicado' => 'Cópia criada. Ajuste os dados e salve.', 'excluido' => 'Orçamento excluído.',
    'obra' => 'Obra criada a partir da proposta. Ela está na aba Obras, sem produção, estoque ou medições.'][$_GET['ok'] ?? ''] ?? '';
if ($okMsg) { $msg = $okMsg; }
$csrf = token_csrf();
$orgPad = com_org($eu);
$padEmp = cfg_perfil_ler($orgPad);   // padrões da empresa (Central › Configurações): validade, BDI e textos da proposta
central_topo('Painel comercial', 'comercial', $eu, 'Painel comercial');

// ---------------------------------------------------------------- editor
if ($id > 0 || $novo) {
    $o = $id > 0 ? com_obter($id, $eu) : null;
    if ($id > 0 && !$o) { echo '<main class="ce-main"><div class="ce-vazio">Orçamento não encontrado. <a href="comercial.php">Voltar</a></div></main></div></body></html>'; exit; }
    if (!$o) {
        $o = ['id' => 0, 'numero' => '(novo)', 'titulo' => '', 'cliente' => '', 'contato' => '', 'email' => '', 'telefone' => '', 'local_obra' => '', 'status' => 'rascunho',
            'data_ref' => date('Y-m-d'), 'validade_dias' => $padEmp['validade_dias'], 'prazo_dias' => '', 'bdi_pct' => $padEmp['bdi_pct'], 'desconto_pct' => 0, 'escopo' => '', 'exclusoes' => $padEmp['exclusoes_padrao'], 'pagamento' => $padEmp['pagamento_padrao'], 'observacoes' => $padEmp['obs_padrao'], 'obra_id' => null];
        $itens = [['etapa' => '', 'codigo' => '', 'descricao' => '', 'unidade' => '', 'quantidade' => '', 'custo_unit' => '', 'origem' => 'manual']];
    } else {
        $itens = com_itens($id) ?: [['etapa' => '', 'codigo' => '', 'descricao' => '', 'unidade' => '', 'quantidade' => '', 'custo_unit' => '', 'origem' => 'manual']];
    }
    if ($erro && $_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['acao'] ?? '') === 'salvar') {   // devolve o que foi digitado
        foreach (['titulo', 'cliente', 'contato', 'email', 'telefone', 'local_obra', 'data_ref', 'validade_dias', 'prazo_dias', 'bdi_pct', 'desconto_pct', 'escopo', 'exclusoes', 'pagamento', 'observacoes'] as $k) { if (isset($_POST[$k])) { $o[$k] = $_POST[$k]; } }
        $itens = [];
        foreach (($_POST['descricao'] ?? []) as $i => $d) { $itens[] = ['etapa' => $_POST['etapa'][$i] ?? '', 'codigo' => $_POST['codigo'][$i] ?? '', 'descricao' => $d, 'unidade' => $_POST['unidade'][$i] ?? '', 'quantidade' => $_POST['qtd'][$i] ?? '', 'custo_unit' => $_POST['custo'][$i] ?? '', 'origem' => $_POST['origem'][$i] ?? 'manual']; }
    }
    $calc = com_calcular(array_merge($o, ['bdi_pct' => com_num($o['bdi_pct']), 'desconto_pct' => com_num($o['desconto_pct'])]),
        array_map(function ($i) { $i['quantidade'] = is_numeric($i['quantidade']) ? $i['quantidade'] : com_num($i['quantidade']); $i['custo_unit'] = is_numeric($i['custo_unit']) ? $i['custo_unit'] : com_num($i['custo_unit']); return $i; }, $itens));
    $st = com_status_lista();
    $travado = !empty($o['obra_id']);
    $fmt = function ($v) { return $v === '' || $v === null ? '' : number_format((float)$v, 2, ',', '.'); };
    $fq = function ($v) { return $v === '' || $v === null ? '' : rtrim(rtrim(number_format((float)$v, 4, ',', '.'), '0'), ','); };
    ?>
<main class="ce-main">
  <section class="ce-hero"><div><span class="ce-eyebrow">ORÇAMENTO <?= h($o['numero']) ?></span><h1><?= $o['id'] ? h($o['titulo']) : 'Novo orçamento' ?></h1>
    <p><?php if ($o['id']): ?><span class="ce-tag <?= ['rascunho' => '', 'enviada' => 'azul', 'aprovada' => 'verde', 'perdida' => 'verm'][$o['status']] ?>"><?= h($st[$o['status']]) ?></span><?php if ($travado): ?> · <span class="ce-tag verde">Virou obra</span><?php endif; ?><?php else: ?>Preencha o cliente e os itens; o preço de venda é calculado com o BDI e o desconto.<?php endif; ?></p></div>
    <a class="btn ghost" href="comercial.php">← Todos os orçamentos</a></section>
  <?php if ($msg): ?><div class="toast ok-faixa"><?= h($msg) ?></div><?php endif; ?>
  <?php if ($erro): ?><div class="toast erro-form"><?= h($erro) ?></div><?php endif; ?>
  <form method="post" id="fOrc" autocomplete="off">
    <input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="acao" value="salvar"><input type="hidden" name="orc_id" value="<?= (int)$o['id'] ?>">
    <section class="ce-bloco"><h2>Cliente e condições</h2><p>Estes dados aparecem na proposta comercial.</p>
      <div class="ce-form">
        <label class="full">Título do orçamento *<input name="titulo" required maxlength="200" value="<?= h($o['titulo']) ?>" placeholder="Ex.: Galpão industrial — estrutura metálica e cobertura"></label>
        <label>Cliente *<input name="cliente" required maxlength="200" value="<?= h($o['cliente']) ?>"></label>
        <label>Contato<input name="contato" maxlength="160" value="<?= h($o['contato']) ?>"></label>
        <label>E-mail<input type="email" name="email" maxlength="160" value="<?= h($o['email']) ?>"></label>
        <label>Telefone<input name="telefone" maxlength="40" value="<?= h($o['telefone']) ?>"></label>
        <label>Local da obra<input name="local_obra" maxlength="200" value="<?= h($o['local_obra']) ?>"></label>
        <label>Data da proposta<input type="date" name="data_ref" value="<?= h($o['data_ref']) ?>"></label>
        <label>Validade (dias)<input name="validade_dias" inputmode="numeric" value="<?= h($o['validade_dias']) ?>"></label>
        <label>Prazo de execução (dias)<input name="prazo_dias" inputmode="numeric" value="<?= h($o['prazo_dias']) ?>"></label>
        <label>BDI (%)<input name="bdi_pct" id="bdi" inputmode="decimal" value="<?= h(str_replace('.', ',', (string)$o['bdi_pct'])) ?>"></label>
        <label>Desconto comercial (%)<input name="desconto_pct" id="desc" inputmode="decimal" value="<?= h(str_replace('.', ',', (string)$o['desconto_pct'])) ?>"></label>
      </div></section>
    <section class="ce-bloco"><h2>Itens do orçamento</h2><p>Informe o <b>custo unitário</b> (sem BDI). O preço de venda de cada item é calculado com o BDI e o desconto. Para pegar itens e custos da <b>tabela SINAPI</b> (ou do catálogo de estrutura metálica), use o botão <b>Buscar</b>: o item entra na lista com o código e o custo da tabela, e você só informa a quantidade.</p>
      <table class="ce-itens" id="tItens"><thead><tr><th style="width:15%">Etapa</th><th style="width:9%">Código</th><th>Descrição *</th><th style="width:6%">Un</th><th style="width:9%">Quantidade</th><th style="width:11%">Custo unit. (R$)</th><th style="width:11%" class="d">Custo (R$)</th><th style="width:11%" class="d">Venda (R$)</th><th style="width:3%"></th></tr></thead><tbody>
      <?php foreach ($calc['itens'] as $it): ?>
        <tr><td><input name="etapa[]" value="<?= h($it['etapa']) ?>" list="dlEtapas"></td><td><input name="codigo[]" value="<?= h($it['codigo']) ?>"></td><td><input name="descricao[]" value="<?= h($it['descricao']) ?>"></td>
          <td><input name="unidade[]" value="<?= h($it['unidade']) ?>" maxlength="12"></td><td class="n"><input name="qtd[]" inputmode="decimal" value="<?= h($fq($it['quantidade'])) ?>"></td><td class="n"><input name="custo[]" inputmode="decimal" value="<?= h($fmt($it['custo_unit'])) ?>"></td>
          <td class="tot c-dir"><?= h($fmt($it['direto'] ?? 0)) ?></td><td class="tot c-ven"><?= h($fmt($it['venda'] ?? 0)) ?></td>
          <td><input type="hidden" name="origem[]" value="<?= h($it['origem'] ?? 'manual') ?>"><button type="button" class="btn ghost ce-btn-peq" data-rem title="Remover linha">✕</button></td></tr>
      <?php endforeach; ?></tbody></table>
      <datalist id="dlEtapas"><?php foreach (array_keys($calc['etapas']) as $e): ?><option value="<?= h($e) ?>"><?php endforeach; ?></datalist>
      <div class="ce-acoes"><button type="button" class="btn" id="bMais">+ Adicionar item</button><button type="button" class="btn primario" id="bSinapi">🔎 Buscar na tabela SINAPI e no catálogo de estrutura metálica</button></div>
      <div class="ce-tot"><div><small>Custo direto</small><b id="tDir"><?= h(central_rs($calc['direto'])) ?></b></div><div><small>BDI</small><b id="tBdi"><?= h(central_rs($calc['bdi_valor'])) ?></b></div>
        <div><small>Desconto</small><b id="tDesc">− <?= h(central_rs($calc['desconto_valor'])) ?></b></div><div class="gr"><small>Preço de venda</small><b id="tVenda"><?= h(central_rs($calc['total'])) ?></b></div>
        <div><small>Margem bruta</small><b id="tMarg"><?= h(central_rs($calc['margem'])) ?> · <?= h(number_format($calc['margem_pct'], 1, ',', '.')) ?>%</b></div></div></section>
    <section class="ce-bloco"><h2>Textos da proposta</h2><p>Escopo, exclusões, condições de pagamento e observações aparecem na proposta impressa.</p>
      <div class="ce-form"><label class="full">Escopo do fornecimento<textarea name="escopo"><?= h($o['escopo']) ?></textarea></label>
        <label class="full">Itens não incluídos (exclusões)<textarea name="exclusoes"><?= h($o['exclusoes']) ?></textarea></label>
        <label class="full">Condições de pagamento<textarea name="pagamento"><?= h($o['pagamento']) ?></textarea></label>
        <label class="full">Observações<textarea name="observacoes"><?= h($o['observacoes']) ?></textarea></label></div></section>
    <div class="ce-acoes"><button class="btn primario">Salvar orçamento</button><span class="ce-nota" id="avisoSujo" hidden>Há alterações não salvas — salve antes de gerar os PDFs.</span></div>
  </form>
  <?php if ($o['id']): ?>
  <section class="ce-bloco" style="margin-top:24px" id="docs"><h2>Documentos para gerar</h2>
    <p>Depois de criar e ajustar o orçamento, gere os documentos. Eles usam o que está <b>salvo</b>, com o logo e os dados da sua empresa (Configurações).</p>
    <div class="ce-acoes" style="margin-top:0">
      <a class="btn primario" data-doc href="proposta_pdf.php?id=<?= (int)$o['id'] ?>&amp;tipo=proposta">⬇ Gerar proposta comercial (PDF)</a>
      <a class="btn" data-doc href="proposta_pdf.php?id=<?= (int)$o['id'] ?>&amp;tipo=orcamento">⬇ PDF do orçamento (uso interno)</a>
      <a class="btn ghost" href="proposta.php?id=<?= (int)$o['id'] ?>" target="_blank" rel="noopener">Ver proposta na tela / imprimir</a></div>
    <p class="ce-nota" style="margin:10px 0 0"><b>Proposta</b> = o que vai para o cliente (só preço de venda). <b>Orçamento</b> = planilha interna com custo, BDI, desconto e margem — não envie ao cliente.</p></section>
  <?php endif; ?>
  <?php if ($o['id']): ?>
  <section class="ce-bloco" style="margin-top:24px"><h2>Situação e próximos passos</h2><p>Mude a situação conforme a negociação. Quando o cliente aprovar, crie a obra com o valor do contrato.</p>
    <div class="ce-acoes" style="margin-top:0">
      <?php foreach (['enviada' => 'Marcar como enviada', 'aprovada' => 'Aprovada pelo cliente', 'perdida' => 'Perdida', 'rascunho' => 'Voltar para elaboração'] as $k => $rot): if ($k === $o['status']) { continue; } ?>
        <form method="post"><input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="acao" value="status"><input type="hidden" name="orc_id" value="<?= (int)$o['id'] ?>"><input type="hidden" name="status" value="<?= h($k) ?>"><button class="btn"><?= h($rot) ?></button></form>
      <?php endforeach; ?>
      <?php if ($o['status'] === 'aprovada' && !$travado && usuario_pode_criar_obra($eu)): ?>
        <form method="post" onsubmit="return confirm('Criar a obra com o valor de contrato desta proposta?')"><input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="acao" value="criar_obra"><input type="hidden" name="orc_id" value="<?= (int)$o['id'] ?>"><button class="btn primario">Criar obra desta proposta</button></form>
      <?php elseif ($travado): ?><a class="btn primario" href="obras.php?lista=1">Ver a obra criada →</a><?php endif; ?>
      <form method="post"><input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="acao" value="duplicar"><input type="hidden" name="orc_id" value="<?= (int)$o['id'] ?>"><button class="btn">Duplicar orçamento</button></form>
      <?php if (!$travado): ?><form method="post" onsubmit="return confirm('Excluir este orçamento definitivamente?')"><input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="acao" value="excluir"><input type="hidden" name="orc_id" value="<?= (int)$o['id'] ?>"><button class="btn ghost" style="color:#b42318">Excluir</button></form><?php endif; ?>
    </div></section>
  <?php endif; ?>
</main></div>
<dialog id="dlgSin" class="ce-dlg"><form method="dialog" style="margin:0"><div class="ce-dlg-cab"><h2 style="margin:0">Tabela SINAPI e catálogo de estrutura metálica</h2><button class="btn ghost ce-btn-peq" value="x">Fechar</button></div></form>
  <div class="ce-dlg-corpo">
    <div class="ce-sin-filtros">
      <label>Buscar<input id="sQ" placeholder="ex.: perfil I, telha trapezoidal, chumbador, 93358" autocomplete="off"></label>
      <label>Estado<select id="sUf"><?php foreach (sinapi_ufs() as $u_): ?><option><?= h($u_) ?></option><?php endforeach; ?></select></label>
      <label>Regime<select id="sRg"><?php foreach (sinapi_regimes() as $k_ => $r_): ?><option value="<?= h($k_) ?>"><?= h($r_) ?></option><?php endforeach; ?></select></label>
      <label>Tipo<select id="sTp"><option value="">Tudo</option><option value="I">Insumos</option><option value="C">Composições</option><option value="P">Catálogo próprio (sem preço)</option></select></label></div>
    <div class="ce-sin-chips" id="sChips"><button type="button" data-g="" class="on">Todos</button><?php foreach (sinapi_grupos() as $k_ => $g_): ?><button type="button" data-g="<?= h($k_) ?>"><?= h($g_[0]) ?></button><?php endforeach; ?></div>
    <div id="sInfo" class="ce-nota"></div>
    <div style="overflow:auto;max-height:52vh"><table class="ce-tab" id="sTab"><thead><tr><th>Origem</th><th>Código</th><th>Descrição</th><th>Un</th><th class="d">Custo unit. (R$)</th><th></th></tr></thead><tbody></tbody></table></div>
  </div></dialog>
<script>
(function () {
  var $ = function (s, r) { return (r || document).querySelector(s); };
  function num(v) { v = String(v || '').replace(/R\$|\s/g, ''); if (v.indexOf(',') >= 0) v = v.replace(/\./g, '').replace(',', '.'); else if (/^\d{1,3}(\.\d{3})+$/.test(v)) v = v.replace(/\./g, ''); var n = parseFloat(v); return isNaN(n) ? 0 : n; }
  function brl(v) { return 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function fmt(v) { return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function r2(v) { return Math.round((v + Number.EPSILON) * 100) / 100; }
  function calc() {
    var bdi = num($('#bdi').value) / 100, desc = num($('#desc').value) / 100, dir = 0, bruto = 0, tot = 0;
    document.querySelectorAll('#tItens tbody tr').forEach(function (tr) {
      var q = num(tr.querySelector('[name="qtd[]"]').value), c = num(tr.querySelector('[name="custo[]"]').value);
      var d = r2(q * c), b = r2(q * c * (1 + bdi)), v = r2(q * c * (1 + bdi) * (1 - desc));
      tr.querySelector('.c-dir').textContent = fmt(d); tr.querySelector('.c-ven').textContent = fmt(v); dir += d; bruto += b; tot += v;
    });
    dir = r2(dir); bruto = r2(bruto); tot = r2(tot);
    $('#tDir').textContent = brl(dir); $('#tBdi').textContent = brl(r2(bruto - dir)); $('#tDesc').textContent = '− ' + brl(r2(bruto - tot)); $('#tVenda').textContent = brl(tot);
    $('#tMarg').textContent = brl(r2(tot - dir)) + ' · ' + (tot > 0 ? ((tot - dir) / tot * 100).toFixed(1).replace('.', ',') : '0,0') + '%';
  }
  document.addEventListener('input', function (e) { if (e.target.closest('#fOrc')) calc(); });
  document.addEventListener('blur', function (e) { var t = e.target; if (t.name === 'custo[]' && t.value.trim()) t.value = fmt(num(t.value)); }, true);
  document.addEventListener('click', function (e) {
    if (e.target.closest('#bMais')) { var tb = $('#tItens tbody'), nova = tb.rows[tb.rows.length - 1].cloneNode(true); nova.querySelectorAll('input:not([type=hidden])').forEach(function (i) { i.value = ''; }); nova.querySelector('[name="origem[]"]').value = 'manual';
      if (tb.rows.length) nova.querySelector('[name="etapa[]"]').value = tb.rows[tb.rows.length - 1].querySelector('[name="etapa[]"]').value; nova.querySelector('.c-dir').textContent = '0,00'; nova.querySelector('.c-ven').textContent = '0,00'; tb.appendChild(nova); nova.querySelector('[name="descricao[]"]').focus(); }
    var rem = e.target.closest('[data-rem]'); if (rem) { var tb2 = $('#tItens tbody'); if (tb2.rows.length > 1) { rem.closest('tr').remove(); } else { rem.closest('tr').querySelectorAll('input:not([type=hidden])').forEach(function (i) { i.value = ''; }); } calc(); }
  });
  // ---- pesquisa SINAPI / catálogo
  var dlg = $('#dlgSin'), tmr = null, grupo = '';
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function buscar() {
    var u = 'comercial.php?sinapi=1&q=' + encodeURIComponent($('#sQ').value) + '&grupo=' + grupo + '&tipo=' + $('#sTp').value + '&uf=' + ($('#sUf').dataset.tocado ? $('#sUf').value : '') + '&regime=' + $('#sRg').value;
    fetch(u, { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) {
      var tb = $('#sTab tbody'); tb.innerHTML = '';
      if (j.uf && !$('#sUf').dataset.tocado) { $('#sUf').value = j.uf; }
      $('#sInfo').innerHTML = (j.tem_tabela ? 'Tabela SINAPI <b>' + esc(j.ref.slice(5) + '/' + j.ref.slice(0, 4)) + '</b> · ' + esc(j.uf) + ' · ' : '<b>Tabela SINAPI ainda não importada</b> para este estado/regime' + (<?= ($eu['perfil'] ?? '') === 'admin' ? 'true' : 'false' ?> ? ' — <a href="sinapi.php">importar a planilha da Caixa</a>' : ' — peça ao administrador do sistema') + ' · ') + j.total + ' resultado(s)' + (j.itens.length < j.total ? ' (mostrando ' + j.itens.length + ')' : '');
      j.itens.forEach(function (it, i) {
        var tr = document.createElement('tr'), semPreco = it.preco == null;
        tr.innerHTML = '<td><span class="ce-tag ' + (it.origem === 'sinapi' ? 'azul' : 'amarelo') + '">' + (it.origem === 'sinapi' ? (it.tipo === 'C' ? 'SINAPI comp.' : 'SINAPI insumo') : 'Catálogo próprio') + '</span></td><td>' + esc(it.codigo) + '</td><td>' + esc(it.descricao) + '</td><td>' + esc(it.unidade) + '</td><td class="d">' + (semPreco ? '<i>informe</i>' : fmt(it.preco)) + '</td><td><button type="button" class="btn ce-btn-peq">Adicionar</button></td>';
        tr.querySelector('button').addEventListener('click', function () { adicionar(it); this.textContent = '✓ Adicionado'; });
        tb.appendChild(tr);
      });
      if (!j.itens.length) tb.innerHTML = '<tr><td colspan="6" class="ce-vazio">Nada encontrado. Tente outra palavra ou outro grupo.</td></tr>';
    });
  }
  function adicionar(it) {
    var tb = $('#tItens tbody'), ult = tb.rows[tb.rows.length - 1], vazia = !ult.querySelector('[name="descricao[]"]').value.trim();
    var tr = vazia ? ult : ult.cloneNode(true);
    if (!vazia) { tr.querySelectorAll('input:not([type=hidden])').forEach(function (i) { i.value = ''; }); tr.querySelector('[name="etapa[]"]').value = ult.querySelector('[name="etapa[]"]').value; }
    tr.querySelector('[name="codigo[]"]').value = (it.origem === 'sinapi' ? 'SINAPI ' : '') + it.codigo;
    tr.querySelector('[name="descricao[]"]').value = it.descricao.slice(0, 255); tr.querySelector('[name="unidade[]"]').value = (it.unidade || '').slice(0, 12);
    tr.querySelector('[name="custo[]"]').value = it.preco == null ? '' : fmt(it.preco); tr.querySelector('[name="origem[]"]').value = it.origem;
    if (!vazia) { tr.querySelector('.c-dir').textContent = '0,00'; tr.querySelector('.c-ven').textContent = '0,00'; tb.appendChild(tr); }
    tr.querySelector('[name="qtd[]"]').focus(); calc();
  }
  $('#bSinapi').addEventListener('click', function () { dlg.showModal(); $('#sQ').focus(); buscar(); });
  ['#sUf', '#sRg', '#sTp'].forEach(function (s) { $(s).addEventListener('change', function () { if (s === '#sUf') this.dataset.tocado = '1'; buscar(); }); });
  $('#sQ').addEventListener('input', function () { clearTimeout(tmr); tmr = setTimeout(buscar, 250); });
  $('#sChips').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; grupo = b.dataset.g; this.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); }); buscar(); });
  // ---- aviso de alterações não salvas antes de gerar os PDFs
  var sujo = false; document.addEventListener('input', function (e) { if (e.target.closest('#fOrc')) { sujo = true; var a = $('#avisoSujo'); if (a) a.hidden = false; } });
  document.querySelectorAll('[data-doc]').forEach(function (a) { a.addEventListener('click', function (e) { if (sujo && !confirm('Há alterações não salvas: o PDF sai com a última versão SALVA. Gerar mesmo assim?')) e.preventDefault(); }); });
  $('#fOrc').addEventListener('submit', function () { sujo = false; });
  calc();
})();
</script>
</body></html>
    <?php
    exit;
}

// ---------------------------------------------------------------- lista
$r = com_resumo($eu);
$st = com_status_lista();
$cls = ['rascunho' => '', 'enviada' => 'azul', 'aprovada' => 'verde', 'perdida' => 'verm'];
?>
<main class="ce-main">
  <section class="ce-hero"><div><span class="ce-eyebrow">PAINEL COMERCIAL</span><h1>Orçamentos e propostas</h1>
    <p>Elabore o orçamento com custo direto, BDI e desconto, imprima a proposta comercial e, quando o cliente aprovar, crie a obra com o valor de contrato.</p></div>
    <span style="display:flex;gap:10px;flex-wrap:wrap"><?php if (($eu['perfil'] ?? '') === 'admin'): ?><a class="btn" href="sinapi.php">Tabela SINAPI</a><?php endif; ?><a class="btn primario" href="comercial.php?novo=1">+ Novo orçamento</a></span></section>
  <?php if ($msg): ?><div class="toast ok-faixa"><?= h($msg) ?></div><?php endif; ?>
  <?php if ($erro): ?><div class="toast erro-form"><?= h($erro) ?></div><?php endif; ?>
  <section class="ce-grid">
    <div class="ce-num"><small>Orçamentos</small><b><?= (int)$r['qtd'] ?></b><span><?= (int)$r['n_aberto'] ?> em aberto</span></div>
    <div class="ce-num"><small>Em negociação</small><b><?= h(central_rs($r['aberto'])) ?></b><span>elaboração + enviadas</span></div>
    <div class="ce-num verde"><small>Aprovado</small><b><?= h(central_rs($r['aprovado'])) ?></b><span><?= (int)$r['n_aprov'] ?> proposta(s)</span></div>
    <div class="ce-num verm"><small>Perdido</small><b><?= h(central_rs($r['perdido'])) ?></b><span><?= (int)$r['n_perd'] ?> proposta(s)</span></div>
    <div class="ce-num"><small>Conversão</small><b><?= $r['conversao'] === null ? '—' : h(number_format($r['conversao'], 1, ',', '.')) . '%' ?></b><span>aprovadas ÷ decididas</span></div>
  </section>
  <section class="ce-bloco"><h2>Todos os orçamentos</h2><p>Clique no número para editar.</p>
  <?php if (!$r['lista']): ?><div class="ce-vazio">Nenhum orçamento ainda. Clique em “+ Novo orçamento”.</div><?php else: ?>
    <table class="ce-tab"><thead><tr><th>Número</th><th>Título / cliente</th><th>Data</th><th>Situação</th><th class="d">Custo direto</th><th class="d">Preço de venda</th><th class="d">Margem</th><th></th></tr></thead><tbody>
    <?php foreach ($r['lista'] as $o): ?>
      <tr><td><a href="comercial.php?id=<?= (int)$o['id'] ?>"><b><?= h($o['numero']) ?></b></a></td><td><?= h($o['titulo']) ?><br><small style="color:#667085"><?= h($o['cliente']) ?></small></td>
        <td><?= h(central_dt($o['data_ref'])) ?></td><td><span class="ce-tag <?= $cls[$o['status']] ?? '' ?>"><?= h($st[$o['status']] ?? $o['status']) ?></span><?= !empty($o['obra_id']) ? ' <span class="ce-tag verde">obra</span>' : '' ?></td>
        <td class="d"><?= h(central_rs($o['direto'])) ?></td><td class="d"><b><?= h(central_rs($o['total'])) ?></b></td><td class="d"><?= h(number_format($o['margem_pct'], 1, ',', '.')) ?>%</td>
        <td class="d"><a class="btn ce-btn-peq" href="proposta_pdf.php?id=<?= (int)$o['id'] ?>&amp;tipo=proposta" title="Baixar a proposta comercial em PDF">Proposta PDF</a> <a class="btn ghost ce-btn-peq" href="proposta_pdf.php?id=<?= (int)$o['id'] ?>&amp;tipo=orcamento" title="PDF interno com custo, BDI e margem">Orçamento PDF</a></td></tr>
    <?php endforeach; ?></tbody></table>
  <?php endif; ?></section>
</main></div>
</body></html>
