// ------------------------------------------------------------ TAREFAS A FAZER (aba fixa: é a primeira tela ao entrar)
// O administrador cria tarefas e atribui a qualquer usuário; cada usuário também cria os próprios lembretes.
// Toda tarefa tem data de início e data de conclusão, com alerta (atrasada, vence hoje / em breve, começa hoje).
const TF = { dados: null, carregando: null, vista: 'minhas', filtro: 'abertas', resp: '', busca: '', avisouAoAbrir: false, aba: 'tarefas' };
const TF_STATUS = { pendente: 'A fazer', andamento: 'Em andamento', concluida: 'Concluída', cancelada: 'Cancelada' };
const TF_PRIO = { baixa: 'Baixa', normal: 'Normal', alta: 'Alta', urgente: 'Urgente' };


// ------------------------------------------------------------ CONVERSA ENTRE OS USUÁRIOS (mural da equipe e conversa de cada tarefa)
// Só comunicação e troca de arquivos: não altera tarefas nem dados da obra. Mural = conversa 0, aberta a todos os usuários.
const TFC = {};   // conversa (id da tarefa; 0 = mural) -> { msgs, ultimo }
const TF_MAX_ARQ = 10 * 1048576;
function tfVistoLer(chave) { try { return JSON.parse(localStorage.getItem('tfVisto_' + (TF.dados ? TF.dados.usuario_id : '')) || '{}')[chave] || 0; } catch (e) { return 0; } }
function tfVistoGravar(chave, id) {
  try {
    const k = 'tfVisto_' + (TF.dados ? TF.dados.usuario_id : ''), o = JSON.parse(localStorage.getItem(k) || '{}');
    if ((o[chave] || 0) < id) { o[chave] = id; localStorage.setItem(k, JSON.stringify(o)); }
  } catch (e) { /* sem armazenamento local: só não lembra o que já foi lido */ }
}
function tfTamanho(n) { return n >= 1048576 ? (n / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
function tfHora(em) { const d = String(em || ''); return `${fdA(d.slice(0, 10))} ${d.slice(11, 16)}`; }

function tfConvEstrutura(el) {
  if (el.dataset.montado) return;
  el.dataset.montado = '1';
  el.innerHTML = `<div class="tf-conv-lista" data-cv-lista><p class="tf-conv-vazia">Carregando a conversa…</p></div>
    <div class="tf-conv-compor">
      <textarea rows="2" maxlength="4000" data-cv-texto placeholder="Escreva uma mensagem… (Ctrl+Enter envia)"></textarea>
      <div class="tf-conv-barra">
        <button type="button" class="btn tf-enviar" data-cv-enviar>Enviar mensagem</button>
        <label class="btn tf-anexar">📎 Anexar arquivo<input type="file" data-cv-arquivo hidden></label>
        <span class="nota" data-cv-nota>Arquivos até 10 MB (PDF, imagem, Word, Excel, ZIP, DWG, IFC…). Se escrever algo antes de anexar, o texto vai junto.</span>
      </div>
    </div>`;
}

function tfConvLista(el, c) {
  const l = el.querySelector('[data-cv-lista]');
  const rolouFim = l.scrollTop + l.clientHeight >= l.scrollHeight - 40, primeira = !el.dataset.pintou;
  const ant = (TFC[el.dataset.cvId] || {}).render;
  const html = c.mensagens.length ? c.mensagens.map(m => {
    const ext = String(m.arquivo_tipo || '').toLowerCase(), img = ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext);
    const arq = m.tem_arquivo ? `<div class="tf-msg-arq">${img ? `<a href="tarefa_arquivo.php?acao=ver&id=${m.id}" target="_blank" rel="noopener"><img loading="lazy" src="tarefa_arquivo.php?acao=ver&id=${m.id}" alt="${esc(m.arquivo_nome)}"></a>` : ''}
      <a href="tarefa_arquivo.php?acao=ver&id=${m.id}${ext === 'pdf' ? '' : '&baixar=1'}" ${ext === 'pdf' ? 'target="_blank" rel="noopener"' : ''}>📎 ${esc(m.arquivo_nome)}</a><span class="nota">${tfTamanho(m.arquivo_tam)}</span></div>` : '';
    return `<div class="tf-msg ${m.minha ? 'minha' : ''}"><div class="tf-msg-cab"><b>${m.minha ? 'Você' : esc(m.autor)}</b><span>${tfHora(m.criado_em)}</span>${m.pode_excluir ? `<button type="button" class="link perigo-txt" data-cv-del="${m.id}">Apagar</button>` : ''}</div>
      ${m.texto ? `<div class="tf-msg-txt">${esc(m.texto)}</div>` : ''}${arq}</div>`;
  }).join('') : '<p class="tf-conv-vazia">Nenhuma mensagem ainda. Escreva a primeira ou anexe um arquivo.</p>';
  if (html !== ant) {
    l.innerHTML = html;
    if (primeira || rolouFim) l.scrollTop = l.scrollHeight;
  }
  TFC[el.dataset.cvId].render = html;
  el.dataset.pintou = '1';
}

async function tfConvCarregar(el, silencioso) {
  const id = +el.dataset.cvId;
  try {
    const r = await fetch(API + 'tarefas-msgs&tarefa=' + id, { cache: 'no-store' });
    if (r.status === 401) { location.href = 'login.php'; return; }
    const j = await r.json();
    if (!r.ok) throw new Error(j.erro || 'Falha ao ler a conversa');
    TFC[id] = Object.assign(TFC[id] || {}, { msgs: j.mensagens });
    tfConvLista(el, j);
    const ult = j.mensagens.length ? j.mensagens[j.mensagens.length - 1].id : 0;
    tfVistoGravar(id ? 't' + id : 'mural', ult);
    tfAtualizarNovas();
  } catch (err) { if (!silencioso) toast(err.message, true); }
}

function tfConvMontar(el, tarefaId) {
  el.dataset.cvId = String(tarefaId);
  TFC[tarefaId] = TFC[tarefaId] || {};
  tfConvEstrutura(el);
  delete el.dataset.pintou;
  TFC[tarefaId].render = null;
  const l = el.querySelector('[data-cv-lista]');
  l.innerHTML = '<p class="tf-conv-vazia">Carregando a conversa…</p>';
  return tfConvCarregar(el);
}

async function tfConvEnviarTexto(el) {
  const ta = el.querySelector('[data-cv-texto]'), texto = ta.value.trim();
  if (!texto) { toast('Escreva a mensagem.', true); ta.focus(); return; }
  const b = el.querySelector('[data-cv-enviar]'); b.disabled = true;
  try {
    const j = await postar(API + 'tarefas-msgs', { acao: 'enviar', tarefa: +el.dataset.cvId, texto });
    ta.value = ''; tfConvLista(el, j); tfConvCarregar(el, true);
    if (j.aviso_email) toast('Mensagem enviada · ' + j.aviso_email);
  } catch (err) { toast(err.message, true); }
  finally { b.disabled = false; }
}

async function tfConvEnviarArquivo(el, input) {
  const f = input.files && input.files[0]; input.value = '';
  if (!f) return;
  if (f.size > TF_MAX_ARQ) { toast('O arquivo passa de 10 MB. Reduza ou divida (ZIP).', true); return; }
  const ta = el.querySelector('[data-cv-texto]'), nota = el.querySelector('[data-cv-nota]'), orig = nota.textContent;
  nota.textContent = `Enviando ${f.name}…`;
  try {
    const q = `acao=enviar&tarefa=${el.dataset.cvId}&nome=${encodeURIComponent(f.name)}&texto=${encodeURIComponent(ta.value.trim().slice(0, 1000))}`;
    const r = await fetch('tarefa_arquivo.php?' + q, { method: 'POST', headers: { 'X-CSRF-Token': window.CSRF_TOKEN || '' }, body: f });
    if (r.status === 401) { location.href = 'login.php'; return; }
    const j = await r.json().catch(() => ({ erro: 'O servidor recusou o arquivo (tamanho ou tipo).' }));
    if (!r.ok) throw new Error(j.erro || 'Falha ao enviar o arquivo');
    ta.value = ''; toast('Arquivo enviado' + (j.aviso_email ? ' · ' + j.aviso_email : ''));
    await tfConvCarregar(el, true);
  } catch (err) { toast(err.message, true); }
  finally { nota.textContent = orig; }
}

async function tfConvApagar(el, id) {
  if (!confirm('Apagar esta mensagem' + ' (e o arquivo anexado, se houver)?')) return;
  try { const j = await postar(API + 'tarefas-msgs', { acao: 'excluir', tarefa: +el.dataset.cvId, id }); tfConvLista(el, j); }
  catch (err) { toast(err.message, true); }
}

function tfConvLigar(raiz) {
  raiz.addEventListener('click', ev => {
    const el = ev.target.closest('.tf-conv');
    if (!el) return;
    if (ev.target.closest('[data-cv-enviar]')) { ev.preventDefault(); tfConvEnviarTexto(el); return; }
    const d = ev.target.closest('[data-cv-del]');
    if (d) { ev.preventDefault(); tfConvApagar(el, +d.dataset.cvDel); }
  });
  raiz.addEventListener('change', ev => {
    const i = ev.target.closest('[data-cv-arquivo]');
    if (i) tfConvEnviarArquivo(i.closest('.tf-conv'), i);
  });
  raiz.addEventListener('keydown', ev => {
    if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey) && ev.target.closest('[data-cv-texto]')) { ev.preventDefault(); tfConvEnviarTexto(ev.target.closest('.tf-conv')); }
  });
}

