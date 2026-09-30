'use strict';

// ------------------------------------------------------------ estado
let D = null;            // resposta de /api/dados
let M = null;            // modelo da planilha
let T = null;            // tabelas do sistema (estoque, equipamentos)
let ref = null;          // data de referência / corte
let per = null;          // período do painel {ini, fim}
let abaAtual = 'painel';
let empSel = null;
let filtroImp = 'abertos';
const pend = new Map();  // `${aba}|${data}|${col}` -> texto digitado
const metasPend = new Map(); // linha -> {meta_dia, du, gap}
const graficos = {};
let EP = null;           // dados de estoque da planilha (/api/estoque-planilha)
let salvando = false;

const DIAS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const COR_EMP = { 'EJ': '--ej', 'CMM': '--cmm', 'GLOBO AÇOS': '--ga' };
const API = window.API_BASE || 'api/';
let ONDE = 'na planilha';
const ABAS_PERIODO = new Set(['painel', 'cliente', 'equip', 'tendencia', 'kpi']);

// ------------------------------------------------------------ utilidades
const $ = s => document.querySelector(s);
const p2 = n => String(n).padStart(2, '0');
function hoje() { const t = new Date(); return `${t.getFullYear()}-${p2(t.getMonth() + 1)}-${p2(t.getDate())}`; }
function dU(s) { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); }
function add(s, n) { const d = dU(s); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function dow(s) { return (dU(s).getUTCDay() + 6) % 7; }
function segunda(s) { return add(s, -dow(s)); }
function diasEntre(a, b) { return Math.round((dU(b) - dU(a)) / 864e5); }
const ehISO = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const minD = (a, b) => (a < b ? a : b);
const maxD = (a, b) => (a > b ? a : b);
function fd(s) { if (!s) return '—'; if (!ehISO(s)) return esc(s); const [, m, d] = s.split('-'); return `${d}/${m}`; }
function fdA(s) { if (!s) return '—'; if (!ehISO(s)) return esc(s); const [y, m, d] = s.split('-'); return `${d}/${m}/${y}`; }
function isoDeTexto(t) { const m = t.match(/^(\d{1,2})\/?(\d{1,2})\/?(\d{4})$/); return m ? `${m[3]}-${p2(m[2])}-${p2(m[1])}` : null; }
function patchDatas() {
  document.querySelectorAll('input[type="date"]:not([data-patched])').forEach(inp => {
    inp.setAttribute('data-patched', '1');
    const txt = document.createElement('input');
    txt.type = 'text'; txt.className = inp.className; txt.placeholder = 'dd/mm/aaaa';
    txt.style.cssText = inp.style.cssText;
    txt.value = inp.value ? fdA(inp.value) : '';
    inp.style.position = 'absolute'; inp.style.opacity = '0'; inp.style.pointerEvents = 'none'; inp.style.width = '0'; inp.style.height = '0'; inp.style.overflow = 'hidden';
    inp.parentNode.insertBefore(txt, inp.nextSibling);
    inp._txtPar = txt;
    txt.addEventListener('change', () => { const iso = isoDeTexto(txt.value.trim()); if (iso && ehISO(iso)) { inp.value = iso; inp.dispatchEvent(new Event('change', {bubbles:true})); txt.value = fdA(iso); } });
    txt.addEventListener('focus', () => { inp.style.position = ''; inp.style.opacity = ''; inp.style.pointerEvents = ''; inp.style.width = ''; inp.style.height = ''; inp.style.overflow = ''; txt.style.display = 'none'; inp.focus(); });
    inp.addEventListener('blur', () => { inp.style.position = 'absolute'; inp.style.opacity = '0'; inp.style.pointerEvents = 'none'; inp.style.width = '0'; inp.style.height = '0'; inp.style.overflow = 'hidden'; txt.style.display = ''; txt.value = inp.value ? fdA(inp.value) : ''; });
    inp.addEventListener('change', () => { txt.value = inp.value ? fdA(inp.value) : ''; });
  });
  document.querySelectorAll('input[type="date"][data-patched]').forEach(inp => { if (inp._txtPar) inp._txtPar.value = inp.value ? fdA(inp.value) : ''; });
}
function esc(v) { return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function nf(v, dec = 0) { return v == null || isNaN(v) ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: dec }); }
function rs(v) { return v == null || isNaN(v) ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }); }
function cap(s) { return String(s || '').toLowerCase().replace(/(^|\s|–|-|\/)(\S)/g, (m, a, b) => a + b.toUpperCase()); }
function cor(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }
function corEmp(nome) { return `var(${COR_EMP[nome] || '--fg3'})`; }
function corEmpHex(nome) { return cor(COR_EMP[nome] || '--fg3'); }
function diaUtil(s) { return dow(s) < 5; }
function somarDiasUteis(s, n) { let d = s; while (n > 0) { d = add(d, 1); if (diaUtil(d)) n--; } return d; }
function contarDiasUteis(a, b) { let n = 0; for (let d = add(a, 1); d <= b; d = add(d, 1)) if (diaUtil(d)) n++; return n; }
function normEmp(s) { const t = String(s || '').trim().toUpperCase(); return t === 'GA' || t.startsWith('GLOBO') ? 'GLOBO AÇOS' : t; }
function empresasDe(s) { return String(s || '').split('/').map(normEmp).filter(Boolean); }
const soma0 = (arr, f) => arr.reduce((a, x) => a + (f(x) || 0), 0);

function toast(msg, erro = false, duracao) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast mostra' + (erro ? ' erro' : '');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.className = 'toast' + (erro ? ' erro' : ''), duracao || (erro ? 6000 : 2600));
}

// ------------------------------------------------------------ regras de baixa (regras_baixa.json)
// Devolve as regras já carregadas; se ainda não, busca uma vez e chama `refazer` ao terminar.
function regrasBaixa(refazer) {
  if (window._regras_baixa) return window._regras_baixa;
  if (!window._regras_pend) {
    window._regras_pend = fetch(API + 'regras-baixa', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : {})
      .catch(() => ({}))
      .then(j => { window._regras_baixa = j; });
  }
  window._regras_pend.then(refazer);
  return null;
}

// ------------------------------------------------------------ scroll topo sincronizado
function syncScrollTopo() {
  document.querySelectorAll('.tabela-rolagem:not(.grade-lanc)').forEach(el => {
    const tem = el.scrollWidth > el.clientWidth + 2;
    let topo = el.previousElementSibling;
    if (topo && !topo.classList.contains('scroll-topo')) topo = null;
    if (!tem) { if (topo) topo.remove(); return; }
    if (!topo) {
      topo = document.createElement('div');
      topo.className = 'scroll-topo';
      topo.innerHTML = '<div></div>';
      el.parentNode.insertBefore(topo, el);
      let syncing = false;
      topo.addEventListener('scroll', () => { if (!syncing) { syncing = true; el.scrollLeft = topo.scrollLeft; syncing = false; } });
      el.addEventListener('scroll', () => { if (!syncing) { syncing = true; topo.scrollLeft = el.scrollLeft; syncing = false; } });
    }
    topo.firstChild.style.width = el.scrollWidth + 'px';
  });
}

// ------------------------------------------------------------ dados de produção
function empresa(nome) { return M.empresas.find(e => e.nome === nome); }
function colDe(e, serv) { const s = e && e.servicos.find(x => x.nome === serv); return s ? s.col : null; }
function soma(e, col, ini, fim) {
  let t = 0;
  for (const d in e.registros) {
    if (d >= ini && d <= fim) { const v = e.registros[d].v[col]; if (typeof v === 'number') t += v; }
  }
  return t;
}
function prodServico(servico, empresaNome, ini, fim) {
  let t = 0;
  M.empresas.forEach(e => {
    if (empresaNome && e.nome !== empresaNome) return;
    e.servicos.filter(s => s.nome === servico).forEach(s => t += soma(e, s.col, ini, fim));
  });
  return t;
}
function metasSemana(r) { const s = segunda(r); return M.metas.filter(m => m.inicio === s); }
const metaSemanaTotal = m => m.meta_dia * m.du + (m.gap || 0);

function diasDecorridos(m, r) {
  if (r < m.inicio) return 0;
  const lim = minD(r, m.fim);
  let n = 0;
  for (let d = m.inicio; d <= lim; d = add(d, 1)) if (diaUtil(d)) n++;
  return m.du ? Math.min(n, m.du) : n;
}

function kpi(m, r) {
  const e = empresa(m.empresa), col = colDe(e, m.servico);
  const semana = metaSemanaTotal(m);
  const dec = diasDecorridos(m, r);
  const prevAte = m.du ? semana * dec / m.du : 0;
  const real = col && r >= m.inicio ? soma(e, col, m.inicio, minD(r, m.fim)) : 0;
  const realSemana = col ? soma(e, col, m.inicio, m.fim) : 0;
  const pct = prevAte > 0 ? real / prevAte * 100 : null;
  return { m, e, col, semana, prevAte, real, realSemana, pct, dec };
}

// Previsto distribuído pelos dias úteis de cada semana de meta.
function diasMeta(m) {
  if (!m._d) { const ds = []; for (let d = m.inicio; d <= m.fim && ds.length < (m.du || 0); d = add(d, 1)) if (diaUtil(d)) ds.push(d); m._d = ds; }
  return m._d;
}
function prevMeta(m, ini, fim) {
  const ds = diasMeta(m);
  return ds.length ? metaSemanaTotal(m) / ds.length * ds.filter(d => d >= ini && d <= fim).length : 0;
}
function paresMeta() {
  const vistos = new Map();
  M.metas.forEach(m => { const k = m.empresa + '|' + m.servico; if (!vistos.has(k)) vistos.set(k, [m.empresa, m.servico]); });
  return [...vistos.values()];
}
function kpiPer(emp, serv, ini, fim, corte) {
  const e = empresa(emp), col = colDe(e, serv);
  const ms = M.metas.filter(m => m.empresa === emp && m.servico === serv && m.fim >= ini && m.inicio <= fim);
  const prevTotal = soma0(ms, m => prevMeta(m, ini, fim));
  const prev = corte < ini ? 0 : soma0(ms, m => prevMeta(m, ini, minD(fim, corte)));
  const real = col && corte >= ini ? soma(e, col, ini, minD(fim, corte)) : 0;
  return { emp, serv, e, col, prevTotal, prev, real, pct: prev > 0 ? real / prev * 100 : null };
}

function farol(pct, semMeta) {
  if (semMeta) return ['pendente', 'SEM META'];
  if (pct == null) return ['pendente', 'PENDENTE'];
  if (pct >= 100) return ['verde', 'VERDE'];
  if (pct >= 90) return ['amarelo', 'AMARELO'];
  return ['vermelho', 'VERMELHO'];
}
function farolHtml(pct, semMeta) { const [c, t] = farol(pct, semMeta); return `<span class="farol f-${c}">${t}</span>`; }
const corte = () => minD(per.fim, ref);

// ------------------------------------------------------------ comunicação
async function carregar() {
  const r = await fetch(API + 'dados', { cache: 'no-store' });
  if (r.status === 401) { location.href = 'login.php'; return; }
  const j = await r.json();
  if (!r.ok) throw new Error(j.erro || 'Falha ao ler a planilha');
  D = j; M = j.modelo; T = M.tabelas || { materiais: [], movimentos: [], equipamentos: [], usos: [] };
  ['bm_atividades', 'bm_periodos', 'bm_apontamentos', 'bm_deducoes', 'bm_fechamentos', 'bm_fech_atividades',
   'estoque_eventos', 'estoque_remessas', 'estoque_inventario'].forEach(k => T[k] ||= []);
  if (!empSel || !M.empresas.some(e => e.aba === empSel)) empSel = M.empresas[0]?.aba;
  $('#arquivoTxt').textContent = `${j.arquivo} · gravada em ${new Date(j.modificado).toLocaleString('pt-BR')}`;
  $('#pontoSync').className = 'ponto ok';
  $('#faixaExterna').hidden = true;
  const rec = j.recursos || {};
  ONDE = rec.online ? 'no sistema' : 'na planilha';
  document.querySelectorAll('.btn-salvar-destino').forEach(b => b.textContent = rec.online ? 'Salvar' : 'Salvar na planilha');
  $('#btnImportarEq').hidden = rec.importar_mensal === false;
  if (j.usuario) {
    const u = j.usuario;
    $('#usuarioBox').hidden = false;
    $('#usuarioBox').innerHTML = `<span>${esc(u.nome)}${u.empresa ? ' · ' + esc(u.empresa) : ''}</span>${u.perfil === 'admin' ? '<a href="admin.php">Administração</a>' : ''}<a href="sair.php">Sair</a>`;
    document.body.classList.toggle('somente-leitura', u.perfil === 'leitura');
  }
  if (rec.exportar) { $('#usuarioBox').hidden = false; $('#usuarioBox').innerHTML = '<a href="api/exportar">Exportar dados para o sistema online</a>'; }
  preencherListas();
  renderTudo();
  fetch(API + 'estoque-planilha', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(j => { EP = j; if (abaAtual === 'estoque') renderEstoquePlanilha(); }).catch(() => {});
}

async function postar(url, corpo) {
  salvando = true;
  try { return await postarBruto(url, corpo); } finally { salvando = false; }
}

async function postarBruto(url, corpo) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
  if (r.status === 401) { location.href = 'login.php'; throw new Error('Sessão expirada'); }
  const j = await r.json().catch(() => ({ erro: 'Resposta inválida do servidor' }));
  if (!r.ok) throw new Error(j.erro || 'Falha ao gravar');
  if (j.versao && D) D.versao = j.versao;
  return j;
}

async function verificarVersao() {
  if (salvando || !D) return;
  try {
    const r = await fetch(API + 'versao', { cache: 'no-store' });
    const j = await r.json();
    $('#pontoSync').className = 'ponto ok';
    if (j.versao !== D.versao) {
      if (pend.size || metasPend.size) { $('#faixaExterna').hidden = false; return; }
      await carregar();
      toast('Planilha atualizada automaticamente');
    }
  } catch {
    $('#pontoSync').className = 'ponto erro';
    $('#arquivoTxt').textContent = 'Sem conexão com o programa. Verifique se a janela do servidor está aberta.';
  }
}

function preencherListas() {
  const serv = new Set(), emps = new Set(['EJ', 'CMM', 'GLOBO AÇOS', 'EJ/CMM']);
  M.empresas.forEach(e => { emps.add(e.nome); e.servicos.forEach(s => serv.add(s.nome)); });
  M.impactos.forEach(i => i.servico && serv.add(String(i.servico).toUpperCase()));
  T.usos.forEach(u => u.empresa && emps.add(u.empresa));
  $('#listaServicos').innerHTML = [...serv].sort().map(n => `<option value="${esc(n)}">`).join('');
  $('#listaEmpresas').innerHTML = [...emps].sort().map(n => `<option value="${esc(n)}">`).join('');
  $('#listaEquip').innerHTML = T.equipamentos.map(e => `<option value="${esc(e.equipamento)}">`).join('');
}

// ------------------------------------------------------------ navegação e período
function mudarAba(nome) {
  abaAtual = nome;
  document.querySelectorAll('#abas button').forEach(b => b.classList.toggle('ativa', b.dataset.aba === nome));
  document.querySelectorAll('main > section').forEach(s => s.hidden = s.id !== 'aba-' + nome);
  $('#barraPeriodo').hidden = !ABAS_PERIODO.has(nome);
  try { localStorage.setItem('obra198_aba', nome); } catch { }
  renderAba();
}

function definirRef(d) {
  if (!ehISO(d)) return;
  ref = d;
  $('#refData').value = d;
  const s = segunda(d);
  $('#semanaTxt').textContent = `Semana ${fdA(s)} a ${fdA(add(s, 6))}`;
  definirPeriodo(s, add(s, 6), 'semana');
}

function definirPeriodo(ini, fim, atalho) {
  if (!ehISO(ini) || !ehISO(fim)) return;
  if (fim < ini) [ini, fim] = [fim, ini];
  per = { ini, fim };
  $('#perIni').value = ini; $('#perFim').value = fim;
  patchDatas();
  document.querySelectorAll('#perAtalhos button').forEach(b => b.classList.toggle('ativa', b.dataset.p === atalho));
  $('#perTxt').textContent = `${diasEntre(ini, fim) + 1} dias · ${contarDiasUteis(add(ini, -1), fim)} dias úteis · resultados apurados até ${fdA(minD(fim, ref))}`;
  renderTudo();
}

function atalhoPeriodo(p) {
  const s = segunda(ref);
  if (p === 'semana') return definirPeriodo(s, add(s, 6), p);
  if (p === 'mes') { const ini = ref.slice(0, 8) + '01'; const d = dU(ini); d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(0); return definirPeriodo(ini, d.toISOString().slice(0, 10), p); }
  if (p === '30') return definirPeriodo(add(ref, -29), ref, p);
  if (p === 'obra') return definirPeriodo(M?.datas[0] || add(ref, -90), ref, p);
}

function renderTudo() {
  if (!M) return;
  const abertos = M.impactos.filter(i => !i.solucionado).length;
  $('#impCont').hidden = !abertos; $('#impCont').textContent = abertos;
  const rExt = estoqueExternoResumo();
  const falta = estoqueLinhas().filter(l => l.nivel === 'vermelho').length + (rExt ? rExt.etapas.filter(e => e.nivel === 'vermelho').length + rExt.fixCrit.length : 0);
  $('#estCont').hidden = !falta; $('#estCont').textContent = falta;
  const c = corte();
  const ksG = paresMeta().map(([e, s]) => kpiPer(e, s, per.ini, per.fim, c));
  const kpiAlerts = ksG.filter(k => k.pct != null && k.pct < 90).length + abertos + (EP ? EP.materiais.filter(m => m.status_logistico === 'Crítico').length : 0);
  const kpiC = document.getElementById('kpiCont');
  if (kpiC) { kpiC.hidden = !kpiAlerts; kpiC.textContent = kpiAlerts; }
  atualizarPendentes();
  renderAba();
}

function renderAba() {
  if (!M) return;
  ({ painel: renderPainel, semana: renderSemana, lanc: renderLanc, avanco: renderAvanco, cliente: renderCliente,
     estoque: renderEstoque, equip: renderEquip, bm: renderBM, metas: renderMetas, impactos: renderImpactos, tendencia: renderTendencia, kpi: renderKPI })[abaAtual]();
  requestAnimationFrame(syncScrollTopo);
}

// ------------------------------------------------------------ PAINEL (por período)
function renderPainel() {
  const c = corte();
  const ks = paresMeta().map(([e, s]) => kpiPer(e, s, per.ini, per.fim, c)).filter(k => k.prevTotal > 0 || k.real > 0);
  const du = c >= per.ini ? contarDiasUteis(add(per.ini, -1), c) : 0;
  $('#notaFarol').textContent = `Previsto distribuído pelos dias úteis das metas · corte em ${fdA(c)}`;

  const porEmp = {};
  ks.forEach(k => {
    const o = porEmp[k.emp] ||= { prev: 0, real: 0, total: 0 };
    if (k.prevTotal > 0) { o.prev += k.prev; o.real += k.real; o.total += k.prevTotal; }
  });
  const tot = Object.values(porEmp).reduce((a, o) => ({ prev: a.prev + o.prev, real: a.real + o.real, total: a.total + o.total }), { prev: 0, real: 0, total: 0 });
  const tile = (rot, o, cc) => {
    const pct = o.prev > 0 ? o.real / o.prev * 100 : null;
    return `<div class="tile" style="--c:${cc}"><div class="rot"><span>${esc(rot)}</span>${farolHtml(pct, o.total === 0)}</div>
      <div class="val">${pct == null ? '—' : nf(pct) + '%'}</div>
      <div class="sub">${nf(o.real)} realizados de ${nf(o.prev, 1)} previstos até ${fd(c)} · meta do período ${nf(o.total, 1)}</div></div>`;
  };
  $('#tiles').innerHTML = ks.length
    ? tile('Geral da obra', tot, 'var(--fg)') + Object.entries(porEmp).map(([n, o]) => tile(n, o, corEmp(n))).join('')
    : `<div class="bloco vazio">Não há metas nem produção no período de ${fdA(per.ini)} a ${fdA(per.fim)}.</div>`;

  let h = `<thead><tr><th>Serviço</th><th class="n">Meta do período</th><th class="n">Previsto até ${fd(c)}</th><th class="n">Realizado</th><th class="n">Desvio</th><th class="n">Média/dia útil</th><th>Farol</th><th style="min-width:90px">% da meta</th></tr></thead><tbody>`;
  let ultimo = null;
  ks.forEach(k => {
    if (k.emp !== ultimo) { ultimo = k.emp; h += `<tr class="grupo"><td colspan="8"><span class="emp-tag" style="--c:${corEmp(ultimo)}">${esc(ultimo)}</span></td></tr>`; }
    const semMeta = k.prevTotal === 0, desvio = k.real - k.prev;
    const pctTot = k.prevTotal > 0 ? Math.min(100, k.real / k.prevTotal * 100) : 0;
    const atrasado = k.prev > 0 && k.real === 0 && c >= per.ini;
    h += `<tr><td>${esc(cap(k.serv))}${atrasado ? ' <span class="farol f-vermelho" style="font-size:.7em">ATRASADO</span>' : ''}</td><td class="n">${nf(k.prevTotal, 1)}</td><td class="n">${nf(k.prev, 1)}</td><td class="n"><b>${nf(k.real, 1)}</b></td>
      <td class="n" style="color:${semMeta ? 'inherit' : desvio < 0 ? 'var(--vermelho)' : 'var(--verde)'}">${semMeta ? '—' : (desvio > 0 ? '+' : '') + nf(desvio, 1)}</td>
      <td class="n">${du ? nf(k.real / du, 2) : '—'}</td><td>${farolHtml(k.pct, semMeta)}</td>
      <td><div class="barra" title="${nf(pctTot)}% da meta do período"><i style="width:${pctTot}%;--c:${corEmp(k.emp)}"></i></div></td></tr>`;
  });
  $('#tabFarol').innerHTML = h + '</tbody>';
  renderAlertas(ks, c);
  graficoPainel(ks);
}

