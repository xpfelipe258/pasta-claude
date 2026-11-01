<?php
// Administração do sistema › Planos e limites de obras: quantas obras cada usuário pode criar, planos mensais e anuais, assinaturas e pagamentos.
// Só o administrador do sistema. A regra só passa a valer na criação de obras quando "Exigir plano" está ligado.
require __DIR__ . '/inc/nucleo.php';
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

$eu = exigir_admin();
$msg = '';
$erro = '';

function pl_rs($v) { return 'R$ ' . number_format((float)$v, 2, ',', '.'); }
function pl_dt($d) { return $d ? date('d/m/Y', strtotime($d)) : '—'; }
function pl_num($v) { return rtrim(rtrim(number_format((float)$v, 2, ',', ''), '0'), ','); }

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    conferir_csrf();
    $acao = $_POST['acao'] ?? '';
    try {
        bd()->beginTransaction();
        if ($acao === 'config') {
            planos_config_salvar($_POST);
            registrar_global('planos_config', planos_config());
            $msg = !empty($_POST['exigir_plano']) ? 'Regra salva: a criação de obras passa a respeitar o plano de cada usuário.' : 'Regra salva: o plano NÃO é exigido (qualquer usuário autorizado cria obras, como antes).';
        } elseif ($acao === 'semear') {
            $n = planos_semear_exemplos();
            $msg = $n ? "$n planos de exemplo criados. Ajuste nomes, preços e limites ao seu modelo de venda." : 'Já existem planos cadastrados: nada foi criado.';
        } elseif ($acao === 'plano') {
            list($id, $e) = planos_salvar($_POST, (int)($_POST['id'] ?? 0));
            if ($e) { throw new InvalidArgumentException(implode(' ', $e)); }
            registrar_global('plano_salvar', ['id' => $id, 'nome' => $_POST['nome'] ?? '']);
            $msg = 'Plano salvo. Quem já assina mantém o preço e o limite contratados; a mudança vale para novas assinaturas.';
        } elseif ($acao === 'assinatura') {
            $e = assinatura_salvar($_POST);
            if ($e) { throw new InvalidArgumentException(implode(' ', $e)); }
            $msg = 'Assinatura salva.';
        } elseif ($acao === 'pagamento') {
            $e = assinatura_registrar_pagamento($_POST, $eu);
            if ($e) { throw new InvalidArgumentException(implode(' ', $e)); }
            $msg = 'Pagamento registrado e vencimento renovado.';
        } else {
            throw new InvalidArgumentException('Ação inválida.');
        }
        bd()->commit();
    } catch (InvalidArgumentException $e) {
        if (bd()->inTransaction()) { bd()->rollBack(); }
        $erro = $e->getMessage();
    } catch (Throwable $e) {
        if (bd()->inTransaction()) { bd()->rollBack(); }
        $erro = 'Falha: ' . $e->getMessage();
    }
}

