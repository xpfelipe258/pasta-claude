'use strict';
// ------------------------------------------------------------------------------------------------
// MATERIAL POR ATIVIDADE (menu Suprimentos › Vínculos e Pronto para iniciar)
// Liga cada item do cadastro de Materiais (peças e fixadores) a uma atividade do catálogo do BM, usando o IFC como referência:
//   peça do IFC  → família (o nome do produto é o da família do IFC)  → frente de serviço (o local do material)  → atividade do catálogo
//   peça         → kit de fixadores por peça (regras_baixa.json: por_peca do fechamento, por_etapa da marquise)  → TAG do fixador
//   serviços com regra por unidade (pré-montagem, içamento de joist, vigas de apoio e intermediárias) já têm a lista pronta nas regras.
// A necessidade vem do IFC (peças do galpão) e, onde o IFC ainda não foi lido (anexos), do planejado do cadastro. Quando IFC e cadastro divergem,
// vale o IFC e o desencontro vira alerta. O vínculo de cada grupo (produto + local) é CONFIRMADO por uma pessoa (usuário ou planejamento);
// quem confirmou e quando ficam gravados em sistema.vinculos_material (rota `vinculos`). Sem confirmação, só há sugestão.
// Depende de app.js e projecao.js: M, T, ref, API, bmTab, estMateriaisComCadastros, ehFixador, ganItensCliente, pjAtividadesBm, faseFiltro,
// postar, carregar, toast, mudarAba, esc, cap, nf, fd, fdA, soma0, $.
// ------------------------------------------------------------------------------------------------
const VC = { filtro: 'sugeridas', sel: '', ativSel: '', _cron: null, _cronM: null };

// Sugestão por família no galpão: [atividade (sem o prefixo da empresa), confiança, por quê]
const VC_GALPAO = {
  'TERÇA FECHAMENTO': ['3.1.2-03', 'alta', 'terças do fechamento lateral'],
  'ESPAÇADOR FECHAMENTO': ['3.1.2-04', 'alta', 'decidido: espaçador entra em alinhamento das terças'],
  'SUPORTE DE TERÇA': ['3.1.2-02', 'alta', 'decidido: suporte de terça entra em instalação de suportes'],
  'PILARETE': ['3.1.2-01', 'média', 'pré-montagem da estrutura do fechamento'],
  'TERÇA MARQUISE': ['3.1.3-02', 'média', 'terçamento da marquise'],
  'MÃO FRANCESA': ['3.1.3-05', 'alta', 'mão francesa da marquise'],
  'VIGA MARQUISE': ['3.1.3-01', 'média', 'vigas principais da marquise'],
  'VIGA COBERTURA': ['3.1.1-01', 'média', 'ligação das vigas da cobertura'],
  'APOIO PRINCIPAL': ['3.1.1-01', 'média', 'apoio das vigas da cobertura'],
  'APOIO INTERMEDIÁRIO': ['3.1.1-01', 'média', 'apoio das vigas da cobertura'],
  'TRAVAMENTO VIGA': ['3.1.1-01', 'média', 'travamento das vigas'],
  'CONTRAVENTAMENTO': ['3.1.1-04', 'média', 'contraventamento da cobertura'],
  'SUPORTE CONT.': ['3.1.1-04', 'média', 'suportes do contraventamento'],
  'TRAVAMENTO PILAR': ['3.1.1-04', 'média', 'travamento de pilares'],
};
// Anexos: item do catálogo de cada prédio e, por família, o final do código da atividade (vigas, terças, contraventamento e mão francesa)
const VC_ANEXO_ITEM = { 'PORTARIA': '3.3.3', 'REFEITÓRIO': '3.3.7', 'VESTIÁRIO': '3.3.8', 'ECLUSA': '3.3.1' };
const VC_ANEXO_FAM = { 'VIGA COBERTURA': '01', 'APOIO PRINCIPAL': '01', 'TRAVAMENTO VIGA': '01', 'TERÇA': '02', 'TERÇA COBERTURA': '02', 'SUPORTE DE TERÇA': '02', 'CONTRAVENTAMENTO': '03', 'SUPORTE CONT.': '03', 'MÃO FRANCESA': '03' };
const VC_ECLUSA_FAM = { 'VIGA COBERTURA': '01', 'TRAVAMENTO VIGA': '01', 'SUPORTE JOIST': '03', 'CONTRAVENTAMENTO': '04', 'SUPORTE CONT.': '04', 'MÃO FRANCESA': '04' };
const VC_ANEXO_TELHA = { 'PORTARIA': 'GLO-3.4.1-02', 'VESTIÁRIO': 'GLO-3.4.1-04', 'REFEITÓRIO': 'GLO-3.4.2-01', 'ECLUSA': 'GLO-3.4.1-01' };
// Serviços com regra por unidade (regras_baixa.json › consumo_por_servico) → atividade e total de unidades (limites_ifc)
const VC_REGRA_SERV = [
  { serv: 'PREMONTAGEM', ativ: '3.1.1-02', un: 'joist', tot: 'joists_no_galpao_maximo' },
  { serv: 'IÇAMENTO JOIST', ativ: '3.1.1-03', un: 'joist', tot: 'joists_no_galpao_maximo' },
  { serv: 'VIGAS APOIO', ativ: '3.1.1-01', un: 'viga de apoio', tot: 'vigas_apoio_no_galpao' },
  { serv: 'VIGAS INTERMEDIÁRIAS', ativ: '3.1.1-01', un: 'viga intermediária', tot: 'vigas_intermediarias_no_galpao' },
];

