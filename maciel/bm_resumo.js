'use strict';
// ------------------------------------------------------------------------------------------------
// FINANCEIRO › MEDIÇÃO (BM) — resumo do período (gasto × ganho produtivo) e painel de projeção
// (próxima semana ou próximo plano 5W2H ativo da empresa). Usado por renderBMBoletim (app.js).
// Depende de app.js, planos.js, projecao.js e rel_empresa.js (reHistoricoEquip, reAbastecimento).
// ------------------------------------------------------------------------------------------------

let bmProjModo = 'semana';   // 'semana' | 'plano'
const BM_R = 'RÓTULA';

const bmPrimeiraData = emp => {
  const e = empresa(emp), ds = Object.keys(e?.registros || {});
  bmTab('bm_apontamentos').forEach(x => { if (x.empresa === emp && x.data) ds.push(x.data); });
  return ds.sort()[0] || ref;
};

// ---------------------------------------------------------------- BM impresso: uso de equipamento + combustível POR MÁQUINA da empresa
// Mesma regra do desconto do BM (bmDeducoes): equipamento locado por mês já é descontado como locação (o uso lançado dele não soma custo de novo);
// abastecimento da SANY não entra na medição. As linhas dessas regras aparecem marcadas e não somam no total descontado.
function bmEquipDetalheHtml(emp, p, dd) {
  const ini = p.ini === '0000-01-01' ? bmPrimeiraData(emp) : p.ini, fim = p.fim;
  const dados = relEquipDados(emp, ini, fim, 'todos');
  const locados = new Set((dd.eqMensList || []).map(e => ganNorm(e.equipamento)));
  const meses = mesesNoPeriodo(p.ini, p.fim);
  const maq = new Map();   // equipamento -> { resp, linhas[], dias:Set, custo, litros, comb }
  const pega = (nome, resp) => { if (!maq.has(nome)) maq.set(nome, { nome, resp: resp || '—', cobranca: '', linhas: [], dias: new Set(), custo: 0, litros: 0, comb: 0, mensal: 0, mesesMensal: 0 }); const m = maq.get(nome); if (resp && m.resp === '—') m.resp = resp; return m; };
  dados.linhas.forEach(l => {
    const m = pega(l.equipamento, l.resp);
    const eAbast = ganNorm(l.uso).includes('ABASTECIMENTO') || l.litros > 0 || l.comb > 0;
    const locado = locados.has(ganNorm(l.equipamento)) && l.custo > 0;
    const semComb = ganNorm(l.equipamento).includes('SANY') && eAbast && (l.litros > 0 || l.comb > 0);
    const c = locado ? 0 : l.custo, lt = semComb ? 0 : l.litros, cb = semComb ? 0 : l.comb;
    const nota = [locado ? 'coberto pela locação mensal' : '', semComb ? 'abastecimento não entra na medição' : '', l.rateio || ''].filter(Boolean).join(' · ');
    m.linhas.push({ ...l, c, lt, cb, nota });
    m.custo += c; m.litros += lt; m.comb += cb; if (l.data) m.dias.add(l.data);
  });
  (dd.eqMensList || []).forEach(e => { const m = pega(e.equipamento, e.responsavel || emp); m.cobranca = 'MENSAL'; m.mensal = (e.valor || 0) * meses; m.mesesMensal = meses; m.valorMes = e.valor || 0; });
  (bmTab('equipamentos') || []).forEach(e => { const m = maq.get(e.equipamento); if (m && !m.cobranca) m.cobranca = e.cobranca || ''; });
  const lista = [...maq.values()].sort((a, b) => (b.custo + b.comb + b.mensal) - (a.custo + a.comb + a.mensal) || a.nome.localeCompare(b.nome));
  const tot = x => x.custo + x.comb + x.mensal;
  const gEq = soma0(lista, m => m.custo + m.mensal), gLt = soma0(lista, m => m.litros), gCb = soma0(lista, m => m.comb), gTot = soma0(lista, tot);
  if (!lista.length) return `<h2>Equipamentos e combustível do período — ${esc(emp)}</h2><p class="nota">Nenhum uso de equipamento nem abastecimento lançado para ${esc(emp)} neste período.</p>`;
  const resumo = lista.map(m => `<tr><td><b>${esc(m.nome)}</b></td><td>${esc(m.resp)}</td><td>${esc(m.cobranca || '—')}</td><td class="n">${m.dias.size || (m.mensal ? '—' : 0)}</td><td class="n">${rs2(m.custo + m.mensal)}</td><td class="n">${nf(m.litros, 1)}</td><td class="n">${rs2(m.comb)}</td><td class="n"><b>${rs2(tot(m))}</b></td></tr>`).join('');
  const detalhe = lista.map(m => {
    const linhas = m.linhas.slice().sort((a, b) => (a.data || '').localeCompare(b.data || ''));
    const cab = `<tr class="grupo"><td colspan="9"><b>${esc(m.nome)}</b> · responsável ${esc(m.resp)}${m.cobranca ? ' · cobrança ' + esc(m.cobranca) : ''}</td></tr>`;
    const mens = m.mensal ? `<tr><td colspan="4">Locação mensal <span class="nota">${m.mesesMensal}× ${rs2(m.valorMes)}</span></td><td class="n">${rs2(m.mensal)}</td><td class="n">—</td><td class="n">—</td><td class="n"><b>${rs2(m.mensal)}</b></td><td></td></tr>` : '';
    const rows = linhas.map(l => `<tr><td>${fdA(l.data)}</td><td>${esc(l.uso || '—')}</td><td>${esc(l.operTxt || '—')}</td><td class="n">${l.qtd ? nf(l.qtd, 1) : '—'}</td><td class="n">${rs2(l.c)}</td><td class="n">${l.lt ? nf(l.lt, 1) : '—'}</td><td class="n">${rs2(l.cb)}</td><td class="n"><b>${rs2(l.c + l.cb)}</b></td><td class="sub">${esc(l.nota)}</td></tr>`).join('');
    const sub = `<tr class="linha-total"><td colspan="4"><b>Total ${esc(m.nome)}</b></td><td class="n"><b>${rs2(m.custo + m.mensal)}</b></td><td class="n"><b>${nf(m.litros, 1)}</b></td><td class="n"><b>${rs2(m.comb)}</b></td><td class="n"><b>${rs2(tot(m))}</b></td><td></td></tr>`;
    return cab + mens + rows + sub;
  }).join('');
  const dif = Math.abs(gTot - (dd.equip + dd.comb)) > 1
    ? `<p class="nota">${p.fechado ? 'BM fechado: o desconto do boletim usa os valores congelados no fechamento (' + rs2(dd.equip + dd.comb) + '); esta tabela mostra o uso lançado hoje no período.' : 'Atenção: o total listado difere do desconto do boletim (' + rs2(dd.equip + dd.comb) + ').'}</p>` : '';
  return `<h2>Equipamentos e combustível do período — ${esc(emp)}</h2>
    <p class="nota">Uso de equipamento e combustível por máquina, lançados para ${esc(emp)} de ${p.ini === '0000-01-01' ? 'início da obra' : fdA(p.ini)} a ${fdA(p.fim)}. Locação mensal entra como desconto do mês; uso lançado do equipamento locado e abastecimento da SANY não somam de novo.</p>
    <table><thead><tr><th>Máquina / equipamento</th><th>Responsável</th><th>Cobrança</th><th class="n">Dias de uso</th><th class="n">Equipamento (R$)</th><th class="n">Litros</th><th class="n">Combustível (R$)</th><th class="n">Total descontado (R$)</th></tr></thead><tbody>${resumo}</tbody>
      <tfoot><tr><th colspan="4">Total de equipamentos + combustível</th><th class="n">${rs2(gEq)}</th><th class="n">${nf(gLt, 1)}</th><th class="n">${rs2(gCb)}</th><th class="n">${rs2(gTot)}</th></tr></tfoot></table>${dif}
    <h2>Detalhe por máquina — ${esc(emp)}</h2>
    <table><thead><tr><th>Data</th><th>Uso</th><th>Operador / abastecido por</th><th class="n">Qtd</th><th class="n">Equipamento (R$)</th><th class="n">Litros</th><th class="n">Combustível (R$)</th><th class="n">Total (R$)</th><th>Observação</th></tr></thead><tbody>${detalhe}</tbody></table>`;
}