// "novas" no menu da aba e ao lado de cada tarefa: mensagens de outras pessoas que ainda não abri
function tfNovasMural() { const d = TF.dados; return !!d && d.mural_ultimo > tfVistoLer('mural') && d.mural_ultimo_usuario !== d.usuario_id; }
function tfNovasTarefa(t) { return !!TF.dados && t.n_msgs > 0 && t.ult_msg_id > tfVistoLer('t' + t.id) && t.ult_msg_usuario !== TF.dados.usuario_id; }
function tfAtualizarNovas() {
  const n = document.getElementById('tfMuralNovo');
  if (n) n.hidden = !tfNovasMural() || TF.aba === 'mural';
}

// ------------------------------------------------------------ RELATÓRIO DE TAREFAS (visualização padrão → Baixar PDF)
const TF_REL = { resp: '', sit: 'todas', por: 'prazo', ini: '', fim: '' };
const TF_REL_SIT = { todas: 'Todas as situações', abertas: 'Em aberto (a fazer + em andamento)', atrasadas: 'Atrasadas', concluidas: 'Concluídas', concluidas_atraso: 'Concluídas com atraso', canceladas: 'Canceladas' };
const TF_REL_POR = { prazo: 'Data de conclusão (prazo)', inicio: 'Data de início', criacao: 'Data de criação' };

