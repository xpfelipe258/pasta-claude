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
$prefs = preferencias_usuario((int)$u['id']);
$html = str_replace('<html lang="pt-BR">', '<html lang="' . h($prefs['idioma']) . '"' . tema_attr() . menu_attr() . ($prefs['tam_texto'] !== 'normal' ? ' data-texto="' . h($prefs['tam_texto']) . '"' : '') . '>', $html);
$html = str_replace('<!--ICONES-->', icones_html(), $html);
$html = str_replace('href="style.css"', 'href="style.css?v=' . @filemtime(__DIR__ . '/style.css') . '"', $html);
$html = str_replace('src="app.js"', 'src="app.js?v=' . @filemtime(__DIR__ . '/app.js') . '"', $html);
$html = str_replace('<script src="app.js', '<script src="consumo_ifc.js?v=' . @filemtime(__DIR__ . '/consumo_ifc.js') . '"></script><script src="app.js', $html);
$html = str_replace('src="planos.js"', 'src="planos.js?v=' . @filemtime(__DIR__ . '/planos.js') . '"', $html);
$html = str_replace('src="planos_doc.js"', 'src="planos_doc.js?v=' . @filemtime(__DIR__ . '/planos_doc.js') . '"', $html);
$html = str_replace('src="pdf_relatorio.js"', 'src="pdf_relatorio.js?v=' . @filemtime(__DIR__ . '/pdf_relatorio.js') . '"', $html);
$html = str_replace('src="template_doc.js"', 'src="template_doc.js?v=' . @filemtime(__DIR__ . '/template_doc.js') . '"', $html);
$html = str_replace('src="rel_empresa.js"', 'src="rel_empresa.js?v=' . @filemtime(__DIR__ . '/rel_empresa.js') . '"', $html);
$html = str_replace('src="rdo.js"', 'src="rdo.js?v=' . @filemtime(__DIR__ . '/rdo.js') . '"', $html);
$html = str_replace('src="rel_lanc.js"', 'src="rel_lanc.js?v=' . @filemtime(__DIR__ . '/rel_lanc.js') . '"', $html);
$html = str_replace('src="bm_resumo.js"', 'src="bm_resumo.js?v=' . @filemtime(__DIR__ . '/bm_resumo.js') . '"', $html);
$html = str_replace('src="mapa_obra.js"', 'src="mapa_obra.js?v=' . @filemtime(__DIR__ . '/mapa_obra.js') . '"', $html);
$html = str_replace('src="tabelas.js"', 'src="tabelas.js?v=' . @filemtime(__DIR__ . '/tabelas.js') . '"', $html);
$html = str_replace('src="tarefas.js"', 'src="tarefas.js?v=' . @filemtime(__DIR__ . '/tarefas.js') . '"', $html);
$html = str_replace('src="cff.js"', 'src="cff.js?v=' . @filemtime(__DIR__ . '/cff.js') . '"', $html);
$html = str_replace('src="vinculos.js"', 'src="vinculos.js?v=' . @filemtime(__DIR__ . '/vinculos.js') . '"', $html);
$html = str_replace('src="toque.js"', 'src="toque.js?v=' . @filemtime(__DIR__ . '/toque.js') . '"', $html);
foreach (['i18n.js', 'config.js', 'tutorial.js'] as $arqNovo) {
    $html = str_replace('src="' . $arqNovo . '"', 'src="' . $arqNovo . '?v=' . @filemtime(__DIR__ . '/' . $arqNovo) . '"', $html);
}
$html = str_replace('src="projecao.js"', 'src="projecao.js?v=' . @filemtime(__DIR__ . '/projecao.js') . '"', $html);
$primaria = cor_segura($obra['cor_primaria'] ?? '', global_ler('cor_primaria', '#d97706'));
$secundaria = cor_segura($obra['cor_secundaria'] ?? '', global_ler('cor_secundaria', '#111827'));
$oe = obra_empresa_info((int)$obra['id']);
$contexto = '<div class="obra-contexto">' . ($u['perfil'] === 'admin' || !$oe ? '<a href="obras.php?todas=1">← Todas as obras</a>' : '') . '<span>' . h($obra['nome']) . '</span>' .
    ($oe ? '<em class="obra-empresa-aviso" title="Esta obra é uma cópia só da ' . h($oe['empresa']) . '. O que você lança ou altera aqui não muda a obra principal.">Visão da empresa ' . h($oe['empresa']) . ' · dados independentes</em>' : '') .
    ($u['perfil'] === 'admin' ? '<a href="admin.php">Administrar obra</a>' : '') . '</div>';
$html = str_replace('<body>', '<body style="--marca:' . h($primaria) . ';--marca2:' . h($secundaria) . '">' . $contexto, $html);
$html = str_replace('<title>Obra 198 · Gestão de Obras</title>', '<title>' . h($obra['nome']) . ' · Gestão de Obras</title>', $html);
$html = str_replace('<span class="marca-sigla">198</span>', !empty($obra['logo']) ? '<img class="marca-logo" src="' . h($obra['logo']) . '" alt="Logo">' : '<span class="marca-sigla">' . h(strtoupper(substr($obra['nome'], 0, 3))) . '</span>', $html);
$html = str_replace('<script src="chart.umd.js"></script>', "<script>window.API_BASE='api.php?r=';window.CSRF_TOKEN=" . json_encode(token_csrf()) . ";window.IDIOMA=" . json_encode($prefs['idioma']) . ";window.OBRA_ATUAL=" . json_encode(['id'=>(int)$obra['id'],'nome'=>$obra['nome']], JSON_UNESCAPED_UNICODE) . ";window.UI_OCULTOS=" . json_encode($uiOcultos) . ";</script>\n<script src=\"chart.umd.js\"></script>", $html);
header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-store');
echo $html;

