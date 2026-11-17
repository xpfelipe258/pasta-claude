<?php
/** Mantém o vínculo à empresa separado do nível de acesso em cada obra. */
function empresa_usuario_obras_salvar($orgId, $uid, $admin, array $idsObras, array $permitidas, array $post)
{
    $marcadas = array_values(array_intersect($idsObras, array_map('intval', (array)($post['obras'] ?? []))));
    $admins = array_values(array_intersect($idsObras, array_map('intval', (array)($post['admin_obras'] ?? []))));
    if (!isset($post['admin_obras_enviado'])) {
        $antigos = q_global('SELECT obra_id FROM usuarios_obras WHERE usuario_id = ? AND admin_obra = 1', [(int)$uid])->fetchAll(PDO::FETCH_COLUMN);
        $admins = array_values(array_unique(array_merge($admins, array_intersect($idsObras, array_map('intval', $antigos)))));
    }
    if (!$admin && $admins && ($post['perfil'] ?? 'editor') === 'leitura') { throw new InvalidArgumentException('O administrador de obra não pode ter perfil somente leitura.'); }
    $marcadas = array_values(array_unique(array_merge($marcadas, $admins)));
    // Preserva a regra existente: o criador continua administrador da obra.
    foreach (q_global('SELECT id FROM obras WHERE organizacao_id = ? AND criador_id = ?', [(int)$orgId, (int)$uid])->fetchAll(PDO::FETCH_COLUMN) as $id) {
        if (in_array((int)$id, $idsObras, true)) { $admins[] = (int)$id; $marcadas[] = (int)$id; }
    }
    if ($idsObras) { q_global('DELETE FROM usuarios_obras WHERE usuario_id = ? AND obra_id IN (' . implode(',', array_map('intval', $idsObras)) . ')', [(int)$uid]); }
    if ($admin) {
        foreach ($idsObras as $oid) { organizacao_ligar_usuario_obra($uid, $oid, 1); }
        q_global('DELETE FROM usuarios_modulos WHERE usuario_id = ?', [(int)$uid]);
        return;
    }
    $mods = array_values(array_intersect($permitidas, array_map('strval', (array)($post['modulos'] ?? []))));
    if ($marcadas && !$mods) { throw new InvalidArgumentException('Marque ao menos uma área de acesso para o usuário.'); }
    foreach (array_unique($marcadas) as $oid) {
        $adm = in_array($oid, $admins, true);
        organizacao_ligar_usuario_obra($uid, $oid, $adm ? 1 : 0);
        q_global('UPDATE usuarios_obras SET nivel = ? WHERE usuario_id = ? AND obra_id = ?', [$adm ? 'admin' : (($post['perfil'] ?? '') === 'leitura' ? 'leitor' : 'editor'), (int)$uid, $oid]);
    }
    organizacao_usuario_modulos($uid, $mods, $permitidas);
}

function empresa_pode_nomear_admin_obra(array $u)
{
    if (($u['perfil'] ?? '') === 'admin') { return true; }
    if (!usuario_admin_organizacao($u)) { return false; }
    list($org) = usuario_organizacao_id($u);
    $obraOrg = (int)q_global('SELECT organizacao_id FROM obras WHERE id = ?', [obra_atual_id()])->fetchColumn();
    return $obraOrg > 0 ? (int)$org === $obraOrg : usuario_admin_da_obra($u);
}

/** Administrador da obra gerencia editores; nomear/rebaixar administradores cabe à empresa. */
function empresa_validar_delegacao(array $u, $nivel, array $alvo = [])
{
    if (empresa_pode_nomear_admin_obra($u)) { return; }
    if ($nivel === 'admin' || !empty($alvo['admin_obra']) || !empty($alvo['admin_organizacao']) || ($alvo['perfil'] ?? '') === 'admin') {
        throw new InvalidArgumentException('Somente o administrador da empresa ou o administrador geral pode definir administradores da obra.');
    }
}
