# Baixa automática de materiais: IFC x planilha de estoque

Fontes: `teste claude.xlsm` (estoque), IFC do galpão `LSF-MET-EX-200-200-BIM-R0D`
(08/07/2026) e o modelo `OF.198 - LYON G200.ifc.trb` (estrutura principal).

## 1. O que o IFC entrega (confirmado)

- **Parafusos e soldas não vêm no IFC de texto:** as opções de exportação são `Bolts:Off` e
  `Welds:Off`, e `IfcMechanicalFastener = 0`. Só existem porcas e arruelas modeladas em parte
  (Ø1/2": 896 porcas e 817 arruelas; Ø1": 1.302 e 870; Ø3/4": 496 e 248).
- **Cada peça tem código de posição** (`Assembly/Cast unit position code`), por exemplo
  `05/B1-B` (eixo 05, trecho B1-B) ou `05-05a/C-B2` (rua entre 05 e 05a). Todos os 33.404
  conjuntos têm código. Agrupando os trechos de letras em faixas (AB a GH), cada peça cai num
  quadrante (rua x faixa) ou numa viga (eixo x faixa).
- **As joists em si não aparecem** (só `SUPORTE JOIST`, `DESLIZAMENTO JOIST`), e as vigas
  senoidais VC01 a VC07 também não: `VIGA COBERTURA` são peças de ligação (chapas e W310).
- **Suportes de joist formam uma malha regular:** 24 suportes por faixa, por lado, em cada
  eixo (48 por faixa nos eixos 02 a 19; 24 nos eixos 01 e 20), total 6.384.
  Resumo em `dados/ifc_r0d_posicoes.json` (script `ferramentas/ifc_posicoes.py`).
- **Leitura da malha:** cada suporte recebe um parafuso Ø1/2" e cada ponta de joist usa 4
  (regra da planilha: 4 + 4 = 8 por joist). Logo, 24 / 4 = **6 joists por faixa**,
  **42 por rua**, **798 no galpão** (19 ruas x 42).

## 2. O modelo TRB (estrutura principal)

Arquivo binário do Trimble Connect (`TRB8`, gerado de `pegasus_input.ifc`). Não tem esquema
público e não pôde ser lido com segurança. Pela tabela de textos, ele traz o que falta:
30 tipos de parafuso (A307 e A325), vigas `VC01` a `VC22`, apoios principais e intermediários,
pilaretes e os mesmos códigos de posição. Para usar, é preciso o IFC de texto original.

## 3. Desencontros encontrados na planilha de estoque

| # | Onde | Problema | Correção proposta |
|---|---|---|---|
| 1 | Consumo_Quadrantes!E10 | O consumo da coluna FG005 (Apontamento_Quadrantes!AA) é lançado no código **FG019**. FG019 não tem estoque, então aparece "CRÍTICO - FALTA -579", e o FG005 real nunca baixa | Trocar o código da linha para FG005 (Ø1/2" x 1 3/4") ou renomear a coluna AA |
| 2 | Joists por faixa | IFC: 6 por faixa (42 por rua, 798). Planilha: cada posição de viga aceita até 3, com 2 posições em AB/GH e 3 nas demais (6 a 9 por faixa). Plano: 817. São três números diferentes | Adotar 6 por faixa como capacidade e conferir a diferença de 19 (1 por rua) até 817 |
| 3 | Ruas cobertas | Planilha: ruas 10/11 a 18/19 (9 ruas, eixos 10 a 19). IFC: 19 ruas (01/02 a 19/20), eixos 01 a 20. Cronograma: Fase 1 = eixos 11 a 20. A rua 19/20 e o eixo 20 não existem na planilha | Cobrir as 19 ruas, com fase 1 e fase 2 |
| 4 | Vigas por eixo | Planilha: 13 vigas por eixo com VC01 a VC07. Modelo TRB: marcas VC01 a VC22 | Confirmar tipos de viga com o IFC da estrutura principal |
| 5 | Macro BaixarJoist | Usa a aba `Apontamento_IFC`, que não existe no arquivo, e códigos fixos (FJ001, FJ002, SPD01). A PONTE lista "ativar VBA" como pendente | Substituir por baixa por regra (ver seção 4) |
| 6 | Controle_Materiais (BZ001) | No cache salvo: necessário real 798 (igual às joists do IFC), planejado 1.462 e "falta enviar" -798 (deveria ser 798 - 664 = 134) | Revisar a fórmula de falta enviar e a base do planejado |
| 7 | Mapeamento de parafuso por faixa | As colunas AA, AB e AC decidem o tipo de parafuso com regras fixas por faixa e posição, o que gera "REVISAR MAPEAMENTO" | Trocar por consulta ao tipo de viga de cada posição (IFC) |

O que está consistente: a baixa estrutural (4 porcas e 4 arruelas por viga montada): 204 nas
vigas de apoio (51 montadas) e 136 nas intermediárias (34 montadas).

## 4. Fluxo integrado proposto

```
IFC (posição de cada peça)          Regras de baixa (tabela única)
  suportes = parafusos Ø1/2"          evento -> material -> quantidade
  tipo da viga (VC) por posição       viga montada, joist içada por quadrante
        \                              /
         v                            v
   Base de projeto por rua/faixa/eixo  ---->  Eventos de produção
   (quanto o projeto exige)                   viga montada (ID físico)
                                              joist içada por rua e faixa
                                                     |
                                                     v
                                        Baixa automática = eventos x regras
                                        consumo teórico por material e por quadrante
                                                     |
             remessas (chegou na obra) -------------+
                                                     v
                                        Estoque teórico = chegou - consumo
                                        + inventário físico -> perda e acuracidade
                                                     |
                                                     v
                                        Necessidade e planejamento
                                        (meta da semana x regra = o que precisa chegar)
```

Regras de consistência:
1. **Uma única tabela de regras** (evento, material, quantidade, origem). Nenhum código
   de fixador digitado em fórmulas.
2. **Conferência por quadrante:** joists apontadas na rua e faixa não podem passar de 6 (IFC), e o
   total apontado nos quadrantes deve fechar com o "içamento de joist" da produção diária.
3. **Consumo por projeto:** o consumo acumulado de cada material por rua não pode ultrapassar o
   que o IFC prevê. Se passar, alerta de perda ou de apontamento errado.
4. **Porca e arruela** acompanham o parafuso na proporção 1:1 (o IFC não as modela por inteiro).

## 5. Pendências

- IFC de texto da estrutura principal (com parafusos), para fixar o tipo de parafuso por viga.
- Decidir se as correções da seção 3 são feitas direto na planilha `teste claude` ou só no sistema.

## 6. Implementação (setembro/2026)

- `ferramentas/ifc_inventario.py` → gera `dados/ifc_r0d_inventario.json` (inventário completo,
  ainda por rua/faixa/eixo, incluindo 6.384 suportes, 300 apoios de viga, 1.680 travamentos,
  1.680 clipes-aranha, 448 contraventamentos, 864 suportes de terça, 1.800 telhas cobertura).
- `programa_obra198/regras_baixa.json` → tabela única evento→material→quantidade
  (VIGA_APOIO_MONTADA, VIGA_INTERM_MONTADA, JOIST_ICADA), com o critério por letra
  (VC/parafuso) e o limite de 6 joists por rua/faixa.
- Novas tabelas do sistema (Python + PHP): `ESTOQUE EVENTOS`, `ESTOQUE REMESSAS`,
  `ESTOQUE INVENTÁRIO`.
- Aba **Estoque > Baixa automática por IFC** mostra: consumo teórico × chegou × físico,
  saldo teórico, perda, acurácia, cobertura em dias e joists por rua/faixa (apontado/projetado).
- Alertas dispostos automaticamente quando: joists/faixa > 6, saldo teórico negativo,
  perda > 0.
