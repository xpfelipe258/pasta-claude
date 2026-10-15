'use strict';
// ------------------------------------------------------------------------------------------------
// PROJEÇÃO FÍSICO-FINANCEIRA (menu Financeiro)
// Simula um cronograma físico-financeiro a partir do planejamento 5W2H do período + o que já foi executado:
//   planejado  = divisão por dia do plano (meta/dia de cada atividade) × preço da atividade;
//   executado  = o que foi lançado até a data de referência × preço;
//   projeção   = saldo de cada atividade no ritmo atual (ou na meta, sem lançamentos) × fator de produtividade escolhido × preço;
//   necessário = linha reta do executado de hoje até o valor total no fim do plano.
// Preço da atividade = valor da atividade no BM (valor do item × peso, catálogo de atividades) ÷ quantidade do item no cronograma;
// sem atividade no BM, vale o preço unitário digitado na tabela (guardado neste navegador).
// Depende de app.js e planos.js: M, T, ref, bmItens, bmPrecoAtividade, bmTab, ganBmAtividades, ganBmAtividadesEspecificas, clienteFonte,
// ECLUSA_VJ, proxDiaUtil, plCarregar, plCalc, plPlanosPainel-like (planos ativos), plDistribuirTaxa, plInteiro, trocarGrafico, eixos, cor, rs, rs2, nf, fd, fdA.
// ------------------------------------------------------------------------------------------------
const PJ = { plano: '', contrato: 'RÓTULA', prod: 100, vista: 'semana', manual: null, aberto: false };
const PJ_LS = 'obra198_proj_preco_manual';
function pjManual() {
  if (PJ.manual) return PJ.manual;
  try { PJ.manual = JSON.parse(localStorage.getItem(PJ_LS) || '{}') || {}; } catch { PJ.manual = {}; }
  return PJ.manual;
}
function pjSalvarManual() { try { localStorage.setItem(PJ_LS, JSON.stringify(pjManual())); } catch { /* sem armazenamento */ } }

// ---------------------------------------------------------------- preço da atividade
function pjAtividadesBm(it) {
  if (it._eclusa) { const d = ECLUSA_VJ.find(x => x[0] === it._eclusa); return d ? bmTab('bm_atividades').filter(a => d[2].includes(a.codigo)) : []; }
  const f = clienteFonte(it);
  if (f && f.atividades) return bmTab('bm_atividades').filter(a => f.atividades.includes(a.codigo));
  const esp = ganBmAtividadesEspecificas(it);
  return esp.length ? esp : ganBmAtividades(it);
}
function pjPreco(ativ, R, cache) {
  const it = ativ.it, ats = pjAtividadesBm(it);
  let total = 0;
  ats.forEach(a => {
    let its = cache.get(a.empresa);
    if (!its) { its = bmItens(a.empresa, ref); cache.set(a.empresa, its); }
    const bi = its.find(x => x.item === a.item), x = bi && bi.ats.find(y => y.a.codigo === a.codigo);
    if (bi && x) total += bmPrecoAtividade(bi, x.a, R).total;
  });
  const base = Number(it.qtd) || 0, bm = base > 0 && total > 0 ? total / base : 0, man = Number(pjManual()[ativ.chave]) || 0;
  return { unit: man > 0 ? man : bm, bm, manual: man > 0, origem: man > 0 ? 'manual' : bm > 0 ? 'BM' : 'sem', codigos: ats.map(a => a.codigo) };
}

