# Quantitativo do IFC comparado ao BM

Extração feita com `ferramentas/ifc_quantitativo_bm.py` sobre os modelos
dos anexos. Nada aplicado no sistema.

## O achado estrutural: o IFC já carrega o código do BM

Cada elemento do modelo tem a propriedade `PHASE.NAME` com o código do item,
no formato `1.x.y DESCRIÇÃO`. Esse código é o item do BM com o "1" inicial
trocado por "3":

| PHASE.NAME no modelo | Item no BM |
|---|---|
| `1.3.1 E.M. COB. ECLUSA` | 3.3.1 Estrutura metálica cobertura da eclusa |
| `1.3.7 E.M COB. REFEITÓRIO` | 3.3.7 Estrutura metálica cobertura do refeitório |
| `1.3.8 E.M. COB VESTIÁRIO` | 3.3.8 Estrutura metálica cobertura do vestiário |
| `1.4.1 TELHA COB. PORTARIA` | 3.4.1 Cobertura dos Anexos |
| `1.4.2 TELHA COB. REFEITÓRIO` | 3.4.2 Cobertura do Refeitório |
| `1.4.10 CALHAS REFEITÓRIO` | 3.4.10 Calhas metálicas para os Anexos |

Isso significa que o escopo de produção pode ser derivado do modelo por item
de medição, automaticamente, sem tabela de-para escrita à mão.

## O que reconcilia

| Verificação | IFC | BM | |
|---|---|---|---|
| Terças do refeitório | 72 | 72 | confere |
| Terças do vestiário | 84 | 84 | confere |
| Calhas da eclusa | 72,0 m | 71,88 m | confere |
| Joists do galpão (desenhos de fabricação) | 817 | 408,5 × 2 | confere |

## O que não reconcilia

| Verificação | IFC | BM | observação |
|---|---|---|---|
| Vigas do refeitório | 16 | 20 | modelo tem 4 a menos |
| Vigas do vestiário | 20 | 22 | modelo tem 2 a menos |
| Vigas da portaria | 35 | 26 | modelo tem 9 a mais |
| Terças da portaria | 39 | 34 | modelo tem 5 a mais |
| Calhas do refeitório | 96,0 m | 319,70 m | modelo tem 1/3 |
| Calhas do vestiário | não modelado | 282,54 m | ausente no modelo |
| Joists do galpão | 798 (42/rua) | 817 (43/rua) | modelo tem 1 a menos por rua |

## Limitações dos modelos recebidos

1. **O modelo 220 ("PORTARIA") contém também a ECLUSA.** Tem os grupos
   `1.3.1 E.M. COB. ECLUSA`, `1.3.2 E.M. PLATIBANDA ECLUSA` e `CALHA ECLUSA`.
   Atribuir o modelo inteiro à portaria superestima o prédio.
2. **O modelo 230 ("VESTIÁRIO") não tem calhas modeladas** — só 5 bocais.
   O BM contrata 282,54 m de calha para o vestiário.
3. **`JOIST_ECLUSA` não tem `PHASE.NAME`**, então fica fora do agrupamento
   por item (1.872 peças).
4. **Não há fator m²/telha consistente.** O refeitório sugere 0,68 m de
   largura útil (1.404,97 m² ÷ 2.061,6 m de telha); portaria e vestiário dão
   valores diferentes. Sem a largura útil declarada não dá para converter
   peças em m² com segurança.

## Conclusão para o escopo de produção

Os itens de **estrutura metálica (EJ)** podem sair do IFC com confiança nas
terças, e com conferência manual nas vigas.

Os itens de **cobertura e calhas (GLOBO)** ainda não: o modelo diverge do
contrato em quantidade e, no caso do vestiário, nem contém o elemento.

Para fechar falta: a largura útil da telha por prédio, e a confirmação de
qual lado está certo nas vigas e nas calhas — projeto ou contrato.
