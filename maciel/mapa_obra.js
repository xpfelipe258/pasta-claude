// Apontar montagem por peça — obras criadas pela importação automática.
// O mapa vem do IFC (rota mapa-obra): cada conjunto tem fase, produto, marca e a posição na malha de eixos (V × H).
// Cada célula do mapa agrupa as peças que ficam naquele ponto; clicar seleciona as pendentes da célula e "Salvar" aponta na atividade do BM.
const MO = { dados: null, pend: null, fase: '', produto: '', atividade: '', empresa: '', data: '', regular: false, qtd: '', obs: '', sel: new Map(), cel: null, histSel: new Set(), idx: null };

const moNum = r => { const m = /(\d+)/.exec(String(r || '')); return m ? parseInt(m[1], 10) : 0; };
const moSufixo = r => (/\d+([A-Za-z]*)/.exec(String(r || '')) || [, ''])[1].toLowerCase();
const moOrdEixo = (a, b) => moNum(a) - moNum(b) || moSufixo(a).localeCompare(moSufixo(b));
const moChave = guid => guid;

function moCarregar(refazer) {
  if (MO.dados) return MO.dados;
  if (!MO.pend) {
    MO.pend = fetch(API + 'mapa-obra', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null).then(j => { MO.dados = j || { fases: [], pecas: [], malha: { V: [], H: [] } }; MO.idx = null; });
  }
  MO.pend.then(refazer);
  return null;
}

// índice das peças: eixos reais (malha do IFC + os que as peças citam), célula de cada peça e lista por fase
function moIndice() {
  if (MO.idx) return MO.idx;
  const d = MO.dados;
  const V = new Set(d.malha.V || []), H = new Set(d.malha.H || []);
  d.pecas.forEach(p => { V.add(p[3]); V.add(p[4]); H.add(p[5]); H.add(p[6]); });
  const eixosV = [...V].sort(moOrdEixo), eixosH = [...H].sort(moOrdEixo);
  const iv = new Map(eixosV.map((e, i) => [e, i])), ih = new Map(eixosH.map((e, i) => [e, i]));
  // posição em "meia casa": linha do eixo = índice par, vão entre dois eixos = índice ímpar
  const pecas = d.pecas.map(p => ({ fase: p[0], produto: p[1], marca: p[2], guid: p[7], cx: iv.get(p[3]) + iv.get(p[4]), cy: ih.get(p[5]) + ih.get(p[6]) }));
  const porFase = new Map();
  pecas.forEach(p => { if (!porFase.has(p.fase)) porFase.set(p.fase, []); porFase.get(p.fase).push(p); });
  MO.idx = { eixosV, eixosH, pecas, porFase };
  return MO.idx;
}

const moFases = () => MO.dados.fases.filter(f => moIndice().porFase.has(f.fase));
const moAtividadesDaFase = fase => {
  const f = MO.dados.fases.find(x => x.fase === fase);
  const item = f && f.item;
  return bmTab('bm_atividades').filter(a => item ? a.item === item : true).sort((a, b) => String(a.codigo).localeCompare(String(b.codigo), 'pt', { numeric: true }));
};
const moApontadas = () => {
  // peça|atividade → linha do apontamento
  const m = new Map();
  (T.apontamentos || []).filter(a => (a.tipo || '').toUpperCase() === 'PECA').forEach(a => m.set(a.letra + '|' + a.eixo, a));
  return m;
};

function moGarantirEstado() {
  const fs = moFases();
  if (!MO.fase || !fs.some(f => f.fase === MO.fase)) { MO.fase = fs.length ? (fs.find(f => f.item) || fs[0]).fase : ''; MO.produto = ''; MO.sel = new Map(); MO.cel = null; }
  const ats = moAtividadesDaFase(MO.fase);
  if (!ats.some(a => a.codigo === MO.atividade)) MO.atividade = ats.length ? ats[0].codigo : '';
  if (!MO.empresa) { const at = ats.find(a => a.codigo === MO.atividade); MO.empresa = at ? at.empresa : ((M.empresas[0] || {}).nome || ''); }
  if (!MO.data || (M.datas?.length && !M.datas.includes(MO.data))) {   // a data precisa estar no calendário da obra
    const hj = new Date().toISOString().slice(0, 10), ds = M.datas || [];
    MO.data = !ds.length || ds.includes(hj) ? hj : (hj < ds[0] ? ds[0] : ds[ds.length - 1]);
  }
}

function moPecasVisiveis() {
  const lista = moIndice().porFase.get(MO.fase) || [];
  return MO.produto ? lista.filter(p => p.produto === MO.produto) : lista;
}

// estado de cada peça na atividade escolhida
function moEstadoCelula(pecas, apont) {
  let feitas = 0;
  pecas.forEach(p => { if (apont.has(p.guid + '|' + MO.atividade)) feitas++; });
  return { total: pecas.length, feitas };
}

