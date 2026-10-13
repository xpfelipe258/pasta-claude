'use strict';
// ------------------------------------------------------------------------------------------------
// PLANEJAMENTO 5W2H (aba Planejamento)
// Fluxo: Novo planejamento > período da execução > atividades (todas as do cronograma) > 5W2H de cada uma > painel.
// O plano guarda só o que foi planejado (período, atividades, 5W2H, quantidade e datas). O realizado, a curva S,
// o que falta e a divisão por dia são calculados aqui, ao abrir a tela, a partir da produção lançada.
// Depende de app.js: M, T, ref, ganLinhas, ganDataKey, ehFrenteAnexa, servicosDaFrente, ganBmPercentual,
// ganBmAtividadesEspecificas, diaUtil, add, contarDiasUteis, trocarGrafico, eixos, cor, nf, fd, fdA, esc, cap, toast, postar.
// ------------------------------------------------------------------------------------------------
const PL = { dados: null, carregando: false, sub: 'planos', sel: null, vista: 'resumo', atv: '', dia: 'original', wiz: null, _atv: null };
const PL_ABAS = [['resumo', 'Resumo'], ['dia', 'Dia a dia'], ['gantt', 'Gantt'], ['linha', 'Linha do tempo'], ['w5', '5W2H']];
const PL_COR_STATUS = { 'CONCLUÍDO': 'verde', 'NO PRAZO': 'verde', 'ADIANTADO': 'verde', 'NO LIMITE': 'amarelo', 'ATRASADO': 'vermelho', 'A INICIAR': 'pendente' };
const PL_HEX = { verde: '--verde', amarelo: '--amarelo', vermelho: '--vermelho', pendente: '--fg3' };

// ---------------------------------------------------------------- utilidades de datas e quantidades
const plBase = () => (typeof ref === 'string' && ref) || hoje();
function plDias(ini, fim) {              // dias úteis de ini a fim (inclusive); se não houver, o próprio dia inicial
  const l = [];
  for (let d = ini; d <= fim; d = add(d, 1)) if (diaUtil(d)) l.push(d);
  return l.length ? l : [ini];
}
function plDistribuir(qtd, n, inteiro) { // divide qtd em n dias; em unidades inteiras usa arredondamento acumulado
  const r = [];
  let acum = 0;
  for (let i = 1; i <= n; i++) {
    const alvo = qtd * i / n, v = inteiro ? Math.round(alvo) - Math.round(acum) : alvo - acum;
    r.push(v);
    acum += v;
  }
  return r;
}
const plInteiro = un => ['un', 'und', 'pç', 'pc'].includes(String(un || '').toLowerCase());
const plFmt = (v, un) => nf(v, plInteiro(un) ? 0 : 1);
const plDiaSemana = d => DIAS[dow(d)].slice(0, 1);
function plSegunda(d) { return add(d, -dow(d)); }

// ---------------------------------------------------------------- atividades (todas as do cronograma)
function plUnidade(it) {
  if (it.bm_percentual || it.fonte_pct) return '%';
  const s = ganNorm(it.servico);
  if (typeof servicoUsaCatalogoM2 === 'function' && servicoUsaCatalogoM2(it.servico)) return 'm²';
  if (/RUFO|CALHA|LINHA DE VIDA/.test(s)) return 'm';
  return 'un';
}
function plEmpresasDe(it) {
  const nomes = [];
  M.empresas.forEach(e => {
    const ok = ehFrenteAnexa(it.frente) ? servicosDaFrente(e, it).length > 0 : e.servicos.some(s => servicoCompat(s.nome, it.servico));
    if (ok) nomes.push(e.nome);
  });
  return nomes;
}
// Todas as atividades do cronograma (Gantt), de todas as frentes e fases, ignorando o filtro de fase do topo.
function plAtividades(forcar) {
  if (PL._atv && !forcar) return PL._atv;
  const f = faseFiltro;
  faseFiltro = '';
  let ls = [];
  try { ls = ganLinhas(corte()); } finally { faseFiltro = f; }
  PL._atv = ls.map(l => {
    const it = l.it;
    return { chave: ganDataKey(it), nome: cap(it.servico_exib || it.servico), frente: it.frente || 'SEM FRENTE', fase: ganFaseNumero(it),
      unidade: plUnidade(it), qtd: Number(it.qtd) || 0, ini: l.ini || null, prazo: l.prazo || l.fimPrev || null, status: l.status,
      realAc: l.realAc || 0, prevAc: l.prevAc || 0, empresas: plEmpresasDe(it), it, linha: l };
  }).sort((a, b) => a.frente.localeCompare(b.frente) || (a.ini || '').localeCompare(b.ini || '') || a.nome.localeCompare(b.nome));
  return PL._atv;
}
const plAtivPorChave = chave => plAtividades().find(a => a.chave === chave);

// Realizado por dia da atividade: vem do que foi lançado. Frentes anexas (Eclusa, Portaria...) usam só as colunas da própria
// frente e, na Eclusa, o avanço do BM; as demais usam a série do Gantt (produção, BM e apontamentos, a fonte maior).
function plSerieReal(a) {
  const it = a.it;
  if (it.bm_percentual) return a.linha.dsReal || [];   // linha em % (Eclusa etc.): só o avanço do BM, nunca unidades da grade
  if (ehFrenteAnexa(it.frente)) {
    const grade = [];
    M.empresas.forEach(e => servicosDaFrente(e, it).forEach(s => Object.keys(e.registros).forEach(d => {
      const v = e.registros[d].v[s.col];
      if (typeof v === 'number' && v > 0) grade.push([d, v]);
    })));
    let bm = [];
    if (ganBmAtividadesEspecificas(it).length) {
      const r = ganBmPercentual(it, '9999-12-31');
      if (r) bm = r.ds.map(([d, v]) => [d, it.bm_percentual ? v : v / 100 * (Number(it.qtd) || 0)]);
    }
    return (soma0(bm, ([, v]) => v) > soma0(grade, ([, v]) => v) ? bm : grade).sort((x, y) => x[0].localeCompare(y[0]));
  }
  return a.linha.dsReal || [];
}

