<?php
// SESMT GERAL: painel e cadastros de segurança do trabalho, convertidos da planilha "Gestão SST - Rótula".
// Página própria. Não altera nenhuma tela ou tabela existente.
require __DIR__ . '/inc/nucleo.php';
require __DIR__ . '/inc/sesmt_modelo.php';

$eu = exigir_login_pagina();
if (isset($_GET['acesso'])) {
    responder_json(200, ['ok' => sesmt_pode_ver($eu)]);
}
$obra = exigir_obra_pagina();

if (!sesmt_pode_ver($eu)) {
    http_response_code(403);
    pagina_inicio('SESMT GERAL');
    echo '<main class="admin"><section class="bloco"><div class="bloco-cab"><h2>SESMT GERAL</h2></div>'
        . '<div class="faixa">Este módulo guarda dados pessoais e de saúde dos colaboradores e exige liberação. '
        . 'Peça ao administrador para liberar o acesso em SESMT GERAL → Acessos.</div>'
        . '<p><a class="btn" href="index.php">Voltar ao sistema</a></p></section></main></body></html>';
    exit;
}

sesmt_garantir_esquema();
$podeEditar = sesmt_pode_editar($eu);
$ehAdmin = ($eu['perfil'] ?? '') === 'admin';
$csrf = token_csrf();
$REG = sesmt_registros();

// ----------------------------------------------------------------- utilidades de tela

function sv_url(array $p = [])
{
    return 'sesmt.php' . ($p ? '?' . http_build_query($p) : '');
}

function sv_flash($tipo, $msg)
{
    $_SESSION['sesmt_flash'] = [$tipo, $msg];
}

function sv_redirecionar($url)
{
    header('Location: ' . $url);
    exit;
}

function sv_farol($cel)
{
    if (!isset($cel['v']) || $cel['v'] === '') {
        return '<span class="nota">—</span>';
    }
    return $cel['tom'] ? '<span class="farol f-' . h($cel['tom']) . '">' . h($cel['v']) . '</span>' : h($cel['v']);
}

function sv_texto_valor($reg, $k, array $c, array $r)
{
    $tipo = explode(':', $c['tipo'])[0];
    $v = $r[$k] ?? null;
    if ($v === null || $v === '') {
        return '';
    }
    switch ($tipo) {
        case 'data':
            return sesmt_fmt_data($v);
        case 'cpf':
            return sesmt_cpf_exibir($v, true);
        case 'num':
            return sesmt_fmt_num($v, floor((float)$v) == (float)$v ? 0 : 2);
        case 'ref':
            return $r['refs'][$k] ?? '';
        default:
            return (string)$v;
    }
}

function sv_num_form($v)
{
    return $v === null || $v === '' ? '' : rtrim(rtrim(number_format((float)$v, 6, ',', ''), '0'), ',');
}

function sv_input($reg, $k, array $c, $valor)
{
    $tipo = explode(':', $c['tipo'])[0];
    $arg = strpos($c['tipo'], ':') !== false ? explode(':', $c['tipo'])[1] : null;
    $id = 'f_' . $k;
    $req = !empty($c['r']) ? ' required' : '';
    $nome = ' name="' . h($k) . '" id="' . h($id) . '"';
    switch ($tipo) {
        case 'longo':
            return '<textarea' . $nome . ' rows="3"' . $req . '>' . h($valor) . '</textarea>';
        case 'data':
            return '<input type="date"' . $nome . ' value="' . h($valor) . '"' . $req . '>';
        case 'hora':
            return '<input type="time"' . $nome . ' value="' . h($valor) . '"' . $req . '>';
        case 'num':
            return '<input type="text" inputmode="decimal"' . $nome . ' value="' . h(is_numeric($valor) ? sv_num_form($valor) : $valor) . '"' . $req . '>';
        case 'int':
            $dl = $arg ? ' list="dl_' . h($arg) . '"' : '';
            $out = '<input type="number" min="0" step="1"' . $nome . ' value="' . h($valor) . '"' . $dl . $req . '>';
            if ($arg) {
                $out .= '<datalist id="dl_' . h($arg) . '">';
                foreach (sesmt_opcoes($arg) as $o) {
                    $out .= '<option value="' . h($o) . '">';
                }
                $out .= '</datalist>';
            }
            return $out;
        case 'cpf':
            $mostrar = preg_match('/^\d{11}$/', (string)$valor) ? sesmt_cpf_exibir($valor, false) : $valor;
            return '<input type="text" inputmode="numeric" maxlength="14" autocomplete="off"' . $nome . ' value="' . h($mostrar) . '" placeholder="000.000.000-00">';
        case 'empresa':
            $out = '<input type="text" list="dl_empresas" maxlength="100" autocomplete="off" placeholder="Escolha da lista ou digite"' . $nome . ' value="' . h($valor) . '"' . $req . '>';
            return $out;
        case 'lista':
            $opcoes = sesmt_opcoes($arg);
            if ($valor !== null && $valor !== '' && !in_array($valor, $opcoes, true)) {
                array_unshift($opcoes, $valor);
            }
            $out = '<select' . $nome . $req . '><option value="">—</option>';
            foreach ($opcoes as $o) {
                $out .= '<option value="' . h($o) . '"' . ((string)$o === (string)$valor ? ' selected' : '') . '>' . h($o) . '</option>';
            }
            return $out . '</select>';
        case 'ref':
            $out = '<select' . $nome . $req . '><option value="">—</option>';
            foreach (sesmt_opcoes_ref($arg) as $idRef => $rot) {
                $out .= '<option value="' . (int)$idRef . '"' . ((string)$idRef === (string)$valor ? ' selected' : '') . '>' . h($rot) . '</option>';
            }
            return $out . '</select>';
        default:
            return '<input type="text" maxlength="255"' . $nome . ' value="' . h($valor) . '"' . $req . '>';
    }
}

