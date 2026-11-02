<?php
// Painel administrativo (só o administrador geral): visão da plataforma, empresas clientes, todas as obras, todos os usuários,
// configurações globais, modo de manutenção, auditoria e informações técnicas. A Central da empresa (cliente) não muda.
require __DIR__ . '/inc/nucleo.php';
require __DIR__ . '/inc/modelo.php';
require __DIR__ . '/inc/central.php';
require __DIR__ . '/inc/sistema_ctl.php';
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

$eu = exigir_admin();
$msg = ''; $erro = '';
$abas = ['visao' => 'Visão geral', 'empresas' => 'Empresas clientes', 'obras' => 'Obras', 'usuarios' => 'Usuários', 'config' => 'Configurações', 'auditoria' => 'Auditoria', 'sistema' => 'Sistema'];
$v = isset($_GET['v']) && isset($abas[$_GET['v']]) ? $_GET['v'] : 'visao';

// ---- exportação da auditoria (CSV) antes de qualquer saída
if ($v === 'auditoria' && isset($_GET['csv'])) {
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="auditoria_' . date('Ymd_His') . '.csv"');
    $o = fopen('php://output', 'w'); fwrite($o, "\xEF\xBB\xBF");
    fputcsv($o, ['Quando', 'Usuário', 'Ação', 'Detalhe'], ';');
    foreach (q_global('SELECT quando, usuario, acao, detalhe FROM auditoria_global ORDER BY id DESC LIMIT 5000')->fetchAll() as $l) { fputcsv($o, [$l['quando'], $l['usuario'], $l['acao'], $l['detalhe']], ';'); }
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    conferir_csrf();
    $acao = $_POST['acao'] ?? '';
    try {
        if ($acao === 'identidade') {
            $logo = !empty($_POST['remover_logo']) ? '' : imagem_upload_para_data_uri('logo_global', global_ler('logo', ''));
            global_gravar('nome_sistema', mb_substr(trim((string)($_POST['nome_sistema'] ?? '')), 0, 80) ?: 'Núcleo de Obras');
            global_gravar('cor_primaria', cor_segura($_POST['cor_primaria'] ?? '', '#d97706'));
            global_gravar('cor_secundaria', cor_segura($_POST['cor_secundaria'] ?? '', '#111827'));
            global_gravar('cor_fundo', cor_segura($_POST['cor_fundo'] ?? '', '#f4f6f8'));
            global_gravar('logo', $logo);
            registrar_global('identidade_atualizada');
            $msg = 'Identidade visual atualizada.';
        } elseif ($acao === 'planos_config') {
            planos_config_salvar($_POST);
            registrar_global('planos_config', planos_config());
            $msg = !empty($_POST['exigir_plano']) ? 'Regra salva: obras, usuários e áreas passam a respeitar o plano de cada empresa.' : 'Regra salva: o plano NÃO é exigido (nada é limitado).';
        } elseif ($acao === 'manutencao') {
            $c = manutencao_salvar(!empty($_POST['ativo']), $_POST['mensagem'] ?? '');
            registrar_global('manutencao', $c);
            $msg = $c['ativo'] ? 'Modo de manutenção LIGADO. Só administradores entram; os demais usuários são desconectados na próxima ação.' : 'Modo de manutenção desligado. Todos podem entrar de novo.';
        } elseif ($acao === 'usuario_ativo') {
            $alvo = q_global('SELECT * FROM usuarios WHERE id = ?', [(int)($_POST['uid'] ?? 0)])->fetch();
            if (!$alvo) { throw new InvalidArgumentException('Usuário não encontrado.'); }
            $novo = !empty($_POST['ativo']) ? 1 : 0;
            if (!$novo && ($m = sis_pode_desativar($alvo, $eu)) !== '') { throw new InvalidArgumentException($m); }
            q_global('UPDATE usuarios SET ativo = ? WHERE id = ?', [$novo, (int)$alvo['id']]);
            registrar_global($novo ? 'usuario_reativado' : 'usuario_desativado', ['usuario' => $alvo['login']]);
            $msg = 'Usuário “' . $alvo['login'] . '” ' . ($novo ? 'reativado.' : 'desativado: não entra mais.');
        } elseif ($acao === 'usuario_senha') {
            $alvo = q_global('SELECT * FROM usuarios WHERE id = ?', [(int)($_POST['uid'] ?? 0)])->fetch();
            if (!$alvo) { throw new InvalidArgumentException('Usuário não encontrado.'); }
            if (!enviar_link_redefinicao($alvo)) { throw new InvalidArgumentException('Não foi possível enviar: o usuário não tem e-mail válido cadastrado (ou o envio falhou).'); }
            registrar_global('senha_link_enviado', ['usuario' => $alvo['login']]);
            $msg = 'Link de redefinição enviado para o e-mail de ' . $alvo['login'] . '.';
        } elseif ($acao === 'obra_status') {
            $id = (int)($_POST['obra_id'] ?? 0);
            $o = q_global('SELECT * FROM obras WHERE id = ?', [$id])->fetch();
            if (!$o) { throw new InvalidArgumentException('Obra não encontrada.'); }
            if ($o['status'] === 'rascunho') { throw new InvalidArgumentException('Esta obra ainda está em importação (rascunho).'); }
            $st = ($_POST['status'] ?? '') === 'arquivada' ? 'arquivada' : 'ativa';
            q_global('UPDATE obras SET status = ? WHERE id = ?', [$st, $id]);
            registrar_global('obra_status', ['obra_id' => $id, 'status' => $st]);
            $msg = 'Obra “' . $o['nome'] . '” ' . ($st === 'arquivada' ? 'arquivada.' : 'reativada.');
        }
    } catch (Throwable $e) {
        $erro = $e instanceof InvalidArgumentException ? $e->getMessage() : 'Não foi possível concluir a operação.';
    }
}