function renderAlertas(ks, c) {
  const al = [];
  ks.filter(k => k.prevTotal > 0 && k.pct != null && k.pct < 90).sort((a, b) => a.pct - b.pct).forEach(k =>
    al.push(['vermelho', `<b>${esc(k.emp)} · ${esc(cap(k.serv))}</b>: ${nf(k.real, 1)} de ${nf(k.prev, 1)} previstos (${nf(k.pct)}%). Faltam ${nf(Math.max(k.prevTotal - k.real, 0), 1)} para a meta do período.`]));
  ks.filter(k => k.prevTotal > 0 && k.pct != null && k.pct >= 90 && k.pct < 100).forEach(k =>
    al.push(['amarelo', `<b>${esc(k.emp)} · ${esc(cap(k.serv))}</b>: no limite (${nf(k.pct)}%).`]));

  const limite = minD(add(c, -1), per.fim);
  [...new Set(ks.filter(k => k.prevTotal > 0).map(k => k.emp))].forEach(n => {
    const e = empresa(n); if (!e) return;
    const faltam = [];
    for (let d = per.ini; d <= limite; d = add(d, 1)) if (diaUtil(d) && !e.registros[d]) faltam.push(fd(d));
    if (faltam.length) al.push(['amarelo', `<b>${esc(n)}</b> sem lançamento em ${faltam.length > 6 ? faltam.length + ' dias úteis (últimos: ' + faltam.slice(-6).join(', ') + ')' : faltam.join(', ')}. <button class="link" data-ir-lanc="${esc(e.aba)}">Lançar agora</button>`]);
  });

  estoqueLinhas().filter(l => l.nivel !== 'verde' && l.nivel !== 'pendente').forEach(l =>
    al.push([l.nivel, `<b>Estoque · ${esc(l.material)}</b>: ${esc(l.status.toLowerCase())}. Saldo ${nf(l.saldo, 1)} ${esc(l.unidade || '')}, necessário ${nf(l.necSemana + l.necProx, 1)} até a próxima semana. <button class="link" data-ir-aba="estoque">Ver estoque</button>`]));

  alertasEstoqueExterno().forEach(x => al.push(x));
  const abertos = M.impactos.filter(i => !i.solucionado);
  if (abertos.length) {
    const velhos = abertos.filter(i => ehISO(i.data)).sort((a, b) => a.data.localeCompare(b.data)).slice(0, 3)
      .map(i => `${esc(cap(i.motivo))} (${diasEntre(i.data, ref)} dias)`);
    al.push(['vermelho', `<b>${abertos.length} impacto(s) em aberto</b>. Mais antigos: ${velhos.join('; ')}. <button class="link" data-ir-aba="impactos">Ver impactos</button>`]);
  }
  contratoLinhas(c).filter(x => x.status === 'ATRASO').forEach(x =>
    al.push(['vermelho', `<b>${esc(cap(x.servico))}</b>: no ritmo atual termina em ${fdA(x.projecao)}, depois do prazo ${fdA(x.prazo)}. Necessário ${nf(x.necessario, 2)}/dia; ritmo atual ${nf(x.ritmo, 2)}/dia.`]));

  M.cliente.filter(cl => cl.inicio_plan && cl.inicio_plan <= hoje()).forEach(cl => {
    const produzido = prodServico(cl.servico, null, '2000-01-01', hoje());
    if (produzido === 0) al.push(['vermelho', `<b>${esc(cap(cl.servico))}</b>: planejado iniciar em ${fd(cl.inicio_plan)} mas ainda não iniciado — <span class="farol f-vermelho">ATRASADO</span>`]);
  });

  $('#alertas').innerHTML = al.length
    ? al.map(([n, t]) => `<li><span class="farol f-${n}">${n === 'vermelho' ? 'CRÍTICO' : 'ATENÇÃO'}</span><span>${t}</span></li>`).join('')
    : '<li class="vazio">Nenhum ponto de atenção para o período.</li>';
}

function eixos(extraY = {}, extraX = {}) {
  const txt = cor('--fg2'), grade = cor('--linha');
  return {
    x: { ticks: { color: txt }, grid: { display: false }, ...extraX },
    y: { beginAtZero: true, ticks: { color: txt }, grid: { color: grade }, border: { display: false }, ...extraY },
  };
}

function trocarGrafico(id, cfg) {
  if (typeof Chart === 'undefined') return;
  graficos[id]?.destroy();
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  Chart.defaults.animation.duration = 250;
  graficos[id] = new Chart(document.getElementById(id), cfg);
}

