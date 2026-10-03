'use strict';

// ------------------------------------------------------------ estado
let D = null;            // resposta de /api/dados
let M = null;            // modelo da planilha
let T = null;            // tabelas do sistema (estoque, equipamentos)
let ref = null;          // data de referência / corte
let per = null;          // período do painel {ini, fim}
let painelEmpFiltro = null; // null = Geral (todas), string = nome da empresa
let faseFiltro = '';        // '' = Total, '1' = Fase 1 (Galpão F1), '2' = Fase 2 (Anexos)
let abaAtual = 'painel';
let empSel = null;
let filtroImp = 'abertos';
const pend = new Map();  // `${aba}|${data}|${col}` -> texto digitado
const metasPend = new Map(); // linha -> {meta_dia, du, gap}
const planoPend = new Map(); // 'emp|serv' -> meta_dia digitada
const graficos = {};
let EP = null;           // dados de estoque da planilha (/api/estoque-planilha)
let salvando = false;

const DIAS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const COR_EMP = { 'EJ': '--ej', 'CMM': '--cmm', 'GLOBO AÇOS': '--ga' };
const API = window.API_BASE || 'api/';
let ONDE = 'na planilha';
const ABAS_PERIODO = new Set(['painel', 'cliente', 'equip', 'tendencia', 'kpi']);
const ABAS_PRODUCAO = new Set(['painel', 'semana', 'lanc', 'apont', 'plan', 'avanco', 'gantt', 'cliente', 'tendencia', 'kpi']);
const ABAS_ESTOQUE = new Set(['estmat', 'estrem', 'estcons', 'estinv', 'estcrit', 'estsis']);

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
// Toda tabela larga (.tabela-rolagem) ganha uma barra de rolagem horizontal acima dela, que acompanha a tela
// (fica grudada no topo enquanto a tabela estiver à vista). Reaplica sozinha quando a tela muda (abas,
// filtros, colunas novas), sem precisar ser chamada em cada renderização.
function syncScrollTopo() {
  document.querySelectorAll('.tabela-rolagem').forEach(el => {
    const tem = el.offsetParent !== null && el.scrollWidth > el.clientWidth + 2;
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
    const w = el.scrollWidth + 'px';
    if (topo.firstChild.style.width !== w) topo.firstChild.style.width = w;
  });
}
let _agendaScroll = 0;
function agendarScrollTopo() {
  if (_agendaScroll) return;
  _agendaScroll = requestAnimationFrame(() => { _agendaScroll = 0; syncScrollTopo(); });
}
function vigiarScrollTopo() {
  const main = document.querySelector('main');
  if (!main) return;
  new MutationObserver(agendarScrollTopo).observe(main, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
  window.addEventListener('resize', agendarScrollTopo);
  agendarScrollTopo();
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
  let pares = [...vistos.values()];
  if (faseFiltro) {
    const svDaFase = new Set(
      M.empresas.flatMap(e => e.servicos.filter(sv => faseItem(sv.frente) === faseFiltro).map(sv => sv.nome))
    );
    pares = pares.filter(([, serv]) => svDaFase.has(serv));
  }
  return pares;
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
  D = j; if (j.codigo && !CODIGO) CODIGO = j.codigo; M = j.modelo; T = M.tabelas || { materiais: [], movimentos: [], equipamentos: [], usos: [] };
  ['bm_atividades', 'bm_periodos', 'bm_apontamentos', 'bm_deducoes', 'bm_fechamentos', 'bm_fech_atividades',
   'estoque_eventos', 'estoque_remessas', 'estoque_inventario', 'apontamentos'].forEach(k => T[k] ||= []);
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
  fetch(API + 'estoque-planilha', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(j => { EP = j; atualizarContadorKpi(); if (ABAS_ESTOQUE.has(abaAtual)) renderEstoquePlanilha(); else if (abaAtual === 'kpi') renderKPI(); }).catch(() => {});
}

async function postar(url, corpo) {
  salvando = true;
  try { return await postarBruto(url, corpo); } finally { salvando = false; }
}

async function postarBruto(url, corpo) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': window.CSRF_TOKEN || '' }, body: JSON.stringify(corpo) });
  if (r.status === 401) { location.href = 'login.php'; throw new Error('Sessão expirada'); }
  const j = await r.json().catch(() => ({ erro: 'Resposta inválida do servidor' }));
  if (!r.ok) throw new Error(j.erro || 'Falha ao gravar');
  if (j.versao && D) D.versao = j.versao;
  return j;
}

// Situação da atualização automática do programa (só existe no servidor local)
async function mostrarAtualizacao() {
  try {
    const r = await fetch(API + 'atualizacao', { cache: 'no-store' });
    if (!r.ok) return;
    const e = await r.json(), el = $('#atualiz');
    el.hidden = false;
    const ver = e.codigo ? e.codigo.slice(0, 7) : '—';
    const quando = e.verificado_em ? Math.max(0, Math.round((e.agora - e.verificado_em) / 60)) : null;
    const ha = quando == null ? '' : quando < 1 ? 'agora há pouco' : `há ${quando} min`;
    let txt, cls = '';
    if (e.online) txt = 'Sistema online · sempre na versão publicada';
    else if (!e.ativo) { txt = `Programa ${ver} · atualização automática desligada`; cls = 'aviso'; }
    else if (e.resultado === 'erro') { txt = `Programa ${ver} · sem conseguir atualizar: ${e.detalhe}`; cls = 'erro'; }
    else txt = `Programa ${ver} · atualização automática ligada · conferido ${ha}`;
    $('#atualizTxt').textContent = txt;
    el.className = 'arquivo atualiz ' + cls;
    $('#btnAtualizar').hidden = !e.ativo || !!e.online;
  } catch { }
}
async function verificarAtualizacaoAgora() {
  const b = $('#btnAtualizar'); b.disabled = true; b.textContent = 'Verificando…';
  try {
    const antes = CODIGO;
    const e = await postar(API + 'atualizacao/verificar', {});
    await mostrarAtualizacao();
    if (e.resultado === 'erro') toast(e.detalhe, true, 9000);
    else if (e.codigo && e.codigo !== antes) toast('Nova versão instalada. Atualizando a tela…', false, 3000);
    else toast('O programa já está na versão mais recente.');
  } catch (err) { toast(err.message, true); }
  b.disabled = false; b.textContent = 'Verificar atualização';
}
let CODIGO = null, avisouCodigo = false;   // versão do código carregada nesta página
async function verificarVersao() {
  if (salvando || !D) return;
  try {
    const r = await fetch(API + 'versao', { cache: 'no-store' });
    const j = await r.json();
    $('#pontoSync').className = 'ponto ok';
    // versão nova do programa instalada (automática): recarrega a página sem precisar fechar e abrir de novo
    if (j.codigo) {
      if (!CODIGO) CODIGO = j.codigo;
      else if (j.codigo !== CODIGO) {
        if (pend.size || metasPend.size || bmPend.size) {
          if (!avisouCodigo) { avisouCodigo = true; toast('Nova versão do programa instalada. Salve ou descarte as alterações pendentes para recarregar.', false, 12000); }
        } else { toast('Nova versão do programa instalada. Recarregando…', false, 3000); setTimeout(() => location.reload(), 800); return; }
      }
    }
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
  const emPeriodo = ABAS_PERIODO.has(nome);
  const emProducao = ABAS_PRODUCAO.has(nome);
  $('#barraPeriodo').hidden = !(emPeriodo || emProducao);
  const pc = $('#perControles');
  if (pc) pc.style.display = emPeriodo ? 'contents' : 'none';
  $('#faseCaixa').hidden = !emProducao;
  try { localStorage.setItem('obra198_aba', nome); } catch { }
  renderAba();
}

function atualizarFaseCaixa() {
  const labels = { '': 'Total', '1': 'Fase 1', '2': 'Fase 2' };
  const el = $('#faseCaixaTxt');
  if (el) el.textContent = labels[faseFiltro] ?? 'Total';
}

function atualizarBotoesSegFase() {
  atualizarFaseCaixa();
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
  atualizarContadorKpi();
  atualizarPendentes();
  renderAba();
}

// Mesmo cálculo do painel KPI: serviços < 90% + impactos abertos + materiais críticos (quando o estoque já carregou).
function atualizarContadorKpi() {
  const kpiC = document.getElementById('kpiCont');
  if (!kpiC || !M) return;
  const c = corte();
  const ks = paresMeta().map(([e, s]) => kpiPer(e, s, per.ini, per.fim, c)).filter(k => k.prevTotal > 0 || k.real > 0);
  const n = ks.filter(k => k.pct != null && k.pct < 90).length + M.impactos.filter(i => !i.solucionado).length
    + (EP ? EP.materiais.filter(m => m.status_logistico === 'Crítico').length : 0);
  kpiC.hidden = !n; kpiC.textContent = n;
}

function renderAba() {
  if (!M) return;
  ({ painel: renderPainel, semana: renderSemana, lanc: renderLanc, avanco: renderAvanco, cliente: renderCliente, gantt: renderGantt,
     estmat: renderEstMateriais, estrem: renderEstRemessas, estcons: renderEstConsumo, estinv: renderEstInventario, estcrit: renderEstCriticos, estsis: renderEstoque,
     equip: renderEquip, bm: renderBM, metas: renderMetas, impactos: renderImpactos, tendencia: renderTendencia, kpi: renderKPI, apont: renderApont,
     plan: renderPlanejamento })[abaAtual]();
  requestAnimationFrame(syncScrollTopo);
}

// ------------------------------------------------------------ PAINEL (por período)
function renderPainel() {
  const c = corte();
  const ksAll = paresMeta().map(([e, s]) => kpiPer(e, s, per.ini, per.fim, c)).filter(k => k.prevTotal > 0 || k.real > 0);

  // --- filtro de empresa ---
  const emps = [...new Set(ksAll.map(k => k.emp))];
  // reseta filtro se empresa sumiu dos dados
  if (painelEmpFiltro && !emps.includes(painelEmpFiltro)) painelEmpFiltro = null;
  $('#segPainelEmp').innerHTML =
    `<button data-painel-emp="" class="${!painelEmpFiltro ? 'ativa' : ''}">Geral</button>` +
    emps.map(n => `<button data-painel-emp="${esc(n)}" class="${n === painelEmpFiltro ? 'ativa' : ''}" style="--c:${corEmp(n)}">${esc(n)}</button>`).join('');

  const ks = painelEmpFiltro ? ksAll.filter(k => k.emp === painelEmpFiltro) : ksAll;
  const du = c >= per.ini ? contarDiasUteis(add(per.ini, -1), c) : 0;
  $('#notaFarol').textContent = `Previsto distribuído pelos dias úteis das metas · corte em ${fdA(c)}`;

  const porEmp = {};
  ks.forEach(k => {
    const o = porEmp[k.emp] ||= { prev: 0, real: 0, total: 0, projetadoPer: 0, escopoTotal: 0 };
    if (k.prevTotal > 0) { o.prev += k.prev; o.real += k.real; o.total += k.prevTotal; }
  });
  // Projeção de período por empresa (baseada no escopo próprio de cada empresa)
  const projEmp = projecoesPorEmpresa(c).filter(x => !painelEmpFiltro || x.emp === painelEmpFiltro);
  projEmp.forEach(x => {
    const o = porEmp[x.emp] ||= { prev: 0, real: 0, total: 0, projetadoPer: 0, escopoTotal: 0 };
    o.projetadoPer += x.projetadoPer;
    o.escopoTotal += x.escopo;
  });
  const tot = Object.values(porEmp).reduce((a, o) => ({
    prev: a.prev + o.prev, real: a.real + o.real, total: a.total + o.total,
    projetadoPer: a.projetadoPer + o.projetadoPer, escopoTotal: a.escopoTotal + o.escopoTotal
  }), { prev: 0, real: 0, total: 0, projetadoPer: 0, escopoTotal: 0 });
  const tile = (rot, o, cc) => {
    const pct = o.prev > 0 ? o.real / o.prev * 100 : null;
    const pctProjEscopo = o.escopoTotal > 0 && o.projetadoPer > 0 ? o.projetadoPer / o.escopoTotal * 100 : null;
    const projTxt = pctProjEscopo != null
      ? ` · proj. período: ${nf(o.projetadoPer, 1)} (${nf(pctProjEscopo, 1)}% do escopo)`
      : '';
    return `<div class="tile" style="--c:${cc}"><div class="rot"><span>${esc(rot)}</span>${farolHtml(pct, o.total === 0)}</div>
      <div class="val">${pct == null ? '—' : nf(pct) + '%'}</div>
      <div class="sub">${nf(o.real)} realizados de ${nf(o.prev, 1)} previstos até ${fd(c)} · meta do período ${nf(o.total, 1)}${projTxt}</div></div>`;
  };
  // No modo filtrado por empresa: só o tile da empresa. No modo geral: geral + por empresa.
  const tileGeral = painelEmpFiltro
    ? tile(painelEmpFiltro, tot, corEmp(painelEmpFiltro))
    : tile('Geral da obra', tot, 'var(--fg)') + Object.entries(porEmp).map(([n, o]) => tile(n, o, corEmp(n))).join('');
  $('#tiles').innerHTML = Object.keys(porEmp).length
    ? tileGeral
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
  renderPlanoAcao(c);
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
    al.push([l.nivel, `<b>Estoque · ${esc(l.material)}</b>: ${esc(l.status.toLowerCase())}. Saldo ${nf(l.saldo, 1)} ${esc(l.unidade || '')}, necessário ${nf(l.necSemana + l.necProx, 1)} até a próxima semana. <button class="link" data-ir-aba="estsis">Ver estoque</button>`]));

  alertasEstoqueExterno().forEach(x => al.push(x));
  const abertos = M.impactos.filter(i => !i.solucionado);
  if (abertos.length) {
    const velhos = abertos.filter(i => ehISO(i.data)).sort((a, b) => a.data.localeCompare(b.data)).slice(0, 3)
      .map(i => `${esc(cap(i.motivo))} (${diasEntre(i.data, ref)} dias)`);
    al.push(['vermelho', `<b>${abertos.length} impacto(s) em aberto</b>. Mais antigos: ${velhos.join('; ')}. <button class="link" data-ir-aba="impactos">Ver impactos</button>`]);
  }
  projecoesPorEmpresa(c).filter(x => (!painelEmpFiltro || x.emp === painelEmpFiltro) && x.status === 'ATRASO')
    .forEach(x => {
      const cl = M.cliente.find(cl2 => cl2.servico === x.serv && faseItem(cl2.frente) === faseItem(x.sv.frente));
      al.push(['vermelho', `<b>${esc(x.emp)} · ${esc(cap(x.serv))}</b>: no ritmo atual termina em ${fdA(x.projecao)}${cl?.prazo ? ', depois do prazo ' + fdA(cl.prazo) : ''}. Escopo: ${nf(x.escopo)} · realizado: ${nf(x.acum, 1)} · ritmo: ${nf(x.ritmo, 2)}/dia.`]);
    });

  M.cliente.filter(cl => cl.inicio_plan && cl.inicio_plan <= hoje()).forEach(cl => {
    const produzido = prodServico(cl.servico, null, '2000-01-01', hoje());
    if (produzido === 0) al.push(['vermelho', `<b>${esc(cap(cl.servico))}</b>: planejado iniciar em ${fd(cl.inicio_plan)} mas ainda não iniciado — <span class="farol f-vermelho">ATRASADO</span>`]);
  });

  $('#alertas').innerHTML = al.length
    ? al.map(([n, t]) => `<li><span class="farol f-${n}">${n === 'vermelho' ? 'CRÍTICO' : 'ATENÇÃO'}</span><span>${t}</span></li>`).join('')
    : '<li class="vazio">Nenhum ponto de atenção para o período.</li>';
}

// ------------------------------------------------------------ PLANO DE AÇÃO SEMANAL
// Chave interna usa \x1F como separador para evitar conflito com nomes
function _pKey(emp, serv, fase) { return emp + '\x1F' + serv + '\x1F' + fase; }

function renderPlanoAcao(c) {
  const proxSeg = add(segunda(ref), 7);
  const proxFim = add(proxSeg, 5);
  const segPass = add(segunda(ref), -7);
  const fimPass = add(segPass, 5);
  const duProx = contarDiasUteis(add(proxSeg, -1), proxFim);
  const semAtual = segunda(ref);

  // Calcula ritmo de 14 dias (usado para meta nec.)
  const ini14 = add(c, -14);
  let du14 = 0; for (let d = ini14; d <= c; d = add(d, 1)) if (diaUtil(d)) du14++;

  // Constrói grupos: 'emp\x1Fserv' -> { emp, e, serv, fases: {f: {escopo,acum,saldo,ritmo}} }
  const grupos = {};
  M.empresas.forEach(e => {
    if (painelEmpFiltro && e.nome !== painelEmpFiltro) return;
    e.servicos.forEach(sv => {
      const fase = faseItem(sv.frente);
      // Filtra por faseFiltro se ativo (ao ver só F1 ou só F2)
      if (faseFiltro && fase !== faseFiltro) return;
      const acum = soma(e, sv.col, '0000', c);
      const cl = M.cliente.find(cl2 => cl2.servico === sv.nome && faseItem(cl2.frente) === fase);
      // Inclui serviço se tem escopo, produção ou contrato do cliente
      if (!sv.escopo && !acum && !cl?.qtd) return;
      const k = e.nome + '\x1F' + sv.nome;
      const g = grupos[k] ||= { emp: e.nome, e, serv: sv.nome, fases: {} };
      const fd = g.fases[fase] ||= { escopo: 0, acum: 0, saldo: 0, ritmo: 0 };
      const acumIni14 = soma(e, sv.col, '0000', add(ini14, -1));
      fd.escopo += sv.escopo || 0;
      fd.acum   += acum;
      fd.saldo  += Math.max((sv.escopo || 0) - acum, 0);
      fd.ritmo  += (acum - acumIni14) / Math.max(du14, 1);
    });
  });

  // Garante F2 nos grupos com F1, mesmo que F2 tenha escopo/produção zero.
  // Sem isso, multiFase nunca é ativado e Total = F1 apenas.
  if (!faseFiltro || faseFiltro === '2') {
    M.empresas.forEach(e => {
      if (painelEmpFiltro && e.nome !== painelEmpFiltro) return;
      e.servicos.forEach(sv => {
        if (faseItem(sv.frente) !== '2') return;
        const k = e.nome + '\x1F' + sv.nome;
        const g = grupos[k];
        if (!g || g.fases['2']) return; // grupo não existe ou F2 já adicionado
        const acum2 = soma(e, sv.col, '0000', c);
        const acumIni14_2 = soma(e, sv.col, '0000', add(ini14, -1));
        g.fases['2'] = {
          escopo: sv.escopo || 0,
          acum: acum2,
          saldo: Math.max((sv.escopo || 0) - acum2, 0),
          ritmo: (acum2 - acumIni14_2) / Math.max(du14, 1)
        };
      });
    });
  }

  let h = `<thead><tr>
    <th>Empresa</th><th>Fase</th><th>Serviço</th>
    <th class="n">Escopo</th><th class="n">Realiz.</th><th class="n">Saldo</th><th class="n">% concl.</th>
    <th class="n" title="Somatória de (real − meta) em semanas encerradas">Gap acum.</th>
    <th class="n">Sem. passada<br><small>meta / real / gap</small></th>
    <th class="n">Meta nec./dia</th>
    <th>Próx. semana — meta/dia<br><small class="nota">${fdA(proxSeg)} → ${fdA(proxFim)} · ${duProx} d.u.</small></th>
  </tr></thead><tbody>`;

  const vals = Object.values(grupos);
  vals.forEach(g => {
    const fasesOrdem = Object.keys(g.fases).sort(); // ['1'], ['2'], ou ['1','2']
    const multiFase = fasesOrdem.length > 1;

    // Calcula totais
    const tot = { escopo: 0, acum: 0, saldo: 0, ritmo: 0 };
    fasesOrdem.forEach(f => { const fd = g.fases[f]; tot.escopo += fd.escopo; tot.acum += fd.acum; tot.saldo += fd.saldo; tot.ritmo += fd.ritmo; });

    // Encontra prazo do serviço
    const cl = M.cliente.find(cl2 => cl2.servico === g.serv);
    const prazo = cl?.prazo;
    const duRestAoPrazo = prazo && prazo > c ? contarDiasUteis(c, prazo) : null;

    // Gap acum. e semana passada (Total — todas as fases juntas)
    const metasAnt = M.metas.filter(m => m.empresa === g.emp && m.servico === g.serv && m.fim < semAtual);
    const gapAcum = soma0(metasAnt, m => prodServico(m.servico, g.emp, m.inicio, m.fim) - (m.meta_dia * m.du + (m.gap || 0)));
    const metasPass = M.metas.filter(m => m.empresa === g.emp && m.servico === g.serv && m.inicio === segPass);
    const metaPassTotal = soma0(metasPass, m => m.meta_dia * m.du + (m.gap || 0));
    const realPass = prodServico(g.serv, g.emp, segPass, fimPass);
    const gapPass = realPass - metaPassTotal;
    const semPassTxt = metaPassTotal > 0
      ? `${nf(metaPassTotal, 1)} / ${nf(realPass, 1)} / <span style="color:${gapPass >= 0 ? 'var(--verde)' : 'var(--vermelho)'}">${gapPass > 0 ? '+' : ''}${nf(gapPass, 1)}</span>`
      : `— / ${nf(realPass, 1)} / —`;

    // Helper para uma célula de input
    const inputCell = (fase, fd) => {
      const metaNec = duRestAoPrazo && fd.saldo > 0 ? fd.saldo / duRestAoPrazo : null;
      const metaProx = M.metas.find(m => m.empresa === g.emp && m.servico === g.serv && m.inicio === proxSeg && (m.fase || '') === fase);
      const pKey = _pKey(g.emp, g.serv, fase);
      const pendVal = planoPend.get(pKey);
      const suggested = metaNec != null ? +metaNec.toFixed(2) : '';
      const inputVal = pendVal !== undefined ? pendVal : (metaProx != null ? metaProx.meta_dia : suggested);
      const inputNum = inputVal !== '' ? Number(inputVal) : 0;
      const baixo = metaNec != null && inputNum > 0 && inputNum < metaNec * 0.9;
      return `<td>
        <input class="plano-in" type="number" step="0.1" min="0"
          data-emp="${esc(g.emp)}" data-serv="${esc(g.serv)}" data-fase="${fase}"
          data-prox="${proxSeg}" data-du="${duProx}"
          data-linha="${metaProx?.linha ?? ''}"
          value="${inputVal !== '' ? inputVal : ''}" placeholder="${suggested}">
        ${baixo ? '<span class="farol f-vermelho" style="font-size:.65em;margin-left:4px">↑ INSUF.</span>' : ''}
      </td>`;
    };

    if (multiFase) {
      // Linha Total — rowspan 3 para Empresa
      const totMetaNec = duRestAoPrazo && tot.saldo > 0 ? tot.saldo / duRestAoPrazo : null;
      const totPend = planoPend.get(_pKey(g.emp, g.serv, 'T'));
      // Valor do Total input: se pendente usa isso, senão soma dos inputs de fase
      const f1Meta = M.metas.find(m => m.empresa === g.emp && m.servico === g.serv && m.inicio === proxSeg && (m.fase || '') === '1');
      const f2Meta = M.metas.find(m => m.empresa === g.emp && m.servico === g.serv && m.inicio === proxSeg && (m.fase || '') === '2');
      const totSaved = (f1Meta?.meta_dia || 0) + (f2Meta?.meta_dia || 0);
      const totSuggest = totMetaNec != null ? +totMetaNec.toFixed(2) : '';
      const totInputVal = totPend !== undefined ? totPend : (totSaved > 0 ? totSaved : totSuggest);
      const totPct = tot.escopo > 0 ? tot.acum / tot.escopo * 100 : null;

      h += `<tr class="plano-total">
        <td rowspan="${1 + fasesOrdem.length}"><span class="emp-tag" style="--c:${corEmp(g.emp)}">${esc(g.emp)}</span></td>
        <td><b>Total</b></td><td><b>${esc(cap(g.serv))}</b></td>
        <td class="n"><b>${nf(tot.escopo)}</b></td><td class="n"><b>${nf(tot.acum, 1)}</b></td>
        <td class="n"><b>${nf(tot.saldo, 1)}</b></td>
        <td class="n">${totPct != null ? nf(totPct, 1) + '%' : '—'}</td>
        <td class="n" style="color:${gapAcum >= 0 ? 'var(--verde)' : 'var(--vermelho)'}">${(gapAcum > 0 ? '+' : '') + nf(gapAcum, 1)}</td>
        <td class="n">${semPassTxt}</td>
        <td class="n">${totMetaNec != null ? `<b>${nf(totMetaNec, 2)}</b>/dia` : '—'}</td>
        <td><input class="plano-in" type="number" step="0.1" min="0"
          data-emp="${esc(g.emp)}" data-serv="${esc(g.serv)}" data-fase="T"
          data-prox="${proxSeg}" data-du="${duProx}" data-linha=""
          value="${totInputVal !== '' ? totInputVal : ''}" placeholder="${totSuggest}"></td>
      </tr>`;

      // Sub-linhas por fase
      fasesOrdem.forEach(f => {
        const fd = g.fases[f];
        const fMetaNec = duRestAoPrazo && fd.saldo > 0 ? fd.saldo / duRestAoPrazo : null;
        const fPct = fd.escopo > 0 ? fd.acum / fd.escopo * 100 : null;
        h += `<tr class="plano-sub">
          <td class="nota">F${f}</td><td class="nota">${esc(cap(g.serv))}</td>
          <td class="n nota">${nf(fd.escopo)}</td><td class="n nota">${nf(fd.acum, 1)}</td>
          <td class="n nota">${nf(fd.saldo, 1)}</td>
          <td class="n nota">${fPct != null ? nf(fPct, 1) + '%' : '—'}</td>
          <td class="n nota">—</td><td class="n nota">—</td>
          <td class="n nota">${fMetaNec != null ? nf(fMetaNec, 2) + '/dia' : '—'}</td>
          ${inputCell(f, fd)}
        </tr>`;
      });
    } else {
      // Serviço de fase única — linha simples
      const fase = fasesOrdem[0];
      const fd = g.fases[fase];
      const metaNec = duRestAoPrazo && fd.saldo > 0 ? fd.saldo / duRestAoPrazo : null;
      const pct = fd.escopo > 0 ? fd.acum / fd.escopo * 100 : null;
      h += `<tr>
        <td><span class="emp-tag" style="--c:${corEmp(g.emp)}">${esc(g.emp)}</span></td>
        <td>F${fase}</td><td>${esc(cap(g.serv))}</td>
        <td class="n">${nf(fd.escopo)}</td><td class="n">${nf(fd.acum, 1)}</td>
        <td class="n"><b>${nf(fd.saldo, 1)}</b></td>
        <td class="n">${pct != null ? nf(pct, 1) + '%' : '—'}</td>
        <td class="n" style="color:${gapAcum >= 0 ? 'var(--verde)' : 'var(--vermelho)'}">${(gapAcum > 0 ? '+' : '') + nf(gapAcum, 1)}</td>
        <td class="n">${semPassTxt}</td>
        <td class="n">${metaNec != null ? `<b>${nf(metaNec, 2)}</b>/dia` : '—'}</td>
        ${inputCell(fase, fd)}
      </tr>`;
    }
  });

  if (!vals.length) {
    h += `<tr><td colspan="11" class="vazio">Nenhum serviço encontrado para o filtro atual.</td></tr>`;
  }
  $('#tabPlanoAcao').innerHTML = h + '</tbody>';
  // pendentes reais: F1, F2 ou fase única (não T que é derivado)
  const nPend = [...planoPend].filter(([k]) => !k.endsWith('\x1FT')).length;
  $('#btnSalvarPlano').disabled = !nPend;
  $('#planoTxt').textContent = nPend
    ? `${nPend} meta(s) pendente(s) — clique em "Salvar" para registrar`
    : `Sem. passada: ${fdA(segPass)}–${fdA(fimPass)} · Próx.: ${fdA(proxSeg)}–${fdA(proxFim)} · ${duProx} dias úteis`;
}

async function salvarPlanoAcao() {
  const metas = [];
  planoPend.forEach((metaDia, key) => {
    if (key.endsWith('\x1FT')) return; // Total é derivado, não salva
    if (metaDia === null || metaDia === undefined) return;
    const [emp, serv, fase] = key.split('\x1F');
    const inp = document.querySelector(`input.plano-in[data-emp="${CSS.escape(emp)}"][data-serv="${CSS.escape(serv)}"][data-fase="${fase}"]`);
    if (!inp) return;
    metas.push({ empresa: emp, servico: serv, inicio: inp.dataset.prox, du: +inp.dataset.du, meta_dia: +metaDia, fase, linha: inp.dataset.linha || null });
  });
  if (!metas.length) return;
  try {
    const r = await postar(API + 'criar-meta', { metas });
    planoPend.clear();
    await carregar();
    toast(`${r.criadas} meta(s) da próxima semana salva(s) ${ONDE}.`);
    if (abaAtual === 'painel') renderPainel();
  } catch (err) { toast(err.message, true); }
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

  // Exibe apenas serviços F1 (F2 removido da tabela de lançamento)
  const svs = e.servicos.filter(sv => faseItem(sv.frente) !== '2');
  let h = '<thead><tr><th class="fixa">Dia</th>';
  h += svs.map(sv => `<th class="n" title="${esc(sv.id)}">${esc(cap(sv.nome))}</th>`).join('');
  h += (e.col_obs ? '<th>Observação / Nº RDO / foto</th>' : '') + '</tr></thead><tbody>';

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
    svs.forEach(sv => h += campo(sv.col, 'num'));
    if (e.col_obs) h += campo(e.col_obs, 'txt');
    h += '</tr>';
  });
  h += '</tbody><tfoot>';
  const rodape = (rot, fn) => `<tr><td class="fixa">${rot}</td>${svs.map(sv => `<td>${fn(sv)}</td>`).join('')}${e.col_obs ? '<td></td>' : ''}</tr>`;
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

    // Sincroniza apontamentos F2 para lançamentos se houver salvamento de produção
    if (porAba) {
      const e = M.empresas.find(x => x.aba === empSel);
      if (e) {
        const datasUnicas = new Set([...pend.keys()].filter(k => k.startsWith(empSel + '|')).map(k => k.split('|')[1]));
        for (const data of datasUnicas) {
          try {
            await postarBruto(API + 'apontamentos/sincronizar-fase2', { data, empresa: e.nome });
          } catch (err) {
            console.warn('Sincronização F2 falhou:', err.message);
          }
        }
      }
    }

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
function realizadoFase(servico, fase, ate) {
  let t = 0;
  M.empresas.forEach(e => {
    e.servicos.filter(s => s.nome === servico && faseItem(s.frente) === fase)
      .forEach(s => t += soma(e, s.col, '0000', ate));
  });
  return t;
}

