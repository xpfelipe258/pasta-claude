// ------------------------------------------------------------ TAREFAS A FAZER (aba fixa: é a primeira tela ao entrar)
// O administrador cria tarefas e atribui a qualquer usuário; cada usuário também cria os próprios lembretes.
// Toda tarefa tem data de início e data de conclusão, com alerta (atrasada, vence hoje / em breve, começa hoje).
const TF = { dados: null, carregando: null, vista: 'minhas', filtro: 'abertas', resp: '', busca: '', avisouAoAbrir: false };
const TF_STATUS = { pendente: 'A fazer', andamento: 'Em andamento', concluida: 'Concluída', cancelada: 'Cancelada' };
const TF_PRIO = { baixa: 'Baixa', normal: 'Normal', alta: 'Alta', urgente: 'Urgente' };

function tfDias(de, ate) { return Math.round((dU(ate) - dU(de)) / 86400000); }   // dias corridos de `de` até `ate`
function tfAberta(t) { return t.status === 'pendente' || t.status === 'andamento'; }
function tfPlural(n, s, p) { return `${n} ${n === 1 ? s : p}`; }

// Situação de prazo da tarefa na data de hoje: texto, cor do selo e ordem de urgência (menor = mais urgente).
function tfSituacao(t, h = hoje()) {
  if (t.status === 'concluida') return { cls: 'f-verde', rot: `Concluída${t.concluida_em ? ' em ' + fdA(String(t.concluida_em).slice(0, 10)) : ''}`, ordem: 90, nivel: '' };
  if (t.status === 'cancelada') return { cls: 'f-pendente', rot: 'Cancelada', ordem: 95, nivel: '' };
  const fim = t.data_fim, ini = t.data_inicio, aviso = Number(t.aviso_dias ?? 2);
  if (fim && fim < h) { const n = tfDias(fim, h); return { cls: 'f-vermelho', rot: `ATRASADA há ${tfPlural(n, 'dia', 'dias')}`, ordem: 0 - n, nivel: 'atrasada' }; }
  if (fim && fim === h) return { cls: 'f-vermelho', rot: 'VENCE HOJE', ordem: 1, nivel: 'vence' };
  if (fim && tfDias(h, fim) <= aviso) { const n = tfDias(h, fim); return { cls: 'f-amarelo', rot: `Vence em ${tfPlural(n, 'dia', 'dias')}`, ordem: 10 + n, nivel: 'vence' }; }
  if (ini && ini === h && t.status === 'pendente') return { cls: 'f-azul', rot: 'Inicia hoje', ordem: 20, nivel: 'inicia' };
  if (ini && ini > h) { const n = tfDias(h, ini); return { cls: 'f-azul', rot: n === 1 ? 'Começa amanhã' : `Começa em ${n} dias`, ordem: 50 + n, nivel: n === 1 ? 'inicia' : '' }; }
  return { cls: 'f-verde', rot: 'No prazo', ordem: 60, nivel: '' };
}

async function tfCarregar(silencioso) {
  if (TF.carregando) return TF.carregando;
  TF.carregando = (async () => {
    try {
      const r = await fetch(API + 'tarefas', { cache: 'no-store' });
      if (r.status === 401) { location.href = 'login.php'; return null; }
      const j = await r.json();
      if (!r.ok) throw new Error(j.erro || 'Falha ao ler as tarefas');
      TF.dados = j;
      tfAtualizarMenu();
      return j;
    } catch (err) { if (!silencioso) toast(err.message || 'Falha ao ler as tarefas', true); return null; }
    finally { TF.carregando = null; }
  })();
  return TF.carregando;
}

function tfMinhas() { const d = TF.dados; return d ? d.tarefas.filter(t => t.responsavel_id === d.usuario_id) : []; }

