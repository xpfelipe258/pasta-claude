'use strict';
// ------------------------------------------------------------------------------------------------
// RELATÓRIO DAS EMPRESAS (botão da aba Painel)
// Documento HTML (abre em qualquer navegador; Ctrl+P salva em PDF), uma seção por empresa, para o período escolhido:
// produção, atividades que deveriam ter começado, meta da semana, plano 5W2H, avanço físico (catálogo do BM), previsto × realizado,
// financeiro (medido e projeção), custos de equipamento e abastecimento (projeção), impactos, tendência de efetivo e suprimentos
// (material retirado × joists realizados, com semáforo de perda).
// Depende de app.js, planos.js, planos_doc.js e projecao.js (funções globais).
// ------------------------------------------------------------------------------------------------

const RE_PESSOAS_POR_ATIVIDADE = 4, RE_PESSOAS_PREMONTAGEM = 8;   // efetivo médio por atividade em execução; pré-montagem exige no mínimo 8
const RE_PERDA_VERDE = 3, RE_PERDA_AMARELO = 6;                    // perda de material: até 3% verde · 3 a 6% amarelo · acima de 6% vermelho

// atividades que usam guindaste/plataforma (custo de equipamento por unidade produzida)
const RE_RELAC_EQUIP = /ICAMENTO|VIGA|MONTAGEM|TELHA|FECHAMENTO|MARQUISE|CALHA|PERFILAGEM/;
const reMediana = xs => { const v = xs.filter(Number.isFinite).sort((a, b) => a - b); if (!v.length) return 0; const m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
const reTry = (fn, rot) => { try { return fn(); } catch (e) { console.error('Relatório das empresas —', rot, e); return { erro: `${rot}: ${e.message || e}` }; } };
const reSm = (cls, txt) => `<span class="sm ${cls}"><i></i>${txt}</span>`;
const reMoeda = v => (v == null || isNaN(v) ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }));
const rePct = (v, d = 0) => (v == null || isNaN(v) ? '—' : nf(v, d) + '%');
function reFarolPct(p, semMeta) {
  if (semMeta || p == null) return ['nd', 'sem meta'];
  return p >= 100 ? ['vd', 'meta atingida'] : p >= 90 ? ['am', 'no limite'] : ['vm', 'abaixo da meta'];
}
const reSemFase = fn => { const f = faseFiltro; faseFiltro = ''; try { return fn(); } finally { faseFiltro = f; } };   // o relatório ignora o filtro de fase do topo
const reLinhas = c => reSemFase(() => ganLinhas(c));
const reSemanas = (ini, fim) => { const s = new Set(); for (let d = ini; d <= fim; d = add(d, 1)) s.add(segunda(d)); return [...s].sort().map(sg => ({ ini: maxD(ini, sg), fim: minD(fim, add(sg, 6)), seg: sg })); };
const reSomaJan = (m, a, b) => { let t = 0; m.forEach((v, d) => { if (d >= a && d <= b) t += v; }); return t; };   // soma de uma série por dia dentro da janela
// o acumulado (medido, saldo, % acumulado) só aparece quando o relatório vai do INÍCIO DA OBRA até a data atual; fora disso vale só o período
const reDesdeInicio = (ini, fim) => ini <= ((M.datas && M.datas[0]) || '0000-01-01') && fim >= ref;
const reUnTxt = (v, un) => `${nf(v, un === '%' ? 1 : 1)}${un ? ' ' + esc(un) : ''}`;

// ---------------------------------------------------------------- planos 5W2H = base do resumo do período
// Cada atividade dos planos ativos que cruzam o período, já na parte da empresa (atividade dividida entre EJ e CMM conta metade para cada uma),
// com a série planejada e a série lançada por dia.
const rePlanosDoPeriodo = (ini, fim) => (PL.dados?.planos || []).filter(p => !['rascunho', 'arquivado'].includes(p.status) && p.inicio && p.fim && Array.isArray(p.itens) && p.inicio <= fim && p.fim >= ini);
function rePlanoItens(emp, ini, fim) {
  const out = [];
  rePlanosDoPeriodo(ini, fim).forEach(p => {
    const pc = plPlanoCombinado([p], emp);
    if (!pc) return;
    const ce = pjDaEmpresa(plCalc(pc), emp, pc);
    ce.itens.forEach(x => out.push({ plano: p, c: ce, x }));
  });
  return out;
}
// Fase 1 e Fase 2 não são mais referência: o mesmo serviço do galpão (ou do mesmo anexo) vira UMA linha com o somatório.
const reFrenteBase = f => (ehFrenteAnexa(f) ? ganNorm(f) : /FECHAMENTO/.test(ganNorm(f)) ? 'GALPAO FECHAMENTO' : 'GALPAO');
const reChaveItem = x => `${ganNorm(x.ativ?.it?.servico || x.it.atividade)}|${reFrenteBase(x.it.frente || x.ativ?.it?.frente || '')}`;
const reFrenteTxt = f => cap(String(f || '').replace(/\s*\bF[12]\b\s*/i, ' ').replace(/\s+/g, ' ').trim());
const reStatusPior = sts => ['ATRASADO', 'NO LIMITE', 'NO PRAZO', 'ADIANTADO', 'A INICIAR', 'CONCLUÍDO'].find(st => sts.includes(st)) || sts[0] || '';

// ---------------------------------------------------------------- 1. produção do período
// Meta do período = o planejado no 5W2H entre a data inicial e a final; previsto até o corte = do início do período até a última data
// mencionada (ou a data de referência, se vier antes); realizado = o lançado no mesmo trecho. Entram todas as atividades do plano e todas as executadas.
function reProducao(emp, ini, fim, c, ls) {
  const its = rePlanoItens(emp, ini, fim), porChave = new Map();
  its.forEach(({ x }) => {
    const meta = reSomaJan(x.mapaPlan, ini, fim), prev = reSomaJan(x.mapaPlan, ini, c), real = Math.min(reSomaJan(x.real, ini, c), Number(x.it.qtd) || Infinity);   // nunca passa de 100% do que o plano prevê
    if (!(meta > 0 || prev > 0 || real > 0)) return;
    const k = reChaveItem(x), o = porChave.get(k) || { serv: x.it.atividade, un: x.it.unidade, fonte: 'plano 5W2H', servNorm: ganNorm(x.ativ?.it?.servico || x.it.atividade), meta: 0, prev: 0, real: 0 };
    o.meta += meta; o.prev += prev; o.real += real; porChave.set(k, o);
  });
  const linhas = [...porChave.values()];
  const cobertos = new Set(its.map(({ x }) => ganNorm(x.ativ?.it?.servico || x.it.atividade)));
  // atividades executadas que não estão em nenhum plano: meta cadastrada (aba Metas) quando houver
  const kpis = reSemFase(() => paresMeta()).filter(([e]) => e === emp).map(([e, sv]) => kpiPer(e, sv, ini, fim, c));
  const extras = new Map();
  ls.forEach(l => {
    const meu = (l.porEmp || []).find(y => y.nome === emp);
    const per = meu ? soma0(meu.ds.filter(([d]) => d >= ini && d <= c), ([, v]) => v) : 0;
    if (!(per > 0)) return;
    const nome = cap(l.it.servico_exib || l.it.servico), sn = ganNorm(l.it.servico_exib || l.it.servico);
    if (cobertos.has(ganNorm(l.it.servico)) || cobertos.has(sn)) return;
    const o = extras.get(sn) || { serv: nome, un: plUnidade(l.it), fonte: 'cronograma', servNorm: sn, meta: null, prev: null, real: 0 };
    o.real += per; extras.set(sn, o);
  });
  extras.forEach(o => {
    const k = kpis.find(y => ganNorm(y.serv) === o.servNorm);
    if (k && k.prevTotal > 0) { o.meta = k.prevTotal; o.prev = k.prev; o.real = Math.max(o.real, k.real); o.fonte = 'meta cadastrada'; }
    linhas.push(o);
  });
  if (!its.length) kpis.filter(k => (k.prevTotal > 0 || k.real > 0) && !linhas.some(o => o.servNorm === ganNorm(k.serv)))
    .forEach(k => linhas.push({ serv: k.serv, un: k.un || '', fonte: 'meta cadastrada', servNorm: ganNorm(k.serv), meta: k.prevTotal, prev: k.prev, real: k.real }));
  linhas.forEach(o => { o.desvio = o.prev == null ? null : o.real - o.prev; o.pct = o.prev > 0 ? o.real / o.prev * 100 : null; });
  linhas.sort((a, b) => (b.real > 0) - (a.real > 0) || a.serv.localeCompare(b.serv));
  const comMeta = linhas.filter(o => o.meta > 0), prev = soma0(comMeta, o => o.prev), realTot = soma0(comMeta, o => o.real);
  return { linhas, prev, real: realTot, total: soma0(comMeta, o => o.meta), pct: prev > 0 ? realTot / prev * 100 : null,
    atingidas: comMeta.filter(o => o.real >= o.meta * .999).length, comMeta: comMeta.length, base: its.length ? 'plano 5W2H' : 'metas cadastradas' };
}

// ---------------------------------------------------------------- 2. meta de cada semana (atividades do plano 5W2H)
function reMetaSemanal(emp, ini, fim, c) {
  const its = rePlanoItens(emp, ini, fim);
  const pares = its.length ? [] : reSemFase(() => paresMeta()).filter(([e]) => e === emp);
  return reSemanas(ini, fim).map(w => {
    let ks;
    if (its.length) {
      const m = new Map();
      its.forEach(({ x }) => {
        const meta = reSomaJan(x.mapaPlan, w.ini, w.fim);
        if (!(meta > 0)) return;
        const k = reChaveItem(x), o = m.get(k) || { serv: cap(x.it.atividade), un: x.it.unidade, prevTotal: 0, real: 0 };
        o.prevTotal += meta; o.real += Math.min(reSomaJan(x.real, w.ini, minD(w.fim, c)), Number(x.it.qtd) || Infinity); m.set(k, o);
      });
      ks = [...m.values()];
    } else ks = pares.map(([e, sv]) => kpiPer(e, sv, w.ini, w.fim, c)).filter(k => k.prevTotal > 0);
    const atingidas = ks.filter(k => k.real >= k.prevTotal * .999).length;
    const encerrada = w.fim <= c, noPeriodo = w.ini <= c;
    return { ...w, ks, atingidas, total: ks.length, encerrada, noPeriodo, plano: its.length > 0,
      ok: ks.length ? atingidas === ks.length : null, pct: soma0(ks, k => k.prevTotal) > 0 ? soma0(ks, k => Math.min(k.real, k.prevTotal)) / soma0(ks, k => k.prevTotal) * 100 : null };
  });
}

// ---------------------------------------------------------------- 3. atividades que a empresa precisava iniciar
// Quantidade, realizado acumulado e % acumulada vêm do CATÁLOGO DE ATIVIDADES do BM (aba Financeiro › Medição) da própria empresa.
function reBmDaLinha(emp, it, ate) {
  let ats;
  if (it._eclusa) { const cod = (ECLUSA_VJ.find(e => e[0] === it._eclusa) || [])[2] || []; ats = bmAtiv(emp).filter(a => cod.includes(a.codigo)); }
  else {
    ats = ganBmAtividades(it).filter(a => a.empresa === emp);
    if (ehFrenteAnexa(it.frente)) {   // anexo: só o item do catálogo do próprio anexo (a marquise do galpão é o item 3.1.x)
      const fr = ganNorm(it.frente), K = (fr.match(/ECLUSA|PORTARIA|REFEITORIO|VESTIARIO|VIVENCIA|PASSARELA|MARQUISE|QDF|HVAC/) || [])[0];
      ats = ats.filter(a => K && ganNorm(`${a.item_desc || ''} ${a.atividade || ''}`).includes(K) && (!/GALPAO/.test(fr) || String(a.item).startsWith('3.1.')));
    }
  }
  if (!ats.length) return null;
  const itens = bmMontarItens(ats.map(a => ({ a, real: bmRealizado(a, ate) })));
  const valor = soma0(itens, i => i.valor['RÓTULA'] || 0), pct = valor > 0 ? soma0(itens, i => i.pct * (i.valor['RÓTULA'] || 0)) / valor : soma0(itens, i => i.pct) / itens.length;
  const unidades = [...new Set(ats.map(a => a.unidade || '').filter(Boolean))];
  const misto = unidades.length > 1;   // atividades em unidades diferentes (vão, un, checklist…) não se somam: fica só o % da medição
  return { qtd: misto ? null : soma0(ats, a => Number(a.qtd) || 0), real: misto ? null : soma0(itens, i => soma0(i.ats, x => x.real)), pct: pct * 100, un: unidades.join(' / '), cods: ats.map(a => a.codigo), n: ats.length };
}
function reAtividades(emp, ini, fim, c, ls) {
  const brutas = [];
  ls.forEach(l => {
    const it = l.it, emps = plEmpresasDe(it), meu = (l.porEmp || []).find(x => x.nome === emp);
    if (!emps.includes(emp) && !meu) return;
    if (!l.ini || l.ini > fim) return;                               // ainda não era para começar
    if (l.status === 'CONCLUÍDO' && l.rf && l.rf < ini) return;       // já encerrada antes do período
    const bm = reBmDaLinha(emp, it, c);
    if (!bm && !it._eclusa && ganBmAtividades(it).length) return;      // o catálogo existe, mas é de outra empresa (ex.: telhas da Globo no relatório da EJ)
    const ds = meu ? meu.ds : [];
    brutas.push({ l, it, bm, ate: soma0(ds.filter(([d]) => d <= c), ([, v]) => v), per: soma0(ds.filter(([d]) => d >= ini && d <= fim && d <= c), ([, v]) => v), primeira: ds.length ? ds[0][0] : null });
  });
  // Fase 1 + Fase 2 do mesmo serviço = uma linha só (somatório); o catálogo do BM cobre o galpão inteiro, então é lido uma vez
  const grupos = new Map();
  brutas.forEach(b => { const k = `${ganNorm(b.it.servico_exib || b.it.servico)}|${reFrenteBase(b.it.frente)}`; (grupos.get(k) || grupos.set(k, []).get(k)).push(b); });
  const linhas = [...grupos.values()].map(g => {
    const p = g[0], bm = (g.find(x => x.bm) || {}).bm || null, primeiras = g.map(x => x.primeira).filter(Boolean).sort();
    const iniG = g.map(x => x.l.ini).sort()[0], prazoG = g.map(x => x.l.prazo).filter(Boolean).sort().pop() || null, ate = soma0(g, x => x.ate);
    const bmIniciou = !!(bm && bm.pct > 0);
    return { nome: cap(p.it.servico_exib || p.it.servico), frente: reFrenteTxt(p.it.frente), ini: iniG, prazo: prazoG, un: plUnidade(p.it), qtd: soma0(g, x => Number(x.it.qtd) || 0), bm,
      ate, per: soma0(g, x => x.per), primeira: primeiras[0] || null, iniciada: ate > 0 || bmIniciou, noPeriodo: iniG >= ini,
      status: reStatusPior(g.map(x => x.l.status)), atrasadaDeInicio: iniG < c && !(ate > 0 || bmIniciou) };
  });
  linhas.sort((a, b) => (a.iniciada - b.iniciada) || a.ini.localeCompare(b.ini) || a.nome.localeCompare(b.nome));
  return { linhas, naoIniciadas: linhas.filter(x => !x.iniciada).length, iniciadas: linhas.filter(x => x.iniciada).length };
}

