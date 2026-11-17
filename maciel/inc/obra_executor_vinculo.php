<?php
require_once __DIR__ . '/organizacao_estrutura.php';
require_once __DIR__ . '/empresas_obra.php';

function garantir_obra_executoras()
{
    garantir_organizacao_estrutura();
    static $ok=false;if($ok)return;
    $fim=(config()['driver']??'mysql')==='sqlite'?'':' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4';
    bd()->exec("CREATE TABLE IF NOT EXISTS obra_executoras (obra_id INT NOT NULL, executora_id INT NOT NULL, espelho_id INT NOT NULL, empresa_catalogo VARCHAR(100) NOT NULL, criado_por INT NOT NULL, criado_em VARCHAR(19) NOT NULL, PRIMARY KEY (obra_id,executora_id))$fim");
    $ok=true;
}

function obra_executoras_listar($id)
{
    return q_global('SELECT v.*, o.nome FROM obra_executoras v JOIN organizacoes o ON o.id=v.executora_id WHERE v.obra_id=? ORDER BY o.nome',[(int)$id])->fetchAll();
}

function obra_executoras_pode(array $u, $org)
{
    return ($u['perfil']??'')==='admin' || ((int)$org>0 && org_estrutura_pode_alterar($u,(int)$org));
}

/** Adiciona executoras, vínculo empresarial e espelhos na mesma transação da obra. */
function obra_executoras_salvar($obraId, array $post, array $u)
{
    if (empty($post['executoras_enviado'])) return;
    if (!bd()->inTransaction()) throw new RuntimeException('O vínculo das executoras deve ser transacional.');
    $obra=q_global('SELECT id,organizacao_id,origem_obra_id FROM obras WHERE id=?',[(int)$obraId])->fetch();
    if (!$obra || !obra_executoras_pode($u,(int)($obra['organizacao_id']??0))) throw new InvalidArgumentException('Somente o administrador da empresa responsável ou o administrador geral define executoras.');
    $org=(int)($obra['organizacao_id']??0);
    $estrutura=$org?org_estrutura_ler($org):['tipo_empresa'=>'','executoras_ids'=>[]];
    $ids=array_values(array_unique(array_filter(array_map('intval',(array)($post['obra_executoras']??[])))));
    $aliases=(array)($post['executoras_alias']??[]);
    if ($estrutura['tipo_empresa']==='EXECUTORA') {
        if (!empty($post['nova_executora_obra']) || array_diff($ids,[$org])) throw new InvalidArgumentException('A executora administra a própria obra. Para gerenciar outras executoras, defina a empresa responsável como gerenciadora.');
        if (!q_global('SELECT 1 FROM obra_executoras WHERE obra_id=? AND executora_id=?',[$obraId,$org])->fetchColumn()) {
            $nome=q_global('SELECT nome FROM organizacoes WHERE id=?',[$org])->fetchColumn();
            q_global('INSERT INTO obra_executoras VALUES (?,?,?,?,?,?)',[$obraId,$org,$obraId,(string)$nome,(int)$u['id'],planos_agora()]);
        }
        return;
    }
    if (!empty($obra['origem_obra_id']) && ($ids || !empty($post['nova_executora_obra']))) throw new InvalidArgumentException('Adicione as executoras na obra principal da gerenciadora.');
    if ($org && $estrutura['tipo_empresa']!=='GERENCIADORA' && ($ids || !empty($post['nova_executora_obra']))) throw new InvalidArgumentException('Defina o tipo da empresa responsável antes de adicionar executoras.');
    if (!empty($post['nova_executora_obra'])) {
        $nova=(array)($post['dados_executora_obra']??[]);
        $novo=org_cadastro_inicial($nova,'EXECUTORA',$u);
        $ids[]=$novo;$aliases[$novo]=(string)($nova['sigla_obra']??'');
    }
    $atuais=obra_executoras_listar($obraId);$existentes=[];
    foreach($atuais as $v){$existentes[(int)$v['executora_id']]=$v;}
    $empresas=[];
    foreach($ids as $id){
        if($id===$org)throw new InvalidArgumentException('A gerenciadora e a executora devem ser empresas diferentes.');
        $e=q_global('SELECT id,nome FROM organizacoes WHERE id=?',[$id])->fetch();
        if(!$e)throw new InvalidArgumentException('Executora não encontrada.');
        $tipo=org_estrutura_ler($id);
        if($tipo['tipo_empresa'] && $tipo['tipo_empresa']!=='EXECUTORA')throw new InvalidArgumentException('Selecione uma empresa executora.');
        if($org && $tipo['gerenciadora_id'] && $tipo['gerenciadora_id']!==$org)throw new InvalidArgumentException('Esta executora já está vinculada a outra gerenciadora. Ajuste o vínculo empresarial antes de adicioná-la.');
        $empresas[$id]=$e;
    }
    if($org && $ids){
        org_estrutura_salvar($org,['tipo_empresa'=>'GERENCIADORA','executoras_ids'=>array_values(array_unique(array_merge($estrutura['executoras_ids'],$ids)))],$u);
    }
    $antes=obra_override();
    try{
        obra_override((int)$obraId);
        foreach($empresas as $id=>$e){
            if(isset($existentes[$id]))continue;
            $alias=trim((string)($aliases[$id]??''));if($alias==='')$alias=$e['nome'];
            $catalogo=null;
            foreach(q('SELECT nome FROM empresas')->fetchAll() as $c){if(oe_norm($c['nome'])===oe_norm($alias)){$catalogo=$c['nome'];break;}}
            if($catalogo===null){$res=eo_criar_empresa(['nome'=>$alias,'modo'=>'vazia']);$catalogo=$res['empresa'];}
            $espelho=null;
            foreach(obra_empresa_listar($obraId) as $c){if(oe_norm($c['empresa_vinculada'])===oe_norm($catalogo)){$espelho=(int)$c['id'];break;}}
            if(!$espelho)$espelho=obra_empresa_criar($obraId,$catalogo);
            $orgEspelho=(int)q_global('SELECT organizacao_id FROM obras WHERE id=?',[$espelho])->fetchColumn();
            if($orgEspelho && $orgEspelho!==$id)throw new InvalidArgumentException('O espelho deste catálogo já pertence a outra empresa cadastrada.');
            organizacao_vincular_obra($id,$espelho);
            q_global('INSERT INTO obra_executoras VALUES (?,?,?,?,?,?)',[$obraId,$id,$espelho,$catalogo,(int)$u['id'],planos_agora()]);
            registrar_global('obra_executora_vinculada',['obra_id'=>$obraId,'executora_id'=>$id,'gerenciadora_id'=>$org,'espelho_id'=>$espelho,'catalogo'=>$catalogo]);
        }
    }finally{obra_override($antes);}
}

