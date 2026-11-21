<?php
// Empresas e catálogo de serviços da obra: cadastro de empresa nova (no início ou com a obra em andamento), serviços da grade,
// catálogo de atividades por planilha e ADITIVOS DE CONTRATO (atividade nova ou aumento de quantidade), sem mexer no que já foi medido.
// Abre pelo botão "Empresas e catálogo" do cartão da obra (Central de obras) — vale para quem administra a obra, inclusive o administrador da empresa cliente.
require __DIR__ . '/inc/nucleo.php';
require __DIR__ . '/inc/empresas_obra.php';
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

if (!config()) { header('Location: instalar.php'); exit; }
$obraId = (int)($_GET['obra'] ?? ($_POST['obra'] ?? 0)) ?: obra_atual_id();   // sem ?obra (atalho do Financeiro): a obra aberta
$eu = exigir_admin_da_obra($obraId);
$obra = $obraId ? q_global("SELECT * FROM obras WHERE id = ? AND status = 'ativa'", [$obraId])->fetch() : null;
if (!$obra) { header('Location: obras.php'); exit; }
if (!empty($obra['origem_obra_id'])) { http_response_code(403); exit('Cadastre empresas e catálogos na obra principal.'); }
obra_override($obraId);   // só nesta requisição: a sessão continua na obra que o usuário tinha aberta

$msg = '';
$erro = '';
function bm_imp_planilha_sessao(array $obra)
{
    $pl = $_SESSION['bm_imp_planilha'] ?? null;
    if (!$pl || (int)$pl['obra'] !== (int)$obra['id'] || time() - (int)$pl['em'] > 7200) { throw new InvalidArgumentException('Envie a planilha de novo (a leitura anterior expirou).'); }
    return $pl;
}

