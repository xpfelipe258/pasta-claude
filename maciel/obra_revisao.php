<?php
// Revisão do que o sistema leu dos documentos da obra nova e publicação (fase 2 da importação automática).
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
$eu = exigir_admin();
$obraId = (int)($_GET['obra'] ?? ($_POST['obra'] ?? 0));
$obra = $obraId ? q_global("SELECT * FROM obras WHERE id = ? AND status = 'rascunho'", [$obraId])->fetch() : null;
if (!$obra) {
    header('Location: obras.php');
    exit;
}
$acao = $_GET['acao'] ?? ($_POST['acao'] ?? '');
$erroArq = importacao_diretorio($obraId) . '/erro_leitura.txt';

if ($acao === 'estado') {
    resp_json(200, ['importacao' => $obra['importacao'], 'erro' => is_file($erroArq) ? (string)file_get_contents($erroArq) : '']);
}
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    conferir_csrf();
    if ($acao === 'ler_de_novo') {
        $r = importacao_despachar_leitura($obraId);
        resp_json($r['ok'] ? 200 : 502, $r);
    }
    if ($acao === 'voltar_documentos') {
        q_global("UPDATE obras SET importacao = 'rascunho' WHERE id = ?", [$obraId]);
        resp_json(200, ['destino' => 'obra_importar.php?obra=' . $obraId]);
    }
    if ($acao === 'publicar') {
        try {
            $mapa = [];
            foreach ((array)($_POST['mapa_fase'] ?? []) as $k => $v) {
                $mapa[(string)$k] = (string)$v;
            }
            $r = importacao_publicar($obraId, ['sigla' => $_POST['sigla'] ?? '', 'empresa' => $_POST['empresa'] ?? '', 'mapa_fase' => $mapa]);
            resp_json(200, ['ok' => true, 'resumo' => $r, 'destino' => 'obras.php']);
        } catch (InvalidArgumentException $e) {
            resp_json(400, ['erro' => $e->getMessage()]);
        } catch (Throwable $e) {
            resp_json(500, ['erro' => 'Falha ao publicar: ' . $e->getMessage()]);
        }
    }
    resp_json(400, ['erro' => 'Ação desconhecida.']);
}

$csrf = token_csrf();
$estado = $obra['importacao'] ?? '';
$pacote = $estado === 'revisao' ? importacao_pacote($obraId) : null;
pagina_inicio('Revisão da importação');

function n0($v) { return number_format((float)$v, 0, ',', '.'); }
function n1($v) { return number_format((float)$v, 1, ',', '.'); }
function n2($v) { return number_format((float)$v, 2, ',', '.'); }
function brl($v) { return 'R$ ' . number_format((float)$v, 2, ',', '.'); }
?>
<div class="portal-shell">
  <header class="portal-topo">
    <div class="portal-brand"><span class="brand-mark">NO</span><div><strong><?= h(global_ler('nome_sistema', 'Núcleo de Obras')) ?></strong><small>Revisão da importação</small></div></div>
    <div class="portal-user"><a class="btn ghost" href="obras.php">← Central de obras</a></div>
  </header>
  <main class="portal-main imp-main">
<?php if ($estado === 'lendo' || $estado === 'aguardando_leitura'): ?>
    <section class="hero-obras"><div><span class="eyebrow">NOVA OBRA · PASSO 3 DE 4</span><h1><?= h($obra['nome']) ?></h1>
      <p>O serviço de leitura está lendo os documentos: IFC (peças, fases, parafusos, posições), orçamento (BM), cronograma, lista de fixadores e pranchas. Leva de 1 a 3 minutos; esta tela atualiza sozinha.</p></div></section>
    <div class="imp-faixa" id="leitura">Lendo os documentos…</div>
<?php elseif ($estado === 'erro_leitura'): ?>
    <section class="hero-obras"><div><span class="eyebrow">NOVA OBRA · PASSO 3 DE 4</span><h1><?= h($obra['nome']) ?></h1><p>A leitura automática não terminou.</p></div></section>
    <div class="imp-faixa"><b>Motivo:</b> <?= nl2br(h(is_file($erroArq) ? (string)file_get_contents($erroArq) : 'não informado')) ?></div>
    <div class="imp-botoes"><button class="btn primario" id="lerDeNovo">Tentar a leitura de novo</button> <button class="btn ghost" id="voltarDocs">Voltar aos documentos</button></div>