// ---------------------------------------------------------------- 4. previsto × realizado nas atividades da empresa
// Produção da coluna com o MESMO nome do serviço (sem casar por trecho de texto): "Marquise – Vigas Principais" não soma as "Vigas" do galpão.
function reProdExata(emp, nome, ini, fim) {
  const e = empresa(emp);
  return soma0((e?.servicos || []).filter(s => ganNorm(s.nome) === ganNorm(nome)), s => producaoServicoValor(e, s, ini, fim));
}
function rePrevistoRealizado(emp, ini, fim, c) {
  const e = empresa(emp), nomes = [...new Map((e?.servicos || []).map(s => [ganNorm(s.nome), s.nome])).values()];
  const rows = [];
  nomes.forEach(serv => {
    const cli = previstoClienteDaEmpresa(serv, emp, ini, c);
    let previsto, real, un = '', n = 1, base = 'cronograma do cliente';
    if (cli) { previsto = cli.previsto; un = cli.m2 ? 'm²' : ''; n = cli.n; real = cli.m2 ? realizadoPeriodoItem(cli.item, emp, ini, fim) : prodServico(serv, emp, ini, fim); }
    else {
      const ms = (M.metas || []).filter(m => m.empresa === emp && m.servico === serv && m.fim >= ini && m.inicio <= fim);
      previsto = soma0(ms, m => prevMeta(m, ini, c)); real = reProdExata(emp, serv, ini, fim); base = 'meta cadastrada';
    }
    const acum = cli ? prodServico(serv, emp, '0000-01-01', c) : reProdExata(emp, serv, '0000-01-01', c);
    if (previsto || real || acum) rows.push({ serv, previsto, real, un, n, base, pct: previsto ? real / previsto * 100 : null, acum });
  });
  return { rows };
}

// ---------------------------------------------------------------- 5. planos 5W2H (atingimento do plano)
// Tudo na parte da empresa (pjDaEmpresa): o realizado é o que a própria empresa lançou; o resumo junta todos os planos do período.
function rePctItens(itens) {
  const pesoTot = soma0(itens, x => x.it.peso || 1) || 1;
  const pctPlan = soma0(itens, x => (x.it.peso || 1) / pesoTot * (x.it.qtd ? Math.min(1, x.planAc / x.it.qtd) : 0)) * 100;
  const pctReal = soma0(itens, x => (x.it.peso || 1) / pesoTot * (x.it.qtd ? Math.min(1, x.realAc / x.it.qtd) : 0)) * 100;
  return { pctPlan, pctReal, desvio: pctReal - pctPlan };
}
function rePlanos(emp, ini, fim, c) {
  const rows = [], todos = [];
  rePlanosDoPeriodo(ini, fim).forEach(p => {
    const pc = plPlanoCombinado([p], emp);
    if (!pc) return;
    const c0 = plCalc(pc), ce = pjDaEmpresa(c0, emp, pc), v = rePctItens(ce.itens), st = plStatusPlano({ ...c0, ...v, itens: ce.itens, concl: ce.itens.filter(x => x.status === 'CONCLUÍDO').length });
    const encerrado = p.fim <= c, atingido = v.pctReal >= 99.5;
    const veredito = atingido ? ['vd', 'PLANO ATINGIDO'] : encerrado ? ['vm', 'PLANO NÃO ATINGIDO'] : v.desvio >= -1 ? ['vd', 'NO RITMO DO PLANO'] : v.desvio >= -5 ? ['am', 'ABAIXO DO PLANEJADO'] : ['vm', 'MUITO ABAIXO DO PLANEJADO'];
    rows.push({ plano: p, c: { ...c0, ...v }, st, veredito, itens: ce.itens });
    todos.push(...ce.itens);
  });
  const geral = todos.length ? (() => {
    const v = rePctItens(todos), encerrado = rows.every(r => r.plano.fim <= c), atingido = v.pctReal >= 99.5;
    return { ...v, n: rows.length, atividades: todos.length, veredito: atingido ? ['vd', 'PLANO ATINGIDO'] : encerrado ? ['vm', 'PLANO NÃO ATINGIDO'] : v.desvio >= -1 ? ['vd', 'NO RITMO DO PLANO'] : v.desvio >= -5 ? ['am', 'ABAIXO DO PLANEJADO'] : ['vm', 'MUITO ABAIXO DO PLANEJADO'] };
  })() : null;
  return { rows, geral };
}

// ---------------------------------------------------------------- 6. avanço físico × catálogo do BM e resumo financeiro (medido)
function reBM(emp, ini, fim, c) {
  const R = 'RÓTULA', ats = bmAtiv(emp);
  if (!ats.length) return { sem: true };
  const fimIt = bmItens(emp, c), antIt = bmItens(emp, add(ini, -1)), ant = new Map(antIt.map(it => [it.item, it]));
  const itens = fimIt.map(it => {
    const a = ant.get(it.item), pctAnt = a ? a.pct : 0, valor = it.valor[R] || 0;
    const reaisAnt = a ? new Map(a.ats.map(x => [x.a.codigo, x.real])) : new Map();
    return { item: it.item, desc: it.desc, valor, pct: it.pct, pctAnt, pctPer: it.pct - pctAnt, medido: it.pct * valor, medidoPer: (it.pct - pctAnt) * valor,
      ats: it.ats.map(x => ({ a: x.a, real: x.real, pct: x.pct, realPer: x.real - (reaisAnt.get(x.a.codigo) || 0) })) };
  });
  const contrato = soma0(itens, i => i.valor), acum = soma0(itens, i => i.medido), per = soma0(itens, i => i.medidoPer);
  const bms = bmPeriodos(emp).slice(-8).map(p => { const cc = bmCalc(emp, p), t = cc.tot[R]; return { p, medidoPer: t.per, pctPer: t.pctPer, pctAcum: t.pctAcum, faturar: cc.faturar[R], fechado: p.fechado }; });
  return { itens, contrato, acum, per, pctAcum: contrato ? acum / contrato : 0, pctPer: contrato ? per / contrato : 0, saldo: contrato - acum, bms, desdeInicio: reDesdeInicio(ini, fim) };
}

// ---------------------------------------------------------------- 7. projeção financeira (planos 5W2H ativos × preço do BM)
function reProjecao(emp, bm) {
  const pl = plPlanoCombinado(pjPlanosAtivos(), emp);
  if (pl) {
    const c0 = plCalc(pl), c = pjDaEmpresa(c0, emp, pl), r = pjCalc(pl, c, 1, 'RÓTULA');
    const semanas = new Map();
    r.itens.forEach(i => i.proj.forEach((v, d) => { if (d > r.base) semanas.set(segunda(d), (semanas.get(segunda(d)) || 0) + v * i.p); }));
    const brutas = r.itens.map(i => {
      let ac = Math.min(i.qtd, i.x.realAc);
      i.proj.forEach((v, d) => { if (d <= r.fimPlano) ac += v; });
      return { chave: reChaveItem(i.x), atividade: i.x.it.atividade, un: i.x.it.unidade, qtd: i.qtd, preco: i.p, valor: i.valor, exec: Math.min(i.x.realAc, i.qtd) * i.p, fis: Math.min(i.x.realAc, i.qtd),
        noFim: Math.min(ac, i.qtd) * i.p, saldo: Math.max(0, i.qtd - i.x.realAc) * i.p, termina: i.termina, fim: i.x.it.fim, semValor: i.pr.origem === 'sem' };
    });
    const gr = new Map();
    brutas.forEach(b => (gr.get(b.chave) || gr.set(b.chave, []).get(b.chave)).push(b));
    const linhas = [...gr.values()].map(bs => {   // Fase 1 + Fase 2 = uma linha
      const qtd = soma0(bs, b => b.qtd), valor = soma0(bs, b => b.valor);
      return { atividade: bs[0].atividade, un: bs[0].un, qtd, preco: qtd ? valor / qtd : bs[0].preco, valor, exec: soma0(bs, b => b.exec), pctFis: qtd ? soma0(bs, b => b.fis) / qtd * 100 : 0,
        noFim: soma0(bs, b => b.noFim), saldo: soma0(bs, b => b.saldo), termina: bs.map(b => b.termina).filter(Boolean).sort().pop() || null, fim: bs.map(b => b.fim).sort().pop(), semValor: bs.some(b => b.semValor) };
    });
    return { base: 'planos', totalPlano: r.totalPlano, planoAteHoje: r.planoAteHoje, exec: r.exec, aoFim: r.aoFimPlano, termina: r.termina, fimPlano: r.fimPlano,
      semanas: [...semanas.entries()].sort().slice(0, 8), linhas, semValor: r.semValor.length };
  }
  if (!bm || bm.sem) return { base: 'nenhuma' };
  // sem plano 5W2H: ritmo financeiro dos últimos 14 dias de calendário → quando o saldo do catálogo seria medido
  const c = minD(ref, M.referencia || ref), ant = bmItens(emp, add(c, -14)), atual = bmItens(emp, c);
  const v14 = soma0(atual, i => i.pct * (i.valor.RÓTULA || 0)) - soma0(ant, i => i.pct * (i.valor.RÓTULA || 0)), porDia = v14 / 14;
  const dias = porDia > 0 ? Math.ceil(bm.saldo / porDia) : null;
  return { base: 'catalogo', saldo: bm.saldo, porDia, termina: dias != null && dias < 1500 ? add(c, dias) : null, v14 };
}

