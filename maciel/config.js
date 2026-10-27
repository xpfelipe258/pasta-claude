// ------------------------------------------------------------ CONFIGURAÇÕES (todos os usuários, inclusive somente leitura)
// Dados do próprio usuário (nome, e-mail), troca de senha, idioma, tamanho do texto, tema e posição do menu.
// Tudo vale só para o usuário logado; nada aqui altera dados de obra. Rota: configuracoes (api.php → acao_configuracoes).
const CFG = { dados: null, carregando: null };
const CFG_TEMAS = [['light', 'Branco'], ['dark', 'Preto'], ['space', 'Espacial'], ['nevoa', 'Névoa'], ['grafite', 'Grafite'], ['salvia', 'Sálvia'], ['', 'Automático']];
const CFG_PERFIS = { admin: 'Administrador', editor: 'Editor', leitura: 'Somente leitura' };

async function cfgCarregar(forcar) {
  if (CFG.dados && !forcar) return CFG.dados;
  if (!CFG.carregando) {
    CFG.carregando = fetch(API + 'configuracoes', { cache: 'no-store' })
      .then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.erro || 'Falha ao carregar'); return j; })
      .then(j => { CFG.dados = j; return j; })
      .finally(() => { CFG.carregando = null; });
  }
  return CFG.carregando;
}

function cfgForcaSenha(s) {
  let p = 0;
  if (s.length >= 8) p++;
  if (s.length >= 12) p++;
  if (/[a-z]/.test(s) && /[A-Z]/.test(s)) p++;
  if (/\d/.test(s)) p++;
  if (/[^A-Za-z0-9]/.test(s)) p++;
  return Math.min(4, Math.max(0, p - (s.length < 8 ? 1 : 0)));
}

function cfgAplicarAparencia(tema, menu, tam) {
  const el = document.documentElement;
  if (tema !== undefined) tema ? el.setAttribute('data-theme', tema) : el.removeAttribute('data-theme');
  if (menu !== undefined) menu === 'topo' ? el.setAttribute('data-menu', 'topo') : el.removeAttribute('data-menu');
  if (tam !== undefined) tam && tam !== 'normal' ? el.setAttribute('data-texto', tam) : el.removeAttribute('data-texto');
}

