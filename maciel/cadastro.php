<?php
// CADASTRO PÚBLICO DE EMPRESA (aba "Cadastro" da tela de login): a empresa vê o vídeo comercial, prints do sistema e os planos, escolhe um,
// informa os dados dela e do administrador e entra direto em PERÍODO DE TESTE (organizacoes.status = TESTE, vencimento = hoje + dias de teste).
// Reaproveita o modelo de planos: organizacao_criar() cria a empresa e o usuário administrador dela (admin_organizacao = 1), que depois cria as
// obras e a equipe dentro dos limites do plano. A contratação (pagamento) continua manual, feita pelo administrador do sistema em Comercial.
// Proteções: CSRF, campo-isca, tempo mínimo de preenchimento, limite por IP (3 por hora) e total por dia, e chave "Cadastro público aberto"
// (Comercial › Regra) para fechar o cadastro quando quiser.
require __DIR__ . '/inc/nucleo.php';
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');
if (!config()) {
    header('Location: instalar.php');
    exit;
}
iniciar_sessao();

function cd_rs($v) { return 'R$ ' . number_format((float)$v, 2, ',', '.'); }

$cfg = planos_config();
planos_semear_niveis();   // primeira abertura num banco sem planos: cria os três níveis (valores de partida, o administrador ajusta em Comercial)
$planos = array_values(array_filter(planos_listar(true), function ($p) { return (int)$p['nivel'] > 0; }));
$rotulos = planos_modulos_rotulos();
$aberto = (int)$cfg['cadastro_aberto'] === 1 && $planos;
$erros = [];
$v = ['plano_id' => (int)($_GET['plano'] ?? 0), 'ciclo' => strtoupper((string)($_GET['ciclo'] ?? 'MENSAL')) === 'ANUAL' ? 'ANUAL' : 'MENSAL',
    'nome' => '', 'documento' => '', 'telefone' => '', 'email' => '', 'admin_nome' => '', 'admin_login' => '', 'aceite' => ''];