$csrf = token_csrf();
central_topo('Painel administrativo', 'sistema', $eu, 'Painel administrativo · administrador geral');
echo '<main class="ce-main"><section class="ce-hero"><div><span class="ce-eyebrow">ADMINISTRADOR GERAL</span><h1>Painel administrativo</h1><p>Vendas e administração geral da plataforma: empresas clientes, planos e pagamentos, todas as obras e usuários, regras, manutenção e auditoria. O que o cliente vê na Central dele não muda — e o seu Painel comercial (orçamentos e propostas) é o mesmo dos clientes.</p></div><span style="display:flex;gap:10px;flex-wrap:wrap"><a class="btn primario" href="admin_planos.php">Vendas: planos, empresas e pagamentos →</a><a class="btn" href="comercial.php">Painel comercial →</a></span></section>';
echo '<nav class="ce-sub">';
foreach ($abas as $k => $t) { echo '<a href="sistema.php?v=' . $k . '"' . ($k === $v ? ' class="on"' : '') . '>' . h($t) . '</a>'; }
echo '</nav>';
if ($msg) { echo '<div class="toast ok-faixa">' . h($msg) . '</div>'; }
if ($erro) { echo '<div class="toast erro-form">' . h($erro) . '</div>'; }
$form = function ($acao, array $campos, $rotulo, $cls = 'btn', $confirma = '') use ($csrf) {
    $s = '<form method="post" style="display:inline"' . ($confirma ? ' onsubmit="return confirm(\'' . h(addslashes($confirma)) . '\')"' : '') . '><input type="hidden" name="csrf" value="' . h($csrf) . '"><input type="hidden" name="acao" value="' . h($acao) . '">';
    foreach ($campos as $k => $val) { $s .= '<input type="hidden" name="' . h($k) . '" value="' . h($val) . '">'; }
    return $s . '<button class="' . h($cls) . ' ce-btn-peq">' . h($rotulo) . '</button></form>';
};
$nivel = ['verm' => ['#fee4e2', '#b42318'], 'amar' => ['#fef0c7', '#93370d'], 'info' => ['#e0eaff', '#1d3a8a']];

