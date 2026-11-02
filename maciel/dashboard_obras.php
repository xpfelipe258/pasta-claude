<?php
// Painel das obras: tela inicial de quem administra mais de uma obra. Mostra, por obra, o que já foi medido e o avanço até a data escolhida.
require __DIR__ . '/inc/nucleo.php';
require __DIR__ . '/inc/modelo.php';
require __DIR__ . '/inc/dash_obras.php';
require_once __DIR__ . '/inc/central.php';
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

$eu = exigir_login_pagina();
$obrasDoUsuario = dashobras_obras_do_usuario($eu);
if (!$obrasDoUsuario) { header('Location: obras.php?lista=1'); exit; }

$hoje = (new DateTimeImmutable('now', new DateTimeZone('America/Sao_Paulo')))->format('Y-m-d');
$ate = isset($_GET['ate']) && data_valida($_GET['ate']) ? $_GET['ate'] : $hoje;
$resumos = [];
foreach ($obrasDoUsuario as $o) {
    try { $resumos[] = dashobras_resumo($o, $ate); }
    catch (Throwable $e) { $resumos[] = ['id' => (int)$o['id'], 'nome' => $o['nome'], 'sem_medicao' => true, 'contrato' => 0, 'contrato_cadastro' => (float)($o['valor_contrato'] ?? 0), 'curva' => [], 'erro' => true, 'inicio' => null, 'fim' => null]; }
}
$tot = ['contrato' => 0.0, 'medido' => 0.0, 'no_mes' => 0.0, 'saldo' => 0.0, 'atrasadas' => 0, 'atencao' => 0];
foreach ($resumos as &$r) {
    $r['situacao'] = ['cls' => 'cinza', 'txt' => 'Sem medição'];
    if (!$r['sem_medicao']) {
        $tot['contrato'] += $r['contrato']; $tot['medido'] += $r['medido']; $tot['no_mes'] += $r['no_mes']; $tot['saldo'] += $r['saldo'];
        if (isset($r['desvio'])) {
            $d = $r['desvio'];
            if ($d >= 3) { $r['situacao'] = ['cls' => 'azul', 'txt' => 'Adiantada']; }
            elseif ($d >= -3) { $r['situacao'] = ['cls' => 'verde', 'txt' => 'No ritmo']; }
            elseif ($d >= -10) { $r['situacao'] = ['cls' => 'amarelo', 'txt' => 'Atenção']; $tot['atencao']++; }
            else { $r['situacao'] = ['cls' => 'vermelho', 'txt' => 'Atrasada']; $tot['atrasadas']++; }
        } else { $r['situacao'] = ['cls' => 'cinza', 'txt' => 'Sem prazo cadastrado']; }
    }
}
unset($r);
$pctGeral = $tot['contrato'] > 0 ? $tot['medido'] / $tot['contrato'] * 100 : 0;
$ordem = $resumos; usort($ordem, function ($a, $b) { return ($a['desvio'] ?? 999) <=> ($b['desvio'] ?? 999); });   // as que mais precisam de atenção primeiro (tabela)

