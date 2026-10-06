<?php
require __DIR__.'/inc/nucleo.php';
require __DIR__.'/inc/modelo.php';
$eu=exigir_login_pagina(); $obra=exigir_obra_pagina();
$pode=fn($m)=>usuario_pode_modulo($eu,$m); $hoje=date('Y-m-d');
$M=montar_modelo(); $EP=estoque_planilha_ler() ?: [];
$impactos=$atrasos=$invCrit=$materialCrit=$faltaSemana=$fixCrit=$consAlert=[];
$remessasPrevistas=$remessasAtrasadasAuto=[];
$totalMetas=0; $totalMateriais=count($EP['materiais']??[]); $totalInventario=count($EP['inventario']??[]); $totalFixadores=0; $totalConsumoBase=0; $totalImpactos=0; $totalRemessas=0;
function dash_add_dias($data,$n){return date('Y-m-d',strtotime($data.' '.($n>=0?'+':'').$n.' day'));}
function dash_dia_util($data){return (int)date('N',strtotime($data))<=5;}
function dash_dias_uteis($a,$b){$n=0;for($d=dash_add_dias($a,1);$d<=$b;$d=dash_add_dias($d,1))if(dash_dia_util($d))$n++;return $n;}
function dash_realizado_servico($M,$servico,$ate){$t=0;foreach(($M['empresas']??[]) as $e)foreach(($e['servicos']??[]) as $s){if(($s['nome']??'')!==$servico)continue;$col=$s['col']??null;if(!$col)continue;foreach(($e['registros']??[]) as $d=>$r){if($d>$ate)continue;$v=$r['v'][$col]??null;if(is_numeric($v)&&$v>0)$t+=(float)$v;}}return $t;}
function dash_prev_cliente($c,$ate){if(empty($c['qtd'])||empty($c['inicio_plan'])||empty($c['meta_dia'])||$ate<$c['inicio_plan'])return 0;return min((float)$c['qtd'],(float)$c['meta_dia']*dash_dias_uteis(dash_add_dias($c['inicio_plan'],-1),$ate));}
function dash_cronograma_atrasados($M,$ate){$itens=array_values(array_filter($M['cliente']??[],fn($c)=>!empty($c['qtd'])));$at=[];foreach($itens as $c){$q=(float)($c['qtd']??0);$real=dash_realizado_servico($M,$c['servico']??'',$ate);$prev=dash_prev_cliente($c,$ate);if($q>0&&$real<$q&&!($prev==0&&$real==0)&&$real<$prev*.95)$at[]=$c;}return [$at,count($itens)];}
function dash_data_iso($v){$t=trim((string)$v);if($t==='')return null;if(preg_match('/^\d{4}-\d{2}-\d{2}$/',$t))return $t;if(preg_match('/^(\d{2})\/(\d{2})\/(\d{4})$/',$t,$m))return $m[3].'-'.$m[2].'-'.$m[1];return null;}
function dash_remessas_previstas($EP,$hoje){$cols=$EP['remessas']['colunas']??[];$datas=$EP['remessas']['datas']??[];$out=[];foreach($cols as $nome){$dt=$datas[$nome]??[];$prev=dash_data_iso($dt['prevista_chegada']??'');if(!$prev)continue;$cheg=dash_data_iso($dt['chegada_obra']??'');if($cheg)continue;$out[]=['nome'=>$nome,'prevista'=>$prev,'nf'=>dash_data_iso($dt['emissao_nota']??'')];}usort($out,fn($a,$b)=>strcmp($a['prevista'],$b['prevista'])?:strcmp($a['nome'],$b['nome']));return $out;}
function dash_remessas_atrasadas_auto($EP){$cols=$EP['remessas']['colunas']??[];$datas=$EP['remessas']['datas']??[];$out=[];foreach($cols as $nome){$dt=$datas[$nome]??[];$prev=dash_data_iso($dt['prevista_chegada']??'');$cheg=dash_data_iso($dt['chegada_obra']??'');if($prev&&$cheg&&$cheg>$prev)$out[]=['nome'=>$nome,'prevista'=>$prev,'chegada'=>$cheg];}return $out;}
if($pode('gestao')){$impactos=q("SELECT * FROM impactos WHERE (solucionado IS NULL OR solucionado='') ORDER BY data DESC,id DESC")->fetchAll();$totalImpactos=(int)q("SELECT COUNT(*) FROM impactos")->fetchColumn();}
if($pode('producao')||$pode('gestao')){[$atrasos,$totalMetas]=dash_cronograma_atrasados($M,$hoje);}
if($pode('suprimentos')){
 $totalRemessas=count($EP['remessas']['colunas']??[]);
 $remessasPrevistas=dash_remessas_previstas($EP,$hoje);
 $remessasAtrasadasAuto=dash_remessas_atrasadas_auto($EP);
 foreach(($EP['inventario']??[]) as $x){$st=strtoupper((string)($x['status']??''));$ac=(float)($x['acuracidade']??1);$acao=strtoupper(trim((string)($x['acao']??'OK')));if(($st&&$st!=='CONFORME')||$ac<.8||($acao&&$acao!=='OK'))$invCrit[]=$x;}
 foreach(($EP['materiais']??[]) as $x){
  $saldo=(float)($x['estoque_pos_baixa']??$x['disponivel']??0);
  $prior=strtoupper(trim((string)($x['prioridade']??'')));
  $st=strtoupper(trim((string)($x['situacao']??$x['status_logistico']??$x['status']??'')));
  // Materiais: contador representa somente linhas que a própria página identifica como vermelhas/críticas.
  if($prior==='P1'||str_contains($st,'FALTA')||str_contains($st,'CRÍT')||str_contains($st,'CRIT')) $materialCrit[]=$x;
  // Baixa automática: somente itens explicitamente classificados como FALTA NA SEMANA.
  if(str_contains($st,'FALTA NA SEMANA')) $faltaSemana[]=$x;
 }
 $ext=$M['estoque_externo']??null;
 if(is_array($ext)){$totalFixadores=count($ext['fixadores']??[]);foreach(($ext['fixadores']??[]) as $x){$st=strtoupper((string)($x['status']??''));if($st!=='OK'||(isset($x['saldo'])&&(float)$x['saldo']<0))$fixCrit[]=$x;}}
 // fallback: regras IFC + remessas para os fixadores sem OK
 if(!$fixCrit){$regras=carregar_regras_baixa();$prem=$regras['consumo_por_servico']['PREMONTAGEM']['itens']??[];$totalFixadores=count($prem);foreach($prem as $x){$rem=0;foreach(($EP['remessas']['itens']??[]) as $r)if(($r['tag']??'')===($x['codigo']??'')){$rem=(float)($r['total_recebido']??0);break;}if($rem<=0)$fixCrit[]=$x;}}
}
if($pode('consumo')){
 $us=$M['tabelas']['usos']??[]; $iniAtual=date('Y-m-d',strtotime('monday this week')); $fimAtual=date('Y-m-d',strtotime('sunday this week'));
 $por=[]; foreach($us as $u){$d=$u['data']??'';if(!$d)continue;$n=trim((string)($u['equipamento']??'NÃO INFORMADO'));$v=(float)($u['litros']??0);if(!$v)$v=(float)($u['custo_combustivel']??0);if(!$v)continue;$seg=date('Y-m-d',strtotime('monday this week',strtotime($d)));$por[$n][$seg]=($por[$n][$seg]??0)+$v;}
 foreach($por as $n=>$sem){$at=(float)($sem[$iniAtual]??0);$ant=$sem;unset($ant[$iniAtual]);if(!$ant)continue;$totalConsumoBase++;$media=array_sum($ant)/count($ant);if($at>$media && $at>0)$consAlert[]=['nome'=>$n,'atual'=>$at,'media'=>$media,'pct'=>$media>0?(($at/$media)-1)*100:100];}
 usort($consAlert,fn($a,$b)=>$b['pct']<=>$a['pct']);
}
$totalImpactos += count($remessasAtrasadasAuto);
$impactosAbertos=count($impactos);
$impactosSolucionados=max(0,$totalImpactos-$impactosAbertos);
$mods=modulos_usuario($eu); $titulo=$eu['perfil']==='admin'?'Dashboard Geral':'Meu Dashboard';
pagina_inicio($titulo);
function dbbtn($aba,$txt,$badge=null,$alert=false){$b=$badge!==null?'<span class="contador'.($alert?' alerta':'').'">'.(int)$badge.'</span>':'';return '<button type="button" onclick="location.href=\'index.php?aba='.h($aba).'\'">'.h($txt).' '.$b.'</button>';}
function dash_pct($valor,$total){$total=(int)$total;return $total>0?max(0,min(100,round(((int)$valor/$total)*100))):0;}
function dash_total_txt($valor,$total){return number_format((int)$valor,0,',','.').' / '.number_format(max(0,(int)$total),0,',','.');}
function dash_card($aba,$foco,$rotulo,$valor,$total,$desc,$acao){$pct=dash_pct($valor,$total);$url='index.php?aba='.rawurlencode($aba).($foco!==''?'&foco='.rawurlencode($foco):'');return '<a class="dash-card alerta dash-card-link dash-card-pizza" href="'.h($url).'" style="--pct:'.$pct.'"><span class="dash-rotulo">'.h($rotulo).'</span><div class="dash-card-corpo"><span class="dash-pizza" aria-hidden="true"><span>'.$pct.'%</span></span><span class="dash-metrica"><b>'.(int)$valor.'</b><em>'.h(dash_total_txt($valor,$total)).'</em></span></div><span class="dash-desc">'.h($desc).'</span><small>'.h($acao).' →</small></a>';}
function dash_card_impactos($abertos,$solucionados,$total){$pct=dash_pct($abertos,$total);$url='index.php?aba=impactos&foco=aberto';return '<a class="dash-card alerta dash-card-link dash-card-pizza dash-card-impactos" href="'.h($url).'" style="--pct:'.$pct.'"><span class="dash-rotulo">IMPACTOS</span><div class="dash-card-corpo"><span class="dash-pizza" aria-hidden="true"><span>'.$pct.'%</span></span><span class="dash-metrica"><b>'.(int)$abertos.'</b><em>'.(int)$abertos.' aberto(s) / '.(int)$total.' total</em><em class="dash-ok">'.(int)$solucionados.' solucionado(s)</em></span></div><span class="dash-desc">impactos abertos x solucionados pelo total</span><small>Ver impactos →</small></a>';}
?>
<style>
.dashboard-alertas .dash-contadores-bonitos>a.dash-card-pizza{min-height:158px!important;gap:10px!important}
.dashboard-alertas .dash-card-corpo{display:flex;align-items:center;gap:14px;width:100%;margin:6px 0 2px}
.dashboard-alertas .dash-pizza{--p:calc(var(--pct,0)*1%);position:relative;display:grid;place-items:center;flex:0 0 70px;width:70px;height:70px;border-radius:50%;background:conic-gradient(#d62828 0 var(--p),rgba(34,197,94,.85) var(--p) 100%);box-shadow:inset 0 0 0 1px var(--linha)}
.dashboard-alertas .dash-pizza:after{content:"";position:absolute;inset:10px;border-radius:50%;background:var(--card)}
.dashboard-alertas .dash-pizza span{position:relative;z-index:1;font-size:.78rem;font-weight:850;color:var(--fg)}
.dashboard-alertas .dash-metrica{display:flex;flex-direction:column;min-width:0}.dashboard-alertas .dash-metrica b{margin:0!important;font-size:1.9rem!important;line-height:1!important}.dashboard-alertas .dash-metrica em{font-style:normal;font-size:.78rem;font-weight:750;color:var(--fg2);margin-top:4px}.dashboard-alertas .dash-metrica .dash-ok{color:var(--verde)}.dashboard-alertas .dash-desc{min-height:2.2em}.dashboard-alertas .dash-card-pizza small{padding-top:4px!important}
@media(max-width:640px){.dashboard-alertas .dash-card-corpo{gap:12px}.dashboard-alertas .dash-pizza{flex-basis:62px;width:62px;height:62px}}
</style>
<header class="topo"><div class="marca"><span class="marca-sigla">!</span><div><h1><?=h($titulo)?></h1><div class="arquivo"><span class="ponto ok"></span><?=h($obra['nome'])?> · indicadores e alertas da obra</div><div class="usuario"><span><?=h($eu['nome'])?></span><?php if($eu['perfil']==='admin'):?><a href="admin.php">Administração</a><?php endif;?><a href="sair.php">Sair</a></div></div></div></header>
<button class="sidebar-toggle" id="sidebarToggle" aria-label="Menu">☰</button>
<aside class="sidebar" id="sidebar"><nav class="sidebar-nav">
<div class="sidebar-grupo sidebar-dashboard"><div class="sidebar-itens aberto"><button class="ativa"><?=h($titulo)?></button></div></div>
<?php if($pode('producao')):?><div class="sidebar-grupo"><div class="sidebar-titulo aberto"><span class="sidebar-icone">☷</span>Produção<span class="seta-grupo">‹</span></div><div class="sidebar-itens aberto"><?=dbbtn('painel','Painel')?><?=dbbtn('semana','Programação semanal')?><?=dbbtn('lanc','Lançamentos')?><?=dbbtn('apont','Apontar montagem')?><?=dbbtn('plan','Planejamento de montagem')?><?=dbbtn('avanco','Avanço físico')?><?=dbbtn('gantt','Cronograma (Gantt)',count($atrasos),count($atrasos)>0)?><?=dbbtn('cliente','Dashboard cliente')?><?=dbbtn('tendencia','Tendências')?></div></div><?php endif;?>
<?php if($pode('suprimentos')):?><div class="sidebar-grupo"><div class="sidebar-titulo aberto"><span class="sidebar-icone">□</span>Suprimentos<span class="seta-grupo">‹</span></div><div class="sidebar-itens aberto"><?=dbbtn('estmat','Materiais',count($materialCrit),count($materialCrit)>0)?><?=dbbtn('estrem','Remessas')?><?=dbbtn('estcons','Consumo físico')?><?=dbbtn('estinv','Inventário',count($invCrit),count($invCrit)>0)?><?=dbbtn('estcrit','Fixadores críticos',count($fixCrit),count($fixCrit)>0)?><?=dbbtn('estsis','Baixa automática',count($faltaSemana),count($faltaSemana)>0)?></div></div><?php endif;?>
<?php if($pode('consumo')):?><div class="sidebar-grupo"><div class="sidebar-titulo aberto"><span class="sidebar-icone">⚙</span>Consumo<span class="seta-grupo">‹</span></div><div class="sidebar-itens aberto"><?=dbbtn('equip','Equipamentos',count($consAlert),count($consAlert)>0)?></div></div><?php endif;?>
<?php if($pode('financeiro')):?><div class="sidebar-grupo"><div class="sidebar-titulo aberto"><span class="sidebar-icone">$</span>Financeiro<span class="seta-grupo">‹</span></div><div class="sidebar-itens aberto"><?=dbbtn('bm','Medição (BM)')?></div></div><?php endif;?>
<?php if($pode('kpi')):?><div class="sidebar-grupo"><div class="sidebar-titulo aberto"><span class="sidebar-icone">★</span>KPI / Insights<span class="seta-grupo">‹</span></div><div class="sidebar-itens aberto"><?=dbbtn('kpi','Visão Geral')?></div></div><?php endif;?>
<?php if($pode('gestao')):?><div class="sidebar-grupo"><div class="sidebar-titulo aberto"><span class="sidebar-icone">◆</span>Gestão<span class="seta-grupo">‹</span></div><div class="sidebar-itens aberto"><?=dbbtn('metas','Metas',count($atrasos),count($atrasos)>0)?><?=dbbtn('impactos','Impactos',count($impactos),count($impactos)>0)?></div></div><?php endif;?>
</nav></aside>
<main class="admin"><section class="bloco dashboard-alertas"><div class="bloco-cab"><div><h2>Alertas importantes</h2><span class="nota">Indicadores que exigem atenção. Cada pizza mostra a quantidade afetada sobre o total do módulo.</span></div></div><div class="dash-contadores dash-contadores-bonitos">
<?php if($pode('producao')||$pode('gestao')):?><?=dash_card('gantt','alerta','CRONOGRAMA / METAS',count($atrasos),$totalMetas,'atraso(s) identificado(s)','Ver cronograma e analisar')?><?php endif;?>
<?php if($pode('suprimentos')):?><?=dash_card('estmat','critico','MATERIAIS',count($materialCrit),$totalMateriais,'item(ns) em situação crítica','Ver materiais')?><?=dash_card('estrem','','REMESSAS PREVISTAS',count($remessasPrevistas),$totalRemessas,'remessa(s) com previsão de chegada em aberto','Ver remessas')?><?=dash_card('estinv','critico','INVENTÁRIO',count($invCrit),$totalInventario,'item(ns) crítico(s)','Ver inventário')?><?=dash_card('estsis','falta-semana','BAIXA AUTOMÁTICA',count($faltaSemana),$totalMateriais,'item(ns) com FALTA NA SEMANA','Analisar baixa automática')?><?=dash_card('estcrit','critico','FIXADORES CRÍTICOS',count($fixCrit),$totalFixadores,'fixador(es) fora de OK','Ver fixadores críticos')?><?php endif;?>
<?php if($pode('consumo')):?><?=dash_card('equip','acima-media','CONSUMO',count($consAlert),$totalConsumoBase,'item(ns) acima da média','Ver consumo / equipamentos')?><?php endif;?>
<?php if($pode('gestao')):?><?=dash_card_impactos($impactosAbertos,$impactosSolucionados,$totalImpactos)?><?php endif;?>
</div></section>
<?php if($pode('consumo')):?><section class="bloco"><div class="bloco-cab"><h2>Indicadores de consumo</h2><span class="nota">Compara o consumo da semana atual com a média das semanas anteriores registradas. Valores acima da média geram atenção.</span></div><?php if(!$consAlert):?><div class="faixa" style="margin:0">Nenhum consumo acima da média no período disponível.</div><?php else:?><div class="tabela-rolagem"><table><thead><tr><th>Equipamento / item</th><th>Semana atual</th><th>Média anterior</th><th>Variação</th><th>Situação</th></tr></thead><tbody><?php foreach($consAlert as $x):?><tr><td><b><?=h($x['nome'])?></b></td><td><?=number_format($x['atual'],1,',','.')?></td><td><?=number_format($x['media'],1,',','.')?></td><td class="valor-neg">+<?=number_format($x['pct'],1,',','.')?>%</td><td><a href="index.php?aba=equip&foco=acima-media" class="farol f-vermelho">ACIMA DA MÉDIA · ANALISAR</a></td></tr><?php endforeach;?></tbody></table></div><?php endif;?></section><?php endif;?>
<?php if($pode('suprimentos')&&$invCrit):?><section class="bloco"><div class="bloco-cab"><h2>Inventário crítico</h2><a href="index.php?aba=estinv&foco=critico">Ver inventário completo →</a></div><div class="tabela-rolagem"><table><thead><tr><th>TAG</th><th>Produto</th><th>Status</th><th>Ação</th></tr></thead><tbody><?php foreach(array_slice($invCrit,0,15) as $x):?><tr><td><b><?=h($x['tag']??'')?></b></td><td><?=h($x['produto']??'')?></td><td><span class="farol f-vermelho"><?=h($x['status']??'CRÍTICO')?></span></td><td><?=h($x['acao']??'ANALISAR')?></td></tr><?php endforeach;?></tbody></table></div></section><?php endif;?>
<?php if($pode('suprimentos')&&$remessasPrevistas):?><section class="bloco"><div class="bloco-cab"><h2>Remessas previstas</h2><a href="index.php?aba=estrem">Ver remessas →</a></div><div class="tabela-rolagem"><table><thead><tr><th>Previsão</th><th>Remessa</th><th>NF</th><th>Situação</th></tr></thead><tbody><?php foreach(array_slice($remessasPrevistas,0,15) as $x):?><tr><td><?=h(date('d/m/Y',strtotime($x['prevista'])))?></td><td><b><?=h($x['nome'])?></b></td><td><?=h($x['nf']?date('d/m/Y',strtotime($x['nf'])):'—')?></td><td><span class="farol f-amarelo">PREVISTA</span></td></tr><?php endforeach;?></tbody></table></div></section><?php endif;?>
<?php if($pode('gestao')&&$impactos):?><section class="bloco"><div class="bloco-cab"><h2>Impactos em aberto</h2><a href="index.php?aba=impactos&foco=aberto">Ver todos →</a></div><div class="tabela-rolagem"><table><thead><tr><th>Data</th><th>Serviço</th><th>Motivo</th><th>Tempo</th></tr></thead><tbody><?php foreach(array_slice($impactos,0,15) as $x):?><tr><td><?=h($x['data']??'')?></td><td><?=h($x['servico']??'')?></td><td><?=h($x['motivo']??'')?></td><td><?=h($x['tempo']??'')?></td></tr><?php endforeach;?></tbody></table></div></section><?php endif;?>
</main><script>document.getElementById('sidebarToggle').onclick=()=>document.getElementById('sidebar').classList.toggle('aberta');document.querySelectorAll('.sidebar-titulo').forEach(x=>x.onclick=()=>{x.classList.toggle('aberto');x.nextElementSibling?.classList.toggle('aberto')});</script></body></html>
