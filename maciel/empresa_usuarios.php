<?php
// Usuários da empresa: o administrador da empresa cliente cadastra e gerencia os usuários dela, dentro dos limites do plano contratado
// (quantidade de usuários, obras e áreas liberadas). O administrador do sistema também abre esta página (empresa_usuarios.php?org=ID) a partir do Comercial.
require __DIR__ . '/inc/nucleo.php';
require_once __DIR__ . '/inc/modelo.php';
require_once __DIR__ . '/inc/central.php';
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

$eu = exigir_login_pagina();
$sistema = $eu['perfil'] === 'admin';
if ($sistema) {
    $orgId = (int)($_GET['org'] ?? $_POST['org'] ?? 0);
    if ($orgId <= 0) { header('Location: admin_planos.php'); exit; }
} else {
    list($orgId, $admOrg) = usuario_organizacao_id($eu);
    if (!$orgId || !$admOrg) {
        http_response_code(403);
        exit('Acesso restrito ao administrador da empresa.');
    }
}
$org = organizacao_ler($orgId);
if (!$org) {
    http_response_code(404);
    exit('Empresa não encontrada.');
}
$cfg = planos_config();
$permitidas = $cfg['exigir_plano'] ? plano_modulos(['modulos' => $org['plano_modulos']]) : modulos_sistema();   // com a regra desligada qualquer área pode ser dada
$rotulos = planos_modulos_rotulos();
$msg = '';
$erro = '';
$obrasOrg = q_global("SELECT id, nome FROM obras WHERE organizacao_id = ? AND status = 'ativa' AND (origem_obra_id IS NULL OR origem_obra_id = 0) ORDER BY nome", [$orgId])->fetchAll();
$idsObras = array_map(function ($o) { return (int)$o['id']; }, $obrasOrg);

function eu_pl_alvo($orgId, $id)
{
    $u = q_global('SELECT * FROM usuarios WHERE id = ? AND organizacao_id = ?', [(int)$id, (int)$orgId])->fetch();
    if (!$u) { throw new InvalidArgumentException('Usuário não pertence a esta empresa.'); }
    return $u;
}

