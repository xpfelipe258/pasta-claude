// SESMT dentro do sistema: as telas de Pessoas (aba Pessoal) e de Ocorrências aparecem como abas do próprio sistema,
// no mesmo layout, em vez de abrir a página separada sesmt.php. O quadro (iframe) carrega sesmt.php?embed=… (sem topo nem menu).
const SESMT_SUBS = ['colaboradores', 'aso', 'treinamentos', 'presenca', 'advertencias', 'cipa'];
const SESMT_QS = (() => { const q = new URLSearchParams(location.search), o = {}; ['reg', 'modo', 'id', 'empresa', 'q', 'sit', 'p'].forEach(k => { if (q.get(k)) o[k] = q.get(k); }); return o; })();
let dpSub = (location.search.includes('aba=dp') && SESMT_SUBS.includes(SESMT_QS.reg)) ? SESMT_QS.reg : '';
let SESMT_PARAMS_USADOS = false;   // os parâmetros do endereço valem só para a primeira abertura da tela

function sesmtAjustar(f) {
  try {
    const d = f.contentDocument, main = d && d.querySelector('main');
    if (!d || !main) return;
    const medir = () => { const h = Math.ceil(main.getBoundingClientRect().bottom + (d.defaultView.scrollY || 0)) + 24; f.style.height = Math.max(420, h) + 'px'; };
    medir();
    if (f._ro) f._ro.disconnect();
    if (d.defaultView.ResizeObserver) { f._ro = new d.defaultView.ResizeObserver(medir); f._ro.observe(main); f._ro.observe(d.body); }
  } catch { }
}

function sesmtCarregar(box, url, forcar) {
  if (!box) return;
  let f = box.querySelector('iframe');
  if (!f) {
    box.innerHTML = '';
    f = document.createElement('iframe');
    f.className = 'sesmt-frame'; f.title = 'SESMT'; f.setAttribute('scrolling', 'no');
    f.addEventListener('load', () => { sesmtAjustar(f); setTimeout(() => sesmtAjustar(f), 300); });
    box.appendChild(f);
  }
  if (forcar || f.dataset.url !== url) { f.dataset.url = url; f.src = url; }
  else setTimeout(() => sesmtAjustar(f), 50);   // a aba voltou a ser mostrada: remede a altura
}

function sesmtUrl(extra, embed) {
  const q = Object.assign({ embed }, extra);
  return 'sesmt.php?' + new URLSearchParams(q).toString();
}

// ----- aba Pessoal: Efetivo diário + sub-abas do SESMT (Colaboradores, ASO…)
function dpSubAplicar(forcar) {
  const sec = document.getElementById('aba-dp');
  if (!sec) return;
  if (sec.hidden) return;   // só desenha quando a aba Pessoal está aberta
  const sub = window.SESMT_OK ? dpSub : '';   // sem acesso ao SESMT (ou antes de a consulta de acesso voltar) só existe o efetivo diário
  sec.querySelectorAll('#segDpSub button').forEach(b => b.classList.toggle('ativa', b.dataset.dpsub === sub));
  const efet = document.getElementById('dpEfetivoBox'), box = document.getElementById('dpSesmtBox');
  if (efet) efet.hidden = !!sub;
  if (box) box.hidden = !sub;
  if (sub) {
    const extra = { reg: sub };
    if (!SESMT_PARAMS_USADOS && SESMT_QS.reg === sub) { ['modo', 'id', 'empresa', 'q', 'sit', 'p'].forEach(k => { if (SESMT_QS[k]) extra[k] = SESMT_QS[k]; }); SESMT_PARAMS_USADOS = true; }
    sesmtCarregar(box, sesmtUrl(extra, 'p'), forcar);
  }
}
document.addEventListener('click', ev => {
  const b = ev.target.closest('#segDpSub button[data-dpsub]');
  if (!b) return;
  dpSub = b.dataset.dpsub;
  dpSubAplicar(true);
  try { sessionStorage.setItem('dpSub', dpSub); } catch { }
});

// ----- aba SESMT › Ocorrências
function renderSesmtOcorr() {
  const extra = {};
  if (!SESMT_PARAMS_USADOS && !(location.search.includes('aba=dp')) && location.search.includes('aba=sesmtocorr')) {
    ['reg', 'modo', 'id', 'empresa', 'q', 'sit', 'p'].forEach(k => { if (SESMT_QS[k]) extra[k] = SESMT_QS[k]; });
    SESMT_PARAMS_USADOS = true;
  }
  if (!extra.reg) extra.g = 'ocorrencias';
  sesmtCarregar(document.getElementById('sesmtOcorrBox'), sesmtUrl(extra, '1'), false);
}
