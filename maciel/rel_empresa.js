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
const reUnTxt = (v, un) => `${nf(v, un === '%' ? 1 : 1)}${un ? ' ' + esc(un) : ''}`;

// ---------------------------------------------------------------- 1. produção do período
function reProducao(emp, ini, fim, c) {
  const pares = reSemFase(() => paresMeta()).filter(([e]) => e === emp);
  const linhas = pares.map(([e, s]) => kpiPer(e, s, ini, fim, c)).filter(k => k.prevTotal > 0 || k.real > 0);
  const prev = soma0(linhas, k => k.prev), real = soma0(linhas, k => k.real), total = soma0(linhas, k => k.prevTotal);
  return { linhas, prev, real, total, pct: prev > 0 ? real / prev * 100 : null,
    atingidas: linhas.filter(k => k.prevTotal > 0 && k.real >= k.prevTotal * .999).length, comMeta: linhas.filter(k => k.prevTotal > 0).length };
}

// ---------------------------------------------------------------- 2. meta de cada semana
function reMetaSemanal(emp, ini, fim, c) {
  const pares = reSemFase(() => paresMeta()).filter(([e]) => e === emp);
  return reSemanas(ini, fim).map(w => {
    const ks = pares.map(([e, s]) => kpiPer(e, s, w.ini, w.fim, c)).filter(k => k.prevTotal > 0);
    const atingidas = ks.filter(k => k.real >= k.prevTotal * .999).length;
    const encerrada = w.fim <= c, noPeriodo = w.ini <= c;
    return { ...w, ks, atingidas, total: ks.length, encerrada, noPeriodo,
      ok: ks.length ? atingidas === ks.length : null, pct: soma0(ks, k => k.prevTotal) > 0 ? soma0(ks, k => Math.min(k.real, k.prevTotal)) / soma0(ks, k => k.prevTotal) * 100 : null };
  });
}

