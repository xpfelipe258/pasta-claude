<?php
// Finanças: controle financeiro pessoal/PJ (painel, lançamentos, impostos CLT/MEI/ME e investimentos).
// Página própria e isolada: tabelas fin_*, dados por usuário, sem relação com as obras.
require __DIR__ . '/inc/nucleo.php';
require __DIR__ . '/inc/financas_modelo.php';

$eu = exigir_login_pagina();
if (isset($_GET['acesso'])) {
    responder_json(200, ['ok' => fin_pode_ver($eu)]);
}
if (!fin_pode_ver($eu)) {
    http_response_code(403);
    pagina_inicio('Finanças');
    echo '<main class="admin"><section class="bloco"><div class="bloco-cab"><h2>Finanças</h2></div>'
        . '<div class="faixa">Este módulo guarda dados financeiros pessoais e exige liberação. '
        . 'Peça ao administrador para marcar “Finanças” nos acessos do seu usuário (Administração → Usuários).</div>'
        . '<p><a class="btn" href="index.php">Voltar ao sistema</a></p></section></main></body></html>';
    exit;
}

fin_garantir_esquema();
$uid = (int)$eu['id'];
$csrf = token_csrf();

// ----------------------------------------------------------------- utilidades de tela

function fv_url(array $p = [])
{
    return 'financas.php' . ($p ? '?' . http_build_query($p) : '');
}

function fv_flash($tipo, $msg)
{
    $_SESSION['fin_flash'] = [$tipo, $msg];
}

function fv_ir($url)
{
    header('Location: ' . $url);
    exit;
}

function fv_negrito($txt)
{
    return preg_replace('/\*\*(.+?)\*\*/u', '<b>$1</b>', h($txt));
}

function fv_json($v)
{
    return json_encode($v, JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT);
}

/** Número vindo da URL ou do formulário (aceita 1.234,56); devolve o padrão se vazio/inválido. */
function fv_num($fonte, $k, $padrao)
{
    $v = numero($fonte[$k] ?? '');
    return $v === null ? (float)$padrao : (float)$v;
}

function fv_fmt_form($v)
{
    return $v === null || $v === '' ? '' : rtrim(rtrim(number_format((float)$v, 2, ',', ''), '0'), ',');
}

function fv_campo($nome, $rotulo, $valor, $extra = '', $dica = '')
{
    return '<div class="fv-campo"><label for="' . h($nome) . '">' . h($rotulo) . '</label><input type="text" inputmode="decimal" name="' . h($nome)
        . '" id="' . h($nome) . '" value="' . h($valor) . '" ' . $extra . '>' . ($dica ? '<span class="dica">' . h($dica) . '</span>' : '') . '</div>';
}

function fv_tile($rot, $val, $sub, $cor)
{
    return '<div class="tile" style="--c:' . $cor . '"><div class="rot"><span>' . h($rot) . '</span></div><div class="val">' . h($val) . '</div><div class="sub">' . h($sub) . '</div></div>';
}

function fv_botao($rotulo, $url, $ativo)
{
    return '<button type="button" class="' . ($ativo ? 'ativa' : '') . '" onclick="location.href=\'' . h($url) . '\'">' . h($rotulo) . '</button>';
}

// ----------------------------------------------------------------- ações (POST)

$erros = [];
$valoresForm = null;
$editarId = (int)($_GET['editar'] ?? 0);

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    conferir_csrf();
    $acao = $_POST['acao'] ?? '';
    try {
        if ($acao === 'salvar') {
            $id = (int)($_POST['id'] ?? 0);
            $post = $_POST;
            if (trim((string)($post['categoria_nova'] ?? '')) !== '') {
                $post['categoria'] = $post['categoria_nova'];
            }
            list($dados, $erros) = fin_validar($post);
            $repetir = (int)($_POST['repetir'] ?? 1);
            if ($repetir < 1 || $repetir > FIN_MAX_REPETIR) {
                $erros[] = 'Repetir por 1 a ' . FIN_MAX_REPETIR . ' meses.';
            }
            if (!$erros) {
                if ($id > 0) {
                    if (!fin_atualizar($uid, $id, $dados, !empty($_POST['pago']))) {
                        throw new InvalidArgumentException('Lançamento não encontrado.');
                    }
                    fv_flash('ok', 'Lançamento atualizado.');
                } else {
                    $n = fin_adicionar($uid, $dados, $repetir);
                    fv_flash('ok', $n > 1 ? $n . ' lançamentos criados (um por mês).' : 'Lançamento adicionado.');
                }
                fv_ir(fv_url(['v' => 'lanc']));
            }
            $valoresForm = $_POST;
            $editarId = $id;
        } elseif ($acao === 'excluir') {
            $n = fin_excluir($uid, (int)($_POST['id'] ?? 0), ($_POST['serie'] ?? '') === '1');
            fv_flash($n ? 'ok' : 'erro', $n ? $n . ' lançamento(s) excluído(s).' : 'Lançamento não encontrado.');
            fv_ir(fv_url(['v' => 'lanc']));
        } elseif ($acao === 'pago') {
            fin_alternar_pago($uid, (int)($_POST['id'] ?? 0));
            fv_ir(fv_url(['v' => 'lanc'] + array_filter(['mes' => $_POST['mes'] ?? '', 'tipo' => $_POST['tipo'] ?? '', 'q' => $_POST['q'] ?? '', 'p' => $_POST['p'] ?? ''])));
        } elseif ($acao === 'exemplo') {
            if (fin_tem_dados($uid)) {
                throw new InvalidArgumentException('Você já tem lançamentos; o exemplo só é carregado em uma conta vazia.');
            }
            fin_exemplo_carregar($uid);
            fv_flash('ok', 'Dados fictícios de exemplo carregados. Remova-os quando quiser.');
            fv_ir(fv_url());
        } elseif ($acao === 'remover_exemplo') {
            $n = fin_exemplo_remover($uid);
            fv_flash('ok', $n . ' lançamento(s) de exemplo removido(s).');
            fv_ir(fv_url());
        } elseif ($acao === 'reserva') {
            $r = numero($_POST['reserva'] ?? '');
            if ($r === null || $r < 0) {
                throw new InvalidArgumentException('Informe o valor da reserva (zero ou mais).');
            }
            fin_cfg_gravar($uid, ['reserva' => (float)$r]);
            fv_flash('ok', 'Reserva de emergência atualizada.');
            fv_ir(fv_url(array_filter(['de' => $_POST['de'] ?? '', 'ate' => $_POST['ate'] ?? ''])));
        } elseif ($acao === 'taxas_bcb') {
            $t = fin_buscar_taxas_bcb();
            if (!$t) {
                throw new InvalidArgumentException('Não consegui acessar o Banco Central agora. Informe Selic, CDI e IPCA manualmente.');
            }
            fin_cfg_gravar($uid, $t);
            fv_flash('ok', 'Taxas atualizadas pelo Banco Central: Selic ' . fin_pct($t['selic'], 2) . ', CDI ' . fin_pct($t['cdi'], 2) . ', IPCA 12m ' . fin_pct($t['ipca'], 2) . '.');
            fv_ir(fv_url(['v' => 'inv']));
        } elseif ($acao === 'taxas_salvar') {
            fin_cfg_gravar($uid, ['selic' => fv_num($_POST, 'selic', 15) / 100, 'cdi' => fv_num($_POST, 'cdi', 14.9) / 100, 'ipca' => fv_num($_POST, 'ipca', 4.5) / 100]);
            fv_flash('ok', 'Taxas salvas como padrão.');
            fv_ir(fv_url(['v' => 'inv']));
        } else {
            throw new InvalidArgumentException('Ação inválida.');
        }
    } catch (Throwable $e) {
        $msg = $e instanceof InvalidArgumentException ? $e->getMessage() : 'Não foi possível gravar agora. Tente novamente.';
        if (!($e instanceof InvalidArgumentException)) {
            error_log('Finanças: ' . $e->getMessage());
        }
        if ($valoresForm === null) {
            fv_flash('erro', $msg);
            fv_ir(fv_url(['v' => in_array($acao, ['taxas_bcb', 'taxas_salvar'], true) ? 'inv' : ($acao === 'reserva' || $acao === 'exemplo' ? 'painel' : 'lanc')]));
        }
        $erros[] = $msg;
    }
}

