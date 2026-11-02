<?php
// Proposta comercial para o cliente: página pronta para imprimir ou salvar em PDF (Ctrl+P). Mostra só o preço de venda; custo direto, BDI e margem ficam internos.
require __DIR__ . '/inc/nucleo.php';
require __DIR__ . '/inc/modelo.php';
require __DIR__ . '/inc/central.php';
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

$eu = central_exigir();
$o = com_obter((int)($_GET['id'] ?? 0), $eu);
if (!$o) { http_response_code(404); exit('Proposta não encontrada.'); }
$c = com_calcular($o, com_itens($o['id']));
$org = com_org($eu) ? organizacao_ler(com_org($eu)) : null;
if (!$org && (int)$o['organizacao_id'] > 0) { $org = organizacao_ler((int)$o['organizacao_id']); }
$empresa = $org ? $org['nome'] : global_ler('nome_sistema', 'Núcleo de Obras');
$logo = $org ? '' : global_ler('logo', '');
$cor = cor_segura(global_ler('cor_primaria', '#d97706'), '#d97706');
$valida = date('d/m/Y', strtotime(($o['data_ref'] ?: date('Y-m-d')) . ' +' . (int)$o['validade_dias'] . ' days'));
$etapas = [];
foreach ($c['itens'] as $i => $it) { $e = trim((string)$it['etapa']) !== '' ? trim($it['etapa']) : 'Itens'; $etapas[$e][] = $it; }
$texto = function ($t) { return nl2br(h($t)); };
?><!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Proposta <?= h($o['numero']) ?> — <?= h($o['cliente']) ?></title><?= icones_html() ?>
<style>
:root{--cor:<?= h($cor) ?>} *{box-sizing:border-box} body{margin:0;background:#eef0f3;font:14px/1.5 -apple-system,Segoe UI,Inter,Arial,sans-serif;color:#1d2433}
.barra{position:sticky;top:0;background:#101828;color:#fff;padding:10px 20px;display:flex;gap:10px;align-items:center;justify-content:space-between;z-index:5}
.barra a,.barra button{background:#fff;color:#101828;border:0;border-radius:8px;padding:8px 16px;font-weight:700;cursor:pointer;text-decoration:none;font-size:14px}
.folha{max-width:880px;margin:20px auto;background:#fff;padding:46px 54px;box-shadow:0 2px 14px rgba(16,24,40,.12)}
.cab{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;border-bottom:4px solid var(--cor);padding-bottom:18px;margin-bottom:22px}
.cab img{max-height:56px;max-width:200px} .cab h1{margin:0;font-size:24px} .cab small{color:#667085}
.titulo{font-size:12px;letter-spacing:.1em;font-weight:800;color:var(--cor)} h2{font-size:15px;margin:26px 0 8px;padding-bottom:5px;border-bottom:1px solid #e4e7ec;text-transform:uppercase;letter-spacing:.04em}
.dados{display:grid;grid-template-columns:1fr 1fr;gap:6px 24px} .dados div span{display:block;color:#667085;font-size:11px;text-transform:uppercase;letter-spacing:.05em}
table{width:100%;border-collapse:collapse;font-size:13px} th{background:#f2f4f7;text-align:left;padding:7px 8px;font-size:11px;text-transform:uppercase;color:#475467} td{padding:7px 8px;border-bottom:1px solid #eaecf0;vertical-align:top}
.d{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums} tr.et td{background:#fafafa;font-weight:800;border-top:1px solid #d0d5dd} tr.sub td{font-weight:700;color:#475467}
.total{margin-top:14px;display:flex;justify-content:flex-end} .total div{background:var(--cor);color:#fff;padding:12px 22px;border-radius:10px;font-size:18px;font-weight:800}
.total small{display:block;font-size:11px;font-weight:600;opacity:.9}
.txt{white-space:normal;color:#344054} .ass{display:grid;grid-template-columns:1fr 1fr;gap:50px;margin-top:64px} .ass div{border-top:1px solid #101828;padding-top:6px;text-align:center;font-size:12px;color:#475467}
@media print{body{background:#fff}.barra{display:none}.folha{margin:0;box-shadow:none;max-width:none;padding:0}@page{size:A4;margin:16mm}tr{break-inside:avoid}h2{break-after:avoid}}
@media(max-width:640px){.folha{padding:24px 18px}.dados{grid-template-columns:1fr}.ass{grid-template-columns:1fr}}
</style></head><body>
<div class="barra"><span>Proposta <?= h($o['numero']) ?></span><span><a href="comercial.php?id=<?= (int)$o['id'] ?>">← Editar orçamento</a> <button onclick="window.print()">Imprimir / salvar PDF</button></span></div>
<div class="folha">
  <div class="cab"><div><div class="titulo">PROPOSTA COMERCIAL</div><h1><?= h($o['titulo']) ?></h1><small><?= h($o['numero']) ?> · <?= h(central_dt($o['data_ref'])) ?></small></div>
    <div style="text-align:right"><?php if ($logo): ?><img src="<?= h($logo) ?>" alt=""><?php endif; ?><div><b><?= h($empresa) ?></b></div></div></div>
  <div class="dados"><div><span>Cliente</span><b><?= h($o['cliente']) ?></b></div><div><span>Contato</span><?= h($o['contato'] ?: '—') ?><?= $o['telefone'] ? ' · ' . h($o['telefone']) : '' ?></div>
    <div><span>Local da obra</span><?= h($o['local_obra'] ?: '—') ?></div><div><span>E-mail</span><?= h($o['email'] ?: '—') ?></div>
    <div><span>Validade da proposta</span><?= h($valida) ?> (<?= (int)$o['validade_dias'] ?> dias)</div><div><span>Prazo de execução</span><?= $o['prazo_dias'] ? (int)$o['prazo_dias'] . ' dias' : 'a combinar' ?></div></div>
  <?php if (trim((string)$o['escopo']) !== ''): ?><h2>Escopo do fornecimento</h2><div class="txt"><?= $texto($o['escopo']) ?></div><?php endif; ?>
  <h2>Preços</h2>
  <table><thead><tr><th>Código</th><th>Descrição</th><th>Un</th><th class="d">Quantidade</th><th class="d">Preço unit. (R$)</th><th class="d">Total (R$)</th></tr></thead><tbody>
  <?php foreach ($etapas as $nome => $lista): $sub = 0; ?>
    <?php if (count($etapas) > 1 || $nome !== 'Itens'): ?><tr class="et"><td colspan="6"><?= h($nome) ?></td></tr><?php endif; ?>
    <?php foreach ($lista as $it): $sub += $it['venda']; ?>
      <tr><td><?= h($it['codigo']) ?></td><td><?= h($it['descricao']) ?></td><td><?= h($it['unidade']) ?></td><td class="d"><?= h(rtrim(rtrim(number_format((float)$it['quantidade'], 4, ',', '.'), '0'), ',')) ?></td>
        <td class="d"><?= h(number_format($it['preco_unit'], 2, ',', '.')) ?></td><td class="d"><?= h(number_format($it['venda'], 2, ',', '.')) ?></td></tr>
    <?php endforeach; ?>
    <?php if (count($etapas) > 1): ?><tr class="sub"><td colspan="5" class="d">Subtotal — <?= h($nome) ?></td><td class="d"><?= h(number_format($sub, 2, ',', '.')) ?></td></tr><?php endif; ?>
  <?php endforeach; ?></tbody></table>
  <div class="total"><div><small>VALOR TOTAL DA PROPOSTA</small><?= h(central_rs($c['total'])) ?></div></div>
  <?php foreach (['pagamento' => 'Condições de pagamento', 'exclusoes' => 'Itens não incluídos', 'observacoes' => 'Observações'] as $k => $t): if (trim((string)$o[$k]) === '') { continue; } ?>
    <h2><?= h($t) ?></h2><div class="txt"><?= $texto($o[$k]) ?></div>
  <?php endforeach; ?>
  <div class="ass"><div><?= h($empresa) ?></div><div><?= h($o['cliente']) ?> — de acordo</div></div>
</div></body></html>
