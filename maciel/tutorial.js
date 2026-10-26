// ------------------------------------------------------------ TUTORIAL INTERATIVO (com PDF)
// Cada tópico tem um resumo e passos. O usuário marca o que já leu/fez (o progresso fica gravado no usuário, em todos os
// aparelhos), busca por assunto, abre a tela do tópico e pede uma visita guiada que destaca cada elemento na própria tela.
// "Baixar tutorial (PDF)" usa a visualização padrão dos relatórios (capa Rótula + Baixar PDF).
const TUT = { feitos: {}, busca: '', topico: 'tela', carregado: false, tour: null, salvarT: null };

const TUT_MODULOS = [
  { id: 'ini', nome: 'Começando' },
  { id: 'prod', nome: 'Produção' },
  { id: 'sup', nome: 'Suprimentos' },
  { id: 'fin', nome: 'Financeiro' },
  { id: 'ges', nome: 'Gestão' },
  { id: 'rel', nome: 'Relatórios' },
];

// alvo = seletor CSS do elemento a destacar; aba (no passo) = tela onde o alvo está, se for diferente da do tópico.
const TUT_TOPICOS = [
  { id: 'tela', mod: 'ini', aba: 'tarefas', titulo: 'Conhecendo a tela',
    resumo: 'O sistema tem um menu de áreas e abas, uma data de referência que serve de "hoje" para os cálculos e a área de trabalho da aba escolhida.',
    passos: [
      { t: 'O menu lista as áreas (Produção, Suprimentos, Consumo, Financeiro, Gestão). Clique numa área para ver as abas dela e clique na aba para abrir a tela.', alvo: '#sidebar' },
      { t: 'A data de referência define o "hoje" dos cálculos (previsto, atraso, ritmo). Use ‹ › para mudar de semana e "Hoje" para voltar.', alvo: '#refData' },
      { t: 'Seu nome, o link do dashboard e o botão Sair ficam no topo. Em Configurações você troca nome, senha, idioma e tema.', alvo: '#usuarioBox' },
      { t: 'No celular o botão ☰ abre o menu. Nos mapas de apontamento, o toque longo liga o modo pintar e arrastar o dedo marca várias peças.', alvo: '#sidebarToggle' },
      { t: 'Os dados ficam no servidor. Quando outro usuário grava, a sua tela se atualiza sozinha assim que você para de digitar ou clicar.' },
    ],
    dica: 'Se algo não aparecer como esperado depois de uma atualização do sistema, recarregue a página com Ctrl+F5.' },

  { id: 'tarefas', mod: 'ini', aba: 'tarefas', titulo: 'Tarefas e mural da equipe',
    resumo: 'A primeira tela do sistema. Cada pessoa tem suas tarefas e lembretes; o administrador pode atribuir tarefas a qualquer usuário.',
    passos: [
      { t: 'Clique em "+ Nova tarefa" (ou use o lembrete rápido). Toda tarefa exige data de início e de conclusão.', alvo: '#btnNovaTarefa' },
      { t: 'Ao criar, a tarefa recebe um código TAR-ANO-NÚMERO (ex.: TAR-2026-0001) que não muda. Digite o código na busca para achar a tarefa.', alvo: '#tfBusca' },
      { t: 'Os alertas avisam: ATRASADA, VENCE HOJE e "vence em N dias". Em tarefas atribuídas a você, só a situação e o retorno podem ser alterados.', alvo: '#tfAlertas' },
      { t: 'No "Mural da equipe" todos os usuários conversam e trocam arquivos (até 10 MB). Cada tarefa salva também tem a sua conversa, só para quem participa dela.', alvo: '#tfAbas' },
      { t: '"Relatório de tarefas" gera o PDF por responsável, situação e período.', alvo: '#btnRelTarefas' },
    ],
    dica: 'O número vermelho ao lado de "Tarefas a fazer" no menu mostra que existe tarefa atrasada ou vencendo hoje.' },

  { id: 'conta', mod: 'ini', aba: 'config', titulo: 'Configurações da conta',
    resumo: 'Tudo o que é pessoal: dados do perfil, senha, idioma, tema e posição do menu. O que você muda aqui vale só para o seu usuário.',
    passos: [
      { t: 'Em "Meu perfil" altere o nome e o e-mail (o e-mail é usado para recuperar a senha). O login não muda.', alvo: '#cfgFormPerfil' },
      { t: 'Para trocar a senha informe a atual, a nova (mínimo de 8 caracteres) e a confirmação. Depois de 5 erros na senha atual, a troca fica bloqueada por 15 minutos.', alvo: '#cfgFormSenha' },
      { t: 'Escolha o idioma (português, inglês ou espanhol), o tamanho do texto, o tema e a posição do menu. Tema, menu e texto mostram a prévia na hora; o idioma vale depois de salvar.', alvo: '#cfgFormPref' },
    ],
    dica: 'O administrador também pode redefinir a senha de qualquer usuário em Administração › Usuários.' },

  { id: 'painel', mod: 'prod', aba: 'painel', titulo: 'Painel e faróis',
    resumo: 'Visão geral do período: quanto estava previsto, quanto foi realizado e onde a obra está atrasada.',
    passos: [
      { t: 'Escolha o período (Semana, Mês, Últimos 30 dias, Obra toda) ou digite as datas. Todos os números do Painel seguem esse período.', alvo: '#barraPeriodo' },
      { t: 'Os cartões resumem previsto × realizado do período.', alvo: '#tiles' },
      { t: 'O farol por empresa e serviço: verde = no previsto, amarelo = no limite, vermelho = atrasado.', alvo: '#tabFarol' },
      { t: 'Clique numa empresa (EJ, CMM, Globo Aços) para ver só os dados dela; "Geral" soma todas.', alvo: '#segPainelEmp' },
      { t: 'O bloco "Planejamento 5W2H" mostra planejado × executado dos planos ativos, com curva S e as atividades atrasadas.', alvo: '#painelPlanos' },
    ],
    dica: 'O número de "Executado" do plano é clicável: abre de onde vem o realizado (colunas da grade e atividades do BM).' },

  { id: 'semana', mod: 'prod', aba: 'semana', titulo: 'Programação semanal',
    resumo: 'A semana da data de referência, dia a dia, comparando a meta de cada serviço com o que foi lançado.',
    passos: [
      { t: 'Cada célula mostra realizado / meta do dia. Dias futuros mostram o planejado; dias passados sem lançamento aparecem em vermelho.', alvo: '#tabSemana' },
      { t: '"Planejado para entrar nesta semana" lista o que está previsto para começar.', alvo: '#planejado' },
      { t: '"Impactos registrados na semana" mostra o que atrapalhou a produção.', alvo: '#impSemana' },
    ] },

  { id: 'lanc', mod: 'prod', aba: 'lanc', titulo: 'Lançamentos de produção',
    resumo: 'A grade onde se lança a produção por dia, serviço e empresa. É o número oficial da produção.',
    passos: [
      { t: 'Escolha a empresa na barra de abas (EJ, CMM, Globo Aços…). Cada empresa tem seus serviços.', alvo: '#segEmpresas' },
      { t: 'Digite as quantidades nas células do dia. O contador mostra quantos lançamentos estão pendentes.', alvo: '#pendTxt' },
      { t: 'Clique em Salvar para gravar ou em Descartar para desfazer o que ainda não foi salvo.', alvo: '#btnSalvar' },
      { t: 'O que é apontado em "Apontar montagem" soma sozinho na coluna principal do serviço: em Lançamentos o total é sempre um só.' },
      { t: '"Relatório de produção" gera o PDF da empresa escolhida, só com as atividades que tiveram avanço no período.', alvo: '#btnRelLanc' },
    ],
    dica: 'A porcentagem "% do contrato" compara cada atividade com o valor total do contrato da empresa.' },

  { id: 'apont', mod: 'prod', aba: 'apont', titulo: 'Apontar montagem (mapa)',
    resumo: 'Marque no mapa as peças montadas (joists, vigas, contraventamento, telhas…). O apontamento lança a produção e baixa o estoque automaticamente.',
    passos: [
      { t: 'Escolha o tipo de apontamento: joists e vigas, contraventamento, telhas da cobertura, perfilagem ou telhas do fechamento.', alvo: '#segApModo' },
      { t: 'Escolha a empresa que montou e a data. A empresa precisa ter o serviço no catálogo.', alvo: '#apBarra' },
      { t: 'No mapa, clique numa peça para marcar; arraste para marcar várias. No celular, toque longo e arraste.', alvo: '#apMapa' },
      { t: 'Confira os "efeitos" antes de salvar: produção que será lançada e material que será baixado.', alvo: '#apEfeitos' },
      { t: 'Salve. "Regularização" registra a peça sem lançar produção. Em "Últimos apontamentos" você filtra e exclui — excluir devolve produção e estoque.', alvo: '#tabApHist' },
      { t: '"Baixar mapa" gera a imagem do mapa na visualização padrão.', alvo: '#btnBaixarMapa' },
    ],
    dica: 'Uma peça já apontada não pode ser apontada de novo na mesma atividade; o sistema avisa.' },

  { id: 'rdo', mod: 'prod', aba: 'rdo', titulo: 'Relatório diário de obra (RDO)',
    resumo: 'Registro do dia: clima, observações e fotos com comentário. Gera um RDO para o cliente e outro, mais completo, para a gestão.',
    passos: [
      { t: 'Escolha o dia com as setas ou o calendário.', alvo: '#rdoCorpo' },
      { t: 'Anote clima e observações. Há campos separados para o cliente e para a gestão; gravam ao sair do campo.' },
      { t: 'Envie as fotos do dia e escreva um comentário em cada uma. A tela reduz a foto antes de enviar.' },
      { t: '"RDO para o cliente" mostra produção, efetivo, máquinas e fotos, sem valores. "RDO para a gestão" soma o financeiro e os impactos em aberto. Ambos saem em PDF.' },
    ] },

  { id: 'plan', mod: 'prod', aba: 'plan', titulo: 'Planejamento 5W2H',
    resumo: 'Transforma o cronograma em planos de execução: o que, por quê, onde, quando, quem, como e quanto — com divisão por empresa, curva S e fluxo.',
    passos: [
      { t: 'A "Sugestão do cronograma" mostra, para o período escolhido, o saldo de cada atividade e a taxa por dia necessária.', alvo: '#segPlanSub' },
      { t: 'Marque as atividades e clique em "Criar planejamento": o assistente abre já com quantidades e datas sugeridas.' },
      { t: 'No 5W2H, a empresa (Who) é obrigatória. Com duas ou mais empresas, divida a produção e o valor entre elas — a soma precisa fechar com a quantidade.' },
      { t: '"Salvar como rascunho" guarda o plano sem publicar. Só planos publicados entram no Painel, nos faróis e na Projeção.' },
      { t: 'Em "Planos 5W2H" abra o plano para ver a curva S, o que falta, a liberação do fluxo e o botão "Baixar planejamento".' },
    ],
    dica: 'O assistente guarda um rascunho automático no navegador: se a página recarregar, ele é retomado.' },

  { id: 'avanco', mod: 'prod', aba: 'avanco', titulo: 'Avanço físico, Gantt e Dashboard cliente',
    resumo: 'Três formas de olhar o andamento: por contrato, no cronograma e como o cliente enxerga.',
    passos: [
      { t: 'Em "Avanço físico" veja o percentual executado por contrato e por empresa.', alvo: '#avancoResumo' },
      { t: 'No "Cronograma (Gantt)" mude o zoom e a frente (galpão, anexos). As barras mostram previsto e realizado.', alvo: '#segGanZoom', aba: 'gantt' },
      { t: 'O "Dashboard cliente" compara previsto × realizado por serviço, com curva S. O contrato de cada linha pode ser ajustado na própria tabela.', alvo: '#gCurvaS', aba: 'cliente' },
    ] },

  { id: 'metas', mod: 'prod', aba: 'metas', titulo: 'Metas e tendências',
    resumo: 'Metas semanais por serviço e os gráficos de tendência.',
    passos: [
      { t: 'Em "Metas" navegue pelas semanas e ajuste a meta por dia de cada serviço. "Propagar" repete a meta para as semanas seguintes.', alvo: '#tabMetas' },
      { t: 'Clique em Salvar para gravar as metas.', alvo: '#btnSalvarMetas' },
      { t: 'Em "Tendências" escolha o serviço e compare atingimento, produção e comparativo entre empresas.', alvo: '#selServ', aba: 'tendencia' },
    ] },

  { id: 'estmat', mod: 'sup', aba: 'estmat', titulo: 'Materiais',
    resumo: 'O cadastro de tudo o que a obra compra: cada item tem uma TAG, local, quantidade planejada e situação.',
    passos: [
      { t: 'Use os filtros (local, tipo, etapa, situação) e a busca para achar o item.', alvo: '#estMatFiltro' },
      { t: 'Clique na TAG para editar o item num pop-up. Itens de fixador (parafuso, porca, arruela) também aparecem em Consumo físico e Inventário.', alvo: '#tabEstMat' },
      { t: 'Marque várias linhas para mudar o local, mudar o tipo ou excluir de uma vez. Itens com recebimento ou consumo só são excluídos se você marcar a opção de forçar.' },
    ] },

  { id: 'estrem', mod: 'sup', aba: 'estrem', titulo: 'Remessas de carga e de fixador',
    resumo: 'O que chegou na obra, remessa a remessa. Carga (estrutura) e fixador ficam em telas separadas.',
    passos: [
      { t: 'Alterne entre "Remessas de carga" e "Remessas de fixador".', alvo: '#segRemTipo' },
      { t: '"+ Remessa" cria uma coluna nova no tipo certo; digite a quantidade recebida em cada item.', alvo: '#btnNovaRemessaCarga' },
      { t: 'Os totais por TAG alimentam o Materiais e os alertas de falta.', alvo: '#tabEstRem' },
    ] },

  { id: 'estcons', mod: 'sup', aba: 'estcons', titulo: 'Consumo físico',
    resumo: 'O consumo semanal de material por empresa (EJ e CMM), item a item.',
    passos: [
      { t: '"+ Registrar consumo" cria a semana. O período (de/até) é obrigatório — o relatório de suprimentos usa essa data.', alvo: '#btnNovoConsumo' },
      { t: 'Edite qualquer célula direto na tabela: clique, digite e Enter. Vazio limpa o valor.', alvo: '#estConsFiltro' },
      { t: '"✎ Editar coluna" no cabeçalho da semana renomeia, ajusta vários itens de uma vez ou exclui a semana.' },
      { t: '"Relatório de consumo" escolhe empresa, semanas e itens e gera o PDF.', alvo: '#btnRelConsumo' },
    ] },

  { id: 'baixa', mod: 'sup', aba: 'estsis', titulo: 'Inventário e baixa automática',
    resumo: 'O sistema calcula o consumo "virtual" a partir da produção e dos apontamentos e compara com o físico.',
    passos: [
      { t: 'O Inventário mostra o saldo por TAG (planejado, chegou, consumo).', alvo: '#tabEstInv', aba: 'estinv' },
      { t: '"Consumo Joists" acompanha o consumo de joists pelo que foi montado.', alvo: '#tabEstCrit', aba: 'estcrit' },
      { t: '"Baixa automática" lista os eventos de baixa gerados pelo IFC e pelos apontamentos.', alvo: '#tabEstEventos' },
    ],
    dica: 'Apontar uma viga ou joist já baixa os parafusos, porcas e arruelas do kit dela.' },

  { id: 'vinculos', mod: 'sup', aba: 'estvinc', titulo: 'Vínculos e Pronto para iniciar',
    resumo: 'Liga cada material à atividade que o consome e mostra se há material para começar cada atividade.',
    passos: [
      { t: 'Em "Vínculos" cada grupo (produto + local) recebe uma atividade do catálogo do BM. O sistema sugere; você confirma, corrige ou ignora.', alvo: '#vcCorpo' },
      { t: 'Cada confirmação registra quem confirmou e quando. Há botão para confirmar todas as sugestões de confiança alta.' },
      { t: '"Pronto para iniciar" mostra, por atividade, o material pronto, o que limita o início e o status (pronto, parcial, falta material).', alvo: '#vpCorpo', aba: 'estpronto' },
    ] },

  { id: 'equip', mod: 'fin', aba: 'equip', titulo: 'Equipamentos e combustível',
    resumo: 'Cadastro de equipamentos (mensais e diários), uso diário e abastecimento.',
    passos: [
      { t: 'Os cartões resumem custo, dias de uso e combustível do período.', alvo: '#eqTiles' },
      { t: 'Filtre por empresa, equipamento ou tipo de uso.', alvo: '#eqFiltros' },
      { t: '"Relatório de equipamentos" permite escolher só abastecimento, só equipamento ou os dois.', alvo: '#btnRelEquip' },
    ],
    dica: 'Equipamento mensal com responsável aparece como "locação mensal" no BM; o uso diário dele não é cobrado em duplicidade.' },

  { id: 'bm', mod: 'fin', aba: 'bm', titulo: 'Medição (BM)',
    resumo: 'O boletim de medição de cada empresa: catálogo de atividades, quantidades, valores e descontos.',
    passos: [
      { t: 'Escolha a empresa e a sub-aba (Boletim, Catálogo de atividades…).', alvo: '#segBmEmp' },
      { t: 'O Boletim mostra o resumo do período (ganho, gasto, resultado) e a tabela por item e atividade, com "% do contrato".', alvo: '#bmCorpo' },
      { t: 'O Catálogo de atividades define quantidade, peso e valor de cada atividade. O peso é digitado de 0 a 1 (0,25 = 25%).', alvo: '#segBmSub' },
      { t: '"Baixar BM" abre o boletim na visualização padrão, com o nome da empresa terceirizada em destaque.' },
    ] },

  { id: 'proj', mod: 'fin', aba: 'proj', titulo: 'Projeção e cronograma físico-financeiro',
    resumo: 'Simula quanto cada plano vai render em R$ e compara com o cronograma contratado.',
    passos: [
      { t: 'Na Projeção escolha o plano, a empresa e a produtividade (40% a 200%). O ritmo atual projeta o término.', alvo: '#projCorpo' },
      { t: 'O preço unitário vem do catálogo do BM; se faltar, digite na tabela.' },
      { t: 'O "Cronograma físico-financeiro" mostra previsto, realizado e projetado por semana ou mês, no geral e por empresa.', alvo: '#cffCorpo', aba: 'cff' },
      { t: 'Os dois têm botão de relatório em PDF.' },
    ] },

  { id: 'impactos', mod: 'ges', aba: 'impactos', titulo: 'Impactos',
    resumo: 'Registro de tudo que atrasa ou para a obra, com responsável, tempo perdido e solução.',
    passos: [
      { t: '"+ Novo impacto": marque primeiro a(s) empresa(s); o serviço oferece só os serviços delas. No setor "Fornecedor" informe qual fornecedor.', alvo: '#btnNovoImp' },
      { t: 'O formulário mostra o efeito cascata nas atividades seguintes do fluxo.', alvo: '#filtroImp' },
      { t: 'Para solucionar, informe a data, "Como foi solucionado" e "Solucionado por". Reabrir apaga esses dados.' },
      { t: '"Relatório de impactos" traz o ranking por setor e por empresa, em dias úteis do período.', alvo: '#btnRelImp' },
    ] },

  { id: 'dp', mod: 'ges', aba: 'dp', titulo: 'Efetivo (DP)',
    resumo: 'Quantas pessoas trabalharam por dia, empresa e função.',
    passos: [
      { t: 'Escolha a empresa e lance o efetivo de cada dia na tabela.', alvo: '#segDpEmp' },
      { t: 'O resumo consolidado usa o PICO do período por cargo, não a soma dos dias.', alvo: '#dpResumo' },
      { t: '"Relatório de efetivo" gera o PDF.', alvo: '#btnRelDP' },
    ] },

  { id: 'pdf', mod: 'rel', aba: 'painel', titulo: 'Baixar relatórios em PDF',
    resumo: 'Todos os relatórios abrem primeiro numa visualização. Nada é baixado até você pedir.',
    passos: [
      { t: 'Clique no botão do relatório (por exemplo, "Relatório das empresas"). As caixas de data ao lado definem o período.', alvo: '#btnRelEmpresas' },
      { t: 'Na visualização, confira o documento. "Baixar PDF" gera o arquivo; "Imprimir" abre o diálogo do navegador; "Fechar" sai sem baixar.' },
      { t: 'A geração do PDF pode levar alguns segundos em relatórios grandes: aguarde o aviso de conclusão.' },
    ],
    dica: 'Exportações em CSV (planejamento, projeção) e o backup do administrador são arquivos diretos, não relatórios.' },
];