// ---------------------------------------------------------------- resumo do período: o que foi gasto e o ganho produtivo
function bmResumoPeriodoHtml(emp, p, r, tot, cc) {
  const dd = r.ded, ini = p.ini === '0000-01-01' ? bmPrimeiraData(emp) : p.ini, fim = p.fim;
  const ganho = tot.per, equip = dd.equip, comb = dd.comb, gasto = equip + comb, resultado = ganho - gasto;
  const du = Math.max(1, contarDiasUteis(add(ini, -1), fim));
  const pctGasto = ganho > 0 ? gasto / ganho * 100 : null;
  const card = (rot, val, sub, cls) => `<div class="tile" style="--c:${cls}"><div class="rot"><span>${rot}</span></div><div class="val">${val}</div><div class="sub">${sub}</div></div>`;
  const dados = relEquipDados(emp, ini, fim, 'todos');
  const locados = new Set((dd.eqMensList || []).map(e => ganNorm(e.equipamento)));
  const eqs = dados.equipamentos.filter(q => q.emps.has(emp)).map(q => locados.has(ganNorm(q.equipamento)) ? { ...q, custo: 0 } : q);   // a locação mensal (linha abaixo) já cobre o equipamento
  const linhasEq = eqs.map(q => `<tr><td>${esc(q.equipamento)}</td><td>${esc(q.resp)}</td><td class="n">${q.dias.size}</td><td class="n">${rs(q.custo)}</td><td class="n">${nf(q.litros, 0)}</td><td class="n">${rs(q.comb)}</td><td class="n"><b>${rs(q.custo + q.comb)}</b></td></tr>`);
  (dd.eqMensList || []).forEach(e => linhasEq.push(`<tr><td>${esc(e.equipamento)} <span class="nota">locação mensal</span></td><td>${esc(e.responsavel || '')}</td><td class="n">—</td><td class="n">${rs(e.valor * mesesNoPeriodo(p.ini, p.fim))}</td><td class="n">—</td><td class="n">—</td><td class="n"><b>${rs(e.valor * mesesNoPeriodo(p.ini, p.fim))}</b></td></tr>`));
  const linhasIt = r.itens.filter(it => Math.abs(it.pctPer) > 1e-9).map(it => `<tr><td><b>${esc(it.item)}</b> ${esc(cap(it.desc || ''))}</td><td class="n">${nf(it.pctPer * 100, 1)}%</td><td class="n"><b>${rs(it.pctPer * it.valor[BM_R])}</b></td><td class="n">${nf(it.pct * 100, 1)}%</td></tr>`);
  return `<div class="bloco" id="bmResumoPer"><div class="bloco-cab"><h2>Resumo do período — gasto × ganho produtivo</h2><span class="nota">BM${p.n} · ${fdA(ini)} a ${fdA(fim)} · ${du} dias úteis${p.fechado ? ' · valores congelados no fechamento' : ''}</span></div>
    <div class="tiles">
      ${card('Ganho produtivo', rs(ganho), `medição do período · ${nf(tot.pctPer * 100, 1)}% do contrato · ${rs(ganho / du)} por dia útil`, 'var(--verde)')}
      ${card('Gasto no período', rs(gasto), `equipamentos ${rs(equip)} + combustível ${rs(comb)} (${nf(dd.litros, 0)} L)`, 'var(--vermelho)')}
      ${card('Resultado do período', rs(resultado), 'ganho produtivo − gasto com equipamentos e combustível', resultado < 0 ? 'var(--vermelho)' : 'var(--acento)')}
      ${card('Gasto por R$ ganho', pctGasto == null ? '—' : nf(pctGasto, 1) + '%', pctGasto == null ? 'sem medição no período' : `a cada R$ 100 medidos, R$ ${nf(pctGasto, 0)} foram para equipamento e combustível`, 'var(--fg3)')}
      ${card('Valor a faturar', rs(r.faturar[BM_R]), `medição − descontos (${rs(dd.total[BM_R])})`, 'var(--fg)')}
      ${card('Saldo a medir', rs(tot.contrato - tot.acum), `contrato ${rs(tot.contrato)} − medido acumulado ${rs(tot.acum)} · ${nf(tot.contrato ? (tot.contrato - tot.acum) / tot.contrato * 100 : 0, 1)}% do contrato`, 'var(--acento)')}
    </div>
    <div class="grade-2"><div><h3>Onde foi gasto</h3><div class="tabela-rolagem"><table><thead><tr><th>Equipamento</th><th>Responsável</th><th class="n">Dias</th><th class="n">Equip.</th><th class="n">Litros</th><th class="n">Combustível</th><th class="n">Total</th></tr></thead><tbody>${linhasEq.join('') || '<tr><td colspan="7" class="vazio">Sem uso de equipamento no período.</td></tr>'}</tbody></table></div></div>
      <div><h3>De onde veio o ganho</h3><div class="tabela-rolagem"><table><thead><tr><th>Item do catálogo</th><th class="n">Avanço no período</th><th class="n">Medido no período</th><th class="n">Acumulado</th></tr></thead><tbody>${linhasIt.join('') || '<tr><td colspan="4" class="vazio">Sem avanço medido no período.</td></tr>'}</tbody></table></div></div></div>
    ${p.fechado ? '<p class="nota">BM fechado: equipamento e combustível vêm do fechamento; a tabela “Onde foi gasto” mostra o uso lançado no período.</p>' : ''}
    ${bmProjecaoPainelHtml(emp)}</div>`;
}