function rs_p($v) { return 'R$ ' . number_format((float)$v, 2, ',', '.'); }
function pc_p($v, $c = 1) { return number_format((float)$v, $c, ',', '.') . '%'; }
function dt_p($d) { return $d ? date('d/m/Y', strtotime($d)) : '—'; }
function curva_svg(array $curva, $ini, $fim, $ate)
{
    $w = 360; $h = 130; $ml = 34; $mb = 20; $mt = 8; $mr = 8; $pw = $w - $ml - $mr; $ph = $h - $mt - $mb;
    if (!$ini || !$fim || $fim <= $ini) { return '<div class="dp-sem-curva">Cadastre o início e o fim da obra para ver a curva.</div>'; }
    $t0 = strtotime($ini); $t1 = strtotime($fim); $span = max(1, $t1 - $t0);
    $X = function ($d) use ($t0, $span, $ml, $pw) { return $ml + max(0, min(1, (strtotime($d) - $t0) / $span)) * $pw; };
    $Y = function ($p) use ($mt, $ph) { return $mt + $ph - max(0, min(100, $p)) / 100 * $ph; };
    $s = '<svg viewBox="0 0 ' . $w . ' ' . $h . '" role="img" aria-label="Curva de avanço: medido acumulado e previsto">';
    foreach ([0, 50, 100] as $g) { $s .= '<line x1="' . $ml . '" x2="' . ($w - $mr) . '" y1="' . round($Y($g), 1) . '" y2="' . round($Y($g), 1) . '" class="dp-g"/><text x="' . ($ml - 5) . '" y="' . round($Y($g) + 3, 1) . '" class="dp-t" text-anchor="end">' . $g . '%</text>'; }
    $s .= '<line x1="' . round($X($ini), 1) . '" y1="' . round($Y(0), 1) . '" x2="' . round($X($fim), 1) . '" y2="' . round($Y(100), 1) . '" class="dp-prev"/>';
    if ($curva) {
        $pts = [round($X($ini), 1) . ',' . round($Y(0), 1)];
        foreach ($curva as $p) { $pts[] = round($X($p['data']), 1) . ',' . round($Y($p['real']), 1); }
        $ult = end($curva); $xu = round($X($ult['data']), 1);
        $s .= '<polygon points="' . implode(' ', $pts) . ' ' . $xu . ',' . round($Y(0), 1) . '" class="dp-area"/><polyline points="' . implode(' ', $pts) . '" class="dp-real"/>';
        $s .= '<circle cx="' . $xu . '" cy="' . round($Y($ult['real']), 1) . '" r="4.2" class="dp-pt"/>';
    }
    $xa = round($X($ate), 1);
    $s .= '<line x1="' . $xa . '" x2="' . $xa . '" y1="' . $mt . '" y2="' . ($h - $mb) . '" class="dp-hoje"/>';
    $s .= '<text x="' . $ml . '" y="' . ($h - 5) . '" class="dp-t">' . date('m/Y', $t0) . '</text><text x="' . ($w - $mr) . '" y="' . ($h - 5) . '" class="dp-t" text-anchor="end">' . date('m/Y', $t1) . '</text></svg>';
    return $s;
}

