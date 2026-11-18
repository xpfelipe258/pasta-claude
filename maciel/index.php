<?php
require __DIR__ . '/inc/nucleo.php';
$u = exigir_login_pagina();
$obra = exigir_obra_pagina();
$html = file_get_contents(__DIR__ . '/inc/painel.html');

// Aplica as permissões também no HTML inicial do menu.
// Assim um usuário limitado nunca recebe visualmente os grupos sem acesso,
// mesmo antes do app.js/API terminar de carregar ou se ocorrer erro de JavaScript.
$modsPermitidos = modulos_usuario($u);
foreach (modulos_sistema() as $moduloMenu) {
    if (!in_array($moduloMenu, $modsPermitidos, true)) {
        $padrao = '~<div class="sidebar-grupo">\s*(<div class="sidebar-titulo aberto" data-grupo="' . preg_quote($moduloMenu, '~') . '")~';
        $html = preg_replace($padrao, '<div class="sidebar-grupo" hidden>$1', $html, 1);
    }
}
// Abas ocultas pelo administrador para este usuário: o botão nem chega ao navegador, e a área sem nenhuma aba visível some.
$uiOcultos = ui_ocultos_usuario($u);
foreach ($uiOcultos['abas'] as $abaOculta) {
    $html = preg_replace('~<button data-aba="' . preg_quote($abaOculta, '~') . '"[^>]*>.*?</button>~s', '', $html, 1);
}
foreach (ui_catalogo() as $areaCat) {
    if (in_array($areaCat[0], ['tarefas'], true) || !$uiOcultos['abas']) {
        continue;
    }
    $todasOcultas = true;
    foreach ($areaCat[2] as $abaCat) {
        $todasOcultas = $todasOcultas && in_array($abaCat[0], $uiOcultos['abas'], true);
    }
    if ($todasOcultas) {
        $padrao = '~<div class="sidebar-grupo">\s*(<div class="sidebar-titulo aberto" data-grupo="' . preg_quote($areaCat[0], '~') . '")~';
        $html = preg_replace($padrao, '<div class="sidebar-grupo" hidden>$1', $html, 1);
    }
}
// Retorno fixo, independente das áreas ou abas liberadas para o usuário.
$html = str_replace('<nav class="sidebar-nav" id="abas">', '<nav class="sidebar-nav" id="abas"><div class="sidebar-grupo sidebar-dashboard"><div class="sidebar-itens aberto"><button type="button" onclick="location.href=\'obras.php?lista=1&amp;todas=1\'">← Central de obras</button></div></div>', $html);
$prefs = preferencias_usuario((int)$u['id']);
$html = str_replace('<html lang="pt-BR">', '<html lang="' . h($prefs['idioma']) . '"' . tema_attr() . menu_attr() . ($prefs['tam_texto'] !== 'normal' ? ' data-texto="' . h($prefs['tam_texto']) . '"' : '') . '>', $html);
$html = str_replace('<!--ICONES-->', icones_html(), $html);
$html = str_replace('src="datas_br.js"', 'src="datas_br.js?v=' . @filemtime(__DIR__ . '/datas_br.js') . '"', $html);
$html = str_replace('href="style.css"', 'href="style.css?v=' . @filemtime(__DIR__ . '/style.css') . '"', $html);
$html = str_replace('src="app.js"', 'src="app.js?v=' . @filemtime(__DIR__ . '/app.js') . '"', $html);
$html = str_replace('<script src="app.js', '<script src="consumo_ifc.js?v=' . @filemtime(__DIR__ . '/consumo_ifc.js') . '"></script><script src="app.js', $html);
$html = str_replace('src="planos.js"', 'src="planos.js?v=' . @filemtime(__DIR__ . '/planos.js') . '"', $html);
$html = str_replace('src="planos_doc.js"', 'src="planos_doc.js?v=' . @filemtime(__DIR__ . '/planos_doc.js') . '"', $html);
$html = str_replace('src="pdf_relatorio.js"', 'src="pdf_relatorio.js?v=' . @filemtime(__DIR__ . '/pdf_relatorio.js') . '"', $html);
$html = str_replace('src="template_doc.js"', 'src="template_doc.js?v=' . @filemtime(__DIR__ . '/template_doc.js') . '"', $html);
$html = str_replace('src="rel_empresa.js"', 'src="rel_empresa.js?v=' . @filemtime(__DIR__ . '/rel_empresa.js') . '"', $html);
$html = str_replace('src="sesmt_aba.js"', 'src="sesmt_aba.js?v=' . @filemtime(__DIR__ . '/sesmt_aba.js') . '"', $html);
$html = str_replace('src="qualidade.js"', 'src="qualidade.js?v=' . @filemtime(__DIR__ . '/qualidade.js') . '"', $html);
$html = str_replace('src="rdo.js"', 'src="rdo.js?v=' . @filemtime(__DIR__ . '/rdo.js') . '"', $html);
$html = str_replace('src="rel_suprimentos.js"', 'src="rel_suprimentos.js?v=' . @filemtime(__DIR__ . '/rel_suprimentos.js') . '"', $html);
$html = str_replace('src="rel_lanc.js"', 'src="rel_lanc.js?v=' . @filemtime(__DIR__ . '/rel_lanc.js') . '"', $html);
$html = str_replace('src="bm_resumo.js"', 'src="bm_resumo.js?v=' . @filemtime(__DIR__ . '/bm_resumo.js') . '"', $html);
$html = str_replace('src="mapa_obra.js"', 'src="mapa_obra.js?v=' . @filemtime(__DIR__ . '/mapa_obra.js') . '"', $html);
$html = str_replace('src="tabelas.js"', 'src="tabelas.js?v=' . @filemtime(__DIR__ . '/tabelas.js') . '"', $html);
$html = str_replace('src="tarefas.js"', 'src="tarefas.js?v=' . @filemtime(__DIR__ . '/tarefas.js') . '"', $html);
$html = str_replace('src="cff.js"', 'src="cff.js?v=' . @filemtime(__DIR__ . '/cff.js') . '"', $html);
$html = str_replace('src="cronograma_imp.js"', 'src="cronograma_imp.js?v=' . @filemtime(__DIR__ . '/cronograma_imp.js') . '"', $html);
$html = str_replace('src="contas_pagar.js"', 'src="contas_pagar.js?v=' . @filemtime(__DIR__ . '/contas_pagar.js') . '"', $html);
$html = str_replace('src="vinculos.js"', 'src="vinculos.js?v=' . @filemtime(__DIR__ . '/vinculos.js') . '"', $html);
$html = str_replace('src="toque.js"', 'src="toque.js?v=' . @filemtime(__DIR__ . '/toque.js') . '"', $html);
foreach (['i18n.js', 'config.js', 'tutorial.js', 'tarefas_redmine.js', 'modelo3d.js'] as $arqNovo) {
    $html = str_replace('src="' . $arqNovo . '"', 'src="' . $arqNovo . '?v=' . @filemtime(__DIR__ . '/' . $arqNovo) . '"', $html);
}
$html = str_replace('src="projecao.js"', 'src="projecao.js?v=' . @filemtime(__DIR__ . '/projecao.js') . '"', $html);
$primaria = cor_segura($obra['cor_primaria'] ?? '', global_ler('cor_primaria', '#d97706'));
$secundaria = cor_segura($obra['cor_secundaria'] ?? '', global_ler('cor_secundaria', '#111827'));
$oe = obra_empresa_info((int)$obra['id']);
$contexto = '<div class="obra-contexto">' . '<a href="obras.php?lista=1&amp;todas=1">← Central de obras</a>' . '<span>' . h($obra['nome']) . '</span>' .
    ($oe ? '<em class="obra-empresa-aviso" title="Esta obra é uma cópia só da ' . h($oe['empresa']) . '. O que você lança ou altera aqui não muda a obra principal.">Visão da empresa ' . h($oe['empresa']) . ' · dados independentes</em>' : '') .
    (usuario_admin_da_obra($u, (int)$obra['id']) ? '<a href="admin.php">Administrar obra</a>' : '') .
    '<button type="button" id="obraAtualizarSistema" class="btn" title="Carregar a versão mais recente do sistema">Atualizar</button>' .
    '<small id="obraAtualizarStatus" role="status" hidden></small></div>';
