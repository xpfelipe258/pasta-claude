'use strict';
// ------------------------------------------------------------------------------------------------
// CRONOGRAMA FÍSICO-FINANCEIRO (menu Financeiro)
// Quanto o avanço físico PREVISTO e o REALIZADO geram (ou vão gerar) em reais, atividade por atividade do catálogo do BM:
//   valor da atividade = valor do item do contrato RÓTULA × peso da atividade (o mesmo da Medição — bmPrecoAtividade);
//   previsto           = datas do cronograma do cliente (as do Gantt): avanço LINEAR por dia útil entre o início e o prazo da(s) linha(s)
//                        do cronograma ligadas à atividade (pjAtividadesBm) × valor da atividade;
//   realizado          = o que foi lançado/apontado até a data de referência (grade + apontamentos do BM, bmRealizado) ÷ quantidade × valor;
//   projetado          = realizado até a referência + o que o cronograma ainda prevê depois dela (o atraso acumulado não é recuperado), limitado ao valor.
// Módulos: GERAL (soma de todas as atividades dos catálogos das empresas) e um por empresa. Atividade do catálogo sem linha no cronograma
// entra no valor e no realizado, mas fica "sem cronograma" (nada previsto) — aparece destacada para ser ligada ao cronograma.
// Depende de app.js e projecao.js: M, ref, bmTab, bmItens, bmPrecoAtividade, bmQtdFinanceira, ganBmDatasAtividade, ganItensCliente,
// pjAtividadesBm, faseFiltro, segunda, add, diaUtil, contarDiasUteis, trocarGrafico, eixos, cor, rs, rs2, nf, fd, fdA, esc, cap, soma0.
// ------------------------------------------------------------------------------------------------
const CFF = { mod: '', vista: 'semana', ini: '', fim: '', dados: null };   // ini/fim = período desejado ('' = o cronograma inteiro)
const CFF_R = 'RÓTULA';

function cffDiasEixo(a, b) { const l = []; for (let d = a; d <= b; d = add(d, 1)) l.push(d); return l; }

// avanço linear por dia útil da linha do cronograma em cada dia do eixo (0 antes do início, 1 a partir do prazo)
function cffFracLinha(it, dias) {
  const tot = Math.max(1, contarDiasUteis(add(it.inicio_plan, -1), it.prazo));
  let n = 0;
  return dias.map(d => {
    if (d < it.inicio_plan) return 0;
    if (d >= it.prazo) return 1;
    if (diaUtil(d)) n++;
    return Math.min(1, n / tot);
  });
}

