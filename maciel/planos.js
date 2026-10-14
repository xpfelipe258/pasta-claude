'use strict';
// ------------------------------------------------------------------------------------------------
// PLANEJAMENTO 5W2H (aba Planejamento)
// Fluxo: Novo planejamento > período da execução > atividades (todas as do cronograma) > 5W2H de cada uma > painel.
// O plano guarda só o que foi planejado (período, atividades, 5W2H, quantidade e datas). O realizado, a curva S,
// o que falta e a divisão por dia são calculados aqui, ao abrir a tela, a partir da produção lançada.
// Depende de app.js: M, T, ref, ganLinhas, ganDataKey, ehFrenteAnexa, servicosDaFrente, ganBmPercentual,
// ganBmAtividadesEspecificas, diaUtil, add, contarDiasUteis, trocarGrafico, eixos, cor, nf, fd, fdA, esc, cap, toast, postar.
// ------------------------------------------------------------------------------------------------
const PL = { dados: null, carregando: false, sub: 'sug', sug: { preset: 'semana', ini: null, fim: null, grupo: 'atividade', concl: false, sel: null }, sel: null, vista: 'resumo', atv: '', dia: 'original', wiz: null, _atv: null };
const PL_ABAS = [['resumo', 'Resumo'], ['dia', 'Dia a dia'], ['gantt', 'Gantt'], ['linha', 'Linha do tempo'], ['w5', '5W2H'], ['lib', 'Liberação do fluxo']];
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
// divide qtd em dias consecutivos à razão de `taxa` por dia útil (a meta ou o ritmo); sem taxa válida, divide por igual
function plDistribuirTaxa(qtd, n, taxa, inteiro) {
  if (!(taxa > 0)) return plDistribuir(qtd, n, inteiro);
  const r = [];
  let ant = 0;
  for (let i = 1; i <= n; i++) {
    const alvo = Math.min(qtd, taxa * i), v = inteiro ? Math.round(alvo) - Math.round(ant) : alvo - ant;
    r.push(Math.max(0, v));
    ant = alvo;
  }
  return r;
}
// meta/dia em vigor: a digitada no plano; em branco, a meta atual do cadastro (cronograma); sem nenhuma, quantidade ÷ dias do período
function plMeta(it, ativ, nDias) {
  const m = Number(it.meta_dia) > 0 ? Number(it.meta_dia) : Number(ativ?.it?.meta_dia) > 0 ? Number(ativ.it.meta_dia) : 0;
  return m > 0 ? m : it.qtd / Math.max(1, nDias);
}
const plInteiro = un => ['un', 'und', 'pç', 'pc'].includes(String(un || '').toLowerCase());
const plFmtTaxa = v => nf(v, v >= 100 ? 0 : v >= 10 ? 1 : 2);   // taxas por dia: sempre com casas, mesmo em unidades inteiras
const plFmt = (v, un) => { if (Math.abs(v) < 0.005) v = 0; return nf(v, plInteiro(un) ? (Math.abs(v) < 10 && v % 1 ? 1 : 0) : 1); };   // unidade inteira: casas só nos valores pequenos que não fecham
const plDiaSemana = d => DIAS[dow(d)].slice(0, 1);
function plSegunda(d) { return add(d, -dow(d)); }

// ---------------------------------------------------------------- Eclusa – Vigas e Joists (dois itens do cronograma, em unidades)
// Vigas (9 un) e Joists (18 un): o realizado é o acumulado lançado nas colunas de vigas / de joists da Eclusa (eclusaSerie, app.js), inteiro,
// mesmo o que saiu antes do início do período. Planos salvos com o item antigo (27 un juntos) são divididos ao abrir (plMigrarEclusa).
// ---------------------------------------------------------------- atividades (todas as do cronograma)
function plUnidade(it) {
  if (it._eclusa) return 'un';
  if (it.bm_percentual || it.fonte_pct) return '%';
  const s = ganNorm(it.servico);
  if (typeof servicoUsaCatalogoM2 === 'function' && servicoUsaCatalogoM2(it.servico)) return 'm²';
  if (/RUFO|CALHA|LINHA DE VIDA/.test(s)) return 'm';
  return 'un';
}
const plChaveNome = n => ganNorm(n).replace(/[^A-Z0-9]/g, '').replace(/PREMONTAGEM|PREMONT/g, 'PM');   // "PRÉ-MONT. TERÇAS" = "PREMONTAGEM TERÇAS"
function plEmpresasDe(it) {
  const nomes = [], fr = ganNorm(it.frente), sv = plChaveNome(it.servico);
  M.empresas.forEach(e => {
    let ok = ehFrenteAnexa(it.frente) ? servicosDaFrente(e, it).length > 0 : e.servicos.some(s => servicoCompat(s.nome, it.servico));
    if (!ok) ok = e.servicos.some(s => ganNorm(s.frente) === fr && (plChaveNome(s.nome) === sv || plChaveNome(s.nome).endsWith(sv) || sv.endsWith(plChaveNome(s.nome))));   // mesmo serviço com outro nome no cronograma
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
    let a;
    const base = () => ({ chave: ganDataKey(l.it), nome: cap(l.it.servico_exib || l.it.servico), frente: l.it.frente || 'SEM FRENTE', fase: ganFaseNumero(l.it),
      unidade: plUnidade(l.it), qtd: Number(l.it.qtd) || 0, ini: l.ini || null, prazo: l.prazo || l.fimPrev || null, status: l.status,
      realAc: l.realAc || 0, prevAc: l.prevAc || 0, empresas: plEmpresasDe(l.it), it: l.it, linha: l });
    a = base();
    if (l.it._eclusa) a.acumulado = true;   // Eclusa vigas/joists: realizado = acumulado lançado, em unidades
    return a;
  }).sort((a, b) => a.frente.localeCompare(b.frente) || (a.ini || '').localeCompare(b.ini || '') || a.nome.localeCompare(b.nome));
  return PL._atv;
}
const plAtivPorChave = chave => plAtividades().find(a => a.chave === chave);

