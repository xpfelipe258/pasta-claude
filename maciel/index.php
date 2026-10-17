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
$html = str_replace('<html lang="pt-BR">', '<html lang="pt-BR"' . tema_attr() . '>', $html);
$html = str_replace('href="style.css"', 'href="style.css?v=' . @filemtime(__DIR__ . '/style.css') . '"', $html);
$html = str_replace('src="app.js"', 'src="app.js?v=' . @filemtime(__DIR__ . '/app.js') . '"', $html);
$html = str_replace('src="planos.js"', 'src="planos.js?v=' . @filemtime(__DIR__ . '/planos.js') . '"', $html);
$html = str_replace('src="planos_doc.js"', 'src="planos_doc.js?v=' . @filemtime(__DIR__ . '/planos_doc.js') . '"', $html);
$html = str_replace('src="rel_empresa.js"', 'src="rel_empresa.js?v=' . @filemtime(__DIR__ . '/rel_empresa.js') . '"', $html);
$html = str_replace('src="rel_lanc.js"', 'src="rel_lanc.js?v=' . @filemtime(__DIR__ . '/rel_lanc.js') . '"', $html);
$html = str_replace('src="bm_resumo.js"', 'src="bm_resumo.js?v=' . @filemtime(__DIR__ . '/bm_resumo.js') . '"', $html);
$html = str_replace('src="tabelas.js"', 'src="tabelas.js?v=' . @filemtime(__DIR__ . '/tabelas.js') . '"', $html);
$html = str_replace('src="projecao.js"', 'src="projecao.js?v=' . @filemtime(__DIR__ . '/projecao.js') . '"', $html);
$primaria = cor_segura($obra['cor_primaria'] ?? '', global_ler('cor_primaria', '#d97706'));
$secundaria = cor_segura($obra['cor_secundaria'] ?? '', global_ler('cor_secundaria', '#111827'));
$contexto = '<div class="obra-contexto"><a href="obras.php">← Todas as obras</a><span>' . h($obra['nome']) . '</span>' .
    ($u['perfil'] === 'admin' ? '<a href="admin.php">Administrar obra</a>' : '') . '</div>';
$html = str_replace('<body>', '<body style="--marca:' . h($primaria) . ';--marca2:' . h($secundaria) . '">' . $contexto, $html);
$html = str_replace('<title>Obra 198 · Gestão de Obras</title>', '<title>' . h($obra['nome']) . ' · Gestão de Obras</title>', $html);
$html = str_replace('<span class="marca-sigla">198</span>', !empty($obra['logo']) ? '<img class="marca-logo" src="' . h($obra['logo']) . '" alt="Logo">' : '<span class="marca-sigla">' . h(strtoupper(substr($obra['nome'], 0, 3))) . '</span>', $html);
$html = str_replace('<script src="chart.umd.js"></script>', "<script>window.API_BASE='api.php?r=';window.CSRF_TOKEN=" . json_encode(token_csrf()) . ";window.OBRA_ATUAL=" . json_encode(['id'=>(int)$obra['id'],'nome'=>$obra['nome']], JSON_UNESCAPED_UNICODE) . ";</script>\n<script src=\"chart.umd.js\"></script>", $html);
header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-store');
echo $html;

