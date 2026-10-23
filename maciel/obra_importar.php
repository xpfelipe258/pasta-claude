<?php
// Assistente de importação da obra nova: envio dos documentos obrigatórios, validação e fila para o serviço de leitura (Python).
require __DIR__ . '/inc/nucleo.php';
require __DIR__ . '/inc/importacao.php';
require __DIR__ . '/inc/importacao_leitura.php';
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

function resp_json($cod, array $d)
{
    http_response_code($cod);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($d, JSON_UNESCAPED_UNICODE);
    exit;
}

if (!config()) {
    header('Location: instalar.php');
    exit;
}
garantir_importacao();
$acao = $_GET['acao'] ?? ($_POST['acao'] ?? '');

// ---- chamadas do serviço de leitura (sem login; protegidas por assinatura HMAC com o segredo compartilhado)
if ($acao === 'baixar') {
    $doc = (int)($_GET['doc'] ?? 0);
    $exp = (int)($_GET['exp'] ?? 0);
    $sig = (string)($_GET['sig'] ?? '');
    if (!importacao_servico_ativo() || $exp < time() || !hash_equals(importacao_assinar('baixar|' . $doc . '|' . $exp), $sig)) {
        http_response_code(403);
        exit('Link inválido ou expirado.');
    }
    $d = q_global('SELECT * FROM obra_documentos WHERE id = ?', [$doc])->fetch();
    $p = $d ? importacao_diretorio((int)$d['obra_id']) . '/' . basename((string)$d['arquivo']) : '';
    if (!$d || !is_file($p)) {
        http_response_code(404);
        exit('Arquivo não encontrado.');
    }
    header('Content-Type: application/octet-stream');
    header('Content-Length: ' . filesize($p));
    header('Content-Disposition: attachment; filename="documento_' . $doc . '.' . importacao_extensao($d['nome_original']) . '"');
    readfile($p);
    exit;
}
if ($acao === 'callback') {
    $bruto = (string)file_get_contents('php://input');
    $sig = (string)($_SERVER['HTTP_X_ASSINATURA'] ?? '');
    if (!importacao_servico_ativo() || !hash_equals(importacao_assinar($bruto), $sig)) {
        resp_json(403, ['erro' => 'Assinatura inválida.']);
    }
    $j = json_decode($bruto, true);
    if (!is_array($j) || empty($j['documento_id'])) {
        resp_json(400, ['erro' => 'Corpo inválido.']);
    }
    $ok = !empty($j['ok']);
    q_global('UPDATE obra_documentos SET profunda_status = ?, profunda = ? WHERE id = ?', [
        $ok ? 'ok' : 'erro',
        json_encode(['resumo' => $j['resumo'] ?? new stdClass(), 'avisos' => $j['avisos'] ?? [], 'erros' => $j['erros'] ?? []], JSON_UNESCAPED_UNICODE),
        (int)$j['documento_id'],
    ]);
    resp_json(200, ['ok' => true]);
}

if ($acao === 'callback_pacote') {
    $bruto = (string)file_get_contents('php://input');
    $sig = (string)($_SERVER['HTTP_X_ASSINATURA'] ?? '');
    if (!importacao_servico_ativo() || !hash_equals(importacao_assinar($bruto), $sig)) {
        resp_json(403, ['erro' => 'Assinatura inválida.']);
    }
    $j = json_decode($bruto, true);
    if (!is_array($j) || empty($j['obra_id'])) {
        resp_json(400, ['erro' => 'Corpo inválido.']);
    }
    resp_json(200, ['ok' => importacao_guardar_pacote((int)$j['obra_id'], $j)]);
}

