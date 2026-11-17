'use strict';
// ------------------------------------------------------------------------------------------------
// CUSTO DE EQUIPAMENTO DA PRODUÇÃO — IÇAMENTO DE JOIST e VIGAS (aba Medição → Boletim)
// Atrela ao período da medição escolhida o custo de guindaste + plataforma (PTA) às atividades de içamento de joist e de vigas,
// para saber quanto custou aquela produção (R$ por unidade, % do valor medido) e quanto equipamento ficou sem produção.
//   Diária de referência = valor cadastrado ÷ 30 (cobrança MENSAL) ou o próprio valor (cobrança DIÁRIA). Sem valor cadastrado
//   (HORA, TURNO ou em branco) vale o custo lançado em "Uso de equipamentos".
//   Dia de equipamento com produção de içamento é repartido entre joist e vigas pelo valor produzido (quantidade × preço do BM);
//   dia de equipamento sem produção de içamento fica em "sem produção". É informação gerencial: não entra nos descontos do BM.
// Depende de app.js: T, M, empresa, empresasDe, ganNorm, bmAtiv, bmPrecoAtividade, bmTab, bmCalc, rs, rs2, nf, fdA, esc, hoje.
// ------------------------------------------------------------------------------------------------
const BC = { base: 'diaria' };
const BC_ATIVIDADES = [
  { chave: 'joist', rot: 'Içamento de joist', serv: 'ICAMENTO JOIST' },
  { chave: 'viga', rot: 'Vigas', serv: 'VIGAS' },
];
const BC_DIVISOR_MES = 30;

const bcCadastro = nome => (T.equipamentos || []).find(x => ganNorm(x.equipamento) === ganNorm(nome));
function bcEhIcamento(nome) {   // guindaste e plataforma elevatória (PTA); munck, caminhão e geradores não entram
  const cad = bcCadastro(nome);
  return /GUINDASTE|PLATAFORMA|\bPTA\b|SKYJACK/.test(ganNorm(`${nome} ${cad?.tipo || ''}`));
}
function bcDiaria(nome) {
  const cad = bcCadastro(nome), cob = ganNorm(cad?.cobranca || ''), val = Number(cad?.valor) || 0;
  if (val > 0 && cob === 'MENSAL') return { v: val / BC_DIVISOR_MES, origem: 'mensal ÷ 30', cad };
  if (val > 0 && cob === 'DIARIA') return { v: val, origem: 'diária', cad };
  return { v: 0, origem: 'sem valor — usa o lançado', cad };
}
function bcServico(e, serv) {
  const ls = e.servicos.filter(s => ganNorm(s.nome) === serv);
  return ls.find(s => /COBERTURA|GALPAO/.test(ganNorm(s.frente))) || ls[0] || null;
}

