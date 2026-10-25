<?php
// Administração: usuários, importação/exportação, dados da obra, atualização e histórico.
require __DIR__ . '/inc/nucleo.php';
require __DIR__ . '/inc/modelo.php';
require __DIR__ . '/inc/atualizar.php';

$eu = exigir_admin();
$obraSelecionada = exigir_obra_pagina();
$msg = '';
$erro = '';
$cfg = config();

if (($_GET['acao'] ?? '') === 'exportar') {
    conferir_csrf();
    header('Content-Type: application/json; charset=utf-8');
    header('Content-Disposition: attachment; filename="obra198_backup_' . date('Ymd_His') . '.json"');
    echo json_encode(exportar_pacote(), JSON_UNESCAPED_UNICODE);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    conferir_csrf();
    $acao = $_POST['acao'] ?? '';
    try {
        if ($acao === 'criar_usuario') {
            $login = trim($_POST['login'] ?? '');
            $email = trim($_POST['email'] ?? '');
            if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
                throw new InvalidArgumentException('Informe um e-mail válido.');
            }
            if ($login === '' || strlen($_POST['senha'] ?? '') < 8) {
                throw new InvalidArgumentException('Informe o login e uma senha com pelo menos 8 caracteres.');
            }
            if (q('SELECT id FROM usuarios WHERE login = ?', [$login])->fetch()) {
                throw new InvalidArgumentException('Já existe um usuário com esse login.');
            }
            $perfil = in_array($_POST['perfil'] ?? '', ['admin', 'editor', 'leitura'], true) ? $_POST['perfil'] : 'editor';
            q('INSERT INTO usuarios (nome, login, senha, perfil, empresa, email, ativo) VALUES (?, ?, ?, ?, ?, ?, 1)',
                [trim($_POST['nome'] ?? $login), $login, password_hash($_POST['senha'], PASSWORD_DEFAULT), $perfil, texto_ou_nulo($_POST['empresa'] ?? null), texto_ou_nulo($email)]);
            $novoUid = (int)bd()->lastInsertId();
            q_global('INSERT INTO usuarios_obras (usuario_id, obra_id) VALUES (?, ?)', [$novoUid, obra_atual_id()]);
            if ($perfil !== 'admin') { foreach (modulos_sistema() as $m) { if (in_array($m, $_POST['modulos'] ?? [], true)) q_global('INSERT INTO usuarios_modulos (usuario_id, modulo, permitido) VALUES (?, ?, 1)', [$novoUid, $m]); } }
            registrar_alteracao('usuario_criado', ['login' => $login, 'perfil' => $perfil]);
            $msg = "Usuário $login criado.";
        } elseif ($acao === 'editar_usuario') {
            $id = (int)($_POST['id'] ?? 0);
            $nome = trim($_POST['nome'] ?? '');
            $login = trim($_POST['login'] ?? '');
            $email = trim($_POST['email'] ?? '');
            $perfil = in_array($_POST['perfil'] ?? '', ['admin', 'editor', 'leitura'], true) ? $_POST['perfil'] : 'editor';
            if ($id <= 0 || $nome === '' || $login === '') {
                throw new InvalidArgumentException('Informe nome e login do usuário.');
            }
            if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
                throw new InvalidArgumentException('Informe um e-mail válido.');
            }
            $existe = q_global('SELECT id FROM usuarios WHERE login = ? AND id <> ?', [$login, $id])->fetch();
            if ($existe) { throw new InvalidArgumentException('Já existe outro usuário com esse login.'); }
            q_global('UPDATE usuarios SET nome=?, login=?, email=?, perfil=?, empresa=? WHERE id=?', [$nome, $login, texto_ou_nulo($email), $perfil, texto_ou_nulo($_POST['empresa'] ?? null), $id]);
            if ($perfil === 'admin') {
                q_global('DELETE FROM usuarios_modulos WHERE usuario_id=?', [$id]);
            }
            registrar_alteracao('usuario_editado', ['id'=>$id,'login'=>$login,'email'=>$email,'perfil'=>$perfil]);
            $msg = 'Usuário atualizado.';
        } elseif ($acao === 'enviar_reset_usuario') {
            $id = (int)($_POST['id'] ?? 0);
            $alvo = q_global('SELECT id,nome,login,email,ativo FROM usuarios WHERE id=?', [$id])->fetch();
            if (!$alvo || !(int)$alvo['ativo']) { throw new InvalidArgumentException('Usuário inválido ou inativo.'); }
            if (empty($alvo['email'])) { throw new InvalidArgumentException('Cadastre um e-mail para este usuário antes de enviar o link.'); }
            if (!enviar_link_redefinicao($alvo)) { throw new InvalidArgumentException('Não foi possível enviar o e-mail. Verifique se o servidor está com envio de e-mail habilitado.'); }
            registrar_alteracao('link_senha_enviado', ['id'=>$id,'email'=>$alvo['email']]);
            $msg = 'Link de redefinição enviado para ' . $alvo['email'] . '.';
        } elseif ($acao === 'salvar_modulos') {
            $uid = (int)($_POST['id'] ?? 0);
            $alvo = q_global('SELECT id,perfil FROM usuarios WHERE id=?', [$uid])->fetch();
            if (!$alvo) throw new InvalidArgumentException('Usuário inválido.');
            q_global('DELETE FROM usuarios_modulos WHERE usuario_id=?', [$uid]);
            if ($alvo['perfil'] !== 'admin') {
                foreach (modulos_sistema() as $m) if (in_array($m, $_POST['modulos'] ?? [], true)) q_global('INSERT INTO usuarios_modulos (usuario_id,modulo,permitido) VALUES (?,?,1)', [$uid,$m]);
            }
            registrar_alteracao('modulos_usuario', ['id'=>$uid,'modulos'=>$_POST['modulos'] ?? []]);
            $msg='Níveis de acesso atualizados.';
        } elseif ($acao === 'senha_usuario') {
            if (strlen($_POST['senha'] ?? '') < 8) {
                throw new InvalidArgumentException('A nova senha precisa ter pelo menos 8 caracteres.');
            }
            q('UPDATE usuarios SET senha = ? WHERE id = ?', [password_hash($_POST['senha'], PASSWORD_DEFAULT), (int)$_POST['id']]);
            registrar_alteracao('senha_redefinida', ['id' => (int)$_POST['id']]);
            $msg = 'Senha redefinida.';
        } elseif ($acao === 'alternar_usuario') {
            $id = (int)$_POST['id'];
            if ($id === (int)$eu['id']) {
                throw new InvalidArgumentException('Você não pode desativar o próprio usuário.');
            }
            q('UPDATE usuarios SET ativo = 1 - ativo WHERE id = ?', [$id]);
            registrar_alteracao('usuario_alternado', ['id' => $id]);
            $msg = 'Situação do usuário alterada.';
        } elseif ($acao === 'empresa_criar_obra') {   // obra própria da empresa (cópia isolada) + usuário dela
            $loginN = trim((string)($_POST['login'] ?? ''));
            if ($loginN === '' || strlen((string)($_POST['senha'] ?? '')) < 8) { throw new InvalidArgumentException('Informe o login e uma senha com pelo menos 8 caracteres.'); }
            if (q_global('SELECT id FROM usuarios WHERE login = ?', [$loginN])->fetch()) { throw new InvalidArgumentException('Já existe um usuário com esse login.'); }
            $obraNova = obra_empresa_criar(obra_atual_id(), (string)($_POST['empresa'] ?? ''));
            $uid = obra_empresa_criar_usuario($obraNova, (string)($_POST['nome'] ?? ''), (string)($_POST['login'] ?? ''), (string)($_POST['senha'] ?? ''),
                (string)($_POST['email'] ?? ''), (array)($_POST['modulos'] ?? []));
            $msg = 'Obra própria criada para ' . ($_POST['empresa'] ?? '') . ' e usuário “' . $loginN . '” liberado somente nela.';
        } elseif ($acao === 'empresa_novo_usuario') {
            obra_empresa_criar_usuario((int)($_POST['obra_id'] ?? 0), (string)($_POST['nome'] ?? ''), (string)($_POST['login'] ?? ''), (string)($_POST['senha'] ?? ''),
                (string)($_POST['email'] ?? ''), (array)($_POST['modulos'] ?? []));
            $msg = 'Usuário criado nesta obra de empresa.';
        } elseif ($acao === 'empresa_recarregar_obra') {
            $oid = (int)($_POST['obra_id'] ?? 0);
            $o = q_global('SELECT nome, origem_obra_id FROM obras WHERE id = ?', [$oid])->fetch();
            if (!$o || (int)$o['origem_obra_id'] !== obra_atual_id()) { throw new InvalidArgumentException('Esta obra de empresa não pertence à obra aberta.'); }
            if (trim((string)($_POST['confirmar'] ?? '')) !== 'RECARREGAR') { throw new InvalidArgumentException('Digite RECARREGAR para confirmar.'); }
            obra_empresa_recarregar($oid);
            $msg = 'Obra “' . $o['nome'] . '” recarregada a partir da obra principal. O que a empresa tinha lançado nela foi apagado.';
        } elseif ($acao === 'importar') {
            if (empty($_POST['confirmo'])) {
                throw new InvalidArgumentException('Marque a confirmação: a importação substitui os dados da obra.');
            }
            if (empty($_FILES['arquivo']['tmp_name']) || !is_uploaded_file($_FILES['arquivo']['tmp_name'])) {
                throw new InvalidArgumentException('Selecione o arquivo JSON exportado pelo programa.');
            }
            $pacote = json_decode(file_get_contents($_FILES['arquivo']['tmp_name']), true);
            if (!is_array($pacote)) {
                throw new InvalidArgumentException('O arquivo enviado não é um JSON válido.');
            }
            importar_pacote($pacote);
            $msg = 'Dados importados com sucesso.';
        } elseif ($acao === 'importar_estoque') {
            // Substitui SÓ o documento de estoque. Produção, apontamentos,
            // medições e usuários não são tocados.
            if (!empty($_FILES['arquivo_estoque']['tmp_name']) && is_uploaded_file($_FILES['arquivo_estoque']['tmp_name'])) {
                $txt = file_get_contents($_FILES['arquivo_estoque']['tmp_name']);
                $origem = 'arquivo enviado';
            } else {
                $arq = __DIR__ . '/inc/estoque_inicial.json';
                if (!is_file($arq)) {
                    throw new InvalidArgumentException('inc/estoque_inicial.json não encontrado no servidor.');
                }
                $txt = file_get_contents($arq);
                $origem = 'inc/estoque_inicial.json';
            }
            $estoque = json_decode($txt, true);
            if (!is_array($estoque) || empty($estoque['materiais'])) {
                throw new InvalidArgumentException('JSON inválido: esperado um documento de estoque com a lista "materiais".');
            }
            estoque_planilha_gravar($estoque);
            registrar_alteracao('estoque_importado', ['origem' => $origem, 'materiais' => count($estoque['materiais'])]);
            $msg = sprintf('Estoque atualizado a partir de %s: %d materiais e %d remessas. Produção, apontamentos e medições não foram alterados.',
                $origem, count($estoque['materiais']), count($estoque['remessas']['itens'] ?? []));
        } elseif ($acao === 'salvar_tema') {
            $tema = (string)($_POST['tema'] ?? '');
            if ($tema !== '' && !in_array($tema, TEMAS_VALIDOS, true)) {
                throw new InvalidArgumentException('Tema inválido.');
            }
            $menu = (string)($_POST['menu'] ?? 'lateral');
            if (!in_array($menu, MENUS_VALIDOS, true)) {
                throw new InvalidArgumentException('Posição do menu inválida.');
            }
            q_global('UPDATE usuarios SET tema=?, menu_pos=? WHERE id=?', [$tema !== '' ? $tema : null, $menu === 'topo' ? 'topo' : null, $eu['id']]);
            $GLOBALS['tema_override'] = $tema;   // a página já aplica o tema escolhido
            $GLOBALS['menu_override'] = $menu;
            $msg = 'Aparência atualizada: tema ' . ['' => 'automático (segue o aparelho)', 'light' => 'branco', 'dark' => 'preto', 'space' => 'espacial', 'nevoa' => 'Névoa', 'grafite' => 'Grafite', 'salvia' => 'Sálvia'][$tema] . ', menu ' . ($menu === 'topo' ? 'na barra superior' : 'lateral') . '. Vale para o seu usuário em todas as telas.';
        } elseif ($acao === 'obra') {
            if (!data_valida($_POST['data_inicio'] ?? '') || !data_valida($_POST['data_fim'] ?? '') || $_POST['data_fim'] < $_POST['data_inicio']) {
                throw new InvalidArgumentException('Datas da obra inválidas.');
            }
            sistema_gravar('obra_nome', trim($_POST['obra_nome'] ?? 'OBRA'));
            sistema_gravar('data_inicio', $_POST['data_inicio']);
            sistema_gravar('data_fim', $_POST['data_fim']);
            q_global('UPDATE obras SET nome=?, data_inicio=?, data_fim=? WHERE id=?', [
                trim($_POST['obra_nome'] ?? 'OBRA'), $_POST['data_inicio'], $_POST['data_fim'], obra_atual_id()
            ]);
            registrar_alteracao('obra', ['nome' => $_POST['obra_nome'], 'inicio' => $_POST['data_inicio'], 'fim' => $_POST['data_fim']]);
            $msg = 'Dados da obra atualizados.';
        } elseif ($acao === 'sincronizar_github') {
            $r   = sincronizar_para_github($cfg);
            $msg = $r['mensagem'];
        } elseif ($acao === 'atualizar') {
            throw new InvalidArgumentException('Atualização automática pausada nesta edição multiobras. Instale somente pacotes compatíveis para não perder o isolamento dos projetos.');
        } elseif ($acao === 'gerar_machine_token') {
            $token = bin2hex(random_bytes(32));
            sistema_gravar('machine_token', $token);
            registrar_alteracao('machine_token_gerado', ['por' => $eu['login']]);
            $msg = 'TOKEN_GERADO:' . $token;
        } elseif ($acao === 'revogar_machine_token') {
            sistema_gravar('machine_token', '');
            registrar_alteracao('machine_token_revogado', ['por' => $eu['login']]);
            $msg = 'Token revogado. Chamadas via Bearer serão recusadas.';
        }
        // Auto-sync para o GitHub após qualquer ação bem-sucedida (exceto a própria sync)
        // A sincronização roda DEPOIS de a página ser entregue (no fim deste arquivo): enviar tudo ao GitHub dentro do
        // pedido passava de 60 s e o servidor devolvia 504. Trocar o tema é preferência pessoal e não sincroniza.
        if ($acao !== 'sincronizar_github' && $acao !== 'salvar_tema' && !empty($cfg['github_token'])) {
            $sincronizarDepois = true;
        }
    } catch (InvalidArgumentException $e) {
        $erro = $e->getMessage();
    } catch (Throwable $e) {
        $erro = 'Falha: ' . $e->getMessage();
    }
}

