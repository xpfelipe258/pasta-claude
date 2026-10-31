'use strict';
// ------------------------------------------------------------------------------------------------
// QUALIDADE — não conformidades (NC) com resposta da empresa e validação do administrador.
//   1. A GESTÃO registra: empresa responsável, local, descrição, gravidade, fotos "antes" e o PRAZO PARA RESPONDER.
//   2. A EMPRESA responde na própria NC (texto + fotos "depois") dentro do prazo; a NC chega como alerta na aba dela.
//   3. O ADMINISTRADOR valida (a NC fica CONCLUÍDA) ou devolve para correção (volta para a empresa, com o motivo).
// Cada empresa só vê as próprias NCs. Relatórios mostram ANTES × DEPOIS. Gravação: rota `qualidade` (api.php) e fotos em nc_foto.php.
// ------------------------------------------------------------------------------------------------

const QUAL = { emp: '', sit: '', grav: '', busca: '', fotosPend: [] };
const QUAL_FOTO = 'nc_foto.php';
const QUAL_SIT = { aberta: 'Aguardando resposta', respondida: 'Aguardando validação', concluida: 'Concluída' };
const QUAL_GRAV = { baixa: 'Baixa', media: 'Média', alta: 'Alta', critica: 'Crítica' };
const QUAL_COR_SIT = { aberta: 'vermelho', respondida: 'amarelo', concluida: 'verde' };
const QUAL_COR_GRAV = { baixa: 'verde', media: 'amarelo', alta: 'vermelho', critica: 'vermelho' };

const qualSomenteLeitura = () => document.body.classList.contains('somente-leitura');
const qualMinhaEmpresa = () => (window.USUARIO_EMPRESA || '').trim();
const qualEhAdmin = () => !!(D && D.usuario && D.usuario.perfil === 'admin');
const qualTodas = () => (T.nao_conformidades || []).slice();
const qualFotosDe = (id, tipo) => (T.nc_fotos || []).filter(f => f.nc_id === id && (!tipo || (f.tipo || 'antes') === tipo)).sort((a, b) => (a.ordem || 0) - (b.ordem || 0) || a.linha - b.linha);
const qualAtrasada = n => !!n.prazo && n.situacao === 'aberta' && n.prazo < hoje();   // prazo para responder venceu e a empresa ainda não respondeu
const qualDiasPrazo = n => n.prazo ? diasEntre(hoje(), n.prazo) : null;
const qualRespondidaAtraso = n => !!(n.prazo && n.respondida_em && String(n.respondida_em).slice(0, 10) > n.prazo);
function qualPrazoTxt(n) {
  if (!n.prazo) return '—';
  if (n.situacao !== 'aberta') return fdA(n.prazo);
  const d = qualDiasPrazo(n);
  return `${fdA(n.prazo)} <span class="nota">${d < 0 ? `(atrasada há ${-d} dia(s))` : d === 0 ? '(vence hoje)' : `(faltam ${d} dia(s))`}</span>`;
}
const qualEmpresas = () => {
  const minha = qualMinhaEmpresa();
  if (minha) return [minha];
  return [...new Set([...(M.empresas || []).map(e => e.nome), ...qualTodas().map(n => n.empresa).filter(Boolean)])].sort((a, b) => a.localeCompare(b, 'pt'));
};
function qualPassaSit(n, sit) {
  if (!sit) return true;
  if (sit === 'atrasada') return qualAtrasada(n);
  if (sit === 'pendente') return n.situacao !== 'concluida';
  return n.situacao === sit;
}
function qualFiltradas() {
  const q = ganNorm(QUAL.busca || '');
  return qualTodas().filter(n => (!QUAL.emp || n.empresa === QUAL.emp) && qualPassaSit(n, QUAL.sit) && (!QUAL.grav || n.gravidade === QUAL.grav)
    && (!q || ganNorm([n.codigo, n.titulo, n.descricao, n.local, n.responsavel, n.empresa, n.acao].join(' ')).includes(q)))
    .sort((a, b) => (b.data || '').localeCompare(a.data || '') || (b.codigo || '').localeCompare(a.codigo || '', 'pt', { numeric: true }));
}
const qualResumo = lista => ({
  total: lista.length, aguardaResp: lista.filter(n => n.situacao === 'aberta').length, aguardaVal: lista.filter(n => n.situacao === 'respondida').length,
  concl: lista.filter(n => n.situacao === 'concluida').length, atras: lista.filter(qualAtrasada).length,
  graves: lista.filter(n => n.situacao !== 'concluida' && (n.gravidade === 'alta' || n.gravidade === 'critica')).length,
});
const qualSelo = (txt, cor) => `<span class="farol f-${cor}">${esc(txt)}</span>`;
const qualSeloSit = n => qualSelo(QUAL_SIT[n.situacao] || n.situacao || '—', QUAL_COR_SIT[n.situacao] || 'amarelo');

// Contador do menu: empresa = o que ela precisa responder; administrador = o que espera a validação; demais da gestão = respostas atrasadas.
function qualPendencias() {
  const t = qualTodas();
  if (qualMinhaEmpresa()) return t.filter(n => n.situacao === 'aberta');
  if (qualEhAdmin()) return t.filter(n => n.situacao === 'respondida');
  return t.filter(qualAtrasada);
}
function qualAtualizarContador() {
  const el = document.getElementById('ncCont');
  if (!el) return;
  const n = qualPendencias().length;
  el.hidden = !n; el.textContent = n;
}
// Aviso ao entrar no sistema (chamado por app.js): empresa com NC para responder / administrador com respostas para validar
function qualAvisoAoAbrir() {
  const p = qualPendencias();
  if (!p.length) return;
  if (qualMinhaEmpresa()) {
    const atras = p.filter(qualAtrasada).length;
    toast(`⚠ Qualidade: ${p.length} não conformidade(s) aguardando a resposta da ${qualMinhaEmpresa()}${atras ? ` — ${atras} com prazo vencido` : ''}.`, true, 9000);
  } else if (qualEhAdmin()) toast(`Qualidade: ${p.length} resposta(s) de não conformidade aguardando a sua validação.`, false, 7000);
}

