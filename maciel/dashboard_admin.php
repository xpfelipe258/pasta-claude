<?php
// Dashboard geral: apenas o essencial de material — % do material que chegou na obra, consumo de joist e consumo de material.
// (Os alertas críticos — cronograma, inventário, remessas previstas, impactos e equipamentos — saíram desta tela; seguem nas abas de cada módulo.)
require __DIR__.'/inc/nucleo.php';
require __DIR__.'/inc/modelo.php';
$eu=exigir_login_pagina(); $obra=exigir_obra_pagina();
$pode=fn($m)=>usuario_pode_modulo($eu,$m);
$EP=$pode('suprimentos')?(estoque_planilha_ler() ?: []):[];
$materiais=array_values(array_filter($EP['materiais']??[],'is_array'));

// Soma planejado / chegou / consumido por quantidade e por peso (peso = peso unitário × quantidade, só para itens com peso cadastrado).
function dash_agrega(array $itens): array {
  $r=['nPlan'=>0,'nPeso'=>0,'n'=>0,'qp'=>0.0,'qc'=>0.0,'qk'=>0.0,'qkp'=>0.0,'qcon'=>0.0,'wp'=>0.0,'wc'=>0.0,'wk'=>0.0,'wkp'=>0.0,'wcon'=>0.0,'semPeso'=>0];
  foreach($itens as $x){
    $pl=max(0,(float)($x['planejado']??0)); $ch=max(0,(float)($x['chegou']??0)); $co=max(0,(float)($x['consumido']??0)); $pu=(float)($x['peso_unitario']??0);
    $r['n']++;
    $r['qp']+=$pl; $r['qc']+=min($ch,$pl); $r['qcon']+=$ch; $r['qk']+=$co; $r['qkp']+=min($co,$pl);
    if($pl>0){ $r['nPlan']++; if($pu>0) $r['nPeso']++; }
    if($pu>0){ $r['wp']+=$pu*$pl; $r['wc']+=$pu*min($ch,$pl); $r['wcon']+=$pu*$ch; $r['wk']+=$pu*$co; $r['wkp']+=$pu*min($co,$pl); }
    elseif($pl>0){ $r['semPeso']++; }
  }
  return $r;
}
// Métricas de um grupo: por peso quando a maioria dos itens (>= 80%) tem peso cadastrado; senão por quantidade (somar peso parcial distorceria o resultado).
function dash_metricas(array $itens): array {
  $a=dash_agrega($itens); $peso=$a['wp']>0 && $a['nPlan']>0 && $a['nPeso']/$a['nPlan']>=0.8;
  $pl=$peso?$a['wp']:$a['qp']; $ch=$peso?$a['wc']:$a['qc']; $chRaw=$peso?$a['wcon']:$a['qcon']; $co=$peso?$a['wk']:$a['qk']; $cop=$peso?$a['wkp']:$a['qkp'];
  return ['n'=>$a['n'],'base'=>$peso?'peso':'quantidade','semPeso'=>$peso?($a['nPlan']-$a['nPeso']):0,
    'planejado'=>$pl,'chegou'=>$ch,'chegouTotal'=>$chRaw,'consumido'=>$co,
    'pctChegou'=>$pl>0?min(100,$ch/$pl*100):0,'consChegou'=>$chRaw>0?min(100,$co/$chRaw*100):0,'consPlan'=>$pl>0?min(100,$cop/$pl*100):0,
    'saldo'=>max(0,$chRaw-$co),'falta'=>max(0,$pl-$ch)];
}
function dash_fmt(float $v,string $base): string { return $base==='peso' ? number_format($v/1000,$v>=1000?0:1,',','.').' t' : number_format($v,0,',','.').' un'; }
function dash_p(float $v): string { return number_format($v,0,',','.').'%'; }
function dash_barra(string $rot,float $pct,string $cls=''): string { $p=max(0,min(100,$pct)); return '<div class="dm-lin"><div><span>'.h($rot).'</span><b>'.dash_p($pct).'</b></div><div class="dm-bar"><i class="'.$cls.'" style="width:'.round($p,1).'%"></i></div></div>'; }

