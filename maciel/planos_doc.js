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
      { id: 'g10', nome: 'Estrutura do fechamento lateral',
        oque: 'Estrutura que recebe as telhas das fachadas, montada em sequência: suporte de terças › terças › espaçadores › frechais. Não depende de nenhuma outra atividade da obra, apenas da chegada e da descarga do material.',
        importa: 'O alinhamento dos suportes define o prumo de todo o fechamento e as terças/frechais são a fixação das telhas laterais: erro aqui aparece na fachada inteira. Por ser independente, pode (e deve) andar em paralelo à cobertura.',
        impacto: ['<b>Prazo:</b> só trava as telhas do fechamento lateral e a vedação das fachadas; não atrasa a cobertura.',
          '<b>Qualidade:</b> suportes fora de prumo, terças desalinhadas ou frechais mal fixados geram fachada ondulada, retrabalho nas telhas e infiltração.',
          '<b>Custo:</b> refazer suporte já com terça e frechal montados é caro e lento; fachada aberta expõe o interior ao vento e à chuva.'],
        recupera: ['Conferir se o material (suportes, terças, espaçadores, frechais) chegou e foi descarregado: é a única dependência.', 'Liberar a topografia e a marcação dos eixos antes de instalar.', 'Montar por fachada completa na sequência suporte › terça › espaçador › frechal, conferindo prumo a cada trecho.', 'Reforçar a equipe de fechamento lateral em paralelo à cobertura se houver atraso.'] },
      { id: 'g11', nome: 'Vigas das marquises',
        oque: 'Montagem das vigas principais das marquises (em balanço), que recebem as terças e as telhas da marquise.',
        importa: 'É o apoio de toda a marquise; estrutura em balanço exige travamento e fixação corretos.',
        impacto: ['<b>Prazo:</b> terças e telhas da marquise não podem começar.', '<b>Segurança/qualidade:</b> viga em balanço sem os travamentos completos é instável.',
          '<b>Contrato:</b> a marquise costuma ser marco de fachada/entrada visto pelo cliente.'],
        recupera: ['Programar o equipamento de içamento específico para as marquises.', 'Concluir travamento e torque logo após o posicionamento.'] },
      { id: 'g12', nome: 'Telhas do fechamento lateral',
        oque: 'Instalação das telhas das fachadas laterais, em m².',
        importa: 'Fecha o galpão lateralmente, dá estanqueidade e define a imagem final da fachada.',
        impacto: ['<b>Prazo/contrato:</b> marco de fechamento; atraso mantém a obra aberta e libera tarde as disciplinas internas.', '<b>Qualidade:</b> exposição ao tempo e ao vento antes do fechamento.',
          '<b>Custo:</b> permanência prolongada de andaimes/plataformas e equipes.'],
        recupera: ['Concentrar equipes por fachada completa.', 'Manter perfilação e entrega de telhas laterais adiantadas.'] },
      { id: 'g13s', nome: 'Suportes de calha',
        oque: 'Montagem dos suportes (ganchos/mãos-francesas) que sustentam a calha, nivelados com o caimento de projeto, depois das telhas da cobertura e do fechamento lateral.',
        importa: 'O nível e o espaçamento dos suportes definem o caimento da calha: erro aqui compromete o escoamento de toda a água da cobertura.',
        impacto: ['<b>Prazo:</b> a calha da cobertura não pode ser instalada; rufos e acabamentos também esperam.', '<b>Qualidade:</b> suporte fora de nível gera empoçamento, transbordo e infiltração.', '<b>Custo:</b> refazer suporte com calha instalada exige desmontagem.'],
        recupera: ['Conferir o caimento de projeto antes de fixar os suportes.', 'Instalar por trecho logo após as telhas daquele trecho.', 'Garantir o material de suporte no Estoque antes de iniciar.'] },
      { id: 'g13', nome: 'Calha da cobertura',
        oque: 'Instalação das calhas da cobertura principal, conectadas às descidas de água pluvial.',
        importa: 'Garante o escoamento da água e a estanqueidade da cobertura; é condição para entregar a obra sem pendências.',
        impacto: ['<b>Qualidade:</b> água sem destino correto causa infiltração, manchas e corrosão.', '<b>Prazo/contrato:</b> impede o teste de estanqueidade e a entrega do trecho coberto.',
          '<b>Cascata:</b> rufos e arremates dependem das calhas posicionadas.'],
        recupera: ['Instalar as calhas logo após cada trecho de telhas.', 'Confirmar material (calha, suporte, vedação) no Estoque antes de iniciar.'] },
      { id: 'g14', nome: 'Montagem de terças da marquise',
        oque: 'Pré-montagem e montagem das terças da marquise sobre as vigas, que recebem as telhas.',
        importa: 'Estrutura secundária da marquise; define alinhamento e caimento da cobertura da marquise.',
        impacto: ['<b>Prazo:</b> impede a montagem das telhas da marquise.', '<b>Qualidade:</b> terças fora de nível comprometem o caimento e a drenagem.', '<b>Cascata:</b> telhas, calha e testeira da marquise também ficam travadas.'],
        recupera: ['Pré-montar as terças em solo enquanto as vigas são instaladas.', 'Liberar a marquise por trechos completos.'] },
      { id: 'g15', nome: 'Montagem de telhas da marquise',
        oque: 'Instalação das telhas da marquise, em m².',
        importa: 'Conclui a cobertura da marquise, protegendo entradas e acessos.',
        impacto: ['<b>Prazo/contrato:</b> acesso e fachada principais ficam sem proteção e sem fechamento.', '<b>Qualidade:</b> infiltração nas interfaces com a fachada.', '<b>Cascata:</b> impede a calha, a testeira e os rufos da marquise.'],
        recupera: ['Antecipar perfilação das telhas da marquise.', 'Usar a equipe de telhas da cobertura assim que liberada.'] },
      { id: 'g16', nome: 'Calha da marquise',
        oque: 'Instalação da calha da marquise e da descida de água pluvial correspondente, depois de montadas as telhas da marquise.',
        importa: 'Dá destino à água da marquise, que cobre acessos e circulação de pessoas; sem calha a água cai sobre a entrada.',
        impacto: ['<b>Qualidade:</b> água descendo sem controle na entrada/fachada, manchas, corrosão e infiltração na interface com a parede.', '<b>Segurança:</b> piso molhado e escorregadio em área de circulação.',
          '<b>Prazo/contrato:</b> impede o teste de estanqueidade e a entrega da marquise; testeira e rufos dependem da calha posicionada.'],
        recupera: ['Instalar a calha logo após cada trecho de telhas da marquise.', 'Conferir antes o material (calha, suportes, descida) e a declividade.', 'Alinhar com o acabamento da fachada para fechar a interface de uma vez.'] },
      { id: 'g17', nome: 'Rufos e acabamentos',
        oque: 'Instalação de rufos, arremates e calafetação da cobertura e do fechamento — o acabamento que fecha as interfaces e garante a estanqueidade final. Depende das telhas da cobertura, das telhas do fechamento lateral e da calha com seus suportes.',
        importa: 'É a última etapa e a que segura o aceite: reúne as pendências finais e a vedação das interfaces.',
        impacto: ['<b>Qualidade:</b> infiltrações pelas interfaces e reclamações no recebimento.', '<b>Contrato/BM:</b> aceite e medição final retidos enquanto houver pendências.',
          '<b>Custo:</b> equipes mobilizadas só para acabamento prolongam a obra.'],
        recupera: ['Antecipar a compra e o recebimento de rufos e acessórios.', 'Fazer os arremates por trecho, junto com a entrega parcial.', 'Manter uma lista de pendências (punch list) atualizada.'] },
      { id: 'g18', nome: 'Testeira e rufos da marquise',
        oque: 'Instalação da testeira, rufos e arremates da marquise, depois das telhas e da calha da marquise.',
        importa: 'Fecha as interfaces da marquise com a fachada e dá o acabamento visível na entrada.',
        impacto: ['<b>Qualidade:</b> infiltração na interface da marquise com a fachada e acabamento inacabado na entrada.', '<b>Contrato/BM:</b> retém o aceite da marquise.', '<b>Prazo:</b> última etapa da marquise; atrasa a entrega do trecho de entrada.'],
        recupera: ['Antecipar rufos e testeiras no Estoque.', 'Fazer os arremates por trecho assim que a calha da marquise for liberada.'] },
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
    [/MARQUISE.*VIGAS/, ['g11']], [/MARQUISE.*TERCAS/, ['g14']], [/MARQUISE.*TELHAS/, ['g15']], [/MARQUISE.*CALHAS/, ['g16']],
    [/MARQUISE.*(TESTEIRA|RUFO|ARREMATE)/, ['g18']],
    [/FECH.*LATERAL.*(ESTRUTURA|TERCAS|SUPORTE|ESPACADOR|FRECHAL)/, ['g10']], [/^FECHAMENTO|FECH.*LATERAL/, ['g12']],
    [/CONTRAVENT/, ['g6']], [/CHECKLIST|CHECK LIST/, ['g7']],
    [/PREMONT|PRE MONT/, ['g3']], [/VIGAS/, ['g4']], [/ICAMENTO|JOIST/, ['g5']],
    [/PERFILACAO/, ['g8']], [/TELHAR|TELHAS/, ['g9']], [/SUPORTE.*CALHA/, ['g13s']], [/CALHAS/, ['g13']], [/ARREMATES|RUFOS/, ['g17']],
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
// ---------------------------------------------------------------- dependências entre as etapas (editáveis na aba Planejamento › Fluxo da obra)
// Cada etapa depende de outras: o padrão abaixo vale até a obra definir o seu (sistema.fluxo_config, vem no modelo como M.fluxo_config).
// Tudo é derivado daí: o que cada etapa espera, o que ela empurra (cascata), o que é cadeia principal e o que é ramo independente.
const PLD_DEP_PADRAO = {
  galpao: { g1: [], g2: ['g1'], g3: ['g2'], g4: ['g3'], g5: ['g4'], g6: ['g5'], g7: ['g6'], g8: ['g7'], g9: ['g8'], g10: ['g2'], g11: ['g2'],
    g12: ['g9', 'g10'], g13s: ['g12'], g13: ['g9', 'g12', 'g13s'], g14: ['g11'], g15: ['g14'], g16: ['g15'], g17: ['g9', 'g12', 'g13s', 'g13'], g18: ['g16'] },
  anexo: { a1: [], a2: ['a1'], a3: ['a2'], a4: ['a3'], a5: ['a4'], a6: ['a5'], a7: ['a6'], a8: ['a7'] },
};
const pldCfgFluxo = () => (typeof M !== 'undefined' && M && M.fluxo_config) || {};
function pldDeps(fluxo, id) {
  const c = pldCfgFluxo()[fluxo]?.[id]?.dep;
  const ids = new Set(PLD_FLUXOS[fluxo].etapas.map(e => e.id));
  return (Array.isArray(c) ? c : PLD_DEP_PADRAO[fluxo][id] || []).filter(d => ids.has(d) && d !== id);
}
const pldDepsPersonalizadas = (fluxo, id) => Array.isArray(pldCfgFluxo()[fluxo]?.[id]?.dep);
// ancestrais (tudo de que a etapa depende, direta e indiretamente) e sucessores (tudo o que ela empurra)
function pldAnc(fluxo, id) {
  const vistos = new Set(), fila = [...pldDeps(fluxo, id)];
  while (fila.length) { const d = fila.shift(); if (vistos.has(d)) continue; vistos.add(d); fila.push(...pldDeps(fluxo, d)); }
  return [...vistos];
}
const pldSuc = (fluxo, id) => PLD_FLUXOS[fluxo].etapas.map(e => e.id).filter(o => o !== id && pldAnc(fluxo, o).includes(id));
// vizinhos entre as etapas PRESENTES no plano: se uma etapa do caminho não está no plano, atravessa-se por ela
function pldAntPresentes(fluxo, id, presentes) {
  const r = new Set(), vistos = new Set(), fila = [...pldDeps(fluxo, id)];
  while (fila.length) { const d = fila.shift(); if (vistos.has(d)) continue; vistos.add(d); if (presentes.has(d)) r.add(d); else fila.push(...pldDeps(fluxo, d)); }
  return [...r];
}
const pldSucPresentes = (fluxo, id, presentes) => [...presentes].filter(o => o !== id && pldAntPresentes(fluxo, o, presentes).includes(id));
// disposição do fluxo do plano: cadeia principal = maior caminho; o resto são ramos (grupos ligados entre si) que entram e saem da cadeia
function pldLayout(fluxo, ids) {
  const pres = new Set(ids), ord = PLD_ORDEM[fluxo], todos = PLD_FLUXOS[fluxo].etapas.map(e => e.id);
  const dep = Object.fromEntries(ids.map(id => [id, pldAntPresentes(fluxo, id, pres)]));
  // a cadeia principal é a mesma em qualquer plano: maior caminho do fluxo COMPLETO (depois filtrada pelas etapas presentes)
  const prof = {}, vindo = {};
  const calc = id => {
    if (prof[id] != null) return prof[id];
    prof[id] = 1; vindo[id] = null;
    pldDeps(fluxo, id).forEach(d => { const v = calc(d) + 1; if (v > prof[id]) { prof[id] = v; vindo[id] = d; } });
    return prof[id];
  };
  todos.forEach(calc);
  let fim = todos[0];
  todos.forEach(id => { if (prof[id] > prof[fim] || (prof[id] === prof[fim] && ord.indexOf(id) > ord.indexOf(fim))) fim = id; });
  const caminho = [];
  for (let id = fim; id; id = vindo[id]) caminho.unshift(id);
  const main = caminho.filter(id => pres.has(id));
  const outros = ids.filter(id => !main.includes(id)), grupos = [], visto = new Set();
  outros.forEach(id => {
    if (visto.has(id)) return;
    const comp = [], fila = [id];
    while (fila.length) {
      const a = fila.shift(); if (visto.has(a)) continue; visto.add(a); comp.push(a);
      outros.forEach(b => { if (!visto.has(b) && (dep[a].includes(b) || dep[b].includes(a))) fila.push(b); });
    }
    comp.sort((a, b) => prof[a] - prof[b] || ord.indexOf(a) - ord.indexOf(b));
    const entradas = [...new Set(comp.flatMap(a => dep[a]).filter(d => !comp.includes(d)))].sort((a, b) => ord.indexOf(a) - ord.indexOf(b));
    const saidas = ids.filter(o => !comp.includes(o) && dep[o].some(d => comp.includes(d))).sort((a, b) => ord.indexOf(a) - ord.indexOf(b));
    grupos.push({ ids: comp, entradas, saidas });
  });
  return { main, grupos, dep };
}