function graficoPainel(ks) {
  const lista = ks.filter(k => k.prevTotal > 0 || k.real > 0);
  trocarGrafico('gPainel', {
    type: 'bar',
    data: {
      labels: lista.map(k => [k.emp, cap(k.serv)]),
      datasets: [
        { label: 'Previsto até a data de corte', data: lista.map(k => +k.prev.toFixed(1)), backgroundColor: cor('--prev'), borderRadius: 4, maxBarThickness: 28 },
        { label: 'Realizado', data: lista.map(k => k.real), backgroundColor: lista.map(k => corEmpHex(k.emp)), borderRadius: 4, maxBarThickness: 28 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${nf(c.raw, 1)}` } } },
      scales: eixos(),
    },
  });
}

// ------------------------------------------------------------ PROGRAMAÇÃO SEMANAL
function renderSemana() {
  const s = segunda(ref);
  const dias = [0, 1, 2, 3, 4, 5].map(i => add(s, i));
  const ks = metasSemana(ref).map(m => kpi(m, ref));
  let h = '<thead><tr><th>Serviço</th>' + dias.map((d, i) => `<th class="n ${d === ref ? 'hoje' : ''}" style="text-align:center">${DIAS[i]}<br>${fd(d)}</th>`).join('') + '<th class="n">Semana</th><th>Farol</th></tr></thead><tbody>';
  let ultimo = null;
  const linha = (rotulo, e, col, meta, k) => {
    let r = `<tr><td>${rotulo}</td>`;
    dias.forEach(d => {
      const dentro = meta && d >= meta.inicio && d <= meta.fim && diaUtil(d);
      const md = dentro ? meta.meta_dia : 0;
      const v = e.registros[d]?.v[col];
      const futuro = d > ref;
      let cls = 'dia' + (d === ref ? ' hoje' : '');
      if (futuro) cls += ' futuro';
      else if (md > 0 && typeof v === 'number') cls += ' c-' + farol(v / md * 100)[0];
      else if (md > 0 && d < ref && v == null) cls += ' c-vermelho';
      const valor = v == null ? (futuro ? '' : '—') : (typeof v === 'number' ? nf(v, 1) : `<span class="nota">${esc(v)}</span>`);
      r += `<td class="${cls}"><b>${valor}</b>${md > 0 ? `<small>meta ${nf(md, 2)}</small>` : ''}</td>`;
    });
    if (k) r += `<td class="n"><b>${nf(k.realSemana, 1)}</b> / ${nf(k.semana, 1)}</td><td>${farolHtml(k.pct, k.semana === 0)}</td>`;
    else r += `<td class="n"><b>${nf(soma(e, col, s, add(s, 6)), 1)}</b></td><td><span class="nota">sem meta</span></td>`;
    return r + '</tr>';
  };
  ks.forEach(k => {
    if (k.m.empresa !== ultimo) { ultimo = k.m.empresa; h += `<tr class="grupo"><td colspan="9"><span class="emp-tag" style="--c:${corEmp(ultimo)}">${esc(ultimo)}</span></td></tr>`; }
    if (k.col) h += linha(esc(cap(k.m.servico)), k.e, k.col, k.m, k);
  });
  const extras = [];
  M.empresas.forEach(e => e.servicos.forEach(sv => {
    const temMeta = ks.some(k => k.e === e && k.col === sv.col);
    if (!temMeta && dias.some(d => e.registros[d]?.v[sv.col] != null)) extras.push([e, sv]);
  }));
  if (extras.length) {
    h += `<tr class="grupo"><td colspan="9">Outros serviços com produção na semana</td></tr>`;
    extras.forEach(([e, sv]) => h += linha(`<span class="emp-tag" style="--c:${corEmp(e.nome)}">${esc(e.nome)}</span> ${esc(cap(sv.nome))}`, e, sv.col, null, null));
  }
  $('#tabSemana').innerHTML = h + '</tbody>';

  const plan = ks.filter(k => k.semana > 0);
  const responsavelDe = serv => { const cl = M.cliente.find(c => c.servico === serv); return cl?.responsavel || ''; };
  $('#planejado').innerHTML = plan.length ? plan.map(k => {
    const resp = responsavelDe(k.m.servico);
    const atrasado = k.pct != null && k.pct < 90 && ref > k.m.inicio;
    return `<li><span><span class="emp-tag" style="--c:${corEmp(k.m.empresa)}">${esc(k.m.empresa)}</span> ${esc(cap(k.m.servico))}${resp ? ` <small>(${esc(resp)})</small>` : ''}${atrasado ? ' <span class="farol f-vermelho">ATRASADO</span>' : ''}</span>
      <span>${nf(k.m.meta_dia, 2)}/dia × ${nf(k.m.du)} dias${k.m.gap ? ` + GAP ${nf(k.m.gap, 1)}` : ''} = <b>${nf(k.semana, 1)}</b> · realizado <b>${nf(k.realSemana, 1)}</b> (${k.pct != null ? nf(k.pct, 0) + '%' : '—'})</span></li>`;
  }).join('')
    : '<li class="vazio">Nenhum serviço com meta nesta semana.</li>';

  const fim = add(s, 6);
  const imps = M.impactos.filter(i => ehISO(i.data) && i.data >= s && i.data <= fim);
  $('#impSemana').innerHTML = imps.length ? imps.map(i => `<li><span><b>${fd(i.data)}</b> · ${esc(cap(i.servico))}: ${esc(i.motivo)}</span><span>${i.solucionado ? '<span class="farol f-verde">SOLUCIONADO</span>' : '<span class="farol f-vermelho">ABERTO</span>'}</span></li>`).join('')
    : '<li class="vazio">Nenhum impacto registrado nesta semana.</li>';
}

// ------------------------------------------------------------ LANÇAMENTOS
const chave = (aba, d, c) => `${aba}|${d}|${c}`;
function textoSalvo(e, d, c) {
  const r = e.registros[d];
  const v = r ? (c === e.col_obs ? r.obs : r.v[c]) : null;
  if (v == null) return '';
  return typeof v === 'number' ? String(v).replace('.', ',') : String(v);
}

function renderLanc() {
  $('#segEmpresas').innerHTML = M.empresas.map(e => {
    const n = [...pend.keys()].filter(k => k.startsWith(e.aba + '|')).length + [...bmPend.keys()].filter(k => k.startsWith(e.nome + '|')).length;
    return `<button data-emp="${esc(e.aba)}" class="${e.aba === empSel ? 'ativa' : ''}">${esc(e.nome)}${n ? ` <span class="contador">${n}</span>` : ''}</button>`;
  }).join('');
  const e = M.empresas.find(x => x.aba === empSel);
  if (!e) return;
  document.querySelectorAll('#segLancModo button').forEach(b => b.classList.toggle('ativa', b.dataset.modo === lancModo));
  $('#tabLanc').className = '';
  if (lancModo === 'servico') return renderLancServico(e);
  const s = segunda(ref), dias = [0, 1, 2, 3, 4, 5, 6].map(i => add(s, i));
  const noCal = new Set(M.datas);
  const fechadosG = bmPeriodos(e.nome).filter(p => p.fechado);

  const grupos = [];
  e.servicos.forEach(sv => { const g = grupos[grupos.length - 1]; if (g && g.f === sv.frente) g.n++; else grupos.push({ f: sv.frente, n: 1 }); });
  let h = '<thead><tr><th class="fixa" rowspan="2">Dia</th>' + grupos.map(g => `<th class="frente" colspan="${g.n}">${esc(g.f)}</th>`).join('') + (e.col_obs ? '<th rowspan="2">Observação / Nº RDO / foto</th>' : '') + '</tr><tr>';
  h += e.servicos.map(sv => `<th class="n" title="${esc(sv.id)}">${esc(cap(sv.nome))}</th>`).join('') + '</tr></thead><tbody>';

  dias.forEach((d, i) => {
    const dentro = noCal.has(d);
    h += `<tr class="${i >= 5 ? 'fds' : ''} ${d === ref ? 'hoje' : ''} ${dentro ? '' : 'fora'}"><td class="fixa">${DIAS[i]} ${fd(d)}</td>`;
    const campo = (col, cls) => {
      const k = chave(e.aba, d, col);
      const v = pend.has(k) ? pend.get(k) : textoSalvo(e, d, col);
      const ehTexto = v !== '' && isNaN(Number(v.replace(',', '.')));
      const fz = cls === 'txt' ? undefined : fechadosG.find(p => d >= p.ini && d <= p.fim);
      const marcaF = fz ? `data-fechado="${fz.n}" title="Período do BM${fz.n}, já fechado: a correção entra como ajuste no BM em aberto"` : '';
      return `<td><input class="${cls} ${pend.has(k) ? 'editado' : ''} ${ehTexto && cls !== 'txt' ? 'texto-val' : ''}" data-d="${d}" data-c="${col}" value="${esc(v)}" ${dentro ? '' : 'disabled'} ${marcaF} inputmode="${cls === 'txt' ? 'text' : 'decimal'}" aria-label="${DIAS[i]} ${fd(d)}"></td>`;
    };
    e.servicos.forEach(sv => h += campo(sv.col, 'num'));
    if (e.col_obs) h += campo(e.col_obs, 'txt');
    h += '</tr>';
  });
  h += '</tbody><tfoot>';
  const rodape = (rot, fn) => `<tr><td class="fixa">${rot}</td>${e.servicos.map(sv => `<td>${fn(sv)}</td>`).join('')}${e.col_obs ? '<td></td>' : ''}</tr>`;
  const acum = sv => soma(e, sv.col, '0000', '9999');
  h += rodape('Semana', sv => nf(soma(e, sv.col, s, add(s, 6)), 1));
  h += rodape('Acumulado', sv => nf(acum(sv), 1));
  h += rodape('Escopo', sv => nf(sv.escopo));
  h += rodape('% executado', sv => sv.escopo ? nf(acum(sv) / sv.escopo * 100, 1) + '%' : '—');
  $('#tabLanc').innerHTML = h + '</tfoot>';
}

function pendentesEmPeriodoFechado() {
  const cache = {};
  const fech = emp => cache[emp] ||= bmPeriodos(emp).filter(p => p.fechado);
  let n = 0;
  pend.forEach((v, k) => {
    const [aba, data, col] = k.split('|'), e = M.empresas.find(x => x.aba === aba);
    if (e && col !== e.col_obs && fech(e.nome).some(p => data >= p.ini && data <= p.fim)) n++;
  });
  bmPend.forEach((v, k) => { const [emp, , data] = k.split('|'); if (fech(emp).some(p => data >= p.ini && data <= p.fim)) n++; });
  return n;
}

function atualizarPendentes() {
  const n = pend.size + bmPend.size;
  const nf_ = n ? pendentesEmPeriodoFechado() : 0;
  $('#pendCont').hidden = !n; $('#pendCont').textContent = n;
  $('#pendTxt').textContent = n ? `${n} alteração(ões) não salva(s)${nf_ ? ` · ${nf_} em período de BM fechado (vira ajuste no BM em aberto)` : ''}` : `Tudo salvo ${ONDE}`;
  $('#btnSalvar').disabled = !n || salvando;
  $('#btnDescartar').disabled = !n || salvando;
}

function aoEditarLanc(inp) {
  const e = M.empresas.find(x => x.aba === empSel);
  const novo = inp.value.trim();
  if (inp.dataset.bm) {
    const kb = bmChave(e.nome, inp.dataset.cod, inp.dataset.d);
    if (novo === bmQtdSalva(e.nome, inp.dataset.cod, inp.dataset.d)) bmPend.delete(kb); else bmPend.set(kb, novo);
    inp.classList.toggle('editado', bmPend.has(kb));
  } else {
    const k = chave(e.aba, inp.dataset.d, inp.dataset.c);
    if (novo === textoSalvo(e, inp.dataset.d, inp.dataset.c)) pend.delete(k); else pend.set(k, novo);
    inp.classList.toggle('editado', pend.has(k));
  }
  atualizarPendentes();
  const n = [...pend.keys()].filter(x => x.startsWith(e.aba + '|')).length + [...bmPend.keys()].filter(x => x.startsWith(e.nome + '|')).length;
  const b = document.querySelector(`#segEmpresas button[data-emp="${CSS.escape(e.aba)}"]`);
  if (b) b.innerHTML = `${esc(e.nome)}${n ? ` <span class="contador">${n}</span>` : ''}`;
}

async function salvarLanc() {
  if ((!pend.size && !bmPend.size) || salvando) return;
  const bmAlt = [];
  for (const [k, v] of bmPend) {
    const [emp, cod, data] = k.split('|');
    const q = v === '' ? null : Number(v.replace(/\./g, '').replace(',', '.'));
    if (v !== '' && (isNaN(q) || q < 0)) { toast(`Quantidade inválida em "${cod}" (${fdA(data)}): use somente números.`, true); return; }
    bmAlt.push({ empresa: emp, codigo: cod, data, quantidade: q });
  }
  salvando = true; atualizarPendentes();
  const porAba = {};
  pend.forEach((v, k) => { const [aba, data, col] = k.split('|'); (porAba[aba] ||= []).push({ data, col, valor: v === '' ? null : v }); });
  try {
    let total = 0, baixas = [];
    for (const [aba, alteracoes] of Object.entries(porAba)) {
      const r = await postarBruto(API + 'producao', { aba, alteracoes });
      total += r.celulas;
      if (r.baixa_auto && r.baixa_auto.length) baixas.push(...r.baixa_auto);
      [...pend.keys()].filter(k => k.startsWith(aba + '|')).forEach(k => pend.delete(k));
    }
    if (bmAlt.length) {
      const r = await postarBruto(API + 'bm/apontar', { alteracoes: bmAlt });
      total += r.celulas ?? bmAlt.length;
      bmPend.clear();
    }
    salvando = false;
    await carregar();
    if (baixas.length) {
      const agrup = {};
      baixas.forEach(b => { agrup[b.codigo] = (agrup[b.codigo] || 0) + b.quantidade; });
      const linhas = Object.entries(agrup).map(([c, q]) => {
        const desc = baixas.find(b => b.codigo === c);
        return `${desc ? desc.material : c}: ${q % 1 ? q.toFixed(1) : q}`;
      }).join(', ');
      toast(`Salvo ${ONDE} (${total} célula(s)). Baixa automática: ${linhas}`, false, 6000);
    } else {
      toast(`Salvo ${ONDE} (${total} célula(s))`);
    }
  } catch (err) {
    salvando = false; atualizarPendentes();
    toast(err.message, true);
  }
}

// ------------------------------------------------------------ AVANÇO FÍSICO
function realizadoTotal(servico, ate) { return prodServico(servico, null, '0000', ate); }

function contratoLinhas(ate = ref) {
  const ini = add(ate, -14);
  let du = 0; for (let d = ini; d <= ate; d = add(d, 1)) if (diaUtil(d)) du++;
  return M.cliente.filter(c => c.qtd).map(c => {
    const real = realizadoTotal(c.servico, ate);
    const ritmo = (real - realizadoTotal(c.servico, add(ini, -1))) / Math.max(du, 1);
    const saldo = Math.max(c.qtd - real, 0);
    let projecao = null, status;
    if (saldo <= 0) status = 'CONCLUÍDO';
    else if (ritmo <= 0 && c.inicio_plan && c.inicio_plan > ate) {
      status = 'NÃO INICIADO';
      if (c.meta_dia) projecao = somarDiasUteis(add(c.inicio_plan, -1), Math.ceil(saldo / c.meta_dia));
    } else if (ritmo <= 0) status = 'SEM RITMO';
    else {
      projecao = somarDiasUteis(ate, Math.ceil(saldo / ritmo));
      status = c.prazo && projecao > c.prazo ? 'ATRASO' : 'NO PRAZO';
    }
    const necessario = c.prazo && saldo > 0 && c.prazo > ate ? saldo / Math.max(1, contarDiasUteis(ate, c.prazo)) : null;
    return { ...c, real, ritmo, saldo, projecao, status, necessario };
  });
}
const COR_STATUS = { 'CONCLUÍDO': 'verde', 'NO PRAZO': 'verde', 'ADIANTADO': 'verde', 'ATRASO': 'vermelho', 'ATRASADO': 'vermelho', 'SEM RITMO': 'amarelo', 'NÃO INICIADO': 'pendente', 'NO LIMITE': 'amarelo' };

function renderAvanco() {
  const linhas = contratoLinhas();
  $('#tabContrato').innerHTML = `<thead><tr><th>Serviço</th><th>Frente</th><th class="n">Contrato</th><th class="n">Realizado</th><th style="min-width:120px">Avanço</th><th class="n">Saldo</th><th class="n">Ritmo/dia</th><th class="n">Necessário/dia</th><th>Prazo</th><th>Projeção</th><th>Situação</th></tr></thead><tbody>` +
    (linhas.length ? linhas.map(c => {
      const pct = c.real / c.qtd * 100;
      return `<tr><td><b>${esc(cap(c.servico))}</b></td><td class="nota">${esc(c.frente || '')}</td><td class="n">${nf(c.qtd)}</td><td class="n">${nf(c.real, 1)}</td>
        <td><div class="barra" title="${nf(pct, 1)}%"><i style="width:${Math.min(pct, 100)}%"></i></div><span class="nota">${nf(pct, 1)}%</span></td>
        <td class="n">${nf(c.saldo, 1)}</td><td class="n">${nf(c.ritmo, 2)}</td><td class="n" style="color:${c.necessario && c.ritmo < c.necessario ? 'var(--vermelho)' : 'inherit'}">${nf(c.necessario, 2)}</td>
        <td>${fdA(c.prazo)}</td><td>${fdA(c.projecao)}</td><td><span class="farol f-${COR_STATUS[c.status]}">${c.status}</span></td></tr>`;
    }).join('') : '<tr><td colspan="11" class="vazio">Nenhuma quantidade contratada em METAS CLIENTE.</td></tr>') + '</tbody>';

  $('#avancoEmpresas').innerHTML = M.empresas.map(e => {
    const itens = e.servicos.map(sv => ({ sv, acum: soma(e, sv.col, '0000', ref) })).filter(x => x.sv.escopo || x.acum);
    return `<div><h2 style="margin-bottom:10px"><span class="emp-tag" style="--c:${corEmp(e.nome)}">${esc(e.nome)}</span></h2>
      <table><thead><tr><th>Serviço</th><th class="n">Escopo</th><th class="n">Acum.</th><th style="min-width:90px">%</th></tr></thead><tbody>` +
      (itens.length ? itens.map(({ sv, acum }) => {
        const p = sv.escopo ? acum / sv.escopo * 100 : null;
        return `<tr><td>${esc(cap(sv.nome))}</td><td class="n">${nf(sv.escopo)}</td><td class="n">${nf(acum, 1)}</td>
          <td>${p == null ? '<span class="nota">sem escopo</span>' : `<div class="barra"><i style="width:${Math.min(p, 100)}%;--c:${corEmp(e.nome)}"></i></div><span class="nota">${nf(p, 1)}%</span>`}</td></tr>`;
      }).join('') : '<tr><td colspan="4" class="vazio">Sem escopo ou produção.</td></tr>') + '</tbody></table></div>';
  }).join('');
}

// ------------------------------------------------------------ DASHBOARD CLIENTE
function prevCliente(c, ate) {
  if (!c.qtd || !c.inicio_plan || !c.meta_dia || ate < c.inicio_plan) return 0;
  return Math.min(c.qtd, c.meta_dia * contarDiasUteis(add(c.inicio_plan, -1), ate));
}
function itensCliente() { return M.cliente.filter(c => c.qtd); }
function avancoPonderado(ate, previsto) {
  const itens = itensCliente();
  const pesoTot = soma0(itens, c => c.peso);
  if (!pesoTot) return 0;
  return soma0(itens, c => c.peso * Math.min(1, (previsto ? prevCliente(c, ate) : realizadoTotal(c.servico, ate)) / c.qtd)) / pesoTot * 100;
}

function renderCliente() {
  const c = corte(), ini = per.ini, antes = add(ini, -1);
  const itens = itensCliente();
  const emps = M.empresas.map(e => e.nome);
  const proj = Object.fromEntries(contratoLinhas(c).map(x => [x.servico, x]));
  const linhas = itens.map(it => {
    const prevPer = prevCliente(it, c) - prevCliente(it, antes);
    const porEmp = Object.fromEntries(emps.map(n => [n, c >= ini ? prodServico(it.servico, n, ini, c) : 0]));
    const realPer = soma0(Object.values(porEmp), v => v);
    const prevAc = prevCliente(it, c), realAc = realizadoTotal(it.servico, c);
    const p = proj[it.servico] || {};
    const status = realAc >= it.qtd ? 'CONCLUÍDO' : prevAc === 0 && realAc === 0 ? 'NÃO INICIADO' : realAc >= prevAc ? 'ADIANTADO' : realAc >= prevAc * 0.95 ? 'NO LIMITE' : 'ATRASADO';
    return { it, prevPer, porEmp, realPer, prevAc, realAc, saldo: Math.max(it.qtd - realAc, 0), p, status };
  });

  const avPrev = avancoPonderado(c, true), avReal = avancoPonderado(c, false);
  const pesoTot = soma0(itens, x => x.peso) || 1;
  const perPrev = soma0(linhas, l => l.it.peso * l.prevPer / l.it.qtd) / pesoTot * 100;
  const perReal = soma0(linhas, l => l.it.peso * l.realPer / l.it.qtd) / pesoTot * 100;
  const prazoFinal = itens.map(x => x.prazo).filter(Boolean).sort().pop();
  const semRitmo = Object.values(proj).filter(x => x.status === 'SEM RITMO');
  const projFinal = semRitmo.length ? null : Object.values(proj).map(x => x.projecao).filter(Boolean).sort().pop();
  const atrasados = linhas.filter(l => l.status === 'ATRASADO');
  const gap = avReal - avPrev;
  const tile = (rot, val, sub, st, cc = 'var(--acento)') => `<div class="tile" style="--c:${cc}"><div class="rot"><span>${rot}</span>${st || ''}</div><div class="val">${val}</div><div class="sub">${sub}</div></div>`;
  $('#cliTiles').innerHTML =
    tile('Avanço físico realizado', nf(avReal, 1) + '%', `Previsto pelo cliente: ${nf(avPrev, 1)}% · desvio ${gap >= 0 ? '+' : ''}${nf(gap, 1)} p.p.`, `<span class="farol f-${gap >= 0 ? 'verde' : gap > -5 ? 'amarelo' : 'vermelho'}">${gap >= 0 ? 'ADIANTADO' : 'ATRASADO'}</span>`, 'var(--fg)') +
    tile('Avanço no período', nf(perReal, 1) + ' p.p.', `Previsto no período: ${nf(perPrev, 1)} p.p. (${fd(ini)} a ${fd(c)})`, farolHtml(perPrev > 0 ? perReal / perPrev * 100 : null, perPrev === 0)) +
    tile('Término projetado', projFinal ? fdA(projFinal) : 'Indefinido', projFinal ? `Prazo contratual: ${fdA(prazoFinal)}` : `Sem ritmo de produção: ${semRitmo.map(x => cap(x.servico)).join(', ')} · prazo ${fdA(prazoFinal)}`, projFinal && prazoFinal ? `<span class="farol f-${projFinal <= prazoFinal ? 'verde' : 'vermelho'}">${projFinal <= prazoFinal ? 'NO PRAZO' : 'ATRASO'}</span>` : '') +
    tile('Serviços atrasados', String(atrasados.length), `de ${itens.length} serviços com quantidade contratada`, '', atrasados.length ? 'var(--vermelho)' : 'var(--verde)');

  $('#cliNota').textContent = `Período ${fdA(ini)} a ${fdA(c)} · previsto = meta do cliente/dia × dias úteis desde o início planejado`;
  let h = `<thead><tr><th>Serviço</th><th class="n">Contrato</th><th>Início cliente</th><th class="n">Meta cliente/dia</th><th class="n">Previsto período</th>${emps.map(n => `<th class="n">${esc(n)}</th>`).join('')}<th class="n">Realizado período</th><th class="n">GAP período</th><th class="n">% ating.</th><th class="n">Previsto acum.</th><th class="n">Realizado acum.</th><th class="n">Saldo</th><th>Término projetado</th><th>Prazo</th><th>Situação</th></tr></thead><tbody>`;
  linhas.forEach(l => {
    const gp = l.realPer - l.prevPer;
    h += `<tr><td><b>${esc(cap(l.it.servico))}</b></td><td class="n">${nf(l.it.qtd)}</td><td>${fdA(l.it.inicio_plan)}</td><td class="n">${nf(l.it.meta_dia, 2)}</td><td class="n">${nf(l.prevPer, 1)}</td>
      ${emps.map(n => `<td class="n">${l.porEmp[n] ? nf(l.porEmp[n], 1) : '—'}</td>`).join('')}
      <td class="n"><b>${nf(l.realPer, 1)}</b></td><td class="n ${gp < 0 ? 'valor-neg' : ''}">${(gp > 0 ? '+' : '') + nf(gp, 1)}</td>
      <td class="n">${l.prevPer > 0 ? nf(l.realPer / l.prevPer * 100) + '%' : '—'}</td><td class="n">${nf(l.prevAc, 1)}</td><td class="n">${nf(l.realAc, 1)}</td><td class="n">${nf(l.saldo, 1)}</td>
      <td>${fdA(l.p.projecao)}</td><td>${fdA(l.it.prazo)}</td><td><span class="farol f-${COR_STATUS[l.status]}">${l.status}</span></td></tr>`;
  });
  $('#tabCliente').innerHTML = h + '</tbody>';

  const frentes = {};
  linhas.forEach(l => {
    const f = frentes[l.it.frente || 'SEM FRENTE'] ||= { peso: 0, prev: 0, real: 0, prevPer: 0, realPer: 0 };
    f.peso += l.it.peso;
    f.prev += l.it.peso * Math.min(1, l.prevAc / l.it.qtd); f.real += l.it.peso * Math.min(1, l.realAc / l.it.qtd);
    f.prevPer += l.it.peso * l.prevPer / l.it.qtd; f.realPer += l.it.peso * l.realPer / l.it.qtd;
  });
  $('#tabFrentes').innerHTML = `<thead><tr><th>Frente</th><th class="n">% previsto período</th><th class="n">% realizado período</th><th class="n">% previsto acum.</th><th class="n">% realizado acum.</th><th style="min-width:140px">Realizado acum.</th><th class="n">GAP (p.p.)</th></tr></thead><tbody>` +
    Object.entries(frentes).map(([n, f]) => {
      const pa = f.prev / f.peso * 100, ra = f.real / f.peso * 100;
      return `<tr><td><b>${esc(n)}</b></td><td class="n">${nf(f.prevPer / f.peso * 100, 1)}%</td><td class="n">${nf(f.realPer / f.peso * 100, 1)}%</td><td class="n">${nf(pa, 1)}%</td><td class="n">${nf(ra, 1)}%</td>
        <td><div class="barra"><i style="width:${Math.min(ra, 100)}%"></i></div></td><td class="n ${ra - pa < 0 ? 'valor-neg' : ''}">${(ra - pa > 0 ? '+' : '') + nf(ra - pa, 1)}</td></tr>`;
    }).join('') + '</tbody>';

  // insights
  const ins = [];
  ins.push([gap >= 0 ? 'verde' : 'vermelho', `Avanço físico ponderado de <b>${nf(avReal, 1)}%</b> contra <b>${nf(avPrev, 1)}%</b> previstos pelo cliente em ${fdA(c)} (${gap >= 0 ? '+' : ''}${nf(gap, 1)} p.p.).`]);
  if (semRitmo.length) ins.push(['vermelho', `Término do contrato indefinido: ${semRitmo.map(x => '<b>' + esc(cap(x.servico)) + '</b>').join(', ')} sem produção nas últimas duas semanas.`]);
  if (projFinal && prazoFinal) ins.push([projFinal <= prazoFinal ? 'verde' : 'vermelho', `No ritmo das últimas duas semanas, o escopo contratado termina em <b>${fdA(projFinal)}</b>; o prazo é <b>${fdA(prazoFinal)}</b>.`]);
  atrasados.forEach(l => ins.push(['vermelho', `<b>${esc(cap(l.it.servico))}</b>: ${nf(l.realAc, 1)} de ${nf(l.prevAc, 1)} previstos (faltam ${nf(l.prevAc - l.realAc, 1)} para alcançar o cliente).${l.p.necessario ? ` Para cumprir o prazo são necessários ${nf(l.p.necessario, 2)}/dia; ritmo atual ${nf(l.p.ritmo, 2)}/dia.` : ''}`]));
  linhas.filter(l => l.status === 'NO LIMITE').forEach(l => ins.push(['amarelo', `<b>${esc(cap(l.it.servico))}</b> no limite do previsto (${nf(l.realAc, 1)} × ${nf(l.prevAc, 1)}).`]));
  linhas.filter(l => l.status === 'ADIANTADO' && l.realAc > 0).forEach(l => ins.push(['verde', `<b>${esc(cap(l.it.servico))}</b> à frente do previsto do cliente (${nf(l.realAc, 1)} × ${nf(l.prevAc, 1)}).`]));
  const abertos = M.impactos.filter(i => !i.solucionado);
  if (abertos.length) ins.push(['amarelo', `<b>${abertos.length} impacto(s) em aberto</b> afetando a produção: ${[...new Set(abertos.map(i => cap(i.motivo).trim()))].slice(0, 4).map(esc).join('; ')}.`]);
  alertasEstoqueExterno().filter(x => x[0] === 'vermelho').forEach(x => ins.push(['vermelho', x[1].replace(/<button[^>]*>.*?<\/button>/g, '')]));
  const falta = estoqueLinhas().filter(l => l.nivel === 'vermelho');
  if (falta.length) ins.push(['vermelho', `Material insuficiente para a semana: ${falta.map(l => esc(l.material)).join(', ')}.`]);
  $('#cliInsights').innerHTML = ins.map(([n, t]) => `<li><span class="farol f-${n}">${n === 'verde' ? 'OK' : n === 'amarelo' ? 'ATENÇÃO' : 'CRÍTICO'}</span><span>${t}</span></li>`).join('');
  $('#cliResumo').hidden = true;
  $('#cliResumo').value = ['OBRA 198 — Posição em ' + fdA(c), ...ins.map(([, t]) => '• ' + t.replace(/<[^>]+>/g, '')),
    '', 'Por serviço (realizado acumulado / previsto cliente / contrato):',
    ...linhas.map(l => `• ${cap(l.it.servico)}: ${nf(l.realAc, 1)} / ${nf(l.prevAc, 1)} / ${nf(l.it.qtd)} — ${l.status}`)].join('\n');

  graficoCurvaS(c);
}

function graficoCurvaS(c) {
  const itens = itensCliente();
  if (!itens.length) return;
  const inicio = segunda(itens.map(x => x.inicio_plan).filter(Boolean).sort()[0] || M.datas[0]);
  const fimPlan = maxD(itens.map(x => x.prazo).filter(Boolean).sort().pop() || c, c);
  const semanas = [];
  for (let d = add(inicio, 6); d <= add(fimPlan, 6); d = add(d, 7)) semanas.push(d);
  trocarGrafico('gCurvaS', {
    type: 'line',
    data: {
      labels: semanas.map(fd),
      datasets: [
        { label: 'Previsto cliente', data: semanas.map(d => +avancoPonderado(d, true).toFixed(1)), borderColor: cor('--prev'), backgroundColor: cor('--prev'), borderDash: [5, 4], borderWidth: 2, pointRadius: 0, tension: .2 },
        { label: 'Realizado', data: semanas.map(d => add(d, -6) <= c ? +avancoPonderado(minD(d, c), false).toFixed(1) : null), borderColor: cor('--acento'), backgroundColor: cor('--acento'), borderWidth: 2, pointRadius: 3, tension: .2 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: x => `${x.dataset.label}: ${x.raw == null ? '—' : nf(x.raw, 1) + '%'}` } } },
      scales: eixos({ max: 100, ticks: { color: cor('--fg2'), callback: v => v + '%' } }, { ticks: { color: cor('--fg2'), maxTicksLimit: 12 } }),
    },
  });
}

async function copiarResumo() {
  const t = $('#cliResumo');
  try { await navigator.clipboard.writeText(t.value); toast('Resumo copiado. Cole no e-mail ou WhatsApp.'); }
  catch { t.hidden = false; t.focus(); t.select(); toast('Selecionei o resumo: copie com Ctrl+C.'); }
}

// ------------------------------------------------------------ ESTOQUE
function metaServicoSemana(servico, emp, seg) {
  return soma0(M.metas.filter(m => m.inicio === seg && m.servico === servico && (!emp || m.empresa === emp)), metaSemanaTotal);
}

function estoqueLinhas() {
  if (!T || !M) return [];
  const seg = segunda(ref), prox = add(seg, 7);
  const ini15 = add(ref, -14), du15 = Math.max(1, contarDiasUteis(add(ini15, -1), ref));
  return T.materiais.map(mt => {
    const emp = mt.empresa ? normEmp(mt.empresa) : null;
    const base = mt.data_saldo || '0000-01-01';
    const movs = T.movimentos.filter(v => v.codigo === mt.codigo && (!v.data || (v.data >= base && v.data <= ref)));
    const q = tipo => soma0(movs.filter(v => v.tipo === tipo), v => v.quantidade);
    const coef = mt.coef || 0;
    const vinculado = coef > 0 && !!mt.servico;
    const consumo = vinculado ? coef * prodServico(mt.servico, emp, base, ref) : 0;
    const saldo = (mt.saldo_inicial || 0) + q('ENTRADA') - q('SAÍDA') + q('AJUSTE') - consumo;
    const metaSem = vinculado ? metaServicoSemana(mt.servico, emp, seg) : 0;
    const realSem = vinculado ? prodServico(mt.servico, emp, seg, ref) : 0;
    const necSemana = Math.max(metaSem - realSem, 0) * coef;
    const necProx = vinculado ? metaServicoSemana(mt.servico, emp, prox) * coef : 0;
    const consumoDia = vinculado ? prodServico(mt.servico, emp, ini15, ref) / du15 * coef : 0;
    const cobertura = consumoDia > 0 ? saldo / consumoDia : null;
    let status, nivel;
    if (vinculado && saldo < necSemana) [status, nivel] = ['FALTA NA SEMANA', 'vermelho'];
    else if (vinculado && saldo < necSemana + necProx) [status, nivel] = ['REPOR PARA A PRÓXIMA SEMANA', 'amarelo'];
    else if (mt.minimo && saldo < mt.minimo) [status, nivel] = ['ABAIXO DO MÍNIMO', 'amarelo'];
    else if (mt.prazo_reposicao && cobertura != null && cobertura < mt.prazo_reposicao) [status, nivel] = ['PEDIR AGORA (PRAZO DE REPOSIÇÃO)', 'amarelo'];
    else if (!vinculado) [status, nivel] = ['SEM VÍNCULO COM SERVIÇO', 'pendente'];
    else [status, nivel] = ['OK', 'verde'];
    const comprar = Math.max(0, necSemana + necProx + (mt.minimo || 0) - saldo);
    return { ...mt, emp, consumo, saldo, metaSem, necSemana, necProx, consumoDia, cobertura, status, nivel, comprar, entradas: q('ENTRADA') };
  });
}

function renderEstoque() {
  renderEstoquePlanilha();
  renderEstoqueExterno();
  renderEstoqueIfc();
  const ls = estoqueLinhas();
  const cont = n => ls.filter(l => l.nivel === n).length;
  const tile = (rot, val, sub, cc) => `<div class="tile" style="--c:${cc}"><div class="rot"><span>${rot}</span></div><div class="val">${val}</div><div class="sub">${sub}</div></div>`;
  $('#estTiles').innerHTML = tile('Materiais cadastrados', ls.length, 'aba ESTOQUE MATERIAIS', 'var(--fg)') +
    tile('Falta na semana', cont('vermelho'), 'saldo menor que o necessário para a meta', 'var(--vermelho)') +
    tile('Repor / atenção', cont('amarelo'), 'não cobre a próxima semana ou abaixo do mínimo', 'var(--amarelo)') +
    tile('Abastecidos', cont('verde'), 'cobrem esta semana e a próxima', 'var(--verde)');
  $('#estNota').textContent = `Semana ${fdA(segunda(ref))} a ${fdA(add(segunda(ref), 6))} · saldo apurado até ${fdA(ref)}`;
  $('#tabEstoque').innerHTML = `<thead><tr><th>Material</th><th>Serviço vinculado</th><th class="n">Consumo/un.</th><th class="n">Saldo atual</th><th class="n">Necessário resto da semana</th><th class="n">Necessário próx. semana</th><th class="n">Consumo/dia (ritmo)</th><th class="n">Cobertura</th><th class="n">Comprar</th><th>Situação</th><th></th></tr></thead><tbody>` +
    (ls.length ? ls.sort((a, b) => ['vermelho', 'amarelo', 'pendente', 'verde'].indexOf(a.nivel) - ['vermelho', 'amarelo', 'pendente', 'verde'].indexOf(b.nivel)).map(l => `<tr>
      <td><b>${esc(l.material)}</b><br><span class="nota">${esc(l.codigo)} · ${esc(l.unidade || '')}${l.fornecedor ? ' · ' + esc(l.fornecedor) : ''}</span></td>
      <td>${esc(cap(l.servico || '—'))}<br><span class="nota">${esc(l.emp || 'todas as empresas')}</span></td>
      <td class="n">${nf(l.coef, 3)}</td><td class="n ${l.saldo < 0 ? 'valor-neg' : ''}"><b>${nf(l.saldo, 1)}</b></td>
      <td class="n">${nf(l.necSemana, 1)}</td><td class="n">${nf(l.necProx, 1)}</td><td class="n">${nf(l.consumoDia, 2)}</td>
      <td class="n">${l.cobertura == null ? '—' : nf(Math.max(l.cobertura, 0), 1) + ' d.u.'}</td><td class="n">${l.comprar > 0 ? '<b>' + nf(l.comprar, 1) + '</b>' : '—'}</td>
      <td><span class="farol f-${l.nivel}">${l.status}</span></td>
      <td class="acoes-linha"><button class="link" data-mov="${esc(l.codigo)}">Movimentar</button> · <button class="link" data-editar-reg="materiais" data-linha="${l.linha}">Editar</button></td></tr>`).join('')
      : '<tr><td colspan="11" class="vazio">Nenhum material cadastrado. Use "+ Material" para começar (ex.: parafusos por joist, telha por m² de cobertura).</td></tr>') + '</tbody>';

  const nomes = Object.fromEntries(T.materiais.map(m => [m.codigo, m.material]));
  const movs = [...T.movimentos].sort((a, b) => String(b.data).localeCompare(String(a.data))).slice(0, 40);
  $('#tabMov').innerHTML = `<thead><tr><th>Data</th><th>Material</th><th>Tipo</th><th class="n">Quantidade</th><th>Documento</th><th>Empresa</th><th>Observação</th><th></th></tr></thead><tbody>` +
    (movs.length ? movs.map(v => `<tr><td>${fdA(v.data)}</td><td>${esc(nomes[v.codigo] || v.codigo)}</td><td><span class="farol f-${v.tipo === 'ENTRADA' ? 'verde' : v.tipo === 'SAÍDA' ? 'vermelho' : 'pendente'}">${esc(v.tipo)}</span></td>
      <td class="n">${nf(v.quantidade, 2)}</td><td>${esc(v.documento)}</td><td>${esc(v.empresa)}</td><td>${esc(v.obs)}</td>
      <td><button class="link" data-editar-reg="movimentos" data-linha="${v.linha}">Editar</button></td></tr>`).join('')
      : '<tr><td colspan="8" class="vazio">Nenhuma movimentação registrada.</td></tr>') + '</tbody>';
}


// ---------------------------------------- BAIXA POR IFC (regras × eventos) ----
function renderEstoqueIfc() {
  const box = M && M.estoque_ifc;
  const nota = $('#estIfcNota'), tiles = $('#estIfcTiles'), resumo = $('#estIfcResumo');
  const tabMat = $('#tabEstIfc'), tabRuas = $('#tabEstIfcRuas'), tabEv = $('#tabEstEventos'), al = $('#estIfcAlertas');
  if (!box || !box.inventario || !box.regras) {
    nota.textContent = 'IFC ou regras de baixa não encontrados. Gere dados/ifc_r0d_inventario.json (ferramentas/ifc_inventario.py) e programa_obra198/regras_baixa.json.';
    tiles.innerHTML = ''; resumo.textContent = ''; tabMat.innerHTML = ''; tabRuas.innerHTML = ''; tabEv.innerHTML = ''; al.innerHTML = '';
    return;
  }
  const inv = box.inventario, reg = box.regras, r = box.resumo || { materiais: [], por_rua_faixa: [], alertas: [] };
  const jp = inv.joists_projetadas || {};
  const t = (rot, val, sub, cc) => `<div class="tile" style="--c:${cc}"><div class="rot"><span>${esc(rot)}</span></div><div class="val">${val}</div><div class="sub">${esc(sub)}</div></div>`;
  const totApont = r.por_rua_faixa.reduce((a, x) => a + x.apontado, 0);
  const totProj = jp.total || 0;
  const perdaPos = r.materiais.filter(m => m.perda != null && m.perda < 0).length;
  const acuMed = (() => {
    const xs = r.materiais.map(m => m.acuracidade).filter(v => v != null);
    return xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length) * 100 : null;
  })();
  tiles.innerHTML =
    t('Joists apontadas', totApont, `de ${totProj} projetadas no IFC · ${totProj ? Math.round(100 * totApont / totProj) : 0}%`, 'var(--fg)') +
    t('Alertas', r.alertas.length, r.alertas.length ? 'ver abaixo' : 'nada crítico', r.alertas.length ? 'var(--vermelho)' : 'var(--verde)') +
    t('Perda apurada', perdaPos, 'materiais com físico < saldo teórico', perdaPos ? 'var(--amarelo)' : 'var(--fg)') +
    t('Acurácia média', acuMed == null ? '—' : nf(acuMed, 1) + '%', 'inventário × teórico', 'var(--fg)');
  nota.textContent = `Fonte: ${inv.fonte} · ${inv.totais.conjuntos} conjuntos, ${jp.total} joists projetadas.`;
  resumo.textContent = `Malha: ${inv.malha.eixos.length} eixos (${inv.malha.eixos[0]}..${inv.malha.eixos.at(-1)}) · ${inv.malha.ruas.length} ruas · 7 faixas (AB–GH). Regras: ${reg.eventos.length} eventos, ${Object.keys(reg.criterio_por_letra).length} letras.`;

  // materiais
  const codDesc = {}; (reg.eventos || []).forEach(e => (e.baixa || []).concat(e.baixa_por_joist || []).forEach(b => { if (b.codigo && b.descricao) codDesc[b.codigo] = b.descricao; }));
  Object.values(reg.criterio_por_letra || {}).forEach(c => { if (c.parafuso && c.descricao_parafuso) codDesc[c.parafuso] = c.descricao_parafuso; });
  const mats = [...r.materiais].sort((a, b) => (b.consumo_teorico || 0) - (a.consumo_teorico || 0));
  tabMat.innerHTML = `<thead><tr><th>Código</th><th>Descrição</th><th class="n">QTD Consumida</th><th class="n">QTD Chegou</th><th class="n">Estoque Virtual</th><th class="n">Físico</th><th class="n">Perda</th><th class="n">Acurácia</th><th class="n">Cobertura</th></tr></thead><tbody>` +
    (mats.length ? mats.map(m => {
      const perdaCls = m.perda == null ? '' : m.perda < 0 ? 'valor-neg' : '';
      const acu = m.acuracidade == null ? '—' : nf(m.acuracidade * 100, 1) + '%';
      const cob = m.cobertura_dias == null ? '—' : m.cobertura_dias < 0 ? '<span class="farol f-vermelho">Vencido</span>' : `${nf(m.cobertura_dias, 1)} d`;
      const saldoCls = m.saldo_teorico < 0 ? 'valor-neg' : '';
      return `<tr><td><b>${esc(m.codigo)}</b></td><td>${esc(codDesc[m.codigo] || '—')}</td>
        <td class="n">${nf(m.consumo_teorico, 0)}</td><td class="n">${nf(m.chegou, 0)}</td>
        <td class="n ${saldoCls}"><b>${nf(m.saldo_teorico, 0)}</b></td>
        <td class="n">${m.fisico == null ? '—' : nf(m.fisico, 0)}</td>
        <td class="n ${perdaCls}">${m.perda == null ? '—' : nf(m.perda, 0)}</td>
        <td class="n">${acu}</td><td class="n">${cob}</td></tr>`;
    }).join('') : '<tr><td colspan="9" class="vazio">Sem consumo ainda. Lance um evento de produção para começar.</td></tr>') + '</tbody>';

  // ruas × faixas — pivot: linha = rua, colunas = faixas
  const faixas = inv.malha.faixas || ['AB', 'BC', 'CD', 'DE', 'EF', 'FG', 'GH'];
  const ruas = inv.malha.ruas || [];
  const proj = jp.por_rua_faixa || {};
  const apontMap = {}; r.por_rua_faixa.forEach(x => { (apontMap[x.rua] ||= {})[x.faixa] = x.apontado; });
  tabRuas.innerHTML = `<thead><tr><th>Rua</th>${faixas.map(f => `<th class="n">${f}</th>`).join('')}<th class="n">Total</th></tr></thead><tbody>` +
    ruas.map(ru => {
      let tot = 0, tds = faixas.map(f => {
        const p = (proj[ru] || {})[f] || 0, ap = (apontMap[ru] || {})[f] || 0;
        tot += ap;
        const cls = ap > p ? 'valor-neg' : ap === p ? 'valor-ok' : '';
        return `<td class="n ${cls}">${ap}/${p}</td>`;
      }).join('');
      return `<tr><td><b>${ru}</b></td>${tds}<td class="n">${tot}</td></tr>`;
    }).join('') + '</tbody>';

  // últimos eventos
  const evs = [...(T.estoque_eventos || [])].sort((a, b) => String(b.data || '').localeCompare(String(a.data || ''))).slice(0, 20);
  tabEv.innerHTML = `<thead><tr><th>Data</th><th>Tipo</th><th>Rua/Eixo</th><th>Letra/Faixa</th><th class="n">Joists</th><th>Empresa</th><th></th></tr></thead><tbody>` +
    (evs.length ? evs.map(e => `<tr><td>${fdA(e.data)}</td><td>${esc(e.tipo || '')}</td>
      <td>${esc(e.rua || e.eixo || '')}</td><td>${esc(e.letra || e.faixa || '')}</td>
      <td class="n">${e.n_joists == null ? '—' : nf(e.n_joists, 0)}</td><td>${esc(e.empresa || '')}</td>
      <td><button class="link" data-editar-reg="estoque_eventos" data-linha="${e.linha}">Editar</button></td></tr>`).join('')
      : '<tr><td colspan="7" class="vazio">Nenhum evento apontado.</td></tr>') + '</tbody>';

  al.innerHTML = r.alertas.length ? r.alertas.map(a => `<li class="alerta a-vermelho">${esc(a.mensagem)}</li>`).join('') : '';
}

// ------------------------------------------------------------ PLANILHA DE ESTOQUE (externa, somente leitura)
function estoqueExternoResumo() {
  const E = M && M.estoque_externo;
  if (!E) return null;
  const seg = segunda(ref), prox = add(seg, 7);
  const etapas = ['PREMONTAGEM', 'IÇAMENTO JOIST'].map(serv => {
    const metaSem = metaServicoSemana(serv, null, seg), realSem = prodServico(serv, null, seg, ref);
    const rest = Math.max(metaSem - realSem, 0), proxMeta = metaServicoSemana(serv, null, prox);
    const cap = (E.capacidade || {})[serv] || {};
    const j = cap.joists;
    const nivel = j == null ? 'pendente' : j >= rest + proxMeta ? 'verde' : j >= rest ? 'amarelo' : 'vermelho';
    return { serv, metaSem, realSem, rest, proxMeta, cap, nivel };
  });
  const itens = (E.itens || []).filter(i => i.coef > 0).map(i => {
    const et = etapas.find(e => e.serv === i.etapa) || etapas[0];
    const necSem = et.rest * i.coef, necProx = et.proxMeta * i.coef, disp = i.disponivel || 0;
    const nivel = disp < necSem ? 'vermelho' : disp < necSem + necProx ? 'amarelo' : 'verde';
    return { ...i, necSem, necProx, cobertura: disp / i.coef, nivel };
  }).sort((a, b) => a.cobertura - b.cobertura);
  const ordem = ['verde', 'amarelo', 'vermelho'];
  etapas.forEach(e => {
    e.itensFalta = itens.filter(i => i.etapa === e.serv && i.nivel === 'vermelho');
    const pior = itens.filter(i => i.etapa === e.serv).reduce((a, i) => Math.max(a, ordem.indexOf(i.nivel)), 0);
    if (e.nivel !== 'pendente' && pior > ordem.indexOf(e.nivel)) e.nivel = ordem[pior];
  });
  const fixCrit = (E.fixadores || []).filter(f => /CR[IÍ]TICO|FALTA/i.test(f.status || '') || (f.saldo != null && f.saldo < 0));
  const aguardando = soma0(E.mix_joists || [], m => m.aguardando_icamento);
  return { E, etapas, itens, fixCrit, aguardando };
}

function alertasEstoqueExterno() {
  const r = estoqueExternoResumo();
  if (!r) return [];
  const al = [];
  r.etapas.forEach(e => {
    const lim = e.cap.limitante ? ` (limitante: ${esc(e.cap.limitante)}${e.cap.descricao ? ' – ' + esc(e.cap.descricao) : ''})` : '';
    const semSaldo = e.itensFalta.length ? ` Itens sem saldo para a semana: ${e.itensFalta.map(i => esc(i.tag)).join(', ')}.` : '';
    if (e.nivel === 'vermelho') al.push(['vermelho', `<b>Material para ${esc(cap(e.serv))}</b>: a planilha de estoque indica capacidade de ${nf(e.cap.joists)} joists; a meta restante da semana é ${nf(e.rest)}${lim}.${semSaldo} <button class="link" data-ir-aba="estoque">Ver estoque</button>`]);
    else if (e.nivel === 'amarelo') al.push(['amarelo', `<b>Material para ${esc(cap(e.serv))}</b>: cobre a semana, mas não a próxima (${nf(e.cap.joists)} joists × ${nf(e.rest + e.proxMeta)} necessárias)${lim}.`]);
  });
  if (r.fixCrit.length) al.push(['vermelho', `<b>Fixadores em falta</b>: ${r.fixCrit.map(f => `${esc(f.codigo)} (${esc(f.descricao || '')}, saldo ${nf(f.saldo)})`).join('; ')}.`]);
  return al;
}

function renderEstoqueExterno() {
  const box = $('#estExterno');
  const r = estoqueExternoResumo();
  if (!r) { box.innerHTML = ''; return; }
  const { E, etapas, itens, fixCrit, aguardando } = r;
  const tile = (rot, val, sub, st, cc) => `<div class="tile" style="--c:${cc}"><div class="rot"><span>${rot}</span>${st || ''}</div><div class="val">${val}</div><div class="sub">${sub}</div></div>`;
  const rot = { verde: 'COBRE 2 SEMANAS', amarelo: 'SÓ ESTA SEMANA', vermelho: 'FALTA NA SEMANA', pendente: 'SEM DADO' };
  let h = `<div class="bloco-cab"><h2>Planilha de estoque · ${esc(E.arquivo)}</h2><span class="nota">Valores calculados pela própria planilha (gravada em ${new Date(E.modificado).toLocaleString('pt-BR')}) · somente leitura</span></div>`;
  h += '<div class="tiles">' + etapas.map(e => tile(`Material para ${esc(cap(e.serv))}`, `${nf(e.cap.joists)} joists`,
      `Meta restante da semana ${nf(e.rest)} · próxima semana ${nf(e.proxMeta)}${e.cap.limitante ? ` · limitante ${esc(e.cap.limitante)}` : ''}${e.itensFalta.length ? ` · <b>sem saldo para a semana: ${e.itensFalta.map(i => esc(i.tag)).join(', ')}</b>` : ''}`,
      `<span class="farol f-${e.nivel}">${rot[e.nivel]}</span>`, `var(--${e.nivel === 'pendente' ? 'fg3' : e.nivel})`)).join('') +
    tile('Premontadas aguardando içamento', `${nf(aguardando)} joists`, 'Apontamento_Montagem · pendente montar', '', 'var(--acento)') +
    tile('Fixadores em falta', String(fixCrit.length), fixCrit.length ? fixCrit.map(f => esc(f.codigo)).join(', ') : 'nenhum item crítico', '', fixCrit.length ? 'var(--vermelho)' : 'var(--verde)') + '</div>';
  h += `<div class="bloco"><div class="bloco-cab"><h2>Componentes por joist × meta</h2><span class="nota">Consumo por joist ponderado pelo mix de joists pendentes, com perda.</span></div><div class="tabela-rolagem"><table id="tabEstExt">
    <thead><tr><th>TAG</th><th>Produto</th><th>Etapa</th><th class="n">Disponível</th><th class="n">Consumo por joist</th><th class="n">Necessário resto da semana</th><th class="n">Necessário próx. semana</th><th class="n">Cobertura (joists)</th><th>Situação</th><th>Status na planilha</th><th class="n">Solicitar</th></tr></thead><tbody>` +
    itens.map(i => `<tr><td><b>${esc(i.tag)}</b></td><td>${esc(cap(i.produto || ''))}<br><span class="nota">${esc(i.material || '')}</span></td><td>${esc(cap(i.etapa))}</td>
      <td class="n"><b>${nf(i.disponivel)}</b></td><td class="n">${nf(i.coef, 2)}</td><td class="n">${nf(i.necSem, 0)}</td><td class="n">${nf(i.necProx, 0)}</td>
      <td class="n ${i.cobertura < 1 ? 'valor-neg' : ''}">${nf(Math.floor(i.cobertura))}</td><td><span class="farol f-${i.nivel}">${rot[i.nivel]}</span></td>
      <td class="sub">${esc(i.status || '—')}</td><td class="n">${i.solicitar > 0 ? nf(i.solicitar) : '—'}</td></tr>`).join('') + '</tbody></table></div></div>';
  if ((E.fixadores || []).length) {
    h += `<div class="bloco"><div class="bloco-cab"><h2>Fixadores de montagem (quadrantes)</h2></div><div class="tabela-rolagem"><table><thead><tr><th>Código</th><th>Descrição</th><th>Aplicação</th><th class="n">Consumo previsto</th><th class="n">Disponível</th><th class="n">Saldo</th><th>Status</th><th>Regra</th></tr></thead><tbody>` +
      E.fixadores.map(f => { const crit = fixCrit.includes(f); return `<tr><td><b>${esc(f.codigo)}</b></td><td>${esc(f.descricao)}</td><td class="sub">${esc(f.escopo)}</td><td class="n">${nf(f.consumo_total)}</td><td class="n">${nf(f.disponivel)}</td>
        <td class="n ${f.saldo < 0 ? 'valor-neg' : ''}">${nf(f.saldo)}</td><td><span class="farol f-${crit ? 'vermelho' : 'verde'}">${esc(f.status || (crit ? 'FALTA' : 'OK'))}</span></td><td class="sub">${esc(f.regra || '')}</td></tr>`; }).join('') + '</tbody></table></div></div>';
  }
  const inv = (E.inventario || []).filter(i => i.acuracidade != null);
  if (inv.length) {
    const media = soma0(inv, i => i.acuracidade) / inv.length * 100;
    const piores = [...inv].sort((a, b) => a.acuracidade - b.acuracidade).slice(0, 6);
    h += `<div class="bloco"><div class="bloco-cab"><h2>Inventário físico × virtual</h2><span class="nota">Acuracidade média ${nf(media, 1)}% em ${inv.length} itens contados · maiores divergências abaixo</span></div><div class="tabela-rolagem"><table><thead><tr><th>TAG</th><th>Produto</th><th class="n">Estoque virtual</th><th class="n">Estoque físico</th><th class="n">Perda real</th><th class="n">Acuracidade</th></tr></thead><tbody>` +
      piores.map(i => `<tr><td><b>${esc(i.tag)}</b></td><td>${esc(i.produto)}</td><td class="n">${nf(i.virtual)}</td><td class="n">${nf(i.fisico)}</td><td class="n">${nf(i.perda)}</td>
        <td class="n ${i.acuracidade < 0.8 ? 'valor-neg' : ''}">${nf(i.acuracidade * 100, 1)}%</td></tr>`).join('') + '</tbody></table></div></div>';
  }
  box.innerHTML = h;
}

// ------------------------------------------------------------ ESTOQUE PLANILHA (4 abas importadas)
function renderEstoquePlanilha() {
  if (!EP) return;
  renderEstMateriais();
  renderEstRemessas();
  renderEstConsumo();
  renderEstInventario();
  renderEstCriticos();
}

function _filtroMat() { return ($('#estMatFiltro')?.value || '').toUpperCase(); }
function _filtroMatEtapa() { return ($('#estMatEtapa')?.value || ''); }
function _filtroMatStatus() { return ($('#estMatStatus')?.value || ''); }

function renderEstMateriais() {
  if (!EP || !M) return;
  const regras = regrasBaixa(renderEstMateriais);
  const cvMapa = regras ? consumoVirtualPorTag(regras) : new Map();
  const consumidoDe = m => cvMapa.has(m.tag) ? cvMapa.get(m.tag).cv : m.consumido;
  const posBaixaDe = m => cvMapa.has(m.tag) ? m.chegou - cvMapa.get(m.tag).cv : m.estoque_pos_baixa;
  const itens = EP.materiais;
  const f = _filtroMat(), fe = _filtroMatEtapa(), fs = _filtroMatStatus();
  const vis = itens.filter(m => {
    if (f && !m.tag.toUpperCase().includes(f) && !(m.produto || '').toUpperCase().includes(f) && !(m.etapa || '').toUpperCase().includes(f)) return false;
    if (fe && m.etapa !== fe) return false;
    if (fs && m.status_logistico !== fs) return false;
    return true;
  });
  const tile = (rot, val, sub, cc) => `<div class="tile" style="--c:${cc}"><div class="rot"><span>${rot}</span></div><div class="val">${val}</div><div class="sub">${sub}</div></div>`;
  const totPlan = soma0(itens, m => m.planejado);
  const totCheg = soma0(itens, m => m.chegou);
  const atend = totPlan ? Math.round(100 * totCheg / totPlan) : 0;
  const criticos = itens.filter(m => m.status_logistico === 'Crítico').length;
  const parciais = itens.filter(m => m.status_logistico === 'Recebimento Parcial').length;
  $('#estMatTiles').innerHTML =
    tile('Itens', itens.length, `${vis.length} visíveis no filtro`, 'var(--fg)') +
    tile('Atendimento geral', atend + '%', `${nf(totCheg)} de ${nf(totPlan)} planejados`, 'var(--acento)') +
    tile('Críticos', criticos, 'nenhuma peça chegou', 'var(--vermelho)') +
    tile('Recebimento parcial', parciais, 'falta enviar', 'var(--amarelo)');

  const etapas = [...new Set(itens.map(m => m.etapa).filter(Boolean))].sort();
  const selE = $('#estMatEtapa');
  if (selE && selE.options.length <= 1) etapas.forEach(e => { const o = document.createElement('option'); o.value = e; o.textContent = e; selE.appendChild(o); });
  const statuses = [...new Set(itens.map(m => m.status_logistico).filter(Boolean))].sort();
  const selS = $('#estMatStatus');
  if (selS && selS.options.length <= 1) statuses.forEach(s => { const o = document.createElement('option'); o.value = s; o.textContent = s; selS.appendChild(o); });

  const farolSt = s => {
    if (s === 'Atendido' || s === 'Excedente') return 'verde';
    if (s === 'Recebimento Parcial') return 'amarelo';
    if (s === 'Crítico') return 'vermelho';
    return 'pendente';
  };
  $('#tabEstMat').innerHTML = `<thead><tr><th>TAG</th><th>Material</th><th>Produto</th><th>Etapa</th><th class="n">Planejado</th><th class="n">Chegou</th><th class="n">Consumido</th><th class="n">Est. Pós-Baixa</th><th class="n">Atendimento</th><th>Status</th><th>Prioridade</th></tr></thead><tbody>` +
    (vis.length ? vis.map(m => `<tr>
      <td><b>${esc(m.tag)}</b></td><td>${esc(m.material)}</td><td>${esc(m.produto)}</td><td>${esc(m.etapa)}</td>
      <td class="n">${nf(m.planejado)}</td><td class="n">${nf(m.chegou)}</td><td class="n">${nf(consumidoDe(m))}</td>
      <td class="n ${posBaixaDe(m) < 0 ? 'valor-neg' : ''}">${nf(posBaixaDe(m))}</td>
      <td class="n">${m.atendimento != null ? nf(m.atendimento * 100, 1) + '%' : '—'}</td>
      <td><span class="farol f-${farolSt(m.status_logistico)}">${esc(m.status_logistico || '—')}</span></td>
      <td>${esc(m.prioridade || '')}</td></tr>`).join('')
    : '<tr><td colspan="11" class="vazio">Nenhum item encontrado.</td></tr>') + '</tbody>';
}

function renderEstRemessas() {
  if (!EP) return;
  const rem = EP.remessas;
  const cols = rem.colunas;
  const f = ($('#estRemFiltro')?.value || '').toUpperCase();
  const vis = rem.itens.filter(m => {
    if (f && !m.tag.toUpperCase().includes(f) && !(m.produto || '').toUpperCase().includes(f)) return false;
    return true;
  });
  const tile = (rot, val, sub, cc) => `<div class="tile" style="--c:${cc}"><div class="rot"><span>${rot}</span></div><div class="val">${val}</div><div class="sub">${sub}</div></div>`;
  const totRec = soma0(rem.itens, m => m.total_recebido);
  $('#estRemTiles').innerHTML =
    tile('Itens', rem.itens.length, `${vis.length} visíveis`, 'var(--fg)') +
    tile('Remessas', cols.length, 'colunas de envio', 'var(--acento)') +
    tile('Total recebido', nf(totRec), 'soma de todas as remessas', 'var(--verde)');

  const abrev = s => s.length > 18 ? s.slice(0, 16) + '…' : s;
  $('#tabEstRem').innerHTML = `<thead><tr><th>TAG</th><th>Material</th><th>Produto</th><th>Etapa</th>` +
    cols.map(c => `<th class="n" title="${esc(c)}">${esc(abrev(c))}</th>`).join('') +
    `<th class="n">Total</th></tr></thead><tbody>` +
    (vis.length ? vis.map(m => `<tr><td><b>${esc(m.tag)}</b></td><td>${esc(m.material)}</td><td>${esc(m.produto)}</td><td>${esc(m.etapa)}</td>` +
      cols.map(c => { const q = m.qtd_por_remessa[c]; return `<td class="n">${q ? nf(q) : ''}</td>`; }).join('') +
      `<td class="n"><b>${nf(m.total_recebido)}</b></td></tr>`).join('')
    : `<tr><td colspan="${4 + cols.length + 1}" class="vazio">Nenhum item encontrado.</td></tr>`) + '</tbody>';
}

function renderEstConsumo() {
  if (!EP) return;
  const cf = EP.consumo_fisico;
  const sems = cf.semanas;
  const f = ($('#estConsFiltro')?.value || '').toUpperCase();
  const vis = cf.itens.filter(m => {
    if (f && !m.tag.toUpperCase().includes(f) && !(m.produto || '').toUpperCase().includes(f)) return false;
    return true;
  });
  const tile = (rot, val, sub, cc) => `<div class="tile" style="--c:${cc}"><div class="rot"><span>${rot}</span></div><div class="val">${val}</div><div class="sub">${sub}</div></div>`;
  const totCons = soma0(cf.itens, m => m.total_consumo);
  $('#estConsTiles').innerHTML =
    tile('Fixadores', cf.itens.length, `${vis.length} visíveis`, 'var(--fg)') +
    tile('Semanas', sems.length, 'períodos registrados', 'var(--acento)') +
    tile('Total consumido', nf(totCons), 'soma de todos os itens', 'var(--vermelho)');

  const abrevS = s => s.length > 14 ? s.slice(0, 12) + '…' : s;
  $('#tabEstCons').innerHTML = `<thead><tr><th>TAG</th><th>Produto</th>` +
    sems.map(s => `<th class="n" colspan="2" title="${esc(s)}">${esc(abrevS(s))}</th>`).join('') +
    `<th class="n">Total</th></tr><tr><th></th><th></th>` +
    sems.map(() => `<th class="n" style="color:var(--ej)">EJ</th><th class="n" style="color:var(--cmm)">CMM</th>`).join('') +
    `<th></th></tr></thead><tbody>` +
    (vis.length ? vis.map(m => `<tr><td><b>${esc(m.tag)}</b></td><td>${esc(m.produto)}</td>` +
      sems.map(s => { const d = m.consumo_semanas[s]; return `<td class="n">${d ? nf(d.EJ) : ''}</td><td class="n">${d ? nf(d.CMM) : ''}</td>`; }).join('') +
      `<td class="n"><b>${nf(m.total_consumo)}</b></td></tr>`).join('')
    : `<tr><td colspan="${2 + sems.length * 2 + 1}" class="vazio">Nenhum item encontrado.</td></tr>`) + '</tbody>';

  const invDatas = cf.inventarios_datas || [];
  if (invDatas.length) {
    $('#tabEstConsInv').innerHTML = `<thead><tr><th>TAG</th><th>Produto</th>` +
      invDatas.map(d => `<th class="n">${esc(d)}</th>`).join('') +
      `</tr></thead><tbody>` +
      vis.filter(m => Object.keys(m.inventarios_fisicos || {}).length).map(m => `<tr><td><b>${esc(m.tag)}</b></td><td>${esc(m.produto)}</td>` +
        invDatas.map(d => `<td class="n">${m.inventarios_fisicos[d] != null ? nf(m.inventarios_fisicos[d]) : ''}</td>`).join('') + `</tr>`).join('') + '</tbody>';
  } else {
    $('#tabEstConsInv').innerHTML = '';
  }
}

// Colunas derivadas do INVENTARIO (mesma lógica da planilha): base = recebido, cv = consumo virtual, cf = retirado fisico.
function derivarInventario(base, cv, cf) {
  const fis = base - cf, virt = base - cv, perda = virt - fis;
  const taxa = virt !== 0 ? perda / virt : (fis !== 0 ? 1 : 0);
  const acu = Math.max(0, 1 - Math.abs(taxa));
  return {
    estoque_fisico: fis, estoque_virtual_atual: virt, perda_real: perda, taxa_perda: taxa, acuracidade: acu,
    status: acu >= 0.98 ? 'CONFORME' : acu >= 0.95 ? 'ATENÇÃO' : 'CRÍTICO',
    acao: perda > 0 ? 'INVESTIGAR PERDA / SAÍDA NÃO APONTADA' : perda < 0 ? 'VALIDAR SOBRA / ENTRADA / BAIXA' : 'OK',
  };
}

// Consumo virtual por TAG = produção acumulada × regras_baixa.json. Só entram serviços que existem na produção;
// itens sem regra mensurável ficam fora do mapa e mantêm o valor da planilha.
function consumoVirtualPorTag(regras) {
  const servicos = regras.consumo_por_servico || {};
  const acum = new Map();
  Object.entries(servicos).forEach(([nome, conf]) => {
    if (nome.startsWith('_') || !conf.itens) return;
    if (!M.empresas.some(e => e.servicos.some(s => s.nome === nome))) return;
    const n = prodServico(nome, null, '0000-01-01', '9999-12-31');
    conf.itens.forEach(it => {
      const o = acum.get(it.codigo) || { qtd: 0, partes: [], estimado: false };
      o.qtd += it.por_unidade * n;
      o.partes.push(`${nf(n)} ${cap(nome)} × ${nf(it.por_unidade, 2)}`);
      if (it.estimado) o.estimado = true;
      acum.set(it.codigo, o);
    });
  });
  const mapa = new Map();
  acum.forEach((o, tag) => mapa.set(tag, { cv: Math.round(o.qtd), origem: 'producao', estimado: o.estimado,
    nota: o.partes.join(' + ') + (o.estimado ? ' (divisão entre tipos de parafuso estimada)' : '') }));
  (regras.inventario_ajustes || []).forEach(a => mapa.set(a.tag, { cv: a.consumo_virtual, origem: 'ajuste', estimado: false, nota: a.motivo }));
  return mapa;
}

// Inventário: recebido e retirado vêm das abas Remessas e Consumo físico (editáveis).
function inventarioCalculado(regras) {
  const mapa = consumoVirtualPorTag(regras);
  const notas = regras.inventario_notas || {};
  const recebido = new Map(EP.remessas.itens.map(r => [r.tag, r.total_recebido]));
  const retirado = new Map(EP.consumo_fisico.itens.map(c => [c.tag, c.total_consumo]));
  return EP.inventario.map(m => {
    if (!m.status) return { ...m, origem: null, delta: 0 };
    const base = recebido.has(m.tag) ? recebido.get(m.tag) : m.estoque_virtual_base;
    const cf = retirado.has(m.tag) ? retirado.get(m.tag) : m.consumo_fisico;
    const c = mapa.get(m.tag) || { cv: m.consumo_virtual, origem: 'planilha', estimado: false,
      nota: notas[m.tag] || 'Sem regra de consumo pela produção: mantido o valor da planilha.' };
    return { ...m, estoque_virtual_base: base, consumo_fisico: cf, consumo_virtual: c.cv, consumo_planilha: m.consumo_virtual,
      delta: c.cv - m.consumo_virtual, origem: c.origem, estimado: c.estimado, nota: c.nota, ...derivarInventario(base, c.cv, cf) };
  });
}

function renderEstInventario() {
  if (!EP || !M) return;
  const regras = regrasBaixa(renderEstInventario);
  if (!regras) { $('#tabEstInv').innerHTML = '<tbody><tr><td class="vazio">Carregando regras de baixa...</td></tr></tbody>'; return; }
  const inv = inventarioCalculado(regras);
  const norm = s => (s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const f = ($('#estInvFiltro')?.value || '').toUpperCase();
  const fs = ($('#estInvStatus')?.value || '');
  const vis = inv.filter(m => {
    if (f && !m.tag.toUpperCase().includes(f) && !(m.produto || '').toUpperCase().includes(f)) return false;
    return !fs || norm(m.status) === fs;
  });
  const tile = (rot, val, sub, cc) => `<div class="tile" style="--c:${cc}"><div class="rot"><span>${rot}</span></div><div class="val">${val}</div><div class="sub">${sub}</div></div>`;
  const avaliados = inv.filter(m => m.status);
  const criticos = avaliados.filter(m => norm(m.status) === 'CRITICO').length;
  const conformes = avaliados.filter(m => norm(m.status) === 'CONFORME').length;
  const corrigidos = inv.filter(m => Math.abs(m.delta) >= 1).length;
  const acuMedia = avaliados.length ? soma0(avaliados, m => m.acuracidade || 0) / avaliados.length * 100 : 0;
  const prem = prodServico('PREMONTAGEM', null, '0000-01-01', '9999-12-31'), ic = prodServico('IÇAMENTO JOIST', null, '0000-01-01', '9999-12-31');
  $('#estInvNota').textContent = `Consumo virtual = produção acumulada (${nf(prem)} joists pré-montadas, ${nf(ic)} içadas) × regras de baixa. Recebido e retirado vêm das abas Remessas e Consumo físico.`;
  $('#estInvTiles').innerHTML =
    tile('Itens avaliados', avaliados.length, `${vis.length} visíveis`, 'var(--fg)') +
    tile('Acuracidade média', nf(acuMedia, 1) + '%', 'meta >= 98%', 'var(--acento)') +
    tile('Críticos', criticos, 'acuracidade < 95%', 'var(--vermelho)') +
    tile('Conformes', conformes, 'acuracidade >= 98%', 'var(--verde)') +
    tile('Consumo virtual corrigido', corrigidos, 'diferem da planilha', corrigidos ? 'var(--amarelo)' : 'var(--verde)');

  const farolAcu = s => ({ CONFORME: 'verde', ATENCAO: 'amarelo', CRITICO: 'vermelho' })[norm(s)] || 'pendente';
  const ROT_ORIGEM = { producao: ['verde', 'Produção'], ajuste: ['amarelo', 'Ajuste'], planilha: ['pendente', 'Planilha'] };
  const sinal = v => (v > 0 ? '+' : '') + nf(v);
  $('#tabEstInv').innerHTML = `<thead><tr><th>TAG</th><th>Produto</th><th class="n">Planejado</th><th class="n">Recebido</th><th class="n">Est. Físico</th><th class="n">Consumo Virtual</th><th>Origem</th><th class="n">Consumo Físico</th><th class="n">Est. Virtual Atual</th><th class="n">Perda Real</th><th class="n">Acuracidade</th><th>Status</th><th>Ação</th></tr></thead><tbody>` +
    (vis.length ? vis.map(m => {
      const [oc, ot] = ROT_ORIGEM[m.origem] || ['pendente', '—'];
      return `<tr>
      <td><b>${esc(m.tag)}</b></td><td>${esc(m.produto)}</td>
      <td class="n">${nf(m.planejado)}</td><td class="n">${nf(m.estoque_virtual_base)}</td><td class="n">${nf(m.estoque_fisico)}</td>
      <td class="n"><b>${nf(m.consumo_virtual)}</b>${m.estimado ? ' ≈' : ''}${Math.abs(m.delta) >= 1 ? `<br><span class="nota">planilha ${nf(m.consumo_planilha)} (${sinal(m.delta)})</span>` : ''}</td>
      <td>${m.origem ? `<span class="farol f-${oc}" title="${esc(m.nota)}">${ot}</span>` : ''}</td>
      <td class="n">${nf(m.consumo_fisico)}</td><td class="n">${nf(m.estoque_virtual_atual)}</td>
      <td class="n ${m.perda_real < 0 ? 'valor-neg' : ''}">${nf(m.perda_real)}</td>
      <td class="n">${m.status ? nf(m.acuracidade * 100, 1) + '%' : '—'}</td>
      <td>${m.status ? `<span class="farol f-${farolAcu(m.status)}">${esc(m.status)}</span>` : ''}</td>
      <td>${esc(m.acao || '')}</td></tr>`;
    }).join('')
    : '<tr><td colspan="13" class="vazio">Nenhum item encontrado.</td></tr>') + '</tbody>';
  requestAnimationFrame(syncScrollTopo);
}

// ------------------------------------------------------------ FIXADORES CRÍTICOS (consumo JOIST premontagem)
function renderEstCriticos() {
  if (!EP || !M) return;
  const regras = regrasBaixa(renderEstCriticos);
  if (!regras) {
    const box = document.getElementById('tabEstCrit');
    if (box) box.innerHTML = '<tbody><tr><td class="vazio">Carregando regras de baixa...</td></tr></tbody>';
    return;
  }
  const premont = regras.consumo_por_servico?.PREMONTAGEM;
  if (!premont) {
    document.getElementById('tabEstCrit').innerHTML = '<tbody><tr><td class="vazio">Regras de baixa (regras_baixa.json) indisponíveis neste servidor.</td></tr></tbody>';
    return;
  }
  const totalJoists = prodServico('PREMONTAGEM', null, '2000-01-01', '2099-12-31');
  const tile = (rot, val, sub, cc) => `<div class="tile" style="--c:${cc}"><div class="rot"><span>${rot}</span></div><div class="val">${val}</div><div class="sub">${sub}</div></div>`;
  const itens = premont.itens.map(item => {
    const teorico = Math.ceil(item.por_unidade * totalJoists);
    const remItem = EP.remessas.itens.find(r => r.tag === item.codigo);
    const recebido = remItem ? remItem.total_recebido : 0;
    const regFisico = EP.consumo_fisico.itens.find(c => c.tag === item.codigo);
    const consumoFisico = regFisico ? regFisico.total_consumo : null;
    const desvio = regFisico ? consumoFisico - teorico : null;
    const saldo = recebido - teorico;
    const cobertura = totalJoists > 0 ? recebido / (item.por_unidade * totalJoists) * 100 : 100;
    const status = saldo >= 0 ? 'OK' : (recebido === 0 ? 'SEM ESTOQUE' : 'INSUFICIENTE');
    const nivel = saldo >= 0 ? 'verde' : (recebido === 0 ? 'vermelho' : 'amarelo');
    return { ...item, teorico, recebido, consumoFisico, desvio, saldo, cobertura, status, nivel };
  });
  const criticos = itens.filter(i => i.nivel === 'vermelho').length;
  const insuf = itens.filter(i => i.nivel === 'amarelo').length;
  const ok = itens.filter(i => i.nivel === 'verde').length;
  document.getElementById('estCritTiles').innerHTML =
    tile('Joists produzidas', nf(totalJoists), 'PREMONTAGEM acumulado', 'var(--acento)') +
    tile('Sem estoque', criticos, 'nenhuma peca recebida', 'var(--vermelho)') +
    tile('Insuficientes', insuf, 'recebido < consumo teorico', 'var(--amarelo)') +
    tile('OK', ok, 'estoque atende', 'var(--verde)');
  const sorted = [...itens].sort((a, b) => a.saldo - b.saldo);
  document.getElementById('tabEstCrit').innerHTML =
    `<thead><tr><th>Codigo</th><th>Descricao</th><th class="n">Por joist</th><th class="n">Consumo teorico</th><th class="n">Recebido (remessas)</th><th class="n">Retirado (fisico)</th><th class="n">Retirado − teorico</th><th class="n">Saldo</th><th class="n">Cobertura</th><th>Status</th></tr></thead><tbody>` +
    sorted.map(i => `<tr>
      <td><b>${esc(i.codigo)}</b></td><td>${esc(i.descricao)}</td>
      <td class="n">${nf(i.por_unidade)}</td><td class="n">${nf(i.teorico)}</td>
      <td class="n">${nf(i.recebido)}</td><td class="n">${i.desvio == null ? '—' : nf(i.consumoFisico)}</td>
      <td class="n ${i.desvio != null && i.desvio > i.teorico * 0.02 ? 'valor-neg' : ''}">${i.desvio == null ? '—' : (i.desvio > 0 ? '+' : '') + nf(i.desvio)}</td>
      <td class="n ${i.saldo < 0 ? 'valor-neg' : ''}"><b>${nf(i.saldo)}</b></td>
      <td class="n">${nf(i.cobertura, 1)}%</td>
      <td><span class="farol f-${i.nivel}">${i.status}</span></td></tr>`).join('') + '</tbody>';
}

// ------------------------------------------------------------ KPI / INSIGHTS GERAL
function renderKPI() {
  if (!M) return;
  const tile = (rot, val, sub, cc) => `<div class="tile" style="--c:${cc}"><div class="rot"><span>${rot}</span></div><div class="val">${val}</div><div class="sub">${sub}</div></div>`;
  const c = corte();
  const ks = paresMeta().map(([e, s]) => kpiPer(e, s, per.ini, per.fim, c)).filter(k => k.prevTotal > 0 || k.real > 0);
  const totPrev = soma0(ks, k => k.prev);
  const totReal = soma0(ks, k => k.real);
  const pctGeral = totPrev > 0 ? Math.round(100 * totReal / totPrev) : 0;
  const atrasados = ks.filter(k => k.pct != null && k.pct < 90).length;
  const noPrazo = ks.filter(k => k.pct != null && k.pct >= 90).length;
  const impAbertos = M.impactos.filter(i => !i.solucionado).length;
  let estCrit = 0, estOk = 0;
  if (EP) {
    estCrit = EP.materiais.filter(m => m.status_logistico === 'Crítico').length;
    estOk = EP.materiais.filter(m => m.status_logistico === 'Atendido' || m.status_logistico === 'Excedente').length;
  }
  const tilesH =
    tile('Producao geral', pctGeral + '%', `${nf(totReal)} de ${nf(totPrev)} previstos`, pctGeral >= 90 ? 'var(--verde)' : pctGeral >= 70 ? 'var(--amarelo)' : 'var(--vermelho)') +
    tile('Atrasados', atrasados, 'servicos < 90% do previsto', atrasados ? 'var(--vermelho)' : 'var(--verde)') +
    tile('No prazo', noPrazo, 'servicos >= 90%', 'var(--verde)') +
    tile('Impactos abertos', impAbertos, impAbertos ? 'requerem atenção' : 'nenhum pendente', impAbertos ? 'var(--amarelo)' : 'var(--verde)') +
    tile('Materiais criticos', estCrit, 'nenhuma peça recebida', estCrit ? 'var(--vermelho)' : 'var(--verde)') +
    tile('Materiais OK', estOk, 'totalmente atendidos', 'var(--acento)');
  document.getElementById('kpiTiles').innerHTML = tilesH;

  // Faróis de produção
  let hProd = '<thead><tr><th>Empresa</th><th>Servico</th><th class="n">Previsto</th><th class="n">Realizado</th><th class="n">%</th><th>Farol</th></tr></thead><tbody>';
  ks.sort((a, b) => (a.pct || 0) - (b.pct || 0)).forEach(k => {
    const [fc, ft] = farol(k.pct, k.prev === 0);
    hProd += `<tr><td><span class="emp-tag" style="--c:${corEmp(k.emp)}">${esc(k.emp)}</span></td><td>${esc(cap(k.serv))}</td>
      <td class="n">${nf(k.prev, 1)}</td><td class="n">${nf(k.real, 1)}</td>
      <td class="n">${k.pct != null ? nf(k.pct, 1) + '%' : '—'}</td><td><span class="farol f-${fc}">${ft}</span></td></tr>`;
  });
  document.getElementById('tabKpiProd').innerHTML = hProd + '</tbody>';

  // Faróis de estoque
  let hEst = '<thead><tr><th>TAG</th><th>Produto</th><th class="n">Planejado</th><th class="n">Chegou</th><th>Status</th></tr></thead><tbody>';
  if (EP) {
    const critMats = EP.materiais.filter(m => m.status_logistico === 'Crítico' || m.status_logistico === 'Recebimento Parcial')
      .sort((a, b) => (a.atendimento || 0) - (b.atendimento || 0)).slice(0, 20);
    critMats.forEach(m => {
      const fc = m.status_logistico === 'Crítico' ? 'vermelho' : 'amarelo';
      hEst += `<tr><td><b>${esc(m.tag)}</b></td><td>${esc(m.produto)}</td>
        <td class="n">${nf(m.planejado)}</td><td class="n">${nf(m.chegou)}</td>
        <td><span class="farol f-${fc}">${esc(m.status_logistico)}</span></td></tr>`;
    });
    if (!critMats.length) hEst += '<tr><td colspan="5" class="vazio">Todos os materiais atendidos.</td></tr>';
  } else {
    hEst += '<tr><td colspan="5" class="vazio">Dados de estoque não carregados.</td></tr>';
  }
  document.getElementById('tabKpiEstoque').innerHTML = hEst + '</tbody>';

  // Prontidão de materiais (próxima semana)
  renderKpiProntidao();

  // Alertas gerais
  const alertas = [];
  ks.filter(k => k.pct != null && k.pct < 90).forEach(k => {
    const dias = k.prev > 0 ? Math.ceil((k.prev - k.real) / Math.max(k.real / 5, 0.1)) : 0;
    alertas.push(`<li class="alerta vermelho"><b>${esc(k.emp)} — ${esc(cap(k.serv))}</b>: ${nf(k.pct, 1)}% do previsto. Desvio de ${nf(k.prev - k.real, 1)} un.</li>`);
  });
  if (impAbertos) alertas.push(`<li class="alerta amarelo"><b>${impAbertos} impacto(s) em aberto</b> — verificar solucao.</li>`);
  M.cliente.forEach(cl => {
    if (!cl.prazo) return;
    const diasP = Math.ceil((dU(cl.prazo) - dU(hoje())) / 86400000);
    if (diasP <= 7 && diasP > 0) alertas.push(`<li class="alerta amarelo"><b>${esc(cl.servico)}</b>: prazo em ${diasP} dia(s) (${fd(cl.prazo)}).</li>`);
    if (diasP <= 0) alertas.push(`<li class="alerta vermelho"><b>${esc(cl.servico)}</b>: prazo vencido em ${fd(cl.prazo)}.</li>`);
  });
  if (estCrit) alertas.push(`<li class="alerta vermelho"><b>${estCrit} material(is) critico(s)</b> — nenhuma peça recebida, verificar remessas.</li>`);
  if (!alertas.length) alertas.push('<li class="vazio">Nenhum alerta no momento.</li>');
  document.getElementById('kpiAlertas').innerHTML = alertas.join('');

  const cont = document.getElementById('kpiCont');
  const total = atrasados + impAbertos + estCrit;
  cont.hidden = !total; cont.textContent = total;
}

function renderKpiProntidao() {
  const tab = document.getElementById('tabKpiProntidao');
  if (!M || !EP) { tab.innerHTML = '<tbody><tr><td class="vazio">Dados não disponíveis.</td></tr></tbody>'; return; }
  const proxSeg = add(segunda(ref), 7);
  const proxFim = add(proxSeg, 5);
  const metasProx = M.metas.filter(m => m.inicio <= proxFim && m.fim >= proxSeg);
  if (!metasProx.length) { tab.innerHTML = '<tbody><tr><td class="vazio">Nenhuma atividade planejada para a próxima semana.</td></tr></tbody>'; return; }
  const regras = regrasBaixa(renderKpiProntidao);
  if (!regras) {
    tab.innerHTML = '<tbody><tr><td class="vazio">Carregando...</td></tr></tbody>';
    return;
  }
  let h = '<thead><tr><th>Servico</th><th>Empresa</th><th>Meta semana</th><th>Materiais necessarios</th><th>Disponivel</th><th>Sinal</th></tr></thead><tbody>';
  metasProx.forEach(m => {
    const metaTot = metaSemanaTotal(m);
    const consumo = regras.consumo_por_servico?.[m.servico];
    if (!consumo || !consumo.itens) {
      h += `<tr><td>${esc(cap(m.servico))}</td><td><span class="emp-tag" style="--c:${corEmp(m.empresa)}">${esc(m.empresa)}</span></td>
        <td class="n">${nf(metaTot, 1)}</td><td colspan="2" class="sub">Sem regra de consumo</td><td><span class="farol f-verde">OK</span></td></tr>`;
      return;
    }
    let todosOk = true, faltam = [];
    consumo.itens.forEach(ci => {
      const necessario = Math.ceil(ci.por_unidade * metaTot);
      const remItem = EP.remessas.itens.find(r => r.tag === ci.codigo);
      const disp = remItem ? remItem.total_recebido : 0;
      const retirado = EP.consumo_fisico.itens.find(c => c.tag === ci.codigo)?.total_consumo || 0;
      const saldoDisp = disp - retirado;
      if (saldoDisp < necessario) { todosOk = false; faltam.push(`${ci.codigo} (falta ${nf(necessario - Math.max(saldoDisp, 0))})`); }
    });
    const sinal = todosOk ? 'verde' : 'vermelho';
    const sinTxt = todosOk ? 'PODE INICIAR' : 'SOLICITAR MATERIAL';
    h += `<tr><td>${esc(cap(m.servico))}</td><td><span class="emp-tag" style="--c:${corEmp(m.empresa)}">${esc(m.empresa)}</span></td>
      <td class="n">${nf(metaTot, 1)}</td>
      <td>${todosOk ? 'Todos disponíveis' : faltam.slice(0, 3).join(', ') + (faltam.length > 3 ? ` +${faltam.length - 3}` : '')}</td>
      <td>${todosOk ? '<span class="farol f-verde">SIM</span>' : '<span class="farol f-vermelho">NÃO</span>'}</td>
      <td><span class="farol f-${sinal}">${sinTxt}</span></td></tr>`;
  });
  tab.innerHTML = h + '</tbody>';
}

// ------------------------------------------------------------ EQUIPAMENTOS
function usosPeriodo() { return T.usos.filter(u => u.data && u.data >= per.ini && u.data <= per.fim); }
function ratear(lista) {
  const out = [];
  lista.forEach(u => {
    const emps = empresasDe(u.empresa);
    const partes = emps.length ? emps : ['NÃO INFORMADA'];
    partes.forEach(emp => out.push({ ...u, empAjust: emp, custoR: (u.custo || 0) / partes.length, combR: (u.custo_combustivel || 0) / partes.length, litrosR: (u.litros || 0) / partes.length }));
  });
  return out;
}

function renderEquip() {
  const us = usosPeriodo(), rt = ratear(us);
  const totEq = soma0(us, u => u.custo), totComb = soma0(us, u => u.custo_combustivel), totL = soma0(us, u => u.litros);
  const porEmp = {};
  rt.forEach(r => { const o = porEmp[r.empAjust] ||= { eq: 0, comb: 0, l: 0, dias: new Set() }; o.eq += r.custoR; o.comb += r.combR; o.l += r.litrosR; o.dias.add(r.data); });
  const emps = Object.keys(porEmp).sort((a, b) => (porEmp[b].eq + porEmp[b].comb) - (porEmp[a].eq + porEmp[a].comb));
  const tile = (rot, val, sub, cc) => `<div class="tile" style="--c:${cc}"><div class="rot"><span>${esc(rot)}</span></div><div class="val">${val}</div><div class="sub">${sub}</div></div>`;
  $('#eqTiles').innerHTML = tile('Custo total no período', rs(totEq + totComb), `Equipamentos ${rs(totEq)} · combustível ${rs(totComb)}`, 'var(--fg)') +
    tile('Combustível', nf(totL, 0) + ' L', `${rs(totComb)} · média ${totL ? 'R$ ' + nf(totComb / totL, 2) : '—'}/L`, 'var(--acento)') +
    ['EJ', 'CMM', 'GLOBO AÇOS'].map(n => { const o = porEmp[n]; return tile(n, rs(o ? o.eq + o.comb : 0), o ? `${rs(o.eq)} equip. + ${rs(o.comb)} comb. · ${nf(o.l)} L` : 'sem registros no período', corEmp(n)); }).join('');

  const c = corte();
  $('#tabEqEmp').innerHTML = `<thead><tr><th>Empresa</th><th class="n">Equipamentos</th><th class="n">Combustível</th><th class="n">Litros</th><th class="n">Total</th><th class="n">% do custo</th><th class="n">Dias com uso</th><th class="n">Produção no período</th><th class="n">Custo por unidade produzida</th></tr></thead><tbody>` +
    (emps.length ? emps.map(n => {
      const o = porEmp[n], tot = o.eq + o.comb;
      const e = empresa(n);
      const prod = e ? soma0(M.metas.filter(m => m.empresa === n).map(m => m.servico).filter((v, i, a) => a.indexOf(v) === i), s => prodServico(s, n, per.ini, c)) : null;
      return `<tr><td><span class="emp-tag" style="--c:${corEmp(n)}">${esc(n)}</span></td><td class="n">${rs(o.eq)}</td><td class="n">${rs(o.comb)}</td><td class="n">${nf(o.l, 1)}</td><td class="n"><b>${rs(tot)}</b></td>
        <td class="n">${nf(tot / (totEq + totComb || 1) * 100, 1)}%</td><td class="n">${o.dias.size}</td><td class="n">${prod == null ? '—' : nf(prod, 1)}</td><td class="n">${prod ? rs(tot / prod) : '—'}</td></tr>`;
    }).join('') : '<tr><td colspan="9" class="vazio">Sem registros no período. Use "Importar abas mensais" ou "+ Uso / abastecimento".</td></tr>') + '</tbody>';

  const porEq = {};
  us.forEach(u => { const o = porEq[u.equipamento || 'NÃO INFORMADO'] ||= { n: 0, eq: 0, comb: 0, l: 0 }; if (u.custo) o.n += u.quantidade || 1; o.eq += u.custo || 0; o.comb += u.custo_combustivel || 0; o.l += u.litros || 0; });
  $('#tabEqEquip').innerHTML = `<thead><tr><th>Equipamento</th><th class="n">Diárias/usos</th><th class="n">Custo</th><th class="n">Litros</th><th class="n">Combustível</th><th class="n">Total</th></tr></thead><tbody>` +
    Object.entries(porEq).sort((a, b) => (b[1].eq + b[1].comb) - (a[1].eq + a[1].comb)).map(([n, o]) =>
      `<tr><td><b>${esc(n)}</b></td><td class="n">${nf(o.n, 1)}</td><td class="n">${rs(o.eq)}</td><td class="n">${nf(o.l, 1)}</td><td class="n">${rs(o.comb)}</td><td class="n"><b>${rs(o.eq + o.comb)}</b></td></tr>`).join('') + '</tbody>';

  $('#tabEqCad').innerHTML = `<thead><tr><th>Equipamento</th><th>Tipo</th><th>Cobrança</th><th class="n">Valor</th><th>Situação</th><th></th></tr></thead><tbody>` +
    (T.equipamentos.length ? T.equipamentos.map(e => `<tr><td><b>${esc(e.equipamento)}</b><br><span class="nota">${esc(e.locadora || '')}</span></td><td>${esc(e.tipo || '—')}</td><td>${esc(e.cobranca || '—')}</td><td class="n">${rs(e.valor)}</td><td>${esc(e.situacao || '')}</td>
      <td><button class="link" data-editar-reg="equipamentos" data-linha="${e.linha}">Editar</button></td></tr>`).join('')
      : '<tr><td colspan="6" class="vazio">Nenhum equipamento cadastrado.</td></tr>') + '</tbody>';

  $('#tabEqUso').innerHTML = `<thead><tr><th>Data</th><th>Equipamento</th><th>Empresa</th><th>Uso</th><th class="n">Qtd</th><th class="n">Custo</th><th class="n">Litros</th><th class="n">R$/L</th><th class="n">Combustível</th><th>Operador / obs.</th><th></th></tr></thead><tbody>` +
    (us.length ? [...us].sort((a, b) => b.data.localeCompare(a.data)).map(u => `<tr><td>${fdA(u.data)}</td><td>${esc(u.equipamento)}</td><td>${esc(u.empresa)}</td><td>${esc(u.uso)}</td><td class="n">${nf(u.quantidade, 1)}</td><td class="n">${u.custo ? rs(u.custo) : '—'}</td>
      <td class="n">${nf(u.litros, 1)}</td><td class="n">${u.preco_litro ? nf(u.preco_litro, 2) : '—'}</td><td class="n">${u.custo_combustivel ? rs(u.custo_combustivel) : '—'}</td><td class="sub">${esc([u.operador, u.obs].filter(Boolean).join(' · '))}</td>
      <td><button class="link" data-editar-reg="usos" data-linha="${u.linha}">Editar</button></td></tr>`).join('')
      : '<tr><td colspan="11" class="vazio">Sem registros no período.</td></tr>') + '</tbody>';

  graficoEquip(rt);
}

function graficoEquip(rt) {
  const longo = diasEntre(per.ini, per.fim) > 45;
  const chaveT = d => longo ? segunda(d) : d;
  const buckets = [...new Set(rt.map(r => chaveT(r.data)))].sort();
  const emps = [...new Set(rt.map(r => r.empAjust))].sort((a, b) => (COR_EMP[a] ? 0 : 1) - (COR_EMP[b] ? 0 : 1) || a.localeCompare(b));
  $('#legEq').innerHTML = emps.map(n => `<span><i style="--c:${corEmp(n)}"></i>${esc(n)}</span>`).join('') + `<span class="nota">${longo ? 'por semana' : 'por dia'}</span>`;
  const outras = emps.filter(n => !COR_EMP[n]);
  trocarGrafico('gEquip', {
    type: 'bar',
    data: {
      labels: buckets.map(b => longo ? 'sem. ' + fd(b) : fd(b)),
      datasets: emps.map(n => ({
        label: n, data: buckets.map(b => +soma0(rt.filter(r => r.empAjust === n && chaveT(r.data) === b), r => r.custoR + r.combR).toFixed(2)),
        backgroundColor: COR_EMP[n] ? corEmpHex(n) : (outras.indexOf(n) % 2 ? cor('--fg3') : cor('--prev')), borderColor: cor('--card'), borderWidth: 1, borderRadius: 2, stack: 'custo',
      })),
    },
    options: {
      responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: x => `${x.dataset.label}: ${rs(x.raw)}`, footer: its => 'Total: ' + rs(soma0(its, i => i.raw)) } } },
      scales: { ...eixos({ stacked: true, ticks: { color: cor('--fg2'), callback: v => 'R$ ' + nf(v / 1000) + ' mil' } }), x: { stacked: true, ticks: { color: cor('--fg2') }, grid: { display: false } } },
    },
  });
}

async function importarEquip() {
  const b = $('#btnImportarEq');
  b.disabled = true;
  try {
    const r = await postar(API + 'equip/importar', {});
    await carregar();
    toast(r.importados ? `${r.importados} registro(s) importado(s) das abas mensais` : 'Nada novo para importar: as abas mensais já estão no sistema.');
  } catch (err) { toast(err.message, true); } finally { b.disabled = false; }
}

// ------------------------------------------------------------ MEDIÇÃO (BM)
// Cada atividade do catálogo tem peso dentro do item; o avanço do item é a soma ponderada dos avanços das
// atividades (realizado acumulado / quantidade contratada, limitado a 100%) e o valor medido é o avanço do
// item x valor do item em cada contrato (QPC e RÓTULA). Equipamento e combustível lançados no sistema são
// descontados do contrato RÓTULA em cada período.
const BM_CONTRATOS = ['QPC', 'RÓTULA'];
const BM_DESCONTA_EQUIP = 'RÓTULA';
let bmEmp = null, bmSub = 'boletim', bmPerSel = null, lancModo = 'grade';
const bmPend = new Map();      // `${empresa}|${codigo}|${data}` -> texto digitado no lançamento por serviço
const bmAbertos = new Set();   // itens expandidos no boletim

const bmTab = nome => (T && T[nome]) || [];
const bmAtiv = emp => bmTab('bm_atividades').filter(a => a.empresa === emp);
const bmEmpresas = () => [...new Set(bmTab('bm_atividades').map(a => a.empresa))];
const bmChave = (emp, cod, d) => `${emp}|${cod}|${d}`;
const bmTile = (rot, val, sub, cc) => `<div class="tile" style="--c:${cc}"><div class="rot"><span>${esc(rot)}</span></div><div class="val">${val}</div><div class="sub">${sub}</div></div>`;

function bmRealizado(a, ate) {
  if (a.controle) {
    const e = empresa(a.empresa), col = colDe(e, a.controle);
    return col ? soma(e, col, '0000', ate) : 0;
  }
  let t = 0;
  bmTab('bm_apontamentos').forEach(x => { if (x.codigo === a.codigo && x.data && x.data <= ate) t += x.quantidade || 0; });
  return t;
}

const bmFech = (emp, n) => bmTab('bm_fechamentos').find(f => f.empresa === emp && f.bm === n);
const bmFechAtiv = (emp, n) => bmTab('bm_fech_atividades').filter(r => r.empresa === emp && r.bm === n);

function bmMontarItens(lista) {
  const mapa = new Map();
  lista.forEach(x => {
    const a = x.a;
    let it = mapa.get(a.item);
    if (!it) { it = { item: a.item, desc: a.item_desc, valor: { 'QPC': a.valor_qpc || 0, 'RÓTULA': a.valor_rotula || 0 }, xs: [] }; mapa.set(a.item, it); }
    it.xs.push(x);
  });
  return [...mapa.values()].map(it => {
    const sp = it.xs.reduce((s, x) => s + (x.a.peso || 0), 0) || 1;
    let pct = 0, excedeu = false;
    const ats = it.xs.map(({ a, real }) => {
      const r = a.qtd ? real / a.qtd : 0;
      if (r > 1.000001) excedeu = true;
      const p = Math.min(1, r);
      pct += p * (a.peso || 0) / sp;
      return { a, real, pct: p };
    });
    return { item: it.item, desc: it.desc, valor: it.valor, ats, pct, somaPesos: sp, pesosAjustados: Math.abs(sp - 1) > 1e-6, excedeu };
  });
}

// snap: linhas de bm_fech_atividades (BM fechado) — usa quantidade, peso, valor e realizado congelados
function bmItens(emp, ate, snap) {
  if (snap) {
    const cat = new Map(bmTab('bm_atividades').map(a => [a.codigo, a]));
    return bmMontarItens(snap.map(r => {
      const b = cat.get(r.codigo) || {};
      return { a: { ...b, codigo: r.codigo, empresa: emp, item: r.item, item_desc: b.item_desc || r.item, atividade: b.atividade || r.codigo,
        unidade: b.unidade || '', qtd: r.qtd, peso: r.peso, valor_qpc: r.valor_qpc, valor_rotula: r.valor_rotula }, real: r.realizado || 0 };
    }));
  }
  return bmMontarItens(bmAtiv(emp).map(a => ({ a, real: bmRealizado(a, ate) })));
}

function bmPeriodos(emp) {
  const ps = bmTab('bm_periodos').filter(p => p.empresa === emp && ehISO(p.corte)).sort((a, b) => a.corte.localeCompare(b.corte));
  const lista = [];
  let ant = null;
  ps.forEach((p, i) => {
    const n = p.bm || i + 1, fech = bmFech(emp, n);
    lista.push({ chave: 'p' + p.linha, n, ini: ant ? add(ant, 1) : '0000-01-01', fim: p.corte, cortado: true, fechado: !!fech, fech,
      rot: `BM${n} · corte ${fdA(p.corte)}${fech ? ' · fechado' : ''}` });
    ant = p.corte;
  });
  if (!ant || ref > ant) {
    const n = lista.length ? lista[lista.length - 1].n + 1 : 1;
    lista.push({ chave: 'aberto', n, ini: ant ? add(ant, 1) : '0000-01-01', fim: ref, cortado: false, fechado: false,
      rot: ant ? `BM${n} em aberto · até ${fdA(ref)}` : `Acumulado até ${fdA(ref)} (sem corte definido)` });
  }
  return lista;
}

function bmDeducoes(emp, p) {
  let equip, comb, litros, usos = null;
  if (p.fechado && p.fech) {
    equip = p.fech.equip || 0; comb = p.fech.comb || 0; litros = p.fech.litros || 0;
  } else {
    const rt = ratear(bmTab('usos').filter(u => u.data && u.data >= p.ini && u.data <= p.fim)).filter(r => r.empAjust === emp);
    equip = soma0(rt, r => r.custoR); comb = soma0(rt, r => r.combR); litros = soma0(rt, r => r.litrosR); usos = rt.length;
  }
  const manuais = bmTab('bm_deducoes').filter(d => d.empresa === emp && (d.bm != null ? d.bm === p.n : (d.data && d.data >= p.ini && d.data <= p.fim)));
  const total = {};
  BM_CONTRATOS.forEach(c => {
    total[c] = (c === BM_DESCONTA_EQUIP ? equip + comb : 0) + soma0(manuais.filter(d => d.contrato === c || d.contrato === 'AMBOS'), d => d.valor);
  });
  return { equip, comb, litros, manuais, total, usos };
}

// BM fechado: valores congelados. BM aberto: dados vivos; o que foi corrigido em datas de períodos já fechados
// aparece como ajuste (diferença entre o realizado atual até o corte anterior e a foto daquele fechamento).
function bmCalc(emp, p) {
  const ps = bmPeriodos(emp), i = ps.findIndex(x => x.chave === p.chave), prev = i > 0 ? ps[i - 1] : null;
  const fimIt = p.fechado ? bmItens(emp, null, bmFechAtiv(emp, p.n)) : bmItens(emp, p.fim);
  let antIt = null, ajuste = new Map();
  if (prev) {
    if (prev.fechado) {
      antIt = bmItens(emp, null, bmFechAtiv(emp, prev.n));
      if (!p.fechado) {
        const vivo = new Map(bmItens(emp, prev.fim).map(it => [it.item, it.pct]));
        antIt.forEach(it => ajuste.set(it.item, (vivo.get(it.item) || 0) - it.pct));
      }
    } else antIt = bmItens(emp, prev.fim);
  }
  const ant = new Map((antIt || []).map(it => [it.item, it]));
  const itens = fimIt.map(it => {
    const a = ant.get(it.item), pctAnt = a ? a.pct : 0;
    const reaisAnt = a ? new Map(a.ats.map(x => [x.a.codigo, x.real])) : new Map();
    return { ...it, pctAnt, pctPer: it.pct - pctAnt, pctAjuste: ajuste.get(it.item) || 0,
      ats: it.ats.map(x => ({ ...x, realAnt: reaisAnt.get(x.a.codigo) || 0 })) };
  });
  const tot = {};
  BM_CONTRATOS.forEach(c => {
    const contrato = soma0(itens, it => it.valor[c]);
    const acum = soma0(itens, it => it.pct * it.valor[c]);
    const antV = soma0(itens, it => it.pctAnt * it.valor[c]);
    tot[c] = { contrato, acum, ant: antV, per: acum - antV, ajuste: soma0(itens, it => it.pctAjuste * it.valor[c]),
      pctAcum: contrato ? acum / contrato : 0, pctPer: contrato ? (acum - antV) / contrato : 0 };
  });
  const ded = bmDeducoes(emp, p);
  const faturar = {};
  BM_CONTRATOS.forEach(c => faturar[c] = tot[c].per - ded.total[c]);
  return { p, itens, tot, ded, faturar, prev };
}

function bmEvolucao(emp) {
  if (!bmAtiv(emp).length) return [];
  const datas = [];
  const e = empresa(emp);
  if (e) Object.keys(e.registros).forEach(d => datas.push(d));
  bmTab('bm_apontamentos').forEach(x => { if (x.empresa === emp && x.data) datas.push(x.data); });
  const validas = datas.filter(ehISO).sort();
  if (!validas.length) return [];
  const pts = [];
  for (let d = add(segunda(validas[0]), 6); d < ref; d = add(d, 7)) pts.push(d);
  pts.push(ref);
  return pts.map(dia => {
    const its = bmItens(emp, dia), o = { dia };
    BM_CONTRATOS.forEach(c => o[c] = soma0(its, it => it.pct * it.valor[c]));
    return o;
  });
}

function renderBM() {
  const emps = bmEmpresas();
  const box = $('#bmCorpo');
  if (!emps.length) {
    $('#segBmEmp').innerHTML = ''; $('#segBmSub').innerHTML = '';
    box.innerHTML = `<div class="bloco"><p class="vazio">O catálogo de atividades do BM ainda não foi carregado.</p>${(D.recursos || {}).online ? '' : '<button class="btn primario" data-bm-semear>Carregar catálogo inicial</button>'}</div>`;
    return;
  }
  if (!bmEmp || !emps.includes(bmEmp)) bmEmp = emps[0];
  $('#segBmEmp').innerHTML = emps.map(n => `<button data-bm-emp="${esc(n)}" class="${n === bmEmp ? 'ativa' : ''}">${esc(n)}</button>`).join('');
  $('#segBmSub').innerHTML = [['boletim', 'Boletim (BM)'], ['periodos', 'Períodos e deduções'], ['catalogo', 'Catálogo de atividades']]
    .map(([k, r]) => `<button data-bm-sub="${k}" class="${k === bmSub ? 'ativa' : ''}">${r}</button>`).join('');
  ({ boletim: renderBMBoletim, periodos: renderBMPeriodos, catalogo: renderBMCatalogo })[bmSub](box);
}

function renderBMBoletim(box) {
  const emp = bmEmp, ps = bmPeriodos(emp);
  if (!ps.some(p => p.chave === bmPerSel)) bmPerSel = ps[ps.length - 1].chave;
  const p = ps.find(x => x.chave === bmPerSel), r = bmCalc(emp, p);
  const cc = corEmp(emp);
  const pc = v => nf(v * 100, 1) + '%';
  const idx = ps.findIndex(x => x.chave === p.chave);
  const podeFechar = p.cortado && !p.fechado && ps.slice(0, idx).every(x => x.fechado);
  const podeReabrir = p.fechado && !ps.some(x => x.fechado && x.n > p.n);

  let h = `<div class="barra-acoes"><label class="rot-sel">Medição <select id="selBmPer">${ps.map(x => `<option value="${x.chave}" ${x.chave === bmPerSel ? 'selected' : ''}>${esc(x.rot)}</option>`).join('')}</select></label>
    <span class="status-bm">${p.fechado ? `<span class="farol f-verde">FECHADO em ${fdA(p.fech.fechado_em)}</span>` : `<span class="farol f-amarelo">EM ABERTO</span>`}</span>
    <span class="nota">Período de ${p.ini === '0000-01-01' ? 'início da obra' : fdA(p.ini)} a ${fdA(p.fim)}. ${p.fechado ? 'Valores congelados no fechamento.' : 'Realizado vem do lançamento de produção.'}</span>
    <span class="acoes">${podeFechar ? `<button class="btn primario" data-bm-fechar>Fechar BM${p.n}</button>` : ''}${podeReabrir ? `<button class="btn" data-bm-reabrir>Reabrir BM${p.n}</button>` : ''}</span></div>`;
  h += '<div class="tiles">' +
    BM_CONTRATOS.map(c => bmTile(`Contrato ${c}`, rs(r.tot[c].contrato), `Medido acumulado ${rs(r.tot[c].acum)} · <b>${pc(r.tot[c].pctAcum)}</b>`, c === 'QPC' ? 'var(--fg3)' : cc)).join('') +
    bmTile('Medido no período', rs(r.tot['RÓTULA'].per), `RÓTULA · QPC ${rs(r.tot['QPC'].per)}`, 'var(--fg)') +
    bmTile('Deduções (RÓTULA)', rs(r.ded.total['RÓTULA']), `Equip. ${rs(r.ded.equip)} · comb. ${rs(r.ded.comb)} · outras ${rs(soma0(r.ded.manuais.filter(d => d.contrato !== 'QPC'), d => d.valor))}`, 'var(--vermelho)') +
    bmTile('Valor a faturar (RÓTULA)', rs(r.faturar['RÓTULA']), `QPC ${rs(r.faturar['QPC'])} · medido − deduções`, 'var(--verde)') + '</div>';

  const alertas = [];
  r.itens.filter(it => it.pesosAjustados).forEach(it => alertas.push(`Item ${it.item}: os pesos das atividades somam ${nf(it.somaPesos * 100, 1)}% (o sistema normaliza para 100%). Corrija no catálogo.`));
  r.itens.filter(it => it.excedeu).forEach(it => alertas.push(`Item ${it.item}: há atividade com realizado acima da quantidade contratada (limitado a 100% no cálculo).`));
  if (!p.cortado && p.ini === '0000-01-01') alertas.push('Nenhum corte de BM cadastrado para esta empresa: o boletim mostra o acumulado até a data de referência. Cadastre em "Períodos e deduções".');
  const ajQ = r.tot['QPC'].ajuste, ajR = r.tot['RÓTULA'].ajuste;
  if (Math.abs(ajQ) + Math.abs(ajR) > 0.5) {
    const its = r.itens.filter(it => Math.abs(it.pctAjuste) > 1e-9).map(it => it.item).join(', ');
    alertas.push(`Ajuste de períodos anteriores: correções em datas de ${r.prev ? 'BM' + r.prev.n + ' (já fechado)' : 'períodos fechados'} somam RÓTULA ${rs(ajR)} e QPC ${rs(ajQ)} (itens ${its}). Entram neste BM sem alterar o fechado.`);
  }
  if (p.cortado && !p.fechado && !podeFechar) alertas.push(`Para fechar o BM${p.n}, feche antes os BMs anteriores.`);
  if (alertas.length) h += `<div class="bloco"><div class="bloco-cab"><h2>Pontos de atenção</h2></div><ul class="alertas">${alertas.map(a => `<li><span class="farol f-amarelo">Atenção</span><span>${esc(a)}</span></li>`).join('')}</ul></div>`;

  h += `<div class="bloco"><div class="bloco-cab"><h2>Evolução da medição acumulada</h2><div class="legenda"><span><i style="--c:${cc}"></i>RÓTULA</span><span><i style="--c:var(--fg3)"></i>QPC</span></div></div><div class="grafico"><canvas id="gBM"></canvas></div></div>`;

  h += `<div class="bloco"><div class="bloco-cab"><h2>Medição por item e atividade</h2><span class="nota">Clique no item para ver as atividades.</span></div><div class="tabela-rolagem"><table class="tabela-bm"><thead><tr>
    <th>Item / atividade</th><th class="n">Contratado</th><th class="n">No período</th><th class="n">Acumulado</th><th class="n">Peso</th><th class="n">% anterior</th><th class="n">% período</th><th class="n">% acumulado</th>
    <th class="n">QPC período</th><th class="n">QPC acumulado</th><th class="n">RÓTULA período</th><th class="n">RÓTULA acumulado</th></tr></thead><tbody>`;
  r.itens.forEach(it => {
    const aberto = bmAbertos.has(it.item);
    h += `<tr class="linha-item" data-bm-item="${esc(it.item)}"><td><span class="seta">${aberto ? '▾' : '▸'}</span> <b>${esc(it.item)}</b> ${esc(cap(it.desc))}</td><td></td><td></td><td></td><td></td>
      <td class="n">${pc(it.pctAnt)}</td><td class="n">${pc(it.pctPer)}</td><td class="n"><b>${pc(it.pct)}</b></td>
      <td class="n">${rs(it.pctPer * it.valor['QPC'])}</td><td class="n">${rs(it.pct * it.valor['QPC'])}</td><td class="n">${rs(it.pctPer * it.valor['RÓTULA'])}</td><td class="n">${rs(it.pct * it.valor['RÓTULA'])}</td></tr>`;
    if (aberto) it.ats.forEach(x => {
      h += `<tr class="linha-ativ"><td class="sub-ativ">${esc(x.a.atividade)}</td><td class="n">${nf(x.a.qtd, 1)} ${esc(x.a.unidade)}</td><td class="n">${nf(x.real - x.realAnt, 1)}</td><td class="n">${nf(x.real, 1)}</td>
        <td class="n">${pc((x.a.peso || 0) / it.somaPesos)}</td><td colspan="2"></td><td class="n ${x.real > x.a.qtd ? 'valor-neg' : ''}">${pc(x.pct)}</td><td colspan="4"></td></tr>`;
    });
  });
  h += `</tbody><tfoot><tr><td><b>Total do contrato</b></td><td></td><td></td><td></td><td></td><td class="n">${pc(r.tot['RÓTULA'].ant / (r.tot['RÓTULA'].contrato || 1))}</td><td class="n">${pc(r.tot['RÓTULA'].pctPer)}</td><td class="n"><b>${pc(r.tot['RÓTULA'].pctAcum)}</b></td>
    <td class="n">${rs(r.tot['QPC'].per)}</td><td class="n">${rs(r.tot['QPC'].acum)}</td><td class="n">${rs(r.tot['RÓTULA'].per)}</td><td class="n">${rs(r.tot['RÓTULA'].acum)}</td></tr></tfoot></table></div></div>`;

  const dd = r.ded;
  h += `<div class="bloco"><div class="bloco-cab"><h2>Deduções e valor a faturar</h2><span class="nota">Equipamentos e combustível vêm de "Uso de equipamentos" no período; empresa compartilhada (EJ/CMM) divide o custo. Descontados do contrato ${BM_DESCONTA_EQUIP}.</span></div>
    <div class="tabela-rolagem"><table><thead><tr><th>Descrição</th><th class="n">QPC</th><th class="n">RÓTULA</th></tr></thead><tbody>
    <tr><td><b>Medido no período</b></td><td class="n">${rs(r.tot['QPC'].per)}</td><td class="n">${rs(r.tot['RÓTULA'].per)}</td></tr>` +
    (Math.abs(ajQ) + Math.abs(ajR) > 0.5 ? `<tr class="linha-info"><td>↳ dos quais ajuste de períodos anteriores</td><td class="n">${rs(ajQ)}</td><td class="n">${rs(ajR)}</td></tr>` : '') + `
    <tr><td>(−) Equipamentos <span class="nota">${dd.usos == null ? 'valor do fechamento' : dd.usos + ' lançamento(s)'}</span></td><td class="n">—</td><td class="n">${rs(dd.equip)}</td></tr>
    <tr><td>(−) Combustível <span class="nota">${nf(dd.litros, 1)} L</span></td><td class="n">—</td><td class="n">${rs(dd.comb)}</td></tr>` +
    dd.manuais.map(d => `<tr><td>(−) ${esc(cap(d.tipo || 'Outros'))}: ${esc(d.descricao || '')} <span class="nota">${d.data ? fdA(d.data) : ''}</span> <button class="link" data-editar-reg="bm_deducoes" data-linha="${d.linha}">Editar</button></td>
      <td class="n">${d.contrato === 'RÓTULA' ? '—' : rs(d.valor)}</td><td class="n">${d.contrato === 'QPC' ? '—' : rs(d.valor)}</td></tr>`).join('') +
    `</tbody><tfoot><tr><td><b>Valor a faturar</b></td><td class="n"><b>${rs(r.faturar['QPC'])}</b></td><td class="n"><b>${rs(r.faturar['RÓTULA'])}</b></td></tr></tfoot></table></div></div>`;
  box.innerHTML = h;

  const ev = bmEvolucao(emp);
  if (ev.length) trocarGrafico('gBM', {
    type: 'line',
    data: { labels: ev.map(x => fd(x.dia)), datasets: [
      { label: 'RÓTULA', data: ev.map(x => +x['RÓTULA'].toFixed(2)), borderColor: corEmpHex(emp), backgroundColor: corEmpHex(emp), tension: .25, pointRadius: 2 },
      { label: 'QPC', data: ev.map(x => +x['QPC'].toFixed(2)), borderColor: cor('--fg3'), backgroundColor: cor('--fg3'), borderDash: [5, 4], tension: .25, pointRadius: 2 }] },
    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: x => `${x.dataset.label}: ${rs(x.raw)}` } } },
      scales: eixos({ ticks: { color: cor('--fg2'), callback: v => 'R$ ' + nf(v / 1000) + ' mil' } }) },
  });
}

