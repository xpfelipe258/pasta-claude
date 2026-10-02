<?php
require __DIR__ . '/inc/nucleo.php';
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');

$eu = exigir_login_pagina();
$admin = $eu['perfil'] === 'admin';
$msg = '';
$erro = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    conferir_csrf();
    $acao = $_POST['acao'] ?? '';
    try {
        if ($acao === 'abrir') {
            $id = (int)($_POST['obra_id'] ?? 0);
            $obra = q_global("SELECT * FROM obras WHERE id = ? AND status = 'ativa'", [$id])->fetch();
            if (!$obra || !usuario_pode_obra($eu, $id)) {
                throw new InvalidArgumentException('Obra indisponível para este usuário.');
            }
            definir_obra_atual($id);
            registrar_global('obra_aberta', ['obra_id' => $id]);
            header('Location: index.php');
            exit;
        }
        if (!$admin) { throw new InvalidArgumentException('Apenas administradores podem alterar o portfólio.'); }

        if ($acao === 'criar_obra') {
            $nome = trim((string)($_POST['nome'] ?? ''));
            if ($nome === '') { throw new InvalidArgumentException('Informe o nome da obra.'); }
            $ini = data_valida($_POST['data_inicio'] ?? '') ? $_POST['data_inicio'] : date('Y-m-d');
            $fim = data_valida($_POST['data_fim'] ?? '') ? $_POST['data_fim'] : date('Y-m-d', strtotime('+1 year'));
            if ($fim < $ini) { throw new InvalidArgumentException('A data final deve ser posterior à inicial.'); }
            $logo = imagem_upload_para_data_uri('logo_obra');
            q_global("INSERT INTO obras (nome, codigo, cliente, cidade, data_inicio, data_fim, status, cor_primaria, cor_secundaria, logo, criado_em)
                VALUES (?, ?, ?, ?, ?, ?, 'ativa', ?, ?, ?, ?)", [
                $nome, texto_ou_nulo($_POST['codigo'] ?? null), texto_ou_nulo($_POST['cliente'] ?? null),
                texto_ou_nulo($_POST['cidade'] ?? null), $ini, $fim,
                cor_segura($_POST['cor_primaria'] ?? '', '#d97706'),
                cor_segura($_POST['cor_secundaria'] ?? '', '#111827'), $logo, agora()
            ]);
            $id = (int)bd()->lastInsertId();
            foreach (['obra_nome' => $nome, 'data_inicio' => $ini, 'data_fim' => $fim, 'versao' => '0', 'modificado' => date('c'), 'dados_legados' => '0'] as $k => $v) {
                q_global('INSERT INTO obra_config (obra_id, chave, valor) VALUES (?, ?, ?)', [$id, $k, $v]);
            }
            q_global('INSERT INTO usuarios_obras (usuario_id, obra_id) VALUES (?, ?)', [(int)$eu['id'], $id]);
            if (!empty($_POST['copiar_estrutura']) && obra_atual_id() > 0) {
                copiar_estrutura_obra(obra_atual_id(), $id);
            }
            registrar_global('obra_criada', ['obra_id' => $id, 'nome' => $nome]);
            $msg = 'Obra criada. Ela começa sem produção, estoque, medições ou apontamentos.';
        } elseif ($acao === 'editar_obra') {
            $id = (int)($_POST['obra_id'] ?? 0);
            $atual = q_global('SELECT * FROM obras WHERE id = ?', [$id])->fetch();
            if (!$atual) { throw new InvalidArgumentException('Obra não encontrada.'); }
            $nome = trim((string)($_POST['nome'] ?? ''));
            if ($nome === '') { throw new InvalidArgumentException('Informe o nome da obra.'); }
            $logo = !empty($_POST['remover_logo']) ? '' : imagem_upload_para_data_uri('logo_obra', $atual['logo'] ?? '');
            q_global('UPDATE obras SET nome=?, codigo=?, cliente=?, cidade=?, data_inicio=?, data_fim=?, cor_primaria=?, cor_secundaria=?, logo=? WHERE id=?', [
                $nome, texto_ou_nulo($_POST['codigo'] ?? null), texto_ou_nulo($_POST['cliente'] ?? null),
                texto_ou_nulo($_POST['cidade'] ?? null), $_POST['data_inicio'] ?: null, $_POST['data_fim'] ?: null,
                cor_segura($_POST['cor_primaria'] ?? '', '#d97706'), cor_segura($_POST['cor_secundaria'] ?? '', '#111827'), $logo, $id
            ]);
            foreach (['obra_nome' => $nome, 'data_inicio' => $_POST['data_inicio'], 'data_fim' => $_POST['data_fim']] as $k => $v) {
                q_global('DELETE FROM obra_config WHERE obra_id=? AND chave=?', [$id, $k]);
                q_global('INSERT INTO obra_config (obra_id,chave,valor) VALUES (?,?,?)', [$id, $k, $v]);
            }
            registrar_global('obra_editada', ['obra_id' => $id]);
            $msg = 'Dados e identidade da obra atualizados.';
        } elseif ($acao === 'status_obra') {
            $id = (int)($_POST['obra_id'] ?? 0);
            $status = ($_POST['status'] ?? '') === 'arquivada' ? 'arquivada' : 'ativa';
            q_global('UPDATE obras SET status=? WHERE id=?', [$status, $id]);
            if (obra_atual_id() === $id && $status !== 'ativa') { definir_obra_atual(0); }
            registrar_global('obra_status', ['obra_id' => $id, 'status' => $status]);
            $msg = 'Situação da obra alterada.';
        } elseif ($acao === 'identidade') {
            $logo = !empty($_POST['remover_logo']) ? '' : imagem_upload_para_data_uri('logo_global', global_ler('logo', ''));
            global_gravar('nome_sistema', trim((string)($_POST['nome_sistema'] ?? '')) ?: 'Núcleo de Obras');
            global_gravar('cor_primaria', cor_segura($_POST['cor_primaria'] ?? '', '#d97706'));
            global_gravar('cor_secundaria', cor_segura($_POST['cor_secundaria'] ?? '', '#111827'));
            global_gravar('cor_fundo', cor_segura($_POST['cor_fundo'] ?? '', '#f4f6f8'));
            global_gravar('logo', $logo);
            registrar_global('identidade_atualizada');
            $msg = 'Identidade visual principal atualizada.';
        } elseif ($acao === 'permissoes') {
            $uid = (int)($_POST['usuario_id'] ?? 0);
            q_global('DELETE FROM usuarios_obras WHERE usuario_id=?', [$uid]);
            foreach ((array)($_POST['obras'] ?? []) as $oid) {
                q_global('INSERT INTO usuarios_obras (usuario_id, obra_id) VALUES (?, ?)', [$uid, (int)$oid]);
            }
            registrar_global('permissoes_obras', ['usuario_id' => $uid]);
            $msg = 'Acesso do usuário às obras atualizado.';
        }
    } catch (Exception $e) {
        $erro = $e->getMessage();
    }
}

