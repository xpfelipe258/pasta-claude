// Monta o modelo 3D da OBRA DE DEMONSTRAÇÃO a partir do modelo G200 já convertido pelo sistema (Modelo 3D › cache).
// Uso:  node ferramentas/demo_modelo3d.cjs <cache_geo.bin> <cache_props.bin> <pasta de saída>
//   (os dois arquivos são os que o sistema grava em dados_obras/{obra}/modelo3d depois de converter o IFC; ambos em gzip)
// Saída (pasta maciel/demo/g200): geo.bin e props.bin (anonimizados, gzip) e frentes.bin (gzip de JSON: frentes de montagem com
// datas RELATIVAS ao dia em que a obra de demonstração é criada e os GUIDs das peças de cada frente).
// Anonimização: nomes de propriedade com RÓTULA, marcas com prefixo ROT- e nome de fornecedor nas marcas. Geometria e GUIDs não mudam.
// Rodar de novo sempre que o formato do modelo convertido mudar (M3D_CACHE_VERSAO em maciel/inc/modelo3d.php).
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const [geoArq, propsArq, saida] = process.argv.slice(2);
if (!geoArq || !propsArq || !saida) { console.error('uso: node demo_modelo3d.cjs <geo.bin> <props.bin> <pasta>'); process.exit(1); }

const limpar = t => String(t)
  .replace(/R[ÓO]TULA\s*/gi, '')
  .replace(/\bROT-Dick Steel/gi, 'DS')
  .replace(/\bROT-/g, '')
  .replace(/Dick Steel/gi, 'DS');

// ---------------------------------------------------------------- geometria + tabela de elementos
const geo = zlib.gunzipSync(fs.readFileSync(geoArq));
if (geo.readUInt32LE(0) !== 0x3144334d) throw new Error('não é um modelo convertido (M3D1)');
const nCab = geo.readUInt32LE(4);
const cab = JSON.parse(geo.subarray(8, 8 + nCab).toString('utf8'));
const corpo = geo.subarray(8 + nCab + (4 - nCab % 4) % 4);
cab.s = cab.s.map(limpar);
const ini = Buffer.alloc(8); ini.writeUInt32LE(0x3144334d, 0);

// ---------------------------------------------------------------- propriedades
const props = JSON.parse(zlib.gunzipSync(fs.readFileSync(propsArq)).toString('utf8'));
for (const k of Object.keys(props.sets)) {
  const [nome, o] = props.sets[k];
  const novo = {};
  for (const c of Object.keys(o)) novo[limpar(c)] = typeof o[c] === 'string' ? limpar(o[c]) : o[c];
  props.sets[k] = [limpar(nome).trim() || 'Propriedades', novo];
}