$flash = $_SESSION['fin_flash'] ?? null;
unset($_SESSION['fin_flash']);

// ----------------------------------------------------------------- roteamento (GET)

$v = $_GET['v'] ?? 'painel';
if ($valoresForm !== null) {
    $v = 'lanc';
}
if (!in_array($v, ['painel', 'lanc', 'imp', 'inv'], true)) {
    $v = 'painel';
}
$cfg = fin_cfg($uid);
$CAT = fin_categorias();

// exportação CSV (antes de qualquer saída)
if ($v === 'lanc' && ($_GET['export'] ?? '') === 'csv') {
    list($linhas) = fin_listar($uid, [], 1, 0);
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="financas_' . fin_hoje() . '.csv"');
    $out = fopen('php://output', 'w');
    fwrite($out, "\xEF\xBB\xBF");
    fputcsv($out, ['Data', 'Tipo', 'Natureza', 'Categoria', 'Descrição', 'Valor', 'Pago/Recebido'], ';');
    foreach ($linhas as $r) {
        fputcsv($out, [$r['data'], $r['tipo'], $r['natureza'], $r['categoria'], $r['descricao'], number_format((float)$r['valor'], 2, ',', ''), $r['pago'] ? 'Sim' : 'Não'], ';');
    }
    fclose($out);
    exit;
}