// Contador do menu: minhas tarefas abertas que estão atrasadas, vencem em breve ou começam hoje.
function tfAtualizarMenu() {
  const el = document.getElementById('tarefasCont');
  if (!el || !TF.dados) return;
  const h = hoje();
  const al = tfMinhas().filter(tfAberta).map(t => tfSituacao(t, h)).filter(s => s.nivel);
  el.textContent = al.length; el.hidden = !al.length;
  el.classList.toggle('alerta', al.some(s => s.nivel === 'atrasada' || s.ordem === 1));
}

function tfAlertasHtml() {
  const d = TF.dados, h = hoje();
  const itens = [];
  d.tarefas.filter(tfAberta).forEach(t => {
    const s = tfSituacao(t, h);
    if (!s.nivel) return;
    const minha = t.responsavel_id === d.usuario_id;
    if (!minha && !(d.admin && s.nivel === 'atrasada')) return;   // do que é dos outros, o admin só vê o que está atrasado
    itens.push({ t, s, minha });
  });
  if (!itens.length) return '<div class="tf-alertas tf-ok"><b>Tudo em dia.</b> Nenhuma tarefa atrasada, vencendo ou começando agora.</div>';
  itens.sort((a, b) => a.s.ordem - b.s.ordem);
  return `<div class="tf-alertas"><div class="tf-alerta-tit">Alertas — ${tfPlural(itens.length, 'tarefa pede atenção', 'tarefas pedem atenção')}</div><ul>` +
    itens.slice(0, 12).map(({ t, s, minha }) => `<li><span class="farol ${s.cls}">${esc(s.rot)}</span> <a href="#" data-tf-abrir="${t.id}">${esc(t.titulo)}</a>
      <span class="nota">${minha ? '' : `· de ${esc(t.responsavel_nome || '—')} `}· conclusão ${fdA(t.data_fim)}</span></li>`).join('') +
    (itens.length > 12 ? `<li class="nota">…e mais ${itens.length - 12}. Use os filtros abaixo.</li>` : '') + '</ul></div>';
}

function tfFiltradas() {
  const d = TF.dados, h = hoje(), b = TF.busca.trim().toLowerCase();
  let l = d.tarefas.slice();
  if (TF.vista === 'minhas') l = l.filter(t => t.responsavel_id === d.usuario_id);
  else if (TF.vista === 'atribuidas') l = l.filter(t => t.criado_por === d.usuario_id && t.responsavel_id !== d.usuario_id);
  if (d.admin && TF.resp) l = l.filter(t => String(t.responsavel_id) === TF.resp);
  if (TF.filtro === 'abertas') l = l.filter(tfAberta);
  else if (TF.filtro === 'atrasadas') l = l.filter(t => tfAberta(t) && tfSituacao(t, h).nivel === 'atrasada');
  else if (TF.filtro === 'concluidas') l = l.filter(t => t.status === 'concluida');
  if (b) l = l.filter(t => `${t.titulo} ${t.descricao || ''} ${t.responsavel_nome || ''} ${t.criado_por_nome || ''} ${t.retorno || ''}`.toLowerCase().includes(b));
  // abertas primeiro, as mais urgentes no topo; encerradas por último
  return l.sort((a, b) => tfSituacao(a, h).ordem - tfSituacao(b, h).ordem || (a.data_fim || '').localeCompare(b.data_fim || ''));
}