// ---------------------------------------------------------------- portões do fluxo (perguntas de liberação)
// Chegada de material, descarregamento e checklist não têm linha no cronograma: viram perguntas feitas a cada atividade.
// Sim = prossegue para a próxima pergunta/etapa; Não = RETORNA para aquela etapa e a atividade fica bloqueada até virar Sim.
// Resposta gravada por atividade em it.portoes[k] = { r: 'sim'|'nao', em, por, prev (previsão, quando "não"), obs }.
const PLD_PORTOES = [
  { k: 'material', etapa: { galpao: 'g1', anexo: 'a1' }, rot: 'Material chegou?', pergunta: 'O material desta atividade chegou à obra?', nao: 'Retorna para “Chegada de material”: aguardando o material' },
  { k: 'descarga', etapa: { galpao: 'g2', anexo: 'a2' }, rot: 'Foi descarregado?', pergunta: 'O material foi descarregado e conferido?', nao: 'Retorna para “Descarregamento”: aguardando a descarga e a conferência' },
  { k: 'checklist', etapa: { galpao: 'g7' }, rot: 'Checklist aprovado?', pergunta: 'O checklist da estrutura foi realizado e aprovado?', nao: 'Retorna para “Checklist”: aguardando a verificação e a aprovação' },
];
const PLD_ETAPA_PORTAO = { g1: 'material', a1: 'material', g2: 'descarga', a2: 'descarga', g7: 'checklist' };
const pldPortaoR = (x, k) => x.it.portoes?.[k]?.r || '';
// perguntas que valem para a atividade: material e descarga para todas; checklist só para o que vem depois dele no fluxo do galpão
function pldPortoesDe(x) {
  const m = pldEtapasDe(x);
  return PLD_PORTOES.filter(g => g.etapa[m.fluxo] && (g.k !== 'checklist' || (m.fluxo === 'galpao' && m.ids.some(id => pldAnc('galpao', id).includes('g7')))));   // checklist só para quem depende dele
}
function pldPortaoEstado(x) {
  if (x.status === 'CONCLUÍDO') return { estado: 'concluida', rot: 'concluída', cls: 'ok' };
  const m = pldEtapasDe(x);
  for (const g of pldPortoesDe(x)) {
    const r = pldPortaoR(x, g.k), etapa = pldEtapa(m.fluxo, g.etapa[m.fluxo]);
    if (r === 'nao') return { estado: 'retorna', g, etapa, rot: 'retorna', cls: 'ruim', prev: x.it.portoes[g.k].prev || null };
    if (r !== 'sim') return { estado: 'pendente', g, etapa, rot: 'a confirmar', cls: 'pend' };
  }
  return { estado: 'liberada', rot: 'liberada', cls: 'ok' };
}
// situação de uma etapa de portão (Chegada de material / Descarregamento / Checklist) somando as respostas das atividades
function pldStatusPortao(fluxo, k, c) {
  const ls = c.itens.filter(x => pldEtapasDe(x).fluxo === fluxo && x.status !== 'CONCLUÍDO' && pldPortoesDe(x).some(g => g.k === k));
  if (!ls.length) return { rot: 'sem atividades', cls: 'nd' };
  const ordem = PLD_PORTOES.map(g => g.k), considera = x => pldPortoesDe(x).filter(g => ordem.indexOf(g.k) < ordem.indexOf(k)).every(g => pldPortaoR(x, g.k) === 'sim');
  const nao = ls.filter(x => pldPortaoR(x, k) === 'nao').length;
  if (nao) return { rot: `retorna (${nao})`, cls: 'ruim' };
  const aptas = ls.filter(considera);
  if (!aptas.length) return { rot: 'aguarda etapa anterior', cls: 'pend' };
  return aptas.length === ls.length && aptas.every(x => pldPortaoR(x, k) === 'sim') ? { rot: 'liberado', cls: 'ok' } : { rot: 'a confirmar', cls: 'pend' };
}
// dias úteis de bloqueio sobre o início previsto (previsão informada na resposta "não"; sem previsão, do início previsto até a referência)
function pldBloqueioDias(x, est, baseRef) {
  const ini = x.it.inicio;
  if (est.prev) return est.prev > ini ? contarDiasUteis(ini, est.prev) : 0;
  return ini < baseRef ? contarDiasUteis(ini, baseRef) : 0;
}
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
  const est = pldPortaoEstado(x);
  if (est.estado === 'retorna') {            // bloqueada por material/descarga/checklist: o fim desloca o que o bloqueio já custou
    const d = pldBloqueioDias(x, est, base);
    if (d > 0) return { dias: d, proj: somarDiasUteis(it.fim, d), bloqueada: true };
  }
  const proj = x.terminaRitmo;
  if (proj && proj > it.fim) return { dias: contarDiasUteis(it.fim, proj), proj };
  if (!proj && base > it.fim && x.falta > 0) return { dias: contarDiasUteis(it.fim, base), proj: null, vencida: true };
  return { dias: 0, proj };
}
// sucessoras: atividades do plano nas etapas seguintes (mesmo fluxo; nos anexos, do mesmo anexo)
function pldSucessoras(c, x) {
  const e = pldEtapasDe(x);
  if (!e.ids.length) return [];
  const ordem = PLD_ORDEM[e.fluxo], suc = new Set(e.ids.flatMap(id => pldSuc(e.fluxo, id)));
  return c.itens.filter(y => y !== x).map(y => ({ y, e: pldEtapasDe(y) }))
    .filter(({ y, e: ey }) => ey.fluxo === e.fluxo && ey.ids.length && ey.ids.some(id => suc.has(id)) && !ey.ids.some(id => e.ids.includes(id)) && (e.fluxo === 'galpao' || y.it.frente === x.it.frente))
    .sort((a, b) => Math.min(...a.e.ids.map(id => ordem.indexOf(id))) - Math.min(...b.e.ids.map(id => ordem.indexOf(id))));
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
// ---------------------------------------------------------------- fluxogramas (caixas e setas em HTML/CSS — imprime e abre em qualquer navegador)
const pldNo = (cls, titulo, txt) => `<div class="fc-no ${cls}">${titulo ? `<b>${titulo}</b>` : ''}${txt ? `<span>${txt}</span>` : ''}</div>`;
const pldSeta = (rot, cls) => `<div class="fc-seta ${cls || ''}">${rot ? `<small>${rot}</small>` : ''}<i>▶</i></div>`;
const pldSetaV = (rot, cls) => `<div class="fc-setav ${cls || ''}"><i>▼</i>${rot ? `<small>${rot}</small>` : ''}</div>`;
const pldDec = txt => `<div class="fc-dec"><svg viewBox="0 0 150 92" aria-hidden="true"><polygon points="75,2 148,46 75,90 2,46" fill="#fff7ed" stroke="#b45309" stroke-width="2"/></svg><span>${txt}</span></div>`;
const PLD_CAT = [[/^Prazo/i, '⏱'], [/^Custo/i, '💲'], [/^Qualidade|^Seguran/i, '✔'], [/^Contrato|^BM/i, '📄'], [/^Cascata/i, '🔗']];
// impactos da base de dados ("<b>Prazo:</b> texto") → uma caixa vermelha curta por categoria
function pldImpactoCaixas(lista) {
  return lista.map(i => {
    const m = i.match(/^<b>([^<]*?):?<\/b>\s*(.*)$/), rot = m ? m[1] : 'Impacto', txt = m ? m[2] : i, cat = PLD_CAT.find(([re]) => re.test(rot));
    return pldNo('vm', `${cat ? cat[1] : '•'} ${esc(rot.toUpperCase())}`, txt);
  }).join('');
}
// fluxograma de uma etapa: anterior ▶ etapa ▶ decisão ─SIM▶ libera a próxima | ─NÃO▼ impactos ▼ recuperação ↩ volta à decisão
function pldFluxogramaEtapa(e, plano, i, o) {
  const fluxo = e.id[0] === 'a' ? 'anexo' : 'galpao', pres = new Set(plano.map(q => q.id));
  const ants = pldAntPresentes(fluxo, e.id, pres).map(id => plano.find(q => q.id === id)).sort((a, b) => plano.indexOf(b) - plano.indexOf(a));
  const sucs = pldSucPresentes(fluxo, e.id, pres).map(id => plano.find(q => q.id === id)).sort((a, b) => plano.indexOf(a) - plano.indexOf(b));
  const ant = ants[0], tambem = ants.slice(1), prox = sucs[0];
  const sim = o.sim || (prox ? 'Libera: ' + sucs.map(q => esc(q.nome)).join(' · ') : 'Concluído: entrega e aceite');
  const indep = fluxo === 'galpao' && !pldAnc('galpao', e.id).includes('g7') && PLD_ORDEM.galpao.indexOf(e.id) > PLD_ORDEM.galpao.indexOf('g7');
  return `<div class="fc">
    <div class="fc-linha">
      ${pldNo('cz', ant ? esc(ant.nome) : 'Início do plano', ant ? 'etapa anterior' : '')}${pldSeta()}
      ${pldNo('az fc-principal', `${i + 1} · ${esc(e.nome.toUpperCase())}`, e.oque)}${pldSeta()}
      ${pldDec(o.pergunta || 'Objetivo cumprido no prazo?')}${pldSeta('SIM', 'ok')}
      ${pldNo('vd', sim, o.simDet || '')}
    </div>
    ${indep ? '<p class="mini"><b>↔ Ramo independente:</b> não espera a cobertura principal nem o checklist.</p>' : ''}
    ${tambem.length ? `<p class="mini"><b>Depende também de:</b> ${tambem.map(q => esc(q.nome)).join(' · ')}</p>` : ''}
    ${pldSetaV(o.nao || 'NÃO', 'ruim')}
    <div class="fc-rot">IMPACTOS</div><div class="fc-linha fc-wrap">${pldImpactoCaixas(e.impacto)}</div>
    ${pldSetaV('ação')}
    <div class="fc-rot">COMO RECUPERAR</div><div class="fc-linha fc-wrap">${e.recupera.map(r => pldNo('am', '↻ AÇÃO', r)).join('')}${pldNo('cz', '↩ VOLTA À DECISÃO', 'reavaliar no apontamento diário')}</div>
  </div>`;
}
// resumo curto do bloqueio (previsão de chegada e dias úteis parados)
function pldBloqueioCurto(x, est, c) {
  const d = pldBloqueioDias(x, est, c.baseRef);
  if (est.prev) return `previsão ${fdA(est.prev)}${d ? ` · ${d} d.u. depois do início previsto` : ' · dentro do início previsto'}`;
  return x.it.inicio <= c.baseRef ? `início previsto (${fdA(x.it.inicio)}) já passou · sem previsão de chegada` : `sem previsão de chegada · início previsto ${fdA(x.it.inicio)}`;
}
// fluxograma de uma atividade do plano: liberação (material › descarga › checklist) ▶ atividade ▶ decisão ─SIM▶ libera | ─NÃO▼ atraso › empurra › precisa
function pldFluxoAtividade(x, c) {
  const it = x.it, un = esc(it.unidade), est = pldPortaoEstado(x), a = pldAtraso(x, c.base), suc = pldSucessoras(c, x);
  const stCls = PL_COR_STATUS[x.status] || 'pendente';
  const principal = pldNo('az fc-principal', esc(it.atividade), `${nf(x.pctReal * 100, 0)}% real / ${nf(x.pctPlan * 100, 0)}% previsto · falta ${plFmt(x.falta, it.unidade)} ${un}`);
  const gates = pldPortoesDe(x).map(g => {
    const r = pldPortaoR(x, g.k), rg = it.portoes?.[g.k];
    return pldNo(r === 'sim' ? 'vd' : r === 'nao' ? 'vm' : 'cz', `${r === 'sim' ? '✓' : r === 'nao' ? '✗' : '?'} ${esc(g.rot)}`, rg?.em ? esc(fdA(rg.em.slice(0, 10)) + ' ' + rg.em.slice(11)) : '');
  }).join(pldSeta());
  let corpo;
  if (est.estado === 'retorna') {
    corpo = `${pldNo('vm', '↩ RETORNA · ' + esc(est.etapa.nome.toUpperCase()), esc(pldBloqueioCurto(x, est, c)))}`;
    const d = pldBloqueioDias(x, est, c.baseRef);
    const prox = suc.length ? suc.filter(s => Math.min(...s.e.ids.map(id => PLD_ORDEM[s.e.fluxo].indexOf(id))) === Math.min(...suc[0].e.ids.map(id => PLD_ORDEM[s.e.fluxo].indexOf(id)))) : [];
    return `<div class="fc fc-atv"><div class="fc-linha fc-wrap">${gates}${pldSeta('', 'ruim')}${corpo}</div>
      <div class="fc-linha fc-wrap fc-baixo">${pldNo('cz', 'ATIVIDADE BLOQUEADA', `${esc(it.atividade)} · ${nf(x.pctReal * 100, 0)}% real`)}${d ? pldSeta('', 'ruim') + pldNo('vm', '⏱ ATRASO', `+${d} d.u. · fim ${fdA(it.fim)} → ${fdA(somarDiasUteis(it.fim, d))}`) : ''}
      ${d && prox.length ? pldSeta('', 'ruim') + pldNo('am', '🔗 EMPURRA', prox.map(({ y }) => `${esc(y.it.atividade)}: ${fdA(y.it.inicio)} → ${fdA(somarDiasUteis(y.it.inicio, d))}`).join('<br>')) : ''}</div></div>`;
  }
  if (est.estado === 'pendente') {
    return `<div class="fc fc-atv"><div class="fc-linha fc-wrap">${gates}${pldSeta()}${principal}${pldSeta()}${pldNo('cz', '? PERGUNTA A CONFIRMAR', esc(est.g.pergunta))}</div></div>`;
  }
  if (x.status === 'CONCLUÍDO') {
    return `<div class="fc fc-atv"><div class="fc-linha fc-wrap">${gates ? gates + pldSeta() : ''}${principal}${pldSeta('', 'ok')}${pldNo('vd', '✓ CONCLUÍDA', x.concluiu ? 'em ' + fdA(x.concluiu) : `${plFmt(x.realAc, it.unidade)} ${un} lançados`)}</div></div>`;
  }
  const fecha = a.dias === 0 && x.status !== 'ATRASADO';
  const prox = suc.length ? suc.filter(s => Math.min(...s.e.ids.map(id => PLD_ORDEM[s.e.fluxo].indexOf(id))) === Math.min(...suc[0].e.ids.map(id => PLD_ORDEM[s.e.fluxo].indexOf(id)))) : [];
  const simNo = pldNo('vd', prox.length ? 'Libera: ' + esc(prox.map(({ y }) => y.it.atividade).join(', ')) : 'Fim do fluxo desta frente', a.proj ? 'término projetado ' + fdA(a.proj) + ' (fim previsto ' + fdA(it.fim) + ')' : '');
  const need = x.ritmoNec != null && x.ritmoNec > 0 ? pldNo('am', '↻ PRECISA', `${plFmtTaxa(x.ritmoNec)} ${un}/dia (hoje ${plFmtTaxa(x.ritmoAtual)})`) : '';
  const nao = fecha ? '' : `<div class="fc-linha fc-wrap fc-baixo">${pldSetaV('NÃO', 'ruim')}${pldNo('vm', '⏱ ATRASO', a.dias ? `+${a.dias} d.u. · termina ${fdA(a.proj)} (fim previsto ${fdA(it.fim)})` : `${nf(x.pctReal * 100, 0)}% real contra ${nf(x.pctPlan * 100, 0)}% previsto`)}
      ${a.dias && prox.length ? pldSeta('', 'ruim') + pldNo('am', '🔗 EMPURRA', prox.map(({ y }) => `${esc(y.it.atividade)}: ${fdA(y.it.inicio)} → ${fdA(somarDiasUteis(y.it.inicio, a.dias))}`).join('<br>')) : ''}${need ? pldSeta('', 'ruim') + need : ''}</div>`;
  return `<div class="fc fc-atv"><div class="fc-linha fc-wrap">${gates ? gates + pldSeta() : ''}${principal}${pldSeta()}${pldDec('Fecha no prazo?')}${pldSeta(fecha ? 'SIM' : 'sim', fecha ? 'ok' : 'apagada')}${simNo}</div>${nao}</div>`;
}
// ---- empresas que executam cada serviço (escolhidas no 5W2H; sem escolha, as da grade de lançamentos)
const pldEmpresas = x => { const l = plEmpresasDoItem(x.it, x.ativ); return l.length ? l : ['SEM EMPRESA DEFINIDA']; };
const pldChipsEmp = x => pldEmpresas(x).map(n => `<span class="emp">${esc(n)}</span>`).join('');
// Selo de qualidade dos dados na capa: as pendências que afetam as atividades do plano (as de gravidade alta ficam listadas)
function pldQualidade(pl) {
  const itens = plQualidadeDosPlanos([pl]), altas = itens.filter(i => i.sev === 'alta');
  if (!itens.length) return '<p class="obj"><b>Qualidade dos dados:</b> <span class="emp">sem pendências nas atividades deste plano</span></p>';
  return `<p class="obj"><b>Qualidade dos dados:</b> <span class="emp" style="background:${altas.length ? '#fde2e2' : '#fff3cd'}">${itens.length} pendência(s) nas atividades deste plano (${altas.length} alta(s))</span> <span class="mini">confira os números abaixo com a área de Planejamento → Qualidade dos dados</span></p>`
    + (altas.length ? `<ul class="mini">${altas.map(i => `<li><b>${esc(i.tipo)}:</b> ${esc(i.alvo)} — ${esc(i.det)}</li>`).join('')}</ul>` : '');
}
function pldListaEmpresas(c) {
  const todas = [...new Set(c.itens.flatMap(pldEmpresas))];
  const ordem = M.empresas.map(e => e.nome);
  return todas.sort((a, b) => (ordem.indexOf(a) < 0 ? 99 : ordem.indexOf(a)) - (ordem.indexOf(b) < 0 ? 99 : ordem.indexOf(b)) || a.localeCompare(b));
}
// Serviços agrupados por empresa. Serviço dividido entre empresas (ex.: Pré-montagem EJ + CMM): quantidade e executado são a parte da empresa
// (contrato ÷ nº de empresas, e o que ela lançou), a mesma regra da Projeção (pjDaEmpresa).
function pldSecaoEmpresas(pl, c) {
  const emps = pldListaEmpresas(c);
  if (!emps.length) return '';
  const blocos = emps.map(emp => {
    const itens = c.itens.filter(x => pldEmpresas(x).includes(emp));
    const ci = typeof pjDaEmpresa === 'function' && emp !== 'SEM EMPRESA DEFINIDA' ? pjDaEmpresa({ ...c, itens }, emp, pl).itens : itens;
    const peso = soma0(ci, x => x.it.peso || 1) || 1;
    const pctR = soma0(ci, x => (x.it.peso || 1) * x.pctReal) / peso * 100, pctP = soma0(ci, x => (x.it.peso || 1) * x.pctPlan) / peso * 100;
    const atras = ci.filter(x => x.status === 'ATRASADO').length, concl = ci.filter(x => x.status === 'CONCLUÍDO').length;
    const linhas = ci.sort((a, b) => a.it.frente.localeCompare(b.it.frente) || a.it.inicio.localeCompare(b.it.inicio)).map(x => {
      const it = x.it, un = it.unidade, outras = pldEmpresas(x).filter(n => n !== emp), m = pldEtapasDe(x);
      return `<tr><td><b>${esc(it.atividade)}</b><div class="mini">${esc(cap(it.frente))}${m.ids.length ? ' · ' + esc(pldEtapa(m.fluxo, m.ids[0]).nome) : ''}</div>${it.como ? `<div class="mini"><b>Como:</b> ${esc(it.como)}</div>` : ''}</td>
        <td>${fdA(it.inicio)} a ${fdA(it.fim)}${x._dv?.valor != null ? `<div class="mini">valor estimado ${rs(x._dv.valor)}</div>` : ''}</td>
        <td class="n">${plFmt(it.qtd, un)} ${esc(un)}${x._parte ? `<div class="mini">parte de ${esc(emp)} (÷ ${x._parte}${outras.length ? ' · com ' + esc(outras.join(', ')) : ''})</div>` : outras.length ? `<div class="mini">com ${esc(outras.join(', '))}</div>` : ''}</td>
        <td class="n">${plFmt(x.realAc, un)} ${esc(un)}</td><td class="n">${nf(x.pctReal * 100, 0)}% / ${nf(x.pctPlan * 100, 0)}%</td><td class="n">${plFmt(x.falta, un)}</td>
        <td><span class="sel st-${esc(PL_COR_STATUS[x.status] || 'pendente')}">${esc(x.status)}</span></td></tr>`;
    }).join('');
    return `<div class="emp-bloco"><div class="emp-cab"><span class="emp grande-emp">${esc(emp)}</span><span class="mini">${ci.length} serviço(s) · realizado <b>${nf(pctR, 0)}%</b> × planejado ${nf(pctP, 0)}% · ${concl} concluído(s)${atras ? ` · <b class="ruim-t">${atras} atrasado(s)</b>` : ''}</span></div>
      <div class="rolagem"><table class="tab"><thead><tr><th>Serviço <span class="mini">(How)</span></th><th>Período <span class="mini">(When)</span></th><th class="n">Quantidade</th><th class="n">Executado</th><th class="n">Real / previsto</th><th class="n">Falta</th><th>Situação</th></tr></thead><tbody>${linhas}</tbody></table></div></div>`;
  }).join('');
  return `<section class="por-empresa"><h2>Serviços por empresa</h2><p class="nota">Cada serviço do plano aparece sob a(s) empresa(s) escolhida(s) para executá-lo (campo Who do 5W2H). Serviço feito por mais de uma empresa mostra a parte de cada uma.</p>${blocos}</section>`;
}
function pldCartaoAtividade(x, c, etapas) {
  const it = x.it, un = it.unidade, stCls = PL_COR_STATUS[x.status] || 'pendente';
  return `<div class="atv">
    <div class="atv-cab"><div><b>${esc(it.atividade)}</b><div class="mini">${esc(cap(it.frente))} · ${fdA(it.inicio)} a ${fdA(it.fim)} · ${plFmt(it.qtd, un)} ${esc(un)} · meta ${plFmtTaxa(x.meta)} ${esc(un)}/dia</div><div class="emp-linha">Empresa: ${pldChipsEmp(x)}</div></div>
      <span class="sel st-${esc(stCls)}">${esc(x.status)}</span></div>
    <div class="barra"><span class="plan" style="width:${nf(x.pctPlan * 100, 0)}%"></span><span class="real st-${esc(stCls)}" style="width:${nf(x.pctReal * 100, 0)}%"></span></div>
    ${it.o_que || it.por_que || it.como ? `<table class="w5"><tr>${it.o_que ? `<th>O quê</th><td>${esc(it.o_que)}</td>` : ''}${it.por_que ? `<th>Por quê</th><td>${esc(it.por_que)}</td>` : ''}</tr>
      <tr>${it.onde ? `<th>Onde</th><td>${esc(it.onde)}</td>` : ''}${it.como ? `<th>Como</th><td>${esc(it.como)}</td>` : ''}</tr></table>` : ''}
    ${pldDivisaoEmpresas(x)}
    ${pldFluxoAtividade(x, c)}
  </div>`;
}
// Atividade com 2 ou mais empresas: quanto, quando e como cada uma executa (produção, financeiro, When e How do 5W2H)
function pldDivisaoEmpresas(x) {
  const it = x.it, d = it.divisao;
  if (!Array.isArray(d) || d.length < 2) return '';
  const un = it.unidade;
  return `<table class="tab"><thead><tr><th>Empresa</th><th>Produção</th><th>Valor estimado</th><th>Quando (When)</th><th>Como (How)</th></tr></thead><tbody>${d.map(e => `<tr><td><b>${esc(e.empresa)}</b></td><td>${plFmt(e.qtd, un)} ${esc(un)}</td><td>${e.valor != null ? rs(e.valor) : '—'}</td><td>${fdA(e.inicio || it.inicio)} a ${fdA(e.fim || it.fim)}</td><td>${esc(e.como || '—')}</td></tr>`).join('')}</tbody></table>`;
}

function pldBlocoPortao(fluxo, e, indice, c) {
  const g = PLD_PORTOES.find(q => q.k === PLD_ETAPA_PORTAO[e.id]), st = pldStatusPortao(fluxo, g.k, c), ordem = PLD_PORTOES.map(q => q.k);
  const plano = pldFluxoDoPlano(c)[fluxo], i = indice - 1;
  const ls = c.itens.filter(x => pldEtapasDe(x).fluxo === fluxo && pldPortoesDe(x).some(q => q.k === g.k))
    .sort((a, b2) => a.it.inicio.localeCompare(b2.it.inicio) || a.it.atividade.localeCompare(b2.it.atividade));
  const sim = g.k === 'material' ? 'Pergunta seguinte: ' + esc(PLD_PORTOES[1].rot) : g.k === 'descarga' ? 'Libera a atividade' + (fluxo === 'galpao' && plano.some(q => q.id === 'g7') ? ' (após o checklist, pergunta do checklist)' : '') : 'Libera a cobertura';
  const linhas = ls.map(x => {
    const r = pldPortaoR(x, g.k), rg = x.it.portoes?.[g.k], ant = pldPortoesDe(x).filter(q => ordem.indexOf(q.k) < ordem.indexOf(g.k)).every(q => pldPortaoR(x, q.k) === 'sim');
    let res, efeito = '';
    if (x.status === 'CONCLUÍDO') res = '<span class="sel ok">concluída</span>';
    else if (!ant) res = '<span class="sel nd">aguarda etapa anterior</span>';
    else if (r === 'sim') res = '<span class="sel ok">sim — prossegue</span>';
    else if (r === 'nao') { res = '<span class="sel ruim">não — retorna</span>'; efeito = pldBloqueioCurto(x, pldPortaoEstado(x), c); }
    else res = '<span class="sel pend">a confirmar</span>';
    return `<tr><td><b>${esc(x.it.atividade)}</b><div class="mini">${esc(cap(x.it.frente))}</div></td><td>${fdA(x.it.inicio)}</td><td>${res}</td>
      <td class="mini">${rg?.em ? esc(fdA(rg.em.slice(0, 10))) + ' ' + esc(rg.em.slice(11)) + (rg.por ? ' · ' + esc(rg.por) : '') : '—'}</td><td class="mini">${efeito ? esc(efeito) : '—'}</td></tr>`;
  }).join('');
  return `<section class="etapa" id="${esc(fluxo + '-' + e.id)}">
    <div class="etapa-cab"><span class="num">${indice}</span><h3>${esc(e.nome)}</h3><span class="sel ${st.cls}">${st.rot}</span></div>
    ${pldFluxogramaEtapa(e, plano, i, { pergunta: esc(g.rot), sim, nao: 'NÃO · retorna' })}
    ${ls.length ? `<div class="rolagem"><table class="tab"><thead><tr><th>Atividade</th><th>Início previsto</th><th>Resposta</th><th>Registro</th><th>Efeito</th></tr></thead><tbody>${linhas}</tbody></table></div>` : ''}
  </section>`;
}
function pldBlocoEtapa(fluxo, e, indice, c, itensEtapa) {
  if (PLD_ETAPA_PORTAO[e.id]) return pldBlocoPortao(fluxo, e, indice, c);
  const st = pldStatusEtapa(itensEtapa), plano = pldFluxoDoPlano(c)[fluxo];
  const casos = itensEtapa.map(x => pldCartaoAtividade(x, c, []));
  return `<section class="etapa" id="${esc(fluxo + '-' + e.id)}">
    <div class="etapa-cab"><span class="num">${indice}</span><h3>${esc(e.nome)}</h3><span class="sel ${st.cls}">${st.rot}</span></div>
    ${itensEtapa.length ? `<div class="emp-linha">Empresa(s) nesta etapa: ${[...new Set(itensEtapa.flatMap(pldEmpresas))].map(n => `<span class="emp">${esc(n)}</span> <span class="mini">${itensEtapa.filter(x => pldEmpresas(x).includes(n)).map(x => esc(x.it.atividade)).join(', ')}</span>`).join(' · ')}</div>` : ''}
    ${pldFluxogramaEtapa(e, plano, indice - 1, {})}
    ${casos.join('')}
  </section>`;
}

// O fluxo padrão (PLD_FLUXOS) é só a fonte de dados. O fluxo do plano é montado a partir das atividades escolhidas no 5W2H:
// entram as etapas que têm atividade no plano (na ordem do fluxo padrão) e as perguntas de liberação que valem para elas.
// Etapas do fluxo padrão sem atividade no plano não aparecem; fluxo sem nenhuma atividade identificada também não.
function pldFluxoDoPlano(c) {
  const r = {};
  ['galpao', 'anexo'].forEach(fluxo => {
    const itens = c.itens.filter(x => pldEtapasDe(x).fluxo === fluxo);
    if (!itens.some(x => pldEtapasDe(x).ids.length)) return;
    const usadas = new Set();
    itens.forEach(x => pldEtapasDe(x).ids.forEach(id => usadas.add(id)));
    r[fluxo] = PLD_FLUXOS[fluxo].etapas.filter(e => {
      const k = PLD_ETAPA_PORTAO[e.id];
      return k ? itens.some(x => pldPortoesDe(x).some(g => g.k === k)) : usadas.has(e.id);
    });
  });
  return r;
}
function pldFluxoVisual(c) {
  const plano = pldFluxoDoPlano(c);
  // atraso (dias úteis) que a etapa passa adiante: o maior entre suas atividades; nas etapas de portão, o bloqueio das atividades que retornam a ela
  const atrasoEtapa = (fluxo, e) => {
    const k = PLD_ETAPA_PORTAO[e.id];
    const ls = c.itens.filter(x => { const m = pldEtapasDe(x); return m.fluxo === fluxo && (k ? pldPortaoEstado(x).estado === 'retorna' && pldPortaoEstado(x).g.k === k : m.ids.includes(e.id)); });
    return Math.max(0, ...ls.map(x => pldAtraso(x, c.base).dias || 0));
  };
  const bloco = fluxo => {
    const et = plano[fluxo];
    if (!et) return '';
    const lay = pldLayout(fluxo, et.map(e => e.id)), pos = id => { const k = et.findIndex(e => e.id === id); return { e: et[k], k }; };
    const caixa = ({ e, k }, prox) => {
      const itens = c.itens.filter(x => { const m = pldEtapasDe(x); return m.fluxo === fluxo && m.ids.includes(e.id); });
      const st = PLD_ETAPA_PORTAO[e.id] ? pldStatusPortao(fluxo, PLD_ETAPA_PORTAO[e.id], c) : pldStatusEtapa(itens), d = atrasoEtapa(fluxo, e);
      const cls = { ok: 'vd', alerta: 'am', ruim: 'vm', pend: 'cz', nd: 'cz' }[st.cls] || 'cz';
      return `<div class="fc-col"><a href="#${esc(fluxo + '-' + e.id)}" class="fc-no ${cls} fc-link"><b>${k + 1} · ${esc(e.nome)}</b><span>${st.rot}</span></a>
        ${d > 0 ? `${pldSetaV('', 'ruim')}${pldNo('vm fc-peq', `+${d} d.u.`, prox ? 'empurra ' + esc(prox.nome) : 'atrasa a entrega')}` : ''}</div>`;
    };
    const cadeia = lay.main.map((id, i) => caixa(pos(id), lay.main[i + 1] ? pos(lay.main[i + 1]).e : null) + (i < lay.main.length - 1 ? pldSeta() : '')).join('');
    // ramos independentes: o que entra (de onde dependem) › etapas do ramo em sequência › o que liberam na cadeia principal
    const ramoHtml = lay.grupos.map(g => {
      const soMaterial = g.entradas.every(id => id === 'g1' || id === 'g2' || id === 'a1' || id === 'a2');
      const nomes = g.entradas.map(id => pldEtapa(fluxo, id).nome).join(' + ') || 'início';
      return `<div class="fc-linha fc-cascata" style="margin-top:10px"><span class="mini"><b>↔ Ramo independente</b> (${soMaterial ? 'depende só de chegada e descarga' : 'depende de ' + esc(nomes)}):</span>`
        + g.entradas.map(id => caixa(pos(id)) + pldSeta()).join('') + g.ids.map((id, n) => caixa(pos(id), g.ids[n + 1] ? pos(g.ids[n + 1]).e : pos(g.saidas[0] || id).e) + (n < g.ids.length - 1 ? pldSeta() : '')).join('')
        + g.saidas.map(id => pldSeta('libera') + `<div class="fc-col"><a href="#${esc(fluxo + '-' + id)}" class="fc-no cz fc-link"><b>${pos(id).k + 1} · ${esc(pos(id).e.nome)}</b></a></div>`).join('') + '</div>';
    }).join('');
    return `<div class="fluxo-linha"><h4>${esc(PLD_FLUXOS[fluxo].nome)} · ${c.itens.filter(x => pldEtapasDe(x).fluxo === fluxo).length} atividade(s) do plano</h4><div class="fc-linha fc-cascata">${cadeia}</div>${ramoHtml}</div>`;
  };
  return bloco('galpao') + bloco('anexo');
}

function pldBloqueios(c) {
  // causa-raiz: atividades que RETORNAM a Chegada de material / Descarregamento / Checklist (etapas mais a montante do fluxo)
  const l = c.itens.map(x => ({ x, est: pldPortaoEstado(x) })).filter(o => o.est.estado === 'retorna');
  if (!l.length) return '';
  return `<div class="alerta-box"><b>Atividades bloqueadas (retornam no fluxo):</b><ul>${l.map(({ x, est }) => { const d = pldBloqueioDias(x, est, c.baseRef); return `<li><b>${esc(x.it.atividade)}</b> — ${esc(est.g.nao.replace(/^Retorna para /, 'retorna para '))}${d ? ` (${d} dia(s) útil(eis) de bloqueio sobre o início previsto)` : ''}</li>`; }).join('')}</ul>Resolver primeiro: o que está nestas etapas segura todas as seguintes.</div>`;
}
function pldGargalo(c) {
  // causa-raiz: na cadeia principal de cada fluxo, a atividade atrasada mais a montante (as etapas seguintes só se recuperam depois dela);
  // atividades atrasadas fora da cadeia principal (ramos independentes) têm alerta próprio e só afetam o que o ramo libera
  const plano = pldFluxoDoPlano(c);
  return ['galpao', 'anexo'].map(fluxo => {
    if (!plano[fluxo]) return '';
    const lay = pldLayout(fluxo, plano[fluxo].map(e => e.id));
    const atras = c.itens.filter(x => x.status === 'ATRASADO').map(x => ({ x, m: pldEtapasDe(x) })).filter(o => o.m.fluxo === fluxo && o.m.ids.length);
    const principal = atras.filter(o => o.m.ids.some(id => lay.main.includes(id))), ramos = atras.filter(o => !o.m.ids.some(id => lay.main.includes(id)));
    const idx = o => Math.min(...o.m.ids.map(id => PLD_ORDEM[fluxo].indexOf(id)));
    principal.sort((a, b) => idx(a) - idx(b));
    let h = '';
    if (principal.length) {
      const o = principal[0], a = pldAtraso(o.x, c.base);
      h += `<div class="alerta-box"><b>Gargalo atual — ${esc(PLD_FLUXOS[fluxo].nome)}:</b> ${esc(o.x.it.atividade)} (etapa “${esc(pldEtapa(fluxo, o.m.ids[0]).nome)}”)${a.dias ? `, projeção de ${a.dias} dia(s) útil(eis) de atraso` : ''}. As etapas seguintes só recuperam se esta for destravada primeiro.</div>`;
    }
    return h + ramos.map(o => `<div class="alerta-box"><b>Ramo independente atrasado:</b> ${esc(o.x.it.atividade)}. Não trava a cadeia principal; atrasa apenas ${pldSucessoras(c, o.x).map(s => esc(s.y.it.atividade)).slice(0, 4).join(', ') || 'a própria sequência do ramo'}.</div>`).join('');
  }).join('');
}

function plDocHtml(pl) {
  const c = plCalc(pl), st = plStatusPlano(c), hojeTxt = fdA(plBase());
  const atrasoPlano = c.terminaEm && c.terminaEm > pl.fim ? contarDiasUteis(pl.fim, c.terminaEm) : 0;
  // agrupa por etapa
  const porEtapa = (fluxo, id) => c.itens.filter(x => { const m = pldEtapasDe(x); return m.fluxo === fluxo && m.ids[0] === id; })
    .sort((a, b) => a.it.frente.localeCompare(b.it.frente) || a.it.inicio.localeCompare(b.it.inicio));
  const semEtapa = c.itens.filter(x => !pldEtapasDe(x).ids.length);
  const fluxoPlano = pldFluxoDoPlano(c);
  const secao = fluxo => (fluxoPlano[fluxo] ? `<h2 class="fluxo-titulo">${esc(PLD_FLUXOS[fluxo].nome)}</h2>` +
    fluxoPlano[fluxo].map((e, i) => pldBlocoEtapa(fluxo, e, i + 1, c, porEtapa(fluxo, e.id))).join('') : '');
  const tabela = c.itens.map(x => { const m = pldEtapasDe(x), a = pldAtraso(x, c.base); return { x, m, a }; })
    .sort((p, q) => (p.m.fluxo === q.m.fluxo ? 0 : p.m.fluxo === 'galpao' ? -1 : 1) || ((p.m.ids.length ? PLD_ORDEM[p.m.fluxo].indexOf(p.m.ids[0]) : 99) - (q.m.ids.length ? PLD_ORDEM[q.m.fluxo].indexOf(q.m.ids[0]) : 99)));
  const linhasTab = tabela.map(({ x, m, a }) => `<tr><td>${m.ids.length ? esc(pldEtapa(m.fluxo, m.ids[0]).nome) : '—'}</td><td><b>${esc(x.it.atividade)}</b><div class="mini">${esc(cap(x.it.frente))}</div></td><td>${pldChipsEmp(x)}</td>
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
  <p class="obj"><b>Empresas executoras:</b> ${pldListaEmpresas(c).map(n => `<span class="emp">${esc(n)}</span> <span class="mini">${c.itens.filter(x => pldEmpresas(x).includes(n)).length} serviço(s)</span>`).join(' ')}</p>
  ${pldQualidade(pl)}
  <div class="tiles">
    <div><span>Planejado até a referência</span><b>${nf(c.pctPlan, 1)}%</b></div>
    <div><span>Realizado</span><b>${nf(c.pctReal, 1)}%</b></div>
    <div><span>Desvio</span><b class="${c.desvio < -1 ? 'ruim-t' : ''}">${c.desvio >= 0 ? '+' : ''}${nf(c.desvio, 1)} p.p.</b></div>
    <div><span>Atividades atrasadas</span><b class="${c.atrasadas ? 'ruim-t' : ''}">${c.atrasadas}/${pl.itens.length}</b></div>
    <div><span>Término no ritmo atual</span><b>${c.terminaEm ? fdA(c.terminaEm) : c.pctReal >= 100 ? 'concluído' : '—'}</b></div>
  </div>
  <p class="parecer">${parecer}</p>${pldBloqueios(c)}${pldGargalo(c)}
</header>

${pldSecaoEmpresas(pl, c)}

<section><h2>1. Fluxo de execução e situação de cada etapa</h2>
  <p class="nota">Fluxo montado a partir das <b>${c.itens.length} atividade(s) deste plano</b>, na ordem do fluxo de execução da obra: só entram as etapas que têm atividade no plano. Cada etapa só começa de verdade quando a anterior entrega. A cor mostra a situação da etapa (pior caso entre suas atividades); clique para ir à explicação. Chegada de material, descarregamento e checklist são perguntas de liberação feitas às atividades do plano (sim = prossegue; não = retorna).</p>
  ${pldFluxoVisual(c)}
  <div class="legenda"><span class="chip ok"></span>no prazo / concluída <span class="chip alerta"></span>no limite <span class="chip ruim"></span>atrasada <span class="chip pend"></span>a iniciar <span class="chip nd"></span>sem lançamento</div></section>

<section><h2>2. Curva S — planejado × realizado</h2>${pldCurvaSvg(c)}
  <div class="legenda"><span class="lin plan"></span>planejado <span class="lin real"></span>realizado <span class="lin proj"></span>projeção no ritmo atual</div></section>

<section><h2>3. Quadro das atividades</h2><div class="rolagem"><table class="tab"><thead><tr><th>Etapa do fluxo</th><th>Atividade</th><th>Empresa(s)</th><th>Período</th><th class="n">Quantidade</th><th class="n">Real / previsto</th><th class="n">Falta</th><th>Término projetado</th><th>Situação</th></tr></thead><tbody>${linhasTab}</tbody></table></div></section>

<section><h2>4. Se o plano não for cumprido</h2>
  <div class="fc"><div class="fc-linha fc-wrap">${pldNo('vm fc-principal', 'PLANO NÃO CUMPRIDO', atrasoPlano ? `+${atrasoPlano} d.u. no ritmo atual (termina ${fdA(c.terminaEm)})` : 'atraso das etapas a montante')}${pldSeta('', 'ruim')}
    ${pldNo('vm', '⏱ PRAZO E CONTRATO', 'atraso repassado às etapas seguintes; multa e pressão do cliente nos marcos de cobertura e fechamento')}
    ${pldNo('vm', '📄 MEDIÇÃO (BM) E CAIXA', 'sem conclusão e evidência (checklist, apontamento, fotos) não há medição; faturamento adiado')}
    ${pldNo('vm', '💲 CUSTO', 'equipes, guindastes, andaimes e supervisão mobilizados por mais tempo')}
    ${pldNo('vm', '✔ QUALIDADE E SEGURANÇA', 'pressa gera retrabalho e trabalho em altura sem planejamento')}
    ${pldNo('vm', '🌧 CLIMA', 'cobertura aberta por mais tempo: chuva e vento sobre material e interior')}</div>
    ${pldSetaV('ação')}
    <div class="fc-linha fc-wrap">${pldNo('am', '↻ RECUPERAR', 'mais recurso e melhor sequência — nunca pular conferências')}${pldSeta()}${pldNo('az', 'PRIORIZAR', 'etapas atrasadas mais a montante do fluxo (gargalo acima)')}</div></div></section>

<h2 class="grande">5. Fluxograma de cada etapa do plano: decisão, impactos e recuperação</h2>
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
.emp{display:inline-block;background:#e0e7ff;color:#3730a3;border-radius:999px;padding:1px 9px;font-size:11px;font-weight:700;margin:0 3px 2px 0;white-space:nowrap}.grande-emp{font-size:14px;padding:3px 14px}.emp-linha{margin:4px 0;font-size:12.5px;color:var(--fg2)}.emp-bloco{margin:14px 0;break-inside:avoid-page}.emp-cab{display:flex;align-items:center;gap:12px;margin-bottom:6px;flex-wrap:wrap}.por-empresa .rolagem{background:var(--card);border:1px solid var(--bd);border-radius:10px}
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
.fc{margin:8px 0;padding:10px;background:#fbfcfe;border:1px solid var(--bd);border-radius:10px;break-inside:avoid}
.fc-linha{display:flex;align-items:center;gap:4px}.fc-wrap{flex-wrap:wrap;align-items:stretch}.fc-baixo{margin-top:8px;padding-left:24px}
.fc-no{border-radius:10px;padding:7px 10px;border:2px solid;background:#fff;font-size:12px;line-height:1.3;min-width:120px;max-width:260px}.fc-no b{display:block;font-size:12px}.fc-no span{display:block;color:var(--fg2);font-size:11.5px}
.fc-principal{max-width:300px}.fc-peq{font-size:11px;min-width:110px;max-width:150px}.fc-link{text-decoration:none;color:inherit;display:block}
.fc-no.az{border-color:#1d4ed8;background:#eff6ff}.fc-no.vd{border-color:#15803d;background:#f0fdf4}.fc-no.vm{border-color:#b91c1c;background:#fef2f2}.fc-no.am{border-color:#b45309;background:#fffbeb}.fc-no.cz{border-color:#94a3b8;background:#f1f5f9}
.fc-dec{width:150px;height:92px;flex:none;position:relative;font-weight:700;font-size:12px;text-align:center}.fc-dec svg{position:absolute;inset:0;width:100%;height:100%}
.fc-dec span{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:0 30px}
.fc-seta,.fc-setav{color:#64748b;text-align:center;line-height:1;flex:none}.fc-seta i{font-style:normal;font-size:18px}.fc-seta small,.fc-setav small{display:block;font-size:10px;font-weight:700}
.fc-seta.ok small{color:var(--ok)}.fc-seta.ruim,.fc-setav.ruim{color:var(--ru)}.fc-seta.apagada{opacity:.35}
.fc-setav{margin:4px 0 4px 20px;text-align:left}.fc-setav i{font-style:normal;font-size:18px}.fc-setav small{display:inline;margin-left:6px}
.fc-rot{font-size:10.5px;font-weight:700;letter-spacing:.06em;color:var(--fg2);margin:4px 0 3px 4px}
.fc-cascata{align-items:flex-start;flex-wrap:wrap;row-gap:10px}.fc-col{display:flex;flex-direction:column;align-items:flex-start}.fc-col .fc-setav{margin-left:40px}
.fc-atv{background:#fff}
.pergunta{background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:8px 12px;margin:6px 0 8px}.lib{margin-top:6px;padding:6px 10px;border:1px dashed var(--bd);border-radius:6px;background:#fff}.lib-ruim{color:var(--ru);margin-top:4px}
.pt{display:inline-block;border-radius:6px;padding:1px 8px;font-size:12px;font-weight:600}.pt.ok{background:#dcfce7;color:#166534}.pt.ruim{background:#fee2e2;color:#991b1b}.pt.pend{background:#e2e8f0;color:#475569}.pt small{font-weight:400}
.alerta-box ul{margin:4px 0}
.apoio{background:#f1f5f9;border-radius:6px;padding:8px 10px;color:var(--fg2);margin-top:8px}.geral li{margin:5px 0}.fluxo-titulo{margin-top:26px;color:var(--ac)}
footer{margin:28px 0 8px;font-size:12px;color:var(--fg2)}
@media(max-width:760px){body{padding:12px}.cols{grid-template-columns:1fr}}
@media print{body{background:#fff;padding:0;max-width:none}.topo-acoes{display:none}.etapa,.atv{break-inside:avoid}.capa,.etapa{border-color:#bbb}a{color:inherit}.chip{-webkit-print-color-adjust:exact;print-color-adjust:exact}.sel,.barra span,.num,.impacto,.sit,.casc,.alerta-box{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
`;

// ---------------------------------------------------------------- aba "Liberação do fluxo" (perguntas sim/não por atividade)
function plLiberacao(pl, c, box) {
  const m = x => pldEtapasDe(x), ord = x => (m(x).fluxo === 'galpao' ? 0 : 1000) + (m(x).ids.length ? PLD_ORDEM[m(x).fluxo].indexOf(m(x).ids[0]) : 99);
  const linhas = c.itens.slice().sort((a, b2) => ord(a) - ord(b2) || a.it.inicio.localeCompare(b2.it.inicio)).map(x => {
    const est = pldPortaoEstado(x), lista = pldPortoesDe(x), e0 = m(x).ids.length ? pldEtapa(m(x).fluxo, m(x).ids[0]).nome : '—';
    const cel = g => {
      if (!lista.some(q => q.k === g.k)) return '<td class="pl-lib-na">—</td>';
      const r = pldPortaoR(x, g.k), rg = x.it.portoes?.[g.k], libera = x.status === 'CONCLUÍDO' || lista.filter(q => PLD_PORTOES.indexOf(q) < PLD_PORTOES.indexOf(g)).every(q => pldPortaoR(x, q.k) === 'sim');
      if (x.status === 'CONCLUÍDO') return '<td class="pl-lib-na">concluída</td>';
      if (!libera) return '<td class="pl-lib-na">aguarda a pergunta anterior</td>';
      const bt = (v, rot) => `<button class="btn pl-lib-bt ${r === v ? (v === 'sim' ? 'sim' : 'nao') : ''}" data-pl-lib="${esc(x.it.chave)}" data-g="${g.k}" data-r="${v}" title="${r === v ? 'Clique para limpar a resposta' : ''}">${rot}</button>`;
      return `<td class="pl-lib-cel">${bt('sim', 'Sim')}${bt('nao', 'Não')}${r === 'nao' ? `<label class="nota">chega em <input type="date" data-pl-lib-prev="${esc(x.it.chave)}" data-g="${g.k}" value="${esc(rg?.prev || '')}"></label>` : ''}
        ${rg?.em ? `<div class="nota">${esc(fdA(rg.em.slice(0, 10)))} ${esc(rg.em.slice(11))}${rg.por ? ' · ' + esc(rg.por) : ''}</div>` : ''}</td>`;
    };
    return `<tr><td><b>${esc(x.it.atividade)}</b><div class="nota">${esc(cap(x.it.frente))} · início previsto ${fdA(x.it.inicio)}</div></td><td>${esc(e0)}</td>${PLD_PORTOES.map(cel).join('')}
      <td><span class="farol f-${est.cls === 'ok' ? 'verde' : est.cls === 'ruim' ? 'vermelho' : 'pendente'}">${esc(est.rot)}</span>${est.estado === 'retorna' ? `<div class="nota valor-neg">${esc(est.etapa.nome)}</div>` : ''}</td></tr>`;
  }).join('');
  const n = { retorna: 0, pendente: 0, liberada: 0 };
  c.itens.forEach(x => { const s = pldPortaoEstado(x).estado; if (n[s] != null) n[s]++; });
  box.innerHTML = `<div class="bloco"><div class="bloco-cab"><h2>Liberação do fluxo — material · descarregamento · checklist</h2></div>
    <p class="nota">Antes de cada atividade, responda em ordem: <b>o material chegou?</b> → <b>foi descarregado?</b> → <b>checklist aprovado?</b> (esta última só para o que vem depois do checklist no galpão). <b>Sim</b> = prossegue; <b>Não</b> = <b>retorna</b> àquela etapa e a atividade fica bloqueada (informe a previsão de chegada para o plano calcular o atraso). A resposta fica gravada com data, hora e quem respondeu, e entra no documento “Baixar planejamento”.</p>
    <p class="nota"><b>${n.liberada}</b> liberada(s) · <b>${n.pendente}</b> a confirmar · <b class="${n.retorna ? 'valor-neg' : ''}">${n.retorna}</b> retornando</p>
    <div class="tabela-rolagem"><table class="pl-tab pl-lib"><thead><tr><th>Atividade</th><th>Etapa do fluxo</th>${PLD_PORTOES.map(g => `<th>${g.rot}</th>`).join('')}<th>Situação</th></tr></thead><tbody>${linhas}</tbody></table></div></div>`;
}
// Obs.: item sem respostas volta do servidor com portoes = [] (array vazio do PHP); gravar propriedades num array as perderia
async function plLibGravar(chave, mut) {
  const pl = plPlano(PL.sel);
  if (!pl) return;
  const itens = pl.itens.map(i => (i.chave === chave ? { ...i, portoes: mut(Array.isArray(i.portoes) ? {} : JSON.parse(JSON.stringify(i.portoes || {}))) } : i));
  try {
    await postar(API + 'planos', { plano: { ...pl, itens } });
    await plCarregar(true);
    plRenderPainel();
  } catch (e) { toast(e.message || 'Não foi possível gravar a resposta.', true); }
}
document.addEventListener('click', ev => {
  const bt = ev.target.closest && ev.target.closest('[data-pl-lib]');
  if (!bt) return;
  const k = bt.dataset.g, r = bt.dataset.r, ordem = PLD_PORTOES.map(g => g.k);
  plLibGravar(bt.dataset.plLib, pt => {
    if (pt[k] && pt[k].r === r) delete pt[k];             // clicar de novo limpa a resposta
    else pt[k] = { ...(pt[k] || {}), r };
    if (r === 'sim' || !pt[k]) { /* sim ou limpar: respostas seguintes continuam valendo */ }
    if (!pt[k] || pt[k].r !== 'sim') ordem.slice(ordem.indexOf(k) + 1).forEach(q => delete pt[q]);   // não/limpar: o fluxo retorna, as perguntas seguintes recomeçam
    return pt;
  });
});
document.addEventListener('change', ev => {
  const t = ev.target;
  if (!t.dataset || t.dataset.plLibPrev === undefined) return;
  const k = t.dataset.g;
  plLibGravar(t.dataset.plLibPrev, pt => { if (pt[k]) pt[k].prev = t.value || null; return pt; });
});

// ---------------------------------------------------------------- efeito cascata de um impacto (usado na aba Impactos e no relatório)
// Impacto ou atraso numa atividade empurra as atividades POSTERIORES do fluxo da obra (ordem de PLD_FLUXOS): se a estrutura do
// fechamento atrasa, as telhas do fechamento e tudo o que vem depois sofrem. Nos anexos, só as atividades do mesmo anexo.
function pldEtapasPorNome(servico, frente) {
  const fluxo = pldFluxoDe(frente), serv = ganNorm(servico), reg = PLD_REGRAS[fluxo].find(([re]) => re.test(serv));
  return { fluxo, ids: reg ? reg[1] : [] };
}
function impactoCascata(servico, frente) {
  const m = pldEtapasPorNome(servico, frente);
  if (!m.ids.length) return null;
  const ordem = PLD_ORDEM[m.fluxo], suc = new Set(m.ids.flatMap(id => pldSuc(m.fluxo, id)));
  const posteriores = (typeof plAtividades === 'function' ? plAtividades() : [])
    .map(a => ({ a, e: pldEtapasPorNome(a.it.servico, a.frente) }))
    .filter(({ a, e }) => e.fluxo === m.fluxo && e.ids.length && a.status !== 'CONCLUÍDO' && (m.fluxo === 'galpao' || ganNorm(a.frente) === ganNorm(frente))
      && e.ids.some(id => suc.has(id)))   // só o que depende (direta ou indiretamente) da etapa do impacto
    .sort((x, y) => ordem.indexOf(x.e.ids[0]) - ordem.indexOf(y.e.ids[0]) || (x.a.ini || '').localeCompare(y.a.ini || ''))
    .map(({ a, e }) => ({ nome: a.nome, fase: a.fase, frente: a.frente, etapa: pldEtapa(m.fluxo, e.ids[0]).nome, ini: a.ini, prazo: a.prazo, empresas: a.empresas || [], status: a.status }));
  const vezes = {};
  posteriores.forEach(p => { vezes[p.nome] = (vezes[p.nome] || 0) + 1; });
  posteriores.forEach(p => { p.rotulo = vezes[p.nome] > 1 ? `${p.nome} · Fase ${p.fase}` : p.nome; });   // mesmo serviço nas Fases 1 e 2
  return { fluxo: m.fluxo, etapa: pldEtapa(m.fluxo, m.ids[0]).nome, posteriores };
}

function plBaixarDoc(pl) {
  const html = plDocHtml(pl);
  const nome = `planejamento-${String(pl.nome || 'plano').replace(/[^\w\-]+/g, '_')}-${plBase()}.html`;
  reAbrirPrevia(html, nome, `Planejamento · ${pl.nome || ''}`);   // visualização antes de baixar
}
document.addEventListener('click', ev => {
  const b = ev.target.closest && ev.target.closest('[data-pl-doc]');
  if (!b) return;
  const pl = plPlano(PL.sel);
  if (!pl) return;
  try { plBaixarDoc(pl); } catch (e) { toast('Não foi possível gerar o documento: ' + (e.message || e), true); }
});
