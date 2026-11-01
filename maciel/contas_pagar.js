'use strict';
// ------------------------------------------------------------------------------------------------
// FINANCEIRO › CONTAS A PAGAR (por obra)
//   • Imposto  — percentual (informado no cadastro) sobre o VALOR A FATURAR do mês na Medição (BM): soma, das empresas, dos BMs cujo corte cai no mês
//                (medido − descontos, a mesma conta do Boletim). O BM em aberto conta no mês da data de referência, como parcial.
//   • Folha    — custo mensal de todos os colaboradores cadastrados em Gestão › Pessoal (salário + encargos + provisões + benefícios),
//                calculado no servidor (os salários não vão no modelo geral da obra). Ver parâmetros em "Parâmetros da folha".
//   • Outros   — valor fixo mensal ou único (aluguel, seguro, contabilidade, fornecedor…).
// Cada conta é uma regra; o pagamento de cada mês é registrado ("Pagar") e a situação é Paga, Aberta ou Vencida.
// Depende de app.js: ref, bmEmpresas, bmPeriodos, bmCalc, ganNorm, rs2, nf, fdA, esc, postar, API, toast, D, M, T.
// ------------------------------------------------------------------------------------------------
const CP = { mes: '', dados: null, cacheBm: new Map(), carregando: false };
const CP_TIPOS = { IMPOSTO: 'Imposto', FOLHA: 'Folha salarial', OUTROS: 'Outros' };
const CP_R = 'RÓTULA';
// Sugestões de impostos (percentuais de referência — o contador confirma o que vale para a empresa, o município e o regime tributário)
const CP_IMPOSTOS = [
  ['ISS — Imposto sobre serviços', 'ISS', 3, 'Municipal: de 2% a 5% conforme o município e o serviço.'],
  ['PIS', 'PIS', 0.65, '0,65% no cumulativo (lucro presumido); 1,65% no não cumulativo.'],
  ['COFINS', 'COFINS', 3, '3% no cumulativo (lucro presumido); 7,6% no não cumulativo.'],
  ['IRPJ (lucro presumido)', 'IRPJ', 4.8, '32% de presunção × 15%.'],
  ['CSLL (lucro presumido)', 'CSLL', 2.88, '32% de presunção × 9%.'],
  ['INSS retido na nota (cessão de mão de obra)', 'INSS', 11, 'Retenção de 11% sobre a nota quando há cessão de mão de obra.'],
  ['Simples Nacional (alíquota efetiva)', 'Simples', 0, 'A alíquota efetiva muda por faixa de faturamento — peça ao contador.'],
  ['CPRB — contribuição sobre a receita bruta', 'CPRB', 0, 'Use quando a folha for desonerada (parâmetro "CPRB" em Parâmetros da folha).'],
];
const CP_OUTROS = ['Aluguel de canteiro / escritório', 'Seguro da obra', 'Contabilidade', 'Fornecedor', 'Locação de equipamento', 'Energia e água', 'Alimentação da equipe', 'Taxas e licenças'];

function cpPodeEditar() { return !(D && D.usuario && D.usuario.perfil === 'leitura'); }
function cpMesDe(iso) { return String(iso || '').slice(0, 7); }
function cpMesSomar(ym, n) { const [a, m] = ym.split('-').map(Number), t = a * 12 + (m - 1) + n; return `${Math.floor(t / 12)}-${String(t % 12 + 1).padStart(2, '0')}`; }
function cpMesRot(ym) { const [a, m] = ym.split('-'); return ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'][Number(m) - 1] + ' de ' + a; }
function cpMesCurto(ym) { const [a, m] = ym.split('-'); return ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][Number(m) - 1] + '/' + a.slice(2); }
function cpPerc(v) { return nf(v, 2) + '%'; }

async function cpBuscar(mes) {
  CP.carregando = true;
  try {
    const r = await fetch(API + 'contas-pagar&mes=' + encodeURIComponent(mes), { cache: 'no-store' });
    const j = await r.json().catch(() => ({ erro: 'Resposta inválida do servidor' }));
    if (r.status === 401) { location.href = 'login.php'; return; }
    if (!r.ok) throw new Error(j.erro || 'Falha ao carregar as contas a pagar');
    CP.dados = j; CP.mes = j.mes;
  } finally { CP.carregando = false; }
}

async function cpAcao(corpo) {
  const j = await postar(API + 'contas-pagar', { ...corpo, mes: CP.mes });
  CP.dados = j;
  return j;
}

// ----- valor a faturar do mês (Medição): BMs com corte no mês, de uma empresa ou de todas
function cpFaturarMes(ym, empresa) {
  const chave = ym + '|' + (empresa || '') + '|' + ref;
  if (CP.cacheBm.has(chave)) return CP.cacheBm.get(chave);
  const det = [];
  let total = 0, parcial = false;
  const alvo = empresa ? ganNorm(empresa) : '';
  bmEmpresas().filter(e => !alvo || ganNorm(e) === alvo).forEach(emp => {
    bmPeriodos(emp).forEach(p => {
      if (cpMesDe(p.fim) !== ym) return;
      if (!p.cortado && ym !== cpMesDe(ref)) return;   // BM em aberto só vale no mês da data de referência
      const r = bmCalc(emp, p);
      const v = Math.max(0, r.faturar[CP_R] || 0);
      det.push({ emp, n: p.n, fechado: !!p.fechado, parcial: !p.cortado, medido: r.tot[CP_R].per, descontos: r.ded.total[CP_R], faturar: v });
      if (!p.cortado) parcial = true;
      total += v;
    });
  });
  const out = { total: Math.round(total * 100) / 100, det, parcial };
  CP.cacheBm.set(chave, out);
  return out;
}

