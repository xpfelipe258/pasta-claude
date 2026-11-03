<?php
// Comercial (administração do sistema): planos empresariais nível 1, 2 e 3, empresas clientes (cada uma com seu administrador), assinaturas e pagamentos.
// Só o administrador do sistema. A regra de limites só passa a valer quando "Exigir plano" está ligado.
require __DIR__ . '/inc/nucleo.php';
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

$eu = exigir_admin();
$msg = '';
$erro = '';

function pl_rs($v) { return 'R$ ' . number_format((float)$v, 2, ',', '.'); }
function pl_dt($d) { return $d ? date('d/m/Y', strtotime($d)) : '—'; }
function pl_num($v) { return rtrim(rtrim(number_format((float)$v, 2, ',', ''), '0'), ','); }
function pl_num2($v) { return number_format((float)$v, 2, ',', ''); }

if (planos_semear_niveis() > 0) {
    $msg = 'Criei os três níveis do Plano Empresarial com valores de partida. Ajuste preços, limites e itens de cada nível em “Planos”.';
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    conferir_csrf();
    $acao = $_POST['acao'] ?? '';
    try {
        bd()->beginTransaction();
        if ($acao === 'config') {
            planos_config_salvar($_POST);
            registrar_global('planos_config', planos_config());
            $msg = !empty($_POST['exigir_plano']) ? 'Regra salva: a criação de obras e usuários passa a respeitar o plano de cada empresa.' : 'Regra salva: o plano NÃO é exigido (nada é limitado, como antes).';
        } elseif ($acao === 'plano') {
            list($id, $e) = planos_salvar($_POST, (int)($_POST['id'] ?? 0));
            if ($e) { throw new InvalidArgumentException(implode(' ', $e)); }
            registrar_global('plano_salvar', ['id' => $id, 'nome' => $_POST['nome'] ?? '']);
            $msg = 'Plano salvo. Limites e áreas valem na hora para as empresas desse plano; o preço cobrado de cada empresa continua o que foi combinado com ela.';
        } elseif ($acao === 'empresa_criar') {
            list($id, $e) = organizacao_criar($_POST);
            if ($e) { throw new InvalidArgumentException(implode(' ', $e)); }
            $msg = 'Empresa “' . trim($_POST['nome']) . '” cadastrada com o administrador “' . trim($_POST['admin_login']) . '”. Entregue o login e a senha inicial a ele: é ele quem cria as obras e os usuários da empresa.';
        } elseif ($acao === 'empresa_salvar') {
            $e = organizacao_salvar($_POST);
            if ($e) { throw new InvalidArgumentException(implode(' ', $e)); }
            $msg = 'Empresa salva.';
        } elseif ($acao === 'pagamento') {
            $e = organizacao_registrar_pagamento($_POST, $eu);
            if ($e) { throw new InvalidArgumentException(implode(' ', $e)); }
            $msg = 'Pagamento registrado e vencimento renovado.';
        } else {
            throw new InvalidArgumentException('Ação inválida.');
        }
        bd()->commit();
    } catch (InvalidArgumentException $e) {
        if (bd()->inTransaction()) { bd()->rollBack(); }
        $erro = $e->getMessage();
        $msg = '';
    } catch (Throwable $e) {
        if (bd()->inTransaction()) { bd()->rollBack(); }
        $erro = 'Falha: ' . $e->getMessage();
        $msg = '';
    }
}