// ============================================================ VISÃO GERAL
if ($v === 'visao') {
    $r = sis_resumo(); $ind = $r['ind'];
    $ult = q_global('SELECT quando, usuario, acao FROM auditoria_global ORDER BY id DESC LIMIT 8')->fetchAll();
    ?>
  <section class="ce-grid">
    <div class="ce-num"><small>Empresas clientes</small><b><?= (int)$ind['empresas'] ?></b><span><?= (int)$ind['assinantes'] ?> assinante(s) · <?= (int)$ind['teste'] ?> em teste</span></div>
    <div class="ce-num verde"><small>Receita mensal recorrente</small><b><?= h(central_rs($ind['mrr'])) ?></b><span>anual: <?= h(central_rs($ind['arr'])) ?></span></div>
    <div class="ce-num"><small>Recebido no mês</small><b><?= h(central_rs($ind['recebido_mes'])) ?></b><span>pagamentos registrados</span></div>
    <div class="ce-num <?= $ind['inadimplentes'] ? 'verm' : '' ?>"><small>Inadimplentes</small><b><?= (int)$ind['inadimplentes'] ?></b><span><?= (int)$ind['a_vencer'] ?> vencem em até 7 dias</span></div>
    <div class="ce-num"><small>Obras</small><b><?= (int)$r['obras']['ativa'] ?></b><span><?= (int)$r['obras']['arquivada'] ?> arquivada(s) · <?= (int)$r['obras']['rascunho'] ?> em importação</span></div>
    <div class="ce-num"><small>Usuários ativos</small><b><?= (int)$r['usuarios']['ativos'] ?></b><span><?= (int)$r['usuarios']['admin'] ?> administrador(es) · <?= (int)$r['usuarios']['org'] ?> de empresas</span></div>
    <div class="ce-num"><small>Orçamentos (comercial)</small><b><?= (int)$r['orcamentos']['qtd'] ?></b><span><?= (int)$r['orcamentos']['aprovados'] ?> aprovado(s)</span></div>
  </section>
  <section class="ce-bloco"><h2>Pontos de atenção</h2><p>O que merece a sua decisão agora.</p>
  <?php if (!$r['alertas']): ?><div class="ce-vazio">Nada pendente. Tudo em dia.</div><?php else: foreach ($r['alertas'] as $a): ?>
    <div style="display:flex;gap:10px;align-items:center;justify-content:space-between;padding:10px 14px;margin-bottom:8px;border-radius:10px;background:<?= $nivel[$a['nivel']][0] ?>;color:<?= $nivel[$a['nivel']][1] ?>"><span><?= h($a['txt']) ?></span><a href="<?= h($a['link']) ?>" style="color:inherit;font-weight:700;white-space:nowrap">Ver →</a></div>
  <?php endforeach; endif; ?></section>
  <section class="ce-bloco"><h2>Atalhos</h2><p>Funções já existentes, organizadas num lugar só.</p>
    <div class="ce-acoes" style="margin-top:0"><a class="btn" href="admin_planos.php">Planos, empresas e pagamentos</a><a class="btn" href="admin.php">Administração da obra aberta</a><a class="btn" href="obras.php?lista=1">Central de obras</a><a class="btn" href="dashboard_obras.php">Painel financeiro</a><a class="btn" href="comercial.php">Orçamentos</a></div></section>
  <section class="ce-bloco"><h2>Últimas ações</h2>
    <table class="ce-tab"><thead><tr><th>Quando</th><th>Usuário</th><th>Ação</th></tr></thead><tbody>
    <?php foreach ($ult as $l): ?><tr><td><?= h(date('d/m/Y H:i', strtotime($l['quando']))) ?></td><td><?= h($l['usuario'] ?: '—') ?></td><td><?= h($l['acao']) ?></td></tr><?php endforeach; ?></tbody></table>
    <p style="margin:10px 0 0"><a href="sistema.php?v=auditoria">Ver a auditoria completa →</a></p></section>
    <?php
}