function cpAtiva(c, ym) { return !!c.ativo && ym >= c.comp_inicio && (!c.comp_fim || ym <= c.comp_fim); }

function cpFolhaDaConta(c, ym) {
  const f = (CP.dados.folha || {})[ym];
  if (!f) return { total: 0, n: 0, prov: 0 };
  const alvo = c.empresa ? String(c.empresa).trim().toUpperCase() : '';
  const base = alvo ? ((f.por_empresa || {})[alvo] || { total: 0, provisoes: 0, n: 0 }) : f;
  const total = c.base_folha === 'caixa' ? base.total - base.provisoes : base.total;
  return { total: Math.round(total * 100) / 100, n: base.n, prov: base.provisoes, semSalario: alvo ? 0 : f.sem_salario };
}

// valor previsto da conta no mês + de onde veio o número
function cpPrevisto(c, ym) {
  if (c.tipo === 'IMPOSTO') {
    const f = cpFaturarMes(ym, c.empresa);
    return { valor: Math.round(f.total * c.percentual) / 100, base: f.total, det: f.det, parcial: f.parcial, semBase: !f.det.length };
  }
  if (c.tipo === 'FOLHA') {
    const f = cpFolhaDaConta(c, ym);
    return { valor: f.total, n: f.n, prov: f.prov, base: f.total };
  }
  return { valor: c.valor || 0 };
}

function cpVencimento(c, ym) {
  const alvo = c.venc_mes_seguinte ? cpMesSomar(ym, 1) : ym;
  const [a, m] = alvo.split('-').map(Number), ult = new Date(a, m, 0).getDate();
  return `${alvo}-${String(Math.min(c.dia_venc || 10, ult)).padStart(2, '0')}`;
}

function cpBaixaDe(c, ym) { return (CP.dados.baixas || []).find(b => b.conta_id === c.id && b.competencia === ym); }

function cpLinhasMes(ym) {
  return (CP.dados.contas || []).filter(c => cpAtiva(c, ym)).map(c => {
    const p = cpPrevisto(c, ym), baixa = cpBaixaDe(c, ym), venc = cpVencimento(c, ym), hoje = CP.dados.hoje;
    const situ = baixa ? 'PAGA' : venc < hoje ? 'VENCIDA' : 'ABERTA';
    return { c, p, baixa, venc, situ, valor: baixa ? baixa.valor_pago : p.valor };
  }).sort((a, b) => a.venc.localeCompare(b.venc) || a.c.descricao.localeCompare(b.c.descricao));
}

function cpTotais(linhas) {
  const t = { total: 0, pago: 0, aberto: 0, vencido: 0, IMPOSTO: 0, FOLHA: 0, OUTROS: 0 };
  linhas.forEach(l => {
    const prev = l.p.valor;
    t.total += prev; t[l.c.tipo] += prev;
    if (l.situ === 'PAGA') t.pago += l.baixa.valor_pago;
    else { t.aberto += prev; if (l.situ === 'VENCIDA') t.vencido += prev; }
  });
  Object.keys(t).forEach(k => { t[k] = Math.round(t[k] * 100) / 100; });
  return t;
}

function cpAlertas(ym, linhas) {
  const a = [];
  const f = (CP.dados.folha || {})[ym];
  const temFolha = linhas.some(l => l.c.tipo === 'FOLHA');
  if (f && f.sem_salario > 0) a.push(['vermelho', `${f.sem_salario} colaborador(es) ativo(s) sem salário informado — a folha está subestimada. Complete em Gestão › Pessoal › Colaboradores: ${(f.sem_salario_nomes || []).slice(0, 5).join(', ')}${f.sem_salario > 5 ? '…' : ''}.`]);
  if (f && f.n === 0 && temFolha) a.push(['amarelo', 'Nenhum colaborador ativo cadastrado neste mês: a folha está zerada. Cadastre em Gestão › Pessoal › Colaboradores.']);
  if (!temFolha && f && f.n > 0) a.push(['amarelo', `Há ${f.n} colaborador(es) cadastrado(s), mas nenhuma conta de Folha salarial: use “+ Nova conta a pagar” › Folha salarial.`]);
  linhas.filter(l => l.c.tipo === 'IMPOSTO' && l.p.semBase).forEach(l => a.push(['amarelo', `${l.c.descricao}: nenhuma medição (BM) com corte em ${cpMesRot(ym)} — o imposto do mês ficou zerado até haver um BM.`]));
  linhas.filter(l => l.c.tipo === 'IMPOSTO' && l.p.parcial).forEach(l => a.push(['azul', `${l.c.descricao}: usa o BM em aberto (parcial). O valor muda até o corte do BM.`]));
  const venc = linhas.filter(l => l.situ === 'VENCIDA');
  if (venc.length) a.push(['vermelho', `${venc.length} conta(s) vencida(s) somando ${rs2(venc.reduce((s, l) => s + l.p.valor, 0))}.`]);
  // conferência com o efetivo lançado no DP
  const dias = new Map();
  (T.dp_efetivo || []).filter(r => cpMesDe(r.data) === ym).forEach(r => dias.set(r.data, (dias.get(r.data) || 0) + (Number(r.quantidade) || 0)));
  if (dias.size && f && f.n > 0) {
    const media = [...dias.values()].reduce((s, v) => s + v, 0) / dias.size;
    if (Math.abs(media - f.n) / f.n > 0.25) a.push(['azul', `O Efetivo diário (DP) lançou em média ${nf(media, 1)} pessoa(s)/dia neste mês, e o cadastro tem ${f.n} colaborador(es) ativos. Confira se todos estão cadastrados ou se há cadastro de quem já saiu.`]);
  }
  return a;
}

