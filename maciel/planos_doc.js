'use strict';
// ------------------------------------------------------------------------------------------------
// PLANEJAMENTO — DOCUMENTO PARA BAIXAR (botão "Baixar planejamento" da aba Planejamento)
// Gera um arquivo HTML único (abre em qualquer navegador; Ctrl+P salva em PDF) com: resumo, fluxo executivo,
// cada atividade explicada na ordem do fluxo da obra, situação atual e o impacto de não alcançar o objetivo.
// Depende de planos.js e app.js: PL, plCalc, plPlano, plDias, plFmt, plFmtTaxa, plBase, ganNorm, contarDiasUteis,
// somarDiasUteis, fdA, esc, cap, nf, toast.
// ------------------------------------------------------------------------------------------------

// ---------------------------------------------------------------- base de conhecimento: etapas do fluxo
// Fluxo do galpão principal e dos anexos, na ordem de execução. `apoio` = etapa sem linha própria no cronograma.
const PLD_FLUXOS = {
  galpao: {
    nome: 'Galpão principal',
    etapas: [
      { id: 'g1', nome: 'Chegada de material', apoio: 'Etapa de apoio: acompanhe pelo módulo Estoque (remessas, saldo e alertas) e confirme as datas de entrega com o fornecedor.',
        oque: 'Recebimento na obra dos materiais da frente (joists, vigas, terças, telhas, calhas, rufos e fixadores) conforme romaneio e cronograma de remessas.',
        importa: 'É a largada de toda a cadeia: nenhuma etapa produz sem material em campo na data certa e na quantidade certa.',
        impacto: ['<b>Prazo:</b> equipe e equipamentos parados esperando material; cada dia sem entrega desloca todas as etapas seguintes.',
          '<b>Custo:</b> mão de obra e guindaste em espera (standby), horas improdutivas e possível mobilização duplicada.',
          '<b>Qualidade:</b> entregas fora de sequência obrigam a montar “o que tem” e não “o que deve”, gerando retrabalho.'],
        recupera: ['Cobrar o fornecedor com o cronograma de remessas por rua/eixo e data.', 'Revisar semanalmente o saldo do Estoque contra o consumo previsto.', 'Priorizar a antecipação do material que libera o caminho crítico.'] },
      { id: 'g2', nome: 'Descarregamento', apoio: 'Etapa de apoio: sem linha própria no cronograma; acompanhe pelo recebimento das remessas e pelo conferido no Estoque.',
        oque: 'Descarga dos caminhões com conferência de nota fiscal, quantidade, identificação e avarias, e armazenamento organizado por tipo, rua e eixo.',
        importa: 'Material conferido e bem armazenado evita perda de tempo na montagem e descobre falta ou avaria a tempo de repor.',
        impacto: ['<b>Prazo:</b> caminhão retido, descarga lenta e material misturado atrasam a pré-montagem e a montagem.',
          '<b>Custo:</b> estadia de caminhão e movimentação dupla de peças.', '<b>Qualidade/segurança:</b> avaria ou falta descoberta tarde; peças empilhadas sem critério oferecem risco de acidente.'],
        recupera: ['Definir área de descarga e de estoque por rua/eixo antes da chegada.', 'Conferir no ato e lançar a remessa no sistema no mesmo dia.', 'Escalonar entregas para não saturar o equipamento de descarga.'] },
      { id: 'g3', nome: 'Pré-montagem de joist',
        oque: 'Montagem em solo dos conjuntos de joist (ligações, apoios, travessas e fixadores do kit), deixando-os prontos para o içamento.',
        importa: 'Trabalhar no chão é mais rápido, seguro e controlável do que em altura; forma o “pulmão” de joists prontas que mantém o guindaste produzindo.',
        impacto: ['<b>Prazo:</b> o pulmão de joists prontas acaba e o içamento para (guindaste parado) ou passa a montar em altura, bem mais lento.',
          '<b>Segurança:</b> mais trabalho em altura, aumentando exposição a risco.', '<b>Custo:</b> guindaste e equipe de içamento ociosos; retrabalho de ajuste em altura.'],
        recupera: ['Reforçar a equipe de pré-montagem ou abrir segundo turno/frente de montagem em solo.', 'Priorizar a pré-montagem na ordem do içamento (rua a rua).', 'Verificar se há kit de fixadores completo antes de iniciar cada lote.'] },
      { id: 'g4', nome: 'Montagem de vigas',
        oque: 'Içamento e instalação das vigas de cobertura sobre os pilares, com prumo, alinhamento e torque dos parafusos.',
        importa: 'As vigas são o apoio das joists: sem elas não há onde assentar a cobertura. Compõem o caminho crítico da estrutura.',
        impacto: ['<b>Prazo:</b> joists não podem ser içadas sem as vigas do vão; o atraso se propaga integralmente até as telhas.',
          '<b>Qualidade:</b> pressa gera desalinhamento e retrabalho de torque e prumo que aparece só no checklist.', '<b>Custo:</b> guindaste alugado parado ou subutilizado e janela de equipamento perdida.'],
        recupera: ['Garantir guindaste e equipe de montagem dedicados às vigas no período.', 'Montar as vigas na frente do içamento de joists (rua adiantada).', 'Apontar a produção diária para detectar queda de ritmo cedo.'] },
      { id: 'g5', nome: 'Montagem de joist',
        oque: 'Içamento, posicionamento e fixação das joists entre as vigas, conforme o plano de montagem por rua.',
        importa: 'Forma o vão da cobertura e é a atividade de maior produção em unidades por dia; é gargalo típico e puxa contraventamento, checklist e telhas.',
        impacto: ['<b>Prazo:</b> cada dia perdido desloca o contraventamento, o checklist e a cobertura inteira — é caminho crítico direto.',
          '<b>Qualidade:</b> com prazo apertado, cresce o risco de montagem sem o travamento provisório adequado.', '<b>Contrato/BM:</b> atrasa a medição do item de joists e o faturamento associado.'],
        recupera: ['Aumentar a meta/dia com segunda frente de içamento ou turno estendido, se a segurança permitir.', 'Manter o pulmão de joists pré-montadas sempre à frente do guindaste.', 'Eliminar paradas: calços, acessos e plano de içamento liberados antes.'] },
      { id: 'g6', nome: 'Contraventamentos',
        oque: 'Instalação dos travamentos (barras em X e travessas) que dão estabilidade global e lateral à estrutura de cobertura.',
        importa: 'Sem contraventamento a estrutura não é estável nem para receber as telhas; é condição de liberação do checklist.',
        impacto: ['<b>Segurança:</b> risco de instabilidade lateral e flambagem durante a montagem e sob vento — a consequência mais grave desta etapa.',
          '<b>Prazo:</b> o checklist não é liberado e a cobertura não pode ser fechada.', '<b>Contrato:</b> possível embargo da fiscalização/projetista até regularizar.'],
        recupera: ['Instalar o contraventamento provisório já durante o içamento e o definitivo logo após cada trecho.', 'Controlar por eixo/trecho (mapa de contraventamento do sistema).', 'Não liberar telhas sem o trecho contraventado e conferido.'] },
      { id: 'g7', nome: 'Checklist', apoio: 'Etapa de controle: sem linha própria no cronograma; registre a verificação (prumo, alinhamento, torque, contraventamento, retoque) e as fotos como evidência.',
        oque: 'Verificação final da estrutura montada (prumo, alinhamento, nível, torque de parafusos, soldas, contraventamentos e retoque de pintura), com registro e evidências.',
        importa: 'É o portão de qualidade que libera a cobertura: garante que a estrutura está correta antes de ser coberta e de ser medida.',
        impacto: ['<b>Qualidade/custo:</b> telha instalada sobre estrutura não conferida vira retrabalho com desmontagem de cobertura — o mais caro da obra.',
          '<b>Contrato/BM:</b> sem evidência não há aceite do cliente nem medição da estrutura.', '<b>Prazo:</b> pendências descobertas depois paralisam as telhas.'],
        recupera: ['Fazer o checklist por trechos, em paralelo à montagem, e não só no final.', 'Corrigir as não conformidades antes de liberar a telha daquele trecho.', 'Guardar fotos e assinatura por eixo/rua.'] },
      { id: 'g8', nome: 'Perfilação de telhas',
        oque: 'Fabricação das telhas na obra (perfiladora) nos comprimentos sob medida, em m², formando o estoque para a montagem.',
        importa: 'Precisa andar adiantada em relação à montagem de telhas: é ela que mantém a equipe de cobertura sempre com material.',
        impacto: ['<b>Prazo:</b> a equipe de montagem de telhas fica sem peça e a cobertura não fecha na data.',
          '<b>Custo:</b> equipe ociosa e equipamento de perfilação com horas pagas sem produzir.', '<b>Qualidade:</b> perfilar às pressas aumenta erro de medida e perda de bobina.'],
        recupera: ['Programar a perfilação com folga sobre a montagem (estoque de pelo menos alguns dias).', 'Garantir bobinas, mão de obra e energia da perfiladora.', 'Perfilar na ordem de montagem por rua/água.'] },
      { id: 'g9', nome: 'Montagem de telhas',
        oque: 'Instalação das telhas de cobertura com fixação, sobreposição e vedação, em m².',
        importa: 'Torna a obra estanque, libera os serviços internos e é um dos marcos mais visíveis para o cliente.',
        impacto: ['<b>Prazo/contrato:</b> marco contratual da cobertura; atraso gera multa, pressão do cliente e atrasa as disciplinas internas.',
          '<b>Qualidade:</b> obra exposta à chuva danifica pisos e equipamentos e gera infiltração.', '<b>Cascata:</b> calhas, rufos e acabamentos dependem das telhas.'],
        recupera: ['Aumentar equipes e frentes de telhamento, mantendo a perfilação adiantada.', 'Trabalhar por água completa para entregar trechos já estanques.', 'Planejar janelas de clima e plano de contingência contra chuva.'] },
      { id: 'g10', nome: 'Instalação de suporte do fechamento lateral',
        oque: 'Fixação na estrutura dos suportes (consoles/mãos-francesas) que sustentam as terças do fechamento lateral.',
        importa: 'O alinhamento dos suportes define o prumo do fechamento inteiro; erro aqui aparece nas telhas laterais.',
        impacto: ['<b>Prazo:</b> as terças do fechamento não têm onde ser fixadas.', '<b>Qualidade:</b> suportes fora de prumo geram fachada ondulada e retrabalho nas telhas.',
          '<b>Custo:</b> refazer suporte já com terça montada é caro e lento.'],
        recupera: ['Liberar a topografia e a marcação dos eixos antes de instalar.', 'Montar por fachada completa, conferindo prumo a cada trecho.'] },
      { id: 'g11', nome: 'Terças do fechamento lateral',
        oque: 'Montagem das terças horizontais do fechamento lateral sobre os suportes, que recebem as telhas das fachadas.',
        importa: 'É a estrutura secundária da fachada: sem ela as telhas laterais não têm fixação.',
        impacto: ['<b>Prazo:</b> bloqueia as telhas do fechamento lateral e a vedação das fachadas.', '<b>Qualidade:</b> terças desalinhadas comprometem estanqueidade e aparência.',
          '<b>Cascata:</b> fachada aberta expõe o interior ao vento e à chuva.'],
        recupera: ['Montar na sequência dos suportes, por trecho de fachada.', 'Reforçar a equipe de fechamento lateral se o telhamento da cobertura liberar pessoal.'] },
      { id: 'g12', nome: 'Vigas das marquises',
        oque: 'Montagem das vigas principais das marquises (em balanço), que recebem as terças e as telhas da marquise.',
        importa: 'É o apoio de toda a marquise; estrutura em balanço exige travamento e fixação corretos.',
        impacto: ['<b>Prazo:</b> terças e telhas da marquise não podem começar.', '<b>Segurança/qualidade:</b> viga em balanço sem os travamentos completos é instável.',
          '<b>Contrato:</b> a marquise costuma ser marco de fachada/entrada visto pelo cliente.'],
        recupera: ['Programar o equipamento de içamento específico para as marquises.', 'Concluir travamento e torque logo após o posicionamento.'] },
      { id: 'g13', nome: 'Telhas do fechamento lateral',
        oque: 'Instalação das telhas das fachadas laterais, em m².',
        importa: 'Fecha o galpão lateralmente, dá estanqueidade e define a imagem final da fachada.',
        impacto: ['<b>Prazo/contrato:</b> marco de fechamento; atraso mantém a obra aberta e libera tarde as disciplinas internas.', '<b>Qualidade:</b> exposição ao tempo e ao vento antes do fechamento.',
          '<b>Custo:</b> permanência prolongada de andaimes/plataformas e equipes.'],
        recupera: ['Concentrar equipes por fachada completa.', 'Manter perfilação e entrega de telhas laterais adiantadas.'] },
      { id: 'g14', nome: 'Calha da cobertura',
        oque: 'Instalação das calhas da cobertura (e da marquise), conectadas às descidas de água pluvial.',
        importa: 'Garante o escoamento da água e a estanqueidade da cobertura; é condição para entregar a obra sem pendências.',
        impacto: ['<b>Qualidade:</b> água sem destino correto causa infiltração, manchas e corrosão.', '<b>Prazo/contrato:</b> impede o teste de estanqueidade e a entrega do trecho coberto.',
          '<b>Cascata:</b> rufos e arremates dependem das calhas posicionadas.'],
        recupera: ['Instalar as calhas logo após cada trecho de telhas.', 'Confirmar material (calha, suporte, vedação) no Estoque antes de iniciar.'] },
      { id: 'g15', nome: 'Montagem de terças da marquise',
        oque: 'Pré-montagem e montagem das terças da marquise sobre as vigas, que recebem as telhas.',
        importa: 'Estrutura secundária da marquise; define alinhamento e caimento da cobertura da marquise.',
        impacto: ['<b>Prazo:</b> impede a montagem das telhas da marquise.', '<b>Qualidade:</b> terças fora de nível comprometem o caimento e a drenagem.', '<b>Cascata:</b> calhas e testeira da marquise também ficam travadas.'],
        recupera: ['Pré-montar as terças em solo enquanto as vigas são instaladas.', 'Liberar a marquise por trechos completos.'] },
      { id: 'g16', nome: 'Montagem de telhas da marquise',
        oque: 'Instalação das telhas da marquise, em m².',
        importa: 'Conclui a cobertura da marquise, protegendo entradas e acessos.',
        impacto: ['<b>Prazo/contrato:</b> acesso e fachada principais ficam sem proteção e sem fechamento.', '<b>Qualidade:</b> infiltração nas interfaces com a fachada.', '<b>Cascata:</b> impede calhas, testeira e rufos da marquise.'],
        recupera: ['Antecipar perfilação das telhas da marquise.', 'Usar a equipe de telhas da cobertura assim que liberada.'] },
      { id: 'g17', nome: 'Rufos e acabamentos',
        oque: 'Instalação de rufos, arremates, testeiras e calafetação — o acabamento que fecha todas as interfaces e garante a estanqueidade final.',
        importa: 'É a última etapa e a que segura o aceite: reúne as pendências finais e a vedação das interfaces.',
        impacto: ['<b>Qualidade:</b> infiltrações pelas interfaces e reclamações no recebimento.', '<b>Contrato/BM:</b> aceite e medição final retidos enquanto houver pendências.',
          '<b>Custo:</b> equipes mobilizadas só para acabamento prolongam a obra.'],
        recupera: ['Antecipar a compra e o recebimento de rufos e acessórios.', 'Fazer os arremates por trecho, junto com a entrega parcial.', 'Manter uma lista de pendências (punch list) atualizada.'] },
    ],
  },
  anexo: {
    nome: 'Anexos (Eclusa, Portaria, Refeitório, Vestiário e coberturas)',
    etapas: [
      { id: 'a1', nome: 'Chegada de material', apoio: 'Etapa de apoio: acompanhe pelo módulo Estoque (remessas dos anexos, saldo e alertas).',
        oque: 'Recebimento do material de cada anexo (estrutura, telhas, platibanda, calhas e rufos).',
        importa: 'Os anexos são frentes pequenas e dependentes de entregas pontuais; faltando uma peça a frente inteira para.',
        impacto: ['<b>Prazo:</b> a equipe dos anexos fica ociosa ou é desviada, gerando retrabalho de mobilização.', '<b>Custo:</b> hora parada e frete extra de reposição.', '<b>Cascata:</b> atrasa todas as etapas seguintes do anexo.'],
        recupera: ['Confirmar com o fornecedor o romaneio dos anexos separado do galpão.', 'Conferir o saldo no Estoque antes de mobilizar a equipe.'] },
      { id: 'a2', nome: 'Descarregamento', apoio: 'Etapa de apoio: sem linha própria no cronograma; acompanhe pela conferência das remessas.',
        oque: 'Descarga e conferência do material dos anexos, com armazenamento próximo à frente.',
        importa: 'Material conferido e armazenado por anexo evita deslocamento e troca de peças entre frentes.',
        impacto: ['<b>Prazo:</b> peças misturadas ou não conferidas atrasam o início da montagem.', '<b>Custo:</b> estadia de caminhão e movimentação dupla.', '<b>Qualidade:</b> faltas e avarias descobertas tarde.'],
        recupera: ['Separar a área de descarga por anexo.', 'Lançar a remessa no sistema no mesmo dia.'] },
      { id: 'a3', nome: 'Montagem de estrutura',
        oque: 'Montagem da estrutura metálica do anexo (pilares, vigas, joists e terças, conforme cada anexo).',
        importa: 'É a base de todo o anexo: nada acima dela (telhas, platibanda, calhas) começa sem ela.',
        impacto: ['<b>Prazo:</b> bloqueia telhas, platibanda, calhas e rufos do anexo.', '<b>Qualidade:</b> correções depois de coberta a estrutura são caras.', '<b>Contrato/BM:</b> atrasa a medição da estrutura do anexo.'],
        recupera: ['Definir a ordem dos anexos e dedicar equipe e equipamento a cada um.', 'Aproveitar o equipamento de içamento do galpão em janelas livres.'] },
      { id: 'a4', nome: 'Montagem de telhas',
        oque: 'Instalação das telhas de cobertura do anexo.',
        importa: 'Fecha a cobertura do anexo e o protege das chuvas.',
        impacto: ['<b>Prazo/contrato:</b> anexo sem vedação não libera serviços internos.', '<b>Qualidade:</b> infiltração e danos ao interior.', '<b>Cascata:</b> platibanda, calhas e rufos esperam as telhas.'],
        recupera: ['Reaproveitar a equipe de telhas do galpão quando liberada.', 'Confirmar perfilação e material de fixação antes de iniciar.'] },
      { id: 'a5', nome: 'Montagem de platibanda',
        oque: 'Montagem da estrutura da platibanda (estrutura de suporte do fechamento da altura superior do anexo).',
        importa: 'É a estrutura que recebe as telhas/ACM da platibanda e define o acabamento visual do anexo.',
        impacto: ['<b>Prazo:</b> bloqueia o fechamento da platibanda, calhas e rufos.', '<b>Qualidade:</b> prumo e alinhamento ruins aparecem no acabamento final.', '<b>Contrato:</b> item de fachada visível ao cliente.'],
        recupera: ['Programar a platibanda logo após a estrutura do anexo.', 'Conferir o projeto de detalhes da platibanda antes da montagem.'] },
      { id: 'a6', nome: 'Telhas da platibanda',
        oque: 'Instalação das telhas ou do fechamento (inclui ACM, quando previsto) da platibanda.',
        importa: 'Conclui o fechamento do anexo e dá a aparência final da fachada.',
        impacto: ['<b>Prazo/contrato:</b> fachada incompleta no recebimento.', '<b>Qualidade:</b> infiltração pelo topo e pela interface com a cobertura.', '<b>Cascata:</b> calhas e rufos dependem do fechamento pronto.'],
        recupera: ['Antecipar a compra de painéis/telhas e acessórios.', 'Usar a equipe de fechamento lateral do galpão assim que liberada.'] },
      { id: 'a7', nome: 'Calhas',
        oque: 'Instalação das calhas e das descidas pluviais do anexo.',
        importa: 'Garante o escoamento e a durabilidade da cobertura e do fechamento.',
        impacto: ['<b>Qualidade:</b> água fora de controle causa infiltração e corrosão.', '<b>Prazo:</b> impede o teste de estanqueidade e a entrega.', '<b>Cascata:</b> os rufos dependem das calhas posicionadas.'],
        recupera: ['Instalar assim que cada trecho de telhas for concluído.', 'Conferir material e declividade antes de fixar.'] },
      { id: 'a8', nome: 'Rufos e acabamentos',
        oque: 'Rufos, arremates, testeiras e calafetação do anexo.',
        importa: 'Fecha as interfaces e libera o anexo para aceite.',
        impacto: ['<b>Qualidade:</b> infiltração pelas emendas e reclamação no recebimento.', '<b>Contrato/BM:</b> aceite e medição final do anexo retidos.', '<b>Custo:</b> equipe mobilizada só para pendências.'],
        recupera: ['Fazer arremates por trecho já pronto.', 'Manter lista de pendências do anexo atualizada.'] },
    ],
  },
};
const PLD_ORDEM = { galpao: PLD_FLUXOS.galpao.etapas.map(e => e.id), anexo: PLD_FLUXOS.anexo.etapas.map(e => e.id) };