/** Grava as obras do usuário (só obras da empresa) e as áreas; administrador da empresa tem todas as obras e áreas do plano. */
function eu_pl_acessos($orgId, $uid, $admin, array $idsObras, array $permitidas, array $post)
{
    $marcadas = array_values(array_intersect($idsObras, array_map('intval', (array)($post['obras'] ?? []))));
    if ($idsObras) {
        q_global('DELETE FROM usuarios_obras WHERE usuario_id = ? AND obra_id IN (' . implode(',', $idsObras) . ')', [(int)$uid]);
    }
    if ($admin) {
        foreach ($idsObras as $oid) { organizacao_ligar_usuario_obra($uid, $oid, 1); }
        q_global('DELETE FROM usuarios_modulos WHERE usuario_id = ?', [(int)$uid]);
        return;
    }
    if (!$marcadas) { throw new InvalidArgumentException('Marque ao menos uma obra para o usuário.'); }
    foreach ($marcadas as $oid) { organizacao_ligar_usuario_obra($uid, $oid, 0); }
    $mods = array_values(array_intersect($permitidas, array_map('strval', (array)($post['modulos'] ?? []))));
    if (!$mods) { throw new InvalidArgumentException('Marque ao menos uma área de acesso para o usuário.'); }
    organizacao_usuario_modulos($uid, $mods, $permitidas);
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    conferir_csrf();
    $acao = $_POST['acao'] ?? '';
    try {
        bd()->beginTransaction();
        if ($acao === 'criar') {
            list($ok, $m) = plano_verificar_usuario($orgId);
            if (!$ok) { throw new InvalidArgumentException($m); }
            $admin = !empty($_POST['admin_empresa']);
            list($uid, $e) = organizacao_usuario_inserir($orgId, $_POST, $admin);
            if ($e) { throw new InvalidArgumentException(implode(' ', $e)); }
            eu_pl_acessos($orgId, $uid, $admin, $idsObras, $permitidas, $_POST);
            registrar_global('organizacao_usuario_criar', ['organizacao' => $orgId, 'login' => trim($_POST['login'] ?? ''), 'admin' => $admin ? 1 : 0]);
            $msg = 'Usuário “' . trim($_POST['login']) . '” criado. Entregue o login e a senha inicial a ele.';
        } elseif ($acao === 'editar') {
            $alvo = eu_pl_alvo($orgId, $_POST['id'] ?? 0);
            $nome = trim((string)($_POST['nome'] ?? ''));
            $login = trim((string)($_POST['login'] ?? ''));
            $email = trim((string)($_POST['email'] ?? ''));
            if ($nome === '' || $login === '') { throw new InvalidArgumentException('Informe nome e login.'); }
            if (!preg_match('/^[A-Za-z0-9._@-]{3,50}$/', $login)) { throw new InvalidArgumentException('Login: de 3 a 50 caracteres (letras, números, ponto, hífen, sublinhado ou @).'); }
            if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) { throw new InvalidArgumentException('Informe um e-mail válido.'); }
            if (q_global('SELECT id FROM usuarios WHERE login = ? AND id <> ?', [$login, (int)$alvo['id']])->fetch()) { throw new InvalidArgumentException('Já existe outro usuário com esse login.'); }
            $eMeu = (int)$alvo['id'] === (int)$eu['id'];
            $admin = $eMeu ? (int)$alvo['admin_organizacao'] === 1 : !empty($_POST['admin_empresa']);   // ninguém tira o próprio papel de administrador
            $perfil = $admin ? 'editor' : (in_array($_POST['perfil'] ?? '', ['editor', 'leitura'], true) ? $_POST['perfil'] : 'editor');
            q_global('UPDATE usuarios SET nome = ?, login = ?, email = ?, perfil = ?, admin_organizacao = ? WHERE id = ?', [$nome, $login, texto_ou_nulo($email), $perfil, $admin ? 1 : 0, (int)$alvo['id']]);
            if ((int)$alvo['admin_organizacao'] === 1 && !$admin && $idsObras) {   // deixou de ser administrador: perde o controle total das obras
                q_global('UPDATE usuarios_obras SET admin_obra = 0 WHERE usuario_id = ? AND obra_id IN (' . implode(',', $idsObras) . ')', [(int)$alvo['id']]);
            }
            eu_pl_acessos($orgId, (int)$alvo['id'], $admin, $idsObras, $permitidas, $_POST);
            registrar_global('organizacao_usuario_editar', ['organizacao' => $orgId, 'id' => (int)$alvo['id'], 'admin' => $admin ? 1 : 0]);
            $msg = 'Usuário atualizado.';
        } elseif ($acao === 'alternar') {
            $alvo = eu_pl_alvo($orgId, $_POST['id'] ?? 0);
            if ((int)$alvo['id'] === (int)$eu['id']) { throw new InvalidArgumentException('Você não pode desativar o próprio usuário.'); }
            if (!(int)$alvo['ativo']) {
                list($ok, $m) = plano_verificar_usuario($orgId);
                if (!$ok) { throw new InvalidArgumentException($m); }
            }
            q_global('UPDATE usuarios SET ativo = 1 - ativo WHERE id = ?', [(int)$alvo['id']]);
            registrar_global('organizacao_usuario_alternar', ['organizacao' => $orgId, 'id' => (int)$alvo['id']]);
            $msg = (int)$alvo['ativo'] ? 'Usuário desativado: a vaga do plano foi liberada.' : 'Usuário reativado.';
        } elseif ($acao === 'senha') {
            $alvo = eu_pl_alvo($orgId, $_POST['id'] ?? 0);
            if (strlen((string)($_POST['senha'] ?? '')) < 8) { throw new InvalidArgumentException('A nova senha precisa ter pelo menos 8 caracteres.'); }
            q_global('UPDATE usuarios SET senha = ? WHERE id = ?', [password_hash($_POST['senha'], PASSWORD_DEFAULT), (int)$alvo['id']]);
            registrar_global('organizacao_usuario_senha', ['organizacao' => $orgId, 'id' => (int)$alvo['id']]);
            $msg = 'Senha de ' . $alvo['login'] . ' redefinida.';
        } elseif ($acao === 'link') {
            $alvo = eu_pl_alvo($orgId, $_POST['id'] ?? 0);
            if (empty($alvo['email'])) { throw new InvalidArgumentException('Cadastre um e-mail para este usuário antes de enviar o link.'); }
            if (!enviar_link_redefinicao($alvo)) { throw new InvalidArgumentException('Não foi possível enviar o e-mail. Verifique se o servidor está com envio de e-mail habilitado.'); }
            $msg = 'Link de redefinição enviado para ' . $alvo['email'] . '.';
        } else {
            throw new InvalidArgumentException('Ação inválida.');
        }
        bd()->commit();
        $org = organizacao_ler($orgId);
    } catch (InvalidArgumentException $e) {
        if (bd()->inTransaction()) { bd()->rollBack(); }
        $erro = $e->getMessage();
    } catch (Throwable $e) {
        if (bd()->inTransaction()) { bd()->rollBack(); }
        $erro = 'Falha: ' . $e->getMessage();
    }
}