// ---------------------------------------------------------------- cálculo
function pjDiasApos(base, n) { const l = []; let d = base; for (let k = 0; k < n; k++) { d = proxDiaUtil(d); l.push(d); } return l; }
function pjCalc(pl, c, fator, R) {
  const cache = new Map(), base = c.base;
  const itens = c.itens.map(x => {
    const ativ = x.ativ || { it: x.it, chave: x.it.chave };
    const pr = pjPreco(ativ, R, cache), qtd = Number(x.it.qtd) || 0;
    const falta = Math.max(0, qtd - x.realAc), taxa = (x.taxaProj > 0 ? x.taxaProj : 0) * fator;
    const proj = new Map();
    let termina = falta <= 1e-9 ? (x.concluiu || base) : null;
    if (falta > 1e-9 && taxa > 0) {
      const n = Math.min(400, Math.max(1, Math.ceil(falta / taxa - 1e-9))), dias = pjDiasApos(base, n);
      plDistribuirTaxa(falta, n, taxa, plInteiro(x.it.unidade)).forEach((v, i) => { if (v > 0) proj.set(dias[i], v); });
      termina = dias[dias.length - 1];
    }
    return { x, ativ, pr, p: pr.unit, qtd, plan: x.mapaPlan, real: x.real, proj, falta, termina, r0: x.r0 || 0, valor: pr.unit * qtd };
  });
  // eixo: dias úteis do plano + os da projeção
  const set = new Set(c.diasPlano);
  itens.forEach(i => { i.proj.forEach((v, d) => set.add(d)); });
  const eixo = [...set].sort();
  const fimPlano = c.diasPlano[c.diasPlano.length - 1];
  const val = (m, d, i) => (m.get(d) || 0) * i.p;
  // acumulados por dia
  const planAc = [], realAc = [], projAc = [];
  const acI = itens.map(i => ({ plan: i.r0, real: i.r0, proj: Math.min(i.qtd, i.x.realAc) }));
  const totalPlano = soma0(itens, i => i.valor);
  eixo.forEach(d => {
    let pl_ = 0, re_ = 0, pj_ = 0;
    itens.forEach((i, k) => {
      const a = acI[k];
      a.plan += i.plan.get(d) || 0;
      if (d <= base) a.real += i.real.get(d) || 0;
      if (d > base) a.proj += i.proj.get(d) || 0;
      pl_ += Math.min(a.plan, i.qtd) * i.p;
      re_ += Math.min(a.real, i.qtd) * i.p;
      pj_ += (d <= base ? Math.min(a.real, i.qtd) : Math.min(a.proj, i.qtd)) * i.p;
    });
    planAc.push(pl_); realAc.push(d <= base ? re_ : null); projAc.push(pj_);
  });
  const exec = soma0(itens, i => Math.min(i.x.realAc, i.qtd) * i.p);
  const iBase = eixo.filter(d => d <= base).length - 1;
  const v0 = iBase >= 0 ? realAc[iBase] : soma0(itens, i => i.r0 * i.p);
  const iFim = eixo.indexOf(fimPlano);
  const nec = eixo.map((d, k) => (k < iBase ? null : d >= fimPlano ? totalPlano : v0 + (totalPlano - v0) * (k - Math.max(iBase, 0)) / Math.max(1, iFim - Math.max(iBase, 0))));
  const termina = itens.map(i => i.termina).filter(Boolean).sort().pop() || null;
  const iBaseEixo = iBase;
  const aoFimPlano = iFim >= 0 ? projAc[iFim] ?? planAc[iFim] : null;
  const planoAteHoje = iBase >= 0 ? planAc[iBase] : soma0(itens, i => i.r0 * i.p);
  return { itens, eixo, base, iBase: iBaseEixo, fimPlano, planAc, realAc, projAc, nec, totalPlano, exec, planoAteHoje, aoFimPlano, termina, semValor: itens.filter(i => i.pr.origem === 'sem') };
}
const pjChavePeriodo = (d, vista) => (vista === 'mes' ? d.slice(0, 7) : segunda(d));
const pjRotPeriodo = (k, vista) => (vista === 'mes' ? k.slice(5) + '/' + k.slice(2, 4) : fd(k));