// Regras de enquadramento: o nome da atividade do cronograma → etapa(s) do fluxo. A primeira regra que combinar vale.
const PLD_REGRAS = {
  galpao: [
    [/MARQUISE.*VIGAS/, ['g12']], [/MARQUISE.*TERCAS/, ['g15']], [/MARQUISE.*TELHAS/, ['g16']], [/MARQUISE.*CALHAS/, ['g14']],
    [/MARQUISE.*(TESTEIRA|RUFO|ARREMATE)/, ['g17']],
    [/FECH.*LATERAL.*ESTRUTURA/, ['g10', 'g11']], [/FECH.*LATERAL.*TERCAS/, ['g11']], [/FECH.*LATERAL.*SUPORTE/, ['g10']], [/^FECHAMENTO|FECH.*LATERAL/, ['g13']],
    [/CONTRAVENT/, ['g6']], [/CHECKLIST|CHECK LIST/, ['g7']],
    [/PREMONT|PRE MONT/, ['g3']], [/VIGAS/, ['g4']], [/ICAMENTO|JOIST/, ['g5']],
    [/PERFILACAO/, ['g8']], [/TELHAR|TELHAS/, ['g9']], [/CALHAS/, ['g14']], [/ARREMATES|RUFOS/, ['g17']],
  ],
  anexo: [
    [/PLATIBANDA.*TELHAS|FECHAMENTO ACM/, ['a6']], [/PLATIBANDA/, ['a5']],
    [/RUFOS|ARREMATES|TESTEIRA/, ['a8']], [/CALHAS/, ['a7']],
    [/TELHAS|COBERTURA AREA/, ['a4']], [/VIGAS|TERCAS|PILARES|JOIST|ESTRUTURA/, ['a3']],
  ],
};
// 'galpao' = tudo cuja frente começa com GALPÃO (inclui a marquise); o resto entra no fluxo dos anexos
const pldFluxoDe = frente => (/^GALPAO/.test(ganNorm(frente)) ? 'galpao' : 'anexo');
function pldEtapasDe(x) {
  const it = x.it, serv = ganNorm(x.ativ?.it?.servico || it.atividade), fluxo = pldFluxoDe(it.frente);
  const reg = PLD_REGRAS[fluxo].find(([re]) => re.test(serv));
  return { fluxo, ids: reg ? reg[1] : [] };
}
const pldEtapa = (fluxo, id) => PLD_FLUXOS[fluxo].etapas.find(e => e.id === id);

