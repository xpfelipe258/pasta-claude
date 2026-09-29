'use strict';

// ------------------------------------------------------------ estado
let D = null;            // resposta de /api/dados
let M = null;            // modelo da planilha
let ref = null;
let abaAtual = 'painel';
let empSel = null;
let filtroImp = 'abertos';
const pend = new Map();  // `${aba}|${data}|${col}` -> texto digitado
const metasPend = new Map(); // linha -> {meta_dia, du, gap}
const graficos = {};
let salvando = false;

const DIAS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const COR_EMP = { 'EJ': '--ej', 'CMM': '--cmm', 'GLOBO AÇOS': '--ga' };

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
function fd(s) { if (!s) return '—'; if (!ehISO(s)) return esc(s); const [, m, d] = s.split('-'); return `${d}/${m}`; }
function fdA(s) { if (!s) return '—'; if (!ehISO(s)) return esc(s); const [y, m, d] = s.split('-'); return `${d}/${m}/${y}`; }
function esc(v) { return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function nf(v, dec = 0) { return v == null || isNaN(v) ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: dec }); }
function cap(s) { return String(s || '').toLowerCase().replace(/(^|\s|–|-)(\S)/g, (m, a, b) => a + b.toUpperCase()); }
function cor(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }
function corEmp(nome) { return `var(${COR_EMP[nome] || '--acento'})`; }
function diaUtil(s) { return dow(s) < 5; }
function somarDiasUteis(s, n) { let d = s; while (n > 0) { d = add(d, 1); if (diaUtil(d)) n--; } return d; }

function toast(msg, erro = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast mostra' + (erro ? ' erro' : '');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.className = 'toast' + (erro ? ' erro' : ''), erro ? 6000 : 2600);
}

// ------------------------------------------------------------ dados
function empresa(nome) { return M.empresas.find(e => e.nome === nome); }
function colDe(e, serv) { const s = e && e.servicos.find(x => x.nome === serv); return s ? s.col : null; }
function soma(e, col, ini, fim) {
  let t = 0;
  for (const d in e.registros) {
    if (d >= ini && d <= fim) { const v = e.registros[d].v[col]; if (typeof v === 'number') t += v; }
  }
  return t;
}
function metasSemana(r) { const s = segunda(r); return M.metas.filter(m => m.inicio === s); }

function diasDecorridos(m, r) {
  if (r < m.inicio) return 0;
  const lim = r < m.fim ? r : m.fim;
  let n = 0;
  for (let d = m.inicio; d <= lim; d = add(d, 1)) if (diaUtil(d)) n++;
  return m.du ? Math.min(n, m.du) : n;
}

function kpi(m, r) {
  const e = empresa(m.empresa), col = colDe(e, m.servico);
  const semana = m.meta_dia * m.du + (m.gap || 0);
  const dec = diasDecorridos(m, r);
  const prevAte = m.du ? semana * dec / m.du : 0;
  const lim = r < m.fim ? r : m.fim;
  const real = col && r >= m.inicio ? soma(e, col, m.inicio, lim) : 0;
  const realSemana = col ? soma(e, col, m.inicio, m.fim) : 0;
  const pct = prevAte > 0 ? real / prevAte * 100 : null;
  return { m, e, col, semana, prevAte, real, realSemana, pct, dec };
}

function farol(pct, semMeta) {
  if (semMeta) return ['pendente', 'SEM META'];
  if (pct == null) return ['pendente', 'PENDENTE'];
  if (pct >= 100) return ['verde', 'VERDE'];
  if (pct >= 90) return ['amarelo', 'AMARELO'];
  return ['vermelho', 'VERMELHO'];
}
function farolHtml(pct, semMeta) { const [c, t] = farol(pct, semMeta); return `<span class="farol f-${c}">${t}</span>`; }

// ------------------------------------------------------------ comunicação
async function carregar() {
  const r = await fetch('/api/dados', { cache: 'no-store' });
  const j = await r.json();
  if (!r.ok) throw new Error(j.erro || 'Falha ao ler a planilha');
  D = j; M = j.modelo;
  if (!empSel || !M.empresas.some(e => e.aba === empSel)) empSel = M.empresas[0]?.aba;
  $('#arquivoTxt').textContent = `${j.arquivo} · gravada em ${new Date(j.modificado).toLocaleString('pt-BR')}`;
  $('#pontoSync').className = 'ponto ok';
  $('#faixaExterna').hidden = true;
  renderTudo();
}