function cffCalc() {
  const base = ref;
  // linhas do cronograma do cliente (todas as fases, sem o filtro de fase da tela)
  let linhas = [];
  const fa = faseFiltro;
  faseFiltro = '';
  try { linhas = ganItensCliente().filter(it => it.inicio_plan && it.prazo && it.qtd); } finally { faseFiltro = fa; }
  // catálogo: valor de cada atividade (item × peso)
  const cat = bmTab('bm_atividades').filter(a => a.empresa && a.codigo);
  const empresasCat = [...new Set(cat.map(a => a.empresa))];
  const valor = new Map();   // 'EMP|CODIGO' → { total, itemDesc, item }
  empresasCat.forEach(emp => {
    bmItens(emp, base).forEach(bi => bi.ats.forEach(x => valor.set(emp + '|' + x.a.codigo, { total: bmPrecoAtividade(bi, x.a, CFF_R).total, itemDesc: bi.desc, item: bi.item })));
  });
  // ligação linha do cronograma → atividades do catálogo
  const ligadas = new Map();   // 'EMP|CODIGO' → [linhas]
  linhas.forEach(it => {
    const ats = pjAtividadesBm(it) || [];
    ats.forEach(a => { const k = a.empresa + '|' + a.codigo; if (!ligadas.has(k)) ligadas.set(k, []); ligadas.get(k).push(it); });
  });
  // eixo de dias: do primeiro início/lançamento até o último prazo (ou a referência)
  const reais = new Map();
  let dMin = null, dMax = base;
  linhas.forEach(it => { if (!dMin || it.inicio_plan < dMin) dMin = it.inicio_plan; if (it.prazo > dMax) dMax = it.prazo; });
  cat.forEach(a => {
    const ds = ganBmDatasAtividade(a, base).map(([d, v]) => [d, a.controle ? bmQtdFinanceira(a, v) : v]);
    reais.set(a.empresa + '|' + a.codigo, ds);
    ds.forEach(([d]) => { if (!dMin || d < dMin) dMin = d; });
  });
  if (!dMin) dMin = base;
  const ini = segunda(dMin), fim = add(segunda(dMax), 6);
  const dias = cffDiasEixo(ini, fim), n = dias.length, ib = Math.min(n - 1, Math.max(0, dias.indexOf(base)));
  const idx = new Map(dias.map((d, i) => [d, i]));
  const fracLinha = new Map(linhas.map(it => [it, cffFracLinha(it, dias)]));

  const atividades = cat.map(a => {
    const k = a.empresa + '|' + a.codigo, v = valor.get(k) || { total: 0, itemDesc: a.item_desc, item: a.item }, rows = ligadas.get(k) || [];
    // previsto: média das linhas do cronograma ligadas, ponderada pela quantidade da linha
    let pf = new Array(n).fill(0);
    if (rows.length) {
      const pesos = rows.map(it => (it.bm_percentual ? 1 : Number(it.qtd) || 1)), pt = soma0(pesos, x => x) || 1;
      rows.forEach((it, j) => { const f = fracLinha.get(it); for (let i = 0; i < n; i++) pf[i] += f[i] * pesos[j] / pt; });
    }
    // realizado: acumulado por dia (limitado a 100% da quantidade)
    const rf = new Array(n).fill(0), porDia = new Map();
    (reais.get(k) || []).forEach(([d, q]) => porDia.set(d, (porDia.get(d) || 0) + q));
    let ac = 0;
    for (let i = 0; i <= ib; i++) { ac += porDia.get(dias[i]) || 0; rf[i] = a.qtd > 0 ? Math.min(1, ac / a.qtd) : 0; }
    for (let i = ib + 1; i < n; i++) rf[i] = rf[ib];
    const V = v.total;
    const prev = pf.map(f => f * V), real = rf.map(f => f * V);
    const proj = real.map((r, i) => (i <= ib ? r : Math.min(V, real[ib] + Math.max(0, prev[i] - prev[ib]))));
    const iniRows = rows.length ? rows.map(it => it.inicio_plan).sort()[0] : null, fimRows = rows.length ? rows.map(it => it.prazo).sort().pop() : null;
    return { a, emp: a.empresa, item: v.item || a.item, itemDesc: v.itemDesc || a.item_desc, V, prev, real, proj, semCrono: !rows.length, iniCrono: iniRows, fimCrono: fimRows,
      linhasCrono: rows.map(it => it.servico + (it.frente ? ' (' + it.frente + ')' : '')), pctPrev: V ? prev[ib] / V : 0, pctReal: V ? real[ib] / V : 0 };
  });
  // módulos: GERAL + empresas
  const somar = lista => {
    const t = { V: 0, prev: new Array(n).fill(0), real: new Array(n).fill(0), proj: new Array(n).fill(0), semCronoV: 0, semCronoN: 0, n: lista.length };
    lista.forEach(x => {
      t.V += x.V;
      for (let i = 0; i < n; i++) { t.prev[i] += x.prev[i]; t.real[i] += x.real[i]; t.proj[i] += x.proj[i]; }
      if (x.semCrono) { t.semCronoV += x.V; t.semCronoN++; }
    });
    return t;
  };
  const ordem = M.empresas.map(e => e.nome).filter(nm => empresasCat.includes(nm)).concat(empresasCat.filter(nm => !M.empresas.some(e => e.nome === nm)));
  const modulos = { '': somar(atividades) };
  ordem.forEach(nm => { modulos[nm] = somar(atividades.filter(x => x.emp === nm)); });
  return { base, dias, idx, ib, atividades, modulos, empresas: ordem, linhas };
}

const cffChave = (d, vista) => (vista === 'mes' ? d.slice(0, 7) : segunda(d));
const cffRotuloPer = (k, vista) => {
  if (vista === 'mes') { const [a, m] = k.split('-'); return ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][+m - 1] + '/' + a.slice(2); }
  return fd(k);
};

// período desejado → índices do eixo (iI..iF). Sem datas, vale o cronograma inteiro.
function cffJanela(D) {
  const n = D.dias.length, primeiro = D.dias[0], ultimo = D.dias[n - 1];
  let iI = 0, iF = n - 1;
  if (ehISO(CFF.ini)) iI = CFF.ini <= primeiro ? 0 : CFF.ini > ultimo ? n - 1 : D.idx.get(CFF.ini);
  if (ehISO(CFF.fim)) iF = CFF.fim >= ultimo ? n - 1 : CFF.fim < primeiro ? 0 : D.idx.get(CFF.fim);
  if (iF < iI) iF = iI;
  return { iI, iF, ini: D.dias[iI], fim: D.dias[iF] };
}
// valor no período [iI, iF] de uma série acumulada (R$ acumulado − acumulado na véspera)
const cffNaJanela = (arr, J) => arr[J.iF] - (J.iI > 0 ? arr[J.iI - 1] : 0);

