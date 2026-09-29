# Módulo Medição (BM) — Produção x Financeiro

Liga o lançamento diário de produção ao boletim de medição de cada empresa
(EJ, CMM, GLOBO AÇOS), com valores nos contratos QPC e RÓTULA e desconto de
equipamento e combustível. Funciona no programa local e no sistema online.

## Fluxo

```
Lançamento de produção (Lançamentos > Por serviço (BM))
   quantidade por dia em cada atividade do catálogo
        |
        v
% da atividade = realizado acumulado / quantidade contratada (máx. 100%)
% do item      = soma (% da atividade x peso da atividade)
valor medido   = % do item x valor do item (QPC e RÓTULA)
        |
        v
Boletim (Medição (BM)): medido no período e acumulado, por item e atividade
(-) equipamentos e combustível lançados em Equipamentos (contrato RÓTULA)
(-) deduções manuais (adiantamento, refeição, outras)
= valor a faturar
```

Mesma regra da aba `BM2-MC MONTAGEM` das planilhas de medição
(`docs/fluxo_boletim_medicao.md`). Conferido com a produção real da EJ: cobertura
33,2%, valor QPC R$ 345.958 e RÓTULA R$ 417.855 no acumulado.

## Onde ficam os dados (abas criadas na planilha)

| Aba | Conteúdo |
|---|---|
| BM ATIVIDADES | catálogo: atividade, unidade, quantidade, peso no item, valor do item QPC e RÓTULA, coluna no controle |
| BM PERÍODOS | data de corte de cada BM por empresa |
| BM APONTAMENTO | quantidade por dia e atividade (atividades sem coluna no controle) |
| BM DEDUÇÕES | deduções manuais por BM |
| BM FECHAMENTO | um registro por BM fechado, com o total de equipamento e combustível descontado (não editar) |
| BM FECHAMENTO ATIVIDADES | foto de cada atividade no fechamento: realizado, quantidade, peso e valor do item (não editar) |

Na primeira execução o programa cria as abas e carrega o catálogo inicial
(168 atividades: EJ 69, CMM 16, GLOBO AÇOS 83). No sistema online, o catálogo
chega com a importação dos dados do programa local; instalações antigas ganham as
tabelas sozinhas.

## Fechamento do BM e correção de datas passadas

- **Fechar BM:** no boletim de um BM que já tem data de corte, o botão "Fechar BMn"
  (com confirmação) grava a foto do BM. Os BMs anteriores precisam estar fechados.
- **BM fechado é congelado:** quantidades, pesos, valores e equipamento/combustível
  ficam como no fechamento. Corrigir depois uma data daquele período não altera o BM.
- **Ajuste:** a diferença causada por correções em datas de períodos fechados entra no
  BM em aberto, em linha separada ("ajuste de períodos anteriores") e num ponto de atenção.
- **Aviso na hora de lançar:** a célula de uma data em período fechado fica listrada, com
  borda vermelha, e a barra de pendências informa quantos lançamentos vão virar ajuste.
- **Reabrir BM:** desfaz o fechamento do último BM fechado (com confirmação); ele volta a
  refletir os dados vivos. Períodos fechados não podem ser editados até serem reabertos.

## Regras

- **Períodos:** o BM vai do dia seguinte ao corte anterior até a data de corte.
  O que é lançado depois do último corte forma o "BM em aberto".
- **Equipamento e combustível:** somam os lançamentos de `USO EQUIPAMENTOS` no
  período e são descontados do contrato RÓTULA (constante `BM_DESCONTA_EQUIP`
  em `app.js`). Empresa compartilhada (EJ/CMM) divide o custo por igual.
- **Deduções manuais:** casam com o BM pelo número; sem número, pela data.
- **Atividades ligadas ao controle:** cobertura da EJ e da CMM (vigas senoidais,
  pré-montagem de joist, instalação de joist) usam as colunas VIGAS, PREMONTAGEM e
  IÇAMENTO JOIST do controle de produção. A linha por serviço e a grade da semana
  mostram e gravam o mesmo dado. As demais são gravadas em BM APONTAMENTO.
- **Pesos que não somam 100%:** o sistema normaliza e mostra um alerta.

## Atualizar o catálogo

Quando uma planilha de medição for revisada (preço, quantidade ou peso), edite a
atividade em Medição (BM) > Catálogo de atividades, ou gere de novo o catálogo:

```
python ferramentas/extrair_catalogo_bm.py BM_EJ.xlsx BM_CMM.xlsx BM_GLOBO.xlsx
```

O script confere que a soma dos itens fecha com o total dos contratos QPC e RÓTULA.

## Pontos de atenção encontrados nas planilhas

1. **EJ, itens 3.3.15 e 3.3.17:** os pesos das atividades somam 110% (deveriam somar 100%).
2. **Suporte de fechamento lateral:** EJ tem 648 un e CMM tem 324 un, para o mesmo
   serviço dividido ao meio. Confirmar qual está correto.
3. **CMM:** a planilha de medição enviada é anterior às atualizações da EJ e da GLOBO.
4. **Preços e quantidades** foram lidos das abas QPC e RÓTULA de cada planilha.

## Decisões pendentes

- **GLOBO:** o controle de produção lança PERFILAÇÃO e TELHAR em outra unidade
  (escopo 446) e o BM mede em m² (75.835,93). Enquanto não houver fator de
  conversão, as linhas da GLOBO são apontadas só pelo BM (sem coluna no controle).
- **Atividades de fechamento, marquises e anexos** também não têm coluna no
  controle, porque o controle agrupa atividades de forma diferente do BM.
- **Fase 2 (eixos 1 a 11):** o controle de produção só tem colunas da Fase 1.
