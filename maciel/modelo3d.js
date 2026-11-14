// Produção › Modelo 3D (4D): abre o IFC da obra em 3D, deixa selecionar elementos (clique, Shift e caixa de seleção),
// agrupa em GRUPOS DE MONTAGEM com início/término previstos, situação e equipe, e simula a montagem na linha do tempo.
// Servidor: modelo3d.php (arquivos, grupos e vínculos por GUID). Conversão do IFC: m3d_conversor.js (segundo plano).
// Usa utilidades do app.js: $, esc, toast, fdA, add, diasEntre, hoje, ref, M, cap.
const M3D_URL = 'modelo3d.php';
const M3D_PARTE = 4 * 1048576;
const M3D_VER = ((document.currentScript && document.currentScript.src) || '').split('v=')[1] || '1';
const M3D_COR = { sel: '#f59e0b', antes: '#d5d9e0', montando: '#2563eb', feito: '#16a34a', previsto: '#86d6a0', atrasado: '#dc2626', sem: '#c3c8d1' };
const M3D_ROT = { antes: 'Não iniciado', montando: 'Em montagem', feito: 'Concluído', previsto: 'Concluído (previsto)', atrasado: 'Atrasado', sem: 'Sem prazo definido' };
const M3 = { pronto: false, estado: null, modeloId: 0, grupos: [], d: null, sel: new Set(), modo: 'conj', somar: false, caixa: false,
  cores: 'orig', dia: '', antes: false, semPrazo: true, ocultos: new Set(), isolados: null, tocando: null, vel: 1, refVista: '', props: null, carregando: false };

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
  if (!r.ok) throw new Error(j.erro || 'Falha ao gravar.');
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
  if (M3.refVista !== m3dHoje()) { M3.refVista = m3dHoje(); m3dPintar(); m3dListaGrupos(); }
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
    <span class="m3d-esp"></span>
    <div class="seg" id="m3dModo" title="O que um clique seleciona"><button type="button" data-m="conj" class="ativa">Conjunto</button><button type="button" data-m="peca">Peça</button></div>
    <div class="seg" id="m3dCores" title="Cores do modelo"><button type="button" data-c="orig" class="ativa">Cores do projeto</button><button type="button" data-c="4d">Simulação 4D</button></div>
  </div>
  <div class="m3d-area">
    <div class="m3d-col">
      <div class="m3d-vista" id="m3dVista">
        <canvas id="m3dCanvas"></canvas>
        <div class="m3d-caixa" id="m3dCaixaSel" hidden></div>
        <div class="m3d-aviso" id="m3dAviso"></div>
        <div class="m3d-ferr">
          <button type="button" class="btn" data-v="iso" title="Vista em perspectiva">Iso</button>
          <button type="button" class="btn" data-v="topo" title="Vista de cima">Topo</button>
          <button type="button" class="btn" data-v="frente" title="Vista de frente">Frente</button>
          <button type="button" class="btn" data-v="lado" title="Vista lateral">Lado</button>
          <button type="button" class="btn" data-v="enq" title="Enquadrar a seleção (ou o modelo todo)">Enquadrar</button>
          <button type="button" class="btn" id="m3dBtnSomar" title="Cada clique soma à seleção (igual a segurar Shift)">Somar cliques</button>
          <button type="button" class="btn" id="m3dBtnCaixa" title="Arrastar desenha uma caixa de seleção (igual a Shift + arrastar)">Caixa</button>
        </div>
        <div class="m3d-dica" id="m3dDica">Arrastar gira · roda do mouse aproxima · botão direito desloca · clique seleciona · <b>Shift + clique</b> soma · <b>Shift + arrastar</b> = caixa de seleção</div>
      </div>
      <div class="bloco m3d-tempo" id="m3dTempo"></div>
    </div>
    <aside class="m3d-painel">
      <div class="bloco" id="m3dSelBox"></div>
      <div class="bloco" id="m3dFiltroBox"></div>
      <div class="bloco" id="m3dGruposBox"></div>
    </aside>
  </div>`;
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
  const ms = M3.estado.modelos, sel = $('#m3dModelo');
  const docs = M3.estado.docs_ifc || [];
  sel.innerHTML = (ms.length ? ms.map(m => `<option value="${m.id}">${esc(m.nome)}</option>`).join('') : '<option value="">(nenhum modelo enviado)</option>') +
    (docs.length && m3dPodeEditar() ? '<optgroup label="IFC já guardado na importação da obra — usar como modelo">' + docs.map(d => `<option value="doc:${d.id}">${esc(d.nome)}</option>`).join('') + '</optgroup>' : '');
  $('#m3dEnviar').hidden = $('#m3dExcluirModelo').hidden = !m3dPodeEditar();
  const alvo = ms.find(m => m.id === (manterId || M3.modeloId)) || ms[0];
  if (alvo) {
    sel.value = String(alvo.id);
    if (alvo.id !== M3.modeloId || !M3.d) m3dAbrirModelo(alvo.id);
  } else {
    M3.modeloId = 0;
    m3dLimparCena();
    m3dAviso(m3dPodeEditar()
      ? '<b>Nenhum modelo 3D nesta obra.</b><br>Clique em <b>+ Enviar IFC</b> e escolha o arquivo .ifc exportado do Tekla ou do Trimble Connect.' + (docs.length ? '<br>Ou escolha, na lista <b>Modelo</b>, um IFC que a importação da obra já guardou.' : '')
      : '<b>Nenhum modelo 3D nesta obra.</b><br>A gestão da obra ainda não enviou o IFC.');
    m3dPaineis();
  }
  $('#m3dExcluirModelo').disabled = !alvo;
}

// ---------------------------------------------------------------- abrir e converter o modelo
async function m3dAbrirModelo(id, bufLocal) {
  if (M3.carregando) return;
  M3.carregando = true;
  M3.modeloId = id;
  M3.sel.clear(); M3.ocultos.clear(); M3.isolados = null; M3.props = null; M3.grupos = [];
  m3dLimparCena();
  m3dPaineis();
  const mod = M3.estado.modelos.find(m => m.id === id);
  try {
    let geo;
    if (mod && mod.cache && !bufLocal) {
      m3dAviso('<span class="m3d-gira"></span> Baixando o modelo…');
      const r = await fetch(`${M3D_URL}?acao=cache&id=${id}&tipo=geo`);
      if (!r.ok) throw new Error('Não consegui baixar o modelo convertido.');
      geo = await m3dDescompactar(await r.arrayBuffer());
    } else {
      let ifc = bufLocal;
      if (!ifc) {
        m3dAviso('<span class="m3d-gira"></span> Baixando o IFC…');
        const r = await fetch(`${M3D_URL}?acao=arquivo&id=${id}`);
        if (!r.ok) throw new Error('Não consegui baixar o IFC deste modelo.');
        ifc = await r.arrayBuffer();
      }
      const conv = await m3dConverter(ifc);
      geo = conv.geo;
      M3.props = JSON.parse(new TextDecoder().decode(conv.props));
      if (m3dPodeEditar()) m3dGravarCache(id, conv);   // em segundo plano: as próximas aberturas não reconvertem
    }
    m3dAviso('<span class="m3d-gira"></span> Montando a cena 3D…');
    await new Promise(r => setTimeout(r, 30));
    M3.d = m3dLerGeo(geo);
    await m3dMontarCena();
    const g = await m3dGet(`acao=grupos&modelo=${id}`);
    M3.grupos = g.grupos;
    m3dIndexarGrupos();
    m3dAviso('');
    m3dVistaPadrao('iso');
    m3dPintar();
  } catch (e) {
    m3dAviso('<b>Não foi possível abrir o modelo.</b><br>' + esc(e.message), true);
  }
  M3.carregando = false;
  m3dPaineis();
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
    const t0 = Date.now();
    const rel = setInterval(() => { const s = $('#m3dConvSeg'); if (s) s.textContent = Math.round((Date.now() - t0) / 1000) + ' s'; }, 1000);
    const fim = () => { clearInterval(rel); w.terminate(); };
    w.onmessage = ev => {
      const m = ev.data;
      if (m.t === 'prog') m3dAviso(`<span class="m3d-gira"></span> <b>Convertendo o IFC (só na primeira vez)</b><br>${esc(m.txt)}<br><small>Modelos grandes levam alguns minutos. Mantenha esta aba aberta · <span id="m3dConvSeg">${Math.round((Date.now() - t0) / 1000)} s</span></small>`);
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
  M3.d = null;
  if (T) m3dDesenhar();
}

async function m3dMontarCena() {
  const TH = M3.TH || (M3.TH = await import('./vendor/m3d/three.m3d.js?v=' + M3D_VER));
  let T = M3.T;
  if (!T) {
    const canvas = $('#m3dCanvas');
    const rend = new TH.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
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
    gid[g] = malha.addGeometry(geo);
    ov += nv; oi += ni;
    if (g % 400 === 399) await new Promise(r => setTimeout(r, 0));
  }
  const m4 = new TH.Matrix4(), v = new TH.Vector3(), cor = new TH.Color();
  const centro = new Float32Array(d.nInst * 4), base = new Float32Array(d.nInst * 3);
  const caixa = new TH.Box3();
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
  }
  // instâncias de cada elemento e de cada conjunto (raiz), em listas compactas
  const nEl = d.n, cEl = new Uint32Array(nEl + 1), cRz = new Uint32Array(nEl + 1);
  for (let i = 0; i < d.nInst; i++) { cEl[a.iel[i] + 1]++; cRz[d.raiz[a.iel[i]] + 1]++; }
  for (let i = 0; i < nEl; i++) { cEl[i + 1] += cEl[i]; cRz[i + 1] += cRz[i]; }
  const lEl = new Uint32Array(d.nInst), lRz = new Uint32Array(d.nInst), pE = cEl.slice(0, nEl), pR = cRz.slice(0, nEl);
  for (let i = 0; i < d.nInst; i++) { lEl[pE[a.iel[i]]++] = i; lRz[pR[d.raiz[a.iel[i]]]++] = i; }
  Object.assign(d, { centro, base, caixa, cEl, lEl, cRz, lRz, iel: a.iel.slice() });
  d.a = null;   // solta a geometria crua: a placa de vídeo já tem a cópia
  d.grupoDeEl = new Int32Array(nEl).fill(-1);
  T.malha = malha;
  T.cena.add(malha);
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
  requestAnimationFrame(() => { T.pend = false; if ($('#m3dVista').clientWidth) T.rend.render(T.cena, T.cam); });
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

// ---------------------------------------------------------------- seleção (clique, Shift, caixa)
function m3dEventosVista(canvas) {
  let ini = null, caixa = false;
  const vista = $('#m3dVista'), ret = $('#m3dCaixaSel');
  const local = ev => { const r = canvas.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; };
  canvas.addEventListener('pointerdown', ev => {
    if (ev.button !== 0 || !M3.d) return;
    ini = local(ev);
    caixa = ev.shiftKey || M3.caixa;
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
    else if (!arrastou) m3dSelClique(p, somar, alternar);
  };
  canvas.addEventListener('pointerup', fim);
  canvas.addEventListener('pointercancel', fim);
  vista.addEventListener('contextmenu', ev => ev.preventDefault());
  document.addEventListener('keydown', ev => {
    if (ev.key !== 'Escape' || !M3.sel.size || $('#aba-m3d').hidden || document.querySelector('dialog[open]')) return;
    M3.sel.clear(); m3dPintar(); m3dPainelSel();
  });
}

function m3dSelClique(p, somar, alternar) {
  const T = M3.T, TH = M3.TH;
  T.raio.setFromCamera(new TH.Vector2(p[0] / T.w * 2 - 1, -(p[1] / T.h) * 2 + 1), T.cam);
  const hits = T.raio.intersectObject(T.malha, false);
  const item = hits.length ? m3dItemDeInst(hits[0].batchId) : -1;
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
  for (let i = 0; i < d.nInst; i++) {
    if (!T.malha.getVisibleAt(i)) continue;
    const x = d.centro[i * 4], y = d.centro[i * 4 + 1], z = d.centro[i * 4 + 2];
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
    g.guids.forEach(gu => { const i = d.guidDe.get(gu); if (i !== undefined) { d.grupoDeEl[i] = k; g.itens.push(i); } });
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
  if (g.status === 'concluido') return ['concluido', 'Concluído' + (g.concluido_em ? ' em ' + fdA(g.concluido_em) : '')];
  if (g.fim && hj > g.fim) return ['atrasado', 'Atrasado · ' + diasEntre(g.fim, hj) + ' dia(s) após o término'];
  if (g.status === 'nao_iniciado' && g.inicio && hj > g.inicio) return ['atrasado', 'Atrasado · deveria ter iniciado em ' + fdA(g.inicio)];
  return g.status === 'em_andamento' ? ['em_andamento', 'Em andamento'] : ['nao_iniciado', 'Não iniciado'];
}

function m3dPintar() {
  const T = M3.T, d = M3.d;
  if (!T || !T.malha || !d) return;
  const TH = M3.TH, cores = {}, hj = m3dHoje(), q = { antes: 0, montando: 0, feito: 0, previsto: 0, atrasado: 0, sem: 0 };
  Object.keys(M3D_COR).forEach(k => { cores[k] = new TH.Color(M3D_COR[k]); });
  const sit = M3.grupos.map(g => m3dSituacaoEm(g, M3.dia, hj));
  const c = new TH.Color(), sel = M3.sel, m4 = M3.cores === '4d', contou = new Uint8Array(d.n);
  for (let i = 0; i < d.nInst; i++) {
    const el = d.iel[i], rz = d.raiz[el];
    let vis = true;
    if (sel.has(el) || sel.has(rz)) {
      c.copy(cores.sel);
    } else {
      if (M3.ocultos.has(el) || M3.ocultos.has(rz) || (M3.isolados && !M3.isolados.has(el) && !M3.isolados.has(rz))) vis = false;
      if (m4) {
        const g = d.grupoDeEl[el] >= 0 ? d.grupoDeEl[el] : d.grupoDeEl[rz], s = g >= 0 ? sit[g] : 'sem';
        if (s === 'antes' && !M3.antes) vis = false;
        if (s === 'sem' && !M3.semPrazo) vis = false;
        c.copy(cores[s]);
      } else {
        c.setRGB(d.base[i * 3], d.base[i * 3 + 1], d.base[i * 3 + 2]);
      }
    }
    if (m4 && !contou[rz]) { contou[rz] = 1; const g = d.grupoDeEl[el] >= 0 ? d.grupoDeEl[el] : d.grupoDeEl[rz]; q[g >= 0 ? sit[g] : 'sem']++; }
    T.malha.setVisibleAt(i, vis);
    T.malha.setColorAt(i, c);
  }
  M3.contagem = q;
  m3dContagem();
  m3dDesenhar();
}

// ---------------------------------------------------------------- painéis
function m3dPaineis() { m3dPainelSel(); m3dPainelFiltro(); m3dListaGrupos(); m3dTempo(); }

function m3dTxt(col, i) { const d = M3.d; return d.s[d.e[col][i]] || ''; }
function m3dRotulo(i) { return m3dTxt('marca', i) || m3dTxt('nome', i) || m3dTxt('cls', i) || M3.d.e.guid[i]; }

function m3dPainelSel() {
  const box = $('#m3dSelBox');
  if (!box) return;
  const d = M3.d;
  if (!d) { box.innerHTML = '<h3>Seleção</h3><p class="nota">Abra um modelo para selecionar elementos.</p>'; return; }
  const itens = [...M3.sel], n = itens.length, ed = m3dPodeEditar();
  if (!n) {
    box.innerHTML = `<h3>Seleção</h3><p class="nota">Clique em um elemento do modelo. Para vários: <b>Shift + clique</b>, <b>Shift + arrastar</b> (caixa) ou use “Selecionar por” abaixo.</p>
      <p class="nota">${d.cab.n_unid.toLocaleString('pt-BR')} conjuntos · ${d.nGeo.toLocaleString('pt-BR')} peças no modelo.</p>` +
      (M3.ocultos.size || M3.isolados ? '<button type="button" class="btn" data-m3d="mostrar">Mostrar tudo</button>' : '');
    return;
  }
  const porGrupo = new Map();
  itens.forEach(i => { const g = m3dGrupoDeItem(i); porGrupo.set(g, (porGrupo.get(g) || 0) + 1); });
  const linhasGrupo = [...porGrupo].map(([g, q]) => `<li>${g >= 0 ? '<b>' + esc(M3.grupos[g].nome) + '</b>' : '<i>sem grupo (sem prazo)</i>'} — ${q.toLocaleString('pt-BR')}</li>`).join('');
  let det = '';
  if (n === 1) {
    const i = itens[0], g = m3dGrupoDeItem(i), pai = d.e.pai[i];
    const lin = [['Nome', m3dTxt('nome', i)], ['Marca', m3dTxt('marca', i)], ['Classe IFC', m3dTxt('cls', i)], ['Fase', m3dTxt('fase', i)], ['Pavimento', m3dTxt('pav', i)],
      ['Conjunto', pai >= 0 ? m3dRotulo(d.raiz[i]) : ''], ['GUID (GlobalId)', d.e.guid[i]]].filter(x => x[1]);
    det = '<table class="m3d-props" data-sem-ferramentas data-sem-limite>' + lin.map(x => `<tr><th>${esc(x[0])}</th><td>${esc(x[1])}</td></tr>`).join('') + '</table>';
    if (g >= 0) {
      const G = M3.grupos[g], s = m3dSituacaoHoje(G);
      det += `<div class="m3d-prazo"><b>${esc(G.nome)}</b><br>${fdA(G.inicio)} a ${fdA(G.fim)} · <span class="m3d-chip s-${s[0]}">${esc(s[1])}</span>${G.empresa ? '<br>Equipe: ' + esc(G.empresa) : ''}${G.responsavel ? ' · ' + esc(G.responsavel) : ''}</div>`;
    }
    det += '<div id="m3dPropsTodas"><button type="button" class="btn" data-m3d="props">Ver todas as propriedades</button></div>';
  } else {
    const porNome = new Map();
    itens.forEach(i => { const k = m3dTxt('nome', i) || m3dTxt('cls', i) || '—'; porNome.set(k, (porNome.get(k) || 0) + 1); });
    const top = [...porNome].sort((a, b) => b[1] - a[1]);
    det = '<ul class="m3d-lista">' + top.slice(0, 6).map(x => `<li>${esc(x[0])} — ${x[1].toLocaleString('pt-BR')}</li>`).join('') + (top.length > 6 ? `<li>… e mais ${top.length - 6} tipo(s)</li>` : '') + '</ul>';
  }
  const opG = M3.grupos.map(g => `<option value="${g.id}">${esc(g.nome)}</option>`).join('');
  box.innerHTML = `<h3>Seleção · ${n.toLocaleString('pt-BR')} ${M3.modo === 'conj' ? (n === 1 ? 'conjunto' : 'conjuntos') : (n === 1 ? 'peça' : 'peças')}</h3>${det}
    <ul class="m3d-lista m3d-de-grupo">${linhasGrupo}</ul>
    <div class="m3d-acoes">
      ${ed ? `<button type="button" class="btn primario" data-m3d="novo">Definir prazo (novo grupo)</button>
      ${opG ? `<select id="m3dAddGrupo"><option value="">Adicionar a um grupo…</option>${opG}</select>` : ''}
      <button type="button" class="btn" data-m3d="soltar" title="Tira os elementos selecionados do grupo: ficam sem prazo">Tirar do grupo</button>` : ''}
      <button type="button" class="btn" data-m3d="isolar">Isolar</button>
      <button type="button" class="btn" data-m3d="ocultar">Ocultar</button>
      ${M3.ocultos.size || M3.isolados ? '<button type="button" class="btn" data-m3d="mostrar">Mostrar tudo</button>' : ''}
      <button type="button" class="btn" data-m3d="limpar">Limpar seleção</button>
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
    alvo.innerHTML = (bloco(i, '') + (rz !== i ? bloco(rz, 'Conjunto · ') : '')) || '<span class="nota">Este elemento não tem propriedades no IFC.</span>';
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
  box.innerHTML = `<h3>Selecionar por</h3>
    <div class="m3d-filtro">
      <select id="m3dFTipo">${[['fase', 'Fase do projeto'], ['nome', 'Nome'], ['marca', 'Marca'], ['pav', 'Pavimento'], ['cls', 'Classe IFC']].map(x => `<option value="${x[0]}"${x[0] === tipo ? ' selected' : ''}>${x[1]}</option>`).join('')}</select>
      <select id="m3dFValor">${vals.map(x => `<option value="${esc(x[0])}">${esc(x[0] || '(vazio)')} — ${x[1].toLocaleString('pt-BR')}</option>`).join('')}</select>
      <label class="m3d-chk"><input type="checkbox" id="m3dFSem"${M3.filtroSem ? ' checked' : ''}> só o que ainda está sem prazo</label>
      <div class="m3d-acoes"><button type="button" class="btn" data-m3d="fsel">Selecionar</button><button type="button" class="btn" data-m3d="fsomar">Somar à seleção</button></div>
    </div>`;
}
function m3dFiltrar(somar) {
  const tipo = $('#m3dFTipo').value, val = $('#m3dFValor').value, sem = $('#m3dFSem').checked;
  if (!somar) M3.sel.clear();
  let q = 0;
  m3dItens().forEach(i => { if (m3dTxt(tipo, i) === val && (!sem || m3dGrupoDeItem(i) < 0)) { M3.sel.add(i); q++; } });
  m3dPintar();
  m3dPainelSel();
  toast(q ? q.toLocaleString('pt-BR') + ' elemento(s) selecionado(s).' : 'Nenhum elemento com esse valor.');
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
      <button type="button" class="m3d-g-nome" data-m3d="gsel" data-id="${g.id}" title="Selecionar os elementos deste grupo">${esc(g.nome)}</button>
      <span class="m3d-chip s-${s[0]}" title="${esc(s[1])}">${esc(s[1].split(' · ')[0])}</span>
      <small>${fdA(g.inicio)} a ${fdA(g.fim)} · ${n.toLocaleString('pt-BR')} el.${g.empresa ? ' · ' + esc(g.empresa) : ''}${g.responsavel ? ' · ' + esc(g.responsavel) : ''}</small>
      ${g.atividade ? `<small>Atividade: ${esc(g.atividade)}</small>` : ''}
      ${m3dPodeEditar() ? `<button type="button" class="btn m3d-g-ed" data-m3d="geditar" data-id="${g.id}">Editar</button>` : ''}
    </li>`;
  }).join('');
  box.innerHTML = `<h3>Grupos de montagem · ${M3.grupos.length}</h3>
    <p class="nota">${M3.modo === 'conj' ? `${Math.min(comPrazo, tot).toLocaleString('pt-BR')} de ${tot.toLocaleString('pt-BR')} conjuntos com prazo definido.` : ''}</p>
    ${linhas ? `<ul class="m3d-grupos">${linhas}</ul>` : '<p class="nota">Nenhum grupo ainda. Selecione elementos e clique em <b>Definir prazo (novo grupo)</b>.</p>'}`;
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
    box.innerHTML = '<h3>Linha do tempo (4D)</h3><p class="nota">Defina o prazo de pelo menos um grupo de montagem para simular a obra no tempo.</p>';
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
    <div class="m3d-legenda" id="m3dCont"></div>`;
  M3.lim = lim;
  m3dContagem();
}
function m3dContagem() {
  const c = $('#m3dCont');
  if (!c) return;
  if (M3.cores !== '4d') { c.innerHTML = '<span class="nota">Arraste a linha do tempo (ou clique em Simular) para ver a obra em cada data.</span>'; return; }
  const q = M3.contagem || {};
  c.innerHTML = ['montando', 'feito', 'previsto', 'atrasado', 'antes', 'sem'].map(k =>
    `<span class="m3d-leg"><i style="background:${M3D_COR[k]}"></i>${M3D_ROT[k]}${k === 'antes' && !M3.antes ? ' (oculto)' : ''}: <b>${(q[k] || 0).toLocaleString('pt-BR')}</b></span>`).join('');
}
function m3dIrDia(dia) {
  M3.dia = dia;
  const s = $('#m3dSlider'), r = $('#m3dDia');
  if (s && M3.lim) s.value = diasEntre(M3.lim[0], dia);
  if (r) r.textContent = fdA(dia);
  if (M3.cores !== '4d') m3dDefinirCores('4d'); else m3dPintar();
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
    <div class="bloco-cab"><h2>${novo ? 'Novo grupo de montagem' : 'Editar grupo de montagem'}</h2><button type="button" class="btn-icone" data-m3d-f="fechar" aria-label="Fechar">×</button></div>
    <p class="nota">${novo ? `${n.toLocaleString('pt-BR')} elemento(s) selecionado(s) entram neste grupo.` : `${(g.itens || []).length.toLocaleString('pt-BR')} elemento(s) no grupo.`}</p>
    <div class="campos">
      <label class="largo"><span class="obrig">Nome do grupo / etapa de montagem</span><input type="text" name="nome" maxlength="160" required value="${esc(g.nome)}" placeholder="ex.: Vigas da cobertura — eixos 01 a 05"></label>
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
      ${novo ? '' : '<button type="button" class="btn" data-m3d-f="trocar" title="O grupo passa a ter exatamente os elementos selecionados agora">Trocar pelos selecionados (' + n.toLocaleString('pt-BR') + ')</button><button type="button" class="btn perigo" data-m3d-f="excluir">Excluir grupo</button>'}
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
      toast(novo ? 'Grupo criado: prazo definido para os elementos selecionados.' : 'Grupo salvo.');
      await m3dRecarregarGrupos();
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
      if (b.dataset.conf !== '1') { b.dataset.conf = '1'; b.textContent = 'Confirmar: excluir o grupo'; return; }
      try { await m3dPost('grupo_excluir', { id: g.id }); dlg.close(); toast('Grupo excluído. Os elementos ficaram sem prazo.'); await m3dRecarregarGrupos(); } catch (e) { toast(e.message, true); }
    }
  });
  dlg.showModal();
  if (typeof patchDatas === 'function') patchDatas();
}
function m3dGuidsSel() {
  const d = M3.d, guids = [], rotulos = {};
  M3.sel.forEach(i => { const g = d.e.guid[i]; if (g) { guids.push(g); rotulos[g] = m3dRotulo(i); } });
  return { guids, rotulos };
}
async function m3dRecarregarGrupos() {
  const g = await m3dGet(`acao=grupos&modelo=${M3.modeloId}`);
  M3.grupos = g.grupos;
  m3dIndexarGrupos();
  m3dPintar();
  m3dPaineis();
}

