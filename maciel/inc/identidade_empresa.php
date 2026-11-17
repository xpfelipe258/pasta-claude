<?php
/** Identidade de apresentação: o ID da organização prevalece sobre siglas e campos legados. */
function usuario_identidade_empresa(array $u)
{
    $id=(int)($u['id']??0);
    $r=$id?q_global('SELECT u.organizacao_id,o.nome AS empresa_nome FROM usuarios u LEFT JOIN organizacoes o ON o.id=u.organizacao_id WHERE u.id=?',[$id])->fetch():false;
    $org=$r && !empty($r['empresa_nome'])?(int)$r['organizacao_id']:0;
    return ['organizacao_id'=>$org,'empresa_nome'=>$org?(string)$r['empresa_nome']:'Sem empresa vinculada','vinculada'=>$org>0];
}
function usuario_rotulo_empresa(array $u)
{
    $v=usuario_identidade_empresa($u);
    return (string)($u['nome']??'Usuário').' · '.$v['empresa_nome'];
}
function identidade_tem_estrutura()
{
    $sql=(config()['driver']??'mysql')==='sqlite'?"SELECT name FROM sqlite_master WHERE type='table' AND name=?":'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?';
    return (bool)q_global($sql,['organizacao_estrutura'])->fetchColumn();
}
function tarefa_empresas_permitidas(array $u)
{
    $v=usuario_identidade_empresa($u);$id=$v['organizacao_id'];if(!$id)return [];
    $ids=[$id];
    if(identidade_tem_estrutura()){
        $e=q_global('SELECT tipo,gerenciadora_id FROM organizacao_estrutura WHERE organizacao_id=?',[$id])->fetch();
        if($e && $e['tipo']==='GERENCIADORA')foreach(q_global('SELECT organizacao_id FROM organizacao_estrutura WHERE gerenciadora_id=?',[$id])->fetchAll(PDO::FETCH_COLUMN) as $filha)$ids[]=(int)$filha;
        elseif($e && $e['tipo']==='EXECUTORA' && !empty($e['gerenciadora_id']))$ids[]=(int)$e['gerenciadora_id'];
    }
    return array_values(array_unique($ids));
}
/** Destinatários de tarefas incluem as executoras irmãs da mesma gerenciadora. Não altera o escopo do mural. */
function tarefa_empresas_destinatarias(array $u)
{
    $ids=tarefa_empresas_permitidas($u);
    $org=usuario_identidade_empresa($u)['organizacao_id'];
    if(!$org || !identidade_tem_estrutura())return $ids;
    $e=q_global('SELECT tipo,gerenciadora_id FROM organizacao_estrutura WHERE organizacao_id=?',[$org])->fetch();
    if($e && $e['tipo']==='EXECUTORA' && !empty($e['gerenciadora_id'])){
        $pai=(int)$e['gerenciadora_id'];
        if(q_global('SELECT tipo FROM organizacao_estrutura WHERE organizacao_id=?',[$pai])->fetchColumn()==='GERENCIADORA'){
            foreach(q_global("SELECT organizacao_id FROM organizacao_estrutura WHERE gerenciadora_id=? AND tipo='EXECUTORA'",[$pai])->fetchAll(PDO::FETCH_COLUMN) as $irma)$ids[]=(int)$irma;
        }
    }
    return array_values(array_unique($ids));
}
function tarefa_destinos_por_empresa(array $u)
{
    $ids=tarefa_empresas_destinatarias($u);$geral=($u['perfil']??'')==='admin';$eu=(int)$u['id'];$out=[];
    foreach(q_global('SELECT u.id,u.nome,u.perfil,u.organizacao_id,o.nome AS empresa_nome FROM usuarios u LEFT JOIN organizacoes o ON o.id=u.organizacao_id WHERE u.ativo=1 ORDER BY o.nome,u.nome,u.id')->fetchAll() as $d){
        $org=!empty($d['empresa_nome'])?(int)$d['organizacao_id']:0;
        if((int)$d['id']!==$eu && !$geral && (!$ids || (($d['perfil']??'')!=='admin' && !in_array($org,$ids,true))))continue;
        $nome=$org?(string)$d['empresa_nome']:'Sem empresa vinculada';
        $out[]=['id'=>(int)$d['id'],'nome'=>(string)$d['nome'],'organizacao_id'=>$org,'empresa'=>$nome,'empresa_nome'=>$nome,'grupo'=>$nome];
    }
    return $out;
}
function identidade_organizacao_apresentacao($id)
{
    $o=$id?organizacao_ler((int)$id):null;if(!$o)return null;
    $d=cfg_identidade_ler((int)$id);
    return ['organizacao_id'=>(int)$id,'nome'=>(string)$o['nome'],'logo'=>$d['logo'],'cor'=>$d['cor'],'cor2'=>$d['cor2']];
}
/** Somente empresas ligadas à obra acessível. Os aliases ficam como chaves de compatibilidade, nunca como vínculo novo. */
function identidade_contexto_relatorio(array $u)
{
    $out=[];list($org)=usuario_organizacao_id($u);
    if($org && ($d=identidade_organizacao_apresentacao($org)))$out['__ORG__']=$d;
    $id=obra_atual_id();if(!$id || !usuario_pode_obra($u,$id))return (object)$out;
    $obra=q_global('SELECT id,organizacao_id,origem_obra_id,empresa_vinculada FROM obras WHERE id=?',[$id])->fetch();if(!$obra)return (object)$out;
    $linhas=[$obra];
    if(empty($obra['origem_obra_id']))$linhas=array_merge($linhas,q_global('SELECT id,organizacao_id,origem_obra_id,empresa_vinculada FROM obras WHERE origem_obra_id=?',[$id])->fetchAll());
    foreach($linhas as $o){
        $d=identidade_organizacao_apresentacao((int)($o['organizacao_id']??0));if(!$d)continue;
        $out['ORG:'.$d['organizacao_id']]=$d;
        $out[mb_strtoupper(trim($d['nome']),'UTF-8')]=$d;
        $alias=mb_strtoupper(trim((string)($o['empresa_vinculada']??'')),'UTF-8');if($alias!=='')$out[$alias]=$d;
        if((int)$o['id']===$id)$out['__OBRA__']=$d;
    }
    if(!empty($obra['origem_obra_id'])){
        $pai=q_global('SELECT organizacao_id FROM obras WHERE id=?',[(int)$obra['origem_obra_id']])->fetchColumn();
        if($pai && ($d=identidade_organizacao_apresentacao((int)$pai)))$out['__CLIENTE__']=$d;
    }elseif(isset($out['__OBRA__']))$out['__CLIENTE__']=$out['__OBRA__'];
    return (object)$out;
}