function moMapaSvg(apont) {
  const ix = moIndice(), W = 22, Hh = 18, ML = 44, MT = 30;
  const nx = ix.eixosV.length * 2 - 1, ny = ix.eixosH.length * 2 - 1;
  const celulas = new Map();
  moPecasVisiveis().forEach(p => { const k = p.cx + ',' + p.cy; if (!celulas.has(k)) celulas.set(k, []); celulas.get(k).push(p); });
  const larg = ML + nx * W + 10, alt = MT + ny * Hh + 10;
  const yTela = cy => MT + (ny - 1 - cy) * Hh;    // eixo H de maior número fica no topo
  let svg = `<svg id="moSvg" viewBox="0 0 ${larg} ${alt}" width="${larg}" height="${alt}" xmlns="http://www.w3.org/2000/svg" style="font:11px system-ui">`;
  ix.eixosV.forEach((e, i) => { const x = ML + i * 2 * W; svg += `<line x1="${x + W / 2}" x2="${x + W / 2}" y1="${MT - 6}" y2="${alt - 6}" stroke="#d0d5dd" stroke-dasharray="2 3"/><text x="${x + W / 2}" y="${MT - 12}" text-anchor="middle" fill="#475467">${esc(e)}</text>`; });
  ix.eixosH.forEach((e, j) => { const y = yTela(j * 2); svg += `<line x1="${ML - 6}" x2="${larg - 6}" y1="${y + Hh / 2}" y2="${y + Hh / 2}" stroke="#d0d5dd" stroke-dasharray="2 3"/><text x="${ML - 10}" y="${y + Hh / 2 + 4}" text-anchor="end" fill="#475467">${esc(e)}</text>`; });
  celulas.forEach((pecas, k) => {
    const [cx, cy] = k.split(',').map(Number), st = moEstadoCelula(pecas, apont);
    const cor = st.feitas === 0 ? '#ffffff' : st.feitas >= st.total ? '#12b76a' : '#fdb022';
    const sel = pecas.some(p => MO.sel.has(p.guid));
    const x = ML + cx * W, y = yTela(cy);
    svg += `<g data-mo-cel="${k}" style="cursor:pointer"><rect x="${x}" y="${y}" width="${W - 2}" height="${Hh - 2}" rx="3" fill="${cor}" stroke="${sel ? '#d97706' : '#667085'}" stroke-width="${sel ? 3 : 1}"/>` +
      `<text x="${x + (W - 2) / 2}" y="${y + Hh / 2 + 3}" text-anchor="middle" font-size="9" fill="${st.feitas >= st.total ? '#fff' : '#101828'}">${st.total > 99 ? '99+' : st.total}</text>` +
      `<title>${esc(`${pecas.length} peça(s) · ${st.feitas} apontada(s) na atividade · ${[...new Set(pecas.map(p => p.produto))].slice(0, 5).join(', ')}`)}</title></g>`;
  });
  return svg + '</svg>';
}

function moResumoProdutos(apont) {
  const por = new Map();
  (MO.dados && moIndice().porFase.get(MO.fase) || []).forEach(p => {
    const o = por.get(p.produto) || { total: 0, feitas: 0 };
    o.total++; if (apont.has(p.guid + '|' + MO.atividade)) o.feitas++;
    por.set(p.produto, o);
  });
  return [...por.entries()].sort((a, b) => b[1].total - a[1].total);
}