// ============================================================ EMPRESAS CLIENTES
if ($v === 'empresas') {
    $cfg = planos_config(); $lista = [];
    foreach (q_global('SELECT id FROM organizacoes ORDER BY nome')->fetchAll(PDO::FETCH_COLUMN) as $oid) {
        $o = organizacao_ler($oid); $s = organizacao_situacao($o, $cfg);
        $lista[] = ['o' => $o, 's' => $s, 'ob' => organizacao_obras_em_uso($oid), 'lo' => organizacao_limite_obras($o), 'us' => organizacao_usuarios_em_uso($oid), 'lu' => organizacao_limite_usuarios($o)];
    }
    $cl = ['verde' => 'verde', 'azul' => 'azul', 'amarelo' => 'amarelo', 'vermelho' => 'verm', 'cinza' => ''];
    $lim = function ($u, $l) { return (int)$u . ' de ' . ($l > 0 ? (int)$l : '∞'); };
    ?>
  <section class="ce-bloco"><h2>Empresas clientes</h2><p>Quem está pagando, até quando e quanto já usa do plano. Para criar empresa, mudar plano ou registrar pagamento, abra “Planos, empresas e pagamentos”.</p>
    <div class="ce-acoes" style="margin:0 0 14px"><a class="btn primario" href="admin_planos.php">Gerenciar planos, empresas e pagamentos →</a></div>
  <?php if (!$lista): ?><div class="ce-vazio">Nenhuma empresa cadastrada ainda.</div><?php else: ?>
    <table class="ce-tab"><thead><tr><th>Empresa</th><th>Plano</th><th>Situação</th><th>Vencimento</th><th class="d">Obras</th><th class="d">Usuários</th><th class="d">Valor</th><th></th></tr></thead><tbody>
    <?php foreach ($lista as $x): $o = $x['o']; ?>
      <tr><td><b><?= h($o['nome']) ?></b><br><small style="color:#667085"><?= h($o['contato'] ?? '') ?></small></td><td><?= h($o['plano_nome'] ?: '—') ?></td>
        <td><span class="ce-tag <?= $cl[$x['s']['cls']] ?? '' ?>"><?= h($x['s']['rotulo']) ?></span></td><td><?= h(central_dt($o['vencimento'] ?? null)) ?></td>
        <td class="d"><?= h($lim($x['ob'], $x['lo'])) ?></td><td class="d"><?= h($lim($x['us'], $x['lu'])) ?></td><td class="d"><?= h(central_rs($o['preco'] ?? 0)) ?> / <?= h(strtolower($o['ciclo'] ?? 'mensal') === 'anual' ? 'ano' : 'mês') ?></td>
        <td class="d"><a class="btn ce-btn-peq" href="empresa_usuarios.php?org=<?= (int)$o['id'] ?>">Usuários</a></td></tr>
    <?php endforeach; ?></tbody></table>
  <?php endif; ?></section>
    <?php
}

// ============================================================ OBRAS
if ($v === 'obras') {
    $orgs = []; foreach (q_global('SELECT id, nome FROM organizacoes')->fetchAll() as $o) { $orgs[(int)$o['id']] = $o['nome']; }
    $criadores = [];
    foreach (q_global('SELECT uo.obra_id, u.nome FROM usuarios_obras uo JOIN usuarios u ON u.id = uo.usuario_id WHERE uo.admin_obra = 1 ORDER BY uo.obra_id')->fetchAll() as $c) { $criadores[(int)$c['obra_id']][] = $c['nome']; }
    $obrasL = q_global('SELECT * FROM obras ORDER BY (status = \'ativa\') DESC, id DESC')->fetchAll();
    $stCls = ['ativa' => 'verde', 'arquivada' => '', 'rascunho' => 'amarelo'];
    ?>
  <section class="ce-bloco"><h2>Todas as obras da plataforma (<?= count($obrasL) ?>)</h2><p>Inclui obras de todas as empresas, arquivadas, em importação e as cópias “obra da empresa”. Como administrador geral, você abre qualquer uma.</p>
    <table class="ce-tab"><thead><tr><th>Obra</th><th>Empresa dona</th><th>Administrador(es)</th><th>Situação</th><th class="d">Contrato</th><th class="d">Dados em disco</th><th>Criada</th><th></th></tr></thead><tbody>
    <?php foreach ($obrasL as $o): $oid = (int)$o['id']; $copia = trim((string)($o['empresa_vinculada'] ?? '')) !== ''; ?>
      <tr><td><b><?= h($o['nome']) ?></b><?= $copia ? '<br><small style="color:#667085">cópia da obra da empresa ' . h($o['empresa_vinculada']) . '</small>' : '' ?></td>
        <td><?= h($orgs[(int)($o['organizacao_id'] ?? 0)] ?? '—') ?></td><td><?= h(implode(', ', $criadores[$oid] ?? []) ?: '—') ?></td>
        <td><span class="ce-tag <?= $stCls[$o['status']] ?? '' ?>"><?= h($o['status']) ?></span></td><td class="d"><?= $o['valor_contrato'] ? h(central_rs($o['valor_contrato'])) : '—' ?></td>
        <td class="d"><?= h(sis_bytes(sis_tamanho_pasta(sis_pasta_dados() . '/' . $oid))) ?></td><td><?= h(central_dt(substr((string)$o['criado_em'], 0, 10))) ?></td>
        <td class="d" style="white-space:nowrap">
          <?php if ($o['status'] === 'ativa'): ?>
            <form method="post" action="obras.php" style="display:inline"><input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="acao" value="abrir"><input type="hidden" name="obra_id" value="<?= $oid ?>"><button class="btn ce-btn-peq">Abrir</button></form>
            <?= $form('obra_status', ['obra_id' => $oid, 'status' => 'arquivada'], 'Arquivar', 'btn ghost', 'Arquivar esta obra? Ela some da lista dos usuários (nada é apagado).') ?>
          <?php elseif ($o['status'] === 'arquivada'): ?><?= $form('obra_status', ['obra_id' => $oid, 'status' => 'ativa'], 'Reativar') ?><?php endif; ?></td></tr>
    <?php endforeach; ?></tbody></table>
    <p class="ce-nota" style="margin-top:12px">Excluir obra definitivamente continua em Central de obras › Editar obras (pede o nome da obra para confirmar).</p></section>
    <?php
}