// ---------------------------------------------------------------- cálculo do plano
function plCalcItem(pl, it, base) {
  const dias = plDias(it.inicio, it.fim), inteiro = plInteiro(it.unidade);
  const plan = plDistribuir(it.qtd, dias.length, inteiro);
  const mapaPlan = new Map(dias.map((d, i) => [d, plan[i]]));
  const ativ = plAtivPorChave(it.chave);
  const real = new Map();
  (ativ ? plSerieReal(ativ) : []).forEach(([d, v]) => {
    if (d >= pl.inicio && d <= pl.fim && d <= base) real.set(d, (real.get(d) || 0) + v);
  });
  const realAc = soma0([...real.values()], v => v);
  let planAc = 0;
  mapaPlan.forEach((v, d) => { if (d <= base) planAc += v; });
  const falta = Math.max(0, it.qtd - realAc);
  const diasRest = base < it.fim ? contarDiasUteis(maxD(base, add(it.inicio, -1)), it.fim) : 0;
  const ultimos = [];
  for (let d = base, n = 0; n < 5 && d >= pl.inicio; d = add(d, -1)) if (diaUtil(d)) { ultimos.push(d); n++; }
  const ritmoAtual = ultimos.length ? soma0(ultimos, d => real.get(d) || 0) / ultimos.length : 0;
  const ritmoNec = diasRest > 0 ? falta / diasRest : null;
  const ratio = planAc > 0 ? realAc / planAc : null;
  let status;
  if (realAc >= it.qtd - 1e-9) status = 'CONCLUÍDO';
  else if (base < it.inicio && realAc <= 0) status = 'A INICIAR';
  else if (ratio === null) status = realAc > 0 ? 'ADIANTADO' : 'A INICIAR';
  else status = ratio >= 1.05 ? 'ADIANTADO' : ratio >= 1 ? 'NO PRAZO' : ratio >= .95 ? 'NO LIMITE' : 'ATRASADO';
  if (status === 'NO PRAZO' && base > it.fim && falta > 0) status = 'ATRASADO';
  const datasReais = [...real.keys()].sort();
  let acum = 0, concluiu = null;
  datasReais.forEach(d => { acum += real.get(d); if (!concluiu && acum >= it.qtd - 1e-9) concluiu = d; });
  // saldo redistribuído nos dias úteis que restam
  const futuros = plDias(add(base, 1), maxD(it.fim, add(base, 1))).filter(d => d > base && d <= it.fim);
  const redistrib = new Map();
  if (falta > 0 && futuros.length) plDistribuir(falta, futuros.length, inteiro).forEach((v, i) => redistrib.set(futuros[i], v));
  return { it, ativ, dias, mapaPlan, real, realAc, planAc, falta, diasRest, ritmoAtual, ritmoNec, status,
    pctPlan: it.qtd ? Math.min(1, planAc / it.qtd) : 0, pctReal: it.qtd ? Math.min(1, realAc / it.qtd) : 0,
    primeiro: datasReais[0] || null, ultimo: datasReais[datasReais.length - 1] || null, concluiu, redistrib };
}
function plCalc(pl) {
  const baseRef = plBase();
  const base = baseRef < pl.inicio ? add(pl.inicio, -1) : minD(baseRef, pl.fim);
  const itens = pl.itens.map(it => plCalcItem(pl, it, base));
  const pesoTot = soma0(itens, c => c.it.peso || 1) || 1;
  const diasPlano = plDias(pl.inicio, pl.fim);
  const planPct = [], realPct = [];
  diasPlano.forEach(d => {
    let p = 0, r = 0;
    itens.forEach(c => {
      const w = (c.it.peso || 1) / pesoTot;
      let pa = 0, ra = 0;
      c.mapaPlan.forEach((v, dd) => { if (dd <= d) pa += v; });
      c.real.forEach((v, dd) => { if (dd <= d) ra += v; });
      p += w * Math.min(1, pa / c.it.qtd);
      r += w * Math.min(1, ra / c.it.qtd);
    });
    planPct.push(p * 100);
    realPct.push(d <= base ? r * 100 : null);
  });
  const iBase = diasPlano.filter(d => d <= base).length - 1;
  const pctPlan = iBase >= 0 ? planPct[iBase] : 0, pctReal = iBase >= 0 ? realPct[iBase] : 0;
  const diasRest = base < pl.fim ? contarDiasUteis(base, pl.fim) : 0;
  const decorridos = Math.max(1, iBase + 1);
  const janela = Math.min(7, decorridos);
  const antes = iBase - janela >= 0 ? realPct[iBase - janela] : 0;
  const ritmo = iBase >= 0 ? (pctReal - antes) / janela : 0;      // pontos percentuais por dia útil
  const proj = diasPlano.map((d, i) => (i <= iBase ? null : iBase >= 0 ? Math.min(100, pctReal + ritmo * (i - iBase)) : null));
  const nec = diasPlano.map((d, i) => (i < iBase ? null : i === iBase ? pctReal : Math.min(100, pctReal + (100 - pctReal) * (i - iBase) / Math.max(1, diasPlano.length - 1 - iBase))));
  const atrasadas = itens.filter(c => c.status === 'ATRASADO').length, concl = itens.filter(c => c.status === 'CONCLUÍDO').length;
  return { base, baseRef, itens, pesoTot, diasPlano, planPct, realPct, proj, nec, pctPlan, pctReal, desvio: pctReal - pctPlan, diasRest, ritmo, atrasadas, concl,
    falta: Math.max(0, 100 - pctReal), terminaEm: ritmo > 0.05 && pctReal < 100 && Math.ceil((100 - pctReal) / ritmo) <= 250 ? somarDiasUteis(base, Math.ceil((100 - pctReal) / ritmo)) : null };
}
function plStatusPlano(c) {
  if (c.itens.length && c.concl === c.itens.length) return 'CONCLUÍDO';
  if (c.baseRef < c.itens.map(i => i.it.inicio).sort()[0] && c.pctReal <= 0) return 'A INICIAR';
  return c.desvio >= 5 ? 'ADIANTADO' : c.desvio >= -1 ? 'NO PRAZO' : c.desvio >= -5 ? 'NO LIMITE' : 'ATRASADO';
}
const plFarol = st => `<span class="farol f-${PL_COR_STATUS[st] || 'pendente'}">${esc(st)}</span>`;

// ---------------------------------------------------------------- dados (servidor)
async function plCarregar(forcar) {
  if (PL.dados && !forcar) return PL.dados;
  try {
    const r = await fetch(API + 'planos', { cache: 'no-store' });
    PL.dados = r.ok ? await r.json() : { planos: [] };
  } catch { PL.dados = { planos: [] }; }
  if (!Array.isArray(PL.dados.planos)) PL.dados = { planos: [] };
  return PL.dados;
}
const plPlano = id => (PL.dados?.planos || []).find(p => p.id === id);

// ---------------------------------------------------------------- tela principal
async function renderPlanejamento() {
  const box = $('#planoNovo');
  if (!box) return;
  $('#segPlanSub').innerHTML = [['planos', 'Planos 5W2H'], ['legado', 'Setores e impacto logístico']]
    .map(([k, r]) => `<button data-pl-sub="${k}" class="${k === PL.sub ? 'ativa' : ''}">${r}</button>`).join('');
  $('#planoLegado').hidden = PL.sub !== 'legado';
  box.hidden = PL.sub !== 'planos';
  if (PL.sub === 'legado') return renderPlanejamentoLegado();
  if (!PL.dados) { box.innerHTML = '<p class="vazio">Carregando planejamentos…</p>'; await plCarregar(); }
  PL._atv = null;
  const planos = PL.dados.planos.slice().sort((a, b) => (b.inicio || '').localeCompare(a.inicio || ''));
  if (PL.sel && !plPlano(PL.sel)) PL.sel = null;
  if (!PL.sel && planos.length) PL.sel = planos[0].id;
  let h = `<div class="pl-topo"><div><h2 class="pl-titulo">Planejamento 5W2H</h2><p class="nota">Escolha o período, as atividades e preencha o 5W2H: o painel mostra a curva S planejado × realizado, o que falta, a divisão por dia, o Gantt e a linha do tempo.</p></div>
    <button class="btn primario" data-pl-novo>+ Novo planejamento</button></div>`;
  if (!planos.length) {
    h += `<div class="bloco pl-vazio"><h3>Nenhum planejamento ainda</h3><p>Crie o primeiro: período da execução, atividades a executar e o 5W2H de cada uma.</p><button class="btn primario" data-pl-novo>+ Novo planejamento</button></div>`;
    box.innerHTML = h;
    return;
  }
  h += '<div class="pl-cartoes">' + planos.map(p => {
    const c = plCalc(p), st = plStatusPlano(c);
    return `<button class="pl-cartao ${p.id === PL.sel ? 'sel' : ''}" data-pl-abrir="${esc(p.id)}">
      <div class="pl-cartao-topo"><b>${esc(p.nome)}</b>${plFarol(st)}</div>
      <div class="nota">${fdA(p.inicio)} a ${fdA(p.fim)} · ${p.itens.length} atividade(s)${p.status && p.status !== 'ativo' ? ' · ' + esc(p.status) : ''}</div>
      <div class="pl-mini"><span style="width:${Math.min(100, c.pctPlan)}%" class="plan"></span><span style="width:${Math.min(100, c.pctReal)}%" class="real"></span></div>
      <div class="nota">planejado ${nf(c.pctPlan, 0)}% · realizado ${nf(c.pctReal, 0)}%</div></button>`;
  }).join('') + '</div>';
  h += '<div id="plPainel"></div>';
  box.innerHTML = h;
  plRenderPainel();
}

