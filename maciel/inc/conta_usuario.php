<?php
/** Alterações pessoais sempre usam o usuário autenticado, nunca um ID enviado no formulário. */
function conta_usuario_ler(array $eu)
{
    $u=q_global('SELECT id,nome,login,email FROM usuarios WHERE id=? AND ativo=1',[(int)$eu['id']])->fetch();
    if(!$u)throw new InvalidArgumentException('Usuário não encontrado. Entre novamente.');
    return $u;
}
function conta_usuario_perfil_salvar(array $eu,array $post)
{
    $u=conta_usuario_ler($eu);
    $nome=preg_replace('/\s+/u',' ',trim(strip_tags((string)($post['nome']??''))));
    if(mb_strlen($nome)<2 || mb_strlen($nome)>80)throw new InvalidArgumentException('Informe o nome do cadastro (de 2 a 80 caracteres).');
    $email=trim((string)($post['email']??''));
    if($email!=='' && (mb_strlen($email)>150 || !filter_var($email,FILTER_VALIDATE_EMAIL)))throw new InvalidArgumentException('Informe um e-mail válido.');
    if($email!=='' && q_global('SELECT id FROM usuarios WHERE LOWER(email)=? AND id<>?',[mb_strtolower($email,'UTF-8'),(int)$u['id']])->fetchColumn())throw new InvalidArgumentException('Este e-mail já está em uso por outro usuário.');
    bd()->beginTransaction();
    try{
        q_global('UPDATE usuarios SET nome=?,email=? WHERE id=?',[$nome,$email!==''?$email:null,(int)$u['id']]);
        registrar_global('perfil_alterado',['usuario'=>$u['login']]);
        bd()->commit();
    }catch(Throwable $e){if(bd()->inTransaction())bd()->rollBack();throw $e;}
    return 'Dados da sua conta atualizados.';
}
function conta_usuario_senha_salvar(array $eu,array $post)
{
    $u=q_global('SELECT id,login,senha FROM usuarios WHERE id=? AND ativo=1',[(int)$eu['id']])->fetch();
    if(!$u)throw new InvalidArgumentException('Usuário não encontrado. Entre novamente.');
    $limite=date('Y-m-d H:i:s',time()-900);
    if((int)q_global("SELECT COUNT(*) FROM auditoria_global WHERE usuario=? AND acao='senha_falha' AND quando>=?",[$u['login'],$limite])->fetchColumn()>=5)throw new InvalidArgumentException('Muitas tentativas com a senha atual errada. Aguarde 15 minutos e tente novamente.');
    $atual=(string)($post['senha_atual']??'');$nova=(string)($post['senha_nova']??'');$confirmar=(string)($post['senha_confirmar']??'');
    if($atual==='' || !password_verify($atual,(string)$u['senha'])){registrar_global('senha_falha',['usuario'=>$u['login']]);throw new InvalidArgumentException('A senha atual não confere.');}
    if(strlen($nova)<8)throw new InvalidArgumentException('A nova senha precisa ter pelo menos 8 caracteres.');
    if(strlen($nova)>72)throw new InvalidArgumentException('A nova senha ultrapassa o limite permitido. Escolha uma senha mais curta.');
    if($nova!==$confirmar)throw new InvalidArgumentException('A confirmação da nova senha não confere.');
    if(hash_equals($atual,$nova))throw new InvalidArgumentException('A nova senha precisa ser diferente da atual.');
    if(mb_strtolower($nova,'UTF-8')===mb_strtolower($u['login'],'UTF-8'))throw new InvalidArgumentException('A senha não pode ser igual ao login.');
    $hash=password_hash($nova,PASSWORD_DEFAULT);
    bd()->beginTransaction();
    try{
        q_global('UPDATE usuarios SET senha=? WHERE id=?',[$hash,(int)$u['id']]);
        q_global('UPDATE redefinicoes_senha SET usado_em=? WHERE usuario_id=? AND usado_em IS NULL',[agora(),(int)$u['id']]);
        registrar_global('senha_alterada',['usuario'=>$u['login']]);
        bd()->commit();
    }catch(Throwable $e){if(bd()->inTransaction())bd()->rollBack();throw $e;}
    if(session_status()===PHP_SESSION_ACTIVE)session_regenerate_id(true);
    return 'Senha alterada. Use a nova senha no próximo acesso.';
}