// ---------------------------------------------------------------- situação por etapa (pior caso entre as atividades)
const PLD_PESO_ST = { 'ATRASADO': 4, 'NO LIMITE': 3, 'A INICIAR': 2, 'NO PRAZO': 1, 'ADIANTADO': 1, 'CONCLUÍDO': 0 };
function pldStatusEtapa(itens) {
  if (!itens.length) return { rot: 'sem lançamento', cls: 'nd' };
  if (itens.every(x => x.status === 'CONCLUÍDO')) return { rot: 'concluída', cls: 'ok' };
  const pior = itens.reduce((p, x) => (PLD_PESO_ST[x.status] > PLD_PESO_ST[p] ? x.status : p), 'CONCLUÍDO');
  return { 'ATRASADO': { rot: 'atrasada', cls: 'ruim' }, 'NO LIMITE': { rot: 'no limite', cls: 'alerta' }, 'A INICIAR': { rot: 'a iniciar', cls: 'pend' } }[pior] || { rot: 'no prazo', cls: 'ok' };
}

// ---------------------------------------------------------------- cálculo de atraso e impacto por atividade
function pldAtraso(x, base) {
  const it = x.it;
  if (x.status === 'CONCLUÍDO') return { dias: 0, proj: x.concluiu || null };
  const proj = x.terminaRitmo;
  if (proj && proj > it.fim) return { dias: contarDiasUteis(it.fim, proj), proj };
  if (!proj && base > it.fim && x.falta > 0) return { dias: contarDiasUteis(it.fim, base), proj: null, vencida: true };
  return { dias: 0, proj };
}
// sucessoras: atividades do plano nas etapas seguintes (mesmo fluxo; nos anexos, do mesmo anexo)
function pldSucessoras(c, x) {
  const e = pldEtapasDe(x);
  if (!e.ids.length) return [];
  const ordem = PLD_ORDEM[e.fluxo], pos = Math.max(...e.ids.map(id => ordem.indexOf(id)));
  return c.itens.filter(y => y !== x).map(y => ({ y, e: pldEtapasDe(y) }))
    .filter(({ y, e: ey }) => ey.fluxo === e.fluxo && ey.ids.length && Math.min(...ey.ids.map(id => ordem.indexOf(id))) > pos && (e.fluxo === 'galpao' || y.it.frente === x.it.frente))
    .sort((a, b) => Math.min(...a.e.ids.map(id => ordem.indexOf(id))) - Math.min(...b.e.ids.map(id => ordem.indexOf(id))));
}
function pldTextoSituacao(x, c) {
  const it = x.it, un = it.unidade, a = pldAtraso(x, c.base);
  if (x.status === 'CONCLUÍDO') return { cls: 'ok', txt: `Concluída${x.concluiu ? ' em ' + fdA(x.concluiu) : ''}: ${plFmt(x.realAc, un)} de ${plFmt(it.qtd, un)} ${esc(un)}. O risco de atraso desta atividade sobre as seguintes deixou de existir.` };
  if (x.status === 'A INICIAR') return { cls: 'pend', txt: `Ainda não iniciou (início previsto em ${fdA(it.inicio)}). Para cumprir o objetivo precisa produzir ${plFmtTaxa(x.meta)} ${esc(un)}/dia útil durante ${plDias(it.inicio, it.fim).length} dias úteis.` };
  let t = `Realizado ${nf(x.pctReal * 100, 0)}% contra ${nf(x.pctPlan * 100, 0)}% previsto até ${fdA(c.baseRef)}; faltam ${plFmt(x.falta, un)} ${esc(un)}.`;
  if (x.ritmoNec != null && x.ritmoNec > 0) {
    const mais = x.ritmoAtual > 0 ? ` (ritmo atual ${plFmtTaxa(x.ritmoAtual)} ${esc(un)}/dia — ${x.ritmoNec > x.ritmoAtual ? 'precisa subir cerca de ' + nf((x.ritmoNec / x.ritmoAtual - 1) * 100, 0) + '%' : 'suficiente para fechar'})` : ' (sem lançamentos recentes)';
    t += ` Para fechar no prazo precisa de ${plFmtTaxa(x.ritmoNec)} ${esc(un)}/dia útil${mais}.`;
  }
  if (a.dias > 0 && a.proj) t += ` No ritmo atual termina em ${fdA(a.proj)}, ${a.dias} dia(s) útil(eis) após o fim planejado (${fdA(it.fim)}).`;
  else if (a.vencida) t += ` O prazo (${fdA(it.fim)}) já passou e a atividade ainda não foi concluída.`;
  else if (a.proj) t += ` Projeção de término: ${fdA(a.proj)} — dentro do prazo (${fdA(it.fim)}).`;
  return { cls: a.dias > 0 || a.vencida ? 'ruim' : x.status === 'NO LIMITE' ? 'alerta' : 'ok', txt: t };
}
function pldTextoCascata(x, c) {
  const a = pldAtraso(x, c.base);
  if (x.status === 'CONCLUÍDO') return '';
  const suc = pldSucessoras(c, x);
  if (!suc.length) return a.dias > 0 ? `Atraso projetado de ${a.dias} dia(s) útil(eis) nesta atividade; não há atividade seguinte no plano atual, mas o prazo final do plano acompanha o atraso.` : '';
  const proximas = suc.filter(s => Math.min(...s.e.ids.map(id => PLD_ORDEM[s.e.fluxo].indexOf(id))) === Math.min(...suc[0].e.ids.map(id => PLD_ORDEM[s.e.fluxo].indexOf(id))));
  const nomes = proximas.map(({ y }) => `<b>${esc(y.it.atividade)}</b>`).join(', ');
  const resto = suc.length - proximas.length;
  if (a.dias > 0) {
    const novo = proximas.map(({ y }) => `${esc(y.it.atividade)} (início previsto ${fdA(y.it.inicio)}, poderia ir para ${fdA(somarDiasUteis(y.it.inicio, a.dias))})`).join('; ');
    return `Se o atraso se mantiver, a próxima etapa do fluxo é empurrada em até ${a.dias} dia(s) útil(eis): ${novo}.${resto > 0 ? ` Outras ${resto} atividade(s) a jusante sofrem o mesmo deslocamento em cascata.` : ''}`;
  }
  return `Risco monitorado: se esta atividade escorregar, a próxima etapa do fluxo — ${nomes} — perde a data de início${resto > 0 ? `, e outras ${resto} atividade(s) a jusante acompanham` : ''}.`;
}