function faseItem(frente) {
  if (!frente) return '1';
  return frente.toUpperCase().startsWith('GALPÃO F2') ? '2' : '1';
}

function contratoLinhas(ate = ref) {
  const ini = add(ate, -14);
  let du = 0; for (let d = ini; d <= ate; d = add(d, 1)) if (diaUtil(d)) du++;
  return M.cliente.filter(c => !faseFiltro || faseItem(c.frente) === faseFiltro).map(c => {
    const fase = faseItem(c.frente);
    const real = realizadoFase(c.servico, fase, ate);
    const ritmo = (real - realizadoFase(c.servico, fase, add(ini, -1))) / Math.max(du, 1);
    const saldo = c.qtd ? Math.max(c.qtd - real, 0) : null;
    let projecao = null, status;
    if (!c.qtd) {
      status = real > 0 ? 'EM ANDAMENTO' : 'SEM CONTRATO';
    } else if (saldo <= 0) status = 'CONCLUÍDO';
    else if (ritmo <= 0 && c.inicio_plan && c.inicio_plan > ate) {
      status = 'NÃO INICIADO';
      if (c.meta_dia) projecao = somarDiasUteis(add(c.inicio_plan, -1), Math.ceil(saldo / c.meta_dia));
    } else if (ritmo <= 0) status = 'SEM RITMO';
    else {
      projecao = somarDiasUteis(ate, Math.ceil(saldo / ritmo));
      status = c.prazo && projecao > c.prazo ? 'ATRASO' : 'NO PRAZO';
    }
    const necessario = c.qtd && c.prazo && saldo > 0 && c.prazo > ate ? saldo / Math.max(1, contarDiasUteis(ate, c.prazo)) : null;
    return { ...c, real, ritmo, saldo, projecao, status, necessario, fase: faseItem(c.frente) };
  });
}
const COR_STATUS = { 'CONCLUÍDO': 'verde', 'NO PRAZO': 'verde', 'ADIANTADO': 'verde', 'ATRASO': 'vermelho', 'ATRASADO': 'vermelho', 'SEM RITMO': 'amarelo', 'NÃO INICIADO': 'pendente', 'NO LIMITE': 'amarelo' };

// Projeção de período por empresa — usa escopo próprio de cada empresa (servicos.escopo) e produção individual
function projecoesPorEmpresa(ate) {
  const ini14 = add(ate, -14);
  let du = 0; for (let d = ini14; d <= ate; d = add(d, 1)) if (diaUtil(d)) du++;
  const duRestante = contarDiasUteis(ate, per.fim);
  const result = [];
  M.empresas.forEach(e => {
    e.servicos.filter(sv => sv.escopo > 0 && (!faseFiltro || faseItem(sv.frente) === faseFiltro)).forEach(sv => {
      const acum = soma(e, sv.col, '0000', ate);
      const acumIni14 = soma(e, sv.col, '0000', add(ini14, -1));
      const ritmo = (acum - acumIni14) / Math.max(du, 1);
      const realPer = soma(e, sv.col, per.ini, ate);
      const maxProdPeriodo = Math.max(sv.escopo - (acum - realPer), 0);
      const projetadoPer = Math.min(maxProdPeriodo, Math.max(0, realPer + ritmo * duRestante));
      const saldo = Math.max(sv.escopo - acum, 0);
      let projecao = null, status;
      if (saldo <= 0) {
        status = 'CONCLUÍDO';
      } else if (ritmo <= 0) {
        status = acum > 0 ? 'SEM RITMO' : 'SEM PRODUÇÃO';
      } else {
        projecao = somarDiasUteis(ate, Math.ceil(saldo / ritmo));
        const cl = M.cliente.find(c => c.servico === sv.nome && faseItem(c.frente) === faseItem(sv.frente));
        status = cl?.prazo && projecao > cl.prazo ? 'ATRASO' : 'NO PRAZO';
      }
      result.push({ emp: e.nome, e, serv: sv.nome, sv, acum, ritmo, saldo, projecao, status, projetadoPer, escopo: sv.escopo });
    });
  });
  return result;
}

// ------------------------------------------------------------ CRONOGRAMA (GANTT) PREVISTO x REALIZADO
// Previsto: início planejado até o término pela meta do cliente (meta/dia x dias úteis), com o prazo contratual marcado.
// Realizado: primeiro dia com produção até a data de referência (ou até concluir), preenchido pelo % do contrato produzido.
// Tracejado: término projetado no ritmo das últimas duas semanas.
const ganEst = { zoom: 'normal', frente: '', porEmp: false };
const GAN_PX = { semana: 2.2, normal: 4.5, detalhe: 11 };
const GAN_ESQ = 300;

function ganProducao(servico, empNome) {
  const ds = [];
  M.empresas.forEach(e => {
    if (empNome && e.nome !== empNome) return;
    e.servicos.filter(s => s.nome === servico).forEach(s => Object.keys(e.registros).forEach(d => {
      const v = e.registros[d].v[s.col];
      if (typeof v === 'number' && v > 0) ds.push([d, v]);
    }));
  });
  return ds.sort((a, b) => a[0].localeCompare(b[0]));
}

function ganLinhas(c) {
  const proj = Object.fromEntries(contratoLinhas(c).map(x => [x.servico, x]));
  return itensCliente().map(it => {
    const ds = ganProducao(it.servico).filter(([d]) => d <= c);
    const realAc = realizadoTotal(it.servico, c), prevAc = prevCliente(it, c);
    const fimMeta = it.inicio_plan && it.meta_dia ? somarDiasUteis(add(it.inicio_plan, -1), Math.ceil(it.qtd / it.meta_dia)) : null;
    let acum = 0, concluiu = null;
    ds.forEach(([d, v]) => { acum += v; if (!concluiu && acum >= it.qtd) concluiu = d; });
    const p = proj[it.servico] || {};
    const status = realAc >= it.qtd ? 'CONCLUÍDO' : prevAc === 0 && realAc === 0 ? 'NÃO INICIADO' : realAc >= prevAc ? 'ADIANTADO' : realAc >= prevAc * 0.95 ? 'NO LIMITE' : 'ATRASADO';
    const porEmp = M.empresas.map(e => ({ nome: e.nome, ds: ganProducao(it.servico, e.nome).filter(([d]) => d <= c) })).filter(x => x.ds.length);
    return { it, ini: it.inicio_plan || null, fimPrev: fimMeta || it.prazo || null, prazo: it.prazo || null, ri: ds.length ? ds[0][0] : null,
      rf: concluiu || (ds.length ? c : null), ultimo: ds.length ? ds[ds.length - 1][0] : null, realAc, prevAc, pctReal: Math.min(1, realAc / it.qtd), pctPrev: Math.min(1, prevAc / it.qtd),
      projecao: p.projecao || null, status, porEmp };
  });
}

function renderGantt() {
  const c = corte(), ls0 = ganLinhas(c);
  const frentes = [...new Set(ls0.map(l => l.it.frente || 'SEM FRENTE'))];
  if (ganEst.frente && !frentes.includes(ganEst.frente)) ganEst.frente = '';
  $('#selGanFrente').innerHTML = `<option value="">Todas</option>` + frentes.map(f => `<option ${f === ganEst.frente ? 'selected' : ''}>${esc(f)}</option>`).join('');
  $('#chkGanEmp').checked = ganEst.porEmp;
  $('#segGanZoom').innerHTML = [['semana', 'Visão geral'], ['normal', 'Normal'], ['detalhe', 'Detalhe']]
    .map(([k, r]) => `<button data-gan-zoom="${k}" class="${k === ganEst.zoom ? 'ativa' : ''}">${r}</button>`).join('');
  $('#ganLegenda').innerHTML = `<span><i style="--c:var(--fg3)"></i>Previsto (cliente)</span><span><i style="--c:var(--verde)"></i>Realizado no prazo/adiantado</span><span><i style="--c:var(--amarelo)"></i>No limite</span><span><i style="--c:var(--vermelho)"></i>Atrasado</span><span><i style="--c:var(--acento)"></i>Concluído</span><span><i class="g-leg-proj"></i>Projeção</span><span><i class="g-leg-hoje"></i>Hoje</span>`;

  const ls = ls0.filter(l => !ganEst.frente || (l.it.frente || 'SEM FRENTE') === ganEst.frente);
  const avPrev = avancoPonderado(c, true), avReal = avancoPonderado(c, false), gap = avReal - avPrev;
  const atras = ls.filter(l => l.status === 'ATRASADO').length, ok = ls.filter(l => ['ADIANTADO', 'CONCLUÍDO'].includes(l.status)).length;
  const prazoFinal = ls.map(l => l.prazo).filter(Boolean).sort().pop();
  const projFinal = ls.every(l => l.projecao || l.status === 'CONCLUÍDO') ? ls.map(l => l.projecao).filter(Boolean).sort().pop() : null;
  const tile = (rot, val, sub, st, cc = 'var(--acento)') => `<div class="tile" style="--c:${cc}"><div class="rot"><span>${rot}</span>${st || ''}</div><div class="val">${val}</div><div class="sub">${sub}</div></div>`;
  $('#ganTiles').innerHTML =
    tile('Avanço físico realizado', nf(avReal, 1) + '%', `Previsto: ${nf(avPrev, 1)}% · desvio ${gap >= 0 ? '+' : ''}${nf(gap, 1)} p.p. em ${fdA(c)}`, `<span class="farol f-${gap >= 0 ? 'verde' : gap > -5 ? 'amarelo' : 'vermelho'}">${gap >= 0 ? 'ADIANTADO' : 'ATRASADO'}</span>`, 'var(--fg)') +
    tile('Serviços atrasados', String(atras), `${ok} no prazo/adiantados de ${ls.length} serviços`, '', atras ? 'var(--vermelho)' : 'var(--verde)') +
    tile('Término projetado', projFinal ? fdA(projFinal) : 'Indefinido', prazoFinal ? `Prazo contratual: ${fdA(prazoFinal)}` : '', projFinal && prazoFinal ? `<span class="farol f-${projFinal <= prazoFinal ? 'verde' : 'vermelho'}">${projFinal <= prazoFinal ? 'NO PRAZO' : 'ATRASO'}</span>` : '');

  // projeções muito distantes (ritmo quase parado) não esticam a escala: ficam limitadas ao prazo final + 4 meses
  const limite = add(ls.map(l => l.prazo).filter(Boolean).reduce(maxD, c), 120);
  ls.forEach(l => { if (l.projecao && l.projecao > limite) { l.projReal = l.projecao; l.projecao = limite; } });
  const datas = [c];
  ls.forEach(l => [l.ini, l.fimPrev, l.prazo, l.ri, l.rf, l.projecao].forEach(d => d && datas.push(d)));
  if (!ls.length) { $('#ganGrafico').innerHTML = '<p class="vazio">Nenhum serviço com quantidade contratada em METAS CLIENTE.</p>'; return; }
  const ini = segunda(add(datas.reduce(minD), -7)), fim = add(datas.reduce(maxD), 14), px = GAN_PX[ganEst.zoom];
  const nd = diasEntre(ini, fim) + 1, W = Math.round(nd * px);
  const X = d => Math.round(diasEntre(ini, d) * px);
  $('#ganNota').textContent = `${fdA(ini)} a ${fdA(fim)} · hoje = ${fdA(c)} (data de referência) · previsto = meta do cliente/dia × dias úteis`;

  // cabeçalho: meses e semanas
  const meses = [];
  for (let d = ini; d <= fim; d = add(d, 1)) {
    const k = d.slice(0, 7);
    if (!meses.length || meses[meses.length - 1].k !== k) meses.push({ k, d, n: 0 });
    meses[meses.length - 1].n++;
  }
  const nomeMes = k => { const [a, m] = k.split('-'); return ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][+m - 1] + '/' + a.slice(2); };
  const cab = `<div class="g-linha g-cab"><div class="g-rot" style="width:${GAN_ESQ}px">Serviço</div><div class="g-trilha" style="width:${W}px">` +
    meses.map(m => `<span class="g-mes" style="left:${X(m.d)}px;width:${Math.round(m.n * px)}px">${nomeMes(m.k)}</span>`).join('') + '</div></div>';

  const bar = (cls, a, b, extra = '', tit = '', top = 0) => {
    if (!a || !b) return '';
    const x = X(a), w = Math.max(3, X(add(b, 1)) - x);
    return `<div class="g-bar ${cls}" style="left:${x}px;width:${w}px;${top ? 'top:' + top + 'px;' : ''}${extra}" title="${esc(tit)}">`;
  };
  let corpo = '';
  const porFrente = {};
  ls.forEach(l => (porFrente[l.it.frente || 'SEM FRENTE'] ||= []).push(l));
  Object.entries(porFrente).forEach(([fr, xs]) => {
    const pesoT = soma0(xs, l => l.it.peso) || 1;
    const fp = soma0(xs, l => l.it.peso * l.pctPrev) / pesoT * 100, fr_ = soma0(xs, l => l.it.peso * l.pctReal) / pesoT * 100;
    corpo += `<div class="g-linha g-frente"><div class="g-rot" style="width:${GAN_ESQ}px"><b>${esc(fr)}</b> <span class="nota">real ${nf(fr_, 0)}% · prev. ${nf(fp, 0)}%</span></div><div class="g-trilha" style="width:${W}px"></div></div>`;
    xs.forEach(l => {
      const cor = l.status === 'CONCLUÍDO' ? 'concl' : COR_STATUS[l.status];
      const tit = `${cap(l.it.servico)}\nPrevisto: ${l.ini ? fdA(l.ini) : '—'} a ${l.fimPrev ? fdA(l.fimPrev) : '—'} (prazo ${l.prazo ? fdA(l.prazo) : '—'})\nRealizado: ${l.ri ? fdA(l.ri) : 'não iniciado'}${l.rf && l.status === 'CONCLUÍDO' ? ' a ' + fdA(l.rf) : ''}\nProduzido ${nf(l.realAc, 1)} de ${nf(l.it.qtd)} (${nf(l.pctReal * 100, 1)}%) · previsto até hoje ${nf(l.prevAc, 1)} (${nf(l.pctPrev * 100, 1)}%)${l.projecao && l.status !== 'CONCLUÍDO' ? '\nProjeção de término: ' + fdA(l.projReal || l.projecao) : ''}`;
      corpo += `<div class="g-linha"><div class="g-rot" style="width:${GAN_ESQ}px" title="${esc(tit)}"><span class="g-nome">${esc(cap(l.it.servico))}</span>
        <span class="g-num"><b class="${l.pctReal < l.pctPrev - 0.0001 ? 'valor-neg' : ''}">${nf(l.pctReal * 100, 0)}%</b> / ${nf(l.pctPrev * 100, 0)}%</span></div>
        <div class="g-trilha" style="width:${W}px">
          ${bar('prev', l.ini, l.fimPrev, '', tit, 7)}<i class="g-prog prev-prog" style="width:${l.ini && l.fimPrev ? Math.round(l.pctPrev * Math.max(3, X(add(l.fimPrev, 1)) - X(l.ini))) : 0}px"></i></div>
          ${bar('real ' + cor, l.ri, l.rf, '', tit, 20)}<i class="g-prog" style="width:${l.ri && l.rf ? Math.round(l.pctReal * Math.max(3, X(add(l.rf, 1)) - X(l.ri))) : 0}px"></i></div>
          ${l.status !== 'CONCLUÍDO' && l.projecao && l.projecao > c ? bar('proj', add(c, 1), l.projecao, '', 'Projeção de término: ' + fdA(l.projReal || l.projecao) + (l.projReal ? ' (muito distante: ritmo atual quase parado)' : ''), 20) + '</div>' : ''}
          ${l.prazo ? `<span class="g-prazo" style="left:${X(l.prazo)}px" title="Prazo contratual ${fdA(l.prazo)}"></span>` : ''}
        </div></div>`;
      if (ganEst.porEmp) l.porEmp.forEach(e => {
        const tot = soma0(e.ds, ([, v]) => v);
        corpo += `<div class="g-linha g-sub"><div class="g-rot" style="width:${GAN_ESQ}px"><span class="g-nome" style="--c:${corEmp(e.nome)}">${esc(e.nome)}</span><span class="g-num">${nf(tot, 1)}</span></div>
          <div class="g-trilha" style="width:${W}px">${bar('real emp', e.ds[0][0], e.ds[e.ds.length - 1][0], `background:${corEmpHex(e.nome)}`, `${e.nome}: ${fdA(e.ds[0][0])} a ${fdA(e.ds[e.ds.length - 1][0])} · ${nf(tot, 1)} produzidos`, 12)}</div></div></div>`;
      });
    });
  });
  const hoje = `<div class="g-hoje" style="left:${GAN_ESQ + X(c) + Math.round(px / 2)}px"><span>${fd(c)}</span></div>`;
  $('#ganGrafico').style.setProperty('--gan-w', (GAN_ESQ + W) + 'px');
  $('#ganGrafico').style.setProperty('--gan-sem', Math.round(7 * px) + 'px');
  $('#ganGrafico').innerHTML = cab + corpo + hoje;
  const cx = $('#ganGrafico').closest('.tabela-rolagem');
  if (!ganEst.rolou) { ganEst.rolou = true; cx.scrollLeft = Math.max(0, GAN_ESQ + X(c) - cx.clientWidth / 2); }
  requestAnimationFrame(syncScrollTopo);
}

// ------------------------------------------------------------ PLANEJAMENTO DE MONTAGEM
function hojeIso() { return new Date().toISOString().slice(0, 10); }
let planDados = null; // cache dos dados de planejamento

async function carregarPlanejamento() {
  if (planDados) return planDados;
  try {
    const r = await fetch(API + 'planejamento');
    if (r.ok) planDados = await r.json();
    else planDados = { setores: [] };
  } catch { planDados = { setores: [] }; }
  return planDados;
}

// Retorna {inicio, fim} das datas de apontamento para um setor (frente|parte)
function datasApontSsetor(frente, parte) {
  const aps = T.apontamentos || [];
  const tipo = frente === 'joist' ? 'JOIST' : frente.toUpperCase();
  const relevantes = aps.filter(a => {
    if ((a.tipo || '').toUpperCase() !== tipo) return false;
    // joist: 'parte' é a rua (ex.: "01-02"); outros: 'parte' é o id da faixa/lado (ex.: "A", "AB", "A>")
    if (frente === 'joist') return (a.rua || '') === parte;
    return (a.faixa || '') === parte;
  });
  if (!relevantes.length) return null;
  const datas = relevantes.map(a => a.data).filter(Boolean).sort();
  return { inicio: datas[0], fim: datas[datas.length - 1] };
}

// Retorna a data de chegada mais recente de material para um etapa (JOIST / MONTAGEM)
function dataChegadaMaterial(etapa, EP) {
  if (!EP || !EP.remessas) return null;
  const meta = EP.remessas.meta_remessas || [];
  const itens = EP.remessas.itens || [];
  // Filtrar remessas que têm itens dessa etapa
  const colsComEtapa = new Set();
  for (const item of itens) {
    if ((item.etapa || '').toUpperCase() === etapa.toUpperCase()) {
      Object.keys(item.qtd_por_remessa || {}).forEach(c => colsComEtapa.add(c));
    }
  }
  let ultimaChegada = null;
  for (const m of meta) {
    if (colsComEtapa.has(m.nome) && m.data_chegada && m.data_chegada.includes('/')) {
      const [d, mm, a] = m.data_chegada.split('/');
      const iso = `${a}-${mm.padStart(2,'0')}-${d.padStart(2,'0')}`;
      if (!ultimaChegada || iso > ultimaChegada) ultimaChegada = iso;
    }
  }
  return ultimaChegada;
}

// Converte 'dd/mm/aaaa' → 'aaaa-mm-dd'
function brParaIso(br) {
  if (!br) return null;
  if (br.includes('-')) return br;
  const p = br.split('/');
  if (p.length !== 3) return null;
  return `${p[2]}-${p[1].padStart(2,'0')}-${p[0].padStart(2,'0')}`;
}

function diasEntreDatas(a, b) {
  if (!a || !b) return null;
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}