// ---- daqui em diante: só administrador logado
$eu = exigir_admin();
$obraId = (int)($_GET['obra'] ?? ($_POST['obra'] ?? 0));
$obra = $obraId ? q_global("SELECT * FROM obras WHERE id = ? AND status = 'rascunho'", [$obraId])->fetch() : null;
if (!$obra) {
    header('Location: obras.php');
    exit;
}
if (in_array($obra['importacao'] ?? '', ['lendo', 'revisao', 'erro_leitura'], true) && ($acao === '' || $acao === 'estado')) {
    if ($acao === '') {
        header('Location: obra_revisao.php?obra=' . $obraId);
        exit;
    }
}

function estado_json($obraId)
{
    $sit = importacao_situacao($obraId);
    $tipos = importacao_tipos();
    foreach ($sit['tipos'] as $k => &$t) {
        $t['ajuda'] = $tipos[$k]['ajuda'];
        $t['gera'] = $tipos[$k]['gera'];
        $t['ext'] = $tipos[$k]['ext'];
    }
    unset($t);
    return $sit;
}

if ($acao === 'estado') {
    resp_json(200, estado_json($obraId));
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    conferir_csrf();
    if ($acao === 'chunk') {
        $tipo = (string)($_GET['tipo'] ?? '');
        $tipos = importacao_tipos();
        $nome = importacao_nome_seguro($_GET['nome'] ?? '');
        $uid = (string)($_GET['upload'] ?? '');
        $offset = (int)($_GET['offset'] ?? 0);
        $total = (int)($_GET['tamanho'] ?? 0);
        $final = ($_GET['final'] ?? '') === '1';
        if (!isset($tipos[$tipo]) || !preg_match('/^[a-f0-9]{16,40}$/', $uid)) {
            resp_json(400, ['erro' => 'Envio inválido.']);
        }
        if (!in_array(importacao_extensao($nome), $tipos[$tipo]['ext'], true)) {
            resp_json(400, ['erro' => 'Formato não aceito para este documento. Aceitos: ' . implode(', ', $tipos[$tipo]['ext']) . '.']);
        }
        if ($total <= 0 || $total > IMPORTACAO_TAMANHO_MAX) {
            resp_json(400, ['erro' => 'Tamanho do arquivo inválido (máximo ' . (int)(IMPORTACAO_TAMANHO_MAX / 1048576) . ' MB).']);
        }
        $dir = importacao_diretorio($obraId);
        if (!is_dir($dir . '/_envio')) {
            @mkdir($dir . '/_envio', 0755, true);
        }
        $parte = $dir . '/_envio/' . $uid . '.parte';
        $atual = is_file($parte) ? filesize($parte) : 0;
        if ($atual !== $offset) {
            resp_json(409, ['erro' => 'Parte fora de ordem.', 'esperado' => $atual]);
        }
        $dados = file_get_contents('php://input');
        if ($dados === false || strlen($dados) > IMPORTACAO_PARTE_MAX) {
            resp_json(400, ['erro' => 'Parte inválida.']);
        }
        file_put_contents($parte, $dados, FILE_APPEND | LOCK_EX);
        clearstatcache(true, $parte);
        if (!$final) {
            resp_json(200, ['ok' => true, 'recebido' => filesize($parte)]);
        }
        if (filesize($parte) !== $total) {
            @unlink($parte);
            resp_json(400, ['erro' => 'O arquivo chegou incompleto. Envie de novo.']);
        }
        $armazenado = bin2hex(random_bytes(8)) . '.dat';
        rename($parte, $dir . '/' . $armazenado);
        $caminho = $dir . '/' . $armazenado;
        $v = importacao_validar_basico($tipo, $caminho, $nome, $total);
        q_global('INSERT INTO obra_documentos (obra_id, tipo, nome_original, arquivo, tamanho, sha256, status, mensagens, resumo, enviado_por, enviado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [
            $obraId, $tipo, $nome, $armazenado, $total, hash_file('sha256', $caminho), $v['status'],
            json_encode($v['mensagens'], JSON_UNESCAPED_UNICODE), json_encode($v['resumo'], JSON_UNESCAPED_UNICODE), (int)$eu['id'], (new DateTimeImmutable('now', new DateTimeZone('America/Sao_Paulo')))->format('Y-m-d H:i:s'),
        ]);
        $docId = (int)bd()->lastInsertId();
        if ($v['status'] === 'valido' && importacao_servico_ativo()) {
            importacao_despachar_validacao($docId);
        }
        registrar_global('obra_documento_enviado', ['obra_id' => $obraId, 'tipo' => $tipo, 'nome' => $nome, 'status' => $v['status']]);
        resp_json(200, ['ok' => true, 'documento_id' => $docId, 'status' => $v['status'], 'mensagens' => $v['mensagens']]);
    }
    if ($acao === 'remover') {
        $docId = (int)($_POST['doc'] ?? 0);
        $d = q_global('SELECT obra_id FROM obra_documentos WHERE id = ?', [$docId])->fetch();
        if ($d && (int)$d['obra_id'] === $obraId) {
            importacao_remover_documento($docId);
        }
        resp_json(200, estado_json($obraId));
    }
    if ($acao === 'revalidar') {
        $docId = (int)($_POST['doc'] ?? 0);
        $d = q_global('SELECT obra_id FROM obra_documentos WHERE id = ?', [$docId])->fetch();
        if ($d && (int)$d['obra_id'] === $obraId) {
            importacao_despachar_validacao($docId);
        }
        resp_json(200, estado_json($obraId));
    }
    if ($acao === 'enviar') {
        $sit = importacao_situacao($obraId);
        if (!$sit['pronta']) {
            resp_json(400, ['erro' => 'Faltam documentos obrigatórios ou há arquivo recusado.']);
        }
        q_global("UPDATE obras SET importacao = 'aguardando_leitura' WHERE id = ?", [$obraId]);
        registrar_global('obra_importacao_enviada', ['obra_id' => $obraId]);
        if (importacao_servico_ativo()) {
            $r = importacao_despachar_leitura($obraId);
            resp_json(200, estado_json($obraId) + ['importacao' => $r['ok'] ? 'lendo' : 'erro_leitura', 'destino' => 'obra_revisao.php?obra=' . $obraId]);
        }
        resp_json(200, estado_json($obraId) + ['importacao' => 'aguardando_leitura']);
    }
    if ($acao === 'gerar') {   // lê todos os documentos dentro do sistema e já cria a obra
        try {
            $r = importacao_gerar($obraId, ['sigla' => $_POST['sigla'] ?? '', 'empresa' => $_POST['empresa'] ?? '']);
            resp_json(200, ['ok' => true, 'resumo' => $r, 'destino' => 'obra_revisao.php?obra=' . $obraId]);
        } catch (InvalidArgumentException $e) {
            resp_json(400, ['erro' => $e->getMessage()]);
        } catch (Throwable $e) {
            resp_json(500, ['erro' => 'Falha ao gerar a obra: ' . $e->getMessage()]);
        }
    }
    if ($acao === 'ler_agora') {
        $r = importacao_despachar_leitura($obraId);
        resp_json($r['ok'] ? 200 : 502, $r + ['destino' => 'obra_revisao.php?obra=' . $obraId]);
    }
    if ($acao === 'publicar_vazia') {   // transitório: libera a obra sem a leitura automática (configuração manual, como era antes)
        q_global("UPDATE obras SET status = 'ativa', importacao = NULL WHERE id = ?", [$obraId]);
        registrar_global('obra_publicada_sem_leitura', ['obra_id' => $obraId]);
        resp_json(200, ['ok' => true, 'destino' => 'obras.php']);
    }
    if ($acao === 'descartar') {
        foreach (importacao_documentos($obraId) as $d) {
            importacao_remover_documento($d['id']);
        }
        importacao_apagar_pasta($obraId);
        foreach (['obra_config', 'usuarios_obras'] as $t) {
            q_global("DELETE FROM $t WHERE obra_id = ?", [$obraId]);
        }
        q_global("DELETE FROM obras WHERE id = ? AND status = 'rascunho'", [$obraId]);
        registrar_global('obra_rascunho_descartado', ['obra_id' => $obraId]);
        resp_json(200, ['ok' => true, 'destino' => 'obras.php']);
    }
    resp_json(400, ['erro' => 'Ação desconhecida.']);
}

