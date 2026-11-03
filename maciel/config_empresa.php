<?php
// Configurações da Central da empresa: dados da empresa e textos padrão das propostas, tema do sistema, logo e cor dos relatórios oficiais
// e o acesso aos usuários da empresa. O administrador da empresa edita a própria empresa; o administrador do sistema abre qualquer uma
// por config_empresa.php?org=ID. Quem só administra obras (sem empresa cliente) vê apenas o tema do próprio usuário.
require __DIR__ . '/inc/nucleo.php';
require __DIR__ . '/inc/modelo.php';
require __DIR__ . '/inc/central.php';
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

$eu = central_exigir();
$sistema = ($eu['perfil'] ?? '') === 'admin';
list($meuOrg, $admOrg) = usuario_organizacao_id($eu);
$orgId = $sistema ? (int)($_GET['org'] ?? $_POST['org'] ?? 0) : ($admOrg ? $meuOrg : 0);
$org = $orgId ? organizacao_ler($orgId) : null;
if ($orgId && !$org) { http_response_code(404); exit('Empresa não encontrada.'); }
$v = (string)($_GET['v'] ?? 'empresa');
if (!in_array($v, ['empresa', 'aparencia', 'logos'], true)) { $v = 'empresa'; }
if (!$org && $v !== 'aparencia') { $v = 'aparencia'; }   // sem empresa cliente só existe o tema pessoal

$msg = ''; $erro = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    conferir_csrf();
    $acao = (string)($_POST['acao'] ?? '');
    try {
        if ($acao === 'tema') {
            $tema = (string)($_POST['tema'] ?? '');
            if ($tema !== '' && !in_array($tema, TEMAS_VALIDOS, true)) { throw new InvalidArgumentException('Tema inválido.'); }
            $menu = (string)($_POST['menu'] ?? 'lateral');
            if (!in_array($menu, MENUS_VALIDOS, true)) { throw new InvalidArgumentException('Posição do menu inválida.'); }
            q_global('UPDATE usuarios SET tema = ?, menu_pos = ? WHERE id = ?', [$tema !== '' ? $tema : null, $menu === 'topo' ? 'topo' : null, $eu['id']]);
            $msg = 'Tema salvo. Vale para o seu usuário na tela das obras (dentro do sistema), no dashboard e nos relatórios na tela.';
            $v = 'aparencia';
        } elseif ($org && $acao === 'empresa') {
            cfg_perfil_salvar($orgId, $_POST, $eu);
            $org = organizacao_ler($orgId);
            $msg = 'Dados da empresa salvos. Os textos padrão já valem nos próximos orçamentos e propostas.';
            $v = 'empresa';
        } elseif ($org && $acao === 'identidade') {
            cfg_identidade_salvar($orgId, $_POST, $eu, !empty($_POST['remover_logo']));
            $msg = 'Identidade dos relatórios salva. Os próximos relatórios e propostas já saem com o seu logo e a sua cor.';
            $v = 'logos';
        } elseif ($org && $acao === 'identidade_remover') {
            cfg_identidade_salvar($orgId, ['cor_padrao' => 1], $eu, true);
            $msg = 'Identidade removida: os relatórios voltam ao padrão.';
            $v = 'logos';
        } else {
            throw new InvalidArgumentException('Ação inválida.');
        }
    } catch (InvalidArgumentException $e) {
        $erro = $e->getMessage();
        if ($acao === 'identidade' || $acao === 'identidade_remover') { $v = 'logos'; } elseif ($acao === 'tema') { $v = 'aparencia'; }
    }
    if (!$erro) { $_SESSION['cfg_aviso'] = [$msg, '']; header('Location: config_empresa.php?' . ($sistema && $orgId ? 'org=' . $orgId . '&' : '') . 'v=' . $v); exit; }
}
if (!empty($_SESSION['cfg_aviso'])) { list($msg, $erro) = $_SESSION['cfg_aviso']; unset($_SESSION['cfg_aviso']); }

$csrf = token_csrf();
$perfil = $org ? cfg_perfil_ler($orgId) : null;
$ident = $org ? cfg_identidade_ler($orgId) : null;
$temaAtual = tema_do_usuario();
$menuAtual = menu_do_usuario();
$corPadrao = cor_segura(global_ler('cor_primaria', '#d97706'), '#d97706');
$q = $sistema && $orgId ? '?org=' . $orgId : '';

