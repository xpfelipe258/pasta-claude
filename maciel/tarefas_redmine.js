'use strict';

const TF_RED = { pagina: 1, dados: null, permiteEditar: false, carregando: false, erro: '', versao: 0 };
const tfRedEl = id => document.getElementById(id);

async function tfRedApi(acao, dados = {}) {
  const resposta = await fetch('redmine_tarefas.php', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': window.CSRF_TOKEN || '' },
    body: JSON.stringify({ acao, ...dados }),
    cache: 'no-store',
  });
  const json = await resposta.json().catch(() => null);
  if (!resposta.ok || !json) throw new Error(json?.erro || 'Não foi possível consultar o Redmine.');
  return json;
}

function tfRedData(valor) {
  if (!valor) return '—';
  const data = String(valor);
  return /^\d{4}-\d{2}-\d{2}$/.test(data) ? data.split('-').reverse().join('/') : new Date(data).toLocaleString('pt-BR');
}

function tfRedRender() {
  const lista = tfRedEl('tfRedLista');
  const dados = TF_RED.dados;
  tfRedEl('tfRedAtualizar').disabled = TF_RED.carregando;
  tfRedEl('tfRedNova').hidden = !dados?.permite_editar;
  tfRedEl('tfRedConta').textContent = dados?.conta?.nome ? `Conta Redmine: ${dados.conta.nome}` : '';
  tfRedEl('tfRedAnterior').disabled = TF_RED.carregando || !dados || dados.pagina <= 1;
  tfRedEl('tfRedProxima').disabled = TF_RED.carregando || !dados || dados.pagina * dados.limite >= dados.total;
  tfRedEl('tfRedPaginacao').hidden = !dados || dados.total <= dados.limite;
  tfRedEl('tfRedEstado').textContent = TF_RED.carregando ? 'Carregando tarefas do Redmine…'
    : TF_RED.erro || (dados ? `${dados.total} tarefa(s) · página ${dados.pagina}` : '');
  lista.innerHTML = dados?.tarefas.length ? `<div class="tabela-rolagem"><table data-sem-ferramentas>
    <thead><tr><th>Tarefa</th><th>Projeto</th><th>Situação</th><th>Prioridade</th><th>Responsável</th><th>Data prevista</th></tr></thead>
    <tbody>${dados.tarefas.map(t => `<tr>
      <td><button type="button" class="btn" data-redmine-tarefa="${Number(t.id)}">#${Number(t.id)} · ${esc(t.subject)}</button></td>
      <td>${esc(t.project?.name || '—')}</td><td>${esc(t.status?.name || '—')}</td>
      <td>${esc(t.priority?.name || '—')}</td><td>${esc(t.assigned_to?.name || '—')}</td><td>${esc(tfRedData(t.due_date))}</td>
    </tr>`).join('')}</tbody></table></div>` : dados && !TF_RED.carregando ? '<p class="nota">Nenhuma tarefa neste filtro.</p>' : '';
}

async function tfRedCarregar(pagina = 1) {
  const versao = ++TF_RED.versao;
  TF_RED.carregando = true;
  TF_RED.erro = '';
  TF_RED.dados = null;
  tfRedRender();
  try {
    const dados = await tfRedApi('listar', { pagina, escopo: tfRedEl('tfRedEscopo').value, status: tfRedEl('tfRedSituacao').value });
    if (versao !== TF_RED.versao) return;
    TF_RED.dados = dados;
    TF_RED.pagina = dados.pagina;
    TF_RED.permiteEditar = dados.permite_editar === true;
  } catch (e) {
    if (versao === TF_RED.versao) TF_RED.erro = e.message;
  } finally {
    if (versao === TF_RED.versao) { TF_RED.carregando = false; tfRedRender(); }
  }
}

function tfRedDialogo(titulo) {
  const dialogo = tfRedEl('tfRedDialogo');
  tfRedEl('tfRedDialogoTitulo').textContent = titulo;
  tfRedEl('tfRedDialogoCorpo').textContent = 'Carregando…';
  if (!dialogo.open) dialogo.showModal();
  return dialogo;
}