function plRenderPainel() {
  const pl = plPlano(PL.sel), box = $('#plPainel');
  if (!pl || !box) return;
  const c = plCalc(pl), st = plStatusPlano(c);
  const tile = (rot, val, sub, cc) => `<div class="tile" style="--c:${cc}"><div class="rot"><span>${rot}</span></div><div class="val">${val}</div><div class="sub">${sub}</div></div>`;
  const dRest = c.diasRest;
  let h = `<div class="bloco pl-cab"><div><h3>${esc(pl.nome)} ${plFarol(st)}</h3>
      <p class="nota">${fdA(pl.inicio)} a ${fdA(pl.fim)} · ${plDias(pl.inicio, pl.fim).length} dias úteis · ${pl.itens.length} atividade(s)${pl.responsavel ? ' · responsável: ' + esc(pl.responsavel) : ''} · realizado até ${fdA(c.baseRef)}</p>
      ${pl.objetivo ? `<p class="pl-objetivo">${esc(pl.objetivo)}</p>` : ''}</div>
    <div class="acoes"><button class="btn" data-pl-editar>Editar planejamento</button><button class="btn" data-pl-csv>Exportar CSV</button>
      <button class="btn" data-pl-status="${pl.status === 'concluido' ? 'ativo' : 'concluido'}">${pl.status === 'concluido' ? 'Reabrir' : 'Marcar concluído'}</button>
      <button class="btn perigo" data-pl-excluir>Excluir</button></div></div>`;
  h += '<div class="tiles">' +
    tile('Planejado até hoje', nf(c.pctPlan, 1) + '%', 'curva S do plano', 'var(--prev, var(--fg3))') +
    tile('Realizado', nf(c.pctReal, 1) + '%', `desvio ${c.desvio >= 0 ? '+' : ''}${nf(c.desvio, 1)} p.p.`, c.desvio < -5 ? 'var(--vermelho)' : c.desvio < -1 ? 'var(--amarelo)' : 'var(--verde)') +
    tile('Falta', nf(c.falta, 1) + '%', dRest ? `${nf(c.falta / dRest, 1)} p.p. por dia útil (${dRest} dias úteis)` : 'prazo do plano encerrado', 'var(--acento)') +
    tile('Ritmo atual', nf(c.ritmo, 1) + ' p.p./dia', c.terminaEm ? `no ritmo, termina em ${fdA(c.terminaEm)}` : c.pctReal >= 100 ? 'plano concluído' : c.ritmo > 0 ? 'ritmo baixo demais para fechar o plano' : 'sem lançamentos recentes para projetar', (c.terminaEm && c.terminaEm <= pl.fim) || c.pctReal >= 100 ? 'var(--verde)' : 'var(--vermelho)') +
    tile('Atividades', `${c.concl}/${pl.itens.length}`, `${c.atrasadas} atrasada(s)`, c.atrasadas ? 'var(--vermelho)' : 'var(--verde)') + '</div>';
  h += `<div class="seg pl-abas" id="plAbas">${PL_ABAS.map(([k, r]) => `<button data-pl-vista="${k}" class="${k === PL.vista ? 'ativa' : ''}">${r}</button>`).join('')}</div><div id="plCorpo"></div>`;
  box.innerHTML = h;
  plRenderCorpo(pl, c);
}

function plRenderCorpo(pl, c) {
  const box = $('#plCorpo');
  if (!box) return;
  ({ resumo: plResumo, dia: plDiaADia, gantt: plGantt, linha: plLinha, w5: plW5 })[PL.vista](pl, c, box);
  requestAnimationFrame(syncScrollTopo);
}

// ---------------------------------------------------------------- resumo: curva S + o que falta
function plResumo(pl, c, box) {
  const opts = pl.itens.map(i => `<option value="${esc(i.chave)}" ${PL.atv === i.chave ? 'selected' : ''}>${esc(i.atividade)} · ${esc(cap(i.frente))}</option>`).join('');
  let h = `<div class="bloco"><div class="bloco-cab"><h2>Curva S — planejado × realizado</h2>
    <label class="rot-sel">Atividade <select id="plAtv"><option value="">Todo o plano (ponderado)</option>${opts}</select></label></div>
    <div class="grafico pl-grafico"><canvas id="gPlanoCurva"></canvas></div>
    <p class="nota">Linha cheia = realizado; tracejada longa = planejado (divisão automática por dia útil); pontilhada = projeção no ritmo atual; cinza = ritmo necessário para fechar no prazo.</p></div>`;
  h += `<div class="bloco"><div class="bloco-cab"><h2>O que falta executar</h2><span class="nota">Ritmo necessário = falta ÷ dias úteis que restam até o fim de cada atividade.</span></div>
    <div class="tabela-rolagem"><table class="pl-tab"><thead><tr><th>Atividade</th><th>Frente</th><th class="n">Plano</th><th class="n">Realizado</th><th class="n">Falta</th><th class="n">Dias úteis</th>
      <th class="n">Necessário/dia</th><th class="n">Ritmo atual/dia</th><th class="pl-prog">Avanço</th><th>Situação</th></tr></thead><tbody>` +
    c.itens.map(x => `<tr data-pl-linha="${esc(x.it.chave)}"><td><b>${esc(x.it.atividade)}</b><div class="nota">${fd(x.it.inicio)} a ${fd(x.it.fim)}</div></td><td>${esc(cap(x.it.frente))}</td>
      <td class="n">${plFmt(x.it.qtd, x.it.unidade)} ${esc(x.it.unidade)}</td><td class="n">${plFmt(x.realAc, x.it.unidade)}</td><td class="n"><b>${plFmt(x.falta, x.it.unidade)}</b></td>
      <td class="n">${x.diasRest}</td><td class="n ${x.ritmoNec != null && x.ritmoAtual < x.ritmoNec ? 'valor-neg' : ''}">${x.ritmoNec == null ? '—' : plFmt(x.ritmoNec, x.it.unidade)}</td><td class="n">${plFmt(x.ritmoAtual, x.it.unidade)}</td>
      <td class="pl-prog"><div class="pl-barra"><span class="plan" style="width:${nf(x.pctPlan * 100, 0)}%"></span><span class="real f-${PL_COR_STATUS[x.status] || 'pendente'}" style="width:${nf(x.pctReal * 100, 0)}%"></span></div>
        <div class="nota">${nf(x.pctReal * 100, 0)}% de ${nf(x.pctPlan * 100, 0)}% previsto</div></td><td>${plFarol(x.status)}</td></tr>`).join('') +
    '</tbody></table></div></div>';
  box.innerHTML = h;
  plDesenharCurva(pl, c);
}
function plDesenharCurva(pl, c) {
  let planPct = c.planPct, realPct = c.realPct, proj = c.proj, nec = c.nec;
  if (PL.atv) {
    const x = c.itens.find(i => i.it.chave === PL.atv);
    if (x) {
      const pa = [], ra = [];
      let pAc = 0, rAc = 0;
      c.diasPlano.forEach(d => {
        pAc += x.mapaPlan.get(d) || 0; rAc += x.real.get(d) || 0;
        pa.push(Math.min(100, pAc / x.it.qtd * 100));
        ra.push(d <= c.base ? Math.min(100, rAc / x.it.qtd * 100) : null);
      });
      planPct = pa; realPct = ra;
      const iB = c.diasPlano.filter(d => d <= c.base).length - 1, rit = iB >= 0 ? (x.ritmoAtual / x.it.qtd) * 100 : 0;
      proj = c.diasPlano.map((d, i) => (i <= iB || iB < 0 ? null : Math.min(100, realPct[iB] + rit * (i - iB))));
      nec = c.diasPlano.map((d, i) => (i < iB ? null : i === iB ? realPct[iB] : Math.min(100, realPct[iB] + (100 - realPct[iB]) * (i - iB) / Math.max(1, c.diasPlano.length - 1 - iB))));
    }
  }
  const n = v => v == null ? null : +v.toFixed(1);
  trocarGrafico('gPlanoCurva', {
    type: 'line',
    data: { labels: c.diasPlano.map(fd), datasets: [
      { label: 'Planejado', data: planPct.map(n), borderColor: cor('--acento'), backgroundColor: cor('--acento'), borderDash: [6, 4], borderWidth: 2, pointRadius: 0, tension: .25 },
      { label: 'Realizado', data: realPct.map(n), borderColor: cor('--verde'), backgroundColor: cor('--verde'), borderWidth: 3, pointRadius: 2, tension: .25 },
      { label: 'Projeção (ritmo atual)', data: proj.map(n), borderColor: cor('--amarelo'), backgroundColor: cor('--amarelo'), borderDash: [2, 3], borderWidth: 2, pointRadius: 0, tension: 0 },
      { label: 'Necessário para fechar no prazo', data: nec.map(n), borderColor: cor('--fg3'), backgroundColor: cor('--fg3'), borderDash: [1, 4], borderWidth: 1.5, pointRadius: 0, tension: 0 },
    ] },
    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: true, labels: { color: cor('--fg2'), usePointStyle: true, boxWidth: 8 } }, tooltip: { callbacks: { label: x => `${x.dataset.label}: ${x.raw == null ? '—' : nf(x.raw, 1) + '%'}` } } },
      scales: eixos({ max: 100, ticks: { color: cor('--fg2'), callback: v => v + '%' } }, { ticks: { color: cor('--fg2'), maxTicksLimit: 14 } }) },
  });
}