function moHtml() {
  const apont = moApontadas();
  const fases = moFases(), ats = moAtividadesDaFase(MO.fase), at = ats.find(a => a.codigo === MO.atividade);
  const lista = moIndice().porFase.get(MO.fase) || [];
  const st = moEstadoCelula(lista, apont);
  const prods = moResumoProdutos(apont);
  const nSel = MO.sel.size;
  const ehUn = at && /^(un|und|unid|pe[cç]a)/i.test(at.unidade || '');
  const qtdSug = nSel && ehUn ? nSel : '';
  const tile = (rot, val, sub) => `<div class="tile"><div class="rot"><span>${rot}</span></div><div class="val">${val}</div><div class="sub">${sub}</div></div>`;
  const opt = (v, r, sel) => `<option value="${esc(v)}" ${v === sel ? 'selected' : ''}>${esc(r)}</option>`;
  const hist = (T.apontamentos || []).filter(a => (a.tipo || '').toUpperCase() === 'PECA').sort((a, b) => (b.data || '').localeCompare(a.data || '') || b.linha - a.linha).slice(0, 80);
  return `<div class="tiles">${tile('Peças da fase', nf(st.total), esc(MO.fase))}${tile('Apontadas na atividade', `${nf(st.feitas)}`, st.total ? nf(st.feitas / st.total * 100, 1) + '% da fase' : '')}${tile('Selecionadas', nf(nSel), nSel ? 'a apontar ao salvar' : 'clique no mapa')}${tile('Apontadas no total', nf((T.apontamentos || []).filter(a => (a.tipo || '').toUpperCase() === 'PECA').length), 'todas as fases e atividades')}</div>
  <div class="bloco pilha">
    <div class="mo-filtros">
      <label>Fase do modelo<select data-mo="fase">${fases.map(f => opt(f.fase, `${f.fase || '(sem fase)'} · ${nf(f.conjuntos)}`, MO.fase)).join('')}</select></label>
      <label>Produto<select data-mo="produto"><option value="">Todos</option>${prods.map(([p, o]) => opt(p, `${p} · ${nf(o.feitas)}/${nf(o.total)}`, MO.produto)).join('')}</select></label>
      <label>Atividade do BM<select data-mo="atividade">${ats.map(a => opt(a.codigo, `${a.codigo} · ${a.atividade}`, MO.atividade)).join('') || '<option value="">(sem atividades)</option>'}</select></label>
      <label>Data<input type="date" data-mo="data" value="${esc(MO.data)}" min="${esc((M.datas || [])[0] || '')}" max="${esc((M.datas || []).slice(-1)[0] || '')}"></label>
      <label>Quantidade a lançar${at ? ` (${esc(at.unidade || 'un')})` : ''}<input type="number" step="any" min="0" data-mo="qtd" value="${esc(MO.qtd !== '' ? MO.qtd : qtdSug)}" placeholder="${nSel && !ehUn ? 'informe' : 'nº de peças'}"></label>
      <label>Observação<input type="text" data-mo="obs" value="${esc(MO.obs)}" maxlength="120"></label>
      <label class="mo-chk"><input type="checkbox" data-mo="regular" ${MO.regular ? 'checked' : ''}> Regularização (não soma produção)</label>
    </div>
    <div class="mo-acoes">
      <button class="btn" data-mo-acao="pendentes">Selecionar todas as pendentes da fase</button>
      <button class="btn" data-mo-acao="limpar">Limpar seleção</button>
      <button class="btn primario" data-mo-acao="salvar" ${nSel && at ? '' : 'disabled'}>Salvar apontamento (${nf(nSel)})</button>
      <span class="nota">${at ? `Atividade: <b>${esc(at.atividade)}</b> · empresa ${esc(at.empresa)} · contrato ${nf(at.qtd, 2)} ${esc(at.unidade || '')}` : 'Escolha uma atividade do catálogo do BM.'}</span>
    </div>
  </div>
  <div class="bloco"><div class="bloco-cab"><h2>Mapa da fase (eixos V × H do projeto)</h2><span class="nota">Branco = pendente · amarelo = parcial · verde = apontado na atividade escolhida · contorno laranja = selecionado. O número é a quantidade de peças naquele ponto.</span></div>
    <div class="tabela-rolagem" id="moMapa">${moMapaSvg(apont)}</div></div>
  <div class="bloco"><div class="bloco-cab"><h2>Produtos da fase</h2></div>
    <div class="tabela-rolagem"><table><thead><tr><th>Produto</th><th class="n">Peças</th><th class="n">Apontadas</th><th class="n">Pendentes</th><th>Avanço</th></tr></thead><tbody>
    ${prods.map(([p, o]) => `<tr><td>${esc(p)}</td><td class="n">${nf(o.total)}</td><td class="n">${nf(o.feitas)}</td><td class="n">${nf(o.total - o.feitas)}</td><td><div class="mo-barra"><i style="width:${o.total ? (o.feitas / o.total * 100) : 0}%"></i></div></td></tr>`).join('') || '<tr><td colspan="5" class="vazio">Sem peças.</td></tr>'}
    </tbody></table></div></div>
  <div class="bloco"><div class="bloco-cab"><h2>Últimos apontamentos por peça</h2><button class="btn" data-mo-acao="excluir" ${MO.histSel.size ? '' : 'disabled'}>Excluir selecionados (${nf(MO.histSel.size)})</button></div>
    <div class="tabela-rolagem"><table><thead><tr><th></th><th>Data</th><th>Empresa</th><th>Atividade</th><th>Fase</th><th>Produto</th><th>Marca</th><th class="n">Lançado</th><th>Produção</th></tr></thead><tbody>
    ${hist.map(a => `<tr><td><input type="checkbox" data-mo-hist="${a.linha}" ${MO.histSel.has(a.linha) ? 'checked' : ''}></td><td>${fdA(a.data)}</td><td>${esc(a.empresa)}</td><td>${esc(a.eixo)}</td><td>${esc(a.rua)}</td><td>${esc(a.faixa)}</td><td>${esc(a.viga_id)}</td><td class="n">${nf(a.qtd, 2)}</td><td>${(a.lanca_producao || '').toUpperCase() === 'SIM' ? 'soma' : 'regularização'}</td></tr>`).join('') || '<tr><td colspan="9" class="vazio">Nenhuma peça apontada ainda.</td></tr>'}
    </tbody></table></div></div>`;
}