// ---------------------------------------------------------------- ações da tela
function m3dLigar() {
  const corpo = $('#m3dCorpo');
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
    const v = ev.target.closest('[data-v]');
    if (v) { m3dVistaPadrao(v.dataset.v); return; }
    if (ev.target.closest('#m3dBtnSomar')) { M3.somar = !M3.somar; $('#m3dBtnSomar').classList.toggle('ativo', M3.somar); return; }
    if (ev.target.closest('#m3dBtnCaixa')) { M3.caixa = !M3.caixa; $('#m3dBtnCaixa').classList.toggle('ativo', M3.caixa); return; }
    if (ev.target.closest('#m3dPlay')) { m3dTocar(); return; }
    if (ev.target.closest('#m3dHojeBtn')) { m3dParar(); m3dIrDia(m3dHoje() < M3.lim[0] ? M3.lim[0] : m3dHoje() > M3.lim[1] ? M3.lim[1] : m3dHoje()); return; }
    const b = ev.target.closest('[data-m3d]');
    if (!b || !M3.d) return;
    const ac = b.dataset.m3d;
    if (ac === 'limpar') { M3.sel.clear(); m3dPintar(); m3dPainelSel(); }
    else if (ac === 'isolar') { M3.isolados = new Set(M3.sel); M3.sel.clear(); m3dPintar(); m3dPainelSel(); }
    else if (ac === 'ocultar') { M3.sel.forEach(i => M3.ocultos.add(i)); M3.sel.clear(); m3dPintar(); m3dPainelSel(); }
    else if (ac === 'mostrar') { M3.ocultos.clear(); M3.isolados = null; m3dPintar(); m3dPainelSel(); }
    else if (ac === 'props') m3dMostrarProps();
    else if (ac === 'novo') m3dAbrirGrupo(null);
    else if (ac === 'fsel') m3dFiltrar(false);
    else if (ac === 'fsomar') m3dFiltrar(true);
    else if (ac === 'gsel') { const g = M3.grupos.find(x => x.id === +b.dataset.id); if (g) { m3dSelGrupo(g); } }
    else if (ac === 'geditar') { const g = M3.grupos.find(x => x.id === +b.dataset.id); if (g) m3dAbrirGrupo(g); }
    else if (ac === 'soltar') {
      try { await m3dPost('soltar', { modelo_id: M3.modeloId, guids: m3dGuidsSel().guids }); toast('Elementos tirados do grupo (sem prazo).'); await m3dRecarregarGrupos(); } catch (e) { toast(e.message, true); }
    }
  });
  corpo.addEventListener('change', async ev => {
    const t = ev.target;
    if (t.id === 'm3dFTipo') { M3.filtroTipo = t.value; m3dPainelFiltro(); }
    else if (t.id === 'm3dFSem') M3.filtroSem = t.checked;
    else if (t.id === 'm3dVel') M3.vel = parseInt(t.value, 10) || 1;
    else if (t.id === 'm3dAntes') { M3.antes = t.checked; m3dPintar(); }
    else if (t.id === 'm3dSemPrazo') { M3.semPrazo = t.checked; m3dPintar(); }
    else if (t.id === 'm3dAddGrupo' && t.value) {
      const g = M3.grupos.find(x => x.id === +t.value), s = m3dGuidsSel();
      try {
        await m3dPost('grupo_salvar', Object.assign({}, g, { modelo_id: M3.modeloId, guids: undefined, itens: undefined, adicionar: s.guids, rotulos: s.rotulos }));
        toast(`${s.guids.length.toLocaleString('pt-BR')} elemento(s) adicionados a “${g.nome}”.`);
        await m3dRecarregarGrupos();
      } catch (e) { toast(e.message, true); }
    }
  });
  corpo.addEventListener('input', ev => {
    if (ev.target.id !== 'm3dSlider' || !M3.lim) return;
    m3dParar();
    m3dIrDia(add(M3.lim[0], parseInt(ev.target.value, 10) || 0));
  });
}
function m3dSelGrupo(g) {   // seleciona os elementos do grupo no modo atual (conjunto inteiro ou as peças dele)
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