function tfRelAbrir() {
  const d = TF.dados;
  if (!d) { toast('Aguarde as tarefas carregarem.', true); return; }
  const f = $('#tfRelForm');
  f.elements.resp.innerHTML = '<option value="">Todos os responsáveis</option>' + d.usuarios.map(u => `<option value="${u.id}">${esc(u.nome)}${u.empresa ? ' · ' + esc(u.empresa) : ''}</option>`).join('');
  f.elements.resp.value = TF_REL.resp;
  $('#tfRelRespBox').hidden = !d.admin;
  f.elements.sit.innerHTML = Object.entries(TF_REL_SIT).map(([k, r]) => `<option value="${k}">${r}</option>`).join('');
  f.elements.sit.value = TF_REL.sit;
  f.elements.por.innerHTML = Object.entries(TF_REL_POR).map(([k, r]) => `<option value="${k}">${r}</option>`).join('');
  f.elements.por.value = TF_REL.por;
  f.elements.ini.value = TF_REL.ini;
  f.elements.fim.value = TF_REL.fim || '';
  $('#dlgTfRel').showModal();
}

function tfRelFiltrar(c) {
  const d = TF.dados, h = hoje();
  const dataBase = t => c.por === 'inicio' ? (t.data_inicio || '') : c.por === 'criacao' ? String(t.criado_em || '').slice(0, 10) : (t.data_fim || '');
  return d.tarefas.filter(t => {
    if (c.resp && String(t.responsavel_id) !== c.resp) return false;
    if (c.ini || c.fim) { const b = dataBase(t); if (!b || (c.ini && b < c.ini) || (c.fim && b > c.fim)) return false; }
    const atrasada = tfAberta(t) && tfSituacao(t, h).nivel === 'atrasada';
    if (c.sit === 'abertas') return tfAberta(t);
    if (c.sit === 'atrasadas') return atrasada;
    if (c.sit === 'concluidas') return t.status === 'concluida';
    if (c.sit === 'concluidas_atraso') return t.status === 'concluida' && tfAtrasoConcl(t) > 0;
    if (c.sit === 'canceladas') return t.status === 'cancelada';
    return true;
  }).sort((a, b) => (a.responsavel_nome || '').localeCompare(b.responsavel_nome || '') || (a.data_fim || '').localeCompare(b.data_fim || '') || a.id - b.id);
}
// dias de atraso na conclusão (concluída depois do prazo); 0 = no prazo
function tfAtrasoConcl(t) { return t.status === 'concluida' && t.concluida_em && t.data_fim ? Math.max(0, tfDias(t.data_fim, String(t.concluida_em).slice(0, 10))) : 0; }