// ============================================================ USUÁRIOS
if ($v === 'usuarios') {
    $orgs = []; foreach (q_global('SELECT id, nome FROM organizacoes')->fetchAll() as $o) { $orgs[(int)$o['id']] = $o['nome']; }
    $ac = sis_ultimos_acessos();
    $us = q_global('SELECT * FROM usuarios ORDER BY ativo DESC, (perfil = \'admin\') DESC, nome')->fetchAll();
    $perfis = ['admin' => 'Administrador', 'editor' => 'Editor', 'leitura' => 'Leitura'];
    ?>
  <section class="ce-bloco"><h2>Todos os usuários (<?= count($us) ?>)</h2><p>De todas as empresas e obras. Aqui você ativa/desativa acessos e envia o link de nova senha. Perfis, áreas e abas de cada usuário continuam em Administração › Usuários (dentro de uma obra) e, para as empresas, em “Usuários” de cada empresa.</p>
    <table class="ce-tab"><thead><tr><th>Nome</th><th>Login</th><th>Perfil</th><th>Empresa</th><th>E-mail</th><th>Último acesso</th><th>Situação</th><th></th></tr></thead><tbody>
    <?php foreach ($us as $u): $a = $ac[$u['login']] ?? null; ?>
      <tr><td><b><?= h($u['nome']) ?></b></td><td><?= h($u['login']) ?></td><td><span class="ce-tag <?= $u['perfil'] === 'admin' ? 'azul' : '' ?>"><?= h($perfis[$u['perfil']] ?? $u['perfil']) ?></span><?= !empty($u['admin_organizacao']) ? ' <span class="ce-tag verde">adm. da empresa</span>' : '' ?></td>
        <td><?= h($orgs[(int)($u['organizacao_id'] ?? 0)] ?? ($u['empresa'] ?: '—')) ?></td><td><?= h($u['email'] ?: '—') ?></td><td><?= $a ? h(date('d/m/Y H:i', strtotime($a))) : '—' ?></td>
        <td><span class="ce-tag <?= $u['ativo'] ? 'verde' : 'verm' ?>"><?= $u['ativo'] ? 'ativo' : 'desativado' ?></span></td>
        <td class="d" style="white-space:nowrap">
          <?= $u['ativo'] ? $form('usuario_ativo', ['uid' => $u['id'], 'ativo' => 0], 'Desativar', 'btn ghost', 'Desativar ' . $u['login'] . '? Ele não entra mais até ser reativado.') : $form('usuario_ativo', ['uid' => $u['id'], 'ativo' => 1], 'Reativar') ?>
          <?= $u['ativo'] && trim((string)$u['email']) !== '' ? $form('usuario_senha', ['uid' => $u['id']], 'Enviar link de senha', 'btn ghost', 'Enviar o link de redefinição de senha para o e-mail de ' . $u['login'] . '?') : '' ?></td></tr>
    <?php endforeach; ?></tbody></table></section>
    <?php
}