// ---------------------------------------------------------------- tela
function qualAlertaHtml() {
  const minha = qualMinhaEmpresa(), t = qualTodas();
  if (minha) {
    const lista = t.filter(n => n.situacao === 'aberta').sort((a, b) => (a.prazo || '9999').localeCompare(b.prazo || '9999'));
    if (!lista.length) return `<div class="qual-alerta ok"><b>✔ Nenhuma não conformidade aguardando a sua resposta.</b></div>`;
    return `<div class="qual-alerta"><b>⚠ ${lista.length} não conformidade(s) aguardando a resposta da ${esc(minha)}</b> — responda com texto e foto dentro do prazo.
      <ul>${lista.map(n => `<li><button class="btn qual-resp" data-qual-abrir="${n.linha}">Responder</button> <b>${esc(n.codigo)}</b> — ${esc(n.titulo)} <span class="nota">(${esc(n.local || '')})</span> · prazo ${qualPrazoTxt(n)}${n.devolucao ? `<div class="qual-devol">↩ ${esc(n.devolucao)}</div>` : ''}</li>`).join('')}</ul></div>`;
  }
  if (qualEhAdmin()) {
    const lista = t.filter(n => n.situacao === 'respondida');
    if (lista.length) return `<div class="qual-alerta val"><b>${lista.length} resposta(s) aguardando a sua validação</b>
      <ul>${lista.map(n => `<li><button class="btn qual-resp" data-qual-abrir="${n.linha}">Validar</button> <b>${esc(n.codigo)}</b> — ${esc(n.titulo)} · ${esc(n.empresa)} · respondida em ${fdA(String(n.respondida_em || '').slice(0, 10))}${qualRespondidaAtraso(n) ? ' <span class="farol f-vermelho">COM ATRASO</span>' : ''}</li>`).join('')}</ul></div>`;
  }
  return '';
}