const vcUp = s => String(s || '').toUpperCase().replace(/\s+/g, ' ').trim();
const vcChaveAtiv = cod => String(cod || '').replace(/^(EJ|CMM)-/, '');
const vcDias = (a, b) => Math.round((Date.parse(b + 'T12:00:00') - Date.parse(a + 'T12:00:00')) / 864e5);
const vcPerm = () => !document.body.classList.contains('somente-leitura');

// catálogo do BM: uma entrada por atividade (EJ e CMM juntas)
function vcCatalogo() {
  const mapa = new Map();
  bmTab('bm_atividades').filter(a => a.codigo).forEach(a => {
    const k = vcChaveAtiv(a.codigo);
    if (!mapa.has(k)) mapa.set(k, { key: k, nome: a.atividade, item: a.item, itemDesc: a.item_desc, empresas: [], codigos: [] });
    const e = mapa.get(k); e.empresas.push(a.empresa); e.codigos.push(a.codigo);
  });
  return mapa;
}
const vcRotuloAtiv = (cat, k) => { const e = cat.get(k); return e ? `${k} ${e.nome}` : k; };

// TAGs que as regras de baixa já ligam a um serviço (premontagem, içamento, vigas, oitão…)
function vcTagsRegra() {
  const r = M?.estoque_ifc?.regras;
  const tags = new Set();
  const anda = o => {
    if (Array.isArray(o)) o.forEach(anda);
    else if (o && typeof o === 'object') Object.entries(o).forEach(([k, v]) => { if ((k === 'codigo' || k === 'tag' || k === 'parafuso') && typeof v === 'string' && /^[A-Z]{2,3}\d{2,3}$/.test(v)) tags.add(v); anda(v); });
  };
  if (r) { anda(r.consumo_por_servico); anda(r.eventos); anda(r.criterio_por_letra); anda(r.vigas_oitao); }
  return tags;
}

// kit de fixadores por peça de uma família do IFC no galpão
function vcKit(fam) {
  const cs = M?.estoque_ifc?.regras?.consumo_por_servico || {};
  const out = new Map();
  const soma = it => { if (!it || !it.codigo) return; const o = out.get(it.codigo) || { codigo: it.codigo, descricao: it.descricao || it.codigo, qtd: 0 }; o.qtd += Number(it.quantidade) || 0; out.set(it.codigo, o); };
  const f = cs['FECH. LATERAL – ESTRUTURA'];
  if (f && f.por_peca && f.por_peca[fam]) f.por_peca[fam].forEach(soma);
  const m = cs['MARQUISE'];
  if (m && m.por_etapa) Object.values(m.por_etapa).forEach(et => (et[fam] || []).forEach(soma));
  return [...out.values()];
}

// sugestão para um grupo (produto + local)
function vcSugerir(prodUp, local, cat) {
  const L = vcUp(local);
  const existe = k => cat.has(k);
  if (L === 'GALPÃO') {
    const s = VC_GALPAO[prodUp];
    return s && existe(s[0]) ? { key: s[0], conf: s[1], motivo: s[2] } : null;
  }
  if (prodUp === 'TELHA COBERTURA' || prodUp === 'TELHA_COB') {
    const k = VC_ANEXO_TELHA[L];
    return k && existe(k) ? { key: k, conf: 'baixa', motivo: 'telhas do anexo: o catálogo da Globo mede em m², falta o fator peça → m²' } : null;
  }
  const item = VC_ANEXO_ITEM[L];
  if (!item) return null;
  const fim = (L === 'ECLUSA' ? VC_ECLUSA_FAM : VC_ANEXO_FAM)[prodUp];
  const k = fim ? `${item}-${fim}` : '';
  return k && existe(k) ? { key: k, conf: 'média', motivo: `frente ${cap(local)} (item ${item})` } : null;
}