// ------------------------------------------------------------ progresso
function tutTopico(id) { return TUT_TOPICOS.find(t => t.id === id); }
function tutFeitosDe(id) { return Array.isArray(TUT.feitos[id]) ? TUT.feitos[id] : []; }
function tutPassoFeito(id, i) { return tutFeitosDe(id).includes(i); }
function tutEstado(t) {
  const n = tutFeitosDe(t.id).filter(i => i < t.passos.length).length;
  return n >= t.passos.length ? 'ok' : n > 0 ? 'meio' : 'zero';
}
function tutTotais() {
  let n = 0, m = 0;
  TUT_TOPICOS.forEach(t => { m += t.passos.length; n += tutFeitosDe(t.id).filter(i => i < t.passos.length).length; });
  return { n, m, pct: m ? Math.round(n / m * 100) : 0 };
}
function tutMarcar(id, i, valor) {
  const t = tutTopico(id);
  const s = new Set(tutFeitosDe(id));
  if (valor) s.add(i); else s.delete(i);
  const lista = [...s].filter(k => k < t.passos.length).sort((a, b) => a - b);
  if (lista.length) TUT.feitos[id] = lista; else delete TUT.feitos[id];
  tutAgendarSalvar();
}
function tutAgendarSalvar() {
  clearTimeout(TUT.salvarT);
  TUT.salvarT = setTimeout(async () => {
    try {
      const j = await postarBruto(API + 'configuracoes', { acao: 'tutorial', tutorial: TUT.feitos });
      if (typeof CFG !== 'undefined' && CFG.dados) CFG.dados.tutorial = j.tutorial || {};
    } catch (e) { toast('Não foi possível gravar o progresso do tutorial: ' + e.message, true); }
  }, 500);
}
async function tutCarregar() {
  if (TUT.carregado) return;
  try {
    const c = (typeof cfgCarregar === 'function') ? await cfgCarregar() : await fetch(API + 'configuracoes', { cache: 'no-store' }).then(r => r.json());
    TUT.feitos = (c && c.tutorial && typeof c.tutorial === 'object' && !Array.isArray(c.tutorial)) ? c.tutorial : {};
  } catch (e) { TUT.feitos = {}; }
  TUT.carregado = true;
}