// ============================================================ CONFIGURAÇÕES
if ($v === 'config') {
    $pc = planos_config(); $mt = manutencao_info();
    ?>
  <section class="ce-bloco"><h2>Modo de manutenção</h2><p>Ligue antes de publicar uma atualização grande ou mexer no banco. Enquanto estiver ligado, <b>só administradores entram</b>; os demais veem a mensagem abaixo na tela de login e são desconectados na próxima ação. Você nunca perde o acesso.</p>
    <form method="post" class="ce-form"><input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="acao" value="manutencao">
      <label class="full" style="flex-direction:row;align-items:center;gap:10px"><input type="checkbox" name="ativo" value="1" <?= $mt['ativo'] ? 'checked' : '' ?>> Manutenção ligada<?= $mt['ativo'] && $mt['desde'] ? ' (desde ' . h(date('d/m/Y H:i', strtotime($mt['desde']))) . ')' : '' ?></label>
      <label class="full">Mensagem para os usuários<input name="mensagem" maxlength="300" value="<?= h($mt['mensagem']) ?>" placeholder="Ex.: Estamos atualizando o sistema. Voltamos em alguns minutos."></label>
      <div class="full"><button class="btn primario">Salvar</button></div></form></section>
  <section class="ce-bloco"><h2>Regras de plano e assinatura</h2><p>Valem para todas as empresas clientes. Com “Exigir plano” desligado, nada é limitado (comportamento de sempre).</p>
    <form method="post" class="ce-form"><input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="acao" value="planos_config">
      <label class="full" style="flex-direction:row;align-items:center;gap:10px"><input type="checkbox" name="exigir_plano" value="1" <?= $pc['exigir_plano'] ? 'checked' : '' ?>> Exigir plano para criar obras e usuários e limitar as áreas</label>
      <label>Obras de quem não tem empresa<input name="limite_sem_plano" inputmode="numeric" value="<?= (int)$pc['limite_sem_plano'] ?>"></label>
      <label>Tolerância após o vencimento (dias)<input name="tolerancia_dias" inputmode="numeric" value="<?= (int)$pc['tolerancia_dias'] ?>"></label>
      <label>Dias de teste de empresa nova<input name="dias_teste" inputmode="numeric" value="<?= (int)$pc['dias_teste'] ?>"></label>
      <div class="full"><button class="btn primario">Salvar regras</button></div></form></section>
  <section class="ce-bloco"><h2>Identidade visual do sistema</h2><p>Nome, cores e logo do portal (login, Central de obras e telas gerais).</p>
    <form method="post" enctype="multipart/form-data" class="ce-form"><input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="acao" value="identidade">
      <label class="full">Nome do sistema<input name="nome_sistema" maxlength="80" value="<?= h(global_ler('nome_sistema', 'Núcleo de Obras')) ?>"></label>
      <label>Cor principal<input type="color" name="cor_primaria" value="<?= h(cor_segura(global_ler('cor_primaria', '#d97706'), '#d97706')) ?>"></label>
      <label>Cor secundária<input type="color" name="cor_secundaria" value="<?= h(cor_segura(global_ler('cor_secundaria', '#111827'), '#111827')) ?>"></label>
      <label>Cor de fundo<input type="color" name="cor_fundo" value="<?= h(cor_segura(global_ler('cor_fundo', '#f4f6f8'), '#f4f6f8')) ?>"></label>
      <label>Logo (até 2 MB)<input type="file" name="logo_global" accept="image/*"></label>
      <label style="flex-direction:row;align-items:center;gap:8px"><input type="checkbox" name="remover_logo" value="1"> Remover o logo atual</label>
      <div class="full"><button class="btn primario">Salvar identidade</button></div></form></section>
    <?php
}