/** Colunas da tabela de um cadastro: [rótulo, função que devolve o HTML, função que devolve o texto (CSV)]. */
function sv_colunas($reg)
{
    $def = sesmt_registros()[$reg];
    $cols = [];
    if ($def['emp'] === 'colab') {
        $cols[] = ['Empresa', function ($r) { return $r['empresa_exib'] !== '' ? '<b>' . h($r['empresa_exib']) . '</b>' : '<span class="nota">—</span>'; },
            function ($r) { return $r['empresa_exib']; }];
    }
    foreach ($def['campos'] as $k => $c) {
        if (empty($c['l'])) {
            continue;
        }
        $cols[] = [$c['rotulo'],
            function ($r) use ($reg, $k, $c) {
                $t = sv_texto_valor($reg, $k, $c, $r);
                if ($t === '') {
                    return '<span class="nota">—</span>';
                }
                $tipo = explode(':', $c['tipo'])[0];
                if ($tipo === 'longo' && mb_strlen($t, 'UTF-8') > 90) {
                    $t = mb_substr($t, 0, 90, 'UTF-8') . '…';
                }
                return $k === 'nome' || $k === 'treinamento' ? '<b>' . h($t) . '</b>' : h($t);
            },
            function ($r) use ($reg, $k, $c) { return sv_texto_valor($reg, $k, $c, $r); }];
    }
    foreach ($def['calc'] as $k => $rotulo) {
        $cols[] = [$rotulo, function ($r) use ($k) { return sv_farol($r['calc'][$k] ?? ['v' => '']); },
            function ($r) use ($k) { return $r['calc'][$k]['v'] ?? ''; }];
    }
    return $cols;
}

function sv_tem_situacao($reg)
{
    foreach (array_keys(sesmt_registros()[$reg]['calc']) as $k) {
        if (strpos($k, 'situacao') === 0) {
            return true;
        }
    }
    return false;
}

// ----------------------------------------------------------------- ações (POST)

$erros = [];
$valoresForm = null;
$formReg = null;
$formId = 0;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    conferir_csrf();
    $acao = $_POST['acao'] ?? '';
    $reg = $_POST['reg'] ?? '';
    try {
        if (!$podeEditar) {
            throw new InvalidArgumentException('Seu perfil é somente consulta.');
        }
        if ($acao === 'salvar') {
            if (!isset($REG[$reg])) {
                throw new InvalidArgumentException('Cadastro inválido.');
            }
            $formReg = $reg;
            $formId = (int)($_POST['id'] ?? 0);
            list($idSalvo, $erros) = sesmt_salvar($reg, $formId, $_POST);
            if (!$erros) {
                sv_flash('ok', 'Registro salvo.');
                sv_redirecionar(sv_url(['reg' => $reg]));
            }
            $valoresForm = $_POST;
        } elseif ($acao === 'excluir') {
            if (!isset($REG[$reg])) {
                throw new InvalidArgumentException('Cadastro inválido.');
            }
            $msg = sesmt_excluir($reg, (int)($_POST['id'] ?? 0));
            sv_flash($msg === '' ? 'ok' : 'erro', $msg === '' ? 'Registro excluído.' : $msg);
            sv_redirecionar(sv_url(['reg' => $reg]));
        } elseif ($acao === 'presenca_lote') {
            list($ok, $ign, $err) = sesmt_salvar_presenca_lote((int)($_POST['treinamento_id'] ?? 0),
                is_array($_POST['colaboradores'] ?? null) ? $_POST['colaboradores'] : [], trim((string)($_POST['obs'] ?? '')));
            if ($err) {
                $erros = $err;
                $formReg = 'presenca';
                $valoresForm = $_POST;
            } else {
                sv_flash('ok', $ok . ' participante(s) incluído(s)' . ($ign ? ', ' . $ign . ' já estava(m) na lista.' : '.'));
                sv_redirecionar(sv_url(['reg' => 'presenca']));
            }
        } elseif ($acao === 'lista_add') {
            sesmt_lista_adicionar($_POST['lista'] ?? '', $_POST['valor'] ?? '');
            sv_flash('ok', 'Valor adicionado à lista.');
            sv_redirecionar(sv_url(['v' => 'listas']) . '#' . rawurlencode((string)($_POST['lista'] ?? '')));
        } elseif ($acao === 'lista_del') {
            sesmt_lista_remover($_POST['lista'] ?? '', $_POST['valor'] ?? '');
            sv_flash('ok', 'Valor removido da lista. Registros que já usavam esse valor continuam como estão.');
            sv_redirecionar(sv_url(['v' => 'listas']) . '#' . rawurlencode((string)($_POST['lista'] ?? '')));
        } elseif ($acao === 'cfg') {
            if (!$ehAdmin) {
                throw new InvalidArgumentException('Somente o administrador altera as configurações.');
            }
            sesmt_cfg_salvar($_POST);
            registrar_global('sesmt_config', ['obra' => obra_atual_id()]);
            sv_flash('ok', 'Configurações salvas.');
            sv_redirecionar(sv_url(['v' => 'config']));
        } elseif ($acao === 'acesso') {
            if (!$ehAdmin) {
                throw new InvalidArgumentException('Somente o administrador libera acessos.');
            }
            sesmt_alterar_acesso((int)($_POST['usuario'] ?? 0), ($_POST['liberar'] ?? '') === '1');
            registrar_global('sesmt_acesso', ['usuario' => (int)($_POST['usuario'] ?? 0), 'liberar' => ($_POST['liberar'] ?? '') === '1']);
            sv_flash('ok', 'Acesso atualizado.');
            sv_redirecionar(sv_url(['v' => 'acessos']));
        } else {
            throw new InvalidArgumentException('Ação inválida.');
        }
    } catch (Throwable $e) {
        $msgErro = $e instanceof InvalidArgumentException ? $e->getMessage() : 'Não foi possível gravar agora. Tente novamente.';
        if (!($e instanceof InvalidArgumentException)) {
            error_log('SESMT: ' . $e->getMessage());
        }
        $erros = [$msgErro];
        if ($formReg === null && in_array($acao, ['lista_add', 'lista_del', 'cfg', 'acesso'], true)) {
            sv_flash('erro', $msgErro);
            $destino = $acao === 'cfg' ? 'config' : ($acao === 'acesso' ? 'acessos' : 'listas');
            sv_redirecionar(sv_url(['v' => $destino]));
        }
    }
}

