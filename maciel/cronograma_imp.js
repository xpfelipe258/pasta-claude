// Aba Cronograma (Gantt) › Importar cronograma (PDF, planilha ou MS Project) e conciliar as atividades.
// 1) o servidor lê o arquivo (cronograma_importar.php) e devolve as atividades com início e término;
// 2) esta tela compara cada atividade com o que TEM LEITURA no sistema — as atividades do cronograma atual (alimentadas pelos lançamentos)
//    e o catálogo de atividades (Lançamentos/BM) — e sugere o vínculo; quando o nome é diferente, a pessoa escolhe a atividade na lista;
// 3) ao salvar (rota cronograma-importado) o Gantt passa a usar as datas do arquivo. Ver ganImpMapa/ganLinhasImportadas em app.js.

const CI = { aberto: false, arquivo: '', formato: '', avisos: [], atividades: [], filtro: 'todas', busca: '', verResumos: false, substituir: false, alvos: [], porChave: new Map(), opcoes: '', opcoesCat: '', novo: false };
const CI_ALTA = 0.72, CI_MIN = 0.5;

const CI_STOP = new Set(['DE', 'DA', 'DO', 'DAS', 'DOS', 'E', 'EM', 'PARA', 'A', 'O', 'AS', 'OS', 'COM', 'NO', 'NA', 'NOS', 'NAS', 'POR', 'AO', 'H', 'M', 'EXECUCAO', 'FASE', 'OBRA']);
// ações que mudam o sentido da atividade: se o arquivo traz uma delas e a atividade do sistema não, não é a mesma coisa
const CI_ACOES = ['FABRICACAO', 'PROJETO', 'DETALHAMENTO', 'TRANSPORTE', 'ENTREGA', 'MOBILIZACAO', 'DESMOBILIZACAO', 'COMPRA', 'AQUISICAO', 'APROVACAO', 'PINTURA', 'GALVANIZACAO', 'PREMONT', 'PERFIL', 'CHECKLIST', 'ALINHAMENTO'];
const CI_GENERICAS = new Set(['INST', 'COBERTURA', 'ESTRUTURA', 'GALPAO']);
function ciTokens(txt) {
  let s = ' ' + ganNorm(txt) + ' ';
  [[/ PRE MONTAGEM | PREMONTAGEM | PRE MONT /g, ' PREMONT '], [/ (MONTAGEM|INSTALACAO|ICAMENTO|COLOCACAO|MONTAR|INSTALAR) /g, ' INST '], [/ FECH /g, ' FECHAMENTO '],
    [/ LAT /g, ' LATERAL '], [/ (FASE \d|F\d) /g, ' '], [/ (PERFILACAO|PERFILAGEM) /g, ' PERFIL '], [/ COB /g, ' COBERTURA '], [/ ESTRUT /g, ' ESTRUTURA '],
    [/ TELHAR /g, ' INST TELHA '], [/ (METALICA|METALICAS|METALICO|METALICOS) /g, ' ']].forEach(([re, por]) => { s = s.replace(re, por).replace(re, por); });
  const out = new Set();
  s.split(' ').forEach(t => {
    if (!t || CI_STOP.has(t)) return;
    if (t.length > 3 && t.endsWith('S') && !t.endsWith('SS')) t = t.slice(0, -1);
    out.add(t);
  });
  return out;
}
const ciInter = (a, b) => { let n = 0; a.forEach(x => { if (b.has(x)) n++; }); return n; };
// Nota de 0 a 1: quanto a atividade do arquivo (nome + grupos acima dela) explica a atividade do sistema (nome + frente/item) e vice-versa.
function ciNota(a, alvo) {
  if (!a._tn.size || !alvo.tAll.size) return 0;
  // cover: quanto da atividade do sistema aparece no arquivo (no nome vale 1; só nos grupos acima, 0,6);
  // nameCov: quanto do nome do arquivo aparece na atividade do sistema (palavra que identifica a atividade pesa o dobro das genéricas)
  let cv = 0; alvo.tAll.forEach(t => { cv += a._tn.has(t) ? 1 : a._tCtx.has(t) ? 0.6 : 0; });
  const cover = cv / alvo.tAll.size;
  let nc = 0, nt = 0; a._tn.forEach(t => { const w = CI_GENERICAS.has(t) ? 1 : 2; nt += w; if (alvo.tAll.has(t)) nc += w; });
  const nameCov = nc / nt;
  let s = 0.5 * cover + 0.5 * nameCov;
  if (a._nn === alvo.nn) s = Math.max(s, alvo.tCtx.size && !ciInter(alvo.tCtx, a._tAll) ? 0.8 : 1);
  if (alvo.tCtx.size && a._tCtx.size && !ciInter(alvo.tCtx, a._tAll)) s *= 0.7;   // frente/item do sistema não aparece em nada do arquivo
  // palavras que identificam a atividade (sem as genéricas): se nenhuma aparece do outro lado, é só o contexto que parece — não a atividade
  const essA = [...a._tn].filter(t => !CI_GENERICAS.has(t)), essB = [...alvo.tn].filter(t => !CI_GENERICAS.has(t));
  if (essB.length) s *= 0.5 + 0.5 * essB.filter(t => a._tAll.has(t)).length / essB.length;
  if (essA.length && !essA.some(t => alvo.tAll.has(t))) s *= 0.6;
  if (CI_ACOES.some(x => a._tAll.has(x) !== alvo.tAll.has(x) && (a._tn.has(x) || alvo.tn.has(x)))) s *= 0.4;
  const pa = anexoPredio([...(a.grupo || []).slice(-3), a.nome].join(' ')), pb = anexoPredio(alvo.ctx + ' ' + alvo.nome);
  if (pa !== pb && (pa || pb)) s *= 0.5;   // prédios diferentes (Portaria × Refeitório, anexo × galpão)
  return Math.min(1, s);
}