<?php elseif ($pacote): $r = importacao_resumo_pacote($pacote); $modelo = $pacote['modelo']; $bm = $pacote['bm']; $cruz = $pacote['cruzamentos']; ?>
    <section class="hero-obras"><div><span class="eyebrow">NOVA OBRA · PASSO 4 DE 4 · REVISÃO</span><h1><?= h($obra['nome']) ?></h1>
      <p>Confira o que o sistema leu. Nada foi gravado na obra ainda: ao publicar, ele cria empresa e serviços, previsto do cronograma, catálogo do BM, cadastro de materiais, vínculos peça × atividade, baixa automática, parafusos do projeto e o mapa de apontamento. Tudo pode ser ajustado depois nas telas normais.</p></div>
      <div class="hero-stat"><strong><?= n0($r['conjuntos']) ?></strong><span>peças lidas do IFC</span></div></section>

    <div class="rv-cartoes">
      <div><b><?= n0($r['conjuntos']) ?></b><span>conjuntos · <?= n1($r['peso_t']) ?> t</span></div>
      <div><b><?= n0($r['fases']) ?></b><span>fases do modelo</span></div>
      <div><b><?= n0($r['produtos']) ?></b><span>produtos na lista de material</span></div>
      <div><b><?= n0($r['parafusos']) ?></b><span>parafusos no IFC</span></div>
      <div><b><?= n0($r['itens_bm']) ?> / <?= n0($r['atividades_bm']) ?></b><span>itens / atividades do BM</span></div>
      <div><b><?= $r['contrato'] ? brl($r['contrato']) : '—' ?></b><span>contrato lido</span></div>
      <div><b><?= n0($r['tarefas']) ?></b><span>tarefas do cronograma</span></div>
      <div><b><?= n0($r['telhas']) ?></b><span>telhas · <?= n0($r['telhas_m2']) ?> m²</span></div>
      <div><b><?= n0($r['eixos_v']) ?> × <?= n0($r['eixos_h']) ?></b><span>eixos V × H (mapa)</span></div>
      <div><b><?= n0($r['pranchas']) ?></b><span>pranchas em PDF</span></div>
    </div>

<?php if ($r['avisos']): ?>
    <div class="imp-faixa"><b>Pontos de atenção</b><ul><?php foreach ($r['avisos'] as $a): ?><li><?= h($a) ?></li><?php endforeach; ?></ul></div>
<?php endif; ?>

    <form id="formPublicar">
    <section class="bloco rv-sec"><h2>1 · Empresa executora e ligação fase do IFC × item do BM</h2>
      <p class="nota">A sigla vira o prefixo dos códigos do catálogo do BM (ex.: <b>CMM-3.1.1-01</b>). A ligação fase × item é feita pelo número (3.1.1 do modelo = 3.1.1 do orçamento); corrija abaixo o que ficou sem par.</p>
      <div class="rv-form">
        <label>Sigla da empresa executora *<input name="sigla" maxlength="10" required placeholder="ex.: CMM" style="text-transform:uppercase"></label>
        <label>Nome da empresa<input name="empresa" maxlength="100" placeholder="opcional"></label>
      </div>
      <div class="tabela-rolagem"><table><thead><tr><th>Fase do modelo (IFC)</th><th class="n">Peças</th><th class="n">Peso (t)</th><th>Item do BM</th></tr></thead><tbody>
<?php foreach ($modelo['fases'] as $f): $it = $cruz['fase_para_item'][$f['fase']] ?? ''; ?>
        <tr><td><?= h($f['fase'] ?: '(sem fase)') ?></td><td class="n"><?= n0($f['conjuntos']) ?></td><td class="n"><?= n1($f['peso_kg'] / 1000) ?></td>
          <td><select name="mapa_fase[<?= h($f['fase']) ?>]"><option value="">— sem item —</option>
<?php foreach ($bm['itens'] as $bi): ?><option value="<?= h($bi['codigo']) ?>" <?= $bi['codigo'] === $it ? 'selected' : '' ?>><?= h($bi['codigo'] . ' · ' . mb_substr($bi['descricao'], 0, 50)) ?></option><?php endforeach; ?>
          </select><?= $it ? '' : ' <span class="rv-pend">sem par</span>' ?></td></tr>
<?php endforeach; ?>
      </tbody></table></div>
    </section>

    <section class="bloco rv-sec"><h2>2 · Lista de material (IFC)</h2>
      <p class="nota">Uma TAG por fase + produto + perfil. Vira o cadastro de Materiais com a quantidade planejada. Telhas trazem a área em m².</p>
      <details><summary>Ver os <?= n0(count($modelo['material'])) ?> produtos</summary>
      <div class="tabela-rolagem"><table><thead><tr><th>Fase</th><th>Produto</th><th>Perfil</th><th>Material</th><th class="n">Qtd</th><th class="n">Peso unit. (kg)</th><th class="n">Peso total (kg)</th><th class="n">m²</th></tr></thead><tbody>