// ---------------------------------------------------------------- dia a dia (divisão automática)
function plDiaADia(pl, c, box) {
  const dias = c.diasPlano, semanal = PL.dia === 'semana' || (PL.dia !== 'dia' && PL.dia !== 'original' && false);
  const vista = PL.vista === 'dia' ? (PL._diaVista || (dias.length > 45 ? 'semana' : 'dia')) : 'dia';
  PL._diaVista = vista;
  const replan = PL.dia === 'replan';
  const colunas = vista === 'semana'
    ? [...new Set(dias.map(plSegunda))].map(s => ({ rot: `${fd(s)}`, dias: dias.filter(d => plSegunda(d) === s) }))
    : dias.map(d => ({ rot: `${fd(d)}<br><span class="nota">${plDiaSemana(d)}</span>`, dias: [d] }));
  const valorPlan = (x, d) => (replan && d > c.base ? (x.redistrib.get(d) || 0) : (x.mapaPlan.get(d) || 0));
  const cel = (x, col) => {
    const p = soma0(col.dias, d => valorPlan(x, d)), r = soma0(col.dias, d => x.real.get(d) || 0);
    const passado = col.dias[col.dias.length - 1] <= c.base, hoje = col.dias.includes(c.base);
    const cls = passado ? (r >= p - 1e-9 ? 'ok' : (p > 0 ? 'baixo' : '')) : '';
    return `<td class="n pl-cel ${cls} ${hoje ? 'hoje' : ''}">${p ? `<span class="plan">${plFmt(p, x.it.unidade)}</span>` : ''}${passado || r ? `<span class="real">${r ? plFmt(r, x.it.unidade) : (p ? '0' : '')}</span>` : ''}</td>`;
  };
  let h = `<div class="bloco"><div class="bloco-cab"><h2>Divisão automática por ${vista === 'semana' ? 'semana' : 'dia útil'}</h2>
    <div class="acoes"><div class="seg" id="plDiaModo"><button data-pl-diamodo="original" class="${!replan ? 'ativa' : ''}">Plano original</button><button data-pl-diamodo="replan" class="${replan ? 'ativa' : ''}">Replanejado (saldo ÷ dias que restam)</button></div>
    <div class="seg" id="plDiaVista"><button data-pl-diavista="dia" class="${vista === 'dia' ? 'ativa' : ''}">Por dia</button><button data-pl-diavista="semana" class="${vista === 'semana' ? 'ativa' : ''}">Por semana</button></div></div></div>
    <p class="nota">Em cada célula: <span class="pl-leg plan">planejado</span> e <span class="pl-leg real">realizado</span>. Verde = meta do dia cumprida, vermelho = abaixo da meta. ${replan ? 'Os dias futuros mostram o saldo ainda não executado dividido igualmente nos dias úteis que restam.' : 'Cada atividade divide a quantidade do plano igualmente nos dias úteis do seu período (unidades inteiras são arredondadas sem perder a soma).'}</p>
    <div class="tabela-rolagem"><table class="pl-tab pl-dias"><thead><tr><th class="fixa">Atividade</th>${colunas.map(col => `<th class="n ${col.dias.includes(c.base) ? 'hoje' : ''}">${col.rot}</th>`).join('')}<th class="n">Total</th><th class="n">Falta</th></tr></thead><tbody>` +
    c.itens.map(x => `<tr><td class="fixa"><b>${esc(x.it.atividade)}</b><div class="nota">${esc(x.it.unidade)} · ${fd(x.it.inicio)} a ${fd(x.it.fim)}</div></td>${colunas.map(col => cel(x, col)).join('')}
      <td class="n"><span class="plan">${plFmt(x.it.qtd, x.it.unidade)}</span><span class="real">${plFmt(x.realAc, x.it.unidade)}</span></td><td class="n"><b>${plFmt(x.falta, x.it.unidade)}</b></td></tr>`).join('') +
    `</tbody><tfoot><tr><td class="fixa"><b>Avanço do plano (ponderado)</b></td>${colunas.map(col => {
      const d = col.dias[col.dias.length - 1], i = dias.indexOf(d);
      return `<td class="n">${nf(c.planPct[i], 0)}%${d <= c.base ? `<br><b>${nf(c.realPct[i], 0)}%</b>` : ''}</td>`;
    }).join('')}<td class="n">${nf(c.pctPlan, 0)}%<br><b>${nf(c.pctReal, 0)}%</b></td><td class="n"><b>${nf(c.falta, 0)}%</b></td></tr></tfoot></table></div></div>`;
  box.innerHTML = h;
}