// ---------------------------------------------------------------- curva S em SVG (planejado × realizado × projeção)
function pldCurvaSvg(c) {
  const W = 760, H = 250, ml = 38, mr = 14, mt = 12, mb = 34, n = c.diasPlano.length;
  if (n < 2) return '';
  const X = i => ml + (W - ml - mr) * i / (n - 1), Y = v => mt + (H - mt - mb) * (1 - v / 100);
  const linha = (arr, cor, tr) => {
    let d = '', abre = false;
    arr.forEach((v, i) => { if (v == null) { abre = false; return; } d += `${abre ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)} `; abre = true; });
    return d ? `<path d="${d}" fill="none" stroke="${cor}" stroke-width="2.4" ${tr ? `stroke-dasharray="${tr}"` : ''}/>` : '';
  };
  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Curva S do planejamento">`;
  [0, 25, 50, 75, 100].forEach(v => { s += `<line x1="${ml}" y1="${Y(v)}" x2="${W - mr}" y2="${Y(v)}" stroke="#d9dee7"/><text x="${ml - 6}" y="${Y(v) + 4}" text-anchor="end" font-size="10" fill="#5b6472">${v}%</text>`; });
  const passo = Math.max(1, Math.ceil(n / 8));
  c.diasPlano.forEach((d, i) => { if (i % passo === 0 || i === n - 1) s += `<text x="${X(i)}" y="${H - 14}" text-anchor="middle" font-size="10" fill="#5b6472">${esc(fdA(d).slice(0, 5))}</text>`; });
  s += linha(c.planPct, '#1d4ed8', '6 4') + linha(c.realPct, '#15803d') + linha(c.proj.map((v, i) => (v != null || i === c.diasPlano.filter(d => d <= c.base).length - 1 ? (v ?? c.realPct[i]) : null)), '#d97706', '2 3');
  s += '</svg>';
  return s;
}

