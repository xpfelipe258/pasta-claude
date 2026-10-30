'use strict';
// ------------------------------------------------------------------------------------------------
// PDF DOS RELATÓRIOS — todo relatório baixado sai em PDF (A4), idêntico ao da visualização.
//   relPdfGerar(html, nomeArq, titulo, aoProgredir)  → monta o documento fora da tela, tira "fotos" de cada página (html2canvas),
//                                                       escolhe os cortes entre linhas/cartões/títulos (nada fica cortado ao meio) e grava o PDF (jsPDF).
//   relPdfImagem(pngDataUri, nomeArq, titulo)         → PDF de uma imagem (mapa de montagem).
// As duas bibliotecas ficam em vendor/ (html2canvas 1.4.1 e jsPDF 2.5.1): funcionam sem depender de site externo.
// O texto do PDF é imagem (não selecionável); para texto selecionável use "Imprimir" e salve em PDF.
// ------------------------------------------------------------------------------------------------

const PDFREL = { libs: null, escala: 1.25 };

function relPdfLibs() {
  if (window.html2canvas && window.jspdf) return Promise.resolve();
  if (PDFREL.libs) return PDFREL.libs;
  const carregar = src => new Promise((ok, erro) => {
    const s = document.createElement('script');
    s.src = src; s.onload = ok; s.onerror = () => erro(new Error('não foi possível carregar ' + src.split('?')[0]));
    document.head.appendChild(s);
  });
  PDFREL.libs = (async () => {
    if (!window.html2canvas) await carregar('vendor/html2canvas.min.js?v=1.4.1');
    if (!window.jspdf) await carregar('vendor/jspdf.umd.min.js?v=2.5.1');
  })();
  PDFREL.libs.catch(() => { PDFREL.libs = null; });
  return PDFREL.libs;
}

const relPdfNome = nome => String(nome || 'relatorio').replace(/\.(html?|png)$/i, '') + '.pdf';
const relPdfTxt = s => String(s == null ? '' : s).replace(/[^ -~ -ÿ–—•]/g, ' ');   // só caracteres que as fontes do PDF desenham

// Rodapé de cada página (barra azul com a obra à esquerda e o título/data/página à direita)
function relPdfRodape(pdf, pw, ph, titulo, pag, total, gestao) {
  const obra = ((typeof D !== 'undefined' && D && D.obra && D.obra.nome) || 'OBRA').toString().toUpperCase();
  const quando = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  pdf.setFillColor(10, 44, 87); pdf.rect(0, ph - 8, pw, 8, 'F');
  pdf.setFillColor(200, 30, 40); pdf.rect(0, ph - 8, pw * 0.32, 8, 'F');
  pdf.setTextColor(255, 255, 255); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(7.5);
  pdf.text(relPdfTxt(gestao || (obra + ' · GESTÃO')), 6, ph - 3);
  pdf.setFont('helvetica', 'normal');
  pdf.text(relPdfTxt(`${titulo} · RÓTULA · ${quando} · pág. ${pag}/${total}`), pw - 6, ph - 3, { align: 'right' });
}

// Posições de corte das páginas. Empurra o corte para cima até não atravessar nenhuma região protegida; se isso deixar a página quase vazia
// (< 35% cheia), tenta de novo só com as regiões "duras" (linhas, cartões, figuras) e, por último, corta onde der. `titulos` = títulos + o que vem depois deles.
function relPdfCortes(H, altPag, duras, titulos) {
  const empurra = (y, regioes) => {
    let corte = y + altPag;
    for (let g = 0, mexeu = true; mexeu && g < 120; g++) {
      mexeu = false;
      for (const [t, b] of regioes) if (t > y + 20 && t < corte && b > corte) { corte = t; mexeu = true; }
    }
    return corte;
  };
  const cortes = [0];
  let y = 0;
  while (y < H - 2) {
    let corte = y + altPag;
    if (corte >= H - 2) corte = H;
    else {
      corte = empurra(y, duras.concat(titulos));
      if (corte < y + altPag * 0.35) corte = empurra(y, duras);
      if (corte < y + altPag * 0.35) corte = y + altPag;   // bloco enorme: corta onde der
    }
    cortes.push(Math.floor(corte)); y = corte;
  }
  return cortes;
}

