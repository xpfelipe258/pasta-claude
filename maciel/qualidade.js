'use strict';
// ------------------------------------------------------------------------------------------------
// QUALIDADE — não conformidades (NC) por empresa: o que é, onde (local), quem responde, gravidade, prazo, ação corretiva e fotos.
// Cada empresa enxerga só as próprias NCs (usuário de empresa); a gestão vê todas. Relatórios: geral/por empresa e a ficha individual (RNC).
// Gravação: rota `qualidade` (api.php › acao_qualidade) e fotos em nc_foto.php. Depende de app.js, rel_empresa.js e template_doc.js.
// ------------------------------------------------------------------------------------------------

const QUAL = { emp: '', sit: '', grav: '', busca: '', fotosPend: [] };
const QUAL_FOTO = 'nc_foto.php';
const QUAL_SIT = { aberta: 'Aberta', tratamento: 'Em tratamento', encerrada: 'Encerrada' };
const QUAL_GRAV = { baixa: 'Baixa', media: 'Média', alta: 'Alta', critica: 'Crítica' };
const QUAL_COR_SIT = { aberta: 'vermelho', tratamento: 'amarelo', encerrada: 'verde' };
const QUAL_COR_GRAV = { baixa: 'verde', media: 'amarelo', alta: 'vermelho', critica: 'vermelho' };

const qualSomenteLeitura = () => document.body.classList.contains('somente-leitura');
const qualMinhaEmpresa = () => (window.USUARIO_EMPRESA || '').trim();
const qualEhAdmin = () => !!(D && D.usuario && D.usuario.perfil === 'admin');
const qualTodas = () => (T.nao_conformidades || []).slice();
const qualFotosDe = id => (T.nc_fotos || []).filter(f => f.nc_id === id).sort((a, b) => (a.ordem || 0) - (b.ordem || 0) || a.linha - b.linha);
const qualVencida = n => !!n.prazo && n.situacao !== 'encerrada' && n.prazo < hoje();
const qualEmpresas = () => {
  const minha = qualMinhaEmpresa();
  if (minha) return [minha];
  return [...new Set([...(M.empresas || []).map(e => e.nome), ...qualTodas().map(n => n.empresa).filter(Boolean)])].sort((a, b) => a.localeCompare(b, 'pt'));
};
function qualFiltradas() {
  const q = ganNorm(QUAL.busca || '');
  return qualTodas().filter(n => (!QUAL.emp || n.empresa === QUAL.emp)
    && (!QUAL.sit || (QUAL.sit === 'vencida' ? qualVencida(n) : QUAL.sit === 'aberto' ? n.situacao !== 'encerrada' : n.situacao === QUAL.sit))
    && (!QUAL.grav || n.gravidade === QUAL.grav)
    && (!q || ganNorm([n.codigo, n.titulo, n.descricao, n.local, n.responsavel, n.empresa, n.acao].join(' ')).includes(q)))
    .sort((a, b) => (b.data || '').localeCompare(a.data || '') || (b.codigo || '').localeCompare(a.codigo || '', 'pt', { numeric: true }));
}
const qualResumo = lista => ({
  total: lista.length, abertas: lista.filter(n => n.situacao === 'aberta').length, trat: lista.filter(n => n.situacao === 'tratamento').length,
  enc: lista.filter(n => n.situacao === 'encerrada').length, venc: lista.filter(qualVencida).length,
  graves: lista.filter(n => n.situacao !== 'encerrada' && (n.gravidade === 'alta' || n.gravidade === 'critica')).length,
});
const qualSelo = (txt, cor) => `<span class="farol f-${cor}">${esc(txt)}</span>`;

function qualAtualizarContador() {
  const el = document.getElementById('ncCont');
  if (!el) return;
  const n = qualTodas().filter(x => x.situacao !== 'encerrada').length;
  el.hidden = !n; el.textContent = n;
}