$cfg = planos_config();
$planos = planos_listar();
$planosAtivos = array_values(array_filter($planos, function ($p) { return (int)$p['ativo'] === 1; }));
$ind = planos_indicadores();
$rotulos = planos_modulos_rotulos();
$empresas = [];
foreach (q_global('SELECT id FROM organizacoes ORDER BY nome')->fetchAll(PDO::FETCH_COLUMN) as $oid) { $empresas[] = organizacao_ler($oid); }
$pagamentos = q_global('SELECT p.*, o.nome AS empresa_nome FROM organizacoes_pagamentos p JOIN organizacoes o ON o.id = p.organizacao_id ORDER BY p.data_pagamento DESC, p.id DESC LIMIT 8')->fetchAll();
$precosPlano = [];
foreach ($planos as $pl) { $precosPlano[(int)$pl['id']] = ['mensal' => pl_num2($pl['preco_mensal']), 'anual' => pl_num2($pl['preco_anual'])]; }
$csrf = token_csrf();
$logoGlobal = global_ler('logo', '');
$hoje = planos_hoje();
pagina_inicio('Comercial');
?>
<link rel="stylesheet" href="planos.css?v=<?= (int)@filemtime(__DIR__ . '/planos.css') ?>">
<div class="portal-shell">
  <header class="portal-topo">
    <div class="portal-brand">
      <?php if ($logoGlobal): ?><img src="<?= h($logoGlobal) ?>" alt="Logo"><?php else: ?><span class="brand-mark">NO</span><?php endif; ?>
      <div><strong><?= h(global_ler('nome_sistema', 'Núcleo de Obras')) ?></strong><small>Administração do sistema</small></div>
    </div>
    <div class="portal-user"><span>Olá, <?= h($eu['nome']) ?></span><a class="btn ghost" href="obras.php?lista=1">Central de obras</a><a class="btn ghost" href="sair.php">Sair</a></div>
  </header>
  <main class="pl-shell">
    <section class="pl-hero"><span class="eyebrow">COMERCIAL</span><h1>Planos empresariais e empresas clientes</h1>
      <p>Cada empresa cliente contrata um plano (nível 1, 2 ou 3), recebe um usuário administrador e, dentro do limite do plano, cria as próprias obras e os próprios usuários. A cobrança é registrada aqui, manualmente.</p></section>
    <?php if ($msg): ?><div class="pl-toast ok"><?= h($msg) ?></div><?php endif; ?>
    <?php if ($erro): ?><div class="pl-toast erro"><?= h($erro) ?></div><?php endif; ?>

    <section class="pl-kpis">
      <div class="pl-kpi verde"><small>Receita mensal recorrente</small><b><?= h(pl_rs($ind['mrr'])) ?></b><span>planos anuais ÷ 12 · só empresas pagantes</span></div>
      <div class="pl-kpi"><small>Receita anual projetada</small><b><?= h(pl_rs($ind['arr'])) ?></b><span><?= (int)$ind['assinantes'] ?> empresa(s) ativa(s) de <?= (int)$ind['empresas'] ?></span></div>
      <div class="pl-kpi azul"><small>Recebido neste mês</small><b><?= h(pl_rs($ind['recebido_mes'])) ?></b><span><?= (int)$ind['teste'] ?> em período de teste</span></div>
      <div class="pl-kpi <?= $ind['inadimplentes'] ? 'vermelho' : '' ?>"><small>Vencidas</small><b><?= (int)$ind['inadimplentes'] ?></b><span><?= (int)$ind['a_vencer'] ?> vencem em até 7 dias</span></div>
      <div class="pl-kpi"><small>Obras e usuários em uso</small><b><?= (int)$ind['obras_em_uso'] ?> · <?= (int)$ind['usuarios_em_uso'] ?></b><span>vagas: <?= (int)$ind['vagas_obras'] ?> obras · <?= (int)$ind['vagas_usuarios'] ?> usuários (ilimitado não conta)</span></div>
    </section>

    <section class="pl-caixa">
      <div class="pl-cab"><div><h2>Planos</h2><p style="margin:0">Os três níveis do Plano Empresarial. O preço, os limites e as áreas de cada nível são seus: edite quando definir o que cada um inclui. Limites e áreas valem na hora para quem já assina.</p></div>
        <div class="pl-acoes"><button class="btn" data-plano="0">+ Novo plano</button></div></div>
      <div class="pl-plano-card">
      <?php foreach ($planos as $pl):
          $mods = plano_modulos($pl); $nEmp = (int)q_global('SELECT COUNT(*) FROM organizacoes WHERE plano_id = ?', [(int)$pl['id']])->fetchColumn();
          $dados = ['nome' => $pl['nome'], 'nivel' => (int)$pl['nivel'], 'preco_mensal' => pl_num2($pl['preco_mensal']), 'preco_anual' => pl_num2($pl['preco_anual']), 'max_obras' => (int)$pl['max_obras'], 'max_usuarios' => (int)$pl['max_usuarios'], 'modulos' => $mods, 'itens' => (string)$pl['itens'], 'ativo' => (int)$pl['ativo']]; ?>
        <article class="pl-nivel <?= $pl['ativo'] ? '' : 'inativo' ?>">
          <span class="eyebrow">NÍVEL <?= (int)$pl['nivel'] ?><?= $pl['ativo'] ? '' : ' · INATIVO' ?></span><h3><?= h($pl['nome']) ?></h3>
          <p class="pl-preco"><?= h(pl_rs($pl['preco_mensal'])) ?> <small>/mês</small></p><small style="color:#667085"><?= h(pl_rs($pl['preco_anual'])) ?>/ano (equivale a <?= h(pl_rs($pl['preco_anual'] / 12)) ?>/mês)</small>
          <div class="pl-lim"><span><b><?= (int)$pl['max_obras'] === 0 ? 'Obras ilimitadas' : (int)$pl['max_obras'] . ' obra(s)' ?></b></span><span><b><?= (int)$pl['max_usuarios'] === 0 ? 'Usuários ilimitados' : (int)$pl['max_usuarios'] . ' usuário(s)' ?></b></span><span><?= $nEmp ?> empresa(s)</span></div>
          <div class="pl-areas"><?php foreach ($rotulos as $cod => $rot): ?><span class="<?= in_array($cod, $mods, true) ? '' : 'off' ?>"><?= h($rot) ?></span><?php endforeach; ?></div>
          <?php if (trim((string)$pl['itens']) !== ''): ?><ul><?php foreach (preg_split('/\r?\n/', trim((string)$pl['itens'])) as $li): if (trim($li) === '') continue; ?><li><?= h(trim($li)) ?></li><?php endforeach; ?></ul><?php else: ?><p class="pl-nota" style="margin:10px 0 0">Itens do nível ainda não descritos.</p><?php endif; ?>
          <div class="pl-acoes" style="margin-top:12px"><button class="btn" data-plano="<?= (int)$pl['id'] ?>" data-d='<?= h(json_encode($dados, JSON_UNESCAPED_UNICODE)) ?>'>Editar plano</button></div>
        </article>
      <?php endforeach; ?>
      </div>
    </section>

    <section class="pl-caixa">
      <div class="pl-cab"><div><h2>Empresas clientes</h2><p style="margin:0">Cadastre a empresa junto com o usuário administrador dela. “Registrar pagamento” renova o vencimento sozinho (1 mês no plano mensal, 12 no anual).</p></div>
        <div class="pl-acoes"><button class="btn primario" id="btnEmpresa">+ Nova empresa</button></div></div>
      <?php if ($empresas): ?><table class="pl-tab"><thead><tr><th>Empresa</th><th>Plano</th><th class="n">Valor</th><th>Obras</th><th>Usuários</th><th>Vencimento</th><th>Situação</th><th></th></tr></thead><tbody>
        <?php foreach ($empresas as $o):
            $s = organizacao_situacao($o, $cfg); $limO = organizacao_limite_obras($o); $limU = organizacao_limite_usuarios($o); $usO = organizacao_obras_em_uso($o['id']); $usU = organizacao_usuarios_em_uso($o['id']);
            $adm = q_global('SELECT nome, login FROM usuarios WHERE organizacao_id = ? AND admin_organizacao = 1 ORDER BY id LIMIT 1', [(int)$o['id']])->fetch();
            $dados = ['id' => (int)$o['id'], 'nome' => $o['nome'], 'documento' => $o['documento'], 'contato' => $o['contato'], 'email' => $o['email'], 'telefone' => $o['telefone'], 'plano_id' => (int)$o['plano_id'], 'ciclo' => $o['ciclo'],
                'preco' => pl_num2($o['preco']), 'obras_extra' => (int)$o['obras_extra'], 'usuarios_extra' => (int)$o['usuarios_extra'], 'inicio' => $o['inicio'], 'vencimento' => $o['vencimento'], 'status' => $o['status'], 'obs' => $o['obs']]; ?>
        <tr><td><b><?= h($o['nome']) ?></b><small><?= $o['documento'] ? h($o['documento']) . ' · ' : '' ?>admin: <?= $adm ? h($adm['login']) : '—' ?></small></td>
          <td><b><?= h($o['plano_nome'] ?: '—') ?></b><small><?= h(planos_ciclos()[$o['ciclo']] ?? '') ?><?= $o['obras_extra'] || $o['usuarios_extra'] ? ' · extras: +' . (int)$o['obras_extra'] . ' obra(s), +' . (int)$o['usuarios_extra'] . ' usuário(s)' : '' ?></small></td>
          <td class="n"><?= h(pl_rs($o['preco'])) ?><small>/<?= $o['ciclo'] === 'ANUAL' ? 'ano' : 'mês' ?></small></td>
          <td><span class="pl-uso <?= $limO > 0 && $usO >= $limO ? 'cheio' : '' ?>"><b><?= (int)$usO ?></b> de <?= $limO === 0 ? '∞' : (int)$limO ?><?php if ($limO > 0): ?><i><b style="width:<?= (int)min(100, $usO / $limO * 100) ?>%"></b></i><?php endif; ?></span></td>
          <td><span class="pl-uso <?= $limU > 0 && $usU >= $limU ? 'cheio' : '' ?>"><b><?= (int)$usU ?></b> de <?= $limU === 0 ? '∞' : (int)$limU ?><?php if ($limU > 0): ?><i><b style="width:<?= (int)min(100, $usU / $limU * 100) ?>%"></b></i><?php endif; ?></span></td>
          <td><?= h(pl_dt($o['vencimento'])) ?><?php if ($s['dias'] !== null): ?><small><?= $s['dias'] >= 0 ? 'em ' . $s['dias'] . ' dia(s)' : 'há ' . (-$s['dias']) . ' dia(s)' ?></small><?php endif; ?></td>
          <td><span class="pl-chip <?= h($s['cls']) ?>"><?= h($s['rotulo']) ?></span></td>
          <td><div class="pl-acoes"><button class="btn primario" data-pagto="<?= (int)$o['id'] ?>" data-d='<?= h(json_encode(['nome' => $o['nome'], 'plano' => $o['plano_nome'], 'valor' => pl_num2($o['preco']), 'ciclo' => $o['ciclo']], JSON_UNESCAPED_UNICODE)) ?>'>Registrar pagamento</button>
            <button class="btn" data-empresa='<?= h(json_encode($dados, JSON_UNESCAPED_UNICODE)) ?>'>Editar</button>
            <a class="btn" href="empresa_usuarios.php?org=<?= (int)$o['id'] ?>">Usuários</a></div></td></tr>
        <?php endforeach; ?></tbody></table>
      <?php else: ?><p class="pl-nota">Nenhuma empresa cadastrada ainda. Use “+ Nova empresa”: ela já nasce com o usuário administrador.</p><?php endif; ?>
    </section>

    <section class="pl-caixa">
      <h2>Regra de criação de obras e usuários</h2>
      <p>Com “Exigir plano” desligado nada muda: ninguém é limitado, como hoje. Ligado, cada empresa só cria obras e usuários enquanto houver vaga no plano e a assinatura estiver em dia, e os usuários da empresa só veem as áreas que o plano libera. O administrador do sistema nunca é limitado. Usuários que não pertencem a nenhuma empresa usam “obras de quem não tem empresa”.</p>
      <form method="post" class="pl-form"><input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="acao" value="config">
        <label class="pl-check"><input type="checkbox" name="exigir_plano" value="1" <?= $cfg['exigir_plano'] ? 'checked' : '' ?>> Exigir plano (limites de obras, usuários e áreas por empresa)</label>
        <label>Obras de quem não tem empresa<input type="number" name="limite_sem_plano" min="0" max="1000" value="<?= (int)$cfg['limite_sem_plano'] ?>"></label>
        <label>Tolerância após o vencimento (dias)<input type="number" name="tolerancia_dias" min="0" max="60" value="<?= (int)$cfg['tolerancia_dias'] ?>"></label>
        <label>Dias do período de teste<input type="number" name="dias_teste" min="1" max="90" value="<?= (int)$cfg['dias_teste'] ?>"></label>
        <label class="pl-check"><input type="checkbox" name="cadastro_aberto" value="1" <?= $cfg['cadastro_aberto'] ? 'checked' : '' ?>> Cadastro público aberto (aba “Cadastro” da tela de login: a empresa se cadastra sozinha, escolhe o plano e entra em teste)</label>
        <div><button class="btn primario">Salvar regra</button></div>
      </form>
    </section>

    <section class="pl-caixa">
      <h2>Últimos pagamentos</h2>
      <?php if ($pagamentos): ?><table class="pl-tab" style="min-width:0"><thead><tr><th>Data</th><th>Empresa</th><th class="n">Valor</th><th>Pago até</th><th>Forma</th><th>Registrado por</th></tr></thead><tbody>
        <?php foreach ($pagamentos as $pg): ?><tr><td><?= h(pl_dt($pg['data_pagamento'])) ?></td><td><?= h($pg['empresa_nome']) ?></td><td class="n"><b><?= h(pl_rs($pg['valor'])) ?></b></td><td><?= h(pl_dt($pg['periodo_ate'])) ?></td><td><?= h($pg['forma'] ?: '—') ?></td><td><?= h($pg['por']) ?></td></tr><?php endforeach; ?></tbody></table>
      <?php else: ?><p class="pl-nota">Nenhum pagamento registrado ainda.</p><?php endif; ?>
      <p class="pl-nota">Este painel controla limites e cobrança manualmente (você registra o que recebeu). Cobrança automática por cartão/boleto exige integração com um gateway de pagamento — fica como próxima etapa.</p>
    </section>
  </main>
