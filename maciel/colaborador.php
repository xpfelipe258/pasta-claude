<?php
// Ficha do colaborador da empresa (Painel pessoal): dados, alocação em obra (ou sem obra), remuneração/custo e documentos anexados.
require __DIR__ . '/inc/nucleo.php';
require __DIR__ . '/inc/modelo.php';
require __DIR__ . '/inc/central.php';
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

$eu = central_exigir();
garantir_rh_pessoas();
$ver = rh_pode_ver_salarios($eu);
$ctx = rhp_contexto($eu);
$obras = rhp_obras_permitidas($eu);
$id = (int)($_GET['id'] ?? $_POST['id'] ?? 0);
$novo = isset($_GET['novo']) && $id === 0;
$msg = ''; $erro = ''; $erros = [];
$volta = 'pessoal.php?v=colaboradores';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    conferir_csrf();
    $acao = (string)($_POST['acao'] ?? '');
    try {
        if ($acao === 'salvar') {
            $id = rhp_salvar($_POST, $eu, $id);
            $_SESSION['rh_aviso'] = 'Colaborador salvo.';
            header('Location: colaborador.php?id=' . $id); exit;
        } elseif ($acao === 'alocar') {
            rhp_alocar($id, (int)($_POST['obra_id'] ?? 0), $eu, (string)($_POST['alocado_em'] ?? ''));
            $_SESSION['rh_aviso'] = ((int)($_POST['obra_id'] ?? 0) > 0 ? 'Colaborador alocado em ' . ($obras[(int)$_POST['obra_id']] ?? 'obra') : 'Colaborador ficou sem obra (quadro da empresa)') . '.';
            header('Location: ' . (($_POST['volta'] ?? '') === 'lista' ? $volta : 'colaborador.php?id=' . $id)); exit;
        } elseif ($acao === 'excluir') {
            rhp_excluir($id, $eu);
            $_SESSION['rh_aviso'] = 'Colaborador excluído (com os documentos dele).';
            header('Location: ' . $volta); exit;
        } elseif ($acao === 'doc_enviar') {
            rhp_documento_enviar($id, $_POST, $eu);
            $_SESSION['rh_aviso'] = 'Documento anexado à ficha.';
            header('Location: colaborador.php?id=' . $id . '#docs'); exit;
        } elseif ($acao === 'doc_excluir') {
            rhp_documento_excluir((int)($_POST['doc_id'] ?? 0), $eu);
            $_SESSION['rh_aviso'] = 'Documento removido.';
            header('Location: colaborador.php?id=' . $id . '#docs'); exit;
        }
    } catch (RhpValidacao $e) { $erro = $e->getMessage(); $erros = $e->campos; }
    catch (InvalidArgumentException $e) { $erro = $e->getMessage(); }
    catch (Throwable $e) { $erro = 'Falha: ' . $e->getMessage(); }
}
if (!empty($_SESSION['rh_aviso'])) { $msg = $_SESSION['rh_aviso']; unset($_SESSION['rh_aviso']); }

$p = $id > 0 ? rhp_obter($id, $eu) : null;
if ($id > 0 && !$p) { http_response_code(404); exit('Colaborador não encontrado.'); }
if (!$p && !$novo && $_SERVER['REQUEST_METHOD'] !== 'POST') { header('Location: ' . $volta); exit; }
$v = $p ?: ['nome' => '', 'cpf' => '', 'rg' => '', 'nascimento' => '', 'sexo' => '', 'celular' => '', 'email' => '', 'endereco' => '', 'cidade' => '', 'uf' => '', 'funcao' => '', 'setor' => '', 'empresa' => '', 'status' => 'Contratado',
    'admissao' => '', 'desligamento' => '', 'obra_id' => (int)($_GET['obra'] ?? 0), 'alocado_em' => '', 'tipo_salario' => 'Mensal', 'salario' => '', 'adicional' => 'Nenhum', 'vale_transporte' => '', 'alimentacao' => '',
    'outros_beneficios' => '', 'ctps' => '', 'serie' => '', 'obs' => '', 'organizacao_id' => $ctx['org']];