function renderTarefas() {
  const sec = document.getElementById('aba-tarefas');
  if (!sec) return;
  if (!TF.dados) {
    $('#tfAlertas').innerHTML = '<p class="nota">Carregando tarefas…</p>';
    tfCarregar().then(() => { if (abaAtual === 'tarefas') renderTarefas(); });
    return;
  }
  const d = TF.dados, h = hoje();
  const minhas = tfMinhas(), abertas = minhas.filter(tfAberta);
  const sit = t => tfSituacao(t, h);
  const atras = abertas.filter(t => sit(t).nivel === 'atrasada').length;
  const breve = abertas.filter(t => sit(t).nivel === 'vence' && sit(t).ordem < 40).length;
  const mes = h.slice(0, 7);
  const feitas = minhas.filter(t => t.status === 'concluida' && String(t.concluida_em || '').slice(0, 7) === mes).length;
  const tile = (rot, val, sub, cc) => `<div class="tile" style="--c:${cc}"><div class="rot"><span>${rot}</span></div><div class="val">${val}</div><div class="sub">${sub}</div></div>`;
  let cards = tile('Minhas em aberto', abertas.length, 'a fazer + em andamento', 'var(--fg)') +
    tile('Atrasadas', atras, 'passaram da data de conclusão', atras ? 'var(--vermelho)' : 'var(--verde)') +
    tile('Vencem em breve', breve, 'dentro do prazo de aviso', breve ? 'var(--amarelo)' : 'var(--verde)') +
    tile('Concluídas no mês', feitas, 'por mim', 'var(--verde)');
  if (d.admin) {
    const atribuidas = d.tarefas.filter(t => t.criado_por === d.usuario_id && t.responsavel_id !== d.usuario_id && tfAberta(t));
    cards += tile('Atribuídas por mim', atribuidas.length, `${atribuidas.filter(t => sit(t).nivel === 'atrasada').length} atrasada(s)`, 'var(--acento)');
  }
  $('#tfCards').innerHTML = cards;
  $('#tfAlertas').innerHTML = tfAlertasHtml();

  // barra de vista / filtros
  const vistas = d.admin ? [['minhas', 'Minhas'], ['atribuidas', 'Atribuídas por mim'], ['todas', 'Todas']] : [['minhas', 'Minhas tarefas e lembretes']];
  $('#tfVistas').innerHTML = vistas.map(([k, r]) => `<button type="button" class="${TF.vista === k ? 'ativa' : ''}" data-tf-vista="${k}">${r}</button>`).join('');
  $('#tfFiltros').innerHTML = [['abertas', 'Em aberto'], ['atrasadas', 'Atrasadas'], ['concluidas', 'Concluídas'], ['todas', 'Todas']].map(([k, r]) => `<button type="button" class="${TF.filtro === k ? 'ativa' : ''}" data-tf-filtro="${k}">${r}</button>`).join('');
  const selR = $('#tfResp');
  selR.hidden = !d.admin;
  if (d.admin) selR.innerHTML = '<option value="">Todos os responsáveis</option>' + d.usuarios.map(u => `<option value="${u.id}" ${TF.resp === String(u.id) ? 'selected' : ''}>${esc(u.nome)}${u.empresa ? ' · ' + esc(u.empresa) : ''}</option>`).join('');

  const lista = tfFiltradas();
  const statusSel = t => `<select class="tf-status" data-tf-status="${t.id}" aria-label="Situação">${Object.entries(TF_STATUS).map(([k, r]) => `<option value="${k}" ${t.status === k ? 'selected' : ''}>${r}</option>`).join('')}</select>`;
  $('#tabTarefas').innerHTML = `<thead><tr><th>Prioridade</th><th>Tarefa</th><th>Responsável</th><th>Início</th><th>Conclusão</th><th>Prazo</th><th>Situação</th><th>Ações</th></tr></thead><tbody>` +
    (lista.length ? lista.map(t => {
      const s = sit(t);
      const origem = t.pessoal ? '<span class="nota">lembrete pessoal</span>' : `<span class="nota">por ${esc(t.criado_por_nome || '—')}</span>`;
      return `<tr class="${tfAberta(t) ? '' : 'tf-fechada'} tf-p-${esc(t.prioridade)}">
        <td><span class="tf-prio tf-prio-${esc(t.prioridade)}">${esc(TF_PRIO[t.prioridade] || t.prioridade)}</span></td>
        <td class="tf-titulo"><a href="#" data-tf-abrir="${t.id}"><b>${esc(t.titulo)}</b></a>${t.descricao ? `<div class="nota tf-desc">${esc(t.descricao)}</div>` : ''}${t.retorno ? `<div class="nota tf-ret">Retorno: ${esc(t.retorno)}</div>` : ''}</td>
        <td>${esc(t.responsavel_nome || '—')}<br>${origem}</td>
        <td>${t.data_inicio ? fdA(t.data_inicio) : '—'}</td><td>${t.data_fim ? fdA(t.data_fim) : '—'}</td>
        <td><span class="farol ${s.cls}">${esc(s.rot)}</span></td><td>${statusSel(t)}</td>
        <td><button class="link" data-tf-abrir="${t.id}">${t.pode_editar ? 'Editar' : 'Abrir'}</button>${t.pode_editar ? ` · <button class="link perigo-txt" data-tf-excluir="${t.id}">Excluir</button>` : ''}</td></tr>`;
    }).join('') : `<tr><td colspan="8" class="vazio">Nenhuma tarefa neste filtro. Use “+ Nova tarefa” ou o lembrete rápido acima.</td></tr>`) + '</tbody>';

  // carga por responsável (administrador, vista "Todas")
  const carga = $('#tfCarga');
  if (d.admin && TF.vista === 'todas') {
    const por = new Map();
    d.tarefas.forEach(t => {
      const o = por.get(t.responsavel_id) || { nome: t.responsavel_nome || '—', ab: 0, at: 0, ok: 0 };
      if (tfAberta(t)) { o.ab++; if (sit(t).nivel === 'atrasada') o.at++; } else if (t.status === 'concluida') o.ok++;
      por.set(t.responsavel_id, o);
    });
    carga.hidden = false;
    carga.innerHTML = `<div class="bloco-cab"><h2>Carga por responsável</h2></div><div class="tabela-rolagem"><table><thead><tr><th>Responsável</th><th class="n">Em aberto</th><th class="n">Atrasadas</th><th class="n">Concluídas</th></tr></thead><tbody>` +
      [...por.values()].sort((a, b) => b.at - a.at || b.ab - a.ab).map(o => `<tr><td>${esc(o.nome)}</td><td class="n">${o.ab}</td><td class="n ${o.at ? 'valor-neg' : ''}">${o.at}</td><td class="n">${o.ok}</td></tr>`).join('') + '</tbody></table></div>';
  } else carga.hidden = true;
}

