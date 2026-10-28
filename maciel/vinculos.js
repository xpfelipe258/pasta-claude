'use strict';
// ------------------------------------------------------------------------------------------------
// MATERIAL POR ATIVIDADE (menu Suprimentos › Vínculos e Pronto para iniciar)
// Liga cada item do cadastro de Materiais (peças e fixadores) a uma atividade do catálogo do BM, usando o IFC como referência:
//   peça do IFC  → família (o nome do produto é o da família do IFC)  → frente de serviço (o local do material)  → atividade do catálogo
//   peça         → kit de fixadores por peça (regras_baixa.json: por_peca do fechamento, por_etapa da marquise)  → TAG do fixador
//   serviços com regra por unidade (pré-montagem, içamento de joist, vigas de apoio e intermediárias) já têm a lista pronta nas regras.
// A necessidade vem do IFC (peças do galpão e dos anexos, ifc_anexos.json) e, onde a família não existe no IFC, do planejado do cadastro. Quando IFC e cadastro divergem,
// vale o IFC e o desencontro vira alerta. O vínculo de cada grupo (produto + local) é CONFIRMADO por uma pessoa (usuário ou planejamento);
// quem confirmou e quando ficam gravados em sistema.vinculos_material (rota `vinculos`). Sem confirmação, só há sugestão.
// Depende de app.js e projecao.js: M, T, ref, API, bmTab, estMateriaisComCadastros, ehFixador, ganItensCliente, pjAtividadesBm, faseFiltro,
// postar, carregar, toast, mudarAba, esc, cap, nf, fd, fdA, soma0, $.
// ------------------------------------------------------------------------------------------------
const VC = { filtro: 'sugeridas', sel: '', ativSel: '', _cron: null, _cronM: null, abertas: new Set(), abertasFx: new Set(), extras: new Set(), ativTodas: false };

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
const vcChaveAtiv = cod => M?.estoque_ifc?.regras?.versao_identidade === 1 ? String(cod || '') : String(cod || '').replace(/^(EJ|CMM)-/, '');
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
  // peças dos anexos no IFC: local → família (maiúsculas) → quantidade (ifc_anexos.json, ferramentas/ifc_anexos.py)
  const anx = new Map();
  Object.entries(M?.estoque_ifc?.anexos?.locais || {}).forEach(([loc, fam]) => anx.set(vcUp(loc), new Map(Object.entries(fam).map(([n, v]) => [vcUp(n), Number(v.qtd)]))));
  const mapa = new Map();
  estMateriaisComCadastros().forEach(m => {
    if (!m.tag || regra.has(m.tag) || ehFixador(m)) return;
    const prodUp = vcUp(m.produto), local = m.local || '—', chave = `${prodUp}|${local}`;
    if (!mapa.has(chave)) mapa.set(chave, { chave, produto: prodUp, local, tags: [], planejado: 0, chegou: 0 });
    const g = mapa.get(chave);
    g.tags.push(m.tag); g.planejado += Number(m.planejado) || 0; g.chegou += Number(m.chegou) || 0;
  });
  const gruposIfc = M?.estoque_ifc?.regras?.vinculos_ifc;
  if (gruposIfc) {
    mapa.clear();
    const recebido = new Map(estMateriaisComCadastros().map(m => [m.tag, Number(m.chegou) || 0]));
    const totais = new Map();
    Object.values(gruposIfc).forEach(g => Object.entries(g.tagqtd).forEach(([tag, n]) => totais.set(tag, (totais.get(tag) || 0) + n)));
    Object.entries(gruposIfc).forEach(([chave, g]) => {
      // Recebimento ainda é global por TAG: cobertura por local é proporcional e explicitamente estimada.
      let chegou = 0;
      Object.entries(g.tagqtd).forEach(([tag, n]) => { if (!(M.estoque_ifc.regras.tags_conflitantes || []).includes(tag)) chegou += Math.min(totais.get(tag), recebido.get(tag) || 0) * n / totais.get(tag); });
      mapa.set(chave, { chave, produto: vcUp(g.produto), local: g.local, tags: [...new Set(g.tags)], planejado: g.qtd, chegou, recebidoEstimado: true });
    });
  }
  return [...mapa.values()].map(g => {
    const fam = fams[g.produto] != null ? g.produto : (g.produto === 'TELHA_COB' ? 'TELHA COBERTURA' : null);
    const noGalpao = vcUp(g.local) === 'GALPÃO' && fam && fams[fam] != null;
    const qAnexo = anx.get(vcUp(g.local))?.get(g.produto);
    g.fam = fam || (qAnexo != null ? g.produto : null);
    g.ifc = noGalpao ? Number(fams[fam]) : (qAnexo != null ? qAnexo : null);
    g.ifcAnexo = !noGalpao && qAnexo != null;
    g.dif = g.ifc != null ? g.planejado - g.ifc : 0;
    g.diverge = g.ifc != null && Math.round(g.dif) !== 0;
    g.nec = g.ifc != null ? g.ifc : g.planejado;
    g.kit = noGalpao ? vcKit(fam) : [];
    g.sug = gruposIfc ? null : vcSugerir(g.produto, g.local, cat);
    g.dec = dec[g.chave] || null;
    g.estado = g.dec ? g.dec.estado : (g.sug ? 'sugerida' : 'sem par');
    if (g.estado === 'pendente') g.estado = 'sem par';
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
      origem: g.recebidoEstimado ? 'IFC por TAG/local; recebimento por local estimado a partir do total da TAG' : g.ifc != null ? `IFC: ${nf(g.ifc, 0)} peças${g.diverge ? ' (cadastro ' + nf(g.planejado, 0) + ')' : ''}` : 'planejado do cadastro (peça sem família no IFC)', grupo: g.chave, diverge: g.diverge });
    g.kit.forEach(k => {
      const nec = k.qtd * g.nec, mi = info.get(k.codigo);
      get(g.ativ).linhas.push({ tipo: 'fixador', tag: k.codigo, rotulo: k.descricao || (mi && mi.produto) || k.codigo, nec, chegou: chegouTag.get(k.codigo) || 0, origem: `kit: ${nf(k.qtd, 0)} por ${g.produto.toLowerCase()}`, grupo: g.chave });
      marca(k.codigo, g.ativ, nec);
    });
  });
  // fixadores por unidade cadastrados na atividade (parafuso + arruela + porca): necessário = por unidade × quantidade da atividade
  Object.entries(M?.fixadores_atividade || {}).forEach(([key, cfg]) => {
    if (!cat.has(key)) return;
    const { qtd, un } = vcQtdAtividade(key);
    (cfg.linhas || []).forEach(l => {
      const add = (tag, por, tipo) => {
        if (!tag || !(por > 0)) return;
        const mi = info.get(tag), nec = por * qtd;
        get(key).linhas.push({ tipo, tag, rotulo: (mi && (mi.produto || mi.material)) || tag, nec, chegou: chegouTag.get(tag) || 0,
          origem: `${nf(por, 4)} por ${un || 'und'} × ${nf(qtd, 0)} ${un || 'und'}`, config: true, parafuso: tipo === 'parafuso' ? '' : l.tag });
        marca(tag, key, nec);
      };
      add(l.tag, l.por_unidade, 'parafuso');
      add(l.arruela, l.arruela_qtd != null ? l.arruela_qtd : l.por_unidade, 'arruela');
      add(l.porca, l.porca_qtd != null ? l.porca_qtd : l.por_unidade, 'porca');
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
    const abas = [['sugeridas', `Sugeridas · ${sug.length}`], ['sem', `Sem par · ${sem.length}`], ['confirmadas', `Confirmadas · ${conf.length}`], ['atividades', 'Por atividade'], ['divergencias', `Divergências · ${div.length}`], ['ignoradas', `Ignoradas · ${ign.length}`], ['regras', 'Regras e fixadores']];
    h += `<div class="barra-acoes"><div class="seg" id="vcSeg">${abas.map(([k, r]) => `<button data-vc-f="${k}" class="${VC.filtro === k ? 'ativa' : ''}">${r}</button>`).join('')}</div>
      ${VC.filtro === 'sugeridas' && podeEditar && sug.some(g => g.sug.conf === 'alta') ? `<button class="btn primario" data-vc-lote="alta">Confirmar todas de confiança alta (${sug.filter(g => g.sug.conf === 'alta').length})</button>` : ''}</div>`;
    if (VC.filtro === 'regras') h += vcRegrasHtml(cat, regra);
    else if (VC.filtro === 'atividades') h += vcAtividadesHtml(cat, grupos, podeEditar);
    else {
      const lista = { sugeridas: sug, sem, confirmadas: conf, divergencias: div, ignoradas: ign }[VC.filtro] || [];
      const sel = grupos.find(g => g.chave === VC.sel);
      if (sel) h += vcDetalheGrupo(sel, cat);
      h += `<div class="bloco"><div class="bloco-cab"><h2>${abas.find(a => a[0] === VC.filtro)[1].replace(/ · \d+$/, '')}</h2><span class="nota">Um vínculo vale para todas as TAGs do grupo (produto + local) e para os fixadores do kit da peça. Peças IFC = família no IFC do galpão ou do anexo (Eclusa, Portaria, Refeitório e Vestiário, separados pela fase do modelo); sem família no IFC vale o planejado.</span></div>
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
  const cmp = g.ifc == null ? '<span class="nota">sem peça no IFC</span>' : g.diverge ? `<span class="valor-neg">${nf(g.ifc, 0)} × ${nf(g.planejado, 0)} (${g.dif > 0 ? '+' : '−'}${nf(Math.abs(g.dif), 0)})</span>` : `<span style="color:var(--verde);font-weight:600">${nf(g.ifc, 0)} = ${nf(g.planejado, 0)}</span>`;
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
  const kit = g.kit.length ? g.kit.map(k => `<tr><td><b>${esc(k.codigo)}</b></td><td>${esc(k.descricao)}</td><td class="n">${nf(k.qtd, 0)} por peça</td><td class="n">${nf(k.qtd * g.nec, 0)}</td></tr>`).join('') : `<tr><td colspan="4" class="vazio">${vcUp(g.local) === 'GALPÃO' ? 'Esta família não tem fixadores no desenho do projeto.' : 'Sem lista de fixadores: as regras de fixador deste anexo ainda não existem (o IFC dele não traz parafusos).'}</td></tr>`;
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
    <div class="tabela-rolagem"><table data-sem-ferramentas><thead><tr><th>TAG</th><th>Fixador</th><th class="n">Planejado</th><th class="n">Chegou</th><th>Atividades que usam</th></tr></thead><tbody>${linhasFix}</tbody></table></div></div>` + vcFixadoresProjetoHtml(vcPerm()) + vcParafusosHtml(vcPerm());
}

// ---------------------------------------------------------------- Parafusos, arruelas e porcas do projeto (modelos TRB)
// ifc_parafusos.json (ferramentas/trb_parafusos.py): quantidade por tipo e local. Os IFC de texto saem sem parafuso; só o TRB os traz.
// Arruela e porca "FALSA" do modelo ficam fora das listas. A quantidade do projeto SOMA com o planejado do cadastro de Materiais
// (`vcAplicarTrb`, chamado por estMateriaisComCadastros) quando o diâmetro, o comprimento e a norma batem com uma TAG do cadastro.
const vcFrac = x => String(x || '').replace(/["Ø]/g, ' ').replace(/\./g, ' ').replace(/\s+/g, ' ').trim();
const vcEhArrPor = k => /^(ARRUELA|PORCA)\|/.test(k);

// nome do modelo (PRF_NAME, ARRUELA_…, PORCA_…) → tipo e chave de comparação
function vcChaveTrb(nome) {
  let m = /^PARAF_(\d+\/\d+)"X(.+?)_(A\d+N?|GR\.8)$/.exec(nome);
  if (m) return { kind: 'parafuso', k: `P|${m[1]}|${vcFrac(m[2])}`, norma: m[3].replace(/N$/, '') };
  m = /^PARABOLT_(\d+\/\d+)"X(.+)$/.exec(nome);
  if (m) return { kind: 'parafuso', k: `PB|${m[1]}|${vcFrac(m[2])}`, norma: '' };
  m = /^AB (\d+\/\d+)"X(.+?)_TCP3$/.exec(nome);
  if (m) return { kind: 'parafuso', k: `AB|${m[1]}|${vcFrac(m[2])}`, norma: '' };
  m = /^(ARRUELA|PORCA)_(\d+\/\d+|\d+)"/.exec(nome);
  if (m) return { kind: m[1] === 'ARRUELA' ? 'arruela' : 'porca', k: `${m[1]}|${m[2]}`, norma: '' };
  return { kind: '', k: '', norma: '' };
}
// cadastro de Materiais (produto ou material) → mesma chave
function vcChaveCad(m) {
  for (const txt of [m.produto, m.material]) {
    const t = vcUp(txt);
    let r = /^HARD[O]?BOLT\s*M(\d+)\s*X\s*(\d+)/.exec(t);
    if (r) return { k: `HB|M${r[1]}|${r[2]}`, norma: '' };
    if (/^AUTOBROC|^PF AB PONTA/.test(t)) return { k: 'AUT', norma: '' };
    r = /OLHAL\s*Ø?\s*(\d+\/\d+)\W*[X×]?\s*(\d+)\s*F/.exec(t);
    if (r) return { k: `OL|${r[1]}|${r[2]}`, norma: '' };
    r = /^CBQ\s*Ø?(\d+\/\d+)"\s*X\s*([\d\/ ]+)"/.exec(t);
    if (r) return { k: `CBQ|${r[1]}|${vcFrac(r[2])}`, norma: '' };
    r = /^PARAF\. AB Ø?(\d+\/\d+)" X ([\d\/ ]+)"/.exec(t);
    if (r) return { k: `AB|${r[1]}|${vcFrac(r[2])}`, norma: '' };
    r = /^PARABOLT Ø?(\d+\/\d+)" X ([\d\/ ]+)"/.exec(t);
    if (r) return { k: `PB|${r[1]}|${vcFrac(r[2])}`, norma: '' };
    r = /^PARAF\. Ø?(\d+\/\d+)" X ([\d\/ ]+)"\s*(A\d+N?|GR\.8)?/.exec(t);
    if (r) {
      const mt = vcUp(m.material), n = r[3] || (/GR\.8/.test(mt) ? 'GR.8' : (mt.match(/A\d+/) || [''])[0]);
      return { k: `P|${r[1]}|${vcFrac(r[2])}`, norma: n.replace(/N$/, '') };
    }
    r = /^(ARRUELA|PORCA) Ø?(\d+\/\d+|\d+)"/.exec(t);
    if (r) return { k: `${r[1]}|${r[2]}`, norma: '' };
  }
  return { k: '', norma: '' };
}
// nome como o cadastro de Materiais escreve (usado ao criar a TAG que falta)
function vcNomeCadastro(it) {
  if (it.projeto) return it.nome;
  let m;
  if (it.kind === 'arruela' || it.kind === 'porca') { m = /^(ARRUELA|PORCA)_(\d+\/\d+|\d+)"/.exec(it.nome); return m ? `${m[1]} Ø${m[2]}"` : it.nome; }
  if ((m = /^PARAF_(\d+\/\d+)"X(.+?)_(A\d+N?|GR\.8)$/.exec(it.nome))) return `PARAF. Ø${m[1]}" X ${vcFrac(m[2])}" ${m[3]}`;
  if ((m = /^PARABOLT_(\d+\/\d+)"X(.+)$/.exec(it.nome))) return `PARABOLT Ø${m[1]}" X ${vcFrac(m[2])}"`;
  if ((m = /^AB (\d+\/\d+)"X(.+?)_TCP3$/.exec(it.nome))) return `PARAF. AB Ø${m[1]}" X ${vcFrac(m[2])}"`;
  return it.nome;
}

// parafusos, arruelas e porcas do projeto (sem as "falsas"), cada um com quantidade total e por local
function vcTrbItens() {
  const pf = M?.estoque_ifc?.parafusos;
  if (!pf) return [];
  if (VC._trb && VC._trb.pf === pf) return VC._trb.itens;
  const out = [];
  Object.entries(pf.por_tipo || {}).forEach(([nome, v]) => out.push({ kind: 'parafuso', nome, ...vcChaveTrb(nome), kind: 'parafuso', qtd: v.qtd, locais: v.locais || {}, arruelas: v.arruelas || {}, porcas: v.porcas || {}, diametro: v.diametro_mm, comprimento: v.comprimento_mm }));
  [['arruela', pf.por_arruela], ['porca', pf.por_porca]].forEach(([kind, d]) => Object.entries(d || {}).forEach(([nome, v]) => {
    if (/FALSA/i.test(nome)) return;
    out.push({ ...vcChaveTrb(nome), kind, nome, qtd: v.qtd, locais: v.locais || {}, parafusos: v.parafusos || {} });
  }));
  VC._trb = { pf, itens: out };
  return out;
}
function vcAcharCad(it, cad) {
  const c = cad.filter(x => x.k === it.k);
  if (!c.length) return null;
  if (it.norma) return c.find(x => x.norma === it.norma) || c.find(x => !x.norma) || null;
  return c[0];
}
// soma a quantidade do projeto ao planejado de cada TAG de fixador (cópia: o cadastro gravado não muda)
function vcAplicarTrb(base) {
  if (vcAplicarProjeto(base)) return base;   // fixadores do projeto (lista × IFC, o MAIOR vale) substituem a soma do TRB
  if (M?.estoque_ifc?.regras?.versao_identidade === 1) return base; // já incluído pelo importador
  const itens = vcTrbItens();
  if (!itens.length) return base;
  const cad = base.map(m => ({ m, ...vcChaveCad(m) })).filter(x => x.k && ehFixador(x.m));
  const soma = new Map();
  itens.forEach(it => {
    const c = vcAcharCad(it, cad);
    if (!c) return;
    const o = soma.get(c.m) || { qtd: 0, itens: [] };
    o.qtd += it.qtd; o.itens.push(it.nome); soma.set(c.m, o);
  });
  soma.forEach((o, m) => {
    const ch = Number(m.chegou) || 0;
    m.planejado_cad = Number(m.planejado) || 0; m.planejado_trb = o.qtd; m.planejado = m.planejado_cad + o.qtd; m.trb_itens = o.itens;
    m.atendimento = m.planejado ? ch / m.planejado : null;
    m.status_logistico = ch <= 0 ? 'Crítico' : ch < m.planejado ? 'Recebimento Parcial' : ch > m.planejado ? 'Excedente' : 'Atendido';
  });
  return base;
}
// ---- Fixadores do projeto: LISTA em planilha × IFC. REGRA: o planejado é o MAIOR valor (cadastro, lista ou IFC); o peso unitário vem da lista.
// Dados em M.estoque_ifc.fixadores_projeto (ferramentas/fixadores_projeto.php na obra 198; a importação de obra nova grava sozinha).
function vcProjetoItens() {
  const fp = M?.estoque_ifc?.fixadores_projeto;
  return fp && Array.isArray(fp.itens) ? fp.itens.map(i => ({ ...i, projeto: true })) : [];
}
// TAGs do cadastro que recebem o planejado do projeto: fixadores (e os parafusos olhais, cadastrados como estrutural)
const vcCadProjeto = base => base.map(m => ({ m, ...vcChaveCad(m) })).filter(x => x.k && (ehFixador(x.m) || x.k.startsWith('OL|')));
// Um só TAG para a bitola recebe todas as normas (o cadastro nem sempre traz a norma certa); com mais de um TAG vale a norma igual.
function vcAcharProjeto(it, cad) {
  const c = cad.filter(x => x.k === it.k);
  if (!c.length) return null;
  if (c.length === 1) return c[0];
  return c.find(x => x.norma === it.norma) || c.find(x => !x.norma) || null;
}
function vcAplicarProjeto(base) {
  const itens = vcProjetoItens();
  if (!itens.length) return false;
  const cad = vcCadProjeto(base);
  const acum = new Map();
  itens.forEach(it => {
    const c = vcAcharProjeto(it, cad);
    if (!c) return;
    const o = acum.get(c.m) || { lista: 0, ifc: 0, plan: 0, pT: 0, pQ: 0, nomes: [] };
    o.lista += it.lista; o.ifc += it.ifc; o.plan += it.planejado;
    if (it.peso_unit > 0) { o.pT += it.peso_unit * it.planejado; o.pQ += it.planejado; }
    o.nomes.push(it.nome); acum.set(c.m, o);
  });
  acum.forEach((o, m) => {
    const ch = Number(m.chegou) || 0, cadQ = Number(m.planejado) || 0;
    m.planejado_cad = cadQ; m.planejado_lista = o.lista; m.planejado_ifc = o.ifc; m.planejado_proj = o.plan;
    m.planejado = Math.max(cadQ, o.plan);
    m.planejado_trb = Math.max(0, m.planejado - cadQ);   // quanto o projeto acrescenta ao cadastro (Inventário soma esse acréscimo)
    m.trb_itens = o.nomes;
    if (o.pQ > 0) {
      m.peso_unitario_cad = Number(m.peso_unitario) || 0;
      m.peso_unitario = Math.round(o.pT / o.pQ * 10000) / 10000;
      m.peso_total = m.peso_unitario * m.planejado;
    }
    m.atendimento = m.planejado ? ch / m.planejado : null;
    m.status_logistico = ch <= 0 ? 'Crítico' : ch < m.planejado ? 'Recebimento Parcial' : ch > m.planejado ? 'Excedente' : 'Atendido';
  });
  return true;
}
// TAG do cadastro de cada fixador do projeto (ou null)
function vcCasarProjeto() {
  const cad = vcCadProjeto(estMateriaisComCadastros());
  return vcProjetoItens().map(it => ({ it, c: vcAcharProjeto(it, cad) }));
}
function vcFixadoresProjetoHtml(podeEditar) {
  const fp = M?.estoque_ifc?.fixadores_projeto;
  if (!fp || !Array.isArray(fp.itens) || !fp.itens.length) return '';
  const casados = vcCasarProjeto(), faltam = casados.filter(x => !x.c);
  const pesoT = soma0(casados, x => (x.it.peso_unit || 0) * x.it.planejado) / 1000;
  const semPeso = casados.filter(x => !(x.it.peso_unit > 0)).length;
  const ifcMaior = casados.filter(x => x.it.origem === 'IFC' || x.it.origem === 'só IFC').length;
  const tile = (r, v, s, c) => `<div class="tile" style="--c:${c}"><div class="rot"><span>${r}</span></div><div class="val">${v}</div><div class="sub">${s}</div></div>`;
  const orig = { lista: ['f-pendente', 'LISTA MAIOR'], IFC: ['f-amarelo', 'IFC MAIOR'], igual: ['f-verde', 'IGUAIS'], 'só lista': ['f-pendente', 'SÓ NA LISTA'], 'só IFC': ['f-amarelo', 'SÓ NO IFC'] };
  const linhas = casados.map(({ it, c }) => {
    const o = orig[it.origem] || ['f-pendente', it.origem];
    const esc1 = Object.entries(it.por_escopo || {}).map(([k, v]) => `${k}: ${nf(v, 0)}`).join(' · ');
    const ifc1 = Object.entries(it.por_fonte_ifc || {}).map(([k, v]) => `${k}: ${nf(v, 0)}`).join(' · ');
    const m = c && c.m;
    const tag = m ? `<b>${esc(m.tag)}</b><div class="nota">cadastro ${nf(m.planejado_cad ?? m.planejado, 0)} → <b>${nf(m.planejado, 0)}</b></div>` : '<span class="farol f-vermelho">SEM TAG</span>';
    return `<tr><td><b>${esc(it.nome)}</b></td><td class="n" title="${esc(esc1)}">${it.lista ? nf(it.lista, 0) : '—'}</td><td class="n" title="${esc(ifc1)}">${it.ifc ? nf(it.ifc, 0) : '—'}</td><td class="n"><b>${nf(it.planejado, 0)}</b></td><td><span class="farol ${o[0]}">${o[1]}</span></td>
      <td class="n">${it.peso_unit > 0 ? nf(it.peso_unit, 4) : '<span class="nota">sem peso</span>'}${it.peso_unit > 0 && it.peso_fonte !== 'lista' ? `<div class="nota">${esc(it.peso_fonte)}</div>` : ''}</td><td class="n">${it.peso_unit > 0 ? nf(it.peso_unit * it.planejado, 1) : '—'}</td><td>${tag}</td></tr>`;
  }).join('');
  const btn = faltam.length && podeEditar ? `<button class="btn primario" type="button" data-vc-criar-faltantes>Criar ${faltam.length} TAG(s) que faltam no cadastro</button>` : '';
  const fontes = [...(fp.fontes?.lista || []).map(f => `${esc(f.arquivo)} (${nf(f.linhas, 0)} linhas)`), ...(fp.fontes?.ifc || []).map(f => `IFC: ${esc(f.arquivo)}`)].join(' · ');
  return `<div class="bloco"><div class="bloco-cab"><h2>Fixadores do projeto — lista × IFC (planejado = o MAIOR dos dois)</h2><span class="nota">${fontes}${fp.gerado_em ? ` · conciliado em ${esc(fp.gerado_em)}` : ''}</span></div>
    <div class="tiles">${tile('Tipos de fixador', nf(casados.length, 0), `${nf(casados.length - faltam.length, 0)} com TAG · ${faltam.length} sem TAG`, faltam.length ? 'var(--amarelo)' : 'var(--verde)')}
      ${tile('IFC maior que a lista', nf(ifcMaior, 0), 'o IFC passa a valer nesses itens', ifcMaior ? 'var(--amarelo)' : 'var(--verde)')}
      ${tile('Peso planejado', `${nf(pesoT, 1)} t`, semPeso ? `${semPeso} tipo(s) sem peso na lista` : 'todos com peso', semPeso ? 'var(--amarelo)' : 'var(--verde)')}</div>
    <details class="vc-ativ" open><summary><b>Comparação item a item</b> <span class="nota">passe o mouse na quantidade para ver por escopo / modelo · peso unitário da lista (total ÷ quantidade)</span></summary>
    <div class="tabela-rolagem"><table data-sem-ferramentas><thead><tr><th>Fixador</th><th class="n">Lista</th><th class="n">IFC</th><th class="n">Planejado</th><th>Maior</th><th class="n">Peso un. (kg)</th><th class="n">Peso total (kg)</th><th>TAG no cadastro</th></tr></thead><tbody>${linhas}</tbody></table></div></details>
    <div class="barra-acoes">${btn}</div></div>`;
}
// quantidade do projeto somada ao planejado, por TAG (para o Inventário e outras telas)
function vcPlanejadoTrbPorTag() {
  const mapa = new Map();
  estMateriaisComCadastros().forEach(m => { if (m.tag && m.planejado_trb) mapa.set(m.tag, m.planejado_trb); });
  return mapa;
}
// TAG do cadastro de cada item do projeto (ou null) e os itens que ainda não têm TAG
function vcCasarTrb() {
  const cad = estMateriaisComCadastros().map(m => ({ m, ...vcChaveCad(m) })).filter(x => x.k && ehFixador(x.m));
  return vcTrbItens().map(it => ({ it, c: vcAcharCad(it, cad) }));
}

function vcParafusosHtml(podeEditar) {
  const pf = M?.estoque_ifc?.parafusos;
  if (!pf) return '';
  const casados = vcCasarTrb(), faltam = vcProjetoItens().length ? [] : casados.filter(x => !x.c).map(x => x.it);
  const locsHtml = loc => Object.entries(loc).sort((a, b) => b[1] - a[1]).map(([l, q]) => `${esc(l)} <b>${nf(q, 0)}</b>`).join(' · ');
  const kitHtml = it => it.kind === 'parafuso'
    ? [...Object.entries(it.arruelas), ...Object.entries(it.porcas)].map(([n, q]) => `${esc(n)} <b>${nf(q, 0)}</b>`).join('<br>') || '<span class="nota">sem arruela nem porca</span>'
    : Object.entries(it.parafusos).sort((a, b) => b[1] - a[1]).map(([n, q]) => `${esc(n)} <b>${nf(q, 0)}</b>`).join('<br>');
  const linha = ({ it, c }) => {
    const m = c && c.m;
    const cadHtml = m ? `<b>${esc(m.tag)}</b> ${esc(m.produto || m.material)}<br><span class="nota">${m.planejado_cad != null ? `cadastro ${nf(m.planejado_cad, 0)} + projeto ${nf(m.planejado_trb, 0)} = <b>${nf(m.planejado, 0)}</b>` : `planejado ${nf(m.planejado, 0)}`} · chegou ${nf(m.chegou, 0)}</span>` : '<span class="farol f-pendente">SEM TAG NO CADASTRO</span><div class="nota">será criada como ' + esc(vcNomeCadastro(it)) + '</div>';
    return `<tr><td><b>${esc(it.nome)}</b>${it.kind === 'parafuso' ? `<div class="nota">Ø ${nf(it.diametro, 1)} × ${nf(it.comprimento, 1)} mm</div>` : ''}</td><td class="n"><b>${nf(it.qtd, 0)}</b></td><td>${locsHtml(it.locais)}</td><td>${kitHtml(it)}</td><td>${cadHtml}</td></tr>`;
  };
  const secao = (kind, titulo, aberta) => {
    const ls = casados.filter(x => x.it.kind === kind);
    const tot = soma0(ls, x => x.it.qtd);
    return `<details class="vc-ativ" ${aberta ? 'open' : ''} data-vc-sec="${kind}"><summary><b>${titulo}</b> <span class="nota">${ls.length} tipos · ${nf(tot, 0)} no projeto · ${ls.filter(x => !x.c).length} sem TAG</span></summary>
      <div class="tabela-rolagem"><table data-sem-ferramentas><thead><tr><th>${kind === 'parafuso' ? 'Parafuso (PRF_NAME)' : 'Nome no modelo'}</th><th class="n">Total no projeto</th><th>Onde estão</th><th>${kind === 'parafuso' ? 'Arruela e porca do kit' : 'Parafusos que usam'}</th><th>TAG no cadastro de Materiais</th></tr></thead><tbody>${ls.map(linha).join('')}</tbody></table></div></details>`;
  };
  const loc = Object.entries(pf.por_local).map(([l, v]) => `<tr><td><b>${esc(l)}</b></td><td class="n">${nf(v.BOLT_conjuntos || 0, 0)}</td><td class="n"><b>${nf(v.BOLT_qtd || 0, 0)}</b></td><td class="n">${nf(v.arruelas || 0, 0)}</td><td class="n">${nf(v.porcas || 0, 0)}</td><td class="n">${nf(v.HOLE_qtd || 0, 0)}</td></tr>`).join('');
  const tot = Object.values(pf.por_local).reduce((s, v) => s + (v.BOLT_qtd || 0), 0);
  const btn = `<button class="btn" type="button" data-vc-parafcsv>Baixar lista com localização (CSV)</button>${faltam.length && podeEditar ? ` <button class="btn primario" type="button" data-vc-criar-faltantes>Criar ${faltam.length} TAG(s) que faltam no cadastro</button>` : ''}`;
  return `<div class="bloco"><div class="bloco-cab"><h2>Parafusos, arruelas e porcas do projeto — ${nf(tot, 0)} parafusos</h2><span class="nota">Lidos dos modelos TRB (os IFC de texto não trazem parafuso). ${vcProjetoItens().length ? 'Aqui fica a localização de cada parafuso; o planejado vem da conciliação lista × IFC (bloco acima).' : 'A quantidade do projeto é SOMADA ao planejado do cadastro de Materiais.'} Furos sem parafuso e arruela/porca "falsa" do modelo ficam de fora.</span></div>
    <div class="tabela-rolagem"><table data-sem-ferramentas><thead><tr><th>Local</th><th class="n">Conjuntos</th><th class="n">Parafusos</th><th class="n">Arruelas</th><th class="n">Porcas</th><th class="n">Furos sem parafuso</th></tr></thead><tbody>${loc}</tbody></table></div>
    <div class="barra-acoes">${btn}</div></div>
    <div class="bloco">${secao('parafuso', 'Parafusos', true)}${secao('arruela', 'Arruelas', false)}${secao('porca', 'Porcas', false)}</div>`;
}
// cria no cadastro de Materiais as TAGs de fixador que o projeto usa e ainda não existem (a TAG FG### é gerada pelo servidor)
async function vcCriarTagsFaltantes() {
  const faltam = (vcProjetoItens().length ? vcCasarProjeto() : vcCasarTrb()).filter(x => !x.c).map(x => x.it);
  if (!faltam.length) return toast('Todos os fixadores do projeto já têm TAG.');
  let n = 0;
  try {
    for (const it of faltam) {
      await postar(API + 'registro', { tabela: 'materiais', campos: { material: vcNomeCadastro(it), unidade: 'un', tipo_material: 'FIXADOR', local: 'Todos os locais', etapa: 'Fixação', saldo_inicial: 0 } });
      n++;
    }
    await carregar();
    toast(`${n} TAG(s) criadas no cadastro de Materiais.`);
  } catch (err) { toast(`${n} criadas; parou em: ${err.message || err}`, true); await carregar(); }
}
// CSV com um conjunto por linha: local, tipo, parafuso, quantidade, arruelas, porcas, montagem, coordenadas e peça vizinha
async function vcBaixarParafusosCsv() {
  try {
    const r = await fetch(API + 'parafusos-locais', { cache: 'no-store' });
    if (!r.ok) throw new Error('lista não publicada');
    const d = await r.json(), T = d.tabelas;
    const cab = ['Modelo', 'Local', 'Tipo (BOLT=parafuso, HOLE=furo)', 'Parafuso', 'Qtd', 'Arruelas', 'Porcas', 'Montagem', 'X (m)', 'Y (m)', 'Cota Z (m)', 'Fase da peça vizinha', 'Distância à peça (m)', 'Arruela do kit', 'Porca do kit'];
    const q = v => `"${String(v).replace(/"/g, '""')}"`;
    const num = v => String(v).replace('.', ',');
    const lin = d.linhas.map(l => [T.modelo[l[0]], T.local[l[1]], T.tipo[l[2]], T.prf[l[3]], l[4], l[5], l[6], T.montagem[l[7]] === 'Site' ? 'Obra' : (T.montagem[l[7]] === 'Shop' ? 'Fábrica' : T.montagem[l[7]]), num(l[8]), num(l[9]), num(l[10]), T.fase_vizinha[l[11]], num(l[12]), T.arruela[l[13]], T.porca[l[14]]].map(q).join(';'));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + dataBR([cab.map(q).join(';'), ...lin].join('\r\n'))], { type: 'text/csv;charset=utf-8' }));
    a.download = 'parafusos-localizacao.csv';
    document.body.appendChild(a); a.click(); a.remove();
    toast(`${lin.length} conjuntos exportados.`);
  } catch (e) { toast('Não foi possível baixar: ' + (e.message || e), true); }
}

// ---------------------------------------------------------------- Por atividade: peças, fixadores (parafuso + arruela + porca) e baixa por unidade
const VC_ITEM_LOCAL = Object.fromEntries(Object.entries(VC_ANEXO_ITEM).map(([l, i]) => [i, l]));
const vcLocalDaAtiv = key => VC_ITEM_LOCAL[String(key).replace(/-\d+$/, '')] || '';
function vcQtdAtividade(key) {
  let qtd = 0, un = '';
  bmTab('bm_atividades').forEach(a => { if (vcChaveAtiv(a.codigo) === key) { qtd += Number(a.qtd) || 0; un = un || a.unidade || ''; } });
  return { qtd, un };
}
// produção já lançada da atividade (todas as empresas do catálogo), na unidade do catálogo — base da baixa automática
function vcRealizadoAtividade(key) {
  let t = 0;
  bmTab('bm_atividades').forEach(a => { if (vcChaveAtiv(a.codigo) === key) t += bmRealizado(a, '9999-12-31') || 0; });
  return t;
}
const vcKindDe = txt => { const t = vcUp(txt); return /ARRUELA|WASHER/.test(t) ? 'arruela' : /PORCA|NUT/.test(t) ? 'porca' : /PARAF|PARABOLT|CHUMBADOR/.test(t) ? 'parafuso' : ''; };
const vcDiamDe = txt => { const m = /Ø\s*(\d+\/\d+|\d+)"/.exec(String(txt || '')); return m ? m[1] : ''; };
function vcOpcoesFix(kind, sel) {
  const l = estMateriaisComCadastros().filter(m => m.tag && ehFixador(m) && (!kind || vcKindDe(m.produto + ' ' + m.material) === kind))
    .sort((a, b) => a.tag.localeCompare(b.tag, 'pt', { numeric: true }));
  return '<option value="">—</option>' + l.map(m => `<option value="${esc(m.tag)}" ${m.tag === sel ? 'selected' : ''}>${esc(m.tag + ' · ' + (m.produto || m.material) + (m.material && m.material !== m.produto ? ' ' + m.material : ''))}</option>`).join('');
}
// arruela e porca do cadastro com o mesmo diâmetro do parafuso (o kit)
function vcKitDoParafuso(tag) {
  const m = estMateriaisComCadastros().find(x => x.tag === tag);
  const c = m ? vcChaveCad(m) : { k: '' };
  const d = (c.k.split('|')[0] === 'P' || c.k.split('|')[0] === 'PB') ? c.k.split('|')[1] : '';
  if (!d) return { arruela: '', porca: '' };
  const cad = estMateriaisComCadastros().filter(x => x.tag && ehFixador(x)).map(x => ({ x, ...vcChaveCad(x) }));
  const pega = pre => (cad.find(y => y.k === `${pre}|${d}`) || { x: { tag: '' } }).x.tag;
  return { arruela: pega('ARRUELA'), porca: pega('PORCA') };
}
function vcFxLinhaHtml(l) {
  l = l || {};
  return `<tr data-fx-linha><td><select class="vc-sel" data-fx-tag>${vcOpcoesFix('', l.tag)}</select></td>
    <td><input type="number" step="any" min="0" class="vc-num" data-fx-por value="${l.por_unidade != null ? l.por_unidade : ''}" placeholder="por und"></td>
    <td><select class="vc-sel" data-fx-arr>${vcOpcoesFix('arruela', l.arruela)}</select><input type="number" step="any" min="0" class="vc-num" data-fx-arrq value="${l.arruela ? (l.arruela_qtd != null ? l.arruela_qtd : l.por_unidade) : ''}" placeholder="qtd"></td>
    <td><select class="vc-sel" data-fx-pca>${vcOpcoesFix('porca', l.porca)}</select><input type="number" step="any" min="0" class="vc-num" data-fx-pcaq value="${l.porca ? (l.porca_qtd != null ? l.porca_qtd : l.por_unidade) : ''}" placeholder="qtd"></td>
    <td><button type="button" class="link" data-fx-del>remover</button></td></tr>`;
}
// sugestões do projeto (TRB) para o prédio da atividade: o modelo não separa por atividade, então a pessoa escolhe quais usar
function vcSugestoesFx(key) {
  const pf = M?.estoque_ifc?.parafusos, local = vcLocalDaAtiv(key);
  if (!pf || !local) return '<p class="nota">O projeto (TRB) só cobre os anexos. Para atividades do galpão os fixadores vêm das regras de serviço.</p>';
  const { qtd, un } = vcQtdAtividade(key);
  const lf = (pf.por_local_fase || {})[Object.keys(pf.por_local_fase || {}).find(l => vcUp(l) === vcUp(local)) || ''] || {};
  const casa = vcCasarTrb(), tagDe = nome => (casa.find(x => x.it.nome === nome && x.c) || {}).c;
  const linhas = [];
  Object.entries(lf).forEach(([fase, v]) => Object.entries(v.parafusos || {}).forEach(([prf, q]) => {
    const c = tagDe(prf), it = vcTrbItens().find(x => x.nome === prf);
    const arr = it ? Object.keys(it.arruelas || {})[0] : '', pca = it ? Object.keys(it.porcas || {})[0] : '';
    const ta = arr ? (tagDe(arr) || {}).m : null, tp = pca ? (tagDe(pca) || {}).m : null;
    const por = qtd > 0 ? Math.round((q / qtd) * 10000) / 10000 : 0;
    linhas.push(`<tr><td>${esc(fase)}</td><td><b>${esc(prf)}</b></td><td class="n">${nf(q, 0)}</td><td>${c ? `<b>${esc(c.m.tag)}</b>` : '<span class="farol f-pendente">SEM TAG</span>'}</td><td class="n">${nf(por, 4)} / ${esc(un || 'und')}</td>
      <td>${c ? `<button type="button" class="link" data-fx-usar='${esc(JSON.stringify({ tag: c.m.tag, por_unidade: por, arruela: ta ? ta.tag : '', porca: tp ? tp.tag : '' }))}' data-fx-key="${esc(key)}">usar</button>` : '<span class="nota">crie a TAG em Regras e fixadores</span>'}</td></tr>`);
  }));
  return `<p class="nota">Fixadores do projeto no prédio <b>${esc(cap(local.toLowerCase()))}</b> (por fase do modelo). O projeto não separa por atividade: use só os que pertencem a <b>${esc(key)}</b>. "Por und" = quantidade do prédio ÷ ${nf(qtd, 0)} ${esc(un || 'und')} da atividade, ajuste se só parte for dela.</p>
    <div class="tabela-rolagem"><table data-sem-ferramentas><thead><tr><th>Fase do modelo</th><th>Parafuso</th><th class="n">No prédio</th><th>TAG</th><th class="n">Por und</th><th></th></tr></thead><tbody>${linhas.join('') || '<tr><td colspan="6" class="vazio">Sem parafusos neste prédio.</td></tr>'}</tbody></table></div>`;
}
function vcAtividadesHtml(cat, grupos, podeEditar) {
  const { ativs } = vcBom(grupos, cat);
  const fa = M?.fixadores_atividade || {};
  const chaves = [...cat.keys()].filter(k => VC.ativTodas || ativs.has(k) || fa[k] || VC.extras.has(k)).sort((a, b) => a.localeCompare(b, 'pt', { numeric: true }));
  const regra = vcTagsRegra(), ativRegra = new Set(VC_REGRA_SERV.map(x => x.ativ));
  const farol = { verde: '<span class="farol f-verde">ATENDE</span>', amarelo: '<span class="farol f-amarelo">NO LIMITE</span>', vermelho: '<span class="farol f-vermelho">NÃO ATENDE</span>', pendente: '<span class="farol f-pendente">SEM LISTA</span>' };
  const ordem = { peça: 0, componente: 1, fixador: 2, parafuso: 2, arruela: 3, porca: 4 };
  const corpo = key => {
    const a = ativs.get(key) || { key, linhas: [] }, e = cat.get(key), sit = vcSituacao(a), { qtd, un } = vcQtdAtividade(key);
    const ls = [...a.linhas].sort((p, q) => ((ordem[p.tipo] ?? 9) - (ordem[q.tipo] ?? 9)) || String(p.tag).localeCompare(String(q.tag), 'pt', { numeric: true }));
    const linhas = ls.map(l => {
      const kind = l.tipo === 'peça' ? '' : (['parafuso', 'arruela', 'porca'].includes(l.tipo) ? l.tipo : vcKindDe(l.rotulo));
      let par = '';
      if (kind === 'arruela' || kind === 'porca') {
        const pfs = l.parafuso ? ls.filter(x => x.tag === l.parafuso && x !== l) : ls.filter(x => x !== l && vcKindDe(x.rotulo) === 'parafuso' && vcDiamDe(x.rotulo) && vcDiamDe(x.rotulo) === vcDiamDe(l.rotulo));
        const lista = pfs.length ? pfs : (l.parafuso ? [{ tag: l.parafuso, rotulo: '' }] : []);
        if (lista.length) par = `<div class="nota">parafuso do kit: ${lista.map(x => `<b>${esc(x.tag)}</b>${x.rotulo ? ' ' + esc(x.rotulo) : ''}`).join(' · ')}</div>`;
      }
      const sal = l.chegou - l.nec;
      const ok = l.nec > 0 ? (l.chegou >= l.nec ? '<span class="farol f-verde">ATENDE</span>' : l.chegou > 0 ? `<span class="farol f-amarelo">PARCIAL ${nf(l.chegou / l.nec * 100, 0)}%</span>` : '<span class="farol f-vermelho">NÃO ATENDE</span>') : '—';
      const dupla = l.config && ativRegra.has(key) && regra.has(l.tag) ? '<div class="nota valor-neg">esta atividade já baixa esta TAG por regra de serviço: pode contar em dobro</div>' : '';
      return `<tr><td><span class="farol f-${l.tipo === 'peça' ? 'verde' : l.tipo === 'componente' ? 'pendente' : 'amarelo'}">${esc((kind || l.tipo).toUpperCase())}</span></td><td><b>${esc(l.tag)}</b><div class="nota">${esc(l.rotulo)}</div>${par}${dupla}</td><td class="nota">${esc(l.origem)}</td><td class="n">${nf(l.nec, 0)}</td><td class="n">${nf(l.chegou, 0)}</td><td class="n ${sal < 0 ? 'valor-neg' : ''}">${nf(sal, 0)}</td><td>${ok}</td></tr>`;
    }).join('');
    const cfg = (fa[key] && fa[key].linhas) || [];
    const abertoFx = VC.abertasFx.has(key);
    const editor = podeEditar ? `<details class="vc-fx" data-vc-fx="${esc(key)}" ${abertoFx ? 'open' : ''}><summary><b>Fixadores por unidade desta atividade</b> <span class="nota">${cfg.length} linha(s) · quando a produção da atividade é lançada, o consumo desses fixadores sobe sozinho${fa[key] ? ` · gravado por ${esc(fa[key].por || '—')} em ${esc(String(fa[key].em || '').slice(0, 16))}` : ''}</span></summary>
      <p class="nota">Cada linha = um fixador com a quantidade que a atividade usa <b>por ${esc(un || 'unidade')}</b> produzida. Se tem arruela e porca, escolha também: o parafuso, a arruela e a porca baixam juntos. Unidades já lançadas hoje: <b>${nf(vcRealizadoAtividade(key), 2)}</b> ${esc(un || '')}.</p>
      <div class="tabela-rolagem"><table data-sem-ferramentas><thead><tr><th>Fixador (parafuso)</th><th>Por ${esc(un || 'und')}</th><th>Arruela · qtd por ${esc(un || 'und')}</th><th>Porca · qtd por ${esc(un || 'und')}</th><th></th></tr></thead><tbody data-fx-corpo="${esc(key)}">${cfg.map(vcFxLinhaHtml).join('')}</tbody></table></div>
      <div class="barra-acoes"><button type="button" class="btn" data-fx-add="${esc(key)}">+ Adicionar fixador</button> <button type="button" class="btn" data-fx-sug="${esc(key)}">Sugerir do projeto (TRB)</button> <button type="button" class="btn primario" data-fx-salvar="${esc(key)}">Salvar fixadores desta atividade</button></div>
      <div data-fx-sugestoes="${esc(key)}" hidden></div></details>` : '';
    return `<div class="vc-ativ-corpo">${a.linhas.length ? `<div class="tabela-rolagem"><table data-sem-ferramentas><thead><tr><th>Tipo</th><th>Item</th><th>De onde vem a quantidade</th><th class="n">Planejado</th><th class="n">Chegou</th><th class="n">Saldo</th><th>Atende?</th></tr></thead><tbody>${linhas}</tbody></table></div>` : '<p class="nota">Nenhuma peça ou fixador ligado a esta atividade ainda. Confirme vínculos de peças ou cadastre os fixadores por unidade abaixo.</p>'}${editor}</div>`;
  };
  const itens = chaves.map(key => {
    const a = ativs.get(key) || { key, linhas: [] }, e = cat.get(key), sit = vcSituacao(a), { qtd, un } = vcQtdAtividade(key);
    return `<details class="vc-ativ" data-vc-ativ="${esc(key)}" ${VC.abertas.has(key) ? 'open' : ''}><summary><b>${esc(e ? e.nome : key)}</b> <span class="nota">${esc(key)} · ${esc(e ? cap(e.itemDesc || '') : '')}${qtd ? ` · ${nf(qtd, 0)} ${esc(un)}` : ''}</span>
      <span class="vc-resumo">${a.linhas.length ? `${sit.completas}/${sit.total} itens atendem ${vcBarra(sit.media)}` : ''} ${farol[sit.nivel]}</span></summary>${corpo(key)}</details>`;
  }).join('');
  const extras = [...cat.keys()].filter(k => !chaves.includes(k)).sort((a, b) => a.localeCompare(b, 'pt', { numeric: true }));
  return `<div class="bloco"><div class="bloco-cab"><h2>Peças e fixadores de cada atividade</h2><span class="nota">Clique na atividade para exibir ou ocultar: peças com a quantidade planejada, fixadores (parafuso, arruela e porca) e se o que chegou atende.</span></div>
    <div class="barra-acoes"><button class="btn" type="button" data-vc-todas="abrir">Exibir todas</button> <button class="btn" type="button" data-vc-todas="fechar">Ocultar todas</button>
      <label class="check"><input type="checkbox" data-vc-ativtodas ${VC.ativTodas ? 'checked' : ''}> mostrar também atividades sem material</label>
      ${podeEditar && !VC.ativTodas && extras.length ? `<select class="vc-sel" data-vc-extra><option value="">Cadastrar fixadores em outra atividade…</option>${extras.map(k => `<option value="${esc(k)}">${esc(vcRotuloAtiv(cat, k))}</option>`).join('')}</select>` : ''}</div>
    ${itens || '<p class="vazio">Nenhuma atividade com material. Confirme vínculos ou cadastre fixadores por unidade.</p>'}</div>`;
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
  const ordem = { peça: 0, componente: 1, fixador: 2, parafuso: 2, arruela: 3, porca: 4 };
  const ls = [...x.a.linhas].sort((p, q) => (ordem[p.tipo] - ordem[q.tipo]) || ((p.pct ?? 0) - (q.pct ?? 0)));
  const rows = ls.map(l => {
    const nec = l.nec > 0 ? vcBarra(Math.min(1, l.chegou / l.nec)) : '—';
    const comp = l.usos > 1 ? `<span class="farol f-amarelo" title="Esta TAG é pedida por ${l.usos} atividades. Total pedido: ${nf(l.totalTag, 0)}. Chegou: ${nf(l.chegou, 0)}.">USADA EM ${l.usos} ATIVIDADES</span><div class="nota">total ${nf(l.totalTag, 0)} · chegou cobre ${nf(Math.min(1, l.chegou / l.totalTag) * 100, 0)}%</div>${l.outras.map(k => esc(vcRotuloAtiv(cat, k))).join('<br>')}` : '<span class="nota">só esta atividade</span>';
    return `<tr><td><span class="farol f-${l.tipo === 'peça' ? 'verde' : l.tipo === 'componente' ? 'pendente' : 'amarelo'}">${l.tipo.toUpperCase()}</span></td><td><b>${esc(l.tag)}</b><div class="nota">${esc(l.rotulo)}</div></td><td class="nota">${esc(l.origem)}</td><td class="n">${nf(l.nec, 0)}</td><td class="n">${nf(l.chegou, 0)}</td><td>${nec}</td><td>${comp}</td></tr>`;
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

// grava os fixadores por unidade de uma atividade (lê as linhas da tela)
async function vcSalvarFixadores(key) {
  const corpo = document.querySelector(`[data-fx-corpo="${CSS.escape(key)}"]`);
  if (!corpo) return;
  const num = v => { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : 0; };
  const linhas = [...corpo.querySelectorAll('[data-fx-linha]')].map(tr => {
    const g = sel => tr.querySelector(sel)?.value || '';
    const por = num(g('[data-fx-por]')), l = { tag: g('[data-fx-tag]'), por_unidade: por };
    if (g('[data-fx-arr]')) { l.arruela = g('[data-fx-arr]'); l.arruela_qtd = g('[data-fx-arrq]') === '' ? por : num(g('[data-fx-arrq]')); }
    if (g('[data-fx-pca]')) { l.porca = g('[data-fx-pca]'); l.porca_qtd = g('[data-fx-pcaq]') === '' ? por : num(g('[data-fx-pcaq]')); }
    return l;
  }).filter(l => l.tag);
  const sem = linhas.find(l => !(l.por_unidade > 0));
  if (sem) return toast(`Informe a quantidade por unidade do fixador ${sem.tag}.`, true);
  VC.abertas.add(key); VC.abertasFx.add(key);
  try { await postar(API + 'fixadores-atividade', { atividade: key, linhas }); await carregar(); toast(linhas.length ? 'Fixadores da atividade gravados. A baixa passa a acontecer com a produção lançada.' : 'Fixadores da atividade removidos.'); }
  catch (err) { toast(err.message || String(err), true); }
}

// escolher o parafuso preenche a arruela e a porca do mesmo diâmetro
document.addEventListener('change', ev => {
  const t = ev.target;
  if (!t || !t.matches) return;
  if (t.matches('[data-fx-tag]')) {
    const tr = t.closest('tr'), k = vcKitDoParafuso(t.value);
    const arr = tr.querySelector('[data-fx-arr]'), pca = tr.querySelector('[data-fx-pca]');
    if (arr && !arr.value && k.arruela) arr.value = k.arruela;
    if (pca && !pca.value && k.porca) pca.value = k.porca;
    return;
  }
  if (t.matches('[data-vc-ativtodas]')) { VC.ativTodas = t.checked; return renderVinculos(); }
  if (t.matches('[data-vc-extra]') && t.value) { VC.extras.add(t.value); VC.abertas.add(t.value); VC.abertasFx.add(t.value); return renderVinculos(); }
});
// lembra quais atividades estão abertas (o quadro é redesenhado depois de gravar)
document.addEventListener('toggle', ev => {
  const d = ev.target;
  if (!d || !d.matches) return;
  if (d.matches('details[data-vc-ativ]')) d.open ? VC.abertas.add(d.dataset.vcAtiv) : VC.abertas.delete(d.dataset.vcAtiv);
  else if (d.matches('details[data-vc-fx]')) d.open ? VC.abertasFx.add(d.dataset.vcFx) : VC.abertasFx.delete(d.dataset.vcFx);
}, true);

document.addEventListener('click', ev => {
  const t = ev.target && ev.target.closest ? ev.target : null;
  if (!t) return;
  if (t.closest('[data-vc-parafcsv]')) return vcBaixarParafusosCsv();
  if (t.closest('[data-vc-criar-faltantes]')) return vcCriarTagsFaltantes();
  const todas = t.closest('[data-vc-todas]');
  if (todas) {
    if (todas.dataset.vcTodas === 'abrir') document.querySelectorAll('#vcCorpo details[data-vc-ativ]').forEach(d => { d.open = true; VC.abertas.add(d.dataset.vcAtiv); });
    else { document.querySelectorAll('#vcCorpo details[data-vc-ativ]').forEach(d => { d.open = false; }); VC.abertas.clear(); VC.abertasFx.clear(); }
    return;
  }
  const fxAdd = t.closest('[data-fx-add]');
  if (fxAdd) { const c = document.querySelector(`[data-fx-corpo="${CSS.escape(fxAdd.dataset.fxAdd)}"]`); if (c) c.insertAdjacentHTML('beforeend', vcFxLinhaHtml()); return; }
  const fxDel = t.closest('[data-fx-del]');
  if (fxDel) { const tr = fxDel.closest('tr'); if (tr) tr.remove(); return; }
  const fxSug = t.closest('[data-fx-sug]');
  if (fxSug) {
    const box = document.querySelector(`[data-fx-sugestoes="${CSS.escape(fxSug.dataset.fxSug)}"]`);
    if (box) { if (box.hidden) { box.innerHTML = vcSugestoesFx(fxSug.dataset.fxSug); box.hidden = false; } else box.hidden = true; }
    return;
  }
  const fxUsar = t.closest('[data-fx-usar]');
  if (fxUsar) {
    const c = document.querySelector(`[data-fx-corpo="${CSS.escape(fxUsar.dataset.fxKey)}"]`);
    if (c) { try { c.insertAdjacentHTML('beforeend', vcFxLinhaHtml(JSON.parse(fxUsar.dataset.fxUsar))); toast('Fixador adicionado à lista. Confira e clique em Salvar.'); } catch (e) { console.error(e); } }
    return;
  }
  const fxSalvar = t.closest('[data-fx-salvar]');
  if (fxSalvar) return vcSalvarFixadores(fxSalvar.dataset.fxSalvar);
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
