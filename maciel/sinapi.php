<?php
// Tabela SINAPI: importação da planilha mensal oficial da Caixa (administrador do sistema). Todas as empresas clientes pesquisam esses itens no orçamento.
require __DIR__ . '/inc/nucleo.php';
require __DIR__ . '/inc/modelo.php';
require __DIR__ . '/inc/central.php';
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

$eu = central_exigir();
if (($eu['perfil'] ?? '') !== 'admin') { http_response_code(403); exit('A importação da tabela SINAPI é do administrador do sistema.'); }
garantir_sinapi();
$msg = ''; $erro = ''; $resumo = [];
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    conferir_csrf();
    try {
        $acao = (string)($_POST['acao'] ?? '');
        if ($acao === 'importar') {
            if (empty($_FILES['planilha']['tmp_name']) || ($_FILES['planilha']['error'] ?? 0) !== UPLOAD_ERR_OK) {
                throw new InvalidArgumentException('Envie a planilha .xlsx da Caixa (se o arquivo é grande, o servidor pode ter recusado: tente enviar só uma planilha por vez).');
            }
            if (!preg_match('/\.xlsx$/i', (string)$_FILES['planilha']['name'])) { throw new InvalidArgumentException('O arquivo precisa ser .xlsx (SINAPI_Referência_AAAA_MM.xlsx).'); }
            $ref = trim((string)($_POST['ref'] ?? ''));
            $resumo = sinapi_importar($_FILES['planilha']['tmp_name'], (string)$_FILES['planilha']['name'], $ref, strtoupper((string)($_POST['uf'] ?? '')), (array)($_POST['regime'] ?? []), $eu);
            registrar_global('sinapi_importado', ['ref' => $ref, 'uf' => $_POST['uf'] ?? '', 'por' => $eu['login'] ?? '']);
            $msg = 'Importação concluída.';
        } elseif ($acao === 'excluir') {
            q_global('DELETE FROM sinapi_itens WHERE ref = ? AND uf = ? AND regime = ?', [(string)$_POST['ref'], (string)$_POST['uf'], (string)$_POST['regime']]);
            q_global('DELETE FROM sinapi_cargas WHERE ref = ? AND uf = ? AND regime = ?', [(string)$_POST['ref'], (string)$_POST['uf'], (string)$_POST['regime']]);
            $msg = 'Referência removida.';
        }
    } catch (InvalidArgumentException $e) { $erro = $e->getMessage(); }
    catch (Throwable $e) { $erro = 'Falha ao importar: ' . $e->getMessage(); }
}
$csrf = token_csrf();
$cargas = sinapi_cargas();
$ufs = sinapi_ufs();
central_topo('Tabela SINAPI', 'comercial', $eu, 'Painel comercial');
?>
<main class="ce-main">
  <section class="ce-hero"><div><span class="ce-eyebrow">PAINEL COMERCIAL · ADMINISTRADOR DO SISTEMA</span><h1>Tabela SINAPI</h1>
    <p>Importe a planilha mensal oficial da Caixa. Os preços vêm do arquivo — nada é digitado. Depois de importada, qualquer empresa cliente busca insumos e composições (inclusive de estrutura metálica) direto no orçamento.</p></div>
    <a class="btn ghost" href="comercial.php">← Painel comercial</a></section>
  <?php if ($msg): ?><div class="toast ok-faixa"><?= h($msg) ?></div><?php endif; ?>
  <?php if ($erro): ?><div class="toast erro-form"><?= h($erro) ?></div><?php endif; ?>
  <?php if ($resumo): ?><section class="ce-bloco"><h2>Resultado</h2><ul><?php foreach ($resumo as $l): ?><li><?= h($l) ?></li><?php endforeach; ?></ul></section><?php endif; ?>

  <section class="ce-bloco"><h2>Importar planilha da Caixa</h2>
    <p><b>Onde baixar:</b> no site da Caixa, em <i>SINAPI › Relatórios mensais</i>, baixe o arquivo <b>“SINAPI_Referência_AAAA_MM.xlsx”</b> do mês (traz as abas ISD/ICD/ISE de insumos e CSD/CCD/CSE de composições, com todos os estados). Importe <b>um estado por vez</b> — o do seu orçamento. O envio e a leitura levam alguns minutos.</p>
    <form method="post" enctype="multipart/form-data" class="ce-form"><input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="acao" value="importar">
      <label class="full">Planilha (.xlsx)<input type="file" name="planilha" accept=".xlsx" required></label>
      <label>Mês de referência<input type="month" name="ref" required value="<?= h(date('Y-m', strtotime('first day of last month'))) ?>"></label>
      <label>Estado (UF)<select name="uf"><?php foreach ($ufs as $u_): ?><option <?= $u_ === 'MG' ? 'selected' : '' ?>><?= h($u_) ?></option><?php endforeach; ?></select></label>
      <label class="full">Regimes a importar<span style="display:flex;gap:16px;flex-wrap:wrap;font-weight:400"><?php foreach (sinapi_regimes() as $k => $r): ?><label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" name="regime[]" value="<?= h($k) ?>" <?= $k === 'SD' ? 'checked' : '' ?> style="width:auto"> <?= h($r) ?></label><?php endforeach; ?></span></label>
      <div class="ce-acoes full"><button class="btn primario" type="submit" onclick="this.textContent='Importando… aguarde';">Importar</button></div>
    </form></section>

  <section class="ce-bloco"><h2>Referências importadas</h2>
    <?php if (!$cargas): ?><div class="ce-vazio">Nenhuma tabela importada ainda. Enquanto isso, o orçamento usa o catálogo próprio de estrutura metálica (sem preço).</div>
    <?php else: ?><table class="ce-tab"><thead><tr><th>Referência</th><th>Estado</th><th>Regime</th><th class="d">Insumos</th><th class="d">Composições</th><th>Importada por</th><th></th></tr></thead><tbody>
      <?php foreach ($cargas as $c): ?><tr><td><?= h(substr($c['ref'], 5) . '/' . substr($c['ref'], 0, 4)) ?></td><td><?= h($c['uf']) ?></td><td><?= h(sinapi_regimes()[$c['regime']] ?? $c['regime']) ?></td><td class="d"><?= h(number_format($c['insumos'], 0, ',', '.')) ?></td><td class="d"><?= h(number_format($c['composicoes'], 0, ',', '.')) ?></td><td><?= h($c['por']) ?> · <?= h($c['em']) ?></td>
        <td><form method="post" onsubmit="return confirm('Remover esta referência?')"><input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="acao" value="excluir"><input type="hidden" name="ref" value="<?= h($c['ref']) ?>"><input type="hidden" name="uf" value="<?= h($c['uf']) ?>"><input type="hidden" name="regime" value="<?= h($c['regime']) ?>"><button class="btn ghost ce-btn-peq">Remover</button></form></td></tr><?php endforeach; ?>
    </tbody></table><?php endif; ?></section>
</main></div></body></html>