function cpFarol(situ, dias) {
  const m = { PAGA: ['verde', 'PAGA'], ABERTA: ['amarelo', 'EM ABERTO'], VENCIDA: ['vermelho', 'VENCIDA'] }[situ];
  return `<span class="farol f-${m[0]}">${m[1]}</span>`;
}

// ----- tela
async function renderContasPagar() {
  const box = $('#cpCorpo');
  if (!box) return;
  if (!CP.mes) CP.mes = cpMesDe(ref) || cpMesDe(new Date().toISOString());
  if (!CP.dados || CP.dados.mes !== CP.mes) {
    box.innerHTML = '<div class="bloco"><p class="vazio">Carregando as contas a pagar…</p></div>';
    try { await cpBuscar(CP.mes); }
    catch (e) { box.innerHTML = `<div class="bloco"><p class="vazio">${esc(e.message)}</p></div>`; return; }
  }
  cpDesenhar();
}

function cpDesenhar() {
  const box = $('#cpCorpo'), ym = CP.mes, editar = cpPodeEditar();
  CP.cacheBm.clear();
  const linhas = cpLinhasMes(ym), t = cpTotais(linhas), alertas = cpAlertas(ym, linhas);
  const fat = cpFaturarMes(ym, '');
  const meses = [-2, -1, 0, 1, 2, 3, 4, 5].map(n => cpMesSomar(ym, n));
  const resumo = meses.map(m => ({ m, t: cpTotais(cpLinhasMes(m)) }));
  const maxTot = Math.max(1, ...resumo.map(r => r.t.total));
  const tile = (rot, val, sub, cor) => `<div class="tile" style="--c:${cor}"><div class="rot"><span>${rot}</span></div><div class="val">${val}</div><div class="sub">${sub}</div></div>`;
  const pctFat = fat.total > 0 ? ` · ${nf(t.total / fat.total * 100, 1)}% do valor a faturar` : '';
  box.innerHTML = `
    <div class="barra-acoes cp-barra">
      <div class="cp-mes"><button class="btn" data-cp-mes="-1" aria-label="Mês anterior">‹</button>
        <label class="rot-sel">Mês <input type="month" id="cpMesSel" value="${esc(ym)}"></label>
        <button class="btn" data-cp-mes="1" aria-label="Próximo mês">›</button></div>
      <strong class="cp-mes-rot">${esc(cpMesRot(ym).replace(/^./, c => c.toUpperCase()))}</strong>
      <span class="espaco"></span>
      <button class="btn" data-cp-params>Parâmetros da folha</button>
      ${editar ? '<button class="btn primario" data-cp-nova>+ Nova conta a pagar</button>' : ''}
    </div>
    <div class="tiles cp-tiles">
      ${tile('Previsto no mês', rs2(t.total), `${linhas.length} conta(s)${pctFat}`, 'var(--fg)')}
      ${tile('Pago', rs2(t.pago), `${linhas.filter(l => l.situ === 'PAGA').length} conta(s) paga(s)`, 'var(--verde)')}
      ${tile('Em aberto', rs2(t.aberto), 'ainda a pagar', 'var(--amarelo)')}
      ${tile('Vencido', rs2(t.vencido), t.vencido > 0 ? 'precisa de atenção' : 'nada vencido', t.vencido > 0 ? 'var(--vermelho)' : 'var(--verde)')}
      ${tile('Valor a faturar (Medição)', rs2(fat.total), fat.det.length ? fat.det.map(d => `${esc(d.emp)} BM${d.n}${d.parcial ? ' (em aberto)' : ''}`).join(' · ') : 'nenhum BM com corte neste mês', 'var(--acento)')}
    </div>
    ${alertas.length ? `<div class="bloco cp-alertas"><div class="bloco-cab"><h2>Pontos de atenção</h2></div><ul>${alertas.map(([cor, txt]) => `<li class="cp-al cp-al-${cor}">${esc(txt)}</li>`).join('')}</ul></div>` : ''}
    <div class="bloco">
      <div class="bloco-cab"><h2>Contas de ${esc(cpMesRot(ym))}</h2><span class="nota">Imposto = % sobre o valor a faturar da Medição · Folha = colaboradores de Gestão › Pessoal · Outros = valor fixo</span></div>
      ${linhas.length ? `<div class="tabela-rolagem"><table class="cp-tab" data-sem-ferramentas data-sem-limite><thead><tr><th>Vencimento</th><th>Conta</th><th>Tipo</th><th>Como foi calculado</th><th class="n">Previsto (R$)</th><th>Situação</th><th class="n">Pago (R$)</th><th></th></tr></thead><tbody>
        ${linhas.map(l => cpLinhaHtml(l, editar)).join('')}
      </tbody><tfoot><tr><td colspan="4"><b>Total do mês</b></td><td class="n"><b>${rs2(t.total)}</b></td><td></td><td class="n"><b>${rs2(t.pago)}</b></td><td></td></tr></tfoot></table></div>`
        : `<p class="vazio">Nenhuma conta a pagar neste mês. ${editar ? 'Use “+ Nova conta a pagar” para cadastrar imposto, folha salarial ou outras contas.' : ''}</p>`}
    </div>
    <div class="bloco">
      <div class="bloco-cab"><h2>Resumo dos meses</h2><span class="nota">Meses futuros: o imposto só tem valor depois que há medição (BM); a folha usa os colaboradores ativos de hoje.</span></div>
      <div class="tabela-rolagem"><table class="cp-tab" data-sem-ferramentas data-sem-limite><thead><tr><th>Mês</th><th class="n">Imposto</th><th class="n">Folha</th><th class="n">Outros</th><th class="n">Total</th><th class="n">Pago</th><th class="cp-barra-col"></th></tr></thead><tbody>
        ${resumo.map(r => `<tr class="${r.m === ym ? 'cp-atual' : ''}"><td><a href="#" data-cp-ir="${r.m}">${esc(cpMesCurto(r.m))}</a></td><td class="n">${rs2(r.t.IMPOSTO)}</td><td class="n">${rs2(r.t.FOLHA)}</td><td class="n">${rs2(r.t.OUTROS)}</td><td class="n"><b>${rs2(r.t.total)}</b></td><td class="n">${rs2(r.t.pago)}</td>
          <td class="cp-barra-col"><span class="cp-bar"><i class="cp-b-imp" style="width:${r.t.IMPOSTO / maxTot * 100}%"></i><i class="cp-b-fol" style="width:${r.t.FOLHA / maxTot * 100}%"></i><i class="cp-b-out" style="width:${r.t.OUTROS / maxTot * 100}%"></i></span></td></tr>`).join('')}
      </tbody></table></div>
      <p class="nota cp-leg"><i class="cp-b-imp"></i> Imposto <i class="cp-b-fol"></i> Folha <i class="cp-b-out"></i> Outros</p>
    </div>`;
}