// ---- janela de criar/editar
function tfAbrir(id) {
  const d = TF.dados;
  if (!d) return;
  const t = id ? d.tarefas.find(x => x.id === id) : null;
  if (id && !t) return;
  const dlg = $('#dlgTarefa'), f = $('#tfForm');
  const editaDados = !t || t.pode_editar;
  dlg.dataset.id = t ? t.id : '';
  $('#tfTit').textContent = t ? (editaDados ? 'Editar tarefa' : 'Tarefa') : 'Nova tarefa';
  f.elements.titulo.value = t ? t.titulo : '';
  f.elements.descricao.value = t ? (t.descricao || '') : '';
  const selR = f.elements.responsavel_id;
  selR.innerHTML = d.usuarios.map(u => `<option value="${u.id}">${esc(u.nome)}${u.empresa ? ' · ' + esc(u.empresa) : ''}${u.id === d.usuario_id ? ' (eu)' : ''}</option>`).join('');
  selR.value = String(t ? t.responsavel_id : d.usuario_id);
  $('#tfRespBox').hidden = !d.admin;
  $('#tfPessoalNota').hidden = d.admin;
  f.elements.data_inicio.value = t ? (t.data_inicio || '') : hoje();
  f.elements.data_fim.value = t ? (t.data_fim || '') : '';
  f.elements.aviso_dias.value = t ? t.aviso_dias : 2;
  f.elements.prioridade.value = t ? t.prioridade : 'normal';
  f.elements.status.value = t ? t.status : 'pendente';
  f.elements.retorno.value = t ? (t.retorno || '') : '';
  $('#tfAndamentoBox').hidden = !t;
  ['titulo', 'descricao', 'responsavel_id', 'data_inicio', 'data_fim', 'aviso_dias', 'prioridade'].forEach(k => { f.elements[k].disabled = !editaDados; });
  $('#tfNotaSomenteAndamento').hidden = editaDados;
  $('#tfExcluir').hidden = !(t && t.pode_editar);
  $('#tfExcluir').dataset.confirmar = ''; $('#tfExcluir').textContent = 'Excluir';
  dlg.showModal();
  f.elements.titulo.focus();
}

