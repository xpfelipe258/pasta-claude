<?php
require_once __DIR__ . '/rh_pessoas.php';

/** Resolve a sigla antiga pela organização vinculada ao usuário ou à obra da empresa. */
function sv_empresa_cadastrada(array $u)
{
    $esc = sesmt_norm_empresa(sesmt_escopo_empresa());
    list($org) = usuario_organizacao_id($u);
    if (!$org && $esc !== '' && usuario_pode_obra($u, obra_atual_id())) {
        $obra = q_global('SELECT organizacao_id, empresa_vinculada FROM obras WHERE id = ?', [obra_atual_id()])->fetch();
        if ($obra && sesmt_norm_empresa($obra['empresa_vinculada'] ?? '') === $esc) { $org = (int)($obra['organizacao_id'] ?? 0); }
    }
    $empresa = $org ? organizacao_ler($org) : null;
    return ['id' => (int)$org, 'sigla' => $esc, 'nome' => $empresa ? (string)$empresa['nome'] : $esc];
}

function sv_empresa_nome($valor, array $u)
{
    $ctx=sv_contexto_obra($u);$oid=sv_org_por_empresa($valor,$ctx);
    if($oid)return $ctx['empresas'][$oid]['nome'];
    $empresa = sv_empresa_cadastrada($u);
    return $empresa['sigla'] !== '' && sesmt_norm_empresa($valor) === $empresa['sigla'] ? $empresa['nome'] : $valor;
}

function sv_rh_empresa_corresponde(array $p, $filtro, array $empresa)
{
    $nome = sesmt_norm_empresa($p['empresa'] ?? '');
    $filtro = sesmt_norm_empresa($filtro);
    if ($filtro === '') { return true; }
    if ($empresa['sigla'] !== '' && in_array($filtro, [$empresa['sigla'], sesmt_norm_empresa($empresa['nome'])], true)) {
        if ((int)($p['organizacao_id'] ?? 0) > 0 && $empresa['id'] > 0) { return (int)$p['organizacao_id'] === $empresa['id']; }
        return in_array($nome, [$empresa['sigla'], sesmt_norm_empresa($empresa['nome'])], true)
            || ($nome === '' && $empresa['id'] > 0 && (int)($p['organizacao_id'] ?? 0) === $empresa['id']);
    }
    return $nome === $filtro;
}

/** Pessoas alocadas nesta obra no RH central. Não copia dados para o cadastro SESMT. */
function sv_rh_alocados(array $u)
{
    $obra = obra_atual_id();
    if ($obra <= 0 || !usuario_pode_obra($u, $obra) || !sesmt_pode_ver($u)) { return []; }
    garantir_rh_pessoas();
    $ctx=sv_contexto_obra($u);
    $ids=array_merge([$obra],$ctx['gerenciadora']?array_keys($ctx['espelhos']):[]);
    $linhas=q_global('SELECT * FROM rh_pessoas WHERE obra_id IN ('.implode(',',array_fill(0,count($ids),'?')).') ORDER BY empresa,nome',$ids)->fetchAll();
    $esc = sesmt_norm_empresa(sesmt_escopo_empresa());
    $empresa = sv_empresa_cadastrada($u);
    return array_values(array_filter($linhas, function ($p) use ($esc,$empresa,$ctx,$obra) {
        if($ctx['gerenciadora']){
            $aloc=(int)$p['obra_id'];
            return $aloc===$obra || (isset($ctx['espelhos'][$aloc]) && (int)$p['organizacao_id']===$ctx['espelhos'][$aloc]);
        }
        if($empresa['id']>0 && (int)($p['organizacao_id']??0)>0 && (int)$p['organizacao_id']!==$empresa['id'])return false;
        return sv_rh_empresa_corresponde($p,$esc,$empresa);
    }));
}

function sv_empresas_com_rh(array $u)
{
    if(!usuario_pode_obra($u,obra_atual_id()) || !sesmt_pode_ver($u))return [];
    $ctx=sv_contexto_obra($u);
    $nomes=array_column($ctx['empresas'],'nome');
    $nomes=array_values(array_unique($nomes));sort($nomes,SORT_NATURAL|SORT_FLAG_CASE);return $nomes;
}