function renderBMPeriodos(box) {
  const emp = bmEmp;
  const ps = bmTab('bm_periodos').filter(p => p.empresa === emp).sort((a, b) => String(a.corte).localeCompare(String(b.corte)));
  const ds = bmTab('bm_deducoes').filter(d => d.empresa === emp).sort((a, b) => String(b.data).localeCompare(String(a.data)));
  box.innerHTML = `<div class="grade-2">
    <div class="bloco"><div class="bloco-cab"><h2>Períodos de medição (BM)</h2><button class="btn primario" data-novo="bm_periodos">+ Período</button></div>
      <p class="nota">O período de cada BM vai do dia seguinte ao corte anterior até a data de corte. O que for lançado depois do último corte fica no BM em aberto.</p>
      <div class="tabela-rolagem"><table><thead><tr><th>BM</th><th>Data de corte</th><th>Situação</th><th>Observação</th><th></th></tr></thead><tbody>` +
    (ps.length ? ps.map(p => { const f = bmFech(emp, p.bm); return `<tr><td><b>BM${p.bm ?? ''}</b></td><td>${fdA(p.corte)}</td><td>${f ? `<span class="farol f-verde">Fechado ${fdA(f.fechado_em)}</span>` : '<span class="farol f-amarelo">Em aberto</span>'}</td><td class="sub">${esc(p.obs || '')}</td><td>${f ? '<span class="nota">reabra para editar</span>' : `<button class="link" data-editar-reg="bm_periodos" data-linha="${p.linha}">Editar</button>`}</td></tr>`; }).join('')
      : '<tr><td colspan="5" class="vazio">Nenhum corte cadastrado. Ex.: BM1 da EJ em 03/09/2026.</td></tr>') +
    `</tbody></table></div></div>
    <div class="bloco"><div class="bloco-cab"><h2>Deduções manuais</h2><button class="btn primario" data-novo="bm_deducoes">+ Dedução</button></div>
      <p class="nota">Adiantamento, refeição fornecida no canteiro e outros descontos. Equipamentos e combustível entram sozinhos, a partir dos lançamentos em Equipamentos.</p>
      <div class="tabela-rolagem"><table><thead><tr><th>Data</th><th>BM</th><th>Tipo</th><th>Descrição</th><th class="n">Valor</th><th>Contrato</th><th></th></tr></thead><tbody>` +
    (ds.length ? ds.map(d => `<tr><td>${fdA(d.data)}</td><td>${d.bm != null ? 'BM' + d.bm : '—'}</td><td>${esc(cap(d.tipo || ''))}</td><td>${esc(d.descricao || '')}</td><td class="n">${rs(d.valor)}</td><td>${esc(d.contrato || '')}</td>
      <td><button class="link" data-editar-reg="bm_deducoes" data-linha="${d.linha}">Editar</button></td></tr>`).join('')
      : '<tr><td colspan="7" class="vazio">Nenhuma dedução manual.</td></tr>') + `</tbody></table></div></div></div>`;
}