$titulos = ['painel' => 'Painel', 'lanc' => 'Lançamentos', 'imp' => 'Impostos', 'inv' => 'Investimentos'];
pagina_inicio($titulos[$v] . ' · Finanças');
$scripts = '';   // gráficos Chart.js montados por cada tela
?>
<style>
.fv-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px 16px}
.fv-grid .full{grid-column:1/-1}
.fv-campo{display:flex;flex-direction:column;gap:4px;min-width:0}
.fv-campo label{font-size:.78rem;font-weight:700;color:var(--fg2)}
.fv-campo input,.fv-campo select{padding:7px 9px;border:1px solid var(--linha-forte);border-radius:6px;background:var(--bg);color:var(--fg);font:inherit;font-size:.9rem;min-width:0;width:100%;box-sizing:border-box}
.fv-campo .dica{font-size:.74rem;color:var(--fg2)}
.fv-check{display:flex;align-items:center;gap:8px;font-size:.9rem;padding-top:22px}
a.btn{display:inline-block;text-decoration:none;color:var(--fg)}
a.btn.primario{color:#fff}
.fv-erros{margin:0 0 14px;padding:10px 14px;border:1px solid var(--vermelho);border-radius:6px;color:var(--vermelho);background:var(--card)}
.fv-erros ul{margin:4px 0 0 18px;padding:0}
.fv-acoes{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:14px}
.fv-duas{display:grid;grid-template-columns:repeat(auto-fit,minmax(460px,1fr));gap:16px;margin-top:16px}
.tile .val{font-size:1.55rem;white-space:nowrap}
@media(max-width:560px){.fv-duas{grid-template-columns:1fr}}
.fv-diag{border:1px solid var(--linha);border-left:4px solid var(--c);background:var(--card);border-radius:8px;padding:9px 14px;margin-bottom:8px;font-size:.92rem}
.fv-abas{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px}
.fv-abas a{padding:6px 14px;border:1px solid var(--linha-forte);border-radius:18px;text-decoration:none;color:var(--fg);font-size:.88rem}
.fv-abas a.atual{background:var(--fg);color:var(--bg)}
.fv-pag{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:12px}
.fv-pag a{padding:4px 10px;border:1px solid var(--linha-forte);border-radius:6px;text-decoration:none;color:var(--fg)}
.fv-pag a.atual{background:var(--fg);color:var(--bg)}
.fv-tabela td,.fv-tabela th{white-space:nowrap}
.fv-tabela td.n,.fv-tabela th.n{text-align:right}
.fv-form-inline{display:inline;margin:0}
.fv-rodape{font-size:.78rem;color:var(--fg3);margin-top:10px;max-width:90ch}
</style>
<header class="topo">
  <div class="marca"><span class="marca-sigla">R$</span><div><h1>Finanças</h1>
    <div class="arquivo"><span class="ponto ok"></span>controle financeiro pessoal e da empresa · dados só seus</div>
    <div class="usuario"><span><?= h($eu['nome']) ?></span><a href="dashboard_admin.php">Dashboard geral</a><a href="index.php">Voltar ao sistema</a><a href="sair.php">Sair</a></div></div></div>
</header>
<button class="sidebar-toggle" id="sidebarToggle" aria-label="Menu">☰</button>
<aside class="sidebar" id="sidebar"><nav class="sidebar-nav">
  <div class="sidebar-grupo sidebar-dashboard"><div class="sidebar-itens aberto"><?= fv_botao('← Voltar para o início', 'index.php', false) ?></div></div>
  <div class="sidebar-grupo"><div class="sidebar-titulo aberto">Finanças<span class="seta-grupo">&#8249;</span></div>
    <div class="sidebar-itens aberto"><?php foreach ($titulos as $k => $rot) { echo fv_botao($rot, fv_url(['v' => $k]), $v === $k); } ?></div></div>
</nav></aside>
<main class="admin">
<?php if ($flash): ?><div class="faixa <?= $flash[0] === 'ok' ? 'ok-faixa' : '' ?>"><?= h($flash[1]) ?></div><?php endif; ?>

<?php
// ================================================================= PAINEL
if ($v === 'painel'):
    $mesesDados = fin_meses_com_dados($uid);
    if (!$mesesDados):
?>
  <section class="bloco">
    <div class="bloco-cab"><div><h2>Painel financeiro</h2><span class="nota">Receitas, despesas, custos fixos e variáveis, cartão e reserva de emergência.</span></div></div>
    <div class="faixa" style="margin:0 0 12px">Você ainda não tem lançamentos. Comece em <a href="<?= h(fv_url(['v' => 'lanc'])) ?>">Lançamentos</a> ou carregue dados fictícios para conhecer o painel.</div>
    <form method="post"><input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="acao" value="exemplo"><button class="btn primario">Carregar dados de exemplo</button></form>
  </section>
<?php
    else:
        $primeiro = $mesesDados[0];
        $ultimo = end($mesesDados);
        $ate = fin_mes_valido($_GET['ate'] ?? '') ? $_GET['ate'] : $ultimo;
        $de = fin_mes_valido($_GET['de'] ?? '') ? $_GET['de'] : max($primeiro, (new DateTimeImmutable($ate . '-01'))->modify('-5 month')->format('Y-m'));
        if ($de > $ate) {
            list($de, $ate) = [$ate, $de];
        }
        $opcoes = fin_intervalo_meses($primeiro, $ultimo);
        $P = fin_painel($uid, $de, $ate);
        $rec = $P['rec'];
        $rotulos = array_map('fin_rotulo_mes', $P['meses']);
        $serie = array_values($P['serie']);
        $col = function ($k) use ($serie) { return array_map(function ($s) use ($k) { return round($s[$k], 2); }, $serie); };
        $saldos = array_map(function ($s) { return round($s['rec'] - $s['desp'], 2); }, $serie);
        $acum = [];
        $t = 0;
        foreach ($saldos as $s) {
            $t += $s;
            $acum[] = round($t, 2);
        }
        $cats = array_slice($P['categorias'], 0, 12);
?>
  <section class="bloco">
    <div class="bloco-cab"><div><h2>Painel financeiro</h2><span class="nota">Período de <?= h(fin_rotulo_mes($de)) ?> a <?= h(fin_rotulo_mes($ate)) ?> · atualizado em <?= h(fin_agora_br()->format('d/m/Y H:i')) ?> (Brasília).</span></div></div>
    <form method="get" class="barra-filtros"><input type="hidden" name="v" value="painel">
      <label>De<select name="de"><?php foreach ($opcoes as $m): ?><option value="<?= h($m) ?>" <?= $m === $de ? 'selected' : '' ?>><?= h(fin_rotulo_mes($m)) ?></option><?php endforeach; ?></select></label>
      <label>Até<select name="ate"><?php foreach ($opcoes as $m): ?><option value="<?= h($m) ?>" <?= $m === $ate ? 'selected' : '' ?>><?= h(fin_rotulo_mes($m)) ?></option><?php endforeach; ?></select></label>
      <button class="btn">Aplicar</button>
    </form>
    <div class="tiles">
      <?= fv_tile('Receitas', fin_brl($rec), $P['n_meses'] . ' mês(es)', 'var(--fg)') ?>
      <?= fv_tile('Despesas', fin_brl($P['desp']), 'média de ' . fin_brl($P['desp'] / $P['n_meses']) . '/mês', 'var(--fg)') ?>
      <?= fv_tile('Saldo', fin_brl($P['saldo']), fin_pct($P['poupanca']) . ' da renda', $P['saldo'] >= 0 ? 'var(--verde)' : 'var(--vermelho)') ?>
      <?= fv_tile('Custos fixos', fin_brl($P['fixa']), fin_pct($rec > 0 ? $P['fixa'] / $rec : 0, 0) . ' da renda', 'var(--fg)') ?>
      <?= fv_tile('Custos variáveis', fin_brl($P['var']), fin_pct($rec > 0 ? $P['var'] / $rec : 0, 0) . ' da renda', 'var(--fg)') ?>
    </div>
  </section>

  <div class="fv-duas">
    <section class="bloco"><div class="bloco-cab"><h2>Receitas × despesas por mês</h2></div><div class="grafico"><canvas id="gRecDesp"></canvas></div></section>
    <section class="bloco"><div class="bloco-cab"><h2>Custos fixos × variáveis</h2></div><div class="grafico"><canvas id="gFixVar"></canvas></div></section>
    <section class="bloco"><div class="bloco-cab"><h2>Para onde vai o dinheiro</h2><span class="nota">laranja = fixo · verde = variável</span></div><div class="grafico alto"><canvas id="gCats"></canvas></div></section>
    <section class="bloco"><div class="bloco-cab"><h2>Saldo acumulado</h2></div><div class="grafico alto"><canvas id="gAcum"></canvas></div></section>
  </div>

  <section class="bloco" style="margin-top:16px">
    <div class="bloco-cab"><div><h2>Diagnóstico financeiro</h2><span class="nota">Regra 50/30/20, peso dos custos fixos, cartão de crédito e reserva de emergência.</span></div></div>
    <form method="post" class="barra-filtros"><input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="acao" value="reserva"><input type="hidden" name="de" value="<?= h($de) ?>"><input type="hidden" name="ate" value="<?= h($ate) ?>">
      <label>Minha reserva de emergência hoje (R$)<input type="text" inputmode="decimal" name="reserva" value="<?= h(fv_fmt_form($cfg['reserva'])) ?>"></label><button class="btn">Salvar reserva</button></form>
    <?php
    $cores = ['verde' => 'var(--verde)', 'amarelo' => 'var(--amarelo)', 'vermelho' => 'var(--vermelho)'];
    foreach (fin_diagnostico($P, $cfg['reserva']) as $d) {
        echo '<div class="fv-diag" style="--c:' . $cores[$d[0]] . '">' . h($d[1]) . ' ' . fv_negrito($d[2]) . '</div>';
    }
    if ($P['pendentes_n']) {
        echo '<p class="nota">Contas a pagar em aberto: ' . (int)$P['pendentes_n'] . ' lançamento(s), ' . h(fin_brl($P['pendentes_valor'])) . '.</p>';
    }
    ?>
  </section>

  <section class="bloco" style="margin-top:16px">
    <div class="bloco-cab"><div><h2>Resumo por mês</h2><span class="nota">Os mesmos números dos gráficos, em tabela.</span></div></div>
    <div class="tabela-rolagem"><table class="fv-tabela">
      <thead><tr><th>Mês</th><th class="n">Receitas</th><th class="n">Despesas</th><th class="n">Fixas</th><th class="n">Variáveis</th><th class="n">Saldo</th></tr></thead>
      <tbody><?php foreach ($P['serie'] as $m => $s): $sd = $s['rec'] - $s['desp']; ?>
        <tr><td><b><?= h(fin_rotulo_mes($m)) ?></b></td><td class="n"><?= h(fin_brl($s['rec'])) ?></td><td class="n"><?= h(fin_brl($s['desp'])) ?></td>
          <td class="n"><?= h(fin_brl($s['fixa'])) ?></td><td class="n"><?= h(fin_brl($s['var'])) ?></td>
          <td class="n"><span class="farol <?= $sd >= 0 ? 'f-verde' : 'f-vermelho' ?>"><?= h(fin_brl($sd)) ?></span></td></tr>
      <?php endforeach; ?></tbody>
    </table></div>
    <?php if (fin_tem_exemplo($uid)): ?>
      <form method="post" class="fv-acoes" onsubmit="return confirm('Remover os lançamentos de exemplo?')"><input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="acao" value="remover_exemplo">
        <span class="nota">Você está vendo dados fictícios de exemplo.</span><button class="btn perigo">Remover dados de exemplo</button></form>
    <?php endif; ?>
  </section>
<?php
        $scripts = '
const D=' . fv_json(['x' => $rotulos, 'rec' => $col('rec'), 'desp' => $col('desp'), 'fixa' => $col('fixa'), 'var' => $col('var'), 'saldo' => $saldos, 'acum' => $acum,
            'cat' => array_column($cats, 'categoria'), 'catv' => array_map(function ($c) { return round($c['s'], 2); }, $cats),
            'catn' => array_column($cats, 'natureza')]) . ';