// Realizado por dia da atividade: vem do que foi lançado. Frentes anexas (Eclusa, Portaria...) usam só as colunas da própria
// frente e, na Eclusa, o avanço do BM; as demais usam a série do Gantt (produção, BM e apontamentos, a fonte maior).
function plSerieReal(a) {
  const it = a.it;
  if (a.acumulado) return a.linha.dsReal || [];   // Eclusa – Vigas e Joists: só o que foi lançado, acumulado
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
function plCalcItem(pl0, it0, base) {
  const pl = it0._plano || pl0;   // item vindo de outro plano (visão combinada no Painel): vale a janela do plano dele
  const ativ = plAtivPorChave(it0.chave);
  // Eclusa – Vigas e Joists: quantidade = contratado (un), mesmo em planos salvos antes; o que já foi lançado antes do período (r0) conta como feito
  const it = ativ?.acumulado ? { ...it0, qtd: ativ.qtd, unidade: 'un' } : it0;
  const r0 = ativ?.acumulado ? soma0(plSerieReal(ativ).filter(([d]) => d < pl.inicio && d <= base), ([, v]) => v) : 0;
  const dias = plDias(it.inicio, it.fim), inteiro = plInteiro(it.unidade);
  const restante = Math.max(0, it.qtd - r0);
  const meta = plMeta(it, ativ, dias.length);
  const plan = plDistribuirTaxa(restante, dias.length, meta, inteiro);
  const mapaPlan = new Map(dias.map((d, i) => [d, plan[i]]));
  const cabeNoPeriodo = meta * dias.length >= restante - 1e-9;   // false: a meta atual não fecha a quantidade no período
  const real = new Map();
  (ativ ? plSerieReal(ativ) : []).forEach(([d, v]) => {
    if (d >= pl.inicio && d <= pl.fim && d <= base) real.set(d, (real.get(d) || 0) + v);
  });
  const realAc = r0 + soma0([...real.values()], v => v);
  let planAc = r0;
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
  let acum = r0, concluiu = null;
  datasReais.forEach(d => { acum += real.get(d); if (!concluiu && acum >= it.qtd - 1e-9) concluiu = d; });
  // projeção do saldo a partir da data de referência, no ritmo atual (sem lançamentos recentes, na meta)
  const taxaProj = ritmoAtual > 0 ? ritmoAtual : meta;
  const futuros = plDias(add(base, 1), maxD(pl.fim, add(base, 1))).filter(d => d > base && d <= pl.fim);
  const redistrib = new Map();
  if (falta > 0 && futuros.length) plDistribuirTaxa(falta, futuros.length, taxaProj, inteiro).forEach((v, i) => redistrib.set(futuros[i], v));
  const termina = (qtd, taxa, de) => (taxa > 0 && qtd > 0 && Math.ceil(qtd / taxa) <= 400 ? somarDiasUteis(de, Math.ceil(qtd / taxa)) : null);
  const terminaMeta = termina(restante, meta, add(it.inicio, -1));           // pela meta, a partir do início planejado
  const terminaRitmo = falta <= 1e-9 ? (concluiu || base) : termina(falta, taxaProj, maxD(base, add(it.inicio, -1)));   // pelo ritmo (ou meta), a partir de agora
  return { it, ativ, r0, dias, mapaPlan, real, realAc, planAc, falta, diasRest, ritmoAtual, ritmoNec, status, meta, cabeNoPeriodo, taxaProj, terminaMeta, terminaRitmo,
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
      let pa = c.r0 || 0, ra = c.r0 || 0;
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
  plMigrarEclusa(PL.dados.planos);
  return PL.dados;
}
// Planos salvos com "ECLUSA – VIGAS E JOISTS" (27 un juntos) passam a ter dois itens, vigas (9) e joists (18), na proporção do contratado.
// A mudança vale na tela; é gravada quando o plano for salvo de novo.
function plMigrarEclusa(planos) {
  let novos = null;
  planos.forEach(p => {
    if (!(p.itens || []).some(i => /ECLUSA/.test(ganNorm(i.chave)) && /VIGAS E JOISTS/.test(ganNorm(i.chave + ' ' + (i.atividade || ''))))) return;
    novos ||= plAtividades().filter(a => a.it._eclusa);
    if (novos.length < 2) return;
    const tot = soma0(novos, a => a.qtd) || 1;
    p.itens = p.itens.flatMap(i => {
      if (!(/ECLUSA/.test(ganNorm(i.chave)) && /VIGAS E JOISTS/.test(ganNorm(i.chave + ' ' + (i.atividade || ''))))) return [i];
      return novos.map(a => { const f = a.qtd / tot; return { ...i, chave: a.chave, atividade: a.nome, unidade: 'un', qtd_contrato: a.qtd, qtd: +(Number(i.qtd) * f).toFixed(1), peso: (Number(i.peso) || 1) * f, meta_dia: i.meta_dia ? +(Number(i.meta_dia) * f).toFixed(3) : null }; });
    });
  });
}
const plPlano = id => (PL.dados?.planos || []).find(p => p.id === id);


// ---------------------------------------------------------------- sugestão a partir do cronograma
// Para um período [ini, fim]: o que o cronograma previa × o que foi realizado, quanto precisa ser realizado e quem executa.
function plRealAte(a, ate) {
  if (!a._serie) a._serie = plSerieReal(a);
  let t = 0;
  a._serie.forEach(([d, v]) => { if (d <= ate) t += v; });
  return t;
}
function plSugestao(a, ini, fim) {
  const base = plBase(), it = a.it, qtd = a.qtd, veI = add(ini, -1);
  const prevRef = prevCliente(it, base), P0 = prevCliente(it, veI), P1 = prevCliente(it, fim);
  const Rb = plRealAte(a, base), R0 = plRealAte(a, minD(veI, base));
  const precisa = Math.max(0, Math.min(qtd - Rb, P1 - Rb));
  const diasRest = fim > base ? contarDiasUteis(maxD(base, veI), fim) : 0;
  return { base, prevRef, P0, P1, Rb, R0, qtd, precisa, desvio: Rb - prevRef, atraso: Math.max(0, P0 - R0),
    previstoPeriodo: Math.max(0, P1 - P0), realPeriodo: Math.max(0, Rb - R0), metaPeriodo: Math.max(0, Math.min(qtd - R0, P1 - R0)),
    diasRest, porDia: diasRest > 0 ? precisa / diasRest : null, concluida: Rb >= qtd - 1e-9 };
}
function plSugPeriodo() {
  const g = PL.sug, b = plBase();
  if (g.preset !== 'livre' || !g.ini || !g.fim) {
    const seg = plSegunda(b);
    const ult = (() => { const [y, m] = b.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); })();
    const mapa = { semana: [seg, add(seg, 4)], prox: [add(seg, 7), add(seg, 11)], duas: [seg, add(seg, 11)], mes: [seg, ult >= seg ? ult : add(seg, 4)] };
    [g.ini, g.fim] = mapa[g.preset] || mapa.semana;
  }
  return [g.ini, g.fim];
}
function plSugLinhas(ini, fim) {
  const g = PL.sug;
  return plAtividades().map(a => ({ a, s: plSugestao(a, ini, fim) }))
    .filter(({ a, s }) => (g.concl || !s.concluida) && (!a.ini || a.ini <= fim) && (s.concluida ? (a.prazo || fim) >= ini : true))
    .sort((x, y) => (y.s.precisa > 1e-9) - (x.s.precisa > 1e-9) || (x.s.desvio / (x.a.qtd || 1)) - (y.s.desvio / (y.a.qtd || 1)) || x.a.frente.localeCompare(y.a.frente));
}
const plQuem = a => a.empresas.join(' / ') || a.it.responsavel || 'Sem empresa definida';
function plSugLinhaHtml({ a, s }, g) {
  const un = a.unidade, marca = g.sel.has(a.chave), temAcao = s.precisa > 1e-9;
  const st = s.concluida ? 'CONCLUÍDO' : a.status;
  return `<tr class="${marca ? 'marcada' : ''}"><td><input type="checkbox" data-pl-sug-marca="${esc(a.chave)}" ${marca ? 'checked' : ''} ${temAcao ? '' : 'disabled title="Nada a realizar neste período"'}></td>
    <td><b>${esc(a.nome)}</b><div class="nota">${esc(cap(a.frente))} · cronograma ${fd(a.ini)} a ${fd(a.prazo)}</div></td><td>${esc(plQuem(a))}</td>
    <td class="n">${plFmt(a.qtd, un)} ${esc(un)}</td><td class="n">${plFmt(s.prevRef, un)}</td><td class="n"><b>${plFmt(s.Rb, un)}</b></td>
    <td class="n ${s.desvio < -1e-9 ? 'valor-neg' : ''}">${s.desvio > 0 ? '+' : ''}${plFmt(s.desvio, un)}</td><td class="n">${plFmt(s.P1, un)}</td>
    <td class="n pl-precisa ${temAcao ? '' : 'ok'}" title="Previsto até ${fdA(s.base)} = ${plFmt(s.prevRef, un)}; realizado = ${plFmt(s.Rb, un)}; previsto até ${fdA(PL.sug.fim)} = ${plFmt(s.P1, un)}">${temAcao ? `<b>${plFmt(s.precisa, un)}</b> ${esc(un)}` : '—'}</td>
    <td class="n">${s.porDia != null && temAcao ? plFmtTaxa(s.porDia) + ' ' + esc(un) + '/dia' : temAcao ? '<span class="valor-neg">prazo do período vencido</span>' : '—'}</td><td>${plFarol(st)}</td></tr>`;
}
function plSugCurva(linhas, ini, fim) {
  const itens = linhas.map(l => l.a), dias = plDias(ini, fim), base = plBase();
  const pesoTot = soma0(itens, a => a.it.peso || 1) || 1;
  const pct = (fn, d) => soma0(itens, a => (a.it.peso || 1) * Math.min(1, fn(a, d) / (a.qtd || 1))) / pesoTot * 100;
  const prev = dias.map(d => pct((a, x) => prevCliente(a.it, x), d));
  const real = dias.map(d => (d <= base ? pct(plRealAte, d) : null));
  const iB = dias.filter(d => d <= base).length - 1, rB = iB >= 0 ? real[iB] : pct(plRealAte, base), pF = prev[prev.length - 1];
  const meta = dias.map((d, i) => (i < iB ? null : iB < 0 ? (i === dias.length - 1 ? pF : null) : i === iB ? rB : rB + (pF - rB) * (i - iB) / Math.max(1, dias.length - 1 - iB)));
  const n = v => (v == null ? null : +v.toFixed(1));
  trocarGrafico('gSugCurva', {
    type: 'line',
    data: { labels: dias.map(fd), datasets: [
      { label: 'Previsto no cronograma', data: prev.map(n), borderColor: cor('--acento'), backgroundColor: cor('--acento'), borderDash: [6, 4], borderWidth: 2, pointRadius: 0, tension: .2 },
      { label: 'Realizado', data: real.map(n), borderColor: cor('--verde'), backgroundColor: cor('--verde'), borderWidth: 3, pointRadius: 2, tension: .2 },
      { label: 'Precisa realizar (rumo ao previsto)', data: meta.map(n), borderColor: cor('--amarelo'), backgroundColor: cor('--amarelo'), borderDash: [2, 3], borderWidth: 2, pointRadius: 0, tension: 0 },
    ] },
    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: true, labels: { color: cor('--fg2'), usePointStyle: true, boxWidth: 8 } }, tooltip: { callbacks: { label: x => `${x.dataset.label}: ${x.raw == null ? '—' : nf(x.raw, 1) + '%'}` } } },
      scales: eixos({ max: 100, ticks: { color: cor('--fg2'), callback: v => v + '%' } }, { ticks: { color: cor('--fg2'), maxTicksLimit: 14 } }) },
  });
  return { prevRef: iB >= 0 ? prev[iB] : pct((a, x) => prevCliente(a.it, x), base), realRef: rB, prevFim: pF };
}
function renderSugestao(box) {
  PL._atv = null;
  const g = PL.sug, [ini, fim] = plSugPeriodo();
  g.ini = ini; g.fim = fim;
  const linhas = plSugLinhas(ini, fim);
  if (!g.sel) g.sel = new Set(linhas.filter(l => l.s.precisa > 1e-9).map(l => l.a.chave));
  [...g.sel].forEach(k => { if (!linhas.some(l => l.a.chave === k)) g.sel.delete(k); });
  const base = plBase(), acao = linhas.filter(l => l.s.precisa > 1e-9), atras = linhas.filter(l => !l.s.concluida && l.a.status === 'ATRASADO');
  const quems = new Set(); acao.forEach(l => (l.a.empresas.length ? l.a.empresas : [plQuem(l.a)]).forEach(e => quems.add(e)));
  const presets = [['semana', 'Semana da referência'], ['prox', 'Próxima semana'], ['duas', 'Esta + próxima'], ['mes', 'Até o fim do mês'], ['livre', 'Escolher datas']];
  let h = `<div class="pl-topo"><div><h2 class="pl-titulo">Sugestão de planejamento</h2><p class="nota">Montada sozinha a partir do cronograma: o que estava previsto, o que já foi realizado, o que precisa ser realizado no período e quem executa. Confira, marque o que entra e crie o planejamento 5W2H.</p></div>
    <button class="btn primario" data-pl-sug-criar ${g.sel.size ? '' : 'disabled'}>Criar planejamento com ${g.sel.size} selecionada(s)</button></div>
    <div class="bloco pl-sug-per"><div class="acoes"><b>Período</b><div class="seg" id="plSugPreset">${presets.map(([k, r]) => `<button data-pl-sug-preset="${k}" class="${g.preset === k ? 'ativa' : ''}">${r}</button>`).join('')}</div>
      <label class="rot-sel">de <input type="date" data-pl-sug-data="ini" value="${ini}"></label><label class="rot-sel">até <input type="date" data-pl-sug-data="fim" value="${fim}"></label>
      <span class="nota">${plDias(ini, fim).length} dias úteis · realizado até ${fdA(base)} (data de referência)</span></div></div>`;
  if (!linhas.length) {
    box.innerHTML = h + '<div class="bloco pl-vazio"><h3>Nada previsto para este período</h3><p>Nenhuma atividade do cronograma cai nestas datas. Escolha outro período.</p></div>';
    return;
  }
  h += `<div class="tiles" id="plSugTiles"></div>
    <div class="bloco"><div class="bloco-cab"><h2>Cronograma: previsto × realizado × o que precisa realizar</h2><span class="nota">Curva ponderada pelo peso das atividades listadas, nos dias úteis do período.</span></div><div class="grafico pl-grafico"><canvas id="gSugCurva"></canvas></div></div>`;
  h += `<div class="bloco"><div class="bloco-cab"><h2>O que fazer e quem faz</h2><div class="acoes">
    <div class="seg" id="plSugGrupo"><button data-pl-sug-grupo="atividade" class="${g.grupo === 'atividade' ? 'ativa' : ''}">Por atividade</button><button data-pl-sug-grupo="quem" class="${g.grupo === 'quem' ? 'ativa' : ''}">Por quem executa</button></div>
    <label class="check"><input type="checkbox" data-pl-sug-concl ${g.concl ? 'checked' : ''}> mostrar concluídas</label>
    <button class="btn" data-pl-sug-todas>Marcar as que precisam</button><button class="btn" data-pl-sug-nenhuma>Limpar</button></div></div>
    <p class="nota"><b>Precisa realizar</b> = quanto o cronograma prevê acumulado até ${fdA(fim)} menos o que já foi realizado (nunca mais que o saldo do contrato); inclui o atraso acumulado. <b>Por dia</b> = precisa realizar ÷ dias úteis que restam no período.</p>
    <div class="tabela-rolagem"><table class="pl-tab pl-sug"><thead><tr><th></th><th>Atividade</th><th>Quem</th><th class="n">Contrato</th><th class="n">Previsto até ${fd(base)}</th><th class="n">Realizado</th><th class="n">Desvio</th><th class="n">Previsto até ${fd(fim)}</th><th class="n">Precisa realizar</th><th class="n">Por dia útil</th><th>Situação</th></tr></thead><tbody>`;
  if (g.grupo === 'quem') {
    const grupos = new Map();
    linhas.forEach(l => { const k = plQuem(l.a); if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(l); });
    [...grupos.entries()].sort((x, y) => y[1].filter(l => l.s.precisa > 1e-9).length - x[1].filter(l => l.s.precisa > 1e-9).length).forEach(([k, ls]) => {
      const n = ls.filter(l => l.s.precisa > 1e-9).length, at = ls.filter(l => !l.s.concluida && l.a.status === 'ATRASADO').length;
      h += `<tr class="pl-grp"><td colspan="11"><b>${esc(k)}</b> · ${ls.length} atividade(s) · ${n} com algo a realizar${at ? ` · <span class="valor-neg">${at} atrasada(s)</span>` : ''}</td></tr>` + ls.map(l => plSugLinhaHtml(l, g)).join('');
    });
  } else h += linhas.map(l => plSugLinhaHtml(l, g)).join('');
  h += '</tbody></table></div></div>';
  box.innerHTML = h;
  const r = plSugCurva(linhas, ini, fim), dev = r.realRef - r.prevRef;
  const tile = (rot, val, sub, cc) => `<div class="tile" style="--c:${cc}"><div class="rot"><span>${rot}</span></div><div class="val">${val}</div><div class="sub">${sub}</div></div>`;
  $('#plSugTiles').innerHTML = tile('Previsto até a referência', nf(r.prevRef, 1) + '%', 'o que o cronograma pedia', 'var(--prev, var(--fg3))')
    + tile('Realizado', nf(r.realRef, 1) + '%', `desvio ${dev >= 0 ? '+' : ''}${nf(dev, 1)} p.p.`, dev < -5 ? 'var(--vermelho)' : dev < -1 ? 'var(--amarelo)' : 'var(--verde)')
    + tile('Previsto até ' + fd(fim), nf(r.prevFim, 1) + '%', `faltam ${nf(Math.max(0, r.prevFim - r.realRef), 1)} p.p. para a meta do período`, 'var(--acento)')
    + tile('Com algo a realizar', `${acao.length}/${linhas.length}`, `${atras.length} atrasada(s)`, atras.length ? 'var(--vermelho)' : 'var(--verde)')
    + tile('Quem executa', String(quems.size), [...quems].join(' · ') || 'nenhuma empresa definida', 'var(--ga, var(--acento))');
}
function plCriarDaSugestao() {
  const g = PL.sug, [ini, fim] = plSugPeriodo();
  const w = { id: '', passo: 3, nome: `Planejamento ${fdA(ini)} a ${fdA(fim)}`, inicio: ini, fim, responsavel: '',
    objetivo: `Recuperar o atraso e cumprir o previsto no cronograma até ${fdA(fim)}.`, status: 'ativo', sel: new Map(), busca: '', frente: '' };
  PL.wiz = w;
  plAtividades().filter(a => g.sel.has(a.chave)).forEach(a => w.sel.set(a.chave, plItemPadrao(a, w)));
  if (!w.sel.size) { PL.wiz = null; return toast('Marque ao menos uma atividade.', true); }
  plWizRender();
}