function cpLinhaHtml(l, editar) {
  const c = l.c, p = l.p;
  let como = '';
  if (c.tipo === 'IMPOSTO') {
    como = p.semBase ? '<span class="nota">sem medição com corte no mês</span>'
      : `${cpPerc(c.percentual)} × ${rs2(p.base)}<br><span class="nota">valor a faturar${c.empresa ? ' da ' + esc(c.empresa) : ''}: ${p.det.map(d => `${esc(d.emp)} BM${d.n}${d.parcial ? ' (em aberto)' : ''}`).join(' + ')}</span>`;
  } else if (c.tipo === 'FOLHA') {
    como = `${nf(p.n)} colaborador(es)${c.empresa ? ' da ' + esc(c.empresa) : ''}<br><span class="nota">${c.base_folha === 'caixa' ? 'só o que sai do caixa (sem provisões)' : 'custo total: salário + encargos + provisões + benefícios'}</span>`;
  } else {
    como = `${c.recorrencia === 'UNICA' ? 'valor único' : 'valor fixo mensal'}${c.categoria ? ' · ' + esc(c.categoria) : ''}`;
  }
  const botoes = [];
  if (c.tipo === 'FOLHA') botoes.push(`<button class="btn" data-cp-folha="${c.id}">Colaboradores</button>`);
  if (editar) {
    botoes.push(l.baixa ? `<button class="btn" data-cp-desfazer="${c.id}">Desfazer</button>` : `<button class="btn primario" data-cp-pagar="${c.id}">Pagar</button>`);
    botoes.push(`<button class="btn" data-cp-editar="${c.id}">Editar</button>`);
  }
  return `<tr class="cp-linha cp-${l.situ.toLowerCase()}"><td>${fdA(l.venc)}</td><td><b>${esc(c.descricao)}</b>${c.empresa ? `<br><span class="nota">${esc(c.empresa)}</span>` : ''}${c.obs ? `<br><span class="nota">${esc(c.obs)}</span>` : ''}</td>
    <td><span class="cp-tipo cp-t-${c.tipo.toLowerCase()}">${esc(CP_TIPOS[c.tipo])}</span></td><td>${como}</td><td class="n"><b>${rs2(p.valor)}</b></td>
    <td>${cpFarol(l.situ)}${l.baixa ? `<br><span class="nota">${fdA(l.baixa.data_pagamento)}</span>` : ''}</td><td class="n">${l.baixa ? rs2(l.baixa.valor_pago) : '—'}</td><td class="cp-acoes">${botoes.join(' ')}</td></tr>`;
}