// ---------------------------------------------------------------- 8. equipamentos e abastecimento: período, histórico dos BMs e projeção
function reAbastecimento(emp, c, horizonteSemanas) {
  const us = ratear((T.usos || []).filter(u => u.data && u.data <= c && (ganNorm(u.uso).includes('ABASTECIMENTO') || (u.litros || 0) > 0 || (u.custo_combustivel || 0) > 0))).filter(r => r.empAjust === emp);
  const porDia = new Map();
  us.forEach(r => {
    const o = porDia.get(r.data) || { data: r.data, litros: 0, valor: 0 };
    o.litros += r.litrosR || 0;
    o.valor += r.combR > 0 ? r.combR : (r.litrosR || 0) * (Number(r.preco_litro) || 0);
    porDia.set(r.data, o);
  });
  const dias = [...porDia.values()].filter(x => x.litros > 0).sort((a, b) => a.data.localeCompare(b.data)).slice(-8);   // últimos abastecimentos
  if (!dias.length) return { sem: true };
  const med = reMediana(dias.map(x => x.litros));
  const validos = dias.filter(x => x.litros >= med * .4 && x.litros <= med * 2.5), descartados = dias.length - validos.length;   // corta lançamentos atípicos
  const pesos = validos.map((_, k) => k + 1), soma = soma0(pesos, w => w);
  const litrosMedio = validos.reduce((s, x, k) => s + x.litros * pesos[k], 0) / soma;   // média ponderada: o mais recente pesa mais
  const precos = validos.filter(x => x.valor > 0).map(x => x.valor / x.litros).slice(-5);
  const preco = reMediana(precos);
  const span = Math.max(7, diasEntre(validos[0].data, c) + 1);
  const porSemana = validos.length / (span / 7);   // abastecimentos por semana (período ocioso reduz a frequência)
  const litrosSemana = litrosMedio * porSemana, custoSemana = litrosSemana * preco;
  return { dias, validos, descartados, litrosMedio, preco, porSemana, litrosSemana, custoSemana, quatro: custoSemana * 4, horizonte: custoSemana * horizonteSemanas, horizonteSemanas };
}
// Histórico dos últimos BMs: custo de equipamento por dia útil (o BM mais recente pesa mais) e por unidade produzida nas atividades relacionadas a equipamento.
function reHistoricoEquip(emp, c, iniPadrao) {
  const relac = RE_RELAC_EQUIP;
  const e = empresa(emp), servRel = [...new Map((e?.servicos || []).filter(s => relac.test(ganNorm(s.nome))).map(s => [ganNorm(s.nome), s.nome])).values()];
  const primeiroUso = (T.usos || []).filter(u => empresasDe(u.empresa).includes(emp) && u.data).map(u => u.data).sort()[0] || iniPadrao || c;
  const bms = bmPeriodos(emp).slice(-3).map(p => {
    const pIni = p.ini === '0000-01-01' ? primeiroUso : p.ini, pFim = minD(p.fim, c);
    if (pFim < pIni) return null;
    const dd = bmDeducoes(emp, { ...p, ini: p.ini }, 0), du = Math.max(1, contarDiasUteis(add(pIni, -1), pFim));
    const un = soma0(servRel, s => prodServico(s, emp, pIni, pFim));
    return { p, equip: dd.equip, comb: dd.comb, litros: dd.litros, du, un, ini: pIni, fim: pFim };
  }).filter(Boolean);
  const pesos = bms.map((_, k) => k + 1), sp = soma0(pesos, w => w) || 1;
  const diaEquip = bms.length ? bms.reduce((s, b, k) => s + (b.equip / b.du) * pesos[k], 0) / sp : null;
  const comUn = bms.filter(b => b.un > 0 && b.equip > 0);
  const porUn = comUn.length ? soma0(comUn, b => b.equip) / soma0(comUn, b => b.un) : null;
  return { relac, bms, diaEquip, porUn };
}
// Projeção de equipamentos: só a janela seguinte ao período, com a MESMA quantidade de dias úteis do período (uma semana = 5).
// Considera apenas a plataforma (PTA, uma diária por dia útil) e o guindaste (só nos dias de içamento previstos, no máximo 2 diárias por semana).
function reProjEquip(emp, ini, fim, c, ls) {
  const du = Math.max(1, contarDiasUteis(add(ini, -1), fim)), de = add(fim, 1), dias = [];
  for (let d = de; dias.length < du && d < add(de, 400); d = add(d, 1)) if (diaUtil(d)) dias.push(d);
  const ateJan = dias[dias.length - 1];
  const disp = pjEquipDisponiveis(), kit = pjKitSelecionado(disp).map(n => disp.find(d => d.nome === n)).filter(Boolean);
  const classe = cl => { const eq = kit.filter(k => k.classe === cl); return { nomes: eq.map(k => k.nome), diaria: soma0(eq, k => k.dia.v), origem: eq.map(k => `${k.nome}: ${k.dia.origem}`).join(' · ') }; };
  const pta = classe('plataforma'), gui = classe('guindaste');
  // dias de içamento previstos (joist e vigas do galpão): série planejada dos planos 5W2H da empresa e saldo redistribuído; sem plano, as atividades ativas do cronograma
  const prev = new Set(), ehIc = x => { const n = ganNorm(x.ativ?.it?.servico || x.it.atividade); return (/ICAMENTO/.test(n) || n === 'VIGAS') && !ehFrenteAnexa(x.ativ?.it?.frente); };
  const its = rePlanoItens(emp, ini, ateJan).filter(({ x }) => ehIc(x));
  its.forEach(({ x }) => { dias.forEach(d => { if ((x.mapaPlan.get(d) || 0) > 0 || (x.redistrib && (x.redistrib.get(d) || 0) > 0) || (x.falta > 0 && d > x.it.fim)) prev.add(d); }); });   // plano ou saldo ainda pendente depois do fim do plano
  let fonte = 'plano 5W2H';
  if (!its.length) {
    fonte = 'cronograma';
    ls.filter(l => { const n = ganNorm(l.it.servico); return (/ICAMENTO/.test(n) || n === 'VIGAS') && !ehFrenteAnexa(l.it.frente) && l.status !== 'CONCLUÍDO' && (plEmpresasDe(l.it).includes(emp) || (l.porEmp || []).some(y => y.nome === emp)); })
      .forEach(l => dias.forEach(d => { if (l.ini && l.ini <= d && (l.prazo || '9999-12-31') >= d) prev.add(d); }));
  }
  const prevDias = [...prev].sort(), maxGui = Math.min(du, Math.max(1, Math.round(du * 2 / 5)));
  const diasGui = prevDias.slice(0, maxGui);
  const custoPta = pta.diaria * dias.length, custoGui = gui.diaria * diasGui.length;
  return { du, de, ate: ateJan, dias, pta, gui, ptaDias: dias.length, guiDias: diasGui, guiPrevistos: prevDias.length, maxGui, custoPta, custoGui, total: custoPta + custoGui, fonte };
}
function reEquipamentos(emp, ini, fim, c, atv, ls) {
  const dados = relEquipDados(emp, ini, fim, 'todos'), tot = dados.empresas.find(x => x.empresa === emp) || { custo: 0, litros: 0, comb: 0, total: 0, dias: new Set() };
  const proj = reProjEquip(emp, ini, fim, c, ls);
  const abast = reAbastecimento(emp, c, 1);
  if (!abast.sem) { abast.janela = abast.custoSemana * proj.du / 5; abast.janelaLitros = abast.litrosSemana * proj.du / 5; }   // abastecimento da semana seguinte (proporcional aos dias úteis do período)
  return { dados, tot, abast, proj };
}

// ---------------------------------------------------------------- 9. impactos gerados e sofridos
// Fornecedor mencionado no impacto: o nome do setor ("Fornecedor — EJ") ou, quando o setor é só "Fornecedor", as empresas citadas no texto do registro.
function reFornecedorMencionado(i) {
  const f = fornecedorDeSetor(impactoSetor(i));
  if (!f.isForn) return [];
  const nomes = fornecedoresImpacto(), acha = txt => nomes.filter(n => { const b = ganNorm(n); return b && new RegExp(`(^| )${b}( |$)`).test(ganNorm(txt)); });
  if (f.nome) { const a = acha(f.nome); return a.length ? a : [f.nome]; }
  return acha([i.motivo, i.paralisacao, i.obs, i.descricao, i.quando].filter(Boolean).join(' '));
}
// REGRA: setor Fornecedor + fornecedor mencionado = o impacto é GERADO pelo fornecedor mencionado (para a empresa citada é GERADO e NUNCA sofrido,
// mesmo quando ela própria é a afetada na montagem). Impacto de outro setor que atinge a empresa = SOFRIDO; com fornecedor de outra empresa, SOFRIDO por quem foi afetado.
function reImpactos(emp, ini, fim, c) {
  const lim = { ini, fim: c };
  const todos = impactosComAutomaticos().filter(i => { const p = periodoImpacto(i); return p.ini <= fim && p.fim >= ini; });
  const forn = new Map(todos.map(i => [i, reFornecedorMencionado(i)]));
  const gerou = i => forn.get(i).some(n => ganNorm(n) === ganNorm(emp));
  const gerados = todos.filter(gerou);
  const sofridos = todos.filter(i => impactoEmpresas(i).includes(emp) && !gerou(i));
  const semEmpresa = todos.filter(i => !impactoEmpresas(i).length).length;
  const rk = rankingImpactos(sofridos, [emp], lim), me = rk.empresas.find(x => x.nome === emp);
  const linha = (i, tipo) => ({ tipo, i, forn: forn.get(i), dias: somaMapa(diasPorImpacto(i, lim)) });
  const linhas = [...sofridos.map(i => linha(i, 'SOFRIDO')), ...gerados.map(i => linha(i, 'GERADO'))].sort((a, b) => String(a.i.data).localeCompare(String(b.i.data)));
  const comForn = todos.filter(i => fornecedorDeSetor(impactoSetor(i)).isForn);
  return { linhas, sofridos: sofridos.length, gerados: gerados.length, diasDiretos: me ? me.dias : 0, diasCascata: me ? me.indireto : 0, diasGerados: somaMapa(mapaImpactos(gerados, lim)), semEmpresa, lim,
    fornTotal: comForn.length, fornOutra: comForn.filter(i => forn.get(i).length && !gerou(i)).length, fornSemNome: comForn.filter(i => !forn.get(i).length).length };
}

// ---------------------------------------------------------------- 10. tendência de efetivo
function reEfetivo(emp, ini, fim, c, ls) {
  const semAt = w => ls.filter(l => (plEmpresasDe(l.it).includes(emp) || (l.porEmp || []).some(x => x.nome === emp)) && l.ini && l.ini <= w.fim && (l.prazo || '9999-12-31') >= w.ini && l.status !== 'CONCLUÍDO');
  const media = w => { const ds = []; for (let d = w.ini; d <= w.fim && d <= c; d = add(d, 1)) if (diaUtil(d)) { const t = efetivoEmpresaDia(emp, d).total; if (t > 0) ds.push(t); } return ds.length ? soma0(ds, x => x) / ds.length : null; };
  const segAtual = segunda(c), hist = [];
  for (let k = 5; k >= 0; k--) { const sg = add(segAtual, -7 * k); const w = { ini: sg, fim: add(sg, 6), seg: sg }; hist.push({ ...w, m: media(w) }); }
  const pts = hist.map((h, k) => [k, h.m]).filter(p => p[1] != null);
  let a = pts.length ? pts[pts.length - 1][1] : 0, b = 0;
  if (pts.length >= 2) {
    const n = pts.length, sx = soma0(pts, p => p[0]), sy = soma0(pts, p => p[1]), sxx = soma0(pts, p => p[0] * p[0]), sxy = soma0(pts, p => p[0] * p[1]), den = n * sxx - sx * sx;
    b = den ? (n * sxy - sx * sy) / den : 0; a = (sy - b * sx) / n;
  }
  const proj = k => Math.max(0, a + b * k);   // k = índice da semana na série (5 = semana atual)
  const semanas = [];
  const semsRel = reSemanas(ini, fim).map(w => w.seg);
  const todas = [...new Set([...semsRel, ...Array.from({ length: 4 }, (_, k) => add(segAtual, 7 * (k + 1)))])].sort();
  todas.forEach(sg => {
    const w = { ini: sg, fim: add(sg, 6), seg: sg }, atv = semAt(w);
    const lancado = sg <= segAtual ? media(w) : null;
    const k = 5 + Math.round(diasEntre(segAtual, sg) / 7);
    const distintas = [...new Map(atv.map(l => [ganNorm(l.it.servico_exib || l.it.servico), l])).values()];   // Fase 1 e Fase 2 do mesmo serviço contam uma só vez
    const necessario = soma0(distintas, l => (/PREMONT|PRE MONT/.test(ganNorm(l.it.servico)) ? RE_PESSOAS_PREMONTAGEM : RE_PESSOAS_POR_ATIVIDADE));
    const efetivo = lancado != null ? lancado : proj(k);
    semanas.push({ ...w, lancado, projetado: lancado == null, efetivo, atv: distintas.map(l => cap(l.it.servico_exib || l.it.servico)), necessario, saldo: efetivo - necessario });
  });
  const regs = (T.dp_efetivo || []).filter(r => normEmp(r.empresa) === emp && r.data && r.data >= ini && r.data <= fim);
  const dias = new Set(regs.map(r => r.data)), hd = soma0(regs, r => r.quantidade || 0);
  const pico = Math.max(0, ...[...dias].map(d => efetivoEmpresaDia(emp, d).total));
  return { hist, semanas, tendencia: b, base: pts.length, homemDia: hd, mediaDia: dias.size ? hd / dias.size : null, pico };
}