// ---------------------------------------------------------------- tela principal
async function renderPlanejamento() {
  const box = $('#planoNovo');
  if (!box) return;
  $('#segPlanSub').innerHTML = [['sug', 'Sugestão do cronograma'], ['planos', 'Planos 5W2H'], ['legado', 'Setores e impacto logístico']]
    .map(([k, r]) => `<button data-pl-sub="${k}" class="${k === PL.sub ? 'ativa' : ''}">${r}</button>`).join('');
  $('#planoLegado').hidden = PL.sub !== 'legado';
  box.hidden = PL.sub === 'legado';
  if (PL.sub === 'legado') return renderPlanejamentoLegado();
  if (PL.sub === 'sug') { await plCarregar(); return renderSugestao(box); }
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
    <div class="acoes"><button class="btn" data-pl-editar>Editar planejamento</button><button class="btn primario" data-pl-doc>Baixar planejamento</button><button class="btn" data-pl-csv>Exportar CSV</button>
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
  ({ resumo: plResumo, dia: plDiaADia, gantt: plGantt, linha: plLinha, w5: plW5, lib: plLiberacao })[PL.vista](pl, c, box);
  requestAnimationFrame(syncScrollTopo);
}

// ---------------------------------------------------------------- resumo: curva S + o que falta
function plResumo(pl, c, box) {
  const opts = pl.itens.map(i => `<option value="${esc(i.chave)}" ${PL.atv === i.chave ? 'selected' : ''}>${esc(i.atividade)} · ${esc(cap(i.frente))}</option>`).join('');
  let h = `<div class="bloco"><div class="bloco-cab"><h2>Curva S — planejado × realizado</h2>
    <label class="rot-sel">Atividade <select id="plAtv"><option value="">Todo o plano (ponderado)</option>${opts}</select></label></div>
    <div class="grafico pl-grafico"><canvas id="gPlanoCurva"></canvas></div>
    <p class="nota">Linha cheia = realizado; tracejada longa = planejado (divisão por dia na meta/dia de cada atividade); pontilhada = projeção no ritmo atual; cinza = ritmo necessário para fechar no prazo.</p></div>`;
  h += `<div class="bloco"><div class="bloco-cab"><h2>O que falta executar</h2><span class="nota">Necessário/dia = falta ÷ dias úteis até o fim da atividade. “Fecha em” usa a meta atual desde o início planejado e o ritmo atual (média dos últimos 5 dias úteis; sem lançamentos, a meta) a partir de hoje. Vermelho = passa do prazo.</span></div>
    <div class="tabela-rolagem"><table class="pl-tab"><thead><tr><th>Atividade</th><th>Frente</th><th class="n">Plano</th><th class="n">Realizado</th><th class="n">Falta</th><th class="n">Dias úteis</th>
      <th class="n">Meta/dia</th><th class="n">Necessário/dia</th><th class="n">Ritmo atual/dia</th><th class="n">Fecha em (meta)</th><th class="n">Fecha em (ritmo)</th><th class="pl-prog">Avanço</th><th>Situação</th></tr></thead><tbody>` +
    c.itens.map(x => `<tr data-pl-linha="${esc(x.it.chave)}"><td><b>${esc(x.it.atividade)}</b><div class="nota">${fd(x.it.inicio)} a ${fd(x.it.fim)}</div></td><td>${esc(cap(x.it.frente))}</td>
      <td class="n">${plFmt(x.it.qtd, x.it.unidade)} ${esc(x.it.unidade)}</td><td class="n">${plFmt(x.realAc, x.it.unidade)}</td><td class="n"><b>${plFmt(x.falta, x.it.unidade)}</b></td>
      <td class="n">${x.diasRest}</td><td class="n ${x.cabeNoPeriodo ? '' : 'valor-neg'}" title="${x.cabeNoPeriodo ? '' : 'A meta atual não fecha a quantidade do plano no período'}">${plFmtTaxa(x.meta)}</td><td class="n ${x.ritmoNec != null && x.ritmoAtual < x.ritmoNec ? 'valor-neg' : ''}">${x.ritmoNec == null ? '—' : plFmtTaxa(x.ritmoNec)}</td><td class="n">${plFmtTaxa(x.ritmoAtual)}</td>
      <td class="n ${x.terminaMeta && x.terminaMeta > x.it.fim ? 'valor-neg' : ''}">${x.terminaMeta ? fdA(x.terminaMeta) : '—'}</td><td class="n ${x.terminaRitmo && x.terminaRitmo > x.it.fim ? 'valor-neg' : ''}">${x.terminaRitmo ? fdA(x.terminaRitmo) : '—'}</td>
      <td class="pl-prog"><div class="pl-barra"><span class="plan" style="width:${nf(x.pctPlan * 100, 0)}%"></span><span class="real f-${PL_COR_STATUS[x.status] || 'pendente'}" style="width:${nf(x.pctReal * 100, 0)}%"></span></div>
        <div class="nota">${nf(x.pctReal * 100, 0)}% de ${nf(x.pctPlan * 100, 0)}% previsto</div></td><td>${plFarol(x.status)}</td></tr>`).join('') +
    '</tbody></table></div></div>';
  box.innerHTML = h;
  plDesenharCurva(pl, c);
}
function plDesenharCurva(pl, c, canvasId = 'gPlanoCurva', atv = PL.atv) {
  let planPct = c.planPct, realPct = c.realPct, proj = c.proj, nec = c.nec;
  if (atv) {
    const x = c.itens.find(i => i.it.chave === atv);
    if (x) {
      const pa = [], ra = [];
      let pAc = x.r0 || 0, rAc = x.r0 || 0;
      c.diasPlano.forEach(d => {
        pAc += x.mapaPlan.get(d) || 0; rAc += x.real.get(d) || 0;
        pa.push(Math.min(100, pAc / x.it.qtd * 100));
        ra.push(d <= c.base ? Math.min(100, rAc / x.it.qtd * 100) : null);
      });
      planPct = pa; realPct = ra;
      const iB = c.diasPlano.filter(d => d <= c.base).length - 1, rit = iB >= 0 ? (x.taxaProj / x.it.qtd) * 100 : 0;
      proj = c.diasPlano.map((d, i) => (i <= iB || iB < 0 ? null : Math.min(100, realPct[iB] + rit * (i - iB))));
      nec = c.diasPlano.map((d, i) => (i < iB ? null : i === iB ? realPct[iB] : Math.min(100, realPct[iB] + (100 - realPct[iB]) * (i - iB) / Math.max(1, c.diasPlano.length - 1 - iB))));
    }
  }
  const n = v => v == null ? null : +v.toFixed(1);
  trocarGrafico(canvasId, {
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
  let h = `<div class="bloco"><div class="bloco-cab"><h2>Divisão por ${vista === 'semana' ? 'semana' : 'dia útil'} — ${replan ? 'ritmo atual' : 'meta atual'}</h2>
    <div class="acoes"><div class="seg" id="plDiaModo"><button data-pl-diamodo="original" class="${!replan ? 'ativa' : ''}">Pela meta atual</button><button data-pl-diamodo="replan" class="${replan ? 'ativa' : ''}">Pelo ritmo atual (a partir de hoje)</button></div>
    <div class="seg" id="plDiaVista"><button data-pl-diavista="dia" class="${vista === 'dia' ? 'ativa' : ''}">Por dia</button><button data-pl-diavista="semana" class="${vista === 'semana' ? 'ativa' : ''}">Por semana</button></div></div></div>
    <p class="nota">Em cada célula: <span class="pl-leg plan">planejado</span> e <span class="pl-leg real">realizado</span>. Verde = meta do dia cumprida, vermelho = abaixo da meta. ${replan ? 'Até a data de referência vale a meta; dos dias seguintes em diante aparece o saldo ainda não executado, distribuído no ritmo atual de cada atividade (média dos últimos 5 dias úteis; sem lançamentos, na meta).' : 'Cada atividade recebe, a cada dia útil a partir do início, a sua meta/dia atual (cadastro do cronograma ou a digitada no 5W2H) até completar a quantidade do plano; o último dia leva só o que falta.'} A quantidade que passar do fim do período fica fora das colunas — veja “Fecha em” no Resumo.</p>
    <div class="tabela-rolagem"><table class="pl-tab pl-dias"><thead><tr><th class="fixa">Atividade</th>${colunas.map(col => `<th class="n ${col.dias.includes(c.base) ? 'hoje' : ''}">${col.rot}</th>`).join('')}<th class="n">Total</th><th class="n">Falta</th></tr></thead><tbody>` +
    c.itens.map(x => `<tr><td class="fixa"><b>${esc(x.it.atividade)}</b><div class="nota">${esc(x.it.unidade)} · ${fd(x.it.inicio)} a ${fd(x.it.fim)}</div><div class="nota ${x.cabeNoPeriodo ? '' : 'valor-neg'}">meta ${plFmtTaxa(x.meta)}/dia · ritmo ${plFmtTaxa(x.ritmoAtual)}/dia${x.cabeNoPeriodo ? '' : ' · meta não fecha no período'}</div></td>${colunas.map(col => cel(x, col)).join('')}
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
  const sg = plSugestao(a, w.inicio, w.fim);
  let ini = maxD(w.inicio, a.ini || w.inicio);
  if (ini > w.fim) ini = w.inicio;
  const semAtraso = sg.atraso <= 1e-9 && sg.precisa <= sg.previstoPeriodo + 1e-9;
  const fim = semAtraso && a.prazo && a.prazo >= ini && a.prazo < w.fim ? a.prazo : w.fim;   // atrasada ou sem prazo no período: vai até o fim do período
  const dias = plDias(ini, fim).length, saldo = Math.max(0, a.qtd - a.realAc);
  const meta = Number(a.it.meta_dia) || (a.qtd / Math.max(1, contarDiasUteis(add(a.ini || w.inicio, -1), a.prazo || w.fim)));
  let q = a.acumulado ? a.qtd : sg.metaPeriodo > 1e-9 ? sg.metaPeriodo : Math.min(saldo > 0 ? saldo : a.qtd, meta * dias);   // Eclusa – Vigas e Joists: o plano leva o contratado (27 un) inteiro   // meta do período = previsto + atraso (o que já saiu no período conta)
  q = plInteiro(a.unidade) ? Math.max(1, Math.round(q)) : +Math.max(.1, q).toFixed(1);
  const quem = plQuem(a) === 'Sem empresa definida' ? '' : plQuem(a);
  return { chave: a.chave, atividade: a.nome, frente: a.frente, empresa: quem, unidade: a.unidade, qtd_contrato: a.qtd, qtd: q, peso: dias, inicio: ini, fim,
    meta_dia: meta * dias >= q - 1e-9 ? null : +(q / dias).toFixed(3),   // em branco = acompanha a meta atual do cronograma
    o_que: `Executar ${a.nome}`,
    por_que: `Cronograma previa ${plFmt(sg.prevRef, a.unidade)} ${a.unidade} até ${fd(sg.base)}; realizado ${plFmt(sg.Rb, a.unidade)} (desvio ${sg.desvio >= 0 ? '+' : ''}${plFmt(sg.desvio, a.unidade)}). Previsto até ${fd(w.fim)}: ${plFmt(sg.P1, a.unidade)}.`,
    onde: cap(a.frente), quem, como: '', custo: null, obs: '' };
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
    const sobrepoe = a => plSugestao(a, w.inicio, w.fim).precisa > 1e-9;
    corpo = `<div class="pl-barra-sel"><input type="search" class="input-filtro" data-pl-busca placeholder="Buscar atividade, frente ou empresa…" value="${esc(w.busca)}">
      <select data-pl-frente><option value="">Todas as frentes</option>${frentes.map(x => `<option ${x === w.frente ? 'selected' : ''} value="${esc(x)}">${esc(cap(x))}</option>`).join('')}</select>
      <button class="btn" data-pl-sugerir>Sugerir pelo cronograma</button><button class="btn" data-pl-todas>Marcar visíveis</button><button class="btn" data-pl-nenhuma>Limpar</button>
      <span class="nota"><b>${w.sel.size}</b> selecionada(s) · ${ats.length} atividades no cronograma</span></div>
      <div class="tabela-rolagem pl-lista"><table class="pl-tab"><thead><tr><th></th><th>Atividade</th><th>Frente</th><th>Empresa</th><th class="n">Contrato</th><th class="n">Realizado</th><th class="n">Precisa realizar</th><th>Cronograma</th><th>Situação</th></tr></thead><tbody>` +
      (vis.length ? vis.map(a => `<tr class="${w.sel.has(a.chave) ? 'marcada' : ''} ${sobrepoe(a) ? '' : 'fora'}"><td><input type="checkbox" data-pl-marca="${esc(a.chave)}" ${w.sel.has(a.chave) ? 'checked' : ''}></td>
        <td><b>${esc(a.nome)}</b></td><td>${esc(cap(a.frente))}</td><td>${esc(a.empresas.join(' / ') || '—')}</td><td class="n">${plFmt(a.qtd, a.unidade)} ${esc(a.unidade)}</td><td class="n">${plFmt(a.realAc, a.unidade)}</td>
        <td class="n"><b>${plFmt(plSugestao(a, w.inicio, w.fim).precisa, a.unidade)}</b></td><td>${fd(a.ini)} a ${fd(a.prazo)}</td><td>${plFarol(a.status)}</td></tr>`).join('') : '<tr><td colspan="9" class="vazio">Nenhuma atividade encontrada.</td></tr>') +
      '</tbody></table></div><p class="nota">Linhas esmaecidas não têm nada a realizar no período (em dia ou concluídas); dá para marcá-las mesmo assim.</p>';
  } else {
    const itens = [...w.sel.values()];
    corpo = `<p class="nota">Preencha o 5W2H de cada atividade. O quê, onde, quem e a quantidade já vêm sugeridos do cronograma. A divisão por dia usa a meta/dia atual de cada atividade (ou a que você digitar) e, no painel, também o ritmo real.</p>
      <div class="barra-acoes"><button class="btn" data-pl-aplicar-periodo>Aplicar o período do plano a todas</button><span class="nota">${itens.length} atividade(s)</span></div><div class="pl-cartoes5">` +
      itens.map(it => { const a = plAtivPorChave(it.chave), k = esc(it.chave); const campo = (nome, rot, tipo = 'text', extra = '') => `<label>${rot}<input ${tipo === 'num' ? 'type="number" step="any" min="0"' : tipo === 'date' ? 'type="date"' : 'type="text" maxlength="500"'} data-pl-i="${nome}" data-k="${k}" value="${esc(it[nome] ?? '')}" ${extra}></label>`;
        return `<div class="pl-w5card" data-k="${k}"><div class="pl-w5cab"><b>${esc(it.atividade)}</b><span class="nota">${esc(cap(it.frente))}${a ? ` · contrato ${plFmt(a.qtd, a.unidade)} ${esc(a.unidade)} · realizado ${plFmt(a.realAc, a.unidade)} · saldo ${plFmt(Math.max(0, a.qtd - a.realAc), a.unidade)}` : ' · atividade não está mais no cronograma'}</span>
            <button class="btn-link" data-pl-remover="${k}" title="Tirar do planejamento">remover</button></div>
          <div class="pl-form5">${campo('o_que', '<span><b>What</b> — O quê</span>')}${campo('por_que', '<span><b>Why</b> — Por quê</span>')}${campo('onde', '<span><b>Where</b> — Onde</span>')}
            <div class="pl-quando"><label><span><b>When</b> — Início</span><input type="date" data-pl-i="inicio" data-k="${k}" value="${it.inicio}"></label><label><span>Fim</span><input type="date" data-pl-i="fim" data-k="${k}" value="${it.fim}"></label></div>
            ${campo('quem', '<span><b>Who</b> — Quem</span>')}${campo('como', '<span><b>How</b> — Como</span>')}
            <div class="pl-quanto"><label><span><b>How much</b> — Quantidade (${esc(it.unidade)})</span><input type="number" step="any" min="0" data-pl-i="qtd" data-k="${k}" value="${it.qtd}"></label>
              <label><span>Custo estimado (R$)</span><input type="number" step="any" min="0" data-pl-i="custo" data-k="${k}" value="${it.custo ?? ''}"></label><label><span>Meta/dia (${esc(it.unidade)}) <span class="nota">em branco = meta atual${a?.it?.meta_dia ? ': ' + plFmtTaxa(a.it.meta_dia) : ''}</span></span><input type="number" step="any" min="0" data-pl-i="meta_dia" data-k="${k}" value="${it.meta_dia ?? ''}"></label><label><span>Peso na curva S</span><input type="number" step="any" min="0.1" data-pl-i="peso" data-k="${k}" value="${it.peso ?? 1}"></label></div></div>
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
  if (!(n && it.qtd > 0)) return 'Informe datas e quantidade válidas.';
  const meta = plMeta(it, plAtivPorChave(it.chave), n), dias = Math.ceil(it.qtd / meta - 1e-9), un = esc(it.unidade);
  const fecha = meta * n >= it.qtd - 1e-9;
  return `Divisão por dia: <b>${plFmtTaxa(meta)} ${un} por dia útil</b> (${Number(it.meta_dia) > 0 ? 'meta digitada' : 'meta atual do cronograma'}) → ${plFmt(it.qtd, it.unidade)} ${un} em <b>${dias} dia(s) útil(eis)</b>; período tem ${n}. `
    + (fecha ? 'Cabe no período.' : `<span class="pl-erro">Não fecha: faltam ${plFmt(it.qtd - meta * n, it.unidade)} ${un}; precisa de ${plFmt(it.qtd / n, it.unidade)} ${un}/dia.</span>`);
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
    itens: [...w.sel.values()].map(i => ({ ...i, qtd: Number(i.qtd), peso: Number(i.peso) > 0 ? Number(i.peso) : 1, custo: i.custo === '' || i.custo == null ? null : Number(i.custo), meta_dia: Number(i.meta_dia) > 0 ? Number(i.meta_dia) : null })) };
  try {
    const r = await postar(API + 'planos', { plano });
    await plCarregar(true);
    PL.sel = r.id || w.id; PL.vista = 'resumo'; PL.atv = ''; PL.sub = 'planos';
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
  const sp = t.closest('[data-pl-sug-preset]');
  if (sp) { PL.sug.preset = sp.dataset.plSugPreset; PL.sug.sel = null; return renderPlanejamento(); }
  const sg = t.closest('[data-pl-sug-grupo]');
  if (sg) { PL.sug.grupo = sg.dataset.plSugGrupo; return renderPlanejamento(); }
  if (t.closest('[data-pl-sug-todas]')) { PL.sug.sel = null; return renderPlanejamento(); }
  if (t.closest('[data-pl-sug-nenhuma]')) { PL.sug.sel = new Set(); return renderPlanejamento(); }
  if (t.closest('[data-pl-sug-criar]')) return plCriarDaSugestao();
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
    plAtividades().filter(a => plSugestao(a, w.inicio, w.fim).precisa > 1e-9).forEach(a => { if (!w.sel.has(a.chave)) w.sel.set(a.chave, plItemPadrao(a, w)); });
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
  if (t.dataset.plSugData) {
    PL.sug.preset = 'livre'; PL.sug[t.dataset.plSugData] = t.value;
    if (ehISO(PL.sug.ini) && ehISO(PL.sug.fim) && PL.sug.fim >= PL.sug.ini) { PL.sug.sel = null; renderPlanejamento(); }
    return;
  }
  if (t.dataset.plSugMarca !== undefined) { t.checked ? PL.sug.sel.add(t.dataset.plSugMarca) : PL.sug.sel.delete(t.dataset.plSugMarca); return renderPlanejamento(); }
  if (t.dataset.plSugConcl !== undefined) { PL.sug.concl = t.checked; return renderPlanejamento(); }
  if (t.id === 'plAtv') { PL.atv = t.value; const pl = plPlano(PL.sel); if (pl) plDesenharCurva(pl, plCalc(pl)); return; }
  if (!w) return;
  if (t.dataset.plFrente !== undefined) { w.frente = t.value; plWizRender(); }
  if (t.dataset.plW && (t.dataset.plW === 'inicio' || t.dataset.plW === 'fim')) plWizRender();
});
document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && PL.wiz) plWizFechar(); });