// ---------------------------------------------------------------- tela
function renderQualidade() {
  const corpo = $('#qualCorpo');
  if (!corpo) return;
  const ae = document.activeElement;
  if (ae && ae.id === 'qualBusca') return;   // quem está digitando na busca não é interrompido
  qualAtualizarContador();
  const todas = qualTodas(), lista = qualFiltradas(), r = qualResumo(todas.filter(n => !QUAL.emp || n.empresa === QUAL.emp));
  const empresas = qualEmpresas();
  const tile = (rot, val, sub, cc) => `<div class="tile" style="--c:${cc}"><div class="rot"><span>${rot}</span></div><div class="val">${val}</div><div class="sub">${sub}</div></div>`;
  const porEmp = empresas.map(e => ({ emp: e, ...qualResumo(todas.filter(n => n.empresa === e)) }));
  corpo.innerHTML = `
    <div class="barra-acoes">
      <button class="btn primario" id="qualNova">+ Nova não conformidade</button>
      <button class="btn" id="qualRel" title="Relatório de não conformidades (geral ou por empresa, com fotos)">Relatório de não conformidades</button>
      <span class="nota">Cada empresa vê só as próprias não conformidades. Registre o que foi encontrado, onde, quem responde e anexe fotos.</span>
    </div>
    ${empresas.length > 1 ? `<div class="seg qual-seg" id="qualSegEmp"><button type="button" data-qual-emp="" class="${QUAL.emp ? '' : 'ativa'}">Todas as empresas (${todas.length})</button>${porEmp.map(p => `<button type="button" data-qual-emp="${esc(p.emp)}" class="${QUAL.emp === p.emp ? 'ativa' : ''}">${esc(p.emp)} (${p.total}${p.total - p.enc ? ` · ${p.total - p.enc} em aberto` : ''})</button>`).join('')}</div>` : ''}
    <div class="tiles">
      ${tile('Não conformidades', nf(r.total, 0), QUAL.emp ? esc(QUAL.emp) : 'todas as empresas', 'var(--acento)')}
      ${tile('Abertas', nf(r.abertas, 0), 'ainda sem tratativa', 'var(--vermelho)')}
      ${tile('Em tratamento', nf(r.trat, 0), 'ação corretiva em andamento', 'var(--amarelo)')}
      ${tile('Encerradas', nf(r.enc, 0), r.total ? `${nf(r.enc / r.total * 100, 0)}% do total` : '—', 'var(--verde)')}
      ${tile('Vencidas', nf(r.venc, 0), 'prazo passou e não encerrou', r.venc ? 'var(--vermelho)' : 'var(--verde)')}
      ${tile('Graves em aberto', nf(r.graves, 0), 'gravidade alta ou crítica', r.graves ? 'var(--vermelho)' : 'var(--verde)')}
    </div>
    ${!QUAL.emp && empresas.length > 1 ? `<div class="bloco"><div class="bloco-cab"><h2>Por empresa</h2></div><div class="tabela-rolagem"><table data-sem-ferramentas><thead><tr><th>Empresa</th><th class="n">Total</th><th class="n">Abertas</th><th class="n">Em tratamento</th><th class="n">Encerradas</th><th class="n">Vencidas</th><th class="n">% encerradas</th></tr></thead><tbody>
      ${porEmp.map(p => `<tr><td><b>${esc(p.emp)}</b></td><td class="n">${p.total}</td><td class="n">${p.abertas}</td><td class="n">${p.trat}</td><td class="n">${p.enc}</td><td class="n">${p.venc ? `<b style="color:var(--vermelho)">${p.venc}</b>` : 0}</td><td class="n">${p.total ? nf(p.enc / p.total * 100, 0) + '%' : '—'}</td></tr>`).join('')}
    </tbody></table></div></div>` : ''}
    <div class="bloco">
      <div class="bloco-cab"><h2>Não conformidades</h2>
        <div class="qual-filtros">
          <select id="qualSit"><option value="">Todas as situações</option><option value="aberto" ${QUAL.sit === 'aberto' ? 'selected' : ''}>Em aberto (abertas + em tratamento)</option>${Object.entries(QUAL_SIT).map(([k, v]) => `<option value="${k}" ${QUAL.sit === k ? 'selected' : ''}>${v}</option>`).join('')}<option value="vencida" ${QUAL.sit === 'vencida' ? 'selected' : ''}>Vencidas</option></select>
          <select id="qualGrav"><option value="">Todas as gravidades</option>${Object.entries(QUAL_GRAV).map(([k, v]) => `<option value="${k}" ${QUAL.grav === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
          <input type="search" id="qualBusca" placeholder="Buscar código, local, responsável…" value="${esc(QUAL.busca)}">
        </div>
      </div>
      <div class="tabela-rolagem"><table id="tabQual"><thead><tr><th>Código</th><th>Data</th><th>Empresa</th><th>Não conformidade</th><th>Local</th><th>Responsável</th><th>Gravidade</th><th>Situação</th><th>Prazo</th><th class="n">Fotos</th><th></th></tr></thead><tbody>
        ${lista.length ? lista.map(n => {
          const fts = qualFotosDe(n.linha), venc = qualVencida(n);
          return `<tr><td><b>${esc(n.codigo || '')}</b></td><td>${fdA(n.data)}</td><td>${esc(n.empresa || '')}</td>
            <td><a href="#" class="link" data-qual-abrir="${n.linha}"><b>${esc(n.titulo || '')}</b></a>${n.descricao ? `<div class="nota qual-desc">${esc(n.descricao)}</div>` : ''}</td>
            <td>${esc(n.local || '')}</td><td>${esc(n.responsavel || '')}</td>
            <td>${qualSelo(QUAL_GRAV[n.gravidade] || n.gravidade || '—', QUAL_COR_GRAV[n.gravidade] || 'amarelo')}</td>
            <td>${qualSelo(QUAL_SIT[n.situacao] || n.situacao || '—', QUAL_COR_SIT[n.situacao] || 'amarelo')}${n.situacao === 'encerrada' && n.encerrada_em ? `<div class="nota">em ${fdA(n.encerrada_em)}</div>` : ''}</td>
            <td>${n.prazo ? fdA(n.prazo) : '—'}${venc ? ` <span class="farol f-vermelho">VENCIDA</span>` : ''}</td>
            <td class="n">${fts.length ? `📷 ${fts.length}` : '—'}</td>
            <td class="qual-acoes"><button class="btn" data-qual-abrir="${n.linha}">${qualSomenteLeitura() ? 'Abrir' : 'Editar'}</button> <button class="btn" data-qual-rnc="${n.linha}" title="Relatório desta não conformidade, com fotos">Relatório</button></td></tr>`;
        }).join('') : `<tr><td colspan="11" class="vazio">${todas.length ? 'Nenhuma não conformidade com estes filtros.' : 'Nenhuma não conformidade registrada ainda. Use “+ Nova não conformidade”.'}</td></tr>`}
      </tbody></table></div>
    </div>`;
}

// ---------------------------------------------------------------- cadastro (janela)
function qualReduzir(arq, max = 1600, qualidade = 0.82) {   // reduz e converte para JPEG antes de enviar (foto de celular tem vários MB)
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
async function qualEnviarFoto(ncId, arq) {
  const blob = await qualReduzir(arq);
  const r = await fetch(`${QUAL_FOTO}?acao=enviar&nc=${ncId}&nome=${encodeURIComponent(arq.name)}`, { method: 'POST', headers: { 'X-CSRF-Token': window.CSRF_TOKEN || '', 'Content-Type': 'image/jpeg' }, body: blob });
  const j = await r.json().catch(() => ({ erro: 'Resposta inválida do servidor.' }));
  if (!r.ok) throw new Error(j.erro || 'falha no envio');
}

function qualDialogo() {
  let d = document.getElementById('dlgNC');
  if (!d) {
    d = document.createElement('dialog'); d.id = 'dlgNC'; d.className = 'qual-dialog';
    document.body.appendChild(d);
    d.addEventListener('click', ev => { if (ev.target === d && !d._sujo) d.close(); });
  }
  return d;
}
function qualAbrir(id) {
  const n = id ? qualTodas().find(x => x.linha === id) : null;
  const d = qualDialogo(), ro = qualSomenteLeitura(), minha = qualMinhaEmpresa();
  QUAL.fotosPend = [];
  d._id = n ? n.linha : null; d._sujo = false;
  const empresas = qualEmpresas();
  const locais = [...new Set(qualTodas().map(x => x.local).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt'));
  const resps = [...new Set(qualTodas().map(x => x.responsavel).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt'));
  const v = (k, pad = '') => esc(n ? (n[k] ?? '') : pad);
  const empSel = n ? n.empresa : (minha || QUAL.emp || '');
  d.innerHTML = `<form method="dialog" id="formNC" class="qual-form" autocomplete="off">
    <h3>${n ? `Não conformidade ${esc(n.codigo || '')}` : 'Nova não conformidade'}</h3>
    ${n ? `<p class="nota">Registrada por ${esc(n.por || '—')}${n.em ? ' em ' + fdA(String(n.em).slice(0, 10)) + ' às ' + String(n.em).slice(11, 16) : ''}</p>` : ''}
    <div class="qual-grade">
      <label>Empresa<select name="empresa" required ${minha || ro ? 'disabled' : ''}>${minha ? '' : '<option value="">— escolha —</option>'}${empresas.map(e => `<option value="${esc(e)}" ${e === empSel ? 'selected' : ''}>${esc(e)}</option>`).join('')}</select></label>
      <label>Data<input type="date" name="data" value="${v('data', hoje())}" ${ro ? 'disabled' : ''} required></label>
      <label class="qual-larga">Não conformidade (resumo)<input name="titulo" maxlength="255" value="${v('titulo')}" placeholder="Ex.: Solda sem acabamento na viga VC-12" required ${ro ? 'disabled' : ''}></label>
      <label class="qual-larga">Descrição detalhada<textarea name="descricao" rows="3" placeholder="O que foi encontrado, em que condição, requisito não atendido…" ${ro ? 'disabled' : ''}>${v('descricao')}</textarea></label>
      <label>Local da não conformidade<input name="local" list="qualLocais" value="${v('local')}" placeholder="Ex.: Galpão — eixo 05, fileira C" required ${ro ? 'disabled' : ''}><datalist id="qualLocais">${locais.map(x => `<option value="${esc(x)}">`).join('')}</datalist></label>
      <label>Responsável<input name="responsavel" list="qualResps" value="${v('responsavel')}" placeholder="Quem responde pela correção" required ${ro ? 'disabled' : ''}><datalist id="qualResps">${resps.map(x => `<option value="${esc(x)}">`).join('')}</datalist></label>
      <label>Gravidade<select name="gravidade" ${ro ? 'disabled' : ''}>${Object.entries(QUAL_GRAV).map(([k, t]) => `<option value="${k}" ${(n ? n.gravidade : 'media') === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label>Situação<select name="situacao" ${ro ? 'disabled' : ''}>${Object.entries(QUAL_SIT).map(([k, t]) => `<option value="${k}" ${(n ? n.situacao : 'aberta') === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label>Prazo para corrigir<input type="date" name="prazo" value="${v('prazo')}" ${ro ? 'disabled' : ''}></label>
      <label class="qual-larga">Ação corretiva / tratativa <span class="nota">(obrigatória para encerrar)</span><textarea name="acao" rows="3" placeholder="O que foi (ou será) feito para corrigir e evitar repetição" ${ro ? 'disabled' : ''}>${v('acao')}</textarea></label>
    </div>
    <div class="qual-fotos-bloco"><div class="bloco-cab"><h4>Fotos</h4>${ro ? '' : `<label class="btn primario qual-up">+ Anexar fotos<input type="file" id="qualArq" accept="image/*" multiple hidden></label>`}</div>
      <div id="qualFotos" class="qual-fotos"></div></div>
    <div class="qual-rodape"><span class="nota" id="qualMsg"></span>
      <button type="button" class="btn" id="qualFechar">Fechar</button>${n && !ro && (qualEhAdmin() || n.por === (D.usuario && D.usuario.nome)) ? '<button type="button" class="btn qual-excluir" id="qualExcluir">Excluir</button>' : ''}
      ${ro ? '' : '<button type="submit" class="btn primario" id="qualSalvar">Salvar</button>'}</div>
  </form>`;
  qualDesenharFotos();
  d.showModal();
  d.querySelector('input[name=titulo]')?.focus();
}
function qualDesenharFotos() {
  const d = document.getElementById('dlgNC'), box = d && d.querySelector('#qualFotos');
  if (!box) return;
  const ro = qualSomenteLeitura();
  const salvas = d._id ? qualFotosDe(d._id) : [];
  box.innerHTML = [
    ...salvas.map((f, i) => `<figure class="qual-foto"><a href="${QUAL_FOTO}?acao=ver&id=${f.linha}" target="_blank" rel="noopener"><img src="${QUAL_FOTO}?acao=ver&id=${f.linha}" loading="lazy" alt="Foto ${i + 1}"></a>
      <textarea rows="2" data-qual-leg="${f.linha}" placeholder="Legenda da foto" ${ro ? 'disabled' : ''}>${esc(f.legenda || '')}</textarea>${ro ? '' : `<button type="button" class="btn" data-qual-fdel="${f.linha}">Excluir foto</button>`}</figure>`),
    ...QUAL.fotosPend.map((p, i) => `<figure class="qual-foto pend"><img src="${p.url}" alt="Nova foto"><div class="nota">${esc(p.arq.name)} — será enviada ao salvar</div><button type="button" class="btn" data-qual-pdel="${i}">Remover</button></figure>`),
  ].join('') || '<p class="nota">Nenhuma foto anexada.</p>';
}
async function qualSalvar(form) {
  const d = document.getElementById('dlgNC'), fd = new FormData(form), campos = Object.fromEntries(fd.entries());
  if (!qualMinhaEmpresa() && !campos.empresa) { toast('Escolha a empresa.', true); return; }
  const btn = form.querySelector('#qualSalvar'), msg = form.querySelector('#qualMsg');
  btn.disabled = true;
  try {
    const j = await postar(API + 'qualidade', { acao: 'salvar', id: d._id, campos });
    let enviadas = 0, falhas = 0;
    for (const p of QUAL.fotosPend) {
      try { msg.textContent = `Enviando foto ${enviadas + falhas + 1} de ${QUAL.fotosPend.length}…`; await qualEnviarFoto(j.id, p.arq); enviadas++; }
      catch (e) { falhas++; toast(`Foto "${p.arq.name}": ${e.message}`, true); }
    }
    QUAL.fotosPend.forEach(p => URL.revokeObjectURL(p.url)); QUAL.fotosPend = [];
    d._sujo = false; d.close();
    await carregar();
    toast(`${j.codigo} ${d._id ? 'atualizada' : 'registrada'}${enviadas ? ` com ${enviadas} foto(s)` : ''}.`);
  } catch (e) { toast(e.message, true); btn.disabled = false; msg.textContent = ''; }
}
async function qualExcluir() {
  const d = document.getElementById('dlgNC'), n = qualTodas().find(x => x.linha === d._id);
  if (!n || !confirm(`Excluir a não conformidade ${n.codigo} e as fotos dela? Não há lixeira.`)) return;
  try { await postar(API + 'qualidade', { acao: 'excluir', id: n.linha }); d.close(); await carregar(); toast(`${n.codigo} excluída.`); }
  catch (e) { toast(e.message, true); }
}
async function qualExcluirFoto(id) {
  if (!confirm('Excluir esta foto?')) return;
  const r = await fetch(`${QUAL_FOTO}?acao=excluir&id=${id}`, { method: 'POST', headers: { 'X-CSRF-Token': window.CSRF_TOKEN || '' } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { toast(j.erro || 'Não foi possível excluir a foto.', true); return; }
  await carregar(); qualDesenharFotos();
}
async function qualSalvarLegenda(ta) {
  const id = +ta.dataset.qualLeg, f = (T.nc_fotos || []).find(x => x.linha === id);
  if (!f || (f.legenda || '') === ta.value.trim()) return;
  const r = await fetch(`${QUAL_FOTO}?acao=legenda&id=${id}`, { method: 'POST', headers: { 'X-CSRF-Token': window.CSRF_TOKEN || '', 'Content-Type': 'application/json' }, body: JSON.stringify({ legenda: ta.value.trim() }) });
  if (!r.ok) { const j = await r.json().catch(() => ({})); toast(j.erro || 'Não foi possível gravar a legenda.', true); return; }
  f.legenda = ta.value.trim();
}
async function qualAdicionarFotos(lista) {
  const d = document.getElementById('dlgNC');
  if (d._id) {   // NC já salva: envia na hora
    let n = 0;
    for (const arq of lista) { try { await qualEnviarFoto(d._id, arq); n++; } catch (e) { toast(`Foto "${arq.name}": ${e.message}`, true); } }
    await carregar(); qualDesenharFotos();
    if (n) toast(`${n} foto(s) anexada(s).`);
  } else {   // NC nova: as fotos esperam o "Salvar"
    lista.forEach(arq => QUAL.fotosPend.push({ arq, url: URL.createObjectURL(arq) }));
    d._sujo = true; qualDesenharFotos();
  }
}

// ---------------------------------------------------------------- relatórios
function qualRelAbrir() {
  let d = document.getElementById('dlgNCRel');
  if (!d) { d = document.createElement('dialog'); d.id = 'dlgNCRel'; d.className = 'qual-dialog qual-dialog-peq'; document.body.appendChild(d); }
  const empresas = qualEmpresas();
  d.innerHTML = `<form method="dialog" id="formNCRel" class="qual-form"><h3>Relatório de não conformidades</h3>
    <div class="qual-grade">
      <label>Empresa<select name="emp" ${qualMinhaEmpresa() ? 'disabled' : ''}>${qualMinhaEmpresa() ? '' : '<option value="">Todas as empresas (uma seção por empresa)</option>'}${empresas.map(e => `<option value="${esc(e)}" ${e === (QUAL.emp || qualMinhaEmpresa()) ? 'selected' : ''}>${esc(e)}</option>`).join('')}</select></label>
      <label>Situação<select name="sit"><option value="">Todas</option><option value="aberto">Em aberto (abertas + em tratamento)</option><option value="encerrada">Encerradas</option><option value="vencida">Vencidas</option></select></label>
      <label>Registradas de<input type="date" name="ini"></label>
      <label>até<input type="date" name="fim"></label>
      <label class="qual-larga check"><input type="checkbox" name="fotos" checked> Incluir as fotos e as fichas detalhadas</label>
    </div>
    <div class="qual-rodape"><button type="button" class="btn" id="qualRelFechar">Cancelar</button><button type="submit" class="btn qual-ok">Visualizar relatório</button></div></form>`;
  d.showModal();
}
async function qualFotoDataUri(id) {   // a foto vai embutida no relatório (a visualização, a impressão e o PDF não dependem da sessão)
  const r = await fetch(`${QUAL_FOTO}?acao=ver&id=${id}`);
  if (!r.ok) throw new Error('foto indisponível');
  const b = await r.blob();
  return new Promise((ok, erro) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.onerror = () => erro(fr.error); fr.readAsDataURL(b); });
}
const QUAL_CSS = `<style>
.nc-ficha{border:1px solid #98a2b3;border-radius:8px;padding:12px 14px;margin:0 0 16px;background:#fff;break-inside:avoid}
.nc-ficha h3{margin:0 0 8px;font-size:15px}.nc-meta{display:grid;grid-template-columns:repeat(3,1fr);gap:6px 14px;margin:0 0 8px;font-size:11.5px}
.nc-meta b{display:block;font-size:9.5px;color:#667085;text-transform:uppercase;letter-spacing:.04em;font-weight:700}
.nc-txt{white-space:pre-wrap;margin:4px 0 8px;font-size:12px}.nc-rot{font-size:10px;color:#667085;text-transform:uppercase;font-weight:700;margin:6px 0 2px}
.nc-fotos{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:8px}.nc-fotos figure{margin:0;border:2px solid #1f3a5f;border-radius:6px;padding:6px;background:#fff;break-inside:avoid}
.nc-fotos .nc-quadro{border:1px solid #98a2b3;background:#f1f5f9;display:flex;align-items:center;justify-content:center;min-height:120px;padding:3px}
.nc-fotos img{max-width:100%;max-height:260px;width:auto;height:auto;display:block}.nc-fotos figcaption{font-size:11px;margin-top:5px}
.nc-assinaturas{display:grid;grid-template-columns:1fr 1fr;gap:42px;margin-top:46px}.nc-assinatura{border-top:1px solid #111;text-align:center;padding-top:6px;font-size:11px}
</style>`;
async function qualHtml(f) {
  const empresaUnica = f.emp || qualMinhaEmpresa();
  let lista = qualTodas().filter(n => (!empresaUnica || n.empresa === empresaUnica)
    && (!f.sit || (f.sit === 'vencida' ? qualVencida(n) : f.sit === 'aberto' ? n.situacao !== 'encerrada' : n.situacao === f.sit))
    && (!f.ini || (n.data || '') >= f.ini) && (!f.fim || (n.data || '') <= f.fim));
  if (f.id) lista = qualTodas().filter(n => n.linha === f.id);
  lista.sort((a, b) => (a.empresa || '').localeCompare(b.empresa || '', 'pt') || (a.codigo || '').localeCompare(b.codigo || '', 'pt', { numeric: true }));
  const r = qualResumo(lista), emps = [...new Set(lista.map(n => n.empresa))];
  const card = (rot, val, sub, cls) => `<div class="card ${cls}"><div class="rot">${rot}</div><div class="val">${val}</div><div class="sub">${sub}</div></div>`;
  const comFotos = f.fotos !== false;
  const uris = new Map();
  if (comFotos) {
    const fotos = lista.flatMap(n => qualFotosDe(n.linha));
    await Promise.all(fotos.map(ft => qualFotoDataUri(ft.linha).then(u => uris.set(ft.linha, u)).catch(() => uris.set(ft.linha, ''))));
  }
  const selo = (t, cor) => `<span class="farol f-${cor}">${esc(t)}</span>`;
  const meta = (rot, val) => `<div><b>${rot}</b>${val}</div>`;
  const ficha = n => {
    const fts = qualFotosDe(n.linha);
    return `<div class="nc-ficha"><h3>${esc(n.codigo || '')} — ${esc(n.titulo || '')}</h3>
      <div class="nc-meta">${meta('Empresa', esc(n.empresa || ''))}${meta('Data', fdA(n.data))}${meta('Local', esc(n.local || '—'))}${meta('Responsável', esc(n.responsavel || '—'))}
        ${meta('Gravidade', selo(QUAL_GRAV[n.gravidade] || n.gravidade, QUAL_COR_GRAV[n.gravidade] || 'amarelo'))}${meta('Situação', selo(QUAL_SIT[n.situacao] || n.situacao, QUAL_COR_SIT[n.situacao] || 'amarelo') + (n.encerrada_em ? ` em ${fdA(n.encerrada_em)}` : ''))}
        ${meta('Prazo', n.prazo ? fdA(n.prazo) + (qualVencida(n) ? ' ' + selo('VENCIDA', 'vermelho') : '') : '—')}${meta('Registrada por', esc(n.por || '—'))}</div>
      ${n.descricao ? `<div class="nc-rot">Descrição</div><div class="nc-txt">${esc(n.descricao)}</div>` : ''}
      ${n.acao ? `<div class="nc-rot">Ação corretiva / tratativa</div><div class="nc-txt">${esc(n.acao)}</div>` : ''}
      ${comFotos && fts.length ? `<div class="nc-rot">Fotos (${fts.length})</div><div class="nc-fotos">${fts.map((ft, i) => `<figure><div class="nc-quadro">${uris.get(ft.linha) ? `<img src="${uris.get(ft.linha)}" alt="Foto ${i + 1}">` : '<span class="nota">foto indisponível</span>'}</div><figcaption><b>Foto ${i + 1} de ${fts.length}</b>${ft.legenda ? ' — ' + esc(ft.legenda) : ' — <i>sem legenda</i>'}</figcaption></figure>`).join('')}</div>` : ''}
    </div>`;
  };
  const tabela = l => `<table><thead><tr><th>Código</th><th>Data</th><th>Não conformidade</th><th>Local</th><th>Responsável</th><th>Gravidade</th><th>Situação</th><th>Prazo</th></tr></thead><tbody>${l.map(n =>
    `<tr><td><b>${esc(n.codigo || '')}</b></td><td>${fdA(n.data)}</td><td>${esc(n.titulo || '')}</td><td>${esc(n.local || '')}</td><td>${esc(n.responsavel || '')}</td><td>${selo(QUAL_GRAV[n.gravidade] || n.gravidade, QUAL_COR_GRAV[n.gravidade] || 'amarelo')}</td><td>${selo(QUAL_SIT[n.situacao] || n.situacao, QUAL_COR_SIT[n.situacao] || 'amarelo')}</td><td>${n.prazo ? fdA(n.prazo) : '—'}${qualVencida(n) ? ' ' + selo('VENCIDA', 'vermelho') : ''}</td></tr>`).join('')}</tbody></table>`;
  const filtroTxt = [empresaUnica ? `Empresa: ${empresaUnica}` : 'Todas as empresas', f.sit ? ({ aberto: 'em aberto', encerrada: 'encerradas', vencida: 'vencidas' })[f.sit] : '', f.ini ? `de ${fdA(f.ini)}` : '', f.fim ? `até ${fdA(f.fim)}` : ''].filter(Boolean).join(' · ');
  const individual = !!f.id;
  const n0 = individual ? lista[0] : null;
  const corpo = `${QUAL_CSS}<section class="emp-sec"><div class="pag">
    <h1>${individual && n0 ? `Relatório de não conformidade ${esc(n0.codigo || '')}` : 'Relatório de não conformidades'}</h1>
    <p class="sub-cab">${esc((D.obra && D.obra.nome) || '')} · ${esc(individual && n0 ? n0.empresa : filtroTxt)}</p>
    ${individual ? '' : `<div class="cards">${card('Não conformidades', nf(r.total, 0), `${nf(emps.length, 0)} empresa(s)`, 'az')}${card('Abertas', nf(r.abertas, 0), 'sem tratativa', 'vm')}${card('Em tratamento', nf(r.trat, 0), 'ação em andamento', 'am')}${card('Encerradas', nf(r.enc, 0), r.total ? nf(r.enc / r.total * 100, 0) + '% do total' : '—', 'vd')}${card('Vencidas', nf(r.venc, 0), `${nf(r.graves, 0)} grave(s) em aberto`, r.venc ? 'vm' : 'vd')}</div>`}
    ${!individual && emps.length > 1 ? `<h2>Resumo por empresa</h2><table><thead><tr><th>Empresa</th><th class="n">Total</th><th class="n">Abertas</th><th class="n">Em tratamento</th><th class="n">Encerradas</th><th class="n">Vencidas</th></tr></thead><tbody>${emps.map(e => { const x = qualResumo(lista.filter(n => n.empresa === e)); return `<tr><td><b>${esc(e)}</b></td><td class="n">${x.total}</td><td class="n">${x.abertas}</td><td class="n">${x.trat}</td><td class="n">${x.enc}</td><td class="n">${x.venc}</td></tr>`; }).join('')}</tbody></table>` : ''}
    ${individual ? (n0 ? ficha(n0) : '<p class="nota">Não conformidade não encontrada.</p>') : (lista.length ? emps.map(e => { const l = lista.filter(n => n.empresa === e); return `<h2>${esc(e)} — ${l.length} não conformidade(s)</h2>${tabela(l)}${comFotos ? `<h3>Fichas — ${esc(e)}</h3>${l.map(ficha).join('')}` : ''}`; }).join('') : '<p class="nota">Nenhuma não conformidade neste filtro.</p>')}
    <div class="nc-assinaturas"><div class="nc-assinatura">Responsável da empresa${individual && n0 ? ' — ' + esc(n0.empresa) : (empresaUnica ? ' — ' + esc(empresaUnica) : '')}<br><span class="nota">Nome, assinatura e data</span></div><div class="nc-assinatura">Qualidade / Gestão da obra<br><span class="nota">Nome, assinatura e data</span></div></div>
  </div></section>`;
  const emp = individual && n0 ? n0.empresa : empresaUnica;
  return tplDocumento({ titulo: individual && n0 ? `RNC — ${n0.codigo}` : 'Relatório de não conformidades', subtitulo: `${(D.obra && D.obra.nome) || ''} — ${individual && n0 ? n0.empresa : filtroTxt}`,
    meta: 'Qualidade: não conformidades, local, responsável, ação corretiva e fotos', corpo, empresa: emp || '' });
}
async function qualGerar(f, btn) {
  const rot = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Montando…'; }
  try { reAbrirPrevia(await qualHtml(f), `Qualidade-${f.id ? 'NC-' + f.id : (f.emp || 'geral')}-${hoje()}.html`, f.id ? 'Relatório de não conformidade' : 'Relatório de não conformidades'); }
  catch (e) { console.error(e); toast('Não foi possível gerar o relatório: ' + (e.message || e), true); }
  finally { if (btn) { btn.disabled = false; btn.textContent = rot; } }
}

// ---------------------------------------------------------------- eventos
document.addEventListener('click', ev => {
  const t = ev.target.closest && ev.target.closest('#qualNova, #qualRel, #qualFechar, #qualExcluir, #qualRelFechar, [data-qual-emp], [data-qual-abrir], [data-qual-rnc], [data-qual-fdel], [data-qual-pdel]');
  if (!t) return;
  if (t.id === 'qualNova') qualAbrir(null);
  else if (t.id === 'qualRel') qualRelAbrir();
  else if (t.id === 'qualFechar') { const d = document.getElementById('dlgNC'); if (!d._sujo || confirm('Descartar o que foi digitado?')) { QUAL.fotosPend.forEach(p => URL.revokeObjectURL(p.url)); QUAL.fotosPend = []; d.close(); } }
  else if (t.id === 'qualExcluir') qualExcluir();
  else if (t.id === 'qualRelFechar') document.getElementById('dlgNCRel').close();
  else if (t.dataset.qualEmp !== undefined) { QUAL.emp = t.dataset.qualEmp; renderQualidade(); }
  else if (t.dataset.qualAbrir) { ev.preventDefault(); qualAbrir(+t.dataset.qualAbrir); }
  else if (t.dataset.qualRnc) qualGerar({ id: +t.dataset.qualRnc, fotos: true }, t);
  else if (t.dataset.qualFdel) qualExcluirFoto(+t.dataset.qualFdel);
  else if (t.dataset.qualPdel !== undefined) { const p = QUAL.fotosPend.splice(+t.dataset.qualPdel, 1)[0]; if (p) URL.revokeObjectURL(p.url); qualDesenharFotos(); }
});
document.addEventListener('submit', ev => {
  if (ev.target.id === 'formNC') { ev.preventDefault(); qualSalvar(ev.target); }
  else if (ev.target.id === 'formNCRel') {
    ev.preventDefault();
    const fd = new FormData(ev.target), d = document.getElementById('dlgNCRel');
    const f = { emp: qualMinhaEmpresa() || fd.get('emp') || '', sit: fd.get('sit') || '', ini: fd.get('ini') || '', fim: fd.get('fim') || '', fotos: fd.get('fotos') === 'on' };
    if (f.ini && f.fim && f.fim < f.ini) { toast('A data final não pode ser antes da inicial.', true); return; }
    d.close(); qualGerar(f, null);
  }
});
document.addEventListener('change', ev => {
  const t = ev.target;
  if (t.id === 'qualSit') { QUAL.sit = t.value; renderQualidade(); }
  else if (t.id === 'qualGrav') { QUAL.grav = t.value; renderQualidade(); }
  else if (t.id === 'qualArq') { const l = [...t.files]; t.value = ''; if (l.length) qualAdicionarFotos(l); }
  else if (t.dataset && t.dataset.qualLeg) qualSalvarLegenda(t);
  else if (t.closest && t.closest('#formNC')) { const d = document.getElementById('dlgNC'); if (d) d._sujo = true; }
});
document.addEventListener('input', ev => {
  if (ev.target.id === 'qualBusca') {
    QUAL.busca = ev.target.value;
    const pos = ev.target.selectionStart;
    clearTimeout(qualBuscaT); qualBuscaT = setTimeout(() => { const ae = document.activeElement; if (ae && ae.id === 'qualBusca') ae.blur(); renderQualidade(); const n = $('#qualBusca'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } }, 250);
  } else if (ev.target.closest && ev.target.closest('#formNC')) { const d = document.getElementById('dlgNC'); if (d) d._sujo = true; }
});
let qualBuscaT = 0;