function ciMontarAlvos() {
  const alvos = [], fa = faseFiltro, ci = M.cronograma_importado, subst = ci && ci.substituir;
  let itens = [];
  try { faseFiltro = ''; if (subst) ci.substituir = false; itens = ganItensCliente(); } finally { faseFiltro = fa; if (subst) ci.substituir = true; }
  itens.forEach(it => {
    const chave = ganDataKey(it);
    if (alvos.some(x => x.v === 'L|' + chave)) return;
    alvos.push({ tipo: 'linha', v: 'L|' + chave, chave, nome: it.servico_exib || it.servico, ctx: it.frente || '', rot: `${it.frente || 'SEM FRENTE'} · ${cap(it.servico)}` });
  });
  const cat = new Map();
  bmTab('bm_atividades').forEach(a => {
    const k = ganImpChaveAtiv(a.codigo);
    const o = cat.get(k) || { tipo: 'bm', v: 'B|' + k, chave: k, nome: a.atividade || '', ctx: a.item_desc || '', emps: [], un: a.unidade || '' };
    if (!o.emps.includes(a.empresa)) o.emps.push(a.empresa);
    cat.set(k, o);
  });
  cat.forEach(o => { o.rot = `${o.chave} · ${o.nome} — ${o.ctx} (${o.emps.join(', ')})`; alvos.push(o); });
  alvos.forEach(x => { x.tn = ciTokens(x.nome); x.tCtx = ciTokens(x.ctx); x.tAll = new Set([...x.tn, ...x.tCtx]); x.nn = ganNorm(x.nome); });
  CI.alvos = alvos;
  CI.porChave = new Map(alvos.map(x => [x.v, x]));
  const op = x => `<option value="${esc(x.v)}">${esc(x.rot)}</option>`;
  CI.opcoesCat = alvos.filter(x => x.tipo === 'bm').map(op).join('');
  CI.opcoes = `<optgroup label="Atividades do cronograma atual (com leitura dos lançamentos)">${alvos.filter(x => x.tipo === 'linha').map(op).join('')}</optgroup>` +
    (CI.opcoesCat ? `<optgroup label="Catálogo de atividades (Lançamentos / BM)">${CI.opcoesCat}</optgroup>` : '');
}