$usuarios = q('SELECT id, nome, login, perfil, empresa, email, ativo FROM usuarios ORDER BY nome')->fetchAll();
$modsPorUsuario=[]; foreach (q_global('SELECT usuario_id,modulo FROM usuarios_modulos WHERE permitido=1')->fetchAll() as $x) $modsPorUsuario[(int)$x['usuario_id']][]=$x['modulo'];
$empresas = q('SELECT nome FROM empresas ORDER BY ordem')->fetchAll(PDO::FETCH_COLUMN);
$ehObraEmpresa = obra_empresa_info() !== null;
$obrasEmpresa = $ehObraEmpresa ? [] : obra_empresa_listar(obra_atual_id());
$usuariosDaObra = [];
foreach ($obrasEmpresa as $oe) {
    $usuariosDaObra[(int)$oe['id']] = q_global('SELECT u.nome, u.login, u.ativo FROM usuarios u JOIN usuarios_obras uo ON uo.usuario_id = u.id WHERE uo.obra_id = ? ORDER BY u.nome', [(int)$oe['id']])->fetchAll();
}
$historico = q('SELECT * FROM historico ORDER BY id DESC LIMIT 150')->fetchAll();
$obra = obra_info();
$csrf = token_csrf();
$token_ativo = (sistema_ler('machine_token', '') !== '');
$novo_token = '';
if (strncmp($msg, 'TOKEN_GERADO:', 13) === 0) {
    $novo_token = substr($msg, 13);
    $msg = 'Token gerado. Copie-o agora — ele não será exibido novamente.';
}
pagina_inicio('Administração');
?>
<header class="topo">
  <div class="marca"><span class="marca-sigla">198</span><div><h1>Administração</h1>
    <div class="usuario"><span><?= h($eu['nome']) ?></span><a href="dashboard_admin.php">Dashboard geral</a><a href="obras.php">Central de obras</a><a href="index.php">Voltar ao sistema</a><a href="sair.php">Sair</a></div></div></div>