if (!$v['plano_id'] && $planos) {
    $v['plano_id'] = (int)($planos[min(1, count($planos) - 1)]['id']);   // destaque padrão: o nível do meio
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    conferir_csrf();
    foreach (['plano_id', 'ciclo', 'nome', 'documento', 'telefone', 'email', 'admin_nome', 'admin_login'] as $k) {
        $v[$k] = trim((string)($_POST[$k] ?? ''));
    }
    $v['plano_id'] = (int)$v['plano_id'];
    $v['ciclo'] = strtoupper($v['ciclo']) === 'ANUAL' ? 'ANUAL' : 'MENSAL';
    $v['aceite'] = !empty($_POST['aceite']) ? '1' : '';
    $senha = (string)($_POST['admin_senha'] ?? '');
    $senha2 = (string)($_POST['admin_senha2'] ?? '');
    $ip = (string)($_SERVER['REMOTE_ADDR'] ?? '');
    try {
        if (!$aberto) {
            throw new InvalidArgumentException('O cadastro de novas empresas está fechado no momento. Fale com o administrador do sistema.');
        }
        // Robôs: campo-isca preenchido ou formulário enviado em menos de 3 segundos depois de aberto.
        if (trim((string)($_POST['site_url'] ?? '')) !== '' || (time() - (int)($_SESSION['cad_t'] ?? 0)) < 3) {
            sleep(2);
            throw new InvalidArgumentException('Não foi possível concluir o cadastro. Recarregue a página e tente novamente.');
        }
        $janela = date('Y-m-d H:i:s', time() - 3600);
        $porIp = (int)q_global("SELECT COUNT(*) FROM auditoria_global WHERE acao = 'cadastro_publico' AND quando >= ? AND detalhe LIKE ?", [$janela, '%"ip":"' . $ip . '"%'])->fetchColumn();
        $porDia = (int)q_global("SELECT COUNT(*) FROM auditoria_global WHERE acao = 'cadastro_publico' AND quando >= ?", [date('Y-m-d H:i:s', time() - 86400)])->fetchColumn();
        if ($porIp >= 3 || $porDia >= 40) {
            throw new InvalidArgumentException('Muitos cadastros em pouco tempo. Tente novamente mais tarde ou fale com a nossa equipe.');
        }
        if ($v['nome'] === '') { $erros['nome'] = 'Informe o nome da empresa.'; }
        if ($v['email'] === '' || !filter_var($v['email'], FILTER_VALIDATE_EMAIL)) { $erros['email'] = 'Informe um e-mail válido (é para ele que enviamos o acesso).'; }
        if ($v['admin_nome'] === '') { $erros['admin_nome'] = 'Informe o nome do responsável.'; }
        if (!preg_match('/^[A-Za-z0-9._@-]{3,50}$/', $v['admin_login'])) { $erros['admin_login'] = 'Login de 3 a 50 caracteres (letras, números, ponto, hífen, sublinhado ou @).'; }
        if (strlen($senha) < 8) { $erros['admin_senha'] = 'A senha precisa ter pelo menos 8 caracteres.'; }
        elseif ($senha !== $senha2) { $erros['admin_senha2'] = 'A confirmação da senha não confere.'; }
        if (!array_filter($planos, function ($p) use ($v) { return (int)$p['id'] === $v['plano_id']; })) { $erros['plano_id'] = 'Escolha um dos planos.'; }
        if ($v['aceite'] === '') { $erros['aceite'] = 'Confirme o aceite para continuar.'; }
        if (!$erros) {
            $hoje = planos_hoje();
            $venc = (new DateTimeImmutable($hoje, new DateTimeZone('America/Sao_Paulo')))->modify('+' . (int)$cfg['dias_teste'] . ' days')->format('Y-m-d');
            bd()->beginTransaction();
            list($orgId, $e) = organizacao_criar([
                'nome' => $v['nome'], 'documento' => $v['documento'], 'contato' => $v['admin_nome'], 'email' => $v['email'], 'telefone' => $v['telefone'],
                'plano_id' => $v['plano_id'], 'ciclo' => $v['ciclo'], 'preco' => '', 'obras_extra' => 0, 'usuarios_extra' => 0, 'status' => 'TESTE',
                'inicio' => $hoje, 'vencimento' => $venc, 'obs' => 'Cadastro público em ' . planos_agora(),
                'admin_nome' => $v['admin_nome'], 'admin_login' => $v['admin_login'], 'admin_email' => $v['email'], 'admin_senha' => $senha,
            ]);
            if ($e) {
                throw new InvalidArgumentException(implode(' ', $e));
            }
            q_global('INSERT INTO auditoria_global (quando, usuario, acao, detalhe) VALUES (?, ?, ?, ?)', [
                agora(), $v['admin_login'], 'cadastro_publico', json_encode(['org' => $orgId, 'nome' => $v['nome'], 'plano' => $v['plano_id'], 'ciclo' => $v['ciclo'], 'ip' => $ip], JSON_UNESCAPED_UNICODE)]);
            bd()->commit();
            // Avisos por e-mail (falha de envio não desfaz o cadastro).
            $sistema = global_ler('nome_sistema', 'Núcleo de Obras');
            $plano = q_global('SELECT nome FROM planos_assinatura WHERE id = ?', [$v['plano_id']])->fetchColumn();
            $link = url_base_sistema() . '/login.php';
            try {
                enviar_email_sistema($v['email'], 'Bem-vindo ao ' . $sistema . ' — seu teste começou',
                    "Olá, {$v['admin_nome']}.\n\nA empresa {$v['nome']} foi cadastrada no {$sistema} com o {$plano}.\nO período de teste vai até " . date('d/m/Y', strtotime($venc)) . ".\n\nSeu login de acesso: {$v['admin_login']}\nEntre em: {$link}\n\nPor lá você cria as obras e cadastra a equipe da empresa.");
                foreach (q_global("SELECT email FROM usuarios WHERE perfil = 'admin' AND ativo = 1 AND email IS NOT NULL AND email <> ''")->fetchAll(PDO::FETCH_COLUMN) as $para) {
                    enviar_email_sistema($para, 'Novo cadastro de empresa: ' . $v['nome'],
                        "Uma empresa se cadastrou pela tela de login.\n\nEmpresa: {$v['nome']}\nCNPJ: " . ($v['documento'] ?: '—') . "\nResponsável: {$v['admin_nome']} ({$v['email']})\nTelefone: " . ($v['telefone'] ?: '—') . "\nPlano: {$plano} · ciclo " . strtolower($v['ciclo']) . "\nTeste até: " . date('d/m/Y', strtotime($venc)) . "\n\nAcompanhe em Comercial (admin_planos.php).");
                }
            } catch (Throwable $e) { /* sem e-mail configurado: segue */ }
            // Entra direto (a menos que o sistema esteja em manutenção).
            if (empty(manutencao_info()['ativo'])) {
                $u = q_global('SELECT id, login FROM usuarios WHERE login = ?', [$v['admin_login']])->fetch();
                if ($u && session_regenerate_id(true)) {
                    $_SESSION['uid'] = (int)$u['id'];
                    $_SESSION['ultimo'] = time();
                    $_SESSION['obra_id'] = 0;
                    $_SESSION['csrf'] = bin2hex(random_bytes(16));
                    registrar_global('login', ['login' => $u['login'], 'origem' => 'cadastro']);
                    header('Location: obras.php');
                    exit;
                }
            }
            header('Location: login.php');
            exit;
        }
    } catch (InvalidArgumentException $e) {
        if (bd()->inTransaction()) { bd()->rollBack(); }
        $erros['geral'] = $e->getMessage();
    } catch (Throwable $e) {
        if (bd()->inTransaction()) { bd()->rollBack(); }
        $erros['geral'] = 'Não foi possível concluir o cadastro agora. Tente novamente em instantes.';
    }
}
$_SESSION['cad_t'] = time();