// ---------------------------------------------------------------- montagem do documento
function pldCartaoAtividade(x, c, etapas) {
  const it = x.it, un = it.unidade, sit = pldTextoSituacao(x, c), casc = pldTextoCascata(x, c);
  const mult = etapas.length > 1 ? `<p class="mini">Esta atividade do cronograma cobre as etapas: ${etapas.map(e => esc(e.nome)).join(' + ')}.</p>` : '';
  return `<div class="atv">
    <div class="atv-cab"><div><b>${esc(it.atividade)}</b><div class="mini">${esc(cap(it.frente))} · ${fdA(it.inicio)} a ${fdA(it.fim)} · ${plFmt(it.qtd, un)} ${esc(un)} · meta ${plFmtTaxa(x.meta)} ${esc(un)}/dia${it.quem || it.empresa ? ' · ' + esc(it.quem || it.empresa) : ''}</div></div>
      <span class="sel st-${esc(PL_COR_STATUS[x.status] || 'pendente')}">${esc(x.status)}</span></div>
    <div class="barra"><span class="plan" style="width:${nf(x.pctPlan * 100, 0)}%"></span><span class="real st-${esc(PL_COR_STATUS[x.status] || 'pendente')}" style="width:${nf(x.pctReal * 100, 0)}%"></span></div>
    <div class="mini">realizado ${nf(x.pctReal * 100, 0)}% · previsto até a referência ${nf(x.pctPlan * 100, 0)}%</div>
    ${mult}
    ${it.o_que || it.por_que || it.como ? `<table class="w5"><tr>${it.o_que ? `<th>O quê</th><td>${esc(it.o_que)}</td>` : ''}${it.por_que ? `<th>Por quê</th><td>${esc(it.por_que)}</td>` : ''}</tr>
      <tr>${it.onde ? `<th>Onde</th><td>${esc(it.onde)}</td>` : ''}${it.como ? `<th>Como</th><td>${esc(it.como)}</td>` : ''}</tr></table>` : ''}
    <div class="sit ${sit.cls}"><b>Situação hoje:</b> ${sit.txt}</div>
    ${casc ? `<div class="casc"><b>Efeito em cascata:</b> ${casc}</div>` : ''}
  </div>`;
}