// ---------------------------------------------------------------- projeção: próxima semana ou próximo plano ativo
function bmJanelaProj(emp, modo) {
  if (modo === 'plano') {
    const planos = pjPlanosAtivos().filter(pl => pl.fim > plBase()).sort((a, b) => a.inicio.localeCompare(b.inicio) || a.fim.localeCompare(b.fim));
    for (const pl of planos) {
      const pc = plPlanoCombinado([pl], emp);
      if (pc) return { modo: 'plano', plano: pl, pc, ini: maxD(add(plBase(), 1), pl.inicio), fim: pl.fim, rot: `Plano “${pl.nome}”` };
    }
    return null;
  }
  const seg = add(segunda(plBase()), 7);
  return { modo: 'semana', ini: seg, fim: add(seg, 4), rot: 'Próxima semana' };
}
// Ganho projetado: no plano, o que o plano ativo faz no ritmo atual (pjCalc); na semana, o ritmo dos últimos 14 dias de cada atividade do catálogo
function bmProjGanho(emp, j) {
  const base = plBase(), duJan = Math.max(0, contarDiasUteis(add(j.ini, -1), j.fim));
  if (j.modo === 'plano') {
    const r = pjCalc(j.pc, pjDaEmpresa(plCalc(j.pc), emp, j.pc), 1, BM_R);
    let proj = 0, plan = 0, unidades = 0;
    const linhas = r.itens.map(i => {
      let a = 0, b = 0;
      i.proj.forEach((v, d) => { if (d >= j.ini && d <= j.fim) { a += v * i.p; if (RE_RELAC_EQUIP.test(ganNorm(i.x.it.atividade))) unidades += v; } });
      i.plan.forEach((v, d) => { if (d >= j.ini && d <= j.fim) b += v * i.p; });
      proj += a; plan += b;
      return { nome: i.x.it.atividade, proj: a, plan: b };
    });
    return { proj, plan, linhas, duJan, unidades, origem: 'ritmo atual dos planos 5W2H (média dos últimos 5 dias úteis) × preço do BM' };
  }
  const a0 = add(base, -14), atual = bmItens(emp, base), ant = new Map(bmItens(emp, a0).flatMap(it => it.ats.map(x => [x.a.codigo, x.real]))), duHist = Math.max(1, contarDiasUteis(a0, base));
  let proj = 0;
  const linhas = [];
  atual.forEach(it => {
    let v = 0;
    it.ats.forEach(x => {
      const taxa = Math.max(0, x.real - (ant.get(x.a.codigo) || 0)) / duHist, saldo = Math.max(0, (x.a.qtd || 0) - x.real);
      const q = Math.min(saldo, taxa * duJan), tot = bmPrecoAtividade(it, x.a, BM_R).total;
      v += x.a.qtd ? q / x.a.qtd * tot : 0;
    });
    if (v > 0) { linhas.push({ nome: `${it.item} · ${cap(it.desc || '')}`, proj: v }); proj += v; }
  });
  return { proj, plan: null, linhas, duJan, origem: 'ritmo dos últimos 14 dias de cada atividade do catálogo, limitado ao saldo' };
}
function bmProjCusto(emp, duJan, unidades) {
  const base = plBase(), h = reHistoricoEquip(emp, base, null), ab = reAbastecimento(emp, base, 4);
  // no plano, o equipamento acompanha o que será produzido (R$ por unidade dos últimos BMs); na semana, o custo por dia útil
  const porUn = unidades > 0 && h.porUn != null;
  return { equip: porUn ? h.porUn * unidades : h.diaEquip != null ? h.diaEquip * duJan : null, base: porUn ? 'unidade' : 'dia', porUn: h.porUn, unidades,
    comb: ab.sem ? null : ab.custoSemana * duJan / 5, diaEquip: h.diaEquip, ab, bms: h.bms };
}
function bmProjecaoPainelHtml(emp) {
  const botoes = `<div class="seg" id="bmProjModo"><button data-bm-proj="semana" class="${bmProjModo === 'semana' ? 'ativa' : ''}">Próxima semana</button><button data-bm-proj="plano" class="${bmProjModo === 'plano' ? 'ativa' : ''}">Próximo plano ativo</button></div>`;
  let j = bmJanelaProj(emp, bmProjModo), aviso = '';
  if (!j) { aviso = `<p class="nota">Nenhum plano 5W2H ativo da empresa a partir de ${fdA(plBase())}: mostrando a próxima semana.</p>`; j = bmJanelaProj(emp, 'semana'); }
  let g, c, erro = '';
  try { g = bmProjGanho(emp, j); c = bmProjCusto(emp, g.duJan, g.unidades); } catch (e) { console.error(e); erro = e.message || String(e); }
  if (erro) return `<div class="bloco-cab"><h2>Projeção</h2>${botoes}</div><p class="aviso">Não foi possível calcular a projeção: ${esc(erro)}</p>`;
  const gasto = (c.equip || 0) + (c.comb || 0), resultado = g.proj - gasto;
  const card = (rot, val, sub, cor) => `<div class="tile" style="--c:${cor}"><div class="rot"><span>${rot}</span></div><div class="val">${val}</div><div class="sub">${sub}</div></div>`;
  const linhas = g.linhas.filter(l => l.proj > 0 || l.plan > 0).sort((a, b) => b.proj - a.proj).map(l => `<tr><td>${esc(l.nome)}</td>${g.plan != null ? `<td class="n">${rs(l.plan)}</td>` : ''}<td class="n"><b>${rs(l.proj)}</b></td></tr>`);
  return `<div class="bloco-cab" style="margin-top:14px"><h2>Projeção — ${esc(j.rot)}</h2>${botoes}</div>${aviso}
    <p class="nota">${fdA(j.ini)} a ${fdA(j.fim)} · ${g.duJan} dia(s) útil(eis)${j.modo === 'plano' ? ` · plano de ${fdA(j.plano.inicio)} a ${fdA(j.plano.fim)}` : ''}. Ganho: ${esc(g.origem)}.</p>
    <div class="tiles">
      ${card('Ganho projetado', rs(g.proj), g.plan != null ? `planejado no período: ${rs(g.plan)} (${g.plan ? nf(g.proj / g.plan * 100, 0) : '—'}% do planejado)` : 'no ritmo atual', 'var(--verde)')}
      ${card('Gasto projetado', rs(gasto), `equipamentos ${c.equip != null ? rs(c.equip) : '—'} + combustível ${c.comb != null ? rs(c.comb) : '—'}`, 'var(--vermelho)')}
      ${card('Resultado projetado', rs(resultado), 'ganho projetado − gasto projetado', resultado < 0 ? 'var(--vermelho)' : 'var(--acento)')}
      ${card('Gasto por R$ ganho', g.proj > 0 ? nf(gasto / g.proj * 100, 1) + '%' : '—', g.proj > 0 ? 'projetado' : 'sem ganho projetado (sem produção recente)', 'var(--fg3)')}
    </div>
    <div class="tabela-rolagem"><table><thead><tr><th>Atividade / item</th>${g.plan != null ? '<th class="n">Planejado (R$)</th>' : ''}<th class="n">Ganho projetado (R$)</th></tr></thead><tbody>${linhas.join('') || `<tr><td colspan="${g.plan != null ? 3 : 2}" class="vazio">Sem produção projetada (nenhuma atividade com ritmo recente).</td></tr>`}</tbody></table></div>
    <p class="nota">Custos: equipamentos = ${c.base === 'unidade' ? `R$ por unidade produzida nos últimos BMs = ${rs(c.porUn)} × ${nf(c.unidades, 1)} unid. projetadas nas atividades de içamento/montagem` : `R$ por dia útil dos últimos BMs (o mais recente pesa mais) = ${c.diaEquip != null ? rs(c.diaEquip) : '—'} × ${g.duJan} dia(s)`}; combustível = ${c.ab.sem ? 'sem registros de abastecimento' : `${rs(c.ab.custoSemana)}/semana (média inteligente dos últimos abastecimentos: ${nf(c.ab.litrosSemana, 0)} L/semana a R$ ${nf(c.ab.preco, 2)}/L)`}. É uma estimativa para decisão, não um lançamento.</p>`;
}

document.addEventListener('click', ev => {
  const b = ev.target.closest && ev.target.closest('[data-bm-proj]');
  if (!b) return;
  bmProjModo = b.dataset.bmProj;
  if (typeof renderBM === 'function') renderBM();
});