function renderBMCatalogo(box) {
  const its = bmItens(bmEmp, ref);
  let h = `<div class="bloco"><div class="bloco-cab"><h2>Catálogo de atividades — ${esc(bmEmp)}</h2><div class="acoes"><button class="btn primario" data-novo="bm_atividades">+ Atividade</button></div></div>
    <p class="nota">Peso e quantidade vêm da memória de cálculo do BM. Atividades marcadas com "controle" são lançadas na mesma coluna da grade de produção.</p>
    <div class="tabela-rolagem"><table><thead><tr><th>Código</th><th>Atividade</th><th>Un.</th><th class="n">Quantidade</th><th class="n">Peso</th><th>Coluna no controle</th><th></th></tr></thead><tbody>`;
  its.forEach(it => {
    h += `<tr class="grupo-item"><td colspan="3"><b>${esc(it.item)}</b> ${esc(cap(it.desc))}</td><td class="n" colspan="2">QPC ${rs(it.valor['QPC'])} · RÓTULA ${rs(it.valor['RÓTULA'])}</td>
      <td colspan="2">${it.pesosAjustados ? `<span class="farol f-amarelo">pesos somam ${nf(it.somaPesos * 100, 1)}%</span>` : ''}</td></tr>`;
    it.ats.forEach(x => h += `<tr><td class="nota">${esc(x.a.codigo)}</td><td>${esc(x.a.atividade)}</td><td>${esc(x.a.unidade)}</td><td class="n">${nf(x.a.qtd, 2)}</td><td class="n">${nf((x.a.peso || 0) * 100, 1)}%</td>
      <td>${esc(x.a.controle || '')}</td><td><button class="link" data-editar-reg="bm_atividades" data-linha="${x.a.linha}">Editar</button></td></tr>`);
  });
  box.innerHTML = h + '</tbody></table></div></div>';
}