function tfRelSituacaoTxt(t, h) {
  if (t.status === 'concluida') { const a = tfAtrasoConcl(t); return `Concluída${t.concluida_em ? ' em ' + fdA(String(t.concluida_em).slice(0, 10)) : ''} · ${a ? `com ${tfPlural(a, 'dia', 'dias')} de atraso` : 'no prazo'}`; }
  const s = tfSituacao(t, h);
  return `${TF_STATUS[t.status] || t.status} · ${s.rot}`;
}

function tfRelHtml(c) {
  const h = hoje(), l = tfRelFiltrar(c);
  const abertas = l.filter(tfAberta), atras = abertas.filter(t => tfSituacao(t, h).nivel === 'atrasada');
  const concl = l.filter(t => t.status === 'concluida'), noPrazo = concl.filter(t => !tfAtrasoConcl(t)), canc = l.filter(t => t.status === 'cancelada');
  const pc = (a, b) => b ? nf(a / b * 100, 0) + '%' : '—';
  const card = (rot, val, sub, cls) => `<div class="card ${cls}"><div class="rot">${rot}</div><div class="val">${val}</div><div class="sub">${sub}</div></div>`;
  const respNome = c.resp ? ((TF.dados.usuarios.find(u => String(u.id) === c.resp) || {}).nome || '') : 'Todos os responsáveis';
  const periodo = c.ini || c.fim ? `${TF_REL_POR[c.por].toLowerCase()} de ${c.ini ? fdA(c.ini) : 'o início'} a ${c.fim ? fdA(c.fim) : 'hoje em diante'}` : 'sem filtro de período';
  const cards = `<div class="cards">
    ${card('Tarefas no relatório', nf(l.length), `${respNome} · ${TF_REL_SIT[c.sit].toLowerCase()}`, 'az')}
    ${card('Em aberto', nf(abertas.length), `${abertas.filter(t => t.status === 'andamento').length} em andamento · ${abertas.filter(t => t.status === 'pendente').length} a fazer`, 'am')}
    ${card('Atrasadas', nf(atras.length), atras.length ? 'passaram do prazo e seguem abertas' : 'nenhuma atrasada', atras.length ? 'vm' : 'vd')}
    ${card('Concluídas', nf(concl.length), `${nf(noPrazo.length)} no prazo · ${nf(concl.length - noPrazo.length)} com atraso`, 'vd')}
    ${card('Cumprimento do prazo', pc(noPrazo.length, concl.length), 'concluídas no prazo ÷ concluídas', concl.length && noPrazo.length / concl.length < .8 ? 'am' : 'vd')}
    ${card('Canceladas', nf(canc.length), '', 'nd')}
  </div>`;
  // por responsável
  const por = new Map();
  l.forEach(t => {
    const o = por.get(t.responsavel_id) || { nome: t.responsavel_nome || '—', n: 0, pend: 0, and: 0, atr: 0, ok: 0, okp: 0, canc: 0 };
    o.n++;
    if (t.status === 'pendente') o.pend++; else if (t.status === 'andamento') o.and++;
    if (tfAberta(t) && tfSituacao(t, h).nivel === 'atrasada') o.atr++;
    if (t.status === 'concluida') { o.ok++; if (!tfAtrasoConcl(t)) o.okp++; }
    if (t.status === 'cancelada') o.canc++;
    por.set(t.responsavel_id, o);
  });
  const tabResp = `<table><thead><tr><th>Responsável</th><th class="n">Total</th><th class="n">A fazer</th><th class="n">Em andamento</th><th class="n">Atrasadas</th><th class="n">Concluídas</th><th class="n">Concl. no prazo</th><th class="n">Canceladas</th></tr></thead><tbody>` +
    ([...por.values()].sort((a, b) => b.atr - a.atr || b.n - a.n).map(o => `<tr><td>${esc(o.nome)}</td><td class="n">${o.n}</td><td class="n">${o.pend}</td><td class="n">${o.and}</td><td class="n ${o.atr ? 'neg' : ''}">${o.atr}</td><td class="n">${o.ok}</td><td class="n">${pc(o.okp, o.ok)}</td><td class="n">${o.canc}</td></tr>`).join('') || '<tr><td colspan="8" class="vazio">Sem tarefas.</td></tr>') + '</tbody></table>';
  const tabPrio = `<table><thead><tr><th>Prioridade</th><th class="n">Total</th><th class="n">Em aberto</th><th class="n">Atrasadas</th><th class="n">Concluídas</th></tr></thead><tbody>` +
    ['urgente', 'alta', 'normal', 'baixa'].map(p => { const q = l.filter(t => t.prioridade === p); return `<tr><td>${TF_PRIO[p]}</td><td class="n">${q.length}</td><td class="n">${q.filter(tfAberta).length}</td><td class="n ${q.some(t => tfAberta(t) && tfSituacao(t, h).nivel === 'atrasada') ? 'neg' : ''}">${q.filter(t => tfAberta(t) && tfSituacao(t, h).nivel === 'atrasada').length}</td><td class="n">${q.filter(t => t.status === 'concluida').length}</td></tr>`; }).join('') + '</tbody></table>';
  // detalhe, agrupado por responsável
  let linhas = '', ult = null;
  l.forEach(t => {
    if (t.responsavel_id !== ult) { ult = t.responsavel_id; linhas += `<tr class="grupo"><td colspan="9"><b>${esc(t.responsavel_nome || '—')}</b></td></tr>`; }
    const s = tfRelSituacaoTxt(t, h), neg = (tfAberta(t) && tfSituacao(t, h).nivel === 'atrasada') || tfAtrasoConcl(t) > 0;
    linhas += `<tr><td style="white-space:nowrap"><b>${esc(t.codigo || '—')}</b></td>
      <td><b>${esc(t.titulo)}</b>${t.descricao ? `<div class="nota">${esc(t.descricao)}</div>` : ''}${t.retorno ? `<div class="nota"><b>Retorno:</b> ${esc(t.retorno)}</div>` : ''}${t.n_msgs ? `<div class="nota">💬 ${t.n_msgs} mensagem(ns) na conversa</div>` : ''}</td>
      <td>${esc(t.pessoal ? 'lembrete pessoal' : (t.criado_por_nome || '—'))}</td><td>${esc(TF_PRIO[t.prioridade] || t.prioridade)}</td>
      <td class="n">${t.data_inicio ? fdA(t.data_inicio) : '—'}</td><td class="n">${t.data_fim ? fdA(t.data_fim) : '—'}</td>
      <td class="n">${t.iniciada_em ? fdA(String(t.iniciada_em).slice(0, 10)) : '—'}</td><td class="n">${t.concluida_em ? fdA(String(t.concluida_em).slice(0, 10)) : '—'}</td>
      <td class="${neg ? 'neg' : ''}">${esc(s)}</td></tr>`;
  });
  const tabDet = `<table><thead><tr><th>Código</th><th>Tarefa</th><th>Criada por</th><th>Prioridade</th><th class="n">Início</th><th class="n">Conclusão (prazo)</th><th class="n">Iniciada em</th><th class="n">Concluída em</th><th>Situação</th></tr></thead><tbody>${linhas || '<tr><td colspan="9" class="vazio">Nenhuma tarefa com estes filtros.</td></tr>'}</tbody></table>`;
  return tplDocumento({ titulo: 'Relatório de tarefas', subtitulo: `${respNome} — ${periodo} · posição em ${fdA(h)}`,
    meta: 'Cada tarefa recebe um código TAR-ano-número quando é criada · prazo = data de conclusão · atraso = dias entre o prazo e a conclusão (ou até hoje, se aberta)',
    corpo: `<div class="pag"><h2>Resumo</h2>${cards}<h2>Por responsável</h2>${tabResp}<h2>Por prioridade</h2>${tabPrio}<h2>Tarefas</h2>${tabDet}</div>` });
}