// ---------------------------------------------------------------- 11. suprimentos: material retirado × joists previstos × realizados
// Retirada da SEMANA ANTECEDENTE ao período (mesma quantidade de semanas do período) × o que foi produzido no período. O consumo é informado por semana
// nomeada; a data de cada semana vem de Estoque › Consumo físico (✎ Editar coluna) ou, se faltar, do intervalo escrito no nome.
function reSuprimentos(emp, ini, fim, c) {
  const cf = estConsumoComCadastros(), regras = M.estoque_ifc?.regras || {}, servs = regras.consumo_por_servico || {};
  if (!(cf.empresas || []).includes(emp)) return { sem: 'O consumo físico de material só é lançado para ' + (cf.empresas || []).join(' e ') + '.' };
  const mats = new Map(estMateriaisComCadastros().map(m => [ganNorm(m.tag), m]));
  const datas = consSemanasDatas(cf), nSem = reSemanas(ini, fim).length, alvoFim = add(segunda(ini), -1), alvoIni = add(segunda(ini), -7 * nSem);
  const alvo = (cf.semanas || []).filter(n => { const d = datas.get(n); return d && d.data >= alvoIni && d.data <= alvoFim; });
  const modo = alvo.length ? 'semana' : 'acumulado';   // sem semana datada antes do período: cai no acumulado e avisa
  const de = modo === 'semana' ? ini : '0000-01-01';
  const prodCache = new Map(), prod = nome => { if (!prodCache.has(nome)) prodCache.set(nome, prodServico(nome, emp, de, c)); return prodCache.get(nome); };
  const temServ = nome => !nome.startsWith('_') && M.empresas.some(e => e.nome === emp && e.servicos.some(s => s.nome === nome));
  // Ø1/2": 8 parafusos + 8 porcas + 8 arruelas por joist içada; o parafuso (FG005/FG006/FG007) é o específico da posição da joist (criterio_por_letra) e vem do apontamento
  const crit = (window._regras_baixa || {}).criterio_por_letra || regras.criterio_por_letra || {};
  const apJ = (T.apontamentos || []).filter(a => (a.tipo || '').toUpperCase() === 'JOIST' && a.empresa === emp && (!a.data || (a.data <= c && a.data >= de)));
  const joistsAp = soma0(apJ, a => a.qtd || 0), parafusoAp = new Map();
  apJ.forEach(a => { const cod = (crit[String(a.letra || '').toUpperCase()] || {}).parafuso; if (cod) parafusoAp.set(cod, (parafusoAp.get(cod) || 0) + 8 * (a.qtd || 0)); });
  const itens = [];
  (cf.itens || []).forEach(m => {
    const retirado = soma0(Object.entries(m.consumo_semanas || {}).filter(([n]) => modo === 'acumulado' || alvo.includes(n)), ([, d]) => Number(d?.[emp]) || 0);
    if (!(retirado > 0)) return;
    const refs = Object.entries(servs).filter(([nome, conf]) => temServ(nome) && (conf.itens || []).some(x => ganNorm(x.codigo) === ganNorm(m.tag)))
      .map(([nome, conf]) => ({ nome, por: Number(conf.itens.find(x => ganNorm(x.codigo) === ganNorm(m.tag)).por_unidade) || 0, real: prod(nome) })).filter(x => x.por > 0);
    let esperado = soma0(refs, x => x.por * x.real), exato = false;
    const realizadas = soma0(refs, x => x.real), refIc = refs.find(x => /ICAMENTO/.test(ganNorm(x.nome)));
    if (refIc && joistsAp > 0 && /^FG00[567]$/i.test(m.tag)) {   // parafuso específico: apontado por posição + o que passou do apontamento pela média do serviço
      esperado = (parafusoAp.get(String(m.tag).toUpperCase()) || 0) + Math.max(0, refIc.real - joistsAp) * refIc.por; exato = true;
    }
    const previstas = refs.length ? (esperado > 0 ? retirado * realizadas / esperado : retirado / refs[0].por) : null;   // unidades do serviço que o material retirado permitiria montar
    const perda = refs.length ? (retirado - esperado) / retirado * 100 : null;
    const sem = perda == null ? ['nd', 'SEM REFERÊNCIA'] : perda < 0 ? ['am', 'ATENÇÃO — retirada abaixo do necessário'] : perda <= RE_PERDA_VERDE ? ['vd', 'CONFORME — perda até 3%'] : perda <= RE_PERDA_AMARELO ? ['am', 'ATENÇÃO — perda de 3 a 6%'] : ['vm', 'NÃO CONFORME — perda acima de 6%'];
    const mat = mats.get(ganNorm(m.tag));
    itens.push({ tag: m.tag, produto: m.produto || mat?.produto || m.tag, material: mat?.material || '', retirado, refs, esperado, previstas, realizadas, perda, sem, exato });
  });
  itens.sort((a, b) => (b.perda ?? -999) - (a.perda ?? -999));
  const conta = cls => itens.filter(i => i.sem[0] === cls).length;
  return { itens, verdes: conta('vd'), amarelos: conta('am'), vermelhos: conta('vm'), semBase: conta('nd'), modo, alvo: alvo.map(n => ({ nome: n, ...datas.get(n) })), alvoIni, alvoFim,
    semData: (cf.semanas || []).filter(n => !datas.has(n)), semanasTotal: (cf.semanas || []).length };
}

// ---------------------------------------------------------------- mapa pintado da montagem (joists, vigas e contraventamentos)
// Mesma planta dos apontamentos de montagem, em SVG estático: cada peça é pintada pelo que foi apontado até a data de corte —
// cor forte da empresa = montada por ela NO PERÍODO; cor clara = montada por ela antes do período; cinza = montada por outra empresa; branco = pendente.
const RE_COR_OUTRA = '#b8c2cc';
const reEstadoPeca = (row, emp, ini) => (!row ? 'pend' : row.empresa === emp ? (row.data >= ini ? 'per' : 'ant') : 'outra');
const rePinta = (est, cores) => ({ pend: 'fill="#ffffff" stroke="#c4cdd8"', ant: `fill="${cores.forte}" fill-opacity=".35" stroke="${cores.forte}" stroke-opacity=".6"`,
  per: `fill="${cores.forte}" stroke="#14202b" stroke-width="1.2"`, outra: `fill="${RE_COR_OUTRA}" stroke="#94a3b8"` })[est];
const reTxt = (x, y, t, o = '') => `<text x="${x}" y="${y}" font-size="9" fill="#51606f" font-family="Arial,Helvetica,sans-serif" ${o}>${esc(t)}</text>`;

function reMapaPlanta(ctx, emp, ini, cores) {
  const eixos = ctx.cfg.eixos, passo = 10, mEsq = 70, mTop = 44, pad = 5, n = ctx.layout.length, colW = passo * 7 + 6, barH = passo - 2;
  const posL = {};
  let acum = 0;
  Object.entries(ctx.pos).forEach(([f, ps]) => {
    const qtd = ctx.layout.filter(q => q.faixa === f).length;
    posL[ps[0]] = acum; posL[ps[ps.length - 1]] = acum + qtd;
    ps.slice(1, -1).forEach(l => { posL[l] = acum + qtd / 2; });
    acum += qtd;
  });
  const yEst = l => mTop + posL[l] * passo;
  const ANC = [['A', 0], ['B', 4], ['C', 7], ['D', 10], ['E', 13], ['F', 16], ['G', 19], ['H', 23]];
  const yOitao = m => { for (let i = 1; i < ANC.length; i++) if (m <= ANC[i][1]) { const [l0, i0] = ANC[i - 1], [l1, i1] = ANC[i]; return yEst(l0) + (yEst(l1) - yEst(l0)) * (m - i0) / (i1 - i0); } return yEst('H'); };
  const xEixo = e => mEsq + eixos.indexOf(e) * colW, yFim = mTop + n * passo;
  const larg = mEsq + (eixos.length - 1) * colW + 24, alt = yFim + 40;
  const out = [`<svg viewBox="0 0 ${larg} ${alt}" style="width:100%;height:auto" role="img" aria-label="Mapa pintado de joists e vigas">`];
  Object.entries(ctx.pos).forEach(([f, ps]) => {
    const y0 = yEst(ps[0]), y1 = yEst(ps[ps.length - 1]);
    out.push(`<rect x="${mEsq}" y="${y0}" width="${(eixos.length - 1) * colW}" height="${y1 - y0}" fill="#f4f7fb"/>`, reTxt(10, (y0 + y1) / 2 + 3, f, 'font-weight="700"'));
  });
  eixos.forEach(e => { const x = xEixo(e); out.push(`<line x1="${x}" x2="${x}" y1="${mTop}" y2="${yFim}" stroke="#d3dbe4" stroke-width=".8"/>`, reTxt(x, mTop - 14, e, 'text-anchor="middle" font-weight="700"')); });
  ctx.letras.forEach(l => out.push(reTxt(mEsq - 8, yEst(l) + 3, l, 'text-anchor="end"')));
  const nJ = { per: 0, ant: 0, outra: 0, pend: 0 }, nV = { per: 0, ant: 0, outra: 0, pend: 0 };
  eixos.slice(0, -1).forEach((e, i) => {
    const rua = `${e}-${eixos[i + 1]}`, xl = xEixo(e) + pad, xr = xEixo(eixos[i + 1]) - pad;
    for (let k = 1; k <= n; k++) {
      const st = reEstadoPeca(ctx.slotRow.get(`${rua}|${k}`), emp, ini); nJ[st]++;
      out.push(`<rect x="${xl}" y="${mTop + (k - 1) * passo + 1}" width="${xr - xl}" height="${barH}" rx="2" ${rePinta(st, cores)} stroke-width=".7"/>`);
    }
    out.push(reTxt((xEixo(e) + xEixo(eixos[i + 1])) / 2, yFim + 18, `${ctx.totalRua.get(rua) || 0}/${ctx.limRua}`, 'text-anchor="middle"'));
  });
  out.push(reTxt(mEsq - 8, yFim + 18, 'joists/rua', 'text-anchor="end"'));
  eixos.forEach(e => ctx.letrasEixo(e).forEach(l => {
    const c = ctx.crit[l], m = ctx.vigaMontada.get(ctx.vigaId(e, l)), st = reEstadoPeca(m, emp, ini); nV[st]++;
    const yv = c.oitao ? yOitao(c.posicao_estacao) : yEst(l), tam = c.oitao || c.evento_viga === 'VIGA_INTERM_MONTADA' ? 7 : 11;
    out.push(`<rect x="${xEixo(e) - tam / 2}" y="${yv - tam / 2}" width="${tam}" height="${tam}" rx="1.5" ${rePinta(st, cores)} stroke-width="1"/>`);
  }));
  return { svg: out.join('') + '</svg>', nJ, nV };
}

function reMapaContrav(emp, ini, cores, feitas) {
  const fr = ((window._frentes || {}).frentes || {}).contraventamento, el = fr && fr.elevacao;
  if (!el) return null;
  const malha = (window._frentes || {}).malha || {}, eixosMm = malha.eixos_mm || {}, estMm = malha.estacoes_mm || {}, temMalha = Object.keys(eixosMm).length > 0;
  const mmPx = APC_MM_PX.grande, mEsq = 54, mTop = 40, mBase = 28;
  const ruas = malha.ruas && malha.ruas.length ? malha.ruas : el.ruas, comCth = new Set(el.ruas), est = el.estacoes;
  const eixos = [...new Set(ruas.flatMap(r => r.split('-')))].sort();
  const xEixo = e => (temMalha ? mEsq + (eixosMm[e] || 0) / mmPx : mEsq + eixos.indexOf(e) * (560 / mmPx) * 14);
  const yEst = e => (temMalha ? mTop + (estMm[e] || 0) / mmPx : mTop + est.indexOf(e) * (560 / mmPx) * 14);
  const larg = xEixo(eixos[eixos.length - 1]) - mEsq, alt = yEst(est[est.length - 1]) - mTop, W = mEsq + larg + 24, H = mTop + alt + mBase;
  const o = [`<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto" role="img" aria-label="Mapa pintado do contraventamento">`];
  let ultimoY = -99;
  est.forEach(e => { const y = yEst(e); o.push(`<line x1="${mEsq}" y1="${y}" x2="${mEsq + larg}" y2="${y}" stroke="#e5eaf0" stroke-width=".6"/>`); if (y - ultimoY >= 9 || /^[A-H]$/.test(e)) { o.push(reTxt(mEsq - 7, y + 3, e, 'text-anchor="end"')); ultimoY = y; } });
  let ultimoX = -99;
  ruas.forEach(r => {
    const [a, b] = r.split('-'), x0 = xEixo(a), x1 = xEixo(b), tem = comCth.has(r);
    if (tem) o.push(`<rect x="${x0}" y="${mTop}" width="${x1 - x0}" height="${alt}" fill="#f4f7fb"/>`);
    o.push(`<line x1="${x0}" y1="${mTop}" x2="${x0}" y2="${mTop + alt}" stroke="#d3dbe4" stroke-width=".8"/>`);
    if (tem || x0 - ultimoX >= 22) { o.push(reTxt(x0, mTop - 8, a, `text-anchor="middle"${tem ? ' font-weight="700"' : ''}`)); ultimoX = x0; }
  });
  const fimX = xEixo(eixos[eixos.length - 1]);
  o.push(`<line x1="${fimX}" y1="${mTop}" x2="${fimX}" y2="${mTop + alt}" stroke="#d3dbe4" stroke-width=".8"/>`, reTxt(fimX, mTop - 8, eixos[eixos.length - 1], 'text-anchor="middle"'));
  const n = { per: 0, ant: 0, outra: 0, pend: 0 };
  el.paineis.forEach(p => {
    if (!comCth.has(p.rua) || !(p.de in estMm || !temMalha)) return;
    const [a, b] = p.rua.split('-'), x0 = xEixo(a), x1 = xEixo(b), y0 = yEst(p.de), y1 = yEst(p.ate), h = Math.max(y1 - y0, 3);
    const st = reEstadoPeca(feitas.get(apcChave(p.marca, p.rua, `${p.de}-${p.ate}`)), emp, ini); n[st]++;
    const traco = st === 'pend' ? '#c4cdd8' : st === 'outra' ? '#7b8794' : st === 'per' ? '#14202b' : cores.forte;
    o.push(`<rect x="${x0 + 1}" y="${y0}" width="${Math.max(x1 - x0 - 2, 3)}" height="${h}" ${rePinta(st, cores)} stroke-width=".6"/>`,
      `<line x1="${x0 + 1.5}" y1="${y0}" x2="${x1 - 1.5}" y2="${y0 + h}" stroke="${traco}" stroke-width=".9"/><line x1="${x1 - 1.5}" y1="${y0}" x2="${x0 + 1.5}" y2="${y0 + h}" stroke="${traco}" stroke-width=".9"/>`);
  });
  return { svg: o.join('') + '</svg>', n, total: el.paineis.filter(p => comCth.has(p.rua)).length };
}