// ---------------------------------------------------------------- Gantt do plano
function plGantt(pl, c, box) {
  const ini = pl.inicio, fim = pl.fim, nDias = Math.max(1, Math.round((dU(fim) - dU(ini)) / 86400000) + 1);
  const esq = 270, topo = 46, lin = 34, larg = Math.min(34, Math.max(9, Math.floor(1000 / nDias)));
  const W = esq + nDias * larg + 24, H = topo + c.itens.length * lin + 16;
  const X = d => esq + Math.round((dU(d) - dU(ini)) / 86400000) * larg;
  let s = `<svg class="pl-gantt" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Gantt do planejamento">`;
  for (let d = ini, i = 0; d <= fim; d = add(d, 1), i++) {
    const x = X(d);
    if (!diaUtil(d)) s += `<rect x="${x}" y="${topo - 6}" width="${larg}" height="${H - topo + 6}" class="pl-g-fds"/>`;
    if (dow(d) === 0 || d === ini) s += `<line x1="${x}" y1="${topo - 22}" x2="${x}" y2="${H - 10}" class="pl-g-sem"/><text x="${x + 3}" y="${topo - 10}" class="pl-g-rot">${fd(d)}</text>`;
  }
  c.itens.forEach((x, i) => {
    const y = topo + i * lin, it = x.it, cor1 = cor(PL_HEX[PL_COR_STATUS[x.status] || 'pendente']);
    const x1 = X(it.inicio), x2 = X(it.fim) + larg, w = Math.max(larg, x2 - x1);
    s += `<g class="pl-g-lin ${PL.atv === it.chave ? 'sel' : ''}" data-pl-gantt="${esc(it.chave)}"><rect x="0" y="${y}" width="${W}" height="${lin}" class="pl-g-fundo"/>
      <text x="8" y="${y + 15}" class="pl-g-nome">${esc(it.atividade.length > 34 ? it.atividade.slice(0, 33) + '…' : it.atividade)}</text><text x="8" y="${y + 28}" class="pl-g-sub">${esc(cap(it.frente).slice(0, 30))} · ${plFmt(it.qtd, it.unidade)} ${esc(it.unidade)}</text>
      <rect x="${x1}" y="${y + 6}" width="${w}" height="12" rx="4" class="pl-g-plan"><title>Planejado: ${fdA(it.inicio)} a ${fdA(it.fim)}</title></rect>
      <rect x="${x1}" y="${y + 6}" width="${Math.max(0, w * x.pctReal)}" height="12" rx="4" fill="${cor1}" opacity=".9"><title>Realizado: ${nf(x.pctReal * 100, 0)}%</title></rect>`;
    if (x.primeiro) {
      const r1 = X(x.primeiro), r2 = X(x.ultimo) + larg;
      s += `<rect x="${r1}" y="${y + 21}" width="${Math.max(4, r2 - r1)}" height="5" rx="2" fill="${cor1}"><title>Lançamentos: ${fdA(x.primeiro)} a ${fdA(x.ultimo)}</title></rect>`;
    }
    s += `<text x="${x2 + 6}" y="${y + 16}" class="pl-g-pct">${nf(x.pctReal * 100, 0)}%</text></g>`;
  });
  if (c.baseRef >= ini && c.baseRef <= fim) s += `<line x1="${X(c.baseRef) + larg / 2}" y1="${topo - 22}" x2="${X(c.baseRef) + larg / 2}" y2="${H - 10}" class="pl-g-hoje"/><text x="${X(c.baseRef) + larg / 2 + 4}" y="${topo - 26}" class="pl-g-hojet">referência ${fd(c.baseRef)}</text>`;
  const hj = hoje();
  if (hj !== c.baseRef && hj >= ini && hj <= fim) s += `<line x1="${X(hj) + larg / 2}" y1="${topo - 22}" x2="${X(hj) + larg / 2}" y2="${H - 10}" class="pl-g-hoje2"/>`;
  s += '</svg>';
  box.innerHTML = `<div class="bloco"><div class="bloco-cab"><h2>Gantt do planejamento</h2><span class="nota">Barra clara = período planejado; preenchimento = avanço realizado (cor da situação); barra fina = do primeiro ao último lançamento. Clique numa linha para destacar na curva S.</span></div>
    <div class="tabela-rolagem pl-gantt-caixa">${s}</div></div>`;
}

// ---------------------------------------------------------------- linha do tempo
function plLinha(pl, c, box) {
  const ev = [];
  const base = c.baseRef, hj = hoje();
  ev.push({ d: pl.inicio, tipo: 'marco', rot: 'Início do período do planejamento', det: pl.nome });
  ev.push({ d: pl.fim, tipo: 'marco', rot: 'Fim do período do planejamento', det: `${nf(c.pctReal, 0)}% realizado até a referência` });
  c.itens.forEach(x => {
    const it = x.it, atr = it.fim < base && x.status !== 'CONCLUÍDO';
    ev.push({ d: it.inicio, tipo: 'plan', rot: `Início previsto · ${it.atividade}`, det: `${plFmt(it.qtd, it.unidade)} ${it.unidade} em ${plDias(it.inicio, it.fim).length} dias úteis · ${it.quem || it.empresa || ''}` });
    ev.push({ d: it.fim, tipo: atr ? 'atraso' : 'plan', rot: `Fim previsto · ${it.atividade}`, det: atr ? `não concluída: falta ${plFmt(x.falta, it.unidade)} ${it.unidade}` : '' });
    if (x.primeiro) ev.push({ d: x.primeiro, tipo: 'real', rot: `1º lançamento · ${it.atividade}`, det: '' });
    if (x.concluiu) ev.push({ d: x.concluiu, tipo: 'ok', rot: `Concluída · ${it.atividade}`, det: `${plFmt(x.realAc, it.unidade)} ${it.unidade} lançados` });
    else if (x.ultimo && x.ultimo !== x.primeiro) ev.push({ d: x.ultimo, tipo: 'real', rot: `Último lançamento · ${it.atividade}`, det: `${plFmt(x.realAc, it.unidade)} de ${plFmt(it.qtd, it.unidade)} ${it.unidade}` });
  });
  ev.push({ d: base, tipo: 'ref', rot: 'Data de referência dos dados', det: 'o realizado considera os lançamentos até aqui' });
  if (hj !== base) ev.push({ d: hj, tipo: 'hoje', rot: 'Hoje', det: '' });
  ev.sort((a, b) => a.d.localeCompare(b.d) || ({ marco: 0, plan: 1, real: 2, ok: 3, atraso: 4, ref: 5, hoje: 6 }[a.tipo] - { marco: 0, plan: 1, real: 2, ok: 3, atraso: 4, ref: 5, hoje: 6 }[b.tipo]));
  const rel = d => { const n = Math.round((dU(d) - dU(base)) / 86400000); return n === 0 ? 'referência' : n > 0 ? `D+${n}` : `D${n}`; };
  let ultimo = null;
  const itens = ev.map(e => {
    const novoDia = e.d !== ultimo; ultimo = e.d;
    return `<li class="pl-ev ${e.tipo} ${e.d <= base ? 'passado' : 'futuro'}">${novoDia ? `<div class="pl-ev-data"><b>${fdA(e.d)}</b> <span class="nota">${plDiaSemana(e.d) ? DIAS[dow(e.d)] : ''} · ${rel(e.d)}</span></div>` : ''}
      <div class="pl-ev-corpo"><span class="pl-ev-ponto"></span><div><b>${esc(e.rot)}</b>${e.det ? `<div class="nota">${esc(e.det)}</div>` : ''}</div></div></li>`;
  }).join('');
  box.innerHTML = `<div class="bloco"><div class="bloco-cab"><h2>Linha do tempo da execução</h2><span class="nota">Marcos do plano, início/fim previstos e o que já foi lançado, em ordem de data. Cor de destaque = previsto, verde = realizado, vermelho = atrasado.</span></div><ol class="pl-linha">${itens}</ol></div>`;
}