function cfgHtml(c) {
  const dataSenha = c.senha_alterada_em ? tx('Última troca de senha: {d}', { d: fdA(String(c.senha_alterada_em).slice(0, 10)) }) : '';
  const op = (nome, valor, rotulo, marcado, extra = '') => `<label class="cfg-op${marcado ? ' sel' : ''}">
      <input type="radio" name="${nome}" value="${esc(valor)}"${marcado ? ' checked' : ''}>${extra}<b>${esc(tx(rotulo))}</b></label>`;
  return `
  <div class="cfg-grade">
    <section class="bloco cfg-bloco">
      <div class="bloco-cab"><h2>${esc(tx('Meu perfil'))}</h2></div>
      <form id="cfgFormPerfil" class="cfg-form" autocomplete="off">
        <label>${esc(tx('Nome completo'))}<input type="text" name="nome" maxlength="80" required value="${esc(c.nome)}"></label>
        <label>${esc(tx('E-mail'))}<input type="email" name="email" maxlength="150" value="${esc(c.email)}" autocomplete="email"><small>${esc(tx('Usado para recuperar a senha.'))}</small></label>
        <label>${esc(tx('Login'))}<input type="text" value="${esc(c.login)}" disabled><small>${esc(tx('O login não pode ser alterado.'))}</small></label>
        <dl class="cfg-info">
          <dt>${esc(tx('Perfil de acesso'))}</dt><dd>${esc(tx(CFG_PERFIS[c.perfil] || c.perfil))}</dd>
          <dt>${esc(tx('Empresa'))}</dt><dd>${esc(c.empresa || '—')}</dd>
          <dt>${esc(tx('Obras com acesso'))}</dt><dd>${(c.obras || []).length ? c.obras.map(esc).join(', ') : '—'}</dd>
        </dl>
        <div class="cfg-acoes"><button type="submit" class="btn primario">${esc(tx('Salvar dados'))}</button><span class="nota" id="cfgMsgPerfil" role="status"></span></div>
      </form>
    </section>

    <section class="bloco cfg-bloco">
      <div class="bloco-cab"><h2>${esc(tx('Alterar senha'))}</h2></div>
      <form id="cfgFormSenha" class="cfg-form" autocomplete="off">
        <label>${esc(tx('Senha atual'))}<input type="password" name="atual" autocomplete="current-password" required></label>
        <label>${esc(tx('Nova senha'))}<input type="password" name="nova" id="cfgNova" minlength="8" maxlength="200" autocomplete="new-password" required></label>
        <div class="cfg-forca" id="cfgForca" aria-live="polite"><i></i><i></i><i></i><i></i><span></span></div>
        <label>${esc(tx('Confirmar nova senha'))}<input type="password" name="confirmar" autocomplete="new-password" required></label>
        <label class="cfg-check"><input type="checkbox" id="cfgVerSenha"> ${esc(tx('Mostrar senhas'))}</label>
        <small class="nota">${esc(tx('Mínimo de 8 caracteres. Use letras, números e símbolos.'))}${dataSenha ? ' · ' + esc(dataSenha) : ''}</small>
        <div class="cfg-acoes"><button type="submit" class="btn primario">${esc(tx('Alterar senha'))}</button><span class="nota" id="cfgMsgSenha" role="status"></span></div>
      </form>
    </section>

    <section class="bloco cfg-bloco cfg-largo">
      <div class="bloco-cab"><h2>${esc(tx('Idioma e texto'))}</h2></div>
      <form id="cfgFormPref" class="cfg-form">
        <div class="cfg-grupo"><b>${esc(tx('Idioma do sistema'))}</b>
          <div class="cfg-ops">
            ${[['pt-BR', 'Português (Brasil)'], ['en', 'English'], ['es', 'Español']].map(([v, r]) => `<label class="cfg-op${c.idioma === v ? ' sel' : ''}"><input type="radio" name="idioma" value="${v}"${c.idioma === v ? ' checked' : ''}><b>${v === 'pt-BR' ? 'Português (Brasil)' : r}</b></label>`).join('')}
          </div>
          <small class="nota">${esc(tx('Tradução do menu, barra superior, Configurações e Tutorial. As telas de dados e os relatórios continuam em português por enquanto.'))}</small>
        </div>
        <div class="cfg-grupo"><b>${esc(tx('Tamanho do texto'))}</b>
          <div class="cfg-ops">${[['normal', 'Normal'], ['grande', 'Grande'], ['maior', 'Maior']].map(([v, r]) => op('tam_texto', v, r, c.tam_texto === v)).join('')}</div>
        </div>
        <div class="cfg-grupo"><b>${esc(tx('Tema'))}</b>
          <div class="cfg-ops">${CFG_TEMAS.map(([v, r]) => op('tema', v, r, c.tema === v, `<span class="cfg-prev cfg-prev-${v === '' ? 'auto' : v}"><i></i><i></i><i></i></span>`)).join('')}</div>
        </div>
        <div class="cfg-grupo"><b>${esc(tx('Posição do menu'))}</b>
          <div class="cfg-ops">${[['lateral', 'Lateral'], ['topo', 'Barra superior']].map(([v, r]) => op('menu', v, r, c.menu === v, `<span class="cfg-menu cfg-menu-${v}"><i></i><i></i><i></i></span>`)).join('')}</div>
        </div>
        <div class="cfg-grupo"><b>${esc(tx('Avisos por e-mail'))}</b>
          <label class="cfg-check"><input type="checkbox" name="email_tarefas"${c.email_tarefas !== false ? ' checked' : ''}> ${esc(tx('Receber e-mail quando me enviarem uma tarefa, responderem uma tarefa ou escreverem na conversa dela'))}</label>
          <small class="nota">${c.email ? esc(tx('Os avisos vão para {e}.', { e: c.email })) : esc(tx('Você ainda não tem e-mail cadastrado: preencha em Meu perfil para receber os avisos.'))}</small>
        </div>
        <div class="cfg-acoes"><button type="submit" class="btn primario">${esc(tx('Salvar preferências'))}</button><span class="nota" id="cfgMsgPref" role="status"></span></div>
      </form>
    </section>

    ${cfgIdentidadeHtml(c)}

    <section class="bloco cfg-bloco cfg-largo">
      <div class="bloco-cab"><h2>${esc(tx('Tutorial e ajuda'))}</h2></div>
      <div class="cfg-acoes">
        <button type="button" class="btn" id="cfgAbrirTut">${esc(tx('Abrir o tutorial'))}</button>
        <button type="button" class="btn" id="cfgZerarTut">${esc(tx('Zerar meu progresso no tutorial'))}</button>
        <span class="nota" id="cfgMsgTut" role="status"></span>
      </div>
      <h3 class="cfg-sub">${esc(tx('Sessão'))}</h3>
      <p class="nota">${esc(tx('Você está conectado como {nome} ({login}).', { nome: c.nome, login: c.login }))}</p>
      <div class="cfg-acoes"><a class="btn" href="sair.php">${esc(tx('Sair do sistema'))}</a></div>
    </section>
  </div>`;
}