function bcCalc(emp, p, r) {
  const e = empresa(emp);
  if (!e) return null;
  const ini = p.ini, fim = p.fim, R = 'RÓTULA';
  // produção por dia e preço do BM de cada atividade de içamento
  const ativ = BC_ATIVIDADES.map(a => {
    const s = bcServico(e, a.serv), dias = new Map();
    if (s) for (const d in e.registros) {
      if (d < ini || d > fim) continue;
      const v = e.registros[d].v[s.col];
      if (typeof v === 'number' && v > 0) dias.set(d, v);
    }
    const bmA = bmAtiv(emp).find(x => ganNorm(x.controle || '') === a.serv);
    const it = bmA && r.itens.find(i => i.item === bmA.item);
    const preco = bmA && it ? bmPrecoAtividade(it, bmA, R).unit : 0;
    return { ...a, existe: !!s, dias, qtd: soma0([...dias.values()], v => v), preco, codigo: bmA?.codigo || '' };
  });
  if (!ativ.some(a => a.existe)) return null;
  // equipamentos de içamento usados pela empresa no período (uma linha por lançamento de uso, rateada entre as empresas do lançamento)
  const eqs = new Map(), custoDia = new Map();
  bmTab('usos').forEach(u => {
    if (!u.data || u.data < ini || u.data > fim || !u.equipamento || !bcEhIcamento(u.equipamento)) return;
    const uso = ganNorm(u.uso);
    if (uso.includes('ABASTECIMENTO') || uso.includes('NAO USO')) return;
    const emps = empresasDe(u.empresa), partes = emps.length || 1;
    if (!emps.includes(emp)) return;
    const w = (Number(u.quantidade) > 0 ? Number(u.quantidade) : uso.includes('MEIO') ? .5 : 1) / partes, lanc = (u.custo || 0) / partes;
    const key = ganNorm(u.equipamento);
    const q = eqs.get(key) || { nome: u.equipamento, dia: bcDiaria(u.equipamento), dias: new Set(), w: 0, lanc: 0, ref: 0 };
    const ref = q.dia.v > 0 ? q.dia.v * w : lanc;   // sem diária de referência vale o lançado
    q.dias.add(u.data); q.w += w; q.lanc += lanc; q.ref += ref;
    eqs.set(key, q);
    const c = custoDia.get(u.data) || { lanc: 0, ref: 0 };
    c.lanc += lanc; c.ref += ref;
    custoDia.set(u.data, c);
  });
  const usaRef = BC.base === 'diaria';
  const alo = Object.fromEntries(ativ.map(a => [a.chave, 0]));
  let semProd = 0, diasSemProd = 0, total = 0;
  custoDia.forEach((c, d) => {
    const custo = usaRef ? c.ref : c.lanc;
    total += custo;
    const prod = ativ.filter(a => a.dias.has(d));
    if (!prod.length) { semProd += custo; diasSemProd++; return; }
    const pesos = prod.map(a => a.dias.get(d) * (a.preco || 0)), soma = soma0(pesos, v => v);
    prod.forEach((a, i) => { alo[a.chave] += custo * (soma > 0 ? pesos[i] / soma : 1 / prod.length); });
  });
  const diasProdSemEquip = new Set();
  ativ.forEach(a => a.dias.forEach((v, d) => { if (!custoDia.has(d)) diasProdSemEquip.add(d); }));
  const diasProd = new Set(); ativ.forEach(a => a.dias.forEach((v, d) => diasProd.add(d)));
  return { emp, ativ: ativ.filter(a => a.existe), alo, eqs: [...eqs.values()].sort((a, b) => b.ref - a.ref), total, semProd, diasSemProd, usaRef,
    diasProdSemEquip: [...diasProdSemEquip].sort(), diasProd: diasProd.size, diasEquip: custoDia.size,
    totRef: soma0([...eqs.values()], q => q.ref), totLanc: soma0([...eqs.values()], q => q.lanc) };
}

