// Produção › Modelo 3D (4D): abre o IFC da obra em 3D, deixa selecionar elementos (clique, Shift e caixa de seleção),
// agrupa em GRUPOS DE MONTAGEM com início/término previstos, situação e equipe, e simula a montagem na linha do tempo.
// Servidor: modelo3d.php (arquivos, grupos e vínculos por GUID). Conversão do IFC: m3d_conversor.js (segundo plano).
// Usa utilidades do app.js: $, esc, toast, fdA, add, diasEntre, hoje, ref, M, cap.
const M3D_URL = 'modelo3d.php';
const M3D_PARTE = 4 * 1048576;
const M3D_SVG = d => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const M3D_ICO = {
  iso: M3D_SVG('<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/>'),
  topo: M3D_SVG('<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 12h16M12 4v16"/>'),
  enq: M3D_SVG('<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/><circle cx="12" cy="12" r="2.5"/>'),
  isolar: M3D_SVG('<circle cx="12" cy="12" r="3.5"/><path d="M3 12h3M18 12h3M12 3v3M12 18v3"/>'),
  tudo: M3D_SVG('<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="2.5"/>'),
  mais: M3D_SVG('<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>'),
};
const M3D_VER = ((document.currentScript && document.currentScript.src) || '').split('v=')[1] || '1';
const M3D_COR = { sel: '#f59e0b', antes: '#d5d9e0', montando: '#2563eb', feito: '#16a34a', previsto: '#86d6a0', atrasado: '#dc2626', sem: '#c3c8d1' };
const M3D_ROT = { antes: 'Não iniciado', montando: 'Em montagem', feito: 'Concluído', previsto: 'Concluído (previsto)', atrasado: 'Atrasado', sem: 'Sem prazo definido' };
// situação real de cada peça montável: carga (Suprimentos › Remessas) + apontamento de campo (içada / torqueada)
const M3D_RC = ['#e7e5e4', '#cbd5e1', '#7dd3fc', '#facc15', '#86efac', '#15803d', '#dc2626'];
const M3D_RR = ['Sem dado de carga', 'Na fábrica', 'A caminho', 'No canteiro · pronta para içar', 'Içada', 'Torqueada', 'Atrasada (não içada no prazo)'];
const M3D_RCURTO = ['Sem dado de carga', 'Na fábrica', 'A caminho', 'No canteiro', 'Içada', 'Torqueada', 'Atrasada'];