<?php foreach ($modelo['material'] as $m): ?>
        <tr><td><?= h($m['fase']) ?></td><td><?= h($m['produto']) ?></td><td><?= h($m['perfil']) ?></td><td><?= h($m['material']) ?></td><td class="n"><?= n0($m['qtd']) ?></td><td class="n"><?= n2($m['peso_unit_kg']) ?></td><td class="n"><?= n1($m['peso_kg']) ?></td><td class="n"><?= $m['area_m2'] ? n1($m['area_m2']) : '' ?></td></tr>
<?php endforeach; ?>
      </tbody></table></div></details>
    </section>

    <section class="bloco rv-sec"><h2>3 · Fixadores: lista em planilha × parafusos do IFC</h2>
      <p class="nota">Onde há lista em planilha, a quantidade dela vale; o que só aparece no IFC entra com a quantidade do modelo. Hardbolt e chumbadores sem modelagem só existem na lista.</p>
      <details open><summary><?= n0(count($pacote['fixadores_confronto'])) ?> tipos de fixador</summary>
      <div class="tabela-rolagem"><table><thead><tr><th>Fixador</th><th class="n">IFC</th><th class="n">Lista</th><th>Situação</th></tr></thead><tbody>
<?php foreach ($pacote['fixadores_confronto'] as $c):
    $sit = !$c['lista'] ? 'só no IFC' : (!$c['ifc'] ? 'só na lista' : (abs($c['ifc'] - $c['lista']) / max($c['ifc'], $c['lista']) > 0.1 ? 'diferente' : 'confere')); ?>
        <tr><td><?= h($c['nome']) ?></td><td class="n"><?= $c['ifc'] ? n0($c['ifc']) : '—' ?></td><td class="n"><?= $c['lista'] ? n0($c['lista']) : '—' ?></td><td><span class="rv-selo <?= $sit === 'confere' ? 'ok' : 'aviso' ?>"><?= h($sit) ?></span></td></tr>
<?php endforeach; ?>
      </tbody></table></div></details>
<?php if (!empty($pacote['fixadores']['por_joist'])): ?>
      <p class="nota">Fixadores por tipo de joist lidos: <?= implode(', ', array_map(function ($b) { return h($b['joist']); }, $pacote['fixadores']['por_joist'])) ?> (ficam guardados no pacote; a quantidade de joists de cada tipo entra no apontamento).</p>
<?php endif; ?>
    </section>

    <section class="bloco rv-sec"><h2>4 · Catálogo do BM (orçamento)</h2>
      <p class="nota">Cada atividade vira <b>SIGLA-item-nn</b> no catálogo, com quantidade, unidade, peso e valor. Tarefas do cronograma parecidas com a atividade ficam ligadas a ela (produção lançada da tarefa alimenta a medição).</p>
      <details><summary><?= n0($r['itens_bm']) ?> itens · <?= n0($r['atividades_bm']) ?> atividades</summary>
      <div class="tabela-rolagem"><table><thead><tr><th>Item</th><th>Atividade</th><th class="n">Qtd</th><th>Un.</th><th class="n">Peso</th><th class="n">Valor (R$)</th></tr></thead><tbody>
<?php foreach ($bm['itens'] as $it): ?>
        <tr class="grupo"><td><b><?= h($it['codigo']) ?></b></td><td><b><?= h($it['descricao']) ?></b></td><td class="n"><?= n2($it['qtd']) ?></td><td><?= h($it['unidade']) ?></td><td></td><td class="n"><b><?= n2($it['valor'] ?? 0) ?></b></td></tr>
<?php foreach ($it['atividades'] as $a): ?>
        <tr><td></td><td><?= h($a['descricao']) ?></td><td class="n"><?= n2($a['qtd']) ?></td><td><?= h($a['unidade']) ?></td><td class="n"><?= n2($a['peso']) ?></td><td class="n"><?= n2($a['valor'] ?? 0) ?></td></tr>
<?php endforeach; endforeach; ?>
      </tbody></table></div></details>