function pldBlocoEtapa(fluxo, e, indice, c, itensEtapa) {
  const st = pldStatusEtapa(itensEtapa);
  const casos = itensEtapa.map(x => pldCartaoAtividade(x, c, pldEtapasDe(x).ids.map(id => pldEtapa(fluxo, id))));
  const compartilhada = !itensEtapa.length && PLD_REGRAS[fluxo] && c.itens.some(x => { const m = pldEtapasDe(x); return m.fluxo === fluxo && m.ids.length > 1 && m.ids.includes(e.id); });
  return `<section class="etapa" id="${esc(fluxo + '-' + e.id)}">
    <div class="etapa-cab"><span class="num">${indice}</span><h3>${esc(e.nome)}</h3><span class="sel ${st.cls}">${st.rot}</span></div>
    <div class="cols">
      <div><h4>O que é</h4><p>${e.oque}</p><h4>Por que importa</h4><p>${e.importa}</p></div>
      <div class="impacto"><h4>Se não alcançar o objetivo</h4><ul>${e.impacto.map(i => `<li>${i}</li>`).join('')}</ul><h4>Como recuperar</h4><ul>${e.recupera.map(i => `<li>${i}</li>`).join('')}</ul></div>
    </div>
    ${casos.length ? casos.join('') : `<p class="apoio">${compartilhada ? 'Executada junto com a etapa anterior (mesma atividade no cronograma — veja o cartão acima).' : (e.apoio || 'Esta etapa não tem atividade no plano selecionado.')}</p>`}
  </section>`;
}

function pldFluxoVisual(c) {
  const bloco = fluxo => {
    const et = PLD_FLUXOS[fluxo].etapas;
    return `<div class="fluxo-linha"><h4>${esc(PLD_FLUXOS[fluxo].nome)}</h4><div class="chips">` + et.map((e, i) => {
      const itens = c.itens.filter(x => { const m = pldEtapasDe(x); return m.fluxo === fluxo && m.ids.includes(e.id); });
      const st = pldStatusEtapa(itens);
      return `<a href="#${esc(fluxo + '-' + e.id)}" class="chip ${st.cls}"><span>${i + 1}</span>${esc(e.nome)}<small>${st.rot}</small></a>${i < et.length - 1 ? '<i class="seta">›</i>' : ''}`;
    }).join('') + '</div></div>';
  };
  return bloco('galpao') + bloco('anexo');
}

function pldGargalo(c) {
  // causa-raiz: em cada fluxo, a atividade atrasada mais a montante (as etapas seguintes só se recuperam depois dela)
  return ['galpao', 'anexo'].map(fluxo => {
    const atras = c.itens.filter(x => x.status === 'ATRASADO').map(x => ({ x, m: pldEtapasDe(x) })).filter(o => o.m.fluxo === fluxo && o.m.ids.length);
    if (!atras.length) return '';
    const idx = o => Math.min(...o.m.ids.map(id => PLD_ORDEM[fluxo].indexOf(id)));
    atras.sort((a, b) => idx(a) - idx(b));
    const o = atras[0], a = pldAtraso(o.x, c.base);
    return `<div class="alerta-box"><b>Gargalo atual — ${esc(PLD_FLUXOS[fluxo].nome)}:</b> ${esc(o.x.it.atividade)} (etapa “${esc(pldEtapa(fluxo, o.m.ids[0]).nome)}”)${a.dias ? `, projeção de ${a.dias} dia(s) útil(eis) de atraso` : ''}. As etapas seguintes só recuperam se esta for destravada primeiro.</div>`;
  }).join('');
}