// períodos (semanas/meses) que cabem no período desejado: primeiro e último índice do eixo de cada um (cortados nas pontas do período)
function cffPeriodos(D, vista) {
  const J = cffJanela(D), mapa = new Map();
  for (let i = J.iI; i <= J.iF; i++) { const k = cffChave(D.dias[i], vista); const p = mapa.get(k); if (p) p.i1 = i; else mapa.set(k, { k, i0: i, i1: i }); }
  return [...mapa.values()];
}
const cffNoPer = (arr, p) => arr[p.i1] - (p.i0 > 0 ? arr[p.i0 - 1] : 0);

function cffTabelaAtividades(D, mod) {
  const lista = D.atividades.filter(x => (!mod || x.emp === mod) && (x.V > 0 || x.pctReal > 0)).sort((a, b) => a.emp.localeCompare(b.emp) || String(a.item).localeCompare(String(b.item), 'pt', { numeric: true }) || String(a.a.codigo).localeCompare(String(b.a.codigo), 'pt', { numeric: true }));
  const ib = D.ib, J = cffJanela(D), naJ = (x, arr) => (arr === x.real ? (J.iI > ib ? 0 : x.real[Math.min(J.iF, ib)] - (J.iI > 0 ? x.real[J.iI - 1] : 0)) : cffNaJanela(arr, J));
  let h = '<thead><tr><th>Atividade (catálogo do BM)</th><th>Cronograma</th><th class="n">Valor</th><th class="n">Previsto no período</th><th class="n">Realizado no período</th><th class="n">% previsto</th><th class="n">R$ previsto</th><th class="n">% realizado</th><th class="n">R$ realizado</th><th class="n">Desvio R$</th><th class="n">Saldo a medir</th><th class="n">Projeção no fim</th></tr></thead><tbody>';
  let empAtual = null, itemAtual = null;
  const totEmp = nm => { const l = lista.filter(x => x.emp === nm); return { V: soma0(l, x => x.V), pv: soma0(l, x => x.prev[ib]), rl: soma0(l, x => x.real[ib]), pj: soma0(l, x => x.proj[x.proj.length - 1]), pp: soma0(l, x => naJ(x, x.prev)), rp: soma0(l, x => naJ(x, x.real)) }; };
  lista.forEach(x => {
    if (!mod && x.emp !== empAtual) {
      empAtual = x.emp; itemAtual = null;
      const t = totEmp(x.emp);
      h += `<tr class="grupo"><td colspan="2"><b>${esc(x.emp)}</b></td><td class="n"><b>${rs(t.V)}</b></td><td class="n">${rs(t.pp)}</td><td class="n">${rs(t.rp)}</td><td class="n">${t.V ? nf(t.pv / t.V * 100, 1) : 0}%</td><td class="n">${rs(t.pv)}</td><td class="n">${t.V ? nf(t.rl / t.V * 100, 1) : 0}%</td><td class="n">${rs(t.rl)}</td><td class="n ${t.rl - t.pv < 0 ? 'valor-neg' : ''}">${rs(t.rl - t.pv)}</td><td class="n">${rs(Math.max(0, t.V - t.rl))}</td><td class="n">${rs(t.pj)}</td></tr>`;
    }
    if (x.item !== itemAtual) {
      itemAtual = x.item;
      h += `<tr class="grupo"><td colspan="12"><b>${esc(x.item)}</b> ${esc(cap(x.itemDesc || ''))}</td></tr>`;
    }
    const fimProj = x.proj[x.proj.length - 1], desv = x.real[ib] - x.prev[ib];
    h += `<tr><td>${esc(x.a.atividade)}<div class="nota">${esc(x.a.codigo)}</div></td>
      <td>${x.semCrono ? '<span class="farol f-amarelo" title="Esta atividade do catálogo não está ligada a nenhuma linha do cronograma do cliente: entra no valor e no realizado, mas não tem previsto.">SEM CRONOGRAMA</span>' : `${fd(x.iniCrono)} a ${fd(x.fimCrono)}<div class="nota">${esc(x.linhasCrono.slice(0, 2).join(' · '))}${x.linhasCrono.length > 2 ? ' …' : ''}</div>`}</td>
      <td class="n">${rs(x.V)}</td><td class="n">${rs(naJ(x, x.prev))}</td><td class="n">${rs(naJ(x, x.real))}</td><td class="n">${nf(x.pctPrev * 100, 1)}%</td><td class="n">${rs(x.prev[ib])}</td><td class="n">${nf(x.pctReal * 100, 1)}%</td><td class="n"><b>${rs(x.real[ib])}</b></td>
      <td class="n ${desv < -0.5 ? 'valor-neg' : ''}">${rs(desv)}</td><td class="n">${rs(Math.max(0, x.V - x.real[ib]))}</td><td class="n">${rs(fimProj)}</td></tr>`;
  });
  if (!lista.length) h += '<tr><td colspan="12" class="vazio">Nenhuma atividade com valor no catálogo.</td></tr>';
  return h + '</tbody>';
}

