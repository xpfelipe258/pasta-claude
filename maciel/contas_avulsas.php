<?php
// Contas a receber e a pagar da empresa, fora das obras (Painel financeiro). Somam ou descontam do resultado geral.
require __DIR__ . '/inc/nucleo.php';
require __DIR__ . '/inc/modelo.php';
require __DIR__ . '/inc/central.php';
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

$eu = central_exigir();
garantir_fin_avulsas();
$tipo = ($_GET['t'] ?? $_POST['t'] ?? 'receber') === 'pagar' ? 'P' : 'R';
$slug = $tipo === 'P' ? 'pagar' : 'receber';
$hoje = planos_hoje();
$msg = ''; $erro = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    conferir_csrf();
    $acao = (string)($_POST['acao'] ?? '');
    try {
        if ($acao === 'salvar') {
            $n = fav_salvar($_POST, $eu, (int)($_POST['id'] ?? 0));
            $_SESSION['fav_aviso'] = $n > 1 ? $n . ' parcelas lançadas.' : 'Conta salva.';
            header('Location: contas_avulsas.php?t=' . ($_POST['tipo'] === 'P' ? 'pagar' : 'receber')); exit;
        } elseif ($acao === 'baixar') { fav_baixar((int)$_POST['id'], $_POST, $eu); $_SESSION['fav_aviso'] = $tipo === 'R' ? 'Recebimento registrado.' : 'Pagamento registrado.'; header('Location: ' . $_SERVER['REQUEST_URI']); exit; }
        elseif ($acao === 'estornar') { fav_estornar((int)$_POST['id'], $eu); $_SESSION['fav_aviso'] = 'Baixa desfeita.'; header('Location: ' . $_SERVER['REQUEST_URI']); exit; }
        elseif ($acao === 'excluir') { fav_excluir((int)$_POST['id'], $eu, !empty($_POST['grupo'])); $_SESSION['fav_aviso'] = 'Conta excluída.'; header('Location: ' . $_SERVER['REQUEST_URI']); exit; }
    } catch (InvalidArgumentException $e) { $erro = $e->getMessage(); }
}
if (!empty($_SESSION['fav_aviso'])) { $msg = $_SESSION['fav_aviso']; unset($_SESSION['fav_aviso']); }

