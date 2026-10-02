# Escopo de produção a partir do escopo de medição

Rascunho para validação. Nada aplicado no sistema ainda.
A área de medição (BM) está correta e é a fonte da verdade — não se mexe nela.

## Situação atual

| | |
|---|---|
| Colunas de produção | 52 |
| Com escopo preenchido | 9 |
| Sem escopo (sem % , sem meta, sem curva) | 43 |
| Atividades no catálogo BM | 168, em 32 itens, cobrindo a obra toda |
| Campo `controle` (ponte BM → produção) | preenchido em 6 das 168 |

## Correções de escopo confirmadas

| Empresa | Coluna | Escopo hoje | Escopo correto | Unidade |
|---|---|---|---|---|
| EJ | PREMONTAGEM | 198 | **408** | joist |
| EJ | IÇAMENTO JOIST | 198 | **408** | joist |
| EJ | VIGAS | 61 | **138** | un |
| CMM | PREMONTAGEM | 198 | **408** | joist |
| CMM | IÇAMENTO JOIST | 198 | **408** | joist |
| CMM | VIGAS | 60 | **138** | un |
| GLOBO | PERFILAÇÃO | 446 | 446 (já correto) | telha |
| GLOBO | TELHAR | 446 | 446 (já correto) | telha |
| GLOBO | FECHAMENTO | 806 | 806 (já correto) | telha |

Os valores da GLOBO não eram Fase 1: já são o galpão inteiro, expressos em
peças em vez de m². Conversão conferida:

- cobertura: 446 telhas × 170,04 m² = 75.835,92 m² (BM: 75.835,93)
- fechamento: 806 telhas × 14,99 m² = 12.082,65 m² (BM: 12.082,65)

Geometricamente: galpão de ~446 m × 170 m, telha zipada de 1 m de largura
correndo os 170 m do vão.

## A chave: ligar por ATIVIDADE, não por item

O BM já separa por prédio dentro das atividades. Exemplos:

```
3.4.1  Instalação de telhas Eclusa        1.163,25 m²
       Instalação de telhas Portaria        517,44 m²
       Instalação de telhas Passarelas      344,87 m²
       Instalação de telhas Vestiário     1.241,67 m²
       Instalação de telhas QDF CAD          78,88 m²

3.4.10 Instalação das calhas - Eclusa        71,88 m
       Instalação das calhas - Portaria     117,74 m
       Instalação das calhas - Refeitório   319,70 m
       ...
```

Então a coluna de produção "ECLUSA – TELHAS COBERTURA" não puxa do item
3.4.1 inteiro: puxa da atividade "Instalação de telhas Eclusa". O campo
`controle` deve apontar para a atividade, e aí 42 das 43 colunas órfãs
encontram origem.

## Itens do BM sem coluna de produção

Dez itens medidos que a produção não acompanha:

| Empresa | Item | Descrição | Valor RÓTULA |
|---|---|---|---|
| EJ | 3.1.4 | Estrutura auxiliar para dutos HVAC | 23.203,02 |
| EJ | 3.3.5 | Escada marinheiro H=5,10 m (portaria) | 3.400,00 |
| EJ | 3.3.6 | Escada marinheiro H=1,00 m (portaria) | 2.700,00 |
| EJ | 3.3.9 | Marquise dos vestiários + refeitório | 14.366,25 |
| EJ | 3.3.10 | Testeira da marquise vestiários + refeitório | 3.231,68 |
| EJ | 3.3.17 | Cobertura do QDF CAG | 2.137,65 |
| GLOBO | 3.1.5 | Testeira frontal da marquise do galpão | 16.157,40 |
| GLOBO | 3.2.3 / 3.2.4 | Aberturas na telha de fechamento (dutos AC) | 68.920,00 |
| GLOBO | 3.2.6 | Linha de vida do galpão | 63.837,41 |
| GLOBO | 3.4.8 | Linha de vida dos anexos | 30.876,83 |

Somam R$ 228.830,24 medidos sem acompanhamento de produção.

## Colunas de produção sem item no BM

- EJ R — COB. PEDESTRES – TESTEIRA
- EJ U — COB. PRAÇA VIVÊNCIA – TESTEIRA
- EJ M — PORTARIA – PLATIBANDA H=1,90 m (o BM tem 3.3.4, testeira ACM H=0,60 m)

## O que falta decidir

1. **Unidade das colunas dos anexos.** O BM mede os anexos em m² e m. A
   produção da GLOBO conta telhas. Para cada prédio é preciso o fator
   m²/telha, como já se tem para galpão (170,04) e fechamento (14,99).
2. **Os 10 itens órfãos** viram colunas novas de produção ou ficam só na
   medição?
3. **As 3 colunas sem item** são escopo real não contratado, ou nome
   divergente do mesmo serviço?

A base de dados de projetos deve responder (1) e (3).