// ------------------------------------------------------------ tela
function tutTextoBusca(t) { return [t.titulo, tx(t.titulo), t.resumo, ...t.passos.map(p => p.t), t.dica || ''].join(' ').toLowerCase(); }
function tutNorm(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }

function tutListaHtml() {
  const q = tutNorm(TUT.busca.trim());
  let h = '', achou = 0;
  TUT_MODULOS.forEach(m => {
    const ts = TUT_TOPICOS.filter(t => t.mod === m.id && (!q || tutNorm(tutTextoBusca(t)).includes(q)));
    if (!ts.length) return;
    const feitos = ts.filter(t => tutEstado(t) === 'ok').length;
    h += `<div class="tut-mod"><b>${esc(tx(m.nome))}</b><span>${feitos}/${ts.length}</span></div>`;
    ts.forEach(t => {
      achou++;
      const e = tutEstado(t);
      h += `<button type="button" class="tut-item${t.id === TUT.topico ? ' ativo' : ''}" data-tut-top="${t.id}"><i class="tut-marca tut-${e}" aria-hidden="true">${e === 'ok' ? '✓' : e === 'meio' ? '◐' : '○'}</i><span>${esc(tx(t.titulo))}</span></button>`;
    });
  });
  return achou ? h : `<p class="nota">${esc(tx('Nenhum tópico encontrado.'))}</p>`;
}

