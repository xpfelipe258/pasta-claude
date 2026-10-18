'use strict';
// ------------------------------------------------------------------------------------------------
// BIBLIOTECA DE TEMPLATE DE DOCUMENTOS — obra (gestão) × Rótula (cliente)
//   tplDocumento({ titulo, subtitulo, meta, corpo, css })  → HTML completo (capa com cortes e sombreamento, seções, tabelas, cartões, rodapé)
//   tplProtegerImpressao(html)                              → tira a URL/data/título que o navegador imprime nas margens (qualquer relatório HTML)
//   tplLogosCarregar()                                      → lê assets/logo_rotula.png (se existir) para dentro do documento
// Sem os PNG em maciel/assets/ a capa usa uma versão vetorial das marcas. Usado por rel_empresa.js, rel_lanc.js, planos_doc.js e baixarHtml (app.js).
// ------------------------------------------------------------------------------------------------

const TPL_COR = { vermelho: '#d2301f', vermelhoEsc: '#7a1409', azul: '#0b4f9c', azulEsc: '#0a2c57', preto: '#111827' };
const TPL_LOGOS = { rotula: null, qpc: null };   // data URI do arquivo em assets/ ('' = não existe → usa o desenho vetorial)

async function tplLogosCarregar() {
  for (const [k, arq] of [['rotula', 'assets/logo_rotula.png'], ['qpc', 'assets/logo_qpc.png']]) {
    if (TPL_LOGOS[k] !== null) continue;
    try {
      const r = await fetch(arq, { cache: 'no-store' });
      if (!r.ok || !(r.headers.get('content-type') || '').startsWith('image')) throw new Error('sem logo');
      const b = await r.blob();
      TPL_LOGOS[k] = await new Promise((res, rej) => { const f = new FileReader(); f.onload = () => res(f.result); f.onerror = rej; f.readAsDataURL(b); });
    } catch { TPL_LOGOS[k] = ''; }
  }
}

// Marcas em vetor (usadas enquanto não houver o PNG oficial em assets/)
const TPL_SVG_ROTULA = `<svg viewBox="0 0 250 64" height="42" role="img" aria-label="Rótula"><g transform="translate(32 32) rotate(45) translate(-32 -32)" fill="${TPL_COR.vermelho}">
  <path id="tplb" d="M7 28 V19 Q7 7 19 7 H33 V17 H21 Q17 17 17 21 V28 Z"/><use href="#tplb" transform="rotate(90 32 32)"/><use href="#tplb" transform="rotate(180 32 32)"/><use href="#tplb" transform="rotate(270 32 32)"/></g>
  <text x="70" y="45" font-family="Arial,Helvetica,sans-serif" font-weight="800" font-size="34" letter-spacing="1.5" fill="${TPL_COR.azul}">RÓTULA</text></svg>`;
const TPL_SVG_QPC = `<svg viewBox="0 0 190 64" height="42" role="img" aria-label="QPC Engenharia"><text x="95" y="38" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-weight="800" font-size="40" letter-spacing="3" fill="none" stroke="${TPL_COR.preto}" stroke-width="2.6" stroke-linejoin="round">QPC</text>
  <text x="95" y="56" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-weight="700" font-size="11" letter-spacing="4" fill="${TPL_COR.preto}">ENGENHARIA</text></svg>`;
const tplLogo = k => TPL_LOGOS[k] ? `<img src="${TPL_LOGOS[k]}" alt="${k === 'rotula' ? 'Rótula' : 'QPC Engenharia'}" style="height:44px;display:block">` : (k === 'rotula' ? TPL_SVG_ROTULA : TPL_SVG_QPC);