async function tfSalvar(ev) {
  ev.preventDefault();
  const dlg = $('#dlgTarefa'), f = $('#tfForm'), id = dlg.dataset.id ? +dlg.dataset.id : null;
  const t = id ? TF.dados.tarefas.find(x => x.id === id) : null;
  const b = $('#tfSalvar'); b.disabled = true;
  try {
    let r;
    if (t && !t.pode_editar) {
      r = await postar(API + 'tarefas', { acao: 'status', id, status: f.elements.status.value, retorno: f.elements.retorno.value });
    } else {
      const ini = f.elements.data_inicio.value, fim = f.elements.data_fim.value;
      if (!ini) throw new Error('Informe a data de início.');
      if (!fim) throw new Error('Informe a data de conclusão.');
      if (fim < ini) throw new Error('A data de conclusão não pode ser anterior à data de início.');
      r = await postar(API + 'tarefas', { acao: 'salvar', id, titulo: f.elements.titulo.value, descricao: f.elements.descricao.value, responsavel_id: +f.elements.responsavel_id.value,
        data_inicio: ini, data_fim: fim, aviso_dias: f.elements.aviso_dias.value, prioridade: f.elements.prioridade.value });
      if (t && (f.elements.status.value !== t.status || (f.elements.retorno.value || '') !== (t.retorno || ''))) {
        r = await postar(API + 'tarefas', { acao: 'status', id, status: f.elements.status.value, retorno: f.elements.retorno.value });
      }
    }
    TF.dados = r; dlg.close(); tfAtualizarMenu(); renderTarefas(); toast('Tarefa salva');
  } catch (err) { toast(err.message, true); }
  finally { b.disabled = false; }
}

async function tfMudarStatus(id, status) {
  try { TF.dados = await postar(API + 'tarefas', { acao: 'status', id, status }); tfAtualizarMenu(); renderTarefas(); }
  catch (err) { toast(err.message, true); renderTarefas(); }
}

async function tfExcluir(id, confirmado) {
  const t = TF.dados.tarefas.find(x => x.id === id);
  if (!t) return;
  if (!confirmado && !confirm(`Excluir a tarefa “${t.titulo}”?`)) return;
  try { TF.dados = await postar(API + 'tarefas', { acao: 'excluir', id }); tfAtualizarMenu(); renderTarefas(); toast('Tarefa excluída'); }
  catch (err) { toast(err.message, true); }
}

// lembrete rápido: título + data de conclusão (início = hoje); vira tarefa pessoal do próprio usuário
async function tfLembreteRapido() {
  const tit = $('#tfRapidoTit'), fim = $('#tfRapidoFim');
  if (!tit.value.trim()) { toast('Escreva o lembrete.', true); tit.focus(); return; }
  if (!fim.value) { toast('Informe a data de conclusão.', true); fim.focus(); return; }
  if (fim.value < hoje()) { toast('A data de conclusão não pode ser anterior a hoje.', true); return; }
  try {
    TF.dados = await postar(API + 'tarefas', { acao: 'salvar', titulo: tit.value, responsavel_id: TF.dados.usuario_id, data_inicio: hoje(), data_fim: fim.value, aviso_dias: 2, prioridade: 'normal' });
    tit.value = ''; fim.value = ''; tfAtualizarMenu(); renderTarefas(); toast('Lembrete criado');
  } catch (err) { toast(err.message, true); }
}

