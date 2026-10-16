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
const PJ = { plano: '', emp: '', contrato: 'RÓTULA', prod: 100, vista: 'semana', manual: null, aberto: false, cob: 'uso' };
const PJ_LS = 'obra198_proj_preco_manual';   // antigo: preços digitados ficavam só no navegador (migrados para o servidor na primeira abertura)
// Configuração compartilhada da obra (servidor, rota projecao-config): conjunto de equipamentos, dias cobrados e preços digitados.
const pjCfg = () => (M.projecao_config ||= {});
function pjManual() {
  const c = pjCfg();
  if (!c.precos || Array.isArray(c.precos) || typeof c.precos !== 'object') c.precos = {};
  return c.precos;
}
async function pjGravarCfg(corpo) {
  try {
    const j = await postarBruto(API + 'projecao-config', corpo);
    if (j.config) M.projecao_config = j.config;
  } catch (e) { toast('Não foi possível salvar a configuração da Projeção: ' + e.message, true); }
}
async function pjMigrarLocal() {
  if (PJ._migrou) return;
  PJ._migrou = true;
  let loc = null;
  try { loc = JSON.parse(localStorage.getItem(PJ_LS) || 'null'); } catch { loc = null; }
  if (!loc || typeof loc !== 'object' || !Object.keys(loc).length) return;
  await pjGravarCfg({ precos_importar: loc });
  try { localStorage.removeItem(PJ_LS); } catch { /* sem armazenamento */ }
}

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

