<?php
// Menu lateral (ou barra superior) padrão para as páginas PHP fora de index.php (Dashboard geral, SESMT GERAL...).
// Os botões das áreas levam a index.php?aba=...; quem chama pode inserir o seu bloco (item atual / grupo próprio) nos pontos marcados.

function menu_pagina_botao($aba, $txt, array $ocultos)
{
    if (in_array($aba, $ocultos['abas'] ?? [], true)) {
        return '';
    }
    return '<button type="button" onclick="location.href=\'index.php?aba=' . h($aba) . '\'">' . h($txt) . '</button>';
}

function menu_pagina_grupo($id, $icone, $titulo, $botoes)
{
    return '<div class="sidebar-grupo"><div class="sidebar-titulo aberto" data-grupo="' . $id . '"><span class="sidebar-icone">' . $icone . '</span>' . h($titulo)
        . '<span class="seta-grupo">‹</span></div><div class="sidebar-itens aberto" id="grp-' . $id . '">' . $botoes . '</div></div>';
}

/** $atual = HTML logo abaixo de "Tarefas" (ex.: o botão da página aberta); $sesmt = HTML do grupo SESMT GERAL, inserido antes de "Geral". */
function menu_paginas_html(array $eu, array $ocultos, $atual = '', $sesmt = '')
{
    $pode = function ($m) use ($eu) { return usuario_pode_modulo($eu, $m); };
    $b = function ($aba, $txt) use ($ocultos) { return menu_pagina_botao($aba, $txt, $ocultos); };
    $o = '<div class="sidebar-grupo sidebar-dashboard sidebar-tarefas"><div class="sidebar-itens aberto">' . $b('tarefas', 'Tarefas a fazer') . '</div></div>' . "\n";
    if ($atual !== '') {
        $o .= '<div class="sidebar-grupo sidebar-dashboard"><div class="sidebar-itens aberto">' . $atual . '</div></div>' . "\n";
    }
    if ($pode('producao')) {
        $o .= menu_pagina_grupo('producao', '☷', 'Produção', $b('painel', 'Painel') . $b('semana', 'Programação semanal') . $b('lanc', 'Lançamentos') . $b('apont', 'Apontar montagem') . $b('rdo', 'Relatório diário (RDO)') . $b('plan', 'Planejamento de montagem') . $b('avanco', 'Avanço físico') . $b('gantt', 'Cronograma (Gantt)') . $b('cliente', 'Dashboard cliente') . $b('tendencia', 'Tendências')) . "\n";
    }
    if ($pode('suprimentos')) {
        $o .= menu_pagina_grupo('suprimentos', '□', 'Suprimentos', $b('estmat', 'Materiais') . $b('estrem', 'Remessas') . $b('estcons', 'Consumo físico') . $b('estinv', 'Inventário') . $b('estcrit', 'Fixadores críticos') . $b('estsis', 'Baixa automática') . $b('estvinc', 'Vínculos') . $b('estpronto', 'Pronto para iniciar')) . "\n";
    }
    if ($pode('consumo')) {
        $o .= menu_pagina_grupo('consumo', '⚙', 'Consumo', $b('equip', 'Equipamentos')) . "\n";
    }
    if ($pode('financeiro')) {
        $o .= menu_pagina_grupo('financeiro', '$', 'Financeiro', $b('bm', 'Medição (BM)') . $b('proj', 'Projeção físico-financeira') . $b('cff', 'Cronograma físico-financeiro')) . "\n";
    }
    if ($pode('gestao')) {
        $o .= menu_pagina_grupo('gestao', '◆', 'Gestão', $b('metas', 'Metas') . $b('impactos', 'Impactos')) . "\n";
    }
    if ($pode('qualidade')) {
        $o .= menu_pagina_grupo('qualidade', '✓', 'Qualidade', $b('qualidade', 'Não conformidades')) . "\n";
    }
    $o .= $sesmt;
    $o .= '<div class="sidebar-grupo sidebar-geral"><div class="sidebar-titulo aberto" data-grupo="geral"><span class="sidebar-icone">☰</span>Geral<span class="seta-grupo">‹</span></div><div class="sidebar-itens aberto" id="grp-geral">' . $b('tutorial', 'Tutorial') . $b('config', 'Configurações') . '</div></div>' . "\n";
    return $o;
}

/** Script do menu: lateral (abre/fecha o grupo) ou barra superior (uma lista de cada vez) — o mesmo comportamento do sistema. */
function menu_paginas_script()
{
    return <<<'JS'
<script>
document.getElementById('sidebarToggle').onclick=()=>document.getElementById('sidebar').classList.toggle('aberta');
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
</script>
JS;
}