async function fecharBM() {
  const emp = bmEmp, p = bmPeriodos(emp).find(x => x.chave === bmPerSel);
  if (!p || !p.cortado || p.fechado) return;
  const its = bmItens(emp, p.fim), d = bmDeducoes(emp, p);
  const atividades = its.flatMap(it => it.ats.map(x => ({ codigo: x.a.codigo, item: it.item, realizado: x.real, qtd: x.a.qtd, peso: x.a.peso, valor_qpc: it.valor['QPC'], valor_rotula: it.valor['RÓTULA'] })));
  try {
    await postar(API + 'bm/fechar', { empresa: emp, bm: p.n, fechado_em: hoje(), equip: d.equip, comb: d.comb, litros: d.litros, atividades });
    await carregar();
    toast(`BM${p.n} fechado: valores congelados`);
  } catch (err) { toast(err.message, true); renderBM(); }
}

async function reabrirBM() {
  const emp = bmEmp, p = bmPeriodos(emp).find(x => x.chave === bmPerSel);
  if (!p || !p.fechado) return;
  try {
    await postar(API + 'bm/reabrir', { empresa: emp, bm: p.n });
    await carregar();
    toast(`BM${p.n} reaberto`);
  } catch (err) { toast(err.message, true); renderBM(); }
}