$cfg = planos_config();
$planos = planos_listar();
$planosAtivos = array_values(array_filter($planos, function ($p) { return (int)$p['ativo'] === 1; }));
$ind = planos_indicadores();
$assinaturas = [];
foreach (q_global('SELECT * FROM assinaturas')->fetchAll() as $a) { $assinaturas[(int)$a['usuario_id']] = $a; }
$usuarios = q_global("SELECT id, nome, login, perfil, empresa, email, ativo FROM usuarios WHERE perfil <> 'admin' ORDER BY nome")->fetchAll();
$pagamentos = q_global('SELECT p.*, u.nome AS usuario_nome, a.plano_nome FROM assinaturas_pagamentos p JOIN assinaturas a ON a.id = p.assinatura_id JOIN usuarios u ON u.id = a.usuario_id ORDER BY p.data_pagamento DESC, p.id DESC LIMIT 8')->fetchAll();
$csrf = token_csrf();
$logoGlobal = global_ler('logo', '');
$hoje = planos_hoje();
pagina_inicio('Planos e limites de obras');
?>
<style>
.pl-shell { max-width: 1280px; margin: 0 auto; padding: 0 22px 70px; }
.pl-hero { margin: 26px 0 20px; } .pl-hero h1 { font-size: clamp(1.6rem, 3vw, 2.2rem); letter-spacing: -.02em; margin: 4px 0 6px; } .pl-hero p { margin: 0; color: #667085; max-width: 760px; }
.pl-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 14px; margin-bottom: 22px; }
.pl-kpi { background: #fff; border: 1px solid #e4e7ec; border-radius: 16px; padding: 16px 18px; box-shadow: 0 10px 28px rgba(16,24,40,.06); border-top: 4px solid var(--portal-primary, #d97706); }
.pl-kpi small { display: block; color: #667085; font-size: .74rem; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; } .pl-kpi b { display: block; font-size: 1.5rem; margin: 6px 0 2px; letter-spacing: -.02em; } .pl-kpi span { color: #667085; font-size: .82rem; }
.pl-kpi.verde { border-top-color: #12b76a } .pl-kpi.vermelho { border-top-color: #d92d20 } .pl-kpi.azul { border-top-color: #2e90fa }
.pl-caixa { background: #fff; border: 1px solid #e4e7ec; border-radius: 18px; padding: 20px 22px; box-shadow: 0 14px 34px rgba(16,24,40,.06); margin-bottom: 22px; overflow-x: auto; }
.pl-caixa h2 { margin: 0 0 4px; font-size: 1.15rem; } .pl-caixa > p { margin: 0 0 14px; color: #667085; font-size: .88rem; max-width: 880px; }
.pl-cab { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 8px; }
.pl-form { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 12px 16px; align-items: end; }
.pl-form label { display: flex; flex-direction: column; gap: 4px; font-size: .76rem; font-weight: 700; color: #667085; text-transform: uppercase; letter-spacing: .04em; }
.pl-form input, .pl-form select, .pl-dlg input, .pl-dlg select, .pl-dlg textarea { padding: 10px 12px; border: 1px solid #e4e7ec; border-radius: 10px; font: inherit; background: #fff; text-transform: none; letter-spacing: 0; font-weight: 400; color: #182230; }
.pl-form .pl-check { flex-direction: row; align-items: center; gap: 10px; text-transform: none; letter-spacing: 0; font-size: .92rem; color: #182230; font-weight: 600; grid-column: 1 / -1; }
.pl-form .pl-check input { width: 20px; height: 20px; padding: 0; }
.pl-tab { width: 100%; border-collapse: collapse; font-size: .9rem; min-width: 900px; }
.pl-tab th { text-align: left; font-size: .72rem; text-transform: uppercase; letter-spacing: .04em; color: #667085; padding: 8px 10px; border-bottom: 2px solid #e4e7ec; white-space: nowrap; }
.pl-tab td { padding: 11px 10px; border-bottom: 1px solid #f0f2f5; vertical-align: middle; } .pl-tab td.n, .pl-tab th.n { text-align: right; white-space: nowrap; } .pl-tab small { color: #667085; display: block; }
.pl-chip { display: inline-block; padding: 4px 10px; border-radius: 99px; font-size: .74rem; font-weight: 800; white-space: nowrap; }
.pl-chip.verde { background: #d1fadf; color: #05603a } .pl-chip.azul { background: #d1e9ff; color: #175cd3 } .pl-chip.amarelo { background: #fef0c7; color: #93370d } .pl-chip.vermelho { background: #fee4e2; color: #b42318 } .pl-chip.cinza { background: #eaecf0; color: #475467 }
.pl-uso { display: inline-flex; align-items: center; gap: 8px; } .pl-uso i { display: block; width: 70px; height: 8px; border-radius: 5px; background: #eef0f4; overflow: hidden; } .pl-uso i b { display: block; height: 100%; background: var(--portal-primary, #d97706); } .pl-uso.cheio i b { background: #d92d20; }
.pl-acoes { display: flex; gap: 6px; justify-content: flex-end; flex-wrap: wrap; } .pl-acoes .btn { padding: 6px 12px; font-size: .8rem; min-height: 0; }
.pl-nota { margin-top: 12px; color: #667085; font-size: .82rem; line-height: 1.55; }
.pl-dlg { border: 0; border-radius: 18px; padding: 24px; width: min(620px, calc(100vw - 24px)); box-shadow: 0 30px 80px rgba(16,24,40,.3); }
.pl-dlg::backdrop { background: rgba(16,24,40,.5); } .pl-dlg h3 { margin: 0 0 14px; } .pl-dlg .pl-form { margin-bottom: 14px; } .pl-dlg textarea { min-height: 60px; }
.pl-fim { display: flex; gap: 10px; justify-content: flex-end; flex-wrap: wrap; }
.pl-toast { padding: 12px 16px; border-radius: 12px; margin-bottom: 16px; font-weight: 600; } .pl-toast.ok { background: #d1fadf; color: #05603a } .pl-toast.erro { background: #fee4e2; color: #b42318 }
@media (max-width: 700px) { .pl-shell { padding: 0 14px 50px; } }
</style>
<div class="portal-shell">
  <header class="portal-topo">
    <div class="portal-brand">
      <?php if ($logoGlobal): ?><img src="<?= h($logoGlobal) ?>" alt="Logo"><?php else: ?><span class="brand-mark">NO</span><?php endif; ?>
      <div><strong><?= h(global_ler('nome_sistema', 'Núcleo de Obras')) ?></strong><small>Administração do sistema</small></div>
    </div>
    <div class="portal-user"><span>Olá, <?= h($eu['nome']) ?></span><a class="btn ghost" href="obras.php?lista=1">Central de obras</a><a class="btn ghost" href="sair.php">Sair</a></div>
  </header>
  <main class="pl-shell">
    <section class="pl-hero"><span class="eyebrow">COMERCIALIZAÇÃO</span><h1>Planos e limites de obras</h1>
      <p>Defina quantas obras cada usuário pode criar e quanto ele paga por isso. A regra vale na criação de obras novas; as obras já criadas continuam funcionando mesmo se a assinatura vencer.</p></section>
    <?php if ($msg): ?><div class="pl-toast ok"><?= h($msg) ?></div><?php endif; ?>
    <?php if ($erro): ?><div class="pl-toast erro"><?= h($erro) ?></div><?php endif; ?>

    <section class="pl-kpis">
      <div class="pl-kpi verde"><small>Receita mensal recorrente</small><b><?= h(pl_rs($ind['mrr'])) ?></b><span>planos anuais ÷ 12 · só assinaturas pagas</span></div>
      <div class="pl-kpi"><small>Receita anual projetada</small><b><?= h(pl_rs($ind['arr'])) ?></b><span><?= (int)$ind['assinantes'] ?> assinante(s) ativo(s)</span></div>
      <div class="pl-kpi azul"><small>Recebido neste mês</small><b><?= h(pl_rs($ind['recebido_mes'])) ?></b><span><?= (int)$ind['teste'] ?> em período de teste</span></div>
      <div class="pl-kpi <?= $ind['inadimplentes'] ? 'vermelho' : '' ?>"><small>Vencidas</small><b><?= (int)$ind['inadimplentes'] ?></b><span><?= (int)$ind['a_vencer'] ?> vencem em até 7 dias</span></div>
      <div class="pl-kpi"><small>Obras criadas / vagas</small><b><?= (int)$ind['obras_em_uso'] ?></b><span>de <?= (int)$ind['vagas'] ?> vagas contratadas (ilimitado não conta)</span></div>
    </section>

    <section class="pl-caixa">
      <h2>Regra de criação de obras</h2>
      <p>Com “Exigir plano” desligado nada muda: todo usuário autorizado cria obras sem limite (como hoje). Ligado, cada usuário só cria obra enquanto tiver vaga no plano e a assinatura estiver em dia. O administrador do sistema nunca é limitado.</p>
      <form method="post" class="pl-form"><input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="acao" value="config">
        <label class="pl-check"><input type="checkbox" name="exigir_plano" value="1" <?= $cfg['exigir_plano'] ? 'checked' : '' ?>> Exigir plano para criar obras</label>
        <label>Obras de quem não tem plano<input type="number" name="limite_sem_plano" min="0" max="1000" value="<?= (int)$cfg['limite_sem_plano'] ?>"></label>
        <label>Tolerância após o vencimento (dias)<input type="number" name="tolerancia_dias" min="0" max="60" value="<?= (int)$cfg['tolerancia_dias'] ?>"></label>
        <label>Dias do período de teste<input type="number" name="dias_teste" min="1" max="90" value="<?= (int)$cfg['dias_teste'] ?>"></label>
        <div><button class="btn primario">Salvar regra</button></div>
      </form>
    </section>

    <section class="pl-caixa">
      <div class="pl-cab"><div><h2>Planos</h2><p style="margin:0">Cada plano tem ciclo (mensal ou anual), preço por ciclo e o limite de obras que o usuário pode criar (0 = ilimitado).</p></div>
        <div class="pl-acoes"><?php if (!$planos): ?><form method="post"><input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="acao" value="semear"><button class="btn">Criar planos de exemplo</button></form><?php endif; ?><button class="btn primario" data-plano="0">+ Novo plano</button></div></div>
      <?php if ($planos): ?><table class="pl-tab"><thead><tr><th>Plano</th><th>Ciclo</th><th class="n">Preço</th><th class="n">Equivale a (mês)</th><th class="n">Obras</th><th>Situação</th><th class="n">Assinantes</th><th></th></tr></thead><tbody>
        <?php foreach ($planos as $pl): $nAss = (int)q_global('SELECT COUNT(*) FROM assinaturas WHERE plano_id = ?', [(int)$pl['id']])->fetchColumn(); ?>
        <tr><td><b><?= h($pl['nome']) ?></b><?php if ($pl['obs']): ?><small><?= h($pl['obs']) ?></small><?php endif; ?></td><td><?= h(planos_ciclos()[$pl['ciclo']] ?? $pl['ciclo']) ?></td>
          <td class="n"><b><?= h(pl_rs($pl['preco'])) ?></b></td><td class="n"><?= h(pl_rs($pl['ciclo'] === 'ANUAL' ? $pl['preco'] / 12 : $pl['preco'])) ?></td>
          <td class="n"><?= (int)$pl['max_obras'] === 0 ? 'ilimitadas' : (int)$pl['max_obras'] ?></td><td><span class="pl-chip <?= $pl['ativo'] ? 'verde' : 'cinza' ?>"><?= $pl['ativo'] ? 'Ativo' : 'Inativo' ?></span></td><td class="n"><?= $nAss ?></td>
          <td><div class="pl-acoes"><button class="btn" data-plano="<?= (int)$pl['id'] ?>" data-d='<?= h(json_encode(['nome' => $pl['nome'], 'ciclo' => $pl['ciclo'], 'preco' => pl_num($pl['preco']), 'max_obras' => (int)$pl['max_obras'], 'obs' => $pl['obs'], 'ativo' => (int)$pl['ativo']], JSON_UNESCAPED_UNICODE)) ?>'>Editar</button></div></td></tr>
        <?php endforeach; ?></tbody></table>
      <?php else: ?><p class="pl-nota">Nenhum plano cadastrado. Crie os seus ou use “Criar planos de exemplo” e ajuste preços e limites.</p><?php endif; ?>
    </section>

    <section class="pl-caixa">
      <h2>Usuários e assinaturas</h2>
      <p>Obras usadas = obras que o usuário criou e administra (ativas ou em importação; arquivada não conta). Plano anual: pague uma vez por ano e o vencimento avança 12 meses. “Registrar pagamento” renova o vencimento sozinho.</p>
      <?php if ($usuarios): ?><table class="pl-tab"><thead><tr><th>Usuário</th><th>Plano</th><th class="n">Valor</th><th>Obras usadas</th><th>Vencimento</th><th>Situação</th><th></th></tr></thead><tbody>
        <?php foreach ($usuarios as $u):
            $a = $assinaturas[(int)$u['id']] ?? null; $s = assinatura_situacao($a, $cfg); $lim = assinatura_limite($a, $cfg); $usadas = planos_obras_em_uso($u['id']);
            $ilimitado = $a && $lim === 0; $pct = ($lim > 0) ? min(100, $usadas / $lim * 100) : 0;
            $dadosA = $a ? ['usuario_id' => (int)$u['id'], 'nome' => $u['nome'], 'plano_id' => (int)$a['plano_id'], 'status' => $a['status'], 'inicio' => $a['inicio'], 'vencimento' => $a['vencimento'], 'preco' => pl_num($a['preco']), 'obras_extra' => (int)$a['obras_extra'], 'obs' => $a['obs'], 'id' => (int)$a['id'], 'ciclo' => $a['ciclo']]
                : ['usuario_id' => (int)$u['id'], 'nome' => $u['nome'], 'plano_id' => 0, 'status' => 'ATIVA', 'inicio' => $hoje, 'vencimento' => planos_somar_ciclo($hoje, 'MENSAL'), 'preco' => '', 'obras_extra' => 0, 'obs' => '', 'id' => 0, 'ciclo' => 'MENSAL']; ?>
        <tr><td><b><?= h($u['nome']) ?></b><small><?= h($u['login']) ?><?= $u['empresa'] ? ' · ' . h($u['empresa']) : '' ?><?= !$u['ativo'] ? ' · INATIVO' : '' ?></small></td>
          <td><?= $a ? '<b>' . h($a['plano_nome']) . '</b><small>' . h(planos_ciclos()[$a['ciclo']] ?? '') . ($a['obras_extra'] ? ' · +' . (int)$a['obras_extra'] . ' obra(s) extra' : '') . '</small>' : '<span class="pl-chip cinza">Sem plano</span>' ?></td>
          <td class="n"><?= $a ? h(pl_rs($a['preco'])) . '<small>/' . ($a['ciclo'] === 'ANUAL' ? 'ano' : 'mês') . '</small>' : '—' ?></td>
          <td><span class="pl-uso <?= $lim > 0 && $usadas >= $lim ? 'cheio' : '' ?>"><b><?= (int)$usadas ?></b> de <?= $a ? ($ilimitado ? '∞' : (int)$lim) : ($cfg['exigir_plano'] ? (int)$cfg['limite_sem_plano'] : '∞') ?><?php if ($lim > 0): ?><i><b style="width:<?= (int)$pct ?>%"></b></i><?php endif; ?></span></td>
          <td><?= $a ? h(pl_dt($a['vencimento'])) : '—' ?><?php if ($a && $s['dias'] !== null): ?><small><?= $s['dias'] >= 0 ? 'em ' . $s['dias'] . ' dia(s)' : 'há ' . (-$s['dias']) . ' dia(s)' ?></small><?php endif; ?></td>
          <td><span class="pl-chip <?= h($s['cls']) ?>"><?= h($s['rotulo']) ?></span></td>
          <td><div class="pl-acoes">
            <?php if ($a): ?><button class="btn primario" data-pagto="<?= (int)$a['id'] ?>" data-d='<?= h(json_encode(['nome' => $u['nome'], 'plano' => $a['plano_nome'], 'valor' => pl_num($a['preco']), 'ciclo' => $a['ciclo']], JSON_UNESCAPED_UNICODE)) ?>'>Registrar pagamento</button><?php endif; ?>
            <button class="btn" data-assin='<?= h(json_encode($dadosA, JSON_UNESCAPED_UNICODE)) ?>'><?= $a ? 'Editar' : 'Definir plano' ?></button>
          </div></td></tr>
        <?php endforeach; ?></tbody></table>
      <?php else: ?><p class="pl-nota">Ainda não há usuários além do administrador.</p><?php endif; ?>
    </section>

    <section class="pl-caixa">
      <h2>Últimos pagamentos</h2>
      <?php if ($pagamentos): ?><table class="pl-tab" style="min-width:0"><thead><tr><th>Data</th><th>Usuário</th><th>Plano</th><th class="n">Valor</th><th>Pago até</th><th>Forma</th><th>Registrado por</th></tr></thead><tbody>
        <?php foreach ($pagamentos as $pg): ?><tr><td><?= h(pl_dt($pg['data_pagamento'])) ?></td><td><?= h($pg['usuario_nome']) ?></td><td><?= h($pg['plano_nome']) ?></td><td class="n"><b><?= h(pl_rs($pg['valor'])) ?></b></td><td><?= h(pl_dt($pg['periodo_ate'])) ?></td><td><?= h($pg['forma'] ?: '—') ?></td><td><?= h($pg['por']) ?></td></tr><?php endforeach; ?></tbody></table>
      <?php else: ?><p class="pl-nota">Nenhum pagamento registrado ainda.</p><?php endif; ?>
      <p class="pl-nota">Este painel controla limites e cobrança manualmente (você registra o que recebeu). Cobrança automática por cartão/boleto exige integração com um gateway de pagamento — fica como próxima etapa.</p>
    </section>
  </main>
</div>

<dialog class="pl-dlg" id="dlgPlano"><form method="post"><input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="acao" value="plano"><input type="hidden" name="id" value="0">
  <h3 id="dlgPlanoTit">Novo plano</h3>
  <div class="pl-form"><label>Nome do plano<input name="nome" maxlength="80" required></label>
    <label>Ciclo de cobrança<select name="ciclo"><option value="MENSAL">Mensal</option><option value="ANUAL">Anual</option></select></label>
    <label>Preço por ciclo (R$)<input name="preco" inputmode="decimal" placeholder="0,00" required></label>
    <label>Obras que pode criar (0 = ilimitado)<input name="max_obras" type="number" min="0" max="10000" value="1" required></label>
    <label style="grid-column:1/-1">Descrição<input name="obs" maxlength="255"></label>
    <label class="pl-check"><input type="checkbox" name="ativo" value="1" checked> Plano ativo (aparece para novas assinaturas)</label></div>
  <div class="pl-fim"><button type="button" class="btn" data-fechar>Cancelar</button><button class="btn primario">Salvar plano</button></div></form></dialog>

<dialog class="pl-dlg" id="dlgAssin"><form method="post"><input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="acao" value="assinatura"><input type="hidden" name="usuario_id" value="0">
  <h3 id="dlgAssinTit">Assinatura</h3>
  <div class="pl-form"><label>Plano<select name="plano_id" required><option value="">Escolha…</option><?php foreach ($planosAtivos as $pl): ?><option value="<?= (int)$pl['id'] ?>" data-preco="<?= h(pl_num($pl['preco'])) ?>"><?= h($pl['nome']) ?> — <?= h(pl_rs($pl['preco'])) ?>/<?= $pl['ciclo'] === 'ANUAL' ? 'ano' : 'mês' ?> · <?= (int)$pl['max_obras'] === 0 ? 'ilimitadas' : (int)$pl['max_obras'] . ' obra(s)' ?></option><?php endforeach; ?></select></label>
    <label>Situação<select name="status"><?php foreach (planos_status_lista() as $k => $r): ?><option value="<?= h($k) ?>"><?= h($r) ?></option><?php endforeach; ?></select></label>
    <label>Valor cobrado por ciclo (R$)<input name="preco" inputmode="decimal" placeholder="vazio = preço do plano"></label>
    <label>Obras extras contratadas<input name="obras_extra" type="number" min="0" max="1000" value="0"></label>
    <label>Início<input name="inicio" type="date" required></label>
    <label>Vencimento (fim do período pago)<input name="vencimento" type="date" required></label>
    <label style="grid-column:1/-1">Observações<textarea name="obs"></textarea></label></div>
  <div class="pl-fim"><button type="button" class="btn" data-fechar>Cancelar</button><button class="btn primario">Salvar assinatura</button></div></form></dialog>

<dialog class="pl-dlg" id="dlgPagto"><form method="post"><input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="acao" value="pagamento"><input type="hidden" name="assinatura_id" value="0">
  <h3 id="dlgPagtoTit">Registrar pagamento</h3><p class="pl-nota" id="dlgPagtoNota" style="margin-top:0"></p>
  <div class="pl-form"><label>Data do pagamento<input name="data_pagamento" type="date" required max="<?= h($hoje) ?>"></label>
    <label>Valor recebido (R$)<input name="valor" inputmode="decimal" required></label>
    <label>Forma<input name="forma" maxlength="30" placeholder="Pix, boleto, cartão…"></label>
    <label>Observação<input name="obs" maxlength="255"></label></div>
  <div class="pl-fim"><button type="button" class="btn" data-fechar>Cancelar</button><button class="btn primario">Registrar e renovar</button></div></form></dialog>
<script>
(function () {
  var $ = function (s) { return document.querySelector(s); };
  document.querySelectorAll('[data-fechar]').forEach(function (b) { b.addEventListener('click', function () { b.closest('dialog').close(); }); });
  document.querySelectorAll('[data-plano]').forEach(function (b) { b.addEventListener('click', function () {
    var d = b.dataset.d ? JSON.parse(b.dataset.d) : { nome: '', ciclo: 'MENSAL', preco: '', max_obras: 1, obs: '', ativo: 1 }, f = $('#dlgPlano form');
    $('#dlgPlanoTit').textContent = b.dataset.plano === '0' ? 'Novo plano' : 'Editar plano';
    f.id.value = b.dataset.plano; f.nome.value = d.nome; f.ciclo.value = d.ciclo; f.preco.value = d.preco; f.max_obras.value = d.max_obras; f.obs.value = d.obs || ''; f.ativo.checked = !!d.ativo;
    $('#dlgPlano').showModal(); }); });
  document.querySelectorAll('[data-assin]').forEach(function (b) { b.addEventListener('click', function () {
    var d = JSON.parse(b.dataset.assin), f = $('#dlgAssin form');
    $('#dlgAssinTit').textContent = 'Assinatura — ' + d.nome;
    f.usuario_id.value = d.usuario_id; f.plano_id.value = d.plano_id || ''; f.status.value = d.status; f.preco.value = d.preco; f.obras_extra.value = d.obras_extra; f.inicio.value = d.inicio; f.vencimento.value = d.vencimento; f.obs.value = d.obs || '';
    $('#dlgAssin').showModal(); }); });
  document.querySelectorAll('[data-pagto]').forEach(function (b) { b.addEventListener('click', function () {
    var d = JSON.parse(b.dataset.d), f = $('#dlgPagto form');
    $('#dlgPagtoTit').textContent = 'Registrar pagamento — ' + d.nome;
    $('#dlgPagtoNota').textContent = 'Plano ' + d.plano + ' (' + (d.ciclo === 'ANUAL' ? 'anual' : 'mensal') + '). O vencimento avança ' + (d.ciclo === 'ANUAL' ? '12 meses' : '1 mês') + '.';
    f.assinatura_id.value = b.dataset.pagto; f.valor.value = d.valor; f.data_pagamento.value = '<?= h($hoje) ?>';
    $('#dlgPagto').showModal(); }); });
  var planoSel = document.querySelector('#dlgAssin [name=plano_id]');
  if (planoSel) planoSel.addEventListener('change', function () { var o = planoSel.selectedOptions[0], p = document.querySelector('#dlgAssin [name=preco]'); if (o && o.dataset.preco && !p.value) p.placeholder = o.dataset.preco + ' (preço do plano)'; });
})();
</script>
</body></html>