// ---------------------------------------------------------------- recorte por empresa
// Atividade feita por mais de uma empresa (ex.: Pré-montagem = EJ e CMM): a quantidade e o planejado da empresa são a parte dela
// (contrato ÷ nº de empresas que executam, a mesma regra do relatório de impactos) e o executado é o que ELA lançou.
function pjSerieEmpresa(a, emp) {
  const pe = a.linha?.porEmp || [];
  if (!pe.length) return null;
  const meu = pe.find(x => ganNorm(x.nome) === ganNorm(emp));
  const somaPe = soma0(pe, x => soma0(x.ds, ([, v]) => v)), tot = soma0(plSerieReal(a), ([, v]) => v);
  const k = somaPe > 0 ? Math.min(1, tot / somaPe) : 1;   // lançamento + BM do mesmo trabalho não contam em dobro
  return (meu ? meu.ds : []).map(([d, v]) => [d, v * k]);
}
function pjDaEmpresa(c, emp, pl) {
  const itens = c.itens.map(x => {
    const a = x.ativ, emps = plEmpresasDoItem(x.it, a), n = emps.includes(emp) && emps.length > 1 ? emps.length : 1, f = 1 / n;
    if (n === 1) return x;
    const jan = x.it._plano || { inicio: pl.inicio, fim: pl.fim }, base = c.base;
    const serie = pjSerieEmpresa(a, emp);
    const mapaPlan = new Map([...x.mapaPlan].map(([d, v]) => [d, v * f]));
    const it = { ...x.it, qtd: (Number(x.it.qtd) || 0) * f, meta_dia: Number(x.it.meta_dia) > 0 ? Number(x.it.meta_dia) * f : x.it.meta_dia };
    const real = new Map();
    let r0 = x.r0 * f;
    if (serie) {
      if (a.acumulado) r0 = soma0(serie.filter(([d]) => d < jan.inicio && d <= base), ([, v]) => v);
      serie.forEach(([d, v]) => { if (d >= jan.inicio && d <= jan.fim && d <= base) real.set(d, (real.get(d) || 0) + v); });
    } else x.real.forEach((v, d) => real.set(d, v * f));   // sem lançamentos por empresa: parte igual da produção da atividade
    const realAc = r0 + soma0([...real.values()], v => v);
    let planAc = r0;
    mapaPlan.forEach((v, d) => { if (d <= base) planAc += v; });
    const ultimos = [];
    for (let d = base, k = 0; k < 5 && d >= jan.inicio; d = add(d, -1)) if (diaUtil(d)) { ultimos.push(d); k++; }
    const ritmo = ultimos.length ? soma0(ultimos, d => real.get(d) || 0) / ultimos.length : 0;
    const taxaProj = ritmo > 0 ? ritmo : x.meta * f;
    let acum = r0, concluiu = null;
    [...real.keys()].sort().forEach(d => { acum += real.get(d); if (!concluiu && acum >= it.qtd - 1e-9) concluiu = d; });
    const ratio = planAc > 0 ? realAc / planAc : null;
    let status;
    if (realAc >= it.qtd - 1e-9) status = 'CONCLUÍDO';
    else if (base < it.inicio && realAc <= 0) status = 'A INICIAR';
    else if (ratio === null) status = realAc > 0 ? 'ADIANTADO' : 'A INICIAR';
    else status = ratio >= 1.05 ? 'ADIANTADO' : ratio >= 1 ? 'NO PRAZO' : ratio >= .95 ? 'NO LIMITE' : 'ATRASADO';
    if (status === 'NO PRAZO' && base > it.fim && it.qtd - realAc > 0) status = 'ATRASADO';
    return { ...x, it, r0, mapaPlan, real, realAc, planAc, taxaProj, ritmoAtual: ritmo, meta: x.meta * f, concluiu, status, falta: Math.max(0, it.qtd - realAc), pctReal: it.qtd ? Math.min(1, realAc / it.qtd) : 0, pctPlan: it.qtd ? Math.min(1, planAc / it.qtd) : 0, _parte: n };
  });
  return { ...c, itens };
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


// ---------------------------------------------------------------- gasto com equipamento (içamento de joist e vigas)
// Quanto vai custar o guindaste + a plataforma (PTA) no período, atrelado às atividades de içamento de joist e de vigas do plano:
//   diária do equipamento = valor cadastrado ÷ 30 (cobrança MENSAL) ou o valor da diária; sem valor, a média diária lançada em Uso de equipamentos;
//   dias cobrados = dias com içamento (planejado / executado / projetado) ou todos os dias corridos entre o primeiro e o último;
//   o custo do dia é dividido entre joist e vigas pelo valor produzido (quantidade × preço do BM); com filtro de empresa, dividido entre
//   as empresas que executam a atividade (EJ/CMM), a mesma regra de Equipamentos.
const PJ_ICAMENTO = ['ICAMENTO JOIST', 'VIGAS'];
const pjClasseEquip = nome => {
  const cad = (T.equipamentos || []).find(x => ganNorm(x.equipamento) === ganNorm(nome)), t = ganNorm(`${nome} ${cad?.tipo || ''}`);
  return /GUINDASTE/.test(t) ? 'guindaste' : /PLATAFORMA|\bPTA\b|SKYJACK/.test(t) ? 'plataforma' : '';
};
function pjDiariaEquip(nome) {
  const cad = (T.equipamentos || []).find(x => ganNorm(x.equipamento) === ganNorm(nome)), cob = ganNorm(cad?.cobranca || ''), val = Number(cad?.valor) || 0;
  if (val > 0 && cob === 'MENSAL') return { v: val / 30, origem: 'mensal ÷ 30' };
  if (val > 0 && cob === 'DIARIA') return { v: val, origem: 'diária cadastrada' };
  const us = (T.usos || []).filter(u => ganNorm(u.equipamento) === ganNorm(nome) && (u.custo || 0) > 0 && !ganNorm(u.uso).includes('ABASTECIMENTO'));
  const dias = soma0(us, u => (Number(u.quantidade) > 0 ? Number(u.quantidade) : 1));
  return dias > 0 ? { v: soma0(us, u => u.custo) / dias, origem: 'média lançada' } : { v: 0, origem: 'sem valor' };
}
function pjEquipDisponiveis() {
  const nomes = new Map();
  [...(T.equipamentos || []).filter(e => e.situacao !== 'DESMOBILIZADO').map(e => e.equipamento), ...(T.usos || []).map(u => u.equipamento)].forEach(n => {
    if (n && pjClasseEquip(n) && !nomes.has(ganNorm(n))) nomes.set(ganNorm(n), n);
  });
  return [...nomes.values()].map(n => ({ nome: n, classe: pjClasseEquip(n), dia: pjDiariaEquip(n) }));
}
function pjKitSelecionado(disp) {
  const salvo = pjCfg().kit;
  if (Array.isArray(salvo)) return salvo.filter(n => disp.some(d => d.nome === n));
  // automático: um guindaste e uma plataforma — o mais usado nos últimos 30 dias (senão o primeiro com valor)
  const desde = add(ref, -30), dias = (n, de) => soma0((T.usos || []).filter(u => ganNorm(u.equipamento) === ganNorm(n) && u.data >= de && u.data <= ref && !ganNorm(u.uso).includes('ABASTECIMENTO') && !ganNorm(u.uso).includes('NAO USO')), u => (Number(u.quantidade) > 0 ? Number(u.quantidade) : 1));
  const uso = n => dias(n, desde) * 1000 + dias(n, '0000-01-01');   // mais usado nos últimos 30 dias; empate ou sem uso recente: o mais usado na obra
  return ['guindaste', 'plataforma'].map(c => disp.filter(d => d.classe === c && d.dia.v > 0).sort((a, b) => uso(b.nome) - uso(a.nome))[0]).filter(Boolean).map(d => d.nome);
}
function pjSerieEquip(itens, qtyOf, K, ate, de) {
  // Map dia → { custo, aloc: [custo por item] } — de/ate (opcionais) estendem o intervalo no modo "dias corridos"
  const out = new Map(), dias = new Set();
  itens.forEach(i => qtyOf(i).forEach((v, d) => { if (v > 0) dias.add(d); }));
  const lista = [...dias].sort();
  if (!lista.length) return out;
  const div = PJ.emp ? Math.max(1, ...itens.map(i => plEmpresasDoItem(i.x.it, i.x.ativ).length || 1)) : 1;
  const ini = de || lista[0], fim = ate || lista[lista.length - 1];
  const calendario = [];
  if (PJ.cob === 'corridos') { for (let d = ini, n = 0; d <= fim && n < 800; d = add(d, 1), n++) calendario.push(d); } else calendario.push(...lista);
  calendario.forEach(d => {
    const ativos = itens.map((i, k) => ({ k, w: (qtyOf(i).get(d) || 0) * (i.p || 0), q: qtyOf(i).get(d) || 0 })).filter(a => a.q > 0);
    const aloc = itens.map(() => 0), soma = soma0(ativos, a => a.w), custo = K / div;
    ativos.forEach(a => { aloc[a.k] = custo * (soma > 0 ? a.w / soma : 1 / ativos.length); });
    out.set(d, { custo, aloc, ocioso: ativos.length ? 0 : custo });
  });
  return out;
}
function pjEquipCalc(r) {
  const disp = pjEquipDisponiveis(), kit = pjKitSelecionado(disp), K = soma0(kit, n => disp.find(d => d.nome === n)?.dia.v);
  const itens = r.itens.filter(i => PJ_ICAMENTO.includes(ganNorm(i.ativ?.it?.servico || '')) && !ehFrenteAnexa(i.ativ?.it?.frente));
  if (!itens.length) return { disp, kit, K, itens: [] };
  const base = r.base;
  const plan = pjSerieEquip(itens, i => i.plan, K);
  const real = pjSerieEquip(itens, i => i.real, K, base);
  const proj = pjSerieEquip(itens, i => i.proj, K, undefined, add(base, 1));
  const soma = m => soma0([...m.values()], x => x.custo);
  const porItem = itens.map((i, k) => ({ i, plan: soma0([...plan.values()], x => x.aloc[k]), exec: soma0([...real.values()], x => x.aloc[k]), proj: soma0([...proj.values()], x => x.aloc[k]) }));
  return { disp, kit, K, itens, plan, real, proj, base, totPlan: soma(plan), totReal: soma(real), totProj: soma(proj), porItem,
    ocioso: soma0([...plan.values()], x => x.ocioso) };
}
function pjCurvaEquip(r, eq) {   // gasto acumulado com guindaste + plataforma (executado até a referência, projetado depois) sobre o eixo da curva S
  const dias = [...eq.real.keys(), ...eq.proj.keys()].sort();
  let ac = 0, k = 0;
  return r.eixo.map(d => {
    while (k < dias.length && dias[k] <= d) { ac += (eq.real.get(dias[k]) || eq.proj.get(dias[k])).custo; k++; }
    return Math.round(ac);
  });
}
function pjEquipHtml(r, c) {
  const tile = (rot, val, sub, cc) => `<div class="tile" style="--c:${cc}"><div class="rot"><span>${rot}</span></div><div class="val">${val}</div><div class="sub">${sub}</div></div>`;
  let h = `<div class="bloco pj-equip"><div class="bloco-cab"><h2>Gasto com equipamento — içamento de joist e vigas${PJ.emp ? ' · ' + esc(PJ.emp) : ''}</h2>
    <div class="acoes"><label class="rot-sel">Dias cobrados <select id="pjCob"><option value="uso" ${PJ.cob === 'uso' ? 'selected' : ''}>Só dias com içamento</option><option value="corridos" ${PJ.cob === 'corridos' ? 'selected' : ''}>Todos os dias corridos (inclui fim de semana)</option></select></label></div></div>
    <p class="nota">Quanto vai custar o guindaste + a plataforma nos períodos dos serviços de içamento de joist e de vigas do plano. Diária = valor mensal ÷ 30 (ou a diária cadastrada). O custo do dia é dividido entre joist e vigas pelo valor produzido${PJ.emp ? '; com a empresa filtrada, dividido entre as empresas que executam' : ''}. Não entra no faturamento da projeção.</p>
    <div class="pj-kit">${c.disp.length ? c.disp.map(d => `<label class="pj-kit-item" title="${esc(d.dia.origem)}"><input type="checkbox" data-pj-kit="${esc(d.nome)}" ${c.kit.includes(d.nome) ? 'checked' : ''}> <b>${esc(d.nome)}</b> <span class="nota">${esc(d.classe)} · ${d.dia.v > 0 ? rs2(d.dia.v) + '/dia · ' + esc(d.dia.origem) : 'sem valor no cadastro'}</span></label>`).join('') : '<span class="nota">Nenhum guindaste ou plataforma cadastrado em Equipamentos.</span>'}${Array.isArray(pjCfg().kit) ? ' <button type="button" class="link" data-pj-kit-auto title="Voltar a escolher sozinho o guindaste e a plataforma mais usados">↺ conjunto automático</button>' : ''}</div>
    <p class="nota">A escolha do conjunto, dos dias cobrados e os preços digitados ficam gravados na obra: valem para todos os usuários.</p>`;
  if (!c.itens.length) return h + '<p class="vazio">O plano escolhido não tem atividades de içamento de joist ou de vigas do galpão.</p></div>';
  if (!(c.K > 0)) return h + '<p class="faixa">Marque ao menos um equipamento com valor (cadastro de Equipamentos: cobrança MENSAL ou DIÁRIA e valor) para calcular o gasto.</p></div>';
  const totalProj = c.totReal + c.totProj, fat = soma0(c.itens, i => Math.min(i.qtd, i.x.realAc) * i.p) + soma0(c.itens, i => { let q = 0; i.proj.forEach(v => { q += v; }); return Math.min(i.qtd - Math.min(i.qtd, i.x.realAc), q) * i.p; });
  h += '<div class="tiles">' +
    tile('Diária do conjunto', rs2(c.K), `${c.kit.length} equipamento(s) marcado(s)`, 'var(--acento)') +
    tile('Gasto planejado no plano', rs(c.totPlan), `${PJ.cob === 'corridos' ? 'dias corridos' : 'dias com içamento'}`, 'var(--fg3)') +
    tile('Gasto até hoje', rs(c.totReal), `dias com içamento lançado até ${fdA(c.base)}`, 'var(--verde)') +
    tile(`Gasto projetado daqui para frente${PJ.prod !== 100 ? ' (' + PJ.prod + '% do ritmo)' : ''}`, rs(c.totProj), `total até concluir ${rs(totalProj)}`, 'var(--amarelo)') +
    tile('Equipamento ÷ faturamento', fat > 0 ? nf(totalProj / fat * 100, 1) + '%' : '—', `faturamento das atividades de içamento ${rs(fat)}`, 'var(--vermelho)') +
    tile('Margem bruta do içamento', rs(fat - totalProj), `faturamento − equipamento${fat > 0 ? ' · ' + nf((fat - totalProj) / fat * 100, 0) + '% do faturamento' : ''}`, fat - totalProj < 0 ? 'var(--vermelho)' : 'var(--verde)') + '</div>';
  h += `<div class="tabela-rolagem"><table class="pl-tab pj-tab" data-sem-ferramentas><thead><tr><th>Atividade</th><th class="n">Qtd do plano</th><th class="n">Gasto planejado</th><th class="n">Gasto até hoje</th><th class="n">Gasto projetado</th><th class="n">Total até concluir</th><th class="n">R$ por unidade</th></tr></thead><tbody>` +
    c.porItem.map(x => { const tot = x.exec + x.proj; return `<tr><td><b>${esc(x.i.x.it.atividade)}</b><div class="nota">${fd(x.i.x.it.inicio)} a ${fd(x.i.x.it.fim)}</div></td><td class="n">${plFmt(x.i.qtd, x.i.x.it.unidade)} ${esc(x.i.x.it.unidade)}</td><td class="n">${rs(x.plan)}</td><td class="n">${rs(x.exec)}</td><td class="n">${rs(x.proj)}</td><td class="n"><b>${rs(tot)}</b></td><td class="n">${x.i.qtd > 0 ? rs2(tot / x.i.qtd) : '—'}</td></tr>`; }).join('') +
    `</tbody><tfoot><tr><th>Total</th><th></th><th class="n">${rs(c.totPlan)}</th><th class="n">${rs(c.totReal)}</th><th class="n">${rs(c.totProj)}</th><th class="n">${rs(totalProj)}</th><th></th></tr></tfoot></table></div>`;
  // gasto por período
  const per = new Set(); [c.plan, c.real, c.proj].forEach(m => m.forEach((v, d) => per.add(pjChavePeriodo(d, PJ.vista))));
  const chaves = [...per].sort();
  const somaPer = (m, k) => soma0([...m.entries()].filter(([d]) => pjChavePeriodo(d, PJ.vista) === k), ([, x]) => x.custo);
  const qtdPer = (k, nome) => soma0(c.itens.filter(i => ganNorm(i.ativ.it.servico) === nome), i => soma0([...i.real, ...i.proj].filter(([d]) => pjChavePeriodo(d, PJ.vista) === k), ([, v]) => v));
  const fatPer = k => soma0(c.itens, i => soma0([...i.real, ...i.proj].filter(([d]) => pjChavePeriodo(d, PJ.vista) === k), ([, v]) => v) * i.p);
  let ac = 0;
  h += `<div class="tabela-rolagem"><table class="pj-tab" data-sem-ferramentas><thead><tr><th>${PJ.vista === 'mes' ? 'Mês' : 'Semana (segunda)'}</th><th class="n">Joists içados</th><th class="n">Vigas içadas</th><th class="n">Gasto planejado</th><th class="n">Executado + projetado</th><th class="n">Acumulado</th><th class="n">Faturamento do içamento</th><th class="n">Equipamento ÷ faturamento</th><th class="n">Margem bruta</th></tr></thead><tbody>` +
    chaves.map(k => { const e = somaPer(c.real, k) + somaPer(c.proj, k), f = fatPer(k); ac += e; const misto = (PJ.vista === 'mes' ? k + '-31' : add(k, 6)) <= c.base ? 'pj-real' : 'pj-proj';
      return `<tr><td>${pjRotPeriodo(k, PJ.vista)}</td><td class="n">${nf(qtdPer(k, 'ICAMENTO JOIST'), 0)}</td><td class="n">${nf(qtdPer(k, 'VIGAS'), 0)}</td><td class="n">${rs(somaPer(c.plan, k))}</td><td class="n ${misto}"><b>${rs(e)}</b></td><td class="n">${rs(ac)}</td><td class="n">${rs(f)}</td><td class="n">${f > 0 ? nf(e / f * 100, 0) + '%' : '—'}</td><td class="n ${f - e < -0.5 ? 'valor-neg' : ''}">${rs(f - e)}</td></tr>`; }).join('') +
    `</tbody><tfoot><tr><th>Total</th><th class="n">${nf(soma0(chaves, k => qtdPer(k, 'ICAMENTO JOIST')), 0)}</th><th class="n">${nf(soma0(chaves, k => qtdPer(k, 'VIGAS')), 0)}</th><th></th><th class="n">${rs(c.totPlan)}</th><th class="n">${rs(totalProj)}</th><th></th><th class="n">${rs(fat)}</th><th class="n">${fat > 0 ? nf(totalProj / fat * 100, 0) + '%' : '—'}</th><th class="n">${rs(fat - totalProj)}</th></tr></tfoot></table></div>`;
  return h + '</div>';
}


// ---------------------------------------------------------------- estado automático da atividade (conforme a produção lançada)
//   verde    = concluído conforme lançamento (executado ≥ quantidade do plano);
//   amarelo  = em andamento (já há produção lançada, ainda não concluiu, prazo não venceu);
//   vermelho = não feito (início já passou e nada lançado) ou atrasado (prazo vencido sem concluir);
//   cinza    = a iniciar (início ainda não chegou).
// Recalculado a cada abertura da aba e a cada lançamento salvo; nada é digitado à mão.
function pjEstado(i, base) {
  const x = i.x, feito = x.realAc >= i.qtd - 1e-9;
  const pct = i.qtd ? Math.min(1, x.realAc / i.qtd) : 0;
  if (feito) return { c: 'verde', rot: 'CONCLUÍDO', dica: 'Concluído conforme o lançamento de produção', pct };
  if (base < x.it.inicio && x.realAc <= 0) return { c: 'pendente', rot: 'A INICIAR', dica: 'Início previsto em ' + fdA(x.it.inicio), pct };
  if (x.realAc <= 0) return { c: 'vermelho', rot: 'NÃO FEITO', dica: 'Início previsto em ' + fdA(x.it.inicio) + ' e nenhuma produção lançada', pct };
  if (base > x.it.fim) return { c: 'vermelho', rot: 'ATRASADO', dica: 'Prazo do plano (' + fdA(x.it.fim) + ') vencido sem concluir: ' + nf(pct * 100, 0) + '% lançado', pct };
  const ritmo = x.status === 'ATRASADO' ? ' — abaixo do planejado até hoje' : x.status === 'NO LIMITE' ? ' — no limite do planejado' : '';
  return { c: 'amarelo', rot: 'EM ANDAMENTO', dica: nf(pct * 100, 0) + '% lançado' + ritmo, pct };
}
// Mini-curva de execução da atividade: planejado (cinza tracejado), executado até a referência (cheio) e projeção (pontilhado), na cor do estado.
function pjSpark(i, r, est) {
  const W = 96, H = 28, n = r.eixo.length;
  if (n < 2 || !(i.qtd > 0)) return '';
  let pl = i.r0, re = i.r0, pr = Math.min(i.qtd, i.x.realAc);
  const P = [], E = [], J = [];
  r.eixo.forEach((d, k) => {
    pl += i.plan.get(d) || 0;
    const xx = (k / (n - 1)) * W, y = v => (H - 2 - Math.min(1, v / i.qtd) * (H - 4)).toFixed(1);
    P.push(`${xx.toFixed(1)},${y(pl)}`);
    if (d <= r.base) { re += i.real.get(d) || 0; E.push(`${xx.toFixed(1)},${y(re)}`); pr = re; }
    else { pr += i.proj.get(d) || 0; if (!J.length && E.length) J.push(E[E.length - 1]); J.push(`${xx.toFixed(1)},${y(pr)}`); }
  });
  const cor = `var(--${est.c === 'pendente' ? 'fg3' : est.c})`;
  const ib = r.eixo.filter(d => d <= r.base).length - 1, xb = ib >= 0 ? (ib / (n - 1)) * W : -1;
  return `<svg class="pj-spark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(est.rot)}"><title>${esc(est.rot + ' — ' + est.dica)}</title>
    <polyline points="${P.join(' ')}" fill="none" style="stroke:var(--fg3)" stroke-width="1" stroke-dasharray="3 2" opacity=".6"/>
    ${xb >= 0 ? `<line x1="${xb.toFixed(1)}" x2="${xb.toFixed(1)}" y1="0" y2="${H}" style="stroke:var(--fg3)" stroke-width=".6" opacity=".5"/>` : ''}
    ${J.length > 1 ? `<polyline points="${J.join(' ')}" fill="none" style="stroke:${cor}" stroke-width="2" stroke-dasharray="1.5 3" stroke-linecap="round" opacity=".75"/>` : ''}
    ${E.length ? `<polyline points="${E.join(' ')}" fill="none" style="stroke:${cor}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>` : `<circle cx="1.5" cy="${H - 2}" r="2" style="fill:${cor}"/>`}</svg>`;
}


// ---------------------------------------------------------------- painel: % realizado × projetado
// Tudo em % do valor do plano (financeiro) e, por atividade, em % da quantidade do plano:
//   planejado até hoje = o que o plano previa até a data de referência; realizado = lançado até a referência;
//   projetado no fim do plano = realizado + o que o ritmo atual (× fator de produtividade) entrega até o último dia do plano;
//   fora do prazo = o que, pelo ritmo, só termina depois do fim do plano.
function pjPcts(i, r) {
  const q = i.qtd || 0;
  if (!(q > 0)) return { plan: 0, real: 0, proj: 0 };
  let ac = Math.min(q, i.x.realAc);
  i.proj.forEach((v, d) => { if (d <= r.fimPlano) ac += v; });
  return { plan: Math.min(1, i.x.planAc / q), real: Math.min(1, i.x.realAc / q), proj: Math.min(1, ac / q) };
}
function pjTotaisPct(r) {
  const T = r.totalPlano || 0;
  return { plan: T ? r.planoAteHoje / T : 0, real: T ? r.exec / T : 0, proj: T ? Math.min(1, (r.aoFimPlano ?? 0) / T) : 0 };
}
const pjPct = v => nf(v * 100, 0) + '%';
function pjBarra(p, alto) {   // verde = realizado, amarelo = projetado até o fim do plano, vermelho = fora do prazo; traço = planejado até hoje
  const re = Math.min(1, p.real), pr = Math.max(p.proj, re), fora = Math.max(0, 1 - pr);
  return `<div class="pj-barra" style="height:${alto || 14}px" title="Realizado ${pjPct(p.real)} · projetado no fim do plano ${pjPct(p.proj)} · planejado até hoje ${pjPct(p.plan)}">
    <i class="pj-b-real" style="width:${(re * 100).toFixed(1)}%"></i><i class="pj-b-proj" style="width:${((pr - re) * 100).toFixed(1)}%"></i><i class="pj-b-fora" style="width:${(fora * 100).toFixed(1)}%"></i>
    <b class="pj-b-plan" style="left:${(Math.min(1, p.plan) * 100).toFixed(1)}%"></b></div>`;
}
function pjPainelHtml(r, resumoEmp) {
  const g = pjTotaisPct(r), desv = (g.real - g.plan) * 100, fora = Math.max(0, 1 - g.proj);
  const tile = (rot, val, sub, cc) => `<div class="tile" style="--c:${cc}"><div class="rot"><span>${rot}</span></div><div class="val">${val}</div><div class="sub">${sub}</div></div>`;
  let h = `<div class="bloco pj-painel"><div class="bloco-cab"><h2>Painel — realizado × projetado${PJ.emp ? ' · ' + esc(PJ.emp) : ''}</h2>
    <span class="nota">% do valor do plano até ${fdA(r.fimPlano)}${PJ.prod !== 100 ? ' · projeção a ' + PJ.prod + '% do ritmo atual' : ' · projeção no ritmo atual'}</span></div>
    <div class="pj-legenda-barra"><span><i class="pj-b-real"></i> realizado</span><span><i class="pj-b-proj"></i> projetado até o fim do plano</span><span><i class="pj-b-fora"></i> fora do prazo</span><span><b class="pj-b-plan-leg"></b> planejado até hoje</span></div>
    ${pjBarra({ plan: g.plan, real: g.real, proj: g.proj }, 26)}
    <div class="tiles">` +
    tile('Realizado', pjPct(g.real), `${rs(r.exec)} de ${rs(r.totalPlano)}`, 'var(--verde)') +
    tile('Planejado até hoje', pjPct(g.plan), `${rs(r.planoAteHoje)}`, 'var(--fg3)') +
    tile('Realizado − planejado', (desv >= 0 ? '+' : '−') + nf(Math.abs(desv), 1) + ' p.p.', desv >= -0.5 ? 'no planejado ou adiantado' : 'abaixo do planejado até hoje', desv < -5 ? 'var(--vermelho)' : desv < -0.5 ? 'var(--amarelo)' : 'var(--verde)') +
    tile('Projetado no fim do plano', pjPct(g.proj), `${rs(r.aoFimPlano ?? 0)}${PJ.prod !== 100 ? ' (simulado)' : ''}`, 'var(--amarelo)') +
    tile('Fora do prazo', pjPct(fora), fora > 0.005 ? `${rs(r.totalPlano * fora)} só terminam depois do plano${r.termina ? ' · fim projetado ' + fdA(r.termina) : ''}` : 'tudo fecha dentro do plano', fora > 0.005 ? 'var(--vermelho)' : 'var(--verde)') + '</div>';
  // por atividade
  h += `<div class="tabela-rolagem"><table class="pj-tab" data-sem-ferramentas><thead><tr><th>Atividade</th><th>Quem</th><th class="n">Planejado até hoje</th><th class="n">Realizado</th><th class="n">Projetado no fim do plano</th><th style="min-width:180px">Realizado × projetado</th><th>Situação</th></tr></thead><tbody>` +
    r.itens.map(i => { const p = pjPcts(i, r), est = pjEstado(i, r.base);
      return `<tr><td><b>${esc(i.x.it.atividade)}</b></td><td>${esc(plEmpresasDoItem(i.x.it, i.x.ativ).join(' / ') || i.x.it.empresa || '—')}</td><td class="n">${pjPct(p.plan)}</td><td class="n"><b>${pjPct(p.real)}</b></td><td class="n">${pjPct(p.proj)}</td><td>${pjBarra(p, 12)}</td><td><span class="farol f-${est.c}" title="${esc(est.dica)}">${esc(est.rot)}</span></td></tr>`; }).join('') +
    `</tbody><tfoot><tr><th colspan="2">Total (ponderado pelo valor)</th><th class="n">${pjPct(g.plan)}</th><th class="n">${pjPct(g.real)}</th><th class="n">${pjPct(g.proj)}</th><td>${pjBarra(g, 12)}</td><th></th></tr></tfoot></table></div>`;
  // por empresa
  if (resumoEmp && resumoEmp.length > 1) {
    h += `<div class="tabela-rolagem"><table class="pj-tab" data-sem-ferramentas><thead><tr><th>Empresa</th><th class="n">Atividades</th><th class="n">Valor do plano</th><th class="n">Planejado até hoje</th><th class="n">Realizado</th><th class="n">Projetado no fim do plano</th><th style="min-width:180px">Realizado × projetado</th></tr></thead><tbody>` +
      resumoEmp.map(e => `<tr><td><b>${esc(e.nome)}</b></td><td class="n">${e.n}</td><td class="n">${rs(e.total)}</td><td class="n">${pjPct(e.g.plan)}</td><td class="n"><b>${pjPct(e.g.real)}</b></td><td class="n">${pjPct(e.g.proj)}</td><td>${pjBarra(e.g, 12)}</td></tr>`).join('') +
      `</tbody></table></div><p class="nota">Empresa: atividades divididas entre EJ e CMM entram pela parte de cada uma (contrato ÷ nº de empresas) e pelo que ela lançou.</p>`;
  }
  return h + '</div>';
}
function pjResumoEmpresas(sel, empresas, fator, R) {
  return empresas.map(n => {
    const pl = plPlanoCombinado(sel, n);
    if (!pl) return null;
    const c = pjDaEmpresa(plCalc(pl), n, pl), r = pjCalc(pl, c, fator, R);
    return { nome: n, n: r.itens.length, total: r.totalPlano, g: pjTotaisPct(r) };
  }).filter(Boolean);
}

// ---------------------------------------------------------------- tela
function pjPlanosAtivos() { return (PL.dados?.planos || []).filter(p => p.status !== 'concluido' && p.inicio && p.fim && Array.isArray(p.itens) && p.itens.length); }
async function renderProjecao() {
  const box = document.getElementById('projCorpo');
  if (!box) return;
  const tk = PJ._tk = (PJ._tk || 0) + 1;
  if (!PL.dados || Date.now() - (PL._ts || 0) > 60000) { await plCarregar(true); PL._ts = Date.now(); if (tk !== PJ._tk) return; }
  await pjMigrarLocal();
  if (!PJ._cfgOk) { PJ._cfgOk = true; PJ.cob = pjCfg().cob === 'corridos' ? 'corridos' : 'uso'; }
  PL._atv = null;
  const planos = pjPlanosAtivos();
  if (!planos.length) {
    box.innerHTML = '<div class="bloco"><div class="bloco-cab"><h2>Projeção físico-financeira</h2></div><p class="nota">Nenhum planejamento 5W2H ativo. A projeção parte do plano: crie em Planejamento → Sugestão do cronograma → “Criar planejamento”.</p><button class="btn primario" data-ir-aba="plan">Abrir Planejamento</button></div>';
    return;
  }
  if (PJ.plano && !planos.some(p => p.id === PJ.plano)) PJ.plano = '';
  const sel = PJ.plano ? planos.filter(p => p.id === PJ.plano) : planos;
  const empresas = M.empresas.map(e => e.nome).filter(n => plPlanoCombinado(sel, n));
  if (PJ.emp && !empresas.includes(PJ.emp)) PJ.emp = '';
  const pl = plPlanoCombinado(sel, PJ.emp);
  if (!pl) { box.innerHTML = '<p class="nota">O plano escolhido não tem atividades.</p>'; return; }
  const c = PJ.emp ? pjDaEmpresa(plCalc(pl), PJ.emp, pl) : plCalc(pl), R = PJ.contrato, fator = PJ.prod / 100;
  const r = pjCalc(pl, c, fator, R);
  const sim = fator !== 1;

  const optPl = `<option value="">Todos os planos ativos (${planos.length})</option>` + planos.map(p => `<option value="${esc(p.id)}" ${p.id === PJ.plano ? 'selected' : ''}>${esc(p.nome)} · ${fd(p.inicio)} a ${fd(p.fim)}</option>`).join('');
  const tile = (rot, val, sub, cc) => `<div class="tile" style="--c:${cc}"><div class="rot"><span>${rot}</span></div><div class="val">${val}</div><div class="sub">${sub}</div></div>`;
  const desv = r.exec - r.planoAteHoje, pctFis = r.totalPlano ? r.exec / r.totalPlano * 100 : 0, pctPrev = r.totalPlano ? r.planoAteHoje / r.totalPlano * 100 : 0;
  const aoFim = r.aoFimPlano ?? 0, foraPrazo = Math.max(0, r.totalPlano - aoFim);
  let h = `<div class="bloco"><div class="bloco-cab"><h2>Projeção físico-financeira${PJ.emp ? ' — ' + esc(PJ.emp) : ''}</h2><span class="nota">Simulação a partir do planejamento 5W2H + o que já foi executado (até ${fdA(c.baseRef)}).</span></div>
    <div class="barra-acoes">
      <label class="rot-sel">Plano <select id="pjPlano">${optPl}</select></label>
      <label class="rot-sel">Empresa <select id="pjEmp"><option value="">Todas as empresas</option>${empresas.map(n => `<option value="${esc(n)}" ${n === PJ.emp ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
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
  const comParte = r.itens.filter(i => i.x._parte);
  if (PJ.emp && comParte.length) h += `<div class="faixa faixa-info">${esc(PJ.emp)}: ${comParte.map(i => esc(i.x.it.atividade)).join(', ')} ${comParte.length > 1 ? 'são feitas' : 'é feita'} por mais de uma empresa — a quantidade, o planejado e o valor de ${esc(PJ.emp)} são a parte dela (contrato ÷ nº de empresas) e o executado é o que ${esc(PJ.emp)} lançou.</div>`;
  if (r.semValor.length) h += `<div class="faixa">${r.semValor.length} atividade(s) sem valor no BM (R$ 0): ${r.semValor.map(i => esc(i.x.it.atividade)).join(', ')}. Digite o preço unitário na coluna “Preço unit.” para entrarem na projeção.</div>`;
  h += pjPainelHtml(r, PJ.emp ? null : pjResumoEmpresas(sel, empresas, fator, R));
  h += `<div class="bloco"><div class="bloco-cab"><h2>Curva S financeira (R$ acumulado)</h2><div class="legenda"><span class="nota">Linha cheia = executado · tracejada = planejado · pontilhada = projeção${sim ? ' (' + PJ.prod + '% do ritmo atual)' : ' no ritmo atual'} · cinza = necessário para fechar no prazo</span></div></div><div class="grafico pl-grafico"><canvas id="gProjecao"></canvas></div></div>`;

  // tabela por atividade
  h += `<div class="bloco"><div class="bloco-cab"><h2>Por atividade</h2><span class="nota">Preço unit. = valor da atividade no BM ÷ quantidade do item no cronograma. Edite para simular outro preço.</span></div>
    <p class="nota pj-legenda"><span class="farol f-verde">CONCLUÍDO</span> produção lançada ≥ quantidade do plano · <span class="farol f-amarelo">EM ANDAMENTO</span> há produção lançada e o prazo não venceu · <span class="farol f-vermelho">NÃO FEITO / ATRASADO</span> início já passou sem lançamento, ou prazo vencido sem concluir · <span class="farol f-pendente">A INICIAR</span> · mini-curva: cinza tracejada = planejado, cheia = executado até ${fdA(c.baseRef)}, pontilhada = projeção. Tudo atualizado sozinho a cada lançamento de produção salvo.</p>${M.empresas.some(e => e.servicos.some(sv => ganNorm(sv.frente) === 'ECLUSA' && eclusaTipoServico(sv.nome) === 'junta')) ? '<p class="nota">Eclusa: o que for lançado na coluna única “Vigas e Joists” é dividido pelo contrato (' + nf(eclusaFracao('viga') * 100, 0) + '% vigas, ' + nf(eclusaFracao('joist') * 100, 0) + '% joists). Para valores exatos, lance nas colunas separadas.</p>' : ''}<div class="tabela-rolagem"><table class="pl-tab pj-tab" id="tabProjAtiv"><thead><tr><th>Atividade</th><th>Quem</th><th class="n">Qtd do plano</th><th class="n">Preço unit. (R$)</th><th class="n">Valor do plano</th><th class="n">Planejado até hoje</th><th class="n">Executado</th><th class="n">% físico</th><th class="n">Projeção no fim do plano</th><th class="n">Termina em</th><th class="n">Saldo a faturar</th><th>Situação</th></tr></thead><tbody>`;
  r.itens.forEach(i => {
    const x = i.x, un = x.it.unidade;
    const planoHoje = Math.min(x.planAc, i.qtd) * i.p, exec = Math.min(x.realAc, i.qtd) * i.p;
    let ac = Math.min(i.qtd, x.realAc);
    i.proj.forEach((v, d) => { if (d <= r.fimPlano) ac += v; });
    const noFim = Math.min(ac, i.qtd) * i.p, saldo = Math.max(0, i.qtd - x.realAc) * i.p;
    const est = pjEstado(i, r.base);
    h += `<tr><td><b>${esc(x.it.atividade)}</b><div class="nota">${fd(x.it.inicio)} a ${fd(x.it.fim)}${x.it._planoNome ? ' · ' + esc(x.it._planoNome) : ''}</div></td><td>${esc(plEmpresasDoItem(x.it, x.ativ).join(' / ') || x.it.empresa || '—')}</td>
      <td class="n">${plFmt(x.it.qtd, un)} ${esc(un)}</td>
      <td class="n"><input type="text" inputmode="decimal" class="pj-preco ${i.pr.origem === 'sem' ? 'pj-sem' : ''}" data-pj-chave="${esc(i.ativ.chave)}" data-pj-bm="${i.pr.bm || ''}" value="${i.p ? nf(i.p, 2) : ''}" placeholder="R$/${esc(un)}" title="${i.pr.manual ? 'Preço digitado (BM: ' + (i.pr.bm ? rs2(i.pr.bm) : 'sem valor') + ')' : i.pr.bm ? 'Preço do BM: ' + esc(i.pr.codigos.join(', ')) : 'Sem atividade no BM: digite o preço unitário'}">${i.pr.manual ? ' <button type="button" class="link" data-pj-reset="' + esc(i.ativ.chave) + '" title="Voltar ao preço do BM">↺</button>' : ''}</td>
      <td class="n">${rs(i.valor)}</td><td class="n">${rs(planoHoje)}</td><td class="n"><b>${rs(exec)}</b></td><td class="n">${nf(i.qtd ? Math.min(1, x.realAc / i.qtd) * 100 : 0, 0)}%</td>
      <td class="n pj-proj-cel"><div class="pj-proj-cab">${pjSpark(i, r, est)}<span>${rs(noFim)}</span></div></td><td class="n ${i.termina && i.termina > x.it.fim ? 'valor-neg' : ''}">${i.termina ? fdA(i.termina) : '—'}</td><td class="n">${rs(saldo)}</td><td title="${esc(est.dica)}"><span class="farol f-${est.c}">${esc(est.rot)}</span><div class="nota">${esc(est.dica)}</div></td></tr>`;
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
  const eq = PJ._eq = pjEquipCalc(r);
  h += pjEquipHtml(r, eq);
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
      ...(eq.itens.length && eq.K > 0 ? [{ label: 'Gasto com equipamento do içamento (acumulado)', data: pjCurvaEquip(r, eq), borderColor: cor('--vermelho'), backgroundColor: cor('--vermelho'), borderWidth: 2.5, pointRadius: 0, tension: .2 }] : []),
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
  a.href = url; a.download = `projecao_fisico_financeira${PJ.emp ? '_' + PJ.emp.replace(/[^A-Za-z0-9]+/g, '_') : ''}_${hoje()}.csv`; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

// ---------------------------------------------------------------- eventos
document.addEventListener('change', ev => {
  const t = ev.target;
  if (t.id === 'pjPlano') { PJ.plano = t.value; renderProjecao(); }
  else if (t.id === 'pjEmp') { PJ.emp = t.value; renderProjecao(); }
  else if (t.id === 'pjContrato') { PJ.contrato = t.value; renderProjecao(); }
  else if (t.id === 'pjCob') { PJ.cob = t.value; pjCfg().cob = PJ.cob; pjGravarCfg({ cob: PJ.cob }).then(renderProjecao); }
  else if (t.dataset && t.dataset.pjKit !== undefined) {
    const marcados = [...document.querySelectorAll('[data-pj-kit]')].filter(x => x.checked).map(x => x.dataset.pjKit);
    pjCfg().kit = marcados;
    pjGravarCfg({ kit: marcados }).then(renderProjecao);
  }
  else if (t.id === 'pjVista') { PJ.vista = t.value; renderProjecao(); }
  else if (t.id === 'pjProd') { PJ.prod = +t.value; renderProjecao(); }
  else if (t.classList && t.classList.contains('pj-preco')) {
    const chave = t.dataset.pjChave, bm = Number(t.dataset.pjBm) || 0, txt = t.value.trim(), v = txt === '' ? 0 : edNum(txt);
    const m = pjManual();
    const novo = !(v > 0) || (bm && Math.abs(v - bm) < 0.005) ? null : v;
    if (novo === null) delete m[chave]; else m[chave] = novo;
    pjGravarCfg({ preco: { chave, valor: novo } }).then(renderProjecao);
  }
});
document.addEventListener('input', ev => { if (ev.target.id === 'pjProd') { const s = document.getElementById('pjProdTxt'); if (s) s.textContent = ev.target.value + '%'; } });
document.addEventListener('click', ev => {
  const reset = ev.target.closest && ev.target.closest('[data-pj-reset]');
  if (reset) { delete pjManual()[reset.dataset.pjReset]; pjGravarCfg({ preco: { chave: reset.dataset.pjReset, valor: null } }).then(renderProjecao); return; }
  if (ev.target.closest && ev.target.closest('[data-pj-kit-auto]')) { delete pjCfg().kit; pjGravarCfg({ kit: null }).then(renderProjecao); return; }
  if (ev.target.id === 'pjCsv') pjCsv();
});

// volta para a aba depois de lançar produção em outra janela/aba do navegador: relê os dados para refletir o que foi salvo
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && typeof abaAtual !== 'undefined' && abaAtual === 'proj' && typeof carregar === 'function') carregar().catch(() => { /* sem rede: mantém a tela */ });
});