// grupos de material (produto + local), com a sugestão e a decisão gravada
function vcGrupos(cat) {
  const dec = M?.vinculos_material || {};
  const fams = M?.estoque_ifc?.inventario?.totais?.familias || {};
  const regra = vcTagsRegra();
  const mapa = new Map();
  estMateriaisComCadastros().forEach(m => {
    if (!m.tag || regra.has(m.tag) || ehFixador(m)) return;
    const prodUp = vcUp(m.produto), local = m.local || '—', chave = `${prodUp}|${local}`;
    if (!mapa.has(chave)) mapa.set(chave, { chave, produto: prodUp, local, tags: [], planejado: 0, chegou: 0 });
    const g = mapa.get(chave);
    g.tags.push(m.tag); g.planejado += Number(m.planejado) || 0; g.chegou += Number(m.chegou) || 0;
  });
  return [...mapa.values()].map(g => {
    const fam = fams[g.produto] != null ? g.produto : (g.produto === 'TELHA_COB' ? 'TELHA COBERTURA' : null);
    const noGalpao = vcUp(g.local) === 'GALPÃO' && fam && fams[fam] != null;
    g.fam = fam;
    g.ifc = noGalpao ? Number(fams[fam]) : null;
    g.dif = g.ifc != null ? g.planejado - g.ifc : 0;
    g.diverge = g.ifc != null && Math.round(g.dif) !== 0;
    g.nec = g.ifc != null ? g.ifc : g.planejado;
    g.kit = noGalpao ? vcKit(fam) : [];
    g.sug = vcSugerir(g.produto, g.local, cat);
    g.dec = dec[g.chave] || null;
    g.estado = g.dec ? g.dec.estado : (g.sug ? 'sugerida' : 'sem par');
    g.ativ = g.dec && g.dec.estado === 'confirmado' ? g.dec.atividade : '';
    return g;
  }).sort((a, b) => a.produto.localeCompare(b.produto, 'pt') || a.local.localeCompare(b.local, 'pt'));
}

// lista de materiais de cada atividade: peças + fixadores (kit por peça e regras por unidade)
function vcBom(grupos, cat) {
  const regras = M?.estoque_ifc?.regras;
  const chegouTag = new Map();
  estMateriaisComCadastros().forEach(m => { if (m.tag) chegouTag.set(m.tag, (chegouTag.get(m.tag) || 0) + (Number(m.chegou) || 0)); });
  const info = new Map();
  estMateriaisComCadastros().forEach(m => { if (m.tag && !info.has(m.tag)) info.set(m.tag, m); });
  const ativs = new Map();
  const get = k => { if (!ativs.has(k)) ativs.set(k, { key: k, linhas: [] }); return ativs.get(k); };
  const uso = new Map();   // tag → [{key, nec}]
  const marca = (tag, key, nec) => { if (!uso.has(tag)) uso.set(tag, []); uso.get(tag).push({ key, nec }); };

  VC_REGRA_SERV.forEach(s => {
    const sv = regras?.consumo_por_servico?.[s.serv], total = regras?.limites_ifc?.[s.tot];
    if (!sv || !Array.isArray(sv.itens) || !total || !cat.has(s.ativ)) return;
    sv.itens.forEach(it => {
      const nec = (Number(it.por_unidade) || 0) * total, mi = info.get(it.codigo);
      get(s.ativ).linhas.push({ tipo: /^F[GJ]/.test(it.codigo) ? 'fixador' : 'componente', tag: it.codigo, rotulo: it.descricao || (mi && mi.produto) || it.codigo,
        nec, chegou: chegouTag.get(it.codigo) || 0, origem: `regra: ${nf(it.por_unidade, 2)} por ${s.un}${it.estimado ? ' (divisão estimada)' : ''}`, regra: true });
      marca(it.codigo, s.ativ, nec);
    });
  });
  grupos.filter(g => g.ativ && cat.has(g.ativ)).forEach(g => {
    get(g.ativ).linhas.push({ tipo: 'peça', tag: g.tags.length > 3 ? `${g.tags.length} TAGs` : g.tags.join(', '), rotulo: `${cap(g.produto.toLowerCase())} · ${g.local}`, nec: g.nec, chegou: g.chegou,
      origem: g.ifc != null ? `IFC: ${nf(g.ifc, 0)} peças${g.diverge ? ' (cadastro ' + nf(g.planejado, 0) + ')' : ''}` : 'planejado do cadastro (IFC do anexo ainda não importado)', grupo: g.chave, diverge: g.diverge });
    g.kit.forEach(k => {
      const nec = k.qtd * g.nec, mi = info.get(k.codigo);
      get(g.ativ).linhas.push({ tipo: 'fixador', tag: k.codigo, rotulo: k.descricao || (mi && mi.produto) || k.codigo, nec, chegou: chegouTag.get(k.codigo) || 0, origem: `kit: ${nf(k.qtd, 0)} por ${g.produto.toLowerCase()}`, grupo: g.chave });
      marca(k.codigo, g.ativ, nec);
    });
  });
  // quanto cada TAG compartilhada é pedida no total (todas as atividades)
  const totalTag = new Map();
  uso.forEach((l, tag) => totalTag.set(tag, soma0(l, x => x.nec)));
  ativs.forEach(a => a.linhas.forEach(l => {
    if (l.tipo === 'peça') return;
    const u = uso.get(l.tag) || [];
    l.usos = u.length; l.totalTag = totalTag.get(l.tag) || l.nec; l.outras = u.filter(x => x.key !== a.key).map(x => x.key);
  }));
  return { ativs, uso };
}