const AZ="#2a78d6",LA="#eb6834",VE="#1baf7a";
new Chart(document.getElementById("gRecDesp"),{data:{labels:D.x,datasets:[
 {type:"bar",label:"Receitas",data:D.rec,backgroundColor:AZ,borderRadius:4,maxBarThickness:34},
 {type:"bar",label:"Despesas",data:D.desp,backgroundColor:LA,borderRadius:4,maxBarThickness:34},
 {type:"line",label:"Saldo",data:D.saldo,borderColor:TXT,backgroundColor:TXT,borderWidth:2,pointRadius:4,pointBorderColor:BG,pointBorderWidth:2,tension:0}]},options:OPC_Y()});
new Chart(document.getElementById("gFixVar"),{type:"bar",data:{labels:D.x,datasets:[
 {label:"Fixos",data:D.fixa,backgroundColor:LA,borderColor:BG,borderWidth:2,maxBarThickness:46},
 {label:"Variáveis",data:D.var,backgroundColor:VE,borderColor:BG,borderWidth:2,maxBarThickness:46}]},options:OPC_Y(true)});
new Chart(document.getElementById("gCats"),{type:"bar",data:{labels:D.cat,datasets:[{label:"Despesa",data:D.catv,borderRadius:4,
 backgroundColor:D.catn.map(function(n){return n==="Fixa"?LA:VE}),maxBarThickness:22}]},
 options:Object.assign(OPC_Y(),{indexAxis:"y",plugins:{legend:{display:false},tooltip:{callbacks:{label:function(c){return " "+BRL(c.parsed.x)+" ("+D.catn[c.dataIndex]+")"}}}},
  scales:{x:{grid:{color:GRID},ticks:{color:MUT,callback:function(v){return BRL0(v)}}},y:{grid:{display:false},ticks:{color:MUT}}}})});
new Chart(document.getElementById("gAcum"),{type:"line",data:{labels:D.x,datasets:[{label:"Saldo acumulado",data:D.acum,borderColor:AZ,backgroundColor:"rgba(42,120,214,.14)",fill:true,borderWidth:2,pointRadius:4,pointBorderColor:BG,pointBorderWidth:2,tension:0}]},options:OPC_Y()});
';
    endif;

// ================================================================= LANÇAMENTOS
elseif ($v === 'lanc'):
    $edit = $editarId > 0 ? fin_obter($uid, $editarId) : null;
    $F = $valoresForm ?? ($edit ? [
        'id' => $edit['id'], 'tipo' => $edit['tipo'], 'natureza' => $edit['natureza'], 'categoria' => $edit['categoria'], 'descricao' => $edit['descricao'],
        'valor' => fv_fmt_form($edit['valor']), 'data' => $edit['data'], 'pago' => $edit['pago'],
    ] : ['id' => 0, 'tipo' => 'Despesa', 'natureza' => 'Fixa', 'categoria' => '', 'descricao' => '', 'valor' => '', 'data' => fin_hoje(), 'pago' => 0]);
    $filtros = ['mes' => fin_mes_valido($_GET['mes'] ?? '') ? $_GET['mes'] : '', 'tipo' => in_array($_GET['tipo'] ?? '', ['Receita', 'Despesa'], true) ? $_GET['tipo'] : '',
        'q' => trim((string)($_GET['q'] ?? ''))];
    $pagina = max(1, (int)($_GET['p'] ?? 1));
    $porPagina = 30;
    list($linhas, $total) = fin_listar($uid, $filtros, $pagina, $porPagina);
    $paginas = max(1, (int)ceil($total / $porPagina));
    $mesesFiltro = array_reverse(fin_meses_com_dados($uid));
    $urlLista = function (array $extra = []) use ($filtros) { return fv_url(array_filter(['v' => 'lanc'] + $filtros + $extra, function ($x) { return $x !== '' && $x !== null; })); };