// Pop-up "Importar orçamento" da aba Medição (BM): mesmas regras desta página, respondendo em JSON.
if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['ajax'] ?? '') === '1') {
    conferir_csrf();
    header('Content-Type: application/json; charset=utf-8');
    $acao = (string)($_POST['acao'] ?? '');
    try {
        $arq = (!empty($_FILES['planilha']['tmp_name']) && is_uploaded_file($_FILES['planilha']['tmp_name'])) ? $_FILES['planilha']['tmp_name'] : null;
        if ($arq && ($_FILES['planilha']['size'] ?? 0) > 15 * 1024 * 1024) { throw new InvalidArgumentException('A planilha passa de 15 MB.'); }
        $nomeArq = (string)($_FILES['planilha']['name'] ?? '');
        if ($arq && !preg_match('/\.(xlsx|xlsm|csv|txt)$/i', $nomeArq)) { throw new InvalidArgumentException('Envie a planilha em .xlsx, .xlsm ou .csv. Planilha .xls antiga: no Excel, Arquivo › Salvar como › Pasta de Trabalho do Excel (.xlsx).'); }
        $empId = (int)($_POST['empresa_id'] ?? 0);
        $emp = $empId ? q('SELECT * FROM empresas WHERE id = ?', [$empId])->fetch() : null;
        if ($empId && !$emp) { throw new InvalidArgumentException('Empresa não encontrada nesta obra.'); }
        if ($acao === 'dados') {
            $props = [];
            try { $props = eo_propostas_validas($obra, $eu); } catch (Throwable $e) { }
            $lista = array_map(function ($e) { return ['id' => (int)$e['id'], 'nome' => $e['nome'], 'atividades' => $e['atividades'], 'servicos' => $e['servicos'], 'prefixo' => eo_prefixo_da_empresa($e)]; }, eo_listar());
            echo json_encode(['ok' => true, 'empresas' => $lista, 'propostas' => array_map(function ($p) { return ['id' => (int)$p['id'], 'rotulo' => trim(($p['numero'] ?? ('ORC ' . $p['id'])) . ' — ' . ($p['cliente'] ?? '') . ' · ' . ($p['status'] === 'aprovada' ? 'aprovada' : 'enviada') . ' · R$ ' . number_format((float)$p['total'], 2, ',', '.') . ' · ' . (int)$p['n_itens'] . ' linha(s)')]; }, $props)], JSON_UNESCAPED_UNICODE);
            exit;
        }
        if ($acao === 'colunas') {
            // 1º passo da leitura: guarda a planilha na sessão e acha cabeçalho e colunas (descrição, peso, valor…)
            require_once __DIR__ . '/inc/bm_colunas.php';
            if ($arq) {
                $_SESSION['bm_imp_planilha'] = ['obra' => (int)$obra['id'], 'nome' => $nomeArq, 'abas' => bmc_abas($arq, $nomeArq), 'em' => time()];
            }
            $pl = bm_imp_planilha_sessao($obra);
            $abas = $pl['abas'];
            $salvos = (array)sistema_ler('bm_mapa_colunas', []);
            $salvo = (array)($salvos[$emp ? $emp['nome'] : '_ultimo'] ?? ($salvos['_ultimo'] ?? []));
            $ia = isset($_POST['aba']) && $_POST['aba'] !== '' ? max(0, min(count($abas) - 1, (int)$_POST['aba'])) : null;
            if ($ia === null) {   // aba com o melhor cabeçalho
                $ia = 0; $mn = -1;
                foreach ($abas as $k => $a) { $sg = bmc_sugerir($a['linhas'], $salvo); if ($sg['nota'] > $mn) { $mn = $sg['nota']; $ia = $k; } }
            }
            $linhas = $abas[$ia]['linhas'];
            $sug = bmc_sugerir($linhas, $salvo);
            $cab = isset($_POST['linha']) && $_POST['linha'] !== '' ? max(0, (int)$_POST['linha'] - 1) : (int)($sug['linha'] ?? 0);
            if (isset($_POST['linha']) && $_POST['linha'] !== '') {   // linha escolhida à mão: sugere as colunas dela
                $sg = bmc_sugerir([$cab => $linhas[$cab] ?? []], $salvo);
                $sug['cols'] = $sg['cols'];
            }
            $amostra = [];
            foreach (array_slice($linhas, $cab + 1, 12) as $l) { $amostra[] = array_map(function ($c) { return mb_substr(lt_texto($c), 0, 60); }, (array)$l); }
            echo json_encode(['ok' => true, 'arquivo' => $pl['nome'], 'abas' => array_column($abas, 'nome'), 'aba' => $ia, 'linha' => $cab + 1,
                'achou' => $sug['linha'] !== null, 'cols' => $sug['cols'], 'colunas' => bmc_colunas_info($linhas, $cab), 'amostra' => $amostra], JSON_UNESCAPED_UNICODE);
            exit;
        }
        if ($acao === 'previa') {
            require_once __DIR__ . '/inc/bm_colunas.php';
            $nome = $emp ? $emp['nome'] : eo_nome_valido($_POST['nome'] ?? '');
            $prefixo = eo_prefixo($_POST['prefixo'] ?? '', $nome);
            $pl = bm_imp_planilha_sessao($obra);
            $ia = max(0, min(count($pl['abas']) - 1, (int)($_POST['aba'] ?? 0)));
            $linhas = $pl['abas'][$ia]['linhas'];
            $cab = max(0, (int)($_POST['linha'] ?? 1) - 1);
            $col = [];
            foreach (BMC_CAMPOS as $c) { $v = $_POST['col_' . $c] ?? ''; $col[$c] = $v === '' ? null : (int)$v; }
            $usados = array_filter($col, function ($v) { return $v !== null; });
            if (count($usados) !== count(array_unique($usados))) { throw new InvalidArgumentException('A mesma coluna foi escolhida para dois campos.'); }
            $total = trim((string)($_POST['contrato_total'] ?? '')) !== '' ? eo_numero($_POST['contrato_total']) : null;
            $leitura = bmc_montar($linhas, $cab, $col, $total);
            $previa = eo_previa_planilha($leitura, $prefixo, $emp ? $emp['nome'] : null);
            $token = bin2hex(random_bytes(12));   // "Gerar" usa exatamente esta leitura
            $_SESSION['bm_imp_leitura'] = [$token => ['obra' => (int)$obra['id'], 'o' => $leitura, 'em' => time()]];
            $titulos = [];   // lembra os nomes das colunas para a próxima planilha desta empresa
            foreach ($col as $c => $j) { if ($j !== null) { $titulos[$c] = lt_texto($linhas[$cab][$j] ?? ''); } }
            $salvos = (array)sistema_ler('bm_mapa_colunas', []);
            $salvos[$nome] = $titulos; $salvos['_ultimo'] = $titulos;
            sistema_gravar('bm_mapa_colunas', $salvos);
            echo json_encode(['ok' => true, 'token' => $token] + $previa, JSON_UNESCAPED_UNICODE);
            exit;
        }
        if ($acao === 'aplicar') {
            $modo = ($_POST['modo'] ?? '') === 'proposta' ? 'proposta' : 'planilha';
            if ($modo === 'planilha') {
                $g = $_SESSION['bm_imp_leitura'][(string)($_POST['token'] ?? '')] ?? null;
                if (!$g || (int)$g['obra'] !== (int)$obra['id'] || time() - (int)$g['em'] > 7200) { throw new InvalidArgumentException('A leitura expirou. Leia o documento de novo.'); }
                $arq = $g['o'];
            }
            if ($emp) {
                $pref = eo_prefixo($_POST['prefixo'] ?? '', $emp['nome']);
                $r = eo_transacao(function () use ($emp, $arq, $obra, $eu, $modo, $pref) {
                    return $modo === 'proposta'
                        ? eo_importar_proposta((int)$emp['id'], $emp['nome'], $pref, (int)($_POST['orc_id'] ?? 0), $obra, $eu, !empty($_POST['criar_colunas']))
                        : eo_importar_catalogo((int)$emp['id'], $emp['nome'], $pref, $arq, !empty($_POST['criar_colunas']), !empty($_POST['importar_cortes']));
                });
                $r['empresa'] = $emp['nome'];
            } else {
                $r = eo_transacao(function () use ($arq, $obra, $eu, $modo) { return eo_criar_empresa(array_merge($_POST, ['modo' => $modo, '_obra' => $obra, '_usuario' => $eu]), $arq); });
            }
            unset($_SESSION['bm_imp_leitura'], $_SESSION['bm_imp_planilha']);
            registrar_alteracao('catalogo_importado_bm', ['empresa' => $r['empresa'] ?? '', 'atividades' => $r['atividades'] ?? 0, 'modo' => $modo, 'leitor' => is_array($arq) ? ($arq['leitor'] ?? '') : '']);
            echo json_encode(['ok' => true, 'resumo' => $r], JSON_UNESCAPED_UNICODE);
            exit;
        }
        throw new InvalidArgumentException('Ação inválida.');
    } catch (InvalidArgumentException $e) {
        http_response_code(400);
        echo json_encode(['ok' => false, 'erro' => $e->getMessage()], JSON_UNESCAPED_UNICODE);
    } catch (Throwable $e) {
        http_response_code(500);
        echo json_encode(['ok' => false, 'erro' => 'Falha: ' . $e->getMessage()], JSON_UNESCAPED_UNICODE);
    }
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    conferir_csrf();
    $acao = (string)($_POST['acao'] ?? '');
    try {
        $arq = (!empty($_FILES['planilha']['tmp_name']) && is_uploaded_file($_FILES['planilha']['tmp_name'])) ? $_FILES['planilha']['tmp_name'] : null;
        if ($arq && ($_FILES['planilha']['size'] ?? 0) > 15 * 1024 * 1024) { throw new InvalidArgumentException('A planilha passa de 15 MB.'); }
        if ($acao === 'eo_criar') {
            $r = eo_transacao(function () use ($arq, $obra, $eu) { return eo_criar_empresa(array_merge($_POST, ['_obra' => $obra, '_usuario' => $eu]), $arq); });
            registrar_alteracao('empresa_criada', $r);
            $msg = 'Empresa ' . $r['empresa'] . ' cadastrada: ' . $r['servicos'] . ' serviço(s) de produção, ' . $r['atividades'] . ' atividade(s) no catálogo e ' . $r['periodos'] . ' corte(s) de BM.' . ($r['avisos'] ? ' ' . implode(' ', $r['avisos']) : '');
        } elseif ($acao === 'eo_servico_novo') {
            $col = eo_transacao(function () { return eo_servico_criar((int)($_POST['empresa_id'] ?? 0), $_POST['nome'] ?? '', $_POST['frente'] ?? null, $_POST['escopo'] ?? null); });
            registrar_alteracao('servico_criado', ['empresa_id' => (int)($_POST['empresa_id'] ?? 0), 'nome' => $_POST['nome'] ?? '']);
            $msg = 'Serviço cadastrado na coluna ' . $col . ' da grade de Lançamentos.';
        } elseif ($acao === 'eo_servico_salvar') {
            eo_transacao(function () { eo_servico_salvar((int)($_POST['servico_id'] ?? 0), $_POST['nome'] ?? '', $_POST['frente'] ?? '', $_POST['escopo'] ?? null); });
            registrar_alteracao('servico_alterado', ['id' => (int)($_POST['servico_id'] ?? 0)]);
            $msg = 'Serviço atualizado.';
        } elseif ($acao === 'eo_servico_excluir') {
            eo_transacao(function () { eo_servico_excluir((int)($_POST['servico_id'] ?? 0)); });
            registrar_alteracao('servico_excluido', ['id' => (int)($_POST['servico_id'] ?? 0)]);
            $msg = 'Serviço excluído.';
        } elseif ($acao === 'eo_importar') {
            $emp = eo_empresa((int)($_POST['empresa_id'] ?? 0));
            $r = eo_transacao(function () use ($emp, $arq) { return eo_importar_catalogo((int)$emp['id'], $emp['nome'], eo_prefixo($_POST['prefixo'] ?? '', $emp['nome']), $arq, !empty($_POST['criar_colunas']), !empty($_POST['importar_cortes'])); });
            registrar_alteracao('catalogo_importado', ['empresa' => $emp['nome'], 'atividades' => $r['atividades']]);
            $msg = $r['atividades'] . ' atividade(s) acrescentadas ao catálogo de ' . $emp['nome'] . ($r['servicos'] ? ', com ' . $r['servicos'] . ' coluna(s) de produção' : '') . '.' . ($r['avisos'] ? ' ' . implode(' ', array_slice($r['avisos'], 0, 4)) : '');
        } elseif ($acao === 'eo_importar_proposta') {
            $emp = eo_empresa((int)($_POST['empresa_id'] ?? 0));
            $r = eo_transacao(function () use ($emp, $obra, $eu) { return eo_importar_proposta((int)$emp['id'], $emp['nome'], eo_prefixo($_POST['prefixo'] ?? '', $emp['nome']), (int)($_POST['orc_id'] ?? 0), $obra, $eu, !empty($_POST['criar_colunas'])); });
            registrar_alteracao('catalogo_proposta', ['empresa' => $emp['nome'], 'atividades' => $r['atividades']]);
            $msg = $r['atividades'] . ' atividade(s) da proposta acrescentadas ao catálogo de ' . $emp['nome'] . '. ' . implode(' ', array_slice($r['avisos'], 0, 4));
        } elseif ($acao === 'eo_excluir') {
            $emp = eo_empresa((int)($_POST['empresa_id'] ?? 0));
            if (eo_maiusculas($_POST['confirmar'] ?? '') !== eo_maiusculas($emp['nome'])) { throw new InvalidArgumentException('Digite o nome da empresa para confirmar a exclusão.'); }
            eo_transacao(function () use ($emp) { eo_excluir_empresa((int)$emp['id']); });
            registrar_alteracao('empresa_excluida', ['empresa' => $emp['nome']]);
            $msg = 'Empresa ' . $emp['nome'] . ' excluída (ainda não tinha lançamentos).';
        } elseif ($acao === 'eo_aditivo') {
            $empId = (int)($_POST['empresa_id'] ?? 0);
            $linhas = [];
            foreach ((array)($_POST['atividade'] ?? []) as $k => $nomeL) {
                $linhas[] = ['atividade' => $nomeL, 'unidade' => $_POST['unidade'][$k] ?? '', 'qtd' => $_POST['qtd'][$k] ?? '', 'valor' => $_POST['valor'][$k] ?? '', 'origem' => $_POST['origem'][$k] ?? ''];
            }
            $r = eo_transacao(function () use ($empId, $linhas) { return eo_aditivo($empId, ['data' => $_POST['data'] ?? '', 'motivo' => $_POST['motivo'] ?? '', 'valor_cliente' => $_POST['valor_cliente'] ?? '', 'criar_colunas' => !empty($_POST['criar_colunas']), 'linhas' => $linhas]); });
            registrar_alteracao('aditivo_contrato', ['empresa_id' => $empId, 'aditivo' => $r['aditivo'], 'item' => $r['item'], 'valor' => $r['valor']]);
            $msg = 'Aditivo nº ' . $r['aditivo'] . ' registrado como item ' . $r['item'] . ' (' . $r['atividades'] . ' atividade(s), R$ ' . number_format($r['valor'], 2, ',', '.') . '). Ele aparece separado em Lançamentos e em Medição (BM); o que já foi medido não mudou.';
        } else {
            throw new InvalidArgumentException('Ação inválida.');
        }
    } catch (InvalidArgumentException $e) {
        $erro = $e->getMessage();
    } catch (Throwable $e) {
        $erro = 'Falha: ' . $e->getMessage();
    }
}