// ---------------------------------------------------------------- frentes de montagem (enredo da demonstração)
const S = cab.s, e = cab.els, n = cab.n_el;
const raiz = i => { let g = 0; while (e.pai[i] >= 0 && g++ < 20) i = e.pai[i]; return i; };
const raizes = new Set();
for (let i = 0; i < cab.n_el_geo; i++) raizes.add(raiz(i));
const eixo = i => { const m = String(S[e.pos[i]] || '').match(/^(\d+)/); return m ? parseInt(m[1], 10) : 0; };
const trecho = i => Math.min(4, Math.max(0, Math.floor((Math.max(1, eixo(i)) - 1) / 4)));   // eixos 01-04, 05-08, 09-12, 13-16, 17-20
const TRECHOS = ['01 a 04', '05 a 08', '09 a 12', '13 a 16', '17 a 20'];
// datas em dias a partir do dia da criação (0 = hoje); concl = dia em que foi concluída (vazio = não concluída)
const PLANO = {
  cob: [[-62, -48, -47], [-50, -36, -35], [-38, -24, -21], [-26, -12, null, 'em_andamento'], [-8, 6, null, 'em_andamento']],
  telhaCob: [[-42, -30, -30], [-30, -18, -17], [-14, 2, null, 'em_andamento'], [3, 17], [15, 29]],
};
const frentes = [];
const nova = (nome, atividade, d) => { const f = { nome, atividade, ini: d[0], fim: d[1], concl: d[2] ?? null, status: d[2] != null ? 'concluido' : (d[3] || 'nao_iniciado'), guids: [] }; frentes.push(f); return f; };
const cob = TRECHOS.map((t, k) => nova(`Cobertura — eixos ${t}`, 'Montagem da cobertura (vigas e joists)', PLANO.cob[k]));
const telCob = TRECHOS.map((t, k) => nova(`Telhas da cobertura — eixos ${t}`, 'Instalação de telhas da cobertura', PLANO.telhaCob[k]));
const fech = nova('Fechamento lateral — estrutura', 'Estrutura do fechamento lateral', [-34, 10, null, 'em_andamento']);
const telFech = nova('Fechamento lateral — telhas', 'Telhas do fechamento lateral', [8, 32]);
const marq = nova('Marquises — estrutura', 'Estrutura das marquises', [-22, -6, -5]);
const marqAc = nova('Marquises — testeiras, rufos e forro', 'Acabamento das marquises', [-4, 12, null, 'em_andamento']);
const calhas = nova('Calhas e rufos da cobertura', 'Calhas e rufos', [18, 36]);
const vida = nova('Linha de vida', 'Linha de vida', [30, 44]);
for (const r of raizes) {
  const fase = S[e.fase[r]] || '', nome = (S[e.nome[r]] || '').toUpperCase(), g = e.guid[r];
  if (!g) continue;
  let f = null;
  if (/^1\.1\.1|^Phase 252$|DESLIZAMENTO/i.test(fase)) f = cob[trecho(r)];
  else if (/^Geral$/i.test(fase)) f = /TELHA/.test(nome) ? (/FECHAMENTO/.test(nome) ? telFech : telCob[trecho(r)]) : (/FECHAMENTO/.test(nome) ? fech : telCob[trecho(r)]);
  else if (/^telha$|^RUFO FECHAMENTO$/i.test(fase)) f = telFech;
  else if (/^1\.1\.2/.test(fase)) f = fech;
  else if (/^1\.1\.3|^Phase (316|5)$/i.test(fase)) f = marq;
  else if (/TESTEIRA|RUFOS MARQUISE|FORRO MARQUISE/i.test(fase)) f = marqAc;
  else if (/Calhas|RUFOS COBERTURA/i.test(fase)) f = calhas;
  else if (/Linha de Vida/i.test(fase)) f = vida;
  if (f) { f.guids.push(g); f._r = f._r || []; f._r.push(r); }
}
// peças de cada frente em ordem de montagem (eixo, depois posição) e contagem por TAG de carga (marca; peça sem marca = nome do tipo)
const chave = r => { const m = String(S[e.marca[r]] || '').trim(); return !m || /^nd\d*/i.test(m) ? String(S[e.nome[r]] || 'PEÇA').trim().toUpperCase() : m.toUpperCase(); };
for (const f of frentes) {
  const rs = (f._r || []).slice().sort((a, b) => eixo(a) - eixo(b) || String(S[e.pos[a]]).localeCompare(String(S[e.pos[b]])));
  f.guids = rs.map(r => e.guid[r]);
  f.chaves = {}; f.nomes = {}; f.pesos = {};
  rs.forEach(r => { const k = chave(r); f.chaves[k] = (f.chaves[k] || 0) + 1; f.nomes[k] = String(S[e.nome[r]] || k); f.pesos[k] = e.peso[r] || 0; });
  delete f._r;
}

// nomes de etapa que o modelo deixou genéricos ("Geral", "Phase 252"…) ganham nome de canteiro, só na demonstração
const ETAPA_NOVA = { 'Geral': 'Telhas (cobertura e fechamento)', 'telha': 'Telhas (cobertura e fechamento)', 'Phase 252': 'Fixadores da cobertura', 'Phase 316': 'Fixadores das marquises', 'Phase 5': 'Fixadores das marquises' };
const idxDe = t => { let k = cab.s.indexOf(t); if (k < 0) { k = cab.s.length; cab.s.push(t); } return k; };
for (let i = 0; i < n; i++) { const novo = ETAPA_NOVA[S[e.fase[i]]]; if (novo) e.fase[i] = idxDe(novo); }
const cab2 = Buffer.from(JSON.stringify(cab), 'utf8'), pad2 = (4 - cab2.length % 4) % 4;
ini.writeUInt32LE(cab2.length, 4);
const geoFinal = Buffer.concat([ini, cab2, Buffer.alloc(pad2), corpo]);

fs.mkdirSync(saida, { recursive: true });
fs.writeFileSync(path.join(saida, 'geo.bin'), zlib.gzipSync(geoFinal, { level: 9 }));
fs.writeFileSync(path.join(saida, 'props.bin'), zlib.gzipSync(Buffer.from(JSON.stringify(props)), { level: 9 }));
fs.writeFileSync(path.join(saida, 'frentes.bin'), zlib.gzipSync(Buffer.from(JSON.stringify({ v: cab.v, elementos: cab.n_el_geo, unidades: cab.n_unid, frentes })), { level: 9 }));
console.log('frentes:', frentes.map(f => `${f.nome}: ${f.guids.length}`).join(' | '));
console.log('pecas sem frente:', raizes.size - frentes.reduce((a, f) => a + f.guids.length, 0));
for (const a of ['geo.bin', 'props.bin', 'frentes.bin']) console.log(a, fs.statSync(path.join(saida, a)).size, 'bytes');