// datas do cronograma do cliente por atividade do catálogo
function vcCronograma() {
  if (VC._cron && VC._cronM === M) return VC._cron;
  const mapa = new Map();
  const fa = faseFiltro;
  faseFiltro = '';
  try {
    ganItensCliente().filter(it => it.inicio_plan && it.prazo).forEach(it => {
      (pjAtividadesBm(it) || []).forEach(a => {
        const k = vcChaveAtiv(a.codigo);
        const e = mapa.get(k) || { ini: it.inicio_plan, fim: it.prazo, linhas: [] };
        if (it.inicio_plan < e.ini) e.ini = it.inicio_plan;
        if (it.prazo > e.fim) e.fim = it.prazo;
        const nm = it.servico + (it.frente ? ' (' + it.frente + ')' : '');
        if (!e.linhas.includes(nm)) e.linhas.push(nm);
        mapa.set(k, e);
      });
    });
  } catch (e) { console.error(e); } finally { faseFiltro = fa; }
  VC._cron = mapa; VC._cronM = M;
  return mapa;
}

// situação de uma atividade: % de cada linha (chegou ÷ necessário), média e limitante
function vcSituacao(a) {
  const ls = a.linhas.filter(l => l.nec > 0);
  ls.forEach(l => { l.pct = Math.min(1, l.chegou / l.nec); });
  const media = ls.length ? soma0(ls, l => l.pct) / ls.length : 0;
  const lim = ls.length ? ls.reduce((m, l) => (l.pct < m.pct ? l : m), ls[0]) : null;
  const nivel = !lim ? 'pendente' : lim.pct >= 1 ? 'verde' : lim.pct >= 0.5 ? 'amarelo' : 'vermelho';
  return { media, lim, nivel, completas: ls.filter(l => l.pct >= 1).length, total: ls.length };
}

const vcBarra = p => { const c = p >= 1 ? 'verde' : p >= 0.5 ? 'amarelo' : 'vermelho'; return `<div class="vc-prog"><span class="vc-t"><i class="vc-${c}" style="width:${Math.max(p * 100, 0.5).toFixed(0)}%"></i></span><b>${nf(p * 100, 0)}%</b></div>`; };

function vcOpcoes(cat, sel) {
  const porItem = new Map();
  [...cat.values()].forEach(e => { const k = e.item + ' ' + cap(e.itemDesc || ''); if (!porItem.has(k)) porItem.set(k, []); porItem.get(k).push(e); });
  return '<option value="">Escolher atividade…</option>' + [...porItem.entries()].map(([k, l]) =>
    `<optgroup label="${esc(k.length > 70 ? k.slice(0, 68) + '…' : k)}">${l.map(e => `<option value="${esc(e.key)}" ${e.key === sel ? 'selected' : ''}>${esc(e.key + ' · ' + e.nome)}</option>`).join('')}</optgroup>`).join('');
}

// ---------------------------------------------------------------- Vínculos
function renderVinculos() {
  const box = document.getElementById('vcCorpo');
  if (!box) return;
  if (!M || !M.estoque_ifc || !estMateriaisComCadastros().length) { box.innerHTML = '<div class="bloco"><p class="vazio">Aguardando os dados de Suprimentos…</p></div>'; return; }
  let h = '';
  try {
    const cat = vcCatalogo(), grupos = vcGrupos(cat), podeEditar = vcPerm();
    const regra = vcTagsRegra();
    const nTags = new Set(estMateriaisComCadastros().map(m => m.tag).filter(Boolean)).size;
    const conf = grupos.filter(g => g.estado === 'confirmado'), sug = grupos.filter(g => g.estado === 'sugerida'), sem = grupos.filter(g => g.estado === 'sem par'),
      ign = grupos.filter(g => g.estado === 'ignorado'), div = grupos.filter(g => g.diverge);
    const nT = l => soma0(l, g => g.tags.length);
    const tile = (r, v, s, c) => `<div class="tile" style="--c:${c}"><div class="rot"><span>${r}</span></div><div class="val">${v}</div><div class="sub">${s}</div></div>`;
    h += `<div class="tiles">${tile('TAGs do cadastro', nTags, `${regra.size} ligadas por regra (joist, vigas, fixadores)`, 'var(--fg)')}${tile('Confirmadas', nT(conf), `${conf.length} grupos · confirmados por você ou pelo planejamento`, 'var(--verde)')}${tile('Sugeridas', nT(sug), `${sug.length} grupos aguardando confirmação`, 'var(--acento)')}${tile('Sem par', nT(sem), `${sem.length} grupos: escolha a atividade à mão`, 'var(--vermelho)')}${tile('Divergências IFC × cadastro', div.length, 'o IFC vale; corrija o cadastro', 'var(--amarelo)')}</div>`;
    const abas = [['sugeridas', `Sugeridas · ${sug.length}`], ['sem', `Sem par · ${sem.length}`], ['confirmadas', `Confirmadas · ${conf.length}`], ['divergencias', `Divergências · ${div.length}`], ['ignoradas', `Ignoradas · ${ign.length}`], ['regras', 'Regras e fixadores']];
    h += `<div class="barra-acoes"><div class="seg" id="vcSeg">${abas.map(([k, r]) => `<button data-vc-f="${k}" class="${VC.filtro === k ? 'ativa' : ''}">${r}</button>`).join('')}</div>
      ${VC.filtro === 'sugeridas' && podeEditar && sug.some(g => g.sug.conf === 'alta') ? `<button class="btn primario" data-vc-lote="alta">Confirmar todas de confiança alta (${sug.filter(g => g.sug.conf === 'alta').length})</button>` : ''}</div>`;
    if (VC.filtro === 'regras') h += vcRegrasHtml(cat, regra);
    else {
      const lista = { sugeridas: sug, sem, confirmadas: conf, divergencias: div, ignoradas: ign }[VC.filtro] || [];
      const sel = grupos.find(g => g.chave === VC.sel);
      if (sel) h += vcDetalheGrupo(sel, cat);
      h += `<div class="bloco"><div class="bloco-cab"><h2>${abas.find(a => a[0] === VC.filtro)[1].replace(/ · \d+$/, '')}</h2><span class="nota">Um vínculo vale para todas as TAGs do grupo (produto + local) e para os fixadores do kit da peça. Peças IFC = família no IFC do galpão; para os anexos o IFC ainda não foi importado e vale o planejado.</span></div>
        <div class="tabela-rolagem"><table id="tabVc" data-sem-ferramentas><thead><tr><th>Produto</th><th>Local</th><th class="n">TAGs</th><th class="n">Peças IFC × cadastro</th><th>Atividade do catálogo</th><th>Situação</th><th></th></tr></thead><tbody>` +
        (lista.length ? lista.map(g => vcLinhaGrupo(g, cat, podeEditar)).join('') : '<tr><td colspan="7" class="vazio">Nenhum grupo nesta lista.</td></tr>') + '</tbody></table></div></div>';
    }
  } catch (e) { console.error(e); h = `<div class="bloco"><p class="aviso">Não foi possível montar os vínculos: ${esc(e.message || e)}</p></div>`; }
  box.innerHTML = h;
  const det = box.querySelector('[data-vc-detalhe]');
  if (det && VC._rolar) det.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  VC._rolar = false;
}