function tfRedAnexoUrl(valor) {
  try {
    const url = new URL(valor);
    return url.origin === 'https://redmine.rotula.com.br' && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

async function tfRedAbrir(id, retorno = '') {
  const dialogo = tfRedDialogo(`Tarefa Redmine #${id}`);
  const corpo = tfRedEl('tfRedDialogoCorpo');
  const carga = Symbol();
  dialogo.tfCarga = carga;
  try {
    const { tarefa: t, responsaveis = [] } = await tfRedApi('detalhe', { id });
    if (!dialogo.open || dialogo.tfCarga !== carga) return;
    const historico = (t.journals || []).filter(j => j.notes?.trim());
    const anexos = (t.attachments || []).map(a => {
      const url = tfRedAnexoUrl(a.content_url);
      return url ? `<li><a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(a.filename || 'Anexo')}</a></li>` : '';
    }).join('');
    tfRedEl('tfRedDialogoTitulo').textContent = `#${id} · ${t.subject}`;
    corpo.innerHTML = `<p>${esc(t.project?.name || '—')} · ${esc(t.status?.name || '—')} · ${esc(t.priority?.name || '—')}</p>
      <p><b>Responsável:</b> ${esc(t.assigned_to?.name || '—')} · <b>Data prevista:</b> ${esc(tfRedData(t.due_date))}</p>
      <div class="bloco"><h3>Descrição</h3><p style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(t.description || 'Sem descrição.')}</p>
        ${anexos ? `<h3>Anexos</h3><ul>${anexos}</ul>` : ''}</div>
      <div class="bloco"><h3>Respostas no Redmine</h3>${historico.length ? historico.map(j => `<article>
        <b>${esc(j.user?.name || 'Usuário Redmine')}</b> <small>${esc(tfRedData(j.created_on))}</small>
        <p style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(j.notes)}</p></article>`).join('') : '<p class="nota">Nenhuma resposta registrada.</p>'}</div>
      ${TF_RED.permiteEditar ? `<form id="tfRedResposta">
        <label>Atribuir ao responder <select name="responsavel_id"></select></label>
        <label>Responder no Redmine<textarea name="nota" rows="4" required maxlength="10000" style="width:100%"></textarea></label>
        <div class="acoes"><span role="status"></span><button type="submit" class="btn primario">Enviar resposta</button></div>
      </form>` : ''}`;
    const atribuir = corpo.querySelector('[name="responsavel_id"]');
    if (atribuir) {
      const autor = Number(t.author?.id);
      tfRedPreencher(atribuir, responsaveis.map(p => ({
        ...p, name: Number(p.id) === autor ? p.name + ' (autor da tarefa)' : p.name
      })), 'Manter responsável atual');
      if (Number(t.assigned_to?.id) !== autor && responsaveis.some(p => Number(p.id) === autor)) atribuir.value = String(autor);
    }
    if (retorno) corpo.querySelector('[role="status"]')?.append(retorno);
    corpo.querySelector('form')?.addEventListener('submit', async ev => {
      ev.preventDefault();
      const form = ev.currentTarget;
      const nota = form.elements.nota.value.trim();
      if (!nota) { form.elements.nota.focus(); return; }
      const botao = form.querySelector('button');
      const estado = form.querySelector('[role="status"]');
      botao.disabled = true;
      estado.textContent = 'Enviando…';
      try {
        const resultado = await tfRedApi('responder', { id, nota, responsavel_id: atribuir.value });
        const mensagem = resultado.atribuicao_confirmada ? 'Resposta enviada ao Redmine.' : 'Resposta enviada. O Redmine não confirmou a troca de responsável.';
        if (dialogo.open && dialogo.tfCarga === carga) await tfRedAbrir(id, mensagem);
        tfRedCarregar(TF_RED.pagina);
      } catch (e) {
        estado.textContent = e.message;
        botao.disabled = false;
      }
    });
  } catch (e) {
    if (dialogo.open && dialogo.tfCarga === carga) {
      corpo.textContent = retorno ? `${retorno} Não foi possível recarregar a tarefa. ${e.message}` : e.message;
    }
  }
}

async function tfRedProjetos() {
  const lista = new Map();
  for (let pagina = 1; ; pagina++) {
    const dados = await tfRedApi('projetos', { pagina });
    for (const projeto of dados.projetos) lista.set(projeto.id, projeto);
    if (!dados.projetos.length || pagina * dados.limite >= dados.total) return [...lista.values()];
  }
}

function tfRedPreencher(select, itens, primeiro) {
  select.replaceChildren(new Option(primeiro, ''), ...itens.map(item => new Option(item.name, item.id)));
}

async function tfRedNovaTarefa() {
  const dialogo = tfRedDialogo('Nova tarefa no Redmine');
  const carga = Symbol();
  dialogo.tfCarga = carga;
  const corpo = tfRedEl('tfRedDialogoCorpo');
  try {
    const projetos = await tfRedProjetos();
    if (!dialogo.open || dialogo.tfCarga !== carga) return;
    if (!projetos.length) { corpo.textContent = 'Nenhum projeto disponível para esta conta.'; return; }
    corpo.innerHTML = `<form class="tf-form" id="tfRedCriar">
      <div class="tf-redmine-form">
        <label class="tf-redmine-largo">Projeto ou subprojeto <select name="projeto_id" required></select></label>
        <label class="tf-redmine-largo">Título <input name="titulo" required maxlength="255"></label>
        <label class="tf-redmine-largo">Descrição <textarea name="descricao" rows="4" maxlength="10000"></textarea></label>
        <label>Tipo <select name="tipo_id" required></select></label>
        <label>Situação <select name="situacao_id"></select></label>
        <label>Prioridade <select name="prioridade_id"></select></label>
        <label>Responsável <select name="responsavel_id"></select></label>
        <label>Início <input type="date" name="inicio"></label>
        <label>Data prevista <input type="date" name="prazo"></label>
        <div class="tf-redmine-largo tf-redmine-form" data-redmine-campos></div>
      </div>
      <p role="status" class="nota">Escolha um projeto para carregar as opções.</p>
      <div class="acoes"><button type="submit" class="btn primario" disabled>Criar tarefa</button></div>
    </form>`;
    const form = corpo.querySelector('form');
    const projeto = form.elements.projeto_id;
    const campos = form.querySelector('[data-redmine-campos]');
    const estado = form.querySelector('[role="status"]');
    const criar = form.querySelector('button');
    const porId = new Map(projetos.map(p => [p.id, p]));
    const opcoesProjeto = projetos.map(p => ({ id: p.id, name: p.parent ? `${p.parent.name || porId.get(p.parent.id)?.name || 'Subprojeto'} / ${p.name}` : p.name }));
    tfRedPreencher(projeto, opcoesProjeto.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')), 'Selecione');
    const listas = { tipo_id: 'tipos', situacao_id: 'situacoes', prioridade_id: 'prioridades', responsavel_id: 'responsaveis' };
    let carregamento = 0;
    projeto.addEventListener('change', async () => {
      const atual = ++carregamento;
      criar.disabled = true;
      campos.replaceChildren();
      for (const nome of Object.keys(listas)) tfRedPreencher(form.elements[nome], [], 'Selecione o projeto');
      estado.textContent = projeto.value ? 'Carregando opções do projeto…' : 'Escolha um projeto para carregar as opções.';
      if (!projeto.value) return;
      try {
        const opcoes = await tfRedApi('opcoes', { projeto_id: Number(projeto.value) });
        if (carregamento !== atual) return;
        for (const [nome, chave] of Object.entries(listas)) {
          const itens = opcoes[chave] || [];
          tfRedPreencher(form.elements[nome], itens, nome === 'tipo_id' ? 'Selecione' : 'Padrão do Redmine');
          if (nome === 'tipo_id' && itens.length === 1) form.elements[nome].value = itens[0].id;
        }
        for (const campo of opcoes.campos_personalizados || []) {
          const rotulo = document.createElement('label');
          const input = document.createElement('input');
          input.dataset.redmineCampo = campo.id;
          input.maxLength = 4000;
          rotulo.append(campo.name, input);
          campos.append(rotulo);
        }
        criar.disabled = !opcoes.tipos?.length;
        estado.textContent = criar.disabled ? 'Nenhum tipo de tarefa disponível neste projeto.' : '';
      } catch (e) {
        if (carregamento === atual) estado.textContent = e.message;
      }
    });
    form.addEventListener('submit', async ev => {
      ev.preventDefault();
      if (criar.disabled) return;
      const dados = Object.fromEntries(new FormData(form));
      dados.campos_personalizados = Array.from(campos.querySelectorAll('input')).filter(el => el.value.trim())
        .map(el => ({ id: Number(el.dataset.redmineCampo), value: el.value.trim() }));
      criar.disabled = projeto.disabled = true;
      estado.textContent = 'Criando tarefa…';
      try {
        const { tarefa } = await tfRedApi('criar', dados);
        if (dialogo.open && dialogo.tfCarga === carga) await tfRedAbrir(tarefa.id);
        tfRedCarregar();
      } catch (e) {
        estado.textContent = e.message;
        criar.disabled = projeto.disabled = false;
      }
    });
  } catch (e) {
    if (dialogo.open && dialogo.tfCarga === carga) corpo.textContent = e.message;
  }
}

function tfRedAtivar() {
  const view = tfRedEl('tfRedView');
  if (!view || view.dataset.ligada) return;
  view.dataset.ligada = '1';
  view.addEventListener('click', ev => {
    const alvo = ev.target.closest('button');
    if (!alvo) return;
    if (alvo.dataset.redmineTarefa) tfRedAbrir(Number(alvo.dataset.redmineTarefa));
    if (alvo.id === 'tfRedAtualizar') tfRedCarregar(TF_RED.pagina);
    if (alvo.id === 'tfRedAnterior') tfRedCarregar(TF_RED.pagina - 1);
    if (alvo.id === 'tfRedProxima') tfRedCarregar(TF_RED.pagina + 1);
    if (alvo.id === 'tfRedNova') tfRedNovaTarefa();
  });
  view.addEventListener('change', ev => {
    if (['tfRedEscopo', 'tfRedSituacao'].includes(ev.target.id)) tfRedCarregar();
  });
  tfRedCarregar();
}
