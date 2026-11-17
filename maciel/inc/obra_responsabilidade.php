<?php
// A empresa responsável é a organização cliente, independente do responsável técnico.
function obra_responsabilidade_destino(array $usuario, array $post, array $obra = [])
{
    if (($usuario['perfil'] ?? '') !== 'admin') {
        // Na edição, o cliente não pode transferir a obra para outra empresa.
        return $obra ? (int)($obra['organizacao_id'] ?? 0) : (int)usuario_organizacao_id($usuario)[0];
    }
    if (!array_key_exists('organizacao_id', $post)) {
        return (int)($obra['organizacao_id'] ?? 0);
    }
    $id = filter_var($post['organizacao_id'], FILTER_VALIDATE_INT, ['options' => ['min_range' => 0]]);
    if ($id === false || ($id > 0 && !organizacao_ler($id))) {
        throw new InvalidArgumentException('Escolha uma empresa responsável válida.');
    }
    return $id;
}

// Chamar na mesma transação que salva os dados cadastrais da obra.
function obra_responsabilidade_gravar($obraId, $anterior, $destino)
{
    if ((int)$anterior === (int)$destino) { return; }
    if ($anterior > 0) {
        // Os usuários da empresa anterior deixam de acessar a obra transferida.
        q_global("DELETE FROM usuarios_obras WHERE obra_id = ? AND usuario_id IN
            (SELECT id FROM usuarios WHERE organizacao_id = ? AND perfil <> 'admin')", [(int)$obraId, (int)$anterior]);
    }
    if ($destino > 0) {
        organizacao_vincular_obra($destino, $obraId);
    } else {
        q_global('UPDATE obras SET organizacao_id = NULL WHERE id = ?', [(int)$obraId]);
    }
}

function obra_responsabilidade_campo(array $usuario, array $obra = [])
{
    $id = $obra ? (int)($obra['organizacao_id'] ?? 0) : (int)usuario_organizacao_id($usuario)[0];
    if (($usuario['perfil'] ?? '') === 'admin') {
        $html = '<label>Empresa responsável<select name="organizacao_id"><option value="0"' . (!$id ? ' selected' : '') . '>Administração do sistema (sem empresa cliente)</option>';
        foreach (q_global('SELECT id, nome FROM organizacoes ORDER BY nome, id')->fetchAll() as $empresa) {
            $html .= '<option value="' . (int)$empresa['id'] . '"' . ((int)$empresa['id'] === $id ? ' selected' : '') . '>' . h($empresa['nome']) . '</option>';
        }
        return $html . '</select></label><p class="nota">A obra ficará vinculada à empresa escolhida e aos administradores dela. Ao trocar a empresa, os usuários da empresa anterior perdem o acesso a esta obra.</p>';
    }
    $empresa = $id ? organizacao_ler($id) : null;
    return '<label>Empresa responsável<input value="' . h($empresa ? $empresa['nome'] : 'Administração do sistema (sem empresa cliente)') . '" readonly></label>'
        . ($empresa && !$obra ? '<p class="nota">Esta obra será vinculada automaticamente à sua empresa.</p>' : '');
}