function vcLinhaGrupo(g, cat, podeEditar) {
  const cmp = g.ifc == null ? '<span class="nota">IFC só do galpão</span>' : g.diverge ? `<span class="valor-neg">${nf(g.ifc, 0)} × ${nf(g.planejado, 0)} (${g.dif > 0 ? '+' : '−'}${nf(Math.abs(g.dif), 0)})</span>` : `<span style="color:var(--verde);font-weight:600">${nf(g.ifc, 0)} = ${nf(g.planejado, 0)}</span>`;
  const farol = { confirmado: '<span class="farol f-verde">CONFIRMADO</span>', sugerida: `<span class="farol f-${g.sug && g.sug.conf === 'alta' ? 'verde' : g.sug && g.sug.conf === 'média' ? 'amarelo' : 'vermelho'}">SUGERIDA · ${g.sug ? g.sug.conf.toUpperCase() : ''}</span>`, 'sem par': '<span class="farol f-vermelho">SEM PAR</span>', ignorado: '<span class="farol f-pendente">IGNORADO</span>' }[g.estado];
  let atv, acao = '';
  if (g.estado === 'confirmado') {
    atv = `<b>${esc(vcRotuloAtiv(cat, g.ativ))}</b><div class="nota">por ${esc(g.dec.por || '—')} em ${esc(String(g.dec.em || '').slice(0, 16))}</div>`;
    if (podeEditar) acao = `<button class="link" data-vc-desfazer="${esc(g.chave)}">Desfazer</button>`;
  } else if (g.estado === 'ignorado') {
    atv = `<span class="nota">ignorado por ${esc(g.dec.por || '—')} em ${esc(String(g.dec.em || '').slice(0, 16))}</span>`;
    if (podeEditar) acao = `<button class="link" data-vc-desfazer="${esc(g.chave)}">Desfazer</button>`;
  } else if (podeEditar) {
    atv = `<select data-vc-sel="${esc(g.chave)}" class="vc-sel">${vcOpcoes(cat, g.sug ? g.sug.key : '')}</select>${g.sug ? `<div class="nota">${esc(g.sug.motivo)}</div>` : ''}`;
    acao = `<button class="btn primario" data-vc-ok="${esc(g.chave)}">Confirmar</button> <button class="link" data-vc-ign="${esc(g.chave)}">Ignorar</button>`;
  } else atv = g.sug ? esc(vcRotuloAtiv(cat, g.sug.key)) : '—';
  return `<tr class="${VC.sel === g.chave ? 'vc-linha-sel' : ''}"><td><a href="#" class="link" data-vc-ver="${esc(g.chave)}"><b>${esc(cap(g.produto.toLowerCase()))}</b></a></td><td>${esc(g.local)}</td><td class="n">${g.tags.length}</td><td class="n">${cmp}</td><td>${atv}</td><td>${farol}</td><td class="acoes-linha">${acao}</td></tr>`;
}