// ---- Identidade visual dos relatórios (logo e cor da empresa; o cliente continua sendo a Rótula)
function cfgIdentidadeHtml(c) {
  const idt = c.identidade || {}, emps = idt.empresas || [];
  if (!emps.length) return '';
  const emp = emps.includes(CFG.identEmp) ? CFG.identEmp : (emps.includes(String(c.empresa || '').toUpperCase()) ? String(c.empresa).toUpperCase() : emps[0]);
  CFG.identEmp = emp;
  const d = (idt.dados || {})[emp] || {};
  CFG.ident = { logo: d.logo || '', logoNovo: '', remover: false };
  return `<section class="bloco cfg-bloco cfg-largo" id="cfgIdent">
    <div class="bloco-cab"><h2>${esc(tx('Identidade visual dos relatórios'))}</h2></div>
    <form id="cfgFormIdent" class="cfg-form" autocomplete="off">
      <p class="nota">${esc(tx('O logo e a cor da empresa aparecem na capa dos relatórios, no lado da gestão. O cliente continua sendo a RÓTULA.'))}</p>
      ${emps.length > 1 ? `<label>${esc(tx('Empresa'))}<select name="empresa" id="cfgIdentEmp">${emps.map(e => `<option${e === emp ? ' selected' : ''}>${esc(e)}</option>`).join('')}</select></label>` : `<b>${esc(emp)}</b><input type="hidden" name="empresa" value="${esc(emp)}">`}
      <div class="cfg-ident-linha">
        <label>${esc(tx('Logo da empresa'))}<input type="file" id="cfgIdentArq" accept="image/png,image/jpeg,image/webp"><small>${esc(tx('PNG, JPG ou WEBP. A imagem é reduzida automaticamente (até 480 × 160 px). Fundo transparente fica melhor.'))}</small></label>
        <div class="cfg-campo-id"><label for="cfgIdentCor">${esc(tx('Cor de destaque da capa'))}</label><input type="color" name="cor" id="cfgIdentCor" value="${esc(d.cor || '#d2301f')}"><label class="cfg-check"><input type="checkbox" id="cfgIdentSemCor"${d.cor ? '' : ' checked'}> ${esc(tx('Usar a cor padrão da Rótula'))}</label></div>
      </div>
      <div class="cfg-ident-previa" id="cfgIdentPrevia"></div>
      <div class="cfg-acoes">
        <button type="submit" class="btn primario">${esc(tx('Salvar identidade'))}</button>
        <button type="button" class="btn" id="cfgIdentSemLogo">${esc(tx('Remover o logo'))}</button>
        <button type="button" class="btn" id="cfgIdentPadrao">${esc(tx('Voltar ao padrão'))}</button>
        <span class="nota" id="cfgMsgIdent" role="status"></span>
      </div>
    </form>
  </section>`;
}
function cfgIdentPrevia() {
  const box = document.getElementById('cfgIdentPrevia');
  if (!box) return;
  const sem = document.getElementById('cfgIdentSemCor').checked, cor = sem ? '#d2301f' : document.getElementById('cfgIdentCor').value;
  const logo = CFG.ident.remover ? '' : (CFG.ident.logoNovo || CFG.ident.logo);
  const emp = CFG.identEmp || '';
  box.style.setProperty('--prev', cor);
  box.innerHTML = `<div class="cfg-ident-capa" style="background:linear-gradient(115deg,${tplEscurecer(cor)} 0%,${cor} 40%,#7b2d6e 68%,#0b4f9c 100%)">
      <div><small>${esc(tx('Gestão'))}</small><span class="cfg-ident-chip">${logo ? `<img src="${logo}" alt="">` : `<b>${esc(emp)}</b>`}</span></div>
      <div style="text-align:right"><small>${esc(tx('Cliente'))}</small><span class="cfg-ident-chip"><b style="color:#0b4f9c">RÓTULA</b></span></div></div>`;
}
// reduz o logo no navegador (máx. 480 × 160) e devolve um data URI PNG/JPG pequeno
function cfgReduzLogo(arq) {
  return new Promise((ok, erro) => {
    if (!/^image\/(png|jpeg|webp)$/.test(arq.type)) return erro(new Error(tx('Envie o logo em PNG, JPG ou WEBP.')));
    const url = URL.createObjectURL(arq), img = new Image();
    img.onload = () => {
      const f = Math.min(1, 480 / img.width, 160 / img.height), w = Math.max(1, Math.round(img.width * f)), h = Math.max(1, Math.round(img.height * f));
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      const cx = cv.getContext('2d'); cx.drawImage(img, 0, 0, w, h); URL.revokeObjectURL(url);
      ok(arq.type === 'image/jpeg' ? cv.toDataURL('image/jpeg', 0.9) : cv.toDataURL('image/png'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); erro(new Error(tx('Não foi possível ler a imagem.'))); };
    img.src = url;
  });
}
function cfgIdentLigar(c) {
  const f = document.getElementById('cfgFormIdent');
  if (!f) return;
  cfgIdentPrevia();
  const troca = () => cfgIdentPrevia();
  document.getElementById('cfgIdentCor').addEventListener('input', () => { document.getElementById('cfgIdentSemCor').checked = false; troca(); });
  document.getElementById('cfgIdentSemCor').addEventListener('change', troca);
  document.getElementById('cfgIdentArq').addEventListener('change', async ev => {
    const arq = ev.target.files && ev.target.files[0];
    if (!arq) return;
    try { CFG.ident.logoNovo = await cfgReduzLogo(arq); CFG.ident.remover = false; cfgMsg('cfgMsgIdent', ''); troca(); }
    catch (e) { cfgMsg('cfgMsgIdent', e.message, true); }
  });
  document.getElementById('cfgIdentSemLogo').addEventListener('click', () => { CFG.ident.remover = true; CFG.ident.logoNovo = ''; troca(); });
  const sel = document.getElementById('cfgIdentEmp');
  if (sel) sel.addEventListener('change', () => { CFG.identEmp = sel.value; document.getElementById('cfgIdent').outerHTML = cfgIdentidadeHtml(CFG.dados); cfgIdentLigar(CFG.dados); });
  const aplica = j => {
    CFG.dados.identidade = j.identidade;
    if (typeof TPL_IDENT !== 'undefined') TPL_IDENT.dados = j.identidade.dados || {};
    document.getElementById('cfgIdent').outerHTML = cfgIdentidadeHtml(CFG.dados); cfgIdentLigar(CFG.dados);
  };
  f.addEventListener('submit', async ev => {
    ev.preventDefault();
    const sem = document.getElementById('cfgIdentSemCor').checked;
    const j = await cfgEnviar({ acao: 'identidade', empresa: CFG.identEmp, cor: sem ? '' : document.getElementById('cfgIdentCor').value, logo: CFG.ident.logoNovo || null, remover_logo: CFG.ident.remover }, 'cfgMsgIdent', f.querySelector('button[type=submit]'));
    if (!j) return;
    aplica(j); cfgMsg('cfgMsgIdent', tx('Identidade salva. Os próximos relatórios já saem com ela.'));
  });
  document.getElementById('cfgIdentPadrao').addEventListener('click', async () => {
    if (!confirm(tx('Voltar ao padrão (sem logo e sem cor da empresa)?'))) return;
    const j = await cfgEnviar({ acao: 'identidade_remover', empresa: CFG.identEmp }, 'cfgMsgIdent');
    if (!j) return;
    aplica(j); cfgMsg('cfgMsgIdent', tx('Identidade removida: os relatórios voltam ao padrão.'));
  });
}

function cfgMsg(id, texto, erro) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = texto || '';
  el.classList.toggle('cfg-erro', !!erro);
  el.classList.toggle('cfg-ok', !!texto && !erro);
}