// ----- janelas
function cpDlg() {
  let d = document.getElementById('dlgCp');
  if (!d) { d = document.createElement('dialog'); d.id = 'dlgCp'; d.className = 'cp-dialog'; document.body.appendChild(d); }
  return d;
}

function cpEmpresasOpcoes(atual, rotuloTodas) {
  const nomes = new Set([...bmEmpresas(), ...((M.empresas || []).map(e => e.nome)), ...(CP.dados.empresas_folha || [])]);
  return `<option value="">${esc(rotuloTodas)}</option>` + [...nomes].filter(Boolean).sort().map(n => `<option value="${esc(n)}" ${ganNorm(n) === ganNorm(atual || '') ? 'selected' : ''}>${esc(n)}</option>`).join('');
}

function cpAbrirConta(id) {
  const c = id ? CP.dados.contas.find(x => x.id === id) : null;
  const d = cpDlg(), v = c || { tipo: 'IMPOSTO', descricao: '', categoria: '', empresa: '', percentual: '', valor: '', base_folha: 'total', recorrencia: 'MENSAL', comp_inicio: CP.mes, comp_fim: '', dia_venc: 10, venc_mes_seguinte: 1, obs: '', ativo: 1 };
  d.innerHTML = `<form method="dialog" id="cpForm" class="cp-form">
    <div class="bloco-cab"><h2>${c ? 'Editar conta a pagar' : 'Nova conta a pagar'}</h2><button type="button" class="btn-icone" data-cp-fechar aria-label="Fechar">×</button></div>
    <div class="campos">
      <label><span class="obrig">Tipo de conta</span><select name="tipo">${Object.entries(CP_TIPOS).map(([k, r]) => `<option value="${k}" ${v.tipo === k ? 'selected' : ''}>${r}</option>`).join('')}</select></label>
      <label data-cp-so="IMPOSTO"><span>Modelo rápido (opcional)</span><select name="modelo"><option value="">Escolha um imposto…</option>${CP_IMPOSTOS.map((m, i) => `<option value="${i}">${esc(m[0])}${m[2] ? ' — ' + cpPerc(m[2]) : ''}</option>`).join('')}</select></label>
      <label data-cp-so="OUTROS"><span>Modelo rápido (opcional)</span><select name="modelo_out"><option value="">Escolha…</option>${CP_OUTROS.map((m, i) => `<option value="${i}">${esc(m)}</option>`).join('')}</select></label>
      <label class="largo"><span class="obrig">Descrição</span><input name="descricao" type="text" maxlength="160" value="${esc(v.descricao)}" placeholder="Ex.: ISS, Folha salarial, Aluguel do canteiro"></label>
      <label data-cp-so="IMPOSTO"><span class="obrig">Percentual sobre o valor a faturar (%)</span><input name="percentual" type="text" inputmode="decimal" value="${v.percentual === '' || v.percentual == null ? '' : esc(String(v.percentual).replace('.', ','))}" placeholder="Ex.: 3,00"></label>
      <label data-cp-so="IMPOSTO"><span>Empresa da medição</span><select name="empresa_imp">${cpEmpresasOpcoes(v.tipo === 'IMPOSTO' ? v.empresa : '', 'Todas as empresas (soma dos BMs)')}</select></label>
      <label data-cp-so="FOLHA"><span>Colaboradores de</span><select name="empresa_fol">${cpEmpresasOpcoes(v.tipo === 'FOLHA' ? v.empresa : '', 'Todas as empresas')}</select></label>
      <label data-cp-so="FOLHA"><span>O que entra na folha</span><select name="base_folha"><option value="total" ${v.base_folha !== 'caixa' ? 'selected' : ''}>Custo total (com provisões de 13º, férias e rescisão)</option><option value="caixa" ${v.base_folha === 'caixa' ? 'selected' : ''}>Só o que sai do caixa no mês (sem provisões)</option></select></label>
      <label data-cp-so="OUTROS"><span class="obrig">Valor (R$)</span><input name="valor" type="text" inputmode="decimal" value="${v.valor == null || v.valor === '' ? '' : esc(Number(v.valor).toFixed(2).replace('.', ','))}" placeholder="0,00"></label>
      <label data-cp-so="OUTROS"><span>Categoria</span><input name="categoria" type="text" maxlength="60" value="${esc(v.categoria || '')}"></label>
      <label data-cp-so="OUTROS"><span>Recorrência</span><select name="recorrencia"><option value="MENSAL" ${v.recorrencia === 'MENSAL' ? 'selected' : ''}>Todo mês</option><option value="UNICA" ${v.recorrencia === 'UNICA' ? 'selected' : ''}>Uma vez só</option></select></label>
      <label><span class="obrig">Mês de início (competência)</span><input name="comp_inicio" type="month" value="${esc(v.comp_inicio)}"></label>
      <label data-cp-so="IMPOSTO FOLHA OUTROS" data-cp-mensal><span>Mês final (opcional)</span><input name="comp_fim" type="month" value="${esc(v.comp_fim || '')}"></label>
      <label><span class="obrig">Dia do vencimento</span><input name="dia_venc" type="number" min="1" max="31" value="${esc(v.dia_venc)}"></label>
      <label class="cp-check"><input name="venc_mes_seguinte" type="checkbox" ${v.venc_mes_seguinte ? 'checked' : ''}> <span>Vence no mês seguinte à competência (imposto e folha costumam vencer no mês seguinte)</span></label>
      <label class="largo"><span>Observações</span><textarea name="obs" rows="2">${esc(v.obs || '')}</textarea></label>
      <p class="nota largo" data-cp-so="IMPOSTO" id="cpNotaImp"></p>
      <p class="nota largo" data-cp-so="FOLHA">A folha é <b>automática</b>: soma o custo mensal de todos os colaboradores cadastrados (salário, encargos, provisões e benefícios). Cadastre o salário de cada um em Gestão › Pessoal › Colaboradores.</p>
    </div>
    <div class="acoes">
      ${c ? '<button type="button" class="btn perigo" data-cp-excluir>Excluir conta</button>' : ''}<span class="espaco"></span>
      <button type="button" class="btn" data-cp-fechar>Cancelar</button><button type="submit" class="btn primario">Salvar</button>
    </div></form>`;
  const f = d.querySelector('form'), por = () => f.tipo.value;
  const ajustar = () => {
    f.querySelectorAll('[data-cp-so]').forEach(el => { el.hidden = !el.dataset.cpSo.split(' ').includes(por()); });
    const unica = por() === 'OUTROS' && f.recorrencia.value === 'UNICA';
    f.querySelector('[data-cp-mensal]').hidden = unica;
    const n = f.querySelector('#cpNotaImp');
    if (n) n.textContent = 'O imposto é mensal e incide sobre o valor a faturar da Medição (medição − descontos) dos BMs com corte no mês. Os percentuais dos modelos são de referência: confirme com o seu contador.';
  };
  f.tipo.addEventListener('change', ajustar); f.recorrencia.addEventListener('change', ajustar);
  f.modelo.addEventListener('change', () => { const m = CP_IMPOSTOS[f.modelo.value]; if (!m) return; f.descricao.value = m[0].split(' — ')[0]; if (m[2]) f.percentual.value = String(m[2]).replace('.', ','); f.querySelector('#cpNotaImp').textContent = m[3] + ' Confirme com o seu contador.'; });
  f.modelo_out.addEventListener('change', () => { const m = CP_OUTROS[f.modelo_out.value]; if (m) { f.descricao.value = m; f.categoria.value = m; } });
  d.querySelectorAll('[data-cp-fechar]').forEach(b => b.addEventListener('click', () => d.close()));
  const ex = d.querySelector('[data-cp-excluir]');
  if (ex) { let pronto = false; ex.addEventListener('click', async () => { if (!pronto) { pronto = true; ex.textContent = 'Confirmar: excluir e apagar os pagamentos'; return; } try { await cpAcao({ acao: 'excluir', id }); d.close(); cpDesenhar(); toast('Conta excluída.'); } catch (e) { toast(e.message, true); } }); }
  f.addEventListener('submit', async ev => {
    ev.preventDefault();
    const tipo = por();
    const corpo = { acao: 'salvar', id: id || 0, tipo, descricao: f.descricao.value, categoria: f.categoria.value, empresa: tipo === 'IMPOSTO' ? f.empresa_imp.value : tipo === 'FOLHA' ? f.empresa_fol.value : '',
      percentual: f.percentual.value, valor: f.valor.value, base_folha: f.base_folha.value, recorrencia: f.recorrencia.value, comp_inicio: f.comp_inicio.value, comp_fim: f.comp_fim.value,
      dia_venc: f.dia_venc.value, venc_mes_seguinte: f.venc_mes_seguinte.checked ? 1 : 0, obs: f.obs.value, ativo: 1 };
    try { await cpAcao(corpo); d.close(); cpDesenhar(); toast(id ? 'Conta atualizada.' : 'Conta cadastrada.'); } catch (e) { toast(e.message, true); }
  });
  ajustar();
  d.showModal();
}