// aviso ao entrar no sistema (uma vez): resume o que está atrasado ou vence hoje
function tfAvisoAoAbrir() {
  if (TF.avisouAoAbrir || !TF.dados) return;
  TF.avisouAoAbrir = true;
  const h = hoje(), ab = tfMinhas().filter(tfAberta).map(t => tfSituacao(t, h));
  const atr = ab.filter(s => s.nivel === 'atrasada').length, hojeN = ab.filter(s => s.ordem === 1).length, ini = ab.filter(s => s.ordem === 20).length;
  const p = [];
  if (atr) p.push(tfPlural(atr, 'atrasada', 'atrasadas'));
  if (hojeN) p.push(`${hojeN} ${hojeN === 1 ? 'vence' : 'vencem'} hoje`);
  if (ini) p.push(`${ini} ${ini === 1 ? 'inicia' : 'iniciam'} hoje`);
  if (p.length) toast('Tarefas: ' + p.join(' · '), atr > 0 || hojeN > 0, 9000);
}

function ligarTarefas() {
  const sec = document.getElementById('aba-tarefas');
  if (!sec) return;
  sec.addEventListener('click', ev => {
    const a = ev.target.closest('[data-tf-abrir]');
    if (a) { ev.preventDefault(); tfAbrir(+a.dataset.tfAbrir); return; }
    const x = ev.target.closest('[data-tf-excluir]');
    if (x) { tfExcluir(+x.dataset.tfExcluir); return; }
    const v = ev.target.closest('[data-tf-vista]');
    if (v) { TF.vista = v.dataset.tfVista; renderTarefas(); return; }
    const fl = ev.target.closest('[data-tf-filtro]');
    if (fl) { TF.filtro = fl.dataset.tfFiltro; renderTarefas(); return; }
    if (ev.target.closest('#btnNovaTarefa')) tfAbrir(null);
    if (ev.target.closest('#tfRapidoAdd')) tfLembreteRapido();
  });
  sec.addEventListener('change', ev => {
    const s = ev.target.closest('[data-tf-status]');
    if (s) { tfMudarStatus(+s.dataset.tfStatus, s.value); return; }
    if (ev.target.id === 'tfResp') { TF.resp = ev.target.value; renderTarefas(); }
  });
  sec.addEventListener('input', ev => { if (ev.target.id === 'tfBusca') { TF.busca = ev.target.value; const pos = ev.target.selectionStart; renderTarefas(); const n = $('#tfBusca'); n.focus(); n.setSelectionRange(pos, pos); } });
  sec.addEventListener('keydown', ev => { if (ev.key === 'Enter' && ev.target.id === 'tfRapidoTit') { ev.preventDefault(); tfLembreteRapido(); } });
  $('#tfForm').addEventListener('submit', tfSalvar);
  $('#tfCancelar').addEventListener('click', () => $('#dlgTarefa').close());
  $('#tfFechar').addEventListener('click', () => $('#dlgTarefa').close());
  $('#tfExcluir').addEventListener('click', ev => {
    const b = ev.currentTarget;
    if (!b.dataset.confirmar) { b.dataset.confirmar = '1'; b.textContent = 'Confirmar exclusão'; return; }
    const id = +$('#dlgTarefa').dataset.id; $('#dlgTarefa').close(); tfExcluir(id, true);
  });
  // atualiza sozinho (tarefas atribuídas por outra pessoa chegam sem recarregar a página)
  setInterval(() => {
    if (document.hidden) return;
    const livre = abaAtual !== 'tarefas' || (!document.querySelector('#dlgTarefa[open]') && !sec.contains(document.activeElement) );
    if (!livre) return;
    tfCarregar(true).then(() => { if (abaAtual === 'tarefas') renderTarefas(); });
  }, 60000);
}

ligarTarefas();