// ---------------------------------------------------------------- 5W2H (leitura)
function plW5(pl, c, box) {
  box.innerHTML = `<div class="bloco"><div class="bloco-cab"><h2>5W2H das atividades</h2><button class="btn" data-pl-editar>Editar 5W2H</button></div>
    <div class="tabela-rolagem"><table class="pl-tab pl-w5"><thead><tr><th>Atividade</th><th>O quê <span class="nota">(What)</span></th><th>Por quê <span class="nota">(Why)</span></th><th>Onde <span class="nota">(Where)</span></th><th>Quando <span class="nota">(When)</span></th>
      <th>Quem <span class="nota">(Who)</span></th><th>Como <span class="nota">(How)</span></th><th class="n">Quanto <span class="nota">(How much)</span></th><th>Situação</th></tr></thead><tbody>` +
    c.itens.map(x => { const it = x.it; return `<tr><td><b>${esc(it.atividade)}</b></td><td>${esc(it.o_que || '—')}</td><td>${esc(it.por_que || '—')}</td><td>${esc(it.onde || it.frente || '—')}</td>
      <td>${fdA(it.inicio)} a ${fdA(it.fim)}<div class="nota">${plDias(it.inicio, it.fim).length} dias úteis</div></td><td>${esc(it.quem || it.empresa || '—')}</td><td>${esc(it.como || '—')}</td>
      <td class="n"><b>${plFmt(it.qtd, it.unidade)} ${esc(it.unidade)}</b><div class="nota">${plFmt(it.qtd / plDias(it.inicio, it.fim).length, it.unidade)} ${esc(it.unidade)}/dia útil${it.custo ? ' · ' + rs(it.custo) : ''}</div></td><td>${plFarol(x.status)}</td></tr>`; }).join('') +
    '</tbody></table></div></div>';
}