const TPL_CSS = `<style>
:root{--tv:${TPL_COR.vermelho};--tve:${TPL_COR.vermelhoEsc};--ta:${TPL_COR.azul};--tae:${TPL_COR.azulEsc}}
@page{margin:0}
*{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{font-family:'Segoe UI',Arial,Helvetica,sans-serif;color:#14202b;background:#eef1f6;margin:0;padding:0;max-width:none;font-size:12.5px}
.tpl-folha{width:100%;border-collapse:collapse}
.tpl-folha > thead > tr > td,.tpl-folha > tbody > tr > td,.tpl-folha > tfoot > tr > td{border:0!important;padding:0!important;background:none!important}
.tpl-pagina{max-width:1100px;margin:0 auto;background:#fff;box-shadow:0 10px 40px rgba(10,44,87,.18)}
/* capa: faixa com corte diagonal, segunda faixa clara deslocada e sombra */
.tpl-capa{position:relative;filter:drop-shadow(0 8px 10px rgba(10,44,87,.30));margin-bottom:22px}
.tpl-capa-fundo{position:relative;color:#fff;padding:22px 34px 78px;clip-path:polygon(0 0,100% 0,100% 70%,62% 100%,0 100%);
  background:linear-gradient(115deg,var(--tve) 0%,var(--tv) 36%,#7b2d6e 62%,var(--ta) 100%)}
.tpl-capa-fundo:before{content:"";position:absolute;inset:0;clip-path:polygon(58% 0,100% 0,100% 70%,70% 92%);background:linear-gradient(120deg,rgba(255,255,255,.14),rgba(255,255,255,0))}
.tpl-capa-fundo:after{content:"";position:absolute;left:0;bottom:0;width:62%;height:10px;background:linear-gradient(90deg,rgba(255,255,255,.55),rgba(255,255,255,0));clip-path:polygon(0 0,100% 0,96% 100%,0 100%)}
.tpl-marcas{position:relative;display:flex;justify-content:space-between;align-items:flex-start;gap:16px}
.tpl-marca small{display:block;font-size:9.5px;letter-spacing:.18em;text-transform:uppercase;opacity:.9;margin:0 0 5px 2px;font-weight:700}
.tpl-chip-obra{font-weight:800;font-size:17px;letter-spacing:.06em;color:var(--tae);min-height:30px}
.tpl-chip{background:#fff;border-radius:6px 16px 6px 16px;padding:7px 15px;box-shadow:0 4px 12px rgba(0,0,0,.28);display:inline-flex;align-items:center}
.tpl-titulos{position:relative;margin-top:22px;max-width:76%}
.tpl-titulos h1{color:#fff;font-size:28px;line-height:1.12;margin:0 0 5px;font-weight:800;letter-spacing:.01em;text-shadow:0 2px 8px rgba(0,0,0,.28)}
.tpl-titulos p{margin:0;font-size:13px;opacity:.95}
.tpl-meta{position:relative;margin-top:11px;font-size:10.5px;opacity:.88}
.tpl-corpo{padding:0 12mm 6mm}
.tpl-ficha{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:8px 18px;margin:0 12mm 6px;padding:10px 16px;background:linear-gradient(145deg,#fff,#f1f5fb);border-radius:4px 14px 4px 14px;border-left:6px solid var(--tv);box-shadow:0 3px 12px rgba(10,44,87,.14);break-inside:avoid}
.tpl-ficha small{display:block;font-size:8.5px;letter-spacing:.08em;text-transform:uppercase;color:#51606f;font-weight:700}
.tpl-ficha b{display:block;font-size:11.5px;color:var(--tae);font-weight:700}
/* conteúdo dos relatórios (mesmos nomes de classe do relatório das empresas) */
.tpl-corpo .pag{max-width:none;padding:0 0 8px}
h1{font-size:23px;margin:0 0 4px;color:var(--tae)}
.tpl-corpo h2{font-size:14px;margin:26px 0 9px;padding:7px 28px 7px 14px;color:#fff;text-transform:uppercase;letter-spacing:.04em;border-radius:0;
  background:linear-gradient(100deg,var(--tae),var(--ta) 70%,#2d6fb8);clip-path:polygon(0 0,calc(100% - 18px) 0,100% 100%,0 100%);display:block;width:100%}
.tpl-corpo h3{font-size:13px;margin:16px 0 6px;color:var(--ta);border-left:4px solid var(--tv);padding-left:8px}
.sub-cab{color:#51606f;margin:0 0 14px}
table{width:100%;border-collapse:separate;border-spacing:0;margin:6px 0 12px;font-size:11.5px;box-shadow:0 2px 8px rgba(10,44,87,.10);border-radius:6px}
thead th:first-child{border-top-left-radius:6px}thead th:last-child{border-top-right-radius:6px}
th,td{border-bottom:1px solid #e1e7ef;padding:5px 8px;text-align:left;vertical-align:top;border-left:0;border-right:0;border-top:0}
th{background:linear-gradient(180deg,#e9eff8,#dbe5f3);color:var(--tae);font-weight:700;border-bottom:2px solid var(--ta)}
tbody tr:nth-child(even) td{background:#f7f9fc}
tr.grupo td{background:linear-gradient(90deg,#e6eef9,#f4f7fb)!important;border-bottom:1px solid #c9d6e8}
td.n,th.n{text-align:right;white-space:nowrap}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px;margin:10px 0 14px}
.card{position:relative;border:0;border-radius:4px 14px 4px 14px;padding:10px 14px;background:linear-gradient(145deg,#fff,#f1f5fb);box-shadow:0 4px 14px rgba(10,44,87,.16);border-left:6px solid #94a3b8}
.card:after{content:"";position:absolute;right:0;top:0;width:34px;height:34px;background:linear-gradient(225deg,rgba(11,79,156,.16),rgba(255,255,255,0) 60%);border-radius:0 14px 0 0}
.card .rot{font-size:10px;text-transform:uppercase;color:#51606f;letter-spacing:.05em;font-weight:700}
.card .val{font-size:21px;font-weight:800;margin:3px 0;color:var(--tae)}
.card .sub{font-size:10.5px;color:#51606f}
.card.vd{border-left-color:#16a34a}.card.am{border-left-color:#eab308}.card.vm{border-left-color:var(--tv)}.card.az{border-left-color:var(--ta)}.card.nd{border-left-color:#94a3b8}
.aviso{background:#fff4e5;border:0;border-left:5px solid #f5a524;padding:7px 12px;border-radius:2px 10px 2px 10px;box-shadow:0 2px 8px rgba(245,165,36,.2)}
.mapa-fig{border:0;border-radius:6px;padding:8px;background:#fff;box-shadow:0 3px 12px rgba(10,44,87,.14);margin:8px 0;break-inside:avoid}
.topo-acoes{position:sticky;top:0;z-index:5;background:rgba(255,255,255,.96);padding:8px 28px;border-bottom:1px solid #d3dbe4;box-shadow:0 3px 10px rgba(10,44,87,.12)}
.topo-acoes button{padding:7px 16px;border:0;background:linear-gradient(100deg,var(--tv),var(--ta));color:#fff;border-radius:4px 12px 4px 12px;cursor:pointer;font-weight:700}
.tpl-rodape{display:none}
@media screen{.tpl-esp-topo,.tpl-esp-base{display:none}}
@media print{
  body{background:#fff}.tpl-pagina{box-shadow:none;max-width:none}
  .topo-acoes{display:none}
  .tpl-esp-topo{height:12mm}.tpl-esp-base{height:16mm}
  .tpl-capa{margin-top:-12mm}
  .tpl-rodape{display:flex;position:fixed;left:0;right:0;bottom:0;height:11mm;align-items:center;justify-content:space-between;padding:0 12mm;font-size:9px;color:#fff;
    background:linear-gradient(100deg,var(--tae),var(--ta) 60%,var(--tv));clip-path:polygon(0 38%,38% 38%,41% 0,100% 0,100% 100%,0 100%)}
  .tpl-rodape span:first-child{padding-left:2mm;font-weight:700;letter-spacing:.06em}
  td.n,th.n{white-space:normal}table{table-layout:auto;font-size:10.5px}
  .tpl-corpo h2{break-after:avoid}table{break-inside:auto}tr{break-inside:avoid}.card,.mapa-fig{break-inside:avoid}
}
</style>`;