$nomeSistema = global_ler('nome_sistema', 'Núcleo de Obras');
$logo = global_ler('logo', '');
$midia = 'assets/cadastro/';
$temVideo = is_file(__DIR__ . '/' . $midia . 'video-obras-gerais.mp4');
$temVideoH = is_file(__DIR__ . '/' . $midia . 'video-obras-gerais-horizontal.mp4');   // versão 16:9 para computador (a vertical 9:16 fica para o celular)
$prints = [
    ['print-painel', 'Painel de gestão à vista', 'Farol por serviço, pontos de atenção e impactos da obra em uma tela.'],
    ['print-mapa', 'Mapa de montagem', 'Marque a peça no mapa: produção, medição e baixa de estoque se atualizam sozinhas.'],
    ['print-medicao', 'Medição (BM)', 'Ganho produtivo × gasto do período, valor a faturar e saldo a medir.'],
    ['print-qualidade', 'Qualidade', 'Não conformidade por empresa, com resposta, fotos e validação do administrador.'],
    ['print-rdo', 'Relatório diário de obra', 'RDO para o cliente e para a gestão, em PDF, com mapas e fotos.'],
    ['print-lancamentos', 'Lançamentos de produção', 'Produção diária por atividade do catálogo do BM.'],
];
$prints = array_values(array_filter($prints, function ($p) use ($midia) { return is_file(__DIR__ . '/' . $midia . $p[0] . '.jpg'); }));
$campoErro = function ($k) use ($erros) { return isset($erros[$k]) ? '<small class="cad-erro">' . h($erros[$k]) . '</small>' : ''; };

