# Fluxo do Boletim de Medição (BM) — Obra 198 / G200

## Estrutura dos arquivos Excel

Cada subcontratada (EJ Montagens, CMM, GLOBO AÇOS) possui dois contratos paralelos:

| Contrato | Fatura para | Arquivo BM |
|---|---|---|
| QPC | Dono da obra (QPC) | Aba `BM - <EMPRESA> - QPC` |
| RÓTULA | Contratante principal | Aba `BM1 - <EMPRESA> - ROTULA` |

As mesmas quantidades físicas aparecem em ambos os contratos, com **preços unitários diferentes**.

---

## Layout de colunas — EJ Montagens / CMM

```
col[0] = ÍTEM
col[1] = DESCRIÇÃO
col[2] = QUANTIDADE contratada
col[3] = UNIDADE
col[4] = VALOR UNITÁRIO
col[5] = VALOR (contrato)    → F = E × C
col[6] = QTD medida (texto)  → G = ARRED(% × C, 2) & " " & D
col[7] = PERC BM1            → H = I / F   (ou 0 hardcoded)
col[8] = VALOR BM1           → I = referência cruzada ou F × H
col[9] = PERC BM2            → J = 'BM2-MC MONTAGEM'!O10 − H15
col[10]= VALOR BM2           → K = F × J
```

BMs seguintes (BM3, BM4 …) seguem o mesmo padrão deslocando 2 colunas por período.

## Layout de colunas — GLOBO AÇOS

```
col[0] = ÍTEM
col[1] = DESCRIÇÃO
col[2] = QUANTIDADE contratada
col[3] = PESO (kg)
col[4] = UNIDADE
col[5] = VALOR UNITÁRIO
col[6] = VALOR (contrato)    → G = ROUND(F × C, 2)
col[7] = QTD medida BM1      → H = ARRED(J × C, 2) & " " & E
col[8] = PESO medido BM1     → I = IF(ISTEXT(D), D, J × D)
col[9] = PERC BM1            → J  ← célula de entrada do %
col[10]= VALOR BM1           → K = G × J
```

---

## Cadeia de cálculo — do lançamento ao %

### EJ / CMM (a partir do BM2)

```
1. Aba de produção (ex: "BM2-MC MONTAGEM")
   └─ célula O10 = % acumulado físico até BM2

2. J15 (% período BM2) = O10  −  H15
                          ↑         ↑
                  acum. atual   acum. BM1 anterior

3. K15 (R$ período BM2) = F15 × J15
                           ↑
                    valor do contrato do item

4. K11 (total BM2) = SUM(K14 + K19)

5. J11 (% BM2 s/ contrato) = K11 / F11
```

### GLOBO AÇOS (BM1)

```
1. J15 = % lançado (entrada manual ou ref. aba produção)

2. K15 = G15 × J15   (R$ medido = contrato × %)

3. H15 = ARRED(J15 × C15, 2) & " " & E15   (QTD medida)

4. K11 = SUM(K14 + K16 + K24)

5. J11 = K11 / G11
```

### QPC — referência cruzada para RÓTULA

A aba QPC não lança medição diretamente. O valor medido (coluna I) é importado da aba RÓTULA:

```excel
I15 = 'BM1 - EJ MONTAGENS - ROTULA'!AL42
```

`AL42` (ou `AL46` em versões anteriores) = **VALOR A FATURAR** na aba RÓTULA, já com deduções:

```
VALOR A FATURAR = valor bruto medido
                − adiantamento pago pela RÓTULA
                − refeições fornecidas no canteiro
                − outros descontos
```

---

## Valores contratados — referência BM1

| Empresa | Contrato | Total Contratado | BM1 Medido | % |
|---|---|---|---|---|
| EJ Montagens | QPC | R$ 1.482.572 | R$ 97.864 | 6,6% |
| EJ Montagens | RÓTULA | R$ 1.732.858 | R$ 295.711 | 17,1% |
| EJ Montagens | RÓTULA BM2 | — | R$ 147.900 | +8,5% |
| CMM | QPC | R$ 914.861 | R$ 93.538 | 10,2% |
| CMM | RÓTULA | R$ 1.405.401 | R$ 151.516 | 10,8% |
| GLOBO AÇOS | QPC | R$ 2.379.736 | R$ 0 | 0% |
| GLOBO AÇOS | RÓTULA | R$ 2.921.032 | R$ 0 | 0% |

> GLOBO: BM1 agendada para 10/10/2026.
> EJ: BM2 da RÓTULA já lançado (acumulado = 25,6%).

---

## Divisão da cobertura principal entre EJ e CMM

A cobertura principal é repartida **ao meio** entre as duas empresas de estrutura:

```
Cobertura total (telhas, GLOBO) = 75.835,93 m²
EJ  (item 3.1.1 montagem)       = 37.917,965 m²  (50%)
CMM (item 3.1.1 montagem)       = 37.917,965 m²  (50%)
```

Ao cruzar com o IFC, o modelo do galpão deve ser dividido em duas metades
(eixos de divisão a confirmar). O percentual de cada empresa é sempre sobre
a sua metade, não sobre a cobertura inteira.

---

## Serviços por status

| Item | Escopo | Empresas | Status |
|---|---|---|---|
| 3.1.1 Estrutura Cobertura | Montagem · 37.918 m² | EJ / CMM | Medindo (BM1–BM2) |
| 3.1.2 Estrutura Fechamento | Montagem · 6.041 m² | EJ / CMM | 0% |
| 3.1.3 Estrutura Marquises | Montagem · 4.473 m² | EJ / CMM | 0% |
| 3.1.4 Estrutura HVAC | Montagem · 856 m | EJ / CMM | 0% |
| 3.2.1 Telha Zipada Cobertura | 75.836 m² | GLOBO | Aguarda BM1 |
| 3.2.2 Telha Fechamento Lateral | 12.083 m² | GLOBO | Aguarda BM1 |
| 3.2.5–3.2.8 Marquises / Calhas | variado | GLOBO | Aguarda BM1 |
| 3.3 / 3.4 Anexos (eclusa, portaria, refeitório…) | variado | todos | 0% |

---

## Leitura programática (Python / openpyxl)

```python
import openpyxl

wb = openpyxl.load_workbook("BM_EJ.xlsx", data_only=True)
ws = wb["BM1 - EJ MONTAGENS - ROTULA"]

# Linha 11 = TOTAL DO CONTRATO
total_contrato = ws.cell(11, 6).value   # col F
perc_bm1       = ws.cell(11, 8).value   # col H  (ex: 0.1706)
valor_bm1      = ws.cell(11, 9).value   # col I
perc_bm2       = ws.cell(11, 10).value  # col J
valor_bm2      = ws.cell(11, 11).value  # col K
```

> `data_only=True` é obrigatório para ler resultados de fórmulas.
> Sem ele, as células retornam a string da fórmula, não o valor calculado.