async function tfRelGerar(ev) {
  ev.preventDefault();
  const f = $('#tfRelForm');
  const c = { resp: TF.dados.admin ? f.elements.resp.value : '', sit: f.elements.sit.value, por: f.elements.por.value, ini: f.elements.ini.value, fim: f.elements.fim.value };
  if (c.ini && c.fim && c.fim < c.ini) { toast('A data final não pode ser anterior à inicial.', true); return; }
  Object.assign(TF_REL, c);
  $('#dlgTfRel').close();
  try {
    await tplLogosCarregar();
    reAbrirPrevia(tfRelHtml(c), `tarefas-${hoje()}.html`, 'Relatório de tarefas');
  } catch (err) { toast('Não foi possível montar o relatório: ' + err.message, true); }
}

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
    itens.slice(0, 12).map(({ t, s, minha }) => `<li><span class="farol ${s.cls}">${esc(s.rot)}</span> <span class="tf-cod">${esc(t.codigo || '')}</span> <a href="#" data-tf-abrir="${t.id}">${esc(t.titulo)}</a>
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
  if (b) l = l.filter(t => `${t.codigo || ''} ${t.titulo} ${t.descricao || ''} ${t.responsavel_nome || ''} ${t.criado_por_nome || ''} ${t.retorno || ''}`.toLowerCase().includes(b));
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
  $('#tfTarefasView').hidden = TF.aba !== 'tarefas';
  $('#tfMuralView').hidden = TF.aba !== 'mural';
  document.querySelectorAll('[data-tf-aba]').forEach(b => b.classList.toggle('ativa', b.dataset.tfAba === TF.aba));
  tfAtualizarNovas();
  if (TF.aba === 'mural') {
    const el = document.querySelector('#tfMuralView .tf-conv');
    if (!el.dataset.cvId) tfConvMontar(el, 0); else tfConvCarregar(el, true);
    $('#btnNovaTarefa').hidden = true;
    return;
  }
  $('#btnNovaTarefa').hidden = false;
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
  $('#tabTarefas').innerHTML = `<thead><tr><th>Código</th><th>Prioridade</th><th>Tarefa</th><th>Responsável</th><th>Início</th><th>Conclusão</th><th>Prazo</th><th>Situação</th><th>Ações</th></tr></thead><tbody>` +
    (lista.length ? lista.map(t => {
      const s = sit(t);
      const origem = t.pessoal ? '<span class="nota">lembrete pessoal</span>' : `<span class="nota">por ${esc(t.criado_por_nome || '—')}</span>`;
      return `<tr class="${tfAberta(t) ? '' : 'tf-fechada'} tf-p-${esc(t.prioridade)}">
        <td class="nw"><b class="tf-cod">${esc(t.codigo || '—')}</b></td>
        <td><span class="tf-prio tf-prio-${esc(t.prioridade)}">${esc(TF_PRIO[t.prioridade] || t.prioridade)}</span></td>
        <td class="tf-titulo"><a href="#" data-tf-abrir="${t.id}"><b>${esc(t.titulo)}</b></a>${t.descricao ? `<div class="nota tf-desc">${esc(t.descricao)}</div>` : ''}${t.n_msgs ? `<a href="#" data-tf-abrir="${t.id}" class="tf-msgs-n ${tfNovasTarefa(t) ? 'nova' : ''}" title="Conversa da tarefa">💬 ${t.n_msgs}${tfNovasTarefa(t) ? ' · nova' : ''}</a>` : ''}${t.retorno ? `<div class="nota tf-ret">Retorno: ${esc(t.retorno)}</div>` : ''}</td>
        <td>${esc(t.responsavel_nome || '—')}<br>${origem}</td>
        <td>${t.data_inicio ? fdA(t.data_inicio) : '—'}</td><td>${t.data_fim ? fdA(t.data_fim) : '—'}</td>
        <td><span class="farol ${s.cls}">${esc(s.rot)}</span></td><td>${statusSel(t)}</td>
        <td><button class="link" data-tf-abrir="${t.id}">${t.pode_editar ? 'Editar' : 'Abrir'}</button>${t.pode_editar ? ` · <button class="link perigo-txt" data-tf-excluir="${t.id}">Excluir</button>` : ''}</td></tr>`;
    }).join('') : `<tr><td colspan="9" class="vazio">Nenhuma tarefa neste filtro. Use “+ Nova tarefa” ou o lembrete rápido acima.</td></tr>`) + '</tbody>';

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
  $('#tfTit').textContent = t ? `${editaDados ? 'Editar tarefa' : 'Tarefa'} · ${t.codigo || ''}` : 'Nova tarefa';
  $('#tfCodigoNota').textContent = t ? `Código ${t.codigo || '—'} · criada em ${tfHora(t.criado_em)} por ${t.criado_por_nome || '—'}${t.iniciada_em ? ' · iniciada em ' + tfHora(t.iniciada_em) : ''}${t.concluida_em ? ' · concluída em ' + tfHora(t.concluida_em) : ''}` : 'O código (TAR-ano-número) é gerado quando a tarefa é salva.';
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
  $('#tfConversaBox').hidden = !t;
  if (t) tfConvMontar($('#tfConvTarefa'), t.id);
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
    const antes = new Set((TF.dados.tarefas || []).map(x => x.id));
    TF.dados = r; dlg.close(); tfAtualizarMenu(); renderTarefas();
    const nova = !t && r.tarefas.find(x => !antes.has(x.id));
    toast((nova ? `Tarefa criada · código ${nova.codigo}` : 'Tarefa salva') + (r.aviso_email ? ' · ' + r.aviso_email : ''));
  } catch (err) { toast(err.message, true); }
  finally { b.disabled = false; }
}

async function tfMudarStatus(id, status) {
  try { TF.dados = await postar(API + 'tarefas', { acao: 'status', id, status }); tfAtualizarMenu(); renderTarefas(); if (TF.dados.aviso_email) toast('Situação atualizada · ' + TF.dados.aviso_email); }
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
    const antes = new Set(TF.dados.tarefas.map(x => x.id));
    TF.dados = await postar(API + 'tarefas', { acao: 'salvar', titulo: tit.value, responsavel_id: TF.dados.usuario_id, data_inicio: hoje(), data_fim: fim.value, aviso_dias: 2, prioridade: 'normal' });
    tit.value = ''; fim.value = ''; tfAtualizarMenu(); renderTarefas();
    const nova = TF.dados.tarefas.find(x => !antes.has(x.id)); toast(nova ? `Lembrete criado · código ${nova.codigo}` : 'Lembrete criado');
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
    const ab = ev.target.closest('[data-tf-aba]');
    if (ab) { TF.aba = ab.dataset.tfAba; renderTarefas(); return; }
    const fl = ev.target.closest('[data-tf-filtro]');
    if (fl) { TF.filtro = fl.dataset.tfFiltro; renderTarefas(); return; }
    if (ev.target.closest('#btnNovaTarefa')) tfAbrir(null);
    if (ev.target.closest('#btnRelTarefas')) tfRelAbrir();
    if (ev.target.closest('#tfRapidoAdd')) tfLembreteRapido();
  });
  sec.addEventListener('change', ev => {
    const s = ev.target.closest('[data-tf-status]');
    if (s) { tfMudarStatus(+s.dataset.tfStatus, s.value); return; }
    if (ev.target.id === 'tfResp') { TF.resp = ev.target.value; renderTarefas(); }
  });
  sec.addEventListener('input', ev => { if (ev.target.id === 'tfBusca') { TF.busca = ev.target.value; const pos = ev.target.selectionStart; renderTarefas(); const n = $('#tfBusca'); n.focus(); n.setSelectionRange(pos, pos); } });
  sec.addEventListener('keydown', ev => { if (ev.key === 'Enter' && ev.target.id === 'tfRapidoTit') { ev.preventDefault(); tfLembreteRapido(); } });
  $('#tfRelForm').addEventListener('submit', tfRelGerar);
  $('#tfRelCancelar').addEventListener('click', () => $('#dlgTfRel').close());
  tfConvLigar(sec);
  tfConvLigar($('#dlgTarefa'));
  $('#tfForm').addEventListener('submit', tfSalvar);
  $('#tfCancelar').addEventListener('click', () => $('#dlgTarefa').close());
  $('#tfFechar').addEventListener('click', () => $('#dlgTarefa').close());
  $('#dlgTarefa').addEventListener('close', () => { if (abaAtual === 'tarefas') renderTarefas(); });
  $('#tfExcluir').addEventListener('click', ev => {
    const b = ev.currentTarget;
    if (!b.dataset.confirmar) { b.dataset.confirmar = '1'; b.textContent = 'Confirmar exclusão'; return; }
    const id = +$('#dlgTarefa').dataset.id; $('#dlgTarefa').close(); tfExcluir(id, true);
  });
  // conversas abertas se atualizam a cada 15 s (mural na aba Mural; conversa da tarefa com a janela aberta)
  setInterval(() => {
    if (document.hidden) return;
    if (abaAtual === 'tarefas' && TF.aba === 'mural') { const el = document.querySelector('#tfMuralView .tf-conv'); if (el.dataset.cvId) tfConvCarregar(el, true); }
    if (document.querySelector('#dlgTarefa[open]') && !$('#tfConversaBox').hidden) tfConvCarregar($('#tfConvTarefa'), true);
  }, 15000);
  // atualiza sozinho (tarefas atribuídas por outra pessoa chegam sem recarregar a página)
  setInterval(() => {
    if (document.hidden) return;
    const livre = abaAtual !== 'tarefas' || (!document.querySelector('#dlgTarefa[open]') && !sec.contains(document.activeElement) );
    if (!livre) return;
    tfCarregar(true).then(() => { if (abaAtual === 'tarefas') renderTarefas(); });
  }, 60000);
}

ligarTarefas();