// Telhas e perfilagem da Globo Aços: uma faixa por telha (0,485 m de largura, do eixo A ao H), do eixo 01 ao 20, pintada pelo apontamento
// (tipo TELHA ou PERFILAGEM). Dois desenhos, como no mapa das joists: Fase 2 (eixos 01 ao 11) e Fase 1 (eixos 11 ao 20).
function reMapaTelhas(emp, ini, cores, ate, chave, tipo) {
  const fr = ((window._frentes || {}).frentes || {})[chave];
  if (!fr) return null;
  const t = fr.telha || {}, n = fr.total, lar = t.largura_mm || 485, malha = (window._frentes || {}).malha || {}, em = malha.eixos_mm || {}, estMm = malha.estacoes_mm || {};
  const px = 3, mEsq = 52, mTop = 40, alto = 190, largMm = malha.largura_mm || 175980;
  const feitas = new Map(ate.filter(a => (a.tipo || '').toUpperCase() === tipo).map(a => [String(a.rua), a]));
  const primeiraF1 = Math.floor((t.fase1_ini_mm || 225000) / lar + 0.5) + 1, cont = { per: 0, ant: 0, outra: 0, pend: 0 };
  const desenho = (de, atei, nome) => {
    const nv = atei - de + 1, W = mEsq + nv * px + 20, H = mTop + alto + 36, X = i => mEsq + (i - de) * px;
    const o = [`<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto" role="img" aria-label="${esc(nome)}">`];
    Object.entries(estMm).filter(([l]) => /^[A-H]$/.test(l)).forEach(([l, y]) => { const yy = mTop + y / largMm * alto; o.push(`<line x1="${mEsq}" x2="${mEsq + nv * px}" y1="${yy}" y2="${yy}" stroke="#e5eaf0" stroke-width=".6" stroke-dasharray="3 3"/>`, reTxt(mEsq - 6, yy + 3, l, 'text-anchor="end"')); });
    for (let i = de; i <= atei; i++) {
      const st = reEstadoPeca(feitas.get(String(i).padStart(4, '0')), emp, ini); cont[st]++;
      o.push(`<rect x="${X(i)}" y="${mTop}" width="${px - .5}" height="${alto}" ${rePinta(st, cores)} stroke-width=".2" shape-rendering="crispEdges"/>`);
    }
    Object.keys(em).filter(k => k.length === 2).sort().forEach(e => { const i = em[e] / lar + 1; if (i >= de && i <= atei + 1) { const x = X(i); o.push(`<line x1="${x}" x2="${x}" y1="${mTop - 8}" y2="${mTop + alto + 4}" stroke="#94a3b8" stroke-width=".8"/>`, reTxt(x, mTop - 12, e, 'text-anchor="middle" font-weight="700"')); } });
    return { nome, svg: o.join('') + '</svg>' };
  };
  const fases = [desenho(1, Math.min(n, primeiraF1 - 1), 'Fase 2 (eixos 01 ao 11)'), desenho(primeiraF1, n, 'Fase 1 (eixos 11 ao 20)')];
  return { fases, n: cont, total: n, m2: (t.comprimento_m || 177.32) * lar / 1000 };
}

function reMapa(emp, ini, c) {
  const regras = window._regras_baixa, e = empresa(emp);
  const cfgAp = (regras && regras.apontamento) || {};
  const temJoist = !!(e && regras && e.servicos.some(s => s.nome === cfgAp.servico_joist || s.nome === cfgAp.servico_viga));
  const temTelha = !!(e && e.servicos.some(s => ehTelhar(ganNorm(s.nome)))), temPerfil = !!(e && e.servicos.some(s => ganNorm(s.nome).includes('PERFILAGEM')));
  if (!temJoist && !temTelha && !temPerfil) return null;   // sem montagem em mapa no catálogo da empresa: a seção não aparece
  const todos = T.apontamentos || [], ate = todos.filter(a => !a.data || a.data <= c);
  const forte = corEmpHex(emp) || '#2563eb', cores = { forte }, out = { cores };
  const tipo = t => ate.filter(a => (a.tipo || '').toUpperCase() === t);
  const meus = (t, de) => tipo(t).filter(a => a.empresa === emp && (de ? a.data >= ini : a.data < ini));
  const qJ = lista => soma0(lista, a => a.qtd || 0);
  if (temJoist) {   // joists, vigas e contraventamentos (catálogo da EJ e da CMM)
    if (!regras.apontamento) return { sem: 'As regras de montagem (mapa de apontamento) não estão disponíveis.' };
    let ctx;
    T.apontamentos = ate;   // o mapa mostra só o que foi apontado até a data de corte
    try { ctx = apContexto(regras); } finally { T.apontamentos = todos; }
    const feitas = new Map(tipo('CONTRAVENTAMENTO').map(a => [apcChave(a.faixa, a.rua, a.letra || ''), a]));
    const pl = reMapaPlanta(ctx, emp, ini, cores), cv = reMapaContrav(emp, ini, cores, feitas);
    Object.assign(out, { planta: pl, contrav: cv, ctx,
      joist: { per: qJ(meus('JOIST', true)), ant: qJ(meus('JOIST', false)), total: ctx.limGalpao, feitas: qJ(tipo('JOIST')) },
      viga: { per: meus('VIGA', true).length, ant: meus('VIGA', false).length, total: soma0(ctx.cfg.eixos, x => ctx.letrasEixo(x).length), feitas: tipo('VIGA').length },
      cont: { per: meus('CONTRAVENTAMENTO', true).length, ant: meus('CONTRAVENTAMENTO', false).length, total: cv ? cv.total : 0, feitas: tipo('CONTRAVENTAMENTO').length } });
  }
  [[temTelha, 'telha', 'TELHA'], [temPerfil, 'perfilagem', 'PERFILAGEM']].forEach(([tem, chave, tp]) => {   // telhas e perfilagem (catálogo da Globo Aços)
    if (!tem) return;
    const tl = reMapaTelhas(emp, ini, cores, ate, chave, tp);
    if (tl) out[chave === 'telha' ? 'telha' : 'perfil'] = { ...tl, per: meus(tp, true).length, ant: meus(tp, false).length, feitas: tipo(tp).length };
  });
  return out;
}

