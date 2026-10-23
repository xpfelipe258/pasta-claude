'use strict';
// ------------------------------------------------------------------------------------------------
// RELATÓRIO DIÁRIO DE OBRA (RDO): fotos do dia com comentário, observações e dois relatórios.
//   RDO para o CLIENTE: produção por empresa e atividade (sem valores), efetivo, máquinas usadas (sem valores), remessas que chegaram (só o número) e fotos.
//   RDO para a GESTÃO: tudo isso + produzido e gasto em R$ (medição estimada, equipamentos e combustível) + impactos em aberto (só a informação).
// Nada de Suprimentos no RDO além do número da remessa que chegou no dia. Depende de app.js, rel_empresa.js, rel_lanc.js e template_doc.js.
// ------------------------------------------------------------------------------------------------

const RDO = { dia: '' };
const RDO_FOTO = 'rdo_foto.php';

function rdoDia() {
  if (!RDO.dia) { try { RDO.dia = sessionStorage.getItem('rdoDia') || ''; } catch { } }   // lembra o dia ao recarregar a página
  if (!RDO.dia || (M.datas.length && !M.datas.includes(RDO.dia))) {
    const h = hoje();
    RDO.dia = M.datas.includes(ref) ? ref : (M.datas.includes(h) ? h : (M.datas.filter(d => d <= h).pop() || M.datas[0] || h));
  }
  return RDO.dia;
}
function rdoIrParaDia(d) { RDO.dia = d; try { sessionStorage.setItem('rdoDia', d); } catch { } renderRdo(); }
const rdoFotos = d => (T.rdo_fotos || []).filter(f => f.data === d).sort((a, b) => (a.ordem || 0) - (b.ordem || 0) || a.linha - b.linha);
const rdoInfo = d => (T.rdo_dias || []).find(x => x.data === d) || null;
const rdoDiaTxt = d => `${diaSemanaLonga(d)}, ${fdA(d)}`;
function diaSemanaLonga(s) { return ['segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado', 'domingo'][dow(s)] || ''; }
const rdoPodeEditar = () => !document.body.classList.contains('somente-leitura');

// ---------------------------------------------------------------- dados do dia
function rdoProducao(dia) {
  // por empresa: atividades do catálogo (BM) com avanço no dia + serviços lançados na grade que não estão ligados a nenhuma atividade
  const out = [];
  (M.empresas || []).forEach(e => {
    let d = null;
    try { d = lcDados(e.nome, dia, dia); } catch (err) { console.error('RDO produção', e.nome, err); }
    const itens = d ? d.itens : [];   // só atividades do catálogo do BM (serviço solto da grade sem atividade ligada não entra: duplicaria o apontamento)
    if (itens.length) out.push({ emp: e.nome, itens, medicao: d ? d.medicao : 0 });
  });
  return out;
}
// RDO do cliente: atividade igual em empresas diferentes (EJ e CMM têm o mesmo catálogo: EJ-3.1.1-01 = CMM-3.1.1-01) vira UMA linha somada;
// o acumulado e o contratado somam as empresas (inclusive a que não produziu no dia), e o % é do total acumulado ÷ total contratado.
const rdoChaveAtiv = cod => String(cod || '').replace(/^(EJ|CMM)-/, '');
function rdoProducaoSomada(dia, prod) {
  const dias = new Map();
  prod.forEach(p => {
    p.itens.forEach(x => x.ats.forEach(t => {
      const k = rdoChaveAtiv(t.a.codigo);
      const o = dias.get(k) || { k, item: x.it.item, desc: x.it.desc, atividade: t.a.atividade, unidade: t.a.unidade || '', per: 0, real: 0, qtd: 0, emps: [] };
      o.per += t.per; if (!o.emps.includes(p.emp)) o.emps.push(p.emp); dias.set(k, o);
    }));
  });
  (M.empresas || []).forEach(e => {   // acumulado e contratado de todas as empresas que têm a atividade
    let its = [];
    try { its = bmItens(e.nome, dia); } catch (err) { console.error('RDO acumulado', e.nome, err); }
    its.forEach(it => it.ats.forEach(({ a, real }) => {
      const o = dias.get(rdoChaveAtiv(a.codigo));
      if (!o) return;
      o.real += real || 0; o.qtd += Number(a.qtd) || 0;
      if (!o.emps.includes(e.nome)) o.emps.push(e.nome);
    }));
  });
  const porItem = new Map();
  [...dias.values()].forEach(o => { const g = porItem.get(o.item) || { item: o.item, desc: o.desc, ats: [] }; g.ats.push(o); porItem.set(o.item, g); });
  const itens = [...porItem.values()].sort((a, b) => String(a.item).localeCompare(String(b.item), 'pt', { numeric: true }));
  itens.forEach(g => g.ats.sort((a, b) => a.k.localeCompare(b.k, 'pt', { numeric: true })));
  return { itens, n: dias.size };
}
function rdoEfetivo(dia) {
  const por = new Map();
  (T.dp_efetivo || []).filter(r => r.data === dia && (r.quantidade || 0) > 0).forEach(r => {
    const e = normEmp(r.empresa) || 'SEM EMPRESA';
    if (!por.has(e)) por.set(e, []);
    por.get(e).push({ funcao: String(r.funcao || '—').trim(), qtd: r.quantidade || 0, obs: r.obs || '' });
  });
  return [...por.entries()].map(([emp, l]) => ({ emp, linhas: l.sort((a, b) => a.funcao.localeCompare(b.funcao, 'pt')), total: soma0(l, x => x.qtd) })).sort((a, b) => a.emp.localeCompare(b.emp, 'pt'));
}
function rdoRemessas(dia) {
  const dt = (EP && EP.remessas && EP.remessas.datas) || {};
  return Object.entries(dt).filter(([, v]) => v && v.chegada_obra === dia).map(([nome]) => nome).sort((a, b) => a.localeCompare(b, 'pt', { numeric: true }));
}
function rdoMaquinas(dia) {
  try { return relEquipDados('geral', dia, dia, 'todos').linhas; } catch (e) { console.error('RDO máquinas', e); return []; }
}
function rdoApontamentos(dia) {
  const por = new Map();
  (T.apontamentos || []).filter(a => a.data === dia && (a.lanca_producao || '').toUpperCase() !== 'NAO').forEach(a => {
    const k = `${a.empresa || '—'}|${(a.tipo || '').toUpperCase()}`;
    por.set(k, (por.get(k) || 0) + (a.qtd || 1));
  });
  const rot = { JOIST: 'joists içadas', VIGA: 'vigas montadas', FECHAMENTO: 'trechos de fechamento lateral', MARQUISE: 'trechos de marquise', CONTRAVENTAMENTO: 'kits de contraventamento', TELHA: 'telhas instaladas', PERFILAGEM: 'faixas perfiladas', PECA: 'peças montadas (mapa)' };
  return [...por.entries()].map(([k, q]) => { const [emp, tipo] = k.split('|'); return { emp, texto: `${nf(q, 0)} ${rot[tipo] || tipo.toLowerCase()}` }; })
    .sort((a, b) => a.emp.localeCompare(b.emp, 'pt'));
}
function rdoImpactosAbertos(dia) {
  return (M.impactos || []).filter(i => !i.solucionado && (!i.data || !ehISO(i.data) || i.data <= dia)).sort((a, b) => String(a.data || '').localeCompare(String(b.data || '')));
}