function vcDetalheGrupo(g, cat) {
  const mats = estMateriaisComCadastros().filter(m => g.tags.includes(m.tag));
  const kit = g.kit.length ? g.kit.map(k => `<tr><td><b>${esc(k.codigo)}</b></td><td>${esc(k.descricao)}</td><td class="n">${nf(k.qtd, 0)} por peça</td><td class="n">${nf(k.qtd * g.nec, 0)}</td></tr>`).join('') : `<tr><td colspan="4" class="vazio">${vcUp(g.local) === 'GALPÃO' ? 'Esta família não tem fixadores no desenho do projeto.' : 'Sem lista de fixadores: o IFC e as regras de fixador deste anexo ainda não foram importados.'}</td></tr>`;
  return `<div class="bloco" data-vc-detalhe><div class="bloco-cab"><h2>${esc(cap(g.produto.toLowerCase()))} · ${esc(g.local)}</h2><button class="link" data-vc-fechar>Fechar</button></div>
    ${g.diverge ? `<p class="aviso">O IFC tem ${nf(g.ifc, 0)} peças e o cadastro ${nf(g.planejado, 0)} (${g.dif > 0 ? '+' : '−'}${nf(Math.abs(g.dif), 0)}). A necessidade usa o IFC. Corrija o planejado deste produto em Materiais.</p>` : ''}
    <div class="grade-2"><div><h3>TAGs do grupo</h3><div class="tabela-rolagem"><table data-sem-ferramentas><thead><tr><th>TAG</th><th>Nome</th><th class="n">Planejado</th><th class="n">Chegou</th></tr></thead><tbody>${mats.map(m => `<tr><td><b>${esc(m.tag)}</b></td><td>${esc(m.material || '')}</td><td class="n">${nf(m.planejado, 0)}</td><td class="n">${nf(m.chegou, 0)}</td></tr>`).join('')}</tbody></table></div></div>
    <div><h3>Fixadores por peça (kit do projeto)</h3><div class="tabela-rolagem"><table data-sem-ferramentas><thead><tr><th>TAG</th><th>Fixador</th><th class="n">Por peça</th><th class="n">Necessário</th></tr></thead><tbody>${kit}</tbody></table></div></div></div></div>`;
}

function vcRegrasHtml(cat, regra) {
  const fix = estMateriaisComCadastros().filter(m => ehFixador(m) && m.tag);
  const { uso } = vcBom(vcGrupos(cat), cat);
  const linhasFix = fix.map(m => {
    const u = uso.get(m.tag) || [], ks = [...new Set(u.map(x => x.key))];
    return `<tr><td><b>${esc(m.tag)}</b></td><td>${esc(m.produto || m.material || '')}</td><td class="n">${nf(m.planejado, 0)}</td><td class="n">${nf(m.chegou, 0)}</td><td>${ks.length ? ks.map(k => esc(vcRotuloAtiv(cat, k))).join('<br>') : '<span class="farol f-pendente">SEM USO NAS ATIVIDADES</span>'}</td></tr>`;
  }).join('');
  const sv = VC_REGRA_SERV.map(s => {
    const x = M?.estoque_ifc?.regras?.consumo_por_servico?.[s.serv];
    return `<tr><td><b>${esc(cap(s.serv.toLowerCase()))}</b></td><td>${esc(vcRotuloAtiv(cat, s.ativ))}</td><td class="n">${x && x.itens ? x.itens.length : 0}</td><td class="n">${nf(M?.estoque_ifc?.regras?.limites_ifc?.[s.tot] || 0, 0)} ${esc(s.un)}(s)</td></tr>`;
  }).join('');
  return `<div class="bloco"><div class="bloco-cab"><h2>Serviços com lista por regra</h2><span class="nota">Já definidos no projeto (regras_baixa.json). Entram nas atividades sem precisar de confirmação.</span></div>
    <div class="tabela-rolagem"><table data-sem-ferramentas><thead><tr><th>Serviço</th><th>Atividade do catálogo</th><th class="n">Materiais</th><th class="n">Unidades do galpão</th></tr></thead><tbody>${sv}</tbody></table></div></div>
    <div class="bloco"><div class="bloco-cab"><h2>Fixadores e onde são usados</h2><span class="nota">${fix.length} fixadores no cadastro. "Sem uso" quer dizer que nenhuma regra ou kit consome o fixador.</span></div>
    <div class="tabela-rolagem"><table data-sem-ferramentas><thead><tr><th>TAG</th><th>Fixador</th><th class="n">Planejado</th><th class="n">Chegou</th><th>Atividades que usam</th></tr></thead><tbody>${linhasFix}</tbody></table></div></div>`;
}