// ---------------------------------------------------------------- montagem dos dados e do documento
function reDados(emp, ini, fim, ls) {
  const c = minD(fim, ref), d = { emp, ini, fim, corte: c };
  d.producao = reTry(() => reProducao(emp, ini, fim, c, ls), 'produção');
  d.mapa = reTry(() => reMapa(emp, ini, c), 'mapa de montagem');
  d.semanas = reTry(() => reMetaSemanal(emp, ini, fim, c), 'meta semanal');
  d.atividades = reTry(() => reAtividades(emp, ini, fim, c, ls), 'atividades');
  d.previstoReal = reTry(() => rePrevistoRealizado(emp, ini, fim, c), 'previsto × realizado');
  d.planos = reTry(() => rePlanos(emp, ini, fim, c), 'planos');
  d.bm = reTry(() => reBM(emp, ini, fim, c), 'avanço físico e financeiro');
  d.proj = reTry(() => reProjecao(emp, d.bm), 'projeção financeira');
  d.equip = reTry(() => reEquipamentos(emp, ini, fim, c, d.atividades.erro ? { linhas: [] } : d.atividades, ls), 'equipamentos');
  d.impactos = reTry(() => reImpactos(emp, ini, fim, c), 'impactos');
  d.efetivo = reTry(() => reEfetivo(emp, ini, fim, c, ls), 'efetivo');
  d.sup = reTry(() => reSuprimentos(emp, ini, fim, c), 'suprimentos');
  return d;
}
const reErro = x => (x && x.erro ? `<p class="aviso">Não foi possível montar esta parte: ${esc(x.erro)}</p>` : '');
const reTab = (cab, linhas, rodape = '') => `<table><thead><tr>${cab.map(h => `<th${/^(#n)/.test(h) ? ' class="n"' : ''}>${h.replace(/^#n/, '')}</th>`).join('')}</tr></thead><tbody>${linhas.join('') || `<tr><td colspan="${cab.length}" class="vazio">Sem registros no período.</td></tr>`}</tbody>${rodape}</table>`;

function reSecResumo(d) {
  const card = (rot, val, sub, cls) => `<div class="card ${cls || ''}"><div class="rot">${rot}</div><div class="val">${val}</div><div class="sub">${sub}</div></div>`;
  const p = d.producao, pl = d.planos, bm = d.bm, im = d.impactos, ef = d.efetivo, su = d.sup, at = d.atividades;
  const fp = p.erro ? ['nd', ''] : reFarolPct(p.pct, !(p.prev > 0));
  const planoGeral = !pl.erro && pl.geral ? pl.geral : null;
  return `<div class="cards">
    ${card('Produção no período', p.erro ? '—' : rePct(p.pct), p.erro ? '' : `${nf(p.real, 1)} realizados de ${nf(p.prev, 1)} previstos até ${fd(d.corte)}`, fp[0])}
    ${card('Metas dos serviços', p.erro ? '—' : `${p.atingidas}/${p.comMeta}`, 'serviços com a meta do período atingida', p.erro || !p.comMeta ? 'nd' : p.atingidas === p.comMeta ? 'vd' : p.atingidas ? 'am' : 'vm')}
    ${card('Atividades a iniciar', at.erro ? '—' : `${at.naoIniciadas} não iniciada(s)`, at.erro ? '' : `${at.iniciadas} iniciada(s) de ${at.linhas.length}`, at.erro ? 'nd' : at.naoIniciadas ? 'vm' : 'vd')}
    ${card('Plano 5W2H', planoGeral ? planoGeral.veredito[1] : 'sem plano', planoGeral ? `${rePct(planoGeral.pctReal)} realizado × ${rePct(planoGeral.pctPlan)} planejado · ${planoGeral.atividades} atividade(s) em ${planoGeral.n} plano(s)` : 'nenhum plano da empresa no período', planoGeral ? planoGeral.veredito[0] : 'nd')}
    ${card('Avanço físico (catálogo BM)', !bm.erro && !bm.sem ? rePct(bm.pctAcum * 100, 1) : '—', !bm.erro && !bm.sem ? `${rePct(bm.pctPer * 100, 1)} no período` : 'sem catálogo de atividades', 'az')}
    ${card('Previsão de medição do período', !bm.erro && !bm.sem ? reMoeda(bm.per) : '—', !bm.erro && !bm.sem ? `${rePct(bm.pctPer * 100, 1)} do contrato${bm.desdeInicio ? ` · acumulado ${reMoeda(bm.acum)} (${rePct(bm.pctAcum * 100, 1)}) · saldo ${reMoeda(bm.saldo)}` : ''}` : '', 'az')}
    ${card('Impactos', im.erro ? '—' : `${fmtD(im.diasDiretos + im.diasCascata)} sofridos`, im.erro ? '' : `${im.sofridos} sofrido(s) · ${im.gerados} gerado(s)${im.diasGerados ? ' (' + fmtD(im.diasGerados) + ' gerados)' : ''}`, !im.erro && (im.diasDiretos + im.diasCascata + im.diasGerados) > 0 ? 'am' : 'vd')}
    ${card('Efetivo médio no período', ef.erro || ef.mediaDia == null ? '—' : nf(ef.mediaDia, 1), ef.erro ? '' : `pico ${nf(ef.pico, 0)} · ${nf(ef.homemDia, 0)} homem-dia`, 'az')}
    ${card('Perda de material', su.erro || su.sem ? '—' : su.vermelhos ? `${su.vermelhos} NÃO CONFORME` : su.amarelos ? `${su.amarelos} em ATENÇÃO` : 'CONFORME', su.erro || su.sem ? 'material retirado × joists realizados' : `${su.verdes} conforme(s) · ${su.amarelos} atenção · ${su.vermelhos} não conforme(s)${su.itens[0] && su.itens[0].perda != null ? ` · maior perda ${esc(su.itens[0].tag)} ${su.itens[0].perda > 0 ? '+' : ''}${nf(su.itens[0].perda, 1)}%` : ''}`, su.erro || su.sem ? 'nd' : su.vermelhos ? 'vm' : su.amarelos ? 'am' : 'vd')}
  </div>`;
}

function reSecProducao(d) {
  const p = d.producao;
  if (p.erro) return reErro(p);
  const linhas = p.linhas.map(k => { const f = reFarolPct(k.pct, !(k.prev > 0)); return `<tr><td>${esc(cap(k.serv))}${k.un ? ` <span class="nota">(${esc(k.un)})</span>` : ''}<div class="nota">${esc(k.fonte)}</div></td><td class="n">${k.meta == null ? '—' : nf(k.meta, 1)}</td><td class="n">${k.prev == null ? '—' : nf(k.prev, 1)}</td><td class="n"><b>${nf(k.real, 1)}</b></td><td class="n ${k.desvio != null && k.desvio < 0 ? 'neg' : 'pos'}">${k.desvio == null ? '—' : (k.desvio > 0 ? '+' : '') + nf(k.desvio, 1)}</td><td class="n">${rePct(k.pct)}</td><td>${reSm(f[0], f[1])}</td></tr>`; });
  return reTab(['Atividade', `#nMeta do período (${fd(d.ini)} a ${fd(d.fim)})`, `#nPrevisto de ${fd(d.ini)} a ${fd(d.corte)}`, '#nRealizado', '#nDesvio', '#n% do previsto', 'Situação'], linhas)
    + `<p class="nota">Total das atividades com meta: ${nf(p.real, 1)} realizados de ${nf(p.prev, 1)} previstos até ${fdA(d.corte)} (${rePct(p.pct)}); ${p.atingidas} de ${p.comMeta} atividade(s) com a meta do período atingida. Base da meta: ${esc(p.base)}; atividades executadas fora do plano aparecem com a meta cadastrada (ou “sem meta”).</p>` + reMapaHtml(d);
}
function reMapaHtml(d) {
  const m = d.mapa;
  if (!m) return '';
  if (m.erro) return reErro(m);
  if (m.sem) return `<p class="nota">${esc(m.sem)}</p>`;
  const card = (rot, o, un) => `<div class="card az"><div class="rot">${rot}</div><div class="val">${nf(o.per, 0)}</div><div class="sub">montad${un === 'joists' || un === 'telhas' ? 'as' : 'os'} por ${esc(d.emp)} no período · antes: ${nf(o.ant, 0)} · obra: ${nf(o.feitas, 0)} de ${nf(o.total, 0)}</div></div>`;
  const leg = (cor, txt, st = '') => `<span style="display:inline-flex;align-items:center;gap:5px;margin-right:14px"><i style="width:14px;height:10px;border-radius:2px;display:inline-block;background:${cor};border:1px solid #6b7886;${st}"></i>${txt}</span>`;
  const f = m.cores.forte;
  let h = `<h3>Mapa de montagem — o que foi montado</h3><div class="cards">${m.planta ? card('Joists', m.joist, 'joists') + card('Vigas', m.viga, 'vigas') + card('Contraventamentos (kits)', m.cont, 'kits') : ''}${[['Telhas', m.telha], ['Perfilagem', m.perfil]].map(([rot, x]) => x ? card(rot, { per: x.per, ant: x.ant, feitas: x.feitas, total: x.total }, 'telhas').replace('</div></div>', ` · ≈ ${nf(x.per * x.m2, 0)} m² no período · ${nf(x.feitas * x.m2, 0)} m² na obra</div></div>`) : '').join('')}</div>
    <p class="nota mapa-leg">${leg(f, `montado por ${esc(d.emp)} no período (${fd(d.ini)} a ${fd(d.corte)})`, 'border-color:#14202b')}${leg(f, `montado por ${esc(d.emp)} antes do período`, 'opacity:.4')}${leg(RE_COR_OUTRA, 'montado por outra empresa')}${leg('#fff', 'pendente')}</p>`;
  if (m.planta) {
    h += `<h3>Joists e vigas (planta do galpão)</h3><div class="mapa-fig">${m.planta.svg}</div>
    <p class="nota">Cada retângulo é uma joist (43 por rua, da estação A no topo à H na base); os quadrados nos eixos são as vigas. Embaixo de cada rua: joists apontadas/${m.ctx.limRua}. Peças deste período: ${nf(m.planta.nJ.per, 0)} joists e ${nf(m.planta.nV.per, 0)} vigas desta empresa.</p>
    ${m.contrav ? `<h3>Contraventamento (vista elevada)</h3><div class="mapa-fig">${m.contrav.svg}</div>
    <p class="nota">Cada X é um kit de contraventamento; ${nf(m.contrav.n.per, 0)} kit(s) montado(s) por esta empresa no período, ${nf(m.contrav.n.ant, 0)} antes, ${nf(m.contrav.n.outra, 0)} por outra empresa e ${nf(m.contrav.n.pend, 0)} pendente(s). Fonte: apontamentos de montagem.</p>` : ''}`;
  }
  [['Telhas da cobertura', m.telha, 'telha'], ['Perfilagem das telhas', m.perfil, 'perfilagem']].forEach(([tit, t, kind]) => {
    if (!t) return;
    h += `<h3>${tit} (do eixo 01 ao 20)</h3>` + t.fases.map(f => `<p class="nota"><b>${esc(f.nome)}</b></p><div class="mapa-fig">${f.svg}</div>`).join('') +
      `<p class="nota">Cada faixa é ${kind === 'telha' ? 'uma telha' : 'uma fiada de perfilagem'} (177,32 m do eixo A ao H × 0,485 m de largura = ${nf(t.m2, 2)} m²), numerada a partir do eixo 01: ${nf(t.n.per, 0)} feita(s) por esta empresa no período (≈ ${nf(t.n.per * t.m2, 0)} m²), ${nf(t.n.ant, 0)} antes, ${nf(t.n.outra, 0)} por outra empresa e ${nf(t.n.pend, 0)} pendente(s) de ${nf(t.total, 0)}. Fonte: apontamentos de montagem (lançados em m² em Lançamentos e no BM).</p>`;
  });
  return h;
}
function reSecSemanas(d) {
  const s = d.semanas;
  if (s.erro) return reErro(s);
  const linhas = s.map(w => {
    const st = w.ok == null ? reSm('nd', 'sem meta') : !w.noPeriodo ? reSm('nd', 'semana futura') : w.ok ? reSm('vd', w.encerrada ? 'ATINGIDA' : 'atingida até agora') : reSm(w.encerrada ? 'vm' : 'am', w.encerrada ? 'NÃO ATINGIDA' : 'em andamento');
    const det = w.ks.map(k => `${k.real >= k.prevTotal * .999 ? '✓' : '✗'} ${esc(cap(k.serv))}: ${nf(k.real, 1)}/${nf(k.prevTotal, 1)}${k.un ? ' ' + esc(k.un) : ''}`).join('<br>');
    return `<tr><td>${fd(w.ini)} a ${fd(w.fim)}</td><td class="n">${w.total ? `${w.atingidas} de ${w.total}` : '—'}</td><td class="n">${rePct(w.pct)}</td><td>${st}</td><td class="nota">${det || '—'}</td></tr>`;
  });
  return reTab(['Semana', '#nAtividades com meta atingida', '#nMeta cumprida', 'Atingimento', 'Atividades do plano 5W2H (realizado/meta)'], linhas)
    + `<p class="nota">${s.some(w => w.plano) ? 'A meta de cada semana é o planejado no 5W2H para as atividades que a empresa executa na semana.' : 'Sem plano 5W2H da empresa no período: a meta de cada semana vem das metas cadastradas.'}</p>`;
}
function reSecAtividades(d) {
  const a = d.atividades;
  if (a.erro) return reErro(a);
  const linhas = a.linhas.map(x => {
    const st = x.iniciada ? reSm('vd', `INICIADA${x.primeira ? ' em ' + fd(x.primeira) : ''}`) : reSm('vm', x.atrasadaDeInicio ? 'NÃO INICIADA (atrasada)' : 'NÃO INICIADA');
    const b = x.bm;
    const acum = b ? (b.qtd == null ? `<span class="nota">${b.n} atividades do catálogo, em unidades diferentes</span><div class="nota">${esc(b.cods.join(', '))}</div>` : `${nf(b.real, 1)} ${esc(b.un)}<div class="nota">de ${nf(b.qtd, 1)} ${esc(b.un)} · catálogo ${esc(b.cods.join(', '))}</div>`)
      : `${nf(x.ate, 1)} ${esc(x.un)}<div class="nota">${x.qtd ? `de ${nf(x.qtd, 1)} ${esc(x.un)} · cronograma (sem atividade no catálogo)` : 'sem atividade no catálogo'}</div>`;
    return `<tr><td><b>${esc(x.nome)}</b><div class="nota">${esc(cap(x.frente))}</div></td><td>${fdA(x.ini)}${x.noPeriodo ? '' : '<div class="nota">anterior ao período</div>'}</td><td>${fdA(x.prazo)}</td><td>${st}</td>
      <td class="n">${nf(x.per, 1)} ${esc(x.un)}</td><td class="n">${acum}</td><td class="n">${b ? '<b>' + rePct(b.pct, 1) + '</b>' : '—'}</td></tr>`;
  });
  return `<p>${a.naoIniciadas ? `<b class="neg">${a.naoIniciadas} atividade(s) que a empresa deveria ter iniciado ainda não foi(ram) iniciada(s).</b>` : '<b class="pos">Todas as atividades previstas para iniciar já foram iniciadas.</b>'} ${a.iniciadas} iniciada(s).</p>`
    + reTab(['Atividade', 'Início previsto', 'Prazo', 'Situação', '#nRealizado no período', '#nAcumulado (catálogo de atividades)', '#n% acumulada (medição)'], linhas)
    + '<p class="nota">Acumulado, quantidade contratada e % acumulada vêm do catálogo de atividades do BM (Financeiro › Medição) da própria empresa. Fase 1 e Fase 2 do mesmo serviço aparecem somadas numa única linha (a Fase 2 só começa depois do saldo da Fase 1).</p>';
}
function reSecPrevisto(d) {
  const p = d.previstoReal;
  if (p.erro) return reErro(p);
  const linhas = p.rows.map(r => { const f = reFarolPct(r.pct, !r.previsto); return `<tr><td>${esc(cap(r.serv))}</td><td class="n">${nf(r.previsto, 1)}${r.un ? ' ' + r.un : ''}</td><td class="n"><b>${nf(r.real, 1)}${r.un ? ' ' + r.un : ''}</b></td><td class="n">${rePct(r.pct)}</td><td>${reSm(f[0], f[1].replace('meta ', ''))}</td><td class="n">${nf(r.acum, 1)}${r.un ? ' ' + r.un : ''}</td></tr>`; });
  return reTab(['Atividade', '#nPrevisto no período', '#nRealizado no período', '#n% atingido', 'Situação', '#nAcumulado da obra'], linhas);
}
// itens do plano com o mesmo serviço (Fase 1 + Fase 2) somados numa linha: quantidade, planejado, realizado (limitado ao plano) e falta
function reItensSomados(itens) {
  const g = new Map();
  itens.forEach(x => { const k = reChaveItem(x); (g.get(k) || g.set(k, []).get(k)).push(x); });
  return [...g.values()].map(xs => {
    const qtd = soma0(xs, x => Number(x.it.qtd) || 0), realAc = soma0(xs, x => Math.min(x.realAc, Number(x.it.qtd) || Infinity));
    return { nome: xs[0].it.atividade, un: xs[0].it.unidade, qtd, planAc: soma0(xs, x => x.planAc), realAc, falta: Math.max(0, qtd - realAc),
      status: realAc >= qtd - 1e-9 ? 'CONCLUÍDO' : reStatusPior(xs.map(x => x.status)) };
  });
}
function reSecPlanos(d) {
  const p = d.planos;
  if (p.erro) return reErro(p);
  if (!p.rows.length) return '<p class="nota">Nenhum plano 5W2H da empresa cruza este período.</p>';
  const g = p.geral;
  return `<p><b>Resumo dos planos da empresa:</b> ${reSm(g.veredito[0], g.veredito[1])} — realizado ${rePct(g.pctReal, 1)} × planejado até hoje ${rePct(g.pctPlan, 1)} (desvio ${g.desvio >= 0 ? '+' : ''}${nf(g.desvio, 1)} p.p.) em ${g.atividades} atividade(s) de ${g.n} plano(s).</p>`
    + p.rows.map(r => `<h3>${esc(r.plano.nome)} <span class="nota">${fdA(r.plano.inicio)} a ${fdA(r.plano.fim)}</span> ${reSm(r.veredito[0], r.veredito[1])}</h3>
    <p class="nota">Realizado ${rePct(r.c.pctReal, 1)} × planejado até hoje ${rePct(r.c.pctPlan, 1)} (desvio ${r.c.desvio >= 0 ? '+' : ''}${nf(r.c.desvio, 1)} p.p.) · situação ${esc(r.st)}${r.c.terminaEm ? ` · no ritmo atual termina em ${fdA(r.c.terminaEm)}` : ''}.</p>`
    + reTab(['Atividade', '#nPlano', '#nPlanejado até hoje', '#nRealizado', '#nFalta', 'Situação'], reItensSomados(r.itens).map(x => `<tr><td>${esc(x.nome)}</td><td class="n">${plFmt(x.qtd, x.un)} ${esc(x.un)}</td><td class="n">${plFmt(x.planAc, x.un)}</td><td class="n"><b>${plFmt(x.realAc, x.un)}</b></td><td class="n">${plFmt(x.falta, x.un)}</td><td><span class="nota">${esc(x.status)}</span></td></tr>`))).join('');
}
function reSecBM(d) {
  const b = d.bm;
  if (b.erro) return reErro(b);
  if (b.sem) return '<p class="nota">A empresa não tem catálogo de atividades no BM.</p>';
  const linhas = [];
  b.itens.forEach(it => {
    linhas.push(`<tr class="grupo"><td colspan="6"><b>${esc(it.item)} · ${esc(cap(it.desc || ''))}</b> — contrato ${reMoeda(it.valor)} · avanço ${rePct(it.pct * 100, 1)} (período ${it.pctPer >= 0 ? '+' : ''}${nf(it.pctPer * 100, 1)} p.p.) · medido ${reMoeda(it.medido)}</td></tr>`);
    it.ats.forEach(x => linhas.push(`<tr><td>${esc(x.a.atividade || x.a.codigo)}<div class="nota">${esc(x.a.codigo)}</div></td><td class="n">${nf(x.a.qtd, 1)} ${esc(x.a.unidade || '')}</td><td class="n">${nf(x.realPer, 1)}</td><td class="n"><b>${nf(x.real, 1)}</b></td><td class="n">${rePct(x.pct * 100, 0)}</td><td><div class="bg"><div class="bar" style="width:${nf(Math.min(100, x.pct * 100), 0)}%"></div></div></td></tr>`));
  });
  return `<div class="cards"><div class="card az"><div class="rot">Avanço físico acumulado</div><div class="val">${rePct(b.pctAcum * 100, 1)}</div><div class="sub">do catálogo, ponderado pelo valor</div></div>
    <div class="card az"><div class="rot">Avanço no período</div><div class="val">${rePct(b.pctPer * 100, 1)}</div><div class="sub">${fdA(d.ini)} a ${fdA(d.corte)}</div></div></div>`
    + reTab(['Item / atividade do catálogo', '#nContrato', '#nRealizado no período', '#nRealizado acumulado', '#n% do catálogo', 'Avanço'], linhas);
}
function reSecFinanceiro(d) {
  const b = d.bm, pj = d.proj;
  if (b.erro) return reErro(b);
  if (b.sem) return '<p class="nota">Sem catálogo do BM: não há valores medidos.</p>';
  let h = `<div class="cards"><div class="card"><div class="rot">Contrato</div><div class="val">${reMoeda(b.contrato)}</div><div class="sub">valor do catálogo (RÓTULA)</div></div>
    <div class="card az"><div class="rot">Previsão de medição do período</div><div class="val">${reMoeda(b.per)}</div><div class="sub">${rePct(b.pctPer * 100, 1)} do contrato · ${fdA(d.ini)} a ${fdA(d.corte)}</div></div>
    ${b.desdeInicio ? `<div class="card az"><div class="rot">Medido acumulado</div><div class="val">${reMoeda(b.acum)}</div><div class="sub">${rePct(b.pctAcum * 100, 1)} do contrato</div></div>
    <div class="card"><div class="rot">Saldo a medir</div><div class="val">${reMoeda(b.saldo)}</div><div class="sub">${rePct((1 - b.pctAcum) * 100, 1)} do contrato</div></div>` : ''}</div>
    ${b.desdeInicio ? '' : '<p class="nota">O medido acumulado e o saldo só aparecem quando o período vai do início da obra até a data atual.</p>'}`;
  h += '<h3>Medições (BM)</h3>' + reTab(['BM', '#nMedido no período (R$)', '#n% do contrato no período', ...(b.desdeInicio ? ['#n% acumulado'] : []), '#nA faturar (R$)', 'Situação'],
    b.bms.map(x => `<tr><td>BM${x.p.n} <span class="nota">${x.p.cortado ? 'corte ' + fdA(x.p.fim) : 'até ' + fdA(x.p.fim)}</span></td><td class="n">${reMoeda(x.medidoPer)}</td><td class="n">${rePct(x.pctPer * 100, 1)}</td>${b.desdeInicio ? `<td class="n">${rePct(x.pctAcum * 100, 1)}</td>` : ''}<td class="n">${reMoeda(x.faturar)}</td><td>${x.fechado ? 'fechado' : 'em aberto'}</td></tr>`));
  h += '<h3>Projeção financeira</h3>';
  if (pj.erro) h += reErro(pj);
  else if (pj.base === 'planos') {
    h += `<div class="cards"><div class="card"><div class="rot">Valor dos planos</div><div class="val">${reMoeda(pj.totalPlano)}</div><div class="sub">atividades da empresa nos planos 5W2H ativos</div></div>
      <div class="card"><div class="rot">Planejado até hoje</div><div class="val">${reMoeda(pj.planoAteHoje)}</div><div class="sub">executado ${reMoeda(pj.exec)}</div></div>
      <div class="card az"><div class="rot">Projeção no fim do plano</div><div class="val">${reMoeda(pj.aoFim)}</div><div class="sub">no ritmo atual (média dos últimos 5 dias úteis)</div></div>
      <div class="card"><div class="rot">Término projetado</div><div class="val">${pj.termina ? fdA(pj.termina) : '—'}</div><div class="sub">fim do plano ${fdA(pj.fimPlano)}</div></div></div>`
      + reTab(['Atividade', '#nQtd', '#nPreço unit.', '#nValor', '#nExecutado (R$)', '#n% físico', '#nProjeção no fim', '#nSaldo', 'Termina em'], pj.linhas.map(l => `<tr><td>${esc(l.atividade)}</td><td class="n">${plFmt(l.qtd, l.un)} ${esc(l.un)}</td><td class="n">${l.semValor ? '<span class="neg">sem valor no BM</span>' : reMoeda(l.preco)}</td><td class="n">${reMoeda(l.valor)}</td><td class="n"><b>${reMoeda(l.exec)}</b></td><td class="n">${rePct(l.pctFis)}</td><td class="n">${reMoeda(l.noFim)}</td><td class="n">${reMoeda(l.saldo)}</td><td>${l.termina ? fdA(l.termina) : '—'}${l.termina && l.termina > l.fim ? '<div class="nota neg">passa do prazo</div>' : ''}</td></tr>`));
    if (pj.semanas.length) h += '<h3>Faturamento projetado por semana (R$)</h3>' + reTab(['Semana', '#nProjetado'], pj.semanas.map(([sg, v]) => `<tr><td>${fd(sg)} a ${fd(add(sg, 6))}</td><td class="n">${reMoeda(v)}</td></tr>`));
  } else if (pj.base === 'catalogo') {
    h += `<p>Sem plano 5W2H ativo para a empresa: projeção pelo ritmo de medição dos últimos 14 dias — <b>${reMoeda(pj.porDia * 7)} por semana</b>${pj.termina ? `; o saldo de ${reMoeda(pj.saldo)} seria medido por volta de <b>${fdA(pj.termina)}</b>` : '; sem produção recente, não há como projetar o término'}.</p>`;
  } else h += '<p class="nota">Sem dados para projetar.</p>';
  return h;
}
function reSecEquip(d) {
  const q = d.equip;
  if (q.erro) return reErro(q);
  const ab = q.abast, tot = q.tot, pj = q.proj;
  const jan = `${fd(pj.de)} a ${fd(pj.ate)}`;
  let h = `<div class="cards"><div class="card"><div class="rot">Equipamentos no período</div><div class="val">${reMoeda(tot.custo)}</div><div class="sub">${nf(tot.dias.size || 0, 0)} dia(s) com uso</div></div>
    <div class="card"><div class="rot">Abastecimento no período</div><div class="val">${reMoeda(tot.comb)}</div><div class="sub">${nf(tot.litros, 0)} litros</div></div>
    <div class="card az"><div class="rot">Projeção de equipamentos · ${jan}</div><div class="val">${reMoeda(pj.total)}</div><div class="sub">PTA ${pj.ptaDias} diária(s) + guindaste ${pj.guiDias.length} diária(s)</div></div>
    <div class="card az"><div class="rot">Projeção de abastecimento · ${jan}</div><div class="val">${ab.sem ? '—' : reMoeda(ab.janela)}</div><div class="sub">${ab.sem ? 'sem registros de abastecimento' : `${nf(ab.janelaLitros, 0)} litros em ${pj.du} dia(s) útil(eis)`}</div></div></div>`;
  h += '<h3>Equipamentos usados no período</h3>' + reTab(['Equipamento', 'Responsável', '#nDias', '#nCusto equip.', '#nLitros', '#nCombustível'],
    q.dados.equipamentos.filter(x => x.emps.has(d.emp)).map(x => `<tr><td>${esc(x.equipamento)}</td><td>${esc(x.resp)}</td><td class="n">${x.dias.size}</td><td class="n">${reMoeda(x.custo)}</td><td class="n">${nf(x.litros, 0)}</td><td class="n">${reMoeda(x.comb)}</td></tr>`));
  h += `<h3>Projeção de equipamentos — semana seguinte (${jan})</h3>`;
  h += reTab(['Equipamento', '#nDiária (R$)', '#nDiárias', '#nCusto (R$)', 'Quando'], [
    `<tr><td><b>Plataforma (PTA)</b><div class="nota">${esc(pj.pta.nomes.join(' + ') || 'nenhuma plataforma no conjunto de equipamentos')}</div></td><td class="n">${reMoeda(pj.pta.diaria)}</td><td class="n">${pj.ptaDias}</td><td class="n"><b>${reMoeda(pj.custoPta)}</b></td><td>todos os dias úteis da janela</td></tr>`,
    `<tr><td><b>Guindaste</b><div class="nota">${esc(pj.gui.nomes.join(' + ') || 'nenhum guindaste no conjunto de equipamentos')}</div></td><td class="n">${reMoeda(pj.gui.diaria)}</td><td class="n">${pj.guiDias.length}</td><td class="n"><b>${reMoeda(pj.custoGui)}</b></td><td>${pj.guiDias.length ? pj.guiDias.map(x => fd(x)).join(', ') : 'sem içamento previsto na janela'}</td></tr>`],
    `<tfoot><tr><th>Total</th><th></th><th></th><th class="n">${reMoeda(pj.total)}</th><th></th></tr></tfoot>`);
  h += `<p class="nota">Método: a projeção cobre só a janela seguinte ao período, com a mesma quantidade de dias úteis (${pj.du}). Plataforma = uma diária por dia útil; guindaste = diária só nos dias de içamento previstos (${pj.fonte}: ${pj.guiPrevistos} dia(s) previsto(s) na janela), no máximo ${pj.maxGui} por semana. Diárias do cadastro de Equipamentos (mensal ÷ 30 ou diária cadastrada; sem valor, a média lançada) — conjunto escolhido em Projeção › Gasto com equipamento. Valores integrais, sem rateio entre empresas.${pj.pta.diaria > 0 ? '' : ' <b class="neg">Plataforma sem valor no cadastro.</b>'}${pj.gui.diaria > 0 ? '' : ' <b class="neg">Guindaste sem valor no cadastro.</b>'}</p>`;
  h += '<h3>Projeção de abastecimento (média inteligente dos últimos registros)</h3>';
  if (ab.sem) h += '<p class="nota">Sem registros de abastecimento da empresa para calcular a média.</p>';
  else h += reTab(['Data', '#nLitros', '#nValor (R$)', '#nR$ / litro', 'Considerado'], ab.dias.map(x => `<tr><td>${fdA(x.data)}</td><td class="n">${nf(x.litros, 0)}</td><td class="n">${reMoeda(x.valor)}</td><td class="n">${x.valor > 0 ? nf(x.valor / x.litros, 2) : '—'}</td><td>${ab.validos.includes(x) ? 'sim' : '<span class="nota">atípico — descartado</span>'}</td></tr>`))
    + `<p class="nota">Método: dos últimos ${ab.dias.length} abastecimentos, descartam-se os atípicos (menos de 40% ou mais de 250% da mediana)${ab.descartados ? ` — ${ab.descartados} descartado(s)` : ''}; litros por abastecimento = média ponderada (os mais recentes pesam mais) = <b>${nf(ab.litrosMedio, 0)} L</b>; preço = mediana dos últimos 5 = <b>R$ ${nf(ab.preco, 2)}/L</b>; frequência = <b>${nf(ab.porSemana, 1)} abastecimento(s)/semana</b> (considera o tempo parado até ${fd(d.corte)}). Semana = ${nf(ab.litrosSemana, 0)} L × preço = ${reMoeda(ab.custoSemana)}; projeção da janela seguinte (${jan}, ${pj.du} dia(s) útil(eis)) = <b>${reMoeda(ab.janela)}</b>.</p>`;
  return h;
}
function reSecImpactos(d) {
  const m = d.impactos;
  if (m.erro) return reErro(m);
  const linhas = m.linhas.map(x => `<tr><td>${fdA(x.i.data)}</td><td>${reSm(x.tipo === 'GERADO' ? 'am' : 'vm', x.tipo)}</td><td>${esc(x.i.servico || '—')}</td><td>${esc(impactoSetor(x.i))}${x.forn.length ? `<div class="nota">fornecedor mencionado: ${esc(x.forn.join(' / '))}</div>` : ''}</td><td>${esc(impactoEmpresasTexto(x.i))}</td><td>${esc(x.i.motivo || '')}</td><td class="n"><b>${fmtD(x.dias)}</b></td><td>${x.i.solucionado ? 'solucionado ' + fdA(x.i.solucionado) : '<b class="neg">em aberto</b>'}</td></tr>`);
  return `<p><b>${m.sofridos}</b> impacto(s) sofrido(s) e <b>${m.gerados}</b> gerado(s) pela empresa (setor “Fornecedor — ${esc(d.emp)}”) no período. Dias úteis sofridos: <b>${fmtD(m.diasDiretos)}</b> direto${m.diasCascata ? ` + <b>${fmtD(m.diasCascata)}</b> por efeito cascata (atividades anteriores do fluxo atrasaram o início)` : ''}; dias úteis gerados: <b>${fmtD(m.diasGerados)}</b>.${m.semEmpresa ? ` Há ${m.semEmpresa} impacto(s) sem empresa definida (não entram nesta lista).` : ''} Impactos do período com setor Fornecedor: ${m.fornTotal} (${m.gerados} mencionando ${esc(d.emp)}, ${m.fornOutra} mencionando outra empresa${m.fornSemNome ? `, ${m.fornSemNome} sem fornecedor identificado` : ''}).</p>`
    + reTab(['Data', 'Tipo', 'Atividade', 'Setor responsável', 'Empresa(s) afetada(s)', 'Motivo', '#nDias úteis no período', 'Situação'], linhas)
    + `<p class="nota">Regra: setor Fornecedor + fornecedor mencionado = impacto GERADO pela empresa mencionada (e não sofrido, mesmo quando ela própria é a afetada na montagem); o fornecedor vem do setor (“Fornecedor — ${esc(d.emp)}”) ou, se o setor for só “Fornecedor”, do nome da empresa citado no motivo; os demais impactos que atingem a empresa são SOFRIDOS. Dias úteis reais do calendário dentro de ${fdA(m.lim.ini)} a ${fdA(m.lim.fim)}; cada dia conta uma vez, mesmo com vários impactos.</p>`;
}
function reSecEfetivo(d) {
  const e = d.efetivo;
  if (e.erro) return reErro(e);
  const linhas = e.semanas.map(w => {
    const f = w.necessario ? (w.efetivo >= w.necessario ? ['vd', 'suficiente'] : w.efetivo >= w.necessario * .8 ? ['am', 'apertado'] : ['vm', 'déficit']) : ['nd', 'sem atividades'];
    return `<tr><td>${fd(w.ini)} a ${fd(w.fim)}</td><td class="n">${w.efetivo ? nf(w.efetivo, 1) : '—'}${w.projetado ? ' <span class="nota">(projetado)</span>' : ''}</td><td class="n">${nf(w.necessario, 0)}</td><td class="n ${w.saldo < 0 ? 'neg' : 'pos'}">${w.necessario ? (w.saldo > 0 ? '+' : '') + nf(w.saldo, 1) : '—'}</td><td>${reSm(f[0], f[1])}</td><td class="nota">${esc(w.atv.join(' · ')) || '—'}</td></tr>`;
  });
  return `<p>Efetivo médio no período: <b>${e.mediaDia != null ? nf(e.mediaDia, 1) : '—'}</b> · pico <b>${nf(e.pico, 0)}</b> · <b>${nf(e.homemDia, 0)}</b> homem-dia. Tendência das últimas semanas: <b>${e.base < 2 ? 'sem dados suficientes' : e.tendencia > 0.05 ? 'subindo (+' + nf(e.tendencia, 1) + ' pessoa/semana)' : e.tendencia < -0.05 ? 'caindo (' + nf(e.tendencia, 1) + ' pessoa/semana)' : 'estável'}</b>.</p>`
    + reTab(['Semana', '#nEfetivo médio/dia', '#nNecessário', '#nSaldo', 'Situação', 'Atividades em execução'], linhas)
    + `<p class="nota">Necessário = ${RE_PESSOAS_POR_ATIVIDADE} pessoas por atividade em execução (pré-montagem: no mínimo ${RE_PESSOAS_PREMONTAGEM}). Efetivo projetado = reta de tendência das últimas 6 semanas lançadas no DP (${e.base} semana(s) com dados).</p>`;
}
function reSecSuprimentos(d) {
  const s = d.sup;
  if (s.erro) return reErro(s);
  if (s.sem) return `<p class="nota">${esc(s.sem)}</p>`;
  const linhas = s.itens.map(i => `<tr><td><b>${esc(i.tag)}</b><div class="nota">${esc(i.produto)}</div></td><td class="n">${nf(i.retirado, 1)}</td><td class="n">${i.refs.length ? nf(i.esperado, 1) : '—'}</td><td class="n">${i.previstas != null ? nf(i.previstas, 1) : '—'}</td><td class="n"><b>${i.refs.length ? nf(i.realizadas, 1) : '—'}</b></td><td class="n">${i.perda != null ? (i.perda > 0 ? '+' : '') + nf(i.perda, 1) + '%' : '—'}</td><td>${reSm(i.sem[0], i.sem[1])}</td><td class="nota">${i.exato ? 'por apontamento: 8 por joist, parafuso da posição' : i.refs.map(r => `${esc(cap(r.nome))}: ${nf(r.por, 2)}/un`).join(' · ') || '—'}</td></tr>`);
  const aviso = s.modo === 'semana'
    ? `<p><b>Retirada da semana antecedente:</b> ${s.alvo.map(a => `${esc(a.nome)} <span class="nota">(semana de ${fd(a.data)}${a.origem === 'cadastrada' ? '' : ' · ' + esc(a.origem)})</span>`).join(' + ')} × produção de ${fd(d.ini)} a ${fd(d.corte)}.</p>`
    : `<p class="aviso">Nenhuma semana de consumo datada entre ${fd(s.alvoIni)} e ${fd(s.alvoFim)} (semana antecedente ao período). Mostrando o consumo ACUMULADO × produção acumulada. Informe a data de cada semana em Estoque › Consumo físico (✎ Editar coluna).</p>`;
  const semDt = s.semData.length && s.modo === 'semana' ? `<p class="nota">${s.semData.length} semana(s) do consumo ainda sem data e fora desta conta: ${s.semData.map(esc).join(', ')}.</p>` : '';
  return aviso + semDt + `<p>Material retirado do estoque pela empresa (consumo físico) comparado com o que as unidades realizadas exigiriam. <b>${s.verdes}</b> conforme(s) · <b>${s.amarelos}</b> em atenção · <b>${s.vermelhos}</b> não conforme(s)${s.semBase ? ` · ${s.semBase} sem referência de consumo por unidade` : ''}.</p>`
    + reTab(['Material (TAG)', '#nRetirado', '#nNecessário p/ o realizado', '#nUnidades previstas pelo material retirado', '#nUnidades realizadas', '#nPerda', 'Situação', 'Consumo por unidade'], linhas)
    + `<p class="nota">Unidades previstas = quanto o material retirado permitiria montar (retirado ÷ consumo por unidade do serviço); realizadas = produção lançada da empresa ${s.modo === 'semana' ? `no período (${fd(d.ini)} a ${fd(d.corte)})` : `acumulada até ${fdA(d.corte)}`}. Perda = (retirado − necessário) ÷ retirado. Situação: <b>CONFORME</b> até ${RE_PERDA_VERDE}% de perda · <b>ATENÇÃO</b> de ${RE_PERDA_VERDE} a ${RE_PERDA_AMARELO}% (ou retirada menor que o necessário — conferir lançamentos) · <b>NÃO CONFORME</b> acima de ${RE_PERDA_AMARELO}%; “sem referência” = serviço sem consumo por unidade cadastrado.${s.modo === 'semana' ? ' O consumo retirado numa semana é o material para a produção da semana seguinte.' : ''}</p>`;
}

const RE_CSS = `<style>
*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;margin:0;color:#14202b;font-size:12.5px;background:#fff}
.pag{max-width:1100px;margin:0 auto;padding:26px 28px}
h1{font-size:23px;margin:0 0 4px}h2{font-size:15px;margin:26px 0 8px;padding:6px 10px;background:#1f3a5f;color:#fff;border-radius:4px;text-transform:uppercase;letter-spacing:.03em}
h3{font-size:13px;margin:16px 0 6px;color:#1f3a5f}.sub-cab{color:#51606f;margin:0 0 14px}
table{width:100%;border-collapse:collapse;margin:6px 0 10px;font-size:11.5px}th,td{border:1px solid #d3dbe4;padding:4px 7px;text-align:left;vertical-align:top}
th{background:#eef2f7}td.n,th.n{text-align:right;white-space:nowrap}tr.grupo td{background:#f4f7fb}td.vazio{color:#7b8794;text-align:center}
.nota{color:#6b7886;font-size:10.5px}.neg{color:#b42318}.pos{color:#15803d}.aviso{background:#fff4e5;border:1px solid #f5c36b;padding:6px 10px;border-radius:4px}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px;margin:8px 0 12px}
.card{border:1px solid #d3dbe4;border-left:5px solid #94a3b8;border-radius:5px;padding:7px 10px;background:#fafbfd}.card .rot{font-size:10px;text-transform:uppercase;color:#51606f;letter-spacing:.03em}
.card .val{font-size:19px;font-weight:700;margin:2px 0}.card .sub{font-size:10.5px;color:#51606f}
.card.vd{border-left-color:#16a34a}.card.am{border-left-color:#eab308}.card.vm{border-left-color:#dc2626}.card.az{border-left-color:#2563eb}.card.nd{border-left-color:#94a3b8}
.sm{display:inline-flex;align-items:center;gap:5px;font-weight:700;font-size:10.5px;white-space:nowrap}.sm i{width:11px;height:11px;border-radius:50%;background:#94a3b8;display:inline-block}
.sm.vd i{background:#16a34a}.sm.am i{background:#eab308}.sm.vm i{background:#dc2626}
.mapa-fig{border:1px solid #d3dbe4;border-radius:4px;padding:6px;background:#fff;margin:6px 0;break-inside:avoid}.mapa-leg{margin:6px 0}
.bg{background:#e5eaf0;border-radius:3px;height:8px;min-width:80px}.bar{background:#2563eb;height:8px;border-radius:3px}
.emp-sec{page-break-before:always}.emp-sec:first-of-type{page-break-before:auto}
.topo-acoes{position:sticky;top:0;background:#fff;padding:8px 28px;border-bottom:1px solid #d3dbe4}.topo-acoes button{padding:6px 14px;border:0;background:#1f3a5f;color:#fff;border-radius:4px;cursor:pointer}
@media print{.topo-acoes{display:none}.pag{padding:10px}h2{break-after:avoid}table{break-inside:auto}tr{break-inside:avoid}}
</style>`;

function reSecao(titulo, html) { return `<h2>${titulo}</h2>${html}`; }
function reHtmlEmpresa(d) {
  return `<section class="emp-sec"><div class="pag">
    <h1>${esc(d.emp)}</h1><p class="sub-cab">Relatório da empresa · ${fdA(d.ini)} a ${fdA(d.fim)} · dados até ${fdA(d.corte)} (data de referência)</p>
    ${reSecao('Resumo executivo', reSecResumo(d))}
    ${reSecao('1. Resumo de produção do período', reSecProducao(d))}
    ${reSecao('2. Meta da semana — atingimento', reSecSemanas(d))}
    ${reSecao('3. Atividades que a empresa precisava iniciar', reSecAtividades(d))}
    ${reSecao('4. Plano 5W2H — atingimento', reSecPlanos(d))}
    ${reSecao('5. Avanço físico × catálogo de atividades (BM)', reSecBM(d))}
    ${reSecao('6. Previsto × realizado nas atividades da empresa', reSecPrevisto(d))}
    ${reSecao('7. Resumo financeiro e projeção', reSecFinanceiro(d))}
    ${reSecao('8. Equipamentos e abastecimento — custos e projeção', reSecEquip(d))}
    ${reSecao('9. Impactos gerados e sofridos', reSecImpactos(d))}
    ${reSecao('10. Tendência de efetivo (pessoal)', reSecEfetivo(d))}
    ${reSecao('11. Suprimentos — retirada da semana antecedente × joists realizados', reSecSuprimentos(d))}
  </div></section>`;
}
async function reHtml(ini, fim, emps) {
  if (typeof PL !== 'undefined') PL._atv = null;
  await plCarregar(true).catch(() => {});
  if (!window._regras_baixa) { regrasBaixa(() => {}); await window._regras_pend; }   // regras e IFC do mapa de montagem
  if (!window._frentes) { frentesMontagem(() => {}); await window._frentes_pend; }
  const c = minD(fim, ref), ls = reLinhas(c);
  const dados = emps.map(emp => reDados(emp, ini, fim, ls));
  await tplLogosCarregar();
  return tplDocumento({ titulo: 'Relatório das empresas', subtitulo: `Período de ${fdA(ini)} a ${fdA(fim)}`, meta: emps.join(' · '), corpo: dados.map(reHtmlEmpresa).join('') });
}

// ---------------------------------------------------------------- tela: botão do Painel (empresa do painel + período ao lado do botão)
// O botão vale para o painel escolhido (Geral = todas as empresas; EJ, CMM… = só a empresa) e para o período das caixas de data ao lado dele.
let reBarPer = '';
function reSincronizarBarra() {   // chamada a cada desenho do Painel: as datas acompanham o período do Painel até serem editadas
  const a = document.getElementById('reBarIni'), b = document.getElementById('reBarFim');
  if (!a || !b) return;
  const k = `${per.ini}|${per.fim}`;
  if (reBarPer !== k) { reBarPer = k; a.value = per.ini; b.value = per.fim; }
  const btn = document.getElementById('btnRelEmpresas');
  if (btn) btn.textContent = painelEmpFiltro ? `Relatório · ${painelEmpFiltro}` : 'Relatório das empresas';
}
// Antes de baixar, abre uma janela com a visualização do relatório (o próprio HTML, rolável); dali se baixa, imprime/salva em PDF ou fecha.
let reUltimo = null;
function reAbrirPrevia(html, nomeArq, titulo, opcoes = {}) {   // opcoes: { rotuloBaixar, baixar: fn } — baixar personalizado (PDF no servidor, PNG do mapa…)
  document.getElementById('reDlgPrevia')?.remove();
  const dlg = document.createElement('dialog');
  dlg.id = 'reDlgPrevia'; dlg.className = 're-previa';
  dlg.innerHTML = `<div class="re-previa-topo"><b>${esc(titulo)}</b><span class="nota">Visualização do relatório — confira antes de baixar</span>
      <span class="re-previa-acoes"><button type="button" class="btn primario" data-re-baixar>${esc(opcoes.rotuloBaixar || 'Baixar relatório')}</button><button type="button" class="btn" data-re-imprimir>Imprimir / salvar em PDF</button><button type="button" class="btn" data-re-fechar>Fechar</button></span></div>
    <iframe class="re-previa-quadro" title="Visualização do relatório"></iframe>`;
  document.body.appendChild(dlg);
  dlg.querySelector('iframe').srcdoc = typeof tplProtegerImpressao === 'function' ? tplProtegerImpressao(html) : html;
  reUltimo = { html, nomeArq, baixar: opcoes.baixar || null };
  dlg.addEventListener('close', () => dlg.remove());
  dlg.showModal();
}
async function reGerar() {
  const ini = document.getElementById('reBarIni').value, fim = document.getElementById('reBarFim').value, btn = document.getElementById('btnRelEmpresas');
  if (!ehISO(ini) || !ehISO(fim) || fim < ini) { toast('Informe um período válido ao lado do botão.', true); return; }
  const emps = painelEmpFiltro ? [painelEmpFiltro] : (M.empresas || []).map(e => e.nome).filter(Boolean);
  const rot = btn.textContent; btn.disabled = true; btn.textContent = 'Montando…';
  try {
    const html = await reHtml(ini, fim, emps);
    reAbrirPrevia(html, `relatorio-${painelEmpFiltro ? painelEmpFiltro.replace(/\s+/g, '-') : 'empresas'}-${ini}_a_${fim}.html`,
      `${painelEmpFiltro || 'Todas as empresas'} · ${fdA(ini)} a ${fdA(fim)}`);
  } catch (e) { console.error(e); toast('Não foi possível gerar: ' + (e.message || e), true); }
  finally { btn.disabled = false; btn.textContent = rot; }
}
document.addEventListener('click', ev => {
  const t = ev.target;
  if (t.closest && t.closest('#btnRelEmpresas')) return reGerar();
  if (t.closest && t.closest('[data-re-baixar]') && reUltimo) { if (reUltimo.baixar) { reUltimo.baixar(); return; } baixarHtml(reUltimo.nomeArq, reUltimo.html); return toast('Relatório baixado.'); }
  if (t.closest && t.closest('[data-re-imprimir]')) { const f = document.querySelector('#reDlgPrevia iframe'); return f && f.contentWindow && f.contentWindow.print(); }
  if (t.closest && t.closest('#reDlgPrevia [data-re-fechar]')) return document.getElementById('reDlgPrevia')?.close();
});