// ---------------------------------------------------------------- tela da aba
function renderRdo() {
  const ae = document.activeElement;   // quem está digitando não é interrompido: o modelo já foi atualizado e a tela é refeita ao sair do campo
  if (ae && ae.closest && ae.closest('#rdoCorpo') && /^(INPUT|TEXTAREA)$/.test(ae.tagName) && ae.type !== 'date') return;
  const dia = rdoDia(), fotos = rdoFotos(dia), info = rdoInfo(dia) || {}, pode = rdoPodeEditar();
  const efet = rdoEfetivo(dia), prod = rdoProducao(dia), rem = rdoRemessas(dia), maq = rdoMaquinas(dia);
  const tile = (rot, val, sub, cc) => `<div class="tile" style="--c:${cc}"><div class="rot"><span>${rot}</span></div><div class="val">${val}</div><div class="sub">${sub}</div></div>`;
  const nAtiv = rdoProducaoSomada(dia, prod).n;
  $('#rdoCorpo').innerHTML = `
    <div class="barra-acoes rdo-barra">
      <button class="btn" data-rdo-dia="-1" title="Dia anterior">‹</button>
      <label class="rot-sel">Data do relatório <input type="date" id="rdoData" value="${esc(dia)}" ${M.datas.length ? `min="${esc(M.datas[0])}" max="${esc(M.datas[M.datas.length - 1])}"` : ''}></label>
      <button class="btn" data-rdo-dia="1" title="Próximo dia">›</button>
      <b class="rdo-dia-txt">${esc(rdoDiaTxt(dia))}</b>
    </div>
    <div class="tiles">
      ${tile('Fotos do dia', nf(fotos.length, 0), fotos.length ? `${nf(fotos.filter(f => (f.legenda || '').trim()).length, 0)} com comentário` : 'nenhuma ainda', 'var(--acento)')}
      ${tile('Atividades com produção', nf(nAtiv, 0), `${nf(prod.length, 0)} empresa(s)`, 'var(--verde)')}
      ${tile('Efetivo no dia', nf(soma0(efet, e => e.total), 0), `${nf(efet.length, 0)} empresa(s)`, 'var(--amarelo)')}
      ${tile('Máquinas usadas', nf(new Set(maq.map(m => m.equipamento)).size, 0), rem.length ? `${nf(rem.length, 0)} remessa(s) chegaram` : 'sem remessa no dia', 'var(--acento)')}
    </div>
    <div class="bloco rdo-gerar">
      <div class="bloco-cab"><h2>Gerar o relatório do dia</h2><span class="nota">O sistema reúne tudo o que foi lançado em ${esc(fdA(dia))}. Confira antes de baixar.</span></div>
      <div class="rdo-botoes">
        <button class="btn primario" id="btnRdoCliente">RDO para o cliente</button>
        <button class="btn" id="btnRdoGestao">RDO para a gestão</button>
      </div>
      <p class="nota">O <b>RDO do cliente</b> traz produção por empresa e atividade, efetivo, máquinas usadas (sem valores), o número das remessas que chegaram e as fotos — sem financeiro e sem suprimentos.
        O <b>RDO da gestão</b> traz tudo isso + produzido e gasto em R$ e os impactos em aberto.</p>
    </div>
    <div class="bloco">
      <div class="bloco-cab"><h2>Observações do dia</h2><span class="nota">${pode ? 'Gravam sozinhas ao sair do campo.' : 'Somente leitura.'}</span></div>
      <div class="rdo-obs">
        <label>Clima / condição do tempo<input type="text" id="rdoClima" list="rdoClimas" maxlength="120" value="${esc(info.clima || '')}" placeholder="ex.: ensolarado, chuva fraca à tarde" ${pode ? '' : 'disabled'}></label>
        <datalist id="rdoClimas"><option value="Ensolarado"><option value="Nublado"><option value="Chuva fraca"><option value="Chuva forte"><option value="Chuva — serviços paralisados"></datalist>
        <label>Observações para o RDO do cliente<textarea id="rdoObsCli" rows="4" placeholder="O que o cliente deve saber do dia (ocorrências, visitas, liberações…)" ${pode ? '' : 'disabled'}>${esc(info.obs_cliente || '')}</textarea></label>
        <label>Observações só para o RDO da gestão<textarea id="rdoObsGes" rows="4" placeholder="Anotações internas (aparecem apenas no RDO da gestão)" ${pode ? '' : 'disabled'}>${esc(info.obs_gestao || '')}</textarea></label>
      </div>
    </div>
    <div class="bloco">
      <div class="bloco-cab"><h2>Fotos do dia</h2>
        ${pode ? `<label class="btn primario rdo-up">+ Anexar fotos<input type="file" id="rdoArq" accept="image/*" multiple hidden></label>` : ''}</div>
      <p class="nota" id="rdoUpStatus">${fotos.length ? 'Escreva o comentário embaixo de cada foto: ele sai impresso no RDO.' : 'Anexe as fotos do dia (as imagens são reduzidas antes do envio).'}</p>
      <div class="rdo-galeria">
        ${fotos.map((f, i) => `<figure class="rdo-foto"><a href="${RDO_FOTO}?acao=ver&id=${f.linha}" target="_blank" rel="noopener"><img src="${RDO_FOTO}?acao=ver&id=${f.linha}" loading="lazy" alt="Foto ${i + 1}"></a>
          <figcaption><b>Foto ${i + 1}</b>${pode ? ` <button type="button" class="link" data-rdo-del="${f.linha}">excluir</button>` : ''}
            <textarea rows="2" data-rdo-leg="${f.linha}" placeholder="Comentário da foto" ${pode ? '' : 'disabled'}>${esc(f.legenda || '')}</textarea></figcaption></figure>`).join('') || '<p class="vazio">Sem fotos neste dia.</p>'}
      </div>
    </div>`;
}

