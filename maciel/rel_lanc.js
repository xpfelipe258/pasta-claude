'use strict';
// ------------------------------------------------------------------------------------------------
// LANÇAMENTOS › botão "Relatório de produção" — produção do período só das atividades que tiveram avanço.
// Empresa = a empresa selecionada nas abas de Lançamentos (EJ, CMM, GLOBO AÇOS…) — o relatório é sempre de UMA empresa; período = caixas de data ao lado do botão (acompanham o período do Painel).
// Usa o catálogo de atividades do BM (o mesmo da grade de Lançamentos) e a janela de visualização do relatório das empresas (reAbrirPrevia).
// Depende de app.js e rel_empresa.js.
// ------------------------------------------------------------------------------------------------

function lcDados(emp, ini, fim) {
  const e = empresa(emp), ant = ini && ini > '0000-01-01' ? add(ini, -1) : null;
  const itsAnt = new Map((ant ? bmItens(emp, ant) : []).map(i => [i.item, i]));
  const itens = [];
  let contrato = 0;
  bmItens(emp, fim).forEach(it => {
    contrato += it.valor['RÓTULA'] || 0;
    const a0 = itsAnt.get(it.item), realAnt = new Map(((a0 && a0.ats) || []).map(x => [x.a.codigo, x.real]));
    const ats = [];
    it.ats.forEach(({ a, real, pct }) => {
      const ra = realAnt.get(a.codigo) || 0, per = real - ra;
      if (!(per > 1e-9)) return;   // só o que teve avanço no período
      const ctl = a.controle && e ? colDe(e, a.controle) : null;
      const dias = ganBmDatasAtividade(a, fim, true).filter(([d]) => d >= ini && d <= fim).map(([d, v]) => [d, ctl ? bmQtdFinanceira(a, v) : v]);
      ats.push({ a, per, real, pct, ra,
        und: ctl ? soma(e, ctl, ini, fim) : null, undAc: ctl ? soma(e, ctl, '0000', fim) : null,
        dias, preco: bmPrecoAtividade(it, a) });
    });
    if (!ats.length) return;
    const avanco = it.pct - (a0 ? a0.pct : 0);
    itens.push({ it, ats, avanco, valor: avanco * (it.valor['RÓTULA'] || 0) });
  });
  const porDia = new Map();
  itens.forEach(x => x.ats.forEach(t => t.dias.forEach(([d, v]) => { const l = porDia.get(d) || []; l.push({ a: t.a, v }); porDia.set(d, l); })));
  const medicao = itens.reduce((s, x) => s + x.valor, 0);
  let equip = null;
  try { equip = lcEquip(emp, ini, fim); } catch (e) { console.error('custo de equipamentos', e); }
  return { emp, ini, fim, equip, itens, contrato, medicao, nAtiv: itens.reduce((s, x) => s + x.ats.length, 0), dias: [...porDia.entries()].sort((a, b) => a[0].localeCompare(b[0])) };
}

// Custo de equipamentos da empresa no período: MENSAL = valor mensal cheio × meses-calendário que o período toca (custo fixo, sem ratear por dia);
// DIÁRIO (uso lançado) e ABASTECIMENTO = só o que foi lançado entre as datas. Uso lançado de equipamento mensal com responsável não soma de novo (já é o fixo).
function lcEquip(emp, ini, fim) {
  const locados = bmEquipamentosLocados(emp), nomesLocados = new Set(locados.map(e => ganNorm(e.equipamento)));
  const meses = mesesNoPeriodo(ini, fim);
  const mensal = locados.map(e => ({ equip: e.equipamento, valor: e.valor || 0, meses, total: (e.valor || 0) * meses })).sort((a, b) => b.total - a.total);
  const diario = relEquipDados(emp, ini, fim, 'equipamento').equipamentos.filter(q => q.custo > 0 && !nomesLocados.has(ganNorm(q.equipamento))).sort((a, b) => b.custo - a.custo);
  const abast = relEquipDados(emp, ini, fim, 'abastecimento').equipamentos.filter(q => q.comb > 0 || q.litros > 0).sort((a, b) => b.comb - a.comb);
  const tMensal = soma0(mensal, x => x.total), tDiario = soma0(diario, x => x.custo), tAbast = soma0(abast, x => x.comb);
  return { mensal, diario, abast, meses, tMensal, tDiario, tAbast, total: tMensal + tDiario + tAbast, litros: soma0(abast, x => x.litros) };
}