$csrf = token_csrf();
$inicial = estado_json($obraId);
pagina_inicio('Importar obra');
?>
<div class="portal-shell">
  <header class="portal-topo">
    <div class="portal-brand"><span class="brand-mark">NO</span><div><strong><?= h(global_ler('nome_sistema', 'Núcleo de Obras')) ?></strong><small>Importação de obra nova</small></div></div>
    <div class="portal-user"><a class="btn ghost" href="obras.php">← Central de obras</a></div>
  </header>
  <main class="portal-main imp-main">
    <section class="hero-obras">
      <div><span class="eyebrow">NOVA OBRA · PASSO 2 DE 2</span><h1><?= h($obra['nome']) ?></h1>
        <p>Envie os 5 documentos obrigatórios. Com os 5 documentos válidos, um clique em "Gerar obra" lê tudo dentro do sistema e cria a lista de material, o fluxo de baixa, o BM e o mapa de apontamento.</p></div>
      <div class="hero-stat"><strong id="impContagem">0/5</strong><span>documentos completos</span></div>
    </section>
    <div id="impAviso"></div>
    <div id="impCartoes" class="imp-grid"></div>
    <section class="imp-rodape bloco">
      <div id="impStatus" class="nota"></div>
      <div class="imp-botoes">
        <button class="btn ghost" id="impDescartar" type="button">Descartar este rascunho</button>
        <button class="btn" id="impVazia" type="button" title="Libera a obra sem leitura automática. Uso temporário até a leitura automática estar validada.">Publicar sem leitura automática (temporário)</button>
        <input id="impSigla" maxlength="10" placeholder="Sigla da empresa (ex.: CMM)" style="text-transform:uppercase;padding:10px 12px;border:1px solid #d0d5dd;border-radius:10px;width:210px" title="Prefixo dos códigos do catálogo do BM (ex.: CMM-3.1.1-01)">
        <button class="btn primario" id="impEnviar" type="button" disabled>Gerar obra →</button>
      </div>
    </section>
  </main>