const M3D_CORES_CHAVE = 'obras.modelo3d.cores';
function m3dLerCores() {
  try {
    const salvas = JSON.parse(localStorage.getItem(M3D_CORES_CHAVE)) || {};
    return Object.fromEntries(Object.keys(M3D_ROT)
      .filter(k => typeof salvas[k] === 'string' && /^#[0-9a-f]{6}$/i.test(salvas[k]))
      .map(k => [k, salvas[k]]));
  } catch {
    return {};
  }
}
let m3dCoresPersonalizadas = m3dLerCores();
const m3dCor = situacao => m3dCoresPersonalizadas[situacao] || M3D_COR[situacao];

function m3dSalvarCores() {
  try {
    localStorage.setItem(M3D_CORES_CHAVE, JSON.stringify(m3dCoresPersonalizadas));
  } catch {
    toast('As cores foram aplicadas nesta sessão. O navegador não permitiu guardar a preferência.', true);
  }
}

const M3 = { eixosVis: (() => { try { return localStorage.getItem('m3dEixos') !== '0'; } catch (e) { return true; } })(), chips: { st: new Set(), fase: new Set(), eixo: new Set() }, canteiro: false, juntos: false, corte: null, medindo: false, pontos: [], pronto: false, estado: null, modeloId: 0, grupos: [], filtroGrupos: new Set(), d: null, sel: new Set(), modo: 'conj', somar: false, caixa: false,
  cores: 'orig', dia: '', antes: true, semPrazo: true, ocultos: new Set(), isolados: null, tocando: null, vel: 1, refVista: '', props: null, carregando: false };

// ---------------------------------------------------------------- servidor
async function m3dGet(q) {
  const r = await fetch(`${M3D_URL}?${q}`, { cache: 'no-store' });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.erro || 'Falha ao consultar o servidor.');
  return j;
}
async function m3dPost(acao, corpo) {
  const r = await fetch(`${M3D_URL}?acao=${acao}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': window.CSRF_TOKEN || '' }, body: JSON.stringify(corpo) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.erro || 'Falha ao gravar.'); e.status = r.status; throw e; }
  return j;
}
async function m3dEnviarPartes(q, blob, prog) {   // arquivo grande em partes de 4 MB
  const uid = Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, '0')).join('');
  let j = {};
  for (let off = 0; off < blob.size; off += M3D_PARTE) {
    const fim = Math.min(blob.size, off + M3D_PARTE);
    const r = await fetch(`${M3D_URL}?${q}&upload=${uid}&offset=${off}&tamanho=${blob.size}&final=${fim >= blob.size ? 1 : 0}`,
      { method: 'POST', headers: { 'X-CSRF-Token': window.CSRF_TOKEN || '', 'Content-Type': 'application/octet-stream' }, body: blob.slice(off, fim) });
    j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.erro || 'Falha no envio do arquivo.');
    if (prog) prog(fim / blob.size);
  }
  return j;
}
async function m3dCompactar(buf) {
  if (typeof CompressionStream !== 'function') return new Blob([buf]);
  return new Response(new Blob([buf]).stream().pipeThrough(new CompressionStream('gzip'))).blob();
}
async function m3dDescompactar(buf) {
  const b = new Uint8Array(buf, 0, 2);
  if (b[0] !== 0x1f || b[1] !== 0x8b) return buf;
  if (typeof DecompressionStream !== 'function') throw new Error('Este navegador é antigo demais para abrir o modelo 3D. Atualize o navegador.');
  return new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}

// ---------------------------------------------------------------- tela
function renderModelo3d() {
  const corpo = $('#m3dCorpo');
  if (!corpo) return;
  if (!M3.pronto) {
    M3.pronto = true;
    M3.dia = M3.refVista = m3dHoje();
    corpo.innerHTML = m3dEsqueleto();
    m3dLigar();
    m3dCarregarEstado();
    return;
  }
  M3.refVista = m3dHoje();
  m3dPintar();
  m3dListaGrupos();
  if (M3.d && M3.ap && !M3.carregando && M3._abaSig !== m3dAbaAssinatura()) {   // houve apontamento na aba Apontar montagem: relê e repinta
    m3dLerAba().then(() => { M3._realV = (M3._realV || 0) + 1; m3dPintar(); m3dPaineis(); });
  }
  m3dRedimensionar();
}
function m3dHoje() { return (typeof ref === 'string' && ref) || hoje(); }

function m3dEsqueleto() {
  return `
  <div class="barra-acoes m3d-barra">
    <label class="m3d-campo">Modelo <select id="m3dModelo"></select></label>
    <button type="button" class="btn primario" id="m3dEnviar">+ Enviar IFC</button>
    <input type="file" id="m3dArq" accept=".ifc" hidden>
    <button type="button" class="btn perigo" id="m3dExcluirModelo" title="Excluir este modelo e os grupos dele">Excluir modelo</button>
    <button type="button" class="btn" id="m3dJuntar" disabled>Juntar IFCs</button>
    <span id="m3dTotalJuntos" class="nota" role="status"></span>
    <span class="m3d-esp"></span>
    <span class="m3d-rede" id="m3dRede" hidden></span>
    <button type="button" class="btn" id="m3dBtnCanteiro" title="Tela para tablet no canteiro: modelo grande, botões Içada e Torqueada, funciona sem internet">Modo canteiro</button>
    <span class="m3d-demo-selo" id="m3dDemoSelo" hidden>Obra de demonstração · dados fictícios <button type="button" class="m3d-link" data-m3d="tour">ver o tour</button></span>
    <div class="seg" id="m3dModo" title="O que um clique seleciona"><button type="button" data-m="conj" class="ativa" title="A peça como é montada (viga, joist, terça…)">Peça montável</button><button type="button" data-m="peca" title="Cada componente da peça (chapa, perfil, parafuso…)">Componente</button></div>
    <div class="seg" id="m3dCores" title="O que as cores mostram"><button type="button" data-c="real" title="Situação de cada peça: carga e apontamento de campo">Situação real</button><button type="button" data-c="4d" title="Prazos das frentes de montagem">Planejado (4D)</button><button type="button" data-c="orig" class="ativa">Cores do projeto</button></div>
  </div>
  <div class="m3d-vitrine" id="m3dVitrine" hidden></div>
  <dialog id="m3dDlgJuntar" aria-labelledby="m3dTituloJuntar">
    <form id="m3dFormJuntar">
      <h3 id="m3dTituloJuntar">Juntar IFCs</h3>
      <p class="nota">Marque os modelos que quer abrir na mesma cena. Use IFCs com a mesma referência de coordenadas.</p>
      <fieldset id="m3dListaJuntar" style="max-height:50vh;overflow:auto"><legend>Modelos da obra</legend></fieldset>
      <div class="barra-acoes" style="margin-top:12px">
        <button class="btn" type="button" id="m3dCancelaJuntar">Cancelar</button>
        <button class="btn primario" type="submit" id="m3dConfirmaJuntar" disabled>Visualizar selecionados</button>
      </div>
    </form>
  </dialog>
  <div class="m3d-area">
    <div class="m3d-col">
      <div class="m3d-vista" id="m3dVista">
        <canvas id="m3dCanvas"></canvas>
        <canvas id="m3dCotas" aria-hidden="true" style="pointer-events:none"></canvas>
        <div class="m3d-caixa" id="m3dCaixaSel" hidden></div>
        <div class="m3d-aviso" id="m3dAviso"></div>
        <div class="m3d-ferr" id="m3dFerr">
          <button type="button" class="m3d-fb" data-v="iso" title="Perspectiva da obra inteira">${M3D_ICO.iso}<span>Vista geral</span></button>
          <button type="button" class="m3d-fb" data-v="topo" title="Planta: vista de cima">${M3D_ICO.topo}<span>De cima</span></button>
          <button type="button" class="m3d-fb" data-v="enq" title="Aproxima a câmera do que está selecionado">${M3D_ICO.enq}<span>Enquadrar seleção</span></button>
          <button type="button" class="m3d-fb" data-m3d="isolar" title="Mostra só o que está selecionado">${M3D_ICO.isolar}<span>Isolar</span></button>
          <button type="button" class="m3d-fb" data-m3d="mostrar" title="Volta a mostrar todas as peças">${M3D_ICO.tudo}<span>Mostrar tudo</span></button>
          <button type="button" class="m3d-fb" id="m3dCortar" aria-expanded="false" aria-controls="m3dPainelCorte" disabled title="Plano de corte">✂<span>Corte</span></button>
          <button type="button" class="m3d-fb" id="m3dMedir" aria-pressed="false" disabled title="Medir distância entre dois pontos">↔<span>Medir</span></button>
          <details class="m3d-mais"><summary class="m3d-fb" title="Mais ferramentas">${M3D_ICO.mais}<span class="m3d-sr">Mais ferramentas</span></summary>
            <div class="m3d-menu">
              <button type="button" data-v="frente">Vista de frente</button>
              <button type="button" data-v="lado">Vista lateral</button>
              <button type="button" data-m3d="ocultar">Ocultar a seleção</button>
              <button type="button" id="m3dBtnEixos" class="ativo" hidden>Eixos do projeto (01…20 e A…H)</button>
              <button type="button" id="m3dBtnCaixa">Caixa de seleção ao arrastar</button>
              <button type="button" id="m3dBtnSomar">Cada clique soma à seleção</button>
            </div>
          </details>
        </div>
        <div class="m3d-dica" id="m3dDica">Arrastar gira · roda do mouse aproxima · botão direito desloca · clique seleciona · <b>Shift + clique</b> soma · <b>Shift + arrastar</b> = caixa</div>
        <div class="m3d-tour" id="m3dTour" hidden></div>
      </div>
      <div class="bloco m3d-tempo" id="m3dTempo"></div>
    </div>
    <aside class="m3d-painel">
      <div class="bloco" id="m3dPainelCorte" hidden>
        <h3>Plano de corte</h3>
        <label class="m3d-campo">Eixo <select id="m3dEixoCorte"><option value="x">X</option><option value="y" selected>Y (altura)</option><option value="z">Z</option></select></label>
        <label style="display:block;margin:8px 0">Posição <input type="range" id="m3dPosCorte" min="0" max="1000" value="500" style="width:100%"></label>
        <button type="button" class="btn" id="m3dInverterCorte" aria-pressed="false">Inverter lado</button>
      </div>
      <div class="bloco" id="m3dPainelMedida" hidden>
        <h3>Medição de distância</h3>
        <p class="nota" id="m3dMedidaStatus" aria-live="polite"></p>
        <button type="button" class="btn" id="m3dLimparMedida">Limpar medida</button>
      </div>
      <div class="bloco" id="m3dSelBox"></div>
      <div class="bloco" id="m3dChipsBox"></div>
      <div class="bloco" id="m3dFiltroBox"></div>
      <div class="bloco" id="m3dGruposBox"></div>
    </aside>
  </div>
  <div class="m3d-cbar" id="m3dCBar" hidden></div>`;
}

function m3dAviso(html, erro) {
  const a = $('#m3dAviso');
  if (!a) return;
  a.innerHTML = html || '';
  a.hidden = !html;
  a.classList.toggle('erro', !!erro);
}
function m3dPodeEditar() { return !!(M3.estado && M3.estado.pode_editar); }

async function m3dCarregarEstado(manterId) {
  try {
    M3.estado = await m3dGet('acao=estado');
  } catch (e) {
    m3dAviso(esc(e.message), true);
    return;
  }
  $('#m3dJuntar').disabled = M3.estado.modelos.length < 2;
  const ms = M3.estado.modelos, sel = $('#m3dModelo');
  const docs = M3.estado.docs_ifc || [];
  sel.innerHTML = (ms.length ? ms.map(m => `<option value="${m.id}">${esc(m.nome)}</option>`).join('') : '<option value="">(nenhum modelo enviado)</option>') +
    (docs.length && m3dPodeEditar() ? '<optgroup label="IFC já guardado na importação da obra — usar como modelo">' + docs.map(d => `<option value="doc:${d.id}">${esc(d.nome)}</option>`).join('') + '</optgroup>' : '');
  $('#m3dEnviar').hidden = $('#m3dExcluirModelo').hidden = !m3dPodeEditar();
  $('#m3dDemoSelo').hidden = !M3.estado.demo;
  const alvo = ms.find(m => m.id === (manterId || M3.modeloId)) || ms[0];
  if (alvo) {
    sel.value = String(alvo.id);
    if (alvo.id !== M3.modeloId || !M3.d) m3dAbrirModelo(alvo.id);
  } else if (docs.length && m3dPodeEditar() && !M3._autoDoc) {   // um envio só: o IFC já enviado em Documentos da obra vira o modelo sozinho
    M3._autoDoc = true;
    try { const r = await m3dPost('usar_doc', { doc_id: docs[0].id }); await m3dCarregarEstado(r.id); return; } catch (e) { toast(e.message, true); }
  } else {
    M3.modeloId = 0;
    m3dLimparCena();
    m3dAviso(m3dPodeEditar()
      ? `<div class="m3d-vazio"><b>Esta obra ainda não tem o modelo 3D.</b>
          <p>Envie o IFC exportado do Tekla ou do Trimble Connect. Ele vira o modelo 3D, as frentes de montagem (pelas etapas do arquivo) e também fica nos Documentos da obra, para gerar materiais e mapa.</p>
          <button type="button" class="btn primario m3d-vazio-bt" data-m3d="enviar-ifc">Enviar IFC</button>
          <a class="m3d-link" href="obras.php?lista=1">Ver a obra de exemplo (Galpão Exemplo)</a></div>`
      : '<b>Nenhum modelo 3D nesta obra.</b><br>A gestão da obra ainda não enviou o IFC.');
    m3dPaineis();
  }
  $('#m3dExcluirModelo').disabled = !alvo || M3.juntos;
}

// ---------------------------------------------------------------- abrir e converter o modelo
async function m3dAbrirModelo(id, bufLocal) {
  if (M3.carregando) return;
  M3.carregando = true;
  M3.modeloId = id;
  M3.juntos = false;
  $('#m3dTotalJuntos').textContent = '';
  $('#m3dExcluirModelo').disabled = false;
  M3.sel.clear(); M3.ocultos.clear(); M3.isolados = null; M3.props = null; M3.grupos = []; M3.filtroGrupos.clear();
  m3dLimparCena();
  m3dPaineis();
  const mod = M3.estado.modelos.find(m => m.id === id);
  try {
    const { geo, props } = await m3dBaixarModelo(mod, bufLocal);
    M3.props = props;
    m3dAviso('<span class="m3d-gira"></span> Montando a cena 3D…');
    await new Promise(r => setTimeout(r, 30));
    M3.d = m3dLerGeo(geo);
    await m3dMontarCena();
    const g = await m3dGet(`acao=grupos&modelo=${id}`);
    M3.grupos = g.grupos;
    M3._pesoTot = null;
    m3dIndexarGrupos();
    await m3dCarregarCampo(id);
    m3dEixosMontar().catch(() => {});
    const modAtual = M3.estado.modelos.find(m => m.id === id);
    if (m3dPodeEditar() && modAtual && !modAtual.frentes_auto && !M3.grupos.length) await m3dFrentesAuto(modAtual);
    m3dAviso('');
    M3.dia = m3dHoje();
    m3dDefinirCores(M3.estado.demo || M3.ap.n || M3.carga.n ? 'real' : 'orig');
    m3dVistaPadrao('iso');
    m3dPintar();
    if (M3.estado.demo) setTimeout(() => m3dTourIniciar(false), 400);
  } catch (e) {
    m3dAviso('<b>Não foi possível abrir o modelo.</b><br>' + esc(e.message), true);
  }
  M3.carregando = false;
  m3dPaineis();
}


async function m3dBaixarModelo(mod, ifc) {
  if (mod.cache && !ifc) {
    m3dAviso('<span class="m3d-gira"></span> Baixando o modelo…');
    const r = await fetch(M3D_URL + '?acao=cache&id=' + mod.id + '&tipo=geo');
    if (!r.ok) throw new Error('Não consegui baixar o modelo convertido.');
    return { geo: await m3dDescompactar(await r.arrayBuffer()), props: null };
  }
  if (!ifc) {
    m3dAviso('<span class="m3d-gira"></span> Baixando o IFC…');
    const r = await fetch(M3D_URL + '?acao=arquivo&id=' + mod.id);
    if (!r.ok) throw new Error('Não consegui baixar o IFC deste modelo.');
    ifc = await r.arrayBuffer();
  }
  const conv = await m3dConverter(ifc);
  if (m3dPodeEditar()) m3dGravarCache(mod.id, conv);
  return { geo: conv.geo, props: JSON.parse(new TextDecoder().decode(conv.props)) };
}

function m3dCombinarDados(fontes, TH) {
  const primeiro = fontes[0].dados;
  const total = chave => fontes.reduce((n, f) => n + f.dados[chave], 0);
  const a = Object.fromEntries(Object.entries(primeiro.a).map(([k, v]) =>
    [k, new v.constructor(fontes.reduce((n, f) => n + f.dados.a[k].length, 0))]));
  const e = Object.fromEntries(Object.keys(primeiro.e).map(k => [k, []]));
  const offsets = Object.fromEntries(Object.keys(a).map(k => [k, 0]));
  const s = [], raiz = new Int32Array(total('n')), guidPorModelo = new Map();
  const cab = { n_unid: 0 };
  let elementos = 0, geometrias = 0;
  const origem = dados => {
    const matriz = dados.cab.coord;
    if (!Array.isArray(matriz) || matriz.length !== 16 || !matriz.every(Number.isFinite)) {
      throw new Error('Um dos modelos precisa ser reconvertido para recuperar sua referência de coordenadas.');
    }
    return new TH.Matrix4().fromArray(matriz);
  };
  const referencia = origem(primeiro);
  const instancia = new TH.Matrix4();
  for (const { mod, dados } of fontes) {
    const correcao = referencia.clone().multiply(origem(dados).invert());
    const inicioMatrizes = offsets.imat;
    for (const k of Object.keys(a)) {
      a[k].set(dados.a[k], offsets[k]);
      if (k === 'iel' || k === 'igeo') {
        const ajuste = k === 'iel' ? elementos : geometrias;
        for (let i = offsets[k]; i < offsets[k] + dados.a[k].length; i++) a[k][i] += ajuste;
      }
      offsets[k] += dados.a[k].length;
    }
    for (let i = inicioMatrizes; i < offsets.imat; i += 12) {
      const m = a.imat;
      instancia.set(m[i],m[i+3],m[i+6],m[i+9],m[i+1],m[i+4],m[i+7],m[i+10],m[i+2],m[i+5],m[i+8],m[i+11],0,0,0,1);
      instancia.premultiply(correcao);
      for (let c = 0; c < 4; c++) for (let r = 0; r < 3; r++) m[i+c*3+r] = instancia.elements[c*4+r];
    }
    const offsetTexto = s.length;
    for (const texto of dados.s) s.push(texto);
    for (let i = 0; i < dados.n; i++) {
      for (const k of ['cls', 'nome', 'marca', 'fase', 'pav', 'pos']) if (e[k] && dados.e[k]) e[k].push(dados.e[k][i] + offsetTexto);
      if (e.peso && dados.e.peso) e.peso.push(dados.e.peso[i] || 0);
      e.xid.push(dados.e.xid[i]);
      e.guid.push(dados.e.guid[i]);
      e.pai.push(dados.e.pai[i] < 0 ? -1 : dados.e.pai[i] + elementos);
      raiz[elementos + i] = dados.raiz[i] + elementos;
    }
    guidPorModelo.set(mod.id, new Map(Array.from(dados.guidDe, ([guid, i]) => [guid, i + elementos])));
    cab.n_unid += dados.cab.n_unid;
    elementos += dados.n;
    geometrias += dados.a.gvert.length;
  }
  return { a, e, s, raiz, guidPorModelo, cab, n: elementos, nInst: total('nInst'), nGeo: total('nGeo') };
}

async function m3dAbrirJuntos(modelos) {
  if (M3.carregando || modelos.length < 2) return;
  M3.carregando = true;
  M3.juntos = true;
  M3.ap = null; M3.carga = null; M3._real = null;   // vista conjunta: sem apontamento de campo (cada modelo tem os seus)
  if (M3.cores === 'real') M3.cores = 'orig';
  M3.modeloId = 0;
  M3.sel.clear(); M3.ocultos.clear(); M3.isolados = null; M3.props = null;
  M3.grupos = []; M3.filtroGrupos.clear();
  m3dLimparCena();
  $('#m3dModelo').selectedIndex = -1;
  $('#m3dExcluirModelo').disabled = true;
  $('#m3dTotalJuntos').textContent = 'Abrindo ' + modelos.length + ' IFCs…';
  m3dPaineis();
  try {
    const TH = M3.TH || (M3.TH = await import('./vendor/m3d/three.m3d.js?v=' + M3D_VER));
    const fontes = [], grupos = [];
    for (const mod of modelos) {
      const { geo } = await m3dBaixarModelo(mod);
      fontes.push({ mod, dados: m3dLerGeo(geo) });
      const r = await m3dGet('acao=grupos&modelo=' + mod.id);
      grupos.push(...r.grupos.map(g => ({ ...g, modeloVista: mod.id })));
    }
    m3dAviso('<span class="m3d-gira"></span> Montando a visualização conjunta…');
    M3.d = m3dCombinarDados(fontes, TH);
    fontes.length = 0;
    await m3dMontarCena();
    M3.grupos = grupos;
    m3dIndexarGrupos();
    m3dVistaPadrao('iso');
    m3dPintar();
    m3dAviso('');
    $('#m3dTotalJuntos').textContent = modelos.length + ' IFCs na vista conjunta';
  } catch (e) {
    m3dLimparCena();
    $('#m3dTotalJuntos').textContent = '';
    m3dAviso('<b>Não foi possível abrir os modelos juntos.</b><br>' + esc(e.message), true);
  } finally {
    M3.carregando = false;
    m3dPaineis();
  }
}

function m3dLigarJuntar() {
  const dlg = $('#m3dDlgJuntar'), lista = $('#m3dListaJuntar'), confirmar = $('#m3dConfirmaJuntar');
  const marcados = () => [...lista.querySelectorAll('input:checked')].map(el => Number(el.value));
  $('#m3dJuntar').addEventListener('click', () => {
    if (M3.carregando) return;
    lista.innerHTML = '<legend>Modelos da obra</legend>' + M3.estado.modelos.map(m =>
      '<label style="display:block;padding:4px"><input type="checkbox" value="' + m.id + '"' +
      (m.id === M3.modeloId ? ' checked' : '') + '> ' + esc(m.nome) + '</label>').join('');
    confirmar.disabled = true;
    dlg.showModal();
  });
  lista.addEventListener('change', () => { confirmar.disabled = marcados().length < 2; });
  $('#m3dCancelaJuntar').addEventListener('click', () => dlg.close());
  $('#m3dFormJuntar').addEventListener('submit', ev => {
    ev.preventDefault();
    const ids = new Set(marcados());
    if (ids.size < 2) return;
    dlg.close();
    m3dAbrirJuntos(M3.estado.modelos.filter(m => ids.has(m.id)));
  });
}

function m3dConverter(ifc) {
  return new Promise((ok, falha) => {
    let w;
    try {
      w = new Worker('m3d_conversor.js?v=' + M3D_VER, { type: 'module' });
    } catch (e) {
      falha(new Error('Este navegador não consegue converter o IFC. Use Chrome, Edge, Firefox ou Safari atualizados.'));
      return;
    }
    const t0 = Date.now(), st = { txt: 'Preparando…', conj: 0, kg: 0, etapas: 0, eixos: 0, etapa: '', feitas: 0, total: 0, resumo: false };
    const pintar = () => {
      const seg = Math.round((Date.now() - t0) / 1000), pct = st.total ? Math.min(99, Math.round(st.feitas / st.total * 100)) : 0;
      const num = (v, r) => `<div><b>${v}</b><span>${r}</span></div>`;
      m3dAviso(`<div class="m3d-conv"><div class="m3d-conv-tit"><span class="m3d-gira"></span> Lendo o IFC <small>(só na primeira vez · ${seg} s)</small></div>
        <div class="m3d-conv-num">${num(st.conj.toLocaleString('pt-BR'), 'peças montáveis')}${num(st.kg ? nf(st.kg / 1000, 1) + ' t' : '—', 'toneladas')}${num(st.etapas, 'etapas de montagem')}${num(st.eixos, 'eixos')}</div>
        <div class="m3d-conv-linha">${st.total ? `Montando a geometria · ${st.feitas.toLocaleString('pt-BR')} componentes (${pct}%)` : st.etapa ? 'Lendo etapa ' + esc(st.etapa) + '…' : esc(st.txt)}</div>
        <div class="m3d-conv-barra"><i style="width:${st.total ? pct : st.resumo ? 8 : 3}%"></i></div>
        <small>Modelos grandes levam 1 a 2 minutos. Mantenha esta aba aberta.</small></div>`);
    };
    pintar();
    const rel = setInterval(pintar, 1000);
    const fim = () => { clearInterval(rel); w.terminate(); };
    w.onmessage = ev => {
      const m = ev.data;
      if (m.t === 'prog') { st.txt = m.txt; pintar(); }
      else if (m.t === 'resumo') { Object.assign(st, { conj: m.conj, kg: m.kg, etapas: m.etapas, eixos: m.eixos, etapa: m.etapa, resumo: true }); pintar(); }
      else if (m.t === 'geo') { st.feitas = m.feitas; st.total = m.total; pintar(); }
      else if (m.t === 'ok') { fim(); ok(m); }
      else { fim(); falha(new Error(m.txt || 'Falha na conversão do IFC.')); }
    };
    w.onerror = ev => { fim(); falha(new Error('Falha ao carregar o conversor de IFC' + (ev && ev.message ? ': ' + ev.message : '.'))); };
    w.postMessage({ ifc }, [ifc]);
  });
}

async function m3dGravarCache(id, conv) {
  try {
    const props = await m3dCompactar(conv.props.slice(0)), geo = await m3dCompactar(conv.geo.slice(0));
    await m3dEnviarPartes(`acao=cache&id=${id}&tipo=props`, props);
    await m3dEnviarPartes(`acao=cache&id=${id}&tipo=geo&elementos=${conv.elementos}&unidades=${conv.unidades}`, geo);
    const m = M3.estado.modelos.find(x => x.id === id);
    if (m) { m.cache = 1; m.elementos = conv.elementos; m.unidades = conv.unidades; }
  } catch (e) {
    toast('O modelo abriu, mas não consegui guardar a conversão no servidor: ' + e.message, true);
  }
}

function m3dLerGeo(buf) {
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x3144334d) throw new Error('Arquivo de modelo convertido inválido.');
  const nCab = dv.getUint32(4, true);
  const cab = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, nCab)));
  let o = 8 + nCab + (4 - nCab % 4) % 4;
  const tipos = { Float32Array, Int8Array, Uint32Array, Uint8Array }, a = {};
  cab.secs.forEach(s => { a[s.n] = new tipos[s.t](buf, o, s.len); o += s.bytes + (4 - s.bytes % 4) % 4; });
  const e = cab.els, n = cab.n_el, raiz = new Int32Array(n);
  for (let i = 0; i < n; i++) { let r = i, g = 0; while (e.pai[r] >= 0 && g++ < 20) r = e.pai[r]; raiz[i] = r; }
  const guidDe = new Map();
  for (let i = 0; i < n; i++) if (e.guid[i]) guidDe.set(e.guid[i], i);
  return { cab, a, e, s: cab.s, n, nGeo: cab.n_el_geo, nInst: cab.n_inst, raiz, guidDe };
}

// ---------------------------------------------------------------- cena 3D
function m3dLimparCena() {
  m3dParar();
  const T = M3.T;
  if (T && T.malha) { T.cena.remove(T.malha); T.malha.dispose(); T.malha = null; }
  m3dEixosRemover();
  M3.d = null;
  M3.corte = null; M3.medindo = false; M3.pontos = [];
  m3dAtualizarFerramentas();
  if (T) m3dDesenhar();
}

async function m3dMontarCena() {
  const TH = M3.TH || (M3.TH = await import('./vendor/m3d/three.m3d.js?v=' + M3D_VER));
  let T = M3.T;
  if (!T) {
    const canvas = $('#m3dCanvas');
    const rend = new TH.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    rend.localClippingEnabled = true;
    rend.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    const cena = new TH.Scene();
    const cam = new TH.PerspectiveCamera(45, 1, 0.1, 5000);
    cena.add(new TH.HemisphereLight(0xffffff, 0x7c8798, 1.5));
    const luz = new TH.DirectionalLight(0xffffff, 1.6);
    luz.position.set(0.4, 0.8, 1);
    cam.add(luz);
    cena.add(cam);
    const ctrl = new TH.OrbitControls(cam, canvas);
    ctrl.enableDamping = false;
    ctrl.zoomToCursor = true;
    ctrl.addEventListener('change', () => { m3dPlanos(); m3dDesenhar(); });
    T = M3.T = { rend, cena, cam, ctrl, raio: new TH.Raycaster(), malha: null, pend: false };
    new ResizeObserver(() => m3dRedimensionar()).observe($('#m3dVista'));
    m3dEventosVista(canvas);
  }
  const d = M3.d, a = d.a, nG = a.gvert.length;
  let tv = 0, ti = 0;
  for (let g = 0; g < nG; g++) { tv += a.gvert[g]; ti += a.gidx[g]; }
  const mat = new TH.MeshLambertMaterial({ side: TH.DoubleSide });
  const malha = new TH.BatchedMesh(d.nInst, tv, ti, mat);
  malha.perObjectFrustumCulled = true;
  malha.sortObjects = false;
  // caixa de cada forma (no espaço dela) → centro e raio de cada instância no mundo: usados na caixa de seleção e no enquadramento
  const gCx = new Float32Array(nG * 4), gid = new Int32Array(nG);
  const limitesFormas = [];
  let ov = 0, oi = 0;
  for (let g = 0; g < nG; g++) {
    const nv = a.gvert[g], ni = a.gidx[g];
    const pos = a.pos.subarray(ov * 3, (ov + nv) * 3);
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < pos.length; i += 3) {
      const x = pos[i], y = pos[i + 1], z = pos[i + 2];
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
    }
    gCx[g * 4] = (x0 + x1) / 2; gCx[g * 4 + 1] = (y0 + y1) / 2; gCx[g * 4 + 2] = (z0 + z1) / 2;
    gCx[g * 4 + 3] = Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 2;
    const geo = new TH.BufferGeometry();
    geo.setAttribute('position', new TH.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new TH.BufferAttribute(a.nor.subarray(ov * 3, (ov + nv) * 3), 3, true));
    geo.setIndex(new TH.BufferAttribute(a.idx.subarray(oi, oi + ni), 1));
    limitesFormas[g] = new TH.Box3(new TH.Vector3(x0, y0, z0), new TH.Vector3(x1, y1, z1));
    gid[g] = malha.addGeometry(geo);
    ov += nv; oi += ni;
    if (g % 400 === 399) await new Promise(r => setTimeout(r, 0));
  }
  const m4 = new TH.Matrix4(), v = new TH.Vector3(), cor = new TH.Color();
  const centro = new Float32Array(d.nInst * 4), base = new Float32Array(d.nInst * 3);
  const caixa = new TH.Box3();
  const limitesCorte = new TH.Box3(), limiteInst = new TH.Box3();
  for (let i = 0; i < d.nInst; i++) {
    const t = a.imat, o = i * 12, g = a.igeo[i];
    m4.set(t[o], t[o + 3], t[o + 6], t[o + 9], t[o + 1], t[o + 4], t[o + 7], t[o + 10], t[o + 2], t[o + 5], t[o + 8], t[o + 11], 0, 0, 0, 1);
    const id = malha.addInstance(gid[g]);   // os ids saem em sequência: instância i = id i
    malha.setMatrixAt(id, m4);
    cor.setRGB(a.icor[i * 4] / 255, a.icor[i * 4 + 1] / 255, a.icor[i * 4 + 2] / 255, TH.SRGBColorSpace);
    base[i * 3] = cor.r; base[i * 3 + 1] = cor.g; base[i * 3 + 2] = cor.b;
    malha.setColorAt(id, cor);
    v.set(gCx[g * 4], gCx[g * 4 + 1], gCx[g * 4 + 2]).applyMatrix4(m4);
    const esc3 = Math.cbrt(Math.abs(m4.determinant())) || 1;
    centro[i * 4] = v.x; centro[i * 4 + 1] = v.y; centro[i * 4 + 2] = v.z; centro[i * 4 + 3] = gCx[g * 4 + 3] * esc3;
    caixa.expandByPoint(v);
    limitesCorte.union(limiteInst.copy(limitesFormas[g]).applyMatrix4(m4));
  }
  // instâncias de cada elemento e de cada conjunto (raiz), em listas compactas
  const nEl = d.n, cEl = new Uint32Array(nEl + 1), cRz = new Uint32Array(nEl + 1);
  for (let i = 0; i < d.nInst; i++) { cEl[a.iel[i] + 1]++; cRz[d.raiz[a.iel[i]] + 1]++; }
  for (let i = 0; i < nEl; i++) { cEl[i + 1] += cEl[i]; cRz[i + 1] += cRz[i]; }
  const lEl = new Uint32Array(d.nInst), lRz = new Uint32Array(d.nInst), pE = cEl.slice(0, nEl), pR = cRz.slice(0, nEl);
  for (let i = 0; i < d.nInst; i++) { lEl[pE[a.iel[i]]++] = i; lRz[pR[d.raiz[a.iel[i]]]++] = i; }
  Object.assign(d, { centro, base, caixa, limitesCorte, cEl, lEl, cRz, lRz, iel: a.iel.slice() });
  d.a = null;   // solta a geometria crua: a placa de vídeo já tem a cópia
  d.grupoDeEl = new Int32Array(nEl).fill(-1);
  T.malha = malha;
  T.cena.add(malha);
  m3dAtualizarFerramentas();
  m3dRedimensionar();
}

function m3dRedimensionar() {
  const T = M3.T, v = $('#m3dVista');
  if (!T || !v || !v.clientWidth) return;
  const w = v.clientWidth, h = v.clientHeight;
  if (T.w === w && T.h === h) return;
  T.w = w; T.h = h;
  T.rend.setSize(w, h, false);
  T.cam.aspect = w / h;
  T.cam.updateProjectionMatrix();
  m3dDesenhar();
}
function m3dDesenhar() {
  const T = M3.T;
  if (!T || T.pend) return;
  T.pend = true;
  requestAnimationFrame(() => {
    T.pend = false;
    if (!$('#m3dVista').clientWidth) return;
    T.rend.render(T.cena, T.cam);
    m3dDesenharCota();
  });
}
function m3dPlanos() {   // perto/longe acompanham a distância: evita "serrilhado de profundidade" em modelos grandes
  const T = M3.T, d = M3.d;
  if (!T || !d) return;
  const tam = d.caixa.getSize(new M3.TH.Vector3()).length() || 10, dist = T.cam.position.distanceTo(T.ctrl.target);
  T.cam.near = Math.max(0.02, Math.min(dist / 200, tam / 500));
  T.cam.far = dist + tam * 2;
  T.cam.updateProjectionMatrix();
}

/** Instâncias de um item selecionável (conjunto = todas as peças dele; peça = só ela). */
function m3dInstDe(item, fn) {
  const d = M3.d, rz = d.e.pai[item] < 0;
  const c = rz ? d.cRz : d.cEl, l = rz ? d.lRz : d.lEl;
  for (let k = c[item]; k < c[item + 1]; k++) fn(l[k]);
}
function m3dItemDeInst(i) { const el = M3.d.iel[i]; return M3.modo === 'conj' ? M3.d.raiz[el] : el; }

function m3dVistaPadrao(qual) {
  const T = M3.T, d = M3.d, TH = M3.TH;
  if (!T || !d) return;
  const cx = new TH.Box3();
  if (qual === 'enq' && M3.sel.size) {
    const v = new TH.Vector3();
    M3.sel.forEach(it => m3dInstDe(it, i => { const r = d.centro[i * 4 + 3]; v.set(d.centro[i * 4], d.centro[i * 4 + 1], d.centro[i * 4 + 2]); cx.expandByPoint(v.clone().addScalar(r)); cx.expandByPoint(v.clone().addScalar(-r)); }));
  } else {
    cx.copy(d.caixa);
  }
  if (cx.isEmpty()) return;
  const c = cx.getCenter(new TH.Vector3()), raio = Math.max(cx.getSize(new TH.Vector3()).length() / 2, 0.5);
  const dist = raio / Math.sin((T.cam.fov * Math.PI / 180) / 2) * (T.cam.aspect < 1 ? 1 / T.cam.aspect : 1) * 0.72;
  let dir;
  if (qual === 'topo') dir = new TH.Vector3(0, 1, 0.0001);
  else if (qual === 'frente') dir = new TH.Vector3(0, 0, 1);
  else if (qual === 'lado') dir = new TH.Vector3(1, 0, 0);
  else if (qual === 'enq') dir = T.cam.position.clone().sub(T.ctrl.target).normalize();
  else dir = new TH.Vector3(0.75, 0.6, 0.9).normalize();
  if (!dir.lengthSq()) dir.set(0.75, 0.6, 0.9).normalize();
  T.ctrl.target.copy(c);
  T.cam.position.copy(c).addScaledVector(dir, dist);
  T.cam.near = dist / 200; T.cam.far = dist + raio * 4;
  T.cam.updateProjectionMatrix();
  T.ctrl.update();
  m3dPlanos();
  m3dDesenhar();
}


function m3dAtualizarFerramentas() {
  const pronto = !!M3.T?.malha && !!M3.d?.limitesCorte;
  $('#m3dCortar').disabled = !pronto;
  $('#m3dMedir').disabled = !pronto;
  $('#m3dCortar').classList.toggle('ativo', !!M3.corte);
  $('#m3dCortar').setAttribute('aria-expanded', String(!!M3.corte));
  $('#m3dPainelCorte').hidden = !M3.corte;
  $('#m3dMedir').classList.toggle('ativo', M3.medindo);
  $('#m3dMedir').setAttribute('aria-pressed', String(M3.medindo));
  $('#m3dPainelMedida').hidden = !M3.medindo;
  $('#m3dCanvas').style.cursor = M3.medindo ? 'crosshair' : '';
  const [a, b] = M3.pontos;
  $('#m3dMedidaStatus').textContent = b ? m3dDistancia(a, b) + ' · clique para iniciar outra medida.'
    : a ? 'Clique no segundo ponto do modelo.' : 'Clique no primeiro ponto do modelo.';
  $('#m3dLimparMedida').disabled = !a;
}

function m3dAplicarCorte() {
  const T = M3.T, corte = M3.corte;
  if (!T?.malha) return;
  if (!corte) {
    T.malha.material.clippingPlanes = null;
  } else {
    const eixo = $('#m3dEixoCorte').value;
    const proporcao = Number($('#m3dPosCorte').value) / 1000;
    const { min, max } = M3.d.limitesCorte;
    const margem = Math.max(0.000001, (max[eixo] - min[eixo]) * 0.000001);
    const posicao = min[eixo] - margem + (max[eixo] - min[eixo] + 2 * margem) * proporcao;
    const sentido = corte.invertido ? -1 : 1;
    corte.plano.normal.set(0, 0, 0);
    corte.plano.normal[eixo] = sentido;
    corte.plano.constant = -posicao * sentido;
    T.malha.material.clippingPlanes = [corte.plano];
  }
  m3dDesenhar();
}

function m3dIntersecao(p) {
  const T = M3.T, TH = M3.TH;
  if (!T?.malha || !T.w || !T.h) return null;
  T.cam.updateMatrixWorld();
  T.raio.setFromCamera(new TH.Vector2(p[0] / T.w * 2 - 1, 1 - p[1] / T.h * 2), T.cam);
  const plano = M3.corte?.plano;
  return T.raio.intersectObject(T.malha, false).find(hit =>
    T.malha.getVisibleAt(hit.batchId) && (!plano || (plano.normal.dot(hit.point) + plano.constant) >= -0.000001)
  ) || null;
}

function m3dDistancia(a, b) {
  const metros = a.distanceTo(b);
  return metros < 1 ? nf(metros * 1000, 2) + ' mm' : nf(metros, 3) + ' m';
}

function m3dAlternarMedida(ativa) {
  M3.medindo = ativa;
  M3.pontos = [];
  m3dAtualizarFerramentas();
  m3dDesenhar();
}

function m3dMarcarMedida(p) {
  const hit = m3dIntersecao(p);
  if (!hit) {
    toast('Clique em uma superfície visível do modelo.');
    return;
  }
  if (M3.pontos.length === 2) M3.pontos = [];
  M3.pontos.push(hit.point.clone());
  m3dAtualizarFerramentas();
  m3dDesenhar();
}

function m3dDesenharCota() {
  const T = M3.T, canvas = $('#m3dCotas'), ctx = canvas.getContext('2d');
  if (!ctx || !T.w || !T.h) return;
  const escala = T.rend.getPixelRatio();
  const w = Math.round(T.w * escala), h = Math.round(T.h * escala);
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  ctx.setTransform(escala, 0, 0, escala, 0, 0);
  ctx.clearRect(0, 0, T.w, T.h);
  m3dDesenharEixos(ctx, T);
  const [a, b] = M3.pontos.map(p => {
    const ndc = p.clone().project(T.cam);
    return ndc.z < -1 || ndc.z > 1 ? null : [(ndc.x + 1) * T.w / 2, (1 - ndc.y) * T.h / 2];
  });
  if (a && b) {
    ctx.beginPath();
    ctx.moveTo(...a);
    ctx.lineTo(...b);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.strokeStyle = '#1d4ed8';
    ctx.lineWidth = 2;
    ctx.stroke();
    const x = (a[0] + b[0]) / 2, y = (a[1] + b[1]) / 2 - 10;
    ctx.font = 'bold 13px system-ui';
    ctx.textAlign = 'center';
    const texto = m3dDistancia(...M3.pontos), largura = ctx.measureText(texto).width + 14;
    ctx.fillStyle = '#172554';
    ctx.fillRect(x - largura / 2, y - 14, largura, 20);
    ctx.fillStyle = '#fff';
    ctx.fillText(texto, x, y);
  }
  for (const ponto of [a, b]) {
    if (!ponto) continue;
    ctx.beginPath();
    ctx.arc(ponto[0], ponto[1], 5, 0, Math.PI * 2);
    ctx.fillStyle = '#1d4ed8';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

/** Eixos do projeto na camada 2D sobre o modelo: linhas finas tracejadas e rótulos em círculo (01…20 e A…H). */
function m3dDesenharEixos(ctx, T) {
  const E = T.eixos;
  if (!E || !E.visible) return;
  const tela = p => { const n = p.clone().project(T.cam); return n.z < -1 || n.z > 1 ? null : [(n.x + 1) * T.w / 2, (1 - n.y) * T.h / 2]; };
  ctx.save();
  ctx.strokeStyle = 'rgba(71, 85, 105, .55)'; ctx.lineWidth = 1; ctx.setLineDash([6, 5]);
  E.linhas.forEach(([a, b]) => { const p = tela(a), q = tela(b); if (!p || !q) return; ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke(); });
  ctx.setLineDash([]);
  ctx.font = 'bold 11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  E.rotulos.forEach(([txt, pos]) => {
    const p = tela(pos);
    if (!p || p[0] < -20 || p[1] < -20 || p[0] > T.w + 20 || p[1] > T.h + 20) return;
    ctx.beginPath(); ctx.arc(p[0], p[1], 11, 0, Math.PI * 2);
    ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#1e293b'; ctx.stroke();
    ctx.fillStyle = '#0f172a'; ctx.fillText(txt, p[0], p[1] + 0.5);
  });
  ctx.restore();
}
function m3dLigarFerramentas() {
  const inverter = $('#m3dInverterCorte');
  $('#m3dCortar').addEventListener('click', () => {
    M3.corte = M3.corte ? null : { plano: { normal: new M3.TH.Vector3(), constant: 0 }, invertido: false };
    inverter.setAttribute('aria-pressed', 'false');
    m3dAtualizarFerramentas();
    m3dAplicarCorte();
  });
  $('#m3dEixoCorte').addEventListener('change', m3dAplicarCorte);
  $('#m3dPosCorte').addEventListener('input', m3dAplicarCorte);
  inverter.addEventListener('click', () => {
    if (!M3.corte) return;
    M3.corte.invertido = !M3.corte.invertido;
    inverter.setAttribute('aria-pressed', String(M3.corte.invertido));
    m3dAplicarCorte();
  });
  $('#m3dMedir').addEventListener('click', () => m3dAlternarMedida(!M3.medindo));
  $('#m3dLimparMedida').addEventListener('click', () => m3dAlternarMedida(true));
}

// ---------------------------------------------------------------- seleção (clique, Shift, caixa)
function m3dEventosVista(canvas) {
  let ini = null, caixa = false;
  const vista = $('#m3dVista'), ret = $('#m3dCaixaSel');
  const local = ev => { const r = canvas.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; };
  canvas.addEventListener('pointerdown', ev => {
    if (ev.button !== 0 || !M3.d) return;
    ini = local(ev);
    caixa = !M3.medindo && (ev.shiftKey || M3.caixa);
    if (caixa) {   // a caixa de seleção toma o arrasto: a câmera fica parada
      M3.T.ctrl.enabled = false;
      ev.stopImmediatePropagation();
      canvas.setPointerCapture(ev.pointerId);
    }
  }, true);
  canvas.addEventListener('pointermove', ev => {
    if (!ini || !caixa) return;
    const p = local(ev);
    if (Math.hypot(p[0] - ini[0], p[1] - ini[1]) < 5) return;
    ret.hidden = false;
    ret.style.left = Math.min(p[0], ini[0]) + 'px'; ret.style.top = Math.min(p[1], ini[1]) + 'px';
    ret.style.width = Math.abs(p[0] - ini[0]) + 'px'; ret.style.height = Math.abs(p[1] - ini[1]) + 'px';
  });
  const fim = ev => {
    if (!ini) return;
    const p = local(ev), a = ini, arrastou = Math.hypot(p[0] - a[0], p[1] - a[1]) >= 5;
    ini = null;
    ret.hidden = true;
    M3.T.ctrl.enabled = true;
    if (ev.type === 'pointercancel') return;
    const somar = ev.shiftKey || M3.somar, alternar = ev.ctrlKey || ev.metaKey;
    if (caixa && arrastou) m3dSelCaixa(a, p, somar || M3.caixa && M3.somar, alternar);
    else if (!arrastou && M3.medindo) m3dMarcarMedida(p);
    else if (!arrastou) m3dSelClique(p, somar, alternar);
  };
  canvas.addEventListener('pointerup', fim);
  canvas.addEventListener('pointercancel', fim);
  vista.addEventListener('contextmenu', ev => ev.preventDefault());
  document.addEventListener('keydown', ev => {
    if (ev.key !== 'Escape' || $('#aba-m3d').hidden || document.querySelector('dialog[open]')) return;
    if (M3.medindo) { m3dAlternarMedida(false); return; }
    if (!M3.sel.size) return;
    M3.sel.clear(); m3dPintar(); m3dPainelSel();
  });
}

function m3dSelClique(p, somar, alternar) {
  const hit = m3dIntersecao(p);
  const item = hit ? m3dItemDeInst(hit.batchId) : -1;
  if (item < 0) {
    if (somar || alternar) return;
    M3.sel.clear();
  } else if (alternar || somar) {
    if (M3.sel.has(item) && (alternar || M3.somar)) M3.sel.delete(item); else M3.sel.add(item);
  } else {
    M3.sel.clear(); M3.sel.add(item);
  }
  m3dPintar();
  m3dPainelSel();
}

function m3dSelCaixa(a, b, somar, alternar) {   // tudo o que está visível e tem o centro dentro do retângulo (inclui o que está atrás)
  const T = M3.T, d = M3.d, TH = M3.TH;
  const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
  T.cam.updateMatrixWorld();
  const mp = new TH.Matrix4().multiplyMatrices(T.cam.projectionMatrix, T.cam.matrixWorldInverse).elements;
  if (!somar && !alternar) M3.sel.clear();
  const achados = new Set();
  const plano = M3.corte?.plano, centro = plano ? new TH.Vector3() : null;
  for (let i = 0; i < d.nInst; i++) {
    if (!T.malha.getVisibleAt(i)) continue;
    const x = d.centro[i * 4], y = d.centro[i * 4 + 1], z = d.centro[i * 4 + 2];
    if (plano && (plano.normal.dot(centro.set(x, y, z)) + plano.constant) < 0) continue;
    const w = mp[3] * x + mp[7] * y + mp[11] * z + mp[15];
    if (w <= 0) continue;
    const sx = ((mp[0] * x + mp[4] * y + mp[8] * z + mp[12]) / w + 1) / 2 * T.w, sy = (1 - (mp[1] * x + mp[5] * y + mp[9] * z + mp[13]) / w) / 2 * T.h;
    if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) achados.add(m3dItemDeInst(i));
  }
  achados.forEach(it => { if (alternar && M3.sel.has(it)) M3.sel.delete(it); else M3.sel.add(it); });
  m3dPintar();
  m3dPainelSel();
  if (!achados.size) toast('Nenhum elemento dentro da caixa.');
}

// ---------------------------------------------------------------- grupos, situação e cores
function m3dIndexarGrupos() {
  const d = M3.d;
  if (!d) return;
  d.grupoDeEl.fill(-1);
  M3.grupos.forEach((g, k) => {
    g.itens = [];
    g.guids.forEach(gu => { const i = (g.modeloVista ? d.guidPorModelo.get(g.modeloVista) : d.guidDe).get(gu); if (i !== undefined) { d.grupoDeEl[i] = k; g.itens.push(i); } });
  });
}
function m3dGrupoDeItem(item) {   // peça sem vínculo próprio segue o grupo do conjunto
  const d = M3.d, g = d.grupoDeEl[item];
  return g >= 0 ? g : d.grupoDeEl[d.raiz[item]];
}
/** Situação do grupo numa data (simulação): antes | montando | feito | previsto | atrasado. */
function m3dSituacaoEm(g, dia, hj) {
  if (!g.inicio || !g.fim) return 'sem';
  if (g.status === 'concluido') {
    const c = g.concluido_em || g.fim;
    return dia >= c ? 'feito' : dia < g.inicio ? 'antes' : 'montando';
  }
  if (dia < g.inicio) return 'antes';
  if (dia <= g.fim) return 'montando';
  return hj > g.fim ? 'atrasado' : 'previsto';
}
/** Situação de hoje para a lista: concluido | atrasado | em_andamento | nao_iniciado (+ texto). */
function m3dSituacaoHoje(g) {
  const hj = m3dHoje();
  if (g.status === 'concluido') return ['concluido', 'Concluída' + (g.concluido_em ? ' em ' + fdA(g.concluido_em) : '')];
  if (!g.inicio) return ['sem', 'Sem prazo'];
  if (g.fim && hj > g.fim) return ['atrasado', 'Atrasada · ' + diasEntre(g.fim, hj) + ' dia(s) após o término'];
  if (g.status === 'nao_iniciado' && g.inicio && hj > g.inicio) return ['atrasado', 'Atrasada · deveria ter iniciado em ' + fdA(g.inicio)];
  return g.status === 'em_andamento' ? ['em_andamento', 'Em andamento'] : ['nao_iniciado', 'Não iniciada'];
}

function m3dPecasApontadas() {
  return new Set(((typeof T !== 'undefined' && T?.apontamentos) || [])
    .filter(a => a.tipo === 'PECA' && a.letra && a.data && a.data <= M3.dia)
    .map(a => a.letra));
}

function m3dPintar() {
  const T = M3.T, d = M3.d;
  if (!T || !T.malha || !d) return;
  const TH = M3.TH, cores = {}, hj = m3dHoje(), q = { antes: 0, montando: 0, feito: 0, previsto: 0, atrasado: 0, sem: 0 };
  Object.keys(M3D_COR).forEach(k => { cores[k] = new TH.Color(m3dCor(k)); });
  const sit = M3.grupos.map(g => m3dSituacaoEm(g, M3.dia, hj));
  const montadas = m3dPecasApontadas();
  const destacandoGrupos = M3.filtroGrupos.size > 0;
  const contexto = new TH.Color('#87929f');
  const c = new TH.Color(), sel = M3.sel, m4 = M3.cores === '4d', mr = M3.cores === 'real', contou = new Uint8Array(d.n);
  const R = m3dStatusReal(), rc = M3D_RC.map(x => new TH.Color(x));
  for (let i = 0; i < d.nInst; i++) {
    const el = d.iel[i], rz = d.raiz[el];
    const grupo = m3dGrupoDeItem(el);
    const fora = destacandoGrupos && !M3.filtroGrupos.has(M3.grupos[grupo]?.id);
    const montada = montadas.has(d.e.guid[el]) || montadas.has(d.e.guid[rz]);
    const situacao = montada ? 'feito' : (sit[grupo] || 'sem');
    let vis = true;
    if (fora) {
      c.copy(contexto);
    } else if (!montada && (sel.has(el) || sel.has(rz))) {
      c.copy(cores.sel);
    } else {
      if (M3.ocultos.has(el) || M3.ocultos.has(rz) || (M3.isolados && !M3.isolados.has(el) && !M3.isolados.has(rz))) vis = false;
      if (mr) {
        c.copy(rc[R.st[rz]]);
      } else if (m4) {
        const s = situacao;
        if (!destacandoGrupos && s === 'antes' && !M3.antes) vis = false;
        if (!destacandoGrupos && s === 'sem' && !M3.semPrazo) vis = false;
        c.copy(cores[s]);
      } else {
        c.setRGB(d.base[i * 3], d.base[i * 3 + 1], d.base[i * 3 + 2]);
      }
    }
    if (m4 && !fora && !contou[el]) { contou[el] = 1; q[situacao]++; }
    T.malha.setVisibleAt(i, destacandoGrupos || vis);
    T.malha.setColorAt(i, c);
  }
  M3.contagem = q;
  m3dContagem();
  m3dVitrine(R);
  m3dDesenhar();
}

// ---------------------------------------------------------------- situação real (campo + carga)
/** Peso de cada peça montável (kg), calculado uma vez: o próprio, ou a soma dos componentes. */
function m3dPesosRaiz() {
  const d = M3.d, e = d.e;
  if (d.pesoRz) return d.pesoRz;
  const soma = new Float64Array(d.n), p = new Float64Array(d.n);
  if (e.peso) for (let k = 0; k < d.nGeo; k++) { const r = d.raiz[k]; if (r !== k) soma[r] += e.peso[k] || 0; }
  for (let i = 0; i < d.n; i++) if (e.pai[i] < 0) p[i] = (e.peso && e.peso[i]) || soma[i];
  return (d.pesoRz = p);
}
/** TAG de carga da peça montável: a marca; peça sem marca no modelo (telha "nd07"…) usa o nome do tipo. */
function m3dChaveCarga(i) {
  const m = m3dTxt('marca', i).trim();
  return (!m || /^nd\d*/i.test(m) ? (m3dTxt('nome', i).trim() || 'PEÇA') : m).toUpperCase();
}
function m3dIsoBr(t) {
  t = String(t || '').trim();
  if (typeof dataRemessaIso === 'function') { const v = dataRemessaIso(t); if (v) return v; }
  const m = t.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : '';
}
// ---------------------------------------------------------------- integração com a aba Apontar montagem
// O que é apontado na aba (joists por rua, vigas por eixo, contraventamento, fechamento lateral, marquise, telhas e peças do
// mapa da obra importada) vale no 3D como peça MONTADA (içada e torqueada) na data do apontamento. A ligação usa o código de
// posição do Tekla de cada peça ("05/C-B", "12-12a/H", "01/F2-E2"…) e a malha do projeto (eixos e estações em mm).
function m3dPosParse(t) {
  const m = String(t || '').match(/^([0-9]{2}a?)(?:-([0-9]{2}a?))?\/(.+)$/);
  if (!m) return null;
  const est = m[3].replace(/[<>]/g, '').split('-').filter(Boolean);
  return { e1: m[1], e2: m[2] || m[1], est, lado: /^</.test(m[3]) ? '<H' : />$/.test(m[3]) ? 'A>' : '' };
}
function m3dRuaDe(p) {   // eixos "12-12a", "12a-13", "11-12" ou "12" → rua 12-13 (só o eixo 20 vira 19-20)
  const n = t => parseInt(t, 10) + (/a$/.test(t) ? 0.5 : 0);
  const base = Math.min(19, Math.max(1, Math.floor(Math.min(n(p.e1), n(p.e2)))));
  const f = x => String(x).padStart(2, '0');
  return `${f(base)}-${f(base + 1)}`;
}
function m3dFaixaDe(mm, est) {   // posição transversal (mm) → faixa AB…GH
  const L = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  for (let k = 0; k < 7; k++) if (mm <= est[L[k + 1]]) return L[k] + L[k + 1];
  return 'GH';
}
function m3dAbaAssinatura() {
  const a = (typeof T !== 'undefined' && T && T.apontamentos) || [];
  return a.length + '|' + a.reduce((m, x) => Math.max(m, +x.linha || +x.id || 0), 0) + '|' + a.reduce((m, x) => (x.data > m ? x.data : m), '');
}
async function m3dLerAba() {
  M3._abaSig = m3dAbaAssinatura();
  M3.aba = null;
  const d = M3.d, apts = (typeof T !== 'undefined' && T && T.apontamentos) || [];
  if (!d || !apts.length || M3.juntos) return;
  const data = new Array(d.n).fill(''), orig = new Array(d.n).fill('');
  const marcar = (i, dia, txt) => { if (!data[i] || dia < data[i]) { data[i] = dia; orig[i] = txt; } };
  // peças do mapa da obra importada: o apontamento guarda o GUID da peça
  const peca = apts.filter(a => String(a.tipo).toUpperCase() === 'PECA' && a.data);
  peca.forEach(a => [a.letra, a.viga_id].forEach(g => { const i = g && d.guidDe.get(g); if (i !== undefined && i !== null && i !== '') marcar(d.raiz[i], a.data, 'peça do mapa'); }));
  const outros = apts.filter(a => String(a.tipo).toUpperCase() !== 'PECA' && a.data);
  if (outros.length) {
    let fm = null, rg = null;
    try {
      [fm, rg] = await Promise.all([
        window._frentes ? window._frentes : fetch(API + 'frentes-montagem', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null),
        window._regras_baixa ? window._regras_baixa : fetch(API + 'regras-baixa', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null)]);
    } catch (e) { fm = null; }
    const malha = fm && fm.malha, est = malha && malha.estacoes_mm, eix = malha && malha.eixos_mm;
    if (est && eix) {
      // índice das peças montáveis por posição
      const cel = new Map(), add = (k, i) => { if (!cel.has(k)) cel.set(k, []); cel.get(k).push(i); };
      const vigasEixo = new Map(), suportes = [], vcEixo = new Map();
      for (let i = 0; i < d.n; i++) {
        if (d.e.pai[i] >= 0 || d.cRz[i + 1] <= d.cRz[i]) continue;
        const p = m3dPosParse(m3dTxt('pos', i));
        if (!p) continue;
        const nome = m3dTxt('nome', i).toUpperCase(), fase = m3dTxt('fase', i);
        const mm = p.est.map(x => est[x]).filter(x => x !== undefined), meio = mm.length ? (Math.min(...mm) + Math.max(...mm)) / 2 : null;
        // viga de cobertura = marca VCnn do projeto (no IFC 3 das 13 vigas de cada eixo vêm com o nome "CHAPA")
        if (p.e1 === p.e2 && /^VC\d+$/.test(m3dTxt('marca', i).trim().toUpperCase()) && /^1\.1\.1/.test(fase)) {
          if (!vcEixo.has(p.e1)) vcEixo.set(p.e1, []);
          vcEixo.get(p.e1).push([i, p.est.join('-'), meio]);
        }
        if (nome === 'VIGA COBERTURA' && p.e1 === p.e2) {
          if (!vigasEixo.has(p.e1)) vigasEixo.set(p.e1, []);
          vigasEixo.get(p.e1).push([i, p.est.join('-'), meio]);
        } else if (nome === 'SUPORTE JOIST') {
          suportes.push(i);
        } else if (/^1\.1\.1/.test(fase) && /CONTRAVENTAMENTO|SUPORTE CONT/.test(nome) && meio !== null) {
          add(`CONTRAVENTAMENTO|${m3dFaixaDe(meio, est)}|${m3dRuaDe(p)}`, i);
        } else if (/^1\.1\.2/.test(fase) || /FECHAMENTO/.test(nome)) {
          const telha = /TELHA/.test(nome), tipo = telha ? 'TELHAFECH' : 'FECHAMENTO';
          if (p.e1 === p.e2 && (p.e1 === '01' || p.e1 === '20') && meio !== null) add(`${tipo}|OITÃO ${p.e1}|${m3dFaixaDe(meio, est)}`, i);
          else if (p.est.length === 1 && (p.est[0] === 'A' || p.est[0] === 'H')) add(`${tipo}|${p.est[0]}|${m3dRuaDe(p)}`, i);
        } else if (p.lado && /MARQUISE|MÃO FRANCESA|TESTEIRA|RUFO|GRAPA/.test(nome + ' ' + fase.toUpperCase())) {
          add(`MARQUISE|${p.lado}|${m3dRuaDe(p)}`, i);
        } else if (nome === 'TELHA COBERTURA') {
          add('TELHA', i);
        }
      }
      // vigas: oitão = trecho exato do projeto; demais eixos = letra mais próxima do centro da peça (A, B, BC, C… H)
      const crit = (rg && rg.criterio_por_letra) || {}, ordem = (rg && rg.letras_ordem) || ['A', 'B', 'BC', 'C', 'CD', 'D', 'DE', 'E', 'EF', 'F', 'FG', 'G', 'H'];
      const posLetra = l => l.length === 1 ? est[l] : (est[l[0]] + est[l[1]]) / 2;
      const vigaDe = new Map(), poe = (k, i) => { if (!vigaDe.has(k)) vigaDe.set(k, []); vigaDe.get(k).push(i); };
      // oitões (01 e 20): trecho exato do projeto
      ['01', '20'].forEach(e => (vigasEixo.get(e) || []).forEach(([i, trecho]) => poe(`${e}|${trecho}`, i)));
      // demais eixos: por QUANTIDADE e LOCAÇÃO. O código de posição do Tekla não segue a letra do projeto, então as vigas de
      // cada eixo são ordenadas pela posição real (centro da peça) de A para H; eixo com as 13 vigas recebe as letras na ordem
      // (A, B, BC, C… H); eixo incompleto usa a letra mais próxima pela régua medida nos eixos completos.
      M3._vigasMapa = m3dVigasPorLocacao(vcEixo, ordem, posLetra, poe);
      // joists: o modelo não tem a joist, só os suportes dela; cada suporte vai para a rua e a posição de joist mais próximas
      const cal = suportes.length ? m3dCalibrar(eix, est, vigasEixo) : null;
      const joistDe = new Map();
      if (cal && rg && rg.layout_joists) {
        const slots = [];
        Object.keys(rg.layout_joists).filter(f => f !== 'nota').forEach(f => {
          const n = rg.layout_joists[f].length, a = est[f[0]], b = est[f[1]];
          for (let j = 0; j < n; j++) slots.push(a + (j + 0.5) * (b - a) / n);
        });
        const eixosPrinc = Object.keys(eix).filter(k => !/a$/.test(k)).sort();
        suportes.forEach(i => {
          const c = m3dCentroRaiz(i), q = cal(c);
          if (!q) return;
          let r = 0;
          while (r < eixosPrinc.length - 2 && q[0] > eix[eixosPrinc[r + 1]]) r++;
          let k = 0;
          slots.forEach((y, j) => { if (Math.abs(y - q[1]) < Math.abs(slots[k] - q[1])) k = j; });
          const key = `${eixosPrinc[r]}-${eixosPrinc[r + 1]}|${k + 1}`;
          if (!joistDe.has(key)) joistDe.set(key, []);
          joistDe.get(key).push(i);
        });
      }
      // telhas da cobertura: faixa de 0,485 m a partir do eixo 01
      const telhaDe = new Map();
      if (cal && cel.has('TELHA')) cel.get('TELHA').forEach(i => { const q = cal(m3dCentroRaiz(i)); if (!q) return; const k = Math.max(1, Math.floor(q[0] / 485) + 1); if (!telhaDe.has(k)) telhaDe.set(k, []); telhaDe.get(k).push(i); });
      const contaTf = new Map();
      outros.forEach(a => {
        const t = String(a.tipo).toUpperCase(), dia = a.data;
        if (t === 'VIGA') (vigaDe.get(`${a.eixo}|${a.letra}`) || []).forEach(i => marcar(i, dia, `viga eixo ${a.eixo} · ${a.letra}`));
        else if (t === 'JOIST') (joistDe.get(`${a.rua}|${a.slot}`) || []).forEach(i => marcar(i, dia, `joist rua ${a.rua} nº ${a.slot} (suporte)`));
        else if (t === 'TELHA') (telhaDe.get(parseInt(a.rua, 10)) || []).forEach(i => marcar(i, dia, `telha nº ${a.rua}`));
        else if (t === 'TELHAFECH') { const [tr] = String(a.rua).split('/'); const k = `TELHAFECH|${a.faixa}|${tr}`; contaTf.set(k, (contaTf.get(k) || []).concat([dia])); }
        else if (t === 'CONTRAVENTAMENTO' || t === 'FECHAMENTO' || t === 'MARQUISE') (cel.get(`${t}|${a.faixa}|${a.rua}`) || []).forEach(i => marcar(i, dia, `${t.toLowerCase()} ${a.faixa} · ${a.rua}`));
      });
      // telhas do fechamento: o apontamento conta telhas do trecho; vale para as primeiras peças do trecho
      contaTf.forEach((dias, k) => { dias.sort(); (cel.get(k) || []).slice(0, dias.length).forEach((i, j) => marcar(i, dias[j], 'telha do fechamento ' + k.split('|').slice(1).join(' · '))); });
    }
  }
  const n = data.filter(Boolean).length;
  M3.aba = n ? { data, orig, n } : null;
  M3._real = null;
}
/** Liga as vigas de cobertura dos eixos 02…19 às letras do Apontar montagem pela ordem real ao longo do eixo (A → H). */
function m3dVigasPorLocacao(vcEixo, ordem, posLetra, poe) {
  const eixos = [...vcEixo.keys()].filter(e => e !== '01' && e !== '20');
  const cent = new Map();
  eixos.forEach(e => vcEixo.get(e).forEach(([i]) => { const c = m3dCentroRaiz(i); if (c) cent.set(i, c); }));
  // direção A → H: das pontas de cada eixo (média), orientada pelo código de posição (meio em mm cresce de A para H)
  let dir = [0, 0, 0];
  eixos.forEach(e => {
    const l = vcEixo.get(e).filter(([i]) => cent.has(i));
    if (l.length < 4) return;
    let a = l[0], b = l[0], dmax = -1;
    l.forEach(x => l.forEach(y => { const c1 = cent.get(x[0]), c2 = cent.get(y[0]), dd = (c1[0] - c2[0]) ** 2 + (c1[1] - c2[1]) ** 2 + (c1[2] - c2[2]) ** 2; if (dd > dmax) { dmax = dd; a = x; b = y; } }));
    const ca = cent.get(a[0]), cb = cent.get(b[0]);
    let v = [cb[0] - ca[0], cb[1] - ca[1], cb[2] - ca[2]];
    if (dir[0] * v[0] + dir[1] * v[1] + dir[2] * v[2] < 0) v = v.map(x => -x);
    dir = dir.map((x, k) => x + v[k]);
  });
  const nd = Math.hypot(...dir);
  if (!nd) return null;
  dir = dir.map(x => x / nd);
  const proj = i => { const c = cent.get(i); return c[0] * dir[0] + c[1] * dir[1] + c[2] * dir[2]; };
  // sentido: correlação entre a projeção e o meio (mm) do código de posição
  let sxy = 0, n = 0, sx = 0, sy = 0;
  eixos.forEach(e => vcEixo.get(e).forEach(([i, , meio]) => { if (cent.has(i) && meio !== null) { const t = proj(i); sx += t; sy += meio; sxy += t * meio; n++; } }));
  const sinal = n && (sxy - sx * sy / n) < 0 ? -1 : 1;
  const t = i => sinal * proj(i);
  // régua (t → mm da estação) medida nos eixos completos
  const pares = [];
  const resumo = { completos: 0, incompletos: [] };
  eixos.forEach(e => {
    const l = vcEixo.get(e).filter(([i]) => cent.has(i)).sort((x, y) => t(x[0]) - t(y[0]));
    if (l.length === ordem.length) { resumo.completos++; l.forEach(([i], k) => pares.push([t(i), posLetra(ordem[k])])); }
  });
  let a = 1, b = 0;
  if (pares.length >= 2) {
    const m = pares.length, mx = pares.reduce((s, p) => s + p[0], 0) / m, my = pares.reduce((s, p) => s + p[1], 0) / m;
    const sxx = pares.reduce((s, p) => s + (p[0] - mx) ** 2, 0);
    a = sxx ? pares.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0) / sxx : 1; b = my - a * mx;
  }
  eixos.forEach(e => {
    const l = vcEixo.get(e).filter(([i]) => cent.has(i)).sort((x, y) => t(x[0]) - t(y[0]));
    if (l.length === ordem.length) { l.forEach(([i], k) => poe(`${e}|${ordem[k]}`, i)); return; }
    resumo.incompletos.push(`${e}: ${l.length}`);
    if (pares.length < 2) return;
    const livres = new Set(ordem);
    l.forEach(([i]) => {
      const mm = a * t(i) + b;
      let melhor = null;
      ordem.forEach(L => { if (livres.has(L) && (melhor === null || Math.abs(posLetra(L) - mm) < Math.abs(posLetra(melhor) - mm))) melhor = L; });
      if (melhor) { livres.delete(melhor); poe(`${e}|${melhor}`, i); }
    });
  });
  return resumo;
}
/** Centro (coordenadas da cena) de uma peça montável: média dos centros dos seus componentes. */
function m3dCentroRaiz(r) {
  const d = M3.d;
  let x = 0, y = 0, z = 0, n = 0;
  m3dInstDe(r, i => { x += d.centro[i * 4]; y += d.centro[i * 4 + 1]; z += d.centro[i * 4 + 2]; n++; });
  return n ? [x / n, y / n, z / n] : null;
}
/** Ajusta (mínimos quadrados) a cena 3D à malha do projeto usando as vigas de cobertura, cuja posição no projeto é conhecida pelo código. */
function m3dCalibrar(eix, est, vigasEixo) {
  const pts = [];
  vigasEixo.forEach((lista, e) => lista.forEach(([i, , meio]) => { if (eix[e] !== undefined && meio !== null) { const c = m3dCentroRaiz(i); if (c) pts.push([c, eix[e], meio]); } }));
  if (pts.length < 12) return null;
  const resolver = alvo => {   // a·x + b·y + c·z + d = alvo
    const A = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], B = [0, 0, 0, 0];
    pts.forEach(p => { const v = [p[0][0], p[0][1], p[0][2], 1]; for (let r = 0; r < 4; r++) { B[r] += v[r] * p[alvo]; for (let c = 0; c < 4; c++) A[r][c] += v[r] * v[c]; } });
    for (let c = 0; c < 4; c++) {   // eliminação de Gauss com pivô
      let pv = c;
      for (let r = c + 1; r < 4; r++) if (Math.abs(A[r][c]) > Math.abs(A[pv][c])) pv = r;
      if (Math.abs(A[pv][c]) < 1e-12) return null;
      [A[c], A[pv]] = [A[pv], A[c]]; [B[c], B[pv]] = [B[pv], B[c]];
      for (let r = 0; r < 4; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let k = c; k < 4; k++) A[r][k] -= f * A[c][k]; B[r] -= f * B[c]; }
    }
    return B.map((b, k) => b / A[k][k]);
  };
  const ka = resolver(1), kb = resolver(2);
  if (!ka || !kb) return null;
  const f = c => c ? [ka[0] * c[0] + ka[1] * c[1] + ka[2] * c[2] + ka[3], kb[0] * c[0] + kb[1] * c[1] + kb[2] * c[2] + kb[3]] : null;
  const erro = pts.reduce((s, p) => { const q = f(p[0]); return Math.max(s, Math.abs(q[0] - p[1])); }, 0);
  M3._calErro = erro;
  return erro < 3000 ? f : null;   // mais de 3 m de erro no eixo = modelo fora da malha: não liga joists e telhas
}
// ---------------------------------------------------------------- eixos do projeto no 3D (01…20 na horizontal, A…H na vertical)
// A cena do modelo é ajustada à malha do projeto (frentes-montagem: eixos e estações em mm) usando as vigas de cobertura, cuja
// posição no projeto vem do código do Tekla; depois as linhas e os rótulos dos eixos são desenhados no chão do modelo.
function m3dEixosRemover() {
  if (M3.T) M3.T.eixos = null;
}
async function m3dEixosMontar() {
  m3dEixosRemover();
  const d = M3.d, T = M3.T, TH = M3.TH;
  if (!d || !T || !TH || M3.juntos) return;
  let fm = window._frentes && window._frentes.malha ? window._frentes : null;
  if (!fm) fm = await fetch(API + 'frentes-montagem', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null);
  const malha = fm && fm.malha, eix = malha && malha.eixos_mm, est = malha && malha.estacoes_mm;
  if (!eix || !est || M3.d !== d) return;
  // pares (cena × projeto) das vigas de cobertura
  const pts = [];
  for (let i = 0; i < d.n; i++) {
    if (d.e.pai[i] >= 0 || m3dTxt('nome', i).toUpperCase() !== 'VIGA COBERTURA') continue;
    const p = m3dPosParse(m3dTxt('pos', i));
    if (!p || p.e1 !== p.e2 || eix[p.e1] === undefined) continue;
    const mm = p.est.map(x => est[x]).filter(x => x !== undefined);
    if (!mm.length) continue;
    const c = m3dCentroRaiz(i);
    if (c) pts.push([eix[p.e1], (Math.min(...mm) + Math.max(...mm)) / 2, c]);
  }
  if (pts.length < 12) return;
  // cena = a·ao_longo + b·transversal + c (um ajuste para x, outro para z); altura = topo das vigas
  const ajustar = k => {
    let s = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], t = [0, 0, 0];
    pts.forEach(([u, v, c]) => { const r = [u, v, 1]; for (let a = 0; a < 3; a++) { t[a] += r[a] * c[k]; for (let b = 0; b < 3; b++) s[a][b] += r[a] * r[b]; } });
    for (let col = 0; col < 3; col++) {
      let pv = col; for (let r = col + 1; r < 3; r++) if (Math.abs(s[r][col]) > Math.abs(s[pv][col])) pv = r;
      if (Math.abs(s[pv][col]) < 1e-9) return null;
      [s[col], s[pv]] = [s[pv], s[col]]; [t[col], t[pv]] = [t[pv], t[col]];
      for (let r = 0; r < 3; r++) if (r !== col) { const f = s[r][col] / s[col][col]; for (let q = col; q < 3; q++) s[r][q] -= f * s[col][q]; t[r] -= f * t[col]; }
    }
    return t.map((x, a) => x / s[a][a]);
  };
  let kx = ajustar(0), kz = ajustar(2);
  if (!kx || !kz) return;
  const resid = () => pts.map(([u, v, c]) => Math.hypot(kx[0] * u + kx[1] * v + kx[2] - c[0], kz[0] * u + kz[1] * v + kz[2] - c[2]));
  const L = Math.hypot(kx[0] * 1000, kz[0] * 1000);   // tamanho de 1 m do projeto na cena
  // tira as peças fora do padrão (ex.: viga com código de posição genérico) e ajusta de novo
  let r = resid(), med = r.slice().sort((a, b) => a - b)[Math.floor(r.length / 2)];
  const lim = Math.max(2 * L, 3 * med);
  for (let k = pts.length - 1; k >= 0; k--) if (r[k] > lim) pts.splice(k, 1);
  if (pts.length < 12) return;
  kx = ajustar(0); kz = ajustar(2);
  if (!kx || !kz) return;
  r = resid(); med = r.slice().sort((a, b) => a - b)[Math.floor(r.length / 2)];
  M3._eixosDiag = { mediana_m: med / L, n: pts.length };
  if (!(L > 0) || med > L) return;   // erro típico acima de 1 m: modelo fora da malha, não desenha
  let y0 = Infinity;
  for (let i = 0; i < d.nInst; i++) if (d.centro[i * 4 + 1] < y0) y0 = d.centro[i * 4 + 1];
  const P = (u, v) => new TH.Vector3(kx[0] * u + kx[1] * v + kx[2], y0, kz[0] * u + kz[1] * v + kz[2]);
  const eixosP = Object.keys(eix).filter(k => !/a$/.test(k)).sort(), letras = Object.keys(est).filter(k => /^[A-Z]$/.test(k)).sort();
  const uMax = Math.max(...Object.values(eix)), vMax = Math.max(...Object.values(est)), margem = 9000;
  const linhas = [], rotulos = [];
  eixosP.forEach(e => { const u = eix[e]; linhas.push([P(u, -margem * 0.55), P(u, vMax + margem * 0.55)]); rotulos.push([e, P(u, -margem)], [e, P(u, vMax + margem)]); });
  letras.forEach(l => { const v = est[l]; linhas.push([P(-margem * 0.55, v), P(uMax + margem * 0.55, v)]); rotulos.push([l, P(-margem, v)], [l, P(uMax + margem, v)]); });
  T.eixos = { linhas, rotulos, visible: M3.eixosVis };
  const bt = $('#m3dBtnEixos');
  if (bt) { bt.hidden = false; bt.classList.toggle('ativo', M3.eixosVis); }
  m3dDesenhar();
}
async function m3dCarregarCampo(id) {
  const d = M3.d;
  M3.ap = { ic: new Array(d.n).fill(''), tq: new Array(d.n).fill(''), inf: new Uint8Array(d.n), por: {}, n: 0 };
  try {
    const a = await m3dGet(`acao=apont&modelo=${id}`);
    a.itens.forEach(([g, et, dia, emp, inf, por]) => {
      const i = d.guidDe.get(g);
      if (i === undefined) return;
      const r = d.raiz[i];
      if (et === 2) M3.ap.tq[r] = dia; else { M3.ap.ic[r] = dia; if (inf) M3.ap.inf[r] = 1; }
      M3.ap.por[r + ':' + et] = por;
      M3.ap.n++;
    });
  } catch (e) { /* sem apontamentos: segue só com o planejado */ }
  m3dFila().forEach(m3dAplicarLocal);   // o que foi apontado sem internet e ainda não subiu
  await m3dLerAba();
  if (typeof EP !== 'undefined' && !EP && typeof API !== 'undefined') {
    try { const j = await fetch(API + 'estoque-planilha', { cache: 'no-store' }).then(r => r.ok ? r.json() : null); if (j) EP = j; } catch (e) { /* sem acesso a Suprimentos */ }
  }
  m3dPrepararCarga();
}
/** Cargas por TAG (Suprimentos › Remessas): [nota fiscal, chegada na obra, quantidade]; e a ordem em que as peças de cada TAG são usadas. */
function m3dPrepararCarga() {
  const d = M3.d, porTag = new Map(), rem = (typeof EP !== 'undefined' && EP && EP.remessas) || null;
  if (rem) {
    const datas = rem.datas || {};
    (rem.itens || []).forEach(it => {
      const tag = String(it.tag || '').trim().toUpperCase();
      if (!tag) return;
      Object.entries(it.qtd_por_remessa || {}).forEach(([nome, q]) => {
        q = +q || 0;
        if (q <= 0) return;
        const dt = datas[nome] || {}, ch = m3dIsoBr(dt.chegada_obra), nf = m3dIsoBr(dt.emissao_nota) || ch;
        if (!porTag.has(tag)) porTag.set(tag, []);
        porTag.get(tag).push([nf, ch, q, nome]);
      });
    });
  }
  // ordem de uso: frentes pelo início, dentro da frente a ordem das peças (eixo); o que não tem frente fica por último
  const ordem = new Int32Array(d.n).fill(2147483647);
  let k = 0;
  M3.grupos.slice().sort((a, b) => String(a.inicio || '9999').localeCompare(String(b.inicio || '9999'))).forEach(g => (g.itens || []).forEach(i => { const r = d.raiz[i]; if (ordem[r] === 2147483647) ordem[r] = k++; }));
  const pecas = new Map();
  let nComCarga = 0;
  for (let i = 0; i < d.n; i++) {
    if (d.e.pai[i] >= 0 || d.cRz[i + 1] <= d.cRz[i]) continue;
    const t = m3dChaveCarga(i);
    if (!porTag.has(t)) continue;
    if (!pecas.has(t)) pecas.set(t, []);
    pecas.get(t).push(i);
    nComCarga++;
  }
  pecas.forEach(l => l.sort((a, b) => ordem[a] - ordem[b] || a - b));
  M3.carga = { porTag, pecas, n: nComCarga };
  M3._real = null;
}
/** Situação real de cada peça montável numa data (M3.dia, nunca depois de hoje): 0 sem dado · 1 fábrica · 2 a caminho · 3 canteiro · 4 içada · 5 torqueada · 6 atrasada. */
function m3dStatusReal() {
  const d = M3.d, hj = m3dHoje(), dia = M3.dia && M3.dia < hj ? M3.dia : hj;
  if (M3._real && M3._real.dia === dia && M3._real.v === M3._realV) return M3._real;
  const st = new Uint8Array(d.n), ap = M3.ap || { ic: [], tq: [] }, ab = M3.aba;
  const fimDe = new Array(M3.grupos.length);
  M3.grupos.forEach((g, k) => { fimDe[k] = g.status === 'concluido' ? '' : (g.fim || ''); });
  for (let i = 0; i < d.n; i++) {
    if (d.e.pai[i] >= 0) continue;
    if (ap.tq[i] && ap.tq[i] <= dia) st[i] = 5;
    else if (ab && ab.data[i] && ab.data[i] <= dia) st[i] = 5;   // montada pela aba Apontar montagem
    else if (ap.ic[i] && ap.ic[i] <= dia) st[i] = 4;
  }
  if (M3.carga) M3.carga.pecas.forEach((lista, tag) => {
    let chegou = 0, caminho = 0;
    M3.carga.porTag.get(tag).forEach(([nf, ch, q]) => { if (ch && ch <= dia) chegou += q; else if (nf && nf <= dia) caminho += q; });
    let usadas = 0;
    lista.forEach(i => { if (st[i] >= 4) usadas++; });
    let livre = Math.max(0, chegou - usadas), cam = caminho;
    lista.forEach(i => {
      if (st[i] >= 4) return;
      if (livre > 0) { st[i] = 3; livre--; } else if (cam > 0) { st[i] = 2; cam--; } else st[i] = 1;
    });
  });
  for (let i = 0; i < d.n; i++) {   // frente com término vencido e peça ainda não içada = atrasada
    if (d.e.pai[i] >= 0 || st[i] >= 4) continue;
    const g = d.grupoDeEl[i];
    if (g >= 0 && fimDe[g] && fimDe[g] < dia) st[i] = 6;
  }
  return (M3._real = { st, dia, v: M3._realV });
}
function m3dSelRaizes(filtro) {
  const d = M3.d, out = [];
  for (let i = 0; i < d.n; i++) if (d.e.pai[i] < 0 && d.cRz[i + 1] > d.cRz[i] && filtro(i)) out.push(i);
  return out;
}
/** Os 4 cartões de gestão à vista (na data da linha do tempo, até hoje). */
function m3dVitrine(R) {
  const box = $('#m3dVitrine');
  if (!box || !M3.d) return;
  const d = M3.d, P = m3dPesosRaiz(), st = R.st, dia = R.dia;
  let kgMont = 0, kgTot = 0, kgPrev = 0, nCant = 0, kgCant = 0, nAtr = 0;
  const atrG = new Set();
  for (let i = 0; i < d.n; i++) {
    if (d.e.pai[i] >= 0 || d.cRz[i + 1] <= d.cRz[i]) continue;
    kgTot += P[i];
    if (st[i] >= 4 && st[i] <= 5) kgMont += P[i];
    if (st[i] === 3) { nCant++; kgCant += P[i]; }
    if (st[i] === 6) { nAtr++; atrG.add(d.grupoDeEl[i]); }
  }
  M3.grupos.forEach(g => {
    if (!g.inicio || !g.fim) return;
    let kg = 0;
    (g.itens || []).forEach(i => { if (d.e.pai[i] < 0) kg += P[i]; });
    const f = dia < g.inicio ? 0 : dia >= g.fim ? 1 : (diasEntre(g.inicio, dia) + 1) / (diasEntre(g.inicio, g.fim) + 1);
    kgPrev += kg * f;
  });
  // próxima frente: a que começa primeiro depois da data (sem estar concluída)
  const prox = M3.grupos.filter(g => g.status !== 'concluido' && g.inicio && g.inicio > dia).sort((a, b) => a.inicio.localeCompare(b.inicio))[0];
  let faltam = 0, cam = 0, nProx = 0;
  if (prox) (prox.itens || []).forEach(i => { if (d.e.pai[i] >= 0) return; nProx++; if (st[i] <= 2) { faltam++; if (st[i] === 2) cam++; } });
  const t = kg => nf(kg / 1000, 1) + ' t', pct = kgPrev ? Math.round(kgMont / kgPrev * 100) : 0;
  const tom = kgPrev && kgMont < kgPrev * 0.9 ? 'ruim' : 'bom';
  const semCarga = !M3.carga || !M3.carga.n;
  box.hidden = false;
  box.innerHTML = `
    <button type="button" class="m3d-card ${tom}" data-m3d="vit" data-k="mont" title="Selecionar as peças içadas"><span class="m3d-card-t">Montado até ${fdA(dia)}</span>
      <b>${t(kgMont)}</b><small>${kgPrev ? `${pct}% do previsto (${t(kgPrev)})` : 'defina os prazos das frentes'} · ${t(kgTot)} no total</small></button>
    <button type="button" class="m3d-card amarelo" data-m3d="vit" data-k="cant" title="Selecionar as peças no canteiro"><span class="m3d-card-t">Prontas para içar</span>
      <b>${semCarga ? '—' : nCant.toLocaleString('pt-BR')}</b><small>${semCarga ? 'sem cargas lançadas em Suprimentos › Remessas' : `peças no canteiro · ${t(kgCant)}`}</small></button>
    <button type="button" class="m3d-card ${prox && faltam ? 'alerta' : 'bom'}" data-m3d="vit" data-k="prox" title="Selecionar o que falta chegar para a próxima frente"><span class="m3d-card-t">Próxima frente${prox ? ' · ' + fdA(prox.inicio) : ''}</span>
      <b>${prox ? (semCarga ? '—' : faltam ? faltam.toLocaleString('pt-BR') + ' faltando' : 'tudo no canteiro') : '—'}</b><small>${prox ? esc(prox.nome) + (semCarga ? '' : faltam ? ` · ${cam.toLocaleString('pt-BR')} a caminho, ${(faltam - cam).toLocaleString('pt-BR')} na fábrica` : ` · ${nProx.toLocaleString('pt-BR')} peças`) : 'nenhuma frente a iniciar'}</small></button>
    <button type="button" class="m3d-card ${nAtr ? 'ruim' : 'bom'}" data-m3d="vit" data-k="atr" title="Selecionar as peças das frentes atrasadas"><span class="m3d-card-t">Prazo</span>
      <b>${atrG.size ? atrG.size + (atrG.size === 1 ? ' frente atrasada' : ' frentes atrasadas') : 'em dia'}</b><small>${atrG.size ? [...atrG].map(g => esc(M3.grupos[g].nome)).slice(0, 2).join(' · ') + (atrG.size > 2 ? ` · e mais ${atrG.size - 2}` : '') : 'nenhuma frente com término vencido'}</small></button>`;
  M3._vit = { prox };
}
function m3dVitrineSelecionar(k) {
  const R = m3dStatusReal(), st = R.st, d = M3.d;
  let lista;
  if (k === 'mont') lista = m3dSelRaizes(i => st[i] === 4 || st[i] === 5);
  else if (k === 'cant') lista = m3dSelRaizes(i => st[i] === 3);
  else if (k === 'atr') lista = m3dSelRaizes(i => st[i] === 6);
  else { const g = M3._vit && M3._vit.prox; lista = g ? [...new Set((g.itens || []).map(i => d.raiz[i]))].filter(i => st[i] <= 2) : []; }
  if (!lista.length) { toast('Nenhuma peça nesta situação.'); return; }
  if (M3.modo !== 'conj') { M3.modo = 'conj'; document.querySelectorAll('#m3dModo button').forEach(x => x.classList.toggle('ativa', x.dataset.m === 'conj')); }
  if (M3.cores !== 'real') m3dDefinirCores('real');
  M3.sel = new Set(lista);
  m3dPintar();
  m3dPainelSel();
  m3dVistaPadrao('enq');
  toast(lista.length.toLocaleString('pt-BR') + ' peça(s) selecionada(s).');
}
/** Bloco "Campo" do painel da peça: situação real, apontamentos e botões de içar / torquear. */
function m3dCampoHtml(itens) {
  const d = M3.d, R = m3dStatusReal(), ap = M3.ap || { ic: [], tq: [], inf: [], por: {} };
  const raizes = [...new Set(itens.map(i => d.raiz[i]))];
  const ed = m3dPodeEditar(), dataPad = m3dHoje() > hoje() ? hoje() : m3dHoje();
  const pelaAba = i => !!(M3.aba && M3.aba.data[i]);
  const sIc = raizes.filter(i => !ap.ic[i] && !pelaAba(i)).length, sTq = raizes.filter(i => !ap.tq[i] && !pelaAba(i)).length;
  const nIcProp = raizes.filter(i => ap.ic[i]).length, nTqProp = raizes.filter(i => ap.tq[i]).length;   // só o que foi apontado aqui pode ser desfeito aqui
  let info = '';
  if (raizes.length === 1) {
    const i = raizes[0], s = R.st[i];
    const l = [];
    if (ap.ic[i]) l.push(`Içada em <b>${fdA(ap.ic[i])}</b>${ap.inf[i] ? ' (registrada junto com o torque)' : ''}${ap.por[i + ':1'] ? ' · ' + esc(ap.por[i + ':1']) : ''}`);
    if (M3.aba && M3.aba.data[i]) l.push(`Montada pela aba <b>Apontar montagem</b> em <b>${fdA(M3.aba.data[i])}</b> · ${esc(M3.aba.orig[i] || '')}`);
    if (ap.pend && ap.pend.has(i)) l.push('<span class="m3d-pend">⏱ guardado no aparelho, aguardando envio</span>');
    if (ap.tq[i]) l.push(`Torqueada em <b>${fdA(ap.tq[i])}</b>${ap.por[i + ':2'] ? ' · ' + esc(ap.por[i + ':2']) : ''}`);
    const t = m3dChaveCarga(i), cg = M3.carga && M3.carga.porTag.get(t);
    if (cg) {
      const tot = cg.reduce((a, x) => a + x[2], 0), ch = cg.filter(x => x[1] && x[1] <= R.dia).reduce((a, x) => a + x[2], 0);
      const ult = cg.filter(x => x[1] && x[1] <= R.dia).sort((a, b) => b[1].localeCompare(a[1]))[0];
      l.push(`Carga da marca ${esc(t)}: ${ch.toLocaleString('pt-BR')} de ${tot.toLocaleString('pt-BR')} no canteiro${ult ? ` · última chegada ${fdA(ult[1])} (${esc(ult[3])})` : ''}`);
    } else l.push('Nenhuma carga desta marca lançada em Suprimentos › Remessas.');
    info = `<div class="m3d-campo-sit"><i style="background:${M3D_RC[s]}"></i>${esc(M3D_RR[s])}</div><ul class="m3d-campo-hist">${l.map(x => `<li>${x}</li>`).join('')}</ul>`;
  } else {
    const q = new Array(7).fill(0);
    raizes.forEach(i => q[R.st[i]]++);
    info = `<div class="m3d-legenda">${q.map((n, k) => n ? `<span class="m3d-leg"><i style="background:${M3D_RC[k]}"></i>${M3D_RCURTO[k]}: <b>${n.toLocaleString('pt-BR')}</b></span>` : '').join('')}</div>`;
  }
  let bts = '';
  if (ed) {
    const n = raizes.length, um = n === 1;
    const prim = sIc ? `<button type="button" class="btn primario m3d-ap-bt" data-m3d="icar">${um ? 'Marcar como içada' : `Marcar ${sIc.toLocaleString('pt-BR')} como içadas`}</button>`
      : sTq ? `<button type="button" class="btn primario m3d-ap-bt m3d-ap-tq" data-m3d="torquear">${um ? 'Marcar como torqueada' : `Marcar ${sTq.toLocaleString('pt-BR')} como torqueadas`}</button>` : '';
    const sec = sIc && sTq ? `<button type="button" class="btn" data-m3d="torquear">${um ? 'Já torqueada' : 'Torqueadas'}</button>` : '';
    const desf = [nTqProp ? `<button type="button" class="m3d-link" data-m3d="destorq">desfazer torque</button>` : '', nIcProp ? `<button type="button" class="m3d-link" data-m3d="desicar">desfazer içamento</button>` : ''].filter(Boolean).join(' · ');
    const nAba = raizes.filter(pelaAba).length;
    bts = (prim || sec ? `<div class="m3d-ap"><label class="m3d-ap-data">Data <input type="date" id="m3dApData" value="${dataPad}" max="${hoje()}"></label>${prim}${sec}</div>` : `<p class="nota">Montagem concluída nesta seleção${nAba ? ' (apontada na aba Apontar montagem: para corrigir, use aquela aba)' : ''}.</p>`) + (desf ? `<div class="m3d-ap-desf">${desf}</div>` : '');
  }
  return `<div class="m3d-cmp"><div class="m3d-campo-tit">Campo</div>${info}${bts}</div>`;
}
async function m3dApontar(acao) {
  const d = M3.d, guids = [...new Set([...M3.sel].map(i => d.e.guid[d.raiz[i]]).filter(Boolean))];
  if (!guids.length) return;
  const etapa = acao === 'icar' || acao === 'desicar' ? 'icada' : 'torqueada', des = acao.startsWith('des');
  const dia = ($('#m3dApData') && $('#m3dApData').value) || (m3dHoje() > hoje() ? hoje() : m3dHoje());
  if (dia > hoje()) { toast('Não é possível apontar em data futura.', true); return; }
  const item = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8), acao: des ? 'desapontar' : 'apontar', modelo_id: M3.modeloId, etapa, guids, data: dia, em: new Date().toISOString() };
  if (!navigator.onLine || m3dFila().length) {   // sem sinal (ou fila ainda pendente): guarda no aparelho e pinta na hora
    m3dFilaAdd(item);
    m3dAplicarLocal(item);
    toast(`Sem sinal: ${guids.length.toLocaleString('pt-BR')} peça(s) ${des ? 'desfeita(s)' : etapa === 'icada' ? 'içada(s)' : 'torqueada(s)'} guardada(s) no aparelho. Envio automático quando a internet voltar.`);
    m3dDepoisApontar(des);
    if (navigator.onLine) m3dSincronizar();
    return;
  }
  try {
    const r = await m3dPost(item.acao, item);
    await m3dCarregarCampo(M3.modeloId);
    if (des) toast(`Desfeito: ${r.removidos.toLocaleString('pt-BR')} registro(s).`);
    else toast(`${r.novos.toLocaleString('pt-BR')} peça(s) ${etapa === 'icada' ? 'içada(s)' : 'torqueada(s)'} em ${fdA(dia)}${r.inferidas ? ` · ${r.inferidas} içamento(s) registrado(s) junto` : ''}${r.ja_feitos ? ` · ${r.ja_feitos} já estava(m) registrada(s)` : ''}.`);
    m3dDepoisApontar(des);
  } catch (e) {
    if (e.status) { toast(e.message, true); return; }   // o servidor recusou: não guarda
    m3dFilaAdd(item);   // caiu a conexão no meio: guarda e tenta depois
    m3dAplicarLocal(item);
    toast('A conexão caiu: o apontamento ficou guardado no aparelho e será enviado quando a internet voltar.');
    m3dDepoisApontar(des);
  }
}
function m3dDepoisApontar(des) {
  M3._realV = (M3._realV || 0) + 1;
  if (!des) M3._apontou = true;
  if (M3.cores !== 'real') m3dDefinirCores('real'); else m3dPintar();
  m3dPainelSel();
  m3dChips();
  m3dRede();
}

// ---------------------------------------------------------------- modo canteiro: fila sem internet, cópia no aparelho
function m3dFilaChave() { return 'm3dFila:' + ((window.OBRA_ATUAL && OBRA_ATUAL.id) || 0); }
function m3dFila() { try { return JSON.parse(localStorage.getItem(m3dFilaChave()) || '[]'); } catch (e) { return []; } }
function m3dFilaGravar(f) {
  try { localStorage.setItem(m3dFilaChave(), JSON.stringify(f)); }
  catch (e) { toast('O aparelho não deixou guardar o apontamento (memória cheia ou navegação privada). Envie com internet.', true); }
}
function m3dFilaAdd(item) { const f = m3dFila(); f.push(item); m3dFilaGravar(f); }
/** Aplica na tela um apontamento ainda não enviado (fica com o relógio até o servidor confirmar). */
function m3dAplicarLocal(it) {
  const d = M3.d, ap = M3.ap;
  if (!d || !ap || it.modelo_id !== M3.modeloId) return;
  ap.pend = ap.pend || new Set();
  it.guids.forEach(g => {
    const i = d.guidDe.get(g);
    if (i === undefined) return;
    const r = d.raiz[i];
    if (it.acao === 'desapontar') {
      ap.tq[r] = '';
      if (it.etapa === 'icada') { ap.ic[r] = ''; ap.inf[r] = 0; }
    } else if (it.etapa === 'icada') {
      if (!ap.ic[r]) ap.ic[r] = it.data;
    } else {
      if (!ap.ic[r]) { ap.ic[r] = it.data; ap.inf[r] = 1; }
      if (!ap.tq[r]) ap.tq[r] = it.data;
    }
    ap.pend.add(r);
  });
}
/** Envia a fila em ordem. Recusa do servidor (ex.: RDO validado) tira o item da fila e avisa; falta de sinal ou sessão vencida mantém tudo guardado. */
async function m3dSincronizar() {
  if (M3._sinc || !navigator.onLine) return;
  let f = m3dFila();
  if (!f.length) { m3dRede(); return; }
  M3._sinc = true;
  const total = f.length;
  let ok = 0, recusados = [], parou = '';
  try {
    while (f.length) {
      M3._sincTxt = `Enviando ${ok + recusados.length + 1} de ${total}`;
      m3dRede();
      const it = f[0];
      try {
        await m3dPost(it.acao, it);
        ok++;
      } catch (e) {
        if (!e.status) { parou = 'sem sinal'; break; }
        if (e.status === 401 || /Sessão expirada|login/i.test(e.message)) { parou = 'sessao'; break; }
        recusados.push(e.message);
      }
      f.shift();
      m3dFilaGravar(f);
    }
  } finally {
    M3._sinc = false;
    M3._sincTxt = '';
  }
  if (ok || recusados.length) {
    if (M3.modeloId) { await m3dCarregarCampo(M3.modeloId); m3dFila().forEach(m3dAplicarLocal); M3._realV = (M3._realV || 0) + 1; m3dPintar(); m3dPainelSel(); m3dChips(); }
    toast(`${ok.toLocaleString('pt-BR')} apontamento(s) enviado(s).` + (recusados.length ? ` ${recusados.length} não aceito(s): ${recusados[0]}` : ''), !!recusados.length);
  }
  if (parou === 'sessao') toast('Sua sessão terminou: entre de novo no sistema. Os apontamentos continuam guardados no aparelho.', true);
  m3dRede();
}
function m3dRede() {
  const el = $('#m3dRede'), n = m3dFila().length, baixado = m3dCanteiroInfo();
  let txt = '', cls = '';
  if (M3._sincTxt) { txt = M3._sincTxt; cls = 'env'; }
  else if (!navigator.onLine) { txt = 'Sem sinal' + (n ? ` · ${n} apontamento(s) guardado(s)` : ''); cls = 'off'; }
  else if (n) { txt = `${n} apontamento(s) para enviar`; cls = 'env'; }
  else if (baixado) { txt = 'Online · cópia no aparelho de ' + baixado; cls = 'on'; }
  if (el) { el.hidden = !txt; el.className = 'm3d-rede ' + cls; el.textContent = txt; }
  m3dBarraCampo();
}
function m3dCanteiroChave() { return 'm3dCanteiro:' + ((window.OBRA_ATUAL && OBRA_ATUAL.id) || 0); }
function m3dCanteiroInfo() { try { const v = localStorage.getItem(m3dCanteiroChave()); return v ? fdA(v.slice(0, 10)) + ' ' + v.slice(11, 16) : ''; } catch (e) { return ''; } }
/** "Baixar para o canteiro": registra o guardião (sw.js) e passa pela rede tudo o que a tela usa, para ficar guardado no aparelho. */
async function m3dBaixarCanteiro() {
  if (!('serviceWorker' in navigator) || !window.caches) { toast('Este navegador não guarda o sistema para uso sem internet. Use o Chrome, Edge ou Safari atualizados.', true); return; }
  if (!navigator.onLine) { toast('Para baixar a cópia é preciso estar com internet.', true); return; }
  const bt = $('#m3dBaixar');
  try {
    if (bt) { bt.disabled = true; bt.textContent = 'Baixando…'; }
    await navigator.serviceWorker.register('sw.js', { scope: './' });
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise(r => { navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }); setTimeout(r, 4000); });
    const urls = new Set([location.href, 'index.php?aba=m3d', 'index.php', 'manifest.webmanifest']);
    document.querySelectorAll('script[src]').forEach(x => urls.add(x.getAttribute('src')));
    document.querySelectorAll('link[rel="stylesheet"][href], link[rel~="icon"][href]').forEach(x => urls.add(x.getAttribute('href')));
    urls.add('./vendor/m3d/three.m3d.js?v=' + M3D_VER);
    ['dados', 'versao', 'regras-baixa', 'estoque-planilha', 'frentes-montagem', 'identidade', 'configuracoes', 'tarefas'].forEach(r => urls.add(API + r));
    urls.add(`${M3D_URL}?acao=estado`);
    (M3.estado ? M3.estado.modelos : []).forEach(m => {
      urls.add(`${M3D_URL}?acao=grupos&modelo=${m.id}`);
      urls.add(`${M3D_URL}?acao=apont&modelo=${m.id}`);
      if (m.cache) { urls.add(`${M3D_URL}?acao=cache&id=${m.id}&tipo=geo`); urls.add(`${M3D_URL}?acao=cache&id=${m.id}&tipo=props`); }
    });
    let feitos = 0, falhas = 0;
    const lista = [...urls].filter(Boolean);
    for (const u of lista) {
      try { const r = await fetch(u, { cache: 'no-store', credentials: 'same-origin' }); if (!r.ok) falhas++; await r.arrayBuffer(); } catch (e) { falhas++; }
      feitos++;
      if (bt) bt.textContent = `Baixando ${feitos} de ${lista.length}…`;
    }
    const agora = new Date(), iso = new Date(agora.getTime() - agora.getTimezoneOffset() * 60000).toISOString();
    try { localStorage.setItem(m3dCanteiroChave(), iso); } catch (e) { /* sem armazenamento */ }
    toast(`Cópia para o canteiro pronta${falhas ? ` (${falhas} item(ns) opcionais não baixaram)` : ''}. Sem internet, abra este mesmo endereço no aparelho.`);
  } catch (e) {
    toast('Não foi possível guardar a cópia no aparelho: ' + e.message, true);
  }
  if (bt) { bt.disabled = false; bt.textContent = 'Baixar para o canteiro'; }
  m3dRede();
}
function m3dModoCanteiro(liga) {
  M3.canteiro = liga;
  document.body.classList.toggle('m3d-canteiro', liga);
  const b = $('#m3dBtnCanteiro');
  if (b) b.textContent = liga ? 'Sair do modo canteiro' : 'Modo canteiro';
  if (liga && M3.modo !== 'conj') { M3.modo = 'conj'; M3.sel.clear(); document.querySelectorAll('#m3dModo button').forEach(x => x.classList.toggle('ativa', x.dataset.m === 'conj')); }
  if (liga && M3.cores !== 'real' && M3.ap) m3dDefinirCores('real');
  try { localStorage.setItem('m3dModoCanteiro', liga ? '1' : ''); } catch (e) { /* sem armazenamento */ }
  m3dBarraCampo();
  setTimeout(() => { m3dRedimensionar(); m3dDesenhar(); }, 60);
}
/** Barra fixa do modo canteiro: seleção, botões grandes Içada / Torqueada e a cópia no aparelho. */
function m3dBarraCampo() {
  const bar = $('#m3dCBar');
  if (!bar) return;
  bar.hidden = !M3.canteiro;
  if (!M3.canteiro) return;
  const d = M3.d, ap = M3.ap || { ic: [], tq: [] }, ed = m3dPodeEditar() && !M3.juntos;
  const raizes = d ? [...new Set([...M3.sel].map(i => d.raiz[i]))] : [];
  const ab = i => !!(M3.aba && M3.aba.data[i]);
  const sIc = raizes.filter(i => !ap.ic[i] && !ab(i)).length, sTq = raizes.filter(i => !ap.tq[i] && !ab(i)).length;
  const rede = $('#m3dRede');
  bar.innerHTML = `<div class="m3d-cbar-info"><b>${raizes.length ? raizes.length.toLocaleString('pt-BR') + (raizes.length === 1 ? ' peça' : ' peças') : 'Toque numa peça'}</b>
      <span>${raizes.length ? `${sIc.toLocaleString('pt-BR')} a içar · ${sTq.toLocaleString('pt-BR')} a torquear` : 'ou num eixo (filtros) para marcar o eixo inteiro'}</span>
      <span class="m3d-rede ${rede ? rede.className.replace('m3d-rede', '') : ''}">${rede && !rede.hidden ? esc(rede.textContent) : (navigator.onLine ? 'Online' : 'Sem sinal')}</span></div>
    ${ed ? `<button type="button" class="m3d-cbt ic" data-m3d="icar"${sIc ? '' : ' disabled'}>Içada</button><button type="button" class="m3d-cbt tq" data-m3d="torquear"${sTq ? '' : ' disabled'}>Torqueada</button>` : '<span class="nota">Somente leitura</span>'}
    <div class="m3d-cbar-mais"><button type="button" class="btn" id="m3dBaixar">Baixar para o canteiro</button><button type="button" class="btn" data-m3d="limpar">Limpar</button><button type="button" class="btn" id="m3dSairCanteiro">Sair</button></div>`;
}

// ---------------------------------------------------------------- filtros rápidos (chips): situação, etapa, eixo
function m3dEixoDe(i) { const m = m3dTxt('pos', i).match(/^(\d+)/); return m ? m[1].padStart(2, '0') : ''; }
function m3dChipsPassa(i, R) {
  const c = M3.chips;
  if (c.st.size && !c.st.has(R.st[i])) return false;
  if (c.fase.size && !c.fase.has(m3dTxt('fase', i))) return false;
  if (c.eixo.size && !c.eixo.has(m3dEixoDe(i))) return false;
  return true;
}
function m3dChipsAtivos() { const c = M3.chips; return c.st.size + c.fase.size + c.eixo.size; }
function m3dAplicarChips() {
  if (!M3.d) return;
  if (!m3dChipsAtivos()) { M3.isolados = null; }
  else { const R = m3dStatusReal(); M3.isolados = new Set(m3dSelRaizes(i => m3dChipsPassa(i, R))); }
  m3dPintar();
  m3dChips();
}
function m3dChips() {
  const box = $('#m3dChipsBox');
  if (!box) return;
  if (!M3.d || !M3.ap || M3.juntos) { box.hidden = true; return; }
  box.hidden = false;
  const R = m3dStatusReal(), c = M3.chips, qSt = new Array(7).fill(0), qF = new Map(), qE = new Map();
  let nFiltro = 0;
  m3dSelRaizes(() => true).forEach(i => {
    // cada bloco conta o que passa nos OUTROS blocos (assim o número mostra o que o toque vai isolar)
    const okSt = !c.st.size || c.st.has(R.st[i]), f = m3dTxt('fase', i), okF = !c.fase.size || c.fase.has(f), e = m3dEixoDe(i), okE = !c.eixo.size || c.eixo.has(e);
    if (okF && okE) qSt[R.st[i]]++;
    if (okSt && okE) qF.set(f, (qF.get(f) || 0) + 1);
    if (okSt && okF && e) qE.set(e, (qE.get(e) || 0) + 1);
    if (okSt && okF && okE) nFiltro++;
  });
  const chip = (bloco, val, rot, n, cor) => `<button type="button" class="m3d-fchip${c[bloco].has(val) ? ' on' : ''}" data-chip="${bloco}" data-v="${esc(String(val))}"${n ? '' : ' disabled'}>${cor ? `<i style="background:${cor}"></i>` : ''}${esc(rot)} <b>${n.toLocaleString('pt-BR')}</b></button>`;
  const fases = [...qF].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR', { numeric: true }));
  const eixos = [...new Set([...qE.keys(), ...c.eixo])].sort();
  box.innerHTML = `<div class="m3d-chips-cab"><h3>Filtros</h3>${m3dChipsAtivos() ? `<span class="nota">${nFiltro.toLocaleString('pt-BR')} peças</span><button type="button" class="m3d-link" data-m3d="chsel">selecionar estas</button><button type="button" class="m3d-link" data-m3d="chlimpar">limpar</button>` : '<span class="nota">toque para isolar no modelo</span>'}</div>
    <div class="m3d-chips-t">Situação</div><div class="m3d-chips">${[3, 2, 1, 4, 5, 6, 0].filter(k => qSt[k] || c.st.has(k)).map(k => chip('st', k, M3D_RCURTO[k], qSt[k], M3D_RC[k])).join('')}</div>
    <div class="m3d-chips-t">Etapa de montagem</div><div class="m3d-chips">${fases.map(([f, n]) => chip('fase', f, f || '(sem etapa)', n)).join('')}</div>
    ${eixos.length ? `<div class="m3d-chips-t">Eixo</div><div class="m3d-chips m3d-chips-eixo">${eixos.map(e => chip('eixo', e, e, qE.get(e) || 0)).join('')}</div>` : ''}`;
}

// ---------------------------------------------------------------- painéis
function m3dPaineis() { m3dPainelSel(); m3dChips(); m3dPainelFiltro(); m3dListaGrupos(); m3dTempo(); m3dBarraCampo(); }

/** Peso em kg: o do IFC; peça montável sem peso próprio soma o dos componentes. */
function m3dPeso(i) {
  const d = M3.d, e = d.e;
  if (e.peso && e.peso[i]) return e.peso[i];
  if (!e.peso || e.pai[i] >= 0) return 0;
  let t = 0;
  for (let k = 0; k < d.nGeo; k++) if (d.raiz[k] === i && k !== i) t += e.peso[k] || 0;
  return t;
}
function m3dPesoTotal() {
  const d = M3.d, e = d.e;
  if (!e.peso) return 0;
  if (M3._pesoTot != null) return M3._pesoTot;
  let t = 0;
  for (let i = 0; i < d.n; i++) if (e.pai[i] < 0 && d.cRz[i + 1] > d.cRz[i]) t += m3dPeso(i);
  return (M3._pesoTot = t);
}
function m3dFmtPeso(kg) { return !kg ? 'peso não informado no IFC' : kg >= 1000 ? `${nf(kg / 1000, 1)} t` : `${nf(kg, 0)} kg`; }
function m3dTxt(col, i) { const d = M3.d, c = d.e[col]; return c ? d.s[c[i]] || '' : ''; }
function m3dRotulo(i) { return m3dTxt('marca', i) || m3dTxt('nome', i) || m3dTxt('cls', i) || M3.d.e.guid[i]; }

function m3dPainelSel() {
  m3dBarraCampo();
  const box = $('#m3dSelBox');
  if (!box) return;
  const d = M3.d;
  if (!d) { box.innerHTML = '<h3>Peça</h3><p class="nota">Abra um modelo para ver as peças.</p>'; return; }
  const itens = [...M3.sel], n = itens.length, ed = m3dPodeEditar() && !M3.juntos;
  if (!n) {
    box.innerHTML = `<h3>Peça</h3><p class="nota">Clique numa peça do modelo para ver etapa, frente, prazo e peso. Para várias: <b>Shift + clique</b> ou <b>Shift + arrastar</b>.</p>
      <p class="nota">${d.cab.n_unid.toLocaleString('pt-BR')} peças montáveis · ${m3dFmtPeso(m3dPesoTotal())}</p>`;
    return;
  }
  const opG = M3.grupos.map(g => `<option value="${g.id}">${esc(g.nome)}</option>`).join('');
  const acoes = (gUnica) => ed ? `<div class="m3d-acoes">
      ${gUnica ? `<button type="button" class="btn primario m3d-largo" data-m3d="geditar" data-id="${gUnica.id}">Editar esta frente</button>` : `<button type="button" class="btn primario m3d-largo" data-m3d="novo">Nova frente com ${n === 1 ? 'esta peça' : 'a seleção'}</button>`}
      ${opG ? `<select id="m3dAddGrupo" aria-label="Mover para uma frente"><option value="">Mover para a frente…</option>${opG}</select>` : ''}
      ${gUnica ? '<button type="button" class="btn" data-m3d="soltar" title="A peça sai da frente e fica sem prazo">Tirar da frente</button>' : ''}
    </div>` : '';
  if (n === 1) {
    const i = itens[0], g = m3dGrupoDeItem(i), G = g >= 0 ? M3.grupos[g] : null, s = G ? m3dSituacaoHoje(G) : ['sem', 'Sem frente'];
    const kg = m3dPeso(i), tipo = m3dTxt('nome', i), marca = m3dTxt('marca', i), semMarca = !marca || /^nd\d*/i.test(marca);
    const linhas = [
      ['Eixo e posição', m3dTxt('pos', i) || '—'],
      ['Etapa de montagem', m3dTxt('fase', i) || '—'],
      ['Frente e prazo', G ? `${G.nome}${G.inicio ? ' · ' + fdA(G.inicio) + ' a ' + fdA(G.fim) : ' · sem prazo'}` : 'Ainda não está em nenhuma frente'],
      ['Última atualização', G && G.atualizado_em ? `${G.atualizado_por || '—'} em ${fdA(String(G.atualizado_em).slice(0, 10))}` : '—'],
    ];
    const pai = d.e.pai[i];
    const tec = [['Nome no modelo', tipo], ['Tipo IFC', m3dTxt('cls', i)], ['Pavimento', m3dTxt('pav', i)], ['Peça montável', pai >= 0 ? m3dRotulo(d.raiz[i]) : ''], ['ID do modelo', d.e.guid[i]]].filter(x => x[1]);
    box.innerHTML = `<div class="m3d-peca">
        <div class="m3d-peca-cab"><span class="m3d-marca${semMarca ? ' m3d-marca-nome' : ''}">${esc(semMarca ? cap(tipo || 'Peça') : marca)}</span><span class="m3d-chip s-${s[0]}" title="${esc(s[1])}">${esc(s[1].split(' · ')[0])}</span></div>
        <div class="m3d-peca-sub">${semMarca ? 'sem marca no modelo' : esc(tipo ? cap(tipo) : '')}${kg ? ' · ' + m3dFmtPeso(kg) : ''}</div>
        ${M3.ap ? m3dCampoHtml([i]) : ''}
        <dl class="m3d-linhas">${linhas.map(x => `<dt>${esc(x[0])}</dt><dd>${esc(x[1])}</dd>`).join('')}</dl>
        ${acoes(G)}
        <details class="m3d-tec" id="m3dTec"><summary>Dados técnicos do IFC</summary>
          <table class="m3d-props" data-sem-ferramentas data-sem-limite>${tec.map(x => `<tr><th>${esc(x[0])}</th><td>${esc(x[1])}</td></tr>`).join('')}</table>
          <div id="m3dPropsTodas"><span class="nota">Carregando propriedades…</span></div>
        </details>
      </div>`;
    return;
  }
  const porFase = new Map(), porGrupo = new Map();
  let kg = 0;
  itens.forEach(i => { const k = m3dTxt('fase', i) || 'Sem etapa'; porFase.set(k, (porFase.get(k) || 0) + 1); const g = m3dGrupoDeItem(i); porGrupo.set(g, (porGrupo.get(g) || 0) + 1); kg += m3dPeso(i); });
  const top = [...porFase].sort((a, b) => b[1] - a[1]);
  const gs = [...porGrupo.keys()], gUnica = gs.length === 1 && gs[0] >= 0 ? M3.grupos[gs[0]] : null;
  box.innerHTML = `<div class="m3d-peca">
      <div class="m3d-peca-cab"><span class="m3d-marca">${n.toLocaleString('pt-BR')}</span><span class="m3d-peca-un">${M3.modo === 'conj' ? 'peças montáveis' : 'componentes'}</span></div>
      <div class="m3d-peca-sub">${kg ? m3dFmtPeso(kg) : 'peso não informado no IFC'}</div>
      ${M3.ap ? m3dCampoHtml(itens) : ''}
      <dl class="m3d-linhas"><dt>Etapas</dt><dd>${top.slice(0, 4).map(x => `${esc(x[0])} — ${x[1].toLocaleString('pt-BR')}`).join('<br>')}${top.length > 4 ? `<br>… e mais ${top.length - 4}` : ''}</dd>
        <dt>Frentes</dt><dd>${[...porGrupo].sort((a, b) => b[1] - a[1]).map(([g, q]) => `${g >= 0 ? esc(M3.grupos[g].nome) : 'sem frente'} — ${q.toLocaleString('pt-BR')}`).slice(0, 4).join('<br>')}${porGrupo.size > 4 ? `<br>… e mais ${porGrupo.size - 4}` : ''}</dd></dl>
      ${acoes(gUnica)}
      <button type="button" class="m3d-link" data-m3d="limpar">Limpar seleção</button>
    </div>`;
}

async function m3dMostrarProps() {
  const alvo = $('#m3dPropsTodas'), d = M3.d, i = [...M3.sel][0];
  if (!alvo || i === undefined) return;
  alvo.innerHTML = '<span class="nota">Carregando propriedades…</span>';
  try {
    if (!M3.props) {
      const r = await fetch(`${M3D_URL}?acao=cache&id=${M3.modeloId}&tipo=props`);
      if (!r.ok) throw new Error('As propriedades completas ainda não estão disponíveis para este modelo.');
      M3.props = JSON.parse(new TextDecoder().decode(await m3dDescompactar(await r.arrayBuffer())));
    }
    const bloco = (idx, titulo) => (M3.props.el[idx] || []).map(sid => {
      const s = M3.props.sets[sid];
      return s ? `<details><summary>${esc(titulo + s[0])}</summary><table class="m3d-props" data-sem-ferramentas data-sem-limite>${Object.keys(s[1]).map(k => `<tr><th>${esc(k)}</th><td>${esc(s[1][k])}</td></tr>`).join('')}</table></details>` : '';
    }).join('');
    const rz = d.raiz[i];
    alvo.innerHTML = (bloco(i, '') + (rz !== i ? bloco(rz, 'Peça montável · ') : '')) || '<span class="nota">Este elemento não tem propriedades no IFC.</span>';
  } catch (e) {
    alvo.innerHTML = `<span class="nota">${esc(e.message)}</span>`;
  }
}

/** Itens selecionáveis no modo atual (conjuntos ou peças). */
function m3dItens() {
  const d = M3.d, r = [];
  if (M3.modo === 'conj') { for (let i = 0; i < d.n; i++) if (d.cRz[i + 1] > d.cRz[i]) r.push(i); }
  else for (let i = 0; i < d.nGeo; i++) r.push(i);
  return r;
}
function m3dPainelFiltro() {
  const box = $('#m3dFiltroBox');
  if (!box) return;
  if (!M3.d) { box.innerHTML = ''; box.hidden = true; return; }
  box.hidden = false;
  const tipo = M3.filtroTipo || 'fase';
  const cont = new Map();
  m3dItens().forEach(i => { const v = m3dTxt(tipo, i); cont.set(v, (cont.get(v) || 0) + 1); });
  const vals = [...cont].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR', { numeric: true }));
  box.innerHTML = `<details class="m3d-tecf" id="m3dTecF"${M3.tecAberto ? ' open' : ''}><summary><h3>Filtros técnicos</h3></summary>
    <div class="m3d-filtro">
      <select id="m3dFTipo">${[['fase', 'Etapa de montagem'], ['pos', 'Eixo e posição'], ['nome', 'Tipo de peça'], ['marca', 'Marca'], ['pav', 'Pavimento'], ['cls', 'Tipo IFC (técnico)']].map(x => `<option value="${x[0]}"${x[0] === tipo ? ' selected' : ''}>${x[1]}</option>`).join('')}</select>
      <select id="m3dFValor">${vals.map(x => `<option value="${esc(x[0])}">${esc(x[0] || '(vazio)')} — ${x[1].toLocaleString('pt-BR')}</option>`).join('')}</select>
      <label class="m3d-chk"><input type="checkbox" id="m3dFSem"${M3.filtroSem ? ' checked' : ''}> só o que ainda não está em nenhuma frente</label>
      <div class="m3d-acoes"><button type="button" class="btn" data-m3d="fsel">Selecionar</button><button type="button" class="btn" data-m3d="fsomar">Somar à seleção</button></div>
    </div></details>`;
}
function m3dFiltrar(somar) {
  const tipo = $('#m3dFTipo').value, val = $('#m3dFValor').value, sem = $('#m3dFSem').checked;
  if (!somar) M3.sel.clear();
  let q = 0;
  m3dItens().forEach(i => { if (m3dTxt(tipo, i) === val && (!sem || m3dGrupoDeItem(i) < 0)) { M3.sel.add(i); q++; } });
  m3dPintar();
  m3dPainelSel();
  toast(q ? q.toLocaleString('pt-BR') + (M3.modo === 'conj' ? ' peça(s) montável(is) selecionada(s).' : ' componente(s) selecionado(s).') : 'Nenhuma peça com esse valor.');
}

function m3dListaGrupos() {
  const box = $('#m3dGruposBox');
  if (!box) return;
  if (!M3.d) { box.innerHTML = ''; box.hidden = true; return; }
  box.hidden = false;
  const tot = M3.d.cab.n_unid;
  let comPrazo = 0;
  const linhas = M3.grupos.map(g => {
    const s = m3dSituacaoHoje(g), n = (g.itens || []).length;
    comPrazo += n;
    return `<li class="m3d-grupo" data-g="${g.id}">
      <label class="m3d-g-chk" title="Destacar esta frente no modelo"><input type="checkbox" data-m3d-grupo="${g.id}" ${M3.filtroGrupos.has(g.id) ? 'checked' : ''}></label>
      <button type="button" class="m3d-g-nome" data-m3d="gsel" data-id="${g.id}" title="Selecionar as peças desta frente">${esc(g.nome)}</button>
      <span class="m3d-chip s-${s[0]}" title="${esc(s[1])}">${esc(s[1].split(' · ')[0])}</span>
      <small>${g.inicio ? fdA(g.inicio) + ' a ' + fdA(g.fim) : 'sem prazo — defina as datas'} · ${n.toLocaleString('pt-BR')} peças${g.empresa ? ' · ' + esc(g.empresa) : ''}${g.responsavel ? ' · ' + esc(g.responsavel) : ''}</small>
      ${g.atividade ? `<small>Atividade: ${esc(g.atividade)}</small>` : ''}
      ${m3dPodeEditar() && !M3.juntos ? `<button type="button" class="btn m3d-g-ed" data-m3d="geditar" data-id="${g.id}">Editar</button>` : ''}
    </li>`;
  }).join('');
  box.innerHTML = `<h3>Frentes de montagem · ${M3.grupos.length}</h3>
    <p class="nota">${Math.min(comPrazo, tot).toLocaleString('pt-BR')} de ${tot.toLocaleString('pt-BR')} peças montáveis em alguma frente.</p>
    <p class="nota">Marque as caixas para destacar frentes no modelo; clique no nome para selecionar as peças.</p>
    ${linhas ? `<ul class="m3d-grupos">${linhas}</ul>` : '<p class="nota">Nenhuma frente ainda. Selecione peças e clique em <b>Nova frente com a seleção</b>.</p>'}`;
}

// ---------------------------------------------------------------- linha do tempo (4D)
function m3dLimites() {
  let a = '', b = '';
  M3.grupos.forEach(g => {
    if (!g.inicio || !g.fim) return;
    if (!a || g.inicio < a) a = g.inicio;
    const f = g.concluido_em && g.concluido_em > g.fim ? g.concluido_em : g.fim;
    if (!b || f > b) b = f;
  });
  if (!a) return null;
  const hj = m3dHoje();
  if (hj >= add(a, -60) && hj <= add(b, 60)) { if (hj < a) a = hj; if (hj > b) b = hj; }
  return [add(a, -1), add(b, 1)];
}
function m3dTempo() {
  const box = $('#m3dTempo');
  if (!box) return;
  const lim = M3.d ? m3dLimites() : null;
  if (!M3.d) { box.hidden = true; return; }
  box.hidden = false;
  if (!lim) {
    box.innerHTML = '<h3>Linha do tempo (4D)</h3><p class="nota">Defina o prazo de pelo menos uma frente de montagem para simular a obra no tempo.</p>';
    return;
  }
  if (M3.dia < lim[0]) M3.dia = lim[0];
  if (M3.dia > lim[1]) M3.dia = lim[1];
  const total = diasEntre(lim[0], lim[1]);
  box.innerHTML = `<div class="m3d-t-cab">
      <h3>Linha do tempo (4D)</h3>
      <button type="button" class="btn" id="m3dPlay">${M3.tocando ? '❚❚ Pausar' : '▶ Simular'}</button>
      <select id="m3dVel" title="Velocidade da simulação">${[[1, '1 dia por passo'], [3, '3 dias por passo'], [7, '1 semana por passo']].map(x => `<option value="${x[0]}"${x[0] === M3.vel ? ' selected' : ''}>${x[1]}</option>`).join('')}</select>
      <button type="button" class="btn" id="m3dHojeBtn">Hoje</button>
      <strong id="m3dDia">${fdA(M3.dia)}</strong>
      <label class="m3d-chk"><input type="checkbox" id="m3dAntes"${M3.antes ? ' checked' : ''}> mostrar não iniciados em cinza</label>
      <label class="m3d-chk"><input type="checkbox" id="m3dSemPrazo"${M3.semPrazo ? ' checked' : ''}> mostrar o que não tem prazo</label>
    </div>
    <input type="range" id="m3dSlider" min="0" max="${total}" step="1" value="${diasEntre(lim[0], M3.dia)}" aria-label="Data da simulação">
    <div class="m3d-t-esc"><span>${fdA(lim[0])}</span><span>${fdA(lim[1])}</span></div>
    <div class="m3d-legenda" id="m3dCont"></div>
    <details>
      <summary>Configurar cores da legenda</summary>
      <div class="m3d-legenda">${Object.entries(M3D_ROT).map(([k, nome]) =>
        `<label class="m3d-leg"><input type="color" data-m3d-cor="${k}" value="${m3dCor(k)}"> ${nome}</label>`).join('')}
        <button type="button" class="btn" data-m3d-cor-padrao>Restaurar cores padrão</button>
      </div>
    </details>`;
  M3.lim = lim;
  m3dContagem();
}
function m3dContagem() {
  const c = $('#m3dCont');
  if (!c) return;
  if (M3.cores === 'real') {
    const R = m3dStatusReal(), d = M3.d, q = new Array(7).fill(0);
    for (let i = 0; i < d.n; i++) if (d.e.pai[i] < 0 && d.cRz[i + 1] > d.cRz[i]) q[R.st[i]]++;
    c.innerHTML = [1, 2, 3, 4, 5, 6, 0].map(k => `<span class="m3d-leg"><i style="background:${M3D_RC[k]}"></i>${M3D_RCURTO[k]}: <b>${q[k].toLocaleString('pt-BR')}</b></span>`).join('') +
      (M3.dia > m3dHoje() ? '<span class="nota">Depois de hoje a situação real fica como está hoje (use Planejado para ver o futuro).</span>' : '');
    return;
  }
  if (M3.cores !== '4d') { c.innerHTML = '<span class="nota">Arraste a linha do tempo (ou clique em Simular) para ver a obra em cada data.</span>'; return; }
  const q = M3.contagem || {};
  c.innerHTML = ['montando', 'feito', 'previsto', 'atrasado', 'antes', 'sem'].map(k =>
    `<span class="m3d-leg"><i style="background:${m3dCor(k)}"></i>${M3D_ROT[k]}${k === 'antes' && !M3.antes && !M3.filtroGrupos.size ? ' (oculto)' : ''}: <b>${(q[k] || 0).toLocaleString('pt-BR')}</b></span>`).join('');
}
function m3dIrDia(dia) {
  M3.dia = dia;
  const s = $('#m3dSlider'), r = $('#m3dDia');
  if (s && M3.lim) s.value = diasEntre(M3.lim[0], dia);
  if (r) r.textContent = fdA(dia);
  if (M3.cores === 'orig') m3dDefinirCores('real'); else m3dPintar();
}
function m3dDefinirCores(c) {
  M3.cores = c;
  document.querySelectorAll('#m3dCores button').forEach(b => b.classList.toggle('ativa', b.dataset.c === c));
  m3dPintar();
}
function m3dParar() {
  if (M3.tocando) { clearInterval(M3.tocando); M3.tocando = null; }
  const b = $('#m3dPlay');
  if (b) b.textContent = '▶ Simular';
}
function m3dTocar() {
  if (M3.tocando) { m3dParar(); return; }
  if (!M3.lim) return;
  if (M3.dia >= M3.lim[1]) m3dIrDia(M3.lim[0]);
  $('#m3dPlay').textContent = '❚❚ Pausar';
  M3.tocando = setInterval(() => {
    if ($('#aba-m3d').hidden) { m3dParar(); return; }
    const prox = add(M3.dia, M3.vel);
    if (prox >= M3.lim[1]) { m3dIrDia(M3.lim[1]); m3dParar(); } else m3dIrDia(prox);
  }, 180);
}

// ---------------------------------------------------------------- formulário do grupo
function m3dAtividades() {   // linhas do cronograma do sistema (para puxar nome e datas)
  let it = [];
  try { it = (typeof ganItensCliente === 'function' ? ganItensCliente() : []) || []; } catch (e) { it = []; }
  return it.filter(c => c.servico).map(c => ({ nome: (typeof cap === 'function' ? cap(c.servico) : c.servico) + (c.frente ? ' · ' + c.frente : ''), ini: c.inicio_plan || '', fim: c.prazo || '' }));
}
function m3dAbrirGrupo(g) {
  const velho = $('#m3dDlg');
  if (velho) velho.remove();
  const dlg = document.createElement('dialog');
  dlg.id = 'm3dDlg';
  dlg.className = 'm3d-dlg';
  document.body.appendChild(dlg);
  const novo = !g, hj = m3dHoje(), n = M3.sel.size, ativ = m3dAtividades();
  g = g || { id: 0, nome: '', atividade: '', empresa: M3.estado.empresa || '', responsavel: '', inicio: hj, fim: add(hj, 4), status: 'nao_iniciado', concluido_em: '', obs: '' };
  const emps = [...new Set((M && M.empresas ? M.empresas.map(e => e.nome) : []).concat(g.empresa ? [g.empresa] : []))];
  const travaEmp = !!M3.estado.empresa;
  dlg.innerHTML = `<form method="dialog" id="m3dForm">
    <div class="bloco-cab"><h2>${novo ? 'Nova frente de montagem' : 'Editar frente de montagem'}</h2><button type="button" class="btn-icone" data-m3d-f="fechar" aria-label="Fechar">×</button></div>
    <p class="nota">${novo ? `${n.toLocaleString('pt-BR')} peça(s) selecionada(s) entram nesta frente.` : `${(g.itens || []).length.toLocaleString('pt-BR')} peça(s) nesta frente.`}</p>
    <div class="campos">
      <label class="largo"><span class="obrig">Nome da frente</span><input type="text" name="nome" maxlength="160" required value="${esc(g.nome)}" placeholder="ex.: Vigas da cobertura — eixos 01 a 05"></label>
      ${ativ.length ? `<label class="largo"><span>Atividade do cronograma (puxa as datas)</span><select name="ativsel"><option value="">— escolher do cronograma do sistema —</option>${ativ.map((a, k) => `<option value="${k}">${esc(a.nome)}${a.ini ? ' · ' + fdA(a.ini) + ' a ' + fdA(a.fim) : ''}</option>`).join('')}</select></label>` : ''}
      <label class="largo"><span>Atividade vinculada</span><input type="text" name="atividade" maxlength="255" value="${esc(g.atividade)}" placeholder="nome da atividade do cronograma"></label>
      <label><span class="obrig">Início previsto</span><input type="date" name="inicio" required value="${esc(g.inicio)}"></label>
      <label><span class="obrig">Término previsto</span><input type="date" name="fim" required value="${esc(g.fim)}"></label>
      <label><span>Duração (dias corridos)</span><input type="number" name="dur" min="1" max="3650" step="1" value="${g.inicio && g.fim ? diasEntre(g.inicio, g.fim) + 1 : ''}"></label>
      <label><span>Situação da montagem</span><select name="status">${Object.keys(M3.estado.status).map(k => `<option value="${k}"${k === g.status ? ' selected' : ''}>${esc(M3.estado.status[k])}</option>`).join('')}</select></label>
      <label id="m3dConclBox"><span>Concluído em</span><input type="date" name="concluido_em" value="${esc(g.concluido_em)}"></label>
      <label><span>Equipe (empresa)</span><select name="empresa"${travaEmp ? ' disabled' : ''}><option value="">—</option>${emps.map(e => `<option${e === g.empresa ? ' selected' : ''}>${esc(e)}</option>`).join('')}</select></label>
      <label><span>Responsável</span><input type="text" name="responsavel" maxlength="100" value="${esc(g.responsavel)}"></label>
      <label class="largo"><span>Observação</span><textarea name="obs" rows="2" maxlength="4000">${esc(g.obs)}</textarea></label>
    </div>
    <p class="nota">“Atrasado” é calculado sozinho: término previsto vencido sem conclusão, ou início vencido sem iniciar.</p>
    <div class="m3d-acoes">
      <button type="submit" class="btn primario">Salvar</button>
      ${novo ? '' : '<button type="button" class="btn" data-m3d-f="trocar" title="A frente passa a ter exatamente as peças selecionadas agora">Trocar pelas selecionadas (' + n.toLocaleString('pt-BR') + ')</button><button type="button" class="btn perigo" data-m3d-f="excluir">Excluir frente</button>'}
      <button type="button" class="btn" data-m3d-f="fechar">Cancelar</button>
    </div>
  </form>`;
  const f = dlg.querySelector('form'), el = k => f.elements.namedItem(k);
  const sincConcl = () => { $('#m3dConclBox').hidden = el('status').value !== 'concluido'; };
  sincConcl();
  el('status').addEventListener('change', () => { sincConcl(); if (el('status').value === 'concluido' && !el('concluido_em').value) el('concluido_em').value = m3dHoje(); });
  el('dur').addEventListener('input', () => { const q = parseInt(el('dur').value, 10); if (q > 0 && el('inicio').value) el('fim').value = add(el('inicio').value, q - 1); });
  const durDeDatas = () => { if (el('inicio').value && el('fim').value && el('fim').value >= el('inicio').value) el('dur').value = diasEntre(el('inicio').value, el('fim').value) + 1; };
  el('fim').addEventListener('change', durDeDatas);
  el('inicio').addEventListener('change', () => { const q = parseInt(el('dur').value, 10); if (q > 0 && el('inicio').value) el('fim').value = add(el('inicio').value, q - 1); });
  if (el('ativsel')) el('ativsel').addEventListener('change', () => {
    const a = ativ[el('ativsel').value];
    if (!a) return;
    el('atividade').value = a.nome;
    if (!el('nome').value) el('nome').value = a.nome;
    if (a.ini && a.fim) { el('inicio').value = a.ini; el('fim').value = a.fim; durDeDatas(); }
  });
  const gravar = async extra => {
    const corpo = Object.assign({ id: g.id, modelo_id: M3.modeloId, nome: el('nome').value, atividade: el('atividade').value, inicio: el('inicio').value, fim: el('fim').value,
      status: el('status').value, concluido_em: el('concluido_em').value, empresa: el('empresa').value, responsavel: el('responsavel').value, obs: el('obs').value }, extra || {});
    try {
      const r = await m3dPost('grupo_salvar', corpo);
      dlg.close();
      toast(novo ? 'Frente criada: prazo definido para as peças selecionadas.' : 'Frente salva.');
      await m3dRecarregarGrupos(!!extra);
      return r;
    } catch (e) {
      toast(e.message, true);
    }
  };
  f.addEventListener('submit', ev => { ev.preventDefault(); gravar(novo ? m3dGuidsSel() : null); });
  dlg.addEventListener('click', async ev => {
    const b = ev.target.closest('[data-m3d-f]');
    if (!b) return;
    if (b.dataset.m3dF === 'fechar') dlg.close();
    else if (b.dataset.m3dF === 'trocar') { if (!n) { toast('Selecione os elementos primeiro.', true); return; } gravar(m3dGuidsSel()); }
    else if (b.dataset.m3dF === 'excluir') {
      if (b.dataset.conf !== '1') { b.dataset.conf = '1'; b.textContent = 'Confirmar: excluir a frente'; return; }
      try { await m3dPost('grupo_excluir', { id: g.id }); dlg.close(); toast('Frente excluída. As peças ficaram sem frente.'); await m3dRecarregarGrupos(); } catch (e) { toast(e.message, true); }
    }
  });
  dlg.showModal();
  if (typeof patchDatas === 'function') patchDatas();
}
// ---------------------------------------------------------------- etapas do IFC viram frentes (uma vez por modelo)
function m3dNorm(t) { return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase(); }
const M3D_PALAVRAS_FRACAS = new Set(['ESTRUTURA', 'METALICA', 'METALICAS', 'METALICO', 'GALPAO', 'PARA', 'PHASE', 'GERAL', 'ETAPA', 'FASE', 'OBRA', 'MONTAGEM', 'INSTALACAO']);
/** Casa a etapa do IFC com as linhas do cronograma pelo nome: devolve {inicio, fim, atividade} ou null. */
const M3D_LOCAL_GENERICO = new Set(['COBERTURA', 'FECHAMENTO', 'LATERAL', 'TELHAS', 'VIGAS']);
function m3dCasarCronograma(fase, ativ) {
  const base = m3dNorm(fase).replace(/\bE\.?\s?M\.?(?=\s|$)/g, ' VIGAS ').replace(/\bCOB\.?(?=\s|$)/g, ' COBERTURA ').replace(/\bEST\.?\s?MET\.?/g, ' VIGAS ');   // abreviações do Tekla
  const toks = [...new Set(base.replace(/[^A-Z ]/g, ' ').split(/\s+/).filter(t => t.length >= 4 && !M3D_PALAVRAS_FRACAS.has(t)))];
  if (!toks.length || !ativ.length) return null;
  const tem = (txt, t) => txt.includes(t.length > 5 ? t.slice(0, t.length - 1) : t);
  const linhas = ativ.map(a => { const [serv, ...loc] = m3dNorm(a.nome).split(' · '); return { a, serv, local: loc.join(' ') }; });
  // a palavra que nomeia o prédio (Refeitório, Portaria…) precisa casar com o local da linha do cronograma
  const predio = toks.filter(t => !M3D_LOCAL_GENERICO.has(t) && linhas.some(l => tem(l.local, t)));
  const cand = predio.length ? linhas.filter(l => predio.every(t => tem(l.local, t))) : linhas;
  const resto = toks.filter(t => !predio.includes(t));
  let melhor = 0, casadas = [];
  cand.forEach(l => {
    const hits = resto.filter(t => tem(l.serv + ' ' + l.local, t)).length;
    if (hits > melhor) { melhor = hits; casadas = [l.a]; } else if (hits && hits === melhor) casadas.push(l.a);
  });
  if (!melhor && predio.length && cand.length === 1) casadas = [cand[0].a];
  casadas = casadas.filter(a => a.ini && a.fim);
  if (!casadas.length) return null;   // sem casar, a frente nasce sem prazo (melhor que pegar o prédio inteiro)
  return { inicio: casadas.map(a => a.ini).sort()[0], fim: casadas.map(a => a.fim).sort().at(-1), atividade: casadas.slice(0, 2).map(a => a.nome).join(' + ') + (casadas.length > 2 ? ` e mais ${casadas.length - 2}` : '') };
}
async function m3dFrentesAuto(mod) {
  const d = M3.d, porFase = new Map();
  for (let i = 0; i < d.n; i++) {
    if (d.e.pai[i] >= 0 || d.cRz[i + 1] === d.cRz[i] || !d.e.guid[i]) continue;
    const f = m3dTxt('fase', i).trim();
    if (!f || /^Phase \d+$/i.test(f)) continue;
    if (!porFase.has(f)) porFase.set(f, []);
    porFase.get(f).push(d.e.guid[i]);
  }
  if (!porFase.size) { await m3dPost('frentes_auto', { modelo_id: mod.id, frentes: [] }).catch(() => {}); mod.frentes_auto = 1; return; }
  const ativ = m3dAtividades();
  let comData = 0;
  const frentes = [...porFase].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR', { numeric: true })).map(([fase, guids]) => {
    const c = m3dCasarCronograma(fase, ativ);
    if (c) comData++;
    return { nome: fase, guids, inicio: c ? c.inicio : '', fim: c ? c.fim : '', atividade: c ? c.atividade : '' };
  });
  try {
    m3dAviso('<span class="m3d-gira"></span> Criando as frentes de montagem a partir das etapas do IFC…');
    const r = await m3dPost('frentes_auto', { modelo_id: mod.id, frentes });
    mod.frentes_auto = 1;
    const g = await m3dGet(`acao=grupos&modelo=${mod.id}`);
    M3.grupos = g.grupos;
    m3dIndexarGrupos();
    if (r.criadas) toast(`${r.criadas} frente(s) de montagem criadas a partir das etapas do IFC` + (comData ? ` (${comData} com datas do cronograma; confira).` : '. Defina as datas de cada uma.'), false, 8000);
  } catch (e) {
    toast('Não consegui criar as frentes automáticas: ' + e.message, true);
  }
}

// ---------------------------------------------------------------- tour de 3 passos (obra de demonstração)
const M3D_TOUR = [
  { alvo: '#m3dVitrine', lado: 'baixo', titulo: 'A obra num olhar', texto: 'Toneladas montadas × previstas, peças prontas para içar, o que falta chegar para a próxima frente e o prazo. Clique num cartão para ver as peças no modelo.' },
  { alvo: '#m3dCanvas', lado: 'centro', titulo: 'Clique numa peça amarela', texto: '<b style="color:#a16207">Amarelo</b> = já chegou ao canteiro e está pronta para içar. <b style="color:#15803d">Verde</b> = içada e torqueada, <b style="color:#0284c7">azul</b> = a caminho, cinza = na fábrica, <b style="color:#dc2626">vermelho</b> = atrasada.', espera: () => M3.sel.size > 0 },
  { alvo: '#m3dSelBox', lado: 'esq', titulo: 'Marque como içada', texto: 'Aperte <b>Marcar como içada</b>: fica registrado quem e quando, e a peça muda de cor. Depois do torque, ela fica verde-escura.', espera: () => !!M3._apontou },
  { alvo: '#m3dTempo', lado: 'cima', titulo: 'Veja a obra no tempo', texto: 'Arraste a linha do tempo ou aperte <b>Simular</b>. Em <b>Situação real</b> você vê como a obra foi montada de fato; em <b>Planejado (4D)</b>, o que os prazos preveem.' },
];
function m3dTourChave() { return 'm3dTour:' + ((window.OBRA_ATUAL && OBRA_ATUAL.id) || 0); }
function m3dTourIniciar(forcar) {
  try { if (!forcar && localStorage.getItem(m3dTourChave())) return; } catch (e) { if (!forcar) return; }
  if (!forcar && typeof TUT !== 'undefined' && TUT.tour) return;   // a visita guiada do Tutorial já está mostrando a tela
  M3.tour = 0;
  m3dTourDesenhar();
}
function m3dTourFechar(feito) {
  M3.tour = null;
  clearInterval(M3._tourEspera);
  document.querySelectorAll('.m3d-tour-alvo').forEach(x => x.classList.remove('m3d-tour-alvo'));
  const t = $('#m3dTour');
  if (t) t.hidden = true;
  try { localStorage.setItem(m3dTourChave(), feito ? 'feito' : 'pulado'); } catch (e) { /* navegador sem armazenamento: o tour volta na próxima vez */ }
}
function m3dTourDesenhar() {
  const t = $('#m3dTour'), p = M3D_TOUR[M3.tour];
  if (!t || !p) return;
  document.querySelectorAll('.m3d-tour-alvo').forEach(x => x.classList.remove('m3d-tour-alvo'));
  const alvo = $(p.alvo);
  if (alvo && p.lado !== 'centro') alvo.classList.add('m3d-tour-alvo');
  const ult = M3.tour === M3D_TOUR.length - 1;
  t.className = 'm3d-tour m3d-tour-' + p.lado;
  t.innerHTML = `<div class="m3d-tour-passo">Passo ${M3.tour + 1} de ${M3D_TOUR.length}</div><div class="m3d-tour-tit">${esc(p.titulo)}</div><p>${p.texto}</p>
    <div class="m3d-tour-bts"><button type="button" class="m3d-link" data-tour="pular">Pular</button>${p.espera ? '<span class="nota">esperando o clique…</span>' : ''}<button type="button" class="btn primario" data-tour="prox">${ult ? 'Concluir' : 'Próximo'}</button></div>`;
  t.hidden = false;
  const vista = $('#m3dVista').getBoundingClientRect();
  if (p.lado === 'centro') { t.style.left = '16px'; t.style.top = ''; t.style.bottom = '44px'; t.style.right = ''; }
  else if (alvo) {
    const r = alvo.getBoundingClientRect();
    if (p.lado === 'esq') { t.style.left = Math.max(8, r.left - vista.left - 336) + 'px'; t.style.top = Math.max(60, r.top - vista.top + 24) + 'px'; t.style.bottom = ''; }
    else if (p.lado === 'baixo') { t.style.left = '16px'; t.style.top = '12px'; t.style.bottom = ''; }
    else { t.style.left = '16px'; t.style.top = ''; t.style.bottom = '12px'; }
  }
  clearInterval(M3._tourEspera);
  if (p.espera) M3._tourEspera = setInterval(() => { if (M3.tour !== null && p.espera()) { clearInterval(M3._tourEspera); M3.tour++; m3dTourDesenhar(); } }, 250);
  if (ult) m3dParar();
}

function m3dGuidsSel() {
  const d = M3.d, guids = [], rotulos = {};
  M3.sel.forEach(i => { const g = d.e.guid[i]; if (g) { guids.push(g); rotulos[g] = m3dRotulo(i); } });
  return { guids, rotulos };
}
async function m3dRecarregarGrupos(mostrarNaSimulacao = false) {
  const modeloId = M3.modeloId;
  const g = await m3dGet(`acao=grupos&modelo=${modeloId}`);
  if (modeloId !== M3.modeloId) return;
  M3.grupos = g.grupos;
  const ids = new Set(M3.grupos.map(grupo => grupo.id));
  for (const id of M3.filtroGrupos) if (!ids.has(id)) M3.filtroGrupos.delete(id);
  m3dIndexarGrupos();
  if (mostrarNaSimulacao) {
    M3.sel.clear();
    M3.antes = true;
  }
  if (M3.ap) m3dPrepararCarga();
  m3dPaineis();
  if (mostrarNaSimulacao) m3dDefinirCores('4d');
  else m3dPintar();
}

// ---------------------------------------------------------------- ações da tela
function m3dLigar() {
  const corpo = $('#m3dCorpo');
  window.addEventListener('online', () => { m3dRede(); m3dSincronizar(); });
  window.addEventListener('offline', m3dRede);
  setInterval(() => { if (navigator.onLine && m3dFila().length) m3dSincronizar(); }, 30000);
  corpo.addEventListener('click', ev => {
    const ch = ev.target.closest('[data-chip]');
    if (ch) {
      const bl = ch.dataset.chip, v = bl === 'st' ? parseInt(ch.dataset.v, 10) : ch.dataset.v, set = M3.chips[bl];
      if (set.has(v)) set.delete(v); else set.add(v);
      m3dAplicarChips();
      return;
    }
    if (ev.target.closest('#m3dBtnCanteiro')) { m3dModoCanteiro(!M3.canteiro); return; }
    if (ev.target.closest('#m3dBtnEixos')) { M3.eixosVis = !M3.eixosVis; $('#m3dBtnEixos').classList.toggle('ativo', M3.eixosVis); if (M3.T && M3.T.eixos) M3.T.eixos.visible = M3.eixosVis; m3dDesenhar(); try { localStorage.setItem('m3dEixos', M3.eixosVis ? '1' : '0'); } catch (e) { /* sem armazenamento */ } return; }
    if (ev.target.closest('#m3dSairCanteiro')) { m3dModoCanteiro(false); return; }
    if (ev.target.closest('#m3dBaixar')) { m3dBaixarCanteiro(); return; }
  });
  corpo.addEventListener('toggle', ev => { if (ev.target.id === 'm3dTecF') M3.tecAberto = ev.target.open; }, true);
  try { if (localStorage.getItem('m3dModoCanteiro') === '1') setTimeout(() => m3dModoCanteiro(true), 0); } catch (e) { /* sem armazenamento */ }
  setTimeout(() => { m3dRede(); m3dSincronizar(); }, 1500);
  m3dLigarFerramentas();
  m3dLigarJuntar();
  $('#m3dModelo').addEventListener('change', async ev => {
    const v = ev.target.value;
    if (v.startsWith('doc:')) {
      try { const r = await m3dPost('usar_doc', { doc_id: parseInt(v.slice(4), 10) }); await m3dCarregarEstado(r.id); } catch (e) { toast(e.message, true); m3dCarregarEstado(); }
    } else if (v) m3dAbrirModelo(parseInt(v, 10));
  });
  $('#m3dEnviar').addEventListener('click', () => $('#m3dArq').click());
  $('#m3dArq').addEventListener('change', async ev => {
    const arq = ev.target.files[0];
    ev.target.value = '';
    if (!arq) return;
    if (!/\.ifc$/i.test(arq.name)) { toast('Escolha um arquivo .ifc (exportado do Tekla ou do Trimble Connect).', true); return; }
    try {
      m3dLimparCena();
      m3dAviso('<span class="m3d-gira"></span> Enviando o IFC… <span id="m3dEnvPct">0%</span>');
      const r = await m3dEnviarPartes(`acao=enviar&nome=${encodeURIComponent(arq.name)}`, arq, f => { const p = $('#m3dEnvPct'); if (p) p.textContent = Math.round(f * 100) + '%'; });
      const buf = await arq.arrayBuffer();
      M3.estado = await m3dGet('acao=estado');
      M3.modeloId = 0;
      const sel = $('#m3dModelo');
      sel.innerHTML = M3.estado.modelos.map(m => `<option value="${m.id}">${esc(m.nome)}</option>`).join('');
      sel.value = String(r.id);
      $('#m3dExcluirModelo').disabled = false;
      await m3dAbrirModelo(r.id, buf);
    } catch (e) {
      m3dAviso('<b>O envio falhou.</b><br>' + esc(e.message), true);
    }
  });
  $('#m3dExcluirModelo').addEventListener('click', async ev => {
    const b = ev.currentTarget;
    if (!M3.modeloId) return;
    if (b.dataset.conf !== '1') { b.dataset.conf = '1'; b.textContent = 'Confirmar: excluir modelo e grupos'; setTimeout(() => { b.dataset.conf = ''; b.textContent = 'Excluir modelo'; }, 5000); return; }
    b.dataset.conf = ''; b.textContent = 'Excluir modelo';
    try { await m3dPost('modelo_excluir', { id: M3.modeloId }); toast('Modelo excluído.'); M3.modeloId = 0; M3.grupos = []; await m3dCarregarEstado(); } catch (e) { toast(e.message, true); }
  });
  $('#m3dModo').addEventListener('click', ev => {
    const b = ev.target.closest('button'); if (!b || b.dataset.m === M3.modo) return;
    M3.modo = b.dataset.m; M3.sel.clear();
    document.querySelectorAll('#m3dModo button').forEach(x => x.classList.toggle('ativa', x === b));
    m3dPintar(); m3dPaineis();
  });
  $('#m3dCores').addEventListener('click', ev => { const b = ev.target.closest('button'); if (b) { m3dParar(); m3dDefinirCores(b.dataset.c); } });
  corpo.addEventListener('click', async ev => {
    if (ev.target.closest('[data-m3d-cor-padrao]')) {
      m3dCoresPersonalizadas = {};
      m3dSalvarCores();
      corpo.querySelectorAll('[data-m3d-cor]').forEach(campo => {
        campo.value = m3dCor(campo.dataset.m3dCor);
      });
      m3dPintar();
      return;
    }
    const v = ev.target.closest('[data-v]');
    if (v) { m3dVistaPadrao(v.dataset.v); return; }
    if (ev.target.closest('#m3dBtnSomar')) { M3.somar = !M3.somar; $('#m3dBtnSomar').classList.toggle('ativo', M3.somar); return; }
    if (ev.target.closest('#m3dBtnCaixa')) { M3.caixa = !M3.caixa; $('#m3dBtnCaixa').classList.toggle('ativo', M3.caixa); return; }
    if (ev.target.closest('#m3dPlay')) { m3dTocar(); return; }
    if (ev.target.closest('#m3dHojeBtn')) { m3dParar(); m3dIrDia(m3dHoje() < M3.lim[0] ? M3.lim[0] : m3dHoje() > M3.lim[1] ? M3.lim[1] : m3dHoje()); return; }
    const b = ev.target.closest('[data-m3d]');
    if (b && b.dataset.m3d === 'enviar-ifc') { $('#m3dArq').click(); return; }
    if (!b || !M3.d) return;
    const ac = b.dataset.m3d;
    if (ac === 'limpar') { M3.sel.clear(); m3dPintar(); m3dPainelSel(); }
    else if ((ac === 'isolar' || ac === 'ocultar') && !M3.sel.size) toast('Selecione uma ou mais peças primeiro.');
    else if (ac === 'isolar') { M3.isolados = new Set(M3.sel); M3.sel.clear(); m3dPintar(); m3dPainelSel(); }
    else if (ac === 'ocultar') { M3.sel.forEach(i => M3.ocultos.add(i)); M3.sel.clear(); m3dPintar(); m3dPainelSel(); }
    else if (ac === 'mostrar') { M3.ocultos.clear(); M3.isolados = null; M3.chips = { st: new Set(), fase: new Set(), eixo: new Set() }; m3dPintar(); m3dPainelSel(); m3dChips(); }
    else if (ac === 'chlimpar') { M3.chips = { st: new Set(), fase: new Set(), eixo: new Set() }; m3dAplicarChips(); }
    else if (ac === 'chsel') { const R = m3dStatusReal(); M3.sel = new Set(m3dSelRaizes(i => m3dChipsPassa(i, R))); m3dPintar(); m3dPainelSel(); m3dBarraCampo(); toast(M3.sel.size.toLocaleString('pt-BR') + ' peça(s) selecionada(s).'); }
    else if (ac === 'props') m3dMostrarProps();
    else if (ac === 'icar' || ac === 'torquear' || ac === 'desicar' || ac === 'destorq') m3dApontar(ac);
    else if (ac === 'vit') m3dVitrineSelecionar(b.dataset.k);
    else if (ac === 'novo') m3dAbrirGrupo(null);
    else if (ac === 'fsel') m3dFiltrar(false);
    else if (ac === 'fsomar') m3dFiltrar(true);
    else if (ac === 'gsel') { const g = M3.grupos.find(x => x.id === +b.dataset.id); if (g) m3dSelGrupo(g); }
    else if (ac === 'geditar') { const g = M3.grupos.find(x => x.id === +b.dataset.id); if (g) m3dAbrirGrupo(g); }
    else if (ac === 'soltar') {
      try { await m3dPost('soltar', { modelo_id: M3.modeloId, guids: m3dGuidsSel().guids }); toast('Peças tiradas da frente (sem prazo).'); await m3dRecarregarGrupos(); } catch (e) { toast(e.message, true); }
    }
  });
  corpo.addEventListener('toggle', ev => { if (ev.target.id === 'm3dTec' && ev.target.open) m3dMostrarProps(); }, true);
  corpo.addEventListener('click', ev => {   // tour e menu "mais ferramentas"
    const tb = ev.target.closest('[data-tour]');
    if (tb) { if (tb.dataset.tour === 'pular') m3dTourFechar(false); else if (M3.tour >= M3D_TOUR.length - 1) m3dTourFechar(true); else { M3.tour++; m3dTourDesenhar(); } return; }
    if (ev.target.closest('.m3d-menu button')) { const det = ev.target.closest('details'); if (det) det.open = false; }
    if (ev.target.closest('[data-m3d="tour"]')) m3dTourIniciar(true);
  });
  corpo.addEventListener('change', async ev => {
    const t = ev.target;
    if (t.dataset.m3dGrupo) {
      const id = Number(t.dataset.m3dGrupo);
      if (t.checked) M3.filtroGrupos.add(id); else M3.filtroGrupos.delete(id);
      M3.sel.clear();
      M3.antes = true;
      const antes = $('#m3dAntes');
      if (antes) antes.checked = true;
      m3dDefinirCores('4d');
      return;
    }
    if (t.id === 'm3dFTipo') { M3.filtroTipo = t.value; m3dPainelFiltro(); }
    else if (t.id === 'm3dFSem') M3.filtroSem = t.checked;
    else if (t.id === 'm3dVel') M3.vel = parseInt(t.value, 10) || 1;
    else if (t.id === 'm3dAntes') { M3.antes = t.checked; m3dPintar(); }
    else if (t.id === 'm3dSemPrazo') { M3.semPrazo = t.checked; m3dPintar(); }
    else if (t.id === 'm3dAddGrupo' && t.value) {
      const g = M3.grupos.find(x => x.id === +t.value), s = m3dGuidsSel();
      try {
        await m3dPost('grupo_salvar', Object.assign({}, g, { modelo_id: M3.modeloId, guids: undefined, itens: undefined, adicionar: s.guids, rotulos: s.rotulos }));
        toast(`${s.guids.length.toLocaleString('pt-BR')} peça(s) movidas para “${g.nome}”.`);
        await m3dRecarregarGrupos(true);
      } catch (e) { toast(e.message, true); }
    }
  });
  corpo.addEventListener('input', ev => {
    const situacao = ev.target.dataset.m3dCor;
    if (Object.hasOwn(M3D_ROT, situacao)) {
      const cor = ev.target.value;
      if (/^#[0-9a-f]{6}$/i.test(cor)) {
        m3dCoresPersonalizadas[situacao] = cor;
        m3dSalvarCores();
        if (M3.cores === '4d') m3dPintar();
        else m3dDefinirCores('4d');
      }
      return;
    }
    if (ev.target.id !== 'm3dSlider' || !M3.lim) return;
    m3dParar();
    m3dIrDia(add(M3.lim[0], parseInt(ev.target.value, 10) || 0));
  });
}
function m3dSelGrupo(g) {   // seleciona as peças da frente no modo atual (peça montável inteira ou os componentes dela)
  const d = M3.d, itens = g.itens || [];
  M3.sel.clear();
  if (M3.modo === 'conj') {
    itens.forEach(i => M3.sel.add(d.raiz[i]));
  } else {
    const conj = new Set(itens.filter(i => d.e.pai[i] < 0));
    itens.forEach(i => { if (i < d.nGeo) M3.sel.add(i); });
    if (conj.size) for (let i = 0; i < d.nGeo; i++) if (conj.has(d.raiz[i])) M3.sel.add(i);
  }
  m3dPintar();
  m3dPainelSel();
  m3dVistaPadrao('enq');
}