// ---------------------------------------------------------------- fotos e observações
function rdoReduzir(arq, max = 1600, qualidade = 0.82) {   // reduz e converte para JPEG antes de enviar (foto de celular tem vários MB)
  return new Promise((ok, erro) => {
    const url = URL.createObjectURL(arq), img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob(b => b ? ok(b) : erro(new Error('não consegui reduzir a foto')), 'image/jpeg', qualidade);
    };
    img.onerror = () => { URL.revokeObjectURL(url); erro(new Error('arquivo de imagem inválido')); };
    img.src = url;
  });
}
async function rdoEnviar(lista) {
  const dia = rdoDia(), st = $('#rdoUpStatus');
  let n = 0;
  for (const arq of lista) {
    try {
      if (st) st.textContent = `Enviando ${n + 1} de ${lista.length}: ${arq.name}…`;
      const blob = await rdoReduzir(arq);
      const r = await fetch(`${RDO_FOTO}?acao=enviar&data=${encodeURIComponent(dia)}&nome=${encodeURIComponent(arq.name)}`, { method: 'POST', headers: { 'X-CSRF-Token': window.CSRF_TOKEN || '', 'Content-Type': 'image/jpeg' }, body: blob });
      const j = await r.json().catch(() => ({ erro: 'Resposta inválida do servidor.' }));
      if (!r.ok) throw new Error(j.erro || 'falha no envio');
      n++;
    } catch (e) { toast(`Não foi possível enviar "${arq.name}": ${e.message}`, true); }
  }
  await carregar();
  if (n) toast(`${n} foto(s) anexada(s) ao RDO de ${fdA(dia)}.`);
}
let rdoFila = Promise.resolve();   // gravações em fila: duas edições seguidas não podem criar duas linhas para o mesmo dia
function rdoSalvarObs() {
  const dia = rdoDia();
  rdoFila = rdoFila.then(async () => {
    if (rdoDia() !== dia || !$('#rdoClima')) return;
    const campos = { data: dia, clima: $('#rdoClima').value.trim(), obs_cliente: $('#rdoObsCli').value.trim(), obs_gestao: $('#rdoObsGes').value.trim(), por: (D.usuario && D.usuario.nome) || '' };
    const info = rdoInfo(dia);   // relido a cada vez: a gravação anterior já recarregou o modelo
    if (info && (info.clima || '') === campos.clima && (info.obs_cliente || '') === campos.obs_cliente && (info.obs_gestao || '') === campos.obs_gestao) return;
    if (!info && !campos.clima && !campos.obs_cliente && !campos.obs_gestao) return;
    try { await postar(API + 'registro', { tabela: 'rdo_dias', linha: info ? info.linha : null, campos }); await carregar(); }
    catch (e) { toast(e.message, true); }
  });
  return rdoFila;
}
async function rdoSalvarLegenda(ta) {
  const id = +ta.dataset.rdoLeg, f = (T.rdo_fotos || []).find(x => x.linha === id);
  if (!f || (f.legenda || '') === ta.value.trim()) return;
  try { await postar(API + 'registro', { tabela: 'rdo_fotos', linha: id, campos: { legenda: ta.value.trim() } }); await carregar(); }
  catch (e) { toast(e.message, true); }
}
async function rdoExcluirFoto(id) {
  if (!confirm('Excluir esta foto do RDO?')) return;
  const r = await fetch(`${RDO_FOTO}?acao=excluir&id=${id}`, { method: 'POST', headers: { 'X-CSRF-Token': window.CSRF_TOKEN || '' } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { toast(j.erro || 'Não foi possível excluir a foto.', true); return; }
  await carregar();
}

// ---------------------------------------------------------------- relatório
async function rdoFotoDataUri(id) {   // a foto vai embutida no relatório (assim a visualização, a impressão e o PDF não dependem da sessão)
  const r = await fetch(`${RDO_FOTO}?acao=ver&id=${id}`);
  if (!r.ok) throw new Error('foto indisponível');
  const b = await r.blob();
  return new Promise((ok, erro) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.onerror = () => erro(fr.error); fr.readAsDataURL(b); });
}

const RDO_CSS = `<style>
.rdo-fotos{display:grid;grid-template-columns:1fr 1fr;gap:18px}
.rdo-fotos figure{margin:0;border:3px solid #1f3a5f;border-radius:8px;background:#fff;padding:8px;box-shadow:0 2px 6px rgba(16,24,40,.18);break-inside:avoid}
.rdo-fotos .rdo-quadro{border:1px solid #98a2b3;background:#f1f5f9;display:flex;align-items:center;justify-content:center;min-height:150px;padding:4px}
.rdo-fotos img{max-width:100%;max-height:300px;width:auto;height:auto;display:block}
.rdo-fotos figcaption{padding:8px 4px 2px;font-size:12px;color:#344054;display:flex;gap:8px;align-items:flex-start}
.rdo-fotos figcaption b{background:#1f3a5f;color:#fff;border-radius:3px;padding:1px 7px;white-space:nowrap;font-size:11px}
.rdo-fotos figcaption span{flex:1}
.rdo-sem{color:#667085;font-style:italic}
.rdo-leg{margin:6px 0 8px;font-size:11px}.rdo-leg span{display:inline-flex;align-items:center;gap:5px;margin-right:16px}
.rdo-leg i{width:16px;height:11px;border-radius:2px;display:inline-block;border:1px solid #6b7886}
.rdo-barra-emp{display:flex;height:11px;min-width:150px;border:1px solid #98a2b3;border-radius:3px;overflow:hidden;background:#fecaca}
.rdo-barra-emp i{display:block;height:100%}
.mapa-fig{border:1px solid #d3dbe4;border-radius:4px;padding:6px;background:#fff;margin:6px 0;break-inside:avoid}
</style>`;

// ---------------------------------------------------------------- mapas de montagem do dia
// Três estados, sempre nas mesmas cores: FEITO NO DIA (verde), JÁ TINHA (azul: apontado antes do dia) e FALTA (rosa: ainda não apontado).
const RDO_COR = { dia: '#16a34a', ant: '#60a5fa', antTr: '#2563eb', falta: '#fecaca', faltaTr: '#f87171' };
const RDO_COR_MAPA = { forte: RDO_COR.dia, porEmp: false, ant: RDO_COR.ant, antTr: RDO_COR.antTr, pend: RDO_COR.falta, pendTr: RDO_COR.faltaTr };
const rdoLegenda = (extra = '') => `<div class="rdo-leg"><span><i style="background:${RDO_COR.dia};border-color:#14202b"></i><b>Feito no dia</b></span><span><i style="background:${RDO_COR.ant};border-color:${RDO_COR.antTr}"></i><b>Já tinha</b> (apontado antes do dia)</span><span><i style="background:${RDO_COR.falta};border-color:${RDO_COR.faltaTr}"></i><b>Falta</b> (ainda não apontado)</span>${extra}</div>`;
const rdoBarraEmp = (n, tot) => tot > 0 ? `<div class="rdo-barra-emp" title="verde = feito no dia · azul = já tinha · rosa = falta"><i style="width:${n.ant / tot * 100}%;background:${RDO_COR.ant}"></i><i style="width:${n.per / tot * 100}%;background:${RDO_COR.dia}"></i></div>` : '';

// uma linha da tabela-resumo; n = {per, ant, pend, outra?}
function rdoLinhaMapa(rot, n, un = '', fator = 1) {
  const tot = n.per + n.ant + n.pend + (n.outra || 0), feito = n.per + n.ant, f = v => nf(v * fator, fator === 1 ? 0 : 0) + (un ? ' ' + un : '');
  return `<tr><td><b>${esc(rot)}</b></td><td class="n">${f(tot)}</td><td class="n"><b style="color:#15803d">${f(n.per)}</b></td><td class="n">${f(n.ant)}</td><td class="n"><b style="color:#b42318">${f(n.pend)}</b></td><td class="n">${tot ? nf(feito / tot * 100, 1) + '%' : '—'}</td><td>${rdoBarraEmp(n, tot)}</td></tr>`;
}

// obra antiga (G200): reaproveita os mapas do relatório das empresas, com data de corte = o próprio dia
function rdoMapasLegado(dia) {
  const m = reMapa('', dia, dia, RDO_COR_MAPA);
  if (!m) return null;
  if (m.sem) return { aviso: m.sem };
  const linhas = [], figs = [];
  if (m.planta) {
    linhas.push(rdoLinhaMapa('Joists', m.planta.nJ), rdoLinhaMapa('Vigas', m.planta.nV));
    figs.push(`<h3>Joists e vigas (planta do galpão)</h3><div class="mapa-fig">${m.planta.svg}</div><p class="nota">Cada retângulo é uma joist (43 por rua); os quadrados nos eixos são as vigas.</p>`);
    if (m.contrav) { linhas.push(rdoLinhaMapa('Contraventamento (kits)', m.contrav.n)); figs.push(`<h3>Contraventamento (vista elevada)</h3><div class="mapa-fig">${m.contrav.svg}</div><p class="nota">Cada X é um kit de contraventamento.</p>`); }
  }
  [['Telhas da cobertura (m²)', m.telha], ['Perfilagem das telhas (m²)', m.perfil]].forEach(([rot, t]) => {
    if (!t) return;
    linhas.push(rdoLinhaMapa(rot, t.n, 'm²', t.m2));
    figs.push(`<h3>${esc(rot.replace(' (m²)', ''))} (do eixo 01 ao 20)</h3>` + t.fases.map(f => `<p class="nota"><b>${esc(f.nome)}</b></p><div class="mapa-fig">${f.svg}</div>`).join('') + `<p class="nota">Cada faixa é ${rot.startsWith('Telhas') ? 'uma telha' : 'uma fiada de perfilagem'} (${nf(t.m2, 2)} m²), numerada a partir do eixo 01.</p>`);
  });
  const fora = m.foraMontagem && m.foraMontagem.length ? `<p class="nota"><b>${nf(soma0(m.foraMontagem, a => a.qtd || 1), 0)} peça(s)</b> de joist/viga/contraventamento apontada(s) por empresa que não tem esse serviço ficam em cinza e fora dos totais.</p>` : '';
  const cinza = [m.planta && m.planta.nJ.outra, m.planta && m.planta.nV.outra, m.contrav && m.contrav.n.outra].some(v => v > 0);
  return { linhas, figs, fora, extraLeg: cinza ? `<span><i style="background:${RE_COR_OUTRA}"></i>Apontado por empresa sem esse serviço</span>` : '' };
}

// obra criada pela importação (mapa por peça do IFC): cada peça é "feita" quando tem apontamento em alguma atividade
function rdoMapaPecas(dia) {
  if (typeof moIndice !== 'function' || !MO.dados || !(MO.dados.pecas || []).length) return null;
  const ix = moIndice(), prim = new Map();
  (T.apontamentos || []).filter(a => (a.tipo || '').toUpperCase() === 'PECA' && (!a.data || a.data <= dia)).forEach(a => { const d = a.data || ''; if (!prim.has(a.letra) || d < prim.get(a.letra)) prim.set(a.letra, d); });
  const est = p => (!prim.has(p.guid) ? 'pend' : prim.get(p.guid) === dia ? 'per' : 'ant');
  const fases = MO.dados.fases.filter(f => ix.porFase.has(f.fase)).map(f => {
    const pecas = ix.porFase.get(f.fase), n = { per: 0, ant: 0, pend: 0 };
    pecas.forEach(p => n[est(p)]++);
    return { fase: f.fase, pecas, n };
  });
  const tot = { per: 0, ant: 0, pend: 0 };
  fases.forEach(f => ['per', 'ant', 'pend'].forEach(k => { tot[k] += f.n[k]; }));
  const W = 22, Hh = 18, ML = 44, MT = 30, nx = ix.eixosV.length * 2 - 1, ny = ix.eixosH.length * 2 - 1;
  const svgFase = f => {
    const cel = new Map(), sp = new Map();
    f.pecas.forEach(p => {   // peça sem posição na malha do modelo: uma caixa por produto (serve tanto à versão antiga, semPos, quanto à nova, posicionada)
      const pos = p.posicionada !== undefined ? p.posicionada : !p.semPos, k = pos ? `${p.cx},${p.cy}` : 'SP|' + p.produto, m = pos ? cel : sp;
      if (!m.has(k)) m.set(k, []); m.get(k).push(p);
    });
    const LS = 150, porL = Math.max(1, Math.floor((ML + nx * W - 10) / LS)), altSP = sp.size ? 26 + Math.ceil(sp.size / porL) * 24 : 0;
    const larg = ML + nx * W + 10, alt = MT + ny * Hh + 10 + altSP, yT = cy => MT + (ny - 1 - cy) * Hh;
    let o = `<svg viewBox="0 0 ${larg} ${alt}" style="width:100%;height:auto;font:10px Arial,Helvetica,sans-serif" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(f.fase)}">`;
    ix.eixosV.forEach((e, i) => { const x = ML + i * 2 * W; o += `<line x1="${x + W / 2}" x2="${x + W / 2}" y1="${MT - 6}" y2="${MT + ny * Hh}" stroke="#d0d5dd" stroke-dasharray="2 3"/><text x="${x + W / 2}" y="${MT - 12}" text-anchor="middle" fill="#475467">${esc(e)}</text>`; });
    ix.eixosH.forEach((e, j) => { const y = yT(j * 2); o += `<line x1="${ML - 6}" x2="${larg - 6}" y1="${y + Hh / 2}" y2="${y + Hh / 2}" stroke="#d0d5dd" stroke-dasharray="2 3"/><text x="${ML - 10}" y="${y + Hh / 2 + 4}" text-anchor="end" fill="#475467">${esc(e)}</text>`; });
    // a célula mostra a proporção: rosa = falta (fundo), azul = já tinha (de baixo para cima), verde = feito no dia (em cima do azul)
    const caixa = (x, y, w, h, ps, rot) => {
      const n = { per: 0, ant: 0, pend: 0 }; ps.forEach(p => n[est(p)]++);
      const hA = h * n.ant / ps.length, hP = h * n.per / ps.length;
      return `<g><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="${RDO_COR.falta}"/>` +
        (hA ? `<rect x="${x}" y="${y + h - hA}" width="${w}" height="${hA}" fill="${RDO_COR.ant}"/>` : '') + (hP ? `<rect x="${x}" y="${y + h - hA - hP}" width="${w}" height="${hP}" fill="${RDO_COR.dia}"/>` : '') +
        `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="none" stroke="${n.per ? '#14202b' : n.pend ? RDO_COR.faltaTr : RDO_COR.antTr}" stroke-width="${n.per ? 1.6 : 1}"/>${rot}</g>`;
    };
    cel.forEach((ps, k) => { const [cx, cy] = k.split(',').map(Number), x = ML + cx * W, y = yT(cy); o += caixa(x, y, W - 2, Hh - 2, ps, `<text x="${x + (W - 2) / 2}" y="${y + Hh / 2 + 3}" text-anchor="middle" font-size="8" fill="#101828">${ps.length > 99 ? '99+' : ps.length}</text>`); });
    if (sp.size) {
      const y0 = MT + ny * Hh + 22;
      o += `<text x="${ML}" y="${y0 - 6}" fill="#475467" font-weight="600">Sem posição na malha do modelo</text>`;
      [...sp.entries()].sort((a, b) => a[0].localeCompare(b[0], 'pt')).forEach(([k, ps], i) => { const x = ML + (i % porL) * LS, y = y0 + Math.floor(i / porL) * 24; o += caixa(x, y, LS - 6, 20, ps, `<text x="${x + 6}" y="${y + 14}" font-size="10" fill="#101828">${esc(ps[0].produto.slice(0, 18))} · ${ps.length}</text>`); });
    }
    return o + '</svg>';
  };
  return { fases, tot, svgFase };
}

async function rdoMapasHtml(dia) {
  if (!window._regras_baixa && typeof regrasBaixa === 'function') { regrasBaixa(() => {}); await window._regras_pend; }   // regras e IFC do mapa de montagem
  if (!window._frentes && typeof frentesMontagem === 'function') { frentesMontagem(() => {}); await window._frentes_pend; }
  let linhas = [], figs = [], notas = '', extraLeg = '';
  if (M.mapa_obra && typeof moCarregar === 'function') {   // obra gerada pela importação: mapa por peça
    if (!moCarregar(() => {})) await MO.pend;
    const mp = rdoMapaPecas(dia);
    if (!mp) return '';
    mp.fases.forEach(f => linhas.push(rdoLinhaMapa(f.fase, f.n)));
    linhas.push(rdoLinhaMapa('TOTAL DE PEÇAS', mp.tot));
    const dia_ = mp.fases.filter(f => f.n.per > 0);
    figs = dia_.map(f => `<h3>${esc(f.fase)} — ${nf(f.n.per, 0)} peça(s) no dia</h3><div class="mapa-fig">${mp.svgFase(f)}</div>`);
    notas = `<p class="nota">Peça "feita" = com apontamento em alguma atividade (mapa de apontamento por peça). Cada célula do mapa agrupa as peças do mesmo ponto da malha de eixos e mostra a proporção: verde = feito no dia, azul = já tinha, rosa = falta.${dia_.length ? '' : ' Nenhuma peça foi apontada neste dia, por isso só o resumo é mostrado.'}</p>`;
  } else {
    const lg = (() => { try { return rdoMapasLegado(dia); } catch (e) { console.error('RDO mapas', e); return { aviso: 'Não foi possível montar os mapas: ' + (e.message || e) }; } })();
    if (!lg) return '';
    if (lg.aviso) return `<h2>Mapas de montagem</h2><p class="nota">${esc(lg.aviso)}</p>`;
    ({ linhas, figs } = lg); extraLeg = lg.extraLeg; notas = lg.fora;
  }
  return `<h2>Mapas de montagem — situação em ${esc(fdA(dia))}</h2>
    ${rdoLegenda(extraLeg)}
    <table><thead><tr><th>Frente</th><th class="n">Total</th><th class="n">Feito no dia</th><th class="n">Já tinha</th><th class="n">Falta</th><th class="n">% concluído</th><th>Situação</th></tr></thead><tbody>${linhas.join('') || '<tr><td colspan="7" class="vazio">Sem peças mapeadas.</td></tr>'}</tbody></table>
    ${notas}${figs.join('')}`;
}

async function rdoHtml(dia, modo) {
  await tplLogosCarregar();
  const gestao = modo === 'gestao', info = rdoInfo(dia) || {};
  const prod = rdoProducao(dia), efet = rdoEfetivo(dia), rem = rdoRemessas(dia), maq = rdoMaquinas(dia), fotos = rdoFotos(dia), aps = rdoApontamentos(dia);
  const card = (rot, val, sub, cls) => `<div class="card ${cls}"><div class="rot">${rot}</div><div class="val">${val}</div><div class="sub">${sub}</div></div>`;
  const vazio = (n, t = 'Sem registros neste dia.') => `<tr><td colspan="${n}" class="vazio">${t}</td></tr>`;
  const nAtiv = gestao ? soma0(prod, p => p.itens.reduce((s, x) => s + x.ats.length, 0)) : rdoProducaoSomada(dia, prod).n;
  const totEfet = soma0(efet, e => e.total);
  const maquinas = new Set(maq.filter(m => !ganNorm(m.uso).includes('ABASTECIMENTO') || (m.custo || 0) > 0).map(m => m.equipamento));
  const eq = gestao ? (() => { try { return relEquipDados('geral', dia, dia, 'todos'); } catch (e) { return { empresas: [] }; } })() : null;
  const produzido = soma0(prod, p => p.medicao), gastoEq = eq ? soma0(eq.empresas, e => e.custo) : 0, gastoComb = eq ? soma0(eq.empresas, e => e.comb) : 0;

  // 1. produção do dia. Cliente: atividades iguais somadas entre as empresas (acumulado do total); gestão: por empresa
  let tProd = '', cabProd = '';
  const pc = v => nf(v * 100, 1) + '%';
  if (!gestao) {
    const som = rdoProducaoSomada(dia, prod);
    cabProd = '<th>Atividade</th><th>Un.</th><th class="n">No dia</th><th class="n">Acumulado (total)</th><th class="n">Contratado</th><th class="n">% do total acumulado</th>';
    som.itens.forEach(g => {
      tProd += `<tr class="grupo2"><td colspan="6"><b>${esc(g.item)}</b> ${esc(cap(g.desc))}</td></tr>`;
      g.ats.forEach(o => {
        tProd += `<tr><td>${esc(o.atividade)}${o.emps.length > 1 ? ` <span class="nota">(${esc(o.emps.join(' + '))})</span>` : ''}</td><td>${esc(o.unidade)}</td><td class="n"><b>${nf(o.per, 2)}</b></td><td class="n">${nf(o.real, 2)}</td><td class="n">${o.qtd ? nf(o.qtd, 2) : '—'}</td><td class="n"><b>${o.qtd ? pc(Math.min(o.real / o.qtd, 1)) : '—'}</b></td></tr>`;
      });
    });
  } else {
    cabProd = '<th>Atividade</th><th>Un.</th><th class="n">Contratado</th><th class="n">No dia</th><th class="n">% no dia</th><th class="n">Acumulado</th><th class="n">% executada (acumulado)</th><th class="n">Produzido (R$)</th>';
    prod.forEach(p => {
      tProd += `<tr class="grupo"><td colspan="8"><b>${esc(p.emp)}</b> <span class="nota">· contratado de cada atividade da empresa</span></td></tr>`;
      p.itens.forEach(x => {
        tProd += `<tr class="grupo2"><td colspan="8"><b>${esc(x.it.item)}</b> ${esc(cap(x.it.desc))}</td></tr>`;
        x.ats.forEach(t => {
          const qtd = Number(t.a.qtd) || 0;
          tProd += `<tr><td>${esc(t.a.atividade)}</td><td>${esc(t.a.unidade || '')}</td><td class="n">${qtd ? nf(qtd, 2) : '—'}</td><td class="n"><b>${nf(t.per, 2)}</b></td><td class="n">${qtd ? pc(t.per / qtd) : '—'}</td><td class="n">${nf(t.real, 2)}</td><td class="n"><b>${pc(t.pct)}</b></td><td class="n">${rs2(t.per * t.preco.unit)}</td></tr>`;
        });
      });
    });
  }
  const apHtml = aps.length ? `<h3>Apontamentos de montagem</h3><table><thead><tr><th>Empresa</th><th>Apontado no mapa</th></tr></thead><tbody>${aps.map(a => `<tr><td>${esc(a.emp)}</td><td>${esc(a.texto)}</td></tr>`).join('')}</tbody></table>` : '';

  const mapasHtml = await rdoMapasHtml(dia).catch(e => { console.error('RDO mapas', e); return ''; });

  // 2. efetivo
  const tEfet = efet.map(e => `<tr class="grupo"><td colspan="2"><b>${esc(e.emp)}</b></td><td class="n"><b>${nf(e.total, 0)}</b></td></tr>${e.linhas.map(l => `<tr><td></td><td>${esc(l.funcao)}${l.obs ? ` <span class="nota">${esc(l.obs)}</span>` : ''}</td><td class="n">${nf(l.qtd, 0)}</td></tr>`).join('')}`).join('');

  // 3. máquinas
  const linhasMaq = maq.filter(m => gestao || !ganNorm(m.uso).includes('ABASTECIMENTO') || (m.custo || 0) > 0);
  const tMaq = linhasMaq.map(m => `<tr><td><b>${esc(m.equipamento)}</b></td><td>${esc(m.empresa || '—')}</td><td>${esc(m.uso || '—')}</td><td class="n">${m.qtd ? nf(m.qtd, 2) : '—'}</td><td>${esc(m.operTxt || '—')}</td>${gestao ? `<td class="n">${m.litros ? nf(m.litros, 1) + ' L' : '—'}</td><td class="n">${rs2((m.custo || 0) + (m.comb || 0))}</td>` : ''}</tr>`).join('');

  // 4. fotos (embutidas)
  const uris = await Promise.all(fotos.map(f => rdoFotoDataUri(f.linha).catch(() => '')));
  const tFotos = fotos.map((f, i) => `<figure><div class="rdo-quadro">${uris[i] ? `<img src="${uris[i]}" alt="Foto ${i + 1}">` : '<div class="rdo-sem" style="padding:30px">foto indisponível</div>'}</div><figcaption><b>Foto ${i + 1} de ${fotos.length}</b><span>${f.legenda ? esc(f.legenda) : '<i class="rdo-sem">sem comentário</i>'}</span></figcaption></figure>`).join('');

  // gestão: impactos em aberto (só a informação)
  const imp = gestao ? rdoImpactosAbertos(dia) : [];
  const tImp = imp.map(i => `<tr><td>${esc(i.data ? fdA(i.data) : '—')}</td><td>${esc(i.servico || '—')}</td><td>${esc(i.empresas || '—')}</td><td>${esc(i.setor || '—')}</td><td>${esc(i.motivo || '—')}${i.paralisacao ? `<br><span class="nota">${esc(i.paralisacao)}</span>` : ''}</td><td>${esc(i.tempo || '—')}${i.quando ? ` · ${esc(i.quando)}` : ''}</td></tr>`).join('');

  const corpo = `${RDO_CSS}<section class="emp-sec"><div class="pag">
    <h1>${esc((D.obra && D.obra.nome) || '')}</h1><p class="sub-cab">${esc(rdoDiaTxt(dia))}${info.clima ? ` · Clima: ${esc(info.clima)}` : ''}</p>
    <div class="cards">
      ${card('Atividades com produção', nf(nAtiv, 0), `${nf(prod.length, 0)} empresa(s)`, 'vd')}
      ${card('Efetivo no dia', nf(totEfet, 0), `${nf(efet.length, 0)} empresa(s)`, 'az')}
      ${card('Máquinas usadas', nf(maquinas.size, 0), 'equipamentos com uso lançado', 'am')}
      ${card('Fotos', nf(fotos.length, 0), rem.length ? `${nf(rem.length, 0)} remessa(s) chegaram` : 'sem chegada de remessa', 'vm')}
      ${gestao ? card('Produzido no dia', rs2(produzido), 'medição estimada (qtd × preço do BM)', 'vd') : ''}
      ${gestao ? card('Gasto no dia', rs2(gastoEq + gastoComb), `equipamentos ${rs2(gastoEq)} + combustível ${rs2(gastoComb)}`, 'vm') : ''}
    </div>
    ${(gestao ? info.obs_cliente || info.obs_gestao : info.obs_cliente) ? `<h2>Observações do dia</h2>${info.obs_cliente ? `<p>${esc(info.obs_cliente).replace(/\n/g, '<br>')}</p>` : ''}${gestao && info.obs_gestao ? `<p><b>Gestão:</b> ${esc(info.obs_gestao).replace(/\n/g, '<br>')}</p>` : ''}` : ''}
    <h2>${gestao ? 'Produção do dia por empresa e atividade' : 'Produção do dia e avanço acumulado (empresas somadas)'}</h2>
    <table><thead><tr>${cabProd}</tr></thead><tbody>${tProd || vazio(gestao ? 8 : 6, 'Nenhuma produção lançada neste dia.')}</tbody>
      ${gestao && prod.length ? `<tfoot><tr><th colspan="7">Total produzido no dia (medição estimada)</th><th class="n">${rs2(produzido)}</th></tr></tfoot>` : ''}</table>
    ${gestao ? '' : '<p class="nota">Atividades iguais executadas por mais de uma empresa (EJ e CMM) aparecem somadas: o acumulado e o contratado são os totais das empresas, e o % é o avanço do total.</p>'}
    ${gestao ? apHtml : ''}
    ${mapasHtml}
    <h2>Efetivo</h2>
    <table><thead><tr><th>Empresa</th><th>Função</th><th class="n">Pessoas</th></tr></thead><tbody>${tEfet || vazio(3, 'Sem efetivo lançado neste dia.')}</tbody>${efet.length ? `<tfoot><tr><th colspan="2">Total do dia</th><th class="n">${nf(totEfet, 0)}</th></tr></tfoot>` : ''}</table>
    <h2>Máquinas e equipamentos</h2>
    <table><thead><tr><th>Equipamento</th><th>Empresa</th><th>Uso</th><th class="n">Qtd.</th><th>Operador</th>${gestao ? '<th class="n">Litros</th><th class="n">Gasto (R$)</th>' : ''}</tr></thead><tbody>${tMaq || vazio(gestao ? 7 : 5, 'Nenhum equipamento com uso lançado neste dia.')}</tbody>
      ${gestao && linhasMaq.length ? `<tfoot><tr><th colspan="6">Gasto de equipamentos e combustível lançado no dia</th><th class="n">${rs2(gastoEq + gastoComb)}</th></tr></tfoot>` : ''}</table>
    ${gestao ? '<p class="nota">Locação mensal fixa não é rateada por dia neste relatório: só entram os usos e abastecimentos lançados no dia.</p>' : ''}
    <h2>Chegada de material</h2>
    ${rem.length ? `<p>Remessa(s) que chegaram na obra neste dia: <b>${rem.map(esc).join('</b>, <b>')}</b>.</p>` : '<p class="rdo-sem">Nenhuma remessa chegou na obra neste dia.</p>'}
    ${gestao ? `<h2>Impactos em aberto</h2>
    <table><thead><tr><th>Data</th><th>Serviço</th><th>Empresa(s)</th><th>Setor</th><th>Motivo</th><th>Tempo</th></tr></thead><tbody>${tImp || vazio(6, 'Nenhum impacto em aberto.')}</tbody></table>` : ''}
    <h2>Registro fotográfico</h2>
    ${fotos.length ? `<div class="rdo-fotos">${tFotos}</div>` : '<p class="rdo-sem">Sem fotos neste dia.</p>'}
  </div></section>`;
  return tplDocumento({ titulo: gestao ? 'RDO — Gestão' : 'Relatório Diário de Obra (RDO)', subtitulo: `${(D.obra && D.obra.nome) || ''} — ${rdoDiaTxt(dia)}`,
    meta: gestao ? 'Uso interno: produção, efetivo, máquinas, financeiro do dia, impactos em aberto e fotos' : 'Produção, efetivo, máquinas, remessas e fotos do dia', corpo });
}

async function rdoGerar(modo) {
  const dia = rdoDia(), btn = document.getElementById(modo === 'gestao' ? 'btnRdoGestao' : 'btnRdoCliente'), rot = btn.textContent;
  btn.disabled = true; btn.textContent = 'Montando…';
  try {
    reAbrirPrevia(await rdoHtml(dia, modo), `RDO-${modo === 'gestao' ? 'gestao' : 'cliente'}-${dia}.html`, `RDO ${modo === 'gestao' ? 'da gestão' : 'do cliente'} · ${fdA(dia)}`);
  } catch (e) { console.error(e); toast('Não foi possível gerar o RDO: ' + (e.message || e), true); }
  finally { btn.disabled = false; btn.textContent = rot; }
}

document.addEventListener('click', ev => {
  const t = ev.target.closest && ev.target.closest('#btnRdoCliente, #btnRdoGestao, [data-rdo-dia], [data-rdo-del]');
  if (!t) return;
  if (t.id === 'btnRdoCliente') rdoGerar('cliente');
  else if (t.id === 'btnRdoGestao') rdoGerar('gestao');
  else if (t.dataset.rdoDia) rdoIrParaDia(add(rdoDia(), +t.dataset.rdoDia));
  else if (t.dataset.rdoDel) rdoExcluirFoto(+t.dataset.rdoDel);
});
document.addEventListener('change', ev => {
  if (ev.target.id === 'rdoData' && ehISO(ev.target.value)) rdoIrParaDia(ev.target.value);
  else if (ev.target.id === 'rdoArq') { const l = [...ev.target.files]; ev.target.value = ''; if (l.length) rdoEnviar(l); }
  else if (ev.target.id === 'rdoClima') rdoSalvarObs();
});
document.addEventListener('focusout', ev => {
  if (ev.target.id === 'rdoObsCli' || ev.target.id === 'rdoObsGes') rdoSalvarObs();
  else if (ev.target.dataset && ev.target.dataset.rdoLeg) rdoSalvarLegenda(ev.target);
});