</div>
<style>
.imp-main { max-width: 1180px; }
.imp-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 18px; margin: 24px 0; }
.imp-card { background: #fff; border: 1px solid var(--portal-line, #e4e7ec); border-radius: 18px; padding: 20px; display: flex; flex-direction: column; gap: 10px; box-shadow: 0 7px 25px rgba(16,24,40,.045); }
.imp-card.ok { border-color: #12b76a; }
.imp-card h3 { margin: 0; font-size: 1.05rem; display: flex; justify-content: space-between; gap: 8px; align-items: center; }
.imp-selo { font-size: .7rem; font-weight: 700; padding: 3px 9px; border-radius: 999px; background: #fef3f2; color: #b42318; white-space: nowrap; }
.imp-selo.ok { background: #ecfdf3; color: #027a48; }
.imp-selo.pend { background: #fffaeb; color: #b54708; }
.imp-card .nota { font-size: .82rem; color: #667085; margin: 0; }
.imp-gera { margin: 0; padding-left: 18px; font-size: .8rem; color: #475467; }
.imp-docs { display: grid; gap: 8px; }
.imp-doc { border: 1px solid #eaecf0; border-radius: 10px; padding: 8px 10px; font-size: .82rem; }
.imp-doc .linha { display: flex; justify-content: space-between; gap: 8px; align-items: center; }
.imp-doc .nome { font-weight: 600; word-break: break-all; }
.imp-doc ul { margin: 6px 0 0; padding-left: 18px; }
.imp-doc li.erro { color: #b42318; } .imp-doc li.aviso { color: #b54708; } .imp-doc li.info { color: #475467; }
.imp-drop { border: 2px dashed #d0d5dd; border-radius: 12px; padding: 14px; text-align: center; cursor: pointer; font-size: .85rem; color: #475467; }
.imp-drop.sobre { border-color: var(--portal-primary, #d97706); background: #fffaf0; }
.imp-barra { height: 8px; border-radius: 6px; background: #eaecf0; overflow: hidden; margin-top: 6px; }
.imp-barra > i { display: block; height: 100%; width: 0; background: var(--portal-primary, #d97706); transition: width .2s; }
.imp-rodape { margin-top: 10px; padding: 18px 22px; display: flex; flex-wrap: wrap; gap: 14px; justify-content: space-between; align-items: center; border: 1px solid var(--portal-line, #e4e7ec); border-radius: 18px; background: #fff; }
.imp-botoes { display: flex; flex-wrap: wrap; gap: 10px; }
.imp-faixa { margin: 14px 0; padding: 12px 16px; border-radius: 12px; background: #fffaeb; border: 1px solid #fedf89; color: #93370d; font-size: .88rem; }
.imp-faixa.ok { background: #ecfdf3; border-color: #a6f4c5; color: #05603a; }
.btn.link-x { background: none; border: 0; color: #b42318; cursor: pointer; font-size: .78rem; padding: 0; }
</style>
<script>
(function () {
  var CSRF = <?= json_encode($csrf) ?>, OBRA = <?= (int)$obraId ?>, ESTADO = <?= json_encode($inicial, JSON_UNESCAPED_UNICODE) ?>;
  var IMPORTACAO = <?= json_encode($obra['importacao'] ?? 'rascunho') ?>, PARTE = 4 * 1024 * 1024;
  var uploads = {};   // tipo -> {nome, pct}
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function mb(n) { return n < 1048576 ? Math.max(1, Math.round(n / 1024)) + ' KB' : (n / 1048576).toFixed(1).replace('.', ',') + ' MB'; }
  function val(v) { return v === true ? 'sim' : v === false ? 'não' : v; }
  function post(acao, dados) {
    var f = new URLSearchParams(Object.assign({ acao: acao, obra: OBRA, csrf: CSRF }, dados || {}));
    return fetch('obra_importar.php', { method: 'POST', body: f }).then(function (r) { return r.json(); });
  }
  function docHtml(d, servico) {
    var selo, cls;
    if (d.status !== 'valido') { selo = 'Recusado'; cls = ''; }
    else if (servico && d.profunda_status === 'erro') { selo = 'Leitura profunda: erro'; cls = ''; }
    else if (servico && d.profunda_status !== 'ok') { selo = 'Validando…'; cls = 'pend'; }
    else { selo = 'Válido'; cls = 'ok'; }
    // com a leitura profunda feita, só os erros da conferência básica ficam (os avisos do serviço são mais completos)
    var msgs = (d.mensagens || []).filter(function (m) { return !d.profunda || m[0] === 'erro'; }).map(function (m) { return '<li class="' + esc(m[0]) + '">' + esc(m[1]) + '</li>'; });
    if (d.profunda) {
      (d.profunda.erros || []).forEach(function (m) { msgs.push('<li class="erro">' + esc(m) + '</li>'); });
      (d.profunda.avisos || []).forEach(function (m) { msgs.push('<li class="aviso">' + esc(m) + '</li>'); });
      var r = d.profunda.resumo || {}, partes = Object.keys(r).filter(function (k) { return typeof r[k] !== 'object'; }).map(function (k) { return esc(k.replace(/_/g, ' ')) + ': ' + esc(val(r[k])); });
      if (partes.length) msgs.push('<li class="info">' + partes.join(' · ') + '</li>');
    }
    return '<div class="imp-doc"><div class="linha"><span class="nome">' + esc(d.nome_original) + ' <span class="nota">' + mb(d.tamanho) + '</span></span><span class="imp-selo ' + cls + '">' + selo + '</span></div>' +
      (msgs.length ? '<ul>' + msgs.join('') + '</ul>' : '') +
      '<div class="linha"><span></span><span>' + (servico && (d.profunda_status === 'erro' || d.profunda_status == null) && d.status === 'valido' ? '<button type="button" class="btn link-x" style="color:#475467" data-revalidar="' + d.id + '">Revalidar</button> · ' : '') +
      '<button type="button" class="btn link-x" data-remover="' + d.id + '">Remover</button></span></div></div>';
  }
  function desenhar() {
    var bloqueado = IMPORTACAO === 'aguardando_leitura';
    document.getElementById('impContagem').textContent = ESTADO.completos + '/' + ESTADO.total;
    var h = '';
    Object.keys(ESTADO.tipos).forEach(function (k) {
      var t = ESTADO.tipos[k], u = uploads[k];
      var selo = t.ok ? '<span class="imp-selo ok">Completo</span>' : (t.pendente ? '<span class="imp-selo pend">Validando</span>' : '<span class="imp-selo">Obrigatório</span>');
      h += '<article class="imp-card ' + (t.ok ? 'ok' : '') + '" data-tipo="' + k + '"><h3>' + esc(t.rotulo) + selo + '</h3><p class="nota">' + esc(t.ajuda) + '</p>' +
        '<ul class="imp-gera">' + t.gera.map(function (g) { return '<li>' + esc(g) + '</li>'; }).join('') + '</ul>' +
        '<div class="imp-docs">' + t.documentos.map(function (d) { return docHtml(d, ESTADO.servico); }).join('') + '</div>' +
        (t.ok || bloqueado ? '' : '<p class="nota" style="color:#b42318">' + esc(t.motivo) + '</p>') +
        (bloqueado ? '' : '<label class="imp-drop" data-drop="' + k + '">Arraste ou clique para enviar (' + t.ext.map(function (e) { return '.' + e; }).join(', ') + ')<input type="file" multiple hidden data-arq="' + k + '" accept="' + t.ext.map(function (e) { return '.' + e; }).join(',') + '"></label>') +
        (u ? '<div class="nota">' + esc(u.nome) + ' — ' + u.pct + '%</div><div class="imp-barra"><i style="width:' + u.pct + '%"></i></div>' : '') + '</article>';
    });
    document.getElementById('impCartoes').innerHTML = h;
    var envio = document.getElementById('impEnviar');
    envio.disabled = !ESTADO.pronta || bloqueado || Object.keys(uploads).length > 0;
    var av = '';
    if (bloqueado) av += '<div class="imp-faixa ok"><b>Documentos recebidos e validados.</b> A obra está aguardando a leitura automática (lista de material, baixa, BM e mapa de apontamento).</div>';
    document.getElementById('impAviso').innerHTML = av;
    document.getElementById('impStatus').textContent = ESTADO.pronta ? 'Todos os documentos obrigatórios estão completos.' : 'Faltam ' + (ESTADO.total - ESTADO.completos) + ' documento(s) obrigatório(s).';
  }
  function atualizar() { return fetch('obra_importar.php?acao=estado&obra=' + OBRA, { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) { ESTADO = j; desenhar(); }); }
  async function enviarArquivo(tipo, arq) {
    var uid = Array.from(crypto.getRandomValues(new Uint8Array(12))).map(function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    uploads[tipo] = { nome: arq.name, pct: 0 }; desenhar();
    try {
      for (var off = 0; off < arq.size || (arq.size === 0 && off === 0); off += PARTE) {
        var fim = Math.min(off + PARTE, arq.size), final = fim >= arq.size;
        var url = 'obra_importar.php?acao=chunk&obra=' + OBRA + '&tipo=' + tipo + '&upload=' + uid + '&nome=' + encodeURIComponent(arq.name) + '&offset=' + off + '&tamanho=' + arq.size + '&final=' + (final ? 1 : 0);
        var r = await fetch(url, { method: 'POST', headers: { 'X-CSRF-Token': CSRF, 'Content-Type': 'application/octet-stream' }, body: arq.slice(off, fim) });
        var j = await r.json().catch(function () { return { erro: 'Resposta inválida do servidor.' }; });
        if (!r.ok) throw new Error(j.erro || 'Falha no envio');
        uploads[tipo].pct = Math.round(100 * fim / Math.max(1, arq.size)); desenhar();
        if (final) break;
      }
    } catch (e) { alert('Não foi possível enviar "' + arq.name + '": ' + e.message); }
    delete uploads[tipo];
    await atualizar();
  }
  document.addEventListener('change', function (ev) {
    var i = ev.target.closest('input[data-arq]'); if (!i) return;
    var tipo = i.getAttribute('data-arq'), lista = Array.from(i.files);
    (async function () { for (var a of lista) { await enviarArquivo(tipo, a); } })();
  });
  document.addEventListener('dragover', function (ev) { var d = ev.target.closest('[data-drop]'); if (d) { ev.preventDefault(); d.classList.add('sobre'); } });
  document.addEventListener('dragleave', function (ev) { var d = ev.target.closest('[data-drop]'); if (d) d.classList.remove('sobre'); });
  document.addEventListener('drop', function (ev) {
    var d = ev.target.closest('[data-drop]'); if (!d) return; ev.preventDefault(); d.classList.remove('sobre');
    var tipo = d.getAttribute('data-drop'), lista = Array.from(ev.dataTransfer.files);
    (async function () { for (var a of lista) { await enviarArquivo(tipo, a); } })();
  });
  document.addEventListener('click', function (ev) {
    var r = ev.target.closest('[data-remover]');
    if (r) { if (confirm('Remover este documento?')) post('remover', { doc: r.getAttribute('data-remover') }).then(function (j) { ESTADO = j; desenhar(); }); return; }
    var v = ev.target.closest('[data-revalidar]');
    if (v) post('revalidar', { doc: v.getAttribute('data-revalidar') }).then(function (j) { ESTADO = j; desenhar(); });
  });
  document.getElementById('impEnviar').addEventListener('click', function () {
    var sigla = document.getElementById('impSigla').value.trim();
    if (sigla.length < 2) { alert('Informe a sigla da empresa executora (ex.: CMM): ela vira o prefixo do catálogo do BM.'); document.getElementById('impSigla').focus(); return; }
    var b = this; b.disabled = true; b.textContent = 'Lendo os documentos e gerando a obra…';
    document.getElementById('impStatus').textContent = 'Lendo IFC, orçamento, cronograma e fixadores e criando a obra. Pode levar alguns segundos.';
    post('gerar', { sigla: sigla }).then(function (j) {
      if (j.erro || !j.ok) { alert(j.erro || 'Não foi possível gerar a obra.'); b.disabled = false; b.textContent = 'Gerar obra →'; return; }
      location.href = j.destino;
    }).catch(function () { alert('Falha de comunicação ao gerar a obra.'); b.disabled = false; b.textContent = 'Gerar obra →'; });
  });
  document.getElementById('impDescartar').addEventListener('click', function () {
    if (confirm('Descartar este rascunho e apagar os documentos enviados?')) post('descartar').then(function (j) { if (j.destino) location.href = j.destino; });
  });
  document.getElementById('impVazia').addEventListener('click', function () {
    if (confirm('Publicar a obra SEM a leitura automática? Ela abre vazia, para configuração manual. Os documentos enviados ficam guardados.')) post('publicar_vazia').then(function (j) { if (j.destino) location.href = j.destino; });
  });
  desenhar();
  setInterval(function () { if (!document.hidden && ESTADO.servico && Object.keys(ESTADO.tipos).some(function (k) { return ESTADO.tipos[k].pendente; })) atualizar(); }, 4000);
})();
</script>
</body></html>