$mes = isset($_GET['mes']) ? (preg_match('/^\d{4}-\d{2}$/', $_GET['mes']) ? $_GET['mes'] : '') : substr($hoje, 0, 7);
$filtro = ['mes' => $mes, 'situacao' => (string)($_GET['situacao'] ?? ''), 'q' => (string)($_GET['q'] ?? '')];
$lista = fav_listar($eu, $tipo, $filtro);
$res = fav_resumo($eu, $mes ?: substr($hoje, 0, 7));
$editar = isset($_GET['editar']) ? fav_obter((int)$_GET['editar'], $eu) : null;
$abrirForm = isset($_GET['novo']) || $editar || ($erro && ($_POST['acao'] ?? '') === 'salvar');
$f = $editar ?: ['id' => 0, 'tipo' => $tipo, 'descricao' => '', 'categoria' => '', 'contraparte' => '', 'valor' => '', 'vencimento' => $hoje, 'obs' => ''];
if ($erro && ($_POST['acao'] ?? '') === 'salvar') { $f = array_merge($f, $_POST); }
$csrf = token_csrf();
$rot = $tipo === 'R' ? ['Contas a receber', 'Recebimentos', 'Cliente / quem paga', 'receber', 'Receber'] : ['Contas a pagar', 'Pagamentos', 'Fornecedor / a quem pagar', 'pagar', 'Pagar'];
$somaLista = 0.0; $somaAberta = 0.0;
foreach ($lista as $c) { $somaLista += (float)$c['valor']; if ($c['sit'] !== 'baixada') { $somaAberta += (float)$c['valor']; } }
central_topo($rot[0] . ' (fora das obras)', 'financeiro', $eu, 'Painel financeiro');
?>
<main class="ce-main">
  <section class="ce-hero"><div><span class="ce-eyebrow">PAINEL FINANCEIRO · FORA DAS OBRAS</span><h1><?= h($rot[0]) ?></h1>
    <p>Lançamentos da empresa que não pertencem a nenhuma obra. <?= $tipo === 'R' ? 'Eles <b>somam</b>' : 'Eles <b>descontam</b>' ?> do resultado geral do Painel financeiro, junto com a medição das obras, os impostos, a folha e os outros descontos.</p></div>
    <span style="display:flex;gap:10px;flex-wrap:wrap"><a class="btn ghost" href="dashboard_obras.php">← Painel financeiro</a><a class="btn primario" href="contas_avulsas.php?t=<?= $slug ?>&amp;novo=1">+ <?= $tipo === 'R' ? 'Conta a receber' : 'Conta a pagar' ?></a></span></section>
  <nav class="ce-sub"><a href="contas_avulsas.php?t=receber" class="<?= $tipo === 'R' ? 'on' : '' ?>">Contas a receber</a><a href="contas_avulsas.php?t=pagar" class="<?= $tipo === 'P' ? 'on' : '' ?>">Contas a pagar</a></nav>
  <?php if ($msg): ?><div class="toast ok-faixa"><?= h($msg) ?></div><?php endif; ?>
  <?php if ($erro): ?><div class="toast erro-form"><?= h($erro) ?></div><?php endif; ?>

  <section class="ce-grid">
    <?php $x = $res[$tipo]; ?>
    <div class="ce-num"><small>Previsto no mês</small><b><?= h(central_rs($x['previsto'])) ?></b><span>vencimento em <?= h($mes ? substr($mes, 5, 2) . '/' . substr($mes, 0, 4) : 'todos os meses') ?></span></div>
    <div class="ce-num verde"><small><?= $tipo === 'R' ? 'Recebido' : 'Pago' ?> no mês</small><b><?= h(central_rs($x['realizado'])) ?></b><span>baixas do mês</span></div>
    <div class="ce-num"><small>Em aberto (total)</small><b><?= h(central_rs($x['aberto'])) ?></b><span><?= (int)$x['n_aberto'] ?> conta(s)</span></div>
    <div class="ce-num <?= $x['vencido'] > 0 ? 'verm' : '' ?>"><small>Vencido</small><b><?= h(central_rs($x['vencido'])) ?></b><span><?= (int)$x['n_vencido'] ?> conta(s) em atraso</span></div>
  </section>

  <?php if ($abrirForm): ?>
  <section class="ce-bloco" id="form"><h2><?= $editar ? 'Editar conta' : 'Nova ' . ($tipo === 'R' ? 'conta a receber' : 'conta a pagar') ?></h2>
    <form method="post" class="ce-form"><input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="acao" value="salvar"><input type="hidden" name="id" value="<?= (int)($f['id'] ?? 0) ?>"><input type="hidden" name="tipo" value="<?= h($editar ? $f['tipo'] : $tipo) ?>">
      <label class="full">Descrição *<input name="descricao" required maxlength="160" value="<?= h($f['descricao']) ?>" placeholder="<?= $tipo === 'R' ? 'ex.: Venda de andaime usado' : 'ex.: Aluguel do escritório' ?>"></label>
      <label><?= h($rot[2]) ?><input name="contraparte" maxlength="160" value="<?= h($f['contraparte']) ?>"></label>
      <label>Categoria<select name="categoria"><option value="">—</option><?php foreach (fav_categorias($editar ? $f['tipo'] : $tipo) as $c_): ?><option <?= ($f['categoria'] ?? '') === $c_ ? 'selected' : '' ?>><?= h($c_) ?></option><?php endforeach; ?></select></label>
      <label>Valor (R$) *<input name="valor" inputmode="decimal" required value="<?= h($f['valor'] === '' ? '' : number_format((float)str_replace(',', '.', (string)$f['valor']), 2, ',', '.')) ?>"></label>
      <label>Vencimento *<input type="date" name="vencimento" required value="<?= h($f['vencimento']) ?>"></label>
      <?php if (!$editar): ?><label>Parcelas mensais<input name="parcelas" inputmode="numeric" value="1" title="Gera uma conta por mês, com o mesmo valor"></label><?php endif; ?>
      <label class="full">Observações<textarea name="obs" maxlength="2000"><?= h($f['obs']) ?></textarea></label>
      <div class="ce-acoes full"><button class="btn primario" type="submit">Salvar conta</button><a class="btn ghost" href="contas_avulsas.php?t=<?= $slug ?>">Cancelar</a></div>
    </form></section>
  <?php endif; ?>

  <section class="ce-bloco"><h2><?= h($rot[0]) ?></h2>
    <form method="get" class="ce-mes" style="margin-bottom:14px"><input type="hidden" name="t" value="<?= $slug ?>">
      <label>Mês de vencimento<input type="month" name="mes" value="<?= h($mes) ?>"></label>
      <label>Situação<select name="situacao"><option value="">Todas</option><?php foreach (['aberta' => 'Em aberto', 'vencida' => 'Vencidas', 'baixada' => $tipo === 'R' ? 'Recebidas' : 'Pagas'] as $k_ => $r_): ?><option value="<?= $k_ ?>" <?= $filtro['situacao'] === $k_ ? 'selected' : '' ?>><?= h($r_) ?></option><?php endforeach; ?></select></label>
      <label>Buscar<input name="q" value="<?= h($filtro['q']) ?>" placeholder="descrição, <?= $tipo === 'R' ? 'cliente' : 'fornecedor' ?>…"></label>
      <button class="btn">Filtrar</button><?php if ($mes): ?><a class="btn ghost" href="contas_avulsas.php?t=<?= $slug ?>&amp;mes=">Ver todos os meses</a><?php endif; ?></form>
    <?php if (!$lista): ?><div class="ce-vazio">Nenhuma conta neste filtro. <a href="contas_avulsas.php?t=<?= $slug ?>&amp;novo=1">Lançar <?= $tipo === 'R' ? 'a primeira conta a receber' : 'a primeira conta a pagar' ?></a>.</div>
    <?php else: ?><table class="ce-tab"><thead><tr><th>Vencimento</th><th>Descrição</th><th><?= $tipo === 'R' ? 'Cliente' : 'Fornecedor' ?></th><th>Categoria</th><th class="d">Valor</th><th>Situação</th><th></th></tr></thead><tbody>
    <?php foreach ($lista as $c): ?>
      <tr><td><?= h(central_dt($c['vencimento'])) ?></td><td><b><?= h($c['descricao']) ?></b><?= $c['parcela'] ? ' <small style="color:#667085">(' . h($c['parcela']) . ')</small>' : '' ?></td><td><?= h($c['contraparte'] ?: '—') ?></td><td><?= h($c['categoria'] ?: '—') ?></td>
        <td class="d"><b><?= h(central_rs($c['valor'])) ?></b></td>
        <td><span class="ce-tag <?= h($c['sit_cls']) ?>"><?= h($c['sit_rot']) ?></span><?= $c['baixa_data'] ? '<br><small style="color:#667085">' . h(central_dt($c['baixa_data'])) . ' · ' . h(central_rs($c['valor_baixa'])) . ($c['forma'] ? ' · ' . h($c['forma']) : '') . '</small>' : '' ?></td>
        <td class="d" style="white-space:nowrap">
          <?php if ($c['sit'] !== 'baixada'): ?>
          <form method="post" style="display:inline-flex;gap:4px;align-items:center"><input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="acao" value="baixar"><input type="hidden" name="id" value="<?= (int)$c['id'] ?>"><input type="hidden" name="t" value="<?= $slug ?>">
            <input type="date" name="baixa_data" value="<?= h($hoje) ?>" style="border:1px solid #d0d5dd;border-radius:8px;padding:5px"><button class="btn primario ce-btn-peq"><?= h($rot[4]) ?></button></form>
          <?php else: ?><form method="post" style="display:inline"><input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="acao" value="estornar"><input type="hidden" name="id" value="<?= (int)$c['id'] ?>"><input type="hidden" name="t" value="<?= $slug ?>"><button class="btn ghost ce-btn-peq">Desfazer</button></form><?php endif; ?>
          <a class="btn ce-btn-peq" href="contas_avulsas.php?t=<?= $slug ?>&amp;editar=<?= (int)$c['id'] ?>#form">Editar</a>
          <form method="post" style="display:inline" onsubmit="return confirm('Excluir esta conta?')"><input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="acao" value="excluir"><input type="hidden" name="id" value="<?= (int)$c['id'] ?>"><input type="hidden" name="t" value="<?= $slug ?>"><button class="btn ghost ce-btn-peq" style="color:#b42318">✕</button></form></td></tr>
    <?php endforeach; ?></tbody><tfoot><tr><td colspan="4">Total do filtro (em aberto: <?= h(central_rs($somaAberta)) ?>)</td><td class="d"><?= h(central_rs($somaLista)) ?></td><td colspan="2"></td></tr></tfoot></table><?php endif; ?></section>
</main></div></body></html>