?>
  <section class="bloco">
    <div class="bloco-cab"><div><h2><?= $F['id'] ? 'Editar lançamento' : 'Novo lançamento' ?></h2><span class="nota">Parcela do carro, aluguel, salário, cartão… use “repetir” para criar um lançamento por mês.</span></div></div>
    <?php if ($erros): ?><div class="fv-erros"><b>Corrija antes de salvar:</b><ul><?php foreach ($erros as $e): ?><li><?= h($e) ?></li><?php endforeach; ?></ul></div><?php endif; ?>
    <form method="post" id="formLanc"><input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="acao" value="salvar"><input type="hidden" name="id" value="<?= (int)$F['id'] ?>">
      <div class="fv-grid">
        <div class="fv-campo"><label for="f_tipo">Tipo</label><select name="tipo" id="f_tipo"><?php foreach (['Despesa', 'Receita'] as $o): ?><option <?= ($F['tipo'] ?? '') === $o ? 'selected' : '' ?>><?= h($o) ?></option><?php endforeach; ?></select></div>
        <div class="fv-campo" id="boxNat"><label for="f_nat">Natureza da despesa</label><select name="natureza" id="f_nat"><?php foreach (['Fixa', 'Variável'] as $o): ?><option <?= ($F['natureza'] ?? '') === $o ? 'selected' : '' ?>><?= h($o) ?></option><?php endforeach; ?></select></div>
        <div class="fv-campo"><label for="f_cat">Categoria</label><select name="categoria" id="f_cat"><option value="">—</option>
          <?php foreach ($CAT as $grupo => $lista): ?><optgroup label="<?= h($grupo === 'Receita' ? 'Receitas' : 'Despesas ' . strtolower($grupo === 'Fixa' ? 'fixas' : 'variáveis')) ?>" data-grupo="<?= h($grupo) ?>">
            <?php foreach ($lista as $c): ?><option value="<?= h($c) ?>" <?= ($F['categoria'] ?? '') === $c ? 'selected' : '' ?>><?= h($c) ?></option><?php endforeach; ?></optgroup><?php endforeach; ?>
          <?php $conhecida = array_merge(...array_values($CAT)); if (($F['categoria'] ?? '') !== '' && !in_array($F['categoria'], $conhecida, true)): ?><option value="<?= h($F['categoria']) ?>" selected><?= h($F['categoria']) ?></option><?php endif; ?></select></div>
        <div class="fv-campo"><label for="f_cn">…ou nova categoria</label><input type="text" name="categoria_nova" id="f_cn" maxlength="60" placeholder="opcional"></div>
        <div class="fv-campo full"><label for="f_desc">Descrição</label><input type="text" name="descricao" id="f_desc" maxlength="200" value="<?= h($F['descricao'] ?? '') ?>"></div>
        <?= fv_campo('valor', 'Valor (R$)', $F['valor'] ?? '', 'required') ?>
        <div class="fv-campo"><label for="f_data"><?= $F['id'] ? 'Data' : 'Data (1ª parcela)' ?></label><input type="date" name="data" id="f_data" value="<?= h($F['data'] ?? '') ?>" required></div>
        <?php if (!$F['id']): ?><div class="fv-campo"><label for="f_rep">Repetir por quantos meses?</label><input type="number" name="repetir" id="f_rep" min="1" max="<?= FIN_MAX_REPETIR ?>" value="<?= (int)($F['repetir'] ?? 1) ?>"></div>
        <?php else: ?><label class="fv-check"><input type="checkbox" name="pago" value="1" <?= !empty($F['pago']) ? 'checked' : '' ?>> Já pago / recebido</label><?php endif; ?>
      </div>
      <div class="fv-acoes"><button class="btn primario"><?= $F['id'] ? 'Salvar alteração' : '+ Adicionar' ?></button><?php if ($F['id']): ?><a class="btn" href="<?= h(fv_url(['v' => 'lanc'])) ?>">Cancelar</a><?php endif; ?></div>
    </form>
  </section>

  <section class="bloco" style="margin-top:16px">
    <div class="bloco-cab"><div><h2>Todos os lançamentos</h2><span class="nota"><?= (int)$total ?> registro(s).</span></div>
      <a class="btn" href="<?= h(fv_url(['v' => 'lanc', 'export' => 'csv'])) ?>">⬇ Exportar CSV</a></div>
    <form method="get" class="barra-filtros"><input type="hidden" name="v" value="lanc">
      <label>Mês<select name="mes"><option value="">Todos</option><?php foreach ($mesesFiltro as $m): ?><option value="<?= h($m) ?>" <?= $filtros['mes'] === $m ? 'selected' : '' ?>><?= h(fin_rotulo_mes($m)) ?></option><?php endforeach; ?></select></label>
      <label>Tipo<select name="tipo"><option value="">Todos</option><?php foreach (['Receita', 'Despesa'] as $o): ?><option <?= $filtros['tipo'] === $o ? 'selected' : '' ?>><?= h($o) ?></option><?php endforeach; ?></select></label>
      <label>Buscar<input type="search" name="q" value="<?= h($filtros['q']) ?>" placeholder="descrição ou categoria"></label>
      <button class="btn">Filtrar</button>
    </form>
    <?php if (!$linhas): ?><div class="faixa" style="margin:0">Nenhum lançamento encontrado.</div><?php else: ?>
    <div class="tabela-rolagem"><table class="fv-tabela">
      <thead><tr><th>Data</th><th>Tipo</th><th>Natureza</th><th>Categoria</th><th>Descrição</th><th class="n">Valor</th><th>Situação</th><th></th></tr></thead>
      <tbody><?php foreach ($linhas as $r): ?>
        <tr><td><?= h(substr($r['data'], 8, 2) . '/' . substr($r['data'], 5, 2) . '/' . substr($r['data'], 0, 4)) ?></td>
          <td><span class="farol <?= $r['tipo'] === 'Receita' ? 'f-verde' : 'f-amarelo' ?>"><?= h($r['tipo']) ?></span></td><td><?= h($r['natureza']) ?></td>
          <td><?= h($r['categoria']) ?></td><td><?= h($r['descricao']) ?></td><td class="n"><b><?= h(fin_brl($r['valor'])) ?></b></td>
          <td><form method="post" class="fv-form-inline"><input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="acao" value="pago"><input type="hidden" name="id" value="<?= (int)$r['id'] ?>">
            <input type="hidden" name="mes" value="<?= h($filtros['mes']) ?>"><input type="hidden" name="tipo" value="<?= h($filtros['tipo']) ?>"><input type="hidden" name="q" value="<?= h($filtros['q']) ?>"><input type="hidden" name="p" value="<?= (int)$pagina ?>">
            <button class="btn" title="Alternar situação"><?= $r['pago'] ? ($r['tipo'] === 'Receita' ? '✔ Recebido' : '✔ Pago') : '⏳ Pendente' ?></button></form></td>
          <td style="white-space:nowrap"><a class="btn" href="<?= h(fv_url(['v' => 'lanc', 'editar' => (int)$r['id']])) ?>#formLanc">Editar</a>
            <form method="post" class="fv-form-inline" onsubmit="return confirm('Excluir este lançamento?')"><input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="acao" value="excluir"><input type="hidden" name="id" value="<?= (int)$r['id'] ?>"><button class="btn perigo">Excluir</button></form>
            <?php if ($r['serie'] && $r['serie'] !== 'exemplo'): ?><form method="post" class="fv-form-inline" onsubmit="return confirm('Excluir TODAS as repetições desta série?')"><input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="acao" value="excluir"><input type="hidden" name="id" value="<?= (int)$r['id'] ?>"><input type="hidden" name="serie" value="1"><button class="btn perigo" title="Exclui todos os meses da série">Excluir série</button></form><?php endif; ?></td></tr>
      <?php endforeach; ?></tbody>
    </table></div>
    <?php if ($paginas > 1): ?><div class="fv-pag"><?php for ($i = 1; $i <= $paginas; $i++): ?><a class="<?= $i === $pagina ? 'atual' : '' ?>" href="<?= h($urlLista(['p' => $i])) ?>"><?= $i ?></a><?php endfor; ?></div><?php endif; ?>
    <?php endif; ?>
  </section>
<?php
    $scripts = '
(function(){var t=document.getElementById("f_tipo"),n=document.getElementById("f_nat"),box=document.getElementById("boxNat"),c=document.getElementById("f_cat");
function ajusta(){var rec=t.value==="Receita";box.style.display=rec?"none":"";
 c.querySelectorAll("optgroup").forEach(function(g){var gr=g.dataset.grupo,ok=rec?gr==="Receita":(gr===n.value);g.hidden=!ok;g.disabled=!ok;});
 var sel=c.options[c.selectedIndex];if(sel&&sel.parentElement.tagName==="OPTGROUP"&&sel.parentElement.disabled)c.value="";}
t.addEventListener("change",ajusta);n.addEventListener("change",ajusta);ajusta();})();
';

// ================================================================= IMPOSTOS
elseif ($v === 'imp'):
    $t = in_array($_GET['t'] ?? '', ['clt', 'mei', 'me', 'cmp'], true) ? $_GET['t'] : 'clt';
    $abas = ['clt' => 'Salário CLT', 'mei' => 'MEI', 'me' => 'ME — Simples (Anexo III / V)', 'cmp' => 'Comparativo'];
?>
  <section class="bloco">
    <div class="bloco-cab"><div><h2>Impostos</h2><span class="nota">Estimativas com as tabelas de 2026 (arquivo <code>inc/financas_calculos.php</code>). Confirme sempre com o seu contador.</span></div></div>
    <div class="fv-abas"><?php foreach ($abas as $k => $rot): ?><a class="<?= $t === $k ? 'atual' : '' ?>" href="<?= h(fv_url(['v' => 'imp', 't' => $k])) ?>"><?= h($rot) ?></a><?php endforeach; ?></div>

<?php if ($t === 'clt'):
    $bruto = fv_num($_GET, 'bruto', 8000);
    $dep = max(0, (int)fv_num($_GET, 'dep', 0));
    $outros = fv_num($_GET, 'outros', 0);
    $r = fin_salario_clt($bruto, $dep, $outros);
