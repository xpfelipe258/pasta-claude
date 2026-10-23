<?php
require __DIR__ . '/inc/nucleo.php';
require __DIR__ . '/inc/importacao.php';
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');

$eu = exigir_login_pagina();
$admin = $eu['perfil'] === 'admin';
garantir_obras_detalhes(bd(), config()['driver']);   // instalações que ainda não rodaram a migração do esquema 16
garantir_importacao();   // tabela de documentos e coluna de fase da importação
$msg = '';
$erro = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    conferir_csrf();
    $acao = $_POST['acao'] ?? '';
    try {
        if ($acao === 'abrir') {
            $id = (int)($_POST['obra_id'] ?? 0);
            $obra = q_global("SELECT * FROM obras WHERE id = ? AND status = 'ativa'", [$id])->fetch();
            if (!$obra || !usuario_pode_obra($eu, $id)) {
                throw new InvalidArgumentException('Obra indisponível para este usuário.');
            }
            definir_obra_atual($id);
            registrar_global('obra_aberta', ['obra_id' => $id]);
            header('Location: index.php');
            exit;
        }
        if (!$admin) { throw new InvalidArgumentException('Apenas administradores podem alterar o portfólio.'); }

        if ($acao === 'criar_obra' || $acao === 'criar_obra_importacao') {
            $comImportacao = $acao === 'criar_obra_importacao';   // obra nova com importação automática: nasce em rascunho até os documentos serem enviados
            $d = dados_obra_do_post();
            $nome = $d['nome'];
            $ini = $d['data_inicio'] ?: date('Y-m-d');
            $fim = $d['data_fim'] ?: date('Y-m-d', strtotime('+1 year'));
            $logo = imagem_upload_para_data_uri('logo_obra');
            $cols = ['nome', 'responsavel', 'codigo', 'cliente', 'responsavel_cliente', 'cidade', 'endereco', 'encarregado', 'valor_contrato', 'contrato_numero', 'duracao_meses', 'art', 'area_m2', 'telefone', 'email', 'observacoes'];
            $vals = array_map(function ($c) use ($d) { return $d[$c]; }, $cols);
            q_global('INSERT INTO obras (' . implode(',', $cols) . ", data_inicio, data_fim, status, importacao, cor_primaria, cor_secundaria, logo, criado_em) VALUES (" . implode(',', array_fill(0, count($cols), '?')) . ", ?, ?, ?, ?, ?, ?, ?, ?)",
                array_merge($vals, [$ini, $fim, $comImportacao ? 'rascunho' : 'ativa', $comImportacao ? 'rascunho' : null, cor_segura($_POST['cor_primaria'] ?? '', '#d97706'), cor_segura($_POST['cor_secundaria'] ?? '', '#111827'), $logo, agora()]));
            $id = (int)bd()->lastInsertId();
            foreach (['obra_nome' => $nome, 'data_inicio' => $ini, 'data_fim' => $fim, 'versao' => '0', 'modificado' => date('c'), 'dados_legados' => '0'] as $k => $v) {
                q_global('INSERT INTO obra_config (obra_id, chave, valor) VALUES (?, ?, ?)', [$id, $k, $v]);
            }
            q_global('INSERT INTO usuarios_obras (usuario_id, obra_id) VALUES (?, ?)', [(int)$eu['id'], $id]);
            if ($comImportacao) {
                registrar_global('obra_criada_rascunho', ['obra_id' => $id, 'nome' => $nome]);
                header('Location: obra_importar.php?obra=' . $id);
                exit;
            }
            if (!empty($_POST['copiar_estrutura']) && obra_atual_id() > 0) {
                copiar_estrutura_obra(obra_atual_id(), $id);
            }
            registrar_global('obra_criada', ['obra_id' => $id, 'nome' => $nome]);
            $msg = 'Obra criada. Ela começa sem produção, estoque, medições ou apontamentos.';
        } elseif ($acao === 'editar_obra') {
            $id = (int)($_POST['obra_id'] ?? 0);
            $atual = q_global('SELECT * FROM obras WHERE id = ?', [$id])->fetch();
            if (!$atual) { throw new InvalidArgumentException('Obra não encontrada.'); }
            $d = dados_obra_do_post();
            $nome = $d['nome'];
            $logo = !empty($_POST['remover_logo']) ? '' : imagem_upload_para_data_uri('logo_obra', $atual['logo'] ?? '');
            $cols = ['nome', 'responsavel', 'codigo', 'cliente', 'responsavel_cliente', 'cidade', 'endereco', 'encarregado', 'valor_contrato', 'contrato_numero', 'data_inicio', 'data_fim', 'duracao_meses', 'art', 'area_m2', 'telefone', 'email', 'observacoes'];
            $vals = array_map(function ($c) use ($d) { return $d[$c]; }, $cols);
            q_global('UPDATE obras SET ' . implode('=?, ', $cols) . '=?, cor_primaria=?, cor_secundaria=?, logo=? WHERE id=?',
                array_merge($vals, [cor_segura($_POST['cor_primaria'] ?? '', '#d97706'), cor_segura($_POST['cor_secundaria'] ?? '', '#111827'), $logo, $id]));
            foreach (['obra_nome' => $nome, 'data_inicio' => (string)$d['data_inicio'], 'data_fim' => (string)$d['data_fim']] as $k => $v) {
                q_global('DELETE FROM obra_config WHERE obra_id=? AND chave=?', [$id, $k]);
                q_global('INSERT INTO obra_config (obra_id,chave,valor) VALUES (?,?,?)', [$id, $k, $v]);
            }
            registrar_global('obra_editada', ['obra_id' => $id]);
            $msg = 'Dados e identidade da obra atualizados.';
        } elseif ($acao === 'status_obra') {
            $id = (int)($_POST['obra_id'] ?? 0);
            $status = ($_POST['status'] ?? '') === 'arquivada' ? 'arquivada' : 'ativa';
            if (q_global("SELECT 1 FROM obras WHERE id = ? AND status = 'rascunho'", [$id])->fetchColumn()) {
                throw new InvalidArgumentException('Esta obra ainda está em importação: conclua ou descarte o rascunho.');
            }
            q_global('UPDATE obras SET status=? WHERE id=?', [$status, $id]);
            if (obra_atual_id() === $id && $status !== 'ativa') { definir_obra_atual(0); }
            registrar_global('obra_status', ['obra_id' => $id, 'status' => $status]);
            $msg = 'Situação da obra alterada.';
        } elseif ($acao === 'excluir_obra') {   // exclusão definitiva: apaga a obra e TODOS os dados dela (produção, estoque, BM, apontamentos, documentos)
            $id = (int)($_POST['obra_id'] ?? 0);
            $o = q_global('SELECT * FROM obras WHERE id = ?', [$id])->fetch();
            if (!$o) { throw new InvalidArgumentException('Obra não encontrada.'); }
            if (trim((string)($_POST['confirmar_nome'] ?? '')) !== trim((string)$o['nome'])) {
                throw new InvalidArgumentException('Para excluir, digite o nome da obra exatamente como está (' . $o['nome'] . ').');
            }
            $pdo = bd();
            $pdo->beginTransaction();
            try {
                foreach (tabelas_da_obra() as $t) {
                    q_global("DELETE FROM `$t` WHERE obra_id = ?", [$id]);
                }
                foreach (['obra_config', 'usuarios_obras', 'obra_documentos'] as $t) {
                    q_global("DELETE FROM `$t` WHERE obra_id = ?", [$id]);
                }
                q_global('DELETE FROM obras WHERE id = ?', [$id]);
                $pdo->commit();
            } catch (Throwable $e) {
                if ($pdo->inTransaction()) { $pdo->rollBack(); }
                throw $e;
            }
            importacao_apagar_pasta($id);   // documentos enviados na importação
            if (obra_atual_id() === $id) { definir_obra_atual(0); }
            registrar_global('obra_excluida', ['obra_id' => $id, 'nome' => $o['nome']]);
            $msg = 'Obra “' . $o['nome'] . '” excluída definitivamente, com todos os dados.';
        } elseif ($acao === 'identidade') {
            $logo = !empty($_POST['remover_logo']) ? '' : imagem_upload_para_data_uri('logo_global', global_ler('logo', ''));
            global_gravar('nome_sistema', trim((string)($_POST['nome_sistema'] ?? '')) ?: 'Núcleo de Obras');
            global_gravar('cor_primaria', cor_segura($_POST['cor_primaria'] ?? '', '#d97706'));
            global_gravar('cor_secundaria', cor_segura($_POST['cor_secundaria'] ?? '', '#111827'));
            global_gravar('cor_fundo', cor_segura($_POST['cor_fundo'] ?? '', '#f4f6f8'));
            global_gravar('logo', $logo);
            registrar_global('identidade_atualizada');
            $msg = 'Identidade visual principal atualizada.';
        } elseif ($acao === 'permissoes') {
            $uid = (int)($_POST['usuario_id'] ?? 0);
            q_global('DELETE FROM usuarios_obras WHERE usuario_id=?', [$uid]);
            foreach ((array)($_POST['obras'] ?? []) as $oid) {
                q_global('INSERT INTO usuarios_obras (usuario_id, obra_id) VALUES (?, ?)', [$uid, (int)$oid]);
            }
            registrar_global('permissoes_obras', ['usuario_id' => $uid]);
            $msg = 'Acesso do usuário às obras atualizado.';
        }
    } catch (Exception $e) {
        $erro = $e->getMessage();
    }
}

