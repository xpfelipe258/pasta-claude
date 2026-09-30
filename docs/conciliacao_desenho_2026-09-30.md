# Conciliação do desenho de montagem com os lançamentos (30/09/2026)

Fonte: desenho da fase 1 (eixos 11 a 20) enviado em 30/09/2026, guardado em `dados/desenho_montagem_2026-09-30.png`.
A imagem foi convertida em dados compactos (`dados/desenho_montagem_2026-09-30.json`, 2 KB) por
`ferramentas/desenho_montagem.py extrair`, e o histórico foi gravado na planilha de produção por
`ferramentas/desenho_montagem.py carregar` (368 registros em APONTAMENTO MONTAGEM: uma linha por joist, com o nº da joist na rua, e uma por viga, como **regularização**: não soma na
produção, que continua exatamente como foi lançada).

## Como o desenho foi lido

- Círculos vermelhos = eixos; quadrados azuis = estações de viga A a H (de cima para baixo).
- Barras amarelas horizontais = joists montadas (43 retângulos por rua, numerados de 1 a 43 de cima para baixo); faixas amarelas verticais sobre o eixo =
  vigas montadas; cinza = pendente.
- Marcas verdes feitas à mão = peças feitas: 3 faixas verticais entre G e H nos eixos 11, 12 e 13 (6 vigas: G e H de
  cada eixo) e 4 pontos na rua 13-14, faixa GH (4 joists). Interpretei como montadas.

## Resultado

| | Lançado (produção) | No desenho | Diferença |
|---|---|---|---|
| Joists içadas | 265 (EJ 162, CMM 103) | 266 | 1 a mais no desenho |
| Vigas montadas | 103 (EJ 67, CMM 36) | 102 | 1 a apontar |

Joists por rua (no desenho): 11-12 = 36, 12-13 = 37, 13-14 = 39, 14-15 = 42, 15-16 = 42, 16-17 = 37, 17-18 = 33; ruas
18-19 e 19-20 ainda sem montagem. Nenhuma rua passa de 43.

Por lado (AB a DE x EF a GH) o desenho dá 158 x 108 joists, contra 162 x 103 lançadas: a divisão por lado explica os
lançamentos de joist dentro de 5 peças, e foi usada para a empresa do histórico de joists. Nas vigas a divisão por lado
**não** explica os lançamentos (lado EJ: 54 no desenho contra 67 lançadas; lado CMM: 48 contra 36): o EJ montou vigas do
lado CMM. Por isso as 48 vigas do lado CMM ficaram **A DEFINIR** e o painel "Definir empresa do histórico"
(Produção > Apontar montagem) atribui por região. O BM não muda, porque vem dos lançamentos.

## Validação física (desenho x retiradas de fixadores)

| Item | Consumo virtual pelo desenho | Retirado fisicamente |
|---|---|---|
| FG022 (porca Ø3/4", 2 por VC01, 14 VC01) | 28 | 28 |
| FG021 (porca Ø1", 4 por apoio, 48 apoios) | 192 | 194 |
| FG023 (arruela Ø1") | 192 | 184 |
| FG012 (parafuso Ø7/8", 8 por intermediária, 40 + 14 VC01 x 4) | 376 | 405 |
| FG007 (joists nos apoios) | 631 | 663 |

- A viga **intermediária leva 8** parafusos/porcas/arruelas Ø7/8" (antes eu tinha assumido 4: com 4 o FG012 daria 216
  contra 405 retirados). Regra corrigida em `regras_baixa.json`.
- Parafusos Ø1/2" das joists: retirados no total 2.143 (FG005 909 + FG006 281 + FG007 663 + FG019 290) contra 2.120
  esperados (8 x 265). O FG019 parece substituir o FG005 em parte das joists das vigas intermediárias.

## Premissas do histórico (corrigir se souber a distribuição real)

- **Distribuição das joists entre as vigas de apoio**: o desenho não mostra em qual viga cada joist apoia. Usei 1/4/1
  nas faixas com viga intermediária (BC a FG) e 3/3 em AB e GH, o padrão que mais se aproxima das retiradas de
  FG005/006/007 (erro de 12 pontos percentuais; terços iguais dão 46 e o padrão 1/3/2 da planilha dá 19). Está em
  `DISTRIBUICAO` no script; `carregar --refazer` recarrega com outro padrão.
- Cada rua tem 43 retângulos (a 43ª fica na faixa DE, que tem 7). O desenho marca 266 joists contra 265 lançadas: a diferença de 1 joist é só de conciliação, a produção não muda.
- Regras de leitura: cobertura amarela mínima de 35% em cada uma das 6 bandas da faixa; se uma faixa tem mais barras que o previsto, valem as de maior cobertura.
- O histórico não tem data (aparece "—"); a data real do lançamento continua na grade de produção.