/** O cadastro da obra também grava o vínculo real da conta, sem transferir usuários de outras empresas. */
function usuario_vinculo_cadastro_obra(array $ator,array $post,$uid=0)
{
    $atual=$uid?q_global('SELECT id,perfil,organizacao_id,empresa FROM usuarios WHERE id=?',[(int)$uid])->fetch():null;
    if($atual && $atual['perfil']==='admin')return ['org'=>(int)$atual['organizacao_id'],'empresa'=>$atual['empresa']];
    if($atual && empty($post['empresa_vinculo_enviado']))return ['org'=>(int)$atual['organizacao_id'],'empresa'=>$atual['empresa']];
    $geral=($ator['perfil']??'')==='admin';$propria=usuario_identidade_empresa($ator)['organizacao_id'];
    $org=$geral?(int)($post['organizacao_id']??0):$propria;
    if(!$org || !organizacao_ler($org))throw new InvalidArgumentException('Selecione a empresa cadastrada do usuário.');
    if(!$geral && ((isset($post['organizacao_id']) && (int)$post['organizacao_id']!==$propria) || ($atual && (int)$atual['organizacao_id']>0 && (int)$atual['organizacao_id']!==$propria)))throw new InvalidArgumentException('Você só vincula usuários à sua própria empresa.');
    $antes=(int)($atual['organizacao_id']??0);
    if($atual && $antes!==$org){
        if($antes || q_global('SELECT 1 FROM usuarios_obras WHERE usuario_id=? AND obra_id<>?',[(int)$uid,obra_atual_id()])->fetchColumn())throw new InvalidArgumentException('Altere o vínculo deste usuário pelo Painel administrativo › Usuários, revisando todas as obras.');
        list($ok,$msg)=plano_verificar_usuario($org);if(!$ok)throw new InvalidArgumentException($msg);
    }
    $obra=q_global('SELECT organizacao_id,origem_obra_id,empresa_vinculada FROM obras WHERE id=?',[obra_atual_id()])->fetch();
    if(!$obra)throw new InvalidArgumentException('Obra não encontrada.');
    if((int)$obra['organizacao_id']===$org)$alias=trim((string)($obra['empresa_vinculada']??''));
    else{
        $op=q_global('SELECT empresa_vinculada FROM obras WHERE origem_obra_id=? AND organizacao_id=?',[obra_atual_id(),$org])->fetchAll(PDO::FETCH_COLUMN);
        $op=array_values(array_unique(array_filter(array_map('trim',$op))));
        if(count($op)!==1)throw new InvalidArgumentException('Vincule a executora e seu espelho à obra antes de cadastrar este acesso.');
        $alias=$op[0];
    }
    return ['org'=>$org,'empresa'=>$alias!==''?$alias:null];
}
function usuario_vinculo_campo_obra(array $ator)
{
    $geral=($ator['perfil']??'')==='admin';$minha=usuario_identidade_empresa($ator);
    $op=$geral?q_global('SELECT id,nome FROM organizacoes ORDER BY nome')->fetchAll():($minha['vinculada']?[['id'=>$minha['organizacao_id'],'nome'=>$minha['empresa_nome']]]:[]);
    $html='<input type="hidden" name="empresa_vinculo_enviado" value="1"><input type="hidden" name="empresa" value=""><label>Empresa cadastrada<select name="organizacao_id"><option value="">Selecione a empresa</option>';
    foreach($op as $o)$html.='<option value="'.(int)$o['id'].'"'.(!$geral?' selected':'').'>'.h($o['nome']).'</option>';
    return $html.'</select></label>';
}