// ---------------------------------------------------------------- 3. atividades que a empresa precisava iniciar
function reAtividades(emp, ini, fim, c, ls) {
  const linhas = [];
  ls.forEach(l => {
    const it = l.it, emps = plEmpresasDe(it), meu = (l.porEmp || []).find(x => x.nome === emp);
    if (!emps.includes(emp) && !meu) return;
    if (!l.ini || l.ini > fim) return;                               // ainda não era para começar
    if (l.status === 'CONCLUÍDO' && l.rf && l.rf < ini) return;       // já encerrada antes do período
    const ds = meu ? meu.ds : [], ate = soma0(ds.filter(([d]) => d <= c), ([, v]) => v), per = soma0(ds.filter(([d]) => d >= ini && d <= fim && d <= c), ([, v]) => v);
    const compartilhada = emps.length > 1;
    linhas.push({ nome: cap(it.servico_exib || it.servico), frente: it.frente, ini: l.ini, prazo: l.prazo, un: plUnidade(it), qtd: Number(it.qtd) || 0, compartilhada, n: Math.max(1, emps.length),
      ate, per, primeira: ds.length ? ds[0][0] : null, iniciada: ate > 0, noPeriodo: l.ini >= ini, status: l.status, atrasadaDeInicio: l.ini < c && !(ate > 0) });
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

// ---------------------------------------------------------------- 5. planos 5W2H (a meta do plano foi atingida?)
function rePlanos(emp, ini, fim, c) {
  const planos = (PL.dados?.planos || []).filter(p => !['rascunho', 'arquivado'].includes(p.status) && p.inicio && p.fim && Array.isArray(p.itens) && p.inicio <= fim && p.fim >= ini);
  const rows = [];
  planos.forEach(p => {
    const pc = plPlanoCombinado([p], emp);
    if (!pc) return;
    const cc = plCalc(pc), st = plStatusPlano(cc);
    const encerrado = p.fim <= c, atingido = cc.pctReal >= 99.5;
    const veredito = atingido ? ['vd', 'PLANO ATINGIDO'] : encerrado ? ['vm', 'PLANO NÃO ATINGIDO'] : cc.desvio >= -1 ? ['vd', 'NO RITMO DO PLANO'] : cc.desvio >= -5 ? ['am', 'ABAIXO DO PLANEJADO'] : ['vm', 'MUITO ABAIXO DO PLANEJADO'];
    rows.push({ plano: p, c: cc, st, veredito, itens: cc.itens });
  });
  return { rows };
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
  return { itens, contrato, acum, per, pctAcum: contrato ? acum / contrato : 0, pctPer: contrato ? per / contrato : 0, saldo: contrato - acum, bms };
}

// ---------------------------------------------------------------- 7. projeção financeira (planos 5W2H ativos × preço do BM)
function reProjecao(emp, bm) {
  const pl = plPlanoCombinado(pjPlanosAtivos(), emp);
  if (pl) {
    const c0 = plCalc(pl), c = pjDaEmpresa(c0, emp, pl), r = pjCalc(pl, c, 1, 'RÓTULA');
    const semanas = new Map();
    r.itens.forEach(i => i.proj.forEach((v, d) => { if (d > r.base) semanas.set(segunda(d), (semanas.get(segunda(d)) || 0) + v * i.p); }));
    const linhas = r.itens.map(i => {
      let ac = Math.min(i.qtd, i.x.realAc);
      i.proj.forEach((v, d) => { if (d <= r.fimPlano) ac += v; });
      return { atividade: i.x.it.atividade, un: i.x.it.unidade, qtd: i.qtd, preco: i.p, valor: i.valor, exec: Math.min(i.x.realAc, i.qtd) * i.p, pctFis: i.qtd ? Math.min(1, i.x.realAc / i.qtd) * 100 : 0,
        noFim: Math.min(ac, i.qtd) * i.p, saldo: Math.max(0, i.qtd - i.x.realAc) * i.p, termina: i.termina, fim: i.x.it.fim, semValor: i.pr.origem === 'sem' };
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
function reEquipamentos(emp, ini, fim, c, atv) {
  const dados = relEquipDados(emp, ini, fim, 'todos'), tot = dados.empresas.find(x => x.empresa === emp) || { custo: 0, litros: 0, comb: 0, total: 0, dias: new Set() };
  // semanas até o fim das atividades da empresa (máx. 26) para o horizonte da projeção
  const fimAtv = atv.linhas.filter(x => x.status !== 'CONCLUÍDO' && x.prazo).map(x => x.prazo).sort().pop();
  const horizonteSemanas = Math.min(26, Math.max(4, fimAtv && fimAtv > c ? Math.ceil((diasEntre(c, fimAtv) + 1) / 7) : 4));
  const abast = reAbastecimento(emp, c, horizonteSemanas);
  // histórico dos últimos BMs: custo de equipamento por dia útil e por unidade produzida nas atividades relacionadas a equipamento
  const relac = /ICAMENTO|VIGA|MONTAGEM|TELHA|FECHAMENTO|MARQUISE|CALHA|PERFILAGEM/;
  const e = empresa(emp), servRel = [...new Map((e?.servicos || []).filter(s => relac.test(ganNorm(s.nome))).map(s => [ganNorm(s.nome), s.nome])).values()];
  const primeiroUso = (T.usos || []).filter(u => empresasDe(u.empresa).includes(emp) && u.data).map(u => u.data).sort()[0] || ini;
  const bms = bmPeriodos(emp).slice(-3).map(p => {
    const pIni = p.ini === '0000-01-01' ? primeiroUso : p.ini, pFim = minD(p.fim, c);
    if (pFim < pIni) return null;
    const dd = bmDeducoes(emp, { ...p, ini: p.ini }, 0), du = Math.max(1, contarDiasUteis(add(pIni, -1), pFim));
    const un = soma0(servRel, s => { const k = prodServico(s, emp, pIni, pFim); return k; });
    return { p, equip: dd.equip, comb: dd.comb, litros: dd.litros, du, un, ini: pIni, fim: pFim };
  }).filter(Boolean);
  const pesos = bms.map((_, k) => k + 1), sp = soma0(pesos, w => w) || 1;
  const diaEquip = bms.length ? bms.reduce((s, b, k) => s + (b.equip / b.du) * pesos[k], 0) / sp : null;   // R$ por dia útil, recente pesa mais
  const comUn = bms.filter(b => b.un > 0 && b.equip > 0);
  const porUn = comUn.length ? soma0(comUn, b => b.equip) / soma0(comUn, b => b.un) : null;
  const saldoUn = soma0(atv.linhas.filter(x => x.status !== 'CONCLUÍDO' && relac.test(ganNorm(x.nome))), x => Math.max(0, x.qtd / x.n - x.ate));
  const duRestantes = fimAtv && fimAtv > c ? contarDiasUteis(c, fimAtv) : 0;
  const porAtividade = porUn != null && saldoUn > 0 ? porUn * saldoUn : null, porTempo = diaEquip != null && duRestantes > 0 ? diaEquip * duRestantes : null;
  return { dados, tot, abast, bms, diaEquip, porUn, saldoUn, duRestantes, porAtividade, porTempo, recomendado: porAtividade != null ? porAtividade : porTempo,
    recomendadoBase: porAtividade != null ? 'atividade' : porTempo != null ? 'tempo' : null, horizonteSemanas, fimAtv };
}

// ---------------------------------------------------------------- 9. impactos gerados e sofridos
function reImpactos(emp, ini, fim, c) {
  const lim = { ini, fim: c };
  const todos = impactosComAutomaticos().filter(i => { const p = periodoImpacto(i); return p.ini <= fim && p.fim >= ini; });
  const sofridos = todos.filter(i => impactoEmpresas(i).includes(emp));
  const gerados = todos.filter(i => { const f = fornecedorDeSetor(impactoSetor(i)); return f.isForn && ganNorm(f.nome) === ganNorm(emp); });
  const semEmpresa = todos.filter(i => !impactoEmpresas(i).length).length;
  const rk = rankingImpactos(todos, [emp], lim), me = rk.empresas.find(x => x.nome === emp);
  const linha = (i, tipo) => ({ tipo, i, dias: somaMapa(diasPorImpacto(i, lim)) });
  const linhas = [...sofridos.map(i => linha(i, 'SOFRIDO')), ...gerados.filter(i => !sofridos.includes(i)).map(i => linha(i, 'GERADO'))].sort((a, b) => String(a.i.data).localeCompare(String(b.i.data)));
  return { linhas, sofridos: sofridos.length, gerados: gerados.length, diasDiretos: me ? me.dias : 0, diasCascata: me ? me.indireto : 0, semEmpresa, lim };
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
function reSuprimentos(emp, c) {
  const cf = estConsumoComCadastros(), regras = M.estoque_ifc?.regras || {}, servs = regras.consumo_por_servico || {};
  if (!(cf.empresas || []).includes(emp)) return { sem: 'O consumo físico de material só é lançado para ' + (cf.empresas || []).join(' e ') + '.' };
  const mats = new Map(estMateriaisComCadastros().map(m => [ganNorm(m.tag), m]));
  const prodCache = new Map(), prod = nome => { if (!prodCache.has(nome)) prodCache.set(nome, prodServico(nome, emp, '0000-01-01', c)); return prodCache.get(nome); };
  const temServ = nome => !nome.startsWith('_') && M.empresas.some(e => e.nome === emp && e.servicos.some(s => s.nome === nome));
  const itens = [];
  (cf.itens || []).forEach(m => {
    const retirado = soma0(Object.values(m.consumo_semanas || {}), d => Number(d?.[emp]) || 0);
    if (!(retirado > 0)) return;
    const refs = Object.entries(servs).filter(([nome, conf]) => temServ(nome) && (conf.itens || []).some(x => ganNorm(x.codigo) === ganNorm(m.tag)))
      .map(([nome, conf]) => ({ nome, por: Number(conf.itens.find(x => ganNorm(x.codigo) === ganNorm(m.tag)).por_unidade) || 0, real: prod(nome) })).filter(x => x.por > 0);
    const esperado = soma0(refs, x => x.por * x.real), realizadas = soma0(refs, x => x.real);
    const previstas = refs.length ? (esperado > 0 ? retirado * realizadas / esperado : retirado / refs[0].por) : null;   // unidades do serviço que o material retirado permitiria montar
    const perda = refs.length ? (retirado - esperado) / retirado * 100 : null;
    const sem = perda == null ? ['nd', 'sem referência'] : perda < 0 ? ['nd', 'retirada abaixo do necessário'] : perda <= RE_PERDA_VERDE ? ['vd', 'perda dentro de 3%'] : perda <= RE_PERDA_AMARELO ? ['am', 'perda de 3 a 6%'] : ['vm', 'perda acima de 6%'];
    const mat = mats.get(ganNorm(m.tag));
    itens.push({ tag: m.tag, produto: m.produto || mat?.produto || m.tag, material: mat?.material || '', retirado, refs, esperado, previstas, realizadas, perda, sem });
  });
  itens.sort((a, b) => (b.perda ?? -999) - (a.perda ?? -999));
  const conta = cls => itens.filter(i => i.sem[0] === cls).length;
  return { itens, verdes: conta('vd'), amarelos: conta('am'), vermelhos: conta('vm'), semBase: conta('nd') };
}

// ---------------------------------------------------------------- montagem dos dados e do documento
function reDados(emp, ini, fim, ls) {
  const c = minD(fim, ref), d = { emp, ini, fim, corte: c };
  d.producao = reTry(() => reProducao(emp, ini, fim, c), 'produção');
  d.semanas = reTry(() => reMetaSemanal(emp, ini, fim, c), 'meta semanal');
  d.atividades = reTry(() => reAtividades(emp, ini, fim, c, ls), 'atividades');
  d.previstoReal = reTry(() => rePrevistoRealizado(emp, ini, fim, c), 'previsto × realizado');
  d.planos = reTry(() => rePlanos(emp, ini, fim, c), 'planos');
  d.bm = reTry(() => reBM(emp, ini, fim, c), 'avanço físico e financeiro');
  d.proj = reTry(() => reProjecao(emp, d.bm), 'projeção financeira');
  d.equip = reTry(() => reEquipamentos(emp, ini, fim, c, d.atividades.erro ? { linhas: [] } : d.atividades), 'equipamentos');
  d.impactos = reTry(() => reImpactos(emp, ini, fim, c), 'impactos');
  d.efetivo = reTry(() => reEfetivo(emp, ini, fim, c, ls), 'efetivo');
  d.sup = reTry(() => reSuprimentos(emp, c), 'suprimentos');
  return d;
}
const reErro = x => (x && x.erro ? `<p class="aviso">Não foi possível montar esta parte: ${esc(x.erro)}</p>` : '');
const reTab = (cab, linhas, rodape = '') => `<table><thead><tr>${cab.map(h => `<th${/^(#n)/.test(h) ? ' class="n"' : ''}>${h.replace(/^#n/, '')}</th>`).join('')}</tr></thead><tbody>${linhas.join('') || `<tr><td colspan="${cab.length}" class="vazio">Sem registros no período.</td></tr>`}</tbody>${rodape}</table>`;

function reSecResumo(d) {
  const card = (rot, val, sub, cls) => `<div class="card ${cls || ''}"><div class="rot">${rot}</div><div class="val">${val}</div><div class="sub">${sub}</div></div>`;
  const p = d.producao, pl = d.planos, bm = d.bm, im = d.impactos, ef = d.efetivo, su = d.sup, at = d.atividades;
  const fp = p.erro ? ['nd', ''] : reFarolPct(p.pct, !(p.prev > 0));
  const planoPior = !pl.erro && pl.rows.length ? pl.rows.reduce((a, r) => (r.veredito[0] === 'vm' ? r : a), pl.rows[0]) : null;
  return `<div class="cards">
    ${card('Produção no período', p.erro ? '—' : rePct(p.pct), p.erro ? '' : `${nf(p.real, 1)} realizados de ${nf(p.prev, 1)} previstos até ${fd(d.corte)}`, fp[0])}
    ${card('Metas dos serviços', p.erro ? '—' : `${p.atingidas}/${p.comMeta}`, 'serviços com a meta do período atingida', p.erro || !p.comMeta ? 'nd' : p.atingidas === p.comMeta ? 'vd' : p.atingidas ? 'am' : 'vm')}
    ${card('Atividades a iniciar', at.erro ? '—' : `${at.naoIniciadas} não iniciada(s)`, at.erro ? '' : `${at.iniciadas} iniciada(s) de ${at.linhas.length}`, at.erro ? 'nd' : at.naoIniciadas ? 'vm' : 'vd')}
    ${card('Plano 5W2H', planoPior ? planoPior.veredito[1] : 'sem plano', planoPior ? `${rePct(planoPior.c.pctReal)} realizado × ${rePct(planoPior.c.pctPlan)} planejado` : 'nenhum plano da empresa no período', planoPior ? planoPior.veredito[0] : 'nd')}
    ${card('Avanço físico (catálogo BM)', !bm.erro && !bm.sem ? rePct(bm.pctAcum * 100, 1) : '—', !bm.erro && !bm.sem ? `${rePct(bm.pctPer * 100, 1)} no período` : 'sem catálogo de atividades', 'az')}
    ${card('Medido acumulado', !bm.erro && !bm.sem ? reMoeda(bm.acum) : '—', !bm.erro && !bm.sem ? `${reMoeda(bm.per)} no período · saldo ${reMoeda(bm.saldo)}` : '', 'az')}
    ${card('Impactos', im.erro ? '—' : fmtD(im.diasDiretos + im.diasCascata), im.erro ? '' : `${im.sofridos} sofrido(s) · ${im.gerados} gerado(s)`, !im.erro && (im.diasDiretos + im.diasCascata) > 0 ? 'am' : 'vd')}
    ${card('Efetivo médio no período', ef.erro || ef.mediaDia == null ? '—' : nf(ef.mediaDia, 1), ef.erro ? '' : `pico ${nf(ef.pico, 0)} · ${nf(ef.homemDia, 0)} homem-dia`, 'az')}
    ${card('Perda de material', su.erro || su.sem ? '—' : su.vermelhos ? `${su.vermelhos} item(ns) vermelho(s)` : su.amarelos ? `${su.amarelos} item(ns) amarelo(s)` : 'dentro de 3%', su.erro || su.sem ? 'material retirado × joists realizados' : `${su.verdes} verde(s) · ${su.amarelos} amarelo(s) · ${su.vermelhos} vermelho(s)`, su.erro || su.sem ? 'nd' : su.vermelhos ? 'vm' : su.amarelos ? 'am' : 'vd')}
  </div>`;
}

function reSecProducao(d) {
  const p = d.producao;
  if (p.erro) return reErro(p);
  const linhas = p.linhas.map(k => { const desvio = k.real - k.prev, f = reFarolPct(k.pct, k.prevTotal === 0); return `<tr><td>${esc(cap(k.serv))}${k.un ? ` <span class="nota">(${esc(k.un)})</span>` : ''}</td><td class="n">${nf(k.prevTotal, 1)}</td><td class="n">${nf(k.prev, 1)}</td><td class="n"><b>${nf(k.real, 1)}</b></td><td class="n ${desvio < 0 ? 'neg' : 'pos'}">${k.prevTotal ? (desvio > 0 ? '+' : '') + nf(desvio, 1) : '—'}</td><td class="n">${rePct(k.pct)}</td><td>${reSm(f[0], f[1])}</td></tr>`; });
  return reTab(['Serviço', '#nMeta do período', '#nPrevisto até ' + fd(d.corte), '#nRealizado', '#nDesvio', '#n% do previsto', 'Situação'], linhas)
    + `<p class="nota">Total: ${nf(p.real, 1)} realizados de ${nf(p.prev, 1)} previstos até ${fdA(d.corte)} (${rePct(p.pct)}); ${p.atingidas} de ${p.comMeta} serviço(s) com a meta do período atingida.</p>`;
}
function reSecSemanas(d) {
  const s = d.semanas;
  if (s.erro) return reErro(s);
  const linhas = s.map(w => {
    const st = w.ok == null ? reSm('nd', 'sem meta') : !w.noPeriodo ? reSm('nd', 'semana futura') : w.ok ? reSm('vd', w.encerrada ? 'META DA SEMANA ATINGIDA' : 'meta atingida até agora') : reSm(w.encerrada ? 'vm' : 'am', w.encerrada ? 'META DA SEMANA NÃO ATINGIDA' : 'em andamento');
    const det = w.ks.map(k => `${k.real >= k.prevTotal * .999 ? '✓' : '✗'} ${esc(cap(k.serv))}: ${nf(k.real, 1)}/${nf(k.prevTotal, 1)}${k.un ? ' ' + esc(k.un) : ''}`).join('<br>');
    return `<tr><td>${fd(w.ini)} a ${fd(w.fim)}</td><td class="n">${w.total ? `${w.atingidas} de ${w.total}` : '—'}</td><td class="n">${rePct(w.pct)}</td><td>${st}</td><td class="nota">${det || '—'}</td></tr>`;
  });
  return reTab(['Semana', '#nServiços com meta atingida', '#nMeta cumprida', 'Meta da semana', 'Serviços (realizado/meta)'], linhas);
}
function reSecAtividades(d) {
  const a = d.atividades;
  if (a.erro) return reErro(a);
  const linhas = a.linhas.map(x => {
    const st = x.iniciada ? reSm('vd', `INICIADA${x.primeira ? ' em ' + fd(x.primeira) : ''}`) : reSm('vm', x.atrasadaDeInicio ? 'NÃO INICIADA (atrasada)' : 'NÃO INICIADA');
    return `<tr><td><b>${esc(x.nome)}</b><div class="nota">${esc(cap(x.frente))}${x.compartilhada ? ` · dividida entre ${x.n} empresas` : ''}</div></td><td>${fdA(x.ini)}${x.noPeriodo ? '' : '<div class="nota">anterior ao período</div>'}</td><td>${fdA(x.prazo)}</td><td>${st}</td>
      <td class="n">${nf(x.per, 1)} ${esc(x.un)}</td><td class="n">${nf(x.ate, 1)} ${esc(x.un)}${x.qtd ? `<div class="nota">de ${nf(x.qtd / x.n, 1)} ${esc(x.un)}${x.compartilhada ? ' (parte da empresa)' : ''}</div>` : ''}</td></tr>`;
  });
  return `<p>${a.naoIniciadas ? `<b class="neg">${a.naoIniciadas} atividade(s) que a empresa deveria ter iniciado ainda não foi(ram) iniciada(s).</b>` : '<b class="pos">Todas as atividades previstas para iniciar já foram iniciadas.</b>'} ${a.iniciadas} iniciada(s).</p>`
    + reTab(['Atividade', 'Início previsto', 'Prazo', 'Situação', '#nRealizado no período', '#nAcumulado'], linhas);
}
function reSecPrevisto(d) {
  const p = d.previstoReal;
  if (p.erro) return reErro(p);
  const linhas = p.rows.map(r => { const f = reFarolPct(r.pct, !r.previsto); return `<tr><td>${esc(cap(r.serv))}</td><td class="n">${nf(r.previsto, 1)}${r.un ? ' ' + r.un : ''}${r.n > 1 ? `<div class="nota">cronograma do cliente ÷ ${r.n} empresas</div>` : `<div class="nota">${esc(r.base)}</div>`}</td><td class="n"><b>${nf(r.real, 1)}${r.un ? ' ' + r.un : ''}</b></td><td class="n">${rePct(r.pct)}</td><td>${reSm(f[0], f[1].replace('meta ', ''))}</td><td class="n">${nf(r.acum, 1)}${r.un ? ' ' + r.un : ''}</td></tr>`; });
  return reTab(['Atividade', '#nPrevisto no período', '#nRealizado no período', '#n% atingido', 'Situação', '#nAcumulado da obra'], linhas);
}
function reSecPlanos(d) {
  const p = d.planos;
  if (p.erro) return reErro(p);
  if (!p.rows.length) return '<p class="nota">Nenhum plano 5W2H da empresa cruza este período.</p>';
  return p.rows.map(r => `<h3>${esc(r.plano.nome)} <span class="nota">${fdA(r.plano.inicio)} a ${fdA(r.plano.fim)}</span> ${reSm(r.veredito[0], r.veredito[1])}</h3>
    <p class="nota">Realizado ${rePct(r.c.pctReal, 1)} × planejado até hoje ${rePct(r.c.pctPlan, 1)} (desvio ${r.c.desvio >= 0 ? '+' : ''}${nf(r.c.desvio, 1)} p.p.) · situação ${esc(r.st)}${r.c.terminaEm ? ` · no ritmo atual termina em ${fdA(r.c.terminaEm)}` : ''}.</p>`
    + reTab(['Atividade', '#nPlano', '#nPlanejado até hoje', '#nRealizado', '#nFalta', 'Situação'], r.itens.map(x => `<tr><td>${esc(x.it.atividade)}</td><td class="n">${plFmt(x.it.qtd, x.it.unidade)} ${esc(x.it.unidade)}</td><td class="n">${plFmt(x.planAc, x.it.unidade)}</td><td class="n"><b>${plFmt(x.realAc, x.it.unidade)}</b></td><td class="n">${plFmt(x.falta, x.it.unidade)}</td><td>${plFarol ? `<span class="nota">${esc(x.status)}</span>` : esc(x.status)}</td></tr>`))).join('');
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
    <div class="card az"><div class="rot">Medido acumulado</div><div class="val">${reMoeda(b.acum)}</div><div class="sub">${rePct(b.pctAcum * 100, 1)} do contrato</div></div>
    <div class="card az"><div class="rot">Medido no período</div><div class="val">${reMoeda(b.per)}</div><div class="sub">${rePct(b.pctPer * 100, 1)} do contrato</div></div>
    <div class="card"><div class="rot">Saldo a medir</div><div class="val">${reMoeda(b.saldo)}</div><div class="sub">${rePct((1 - b.pctAcum) * 100, 1)} do contrato</div></div></div>`;
  h += '<h3>Medições (BM)</h3>' + reTab(['BM', '#nMedido no período (R$)', '#n% do contrato no período', '#n% acumulado', '#nA faturar (R$)', 'Situação'],
    b.bms.map(x => `<tr><td>BM${x.p.n} <span class="nota">${x.p.cortado ? 'corte ' + fdA(x.p.fim) : 'até ' + fdA(x.p.fim)}</span></td><td class="n">${reMoeda(x.medidoPer)}</td><td class="n">${rePct(x.pctPer * 100, 1)}</td><td class="n">${rePct(x.pctAcum * 100, 1)}</td><td class="n">${reMoeda(x.faturar)}</td><td>${x.fechado ? 'fechado' : 'em aberto'}</td></tr>`));
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
  const ab = q.abast, tot = q.tot;
  let h = `<div class="cards"><div class="card"><div class="rot">Equipamentos no período</div><div class="val">${reMoeda(tot.custo)}</div><div class="sub">${nf(tot.dias.size || 0, 0)} dia(s) com uso</div></div>
    <div class="card"><div class="rot">Abastecimento no período</div><div class="val">${reMoeda(tot.comb)}</div><div class="sub">${nf(tot.litros, 0)} litros</div></div>
    <div class="card az"><div class="rot">Projeção de equipamentos</div><div class="val">${q.recomendado != null ? reMoeda(q.recomendado) : '—'}</div><div class="sub">${q.recomendadoBase === 'atividade' ? 'pelo custo por unidade nos últimos BMs × saldo das atividades' : q.recomendadoBase === 'tempo' ? 'pelo custo por dia útil dos últimos BMs × dias restantes' : 'sem base nos BMs'}</div></div>
    <div class="card az"><div class="rot">Projeção de abastecimento</div><div class="val">${ab.sem ? '—' : reMoeda(ab.horizonte)}</div><div class="sub">${ab.sem ? 'sem registros de abastecimento' : `próximas ${q.horizonteSemanas} semana(s) · ${reMoeda(ab.custoSemana)}/semana`}</div></div></div>`;
  h += '<h3>Equipamentos usados no período</h3>' + reTab(['Equipamento', 'Responsável', '#nDias', '#nCusto equip.', '#nLitros', '#nCombustível'],
    q.dados.equipamentos.filter(x => x.emps.has(d.emp)).map(x => `<tr><td>${esc(x.equipamento)}</td><td>${esc(x.resp)}</td><td class="n">${x.dias.size}</td><td class="n">${reMoeda(x.custo)}</td><td class="n">${nf(x.litros, 0)}</td><td class="n">${reMoeda(x.comb)}</td></tr>`));
  h += '<h3>Projeção de custo de equipamentos (últimos BMs e atividades relacionadas)</h3>';
  h += reTab(['BM', 'Período', '#nDias úteis', '#nCusto equip. (R$)', '#nR$ / dia útil', '#nUnid. produzidas (atividades relacionadas)', '#nR$ / unidade'], q.bms.map(b => `<tr><td>BM${b.p.n}${b.p.fechado ? '' : ' (aberto)'}</td><td>${fd(b.ini)} a ${fd(b.fim)}</td><td class="n">${b.du}</td><td class="n">${reMoeda(b.equip)}</td><td class="n">${reMoeda(b.equip / b.du)}</td><td class="n">${nf(b.un, 1)}</td><td class="n">${b.un > 0 && b.equip > 0 ? reMoeda(b.equip / b.un) : '—'}</td></tr>`));
  h += `<p class="nota">Método: custo médio por dia útil (BM mais recente pesa mais) = ${q.diaEquip != null ? reMoeda(q.diaEquip) : '—'}; custo por unidade produzida = ${q.porUn != null ? reMoeda(q.porUn) : '—'}. Saldo das atividades relacionadas (guindaste/plataforma): ${nf(q.saldoUn, 1)} unid. · ${q.duRestantes} dia(s) útil(eis) até ${q.fimAtv ? fdA(q.fimAtv) : '—'}. `
    + `${q.porAtividade != null ? `Pela atividade: <b>${reMoeda(q.porAtividade)}</b>. ` : ''}${q.porTempo != null ? `Pelo tempo: <b>${reMoeda(q.porTempo)}</b>. ` : ''}Vale a projeção pela atividade quando há histórico de produção; senão, a pelo tempo.</p>`;
  h += '<h3>Projeção de abastecimento (média inteligente dos últimos registros)</h3>';
  if (ab.sem) h += '<p class="nota">Sem registros de abastecimento da empresa para calcular a média.</p>';
  else h += reTab(['Data', '#nLitros', '#nValor (R$)', '#nR$ / litro', 'Considerado'], ab.dias.map(x => `<tr><td>${fdA(x.data)}</td><td class="n">${nf(x.litros, 0)}</td><td class="n">${reMoeda(x.valor)}</td><td class="n">${x.valor > 0 ? nf(x.valor / x.litros, 2) : '—'}</td><td>${ab.validos.includes(x) ? 'sim' : '<span class="nota">atípico — descartado</span>'}</td></tr>`))
    + `<p class="nota">Método: dos últimos ${ab.dias.length} abastecimentos, descartam-se os atípicos (menos de 40% ou mais de 250% da mediana)${ab.descartados ? ` — ${ab.descartados} descartado(s)` : ''}; litros por abastecimento = média ponderada (os mais recentes pesam mais) = <b>${nf(ab.litrosMedio, 0)} L</b>; preço = mediana dos últimos 5 = <b>R$ ${nf(ab.preco, 2)}/L</b>; frequência = <b>${nf(ab.porSemana, 1)} abastecimento(s)/semana</b> (considera o tempo parado até ${fd(d.corte)}). Projeção = ${nf(ab.litrosSemana, 0)} L/semana × preço = <b>${reMoeda(ab.custoSemana)}/semana</b>; próximas 4 semanas ${reMoeda(ab.quatro)}; até o fim das atividades (${ab.horizonteSemanas} semana(s)) ${reMoeda(ab.horizonte)}.</p>`;
  return h;
}
function reSecImpactos(d) {
  const m = d.impactos;
  if (m.erro) return reErro(m);
  const linhas = m.linhas.map(x => `<tr><td>${fdA(x.i.data)}</td><td>${reSm(x.tipo === 'GERADO' ? 'am' : 'vm', x.tipo)}</td><td>${esc(x.i.servico || '—')}</td><td>${esc(impactoSetor(x.i))}</td><td>${esc(impactoEmpresasTexto(x.i))}</td><td>${esc(x.i.motivo || '')}</td><td class="n"><b>${fmtD(x.dias)}</b></td><td>${x.i.solucionado ? 'solucionado ' + fdA(x.i.solucionado) : '<b class="neg">em aberto</b>'}</td></tr>`);
  return `<p><b>${m.sofridos}</b> impacto(s) sofrido(s) e <b>${m.gerados}</b> gerado(s) pela empresa (setor “Fornecedor — ${esc(d.emp)}”) no período. Dias úteis impactados: <b>${fmtD(m.diasDiretos)}</b> direto${m.diasCascata ? ` + <b>${fmtD(m.diasCascata)}</b> por efeito cascata (atividades anteriores do fluxo atrasaram o início)` : ''}.${m.semEmpresa ? ` Há ${m.semEmpresa} impacto(s) sem empresa definida (não entram nesta lista).` : ''}</p>`
    + reTab(['Data', 'Tipo', 'Atividade', 'Setor responsável', 'Empresa(s) afetada(s)', 'Motivo', '#nDias úteis no período', 'Situação'], linhas)
    + `<p class="nota">Critério: dias úteis reais do calendário dentro de ${fdA(m.lim.ini)} a ${fdA(m.lim.fim)}; cada dia conta uma vez, mesmo com vários impactos.</p>`;
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
  const linhas = s.itens.map(i => `<tr><td><b>${esc(i.tag)}</b><div class="nota">${esc(i.produto)}</div></td><td class="n">${nf(i.retirado, 1)}</td><td class="n">${i.refs.length ? nf(i.esperado, 1) : '—'}</td><td class="n">${i.previstas != null ? nf(i.previstas, 1) : '—'}</td><td class="n"><b>${i.refs.length ? nf(i.realizadas, 1) : '—'}</b></td><td class="n">${i.perda != null ? (i.perda > 0 ? '+' : '') + nf(i.perda, 1) + '%' : '—'}</td><td>${reSm(i.sem[0], i.sem[1])}</td><td class="nota">${i.refs.map(r => `${esc(cap(r.nome))}: ${nf(r.por, 2)}/un`).join(' · ') || '—'}</td></tr>`);
  return `<p>Material retirado do estoque pela empresa (consumo físico) comparado com o que as unidades realizadas exigiriam. <b>${s.verdes}</b> verde(s) · <b>${s.amarelos}</b> amarelo(s) · <b>${s.vermelhos}</b> vermelho(s)${s.semBase ? ` · ${s.semBase} sem referência de consumo por unidade` : ''}.</p>`
    + reTab(['Material (TAG)', '#nRetirado', '#nNecessário p/ o realizado', '#nUnidades previstas pelo material retirado', '#nUnidades realizadas', '#nPerda', 'Sinal', 'Consumo por unidade'], linhas)
    + `<p class="nota">Unidades previstas = quanto o material retirado permitiria montar (retirado ÷ consumo por unidade do serviço); realizadas = produção lançada da empresa (acumulada até ${fdA(d.corte)}). Perda = (retirado − necessário) ÷ retirado. Sinal: <b>verde</b> até ${RE_PERDA_VERDE}% · <b>amarelo</b> de ${RE_PERDA_VERDE} a ${RE_PERDA_AMARELO}% · <b>vermelho</b> acima de ${RE_PERDA_AMARELO}%; cinza = sem referência ou retirada menor que o necessário (conferir lançamentos). O consumo físico é lançado por semana e acumulado — não é separado por período.</p>`;
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
    ${reSecao('2. Meta da semana — atingida?', reSecSemanas(d))}
    ${reSecao('3. Atividades que a empresa precisava iniciar', reSecAtividades(d))}
    ${reSecao('4. Plano 5W2H — foi atingido?', reSecPlanos(d))}
    ${reSecao('5. Avanço físico × catálogo de atividades (BM)', reSecBM(d))}
    ${reSecao('6. Previsto × realizado nas atividades da empresa', reSecPrevisto(d))}
    ${reSecao('7. Resumo financeiro e projeção', reSecFinanceiro(d))}
    ${reSecao('8. Equipamentos e abastecimento — custos e projeção', reSecEquip(d))}
    ${reSecao('9. Impactos gerados e sofridos', reSecImpactos(d))}
    ${reSecao('10. Tendência de efetivo (pessoal)', reSecEfetivo(d))}
    ${reSecao('11. Suprimentos — material retirado × joists realizados', reSecSuprimentos(d))}
  </div></section>`;
}
async function reHtml(ini, fim, emps) {
  if (typeof PL !== 'undefined') PL._atv = null;
  await plCarregar(true).catch(() => {});
  const c = minD(fim, ref), ls = reLinhas(c);
  const dados = emps.map(emp => reDados(emp, ini, fim, ls));
  const quando = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Relatório das empresas — ${fdA(ini)} a ${fdA(fim)}</title>${RE_CSS}</head><body>
    <div class="topo-acoes"><button onclick="window.print()">Imprimir / salvar em PDF</button> <span class="nota">Gerado em ${esc(quando)} (horário de Brasília) · ${emps.map(esc).join(', ')}</span></div>
    ${dados.map(reHtmlEmpresa).join('')}</body></html>`;
}

// ---------------------------------------------------------------- tela: botão do Painel e janela de escolha
function reAbrirModal() {
  let m = document.getElementById('modalRelEmpresas');
  if (m) m.remove();
  const nomes = (M.empresas || []).map(e => e.nome).filter(Boolean);
  m = document.createElement('div');
  m.className = 'modal-admin'; m.id = 'modalRelEmpresas';
  m.innerHTML = `<div class="modal-admin-fundo" data-re-fechar></div><div class="modal-admin-caixa relatorio-modal" role="dialog" aria-modal="true">
    <div class="modal-admin-topo"><div><h2>Relatório das empresas</h2><p>Produção, metas, plano, avanço físico, financeiro, equipamentos, impactos, efetivo e suprimentos.</p></div><button type="button" class="modal-admin-x" data-re-fechar aria-label="Fechar">×</button></div>
    <div class="grade-modal"><label>Data inicial<input type="date" id="reIni" value="${per.ini}"></label><label>Data final<input type="date" id="reFim" value="${per.fim}"></label>
      <label class="largo">Empresas<select id="reEmps" multiple size="${Math.min(6, Math.max(3, nomes.length))}">${nomes.map(n => `<option value="${esc(n)}" ${!painelEmpFiltro || painelEmpFiltro === n ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select><span class="nota">Ctrl marca mais de uma. Sem seleção, sai com todas. O período começa igual ao do Painel.</span></label></div>
    <p class="nota" id="reMsg"></p>
    <div class="modal-admin-acoes"><button type="button" class="btn" data-re-fechar>Cancelar</button><button type="button" class="btn primario" id="reGerar">Gerar relatório</button></div></div>`;
  document.body.appendChild(m);
  m.hidden = false;
}
async function reGerar() {
  const ini = document.getElementById('reIni').value, fim = document.getElementById('reFim').value, msg = document.getElementById('reMsg');
  if (!ehISO(ini) || !ehISO(fim) || fim < ini) { msg.textContent = 'Informe um período válido.'; return; }
  const sel = [...document.getElementById('reEmps').selectedOptions].map(o => o.value);
  const emps = sel.length ? sel : (M.empresas || []).map(e => e.nome).filter(Boolean);
  msg.textContent = 'Montando o relatório…';
  try {
    const html = await reHtml(ini, fim, emps);
    baixarHtml(`relatorio-empresas-${ini}_a_${fim}.html`, html);
    document.getElementById('modalRelEmpresas')?.remove();
    toast('Relatório das empresas gerado.');
  } catch (e) { console.error(e); msg.textContent = 'Não foi possível gerar: ' + (e.message || e); }
}
document.addEventListener('click', ev => {
  const t = ev.target;
  if (t.closest && t.closest('#btnRelEmpresas')) return reAbrirModal();
  if (t.closest && t.closest('[data-re-fechar]')) return document.getElementById('modalRelEmpresas')?.remove();
  if (t.closest && t.closest('#reGerar')) return reGerar();
});