function plDocHtml(pl) {
  const c = plCalc(pl), st = plStatusPlano(c), hojeTxt = fdA(plBase());
  const atrasoPlano = c.terminaEm && c.terminaEm > pl.fim ? contarDiasUteis(pl.fim, c.terminaEm) : 0;
  // agrupa por etapa
  const porEtapa = (fluxo, id) => c.itens.filter(x => { const m = pldEtapasDe(x); return m.fluxo === fluxo && m.ids[0] === id; })
    .sort((a, b) => a.it.frente.localeCompare(b.it.frente) || a.it.inicio.localeCompare(b.it.inicio));
  const semEtapa = c.itens.filter(x => !pldEtapasDe(x).ids.length);
  const secao = fluxo => `<h2 class="fluxo-titulo">${esc(PLD_FLUXOS[fluxo].nome)}</h2>` +
    PLD_FLUXOS[fluxo].etapas.map((e, i) => pldBlocoEtapa(fluxo, e, i + 1, c, porEtapa(fluxo, e.id))).join('');
  const tabela = c.itens.map(x => { const m = pldEtapasDe(x), a = pldAtraso(x, c.base); return { x, m, a }; })
    .sort((p, q) => (p.m.fluxo === q.m.fluxo ? 0 : p.m.fluxo === 'galpao' ? -1 : 1) || ((p.m.ids.length ? PLD_ORDEM[p.m.fluxo].indexOf(p.m.ids[0]) : 99) - (q.m.ids.length ? PLD_ORDEM[q.m.fluxo].indexOf(q.m.ids[0]) : 99)));
  const linhasTab = tabela.map(({ x, m, a }) => `<tr><td>${m.ids.length ? esc(pldEtapa(m.fluxo, m.ids[0]).nome) : '—'}</td><td><b>${esc(x.it.atividade)}</b><div class="mini">${esc(cap(x.it.frente))}</div></td>
    <td>${fdA(x.it.inicio)} a ${fdA(x.it.fim)}</td><td class="n">${plFmt(x.it.qtd, x.it.unidade)} ${esc(x.it.unidade)}</td><td class="n">${nf(x.pctReal * 100, 0)}% / ${nf(x.pctPlan * 100, 0)}%</td>
    <td class="n">${plFmt(x.falta, x.it.unidade)}</td><td>${a.proj ? fdA(a.proj) : '—'}${a.dias ? `<div class="mini ruim-t">+${a.dias} d.u.</div>` : ''}</td><td><span class="sel st-${esc(PL_COR_STATUS[x.status] || 'pendente')}">${esc(x.status)}</span></td></tr>`).join('');
  const parecer = st === 'ATRASADO' || atrasoPlano
    ? `O plano está <b>${esc(st.toLowerCase())}</b>: realizado ${nf(c.pctReal, 1)}% contra ${nf(c.pctPlan, 1)}% previsto (desvio ${nf(c.desvio, 1)} p.p.).${c.terminaEm ? ` No ritmo atual o plano termina em ${fdA(c.terminaEm)}${atrasoPlano ? `, ${atrasoPlano} dia(s) útil(eis) depois do fim previsto (${fdA(pl.fim)})` : ''}.` : ' O ritmo atual é baixo demais para projetar o fim.'}`
    : `O plano está <b>${esc(st.toLowerCase())}</b>: realizado ${nf(c.pctReal, 1)}% contra ${nf(c.pctPlan, 1)}% previsto (desvio ${c.desvio >= 0 ? '+' : ''}${nf(c.desvio, 1)} p.p.).${c.terminaEm ? ` No ritmo atual termina em ${fdA(c.terminaEm)} (fim previsto ${fdA(pl.fim)}).` : ''}`;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Planejamento — ${esc(pl.nome)}</title><style>${PLD_CSS}</style></head><body>
<div class="topo-acoes"><button onclick="window.print()">Imprimir / salvar em PDF</button></div>
<header class="capa"><div class="mini">Planejamento da obra · gerado em ${fdA(plBase())} · dados até ${hojeTxt}</div>
  <h1>${esc(pl.nome)}</h1>
  <p class="sub">${fdA(pl.inicio)} a ${fdA(pl.fim)} · ${plDias(pl.inicio, pl.fim).length} dias úteis · ${pl.itens.length} atividade(s)${pl.responsavel ? ' · responsável: ' + esc(pl.responsavel) : ''}</p>
  ${pl.objetivo ? `<p class="obj"><b>Objetivo:</b> ${esc(pl.objetivo)}</p>` : ''}
  <div class="tiles">
    <div><span>Planejado até a referência</span><b>${nf(c.pctPlan, 1)}%</b></div>
    <div><span>Realizado</span><b>${nf(c.pctReal, 1)}%</b></div>
    <div><span>Desvio</span><b class="${c.desvio < -1 ? 'ruim-t' : ''}">${c.desvio >= 0 ? '+' : ''}${nf(c.desvio, 1)} p.p.</b></div>
    <div><span>Atividades atrasadas</span><b class="${c.atrasadas ? 'ruim-t' : ''}">${c.atrasadas}/${pl.itens.length}</b></div>
    <div><span>Término no ritmo atual</span><b>${c.terminaEm ? fdA(c.terminaEm) : c.pctReal >= 100 ? 'concluído' : '—'}</b></div>
  </div>
  <p class="parecer">${parecer}</p>${pldGargalo(c)}
</header>

<section><h2>1. Fluxo de execução e situação de cada etapa</h2>
  <p class="nota">Cada etapa só começa de verdade quando a anterior entrega. A cor mostra a situação da etapa no plano (pior caso entre suas atividades); clique para ir à explicação. Cinza = etapa sem atividade própria no cronograma.</p>
  ${pldFluxoVisual(c)}
  <div class="legenda"><span class="chip ok"></span>no prazo / concluída <span class="chip alerta"></span>no limite <span class="chip ruim"></span>atrasada <span class="chip pend"></span>a iniciar <span class="chip nd"></span>sem lançamento</div></section>

<section><h2>2. Curva S — planejado × realizado</h2>${pldCurvaSvg(c)}
  <div class="legenda"><span class="lin plan"></span>planejado <span class="lin real"></span>realizado <span class="lin proj"></span>projeção no ritmo atual</div></section>

<section><h2>3. Quadro das atividades</h2><div class="rolagem"><table class="tab"><thead><tr><th>Etapa do fluxo</th><th>Atividade</th><th>Período</th><th class="n">Quantidade</th><th class="n">Real / previsto</th><th class="n">Falta</th><th>Término projetado</th><th>Situação</th></tr></thead><tbody>${linhasTab}</tbody></table></div></section>

<section><h2>4. Se o plano não for cumprido</h2>
  <ul class="geral">
    <li><b>Prazo e contrato:</b> o atraso das etapas a montante é repassado integralmente às seguintes (o fluxo é sequencial). Marcos de cobertura e de fechamento podem gerar multa contratual e pressão do cliente.</li>
    <li><b>Medição (BM) e caixa:</b> atividade não concluída ou sem evidência (checklist, apontamento, fotos) não é medida; o faturamento é adiado.</li>
    <li><b>Custo:</b> equipes, guindastes, andaimes e supervisão ficam mobilizados por mais tempo; trabalho ocioso é custo sem produção.</li>
    <li><b>Qualidade e segurança:</b> recuperar prazo com pressa aumenta retrabalho, trabalho em altura sem planejamento e risco de acidente — a recuperação deve ser por mais recurso e melhor sequência, não por pular conferências.</li>
    <li><b>Clima:</b> cobertura aberta por mais tempo aumenta a exposição à chuva e ao vento, com danos a materiais e ao interior.</li>
  </ul>${atrasoPlano ? `<p class="alerta-box">No ritmo atual o plano passa ${atrasoPlano} dia(s) útil(eis) do prazo. Priorize as etapas atrasadas mais a montante do fluxo (gargalo acima).</p>` : ''}</section>

<h2 class="grande">5. Cada etapa explicada, com o impacto de não alcançar o objetivo</h2>
${secao('galpao')}
${secao('anexo')}
${semEtapa.length ? `<section class="etapa"><div class="etapa-cab"><span class="num">+</span><h3>Outras atividades do plano (fora do fluxo padrão)</h3></div><p class="nota">Não foram associadas a uma etapa do fluxo; o impacto vale o do fluxo geral descrito na seção 4.</p>${semEtapa.map(x => pldCartaoAtividade(x, c, [])).join('')}</section>` : ''}
<footer>Documento gerado pelo sistema de gestão de obra. As explicações de cada etapa são referências técnicas gerais; as situações e projeções vêm da produção lançada até ${hojeTxt}. Projeção = ritmo médio dos últimos 5 dias úteis (sem lançamentos, a meta).</footer>
</body></html>`;
}

const PLD_CSS = `
:root{--fg:#1b2330;--fg2:#5b6472;--bg:#f4f6fa;--card:#fff;--bd:#d9dee7;--ac:#1d4ed8;--ok:#15803d;--al:#b45309;--ru:#b91c1c;--pe:#64748b}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;padding:24px;max-width:1100px;margin:auto}
h1{font-size:26px;margin:4px 0}h2{font-size:19px;margin:28px 0 10px;border-bottom:2px solid var(--ac);padding-bottom:4px}h2.grande{margin-top:36px}h3{margin:0;font-size:17px}h4{margin:10px 0 3px;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--fg2)}
p{margin:4px 0}.mini{font-size:12px;color:var(--fg2)}.nota{color:var(--fg2);font-size:13px}.sub{color:var(--fg2)}
.topo-acoes{text-align:right;margin-bottom:8px}.topo-acoes button{padding:8px 14px;border:1px solid var(--ac);background:var(--ac);color:#fff;border-radius:8px;font-size:14px;cursor:pointer}
.capa,.etapa,section>.rolagem,.alerta-box{background:var(--card);border:1px solid var(--bd);border-radius:10px}.capa{padding:18px 20px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:12px 0}.tiles div{background:var(--bg);border:1px solid var(--bd);border-radius:8px;padding:8px 10px}.tiles span{display:block;font-size:12px;color:var(--fg2)}.tiles b{font-size:20px}
.parecer{margin:8px 0;font-size:15px}.obj{margin:6px 0}.ruim-t{color:var(--ru)}
.alerta-box{border-left:5px solid var(--ru);padding:10px 14px;margin:10px 0;background:#fef2f2}
.fluxo-linha{margin:10px 0}.chips{display:flex;flex-wrap:wrap;align-items:center;gap:4px}
.chip{display:inline-flex;flex-direction:column;border-radius:8px;padding:5px 9px;font-size:12px;font-weight:600;text-decoration:none;color:#fff;min-width:96px;max-width:140px;position:relative}.chip span{font-size:10px;opacity:.85}.chip small{font-weight:400;font-size:10px;opacity:.9}
.chip.ok{background:var(--ok)}.chip.alerta{background:var(--al)}.chip.ruim{background:var(--ru)}.chip.pend{background:#475569}.chip.nd{background:#94a3b8}
.seta{color:var(--fg2);font-style:normal;font-size:18px}.legenda{margin-top:8px;font-size:12px;color:var(--fg2);display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.legenda .chip{min-width:14px;width:14px;height:14px;padding:0;border-radius:3px}.lin{display:inline-block;width:26px;height:0;border-top:3px solid}.lin.plan{border-color:#1d4ed8;border-top-style:dashed}.lin.real{border-color:#15803d}.lin.proj{border-color:#d97706;border-top-style:dotted}
.sel{display:inline-block;border-radius:999px;padding:2px 10px;font-size:11px;font-weight:700;color:#fff;background:var(--pe);white-space:nowrap}.sel.ok,.sel.st-verde{background:var(--ok)}.sel.alerta,.sel.st-amarelo{background:var(--al)}.sel.ruim,.sel.st-vermelho{background:var(--ru)}.sel.st-pendente,.sel.pend{background:#475569}.sel.nd{background:#94a3b8}
.tab{width:100%;border-collapse:collapse;font-size:12.5px}.tab th,.tab td{border-bottom:1px solid var(--bd);padding:6px 8px;text-align:left;vertical-align:top}.tab th{background:var(--bg);font-size:11px;text-transform:uppercase;color:var(--fg2)}.tab .n{text-align:right;white-space:nowrap}.rolagem{overflow-x:auto}
.etapa{padding:14px 16px;margin:12px 0;break-inside:avoid-page}.etapa-cab{display:flex;align-items:center;gap:10px;margin-bottom:6px}.num{background:var(--ac);color:#fff;border-radius:50%;width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;font-weight:700}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:16px}.impacto{background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:6px 12px}.impacto h4{color:#9a3412}ul{margin:4px 0;padding-left:18px}li{margin:2px 0}
.atv{border:1px solid var(--bd);border-left:4px solid var(--ac);border-radius:8px;padding:10px 12px;margin:10px 0;background:#fbfcfe}.atv-cab{display:flex;justify-content:space-between;gap:8px;align-items:flex-start}
.barra{position:relative;height:10px;background:#e5e9f0;border-radius:6px;margin:8px 0 2px;overflow:hidden}.barra span{position:absolute;left:0;top:0;height:100%}.barra .plan{background:#bfdbfe}.barra .real{height:50%;top:25%;border-radius:6px}.barra .real.st-verde{background:var(--ok)}.barra .real.st-amarelo{background:var(--al)}.barra .real.st-vermelho{background:var(--ru)}.barra .real.st-pendente{background:var(--pe)}
.w5{width:100%;border-collapse:collapse;margin:6px 0;font-size:12.5px}.w5 th{text-align:left;color:var(--fg2);width:70px;vertical-align:top;padding:2px 6px 2px 0}.w5 td{padding:2px 12px 2px 0;vertical-align:top}
.sit,.casc{border-radius:6px;padding:7px 10px;margin-top:6px}.sit.ok{background:#f0fdf4}.sit.alerta{background:#fffbeb}.sit.ruim{background:#fef2f2}.sit.pend{background:#f1f5f9}.casc{background:#eff6ff}
.apoio{background:#f1f5f9;border-radius:6px;padding:8px 10px;color:var(--fg2);margin-top:8px}.geral li{margin:5px 0}.fluxo-titulo{margin-top:26px;color:var(--ac)}
footer{margin:28px 0 8px;font-size:12px;color:var(--fg2)}
@media(max-width:760px){body{padding:12px}.cols{grid-template-columns:1fr}}
@media print{body{background:#fff;padding:0;max-width:none}.topo-acoes{display:none}.etapa,.atv{break-inside:avoid}.capa,.etapa{border-color:#bbb}a{color:inherit}.chip{-webkit-print-color-adjust:exact;print-color-adjust:exact}.sel,.barra span,.num,.impacto,.sit,.casc,.alerta-box{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
`;

function plBaixarDoc(pl) {
  const html = plDocHtml(pl);
  const nome = `planejamento-${String(pl.nome || 'plano').replace(/[^\w\-]+/g, '_')}-${plBase()}.html`;
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = nome; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
document.addEventListener('click', ev => {
  const b = ev.target.closest && ev.target.closest('[data-pl-doc]');
  if (!b) return;
  const pl = plPlano(PL.sel);
  if (!pl) return;
  try { plBaixarDoc(pl); toast('Documento do planejamento gerado.'); } catch (e) { toast('Não foi possível gerar o documento: ' + (e.message || e), true); }
});