pagina_inicio('Cadastro');
echo '<link rel="stylesheet" href="cadastro.css?v=' . (int)@filemtime(__DIR__ . '/cadastro.css') . '">';
?>
<div class="cad-shell">
  <header class="cad-topo">
    <div class="cad-marca"><?php if ($logo): ?><img src="<?= h($logo) ?>" alt=""><?php else: ?><span>NO</span><?php endif; ?><strong><?= h($nomeSistema) ?></strong></div>
    <nav class="cad-abas" aria-label="Acesso"><a href="login.php">Entrar</a><a href="cadastro.php" class="ativa" aria-current="page">Cadastro</a></nav>
  </header>

  <section class="cad-hero">
    <div class="cad-hero-txt">
      <span class="cad-eyebrow">TESTE <?= (int)$cfg['dias_teste'] ?> DIAS · SEM CARTÃO</span>
      <h1>Cadastre sua empresa e<br>coloque a obra sob controle.</h1>
      <p>Produção, suprimentos, qualidade, medição e indicadores em um só sistema. Veja como funciona, escolha o plano e comece agora: o seu acesso é liberado na hora.</p>
      <div class="cad-hero-acoes"><a class="cad-btn" href="#planos">Ver planos</a><a class="cad-btn sec" href="#cadastro">Cadastrar minha empresa</a></div>
    </div>
    <div class="cad-video<?= !empty($temVideoH) ? ' tem-h' : '' ?>">
      <?php if ($temVideo): ?>
        <?php if ($temVideoH): ?><video class="cad-v-pc" controls preload="none" playsinline poster="<?= h($midia) ?>video-obras-gerais-horizontal-capa.jpg"><source src="<?= h($midia) ?>video-obras-gerais-horizontal.mp4" type="video/mp4">Seu navegador não reproduz vídeo.</video><?php endif; ?>
        <video class="cad-v-cel" controls preload="none" playsinline poster="<?= h($midia) ?>video-obras-gerais-capa.jpg"><source src="<?= h($midia) ?>video-obras-gerais.mp4" type="video/mp4">Seu navegador não reproduz vídeo.</video>
      <?php else: ?>
        <div class="cad-video-vazio">Vídeo comercial em breve</div>
      <?php endif; ?>
    </div>
  </section>

  <?php if ($prints): ?>
  <section class="cad-sec" id="prints">
    <h2>O sistema por dentro</h2>
    <p class="cad-sub">Telas reais, com dados de demonstração. Clique para ampliar.</p>
    <div class="cad-galeria">
      <?php foreach ($prints as $p): ?>
        <figure><button type="button" class="cad-zoom" data-src="<?= h($midia . $p[0]) ?>.jpg" data-leg="<?= h($p[1]) ?>"><img src="<?= h($midia . $p[0]) ?>.jpg" alt="<?= h($p[1]) ?>" loading="lazy"></button>
          <figcaption><strong><?= h($p[1]) ?></strong><span><?= h($p[2]) ?></span></figcaption></figure>
      <?php endforeach; ?>
    </div>
  </section>
  <?php endif; ?>

  <?php if (!$aberto): ?>
    <section class="cad-sec"><div class="cad-aviso">O cadastro de novas empresas está fechado no momento. Se você já tem acesso, <a href="login.php">entre no sistema</a>.</div></section>
  <?php else: ?>
  <form method="post" id="formCad" autocomplete="off" novalidate>
    <input type="hidden" name="csrf" value="<?= h(token_csrf()) ?>">
    <div class="cad-isca" aria-hidden="true"><label>Não preencha este campo<input type="text" name="site_url" tabindex="-1" autocomplete="off"></label></div>

    <section class="cad-sec" id="planos">
      <h2>Escolha o plano</h2>
      <p class="cad-sub">O plano é da empresa, não por usuário: ele define quantas obras e usuários a empresa pode ter e quais áreas do sistema ficam liberadas. Você testa por <?= (int)$cfg['dias_teste'] ?> dias antes de contratar.</p>
      <div class="cad-ciclo" role="radiogroup" aria-label="Ciclo de cobrança">
        <label><input type="radio" name="ciclo" value="MENSAL" <?= $v['ciclo'] === 'MENSAL' ? 'checked' : '' ?>><span>Mensal</span></label>
        <label><input type="radio" name="ciclo" value="ANUAL" <?= $v['ciclo'] === 'ANUAL' ? 'checked' : '' ?>><span>Anual</span></label>
      </div>
      <?= $campoErro('plano_id') ?>
      <div class="cad-planos">
        <?php foreach ($planos as $p):
            $mods = array_intersect_key($rotulos, array_flip(plano_modulos($p)));
            $itens = array_values(array_filter(array_map('trim', preg_split('/\R/', (string)($p['itens'] ?? '')))));
            $pm = (float)$p['preco_mensal']; $pa = (float)$p['preco_anual'];
            $econ = $pm > 0 && $pa > 0 ? (int)round((1 - $pa / ($pm * 12)) * 100) : 0;
            $obras = (int)$p['max_obras'] === 0 ? 'Obras ilimitadas' : (int)$p['max_obras'] . ((int)$p['max_obras'] === 1 ? ' obra' : ' obras');
            $users = (int)$p['max_usuarios'] === 0 ? 'Usuários ilimitados' : (int)$p['max_usuarios'] . ((int)$p['max_usuarios'] === 1 ? ' usuário' : ' usuários');
        ?>
        <label class="cad-plano<?= (int)$p['id'] === $v['plano_id'] ? ' sel' : '' ?>" data-mensal="<?= h(number_format($pm, 2, ',', '.')) ?>" data-anual="<?= h(number_format($pa, 2, ',', '.')) ?>">
          <input type="radio" name="plano_id" value="<?= (int)$p['id'] ?>" <?= (int)$p['id'] === $v['plano_id'] ? 'checked' : '' ?>>
          <span class="cad-plano-nivel">Nível <?= (int)$p['nivel'] ?></span>
          <strong class="cad-plano-nome"><?= h($p['nome']) ?></strong>
          <span class="cad-preco"><b class="cad-preco-v">R$ <?= number_format($v['ciclo'] === 'ANUAL' ? $pa : $pm, 2, ',', '.') ?></b><em class="cad-preco-c"><?= $v['ciclo'] === 'ANUAL' ? '/ano' : '/mês' ?></em></span>
          <span class="cad-preco-alt"><span class="alt-m">ou <?= h(cd_rs($pa)) ?>/ano<?= $econ > 0 ? ' · economize ' . $econ . '%' : '' ?></span><span class="alt-a">ou <?= h(cd_rs($pm)) ?>/mês</span></span>
          <ul class="cad-limites"><li><?= h($obras) ?></li><li><?= h($users) ?></li></ul>
          <span class="cad-areas-t">Áreas liberadas</span>
          <span class="cad-areas"><?php foreach ($mods as $r): ?><i><?= h($r) ?></i><?php endforeach; ?></span>
          <?php if ($itens): ?><ul class="cad-itens"><?php foreach ($itens as $it): ?><li><?= h($it) ?></li><?php endforeach; ?></ul><?php endif; ?>
          <span class="cad-escolher"><span class="n">Escolher este plano</span><span class="s">Plano escolhido ✓</span></span>
        </label>
        <?php endforeach; ?>
      </div>
    </section>

    <section class="cad-sec cad-form-sec" id="cadastro">
      <h2>Cadastre sua empresa</h2>
      <p class="cad-sub">Você será o administrador da empresa: cria as obras e cadastra a equipe. Os dados abaixo valem para o seu teste.</p>
      <?php if (!empty($erros['geral'])): ?><div class="cad-aviso erro" role="alert"><?= h($erros['geral']) ?></div><?php elseif ($erros): ?><div class="cad-aviso erro" role="alert">Confira os campos em vermelho e envie novamente.</div><?php endif; ?>
      <div class="cad-grade">
        <fieldset><legend>Empresa</legend>
          <label class="<?= isset($erros['nome']) ? 'tem-erro' : '' ?>">Nome da empresa *<input name="nome" value="<?= h($v['nome']) ?>" maxlength="120" required autocomplete="organization"><?= $campoErro('nome') ?></label>
          <label>CNPJ <small>(opcional)</small><input name="documento" value="<?= h($v['documento']) ?>" maxlength="30" inputmode="numeric" placeholder="00.000.000/0000-00"></label>
          <label>Telefone <small>(opcional)</small><input name="telefone" value="<?= h($v['telefone']) ?>" maxlength="30" inputmode="tel" autocomplete="tel"></label>
          <label class="<?= isset($erros['email']) ? 'tem-erro' : '' ?>">E-mail *<input name="email" type="email" value="<?= h($v['email']) ?>" maxlength="150" required autocomplete="email"><?= $campoErro('email') ?></label>
        </fieldset>
        <fieldset><legend>Administrador da empresa</legend>
          <label class="<?= isset($erros['admin_nome']) ? 'tem-erro' : '' ?>">Seu nome *<input name="admin_nome" value="<?= h($v['admin_nome']) ?>" maxlength="100" required autocomplete="name"><?= $campoErro('admin_nome') ?></label>
          <label class="<?= isset($erros['admin_login']) ? 'tem-erro' : '' ?>">Login de acesso *<input name="admin_login" value="<?= h($v['admin_login']) ?>" maxlength="50" required autocomplete="username" autocapitalize="off" placeholder="ex.: maria.silva"><?= $campoErro('admin_login') ?></label>
          <label class="<?= isset($erros['admin_senha']) ? 'tem-erro' : '' ?>">Senha * <small>(mínimo 8 caracteres)</small><input name="admin_senha" type="password" required autocomplete="new-password"><?= $campoErro('admin_senha') ?></label>
          <label class="<?= isset($erros['admin_senha2']) ? 'tem-erro' : '' ?>">Repita a senha *<input name="admin_senha2" type="password" required autocomplete="new-password"><?= $campoErro('admin_senha2') ?></label>
        </fieldset>
      </div>
      <label class="cad-aceite<?= isset($erros['aceite']) ? ' tem-erro' : '' ?>"><input type="checkbox" name="aceite" value="1" <?= $v['aceite'] ? 'checked' : '' ?>> Concordo em criar a conta de teste e em receber contato da equipe comercial sobre o plano escolhido. Os dados informados são usados apenas para o cadastro e o acesso ao sistema.<?= $campoErro('aceite') ?></label>
      <button class="cad-btn grande" type="submit">Criar minha empresa e começar o teste</button>
      <p class="cad-rodape">Já tem acesso? <a href="login.php">Entrar no sistema</a></p>
    </section>
  </form>
  <?php endif; ?>