central_topo('Configurações', 'config', $eu, $org ? $org['nome'] : 'Central da empresa');
?>
<main class="ce-main">
  <section class="ce-hero"><div><span class="ce-eyebrow">CONFIGURAÇÕES</span><h1><?= $org ? h($org['nome']) : 'Suas preferências' ?></h1>
    <p><?= $org ? 'Dados da empresa, tema do sistema, logo dos relatórios oficiais e usuários — tudo o que é do cliente fica reunido aqui.' : 'Escolha o tema do sistema. As configurações da empresa ficam com o administrador da empresa.' ?></p></div>
    <?php if ($sistema && !$org): ?><a class="btn" href="sistema.php?v=empresas">Escolher uma empresa cliente →</a><?php endif; ?></section>
  <?= cfg_sub($v === 'empresa' ? 'empresa' : $v, $eu, $orgId) ?>
  <?php if ($msg): ?><div class="toast ok-faixa"><?= h($msg) ?></div><?php endif; ?>
  <?php if ($erro): ?><div class="toast erro-form"><?= h($erro) ?></div><?php endif; ?>

  <?php if ($v === 'empresa' && $org): ?>
  <section class="ce-bloco"><h2>Dados da empresa</h2>
    <p>Aparecem no cabeçalho das propostas comerciais e nos relatórios oficiais. O plano contratado e os limites são definidos pela administração do sistema.</p>
    <form method="post" class="ce-form"><input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="acao" value="empresa"><?php if ($sistema): ?><input type="hidden" name="org" value="<?= (int)$orgId ?>"><?php endif; ?>
      <label>Nome fantasia (aparece nos relatórios)<input name="nome" required maxlength="120" value="<?= h($org['nome']) ?>"></label>
      <label>Razão social<input name="razao" maxlength="200" value="<?= h($perfil['razao']) ?>"></label>
      <label>CNPJ<input name="documento" maxlength="30" value="<?= h($org['documento']) ?>"></label>
      <label>Responsável / contato<input name="contato" maxlength="120" value="<?= h($org['contato']) ?>"></label>
      <label>E-mail<input name="email" type="email" maxlength="150" value="<?= h($org['email']) ?>"></label>
      <label>Telefone<input name="telefone" maxlength="30" value="<?= h($org['telefone']) ?>"></label>
      <label>Endereço<input name="endereco" maxlength="200" value="<?= h($perfil['endereco']) ?>"></label>
      <label>Cidade / UF<input name="cidade" maxlength="200" value="<?= h($perfil['cidade']) ?>"></label>
      <label>Site<input name="site" maxlength="200" placeholder="www.suaempresa.com.br" value="<?= h($perfil['site']) ?>"></label>
      <label>Responsável técnico<input name="resp_tecnico" maxlength="200" value="<?= h($perfil['resp_tecnico']) ?>"></label>
      <label>CREA / registro<input name="crea" maxlength="200" value="<?= h($perfil['crea']) ?>"></label>
      <label class="full">Rodapé dos relatórios e propostas<textarea name="rodape" maxlength="2000" placeholder="Ex.: Empresa Ltda · CNPJ 00.000.000/0001-00 · Rua … · contato@empresa.com.br"><?= h($perfil['rodape']) ?></textarea></label>
      <h3 class="full" style="margin:8px 0 0">Padrões do painel comercial</h3>
      <label>Validade da proposta (dias)<input name="validade_dias" inputmode="numeric" value="<?= h($perfil['validade_dias']) ?>"></label>
      <label>BDI padrão (%)<input name="bdi_pct" inputmode="decimal" value="<?= h(str_replace('.', ',', (string)$perfil['bdi_pct'])) ?>"></label>
      <label class="full">Condições de pagamento padrão<textarea name="pagamento_padrao" maxlength="2000"><?= h($perfil['pagamento_padrao']) ?></textarea></label>
      <label class="full">Itens não incluídos (padrão)<textarea name="exclusoes_padrao" maxlength="2000"><?= h($perfil['exclusoes_padrao']) ?></textarea></label>
      <label class="full">Observações padrão da proposta<textarea name="obs_padrao" maxlength="2000"><?= h($perfil['obs_padrao']) ?></textarea></label>
      <div class="ce-acoes full"><button class="btn primario" type="submit">Salvar dados da empresa</button></div>
    </form></section>
  <?php $sit = organizacao_situacao($org); $cfgPl = planos_config(); ?>
  <section class="ce-bloco"><h2>Plano contratado</h2>
    <p>Somente leitura: alterações de plano, limites e pagamento são feitas com a administração do sistema.</p>
    <div class="ce-grid" style="margin:0">
      <div class="ce-num"><small>Plano</small><b style="font-size:1.1rem"><?= h($org['plano_nome'] ?: 'Sem plano') ?></b><span><?= h($sit['rotulo']) ?><?= !empty($org['vencimento']) ? ' · vence em ' . h(central_dt($org['vencimento'])) : '' ?></span></div>
      <div class="ce-num"><small>Obras</small><b><?= (int)organizacao_obras_em_uso($orgId) ?><?= ($lo = organizacao_limite_obras($org)) > 0 ? ' de ' . (int)$lo : '' ?></b><span><?= $lo > 0 ? 'em uso do plano' : 'ilimitadas' ?></span></div>
      <div class="ce-num"><small>Usuários</small><b><?= (int)organizacao_usuarios_em_uso($orgId) ?><?= ($lu = organizacao_limite_usuarios($org)) > 0 ? ' de ' . (int)$lu : '' ?></b><span><?= $lu > 0 ? 'em uso do plano' : 'ilimitados' ?> · <a href="empresa_usuarios.php<?= h($q) ?>">gerenciar</a></span></div>
    </div></section>
  <?php endif; ?>

  <?php if ($v === 'aparencia'): ?>
  <section class="ce-bloco"><h2>Tema do sistema</h2>
    <p>É uma preferência do <b>seu usuário</b>: vale ao abrir uma obra, nos dashboards e nos relatórios na tela. A Central e as telas de cadastro mantêm o visual claro para ficarem legíveis em qualquer aparelho.</p>
    <form method="post"><input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="acao" value="tema"><?php if ($sistema && $orgId): ?><input type="hidden" name="org" value="<?= (int)$orgId ?>"><?php endif; ?>
      <div class="cfg-temas">
      <?php foreach ([['light', 'Branco', 'Claro, fundo branco-gelo', '#f6f7f9', '#ffffff', '#d97706'], ['dark', 'Preto', 'Escuro, descansa a vista', '#0f1115', '#1b1f27', '#f59e0b'], ['space', 'Espacial', 'Nebulosa azul-noite, cartões de vidro', '#0b1230', '#1d2a5e', '#7c9cff'],
          ['nevoa', 'Névoa', 'Claro e suave, azul-índigo', '#eef1f8', '#ffffff', '#5b6cff'], ['grafite', 'Grafite', 'Menu escuro, destaque vermelho', '#2a2d34', '#f4f5f7', '#e5484d'], ['salvia', 'Sálvia', 'Areia e verde-sálvia', '#f3eee4', '#fbf9f4', '#6f8f72'], ['', 'Automático', 'Segue o aparelho (claro ou escuro)', '#f6f7f9', '#0f1115', '#d97706']] as [$val, $rot, $dica, $c1, $c2, $c3]): ?>
        <label class="cfg-tema<?= $temaAtual === $val ? ' sel' : '' ?>"><input type="radio" name="tema" value="<?= h($val) ?>" <?= $temaAtual === $val ? 'checked' : '' ?>>
          <span class="cfg-prev" style="background:linear-gradient(90deg,<?= h($c1) ?> 0 50%,<?= h($c2) ?> 50% 100%)"><i style="background:<?= h($c3) ?>"></i></span><b><?= h($rot) ?></b><small><?= h($dica) ?></small></label>
      <?php endforeach; ?></div>
      <h3 style="margin:18px 0 8px">Posição do menu</h3>
      <div class="cfg-menus">
        <label class="cfg-menu<?= $menuAtual === 'lateral' ? ' sel' : '' ?>"><input type="radio" name="menu" value="lateral" <?= $menuAtual === 'lateral' ? 'checked' : '' ?>><b>Lateral</b><small>Áreas e abas na coluna da esquerda</small></label>
        <label class="cfg-menu<?= $menuAtual === 'topo' ? ' sel' : '' ?>"><input type="radio" name="menu" value="topo" <?= $menuAtual === 'topo' ? 'checked' : '' ?>><b>Barra superior</b><small>Áreas viram abas no topo da tela</small></label>
      </div>
      <div class="ce-acoes"><button class="btn primario" type="submit">Salvar tema</button></div>
    </form></section>
  <?php endif; ?>

  <?php if ($v === 'logos' && $org): ?>
  <section class="ce-bloco"><h2>Logo e cor dos relatórios oficiais</h2>
    <p>O logo vai na capa dos relatórios (lado “Gestão”, junto do nome da obra), nos PDFs e na proposta comercial; as duas cores (principal e secundária) substituem as cores padrão de todo o layout do relatório. O cliente final continua sendo a Rótula nos relatórios de obra. Use PNG com fundo transparente, de preferência com proporção horizontal (até 480 × 160 px — imagens maiores são reduzidas).</p>
    <div class="cfg-ident">
      <div class="cfg-capa" style="--tv:<?= h($ident['cor'] ?: $corPadrao) ?>;--ta:<?= h($ident['cor2'] ?: '#101828') ?>">
        <small>PRÉVIA DA CAPA</small>
        <div class="cfg-capa-marcas"><span class="cfg-chip"><?php if ($ident['logo']): ?><img src="<?= h($ident['logo']) ?>" alt="Logo da empresa"><?php else: ?><i>sem logo</i><?php endif; ?></span><span class="cfg-chip cfg-rot">RÓTULA</span></div>
        <b>Relatório de produção</b><span><?= h($org['nome']) ?></span></div>
      <form method="post" enctype="multipart/form-data" class="ce-form" style="flex:1;min-width:260px"><input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="acao" value="identidade"><?php if ($sistema): ?><input type="hidden" name="org" value="<?= (int)$orgId ?>"><?php endif; ?>
        <label class="full">Logo (PNG, JPG ou WEBP)<input type="file" name="logo" accept="image/png,image/jpeg,image/webp"></label>
        <label>Cor principal (destaques, capa)<input type="color" name="cor" value="<?= h($ident['cor'] ?: $corPadrao) ?>" style="height:44px;padding:3px"></label>
        <label style="justify-content:flex-end;flex-direction:row;align-items:center;gap:8px"><input type="checkbox" name="cor_padrao" value="1" <?= $ident['cor'] === '' ? 'checked' : '' ?> style="width:auto"> Usar a cor principal padrão</label>
        <label>Cor secundária (títulos, tabelas, rodapé)<input type="color" name="cor2" value="<?= h($ident['cor2'] ?: '#0b4f9c') ?>" style="height:44px;padding:3px"></label>
        <label style="justify-content:flex-end;flex-direction:row;align-items:center;gap:8px"><input type="checkbox" name="cor2_padrao" value="1" <?= $ident['cor2'] === '' ? 'checked' : '' ?> style="width:auto"> Usar a cor secundária padrão</label>
        <?php if ($ident['logo']): ?><label class="full" style="flex-direction:row;align-items:center;gap:8px"><input type="checkbox" name="remover_logo" value="1" style="width:auto"> Remover o logo atual</label><?php endif; ?>
        <?php if ($ident['em']): ?><span class="ce-nota full">Última alteração: <?= h($ident['em']) ?><?= $ident['por'] ? ' por ' . h($ident['por']) : '' ?>.</span><?php endif; ?>
        <div class="ce-acoes full"><button class="btn primario" type="submit">Salvar identidade</button></div>
      </form>
      <?php if ($ident['logo'] || $ident['cor'] || $ident['cor2']): ?>
      <form method="post" onsubmit="return confirm('Voltar os relatórios ao padrão (sem logo e sem cor própria)?')"><input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="acao" value="identidade_remover"><?php if ($sistema): ?><input type="hidden" name="org" value="<?= (int)$orgId ?>"><?php endif; ?><button class="btn ghost" type="submit">Voltar ao padrão</button></form>
      <?php endif; ?>
    </div></section>
  <?php endif; ?>
</main></div>
<script>document.querySelectorAll('.cfg-tema input,.cfg-menu input').forEach(function(i){i.addEventListener('change',function(){var g=i.closest('.cfg-temas,.cfg-menus');g.querySelectorAll('label').forEach(function(l){l.classList.toggle('sel',l.contains(i)&&i.checked)});});});</script>
</body></html>
