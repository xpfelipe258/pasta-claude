# Importação automática de obra nova (projeto)

Objetivo: no ato de "Nova obra", o usuário envia os documentos do projeto e o sistema monta a obra sozinho
(lista de material, fluxo de baixa conforme o IFC, BM e mapa de apontamento), no mesmo nível da obra 198.

## Decisões do usuário (2026-10-22)
- O sistema será usado por **outras empresas executoras e pela gerenciadora** (Felipe) → precisa de isolamento entre empresas (organizações). **Ainda não implementado** (ver pendências).
- A maioria das obras será do **mesmo tipo** (galpão LSF de aço: joists, vigas, marquise, anexos); o modelo vem do **Tekla**, mas o IFC pode **variar por obra**.
- Dos PDFs de projeto extrair **informações de visualização, quantidade de telhas e lista de material por serviço (vão, unidade, m²…)**.
- A leitura roda em **serviço Python separado** (`servico_leitura/`).
- A **obra 198 serve de teste de aceite**: reimportar os documentos dela como obra nova e comparar com o que existe.

## Documentos obrigatórios (todos; sem os 5 válidos a obra não segue)
| # | Documento | Formatos | Gera |
|---|---|---|---|
| 1 | Modelos IFC (Tekla), um por edificação | .ifc, .zip | lista de material por local/família, inventário, mapa de apontamento, fluxo de baixa |
| 2 | Lista de parafusos e fixadores | .trb, .xlsx, .csv | fixadores por local, kit parafuso/porca/arruela por peça, baixa de fixador |
| 3 | Cronograma do cliente | .xml (MS Project), .xlsx, .pdf | Gantt/previsto, fases e frentes, ligação atividade × frente |
| 4 | Orçamento / planilha de medição por empresa | .xlsx | catálogo de atividades do BM, valores, pesos, contratos |
| 5 | Projetos em PDF (com texto) | .pdf | biblioteca de projetos, quantidades de telha/fechamento (vão, unidade, m²), lista de material por serviço |

## Fluxo em "Nova obra"
1. Dados da obra → cria a obra em **rascunho** (não abre, não aparece como ativa).
2. `obra_importar.php`: envio em partes (4 MB) dos 5 documentos, validação básica no PHP e validação profunda pelo serviço Python; selo por documento.
3. "Enviar para leitura" (só com os 5 completos) → obra `aguardando_leitura` → o PHP chama `POST /jobs/processar` e a obra fica `lendo`.
4. **(Fase 2, feita)** O serviço lê todos os documentos e devolve o **pacote** (`dados_obras/{obra}/pacote.json`); a obra passa para `revisao` e `obra_revisao.php` mostra o que foi lido (fases × itens do BM, lista de material, fixadores, BM, cronograma, telhas, pranchas). O administrador informa a **sigla da empresa executora**, corrige a ligação fase × item e **publica**: `importacao_publicar()` (`inc/importacao_leitura.php`) cria tudo na obra e ela passa a `ativa`.
- Transição: botão "Publicar sem leitura automática" mantém o uso manual até a fase 2 estar validada.

### O que a publicação cria (a partir do pacote)
| Pacote | Vira |
|---|---|
| `modelo.material` (IFC: fase × produto × perfil) | cadastro de **Materiais** (uma TAG por linha, planejado = quantidade do IFC; telhas com m² na observação) e `ifc_anexos` (base de Suprimentos › Vínculos) |
| `modelo.fixadores` + lista de fixadores (xlsx) | TAGs `FG###` (lista em planilha vale; o que só existe no IFC entra com a quantidade do modelo) e `ifc_parafusos` (parafusos por fase) |
| `bm.itens/atividades` (memorial do BM) | catálogo do BM (`bm_atividades`, código `SIGLA-item-nn`, peso normalizado, valor do item) e `bm_periodos` |
| `cronograma.atividades` | empresa executora + serviços (colunas de Lançamentos) e previsto do cliente (`cliente`) |
| fase do IFC ↔ item do BM (pelo número, ex.: 3.1.5) | vínculos peça × atividade (`vinculos_material`, confirmados "Importação automática") e baixa por serviço (`regras_baixa.consumo_por_servico` = quantidade do grupo ÷ quantidade da atividade) |
| `modelo.conjuntos[].pos` (código de posição Tekla `V23/H10-H9`) | mapa de apontamento por peça (`frentes_montagem_obra`; tela `mapa_obra.js`, rota `apontamento-pecas`) |
| `projetos.pranchas` | índice de pranchas (fica no pacote) |

> **Atualização (2026-10-23):** a leitura roda **dentro do sistema** (PHP) e o botão "Gerar obra" já cria a obra; o serviço Python virou opcional e a tela de revisão virou relatório pós-geração.

## Fases
- **Fase 1 (feita, local, ainda não publicada):** tabela `obra_documentos`, assistente, envio em partes, validação básica e profunda, serviço Python com validadores (IFC, fixadores, cronograma, orçamento, projetos), dados de projeto **por obra** (`dado_json_da_obra`: regras de baixa, parafusos e anexos não vazam mais para obra nova).
- **Fase 2 (feita, local, ainda não publicada):** `servico_leitura/leitores/` (`ifc_modelo`, `orcamento`, `cronograma`, `fixadores`, `projetos`, `processar`), `/jobs/processar`, `obra_revisao.php`, `inc/importacao_leitura.php`, mapa por peça (`mapa_obra.js`). Testada com os documentos reais da CPDA (11 IFC, 5.995 conjuntos, 803 t).
- **Fase 3:** refinar leituras (várias empresas no mesmo BM, telhas por edificação, listas de material das pranchas por serviço, parafusos do `.trb`).
- **Fase 4:** fluxo de baixa e fixadores com regras sugeridas + confirmação; biblioteca de regras reaproveitável.
- **Fase 5:** teste de aceite com a obra 198 e relatório de validação.
- **Paralelo:** organizações (multi-empresa).

## Pendências / perguntas em aberto
- Isolamento entre empresas executoras (organização): quem enxerga o quê, quem cria obra.
- Parafusos: relatório Tekla (.xlsx/.csv) é preferido ao .trb.
- Layout do orçamento: assistente de colunas na primeira leitura + modelo salvo por empresa?
- Regras de consumo (peça → atividade → kit): biblioteca aprovada uma vez e herdada?
- BM com contrato duplo (QPC e RÓTULA) sempre ou configurável por obra?
- Hospedagem do serviço Python (VPS) e limites de upload da Hostinger.
