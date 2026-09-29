# Interação entre setores — Obra 198 / G200

Setores: **Planejado** (cronograma do cliente + metas), **Produção** (lançamento
diário por empresa), **Estoque** (materiais e movimentação), **Financeiro**
(contratos QPC/RÓTULA e medições BM). Equipamentos entram como custo de apoio.

## Chave mestra

Todo dado do sistema precisa carregar as mesmas chaves para poder ser cruzado:

| Chave | Exemplo | Origem hoje |
|---|---|---|
| Empresa | EJ, CMM, GLOBO AÇOS | abas CONTROLE |
| Serviço de produção | PREMONTAGEM, IÇAMENTO JOIST, VIGAS, PERFILAÇÃO | METAS CLIENTE |
| ID do cronograma | ID 15, 16, 17, 18 | linha 3 das abas CONTROLE |
| Item do BM | 3.1.1, 3.2.1 | planilhas de medição (novo) |
| Frente | Galpão F1 cobertura, marquise, eclusa | METAS CLIENTE |
| Contrato | QPC ou RÓTULA | BM (novo) |
| Data | dia de lançamento | todas |

**Tabela nova: MAPA MESTRE** liga as chaves entre si (serviço de produção ->
ID do cronograma -> item do BM -> material). Sem ela nenhum cruzamento fecha.
Ponto crítico: o BM mede o item inteiro (3.1.1 cobertura), enquanto a produção
lança atividades (pré-montagem, içamento de joist, vigas). O % do BM é a soma
ponderada dos % das atividades, com o "Peso no avanço" de METAS CLIENTE.

## 1. Produção x Planejado

- Previsto(t) = quantidade x dias úteis decorridos / dias úteis da tarefa (ou meta diária).
- Realizado acumulado = soma dos lançamentos por ID do cronograma.
- Desvio = realizado - previsto. SPI = realizado / previsto.
- Previsão de término = hoje + (quantidade - realizado) / média dos últimos 5 dias úteis.
- Farol: verde >= 100%, amarelo 85% a 100%, vermelho < 85% (parâmetro).
- Causa do atraso vem da LISTA DE IMPACTO (categoria da causa), por data e serviço.
- Saída: curva S por empresa e por quadrante (fase x lado da cumeeira).

## 2. Produção x Estoque

- Consumo teórico = produção do dia x coeficiente de consumo do material.
- Saldo teórico = saldo inicial + entradas - consumo teórico - saídas +/- ajustes.
- Perda = saldo teórico - saldo contado no inventário (ajuste). Índice de perda em %.
- Cobertura em dias = saldo / (meta diária prevista x coeficiente).
- Ponto de pedido = mínimo + prazo de reposição x consumo diário previsto.
- Necessidade total vem do IFC (contagem de suportes de joist, porcas, arruelas,
  clipes, suportes de calha, telhas) menos o já recebido = saldo a comprar.
- Alerta cruzado: cobertura < prazo de reposição gera a causa "Falta de
  matéria-prima" sugerida no controle KPI.

## 3. Produção x Financeiro

- Valor apropriado = produção do dia x preço unitário do contrato (QPC e RÓTULA
  separados, pois os preços diferem).
- A medir = valor apropriado acumulado - valor já medido em BM anteriores.
- Medido no BM não pode superar o realizado validado; se superar, alerta.
- % físico (produção) x % financeiro (BM) por empresa e contrato.
- Custo de apoio por unidade produzida = custo de equipamento e combustível do
  período / quantidade produzida.
- Custo de impacto = horas paradas (LISTA DE IMPACTO) x custo do equipamento ou equipe parada.

## 4. Estoque x Financeiro

- Valor do estoque = saldo x custo unitário (falta o cadastro de custo).
- Entradas ligam ao documento (NF ou romaneio) e ao contas a pagar.
- Custo de material apropriado por serviço e contrato = consumo x custo unitário.
- Perdas em R$ = perda x custo unitário.
- Itens fornecidos pela RÓTULA à subempreiteira (material, refeição, equipamento)
  viram dedução no BM, como já ocorre no "VALOR A FATURAR" (adiantamento, almoço).

## Fluxo geral

```
Planejado -> Produção -> Estoque (consumo) -> Financeiro (custo)
                 \-----------------------------> Financeiro (medição, BM)
Estoque -> alerta de falta -> causa do atraso na Produção
```

## Dados que faltam

1. Mapa mestre (serviço x ID cronograma x item do BM x material).
2. Preço unitário por item e contrato (extrair dos BMs).
3. Custo unitário dos materiais.
4. Regra de medição: quando a produção vira BM (data de corte e quem valida).
5. Quem fornece cada material e cada equipamento, e o que é descontado no BM.
6. Áreas das duas fases (eixos 1 a 11 e 11 a 20) para ponderar o planejado.
