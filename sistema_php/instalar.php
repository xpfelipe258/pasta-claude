<?php
// Instalação guiada: cria o banco, o administrador e carrega os dados iniciais da obra.
require __DIR__ . '/inc/nucleo.php';
require __DIR__ . '/inc/modelo.php';

if (config()) {
    pagina_inicio('Instalação');
    echo '<main class="pagina-login"><div class="bloco form-login"><h1>Sistema já instalado</h1>';
    echo '<p>Para reinstalar, apague o arquivo <code>inc/config.php</code> pelo gerenciador de arquivos da hospedagem.</p>';
    echo '<a class="btn primario" href="login.php">Ir para o login</a></div></main></body></html>';
    exit;
}

$erros = [];
$v = function ($k, $padrao = '') {
    return isset($_POST[$k]) ? trim((string)$_POST[$k]) : $padrao;
};

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $driver = $v('driver') === 'sqlite' ? 'sqlite' : 'mysql';
    $cfg = [
        'driver' => $driver,
        'host' => $v('host', 'localhost'), 'porta' => $v('porta'), 'banco' => $v('banco'),
        'usuario' => $v('usuario'), 'senha' => isset($_POST['senha_bd']) ? (string)$_POST['senha_bd'] : '',
        'sqlite_arquivo' => RAIZ . '/dados/obra198.sqlite',
        'github_repositorio' => $v('github_repositorio', 'xpfelipe258/pasta-claude'),
        'github_ramo' => $v('github_ramo', 'claude/brave-bardeen-jyxlhm'),
        'github_pasta' => 'sistema_php',
        'github_token' => $v('github_token'),
    ];
    if ($v('admin_login') === '' || strlen((string)($_POST['admin_senha'] ?? '')) < 8) {
        $erros[] = 'Informe o login do administrador e uma senha com pelo menos 8 caracteres.';
    }
    if ($driver === 'mysql' && ($cfg['banco'] === '' || $cfg['usuario'] === '')) {
        $erros[] = 'Informe o nome do banco e o usuário do MySQL (criados no painel da hospedagem).';
    }
    if (!$erros) {
        try {
            $pdo = conectar($cfg);
            criar_esquema($pdo, $driver);
            $conteudo = "<?php\n// Gerado pela instalação. Não compartilhe este arquivo.\nreturn " . var_export($cfg, true) . ";\n";
            if (file_put_contents(ARQ_CONFIG, $conteudo) === false) {
                throw new RuntimeException('Sem permissão para gravar inc/config.php.');
            }
            @chmod(ARQ_CONFIG, 0640);
            q('INSERT INTO usuarios (nome, login, senha, perfil, empresa, ativo) VALUES (?, ?, ?, ?, NULL, 1)',
                [$v('admin_nome', 'Administrador'), $v('admin_login'), password_hash($_POST['admin_senha'], PASSWORD_DEFAULT), 'admin']);
            sistema_gravar('obra_nome', $v('obra_nome', 'OBRA 198'));
            sistema_gravar('data_inicio', date('Y-m-d'));
            sistema_gravar('data_fim', date('Y-m-d', strtotime('+1 year')));
            $seed = __DIR__ . '/inc/dados_iniciais.json';
            $msgSeed = 'Nenhum dado inicial encontrado; importe depois em Administração.';
            if (file_exists($seed)) {
                importar_pacote(json_decode(file_get_contents($seed), true));
                sistema_gravar('obra_nome', $v('obra_nome', 'OBRA 198'));
                $msgSeed = 'Dados da planilha carregados (produção, metas, cliente, impactos, estoque e equipamentos).';
            }
            pagina_inicio('Instalação concluída');
            echo '<main class="pagina-login"><div class="bloco form-login"><h1>Instalação concluída</h1>';
            echo '<p>' . h($msgSeed) . '</p><p>Por segurança, apague o arquivo <code>instalar.php</code> da hospedagem.</p>';
            echo '<a class="btn primario" href="login.php">Entrar no sistema</a></div></main></body></html>';
            exit;
        } catch (Exception $e) {
            if (file_exists(ARQ_CONFIG)) {
                @unlink(ARQ_CONFIG);
            }
            $erros[] = 'Não foi possível concluir: ' . $e->getMessage();
        }
    }
}

pagina_inicio('Instalação');
?>
<main class="pagina-login">
  <form method="post" class="bloco form-login largo-form">
    <div class="marca"><span class="marca-sigla">198</span><div><h1>Instalação do sistema</h1><div class="nota">PHP <?= h(PHP_VERSION) ?></div></div></div>
    <?php foreach ($erros as $e): ?><p class="erro-form"><?= h($e) ?></p><?php endforeach; ?>
    <h2>Banco de dados</h2>
    <label>Tipo
      <select name="driver">
        <option value="mysql" <?= $v('driver') !== 'sqlite' ? 'selected' : '' ?>>MySQL / MariaDB (recomendado na hospedagem)</option>
        <option value="sqlite" <?= $v('driver') === 'sqlite' ? 'selected' : '' ?>>SQLite (arquivo, sem configurar banco)</option>
      </select>
    </label>
    <div class="campos">
      <label>Servidor<input name="host" value="<?= h($v('host', 'localhost')) ?>"></label>
      <label>Porta (opcional)<input name="porta" value="<?= h($v('porta')) ?>"></label>
      <label>Nome do banco<input name="banco" value="<?= h($v('banco')) ?>"></label>
      <label>Usuário do banco<input name="usuario" value="<?= h($v('usuario')) ?>"></label>
      <label>Senha do banco<input name="senha_bd" type="password"></label>
    </div>
    <h2>Obra e administrador</h2>
    <div class="campos">
      <label>Nome da obra<input name="obra_nome" value="<?= h($v('obra_nome', 'OBRA 198')) ?>"></label>
      <label>Seu nome<input name="admin_nome" value="<?= h($v('admin_nome')) ?>"></label>
      <label>Login do administrador<input name="admin_login" value="<?= h($v('admin_login')) ?>" required></label>
      <label>Senha (mín. 8 caracteres)<input name="admin_senha" type="password" minlength="8" required></label>
    </div>
    <h2>Atualização pelo GitHub (opcional)</h2>
    <div class="campos">
      <label>Token de leitura do GitHub<input name="github_token" value="<?= h($v('github_token')) ?>"></label>
      <label>Repositório<input name="github_repositorio" value="<?= h($v('github_repositorio', 'xpfelipe258/pasta-claude')) ?>"></label>
      <label>Ramo<input name="github_ramo" value="<?= h($v('github_ramo', 'claude/brave-bardeen-jyxlhm')) ?>"></label>
    </div>
    <button class="btn primario" type="submit">Instalar</button>
  </form>
</main>
</body></html>
