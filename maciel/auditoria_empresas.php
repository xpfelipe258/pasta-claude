<?php
require __DIR__.'/inc/nucleo.php';
require __DIR__.'/inc/central.php';
require __DIR__.'/inc/auditoria_empresas.php';
$eu=exigir_admin();$achados=auditar_vinculos_empresas();
central_topo('Auditoria dos vínculos de empresas','sistema',$eu);
?>
<main class="ce-main"><section class="ce-hero"><div><span class="ce-eyebrow">AUDITORIA DE EMPRESAS</span><h1>Vínculos, pessoas e empresas</h1><p>Conferência dos cadastros atuais. Nenhum vínculo é criado ou corrigido automaticamente.</p></div><a class="btn" href="sistema.php?v=usuarios">Gerenciar usuários</a></section>
<section class="ce-card"><h2><?= count($achados) ?> ponto(s) para revisar</h2><p>O nome exibido vem da pessoa cadastrada e da empresa vinculada pelo ID. Usuários sem vínculo válido mantêm apenas os próprios lembretes; o administrador geral mantém a moderação. Corrija cada vínculo após confirmar a empresa e a pessoa corretas.</p>
<?php if(!$achados): ?><p>Nenhuma inconsistência encontrada nas verificações de usuários, empresas e responsáveis pelas obras.</p><?php else: ?>
<div style="overflow:auto"><table class="ce-tabela"><thead><tr><th>Ponto</th><th>Cadastro</th><th>Situação</th><th>Correção a confirmar</th><th></th></tr></thead><tbody>
<?php foreach($achados as $a): ?><tr><td><?= h($a['tipo']) ?></td><td><?= h($a['registro']) ?><small> · #<?= (int)$a['id'] ?></small></td><td><?= h($a['situacao']) ?></td><td><?= h($a['correcao']) ?></td><td><a class="btn" href="<?= h($a['link']) ?>">Revisar</a></td></tr><?php endforeach; ?>
</tbody></table></div><?php endif; ?></section>
<section class="ce-card"><h2>Parâmetros usados nas telas e relatórios</h2><p>Empresa e tipo: cadastro da empresa. Usuários e papéis: Painel administrativo › Usuários ou Usuários da empresa. Responsabilidade e executoras: cadastro da obra. Logo e cores: Configurações da empresa › Identidade visual.</p><p>As siglas dos catálogos, contratos e medições são mantidas para preservar cálculos e histórico; o relatório resolve sua apresentação pelos vínculos cadastrados da obra.</p></section></main></div></body></html>