$empresas = eo_listar();
$propostas = (function () use ($obra, $eu) { try { return eo_propostas_validas($obra, $eu); } catch (Throwable $e) { return []; } })();
$aditivos = array_values(array_filter(eo_aditivos_ler(), function ($a) { return true; }));
$aditivoPorEmpresa = [];
foreach ($aditivos as $a) { $aditivoPorEmpresa[$a['empresa']] = ($aditivoPorEmpresa[$a['empresa']] ?? 0) + (float)($a['valor'] ?? 0); }
$catalogo = [];   // para o formulário de aditivo: itens e atividades de cada empresa
foreach ($empresas as $e) {
    $itens = [];
    foreach (q('SELECT * FROM bm_atividades WHERE empresa = ? ORDER BY item, codigo', [$e['nome']])->fetchAll() as $a) {
        $i = $a['item'];
        if (!isset($itens[$i])) { $itens[$i] = ['item' => $i, 'desc' => $a['item_desc'], 'valor' => 0.0, 'ativs' => []]; }
        $itens[$i]['valor'] = max($itens[$i]['valor'], (float)$a['valor_rotula']);
        $itens[$i]['ativs'][] = ['codigo' => $a['codigo'], 'nome' => $a['atividade'], 'un' => $a['unidade'], 'qtd' => (float)$a['qtd']];
    }
    $catalogo[(int)$e['id']] = array_values($itens);
}
$totalContrato = array_sum(array_column($empresas, 'valor'));
$totalAdit = array_sum($aditivoPorEmpresa);
$csrf = token_csrf();
$logoGlobal = global_ler('logo', '');
function oe_rs($v) { return 'R$ ' . number_format((float)$v, 2, ',', '.'); }
function oe_dt($d) { return $d ? implode('/', array_reverse(explode('-', substr((string)$d, 0, 10)))) : '—'; }
pagina_inicio('Empresas e catálogo');
?>
<link rel="stylesheet" href="planos.css?v=<?= (int)@filemtime(__DIR__ . '/planos.css') ?>">
<div class="portal-shell">
  <header class="portal-topo">
    <div class="portal-brand">
      <?php if ($logoGlobal): ?><img src="<?= h($logoGlobal) ?>" alt="Logo"><?php else: ?><span class="brand-mark">NO</span><?php endif; ?>
      <div><strong><?= h(global_ler('nome_sistema', 'Núcleo de Obras')) ?></strong><small><?= h($obra['nome']) ?></small></div>
    </div>
    <div class="portal-user"><span>Olá, <?= h(usuario_rotulo_empresa($eu)) ?></span><a class="btn ghost" href="obras.php">← Central de obras</a></div>
  </header>
  <main class="pl-shell">
    <section class="pl-hero"><span class="eyebrow">EMPRESAS E CATÁLOGO DE SERVIÇOS</span><h1><?= h($obra['nome']) ?></h1>
      <p>Cadastre as empresas que executam esta obra, os serviços de cada uma e o catálogo de atividades da medição. Com a obra em andamento, use o <b>aditivo</b> para acrescentar atividade ou quantidade: o que já foi lançado e medido não muda.</p></section>
    <?php if ($msg): ?><div class="pl-toast ok"><?= h($msg) ?></div><?php endif; ?>
    <?php if ($erro): ?><div class="pl-toast erro"><?= h($erro) ?></div><?php endif; ?>

    <section class="pl-kpis">
      <div class="pl-kpi azul"><small>Empresas</small><b><?= count($empresas) ?></b><span>nesta obra</span></div>
      <div class="pl-kpi"><small>Contrato dos catálogos</small><b style="font-size:1.25rem"><?= h(oe_rs($totalContrato)) ?></b><span>soma das empresas (já com aditivos)</span></div>
      <div class="pl-kpi verde"><small>Aditivos registrados</small><b style="font-size:1.25rem"><?= h(oe_rs($totalAdit)) ?></b><span><?= count($aditivos) ?> aditivo(s)</span></div>
    </section>

    <section class="pl-caixa">
      <div class="pl-cab"><div><h2>Empresas da obra</h2><p style="margin:0">Cada empresa tem aba própria em Lançamentos e catálogo próprio na Medição (BM).</p></div>
        <div class="pl-acoes"><button class="btn primario" id="btnNovaEmpresa">+ Nova empresa</button></div></div>
      <table class="pl-tab"><thead><tr><th>Empresa</th><th class="n">Serviços</th><th class="n">Atividades</th><th class="n">Contrato (catálogo)</th><th class="n">Aditivos</th><th class="n">Lançamentos</th><th></th></tr></thead><tbody>
      <?php foreach ($empresas as $e): $ad = $aditivoPorEmpresa[$e['nome']] ?? 0; ?>
        <tr><td><b><?= h($e['nome']) ?></b></td><td class="n"><?= (int)$e['servicos'] ?></td><td class="n"><?= (int)$e['atividades'] ?></td>
          <td class="n"><?= h(oe_rs($e['valor'])) ?></td><td class="n"><?= $ad > 0 ? h(oe_rs($ad)) : '—' ?></td><td class="n"><?= (int)$e['lancamentos'] ?></td>
          <td><div class="pl-acoes">
            <button class="btn primario" data-aditivo="<?= (int)$e['id'] ?>" data-nome="<?= h($e['nome']) ?>">Aditivo</button>
            <button class="btn" data-dlg="dlgServ<?= (int)$e['id'] ?>">Serviços da grade</button>
            <button class="btn" data-dlg="dlgImp<?= (int)$e['id'] ?>">Importar planilha</button>
            <button class="btn" data-dlg="dlgDel<?= (int)$e['id'] ?>">Excluir</button></div></td></tr>
      <?php endforeach; ?>
      <?php if (!$empresas): ?><tr><td colspan="7"><small>Nenhuma empresa cadastrada ainda. Use “+ Nova empresa”.</small></td></tr><?php endif; ?>
      </tbody></table>
    </section>

    <section class="pl-caixa">
      <h2>Aditivos do contrato</h2>
      <p>Histórico de tudo o que foi acrescentado depois do contrato original. Cada aditivo vira um item próprio no catálogo (ADT01, ADT02…).</p>
      <table class="pl-tab" style="min-width:760px"><thead><tr><th>Nº</th><th>Data</th><th>Empresa</th><th>O que mudou</th><th class="n">Valor (R$)</th><th>Motivo</th><th>Registrado por</th></tr></thead><tbody>
      <?php foreach (array_reverse($aditivos) as $a): ?>
        <tr><td><?= (int)$a['id'] ?></td><td><?= h(oe_dt($a['data'])) ?></td><td><?= h($a['empresa']) ?></td>
          <td><b>Item <?= h($a['item']) ?></b><?php foreach ($a['atividades'] ?? [] as $x): ?><br><small><?= h($x['codigo']) ?> · <?= h($x['atividade']) ?> — <?= h(rtrim(rtrim(number_format((float)$x['qtd'], 3, ',', '.'), '0'), ',')) ?> <?= h($x['unidade']) ?> · <?= h(oe_rs($x['valor'])) ?><?= !empty($x['origem']) ? ' · complementa ' . h($x['origem']) : '' ?></small><?php endforeach; ?></td>
          <td class="n"><?= h(oe_rs($a['valor'])) ?></td><td><?= h($a['motivo']) ?></td><td><small><?= h($a['por']) ?> · <?= h(oe_dt($a['em'])) ?></small></td></tr>
      <?php endforeach; ?>
      <?php if (!$aditivos): ?><tr><td colspan="7"><small>Nenhum aditivo registrado.</small></td></tr><?php endif; ?>
      </tbody></table>
      <p class="pl-nota">Para editar atividade por atividade (quantidade, peso, valor, coluna de produção) abra a obra e use Financeiro › Medição (BM) › Catálogo de atividades. Como funciona: cada aditivo cria um <b>item novo</b> (ADT01, ADT02…) no catálogo da empresa, sem alterar nenhum item, peso, quantidade ou valor que já existia. Por isso os BMs já fechados, a medição em aberto, os lançamentos e os apontamentos continuam exatamente como estão, e o aditivo é lançado e medido <b>separado</b> do contrato original (coluna própria em Lançamentos, item próprio na Medição). Aumento de quantidade de uma atividade existente = atividade nova do aditivo, ligada à original.</p>
    </section>
  </main>