function ciPreparar(a) {
  a._tn = ciTokens(a.nome);
  a._tCtx = ciTokens((a.grupo || []).slice(-3).join(' '));
  a._tAll = new Set([...a._tn, ...a._tCtx]);
  a._nn = ganNorm(a.nome);
  const notas = CI.alvos.map(x => ({ v: x.v, nota: ciNota(a, x) })).filter(s => s.nota >= 0.3).sort((p, q) => q.nota - p.nota);
  const L = notas.filter(s => s.v.startsWith('L|')).slice(0, 3), B = notas.filter(s => s.v.startsWith('B|')).slice(0, 3);
  // a atividade que já está no cronograma atual vem antes da do catálogo: ela já sabe de onde ler o realizado (lançamentos, BM, apontamentos)
  const preferL = L[0] && (L[0].nota >= 0.65 || !B[0] || L[0].nota >= B[0].nota - 0.1);
  a._sug = preferL ? [...L, ...B] : [...B, ...L];
}
function ciSugerir(a) {
  const m = a._sug[0];
  if (a.resumo) return { tipo: 'ignorar', chave: '', cods: [], auto: true, nota: 0 };   // grupo (resumo) não é atividade: fica de fora, a não ser que a pessoa escolha
  if (m && m.nota >= CI_MIN) return ciVinculoDe(m.v, true, m.nota);
  return { tipo: 'nova', chave: '', cods: [], auto: true, nota: 0 };
}
function ciVinculoDe(valor, auto, nota) {
  if (valor === 'N') return { tipo: 'nova', chave: '', cods: [], auto: !!auto, nota: 0 };
  if (valor === 'X') return { tipo: 'ignorar', chave: '', cods: [], auto: !!auto, nota: 0 };
  const chave = valor.slice(2);
  return valor.startsWith('L|') ? { tipo: 'linha', chave, cods: [], auto: !!auto, nota: nota || 0 } : { tipo: 'bm', chave: '', cods: [chave], auto: !!auto, nota: nota || 0 };
}
const ciValor = v => v.tipo === 'linha' ? 'L|' + v.chave : v.tipo === 'bm' ? 'B|' + (v.cods[0] || '') : v.tipo === 'nova' ? 'N' : 'X';
const ciChaveMem = a => ganNorm((a.grupo || []).slice(-2).join(' ') + ' | ' + a.nome);

// lidas = atividades vindas do servidor (arquivo novo) ou as já salvas (reabrir a conciliação)
function ciAbrir(dados, novo) {
  ciMontarAlvos();
  const ant = M.cronograma_importado && Array.isArray(M.cronograma_importado.atividades) ? M.cronograma_importado : null;
  const mem = new Map();
  if (novo && ant) ant.atividades.forEach(a => { if (a.vinculo && !a.vinculo.auto) mem.set(ciChaveMem(a), a.vinculo); });
  CI.novo = !!novo;
  CI.arquivo = dados.arquivo || '';
  CI.formato = dados.formato || '';
  CI.avisos = dados.avisos || [];
  CI.substituir = novo ? !!(ant && ant.substituir) : !!dados.substituir;
  CI.filtro = 'todas'; CI.busca = ''; CI.verResumos = false;
  CI.atividades = (dados.atividades || []).map((a0, i) => {
    const a = { n: a0.n || a0.id || i + 1, item: a0.item || '', nome: a0.nome || '', grupo: a0.grupo || [], inicio: a0.inicio, fim: a0.fim, dias: a0.dias || 0, qtd: a0.qtd ?? null, un: a0.un || '', resumo: !!a0.resumo };
    ciPreparar(a);
    if (!novo && a0.vinculo) a.v = { tipo: a0.vinculo.tipo, chave: a0.vinculo.chave || '', cods: [...(a0.vinculo.cods || [])], auto: !!a0.vinculo.auto, nota: Number(a0.vinculo.nota) || 0 };
    else if (mem.has(ciChaveMem(a))) { const v = mem.get(ciChaveMem(a)); a.v = { tipo: v.tipo, chave: v.chave || '', cods: [...(v.cods || [])], auto: false, nota: 0, mantido: true }; }
    else a.v = ciSugerir(a);
    return a;
  });
  let dlg = document.getElementById('ciDlg');
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.id = 'ciDlg';
    dlg.className = 'ci-dlg';
    document.body.appendChild(dlg);
    dlg.addEventListener('cancel', ev => { ev.preventDefault(); ciFechar(); });
    dlg.addEventListener('click', ciClique);
    dlg.addEventListener('change', ciMudou);
    dlg.addEventListener('input', ev => { if (ev.target.id === 'ciBusca') { CI.busca = ev.target.value; ciRenderLinhas(); } });
    ['pointerdown', 'focusin', 'keydown'].forEach(t => dlg.addEventListener(t, ev => { const s = ev.target.closest && ev.target.closest('select[data-ci-sel]'); if (s) ciEncherSelect(s); }));
  }
  CI.sujo = !!novo;
  ciRender();
  if (!dlg.open) dlg.showModal();
}
function ciFechar(forcar) {
  const dlg = document.getElementById('ciDlg');
  if (!dlg) return;
  if (!forcar && CI.sujo && !confirm(CI.novo ? 'Fechar sem salvar? O cronograma lido não será incluído.' : 'Fechar sem salvar as alterações dos vínculos?')) return;
  dlg.close();
  dlg.innerHTML = '';
}