$usuarios = q_global('SELECT id, nome, login, email, perfil, ativo, admin_organizacao FROM usuarios WHERE organizacao_id = ? ORDER BY admin_organizacao DESC, ativo DESC, nome', [$orgId])->fetchAll();
$modsPorUsuario = [];
foreach (q_global('SELECT m.usuario_id, m.modulo FROM usuarios_modulos m JOIN usuarios u ON u.id = m.usuario_id WHERE u.organizacao_id = ? AND m.permitido = 1', [$orgId])->fetchAll() as $r) { $modsPorUsuario[(int)$r['usuario_id']][] = $r['modulo']; }
$obrasPorUsuario = [];
foreach (q_global('SELECT uo.usuario_id, uo.obra_id FROM usuarios_obras uo JOIN usuarios u ON u.id = uo.usuario_id WHERE u.organizacao_id = ?', [$orgId])->fetchAll() as $r) { $obrasPorUsuario[(int)$r['usuario_id']][] = (int)$r['obra_id']; }
$nomeObra = [];
foreach ($obrasOrg as $o) { $nomeObra[(int)$o['id']] = $o['nome']; }
$sit = organizacao_situacao($org, $cfg);
$limO = organizacao_limite_obras($org);
$limU = organizacao_limite_usuarios($org);
$usadasO = organizacao_obras_em_uso($orgId);
$usadosU = organizacao_usuarios_em_uso($orgId);
$podeNovo = plano_verificar_usuario($orgId);
$csrf = token_csrf();
$logoGlobal = global_ler('logo', '');
function eu_dt($d) { return $d ? date('d/m/Y', strtotime($d)) : '—'; }
pagina_inicio('Usuários da empresa');
?>
<link rel="stylesheet" href="planos.css?v=<?= (int)@filemtime(__DIR__ . '/planos.css') ?>">
<div class="portal-shell">
  <header class="portal-topo">
    <div class="portal-brand">
      <?php if ($logoGlobal): ?><img src="<?= h($logoGlobal) ?>" alt="Logo"><?php else: ?><span class="brand-mark">NO</span><?php endif; ?>
      <div><strong><?= h(global_ler('nome_sistema', 'Núcleo de Obras')) ?></strong><small><?= h($org['nome']) ?></small></div>
    </div>
    <div class="portal-user"><span>Olá, <?= h($eu['nome']) ?></span><?php if ($sistema): ?><a class="btn ghost" href="admin_planos.php">← Comercial</a><?php endif; ?><a class="btn ghost" href="obras.php?lista=1">Central de obras</a><a class="btn ghost" href="sair.php">Sair</a></div>
  </header>
  <?= central_abas('config', $eu) ?>
  <div style="max-width:1280px;margin:18px auto 0;padding:0 28px"><?= cfg_sub('usuarios', $eu, $orgId) ?></div>
  <main class="pl-shell">
    <section class="pl-hero"><span class="eyebrow">EMPRESA</span><h1>Usuários de <?= h($org['nome']) ?></h1>
      <p>Cadastre aqui as pessoas da sua empresa, escolha em quais obras cada uma entra e quais áreas do sistema pode usar. O que cada pessoa pode fazer respeita o plano contratado.</p></section>
    <?php if ($msg): ?><div class="pl-toast ok"><?= h($msg) ?></div><?php endif; ?>
    <?php if ($erro): ?><div class="pl-toast erro"><?= h($erro) ?></div><?php endif; ?>

    <section class="pl-kpis">
      <div class="pl-kpi azul"><small>Plano</small><b style="font-size:1.15rem"><?= h($org['plano_nome'] ?: 'Sem plano') ?></b><span><?= h(planos_ciclos()[$org['ciclo']] ?? '') ?> · R$ <?= h(number_format((float)$org['preco'], 2, ',', '.')) ?></span></div>
      <div class="pl-kpi <?= $sit['cls'] === 'verde' ? 'verde' : ($sit['cls'] === 'vermelho' ? 'vermelho' : '') ?>"><small>Situação</small><b style="font-size:1.15rem"><?= h($sit['rotulo']) ?></b><span>vencimento <?= h(eu_dt($org['vencimento'])) ?></span></div>
      <div class="pl-kpi"><small>Obras</small><b><?= (int)$usadasO ?> <span style="font-size:.95rem">de <?= $limO === 0 ? '∞' : (int)$limO ?></span></b><span>ativas da empresa</span></div>
      <div class="pl-kpi"><small>Usuários</small><b><?= (int)$usadosU ?> <span style="font-size:.95rem">de <?= $limU === 0 ? '∞' : (int)$limU ?></span></b><span>ativos (inclui administradores)</span></div>
    </section>

    <?php if (trim((string)$org['plano_itens']) !== ''): ?>
    <section class="pl-caixa"><h2>O que o seu plano inclui</h2>
      <ul style="margin:6px 0 0;padding-left:20px;line-height:1.7"><?php foreach (preg_split('/\r?\n/', trim((string)$org['plano_itens'])) as $linha): if (trim($linha) === '') continue; ?><li><?= h(trim($linha)) ?></li><?php endforeach; ?></ul>
      <?php if ($cfg['exigir_plano']): ?><p class="pl-nota">Áreas liberadas: <?= h(implode(', ', array_map(function ($m) use ($rotulos) { return $rotulos[$m] ?? $m; }, $permitidas))) ?>.</p><?php endif; ?>
    </section>
    <?php endif; ?>

    <section class="pl-caixa">
      <div class="pl-cab"><div><h2>Usuários</h2><p style="margin:0">Administrador da empresa vê e controla todas as obras da empresa e cria usuários. Os demais entram só nas obras e áreas que você marcar.</p></div>
        <div class="pl-acoes"><button class="btn primario" id="btnNovo" <?= $podeNovo[0] ? '' : 'disabled title="' . h($podeNovo[1]) . '"' ?>>+ Novo usuário</button></div></div>
      <?php if (!$podeNovo[0]): ?><div class="pl-toast erro"><?= h($podeNovo[1]) ?></div><?php endif; ?>
      <table class="pl-tab"><thead><tr><th>Usuário</th><th>Papel</th><th>Obras</th><th>Áreas</th><th>Situação</th><th></th></tr></thead><tbody>
      <?php foreach ($usuarios as $u):
          $adm = (int)$u['admin_organizacao'] === 1; $minhasO = $obrasPorUsuario[(int)$u['id']] ?? []; $minhasM = $modsPorUsuario[(int)$u['id']] ?? [];
          $nomesO = array_values(array_filter(array_map(function ($i) use ($nomeObra) { return $nomeObra[$i] ?? null; }, $minhasO)));
          $d = ['id' => (int)$u['id'], 'nome' => $u['nome'], 'login' => $u['login'], 'email' => $u['email'], 'perfil' => $u['perfil'], 'admin' => $adm ? 1 : 0, 'obras' => array_values(array_intersect($minhasO, $idsObras)), 'modulos' => $minhasM, 'eu' => (int)$u['id'] === (int)$eu['id'] ? 1 : 0]; ?>
        <tr><td><b><?= h($u['nome']) ?></b><small><?= h($u['login']) ?><?= $u['email'] ? ' · ' . h($u['email']) : '' ?></small></td>
          <td><?= $adm ? '<span class="pl-chip azul">Administrador da empresa</span>' : '<span class="pl-chip ' . ($u['perfil'] === 'leitura' ? 'cinza' : 'verde') . '">' . ($u['perfil'] === 'leitura' ? 'Somente leitura' : 'Editor') . '</span>' ?></td>
          <td><?= $adm ? 'Todas as obras' : ($nomesO ? h(implode(', ', $nomesO)) : '<small>nenhuma</small>') ?></td>
          <td><?= $adm ? 'Todas do plano' : ($minhasM ? h(implode(', ', array_map(function ($m) use ($rotulos) { return $rotulos[$m] ?? $m; }, $minhasM))) : '<small>nenhuma</small>') ?></td>
          <td><span class="pl-chip <?= (int)$u['ativo'] ? 'verde' : 'cinza' ?>"><?= (int)$u['ativo'] ? 'Ativo' : 'Inativo' ?></span></td>
          <td><div class="pl-acoes"><button class="btn" data-editar='<?= h(json_encode($d, JSON_UNESCAPED_UNICODE)) ?>'>Editar</button>
            <button class="btn" data-senha="<?= (int)$u['id'] ?>" data-nome="<?= h($u['nome']) ?>">Nova senha</button>
            <?php if ($u['email']): ?><form method="post" style="display:inline"><input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="org" value="<?= (int)$orgId ?>"><input type="hidden" name="acao" value="link"><input type="hidden" name="id" value="<?= (int)$u['id'] ?>"><button class="btn">Enviar link</button></form><?php endif; ?>
            <?php if ((int)$u['id'] !== (int)$eu['id']): ?><form method="post" style="display:inline"><input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="org" value="<?= (int)$orgId ?>"><input type="hidden" name="acao" value="alternar"><input type="hidden" name="id" value="<?= (int)$u['id'] ?>"><button class="btn"><?= (int)$u['ativo'] ? 'Desativar' : 'Reativar' ?></button></form><?php endif; ?></div></td></tr>
      <?php endforeach; ?></tbody></table>
      <p class="pl-nota">Desativar um usuário libera a vaga no plano. As obras da empresa aparecem aqui assim que o administrador as cria na Central de obras: <?= $obrasOrg ? h(implode(', ', array_values($nomeObra))) : 'ainda não há obras.' ?></p>
    </section>
  </main>