function bmCustoIcamentoHtml(emp, p, r) {
  let c;
  try { c = bcCalc(emp, p, r); } catch (err) { console.warn('Custo de içamento:', err); return ''; }
  if (!c) return '';
  const per = `${p.ini === '0000-01-01' ? 'início da obra' : fdA(p.ini)} a ${fdA(p.fim)}`;
  const tile = (rot, val, sub, cc) => bmTile(rot, val, sub, cc);
  const alocado = soma0(Object.values(c.alo), v => v), valorMed = soma0(c.ativ, a => a.qtd * a.preco);
  const un = a => (a.qtd > 0 ? c.alo[a.chave] / a.qtd : null);
  let h = `<div class="bloco bc-bloco"><div class="bloco-cab"><h2>Custo de equipamento da produção — içamento de joist e vigas · ${esc(emp)}</h2>
    <div class="acoes"><label class="rot-sel">Base do custo <select id="selBcBase"><option value="diaria" ${c.usaRef ? 'selected' : ''}>Diária de referência (mensal ÷ 30)</option><option value="lancado" ${c.usaRef ? '' : 'selected'}>Lançado em Equipamentos</option></select></label></div></div>
    <p class="nota">Período ${per}. Guindaste + plataforma usados por ${esc(emp)} atrelados às atividades de içamento de joist e de vigas. Informação gerencial: não entra nos descontos do BM.</p>`;
  h += '<div class="tiles">' +
    tile('Custo de equipamento', rs(c.total), `${c.usaRef ? 'diária de referência' : 'lançado'} · ${nf(c.diasEquip, 0)} dia(s) com equipamento`, 'var(--acento)') +
    c.ativ.map(a => tile(`R$ por ${a.chave === 'joist' ? 'joist içado' : 'viga içada'}`, un(a) == null ? '—' : rs2(un(a)), `${nf(a.qtd, 0)} un · custo alocado ${rs(c.alo[a.chave])}`, 'var(--fg)')).join('') +
    tile('Custo ÷ valor medido', valorMed > 0 ? nf(alocado / valorMed * 100, 1) + '%' : '—', `valor produzido no período ${rs(valorMed)} (preço do BM)`, 'var(--verde)') +
    tile('Equipamento sem produção', rs(c.semProd), `${c.diasSemProd} dia(s) com guindaste/plataforma e sem içamento lançado`, c.semProd > 0.5 ? 'var(--amarelo)' : 'var(--verde)') + '</div>';
  h += `<div class="tabela-rolagem"><table class="tabela-bm bc-tab" data-sem-ferramentas><thead><tr><th>Atividade</th><th class="n">Produção no período</th><th class="n">Dias com produção</th><th class="n">Valor produzido (R$)</th><th class="n">Custo de equipamento (R$)</th><th class="n">R$ por unidade</th><th class="n">Custo ÷ valor</th></tr></thead><tbody>`;
  c.ativ.forEach(a => {
    const v = a.qtd * a.preco;
    h += `<tr><td><b>${esc(a.rot)}</b>${a.codigo ? ` <span class="nota">${esc(a.codigo)}</span>` : ''}</td><td class="n">${nf(a.qtd, 0)} un</td><td class="n">${a.dias.size}</td><td class="n">${rs(v)}</td><td class="n"><b>${rs(c.alo[a.chave])}</b></td><td class="n">${un(a) == null ? '—' : rs2(un(a))}</td><td class="n">${v > 0 ? nf(c.alo[a.chave] / v * 100, 1) + '%' : '—'}</td></tr>`;
  });
  h += `<tr><td>Equipamento sem produção de içamento <span class="nota">${c.diasSemProd} dia(s)</span></td><td></td><td></td><td></td><td class="n">${rs(c.semProd)}</td><td></td><td></td></tr>
    </tbody><tfoot><tr><td><b>Total</b></td><td></td><td class="n">${c.diasProd}</td><td class="n">${rs(valorMed)}</td><td class="n"><b>${rs(c.total)}</b></td><td></td><td class="n">${valorMed > 0 ? nf(c.total / valorMed * 100, 1) + '%' : '—'}</td></tr></tfoot></table></div>`;
  if (c.eqs.length) {
    h += `<div class="tabela-rolagem"><table class="bc-tab" data-sem-ferramentas><thead><tr><th>Equipamento</th><th>Tipo</th><th>Cobrança</th><th class="n">Valor cadastrado</th><th class="n">Diária de referência</th><th class="n">Dias de uso</th><th class="n">Custo pela diária</th><th class="n">Custo lançado</th></tr></thead><tbody>` +
      c.eqs.map(q => `<tr><td><b>${esc(q.nome)}</b></td><td>${esc(q.dia.cad?.tipo || '—')}</td><td>${esc(q.dia.cad?.cobranca || '—')}</td><td class="n">${q.dia.cad?.valor ? rs(q.dia.cad.valor) : '—'}</td>
        <td class="n ${q.dia.v > 0 ? '' : 'valor-neg'}" title="${esc(q.dia.origem)}">${q.dia.v > 0 ? rs2(q.dia.v) : 'sem valor'} <span class="nota">${esc(q.dia.v > 0 ? q.dia.origem : '')}</span></td>
        <td class="n">${nf(q.w, 1)}</td><td class="n">${rs(q.ref)}</td><td class="n">${rs(q.lanc)}</td></tr>`).join('') +
      `</tbody><tfoot><tr><td colspan="6"><b>Total</b></td><td class="n"><b>${rs(c.totRef)}</b></td><td class="n"><b>${rs(c.totLanc)}</b></td></tr></tfoot></table></div>`;
  } else {
    h += `<p class="vazio">Nenhum uso de guindaste ou plataforma lançado para ${esc(emp)} neste período (aba Equipamentos → Uso de equipamentos).</p>`;
  }
  const avisos = [];
  const semValor = c.eqs.filter(q => !(q.dia.v > 0));
  if (semValor.length) avisos.push(`${semValor.map(q => q.nome).join(', ')}: sem valor/cobrança DIÁRIA ou MENSAL no cadastro de equipamentos — para esse equipamento a base “diária” usa o custo lançado.`);
  if (c.diasProdSemEquip.length) avisos.push(`${c.diasProdSemEquip.length} dia(s) com içamento lançado e nenhum guindaste/plataforma lançado para ${emp} (${c.diasProdSemEquip.slice(0, 6).map(fdA).join(', ')}${c.diasProdSemEquip.length > 6 ? '…' : ''}): o custo desses dias não está no cálculo.`);
  if (avisos.length) h += `<ul class="alertas">${avisos.map(a => `<li><span class="farol f-amarelo">Atenção</span><span>${esc(a)}</span></li>`).join('')}</ul>`;
  return h + '</div>';
}

document.addEventListener('change', ev => {
  if (ev.target.id === 'selBcBase') { BC.base = ev.target.value; if (typeof renderBM === 'function') renderBM(); }
});