/** Lista para a tela/CSV; IDs do RH nunca são usados como IDs dos registros SESMT. */
function sv_listar_com_rh($reg, array $filtros, array $u)
{
    if ($reg !== 'colaboradores') { return sesmt_listar($reg,$filtros); }
    if(!usuario_pode_obra($u,obra_atual_id()) || !sesmt_pode_ver($u))return [];
    $ctxObra=sv_contexto_obra($u);
    $legados=$ctxObra['gerenciadora']?sv_legados_gerenciadora($filtros,$u,$ctxObra):sesmt_listar($reg,array_diff_key($filtros,['empresa'=>true]));
    $def = sesmt_registros()['colaboradores'];
    $ctx = sesmt_contexto('colaboradores');
    $empresa = sesmt_norm_empresa((!$ctxObra['gerenciadora'] && sesmt_escopo_empresa()!=='')?sesmt_escopo_empresa():($filtros['empresa']??''));
    $contextoEmpresa = sv_empresa_cadastrada($u);
    $busca = mb_strtolower(trim((string)($filtros['q'] ?? '')), 'UTF-8');
    $novos = []; $cpfs = [];
    foreach (sv_rh_alocados($u) as $p) {
        if (!sv_filtro_empresa_linha($p,$empresa,$ctxObra) && !(!$ctxObra['gerenciadora'] && sv_rh_empresa_corresponde($p,$empresa,$contextoEmpresa))) { continue; }
        if ($busca !== '') {
            $p['empresa_exib']=sv_nome_empresa_linha($p,$ctxObra);
            $texto = mb_strtolower(implode(' ', array_map(function ($v) { return (string)$v; }, array_intersect_key($p, $def['campos']))), 'UTF-8');
            $cpfBusca = preg_replace('/\D/', '', $busca);
            if (mb_strpos($texto, $busca, 0, 'UTF-8') === false && ($cpfBusca === '' || strpos(preg_replace('/\D/', '', (string)$p['cpf']), $cpfBusca) === false)) { continue; }
        }
        foreach (($filtros['igual'] ?? []) as $campo => $valor) {
            if (isset($def['campos'][$campo]) && $valor !== '' && $valor !== null && (string)($p[$campo] ?? '') !== (string)$valor) { continue 2; }
        }
        $r = array_fill_keys(array_keys($def['campos']), null);
        $r = array_merge($r, $p);
        $r['_origem_rh'] = true;
        $r['empresa_exib'] = $contextoEmpresa['sigla'] !== '' && sv_rh_empresa_corresponde($p, $contextoEmpresa['sigla'], $contextoEmpresa)
            ? $contextoEmpresa['nome'] : sesmt_norm_empresa($p['empresa']);
        $r['empresa_exib']=sv_nome_empresa_linha($r,$ctxObra);
        $r['refs'] = [];
        $r['calc'] = sesmt_calcular('colaboradores', $r, $ctx);
        $r['tom'] = sesmt_pior_tom($r['calc']);
        $mapa = ['critico' => 'vermelho', 'atencao' => 'amarelo', 'ok' => 'verde'];
        $sit = $filtros['sit'] ?? '';
        if ($sit !== '' && isset($mapa[$sit]) && $r['tom'] !== $mapa[$sit]) { continue; }
        $novos[] = $r;
        $cpf = preg_replace('/\D/', '', (string)$p['cpf']);
        if ($cpf !== '') { $cpfs[$cpf] = true; }
    }
    // Se a pessoa já estava nos dois cadastros, a ficha central prevalece na exibição.
    $legados = array_filter($legados, function ($p) use ($cpfs,$empresa,$ctxObra,$contextoEmpresa) {
        if(!sv_filtro_empresa_linha($p,$empresa,$ctxObra) && !(!$ctxObra['gerenciadora'] && sv_rh_empresa_corresponde($p,$empresa,$contextoEmpresa)))return false;
        $cpf = preg_replace('/\D/', '', (string)($p['cpf'] ?? ''));
        return $cpf === '' || !isset($cpfs[$cpf]);
    });
    $todos = array_merge(array_values($legados), $novos);
    foreach ($todos as &$linha) {
        $linha['empresa_exib'] = sv_nome_empresa_linha($linha,$ctxObra);
        if($contextoEmpresa['sigla']!=='' && sesmt_norm_empresa($linha['empresa_exib'])===$contextoEmpresa['sigla'])$linha['empresa_exib']=$contextoEmpresa['nome'];
        $linha=sv_ocultar_custo_externo($linha,$u,$ctxObra);
        if (sesmt_norm_empresa($linha['empresa'] ?? '') === $contextoEmpresa['sigla'] && $contextoEmpresa['sigla'] !== '') { $linha['empresa'] = $contextoEmpresa['nome']; }
    }
    unset($linha);
    usort($todos, function ($a, $b) { return strnatcasecmp($a['empresa_exib'] . ' ' . $a['nome'], $b['empresa_exib'] . ' ' . $b['nome']); });
    return $todos;
}

