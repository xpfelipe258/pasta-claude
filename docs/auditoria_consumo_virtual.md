# Auditoria do CONSUMO VIRTUAL (aba INVENTARIO do `teste claude.xlsm`)

Base da conferência: produção acumulada do `PLANO_DE_PRODUCAO` (PREMONTAGEM 299 joists = 128 EJ + 171 CMM;
IÇAMENTO JOIST 265 = 162 + 103; VIGAS 103 = 67 + 36, sem tipo) contra as abas Apontamento_Quadrantes,
Montagem_Vigas, Consumo_Quadrantes, Consumo_Joists, Controle_Materiais e INVENTARIO.

## Como o consumo virtual deveria nascer

```
produção (joists pré-montadas)  x composição por joist  -> FJ001..FJ006 (Ø3/8")
produção (joists içadas)        x 8 parafusos Ø1/2"      -> FG005/006/007 (tipo pela viga da posição)
                                x 8 porcas e 8 arruelas  -> FG015 / FG018 (1:1 com o parafuso)
vigas montadas (por tipo)       x conjunto da viga       -> FG011/012/017/020/021/022/023/024
```

Consumo virtual = quanto de material a produção registrada explica. Perda real = retirada física − consumo virtual.

## Erros encontrados na coluna G (Consumo Virtual)

| Itens | Fórmula na planilha | Problema | Correto (produção) |
|---|---|---|---|
| FJ001, FJ002, FJ003, FJ005, FJ006 | `Controle_Materiais!O` (valor gravado pela macro) | Calculado com ~314 joists; a produção registra 299. FJ006 ainda soma `Apontamento_Montagem!D35*2`, termo dos travamentos (FG011) | 299 x composição: 4.784 / 112.424 / 117.208 / 117.208 / 76.544 |
| FG015, FG018 | `Controle_Materiais!O + Consumo_Quadrantes!F` | Os dois termos valem 1.067 (mesmo consumo): contado em dobro = 2.134 | 8 x 265 = 2.120 |
| FG019 | mesma fórmula | `Consumo_Quadrantes` lança em FG019 o consumo da coluna FG005 (579) e a soma duplicada dá 1.158 (estoque virtual −791) | 0 (ver pendência C) |
| FG005 | `SUM(Apontamento_Quadrantes!AA5:AA172)` | Três valores para o mesmo item: 579 (INVENTARIO), 3.091 (Controle_Materiais = 8 x 314 supondo tudo FG005 + 579), 0 (Consumo_Quadrantes) | 1.211 (estimado, pendência A) |
| FG006, FG007 | `SUM(AB5:AB173)`, `SUM(AC6:AC174)` | Intervalos diferentes entre si (AC pula a linha 5); dependem das fórmulas quebradas abaixo | 303 / 606 (estimado) |
| FG008 | valor digitado `160` | Sem regra nem origem | mantido, marcado "Planilha" |
| FG011/012/017/020/021/023 | `Apontamento_Montagem!D33..D35 x 2/4/8` | Contagem manual (35 vigas pilar, 25 intermediárias, 50 travamentos) conflita com Montagem_Vigas (51 apoio, 34 intermediárias) e com a produção (103 "VIGAS") | mantidos, marcados "Planilha" (pendência B) |
| Coluna K (% dif. estoque) | `IF(F=0,IF(F=0,0,1),J/F)` | O teste interno repete `F=0`: nunca devolve 1, esconde diferença quando o estoque físico é zero | corrigido no app |

Apontamento_Quadrantes (origem de FG005/006/007/015/018): 14 células em 13 linhas têm fórmula quebrada
(`AC13`, `AA14` fixo, `AC14`, `AC15`, `AC20:AC22`, `AC27:AC29`, `AC34:AC35`, `AC41:AC42` apontam para a linha
errada) e geram 14 quadrantes "REVISAR MAPEAMENTO". Há 7 quadrantes com mais de 6 joists (limite do IFC), duas
posições lançadas sem viga (15/16-AB e 15/16-GH) e o registro cobre 168 das 265 joists içadas.

## O que mudou no sistema

- Consumo virtual do Inventário e do Controle de Materiais agora vem da produção x `regras_baixa.json`
  (função `consumoVirtualPorTag`), não do valor gravado na planilha. Recebido e retirado vêm das abas Remessas e
  Consumo físico, então uma remessa nova já altera o Inventário.
- Colunas derivadas com as mesmas regras da planilha (verificado: 0 divergências nos 30 itens).
- Coluna **Origem**: Produção / Ajuste / Planilha, com a memória de cálculo ao passar o mouse; o valor antigo da
  planilha e a diferença aparecem abaixo do novo.
- `regras_baixa.json`: divisão dos parafusos com fração exata (soma 8), `inventario_ajustes` (FG019) e
  `inventario_notas`.
- Rota `/api/regras-baixa`: antes a tela buscava o arquivo numa pasta onde ele não existia, e Fixadores Críticos e
  Prontidão de materiais ficavam em "Carregando".
- Fixadores Críticos e Prontidão passaram a usar a retirada física real (antes liam o `consumido` da planilha).

Resultado: 11 itens com consumo virtual corrigido; FJ002/FJ003/FJ005 passam de CONFORME para CRÍTICO (retiradas
de ~118 mil peças contra 112 mil explicadas pela produção); FG007 passa a CONFORME.

## Pendências que dependem de decisão do fluxo

- **A. Parafusos FG005/006/007.** O total (8 por joist içada) é exato; a divisão 4/7, 1/7, 2/7 é estimada. As
  retiradas físicas (909 / 281 / 663) sugerem menos FG005 do que o estimado (o app mostra FG005 com sobra de 302).
  Também falta definir se o parafuso baixa no içamento ou na fixação: as retiradas somam 1.853 parafusos, abaixo
  dos 2.120 esperados.
- **B. Vigas.** A produção só tem "VIGAS" (103). Precisa separar apoio, intermediária e VC01, e decidir 4 ou 8
  parafusos por viga intermediária (regras de serviço usam 8; eventos e Consumo_Quadrantes usam 4).
- **C. FG019.** Há 290 retiradas físicas de FG019 sem consumo explicado: confirmar se ele substitui FG005 em parte
  das vigas intermediárias (VC03/05/07).
- **D. Fixadores Ø3/8".** As retiradas equivalem a ~314 joists e a produção registra 299: 15 joists a mais
  (~5,8 mil parafusos, ~5,9 mil porcas/arruelas). Ou a produção está subapontada, ou saiu material em excesso.

Proposta para A e B: apontar joists içadas por rua/faixa/posição (eventos `JOIST_ICADA`) e vigas por tipo, no
próprio lançamento diário. O motor de eventos já existe e está vazio.
