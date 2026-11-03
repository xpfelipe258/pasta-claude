<?php
// Administração geral de usuários (Painel administrativo › Usuários, só o administrador geral): papel, empresa, obras e áreas de cada pessoa.
// Papéis: admin_geral, admin_empresa, editor_empresa, editor_sistema (e os anteriores editor_obra e leitor). Ver papeis_catalogo() em nucleo.php.

/** Obras que podem ser ligadas a um usuário (principais e próprias das empresas; rascunhos e excluídas ficam de fora). */
function upap_obras()
{
    return q_global("SELECT id, nome, organizacao_id, empresa_vinculada, origem_obra_id FROM obras WHERE status IN ('ativa','arquivada') ORDER BY nome")->fetchAll();
}

/** Nomes de empresas terceirizadas já cadastradas nas obras (EJ, CMM, GLOBO AÇOS…), para o campo Empresa. */
function upap_empresas_terceirizadas()
{
    $nomes = [];
    try {
        foreach (q_global("SELECT DISTINCT empresa_vinculada FROM obras WHERE empresa_vinculada IS NOT NULL AND empresa_vinculada <> ''")->fetchAll(PDO::FETCH_COLUMN) as $n) { $nomes[mb_strtoupper(trim($n))] = true; }
        foreach (q_global("SELECT DISTINCT empresa FROM usuarios WHERE empresa IS NOT NULL AND empresa <> ''")->fetchAll(PDO::FETCH_COLUMN) as $n) { $nomes[mb_strtoupper(trim($n))] = true; }
    } catch (Throwable $e) { /* sem colunas novas */ }
    foreach (['EJ', 'CMM', 'GLOBO AÇOS'] as $n) { $nomes[$n] = true; }
    $l = array_keys($nomes);
    sort($l);
    return $l;
}

/** Liga o usuário às obras marcadas (apaga as ligações anteriores). */
function upap_ligar_obras($uid, array $obraIds, $admin = 0)
{
    q_global('DELETE FROM usuarios_obras WHERE usuario_id = ?', [(int)$uid]);
    foreach (array_unique(array_map('intval', $obraIds)) as $oid) {
        if ($oid > 0) { q_global('INSERT INTO usuarios_obras (usuario_id, obra_id, admin_obra) VALUES (?, ?, ?)', [(int)$uid, $oid, $admin ? 1 : 0]); }
    }
}

/**
 * Cria ou edita um usuário a partir do formulário. Devolve a mensagem de sucesso; lança InvalidArgumentException com o motivo quando recusa.
 * Campos: id (0 = novo), nome, login, email, senha (só novo), papel, organizacao_id, empresa, obras[], modulos[].
 */