</div>

<?php // ---- janelas ----?>
<dialog class="pl-dlg" id="dlgNova"><form method="post" enctype="multipart/form-data"><input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="obra" value="<?= (int)$obraId ?>"><input type="hidden" name="acao" value="eo_criar">
  <h3>Nova empresa e catálogo de serviços</h3>
  <div class="pl-form"><label>Nome da empresa<input name="nome" required maxlength="30" autocomplete="off" placeholder="Aparece nas abas e no BM"></label>
    <label>Prefixo dos códigos (opcional)<input name="prefixo" maxlength="10" autocomplete="off" placeholder="ex.: ABC → ABC-3.1.1-01"></label>
    <fieldset class="pl-fs" style="grid-column:1/-1;border:0;padding:0"><legend>Como montar o catálogo?</legend>
      <label class="pl-check"><input type="radio" name="modo" value="planilha" checked> Importar a planilha de orçamento/medição da empresa (.xlsx)</label>
      <label style="margin-left:30px">Planilha<input type="file" name="planilha" accept=".xlsx"></label>
      <label class="pl-check" style="margin-left:30px"><input type="checkbox" name="criar_colunas" value="1" checked> Criar uma coluna de produção para cada atividade</label>
      <label class="pl-check" style="margin-left:30px"><input type="checkbox" name="importar_cortes" value="1"> Importar as datas de corte dos BMs</label>
      <?php if ($empresas): ?>
      <label class="pl-check"><input type="radio" name="modo" value="copiar"> Copiar serviços e catálogo de outra empresa (e ajustar depois)</label>
      <label style="margin-left:30px">Copiar de<select name="origem"><?php foreach ($empresas as $e): ?><option value="<?= (int)$e['id'] ?>"><?= h($e['nome']) ?></option><?php endforeach; ?></select></label>
      <label class="pl-check" style="margin-left:30px"><input type="checkbox" name="copiar_cortes" value="1" checked> Copiar também as datas de corte dos BMs</label>
      <?php endif; ?>
      <?php if ($propostas): ?>
      <label class="pl-check"><input type="radio" name="modo" value="proposta"> Usar uma proposta comercial válida (aprovada ou enviada dentro da validade)</label>
      <label style="margin-left:30px">Proposta<select name="orc_id"><?php foreach ($propostas as $pp): ?><option value="<?= (int)$pp['id'] ?>"><?= h($pp['numero'] . ' — ' . $pp['titulo'] . ' · R$ ' . number_format((float)$pp['total'], 2, ',', '.') . ($pp['status'] === 'aprovada' ? ' · aprovada' : ' · enviada')) ?></option><?php endforeach; ?></select></label>
      <?php endif; ?>
      <label class="pl-check"><input type="radio" name="modo" value="vazia"> Só a empresa — cadastro serviços e atividades depois</label>
    </fieldset></div>
  <p class="pl-nota">A planilha é a mesma da importação da obra (itens do BM, atividades com quantidade, unidade, % de valor e peso). Valores em R$ ficam com centavos.</p>
  <div class="pl-fim"><button type="button" class="btn" data-fechar>Cancelar</button><button class="btn primario">Cadastrar empresa</button></div></form></dialog>