function ciSituacao(a) {
  const v = a.v, pct = v.nota ? ' ' + Math.round(v.nota * 100) + '%' : '';
  if (v.tipo === 'ignorar') return ['pendente', a.resumo && v.auto ? 'GRUPO (RESUMO)' : 'NÃO IMPORTAR'];
  if (v.tipo === 'nova') return ['pendente', 'SEM LEITURA'];
  if (v.mantido) return ['verde', 'MANTIDO'];
  if (!v.auto) return ['verde', 'MANUAL'];
  return v.nota >= CI_ALTA ? ['verde', 'SUGERIDO' + pct] : ['amarelo', 'CONFERIR' + pct];
}
const ciConferir = a => (a.v.auto && !a.resumo && (a.v.tipo === 'nova' || ((a.v.tipo === 'linha' || a.v.tipo === 'bm') && a.v.nota < CI_ALTA)));
function ciPassa(a) {
  if (a.resumo && !CI.verResumos && a.v.tipo === 'ignorar') return false;
  if (CI.busca) { const b = ganNorm(CI.busca); if (!ganNorm(a.nome + ' ' + (a.grupo || []).join(' ') + ' ' + ciRotuloVinculo(a)).includes(b)) return false; }
  if (CI.filtro === 'conferir') return ciConferir(a);
  if (CI.filtro === 'vinc') return a.v.tipo === 'linha' || a.v.tipo === 'bm';
  if (CI.filtro === 'nova') return a.v.tipo === 'nova';
  if (CI.filtro === 'ign') return a.v.tipo === 'ignorar';
  return true;
}
function ciRotuloVinculo(a) {
  const v = a.v;
  if (v.tipo === 'nova') return 'Incluir como atividade nova (sem leitura)';
  if (v.tipo === 'ignorar') return 'Não importar';
  const x = CI.porChave.get(ciValor(v));
  return x ? x.rot : (v.tipo === 'linha' ? v.chave : v.cods[0]) + ' (não encontrada no sistema)';
}
function ciSelectHtml(a, i) {
  const atual = ciValor(a.v), sug = a._sug.filter(s => CI.porChave.has(s.v));
  let h = `<select data-ci-sel="${i}" class="ci-sel">`;
  if (atual !== 'N' && atual !== 'X' && !sug.some(s => s.v === atual)) h += `<option value="${esc(atual)}" selected>${esc(ciRotuloVinculo(a))}</option>`;
  if (sug.length) h += `<optgroup label="Sugestões pelo nome">${sug.map(s => `<option value="${esc(s.v)}" ${s.v === atual ? 'selected' : ''}>${Math.round(s.nota * 100)}% · ${esc(CI.porChave.get(s.v).rot)}</option>`).join('')}</optgroup>`;
  h += `<optgroup label="Sem vínculo"><option value="N" ${atual === 'N' ? 'selected' : ''}>Incluir como atividade nova (sem leitura)</option><option value="X" ${atual === 'X' ? 'selected' : ''}>Não importar</option></optgroup></select>`;
  if (a.v.tipo === 'bm') {
    h += `<div class="ci-extra">${a.v.cods.slice(1).map((c, k) => `<span class="ci-chip" title="${esc(CI.porChave.get('B|' + c)?.rot || c)}">+ ${esc(c)} <button type="button" data-ci-tira="${i}" data-k="${k + 1}" title="Tirar">×</button></span>`).join('')}
      <button type="button" class="btn-link" data-ci-mais="${i}" title="A atividade do cronograma corresponde a mais de uma atividade do catálogo">+ somar outra atividade do catálogo</button></div>`;
  }
  return h;
}
function ciEncherSelect(s) {
  if (s.dataset.cheio || !('ciSel' in s.dataset)) return;
  s.dataset.cheio = '1';
  const v = s.value;
  s.insertAdjacentHTML('beforeend', CI.opcoes);
  s.value = v;
}
function ciLinhaHtml(a, i) {
  const [cor, rot] = ciSituacao(a), mesma = a.v.tipo === 'linha' ? CI.atividades.filter(b => b.v.tipo === 'linha' && b.v.chave === a.v.chave).length : 0;
  return `<tr data-ci-linha="${i}" class="${a.resumo ? 'ci-resumo' : ''}">
    <td class="n">${a.n}</td>
    <td><b>${esc(a.nome)}</b>${a.resumo ? ' <span class="nota">(grupo)</span>' : ''}${(a.grupo || []).length ? `<div class="nota">${esc(a.grupo.slice(-3).join(' › '))}</div>` : ''}</td>
    <td>${fdA(a.inicio)}</td><td>${fdA(a.fim)}</td><td class="n">${a.dias || ''}</td>
    <td class="ci-vinc">${ciSelectHtml(a, i)}${mesma > 1 ? `<div class="nota">${mesma} atividades do arquivo nesta linha: vale do primeiro início ao último término.</div>` : ''}</td>
    <td><span class="farol f-${cor}">${rot}</span></td></tr>`;
}
function ciContagem() {
  const c = { total: CI.atividades.length, linha: 0, bm: 0, nova: 0, ignorar: 0, conferir: 0 };
  CI.atividades.forEach(a => { c[a.v.tipo]++; if (ciConferir(a)) c.conferir++; });
  return c;
}
function ciRenderLinhas() {
  const tb = document.getElementById('ciCorpo');
  if (!tb) return;
  const linhas = CI.atividades.map((a, i) => ciPassa(a) ? ciLinhaHtml(a, i) : '').join('');
  tb.innerHTML = linhas || '<tr><td colspan="7" class="vazio">Nenhuma atividade neste filtro.</td></tr>';
  ciRenderResumo();
}
function ciRenderResumo() {
  const c = ciContagem(), el = document.getElementById('ciResumo');
  if (el) el.innerHTML = [['todas', 'Lidas', c.total], ['vinc', 'Vinculadas (com leitura)', c.linha + c.bm], ['conferir', 'A conferir', c.conferir], ['nova', 'Novas sem leitura', c.nova], ['ign', 'Não importar', c.ignorar]]
    .map(([k, r, n]) => `<button type="button" data-ci-filtro="${k}" class="${CI.filtro === k ? 'ativa' : ''}">${r} <b>${n}</b></button>`).join('');
  const bs = document.getElementById('ciSalvar');
  if (bs) bs.textContent = `Salvar cronograma (${c.linha + c.bm + c.nova} atividade(s) no Gantt)`;
}
function ciRender() {
  const dlg = document.getElementById('ciDlg'), ant = M.cronograma_importado, temSalvo = !!(ant && (ant.atividades || []).length);
  dlg.innerHTML = `<div class="ci-cab"><div><h2>Conciliar cronograma importado</h2>
      <span class="nota">${esc(CI.arquivo)}${CI.formato ? ' · ' + esc(CI.formato) : ''} · ${CI.novo ? 'arquivo lido agora (ainda não salvo)' : 'cronograma em uso'}</span></div>
      <button type="button" class="btn" data-ci-fechar>Fechar</button></div>
    <div class="ci-topo">
      <p class="nota">Cada atividade do arquivo precisa apontar para a atividade do sistema que tem a <b>leitura</b> (o que é lançado em produção ou no catálogo). O sistema sugere pelo nome; quando o nome for diferente, escolha na lista da coluna <b>Vincular a</b>. Vinculada a uma atividade do cronograma atual = as datas dela passam a ser as do arquivo. Vinculada ao catálogo = linha nova no Gantt com o avanço lido dos lançamentos. Sem vínculo = entra só com o previsto.</p>
      ${CI.avisos.map(x => `<p class="ci-aviso">${esc(x)}</p>`).join('')}
      <div class="ci-barra"><div class="seg" id="ciResumo"></div>
        <input type="search" id="ciBusca" placeholder="Buscar atividade…" value="${esc(CI.busca)}">
        <label class="check"><input type="checkbox" id="ciVerResumos" ${CI.verResumos ? 'checked' : ''}> Mostrar grupos (resumos)</label></div>
      <div class="ci-barra"><span class="nota">Atividades sem vínculo:</span>
        <button type="button" class="btn" data-ci-lote="N">Incluir todas como novas</button>
        <button type="button" class="btn" data-ci-lote="X">Não importar nenhuma</button>
        <label class="check" title="As linhas fixas do cronograma padrão do sistema que não receberam vínculo deixam de aparecer (Gantt, Planejamento e demais telas)."><input type="checkbox" id="ciSubstituir" ${CI.substituir ? 'checked' : ''}> Ocultar as atividades do cronograma padrão que não foram vinculadas</label></div>
    </div>
    <div class="ci-tab"><table data-sem-ferramentas data-sem-limite><thead><tr><th class="n">#</th><th>Atividade do cronograma importado</th><th>Início</th><th>Término</th><th class="n" title="Dias úteis">Dias</th><th>Vincular a (atividade com leitura)</th><th>Situação</th></tr></thead><tbody id="ciCorpo"></tbody></table></div>
    <div class="ci-rodape">${temSalvo ? '<button type="button" class="btn perigo" data-ci-remover>Remover cronograma importado</button>' : '<span></span>'}
      <span><button type="button" class="btn" data-ci-fechar>Cancelar</button> <button type="button" class="btn primario" id="ciSalvar" data-ci-salvar>Salvar cronograma</button></span></div>`;
  ciRenderLinhas();
}
function ciAtualizarLinha(i) {
  const tr = document.querySelector(`#ciCorpo tr[data-ci-linha="${i}"]`);
  if (tr && ciPassa(CI.atividades[i])) tr.outerHTML = ciLinhaHtml(CI.atividades[i], i);
  else if (tr) tr.remove();
  ciRenderResumo();
}
function ciMudou(ev) {
  const t = ev.target;
  if (t.id === 'ciVerResumos') { CI.verResumos = t.checked; ciRenderLinhas(); return; }
  if (t.id === 'ciSubstituir') { CI.substituir = t.checked; CI.sujo = true; return; }
  if (t.dataset.ciSel != null) {
    const i = +t.dataset.ciSel, a = CI.atividades[i], antes = a.v.tipo === 'linha' ? a.v.chave : null;
    a.v = ciVinculoDe(t.value, false, 0);
    CI.sujo = true;
    if (antes || a.v.tipo === 'linha') ciRenderLinhas(); else ciAtualizarLinha(i);   // a nota "N atividades nesta linha" muda nas outras linhas
    return;
  }
  if (t.dataset.ciSoma != null) {
    const a = CI.atividades[+t.dataset.ciSoma], c = t.value.slice(2);
    if (c && !a.v.cods.includes(c)) { a.v.cods.push(c); a.v.auto = false; CI.sujo = true; }
    ciAtualizarLinha(+t.dataset.ciSoma);
  }
}
let ciRemoverArmado = 0;
function ciClique(ev) {
  const b = ev.target.closest('button');
  if (!b) return;
  if (b.dataset.ciFechar != null) return ciFechar();
  if (b.dataset.ciFiltro) { CI.filtro = b.dataset.ciFiltro; ciRenderLinhas(); return; }
  if (b.dataset.ciLote) {
    CI.atividades.forEach(a => { if (!a.resumo && (a.v.tipo === 'nova' || (a.v.tipo === 'ignorar'))) a.v = ciVinculoDe(b.dataset.ciLote, false, 0); });
    CI.sujo = true; ciRenderLinhas(); return;
  }
  if (b.dataset.ciMais != null) { b.outerHTML = `<select data-ci-soma="${b.dataset.ciMais}" class="ci-sel"><option value="">Escolha a atividade do catálogo…</option>${CI.opcoesCat}</select>`; return; }
  if (b.dataset.ciTira != null) { const a = CI.atividades[+b.dataset.ciTira]; a.v.cods.splice(+b.dataset.k, 1); a.v.auto = false; CI.sujo = true; ciAtualizarLinha(+b.dataset.ciTira); return; }
  if (b.dataset.ciSalvar != null) return ciSalvar(b);
  if (b.dataset.ciRemover != null) {
    if (Date.now() - ciRemoverArmado > 6000) { ciRemoverArmado = Date.now(); b.textContent = 'Confirmar: remover e voltar ao cronograma anterior'; return; }
    ciRemoverArmado = 0;
    b.disabled = true;
    postar(API + 'cronograma-importado', { remover: true }).then(async () => { ciFechar(true); await carregar(); toast('Cronograma importado removido. O Gantt voltou às datas anteriores.'); })
      .catch(e => { b.disabled = false; toast(e.message, true); });
  }
}
async function ciSalvar(btn) {
  const c = ciContagem();
  if (!(c.linha + c.bm + c.nova)) { toast('Nenhuma atividade marcada para entrar no Gantt.', true); return; }
  btn.disabled = true;
  try {
    const r = await postar(API + 'cronograma-importado', { arquivo: CI.arquivo, formato: CI.formato, substituir: CI.substituir,
      atividades: CI.atividades.map(a => ({ item: a.item, nome: a.nome, grupo: a.grupo, inicio: a.inicio, fim: a.fim, dias: a.dias, qtd: a.qtd, un: a.un, resumo: a.resumo,
        vinculo: { tipo: a.v.tipo, chave: a.v.chave, cods: a.v.cods, auto: !!a.v.auto, nota: a.v.nota || 0 } })) });
    ciFechar(true);
    ganEst.rolou = false;
    await carregar();
    toast(`Cronograma salvo: ${r.linha || 0} atividade(s) com datas atualizadas, ${r.bm || 0} ligada(s) ao catálogo e ${r.nova || 0} nova(s) sem leitura.`);
  } catch (e) { btn.disabled = false; toast(e.message, true); }
}