function tutProgressoHtml() {
  const g = tutTotais();
  return `<div class="tut-prog"><b>${esc(tx('Seu progresso'))}</b><div class="tut-barra" role="progressbar" aria-valuenow="${g.pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${g.pct}%"></i></div><span>${g.pct}% · ${esc(tx('{n} de {m} passos concluídos', { n: g.n, m: g.m }))}</span></div>`;
}

function tutDetalheHtml() {
  const t = tutTopico(TUT.topico) || TUT_TOPICOS[0];
  const e = tutEstado(t), mod = TUT_MODULOS.find(m => m.id === t.mod);
  const aviso = window.I18N_COD !== 'pt' ? `<p class="nota tut-aviso">${esc(tx('O texto do tutorial está disponível em português; os títulos e a interface estão traduzidos.'))}</p>` : '';
  return `<div class="tut-cab"><span class="tut-modrot">${esc(tx(mod.nome))}</span><span class="tut-estado tut-${e}">${esc(tx(e === 'ok' ? 'Concluído' : e === 'meio' ? 'Em andamento' : 'Não iniciado'))}</span></div>
    <h3>${esc(tx(t.titulo))}</h3>
    <p class="tut-resumo">${esc(t.resumo)}</p>${aviso}
    <ol class="tut-passos">${t.passos.map((p, i) => `<li class="tut-passo${tutPassoFeito(t.id, i) ? ' feito' : ''}">
      <label><input type="checkbox" data-tut-passo="${i}"${tutPassoFeito(t.id, i) ? ' checked' : ''}><span>${esc(p.t)}</span></label>
      ${p.alvo ? `<button type="button" class="link tut-mostrar" data-tut-mostrar="${i}">${esc(tx('Guiar passo a passo'))} ›</button>` : ''}</li>`).join('')}</ol>
    ${t.dica ? `<div class="tut-dica"><b>${esc(tx('Dica'))}:</b> ${esc(t.dica)}</div>` : ''}
    <div class="tut-acoes">
      <button type="button" class="btn" data-tut-ir>${esc(tx('Abrir esta tela'))}</button>
      <button type="button" class="btn primario" data-tut-guia>${esc(tx('Guiar passo a passo'))}</button>
      <button type="button" class="btn" data-tut-todos="${e === 'ok' ? 0 : 1}">${esc(tx(e === 'ok' ? 'Desmarcar' : 'Marcar tudo como lido'))}</button>
    </div>`;
}