</div>

<dialog class="pl-dlg" id="dlgPlano"><form method="post"><input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="acao" value="plano"><input type="hidden" name="id" value="0">
  <h3 id="dlgPlanoTit">Novo plano</h3>
  <div class="pl-form"><label>Nome do plano<input name="nome" maxlength="80" required></label>
    <label>Nível (1 a 9)<input name="nivel" type="number" min="1" max="9" value="1" required></label>
    <label>Preço mensal (R$)<input name="preco_mensal" inputmode="decimal" placeholder="0,00" required></label>
    <label>Preço anual (R$)<input name="preco_anual" inputmode="decimal" placeholder="0,00" required></label>
    <label>Obras que a empresa pode ter (0 = ilimitado)<input name="max_obras" type="number" min="0" max="10000" value="1" required></label>
    <label>Usuários da empresa (0 = ilimitado)<input name="max_usuarios" type="number" min="0" max="100000" value="5" required></label>
    <fieldset class="pl-fs"><legend>Áreas do sistema que este nível libera</legend><div class="pl-mods"><?php foreach ($rotulos as $cod => $rot): ?><label class="pl-check"><input type="checkbox" name="modulos[]" value="<?= h($cod) ?>" checked> <?= h($rot) ?></label><?php endforeach; ?></div></fieldset>
    <label style="grid-column:1/-1">Itens do nível (um por linha — aparece para a empresa)<textarea name="itens" rows="5" maxlength="4000" placeholder="Ex.: Medição (BM) com fechamento mensal&#10;Contas a pagar&#10;SESMT completo"></textarea></label>
    <label class="pl-check"><input type="checkbox" name="ativo" value="1" checked> Plano ativo (aparece para novas empresas)</label></div>
  <div class="pl-fim"><button type="button" class="btn" data-fechar>Cancelar</button><button class="btn primario">Salvar plano</button></div></form></dialog>