async function renderPlanejamento() {
  // Carregamento lazy das frentes (mapas IFC)
  const frObj = frentesMontagem(renderPlanejamento);
  if (!frObj) return; // aguarda callback

  const dados = await carregarPlanejamento();
  const setoresMap = Object.fromEntries((dados.setores || []).map(s => [s.chave, s]));

  // Filtros de frente
  const todasFrentes = ['joist', 'fechamento', 'marquise', 'contraventamento'];
  let filtroFrente = planEst?.frente || '';
  const segEl = $('#segPlanFrente');
  segEl.innerHTML = [['', 'Todas'], ...todasFrentes.map(f => [f, cap(f)])].map(([k, r]) =>
    `<button data-plan-frente="${k}" class="${k === filtroFrente ? 'ativa' : ''}">${r}</button>`).join('');

  // Calcular data de chegada de material por etapa
  const chegadaJoist = dataChegadaMaterial('JOIST', EP);
  const chegadaMont = dataChegadaMaterial('MONTAGEM', EP);

  // Malha do IFC para lista de ruas
  const malha = frObj.malha || {};
  const ruas = malha.ruas || [];

  // Montar linhas da tabela
  const todasChaves = [
    ...ruas.map(r => `joist|${r}`),
    ...['fechamento', 'marquise', 'contraventamento'].flatMap(fn => {
      const fr = (frObj.frentes || {})[fn];
      return (fr?.partes || []).map(p => `${fn}|${p.id}`);
    })
  ];

  // Tiles de sumário
  const planSetores = todasChaves.map(chave => {
    const s = setoresMap[chave] || { chave };
    const [frente, parte] = chave.split('|');
    const real = datasApontSsetor(frente, parte);
    const etapa = frente === 'joist' ? 'JOIST' : 'MONTAGEM';
    const chegada = etapa === 'JOIST' ? chegadaJoist : chegadaMont;
    const planInicio = s.data_plan_inicio || null;
    const planFim = s.data_plan_fim || null;
    const realInicio = real?.inicio || null;

    let status = 'sem-dado';
    let deltaPlanReal = null;
    let deltaMaterial = null;

    if (realInicio && planInicio) {
      deltaPlanReal = diasEntreDatas(planInicio, realInicio);
      if (deltaPlanReal <= 0) status = 'adiantado';
      else if (deltaPlanReal <= 3) status = 'no-prazo';
      else status = 'atrasado';
    } else if (realInicio) {
      status = 'realizado';
    } else if (planInicio && planInicio < hojeIso()) {
      status = 'pendente';
    }

    if (chegada && planInicio) {
      deltaMaterial = diasEntreDatas(chegada, planInicio);
    }

    return { chave, frente, parte, s, real, etapa, chegada, planInicio, planFim, realInicio, status, deltaPlanReal, deltaMaterial };
  });

  const filtrado = filtroFrente ? planSetores.filter(r => r.frente === filtroFrente) : planSetores;

  // Tiles
  const atrasados = planSetores.filter(r => r.status === 'atrasado').length;
  const semMat = planSetores.filter(r => r.deltaMaterial !== null && r.deltaMaterial < 0).length;
  const realizados = planSetores.filter(r => r.realInicio).length;
  const comPlan = planSetores.filter(r => r.planInicio).length;
  const tile = (rot, val, sub, cor) => `<div class="tile" style="--c:${cor}"><div class="rot"><span>${rot}</span></div><div class="val">${val}</div><div class="sub">${sub}</div></div>`;
  $('#planTiles').innerHTML =
    tile('Setores planejados', comPlan, `de ${planSetores.length} total`, 'var(--acento)') +
    tile('Realizados', realizados, 'com ao menos 1 apontamento', 'var(--verde)') +
    tile('Atrasados vs plano', atrasados, 'início real após data planejada', atrasados ? 'var(--vermelho)' : 'var(--verde)') +
    tile('Material antes do plano', semMat, 'chegou depois da data planejada', semMat ? 'var(--amarelo)' : 'var(--verde)');

  // Tabela principal
  const corStatus = { 'adiantado': 'verde', 'no-prazo': 'verde', 'atrasado': 'vermelho', 'pendente': 'amarelo', 'realizado': 'pendente', 'sem-dado': '' };
  const rotStatus = { 'adiantado': 'Adiantado', 'no-prazo': 'No prazo', 'atrasado': 'Atrasado', 'pendente': 'Pendente', 'realizado': 'Realizado', 'sem-dado': '—' };
  const statusFarol = st => st && corStatus[st] ? `<span class="farol f-${corStatus[st]}">${rotStatus[st]}</span>` : '—';
  const deltaIcon = d => d === null ? '—' : d === 0 ? 'No dia' : d > 0 ? `<span style="color:var(--vermelho)">+${d}d</span>` : `<span style="color:var(--verde)">${d}d</span>`;
  const chave = r => r.chave;

  $('#tabPlan').innerHTML = `<thead><tr>
    <th>Frente</th><th>Setor</th>
    <th>Início planejado</th><th>Fim planejado</th>
    <th>Início real</th><th>Fim real</th>
    <th class="n">Desvio (dias)</th>
    <th>Chegada material</th>
    <th class="n">Mat. antes do plano</th>
    <th>Status</th><th>Obs.</th>
  </tr></thead><tbody>` +
  filtrado.map(r => `<tr data-plan-chave="${esc(r.chave)}">
    <td class="nota">${esc(cap(r.frente))}</td>
    <td><b>${esc(r.parte)}</b></td>
    <td><input class="plan-dt plan-ini" type="date" value="${r.planInicio || ''}" data-chave="${esc(r.chave)}" aria-label="Início planejado"></td>
    <td><input class="plan-dt plan-fim" type="date" value="${r.planFim || ''}" data-chave="${esc(r.chave)}" aria-label="Fim planejado"></td>
    <td class="nota">${r.realInicio ? fdA(r.realInicio) : '—'}</td>
    <td class="nota">${r.real?.fim && r.real.fim !== r.realInicio ? fdA(r.real.fim) : '—'}</td>
    <td class="n">${deltaIcon(r.deltaPlanReal)}</td>
    <td class="nota">${r.chegada ? fdA(r.chegada) : '—'}</td>
    <td class="n">${deltaIcon(r.deltaMaterial)}</td>
    <td>${statusFarol(r.status)}</td>
    <td><input class="plan-obs" type="text" value="${esc(r.s?.obs || '')}" data-chave="${esc(r.chave)}" placeholder="Obs." style="width:100%"></td>
  </tr>`).join('') + '</tbody>';

  // Análise de impacto
  const impactados = planSetores.filter(r => r.deltaMaterial !== null && r.deltaMaterial < 0);
  const impEl = $('#planImpacto');
  if (!impactados.length) {
    impEl.innerHTML = '<p class="vazio">Nenhum setor com chegada de material após a data planejada de início.</p>';
  } else {
    impEl.innerHTML = `<div class="tabela-rolagem"><table>
      <thead><tr><th>Setor</th><th>Frente</th><th>Planejado início</th><th>Chegada material</th><th class="n">Atraso material (dias)</th><th>Impacto</th></tr></thead>
      <tbody>` + impactados.map(r => {
        const dias = Math.abs(r.deltaMaterial);
        return `<tr>
          <td><b>${esc(r.parte)}</b></td>
          <td class="nota">${esc(cap(r.frente))}</td>
          <td>${r.planInicio ? fdA(r.planInicio) : '—'}</td>
          <td>${r.chegada ? fdA(r.chegada) : '—'}</td>
          <td class="n"><span style="color:var(--vermelho)">${dias}d depois</span></td>
          <td class="nota">Material chegou ${dias}d após o início previsto${r.realInicio ? ` — montagem iniciou ${fdA(r.realInicio)}` : ''}</td>
        </tr>`;
      }).join('') + '</tbody></table></div>';
  }

  // Timeline simplificada de remessas
  renderPlanTimeline(EP);
}

function renderPlanTimeline(ep) {
  const el = $('#planTimeline');
  if (!ep || !ep.remessas) { el.innerHTML = '<p class="vazio">Dados de remessas não disponíveis.</p>'; return; }
  const meta = ep.remessas.meta_remessas || [];
  const chegadas = meta.filter(m => m.data_chegada && m.data_chegada.includes('/'));
  if (!chegadas.length) { el.innerHTML = '<p class="vazio">Sem datas de chegada registradas.</p>'; return; }

  // Converter datas
  const isos = chegadas.map(m => {
    const [d, mm, a] = m.data_chegada.split('/');
    return { ...m, iso: `${a}-${mm.padStart(2,'0')}-${d.padStart(2,'0')}` };
  }).sort((a, b) => a.iso.localeCompare(b.iso));

  const aps = T.apontamentos || [];
  // Datas de apontamentos agrupadas por semana
  const apPorDia = {};
  aps.forEach(a => { if (a.data) apPorDia[a.data] = (apPorDia[a.data] || 0) + (a.qtd || 1); });

  const ini = isos[0].iso;
  const fim = isos[isos.length - 1].iso;
  const diasTotal = diasEntreDatas(ini, fim) + 1;
  if (!diasTotal) { el.innerHTML = ''; return; }

  const px = Math.min(3, 960 / diasTotal);
  const W = Math.round(diasTotal * px);
  const X = d => Math.round(diasEntreDatas(ini, d) * px);

  let svg = `<div style="overflow-x:auto"><svg width="${W + 120}" height="140" style="font-family:inherit;font-size:10px">`;
  // Linha base
  svg += `<line x1="0" y1="70" x2="${W}" y2="70" stroke="var(--fg3)" stroke-width="1"/>`;

  // Remessas: marcações verticais
  isos.forEach((m, i) => {
    const x = X(m.iso);
    const etapa = m.nome.includes('OE') ? 'Remessa' : m.nome;
    svg += `<line x1="${x}" y1="40" x2="${x}" y2="70" stroke="var(--acento)" stroke-width="2"/>`;
    if (i % 2 === 0) svg += `<text x="${x + 2}" y="38" fill="var(--fg2)" font-size="9" transform="rotate(-35,${x + 2},38)">${esc(m.data_chegada)}</text>`;
    svg += `<title>${esc(m.nome)}: ${esc(m.data_chegada)}</title>`;
  });

  // Apontamentos: bolinhas acima da linha
  const apDatas = Object.keys(apPorDia).filter(d => d >= ini && d <= fim).sort();
  apDatas.forEach(d => {
    const x = X(d);
    const n = apPorDia[d];
    const r = Math.min(8, 3 + n);
    svg += `<circle cx="${x}" cy="85" r="${r}" fill="var(--verde)" opacity="0.7"><title>${fdA(d)}: ${n} apontamento(s)</title></circle>`;
  });

  // Legenda
  svg += `<circle cx="8" cy="115" r="6" fill="var(--verde)" opacity="0.7"/>`;
  svg += `<text x="18" y="119" fill="var(--fg2)">Apontamentos</text>`;
  svg += `<line x1="120" y1="112" x2="128" y2="112" stroke="var(--acento)" stroke-width="2"/>`;
  svg += `<text x="132" y="119" fill="var(--fg2)">Chegada de material</text>`;

  svg += '</svg></div>';
  el.innerHTML = svg;
}

// Estado do planejamento
let planEst = { frente: '' };

function renderAvanco() {
  const linhas = contratoLinhas(); // já filtrado por faseFiltro via contratoLinhas()

  // resumo: itens com contrato / total / % concluídos
  const comContrato = linhas.filter(c => c.qtd);
  const concluidos = comContrato.filter(c => c.status === 'CONCLUÍDO').length;
  $('#avancoResumo').textContent = `${linhas.length} serviços · ${comContrato.length} com quantidade contratada · ${concluidos} concluídos`;

  const semContratoNote = '<span class="nota" title="Sem quantidade contratada cadastrada">s/ contrato</span>';
  const statusPrioridadeContrato = ['ATRASO', 'SEM RITMO', 'NO LIMITE', 'EM ANDAMENTO', 'NO PRAZO', 'NÃO INICIADO', 'SEM CONTRATO', 'CONCLUÍDO'];

  // Agrupa por serviço para exibir Total (F1+F2) quando multiFase
  // trim() evita que espaços extras impeçam o agrupamento entre F1 e F2
  const gruposContrato = {};
  linhas.forEach(c => { (gruposContrato[c.servico.trim()] ||= []).push(c); });

  let tBodyContrato = '';
  Object.entries(gruposContrato).forEach(([serv, fases]) => {
    const barra = (pct, real) => pct == null
      ? (real > 0 ? `<span class="nota">${nf(real, 1)} lançados</span>` : '—')
      : `<div class="barra" title="${nf(pct, 1)}%"><i style="width:${Math.min(pct, 100)}%"></i></div><span class="nota">${nf(pct, 1)}%</span>`;

    // Uma linha por serviço — sempre mostra Total (F1+F2 agregados)
    const totQtd = soma0(fases, f => f.qtd || 0);
    const totReal = soma0(fases, f => f.real || 0);
    const totSaldo = totQtd > 0 ? Math.max(totQtd - totReal, 0) : null;
    const totPct = totQtd ? totReal / totQtd * 100 : null;
    const totProjecao = fases.map(f => f.projecao).filter(Boolean).sort().pop() || null;
    const prazoMax = fases.map(f => f.prazo).filter(Boolean).sort().pop() || null;
    const totStatus = fases.map(f => f.status).sort((a, b) => statusPrioridadeContrato.indexOf(a) - statusPrioridadeContrato.indexOf(b))[0];
    const totNecessario = soma0(fases, f => f.necessario || 0) || null;
    const totRitmo = soma0(fases, f => f.ritmo || 0);
    tBodyContrato += `<tr>
      <td><b>${esc(cap(serv))}</b></td>
      <td class="n"><b>${totQtd ? nf(totQtd) : semContratoNote}</b></td>
      <td><b>${nf(totReal, 1)}</b><div style="margin-top:4px">${barra(totPct, totReal)}</div></td>
      <td class="n">${totSaldo != null ? nf(totSaldo, 1) : '—'}</td>
      <td class="n">${nf(totRitmo, 2)}</td>
      <td class="n" style="color:${totNecessario && totRitmo < totNecessario ? 'var(--vermelho)' : 'inherit'}">${totNecessario ? nf(totNecessario, 2) : '—'}</td>
      <td>${fdA(prazoMax)}</td>
      <td><b>${fdA(totProjecao)}</b></td>
      <td><span class="farol f-${COR_STATUS[totStatus] || 'pendente'}">${totStatus}</span></td>
      <td>${fases.length === 1 ? `<button class="btn-icone" data-editar-reg="cliente" data-linha="${fases[0].linha}" title="Editar / excluir serviço">✎</button>` : ''}</td></tr>`;
  });

  $('#tabContrato').innerHTML = `<thead><tr><th>Serviço</th><th class="n" title="Clique para editar">Contrato ✎</th><th class="n">Realizado</th><th class="n">Saldo</th><th class="n">Ritmo/dia</th><th class="n">Necessário/dia</th><th title="Clique para editar">Prazo ✎</th><th>Projeção</th><th>Situação</th><th></th></tr></thead><tbody>` +
    (tBodyContrato || '<tr><td colspan="10" class="vazio">Nenhum serviço para este filtro.</td></tr>') + '</tbody>';

  // avanço por empresa — filtrar serviços pela fase selecionada (global)
  const projEmpAvanco = projecoesPorEmpresa(ref);
  $('#avancoEmpresas').innerHTML = M.empresas.map(e => {
    let itens = e.servicos.map(sv => ({ sv, acum: soma(e, sv.col, '0000', ref) })).filter(x => x.sv.escopo || x.acum);
    if (faseFiltro) itens = itens.filter(x => faseItem(x.sv.frente) === faseFiltro);
    return `<div><h2 style="margin-bottom:10px"><span class="emp-tag" style="--c:${corEmp(e.nome)}">${esc(e.nome)}</span></h2>
      <table><thead><tr><th>Serviço</th><th class="n">Escopo</th><th class="n">Acum.</th><th style="min-width:90px">%</th><th>Projeção término</th><th>Situação</th></tr></thead><tbody>` +
      (itens.length ? itens.map(({ sv, acum }) => {
        const p = sv.escopo ? acum / sv.escopo * 100 : null;
        const proj = projEmpAvanco.find(x => x.emp === e.nome && x.serv === sv.nome && x.sv.col === sv.col);
        return `<tr><td>${esc(cap(sv.nome))}</td><td class="n">${nf(sv.escopo)}</td><td class="n">${nf(acum, 1)}</td>
          <td>${p == null ? '<span class="nota">sem escopo</span>' : `<div class="barra"><i style="width:${Math.min(p, 100)}%;--c:${corEmp(e.nome)}"></i></div><span class="nota">${nf(p, 1)}%</span>`}</td>
          <td>${proj ? fdA(proj.projecao) : '—'}</td>
          <td>${proj ? `<span class="farol f-${COR_STATUS[proj.status] || 'pendente'}">${proj.status}</span>` : '—'}</td></tr>`;
      }).join('') : '<tr><td colspan="6" class="vazio">Sem escopo ou produção.</td></tr>') + '</tbody></table></div>';
  }).join('');
}