function tutAtualizar(so) {   // so: 'lista' | 'detalhe' | undefined (tudo)
  if (!so || so === 'lista') { const l = document.getElementById('tutLista'); if (l) l.innerHTML = tutListaHtml(); }
  if (!so || so === 'detalhe') { const d = document.getElementById('tutDetalhe'); if (d) d.innerHTML = tutDetalheHtml(); }
  const p = document.getElementById('tutProg'); if (p) p.innerHTML = tutProgressoHtml();
}

async function renderTutorial() {
  const corpo = document.getElementById('tutCorpo');
  if (!corpo) return;
  await tutCarregar();
  if (abaAtual !== 'tutorial') return;
  const h2 = document.querySelector('#aba-tutorial > .bloco-cab h2'); if (h2) h2.textContent = tx('Tutorial');
  document.getElementById('tutPdf').textContent = tx('Baixar tutorial (PDF)');
  document.getElementById('tutTour').textContent = tx('Começar visita guiada');
  if (!corpo.dataset.montado) {
    corpo.dataset.montado = '1';
    corpo.innerHTML = `<div class="bloco tut-topo"><div id="tutProg"></div><input type="search" id="tutBusca" class="input-filtro" placeholder="${esc(tx('Buscar no tutorial…'))}" autocomplete="off"></div>
      <div class="tut-grade"><nav class="bloco tut-lista" id="tutLista" aria-label="${esc(tx('Todos os tópicos'))}"></nav><article class="bloco tut-detalhe" id="tutDetalhe"></article></div>`;
    corpo.addEventListener('click', tutClique);
    corpo.addEventListener('change', tutMudou);
    corpo.querySelector('#tutBusca').addEventListener('input', ev => { TUT.busca = ev.target.value; tutAtualizar('lista'); });
  }
  tutAtualizar();
}