function cffMatriz(D, T, vista) {
  const per = cffPeriodos(D, vista), ib = D.ib;
  const pb = per.find(p => p.i0 <= ib && ib <= p.i1);
  const cls = p => (p.i1 <= ib ? 'pj-real' : p.i0 > ib ? 'pj-proj' : 'pj-misto');
  const V = T.V || 1;
  const linha = (rot, fn, estilo = '') => `<tr><td>${rot}</td>${per.map(p => `<td class="n ${cls(p)}">${fn(p)}</td>`).join('')}</tr>`;
  let h = `<thead><tr><th>${vista === 'mes' ? 'Mês' : 'Semana de'}</th>${per.map(p => `<th class="n ${cls(p)}">${cffRotuloPer(p.k, vista)}</th>`).join('')}</tr></thead><tbody>`;
  h += linha('<b>Previsto no período (R$)</b>', p => rs(cffNoPer(T.prev, p)));
  h += linha('<b>Realizado no período (R$)</b>', p => (p.i0 > ib ? '—' : rs(T.real[Math.min(p.i1, ib)] - (p.i0 > 0 ? T.real[p.i0 - 1] : 0))));
  h += linha('Projetado no período (R$)', p => (p.i1 < ib ? '—' : rs(cffNoPer(T.proj, p))));
  h += linha('Previsto acumulado (R$)', p => rs(T.prev[p.i1]));
  h += linha('Realizado acumulado (R$)', p => (p.i0 > ib ? '—' : rs(T.real[Math.min(p.i1, ib)])));
  h += linha('Projetado acumulado (R$)', p => (p.i1 < ib ? '—' : rs(T.proj[p.i1])));
  h += linha('% previsto acumulado', p => nf(T.prev[p.i1] / V * 100, 1) + '%');
  h += linha('% realizado acumulado', p => (p.i0 > ib ? '—' : nf(T.real[Math.min(p.i1, ib)] / V * 100, 1) + '%'));
  h += linha('% projetado acumulado', p => (p.i1 < ib ? '—' : nf(T.proj[p.i1] / V * 100, 1) + '%'));
  h += linha('<b>Desvio acumulado (R$)</b>', p => { if (p.i0 > ib) return '—'; const i = Math.min(p.i1, ib), d = T.real[i] - T.prev[i]; return `<span class="${d < -0.5 ? 'valor-neg' : ''}">${rs(d)}</span>`; });
  return { html: h + '</tbody>', per, pb };
}