async function semearBM() {
  try { const r = await postar(API + 'bm/semear', {}); await carregar(); toast(r.atividades ? `${r.atividades} atividades carregadas` : 'O catálogo já estava carregado'); }
  catch (err) { toast(err.message, true); }
}

async function semearMateriais() {
  try {
    const r = await postar(API + 'estoque/semear-materiais', {});
    await carregar();
    if (r.materiais_criados) toast(`${r.materiais_criados} materiais cadastrados: ${r.codigos.join(', ')}`, false, 5000);
    else toast(r.msg || 'Todos os materiais do IFC já estão cadastrados.');
  } catch (err) { toast(err.message, true); }
}

// lançamento por serviço (linha por atividade do BM dentro do Lançamentos)
function bmQtdSalva(emp, cod, d) {
  const r = bmTab('bm_apontamentos').find(x => x.empresa === emp && x.codigo === cod && x.data === d);
  return r && r.quantidade != null ? String(r.quantidade).replace('.', ',') : '';
}
function bmSomaSemana(a, ini, fim) {
  return soma0(bmTab('bm_apontamentos').filter(x => x.codigo === a.codigo && x.data >= ini && x.data <= fim), x => x.quantidade);
}

function renderLancServico(e) {
  const its = bmItens(e.nome, ref);
  if (!its.length) { $('#tabLanc').innerHTML = '<tbody><tr><td class="vazio">Não há atividades do BM cadastradas para esta empresa (aba Medição (BM) → Catálogo).</td></tr></tbody>'; return; }
  const s = segunda(ref), dias = [0, 1, 2, 3, 4, 5, 6].map(i => add(s, i)), noCal = new Set(M.datas);
  const fechados = bmPeriodos(e.nome).filter(p => p.fechado);
  const marca = d => { const f = fechados.find(p => d >= p.ini && d <= p.fim); return f ? `data-fechado="${f.n}" title="Período do BM${f.n}, já fechado: a correção entra como ajuste no BM em aberto"` : ''; };
  $('#tabLanc').className = 'por-servico';
  let h = '<colgroup><col style="width:340px"><col style="width:64px"><col style="width:96px">' + '<col style="width:78px">'.repeat(7) + '<col style="width:84px"><col style="width:90px"><col style="width:70px"></colgroup><thead><tr><th class="fixa">Serviço (atividade do BM)</th><th>Un.</th><th class="n">Contratado</th>' +
    dias.map((d, i) => `<th class="n ${i >= 5 ? 'fds' : ''} ${d === ref ? 'hoje' : ''}">${DIAS[i]}<br>${fd(d)}</th>`).join('') + '<th class="n">Semana</th><th class="n">Acumulado</th><th class="n">%</th></tr></thead><tbody>';
  its.forEach(it => {
    h += `<tr class="grupo-item"><td class="fixa" colspan="3"><b>${esc(it.item)}</b> ${esc(cap(it.desc))} ${it.pesosAjustados ? '<span class="farol f-amarelo" title="Os pesos das atividades não somam 100%">pesos ≠ 100%</span>' : ''}</td><td colspan="9"></td><td class="n"><b>${nf(it.pct * 100, 1)}%</b></td></tr>`;
    it.ats.forEach(({ a, real, pct }) => {
      const ctl = a.controle ? colDe(e, a.controle) : null;
      const semana = ctl ? soma(e, ctl, s, add(s, 6)) : bmSomaSemana(a, s, add(s, 6));
      h += `<tr><td class="fixa sub-ativ">${esc(a.atividade)}${ctl ? ' <span class="nota" title="Este serviço também aparece na grade da semana">↔ grade</span>' : ''}</td><td>${esc(a.unidade)}</td><td class="n">${nf(a.qtd, 1)}</td>`;
      dias.forEach((d, i) => {
        if (ctl) {
          const k = chave(e.aba, d, ctl), v = pend.has(k) ? pend.get(k) : textoSalvo(e, d, ctl);
          h += `<td><input class="num ${pend.has(k) ? 'editado' : ''}" data-d="${d}" data-c="${ctl}" value="${esc(v)}" ${noCal.has(d) ? '' : 'disabled'} ${marca(d)} inputmode="decimal" aria-label="${esc(a.atividade)} ${DIAS[i]} ${fd(d)}"></td>`;
        } else {
          const k = bmChave(e.nome, a.codigo, d), v = bmPend.has(k) ? bmPend.get(k) : bmQtdSalva(e.nome, a.codigo, d);
          h += `<td><input class="num ${bmPend.has(k) ? 'editado' : ''}" data-bm="1" data-cod="${esc(a.codigo)}" data-d="${d}" value="${esc(v)}" ${marca(d)} inputmode="decimal" aria-label="${esc(a.atividade)} ${DIAS[i]} ${fd(d)}"></td>`;
        }
      });
      h += `<td class="n">${nf(semana, 1)}</td><td class="n">${nf(real, 1)}</td><td class="n ${real > a.qtd ? 'valor-neg' : ''}">${nf(pct * 100, 1)}%</td></tr>`;
    });
  });
  $('#tabLanc').innerHTML = h + '</tbody>';
}

// ------------------------------------------------------------ FORMULÁRIO GENÉRICO (cadastros)
const FORMS = {
  materiais: { tit: 'material', campos: [
    ['material', 'Material', 'text', 1], ['codigo', 'Código (automático se vazio)', 'text'], ['unidade', 'Unidade (pç, kg, m², m)', 'text', 1],
    ['servico', 'Serviço vinculado', 'servico'], ['empresa', 'Empresa (vazio = todas)', 'empresa'], ['coef', 'Consumo por unidade de serviço', 'num'],
    ['saldo_inicial', 'Saldo inicial', 'num'], ['data_saldo', 'Data do saldo inicial', 'date'], ['minimo', 'Estoque mínimo', 'num'],
    ['fornecedor', 'Fornecedor', 'text'], ['prazo_reposicao', 'Prazo de reposição (dias úteis)', 'num'], ['obs', 'Observação', 'text', 0, 'largo']] },
  movimentos: { tit: 'movimentação', campos: [
    ['data', 'Data', 'date', 1], ['codigo', 'Material', 'material', 1], ['tipo', 'Tipo', 'select:ENTRADA,SAÍDA,AJUSTE', 1],
    ['quantidade', 'Quantidade (ajuste aceita negativo)', 'num', 1], ['documento', 'Documento (NF / romaneio)', 'text'], ['empresa', 'Empresa', 'empresa'],
    ['obs', 'Observação', 'text', 0, 'largo']] },
  equipamentos: { tit: 'equipamento', campos: [
    ['equipamento', 'Equipamento', 'text', 1], ['tipo', 'Tipo (guindaste, PTA, munck…)', 'text'], ['locadora', 'Locadora / proprietário', 'text'],
    ['cobranca', 'Cobrança', 'select:,DIÁRIA,HORA,TURNO,MENSAL'], ['valor', 'Valor unitário (R$)', 'num'], ['consumo_lh', 'Consumo estimado (L/h)', 'num'],
    ['situacao', 'Situação', 'select:ATIVO,MANUTENÇÃO,DESMOBILIZADO'], ['obs', 'Observação', 'text', 0, 'largo']] },
  usos: { tit: 'uso / abastecimento', campos: [
    ['data', 'Data', 'date', 1], ['equipamento', 'Equipamento', 'equipamento', 1], ['empresa', 'Empresa (EJ/CMM divide o custo)', 'empresa', 1],
    ['uso', 'Uso', 'select:DIÁRIA,TURNO,MEIO TURNO,HORAS,ABASTECIMENTO,NÃO USO', 1], ['quantidade', 'Qtd (diárias ou horas)', 'num'],
    ['custo', 'Custo do equipamento (R$)', 'num'], ['litros', 'Combustível (L)', 'num'], ['preco_litro', 'Preço do litro (R$)', 'num'],
    ['custo_combustivel', 'Custo combustível (R$) — calculado se vazio', 'num'], ['operador', 'Operador', 'text'], ['obs', 'Observação', 'text', 0, 'largo']] },
  bm_periodos: { tit: 'período de medição (BM)', campos: [
    ['empresa', 'Empresa', 'empresa', 1], ['bm', 'Nº do BM', 'num', 1], ['corte', 'Data de corte', 'date', 1], ['obs', 'Observação', 'text', 0, 'largo']] },
  bm_deducoes: { tit: 'dedução do BM', campos: [
    ['empresa', 'Empresa', 'empresa', 1], ['bm', 'Nº do BM (vazio = pela data)', 'num'], ['data', 'Data', 'date', 1],
    ['tipo', 'Tipo', 'select:ADIANTAMENTO,REFEIÇÃO,EQUIPAMENTO,COMBUSTÍVEL,OUTROS', 1], ['valor', 'Valor a deduzir (R$)', 'num', 1],
    ['contrato', 'Contrato', 'select:RÓTULA,QPC,AMBOS', 1], ['descricao', 'Descrição', 'text', 0, 'largo']] },
  bm_atividades: { tit: 'atividade do catálogo do BM', campos: [
    ['codigo', 'Código (único)', 'text', 1], ['empresa', 'Empresa', 'empresa', 1], ['item', 'Item do BM (ex.: 3.1.1)', 'text', 1],
    ['item_desc', 'Descrição do item', 'text', 1, 'largo'], ['atividade', 'Atividade (serviço)', 'text', 1, 'largo'], ['unidade', 'Unidade', 'text', 1],
    ['qtd', 'Quantidade contratada', 'num', 1], ['peso', 'Peso no item (0 a 1)', 'num', 1], ['valor_qpc', 'Valor do item QPC (R$)', 'num'],
    ['valor_rotula', 'Valor do item RÓTULA (R$)', 'num'], ['controle', 'Coluna no controle de produção (nome do serviço)', 'text'],
    ['obs', 'Observação', 'text', 0, 'largo']] },
  estoque_eventos: { tit: 'evento de produção (baixa por IFC)', campos: [
    ['data', 'Data', 'date', 1],
    ['tipo', 'Tipo', 'select:VIGA_APOIO_MONTADA,VIGA_INTERM_MONTADA,JOIST_ICADA', 1],
    ['empresa', 'Empresa', 'empresa'],
    ['eixo', 'Eixo (para viga) — ex.: 11', 'text'],
    ['letra', 'Letra (A, B, BC, C, CD, D, DE, E, F, FG, G, H)', 'text'],
    ['rua', 'Rua (para joist) — ex.: 11-12', 'text'],
    ['faixa', 'Faixa (AB, BC, CD, DE, EF, FG, GH) — opcional (derivado da letra)', 'text'],
    ['n_joists', 'Qtd de joists (0 a 6, para JOIST_ICADA)', 'num'],
    ['viga_id', 'ID da viga (opcional, para VIGA_*)', 'text'],
    ['obs', 'Observação / nº RDO', 'text', 0, 'largo']] },
  estoque_remessas: { tit: 'remessa de material', campos: [
    ['data', 'Data', 'date', 1], ['codigo', 'Código do material (ex.: FG005)', 'text', 1],
    ['descricao', 'Descrição', 'text', 0, 'largo'], ['quantidade', 'Quantidade', 'num', 1],
    ['documento', 'Nº NF / romaneio', 'text'], ['fornecedor', 'Fornecedor', 'text'],
    ['obs', 'Observação', 'text', 0, 'largo']] },
  estoque_inventario: { tit: 'contagem de inventário', campos: [
    ['data', 'Data', 'date', 1], ['codigo', 'Código do material', 'text', 1],
    ['quantidade', 'Quantidade contada', 'num', 1], ['responsavel', 'Responsável', 'text'],
    ['obs', 'Observação', 'text', 0, 'largo']] },
  est_planilha_remessa: { tit: 'item na remessa', endpoint: 'estoque-planilha/remessa', campos: [
    ['remessa', 'Nome/Nº da remessa', 'text', 1],
    ['tag', 'TAG do material', 'text', 1],
    ['quantidade', 'Quantidade', 'num', 1]] },
  est_planilha_consumo: { tit: 'consumo físico semanal', endpoint: 'estoque-planilha/consumo', campos: [
    ['semana', 'Semana (ex: 14/08 a 18/08)', 'text', 1],
    ['tag', 'TAG do material', 'text', 1],
    ['empresa', 'Empresa', 'select:,EJ,CMM', 1],
    ['quantidade', 'Quantidade consumida', 'num', 1]] },
};

function abrirDialogo(tabela, linha, preset = {}) {
  const def = FORMS[tabela];
  const reg = linha ? T[tabela].find(r => r.linha === linha) : null;
  const dados = { ...(reg || {}), ...preset };
  if (!reg && !dados.data && def.campos.some(c => c[0] === 'data')) dados.data = minD(ref, hoje());
  const dlg = $('#dlg');
  dlg.dataset.tabela = tabela; dlg.dataset.linha = linha || '';
  $('#dlgTit').textContent = (reg ? 'Editar ' : 'Novo(a) ') + def.tit;
  $('#dlgCampos').innerHTML = def.campos.map(([k, rot, tipo, obrig, cls]) => {
    const v = dados[k] ?? '';
    const req = obrig ? 'required' : '';
    let inp;
    if (tipo.startsWith('select:')) inp = `<select name="${k}" ${req}>${tipo.slice(7).split(',').map(o => `<option ${String(v) === o ? 'selected' : ''} value="${esc(o)}">${esc(o || '—')}</option>`).join('')}</select>`;
    else if (tipo === 'material') inp = `<select name="${k}" ${req}>${T.materiais.map(m => `<option value="${esc(m.codigo)}" ${m.codigo === v ? 'selected' : ''}>${esc(m.codigo)} — ${esc(m.material)}</option>`).join('')}</select>`;
    else {
      const lista = { servico: 'listaServicos', empresa: 'listaEmpresas', equipamento: 'listaEquip' }[tipo];
      const t = tipo === 'date' ? 'date' : 'text';
      inp = `<input name="${k}" type="${t}" ${lista ? `list="${lista}"` : ''} ${tipo === 'num' ? 'inputmode="decimal"' : ''} value="${esc(tipo === 'num' && v !== '' ? String(v).replace('.', ',') : v)}" ${req}>`;
    }
    return `<label class="${cls || ''}"><span class="${obrig ? 'obrig' : ''}">${rot}</span>${inp}</label>`;
  }).join('');
  $('#dlgExcluir').hidden = !reg;
  $('#dlgExcluir').dataset.confirmar = '';
  $('#dlgExcluir').textContent = 'Excluir';
  if (tabela === 'movimentos' && !T.materiais.length) { toast('Cadastre um material antes de movimentar.', true); return; }
  dlg.showModal();
  patchDatas();
}