function lcEquipHtml(q) {
  const card = (rot, val, sub, cls) => `<div class="card ${cls}"><div class="rot">${rot}</div><div class="val">${val}</div><div class="sub">${sub}</div></div>`;
  const vazio = n => `<tr><td colspan="${n}" class="vazio">Sem registros no período.</td></tr>`;
  const rM = q.mensal.map(x => `<tr><td><b>${esc(x.equip)}</b></td><td class="n">${rs2(x.valor)}</td><td class="n">${nf(x.meses, 0)}</td><td class="n"><b>${rs2(x.total)}</b></td></tr>`).join('') || vazio(4);
  const rD = q.diario.map(x => `<tr><td><b>${esc(x.equipamento)}</b></td><td>${esc(x.resp)}</td><td class="n">${x.dias.size}</td><td class="n"><b>${rs2(x.custo)}</b></td></tr>`).join('') || vazio(4);
  const rA = q.abast.map(x => `<tr><td><b>${esc(x.equipamento)}</b></td><td>${esc(x.resp)}</td><td class="n">${nf(x.litros, 1)}</td><td class="n"><b>${rs2(x.comb)}</b></td></tr>`).join('') || vazio(4);
  return `<h2>Custo de equipamentos no período</h2>
    <div class="cards">
      ${card('Custo total de equipamentos', rs2(q.total), 'mensal + diário + abastecimento', 'vm')}
      ${card('Equipamentos mensais', rs2(q.tMensal), `custo fixo — valor mensal cheio × ${nf(q.meses, 0)} mês(es) tocado(s) pelo período`, 'az')}
      ${card('Equipamentos diários', rs2(q.tDiario), 'uso lançado dentro do período', 'am')}
      ${card('Abastecimento', rs2(q.tAbast), `${nf(q.litros, 1)} L lançados dentro do período`, 'vd')}
    </div>
    <h3>Mensais (custo fixo)</h3><table><thead><tr><th>Equipamento</th><th class="n">Valor mensal</th><th class="n">Meses</th><th class="n">Custo</th></tr></thead><tbody>${rM}</tbody><tfoot><tr><th colspan="3">Total</th><th class="n">${rs2(q.tMensal)}</th></tr></tfoot></table>
    <h3>Diários (uso no período)</h3><table><thead><tr><th>Equipamento</th><th>Responsável</th><th class="n">Dias de uso</th><th class="n">Custo</th></tr></thead><tbody>${rD}</tbody><tfoot><tr><th colspan="3">Total</th><th class="n">${rs2(q.tDiario)}</th></tr></tfoot></table>
    <h3>Abastecimento (no período)</h3><table><thead><tr><th>Máquina / equipamento</th><th>Responsável</th><th class="n">Litros</th><th class="n">Valor</th></tr></thead><tbody>${rA}</tbody><tfoot><tr><th colspan="3">Total</th><th class="n">${rs2(q.tAbast)}</th></tr></tfoot></table>`;
}