function renderCff() {
  const box = document.getElementById('cffCorpo');
  if (!box) return;
  let D;
  try { D = CFF.dados = cffCalc(); } catch (e) { console.error(e); box.innerHTML = `<div class="bloco"><p class="aviso">Não foi possível montar o cronograma físico-financeiro: ${esc(e.message || e)}</p></div>`; return; }
  if (CFF.mod && !D.modulos[CFF.mod]) CFF.mod = '';
  const T = D.modulos[CFF.mod], ib = D.ib, base = D.base, V = T.V || 0;
  const prevHoje = T.prev[ib], realHoje = T.real[ib], fimProj = T.proj[T.proj.length - 1], desv = realHoje - prevHoje;
  const tile = (rot, val, sub, cc) => `<div class="tile" style="--c:${cc}"><div class="rot"><span>${rot}</span></div><div class="val">${val}</div><div class="sub">${sub}</div></div>`;
  const nome = CFF.mod || 'GERAL', J = cffJanela(D), pPrev = cffNaJanela(T.prev, J), pReal = J.iI > ib ? 0 : T.real[Math.min(J.iF, ib)] - (J.iI > 0 ? T.real[J.iI - 1] : 0), pProj = cffNaJanela(T.proj, J);
  const btns = ['', ...D.empresas].map(m => `<button data-cff-mod="${esc(m)}" class="${m === CFF.mod ? 'ativa' : ''}">${m ? esc(m) : 'Geral (todas)'}</button>`).join('');
  const m = cffMatriz(D, T, CFF.vista);
  let h = `<div class="bloco"><div class="bloco-cab"><h2>Cronograma físico-financeiro — ${esc(nome)}</h2><span class="nota">Valor = catálogo do BM (contrato ${CFF_R}) · previsto = datas do cronograma do cliente, linear por dia útil · realizado até ${fdA(base)}</span></div>
    <div class="barra-acoes"><div class="seg" id="cffMod">${btns}</div>
      <label class="rot-sel">Período de <input type="date" id="cffIni" value="${CFF.ini}"> até <input type="date" id="cffFim" value="${CFF.fim}"></label>
      <button class="btn" id="cffPerTudo" title="Volta ao cronograma inteiro">Todo o cronograma</button><button class="btn" id="cffPerMes">Mês da referência</button>
      <label class="rot-sel">Colunas <select id="cffVista"><option value="semana" ${CFF.vista === 'semana' ? 'selected' : ''}>Por semana</option><option value="mes" ${CFF.vista === 'mes' ? 'selected' : ''}>Por mês</option></select></label>
      <button class="btn primario" id="cffRel">Relatório (PDF)</button><button class="btn" id="cffCsv">Exportar CSV</button></div></div>`;
  h += '<div class="tiles">' +
    tile('Valor do módulo', rs(V), `${T.n} atividade(s) do catálogo${CFF.mod ? '' : ' de ' + D.empresas.length + ' empresa(s)'}`, 'var(--acento)') +
    tile('Previsto até hoje', rs(prevHoje), `${V ? nf(prevHoje / V * 100, 1) : 0}% do valor · cronograma do cliente`, 'var(--fg3)') +
    tile('Realizado até hoje', rs(realHoje), `${V ? nf(realHoje / V * 100, 1) : 0}% · desvio ${desv >= 0 ? '+' : '−'}${rs(Math.abs(desv))}`, desv < -0.05 * Math.max(prevHoje, 1) ? 'var(--vermelho)' : desv < 0 ? 'var(--amarelo)' : 'var(--verde)') +
    tile('Projeção no fim do cronograma', rs(fimProj), `${V ? nf(fimProj / V * 100, 0) : 0}% do valor · ${V - fimProj > 0.5 ? rs(V - fimProj) + ' não gerados no cronograma' : 'fecha no prazo'}`, V - fimProj > 0.5 ? 'var(--vermelho)' : 'var(--verde)') +
    tile('Saldo a medir', rs(Math.max(0, V - realHoje)), `${V ? nf(Math.max(0, V - realHoje) / V * 100, 1) : 0}% do valor ainda não realizado`, 'var(--acento)') + '</div>';
  h += `<div class="faixa faixa-info">Período informado: <b>${fdA(J.ini)}</b> a <b>${fdA(J.fim)}</b>${CFF.ini || CFF.fim ? '' : ' (todo o cronograma)'} — ${J.iF < ib ? 'período já realizado' : J.iI > ib ? 'período futuro (só previsto/projetado)' : 'inclui a data de referência ' + fdA(base)}.</div>`;
  h += '<div class="tiles">' +
    tile('Previsto no período', rs(pPrev), `${V ? nf(pPrev / V * 100, 1) : 0}% do valor do módulo`, 'var(--fg3)') +
    tile('Realizado no período', J.iI > ib ? '—' : rs(pReal), J.iI > ib ? 'o período ainda não começou' : `${V ? nf(pReal / V * 100, 1) : 0}% do valor · ${J.iF > ib ? 'até ' + fdA(base) : 'período fechado'}`, 'var(--verde)') +
    tile('Projetado no período', rs(pProj), `realizado + o que o cronograma ainda prevê${V ? ' · ' + nf(pProj / V * 100, 1) + '%' : ''}`, 'var(--amarelo)') +
    tile('Acumulado ao fim do período', rs(T.proj[J.iF]), `${V ? nf(T.proj[J.iF] / V * 100, 1) : 0}% do valor (previsto ${rs(T.prev[J.iF])})`, 'var(--acento)') + '</div>';
  if (T.semCronoN) h += `<div class="faixa">${T.semCronoN} atividade(s) do catálogo (${rs(T.semCronoV)}) <b>não estão ligadas ao cronograma do cliente</b>: entram no valor e no realizado, mas não têm previsto. Aparecem como “SEM CRONOGRAMA” na tabela abaixo.</div>`;
  h += `<div class="bloco"><div class="bloco-cab"><h2>Curva S financeira (R$ acumulado)</h2><span class="nota">Cinza tracejada = previsto · verde = realizado · amarela pontilhada = projeção (realizado + o que o cronograma ainda prevê)</span></div><div class="grafico" style="height:320px"><canvas id="gCff"></canvas></div></div>`;
  h += `<div class="bloco"><div class="bloco-cab"><h2>Cronograma físico-financeiro por ${CFF.vista === 'mes' ? 'mês' : 'semana'}</h2><span class="nota"><i class="pj-leg pj-real"></i>realizado <i class="pj-leg pj-proj"></i>projetado · a coluna que contém ${fdA(base)} mistura realizado e projeção</span></div>
    <div class="tabela-rolagem"><table class="pj-matriz" id="tabCffMatriz">${m.html}</table></div></div>`;
  h += `<div class="bloco"><div class="bloco-cab"><h2>Por atividade</h2><span class="nota">R$ previsto/realizado = % físico × valor da atividade (item × peso) na data ${fdA(base)}.</span></div><div class="tabela-rolagem"><table id="tabCffAtiv">${cffTabelaAtividades(D, CFF.mod)}</table></div></div>`;
  box.innerHTML = h;
  // curva S (um ponto por período)
  const per = m.per, rot = per.map(p => cffRotuloPer(p.k, CFF.vista));
  trocarGrafico('gCff', {
    type: 'line',
    data: { labels: rot, datasets: [
      { label: 'Previsto (acumulado)', data: per.map(p => Math.round(T.prev[p.i1])), borderColor: cor('--fg3'), borderDash: [6, 4], pointRadius: 0, tension: .2 },
      { label: 'Realizado (acumulado)', data: per.map(p => (p.i0 > ib ? null : Math.round(T.real[Math.min(p.i1, ib)]))), borderColor: cor('--verde'), backgroundColor: cor('--verde'), pointRadius: 2, tension: .2 },
      { label: 'Projetado (acumulado)', data: per.map(p => (p.i1 < ib ? null : Math.round(T.proj[p.i1]))), borderColor: cor('--amarelo'), borderDash: [2, 3], pointRadius: 0, tension: .2 },
    ] },
    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, scales: eixos({ ticks: { color: cor('--fg2'), callback: v => rs(v) } }), plugins: { tooltip: { callbacks: { label: c => `${c.dataset.label}: ${rs(c.parsed.y)}` } } } },
  });
}