$tipos=[]; foreach($materiais as $x){ $t=strtoupper(trim((string)($x['tipo_material']??''))) ?: 'OUTROS'; $tipos[$t][]=$x; }
$rotuloTipo=['JOIST'=>'Joist','FIXADOR'=>'Fixadores','ESTRUTURAL'=>'Estrutural','OUTROS'=>'Outros'];
$geral=dash_metricas($materiais);
$mj=dash_metricas($tipos['JOIST']??[]);
$porTipo=[]; foreach($tipos as $t=>$its){ $porTipo[$t]=dash_metricas($its); }
uasort($porTipo,fn($a,$b)=>$b['planejado']<=>$a['planejado']);
$naoJoist=array_filter($porTipo,fn($k)=>$k!=='JOIST',ARRAY_FILTER_USE_KEY);

$mods=modulos_usuario($eu); $titulo=$eu['perfil']==='admin'?'Dashboard Geral':'Meu Dashboard';
pagina_inicio($titulo, true);
// mesma aparência do sistema: cores da obra e faixa "← Todas as obras" no topo
$corP=cor_segura($obra['cor_primaria']??'',global_ler('cor_primaria','#d97706')); $corS=cor_segura($obra['cor_secundaria']??'',global_ler('cor_secundaria','#111827'));
echo '<style>body{--marca:'.h($corP).';--marca2:'.h($corS).'}</style><div class="obra-contexto"><a href="obras.php">← Todas as obras</a><span>'.h($obra['nome']).'</span>'.($eu['perfil']==='admin'?'<a href="admin.php">Administrar obra</a>':'').'</div>';
$uiOcultosDash=ui_ocultos_usuario($eu);
function dbbtn($aba,$txt){global $uiOcultosDash; if(in_array($aba,$uiOcultosDash['abas'],true)) return ''; return '<button type="button" onclick="location.href=\'index.php?aba='.h($aba).'\'">'.h($txt).'</button>';}
?>
<style>
.dm-grid{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:14px;align-items:start}
@media(max-width:1000px){.dm-grid{grid-template-columns:1fr}}
.dm-card{background:var(--card);border:1px solid var(--linha);border-radius:14px;padding:16px;box-shadow:var(--sombra)}
.dm-card h2{font-size:.78rem;text-transform:uppercase;letter-spacing:.06em;color:var(--fg2);margin:0 0 10px}
.dm-topo{display:flex;gap:16px;align-items:center;margin-bottom:8px}
.dm-pizza{--p:calc(var(--pct,0)*1%);position:relative;display:grid;place-items:center;flex:0 0 104px;width:104px;height:104px;border-radius:50%;background:conic-gradient(var(--acento) 0 var(--p),var(--linha) var(--p) 100%)}
.dm-pizza:after{content:"";position:absolute;inset:14px;border-radius:50%;background:var(--card)}
.dm-pizza span{position:relative;z-index:1;font-size:1.25rem;font-weight:850}
.dm-num{font-size:2.1rem;font-weight:850;line-height:1}.dm-nt{color:var(--fg2);font-size:.82rem;margin-top:4px}
.dm-lin{margin:9px 0}.dm-lin>div:first-child{display:flex;justify-content:space-between;gap:8px;font-size:.84rem}.dm-lin small{color:var(--fg3)}
.dm-bar{height:9px;border-radius:5px;background:var(--linha);margin-top:4px;overflow:hidden}.dm-bar i{display:block;height:100%;background:var(--acento);border-radius:5px}.dm-bar i.v{background:var(--verde)}
.dm-sub{margin-top:12px;color:var(--fg2);font-size:.8rem}.dm-tipo{padding:10px 0;border-top:1px solid var(--linha)}.dm-tipo:first-of-type{border-top:0;padding-top:0}.dm-tipo b{font-size:.92rem}
.dm-vazio{background:var(--card);border:1px dashed var(--linha-forte);border-radius:14px;padding:22px;color:var(--fg2)}
</style>
<header class="topo"><div class="marca"><span class="marca-sigla">!</span><div><h1><?=h($titulo)?></h1><div class="arquivo"><span class="ponto ok"></span><?=h($obra['nome'])?> · material, chegada e consumo</div><div class="usuario"><span><?=h($eu['nome'])?></span><?php if($eu['perfil']==='admin'):?><a href="admin.php">Administração</a><?php endif;?><a href="sair.php">Sair</a></div></div></div></header>
<button class="sidebar-toggle" id="sidebarToggle" aria-label="Menu">☰</button>
<aside class="sidebar" id="sidebar"><nav class="sidebar-nav">
<div class="sidebar-grupo sidebar-dashboard sidebar-tarefas"><div class="sidebar-itens aberto"><?=dbbtn('tarefas','Tarefas a fazer')?></div></div>