function copiar_estrutura_obra($origem, $destino)
{
    $mapa = [];
    $st = q_global('SELECT * FROM empresas WHERE obra_id=? ORDER BY ordem,id', [(int)$origem]);
    foreach ($st->fetchAll() as $e) {
        q_global('INSERT INTO empresas (obra_id,aba,nome,col_obs,ordem) VALUES (?,?,?,?,?)', [$destino,$e['aba'],$e['nome'],$e['col_obs'],$e['ordem']]);
        $mapa[$e['id']] = (int)bd()->lastInsertId();
    }
    foreach (q_global('SELECT * FROM servicos WHERE obra_id=? ORDER BY ordem,id', [(int)$origem])->fetchAll() as $s) {
        if (isset($mapa[$s['empresa_id']])) {
            q_global('INSERT INTO servicos (obra_id,empresa_id,col,nome,frente,id_crono,escopo,ordem) VALUES (?,?,?,?,?,?,?,?)',
                [$destino,$mapa[$s['empresa_id']],$s['col'],$s['nome'],$s['frente'],$s['id_crono'],$s['escopo'],$s['ordem']]);
        }
    }
}

$obras = obras_do_usuario($eu);
$todas = $admin ? q_global("SELECT * FROM obras WHERE status <> 'excluida' ORDER BY nome")->fetchAll() : $obras;
$resumos = [];
foreach ($obras as $o) {
    $id = (int)$o['id'];
    $resumos[$id] = [
        'empresas' => (int)q_global('SELECT COUNT(*) FROM empresas WHERE obra_id=?', [$id])->fetchColumn(),
        'lancamentos' => (int)q_global('SELECT COUNT(*) FROM producao WHERE obra_id=?', [$id])->fetchColumn(),
        'impactos' => (int)q_global("SELECT COUNT(*) FROM impactos WHERE obra_id=? AND (solucionado IS NULL OR UPPER(solucionado) NOT IN ('SIM','S','YES'))", [$id])->fetchColumn(),
        'ultima' => q_global('SELECT MAX(quando) FROM historico WHERE obra_id=?', [$id])->fetchColumn(),
    ];
}
$usuarios = $admin ? q_global("SELECT id,nome,login,perfil FROM usuarios WHERE ativo=1 ORDER BY nome")->fetchAll() : [];
$acessos = [];
if ($admin) {
    foreach (q_global('SELECT usuario_id,obra_id FROM usuarios_obras')->fetchAll() as $a) { $acessos[$a['usuario_id']][] = (int)$a['obra_id']; }
}
$csrf = token_csrf();
$logoGlobal = global_ler('logo', '');
pagina_inicio('Central de obras');
?>
<div class="portal-shell">
  <header class="portal-topo">
    <div class="portal-brand">
      <?php if ($logoGlobal): ?><img src="<?= h($logoGlobal) ?>" alt="Logo"><?php else: ?><span class="brand-mark">NO</span><?php endif; ?>
      <div><strong><?= h(global_ler('nome_sistema', 'Núcleo de Obras')) ?></strong><small>Central inteligente de gestão</small></div>
    </div>
    <div class="portal-user"><span>Olá, <?= h($eu['nome']) ?></span><a class="btn ghost" href="sair.php">Sair</a></div>
  </header>
  <main class="portal-main">
    <section class="hero-obras">
      <div><span class="eyebrow">PORTFÓLIO OPERACIONAL</span><h1>Suas obras, uma visão central.</h1><p>Escolha uma obra para abrir o ambiente operacional completo. Cada projeto mantém seus dados totalmente separados.</p></div>
      <div class="hero-stat"><strong><?= count($obras) ?></strong><span>obras disponíveis</span></div>
    </section>
    <?php if ($msg): ?><div class="toast ok-faixa"><?= h($msg) ?></div><?php endif; ?>
    <?php if ($erro): ?><div class="toast erro-form"><?= h($erro) ?></div><?php endif; ?>

    <div class="obra-grid">
      <?php foreach ($obras as $o): ?>
      <article class="obra-card" style="--obra-cor:<?= h(cor_segura($o['cor_primaria'] ?? '', '#d97706')) ?>">
        <div class="obra-card-head">
          <?php if (!empty($o['logo'])): ?><img src="<?= h($o['logo']) ?>" alt="Logo da obra"><?php else: ?><span class="obra-avatar"><?= h(strtoupper(substr($o['nome'],0,2))) ?></span><?php endif; ?>
          <span class="status <?= h($o['status']) ?>"><?= h($o['status']) ?></span>
        </div>
        <h2><?= h($o['nome']) ?></h2><p><?= h($o['cliente'] ?: 'Cliente não informado') ?> · <?= h($o['cidade'] ?: 'Local não informado') ?></p>
        <div class="obra-meta"><span><?= h($o['codigo'] ?: 'Sem código') ?></span><span><?= h($o['data_inicio'] ? date('d/m/Y', strtotime($o['data_inicio'])) : 'Sem início') ?></span></div>
        <div class="obra-insights"><span><b><?= $resumos[$o['id']]['empresas'] ?></b> empresas</span><span><b><?= $resumos[$o['id']]['lancamentos'] ?></b> lançamentos</span><span class="<?= $resumos[$o['id']]['impactos'] ? 'tem-alerta' : '' ?>"><b><?= $resumos[$o['id']]['impactos'] ?></b> impactos abertos</span></div>
        <small class="ultima-atividade"><?= $resumos[$o['id']]['ultima'] ? 'Atualizada em '.h(date('d/m/Y H:i',strtotime($resumos[$o['id']]['ultima']))) : 'Ainda sem movimentação' ?></small>
        <?php if ($o['status'] === 'ativa'): ?><form method="post"><input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="acao" value="abrir"><input type="hidden" name="obra_id" value="<?= (int)$o['id'] ?>"><button class="btn primario largura">Abrir obra <span>→</span></button></form><?php endif; ?>
      </article>
      <?php endforeach; ?>
    </div>

    <?php if ($admin): ?>
    <section class="portal-admin">
      <div class="section-title"><span class="eyebrow">ADMINISTRAÇÃO</span><h2>Personalização e controle</h2></div>
      <div class="portal-columns">
        <form method="post" enctype="multipart/form-data" class="bloco painel-form">
          <input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="acao" value="identidade">
          <h3>Identidade principal</h3><p class="nota">A marca exibida no login e na central.</p>
          <label>Nome do sistema<input name="nome_sistema" value="<?= h(global_ler('nome_sistema','Núcleo de Obras')) ?>"></label>
          <div class="color-row"><label>Cor principal<input type="color" name="cor_primaria" value="<?= h(cor_segura(global_ler('cor_primaria',''),'#d97706')) ?>"></label><label>Cor escura<input type="color" name="cor_secundaria" value="<?= h(cor_segura(global_ler('cor_secundaria',''),'#111827')) ?>"></label><label>Fundo<input type="color" name="cor_fundo" value="<?= h(cor_segura(global_ler('cor_fundo',''),'#f4f6f8')) ?>"></label></div>
          <label>Logo / ícone<input type="file" name="logo_global" accept="image/png,image/jpeg,image/webp"></label>
          <label class="check"><input type="checkbox" name="remover_logo" value="1"> Remover logo atual</label><button class="btn primario">Salvar identidade</button>
        </form>
        <form method="post" enctype="multipart/form-data" class="bloco painel-form">
          <input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="acao" value="criar_obra">
          <h3>Nova obra</h3><p class="nota">Crie um ambiente independente e vazio.</p>
          <div class="campos"><label>Nome<input name="nome" required></label><label>Código<input name="codigo"></label><label>Cliente<input name="cliente"></label><label>Cidade<input name="cidade"></label><label>Início<input type="date" name="data_inicio"></label><label>Fim<input type="date" name="data_fim"></label></div>
          <div class="color-row"><label>Cor principal<input type="color" name="cor_primaria" value="#d97706"></label><label>Cor escura<input type="color" name="cor_secundaria" value="#111827"></label></div>
          <label>Logo da obra<input type="file" name="logo_obra" accept="image/png,image/jpeg,image/webp"></label>
          <?php if (obra_atual_id()): ?><label class="check"><input type="checkbox" name="copiar_estrutura" value="1"> Copiar apenas empresas e serviços da obra aberta (sem produção)</label><?php endif; ?>
          <button class="btn primario">Criar obra</button>
        </form>
      </div>

      <section class="bloco painel-form"><h3>Editar obras</h3><div class="manage-grid">
        <?php foreach ($todas as $o): ?><details><summary><b><?= h($o['nome']) ?></b><span><?= h($o['status']) ?></span></summary>
          <form method="post" enctype="multipart/form-data" class="campos"><input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="acao" value="editar_obra"><input type="hidden" name="obra_id" value="<?= (int)$o['id'] ?>">
            <label>Nome<input name="nome" value="<?= h($o['nome']) ?>" required></label><label>Código<input name="codigo" value="<?= h($o['codigo']) ?>"></label><label>Cliente<input name="cliente" value="<?= h($o['cliente']) ?>"></label><label>Cidade<input name="cidade" value="<?= h($o['cidade']) ?>"></label><label>Início<input type="date" name="data_inicio" value="<?= h($o['data_inicio']) ?>"></label><label>Fim<input type="date" name="data_fim" value="<?= h($o['data_fim']) ?>"></label><label>Cor<input type="color" name="cor_primaria" value="<?= h(cor_segura($o['cor_primaria'],'#d97706')) ?>"></label><label>Cor escura<input type="color" name="cor_secundaria" value="<?= h(cor_segura($o['cor_secundaria'],'#111827')) ?>"></label><label>Nova logo<input type="file" name="logo_obra" accept="image/png,image/jpeg,image/webp"></label><label class="check"><input type="checkbox" name="remover_logo" value="1"> Remover logo</label><button class="btn primario">Salvar</button>
          </form>
          <form method="post" class="inline"><input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="acao" value="status_obra"><input type="hidden" name="obra_id" value="<?= (int)$o['id'] ?>"><input type="hidden" name="status" value="<?= $o['status']==='ativa'?'arquivada':'ativa' ?>"><button class="btn ghost"><?= $o['status']==='ativa'?'Arquivar':'Reativar' ?></button></form>
        </details><?php endforeach; ?>
      </div></section>

      <section class="bloco painel-form"><h3>Acesso dos usuários</h3><p class="nota">Administradores veem todas as obras. Defina abaixo o acesso de editores e leitores.</p><div class="manage-grid">
        <?php foreach ($usuarios as $u): if ($u['perfil']==='admin') continue; ?><form method="post" class="user-access"><input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="acao" value="permissoes"><input type="hidden" name="usuario_id" value="<?= (int)$u['id'] ?>"><b><?= h($u['nome']) ?></b><small><?= h($u['login']) ?> · <?= h($u['perfil']) ?></small><div class="access-checks"><?php foreach ($todas as $o): ?><label class="check"><input type="checkbox" name="obras[]" value="<?= (int)$o['id'] ?>" <?= in_array((int)$o['id'],$acessos[$u['id']]??[],true)?'checked':'' ?>> <?= h($o['nome']) ?></label><?php endforeach; ?></div><button class="btn">Salvar acessos</button></form><?php endforeach; ?>
      </div></section>
    </section>
    <?php endif; ?>
  </main>
</div></body></html>