<dialog class="pl-dlg" id="dlgAdit" style="width:min(860px,calc(100vw - 24px))"><form method="post"><input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="obra" value="<?= (int)$obraId ?>"><input type="hidden" name="acao" value="eo_aditivo"><input type="hidden" name="empresa_id" value="0">
  <h3 id="aditTit">Aditivo de contrato</h3>
  <p class="pl-nota" style="margin-top:0">O aditivo vira um <b>item novo</b> no catálogo (ADT…), medido e lançado separado do contrato original. Para <b>aumentar a quantidade</b> de uma atividade que já existe, escolha-a em “Complementa” — a atividade nova é do aditivo.</p>
  <div class="pl-form">
    <label>Data do aditivo<input type="date" name="data" value="<?= h(date('Y-m-d')) ?>"></label>
    <label>Motivo / nº do aditivo contratual<input name="motivo" required maxlength="120" placeholder="ex.: Aditivo 02 — marquise da portaria"></label>
    <label>Valor para o cliente (R$, opcional)<input name="valor_cliente" inputmode="decimal" placeholder="vazio = igual ao valor da empresa"></label>
    <label class="pl-check"><input type="checkbox" name="criar_colunas" value="1" checked> Criar uma coluna de produção para cada atividade</label>
  </div>
  <table class="pl-tab" style="min-width:0;margin-top:10px"><thead><tr><th>Complementa (opcional)</th><th>Atividade do aditivo</th><th>Unid.</th><th class="n">Quantidade</th><th class="n">Valor (R$)</th><th></th></tr></thead><tbody id="aditLinhas"></tbody></table>
  <div style="margin-top:8px"><button type="button" class="btn" id="aditMais">+ Atividade</button></div>
  <p class="pl-nota" id="aditPrevia"></p>
  <div class="pl-fim"><button type="button" class="btn" data-fechar>Cancelar</button><button class="btn primario">Registrar aditivo</button></div></form></dialog>