</div>

<dialog id="cadLightbox" class="cad-lightbox"><form method="dialog"><button class="cad-fechar" aria-label="Fechar">✕</button></form><img alt=""><p></p></dialog>
<script>
(function () {
  var f = document.getElementById('formCad');
  if (f) {
    var cards = f.querySelectorAll('.cad-plano');
    function ciclo() { var r = f.querySelector('input[name=ciclo]:checked'); return r ? r.value : 'MENSAL'; }
    function pintar() {
      var anual = ciclo() === 'ANUAL';
      f.classList.toggle('anual', anual);
      cards.forEach(function (c) {
        var r = c.querySelector('input[type=radio]');
        c.classList.toggle('sel', r.checked);
        c.querySelector('.cad-preco-v').textContent = 'R$ ' + (anual ? c.dataset.anual : c.dataset.mensal);
        c.querySelector('.cad-preco-c').textContent = anual ? '/ano' : '/mês';
      });
    }
    f.addEventListener('change', function (e) { if (e.target.name === 'ciclo' || e.target.name === 'plano_id') pintar(); });
    pintar();
    f.addEventListener('submit', function () { var b = f.querySelector('button[type=submit]'); setTimeout(function () { b.disabled = true; b.textContent = 'Criando…'; }, 0); });
    var erro = f.querySelector('.cad-aviso.erro');
    if (erro) { erro.scrollIntoView({ block: 'center' }); }
  }
  var lb = document.getElementById('cadLightbox');
  document.querySelectorAll('.cad-zoom').forEach(function (b) {
    b.addEventListener('click', function () { lb.querySelector('img').src = b.dataset.src; lb.querySelector('p').textContent = b.dataset.leg; if (lb.showModal) lb.showModal(); });
  });
  lb.addEventListener('click', function (e) { if (e.target === lb) lb.close(); });
})();
</script>
</body></html>