function cpAbrirPagar(id) {
  const c = CP.dados.contas.find(x => x.id === id), p = cpPrevisto(c, CP.mes), d = cpDlg();
  d.innerHTML = `<form method="dialog" class="cp-form"><div class="bloco-cab"><h2>Registrar pagamento</h2><button type="button" class="btn-icone" data-cp-fechar aria-label="Fechar">×</button></div>
    <p><b>${esc(c.descricao)}</b> · competência ${esc(cpMesRot(CP.mes))} · previsto ${rs2(p.valor)}</p>
    <div class="campos"><label><span class="obrig">Data do pagamento</span><input name="data" type="date" value="${esc(CP.dados.hoje)}" max="${esc(CP.dados.hoje)}"></label>
      <label><span class="obrig">Valor pago (R$)</span><input name="valor" type="text" inputmode="decimal" value="${esc(p.valor.toFixed(2).replace('.', ','))}"></label>
      <label class="largo"><span>Observação</span><input name="obs" type="text" maxlength="255" placeholder="Ex.: guia DARF, comprovante nº…"></label></div>
    <div class="acoes"><span class="espaco"></span><button type="button" class="btn" data-cp-fechar>Cancelar</button><button type="submit" class="btn primario">Confirmar pagamento</button></div></form>`;
  d.querySelectorAll('[data-cp-fechar]').forEach(b => b.addEventListener('click', () => d.close()));
  d.querySelector('form').addEventListener('submit', async ev => {
    ev.preventDefault();
    const f = ev.target;
    try { await cpAcao({ acao: 'baixar', conta_id: id, competencia: CP.mes, data_pagamento: f.data.value, valor_pago: f.valor.value, obs: f.obs.value }); d.close(); cpDesenhar(); toast('Pagamento registrado.'); } catch (e) { toast(e.message, true); }
  });
  d.showModal();
}