/** Relações explícitas da obra: nenhuma empresa é vinculada por semelhança de nome. */
function sv_tem_tabela($nome)
{
    $sql=(config()['driver']??'mysql')==='sqlite' ? "SELECT name FROM sqlite_master WHERE type='table' AND name=?" : 'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?';
    return (bool)q_global($sql,[$nome])->fetchColumn();
}
function sv_contexto_obra(array $u)
{
    $id=obra_atual_id();
    $obra=q_global('SELECT * FROM obras WHERE id=?',[$id])->fetch();
    $ctx=['obra'=>$obra?:[], 'gerenciadora'=>false, 'empresas'=>[], 'espelhos'=>[]];
    if(!$obra || !usuario_pode_obra($u,$id) || !sesmt_pode_ver($u))return $ctx;
    list($org)=usuario_organizacao_id($u);
    $dona=(int)($obra['organizacao_id']??0);
    $principal=empty($obra['origem_obra_id']);
    $tipo='';
    if($dona && sv_tem_tabela('organizacao_estrutura'))$tipo=(string)q_global('SELECT tipo FROM organizacao_estrutura WHERE organizacao_id=?',[$dona])->fetchColumn();
    $ctx['gerenciadora']=$principal && (($u['perfil']??'')==='admin' || ($org>0 && (int)$org===$dona && $tipo==='GERENCIADORA'));
    $adicionar=function($oid,$alias='')use(&$ctx){
        $oid=(int)$oid;if(!$oid)return;
        $o=organizacao_ler($oid);if(!$o)return;
        if(!isset($ctx['empresas'][$oid]))$ctx['empresas'][$oid]=['id'=>$oid,'nome'=>$o['nome'],'aliases'=>[]];
        $nomes = [$o['nome'], $alias];
        // Os registros antigos de colaboradores usam a sigla deste cadastro.
        if (in_array(sesmt_norm_empresa($o['nome']), ['EJ MONTAGENS', 'EJ MONTAGENS DE ESTRUTURA METALICAS LTDA'], true)) {
            $nomes[] = 'EJ';
        }
        foreach ($nomes as $nome) {
            $nome = sesmt_norm_empresa($nome);
            if ($nome !== '') {
                $ctx['empresas'][$oid]['aliases'][$nome] = $nome;
            }
        }
    };
    $adicionar($dona,$obra['empresa_vinculada']??'');
    if((int)$org===$dona)$adicionar($dona,$u['empresa']??'');
    if($principal && $ctx['gerenciadora']){
        foreach(q_global('SELECT * FROM obras WHERE origem_obra_id=?',[$id])->fetchAll() as $esp){
            $oid=(int)($esp['organizacao_id']??0);if(!$oid)continue;
            $adicionar($oid,$esp['empresa_vinculada']??'');
            $ctx['espelhos'][(int)$esp['id']]=$oid;
        }
        if(sv_tem_tabela('obra_executoras'))foreach(q_global('SELECT * FROM obra_executoras WHERE obra_id=?',[$id])->fetchAll() as $v){
            $adicionar($v['executora_id'],$v['empresa_catalogo']??'');
            // Só inclui o espelho se o vínculo e a obra concordarem sobre origem e empresa.
            $eid=(int)$v['espelho_id'];
            if($eid!==$id && isset($ctx['espelhos'][$eid]) && $ctx['espelhos'][$eid]===(int)$v['executora_id'])$ctx['espelhos'][$eid]=(int)$v['executora_id'];
        }
    }
    // Uma alocação na própria obra também identifica a empresa cadastrada da pessoa.
    if(sv_tem_tabela('rh_pessoas'))foreach(q_global('SELECT DISTINCT organizacao_id FROM rh_pessoas WHERE obra_id=?',[$id])->fetchAll(PDO::FETCH_COLUMN) as $oid){
        if($ctx['gerenciadora'] || !$org || (int)$oid===(int)$org)$adicionar($oid);
    }
    if(!$ctx['gerenciadora'] && $org>0){$adicionar($org,$u['empresa']??'');$ctx['empresas']=array_intersect_key($ctx['empresas'],[(int)$org=>true]);}
    return $ctx;
}
function sv_org_por_empresa($nome,array $ctx)
{
    $nome=sesmt_norm_empresa($nome);$ids=[];
    foreach($ctx['empresas'] as $id=>$e)if(isset($e['aliases'][$nome]))$ids[]=(int)$id;
    return count($ids)===1?$ids[0]:0;
}
function sv_nome_empresa_linha(array $p,array $ctx)
{
    $org=(int)($p['organizacao_id']??0);
    if($org && isset($ctx['empresas'][$org]))return $ctx['empresas'][$org]['nome'];
    $org=sv_org_por_empresa($p['empresa']??($p['empresa_exib']??''),$ctx);
    return $org?$ctx['empresas'][$org]['nome']:($p['empresa_exib']??($p['empresa']??''));
}
function sv_filtro_empresa_linha(array $p,$filtro,array $ctx)
{
    if($filtro==='')return true;
    $oid=sv_org_por_empresa($filtro,$ctx);
    $pid=(int)($p['organizacao_id']??0);
    if($oid && $pid)return $oid===$pid;
    if($oid)return sv_org_por_empresa($p['empresa']??($p['empresa_exib']??''),$ctx)===$oid;
    return sesmt_norm_empresa($p['empresa']??'')===sesmt_norm_empresa($filtro);
}
/** Consulta operacional dos colaboradores pela gerenciadora, sem conceder edição no RH das executoras. */
function sv_legados_gerenciadora(array $filtros,array $u,array $ctx)
{
    $def=sesmt_registros()['colaboradores'];$contexto=sesmt_contexto('colaboradores');$saida=[];
    $obra=sesmt_obra_id();
    $sql='SELECT * FROM sesmt_colaboradores WHERE obra_id=?';$par=[$obra];
    $esc=sesmt_norm_empresa($filtros['empresa']??'');$busca=mb_strtolower(trim((string)($filtros['q']??'')),'UTF-8');
    foreach(q_global($sql,$par)->fetchAll() as $r){
        if(!sv_filtro_empresa_linha($r,$esc,$ctx))continue;
        if($busca!==''){
            $texto=mb_strtolower(implode(' ',array_map('strval',array_intersect_key($r,$def['campos']))),'UTF-8');$dig=preg_replace('/\D/','',$busca);
            if(mb_strpos($texto,$busca,0,'UTF-8')===false && ($dig==='' || strpos(preg_replace('/\D/','',(string)($r['cpf']??'')),$dig)===false))continue;
        }
        foreach(($filtros['igual']??[]) as $k=>$v)if(isset($def['campos'][$k]) && $v!=='' && $v!==null && (string)($r[$k]??'')!==(string)$v)continue 2;
        $r['empresa_exib']=sv_nome_empresa_linha($r,$ctx);$r['refs']=[];$r['calc']=sesmt_calcular('colaboradores',$r,$contexto);$r['tom']=sesmt_pior_tom($r['calc']);
        $mapa=['critico'=>'vermelho','atencao'=>'amarelo','ok'=>'verde'];$sit=$filtros['sit']??'';
        if($sit!=='' && isset($mapa[$sit]) && $r['tom']!==$mapa[$sit])continue;
        if(sesmt_escopo_empresa()!=='' && sesmt_norm_empresa($r['empresa']??'')!==sesmt_norm_empresa(sesmt_escopo_empresa()))$r['_somente_consulta']=true;
        $saida[]=$r;
    }
    return $saida;
}

/** A consulta operacional da executora não libera a sua folha salarial. */
function sv_ocultar_custo_externo(array $r,array $u,array $ctx)
{
    if(!$ctx['gerenciadora'] || ($u['perfil']??'')==='admin')return $r;
    list($org)=usuario_organizacao_id($u);
    $dono=(int)($r['organizacao_id']??0) ?: sv_org_por_empresa($r['empresa']??'',$ctx);
    if(!$dono || $dono===(int)$org)return $r;
    $def=sesmt_registros()['colaboradores'];
    foreach(($def['campos']??[]) as $k=>$c)if(($c['tipo']??'')==='moeda')$r[$k]=null;
    foreach(['salario','tipo_salario','adicional','vale_transporte','alimentacao','outros_beneficios'] as $k)$r[$k]=null;
    foreach(($def['calc_rh']??[]) as $k)unset($r['calc'][$k]);
    return $r;
}