// Relatório do cronograma físico-financeiro (visualização antes de baixar; baixa em PDF): módulo escolhido na tela
async function cffRelatorio() {
  const D = CFF.dados; if (!D) return;
  const btn = document.getElementById('cffRel'), rot = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Montando…'; }
  try {
    await tplLogosCarregar();
    const mod = CFF.mod, T = D.modulos[mod], ib = D.ib, V = T.V || 0, nome = mod || 'Geral (todas as empresas)';
    const prevHoje = T.prev[ib], realHoje = T.real[ib], fimProj = T.proj[T.proj.length - 1], desv = realHoje - prevHoje;
    const card = (r, v, sub, c) => `<div class="card ${c}"><div class="rot">${r}</div><div class="val">${v}</div><div class="sub">${sub}</div></div>`;
    const m = cffMatriz(D, T, CFF.vista);
    let img = '';
    try { img = graficos.gCff ? graficos.gCff.toBase64Image('image/png', 1) : ''; } catch (e) { img = ''; }
    const resumoEmp = mod ? '' : `<h2>Resumo por empresa</h2><table><thead><tr><th>Empresa</th><th class="n">Valor</th><th class="n">Previsto até hoje</th><th class="n">% previsto</th><th class="n">Realizado até hoje</th><th class="n">% realizado</th><th class="n">Desvio</th><th class="n">Projeção no fim</th><th class="n">Saldo a medir</th></tr></thead><tbody>${D.empresas.map(e => { const t = D.modulos[e], pv = t.prev[ib], rl = t.real[ib]; return `<tr><td><b>${esc(e)}</b></td><td class="n">${rs(t.V)}</td><td class="n">${rs(pv)}</td><td class="n">${t.V ? nf(pv / t.V * 100, 1) : 0}%</td><td class="n">${rs(rl)}</td><td class="n">${t.V ? nf(rl / t.V * 100, 1) : 0}%</td><td class="n ${rl - pv < -0.5 ? 'valor-neg' : ''}">${rs(rl - pv)}</td><td class="n">${rs(t.proj[t.proj.length - 1])}</td><td class="n">${rs(Math.max(0, t.V - rl))}</td></tr>`; }).join('')}</tbody><tfoot><tr><th>Total</th><th class="n">${rs(V)}</th><th class="n">${rs(prevHoje)}</th><th class="n">${V ? nf(prevHoje / V * 100, 1) : 0}%</th><th class="n">${rs(realHoje)}</th><th class="n">${V ? nf(realHoje / V * 100, 1) : 0}%</th><th class="n">${rs(desv)}</th><th class="n">${rs(fimProj)}</th><th class="n">${rs(Math.max(0, V - realHoje))}</th></tr></tfoot></table>`;
    const css = `<style>@page{size:A4 landscape}.pj-real{background:#e3f1e8}.pj-proj{background:#fbf0d9}.pj-misto{background:linear-gradient(90deg,#e3f1e8 50%,#fbf0d9 50%)}.cff-mat table{font-size:9px}.cff-mat th,.cff-mat td{padding:3px 4px;white-space:nowrap}.valor-neg{color:#b42318}.cff-curva{width:100%;max-height:330px;object-fit:contain}</style>`;
    const corpo = `<section class="emp-sec"><div class="pag">
      <div class="cards">${card('Valor do módulo', rs(V), `${T.n} atividade(s) do catálogo (contrato RÓTULA)`, 'az')}${card('Previsto até hoje', rs(prevHoje), `${V ? nf(prevHoje / V * 100, 1) : 0}% · cronograma do cliente`, 'nd')}${card('Realizado até hoje', rs(realHoje), `${V ? nf(realHoje / V * 100, 1) : 0}% · desvio ${desv >= 0 ? '+' : '−'}${rs(Math.abs(desv))}`, desv < -0.05 * Math.max(prevHoje, 1) ? 'vm' : desv < 0 ? 'am' : 'vd')}${card('Projeção no fim do cronograma', rs(fimProj), `${V ? nf(fimProj / V * 100, 0) : 0}% do valor${V - fimProj > 0.5 ? ' · ' + rs(V - fimProj) + ' ficam para depois' : ' · fecha no prazo'}`, V - fimProj > 0.5 ? 'vm' : 'vd')}${card('Saldo a medir', rs(Math.max(0, V - realHoje)), 'valor ainda não realizado', 'az')}</div>
      ${T.semCronoN ? `<p class="aviso">${T.semCronoN} atividade(s) do catálogo (${rs(T.semCronoV)}) não estão ligadas ao cronograma do cliente: entram no valor e no realizado, mas não têm previsto (“SEM CRONOGRAMA”).</p>` : ''}
      ${resumoEmp}
      ${img ? `<h2>Curva S financeira (R$ acumulado)</h2><p class="sub-cab">Cinza tracejada = previsto · verde = realizado · amarela pontilhada = projeção (realizado + o que o cronograma ainda prevê).</p><img class="cff-curva" src="${img}" alt="Curva S">` : ''}
      <h2>Cronograma físico-financeiro por ${CFF.vista === 'mes' ? 'mês' : 'semana'}</h2><p class="sub-cab">Colunas verdes = realizado · amarelas = projetado · a que contém ${fdA(D.base)} mistura os dois.</p>
      <div class="cff-mat"><table>${m.html}</table></div>
      <h2>Por atividade</h2><p class="sub-cab">R$ previsto/realizado = % físico × valor da atividade (valor do item × peso no catálogo do BM) em ${fdA(D.base)}.</p>
      <table>${cffTabelaAtividades(D, mod)}</table>
    </div></section>`;
    const html = tplDocumento({ titulo: 'Cronograma físico-financeiro', subtitulo: `${nome} — período de ${fdA(cffJanela(D).ini)} a ${fdA(cffJanela(D).fim)} · posição em ${fdA(D.base)}`, meta: 'Previsto = cronograma do cliente (linear por dia útil) · valor = catálogo do BM · realizado = lançamentos e apontamentos do BM', corpo, css });
    reAbrirPrevia(html, `cronograma-fisico-financeiro-${(mod || 'geral').replace(/\s+/g, '-')}-${D.base}`, `Cronograma físico-financeiro · ${nome}`);
  } catch (e) { console.error(e); toast('Não foi possível montar o relatório: ' + (e.message || e), true); }
  finally { if (btn) { btn.disabled = false; btn.textContent = rot; } }
}