function cpAbrirFolha(id) {
  const c = CP.dados.contas.find(x => x.id === id), f = (CP.dados.folha || {})[CP.mes] || {}, d = cpDlg();
  const alvo = c.empresa ? String(c.empresa).trim().toUpperCase() : '';
  const lista = (f.colaboradores || []).filter(x => !alvo || String(x.empresa || '').trim().toUpperCase() === alvo);
  const soma = k => lista.reduce((s, x) => s + (x[k] || 0), 0);
  d.innerHTML = `<form method="dialog" class="cp-form cp-largo"><div class="bloco-cab"><h2>Folha de ${esc(cpMesRot(CP.mes))} — colaboradores</h2><button type="button" class="btn-icone" data-cp-fechar aria-label="Fechar">×</button></div>
    <p class="nota">Custo mensal estimado de cada colaborador ativo no mês (regime de competência). Vale o que está em Gestão › Pessoal › Colaboradores e os <b>Parâmetros da folha</b>. Quem entrou ou saiu no meio do mês conta só os dias trabalhados.</p>
    ${lista.length ? `<div class="tabela-rolagem"><table class="cp-tab" data-sem-ferramentas data-sem-limite><thead><tr><th>Colaborador</th><th>Empresa</th><th>Função</th><th>Vínculo</th><th class="n">Remuneração bruta</th><th class="n">Encargos</th><th class="n">Provisões</th><th class="n">Benefícios</th><th class="n">Custo total</th></tr></thead><tbody>
      ${lista.map(x => `<tr class="${x.sem_salario ? 'cp-vencida' : ''}"><td><b>${esc(x.nome)}</b>${x.fracao < 1 ? ` <span class="nota">(${nf(x.fracao * 100, 0)}% do mês)</span>` : ''}</td><td>${esc(x.empresa || '—')}</td><td>${esc(x.funcao || '—')}</td><td>${esc(x.vinculo)}</td>
        ${x.sem_salario ? '<td class="n" colspan="5"><span class="farol f-vermelho">SEM SALÁRIO INFORMADO</span></td>' : `<td class="n">${rs2(x.bruto)}</td><td class="n">${rs2(x.encargos)}</td><td class="n">${rs2(x.provisoes)}</td><td class="n">${rs2(x.beneficios)}</td><td class="n"><b>${rs2(x.total)}</b></td>`}</tr>`).join('')}
      </tbody><tfoot><tr><td colspan="4"><b>Total (${lista.length} colaborador(es))</b></td><td class="n">${rs2(soma('bruto'))}</td><td class="n">${rs2(soma('encargos'))}</td><td class="n">${rs2(soma('provisoes'))}</td><td class="n">${rs2(soma('beneficios'))}</td><td class="n"><b>${rs2(soma('total'))}</b></td></tr></tfoot></table></div>`
      : '<p class="vazio">Nenhum colaborador ativo neste mês.</p>'}
    <div class="acoes"><span class="espaco"></span><button type="button" class="btn" data-cp-fechar>Fechar</button></div></form>`;
  d.querySelectorAll('[data-cp-fechar]').forEach(b => b.addEventListener('click', () => d.close()));
  d.showModal();
}