$flash = $_SESSION['sesmt_flash'] ?? null;
unset($_SESSION['sesmt_flash']);

// ----------------------------------------------------------------- roteamento (GET)

$v = $_GET['v'] ?? '';
$reg = $_GET['reg'] ?? '';
if ($formReg !== null) {
    $reg = $formReg;
}
if ($reg !== '' && !isset($REG[$reg])) {
    $reg = '';
}
if ($reg === '' && !in_array($v, ['listas', 'config', 'acessos'], true)) {
    $v = 'painel';
}
$modo = $_GET['modo'] ?? 'lista';
if ($formReg !== null) {
    $modo = 'form';
}

$filtros = [
    'empresa' => trim((string)($_GET['empresa'] ?? '')),
    'q' => trim((string)($_GET['q'] ?? '')),
    'sit' => in_array($_GET['sit'] ?? '', ['critico', 'atencao', 'ok'], true) ? $_GET['sit'] : '',
];

// exportação em CSV (antes de qualquer saída)
if ($reg !== '' && $modo === 'lista' && ($_GET['export'] ?? '') === 'csv') {
    $linhas = sesmt_listar($reg, $filtros);
    $cols = sv_colunas($reg);
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="sesmt_' . $reg . '_' . sesmt_hoje() . '.csv"');
    $out = fopen('php://output', 'w');
    fwrite($out, "\xEF\xBB\xBF");
    fputcsv($out, array_map(function ($c) { return $c[0]; }, $cols), ';');
    foreach ($linhas as $r) {
        fputcsv($out, array_map(function ($c) use ($r) { return $c[2]($r); }, $cols), ';');
    }
    fclose($out);
    registrar_global('sesmt_exportar', ['cadastro' => $reg, 'linhas' => count($linhas), 'obra' => obra_atual_id()]);
    exit;
}

// ----------------------------------------------------------------- layout

$titulo = $reg !== '' ? $REG[$reg]['titulo'] : ['painel' => 'Painel SESMT', 'listas' => 'Fontes de dados', 'config' => 'Configurações', 'acessos' => 'Acessos'][$v];
pagina_inicio($titulo . ' · SESMT GERAL');