function tutClique(ev) {
  const b = ev.target.closest('[data-tut-top], [data-tut-ir], [data-tut-guia], [data-tut-todos], [data-tut-mostrar]');
  if (!b) return;
  const t = tutTopico(TUT.topico);
  if (b.dataset.tutTop) {
    TUT.topico = b.dataset.tutTop; tutAtualizar();
    if (window.innerWidth < 900) document.getElementById('tutDetalhe')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  } else if (b.hasAttribute('data-tut-ir')) mudarAba(t.aba);
  else if (b.hasAttribute('data-tut-guia')) tutIniciarTour(tutPassosDoTopico(t, 0));
  else if (b.dataset.tutMostrar !== undefined) tutIniciarTour(tutPassosDoTopico(t, Number(b.dataset.tutMostrar)));
  else if (b.dataset.tutTodos !== undefined) {
    const marcar = b.dataset.tutTodos === '1';
    t.passos.forEach((p, i) => tutMarcar(t.id, i, marcar));
    tutAtualizar();
  }
}
function tutMudou(ev) {
  const c = ev.target.closest('[data-tut-passo]');
  if (!c) return;
  tutMarcar(TUT.topico, Number(c.dataset.tutPasso), c.checked);
  tutAtualizar();
}

// ------------------------------------------------------------ visita guiada
function tutPassosDoTopico(t, desde) {
  return t.passos.map((p, i) => ({ top: t.id, i, aba: p.aba || t.aba, alvo: p.alvo || '', titulo: tx(t.titulo), texto: p.t, marca: true }))
    .filter(s => s.i >= desde);
}
function tutPassosGerais() {   // uma parada por tópico: abre a tela e destaca o primeiro elemento do tópico
  return TUT_TOPICOS.map(t => {
    const p = t.passos.find(x => x.alvo) || {};
    return { top: t.id, i: -1, aba: p.aba || t.aba, alvo: p.alvo || '', titulo: tx(t.titulo), texto: t.resumo, marca: false };
  });
}

function tutVisivel(el) {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}
function tutAguardarAlvo(sel, ok) {
  let n = 0;
  const tenta = () => {
    const el = sel ? document.querySelector(sel) : null;
    if (!sel || tutVisivel(el) || n++ >= 12) return ok(tutVisivel(el) ? el : null);
    setTimeout(tenta, 150);
  };
  tenta();
}