<?php foreach ($empresas as $e): ?>
<dialog class="pl-dlg" id="dlgServ<?= (int)$e['id'] ?>" style="width:min(900px,calc(100vw - 24px))">
  <h3>Serviços da grade — <?= h($e['nome']) ?></h3>
  <p class="pl-nota" style="margin-top:0">Cada serviço é uma coluna da grade de Lançamentos. Excluir só é possível sem produção lançada.</p>
  <?php foreach ($e['lista_servicos'] as $sv): ?>
  <form method="post" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:6px">
    <input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="obra" value="<?= (int)$obraId ?>"><input type="hidden" name="servico_id" value="<?= (int)$sv['id'] ?>">
    <span class="pl-chip cinza" title="Coluna na grade"><?= h($sv['col']) ?></span>
    <input name="nome" value="<?= h($sv['nome']) ?>" required maxlength="120" style="flex:2;min-width:180px;padding:8px;border:1px solid #e4e7ec;border-radius:8px">
    <input name="frente" value="<?= h((string)$sv['frente']) ?>" placeholder="Frente" maxlength="120" style="flex:1;min-width:110px;padding:8px;border:1px solid #e4e7ec;border-radius:8px">
    <input name="escopo" value="<?= h($sv['escopo'] === null ? '' : (string)$sv['escopo']) ?>" placeholder="Escopo" inputmode="decimal" style="width:90px;padding:8px;border:1px solid #e4e7ec;border-radius:8px">
    <button class="btn" name="acao" value="eo_servico_salvar">Salvar</button>
    <button class="btn" name="acao" value="eo_servico_excluir" onclick="return confirm('Excluir este serviço?')">Excluir</button>
  </form>
  <?php endforeach; ?>
  <?php if (!$e['lista_servicos']): ?><p class="pl-nota">Nenhum serviço ainda.</p><?php endif; ?>
  <form method="post" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:10px">
    <input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="obra" value="<?= (int)$obraId ?>"><input type="hidden" name="acao" value="eo_servico_novo"><input type="hidden" name="empresa_id" value="<?= (int)$e['id'] ?>">
    <input name="nome" placeholder="+ Novo serviço" required maxlength="120" style="flex:2;min-width:180px;padding:8px;border:1px solid #e4e7ec;border-radius:8px"><input name="frente" placeholder="Frente" maxlength="120" style="flex:1;min-width:110px;padding:8px;border:1px solid #e4e7ec;border-radius:8px"><input name="escopo" placeholder="Escopo" inputmode="decimal" style="width:90px;padding:8px;border:1px solid #e4e7ec;border-radius:8px">
    <button class="btn primario">Adicionar</button></form>
  <div class="pl-fim"><button type="button" class="btn" data-fechar>Fechar</button></div></dialog>