function renderQualidade() {
  const corpo = $('#qualCorpo');
  if (!corpo) return;
  const ae = document.activeElement;
  if (ae && ae.id === 'qualBusca') return;   // quem está digitando na busca não é interrompido
  qualAtualizarContador();
  const gestao = !qualMinhaEmpresa(), ro = qualSomenteLeitura();
  const todas = qualTodas(), lista = qualFiltradas(), r = qualResumo(todas.filter(n => !QUAL.emp || n.empresa === QUAL.emp));
  const empresas = qualEmpresas();
  const tile = (rot, val, sub, cc) => `<div class="tile" style="--c:${cc}"><div class="rot"><span>${rot}</span></div><div class="val">${val}</div><div class="sub">${sub}</div></div>`;
  const porEmp = empresas.map(e => ({ emp: e, ...qualResumo(todas.filter(n => n.empresa === e)) }));
  corpo.innerHTML = `
    ${qualAlertaHtml()}
    <div class="barra-acoes">
      ${gestao && !ro ? '<button class="btn primario" id="qualNova">+ Nova não conformidade</button>' : ''}
      <button class="btn" id="qualRel" title="Relatório de não conformidades (antes × depois, com fotos)">Relatório de não conformidades</button>
      <span class="nota">${gestao ? 'Registre a não conformidade com o prazo para a empresa responder. A empresa responde com texto e foto; o administrador valida.' : 'Responda cada não conformidade com texto e foto dentro do prazo. O administrador valida a sua resposta.'}</span>
    </div>
    ${empresas.length > 1 ? `<div class="seg qual-seg" id="qualSegEmp"><button type="button" data-qual-emp="" class="${QUAL.emp ? '' : 'ativa'}">Todas as empresas (${todas.length})</button>${porEmp.map(p => `<button type="button" data-qual-emp="${esc(p.emp)}" class="${QUAL.emp === p.emp ? 'ativa' : ''}">${esc(p.emp)} (${p.total}${p.total - p.concl ? ` · ${p.total - p.concl} pendente(s)` : ''})</button>`).join('')}</div>` : ''}
    <div class="tiles">
      ${tile('Não conformidades', nf(r.total, 0), QUAL.emp ? esc(QUAL.emp) : 'todas as empresas', 'var(--acento)')}
      ${tile('Aguardando resposta', nf(r.aguardaResp, 0), 'com a empresa', r.aguardaResp ? 'var(--vermelho)' : 'var(--verde)')}
      ${tile('Aguardando validação', nf(r.aguardaVal, 0), 'com o administrador', r.aguardaVal ? 'var(--amarelo)' : 'var(--verde)')}
      ${tile('Concluídas', nf(r.concl, 0), r.total ? `${nf(r.concl / r.total * 100, 0)}% do total` : '—', 'var(--verde)')}
      ${tile('Resposta atrasada', nf(r.atras, 0), 'prazo venceu sem resposta', r.atras ? 'var(--vermelho)' : 'var(--verde)')}
      ${tile('Graves pendentes', nf(r.graves, 0), 'gravidade alta ou crítica', r.graves ? 'var(--vermelho)' : 'var(--verde)')}
    </div>
    ${!QUAL.emp && empresas.length > 1 ? `<div class="bloco"><div class="bloco-cab"><h2>Por empresa</h2></div><div class="tabela-rolagem"><table data-sem-ferramentas><thead><tr><th>Empresa</th><th class="n">Total</th><th class="n">Aguardando resposta</th><th class="n">Aguardando validação</th><th class="n">Concluídas</th><th class="n">Resposta atrasada</th><th class="n">% concluídas</th></tr></thead><tbody>
      ${porEmp.map(p => `<tr><td><b>${esc(p.emp)}</b></td><td class="n">${p.total}</td><td class="n">${p.aguardaResp}</td><td class="n">${p.aguardaVal}</td><td class="n">${p.concl}</td><td class="n">${p.atras ? `<b style="color:var(--vermelho)">${p.atras}</b>` : 0}</td><td class="n">${p.total ? nf(p.concl / p.total * 100, 0) + '%' : '—'}</td></tr>`).join('')}
    </tbody></table></div></div>` : ''}
    <div class="bloco">
      <div class="bloco-cab"><h2>Não conformidades</h2>
        <div class="qual-filtros">
          <select id="qualSit"><option value="">Todas as situações</option><option value="pendente" ${QUAL.sit === 'pendente' ? 'selected' : ''}>Pendentes (não concluídas)</option>${Object.entries(QUAL_SIT).map(([k, v]) => `<option value="${k}" ${QUAL.sit === k ? 'selected' : ''}>${v}</option>`).join('')}<option value="atrasada" ${QUAL.sit === 'atrasada' ? 'selected' : ''}>Resposta atrasada</option></select>
          <select id="qualGrav"><option value="">Todas as gravidades</option>${Object.entries(QUAL_GRAV).map(([k, v]) => `<option value="${k}" ${QUAL.grav === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
          <input type="search" id="qualBusca" placeholder="Buscar código, local, descrição…" value="${esc(QUAL.busca)}">
        </div>
      </div>
      <div class="tabela-rolagem"><table id="tabQual"><thead><tr><th>Código</th><th>Registrada em</th><th>Empresa</th><th>Não conformidade</th><th>Local</th><th>Gravidade</th><th>Situação</th><th>Prazo para responder</th><th>Resposta</th><th class="n">Fotos</th><th></th></tr></thead><tbody>
        ${lista.length ? lista.map(n => {
          const antes = qualFotosDe(n.linha, 'antes').length, depois = qualFotosDe(n.linha, 'depois').length;
          const acaoRot = n.situacao === 'aberta' && !gestao ? 'Responder' : n.situacao === 'respondida' && qualEhAdmin() ? 'Validar' : (ro || (gestao && n.situacao === 'concluida') || (!gestao && n.situacao !== 'aberta')) ? 'Abrir' : 'Editar';
          return `<tr${qualAtrasada(n) ? ' class="qual-linha-atraso"' : ''}><td><b>${esc(n.codigo || '')}</b></td><td>${fdA(n.data)}</td><td>${esc(n.empresa || '')}</td>
            <td><a href="#" class="link" data-qual-abrir="${n.linha}"><b>${esc(n.titulo || '')}</b></a>${n.descricao ? `<div class="nota qual-desc">${esc(n.descricao)}</div>` : ''}${n.devolucao && n.situacao === 'aberta' ? `<div class="qual-devol">↩ ${esc(n.devolucao)}</div>` : ''}</td>
            <td>${esc(n.local || '')}</td>
            <td>${qualSelo(QUAL_GRAV[n.gravidade] || n.gravidade || '—', QUAL_COR_GRAV[n.gravidade] || 'amarelo')}</td>
            <td>${qualSeloSit(n)}${n.situacao === 'concluida' && n.encerrada_em ? `<div class="nota">em ${fdA(n.encerrada_em)}${n.validada_por ? ' por ' + esc(n.validada_por) : ''}</div>` : ''}</td>
            <td>${qualPrazoTxt(n)}${qualAtrasada(n) ? ' <span class="farol f-vermelho">ATRASADA</span>' : ''}</td>
            <td>${n.respondida_em ? `${fdA(String(n.respondida_em).slice(0, 10))}${qualRespondidaAtraso(n) ? ' <span class="farol f-vermelho">COM ATRASO</span>' : ''}<div class="nota">${esc(n.respondida_por || '')}</div>` : (n.situacao === 'concluida' ? '—' : '<span class="nota">sem resposta</span>')}</td>
            <td class="n">${antes || depois ? `📷 ${antes} antes · ${depois} depois` : '—'}</td>
            <td class="qual-acoes"><button class="btn${acaoRot === 'Responder' || acaoRot === 'Validar' ? ' qual-ok' : ''}" data-qual-abrir="${n.linha}">${acaoRot}</button> <button class="btn" data-qual-rnc="${n.linha}" title="Relatório desta não conformidade, antes × depois">Relatório</button></td></tr>`;
        }).join('') : `<tr><td colspan="11" class="vazio">${todas.length ? 'Nenhuma não conformidade com estes filtros.' : (gestao ? 'Nenhuma não conformidade registrada ainda. Use “+ Nova não conformidade”.' : 'Nenhuma não conformidade para a sua empresa. 👍')}</td></tr>`}
      </tbody></table></div>
    </div>`;
}

// ---------------------------------------------------------------- fotos
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
async function qualEnviarFoto(ncId, arq, tipo) {
  const blob = await qualReduzir(arq);
  const r = await fetch(`${QUAL_FOTO}?acao=enviar&nc=${ncId}&tipo=${tipo}&nome=${encodeURIComponent(arq.name)}`, { method: 'POST', headers: { 'X-CSRF-Token': window.CSRF_TOKEN || '', 'Content-Type': 'image/jpeg' }, body: blob });
  const j = await r.json().catch(() => ({ erro: 'Resposta inválida do servidor.' }));
  if (!r.ok) throw new Error(j.erro || 'falha no envio');
}
async function qualFotoDataUri(id) {   // a foto vai embutida no relatório (a visualização, a impressão e o PDF não dependem da sessão)
  const r = await fetch(`${QUAL_FOTO}?acao=ver&id=${id}`);
  if (!r.ok) throw new Error('foto indisponível');
  const b = await r.blob();
  return new Promise((ok, erro) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.onerror = () => erro(fr.error); fr.readAsDataURL(b); });
}

// ---------------------------------------------------------------- janela da não conformidade
function qualDialogo() {
  let d = document.getElementById('dlgNC');
  if (!d) { d = document.createElement('dialog'); d.id = 'dlgNC'; d.className = 'qual-dialog'; document.body.appendChild(d); }
  return d;
}
// quem pode o quê, para esta NC e este usuário
function qualPermissoes(n) {
  const emp = qualMinhaEmpresa(), ro = qualSomenteLeitura(), admin = qualEhAdmin(), sit = n ? n.situacao : 'aberta';
  return {
    editar: !ro && !emp && sit !== 'concluida',              // gestão edita o registro (antes)
    responder: !ro && sit === 'aberta' && !!n && (!!emp || admin),   // empresa (ou admin) responde
    decidir: !ro && admin && sit === 'respondida',          // admin valida ou devolve
    reabrir: !ro && admin && sit === 'concluida',
    excluir: !ro && !!n && !emp && (admin || n.por === (D.usuario && D.usuario.nome)),
  };
}
function qualAbrir(id) {
  const n = id ? qualTodas().find(x => x.linha === id) : null;
  if (id && !n) return;
  const d = qualDialogo(), perm = qualPermissoes(n), minha = qualMinhaEmpresa();
  QUAL.fotosPend = [];
  d._id = n ? n.linha : null;
  const empresas = qualEmpresas();
  const locais = [...new Set(qualTodas().map(x => x.local).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt'));
  const v = (k, pad = '') => esc(n ? (n[k] ?? '') : pad);
  const ed = perm.editar ? '' : 'disabled';
  const empSel = n ? n.empresa : (QUAL.emp || '');
  const prazoPad = !n ? add(hoje(), 3) : '';
  d.innerHTML = `<form method="dialog" id="formNC" class="qual-form" autocomplete="off">
    <div class="qual-topo"><h3>${n ? `Não conformidade ${esc(n.codigo || '')}` : 'Nova não conformidade'}</h3>${n ? qualSeloSit(n) : ''}</div>
    ${n ? `<p class="nota">Registrada por ${esc(n.por || '—')}${n.em ? ' em ' + fdA(String(n.em).slice(0, 10)) + ' às ' + String(n.em).slice(11, 16) : ''} · empresa responsável: <b>${esc(n.empresa)}</b></p>` : ''}
    ${n && n.devolucao && n.situacao === 'aberta' ? `<div class="qual-devol grande">↩ ${esc(n.devolucao)}</div>` : ''}
    <fieldset class="qual-sec antes"><legend>ANTES — não conformidade encontrada</legend>
      <div class="qual-grade">
        <label>Empresa responsável<select name="empresa" required ${perm.editar && (!n || n.situacao === 'aberta') ? '' : 'disabled'}><option value="">— escolha —</option>${empresas.map(e => `<option value="${esc(e)}" ${e === empSel ? 'selected' : ''}>${esc(e)}</option>`).join('')}</select></label>
        <label>Data do registro<input type="date" name="data" value="${v('data', hoje())}" ${ed} required></label>
        <label class="qual-larga">Não conformidade (resumo)<input name="titulo" maxlength="255" value="${v('titulo')}" placeholder="Ex.: Solda sem acabamento na viga VC-12" required ${ed}></label>
        <label class="qual-larga">Descrição detalhada<textarea name="descricao" rows="3" placeholder="O que foi encontrado, em que condição, requisito não atendido…" ${ed}>${v('descricao')}</textarea></label>
        <label>Local da não conformidade<input name="local" list="qualLocais" value="${v('local')}" placeholder="Ex.: Galpão — eixo 05, fileira C" required ${ed}><datalist id="qualLocais">${locais.map(x => `<option value="${esc(x)}">`).join('')}</datalist></label>
        <label>Contato / responsável na empresa <span class="nota">(opcional)</span><input name="responsavel" value="${v('responsavel')}" placeholder="Nome de quem deve tratar" ${ed}></label>
        <label>Gravidade<select name="gravidade" ${ed}>${Object.entries(QUAL_GRAV).map(([k, t]) => `<option value="${k}" ${(n ? n.gravidade : 'media') === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <label>Prazo para a empresa responder<input type="date" name="prazo" value="${n ? v('prazo') : prazoPad}" required ${ed}></label>
      </div>
      <div class="qual-fotos-bloco"><div class="bloco-cab"><h4>Fotos do registro (antes)</h4>${perm.editar ? `<label class="btn qual-up">+ Anexar fotos<input type="file" id="qualArqAntes" accept="image/*" multiple hidden></label>` : ''}</div>
        <div id="qualFotosAntes" class="qual-fotos"></div></div>
    </fieldset>
    ${n ? `<fieldset class="qual-sec depois"><legend>DEPOIS — resposta da empresa</legend>
      ${n.situacao === 'aberta' && !perm.responder ? `<p class="nota">Aguardando a resposta de ${esc(n.empresa)} até ${n.prazo ? fdA(n.prazo) : '—'}.</p>` : ''}
      ${perm.responder || n.acao ? `<label class="qual-larga">Resposta / ação corretiva realizada${perm.responder ? ' <span class="nota">(obrigatória, com ao menos uma foto)</span>' : ''}<textarea name="resposta" id="qualResposta" rows="4" placeholder="O que foi feito para corrigir e evitar que se repita" ${perm.responder ? '' : 'disabled'}>${esc(n.acao || '')}</textarea></label>` : ''}
      ${n.respondida_em ? `<p class="nota">Respondida por ${esc(n.respondida_por || '—')} em ${fdA(String(n.respondida_em).slice(0, 10))} às ${String(n.respondida_em).slice(11, 16)}${qualRespondidaAtraso(n) ? ' — <b style="color:var(--vermelho)">fora do prazo</b>' : ' — dentro do prazo'}</p>` : ''}
      ${n.situacao === 'concluida' ? `<p class="nota">✔ Validada por ${esc(n.validada_por || '—')} em ${fdA(n.encerrada_em)}.</p>` : ''}
      <div class="qual-fotos-bloco"><div class="bloco-cab"><h4>Fotos da correção (depois)</h4>${perm.responder ? `<label class="btn qual-up">+ Anexar fotos<input type="file" id="qualArqDepois" accept="image/*" multiple hidden></label>` : ''}</div>
        <div id="qualFotosDepois" class="qual-fotos"></div></div>
    </fieldset>` : ''}
    ${perm.decidir ? `<fieldset class="qual-sec"><legend>Validação do administrador</legend><label class="qual-larga">Motivo (obrigatório só para devolver)<textarea id="qualMotivo" rows="2" placeholder="O que ainda precisa ser corrigido"></textarea></label></fieldset>` : ''}
    <div class="qual-rodape"><span class="nota" id="qualMsg"></span>
      <button type="button" class="btn" id="qualFechar">Fechar</button>
      ${perm.excluir ? '<button type="button" class="btn qual-excluir" id="qualExcluir">Excluir</button>' : ''}
      ${perm.reabrir ? '<button type="button" class="btn" id="qualReabrir">Reabrir</button>' : ''}
      ${perm.decidir ? '<button type="button" class="btn" id="qualDevolver">Devolver para correção</button><button type="button" class="btn qual-ok" id="qualValidar">Validar e concluir</button>' : ''}
      ${perm.responder ? '<button type="button" class="btn qual-ok" id="qualResponder">Enviar resposta</button>' : ''}
      ${perm.editar ? `<button type="submit" class="btn qual-ok" id="qualSalvar">${n ? 'Salvar' : 'Registrar'}</button>` : ''}</div>
  </form>`;
  qualDesenharFotos();
  d.showModal();
  d.querySelector(perm.responder ? '#qualResposta' : 'input[name=titulo]')?.focus();
}
function qualDesenharFotos() {
  const d = document.getElementById('dlgNC');
  if (!d) return;
  const n = d._id ? qualTodas().find(x => x.linha === d._id) : null, perm = qualPermissoes(n);
  const fig = (f, i, tot, pode) => `<figure class="qual-foto"><a href="${QUAL_FOTO}?acao=ver&id=${f.linha}" target="_blank" rel="noopener"><img src="${QUAL_FOTO}?acao=ver&id=${f.linha}" loading="lazy" alt="Foto ${i + 1}"></a>
      <textarea rows="2" data-qual-leg="${f.linha}" placeholder="Legenda da foto" ${pode ? '' : 'disabled'}>${esc(f.legenda || '')}</textarea>${pode ? `<button type="button" class="btn" data-qual-fdel="${f.linha}">Excluir foto</button>` : ''}</figure>`;
  const antes = d.querySelector('#qualFotosAntes'), depois = d.querySelector('#qualFotosDepois');
  if (antes) {
    const salvas = n ? qualFotosDe(n.linha, 'antes') : [];
    antes.innerHTML = [...salvas.map((f, i) => fig(f, i, salvas.length, perm.editar)),
      ...QUAL.fotosPend.map((p, i) => `<figure class="qual-foto pend"><img src="${p.url}" alt="Nova foto"><div class="nota">${esc(p.arq.name)} — será enviada ao registrar</div><button type="button" class="btn" data-qual-pdel="${i}">Remover</button></figure>`)].join('') || '<p class="nota">Nenhuma foto anexada.</p>';
  }
  if (depois) {
    const salvas = n ? qualFotosDe(n.linha, 'depois') : [];
    depois.innerHTML = salvas.map((f, i) => fig(f, i, salvas.length, perm.responder)).join('') || '<p class="nota">Nenhuma foto da correção anexada.</p>';
  }
}
function qualMsg(t) { const m = document.querySelector('#dlgNC #qualMsg'); if (m) m.textContent = t || ''; }
async function qualAcao(corpo, okTxt) {
  const d = document.getElementById('dlgNC');
  d.querySelectorAll('button').forEach(b => b.disabled = true);
  try { const j = await postar(API + 'qualidade', corpo); d.close(); await carregar(); toast(okTxt(j)); return j; }
  catch (e) { toast(e.message, true); d.querySelectorAll('button').forEach(b => b.disabled = false); qualMsg(''); }
}
async function qualSalvar(form) {
  const d = document.getElementById('dlgNC'), campos = Object.fromEntries(new FormData(form).entries());
  const btn = form.querySelector('#qualSalvar'); btn.disabled = true;
  try {
    const j = await postar(API + 'qualidade', { acao: 'salvar', id: d._id, campos });
    let enviadas = 0;
    for (const p of QUAL.fotosPend) {
      try { qualMsg(`Enviando foto ${enviadas + 1} de ${QUAL.fotosPend.length}…`); await qualEnviarFoto(j.id, p.arq, 'antes'); enviadas++; }
      catch (e) { toast(`Foto "${p.arq.name}": ${e.message}`, true); }
    }
    QUAL.fotosPend.forEach(p => URL.revokeObjectURL(p.url)); QUAL.fotosPend = [];
    const novo = !d._id; d.close(); await carregar();
    toast(`${j.codigo} ${novo ? 'registrada — a empresa foi avisada' : 'atualizada'}${enviadas ? ` com ${enviadas} foto(s)` : ''}.`);
  } catch (e) { toast(e.message, true); btn.disabled = false; qualMsg(''); }
}
async function qualExcluirFotoSalva(id) {
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
async function qualAdicionarFotos(lista, tipo) {
  const d = document.getElementById('dlgNC');
  if (d._id) {   // NC já existe: envia na hora
    let n = 0;
    for (const arq of lista) { try { qualMsg(`Enviando ${n + 1} de ${lista.length}…`); await qualEnviarFoto(d._id, arq, tipo); n++; } catch (e) { toast(`Foto "${arq.name}": ${e.message}`, true); } }
    qualMsg(''); await carregar(); qualDesenharFotos();
    if (n) toast(`${n} foto(s) anexada(s).`);
  } else {   // registro novo: as fotos esperam o "Registrar"
    lista.forEach(arq => QUAL.fotosPend.push({ arq, url: URL.createObjectURL(arq) }));
    qualDesenharFotos();
  }
}

// ---------------------------------------------------------------- relatórios (antes × depois)
function qualRelAbrir() {
  let d = document.getElementById('dlgNCRel');
  if (!d) { d = document.createElement('dialog'); d.id = 'dlgNCRel'; d.className = 'qual-dialog qual-dialog-peq'; document.body.appendChild(d); }
  const empresas = qualEmpresas();
  d.innerHTML = `<form method="dialog" id="formNCRel" class="qual-form"><h3>Relatório de não conformidades</h3>
    <div class="qual-grade">
      <label>Empresa<select name="emp" ${qualMinhaEmpresa() ? 'disabled' : ''}>${qualMinhaEmpresa() ? '' : '<option value="">Todas as empresas (uma seção por empresa)</option>'}${empresas.map(e => `<option value="${esc(e)}" ${e === (QUAL.emp || qualMinhaEmpresa()) ? 'selected' : ''}>${esc(e)}</option>`).join('')}</select></label>
      <label>Situação<select name="sit"><option value="">Todas</option><option value="pendente">Pendentes (não concluídas)</option>${Object.entries(QUAL_SIT).map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}<option value="atrasada">Resposta atrasada</option></select></label>
      <label>Registradas de<input type="date" name="ini"></label>
      <label>até<input type="date" name="fim"></label>
      <label class="qual-larga check"><input type="checkbox" name="fotos" checked> Incluir as fichas com ANTES × DEPOIS e as fotos</label>
    </div>
    <div class="qual-rodape"><button type="button" class="btn" id="qualRelFechar">Cancelar</button><button type="submit" class="btn qual-ok">Visualizar relatório</button></div></form>`;
  d.showModal();
}
const QUAL_CSS = `<style>
.nc-ficha{border:1px solid #98a2b3;border-radius:8px;padding:12px 14px;margin:0 0 16px;background:#fff}
.nc-ficha h3{margin:0 0 8px;font-size:15px}.nc-meta{display:grid;grid-template-columns:repeat(4,1fr);gap:6px 14px;margin:0 0 10px;font-size:11.5px}
.nc-meta b{display:block;font-size:9.5px;color:#667085;text-transform:uppercase;letter-spacing:.04em;font-weight:700}
.nc-ad{display:grid;grid-template-columns:1fr 1fr;gap:12px;align-items:start}
.nc-lado{border:2px solid #98a2b3;border-radius:6px;padding:8px 10px;background:#fcfcfd}.nc-lado.antes{border-color:#b42318}.nc-lado.depois{border-color:#067647}
.nc-lado h4{margin:0 0 6px;font-size:11px;letter-spacing:.06em;text-transform:uppercase}.nc-lado.antes h4{color:#b42318}.nc-lado.depois h4{color:#067647}
.nc-txt{white-space:pre-wrap;margin:2px 0 8px;font-size:12px}.nc-rot{font-size:10px;color:#667085;text-transform:uppercase;font-weight:700;margin:6px 0 2px}
.nc-fotos{display:grid;grid-template-columns:1fr;gap:8px;margin-top:6px}.nc-fotos figure{margin:0;border:1px solid #1f3a5f;border-radius:5px;padding:4px;background:#fff;break-inside:avoid}
.nc-fotos .nc-quadro{border:1px solid #cbd5e1;background:#f1f5f9;display:flex;align-items:center;justify-content:center;min-height:90px;padding:2px}
.nc-fotos img{max-width:100%;max-height:230px;width:auto;height:auto;display:block}.nc-fotos figcaption{font-size:10.5px;margin-top:4px}
.nc-vazio{color:#667085;font-style:italic;font-size:11.5px}
.nc-assinaturas{display:grid;grid-template-columns:1fr 1fr;gap:42px;margin-top:46px}.nc-assinatura{border-top:1px solid #111;text-align:center;padding-top:6px;font-size:11px}
</style>`;
async function qualHtml(f) {
  const empresaUnica = f.emp || qualMinhaEmpresa();
  let lista = qualTodas().filter(n => (!empresaUnica || n.empresa === empresaUnica) && qualPassaSit(n, f.sit) && (!f.ini || (n.data || '') >= f.ini) && (!f.fim || (n.data || '') <= f.fim));
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
  const fotosHtml = (n, tipo) => {
    const fts = qualFotosDe(n.linha, tipo);
    if (!fts.length) return `<div class="nc-vazio">${tipo === 'antes' ? 'Sem foto do registro.' : 'Sem foto da correção.'}</div>`;
    return `<div class="nc-fotos">${fts.map((ft, i) => `<figure><div class="nc-quadro">${uris.get(ft.linha) ? `<img src="${uris.get(ft.linha)}" alt="Foto ${i + 1}">` : '<span class="nota">foto indisponível</span>'}</div><figcaption><b>Foto ${i + 1} de ${fts.length}</b>${ft.legenda ? ' — ' + esc(ft.legenda) : ''}</figcaption></figure>`).join('')}</div>`;
  };
  const ficha = n => `<div class="nc-ficha"><h3>${esc(n.codigo || '')} — ${esc(n.titulo || '')}</h3>
      <div class="nc-meta">${meta('Empresa responsável', esc(n.empresa || ''))}${meta('Registrada em', fdA(n.data))}${meta('Local', esc(n.local || '—'))}${meta('Contato', esc(n.responsavel || '—'))}
        ${meta('Gravidade', selo(QUAL_GRAV[n.gravidade] || n.gravidade, QUAL_COR_GRAV[n.gravidade] || 'amarelo'))}${meta('Situação', qualSeloSit(n))}
        ${meta('Prazo para responder', n.prazo ? fdA(n.prazo) + (qualAtrasada(n) ? ' ' + selo('ATRASADA', 'vermelho') : '') : '—')}${meta('Registrada por', esc(n.por || '—'))}</div>
      <div class="nc-ad">
        <div class="nc-lado antes"><h4>Antes — não conformidade</h4>
          <div class="nc-rot">Descrição</div><div class="nc-txt">${esc(n.descricao || n.titulo || '—')}</div>
          ${comFotos ? fotosHtml(n, 'antes') : ''}</div>
        <div class="nc-lado depois"><h4>Depois — resposta da empresa</h4>
          ${n.acao ? `<div class="nc-rot">Ação corretiva realizada</div><div class="nc-txt">${esc(n.acao)}</div>` : `<div class="nc-vazio">${n.situacao === 'aberta' ? 'Aguardando a resposta da empresa' + (n.prazo ? ' até ' + fdA(n.prazo) : '') + '.' : 'Sem resposta registrada.'}</div>`}
          ${n.respondida_em ? `<div class="nc-rot">Respondida</div><div class="nc-txt">${esc(n.respondida_por || '—')} em ${fdA(String(n.respondida_em).slice(0, 10))}${qualRespondidaAtraso(n) ? ' — <b>fora do prazo</b>' : ' — dentro do prazo'}</div>` : ''}
          ${comFotos ? fotosHtml(n, 'depois') : ''}
          ${n.situacao === 'concluida' ? `<div class="nc-rot">Validação</div><div class="nc-txt">✔ Validada por ${esc(n.validada_por || '—')} em ${fdA(n.encerrada_em)}</div>` : ''}
          ${n.devolucao && n.situacao === 'aberta' ? `<div class="nc-rot">Devolução</div><div class="nc-txt">${esc(n.devolucao)}</div>` : ''}</div>
      </div></div>`;
  const tabela = l => `<table><thead><tr><th>Código</th><th>Registrada</th><th>Não conformidade</th><th>Local</th><th>Gravidade</th><th>Situação</th><th>Prazo p/ responder</th><th>Respondida</th></tr></thead><tbody>${l.map(n =>
    `<tr><td><b>${esc(n.codigo || '')}</b></td><td>${fdA(n.data)}</td><td>${esc(n.titulo || '')}</td><td>${esc(n.local || '')}</td><td>${selo(QUAL_GRAV[n.gravidade] || n.gravidade, QUAL_COR_GRAV[n.gravidade] || 'amarelo')}</td><td>${qualSeloSit(n)}</td><td>${n.prazo ? fdA(n.prazo) : '—'}${qualAtrasada(n) ? ' ' + selo('ATRASADA', 'vermelho') : ''}</td><td>${n.respondida_em ? fdA(String(n.respondida_em).slice(0, 10)) + (qualRespondidaAtraso(n) ? ' ' + selo('COM ATRASO', 'vermelho') : '') : '—'}</td></tr>`).join('')}</tbody></table>`;
  const sitNome = k => k === 'pendente' ? 'pendentes' : k === 'atrasada' ? 'resposta atrasada' : (QUAL_SIT[k] || k).toLowerCase();
  const filtroTxt = [empresaUnica ? `Empresa: ${empresaUnica}` : 'Todas as empresas', f.sit ? sitNome(f.sit) : '', f.ini ? `de ${fdA(f.ini)}` : '', f.fim ? `até ${fdA(f.fim)}` : ''].filter(Boolean).join(' · ');
  const individual = !!f.id, n0 = individual ? lista[0] : null;
  const corpo = `${QUAL_CSS}<section class="emp-sec"><div class="pag">
    <h1>${individual && n0 ? `Relatório de não conformidade ${esc(n0.codigo || '')}` : 'Relatório de não conformidades'}</h1>
    <p class="sub-cab">${esc((D.obra && D.obra.nome) || '')} · ${esc(individual && n0 ? n0.empresa : filtroTxt)}</p>
    ${individual ? '' : `<div class="cards">${card('Não conformidades', nf(r.total, 0), `${nf(emps.length, 0)} empresa(s)`, 'az')}${card('Aguardando resposta', nf(r.aguardaResp, 0), 'com a empresa', 'vm')}${card('Aguardando validação', nf(r.aguardaVal, 0), 'com o administrador', 'am')}${card('Concluídas', nf(r.concl, 0), r.total ? nf(r.concl / r.total * 100, 0) + '% do total' : '—', 'vd')}${card('Resposta atrasada', nf(r.atras, 0), `${nf(r.graves, 0)} grave(s) pendente(s)`, r.atras ? 'vm' : 'vd')}</div>`}
    ${!individual && emps.length > 1 ? `<h2>Resumo por empresa</h2><table><thead><tr><th>Empresa</th><th class="n">Total</th><th class="n">Aguardando resposta</th><th class="n">Aguardando validação</th><th class="n">Concluídas</th><th class="n">Resposta atrasada</th></tr></thead><tbody>${emps.map(e => { const x = qualResumo(lista.filter(n => n.empresa === e)); return `<tr><td><b>${esc(e)}</b></td><td class="n">${x.total}</td><td class="n">${x.aguardaResp}</td><td class="n">${x.aguardaVal}</td><td class="n">${x.concl}</td><td class="n">${x.atras}</td></tr>`; }).join('')}</tbody></table>` : ''}
    ${individual ? (n0 ? ficha(n0) : '<p class="nota">Não conformidade não encontrada.</p>') : (lista.length ? emps.map(e => { const l = lista.filter(n => n.empresa === e); return `<h2>${esc(e)} — ${l.length} não conformidade(s)</h2>${tabela(l)}${comFotos ? `<h3>Fichas antes × depois — ${esc(e)}</h3>${l.map(ficha).join('')}` : ''}`; }).join('') : '<p class="nota">Nenhuma não conformidade neste filtro.</p>')}
    <div class="nc-assinaturas"><div class="nc-assinatura">Responsável da empresa${individual && n0 ? ' — ' + esc(n0.empresa) : (empresaUnica ? ' — ' + esc(empresaUnica) : '')}<br><span class="nota">Nome, assinatura e data</span></div><div class="nc-assinatura">Qualidade / Administração da obra<br><span class="nota">Nome, assinatura e data</span></div></div>
  </div></section>`;
  const emp = individual && n0 ? n0.empresa : empresaUnica;
  return tplDocumento({ titulo: individual && n0 ? `RNC — ${n0.codigo}` : 'Relatório de não conformidades', subtitulo: `${(D.obra && D.obra.nome) || ''} — ${individual && n0 ? n0.empresa : filtroTxt}`,
    meta: 'Qualidade: não conformidades, antes × depois, resposta da empresa e validação', corpo, empresa: emp || '' });
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
  const t = ev.target.closest && ev.target.closest('#qualNova, #qualRel, #qualFechar, #qualExcluir, #qualRelFechar, #qualResponder, #qualValidar, #qualDevolver, #qualReabrir, [data-qual-emp], [data-qual-abrir], [data-qual-rnc], [data-qual-fdel], [data-qual-pdel]');
  if (!t) return;
  const d = document.getElementById('dlgNC');
  if (t.id === 'qualNova') qualAbrir(null);
  else if (t.id === 'qualRel') qualRelAbrir();
  else if (t.id === 'qualFechar') { QUAL.fotosPend.forEach(p => URL.revokeObjectURL(p.url)); QUAL.fotosPend = []; d.close(); }
  else if (t.id === 'qualExcluir') { const n = qualTodas().find(x => x.linha === d._id); if (n && confirm(`Excluir a não conformidade ${n.codigo} e as fotos dela? Não há lixeira.`)) qualAcao({ acao: 'excluir', id: n.linha }, () => `${n.codigo} excluída.`); }
  else if (t.id === 'qualResponder') qualAcao({ acao: 'responder', id: d._id, campos: { resposta: (d.querySelector('#qualResposta') || {}).value || '' } }, j => `${j.codigo}: resposta enviada — aguarda a validação do administrador.`);
  else if (t.id === 'qualValidar') qualAcao({ acao: 'validar', id: d._id }, j => `${j.codigo} validada e concluída.`);
  else if (t.id === 'qualDevolver') qualAcao({ acao: 'devolver', id: d._id, campos: { motivo: (d.querySelector('#qualMotivo') || {}).value || '' } }, j => `${j.codigo} devolvida para a empresa corrigir.`);
  else if (t.id === 'qualReabrir') { if (confirm('Reabrir esta não conformidade? Ela volta para a empresa responder de novo.')) qualAcao({ acao: 'reabrir', id: d._id }, j => `${j.codigo} reaberta.`); }
  else if (t.id === 'qualRelFechar') document.getElementById('dlgNCRel').close();
  else if (t.dataset.qualEmp !== undefined) { QUAL.emp = t.dataset.qualEmp; renderQualidade(); }
  else if (t.dataset.qualAbrir) { ev.preventDefault(); qualAbrir(+t.dataset.qualAbrir); }
  else if (t.dataset.qualRnc) qualGerar({ id: +t.dataset.qualRnc, fotos: true }, t);
  else if (t.dataset.qualFdel) qualExcluirFotoSalva(+t.dataset.qualFdel);
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
  else if (t.id === 'qualArqAntes' || t.id === 'qualArqDepois') { const l = [...t.files], tipo = t.id === 'qualArqDepois' ? 'depois' : 'antes'; t.value = ''; if (l.length) qualAdicionarFotos(l, tipo); }
  else if (t.dataset && t.dataset.qualLeg) qualSalvarLegenda(t);
});
let qualBuscaT = 0;
document.addEventListener('input', ev => {
  if (ev.target.id === 'qualBusca') {
    QUAL.busca = ev.target.value;
    const pos = ev.target.selectionStart;
    clearTimeout(qualBuscaT); qualBuscaT = setTimeout(() => { const ae = document.activeElement; if (ae && ae.id === 'qualBusca') ae.blur(); renderQualidade(); const n = $('#qualBusca'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } }, 250);
  }
});