// ---------------------------------------------------------------- Pronto para iniciar
function renderPronto() {
  const box = document.getElementById('vpCorpo');
  if (!box) return;
  if (!M || !M.estoque_ifc || !estMateriaisComCadastros().length) { box.innerHTML = '<div class="bloco"><p class="vazio">Aguardando os dados de Suprimentos…</p></div>'; return; }
  let h = '';
  try {
    const cat = vcCatalogo(), grupos = vcGrupos(cat), { ativs } = vcBom(grupos, cat), cron = vcCronograma();
    const lista = [...ativs.values()].map(a => {
      const s = vcSituacao(a), c = cron.get(a.key), e = cat.get(a.key);
      const dias = c ? vcDias(ref, c.ini) : null;
      return { a, s, c, e, dias };
    }).sort((x, y) => (x.c ? x.c.ini : '9999').localeCompare(y.c ? y.c.ini : '9999') || x.a.key.localeCompare(y.a.key));
    const iniciou = lista.filter(x => x.dias != null && x.dias <= 0 && x.s.nivel !== 'verde' && x.s.total), breve = lista.filter(x => x.dias != null && x.dias > 0 && x.dias <= 14 && x.s.nivel !== 'verde' && x.s.total);
    const prontas = lista.filter(x => x.s.nivel === 'verde');
    const tile = (r, v, s, c) => `<div class="tile" style="--c:${c}"><div class="rot"><span>${r}</span></div><div class="val">${v}</div><div class="sub">${s}</div></div>`;
    h += `<div class="tiles">${tile('Já iniciaram com material faltando', iniciou.length, iniciou.slice(0, 3).map(x => esc(x.e ? x.e.nome : x.a.key)).join(' · ') || 'nenhuma', iniciou.length ? 'var(--vermelho)' : 'var(--verde)')}
      ${tile('Começam em até 14 dias sem material', breve.length, breve.slice(0, 3).map(x => esc(x.e ? x.e.nome : x.a.key)).join(' · ') || 'nenhuma', breve.length ? 'var(--amarelo)' : 'var(--verde)')}
      ${tile('Material completo', prontas.length, `de ${lista.length} atividades com lista de materiais`, 'var(--verde)')}
      ${tile('Atividades sem lista', Math.max(0, [...cat.keys()].length - lista.length), 'confirme os vínculos para incluí-las', 'var(--fg3)')}</div>`;
    const selA = lista.find(x => x.a.key === VC.ativSel);
    if (selA) h += vcDetalheAtiv(selA, cat);
    h += `<div class="bloco"><div class="bloco-cab"><h2>Atividades com lista de materiais</h2><span class="nota">Ordenadas pelo início no cronograma do cliente. Material pronto = média do que já chegou de cada item (peças e fixadores). O limitante é o item que mais atrasa. Referência ${fdA(ref)}.</span></div>
      <div class="tabela-rolagem"><table id="tabVp" data-sem-ferramentas><thead><tr><th>Atividade</th><th>Início previsto</th><th>Material pronto</th><th>Limitante</th><th class="n">Itens completos</th><th>Situação</th></tr></thead><tbody>` +
      (lista.length ? lista.map(x => {
        const ini = x.c ? `${fd(x.c.ini)}<div class="nota">${x.dias <= 0 ? `iniciou há ${-x.dias} d` : `em ${x.dias} d`}</div>` : '<span class="nota">sem cronograma</span>';
        const farol = { verde: '<span class="farol f-verde">COMPLETO</span>', amarelo: '<span class="farol f-amarelo">NO LIMITE</span>', vermelho: '<span class="farol f-vermelho">FALTA MATERIAL</span>', pendente: '<span class="farol f-pendente">SEM DADO</span>' }[x.s.nivel];
        return `<tr class="${VC.ativSel === x.a.key ? 'vc-linha-sel' : ''}"><td><a href="#" class="link" data-vp-ver="${esc(x.a.key)}"><b>${esc(x.e ? x.e.nome : x.a.key)}</b></a><div class="nota">${esc(x.a.key)} · ${esc(x.e ? cap(x.e.itemDesc || '') : '')}</div></td><td>${ini}</td><td>${vcBarra(x.s.media)}</td>
          <td>${x.s.lim ? `${esc(x.s.lim.rotulo)}<div class="nota">${esc(x.s.lim.tag)} · ${nf(x.s.lim.chegou, 0)} de ${nf(x.s.lim.nec, 0)}</div>` : '—'}</td><td class="n">${x.s.completas} / ${x.s.total}</td><td>${farol}</td></tr>`;
      }).join('') : '<tr><td colspan="6" class="vazio">Nenhuma atividade tem lista de materiais ainda. Confirme vínculos em Suprimentos › Vínculos.</td></tr>') + '</tbody></table></div></div>';
  } catch (e) { console.error(e); h = `<div class="bloco"><p class="aviso">Não foi possível montar a tela: ${esc(e.message || e)}</p></div>`; }
  box.innerHTML = h;
  const det = box.querySelector('[data-vc-detalhe]');
  if (det && VC._rolar) det.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  VC._rolar = false;
}