$csrf = token_csrf();
$logoGlobal = global_ler('logo', '');
pagina_inicio('Painel das obras');
?>
<style>
.dp-shell { max-width: 1280px; margin: 0 auto; padding: 0 22px 60px; }
.dp-hero { display:flex; flex-direction:row; flex-wrap:wrap; gap:18px; align-items:flex-end; justify-content:space-between; margin:26px 0 20px; }
.dp-hero h1 { font-size: clamp(1.6rem, 3vw, 2.2rem); letter-spacing:-.02em; margin:4px 0 6px; }
.dp-hero p { margin:0; color:var(--portal-muted,#667085); max-width:680px; }
.dp-data { display:flex; gap:10px; align-items:flex-end; flex-wrap:wrap; }
.dp-data label { display:flex; flex-direction:column; gap:4px; font-size:.78rem; font-weight:700; color:var(--portal-muted,#667085); text-transform:uppercase; letter-spacing:.05em; }
.dp-data .btn { text-decoration:none; } .dp-data input { padding:10px 12px; border:1px solid var(--portal-line,#e4e7ec); border-radius:10px; font:inherit; background:#fff; }
.dp-kpis { display:grid; grid-template-columns:repeat(auto-fit,minmax(210px,1fr)); gap:14px; margin-bottom:22px; }
.dp-kpi { background:#fff; border:1px solid var(--portal-line,#e4e7ec); border-radius:16px; padding:16px 18px; box-shadow:0 10px 28px rgba(16,24,40,.06); border-top:4px solid var(--portal-primary,#d97706); }
.dp-kpi small { display:block; color:var(--portal-muted,#667085); font-size:.74rem; font-weight:700; text-transform:uppercase; letter-spacing:.05em; }
.dp-kpi b { display:block; font-size:1.55rem; margin:6px 0 2px; letter-spacing:-.02em; }
.dp-kpi span { color:var(--portal-muted,#667085); font-size:.82rem; }
.dp-kpi.verde { border-top-color:#12b76a } .dp-kpi.vermelho { border-top-color:#d92d20 } .dp-kpi.azul { border-top-color:#2e90fa }
.dp-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(400px,1fr)); gap:18px; margin-bottom:26px; }
.dp-obra { background:#fff; border:1px solid var(--portal-line,#e4e7ec); border-radius:18px; padding:20px; box-shadow:0 14px 34px rgba(16,24,40,.07); display:flex; flex-direction:column; gap:14px; }
.dp-obra header { display:flex; justify-content:space-between; gap:10px; align-items:flex-start; }
.dp-obra h2 { font-size:1.15rem; margin:0; line-height:1.25; }
.dp-obra header small { color:var(--portal-muted,#667085); font-size:.8rem; }
.dp-chip { flex:none; padding:5px 11px; border-radius:99px; font-size:.76rem; font-weight:800; white-space:nowrap; }
.dp-chip.verde { background:#d1fadf; color:#05603a } .dp-chip.azul { background:#d1e9ff; color:#175cd3 } .dp-chip.amarelo { background:#fef0c7; color:#93370d }
.dp-chip.vermelho { background:#fee4e2; color:#b42318 } .dp-chip.cinza { background:#eaecf0; color:#475467 }
.dp-nums { display:grid; grid-template-columns:1fr 1fr; gap:10px 16px; }
.dp-nums div small { display:block; color:var(--portal-muted,#667085); font-size:.72rem; font-weight:700; text-transform:uppercase; letter-spacing:.04em; }
.dp-nums div b { display:block; font-size:1.12rem; letter-spacing:-.01em; margin-top:2px; }
.dp-nums .grande b { font-size:1.45rem; color:var(--portal-text,#182230); }
.dp-barras { display:flex; flex-direction:column; gap:8px; }
.dp-barras > div > span { display:flex; justify-content:space-between; font-size:.82rem; margin-bottom:4px; }
.dp-trilha { position:relative; height:12px; background:#eef0f4; border-radius:8px; overflow:visible; }
.dp-trilha i { display:block; height:100%; border-radius:8px; background:var(--portal-primary,#d97706); }
.dp-trilha em { position:absolute; top:-4px; bottom:-4px; width:3px; background:#101828; border-radius:2px; }
.dp-leg { display:flex; gap:14px; font-size:.74rem; color:var(--portal-muted,#667085); }
.dp-obra svg { width:100%; height:auto; display:block; background:#fafbfc; border:1px solid var(--portal-line,#e4e7ec); border-radius:12px; }
.dp-g { stroke:#e4e7ec; stroke-width:1 } .dp-t { fill:#98a2b3; font-size:9px; font-family:inherit }
.dp-prev { stroke:#98a2b3; stroke-width:2; stroke-dasharray:5 4 } .dp-real { fill:none; stroke:var(--portal-primary,#d97706); stroke-width:2.6; stroke-linejoin:round }
.dp-area { fill:var(--portal-primary,#d97706); opacity:.14 } .dp-pt { fill:var(--portal-primary,#d97706); stroke:#fff; stroke-width:2 } .dp-hoje { stroke:#101828; stroke-width:1; stroke-dasharray:2 3 }
.dp-sem-curva, .dp-sem-med { padding:18px; border:1px dashed var(--portal-line,#e4e7ec); border-radius:12px; color:var(--portal-muted,#667085); font-size:.88rem; background:#fafbfc; }
.dp-acoes { display:flex; gap:10px; margin-top:auto; }
.dp-acoes form { flex:1; margin:0 } .dp-acoes .btn { width:100%; justify-content:center; text-align:center; }
.dp-tabela-box { background:#fff; border:1px solid var(--portal-line,#e4e7ec); border-radius:18px; padding:18px 20px; box-shadow:0 14px 34px rgba(16,24,40,.06); overflow-x:auto; }
.dp-tabela-box h3 { margin:0 0 4px; font-size:1.05rem; } .dp-tabela-box > p { margin:0 0 12px; color:var(--portal-muted,#667085); font-size:.86rem; }
.dp-tabela { width:100%; border-collapse:collapse; font-size:.9rem; min-width:860px; }
.dp-tabela th { text-align:right; font-size:.72rem; text-transform:uppercase; letter-spacing:.04em; color:var(--portal-muted,#667085); padding:8px 10px; border-bottom:2px solid var(--portal-line,#e4e7ec); }
.dp-tabela td { text-align:right; padding:11px 10px; border-bottom:1px solid #f0f2f5; white-space:nowrap; }
.dp-tabela th:first-child, .dp-tabela td:first-child { text-align:left; white-space:normal; } .dp-tabela td:first-child b { display:block }
.dp-tabela tfoot td { font-weight:800; border-top:2px solid var(--portal-line,#e4e7ec); border-bottom:0; }
.dp-neg { color:#b42318; font-weight:700 } .dp-pos { color:#05603a; font-weight:700 }
.dp-nota { color:var(--portal-muted,#667085); font-size:.82rem; margin-top:14px; line-height:1.5; }
@media (max-width:520px) { .dp-grid { grid-template-columns:1fr } .dp-shell { padding:0 14px 50px } .dp-nums { grid-template-columns:1fr 1fr } }
</style>
<div class="portal-shell">
  <header class="portal-topo">
    <div class="portal-brand">
      <?php if ($logoGlobal): ?><img src="<?= h($logoGlobal) ?>" alt="Logo"><?php else: ?><span class="brand-mark">NO</span><?php endif; ?>
      <div><strong><?= h(global_ler('nome_sistema', 'Núcleo de Obras')) ?></strong><small>Painel das obras</small></div>
    </div>
    <div class="portal-user"><span>Olá, <?= h($eu['nome']) ?></span><a class="btn ghost" href="obras.php?lista=1">Central de obras</a><a class="btn ghost" href="sair.php">Sair</a></div>
  </header>
  <?= central_abas('financeiro', $eu) ?>
  <main class="dp-shell">
    <section class="dp-hero">
      <div><span class="eyebrow">PAINEL FINANCEIRO E DE AVANÇO</span><h1><?= count($resumos) === 1 ? 'Sua obra' : 'Suas obras' ?> até <?= h(dt_p($ate)) ?></h1>
        <p>O que <?= count($resumos) === 1 ? 'a obra' : 'cada obra' ?> já mediu e quanto <?= count($resumos) === 1 ? 'ela' : 'ela' ?> avançou, comparado ao ritmo previsto pelo prazo. Valores em R$ do contrato de medição (RÓTULA), com centavos.</p></div>
      <form class="dp-data" method="get"><label>Posição até<input type="date" name="ate" value="<?= h($ate) ?>" max="<?= h($hoje) ?>"></label><button class="btn">Atualizar</button><?php if ($ate !== $hoje): ?><a class="btn ghost" href="dashboard_obras.php">Hoje</a><?php endif; ?></form>
    </section>

    <section class="dp-kpis">
      <div class="dp-kpi"><small><?= count($resumos) === 1 ? 'Obra em andamento' : 'Obras em andamento' ?></small><b><?= count($resumos) ?></b><span><?= $tot['atrasadas'] ?> atrasada(s) · <?= $tot['atencao'] ?> em atenção</span></div>
      <div class="dp-kpi"><small>Contratado (medição)</small><b><?= h(rs_p($tot['contrato'])) ?></b><span>soma dos contratos das obras</span></div>
      <div class="dp-kpi verde"><small>Medido até <?= h(date('d/m', strtotime($ate))) ?></small><b><?= h(rs_p($tot['medido'])) ?></b><span><?= h(pc_p($pctGeral)) ?> do contratado</span></div>
      <div class="dp-kpi azul"><small>Medido neste mês</small><b><?= h(rs_p($tot['no_mes'])) ?></b><span>de <?= h(date('01/m', strtotime($ate))) ?> a <?= h(date('d/m', strtotime($ate))) ?></span></div>
      <div class="dp-kpi <?= $tot['saldo'] > 0 ? '' : 'verde' ?>"><small>Saldo a medir</small><b><?= h(rs_p($tot['saldo'])) ?></b><span>contrato − medido acumulado</span></div>
    </section>

    <div class="dp-grid">
    <?php foreach ($resumos as $r): $semMed = $r['sem_medicao']; ?>
      <article class="dp-obra">
        <header><div><h2><?= h($r['nome']) ?></h2><small><?= h(dt_p($r['inicio'] ?? null)) ?> → <?= h(dt_p($r['fim'] ?? null)) ?><?= $r['ultima'] ?? null ? ' · atualizada em ' . h(date('d/m H:i', strtotime($r['ultima']))) : '' ?></small></div>
          <span class="dp-chip <?= h($r['situacao']['cls']) ?>"><?= h($r['situacao']['txt']) ?></span></header>
        <?php if ($semMed): ?>
          <div class="dp-sem-med"><b>Medição ainda não cadastrada.</b><br>Cadastre o catálogo de atividades em Financeiro › Medição (BM) para a obra aparecer aqui com o valor medido e o avanço.<?php if (($r['contrato_cadastro'] ?? 0) > 0): ?><br>Contrato cadastrado na obra: <b><?= h(rs_p($r['contrato_cadastro'])) ?></b>.<?php endif; ?></div>
        <?php else: ?>
          <div class="dp-nums">
            <div class="grande"><small>Medido até <?= h(date('d/m', strtotime($ate))) ?></small><b><?= h(rs_p($r['medido'])) ?></b></div>
            <div class="grande"><small>Avanço medido</small><b><?= h(pc_p($r['pct'])) ?></b></div>
            <div><small>Medido neste mês</small><b><?= h(rs_p($r['no_mes'])) ?></b></div>
            <div><small>Saldo a medir</small><b><?= h(rs_p($r['saldo'])) ?></b></div>
          </div>
          <div class="dp-barras"><div><span><b>Avanço × previsto pelo prazo</b><span><?= h(pc_p($r['pct'])) ?><?= isset($r['previsto']) ? ' · previsto ' . h(pc_p($r['previsto'])) : '' ?></span></span>
            <div class="dp-trilha"><i style="width:<?= round(min(100, max(0, $r['pct'])), 1) ?>%"></i><?php if (isset($r['previsto'])): ?><em style="left:calc(<?= round($r['previsto'], 1) ?>% - 1px)" title="Previsto pelo prazo: <?= h(pc_p($r['previsto'])) ?>"></em><?php endif; ?></div></div>
            <?php if (isset($r['desvio'])): ?><div class="dp-leg"><span class="<?= $r['desvio'] < -3 ? 'dp-neg' : 'dp-pos' ?>"><?= $r['desvio'] >= 0 ? '+' : '−' ?><?= h(number_format(abs($r['desvio']), 1, ',', '.')) ?> p.p. em relação ao previsto</span></div><?php endif; ?></div>
          <?= curva_svg($r['curva'], $r['inicio'], $r['fim'], $ate) ?>
          <div class="dp-leg"><span>━ medido acumulado</span><span style="color:#667085">┅ previsto pelo prazo</span><span>┆ data de hoje</span></div>
        <?php endif; ?>
        <div class="dp-acoes"><form method="post" action="obras.php"><input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="acao" value="abrir"><input type="hidden" name="obra_id" value="<?= (int)$r['id'] ?>"><button class="btn primario">Abrir obra →</button></form></div>
      </article>
    <?php endforeach; ?>
    </div>

    <section class="dp-tabela-box">
      <h3><?= count($resumos) === 1 ? 'Resumo da obra' : 'Comparativo das obras' ?></h3><p><?= count($resumos) === 1 ? 'p.p. = pontos percentuais.' : 'Ordenado da obra que mais precisa de atenção para a que está mais confortável. p.p. = pontos percentuais.' ?></p>
      <table class="dp-tabela"><thead><tr><th>Obra</th><th>Contratado</th><th>Medido acumulado</th><th>Avanço</th><th>Previsto</th><th>Desvio</th><th>Neste mês</th><th>Saldo a medir</th><th>Fim previsto</th></tr></thead><tbody>
      <?php foreach ($ordem as $r): if ($r['sem_medicao']) { continue; } ?>
        <tr><td><b><?= h($r['nome']) ?></b><span class="dp-chip <?= h($r['situacao']['cls']) ?>" style="padding:2px 8px;font-size:.7rem"><?= h($r['situacao']['txt']) ?></span></td>
          <td><?= h(rs_p($r['contrato'])) ?></td><td><?= h(rs_p($r['medido'])) ?></td><td><b><?= h(pc_p($r['pct'])) ?></b></td><td><?= isset($r['previsto']) ? h(pc_p($r['previsto'])) : '—' ?></td>
          <td class="<?= isset($r['desvio']) && $r['desvio'] < -3 ? 'dp-neg' : 'dp-pos' ?>"><?= isset($r['desvio']) ? ($r['desvio'] >= 0 ? '+' : '−') . h(number_format(abs($r['desvio']), 1, ',', '.')) . ' p.p.' : '—' ?></td>
          <td><?= h(rs_p($r['no_mes'])) ?></td><td><?= h(rs_p($r['saldo'])) ?></td><td><?= h(dt_p($r['fim'])) ?></td></tr>
      <?php endforeach; ?></tbody>
      <tfoot><tr><td>Total</td><td><?= h(rs_p($tot['contrato'])) ?></td><td><?= h(rs_p($tot['medido'])) ?></td><td><?= h(pc_p($pctGeral)) ?></td><td></td><td></td><td><?= h(rs_p($tot['no_mes'])) ?></td><td><?= h(rs_p($tot['saldo'])) ?></td><td></td></tr></tfoot></table>
      <p class="dp-nota"><b>Como ler:</b> “medido” é o valor das atividades do catálogo da Medição (BM) já produzidas até a data (avanço de cada item × valor do item), sem descontos de equipamento, combustível ou sinal. “Previsto” é o avanço linear entre o início e o fim cadastrados da obra; o cronograma detalhado de cada obra fica dentro dela (Gantt e Planejamento). Para trocar a data de referência, use “Posição até”.</p>
    </section>
  </main>
</div>
</body></html>