function tutIniciarTour(passos) {
  if (!passos.length) return;
  tutFecharTour(true);
  const ov = document.createElement('div');
  ov.id = 'tutOv'; ov.className = 'tut-ov';
  ov.innerHTML = '<div class="tut-foco" hidden></div><div class="tut-card" role="dialog" aria-modal="true" aria-live="polite" tabindex="-1"></div>';
  document.body.appendChild(ov);
  TUT.tour = { passos, k: 0, el: null, ov };
  TUT.tour.reposicionar = () => tutPosicionar();
  window.addEventListener('resize', TUT.tour.reposicionar);
  window.addEventListener('scroll', TUT.tour.reposicionar, true);
  TUT.tour.teclas = ev => {
    if (ev.key === 'Escape') tutFecharTour();
    else if (ev.key === 'ArrowRight' || ev.key === 'Enter') { ev.preventDefault(); tutTourIr(1); }
    else if (ev.key === 'ArrowLeft') { ev.preventDefault(); tutTourIr(-1); }
  };
  document.addEventListener('keydown', TUT.tour.teclas);
  tutTourMostrar();
}

function tutTourMostrar() {
  const T = TUT.tour; if (!T) return;
  const s = T.passos[T.k];
  if (abaAtual !== s.aba) mudarAba(s.aba);
  T.el = null;
  tutDesenharCard(s, true);
  tutAguardarAlvo(s.alvo, el => {
    if (TUT.tour !== T || T.passos[T.k] !== s) return;
    T.el = el;
    if (el) { try { el.scrollIntoView({ block: el.getBoundingClientRect().height > innerHeight * .7 ? 'nearest' : 'center', inline: 'nearest' }); } catch (e) { /* sem rolagem */ } }
    tutDesenharCard(s, false);
    tutPosicionar();
  });
}

function tutDesenharCard(s, carregando) {
  const T = TUT.tour; if (!T) return;
  const card = T.ov.querySelector('.tut-card');
  const ultimo = T.k === T.passos.length - 1;
  card.innerHTML = `<div class="tut-card-cab"><span>${esc(tx('Passo {n} de {m}', { n: T.k + 1, m: T.passos.length }))}</span><b>${esc(s.titulo)}</b></div>
    <p>${esc(s.texto)}</p>
    <div class="tut-card-bar">
      <button type="button" class="btn" data-tc="sair">${esc(tx('Sair da visita'))}</button><span class="espaco"></span>
      <button type="button" class="btn" data-tc="ant"${T.k === 0 ? ' disabled' : ''}>${esc(tx('Anterior'))}</button>
      <button type="button" class="btn primario" data-tc="prox">${esc(tx(ultimo ? 'Concluir' : 'Próximo'))}</button>
    </div>`;
  card.onclick = ev => {
    const b = ev.target.closest('[data-tc]'); if (!b) return;
    if (b.dataset.tc === 'sair') tutFecharTour();
    else tutTourIr(b.dataset.tc === 'prox' ? 1 : -1);
  };
  if (!carregando) card.querySelector('[data-tc=prox]')?.focus({ preventScroll: true });
}

function tutTourIr(d) {
  const T = TUT.tour; if (!T) return;
  const s = T.passos[T.k];
  if (d > 0 && s.marca) { tutMarcar(s.top, s.i, true); }
  const k = T.k + d;
  if (k < 0) return;
  if (k >= T.passos.length) { tutFecharTour(false, true); return; }
  T.k = k;
  tutTourMostrar();
}

function tutPosicionar() {
  const T = TUT.tour; if (!T) return;
  const foco = T.ov.querySelector('.tut-foco'), card = T.ov.querySelector('.tut-card');
  const W = innerWidth, H = innerHeight, cw = Math.min(380, W - 16);
  card.style.width = cw + 'px';
  const ch = card.offsetHeight || 160;   // altura medida já com a largura final
  const r = T.el && T.el.isConnected && tutVisivel(T.el) ? T.el.getBoundingClientRect() : null;
  if (!r) {   // sem elemento para destacar: card no centro, fundo escurecido
    foco.hidden = true; T.ov.classList.add('sem-foco');
    card.style.left = Math.max(8, (W - cw) / 2) + 'px'; card.style.top = Math.max(8, (H - ch) / 2) + 'px';
    return;
  }
  T.ov.classList.remove('sem-foco');
  const pad = 6;
  const fx = Math.max(0, r.left - pad), fy = Math.max(0, r.top - pad);
  foco.hidden = false;
  Object.assign(foco.style, { left: fx + 'px', top: fy + 'px', width: Math.min(W - fx, r.width + pad * 2) + 'px', height: Math.min(H - fy, r.height + pad * 2) + 'px' });
  let top;
  if (r.bottom + pad + 12 + ch <= H) top = r.bottom + pad + 12;
  else if (r.top - pad - 12 - ch >= 8) top = r.top - pad - 12 - ch;
  else top = H - ch - 12;   // alvo muito alto: card na parte de baixo da tela
  const left = Math.min(Math.max(8, r.left), W - cw - 8);
  card.style.left = left + 'px'; card.style.top = Math.max(8, Math.min(top, H - ch - 8)) + 'px';
}

