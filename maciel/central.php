<?php
// Central da empresa: tela inicial de quem administra obras. Quatro painéis: Obras, Financeiro, Comercial e Pessoal (RH).
require __DIR__ . '/inc/nucleo.php';
require __DIR__ . '/inc/modelo.php';
require __DIR__ . '/inc/central.php';
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

$eu = central_exigir();
$hoje = (new DateTimeImmutable('now', new DateTimeZone('America/Sao_Paulo')))->format('Y-m-d');
$ym = substr($hoje, 0, 7);
$obras = dashobras_obras_do_usuario($eu);

// Financeiro: contratado e medido (mesma conta do Painel financeiro)
$fin = ['n' => count($obras), 'contrato' => 0.0, 'medido' => 0.0, 'atrasadas' => 0];
foreach ($obras as $o) {
    try {
        $r = dashobras_resumo($o, $hoje);
        if (empty($r['sem_medicao'])) {
            $fin['contrato'] += $r['contrato']; $fin['medido'] += $r['medido'];
            if (isset($r['desvio']) && $r['desvio'] < -10) { $fin['atrasadas']++; }
        }
    } catch (Throwable $e) { /* obra sem medição cadastrada */ }
}
$pctFin = $fin['contrato'] > 0 ? $fin['medido'] / $fin['contrato'] * 100 : 0;
// Comercial
try { $com = com_resumo($eu); } catch (Throwable $e) { $com = ['qtd' => 0, 'aberto' => 0, 'aprovado' => 0, 'n_aberto' => 0, 'n_aprov' => 0, 'conversao' => null]; }
// Pessoal
try { $pes = pessoal_consolidar($eu, $ym); } catch (Throwable $e) { $pes = null; }

central_topo('Central da empresa', 'inicio', $eu);
?>
<main class="ce-main">
  <section class="ce-hero">
    <div><span class="ce-eyebrow">CENTRAL DA EMPRESA</span><h1>Tudo da empresa, antes de abrir uma obra.</h1>
      <p>Comercial, financeiro e pessoal reunidos aqui; cada obra continua com seus dados separados e abre pela aba Obras.</p></div>
  </section>
  <section class="ce-cards">
    <article class="ce-card"><div class="ce-ico">🏗️</div><div><h2>Obras</h2><small>Escolha a obra, crie uma nova, envie documentos, cadastre empresas e catálogos.</small></div>
      <div class="ce-kpis"><div class="ce-kpi"><span>Obras em andamento</span><b><?= (int)$fin['n'] ?></b></div></div>
      <a class="btn primario" href="obras.php?lista=1">Abrir obras →</a></article>
    <?php if ($obras): ?>
    <article class="ce-card"><div class="ce-ico">📊</div><div><h2>Painel financeiro</h2><small>O que cada obra já mediu e o avanço contra o prazo.</small></div>
      <div class="ce-kpis"><div class="ce-kpi"><span>Contratado</span><b><?= h(central_rs($fin['contrato'])) ?></b></div>
        <div class="ce-kpi"><span>Medido até hoje</span><b><?= h(central_rs($fin['medido'])) ?> · <?= h(number_format($pctFin, 1, ',', '.')) ?>%</b></div>
        <div class="ce-kpi"><span>Obras atrasadas</span><b><?= (int)$fin['atrasadas'] ?></b></div></div>
      <a class="btn primario" href="dashboard_obras.php">Abrir painel →</a></article>
    <?php endif; ?>
    <article class="ce-card"><div class="ce-ico">📝</div><div><h2>Painel comercial</h2><small>Orçamentos e propostas comerciais para o cliente.</small></div>
      <div class="ce-kpis"><div class="ce-kpi"><span>Em aberto (<?= (int)$com['n_aberto'] ?>)</span><b><?= h(central_rs($com['aberto'])) ?></b></div>
        <div class="ce-kpi"><span>Aprovado (<?= (int)$com['n_aprov'] ?>)</span><b><?= h(central_rs($com['aprovado'])) ?></b></div>
        <div class="ce-kpi"><span>Conversão</span><b><?= $com['conversao'] === null ? '—' : h(number_format($com['conversao'], 1, ',', '.')) . '%' ?></b></div></div>
      <a class="btn primario" href="comercial.php">Abrir comercial →</a></article>
    <article class="ce-card"><div class="ce-ico">👷</div><div><h2>Painel pessoal (RH)</h2><small>Colaboradores, folha total e efetivo das obras.</small></div>
      <div class="ce-kpis"><div class="ce-kpi"><span>Colaboradores ativos</span><b><?= $pes ? (int)$pes['tot']['n'] : '—' ?></b></div>
        <div class="ce-kpi"><span>Folha do mês</span><b><?= $pes && $pes['tot']['total'] !== null ? h(central_rs($pes['tot']['total'])) : '—' ?></b></div>
        <div class="ce-kpi"><span>Efetivo médio no DP</span><b><?= $pes ? h(number_format($pes['tot']['efetivo_media'], 1, ',', '.')) : '—' ?></b></div></div>
      <a class="btn primario" href="pessoal.php">Abrir pessoal →</a></article>
  </section>
</main></div>
</body></html>
