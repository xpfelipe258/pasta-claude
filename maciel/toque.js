'use strict';
// ------------------------------------------------------------------------------------------------
// USO NO CELULAR — arrastar o dedo para marcar várias peças nos mapas (Apontar montagem).
// Os mapas pintam com mousedown / mouseover / mouseup; no toque o navegador só gera o clique do toque simples e o arraste vira rolagem.
// Aqui: encostar e SEGURAR o dedo ~0,3 s numa peça liga o modo pintar (o aparelho vibra); daí arrastar marca as peças por onde o dedo
// passa (a rolagem da página fica travada enquanto pinta) e soltar termina. Tocar rápido e rolar a página continuam normais.
// Funciona nas telhas, joists/vigas (mapa de Apontar montagem) e na planta das obras importadas.
// ------------------------------------------------------------------------------------------------
(() => {
  const ALVOS = '[data-ap-slot],[data-ap-telha],#moMapa [data-mo-p]';
  const ESPERA_MS = 300, TOLERANCIA_PX = 10;
  let timer = null, pintando = false, x0 = 0, y0 = 0, ultimo = null;

  const evento = (tipo, el, t) => el.dispatchEvent(new MouseEvent(tipo, { bubbles: true, cancelable: true, view: window, button: 0, buttons: tipo === 'mouseup' ? 0 : 1, clientX: t ? t.clientX : 0, clientY: t ? t.clientY : 0 }));
  const alvoEm = t => { const e = document.elementFromPoint(t.clientX, t.clientY); return e && e.closest ? e.closest(ALVOS) : null; };
  const cancelar = () => { clearTimeout(timer); timer = null; };

  document.addEventListener('touchstart', ev => {
    if (ev.touches.length !== 1) { cancelar(); return; }
    const t = ev.touches[0], el = ev.target.closest && ev.target.closest(ALVOS);
    if (!el) return;
    x0 = t.clientX; y0 = t.clientY;
    cancelar();
    timer = setTimeout(() => {
      timer = null;
      const atual = document.elementFromPoint(x0, y0), alvo = atual && atual.closest ? atual.closest(ALVOS) : null;
      if (!alvo) return;
      pintando = true; ultimo = alvo;
      document.body.classList.add('pintando-toque');
      try { navigator.vibrate && navigator.vibrate(20); } catch { /* sem vibração */ }
      evento('mousedown', alvo, { clientX: x0, clientY: y0 });
    }, ESPERA_MS);
  }, { passive: true });

  document.addEventListener('touchmove', ev => {
    const t = ev.touches[0];
    if (!pintando) {   // mexeu antes do tempo: é rolagem, não pintura
      if (timer && (Math.abs(t.clientX - x0) > TOLERANCIA_PX || Math.abs(t.clientY - y0) > TOLERANCIA_PX)) cancelar();
      return;
    }
    ev.preventDefault();
    const alvo = alvoEm(t);
    if (alvo && alvo !== ultimo) { ultimo = alvo; evento('mouseover', alvo, t); }
  }, { passive: false });

  const fim = ev => {
    cancelar();
    if (!pintando) return;
    pintando = false; ultimo = null;
    document.body.classList.remove('pintando-toque');
    ev.preventDefault();   // evita o clique "fantasma" depois de pintar
    evento('mouseup', document.body, ev.changedTouches ? ev.changedTouches[0] : null);
  };
  document.addEventListener('touchend', fim, { passive: false });
  document.addEventListener('touchcancel', fim, { passive: false });
  // menu de contexto do toque longo não deve abrir em cima dos mapas
  document.addEventListener('contextmenu', ev => { if (ev.target.closest && ev.target.closest(ALVOS)) ev.preventDefault(); });
})();
