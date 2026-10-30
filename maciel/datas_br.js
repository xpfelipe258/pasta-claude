// Datas SEMPRE em dd/mm/aaaa (formato brasileiro), em todas as telas do sistema.
//  1) Campos de data (<input type="date">): o campo que a pessoa vê e digita é um texto "dd/mm/aaaa" (com máscara) e um botão 📅 abre o
//     calendário. O campo nativo continua no lugar (escondido, mesmo id/nome) guardando o valor ISO aaaa-mm-dd, então todo o código
//     que lê ou grava `.value` e escuta `change` segue funcionando sem mudança, inclusive nos formulários enviados ao servidor.
//  2) Texto na tela: qualquer data em ISO (aaaa-mm-dd, com ou sem hora) que apareça em texto, título (tooltip) ou lista vira dd/mm/aaaa.
//     Campos de digitação (input/textarea) e blocos de código nunca são alterados.
// Também expõe dataBR(texto) e htmlDatasBR(html) para relatórios, PDFs e exportações.
(function () {
  'use strict';
  const RE_ISO = /\b(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(?:Z)?)?(?![\d-])/g;
  const TEM_ISO = /\b\d{4}-\d{2}-\d{2}(?![\d-])/;

  function mesDiaValidos(m, d) { return m >= 1 && m <= 12 && d >= 1 && d <= 31; }
  // "2026-09-30" -> "30/09/2026"; "2026-09-30 14:05:00" -> "30/09/2026 14:05"; meia-noite não mostra hora.
  function dataBR(t) {
    return String(t == null ? '' : t).replace(RE_ISO, (x, y, m, d, hh, mi) => {
      if (!mesDiaValidos(+m, +d)) return x;
      const h = hh != null && !(hh === '00' && mi === '00') ? ` ${hh}:${mi}` : '';
      return `${d}/${m}/${y}${h}`;
    });
  }
  // Mesma conversão em um trecho de HTML, só no TEXTO (atributos, scripts e estilos ficam intactos).
  function htmlDatasBR(html) {
    let oculto = 0;
    return String(html == null ? '' : html).replace(/(<[^>]*>)|([^<]+)/g, (x, tag, txt) => {
      if (tag) {
        if (/^<(script|style)\b/i.test(tag)) oculto++;
        else if (/^<\/(script|style)\b/i.test(tag)) oculto = Math.max(0, oculto - 1);
        return tag;
      }
      return oculto ? txt : dataBR(txt);
    });
  }
  window.dataBR = dataBR; window.htmlDatasBR = htmlDatasBR;

  const isoParaBr = v => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || ''); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };
  function brParaIso(t) {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(t || '').trim());
    if (!m) return null;
    const d = +m[1], mo = +m[2], y = +m[3];
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (y < 1900 || y > 2200 || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
    return `${m[3]}-${m[2]}-${m[1]}`;
  }
  // Máscara enquanto digita: só números, barras automáticas.
  function mascara(v) {
    const n = String(v).replace(/\D/g, '').slice(0, 8);
    return n.length > 4 ? `${n.slice(0, 2)}/${n.slice(2, 4)}/${n.slice(4)}` : n.length > 2 ? `${n.slice(0, 2)}/${n.slice(2)}` : n;
  }

  const protoValor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');

  function melhorarData(nat) {
    if (nat._brOk || nat.type !== 'date') return;
    nat._brOk = true;
    const caixa = document.createElement('span'); caixa.className = 'data-br-caixa';
    const txt = document.createElement('input');
    txt.type = 'text'; txt.inputMode = 'numeric'; txt.autocomplete = 'off'; txt.maxLength = 10; txt.placeholder = 'dd/mm/aaaa';
    txt.className = (nat.className ? nat.className + ' ' : '') + 'data-br-txt';
    if (nat.style && nat.style.cssText) txt.style.cssText = nat.style.cssText;
    if (nat.title) txt.title = nat.title;
    if (nat.getAttribute('aria-label')) txt.setAttribute('aria-label', nat.getAttribute('aria-label'));
    const bt = document.createElement('button');
    bt.type = 'button'; bt.className = 'data-br-bt'; bt.tabIndex = -1; bt.title = 'Abrir calendário'; bt.setAttribute('aria-label', 'Abrir calendário'); bt.textContent = '📅';
    nat.parentNode.insertBefore(caixa, nat);
    caixa.append(txt, bt, nat);
    nat.classList.add('data-br-nat'); nat.tabIndex = -1;
    nat._brTxt = txt; nat._brCaixa = caixa;

    const ler = () => protoValor.get.call(nat);
    const espelhar = () => {
      txt.value = isoParaBr(ler());
      txt.disabled = nat.disabled; txt.readOnly = nat.readOnly; bt.disabled = nat.disabled || nat.readOnly;
      txt.classList.remove('data-br-erro');
    };
    // atribuição por código (`input.value = '2026-10-27'`) também atualiza o campo visível
    Object.defineProperty(nat, 'value', {
      configurable: true,
      get() { return protoValor.get.call(this); },
      set(v) { protoValor.set.call(this, v); espelhar(); },
    });
    const focoOriginal = nat.focus.bind(nat);
    nat.focus = opc => txt.focus(opc);
    nat.select = () => txt.select();
    nat.addEventListener('focus', () => { if (!nat._brPicker) txt.focus(); });   // clique em <label for> ou foco por código vai para o campo visível
    espelhar();

    const avisar = () => { nat.dispatchEvent(new Event('input', { bubbles: true })); nat.dispatchEvent(new Event('change', { bubbles: true })); };
    txt.addEventListener('input', () => {
      const m = mascara(txt.value); if (m !== txt.value) txt.value = m;
      if (!txt.value) { if (ler() !== '') { protoValor.set.call(nat, ''); avisar(); } txt.classList.remove('data-br-erro'); return; }
      if (txt.value.length === 10) {
        const iso = brParaIso(txt.value);
        if (iso) {
          txt.classList.remove('data-br-erro');
          if (iso !== ler()) { protoValor.set.call(nat, iso); avisar(); }
        } else txt.classList.add('data-br-erro');
      } else txt.classList.remove('data-br-erro');
    });
    txt.addEventListener('blur', () => { if (txt.value && !brParaIso(txt.value)) espelhar(); });   // data incompleta ou inválida: volta ao valor válido
    bt.addEventListener('click', () => {
      if (nat.disabled || nat.readOnly) return;
      nat._brPicker = true;
      try { nat.showPicker(); } catch (e) { try { focoOriginal(); nat.click(); } catch (e2) { /* navegador sem calendário */ } }
      setTimeout(() => { nat._brPicker = false; }, 600);
    });
    nat.addEventListener('change', espelhar);   // escolha feita no calendário
    nat.addEventListener('input', espelhar);
    if (nat.form) nat.form.addEventListener('reset', () => setTimeout(espelhar, 0));
    new MutationObserver(espelhar).observe(nat, { attributes: true, attributeFilter: ['disabled', 'readonly'] });
  }

  // ---- texto na tela --------------------------------------------------------------------------------------------------------
  const PULA = 'script,style,textarea,input,select,code,pre,[data-sem-data-br]';
  function trocaTexto(no) {
    const v = no.nodeValue;
    if (!v || !TEM_ISO.test(v)) return;
    const el = no.parentElement;
    if (!el || el.closest(PULA)) return;
    const novo = dataBR(v);
    if (novo !== v) no.nodeValue = novo;
  }
  function trocaTitulos(raiz) {
    const lista = raiz.nodeType === 1 ? [raiz, ...raiz.querySelectorAll('[title],[aria-label],[placeholder]')] : [];
    lista.forEach(el => {
      ['title', 'aria-label'].forEach(a => { const v = el.getAttribute && el.getAttribute(a); if (v && TEM_ISO.test(v)) el.setAttribute(a, dataBR(v)); });
    });
  }
  function varrer(raiz) {
    if (!raiz) return;
    if (raiz.nodeType === 3) { trocaTexto(raiz); return; }
    if (raiz.nodeType !== 1) return;
    if (raiz.matches('input[type="date"]')) { melhorarData(raiz); return; }
    if (raiz.closest(PULA)) return;
    const w = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT);
    let n; const lista = [];
    while ((n = w.nextNode())) lista.push(n);
    lista.forEach(trocaTexto);
    trocaTitulos(raiz);
    raiz.querySelectorAll('input[type="date"]').forEach(melhorarData);
  }
  function varrerTudo() { varrer(document.body); }
  window.datasBrVarrer = varrerTudo;

  let fila = new Set(), agendado = false;
  function processar() {
    agendado = false;
    const itens = [...fila]; fila = new Set();
    itens.forEach(n => { if (n.isConnected !== false) varrer(n); });
  }
  function iniciar() {
    varrerTudo();
    new MutationObserver(muts => {
      for (const m of muts) {
        if (m.type === 'childList') m.addedNodes.forEach(n => { if (n.nodeType === 1 || n.nodeType === 3) fila.add(n.nodeType === 3 ? n.parentNode || n : n); });
        else if (m.type === 'characterData') fila.add(m.target);
      }
      if (fila.size && !agendado) { agendado = true; requestAnimationFrame(processar); }
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