async function cfgEnviar(corpo, idMsg, botao) {
  if (botao) botao.disabled = true;
  cfgMsg(idMsg, tx('Salvando…'));
  try {
    const j = await postarBruto(API + 'configuracoes', corpo);
    return j;
  } catch (e) {
    cfgMsg(idMsg, e.message || tx('Não foi possível salvar.'), true);
    return null;
  } finally {
    if (botao) botao.disabled = false;
  }
}

function cfgLigar(c) {
  const corpo = document.getElementById('cfgCorpo');

  // perfil
  corpo.querySelector('#cfgFormPerfil').addEventListener('submit', async ev => {
    ev.preventDefault();
    const f = ev.target;
    const j = await cfgEnviar({ acao: 'perfil', nome: f.nome.value, email: f.email.value }, 'cfgMsgPerfil', f.querySelector('button[type=submit]'));
    if (!j) return;
    CFG.dados.nome = j.nome; CFG.dados.email = j.email;
    f.nome.value = j.nome;
    cfgMsg('cfgMsgPerfil', tx('Dados atualizados.'));
    const nomeEl = document.querySelector('#usuarioBox > span');   // nome mostrado na barra superior
    if (nomeEl) nomeEl.textContent = j.nome + (c.empresa ? ' · ' + c.empresa : '');
    if (typeof D !== 'undefined' && D && D.usuario) D.usuario.nome = j.nome;
  });

  // senha
  const nova = corpo.querySelector('#cfgNova'), forca = corpo.querySelector('#cfgForca');
  const pintaForca = () => {
    const v = nova.value, n = v ? cfgForcaSenha(v) : -1;
    const rot = ['muito fraca', 'fraca', 'média', 'forte', 'muito forte'];
    forca.dataset.n = String(n);
    forca.querySelectorAll('i').forEach((i, k) => i.classList.toggle('on', n >= 0 && k <= n));
    forca.querySelector('span').textContent = n >= 0 ? tx('Força da senha:') + ' ' + tx(rot[n]) : '';
  };
  nova.addEventListener('input', pintaForca);
  corpo.querySelector('#cfgVerSenha').addEventListener('change', ev => {
    corpo.querySelectorAll('#cfgFormSenha input[name=atual], #cfgFormSenha input[name=nova], #cfgFormSenha input[name=confirmar]').forEach(i => { i.type = ev.target.checked ? 'text' : 'password'; });
  });
  corpo.querySelector('#cfgFormSenha').addEventListener('submit', async ev => {
    ev.preventDefault();
    const f = ev.target;
    if (!f.atual.value || !f.nova.value || !f.confirmar.value) return cfgMsg('cfgMsgSenha', tx('Preencha a senha atual, a nova e a confirmação.'), true);
    if (f.nova.value.length < 8) return cfgMsg('cfgMsgSenha', tx('A nova senha precisa ter pelo menos 8 caracteres.'), true);
    if (f.nova.value !== f.confirmar.value) return cfgMsg('cfgMsgSenha', tx('A confirmação não confere com a nova senha.'), true);
    const j = await cfgEnviar({ acao: 'senha', atual: f.atual.value, nova: f.nova.value, confirmar: f.confirmar.value }, 'cfgMsgSenha', f.querySelector('button[type=submit]'));
    if (!j) return;
    f.reset(); pintaForca();
    cfgMsg('cfgMsgSenha', tx('Senha alterada. Use a nova senha no próximo acesso.'));
    toast(tx('Senha alterada. Use a nova senha no próximo acesso.'));
  });

  // preferências: tema, menu e tamanho do texto mostram a prévia na hora; o idioma só vale depois de salvar (a tela recarrega)
  const fp = corpo.querySelector('#cfgFormPref');
  fp.addEventListener('change', ev => {
    const r = ev.target;
    if (r.type !== 'radio') return;
    fp.querySelectorAll(`input[name="${r.name}"]`).forEach(o => o.closest('.cfg-op').classList.toggle('sel', o.checked));
    if (r.name === 'tema') cfgAplicarAparencia(r.value, undefined, undefined);
    if (r.name === 'menu') cfgAplicarAparencia(undefined, r.value, undefined);
    if (r.name === 'tam_texto') cfgAplicarAparencia(undefined, undefined, r.value);
  });
  fp.addEventListener('submit', async ev => {
    ev.preventDefault();
    const v = n => fp.querySelector(`input[name="${n}"]:checked`)?.value;
    const novo = { acao: 'preferencias', idioma: v('idioma'), tam_texto: v('tam_texto'), tema: v('tema') ?? '', menu: v('menu'), email_tarefas: fp.querySelector('input[name=email_tarefas]').checked };
    const j = await cfgEnviar(novo, 'cfgMsgPref', fp.querySelector('button[type=submit]'));
    if (!j) return;
    const mudouIdioma = j.idioma !== c.idioma;
    Object.assign(CFG.dados, { email_tarefas: j.email_tarefas, idioma: j.idioma, tam_texto: j.tam_texto, tema: j.tema, menu: j.menu });
    cfgMsg('cfgMsgPref', tx('Preferências salvas.'));
    if (mudouIdioma) location.href = 'index.php?aba=config';   // recarrega no novo idioma e volta para esta aba
  });

  cfgIdentLigar(c);

  // tutorial
  corpo.querySelector('#cfgAbrirTut').addEventListener('click', () => mudarAba('tutorial'));
  corpo.querySelector('#cfgZerarTut').addEventListener('click', async () => {
    const j = await cfgEnviar({ acao: 'tutorial', tutorial: {} }, 'cfgMsgTut');
    if (!j) return;
    CFG.dados.tutorial = {};
    if (typeof TUT !== 'undefined') TUT.feitos = {};
    cfgMsg('cfgMsgTut', tx('Progresso do tutorial zerado.'));
  });
}

async function renderConfig() {
  const corpo = document.getElementById('cfgCorpo');
  if (!corpo) return;
  try {
    const c = await cfgCarregar(true);
    if (abaAtual !== 'config') return;
    const h2 = document.querySelector('#aba-config > .bloco-cab h2'); if (h2) h2.textContent = tx('Configurações');
    const nota = document.getElementById('cfgNota'); if (nota) nota.textContent = tx('Seus dados, senha, idioma e aparência. Vale só para o seu usuário.');
    corpo.innerHTML = cfgHtml(c);
    cfgLigar(c);
  } catch (e) {
    corpo.innerHTML = `<div class="bloco"><span class="nota cfg-erro">${esc(e.message)}</span></div>`;
  }
}