</div>

<dialog class="pl-dlg" id="dlgUsr"><form method="post"><input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="org" value="<?= (int)$orgId ?>"><input type="hidden" name="acao" value="criar"><input type="hidden" name="id" value="0">
  <h3 id="dlgUsrTit">Novo usuário</h3>
  <div class="pl-form"><label>Nome<input name="nome" required maxlength="80" autocomplete="off"></label><label>Login<input name="login" required maxlength="50" autocomplete="off"></label>
    <label>E-mail<input name="email" type="email" autocomplete="off" placeholder="para recuperar a senha"></label>
    <label id="lblSenha">Senha inicial (mín. 8)<input name="senha" type="password" minlength="8" autocomplete="new-password"></label>
    <label>Perfil<select name="perfil"><option value="editor">Editor (lança e altera)</option><option value="leitura">Somente leitura</option></select></label>
    <label class="pl-check"><input type="checkbox" name="admin_empresa" value="1"> Administrador da empresa (todas as obras, cria usuários)</label>
    <fieldset class="pl-fs" id="fsObras"><legend>Obras em que entra</legend><div class="pl-mods"><?php foreach ($obrasOrg as $o): ?><label class="pl-check"><input type="checkbox" name="obras[]" value="<?= (int)$o['id'] ?>"> <?= h($o['nome']) ?></label><?php endforeach; ?><?php if (!$obrasOrg): ?><p class="pl-fim-linha">A empresa ainda não tem obras. Crie a obra na Central de obras e depois libere o usuário.</p><?php endif; ?></div></fieldset>
    <fieldset class="pl-fs" id="fsMods"><legend>Áreas do sistema</legend><div class="pl-mods"><?php foreach ($permitidas as $m): ?><label class="pl-check"><input type="checkbox" name="modulos[]" value="<?= h($m) ?>" checked> <?= h($rotulos[$m] ?? $m) ?></label><?php endforeach; ?></div></fieldset></div>
  <div class="pl-fim"><button type="button" class="btn" data-fechar>Cancelar</button><button class="btn primario" id="btnSalvarUsr">Criar usuário</button></div></form></dialog>