async function postar(url, corpo) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
  const j = await r.json().catch(() => ({ erro: 'Resposta inválida do servidor' }));
  if (!r.ok) throw new Error(j.erro || 'Falha ao gravar');
  return j;
}

async function verificarVersao() {
  if (salvando || !D) return;
  try {
    const r = await fetch('/api/versao', { cache: 'no-store' });
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

// ------------------------------------------------------------ navegação
function mudarAba(nome) {
  abaAtual = nome;
  document.querySelectorAll('#abas button').forEach(b => b.classList.toggle('ativa', b.dataset.aba === nome));
  document.querySelectorAll('main > section').forEach(s => s.hidden = s.id !== 'aba-' + nome);
  try { localStorage.setItem('obra198_aba', nome); } catch { }
  renderAba();
}

function definirRef(d) {
  if (!ehISO(d)) return;
  ref = d;
  $('#refData').value = d;
  const s = segunda(d);
  $('#semanaTxt').textContent = `Semana ${fdA(s)} a ${fdA(add(s, 6))}`;
  renderTudo();
}

function renderTudo() {
  if (!M) return;
  const abertos = M.impactos.filter(i => !i.solucionado).length;
  $('#impCont').hidden = !abertos; $('#impCont').textContent = abertos;
  atualizarPendentes();
  renderAba();
}

function renderAba() {
  if (!M) return;
  ({ painel: renderPainel, semana: renderSemana, lanc: renderLanc, avanco: renderAvanco,
     metas: renderMetas, impactos: renderImpactos, tendencia: renderTendencia })[abaAtual]();
}

// ------------------------------------------------------------ PAINEL
function renderPainel() {
  const ks = metasSemana(ref).map(m => kpi(m, ref));
  $('#notaFarol').textContent = ks.length ? `Previsto proporcional aos dias úteis até ${fdA(ref)}` : '';

  const porEmp = {};
  ks.forEach(k => {
    const o = porEmp[k.m.empresa] ||= { prev: 0, real: 0, semana: 0 };
    if (k.semana > 0) { o.prev += k.prevAte; o.real += k.real; o.semana += k.semana; }
  });
  const tot = Object.values(porEmp).reduce((a, o) => ({ prev: a.prev + o.prev, real: a.real + o.real, semana: a.semana + o.semana }), { prev: 0, real: 0, semana: 0 });
  const tile = (rot, o, c) => {
    const pct = o.prev > 0 ? o.real / o.prev * 100 : null;
    return `<div class="tile" style="--c:${c}"><div class="rot"><span>${esc(rot)}</span>${farolHtml(pct, o.semana === 0)}</div>
      <div class="val">${pct == null ? '—' : nf(pct) + '%'}</div>
      <div class="sub">${nf(o.real)} realizados de ${nf(o.prev, 1)} previstos até ${fd(ref)} · meta semana ${nf(o.semana, 1)}</div></div>`;
  };
  $('#tiles').innerHTML = ks.length
    ? tile('Geral da obra', tot, 'var(--fg)') + Object.entries(porEmp).map(([n, o]) => tile(n, o, corEmp(n))).join('')
    : `<div class="bloco vazio">Não há metas cadastradas para a semana de ${fdA(segunda(ref))}. Cadastre em METAS EMPRESAS.</div>`;

  let h = `<thead><tr><th>Serviço</th><th class="n">Meta/dia</th><th class="n">Meta semana</th><th class="n">Previsto até ${fd(ref)}</th><th class="n">Realizado</th><th class="n">Desvio</th><th>Farol</th><th style="min-width:110px">Semana</th></tr></thead><tbody>`;
  let ultimo = null;
  ks.forEach(k => {
    if (k.m.empresa !== ultimo) { ultimo = k.m.empresa; h += `<tr class="grupo"><td colspan="8"><span class="emp-tag" style="--c:${corEmp(ultimo)}">${esc(ultimo)}</span></td></tr>`; }
    const desvio = k.real - k.prevAte;
    const pctSem = k.semana > 0 ? Math.min(100, k.realSemana / k.semana * 100) : 0;
    h += `<tr><td>${esc(cap(k.m.servico))}</td><td class="n">${nf(k.m.meta_dia, 2)}</td><td class="n">${nf(k.semana, 1)}</td>
      <td class="n">${nf(k.prevAte, 1)}</td><td class="n"><b>${nf(k.real, 1)}</b></td>
      <td class="n" style="color:${k.semana === 0 ? 'inherit' : desvio < 0 ? 'var(--vermelho)' : 'var(--verde)'}">${k.semana === 0 ? '—' : (desvio > 0 ? '+' : '') + nf(desvio, 1)}</td>
      <td>${farolHtml(k.pct, k.semana === 0)}</td>
      <td><div class="barra" title="${nf(pctSem)}% da meta semanal"><i style="width:${pctSem}%;--c:${corEmp(k.m.empresa)}"></i></div></td></tr>`;
  });
  $('#tabFarol').innerHTML = h + '</tbody>';

  renderAlertas(ks);
  graficoPainel(ks);
}

function renderAlertas(ks) {
  const al = [];
  ks.filter(k => k.semana > 0 && k.pct != null && k.pct < 90).sort((a, b) => a.pct - b.pct).forEach(k =>
    al.push(['vermelho', `<b>${esc(k.m.empresa)} · ${esc(cap(k.m.servico))}</b>: ${nf(k.real, 1)} de ${nf(k.prevAte, 1)} previstos (${nf(k.pct)}%). Faltam ${nf(k.semana - k.realSemana, 1)} para a meta da semana.`]));
  ks.filter(k => k.semana > 0 && k.pct != null && k.pct >= 90 && k.pct < 100).forEach(k =>
    al.push(['amarelo', `<b>${esc(k.m.empresa)} · ${esc(cap(k.m.servico))}</b>: no limite (${nf(k.pct)}%).`]));

  const s = segunda(ref);
  const empsComMeta = [...new Set(ks.filter(k => k.semana > 0).map(k => k.m.empresa))];
  empsComMeta.forEach(n => {
    const e = empresa(n); if (!e) return;
    const faltam = [];
    for (let d = s; d < ref; d = add(d, 1)) if (diaUtil(d) && !e.registros[d]) faltam.push(fd(d));
    if (faltam.length) al.push(['amarelo', `<b>${esc(n)}</b> sem lançamento em ${faltam.join(', ')}. <button class="link" data-ir-lanc="${esc(e.aba)}">Lançar agora</button>`]);
  });

  const abertos = M.impactos.filter(i => !i.solucionado);
  if (abertos.length) {
    const velhos = abertos.filter(i => ehISO(i.data)).sort((a, b) => a.data.localeCompare(b.data)).slice(0, 3)
      .map(i => `${esc(cap(i.motivo))} (${diasEntre(i.data, ref)} dias)`);
    al.push(['vermelho', `<b>${abertos.length} impacto(s) em aberto</b>. Mais antigos: ${velhos.join('; ')}. <button class="link" data-ir-aba="impactos">Ver impactos</button>`]);
  }

  contratoLinhas().filter(c => c.status === 'ATRASO').forEach(c =>
    al.push(['vermelho', `<b>${esc(cap(c.servico))}</b>: no ritmo atual termina em ${fdA(c.projecao)}, depois do prazo ${fdA(c.prazo)}.`]));

  $('#alertas').innerHTML = al.length
    ? al.map(([n, t]) => `<li><span class="farol f-${n}">${n === 'vermelho' ? 'CRÍTICO' : 'ATENÇÃO'}</span><span>${t}</span></li>`).join('')
    : '<li class="vazio">Nenhum ponto de atenção para esta data.</li>';
}

function eixos(extraY = {}) {
  const txt = cor('--fg2'), grade = cor('--linha');
  return {
    x: { ticks: { color: txt }, grid: { display: false } },
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
  const lista = ks.filter(k => k.semana > 0 || k.real > 0);
  trocarGrafico('gPainel', {
    type: 'bar',
    data: {
      labels: lista.map(k => [k.m.empresa, cap(k.m.servico)]),
      datasets: [
        { label: 'Previsto até a data', data: lista.map(k => +k.prevAte.toFixed(1)), backgroundColor: cor('--prev'), borderRadius: 4, maxBarThickness: 28 },
        { label: 'Realizado', data: lista.map(k => k.real), backgroundColor: lista.map(k => cor(COR_EMP[k.m.empresa] || '--acento')), borderRadius: 4, maxBarThickness: 28 },
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
  // demais frentes com produção na semana
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
  $('#planejado').innerHTML = plan.length ? plan.map(k => `<li><span><span class="emp-tag" style="--c:${corEmp(k.m.empresa)}">${esc(k.m.empresa)}</span> ${esc(cap(k.m.servico))}</span>
      <span>${nf(k.m.meta_dia, 2)}/dia × ${nf(k.m.du)} dias${k.m.gap ? ` + GAP ${nf(k.m.gap, 1)}` : ''} = <b>${nf(k.semana, 1)}</b></span></li>`).join('')
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
    const n = [...pend.keys()].filter(k => k.startsWith(e.aba + '|')).length;
    return `<button data-emp="${esc(e.aba)}" class="${e.aba === empSel ? 'ativa' : ''}">${esc(e.nome)}${n ? ` <span class="contador">${n}</span>` : ''}</button>`;
  }).join('');
  const e = M.empresas.find(x => x.aba === empSel);
  if (!e) return;
  const s = segunda(ref), dias = [0, 1, 2, 3, 4, 5, 6].map(i => add(s, i));
  const noCal = new Set(M.datas);

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
      return `<td><input class="${cls} ${pend.has(k) ? 'editado' : ''} ${ehTexto && cls !== 'txt' ? 'texto-val' : ''}" data-d="${d}" data-c="${col}" value="${esc(v)}" ${dentro ? '' : 'disabled'} inputmode="${cls === 'txt' ? 'text' : 'decimal'}" aria-label="${DIAS[i]} ${fd(d)}"></td>`;
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

function atualizarPendentes() {
  const n = pend.size;
  $('#pendCont').hidden = !n; $('#pendCont').textContent = n;
  $('#pendTxt').textContent = n ? `${n} alteração(ões) não salva(s)` : 'Tudo salvo na planilha';
  $('#btnSalvar').disabled = !n || salvando;
  $('#btnDescartar').disabled = !n || salvando;
}

function aoEditarLanc(inp) {
  const e = M.empresas.find(x => x.aba === empSel);
  const k = chave(e.aba, inp.dataset.d, inp.dataset.c);
  const novo = inp.value.trim();
  if (novo === textoSalvo(e, inp.dataset.d, inp.dataset.c)) pend.delete(k); else pend.set(k, novo);
  inp.classList.toggle('editado', pend.has(k));
  atualizarPendentes();
  const n = [...pend.keys()].filter(x => x.startsWith(e.aba + '|')).length;
  const b = document.querySelector(`#segEmpresas button[data-emp="${CSS.escape(e.aba)}"]`);
  if (b) b.innerHTML = `${esc(e.nome)}${n ? ` <span class="contador">${n}</span>` : ''}`;
}

async function salvarLanc() {
  if (!pend.size || salvando) return;
  salvando = true; atualizarPendentes();
  const porAba = {};
  pend.forEach((v, k) => { const [aba, data, col] = k.split('|'); (porAba[aba] ||= []).push({ data, col, valor: v === '' ? null : v }); });
  try {
    let total = 0;
    for (const [aba, alteracoes] of Object.entries(porAba)) {
      const r = await postar('/api/producao', { aba, alteracoes });
      total += r.celulas;
      [...pend.keys()].filter(k => k.startsWith(aba + '|')).forEach(k => pend.delete(k));
    }
    salvando = false;
    await carregar();
    toast(`Salvo na planilha (${total} célula(s))`);
  } catch (err) {
    salvando = false; atualizarPendentes();
    toast(err.message, true);
  }
}

// ------------------------------------------------------------ AVANÇO FÍSICO
function realizadoTotal(servico, ate) {
  let t = 0;
  M.empresas.forEach(e => e.servicos.filter(s => s.nome === servico).forEach(s => t += soma(e, s.col, '0000', ate)));
  return t;
}

function contratoLinhas() {
  const ini = add(ref, -14);
  let du = 0; for (let d = ini; d <= ref; d = add(d, 1)) if (diaUtil(d)) du++;
  return M.cliente.filter(c => c.qtd).map(c => {
    const real = realizadoTotal(c.servico, ref);
    const ritmo = (real - realizadoTotal(c.servico, add(ini, -1))) / Math.max(du, 1);
    const saldo = Math.max(c.qtd - real, 0);
    let projecao = null, status;
    if (saldo <= 0) status = 'CONCLUÍDO';
    else if (ritmo <= 0) status = c.inicio_plan && c.inicio_plan > ref ? 'NÃO INICIADO' : 'SEM RITMO';
    else {
      projecao = somarDiasUteis(ref, Math.ceil(saldo / ritmo));
      status = c.prazo && projecao > c.prazo ? 'ATRASO' : 'NO PRAZO';
    }
    const necessario = c.prazo && saldo > 0 && c.prazo > ref ? saldo / Math.max(1, contarDiasUteis(ref, c.prazo)) : null;
    return { ...c, real, ritmo, saldo, projecao, status, necessario };
  });
}
function contarDiasUteis(a, b) { let n = 0; for (let d = add(a, 1); d <= b; d = add(d, 1)) if (diaUtil(d)) n++; return n; }

function renderAvanco() {
  const st = { 'CONCLUÍDO': 'verde', 'NO PRAZO': 'verde', 'ATRASO': 'vermelho', 'SEM RITMO': 'amarelo', 'NÃO INICIADO': 'pendente' };
  const linhas = contratoLinhas();
  $('#tabContrato').innerHTML = `<thead><tr><th>Serviço</th><th>Frente</th><th class="n">Contrato</th><th class="n">Realizado</th><th style="min-width:120px">Avanço</th><th class="n">Saldo</th><th class="n">Ritmo/dia</th><th class="n">Necessário/dia</th><th>Prazo</th><th>Projeção</th><th>Situação</th></tr></thead><tbody>` +
    (linhas.length ? linhas.map(c => {
      const pct = c.real / c.qtd * 100;
      return `<tr><td><b>${esc(cap(c.servico))}</b></td><td class="nota">${esc(c.frente || '')}</td><td class="n">${nf(c.qtd)}</td><td class="n">${nf(c.real, 1)}</td>
        <td><div class="barra" title="${nf(pct, 1)}%"><i style="width:${Math.min(pct, 100)}%"></i></div><span class="nota">${nf(pct, 1)}%</span></td>
        <td class="n">${nf(c.saldo, 1)}</td><td class="n">${nf(c.ritmo, 2)}</td><td class="n" style="color:${c.necessario && c.ritmo < c.necessario ? 'var(--vermelho)' : 'inherit'}">${nf(c.necessario, 2)}</td>
        <td>${fdA(c.prazo)}</td><td>${fdA(c.projecao)}</td><td><span class="farol f-${st[c.status]}">${c.status}</span></td></tr>`;
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
    const r = await postar('/api/metas', { alteracoes });
    metasPend.clear();
    await carregar();
    toast(`Metas salvas na planilha (${r.celulas} célula(s))`);
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

  const nomes = new Set();
  M.empresas.forEach(e => e.servicos.forEach(s => nomes.add(s.nome)));
  M.impactos.forEach(i => i.servico && nomes.add(String(i.servico).toUpperCase()));
  $('#listaServicos').innerHTML = [...nomes].sort().map(n => `<option value="${esc(n)}">`).join('');
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
    await postar('/api/impacto', corpo);
    await carregar();
    toast(msg);
    return true;
  } catch (err) { toast(err.message, true); return false; }
}

// ------------------------------------------------------------ TENDÊNCIAS
function renderTendencia() {
  const ate = segunda(ref);
  const semanas = [...new Set(M.metas.map(m => m.inicio))].filter(s => s <= ate).sort();
  const emps = [...new Set(M.metas.map(m => m.empresa))];
  $('#legTend').innerHTML = emps.map(n => `<span><i style="--c:${corEmp(n)}"></i>${esc(n)}</span>`).join('');
  trocarGrafico('gAting', {
    type: 'line',
    data: {
      labels: semanas.map(fd),
      datasets: emps.map(n => ({
        label: n,
        data: semanas.map(s => {
          let prev = 0, real = 0;
          M.metas.filter(m => m.empresa === n && m.inicio === s).forEach(m => { const k = kpi(m, m.fim < ref ? m.fim : ref); if (k.semana > 0) { prev += k.prevAte; real += k.real; } });
          return prev > 0 ? Math.round(real / prev * 100) : null;
        }),
        borderColor: cor(COR_EMP[n] || '--acento'), backgroundColor: cor(COR_EMP[n] || '--acento'),
        borderWidth: 2, pointRadius: 4, pointHoverRadius: 6, tension: .25, spanGaps: true,
      })),
    },
    options: {
      responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${c.raw == null ? '—' : c.raw + '%'}` } } },
      scales: eixos({ ticks: { color: cor('--fg2'), callback: v => v + '%' } }),
    },
  });

  const sel = $('#selServ');
  const opcoes = [...new Set(M.metas.map(m => `${m.empresa}|${m.servico}`))];
  if (sel.options.length !== opcoes.length) sel.innerHTML = opcoes.map(o => `<option value="${esc(o)}">${esc(o.replace('|', ' · '))}</option>`).join('');
  const [empN, serv] = sel.value.split('|');
  const ms = M.metas.filter(m => m.empresa === empN && m.servico === serv && m.inicio <= ate).sort((a, b) => a.inicio.localeCompare(b.inicio));
  const c = cor(COR_EMP[empN] || '--acento');
  trocarGrafico('gServ', {
    data: {
      labels: ms.map(m => fd(m.inicio)),
      datasets: [
        { type: 'line', label: 'Meta ajustada', data: ms.map(m => m.meta_dia * m.du + m.gap), borderColor: cor('--fg2'), borderDash: [5, 4], borderWidth: 2, pointRadius: 0, stepped: 'middle' },
        { type: 'bar', label: 'Realizado', data: ms.map(m => kpi(m, m.fim).realSemana), backgroundColor: c, borderRadius: 4, maxBarThickness: 26 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { labels: { color: cor('--fg2'), boxWidth: 12 } } },
      scales: eixos(),
    },
  });
}

// ------------------------------------------------------------ eventos
function ligarEventos() {
  $('#abas').addEventListener('click', ev => { const b = ev.target.closest('button[data-aba]'); if (b) mudarAba(b.dataset.aba); });
  $('#refData').addEventListener('change', ev => definirRef(ev.target.value));
  $('#semAnt').onclick = () => definirRef(add(ref, -7));
  $('#semProx').onclick = () => definirRef(add(ref, 7));
  $('#btnHoje').onclick = () => definirRef(hoje());

  document.addEventListener('click', ev => {
    const lanc = ev.target.closest('[data-ir-lanc]');
    if (lanc) { empSel = lanc.dataset.irLanc; mudarAba('lanc'); }
    const ir = ev.target.closest('[data-ir-aba]');
    if (ir) mudarAba(ir.dataset.irAba);
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
    const todos = [...tab.querySelectorAll(`input[data-c="${inp.dataset.c}"]:not(:disabled)`)];
    const prox = todos[todos.indexOf(inp) + passo];
    if (prox) { prox.focus(); prox.select(); }
  });
  $('#btnSalvar').onclick = salvarLanc;
  $('#btnDescartar').onclick = () => { pend.clear(); atualizarPendentes(); renderLanc(); verificarVersao(); };
  document.addEventListener('keydown', ev => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 's') {
      ev.preventDefault();
      if (abaAtual === 'metas') salvarMetas(); else salvarLanc();
    }
  });
  window.addEventListener('beforeunload', ev => { if (pend.size || metasPend.size) { ev.preventDefault(); ev.returnValue = ''; } });

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
    const rs = ev.target.closest('[data-resolver]');
    if (rs) await salvarImpacto({ linha: +rs.dataset.resolver, solucionado: hoje() }, 'Impacto marcado como solucionado');
  });
  $('#formImp').addEventListener('submit', async ev => {
    ev.preventDefault();
    const f = ev.target, corpo = {};
    for (const k of ['data', 'servico', 'motivo', 'tempo', 'quando', 'paralisacao', 'solucionado']) corpo[k] = f.elements[k].value.trim() || null;
    if (corpo.servico) corpo.servico = corpo.servico.toUpperCase();
    if (f.dataset.linha) corpo.linha = +f.dataset.linha;
    if (await salvarImpacto(corpo, f.dataset.linha ? 'Impacto atualizado na planilha' : 'Impacto registrado na planilha')) f.hidden = true;
  });
  $('#btnExcluirImp').onclick = async ev => {
    const b = ev.currentTarget;
    if (!b.dataset.confirmar) { b.dataset.confirmar = '1'; b.textContent = 'Confirmar exclusão'; return; }
    if (await salvarImpacto({ linha: +$('#formImp').dataset.linha, excluir: true }, 'Impacto excluído')) $('#formImp').hidden = true;
  };

  $('#selServ').addEventListener('change', renderTendencia);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', renderAba);
}

// ------------------------------------------------------------ início
(async function iniciar() {
  ref = hoje();
  ligarEventos();
  let aba = 'painel';
  try { aba = localStorage.getItem('obra198_aba') || 'painel'; } catch { }
  $('#refData').value = ref;
  definirRef(ref);
  try { await carregar(); }
  catch (err) { $('#pontoSync').className = 'ponto erro'; $('#arquivoTxt').textContent = err.message; }
  mudarAba(document.getElementById('aba-' + aba) ? aba : 'painel');
  setInterval(verificarVersao, 4000);
})();