// ============================================================ AUDITORIA
if ($v === 'auditoria') {
    $fu = trim((string)($_GET['u'] ?? '')); $fa = trim((string)($_GET['a'] ?? ''));
    $w = []; $p = [];
    if ($fu !== '') { $w[] = 'usuario = ?'; $p[] = $fu; }
    if ($fa !== '') { $w[] = 'acao LIKE ?'; $p[] = '%' . $fa . '%'; }
    $linhas = q_global('SELECT quando, usuario, acao, detalhe FROM auditoria_global' . ($w ? ' WHERE ' . implode(' AND ', $w) : '') . ' ORDER BY id DESC LIMIT 200', $p)->fetchAll();
    $logins = q_global('SELECT DISTINCT usuario FROM auditoria_global WHERE usuario IS NOT NULL ORDER BY usuario')->fetchAll(PDO::FETCH_COLUMN);
    ?>
  <section class="ce-bloco"><h2>Auditoria da plataforma</h2><p>Logins, criação e exclusão de obras, mudanças de plano, usuários e configurações. Mostra as 200 mais recentes do filtro; o CSV traz até 5.000.</p>
    <form method="get" class="ce-mes" style="margin-bottom:14px"><input type="hidden" name="v" value="auditoria">
      <label>Usuário<select name="u"><option value="">Todos</option><?php foreach ($logins as $l): ?><option <?= $l === $fu ? 'selected' : '' ?>><?= h($l) ?></option><?php endforeach; ?></select></label>
      <label>Ação contém<input name="a" value="<?= h($fa) ?>" placeholder="login, obra, plano…"></label><button class="btn">Filtrar</button><a class="btn" href="sistema.php?v=auditoria&csv=1">Baixar CSV</a></form>
    <table class="ce-tab"><thead><tr><th>Quando</th><th>Usuário</th><th>Ação</th><th>Detalhe</th></tr></thead><tbody>
    <?php foreach ($linhas as $l): ?><tr><td style="white-space:nowrap"><?= h(date('d/m/Y H:i', strtotime($l['quando']))) ?></td><td><?= h($l['usuario'] ?: '—') ?></td><td><?= h($l['acao']) ?></td><td style="color:#667085;font-size:.82rem"><?= h(mb_substr((string)$l['detalhe'], 0, 140)) ?></td></tr><?php endforeach; ?>
    <?php if (!$linhas): ?><tr><td colspan="4" class="ce-vazio">Nada encontrado.</td></tr><?php endif; ?></tbody></table></section>
    <?php
}

// ============================================================ SISTEMA (informações técnicas)
if ($v === 'sistema') {
    $cfg = config(); $dados = sis_pasta_dados();
    $esq = (string)q_global("SELECT valor FROM sistema WHERE chave = 'esquema'")->fetchColumn();
    $info = [
        'Versão do código (commit publicado)' => (string)sistema_ler('versao_codigo', '—'),
        'Esquema do banco' => ($esq !== '' ? $esq : '—') . ' (código espera ' . ESQUEMA_VERSAO . ')',
        'Banco de dados' => ($cfg['driver'] ?? 'mysql') === 'sqlite' ? 'SQLite (teste local)' : 'MySQL — ' . ($cfg['banco'] ?? ''),
        'PHP' => PHP_VERSION, 'Servidor' => $_SERVER['SERVER_SOFTWARE'] ?? '—',
        'Fuso horário do sistema' => date_default_timezone_get(),
        'Dados das obras em disco (IFC, fotos, documentos)' => sis_bytes(sis_tamanho_pasta($dados)),
        'Repositório do código' => ($cfg['github_repositorio'] ?? '—') . ' · ramo ' . ($cfg['github_ramo'] ?? '—'),
        'Token do GitHub' => empty($cfg['github_token']) ? 'não configurado' : 'configurado',
        'Endereço do sistema' => url_base_sistema(),
    ];
    $esqOk = $esq === (string)ESQUEMA_VERSAO;
    ?>
  <section class="ce-bloco"><h2>Informações técnicas</h2><p>Para suporte e conferência após publicar uma atualização.</p>
    <table class="ce-tab"><tbody><?php foreach ($info as $k => $val): ?><tr><td style="width:38%;color:#667085"><?= h($k) ?></td><td><b><?= h($val) ?></b></td></tr><?php endforeach; ?></tbody></table>
    <?php if (!$esqOk): ?><p style="margin-top:12px;color:#93370d">O esquema do banco ainda não está na versão do código. Ele é atualizado sozinho no próximo acesso a uma obra.</p><?php endif; ?></section>
  <section class="ce-bloco"><h2>Ferramentas de manutenção</h2><p>Estas continuam na Administração (dentro de uma obra): atualização do sistema pelo GitHub, sincronização Hostinger → GitHub, token de máquina da API, importação de planilhas e histórico da obra.</p>
    <div class="ce-acoes" style="margin-top:0"><a class="btn" href="admin.php">Abrir Administração</a><a class="btn" href="sistema.php?v=config">Modo de manutenção</a></div></section>
    <?php
}
echo '</main></div></body></html>';