<dialog class="pl-dlg" id="dlgSenha"><form method="post"><input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="org" value="<?= (int)$orgId ?>"><input type="hidden" name="acao" value="senha"><input type="hidden" name="id" value="0">
  <h3 id="dlgSenhaTit">Nova senha</h3>
  <div class="pl-form"><label style="grid-column:1/-1">Nova senha (mín. 8 caracteres)<input name="senha" type="password" minlength="8" required autocomplete="new-password"></label></div>
  <div class="pl-fim"><button type="button" class="btn" data-fechar>Cancelar</button><button class="btn primario">Redefinir senha</button></div></form></dialog>
<script>
(function () {
  var $ = function (s) { return document.querySelector(s); };
  var dlg = $('#dlgUsr'), f = dlg.querySelector('form');
  function sync() { var adm = f.admin_empresa.checked; $('#fsObras').hidden = adm; $('#fsMods').hidden = adm; f.perfil.disabled = adm; }
  f.admin_empresa.addEventListener('change', sync);
  document.querySelectorAll('[data-fechar]').forEach(function (b) { b.addEventListener('click', function () { b.closest('dialog').close(); }); });
  var novo = $('#btnNovo');
  if (novo) novo.addEventListener('click', function () {
    f.reset(); f.acao.value = 'criar'; f.id.value = 0; $('#dlgUsrTit').textContent = 'Novo usuário'; $('#btnSalvarUsr').textContent = 'Criar usuário';
    f.senha.required = true; $('#lblSenha').hidden = false; f.admin_empresa.disabled = false; sync(); dlg.showModal();
  });
  document.querySelectorAll('[data-editar]').forEach(function (b) { b.addEventListener('click', function () {
    var d = JSON.parse(b.dataset.editar); f.reset(); f.acao.value = 'editar'; f.id.value = d.id; $('#dlgUsrTit').textContent = 'Editar — ' + d.nome; $('#btnSalvarUsr').textContent = 'Salvar usuário';
    f.nome.value = d.nome; f.login.value = d.login; f.email.value = d.email || ''; f.perfil.value = d.perfil;
    f.senha.required = false; $('#lblSenha').hidden = true; f.admin_empresa.checked = !!d.admin; f.admin_empresa.disabled = !!d.eu;
    f.querySelectorAll('[name="obras[]"]').forEach(function (c) { c.checked = d.obras.indexOf(parseInt(c.value, 10)) >= 0; });
    f.querySelectorAll('[name="modulos[]"]').forEach(function (c) { c.checked = d.modulos.indexOf(c.value) >= 0; });
    sync(); dlg.showModal(); }); });
  document.querySelectorAll('[data-senha]').forEach(function (b) { b.addEventListener('click', function () {
    var g = $('#dlgSenha form'); g.reset(); g.id.value = b.dataset.senha; $('#dlgSenhaTit').textContent = 'Nova senha — ' + b.dataset.nome; $('#dlgSenha').showModal(); }); });
})();
</script>
</body></html>