<dialog class="pl-dlg" id="dlgImp<?= (int)$e['id'] ?>"><form method="post" enctype="multipart/form-data"><input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="obra" value="<?= (int)$obraId ?>"><input type="hidden" name="acao" value="eo_importar"><input type="hidden" name="empresa_id" value="<?= (int)$e['id'] ?>">
  <h3>Importar atividades — <?= h($e['nome']) ?></h3>
  <p class="pl-nota" style="margin-top:0">Planilha de orçamento/medição no mesmo formato da importação da obra. Atividades com código repetido são ignoradas. Para acrescentar valor a um item já medido use o <b>Aditivo</b> (a importação não redistribui pesos).</p>
  <div class="pl-form"><label>Planilha (.xlsx)<input type="file" name="planilha" accept=".xlsx" required></label><label>Prefixo dos códigos<input name="prefixo" maxlength="10" placeholder="<?= h(eo_prefixo_da_empresa($e)) ?>" value="<?= h(eo_prefixo_da_empresa($e)) ?>"></label>
    <label class="pl-check"><input type="checkbox" name="criar_colunas" value="1" checked> Criar uma coluna de produção para cada atividade</label>
    <label class="pl-check"><input type="checkbox" name="importar_cortes" value="1"> Importar também as datas de corte dos BMs</label></div>
  <div class="pl-fim"><button type="button" class="btn" data-fechar>Cancelar</button><button class="btn primario">Importar</button></div></form>
  <?php if ($propostas): ?>
  <form method="post" style="margin-top:14px;border-top:1px solid #eaecf0;padding-top:12px"><input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="obra" value="<?= (int)$obraId ?>"><input type="hidden" name="acao" value="eo_importar_proposta"><input type="hidden" name="empresa_id" value="<?= (int)$e['id'] ?>"><input type="hidden" name="prefixo" value="<?= h(eo_prefixo_da_empresa($e)) ?>">
    <h3 style="margin-top:0">…ou usar uma proposta comercial válida</h3>
    <div class="pl-form"><label>Proposta<select name="orc_id"><?php foreach ($propostas as $pp): ?><option value="<?= (int)$pp['id'] ?>"><?= h($pp['numero'] . ' — ' . $pp['titulo'] . ' · R$ ' . number_format((float)$pp['total'], 2, ',', '.')) ?></option><?php endforeach; ?></select></label>
      <label class="pl-check"><input type="checkbox" name="criar_colunas" value="1" checked> Criar uma coluna de produção para cada atividade</label></div>
    <div class="pl-fim"><button class="btn primario">Importar a proposta</button></div></form>
  <?php endif; ?></dialog>