// ---------------------------------------------------------------- tela
function pjPlanosAtivos() { return (PL.dados?.planos || []).filter(p => p.status !== 'concluido' && p.inicio && p.fim && Array.isArray(p.itens) && p.itens.length); }
async function renderProjecao() {
  const box = document.getElementById('projCorpo');
  if (!box) return;
  const tk = PJ._tk = (PJ._tk || 0) + 1;
  if (!PL.dados || Date.now() - (PL._ts || 0) > 60000) { await plCarregar(true); PL._ts = Date.now(); if (tk !== PJ._tk) return; }
  PL._atv = null;
  const planos = pjPlanosAtivos();
  if (!planos.length) {
    box.innerHTML = '<div class="bloco"><div class="bloco-cab"><h2>Projeção físico-financeira</h2></div><p class="nota">Nenhum planejamento 5W2H ativo. A projeção parte do plano: crie em Planejamento → Sugestão do cronograma → “Criar planejamento”.</p><button class="btn primario" data-ir-aba="plan">Abrir Planejamento</button></div>';
    return;
  }
  if (PJ.plano && !planos.some(p => p.id === PJ.plano)) PJ.plano = '';
  const sel = PJ.plano ? planos.filter(p => p.id === PJ.plano) : planos;
  const pl = plPlanoCombinado(sel, '');
  if (!pl) { box.innerHTML = '<p class="nota">O plano escolhido não tem atividades.</p>'; return; }
  const c = plCalc(pl), R = PJ.contrato, fator = PJ.prod / 100;
  const r = pjCalc(pl, c, fator, R);
  const sim = fator !== 1;

  const optPl = `<option value="">Todos os planos ativos (${planos.length})</option>` + planos.map(p => `<option value="${esc(p.id)}" ${p.id === PJ.plano ? 'selected' : ''}>${esc(p.nome)} · ${fd(p.inicio)} a ${fd(p.fim)}</option>`).join('');
  const tile = (rot, val, sub, cc) => `<div class="tile" style="--c:${cc}"><div class="rot"><span>${rot}</span></div><div class="val">${val}</div><div class="sub">${sub}</div></div>`;
  const desv = r.exec - r.planoAteHoje, pctFis = r.totalPlano ? r.exec / r.totalPlano * 100 : 0, pctPrev = r.totalPlano ? r.planoAteHoje / r.totalPlano * 100 : 0;
  const aoFim = r.aoFimPlano ?? 0, foraPrazo = Math.max(0, r.totalPlano - aoFim);
  let h = `<div class="bloco"><div class="bloco-cab"><h2>Projeção físico-financeira</h2><span class="nota">Simulação a partir do planejamento 5W2H + o que já foi executado (até ${fdA(c.baseRef)}).</span></div>
    <div class="barra-acoes">
      <label class="rot-sel">Plano <select id="pjPlano">${optPl}</select></label>
      <label class="rot-sel">Contrato do BM <select id="pjContrato"><option ${R === 'RÓTULA' ? 'selected' : ''}>RÓTULA</option><option ${R === 'QPC' ? 'selected' : ''}>QPC</option></select></label>
      <label class="rot-sel">Produtividade daqui para frente <input type="range" id="pjProd" min="40" max="200" step="5" value="${PJ.prod}" style="vertical-align:middle"> <b id="pjProdTxt">${PJ.prod}%</b> <span class="nota">do ritmo atual</span></label>
      <label class="rot-sel">Colunas <select id="pjVista"><option value="semana" ${PJ.vista === 'semana' ? 'selected' : ''}>Por semana</option><option value="mes" ${PJ.vista === 'mes' ? 'selected' : ''}>Por mês</option></select></label>
      <button class="btn" id="pjCsv">Exportar CSV</button>
    </div></div>`;
  h += '<div class="tiles">' +
    tile('Valor do plano', rs(r.totalPlano), `${r.itens.length} atividade(s) · contrato ${esc(R)}`, 'var(--acento)') +
    tile('Planejado até hoje', rs(r.planoAteHoje), `${nf(pctPrev, 1)}% do valor do plano`, 'var(--fg3)') +
    tile('Executado até hoje', rs(r.exec), `${nf(pctFis, 1)}% · desvio ${desv >= 0 ? '+' : '−'}${rs(Math.abs(desv))}`, desv < -0.05 * Math.max(r.planoAteHoje, 1) ? 'var(--vermelho)' : desv < 0 ? 'var(--amarelo)' : 'var(--verde)') +
    tile(`Projeção no fim do plano${sim ? ' (simulada)' : ''}`, rs(aoFim), `${r.totalPlano ? nf(aoFim / r.totalPlano * 100, 0) : 0}% do plano${foraPrazo > 0.5 ? ' · ' + rs(foraPrazo) + ' ficam para depois' : ' · fecha no prazo'}`, foraPrazo > 0.5 ? 'var(--vermelho)' : 'var(--verde)') +
    tile('Término projetado', r.termina ? fdA(r.termina) : '—', r.termina && r.termina > r.fimPlano ? `${contarDiasUteis(r.fimPlano, r.termina)} dias úteis depois do fim do plano (${fdA(r.fimPlano)})` : `plano termina em ${fdA(r.fimPlano)}`, r.termina && r.termina > r.fimPlano ? 'var(--amarelo)' : 'var(--verde)') + '</div>';
  if (r.semValor.length) h += `<div class="faixa">${r.semValor.length} atividade(s) sem valor no BM (R$ 0): ${r.semValor.map(i => esc(i.x.it.atividade)).join(', ')}. Digite o preço unitário na coluna “Preço unit.” para entrarem na projeção.</div>`;
  h += `<div class="bloco"><div class="bloco-cab"><h2>Curva S financeira (R$ acumulado)</h2><div class="legenda"><span class="nota">Linha cheia = executado · tracejada = planejado · pontilhada = projeção${sim ? ' (' + PJ.prod + '% do ritmo atual)' : ' no ritmo atual'} · cinza = necessário para fechar no prazo</span></div></div><div class="grafico pl-grafico"><canvas id="gProjecao"></canvas></div></div>`;

  // tabela por atividade
  h += `<div class="bloco"><div class="bloco-cab"><h2>Por atividade</h2><span class="nota">Preço unit. = valor da atividade no BM ÷ quantidade do item no cronograma. Edite para simular outro preço.</span></div><div class="tabela-rolagem"><table class="pl-tab pj-tab" id="tabProjAtiv"><thead><tr><th>Atividade</th><th>Quem</th><th class="n">Qtd do plano</th><th class="n">Preço unit. (R$)</th><th class="n">Valor do plano</th><th class="n">Planejado até hoje</th><th class="n">Executado</th><th class="n">% físico</th><th class="n">Projeção no fim do plano</th><th class="n">Termina em</th><th class="n">Saldo a faturar</th><th>Situação</th></tr></thead><tbody>`;
  r.itens.forEach(i => {
    const x = i.x, un = x.it.unidade;
    const planoHoje = Math.min(x.planAc, i.qtd) * i.p, exec = Math.min(x.realAc, i.qtd) * i.p;
    let ac = Math.min(i.qtd, x.realAc);
    i.proj.forEach((v, d) => { if (d <= r.fimPlano) ac += v; });
    const noFim = Math.min(ac, i.qtd) * i.p, saldo = Math.max(0, i.qtd - x.realAc) * i.p;
    const sit = i.termina && i.termina > x.it.fim ? 'ATRASADO' : x.status;
    h += `<tr><td><b>${esc(x.it.atividade)}</b><div class="nota">${fd(x.it.inicio)} a ${fd(x.it.fim)}${x.it._planoNome ? ' · ' + esc(x.it._planoNome) : ''}</div></td><td>${esc((x.ativ?.empresas || []).join(' / ') || x.it.empresa || '—')}</td>
      <td class="n">${plFmt(x.it.qtd, un)} ${esc(un)}</td>
      <td class="n"><input type="text" inputmode="decimal" class="pj-preco ${i.pr.origem === 'sem' ? 'pj-sem' : ''}" data-pj-chave="${esc(i.ativ.chave)}" data-pj-bm="${i.pr.bm || ''}" value="${i.p ? nf(i.p, 2) : ''}" placeholder="R$/${esc(un)}" title="${i.pr.manual ? 'Preço digitado (BM: ' + (i.pr.bm ? rs2(i.pr.bm) : 'sem valor') + ')' : i.pr.bm ? 'Preço do BM: ' + esc(i.pr.codigos.join(', ')) : 'Sem atividade no BM: digite o preço unitário'}">${i.pr.manual ? ' <button type="button" class="link" data-pj-reset="' + esc(i.ativ.chave) + '" title="Voltar ao preço do BM">↺</button>' : ''}</td>
      <td class="n">${rs(i.valor)}</td><td class="n">${rs(planoHoje)}</td><td class="n"><b>${rs(exec)}</b></td><td class="n">${nf(i.qtd ? Math.min(1, x.realAc / i.qtd) * 100 : 0, 0)}%</td>
      <td class="n">${rs(noFim)}</td><td class="n ${i.termina && i.termina > x.it.fim ? 'valor-neg' : ''}">${i.termina ? fdA(i.termina) : '—'}</td><td class="n">${rs(saldo)}</td><td>${plFarol(sit)}</td></tr>`;
  });
  h += `</tbody><tfoot><tr><th colspan="4">Total</th><th class="n">${rs(r.totalPlano)}</th><th class="n">${rs(r.planoAteHoje)}</th><th class="n">${rs(r.exec)}</th><th class="n">${nf(pctFis, 0)}%</th><th class="n">${rs(aoFim)}</th><th class="n">${r.termina ? fdA(r.termina) : '—'}</th><th class="n">${rs(soma0(r.itens, i => Math.max(0, i.qtd - i.x.realAc) * i.p))}</th><th></th></tr></tfoot></table></div></div>`;

  // cronograma físico-financeiro
  const per = [...new Set(r.eixo.map(d => pjChavePeriodo(d, PJ.vista)))].sort();
  const fimPer = k => (PJ.vista === 'mes' ? k + '-31' : add(k, 6));
  const cel = (i, k) => {
    let ex = 0, pj = 0, pla = 0;
    r.eixo.forEach(d => { if (pjChavePeriodo(d, PJ.vista) !== k) return; pla += (i.plan.get(d) || 0) * i.p; if (d <= r.base) ex += (i.real.get(d) || 0) * i.p; else pj += (i.proj.get(d) || 0) * i.p; });
    return { ex, pj, pla };
  };
  const matriz = r.itens.map(i => per.map(k => cel(i, k)));
  const totPer = per.map((k, j) => ({ ex: soma0(matriz, m => m[j].ex), pj: soma0(matriz, m => m[j].pj), pla: soma0(matriz, m => m[j].pla) }));
  let acP = 0, acE = 0;
  const acum = totPer.map(t => { acP += t.pla; acE += t.ex + t.pj; return { p: acP, e: acE }; });
  const cls = (k, t) => (fimPer(k) <= r.base ? 'pj-real' : (k <= r.base ? 'pj-misto' : 'pj-proj'));
  h += `<div class="bloco"><div class="bloco-cab"><h2>Cronograma físico-financeiro</h2><span class="nota"><i class="pj-leg pj-real"></i>executado <i class="pj-leg pj-proj"></i>projetado · valor de cada atividade em cada ${PJ.vista === 'mes' ? 'mês' : 'semana (início na segunda)'}</span></div>
    <div class="tabela-rolagem tabela-larga"><table class="pj-tab pj-matriz" id="tabProjMatriz" data-sem-ferramentas><thead><tr><th>Atividade</th><th class="n">Valor do plano</th>${per.map(k => `<th class="n ${cls(k)}">${pjRotPeriodo(k, PJ.vista)}</th>`).join('')}<th class="n">Total</th></tr></thead><tbody>`;
  r.itens.forEach((i, ix) => {
    const tot = soma0(matriz[ix], m => m.ex + m.pj);
    h += `<tr><td><b>${esc(i.x.it.atividade)}</b></td><td class="n">${rs(i.valor)}</td>${matriz[ix].map((m, j) => { const v = m.ex + m.pj; return `<td class="n ${cls(per[j])}" title="planejado ${rs(m.pla)}">${v > 0.5 ? rs(v) : ''}</td>`; }).join('')}<td class="n"><b>${rs(tot)}</b></td></tr>`;
  });
  h += `</tbody><tfoot>
    <tr><th>Planejado no período</th><th class="n">${rs(r.totalPlano)}</th>${totPer.map(t => `<th class="n">${t.pla > 0.5 ? rs(t.pla) : ''}</th>`).join('')}<th class="n">${rs(soma0(totPer, t => t.pla))}</th></tr>
    <tr><th>Executado + projetado no período</th><th></th>${totPer.map((t, j) => `<th class="n ${cls(per[j])}">${t.ex + t.pj > 0.5 ? rs(t.ex + t.pj) : ''}</th>`).join('')}<th class="n">${rs(soma0(totPer, t => t.ex + t.pj))}</th></tr>
    <tr><th>Acumulado planejado</th><th></th>${acum.map(a => `<th class="n">${rs(a.p)}</th>`).join('')}<th></th></tr>
    <tr><th>Acumulado executado + projetado</th><th></th>${acum.map((a, j) => `<th class="n ${cls(per[j])}">${rs(a.e)}</th>`).join('')}<th></th></tr>
    <tr><th>% físico-financeiro acumulado</th><th></th>${acum.map((a, j) => `<th class="n ${cls(per[j])}">${r.totalPlano ? nf(Math.min(100, a.e / r.totalPlano * 100), 0) + '%' : ''}</th>`).join('')}<th></th></tr>
    <tr><th>Desvio acumulado (projetado − planejado)</th><th></th>${acum.map(a => `<th class="n ${a.e - a.p < -0.5 ? 'valor-neg' : ''}">${(a.e - a.p >= 0 ? '+' : '−') + rs(Math.abs(a.e - a.p))}</th>`).join('')}<th></th></tr>
  </tfoot></table></div>
    <p class="nota">Executado = lançado até ${fdA(c.baseRef)}. Projetado = saldo de cada atividade distribuído por dia útil no ritmo atual (média dos últimos 5 dias úteis; sem lançamentos, na meta) × ${PJ.prod}%. Valores do BM em ${esc(R)}; é uma simulação, não substitui a medição.</p></div>`;
  box.innerHTML = h;
  PJ._csv = { per, r, matriz, totPer, acum };

  // gráfico
  const lab = r.eixo.map(fd), n0 = v => (v == null ? null : Math.round(v));
  trocarGrafico('gProjecao', {
    type: 'line',
    data: { labels: lab, datasets: [
      { label: 'Planejado', data: r.planAc.map(n0), borderColor: cor('--acento'), backgroundColor: cor('--acento'), borderDash: [6, 4], borderWidth: 2, pointRadius: 0, tension: .2 },
      { label: 'Executado', data: r.realAc.map(n0), borderColor: cor('--verde'), backgroundColor: cor('--verde'), borderWidth: 3, pointRadius: 2, tension: .2 },
      { label: sim ? `Projeção (${PJ.prod}% do ritmo)` : 'Projeção (ritmo atual)', data: r.projAc.map((v, k) => (k >= Math.max(r.iBase, 0) ? n0(v) : null)), borderColor: cor('--amarelo'), backgroundColor: cor('--amarelo'), borderDash: [2, 3], borderWidth: 2.5, pointRadius: 0, tension: .2 },
      { label: 'Necessário para fechar no prazo', data: r.nec.map(n0), borderColor: cor('--fg3'), backgroundColor: cor('--fg3'), borderDash: [1, 4], borderWidth: 1.5, pointRadius: 0, tension: 0 },
    ] },
    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: true, labels: { color: cor('--fg2'), usePointStyle: true, boxWidth: 8 } }, tooltip: { callbacks: { label: x => `${x.dataset.label}: ${x.raw == null ? '—' : rs(x.raw)}` } } },
      scales: eixos({ max: Math.max(r.totalPlano, 1) * 1.04, ticks: { color: cor('--fg2'), callback: v => rs(v) } }, { ticks: { color: cor('--fg2'), maxTicksLimit: 14 } }) },
  });
}