function numero_ou_nulo($v)
{
    $t = trim(str_replace(['R$', ' ', "\xc2\xa0"], '', (string)$v));
    if ($t === '') { return null; }
    if (strpos($t, ',') !== false) { $t = str_replace(',', '.', str_replace('.', '', $t)); }
    if (!is_numeric($t)) { throw new InvalidArgumentException('Valor numérico inválido: ' . $v); }
    return (float)$t;
}

// Dados cadastrais da obra vindos do formulário: só nome e responsável são obrigatórios.
function dados_obra_do_post()
{
    $nome = trim((string)($_POST['nome'] ?? ''));
    $resp = trim((string)($_POST['responsavel'] ?? ''));
    if ($nome === '') { throw new InvalidArgumentException('Informe o nome da obra.'); }
    if ($resp === '') { throw new InvalidArgumentException('Informe o responsável da obra.'); }
    $ini = data_valida($_POST['data_inicio'] ?? '') ? $_POST['data_inicio'] : null;
    $fim = data_valida($_POST['data_fim'] ?? '') ? $_POST['data_fim'] : null;
    if ($ini && $fim && $fim < $ini) { throw new InvalidArgumentException('A data final deve ser posterior à inicial.'); }
    $email = trim((string)($_POST['email'] ?? ''));
    if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) { throw new InvalidArgumentException('E-mail de contato inválido.'); }
    $d = ['nome' => $nome, 'responsavel' => $resp, 'data_inicio' => $ini, 'data_fim' => $fim, 'email' => $email === '' ? null : $email,
        'valor_contrato' => numero_ou_nulo($_POST['valor_contrato'] ?? ''), 'duracao_meses' => numero_ou_nulo($_POST['duracao_meses'] ?? ''),
        'area_m2' => numero_ou_nulo($_POST['area_m2'] ?? '')];
    foreach (['codigo', 'cliente', 'responsavel_cliente', 'cidade', 'endereco', 'encarregado', 'contrato_numero', 'art', 'telefone', 'observacoes'] as $c) {
        $d[$c] = texto_ou_nulo($_POST[$c] ?? null);
    }
    return $d;
}