<div class="sidebar-grupo sidebar-dashboard"><div class="sidebar-itens aberto"><button class="ativa"><?=h($titulo)?></button></div></div>
<?php if($pode('producao')):?><div class="sidebar-grupo"><div class="sidebar-titulo aberto" data-grupo="producao"><span class="sidebar-icone">☷</span>Produção<span class="seta-grupo">‹</span></div><div class="sidebar-itens aberto" id="grp-producao"><?=dbbtn('painel','Painel')?><?=dbbtn('semana','Programação semanal')?><?=dbbtn('lanc','Lançamentos')?><?=dbbtn('apont','Apontar montagem')?><?=dbbtn('rdo','Relatório diário (RDO)')?><?=dbbtn('plan','Planejamento de montagem')?><?=dbbtn('avanco','Avanço físico')?><?=dbbtn('gantt','Cronograma (Gantt)')?><?=dbbtn('cliente','Dashboard cliente')?><?=dbbtn('tendencia','Tendências')?></div></div><?php endif;?>
<?php if($pode('suprimentos')):?><div class="sidebar-grupo"><div class="sidebar-titulo aberto" data-grupo="suprimentos"><span class="sidebar-icone">□</span>Suprimentos<span class="seta-grupo">‹</span></div><div class="sidebar-itens aberto" id="grp-suprimentos"><?=dbbtn('estmat','Materiais')?><?=dbbtn('estrem','Remessas')?><?=dbbtn('estcons','Consumo físico')?><?=dbbtn('estinv','Inventário')?><?=dbbtn('estcrit','Fixadores críticos')?><?=dbbtn('estsis','Baixa automática')?><?=dbbtn('estvinc','Vínculos')?><?=dbbtn('estpronto','Pronto para iniciar')?></div></div><?php endif;?>
<?php if($pode('consumo')):?><div class="sidebar-grupo"><div class="sidebar-titulo aberto" data-grupo="consumo"><span class="sidebar-icone">⚙</span>Consumo<span class="seta-grupo">‹</span></div><div class="sidebar-itens aberto" id="grp-consumo"><?=dbbtn('equip','Equipamentos')?></div></div><?php endif;?>
<?php if($pode('financeiro')):?><div class="sidebar-grupo"><div class="sidebar-titulo aberto" data-grupo="financeiro"><span class="sidebar-icone">$</span>Financeiro<span class="seta-grupo">‹</span></div><div class="sidebar-itens aberto" id="grp-financeiro"><?=dbbtn('bm','Medição (BM)')?><?=dbbtn('proj','Projeção físico-financeira')?><?=dbbtn('cff','Cronograma físico-financeiro')?></div></div><?php endif;?>
<?php if($pode('gestao')):?><div class="sidebar-grupo"><div class="sidebar-titulo aberto" data-grupo="gestao"><span class="sidebar-icone">◆</span>Gestão<span class="seta-grupo">‹</span></div><div class="sidebar-itens aberto" id="grp-gestao"><?=dbbtn('metas','Metas')?><?=dbbtn('impactos','Impactos')?></div></div><?php endif;?>
<div class="sidebar-grupo sidebar-geral"><div class="sidebar-titulo aberto" data-grupo="geral"><span class="sidebar-icone">☰</span>Geral<span class="seta-grupo">‹</span></div><div class="sidebar-itens aberto" id="grp-geral"><?=dbbtn('tutorial','Tutorial')?><?=dbbtn('config','Configurações')?></div></div>
</nav></aside>
<main class="admin">
<?php if(!$pode('suprimentos')):?>
  <div class="dm-vazio">Seu perfil não tem o módulo de Suprimentos liberado, por isso não há indicadores de material para mostrar aqui. Use o menu ao lado para os módulos que você pode acessar.</div>
<?php elseif(!$materiais):?>
  <div class="dm-vazio">Nenhum material cadastrado no estoque desta obra ainda. Cadastre ou importe os materiais em <a href="index.php?aba=estmat">Suprimentos → Materiais</a>.</div>