?>
    <form method="get" class="barra-filtros"><input type="hidden" name="v" value="imp"><input type="hidden" name="t" value="clt">
      <label>Salário bruto (R$)<input type="text" inputmode="decimal" name="bruto" value="<?= h(fv_fmt_form($bruto)) ?>"></label>
      <label>Dependentes<input type="number" name="dep" min="0" max="10" value="<?= (int)$dep ?>"></label>
      <label>Outros descontos (VT, plano…)<input type="text" inputmode="decimal" name="outros" value="<?= h(fv_fmt_form($outros)) ?>"></label><button class="btn primario">Calcular</button></form>
    <div class="tiles">
      <?= fv_tile('INSS', fin_brl($r['inss']), 'progressivo, teto ' . fin_brl(FIN_TETO_INSS), 'var(--amarelo)') ?>
      <?= fv_tile('IRRF', fin_brl($r['irrf']), $r['irrf'] == 0 ? 'isento / abaixo do redutor' : 'tabela 2026 com redutor', 'var(--amarelo)') ?>
      <?= fv_tile('Líquido mensal', fin_brl($r['liquido']), 'bruto − INSS − IRRF − outros', 'var(--verde)') ?>
      <?= fv_tile('Carga (INSS + IR)', fin_pct($r['aliquota_efetiva']), 'sobre o salário bruto', 'var(--fg)') ?>
    </div>
    <div class="tabela-rolagem" style="margin-top:12px"><table class="fv-tabela"><thead><tr><th>Item</th><th class="n">Valor</th><th class="n">% do bruto</th><th style="width:40%"></th></tr></thead><tbody>
      <?php foreach ([['Salário bruto', $r['bruto'], 'var(--fg)'], ['(−) INSS', -$r['inss'], 'var(--amarelo)'], ['(−) IRRF', -$r['irrf'], 'var(--amarelo)'], ['(−) Outros descontos', -$r['outros'], 'var(--fg3)'], ['(=) Líquido', $r['liquido'], 'var(--verde)']] as $l): ?>
        <tr><td><?= h($l[0]) ?></td><td class="n"><?= h(fin_brl($l[1])) ?></td><td class="n"><?= $r['bruto'] > 0 ? h(fin_pct(abs($l[1]) / $r['bruto'])) : '—' ?></td>
          <td><div class="barra" style="--c:<?= $l[2] ?>"><i style="width:<?= $r['bruto'] > 0 ? min(100, round(abs($l[1]) / $r['bruto'] * 100)) : 0 ?>%"></i></div></td></tr>
      <?php endforeach; ?></tbody></table></div>
    <p class="fv-rodape">FGTS depositado pelo empregador (8%): <?= h(fin_brl($r['fgts'])) ?>/mês · líquido anual com 13º e férias + 1/3 ≈ <?= h(fin_brl($r['anual_liquido'])) ?>.</p>

<?php elseif ($t === 'mei'):
    $rm = fv_num($_GET, 'receita', 6000);
    $ativ = in_array($_GET['ativ'] ?? '', ['servicos', 'comercio', 'ambos'], true) ? $_GET['ativ'] : 'servicos';
    $dm = fv_num($_GET, 'despesas', 500);
    $m = fin_mei($rm, $ativ, $dm);
?>
    <form method="get" class="barra-filtros"><input type="hidden" name="v" value="imp"><input type="hidden" name="t" value="mei">
      <label>Faturamento mensal (R$)<input type="text" inputmode="decimal" name="receita" value="<?= h(fv_fmt_form($rm)) ?>"></label>
      <label>Atividade<select name="ativ"><?php foreach (['servicos' => 'Serviços', 'comercio' => 'Comércio/Indústria', 'ambos' => 'Comércio + Serviços'] as $k => $rot): ?><option value="<?= h($k) ?>" <?= $ativ === $k ? 'selected' : '' ?>><?= h($rot) ?></option><?php endforeach; ?></select></label>
      <label>Despesas do negócio (R$/mês)<input type="text" inputmode="decimal" name="despesas" value="<?= h(fv_fmt_form($dm)) ?>"></label><button class="btn primario">Calcular</button></form>
    <div class="tiles">
      <?= fv_tile('DAS-MEI mensal', fin_brl($m['das']), 'INSS ' . fin_brl($m['inss']) . ($m['iss'] ? ' + ISS ' . fin_brl($m['iss']) : '') . ($m['icms'] ? ' + ICMS ' . fin_brl($m['icms']) : ''), 'var(--amarelo)') ?>
      <?= fv_tile('Imposto sobre faturamento', fin_pct($rm > 0 ? $m['das'] / $rm : 0, 2), 'valor fixo, não depende do faturamento', 'var(--fg)') ?>
      <?= fv_tile('Sobra no bolso', fin_brl($m['liquido']), 'faturamento − DAS − despesas', 'var(--verde)') ?>
      <?= fv_tile('Limite mensal', fin_brl($m['limite_mensal']), 'R$ 81 mil por ano', 'var(--fg)') ?>
    </div>
    <div class="faixa <?= $m['dentro_do_limite'] ? 'ok-faixa' : '' ?>" style="margin:12px 0 0"><?= $m['dentro_do_limite'] ? '✔ Dentro do limite anual de R$ 81.000 do MEI.' : '✖ Faturamento anual projetado (' . h(fin_brl($rm * 12)) . ') excede o limite do MEI — desenquadramento para ME.' ?></div>
    <div class="faixa" style="margin:8px 0 0">Atenção: <b>engenharia civil e outras profissões regulamentadas (CREA) não podem ser MEI.</b> Para projetos e gestão de obras, o caminho é ME (Simples).</div>

<?php elseif ($t === 'me'):
    $recMe = fv_num($_GET, 'receita', 15000);
    $pl = fv_num($_GET, 'pro_labore', 4200);
    $dp = fv_num($_GET, 'despesas', 800);
    $rbt = fv_num($_GET, 'rbt12', 0);
    $dep = max(0, (int)fv_num($_GET, 'dep', 0));
    $me = fin_me_simples($recMe, $pl, $dp, $dep, $rbt > 0 ? $rbt : null);
?>
    <form method="get" class="barra-filtros"><input type="hidden" name="v" value="imp"><input type="hidden" name="t" value="me">
      <label>Faturamento mensal (R$)<input type="text" inputmode="decimal" name="receita" value="<?= h(fv_fmt_form($recMe)) ?>"></label>
      <label>Pró-labore mensal (R$)<input type="text" inputmode="decimal" name="pro_labore" value="<?= h(fv_fmt_form($pl)) ?>"></label>
      <label>Despesas da empresa (R$/mês)<input type="text" inputmode="decimal" name="despesas" value="<?= h(fv_fmt_form($dp)) ?>"></label>
      <label>RBT12 (vazio = faturamento × 12)<input type="text" inputmode="decimal" name="rbt12" value="<?= $rbt > 0 ? h(fv_fmt_form($rbt)) : '' ?>"></label>
      <label>Dependentes<input type="number" name="dep" min="0" max="10" value="<?= (int)$dep ?>"></label><button class="btn primario">Calcular</button></form>
    <div class="tiles">
      <?= fv_tile('Anexo aplicado', 'Anexo ' . $me['anexo'], 'Fator R ' . fin_pct($me['fator_r']), $me['anexo'] === 'III' ? 'var(--verde)' : 'var(--amarelo)') ?>
      <?= fv_tile('Alíquota efetiva', fin_pct($me['aliquota_efetiva'], 2), 'nominal ' . fin_pct($me['aliquota_nominal']), 'var(--fg)') ?>
      <?= fv_tile('DAS do mês', fin_brl($me['das']), 'Simples Nacional', 'var(--amarelo)') ?>
      <?= fv_tile('Carga total', fin_pct($me['carga_total']), 'DAS + INSS + IRRF', 'var(--fg)') ?>
      <?= fv_tile('Líquido no bolso', fin_brl($me['liquido_no_bolso']), 'pró-labore líquido + lucros', 'var(--verde)') ?>
    </div>
    <div class="tabela-rolagem" style="margin-top:12px"><table class="fv-tabela"><thead><tr><th>Item</th><th class="n">Valor</th></tr></thead><tbody>
      <?php foreach ([['Faturamento', $me['receita']], ['(−) DAS (Simples)', -$me['das']], ['(−) Despesas da empresa', -$me['despesas_empresa']], ['Pró-labore bruto', $me['pro_labore']],
          ['   (−) INSS do pró-labore (11%)', -$me['inss_pro_labore']], ['   (−) IRRF do pró-labore', -$me['irrf_pro_labore']], ['Lucro distribuível (isento)', $me['lucro_distribuivel']], ['(=) Líquido no bolso', $me['liquido_no_bolso']]] as $l): ?>
        <tr><td><?= h($l[0]) ?></td><td class="n"><?= h(fin_brl($l[1])) ?></td></tr><?php endforeach; ?></tbody></table></div>
    <?php if ($me['fator_r'] < FIN_FATOR_R_MINIMO): ?><div class="faixa" style="margin:12px 0 0">Fator R de <?= h(fin_pct($me['fator_r'])) ?> &lt; 28%: tributação pelo <b>Anexo V</b>. Com pró-labore de <b><?= h(fin_brl($me['pro_labore_para_fator_r'])) ?></b> a empresa passa ao Anexo III — veja o comparativo.</div>
    <?php else: ?><div class="faixa ok-faixa" style="margin:12px 0 0">✔ Fator R ≥ 28%: tributação pelo Anexo III (alíquota inicial 6%).</div><?php endif; ?>
    <?php if ($me['epp']): ?><div class="faixa" style="margin:8px 0 0">RBT12 acima de R$ 360 mil: a empresa deixa de ser ME e passa a EPP (mesmas tabelas).</div><?php endif; ?>
    <p class="fv-rodape">Lucros distribuídos são isentos para a pessoa física, mas a Lei 15.270/2025 retém 10% de IR sobre o que passar de R$ 50 mil/mês pago por uma mesma empresa.</p>