<dialog class="pl-dlg" id="dlgEmpresa"><form method="post"><input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="acao" value="empresa_criar"><input type="hidden" name="id" value="0">
  <h3 id="dlgEmpresaTit">Nova empresa</h3>
  <div class="pl-form"><label>Nome da empresa<input name="nome" maxlength="120" required></label><label>CNPJ<input name="documento" maxlength="30"></label>
    <label>Contato<input name="contato" maxlength="120"></label><label>Telefone<input name="telefone" maxlength="30"></label>
    <label>E-mail da empresa<input name="email" type="email"></label>
    <fieldset class="pl-fs" id="fsAdmin"><legend>Administrador da empresa (cria as obras e os usuários dela)</legend>
      <div class="pl-form"><label>Nome<input name="admin_nome" maxlength="80"></label><label>Login<input name="admin_login" maxlength="50" autocomplete="off"></label>
        <label>E-mail<input name="admin_email" type="email" autocomplete="off"></label><label>Senha inicial (mín. 8)<input name="admin_senha" type="password" minlength="8" autocomplete="new-password"></label></div></fieldset>
    <label>Plano<select name="plano_id" required><option value="">Escolha…</option><?php foreach ($planosAtivos as $pl): ?><option value="<?= (int)$pl['id'] ?>"><?= h($pl['nome']) ?> — <?= h(pl_rs($pl['preco_mensal'])) ?>/mês · <?= (int)$pl['max_obras'] === 0 ? 'obras ilimitadas' : (int)$pl['max_obras'] . ' obra(s)' ?> · <?= (int)$pl['max_usuarios'] === 0 ? 'usuários ilimitados' : (int)$pl['max_usuarios'] . ' usuário(s)' ?></option><?php endforeach; ?></select></label>
    <label>Ciclo de cobrança<select name="ciclo"><option value="MENSAL">Mensal</option><option value="ANUAL">Anual</option></select></label>
    <label>Valor cobrado por ciclo (R$)<input name="preco" inputmode="decimal" placeholder="vazio = preço do plano"></label>
    <label>Situação<select name="status"><?php foreach (planos_status_lista() as $k => $r): ?><option value="<?= h($k) ?>"><?= h($r) ?></option><?php endforeach; ?></select></label>
    <label>Obras extras contratadas<input name="obras_extra" type="number" min="0" max="1000" value="0"></label>
    <label>Usuários extras contratados<input name="usuarios_extra" type="number" min="0" max="100000" value="0"></label>
    <label>Início<input name="inicio" type="date" required></label>
    <label>Vencimento (fim do período pago ou do teste)<input name="vencimento" type="date" required></label>
    <label style="grid-column:1/-1">Observações<textarea name="obs"></textarea></label></div>
  <div class="pl-fim"><button type="button" class="btn" data-fechar>Cancelar</button><button class="btn primario" id="btnSalvarEmpresa">Cadastrar empresa</button></div></form></dialog>

