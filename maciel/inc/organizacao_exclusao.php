<?php
/** Exclui o cadastro e suas contas; preserva os bloqueios de obras e histórico financeiro. */
function organizacao_exclusao_tem_tabela($tabela)
{
    $sql = (config()['driver'] ?? 'mysql') === 'sqlite'
        ? "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
        : 'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?';
    return (bool)q_global($sql, [$tabela])->fetchColumn();
}
function organizacao_excluir(array $post, array $eu)
{
    if (($eu['perfil'] ?? '') !== 'admin') { throw new InvalidArgumentException('Somente o administrador geral pode excluir empresas.'); }
    $id = filter_var($post['organizacao_id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    if (!$id) { throw new InvalidArgumentException('Empresa inválida.'); }
    $empresa = q_global('SELECT id, nome FROM organizacoes WHERE id = ?', [$id])->fetch();
    if (!$empresa) { throw new InvalidArgumentException('Empresa não encontrada.'); }
    if (trim((string)($post['confirmar_nome'] ?? '')) !== trim((string)$empresa['nome'])) {
        throw new InvalidArgumentException('Para excluir, digite o nome da empresa exatamente como está no cadastro.');
    }
    $motivo = isset($post['motivo_exclusao']) && is_string($post['motivo_exclusao']) ? trim($post['motivo_exclusao']) : '';
    if ($motivo === '' || mb_strlen($motivo, 'UTF-8') > 1000) {
        throw new InvalidArgumentException('Informe o motivo da exclusão (até 1.000 caracteres).');
    }
    if (!bd()->inTransaction()) { throw new RuntimeException('A exclusão da empresa deve ser transacional.'); }
    $usuarios = organizacao_exclusao_tem_tabela('usuarios')
        ? q_global('SELECT * FROM usuarios WHERE organizacao_id = ?', [$id])->fetchAll() : [];
    foreach ($usuarios as $usuario) {
        if (($usuario['perfil'] ?? '') === 'admin' || ($usuario['papel'] ?? '') === 'admin_geral' || (int)$usuario['id'] === (int)($eu['id'] ?? 0)) {
            throw new InvalidArgumentException('A empresa possui um administrador geral. A exclusão não pode remover contas de administração geral do sistema.');
        }
    }
    $tabelas = ['obras' => 'obra(s)', 'organizacoes_pagamentos' => 'pagamento(s)',
        'rh_pessoas' => 'colaborador(es)', 'rh_documentos' => 'documento(s) de RH', 'fin_avulsas' => 'conta(s) avulsa(s)', 'com_orcamentos' => 'orçamento(s)'];
    $vinculos = [];
    foreach ($tabelas as $tabela => $rotulo) {
        if ((config()['driver'] ?? 'mysql') === 'sqlite') {
            $existe = q_global("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [$tabela])->fetchColumn();
        } else {
            $existe = q_global('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', [$tabela])->fetchColumn();
        }
        if (!$existe) { continue; }
        $n = (int)q_global("SELECT COUNT(*) FROM `$tabela` WHERE organizacao_id = ?", [$id])->fetchColumn();
        if ($n > 0) { $vinculos[] = $n . ' ' . $rotulo; }
    }
    $sqlEstrutura = (config()['driver'] ?? 'mysql') === 'sqlite'
        ? "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
        : 'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?';
    $temEstrutura = q_global($sqlEstrutura, ['organizacao_estrutura'])->fetchColumn();
    if ($temEstrutura) {
        $n = (int)q_global('SELECT COUNT(*) FROM organizacao_estrutura WHERE gerenciadora_id = ? OR (organizacao_id = ? AND gerenciadora_id IS NOT NULL)', [$id, $id])->fetchColumn();
        if ($n) { $vinculos[] = $n . ' vínculo(s) entre gerenciadora e executora'; }
    }
    if ($vinculos) {
        throw new InvalidArgumentException('A empresa não pode ser excluída porque possui ' . implode(', ', $vinculos) . '. Transfira ou resolva os vínculos antes de excluir. Para interromper o acesso sem apagar o histórico, use a situação Suspensa.');
    }
    // Limpa somente permissões e credenciais das contas desta empresa. Não realoca usuários.
    foreach ($usuarios as $usuario) {
        foreach (['usuarios_obras', 'usuarios_modulos', 'redefinicoes_senha', 'tarefas_lidas'] as $tabela) {
            if (organizacao_exclusao_tem_tabela($tabela)) { q_global("DELETE FROM `$tabela` WHERE usuario_id = ?", [(int)$usuario['id']]); }
        }
    }
    if ($usuarios) { q_global('DELETE FROM usuarios WHERE organizacao_id = ?', [$id]); }
    if ($temEstrutura) { q_global('DELETE FROM organizacao_estrutura WHERE organizacao_id = ?', [$id]); }
    q_global('DELETE FROM organizacoes WHERE id = ?', [$id]);
    registrar_global('organizacao_excluida', ['id' => $id, 'nome' => $empresa['nome'], 'por' => $eu['login'] ?? '', 'motivo' => $motivo, 'usuarios_excluidos' => array_map(function ($u) { return ['id' => (int)$u['id'], 'login' => $u['login'], 'admin_organizacao' => (int)($u['admin_organizacao'] ?? 0)]; }, $usuarios)]);
    return 'Empresa “' . $empresa['nome'] . '” excluída com ' . count($usuarios) . ' usuário(s).' ;
}

function organizacao_excluir_formulario(array $empresa, $csrf)
{
    return '<details style="display:inline-block;max-width:320px;text-align:left"><summary class="btn perigo" style="cursor:pointer">Excluir empresa</summary>'
        . '<form method="post" style="padding:12px 0" onsubmit="return confirm(\'Excluir definitivamente esta empresa e todos os seus usuários, incluindo o administrador da empresa? Esta ação não pode ser desfeita.\');">'
        . '<input type="hidden" name="csrf" value="' . h($csrf) . '"><input type="hidden" name="acao" value="empresa_excluir">'
        . '<input type="hidden" name="organizacao_id" value="' . (int)$empresa['id'] . '">'
        . '<p>Exclusão definitiva da empresa e de todos os seus usuários, incluindo o criador e o administrador da empresa, sem realocação. Obras e demais registros vinculados continuam bloqueando a exclusão.</p>'
        . '<label>Digite o nome da empresa para confirmar: <b>' . h($empresa['nome']) . '</b>'
        . '<input name="confirmar_nome" required autocomplete="off" style="width:100%;margin:8px 0" aria-label="Nome da empresa para confirmar exclusão"></label>'
        . '<label>Motivo da exclusão *<textarea name="motivo_exclusao" required maxlength="1000" rows="3" style="width:100%;margin:8px 0" placeholder="Descreva por que a empresa está sendo excluída"></textarea></label>'
        . '<p>O motivo será registrado na auditoria.</p>'
        . '<button class="btn perigo">Confirmar exclusão definitiva</button></form></details>';
}
