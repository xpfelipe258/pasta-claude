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
3. "Enviar para leitura" (só com os 5 completos) → obra `aguardando_leitura`.
4. (Fase 2) Leitura completa pelo serviço, revisão (divergências, sugestões) e publicação.
- Transição: botão "Publicar sem leitura automática" mantém o uso manual até a fase 2 estar validada.

## Fases
- **Fase 1 (feita, local, ainda não publicada):** tabela `obra_documentos`, assistente, envio em partes, validação básica e profunda, serviço Python com validadores (IFC, fixadores, cronograma, orçamento, projetos), dados de projeto **por obra** (`dado_json_da_obra`: regras de baixa, parafusos e anexos não vazam mais para obra nova).
- **Fase 2:** leitura do IFC (lista de material, inventário, mapas de apontamento) generalizando `ifc_inventario.py`, `ifc_frentes_montagem.py`, `ifc_anexos.py`, `trb_parafusos.py`.
- **Fase 3:** orçamento (BM), cronograma (Gantt) e PDFs (telhas, lista por serviço).
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