<?php if (!empty($bm['periodos'])): ?><p class="nota">Boletins já medidos: <?= implode(', ', array_map(function ($p) { return 'BM' . (int)$p['bm'] . ' (' . h($p['corte']) . ')'; }, $bm['periodos'])) ?>.</p><?php endif; ?>
    </section>

    <section class="bloco rv-sec"><h2>5 · Cronograma (previsto)</h2>
      <details><summary><?= n0($r['tarefas']) ?> tarefas · <?= h($r['inicio']) ?> a <?= h($r['fim']) ?></summary>
      <div class="tabela-rolagem"><table><thead><tr><th>Tarefa</th><th>Setor</th><th>Início</th><th>Fim</th><th class="n">Qtd</th><th class="n">Prod./dia</th><th>Atividade do BM sugerida</th></tr></thead><tbody>
<?php $lig = []; foreach ($cruz['tarefa_para_atividade'] as $l) { $lig[$l['tarefa']] = $l; }
foreach ($pacote['cronograma']['atividades'] as $t): $l = $lig[$t['nome']] ?? null; ?>
        <tr><td><?= h($t['nome']) ?></td><td><?= h($t['setor']) ?></td><td><?= h($t['inicio']) ?></td><td><?= h($t['fim']) ?></td><td class="n"><?= $t['qtd'] !== null ? n2($t['qtd']) : '' ?></td><td class="n"><?= $t['produtividade_dia'] !== null ? n2($t['produtividade_dia']) : '' ?></td><td><?= $l && $l['atividade'] ? h($l['item'] . ' · ' . $l['atividade']) : '<span class="rv-pend">sem par</span>' ?></td></tr>
<?php endforeach; ?>
      </tbody></table></div></details>
    </section>

    <section class="bloco rv-sec"><h2>6 · Telhas e projetos em PDF</h2>
      <p class="nota">Telhas do modelo: <b><?= n0($cruz['telhas']['conjuntos']) ?></b> peças · <b><?= n0($cruz['telhas']['area_m2']) ?> m²</b>. As pranchas indexadas ficam guardadas com o pacote para consulta.</p>
      <details><summary><?= n0(count($cruz['telhas']['por_produto'])) ?> famílias de telha · <?= n0($r['pranchas']) ?> pranchas</summary>
      <div class="tabela-rolagem"><table><thead><tr><th>Fase</th><th>Produto</th><th>Perfil</th><th class="n">Qtd</th><th class="n">m²</th><th class="n">Comp. total (m)</th></tr></thead><tbody>
<?php foreach ($cruz['telhas']['por_produto'] as $t): ?>
        <tr><td><?= h($t['fase']) ?></td><td><?= h($t['produto']) ?></td><td><?= h($t['perfil']) ?></td><td class="n"><?= n0($t['qtd']) ?></td><td class="n"><?= n1($t['area_m2']) ?></td><td class="n"><?= n1($t['comprimento_total_m']) ?></td></tr>
<?php endforeach; ?>
      </tbody></table>
      <div class="tabela-rolagem"><table><thead><tr><th>Prancha</th><th>Título</th><th>Rev.</th><th>Escala</th><th>Assuntos</th></tr></thead><tbody>
<?php foreach ($pacote['projetos']['pranchas'] as $pr): ?>
        <tr><td><?= h($pr['codigo'] ?: $pr['arquivo']) ?></td><td><?= h($pr['titulo']) ?></td><td><?= h($pr['revisao']) ?></td><td><?= h($pr['escala']) ?></td><td><?= h(implode(', ', $pr['assuntos'])) ?></td></tr>
<?php endforeach; ?>
      </tbody></table></div></div></details>
    </section>

    <section class="imp-rodape bloco">
      <div class="nota" id="pubStatus">Ao publicar, a obra sai da lista "Obras em importação" e abre normalmente.</div>
      <div class="imp-botoes">
        <button type="button" class="btn ghost" id="voltarDocs">← Voltar aos documentos</button>
        <button type="submit" class="btn primario" id="btnPublicar">Publicar obra →</button>
      </div>
    </section>
    </form>
<?php else: ?>
    <div class="imp-faixa">Nenhum pacote de leitura encontrado para esta obra.</div>
    <div class="imp-botoes"><button class="btn ghost" id="voltarDocs">← Voltar aos documentos</button></div>
<?php endif; ?>
  </main>
