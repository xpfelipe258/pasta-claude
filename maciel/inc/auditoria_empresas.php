<?php
/** Auditoria somente leitura: aponta dados que exigem decisão humana, sem inferir vínculos. */
function auditar_vinculos_empresas()
{
    $achados=[];$orgs=[];foreach(q_global('SELECT id,nome FROM organizacoes')->fetchAll() as $o)$orgs[(int)$o['id']]=$o['nome'];
    foreach(q_global('SELECT id,nome,login,perfil,organizacao_id,ativo FROM usuarios ORDER BY nome')->fetchAll() as $u){
        $oid=(int)($u['organizacao_id']??0);
        if(($u['perfil']??'')!=='admin' && (!$oid || !isset($orgs[$oid])))$achados[]=['tipo'=>'Usuário sem empresa válida','registro'=>$u['nome'].' ('.$u['login'].')','id'=>(int)$u['id'],'situacao'=>empty($u['ativo'])?'Inativo':'Ativo','correcao'=>'Escolher a empresa cadastrada no Painel administrativo › Usuários.','link'=>'sistema.php?v=usuarios'];
    }
    foreach(q_global('SELECT id,nome,organizacao_id FROM obras ORDER BY nome')->fetchAll() as $o){
        $oid=(int)($o['organizacao_id']??0);
        if(!$oid || !isset($orgs[$oid]))$achados[]=['tipo'=>'Obra sem empresa responsável válida','registro'=>$o['nome'],'id'=>(int)$o['id'],'situacao'=>'Revisar cadastro','correcao'=>'Selecionar a empresa responsável ao editar a obra.','link'=>'obras.php?lista=1&todas=1'];
    }
    if(identidade_tem_estrutura()){
        $estruturas=[];foreach(q_global('SELECT organizacao_id,tipo,gerenciadora_id FROM organizacao_estrutura')->fetchAll() as $e)$estruturas[(int)$e['organizacao_id']]=$e;
        foreach($orgs as $oid=>$nome){
            $e=$estruturas[$oid]??null;
            if(!$e || !in_array($e['tipo'],['GERENCIADORA','EXECUTORA'],true))$achados[]=['tipo'=>'Tipo da empresa não definido','registro'=>$nome,'id'=>$oid,'situacao'=>'Revisar cadastro','correcao'=>'Definir Gerenciadora ou Executora. Executora pode ficar sem gerenciadora.','link'=>'config_empresa.php?org='.$oid];
            elseif(!empty($e['gerenciadora_id']) && ($e['tipo']!=='EXECUTORA' || (int)$e['gerenciadora_id']===$oid || !isset($estruturas[(int)$e['gerenciadora_id']]) || $estruturas[(int)$e['gerenciadora_id']]['tipo']!=='GERENCIADORA'))$achados[]=['tipo'=>'Vínculo empresarial inconsistente','registro'=>$nome,'id'=>$oid,'situacao'=>'Revisar vínculo','correcao'=>'Confirmar a gerenciadora correta antes de alterar.','link'=>'config_empresa.php?org='.$oid];
        }
    }
    return $achados;
}