if ($erro && $_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['acao'] ?? '') === 'salvar') { $v = array_merge($v, $_POST); }   // devolve o que foi digitado
$csrf = token_csrf();
$fe = function ($c) use ($erros) { return isset($erros[$c]) ? '<span class="campo-erro">' . h($erros[$c]) . '</span>' : ''; };   // texto vermelho embaixo do campo
$ce = function ($c) use ($erros) { return isset($erros[$c]) ? ' class="tem-erro" aria-invalid="true"' : ''; };
$fm = function ($x) { return $x === '' || $x === null ? '' : number_format((float)$x, 2, ',', '.'); };
$hoje = planos_hoje();
$custo = ($p && $ver) ? rhp_custo($p, substr($hoje, 0, 7)) : null;
$orgsTodas = $ctx['todas'] ? q_global('SELECT id, nome FROM organizacoes ORDER BY nome')->fetchAll() : [];
$obraNome = $p && (int)$p['obra_id'] > 0 ? ($obras[(int)$p['obra_id']] ?? 'Obra #' . (int)$p['obra_id']) : null;
$docs = $p ? rhp_documentos($p['id']) : [];
$orgLista = $p ? (int)$p['organizacao_id'] : (int)$ctx['org'];   // administrador do sistema (sem empresa) vê as listas de todas
central_topo($p ? $p['nome'] : 'Novo colaborador', 'pessoal', $eu, 'Painel pessoal (RH)');
?>
<main class="ce-main">
  <section class="ce-hero"><div><span class="ce-eyebrow"><?= $p ? 'FICHA DO COLABORADOR' : 'NOVO COLABORADOR' ?></span><h1><?= $p ? h($p['nome']) : 'Cadastrar colaborador' ?></h1>
    <p><?php if ($p): ?><span class="ce-tag <?= $p['status'] === 'Demitido' ? 'verm' : 'verde' ?>"><?= h($p['status']) ?></span> · <?= $obraNome ? 'Alocado em <b>' . h($obraNome) . '</b>' . ($p['alocado_em'] ? ' desde ' . h(central_dt($p['alocado_em'])) : '') : '<b>Sem obra</b> (quadro da empresa)' ?><?php else: ?>Cadastre a pessoa na empresa e, se já souber, aloque numa obra. Dá para deixar sem obra e alocar depois.<?php endif; ?></p></div>
    <a class="btn ghost" href="<?= h($volta) ?>">← Colaboradores</a></section>
  <?php if ($msg): ?><div class="toast ok-faixa"><?= h($msg) ?></div><?php endif; ?>
  <?php if ($erro): ?><div class="toast erro-form" id="rhErro" role="alert"><b>Não foi possível salvar.</b> <?= h($erro) ?></div><?php endif; ?>

  <form method="post" autocomplete="off" novalidate><input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="acao" value="salvar"><input type="hidden" name="id" value="<?= (int)$id ?>">
    <section class="ce-bloco"><h2>Dados pessoais</h2>
      <div class="ce-form">
        <label>Nome completo *<input <?= $ce('nome') ?> name="nome" required maxlength="160" value="<?= h($v['nome']) ?>"><?= $fe('nome') ?></label>
        <label>CPF<input <?= $ce('cpf') ?> name="cpf" maxlength="14" inputmode="numeric" placeholder="000.000.000-00" value="<?= h(sesmt_cpf_exibir((string)$v['cpf'], false)) ?>"><?= $fe('cpf') ?></label>
        <label>RG<input <?= $ce('rg') ?> name="rg" maxlength="30" value="<?= h($v['rg']) ?>"><?= $fe('rg') ?></label>
        <label>Nascimento<input <?= $ce('nascimento') ?> type="date" name="nascimento" value="<?= h($v['nascimento']) ?>"><?= $fe('nascimento') ?></label>
        <label>Sexo<select <?= $ce('sexo') ?> name="sexo"><option value="">—</option><?php foreach (['Masculino', 'Feminino', 'Outro'] as $s_): ?><option <?= $v['sexo'] === $s_ ? 'selected' : '' ?>><?= h($s_) ?></option><?php endforeach; ?></select><?= $fe('sexo') ?></label>
        <label>Celular<input <?= $ce('celular') ?> name="celular" maxlength="30" value="<?= h($v['celular']) ?>"><?= $fe('celular') ?></label>
        <label>E-mail<input <?= $ce('email') ?> name="email" type="email" maxlength="150" value="<?= h($v['email']) ?>"><?= $fe('email') ?></label>
        <label class="full">Endereço (rua, número, bairro)<input <?= $ce('endereco') ?> name="endereco" maxlength="255" placeholder="ex.: Rua das Flores, 120 — Centro" value="<?= h($v['endereco']) ?>"><?= $fe('endereco') ?></label>
        <label>Cidade<input <?= $ce('cidade') ?> name="cidade" maxlength="100" value="<?= h($v['cidade'] ?? '') ?>"><?= $fe('cidade') ?></label>
        <label>Estado<select <?= $ce('uf') ?> name="uf"><option value="">—</option><?php foreach (rhp_ufs() as $u_): ?><option <?= ($v['uf'] ?? '') === $u_ ? 'selected' : '' ?>><?= h($u_) ?></option><?php endforeach; ?></select><?= $fe('uf') ?></label>
        <label>CTPS<input <?= $ce('ctps') ?> name="ctps" maxlength="30" value="<?= h($v['ctps']) ?>"><?= $fe('ctps') ?></label>
        <label>Série<input <?= $ce('serie') ?> name="serie" maxlength="20" value="<?= h($v['serie']) ?>"><?= $fe('serie') ?></label>
      </div></section>

    <section class="ce-bloco"><h2>Contrato e alocação</h2>
      <p>A <b>alocação</b> diz em qual obra a pessoa trabalha. Deixe <b>“Sem obra”</b> para quem é da empresa mas não está em nenhuma obra agora — ele continua na folha do Painel pessoal, na linha “Sem obra”.</p>
      <div class="ce-form">
        <?php if ($ctx['todas'] && !$p): ?><label>Empresa cliente *<select <?= $ce('org') ?> name="org" required><option value="">Escolha…</option><?php foreach ($orgsTodas as $o_): ?><option value="<?= (int)$o_['id'] ?>" <?= (int)($v['organizacao_id'] ?? 0) === (int)$o_['id'] ? 'selected' : '' ?>><?= h($o_['nome']) ?></option><?php endforeach; ?></select><?= $fe('org') ?></label><?php endif; ?>
        <?php foreach (['funcao' => ['Função', 'função', 'Nova função', 'nova função'], 'setor' => ['Setor', 'setor', 'Novo setor', 'novo setor']] as $c_ => $r_):
            $ops_ = rhp_opcoes($c_, $orgLista); $atual_ = (string)($v[$c_] ?? ''); if ($atual_ !== '' && $atual_ !== '__nova' && !in_array($atual_, $ops_, true)) { $ops_[] = $atual_; } ?>
        <label><?= $r_[0] ?><select <?= $ce($c_) ?> name="<?= $c_ ?>" class="rh-lista" data-nova="rhNova_<?= $c_ ?>"><option value="">— escolha —</option><?php foreach ($ops_ as $o_): ?><option <?= $atual_ === $o_ ? 'selected' : '' ?>><?= h($o_) ?></option><?php endforeach; ?><option value="__nova" <?= $atual_ === '__nova' ? 'selected' : '' ?>>+ Cadastrar <?= h($r_[3]) ?>…</option></select><?= $fe($c_) ?></label>
        <label id="rhNova_<?= $c_ ?>" <?= $atual_ === '__nova' ? '' : 'hidden' ?>><?= h($r_[2]) ?><input <?= isset($erros[$c_]) && $atual_ === '__nova' ? 'class="tem-erro"' : '' ?> name="<?= $c_ ?>_nova" maxlength="60" placeholder="digite o nome e salve" value="<?= h($v[$c_ . '_nova'] ?? '') ?>"><?php if (($eu['perfil'] ?? '') === 'admin'): ?><span class="rh-todas"><input type="checkbox" name="<?= $c_ ?>_todas" value="1" <?= !empty($v[$c_ . '_todas']) ? 'checked' : '' ?>> Disponível para todas as empresas e usuários</span><?php endif; ?></label>
        <?php endforeach; ?>
        <label>Vínculo / situação<select <?= $ce('status') ?> name="status"><?php foreach (rhp_status_lista() as $s_): ?><option <?= $v['status'] === $s_ ? 'selected' : '' ?>><?= h($s_) ?></option><?php endforeach; ?></select><?= $fe('status') ?></label>
        <label>Empresa empregadora<input <?= $ce('empresa') ?> name="empresa" maxlength="120" placeholder="vazio = a sua empresa" value="<?= h($v['empresa']) ?>"><?= $fe('empresa') ?></label>
        <label>Data de admissão<input <?= $ce('admissao') ?> type="date" name="admissao" value="<?= h($v['admissao']) ?>"><?= $fe('admissao') ?></label>
        <label>Data de desligamento<input <?= $ce('desligamento') ?> type="date" name="desligamento" value="<?= h($v['desligamento']) ?>"><?= $fe('desligamento') ?></label>
        <label>Alocado na obra<select <?= $ce('obra_id') ?> name="obra_id"><option value="0">Sem obra (quadro da empresa)</option><?php foreach ($obras as $oid_ => $on_): ?><option value="<?= (int)$oid_ ?>" <?= (int)($v['obra_id'] ?? 0) === (int)$oid_ ? 'selected' : '' ?>><?= h($on_) ?></option><?php endforeach; ?></select><?= $fe('obra_id') ?></label>
        <label>Alocado desde<input <?= $ce('alocado_em') ?> type="date" name="alocado_em" value="<?= h($v['alocado_em']) ?>"><?= $fe('alocado_em') ?></label>
      </div></section>

    <?php if ($ver): ?>
    <section class="ce-bloco"><h2>Remuneração</h2>
      <p>Alimenta a folha do Painel pessoal e o Contas a pagar. Estimativa gerencial: encargos e provisões seguem as premissas de RH da obra (ou as padrão, para quem está sem obra).</p>
      <div class="ce-form">
        <label>Tipo de salário<select <?= $ce('tipo_salario') ?> name="tipo_salario"><option <?= $v['tipo_salario'] === 'Mensal' ? 'selected' : '' ?>>Mensal</option><option <?= $v['tipo_salario'] === 'Hora' ? 'selected' : '' ?>>Hora</option></select><?= $fe('tipo_salario') ?></label>
        <label>Salário (R$) *<input <?= $ce('salario') ?> name="salario" inputmode="decimal" value="<?= h($fm($v['salario'])) ?>"><?= $fe('salario') ?></label>
        <label>Adicional<select <?= $ce('adicional') ?> name="adicional"><?php foreach (['Nenhum', 'Insalubridade 10%', 'Insalubridade 20%', 'Insalubridade 40%', 'Periculosidade 30%'] as $a_): ?><option <?= ($v['adicional'] ?? 'Nenhum') === $a_ ? 'selected' : '' ?>><?= h($a_) ?></option><?php endforeach; ?></select><?= $fe('adicional') ?></label>
        <label>Vale-transporte mensal (R$)<input <?= $ce('vale_transporte') ?> name="vale_transporte" inputmode="decimal" value="<?= h($fm($v['vale_transporte'])) ?>"><?= $fe('vale_transporte') ?></label>
        <label>Alimentação mensal (R$)<input <?= $ce('alimentacao') ?> name="alimentacao" inputmode="decimal" value="<?= h($fm($v['alimentacao'])) ?>"><?= $fe('alimentacao') ?></label>
        <label>Outros benefícios (R$)<input <?= $ce('outros_beneficios') ?> name="outros_beneficios" inputmode="decimal" value="<?= h($fm($v['outros_beneficios'])) ?>"><?= $fe('outros_beneficios') ?></label>
      </div>
      <?php if ($custo && !$custo['sem_salario']): ?>
      <div class="ce-tot" style="margin-top:14px"><div><small>Remuneração bruta</small><b><?= h(central_rs($custo['bruto'])) ?></b></div><div><small>Encargos + provisões</small><b><?= h(central_rs($custo['encargos'] + $custo['provisoes'])) ?></b></div>
        <div><small>Benefícios</small><b><?= h(central_rs($custo['beneficios'])) ?></b></div><div class="gr"><small>Custo no mês (<?= h(substr($hoje, 5, 2) . '/' . substr($hoje, 0, 4)) ?>)</small><b><?= h(central_rs($custo['total'])) ?></b></div></div>
      <?php endif; ?></section>
    <?php endif; ?>

    <section class="ce-bloco"><h2>Observações</h2><div class="ce-form"><label class="full">Anotações sobre o colaborador<textarea name="obs" maxlength="4000"><?= h($v['obs']) ?></textarea></label></div></section>
    <div class="ce-acoes"><button class="btn primario" type="submit"><?= $p ? 'Salvar alterações' : 'Cadastrar colaborador' ?></button><a class="btn ghost" href="<?= h($volta) ?>">Cancelar</a></div>
  </form>

  <?php if ($p): ?>
  <section class="ce-bloco" style="margin-top:26px" id="docs"><h2>Documentos do colaborador</h2>
    <p>Anexe aqui as NR’s, documentos pessoais, contrato, ASO e o que mais for preciso. Informe qual é o documento e, se tiver, a validade — o sistema avisa o que está vencido ou perto de vencer. PDF, imagem, Word, Excel ou ZIP, até 10 MB cada.</p>
    <?php if (!$docs): ?><div class="ce-vazio">Nenhum documento anexado ainda.</div><?php else: ?>
    <table class="ce-tab"><thead><tr><th>Documento</th><th>Descrição</th><th>Validade</th><th>Arquivo</th><th>Enviado</th><th></th></tr></thead><tbody>
    <?php foreach ($docs as $d): list($sk, $sr, $sc) = rhp_situacao_documento($d['validade']); ?>
      <tr><td><b><?= h($d['tipo']) ?></b></td><td><?= h($d['titulo'] ?: '—') ?></td>
        <td><?= $d['validade'] ? h(central_dt($d['validade'])) . ' <span class="ce-tag ' . $sc . '">' . h($sr) . '</span>' : '<span class="ce-tag">Sem validade</span>' ?></td>
        <td><a href="rh_arquivo.php?id=<?= (int)$d['id'] ?>" target="_blank" rel="noopener"><?= h($d['arquivo_nome']) ?></a><br><small style="color:#667085"><?= h(number_format($d['tamanho'] / 1024, 0, ',', '.')) ?> KB</small></td>
        <td><small><?= h($d['enviado_por']) ?><br><?= h(central_dt(substr((string)$d['enviado_em'], 0, 10))) ?></small></td>
        <td class="d" style="white-space:nowrap"><a class="btn ce-btn-peq" href="rh_arquivo.php?id=<?= (int)$d['id'] ?>&amp;baixar=1">Baixar</a>
          <form method="post" style="display:inline" onsubmit="return confirm('Remover este documento da ficha?')"><input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="acao" value="doc_excluir"><input type="hidden" name="id" value="<?= (int)$id ?>"><input type="hidden" name="doc_id" value="<?= (int)$d['id'] ?>"><button class="btn ghost ce-btn-peq">Excluir</button></form></td></tr>
    <?php endforeach; ?></tbody></table><?php endif; ?>
    <h3 style="margin:20px 0 8px">Incluir novo documento</h3>
    <form method="post" enctype="multipart/form-data" class="ce-form"><input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="acao" value="doc_enviar"><input type="hidden" name="id" value="<?= (int)$id ?>">
      <label>Qual documento? *<select name="tipo" id="dTipo" required><option value="">Escolha…</option><?php foreach (rhp_tipos_documento() as $t_): ?><option><?= h($t_) ?></option><?php endforeach; ?><option value="__outro">Outro (digitar o nome)…</option></select></label>
      <label id="dOutroBox" hidden>Nome do documento *<input name="tipo_outro" maxlength="80" placeholder="ex.: Certificado de soldador"></label>
      <label>Descrição / observação<input name="titulo" maxlength="160" placeholder="ex.: Curso de 2026, emitido por …"></label>
      <label>Validade (se houver)<input type="date" name="validade"></label>
      <label class="full">Arquivo *<input type="file" name="arquivo" required accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,.zip"></label>
      <div class="ce-acoes full"><button class="btn primario" type="submit">Anexar documento</button></div>
    </form></section>

  <section class="ce-bloco"><h2>Alocação e situação</h2>
    <p>Mude a obra do colaborador sem editar o resto da ficha.</p>
    <form method="post" class="ce-mes"><input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="acao" value="alocar"><input type="hidden" name="id" value="<?= (int)$id ?>">
      <label>Obra<select name="obra_id"><option value="0">Sem obra (quadro da empresa)</option><?php foreach ($obras as $oid_ => $on_): ?><option value="<?= (int)$oid_ ?>" <?= (int)$p['obra_id'] === (int)$oid_ ? 'selected' : '' ?>><?= h($on_) ?></option><?php endforeach; ?></select></label>
      <label>A partir de<input type="date" name="alocado_em" value="<?= h($hoje) ?>"></label><button class="btn">Alocar</button></form>
    <form method="post" onsubmit="return confirm('Excluir o colaborador e todos os documentos dele? Não há como desfazer. Para quem saiu da empresa, prefira mudar a situação para Demitido.')" style="margin-top:18px">
      <input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="acao" value="excluir"><input type="hidden" name="id" value="<?= (int)$id ?>"><button class="btn ghost" style="color:#b42318">Excluir colaborador</button></form></section>
  <?php endif; ?>
</main></div>
<script>(function(){var e=document.querySelector('.tem-erro')||document.getElementById('rhErro');if(e){e.scrollIntoView({block:'center'});if(e.focus&&e.tagName!=='DIV'){e.focus({preventScroll:true});}}})();
document.querySelectorAll('select.rh-lista').forEach(function(sel){var f=function(){var b=document.getElementById(sel.dataset.nova);if(!b)return;b.hidden=sel.value!=='__nova';if(!b.hidden){var i=b.querySelector('input');if(i&&!i.value)i.focus();}};sel.addEventListener('change',f);});
var s=document.getElementById('dTipo');if(s){s.addEventListener('change',function(){var b=document.getElementById('dOutroBox');b.hidden=s.value!=='__outro';var i=b.querySelector('input');i.required=s.value==='__outro';});}</script>
</body></html>
