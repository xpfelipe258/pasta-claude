<?php
// Painel administrativo da EMPRESA ASSINANTE: o plano contratado, o informativo de pagamento, o uso de obras e usuários (com os extras contratados),
// as áreas liberadas e as regras e limitações da contratação. É só informação (somente leitura): quem altera plano, extras e pagamentos é o
// administrador da plataforma (sistema.php / admin_planos.php). O administrador da empresa vê a própria; o administrador do sistema abre qualquer uma por ?org=ID.
require __DIR__ . '/inc/nucleo.php';
require __DIR__ . '/inc/modelo.php';
require __DIR__ . '/inc/central.php';
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

$eu = central_exigir();
$sistema = ($eu['perfil'] ?? '') === 'admin';
list($meuOrg, $admOrg) = usuario_organizacao_id($eu);
if (!$sistema && !$admOrg) { http_response_code(403); exit('O painel do plano é do administrador da empresa.'); }
$orgId = $sistema ? (int)($_GET['org'] ?? 0) : $meuOrg;
$o = $orgId ? organizacao_ler($orgId) : null;
if ($sistema && !$o) { header('Location: sistema.php?v=empresas'); exit; }
if (!$o) { http_response_code(404); exit('Empresa não encontrada.'); }

$cfg = planos_config();
$sit = organizacao_situacao($o, $cfg);
$hoje = planos_hoje();
$ciclo = planos_ciclos()[$o['ciclo']] ?? $o['ciclo'];
$precoPlano = $o['ciclo'] === 'ANUAL' ? (float)$o['plano_preco_anual'] : (float)$o['plano_preco_mensal'];
$valor = (float)$o['preco'] > 0 ? (float)$o['preco'] : $precoPlano;
$obrasUso = organizacao_obras_em_uso($orgId);
$usuUso = organizacao_usuarios_em_uso($orgId);
$obrasBase = (int)$o['plano_max_obras']; $obrasExtra = max(0, (int)$o['obras_extra']); $obrasLim = organizacao_limite_obras($o);
$usuBase = (int)$o['plano_max_usuarios']; $usuExtra = max(0, (int)$o['usuarios_extra']); $usuLim = organizacao_limite_usuarios($o);
$areas = plano_modulos(['modulos' => $o['plano_modulos']]);
$rotAreas = planos_modulos_rotulos();
$itens = array_values(array_filter(array_map('trim', preg_split('/\R/u', (string)$o['plano_itens']))));
$pagamentos = q_global('SELECT * FROM organizacoes_pagamentos WHERE organizacao_id = ? ORDER BY data_pagamento DESC, id DESC', [$orgId])->fetchAll();
$totalPago = 0.0; foreach ($pagamentos as $pg) { $totalPago += (float)$pg['valor']; }
$planosTodos = planos_listar(true);
$cls = ['verde' => 'verde', 'amarelo' => 'amarelo', 'vermelho' => 'verm', 'azul' => 'azul', 'cinza' => ''][$sit['cls']] ?? '';
$barra = function ($uso, $lim) {
    if ($lim === 0) { return '<div class="pl-barra"><i style="width:8%"></i></div>'; }
    $p = max(0, min(100, $lim > 0 ? $uso / $lim * 100 : 0));
    return '<div class="pl-barra' . ($p >= 100 ? ' cheia' : ($p >= 80 ? ' alerta' : '')) . '"><i style="width:' . round($p) . '%"></i></div>';
};
central_topo('Painel administrativo — plano', 'plano', $eu, 'Painel administrativo da empresa');
?>
<main class="ce-main">
  <section class="ce-hero"><div><span class="ce-eyebrow">PAINEL ADMINISTRATIVO · <?= h(mb_strtoupper($o['nome'], 'UTF-8')) ?></span><h1>Seu plano e a sua contratação</h1>
    <p>O que a sua empresa contratou, quanto já usou, o que está incluído, o que o plano limita e o histórico de pagamentos. É só informação: a alteração do plano, de obras e usuários extras é feita pelo administrador da plataforma.</p></div>
    <?php if ($sistema): ?><a class="btn ghost" href="sistema.php?v=empresas">← Empresas clientes</a><?php endif; ?></section>

  <?php if (!$sit['pode_criar'] && in_array($sit['codigo'], ['VENCIDA', 'SUSPENSA', 'CANCELADA', 'SEM_PLANO'], true)): ?>
  <div class="toast erro-form"><b>Atenção: assinatura <?= h(mb_strtolower($sit['rotulo'], 'UTF-8')) ?>.</b> Enquanto isso, a empresa não cria obras nem usuários novos; o que já existe continua funcionando. Fale com o administrador da plataforma para regularizar.</div>
  <?php elseif ($sit['codigo'] === 'A_VENCER' || $sit['codigo'] === 'TOLERANCIA'): ?>
  <div class="toast erro-form" style="background:#fffaeb;border-color:#fedf89;color:#b54708"><b><?= h($sit['rotulo']) ?>.</b> O próximo vencimento é <?= h(central_dt($o['vencimento'])) ?>. Registre o pagamento com o administrador da plataforma para manter tudo liberado.</div>
  <?php endif; ?>

  <section class="ce-bloco"><h2>Plano contratado</h2>
    <div class="ce-grid">
      <div class="ce-num"><small>Plano</small><b><?= h($o['plano_nome'] ?: 'Sem plano') ?></b><span><?= $o['plano_nivel'] ? 'Nível ' . (int)$o['plano_nivel'] . ' · ' : '' ?>cobrança <?= h(mb_strtolower($ciclo, 'UTF-8')) ?></span></div>
      <div class="ce-num"><small>Valor cobrado</small><b><?= h(central_rs($valor)) ?></b><span>por ciclo <?= h(mb_strtolower($ciclo, 'UTF-8')) ?><?= (float)$o['preco'] > 0 && abs((float)$o['preco'] - $precoPlano) > 0.004 ? ' · valor negociado (tabela: ' . h(central_rs($precoPlano)) . ')' : '' ?></span></div>
      <div class="ce-num"><small>Situação</small><b><span class="ce-tag <?= $cls ?>" style="font-size:1rem"><?= h($sit['rotulo']) ?></span></b><span><?= $o['status'] === 'TESTE' ? 'período de teste' : 'assinatura' ?></span></div>
      <div class="ce-num"><small>Próximo vencimento</small><b><?= h(central_dt($o['vencimento'])) ?></b><span><?= $sit['dias'] === null ? 'sem data' : ($sit['dias'] < 0 ? 'venceu há ' . abs($sit['dias']) . ' dia(s)' : ($sit['dias'] === 0 ? 'vence hoje' : 'faltam ' . $sit['dias'] . ' dia(s)')) ?></span></div>
      <div class="ce-num"><small>Total pago até hoje</small><b><?= h(central_rs($totalPago)) ?></b><span><?= count($pagamentos) ?> pagamento(s) registrado(s)</span></div>
    </div></section>

  <section class="ce-bloco"><h2>Uso do plano — obras e usuários</h2>
    <p>O limite de cada item é o que o plano inclui mais o que foi contratado como extra. Obras arquivadas e as cópias de obra criadas para cada empresa terceirizada não contam.</p>
    <div class="pl-uso">
      <div class="pl-uso-item"><h3>Obras</h3><div class="pl-uso-num"><b><?= (int)$obrasUso ?></b> de <b><?= $obrasLim === 0 ? 'ilimitadas' : (int)$obrasLim ?></b></div><?= $barra($obrasUso, $obrasLim) ?>
        <table class="ce-tab pl-mini"><tbody>
          <tr><td>Incluídas no plano</td><td class="d"><?= $obrasBase === 0 ? 'ilimitadas' : $obrasBase ?></td></tr>
          <tr><td>Obras extras contratadas</td><td class="d"><?= $obrasBase === 0 ? '—' : '+ ' . $obrasExtra ?></td></tr>
          <tr><td><b>Limite total</b></td><td class="d"><b><?= $obrasLim === 0 ? 'ilimitado' : $obrasLim ?></b></td></tr>
          <tr><td>Vagas livres</td><td class="d"><?= $obrasLim === 0 ? 'sem limite' : max(0, $obrasLim - $obrasUso) ?></td></tr></tbody></table></div>
      <div class="pl-uso-item"><h3>Usuários</h3><div class="pl-uso-num"><b><?= (int)$usuUso ?></b> de <b><?= $usuLim === 0 ? 'ilimitados' : (int)$usuLim ?></b></div><?= $barra($usuUso, $usuLim) ?>
        <table class="ce-tab pl-mini"><tbody>
          <tr><td>Incluídos no plano</td><td class="d"><?= $usuBase === 0 ? 'ilimitados' : $usuBase ?></td></tr>
          <tr><td>Usuários extras contratados</td><td class="d"><?= $usuBase === 0 ? '—' : '+ ' . $usuExtra ?></td></tr>
          <tr><td><b>Limite total</b></td><td class="d"><b><?= $usuLim === 0 ? 'ilimitado' : $usuLim ?></b></td></tr>
          <tr><td>Vagas livres</td><td class="d"><?= $usuLim === 0 ? 'sem limite' : max(0, $usuLim - $usuUso) ?></td></tr></tbody></table></div>
    </div>
    <p style="margin-top:14px"><b>Como incluir obras ou usuários extras:</b> peça ao administrador da plataforma. Assim que ele registrar a contratação, o limite acima sobe na hora e nada precisa ser instalado. Desativar um usuário libera a vaga dele; arquivar uma obra libera a vaga da obra.
      <?php if ($admOrg && !$sistema): ?> Para cadastrar ou desativar usuários, use <a href="empresa_usuarios.php">Configurações › Usuários da empresa</a>.<?php endif; ?></p></section>

  <section class="ce-bloco"><h2>O que o plano inclui</h2>
    <div class="pl-cols">
      <div><h3>Áreas do sistema</h3><p style="margin:0 0 8px">Cada usuário da empresa só vê as áreas liberadas pelo plano (e que o administrador da empresa liberou para ele).</p>
        <div class="pl-areas"><?php foreach ($rotAreas as $cod => $rot): $tem = in_array($cod, $areas, true); ?><span class="ce-tag <?= $tem ? 'verde' : '' ?>" title="<?= $tem ? 'Incluída no plano' : 'Fora do plano' ?>"><?= $tem ? '✔' : '✕' ?> <?= h($rot) ?></span><?php endforeach; ?></div></div>
      <div><h3>Itens do plano</h3><?php if ($itens): ?><ul class="pl-itens"><?php foreach ($itens as $it): ?><li><?= h($it) ?></li><?php endforeach; ?></ul>
        <?php else: ?><p style="margin:0;color:#667085">O administrador da plataforma ainda não descreveu os itens deste plano.</p><?php endif; ?></div>
    </div></section>

  <section class="ce-bloco"><h2>Regras e limitações da contratação</h2>
    <ul class="pl-regras">
      <li><b>Limite de obras e de usuários:</b> a empresa não cria obras nem usuários novos além do limite total acima. As obras e usuários existentes não são apagados.</li>
      <li><b>Assinatura vencida, suspensa ou cancelada:</b> a empresa passa a não criar obras nem usuários novos; o que já existe continua abrindo normalmente. A tolerância depois do vencimento é de <b><?= (int)$cfg['tolerancia_dias'] ?> dia(s)</b>.</li>
      <li><b>Quem cria obras e usuários:</b> os administradores da empresa. Usuário comum da empresa trabalha nas obras que recebeu, mas não cria obras nem cadastra usuários. Quem cria uma obra passa a ser o administrador dela.</li>
      <li><b>Áreas liberadas:</b> só as áreas do plano aparecem no menu e na API para os usuários da empresa; para liberar outra área é preciso mudar de plano.</li>
      <li><b>Regra do plano <?= $cfg['exigir_plano'] ? 'ativa' : 'em modo livre' ?>:</b> <?= $cfg['exigir_plano'] ? 'os limites acima estão sendo aplicados.' : 'os limites estão registrados, mas a plataforma ainda não os bloqueia; eles valem quando o administrador ativar a regra.' ?></li>
      <li><b>Dados e relatórios:</b> as obras da empresa ficam separadas das de outras empresas; logo, cor e rodapé dos relatórios oficiais são os da sua empresa (Configurações).</li>
      <li><b>Cobrança:</b> manual. O administrador da plataforma registra cada pagamento recebido e o vencimento é renovado por <?= h(mb_strtolower($ciclo === 'Anual' ? '12 meses' : '1 mês', 'UTF-8')) ?>.</li>
    </ul></section>

  <section class="ce-bloco"><h2>Informativo de pagamento</h2>
    <div class="ce-grid">
      <div class="ce-num"><small>Próximo pagamento</small><b><?= h(central_rs($valor)) ?></b><span>até <?= h(central_dt($o['vencimento'])) ?></span></div>
      <div class="ce-num"><small>Último pagamento</small><b><?= $pagamentos ? h(central_dt($pagamentos[0]['data_pagamento'])) : '—' ?></b><span><?= $pagamentos ? h(central_rs($pagamentos[0]['valor'])) : 'nenhum registrado' ?></span></div>
      <div class="ce-num"><small>Pago até</small><b><?= $pagamentos ? h(central_dt($pagamentos[0]['periodo_ate'])) : h(central_dt($o['vencimento'])) ?></b><span>cobertura do último pagamento</span></div>
    </div>
    <?php if (!$pagamentos): ?><div class="ce-vazio">Nenhum pagamento registrado ainda<?= $o['status'] === 'TESTE' ? ' (a empresa está em período de teste)' : '' ?>.</div>
    <?php else: ?><table class="ce-tab"><thead><tr><th>Data do pagamento</th><th class="d">Valor</th><th>Coberto até</th><th>Forma</th><th>Observação</th><th>Registrado por</th></tr></thead><tbody>
      <?php foreach ($pagamentos as $pg): ?><tr><td><?= h(central_dt($pg['data_pagamento'])) ?></td><td class="d"><b><?= h(central_rs($pg['valor'])) ?></b></td><td><?= h(central_dt($pg['periodo_ate'])) ?></td><td><?= h($pg['forma'] ?: '—') ?></td><td><?= h($pg['obs'] ?: '—') ?></td><td><small><?= h($pg['por']) ?><br><?= h(central_dt(substr((string)$pg['em'], 0, 10))) ?></small></td></tr><?php endforeach; ?>
      <tr><td><b>Total</b></td><td class="d"><b><?= h(central_rs($totalPago)) ?></b></td><td colspan="4"></td></tr></tbody></table><?php endif; ?></section>

  <section class="ce-bloco"><h2>Dados da contratação</h2>
    <table class="ce-tab pl-mini"><tbody>
      <tr><td>Empresa</td><td><b><?= h($o['nome']) ?></b><?= $o['documento'] ? ' · ' . h($o['documento']) : '' ?></td></tr>
      <tr><td>Contato cadastrado</td><td><?= h(trim(($o['contato'] ?: '') . ($o['email'] ? ' · ' . $o['email'] : '') . ($o['telefone'] ? ' · ' . $o['telefone'] : ''), ' ·') ?: '—') ?></td></tr>
      <tr><td>Início da assinatura</td><td><?= h(central_dt($o['inicio'])) ?></td></tr>
      <tr><td>Ciclo de cobrança</td><td><?= h($ciclo) ?></td></tr>
      <tr><td>Preço de tabela do plano</td><td><?= h(central_rs($o['plano_preco_mensal'])) ?> por mês · <?= h(central_rs($o['plano_preco_anual'])) ?> por ano</td></tr>
      <tr><td>Valor cobrado desta empresa</td><td><?= h(central_rs($valor)) ?> por ciclo <?= h(mb_strtolower($ciclo, 'UTF-8')) ?></td></tr>
      <?php if (trim((string)$o['obs']) !== '' && $sistema): ?><tr><td>Observações (internas)</td><td><?= h($o['obs']) ?></td></tr><?php endif; ?></tbody></table></section>

  <?php if ($planosTodos): ?>
  <section class="ce-bloco"><h2>Comparativo dos planos</h2>
    <p>Para saber o que muda se a empresa precisar de mais obras, usuários ou áreas, fale com o administrador da plataforma.</p>
    <table class="ce-tab"><thead><tr><th>Plano</th><th class="d">Por mês</th><th class="d">Por ano</th><th class="d">Obras</th><th class="d">Usuários</th><th>Áreas</th></tr></thead><tbody>
      <?php foreach ($planosTodos as $pl): $meu = (int)$pl['id'] === (int)$o['plano_id']; $am = plano_modulos(['modulos' => $pl['modulos']]); ?>
      <tr<?= $meu ? ' style="background:#fffaeb"' : '' ?>><td><b><?= h($pl['nome']) ?></b><?= $meu ? ' <span class="ce-tag verde">seu plano</span>' : '' ?></td><td class="d"><?= h(central_rs($pl['preco_mensal'])) ?></td><td class="d"><?= h(central_rs($pl['preco_anual'])) ?></td>
        <td class="d"><?= (int)$pl['max_obras'] === 0 ? 'ilimitadas' : (int)$pl['max_obras'] ?></td><td class="d"><?= (int)$pl['max_usuarios'] === 0 ? 'ilimitados' : (int)$pl['max_usuarios'] ?></td>
        <td><small><?= h(implode(', ', array_map(function ($c) use ($rotAreas) { return $rotAreas[$c] ?? $c; }, $am))) ?></small></td></tr><?php endforeach; ?></tbody></table></section>
  <?php endif; ?>
</main></div>
</body></html>