$grupos = [];
foreach ($REG as $k => $d) {
    $grupos[$d['grupo']][$k] = $d['titulo'];
}
function sv_botao($rotulo, $url, $ativo)
{
    return '<button type="button" class="' . ($ativo ? 'ativa' : '') . '" onclick="location.href=\'' . h($url) . '\'">' . h($rotulo) . '</button>';
}
?>
<style>
.sv-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px 16px}
.sv-grid .full{grid-column:1/-1}
.sv-campo{display:flex;flex-direction:column;gap:4px;min-width:0}
.sv-campo label{font-size:.78rem;font-weight:700;color:var(--fg2)}
.sv-campo label .obrig{color:var(--vermelho)}
.sv-campo input,.sv-campo select,.sv-campo textarea{padding:7px 9px;border:1px solid var(--linha-forte);border-radius:6px;background:var(--bg);color:var(--fg);font:inherit;font-size:.9rem;min-width:0;width:100%;box-sizing:border-box}
.sv-campo input[type=checkbox]{width:auto;padding:0}
a.btn{display:inline-block;text-decoration:none;color:var(--fg)}
a.btn.primario{color:#fff}
.sv-campo .dica{font-size:.74rem;color:var(--fg2)}
.sv-erros{margin:0 0 14px;padding:10px 14px;border:1px solid var(--vermelho);border-radius:6px;color:var(--vermelho);background:var(--card)}
.sv-erros ul{margin:4px 0 0 18px;padding:0}
.sv-ajuda{margin:0 0 12px;color:var(--fg2);max-width:80ch}
.sv-acoes{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:14px}
.sv-chips{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}
.sv-chip{display:inline-flex;align-items:center;gap:4px;padding:3px 4px 3px 10px;border:1px solid var(--linha-forte);border-radius:14px;font-size:.84rem;background:var(--card)}
.sv-chip form{display:inline;margin:0}
.sv-chip button{border:0;background:none;cursor:pointer;color:var(--fg2);font-size:1rem;line-height:1;padding:0 6px}
.sv-pag{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:12px}
.sv-pag a{padding:4px 10px;border:1px solid var(--linha-forte);border-radius:6px;text-decoration:none;color:var(--fg)}
.sv-pag a.atual{background:var(--fg);color:var(--bg)}
.sv-presenca{max-height:340px;overflow:auto;border:1px solid var(--linha);border-radius:6px;padding:6px 10px}
.sv-presenca label{display:flex;gap:8px;align-items:center;padding:3px 0;font-size:.88rem}
.sv-presenca .emp{font-weight:700;margin-top:8px;color:var(--fg2);font-size:.78rem;letter-spacing:.03em}
.sv-tabela-pequena td,.sv-tabela-pequena th{white-space:nowrap}
</style>
<header class="topo">
  <div class="marca"><span class="marca-sigla">SST</span><div><h1>SESMT GERAL</h1>
    <div class="arquivo"><span class="ponto ok"></span><?= h($obra['nome']) ?> · segurança e saúde do trabalho</div>
    <div class="usuario"><span><?= h($eu['nome']) ?></span><a href="dashboard_admin.php">Dashboard geral</a><a href="index.php">Voltar ao sistema</a><a href="sair.php">Sair</a></div></div></div>
</header>
<button class="sidebar-toggle" id="sidebarToggle" aria-label="Menu">☰</button>
<aside class="sidebar" id="sidebar"><nav class="sidebar-nav">
  <div class="sidebar-grupo sidebar-dashboard"><div class="sidebar-itens aberto"><?= sv_botao('← Voltar ao sistema', 'index.php', false) ?><?= sv_botao('Painel SESMT', sv_url(), $v === 'painel' && $reg === '') ?></div></div>
<?php foreach ($grupos as $nomeGrupo => $itens): ?>
  <div class="sidebar-grupo"><div class="sidebar-titulo aberto"><?= h($nomeGrupo) ?><span class="seta-grupo">&#8249;</span></div>
    <div class="sidebar-itens aberto"><?php foreach ($itens as $k => $rot) { echo sv_botao($rot, sv_url(['reg' => $k]), $reg === $k); } ?></div></div>
<?php endforeach; ?>
  <div class="sidebar-grupo"><div class="sidebar-titulo aberto">Configurar<span class="seta-grupo">&#8249;</span></div>
    <div class="sidebar-itens aberto"><?= sv_botao('Fontes de dados (listas)', sv_url(['v' => 'listas']), $v === 'listas') ?><?= sv_botao('Configurações', sv_url(['v' => 'config']), $v === 'config') ?><?php if ($ehAdmin) { echo sv_botao('Acessos', sv_url(['v' => 'acessos']), $v === 'acessos'); } ?></div></div>
</nav></aside>
<main class="admin">
<?php if ($flash): ?><div class="faixa <?= $flash[0] === 'ok' ? 'ok-faixa' : '' ?>"><?= h($flash[1]) ?></div><?php endif; ?>
<?php if ($erros && $modo !== 'form'): ?><div class="faixa"><?= h(implode(' ', $erros)) ?></div><?php endif; ?>

<?php
// ================================================================= PAINEL
if ($reg === '' && $v === 'painel'):
    $P = sesmt_painel();
    $A = $P['acid'];
    $tile = function ($rot, $val, $sub, $cor) {
        return '<div class="tile" style="--c:' . $cor . '"><div class="rot"><span>' . h($rot) . '</span></div><div class="val">' . $val . '</div><div class="sub">' . h($sub) . '</div></div>';
    };
    $irregAso = $P['aso']['vencidos'] + $P['aso']['sem_aso'];
    $pctMeta = $A['dias_sem'] !== null && $A['meta'] > 0 ? min(100, round($A['dias_sem'] / $A['meta'] * 100)) : 100;
?>
  <section class="bloco">
    <div class="bloco-cab"><div><h2>Painel SESMT</h2><span class="nota">Indicadores calculados com os cadastros da obra. Atualizado em <?= h(sesmt_fmt_data($P['hoje'])) ?> (horário de Brasília).</span></div></div>
    <div class="tiles">
      <?= $tile('Colaboradores ativos', (int)$P['colab_ativos'], 'de ' . (int)$P['colab_total'] . ' cadastrados', 'var(--fg)') ?>
      <?= $tile('Dias sem acidente', $A['dias_sem'] === null ? '—' : (int)$A['dias_sem'], $A['dias_sem'] === null ? 'nenhum acidente registrado' : 'meta de ' . (int)$A['meta'] . ' dias (' . $pctMeta . '%)', 'var(--verde)') ?>
      <?= $tile('Acidentes no ano', (int)$A['ano'], (int)$A['afastamento'] . ' com afastamento', $A['ano'] ? 'var(--vermelho)' : 'var(--verde)') ?>
      <?= $tile('ASO irregular', $irregAso, $P['aso']['vencidos'] . ' vencido(s) · ' . $P['aso']['sem_aso'] . ' sem ASO', $irregAso ? 'var(--vermelho)' : 'var(--verde)') ?>
      <?= $tile('Treinamentos vencidos', (int)$P['trein']['vencidos'], (int)$P['trein']['a_vencer'] . ' a vencer em 30 dias', $P['trein']['vencidos'] ? 'var(--vermelho)' : 'var(--verde)') ?>
      <?= $tile('Não conformidades abertas', (int)$P['nc_pendentes'], 'das auditorias registradas', $P['nc_pendentes'] ? 'var(--amarelo)' : 'var(--verde)') ?>
    </div>
    <?php if ($A['dias_sem'] !== null): ?><div style="margin-top:12px"><div class="barra" title="<?= (int)$pctMeta ?>%"><i style="width:<?= (int)$pctMeta ?>%"></i></div>
      <span class="nota">Último acidente em <?= h(sesmt_fmt_data($A['ultimo'])) ?>.</span></div><?php endif; ?>
  </section>

  <section class="bloco">
    <div class="bloco-cab"><div><h2>Pendências e vencimentos</h2><span class="nota">Clique no número para abrir só os itens daquela situação.</span></div></div>
    <div class="tabela-rolagem"><table class="sv-tabela-pequena">
      <thead><tr><th>Controle</th><th class="n">Críticos / vencidos</th><th class="n">Atenção / a vencer</th><th class="n">Em dia</th></tr></thead>
      <tbody>
        <tr><td><b>ASO dos colaboradores ativos</b></td>
          <td class="n"><?= $P['aso']['vencidos'] ? '<a href="' . h(sv_url(['reg' => 'aso', 'sit' => 'critico'])) . '"><span class="farol f-vermelho">' . (int)$P['aso']['vencidos'] . '</span></a>' : 0 ?> <span class="nota">+ <?= (int)$P['aso']['sem_aso'] ?> sem ASO</span></td>
          <td class="n"><?= $P['aso']['a_vencer'] ? '<a href="' . h(sv_url(['reg' => 'aso', 'sit' => 'atencao'])) . '"><span class="farol f-amarelo">' . (int)$P['aso']['a_vencer'] . '</span></a>' : 0 ?></td><td class="n"><?= (int)$P['aso']['validos'] ?></td></tr>
        <tr><td><b>Treinamentos</b></td>
          <td class="n"><?= $P['trein']['vencidos'] ? '<a href="' . h(sv_url(['reg' => 'treinamentos', 'sit' => 'critico'])) . '"><span class="farol f-vermelho">' . (int)$P['trein']['vencidos'] . '</span></a>' : 0 ?></td>
          <td class="n"><?= $P['trein']['a_vencer'] ? '<a href="' . h(sv_url(['reg' => 'treinamentos', 'sit' => 'atencao'])) . '"><span class="farol f-amarelo">' . (int)$P['trein']['a_vencer'] . '</span></a>' : 0 ?></td><td class="n"><?= (int)$P['trein']['validos'] ?></td></tr>
        <?php foreach ($P['alertas'] as $a): ?>
        <tr><td><?= h($a['rotulo']) ?></td>
          <td class="n"><?= $a['n']['vermelho'] ? '<a href="' . h(sv_url(['reg' => $a['reg'], 'sit' => 'critico'])) . '"><span class="farol f-vermelho">' . (int)$a['n']['vermelho'] . '</span></a>' : 0 ?></td>
          <td class="n"><?= $a['n']['amarelo'] ? '<a href="' . h(sv_url(['reg' => $a['reg'], 'sit' => 'atencao'])) . '"><span class="farol f-amarelo">' . (int)$a['n']['amarelo'] . '</span></a>' : 0 ?></td>
          <td class="n"><?= (int)$a['n']['verde'] ?></td></tr>
        <?php endforeach; ?>
      </tbody>
    </table></div>
  </section>

  <section class="bloco">
    <div class="bloco-cab"><div><h2>Por empresa</h2><span class="nota">Colaboradores ativos e pendências de cada empresa. Cadastre a empresa de cada colaborador em Colaboradores.</span></div></div>
    <?php if (!$P['por_empresa']): ?><div class="faixa" style="margin:0">Nenhum colaborador cadastrado ainda. Comece por <a href="<?= h(sv_url(['reg' => 'colaboradores', 'modo' => 'form'])) ?>">Colaboradores</a>.</div>
    <?php else: ?><div class="tabela-rolagem"><table class="sv-tabela-pequena">
      <thead><tr><th>Empresa</th><th class="n">Ativos</th><th class="n">ASO vencido</th><th class="n">Sem ASO</th><th class="n">Treinamento vencido</th><th class="n">Acidentes no ano</th><th class="n">Advertências no ano</th></tr></thead>
      <tbody><?php foreach ($P['por_empresa'] as $emp => $x): ?>
        <tr><td><b><?= h($emp) ?></b></td><td class="n"><a href="<?= h(sv_url(['reg' => 'colaboradores', 'empresa' => $emp])) ?>"><?= (int)$x['ativos'] ?></a></td>
          <td class="n"><?= $x['aso'] ? '<span class="farol f-vermelho">' . (int)$x['aso'] . '</span>' : 0 ?></td>
          <td class="n"><?= $x['sem_aso'] ? '<span class="farol f-amarelo">' . (int)$x['sem_aso'] . '</span>' : 0 ?></td>
          <td class="n"><?= $x['trein'] ? '<span class="farol f-vermelho">' . (int)$x['trein'] . '</span>' : 0 ?></td>
          <td class="n"><?= (int)$x['acid'] ?></td><td class="n"><?= (int)$x['adv'] ?></td></tr>
      <?php endforeach; ?></tbody>
    </table></div><?php endif; ?>
  </section>

  <section class="bloco">
    <div class="bloco-cab"><div><h2>Taxas de acidentes no ano</h2><span class="nota">Estimativa com base na jornada e nos dias trabalhados de Configurações.</span></div></div>
    <div class="tiles">
      <?= $tile('Taxa de frequência (TF)', $A['tf'] === null ? '—' : sesmt_fmt_num($A['tf'], 2), 'acidentes com afastamento × 1.000.000 ÷ horas trabalhadas', 'var(--fg)') ?>
      <?= $tile('Taxa de gravidade (TG)', $A['tg'] === null ? '—' : sesmt_fmt_num($A['tg'], 2), 'dias perdidos × 1.000.000 ÷ horas trabalhadas', 'var(--fg)') ?>
      <?= $tile('Horas trabalhadas (estimadas)', sesmt_fmt_num($A['horas']), $P['colab_ativos'] . ' ativos × ' . $P['cfg']['jornada'] . ' h × ' . $P['cfg']['dias_mes'] . ' dias × ' . (int)substr($P['hoje'], 5, 2) . ' mês(es)', 'var(--fg)') ?>
      <?= $tile('Dias perdidos', (int)$A['dias_perdidos'], 'soma dos afastamentos do ano', 'var(--fg)') ?>
    </div>
  </section>

<?php
// ================================================================= FONTES DE DADOS
elseif ($reg === '' && $v === 'listas'):
    $listas = sesmt_listas_iniciais();
?>
  <section class="bloco">
    <div class="bloco-cab"><div><h2>Fontes de dados (listas das caixas de seleção)</h2>
      <span class="nota">Valores que aparecem nas caixas de seleção dos cadastros. Acrescente ou remova conforme a realidade da obra.</span></div></div>
    <div class="faixa" style="margin:0 0 12px">A lista de nomes de colaboradores <b>não é uma fonte de dados</b>: os colaboradores são cadastrados em
      <a href="<?= h(sv_url(['reg' => 'colaboradores'])) ?>">Colaboradores</a>, cada um com a sua empresa, e as demais telas escolhem a pessoa a partir desse cadastro.</div>
    <?php foreach ($listas as $nome => $def): $fixa = !empty($def[2]); ?>
      <details id="<?= h($nome) ?>" style="margin-bottom:8px" <?= (($_GET['aberta'] ?? '') === $nome) ? 'open' : '' ?>>
        <summary><b><?= h($def[0]) ?></b> <span class="nota">· <?= count(sesmt_opcoes($nome)) ?> valor(es)<?= $fixa ? ' · fixa (usada em cálculos)' : '' ?></span></summary>
        <div class="sv-chips">
          <?php foreach (sesmt_opcoes($nome) as $o): ?>
            <span class="sv-chip"><?= h($o) ?>
              <?php if ($podeEditar && !$fixa): ?><form method="post" onsubmit="return confirm('Remover este valor da lista?')"><input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="acao" value="lista_del"><input type="hidden" name="lista" value="<?= h($nome) ?>"><input type="hidden" name="valor" value="<?= h($o) ?>"><button type="submit" title="Remover" aria-label="Remover <?= h($o) ?>">&times;</button></form><?php endif; ?></span>
          <?php endforeach; ?>
        </div>
        <?php if ($podeEditar && !$fixa): ?><form method="post" class="barra-filtros"><input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="acao" value="lista_add"><input type="hidden" name="lista" value="<?= h($nome) ?>">
          <label>Novo valor<input type="text" name="valor" maxlength="150" required></label><button class="btn primario">Adicionar</button></form><?php endif; ?>
      </details>
    <?php endforeach; ?>
  </section>

<?php
// ================================================================= CONFIGURAÇÕES
elseif ($reg === '' && $v === 'config'):
    $C = sesmt_cfg();
    $rotEmp = ['nome' => 'Nome da empresa', 'cnpj' => 'CNPJ', 'atividade' => 'Atividade econômica', 'grau_risco' => 'Grau de risco', 'endereco' => 'Endereço',
        'cidade' => 'Cidade', 'uf' => 'UF', 'fundacao' => 'Data da fundação', 'responsavel' => 'Responsável pela segurança'];
?>
  <section class="bloco">
    <div class="bloco-cab"><div><h2>Configurações do SESMT</h2><span class="nota">Parâmetros dos cálculos do painel e dados da empresa responsável.</span></div></div>
    <form method="post"><input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="acao" value="cfg">
      <div class="sv-grid">
        <div class="sv-campo"><label for="meta_dias">Meta de dias sem acidente</label><input id="meta_dias" name="meta_dias" type="number" min="1" value="<?= h($C['meta_dias']) ?>" <?= $ehAdmin ? '' : 'disabled' ?>></div>
        <div class="sv-campo"><label for="jornada">Jornada diária (horas)</label><input id="jornada" name="jornada" type="number" min="1" step="0.5" value="<?= h($C['jornada']) ?>" <?= $ehAdmin ? '' : 'disabled' ?>></div>
        <div class="sv-campo"><label for="dias_mes">Dias trabalhados no mês</label><input id="dias_mes" name="dias_mes" type="number" min="1" value="<?= h($C['dias_mes']) ?>" <?= $ehAdmin ? '' : 'disabled' ?>></div>
        <div class="sv-campo"><label for="hidro_extintor_dias">Validade do teste hidrostático do extintor (dias)</label><input id="hidro_extintor_dias" name="hidro_extintor_dias" type="number" min="1" value="<?= h($C['hidro_extintor_dias']) ?>" <?= $ehAdmin ? '' : 'disabled' ?>></div>
        <div class="sv-campo"><label for="hidro_hidrante_dias">Validade do teste hidrostático do hidrante (dias)</label><input id="hidro_hidrante_dias" name="hidro_hidrante_dias" type="number" min="1" value="<?= h($C['hidro_hidrante_dias']) ?>" <?= $ehAdmin ? '' : 'disabled' ?>></div>
      </div>
      <h3 style="margin:18px 0 8px">Informações da empresa</h3>
      <div class="sv-grid">
        <?php foreach ($rotEmp as $k => $rot): ?><div class="sv-campo"><label for="empresa_<?= h($k) ?>"><?= h($rot) ?></label><input id="empresa_<?= h($k) ?>" name="empresa_<?= h($k) ?>" type="text" maxlength="200" value="<?= h($C['empresa'][$k]) ?>" <?= $ehAdmin ? '' : 'disabled' ?>></div><?php endforeach; ?>
      </div>
      <?php if ($ehAdmin): ?><div class="sv-acoes"><button class="btn primario">Salvar configurações</button></div><?php else: ?><p class="nota">Somente o administrador altera as configurações.</p><?php endif; ?>
    </form>
  </section>

<?php
// ================================================================= ACESSOS
elseif ($reg === '' && $v === 'acessos' && $ehAdmin):
    $usuarios = q_global("SELECT id, nome, login, perfil, ativo FROM usuarios ORDER BY nome")->fetchAll();
?>
  <section class="bloco">
    <div class="bloco-cab"><div><h2>Acessos ao SESMT GERAL</h2><span class="nota">O módulo guarda CPF, RG e dados de saúde. O acesso é liberado usuário a usuário; administradores sempre têm acesso.</span></div></div>
    <div class="tabela-rolagem"><table class="sv-tabela-pequena">
      <thead><tr><th>Nome</th><th>Login</th><th>Perfil</th><th>SESMT</th><th>Ação</th></tr></thead>
      <tbody><?php foreach ($usuarios as $u): $adm = $u['perfil'] === 'admin'; $tem = $adm || sesmt_pode_ver($u); ?>
        <tr><td><b><?= h($u['nome']) ?></b></td><td><?= h($u['login']) ?></td><td><?= h(ucfirst($u['perfil'])) ?></td>
          <td><span class="farol f-<?= $tem ? 'verde' : 'pendente' ?>"><?= $adm ? 'SEMPRE' : ($tem ? 'LIBERADO' : 'BLOQUEADO') ?></span></td>
          <td><?php if (!$adm): ?><form method="post" style="display:inline"><input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="acao" value="acesso"><input type="hidden" name="usuario" value="<?= (int)$u['id'] ?>"><input type="hidden" name="liberar" value="<?= $tem ? '0' : '1' ?>"><button class="btn"><?= $tem ? 'Bloquear' : 'Liberar' ?></button></form><?php else: ?><span class="nota">—</span><?php endif; ?></td></tr>
      <?php endforeach; ?></tbody>
    </table></div>
  </section>

<?php
// ================================================================= FORMULÁRIO
elseif ($reg !== '' && $modo === 'form'):
    $def = $REG[$reg];
    $id = $formReg !== null ? $formId : (int)($_GET['id'] ?? 0);
    $linha = $id ? sesmt_obter($reg, $id) : null;
    if ($id && !$linha) {
        echo '<div class="faixa">Registro não encontrado.</div></main></body></html>';
        exit;
    }
    $lote = ($reg === 'presenca' && !$id);
    $valores = [];
    foreach ($def['campos'] as $k => $c) {
        if ($valoresForm !== null) {
            $valores[$k] = $valoresForm[$k] ?? '';
        } elseif ($linha) {
            $valores[$k] = $linha[$k];
        } else {
            $valores[$k] = $c['pad'] ?? ($_GET[$k] ?? '');
        }
    }
?>
  <section class="bloco">
    <div class="bloco-cab"><div><h2><?= $id ? 'Editar' : 'Novo' ?> · <?= h($def['titulo']) ?></h2><span class="nota"><?= h($def['ajuda']) ?></span></div>
      <a class="btn" href="<?= h(sv_url(['reg' => $reg])) ?>">&larr; Voltar à lista</a></div>
    <?php if ($erros): ?><div class="sv-erros" role="alert"><b>Corrija antes de salvar:</b><ul><?php foreach ($erros as $e) { echo '<li>' . h($e) . '</li>'; } ?></ul></div><?php endif; ?>
    <?php if (!$podeEditar): ?><div class="faixa">Seu perfil é somente consulta.</div><?php endif; ?>
    <datalist id="dl_empresas"><?php foreach (sesmt_empresas() as $e) { echo '<option value="' . h($e) . '">'; } ?></datalist>

    <?php if ($lote): ?>
    <form method="post" id="formPresenca"><input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="acao" value="presenca_lote"><input type="hidden" name="reg" value="presenca">
      <div class="sv-grid">
        <div class="sv-campo full"><label for="treinamento_id">Treinamento <span class="obrig">*</span></label>
          <select name="treinamento_id" id="treinamento_id" required><option value="">—</option>
          <?php foreach (sesmt_opcoes_ref('treinamentos') as $tid => $rot): ?><option value="<?= (int)$tid ?>" <?= (string)($valoresForm['treinamento_id'] ?? '') === (string)$tid ? 'selected' : '' ?>><?= h($rot) ?></option><?php endforeach; ?></select></div>
        <div class="sv-campo full"><label for="busca_colab">Colaboradores participantes</label>
          <input type="search" id="busca_colab" placeholder="Filtrar por nome ou empresa" autocomplete="off">
          <div class="sv-presenca" id="listaColab">
            <?php $ultima = null; $marcados = is_array($valoresForm['colaboradores'] ?? null) ? array_map('strval', $valoresForm['colaboradores']) : [];
            $todosColab = sesmt_listar('colaboradores', []);
            usort($todosColab, function ($a, $b) { return strcmp($a['empresa'] . '|' . $a['nome'], $b['empresa'] . '|' . $b['nome']); });
            foreach ($todosColab as $c):
                if ($c['status'] === 'Demitido') { continue; }
                if ($c['empresa'] !== $ultima) { $ultima = $c['empresa']; echo '<div class="emp" data-emp>' . h($ultima ?: 'SEM EMPRESA') . '</div>'; } ?>
              <label data-nome="<?= h(mb_strtolower($c['nome'] . ' ' . $c['empresa'], 'UTF-8')) ?>"><input type="checkbox" name="colaboradores[]" value="<?= (int)$c['id'] ?>" <?= in_array((string)$c['id'], $marcados, true) ? 'checked' : '' ?>> <?= h($c['nome']) ?></label>
            <?php endforeach; ?>
            <?php if ($ultima === null): ?><span class="nota">Nenhum colaborador ativo cadastrado.</span><?php endif; ?>
          </div>
          <div class="sv-acoes" style="margin-top:6px"><button type="button" class="btn" id="marcarVisiveis">Marcar os que aparecem</button><button type="button" class="btn" id="limparMarcas">Limpar marcação</button></div></div>
        <div class="sv-campo full"><label for="obs">Observações</label><input type="text" name="obs" id="obs" maxlength="255" value="<?= h($valoresForm['obs'] ?? '') ?>"></div>
      </div>
      <div class="sv-acoes"><?php if ($podeEditar): ?><button class="btn primario">Incluir na lista de presença</button><?php endif; ?><a class="btn" href="<?= h(sv_url(['reg' => $reg])) ?>">Cancelar</a></div>
    </form>
    <script>
    (function(){var b=document.getElementById('busca_colab'),l=document.getElementById('listaColab');
    function filtrar(){var t=b.value.toLowerCase().trim();l.querySelectorAll('label[data-nome]').forEach(function(x){x.hidden=t&&x.dataset.nome.indexOf(t)<0});
      var vis=false;Array.from(l.children).reverse().forEach(function(el){if(el.hasAttribute('data-emp')){el.hidden=!vis;vis=false}else if(!el.hidden){vis=true}})}
    b.addEventListener('input',filtrar);
    document.getElementById('marcarVisiveis').onclick=function(){l.querySelectorAll('label[data-nome]').forEach(function(x){if(!x.hidden)x.querySelector('input').checked=true})};
    document.getElementById('limparMarcas').onclick=function(){l.querySelectorAll('input[type=checkbox]').forEach(function(x){x.checked=false})};})();
    </script>
    <?php else: ?>
    <form method="post"><input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="acao" value="salvar"><input type="hidden" name="reg" value="<?= h($reg) ?>"><input type="hidden" name="id" value="<?= (int)$id ?>">
      <div class="sv-grid">
        <?php foreach ($def['campos'] as $k => $c): $full = !empty($c['full']) || explode(':', $c['tipo'])[0] === 'longo'; ?>
          <div class="sv-campo <?= $full ? 'full' : '' ?>"><label for="f_<?= h($k) ?>"><?= h($c['rotulo']) ?><?= !empty($c['r']) ? ' <span class="obrig">*</span>' : '' ?></label>
            <?= sv_input($reg, $k, $c, $valores[$k]) ?>
            <?php if (!empty($c['dica'])): ?><span class="dica"><?= h($c['dica']) ?></span><?php endif; ?></div>
        <?php endforeach; ?>
      </div>
      <div class="sv-acoes"><?php if ($podeEditar): ?><button class="btn primario">Salvar</button><?php endif; ?><a class="btn" href="<?= h(sv_url(['reg' => $reg])) ?>">Cancelar</a></div>
    </form>
    <?php if ($id && $podeEditar): ?>
    <form method="post" class="sv-acoes" onsubmit="return confirm('Excluir este registro? Esta ação não pode ser desfeita.')"><input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="acao" value="excluir"><input type="hidden" name="reg" value="<?= h($reg) ?>"><input type="hidden" name="id" value="<?= (int)$id ?>">
      <button class="btn">Excluir <?= h($def['singular']) ?></button></form>
    <?php endif; ?>
    <?php endif; ?>
  </section>

<?php
// ================================================================= LISTA
elseif ($reg !== ''):
    $def = $REG[$reg];
    $linhas = sesmt_listar($reg, $filtros);
    $cols = sv_colunas($reg);
    $pagina = max(1, (int)($_GET['p'] ?? 1));
    $total = count($linhas);
    $paginas = max(1, (int)ceil($total / SESMT_POR_PAGINA));
    $pagina = min($pagina, $paginas);
    $visiveis = array_slice($linhas, ($pagina - 1) * SESMT_POR_PAGINA, SESMT_POR_PAGINA);
    $mostraEmpresa = $def['emp'] !== 'nenhum';
    $params = array_filter(['reg' => $reg, 'empresa' => $filtros['empresa'], 'q' => $filtros['q'], 'sit' => $filtros['sit']], function ($x) { return $x !== ''; });
?>
  <section class="bloco">
    <div class="bloco-cab"><div><h2><?= h($def['titulo']) ?></h2><span class="nota"><?= h($def['ajuda']) ?></span></div>
      <div class="sv-acoes" style="margin:0">
        <?php if ($podeEditar): ?><a class="btn primario" href="<?= h(sv_url(['reg' => $reg, 'modo' => 'form'])) ?>">+ Novo <?= h($def['singular']) ?></a><?php endif; ?>
        <a class="btn" href="<?= h(sv_url($params + ['export' => 'csv'])) ?>">Exportar CSV</a>
      </div></div>
    <form method="get" class="barra-filtros"><input type="hidden" name="reg" value="<?= h($reg) ?>">
      <?php if ($mostraEmpresa): ?><label>Empresa<select name="empresa"><option value="">Todas as empresas</option>
        <?php foreach (sesmt_empresas() as $e): ?><option value="<?= h($e) ?>" <?= sesmt_norm_empresa($filtros['empresa']) === $e ? 'selected' : '' ?>><?= h($e) ?></option><?php endforeach; ?></select></label><?php endif; ?>
      <label>Buscar<input type="search" name="q" value="<?= h($filtros['q']) ?>" placeholder="Digite para buscar" autocomplete="off"></label>
      <?php if (sv_tem_situacao($reg)): ?><label>Situação<select name="sit"><option value="">Todas</option>
        <option value="critico" <?= $filtros['sit'] === 'critico' ? 'selected' : '' ?>>Críticos / vencidos</option>
        <option value="atencao" <?= $filtros['sit'] === 'atencao' ? 'selected' : '' ?>>Atenção / a vencer</option>
        <option value="ok" <?= $filtros['sit'] === 'ok' ? 'selected' : '' ?>>Em dia</option></select></label><?php endif; ?>
      <button class="btn primario">Filtrar</button><a class="btn" href="<?= h(sv_url(['reg' => $reg])) ?>">Limpar</a>
      <span class="nota"><?= (int)$total ?> registro(s)</span>
    </form>
    <?php if (!$linhas): ?>
      <div class="faixa" style="margin:0"><?= ($filtros['q'] !== '' || $filtros['empresa'] !== '' || $filtros['sit'] !== '') ? 'Nenhum registro com esses filtros.' : 'Nada cadastrado ainda.' ?><?= $podeEditar ? ' Use o botão “+ Novo ' . h($def['singular']) . '”.' : '' ?></div>
    <?php else: ?>
    <div class="tabela-rolagem"><table class="sv-tabela-pequena">
      <thead><tr><?php foreach ($cols as $c) { echo '<th>' . h($c[0]) . '</th>'; } ?><th></th></tr></thead>
      <tbody><?php foreach ($visiveis as $r): ?>
        <tr><?php foreach ($cols as $c) { echo '<td>' . $c[1]($r) . '</td>'; } ?>
          <td><a class="btn" href="<?= h(sv_url(['reg' => $reg, 'modo' => 'form', 'id' => $r['id']])) ?>"><?= $podeEditar ? 'Editar' : 'Ver' ?></a></td></tr>
      <?php endforeach; ?></tbody>
    </table></div>
    <?php if ($paginas > 1): ?><nav class="sv-pag" aria-label="Páginas"><?php for ($i = 1; $i <= $paginas; $i++) { echo '<a class="' . ($i === $pagina ? 'atual' : '') . '" href="' . h(sv_url($params + ['p' => $i])) . '">' . $i . '</a>'; } ?></nav><?php endif; ?>
    <?php endif; ?>
  </section>
<?php else: ?>
  <section class="bloco"><div class="faixa">Esta área é restrita ao administrador.</div></section>
<?php endif; ?>
</main>
<script>document.getElementById('sidebarToggle').onclick=function(){document.getElementById('sidebar').classList.toggle('aberta')};document.querySelectorAll('.sidebar-titulo').forEach(function(x){x.onclick=function(){x.classList.toggle('aberto');x.nextElementSibling&&x.nextElementSibling.classList.toggle('aberto')}});</script>
</body></html>
