// Conversor do modelo 3D (roda em segundo plano, fora da tela): lê o IFC com a biblioteca web-ifc e devolve
//  • "geo"   — um bloco binário com a geometria (cada forma repetida é guardada uma vez só), as instâncias e a tabela de elementos (GUID, classe, nome, marca, fase…);
//  • "props" — as propriedades (Psets e quantidades) de cada elemento, em JSON.
// O resultado é mostrado na tela e gravado no servidor: as próximas aberturas não reconvertem o IFC.
import * as WebIFC from './vendor/m3d/web-ifc-api.js';

const VERSAO = 1;
const ESPACIAIS = new Set(['IFCPROJECT', 'IFCSITE', 'IFCBUILDING', 'IFCBUILDINGSTOREY', 'IFCSPACE']);

class Cresce {   // vetor tipado que dobra de tamanho quando enche
  constructor(Tipo, n) { this.a = new Tipo(n || 1024); this.n = 0; }
  cabe(q) {
    if (this.n + q <= this.a.length) return;
    let t = this.a.length; while (t < this.n + q) t *= 2;
    const b = new this.a.constructor(t); b.set(this.a.subarray(0, this.n)); this.a = b;
  }
  fim() { return this.a.subarray(0, this.n); }
}

const txt = v => (v && typeof v === 'object' && 'value' in v ? v.value : v);
function limpo(v) { v = txt(v); return v == null ? '' : String(v); }