function autoCustoUso(form) {
  if (form.closest('dialog').dataset.tabela !== 'usos') return;
  const eq = T.equipamentos.find(e => e.equipamento === form.elements.equipamento.value.trim().toUpperCase() || e.equipamento === form.elements.equipamento.value.trim());
  const uso = form.elements.uso.value;
  const custo = form.elements.custo;
  if (!eq || !eq.valor || custo.dataset.manual) return;
  const fator = { 'DIÁRIA': 1, 'TURNO': 1, 'MEIO TURNO': 0.5, 'HORAS': null, 'ABASTECIMENTO': 0, 'NÃO USO': 0 }[uso];
  const qtd = Number(String(form.elements.quantidade.value || '1').replace(',', '.')) || 1;
  let v = null;
  if (uso === 'HORAS' && eq.cobranca === 'HORA') v = eq.valor * qtd;
  else if (fator != null && eq.cobranca !== 'HORA') v = eq.valor * fator * (uso === 'DIÁRIA' ? qtd : 1);
  if (v != null) custo.value = String(+v.toFixed(2)).replace('.', ',');
}

async function salvarDialogo(ev) {
  ev.preventDefault();
  const dlg = $('#dlg'), f = $('#dlgForm');
  const tabela = dlg.dataset.tabela, linha = dlg.dataset.linha ? +dlg.dataset.linha : null;
  const campos = {};
  FORMS[tabela].campos.forEach(([k, , tipo]) => {
    let v = f.elements[k].value.trim();
    if (tipo === 'num' && v && v.includes(',')) v = v.replace(/\./g, '').replace(',', '.');
    if (['text', 'empresa', 'equipamento', 'servico'].includes(tipo) && !['obs', 'material', 'atividade', 'item_desc', 'descricao', 'unidade'].includes(k)) v = v.toUpperCase();
    campos[k] = v || null;
  });
  try {
    const def = FORMS[tabela];
    if (def.endpoint) {
      await postar(API + def.endpoint, campos);
      dlg.close();
      const j = await fetch(API + 'estoque-planilha', { cache: 'no-store' }).then(r => r.ok ? r.json() : null);
      if (j) EP = j;
      renderEstoquePlanilha();
    } else {
      await postar(API + 'registro', { tabela, linha, campos });
      dlg.close();
      await carregar();
    }
    toast(`Salvo ${ONDE}`);
  } catch (err) { toast(err.message, true); }
}

async function excluirDialogo() {
  const b = $('#dlgExcluir'), dlg = $('#dlg');
  if (!b.dataset.confirmar) { b.dataset.confirmar = '1'; b.textContent = 'Confirmar exclusão'; return; }
  try {
    await postar(API + 'registro', { tabela: dlg.dataset.tabela, linha: +dlg.dataset.linha, excluir: true });
    dlg.close();
    await carregar();
    toast('Registro excluído da planilha');
  } catch (err) { toast(err.message, true); }
}

// ------------------------------------------------------------ METAS
function renderMetas() {
  const ms = metasSemana(ref);
  let h = `<thead><tr><th>Empresa</th><th>Serviço</th><th>Semana</th><th class="n">Meta/dia</th><th class="n">Dias úteis</th><th class="n">GAP anterior</th><th class="n">Meta ajustada</th><th class="n">Realizado</th><th>Farol</th></tr></thead><tbody>`;
  if (!ms.length) h += `<tr><td colspan="9" class="vazio">Sem metas cadastradas para a semana de ${fdA(segunda(ref))}.</td></tr>`;
  ms.forEach(m => {
    const p = metasPend.get(m.linha) || {};
    const md = p.meta_dia ?? m.meta_dia, du = p.du ?? m.du, gap = p.gap ?? m.gap;
    const k = kpi({ ...m, meta_dia: +md || 0, du: +du || 0, gap: +gap || 0 }, ref);
    const inp = (campo, v, orig) => `<input class="metas-in ${String(v) !== String(orig) ? 'editado' : ''}" type="number" step="any" min="${campo === 'gap' ? '' : 0}" data-linha="${m.linha}" data-campo="${campo}" value="${esc(v)}">`;
    h += `<tr><td><span class="emp-tag" style="--c:${corEmp(m.empresa)}">${esc(m.empresa)}</span></td><td>${esc(cap(m.servico))}</td><td class="nota">${fd(m.inicio)} a ${fd(m.fim)}</td>
      <td class="n">${inp('meta_dia', md, m.meta_dia)}</td><td class="n">${inp('du', du, m.du)}</td><td class="n">${inp('gap', gap, m.gap)}</td>
      <td class="n"><b>${nf(k.semana, 1)}</b></td><td class="n">${nf(k.realSemana, 1)}</td><td>${farolHtml(k.pct, k.semana === 0)}</td></tr>`;
  });
  $('#tabMetas').innerHTML = h + '</tbody>';
  $('#btnSalvarMetas').disabled = !metasPend.size;
}

async function salvarMetas() {
  if (!metasPend.size) return;
  const alteracoes = [];
  const propagar = $('#propagar').checked;
  metasPend.forEach((p, linha) => {
    alteracoes.push({ linha, ...p });
    if (propagar) {
      const m = M.metas.find(x => x.linha === linha);
      const futuro = { ...p }; delete futuro.gap;
      if (Object.keys(futuro).length)
        M.metas.filter(x => x.empresa === m.empresa && x.servico === m.servico && x.inicio > m.inicio)
          .forEach(x => alteracoes.push({ linha: x.linha, ...futuro }));
    }
  });
  try {
    const r = await postar(API + 'metas', { alteracoes });
    metasPend.clear();
    await carregar();
    toast(`Metas salvas ${ONDE} (${r.celulas} célula(s))`);
  } catch (err) { toast(err.message, true); }
}

// ------------------------------------------------------------ IMPACTOS
function renderImpactos() {
  const lista = M.impactos.filter(i => filtroImp === 'todos' || !i.solucionado)
    .sort((a, b) => String(b.data).localeCompare(String(a.data)));
  $('#tabImp').innerHTML = `<thead><tr><th>Data</th><th>Serviço</th><th>Motivo</th><th>Tempo</th><th>Quando</th><th>Paralisação / efeito</th><th>Situação</th><th></th></tr></thead><tbody>` +
    (lista.length ? lista.map(i => {
      const dias = ehISO(i.data) ? diasEntre(i.data, i.solucionado && ehISO(i.solucionado) ? i.solucionado : ref) : null;
      return `<tr><td>${fdA(i.data)}</td><td>${esc(cap(i.servico))}</td><td class="motivo">${esc(i.motivo)}</td><td>${esc(i.tempo)}</td><td>${ehISO(i.quando) ? fdA(i.quando) : esc(i.quando)}</td>
        <td class="motivo">${esc(i.paralisacao)}</td>
        <td>${i.solucionado ? `<span class="farol f-verde">SOLUCIONADO ${fd(i.solucionado)}</span>` : `<span class="farol f-vermelho">ABERTO${dias != null ? ` · ${dias}d` : ''}</span>`}</td>
        <td style="white-space:nowrap">${i.solucionado ? '' : `<button class="link" data-resolver="${i.linha}">Solucionar hoje</button> · `}<button class="link" data-editar="${i.linha}">Editar</button></td></tr>`;
    }).join('') : `<tr><td colspan="8" class="vazio">${filtroImp === 'abertos' ? 'Nenhum impacto em aberto.' : 'Nenhum impacto registrado.'}</td></tr>`) + '</tbody>';
}

function abrirFormImp(linha) {
  const f = $('#formImp');
  f.reset();
  f.dataset.linha = linha ?? '';
  $('#formImpTit').textContent = linha ? 'Editar impacto' : 'Novo impacto';
  $('#btnExcluirImp').hidden = !linha;
  $('#btnExcluirImp').dataset.confirmar = '';
  $('#btnExcluirImp').textContent = 'Excluir';
  if (linha) {
    const i = M.impactos.find(x => x.linha === linha);
    for (const k of ['data', 'servico', 'motivo', 'tempo', 'quando', 'paralisacao', 'solucionado']) {
      const v = i[k];
      if (f.elements[k].type === 'date') f.elements[k].value = ehISO(v) ? v : '';
      else f.elements[k].value = v ?? '';
    }
  } else {
    f.elements.data.value = ref;
  }
  f.hidden = false;
  f.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function salvarImpacto(corpo, msg) {
  try {
    await postar(API + 'impacto', corpo);
    await carregar();
    toast(msg);
    return true;
  } catch (err) { toast(err.message, true); return false; }
}

// ------------------------------------------------------------ TENDÊNCIAS (empresas por serviço)
function renderTendencia() {
  const sel = $('#selServ');
  const servicos = [...new Set(M.metas.map(m => m.servico))];
  if (sel.options.length !== servicos.length) {
    const atual = sel.value;
    sel.innerHTML = servicos.map(s => `<option value="${esc(s)}">${esc(cap(s))}</option>`).join('');
    if (servicos.includes(atual)) sel.value = atual;
  }
  const serv = sel.value;
  const ate = segunda(ref);
  const emps = [...new Set(M.metas.filter(m => m.servico === serv).map(m => m.empresa))];
  const semanas = [...new Set(M.metas.filter(m => m.servico === serv && m.inicio <= ate).map(m => m.inicio))].sort()
    .filter(s => M.metas.some(m => m.servico === serv && m.inicio === s && (metaSemanaTotal(m) > 0 || kpi(m, minD(m.fim, ref)).realSemana > 0)));
  const todasEmps = [...new Set(M.metas.map(m => m.empresa))];
  $('#legTend').innerHTML = todasEmps.map(n => `<span><i style="--c:${corEmp(n)}"></i>${esc(n)}</span>`).join('');
  $('#titAting').textContent = `Atingimento semanal por empresa — ${cap(serv)}`;
  $('#titProd').textContent = `Produção semanal por empresa — ${cap(serv)}`;

  const linhaDe = (n, s) => M.metas.find(m => m.empresa === n && m.servico === serv && m.inicio === s);
  trocarGrafico('gAting', {
    type: 'line',
    data: {
      labels: semanas.map(fd),
      datasets: emps.map(n => ({
        label: n,
        data: semanas.map(s => { const m = linhaDe(n, s); if (!m) return null; const k = kpi(m, minD(m.fim, ref)); return k.prevAte > 0 ? Math.round(k.real / k.prevAte * 100) : null; }),
        borderColor: corEmpHex(n), backgroundColor: corEmpHex(n), borderWidth: 2, pointRadius: 4, pointHoverRadius: 6, tension: 0, spanGaps: true,
      })),
    },
    options: {
      responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${c.raw == null ? 'sem meta' : c.raw + '%'}` } } },
      scales: eixos({ ticks: { color: cor('--fg2'), callback: v => v + '%' } }),
    },
  });

  trocarGrafico('gServ', {
    data: {
      labels: semanas.map(fd),
      datasets: [
        { type: 'line', label: 'Meta (soma das empresas)', data: semanas.map(s => soma0(emps.map(n => linhaDe(n, s)).filter(Boolean), metaSemanaTotal)), borderColor: cor('--fg2'), borderDash: [5, 4], borderWidth: 2, pointRadius: 0, stepped: 'middle', order: 0 },
        ...emps.map(n => ({ type: 'bar', label: n, data: semanas.map(s => { const m = linhaDe(n, s); return m ? kpi(m, m.fim).realSemana : 0; }), backgroundColor: corEmpHex(n), borderColor: cor('--card'), borderWidth: 1, borderRadius: 4, maxBarThickness: 22, order: 1 })),
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${nf(c.raw, 1)}` } } },
      scales: eixos(),
    },
  });

  const c = corte();
  $('#notaComp').textContent = `Realizado ÷ previsto de ${fdA(per.ini)} a ${fdA(c)} (use a barra de período)`;
  trocarGrafico('gComp', {
    type: 'bar',
    data: {
      labels: servicos.map(cap),
      datasets: todasEmps.map(n => ({
        label: n,
        data: servicos.map(s => { if (!M.metas.some(m => m.empresa === n && m.servico === s)) return null; const k = kpiPer(n, s, per.ini, per.fim, c); return k.pct == null ? null : Math.round(k.pct); }),
        backgroundColor: corEmpHex(n), borderColor: cor('--card'), borderWidth: 1, borderRadius: 4, maxBarThickness: 26,
      })),
    },
    options: {
      responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: x => `${x.dataset.label}: ${x.raw == null ? 'sem meta' : x.raw + '%'}` } } },
      scales: eixos({ ticks: { color: cor('--fg2'), callback: v => v + '%' } }),
    },
  });
}

// ------------------------------------------------------------ eventos
function ligarEventos() {
  $('#abas').addEventListener('click', ev => { const b = ev.target.closest('button[data-aba]'); if (b) { mudarAba(b.dataset.aba); const sb = document.getElementById('sidebar'); if (sb) sb.classList.remove('aberta'); } });
  document.querySelectorAll('.sidebar-titulo').forEach(t => t.addEventListener('click', () => {
    const grp = document.getElementById('grp-' + t.dataset.grupo);
    if (grp) { grp.classList.toggle('aberto'); t.classList.toggle('aberto'); }
  }));
  const sbToggle = document.getElementById('sidebarToggle');
  if (sbToggle) sbToggle.addEventListener('click', () => document.getElementById('sidebar').classList.toggle('aberta'));
  const estSub = document.getElementById('estSubAbas');
  if (estSub) estSub.addEventListener('click', ev => {
    const b = ev.target.closest('.sub-aba');
    if (!b) return;
    estSub.querySelectorAll('.sub-aba').forEach(x => x.classList.toggle('ativa', x === b));
    document.querySelectorAll('#aba-estoque > .sub-conteudo').forEach(d => d.hidden = d.id !== b.dataset.sub);
  });
  ['estMatFiltro', 'estMatEtapa', 'estMatStatus'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => renderEstMateriais());
  });
  const estRemF = document.getElementById('estRemFiltro');
  if (estRemF) estRemF.addEventListener('input', () => renderEstRemessas());
  const estConsF = document.getElementById('estConsFiltro');
  if (estConsF) estConsF.addEventListener('input', () => renderEstConsumo());
  ['estInvFiltro', 'estInvStatus'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => renderEstInventario());
  });
  const btnRem = document.getElementById('btnNovaRemessa');
  if (btnRem) btnRem.addEventListener('click', () => abrirDialogo('est_planilha_remessa'));
  const btnCons = document.getElementById('btnNovoConsumo');
  if (btnCons) btnCons.addEventListener('click', () => abrirDialogo('est_planilha_consumo'));

  $('#refData').addEventListener('change', ev => definirRef(ev.target.value));
  $('#semAnt').onclick = () => definirRef(add(ref, -7));
  $('#semProx').onclick = () => definirRef(add(ref, 7));
  $('#btnHoje').onclick = () => definirRef(hoje());
  $('#perIni').addEventListener('change', () => definirPeriodo($('#perIni').value, $('#perFim').value, null));
  $('#perFim').addEventListener('change', () => definirPeriodo($('#perIni').value, $('#perFim').value, null));
  $('#perAtalhos').addEventListener('click', ev => { const b = ev.target.closest('button[data-p]'); if (b) atalhoPeriodo(b.dataset.p); });

  document.addEventListener('click', ev => {
    const lanc = ev.target.closest('[data-ir-lanc]');
    if (lanc) { empSel = lanc.dataset.irLanc; mudarAba('lanc'); }
    const ir = ev.target.closest('[data-ir-aba]');
    if (ir) mudarAba(ir.dataset.irAba);
    const novo = ev.target.closest('[data-novo]');
    if (novo) abrirDialogo(novo.dataset.novo, null, novo.dataset.novo.startsWith('bm_') && bmEmp ? { empresa: bmEmp } : {});
    const ed = ev.target.closest('[data-editar-reg]');
    if (ed) abrirDialogo(ed.dataset.editarReg, +ed.dataset.linha);
    const mv = ev.target.closest('[data-mov]');
    if (mv) abrirDialogo('movimentos', null, { codigo: mv.dataset.mov, tipo: 'ENTRADA' });
    if (ev.target.id === 'btnSemearMat') semearMateriais();
  });

  $('#segEmpresas').addEventListener('click', ev => { const b = ev.target.closest('button[data-emp]'); if (b) { empSel = b.dataset.emp; renderLanc(); } });
  const tab = $('#tabLanc');
  tab.addEventListener('input', ev => { if (ev.target.matches('input')) aoEditarLanc(ev.target); });
  tab.addEventListener('keydown', ev => {
    const inp = ev.target;
    if (!inp.matches('input')) return;
    const passo = ev.key === 'Enter' || ev.key === 'ArrowDown' ? 1 : ev.key === 'ArrowUp' ? -1 : 0;
    if (!passo) return;
    ev.preventDefault();
    const todos = [...tab.querySelectorAll(lancModo === 'servico' ? `input[data-d="${inp.dataset.d}"]:not(:disabled)` : `input[data-c="${inp.dataset.c}"]:not(:disabled)`)];
    const prox = todos[todos.indexOf(inp) + passo];
    if (prox) { prox.focus(); prox.select(); }
  });
  $('#segLancModo').addEventListener('click', ev => { const b = ev.target.closest('button[data-modo]'); if (b) { lancModo = b.dataset.modo; renderLanc(); } });
  $('#aba-bm').addEventListener('click', ev => {
    const emp = ev.target.closest('[data-bm-emp]'); if (emp) { bmEmp = emp.dataset.bmEmp; bmPerSel = null; return renderBM(); }
    const sub = ev.target.closest('[data-bm-sub]'); if (sub) { bmSub = sub.dataset.bmSub; return renderBM(); }
    const it = ev.target.closest('[data-bm-item]'); if (it) { const k = it.dataset.bmItem; bmAbertos.has(k) ? bmAbertos.delete(k) : bmAbertos.add(k); return renderBM(); }
    if (ev.target.closest('[data-bm-semear]')) return semearBM();
    const bf = ev.target.closest('[data-bm-fechar], [data-bm-reabrir]');
    if (bf) {
      if (!bf.dataset.confirmar) { bf.dataset.confirmar = '1'; bf.textContent = 'Confirmar ' + (bf.hasAttribute('data-bm-fechar') ? 'fechamento' : 'reabertura'); return; }
      bf.hasAttribute('data-bm-fechar') ? fecharBM() : reabrirBM();
    }
  });
  $('#aba-bm').addEventListener('change', ev => { if (ev.target.id === 'selBmPer') { bmPerSel = ev.target.value; renderBM(); } });
  $('#btnSalvar').onclick = salvarLanc;
  $('#btnDescartar').onclick = () => { pend.clear(); bmPend.clear(); atualizarPendentes(); renderLanc(); verificarVersao(); };
  document.addEventListener('keydown', ev => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 's' && !$('#dlg').open) {
      ev.preventDefault();
      if (abaAtual === 'metas') salvarMetas(); else salvarLanc();
    }
  });
  window.addEventListener('beforeunload', ev => { if (pend.size || bmPend.size || metasPend.size) { ev.preventDefault(); ev.returnValue = ''; } });

  $('#tabMetas').addEventListener('change', ev => {
    const inp = ev.target; if (!inp.dataset.linha) return;
    const linha = +inp.dataset.linha, m = M.metas.find(x => x.linha === linha);
    const p = { ...(metasPend.get(linha) || {}) };
    const v = inp.value === '' ? 0 : Number(inp.value);
    if (v === m[inp.dataset.campo]) delete p[inp.dataset.campo]; else p[inp.dataset.campo] = v;
    if (Object.keys(p).length) metasPend.set(linha, p); else metasPend.delete(linha);
    renderMetas();
  });
  $('#btnSalvarMetas').onclick = salvarMetas;

  $('#filtroImp').addEventListener('click', ev => {
    const b = ev.target.closest('button[data-f]'); if (!b) return;
    filtroImp = b.dataset.f;
    document.querySelectorAll('#filtroImp button').forEach(x => x.classList.toggle('ativa', x === b));
    renderImpactos();
  });
  $('#btnNovoImp').onclick = () => abrirFormImp(null);
  $('#btnCancelarImp').onclick = () => $('#formImp').hidden = true;
  $('#tabImp').addEventListener('click', async ev => {
    const ed = ev.target.closest('[data-editar]');
    if (ed) abrirFormImp(+ed.dataset.editar);
    const rsv = ev.target.closest('[data-resolver]');
    if (rsv) await salvarImpacto({ linha: +rsv.dataset.resolver, solucionado: hoje() }, 'Impacto marcado como solucionado');
  });
  $('#formImp').addEventListener('submit', async ev => {
    ev.preventDefault();
    const f = ev.target, corpo = {};
    for (const k of ['data', 'servico', 'motivo', 'tempo', 'quando', 'paralisacao', 'solucionado']) corpo[k] = f.elements[k].value.trim() || null;
    if (corpo.servico) corpo.servico = corpo.servico.toUpperCase();
    if (f.dataset.linha) corpo.linha = +f.dataset.linha;
    if (await salvarImpacto(corpo, f.dataset.linha ? `Impacto atualizado ${ONDE}` : `Impacto registrado ${ONDE}`)) f.hidden = true;
  });
  $('#btnExcluirImp').onclick = async ev => {
    const b = ev.currentTarget;
    if (!b.dataset.confirmar) { b.dataset.confirmar = '1'; b.textContent = 'Confirmar exclusão'; return; }
    if (await salvarImpacto({ linha: +$('#formImp').dataset.linha, excluir: true }, 'Impacto excluído')) $('#formImp').hidden = true;
  };

  $('#dlgForm').addEventListener('submit', salvarDialogo);
  $('#dlgFechar').onclick = $('#dlgCancelar').onclick = () => $('#dlg').close();
  $('#dlgExcluir').onclick = excluirDialogo;
  $('#dlg').addEventListener('close', () => setTimeout(() => { document.activeElement?.blur(); document.querySelectorAll('.tabela-rolagem').forEach(e => e.scrollLeft = 0); document.querySelectorAll('.scroll-topo').forEach(e => e.scrollLeft = 0); }));
  $('#dlgForm').addEventListener('input', ev => {
    if (ev.target.name === 'custo') ev.target.dataset.manual = ev.target.value ? '1' : '';
    if (['equipamento', 'uso', 'quantidade'].includes(ev.target.name)) autoCustoUso(ev.currentTarget);
  });
  $('#btnImportarEq').onclick = importarEquip;
  $('#btnCopiarCli').onclick = copiarResumo;

  $('#selServ').addEventListener('change', renderTendencia);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', renderAba);
  window.addEventListener('resize', () => requestAnimationFrame(syncScrollTopo));
}

// ------------------------------------------------------------ início
(async function iniciar() {
  ref = hoje();
  ligarEventos();
  let aba = 'painel';
  try { aba = localStorage.getItem('obra198_aba') || 'painel'; } catch { }
  $('#refData').value = ref;
  const s = segunda(ref);
  per = { ini: s, fim: add(s, 6) };
  try { await carregar(); definirRef(ref); }
  catch (err) { $('#pontoSync').className = 'ponto erro'; $('#arquivoTxt').textContent = err.message; }
  patchDatas();
  mudarAba(document.getElementById('aba-' + aba) ? aba : 'painel');
  setInterval(verificarVersao, 4000);
})();