</div>
<style>
.imp-main { max-width: 1180px; }
.imp-faixa { margin: 14px 0; padding: 12px 16px; border-radius: 12px; background: #fffaeb; border: 1px solid #fedf89; color: #93370d; font-size: .88rem; }
.imp-faixa ul { margin: 6px 0 0; padding-left: 18px; }
.imp-botoes { display: flex; flex-wrap: wrap; gap: 10px; }
.imp-rodape { margin-top: 18px; padding: 18px 22px; display: flex; flex-wrap: wrap; gap: 14px; justify-content: space-between; align-items: center; border: 1px solid var(--portal-line, #e4e7ec); border-radius: 18px; background: #fff; }
.rv-cartoes { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; margin: 18px 0; }
.rv-cartoes div { background: #fff; border: 1px solid #e4e7ec; border-radius: 14px; padding: 14px 16px; display: flex; flex-direction: column; gap: 2px; }
.rv-cartoes b { font-size: 1.35rem; } .rv-cartoes span { font-size: .78rem; color: #667085; }
.rv-sec { margin: 18px 0; padding: 20px 22px; background: #fff; border: 1px solid #e4e7ec; border-radius: 18px; }
.rv-sec h2 { margin: 0 0 6px; font-size: 1.1rem; }
.rv-sec .nota { font-size: .84rem; color: #475467; margin: 4px 0 12px; }
.rv-sec table { width: 100%; border-collapse: collapse; font-size: .82rem; }
.rv-sec th, .rv-sec td { padding: 6px 8px; border-bottom: 1px solid #eaecf0; text-align: left; }
.rv-sec th { background: #f9fafb; position: sticky; top: 0; }
.rv-sec .n { text-align: right; font-variant-numeric: tabular-nums; }
.rv-sec tr.grupo td { background: #f2f4f7; }
.rv-sec summary { cursor: pointer; font-weight: 600; margin: 8px 0; }
.rv-sec .tabela-rolagem { max-height: 460px; overflow: auto; margin-top: 8px; }
.rv-form { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin-bottom: 12px; }
.rv-form label { display: flex; flex-direction: column; gap: 4px; font-size: .82rem; font-weight: 600; }
.rv-form input, .rv-sec select { padding: 8px 10px; border: 1px solid #d0d5dd; border-radius: 8px; font: inherit; font-weight: 400; }
.rv-pend { font-size: .72rem; font-weight: 700; color: #b54708; background: #fffaeb; padding: 2px 8px; border-radius: 999px; }
.rv-selo { font-size: .72rem; font-weight: 700; padding: 2px 8px; border-radius: 999px; background: #fffaeb; color: #b54708; }
.rv-selo.ok { background: #ecfdf3; color: #027a48; }
</style>
<script>
(function () {
  var CSRF = <?= json_encode($csrf) ?>, OBRA = <?= (int)$obraId ?>;
  function post(acao, dados) {
    var f = new URLSearchParams(Object.assign({ acao: acao, obra: OBRA, csrf: CSRF }, dados || {}));
    return fetch('obra_revisao.php', { method: 'POST', body: f }).then(function (r) { return r.json(); });
  }
  var leit = document.getElementById('leitura');
  if (leit) {
    var t0 = Date.now();
    setInterval(function () {
      leit.textContent = 'Lendo os documentos… ' + Math.round((Date.now() - t0) / 1000) + ' s';
      fetch('obra_revisao.php?acao=estado&obra=' + OBRA, { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) {
        if (j.importacao !== 'lendo' && j.importacao !== 'aguardando_leitura') location.reload();
      });
    }, 4000);
  }
  var voltar = document.getElementById('voltarDocs');
  if (voltar) voltar.addEventListener('click', function () { post('voltar_documentos').then(function (j) { if (j.destino) location.href = j.destino; }); });
  var de = document.getElementById('lerDeNovo');
  if (de) de.addEventListener('click', function () { post('ler_de_novo').then(function (j) { if (j.erro) alert(j.erro); else location.reload(); }); });
  var form = document.getElementById('formPublicar');
  if (form) form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var dados = new URLSearchParams(new FormData(form));
    dados.set('acao', 'publicar'); dados.set('obra', OBRA); dados.set('csrf', CSRF);
    var btn = document.getElementById('btnPublicar'); btn.disabled = true; btn.textContent = 'Publicando…';
    fetch('obra_revisao.php', { method: 'POST', body: dados }).then(function (r) { return r.json(); }).then(function (j) {
      if (j.ok) { document.getElementById('pubStatus').textContent = 'Obra publicada.'; location.href = j.destino; }
      else { alert(j.erro || 'Não foi possível publicar.'); btn.disabled = false; btn.textContent = 'Publicar obra →'; }
    }).catch(function () { alert('Falha de comunicação ao publicar.'); btn.disabled = false; btn.textContent = 'Publicar obra →'; });
  });
})();
</script>
</body></html>