async function relPdfGerar(html, nomeArq, titulo, aoProgredir) {
  await relPdfLibs();
  if (typeof htmlDatasBR === 'function') html = htmlDatasBR(html);   // datas sempre em dd/mm/aaaa
  const progresso = typeof aoProgredir === 'function' ? aoProgredir : () => {};
  const paisagem = /@page\s*\{[^}]*size\s*:[^;}]*landscape/i.test(html);
  const gestaoTxt = ((html.match(/<meta name="tpl-gestao" content="([^"]*)"/) || [])[1] || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"') || '';   // "OBRA · EMPRESA" do rodapé (identidade visual da empresa)
  const LARG = paisagem ? 1400 : 1040;                       // largura (px) em que o relatório é desenhado
  const [pw, ph] = paisagem ? [297, 210] : [210, 297];      // página em mm
  const mx = 8, topo = 8, base = 12;                         // margens (mm)
  const mmPx = (pw - 2 * mx) / LARG;                         // mm por pixel de relatório
  const altPag = Math.floor((ph - topo - base) / mmPx);      // altura útil de uma página, em px de relatório

  const ifr = document.createElement('iframe');
  ifr.setAttribute('aria-hidden', 'true');
  ifr.style.cssText = `position:fixed;left:-20000px;top:0;width:${LARG}px;height:1200px;border:0;visibility:hidden`;
  document.body.appendChild(ifr);
  try {
    await new Promise(ok => { ifr.onload = ok; ifr.srcdoc = html; });
    const doc = ifr.contentDocument, win = ifr.contentWindow;
    const st = doc.createElement('style');
    st.textContent = '.topo-acoes,.tpl-rodape,.no-print,.tab-ferr,.tpl-esp-topo,.tpl-esp-base{display:none!important}html,body{background:#fff!important;margin:0!important}.tpl-pagina{box-shadow:none!important;max-width:none!important}.tpl-capa{margin-top:0!important}td.n,th.n{white-space:normal!important}table{table-layout:auto}.tabela-rolagem{overflow:visible!important}';   // mesmas regras da impressão: tabelas largas quebram o texto em vez de passar da página
    doc.head.appendChild(st);
    try { await doc.fonts.ready; } catch (e) { /* sem API de fontes */ }
    await Promise.all([...doc.images].map(i => (i.decode ? i.decode().catch(() => {}) : Promise.resolve())));
    await new Promise(r => setTimeout(r, 300));
    const raiz = doc.documentElement;
    // marcas (logos) dentro dos "chips" da capa: o html2canvas não as desenha, então saem da captura e são pintadas depois por cima
    const marcas = [];
    doc.querySelectorAll('svg').forEach(sv => {   // svg só com height/viewBox some no html2canvas: fixa largura e altura em pixels
      const r = sv.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) { sv.setAttribute('width', r.width); sv.setAttribute('height', r.height); }
    });
    for (const el of doc.querySelectorAll('.tpl-chip svg, .tpl-chip img')) {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      try {
        let fonte = el;
        if (el.tagName.toLowerCase() === 'svg') {
          const c = el.cloneNode(true);
          c.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); c.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
          fonte = new Image();
          await new Promise((ok, erro) => { fonte.onload = ok; fonte.onerror = erro; fonte.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(c)); });
        } else if (el.decode) await el.decode().catch(() => {});
        marcas.push({ fonte, x: r.left, y: r.top, w: r.width, h: r.height });
        el.style.visibility = 'hidden';
      } catch (e) { console.warn('marca da capa', e); }
    }
    await Promise.all([...doc.images].map(i => (i.decode ? i.decode().catch(() => {}) : Promise.resolve())));
    ifr.style.height = '400px';
    await new Promise(r => setTimeout(r, 100));
    const H = Math.ceil(doc.body.getBoundingClientRect().bottom + win.scrollY);   // altura real do conteúdo
    ifr.style.height = H + 'px';
    await new Promise(r => setTimeout(r, 100));

    // regiões que não devem ser cortadas ao meio: linhas de tabela, cartões, figuras e (título + o que vem logo depois dele)
    const duras = [], titulos = [];
    doc.querySelectorAll('tr, .card, .mapa-fig, figure, svg, img, .aviso, .tpl-ficha, .tpl-capa').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.height < 1 || r.height > altPag * 0.9) return;   // sem altura ou maior que uma página: não adianta proteger
      duras.push([r.top, r.bottom]);
    });
    // título de seção: fica junto do que vem depois dele (nota, legenda, primeira linha de tabela ou a figura inteira), nunca sozinho no fim da página
    doc.querySelectorAll('h2, h3').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.height < 1) return;
      let fim = r.bottom, prox = el.nextElementSibling, n = 0;
      while (prox && n < 3 && !/^H[1-3]$/.test(prox.tagName)) {   // até 3 irmãos seguintes (ex.: nota da fase + figura), enquanto couberem numa página
        const q = prox.getBoundingClientRect();
        if (q.bottom - r.top > altPag * 0.9) break;
        const filhoTab = prox.tagName === 'TABLE' ? prox.querySelector('tbody tr') : null;   // tabela: só o título + cabeçalho + 1ª linha
        fim = filhoTab ? filhoTab.getBoundingClientRect().bottom : q.bottom;
        n++;
        if (prox.tagName === 'TABLE' || prox.classList.contains('mapa-fig') || prox.tagName === 'FIGURE') break;
        prox = prox.nextElementSibling;
      }
      titulos.push([r.top, Math.max(fim, r.bottom + 40)]);
    });
    // bloco de uma atividade na matriz do cronograma (cabeçalho + 10 linhas) não se parte entre páginas
    doc.querySelectorAll('tr.cff-ativ').forEach(tr => {
      let fim = tr, n = 0;
      while (n < 10 && fim.nextElementSibling && !fim.nextElementSibling.classList.contains('grupo')) { fim = fim.nextElementSibling; n++; }
      const a = tr.getBoundingClientRect(), b = fim.getBoundingClientRect();
      if (b.bottom - a.top <= altPag * 0.9) duras.push([a.top, b.bottom]);
    });
    const cortes = relPdfCortes(H, altPag, duras, titulos);
    const total = cortes.length - 1;

    // pontas cortadas em diagonal (capa e títulos de seção): o html2canvas não aplica clip-path, então refazemos o corte pintando de branco
    const diagonais = [];
    const marca = (sel, tipo) => doc.querySelectorAll(sel).forEach(el => { const r = el.getBoundingClientRect(); if (r.height > 0) diagonais.push({ tipo, x: r.left, y: r.top, w: r.width, h: r.height }); });
    marca('.tpl-capa-fundo', 'capa'); marca('.tpl-corpo h2', 'secao');

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: paisagem ? 'landscape' : 'portrait', unit: 'mm', format: 'a4', compress: true });
    const esc = PDFREL.escala;
    // O html2canvas lê o documento inteiro a cada chamada (é a parte lenta): fotografa-se em BLOCOS de várias páginas e depois recorta-se cada página.
    // Limite do bloco: ~15 mil px de altura de canvas (limite de navegadores móveis).
    const maxBloco = Math.floor(15000 / esc);
    let i = 0;
    while (i < total) {
      let fim = i + 1;
      while (fim < total && cortes[fim + 1] - cortes[i] <= maxBloco) fim++;
      const yb = cortes[i], hb = cortes[fim] - yb;
      progresso(i + 1, total);
      const bloco = await window.html2canvas(raiz, { scale: esc, backgroundColor: '#ffffff', useCORS: true, logging: false,
        windowWidth: LARG, windowHeight: H, x: 0, y: yb, width: LARG, height: hb, scrollX: 0, scrollY: 0 });
      for (let n = i; n < fim; n++) {
        progresso(n + 1, total);
        const y0 = cortes[n], alt = cortes[n + 1] - y0;
        const pg = document.createElement('canvas');   // cópia da página (o contexto do html2canvas fica com recorte ativo)
        pg.width = Math.round(LARG * esc); pg.height = Math.round(alt * esc);
        const cx = pg.getContext('2d');
        cx.drawImage(bloco, 0, Math.round((y0 - yb) * esc), pg.width, pg.height, 0, 0, pg.width, pg.height);
        marcas.forEach(m => {
          if (m.y + m.h < y0 || m.y > y0 + alt) return;
          try { cx.drawImage(m.fonte, m.x * esc, (m.y - y0) * esc, m.w * esc, m.h * esc); } catch (e) { /* imagem indisponível */ }
        });
        cx.fillStyle = '#ffffff';
        diagonais.forEach(d => {
          if (d.y + d.h < y0 || d.y > y0 + alt) return;
          const x = d.x * esc, yy = (d.y - y0) * esc, w = d.w * esc, h = d.h * esc;
          cx.beginPath();
          if (d.tipo === 'capa') { cx.moveTo(x + w, yy + h * 0.7); cx.lineTo(x + w * 0.62, yy + h); cx.lineTo(x + w, yy + h); }
          else { cx.moveTo(x + w - 18 * esc, yy); cx.lineTo(x + w, yy); cx.lineTo(x + w, yy + h); }
          cx.closePath(); cx.fill();
        });
        if (n > 0) pdf.addPage();
        pdf.addImage(pg.toDataURL('image/jpeg', 0.86), 'JPEG', mx, topo, LARG * mmPx, alt * mmPx, undefined, 'FAST');
        relPdfRodape(pdf, pw, ph, titulo, n + 1, total, gestaoTxt);
        await new Promise(r => setTimeout(r, 0));   // deixa a tela respirar entre as páginas
      }
      bloco.width = 1; bloco.height = 1;   // libera a memória do bloco
      i = fim;
    }
    pdf.save(relPdfNome(nomeArq));
    return total;
  } finally {
    ifr.remove();
  }
}

// PDF de uma imagem (ex.: mapa de montagem), na página A4 em paisagem
async function relPdfImagem(png, nomeArq, titulo) {
  await relPdfLibs();
  const img = new Image();
  await new Promise((ok, erro) => { img.onload = ok; img.onerror = () => erro(new Error('imagem inválida')); img.src = png; });
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
  const pw = 297, ph = 210, mx = 8, topo = 14, base = 12;
  const k = Math.min((pw - 2 * mx) / img.width, (ph - topo - base) / img.height);
  const w = img.width * k, h = img.height * k;
  pdf.setTextColor(10, 44, 87); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(12);
  pdf.text(relPdfTxt(titulo), mx, 9);
  pdf.addImage(png, 'PNG', (pw - w) / 2, topo, w, h, undefined, 'FAST');
  relPdfRodape(pdf, pw, ph, titulo, 1, 1);
  pdf.save(relPdfNome(nomeArq));
}
