# Fluxo de apontamento de montagem (joists por quadrante, vigas por tipo)

Tela: **Produção > Apontar montagem**. Um apontamento é a fonte única da montagem: ele soma na grade de
produção da empresa (de onde o BM, o cronograma e os dashboards já leem) e define os fixadores baixados no estoque.
Ninguém digita a mesma coisa duas vezes.

```
Apontamento (data, empresa, onde)
   |-- soma em IÇAMENTO JOIST / VIGAS (controle da empresa, no dia) --> Painel, Programação semanal, Dashboard cliente
   |                                                                --> Medição (BM) "Instalação de joist" e "Instalação de vigas"
   |-- aba APONTAMENTO MONTAGEM (1 linha por viga / por apoio do quadrante)
   |-- tipo de viga/apoio --> kit de fixadores --> Estoque (Inventário, Controle de Materiais, Sistema)
```

## Mapa selecionável (modo padrão)

A tela abre num mapa em planta, como o desenho do cronograma: eixos na horizontal (11 a 20 por padrão, com a opção
"Todos os eixos"), estações de viga na vertical (A, B, BC, C ... H) e as faixas (AB a GH) coloridas por empresa.

- **Quadrados** sobre os eixos são as vigas (maior = apoio/VC01, menor = intermediária). Clique para marcar; clicar
  no número do eixo marca todas as vigas pendentes dele.
- **Barras** são as joists de cada quadrante (rua entre dois eixos x faixa), agrupadas junto da viga que as apoia;
  a posição da barra define o tipo de parafuso. Clicar na 2ª barra pendente de um grupo seleciona duas; clicar de
  novo na última selecionada desfaz.
- Amarelo = já montada, azul = selecionada para este salvamento, cinza/branco = pendente. Peça já montada não
  seleciona: para corrigir, exclua no histórico.
- **Um único Salvar** grava tudo que foi selecionado (vários quadrantes, vigas, EJ e CMM). A empresa vem da malha;
  só a cumeeira (faixa DE e viga DE) pede a empresa. A barra "Seleção / Salvar" fica fixa no topo durante a rolagem.
- Pré-montagem segue por escrita no Lançamentos; "Digitar joists" e "Digitar vigas" continuam disponíveis para
  regularizar histórico em lote.

## O que se aponta

- **Joists por quadrante:** rua (par de eixos consecutivos, `11-12`) x faixa (AB a GH) e, para cada viga de apoio da
  faixa, quantas joists foram fixadas nela. O parafuso vem da viga (B=FG006, BC=FG005, C=FG007...): 8 por joist,
  mais 8 porcas (FG015) e 8 arruelas (FG018).
- **Vigas por tipo:** eixo (01 a 20) e as letras montadas (A a H). Tipo e kit vêm da letra:
  VC01 (A, H): FG022/FG024 x2 + FG012/FG017/FG020 x4; apoio: FG021/FG023 x4; intermediária (BC, CD, DE, EF, FG):
  FG012/FG017/FG020 x4.
- Posições de cada faixa: AB = A,B; BC = B,BC,C; CD = C,CD,D; DE = D,DE,E; EF = E,EF,F; FG = F,FG,G; GH = G,H.

## Regras e proteções

- Viga já apontada não entra de novo (evita contar duas vezes a mesma viga).
- Rua x faixa acima de 6 joists (limite do projeto/IFC) grava com aviso; empresa diferente da malha do projeto
  (AB-CD = EJ, EF-GH = CMM, DE = cumeeira, a empresa é escolhida) grava com aviso.
- Empresa sem a coluna do serviço, data fora do calendário e rua/faixa/letra inválidas são recusadas. O salvamento
  é atômico: se uma peça do lote é inválida (ex.: viga repetida), nada é gravado.
- **Regularização:** marque quando a produção já está no Lançamentos (histórico). Grava só o local/tipo, sem somar
  de novo na grade.
- Excluir um apontamento devolve a quantidade à grade (se ele tinha somado).
- Data dentro de BM já fechado: a tela avisa que a produção entra como ajuste no BM em aberto (mesma regra do
  Lançamentos).

## Como cada área fica contabilizada

| Área | Como recebe |
|---|---|
| Planejamento | A meta da semana (IÇAMENTO JOIST, VIGAS) é comparada com a grade; a tela mostra "semana 0 -> 6 de 25". Quadrantes liberados = vigas apontadas nos dois eixos das posições da faixa |
| Financeiro (BM) | O realizado das atividades ligadas a IÇAMENTO JOIST e VIGAS vem da grade, por empresa e por período da data do apontamento; a tela mostra o acumulado antes e depois |
| Estoque | Consumo virtual = apontamento (tipo exato) + joists ainda sem quadrante pela divisão média (marcado "≈"). Fixadores de viga só contam as vigas apontadas (marcado "≥") até completar |

Conferência: os ladrilhos da tela comparam produção x apontado. "A apontar" é o que falta classificar;
"apontadas acima da produção" indica apontamento sem produção correspondente (ex.: célula do Lançamentos reduzida).

## Decisões assumidas (ajustáveis em `regras_baixa.json`)

- Viga intermediária = 4 parafusos/porcas/arruelas Ø7/8" (valor dos eventos e do Consumo_Quadrantes), não 8.
- O parafuso baixa quando a joist é apontada no quadrante (fixação), não no içamento genérico.
- Letra EF (VC03, FG005) adicionada: faltava no critério por letra.

## Limitações

- O desenho é esquemático: a posição exata de cada joist no quadrante não é registrada, só a viga de apoio
  (3 barras por viga são desenhadas; se houver mais apontadas, aparecem barras extras). A orientação assume a
  letra A no topo.
- O sistema PHP (online) não tem esta tela nem as rotas de estoque: o menu fica oculto nele.
- O apontamento não altera o histórico do Lançamentos. Para classificar o que já foi produzido, aponte com
  "Regularização" marcada.
- A baixa automática antiga por movimentação (ESTOQUE MOVIMENTOS) continua ligada aos lançamentos manuais; o
  Inventário e o Controle de Materiais usam o apontamento.