async function ciEnviarArquivo(arq) {
  if (!arq) return;
  if (arq.size > 30 * 1048576) { toast('Arquivo maior que 30 MB.', true); return; }
  const btn = document.getElementById('btnGanImportar'), rot = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Lendo o cronograma…'; }
  try {
    const r = await fetch('cronograma_importar.php?acao=ler&nome=' + encodeURIComponent(arq.name), { method: 'POST', headers: { 'X-CSRF-Token': window.CSRF_TOKEN || '', 'Content-Type': 'application/octet-stream' }, body: arq });
    if (r.status === 401) { location.href = 'login.php'; return; }
    const j = await r.json().catch(() => ({ erro: 'Resposta inválida do servidor.' }));
    if (!r.ok) throw new Error(j.erro || 'Não consegui ler o arquivo.');
    ciAbrir(j, true);
  } catch (e) { toast(e.message, true, 9000); }
  finally { if (btn) { btn.disabled = false; btn.textContent = rot; } }
}

// Barra da aba: botão de conciliar e o resumo do cronograma em uso
function ciAtualizarBarra() {
  const bi = document.getElementById('btnGanImportar'), bc = document.getElementById('btnGanConciliar'), info = document.getElementById('ganImpInfo');
  if (!bi || !bc || !info) return;
  const restrito = !!window.USUARIO_RESTRITO, leitura = document.body.classList.contains('somente-leitura') || (D && D.usuario && D.usuario.perfil === 'leitura');
  bi.hidden = restrito || leitura;
  const ci = typeof ganImp === 'function' ? ganImp() : null;
  bc.hidden = !ci || restrito || leitura;
  info.hidden = !ci;
  if (ci) {
    const n = t => ci.atividades.filter(a => a.vinculo && a.vinculo.tipo === t).length;
    info.innerHTML = `<i class="g-imp">⇄</i> Cronograma importado: <b>${esc(ci.arquivo || 'arquivo')}</b> em ${fdA(String(ci.aplicado_em || '').slice(0, 10))}${ci.por ? ' por ' + esc(ci.por) : ''} · ${n('linha')} atividade(s) com as datas do arquivo · ${n('bm')} ligada(s) ao catálogo · ${n('nova')} sem leitura${ci.substituir ? ' · atividades padrão sem vínculo ocultas' : ''}`;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const bi = document.getElementById('btnGanImportar'), arq = document.getElementById('ganImpArquivo'), bc = document.getElementById('btnGanConciliar');
  if (bi && arq) {
    bi.addEventListener('click', () => { arq.value = ''; arq.click(); });
    arq.addEventListener('change', () => ciEnviarArquivo(arq.files[0]));
  }
  if (bc) bc.addEventListener('click', () => { const ci = ganImp(); if (ci) ciAbrir(ci, false); });
});
