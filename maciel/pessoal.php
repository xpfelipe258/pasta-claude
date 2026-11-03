<?php
// Painel pessoal (RH): cadastro dos colaboradores da empresa (com alocação em obra ou sem obra e documentos na ficha), folha total e efetivo de todas as obras.
// Os colaboradores cadastrados dentro de cada obra (Gestão › Pessoal) também entram aqui. Valores de remuneração só para quem tem a área Financeiro.
require __DIR__ . '/inc/nucleo.php';
require __DIR__ . '/inc/modelo.php';
require __DIR__ . '/inc/central.php';
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

$eu = central_exigir();
$hoje = (new DateTimeImmutable('now', new DateTimeZone('America/Sao_Paulo')))->format('Y-m-d');
$mes = isset($_GET['mes']) && preg_match('/^\d{4}-(0[1-9]|1[0-2])$/', $_GET['mes']) ? $_GET['mes'] : substr($hoje, 0, 7);
$d = pessoal_consolidar($eu, $mes);
$vista = ($_GET['v'] ?? 'visao') === 'colaboradores' ? 'colaboradores' : 'visao';
$filtro = ['q' => trim((string)($_GET['q'] ?? '')), 'obra' => (string)($_GET['obra'] ?? ''), 'status' => (string)($_GET['status'] ?? '')];
$lista = rhp_listar($eu, $filtro);
$obrasP = rhp_obras_permitidas($eu);
$alertasDocs = rhp_alertas_documentos($eu);
$ver = $d['ver_salarios'];
$csrf = token_csrf();
// evolução da folha: 6 meses até o escolhido
$evo = [];
if ($ver) {
    for ($i = 5; $i >= 0; $i--) {
        $m = date('Y-m', strtotime($mes . '-01 -' . $i . ' months'));
        try { $x = $m === $mes ? $d : pessoal_consolidar($eu, $m); $evo[] = ['mes' => $m, 'n' => $x['tot']['n'], 'total' => $x['tot']['total'], 'media' => $x['tot']['efetivo_media']]; }
        catch (Throwable $e) { $evo[] = ['mes' => $m, 'n' => 0, 'total' => 0, 'media' => 0]; }
    }
}
$meses = ['01' => 'jan', '02' => 'fev', '03' => 'mar', '04' => 'abr', '05' => 'mai', '06' => 'jun', '07' => 'jul', '08' => 'ago', '09' => 'set', '10' => 'out', '11' => 'nov', '12' => 'dez'];
$rotMes = function ($m) use ($meses) { return $meses[substr($m, 5, 2)] . '/' . substr($m, 0, 4); };
$tot = $d['tot'];
$maxEvo = $evo ? max(1, max(array_map(function ($e) { return (float)$e['total']; }, $evo))) : 1;
$abrir = function ($obraId, $rot, $destino = 'pessoal') use ($csrf) {
    return '<form method="post" action="obras.php" style="display:inline"><input type="hidden" name="csrf" value="' . h($csrf) . '"><input type="hidden" name="acao" value="abrir"><input type="hidden" name="obra_id" value="' . (int)$obraId . '"><input type="hidden" name="destino" value="' . h($destino) . '"><button class="btn ce-btn-peq">' . h($rot) . '</button></form>';
};
central_topo('Painel pessoal (RH)', 'pessoal', $eu, 'Painel pessoal (RH)');
?>
<main class="ce-main">
  <section class="ce-hero"><div><span class="ce-eyebrow">PAINEL PESSOAL (RH)</span><h1>Pessoas, documentos e folha da empresa</h1>
    <p>Cadastre os colaboradores da empresa, aloque cada um numa obra (ou deixe sem obra), anexe os documentos e acompanhe a folha e o efetivo de todas as obras.</p></div>
    <span style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end"><?php if ($vista === 'visao'): ?><form class="ce-mes" method="get"><label>Mês<input type="month" name="mes" value="<?= h($mes) ?>" max="<?= h(substr($hoje, 0, 7)) ?>"></label><button class="btn">Atualizar</button></form><?php endif; ?><a class="btn primario" href="colaborador.php?novo=1">+ Novo colaborador</a></span></section>
  <nav class="ce-sub" aria-label="Seções do painel pessoal"><a href="pessoal.php" class="<?= $vista === 'visao' ? 'on' : '' ?>">Visão geral e folha</a><a href="pessoal.php?v=colaboradores" class="<?= $vista === 'colaboradores' ? 'on' : '' ?>">Colaboradores (<?= count($lista) ?>)</a></nav>
  <?php if ($vista === 'colaboradores'): ?>
  <section class="ce-bloco"><h2>Colaboradores da empresa</h2>
    <p>Cadastro central: cada pessoa pode estar alocada numa obra ou ficar <b>sem obra</b>. Abra a ficha para editar, ver o custo e anexar documentos.</p>
    <form method="get" class="ce-mes" style="margin-bottom:14px"><input type="hidden" name="v" value="colaboradores">
      <label>Buscar<input name="q" value="<?= h($filtro['q']) ?>" placeholder="nome, CPF ou função"></label>
      <label>Obra<select name="obra"><option value="">Todas</option><option value="sem" <?= $filtro['obra'] === 'sem' ? 'selected' : '' ?>>Sem obra</option><?php foreach ($obrasP as $oid_ => $on_): ?><option value="<?= (int)$oid_ ?>" <?= (string)$filtro['obra'] === (string)$oid_ ? 'selected' : '' ?>><?= h($on_) ?></option><?php endforeach; ?></select></label>
      <label>Situação<select name="status"><option value="">Todas</option><?php foreach (rhp_status_lista() as $s_): ?><option <?= $filtro['status'] === $s_ ? 'selected' : '' ?>><?= h($s_) ?></option><?php endforeach; ?></select></label>
      <button class="btn">Filtrar</button></form>
    <?php if (!$lista): ?><div class="ce-vazio">Nenhum colaborador encontrado. <a href="colaborador.php?novo=1">Cadastrar o primeiro</a>.</div><?php else: ?>
    <table class="ce-tab"><thead><tr><th>Nome</th><th>Função</th><th>Situação</th><th>Alocação</th><th>Documentos</th><th class="d">Custo no mês</th><th></th></tr></thead><tbody>
    <?php foreach ($lista as $c): $k = $ver ? rhp_custo($c, $mes) : null; ?>
      <tr><td><b><a href="colaborador.php?id=<?= (int)$c['id'] ?>"><?= h($c['nome']) ?></a></b><br><small style="color:#667085"><?= h($c['empresa']) ?></small></td><td><?= h($c['funcao'] ?: '—') ?></td>
        <td><span class="ce-tag <?= $c['status'] === 'Demitido' ? 'verm' : ($c['status'] === 'Afastado' ? 'amarelo' : 'verde') ?>"><?= h($c['status']) ?></span></td>
        <td><form method="post" action="colaborador.php" style="display:flex;gap:6px"><input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="acao" value="alocar"><input type="hidden" name="id" value="<?= (int)$c['id'] ?>"><input type="hidden" name="volta" value="lista">
          <select name="obra_id" onchange="this.form.submit()" style="max-width:190px;border:1px solid #d0d5dd;border-radius:8px;padding:6px"><option value="0">Sem obra</option><?php foreach ($obrasP as $oid_ => $on_): ?><option value="<?= (int)$oid_ ?>" <?= (int)$c['obra_id'] === (int)$oid_ ? 'selected' : '' ?>><?= h($on_) ?></option><?php endforeach; ?></select></form></td>
        <td><?= $c['docs_n'] ? '<span class="ce-tag azul">' . (int)$c['docs_n'] . ' anexo(s)</span>' : '<span class="ce-tag">nenhum</span>' ?><?= $c['docs_venc'] ? ' <span class="ce-tag verm">' . (int)$c['docs_venc'] . ' vencido(s)</span>' : '' ?></td>
        <td class="d"><?= $ver ? ($k && !$k['sem_salario'] ? h(central_rs($k['total'])) : '<span class="ce-tag amarelo">sem salário</span>') : '—' ?></td>
        <td class="d"><a class="btn ce-btn-peq" href="colaborador.php?id=<?= (int)$c['id'] ?>">Abrir ficha</a></td></tr>
    <?php endforeach; ?></tbody></table><?php endif; ?></section>
  <?php $outros = ($filtro['q'] === '' && $filtro['obra'] === '' && $filtro['status'] === '') ? array_filter($d['colaboradores'], function ($c) { return ($c['origem'] ?? '') !== 'p'; }) : []; if ($outros): ?>
  <section class="ce-bloco"><h2>Cadastrados dentro das obras</h2><p>Colaboradores que já existiam no cadastro de cada obra (Gestão › Pessoal, ligado ao SESMT). Continuam na folha; para alterar, abra a lista da obra.</p>
    <table class="ce-tab"><thead><tr><th>Nome</th><th>Função</th><th>Obra</th><th>Vínculo</th><th class="d">Custo no mês</th><th></th></tr></thead><tbody>
    <?php foreach ($outros as $c): ?><tr><td><b><?= h($c['nome']) ?></b></td><td><?= h($c['funcao']) ?></td><td><?= h($c['obra']) ?></td><td><?= h($c['vinculo']) ?></td><td class="d"><?= $ver ? h(central_rs($c['total'])) : '—' ?></td><td class="d"><?= $abrir($c['obra_id'], 'Abrir na obra') ?></td></tr><?php endforeach; ?></tbody></table></section>
  <?php endif; ?>
  <?php else: ?>
  <?php if (!$ver): ?><div class="toast erro-form">Os valores de salário e folha só aparecem para quem tem a área Financeiro. Colaboradores e efetivo continuam visíveis.</div><?php endif; ?>
  <section class="ce-grid">
    <div class="ce-num"><small>Colaboradores ativos</small><b><?= (int)$tot['n'] ?></b><span><?= (int)$tot['sem_salario'] ?> sem salário informado</span></div>
    <div class="ce-num verde"><small>Folha total do mês</small><b><?= $ver ? h(central_rs($tot['total'])) : '—' ?></b><span>com encargos e provisões</span></div>
    <div class="ce-num"><small>Remuneração bruta</small><b><?= $ver ? h(central_rs($tot['remuneracao'])) : '—' ?></b><span>salários + adicionais</span></div>
    <div class="ce-num"><small>Encargos + provisões</small><b><?= $ver ? h(central_rs($tot['encargos'] + $tot['provisoes'])) : '—' ?></b><span>benefícios: <?= $ver ? h(central_rs($tot['beneficios'])) : '—' ?></span></div>
    <div class="ce-num"><small>Efetivo médio no DP</small><b><?= h(number_format($tot['efetivo_media'], 1, ',', '.')) ?></b><span>pico somado: <?= (int)$tot['efetivo_pico'] ?></span></div>
  </section>

  <?php if ($alertasDocs): ?>
  <section class="ce-bloco"><h2>Documentos vencidos ou a vencer (30 dias)</h2><p>Dos colaboradores da empresa. Abra a ficha para anexar a versão nova.</p>
    <table class="ce-tab"><thead><tr><th>Colaborador</th><th>Documento</th><th>Validade</th><th></th></tr></thead><tbody>
    <?php foreach ($alertasDocs as $a): list($sk, $sr, $sc) = rhp_situacao_documento($a['validade']); ?><tr><td><b><?= h($a['nome']) ?></b></td><td><?= h($a['tipo']) ?></td><td><?= h(central_dt($a['validade'])) ?> <span class="ce-tag <?= $sc ?>"><?= h($sr) ?></span></td><td class="d"><a class="btn ce-btn-peq" href="colaborador.php?id=<?= (int)$a['pessoa_id'] ?>#docs">Abrir ficha</a></td></tr><?php endforeach; ?></tbody></table></section>
  <?php endif; ?>
  <section class="ce-bloco"><h2>Por obra — <?= h($rotMes($mes)) ?></h2><p>Folha e colaboradores do cadastro de cada obra; efetivo é o que foi lançado no Efetivo diário (DP) no mês.</p>
  <?php if (!$d['obras']): ?><div class="ce-vazio">Nenhuma obra ativa.</div><?php else: ?>
    <table class="ce-tab"><thead><tr><th>Obra</th><th class="d">Colaboradores</th><th class="d">Remuneração</th><th class="d">Encargos + prov.</th><th class="d">Benefícios</th><th class="d">Folha total</th><th class="d">Custo médio</th><th class="d">Efetivo DP (méd. / pico)</th><th></th></tr></thead><tbody>
    <?php foreach ($d['obras'] as $o): ?>
      <tr><td><b><?= h($o['nome']) ?></b><?= !empty($o['repetida']) ? '<br><small style="color:#667085">usa o mesmo cadastro de outra obra</small>' : '' ?><?= $o['erro'] ? '<br><small style="color:#b42318">não foi possível ler esta obra</small>' : '' ?></td>
        <td class="d"><?= (int)$o['n'] ?><?= $o['sem_salario'] ? ' <span class="ce-tag amarelo" title="sem salário informado">' . (int)$o['sem_salario'] . ' s/ salário</span>' : '' ?></td>
        <td class="d"><?= $ver ? h(central_rs($o['remuneracao'])) : '—' ?></td><td class="d"><?= $ver ? h(central_rs($o['encargos'] + $o['provisoes'])) : '—' ?></td><td class="d"><?= $ver ? h(central_rs($o['beneficios'])) : '—' ?></td>
        <td class="d"><b><?= $ver ? h(central_rs($o['total'])) : '—' ?></b></td><td class="d"><?= $ver && $o['n'] ? h(central_rs($o['total'] / $o['n'])) : '—' ?></td>
        <td class="d"><?= h(number_format($o['efetivo']['media'], 1, ',', '.')) ?> / <?= (int)$o['efetivo']['pico'] ?></td><td class="d"><?= !empty($o['sem_obra']) ? '<a class="btn ce-btn-peq" href="pessoal.php?v=colaboradores&amp;obra=sem">Ver quem está sem obra →</a>' : $abrir($o['id'], 'Abrir Pessoal da obra →') ?></td></tr>
    <?php endforeach; ?></tbody>
    <tfoot><tr><td>Total da empresa</td><td class="d"><?= (int)$tot['n'] ?></td><td class="d"><?= $ver ? h(central_rs($tot['remuneracao'])) : '—' ?></td><td class="d"><?= $ver ? h(central_rs($tot['encargos'] + $tot['provisoes'])) : '—' ?></td><td class="d"><?= $ver ? h(central_rs($tot['beneficios'])) : '—' ?></td><td class="d"><?= $ver ? h(central_rs($tot['total'])) : '—' ?></td><td class="d"></td><td class="d"><?= h(number_format($tot['efetivo_media'], 1, ',', '.')) ?> / <?= (int)$tot['efetivo_pico'] ?></td><td></td></tr></tfoot></table>
  <?php endif; ?></section>

  <?php if ($ver && $evo): ?>
  <section class="ce-bloco"><h2>Evolução da folha</h2><p>Folha total (com encargos e provisões) dos últimos seis meses, somando as obras.</p>
    <table class="ce-tab"><thead><tr><th>Mês</th><th class="d">Colaboradores</th><th class="d">Efetivo DP médio</th><th class="d">Folha total</th><th style="width:34%"></th></tr></thead><tbody>
    <?php foreach ($evo as $e): ?><tr><td><?= h($rotMes($e['mes'])) ?></td><td class="d"><?= (int)$e['n'] ?></td><td class="d"><?= h(number_format($e['media'], 1, ',', '.')) ?></td><td class="d"><b><?= h(central_rs($e['total'])) ?></b></td>
      <td><div style="background:#eef2f6;border-radius:6px;height:12px"><div style="width:<?= round($e['total'] / $maxEvo * 100) ?>%;background:var(--marca,#d97706);height:12px;border-radius:6px"></div></div></td></tr><?php endforeach; ?></tbody></table></section>
  <?php endif; ?>

  <?php if ($d['empresas']): ?>
  <section class="ce-bloco"><h2>Por empresa contratada</h2><p>Colaboradores agrupados pela empresa a que pertencem (própria ou terceirizada), em todas as obras.</p>
    <table class="ce-tab"><thead><tr><th>Empresa</th><th class="d">Colaboradores</th><th>Obras</th><th class="d">Folha total</th></tr></thead><tbody>
    <?php foreach ($d['empresas'] as $nome => $e): ?><tr><td><b><?= h($nome) ?></b></td><td class="d"><?= (int)$e['n'] ?></td><td><?= h(implode(', ', array_keys($e['obras']))) ?></td><td class="d"><?= $ver ? h(central_rs($e['total'])) : '—' ?></td></tr><?php endforeach; ?></tbody></table></section>
  <?php endif; ?>

  <section class="ce-bloco"><h2>Colaboradores ativos no mês</h2><p>Cadastro da empresa (com ficha e documentos) e colaboradores cadastrados dentro das obras.</p>
  <?php if (!$d['colaboradores']): ?><div class="ce-vazio">Nenhum colaborador ativo neste mês.</div><?php else: ?>
    <table class="ce-tab" id="tColab"><thead><tr><th>Nome</th><th>Função</th><th>Empresa</th><th>Obra</th><th>Vínculo</th><th>Situação</th><th class="d">Custo no mês</th><th></th></tr></thead><tbody>
    <?php foreach ($d['colaboradores'] as $c): ?>
      <tr><td><b><?= h($c['nome']) ?></b></td><td><?= h($c['funcao']) ?></td><td><?= h($c['empresa']) ?></td><td><?= h($c['obra']) ?></td><td><?= h($c['vinculo']) ?></td>
        <td><span class="ce-tag <?= $c['sem_salario'] ? 'amarelo' : 'verde' ?>"><?= $c['sem_salario'] ? 'sem salário' : h($c['status']) ?></span></td>
        <td class="d"><?= $ver ? h(central_rs($c['total'])) : '—' ?></td><td class="d"><?= ($c['origem'] ?? '') === 'p' ? '<a class="btn ce-btn-peq" href="colaborador.php?id=' . (int)$c['pessoa_id'] . '">Abrir ficha</a>' : $abrir($c['obra_id'], 'Editar') ?></td></tr>
    <?php endforeach; ?></tbody></table>
  <?php endif; ?></section>
  <?php endif; ?>
  <p class="ce-nota">A folha é uma estimativa gerencial (premissas de RH editáveis em Financeiro › Contas a pagar › Parâmetros da folha, em cada obra). O fechamento oficial é do contador.</p>
</main></div>
</body></html>