function lcHtmlEmpresa(d) {
  const card = (rot, val, sub, cls) => `<div class="card ${cls}"><div class="rot">${rot}</div><div class="val">${val}</div><div class="sub">${sub}</div></div>`;
  const cab = `<h1>${esc(d.emp)}</h1><p class="sub-cab">Produção do período · ${fdA(d.ini)} a ${fdA(d.fim)} · só as atividades do catálogo (BM) que tiveram avanço</p>`;
  const custoEq = d.equip ? lcEquipHtml(d.equip) : '<p class="aviso">Não foi possível calcular o custo de equipamentos.</p>';
  if (!d.itens.length) return `<section class="emp-sec"><div class="pag">${cab}<p class="aviso">Nenhuma atividade teve avanço neste período.</p>${custoEq}</div></section>`;
  const pc = v => nf(v * 100, 1) + '%';
  let linhas = '';
  d.itens.forEach(x => {
    linhas += `<tr class="grupo"><td colspan="5"><b>${esc(x.it.item)}</b> ${esc(cap(x.it.desc))}</td><td class="n"><b>+${pc(x.avanco)}</b> no período</td><td class="n">${pc(x.it.pct)}</td><td></td><td class="n"><b>${rs2(x.valor)}</b></td></tr>`;
    x.ats.forEach(t => {
      const a = t.a, ds = t.dias.map(z => z[0]).sort(), nDias = new Set(ds).size;
      linhas += `<tr><td>${esc(a.atividade)}</td><td>${bmLegendaUnidade(a)}</td><td class="n">${bmFmtQtdFinanceira(a, a.qtd, a.controle ? bmQtdContratadaUnd(a) : null)}</td>
        <td class="n"><b>${bmFmtQtdFinanceira(a, t.per, t.und)}</b></td><td class="n">${bmFmtQtdFinanceira(a, t.real, t.undAc)}</td>
        <td class="n">+${pc(a.qtd ? t.per / a.qtd : 0)}</td><td class="n">${pc(t.pct)}</td>
        <td class="nota">${nDias} dia(s)${ds.length ? ` · ${fdA(ds[0])}${ds[ds.length - 1] !== ds[0] ? ' a ' + fdA(ds[ds.length - 1]) : ''}` : ''}</td><td class="n">${rs2(t.per * t.preco.unit)}</td></tr>`;
    });
  });
  const dia = d.dias.map(([dt, l]) => `<tr><td class="n">${fdA(dt)}</td><td>${l.map(z => `${esc(z.a.atividade)} <span class="nota">(${esc(z.a.item)})</span>: <b>${bmFmtQtdFinanceira(z.a, z.v)}</b>`).join(' · ')}</td></tr>`).join('');
  return `<section class="emp-sec"><div class="pag">${cab}
    <div class="cards">
      ${card('Itens com avanço', nf(d.itens.length), `${nf(d.nAtiv)} atividade(s) com produção no período`, 'az')}
      ${card('Medição estimada do período', rs(d.medicao), `${pc(d.contrato ? d.medicao / d.contrato : 0)} do contrato (valor do item × peso)`, 'vd')}
      ${card('Dias com lançamento', nf(d.dias.length), d.dias.length ? `de ${fdA(d.dias[0][0])} a ${fdA(d.dias[d.dias.length - 1][0])}` : '—', 'am')}
    </div>
    <h2>Produção por atividade</h2>
    <table><thead><tr><th>Atividade (BM)</th><th>Un.</th><th class="n">Contratado</th><th class="n">No período</th><th class="n">Acumulado</th><th class="n">% da atividade no período</th><th class="n">% acumulado</th><th>Lançado em</th><th class="n">Valor do período</th></tr></thead><tbody>${linhas}</tbody></table>
    <h2>Dia a dia</h2>
    <table><thead><tr><th class="n" style="width:90px">Data</th><th>O que foi lançado</th></tr></thead><tbody>${dia || '<tr><td colspan="2" class="vazio">Sem lançamentos datados no período.</td></tr>'}</tbody></table>
    ${custoEq}
  </div></section>`;
}

async function lcHtml(ini, fim, emps) {
  await tplLogosCarregar();
  return tplDocumento({ titulo: 'Produção do período', subtitulo: `${emps.join(' · ')} — ${fdA(ini)} a ${fdA(fim)}`, meta: 'Atividades do catálogo (BM) com avanço no período · custo de equipamentos (mensal fixo + diário + abastecimento)', corpo: emps.map(emp => lcHtmlEmpresa(lcDados(emp, ini, fim))).join(''), empresa: emps.length === 1 ? emps[0] : '' });
}

let lcBarPer = '';
function lcSincronizarBarra() {   // chamada a cada desenho de Lançamentos: as datas acompanham o período do Painel até serem editadas
  const a = document.getElementById('lcBarIni'), b = document.getElementById('lcBarFim');
  if (!a || !b) return;
  const p = per || { ini: ref, fim: ref }, k = `${p.ini}|${p.fim}`;
  if (lcBarPer !== k) { lcBarPer = k; a.value = p.ini; b.value = p.fim; }
  const btn = document.getElementById('btnRelLanc');
  if (btn && !btn.disabled) btn.textContent = `Relatório de produção · ${lcEmpresaSel() || '—'}`;
}
const lcEmpresaSel = () => (M.empresas.find(x => x.aba === empSel) || M.empresas[0] || {}).nome || '';
async function lcGerar() {
  const ini = document.getElementById('lcBarIni').value, fim = document.getElementById('lcBarFim').value, btn = document.getElementById('btnRelLanc');
  if (!ehISO(ini) || !ehISO(fim) || fim < ini) { toast('Informe um período válido ao lado do botão.', true); return; }
  const emp = lcEmpresaSel();
  if (!emp) { toast('Selecione a empresa nas abas de Lançamentos.', true); return; }
  const rot = btn.textContent; btn.disabled = true; btn.textContent = 'Montando…';
  try {
    reAbrirPrevia(await lcHtml(ini, fim, [emp]), `producao-${emp.replace(/\s+/g, '-')}-${ini}_a_${fim}.html`,
      `Produção do período · ${emp} · ${fdA(ini)} a ${fdA(fim)}`);
  } catch (e) { console.error(e); toast('Não foi possível gerar: ' + (e.message || e), true); }
  finally { btn.disabled = false; btn.textContent = rot; }
}
document.addEventListener('click', ev => { if (ev.target.closest && ev.target.closest('#btnRelLanc')) lcGerar(); });