<?php else:
    $recC = fv_num($_GET, 'receita', 6000);
    $despC = fv_num($_GET, 'despesas', 800);
    $opcoes = [];
    if ($recC * 12 <= FIN_MEI_LIMITE_ANUAL) {
        $mm = fin_mei($recC, 'servicos', $despC);
        $opcoes[] = ['MEI*', $mm['liquido'], $mm['das']];
    }
    $a = fin_me_simples($recC, FIN_SALARIO_MINIMO, $despC);
    $b = fin_me_simples($recC, $recC * FIN_FATOR_R_MINIMO, $despC);
    $opcoes[] = ['ME · pró-labore mínimo (Anexo ' . $a['anexo'] . ')', $a['liquido_no_bolso'], $a['das'] + $a['inss_pro_labore'] + $a['irrf_pro_labore']];
    $opcoes[] = ['ME · Fator R 28% (Anexo ' . $b['anexo'] . ')', $b['liquido_no_bolso'], $b['das'] + $b['inss_pro_labore'] + $b['irrf_pro_labore']];
?>
    <p class="nota"><b>Mesmo faturamento, formatos diferentes</b> — quanto sobra no bolso?</p>
    <form method="get" class="barra-filtros"><input type="hidden" name="v" value="imp"><input type="hidden" name="t" value="cmp">
      <label>Faturamento mensal (R$)<input type="text" inputmode="decimal" name="receita" value="<?= h(fv_fmt_form($recC)) ?>"></label>
      <label>Despesas do negócio (R$/mês)<input type="text" inputmode="decimal" name="despesas" value="<?= h(fv_fmt_form($despC)) ?>"></label><button class="btn primario">Comparar</button></form>
    <div class="grafico"><canvas id="gCmp"></canvas></div>
    <div class="tabela-rolagem" style="margin-top:12px"><table class="fv-tabela"><thead><tr><th>Formato</th><th class="n">Sobra no bolso</th><th class="n">Impostos</th><th class="n">Carga</th></tr></thead><tbody>
      <?php foreach ($opcoes as $o): ?><tr><td><?= h($o[0]) ?></td><td class="n"><b><?= h(fin_brl($o[1])) ?></b></td><td class="n"><?= h(fin_brl($o[2])) ?></td><td class="n"><?= $recC > 0 ? h(fin_pct($o[2] / $recC)) : '—' ?></td></tr><?php endforeach; ?></tbody></table></div>
    <p class="fv-rodape">*MEI só aparece se o faturamento anual couber no limite — e <b>engenharia não é atividade permitida ao MEI</b>.</p>
<?php
    $scripts = '
const D=' . fv_json(['x' => array_column($opcoes, 0), 'bolso' => array_map(function ($o) { return round($o[1], 2); }, $opcoes), 'imp' => array_map(function ($o) { return round($o[2], 2); }, $opcoes)]) . ';
new Chart(document.getElementById("gCmp"),{type:"bar",data:{labels:D.x,datasets:[
 {label:"Sobra no bolso",data:D.bolso,backgroundColor:"#2a78d6",borderRadius:4,maxBarThickness:60},
 {label:"Impostos",data:D.imp,backgroundColor:"#eb6834",borderRadius:4,maxBarThickness:60}]},options:OPC_Y()});
';
endif; ?>
  </section>
<?php
// ================================================================= INVESTIMENTOS
else:
    $g = function ($k, $pad) { return fv_num($_GET, $k, $pad); };
    $selic = $g('selic', $cfg['selic'] * 100) / 100;
    $cdi = $g('cdi', $cfg['cdi'] * 100) / 100;
    $ipca = $g('ipca', $cfg['ipca'] * 100) / 100;
    $inicial = max(0, $g('inicial', 10000));
    $aporte = max(0, $g('aporte', 1000));
    $prazo = (int)max(6, min(120, $g('prazo', 36)));
    $pctCdb = max(50, min(200, $g('cdb', 105)));
    $pctLci = max(50, min(200, $g('lci', 90)));
    $spread = max(0, min(5, $g('spread', 0.05)));
    $mk = ['selic' => $selic, 'cdi' => $cdi, 'ipca' => $ipca];
    $prods = [['CDB', $pctCdb / 100, '#2a78d6'], ['LCI/LCA', $pctLci / 100, '#1baf7a'], ['Tesouro Selic', $spread / 100, '#eb6834'], ['Poupança', 0.0, '#6b6a66']];
    $sims = [];
    $linhasTab = [];
    foreach ($prods as $p) {
        $sims[$p[0]] = fin_simular($p[0], $p[1], $inicial, $aporte, $prazo, $mk);
        $u = end($sims[$p[0]]);
        $linhasTab[] = ['Produto' => $p[0], 'investido' => $u['investido'], 'bruto' => $u['bruto'], 'ir' => $u['ir'], 'liquido' => $u['liquido'], 'ganho' => $u['liquido'] - $u['investido'],
            'pct' => $u['investido'] > 0 ? $u['liquido'] / $u['investido'] - 1 : 0];
    }
    usort($linhasTab, function ($a, $b) { return $b['liquido'] <=> $a['liquido']; });
    $melhor = $linhasTab[0]['Produto'];
    $dias = $prazo * 30;
    $pctF = function ($v) { return number_format($v * 100, 2, ',', ''); };