function vcDetalheAtiv(x, cat) {
  const ordem = { peça: 0, componente: 1, fixador: 2 };
  const ls = [...x.a.linhas].sort((p, q) => (ordem[p.tipo] - ordem[q.tipo]) || ((p.pct ?? 0) - (q.pct ?? 0)));
  const rows = ls.map(l => {
    const nec = l.nec > 0 ? vcBarra(Math.min(1, l.chegou / l.nec)) : '—';
    const comp = l.usos > 1 ? `<span class="farol f-amarelo" title="Esta TAG é pedida por ${l.usos} atividades. Total pedido: ${nf(l.totalTag, 0)}. Chegou: ${nf(l.chegou, 0)}.">USADA EM ${l.usos} ATIVIDADES</span><div class="nota">total ${nf(l.totalTag, 0)} · chegou cobre ${nf(Math.min(1, l.chegou / l.totalTag) * 100, 0)}%</div>${l.outras.map(k => esc(vcRotuloAtiv(cat, k))).join('<br>')}` : '<span class="nota">só esta atividade</span>';
    return `<tr><td><span class="farol f-${l.tipo === 'peça' ? 'verde' : l.tipo === 'fixador' ? 'amarelo' : 'pendente'}">${l.tipo.toUpperCase()}</span></td><td><b>${esc(l.tag)}</b><div class="nota">${esc(l.rotulo)}</div></td><td class="nota">${esc(l.origem)}</td><td class="n">${nf(l.nec, 0)}</td><td class="n">${nf(l.chegou, 0)}</td><td>${nec}</td><td>${comp}</td></tr>`;
  }).join('');
  const c = x.c;
  return `<div class="bloco" data-vc-detalhe><div class="bloco-cab"><h2>${esc(x.e ? x.e.nome : x.a.key)} <span class="nota">${esc(x.a.key)}</span></h2><button class="link" data-vp-fechar>Fechar</button></div>
    <p class="nota">${c ? `Cronograma: ${fdA(c.ini)} a ${fdA(c.fim)} · ${esc(c.linhas.slice(0, 3).join(' · '))}` : 'Sem linha no cronograma do cliente.'} ${x.s.lim && x.s.lim.pct < 1 ? `Limitante: <b>${esc(x.s.lim.tag)}</b>, ${nf(x.s.lim.chegou, 0)} de ${nf(x.s.lim.nec, 0)} recebidos.` : ''}</p>
    <div class="tabela-rolagem"><table data-sem-ferramentas><thead><tr><th>Tipo</th><th>Item</th><th>De onde vem a quantidade</th><th class="n">Necessário</th><th class="n">Chegou</th><th>Pronto</th><th>Quem mais usa</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="nota">"Chegou" é o recebimento do cadastro de Materiais. Quando uma TAG serve a mais de uma atividade, o saldo é compartilhado e ainda não há reserva por atividade.</p></div>`;
}

// ---------------------------------------------------------------- ações
async function vcSalvar(itens, msg) {
  try { await postar(API + 'vinculos', { itens }); await carregar(); toast(msg || 'Vínculos gravados'); }
  catch (err) { toast(err.message || String(err), true); }
}

document.addEventListener('click', ev => {
  const t = ev.target && ev.target.closest ? ev.target : null;
  if (!t) return;
  const f = t.closest('[data-vc-f]');
  if (f) { VC.filtro = f.dataset.vcF; VC.sel = ''; return renderVinculos(); }
  const ver = t.closest('[data-vc-ver]');
  if (ver) { ev.preventDefault(); VC.sel = VC.sel === ver.dataset.vcVer ? '' : ver.dataset.vcVer; VC._rolar = true; return renderVinculos(); }
  if (t.closest('[data-vc-fechar]')) { VC.sel = ''; return renderVinculos(); }
  const ok = t.closest('[data-vc-ok]');
  if (ok) {
    const chave = ok.dataset.vcOk, s = document.querySelector(`select[data-vc-sel="${CSS.escape(chave)}"]`), cat = vcCatalogo(), g = vcGrupos(cat).find(x => x.chave === chave);
    if (!s || !s.value) return toast('Escolha a atividade do catálogo para confirmar.', true);
    return vcSalvar([{ chave, estado: 'confirmado', atividade: s.value, familia: g?.fam || '', produto: g?.produto || '', local: g?.local || '' }], 'Vínculo confirmado');
  }
  const ign = t.closest('[data-vc-ign]');
  if (ign) { const g = vcGrupos(vcCatalogo()).find(x => x.chave === ign.dataset.vcIgn); return vcSalvar([{ chave: ign.dataset.vcIgn, estado: 'ignorado', familia: g?.fam || '', produto: g?.produto || '', local: g?.local || '' }], 'Grupo ignorado'); }
  const des = t.closest('[data-vc-desfazer]');
  if (des) return vcSalvar([{ chave: des.dataset.vcDesfazer, estado: 'desfeito' }], 'Decisão desfeita');
  if (t.closest('[data-vc-lote]')) {
    const cat = vcCatalogo(), itens = vcGrupos(cat).filter(g => g.estado === 'sugerida' && g.sug.conf === 'alta').map(g => ({ chave: g.chave, estado: 'confirmado', atividade: g.sug.key, familia: g.fam || '', produto: g.produto, local: g.local }));
    if (!itens.length) return;
    return vcSalvar(itens, `${itens.length} vínculos confirmados`);
  }
  const vp = t.closest('[data-vp-ver]');
  if (vp) { ev.preventDefault(); VC.ativSel = VC.ativSel === vp.dataset.vpVer ? '' : vp.dataset.vpVer; VC._rolar = true; return renderPronto(); }
  if (t.closest('[data-vp-fechar]')) { VC.ativSel = ''; return renderPronto(); }
});