// ---------------------------------------------------------------- PLANEJAMENTO DENTRO DO PAINEL (dashboard)
// O que foi planejado (planos 5W2H ativos que cruzam o período do Painel) × o que foi executado: curva S, % executado e situação por atividade.
// Também alimenta a coluna "Plano 5W2H" do Farol do período e os pontos de atenção.
PL.pp = { plano: '', atv: '' };
const plPlanosPainel = () => (PL.dados?.planos || []).filter(p => p.status !== 'concluido' && p.inicio <= per.fim && p.fim >= per.ini);
function plItemDaEmpresa(it, emp) {
  if (!emp) return true;
  const a = plAtivPorChave(it.chave);
  return (a?.empresas || []).includes(emp) || ganNorm(it.empresa || '').includes(ganNorm(emp));
}
function plPlanoCombinado(planos, emp) {
  const itens = planos.flatMap(p => p.itens.filter(it => plItemDaEmpresa(it, emp)).map(it => ({ ...it, _plano: { inicio: p.inicio, fim: p.fim }, _planoNome: p.nome })));
  if (!itens.length) return null;
  return { id: 'combinado', nome: planos.length > 1 ? 'Todos os planos ativos' : planos[0].nome, inicio: planos.map(p => p.inicio).sort()[0], fim: planos.map(p => p.fim).sort().pop(), itens };
}
// uma passada por renderização: calcula os planos ativos (cada um com a sua janela) e indexa as atividades
function plIndicePainel() {
  PL._atv = null;   // o cronograma depende do período/referência atuais
  const lista = [];
  plPlanosPainel().forEach(p => { const c = plCalc(p); c.itens.forEach(x => lista.push({ p, x, emps: x.ativ?.empresas || [] })); });
  PL._ix = lista;
  return lista;
}
function plCasaLinha(e, k) {   // atividade do plano ↔ linha de meta do Farol (empresa + serviço)
  const a = e.x.ativ;
  if (!a || !e.emps.includes(k.emp)) return false;
  const sa = ganNorm(a.it.servico), sk = ganNorm(k.serv);
  if (sa === sk || (ehTelhar(sa) && ehTelhar(sk))) return true;
  if (ehFrenteAnexa(a.it.frente)) return false;
  return servicoCompat(a.it.servico, k.serv);
}
function plResumoFarol(k) {   // célula "Plano 5W2H" da linha do Farol; null = serviço fora dos planos ativos
  const es = (PL._ix || []).filter(e => plCasaLinha(e, k));
  if (!es.length) return null;
  const qtd = soma0(es, e => e.x.it.qtd), plan = soma0(es, e => e.x.planAc), real = soma0(es, e => e.x.realAc);
  const ordem = ['ATRASADO', 'NO LIMITE', 'NO PRAZO', 'ADIANTADO', 'A INICIAR', 'CONCLUÍDO'];
  const st = es.map(e => e.x.status).sort((a, b) => ordem.indexOf(a) - ordem.indexOf(b))[0];
  return { n: es.length, qtd, plan, real, un: es[0].x.it.unidade, pctPlano: qtd ? real / qtd * 100 : 0, pctPrev: plan > 0 ? real / plan * 100 : null, st };
}
function plAlertasPainel() {
  const al = [];
  (PL._ix || []).filter(e => !painelEmpFiltro || e.emps.includes(painelEmpFiltro)).forEach(({ p, x }) => {
    if (x.status !== 'ATRASADO' && x.status !== 'NO LIMITE') return;
    const nivel = x.status === 'ATRASADO' ? 'vermelho' : 'amarelo';
    al.push([nivel, `<b>Plano ${esc(p.nome)} · ${esc(x.it.atividade)}</b>: executado ${nf(x.pctReal * 100, 0)}% do plano, previsto ${nf(x.pctPlan * 100, 0)}% até hoje (${x.status.toLowerCase()}). Falta ${plFmt(x.falta, x.it.unidade)} ${esc(x.it.unidade)}${x.ritmoNec != null ? ` — precisa de ${plFmtTaxa(x.ritmoNec)}/dia, ritmo atual ${plFmtTaxa(x.ritmoAtual)}/dia` : ''}.`]);
  });
  return al;
}
async function renderPainelPlanos() {
  const box = document.getElementById('painelPlanos');
  if (!box) return;
  const tk = PL._ppTk = (PL._ppTk || 0) + 1;
  if (!PL.dados || Date.now() - (PL._ts || 0) > 60000) {
    const antes = JSON.stringify(PL.dados?.planos || []);
    await plCarregar(true); PL._ts = Date.now();
    if (tk !== PL._ppTk) return;
    if (JSON.stringify(PL.dados.planos) !== antes) { renderPainel(); return; }   // planos mudaram: refaz Farol e alertas também
  }
  const planos = plPlanosPainel(), emp = painelEmpFiltro || '';
  const cab = `<div class="bloco-cab"><h2>Planejamento 5W2H — planejado × executado</h2><button class="btn" data-ir-aba="plan">Abrir Planejamento</button></div>`;
  if (!planos.length) {
    box.innerHTML = `${cab}<p class="nota">Nenhum planejamento 5W2H ativo no período de ${fdA(per.ini)} a ${fdA(per.fim)}. Crie em Planejamento → Sugestão do cronograma → “Criar planejamento”: a curva S e o % executado aparecem aqui.</p>`;
    return;
  }
  if (PL.pp.plano && !planos.some(p => p.id === PL.pp.plano)) PL.pp.plano = '';
  const sel = PL.pp.plano ? planos.filter(p => p.id === PL.pp.plano) : planos;
  const pl = plPlanoCombinado(sel, emp);
  const optsPl = `<option value="">Todos os planos ativos (${planos.length})</option>` + planos.map(p => `<option value="${esc(p.id)}" ${p.id === PL.pp.plano ? 'selected' : ''}>${esc(p.nome)} · ${fd(p.inicio)} a ${fd(p.fim)}</option>`).join('');
  if (!pl) { box.innerHTML = `${cab}<div class="barra-acoes"><label class="rot-sel">Plano <select id="ppPlano">${optsPl}</select></label></div><p class="nota">Nenhuma atividade de ${esc(emp)} nos planos ativos.</p>`; return; }
  const c = plCalc(pl), st = plStatusPlano(c);
  if (PL.pp.atv && !pl.itens.some(i => i.chave === PL.pp.atv)) PL.pp.atv = '';
  const optsAt = `<option value="">Todo o plano (ponderado)</option>` + pl.itens.map(i => `<option value="${esc(i.chave)}" ${PL.pp.atv === i.chave ? 'selected' : ''}>${esc(i.atividade)} · ${esc(cap(i.frente))}</option>`).join('');
  const tile = (rot, val, sub, cc) => `<div class="tile" style="--c:${cc}"><div class="rot"><span>${rot}</span></div><div class="val">${val}</div><div class="sub">${sub}</div></div>`;
  let h = `${cab}<div class="barra-acoes"><label class="rot-sel">Plano <select id="ppPlano">${optsPl}</select></label>
      <label class="rot-sel">Atividade <select id="ppAtv">${optsAt}</select></label>${plFarol(st)}
      <span class="nota">${fdA(pl.inicio)} a ${fdA(pl.fim)} · ${pl.itens.length} atividade(s) · executado até ${fdA(c.baseRef)}${emp ? ' · ' + esc(emp) : ''}</span></div>`;
  const xa = PL.pp.atv ? c.itens.find(i => i.it.chave === PL.pp.atv) : null;   // atividade escolhida: os cartões passam a ser dela
  const pPlan = xa ? xa.pctPlan * 100 : c.pctPlan, pReal = xa ? xa.pctReal * 100 : c.pctReal, desv = pReal - pPlan, falta = Math.max(0, 100 - pReal);
  const dRest = xa ? xa.diasRest : c.diasRest;
  h += '<div class="tiles">' +
    tile('Planejado até hoje', nf(pPlan, 1) + '%', xa ? esc(xa.it.atividade) : 'curva S do plano', 'var(--acento)') +
    tile('Executado', nf(pReal, 1) + '%', `desvio ${desv >= 0 ? '+' : ''}${nf(desv, 1)} p.p. sobre o planejado`, desv < -5 ? 'var(--vermelho)' : desv < -1 ? 'var(--amarelo)' : 'var(--verde)') +
    tile('Falta executar', nf(falta, 1) + '%', dRest ? `${nf(falta / dRest, 1)} p.p. por dia útil (${dRest} dias úteis)` : 'prazo encerrado', 'var(--fg3)') +
    (xa ? tile('Situação', plFarol(xa.status), `${plFmt(xa.realAc, xa.it.unidade)} de ${plFmt(xa.it.qtd, xa.it.unidade)} ${esc(xa.it.unidade)}`, 'var(--fg3)')
        : tile('Atividades', `${c.concl}/${pl.itens.length}`, `${c.atrasadas} atrasada(s)${c.terminaEm ? ' · no ritmo, termina em ' + fdA(c.terminaEm) : ''}`, c.atrasadas ? 'var(--vermelho)' : 'var(--verde)')) + '</div>';
  h += `<div class="grafico pl-grafico"><canvas id="gPainelPlano"></canvas></div>
    <p class="nota">Curva S: linha cheia = executado; tracejada = planejado (meta/dia de cada atividade); pontilhada = projeção no ritmo atual; cinza = ritmo necessário para fechar no prazo.</p>
    <div class="tabela-rolagem"><table class="pl-tab"><thead><tr><th>Atividade</th><th>Quem</th><th class="n">Plano</th><th class="n">Previsto até hoje</th><th class="n">Executado</th><th class="pl-prog">% do plano executado</th><th class="n">Meta/dia</th><th class="n">Necessário/dia</th><th>Situação</th></tr></thead><tbody>` +
    c.itens.map(x => `<tr><td><b>${esc(x.it.atividade)}</b><div class="nota">${fd(x.it.inicio)} a ${fd(x.it.fim)}${pl.id === 'combinado' && x.it._planoNome ? ' · ' + esc(x.it._planoNome) : ''}</div></td><td>${esc((x.ativ?.empresas || []).join(' / ') || x.it.empresa || '—')}</td>
      <td class="n">${plFmt(x.it.qtd, x.it.unidade)} ${esc(x.it.unidade)}</td><td class="n">${plFmt(x.planAc, x.it.unidade)}</td><td class="n"><b>${plFmt(x.realAc, x.it.unidade)}</b></td>
      <td class="pl-prog"><div class="pl-barra"><span class="plan" style="width:${nf(x.pctPlan * 100, 0)}%"></span><span class="real f-${PL_COR_STATUS[x.status] || 'pendente'}" style="width:${nf(x.pctReal * 100, 0)}%"></span></div><div class="nota">${nf(x.pctReal * 100, 0)}% executado de ${nf(x.pctPlan * 100, 0)}% previsto</div></td>
      <td class="n">${plFmtTaxa(x.meta)}</td><td class="n ${x.ritmoNec != null && x.ritmoAtual < x.ritmoNec ? 'valor-neg' : ''}">${x.ritmoNec != null ? plFmtTaxa(x.ritmoNec) : '—'}</td><td>${plFarol(x.status)}</td></tr>`).join('') + '</tbody></table></div>';
  box.innerHTML = h;
  plDesenharCurva(pl, c, 'gPainelPlano', PL.pp.atv);
}
document.addEventListener('change', ev => {
  const t = ev.target;
  if (t.id === 'ppPlano') { PL.pp.plano = t.value; PL.pp.atv = ''; renderPainelPlanos(); }
  else if (t.id === 'ppAtv') { PL.pp.atv = t.value; renderPainelPlanos(); }
});