$html = str_replace('<body>', '<body style="--marca:' . h($primaria) . ';--marca2:' . h($secundaria) . '">' . $contexto, $html);
$html = str_replace('<title>Obra 198 · Gestão de Obras</title>', '<title>' . h($obra['nome']) . ' · Gestão de Obras</title>', $html);
$html = str_replace('<span class="marca-sigla">198</span>', !empty($obra['logo']) ? '<img class="marca-logo" src="' . h($obra['logo']) . '" alt="Logo">' : '<span class="marca-sigla">' . h(strtoupper(substr($obra['nome'], 0, 3))) . '</span>', $html);
$html = str_replace('<script src="chart.umd.js"></script>', "<script>window.API_BASE='api.php?r=';window.CSRF_TOKEN=" . json_encode(token_csrf()) . ";window.IDIOMA=" . json_encode($prefs['idioma']) . ";window.OBRA_ATUAL=" . json_encode(['id'=>(int)$obra['id'],'nome'=>$obra['nome']], JSON_UNESCAPED_UNICODE) . ";window.EMPRESA_USUARIO=" . json_encode(usuario_identidade_empresa($u), JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT) . ";window.EMPRESAS_RELATORIO=" . json_encode(identidade_contexto_relatorio($u), JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT) . ";window.UI_OCULTOS=" . json_encode($uiOcultos) . ";</script>\n<script src=\"chart.umd.js\"></script>", $html);
$atualizarObra = <<<'HTML'
<script>
(() => {
  const botao = document.getElementById('obraAtualizarSistema');
  const status = document.getElementById('obraAtualizarStatus');
  if (!botao || !status) return;
  const chaveRetorno = 'obra-atualizar-retorno:' + location.pathname + ':' + (window.OBRA_ATUAL?.id || '');
  const navegacao = secao => [...secao.querySelectorAll('button.ativa')].flatMap(el =>
    [...el.attributes].filter(a => a.name.startsWith('data-') && (/sub/.test(a.name) ||
        ['data-ap-modo', 'data-ap-etapa', 'data-ap-fase', 'data-ap-zoom', 'data-ap-emp'].includes(a.name)))
      .map(a => ({ atributo: a.name, valor: a.value }))
  );
  const urlAtual = new URL(location.href);
  try {
    const salvo = JSON.parse(sessionStorage.getItem(chaveRetorno) || 'null');
    if (salvo && salvo.token === urlAtual.searchParams.get('_atualizacao')) {
      sessionStorage.removeItem(chaveRetorno);
      const pendentes = salvo.subabas;
      const rolagens = salvo.rolagens || [];
      const restaurar = () => {
        const secao = document.getElementById('aba-' + salvo.aba);
        if (!secao || secao.hidden) return;
        while (pendentes.length) {
          const proxima = pendentes[0];
          const alvo = [...secao.querySelectorAll('button')].find(b =>
            b.getAttribute(proxima.atributo) === proxima.valor && b.getClientRects().length && !b.disabled
          );
          if (!alvo) return;
          pendentes.shift();
          if (!alvo.classList.contains('ativa')) alvo.click();
        }
        for (const pos of rolagens) {
          const el = document.getElementById(pos.id);
          if (el) { el.scrollTop = pos.top; el.scrollLeft = pos.left; }
        }
        window.scrollTo(salvo.scrollX || 0, salvo.scrollY || 0);
        observador.disconnect();
        clearTimeout(limiteRetorno);
      };
      const observador = new MutationObserver(restaurar);
      const limiteRetorno = setTimeout(() => observador.disconnect(), 15000);
      observador.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'class'] });
      restaurar();
    }
  } catch { /* a aba principal é restaurada pela URL, mesmo sem armazenamento */ }
  const informar = texto => {
    status.hidden = !texto;
    status.textContent = texto;
  };
  botao.addEventListener('click', async () => {
    if (botao.disabled) return;
    const destino = new URL(location.href);
    const controle = new AbortController();
    const limite = setTimeout(() => controle.abort(), 10000);
    botao.disabled = true;
    informar('Verificando conexão…');
    try {
      const resposta = await fetch(destino, { method: 'HEAD', cache: 'no-store', signal: controle.signal });
      if (!resposta.ok) throw new Error('Servidor indisponível');
      // A navegação da obra é interna e pode diferir da aba que consta na URL.
      const aba = typeof abaAtual === 'string' ? abaAtual
        : document.querySelector('main > section:not([hidden])[id^="aba-"]')?.id.slice(4);
      const token = Date.now().toString(36);
      destino.searchParams.set('_atualizacao', token);
      if (aba) {
        destino.searchParams.set('aba', aba);
        const secao = document.getElementById('aba-' + aba);
        try {
          sessionStorage.setItem(chaveRetorno, JSON.stringify({
            token, aba, subabas: secao ? navegacao(secao) : [],
            scrollX: window.scrollX, scrollY: window.scrollY,
            rolagens: secao ? [...secao.querySelectorAll('[id]')].filter(el => el.scrollLeft || el.scrollTop)
              .map(el => ({ id: el.id, top: el.scrollTop, left: el.scrollLeft })) : []
          }));
        } catch { /* a aba continua na URL */ }
      }
      informar('');
      location.replace(destino.href);
    } catch {
      informar('Não foi possível atualizar. Confira a conexão e tente novamente.');
    } finally {
      clearTimeout(limite);
      botao.disabled = false;
    }
  });
})();
</script>
HTML;
$html = str_replace('</body>', $atualizarObra . '</body>', $html);
header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-store');
echo $html;
