# Cronograma do cliente — F.PLA.005 Rótula LSF G200 (19/08/2026)

Fonte: PDF `02 - F.PLA.005 - Cronograma Rótula - LSF G200 - 19_08_26`.
Dados estruturados (130 tarefas: id, nome, dias úteis, início, fim, avanço
planejado em 29/09/2026): `dados/cronograma_rotula_19-08-26.json`.
Nomes muito longos vêm cortados no PDF original.

## Estrutura

- Obra: 31/03/2026 a 30/04/2027 (268 dias).
- **Fase 1, eixos 11 ao 20:** 31/03 a 30/12/2026.
- **Fase 2, eixos 1 ao 11:** 19/05/2026 a 30/04/2027.
- Cada fase tem fabricação (joist, vigas principais, marquise), cobertura
  (pré-montagem e montagem de joist, vigas principais, telhas, calhas, arremates),
  fechamento lateral (estrutura e telha PIR) e marquise.
- Prédios anexos (fase 1): eclusa, portaria, refeitório, vestiário e
  passarelas / área de vivência (até 07/01/2027).

## Cruzamento de divisões

As fases dividem o galpão pelos **eixos numéricos** (11), enquanto EJ e CMM
dividem pelos **eixos de letras** (cumeeira entre D e E). Cada empresa atua
portanto nas duas fases: o galpão tem 4 quadrantes (fase x empresa).
As telhas são contrato único da GLOBO, de A a H.

## Avanço planejado da cobertura em 29/09/2026 (linear, dias úteis)

| Atividade | Fase 1 | Fase 2 |
|---|---|---|
| Montagem de vigas principais | 61,6% | 0,8% |
| Montagem de joist | 54,2% | — |
| Pré-montagem de joist | 57,8% | 6,2% |
| Montagem de telhas | 24,1% | — |
| Calhas da cobertura | 15,5% | — |
| Fechamento lateral (estrutura) | 13,8% | — |

## Aba Cronograma (Gantt) — Produção

Produção > Cronograma (Gantt) mostra, por serviço e agrupado por frente, o previsto x realizado:

- **Previsto (barra cinza):** início planejado até o término pela meta do cliente (meta/dia x dias úteis), com o
  preenchimento até a data de referência e o prazo contratual marcado por um losango.
- **Realizado (barra colorida):** do primeiro dia com produção até a data de referência (ou até concluir), preenchida
  pelo % do contrato produzido. Verde = no ritmo/adiantado, amarelo = no limite (até 5% abaixo), vermelho = atrasado,
  azul = concluído.
- **Projeção (tracejado):** término no ritmo das últimas duas semanas (limitada ao prazo final + 4 meses na escala).
- Linha vermelha = data de referência. "Mostrar por empresa" abre uma linha por empresa (EJ, CMM, GLOBO) com o período
  e a quantidade produzida. Filtro por frente e três níveis de zoom; a barra de rolagem fica no topo.

A base é a tabela METAS CLIENTE (a mesma do Dashboard cliente); o PDF do cronograma completo (130 tarefas) continua em
`dados/cronograma_rotula_19-08-26.json`.