function relatorio_empresa_nome()
{
    $u=usuario_atual();if(!$u)return 'Empresa não informada';
    $mapa=(array)identidade_contexto_relatorio($u);
    $pedido=mb_strtoupper(trim((string)($_GET['empresa']??$_GET['tipo']??'')),'UTF-8');
    if($pedido!=='' && isset($mapa[$pedido]))return $mapa[$pedido]['nome'];
    return $mapa['__OBRA__']['nome']??$mapa['__ORG__']['nome']??'Empresa não informada';
}

function mural_empresas_opcoes(array $u)
{
    $ids=tarefa_empresas_permitidas($u);$geral=($u['perfil']??'')==='admin';
    if(!$geral && !$ids)return [];
    $sql='SELECT id,nome FROM organizacoes'.($geral?'':' WHERE id IN ('.implode(',',array_map('intval',$ids)).')').' ORDER BY nome';
    return q_global($sql)->fetchAll();
}
function mural_destino_empresa(array $u,array $post)
{
    $org=(int)($post['mural_empresa_id']??usuario_identidade_empresa($u)['organizacao_id']);
    $op=array_map('intval',array_column(mural_empresas_opcoes($u),'id'));
    if(!$org || !in_array($org,$op,true))throw new InvalidArgumentException('Selecione uma empresa permitida para enviar ao mural. Contas sem vínculo precisam ser vinculadas pelo administrador.');
    return $org;
}
function mural_visibilidade_sql(array $u,$alias='m')
{
    if(!preg_match('/^[a-z][a-z0-9_]*$/i',$alias))throw new InvalidArgumentException('Alias inválido.');
    if(($u['perfil']??'')==='admin')return '1=1';
    $eu=(int)$u['id'];$ids=tarefa_empresas_permitidas($u);
    return '('.$alias.'.tarefa_id <> 0 OR '.$alias.'.usuario_id = '.$eu.($ids?' OR '.$alias.'.organizacao_id IN ('.implode(',',array_map('intval',$ids)).')':'').')';
}
function mural_filtro_por_usuario_id($id,$alias='m')
{
    $u=q_global('SELECT id,perfil FROM usuarios WHERE id=?',[(int)$id])->fetch();
    return $u?mural_visibilidade_sql($u,$alias):'1=0';
}
function mural_mensagem_pode_ver(array $u,array $m)
{
    if((int)$m['tarefa_id']!==0)return tarefa_conversa_acesso($u,(int)$m['tarefa_id']);
    if(($u['perfil']??'')==='admin' || (int)$m['usuario_id']===(int)$u['id'])return true;
    return (int)($m['organizacao_id']??0)>0 && in_array((int)$m['organizacao_id'],tarefa_empresas_permitidas($u),true);
}
function mensagem_empresa_snapshot(array $u,$tarefaId,array $post=[])
{
    $org=(int)$tarefaId===0?mural_destino_empresa($u,$post):usuario_identidade_empresa($u)['organizacao_id'];
    $v=usuario_identidade_empresa($u);
    return ['id'=>$org?:null,'nome'=>$v['vinculada']?$v['empresa_nome']:null];
}