<dialog class="pl-dlg" id="dlgPagto"><form method="post"><input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="acao" value="pagamento"><input type="hidden" name="organizacao_id" value="0">
  <h3 id="dlgPagtoTit">Registrar pagamento</h3><p class="pl-nota" id="dlgPagtoNota" style="margin-top:0"></p>
  <div class="pl-form"><label>Data do pagamento<input name="data_pagamento" type="date" required max="<?= h($hoje) ?>"></label>
    <label>Valor recebido (R$)<input name="valor" inputmode="decimal" required></label>
    <label>Forma<input name="forma" maxlength="30" placeholder="Pix, boleto, cartão…"></label>
    <label>Observação<input name="obs" maxlength="255"></label></div>
  <div class="pl-fim"><button type="button" class="btn" data-fechar>Cancelar</button><button class="btn primario">Registrar e renovar</button></div></form></dialog>
<script>
(function () {
  var $ = function (s) { return document.querySelector(s); };
  var PRECOS = <?= json_encode($precosPlano) ?>, HOJE = '<?= h($hoje) ?>', DIAS_TESTE = <?= (int)$cfg['dias_teste'] ?>;
  document.querySelectorAll('[data-fechar]').forEach(function (b) { b.addEventListener('click', function () { b.closest('dialog').close(); }); });
  function somaDias(iso, n) { var d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }
  function somaMeses(iso, n) { var p = iso.split('-').map(Number), y = p[0], m = p[1] - 1 + n, dia = p[2]; y += Math.floor(m / 12); m = ((m % 12) + 12) % 12; var ult = new Date(y, m + 1, 0).getDate(); return y + '-' + String(m + 1).padStart(2, '0') + '-' + String(Math.min(dia, ult)).padStart(2, '0'); }
  document.querySelectorAll('[data-plano]').forEach(function (b) { b.addEventListener('click', function () {
    var d = b.dataset.d ? JSON.parse(b.dataset.d) : { nome: '', nivel: 1, preco_mensal: '', preco_anual: '', max_obras: 1, max_usuarios: 5, modulos: <?= json_encode(array_keys($rotulos)) ?>, itens: '', ativo: 1 }, f = $('#dlgPlano form');
    $('#dlgPlanoTit').textContent = b.dataset.plano === '0' ? 'Novo plano' : 'Editar plano';
    f.id.value = b.dataset.plano; f.nome.value = d.nome; f.nivel.value = d.nivel; f.preco_mensal.value = d.preco_mensal; f.preco_anual.value = d.preco_anual; f.max_obras.value = d.max_obras; f.max_usuarios.value = d.max_usuarios; f.itens.value = d.itens || ''; f.ativo.checked = !!d.ativo;
    f.querySelectorAll('[name="modulos[]"]').forEach(function (c) { c.checked = d.modulos.indexOf(c.value) >= 0; });
    $('#dlgPlano').showModal(); }); });
  var fe = $('#dlgEmpresa form');
  function sugerir() {
    var pl = PRECOS[fe.plano_id.value], p = fe.preco; if (pl) p.placeholder = (fe.ciclo.value === 'ANUAL' ? pl.anual : pl.mensal) + ' (preço do plano)';
    if (fe.acao.value === 'empresa_criar' && fe.inicio.value) fe.vencimento.value = fe.status.value === 'TESTE' ? somaDias(fe.inicio.value, DIAS_TESTE) : somaMeses(fe.inicio.value, fe.ciclo.value === 'ANUAL' ? 12 : 1);
  }
  ['plano_id', 'ciclo', 'status', 'inicio'].forEach(function (n) { fe[n].addEventListener('change', sugerir); });
  $('#btnEmpresa').addEventListener('click', function () {
    fe.reset(); fe.acao.value = 'empresa_criar'; fe.id.value = 0; $('#dlgEmpresaTit').textContent = 'Nova empresa'; $('#btnSalvarEmpresa').textContent = 'Cadastrar empresa';
    $('#fsAdmin').hidden = false; ['admin_nome', 'admin_login', 'admin_senha'].forEach(function (n) { fe[n].required = true; });
    fe.inicio.value = HOJE; fe.status.value = 'TESTE'; sugerir(); $('#dlgEmpresa').showModal(); });
  document.querySelectorAll('[data-empresa]').forEach(function (b) { b.addEventListener('click', function () {
    var d = JSON.parse(b.dataset.empresa); fe.reset(); fe.acao.value = 'empresa_salvar'; fe.id.value = d.id; $('#dlgEmpresaTit').textContent = 'Empresa — ' + d.nome; $('#btnSalvarEmpresa').textContent = 'Salvar empresa';
    $('#fsAdmin').hidden = true; ['admin_nome', 'admin_login', 'admin_senha'].forEach(function (n) { fe[n].required = false; });
    ['nome', 'documento', 'contato', 'telefone', 'email', 'plano_id', 'ciclo', 'preco', 'status', 'obras_extra', 'usuarios_extra', 'inicio', 'vencimento', 'obs'].forEach(function (n) { fe[n].value = d[n] == null ? '' : d[n]; });
    sugerir(); $('#dlgEmpresa').showModal(); }); });
  document.querySelectorAll('[data-pagto]').forEach(function (b) { b.addEventListener('click', function () {
    var d = JSON.parse(b.dataset.d), f = $('#dlgPagto form');
    $('#dlgPagtoTit').textContent = 'Registrar pagamento — ' + d.nome;
    $('#dlgPagtoNota').textContent = d.plano + ' (' + (d.ciclo === 'ANUAL' ? 'anual' : 'mensal') + '). O vencimento avança ' + (d.ciclo === 'ANUAL' ? '12 meses' : '1 mês') + '.';
    f.organizacao_id.value = b.dataset.pagto; f.valor.value = d.valor; f.data_pagamento.value = HOJE;
    $('#dlgPagto').showModal(); }); });
})();
</script>
</body></html>