function fmt_numero_br($v, $casas = 2)
{
    return ($v === null || $v === '') ? '' : number_format((float)$v, $casas, ',', '.');
}

// Campos cadastrais da obra (formulário de nova obra e de edição). Só nome e responsável são obrigatórios.
function campos_obra(array $o = [])
{
    $v = function ($c) use ($o) { return h($o[$c] ?? ''); };
    $num = function ($c, $casas = 2) use ($o) { return h(fmt_numero_br($o[$c] ?? null, $casas)); };
    return '<fieldset class="obra-grupo"><legend>Identificação <small>(obrigatório)</small></legend><div class="campos">'
        . '<label>Nome da obra *<input name="nome" value="' . $v('nome') . '" required></label>'
        . '<label>Responsável da obra *<input name="responsavel" value="' . $v('responsavel') . '" required placeholder="Engenheiro / gestor"></label>'
        . '<label>Código<input name="codigo" value="' . $v('codigo') . '"></label></div></fieldset>'
        . '<fieldset class="obra-grupo"><legend>Cliente e local <small>(opcional)</small></legend><div class="campos">'
        . '<label>Cliente<input name="cliente" value="' . $v('cliente') . '"></label>'
        . '<label>Responsável do cliente<input name="responsavel_cliente" value="' . $v('responsavel_cliente') . '"></label>'
        . '<label>Local / cidade<input name="cidade" value="' . $v('cidade') . '"></label>'
        . '<label>Endereço da obra<input name="endereco" value="' . $v('endereco') . '"></label>'
        . '<label>Encarregado<input name="encarregado" value="' . $v('encarregado') . '"></label>'
        . '<label>Telefone de contato<input name="telefone" value="' . $v('telefone') . '"></label>'
        . '<label>E-mail de contato<input type="email" name="email" value="' . $v('email') . '"></label></div></fieldset>'
        . '<fieldset class="obra-grupo"><legend>Contrato e prazo <small>(opcional)</small></legend><div class="campos">'
        . '<label>Valor de contrato (R$)<input name="valor_contrato" inputmode="decimal" value="' . $num('valor_contrato') . '" placeholder="0,00"></label>'
        . '<label>Nº do contrato<input name="contrato_numero" value="' . $v('contrato_numero') . '"></label>'
        . '<label>Início<input type="date" name="data_inicio" value="' . $v('data_inicio') . '"></label>'
        . '<label>Fim previsto<input type="date" name="data_fim" value="' . $v('data_fim') . '"></label>'
        . '<label>Tempo de obra (meses)<input name="duracao_meses" inputmode="decimal" value="' . $num('duracao_meses', 1) . '"></label>'
        . '<label>Área (m²)<input name="area_m2" inputmode="decimal" value="' . $num('area_m2') . '"></label>'
        . '<label>ART / CREA<input name="art" value="' . $v('art') . '"></label></div>'
        . '<label>Observações<textarea name="observacoes" rows="3">' . $v('observacoes') . '</textarea></label></fieldset>';
}