function tutFecharTour(silencioso, concluiu) {
  const T = TUT.tour; if (!T) return;
  window.removeEventListener('resize', T.reposicionar);
  window.removeEventListener('scroll', T.reposicionar, true);
  document.removeEventListener('keydown', T.teclas);
  T.ov.remove();
  TUT.tour = null;
  if (silencioso) return;
  if (concluiu) toast(tx('Visita concluída!'));
  mudarAba('tutorial');   // volta ao tutorial com o progresso atualizado
}

// ------------------------------------------------------------ PDF
function tutHtml(escopo) {
  const mods = TUT_MODULOS.filter(m => escopo === 'tudo' || m.id === escopo);
  const quando = new Date().toLocaleString(window.I18N_LOCALE || 'pt-BR', { timeZone: 'America/Sao_Paulo' });
  const g = tutTotais();
  const indice = `<ol class="tut-pdf-ind">${mods.map(m => `<li><b>${esc(tx(m.nome))}</b>: ${TUT_TOPICOS.filter(t => t.mod === m.id).map(t => esc(tx(t.titulo))).join(' · ')}</li>`).join('')}</ol>`;
  const corpo = mods.map(m => `<h2>${esc(tx(m.nome))}</h2>` + TUT_TOPICOS.filter(t => t.mod === m.id).map(t => `<section class="tut-pdf-top">
      <h3>${esc(tx(t.titulo))} <small>· ${esc(tx(tutEstado(t) === 'ok' ? 'Concluído' : tutEstado(t) === 'meio' ? 'Em andamento' : 'Não iniciado'))}</small></h3>
      <p>${esc(t.resumo)}</p>
      <ol class="tut-pdf-passos">${t.passos.map((p, i) => `<li><span class="cx">${tutPassoFeito(t.id, i) ? '☑' : '☐'}</span> ${esc(p.t)}</li>`).join('')}</ol>
      ${t.dica ? `<p class="tut-pdf-dica"><b>${esc(tx('Dica'))}:</b> ${esc(t.dica)}</p>` : ''}
    </section>`).join('')).join('');
  const css = `<style>.tut-pdf-ind{margin:6px 0 4px 18px;padding:0}.tut-pdf-ind li{margin:3px 0}.tut-pdf-top{margin:0 0 14px;padding:10px 12px;border:1px solid #d5dbe3;border-radius:6px;page-break-inside:avoid;break-inside:avoid}
    .tut-pdf-top h3{margin:0 0 4px;font-size:14px}.tut-pdf-top h3 small{font-weight:400;color:#5b6775}.tut-pdf-top p{margin:4px 0}
    .tut-pdf-passos{margin:6px 0 4px 0;padding-left:20px}.tut-pdf-passos li{margin:4px 0;list-style:decimal}.tut-pdf-passos .cx{display:inline-block;width:1.2em;color:#1f3a5f}
    .tut-pdf-dica{background:#fff7e0;border-left:3px solid #d9a400;padding:5px 8px}</style>`;
  return tplDocumento({
    titulo: tx('Tutorial do sistema'), subtitulo: tx('Gerado em {d}', { d: quando }),
    meta: `${g.pct}% · ${tx('{n} de {m} passos concluídos', { n: g.n, m: g.m })}`,
    corpo: `<div class="pag">${indice}${corpo}</div>`, css });
}

async function tutGerarPdf(escopo) {
  try {
    await tplLogosCarregar();
    reAbrirPrevia(tutHtml(escopo), `tutorial-${hoje()}.html`, tx('Tutorial do sistema'));
  } catch (err) { toast('Não foi possível montar o tutorial: ' + err.message, true); }
}

document.addEventListener('click', ev => {
  if (ev.target.closest('#tutTour')) { tutIniciarTour(tutPassosGerais()); return; }
  if (ev.target.closest('#tutPdf')) {
    const d = document.getElementById('dlgTutPdf'); if (!d) return;
    const mod = TUT_TOPICOS.find(t => t.id === TUT.topico)?.mod || 'ini';
    d.querySelector('[data-tut-escopo=mod] span').textContent = tx('Só o módulo aberto') + ' (' + tx(TUT_MODULOS.find(m => m.id === mod).nome) + ')';
    d.querySelector('[data-tut-escopo=tudo] span').textContent = tx('Tudo');
    d.querySelector('h2').textContent = tx('Escolha o que entra no PDF');
    d.querySelector('[data-tut-cancelar]').textContent = tx('Cancelar');
    d.querySelector('button[type=submit]').textContent = tx('Gerar PDF');
    d.dataset.mod = mod;
    d.showModal();
  }
  if (ev.target.closest('[data-tut-cancelar]')) document.getElementById('dlgTutPdf')?.close();
});
document.addEventListener('submit', ev => {
  if (ev.target.id !== 'tutPdfForm') return;
  ev.preventDefault();
  const d = document.getElementById('dlgTutPdf');
  const v = ev.target.querySelector('input[name=escopo]:checked')?.value || 'tudo';
  d.close();
  tutGerarPdf(v === 'mod' ? d.dataset.mod : 'tudo');
});