// ------------------------------------------------------------ DASHBOARD CLIENTE
function prevCliente(c, ate) {
  if (!c.qtd || !c.inicio_plan || !c.meta_dia || ate < c.inicio_plan) return 0;
  return Math.min(c.qtd, c.meta_dia * contarDiasUteis(add(c.inicio_plan, -1), ate));
}
function itensCliente() {
  return M.cliente.filter(c => c.qtd && (!faseFiltro || faseItem(c.frente) === faseFiltro));
}
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

  // Agrupa itens por serviço para consolidar F1+F2
  const gruposServ = {};
  itens.forEach(it => {
    const k = it.servico.trim();
    (gruposServ[k] ||= []).push(it);
  });

  const linhas = Object.entries(gruposServ).map(([servNome, fases]) => {
    // Totais consolidados F1+F2
    const totQtd = soma0(fases, f => f.qtd || 0);
    const totInicioMin = fases.map(f => f.inicio_plan).filter(Boolean).sort()[0] || null;
    const totInicioMax = fases.map(f => f.inicio_plan).filter(Boolean).sort().pop() || null;
    const totMetaDia = fases.length === 1 ? fases[0].meta_dia : soma0(fases, f => f.meta_dia || 0) / fases.length;

    // PREVISTO PERÍODO: meta_cliente/dia × dias úteis do período (ini até c)
    const prevPer = totMetaDia * contarDiasUteis(ini, c);
    // REALIZADO PERÍODO: soma realizado de cada empresa (chamar prodServico UMA VEZ por serviço, não por fase)
    const porEmp = Object.fromEntries(emps.map(n => [n, c >= ini ? prodServico(servNome, n, ini, c) : 0]));
    const realPer = soma0(Object.values(porEmp), v => v);
    const prevAc = soma0(fases, f => prevCliente(f, c) || 0);
    const realAc = soma0(fases, f => realizadoTotal(f.servico, c) || 0);
    const saldo = Math.max(totQtd - realPer, 0);

    // Status baseado no período com margens: GAP >= +6 (ADIANTADO), GAP <= -7 (ATRASADO), entre -6 e +5 (NO LIMITE)
    const gapStatus = realPer - prevPer;
    const status = realPer >= totQtd ? 'CONCLUÍDO' : prevPer === 0 && realPer === 0 ? 'NÃO INICIADO' : gapStatus >= 6 ? 'ADIANTADO' : gapStatus <= -7 ? 'ATRASADO' : 'NO LIMITE';

    // Projeção agregada
    const projFases = fases.map(f => proj[f.servico]).filter(Boolean);
    const p = projFases.length > 0 ? projFases[0] : {};
    const prazoMax = fases.map(f => f.prazo).filter(Boolean).sort().pop() || p.prazo || null;

    const it = { servico: servNome, qtd: totQtd, inicio_plan: totInicioMin, meta_dia: totMetaDia, prazo: prazoMax };
    return { it, prevPer, porEmp, realPer, prevAc, realAc, saldo, p, status, fases };
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

  $('#cliNota').textContent = `Período ${fdA(ini)} a ${fdA(c)} · previsto = meta do cliente/dia × dias úteis desde o início planejado (F1+F2 consolidado)`;
  let h = `<thead><tr><th>Serviço</th><th class="n">Contrato</th><th>Início cliente</th><th class="n">Meta cliente/dia</th><th class="n">Previsto período</th>${emps.map(n => `<th class="n">${esc(n)}</th>`).join('')}<th class="n">Realizado período</th><th class="n">GAP período</th><th class="n">% ating.</th><th class="n">Previsto acum.</th><th class="n">Saldo</th><th>Término projetado</th><th>Prazo</th><th>Situação</th></tr></thead><tbody>`;
  linhas.forEach(l => {
    const gp = l.realPer - l.prevPer;
    const pctAting = l.prevPer > 0 ? nf(l.realPer / l.prevPer * 100) + '%' : '—';
    // Busca a linha do cliente para obter o ID de edição
    const clienteItem = M.cliente.find(c => c.servico === l.it.servico && c.qtd && (!faseFiltro || faseItem(c.frente) === faseFiltro));
    const idEdit = clienteItem?.linha ?? '';
    h += `<tr><td><b>${esc(cap(l.it.servico))}</b></td><td class="n"><b>${nf(l.it.qtd)}</b></td><td class="editavel" data-edit-campo="inicio_plan" data-edit-id="${idEdit}" data-edit-val="${l.it.inicio_plan ?? ''}">${fdA(l.it.inicio_plan)}</td><td class="n editavel" data-edit-campo="meta_dia" data-edit-id="${idEdit}" data-edit-val="${l.it.meta_dia ?? ''}">${nf(l.it.meta_dia, 2)}</td><td class="n">${nf(l.prevPer, 1)}</td>
      ${emps.map(n => `<td class="n">${l.porEmp[n] ? nf(l.porEmp[n], 1) : '—'}</td>`).join('')}
      <td class="n"><b>${nf(l.realPer, 1)}</b></td><td class="n ${gp < 0 ? 'valor-neg' : ''}">${(gp > 0 ? '+' : '') + nf(gp, 1)}</td>
      <td class="n">${pctAting}</td><td class="n"><b>${nf(l.prevAc, 1)}</b></td><td class="n">${nf(l.saldo, 1)}</td>
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
  const totProj = (reg.limites_ifc || {}).joists_no_galpao_maximo || jp.total || 0;
  const limRua = (reg.limites_ifc || {}).joists_por_rua_maximo || 43;
  const perdaPos = r.materiais.filter(m => m.perda != null && m.perda < 0).length;
  const acuMed = (() => {
    const xs = r.materiais.map(m => m.acuracidade).filter(v => v != null);
    return xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length) * 100 : null;
  })();
  tiles.innerHTML =
    t('Joists apontadas', totApont, `de ${totProj} previstas (${limRua} por rua) · ${totProj ? Math.round(100 * totApont / totProj) : 0}%`, 'var(--fg)') +
    t('Alertas', r.alertas.length, r.alertas.length ? 'ver abaixo' : 'nada crítico', r.alertas.length ? 'var(--vermelho)' : 'var(--verde)') +
    t('Perda apurada', perdaPos, 'materiais com físico < saldo teórico', perdaPos ? 'var(--amarelo)' : 'var(--fg)') +
    t('Acurácia média', acuMed == null ? '—' : nf(acuMed, 1) + '%', 'inventário × teórico', 'var(--fg)');
  nota.textContent = `Fonte: ${inv.fonte} · ${inv.totais.conjuntos} conjuntos, ${totProj} joists previstas (${limRua} por rua).`;
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
  const apontMap = {}; r.por_rua_faixa.forEach(x => { (apontMap[x.rua] ||= {})[x.faixa] = x.apontado; });
  tabRuas.innerHTML = `<thead><tr><th>Rua</th>${faixas.map(f => `<th class="n">${f}</th>`).join('')}<th class="n">Total</th></tr></thead><tbody>` +
    ruas.map(ru => {
      let tot = 0, tds = faixas.map(f => {
        const ap = (apontMap[ru] || {})[f] || 0;
        tot += ap;
        return `<td class="n ${ap > 7 ? 'valor-neg' : ''}">${ap}</td>`;
      }).join('');
      return `<tr><td><b>${ru}</b></td>${tds}<td class="n ${tot > limRua ? 'valor-neg' : tot === limRua ? 'valor-ok' : ''}">${tot}/${limRua}</td></tr>`;
    }).join('') + '</tbody>';

  // últimos apontamentos de montagem (editar/excluir em Produção > Apontar montagem)
  const evs = [...(T.apontamentos || [])].sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')) || b.linha - a.linha).slice(0, 20);
  tabEv.innerHTML = `<thead><tr><th>Data</th><th>Tipo</th><th>Rua/Eixo</th><th>Letra/Faixa</th><th class="n">Qtd</th><th>Empresa</th></tr></thead><tbody>` +
    (evs.length ? evs.map(e => `<tr><td>${fdA(e.data)}</td><td>${(e.tipo || '').toUpperCase() === 'JOIST' ? 'Joist içada' : 'Viga montada'}</td>
      <td>${esc(e.rua || e.eixo || '')}</td><td>${esc(e.letra || '')}${e.faixa ? ' · ' + esc(e.faixa) : ''}</td>
      <td class="n">${nf(e.qtd, 0)}</td><td>${esc(e.empresa || '')}</td></tr>`).join('')
      : '<tr><td colspan="6" class="vazio">Nenhum apontamento ainda. Use Produção > Apontar montagem.</td></tr>') + '</tbody>';

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
    if (e.nivel === 'vermelho') al.push(['vermelho', `<b>Material para ${esc(cap(e.serv))}</b>: a planilha de estoque indica capacidade de ${nf(e.cap.joists)} joists; a meta restante da semana é ${nf(e.rest)}${lim}.${semSaldo} <button class="link" data-ir-aba="estsis">Ver estoque</button>`]);
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
function _filtroMatLocal() { return ($('#estMatLocal')?.value || ''); }
function _filtroMatTipo() { return ($('#estMatTipo')?.value || ''); }
function ehFixador(m) { return (m.tipo_material || '').toUpperCase() === 'FIXADOR'; }

function renderEstMateriais() {
  if (!EP || !M) return;
  const regras = regrasBaixa(renderEstMateriais);
  frentesMontagem(renderEstMateriais);   // o consumo de fechamento e marquise vem do mapa do IFC
  const cvMapa = regras ? consumoVirtualPorTag(regras) : new Map();
  const consumidoDe = m => cvMapa.has(m.tag) ? cvMapa.get(m.tag).cv : m.consumido;
  const posBaixaDe = m => cvMapa.has(m.tag) ? m.chegou - cvMapa.get(m.tag).cv : m.estoque_pos_baixa;
  const itens = EP.materiais;
  const f = _filtroMat(), fe = _filtroMatEtapa(), fs = _filtroMatStatus();
  const fl = _filtroMatLocal(), ft = _filtroMatTipo();
  const vis = itens.filter(m => {
    if (f && !m.tag.toUpperCase().includes(f) && !(m.produto || '').toUpperCase().includes(f)
      && !(m.etapa || '').toUpperCase().includes(f) && !(m.local || '').toUpperCase().includes(f)) return false;
    if (fl && (m.local || '') !== fl) return false;
    if (ft === 'SO_FIXADOR' && !ehFixador(m)) return false;
    if (ft === 'SEM_FIXADOR' && ehFixador(m)) return false;
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
    tile('Fixadores', itens.filter(ehFixador).length, `${itens.length - itens.filter(ehFixador).length} itens de estrutura`, 'var(--fg3)') +
    tile('Atendimento geral', atend + '%', `${nf(totCheg)} de ${nf(totPlan)} planejados`, 'var(--acento)') +
    tile('Críticos', criticos, 'nenhuma peça chegou', 'var(--vermelho)') +
    tile('Recebimento parcial', parciais, 'falta enviar', 'var(--amarelo)');

  const locais = [...new Set(itens.map(m => m.local).filter(Boolean))].sort();
  const selL = $('#estMatLocal');
  if (selL && selL.options.length <= 1) locais.forEach(l => { const o = document.createElement('option'); o.value = l; o.textContent = l; selL.appendChild(o); });
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
  $('#tabEstMat').innerHTML = `<thead><tr><th>TAG</th><th>Material</th><th>Produto</th><th>Local</th><th>Etapa</th><th class="n">Planejado</th><th class="n">Chegou</th><th class="n">Consumido</th><th class="n">Est. Pós-Baixa</th><th class="n">Atendimento</th><th>Status</th><th>Prioridade</th></tr></thead><tbody>` +
    (vis.length ? vis.map(m => `<tr>
      <td><b>${esc(m.tag)}</b></td><td>${esc(m.material)}</td><td>${esc(m.produto)}</td>
      <td>${esc(m.local || '—')}${ehFixador(m) ? ' <span class="nota">fixador</span>' : ''}</td><td>${esc(m.etapa)}</td>
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
  const ed = estEdit.rem, cxR = $('#tabEstRem').closest('.tabela-rolagem'), sxR = cxR.scrollLeft;
  $('#tabEstRem').innerHTML = `<thead><tr><th>TAG</th><th>Material</th><th>Produto</th><th>Etapa</th>` +
    cols.map(c => {
      const dt = (rem.datas || {})[c] || {};
      const linha = (rot, v) => v ? `<div class="rem-data"><span>${rot}</span>${esc(v)}</div>` : '';
      const dicas = [dt.prevista_chegada && `prevista ${dt.prevista_chegada}`,
        dt.emissao_nota && `nota ${dt.emissao_nota}`,
        dt.chegada_obra && `chegada ${dt.chegada_obra}`].filter(Boolean).join(' · ');
      return `<th class="n" title="${esc(c)}${dicas ? ' — ' + esc(dicas) : ''}">${esc(abrev(c))}`
        + linha('prev.', dt.prevista_chegada) + linha('NF', dt.emissao_nota)
        + linha('obra', dt.chegada_obra) + `</th>`;
    }).join('') +
    (ed ? `<th class="n col-nova"><input class="ed-cab" data-ed="rem" placeholder="Nº da remessa" value="${esc(ed.nome)}" aria-label="Nº da remessa"></th>` : '') +
    `<th class="n">Total</th></tr></thead><tbody>` +
    (vis.length ? vis.map(m => `<tr><td><b>${esc(m.tag)}</b></td><td>${esc(m.material)}</td><td>${esc(m.produto)}</td><td>${esc(m.etapa)}</td>` +
      cols.map(c => { const q = m.qtd_por_remessa[c]; return `<td class="n">${q ? nf(q) : ''}</td>`; }).join('') +
      (ed ? `<td class="col-nova"><input class="ed-in" data-ed="rem" data-tag="${esc(m.tag)}" data-col="q" inputmode="decimal" value="${esc(ed.val.get(m.tag) || '')}" aria-label="${esc(m.tag)}"></td>` : '') +
      `<td class="n"><b>${nf(m.total_recebido)}</b></td></tr>`).join('')
    : `<tr><td colspan="${4 + cols.length + (ed ? 1 : 0) + 1}" class="vazio">Nenhum item encontrado.</td></tr>`) + '</tbody>';
  cxR.scrollLeft = sxR;   // redesenhar (filtro, digitação) não pode voltar a tabela para o início
  edBarra('rem');
}

// ---- edição direta na tabela: "+ Nova remessa" / "+ Registrar consumo" abrem uma coluna nova para digitar
const estEdit = { rem: null, cons: null };   // { nome, val: Map } enquanto a coluna nova está aberta
const ED = {
  rem: { tabela: '#tabEstRem', barra: '#estRemEd', rotulo: 'remessa', endpoint: 'estoque-planilha/remessa', campo: 'remessa', render: () => renderEstRemessas() },
  cons: { tabela: '#tabEstCons', barra: '#estConsEd', rotulo: 'semana', endpoint: 'estoque-planilha/consumo', campo: 'semana', render: () => renderEstConsumo() },
};
const edNum = v => Number(String(v).trim().replace(/\./g, '').replace(',', '.'));
function edItens(k) {
  const ed = estEdit[k], itens = [];
  let erro = null;
  ed.val.forEach((v, chave) => {
    if (!String(v).trim()) return;
    const [tag, emp] = chave.split('|'), q = edNum(v);
    if (!(q > 0)) erro ||= `${tag}${emp ? ' (' + emp + ')' : ''}: quantidade inválida.`;
    else itens.push({ tag, empresa: emp || undefined, quantidade: q });
  });
  return { itens, erro };
}
function edBarra(k) {
  const box = $(ED[k].barra), ed = estEdit[k];
  if (!box) return;
  box.hidden = !ed;
  if (!ed) { box.innerHTML = ''; return; }
  const { itens } = edItens(k), tot = itens.reduce((s, i) => s + i.quantidade, 0);
  const resumo = !itens.length ? 'Digite as quantidades na coluna nova' : k === 'cons'
    ? `${itens.length} lançamento(s) · EJ ${nf(itens.filter(i => i.empresa === 'EJ').reduce((s, i) => s + i.quantidade, 0))} · CMM ${nf(itens.filter(i => i.empresa === 'CMM').reduce((s, i) => s + i.quantidade, 0))}`
    : `${itens.length} item(ns) · total ${nf(tot)}`;
  if (!box.dataset.pronto) {
    box.dataset.pronto = '1';
    const datasHtml = k === 'rem'
      ? `<span class="ed-datas"><label>Prev. chegada<input class="ed-dat" data-ed="${k}" data-ed-dat="prevista" placeholder="dd/mm/aaaa" value="${esc(ed.prevista)}"></label>`
        + `<label>Emissão NF<input class="ed-dat" data-ed="${k}" data-ed-dat="emissaoNf" placeholder="dd/mm/aaaa" value="${esc(ed.emissaoNf)}"></label>`
        + `<label>Chegada obra<input class="ed-dat" data-ed="${k}" data-ed-dat="chegadaObra" placeholder="dd/mm/aaaa" value="${esc(ed.chegadaObra)}"></label></span>` : '';
    box.innerHTML = `<span><b>${k === 'rem' ? 'Nova remessa' : 'Novo consumo'}:</b> preencha a coluna no fim da tabela e escreva o ${k === 'rem' ? 'nº da remessa' : 'período da semana'} no cabeçalho.</span>`
      + datasHtml
      + `<span class="ed-resumo"></span><span class="espaco"></span>`
      + `<button type="button" class="btn" data-ed-cancelar="${k}">Cancelar</button>`
      + `<button type="button" class="btn primario btn-salvar-destino" data-ed-salvar="${k}">Salvar</button>`;
  }
  box.querySelector('.ed-resumo').textContent = resumo;
}
function edAbrir(k) {
  if (!EP) return;
  if (!estEdit[k]) estEdit[k] = k === 'rem'
    ? { nome: '', val: new Map(), prevista: '', emissaoNf: '', chegadaObra: '' }
    : { nome: '', val: new Map() };
  $(ED[k].barra).dataset.pronto = '';
  ED[k].render();
  const cab = $(ED[k].tabela).querySelector('.ed-cab');
  const cx = $(ED[k].tabela).closest('.tabela-rolagem');
  cx.scrollLeft = cx.scrollWidth;   // mostra as últimas colunas, com a nova à direita
  if (cab) cab.focus({ preventScroll: true });
  agendarScrollTopo();
}
function edFechar(k) { estEdit[k] = null; $(ED[k].barra).dataset.pronto = ''; ED[k].render(); }
async function edSalvar(k) {
  const ed = estEdit[k], nome = (ed?.nome || '').trim();
  if (!nome) { toast(`Escreva ${k === 'rem' ? 'o nº da remessa' : 'a semana'} no cabeçalho da coluna nova.`, true); $(ED[k].tabela).querySelector('.ed-cab')?.focus(); return; }
  const { itens, erro } = edItens(k);
  if (erro) { toast(erro, true); return; }
  if (!itens.length) { toast('Digite ao menos uma quantidade.', true); return; }
  const b = document.querySelector(`[data-ed-salvar="${k}"]`); b.disabled = true;
  try {
    const corpo = { [ED[k].campo]: nome, itens };
    if (k === 'rem' && (ed.prevista || ed.emissaoNf || ed.chegadaObra)) {
      corpo.datas = { prevista_chegada: ed.prevista, emissao_nota: ed.emissaoNf, chegada_obra: ed.chegadaObra };
    }
    const r = await postar(API + ED[k].endpoint, corpo);
    const j = await fetch(API + 'estoque-planilha', { cache: 'no-store' }).then(x => x.ok ? x.json() : null);
    if (j) EP = j;
    estEdit[k] = null; $(ED[k].barra).dataset.pronto = '';
    renderEstoquePlanilha();
    toast(`${r.salvos ?? itens.length} lançamento(s) salvos ${ONDE}`);
  } catch (err) { toast(err.message, true); b.disabled = false; }
}
function ligarEdicaoEstoque() {
  const secs = [$('#aba-estrem'), $('#aba-estcons')];
  const sec = { addEventListener: (ev, fn) => secs.forEach(s => s.addEventListener(ev, fn)) };
  $('#btnNovaRemessa').onclick = () => edAbrir('rem');
  $('#btnNovoConsumo').onclick = () => edAbrir('cons');
  sec.addEventListener('input', ev => {
    const el = ev.target, k = el.dataset.ed;
    if (!k || !estEdit[k]) return;
    if (el.classList.contains('ed-cab')) estEdit[k].nome = el.value;
    else if (el.dataset.edDat) { estEdit[k][el.dataset.edDat] = el.value; }
    else {
      const chave = el.dataset.emp ? `${el.dataset.tag}|${el.dataset.emp}` : el.dataset.tag;
      estEdit[k].val.set(chave, el.value);
      el.classList.toggle('preenchido', !!el.value.trim());
      edBarra(k);
    }
  });
  sec.addEventListener('keydown', ev => {
    const el = ev.target;
    if (!el.classList?.contains('ed-in') || ev.key !== 'Enter') return;
    ev.preventDefault();   // Enter desce na mesma coluna
    let tr = el.closest('tr').nextElementSibling;
    const seletor = `.ed-in[data-ed="${el.dataset.ed}"]${el.dataset.emp ? `[data-emp="${el.dataset.emp}"]` : ''}`;
    const prox = tr?.querySelector(seletor);
    if (prox) { prox.focus(); prox.select(); }
  });
  sec.addEventListener('click', ev => {
    const c = ev.target.closest('[data-ed-cancelar]'), s = ev.target.closest('[data-ed-salvar]');
    if (s) return edSalvar(s.dataset.edSalvar);
    if (c) {
      const k = c.dataset.edCancelar;
      if (edItens(k).itens.length && !c.dataset.confirmar) { c.dataset.confirmar = '1'; c.textContent = 'Descartar o que digitei?'; return; }
      edFechar(k);
    }
  });
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
  const ed = estEdit.cons, cxC = $('#tabEstCons').closest('.tabela-rolagem'), sxC = cxC.scrollLeft;
  const inp = (m, emp) => `<td class="col-nova"><input class="ed-in" data-ed="cons" data-tag="${esc(m.tag)}" data-emp="${emp}" inputmode="decimal" value="${esc(ed.val.get(m.tag + '|' + emp) || '')}" aria-label="${esc(m.tag)} ${emp}"></td>`;
  $('#tabEstCons').innerHTML = `<thead><tr><th>TAG</th><th>Produto</th>` +
    sems.map(s => `<th class="n" colspan="2" title="${esc(s)}">${esc(abrevS(s))}</th>`).join('') +
    (ed ? `<th class="n col-nova" colspan="2"><input class="ed-cab" data-ed="cons" placeholder="Semana (ex: 28/09 a 02/10)" value="${esc(ed.nome)}" aria-label="Semana"></th>` : '') +
    `<th class="n">Total</th></tr><tr><th></th><th></th>` +
    sems.map(() => `<th class="n" style="color:var(--ej)">EJ</th><th class="n" style="color:var(--cmm)">CMM</th>`).join('') +
    (ed ? `<th class="n col-nova" style="color:var(--ej)">EJ</th><th class="n col-nova" style="color:var(--cmm)">CMM</th>` : '') +
    `<th></th></tr></thead><tbody>` +
    (vis.length ? vis.map(m => `<tr><td><b>${esc(m.tag)}</b></td><td>${esc(m.produto)}</td>` +
      sems.map(s => { const d = m.consumo_semanas[s]; return `<td class="n">${d ? nf(d.EJ) : ''}</td><td class="n">${d ? nf(d.CMM) : ''}</td>`; }).join('') +
      (ed ? inp(m, 'EJ') + inp(m, 'CMM') : '') +
      `<td class="n"><b>${nf(m.total_consumo)}</b></td></tr>`).join('')
    : `<tr><td colspan="${2 + sems.length * 2 + (ed ? 2 : 0) + 1}" class="vazio">Nenhum item encontrado.</td></tr>`) + '</tbody>';
  cxC.scrollLeft = sxC;
  edBarra('cons');

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

// Consumo virtual por TAG. PREMONTAGEM = produção x composição. Montagem (joists e vigas) = apontamento por quadrante/tipo
// de viga (exato); joists içadas ainda sem quadrante usam a divisão média (estimada). Vigas sem tipo apontado ainda não
// têm consumo contabilizado. Itens sem regra mensurável ficam fora do mapa e mantêm o valor da planilha.
const FRENTE_CHAVE = { FECHAMENTO: 'fechamento', MARQUISE: 'marquise', CONTRAVENTAMENTO: 'contraventamento' };

// Fixadores que um trecho de frente consome: kit de cada família (do projeto) x peças daquele trecho no IFC.
// O contraventamento não tem baixa. Devolve [] quando o mapa do IFC ainda não foi carregado.
function fixadoresDoTrecho(tipo, parte, trecho, etapa, regras) {
  const chave = FRENTE_CHAVE[String(tipo || '').toUpperCase()];
  const fr = chave && ((window._frentes || {}).frentes || {})[chave];
  if (!fr || chave === 'contraventamento') return [];
  const conf = (regras.consumo_por_servico || {})[chave === 'marquise' ? 'MARQUISE' : (etapa || fr.servico)] || {};
  const porPeca = conf.por_peca || (conf.por_etapa || {})[etapa] || {};
  if (!Object.keys(porPeca).length) return [];
  const p = (fr.partes || []).find(x => x.id === parte);
  const cel = p && p.celulas.find(c => c.trecho === trecho);
  if (!cel) return [];
  const saida = [];
  Object.entries(cel.pecas).forEach(([familia, n]) =>
    (porPeca[familia] || []).forEach(b => saida.push({ codigo: b.codigo, quantidade: b.quantidade * n, familia })));
  return saida;
}

function consumoVirtualPorTag(regras) {
  const servicos = regras.consumo_por_servico || {};
  const cfgAp = regras.apontamento || {};
  const aps = T.apontamentos || [];
  const apJoists = soma0(aps.filter(a => (a.tipo || '').toUpperCase() === 'JOIST'), a => a.qtd);
  const apVigas = aps.filter(a => (a.tipo || '').toUpperCase() === 'VIGA').length;
  const prodVigas = cfgAp.servico_viga ? prodServico(cfgAp.servico_viga, null, '0000-01-01', '9999-12-31') : 0;
  const evCons = new Map(((M.estoque_ifc || {}).resumo?.materiais || []).filter(x => x.consumo_teorico).map(x => [x.codigo, x.consumo_teorico]));
  const tagsViga = new Set((regras.eventos || []).filter(e => (e.codigo || '').startsWith('VIGA_')).flatMap(e => (e.baixa || []).map(b => b.codigo)));

  const acum = new Map();
  const entrada = cod => { let o = acum.get(cod); if (!o) acum.set(cod, o = { qtd: 0, partes: [], estimado: false, parcial: false, apont: false }); return o; };
  Object.entries(servicos).forEach(([nome, conf]) => {
    if (nome.startsWith('_') || !conf.itens) return;
    if (!M.empresas.some(e => e.servicos.some(s => s.nome === nome))) return;
    let n = prodServico(nome, null, '0000-01-01', '9999-12-31');
    let rotulo = cap(nome);
    if (nome === cfgAp.servico_joist) { n = Math.max(0, n - apJoists); rotulo += ' sem quadrante'; }
    conf.itens.forEach(it => {
      const o = entrada(it.codigo);
      o.qtd += it.por_unidade * n;
      if (n > 0) o.partes.push(`${nf(n)} ${rotulo} × ${nf(it.por_unidade, 2)}`);
      if (it.estimado && n > 0) o.estimado = true;
    });
  });
  evCons.forEach((q, cod) => { const o = entrada(cod); o.qtd += q; o.apont = true; o.partes.push(`${nf(q)} por apontamento`); });

  // fechamento lateral e marquise: cada trecho apontado consome os fixadores do projeto
  const porFrente = new Map();
  aps.filter(a => FRENTE_CHAVE[(a.tipo || '').toUpperCase()]).forEach(a => {
    fixadoresDoTrecho(a.tipo, a.faixa, a.rua, a.letra || '', regras).forEach(b => {
      const o = porFrente.get(b.codigo) || { qtd: 0, trechos: 0 };
      o.qtd += b.quantidade; o.trechos++;
      porFrente.set(b.codigo, o);
    });
  });
  porFrente.forEach((o, cod) => {
    const e = entrada(cod);
    e.qtd += o.qtd; e.apont = true;
    e.partes.push(`${nf(o.qtd)} em ${nf(o.trechos)} trecho(s) de fechamento/marquise apontados`);
  });

  const mapa = new Map();
  acum.forEach((o, tag) => {
    const parcial = o.apont && tagsViga.has(tag) && prodVigas > apVigas;
    const nota = o.partes.join(' + ') + (o.estimado ? ' (joists sem quadrante: divisão entre tipos de parafuso estimada)' : '')
      + (parcial ? ` (${nf(apVigas)} de ${nf(prodVigas)} vigas apontadas; as demais ainda não entram)` : '');
    mapa.set(tag, { cv: Math.round(o.qtd), origem: o.apont ? 'apontamento' : 'producao', estimado: o.estimado, parcial, nota });
  });
  (regras.inventario_ajustes || []).forEach(a => mapa.set(a.tag, { cv: a.consumo_virtual, origem: 'ajuste', estimado: false, parcial: false, nota: a.motivo }));
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
      delta: c.cv - m.consumo_virtual, origem: c.origem, estimado: c.estimado, parcial: !!c.parcial, nota: c.nota, ...derivarInventario(base, c.cv, cf) };
  });
}

function renderEstInventario() {
  if (!EP || !M) return;
  const regras = regrasBaixa(renderEstInventario);
  frentesMontagem(renderEstInventario);   // o consumo de fechamento e marquise vem do mapa do IFC
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
  const cfgAp = regras.apontamento || {}, aps = T.apontamentos || [];
  const pendJ = Math.max(0, ic - soma0(aps.filter(a => (a.tipo || '').toUpperCase() === 'JOIST'), a => a.qtd));
  const pendV = Math.max(0, prodServico(cfgAp.servico_viga || 'VIGAS', null, '0000-01-01', '9999-12-31') - aps.filter(a => (a.tipo || '').toUpperCase() === 'VIGA').length);
  $('#estInvNota').textContent = `Consumo virtual = produção acumulada (${nf(prem)} joists pré-montadas, ${nf(ic)} içadas) × regras de baixa, com o tipo exato vindo do Apontamento de montagem. Faltam apontar ${nf(pendJ)} joists (quadrante) e ${nf(pendV)} vigas (tipo): por isso ≈ (parafusos estimados) e ≥ (fixadores de viga parciais).`;
  $('#estInvTiles').innerHTML =
    tile('Itens avaliados', avaliados.length, `${vis.length} visíveis`, 'var(--fg)') +
    tile('Acuracidade média', nf(acuMedia, 1) + '%', 'meta >= 98%', 'var(--acento)') +
    tile('Críticos', criticos, 'acuracidade < 95%', 'var(--vermelho)') +
    tile('Conformes', conformes, 'acuracidade >= 98%', 'var(--verde)') +
    tile('Consumo virtual corrigido', corrigidos, 'diferem da planilha', corrigidos ? 'var(--amarelo)' : 'var(--verde)');

  const farolAcu = s => ({ CONFORME: 'verde', ATENCAO: 'amarelo', CRITICO: 'vermelho' })[norm(s)] || 'pendente';
  const ROT_ORIGEM = { producao: ['verde', 'Produção'], apontamento: ['verde', 'Apontamento'], ajuste: ['amarelo', 'Ajuste'], planilha: ['pendente', 'Planilha'] };
  const sinal = v => (v > 0 ? '+' : '') + nf(v);
  $('#tabEstInv').innerHTML = `<thead><tr><th>TAG</th><th>Produto</th><th class="n">Planejado</th><th class="n">Recebido</th><th class="n">Est. Físico</th><th class="n">Consumo Virtual</th><th>Origem</th><th class="n">Consumo Físico</th><th class="n">Est. Virtual Atual</th><th class="n">Perda Real</th><th class="n">Acuracidade</th><th>Status</th><th>Ação</th></tr></thead><tbody>` +
    (vis.length ? vis.map(m => {
      const [oc, ot] = ROT_ORIGEM[m.origem] || ['pendente', '—'];
      return `<tr>
      <td><b>${esc(m.tag)}</b></td><td>${esc(m.produto)}</td>
      <td class="n">${nf(m.planejado)}</td><td class="n">${nf(m.estoque_virtual_base)}</td><td class="n">${nf(m.estoque_fisico)}</td>
      <td class="n"><b>${m.parcial ? '≥ ' : ''}${nf(m.consumo_virtual)}</b>${m.estimado ? ' ≈' : ''}${Math.abs(m.delta) >= 1 ? `<br><span class="nota">planilha ${nf(m.consumo_planilha)} (${sinal(m.delta)})</span>` : ''}</td>
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
  frentesMontagem(renderEstCriticos);   // o consumo de fechamento e marquise vem do mapa do IFC
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

// ------------------------------------------------------------ APONTAMENTO DE MONTAGEM
// Fonte única da montagem: cada apontamento (joists por quadrante, vigas por eixo/letra) soma na grade de produção
// (de onde vêm BM, cronograma e dashboards) e define os fixadores baixados no estoque.
// A empresa é indicada em cada clique ("pincel" na barra do topo): quem montou é quem entra no BM.
// Modos: 'mapa' (clicar na planta: 43 retângulos de joist por rua + quadrados de viga) e 'viga' (digitação por eixo).
const apEst = { modo: 'mapa', data: null, empresa: null, eixo: '11', sel: new Set(),
  mapaJ: new Map(), mapaV: new Map(), fase: 'fase1', zoom: 'normal', regular: false, obs: '',
  frente: new Map(), etapa: '' };   // frente: chave `tipo|parte|trecho|etapa` -> empresa que montou
// Frentes montadas fora do plano das joists, extraídas do IFC (fechamento lateral, marquise e contraventamento).
const AP_FRENTE = { fech: 'FECHAMENTO', marq: 'MARQUISE', cont: 'CONTRAVENTAMENTO' };
function frentesMontagem(refazer) {
  if (window._frentes) return window._frentes.frentes ? window._frentes : null;
  if (!window._frentes_pend) {
    window._frentes_pend = fetch(API + 'frentes-montagem', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null).catch(() => null).then(j => { window._frentes = j || { frentes: {} }; });
  }
  window._frentes_pend.then(refazer);
  return null;
}
const apFrenteAtual = () => {
  const f = window._frentes && window._frentes.frentes;
  return f ? f[{ fech: 'fechamento', marq: 'marquise', cont: 'contraventamento' }[apEst.modo]] : null;
};
const AP_TIPO = { VIGA_APOIO_MONTADA: 'Apoio', VIGA_INTERM_MONTADA: 'Intermediária', VIGA_VC01_MONTADA: 'VC01' };
// geometria do mapa (px): cada rua tem 43 retângulos (joists); `passo` é a altura de cada um, em três tamanhos
const APM_PASSO = { compacto: 10, normal: 14, grande: 19 };
const APM = { mEsq: 70, mTop: 44, pad: 6 };
const corSelEmp = emp => `var(${COR_EMP[emp] || '--acento'})`;

function apContexto(regras) {
  const cfg = regras.apontamento, crit = regras.criterio_por_letra, pos = regras.faixas_posicoes;
  const layout = Object.entries(regras.layout_joists || {}).filter(([f]) => f !== 'nota').flatMap(([f, ls]) => ls.map(l => ({ faixa: f, letra: l })));
  const aps = T.apontamentos || [];
  const joists = aps.filter(a => (a.tipo || '').toUpperCase() === 'JOIST');
  const vigas = aps.filter(a => (a.tipo || '').toUpperCase() === 'VIGA');
  const vigaMontada = new Map(vigas.map(a => [a.viga_id, a]));
  const porPos = new Map(), totalRua = new Map(), slotRow = new Map();
  joists.forEach(a => {
    const k = `${a.rua}/${a.faixa}/${a.letra}`, q = a.qtd || 0;
    porPos.set(k, (porPos.get(k) || 0) + q);
    totalRua.set(a.rua, (totalRua.get(a.rua) || 0) + q);
    if (a.slot) slotRow.set(`${a.rua}|${a.slot}`, a);
  });
  // registros antigos sem número de joist ocupam os primeiros retângulos livres da mesma viga de apoio
  joists.filter(a => !a.slot).forEach(a => {
    let n = a.qtd || 0;
    layout.forEach((p, i) => { if (n > 0 && p.faixa === a.faixa && p.letra === a.letra && !slotRow.has(`${a.rua}|${i + 1}`)) { slotRow.set(`${a.rua}|${i + 1}`, a); n--; } });
  });
  const vigaId = (eixo, letra) => `E${eixo}-${letra}-${crit[letra].viga}`;
  const ruas = cfg.eixos.slice(0, -1).map((e, i) => `${e}-${cfg.eixos[i + 1]}`);
  const quadrante = (rua, faixa) => {
    const [a, b] = rua.split('-');
    const n = pos[faixa].reduce((s, l) => s + (porPos.get(`${rua}/${faixa}/${l}`) || 0), 0);
    const faltam = [a, b].flatMap(e => pos[faixa].filter(l => !vigaMontada.has(vigaId(e, l))).map(l => vigaId(e, l)));
    return { n, faltam, liberado: !faltam.length };
  };
  const lim = regras.limites_ifc || {};
  return { cfg, crit, pos, layout, joists, vigas, vigaMontada, porPos, totalRua, slotRow, vigaId, ruas, quadrante, letras: Object.keys(crit),
    limRua: lim.joists_por_rua_maximo || 43, limGalpao: lim.joists_no_galpao_maximo || 817,
    evento: cod => (regras.eventos || []).find(e => e.codigo === cod) || {} };
}

const apEmpresas = ctx => apEmpresasDe(ctx.cfg.servico_joist);
const apEmpresasDe = servico => M.empresas.filter(e => e.servicos.some(s => s.nome === servico));

function apGarantirEstado(ctx) {
  if (!apEst.data) apEst.data = M.datas.includes(ref) ? ref : (M.datas.filter(d => d <= hoje()).pop() || M.datas[0]);
  if (!apEmpresas(ctx).some(e => e.nome === apEst.empresa)) apEst.empresa = null;
  if (!ctx.cfg.eixos.includes(apEst.eixo)) apEst.eixo = ctx.cfg.eixos[0];
}

// Seleção atual convertida em peças (cada uma com a empresa que montou) e em grupos empresa + serviço.
// Código do material -> nome legível (do catálogo de materiais e das descrições nas regras de baixa).
function codigosBaixa(regras) {
  const n = {};
  (regras.eventos || []).forEach(e => (e.baixa || []).concat(e.baixa_por_joist || [])
    .forEach(b => { if (b.codigo && b.descricao) n[b.codigo] = b.descricao; }));
  Object.values(regras.consumo_por_servico || {}).forEach(s => {
    const grupos = [s.por_peca, ...Object.values(s.por_etapa || {})].filter(Boolean);
    grupos.forEach(g => Object.values(g).forEach(lista => lista.forEach(b => { if (b.descricao) n[b.codigo] = b.descricao; })));
    (s.itens || []).forEach(b => { if (b.descricao) n[b.codigo] = b.descricao; });
  });
  (EP ? EP.materiais || [] : []).forEach(m => { if (m.tag && m.produto) n[m.tag] = m.produto; });
  return n;
}

function apSelecao(ctx) {
  const extrasJ = (ctx.evento('JOIST_ICADA').baixa_por_joist || []).filter(b => b.codigo !== 'PARAFUSO_FIX_JOIST');
  const joists = [], vigas = [];
  if (apEst.modo === 'mapa') {
    apEst.mapaJ.forEach((emp, k) => { const [rua, slot] = k.split('|'), p = ctx.layout[+slot - 1]; joists.push({ rua, slot: +slot, faixa: p.faixa, letra: p.letra, n: 1, emp }); });
    apEst.mapaV.forEach((emp, k) => { const [eixo, letra] = k.split('|'); vigas.push({ eixo, letra, emp }); });
  } else if (apEst.modo === 'viga') apEst.sel.forEach(l => vigas.push({ eixo: apEst.eixo, letra: l, emp: apEst.empresa }));
  const frente = [];
  apEst.frente.forEach((emp, k) => { const [tipo, parte, trecho, etapa] = k.split('|'); frente.push({ tipo, parte, trecho, etapa, emp }); });

  const grupos = new Map(), baixa = new Map();
  const soma = (cod, q) => baixa.set(cod, (baixa.get(cod) || 0) + q);
  const grupo = (emp, servico) => { const k = (emp || '') + '|' + servico; if (!grupos.has(k)) grupos.set(k, { emp, servico, delta: 0 }); return grupos.get(k); };
  joists.forEach(j => {
    grupo(j.emp, ctx.cfg.servico_joist).delta += 1;
    soma(ctx.crit[j.letra].parafuso, 8);
    extrasJ.forEach(b => soma(b.codigo, b.quantidade));
  });
  vigas.forEach(v => {
    grupo(v.emp, ctx.cfg.servico_viga).delta += 1;
    (ctx.evento(ctx.crit[v.letra].evento_viga).baixa || []).forEach(b => soma(b.codigo, b.quantidade));
  });
  const fs = (window._frentes || {}).frentes || {};
  const regras = window._regras_baixa || {};
  frente.forEach(f => {
    const chaveF = { FECHAMENTO: 'fechamento', MARQUISE: 'marquise', CONTRAVENTAMENTO: 'contraventamento' }[f.tipo];
    const cfgF = fs[chaveF] || {};
    // no contraventamento a "etapa" guarda o trecho do kit, não um serviço
    grupo(f.emp, chave === 'contraventamento' ? null : (f.etapa || cfgF.servico || null)).delta += 1;
    fixadoresDoTrecho(f.tipo, f.parte, f.trecho, f.etapa, regras).forEach(b => soma(b.codigo, b.quantidade));
  });
  const porEmp = {};
  [...joists, ...vigas, ...frente].forEach(x => porEmp[x.emp || '?'] = (porEmp[x.emp || '?'] || 0) + 1);
  return { joists, vigas, frente, grupos: [...grupos.values()], baixa, porEmp,
    semEmpresa: [...joists, ...vigas, ...frente].some(x => !x.emp),
    nJ: joists.length, nV: vigas.length, nF: frente.length };
}

function apEfeitosHtml(regras, ctx) {
  const sel = apSelecao(ctx);
  if (!sel.nJ && !sel.nV && !sel.nF) return '<p class="vazio">Selecione as peças para ver o efeito na produção, no BM e no estoque.</p>';
  const data = apEst.data, somar = !apEst.regular, itens = [], avisos = [];
  if (sel.semEmpresa) avisos.push('Indique a empresa que montou (barra no topo) antes de salvar.');
  sel.grupos.filter(g => g.emp).forEach(g => {
    if (!g.servico) {
      itens.push(`<b>${esc(g.emp)}:</b> ${nf(g.delta)} trecho(s) de contraventamento registrados como controle (não há coluna no controle de produção, então não somam na produção nem no BM).`);
      return;
    }
    const e = empresa(g.emp), col = e && colDe(e, g.servico);
    const meta = M.metas.find(m => m.empresa === g.emp && m.servico === g.servico && m.inicio <= data && m.fim >= data);
    let t = `<b>${esc(g.emp)} · ${esc(cap(g.servico))}:</b> `;
    if (somar) {
      t += `+${nf(g.delta)} em ${fdA(data)}.`;
      if (meta && col) {
        const real = soma(e, col, meta.inicio, meta.fim), alvo = metaSemanaTotal(meta);
        t += ` Semana ${nf(real)} → ${nf(real + g.delta)} de ${nf(alvo, 1)} previstos${alvo ? ` (${nf((real + g.delta) / alvo * 100, 0)}%)` : ''}.`;
      } else t += ' Sem meta para essa semana.';
    } else t += `${nf(g.delta)} em regularização (já estão no Lançamentos).`;
    const ats = bmAtiv(g.emp).filter(a => a.controle === g.servico);
    const perBm = bmPeriodos(g.emp).find(p => data >= p.ini && data <= p.fim);
    if (ats.length) {
      const a = ats[0], acum = bmRealizado(a, '9999-12-31');
      t += ` <b>BM:</b> ${esc(a.atividade)} ${somar ? `${nf(acum, 1)} → ${nf(acum + g.delta, 1)}` : nf(acum, 1)} de ${nf(a.qtd, 1)} ${esc(a.unidade || '')}${perBm ? ` (BM${perBm.n} ${perBm.fechado ? 'fechado' : 'em aberto'})` : ''}.`;
    }
    if (somar && perBm && perBm.fechado) avisos.push(`${g.emp}: a data cai no BM${perBm.n}, já fechado; a produção entra como ajuste no BM em aberto.`);
    itens.push(t);
  });
  const nomes = codigosBaixa(regras);
  const baixa = [...sel.baixa].filter(([, q]) => q > 0).sort((a, b) => b[1] - a[1]);
  itens.push(baixa.length
    ? `<b>Estoque (baixa automática):</b> ${baixa.map(([c, q]) => `${esc(nomes[c] || c)} <b>×${nf(q)}</b>`).join(' · ')}.`
    : '<b>Estoque:</b> nenhum fixador mapeado para esta seleção.');


  const idsSel = new Set(sel.vigas.map(v => ctx.vigaId(v.eixo, v.letra)));
  const quads = new Set(sel.joists.map(j => `${j.rua}/${j.faixa}`));
  quads.forEach(k => {
    const [rua, faixa] = k.split('/'), q = ctx.quadrante(rua, faixa);
    const falta = q.faltam.filter(id => !idsSel.has(id));
    if (falta.length) avisos.push(`Rua ${rua} faixa ${faixa}: vigas ainda não apontadas (${falta.join(', ')}).`);
  });
  return `<ul class="ap-efeitos">${itens.map(t => `<li>${t}</li>`).join('')}</ul>` +
    (avisos.length ? `<ul class="alertas">${avisos.map(a => `<li><span class="farol f-amarelo">Atenção</span><span>${esc(a)}</span></li>`).join('')}</ul>` : '');
}

function apResumoTxt(ctx) {
  const s = apSelecao(ctx);
  if (!s.nJ && !s.nV && !s.nF) return 'Nada selecionado';
  const emps = Object.entries(s.porEmp).map(([e, n]) => `${e === '?' ? 'sem empresa' : e} ${nf(n)}`).join(' · ');
  const partes = [s.nJ ? `${nf(s.nJ)} joist(s)` : '', s.nV ? `${nf(s.nV)} viga(s)` : '', s.nF ? `${nf(s.nF)} trecho(s)` : ''].filter(Boolean);
  return `Seleção: ${partes.join(' · ')} (${emps})`;
}

// Barra fixa no topo: empresa que montou (vale para os próximos cliques), resumo e ações.
function apBarraHtml(ctx) {
  const emps = apEmpresas(ctx);
  return `<span class="ap-pincel ${apEst.empresa ? '' : 'pede'}"><span class="ap-pincel-rot">Empresa que montou</span>
      <span class="seg" id="segApEmp">${emps.map(e => `<button data-ap-emp="${esc(e.nome)}" class="${e.nome === apEst.empresa ? 'ativa' : ''}" style="--c:${corEmp(e.nome)}">${esc(e.nome)}</button>`).join('')}</span>
      ${apEst.empresa ? '' : '<span class="nota">escolha antes de clicar</span>'}</span>
    <span id="apResumo" class="ap-resumo">${apResumoTxt(ctx)}</span>
    <span class="ap-botoes"><button class="btn" id="apLimpar">Limpar seleção</button><button class="btn primario" id="apSalvar">Salvar apontamento</button></span>`;
}

function apFormHtml(regras, ctx) {
  const s = apEst;
  const data = `<label class="rot-sel">Data <input type="date" id="apData" value="${s.data}" min="${M.datas[0]}" max="${M.datas[M.datas.length - 1]}"></label>`;
  const rodape = `<label class="ap-check"><input type="checkbox" id="apRegular" ${s.regular ? 'checked' : ''}> Regularização: já está no Lançamentos, não somar de novo na produção</label>
    <input type="text" id="apObs" class="input-filtro" placeholder="Observação / nº RDO" value="${esc(s.obs)}">`;
  let h = '';
  if (s.modo in AP_FRENTE) {
    const fr = apFrenteAtual();
    h += `<div class="ap-linha">${data}</div>
      <p class="nota">Escolha a empresa na barra do topo${fr && fr.etapas ? ', a etapa no mapa' : ''} e clique nos trechos montados. ${esc(fr ? fr.titulo : '')} vem do IFC do galpão: ${fr ? nf(fr.total) : '—'} peças.</p>
      <div class="ap-linha">${rodape}</div>`;
  } else if (s.modo === 'mapa') {
    h += `<div class="ap-linha">${data}</div>
      <p class="nota">Escolha a empresa na barra do topo e clique nos retângulos (joists) e nos quadrados (vigas) do mapa; dá para arrastar o mouse sobre várias joists. Cada peça fica com a empresa escolhida no momento do clique; dá para alternar entre EJ e CMM no mesmo salvamento.</p><div class="ap-linha">${rodape}</div>`;
  } else {
    h += `<div class="ap-linha">${data}
      <label class="rot-sel">Eixo <select id="apEixo">${ctx.cfg.eixos.map(x => `<option ${x === s.eixo ? 'selected' : ''}>${x}</option>`).join('')}</select></label></div>
      <p class="nota">Marque as vigas montadas neste eixo (a empresa é a da barra do topo). Cada viga só pode ser apontada uma vez; o kit de fixadores vem do tipo.</p>
      <div class="ap-chips">${ctx.letras.map(l => {
        const c = ctx.crit[l], m = ctx.vigaMontada.get(ctx.vigaId(s.eixo, l));
        return `<button type="button" class="ap-chip ${s.sel.has(l) ? 'sel' : ''} ${m ? 'feita' : ''}" data-ap-letra="${l}" ${m ? 'disabled' : ''}
          title="${m ? `Montada em ${fdA(m.data)} (${esc(m.empresa || '')})` : ''}"><b>${l}</b><small>${c.viga} · ${AP_TIPO[c.evento_viga]}</small>${m ? '<small>✓ ' + fd(m.data) + '</small>' : ''}</button>`;
      }).join('')}</div><div class="ap-linha">${rodape}</div>`;
  }
  return h;
}

// ---- mapa em planta: eixos na horizontal, estações de viga (A, B, BC, C ... H) na vertical
function apMapaSvg(ctx) {
  const eixos = apEst.fase === 'fase1' ? ctx.cfg.eixos.filter(e => +e >= 11) :
                apEst.fase === 'fase2' ? ctx.cfg.eixos.filter(e => +e <= 11) :
                ctx.cfg.eixos;
  const passo = APM_PASSO[apEst.zoom] || APM_PASSO.normal, { mEsq, mTop, pad } = APM;
  const n = ctx.layout.length, altRua = n * passo, barH = passo - 3, colW = Math.round(passo * 7 + 6);
  // estações de viga alinhadas aos retângulos: cada faixa ocupa o trecho dos seus joists (em unidades de joist)
  const posL = {};
  let acum = 0;
  Object.entries(ctx.pos).forEach(([f, ps]) => {
    const qtd = ctx.layout.filter(p => p.faixa === f).length;
    posL[ps[0]] = acum; posL[ps[ps.length - 1]] = acum + qtd;
    ps.slice(1, -1).forEach(l => posL[l] = acum + qtd / 2);
    acum += qtd;
  });
  const yEst = l => mTop + posL[l] * passo;
  const xEixo = e => mEsq + eixos.indexOf(e) * colW;
  const larg = mEsq + (eixos.length - 1) * colW + 36, alt = mTop + altRua + 40;
  const ruas = eixos.slice(0, -1).map((e, i) => `${e}-${eixos[i + 1]}`);
  const yFim = mTop + altRua;
  const selRua = new Map();
  apEst.mapaJ.forEach((emp, k) => { const r = k.split('|')[0]; selRua.set(r, (selRua.get(r) || 0) + 1); });
  const s = [`<svg class="apm" viewBox="0 0 ${larg} ${alt}" width="${larg}" height="${alt}" role="img" aria-label="Mapa de montagem: 43 joists por rua, eixos por estações de viga">`];

  Object.entries(ctx.pos).forEach(([f, ps]) => {
    const y0 = yEst(ps[0]), y1 = yEst(ps[ps.length - 1]);
    s.push(`<rect class="apm-faixa" x="${mEsq}" y="${y0}" width="${(eixos.length - 1) * colW}" height="${y1 - y0}"/>`);
    s.push(`<text class="apm-faixa-rot" x="12" y="${(y0 + y1) / 2 + 4}">${f}</text>`);
  });
  eixos.forEach(e => {
    const x = xEixo(e);
    s.push(`<line class="apm-eixo" x1="${x}" x2="${x}" y1="${mTop}" y2="${yFim}"/>`);
    s.push(`<g class="apm-eixo-rot" data-ap-eixosel="${e}"><title>Eixo ${e}: clique para marcar todas as vigas pendentes</title><circle cx="${x}" cy="${mTop - 22}" r="12"/><text x="${x}" y="${mTop - 18}" text-anchor="middle">${e}</text></g>`);
  });
  ctx.letras.forEach(l => s.push(`<text class="apm-est-rot" x="${mEsq - 10}" y="${yEst(l) + 3}" text-anchor="end">${l}</text>`));

  ruas.forEach((rua, i) => {
    const xl = xEixo(eixos[i]) + pad, xr = xEixo(eixos[i + 1]) - pad;
    for (let k = 1; k <= n; k++) {
      const p = ctx.layout[k - 1], row = ctx.slotRow.get(`${rua}|${k}`), emp = apEst.mapaJ.get(`${rua}|${k}`);
      const est = row ? 'feita' : emp ? 'sel' : 'pend', y = mTop + (k - 1) * passo + 1.5, c = ctx.crit[p.letra];
      const info = `Rua ${rua} · joist ${k} de ${n} · faixa ${p.faixa} · apoio ${p.letra} (${c.viga} · ${AP_TIPO[c.evento_viga]}) · parafuso ${c.parafuso} · ` +
        (row ? `montada${row.empresa ? ' (' + row.empresa + ')' : ''}${row.data ? ' em ' + fdA(row.data) : ''}` : emp ? `selecionada (${emp})` : 'pendente');
      s.push(`<g class="apm-slot ${est}" ${est === 'sel' ? `style="--sel:${corSelEmp(emp)}"` : ''} data-ap-slot="${rua}|${k}" data-ap-info="${esc(info)}">` +
        `<rect class="hit" x="${xl}" y="${y - 1.5}" width="${xr - xl}" height="${passo}"/><rect class="bar" x="${xl}" y="${y}" width="${xr - xl}" height="${barH}" rx="3"/></g>`);
    }
    const tot = ctx.totalRua.get(rua) || 0, sr = selRua.get(rua) || 0, xm = (xEixo(eixos[i]) + xEixo(eixos[i + 1])) / 2;
    const cls = tot + sr > ctx.limRua ? 'exc' : tot >= ctx.limRua ? 'ok' : tot + sr > 0 ? 'parc' : '';
    s.push(`<text class="apm-rua-tot ${cls}" x="${xm}" y="${yFim + 30}" text-anchor="middle">${tot}${sr ? '+' + sr : ''}/${ctx.limRua}<title>Rua ${rua}: ${tot} joists apontadas${sr ? ', ' + sr + ' selecionadas' : ''} de ${ctx.limRua} previstas</title></text>`);
  });
  s.push(`<text class="apm-est-rot" x="${mEsq - 10}" y="${yFim + 30}" text-anchor="end">joists/rua</text>`);

  eixos.forEach(e => ctx.letras.forEach(l => {
    const id = ctx.vigaId(e, l), m = ctx.vigaMontada.get(id), c = ctx.crit[l], emp = apEst.mapaV.get(`${e}|${l}`);
    const est = m ? 'feita' : emp ? 'sel' : 'pend';
    const tam = c.evento_viga === 'VIGA_INTERM_MONTADA' ? 9 : 13;
    const info = `${id} · ${AP_TIPO[c.evento_viga]} · ` + (m ? `montada${m.empresa ? ' (' + m.empresa + ')' : ''}${m.data ? ' em ' + fdA(m.data) : ''}` : emp ? `selecionada (${emp})` : 'pendente');
    s.push(`<g class="apm-viga ${est} ${c.evento_viga === 'VIGA_INTERM_MONTADA' ? 'interm' : ''}" ${est === 'sel' ? `style="--sel:${corSelEmp(emp)}"` : ''} data-ap-viga="${e}|${l}" data-ap-info="${esc(info)}">` +
      `<rect x="${xEixo(e) - tam / 2 - 3}" y="${yEst(l) - tam / 2 - 3}" width="${tam + 6}" height="${tam + 6}" class="hit"/><rect class="q" x="${xEixo(e) - tam / 2}" y="${yEst(l) - tam / 2}" width="${tam}" height="${tam}" rx="2"/></g>`);
  }));
  return s.join('') + '</svg>';
}

// Mapa de uma frente: uma linha por parte (lado A, lado H, oitão, faixa...) e uma célula por trecho montável.
// Cada célula traz as peças do IFC daquele trecho; clicar seleciona com a empresa escolhida na barra do topo.
// Contraventamento em vista elevada: eixos na horizontal, estações de letra (A no topo a H na base)
// na vertical, e um X em cada painel contraventado — a mesma leitura do OF.198-MET-DM-001.
// Mapa na escala do projeto: as posições de cada eixo e de cada estação vêm da malha do IFC (mm),
// então os vãos saem como no desenho — 9.000 e 13.500 m entre eixos, 8.380 entre estações e 4.190
// junto às bordas. Três escalas mudam só quantos milímetros cabem em cada pixel.
const APC_MM_PX = { compacto: 900, normal: 560, grande: 330 };
const APC = { mEsq: 54, mTop: 40, mBase: 32 };
const APC_COR = { CTH01: 'var(--acento)', CTH02: 'var(--fg2)', CTH03: 'var(--acento)',
  CTH04: 'var(--fg2)', CTH05: 'var(--amarelo)' };
const apcChave = (marca, rua, trecho) => `${marca}|${rua}|${trecho}`;

function apContravSvg() {
  const fr = apFrenteAtual(), el = fr && fr.elevacao;
  if (!el) return '';
  const malha = ((window._frentes || {}).malha || {});
  const eixosMm = malha.eixos_mm || {}, estMm = malha.estacoes_mm || {};
  const temMalha = Object.keys(eixosMm).length > 0;
  const feitas = new Map();
  (T.apontamentos || []).filter(a => (a.tipo || '').toUpperCase() === 'CONTRAVENTAMENTO')
    .forEach(a => feitas.set(apcChave(a.faixa, a.rua, a.letra || ''), a));
  const ruas = malha.ruas && malha.ruas.length ? malha.ruas : el.ruas;
  const comCth = new Set(el.ruas);
  const est = el.estacoes;
  const mmPx = APC_MM_PX[apEst.zoom] || APC_MM_PX.normal;
  const { mEsq, mTop, mBase } = APC;
  // posição em px: da malha do IFC quando ela existe, senão espaçamento uniforme
  const eixos = [...new Set(ruas.flatMap(r => r.split('-')))].sort();
  const xEixo = e => temMalha ? mEsq + (eixosMm[e] || 0) / mmPx
    : mEsq + eixos.indexOf(e) * (560 / mmPx) * 14;
  const yEst = e => temMalha ? mTop + (estMm[e] || 0) / mmPx
    : mTop + est.indexOf(e) * (560 / mmPx) * 14;
  const larg = xEixo(eixos[eixos.length - 1]) - mEsq, alt = yEst(est[est.length - 1]) - mTop;
  const W = mEsq + larg + 24, H = mTop + alt + mBase;
  const minGap = (a, b) => Math.abs(yEst(a) - yEst(b));
  let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" class="apc">`;
  let ultimoY = -99;
  est.forEach(e => {
    const y = yEst(e);
    s += `<line x1="${mEsq}" y1="${y}" x2="${mEsq + larg}" y2="${y}" class="apc-est"/>`;
    if (y - ultimoY >= 9 || /^[A-H]$/.test(e)) { s += `<text x="${mEsq - 7}" y="${y + 3.5}" class="apc-rot">${e}</text>`; ultimoY = y; }
  });
  let ultimoX = -99;
  ruas.forEach(r => {
    const [a, b] = r.split('-'), x0 = xEixo(a), x1 = xEixo(b), tem = comCth.has(r);
    if (tem) s += `<rect x="${x0}" y="${mTop}" width="${x1 - x0}" height="${alt}" class="apc-bay"/>`;
    s += `<line x1="${x0}" y1="${mTop}" x2="${x0}" y2="${mTop + alt}" class="apc-eixo"/>`;
    if (tem || x0 - ultimoX >= 22) { s += `<text x="${x0}" y="${mTop - 8}" class="apc-rot n ${tem ? 'b' : 'peq'}">${esc(a)}</text>`; ultimoX = x0; }
    if (tem) {
      const n = Object.values((el.resumo_por_rua || {})[r] || {}).reduce((v, w) => v + w, 0);
      s += `<text x="${(x0 + x1) / 2}" y="${mTop + alt + 14}" class="apc-rot n peq">${nf(n)}</text>`;
    }
  });
  const fimX = xEixo(eixos[eixos.length - 1]);
  s += `<line x1="${fimX}" y1="${mTop}" x2="${fimX}" y2="${mTop + alt}" class="apc-eixo"/>` +
    `<text x="${fimX}" y="${mTop - 8}" class="apc-rot n peq">${esc(eixos[eixos.length - 1])}</text>`;
  el.paineis.forEach(p => {
    if (!comCth.has(p.rua) || !(p.de in estMm || !temMalha)) return;
    const [a, b] = p.rua.split('-'), x0 = xEixo(a), x1 = xEixo(b);
    const y0 = yEst(p.de), y1 = yEst(p.ate), h = Math.max(y1 - y0, 3);
    const trecho = `${p.de}-${p.ate}`, k = apcChave(p.marca, p.rua, trecho);
    const feita = feitas.get(k), emp = apEst.frente.get(`CONTRAVENTAMENTO|${k}`);
    const cls = feita ? 'feita' : emp ? 'sel' : 'pend';
    const tit = `${p.marca} · rua ${p.rua} · ${trecho}\n${p.kits} kit (${p.pecas} peças)` +
      (feita ? `\nMontado em ${fdA(feita.data)} (${feita.empresa || ''})` : '');
    s += `<g class="apc-p ${cls}" style="--m:${APC_COR[p.marca] || 'var(--fg3)'}${emp ? `;--sel:${corSelEmp(emp)}` : ''}"` +
      ` ${feita ? '' : `data-ap-frente="${esc(k)}"`} data-ap-info="${esc(tit)}">` +
      `<rect x="${x0 + 1}" y="${y0}" width="${Math.max(x1 - x0 - 2, 3)}" height="${h}" class="apc-fundo"/>` +
      `<line x1="${x0 + 1.5}" y1="${y0}" x2="${x1 - 1.5}" y2="${y0 + h}"/><line x1="${x1 - 1.5}" y1="${y0}" x2="${x0 + 1.5}" y2="${y0 + h}"/>` +
      `<title>${esc(tit)}</title></g>`;
  });
  if (temMalha) {
    const m = (v) => nf(v / 1000, 1).replace(',0', '') + ' m';
    s += `<text x="${mEsq}" y="${H - 4}" class="apc-rot peq" text-anchor="start">Galpão ${m(malha.comprimento_mm)} × ${m(malha.largura_mm)} · desenhado na malha do IFC</text>`;
  }
  return s + '</svg>';
}

function apFrenteHtml(ctx) {
  const fr = apFrenteAtual();
  if (!fr) return window._frentes
    ? '<p class="vazio">O mapa desta frente ainda não chegou no programa. Ele vem junto com a atualização automática: aguarde alguns minutos ou clique em "Verificar atualização" no topo da tela.</p>'
    : '<p class="vazio">Carregando o mapa do IFC…</p>';
  const tipo = AP_FRENTE[apEst.modo];
  const etapas = fr.etapas || [];
  if (etapas.length && !etapas.includes(apEst.etapa)) apEst.etapa = etapas[0];
  const etapa = etapas.length ? apEst.etapa : '';
  const feitas = new Map();
  (T.apontamentos || []).filter(a => (a.tipo || '').toUpperCase() === tipo).forEach(a => {
    feitas.set(`${a.faixa}|${a.rua}|${a.letra || ''}`, a);
  });
  const nFeitas = fr.partes.reduce((n, p) => n + p.celulas.filter(c => feitas.has(`${p.id}|${c.trecho}|${etapa}`)).length, 0);
  const nTotal = fr.partes.reduce((n, p) => n + p.celulas.length, 0);
  const barra = etapas.length
    ? `<div class="seg" id="segApEtapa">${etapas.map(e => `<button data-ap-etapa="${esc(e)}" class="${e === etapa ? 'ativa' : ''}">${esc(cap(e.replace(/^MARQUISE – /, '')))}</button>`).join('')}</div>` : '';
  const leg = (cls, txt, st = '') => `<span><i class="apm-leg ${cls}" ${st ? `style="${st}"` : ''}></i>${txt}</span>`;
  const selLeg = apEmpresas(ctx).map(e => leg('joist sel', `selecionado ${esc(e.nome)}`, `--sel:${corSelEmp(e.nome)}`)).join('');
  if (apEst.modo === 'cont' && fr.elevacao) {
    const el = fr.elevacao, kits = el.paineis;
    const chaveDe = k => apcChave(k.marca, k.rua, `${k.de}-${k.ate}`);
    const mont = kits.filter(k => feitas.has(chaveDe(k))).length;
    const porMarca = {};
    kits.forEach(k => { const o = porMarca[k.marca] ||= { n: 0, f: 0 }; o.n++; if (feitas.has(chaveDe(k))) o.f++; });
    const legM = Object.entries(porMarca).sort().map(([m, o]) =>
      `<span><i class="apm-leg" style="background:${APC_COR[m] || 'var(--fg3)'}"></i>${m} ${o.f}/${o.n}</span>`).join('');
    const seg = (id, lista, atual, attr) => `<div class="seg" id="${id}">${lista.map(([k, r]) => `<button ${attr}="${k}" class="${k === atual ? 'ativa' : ''}">${r}</button>`).join('')}</div>`;
    return `<div class="ap-linha ap-mapa-barra">
      ${seg('segApZoom', [['compacto', 'Compacto'], ['normal', 'Normal'], ['grande', 'Grande']], apEst.zoom, 'data-ap-zoom')}
      <span class="nota"><b>${nf(mont)} de ${nf(kits.length)} kits</b> montados · ${nf(el.ruas.length)} de ${nf(((window._frentes || {}).malha || {}).ruas?.length || el.ruas.length)} ruas contraventadas</span>
      <div class="ap-legenda">${legM}${leg('joist feita', 'montado')}${selLeg}</div></div>
      <div class="tabela-rolagem apm-caixa">${apContravSvg()}</div>
      <p class="nota">Planta do galpão inteiro, como no OF.198-MET-DM-001: eixos na horizontal, estações de letra de A (topo) a H (base).
      As ruas contraventadas ficam destacadas (o número embaixo é a quantidade de kits da rua); as demais aparecem vazias, na proporção real.
      Cada X é um kit de ${nf(el.pecas_por_kit)} diagonais cruzadas, com a marca do projeto: as ruas 1 e 19 levam CTH01 nas bordas e CTH02 ao
      longo da rua; as ruas 4, 7, 9, 11, 13 e 16 levam CTH03 nas bordas, CTH04 no miolo e CTH05 na cumeeira. Clique no X para selecionar.
      O contraventamento não tem coluna no controle de produção, então o apontamento serve de controle e não soma na produção.</p>`;
  }
  let h = `<div class="ap-linha ap-mapa-barra">${barra}
    <span class="nota">${nf(nFeitas)} de ${nf(nTotal)} trechos montados${etapa ? ' nesta etapa' : ''} · ${nf(fr.total)} peças no IFC</span>
    <div class="ap-legenda">${leg('joist feita', 'montado')}${leg('joist pend', 'pendente')}${selLeg}</div></div>
    <div class="tabela-rolagem"><table class="ap-frente"><tbody>`;
  fr.partes.forEach(p => {
    const feitasP = p.celulas.filter(c => feitas.has(`${p.id}|${c.trecho}|${etapa}`)).length;
    h += `<tr><th class="apf-rot"><b>${esc(p.nome)}</b><span class="nota">${feitasP}/${p.celulas.length} · ${nf(p.total)} peças</span></th>`;
    p.celulas.forEach(c => {
      const k = `${p.id}|${c.trecho}|${etapa}`;
      const feita = feitas.get(k), emp = apEst.frente.get(`${tipo}|${k}`);
      const det = Object.entries(c.pecas).map(([n, q]) => `${n}: ${q}`).join('\n');
      const tit = `${p.nome} · ${c.trecho}${etapa ? ' · ' + etapa : ''}\n${c.total} peças${det ? '\n' + det : ''}` +
        (feita ? `\nMontado em ${fdA(feita.data)} (${feita.empresa || ''})` : '');
      h += `<td><button type="button" class="apf-cel ${feita ? 'feita' : emp ? 'sel' : 'pend'}" ${emp ? `style="--sel:${corSelEmp(emp)}"` : ''}
        data-ap-frente="${esc(k)}" ${feita ? 'disabled' : ''} title="${esc(tit)}"><b>${esc(c.trecho)}</b><small>${c.total || '—'}</small></button></td>`;
    });
    h += '</tr>';
  });
  h += '</tbody></table></div>';
  h += `<p class="nota">Cada célula é um trecho montável deste mapa, extraído do IFC (${esc(fr.familias.join(', '))}). O número embaixo é a quantidade de peças do trecho; passe o mouse para ver a composição. ` +
    (fr.servico || etapa ? `O apontamento soma no serviço <b>${esc(cap(etapa || fr.servico))}</b> do controle de produção.` :
      'Esta frente não tem coluna no controle de produção: o apontamento serve de controle e não soma na produção.') + '</p>';
  return h;
}

function apMapaHtml(ctx) {
  if (apEst.modo in AP_FRENTE) return apFrenteHtml(ctx);
  if (apEst.modo === 'mapa') {
    const leg = (cls, txt, st = '') => `<span><i class="apm-leg ${cls}" ${st ? `style="${st}"` : ''}></i>${txt}</span>`;
    const selLeg = apEmpresas(ctx).map(e => leg('joist sel', `selecionada ${esc(e.nome)}`, `--sel:${corSelEmp(e.nome)}`)).join('');
    const seg = (id, lista, atual, attr) => `<div class="seg" id="${id}">${lista.map(([k, r]) => `<button ${attr}="${k}" class="${k === atual ? 'ativa' : ''}">${r}</button>`).join('')}</div>`;
    return `<div class="ap-linha ap-mapa-barra">${seg('segApFase', [['fase2', 'Fase 2 (Eixos 01-11)'], ['fase1', 'Fase 1 (Eixos 11-20)'], ['todos', 'Todos']], apEst.fase, 'data-ap-fase')}
      ${seg('segApZoom', [['compacto', 'Compacto'], ['normal', 'Normal'], ['grande', 'Grande']], apEst.zoom, 'data-ap-zoom')}
      <div class="ap-legenda">${leg('joist feita', 'joist montada')}${leg('viga feita', 'viga montada')}${leg('joist pend', 'pendente')}${selLeg}</div></div>
      <div id="apMapaInfo" class="ap-info">${AP_INFO_PADRAO}</div>
      <div id="apMapaSvg" class="tabela-rolagem apm-caixa">${apMapaSvg(ctx)}</div>
      <p class="nota">Cada retângulo é uma joist: são ${ctx.layout.length} por rua, da estação A (topo) à H (base); a posição do retângulo define a viga de apoio e o tipo de parafuso. Quadrados nos eixos: vigas (maior = apoio/VC01, menor = intermediária). Embaixo de cada rua: joists apontadas/${ctx.limRua}. Clique no número do eixo para marcar todas as vigas pendentes dele.</p>`;
  }
  return `<div class="tabela-rolagem"><table class="ap-mapa"><thead><tr><th>Eixo</th>${ctx.letras.map(l => `<th class="n" title="${ctx.crit[l].viga} · ${AP_TIPO[ctx.crit[l].evento_viga]}">${l}</th>`).join('')}<th class="n">Total</th></tr></thead><tbody>` +
    ctx.cfg.eixos.map(x => {
      let n = 0;
      const tds = ctx.letras.map(l => {
        const m = ctx.vigaMontada.get(ctx.vigaId(x, l));
        if (m) n++;
        return `<td class="n"><button type="button" class="ap-cel ${m ? 'ap-ok' : 'ap-blq'}" data-ap-eixo="${x}" title="${ctx.vigaId(x, l)}${m ? ' · montada em ' + fdA(m.data) + ' (' + (m.empresa || '?') + ')' : ''}">${m ? '✓' : '·'}</button></td>`;
      }).join('');
      return `<tr><td><b>${x}</b></td>${tds}<td class="n">${n}/${ctx.letras.length}</td></tr>`;
    }).join('') + '</tbody></table></div>';
}
const AP_INFO_PADRAO = 'Passe o mouse sobre uma joist ou viga para ver a posição e o tipo.';

// Conciliação: o que foi lançado na produção (grade, base do BM) x o que foi apontado no mapa, por empresa.
function apConciliacaoHtml(ctx) {
  const nomes = apEmpresas(ctx).map(e => e.nome);
  const vazia = x => !nomes.includes(x);
  const semEmp = (T.apontamentos || []).filter(a => vazia(a.empresa));
  const linhas = nomes.map(n => ({ n, lj: prodServico(ctx.cfg.servico_joist, n, '0000-01-01', '9999-12-31'), lv: prodServico(ctx.cfg.servico_viga, n, '0000-01-01', '9999-12-31'),
    aj: soma0(ctx.joists.filter(a => a.empresa === n), a => a.qtd), av: ctx.vigas.filter(a => a.empresa === n).length }));
  if (semEmp.length) linhas.push({ n: 'A DEFINIR', lj: 0, lv: 0, aj: soma0(semEmp.filter(a => (a.tipo || '').toUpperCase() === 'JOIST'), a => a.qtd), av: semEmp.filter(a => (a.tipo || '').toUpperCase() === 'VIGA').length, semEmp: true });
  const tot = linhas.reduce((o, l) => ({ lj: o.lj + l.lj, aj: o.aj + l.aj, lv: o.lv + l.lv, av: o.av + l.av }), { lj: 0, aj: 0, lv: 0, av: 0 });
  const dif = (l, a, por) => {
    if (por) return '<td class="n" colspan="1">—</td>';
    const d = l - a;
    return `<td class="n ${d === 0 ? 'valor-ok' : d > 0 ? '' : 'valor-neg'}"><b>${d > 0 ? '+' : ''}${nf(d)}</b></td>`;
  };
  const tr = (l, forte) => `<tr>${l.n === 'Total' ? '<td><b>Total</b></td>' : `<td><span class="emp-tag" style="--c:${corEmp(l.n)}">${esc(l.n)}</span></td>`}
    <td class="n">${nf(l.lj)}</td><td class="n">${nf(l.aj)}</td>${dif(l.lj, l.aj, l.semEmp && !forte)}
    <td class="n">${nf(l.lv)}</td><td class="n">${nf(l.av)}</td>${dif(l.lv, l.av, l.semEmp && !forte)}</tr>`;
  return `<thead><tr><th>Empresa</th><th class="n">Joists lançadas</th><th class="n">Apontadas</th><th class="n">Dif.</th><th class="n">Vigas lançadas</th><th class="n">Apontadas</th><th class="n">Dif.</th></tr></thead><tbody>` +
    linhas.map(l => tr(l)).join('') + tr({ n: 'Total', ...tot }, true) + '</tbody>';
}

const apDef = { tipo: 'VIGA', emp: '', e0: '', e1: '', l0: 'A', l1: 'H' };
function apDefLinhas(ctx) {
  const nomes = apEmpresas(ctx).map(e => e.nome);
  const i0 = ctx.letras.indexOf(apDef.l0), i1 = ctx.letras.indexOf(apDef.l1);
  return (T.apontamentos || []).filter(a => !nomes.includes(a.empresa) && (a.lanca_producao || '').toUpperCase() !== 'SIM' && (a.tipo || '').toUpperCase() === apDef.tipo).filter(a => {
    const eixo = apDef.tipo === 'VIGA' ? a.eixo : (a.rua || '').split('-')[0], i = ctx.letras.indexOf(a.letra);
    return eixo >= apDef.e0 && eixo <= apDef.e1 && i >= Math.min(i0, i1) && i <= Math.max(i0, i1);
  });
}
function apDefHtml(ctx) {
  const nomes = apEmpresas(ctx).map(e => e.nome);
  const pend = (T.apontamentos || []).filter(a => !nomes.includes(a.empresa));
  if (!pend.length) return '';
  const tem = t => pend.some(a => (a.tipo || '').toUpperCase() === t);
  if (!tem(apDef.tipo)) apDef.tipo = tem('VIGA') ? 'VIGA' : 'JOIST';
  const eixos = ctx.cfg.eixos;
  if (!eixos.includes(apDef.e0)) apDef.e0 = eixos.find(e => +e >= 11) || eixos[0];
  if (!eixos.includes(apDef.e1)) apDef.e1 = eixos[eixos.length - 1];
  const sel = (id, lista, val) => `<select data-ap-def="${id}">${lista.map(x => `<option ${x === val ? 'selected' : ''}>${x}</option>`).join('')}</select>`;
  return `<div class="ap-def"><p class="nota"><b>${nf(pend.length)} registro(s) do histórico sem empresa.</b> Defina quem montou por região (vale só para o histórico; o BM continua vindo dos lançamentos).</p>
    <div class="ap-linha"><label class="rot-sel">Peça ${sel('tipo', ['VIGA', 'JOIST'].filter(tem), apDef.tipo)}</label>
      <label class="rot-sel">Eixos de ${sel('e0', eixos, apDef.e0)} até ${sel('e1', eixos, apDef.e1)}</label>
      <label class="rot-sel">Letras de ${sel('l0', ctx.letras, apDef.l0)} até ${sel('l1', ctx.letras, apDef.l1)}</label>
      <label class="rot-sel">Empresa <select data-ap-def="emp"><option value="">— escolha —</option>${nomes.map(n => `<option ${n === apDef.emp ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
      <button class="btn primario" id="apDefAplicar">Definir empresa</button><span class="nota" id="apDefPrev">${apDefPrevTxt(ctx)}</span></div></div>`;
}
const apDefPrevTxt = ctx => { const n = apDefLinhas(ctx).reduce((s, a) => s + (a.qtd || 0), 0); return `${nf(n)} ${apDef.tipo === 'VIGA' ? 'viga(s)' : 'joist(s)'} nessa região`; };

function renderApont() {
  if (!M) return;
  const regras = regrasBaixa(renderApont);
  if (!regras) { $('#apForm').innerHTML = '<p class="vazio">Carregando regras...</p>'; return; }
  if (!regras.faixas_posicoes) { $('#apForm').innerHTML = '<p class="vazio">regras_baixa.json sem as regras de apontamento.</p>'; return; }
  frentesMontagem(renderApont);   // mapas de fechamento, marquise e contraventamento (carga preguiçosa)
  const ctx = apContexto(regras);
  apGarantirEstado(ctx);

  const { cfg } = ctx;
  const prodJ = prodServico(cfg.servico_joist, null, '0000-01-01', '9999-12-31'), prodV = prodServico(cfg.servico_viga, null, '0000-01-01', '9999-12-31');
  const apJ = soma0(ctx.joists, a => a.qtd), apV = ctx.vigas.length;
  const tile = (rot, val, sub, cc) => `<div class="tile" style="--c:${cc}"><div class="rot"><span>${rot}</span></div><div class="val">${val}</div><div class="sub">${sub}</div></div>`;
  const dif = (prod, ap) => prod >= ap ? `${nf(prod - ap)} a apontar` : `apontadas ${nf(ap - prod)} acima da produção: confira`;
  const cor = (prod, ap) => prod === ap ? 'var(--verde)' : prod > ap ? 'var(--amarelo)' : 'var(--vermelho)';
  let lib = 0, tot = 0, completas = 0;
  ctx.ruas.forEach(r => { if ((ctx.totalRua.get(r) || 0) >= ctx.limRua) completas++; Object.keys(ctx.pos).forEach(f => { tot++; if (ctx.quadrante(r, f).liberado) lib++; }); });
  $('#apTiles').innerHTML =
    tile('Joists içadas (produção)', nf(prodJ), `${nf(apJ)} apontadas por quadrante · ${dif(prodJ, apJ)}`, cor(prodJ, apJ)) +
    tile('Vigas montadas (produção)', nf(prodV), `${nf(apV)} apontadas por tipo · ${dif(prodV, apV)}`, cor(prodV, apV)) +
    tile('Ruas completas', `${completas}/${ctx.ruas.length}`, `${ctx.limRua} joists por rua · ${nf(ctx.limGalpao)} no galpão`, 'var(--verde)') +
    tile('Quadrantes liberados', `${lib}/${tot}`, 'vigas apontadas nos dois eixos', 'var(--acento)');

  $('#segApModo').innerHTML = [['mapa', 'Mapa (clicar)'], ['viga', 'Digitar vigas'],
    ['fech', 'Fechamento lateral'], ['marq', 'Marquise'], ['cont', 'Contraventamento']]
    .map(([k, r]) => `<button data-ap-modo="${k}" class="${k === apEst.modo ? 'ativa' : ''}">${r}</button>`).join('');
  $('#apBarra').innerHTML = apBarraHtml(ctx);
  $('#apForm').innerHTML = apFormHtml(regras, ctx);
  const fr = apFrenteAtual();
  $('#apMapaTit').textContent = apEst.modo === 'mapa' ? 'Mapa de montagem (clique para selecionar)'
    : apEst.modo === 'viga' ? 'Situação das vigas (eixo × letra)'
    : (fr ? fr.titulo + ' (clique para selecionar)' : 'Carregando o mapa do IFC…');
  $('#apMapa').innerHTML = apMapaHtml(ctx);
  $('#apEfeitos').innerHTML = apEfeitosHtml(regras, ctx);
  $('#tabApConc').innerHTML = apConciliacaoHtml(ctx);
  $('#apDefEmp').innerHTML = apDefHtml(ctx);

  const hist = [...(T.apontamentos || [])].sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')) || b.linha - a.linha).slice(0, 40);
  $('#tabApHist').innerHTML = `<thead><tr><th>Data</th><th>Empresa</th><th>Tipo</th><th>Local</th><th class="n">Qtd</th><th>Produção</th><th>Obs.</th><th></th></tr></thead><tbody>` +
    (hist.length ? hist.map(a => {
      const tipo = (a.tipo || '').toUpperCase(), joist = tipo === 'JOIST';
      const c = ctx.crit[a.letra] || {};
      const rotFrente = { FECHAMENTO: 'Fechamento', MARQUISE: 'Marquise', CONTRAVENTAMENTO: 'Contravent.' }[tipo];
      return `<tr><td>${fdA(a.data)}</td><td><span class="emp-tag" style="--c:${corEmp(a.empresa)}">${esc(a.empresa)}</span></td><td>${rotFrente || (joist ? 'Joist' : 'Viga')}</td>
        <td>${rotFrente ? `${esc(a.faixa)} · ${esc(a.rua)}${a.letra ? ' · ' + esc(cap(a.letra)) : ''}`
          : joist ? `Rua ${esc(a.rua)} · ${a.slot ? 'joist ' + a.slot + ' · ' : ''}faixa ${esc(a.faixa)} · apoio ${esc(a.letra)} (${esc(c.viga || '')})` : `${esc(a.viga_id)} · ${esc(AP_TIPO[c.evento_viga] || '')}`}</td>
        <td class="n">${nf(a.qtd)}</td><td>${(a.lanca_producao || '').toUpperCase() === 'SIM' ? 'soma' : 'regularização'}</td><td class="sub">${esc(a.obs || '')}</td>
        <td><button class="link" data-ap-excluir="${a.linha}">Excluir</button></td></tr>`;
    }).join('') : '<tr><td colspan="8" class="vazio">Nenhum apontamento ainda.</td></tr>') + '</tbody>';
  patchDatas();
  requestAnimationFrame(syncScrollTopo);
}

// Atualiza só o que depende da seleção (mantém a rolagem do mapa).
function apAtualizarSelecao(redesenharMapa) {
  const regras = window._regras_baixa;
  if (!regras) return;
  const ctx = apContexto(regras);
  $('#apEfeitos').innerHTML = apEfeitosHtml(regras, ctx);
  $('#apResumo').textContent = apResumoTxt(ctx);
  if (redesenharMapa && apEst.modo === 'mapa') $('#apMapaSvg').innerHTML = apMapaSvg(ctx);
}

async function salvarApontamento() {
  const regras = window._regras_baixa, ctx = apContexto(regras), s = apEst, sel = apSelecao(ctx);
  if (!sel.nJ && !sel.nV && !sel.nF) { toast('Selecione ao menos uma peça no mapa.', true); return; }
  if (sel.semEmpresa) { toast('Indique a empresa que montou (barra no topo) antes de salvar.', true); return; }
  const lote = [], porQuad = new Map(), porEixo = new Map();
  sel.joists.forEach(j => {
    const k = `${j.rua}|${j.emp}`;
    if (!porQuad.has(k)) porQuad.set(k, { tipo: 'JOIST', empresa: j.emp, rua: j.rua, slots: [] });
    porQuad.get(k).slots.push(j.slot);
  });
  sel.vigas.forEach(v => {
    const k = `${v.eixo}|${v.emp}`;
    if (!porEixo.has(k)) porEixo.set(k, { tipo: 'VIGA', empresa: v.emp, eixo: v.eixo, letras: [] });
    porEixo.get(k).letras.push(v.letra);
  });
  const porFrente = new Map();
  sel.frente.forEach(f => {
    const k = `${f.tipo}|${f.parte}|${f.etapa}|${f.emp}`;
    if (!porFrente.has(k)) porFrente.set(k, { tipo: f.tipo, empresa: f.emp, parte: f.parte, etapa: f.etapa || null, trechos: [] });
    porFrente.get(k).trechos.push(f.trecho);
  });
  lote.push(...porQuad.values(), ...porEixo.values(), ...porFrente.values());
  const b = $('#apSalvar');
  b.disabled = true; b.textContent = 'Salvando…';
  try {
    const r = await postar(API + 'apontamento', { data: s.data, lanca_producao: !s.regular, obs: s.obs.trim() || null, lote });
    s.sel = new Set(); s.mapaJ = new Map(); s.mapaV = new Map(); s.frente = new Map(); s.obs = '';
    await carregar();
    const lanc = (r.lancamentos || []).map(l => `${l.empresa} · ${l.servico} +${nf(l.delta)} (dia fecha em ${nf(l.total)})`).join(' · ');
    toast(`${r.salvos} apontamento(s) salvo(s)`
      + (lanc ? `. Lançado em produção: ${lanc}` : (s.regular ? '. Regularização: não somou em Lançamentos.' : ''))
      + (r.avisos?.length ? '. Atenção: ' + r.avisos.join(' ') : ''),
      !!r.avisos?.length, (r.avisos?.length || lanc) ? 9000 : undefined);
  } catch (err) { toast(err.message, true); b.disabled = false; b.textContent = 'Salvar apontamento'; }
}

function apExigirEmpresa() {
  if (apEst.empresa) return true;
  toast('Indique primeiro a empresa que montou (barra no topo).', true);
  const p = document.querySelector('#apBarra .ap-pincel');
  if (p) { p.classList.remove('pisca'); void p.offsetWidth; p.classList.add('pisca'); }
  return false;
}

// Marca/desmarca um retângulo (joist) com a empresa atual; `modo` força 'add' ou 'remove' (arrastar).
function apMarcarSlot(ctx, chave, modo) {
  const [rua, slot] = chave.split('|');
  if (ctx.slotRow.has(chave)) return false;
  const atual = apEst.mapaJ.get(chave), remover = modo ? modo === 'remove' : atual === apEst.empresa;
  remover ? apEst.mapaJ.delete(chave) : apEst.mapaJ.set(chave, apEst.empresa);
  return true;
}
let apArraste = null, apUltimo = null;
// Arraste: marca todos os retângulos entre o último marcado e o atual (mouse rápido não pula joists), na mesma rua.
function apArrastarAte(ctx, chave) {
  const [rua, slot] = chave.split('|'), [ruaU, slotU] = (apUltimo || chave).split('|');
  const de = ruaU === rua ? +slotU : +slot, ate = +slot, passo = de <= ate ? 1 : -1;
  let mudou = false;
  for (let s = de; s !== ate + passo; s += passo) {
    const k = `${rua}|${s}`;
    if (apMarcarSlot(ctx, k, apArraste)) {
      const g = document.querySelector(`[data-ap-slot="${k}"]`);
      if (g) apPintarSlot(g, k);
      mudou = true;
    }
  }
  apUltimo = chave;
  if (mudou) apAtualizarSelecao(false);
}
function apPintarSlot(g, chave) {
  const emp = apEst.mapaJ.get(chave);
  g.classList.toggle('sel', !!emp); g.classList.toggle('pend', !emp);
  emp ? g.style.setProperty('--sel', corSelEmp(emp)) : g.style.removeProperty('--sel');
}

function ligarApontamento() {
  const sec = document.getElementById('aba-apont');
  const regras = () => window._regras_baixa;
  sec.addEventListener('click', async ev => {
    const emp = ev.target.closest('[data-ap-emp]');
    if (emp && regras()) { apEst.empresa = emp.dataset.apEmp; $('#apBarra').innerHTML = apBarraHtml(apContexto(regras())); return apAtualizarSelecao(false); }
    const modo = ev.target.closest('[data-ap-modo]');
    if (modo) {
      apEst.modo = modo.dataset.apModo;
      const tipo = AP_FRENTE[apEst.modo];
      [...apEst.frente.keys()].filter(k => k.split('|')[0] !== tipo).forEach(k => apEst.frente.delete(k));
      return renderApont();
    }
    const etapa = ev.target.closest('[data-ap-etapa]');
    if (etapa) { apEst.etapa = etapa.dataset.apEtapa; return renderApont(); }
    const cel = ev.target.closest('[data-ap-frente]');
    if (cel) {
      if (!apExigirEmpresa()) return;
      const k = `${AP_FRENTE[apEst.modo]}|${cel.dataset.apFrente}`;
      if (apEst.frente.get(k) === apEst.empresa) apEst.frente.delete(k); else apEst.frente.set(k, apEst.empresa);
      return renderApont();
    }
    const fase = ev.target.closest('[data-ap-fase]');
    if (fase) { apEst.fase = fase.dataset.apFase; return renderApont(); }
    const zoom = ev.target.closest('[data-ap-zoom]');
    if (zoom) { apEst.zoom = zoom.dataset.apZoom; return renderApont(); }
    if (ev.target.closest('[data-ap-slot]')) return;   // joists são tratadas em mousedown/arraste
    const viga = ev.target.closest('[data-ap-viga]');
    if (viga && regras()) {
      const ctx = apContexto(regras()), [e, l] = viga.dataset.apViga.split('|');
      if (ctx.vigaMontada.has(ctx.vigaId(e, l))) { toast('Essa viga já está apontada. Para corrigir, exclua o apontamento no histórico.'); return; }
      if (!apExigirEmpresa()) return;
      const k = viga.dataset.apViga;
      apEst.mapaV.get(k) === apEst.empresa ? apEst.mapaV.delete(k) : apEst.mapaV.set(k, apEst.empresa);
      return apAtualizarSelecao(true);
    }
    const eixoSel = ev.target.closest('[data-ap-eixosel]');
    if (eixoSel && regras()) {
      if (!apExigirEmpresa()) return;
      const ctx = apContexto(regras()), e = eixoSel.dataset.apEixosel;
      const pend = ctx.letras.filter(l => !ctx.vigaMontada.has(ctx.vigaId(e, l)));
      const todas = pend.every(l => apEst.mapaV.get(`${e}|${l}`) === apEst.empresa);
      pend.forEach(l => todas ? apEst.mapaV.delete(`${e}|${l}`) : apEst.mapaV.set(`${e}|${l}`, apEst.empresa));
      return apAtualizarSelecao(true);
    }
    const letra = ev.target.closest('[data-ap-letra]');
    if (letra) {
      const l = letra.dataset.apLetra;
      apEst.sel.has(l) ? apEst.sel.delete(l) : apEst.sel.add(l);
      return renderApont();
    }
    const eixo = ev.target.closest('[data-ap-eixo]');
    if (eixo) { apEst.eixo = eixo.dataset.apEixo; apEst.modo = 'viga'; apEst.sel = new Set(); return renderApont(); }
    if (ev.target.id === 'apDefAplicar' && regras()) {
      const ctx = apContexto(regras()), linhas = apDefLinhas(ctx).map(a => a.linha);
      if (!apDef.emp) { toast('Escolha a empresa que montou.', true); return; }
      if (!linhas.length) { toast('Nenhuma peça sem empresa nessa região.', true); return; }
      try { await postar(API + 'apontamento', { reatribuir: true, empresa: apDef.emp, linhas }); await carregar(); toast(`${linhas.length} registro(s) definidos como ${apDef.emp}`); }
      catch (err) { toast(err.message, true); }
      return;
    }
    if (ev.target.id === 'apLimpar') { apEst.sel = new Set(); apEst.mapaJ = new Map(); apEst.mapaV = new Map(); apEst.frente = new Map(); return renderApont(); }
    if (ev.target.id === 'apSalvar') return salvarApontamento();
    const ex = ev.target.closest('[data-ap-excluir]');
    if (ex) {
      if (!ex.dataset.confirmar) { ex.dataset.confirmar = '1'; ex.textContent = 'Confirmar exclusão'; return; }
      try { await postar(API + 'apontamento', { excluir: true, linha: +ex.dataset.apExcluir }); await carregar(); toast('Apontamento excluído e produção ajustada'); }
      catch (err) { toast(err.message, true); }
    }
  });
  sec.addEventListener('change', ev => {
    const id = ev.target.id;
    if (ev.target.dataset.apDef) {
      apDef[ev.target.dataset.apDef] = ev.target.value;
      if (ev.target.dataset.apDef === 'tipo') return renderApont();
      const p = $('#apDefPrev'); if (p && regras()) p.textContent = apDefPrevTxt(apContexto(regras()));
      return;
    }
    if (id === 'apData') { if (ehISO(ev.target.value)) apEst.data = ev.target.value; return apAtualizarSelecao(false); }
    if (id === 'apRegular') { apEst.regular = ev.target.checked; return apAtualizarSelecao(false); }
    if (id === 'apEixo') { apEst.eixo = ev.target.value; apEst.sel = new Set(); return renderApont(); }
  });
  // joists: clique e arraste pintam vários retângulos; o primeiro decide se está marcando ou desmarcando
  sec.addEventListener('mousedown', ev => {
    const slot = ev.target.closest('[data-ap-slot]');
    if (!slot || !regras() || ev.button) return;
    ev.preventDefault();
    if (!apExigirEmpresa()) return;
    const ctx = apContexto(regras()), k = slot.dataset.apSlot;
    if (ctx.slotRow.has(k)) { toast('Essa joist já está apontada. Para corrigir, exclua o apontamento no histórico.'); return; }
    apArraste = apEst.mapaJ.get(k) === apEst.empresa ? 'remove' : 'add';
    apMarcarSlot(ctx, k, apArraste);
    apPintarSlot(slot, k);
    apUltimo = k;
    apAtualizarSelecao(false);
  });
  sec.addEventListener('mouseover', ev => {
    const alvo = ev.target.closest('[data-ap-info]'), info = $('#apMapaInfo');
    if (info) info.textContent = alvo ? alvo.dataset.apInfo : AP_INFO_PADRAO;
    const slot = ev.target.closest('[data-ap-slot]');
    // durante o arraste só o retângulo muda (redesenhar o mapa trocaria o elemento sob o mouse e perderia retângulos)
    if (apArraste && slot && regras()) apArrastarAte(apContexto(regras()), slot.dataset.apSlot);
  });
  document.addEventListener('mouseup', () => {
    if (!apArraste) return;
    apArraste = null; apUltimo = null;
    if (regras()) apAtualizarSelecao(true);   // fim do arraste: atualiza contadores por rua
  });
  sec.addEventListener('input', ev => {
    if (ev.target.id === 'apObs') apEst.obs = ev.target.value;
  });
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

  atualizarContadorKpi();
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

  $('#tabEqCad').innerHTML = `<thead><tr><th>Equipamento</th><th>Tipo</th><th>Cobrança</th><th class="n">Valor</th><th>Responsável</th><th>Situação</th><th></th></tr></thead><tbody>` +
    (T.equipamentos.length ? T.equipamentos.map(e => `<tr><td><b>${esc(e.equipamento)}</b><br><span class="nota">${esc(e.locadora || '')}</span></td><td>${esc(e.tipo || '—')}</td><td>${esc(e.cobranca || '—')}</td><td class="n">${rs(e.valor)}</td><td>${e.responsavel ? `<span class="farol f-amarelo">${esc(e.responsavel)}</span>` : '<span class="nota">—</span>'}</td><td>${esc(e.situacao || '')}</td>
      <td><button class="link" data-editar-reg="equipamentos" data-linha="${e.linha}">Editar</button></td></tr>`).join('')
      : '<tr><td colspan="7" class="vazio">Nenhum equipamento cadastrado.</td></tr>') + '</tbody>';

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
const BM_CONTRATOS = ['RÓTULA'];   // a medição e o pagamento são só do contrato RÓTULA (QPC não é mais usado na tela)
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

// Desconto como nas planilhas: valor fixo ou % do medido no período (ex.: sinal de contrato 10%). Negativo = crédito.
const bmValorDeducao = (d, medido) => d.percentual != null && d.percentual !== '' ? medido * d.percentual / 100 : (d.valor || 0);
// Quantos meses-calendário o período toca (ex.: set/out = 2; dentro de set = 1).
function mesesNoPeriodo(ini, fim) {
  if (!ini || !fim) return 1;
  const [ai, mi] = ini.split('-').map(Number);
  const [af, mf] = fim.split('-').map(Number);
  return Math.max(1, (af - ai) * 12 + (mf - mi) + 1);
}
function bmDeducoes(emp, p, medido = 0) {
  let equip, comb, litros, usos = null, mensalEquip = 0, eqMensList = [];
  if (p.fechado && p.fech) {
    equip = p.fech.equip || 0; comb = p.fech.comb || 0; litros = p.fech.litros || 0;
  } else {
    const rt = ratear(bmTab('usos').filter(u => u.data && u.data >= p.ini && u.data <= p.fim)).filter(r => r.empAjust === emp);
    equip = soma0(rt, r => r.custoR); comb = soma0(rt, r => r.combR); litros = soma0(rt, r => r.litrosR); usos = rt.length;
    // Equipamentos mensais com empresa responsável — deduzidos automaticamente
    const meses = mesesNoPeriodo(p.ini, p.fim);
    eqMensList = bmTab('equipamentos').filter(e =>
      e.cobranca === 'MENSAL' && (e.responsavel || '').toUpperCase() === emp.toUpperCase() &&
      e.valor && e.situacao !== 'DESMOBILIZADO');
    mensalEquip = soma0(eqMensList, e => (e.valor || 0) * meses);
    equip += mensalEquip;
  }
  const manuais = bmTab('bm_deducoes').filter(d => d.empresa === emp && (d.bm != null ? d.bm === p.n : (d.data && d.data >= p.ini && d.data <= p.fim)));
  const total = {};
  BM_CONTRATOS.forEach(c => {
    total[c] = (c === BM_DESCONTA_EQUIP ? equip + comb : 0) + soma0(manuais.filter(d => d.contrato === c || d.contrato === 'AMBOS'), d => bmValorDeducao(d, medido));
  });
  return { equip, comb, litros, manuais: manuais.filter(d => d.contrato !== 'QPC'), total, usos, mensalEquip, eqMensList };
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
  const ded = bmDeducoes(emp, p, tot['RÓTULA'].per);
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

function bmImprimir(r, emp, p) {
  const obraNome = (D.arquivo || 'OBRA 198').replace(/\s*·.*$/, '').trim();
  const R = 'RÓTULA', tot = r.tot[R], dd = r.ded, fat = r.faturar[R];
  const pc = v => nf(v * 100, 1) + '%';
  const anteriores = r.prev ? bmPeriodos(emp).filter(x => x.fechado && x.n < p.n) : [];
  const periodoStr = (p.ini === '0000-01-01' ? 'Início da obra' : fdA(p.ini)) + ' a ' + fdA(p.fim);

  let linhasItens = '';
  r.itens.forEach(it => {
    linhasItens += `<tr style="background:#f0f4f8"><td colspan="4" style="padding:5px 8px;font-weight:bold">${esc(it.item)} — ${esc(cap(it.desc))}</td>
      <td style="text-align:right;padding:5px 8px">${pc(it.pctAnt)}</td><td style="text-align:right;padding:5px 8px">${pc(it.pctPer)}</td><td style="text-align:right;padding:5px 8px;font-weight:bold">${pc(it.pct)}</td>
      <td style="text-align:right;padding:5px 8px">${rs(it.pctAnt * it.valor[R])}</td><td style="text-align:right;padding:5px 8px">${rs(it.pctPer * it.valor[R])}</td><td style="text-align:right;padding:5px 8px;font-weight:bold">${rs(it.pct * it.valor[R])}</td></tr>`;
    it.ats.forEach(x => {
      linhasItens += `<tr><td style="padding:4px 8px 4px 22px;color:#555">${esc(x.a.atividade)}</td><td style="text-align:right;padding:4px 8px;color:#555">${nf(x.a.qtd, 2)} ${esc(x.a.unidade)}</td>
        <td style="text-align:right;padding:4px 8px;color:#555">${nf(x.real - x.realAnt, 2)}</td><td style="text-align:right;padding:4px 8px;color:#555">${nf(x.real, 2)}</td>
        <td colspan="3" style="text-align:right;padding:4px 8px;color:#555">${pc(x.pct)}</td><td colspan="3"></td></tr>`;
    });
  });

  let linhasDesc = `<tr><td style="padding:5px 8px">Acumulado da produção</td><td style="text-align:right;padding:5px 8px">${rs(tot.acum)}</td></tr>
    <tr><td style="padding:5px 8px">(−) Já medido em BMs anteriores${anteriores.length ? ' — ' + anteriores.map(x => 'BM' + x.n).join(' + ') : ''}</td><td style="text-align:right;padding:5px 8px">${rs(tot.ant)}</td></tr>
    <tr style="background:#f0f4f8"><td style="padding:6px 8px;font-weight:bold">Medição do BM${p.n}</td><td style="text-align:right;padding:6px 8px;font-weight:bold">${rs(tot.per)}</td></tr>`;
  const _dailyEquip = dd.equip - dd.mensalEquip;
  if (_dailyEquip + dd.comb > 0) linhasDesc += `<tr><td style="padding:5px 8px">(−) Equipamentos${dd.comb ? ' + Combustível' : ''}</td><td style="text-align:right;padding:5px 8px">${rs(-(_dailyEquip + dd.comb))}</td></tr>`;
  if (dd.mensalEquip) { const _m = mesesNoPeriodo(p.ini, p.fim); dd.eqMensList.forEach(e => { linhasDesc += `<tr><td style="padding:5px 8px">(−) ${esc(e.equipamento)} — locação mensal (${_m}×)</td><td style="text-align:right;padding:5px 8px">${rs(-(e.valor * _m))}</td></tr>`; }); }
  dd.manuais.forEach(d => {
    const v = bmValorDeducao(d, tot.per), pct = d.percentual != null && d.percentual !== '';
    linhasDesc += `<tr><td style="padding:5px 8px">(−) ${esc(cap(d.tipo || 'Outros'))}${d.descricao ? ': ' + esc(d.descricao.replace(/^\[planilha\]\s*/, '')) : ''}${pct ? ' (' + nf(d.percentual, 1) + '% do medido)' : ''}</td><td style="text-align:right;padding:5px 8px">${rs(-v)}</td></tr>`;
  });
  linhasDesc += `<tr style="background:#e8f5e9"><td style="padding:7px 8px;font-weight:bold;font-size:14px">VALOR A FATURAR</td><td style="text-align:right;padding:7px 8px;font-weight:bold;font-size:14px;color:#1b5e20">${rs(fat)}</td></tr>`;

  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
    <title>BM${p.n} · ${esc(emp)} · ${esc(obraNome)}</title>
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: Arial, sans-serif; font-size: 12px; color: #1a1a1a; padding: 20mm 18mm; }
      h1 { font-size: 18px; font-weight: bold; color: #1a237e; margin-bottom: 2px; }
      h2 { font-size: 13px; font-weight: bold; color: #1a237e; border-bottom: 1px solid #1a237e; padding-bottom: 3px; margin: 18px 0 8px; }
      .cabecalho { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1a237e; padding-bottom: 10px; margin-bottom: 14px; }
      .cab-info { font-size: 11px; color: #555; margin-top: 4px; }
      .cab-meta { text-align: right; font-size: 11px; color: #555; }
      .cab-meta b { display: block; font-size: 13px; color: #1a1a1a; }
      .tiles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 14px; }
      .tile { border: 1px solid #ddd; border-radius: 4px; padding: 8px 10px; }
      .tile-rot { font-size: 10px; color: #555; text-transform: uppercase; letter-spacing: .4px; }
      .tile-val { font-size: 16px; font-weight: bold; color: #1a1a1a; margin: 2px 0; }
      .tile-sub { font-size: 10px; color: #777; }
      .tile.destaque { background: #e8f5e9; border-color: #388e3c; }
      .tile.destaque .tile-val { color: #1b5e20; }
      table { width: 100%; border-collapse: collapse; font-size: 11px; }
      th { background: #1a237e; color: #fff; padding: 5px 8px; text-align: left; font-weight: bold; }
      th.n { text-align: right; }
      td { padding: 4px 8px; border-bottom: 1px solid #eee; }
      tfoot td { font-weight: bold; background: #e8eaf6; border-top: 2px solid #1a237e; }
      .assinaturas { display: grid; grid-template-columns: repeat(3, 1fr); gap: 30px; margin-top: 40px; }
      .assin { border-top: 1px solid #1a1a1a; padding-top: 6px; font-size: 10px; text-align: center; color: #444; }
      .rodape { margin-top: 20px; font-size: 9px; color: #aaa; text-align: right; border-top: 1px solid #eee; padding-top: 6px; }
      .status { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 10px; font-weight: bold; }
      .status.fechado { background: #e8f5e9; color: #1b5e20; }
      .status.aberto { background: #fff8e1; color: #e65100; }
      @media print { body { padding: 10mm 12mm; } }
    </style></head><body>
    <div class="cabecalho">
      <div>
        <div style="font-size:11px;color:#555;margin-bottom:4px">BOLETIM DE MEDIÇÃO</div>
        <h1>${esc(obraNome)}</h1>
        <div class="cab-info"><b>${esc(emp)}</b> &nbsp;·&nbsp; BM${p.n} &nbsp;·&nbsp; Contrato RÓTULA</div>
        <div class="cab-info" style="margin-top:3px">Período: ${periodoStr}</div>
        <div style="margin-top:6px"><span class="status ${p.fechado ? 'fechado' : 'aberto'}">${p.fechado ? '● FECHADO em ' + fdA(p.fech.fechado_em) : '● EM ABERTO'}</span></div>
      </div>
      <div class="cab-meta"><b>BM${p.n}</b>${fdA(p.fim)}<br><span style="margin-top:4px;display:block">Emitido em ${new Date().toLocaleString('pt-BR')}</span></div>
    </div>
    <h2>Resumo do BM${p.n}</h2>
    <div class="tiles">
      <div class="tile"><div class="tile-rot">Contrato RÓTULA</div><div class="tile-val">${rs(tot.contrato)}</div><div class="tile-sub">${esc(emp)} · valor total contratado</div></div>
      <div class="tile"><div class="tile-rot">Acumulado da produção</div><div class="tile-val">${rs(tot.acum)}</div><div class="tile-sub">${pc(tot.pctAcum)} do contrato</div></div>
      <div class="tile"><div class="tile-rot">Já medido (BMs anteriores)</div><div class="tile-val">${rs(tot.ant)}</div><div class="tile-sub">${anteriores.length ? anteriores.map(x => 'BM' + x.n).join(' + ') : 'nenhum BM anterior'}</div></div>
      <div class="tile"><div class="tile-rot">Medição do BM${p.n}</div><div class="tile-val">${rs(tot.per)}</div><div class="tile-sub">${pc(tot.pctPer)} do contrato neste período</div></div>
      <div class="tile"><div class="tile-rot">Descontos</div><div class="tile-val">${rs(dd.total[R])}</div><div class="tile-sub">${dd.manuais.length} desconto(s)${dd.equip + dd.comb ? ' + equipamentos' : ''}</div></div>
      <div class="tile destaque"><div class="tile-rot">Valor a faturar</div><div class="tile-val">${rs(fat)}</div><div class="tile-sub">medição − descontos</div></div>
    </div>
    <h2>Medição por item e atividade</h2>
    <table><thead><tr>
      <th>Item / Atividade</th><th class="n">Qtd contratada</th><th class="n">Período (qtd)</th><th class="n">Acumulado (qtd)</th>
      <th class="n">% Já medido</th><th class="n">% Período</th><th class="n">% Acumulado</th>
      <th class="n">Já medido (R$)</th><th class="n">Período (R$)</th><th class="n">Acumulado (R$)</th>
    </tr></thead><tbody>${linhasItens}</tbody>
    <tfoot><tr><td colspan="4"><b>Total do contrato</b></td>
      <td style="text-align:right">${pc(tot.ant / (tot.contrato || 1))}</td><td style="text-align:right">${pc(tot.pctPer)}</td><td style="text-align:right">${pc(tot.pctAcum)}</td>
      <td style="text-align:right">${rs(tot.ant)}</td><td style="text-align:right">${rs(tot.per)}</td><td style="text-align:right">${rs(tot.acum)}</td>
    </tr></tfoot></table>
    <h2>Descontos e valor a faturar</h2>
    <table><thead><tr><th>Descrição</th><th class="n" style="width:160px">Valor (R$)</th></tr></thead>
    <tbody>${linhasDesc}</tbody></table>
    <div class="assinaturas">
      <div class="assin">Responsável pela medição<br>${esc(emp)}</div>
      <div class="assin">Fiscalização / Contratante<br>RÓTULA</div>
      <div class="assin">Aprovação<br>&nbsp;</div>
    </div>
    <div class="rodape">Gerado pelo sistema de controle de obra · ${esc(obraNome)} · BM${p.n} · ${esc(emp)} · ${new Date().toLocaleString('pt-BR')}</div>
  </body></html>`;

  const barra = `<div class="sem-impressao" style="background:#1a237e;color:#fff;padding:10px 14px;margin:-20mm -18mm 16px;display:flex;gap:10px;align-items:center;font-size:12px">
    <button onclick="window.print()" style="padding:7px 16px;border:0;border-radius:4px;background:#fff;color:#1a237e;font-weight:bold;cursor:pointer">⤓ Salvar em PDF</button>
    <span style="opacity:.9">Na janela de impressão, escolha <b>Salvar como PDF</b> no campo "Destino".</span>
  </div>
  <style>@media print { .sem-impressao { display: none !important } }</style>`;

  const w = window.open('', '_blank', 'width=960,height=760');
  if (!w) { alert('Permita pop-ups neste site para baixar o boletim de medição.'); return; }
  w.document.write(html.replace('<body>', '<body>' + barra));
  w.document.close();
  w.onload = () => { w.focus(); w.print(); };
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
  const R = 'RÓTULA', tot = r.tot[R];
  const cc = corEmp(emp);
  const pc = v => nf(v * 100, 1) + '%';
  const idx = ps.findIndex(x => x.chave === p.chave);
  const podeFechar = p.cortado && !p.fechado && ps.slice(0, idx).every(x => x.fechado);
  const podeReabrir = p.fechado && !ps.some(x => x.fechado && x.n > p.n);
  const anteriores = ps.slice(0, idx).filter(x => x.fechado);

  let h = `<div class="barra-acoes"><label class="rot-sel">Medição <select id="selBmPer">${ps.map(x => `<option value="${x.chave}" ${x.chave === bmPerSel ? 'selected' : ''}>${esc(x.rot)}</option>`).join('')}</select></label>
    <span class="status-bm">${p.fechado ? `<span class="farol f-verde">FECHADO em ${fdA(p.fech.fechado_em)}</span>` : `<span class="farol f-amarelo">EM ABERTO</span>`}</span>
    <span class="nota">Período de ${p.ini === '0000-01-01' ? 'início da obra' : fdA(p.ini)} a ${fdA(p.fim)}. ${p.fechado ? 'Valores congelados no fechamento (já medido e pago).' : 'Acumulado da produção lançada, menos o que já foi medido nos BMs anteriores.'}</span>
    <span class="acoes">${!p.cortado ? `<button class="btn" data-novo="bm_periodos" data-preset='${esc(JSON.stringify({ empresa: emp, bm: p.n, corte: p.fim }))}'>Definir corte do BM${p.n}</button>` : ''}${p.cortado && !p.fechado ? `<label class="edit-corte-inline">Corte <input type="date" value="${p.fim}" data-edit-corte="${parseInt(p.chave.slice(1))}" title="Editar data de corte do BM${p.n}"></label>` : ''}${podeFechar ? `<button class="btn primario" data-bm-fechar>Fechar BM${p.n}</button>` : ''}${podeReabrir ? `<button class="btn" data-bm-reabrir>Reabrir BM${p.n}</button>` : ''}<button class="btn" data-bm-imprimir>⤓ Baixar BM${p.n}</button></span></div>`;
  h += '<div class="tiles">' +
    bmTile('Contrato RÓTULA', rs(tot.contrato), `${esc(emp)} · medição só no contrato RÓTULA`, cc) +
    bmTile(p.fechado ? `Acumulado no BM${p.n}` : 'Acumulado da produção', rs(tot.acum), `<b>${pc(tot.pctAcum)}</b> do contrato`, 'var(--fg)') +
    bmTile('Já medido (BMs anteriores)', rs(tot.ant), anteriores.length ? anteriores.map(x => 'BM' + x.n).join(' + ') + ' · já pago' : 'nenhum BM anterior', 'var(--fg3)') +
    bmTile(`Medição do BM${p.n}`, rs(tot.per), `acumulado − já medido · ${pc(tot.pctPer)} do contrato`, 'var(--acento)') +
    bmTile('Descontos', rs(r.ded.total[R]), `${r.ded.manuais.length} lançamento(s)${r.ded.equip + r.ded.comb ? ' + equipamentos' : ''}`, 'var(--vermelho)') +
    bmTile('Valor a faturar', rs(r.faturar[R]), 'medição − descontos', 'var(--verde)') + '</div>';

  const alertas = [];
  r.itens.filter(it => it.pesosAjustados).forEach(it => alertas.push(`Item ${it.item}: os pesos das atividades somam ${nf(it.somaPesos * 100, 1)}% (o sistema normaliza para 100%). Corrija no catálogo.`));
  r.itens.filter(it => it.excedeu).forEach(it => alertas.push(`Item ${it.item}: há atividade com realizado acima da quantidade contratada (limitado a 100% no cálculo).`));
  if (!p.cortado && p.ini === '0000-01-01') alertas.push('Nenhum BM anterior registrado para esta empresa: tudo o que foi produzido até a data aparece neste BM, sem descontar nada já medido. Se já houve medição paga, registre o corte do BM1 em "Períodos e deduções" (EJ e CMM: o programa carrega o BM1 pago ao abrir).');
  if (Math.abs(tot.ajuste) > 0.5) {
    const its = r.itens.filter(it => Math.abs(it.pctAjuste) > 1e-9).map(it => it.item).join(', ');
    alertas.push(`A produção lançada até o corte do ${r.prev ? 'BM' + r.prev.n : 'BM anterior'} (${r.prev ? fdA(r.prev.fim) : ''}) difere do que foi medido nele em ${rs(tot.ajuste)} (itens ${its}). Essa diferença entra neste BM, porque a medição é o acumulado menos o que já foi medido.`);
  }
  if (p.cortado && !p.fechado && !podeFechar) alertas.push(`Para fechar o BM${p.n}, feche antes os BMs anteriores.`);
  if (alertas.length) h += `<div class="bloco"><div class="bloco-cab"><h2>Pontos de atenção</h2></div><ul class="alertas">${alertas.map(a => `<li><span class="farol f-amarelo">Atenção</span><span>${esc(a)}</span></li>`).join('')}</ul></div>`;

  h += `<div class="bloco"><div class="bloco-cab"><h2>Evolução da medição acumulada (RÓTULA)</h2></div><div class="grafico"><canvas id="gBM"></canvas></div></div>`;

  h += `<div class="bloco"><div class="bloco-cab"><h2>Medição por item e atividade</h2><span class="nota">Clique no item para ver as atividades.</span></div><div class="tabela-rolagem"><table class="tabela-bm"><thead><tr>
    <th>Item / atividade</th><th class="n">Contratado</th><th class="n">No período</th><th class="n">Acumulado</th><th class="n">Peso</th><th class="n">% já medido</th><th class="n">% período</th><th class="n">% acumulado</th>
    <th class="n">Já medido (R$)</th><th class="n">Medição do período (R$)</th><th class="n">Acumulado (R$)</th></tr></thead><tbody>`;
  r.itens.forEach(it => {
    const aberto = bmAbertos.has(it.item);
    h += `<tr class="linha-item" data-bm-item="${esc(it.item)}"><td><span class="seta">${aberto ? '▾' : '▸'}</span> <b>${esc(it.item)}</b> ${esc(cap(it.desc))}</td><td></td><td></td><td></td><td></td>
      <td class="n">${pc(it.pctAnt)}</td><td class="n">${pc(it.pctPer)}</td><td class="n"><b>${pc(it.pct)}</b></td>
      <td class="n">${rs(it.pctAnt * it.valor[R])}</td><td class="n">${rs(it.pctPer * it.valor[R])}</td><td class="n">${rs(it.pct * it.valor[R])}</td></tr>`;
    if (aberto) it.ats.forEach(x => {
      h += `<tr class="linha-ativ"><td class="sub-ativ">${esc(x.a.atividade)}</td><td class="n">${nf(x.a.qtd, 1)} ${esc(x.a.unidade)}</td><td class="n">${nf(x.real - x.realAnt, 1)}</td><td class="n">${nf(x.real, 1)}</td>
        <td class="n">${pc((x.a.peso || 0) / it.somaPesos)}</td><td colspan="2"></td><td class="n ${x.real > x.a.qtd ? 'valor-neg' : ''}">${pc(x.pct)}</td><td colspan="3"></td></tr>`;
    });
  });
  h += `</tbody><tfoot><tr><td><b>Total do contrato</b></td><td></td><td></td><td></td><td></td><td class="n">${pc(tot.ant / (tot.contrato || 1))}</td><td class="n">${pc(tot.pctPer)}</td><td class="n"><b>${pc(tot.pctAcum)}</b></td>
    <td class="n">${rs(tot.ant)}</td><td class="n">${rs(tot.per)}</td><td class="n">${rs(tot.acum)}</td></tr></tfoot></table></div></div>`;

  const dd = r.ded, med = tot.per;
  const linhaDesc = d => {
    const v = bmValorDeducao(d, med), pct = d.percentual != null && d.percentual !== '';
    return `<tr><td>(−) ${esc(cap(d.tipo || 'Outros'))}${d.descricao ? ': ' + esc(d.descricao.replace(/^\[planilha\]\s*/, '')) : ''} ${pct ? `<span class="nota">${nf(d.percentual, 1)}% do medido</span>` : ''}
      ${p.fechado ? '' : `<button class="link" data-editar-reg="bm_deducoes" data-linha="${d.linha}">Editar</button>`}</td><td class="n ${v < 0 ? 'valor-pos' : ''}">${rs(-v)}</td></tr>`;
  };
  h += `<div class="bloco"><div class="bloco-cab"><h2>Descontos e valor a faturar — BM${p.n}</h2>
      <div class="acoes"><button class="btn primario" data-novo="bm_deducoes" data-preset='${esc(JSON.stringify({ empresa: emp, bm: p.n, data: p.fim, contrato: R }))}'>+ Desconto</button></div></div>
    <p class="nota">Como nas planilhas de medição: equipamento emprestado da Rótula, faturamento direto, diesel, sinal de contrato (% do medido), medição antecipada, almoço. Lançamentos de "Uso de equipamentos" no período também entram sozinhos.</p>
    <div class="tabela-rolagem"><table><thead><tr><th>Descrição</th><th class="n">RÓTULA</th></tr></thead><tbody>
    <tr><td>Acumulado da produção${p.fechado ? '' : ' (até ' + fdA(p.fim) + ')'}</td><td class="n">${rs(tot.acum)}</td></tr>
    <tr><td>(−) Já medido em BMs anteriores${anteriores.length ? ' <span class="nota">' + anteriores.map(x => 'BM' + x.n).join(' + ') + '</span>' : ''}</td><td class="n">${rs(tot.ant)}</td></tr>
    <tr class="linha-total"><td><b>Medição do BM${p.n}</b></td><td class="n"><b>${rs(med)}</b></td></tr>` +
    (dd.equip - dd.mensalEquip > 0 ? `<tr><td>(−) Equipamentos <span class="nota">${dd.usos == null ? 'valor do fechamento' : dd.usos + ' lançamento(s) em Equipamentos, de ' + (p.ini === '0000-01-01' ? 'início da obra' : fdA(p.ini)) + ' a ' + fdA(p.fim)}</span></td><td class="n">${rs(-(dd.equip - dd.mensalEquip))}</td></tr>` : '') +
    (dd.mensalEquip ? dd.eqMensList.map(e => `<tr><td>(−) ${esc(e.equipamento)} — locação mensal <span class="nota">${mesesNoPeriodo(p.ini, p.fim)}× R$ ${nf(e.valor, 0)} · responsável ${esc(e.responsavel)}</span></td><td class="n">${rs(-(e.valor * mesesNoPeriodo(p.ini, p.fim)))}</td></tr>`).join('') : '') +
    (dd.comb ? `<tr><td>(−) Combustível <span class="nota">${nf(dd.litros, 1)} L</span></td><td class="n">${rs(-dd.comb)}</td></tr>` : '') +
    (dd.manuais.length ? dd.manuais.map(linhaDesc).join('') : '<tr><td class="vazio" colspan="2">Nenhum desconto lançado neste BM. Use "+ Desconto".</td></tr>') +
    `</tbody><tfoot><tr><td><b>Valor a faturar</b></td><td class="n"><b>${rs(r.faturar[R])}</b></td></tr></tfoot></table></div></div>`;
  box.innerHTML = h;

  const ev = bmEvolucao(emp);
  if (ev.length) trocarGrafico('gBM', {
    type: 'line',
    data: { labels: ev.map(x => fd(x.dia)), datasets: [
      { label: 'RÓTULA', data: ev.map(x => +x['RÓTULA'].toFixed(2)), borderColor: corEmpHex(emp), backgroundColor: corEmpHex(emp), tension: .25, pointRadius: 2 }] },
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
    <div class="bloco"><div class="bloco-cab"><h2>Descontos dos BMs</h2><button class="btn primario" data-novo="bm_deducoes">+ Desconto</button></div>
      <p class="nota">Equipamento emprestado, faturamento direto, diesel, sinal de contrato (% do medido), medição antecipada, almoço... Valor negativo é crédito. Equipamentos lançados em Equipamentos entram sozinhos.</p>
      <div class="tabela-rolagem"><table><thead><tr><th>Data</th><th>BM</th><th>Tipo</th><th>Descrição</th><th class="n">Valor / %</th><th></th></tr></thead><tbody>` +
    (ds.length ? ds.map(d => `<tr><td>${fdA(d.data)}</td><td>${d.bm != null ? 'BM' + d.bm : '—'}</td><td>${esc(cap(d.tipo || ''))}</td><td>${esc((d.descricao || '').replace(/^\[planilha\]\s*/, ''))}</td><td class="n">${d.percentual != null ? nf(d.percentual, 1) + '%' : rs(d.valor)}</td>
      <td><button class="link" data-editar-reg="bm_deducoes" data-linha="${d.linha}">Editar</button></td></tr>`).join('')
      : '<tr><td colspan="6" class="vazio">Nenhum desconto lançado.</td></tr>') + `</tbody></table></div></div></div>`;
}

function renderBMCatalogo(box) {
  const its = bmItens(bmEmp, ref);
  let h = `<div class="bloco"><div class="bloco-cab"><h2>Catálogo de atividades — ${esc(bmEmp)}</h2><div class="acoes"><button class="btn primario" data-novo="bm_atividades">+ Atividade</button></div></div>
    <p class="nota">Peso e quantidade vêm da memória de cálculo do BM. Atividades marcadas com "controle" são lançadas na mesma coluna da grade de produção.</p>
    <div class="tabela-rolagem"><table><thead><tr><th>Código</th><th>Atividade</th><th>Un.</th><th class="n">Quantidade</th><th class="n">Peso</th><th>Coluna no controle</th><th></th></tr></thead><tbody>`;
  its.forEach(it => {
    h += `<tr class="grupo-item"><td colspan="3"><b>${esc(it.item)}</b> ${esc(cap(it.desc))}</td><td class="n" colspan="2">RÓTULA ${rs(it.valor['RÓTULA'])}</td>
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
    ['cobranca', 'Cobrança', 'select:,DIÁRIA,HORA,TURNO,MENSAL'], ['valor', 'Valor unitário (R$)', 'num'],
    ['responsavel', 'Empresa responsável (MENSAL → deduzido da medição automaticamente)', 'empresa'],
    ['consumo_lh', 'Consumo estimado (L/h)', 'num'],
    ['situacao', 'Situação', 'select:ATIVO,MANUTENÇÃO,DESMOBILIZADO'], ['obs', 'Observação', 'text', 0, 'largo']] },
  usos: { tit: 'uso / abastecimento', campos: [
    ['data', 'Data', 'date', 1], ['equipamento', 'Equipamento', 'equipamento', 1], ['empresa', 'Empresa (EJ/CMM divide o custo)', 'empresa', 1],
    ['uso', 'Uso', 'select:DIÁRIA,TURNO,MEIO TURNO,HORAS,ABASTECIMENTO,NÃO USO', 1], ['quantidade', 'Qtd (diárias ou horas)', 'num'],
    ['custo', 'Custo do equipamento (R$)', 'num'], ['litros', 'Combustível (L)', 'num'], ['preco_litro', 'Preço do litro (R$)', 'num'],
    ['custo_combustivel', 'Custo combustível (R$) — calculado se vazio', 'num'], ['operador', 'Operador', 'text'], ['obs', 'Observação', 'text', 0, 'largo']] },
  bm_periodos: { tit: 'período de medição (BM)', campos: [
    ['empresa', 'Empresa', 'empresa', 1], ['bm', 'Nº do BM', 'num', 1], ['corte', 'Data de corte', 'date', 1], ['obs', 'Observação', 'text', 0, 'largo']] },
  bm_deducoes: { tit: 'desconto do BM', campos: [
    ['empresa', 'Empresa', 'empresa', 1], ['bm', 'Nº do BM (vazio = pela data)', 'num'], ['data', 'Data', 'date', 1],
    ['tipo', 'Tipo', 'select:EQUIPAMENTO EMPRESTADO,FATURAMENTO DIRETO,COMBUSTÍVEL,SINAL DE CONTRATO,MEDIÇÃO ANTECIPADA,REFEIÇÃO,ADIANTAMENTO,OUTROS', 1],
    ['valor', 'Valor a descontar (R$) — negativo = crédito', 'num'],
    ['percentual', '% do medido no período (ex.: 10 = sinal de contrato; vazio = usa o valor)', 'num'],
    ['contrato', 'Contrato', 'select:RÓTULA', 1], ['descricao', 'Descrição', 'text', 0, 'largo']] },
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
  cliente: { tit: 'serviço do contrato', campos: [
    ['servico', 'Serviço', 'servico', 1],
    ['frente', 'Frente (Fase 1 = ECLUSA / GALPÃO F1 etc.; Fase 2 = GALPÃO F2)', 'text'],
    ['qtd', 'Quantidade contratada', 'num'],
    ['inicio_plan', 'Início planejado', 'date'],
    ['meta_dia', 'Meta cliente / dia', 'num'],
    ['du_semana', 'Dias úteis / semana', 'num'],
    ['prazo', 'Prazo', 'date'],
    ['peso', 'Peso (0–100)', 'num'],
    ['responsavel', 'Responsável', 'text'],
    ['obs', 'Observação', 'text', 0, 'largo']] }
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
  ['estMatFiltro', 'estMatLocal', 'estMatTipo', 'estMatEtapa', 'estMatStatus'].forEach(id => {
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
  ligarEdicaoEstoque();

  $('#segGanZoom').addEventListener('click', ev => { const b = ev.target.closest('[data-gan-zoom]'); if (b) { ganEst.zoom = b.dataset.ganZoom; ganEst.rolou = false; renderGantt(); } });
  $('#selGanFrente').addEventListener('change', ev => { ganEst.frente = ev.target.value; renderGantt(); });
  $('#chkGanEmp').addEventListener('change', ev => { ganEst.porEmp = ev.target.checked; renderGantt(); });

  // Planejamento de montagem
  $('#segPlanFrente').addEventListener('click', ev => {
    const b = ev.target.closest('[data-plan-frente]');
    if (b) { planEst.frente = b.dataset.planFrente; planDados = null; renderPlanejamento(); }
  });
  $('#btnSalvarPlan').addEventListener('click', async () => {
    const rows = document.querySelectorAll('#tabPlan tbody tr[data-plan-chave]');
    const setores = [];
    rows.forEach(tr => {
      const chave = tr.dataset.planChave;
      const ini = tr.querySelector('.plan-ini')?.value || null;
      const fim = tr.querySelector('.plan-fim')?.value || null;
      const obs = tr.querySelector('.plan-obs')?.value || '';
      setores.push({ chave, data_plan_inicio: ini || null, data_plan_fim: fim || null, obs });
    });
    try {
      const r = await postarBruto(API + 'planejamento', { setores });
      if (r.ok) {
        planDados = null;
        toast(`${setores.length} setor(es) salvos!`);
        renderPlanejamento();
      } else {
        const err = await r.json().catch(() => ({}));
        toast(err.erro || 'Erro ao salvar planejamento.', true);
      }
    } catch (e) { toast('Erro ao salvar: ' + e.message, true); }
  });
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
    if (novo) {
      let preset = novo.dataset.novo.startsWith('bm_') && bmEmp ? { empresa: bmEmp } : {};
      if (novo.dataset.preset) { try { preset = { ...preset, ...JSON.parse(novo.dataset.preset) }; } catch { } }
      abrirDialogo(novo.dataset.novo, null, preset);
    }
    const ed = ev.target.closest('[data-editar-reg]');
    if (ed) abrirDialogo(ed.dataset.editarReg, +ed.dataset.linha);
    const mv = ev.target.closest('[data-mov]');
    if (mv) abrirDialogo('movimentos', null, { codigo: mv.dataset.mov, tipo: 'ENTRADA' });
    if (ev.target.id === 'btnSemearMat') semearMateriais();
  });

  $('#faseCaixaLista').addEventListener('click', ev => {
    const b = ev.target.closest('button[data-fase]');
    if (!b) return;
    faseFiltro = b.dataset.fase;
    atualizarFaseCaixa();
    document.getElementById('faseCaixa').removeAttribute('open');
    renderAba();
  });

  document.getElementById('aba-avanco').addEventListener('click', ev => {
    const td = ev.target.closest('td[data-edit-campo]');
    if (!td || td.querySelector('input')) return;
    const campo = td.dataset.editCampo;
    const id = parseInt(td.dataset.editId);
    const valAtual = td.dataset.editVal;
    const isDate = campo === 'prazo';
    const inp = document.createElement('input');
    inp.type = isDate ? 'date' : 'number';
    inp.min = isDate ? undefined : '0';
    inp.step = isDate ? undefined : '1';
    inp.value = valAtual;
    inp.style.cssText = 'width:100%;border:0;background:var(--acento-suave);padding:3px 5px;border-radius:3px;font:inherit;text-align:right;outline:1px solid var(--acento);';
    td.textContent = '';
    td.appendChild(inp);
    inp.focus();
    if (!isDate) inp.select();
    let salvo = false;
    async function salvarEdicao() {
      if (salvo) return; salvo = true;
      const raw = inp.value.trim();
      const campos = {};
      if (isDate) { campos[campo] = raw || null; }
      else { const n = raw === '' ? null : parseFloat(raw); campos[campo] = n; }
      try {
        await postar(API + 'registro', { tabela: 'cliente', linha: id, campos });
        const idx = M.cliente.findIndex(c => c.linha === id);
        if (idx >= 0) Object.assign(M.cliente[idx], campos);
        renderAvanco();
      } catch (e) {
        salvo = false;
        renderAvanco();
        toast(e.message || 'Erro ao salvar.');
      }
    }
    inp.addEventListener('blur', salvarEdicao);
    inp.addEventListener('keydown', ke => {
      if (ke.key === 'Enter') { ke.preventDefault(); inp.blur(); }
      if (ke.key === 'Escape') { salvo = true; renderAvanco(); }
    });
  });

  document.getElementById('btnPopularQtd').addEventListener('click', async () => {
    if (!confirm('Preencher automaticamente as quantidades do contrato a partir dos escopos cadastrados por empresa?\nApenas serviços sem quantidade serão atualizados.')) return;
    try {
      const r = await postar(API + 'popular-qtd-cliente', {});
      toast(`${r.atualizados} serviço(s) atualizado(s).`);
      await carregar();
      renderAvanco();
    } catch (e) {
      toast(e.message || 'Erro ao importar quantidades.');
    }
  });

  document.getElementById('btnNovoServico').addEventListener('click', () => {
    const preset = {};
    if (faseFiltro === '2') preset.frente = 'GALPÃO F2';
    abrirDialogo('cliente', null, preset);
  });

  document.getElementById('btnCriarFase2').addEventListener('click', async () => {
    if (!confirm('Criar serviços GALPÃO F2 (espelhos dos serviços existentes) para eixos 01-10?\nEscopos do IFC serão preenchidos onde disponíveis.')) return;
    try {
      const r = await postar(API + 'popular-fase2-servicos', {});
      toast(`${r.criados} serviço(s) criado(s) para GALPÃO F2.`);
      await carregar();
      renderAvanco();
    } catch (e) {
      toast(e.message || 'Erro ao criar serviços Fase 2.');
    }
  });

  $('#segPainelEmp').addEventListener('click', ev => {
    const b = ev.target.closest('button[data-painel-emp]');
    if (!b) return;
    painelEmpFiltro = b.dataset.painelEmp || null;
    renderPainel();
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
    if (ev.target.closest('[data-bm-imprimir]')) {
      const e2 = bmEmp, ps = bmPeriodos(e2);
      const p2 = ps.find(x => x.chave === bmPerSel) || ps[ps.length - 1];
      if (p2) bmImprimir(bmCalc(e2, p2), e2, p2);
    }
  });
  $('#aba-bm').addEventListener('change', async ev => {
    if (ev.target.id === 'selBmPer') { bmPerSel = ev.target.value; renderBM(); return; }
    const ci = ev.target.closest('[data-edit-corte]');
    if (ci) {
      const id = parseInt(ci.dataset.editCorte);
      const val = ci.value;
      if (!val) return;
      ci.disabled = true;
      try {
        await postar(API + 'registro', { tabela: 'bm_periodos', linha: id, campos: { corte: val } });
        await carregar();
        renderBM();
      } catch (e) {
        toast(e.message || 'Erro ao salvar data de corte.');
        ci.disabled = false;
      }
    }
  });
  $('#btnSalvar').onclick = salvarLanc;
  $('#btnDescartar').onclick = () => { pend.clear(); bmPend.clear(); atualizarPendentes(); renderLanc(); verificarVersao(); };
  document.addEventListener('keydown', ev => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 's' && !$('#dlg').open) {
      ev.preventDefault();
      if (abaAtual === 'metas') salvarMetas(); else salvarLanc();
    }
  });
  window.addEventListener('beforeunload', ev => { if (pend.size || bmPend.size || metasPend.size || planoPend.size) { ev.preventDefault(); ev.returnValue = ''; } });

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

  $('#tabPlanoAcao').addEventListener('input', ev => {
    const inp = ev.target.closest('.plano-in'); if (!inp) return;
    const emp = inp.dataset.emp, serv = inp.dataset.serv, fase = inp.dataset.fase;
    const v = inp.value === '' ? null : Math.max(0, Number(inp.value));
    const sel = f => document.querySelector(`input.plano-in[data-emp="${CSS.escape(emp)}"][data-serv="${CSS.escape(serv)}"][data-fase="${f}"]`);

    if (fase === 'T') {
      // Total editado: F2 = Total - F1, F1 fica
      const f1Val = +(sel('1')?.value || 0);
      const f2Val = v !== null ? Math.max(0, v - f1Val) : null;
      planoPend.set(_pKey(emp, serv, 'T'), v);
      planoPend.set(_pKey(emp, serv, '2'), f2Val);
      const f2Inp = sel('2'); if (f2Inp) f2Inp.value = f2Val !== null ? f2Val : '';
    } else {
      // F1 ou F2 editado: Total = F1 + F2
      planoPend.set(_pKey(emp, serv, fase), v);
      const otherFase = fase === '1' ? '2' : '1';
      const otherVal = +(sel(otherFase)?.value || 0);
      const totVal = (v || 0) + otherVal;
      planoPend.set(_pKey(emp, serv, 'T'), totVal);
      const totInp = sel('T'); if (totInp) totInp.value = totVal;
    }

    const nPend = [...planoPend].filter(([k]) => !k.endsWith('\x1FT')).length;
    $('#btnSalvarPlano').disabled = !nPend;
    $('#planoTxt').textContent = nPend
      ? `${nPend} meta(s) pendente(s) — clique em "Salvar" para registrar`
      : '';
  });
  $('#btnSalvarPlano').onclick = salvarPlanoAcao;

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
  ligarApontamento();
  vigiarScrollTopo();
}

// ------------------------------------------------------------ início
(async function iniciar() {
  ref = hoje();
  ligarEventos();
  let aba = 'painel';
  try { aba = localStorage.getItem('obra198_aba') || 'painel'; } catch { }
  if (aba === 'estoque') aba = 'estmat';   // a aba única de estoque virou uma aba por assunto
  $('#refData').value = ref;
  const s = segunda(ref);
  per = { ini: s, fim: add(s, 6) };
  try { await carregar(); definirRef(ref); }
  catch (err) { $('#pontoSync').className = 'ponto erro'; $('#arquivoTxt').textContent = err.message; }
  patchDatas();
  atualizarBotoesSegFase();
  mudarAba(document.getElementById('aba-' + aba) ? aba : 'painel');
  setInterval(verificarVersao, 4000);
  mostrarAtualizacao(); setInterval(mostrarAtualizacao, 20000);
  $('#btnAtualizar').onclick = verificarAtualizacaoAgora;
})();
