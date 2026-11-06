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

  // Calendário próprio: o Safari não abre de forma confiável showPicker() num input oculto.
  function abrirCalendario(nat, bt) {
    if (nat.disabled || nat.readOnly) return;
    if (!document.getElementById('dataBrCalendarioEstilo')) {
      const st = document.createElement('style'); st.id = 'dataBrCalendarioEstilo';
      st.textContent = `.data-br-cal{box-sizing:border-box;width:min(360px,calc(100vw - 24px))!important;max-width:calc(100vw - 24px)!important;max-height:calc(100dvh - 24px);overflow:auto;padding:16px;border:1px solid #c9ced6;border-radius:14px;background:var(--card,#fff);color:var(--fg,#182230);font:16px system-ui;box-shadow:0 12px 40px #0003}.data-br-cal::backdrop{background:#0007}.data-br-cal header{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:12px}.data-br-cal h2{font-size:16px;text-align:center;margin:0}.data-br-cal button{font:inherit;min-height:44px;border:1px solid #d0d5dd;border-radius:8px;background:var(--card,#fff);color:inherit;cursor:pointer;padding:4px}.data-br-cal header button{min-width:44px}.data-br-cal button:disabled{opacity:.35;cursor:default}.data-br-cal-grade{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:3px}.data-br-cal-grade span{text-align:center;font-size:12px;padding:6px 0;color:var(--fg2,#667085)}.data-br-cal-grade button{min-width:0;min-height:40px;border-color:transparent}.data-br-cal-grade button[aria-current=date]{border-color:var(--acento,#2563eb)}.data-br-cal-grade button[aria-pressed=true]{background:var(--acento,#2563eb);color:white}.data-br-cal button:focus-visible{outline:3px solid #60a5fa;outline-offset:1px}.data-br-cal footer{display:flex;gap:8px;justify-content:flex-end;margin-top:12px}.data-br-cal footer button{padding:6px 10px}`;
      document.head.append(st);
    }
    const dlg = document.createElement('dialog'); dlg.className = 'data-br-cal';
    dlg.setAttribute('aria-label', 'Selecionar data');
    const agora = new Date(), pad = n => String(n).padStart(2, '0');
    const hoje = `${agora.getFullYear()}-${pad(agora.getMonth() + 1)}-${pad(agora.getDate())}`;
    const permitido = d => (!nat.min || d >= nat.min) && (!nat.max || d <= nat.max);
    let inicial = nat.value || hoje;
    if (nat.min && inicial < nat.min) inicial = nat.min;
    if (nat.max && inicial > nat.max) inicial = nat.max;
    let ano = +inicial.slice(0, 4), mes = +inicial.slice(5, 7) - 1;
    const meses = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    const fechar = () => { dlg.close(); dlg.remove(); bt.focus(); };
    const escolher = valor => {
      if (nat.disabled || nat.readOnly || (valor && !permitido(valor))) return;
      nat.value = valor;
      fechar();
      nat.dispatchEvent(new Event('input', { bubbles: true }));
      nat.dispatchEvent(new Event('change', { bubbles: true }));
    };
    function desenhar() {
      dlg.innerHTML = `<header><button type="button" data-mes="-1" aria-label="Mês anterior">‹</button><h2 aria-live="polite">${meses[mes]} de ${ano}</h2><button type="button" data-mes="1" aria-label="Próximo mês">›</button></header><div class="data-br-cal-grade"></div><footer><button type="button" data-hoje>Hoje</button>${nat.required ? '' : '<button type="button" data-limpar>Limpar</button>'}<button type="button" data-fechar>Fechar</button></footer>`;
      const grid = dlg.querySelector('.data-br-cal-grade');
      ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].forEach(d => { const el = document.createElement('span'); el.textContent = d; grid.append(el); });
      const primeiro = new Date(Date.UTC(ano, mes, 1)).getUTCDay(), total = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
      for (let i = 0; i < primeiro; i++) grid.append(document.createElement('span'));
      for (let dia = 1; dia <= total; dia++) {
        const data = `${ano}-${pad(mes + 1)}-${pad(dia)}`, el = document.createElement('button');
        el.type = 'button'; el.textContent = dia; el.dataset.data = data;
        el.disabled = !permitido(data); el.setAttribute('aria-label', isoParaBr(data));
        el.setAttribute('aria-pressed', String(data === nat.value));
        if (data === hoje) el.setAttribute('aria-current', 'date');
        grid.append(el);
      }
      dlg.querySelector('[data-hoje]').disabled = !permitido(hoje);
    }
    dlg.addEventListener('click', ev => {
      const b = ev.target.closest('button'); if (!b || b.disabled) return;
      if (b.dataset.mes) {
        const novo = new Date(Date.UTC(ano, mes + Number(b.dataset.mes), 1));
        ano = novo.getUTCFullYear(); mes = novo.getUTCMonth(); desenhar();
        dlg.querySelector(`[data-mes="${b.dataset.mes}"]`).focus();
      } else if (b.dataset.data) escolher(b.dataset.data);
      else if (b.hasAttribute('data-hoje')) escolher(hoje);
      else if (b.hasAttribute('data-limpar')) escolher('');
      else if (b.hasAttribute('data-fechar')) fechar();
    });
    dlg.addEventListener('cancel', ev => { ev.preventDefault(); fechar(); });
    // Dentro de um pop-up, o calendário também precisa ficar no diálogo ativo.
    (nat.closest('dialog[open]') || document.body).append(dlg);
    desenhar(); dlg.showModal();
    const foco = dlg.querySelector('[aria-pressed="true"]:not(:disabled)') || dlg.querySelector('[data-data]:not(:disabled)') || dlg.querySelector('[data-fechar]');
    foco.focus();
  }

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
    bt.type = 'button'; bt.className = 'data-br-bt'; bt.title = 'Abrir calendário'; bt.setAttribute('aria-label', 'Abrir calendário'); bt.setAttribute('aria-haspopup', 'dialog'); bt.textContent = '📅';
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
    bt.addEventListener('click', () => abrirCalendario(nat, bt));
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