function upap_salvar(array $p, array $eu)
{
    $papeis = papeis_catalogo();
    $id = (int)($p['id'] ?? 0);
    $alvo = $id ? q_global('SELECT * FROM usuarios WHERE id = ?', [$id])->fetch() : null;
    if ($id && !$alvo) { throw new InvalidArgumentException('Usuário não encontrado.'); }
    $nome = trim((string)($p['nome'] ?? ''));
    $login = trim((string)($p['login'] ?? ''));
    $email = trim((string)($p['email'] ?? ''));
    $papel = (string)($p['papel'] ?? '');
    if (!isset($papeis[$papel])) { throw new InvalidArgumentException('Escolha o papel do usuário.'); }
    if ($nome === '' || mb_strlen($nome) < 2) { throw new InvalidArgumentException('Informe o nome do usuário.'); }
    if (!preg_match('/^[A-Za-z0-9._@-]{3,50}$/', $login)) { throw new InvalidArgumentException('Login: de 3 a 50 caracteres (letras, números, ponto, hífen, sublinhado ou @).'); }
    if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) { throw new InvalidArgumentException('Informe um e-mail válido.'); }
    if (q_global('SELECT id FROM usuarios WHERE login = ? AND id <> ?', [$login, $id])->fetch()) { throw new InvalidArgumentException('Já existe outro usuário com o login “' . $login . '”.'); }
    $senha = (string)($p['senha'] ?? '');
    if (!$id && strlen($senha) < 8) { throw new InvalidArgumentException('A senha inicial precisa ter pelo menos 8 caracteres.'); }

    $orgId = (int)($p['organizacao_id'] ?? 0);
    $empresa = mb_strtoupper(trim((string)($p['empresa'] ?? '')));
    $obrasMarcadas = array_map('intval', (array)($p['obras'] ?? []));
    $mods = array_values(array_intersect(modulos_sistema(), array_map('strval', (array)($p['modulos'] ?? []))));
    $todasObras = [];
    foreach (upap_obras() as $o) { $todasObras[(int)$o['id']] = $o; }

    // não deixa o sistema sem administrador geral nem o administrador se rebaixar sozinho
    if ($alvo && $alvo['perfil'] === 'admin' && $papel !== 'admin_geral') {
        if ((int)$alvo['id'] === (int)$eu['id']) { throw new InvalidArgumentException('Você não pode tirar o seu próprio papel de administrador geral.'); }
        $n = (int)q_global("SELECT COUNT(*) FROM usuarios WHERE perfil = 'admin' AND ativo = 1 AND id <> ?", [$id])->fetchColumn();
        if ($n < 1) { throw new InvalidArgumentException('Este é o último administrador geral ativo: o sistema não pode ficar sem um.'); }
    }

    $perfil = 'editor'; $adminOrg = 0; $empresaCampo = null; $orgCampo = null; $obrasFinal = []; $adminObra = 0; $modsFinal = [];
    if ($papel === 'admin_geral') {
        $perfil = 'admin';
    } elseif ($papel === 'admin_empresa') {
        if (!$orgId || !organizacao_ler($orgId)) { throw new InvalidArgumentException('Escolha a empresa (organização) do administrador da empresa.'); }
        $orgCampo = $orgId; $adminOrg = 1; $adminObra = 1;
        $obrasFinal = array_keys(array_filter($todasObras, function ($o) use ($orgId) { return (int)$o['organizacao_id'] === $orgId && (int)($o['origem_obra_id'] ?? 0) === 0; }));
    } elseif ($papel === 'editor_empresa') {
        if ($orgId) {
            if (!organizacao_ler($orgId)) { throw new InvalidArgumentException('Empresa (organização) não encontrada.'); }
            $orgCampo = $orgId;
            $permitidas = array_keys(array_filter($todasObras, function ($o) use ($orgId) { return (int)$o['organizacao_id'] === $orgId; }));
            $obrasFinal = array_values(array_intersect($obrasMarcadas, $permitidas));
        } else {
            if ($empresa === '') { throw new InvalidArgumentException('Informe a empresa (organização ou empresa terceirizada) do editor da empresa.'); }
            $empresaCampo = $empresa;
            $obrasFinal = array_values(array_intersect($obrasMarcadas, array_keys($todasObras)));
        }
        if (!$obrasFinal) { throw new InvalidArgumentException('Marque a(s) obra(s) da empresa em que o editor da empresa entra.'); }
        $modsFinal = $mods;
        if (!$modsFinal) { throw new InvalidArgumentException('Marque ao menos uma área que o editor da empresa pode usar.'); }
    } elseif ($papel === 'editor_sistema') {
        $modsFinal = $mods;   // áreas que ele pode ALTERAR (pode ficar vazio: só consulta)
    } elseif ($papel === 'editor_obra' || $papel === 'leitor') {
        $perfil = $papel === 'leitor' ? 'leitura' : 'editor';
        $obrasFinal = array_values(array_intersect($obrasMarcadas, array_keys($todasObras)));
        if (!$obrasFinal) { throw new InvalidArgumentException('Marque ao menos uma obra para este usuário.'); }
        $modsFinal = $mods;
        if (!$modsFinal) { throw new InvalidArgumentException('Marque ao menos uma área para este usuário.'); }
    }

    if ($orgCampo && !$id || ($orgCampo && $alvo && (int)($alvo['organizacao_id'] ?? 0) !== $orgCampo)) {   // entrando numa empresa: respeita o limite de usuários do plano
        list($ok, $m) = plano_verificar_usuario($orgCampo);
        if (!$ok) { throw new InvalidArgumentException($m); }
    }

    if ($id) {
        q_global('UPDATE usuarios SET nome = ?, login = ?, email = ?, perfil = ?, papel = ?, empresa = ?, organizacao_id = ?, admin_organizacao = ? WHERE id = ?',
            [$nome, $login, texto_ou_nulo($email), $perfil, $papel, $empresaCampo, $orgCampo, $adminOrg, $id]);
        $uid = $id;
    } else {
        q_global('INSERT INTO usuarios (nome, login, senha, perfil, papel, empresa, email, ativo, organizacao_id, admin_organizacao) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)',
            [$nome, $login, password_hash($senha, PASSWORD_DEFAULT), $perfil, $papel, $empresaCampo, texto_ou_nulo($email), $orgCampo, $adminOrg]);
        $uid = (int)bd()->lastInsertId();
    }
    upap_ligar_obras($uid, $obrasFinal, $adminObra);
    q_global('DELETE FROM usuarios_modulos WHERE usuario_id = ?', [$uid]);
    foreach ($modsFinal as $m) { q_global('INSERT INTO usuarios_modulos (usuario_id, modulo, permitido) VALUES (?, ?, 1)', [$uid, $m]); }
    registrar_global($id ? 'usuario_papel_editado' : 'usuario_criado', ['login' => $login, 'papel' => $papel, 'organizacao' => $orgCampo, 'empresa' => $empresaCampo, 'obras' => count($obrasFinal)]);
    return $id ? 'Usuário “' . $login . '” atualizado (' . $papeis[$papel][0] . ').' : 'Usuário “' . $login . '” criado como ' . $papeis[$papel][0] . '. Entregue o login e a senha inicial a ele.';
}