function obra_executoras_campos(array $u,array $obra=[])
{
    $id=(int)($obra['id']??0);$org=$id?(int)($obra['organizacao_id']??0):(int)usuario_organizacao_id($u)[0];
    $atuais=$id?obra_executoras_listar($id):[];
    if(!obra_executoras_pode($u,$org))return;
    $opcoes=q_global('SELECT o.id,o.nome,e.tipo FROM organizacoes o LEFT JOIN organizacao_estrutura e ON e.organizacao_id=o.id ORDER BY o.nome')->fetchAll();
    $tipos=[];foreach($opcoes as $o){$tipos[(int)$o['id']]=$o['tipo']??'';}
    ?>
    <fieldset class="obra-grupo" data-obra-executoras data-org="<?= $org ?>" data-tipos="<?= h(json_encode($tipos)) ?>"><legend>Executoras e espelhos da obra</legend>
      <input type="hidden" name="executoras_enviado" value="1">
      <?php if($atuais): ?><p>Já vinculadas: <?= h(implode(', ',array_column($atuais,'nome'))) ?>. Os espelhos e acessos existentes são preservados.</p><?php endif; ?>
      <p data-obra-autogestao hidden>A empresa executora administra esta obra por conta própria. Não é necessário vincular uma gerenciadora.</p>
      <div data-obra-executoras-inputs>
        <p>Você pode criar a obra agora e adicionar executoras depois. Ao adicionar, a empresa será vinculada à obra e à gerenciadora e terá seu espelho independente.</p>
        <div class="campos"><?php foreach($opcoes as $o):if((int)$o['id']===$org||in_array((int)$o['id'],array_map('intval',array_column($atuais,'executora_id')),true)||($o['tipo']&&$o['tipo']!=='EXECUTORA'))continue; ?>
          <label><span><input type="checkbox" name="obra_executoras[]" value="<?= (int)$o['id'] ?>"> <?= h($o['nome']) ?></span><input name="executoras_alias[<?= (int)$o['id'] ?>]" maxlength="30" placeholder="Sigla no catálogo (ex.: EJ, CMM), opcional"></label>
        <?php endforeach; ?></div>
        <label><input type="checkbox" name="nova_executora_obra" value="1"> Cadastrar nova executora nesta obra</label>
        <div data-obra-nova-executora class="campos">
          <label>Nome da executora *<input name="dados_executora_obra[nome]" maxlength="120" data-obrigatorio></label>
          <label>Documento<input name="dados_executora_obra[documento]" maxlength="30"></label>
          <label>Contato<input name="dados_executora_obra[contato]" maxlength="120"></label>
          <label>E-mail<input type="email" name="dados_executora_obra[email]"></label>
          <label>Telefone<input name="dados_executora_obra[telefone]" maxlength="30"></label>
          <label>Sigla no catálogo da obra<input name="dados_executora_obra[sigla_obra]" maxlength="30" placeholder="Use até 30 caracteres, ex.: EJ"></label>
        </div>
        <p class="nota">A sigla mantém a identificação usada nos serviços e medições. Se o nome completo passar de 30 caracteres, informe uma sigla. O cadastro inicial da executora não cria login nem cobrança; o administrador e o plano podem ser definidos depois.</p>
      </div>
    </fieldset>
    <script>
    (function(){document.querySelectorAll('[data-obra-executoras]').forEach(function(box){if(box.dataset.pronto)return;box.dataset.pronto='1';var f=box.closest('form'),tipos=JSON.parse(box.dataset.tipos);
      function grupo(s,visivel){var g=box.querySelector(s);g.hidden=!visivel;g.querySelectorAll('input').forEach(function(el){el.disabled=!visivel;el.required=visivel&&el.hasAttribute('data-obrigatorio');});}
      function sync(){var owner=f.querySelector('[name=organizacao_id]'),id=owner?owner.value:box.dataset.org,propria=tipos[id]==='EXECUTORA';box.querySelector('[data-obra-autogestao]').hidden=!propria;grupo('[data-obra-executoras-inputs]',!propria);grupo('[data-obra-nova-executora]',!propria&&box.querySelector('[name=nova_executora_obra]').checked);box.querySelectorAll('[name="obra_executoras[]"]').forEach(function(el){el.disabled=propria||Number(el.value)===Number(id);});}
      f.addEventListener('change',sync);sync();
    });})();
    </script>
    <?php
}
