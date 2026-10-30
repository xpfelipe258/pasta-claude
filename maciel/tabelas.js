'use strict';
// ------------------------------------------------------------------------------------------------
// FILTRAR E ORDENAR TABELAS (todas as abas)
// Acrescenta, sem mexer em cada tela, uma barra "Filtrar linhas / Coluna / Ordem" acima de cada tabela das abas: escolhida a COLUNA, o filtro
// passa a valer nela e a lista de ORDEM oferece crescente/decrescente (A→Z, menor→maior, data mais antiga…). Os cabeçalhos também são
// clicáveis (1º clique crescente, 2º decrescente, 3º ordem original) e acompanham o que está escolhido na barra.
// O tipo da coluna é reconhecido pelo conteúdo: data (dd/mm/aaaa, dd/mm, aaaa-mm-dd), número (pt-BR: 1.234,5 · R$ · % · unidades) ou texto.
// As telas redesenham as tabelas o tempo todo: um MutationObserver reaplica filtro e ordem depois de cada redesenho (estado por tabela).
// Ficam de fora: tabelas dentro de janelas (modais), grades de lançamento/semana/pessoal e tabelas com células mescladas (rowspan).
// Linhas de grupo (class "grupo" ou uma célula só com colspan) não se misturam: a ordem vale dentro de cada grupo.
// PÁGINAS DE 50 LINHAS (pedido do usuário, 2026-10-28: "coloque páginas, ao invés de mostrar mais"): nenhuma lista mostra mais de 50 linhas de uma vez;
// abaixo da tabela ficam "‹ Anterior · 1 2 3 … N · Próxima ›" e "linhas a–b de N". A página volta à 1ª a cada filtro, ordem ou clique no
// cabeçalho e é refeita sozinha a cada redesenho. Vale também para as tabelas marcadas data-sem-ferramentas (sem a barra de filtro). Ficam sempre
// completas as grades de lançamento/semana/pessoal, tabelas com células mescladas, as da aba Remessas (regra da remessa: lista inteira) e as que
// levam o atributo data-sem-limite.
// ------------------------------------------------------------------------------------------------
(function () {
  const SECOES = 'main section[id^="aba-"]';
  const EXCLUI = '.tab-semana, .dp-matriz, #tabLanc, #tabSemana, #tabDP, [data-sem-ferramentas]';
  const LIMITE = 50;                              // linhas por página
  const GRADES = '.tab-semana, .dp-matriz, #tabLanc, #tabSemana, #tabDP, [data-sem-limite], #aba-estrem table';
  const estado = new Map();                       // chave da tabela → { col, dir, filtro, pag }
  const colator = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' });
  const norm = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const limpo = s => String(s == null ? '' : s).replace(/[✎✓✗▲▼↑↓]/g, '').replace(/\s+/g, ' ').trim();

  // ---------------------------------------------------------------- estrutura da tabela
  const linhasDeDados = t => [...t.tBodies].flatMap(b => [...b.rows]);
  const ehSeparador = tr => tr.classList.contains('grupo') || (tr.cells.length === 1 && tr.cells[0].colSpan > 1) || !!tr.querySelector('td.vazio');
  const colDoTh = th => { let c = 0; for (let x = th.previousElementSibling; x; x = x.previousElementSibling) c += x.colSpan || 1; return c; };
  function elegivel(t) {
    if (!t.isConnected || t.matches(EXCLUI) || t.closest('.modal-admin, dialog, .modal-fundo, [id^="ganDatasPopup"]')) return false;
    if (t.querySelector('tbody [rowspan]')) { const r = [...t.querySelectorAll('tbody [rowspan]')].some(c => c.rowSpan > 1); if (r) return false; }
    return true;
  }
  // pode receber o limite de linhas? (as grades de digitação e as tabelas com células mescladas ficam completas)
  function limitavel(t) {
    if (!t.isConnected || t.matches(GRADES) || t.closest('.modal-admin, dialog, .modal-fundo, [id^="ganDatasPopup"]')) return false;
    return ![...t.querySelectorAll('tbody [rowspan]')].some(c => c.rowSpan > 1);
  }
  function chaveDe(t) {
    if (t.id) return t.id;
    const sec = t.closest('section') || document.body, lista = [...sec.querySelectorAll('table')];
    return (sec.id || 'doc') + ':' + lista.indexOf(t);
  }
  // nome de cada coluna: texto do cabeçalho; se vazio (ou se há um grupo acima, ex.: semana → EJ/CMM), junta com o texto do grupo
  function nomesColunas(t, n) {
    const nomes = new Array(n).fill('');
    if (!t.tHead) return nomes;
    [...t.tHead.rows].forEach(r => {
      let c = 0;
      [...r.cells].forEach(th => {
        const tx = limpo(th.textContent), span = th.colSpan || 1;
        for (let i = c; i < c + span && i < n; i++) {
          if (!tx) continue;
          nomes[i] = span > 1 || !nomes[i] ? tx : (nomes[i] === tx ? tx : nomes[i] + ' · ' + tx);
        }
        c += span;
      });
    });
    return nomes;
  }
  function numColunas(t) {
    const ls = linhasDeDados(t).filter(r => !ehSeparador(r));
    return ls.length ? Math.max(...ls.slice(0, 5).map(r => r.cells.length)) : 0;
  }

  // ---------------------------------------------------------------- valores e tipos
  const valorCelula = td => {
    if (!td) return '';
    if (td.dataset && td.dataset.ord != null) return td.dataset.ord;
    const inp = td.querySelector('input:not([type=checkbox]), select, textarea');
    return limpo(inp ? inp.value : td.textContent);
  };
  const VAZIO = v => v === '' || v === '—' || v === '-' || v === '–';
  function dataDe(v) {
    let m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[1] + m[2] + m[3];
    m = v.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
    if (!m) return null;
    let a = m[3] ? +m[3] : new Date().getFullYear();
    if (a < 100) a += 2000;
    return String(a) + String(m[2]).padStart(2, '0') + String(m[1]).padStart(2, '0');
  }
  function numeroDe(v) {
    const m = v.match(/^([+\-−]?)\s*(?:R\$\s*)?(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d+))?(?!\d)(.*)$/);
    if (!m || /\d/.test(m[4])) return null;
    const n = parseFloat(m[2].replace(/\./g, '') + (m[3] ? '.' + m[3] : ''));
    return m[1] === '-' || m[1] === '−' ? -n : n;
  }
  function tipoDaColuna(valores) {
    const v = valores.filter(x => !VAZIO(x)).slice(0, 80);
    if (!v.length) return 'texto';
    const pct = f => v.filter(x => f(x) != null).length / v.length;
    if (pct(dataDe) >= 0.8) return 'data';
    if (pct(numeroDe) >= 0.8) return 'numero';
    return 'texto';
  }
  function chaveOrdem(v, tipo) {
    if (VAZIO(v)) return null;
    if (tipo === 'data') return dataDe(v);
    if (tipo === 'numero') return numeroDe(v);
    return v;
  }
  function comparar(a, b, tipo, dir) {
    if (a == null && b == null) return 0;
    if (a == null) return 1;                       // vazio sempre no fim, em qualquer sentido
    if (b == null) return -1;
    let r;
    if (tipo === 'numero') r = a - b;
    else if (tipo === 'data') r = a < b ? -1 : a > b ? 1 : 0;
    else r = colator.compare(a, b);
    return dir === 'desc' ? -r : r;
  }

  // ---------------------------------------------------------------- barra de ferramentas
  function criarBarra(t) {
    const b = document.createElement('div');
    b.className = 'tab-ferr';
    b.innerHTML = '<input type="search" class="tf-busca" placeholder="Filtrar linhas…" aria-label="Filtrar linhas da tabela" autocomplete="off">' +
      '<select class="tf-col" aria-label="Coluna" title="Coluna: o filtro e a ordem valem para ela"></select>' +
      '<select class="tf-ord" aria-label="Ordem" title="Ordem da coluna escolhida"></select>' +
      '<button type="button" class="tf-limpar" title="Limpar filtro, coluna e ordem">Limpar</button>' +
      '<span class="tf-cont"></span>';
    const ancora = t.closest('.tabela-rolagem') && t.closest('.tabela-rolagem').querySelectorAll('table').length === 1 ? t.closest('.tabela-rolagem') : t;
    b.dataset.tfChave = t._tfChave;
    [...ancora.parentNode.children].forEach(x => { if (x.classList && x.classList.contains('tab-ferr') && x.dataset.tfChave === t._tfChave) x.remove(); });   // barra órfã de um redesenho anterior
    ancora.parentNode.insertBefore(b, ancora);
    const st = () => estado.get(t._tfChave);
    b.querySelector('.tf-busca').addEventListener('input', ev => { st().filtro = ev.target.value; st().pag = 0; aplicar(t); });
    b.querySelector('.tf-col').addEventListener('change', ev => { const s = st(); s.col = ev.target.value === '' ? null : +ev.target.value; if (s.col == null) s.dir = ''; s.pag = 0; aplicar(t); });
    b.querySelector('.tf-ord').addEventListener('change', ev => { st().dir = ev.target.value; st().pag = 0; aplicar(t); });
    b.querySelector('.tf-limpar').addEventListener('click', () => { const s = st(); s.col = null; s.dir = ''; s.filtro = ''; s.pag = 0; aplicar(t); });
    return b;
  }
  function iniciar(t) {
    if (t._tfChave) return;
    t._tfChave = chaveDe(t);
    if (!estado.has(t._tfChave)) estado.set(t._tfChave, { col: null, dir: '', filtro: '', pag: 0 });
    t.classList.add('tab-ord');
    t._tfBarra = criarBarra(t);
  }

  // ---------------------------------------------------------------- aplicar filtro e ordem
  function aplicar(t) {
    if (!t._tfChave) return;
    const barra = t._tfBarra, s = estado.get(t._tfChave);
    if (!elegivel(t)) { barra.hidden = true; return; }
    const ativo = document.activeElement;
    if (ativo && t.contains(ativo) && /^(INPUT|SELECT|TEXTAREA)$/.test(ativo.tagName)) return;   // não mexe numa tabela enquanto alguém digita nela
    const rows = linhasDeDados(t);
    rows.forEach((r, i) => { if (r.dataset.tfIdx === undefined) r.dataset.tfIdx = String(i); });
    const dados = rows.filter(r => !ehSeparador(r));
    const n = numColunas(t), nomes = nomesColunas(t, n);
    barra.hidden = dados.length < 2 && !s.filtro && s.col == null;

    // opções da lista de colunas (só redesenha quando os cabeçalhos mudam)
    const assinatura = nomes.join('\u0001');
    if (barra._ass !== assinatura) {
      barra._ass = assinatura;
      const opc = nomes.map((nm, i) => nm ? `<option value="${i}">${nm.replace(/&/g, '&amp;').replace(/</g, '&lt;').slice(0, 48)}</option>` : '').join('');
      barra.querySelector('.tf-col').innerHTML = '<option value="">Todas as colunas</option>' + opc;
    }
    if (s.col != null && s.col >= n) { s.col = null; s.dir = ''; }
    // lista de ordem: o texto acompanha o tipo da coluna escolhida (texto, número ou data)
    const tipoCol = s.col == null ? null : tipoDaColuna(dados.map(r => valorCelula(r.cells[s.col])));
    const rot = { texto: ['A → Z (crescente)', 'Z → A (decrescente)'], numero: ['Menor → maior (crescente)', 'Maior → menor (decrescente)'], data: ['Mais antigo → mais novo (crescente)', 'Mais novo → mais antigo (decrescente)'] }[tipoCol || 'texto'];
    const selOrd = barra.querySelector('.tf-ord');
    selOrd.innerHTML = s.col == null ? '<option value="">Escolha a coluna…</option>' : `<option value="">Ordem original</option><option value="asc">${rot[0]}</option><option value="desc">${rot[1]}</option>`;
    selOrd.disabled = s.col == null;
    barra.querySelector('.tf-busca').value = s.filtro;
    barra.querySelector('.tf-busca').placeholder = s.col == null ? 'Filtrar linhas…' : `Filtrar em “${(nomes[s.col] || '').slice(0, 24)}”…`;
    barra.querySelector('.tf-col').value = s.col == null ? '' : String(s.col);
    selOrd.value = s.col == null ? '' : s.dir;

    // 1) ordem (dentro de cada grupo; tbody por tbody)
    let mudou = false;
    [...t.tBodies].forEach(tb => {
      const linhas = [...tb.rows], novos = [];
      let seg = [];
      const fecha = () => {
        if (!seg.length) return;
        if (s.col == null || !s.dir) seg.sort((a, b) => a.dataset.tfIdx - b.dataset.tfIdx);
        else {
          const tipo = tipoDaColuna(seg.map(r => valorCelula(r.cells[s.col])));
          const chaves = new Map(seg.map(r => [r, chaveOrdem(valorCelula(r.cells[s.col]), tipo)]));
          seg.sort((a, b) => comparar(chaves.get(a), chaves.get(b), tipo, s.dir) || a.dataset.tfIdx - b.dataset.tfIdx);
        }
        novos.push(...seg); seg = [];
      };
      linhas.forEach(r => { if (ehSeparador(r)) { fecha(); novos.push(r); } else seg.push(r); });
      fecha();
      if (novos.some((r, i) => r !== linhas[i])) { mudou = true; novos.forEach(r => tb.appendChild(r)); }
    });

    // 2) filtro (todas as palavras precisam aparecer; por coluna ou na linha toda)
    const termos = norm(s.filtro).split(/\s+/).filter(Boolean), colF = s.col;
    let visiveis = 0;
    [...t.tBodies].forEach(tb => {
      const linhas = [...tb.rows];
      const textoDe = r => norm(colF == null ? [...r.cells].map(valorCelula).join(' ') : valorCelula(r.cells[colF]));
      let pendenteSep = null, algumNoGrupo = false;
      const fechaGrupo = () => { if (pendenteSep) pendenteSep.classList.toggle('tf-oculta', !!termos.length && !algumNoGrupo); };
      linhas.forEach(r => {
        if (ehSeparador(r)) {
          fechaGrupo();
          pendenteSep = r; algumNoGrupo = false;
          return;
        }
        const ok = !termos.length || termos.every(x => textoDe(r).includes(x));
        r.classList.toggle('tf-oculta', !ok);
        if (ok) { visiveis++; algumNoGrupo = true; }
      });
      fechaGrupo();
    });
    barra.querySelector('.tf-cont').textContent = termos.length ? `${visiveis} de ${dados.length} linhas` : (dados.length ? `${dados.length} linhas` : '');
    aplicarLimite(t);

    // 3) indicador no cabeçalho
    if (t.tHead) [...t.tHead.querySelectorAll('th')].forEach(th => {
      const ordenavel = (th.colSpan || 1) === 1 && n > 0 && colDoTh(th) < n && !th.classList.contains('mat-ck');
      th.classList.toggle('th-ord', ordenavel);
      if (ordenavel && !th.title) th.title = 'Clique para ordenar';
      if (ordenavel && s.col === colDoTh(th) && s.dir) th.setAttribute('data-ord', s.dir); else th.removeAttribute('data-ord');
    });
    return mudou;
  }

  // ---------------------------------------------------------------- páginas de 50 linhas
  // Esconde (classe tf-limite) as linhas visíveis fora da página atual e mantém a barra de páginas abaixo da tabela.
  function botoesPaginas(atual, total) {
    const n = new Set([0, total - 1, atual - 1, atual, atual + 1]);
    const lista = [...n].filter(i => i >= 0 && i < total).sort((a, b) => a - b);
    let h = '', ant = -1;
    lista.forEach(i => {
      if (ant >= 0 && i - ant > 1) h += '<span class="tf-pt">…</span>';
      h += `<button type="button" class="btn${i === atual ? ' tf-atual' : ''}" data-tf-pag="${i}" ${i === atual ? 'aria-current="page"' : ''}>${i + 1}</button>`;
      ant = i;
    });
    return h;
  }
  function aplicarLimite(t) {
    if (!t._tfChave) { t._tfChave = chaveDe(t); }
    if (!estado.has(t._tfChave)) estado.set(t._tfChave, { col: null, dir: '', filtro: '', pag: 0 });
    const s = estado.get(t._tfChave);
    const ancora = t.closest('.tabela-rolagem') && t.closest('.tabela-rolagem').querySelectorAll('table').length === 1 ? t.closest('.tabela-rolagem') : t;
    const rows = linhasDeDados(t);
    rows.forEach(r => r.classList.remove('tf-limite'));
    const visiveis = rows.filter(r => !ehSeparador(r) && !r.classList.contains('tf-oculta'));
    let barra = ancora.nextElementSibling;
    if (!(barra && barra.classList && barra.classList.contains('tf-mais') && barra.dataset.tfChave === t._tfChave)) barra = null;
    if (!limitavel(t) || visiveis.length <= LIMITE) { if (barra) barra.remove(); s.pag = 0; return; }
    const total = Math.ceil(visiveis.length / LIMITE);
    s.pag = Math.max(0, Math.min(s.pag || 0, total - 1));
    const ini = s.pag * LIMITE, fim = Math.min(visiveis.length, ini + LIMITE);
    visiveis.forEach((r, i) => { if (i < ini || i >= fim) r.classList.add('tf-limite'); });
    // separador de grupo sem nenhuma linha visível na página some junto
    let sep = null, algum = false;
    const fecha = () => { if (sep) sep.classList.toggle('tf-limite', !algum); };
    rows.forEach(r => {
      if (ehSeparador(r)) { fecha(); sep = r; algum = false; }
      else if (!r.classList.contains('tf-oculta') && !r.classList.contains('tf-limite')) algum = true;
    });
    fecha();
    if (!barra) {
      barra = document.createElement('div');
      barra.className = 'tf-mais';
      barra.dataset.tfChave = t._tfChave;
      ancora.parentNode.insertBefore(barra, ancora.nextSibling);
    }
    barra.innerHTML = `<span class="tf-info">Linhas <b>${ini + 1}–${fim}</b> de <b>${visiveis.length}</b></span>` +
      `<span class="tf-pags"><button type="button" class="btn" data-tf-pag="${s.pag - 1}" ${s.pag === 0 ? 'disabled' : ''}>‹ Anterior</button>${botoesPaginas(s.pag, total)}` +
      `<button type="button" class="btn" data-tf-pag="${s.pag + 1}" ${s.pag >= total - 1 ? 'disabled' : ''}>Próxima ›</button></span>` +
      `<span class="tf-info">Página <b>${s.pag + 1}</b> de <b>${total}</b></span>`;
  }
  document.addEventListener('click', ev => {
    const b = ev.target.closest && ev.target.closest('.tf-mais button[data-tf-pag]');
    if (!b || b.disabled) return;
    const barra = b.closest('.tf-mais'), chave = barra.dataset.tfChave, s = estado.get(chave);
    const t = [...document.querySelectorAll(SECOES + ' table')].find(x => x._tfChave === chave);
    if (!s || !t) return;
    s.pag = +b.getAttribute('data-tf-pag') || 0;
    obs.disconnect(); aplicarLimite(t); observar();
    const topo = (t.closest('.tabela-rolagem') || t).getBoundingClientRect().top;
    if (topo < 0) (t.closest('.tabela-rolagem') || t).scrollIntoView({ block: 'start' });   // volta ao começo da lista ao trocar de página
  });

  // clique no cabeçalho: A→Z, Z→A, ordem original
  document.addEventListener('click', ev => {
    const th = ev.target.closest && ev.target.closest('thead th.th-ord');
    if (!th || ev.target.closest('button, a, input, select, label')) return;
    const t = th.closest('table.tab-ord');
    if (!t || !t._tfChave) return;
    const s = estado.get(t._tfChave), col = colDoTh(th);
    if (s.col === col && s.dir === 'asc') s.dir = 'desc';
    else if (s.col === col && s.dir === 'desc') s.dir = '';
    else { s.col = col; s.dir = 'asc'; }
    s.pag = 0;
    obs.disconnect(); aplicar(t); observar();
  });

  // ---------------------------------------------------------------- redesenhos
  const sujas = new Set();
  let agendado = false;
  function processar() {
    agendado = false;
    obs.disconnect();
    try { sujas.forEach(t => { if (t.isConnected && elegivel(t)) { iniciar(t); aplicar(t); } else { if (t._tfBarra) t._tfBarra.hidden = true; if (t.isConnected && t.closest(SECOES)) aplicarLimite(t); } }); }
    finally { sujas.clear(); observar(); }
  }
  const obs = new MutationObserver(ms => {
    ms.forEach(m => {
      const alvos = [m.target, ...m.addedNodes];
      alvos.forEach(n => {
        const el = n.nodeType === 1 ? n : n.parentElement;
        if (!el) return;
        const t = el.closest && el.closest('table');
        if (t) sujas.add(t);
        if (el.querySelectorAll) el.querySelectorAll('table').forEach(x => sujas.add(x));
      });
    });
    if (sujas.size && !agendado) { agendado = true; requestAnimationFrame(processar); }
  });
  function observar() { document.querySelectorAll(SECOES).forEach(s => obs.observe(s, { childList: true, subtree: true })); }
  function varrer() { document.querySelectorAll(SECOES + ' table').forEach(t => sujas.add(t)); if (sujas.size) processar(); else observar(); }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', varrer); else varrer();
})();