function cpAbrirParametros() {
  const P = CP.dados.parametros, PAD = CP.dados.parametros_padrao, ROT = CP.dados.parametros_rotulos, d = cpDlg(), editar = cpPodeEditar();
  const campo = k => {
    const [rot, tipo] = ROT[k];
    let ctrl;
    if (tipo.startsWith('sel:')) ctrl = `<select name="${k}" ${editar ? '' : 'disabled'}>${tipo.slice(4).split('|').map(o => { const [v, r] = o.includes('=') ? o.split('=') : [o, o]; return `<option value="${esc(v)}" ${String(P[k]) === v || (k === 'aviso_previo' && String(P[k] ? 1 : 0) === v) ? 'selected' : ''}>${esc(r)}</option>`; }).join('')}</select>`;
    else ctrl = `<input name="${k}" type="text" inputmode="decimal" value="${esc(String(P[k]).replace('.', ','))}" ${editar ? '' : 'disabled'}>`;
    return `<label><span>${esc(rot)}</span>${ctrl}<small class="nota">padrão: ${esc(String(PAD[k]).replace('.', ','))}</small></label>`;
  };
  d.innerHTML = `<form method="dialog" class="cp-form cp-largo"><div class="bloco-cab"><h2>Parâmetros da folha (encargos)</h2><button type="button" class="btn-icone" data-cp-fechar aria-label="Fechar">×</button></div>
    <details class="cp-premissas" open><summary>Como o custo do colaborador é calculado</summary><ul>
      <li><b>Remuneração bruta</b> = salário (mensal, ou valor da hora × horas do mês) + adicional de insalubridade (sobre o salário mínimo) ou periculosidade (30% do salário).</li>
      <li><b>Encargos do empregador</b> sobre a bruta: INSS patronal 20% + RAT × FAP + terceiros (Sistema S) 5,8% + FGTS 8%. Construção civil costuma ter RAT de 3% (risco 3) — o FAP da empresa ajusta.</li>
      <li><b>Provisões</b> (regime de competência — não saem do caixa todo mês): 13º (1/12), férias + 1/3, encargos sobre os dois, multa de 40% do FGTS e aviso prévio × a rotatividade. Em obra, os contratos terminam quando a obra acaba: 100% é o cenário prudente.</li>
      <li><b>Benefícios</b>: vale-transporte (a empresa paga o que passar de 6% do salário), alimentação, outros, seguro de vida e EPI/uniforme informados aqui.</li>
      <li><b>Autônomo, PJ e estagiário</b>: sem encargos. <b>Jovem aprendiz</b>: FGTS de 2%. Pelo cadastro do colaborador (campo Status).</li>
      <li>Referência de mercado: o encargo total de mensalistas da construção civil (SINAPI) fica em torno de 70% do salário.</li>
      <li>É uma <b>estimativa gerencial</b>: a folha oficial é do contador/DP — confirme com ele os percentuais, o regime (normal ou CPRB) e a convenção coletiva.</li></ul></details>
    <div class="campos">${Object.keys(ROT).map(campo).join('')}</div>
    <div class="acoes"><button type="button" class="btn" data-cp-padrao ${editar ? '' : 'hidden'}>Voltar aos padrões</button><span class="espaco"></span><button type="button" class="btn" data-cp-fechar>Fechar</button>${editar ? '<button type="submit" class="btn primario">Salvar parâmetros</button>' : ''}</div></form>`;
  d.querySelectorAll('[data-cp-fechar]').forEach(b => b.addEventListener('click', () => d.close()));
  const f = d.querySelector('form');
  const pad = d.querySelector('[data-cp-padrao]');
  if (pad) pad.addEventListener('click', () => Object.keys(ROT).forEach(k => { if (f.elements[k]) f.elements[k].value = String(PAD[k]).replace('.', ','); }));
  f.addEventListener('submit', async ev => {
    ev.preventDefault();
    const par = {}; Object.keys(ROT).forEach(k => { par[k] = f.elements[k].value; });
    try { await cpAcao({ acao: 'parametros', parametros: par }); d.close(); cpDesenhar(); toast('Parâmetros da folha salvos. Os custos foram recalculados.'); } catch (e) { toast(e.message, true); }
  });
  d.showModal();
}

document.addEventListener('click', async ev => {
  const alvo = ev.target.closest('[data-cp-mes],[data-cp-nova],[data-cp-params],[data-cp-editar],[data-cp-pagar],[data-cp-desfazer],[data-cp-folha],[data-cp-ir]');
  if (!alvo || !document.getElementById('cpCorpo') || !document.getElementById('cpCorpo').contains(alvo)) return;
  ev.preventDefault();
  const num = a => Number(alvo.dataset[a]);
  try {
    if (alvo.dataset.cpMes) { CP.mes = cpMesSomar(CP.mes, num('cpMes')); await renderContasPagar(); }
    else if (alvo.dataset.cpIr) { CP.mes = alvo.dataset.cpIr; await renderContasPagar(); }
    else if (alvo.hasAttribute('data-cp-nova')) cpAbrirConta(0);
    else if (alvo.hasAttribute('data-cp-params')) cpAbrirParametros();
    else if (alvo.dataset.cpEditar) cpAbrirConta(num('cpEditar'));
    else if (alvo.dataset.cpPagar) cpAbrirPagar(num('cpPagar'));
    else if (alvo.dataset.cpFolha) cpAbrirFolha(num('cpFolha'));
    else if (alvo.dataset.cpDesfazer) { await cpAcao({ acao: 'desfazer', conta_id: num('cpDesfazer'), competencia: CP.mes }); cpDesenhar(); toast('Pagamento desfeito.'); }
  } catch (e) { toast(e.message, true); }
});
document.addEventListener('change', async ev => {
  if (ev.target.id !== 'cpMesSel') return;
  if (/^\d{4}-\d{2}$/.test(ev.target.value)) { CP.mes = ev.target.value; await renderContasPagar(); }
});