// ---------------------------------------------------------------- assistente: novo planejamento / editar
function plWizNovo() {
  const hj = plBase(), ini = diaUtil(hj) ? hj : somarDiasUteis(hj, 1);
  PL.wiz = { id: '', passo: 1, nome: '', inicio: ini, fim: somarDiasUteis(ini, 19), responsavel: '', objetivo: '', status: 'ativo', sel: new Map(), busca: '', frente: '' };
  plWizRender();
}
function plWizEditar(pl) {
  PL.wiz = { id: pl.id, passo: 1, nome: pl.nome, inicio: pl.inicio, fim: pl.fim, responsavel: pl.responsavel || '', objetivo: pl.objetivo || '', status: pl.status || 'ativo',
    sel: new Map(pl.itens.map(i => [i.chave, { ...i }])), busca: '', frente: '' };
  plWizRender();
}
function plItemPadrao(a, w) {
  let ini = maxD(w.inicio, a.ini || w.inicio), fim = minD(w.fim, a.prazo || w.fim);
  if (ini > fim) { ini = w.inicio; fim = w.fim; }
  const dias = plDias(ini, fim).length, saldo = Math.max(0, a.qtd - a.realAc), meta = Number(a.it.meta_dia) || (a.qtd / Math.max(1, contarDiasUteis(add(a.ini || w.inicio, -1), a.prazo || w.fim)));
  let q = Math.min(saldo > 0 ? saldo : a.qtd, meta * dias);
  q = plInteiro(a.unidade) ? Math.max(1, Math.round(q)) : +Math.max(.1, q).toFixed(1);
  const quem = a.empresas.join(' / ');
  return { chave: a.chave, atividade: a.nome, frente: a.frente, empresa: quem, unidade: a.unidade, qtd_contrato: a.qtd, qtd: q, peso: dias, inicio: ini, fim,
    o_que: `Executar ${a.nome}`, por_que: '', onde: cap(a.frente), quem, como: '', custo: null, obs: '' };
}
function plWizRender() {
  const w = PL.wiz;
  let m = document.getElementById('plModal');
  if (!m) { m = document.createElement('div'); m.id = 'plModal'; m.className = 'pl-modal-fundo'; document.body.appendChild(m); }
  const passos = ['Período', 'Atividades', '5W2H'];
  const titulo = w.id ? 'Editar planejamento' : 'Novo planejamento';
  let corpo = '';
  if (w.passo === 1) {
    corpo = `<div class="pl-form"><label class="largo">Nome do planejamento<input data-pl-w="nome" value="${esc(w.nome)}" placeholder="Ex.: Semana 12 a 23/10 — Cobertura e Eclusa" maxlength="120"></label>
      <label>Início da execução<input type="date" data-pl-w="inicio" value="${w.inicio}"></label><label>Fim da execução<input type="date" data-pl-w="fim" value="${w.fim}"></label>
      <label>Responsável pelo plano<input data-pl-w="responsavel" value="${esc(w.responsavel)}" maxlength="120"></label>
      <label class="largo">Objetivo do período (por quê)<textarea data-pl-w="objetivo" rows="2" maxlength="800" placeholder="O que precisa estar pronto ao fim do período e por quê">${esc(w.objetivo)}</textarea></label></div>
      <p class="nota">${w.inicio && w.fim && w.fim >= w.inicio ? `${plDias(w.inicio, w.fim).length} dias úteis no período.` : 'Informe um período válido.'}</p>`;
  } else if (w.passo === 2) {
    const ats = plAtividades(), frentes = [...new Set(ats.map(a => a.frente))];
    const f = w.busca.toUpperCase();
    const vis = ats.filter(a => (!w.frente || a.frente === w.frente) && (!f || ganNorm(a.nome + ' ' + a.frente + ' ' + a.empresas.join(' ')).includes(ganNorm(f))));
    const sobrepoe = a => a.status !== 'CONCLUÍDO' && (!a.ini || a.ini <= w.fim) && (!a.prazo || a.prazo >= w.inicio);
    corpo = `<div class="pl-barra-sel"><input type="search" class="input-filtro" data-pl-busca placeholder="Buscar atividade, frente ou empresa…" value="${esc(w.busca)}">
      <select data-pl-frente><option value="">Todas as frentes</option>${frentes.map(x => `<option ${x === w.frente ? 'selected' : ''} value="${esc(x)}">${esc(cap(x))}</option>`).join('')}</select>
      <button class="btn" data-pl-sugerir>Sugerir as do período</button><button class="btn" data-pl-todas>Marcar visíveis</button><button class="btn" data-pl-nenhuma>Limpar</button>
      <span class="nota"><b>${w.sel.size}</b> selecionada(s) · ${ats.length} atividades no cronograma</span></div>
      <div class="tabela-rolagem pl-lista"><table class="pl-tab"><thead><tr><th></th><th>Atividade</th><th>Frente</th><th>Empresa</th><th class="n">Contrato</th><th class="n">Realizado</th><th class="n">Saldo</th><th>Cronograma</th><th>Situação</th></tr></thead><tbody>` +
      (vis.length ? vis.map(a => `<tr class="${w.sel.has(a.chave) ? 'marcada' : ''} ${sobrepoe(a) ? '' : 'fora'}"><td><input type="checkbox" data-pl-marca="${esc(a.chave)}" ${w.sel.has(a.chave) ? 'checked' : ''}></td>
        <td><b>${esc(a.nome)}</b></td><td>${esc(cap(a.frente))}</td><td>${esc(a.empresas.join(' / ') || '—')}</td><td class="n">${plFmt(a.qtd, a.unidade)} ${esc(a.unidade)}</td><td class="n">${plFmt(a.realAc, a.unidade)}</td>
        <td class="n">${plFmt(Math.max(0, a.qtd - a.realAc), a.unidade)}</td><td>${fd(a.ini)} a ${fd(a.prazo)}</td><td>${plFarol(a.status)}</td></tr>`).join('') : '<tr><td colspan="9" class="vazio">Nenhuma atividade encontrada.</td></tr>') +
      '</tbody></table></div><p class="nota">Linhas esmaecidas não coincidem com o período escolhido ou já estão concluídas; dá para marcá-las mesmo assim.</p>';
  } else {
    const itens = [...w.sel.values()];
    corpo = `<p class="nota">Preencha o 5W2H de cada atividade. O quê, onde, quem e a quantidade já vêm sugeridos do cronograma. A divisão por dia é automática.</p>
      <div class="barra-acoes"><button class="btn" data-pl-aplicar-periodo>Aplicar o período do plano a todas</button><span class="nota">${itens.length} atividade(s)</span></div><div class="pl-cartoes5">` +
      itens.map(it => { const a = plAtivPorChave(it.chave), k = esc(it.chave); const campo = (nome, rot, tipo = 'text', extra = '') => `<label>${rot}<input ${tipo === 'num' ? 'type="number" step="any" min="0"' : tipo === 'date' ? 'type="date"' : 'type="text" maxlength="500"'} data-pl-i="${nome}" data-k="${k}" value="${esc(it[nome] ?? '')}" ${extra}></label>`;
        return `<div class="pl-w5card" data-k="${k}"><div class="pl-w5cab"><b>${esc(it.atividade)}</b><span class="nota">${esc(cap(it.frente))}${a ? ` · contrato ${plFmt(a.qtd, a.unidade)} ${esc(a.unidade)} · realizado ${plFmt(a.realAc, a.unidade)} · saldo ${plFmt(Math.max(0, a.qtd - a.realAc), a.unidade)}` : ' · atividade não está mais no cronograma'}</span>
            <button class="btn-link" data-pl-remover="${k}" title="Tirar do planejamento">remover</button></div>
          <div class="pl-form5">${campo('o_que', '<span><b>What</b> — O quê</span>')}${campo('por_que', '<span><b>Why</b> — Por quê</span>')}${campo('onde', '<span><b>Where</b> — Onde</span>')}
            <div class="pl-quando"><label><span><b>When</b> — Início</span><input type="date" data-pl-i="inicio" data-k="${k}" value="${it.inicio}"></label><label><span>Fim</span><input type="date" data-pl-i="fim" data-k="${k}" value="${it.fim}"></label></div>
            ${campo('quem', '<span><b>Who</b> — Quem</span>')}${campo('como', '<span><b>How</b> — Como</span>')}
            <div class="pl-quanto"><label><span><b>How much</b> — Quantidade (${esc(it.unidade)})</span><input type="number" step="any" min="0" data-pl-i="qtd" data-k="${k}" value="${it.qtd}"></label>
              <label><span>Custo estimado (R$)</span><input type="number" step="any" min="0" data-pl-i="custo" data-k="${k}" value="${it.custo ?? ''}"></label><label><span>Peso na curva S</span><input type="number" step="any" min="0.1" data-pl-i="peso" data-k="${k}" value="${it.peso ?? 1}"></label></div></div>
          <div class="pl-prev nota" data-pl-prev="${k}">${plPrevTexto(it)}</div></div>`; }).join('') + '</div>';
  }
  m.innerHTML = `<div class="pl-modal" role="dialog" aria-modal="true" aria-label="${titulo}"><div class="pl-modal-cab"><h2>${titulo}</h2><button class="btn" data-pl-fechar>Fechar</button></div>
    <div class="pl-passos">${passos.map((p, i) => `<button data-pl-passo="${i + 1}" class="${w.passo === i + 1 ? 'ativo' : ''} ${w.passo > i + 1 ? 'feito' : ''}"><span>${i + 1}</span> ${p}</button>`).join('')}</div>
    <div class="pl-modal-corpo">${corpo}</div>
    <div class="pl-modal-pe"><span class="nota" id="plWizMsg"></span><div class="acoes">${w.passo > 1 ? '<button class="btn" data-pl-voltar>Voltar</button>' : ''}
      ${w.passo < 3 ? '<button class="btn primario" data-pl-proximo>Próximo</button>' : `<button class="btn primario" data-pl-criar>${w.id ? 'Salvar alterações' : 'Criar planejamento'}</button>`}</div></div></div>`;
  const alvo = m.querySelector('[data-pl-w="nome"]');
  if (alvo && !w.nome) alvo.focus();
}
function plPrevTexto(it) {
  const n = it.inicio && it.fim && it.fim >= it.inicio ? plDias(it.inicio, it.fim).length : 0;
  return n && it.qtd > 0 ? `Divisão automática: <b>${plFmt(it.qtd / n, it.unidade)} ${esc(it.unidade)} por dia útil</b> durante ${n} dia(s) útil(eis) (${fd(it.inicio)} a ${fd(it.fim)}).` : 'Informe datas e quantidade válidas.';
}
function plWizMsg(t, erro) { const el = document.getElementById('plWizMsg'); if (el) { el.textContent = t || ''; el.className = 'nota' + (erro ? ' pl-erro' : ''); } }
function plWizFechar() { document.getElementById('plModal')?.remove(); PL.wiz = null; }
function plWizValidar(passo) {
  const w = PL.wiz;
  if (passo >= 1) {
    if (!w.nome.trim()) return 'Dê um nome ao planejamento.';
    if (!ehISO(w.inicio) || !ehISO(w.fim)) return 'Informe o início e o fim da execução.';
    if (w.fim < w.inicio) return 'O fim da execução não pode ser antes do início.';
  }
  if (passo >= 2 && !w.sel.size) return 'Marque ao menos uma atividade.';
  if (passo >= 3) {
    for (const it of w.sel.values()) {
      if (!(Number(it.qtd) > 0)) return `${it.atividade}: informe a quantidade (How much).`;
      if (!ehISO(it.inicio) || !ehISO(it.fim) || it.fim < it.inicio) return `${it.atividade}: confira o início e o fim (When).`;
    }
  }
  return '';
}
async function plWizSalvar() {
  const w = PL.wiz, erro = plWizValidar(3);
  if (erro) return plWizMsg(erro, true);
  const plano = { id: w.id || '', nome: w.nome.trim(), inicio: w.inicio, fim: w.fim, responsavel: w.responsavel.trim(), objetivo: w.objetivo.trim(), status: w.status,
    itens: [...w.sel.values()].map(i => ({ ...i, qtd: Number(i.qtd), peso: Number(i.peso) > 0 ? Number(i.peso) : 1, custo: i.custo === '' || i.custo == null ? null : Number(i.custo) })) };
  try {
    const r = await postar(API + 'planos', { plano });
    await plCarregar(true);
    PL.sel = r.id || w.id; PL.vista = 'resumo'; PL.atv = '';
    plWizFechar();
    toast('Planejamento salvo ' + ONDE);
    renderPlanejamento();
  } catch (e) { plWizMsg(e.message || 'Erro ao salvar.', true); }
}

