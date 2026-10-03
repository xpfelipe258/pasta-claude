<?php
// Administração: usuários, importação/exportação, dados da obra, atualização e histórico.
require __DIR__ . '/inc/nucleo.php';
require __DIR__ . '/inc/modelo.php';
require __DIR__ . '/inc/atualizar.php';

$eu = exigir_admin();
$obraSelecionada = exigir_obra_pagina();
$msg = '';
$erro = '';

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
            if ($login === '' || strlen($_POST['senha'] ?? '') < 8) {
                throw new InvalidArgumentException('Informe o login e uma senha com pelo menos 8 caracteres.');
            }
            if (q('SELECT id FROM usuarios WHERE login = ?', [$login])->fetch()) {
                throw new InvalidArgumentException('Já existe um usuário com esse login.');
            }
            $perfil = in_array($_POST['perfil'] ?? '', ['admin', 'editor', 'leitura'], true) ? $_POST['perfil'] : 'editor';
            q('INSERT INTO usuarios (nome, login, senha, perfil, empresa, ativo) VALUES (?, ?, ?, ?, ?, 1)',
                [trim($_POST['nome'] ?? $login), $login, password_hash($_POST['senha'], PASSWORD_DEFAULT), $perfil, texto_ou_nulo($_POST['empresa'] ?? null)]);
            $novoUid = (int)bd()->lastInsertId();
            q_global('INSERT INTO usuarios_obras (usuario_id, obra_id) VALUES (?, ?)', [$novoUid, obra_atual_id()]);
            registrar_alteracao('usuario_criado', ['login' => $login, 'perfil' => $perfil]);
            $msg = "Usuário $login criado.";
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
    } catch (InvalidArgumentException $e) {
        $erro = $e->getMessage();
    } catch (Exception $e) {
        $erro = 'Falha: ' . $e->getMessage();
    }
}

$usuarios = q('SELECT id, nome, login, perfil, empresa, ativo FROM usuarios ORDER BY nome')->fetchAll();
$empresas = q('SELECT nome FROM empresas ORDER BY ordem')->fetchAll(PDO::FETCH_COLUMN);
$historico = q('SELECT * FROM historico ORDER BY id DESC LIMIT 150')->fetchAll();
$obra = obra_info();
$csrf = token_csrf();
$cfg = config();
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
    <div class="usuario"><span><?= h($eu['nome']) ?></span><a href="obras.php">Central de obras</a><a href="index.php">Voltar ao sistema</a><a href="sair.php">Sair</a></div></div></div>
</header>
<main class="admin">
  <?php if ($msg): ?><div class="faixa ok-faixa"><?= h($msg) ?></div><?php endif; ?>
  <?php if ($erro): ?><div class="faixa"><?= h($erro) ?></div><?php endif; ?>

  <section class="bloco">
    <div class="bloco-cab"><h2>Usuários</h2><span class="nota">Admin: tudo · Editor: lança e cadastra · Leitura: só consulta. Empresa restringe os lançamentos de produção.</span></div>
    <div class="tabela-rolagem"><table>
      <thead><tr><th>Nome</th><th>Login</th><th>Perfil</th><th>Empresa</th><th>Situação</th><th>Redefinir senha</th><th></th></tr></thead>
      <tbody>
      <?php foreach ($usuarios as $u): ?>
        <tr>
          <td><?= h($u['nome']) ?></td><td><?= h($u['login']) ?></td><td><?= h($u['perfil']) ?></td><td><?= h($u['empresa'] ?: 'todas') ?></td>
          <td><span class="farol f-<?= $u['ativo'] ? 'verde' : 'pendente' ?>"><?= $u['ativo'] ? 'ATIVO' : 'INATIVO' ?></span></td>
          <td><form method="post" class="inline"><input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="acao" value="senha_usuario">
            <input type="hidden" name="id" value="<?= (int)$u['id'] ?>"><input type="password" name="senha" placeholder="nova senha" minlength="8" required><button class="btn">Salvar</button></form></td>
          <td><form method="post" class="inline"><input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="acao" value="alternar_usuario">
            <input type="hidden" name="id" value="<?= (int)$u['id'] ?>"><button class="btn"><?= $u['ativo'] ? 'Desativar' : 'Ativar' ?></button></form></td>
        </tr>
      <?php endforeach; ?>
      </tbody>
    </table></div>
    <form method="post" class="campos-linha">
      <input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="acao" value="criar_usuario">
      <label>Nome<input name="nome" required></label>
      <label>Login<input name="login" required></label>
      <label>Senha<input name="senha" type="password" minlength="8" required></label>
      <label>Perfil<select name="perfil"><option value="editor">Editor</option><option value="leitura">Leitura</option><option value="admin">Admin</option></select></label>
      <label>Empresa<select name="empresa"><option value="">Todas</option><?php foreach ($empresas as $e): ?><option><?= h($e) ?></option><?php endforeach; ?></select></label>
      <button class="btn primario">Criar usuário</button>
    </form>
  </section>

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
      <p class="nota">Versão instalada: <?= h(substr((string)sistema_ler('versao_codigo', 'inicial'), 0, 7)) ?> · repositório <?= h($cfg['github_repositorio'] ?? '—') ?> (<?= h($cfg['github_ramo'] ?? '') ?>)
        <?= empty($cfg['github_token']) ? '· <b>sem token configurado</b> (edite inc/config.php)' : '' ?></p>
      <p class="nota">A atualização automática está pausada para impedir que uma versão antiga substitua os recursos multiobras.</p>
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