?>
  <section class="bloco">
    <div class="bloco-cab"><div><h2>Investimentos em renda fixa</h2><span class="nota">CDB, LCI/LCA, Tesouro Selic e poupança, com CDI, Selic e IR regressivo.</span></div>
      <form method="post"><input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="acao" value="taxas_bcb"><button class="btn">🔄 Buscar taxas no Banco Central</button></form></div>
    <form method="get" class="barra-filtros"><input type="hidden" name="v" value="inv">
      <label>Selic meta (% a.a.)<input type="text" inputmode="decimal" name="selic" value="<?= h($pctF($selic)) ?>"></label>
      <label>CDI (% a.a.)<input type="text" inputmode="decimal" name="cdi" value="<?= h($pctF($cdi)) ?>"></label>
      <label>IPCA 12m (%)<input type="text" inputmode="decimal" name="ipca" value="<?= h($pctF($ipca)) ?>"></label>
      <label>Valor inicial (R$)<input type="text" inputmode="decimal" name="inicial" value="<?= h(fv_fmt_form($inicial)) ?>"></label>
      <label>Aporte mensal (R$)<input type="text" inputmode="decimal" name="aporte" value="<?= h(fv_fmt_form($aporte)) ?>"></label>
      <label>Prazo (meses, 6–120)<input type="number" name="prazo" min="6" max="120" value="<?= (int)$prazo ?>"></label>
      <label>CDB (% do CDI)<input type="text" inputmode="decimal" name="cdb" value="<?= h(fv_fmt_form($pctCdb)) ?>"></label>
      <label>LCI/LCA (% do CDI)<input type="text" inputmode="decimal" name="lci" value="<?= h(fv_fmt_form($pctLci)) ?>"></label>
      <label>Tesouro Selic — spread (% a.a.)<input type="text" inputmode="decimal" name="spread" value="<?= h(fv_fmt_form($spread)) ?>"></label>
      <button class="btn primario">Simular</button>
    </form>
    <div class="grafico alto"><canvas id="gInv"></canvas></div>
    <div class="tabela-rolagem" style="margin-top:12px"><table class="fv-tabela">
      <thead><tr><th>Produto</th><th class="n">Investido</th><th class="n">Saldo bruto</th><th class="n">IR</th><th class="n">Saldo líquido</th><th class="n">Ganho líquido</th><th class="n">Ganho s/ investido</th></tr></thead>
      <tbody><?php foreach ($linhasTab as $l): ?><tr><td><b><?= h($l['Produto']) ?></b><?= $l['Produto'] === $melhor ? ' <span class="farol f-verde">melhor líquido</span>' : '' ?></td>
        <td class="n"><?= h(fin_brl($l['investido'])) ?></td><td class="n"><?= h(fin_brl($l['bruto'])) ?></td><td class="n"><?= h(fin_brl($l['ir'])) ?></td>
        <td class="n"><b><?= h(fin_brl($l['liquido'])) ?></b></td><td class="n"><?= h(fin_brl($l['ganho'])) ?></td><td class="n"><?= h(fin_pct($l['pct'], 2)) ?></td></tr><?php endforeach; ?></tbody>
    </table></div>
    <p style="margin-top:12px"><b>Leitura do especialista:</b> no prazo de <?= (int)$prazo ?> meses o melhor líquido é <b><?= h($melhor) ?></b>. Alíquota de IR regressivo para <?= (int)$prazo ?> meses: <b><?= h(fin_pct(fin_aliquota_ir($dias))) ?></b>.
      Uma LCI/LCA a <?= h(fv_fmt_form($pctLci)) ?>% do CDI (isenta) equivale a um CDB de <b><?= h(fin_pct(fin_equivalente_cdb($pctLci / 100, $dias) , 1)) ?> do CDI</b>.
      Rendimento real (descontada a inflação) do CDB: <b><?= h(fin_pct((1 + $cdi * $pctCdb / 100) / (1 + $ipca) - 1, 2)) ?> a.a.</b> antes do IR.</p>
    <form method="post" class="fv-acoes"><input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="acao" value="taxas_salvar">
      <input type="hidden" name="selic" value="<?= h($pctF($selic)) ?>"><input type="hidden" name="cdi" value="<?= h($pctF($cdi)) ?>"><input type="hidden" name="ipca" value="<?= h($pctF($ipca)) ?>">
      <button class="btn">Salvar Selic/CDI/IPCA como padrão</button></form>
    <p class="fv-rodape">Simplificações: CDI constante, 252 dias úteis por ano, 30 dias por mês, sem IOF (isento após 30 dias) e sem FGC. LCI/LCA e poupança são isentas de IR para pessoa física.
      As taxas iniciais são valores de referência: atualize com o botão do Banco Central ou digite as vigentes.</p>
  </section>
<?php
    $eixo = array_column($sims['CDB'], 'mes');
    $series = [];
    foreach ($prods as $p) {
        $series[] = ['label' => $p[0], 'data' => array_map(function ($x) { return round($x['liquido'], 2); }, $sims[$p[0]]), 'cor' => $p[2]];
    }
    $scripts = '
const D=' . fv_json(['x' => $eixo, 's' => $series, 'inv' => array_map(function ($x) { return round($x['investido'], 2); }, $sims['CDB'])]) . ';
const ds=D.s.map(function(s){return{label:s.label,data:s.data,borderColor:s.cor,backgroundColor:s.cor,borderWidth:2,pointRadius:0,pointHoverRadius:4,tension:0}});
ds.push({label:"Total investido",data:D.inv,borderColor:TXT,backgroundColor:TXT,borderWidth:1.5,borderDash:[4,4],pointRadius:0,tension:0});
const o=OPC_Y();o.interaction={mode:"index",intersect:false};o.scales.x={grid:{display:false},ticks:{color:MUT,maxTicksLimit:12},title:{display:true,text:"meses",color:MUT}};
new Chart(document.getElementById("gInv"),{type:"line",data:{labels:D.x,datasets:ds},options:o});
';
endif;
?>
</main>
<?php if ($scripts !== ''): ?>
<script src="chart.umd.js"></script>
<script>
(function(){
const css=getComputedStyle(document.documentElement);
const cor=function(n,p){return (css.getPropertyValue(n)||p).trim()||p};
window.TXT=cor("--fg","#1c1b18");window.MUT=cor("--fg2","#5f5c54");window.GRID=cor("--linha","#e3e0d8");window.BG=cor("--card","#ffffff");
window.BRL=function(v){return Number(v).toLocaleString("pt-BR",{style:"currency",currency:"BRL"})};
window.BRL0=function(v){var a=Math.abs(v);return (v<0?"-":"")+"R$ "+(a>=1000?(a/1000).toLocaleString("pt-BR",{maximumFractionDigits:1})+" mil":a.toLocaleString("pt-BR"))};
window.OPC_Y=function(empilhado){return{responsive:true,maintainAspectRatio:false,interaction:{mode:"index",intersect:false},
 plugins:{legend:{position:"top",align:"start",labels:{color:MUT,usePointStyle:true,boxWidth:8}},tooltip:{callbacks:{label:function(c){return " "+c.dataset.label+": "+BRL(c.parsed.y!==undefined?c.parsed.y:c.parsed.x)}}}},
 scales:{x:{stacked:!!empilhado,grid:{display:false},ticks:{color:MUT}},y:{beginAtZero:true,stacked:!!empilhado,grid:{color:GRID},ticks:{color:MUT,callback:function(v){return BRL0(v)}}}}}};
})();
</script>
<script><?= $scripts ?></script>
<?php endif; ?>
<script>document.getElementById('sidebarToggle').onclick=function(){document.getElementById('sidebar').classList.toggle('aberta')};document.querySelectorAll('.sidebar-titulo').forEach(function(x){x.onclick=function(){x.classList.toggle('aberto');x.nextElementSibling&&x.nextElementSibling.classList.toggle('aberto')}});</script>
</body></html>