<dialog class="pl-dlg" id="dlgDel<?= (int)$e['id'] ?>"><form method="post"><input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="obra" value="<?= (int)$obraId ?>"><input type="hidden" name="acao" value="eo_excluir"><input type="hidden" name="empresa_id" value="<?= (int)$e['id'] ?>">
  <h3>Excluir <?= h($e['nome']) ?></h3>
  <p class="pl-nota" style="margin-top:0">Só é possível enquanto a empresa não tem nenhum lançamento. Apaga serviços, catálogo e cortes de BM. Digite o nome da empresa para confirmar.</p>
  <div class="pl-form"><label>Nome da empresa<input name="confirmar" required autocomplete="off" placeholder="<?= h($e['nome']) ?>"></label></div>
  <div class="pl-fim"><button type="button" class="btn" data-fechar>Cancelar</button><button class="btn primario">Excluir empresa</button></div></form></dialog>
<?php endforeach; ?>

<script>
(function () {
  var CAT = <?= json_encode($catalogo, JSON_UNESCAPED_UNICODE) ?>;
  var $ = function (s) { return document.querySelector(s); };
  var rs = function (v) { return 'R$ ' + (Math.round(v * 100) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  var num = function (t) { t = String(t || '').trim(); if (!t) return null; var n = parseFloat(t.indexOf(',') >= 0 ? t.replace(/\./g, '').replace(',', '.') : t); return isFinite(n) ? n : null; };
  document.querySelectorAll('[data-fechar]').forEach(function (b) { b.addEventListener('click', function () { b.closest('dialog').close(); }); });
  document.querySelectorAll('[data-dlg]').forEach(function (b) { b.addEventListener('click', function () { document.getElementById(b.dataset.dlg).showModal(); }); });
  $('#btnNovaEmpresa').addEventListener('click', function () { $('#dlgNova').showModal(); });
  var dlg = $('#dlgAdit'), f = dlg.querySelector('form'), emp = 0, corpo = $('#aditLinhas');
  function opcoes(id) {
    var h = '<option value="">— atividade nova —</option>';
    (CAT[id] || []).forEach(function (i) { i.ativs.forEach(function (a) { h += '<option value="' + a.codigo + '" data-nome="' + a.nome.replace(/"/g, '&quot;') + '" data-un="' + a.un + '" data-qtd="' + a.qtd + '">' + a.codigo + ' — ' + a.nome + ' (' + a.qtd.toLocaleString('pt-BR') + ' ' + a.un + ')</option>'; }); });
    return h;
  }
  function linha() {
    var tr = document.createElement('tr');
    tr.innerHTML = '<td><select name="origem[]" style="max-width:220px">' + opcoes(emp) + '</select></td><td><input name="atividade[]" maxlength="150" placeholder="ex.: Instalação de terças da marquise" style="min-width:200px"></td><td><input name="unidade[]" maxlength="12" style="width:64px"></td><td class="n"><input name="qtd[]" inputmode="decimal" placeholder="0,00" style="width:100px;text-align:right"></td><td class="n"><input name="valor[]" inputmode="decimal" placeholder="0,00" style="width:120px;text-align:right"></td><td><button type="button" class="btn" data-rm>×</button></td>';
    corpo.appendChild(tr);
  }
  function previa() {
    var total = (CAT[emp] || []).reduce(function (s, i) { return s + i.valor; }, 0), v = 0;
    corpo.querySelectorAll('input[name="valor[]"]').forEach(function (i) { v += num(i.value) || 0; });
    $('#aditPrevia').textContent = 'Contrato da empresa: ' + rs(total) + ' → ' + rs(total + v) + ' (aditivo ' + rs(v) + '). Nada do que já foi medido muda.';
  }
  corpo.addEventListener('change', function (e) {
    if (e.target.name === 'origem[]') { var o = e.target.selectedOptions[0], tr = e.target.closest('tr');
      if (o && o.value) { tr.querySelector('[name="atividade[]"]').value = o.dataset.nome + ' — aditivo'; tr.querySelector('[name="unidade[]"]').value = o.dataset.un; } }
    previa(); });
  corpo.addEventListener('input', previa);
  corpo.addEventListener('click', function (e) { if (e.target.hasAttribute('data-rm') && corpo.children.length > 1) { e.target.closest('tr').remove(); previa(); } });
  $('#aditMais').addEventListener('click', function () { linha(); });
  document.querySelectorAll('[data-aditivo]').forEach(function (b) { b.addEventListener('click', function () {
    emp = parseInt(b.dataset.aditivo, 10); f.reset(); f.empresa_id.value = emp; $('#aditTit').textContent = 'Aditivo de contrato — ' + b.dataset.nome;
    corpo.innerHTML = ''; linha(); previa(); dlg.showModal(); }); });
})();
</script>
</body></html>