function pjCsv() {
  const d = PJ._csv; if (!d) return;
  const { per, r, matriz } = d, q = v => '"' + String(v).replace(/"/g, '""') + '"', num = v => String(Math.round(v * 100) / 100).replace('.', ',');
  const linhas = [['Atividade', 'Preço unit. (R$)', 'Valor do plano (R$)', ...per.map(k => pjRotPeriodo(k, PJ.vista)), 'Total (R$)'].map(q).join(';')];
  r.itens.forEach((i, ix) => linhas.push([q(i.x.it.atividade), num(i.p), num(i.valor), ...matriz[ix].map(m => num(m.ex + m.pj)), num(soma0(matriz[ix], m => m.ex + m.pj))].join(';')));
  linhas.push([q('Planejado no período'), '', num(r.totalPlano), ...d.totPer.map(t => num(t.pla)), num(soma0(d.totPer, t => t.pla))].join(';'));
  linhas.push([q('Executado + projetado no período'), '', '', ...d.totPer.map(t => num(t.ex + t.pj)), num(soma0(d.totPer, t => t.ex + t.pj))].join(';'));
  const blob = new Blob(['﻿' + linhas.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = `projecao_fisico_financeira_${hoje()}.csv`; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

// ---------------------------------------------------------------- eventos
document.addEventListener('change', ev => {
  const t = ev.target;
  if (t.id === 'pjPlano') { PJ.plano = t.value; renderProjecao(); }
  else if (t.id === 'pjContrato') { PJ.contrato = t.value; renderProjecao(); }
  else if (t.id === 'pjVista') { PJ.vista = t.value; renderProjecao(); }
  else if (t.id === 'pjProd') { PJ.prod = +t.value; renderProjecao(); }
  else if (t.classList && t.classList.contains('pj-preco')) {
    const chave = t.dataset.pjChave, bm = Number(t.dataset.pjBm) || 0, txt = t.value.trim(), v = txt === '' ? 0 : edNum(txt);
    const m = pjManual();
    if (!(v > 0) || (bm && Math.abs(v - bm) < 0.005)) delete m[chave]; else m[chave] = v;
    pjSalvarManual(); renderProjecao();
  }
});
document.addEventListener('input', ev => { if (ev.target.id === 'pjProd') { const s = document.getElementById('pjProdTxt'); if (s) s.textContent = ev.target.value + '%'; } });
document.addEventListener('click', ev => {
  const reset = ev.target.closest && ev.target.closest('[data-pj-reset]');
  if (reset) { delete pjManual()[reset.dataset.pjReset]; pjSalvarManual(); renderProjecao(); return; }
  if (ev.target.id === 'pjCsv') pjCsv();
});