</header>
<main class="admin">
  <?php if ($msg): ?><div class="faixa ok-faixa"><?= h($msg) ?></div><?php endif; ?>
  <?php if ($erro): ?><div class="faixa"><?= h($erro) ?></div><?php endif; ?>

  <section class="bloco tema-bloco">
    <div class="bloco-cab"><div><h2>Aparência</h2><span class="nota">Escolha o tema para melhorar a visualização. A preferência fica salva no seu usuário e vale no painel, no dashboard e na administração.</span></div></div>
    <form method="post" class="tema-form">
      <input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="acao" value="salvar_tema">
      <?php $temaAtual = tema_do_usuario(); foreach ([['light', 'Branco', 'Claro, fundo branco-gelo'], ['dark', 'Preto', 'Escuro, descansa a vista'], ['space', 'Espacial', 'Nebulosa azul-noite com estrelas e cartões de vidro'], ['nevoa', 'Névoa', 'Claro e suave, azul-índigo, cantos arredondados'], ['grafite', 'Grafite', 'Menu escuro elegante, conteúdo claro, destaque vermelho'], ['salvia', 'Sálvia', 'Tons de areia e verde-sálvia, botões em pílula'], ['', 'Automático', 'Segue o aparelho (claro ou escuro)']] as [$v, $rot, $dica]): ?>
        <label class="tema-op<?= $temaAtual === $v ? ' sel' : '' ?>">
          <input type="radio" name="tema" value="<?= h($v) ?>" <?= $temaAtual === $v ? 'checked' : '' ?>>
          <span class="tema-prev tema-prev-<?= $v === '' ? 'auto' : h($v) ?>"><i></i><i></i><i></i></span>
          <b><?= h($rot) ?></b><small><?= h($dica) ?></small>
        </label>
      <?php endforeach; ?>
      <div class="menu-pos">
        <b>Posição do menu</b>
        <?php $menuAtual = menu_do_usuario(); foreach ([['lateral', 'Lateral', 'Lista de áreas e abas na lateral esquerda'], ['topo', 'Barra superior', 'Áreas em abas no topo; ao clicar numa área, escolha a aba']] as [$mv, $mr, $md]): ?>
          <label class="menu-op<?= $menuAtual === $mv ? ' sel' : '' ?>"><input type="radio" name="menu" value="<?= h($mv) ?>" <?= $menuAtual === $mv ? 'checked' : '' ?>><span class="menu-prev menu-prev-<?= h($mv) ?>"><i></i><i></i><i></i></span><b><?= h($mr) ?></b><small><?= h($md) ?></small></label>
        <?php endforeach; ?>
      </div>
      <button class="btn primario">Salvar aparência</button>
    </form>
  </section>
  <style>
    .tema-form{display:flex;flex-wrap:wrap;gap:12px;align-items:stretch}.tema-op{display:flex;flex-direction:column;gap:4px;width:200px;padding:10px;border:2px solid var(--linha);border-radius:12px;cursor:pointer;background:var(--campo)}
    .tema-op.sel,.tema-op:has(input:checked){border-color:var(--acento);box-shadow:0 0 0 3px var(--acento-suave)}.tema-op input{position:absolute;opacity:0;pointer-events:none}.tema-op small{color:var(--fg2);font-size:.75rem}
    .tema-prev{display:flex;gap:5px;align-items:flex-end;height:64px;border-radius:8px;padding:8px;border:1px solid rgba(128,128,128,.35)}.tema-prev i{flex:1;border-radius:4px;height:60%}.tema-prev i:nth-child(2){height:85%}.tema-prev i:nth-child(3){height:45%}
    .tema-prev-light{background:#f4f3ef}.tema-prev-light i{background:#1f4fbf}
    .tema-prev-dark{background:#131312}.tema-prev-dark i{background:#5b8def}
    .tema-prev-space{background:radial-gradient(1.5px 1.5px at 15% 25%,#fff,transparent),radial-gradient(1px 1px at 70% 20%,#fff,transparent),radial-gradient(1.2px 1.2px at 85% 70%,#cfd8ff,transparent),radial-gradient(ellipse at 90% 0,rgba(139,92,246,.6),transparent 60%),radial-gradient(ellipse at 0 100%,rgba(37,99,235,.55),transparent 60%),#0b1030}.tema-prev-space i{background:linear-gradient(180deg,#a78bfa,#60a5fa)}
    .tema-prev-auto{background:linear-gradient(90deg,#f4f3ef 50%,#131312 50%)}.tema-prev-auto i{background:#5b8def}
    .tema-form .btn{align-self:flex-end}
    .tema-prev-nevoa{background:#f6f7fb}.tema-prev-nevoa i{background:#4f6bed}
    .tema-prev-grafite{background:linear-gradient(90deg,#12151c 30%,#f3f4f6 30%)}.tema-prev-grafite i{background:#d4352f}
    .tema-prev-salvia{background:#f4f1ea}.tema-prev-salvia i{background:#2f6f5b;border-radius:99px}
    .menu-pos{flex-basis:100%;display:flex;flex-wrap:wrap;gap:12px;align-items:stretch;margin-top:6px}.menu-pos>b{flex-basis:100%}
    .menu-op{position:relative;display:flex;flex-direction:column;gap:4px;width:200px;padding:10px;border:2px solid var(--linha);border-radius:12px;cursor:pointer;background:var(--campo)}.menu-op:has(input:checked){border-color:var(--acento);box-shadow:0 0 0 3px var(--acento-suave)}.menu-op input{position:absolute;opacity:0;pointer-events:none}.menu-op small{color:var(--fg2);font-size:.75rem}
    .menu-prev{position:relative;height:54px;border-radius:8px;border:1px solid rgba(128,128,128,.35);background:var(--bg);overflow:hidden}.menu-prev i{position:absolute;background:var(--linha-forte);border-radius:3px}
    .menu-prev-lateral i:nth-child(1){left:0;top:0;bottom:0;width:30%;border-radius:0;background:var(--linha)}.menu-prev-lateral i:nth-child(2){left:38%;top:10px;right:10px;height:12px}.menu-prev-lateral i:nth-child(3){left:38%;top:28px;right:30px;height:12px}
    .menu-prev-topo i:nth-child(1){left:0;top:0;right:0;height:16px;border-radius:0;background:var(--linha)}.menu-prev-topo i:nth-child(2){left:10px;top:26px;right:10px;height:10px}.menu-prev-topo i:nth-child(3){left:10px;top:42px;right:40px;height:8px}
  </style>
  <script>
    document.querySelectorAll('.tema-form input[name=tema]').forEach(r => r.addEventListener('change', () => {   // prévia imediata, antes de salvar
      const v = document.querySelector('.tema-form input[name=tema]:checked').value, el = document.documentElement;
      v ? el.setAttribute('data-theme', v) : el.removeAttribute('data-theme');
      document.querySelectorAll('.tema-op').forEach(o => o.classList.toggle('sel', o.contains(r) && r.checked));
    }));
  </script>

  <section class="bloco usuarios-bloco">
    <div class="bloco-cab usuarios-cab">
      <div><h2>Usuários</h2><span class="nota">Admin: tudo · Editor: lança e cadastra · Leitura: só consulta. O dashboard respeita os módulos liberados.</span></div>
      <button type="button" class="btn primario" id="btnNovoUsuario">+ Novo usuário</button>
    </div>
    <div class="tabela-rolagem"><table class="usuarios-tabela">
      <thead><tr><th>Nome</th><th>Login</th><th>E-mail</th><th>Perfil</th><th>Empresa</th><th>Nível de acesso</th><th>Situação</th><th>Redefinir senha</th><th>Ações</th></tr></thead>
      <tbody>
      <?php foreach ($usuarios as $u): ?>
        <tr>
          <td><b><?= h($u['nome']) ?></b></td><td><?= h($u['login']) ?></td><td><?= $u['email'] ? h($u['email']) : '<span class="nota">sem e-mail</span>' ?></td><td><?= h(ucfirst($u['perfil'])) ?></td><td><?= h($u['empresa'] ?: 'Todas') ?></td>
          <td><?php if ($u['perfil']==='admin'): ?><span class="farol f-verde">TODOS OS MÓDULOS</span><?php else: ?><details class="acesso-editar"><summary>Ver / editar acessos</summary><form method="post" class="access-checks access-checks-col"><input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="acao" value="salvar_modulos"><input type="hidden" name="id" value="<?= (int)$u['id'] ?>"><?php $sel=$modsPorUsuario[(int)$u['id']]??modulos_sistema(); foreach (modulos_sistema() as $m): ?><label class="check"><input type="checkbox" name="modulos[]" value="<?= h($m) ?>" <?= in_array($m,$sel,true)?'checked':'' ?>><?= h(ucfirst($m)) ?></label><?php endforeach; ?><button class="btn">Salvar acessos</button></form></details><?php endif; ?></td>
          <td><span class="farol f-<?= $u['ativo'] ? 'verde' : 'pendente' ?>"><?= $u['ativo'] ? 'ATIVO' : 'INATIVO' ?></span></td>
          <td><div class="acoes-usuario"><form method="post" class="inline"><input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="acao" value="senha_usuario"><input type="hidden" name="id" value="<?= (int)$u['id'] ?>"><input type="password" name="senha" placeholder="nova senha" minlength="8" required><button class="btn">Salvar</button></form><form method="post" class="inline"><input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="acao" value="enviar_reset_usuario"><input type="hidden" name="id" value="<?= (int)$u['id'] ?>"><button class="btn" <?= $u['email'] ? '' : 'disabled title="Cadastre e-mail antes"' ?>>Enviar link</button></form></div></td>
          <td><div class="acoes-usuario"><button type="button" class="btn" data-editar-usuario data-id="<?= (int)$u['id'] ?>" data-nome="<?= h($u['nome']) ?>" data-login="<?= h($u['login']) ?>" data-email="<?= h($u['email'] ?? '') ?>" data-perfil="<?= h($u['perfil']) ?>" data-empresa="<?= h($u['empresa'] ?? '') ?>">Editar</button><form method="post" class="inline"><input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="acao" value="alternar_usuario"><input type="hidden" name="id" value="<?= (int)$u['id'] ?>"><button class="btn"><?= $u['ativo'] ? 'Desativar' : 'Ativar' ?></button></form></div></td>
        </tr>
      <?php endforeach; ?>
      </tbody>
    </table></div>
  </section>

  <?php if (!$ehObraEmpresa): ?>
  <section class="bloco" id="obrasEmpresas">
    <div class="bloco-cab"><div><h2>Obra própria de cada empresa</h2><span class="nota">Cada empresa recebe uma obra só dela (cópia do que é dela nesta obra), com usuário próprio. O que a empresa lança ou altera lá <b>não altera esta obra</b>.</span></div></div>
    <div class="tabela-rolagem"><table>
      <thead><tr><th>Empresa</th><th>Obra própria</th><th>Usuários da empresa</th><th>Ações</th></tr></thead>
      <tbody>
      <?php foreach ($empresas as $emp): $oe = $obrasEmpresa[mb_strtoupper($emp)] ?? null; ?>
      <tr>
        <td><b><?= h($emp) ?></b></td>
        <?php if ($oe): ?>
        <td><?= h($oe['nome']) ?><br><span class="nota">criada em <?= h(date('d/m/Y H:i', strtotime((string)$oe['criado_em']))) ?></span></td>
        <td><?php foreach ($usuariosDaObra[(int)$oe['id']] ?? [] as $uo): ?><div><?= h($uo['nome']) ?> <span class="nota">(<?= h($uo['login']) ?><?= $uo['ativo'] ? '' : ' · inativo' ?>)</span></div><?php endforeach; ?><?php if (empty($usuariosDaObra[(int)$oe['id']])): ?><span class="nota">nenhum usuário</span><?php endif; ?></td>
        <td><div class="acoes-usuario">
          <details class="acesso-editar"><summary>+ Usuário</summary>
            <form method="post" class="access-checks access-checks-col">
              <input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="acao" value="empresa_novo_usuario"><input type="hidden" name="obra_id" value="<?= (int)$oe['id'] ?>">
              <input name="nome" placeholder="Nome" required autocomplete="off"><input name="login" placeholder="Login" required autocomplete="off"><input name="email" type="email" placeholder="E-mail (opcional)" autocomplete="off"><input name="senha" type="password" placeholder="Senha inicial (8+)" minlength="8" required autocomplete="new-password">
              <?php foreach (modulos_sistema() as $m): ?><label class="check"><input type="checkbox" name="modulos[]" value="<?= h($m) ?>" <?= in_array($m, OE_MODULOS_PADRAO, true) ? 'checked' : '' ?>><?= h(ucfirst($m)) ?></label><?php endforeach; ?>
              <button class="btn">Criar usuário</button>
            </form>
          </details>
          <details class="acesso-editar"><summary>Recarregar da obra principal</summary>
            <form method="post" class="access-checks access-checks-col">
              <input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="acao" value="empresa_recarregar_obra"><input type="hidden" name="obra_id" value="<?= (int)$oe['id'] ?>">
              <p class="nota">Apaga TUDO que a empresa lançou na obra dela e copia de novo o que é dela desta obra. Digite <b>RECARREGAR</b>:</p>
              <input name="confirmar" placeholder="RECARREGAR" autocomplete="off" required><button class="btn perigo">Recarregar</button>
            </form>
          </details>
          <form method="post" action="obras.php" class="inline"><input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="acao" value="abrir"><input type="hidden" name="obra_id" value="<?= (int)$oe['id'] ?>"><button class="btn">Abrir a obra dela</button></form>
        </div></td>
        <?php else: ?>
        <td colspan="2"><span class="nota">Ainda sem obra própria.</span></td>
        <td><details class="acesso-editar"><summary>Criar obra própria + usuário</summary>
          <form method="post" class="access-checks access-checks-col">
            <input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="acao" value="empresa_criar_obra"><input type="hidden" name="empresa" value="<?= h($emp) ?>">
            <p class="nota">Cria a obra “<?= h($obra['nome'] ?? 'obra') ?> — <?= h($emp) ?>” com os dados da <?= h($emp) ?> e o usuário abaixo (acesso só a essa obra).</p>
            <input name="nome" placeholder="Nome do usuário" required autocomplete="off"><input name="login" placeholder="Login" required autocomplete="off"><input name="email" type="email" placeholder="E-mail (opcional)" autocomplete="off"><input name="senha" type="password" placeholder="Senha inicial (8+)" minlength="8" required autocomplete="new-password">
            <?php foreach (modulos_sistema() as $m): ?><label class="check"><input type="checkbox" name="modulos[]" value="<?= h($m) ?>" <?= in_array($m, OE_MODULOS_PADRAO, true) ? 'checked' : '' ?>><?= h(ucfirst($m)) ?></label><?php endforeach; ?>
            <button class="btn primario">Criar</button>
          </form></details></td>
        <?php endif; ?>
      </tr>
      <?php endforeach; ?>
      </tbody>
    </table></div>
  </section>
  <?php else: ?>
  <section class="bloco"><div class="bloco-cab"><h2>Obra própria de empresa</h2></div><p class="nota">Você está dentro da obra própria da empresa <b><?= h(obra_empresa_info()['empresa']) ?></b> (cópia isolada de “<?= h(obra_empresa_info()['origem_nome']) ?>”). Para criar ou recarregar obras de empresas, abra a obra principal.</p></section>
  <?php endif; ?>

  <div class="modal-admin" id="modalNovoUsuario" hidden>
    <div class="modal-admin-fundo" data-fechar-modal></div>
    <div class="modal-admin-caixa" role="dialog" aria-modal="true" aria-labelledby="tituloNovoUsuario">
      <div class="modal-admin-topo"><div><h2 id="tituloNovoUsuario">Criar novo usuário</h2><p id="textoModalUsuario">Defina os dados do login, e-mail e quais menus esse usuário poderá acessar.</p></div><button type="button" class="modal-admin-x" data-fechar-modal aria-label="Fechar">×</button></div>
      <form method="post" class="form-novo-usuario">
        <input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="acao" value="criar_usuario"><input type="hidden" name="id" value="">
        <div class="grade-modal"><label>Nome<input name="nome" required autocomplete="off"></label><label>Login<input name="login" required autocomplete="off"></label><label>E-mail para redefinir senha<input name="email" type="email" autocomplete="email" placeholder="usuario@empresa.com"></label><label class="campo-senha-modal">Senha inicial<input name="senha" type="password" minlength="8" required autocomplete="new-password"></label><label>Perfil<select name="perfil" id="novoPerfil"><option value="editor">Editor</option><option value="leitura">Leitura</option><option value="admin">Admin</option></select></label><label>Empresa<select name="empresa"><option value="">Todas</option><?php foreach ($empresas as $e): ?><option><?= h($e) ?></option><?php endforeach; ?></select></label></div>
        <fieldset class="acesso-modulos" id="novoAcessos"><legend>Nível de acesso por menu</legend><p class="nota">Marque somente os menus que o usuário poderá visualizar. Os alertas do dashboard também seguirão estas permissões.</p><div class="acesso-grade"><?php foreach (modulos_sistema() as $m): ?><label class="check acesso-card"><input type="checkbox" name="modulos[]" value="<?= h($m) ?>" checked><span><?= h(ucfirst($m)) ?></span></label><?php endforeach; ?></div><small>Administradores sempre têm acesso total.</small></fieldset>
        <div class="modal-admin-acoes"><button type="button" class="btn" data-fechar-modal>Cancelar</button><button class="btn primario" id="btnSalvarUsuarioModal">Criar usuário</button></div>
      </form>
    </div>
  </div>
  <script>
  (()=>{const m=document.getElementById('modalNovoUsuario'),b=document.getElementById('btnNovoUsuario'),p=document.getElementById('novoPerfil'),a=document.getElementById('novoAcessos'),f=m.querySelector('form'),tit=document.getElementById('tituloNovoUsuario'),txt=document.getElementById('textoModalUsuario'),btn=document.getElementById('btnSalvarUsuarioModal'),campoSenha=m.querySelector('.campo-senha-modal'),senha=m.querySelector('input[name="senha"]'),acao=f.querySelector('input[name="acao"]'),uid=f.querySelector('input[name="id"]');const sync=()=>{const admin=p.value==='admin';a.classList.toggle('acesso-desabilitado',admin);a.querySelectorAll('input').forEach(x=>{x.disabled=admin;if(admin)x.checked=true})};const abrirNovo=()=>{f.reset();acao.value='criar_usuario';uid.value='';tit.textContent='Criar novo usuário';txt.textContent='Defina os dados do login, e-mail e quais menus esse usuário poderá acessar.';btn.textContent='Criar usuário';campoSenha.hidden=false;senha.required=true;senha.disabled=false;m.hidden=false;document.body.classList.add('modal-aberto');sync();f.querySelector('input[name="nome"]').focus()};const abrirEditar=el=>{f.reset();acao.value='editar_usuario';uid.value=el.dataset.id||'';f.querySelector('input[name="nome"]').value=el.dataset.nome||'';f.querySelector('input[name="login"]').value=el.dataset.login||'';f.querySelector('input[name="email"]').value=el.dataset.email||'';f.querySelector('select[name="perfil"]').value=el.dataset.perfil||'editor';f.querySelector('select[name="empresa"]').value=el.dataset.empresa||'';tit.textContent='Editar usuário';txt.textContent='Atualize nome, login, e-mail de recuperação, perfil e empresa vinculada.';btn.textContent='Salvar usuário';campoSenha.hidden=true;senha.required=false;senha.disabled=true;m.hidden=false;document.body.classList.add('modal-aberto');sync();f.querySelector('input[name="nome"]').focus()};const fechar=()=>{m.hidden=true;document.body.classList.remove('modal-aberto')};b.addEventListener('click',abrirNovo);document.querySelectorAll('[data-editar-usuario]').forEach(x=>x.addEventListener('click',()=>abrirEditar(x)));m.querySelectorAll('[data-fechar-modal]').forEach(x=>x.addEventListener('click',fechar));document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!m.hidden)fechar()});p.addEventListener('change',sync);})();
  </script>

  <div class="grade-2">
    <section class="bloco">
      <div class="bloco-cab"><h2>Importar dados da planilha</h2></div>
      <p class="nota">No programa local, clique em "Exportar dados para o sistema online" e envie aqui o arquivo <code>obra198_dados.json</code>. Substitui produção, metas, cliente, impactos, estoque e equipamentos (os usuários são mantidos).</p>
      <form method="post" enctype="multipart/form-data" class="campos-linha">
        <input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="acao" value="importar">
        <input type="file" name="arquivo" accept=".json,application/json" required>
        <label class="check"><input type="checkbox" name="confirmo" value="1"> Confirmo a substituição</label>
        <button class="btn primario">Importar</button>
      </form>
      <p><a class="btn" href="admin.php?acao=exportar&amp;csrf=<?= h($csrf) ?>">Baixar backup completo (JSON)</a></p>
      <hr>
      <h3>Atualizar somente o estoque</h3>
      <p class="nota">Substitui apenas materiais, remessas, inventário e consumo físico. <b>Produção, apontamentos e medições não são tocados.</b> Sem arquivo, usa o <code>inc/estoque_inicial.json</code> que veio no sistema.</p>
      <form method="post" enctype="multipart/form-data" class="campos-linha">
        <input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="acao" value="importar_estoque">
        <input type="file" name="arquivo_estoque" accept=".json,application/json">
        <button class="btn">Atualizar estoque</button>
      </form>
    </section>
    <section class="bloco">
      <div class="bloco-cab"><h2>Obra</h2></div>
      <form method="post" class="campos-linha">
        <input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="acao" value="obra">
        <label>Nome<input name="obra_nome" value="<?= h($obra['nome']) ?>"></label>
        <label>Início do calendário<input type="date" name="data_inicio" value="<?= h($obra['data_inicio']) ?>"></label>
        <label>Fim do calendário<input type="date" name="data_fim" value="<?= h($obra['data_fim']) ?>"></label>
        <button class="btn primario">Salvar</button>
      </form>
      <div class="bloco-cab" style="margin-top:18px"><h2>Atualização do sistema</h2></div>
      <p class="nota">Repositório: <b><?= h($cfg['github_repositorio'] ?? '—') ?></b> · ramo: <b><?= h($cfg['github_ramo'] ?? '') ?></b>
        <?= empty($cfg['github_token']) ? ' · <b class="alerta-txt">sem token configurado</b> (edite inc/config.php → github_token)' : ' · token configurado ✓' ?></p>
      <?php if (!empty($cfg['github_token'])): ?>
      <form method="post" onsubmit="return confirm('Enviar todos os arquivos do servidor para o GitHub agora?')">
        <input type="hidden" name="csrf" value="<?= h($csrf) ?>">
        <input type="hidden" name="acao" value="sincronizar_github">
        <button class="btn primario">⬆ Sincronizar Hostinger → GitHub</button>
        <span class="nota">Envia os arquivos de código do servidor para o repositório num único commit.</span>
      </form>
      <?php else: ?>
      <p class="nota">Para ativar a sincronização, gere um token em <b>github.com → Settings → Developer settings → Personal access tokens → Fine-grained</b> com permissão <b>Contents: Read &amp; write</b> no repositório, e cole em <code>inc/config.php</code> no campo <code>github_token</code>.</p>
      <?php endif; ?>
    </section>
  </div>

  <section class="bloco">
    <div class="bloco-cab"><h2>Token de Máquina (API)</h2><span class="nota">Permite que ferramentas externas (ex.: Claude) acessem a API sem sessão de navegador.</span></div>
    <p class="nota">Status: <?= $token_ativo ? '<b style="color:var(--verde,green)">Ativo</b>' : '<b>Nenhum token configurado</b>' ?></p>
    <?php if ($novo_token): ?>
      <div class="alerta-info" style="font-family:monospace;word-break:break-all;padding:10px;background:var(--bg2,#f5f5f5);border-radius:4px;margin-bottom:10px">
        <b>Novo token (copie agora):</b><br><?= h($novo_token) ?>
      </div>
      <p class="nota">Use no cabeçalho HTTP: <code>Authorization: Bearer <?= h($novo_token) ?></code></p>
    <?php endif; ?>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <form method="post">
        <input type="hidden" name="csrf" value="<?= h($csrf) ?>">
        <input type="hidden" name="acao" value="gerar_machine_token">
        <button class="btn primario"><?= $token_ativo ? 'Rotacionar token' : 'Gerar token' ?></button>
      </form>
      <?php if ($token_ativo): ?>
      <form method="post" onsubmit="return confirm('Revogar o token? Qualquer acesso via Bearer será recusado imediatamente.')">
        <input type="hidden" name="csrf" value="<?= h($csrf) ?>">
        <input type="hidden" name="acao" value="revogar_machine_token">
        <button class="btn perigo">Revogar token</button>
      </form>
      <?php endif; ?>
    </div>
  </section>

  <section class="bloco">
    <div class="bloco-cab"><h2>Histórico de alterações</h2><span class="nota">Últimos 150 registros: quem alterou, quando e o quê.</span></div>
    <div class="tabela-rolagem"><table>
      <thead><tr><th>Quando</th><th>Usuário</th><th>Ação</th><th>Detalhe</th></tr></thead>
      <tbody>
      <?php foreach ($historico as $l): ?>
        <tr><td class="sub"><?= h(date('d/m/Y H:i', strtotime($l['quando']))) ?></td><td><?= h($l['usuario']) ?></td><td><?= h($l['acao']) ?></td>
          <td class="sub detalhe"><?= h(mb_strimwidth((string)$l['detalhe'], 0, 220, '…')) ?></td></tr>
      <?php endforeach; ?>
      </tbody>
    </table></div>
  </section>
</main>
</body></html>
<?php
if (!empty($sincronizarDepois)) {
    ignore_user_abort(true);
    @set_time_limit(600);
    if (function_exists('fastcgi_finish_request')) { fastcgi_finish_request(); }   // a página já foi entregue; o resto roda em segundo plano
    try { sincronizar_para_github($cfg); } catch (Throwable $e) { /* falha silenciosa: não atrapalha a ação principal */ }
}