function cffCsv() {
  const D = CFF.dados; if (!D) return;
  const T = D.modulos[CFF.mod], m = cffMatriz(D, T, CFF.vista), ib = D.ib;
  const per = m.per, num = v => String(Math.round(v * 100) / 100).replace('.', ',');
  const J = cffJanela(D), linhas = [['Módulo', CFF.mod || 'GERAL'], ['Período', J.ini + ' a ' + J.fim], ['Referência', D.base], [], ['Linha', ...per.map(p => cffRotuloPer(p.k, CFF.vista))]];
  const add2 = (rot, fn) => linhas.push([rot, ...per.map(fn)]);
  add2('Previsto no período', p => num(cffNoPer(T.prev, p)));
  add2('Realizado no período', p => (p.i0 > ib ? '' : num(T.real[Math.min(p.i1, ib)] - (p.i0 > 0 ? T.real[p.i0 - 1] : 0))));
  add2('Projetado no período', p => (p.i1 < ib ? '' : num(cffNoPer(T.proj, p))));
  add2('Previsto acumulado', p => num(T.prev[p.i1]));
  add2('Realizado acumulado', p => (p.i0 > ib ? '' : num(T.real[Math.min(p.i1, ib)])));
  add2('Projetado acumulado', p => (p.i1 < ib ? '' : num(T.proj[p.i1])));
  linhas.push([], ['Empresa', 'Item', 'Código', 'Atividade', 'Início cronograma', 'Fim cronograma', 'Valor', 'Previsto no período', 'Realizado no período', 'R$ previsto até a referência', 'R$ realizado até a referência', 'Projeção no fim']);
  D.atividades.filter(x => (!CFF.mod || x.emp === CFF.mod) && (x.V > 0 || x.pctReal > 0)).forEach(x =>
    linhas.push([x.emp, x.item, x.a.codigo, x.a.atividade, x.iniCrono || 'SEM CRONOGRAMA', x.fimCrono || '', num(x.V), num(cffNaJanela(x.prev, J)), num(J.iI > ib ? 0 : x.real[Math.min(J.iF, ib)] - (J.iI > 0 ? x.real[J.iI - 1] : 0)), num(x.prev[ib]), num(x.real[ib]), num(x.proj[x.proj.length - 1])]));
  const csv = '﻿' + linhas.map(l => l.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `cronograma-fisico-financeiro-${(CFF.mod || 'geral').replace(/\s+/g, '-')}-${D.base}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

document.addEventListener('click', ev => {
  const b = ev.target.closest && ev.target.closest('[data-cff-mod]');
  if (b) { CFF.mod = b.dataset.cffMod; return renderCff(); }
  if (ev.target.closest && ev.target.closest('#cffCsv')) return cffCsv();
  if (ev.target.closest && ev.target.closest('#cffRel')) return cffRelatorio();
});
document.addEventListener('change', ev => {
  const t = ev.target;
  if (!t) return;
  if (t.id === 'cffVista') { CFF.vista = t.value === 'mes' ? 'mes' : 'semana'; renderCff(); }
  else if (t.id === 'cffIni' || t.id === 'cffFim') {
    const ini = document.getElementById('cffIni').value, fim = document.getElementById('cffFim').value;
    if (ini && fim && fim < ini) { toast('A data final não pode ser anterior à data inicial.', true); return renderCff(); }
    CFF.ini = ini; CFF.fim = fim; renderCff();
  }
});
document.addEventListener('click', ev => {
  const t = ev.target && ev.target.closest ? ev.target : null;
  if (!t) return;
  if (t.closest('#cffPerTudo')) { CFF.ini = ''; CFF.fim = ''; renderCff(); }
  else if (t.closest('#cffPerMes')) {
    const r = ref, ini = r.slice(0, 8) + '01', prox = new Date(+r.slice(0, 4), +r.slice(5, 7), 1), fim = add(prox.getFullYear() + '-' + String(prox.getMonth() + 1).padStart(2, '0') + '-01', -1);
    CFF.ini = ini; CFF.fim = fim; renderCff();
  }
});