// ---------------------------------------------------------------- exportação
function plCsv(pl) {
  const c = plCalc(pl), q = v => `"${String(v ?? '').replace(/"/g, '""')}"`, linhas = [];
  linhas.push(['Planejamento', pl.nome, 'Período', `${fdA(pl.inicio)} a ${fdA(pl.fim)}`, 'Referência', fdA(c.baseRef)].map(q).join(';'));
  linhas.push(['Atividade', 'Frente', 'O quê', 'Por quê', 'Onde', 'Início', 'Fim', 'Quem', 'Como', 'Un', 'Qtd plano', 'Realizado', 'Falta', 'Custo (R$)', 'Situação'].map(q).join(';'));
  c.itens.forEach(x => { const it = x.it; linhas.push([it.atividade, it.frente, it.o_que, it.por_que, it.onde, fdA(it.inicio), fdA(it.fim), it.quem, it.como, it.unidade, nf(it.qtd, 2), nf(x.realAc, 2), nf(x.falta, 2), it.custo ?? '', x.status].map(q).join(';')); });
  linhas.push('');
  linhas.push(['Divisão por dia útil', ...c.diasPlano.map(fdA)].map(q).join(';'));
  c.itens.forEach(x => {
    linhas.push([x.it.atividade + ' (planejado)', ...c.diasPlano.map(d => nf(x.mapaPlan.get(d) || 0, 2))].map(q).join(';'));
    linhas.push([x.it.atividade + ' (realizado)', ...c.diasPlano.map(d => d <= c.base ? nf(x.real.get(d) || 0, 2) : '')].map(q).join(';'));
  });
  const blob = new Blob(['﻿' + linhas.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `planejamento-${pl.nome.replace(/[^\w\-]+/g, '_')}.csv`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ---------------------------------------------------------------- eventos
document.addEventListener('click', async ev => {
  const t = ev.target;
  const sub = t.closest('[data-pl-sub]');
  if (sub) { PL.sub = sub.dataset.plSub; return renderPlanejamento(); }
  if (t.closest('[data-pl-novo]')) return plWizNovo();
  const abrir = t.closest('[data-pl-abrir]');
  if (abrir) { PL.sel = abrir.dataset.plAbrir; PL.atv = ''; return renderPlanejamento(); }
  const vista = t.closest('[data-pl-vista]');
  if (vista) { PL.vista = vista.dataset.plVista; return plRenderPainel(); }
  const pl = plPlano(PL.sel);
  if (t.closest('[data-pl-editar]') && pl) return plWizEditar(pl);
  if (t.closest('[data-pl-csv]') && pl) return plCsv(pl);
  const dm = t.closest('[data-pl-diamodo]');
  if (dm) { PL.dia = dm.dataset.plDiamodo; return plRenderPainel(); }
  const dv = t.closest('[data-pl-diavista]');
  if (dv) { PL._diaVista = dv.dataset.plDiavista; return plRenderPainel(); }
  const g = t.closest('[data-pl-gantt]');
  if (g) { PL.atv = PL.atv === g.dataset.plGantt ? '' : g.dataset.plGantt; PL.vista = 'resumo'; return plRenderPainel(); }
  const lin = t.closest('tr[data-pl-linha]');
  if (lin && !t.closest('button')) { PL.atv = lin.dataset.plLinha; const s = $('#plAtv'); if (s) { s.value = PL.atv; plDesenharCurva(pl, plCalc(pl)); } return; }
  const st = t.closest('[data-pl-status]');
  if (st && pl) {
    try { await postar(API + 'planos', { plano: { ...pl, status: st.dataset.plStatus } }); await plCarregar(true); toast('Planejamento atualizado ' + ONDE); renderPlanejamento(); } catch (e) { toast(e.message, true); }
    return;
  }
  if (t.closest('[data-pl-excluir]') && pl) {
    if (!confirm(`Excluir o planejamento "${pl.nome}"? Isso não apaga produção nem cronograma.`)) return;
    try { await postar(API + 'planos', { excluir: pl.id }); await plCarregar(true); PL.sel = null; toast('Planejamento excluído ' + ONDE); renderPlanejamento(); } catch (e) { toast(e.message, true); }
    return;
  }
  // assistente
  const w = PL.wiz;
  if (!w) return;
  if (t.classList?.contains('pl-modal-fundo') || t.closest('[data-pl-fechar]')) return plWizFechar();
  const passo = t.closest('[data-pl-passo]');
  if (passo) {
    const alvo = +passo.dataset.plPasso;
    const erro = alvo > w.passo ? plWizValidar(w.passo) : '';
    if (erro) return plWizMsg(erro, true);
    if (alvo === 3 && w.passo !== 3 && !plWizValidar(2)) plWizPrepararItens();
    w.passo = alvo; return plWizRender();
  }
  if (t.closest('[data-pl-voltar]')) { w.passo = Math.max(1, w.passo - 1); return plWizRender(); }
  if (t.closest('[data-pl-proximo]')) {
    const erro = plWizValidar(w.passo);
    if (erro) return plWizMsg(erro, true);
    if (w.passo === 1) { plAtividades(true); }
    w.passo++;
    if (w.passo === 3) plWizPrepararItens();
    return plWizRender();
  }
  if (t.closest('[data-pl-criar]')) return plWizSalvar();
  const marca = t.closest('[data-pl-marca]');
  if (marca) { const a = plAtivPorChave(marca.dataset.plMarca); if (marca.checked) { if (a && !w.sel.has(a.chave)) w.sel.set(a.chave, plItemPadrao(a, w)); } else w.sel.delete(marca.dataset.plMarca); return plWizRender(); }
  if (t.closest('[data-pl-sugerir]')) {
    plAtividades().filter(a => a.status !== 'CONCLUÍDO' && (!a.ini || a.ini <= w.fim) && (!a.prazo || a.prazo >= w.inicio)).forEach(a => { if (!w.sel.has(a.chave)) w.sel.set(a.chave, plItemPadrao(a, w)); });
    return plWizRender();
  }
  if (t.closest('[data-pl-todas]')) {
    const f = w.busca;
    plAtividades().filter(a => (!w.frente || a.frente === w.frente) && (!f || ganNorm(a.nome + ' ' + a.frente + ' ' + a.empresas.join(' ')).includes(ganNorm(f)))).forEach(a => { if (!w.sel.has(a.chave)) w.sel.set(a.chave, plItemPadrao(a, w)); });
    return plWizRender();
  }
  if (t.closest('[data-pl-nenhuma]')) { w.sel.clear(); return plWizRender(); }
  const rem = t.closest('[data-pl-remover]');
  if (rem) { w.sel.delete(rem.dataset.plRemover); if (!w.sel.size) w.passo = 2; return plWizRender(); }
  if (t.closest('[data-pl-aplicar-periodo]')) {
    w.sel.forEach(it => { it.inicio = w.inicio; it.fim = w.fim; it.peso = plDias(w.inicio, w.fim).length; });
    return plWizRender();
  }
});
function plWizPrepararItens() {   // itens novos recebem as datas dentro do período do plano
  const w = PL.wiz;
  w.sel.forEach((it, k) => { if (!it.inicio || !it.fim) { const a = plAtivPorChave(k); if (a) w.sel.set(k, plItemPadrao(a, w)); } });
}
document.addEventListener('input', ev => {
  const w = PL.wiz, t = ev.target;
  if (!w) return;
  if (t.dataset.plW) { w[t.dataset.plW] = t.value; return; }
  if (t.dataset.plBusca !== undefined) { w.busca = t.value; clearTimeout(plWizRender._t); plWizRender._t = setTimeout(() => { plWizRender(); const i = document.querySelector('[data-pl-busca]'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 250); return; }
  if (t.dataset.plI) {
    const it = w.sel.get(t.dataset.k);
    if (!it) return;
    it[t.dataset.plI] = t.type === 'number' ? (t.value === '' ? '' : Number(t.value)) : t.value;
    const prev = document.querySelector(`[data-pl-prev="${CSS.escape(t.dataset.k)}"]`);
    if (prev) prev.innerHTML = plPrevTexto(it);
  }
});
document.addEventListener('change', ev => {
  const w = PL.wiz, t = ev.target;
  if (t.id === 'plAtv') { PL.atv = t.value; const pl = plPlano(PL.sel); if (pl) plDesenharCurva(pl, plCalc(pl)); return; }
  if (!w) return;
  if (t.dataset.plFrente !== undefined) { w.frente = t.value; plWizRender(); }
  if (t.dataset.plW && (t.dataset.plW === 'inicio' || t.dataset.plW === 'fim')) plWizRender();
});
document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && PL.wiz) plWizFechar(); });