function renderApontGenerico() {
  const sec = $('#aba-apont'), box = $('#apGen');
  sec.classList.add('ap-gen-ativo'); box.hidden = false;
  if (!moCarregar(renderApontGenerico)) { box.innerHTML = '<p class="vazio">Carregando o mapa de peças…</p>'; return; }
  if (!MO.dados.pecas.length) { box.innerHTML = '<p class="vazio">O modelo importado não trouxe a posição das peças na malha de eixos.</p>'; return; }
  moGarantirEstado();
  const rolagem = $('#moMapa') ? $('#moMapa').scrollLeft : 0;
  box.innerHTML = moHtml();
  if ($('#moMapa')) $('#moMapa').scrollLeft = rolagem;
}

async function moSalvar() {
  const apont = moApontadas(), at = moAtividadesDaFase(MO.fase).find(a => a.codigo === MO.atividade);
  const pecas = [...MO.sel.values()].filter(p => !apont.has(p.guid + '|' + MO.atividade));
  if (!pecas.length) { toast('Selecione ao menos uma peça pendente no mapa.', true); return; }
  if (!at) { toast('Escolha a atividade do BM.', true); return; }
  const ehUn = /^(un|und|unid|pe[cç]a)/i.test(at.unidade || '');
  if (!ehUn && MO.qtd === '') { toast(`A atividade é medida em ${at.unidade || 'outra unidade'}: informe a quantidade a lançar.`, true); return; }
  try {
    const r = await postar(API + 'apontamento-pecas', { data: MO.data, atividade: at.codigo, lanca_producao: !MO.regular, quantidade: MO.qtd !== '' ? +MO.qtd : null, obs: MO.obs.trim() || null,
      pecas: pecas.map(p => ({ guid: p.guid })) });
    MO.sel = new Map(); MO.qtd = ''; MO.obs = '';
    await carregar();
    toast(`${nf(r.salvos)} peça(s) apontada(s) em ${at.codigo}` + (MO.regular ? ' (regularização: não somou produção).' : ` · lançado ${nf(r.quantidade, 2)} ${r.unidade || ''}.`));
  } catch (e) { toast(e.message, true); }
}

async function moExcluir() {
  const linhas = [...MO.histSel];
  if (!linhas.length) return;
  try { await postar(API + 'apontamento-pecas', { excluir: true, linhas }); MO.histSel = new Set(); await carregar(); toast(`${nf(linhas.length)} apontamento(s) excluído(s) e produção ajustada`); }
  catch (e) { toast(e.message, true); }
}

document.addEventListener('change', ev => {
  const c = ev.target.closest('[data-mo]');
  if (c) {
    const k = c.dataset.mo;
    if (k === 'regular') MO.regular = c.checked;
    else if (k === 'fase') { MO.fase = c.value; MO.produto = ''; MO.sel = new Map(); MO.atividade = ''; MO.empresa = ''; }
    else if (k === 'atividade') { MO.atividade = c.value; MO.empresa = ''; }
    else MO[k] = c.value;
    return renderApontGenerico();
  }
  const h = ev.target.closest('[data-mo-hist]');
  if (h) { const id = +h.dataset.moHist; if (h.checked) MO.histSel.add(id); else MO.histSel.delete(id); renderApontGenerico(); }
});
document.addEventListener('input', ev => {
  const c = ev.target.closest('input[data-mo="qtd"], input[data-mo="obs"]');
  if (c) MO[c.dataset.mo] = c.value;
});
document.addEventListener('click', ev => {
  const cel = ev.target.closest('[data-mo-cel]');
  if (cel) {
    const apont = moApontadas();
    const pecas = moPecasVisiveis().filter(p => `${p.cx},${p.cy}` === cel.dataset.moCel && !apont.has(p.guid + '|' + MO.atividade));
    const todas = pecas.length && pecas.every(p => MO.sel.has(p.guid));
    pecas.forEach(p => { const k = p.guid; if (todas) MO.sel.delete(k); else MO.sel.set(k, p); });
    return renderApontGenerico();
  }
  const b = ev.target.closest('[data-mo-acao]');
  if (!b) return;
  const a = b.dataset.moAcao;
  if (a === 'limpar') { MO.sel = new Map(); renderApontGenerico(); }
  else if (a === 'pendentes') {
    const apont = moApontadas();
    moPecasVisiveis().forEach(p => { if (!apont.has(p.guid + '|' + MO.atividade)) MO.sel.set(p.guid, p); });
    renderApontGenerico();
  }
  else if (a === 'salvar') moSalvar();
  else if (a === 'excluir') moExcluir();
});