function converter(api, bytes, prog) {
  const m = api.OpenModel(bytes, { COORDINATE_TO_ORIGIN: true });
  if (m < 0) throw new Error('Não consegui abrir o IFC.');
  // ---------------------------------------------------------------- geometria
  const pos = new Cresce(Float32Array, 1 << 20), nor = new Cresce(Int8Array, 1 << 20), idx = new Cresce(Uint32Array, 1 << 20);
  const gVert = new Cresce(Uint32Array), gIdx = new Cresce(Uint32Array);
  const iGeo = new Cresce(Uint32Array), iEl = new Cresce(Uint32Array), iMat = new Cresce(Float32Array, 1 << 14), iCor = new Cresce(Uint8Array, 1 << 12);
  const geoDe = new Map();      // expressID da geometria → índice
  const elDe = new Map();       // expressID do elemento → índice na tabela
  const elIds = [];
  let nInst = 0, tris = 0;
  api.StreamAllMeshes(m, mesh => {
    const pg = mesh.geometries, q = pg.size();
    let el = -1;
    for (let k = 0; k < q; k++) {
      const p = pg.get(k);
      let g = geoDe.get(p.geometryExpressID);
      if (g === undefined) {
        const geo = api.GetGeometry(m, p.geometryExpressID);
        const v = api.GetVertexArray(geo.GetVertexData(), geo.GetVertexDataSize());
        const ix = api.GetIndexArray(geo.GetIndexData(), geo.GetIndexDataSize());
        const nv = v.length / 6;
        if (!nv || !ix.length) { geo.delete(); geoDe.set(p.geometryExpressID, -1); continue; }
        pos.cabe(nv * 3); nor.cabe(nv * 3);
        for (let i = 0, o = pos.n; i < nv; i++, o += 3) {
          pos.a[o] = v[i * 6]; pos.a[o + 1] = v[i * 6 + 1]; pos.a[o + 2] = v[i * 6 + 2];
          nor.a[o] = Math.round(v[i * 6 + 3] * 127); nor.a[o + 1] = Math.round(v[i * 6 + 4] * 127); nor.a[o + 2] = Math.round(v[i * 6 + 5] * 127);
        }
        pos.n += nv * 3; nor.n += nv * 3;
        idx.cabe(ix.length); idx.a.set(ix, idx.n); idx.n += ix.length;
        g = gVert.n;
        gVert.cabe(1); gVert.a[gVert.n++] = nv;
        gIdx.cabe(1); gIdx.a[gIdx.n++] = ix.length;
        geoDe.set(p.geometryExpressID, g);
        geo.delete();
      }
      if (g < 0) continue;
      if (el < 0) {
        el = elDe.get(mesh.expressID);
        if (el === undefined) { el = elIds.length; elIds.push(mesh.expressID); elDe.set(mesh.expressID, el); }
      }
      const t = p.flatTransformation;
      iGeo.cabe(1); iGeo.a[iGeo.n++] = g;
      iEl.cabe(1); iEl.a[iEl.n++] = el;
      iMat.cabe(12);   // matriz 4x4 por colunas, sem a última linha (0 0 0 1)
      for (let c = 0; c < 4; c++) for (let r = 0; r < 3; r++) iMat.a[iMat.n++] = t[c * 4 + r];
      iCor.cabe(4);
      iCor.a[iCor.n++] = Math.round(p.color.x * 255); iCor.a[iCor.n++] = Math.round(p.color.y * 255); iCor.a[iCor.n++] = Math.round(p.color.z * 255); iCor.a[iCor.n++] = Math.round(p.color.w * 255);
      nInst++; tris += gIdx.a[g] / 3;
    }
    if (elIds.length % 500 === 0) prog('Convertendo a geometria… ' + elIds.length.toLocaleString('pt-BR') + ' peças');
  });
  if (!nInst) throw new Error('O IFC não tem geometria para mostrar.');
  const nGeoEls = elIds.length;

  // ---------------------------------------------------------------- hierarquia (conjuntos) e pavimentos
  prog('Lendo conjuntos e propriedades…');
  const pai = [];   // por índice de elemento
  const idsDe = tipo => { const v = api.GetLineIDsWithType(m, tipo), r = []; for (let i = 0; i < v.size(); i++) r.push(v.get(i)); return r; };
  const linha = id => { try { return api.GetLine(m, id, false); } catch (e) { return null; } };
  const tipoNome = new Map();
  const nomeTipo = cod => { let n = tipoNome.get(cod); if (n === undefined) { n = api.GetNameFromTypeCode(cod) || ''; tipoNome.set(cod, n); } return n; };
  const info = new Map();   // expressID → linha do elemento
  const lerEl = id => { let l = info.get(id); if (l === undefined) { l = linha(id); info.set(id, l); } return l; };
  const indice = id => {   // índice do elemento (cria para conjuntos, que não têm geometria própria)
    let i = elDe.get(id);
    if (i === undefined) { i = elIds.length; elIds.push(id); elDe.set(id, i); }
    return i;
  };
  const paiId = new Map();
  idsDe(WebIFC.IFCRELAGGREGATES).forEach(rid => {
    const r = linha(rid); if (!r || !r.RelatingObject) return;
    const p = r.RelatingObject.value, lp = lerEl(p);
    if (!lp || ESPACIAIS.has(nomeTipo(lp.type))) return;
    (r.RelatedObjects || []).forEach(o => paiId.set(o.value, p));
  });
  for (let i = 0; i < elIds.length; i++) {   // elIds cresce dentro do laço quando aparece um conjunto novo
    const p = paiId.get(elIds[i]);
    pai[i] = p === undefined ? -1 : indice(p);
  }
  const pavDe = new Map();
  idsDe(WebIFC.IFCRELCONTAINEDINSPATIALSTRUCTURE).forEach(rid => {
    const r = linha(rid); if (!r || !r.RelatingStructure) return;
    const e = lerEl(r.RelatingStructure.value), nome = e ? limpo(e.Name) : '';
    if (!nome || /^undefined$/i.test(nome)) return;
    (r.RelatedElements || []).forEach(o => pavDe.set(o.value, nome));
  });

  // ---------------------------------------------------------------- propriedades (Psets e quantidades)
  const sets = {};          // id do conjunto de propriedades → [nome, {propriedade: valor}]
  const elSets = elIds.map(() => []);
  const propCache = new Map();
  const lerProp = id => {
    let p = propCache.get(id);
    if (p !== undefined) return p;
    const l = linha(id); p = null;
    if (l && l.Name) {
      let v = l.NominalValue;
      if (v === undefined) v = l.LengthValue ?? l.AreaValue ?? l.VolumeValue ?? l.WeightValue ?? l.CountValue ?? l.TimeValue;
      v = txt(v);
      if (v !== null && v !== undefined && v !== '') p = [limpo(l.Name), typeof v === 'number' ? Math.round(v * 1e4) / 1e4 : v];
    }
    propCache.set(id, p);
    return p;
  };
  const lerSet = id => {
    if (sets[id] !== undefined) return sets[id];
    const l = linha(id); let s = null;
    if (l) {
      const itens = l.HasProperties || l.Quantities;
      if (itens) {
        const o = {}; let n = 0;
        itens.forEach(r => { const p = lerProp(r.value); if (p) { o[p[0]] = p[1]; n++; } });
        if (n) s = [limpo(l.Name) || 'Propriedades', o];
      }
    }
    sets[id] = s;
    return s;
  };
  idsDe(WebIFC.IFCRELDEFINESBYPROPERTIES).forEach(rid => {
    const r = linha(rid); if (!r || !r.RelatingPropertyDefinition) return;
    const sid = r.RelatingPropertyDefinition.value;
    let lido = false, tem = false;
    (r.RelatedObjects || []).forEach(o => {
      const i = elDe.get(o.value); if (i === undefined) return;
      if (!lido) { tem = !!lerSet(sid); lido = true; }
      if (tem) elSets[i].push(sid);
    });
  });
  Object.keys(sets).forEach(k => { if (!sets[k]) delete sets[k]; });

  // ---------------------------------------------------------------- tabela de elementos
  const S = [''], sDe = new Map([['', 0]]);
  const s = t => { t = t || ''; let i = sDe.get(t); if (i === undefined) { i = S.length; S.push(t); sDe.set(t, i); } return i; };
  const prop = (i, re) => { for (const sid of elSets[i]) { const o = sets[sid][1]; for (const k in o) if (re.test(k)) return String(o[k]); } return ''; };
  const n = elIds.length;
  const guid = new Array(n), cls = new Array(n), nome = new Array(n), marca = new Array(n), fase = new Array(n), pav = new Array(n), xid = new Array(n);
  for (let i = 0; i < n; i++) {
    const l = lerEl(elIds[i]) || {};
    xid[i] = elIds[i];
    guid[i] = limpo(l.GlobalId);
    cls[i] = s(l.type ? nomeTipo(l.type) : '');
    nome[i] = s(limpo(l.Name));
    marca[i] = s(prop(i, /^ASSEMBLY MARK$|^Assembly\/Cast unit Mark$/i) || limpo(l.Tag));
    fase[i] = s(prop(i, /^PHASE\.NAME$/i));
    pav[i] = s(pavDe.get(elIds[i]) || '');
  }
  const raiz = i => { let g = 0; while (pai[i] >= 0 && g++ < 20) i = pai[i]; return i; };
  let unidades = 0; const vistas = new Set();
  for (let i = 0; i < nGeoEls; i++) {   // peça herda fase e pavimento do conjunto
    const r = raiz(i);
    if (!vistas.has(r)) { vistas.add(r); unidades++; }
    if (r !== i) { if (!fase[i]) fase[i] = fase[r]; if (!pav[i]) pav[i] = pav[r]; } else if (!pav[i]) pav[i] = 0;
  }
  let coord = null;
  try { coord = Array.from(api.GetCoordinationMatrix(m)); } catch (e) { coord = null; }
  api.CloseModel(m);

  // ---------------------------------------------------------------- empacota
  const cab = { v: VERSAO, coord, n_inst: nInst, n_geo: gVert.n, n_el: n, n_el_geo: nGeoEls, n_unid: unidades, tris: Math.round(tris),
    s: S, els: { xid, guid, cls, nome, marca, fase, pav, pai }, secs: [] };
  const partes = [['pos', pos.fim()], ['nor', nor.fim()], ['idx', idx.fim()], ['gvert', gVert.fim()], ['gidx', gIdx.fim()],
    ['igeo', iGeo.fim()], ['iel', iEl.fim()], ['imat', iMat.fim()], ['icor', iCor.fim()]];
  let total = 0;
  partes.forEach(([nm, a]) => { const b = a.byteLength, pad = (4 - b % 4) % 4; cab.secs.push({ n: nm, t: a.constructor.name, len: a.length, bytes: b }); total += b + pad; });
  const cabBytes = new TextEncoder().encode(JSON.stringify(cab)), cabPad = (4 - cabBytes.length % 4) % 4;
  const out = new Uint8Array(8 + cabBytes.length + cabPad + total), dv = new DataView(out.buffer);
  dv.setUint32(0, 0x3144334d, true);   // "M3D1"
  dv.setUint32(4, cabBytes.length, true);
  out.set(cabBytes, 8);
  let o = 8 + cabBytes.length + cabPad;
  partes.forEach(([, a]) => { out.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), o); o += a.byteLength + (4 - a.byteLength % 4) % 4; });
  const props = new TextEncoder().encode(JSON.stringify({ v: VERSAO, sets, el: elSets }));
  return { geo: out.buffer, props: props.buffer, elementos: nGeoEls, unidades };
}

self.onmessage = async ev => {
  const prog = t => self.postMessage({ t: 'prog', txt: t });
  try {
    prog('Preparando o leitor de IFC…');
    const api = new WebIFC.IfcAPI();
    const base = new URL('./vendor/m3d/', import.meta.url).href;
    await api.Init(arq => base + arq, true);
    try { api.SetLogLevel(WebIFC.LogLevel.LOG_LEVEL_OFF); } catch (e) { /* versões sem o controle de log */ }
    prog('Abrindo o IFC…');
    const r = converter(api, new Uint8Array(ev.data.ifc), prog);
    self.postMessage({ t: 'ok', geo: r.geo, props: r.props, elementos: r.elementos, unidades: r.unidades }, [r.geo, r.props]);
  } catch (e) {
    self.postMessage({ t: 'erro', txt: (e && e.message) || String(e) });
  }
};
