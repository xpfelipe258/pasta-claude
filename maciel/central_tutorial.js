// Visita guiada da Central da empresa. Nenhuma etapa altera dados ou concede acesso a uma aba.
(function () {
  'use strict';
  const textos = {
    inicio: ['Início', 'Esta é a Central da sua empresa. Os cartões reúnem os atalhos e os resumos das obras, do financeiro, do comercial e do pessoal. Dentro de cada obra ficam produção, planejamento e medição.'],
    obras: ['Obras', 'Encontre e abra as obras às quais você tem acesso. Quem administra pode criar uma obra, editar seus dados, enviar documentos e organizar empresas e atividades. Ao abrir uma obra, confira seu nome no topo antes de lançar dados.'],
    financeiro: ['Painel financeiro', 'Consolida as obras disponíveis para você. Selecione a data ou o período e atualize para comparar contratado, medido e avanço em relação ao prazo. Medição e recebimento são informações diferentes: uma medição não comprova pagamento.'],
    comercial: ['Painel comercial', 'Prepare orçamentos e propostas. Organize serviços, quantidades e custos; confira BDI, desconto, condições de pagamento e situação da proposta. A aprovação comercial não substitui o registro da produção ou da medição da obra.'],
    pessoal: ['Painel pessoal (RH)', 'Acompanhe colaboradores, folha e efetivo das obras no período. Confira mês e escopo antes de comparar valores. Os lançamentos e cadastros devem respeitar as permissões da sua conta.'],
    config: ['Configurações', 'Administre os dados e a identidade visual da empresa. As opções de usuários e acessos aparecem conforme seu nível de permissão. As configurações pessoais da sua conta também estão disponíveis dentro da obra.'],
    plano: ['Painel administrativo da empresa', 'Consulte o plano contratado, pagamentos e limites da sua empresa. Este painel é da empresa cliente; não é o painel de administração geral da plataforma.'],
    sistema: ['Painel administrativo da plataforma', 'Área exclusiva do administrador geral: empresas clientes, usuários, planos, auditoria e configurações globais. As empresas clientes não recebem este acesso.']
  };
  let guia = null, indice = 0, passos = [], destacado = null;
  const chave = 'centralGuiaRetomar';
  function guardar(valor) { try { sessionStorage.setItem(chave, valor); } catch (_) {} }
  function limparRetorno() { try { sessionStorage.removeItem(chave); } catch (_) {} }
  function limparDestaque() { if (destacado) destacado.classList.remove('ce-guia-destaque'); destacado = null; }
  function fechar() {
    limparDestaque(); limparRetorno();
    if (guia) { guia.remove(); guia = null; }
    document.getElementById('ceGuiaAbrir')?.focus();
  }
  function desenhar() {
    limparDestaque();
    const passo = passos[indice];
    destacado = passo.alvo;
    if (destacado) { destacado.classList.add('ce-guia-destaque'); destacado.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' }); }
    guia.querySelector('h2').textContent = passo.titulo;
    guia.querySelector('[data-texto]').textContent = passo.texto;
    guia.querySelector('[data-progresso]').textContent = `Passo ${indice + 1} de ${passos.length}`;
    guia.querySelector('[data-anterior]').disabled = indice === 0;
    guia.querySelector('[data-proximo]').textContent = indice === passos.length - 1 ? 'Concluir' : 'Próximo';
    const abrir = guia.querySelector('[data-abrir]');
    abrir.hidden = !passo.href; abrir.href = passo.href || '#';
    abrir.onclick = () => guardar(passo.id);
  }
  function iniciar(retomar) {
    if (guia) return;
    passos = [...document.querySelectorAll('.ce-abas [data-central-aba]')].map(el => {
      const id = el.dataset.centralAba, info = textos[id];
      return info ? { id, titulo: info[0], texto: info[1], alvo: el, href: el.getAttribute('href') } : null;
    }).filter(Boolean);
    if (!passos.length) return;
    passos.push({ id: 'obra', titulo: 'Dentro da obra: produção e medição', texto: 'Na aba Obras, abra a obra desejada. O Painel compara previsto e realizado. Em Lançamentos registre a quantidade por atividade e data. Em Medição (BM) confira contrato, avanço, período e deduções. Para aprender cada controle, abra Geral → Tutorial e escolha a visita guiada.', alvo: document.querySelector('main') });
    indice = Math.max(0, passos.findIndex(p => p.id === retomar));
    guia = document.createElement('section'); guia.className = 'ce-guia'; guia.setAttribute('role', 'region'); guia.setAttribute('aria-label', 'Tutorial interativo da Central');
    guia.innerHTML = '<div class="ce-guia-topo"><span data-progresso></span><button type="button" data-fechar aria-label="Fechar tutorial">×</button></div><h2 tabindex="-1"></h2><p data-texto></p><a class="btn" data-abrir>Abrir esta aba</a><div class="ce-guia-acoes"><button type="button" class="btn" data-anterior>Anterior</button><button type="button" class="btn primario" data-proximo>Próximo</button></div>';
    guia.querySelector('[data-fechar]').onclick = fechar;
    guia.querySelector('[data-anterior]').onclick = () => { if (indice) { indice--; desenhar(); guia.querySelector('h2').focus(); } };
    guia.querySelector('[data-proximo]').onclick = () => { if (indice === passos.length - 1) fechar(); else { indice++; desenhar(); guia.querySelector('h2').focus(); } };
    document.body.append(guia); desenhar(); guia.querySelector('h2').focus();
  }
  function preparar() {
    const botao = document.getElementById('ceGuiaAbrir'); if (!botao) return;
    if (document.querySelector('[data-central-aba="pessoal"][aria-current="page"]')) {
      const video = document.createElement('a'); video.className = 'btn'; video.href = 'tutorial_rh.html';
      video.textContent = 'Vídeo completo de RH (15min30s)'; botao.before(video);
    }
    const st = document.createElement('style');
    st.textContent = '.ce-guia-barra{padding:10px 22px;display:flex;justify-content:flex-end;flex-wrap:wrap;gap:8px}.ce-guia{position:fixed;bottom:18px;right:18px;width:min(430px,calc(100vw - 24px));box-sizing:border-box;max-height:70dvh;overflow:auto;z-index:10010;background:#fff;color:#182230;border:2px solid var(--marca,#2563eb);border-radius:14px;padding:18px;box-shadow:0 12px 48px #0004;font:16px/1.5 system-ui}.ce-guia h2{font-size:20px;margin:8px 0}.ce-guia p{margin:8px 0 16px}.ce-guia-topo,.ce-guia-acoes{display:flex;justify-content:space-between;align-items:center;gap:12px}.ce-guia-topo{font-size:13px;color:#475467}.ce-guia-topo button{background:none;border:0;min-height:44px;min-width:44px;font-size:26px;color:#182230}.ce-guia-acoes{margin-top:14px}.ce-guia .btn{min-height:44px}.ce-guia-destaque{outline:4px solid #2563eb!important;outline-offset:3px;scroll-margin:90px}.ce-guia [hidden]{display:none!important}@media(max-width:600px){.ce-guia{bottom:12px;right:12px;padding:14px;font-size:15px;max-height:55dvh}.ce-guia-barra{padding:10px 14px}}';
    document.head.append(st);
    botao.onclick = () => iniciar();
    document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && guia) { ev.preventDefault(); fechar(); } });
    let retorno; try { retorno = sessionStorage.getItem(chave); } catch (_) {}
    limparRetorno(); if (retorno) iniciar(retorno);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', preparar); else preparar();
})();
