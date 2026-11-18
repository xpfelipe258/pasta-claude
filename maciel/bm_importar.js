// Pop-up "Importar orçamento" da aba Financeiro › Medição (BM).
// Fluxo: escolher a empresa (já cadastrada ou nova, com nome e sigla) → enviar a planilha de orçamento/medição (ou escolher uma
// proposta comercial válida) → o sistema LÊ o documento inteiro e mostra a prévia (itens, atividades, quantidades, valores,
// cortes de BM e avisos) → "Gerar catálogo e produção" grava o catálogo do BM e cria uma coluna de produção em Lançamentos
// para cada atividade (ligada pelo campo controle). Servidor: obra_empresas.php (ajax=1, ações dados/previa/aplicar).
(function () {
  const BI = { emps: [], props: [], arq: null, previa: null };
  const rsBI = v => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const qtdBI = v => Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
  const e = v => (typeof esc === 'function' ? esc(v) : String(v ?? ''));

  async function post(campos) {
    const fd = new FormData();
    fd.append('ajax', '1');
    fd.append('csrf', window.CSRF_TOKEN || '');
    fd.append('obra', String((window.OBRA_ATUAL || {}).id || ''));
    Object.entries(campos).forEach(([k, v]) => { if (v !== undefined && v !== null) fd.append(k, v); });
    const r = await fetch('obra_empresas.php', { method: 'POST', body: fd, headers: { 'X-CSRF-Token': window.CSRF_TOKEN || '' } });
    let j = null;
    try { j = await r.json(); } catch (_) { throw new Error('Resposta inválida do servidor (' + r.status + '). Recarregue a página e tente de novo.'); }
    if (!j.ok) throw new Error(j.erro || 'Falha ao importar.');
    return j;
  }

  function dlg() {
    let d = document.getElementById('dlgBmImp');
    if (d) return d;
    d = document.createElement('dialog');
    d.id = 'dlgBmImp';
    d.className = 'bmimp-dlg';
    document.body.appendChild(d);
    d.addEventListener('click', onClick);
    d.addEventListener('change', onChange);
    return d;
  }

  function lerForm(d) {
    const v = n => (d.querySelector(`[name="${n}"]`) || {}).value || '';
    const c = n => !!(d.querySelector(`[name="${n}"]`) || {}).checked;
    return { emp: v('empresa_id'), nome: v('nome').trim(), prefixo: v('prefixo').trim(), modo: (d.querySelector('[name="modo"]:checked') || {}).value || 'planilha',
      orc: v('orc_id'), colunas: c('criar_colunas'), cortes: c('importar_cortes') };
  }

  function passo1() {
    const d = dlg();
    const optEmp = BI.emps.map(x => `<option value="${x.id}" data-pref="${e(x.prefixo || '')}">${e(x.nome)} (${x.atividades} atividade(s) no catálogo)</option>`).join('');
    const optProp = BI.props.map(p => `<option value="${p.id}">${e(p.rotulo)}</option>`).join('');
    d.innerHTML = `<form method="dialog" class="bmimp">
      <h3>Importar orçamento para a medição</h3>
      <p class="sub">Envie a planilha de orçamento/medição. O sistema lê o documento inteiro, mostra o que encontrou e, ao confirmar,
        monta o <b>catálogo do BM</b> e as <b>colunas de produção em Lançamentos</b> de cada atividade.</p>
      <div class="bmimp-passos"><span class="on">1 · Documento</span><span>2 · Conferir leitura</span><span>3 · Pronto</span></div>
      <label>Empresa executora
        <select name="empresa_id"><option value="">+ Cadastrar empresa nova</option>${optEmp}</select></label>
      <div class="bmimp-nova">
        <label>Nome da empresa <input name="nome" maxlength="30" placeholder="Ex.: EJ MONTAGENS"></label>
        <label>Sigla (prefixo dos códigos) <input name="prefixo" maxlength="10" placeholder="Ex.: EJ" style="text-transform:uppercase"></label>
      </div>
      <fieldset><legend>Documento</legend>
        <label class="bmimp-op"><input type="radio" name="modo" value="planilha" checked> Planilha de orçamento / medição (.xlsx)</label>
        <div class="bmimp-arq"><input type="file" name="planilha" accept=".xlsx,.xlsm"></div>
        <label class="bmimp-op"><input type="radio" name="modo" value="proposta" ${optProp ? '' : 'disabled'}> Proposta comercial válida ${optProp ? '' : '<small>(nenhuma proposta aprovada ou dentro da validade no Painel comercial)</small>'}</label>
        <div class="bmimp-prop" hidden><select name="orc_id">${optProp}</select></div>
      </fieldset>
      <label class="bmimp-op"><input type="checkbox" name="criar_colunas" checked> Criar uma coluna de produção em Lançamentos para cada atividade (recomendado)</label>
      <label class="bmimp-op bmimp-so-plan"><input type="checkbox" name="importar_cortes" checked> Trazer as datas de corte dos BMs que estiverem na planilha</label>
      <p class="bmimp-erro" hidden></p>
      <div class="bmimp-acoes"><button type="button" class="btn" data-bi="fechar">Cancelar</button>
        <button type="button" class="btn primario" data-bi="ler">Ler documento →</button></div>
    </form>`;
    if (!d.open) d.showModal();
    ajustar();
  }

  function ajustar() {
    const d = dlg(), f = lerForm(d);
    const nova = d.querySelector('.bmimp-nova');
    if (nova) nova.hidden = !!f.emp;
    const pref = d.querySelector('[name="prefixo"]');
    if (f.emp && pref) { const o = d.querySelector(`[name="empresa_id"] option[value="${f.emp}"]`); pref.value = o ? o.dataset.pref : ''; }
    const ehProp = f.modo === 'proposta';
    const a = d.querySelector('.bmimp-arq'), p = d.querySelector('.bmimp-prop'), c = d.querySelector('.bmimp-so-plan'), b = d.querySelector('[data-bi="ler"]');
    if (a) a.hidden = ehProp;
    if (p) p.hidden = !ehProp;
    if (c) c.hidden = ehProp;
    if (b) b.textContent = ehProp ? 'Gerar catálogo e produção' : 'Ler documento →';
  }

  function erro(msg) {
    const p = dlg().querySelector('.bmimp-erro');
    if (p) { p.textContent = msg; p.hidden = !msg; }
  }

  function ocupado(btn, txt) { if (btn) { btn.disabled = true; btn.dataset.txt = btn.textContent; btn.textContent = txt; } }
  function livre(btn) { if (btn) { btn.disabled = false; btn.textContent = btn.dataset.txt || btn.textContent; } }

  async function ler(btn) {
    const d = dlg(), f = lerForm(d);
    erro('');
    if (!f.emp && !f.nome) return erro('Informe o nome da empresa executora (e a sigla).');
    if (!f.emp && !f.prefixo) return erro('Informe a sigla da empresa: ela vira o prefixo dos códigos do catálogo (ex.: EJ-3.1.1-01).');
    BI.form = f;
    if (f.modo === 'proposta') {
      if (!f.orc) return erro('Escolha a proposta.');
      return aplicar(btn);
    }
    const inp = d.querySelector('[name="planilha"]');
    BI.arq = inp && inp.files && inp.files[0];
    if (!BI.arq) return erro('Escolha a planilha de orçamento/medição (.xlsx).');
    ocupado(btn, 'Lendo o documento…');
    try {
      BI.previa = await post({ acao: 'previa', empresa_id: f.emp, nome: f.nome, prefixo: f.prefixo, planilha: BI.arq });
      passo2();
    } catch (x) { erro(x.message); livre(btn); }
  }

  function passo2() {
    const d = dlg(), p = BI.previa, f = BI.form;
    const linhas = p.itens.map(it => `<tr class="grupo"><td><b>${e(it.codigo)}</b></td><td colspan="3"><b>${e(it.descricao)}</b></td><td class="num"><b>${rsBI(it.valor)}</b></td></tr>` +
      it.atividades.map(a => `<tr${a.existe ? ' class="bmimp-rep"' : ''}><td>${e(a.codigo)}${a.existe ? ' <small>(já existe)</small>' : ''}</td><td>${e(a.descricao)}</td><td class="num">${qtdBI(a.qtd)} ${e(a.unidade)}</td><td class="num">${(a.peso * 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%</td><td class="num">${rsBI(a.valor)}</td></tr>`).join('')).join('');
    const cortes = p.periodos && p.periodos.length ? p.periodos.map(x => `BM${x.bm}: ${e(x.corte)}`).join(' · ') : 'nenhum';
    d.innerHTML = `<div class="bmimp">
      <h3>Conferir a leitura — ${e(BI.arq.name)}</h3>
      <div class="bmimp-passos"><span>1 · Documento</span><span class="on">2 · Conferir leitura</span><span>3 · Pronto</span></div>
      <div class="bmimp-cards">
        <div><small>Itens</small><b>${p.itens.length}</b></div>
        <div><small>Atividades</small><b>${p.atividades}</b></div>
        <div><small>Valor dos itens</small><b>${rsBI(p.total)}</b></div>
        <div><small>Cortes de BM</small><b>${p.periodos ? p.periodos.length : 0}</b></div>
      </div>
      <p class="sub">Empresa: <b>${e(f.emp ? (BI.emps.find(x => String(x.id) === f.emp) || {}).nome : f.nome)}</b> · códigos <b>${e(p.prefixo)}-item-nn</b> · cortes: ${cortes}</p>
      ${p.avisos.length ? `<ul class="bmimp-avisos">${p.avisos.map(a => `<li>${e(a)}</li>`).join('')}</ul>` : ''}
      <div class="bmimp-tab"><table data-sem-ferramentas><thead><tr><th>Código</th><th>Atividade</th><th>Quantidade</th><th>Peso no item</th><th>Valor</th></tr></thead><tbody>${linhas}</tbody></table></div>
      <p class="sub">Ao confirmar: ${p.atividades} atividade(s) entram no catálogo do BM${f.colunas ? ' e cada uma ganha uma coluna de produção em Lançamentos' : ''}${f.cortes ? ', com os cortes de BM lidos' : ''}. A produção lançada em cada coluna vai direto para a medição.</p>
      <p class="bmimp-erro" hidden></p>
      <div class="bmimp-acoes"><button type="button" class="btn" data-bi="voltar">← Trocar documento</button>
        <button type="button" class="btn primario" data-bi="aplicar">Gerar catálogo e produção</button></div>
    </div>`;
  }

  async function aplicar(btn) {
    const f = BI.form;
    erro('');
    ocupado(btn, 'Gerando catálogo e produção…');
    try {
      const r = await post({ acao: 'aplicar', modo: f.modo, empresa_id: f.emp, nome: f.nome, prefixo: f.prefixo, orc_id: f.orc,
        criar_colunas: f.colunas ? '1' : '', importar_cortes: f.cortes ? '1' : '', planilha: f.modo === 'planilha' ? BI.arq : null });
      passo3(r.resumo || {});
      if (typeof carregar === 'function') { try { await carregar(); } catch (_) { } }
    } catch (x) { erro(x.message); livre(btn); }
  }

  function passo3(r) {
    const d = dlg();
    d.innerHTML = `<div class="bmimp">
      <h3>Pronto — ${e(r.empresa || '')}</h3>
      <div class="bmimp-passos"><span>1 · Documento</span><span>2 · Conferir leitura</span><span class="on">3 · Pronto</span></div>
      <div class="bmimp-cards">
        <div><small>Atividades no catálogo</small><b>${r.atividades || 0}</b></div>
        <div><small>Colunas de produção</small><b>${r.servicos || 0}</b></div>
        <div><small>Cortes de BM</small><b>${r.periodos || 0}</b></div>
      </div>
      ${(r.avisos || []).length ? `<ul class="bmimp-avisos">${r.avisos.map(a => `<li>${e(a)}</li>`).join('')}</ul>` : ''}
      <p class="sub">Próximo passo: lance a produção do dia em <b>Lançamentos</b>. O avanço aparece sozinho aqui na Medição (BM).</p>
      <div class="bmimp-acoes"><button type="button" class="btn" data-bi="fechar">Ficar na Medição</button>
        <button type="button" class="btn primario" data-bi="lanc">Ir para Lançamentos</button></div>
    </div>`;
  }

  function onChange(ev) { if (ev.target.matches('[name="empresa_id"], [name="modo"]')) ajustar(); }

  function onClick(ev) {
    const b = ev.target.closest('[data-bi]');
    if (!b) return;
    const a = b.dataset.bi;
    if (a === 'fechar') dlg().close();
    else if (a === 'ler') ler(b);
    else if (a === 'voltar') passo1();
    else if (a === 'aplicar') aplicar(b);
    else if (a === 'lanc') { dlg().close(); if (typeof mudarAba === 'function') mudarAba('lanc'); }
  }

  async function abrir(ev) {
    if (ev) ev.preventDefault();
    try {
      const j = await post({ acao: 'dados' });
      BI.emps = j.empresas || [];
      BI.props = j.propostas || [];
      passo1();
    } catch (x) { if (typeof toast === 'function') toast(x.message, true); else alert(x.message); }
  }

  document.addEventListener('click', ev => { if (ev.target.closest('#btnBmImportarCat')) abrir(ev); });
  window.bmImportarAbrir = abrir;
})();
