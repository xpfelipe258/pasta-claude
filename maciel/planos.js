'use strict';
// ------------------------------------------------------------------------------------------------
// PLANEJAMENTO 5W2H (aba Planejamento)
// Fluxo: Novo planejamento > período da execução > atividades (todas as do cronograma) > 5W2H de cada uma > painel.
// O plano guarda só o que foi planejado (período, atividades, 5W2H, quantidade e datas). O realizado, a curva S,
// o que falta e a divisão por dia são calculados aqui, ao abrir a tela, a partir da produção lançada.
// Depende de app.js: M, T, ref, ganLinhas, ganDataKey, ehFrenteAnexa, servicosDaFrente, ganBmPercentual,
// ganBmAtividadesEspecificas, diaUtil, add, contarDiasUteis, trocarGrafico, eixos, cor, nf, fd, fdA, esc, cap, toast, postar.
// ------------------------------------------------------------------------------------------------
const PL = { dados: null, carregando: false, sub: 'sug', qual: { tipo: '' }, sug: { preset: 'semana', ini: null, fim: null, grupo: 'atividade', concl: false, sel: null }, sel: null, vista: 'resumo', atv: '', dia: 'original', wiz: null, _atv: null };
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
    let ok = ehFrenteAnexa(it.frente) ? servicosDaFrente(e, it).length > 0 : e.servicos.some(s => servicoCompat(s.nome, it.servico) && servicoLancadoPermitido(s, it.servico, it.frente));
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
  try { ls = ganLinhas(plBase()); } finally { faseFiltro = f; }   // até a data de referência (não o fim do período da barra), senão lançamentos recentes ficam de fora
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
  // Realizado = só o produzido dentro do período do plano (início e fim do plano): nada do que foi feito antes entra, nem na Eclusa
  const it = it0, r0 = 0;
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
// Ritmo real da atividade: média por dia útil lançada na SEMANA ANTERIOR ao período (5 dias úteis imediatamente antes do início, só o que já
// foi lançado, ou seja, até a data de referência). Sem produção nessa semana, vale o ritmo dos últimos 5 dias úteis até a referência.
function plRitmoJanela(a, fimJanela) {
  const dias = [];
  for (let d = fimJanela, n = 0; dias.length < 5 && n < 40; d = add(d, -1), n++) if (diaUtil(d)) dias.push(d);
  if (!dias.length) return { v: 0, de: null, ate: null };
  if (!a._serie) a._serie = plSerieReal(a);
  const conj = new Set(dias);
  let t = 0;
  a._serie.forEach(([d, v]) => { if (conj.has(d)) t += v; });
  return { v: t / dias.length, de: dias[dias.length - 1], ate: dias[0] };
}
function plRitmoSugestao(a, ini, base) {
  const fimJ = minD(add(ini, -1), base);
  let j = plRitmoJanela(a, fimJ), origem = 'semana anterior';
  if (!(j.v > 0) && fimJ < base) { j = plRitmoJanela(a, base); origem = 'últimos 5 dias úteis até a referência'; }
  return { ...j, origem: j.v > 0 ? origem : 'sem produção na semana anterior' };
}
function plSugestao(a, ini, fim) {
  const base = plBase(), it = a.it, qtd = a.qtd, veI = add(ini, -1);
  const prevRef = prevCliente(it, base), P0 = prevCliente(it, veI), P1 = prevCliente(it, fim);
  const Rb = plRealAte(a, base), R0 = plRealAte(a, minD(veI, base));
  // Só o que está DENTRO do período: do início ao fim escolhidos (limitado à data de referência); o acumulado da obra fica só para o cálculo do saldo
  const fimPer = minD(fim, base), Rper = ini > base ? 0 : Math.max(0, plRealAte(a, fimPer) - R0);
  const prevPerRef = ini > base ? 0 : Math.max(0, prevCliente(it, fimPer) - P0);
  const precisa = Math.max(0, Math.min(qtd - Rb, P1 - Rb));
  const diasRest = fim > base ? contarDiasUteis(maxD(base, veI), fim) : 0;
  const rit = plRitmoSugestao(a, ini, base), porDia = diasRest > 0 ? precisa / diasRest : null;
  const fator = porDia > 1e-9 ? rit.v / porDia : null;   // ritmo real ÷ ritmo necessário (≥ 100% = o ritmo atual cobre o saldo)
  return { base, prevRef, P0, P1, Rb, R0, qtd, precisa, desvio: Rb - prevRef, atraso: Math.max(0, P0 - R0),
    previstoPeriodo: Math.max(0, P1 - P0), realPeriodo: Rper, prevPerRef, desvioPer: Rper - prevPerRef, metaPeriodo: Math.max(0, Math.min(qtd - R0, P1 - R0)),
    diasRest, porDia, concluida: Rb >= qtd - 1e-9,
    ritmo: rit.v, ritmoOrigem: rit.origem, ritmoDe: rit.de, ritmoAte: rit.ate, fator,
    reforcoPct: porDia > 1e-9 ? (rit.v > 0 ? Math.max(0, porDia / rit.v - 1) : Infinity) : 0,   // quanto o ritmo precisa subir
    diasExtra: precisa > 1e-9 && rit.v > 0 && diasRest > 0 ? Math.max(0, Math.ceil(precisa / rit.v - 1e-9) - diasRest) : null };   // dias úteis a mais no ritmo atual
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
// Mini-curva do saldo: previsto no cronograma (cinza tracejado), realizado (cheio), rumo necessário (amarelo pontilhado) e ritmo real mantido (cor do semáforo).
function plSugSpark(a, s, ini, fim) {
  const dias = plDias(ini, fim), n = dias.length, W = 96, H = 28;
  if (n < 2) return '';
  // tudo medido a partir do início do período (zero no 1º dia): só o que acontece dentro do período
  const q = Math.max(s.metaPeriodo, s.previstoPeriodo, s.realPeriodo, 1e-9);
  const y = v => (H - 2 - Math.min(1, Math.max(0, v / q)) * (H - 4)).toFixed(1), x = i => ((i / (n - 1)) * W).toFixed(1);
  const iB = dias.filter(d => d <= s.base).length - 1;
  const prev = dias.map((d, i) => `${x(i)},${y(Math.max(0, prevCliente(a.it, d) - s.P0))}`);
  const real = dias.filter(d => d <= s.base).map((d, i) => `${x(i)},${y(Math.max(0, plRealAte(a, d) - s.R0))}`);
  const p0 = iB >= 0 ? s.realPeriodo : 0;
  const rumo = [], rit = [];
  dias.forEach((d, i) => {
    if (i < Math.max(iB, 0)) return;
    const k = i - Math.max(iB, 0), rest = Math.max(1, n - 1 - Math.max(iB, 0));
    rumo.push(`${x(i)},${y(p0 + (s.metaPeriodo - p0) * k / rest)}`);
    rit.push(`${x(i)},${y(Math.min(q, p0 + s.ritmo * k))}`);
  });
  const c = s.fator == null ? 'fg3' : s.fator >= 1 ? 'verde' : s.fator >= .8 ? 'amarelo' : 'vermelho';
  const linha = (pts, est, extra = '') => (pts.length > 1 ? `<polyline points="${pts.join(' ')}" fill="none" style="${est}" ${extra}/>` : '');
  return `<svg class="pl-spark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img"><title>cinza = cronograma · verde = realizado · amarelo pontilhado = rumo necessário · ${s.fator == null ? 'cor' : 'linha colorida'} = ritmo real mantido</title>
    ${linha(prev, 'stroke:var(--fg3)', 'stroke-width="1" stroke-dasharray="3 2" opacity=".7"')}${linha(real, 'stroke:var(--verde)', 'stroke-width="2.4" stroke-linecap="round"')}
    ${linha(rumo, 'stroke:var(--amarelo)', 'stroke-width="1.8" stroke-dasharray="1.5 3" stroke-linecap="round"')}${linha(rit, `stroke:var(--${c})`, 'stroke-width="1.6" opacity=".9"')}</svg>`;
}
function plSugRitmoCelulas(a, s, ini, fim) {
  const un = a.unidade, temAcao = s.precisa > 1e-9, f = s.fator;
  const cls = !temAcao ? '' : f == null ? '' : f >= 1 ? 'f-verde' : f >= .8 ? 'f-amarelo' : 'f-vermelho';
  const orig = `${s.ritmoOrigem}${s.ritmoDe ? ' (' + fd(s.ritmoDe) + ' a ' + fd(s.ritmoAte) + ')' : ''}`;
  const reforco = !temAcao ? '—' : s.porDia == null ? '<span class="valor-neg">prazo vencido</span>'
    : s.ritmo <= 0 ? '<span class="valor-neg">sem produção na semana anterior</span>'
    : s.reforcoPct <= 1e-9 ? '<span class="valor-pos">ritmo atual cobre</span>'
    : `<b>+${nf(s.reforcoPct * 100, 0)}%</b> no ritmo${s.diasExtra ? `<div class="nota">ou +${s.diasExtra} dia(s) útil(eis) no ritmo atual</div>` : ''}`;
  return `<td class="n" title="${esc('Média por dia útil — ' + orig)}">${s.ritmo > 0 ? plFmtTaxa(s.ritmo) + ' ' + esc(un) + '/dia' : '<span class="nota">—</span>'}<div class="nota">${esc(s.ritmoOrigem)}</div></td>
    <td class="n">${temAcao && f != null ? `<span class="farol ${cls}">${nf(f * 100, 0)}%</span>` : '—'}</td><td class="n">${reforco}</td><td>${temAcao ? plSugSpark(a, s, ini, fim) : ''}</td>`;
}
function plSugLinhaHtml({ a, s }, g) {
  const un = a.unidade, marca = g.sel.has(a.chave), temAcao = s.precisa > 1e-9;
  const st = s.concluida ? 'CONCLUÍDO' : a.status;
  return `<tr class="${marca ? 'marcada' : ''}"><td><input type="checkbox" data-pl-sug-marca="${esc(a.chave)}" ${marca ? 'checked' : ''} ${temAcao ? '' : 'disabled title="Nada a realizar neste período"'}></td>
    <td><b>${esc(a.nome)}</b><div class="nota">${esc(cap(a.frente))} · cronograma ${fd(a.ini)} a ${fd(a.prazo)}</div>${plExcessoHtml(a)}</td><td>${esc(plQuem(a))}</td>
    <td class="n">${plFmt(a.qtd, un)} ${esc(un)}</td><td class="n">${plFmt(s.prevPerRef, un)}</td><td class="n"><button class="btn-link pl-audit-val" data-pl-audit="${esc(a.chave)}" data-ini="${g.ini}" data-fim="${g.fim}" title="Ver de onde vem este número">${plFmt(s.realPeriodo, un)}</button></td>
    <td class="n ${s.desvioPer < -1e-9 ? 'valor-neg' : ''}">${s.desvioPer > 0 ? '+' : ''}${plFmt(s.desvioPer, un)}</td><td class="n">${plFmt(s.previstoPeriodo, un)}</td>
    <td class="n pl-precisa ${temAcao ? '' : 'ok'}" title="Saldo para cumprir o cronograma até ${fdA(PL.sug.fim)}: previsto acumulado ${plFmt(s.P1, un)} − realizado acumulado na obra ${plFmt(s.Rb, un)}${s.atraso > 1e-9 ? ' (inclui atraso anterior ao período: ' + plFmt(s.atraso, un) + ')' : ''}">${temAcao ? `<b>${plFmt(s.precisa, un)}</b> ${esc(un)}${s.atraso > 1e-9 ? `<div class="nota">inclui ${plFmt(s.atraso, un)} de atraso anterior</div>` : ''}` : '—'}</td>
    <td class="n">${s.porDia != null && temAcao ? plFmtTaxa(s.porDia) + ' ' + esc(un) + '/dia' : temAcao ? '<span class="valor-neg">prazo do período vencido</span>' : '—'}</td>
    ${plSugRitmoCelulas(a, s, g.ini, g.fim)}<td>${plFarol(st)}</td></tr>`;
}
function plSugCurva(linhas, ini, fim) {
  const itens = linhas.map(l => l.a), dias = plDias(ini, fim), base = plBase();
  const pesoTot = soma0(itens, a => a.it.peso || 1) || 1;
  const pct = (fn, d) => soma0(itens, a => (a.it.peso || 1) * Math.min(1, fn(a, d) / (a.qtd || 1))) / pesoTot * 100;
  // curvas medidas só dentro do período: zero no dia anterior ao início, % do contrato de cada atividade
  const veI = add(ini, -1);
  const prev = dias.map(d => pct((a, x) => Math.max(0, prevCliente(a.it, x) - prevCliente(a.it, veI)), d));
  const real = dias.map(d => (d <= base ? pct((a, x) => Math.max(0, plRealAte(a, x) - plRealAte(a, minD(veI, base))), d) : null));
  const iB = dias.filter(d => d <= base).length - 1, rB = iB >= 0 ? real[iB] : 0, pF = prev[prev.length - 1];
  const alvo = linhas.length ? soma0(linhas, l => (l.a.it.peso || 1) * Math.min(1, l.s.metaPeriodo / (l.a.qtd || 1))) / pesoTot * 100 : pF;   // previsto no período + atraso anterior
  const meta = dias.map((d, i) => (i < iB ? null : iB < 0 ? (i === dias.length - 1 ? alvo : null) : i === iB ? rB : rB + (alvo - rB) * (i - iB) / Math.max(1, dias.length - 1 - iB)));
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
  return { prevRef: iB >= 0 ? prev[iB] : 0, realRef: rB, prevFim: pF, alvo };
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
  let h = plRascunhoBanner() + `<div class="pl-topo"><div><h2 class="pl-titulo">Sugestão de planejamento</h2><p class="nota">Montada sozinha a partir do cronograma: o que estava previsto, o que já foi realizado, o que precisa ser realizado no período e quem executa. Confira, marque o que entra e crie o planejamento 5W2H.</p></div>
    <button class="btn primario" data-pl-sug-criar ${g.sel.size ? '' : 'disabled'}>Criar planejamento com ${g.sel.size} selecionada(s)</button></div>
    <div class="bloco pl-sug-per"><div class="acoes"><b>Período</b><div class="seg" id="plSugPreset">${presets.map(([k, r]) => `<button data-pl-sug-preset="${k}" class="${g.preset === k ? 'ativa' : ''}">${r}</button>`).join('')}</div>
      <label class="rot-sel">de <input type="date" data-pl-sug-data="ini" value="${ini}"></label><label class="rot-sel">até <input type="date" data-pl-sug-data="fim" value="${fim}"></label>
      <span class="nota">${plDias(ini, fim).length} dias úteis · realizado até ${fdA(base)} (data de referência)</span></div></div>`;
  if (!linhas.length) {
    box.innerHTML = h + '<div class="bloco pl-vazio"><h3>Nada previsto para este período</h3><p>Nenhuma atividade do cronograma cai nestas datas. Escolha outro período.</p></div>';
    return;
  }
  h += `<div class="tiles" id="plSugTiles"></div>
    <div class="bloco"><div class="bloco-cab"><h2>Cronograma: previsto × realizado × o que precisa realizar</h2><span class="nota">Curva ponderada pelo peso das atividades listadas, só dentro do período: começa em zero no primeiro dia e soma apenas o que foi previsto e realizado a partir dele.</span></div><div class="grafico pl-grafico"><canvas id="gSugCurva"></canvas></div></div>`;
  h += `<div class="bloco"><div class="bloco-cab"><h2>O que fazer e quem faz</h2><div class="acoes">
    <div class="seg" id="plSugGrupo"><button data-pl-sug-grupo="atividade" class="${g.grupo === 'atividade' ? 'ativa' : ''}">Por atividade</button><button data-pl-sug-grupo="quem" class="${g.grupo === 'quem' ? 'ativa' : ''}">Por quem executa</button></div>
    <label class="check"><input type="checkbox" data-pl-sug-concl ${g.concl ? 'checked' : ''}> mostrar concluídas</label>
    <button class="btn" data-pl-sug-todas>Marcar as que precisam</button><button class="btn" data-pl-sug-nenhuma>Limpar</button></div></div>
    <p class="nota"><b>Realizado no período</b> = só a produção lançada de ${fdA(ini)} a ${fdA(minD(fim, base))} (início e fim do período escolhido); o que foi feito antes não entra. <b>Previsto no período</b> = o que o cronograma pedia dentro dessas mesmas datas. <b>Precisa realizar</b> = quanto o cronograma prevê acumulado até ${fdA(fim)} menos o que já foi realizado (nunca mais que o saldo do contrato); inclui o atraso acumulado. <b>Taxa necessária</b> = precisa realizar ÷ dias úteis que restam no período. <b>Ritmo real</b> = média por dia útil lançada na semana anterior ao período (sem produção nela, os últimos 5 dias úteis até a referência). <b>Ritmo ÷ necessário</b> mostra se o ritmo atual fecha o saldo; <b>Reforço</b> = quanto o ritmo precisa subir (ou quantos dias úteis a mais seriam necessários no ritmo atual).</p>
    <div class="tabela-rolagem"><table class="pl-tab pl-sug"><thead><tr><th></th><th>Atividade</th><th>Quem</th><th class="n">Contrato</th><th class="n" title="Previsto no cronograma entre ${fd(ini)} e ${fd(minD(fim, base))}">Previsto no período até ${fd(minD(fim, base))}</th><th class="n" title="Produção lançada de ${fd(ini)} a ${fd(minD(fim, base))} — só dentro do período">Realizado no período</th><th class="n">Desvio no período</th><th class="n" title="Previsto no cronograma entre ${fd(ini)} e ${fd(fim)}">Previsto no período todo</th><th class="n">Precisa realizar</th><th class="n" title="Precisa realizar ÷ dias úteis que restam no período">Taxa necessária</th><th class="n" title="Média por dia útil lançada na semana anterior ao período">Ritmo real (sem. anterior)</th><th class="n" title="Ritmo real ÷ taxa necessária: verde ≥ 100%, amarelo 80–100%, vermelho < 80%">Ritmo ÷ necessário</th><th class="n">Reforço necessário</th><th>Curva do saldo</th><th>Situação</th></tr></thead><tbody>`;
  if (g.grupo === 'quem') {
    const grupos = new Map();
    linhas.forEach(l => { const k = plQuem(l.a); if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(l); });
    [...grupos.entries()].sort((x, y) => y[1].filter(l => l.s.precisa > 1e-9).length - x[1].filter(l => l.s.precisa > 1e-9).length).forEach(([k, ls]) => {
      const n = ls.filter(l => l.s.precisa > 1e-9).length, at = ls.filter(l => !l.s.concluida && l.a.status === 'ATRASADO').length;
      h += `<tr class="pl-grp"><td colspan="15"><b>${esc(k)}</b> · ${ls.length} atividade(s) · ${n} com algo a realizar${at ? ` · <span class="valor-neg">${at} atrasada(s)</span>` : ''}</td></tr>` + ls.map(l => plSugLinhaHtml(l, g)).join('');
    });
  } else h += linhas.map(l => plSugLinhaHtml(l, g)).join('');
  h += '</tbody></table></div></div>';
  box.innerHTML = h;
  const r = plSugCurva(linhas, ini, fim), dev = r.realRef - r.prevRef;
  const tile = (rot, val, sub, cc) => `<div class="tile" style="--c:${cc}"><div class="rot"><span>${rot}</span></div><div class="val">${val}</div><div class="sub">${sub}</div></div>`;
  $('#plSugTiles').innerHTML = tile('Previsto no período até a referência', nf(r.prevRef, 1) + '%', `do contrato, entre ${fd(ini)} e ${fd(minD(fim, base))}`, 'var(--prev, var(--fg3))')
    + tile('Realizado no período', nf(r.realRef, 1) + '%', `só ${fd(ini)} a ${fd(minD(fim, base))} · desvio ${dev >= 0 ? '+' : ''}${nf(dev, 1)} p.p.`, dev < -5 ? 'var(--vermelho)' : dev < -1 ? 'var(--amarelo)' : 'var(--verde)')
    + tile('Previsto no período todo', nf(r.prevFim, 1) + '%', `faltam ${nf(Math.max(0, r.alvo - r.realRef), 1)} p.p. para a meta do período (com atraso anterior)`, 'var(--acento)')
    + tile('Com algo a realizar', `${acao.length}/${linhas.length}`, `${atras.length} atrasada(s)`, atras.length ? 'var(--vermelho)' : 'var(--verde)')
    + tile('Ritmo cobre o saldo', `${acao.filter(l => l.s.fator != null && l.s.fator >= 1).length}/${acao.length}`, `${acao.filter(l => l.s.fator != null && l.s.fator < .8).length} abaixo de 80% do necessário`, acao.some(l => l.s.fator != null && l.s.fator < .8) ? 'var(--vermelho)' : 'var(--verde)')
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
  if (!PL._rascTentado) { PL._rascTentado = true; const r = plRascunhoLer(); if (r && Date.now() - r.ts < 6 * 3600 * 1000) setTimeout(() => plRascunhoRetomar(true), 200); }   // reabriu a página no meio da edição: retoma o rascunho
  $('#segPlanSub').innerHTML = [['sug', 'Sugestão do cronograma'], ['planos', 'Planos 5W2H'], ['qual', 'Qualidade dos dados'], ['fluxo', 'Fluxo da obra'], ['legado', 'Setores e impacto logístico']]
    .map(([k, r]) => `<button data-pl-sub="${k}" class="${k === PL.sub ? 'ativa' : ''}">${r}</button>`).join('');
  $('#planoLegado').hidden = PL.sub !== 'legado';
  box.hidden = PL.sub === 'legado';
  if (PL.sub === 'legado') return renderPlanejamentoLegado();
  if (PL.sub === 'sug') { await plCarregar(); return renderSugestao(box); }
  if (PL.sub === 'qual') return renderQualidade(box);
  if (PL.sub === 'fluxo') return renderFluxoObra(box);
  if (!PL.dados) { box.innerHTML = '<p class="vazio">Carregando planejamentos…</p>'; await plCarregar(); }
  PL._atv = null;
  const planos = PL.dados.planos.slice().sort((a, b) => (b.inicio || '').localeCompare(a.inicio || ''));
  if (PL.sel && !plPlano(PL.sel)) PL.sel = null;
  if (!PL.sel && planos.length) PL.sel = planos[0].id;
  let h = plRascunhoBanner() + `<div class="pl-topo"><div><h2 class="pl-titulo">Planejamento 5W2H</h2><p class="nota">Escolha o período, as atividades e preencha o 5W2H: o painel mostra a curva S planejado × realizado, o que falta, a divisão por dia, o Gantt e a linha do tempo.</p></div>
    <button class="btn primario" data-pl-novo>+ Novo planejamento</button></div>`;
  if (!planos.length) {
    h += `<div class="bloco pl-vazio"><h3>Nenhum planejamento ainda</h3><p>Crie o primeiro: período da execução, atividades a executar e o 5W2H de cada uma.</p><button class="btn primario" data-pl-novo>+ Novo planejamento</button></div>`;
    box.innerHTML = h;
    return;
  }
  h += '<div class="pl-cartoes">' + planos.map(p => {
    if (p.status === 'rascunho' || !p.inicio || !p.fim || !Array.isArray(p.itens)) return `<button class="pl-cartao ${p.id === PL.sel ? 'sel' : ''}" data-pl-abrir="${esc(p.id)}"><div class="pl-cartao-topo"><b>${esc(p.nome)}</b><span class="farol f-pendente">RASCUNHO</span></div><div class="nota">${p.inicio ? fdA(p.inicio) : '—'} a ${p.fim ? fdA(p.fim) : '—'} · ${(p.itens || []).length} atividade(s)</div><div class="nota">Não entra nos painéis até ser publicado.</div></button>`;
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
  if (pl.status === 'rascunho' || !pl.inicio || !pl.fim || !Array.isArray(pl.itens)) {
    box.innerHTML = `<div class="bloco pl-cab"><div><h3>${esc(pl.nome)} <span class="farol f-pendente">RASCUNHO</span></h3><p class="nota">${pl.inicio ? fdA(pl.inicio) : '—'} a ${pl.fim ? fdA(pl.fim) : '—'} · ${(pl.itens || []).length} atividade(s)${pl.atualizado_em ? ' · salvo em ' + new Date(pl.atualizado_em).toLocaleString('pt-BR') : ''}${pl.atualizado_por ? ' por ' + esc(pl.atualizado_por) : ''}</p>
      <p class="nota">Planejamento ainda em preparo: não aparece no Painel nem na Projeção e não calcula curva S. Continue a edição e publique quando estiver pronto.</p></div>
      <div class="acoes"><button class="btn primario" data-pl-editar>Continuar editando</button><button class="btn perigo" data-pl-excluir>Excluir</button></div></div>`;
    return;
  }
  const c = plCalc(pl), st = plStatusPlano(c);
  const tile = (rot, val, sub, cc) => `<div class="tile" style="--c:${cc}"><div class="rot"><span>${rot}</span></div><div class="val">${val}</div><div class="sub">${sub}</div></div>`;
  const dRest = c.diasRest;
  let h = `<div class="bloco pl-cab"><div><h3>${esc(pl.nome)} ${plFarol(st)}</h3>
      <p class="nota">${fdA(pl.inicio)} a ${fdA(pl.fim)} · ${plDias(pl.inicio, pl.fim).length} dias úteis · ${pl.itens.length} atividade(s)${pl.responsavel ? ' · responsável: ' + esc(pl.responsavel) : ''} · realizado só dentro do período (${fdA(pl.inicio)} a ${fdA(minD(pl.fim, c.baseRef))})</p>
      ${pl.objetivo ? `<p class="pl-objetivo">${esc(pl.objetivo)}</p>` : ''}</div>
    <div class="acoes"><button class="btn" data-pl-editar>Editar planejamento</button><button class="btn primario" data-pl-doc>Baixar planejamento</button><button class="btn" data-pl-csv>Exportar CSV</button>
      <button class="btn" data-pl-status="${pl.status === 'concluido' ? 'ativo' : 'concluido'}">${pl.status === 'concluido' ? 'Reabrir' : 'Marcar concluído'}</button>
      <button class="btn perigo" data-pl-excluir>Excluir</button></div></div>`;
  h += '<div class="tiles">' +
    tile('Planejado até hoje', nf(c.pctPlan, 1) + '%', 'curva S do plano', 'var(--prev, var(--fg3))') +
    tile('Realizado no período', nf(c.pctReal, 1) + '%', `desvio ${c.desvio >= 0 ? '+' : ''}${nf(c.desvio, 1)} p.p.`, c.desvio < -5 ? 'var(--vermelho)' : c.desvio < -1 ? 'var(--amarelo)' : 'var(--verde)') +
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
    <div class="tabela-rolagem"><table class="pl-tab"><thead><tr><th>Atividade</th><th>Frente</th><th class="n">Plano</th><th class="n" title="Produção lançada dentro do período do plano">Realizado no período</th><th class="n">Falta</th><th class="n">Dias úteis</th>
      <th class="n">Meta/dia</th><th class="n">Necessário/dia</th><th class="n">Ritmo atual/dia</th><th class="n">Fecha em (meta)</th><th class="n">Fecha em (ritmo)</th><th class="pl-prog">Avanço</th><th>Situação</th></tr></thead><tbody>` +
    c.itens.map(x => `<tr data-pl-linha="${esc(x.it.chave)}"><td><b>${esc(x.it.atividade)}</b><div class="nota">${fd(x.it.inicio)} a ${fd(x.it.fim)}</div>${x.ativ ? plExcessoHtml(x.ativ) : ''}</td><td>${esc(cap(x.it.frente))}</td>
      <td class="n">${plFmt(x.it.qtd, x.it.unidade)} ${esc(x.it.unidade)}</td><td class="n"><button class="btn-link pl-audit-val" data-pl-audit="${esc(x.it.chave)}" data-ini="${pl.inicio}" data-fim="${pl.fim}" title="Ver de onde vem este número">${plFmt(x.realAc, x.it.unidade)}</button></td><td class="n"><b>${plFmt(x.falta, x.it.unidade)}</b></td>
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
  let q = sg.metaPeriodo > 1e-9 ? sg.metaPeriodo : Math.min(saldo > 0 ? saldo : a.qtd, meta * dias);   // meta do período = previsto + atraso (o que já saiu no período conta)
  q = plInteiro(a.unidade) ? Math.max(1, Math.round(q)) : +Math.max(.1, q).toFixed(1);
  const quem = plQuem(a) === 'Sem empresa definida' ? '' : plQuem(a);
  return { chave: a.chave, atividade: a.nome, frente: a.frente, empresa: quem, unidade: a.unidade, qtd_contrato: a.qtd, qtd: q, peso: dias, inicio: ini, fim,
    meta_dia: meta * dias >= q - 1e-9 ? null : +(q / dias).toFixed(3),   // em branco = acompanha a meta atual do cronograma
    o_que: `Executar ${a.nome}`,
    por_que: `Cronograma previa ${plFmt(sg.prevPerRef, a.unidade)} ${a.unidade} de ${fd(w.inicio)} até ${fd(minD(w.fim, sg.base))}; realizado no período ${plFmt(sg.realPeriodo, a.unidade)} (desvio ${sg.desvioPer >= 0 ? '+' : ''}${plFmt(sg.desvioPer, a.unidade)}${sg.atraso > 1e-9 ? '; atraso anterior ao período ' + plFmt(sg.atraso, a.unidade) : ''}). Previsto no período todo: ${plFmt(sg.previstoPeriodo, a.unidade)}.`,
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
      <div class="tabela-rolagem pl-lista"><table class="pl-tab"><thead><tr><th></th><th>Atividade</th><th>Frente</th><th>Empresa</th><th class="n">Contrato</th><th class="n" title="Produção lançada dentro do período do planejamento (início e fim escolhidos)">Realizado no período</th><th class="n">Precisa realizar</th><th>Cronograma</th><th>Situação</th></tr></thead><tbody>` +
      (vis.length ? vis.map(a => `<tr class="${w.sel.has(a.chave) ? 'marcada' : ''} ${sobrepoe(a) ? '' : 'fora'}"><td><input type="checkbox" data-pl-marca="${esc(a.chave)}" ${w.sel.has(a.chave) ? 'checked' : ''}></td>
        <td><b>${esc(a.nome)}</b></td><td>${esc(cap(a.frente))}</td><td>${esc(a.empresas.join(' / ') || '—')}</td><td class="n">${plFmt(a.qtd, a.unidade)} ${esc(a.unidade)}</td><td class="n">${plFmt(plSugestao(a, w.inicio, w.fim).realPeriodo, a.unidade)}</td>
        <td class="n"><b>${plFmt(plSugestao(a, w.inicio, w.fim).precisa, a.unidade)}</b></td><td>${fd(a.ini)} a ${fd(a.prazo)}</td><td>${plFarol(a.status)}</td></tr>`).join('') : '<tr><td colspan="9" class="vazio">Nenhuma atividade encontrada.</td></tr>') +
      '</tbody></table></div><p class="nota">Linhas esmaecidas não têm nada a realizar no período (em dia ou concluídas); dá para marcá-las mesmo assim.</p>';
  } else {
    const itens = [...w.sel.values()];
    corpo = `<p class="nota">Preencha o 5W2H de cada atividade. O quê, onde, quem e a quantidade já vêm sugeridos do cronograma. A divisão por dia usa a meta/dia atual de cada atividade (ou a que você digitar) e, no painel, também o ritmo real.</p>
      <div class="barra-acoes"><button class="btn" data-pl-aplicar-periodo>Aplicar o período do plano a todas</button><span class="nota">${itens.length} atividade(s)</span></div><div class="pl-cartoes5">` +
      itens.map(it => { const a = plAtivPorChave(it.chave), k = esc(it.chave); const campo = (nome, rot, tipo = 'text', extra = '') => `<label>${rot}<input ${tipo === 'num' ? 'type="number" step="any" min="0"' : tipo === 'date' ? 'type="date"' : 'type="text" maxlength="500"'} data-pl-i="${nome}" data-k="${k}" value="${esc(it[nome] ?? '')}" ${extra}></label>`;
        return `<div class="pl-w5card" data-k="${k}"><div class="pl-w5cab"><b>${esc(it.atividade)}</b><span class="nota">${esc(cap(it.frente))}${a ? ` · contrato ${plFmt(a.qtd, a.unidade)} ${esc(a.unidade)} · realizado no período ${plFmt(plSugestao(a, PL.wiz.inicio, PL.wiz.fim).realPeriodo, a.unidade)}` : ' · atividade não está mais no cronograma'}</span>
            <button class="btn-link" data-pl-remover="${k}" title="Tirar do planejamento">remover</button></div>
          <div class="pl-form5">${campo('o_que', '<span><b>What</b> — O quê</span>')}${campo('por_que', '<span><b>Why</b> — Por quê</span>')}${campo('onde', '<span><b>Where</b> — Onde</span>')}
            <div class="pl-quando"><label><span><b>When</b> — Início</span><input type="date" data-pl-i="inicio" data-k="${k}" value="${it.inicio}"></label><label><span>Fim</span><input type="date" data-pl-i="fim" data-k="${k}" value="${it.fim}"></label></div>
            ${plQuemSelect(it, a, k)}${campo('como', '<span><b>How</b> — Como</span>')}
            <div class="pl-quanto"><label><span><b>How much</b> — Quantidade (${esc(it.unidade)})</span><input type="number" step="any" min="0" data-pl-i="qtd" data-k="${k}" value="${it.qtd}"></label>
              <label><span>Custo estimado (R$)</span><input type="number" step="any" min="0" data-pl-i="custo" data-k="${k}" value="${it.custo ?? ''}"></label><label><span>Meta/dia (${esc(it.unidade)}) <span class="nota">em branco = meta atual${a?.it?.meta_dia ? ': ' + plFmtTaxa(a.it.meta_dia) : ''}</span></span><input type="number" step="any" min="0" data-pl-i="meta_dia" data-k="${k}" value="${it.meta_dia ?? ''}"></label>${plTaxaSelect(it, a, k)}<label><span>Peso na curva S</span><input type="number" step="any" min="0.1" data-pl-i="peso" data-k="${k}" value="${it.peso ?? 1}"></label></div></div>
          <div class="pl-prev nota" data-pl-prev="${k}">${plPrevTexto(it)}</div></div>`; }).join('') + '</div>';
  }
  m.innerHTML = `<div class="pl-modal" role="dialog" aria-modal="true" aria-label="${titulo}"><div class="pl-modal-cab"><h2>${titulo}</h2><button class="btn" data-pl-fechar>Fechar</button></div>
    <div class="pl-passos">${passos.map((p, i) => `<button data-pl-passo="${i + 1}" class="${w.passo === i + 1 ? 'ativo' : ''} ${w.passo > i + 1 ? 'feito' : ''}"><span>${i + 1}</span> ${p}</button>`).join('')}</div>
    <div class="pl-modal-corpo">${corpo}</div>
    <div class="pl-modal-pe"><span class="nota" id="plWizMsg"></span><div class="acoes">${w.passo > 1 ? '<button class="btn" data-pl-voltar>Voltar</button>' : ''}
      <button class="btn" data-pl-rascunho-salvar title="Guarda o que já foi preenchido no sistema, sem exigir quantidades e empresas; não entra nos painéis até ser publicado">Salvar como rascunho</button>
      ${w.passo < 3 ? '<button class="btn primario" data-pl-proximo>Próximo</button>' : `<button class="btn primario" data-pl-criar>${w.status === 'rascunho' ? 'Publicar planejamento' : w.id ? 'Salvar alterações' : 'Criar planejamento'}</button>`}</div></div></div>`;
  const alvo = m.querySelector('[data-pl-w="nome"]');
  if (alvo && !w.nome) alvo.focus();
  plRascunhoSalvar();
}
// Taxa por dia do item: escolher entre a taxa NECESSÁRIA para fechar a quantidade no período, o RITMO REAL (semana anterior) e a META do cronograma.
// Who — empresa(s) que executam a atividade (seleção obrigatória): uma ou mais das empresas da obra + "outra" (texto livre).
function plQuemLista(it) {
  const todas = M.empresas.map(e => e.nome), txt = ganNorm(it.empresa || '');
  const marcadas = todas.filter(n => txt.includes(ganNorm(n)));
  let resto = String(it.empresa || '');
  marcadas.forEach(n => { resto = resto.replace(new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), ''); });
  resto = resto.replace(/[\/,;+&]+/g, ' ').replace(/\s+/g, ' ').trim();
  return { todas, marcadas, outra: it._outra != null ? it._outra : resto };
}
function plQuemSelect(it, a, k) {
  const q = plQuemLista(it), sugeridas = a?.empresas || [];
  return `<div class="pl-quem" data-k="${k}"><span class="pl-quem-rot"><b>Who</b> — Empresa que executa <span class="pl-obrig">obrigatório</span></span>
    <div class="pl-quem-chips">${q.todas.map(n => `<label class="pl-chip ${q.marcadas.includes(n) ? 'on' : ''}" title="${sugeridas.includes(n) ? 'Executa esta atividade na grade de lançamentos' : ''}"><input type="checkbox" data-pl-quem="${esc(n)}" data-k="${k}" ${q.marcadas.includes(n) ? 'checked' : ''}> ${esc(n)}${sugeridas.includes(n) ? ' <span class="nota">•</span>' : ''}</label>`).join('')}
      <label class="pl-chip-outra">outra: <input type="text" maxlength="60" data-pl-quem-outra data-k="${k}" value="${esc(q.outra)}" placeholder="empresa/equipe"></label></div></div>`;
}
function plQuemAplicar(it, antes) {   // grava no item a escolha (empresa e quem); antes = valor anterior de empresa
  const q = plQuemLista(it), nomes = [...q.marcadas, ...(it._outra ? [it._outra.trim()] : [])].filter(Boolean);
  it.empresa = nomes.join(' / ');
  if (!it.quem || it.quem === antes) it.quem = it.empresa;   // "quem" acompanha a empresa enquanto não foi personalizado
}
function plTaxasItem(it, a) {
  const n = it.inicio && it.fim && it.fim >= it.inicio ? plDias(it.inicio, it.fim).length : 0;
  const nec = n && it.qtd > 0 ? it.qtd / n : 0;
  const rit = a && it.inicio ? plRitmoSugestao(a, it.inicio, plBase()) : { v: 0, origem: '' };
  const meta = a ? (Number(a.it.meta_dia) || a.qtd / Math.max(1, contarDiasUteis(add(a.ini || it.inicio, -1), a.prazo || it.fim))) : 0;
  return { nec, rit: rit.v, ritOrigem: rit.origem, meta };
}
function plTaxaSelect(it, a, k) {
  const t = plTaxasItem(it, a), un = esc(it.unidade);
  const atual = Number(it.meta_dia) > 0 ? Number(it.meta_dia) : null;
  const sel = v => (atual != null && Math.abs(atual - v) < 0.0005 ? 'selected' : '');
  return `<label><span>Taxa por dia — escolher</span><select data-pl-taxa data-k="${k}">
    <option value="">Escolher…</option>
    <option value="nec" ${sel(t.nec)} ${t.nec > 0 ? '' : 'disabled'}>Necessária para fechar: ${plFmtTaxa(t.nec)} ${un}/dia</option>
    <option value="rit" ${sel(t.rit)} ${t.rit > 0 ? '' : 'disabled'}>Ritmo real (${esc(t.ritOrigem || 'sem produção')}): ${t.rit > 0 ? plFmtTaxa(t.rit) : '—'} ${un}/dia</option>
    <option value="meta" ${atual == null ? 'selected' : ''} ${t.meta > 0 ? '' : 'disabled'}>Meta do cronograma: ${plFmtTaxa(t.meta)} ${un}/dia</option></select></label>`;
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
// Rascunho do assistente: o que está sendo digitado fica guardado neste navegador até salvar ou descartar de propósito;
// recarregar a página (ex.: versão nova do programa) não perde mais o trabalho.
const PL_RASC = 'obra198_plano_rascunho';
function plRascunhoSalvar() {
  clearTimeout(plRascunhoSalvar._t);
  plRascunhoSalvar._t = setTimeout(() => {
    const w = PL.wiz;
    if (!w) return;
    try { localStorage.setItem(PL_RASC, JSON.stringify({ ts: Date.now(), w: { ...w, sel: [...w.sel.entries()] } })); } catch { /* sem armazenamento */ }
  }, 300);
}
function plRascunhoLer() {
  try {
    const r = JSON.parse(localStorage.getItem(PL_RASC) || 'null');
    if (!r || !r.w || !Array.isArray(r.w.sel) || !r.w.sel.length) return null;
    return r;
  } catch { return null; }
}
function plRascunhoLimpar() { clearTimeout(plRascunhoSalvar._t); try { localStorage.removeItem(PL_RASC); } catch { /* sem armazenamento */ } }
function plRascunhoRetomar(auto) {
  const r = plRascunhoLer();
  if (!r || PL.wiz) return false;
  PL.wiz = { ...r.w, sel: new Map(r.w.sel), _sujo: true };
  plWizRender();
  toast(auto ? 'Planejamento em edição retomado (rascunho não salvo).' : 'Rascunho retomado.', false, 5000);
  return true;
}
function plRascunhoBanner() {
  const r = plRascunhoLer();
  if (!r || PL.wiz) return '';
  return `<div class="faixa pl-rascunho"><b>Planejamento em edição não salvo</b> — “${esc(r.w.nome || 'sem nome')}”, ${r.w.sel.length} atividade(s), guardado em ${new Date(r.ts).toLocaleString('pt-BR')}.
    <button class="btn" data-pl-rasc-retomar>Retomar</button> <button class="btn" data-pl-rasc-descartar>Descartar rascunho</button></div>`;
}
// fecha o assistente; com alterações pede confirmação (nunca perde o que foi digitado por clique acidental)
function plWizFechar(forcar) {
  const w = PL.wiz;
  if (w && w._sujo && !forcar && !confirm('Fechar o planejamento sem salvar? O que você preencheu fica guardado como rascunho neste navegador.')) return false;
  if (forcar || !(w && w._sujo)) plRascunhoLimpar();
  document.getElementById('plModal')?.remove(); PL.wiz = null;
  return true;
}
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
      if (!String(it.empresa || '').trim()) return `${it.atividade}: selecione a empresa que irá executar (Who).`;
    }
  }
  return '';
}
// rascunho = true: salva no sistema o que já foi preenchido (só nome e período são obrigatórios) com status "rascunho"; fora dos painéis até ser publicado.
async function plWizSalvar(rascunho) {
  const w = PL.wiz, erro = rascunho ? plWizValidar(1) : plWizValidar(3);
  if (erro) return plWizMsg(erro, true);
  const status = rascunho ? 'rascunho' : (w.status === 'rascunho' ? 'ativo' : w.status);   // publicar um rascunho o torna ativo
  const plano = { id: w.id || '', nome: w.nome.trim(), inicio: w.inicio, fim: w.fim, responsavel: w.responsavel.trim(), objetivo: w.objetivo.trim(), status,
    itens: [...w.sel.values()].map(i => ({ ...i, qtd: Number(i.qtd) || 0, peso: Number(i.peso) > 0 ? Number(i.peso) : 1, custo: i.custo === '' || i.custo == null ? null : Number(i.custo), meta_dia: Number(i.meta_dia) > 0 ? Number(i.meta_dia) : null })) };
  try {
    const r = await postar(API + 'planos', { plano });
    await plCarregar(true);
    PL.sel = r.id || w.id; PL.vista = 'resumo'; PL.atv = ''; PL.sub = 'planos';
    plWizFechar(true);
    toast(rascunho ? 'Rascunho salvo ' + ONDE + ' — continue quando quiser em Planos 5W2H.' : 'Planejamento salvo ' + ONDE);
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

// ---------------------------------------------------------------- auditoria: de onde vem o realizado
// Clicar no número "Realizado no período" abre uma janela com a origem dele: colunas lançadas na grade (empresa, coluna, frente), atividades e
// apontamentos do catálogo do BM, os dias com lançamento e a regra que o sistema aplicou. Só mostra o que está DENTRO do período.
function plOrigemRealizado(a, ini, fim, todas) {
  const it = a.it, base = plBase(), lim = minD(fim, base), dentro = d => d >= ini && d <= lim;
  const fontes = ganServicosFonte(it), grade = [], bm = [];
  M.empresas.forEach(e => {
    const cols = it._eclusa || ehFrenteAnexa(it.frente) ? servicosDaFrente(e, it)
      : (e.servicos || []).filter(s => fontes.some(f => ganServicoCombina(f, s.nome) && servicoLancadoPermitido(s, f, it.frente)));
    cols.forEach(s => {
      const f = it._eclusa && eclusaTipoServico(s.nome) === 'junta' ? eclusaFracao(it._eclusa) : 1;
      let per = 0, ac = 0;
      const dias = [];
      Object.keys(e.registros || {}).sort().forEach(d => {
        const v = e.registros[d].v[s.col];
        if (typeof v !== 'number' || !(v > 0) || d > base) return;
        ac += v * f;
        if (dentro(d)) { per += v * f; dias.push(d); }
      });
      if (per || ac || todas) grade.push({ empresa: e.nome, coluna: s.nome, col: s.col, frente: s.frente, per, ac, dias, junta: f !== 1 });
    });
  });
  const ats = it._eclusa ? bmTab('bm_atividades').filter(x => eclusaCodigos(it._eclusa).includes(x.codigo))
    : ehFrenteAnexa(it.frente) || ganBmAtividadesEspecificas(it).length ? ganBmAtividadesEspecificas(it) : ganBmAtividades(it);   // anexo: só as atividades do BM da própria frente (como plSerieReal)
  ats.forEach(at => {
    let per = 0, ac = 0;
    const dias = [];
    bmTab('bm_apontamentos').forEach(x => {
      if (x.empresa !== at.empresa || x.codigo !== at.codigo || !x.data || x.data > base || !((Number(x.quantidade) || 0) > 0)) return;
      ac += Number(x.quantidade);
      if (dentro(x.data)) { per += Number(x.quantidade); dias.push(x.data); }
    });
    if (per || ac || todas) bm.push({ empresa: at.empresa, codigo: at.codigo, atividade: `${at.item_desc || ''} — ${at.atividade || ''}`, un: at.unidade || '', per, ac, dias: dias.sort() });
  });
  const usado = soma0(plSerieReal(a).filter(([d]) => dentro(d)), ([, v]) => v);
  const regra = it._eclusa ? 'Eclusa – vigas/joists: vale o MAIOR entre as colunas de vigas/joists lançadas na grade e os apontamentos do catálogo do BM (EJ-3.3.1-01 / -03); nunca a soma das duas fontes.'
    : it.bm_percentual ? 'Item em %: vale o avanço das atividades do BM da frente (Eclusa), ponderado pelo peso de cada atividade.'
    : ehFrenteAnexa(it.frente) ? 'Frente anexa: só contam colunas da própria frente (e atividades do BM dela). Produção do galpão ou de outro anexo com nome parecido NÃO entra.'
    : 'Galpão: vale a maior fonte entre lançamentos da grade + BM por atividade, resumo do BM e apontamentos de montagem (nunca a soma entre fontes). Colunas e atividades do BM de anexos (Eclusa, Portaria, Marquise…) NÃO entram.';
  return { a, ini, lim, grade, bm, usado, regra, gradeTot: soma0(grade, g => g.per), bmTot: soma0(bm, b => b.per) };
}
// Lançado acima do contrato: a série das fases corta no contrato (o excedente some), então o excesso só aparece olhando o lançamento bruto
// (grade e BM) de toda a obra. Compara com o contrato somado das fases do mesmo serviço (fase 1 + fase 2); itens em % ficam de fora.
function plExcessos() {
  const ats = plAtividades();
  if (PL._exc && PL._exc.atv === ats) return PL._exc.mapa;
  const grupos = new Map(), mapa = new Map();
  ats.filter(a => !a.it.bm_percentual).forEach(a => {
    const k = (ehFrenteAnexa(a.it.frente) ? ganNorm(a.frente) + '|' : '') + ganNorm(a.it.servico);
    const g = grupos.get(k) || { qtd: 0, itens: [] };
    g.qtd += a.qtd; g.itens.push(a); grupos.set(k, g);
  });
  grupos.forEach(g => {
    const os = g.itens.map(a => plOrigemRealizado(a, '2000-01-01', '2099-12-31'));
    const grade = Math.max(...os.map(o => o.gradeTot)), bm = Math.max(...os.map(o => o.bmTot));
    const lanc = Math.max(grade, bm);
    if (g.qtd > 0 && lanc > g.qtd * 1.02 + 1e-9) g.itens.forEach(a => mapa.set(a.chave, { lancado: lanc, contrato: g.qtd, fonte: grade >= bm ? 'grade' : 'BM', fases: g.itens.length > 1 }));
  });
  PL._exc = { atv: ats, mapa };
  return mapa;
}
const plExcessoHtml = (a, ini = '2000-01-01', fim = '2099-12-31') => {
  const e = plExcessos().get(a.chave);
  return e ? `<div class="nota valor-neg"><button class="btn-link pl-audit-val" data-pl-audit="${esc(a.chave)}" data-ini="${ini}" data-fim="${fim}" title="Ver de onde vem o lançamento">⚠ lançado ${plFmt(e.lancado, a.unidade)} ${esc(a.unidade)} (${e.fonte}) > contrato ${plFmt(e.contrato, a.unidade)}${e.fases ? ' (fases somadas)' : ''}</button></div>` : '';
};
// ---------------------------------------------------------------- qualidade dos dados
// Reúne o que costuma quebrar o realizado: lançado acima do contrato, grade × BM divergentes, colunas lançadas que não alimentam nenhuma atividade,
// atividades sem nenhuma fonte de lançamento ligada e apontamentos do BM sem atividade no cronograma.
function plQualidade() {
  const ats = plAtividades(), itens = [], usadasGrade = new Set(), usadasBm = new Set(), grupos = new Map();
  const origens = ats.map(a => ({ a, o: plOrigemRealizado(a, '2000-01-01', '2099-12-31', true) }));
  origens.forEach(({ a, o }) => {
    o.grade.forEach(g => usadasGrade.add(g.empresa + '|' + g.col));
    o.bm.forEach(b => usadasBm.add(b.empresa + '|' + b.codigo));
    if (a.it.bm_percentual) return;
    const k = (ehFrenteAnexa(a.it.frente) ? ganNorm(a.frente) + '|' : '') + ganNorm(a.it.servico);
    const g = grupos.get(k) || { qtd: 0, grade: 0, bm: 0, itens: [] };
    g.qtd += a.qtd; g.grade = Math.max(g.grade, o.gradeTot); g.bm = Math.max(g.bm, o.bmTot); g.itens.push(a); grupos.set(k, g);
  });
  const sev = { alta: 0, media: 1, baixa: 2 };
  grupos.forEach(g => {
    const a = g.itens[0], un = a.unidade, lanc = Math.max(g.grade, g.bm), nome = g.itens.map(x => x.nome + ' · ' + cap(x.frente)).join(' + ');
    if (g.qtd > 0 && lanc > g.qtd * 1.02 + 1e-9)
      itens.push({ sev: 'alta', tipo: 'Lançado acima do contrato', alvo: nome, chave: a.chave, chaves: g.itens.map(x => x.chave), det: `lançado ${plFmt(lanc, un)} ${un} (${g.grade >= g.bm ? 'grade' : 'BM'}) > contrato ${plFmt(g.qtd, un)} ${un}${g.itens.length > 1 ? ' (fases somadas)' : ''}; o sistema corta no contrato`, como: 'Conferir lançamentos duplicados, unidade (m² × telhas) ou o contrato do cronograma.' });
    if (g.grade > 1e-9 && g.bm > 1e-9 && Math.abs(g.grade - g.bm) / Math.max(g.grade, g.bm) > .10)
      itens.push({ sev: 'alta', tipo: 'Grade × BM divergentes', alvo: nome, chave: a.chave, chaves: g.itens.map(x => x.chave), det: `grade ${plFmt(g.grade, un)} ${un} × BM ${plFmt(g.bm, un)} ${un} (${nf(Math.abs(g.grade - g.bm) / Math.max(g.grade, g.bm) * 100, 0)}% de diferença); vale o maior, nunca a soma`, como: 'Alinhar o apontamento do BM com o lançamento da grade.' });
  });
  origens.forEach(({ a, o }) => {
    if (!o.grade.length && !o.bm.length && !a.it.bm_percentual)
      itens.push({ sev: 'baixa', tipo: 'Atividade sem fonte de lançamento', alvo: `${a.nome} · ${cap(a.frente)}`, chave: a.chave, chaves: [a.chave], det: 'nenhuma coluna da grade nem atividade do catálogo do BM está ligada: nunca receberá realizado', como: 'Criar/renomear a coluna da empresa ou ligar a atividade ao catálogo do BM.' });
  });
  const base = plBase();
  M.empresas.forEach(e => (e.servicos || []).forEach(sv => {
    if (usadasGrade.has(e.nome + '|' + sv.col)) return;
    let t = 0;
    Object.keys(e.registros || {}).forEach(d => { const v = e.registros[d].v[sv.col]; if (typeof v === 'number' && v > 0 && d <= base) t += v; });
    if (t > 0) itens.push({ sev: 'media', tipo: 'Coluna lançada sem atividade', alvo: `${e.nome} · ${sv.nome}`, det: `${plFmt(t, '')} lançados na frente ${cap(sv.frente || '—')} não alimentam nenhuma atividade do cronograma`, como: 'Se for produção de cronograma, ligar à atividade (nome da coluna); se for apoio, ignorar.' });
  }));
  bmTab('bm_atividades').forEach(at => {
    if (usadasBm.has(at.empresa + '|' + at.codigo)) return;
    let t = 0;
    bmTab('bm_apontamentos').forEach(x => { if (x.empresa === at.empresa && x.codigo === at.codigo && x.data && x.data <= base) t += Number(x.quantidade) || 0; });
    if (t > 0) itens.push({ sev: 'media', tipo: 'Apontamento do BM sem atividade', alvo: `${at.empresa} · ${at.codigo} — ${at.item_desc || ''} ${at.atividade || ''}`, det: `${plFmt(t, '')} ${at.unidade || ''} apontados no BM não entram em nenhuma atividade do cronograma`, como: 'Ligar a atividade do catálogo ao cronograma (nome do serviço).' });
  });
  return itens.sort((x, y) => sev[x.sev] - sev[y.sev] || x.tipo.localeCompare(y.tipo) || x.alvo.localeCompare(y.alvo));
}
// Pendências que afetam as atividades dos planos informados (as de coluna/apontamento sem atividade não têm chave e ficam de fora)
function plQualidadeDosPlanos(planos) {
  const ch = new Set((planos || []).flatMap(p => (p.itens || []).map(i => i.chave)));
  return plQualidade().filter(i => (i.chaves || []).some(k => ch.has(k)));
}
function plSeloQualidade(itens, comLink) {
  const n = s => itens.filter(i => i.sev === s).length;
  const ver = comLink ? ' <button class="btn-link pl-audit-val" data-pl-ir-qual>ver pendências</button>' : '';
  if (!itens.length) return `<span class="farol f-verde" title="Nenhuma pendência de dados nas atividades deste plano">DADOS CONSISTENTES</span>${comLink ? ver : ''}`;
  return `<span class="farol f-${n('alta') ? 'vermelho' : n('media') ? 'amarelo' : 'pendente'}" title="Pendências de dados que afetam estas atividades">${itens.length} PENDÊNCIA(S) DE DADOS</span> <span class="nota">${n('alta')} alta(s) · ${n('media')} média(s) · ${n('baixa')} baixa(s)</span>${ver}`;
}
function renderQualidade(box) {
  PL._atv = null;
  const itens = plQualidade(), n = s => itens.filter(i => i.sev === s).length, tipos = [...new Set(itens.map(i => i.tipo))];
  const tile = (rot, val, sub, cc) => `<div class="tile" style="--c:${cc}"><div class="rot"><span>${rot}</span></div><div class="val">${val}</div><div class="sub">${sub}</div></div>`;
  const filtro = PL.qual.tipo, vis = itens.filter(i => !filtro || i.tipo === filtro);
  box.innerHTML = plRascunhoBanner() + `<div class="pl-topo"><div><h2 class="pl-titulo">Qualidade dos dados</h2><p class="nota">Tudo que pode distorcer o realizado e o planejamento, reunido num lugar só. Corrija a origem (lançamento, BM ou cronograma) antes de decidir. Dados até ${fdA(plBase())} (data de referência).</p></div></div>
    <div class="tiles">${tile('Gravidade alta', n('alta'), 'lançado acima do contrato e grade × BM', n('alta') ? 'var(--vermelho)' : 'var(--verde)')}${tile('Gravidade média', n('media'), 'colunas e apontamentos sem atividade', n('media') ? 'var(--amarelo)' : 'var(--verde)')}${tile('Gravidade baixa', n('baixa'), 'atividades sem fonte de lançamento', n('baixa') ? 'var(--fg3)' : 'var(--verde)')}</div>
    <div class="bloco"><div class="bloco-cab"><h2>Pendências (${vis.length})</h2><label class="rot-sel">Tipo <select data-pl-qual-tipo><option value="">Todos</option>${tipos.map(t => `<option ${t === filtro ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label></div>` +
    (vis.length ? `<div class="tabela-rolagem"><table class="pl-tab"><thead><tr><th>Gravidade</th><th>Tipo</th><th>Onde</th><th>O que acontece</th><th>Como corrigir</th><th></th></tr></thead><tbody>` +
      vis.map(i => `<tr><td><span class="farol f-${i.sev === 'alta' ? 'vermelho' : i.sev === 'media' ? 'amarelo' : 'pendente'}">${i.sev.toUpperCase()}</span></td><td>${esc(i.tipo)}</td><td><b>${esc(i.alvo)}</b></td><td>${esc(i.det)}</td><td class="nota">${esc(i.como)}</td>
        <td>${i.chave ? `<button class="btn" data-pl-audit="${esc(i.chave)}" data-ini="2000-01-01" data-fim="2099-12-31">Ver origem</button>` : ''}</td></tr>`).join('') + '</tbody></table></div>'
      : '<p class="vazio">Nenhuma pendência. Os dados estão consistentes.</p>') + '</div>';
}

// ---------------------------------------------------------------- fluxo da obra: dependências entre as etapas (editável)
// O relatório do planejamento, a cascata de impactos e as perguntas de liberação seguem estas dependências (padrão em planos_doc.js).
function renderFluxoObra(box) {
  const nome = (f, id) => pldEtapa(f, id).nome;
  const bloco = fluxo => {
    const et = PLD_FLUXOS[fluxo].etapas, lay = pldLayout(fluxo, et.map(e => e.id));
    const linhas = et.map((e, k) => {
      const deps = pldDeps(fluxo, e.id), pers = pldDepsPersonalizadas(fluxo, e.id), suc = pldSuc(fluxo, e.id);
      const chips = et.filter(o => o.id !== e.id).map(o => {
        const ciclo = pldAnc(fluxo, o.id).includes(e.id);   // o já depende desta etapa: marcar criaria um ciclo
        return `<label class="pl-chip ${deps.includes(o.id) ? 'on' : ''}" title="${ciclo ? 'Criaria um ciclo: esta etapa já espera por ' + esc(e.nome) : esc(o.nome)}"><input type="checkbox" data-fx-dep data-fluxo="${fluxo}" data-id="${e.id}" data-dep="${o.id}" ${deps.includes(o.id) ? 'checked' : ''} ${ciclo ? 'disabled' : ''}> ${esc(o.nome)}</label>`;
      }).join('');
      const diretos = et.filter(o => pldDeps(fluxo, o.id).includes(e.id)).map(o => o.nome);
      return `<tr><td class="n">${k + 1}</td><td><b>${esc(e.nome)}</b><div class="nota">${lay.main.includes(e.id) ? 'cadeia principal' : '<b>ramo independente</b>'}</div></td><td><div class="pl-chips">${chips}</div></td>
        <td class="nota">${diretos.length ? esc(diretos.join(' · ')) : '—'}${suc.length > diretos.length ? `<div class="nota">+ ${suc.length - diretos.length} indireta(s)</div>` : ''}</td>
        <td>${pers ? `<span class="farol f-amarelo">PERSONALIZADA</span> <button class="btn" data-fx-reset data-fluxo="${fluxo}" data-id="${e.id}">Restaurar padrão</button>` : '<span class="nota">padrão</span>'}</td></tr>`;
    }).join('');
    const ramos = lay.grupos.map(g => g.ids.map(id => nome(fluxo, id)).join(' › ')).join(' | ') || 'nenhum';
    return `<div class="bloco"><div class="bloco-cab"><h2>${esc(PLD_FLUXOS[fluxo].nome)}</h2><button class="btn" data-fx-reset-tudo data-fluxo="${fluxo}">Restaurar o padrão deste fluxo</button></div>
      <p class="nota"><b>Cadeia principal:</b> ${esc(lay.main.map(id => nome(fluxo, id)).join(' › '))}<br><b>Ramos independentes:</b> ${esc(ramos)}</p>
      <div class="tabela-rolagem"><table class="pl-tab pl-fluxo"><thead><tr><th>#</th><th>Etapa</th><th>Depende de (marque o que ela espera)</th><th>Empurra diretamente</th><th>Situação</th></tr></thead><tbody>${linhas}</tbody></table></div></div>`;
  };
  box.innerHTML = plRascunhoBanner() + `<div class="pl-topo"><div><h2 class="pl-titulo">Fluxo da obra</h2><p class="nota">Defina de quais etapas cada etapa depende. Etapa que depende só de chegada e descarga do material vira ramo independente: não espera checklist nem cobertura, não é empurrada pela cadeia principal e só empurra o que depende dela. A mudança vale para todos e já é aplicada no relatório do planejamento, nas perguntas de liberação e no efeito cascata dos impactos.</p></div></div>` + bloco('galpao') + bloco('anexo');
}
async function fxSalvar(fluxo, id, deps) {   // deps = lista nova, ou null para restaurar o padrão da etapa; id vazio = restaura o fluxo todo
  const cfg = JSON.parse(JSON.stringify(M.fluxo_config || {}));
  if (!id) delete cfg[fluxo];
  else {
    cfg[fluxo] = cfg[fluxo] || {};
    const pad = (PLD_DEP_PADRAO[fluxo][id] || []).slice().sort().join(',');
    if (deps === null || deps.slice().sort().join(',') === pad) delete cfg[fluxo][id];
    else cfg[fluxo][id] = { dep: deps };
    if (!Object.keys(cfg[fluxo]).length) delete cfg[fluxo];
  }
  try {
    const r = await postar(API + 'fluxo-config', { config: cfg });
    M.fluxo_config = r.config || {};
    toast('Fluxo atualizado.');
  } catch (e) { toast(e.message || 'Não foi possível salvar o fluxo.', true); }
  const y = window.scrollY;
  renderPlanejamento();
  setTimeout(() => window.scrollTo(0, y), 60);
}
document.addEventListener('change', ev => {
  const t = ev.target;
  if (!t.dataset || t.dataset.fxDep === undefined) return;
  const { fluxo, id, dep } = t.dataset, atuais = pldDeps(fluxo, id);
  fxSalvar(fluxo, id, t.checked ? [...new Set([...atuais, dep])] : atuais.filter(d => d !== dep));
});
document.addEventListener('click', ev => {
  const t = ev.target, r = t.closest && t.closest('[data-fx-reset]'), rt = t.closest && t.closest('[data-fx-reset-tudo]');
  if (r) fxSalvar(r.dataset.fluxo, r.dataset.id, null);
  else if (rt) fxSalvar(rt.dataset.fluxo, '', null);
});

function plDiasTxt(dias) { return dias.length ? dias.slice(0, 10).map(fd).join(', ') + (dias.length > 10 ? ` … +${dias.length - 10}` : '') : '—'; }
function plAuditoriaAbrir(chave, ini, fim) {
  const a = plAtivPorChave(chave);
  if (!a) return toast('Atividade não encontrada no cronograma.', true);
  const o = plOrigemRealizado(a, ini, fim), un = a.unidade;
  const tG = o.grade.length ? `<div class="tabela-rolagem"><table class="pl-tab"><thead><tr><th>Empresa</th><th>Coluna lançada na grade</th><th>Frente</th><th class="n">No período</th><th class="n">Acumulado na obra</th><th>Dias com lançamento no período</th></tr></thead><tbody>` +
      o.grade.map(g => `<tr><td>${esc(g.empresa)}</td><td>${esc(g.coluna)}${g.junta ? '<div class="nota">coluna única “Vigas e Joists”: parte proporcional ao contrato</div>' : ''}</td><td>${esc(cap(g.frente || ''))}</td><td class="n"><b>${plFmt(g.per, un)}</b></td><td class="n">${plFmt(g.ac, un)}</td><td class="nota">${plDiasTxt(g.dias)}</td></tr>`).join('') +
      `</tbody><tfoot><tr><th colspan="3">Total da grade</th><th class="n">${plFmt(o.gradeTot, un)}</th><th class="n">${plFmt(soma0(o.grade, g => g.ac), un)}</th><th></th></tr></tfoot></table></div>`
    : '<p class="nota">Nenhuma coluna da grade de lançamentos alimenta esta atividade.</p>';
  const tB = o.bm.length ? `<div class="tabela-rolagem"><table class="pl-tab"><thead><tr><th>Empresa</th><th>Código</th><th>Atividade do catálogo do BM</th><th class="n">No período</th><th class="n">Acumulado na obra</th><th>Dias apontados no período</th></tr></thead><tbody>` +
      o.bm.map(b => `<tr><td>${esc(b.empresa)}</td><td>${esc(b.codigo)}</td><td>${esc(b.atividade)}</td><td class="n"><b>${plFmt(b.per, b.un || un)}</b> ${esc(b.un)}</td><td class="n">${plFmt(b.ac, b.un || un)} ${esc(b.un)}</td><td class="nota">${plDiasTxt(b.dias)}</td></tr>`).join('') +
      '</tbody></table></div><p class="nota">Quantidades do BM na unidade da própria atividade do catálogo.</p>'
    : '<p class="nota">Nenhuma atividade do catálogo do BM está ligada a esta atividade (ou não há apontamentos).</p>';
  let m = document.getElementById('plAudit');
  if (!m) { m = document.createElement('div'); m.id = 'plAudit'; m.className = 'pl-modal-fundo'; document.body.appendChild(m); }
  m.innerHTML = `<div class="pl-modal" role="dialog" aria-modal="true" aria-label="De onde vem o realizado"><div class="pl-modal-cab"><h2>De onde vem o realizado</h2><button class="btn" data-pl-audit-fechar>Fechar</button></div>
    <div class="pl-modal-corpo"><h3>${esc(a.nome)} <span class="nota">${esc(cap(a.frente))}</span></h3>
      <div class="tiles"><div class="tile" style="--c:var(--verde)"><div class="rot"><span>Realizado no período</span></div><div class="val">${plFmt(o.usado, un)} ${esc(un)}</div><div class="sub">${fdA(ini)} a ${fdA(o.lim)}${o.lim < fim ? ' (limitado à data de referência)' : ''}</div></div>
        <div class="tile" style="--c:var(--fg3)"><div class="rot"><span>Contrato</span></div><div class="val">${plFmt(a.qtd, un)} ${esc(un)}</div><div class="sub">acumulado na obra: ${plFmt(a.realAc, un)} ${esc(un)}</div></div></div>
      <p class="nota"><b>Regra aplicada:</b> ${esc(o.regra)}</p>
      ${plExcessoHtml(a, ini, fim) ? '<p class="nota valor-neg">Atenção: o lançamento total desta atividade (toda a obra) passa do contrato — o sistema corta no contrato. Confira lançamentos duplicados, unidade ou contrato desatualizado.</p>' : ''}
      <h4>Lançamentos na grade — dentro do período</h4>${tG}
      <h4>Catálogo de atividades do BM (Medição) — dentro do período</h4>${tB}
      ${o.gradeTot > 0 && o.bmTot > 0 && Math.abs(o.usado - Math.max(o.gradeTot, o.bmTot)) > 1e-6 && Math.abs(o.usado - o.gradeTot - o.bmTot) > 1e-6 ? '<p class="nota">O número usado pelo sistema não é a soma das duas tabelas: ele toma a maior fonte e aplica os limites de fase/contrato.</p>' : ''}</div></div>`;
}
const plAuditoriaFechar = () => document.getElementById('plAudit')?.remove();
document.addEventListener('keydown', ev => { if (ev.key === 'Escape') plAuditoriaFechar(); });

// ---------------------------------------------------------------- eventos
document.addEventListener('click', async ev => {
  const t = ev.target;
  if (t.closest('[data-pl-ir-qual]')) { PL.sub = 'qual'; return mudarAba('plan'); }
  const au = t.closest('[data-pl-audit]');
  if (au) return plAuditoriaAbrir(au.dataset.plAudit, au.dataset.ini, au.dataset.fim);
  if (t.closest('[data-pl-audit-fechar]') || (t.id === 'plAudit' && PL._md === t)) return plAuditoriaFechar();
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
  if (t.closest('[data-pl-rasc-retomar]')) return plRascunhoRetomar(false);
  if (t.closest('[data-pl-rasc-descartar]')) { plRascunhoLimpar(); return renderPlanejamento(); }
  // assistente
  const w = PL.wiz;
  if (!w) return;
  if (t.classList?.contains('pl-modal-fundo')) {   // clique no fundo escuro: só fecha se começou E terminou nele e nada foi alterado
    if (PL._md === t && !w._sujo && plWizFechar()) renderPlanejamento();
    return;
  }
  if (t.closest('[data-pl-fechar]')) { if (plWizFechar()) renderPlanejamento(); return; }   // volta à tela já mostrando o banner do rascunho, se houver
  const passo = t.closest('[data-pl-passo]');
  if (passo) {
    const alvo = +passo.dataset.plPasso;
    const erro = alvo > w.passo ? plWizValidar(w.passo) : '';
    if (erro) return plWizMsg(erro, true);
    if (alvo === 3 && w.passo !== 3 && !plWizValidar(2)) plWizPrepararItens();
    w.passo = alvo; plRascunhoSalvar(); return plWizRender();
  }
  if (t.closest('[data-pl-voltar]')) { w.passo = Math.max(1, w.passo - 1); plRascunhoSalvar(); return plWizRender(); }
  if (t.closest('[data-pl-proximo]')) {
    const erro = plWizValidar(w.passo);
    if (erro) return plWizMsg(erro, true);
    if (w.passo === 1) { plAtividades(true); }
    w.passo++;
    if (w.passo === 3) plWizPrepararItens();
    return plWizRender();
  }
  if (t.closest('[data-pl-rascunho-salvar]')) return plWizSalvar(true);
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
  if (t.closest && t.closest('#plModal')) { w._sujo = true; plRascunhoSalvar(); }
  if (t.dataset.plQuemOutra !== undefined) {
    const it = w.sel.get(t.dataset.k);
    if (it) { const q = plQuemLista(it), antes = it.empresa || ''; it._outra = t.value; it.empresa = q.marcadas.join(' / '); plQuemAplicar(it, antes); }
    return;
  }
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
  if (w && t.closest && t.closest('#plModal')) { w._sujo = true; plRascunhoSalvar(); }
  if (t.dataset.plQuem !== undefined && w) {   // marcar/desmarcar empresa que executa
    const it = w.sel.get(t.dataset.k);
    if (!it) return;
    const q = plQuemLista(it), set = new Set(q.marcadas), antes = it.empresa || '';
    t.checked ? set.add(t.dataset.plQuem) : set.delete(t.dataset.plQuem);
    it._outra = q.outra;
    it.empresa = [...set].join(' / ');
    plQuemAplicar(it, antes);
    const chip = t.closest('.pl-chip'); if (chip) chip.classList.toggle('on', t.checked);
    return;
  }
  if (t.dataset.plTaxa !== undefined && w) {   // escolher a taxa por dia do item no assistente 5W2H
    const it = w.sel.get(t.dataset.k);
    if (!it || !t.value) return;
    const tx = plTaxasItem(it, plAtivPorChave(it.chave));
    it.meta_dia = t.value === 'nec' ? +tx.nec.toFixed(3) : t.value === 'rit' ? +tx.rit.toFixed(3) : '';   // meta do cronograma = em branco (acompanha a meta atual)
    const campo = [...document.querySelectorAll('[data-pl-i="meta_dia"]')].find(x => x.dataset.k === t.dataset.k);
    if (campo) campo.value = it.meta_dia;
    const prev = [...document.querySelectorAll('[data-pl-prev]')].find(x => x.dataset.plPrev === t.dataset.k);
    if (prev) prev.innerHTML = plPrevTexto(it);
    return;
  }
  if (t.dataset.plQualTipo !== undefined) { PL.qual.tipo = t.value; return renderPlanejamento(); }
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
document.addEventListener('mousedown', ev => { PL._md = ev.target; }, true);
document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && PL.wiz && !PL.wiz._sujo) plWizFechar(); });   // Esc não descarta o que já foi preenchido

// ---------------------------------------------------------------- PLANEJAMENTO DENTRO DO PAINEL (dashboard)
// O que foi planejado (planos 5W2H ativos que cruzam o período do Painel) × o que foi executado: curva S, % executado e situação por atividade.
// Também alimenta a coluna "Plano 5W2H" do Farol do período e os pontos de atenção.
PL.pp = { plano: '', atv: '' };
const plPlanosPainel = () => (PL.dados?.planos || []).filter(p => !['concluido', 'rascunho', 'arquivado'].includes(p.status) && p.inicio && p.fim && Array.isArray(p.itens) && p.inicio <= per.fim && p.fim >= per.ini);
// Empresas que executam o item NO PLANO (escolhidas no 5W2H, campo empresa); sem escolha, as da atividade na grade.
function plEmpresasDoItem(it, a) {
  const nomes = M.empresas.map(e => e.nome).filter(n => ganNorm(it.empresa || '').includes(ganNorm(n)));
  if (nomes.length) return nomes;
  const outras = empresasDe(it.empresa || '');   // empresa fora do cadastro (digitada em "outra")
  return outras.length ? outras : (a?.empresas || []);
}
function plItemDaEmpresa(it, emp) {
  if (!emp) return true;
  const a = plAtivPorChave(it.chave);
  return plEmpresasDoItem(it, a).includes(emp);
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
  plPlanosPainel().forEach(p => { const c = plCalc(p); c.itens.forEach(x => lista.push({ p, x, emps: plEmpresasDoItem(x.it, x.ativ) })); });
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
  const selo = planos.length ? `<div class="nota">Qualidade dos dados dos planos: ${plSeloQualidade(plQualidadeDosPlanos(PL.pp.plano ? planos.filter(p => p.id === PL.pp.plano) : planos), true)}</div>` : '';
  const cab = `<div class="bloco-cab"><h2>Planejamento 5W2H — planejado × executado</h2><button class="btn" data-ir-aba="plan">Abrir Planejamento</button></div>${selo}`;
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
    c.itens.map(x => `<tr><td><b>${esc(x.it.atividade)}</b><div class="nota">${fd(x.it.inicio)} a ${fd(x.it.fim)}${pl.id === 'combinado' && x.it._planoNome ? ' · ' + esc(x.it._planoNome) : ''}</div></td><td>${esc(plEmpresasDoItem(x.it, x.ativ).join(' / ') || x.it.empresa || '—')}</td>
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

