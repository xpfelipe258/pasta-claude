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
$html = str_replace('href="style.css"', 'href="style.css?v=20261005relatorio1"', $html);
$html = str_replace('src="app.js"', 'src="app.js?v=' . @filemtime(__DIR__ . '/app.js') . '"', $html);
$primaria = cor_segura($obra['cor_primaria'] ?? '', global_ler('cor_primaria', '#d97706'));
$secundaria = cor_segura($obra['cor_secundaria'] ?? '', global_ler('cor_secundaria', '#111827'));
$contexto = '<div class="obra-contexto"><a href="obras.php">← Todas as obras</a><span>' . h($obra['nome']) . '</span>' .
    ($u['perfil'] === 'admin' ? '<a href="admin.php">Administrar obra</a>' : '') . '</div>';
$html = str_replace('<body>', '<body style="--marca:' . h($primaria) . ';--marca2:' . h($secundaria) . '">' . $contexto, $html);
$html = str_replace('<title>Obra 198 · Controle de Produção</title>', '<title>' . h($obra['nome']) . ' · Controle de Produção</title>', $html);
$html = str_replace('<span class="marca-sigla">198</span>', !empty($obra['logo']) ? '<img class="marca-logo" src="' . h($obra['logo']) . '" alt="Logo">' : '<span class="marca-sigla">' . h(strtoupper(substr($obra['nome'], 0, 3))) . '</span>', $html);
$html = str_replace('<script src="chart.umd.js"></script>', "<script>window.API_BASE='api.php?r=';window.CSRF_TOKEN=" . json_encode(token_csrf()) . ";window.OBRA_ATUAL=" . json_encode(['id'=>(int)$obra['id'],'nome'=>$obra['nome']], JSON_UNESCAPED_UNICODE) . ";</script>\n<script src=\"chart.umd.js\"></script>", $html);
header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-store');
echo $html;