// Ficha da obra (cadastro do portal: responsável, cliente, local, contrato, prazo…) logo abaixo da capa; só mostra o que foi preenchido.
function tplFichaObra() {
  const o = (typeof D !== 'undefined' && D && D.obra) || null;
  if (!o) return '';
  const brl = v => (v == null || v === '' ? '' : 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const dt = s => (/^\d{4}-\d{2}-\d{2}$/.test(s || '') ? s.split('-').reverse().join('/') : '');
  const prazo = [dt(o.data_inicio), dt(o.data_fim)].filter(Boolean).join(' a ') + (o.duracao_meses ? ` (${Number(o.duracao_meses).toLocaleString('pt-BR')} meses)` : '');
  const campos = [['Obra', [o.nome, o.codigo].filter(Boolean).join(' · ')], ['Responsável da obra', o.responsavel], ['Encarregado', o.encarregado],
    ['Cliente', o.cliente], ['Responsável do cliente', o.responsavel_cliente], ['Local', [o.cidade, o.endereco].filter(Boolean).join(' — ')],
    ['Valor de contrato', brl(o.valor_contrato)], ['Nº do contrato', o.contrato_numero], ['Prazo', prazo], ['Área', o.area_m2 ? Number(o.area_m2).toLocaleString('pt-BR') + ' m²' : ''], ['ART / CREA', o.art]]
    .filter(([, v]) => v && String(v).trim());
  if (campos.length < 2) return '';
  return `<section class="tpl-ficha">${campos.map(([k, v]) => `<div><small>${esc(k)}</small><b>${esc(String(v))}</b></div>`).join('')}</section>`;
}

// Documento completo no padrão Rótula × QPC.  corpo = HTML das seções; css = estilos extras do relatório; meta = linha pequena da capa.
function tplDocumento({ titulo, subtitulo = '', meta = '', corpo = '', css = '', cssAntes = '', barra = '' }) {
  const quando = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const obraNome = ((typeof D !== 'undefined' && D && D.obra && D.obra.nome) || 'OBRA').toString().trim().toUpperCase();   // gestão = a própria obra (cadastro do portal); cliente = Rótula
  const base = typeof RE_CSS === 'string' ? RE_CSS : '';   // classes de conteúdo já usadas pelo relatório das empresas
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(titulo)}</title>${base}${cssAntes}${TPL_CSS}${css}</head><body>
    ${barra || '<div class="topo-acoes"><button onclick="window.print()">Imprimir / salvar em PDF</button> <span class="nota">Gerado em ' + esc(quando) + ' (horário de Brasília)</span></div>'}
    <div class="tpl-pagina">
      <header class="tpl-capa"><div class="tpl-capa-fundo">
        <div class="tpl-marcas">
          <div class="tpl-marca"><small>Gestão</small><span class="tpl-chip tpl-chip-obra">${esc(obraNome)}</span></div>
          <div class="tpl-marca" style="text-align:right"><small>Cliente</small><span class="tpl-chip">${tplLogo('rotula')}</span></div>
        </div>
        <div class="tpl-titulos"><h1>${esc(titulo)}</h1>${subtitulo ? `<p>${esc(subtitulo)}</p>` : ''}</div>
        ${meta ? `<div class="tpl-meta">${esc(meta)}</div>` : ''}
      </div></header>
      ${tplFichaObra()}
      <div class="tpl-corpo">${corpo}</div>
    </div>
    <div class="tpl-rodape"><span>${esc(obraNome)} · GESTÃO</span><span>${esc(titulo)} · RÓTULA · ${esc(quando)}</span></div>
  </body></html>`;
  return tplProtegerImpressao(html);
}

// Tira do papel/PDF a URL, a data e o título que o navegador imprime nas margens (cabeçalho/rodapé do navegador): com @page{margin:0} eles
// somem; a margem de cada página passa a vir de uma tabela com cabeçalho/rodapé repetidos (espaçadores). Vale para qualquer relatório HTML.
function tplProtegerImpressao(html) {
  if (typeof html !== 'string' || html.includes('data-tpl-protegido')) return html;
  const estilo = `<style data-tpl-protegido>@page{margin:0}table.tpl-folha{width:100%!important;margin:0!important;border-collapse:collapse!important;box-shadow:none!important;border-radius:0!important;overflow:visible!important}table.tpl-folha > thead > tr > td,table.tpl-folha > tbody > tr > td,table.tpl-folha > tfoot > tr > td{border:0!important;padding:0!important;margin:0!important;box-shadow:none!important;background:none!important}.tpl-esp-topo{height:12mm}.tpl-esp-base{height:16mm}@media screen{.tpl-esp-topo,.tpl-esp-base{display:none}}</style>`;
  let r = html.includes('</head>') ? html.replace('</head>', estilo + '</head>') : estilo + html;
  r = r.replace(/<body([^>]*)>([\s\S]*)<\/body>/i, (m, attrs, corpo) => {
    if (corpo.includes('class="tpl-folha"')) return m;
    return `<body${attrs}><table class="tpl-folha"><thead><tr><td><div class="tpl-esp-topo"></div></td></tr></thead><tbody><tr><td>${corpo}</td></tr></tbody><tfoot><tr><td><div class="tpl-esp-base"></div></td></tr></tfoot></table></body>`;
  });
  return r;
}

// Coloca no template qualquer relatório HTML já pronto (consumo, equipamentos, impactos, efetivo, planejamento…): o título (h1) e a linha de
// subtítulo (.sub) viram a capa; o resto do corpo e os estilos próprios do relatório são mantidos dentro do padrão Rótula × QPC.
function tplAdaptarRelatorio(html, tituloPadrao = 'Relatório') {
  if (typeof html !== 'string' || html.includes('class="tpl-capa"')) return html;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  if (!doc.body || !doc.body.children.length) return html;
  const txt = el => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
  const h1 = doc.querySelector('h1'), sub = doc.querySelector('p.sub, .sub');
  const titulo = txt(h1) || tituloPadrao, subtitulo = txt(sub);
  doc.querySelectorAll('.no-print, .topo-acoes, script').forEach(e => e.remove());   // a barra Imprimir/PDF do template substitui a do relatório
  if (h1) h1.remove();
  if (sub) sub.remove();
  const estilos = [...doc.querySelectorAll('style')].map(s => s.textContent), tam = (estilos.join(' ').match(/@page\s*\{[^}]*?size\s*:\s*([^;}]+)/) || [])[1];   // mantém o formato do papel do relatório (ex.: A4 paisagem)
  const cssAntes = estilos.map(t => `<style>${t.replace(/@page\s*\{[^}]*\}/g, '')}</style>`).join('') + (tam ? `<style>@page{size:${tam.trim()}}</style>` : '');
  return tplDocumento({ titulo, subtitulo, corpo: doc.body.innerHTML, cssAntes });
}
tplLogosCarregar();   // já deixa as marcas oficiais (assets/) prontas quando o primeiro relatório for aberto
