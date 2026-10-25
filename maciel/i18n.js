// Idiomas do sistema (2026-10-26): português (padrão), inglês e espanhol.
// Como funciona: o texto em português é a CHAVE. tx('texto') devolve a tradução do idioma escolhido em Configurações
// (ou o próprio texto, se não houver tradução). Menu, barra superior, Configurações e Tutorial usam tx() ou são
// traduzidos aqui; as demais telas e relatórios seguem em português e podem ser incluídos no dicionário aos poucos.
(function () {
  const IDIOMA = (window.IDIOMA || document.documentElement.lang || 'pt-BR');
  const COD = IDIOMA.startsWith('en') ? 'en' : IDIOMA.startsWith('es') ? 'es' : 'pt';

  const DICT = {
    en: {
      // menu e barra superior
      'GESTÃO DE OBRAS': 'CONSTRUCTION MANAGEMENT', 'Tarefas a fazer': 'To-do list', 'Painel': 'Dashboard', 'Programação semanal': 'Weekly schedule',
      'Lançamentos': 'Production entries', 'Apontar montagem': 'Record erection', 'Relatório diário (RDO)': 'Daily report (RDO)',
      'Planejamento de montagem': 'Erection planning', 'Avanço físico': 'Physical progress', 'Cronograma (Gantt)': 'Schedule (Gantt)',
      'Dashboard cliente': 'Client dashboard', 'Metas': 'Targets', 'Tendências': 'Trends', 'Produção': 'Production', 'Suprimentos': 'Supplies',
      'Materiais': 'Materials', 'Remessas': 'Shipments', 'Consumo físico': 'Physical consumption', 'Inventário': 'Inventory',
      'Consumo Joists': 'Joist consumption', 'Baixa automática': 'Automatic write-off', 'Vínculos': 'Links', 'Pronto para iniciar': 'Ready to start',
      'Consumo': 'Consumption', 'Financeiro': 'Financial', 'Equipamentos': 'Equipment', 'Medição (BM)': 'Measurement (BM)',
      'Projeção físico-financeira': 'Physical-financial projection', 'Cronograma físico-financeiro': 'Physical-financial schedule',
      'Gestão': 'Management', 'Impactos': 'Impacts', 'Pessoal': 'Workforce', 'SESMT GERAL': 'SESMT (SAFETY)', 'Painel SESMT': 'SESMT dashboard',
      'Colaboradores': 'Employees', 'ASO': 'ASO (medical exams)', 'Treinamentos': 'Training', 'Acidentes': 'Accidents', 'EPI': 'PPE', 'Fontes de dados': 'Data sources',
      'Geral': 'General', 'Tutorial': 'Tutorial', 'Configurações': 'Settings', 'Dashboard': 'Dashboard', 'Dashboard geral': 'General dashboard', 'Meu dashboard': 'My dashboard',
      'Administração': 'Administration', 'Sair': 'Sign out', 'Data de referência': 'Reference date', 'Hoje': 'Today', 'Data início': 'Start date',
      'Data fim': 'End date', 'Semana': 'Week', 'Mês': 'Month', 'Últimos 30 dias': 'Last 30 days', 'Obra toda': 'Whole project', 'Total': 'Total',
      'Semana anterior': 'Previous week', 'Próxima semana': 'Next week', 'Verificar atualização': 'Check for updates',
      '← Todas as obras': '← All projects', 'Administrar obra': 'Manage project', 'Conectando à planilha…': 'Connecting…',
      'Fase 1 – Galpão + Anexos': 'Phase 1 – Warehouse + Annexes', 'Fase 2 – Galpão F2': 'Phase 2 – Warehouse F2',
      'Guia interativo do sistema, com passo a passo e PDF': 'Interactive guide with step-by-step help and PDF',
      'Seus dados, senha, idioma e aparência': 'Your details, password, language and appearance',
      // Configurações
      'Seus dados, senha, idioma e aparência. Vale só para o seu usuário.': 'Your details, password, language and appearance. Applies to your user only.',
      'Carregando…': 'Loading…', 'Meu perfil': 'My profile', 'Nome': 'Name', 'Nome completo': 'Full name', 'Login': 'Login', 'O login não pode ser alterado.': 'The login cannot be changed.',
      'E-mail': 'E-mail', 'Usado para recuperar a senha.': 'Used to recover the password.', 'Perfil de acesso': 'Access profile', 'Empresa': 'Company',
      'Obras com acesso': 'Projects you can access', 'Áreas liberadas': 'Areas enabled', 'Administrador': 'Administrator', 'Editor': 'Editor', 'Somente leitura': 'Read only',
      'Salvar dados': 'Save details', 'Dados atualizados.': 'Details updated.', 'Alterar senha': 'Change password', 'Senha atual': 'Current password',
      'Nova senha': 'New password', 'Confirmar nova senha': 'Confirm new password', 'Mostrar senhas': 'Show passwords',
      'Mínimo de 8 caracteres. Use letras, números e símbolos.': 'At least 8 characters. Use letters, numbers and symbols.',
      'Força da senha:': 'Password strength:', 'muito fraca': 'very weak', 'fraca': 'weak', 'média': 'fair', 'forte': 'strong', 'muito forte': 'very strong',
      'Última troca de senha: {d}': 'Last password change: {d}', 'Preencha a senha atual, a nova e a confirmação.': 'Fill in the current password, the new one and the confirmation.',
      'A confirmação não confere com a nova senha.': 'The confirmation does not match the new password.', 'A nova senha precisa ter pelo menos 8 caracteres.': 'The new password must have at least 8 characters.',
      'Senha alterada. Use a nova senha no próximo acesso.': 'Password changed. Use the new password next time you sign in.',
      'Idioma e texto': 'Language and text', 'Idioma do sistema': 'System language', 'Português (Brasil)': 'Portuguese (Brazil)', 'English': 'English', 'Español': 'Spanish',
      'Tradução do menu, barra superior, Configurações e Tutorial. As telas de dados e os relatórios continuam em português por enquanto.':
        'Translates the menu, top bar, Settings and Tutorial. Data screens and reports remain in Portuguese for now.',
      'Tamanho do texto': 'Text size', 'Normal': 'Normal', 'Grande': 'Large', 'Maior': 'Larger',
      'Aparência': 'Appearance', 'Tema': 'Theme', 'Branco': 'White', 'Preto': 'Black', 'Espacial': 'Space', 'Névoa': 'Mist', 'Grafite': 'Graphite', 'Sálvia': 'Sage', 'Automático': 'Automatic',
      'Posição do menu': 'Menu position', 'Lateral': 'Side', 'Barra superior': 'Top bar', 'Salvar preferências': 'Save preferences', 'Preferências salvas.': 'Preferences saved.',
      'Tutorial e ajuda': 'Tutorial and help', 'Abrir o tutorial': 'Open the tutorial', 'Zerar meu progresso no tutorial': 'Reset my tutorial progress',
      'Progresso do tutorial zerado.': 'Tutorial progress reset.', 'Sessão': 'Session', 'Você está conectado como {nome} ({login}).': 'You are signed in as {nome} ({login}).',
      'Sair do sistema': 'Sign out of the system', 'Salvando…': 'Saving…', 'Não foi possível salvar.': 'Could not save.',
      // Tutorial
      'Baixar tutorial (PDF)': 'Download tutorial (PDF)', 'Começar visita guiada': 'Start guided tour', 'Buscar no tutorial…': 'Search the tutorial…',
      'Seu progresso': 'Your progress', '{n} de {m} passos concluídos': '{n} of {m} steps done', 'Abrir esta tela': 'Open this screen', 'Guiar passo a passo': 'Guide me step by step',
      'Marcar tudo como lido': 'Mark all as read', 'Desmarcar': 'Clear', 'Passo {n} de {m}': 'Step {n} of {m}', 'Anterior': 'Back', 'Próximo': 'Next', 'Concluir': 'Finish',
      'Sair da visita': 'Exit tour', 'Dica': 'Tip', 'Nenhum tópico encontrado.': 'No topics found.', 'Todos os tópicos': 'All topics',
      'O texto do tutorial está disponível em português; os títulos e a interface estão traduzidos.': 'The tutorial text is available in Portuguese; titles and interface are translated.',
      'Visita concluída!': 'Tour finished!', 'Tópico concluído': 'Topic completed', 'Concluído': 'Done', 'Em andamento': 'In progress', 'Não iniciado': 'Not started',
      'Avanço físico, Gantt e Dashboard cliente': 'Physical progress, Gantt and Client dashboard', 'Metas e tendências': 'Targets and trends',
      'Inventário e baixa automática': 'Inventory and automatic write-off', 'Projeção e cronograma físico-financeiro': 'Projection and physical-financial schedule',
      'Tutorial do sistema': 'System tutorial', 'Gerado em {d}': 'Generated on {d}', 'Escolha o que entra no PDF': 'Choose what goes in the PDF',
      'Tudo': 'Everything', 'Só o módulo aberto': 'Only the open module', 'Gerar PDF': 'Generate PDF', 'Cancelar': 'Cancel', 'Fechar': 'Close',
      'Começando': 'Getting started', 'Relatórios': 'Reports',
      'Conhecendo a tela': 'Getting to know the screen', 'Tarefas e mural da equipe': 'Tasks and team board', 'Configurações da conta': 'Account settings',
      'Baixar relatórios em PDF': 'Downloading PDF reports',
      'Painel e faróis': 'Dashboard and traffic lights', 'Programação semanal': 'Weekly schedule', 'Lançamentos de produção': 'Production entries',
      'Apontar montagem (mapa)': 'Record erection (map)', 'Planejamento 5W2H': '5W2H planning', 'Cronograma (Gantt)': 'Schedule (Gantt)',
      'Materiais': 'Materials', 'Remessas de carga e de fixador': 'Cargo and fastener shipments', 'Consumo físico': 'Physical consumption',
      'Vínculos e Pronto para iniciar': 'Links and Ready to start', 'Medição (BM)': 'Measurement (BM)', 'Projeção físico-financeira': 'Physical-financial projection',
      'Impactos': 'Impacts', 'Efetivo (DP)': 'Workforce (DP)', 'Equipamentos e combustível': 'Equipment and fuel', 'Relatório diário de obra (RDO)': 'Daily site report (RDO)',
    },
    es: {
      'GESTÃO DE OBRAS': 'GESTIÓN DE OBRAS', 'Tarefas a fazer': 'Tareas pendientes', 'Painel': 'Panel', 'Programação semanal': 'Programación semanal',
      'Lançamentos': 'Registros de producción', 'Apontar montagem': 'Registrar montaje', 'Relatório diário (RDO)': 'Informe diario (RDO)',
      'Planejamento de montagem': 'Planificación de montaje', 'Avanço físico': 'Avance físico', 'Cronograma (Gantt)': 'Cronograma (Gantt)',
      'Dashboard cliente': 'Panel del cliente', 'Metas': 'Metas', 'Tendências': 'Tendencias', 'Produção': 'Producción', 'Suprimentos': 'Suministros',
      'Materiais': 'Materiales', 'Remessas': 'Envíos', 'Consumo físico': 'Consumo físico', 'Inventário': 'Inventario',
      'Consumo Joists': 'Consumo de joists', 'Baixa automática': 'Baja automática', 'Vínculos': 'Vínculos', 'Pronto para iniciar': 'Listo para iniciar',
      'Consumo': 'Consumo', 'Financeiro': 'Financiero', 'Equipamentos': 'Equipos', 'Medição (BM)': 'Medición (BM)',
      'Projeção físico-financeira': 'Proyección físico-financiera', 'Cronograma físico-financeiro': 'Cronograma físico-financiero',
      'Gestão': 'Gestión', 'Impactos': 'Impactos', 'Pessoal': 'Personal', 'SESMT GERAL': 'SESMT (SEGURIDAD)', 'Painel SESMT': 'Panel SESMT',
      'Colaboradores': 'Colaboradores', 'ASO': 'ASO (exámenes médicos)', 'Treinamentos': 'Capacitaciones', 'Acidentes': 'Accidentes', 'EPI': 'EPP', 'Fontes de dados': 'Fuentes de datos',
      'Geral': 'General', 'Tutorial': 'Tutorial', 'Configurações': 'Configuración', 'Dashboard': 'Panel', 'Dashboard geral': 'Panel general', 'Meu dashboard': 'Mi panel',
      'Administração': 'Administración', 'Sair': 'Salir', 'Data de referência': 'Fecha de referencia', 'Hoje': 'Hoy', 'Data início': 'Fecha inicio',
      'Data fim': 'Fecha fin', 'Semana': 'Semana', 'Mês': 'Mes', 'Últimos 30 dias': 'Últimos 30 días', 'Obra toda': 'Toda la obra', 'Total': 'Total',
      'Semana anterior': 'Semana anterior', 'Próxima semana': 'Próxima semana', 'Verificar atualização': 'Buscar actualización',
      '← Todas as obras': '← Todas las obras', 'Administrar obra': 'Administrar obra', 'Conectando à planilha…': 'Conectando…',
      'Fase 1 – Galpão + Anexos': 'Fase 1 – Galpón + Anexos', 'Fase 2 – Galpão F2': 'Fase 2 – Galpón F2',
      'Guia interativo do sistema, com passo a passo e PDF': 'Guía interactiva con paso a paso y PDF',
      'Seus dados, senha, idioma e aparência': 'Sus datos, contraseña, idioma y apariencia',
      'Seus dados, senha, idioma e aparência. Vale só para o seu usuário.': 'Sus datos, contraseña, idioma y apariencia. Vale solo para su usuario.',
      'Carregando…': 'Cargando…', 'Meu perfil': 'Mi perfil', 'Nome': 'Nombre', 'Nome completo': 'Nombre completo', 'Login': 'Usuario', 'O login não pode ser alterado.': 'El usuario no se puede cambiar.',
      'E-mail': 'Correo electrónico', 'Usado para recuperar a senha.': 'Se usa para recuperar la contraseña.', 'Perfil de acesso': 'Perfil de acceso', 'Empresa': 'Empresa',
      'Obras com acesso': 'Obras con acceso', 'Áreas liberadas': 'Áreas habilitadas', 'Administrador': 'Administrador', 'Editor': 'Editor', 'Somente leitura': 'Solo lectura',
      'Salvar dados': 'Guardar datos', 'Dados atualizados.': 'Datos actualizados.', 'Alterar senha': 'Cambiar contraseña', 'Senha atual': 'Contraseña actual',
      'Nova senha': 'Nueva contraseña', 'Confirmar nova senha': 'Confirmar nueva contraseña', 'Mostrar senhas': 'Mostrar contraseñas',
      'Mínimo de 8 caracteres. Use letras, números e símbolos.': 'Mínimo 8 caracteres. Use letras, números y símbolos.',
      'Força da senha:': 'Fortaleza de la contraseña:', 'muito fraca': 'muy débil', 'fraca': 'débil', 'média': 'media', 'forte': 'fuerte', 'muito forte': 'muy fuerte',
      'Última troca de senha: {d}': 'Último cambio de contraseña: {d}', 'Preencha a senha atual, a nova e a confirmação.': 'Complete la contraseña actual, la nueva y la confirmación.',
      'A confirmação não confere com a nova senha.': 'La confirmación no coincide con la nueva contraseña.', 'A nova senha precisa ter pelo menos 8 caracteres.': 'La nueva contraseña debe tener al menos 8 caracteres.',
      'Senha alterada. Use a nova senha no próximo acesso.': 'Contraseña cambiada. Use la nueva contraseña en el próximo acceso.',
      'Idioma e texto': 'Idioma y texto', 'Idioma do sistema': 'Idioma del sistema', 'Português (Brasil)': 'Portugués (Brasil)', 'English': 'Inglés', 'Español': 'Español',
      'Tradução do menu, barra superior, Configurações e Tutorial. As telas de dados e os relatórios continuam em português por enquanto.':
        'Traduce el menú, la barra superior, Configuración y Tutorial. Las pantallas de datos y los informes siguen en portugués por ahora.',
      'Tamanho do texto': 'Tamaño del texto', 'Normal': 'Normal', 'Grande': 'Grande', 'Maior': 'Mayor',
      'Aparência': 'Apariencia', 'Tema': 'Tema', 'Branco': 'Blanco', 'Preto': 'Negro', 'Espacial': 'Espacial', 'Névoa': 'Niebla', 'Grafite': 'Grafito', 'Sálvia': 'Salvia', 'Automático': 'Automático',
      'Posição do menu': 'Posición del menú', 'Lateral': 'Lateral', 'Barra superior': 'Barra superior', 'Salvar preferências': 'Guardar preferencias', 'Preferências salvas.': 'Preferencias guardadas.',
      'Tutorial e ajuda': 'Tutorial y ayuda', 'Abrir o tutorial': 'Abrir el tutorial', 'Zerar meu progresso no tutorial': 'Reiniciar mi progreso en el tutorial',
      'Progresso do tutorial zerado.': 'Progreso del tutorial reiniciado.', 'Sessão': 'Sesión', 'Você está conectado como {nome} ({login}).': 'Está conectado como {nome} ({login}).',
      'Sair do sistema': 'Salir del sistema', 'Salvando…': 'Guardando…', 'Não foi possível salvar.': 'No se pudo guardar.',
      'Baixar tutorial (PDF)': 'Descargar tutorial (PDF)', 'Começar visita guiada': 'Iniciar visita guiada', 'Buscar no tutorial…': 'Buscar en el tutorial…',
      'Seu progresso': 'Su progreso', '{n} de {m} passos concluídos': '{n} de {m} pasos completados', 'Abrir esta tela': 'Abrir esta pantalla', 'Guiar passo a passo': 'Guiarme paso a paso',
      'Marcar tudo como lido': 'Marcar todo como leído', 'Desmarcar': 'Desmarcar', 'Passo {n} de {m}': 'Paso {n} de {m}', 'Anterior': 'Anterior', 'Próximo': 'Siguiente', 'Concluir': 'Finalizar',
      'Sair da visita': 'Salir de la visita', 'Dica': 'Consejo', 'Nenhum tópico encontrado.': 'No se encontraron temas.', 'Todos os tópicos': 'Todos los temas',
      'O texto do tutorial está disponível em português; os títulos e a interface estão traduzidos.': 'El texto del tutorial está disponible en portugués; los títulos y la interfaz están traducidos.',
      'Visita concluída!': '¡Visita finalizada!', 'Tópico concluído': 'Tema completado', 'Concluído': 'Completado', 'Em andamento': 'En curso', 'Não iniciado': 'No iniciado',
      'Avanço físico, Gantt e Dashboard cliente': 'Avance físico, Gantt y Panel del cliente', 'Metas e tendências': 'Metas y tendencias',
      'Inventário e baixa automática': 'Inventario y baja automática', 'Projeção e cronograma físico-financeiro': 'Proyección y cronograma físico-financiero',
      'Tutorial do sistema': 'Tutorial del sistema', 'Gerado em {d}': 'Generado el {d}', 'Escolha o que entra no PDF': 'Elija qué incluir en el PDF',
      'Tudo': 'Todo', 'Só o módulo aberto': 'Solo el módulo abierto', 'Gerar PDF': 'Generar PDF', 'Cancelar': 'Cancelar', 'Fechar': 'Cerrar',
      'Começando': 'Primeros pasos', 'Relatórios': 'Informes',
      'Conhecendo a tela': 'Conociendo la pantalla', 'Tarefas e mural da equipe': 'Tareas y mural del equipo', 'Configurações da conta': 'Configuración de la cuenta',
      'Baixar relatórios em PDF': 'Descargar informes en PDF',
      'Painel e faróis': 'Panel y semáforos', 'Lançamentos de produção': 'Registros de producción',
      'Apontar montagem (mapa)': 'Registrar montaje (mapa)', 'Planejamento 5W2H': 'Planificación 5W2H',
      'Remessas de carga e de fixador': 'Envíos de carga y de fijadores', 'Vínculos e Pronto para iniciar': 'Vínculos y Listo para iniciar',
      'Efetivo (DP)': 'Personal (DP)', 'Equipamentos e combustível': 'Equipos y combustible', 'Relatório diário de obra (RDO)': 'Informe diario de obra (RDO)',
    },
  };

  const dic = DICT[COD] || null;
  function tx(pt, vars) {
    let r = (dic && Object.prototype.hasOwnProperty.call(dic, pt)) ? dic[pt] : pt;
    if (vars) r = r.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
    return r;
  }
  window.tx = tx;
  window.I18N_COD = COD;
  window.I18N_LOCALE = COD === 'en' ? 'en-US' : COD === 'es' ? 'es-ES' : 'pt-BR';

  if (!dic) return;   // português: nada a traduzir na tela

  // Camada que traduz o texto que já está no HTML (menu, topo, caixa do usuário). Só nós de texto inteiros e iguais a uma chave
  // do dicionário; o resto (dados, tabelas, relatórios) não é tocado, para não quebrar nenhuma regra que leia o texto da tela.
  const RAIZES = ['#sidebar', 'header.topo', '.obra-contexto', '#barraPeriodo', '#faseCaixaLista'];
  const ATTRS = ['title', 'aria-label', 'placeholder'];

  function traduzTexto(n) {
    const atual = n.nodeValue;
    if (n.__tr !== undefined && atual === n.__tr) return;
    const chave = atual.trim();
    if (!chave || !Object.prototype.hasOwnProperty.call(dic, chave)) return;
    n.__pt = chave;
    n.__tr = atual.replace(chave, dic[chave]);
    n.nodeValue = n.__tr;
  }
  function traduzAttrs(el) {
    for (const a of ATTRS) {
      if (!el.hasAttribute || !el.hasAttribute(a)) continue;
      const v = (el.getAttribute(a) || '').trim();
      if (el['__a_' + a] === v) continue;
      if (Object.prototype.hasOwnProperty.call(dic, v)) { el.setAttribute(a, dic[v]); el['__a_' + a] = dic[v]; }
    }
  }
  function varre(raiz) {
    if (!raiz) return;
    if (raiz.nodeType === 3) { traduzTexto(raiz); return; }
    if (raiz.nodeType !== 1) return;
    traduzAttrs(raiz);
    const w = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let n;
    while ((n = w.nextNode())) { if (n.nodeType === 3) traduzTexto(n); else traduzAttrs(n); }
  }
  function iniciar() {
    const raizes = RAIZES.map(s => document.querySelector(s)).filter(Boolean);
    raizes.forEach(varre);
    document.title = document.title.replace('Gestão de Obras', tx('GESTÃO DE OBRAS').replace(/\b(\w)(\w*)/g, (m, a, b) => a + b.toLowerCase()));
    const obs = new MutationObserver(muts => {
      for (const m of muts) {
        if (m.type === 'characterData') traduzTexto(m.target);
        else if (m.type === 'attributes') traduzAttrs(m.target);
        else m.addedNodes.forEach(varre);
      }
    });
    raizes.forEach(r => obs.observe(r, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS }));
    const ub = document.getElementById('usuarioBox');
    if (ub && !raizes.includes(ub) && !raizes.some(r => r.contains(ub))) { varre(ub); obs.observe(ub, { childList: true, subtree: true, characterData: true }); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