<?php else:?>
  <section class="dm-grid">
    <article class="dm-card">
      <h2>Material que chegou na obra</h2>
      <div class="dm-topo"><div class="dm-pizza" style="--pct:<?=round($geral['pctChegou'],1)?>"><span><?=dash_p($geral['pctChegou'])?></span></div>
        <div><div class="dm-num"><?=dash_p($geral['pctChegou'])?></div><div class="dm-nt">do material planejado já chegou<br>(<?=h(dash_fmt($geral['chegou'],$geral['base']))?> de <?=h(dash_fmt($geral['planejado'],$geral['base']))?>, por <?=h($geral['base'])?>)</div></div></div>
      <?php foreach($porTipo as $t=>$m):?><?=dash_barra(($rotuloTipo[$t]??ucfirst(strtolower($t))).' ('.$m['n'].' itens)',$m['pctChegou'])?><?php if($m['base']!==$geral['base']):?><div class="dm-nt" style="margin:-4px 0 6px">calculado por <?=h($m['base'])?>: <?=h(dash_fmt($m['chegou'],$m['base']))?> de <?=h(dash_fmt($m['planejado'],$m['base']))?></div><?php endif;?><?php endforeach;?>
      <?php if($geral['semPeso']>0):?><div class="dm-sub"><?=(int)$geral['semPeso']?> item(ns) sem peso cadastrado ficaram fora do total por peso; cada tipo acima usa a própria base.</div><?php endif;?>
    </article>

    <article class="dm-card">
      <h2>Consumo de joist</h2>
      <?php if(!$mj['n']):?><div class="dm-nt">Não há materiais do tipo JOIST cadastrados.</div><?php else:?>
        <div class="dm-num"><?=dash_p($mj['consChegou'])?></div><div class="dm-nt">do que chegou já foi consumido</div>
        <?=dash_barra('Consumido ÷ chegou',$mj['consChegou'])?>
        <?=dash_barra('Consumido ÷ planejado',$mj['consPlan'],'v')?>
        <div class="dm-sub">Consumido: <b><?=h(dash_fmt($mj['consumido'],$mj['base']))?></b> · Saldo em obra: <b><?=h(dash_fmt($mj['saldo'],$mj['base']))?></b> · Falta chegar: <b><?=h(dash_fmt($mj['falta'],$mj['base']))?></b><br>Base: <?=h($mj['base'])?>, <?=(int)$mj['n']?> itens de joist.</div>
      <?php endif;?>
    </article>

    <article class="dm-card">
      <h2>Consumo de material</h2>
      <?php if(!$naoJoist):?><div class="dm-nt">Não há outros materiais cadastrados além do joist.</div><?php endif;?>
      <?php foreach($naoJoist as $t=>$m):?>
        <div class="dm-tipo"><b><?=h($rotuloTipo[$t]??ucfirst(strtolower($t)))?></b> <span class="dm-nt">· <?=(int)$m['n']?> itens · por <?=h($m['base'])?></span>
          <?=dash_barra('Consumido ÷ chegou',$m['consChegou'])?><?=dash_barra('Consumido ÷ planejado',$m['consPlan'],'v')?>
          <div class="dm-nt">Consumido <?=h(dash_fmt($m['consumido'],$m['base']))?> · saldo em obra <?=h(dash_fmt($m['saldo'],$m['base']))?></div></div>
      <?php endforeach;?>
    </article>
  </section>
  <p class="nota" style="margin-top:12px">Dados do módulo Suprimentos (Materiais). “Chegou” é limitado ao planejado de cada item; o consumo vem da baixa automática e do consumo físico. Detalhes em <a href="index.php?aba=estmat">Materiais</a> e <a href="index.php?aba=estcons">Consumo físico</a>.</p>
<?php endif;?>
</main><script>
document.getElementById('sidebarToggle').onclick=()=>document.getElementById('sidebar').classList.toggle('aberta');
// mesmo comportamento do menu do sistema: lateral (abre/fecha o grupo) ou barra superior (uma lista de cada vez)
(function(){
  const topo=()=>document.documentElement.dataset.menu==='topo'&&window.innerWidth>900;
  const fechar=()=>document.querySelectorAll('.top-aberto').forEach(x=>x.classList.remove('top-aberto'));
  document.querySelectorAll('.sidebar-titulo').forEach(t=>t.addEventListener('click',()=>{
    const g=document.getElementById('grp-'+t.dataset.grupo);
    if(topo()){const abrir=g&&!g.classList.contains('top-aberto');fechar();if(abrir){g.classList.add('top-aberto');t.classList.add('top-aberto');}return;}
    if(g){g.classList.toggle('aberto');t.classList.toggle('aberto');}
  }));
  document.addEventListener('click',ev=>{if(topo()&&!ev.target.closest('.sidebar-titulo, .sidebar-itens'))fechar();});
  document.addEventListener('keydown',ev=>{if(ev.key==='Escape')fechar();});
})();
</script></body></html>