function copiar_estrutura_obra($origem, $destino)
{
    $mapa = [];
    $st = q_global('SELECT * FROM empresas WHERE obra_id=? ORDER BY ordem,id', [(int)$origem]);
    foreach ($st->fetchAll() as $e) {
        q_global('INSERT INTO empresas (obra_id,aba,nome,col_obs,ordem) VALUES (?,?,?,?,?)', [$destino,$e['aba'],$e['nome'],$e['col_obs'],$e['ordem']]);
        $mapa[$e['id']] = (int)bd()->lastInsertId();
    }
    foreach (q_global('SELECT * FROM servicos WHERE obra_id=? ORDER BY ordem,id', [(int)$origem])->fetchAll() as $s) {
        if (isset($mapa[$s['empresa_id']])) {
            q_global('INSERT INTO servicos (obra_id,empresa_id,col,nome,frente,id_crono,escopo,ordem) VALUES (?,?,?,?,?,?,?,?)',
                [$destino,$mapa[$s['empresa_id']],$s['col'],$s['nome'],$s['frente'],$s['id_crono'],$s['escopo'],$s['ordem']]);
        }
    }
}

$obras = obras_do_usuario($eu);
$todas = $admin ? q_global("SELECT * FROM obras WHERE status <> 'excluida' ORDER BY nome")->fetchAll() : $obras;
$resumos = [];
foreach ($obras as $o) {
    $id = (int)$o['id'];
    $resumos[$id] = [
        'empresas' => (int)q_global('SELECT COUNT(*) FROM empresas WHERE obra_id=?', [$id])->fetchColumn(),
        'lancamentos' => (int)q_global('SELECT COUNT(*) FROM producao WHERE obra_id=?', [$id])->fetchColumn(),
        'impactos' => (int)q_global("SELECT COUNT(*) FROM impactos WHERE obra_id=? AND (solucionado IS NULL OR UPPER(solucionado) NOT IN ('SIM','S','YES'))", [$id])->fetchColumn(),
        'ultima' => q_global('SELECT MAX(quando) FROM historico WHERE obra_id=?', [$id])->fetchColumn(),
    ];
}
$usuarios = $admin ? q_global("SELECT id,nome,login,perfil FROM usuarios WHERE ativo=1 ORDER BY nome")->fetchAll() : [];
$rascunhos = $admin ? q_global("SELECT * FROM obras WHERE status = 'rascunho' ORDER BY id DESC")->fetchAll() : [];
$todas = array_values(array_filter($todas, function ($o) { return $o['status'] !== 'rascunho'; }));
$acessos = [];
if ($admin) {
    foreach (q_global('SELECT usuario_id,obra_id FROM usuarios_obras')->fetchAll() as $a) { $acessos[$a['usuario_id']][] = (int)$a['obra_id']; }
}
$csrf = token_csrf();
$logoGlobal = global_ler('logo', '');
pagina_inicio('Central de obras');
?>
<div class="portal-shell">
  <header class="portal-topo">
    <div class="portal-brand">
      <?php if ($logoGlobal): ?><img src="<?= h($logoGlobal) ?>" alt="Logo"><?php else: ?><span class="brand-mark">NO</span><?php endif; ?>
      <div><strong><?= h(global_ler('nome_sistema', 'Núcleo de Obras')) ?></strong><small>Central inteligente de gestão</small></div>
    </div>
    <div class="portal-user"><span>Olá, <?= h($eu['nome']) ?></span><a class="btn ghost" href="sair.php">Sair</a></div>
  </header>
  <main class="portal-main">
    <section class="hero-obras">
      <div><span class="eyebrow">PORTFÓLIO OPERACIONAL</span><h1>Suas obras, uma visão central.</h1><p>Escolha uma obra para abrir o ambiente operacional completo. Cada projeto mantém seus dados totalmente separados.</p></div>
      <div class="hero-stat"><strong><?= count($obras) ?></strong><span>obras disponíveis</span></div>
    </section>
    <?php if ($msg): ?><div class="toast ok-faixa"><?= h($msg) ?></div><?php endif; ?>
    <?php if ($erro): ?><div class="toast erro-form"><?= h($erro) ?></div><?php endif; ?>

    <?php if ($rascunhos): ?>
    <style>
      .imp-item { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:12px; padding:16px 18px; border:1px solid var(--portal-line,#e4e7ec); border-radius:13px; background:#fbfcfd; }
      .imp-item b { display:block; color:#101828; font-size:1rem; }
      .imp-item small { display:block; margin-top:3px; color:#667085; }
      .imp-continuar { display:inline-flex; align-items:center; justify-content:center; min-height:41px; padding:0 18px; border-radius:10px; background:var(--portal-primary,#d97706); color:#fff !important; font-weight:700; font-size:.9rem; text-decoration:none !important; white-space:nowrap; }
      .imp-continuar:hover { filter:brightness(.95); }
    </style>
    <section class="bloco painel-form" style="margin:22px 0">
      <h3>Obras em importação</h3><p class="nota">Ainda não abrem: faltam documentos ou a leitura automática.</p>
      <div class="manage-grid">
      <?php foreach ($rascunhos as $o): $faseImp = $o['importacao'] ?? 'rascunho'; ?>
        <div class="imp-item"><div><b><?= h($o['nome']) ?></b>
          <small><?= h(['aguardando_leitura' => 'Documentos enviados — pronta para gerar a obra', 'lendo' => 'Lendo os documentos…', 'revisao' => 'Leitura pronta — falta revisar e publicar', 'erro_leitura' => 'A leitura não terminou — tente de novo'][$faseImp] ?? 'Rascunho — faltam documentos') ?></small></div>
          <a class="imp-continuar" href="<?= in_array($faseImp, ['lendo', 'revisao', 'erro_leitura'], true) ? 'obra_revisao.php' : 'obra_importar.php' ?>?obra=<?= (int)$o['id'] ?>"><?= $faseImp === 'revisao' ? 'Revisar e publicar →' : 'Continuar importação →' ?></a></div>
      <?php endforeach; ?></div>
    </section>
    <?php endif; ?>

    <div class="obra-grid">
      <?php foreach ($obras as $o): ?>
      <article class="obra-card" style="--obra-cor:<?= h(cor_segura($o['cor_primaria'] ?? '', '#d97706')) ?>">
        <div class="obra-card-head">
          <?php if (!empty($o['logo'])): ?><img src="<?= h($o['logo']) ?>" alt="Logo da obra"><?php else: ?><span class="obra-avatar"><?= h(strtoupper(substr($o['nome'],0,2))) ?></span><?php endif; ?>
          <span class="status <?= h($o['status']) ?>"><?= h($o['status']) ?></span>
        </div>
        <h2><?= h($o['nome']) ?></h2><p><?= h($o['cliente'] ?: 'Cliente não informado') ?> · <?= h($o['cidade'] ?: 'Local não informado') ?></p>
        <ul class="obra-info">
          <li><b>Responsável</b><?= !empty($o['responsavel']) ? h($o['responsavel']) : '<em class="falta">não informado</em>' ?></li>
          <?php if (!empty($o['encarregado'])): ?><li><b>Encarregado</b><?= h($o['encarregado']) ?></li><?php endif; ?>
          <?php if (!empty($o['responsavel_cliente'])): ?><li><b>Resp. cliente</b><?= h($o['responsavel_cliente']) ?></li><?php endif; ?>
          <?php if (!empty($o['valor_contrato'])): ?><li><b>Contrato</b>R$ <?= h(fmt_numero_br($o['valor_contrato'])) ?></li><?php endif; ?>
          <?php if (!empty($o['duracao_meses'])): ?><li><b>Tempo de obra</b><?= h(fmt_numero_br($o['duracao_meses'], 1)) ?> meses</li><?php endif; ?>
        </ul>
        <div class="obra-meta"><span><?= h($o['codigo'] ?: 'Sem código') ?></span><span><?= h($o['data_inicio'] ? date('d/m/Y', strtotime($o['data_inicio'])) : 'Sem início') ?></span></div>
        <div class="obra-insights"><span><b><?= $resumos[$o['id']]['empresas'] ?></b> empresas</span><span><b><?= $resumos[$o['id']]['lancamentos'] ?></b> lançamentos</span><span class="<?= $resumos[$o['id']]['impactos'] ? 'tem-alerta' : '' ?>"><b><?= $resumos[$o['id']]['impactos'] ?></b> impactos abertos</span></div>
        <small class="ultima-atividade"><?= $resumos[$o['id']]['ultima'] ? 'Atualizada em '.h(date('d/m/Y H:i',strtotime($resumos[$o['id']]['ultima']))) : 'Ainda sem movimentação' ?></small>
        <?php if ($o['status'] === 'ativa'): ?><form method="post"><input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="acao" value="abrir"><input type="hidden" name="obra_id" value="<?= (int)$o['id'] ?>"><button class="btn primario largura">Abrir obra <span>→</span></button></form><?php endif; ?>
        <?php if ($admin): ?><button type="button" class="btn ghost largura" data-obra-editar="obraDlg<?= (int)$o['id'] ?>">✎ Editar dados da obra</button>
          <?php if (($o['importacao'] ?? '') === 'publicada'): ?><a class="btn ghost largura" href="obra_revisao.php?obra=<?= (int)$o['id'] ?>" style="margin-top:6px">Relatório da importação</a><?php endif; ?>
        <dialog id="obraDlg<?= (int)$o['id'] ?>" class="obra-dialog"><form method="post" enctype="multipart/form-data" class="painel-form">
          <input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="acao" value="editar_obra"><input type="hidden" name="obra_id" value="<?= (int)$o['id'] ?>">
          <h3>Dados da obra — <?= h($o['nome']) ?></h3><p class="nota">Só o nome e o responsável da obra são obrigatórios; o restante pode ser preenchido aos poucos.</p>
          <?= campos_obra($o) ?>
          <div class="color-row"><label>Cor principal<input type="color" name="cor_primaria" value="<?= h(cor_segura($o['cor_primaria'],'#d97706')) ?>"></label><label>Cor escura<input type="color" name="cor_secundaria" value="<?= h(cor_segura($o['cor_secundaria'],'#111827')) ?>"></label></div>
          <label>Nova logo<input type="file" name="logo_obra" accept="image/png,image/jpeg,image/webp"></label><label class="check"><input type="checkbox" name="remover_logo" value="1"> Remover logo</label>
          <div class="obra-dialog-acoes"><button type="button" class="btn ghost" data-obra-fechar>Cancelar</button><button class="btn primario">Salvar dados</button></div>
        </form></dialog><?php endif; ?>
      </article>
      <?php endforeach; ?>
    </div>

    <?php if ($admin): ?>
    <section class="portal-admin">
      <div class="section-title"><span class="eyebrow">ADMINISTRAÇÃO</span><h2>Personalização e controle</h2></div>
      <div class="portal-columns">
        <form method="post" enctype="multipart/form-data" class="bloco painel-form">
          <input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="acao" value="identidade">
          <h3>Identidade principal</h3><p class="nota">A marca exibida no login e na central.</p>
          <label>Nome do sistema<input name="nome_sistema" value="<?= h(global_ler('nome_sistema','Núcleo de Obras')) ?>"></label>
          <div class="color-row"><label>Cor principal<input type="color" name="cor_primaria" value="<?= h(cor_segura(global_ler('cor_primaria',''),'#d97706')) ?>"></label><label>Cor escura<input type="color" name="cor_secundaria" value="<?= h(cor_segura(global_ler('cor_secundaria',''),'#111827')) ?>"></label><label>Fundo<input type="color" name="cor_fundo" value="<?= h(cor_segura(global_ler('cor_fundo',''),'#f4f6f8')) ?>"></label></div>
          <label>Logo / ícone<input type="file" name="logo_global" accept="image/png,image/jpeg,image/webp"></label>
          <label class="check"><input type="checkbox" name="remover_logo" value="1"> Remover logo atual</label><button class="btn primario">Salvar identidade</button>
        </form>
        <form method="post" enctype="multipart/form-data" class="bloco painel-form">
          <input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="acao" value="criar_obra_importacao">
          <h3>Nova obra</h3><p class="nota">Passo 1 de 3: dados da obra. No passo 2 você envia os documentos obrigatórios (IFC, fixadores, cronograma, orçamento e projetos) e o sistema monta a obra a partir deles.</p>
          <?= campos_obra() ?>
          <div class="color-row"><label>Cor principal<input type="color" name="cor_primaria" value="#d97706"></label><label>Cor escura<input type="color" name="cor_secundaria" value="#111827"></label></div>
          <label>Logo da obra<input type="file" name="logo_obra" accept="image/png,image/jpeg,image/webp"></label>
          <button class="btn primario">Criar e enviar documentos →</button>
        </form>
        <form method="post" enctype="multipart/form-data" class="bloco painel-form">
          <input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="acao" value="criar_obra">
          <details><summary><b>Criar obra vazia (sem importação)</b> <small>— temporário</small></summary>
          <p class="nota">Cria um ambiente independente e vazio, para configurar manualmente. Será removido quando a leitura automática estiver validada.</p>
          <?= campos_obra() ?>
          <div class="color-row"><label>Cor principal<input type="color" name="cor_primaria" value="#d97706"></label><label>Cor escura<input type="color" name="cor_secundaria" value="#111827"></label></div>
          <label>Logo da obra<input type="file" name="logo_obra" accept="image/png,image/jpeg,image/webp"></label>
          <?php if (obra_atual_id()): ?><label class="check"><input type="checkbox" name="copiar_estrutura" value="1"> Copiar apenas empresas e serviços da obra aberta (sem produção)</label><?php endif; ?>
          <button class="btn">Criar obra vazia</button></details>
        </form>
      </div>

      <section class="bloco painel-form"><h3>Editar obras</h3><div class="manage-grid">
        <?php foreach ($todas as $o): ?><details><summary><b><?= h($o['nome']) ?></b><span><?= h($o['status']) ?></span></summary>
          <p class="nota">Para alterar os dados desta obra use o botão “Editar dados da obra” no cartão dela.</p>
          <form method="post" class="inline"><input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="acao" value="status_obra"><input type="hidden" name="obra_id" value="<?= (int)$o['id'] ?>"><input type="hidden" name="status" value="<?= $o['status']==='ativa'?'arquivada':'ativa' ?>"><button class="btn ghost"><?= $o['status']==='ativa'?'Arquivar':'Reativar' ?></button></form>
          <form method="post" class="excluir-obra" onsubmit="return confirm('EXCLUIR DEFINITIVAMENTE a obra <?= h(addslashes($o['nome'])) ?> e todos os dados dela (produção, estoque, BM, apontamentos, documentos)? Não dá para desfazer.');" style="margin-top:14px;padding-top:12px;border-top:1px solid #fecdca">
            <input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="acao" value="excluir_obra"><input type="hidden" name="obra_id" value="<?= (int)$o['id'] ?>">
            <p class="nota" style="color:#b42318;margin:0 0 6px"><b>Excluir obra</b> — apaga a obra e todos os dados dela, sem volta. Dica: se só quiser tirar da lista, use Arquivar.</p>
            <input name="confirmar_nome" placeholder="Digite o nome da obra para confirmar" autocomplete="off" required style="width:100%;padding:8px 10px;border:1px solid #fda29b;border-radius:8px;margin-bottom:8px">
            <button class="btn" style="background:#d92d20;color:#fff;border-color:#d92d20">Excluir obra definitivamente</button>
          </form>
        </details><?php endforeach; ?>
      </div></section>

      <section class="bloco painel-form"><h3>Acesso dos usuários</h3><p class="nota">Administradores veem todas as obras. Defina abaixo o acesso de editores e leitores.</p><div class="manage-grid">
        <?php foreach ($usuarios as $u): if ($u['perfil']==='admin') continue; ?><form method="post" class="user-access"><input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="acao" value="permissoes"><input type="hidden" name="usuario_id" value="<?= (int)$u['id'] ?>"><b><?= h($u['nome']) ?></b><small><?= h($u['login']) ?> · <?= h($u['perfil']) ?></small><div class="access-checks"><?php foreach ($todas as $o): ?><label class="check"><input type="checkbox" name="obras[]" value="<?= (int)$o['id'] ?>" <?= in_array((int)$o['id'],$acessos[$u['id']]??[],true)?'checked':'' ?>> <?= h($o['nome']) ?></label><?php endforeach; ?></div><button class="btn">Salvar acessos</button></form><?php endforeach; ?>
      </div></section>
    </section>
    <?php endif; ?>
  </main>
</div>
<script>
document.querySelectorAll('[data-obra-editar]').forEach(function (b) {
  b.addEventListener('click', function () { var d = document.getElementById(b.getAttribute('data-obra-editar')); if (d && d.showModal) d.showModal(); });
});
document.querySelectorAll('[data-obra-fechar]').forEach(function (b) {
  b.addEventListener('click', function () { b.closest('dialog').close(); });
});
document.querySelectorAll('.obra-dialog').forEach(function (d) {
  d.addEventListener('mousedown', function (e) { d._fundo = (e.target === d); });
  d.addEventListener('click', function (e) { if (e.target === d && d._fundo) d.close(); });
});
<?php if ($erro && ($_POST['acao'] ?? '') === 'editar_obra'): ?>
var _d = document.getElementById('obraDlg<?= (int)($_POST['obra_id'] ?? 0) ?>'); if (_d && _d.showModal) _d.showModal();
<?php endif; ?>
</script>
</body></html>
