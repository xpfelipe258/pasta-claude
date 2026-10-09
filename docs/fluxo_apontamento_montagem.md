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
"Todos os eixos"), estações de viga na vertical (A, B, BC, C ... H) e as faixas AB a GH. Embaixo de cada rua, o total de joists apontadas
sobre as 43 previstas.

- **Quadrados** sobre os eixos são as vigas (maior = apoio/VC01, menor = intermediária). Clique para marcar; clicar
  no número do eixo marca todas as vigas pendentes dele.
- **Retângulos** são as joists: cada rua mostra 43 retângulos grossos, numerados de 1 a 43 de cima (A) para baixo
  (H), e cada um é marcado individualmente. A posição do retângulo define a viga de apoio e o tipo de parafuso
  (tabela `layout_joists` em `regras_baixa.json`). Clicar marca, clicar de novo desmarca, e **arrastar o mouse** pinta
  vários de uma vez. Ao passar o mouse, a linha acima do mapa mostra rua, nº da joist, faixa, viga de apoio e
  parafuso. Os botões Compacto / Normal / Grande mudam a altura dos retângulos.
- Amarelo = já montada, azul = selecionada para este salvamento, cinza/branco = pendente. Peça já montada não
  seleciona: para corrigir, exclua no histórico.
- **Empresa a cada clique:** a barra fixa do topo tem "Empresa que montou" (EJ / CMM), sem valor inicial. Cada peça
  clicada fica com a empresa escolhida naquele momento (azul EJ, laranja CMM) e pode mudar no mesmo salvamento;
  clicar numa peça já selecionada por outra empresa passa a peça para a empresa atual. A empresa não vem da malha:
  onde há montagem e frente liberada, quem montou é quem entra no BM.
- **Um único Salvar** grava tudo que foi selecionado (vários quadrantes, vigas, EJ e CMM).
- Pré-montagem segue por escrita no Lançamentos; "Digitar vigas" continua disponível para regularizar vigas em lote.

## O que se aponta

- **Joists por retângulo:** rua (par de eixos consecutivos, `11-12`) e nº da joist (1 a 43). Faixa e viga de apoio
  saem do `layout_joists`. O parafuso vem da viga (B=FG006, BC=FG005, C=FG007...): 8 por joist, mais 8 porcas (FG015)
  e 8 arruelas (FG018). A planilha guarda uma linha por joist, com o nº na coluna "Nº da joist na rua".
- **Vigas por tipo:** eixo (01 a 20) e as letras montadas (A a H). Tipo e kit vêm da letra:
  VC01 (A, H): FG022/FG024 x2 + FG012/FG017/FG020 x4; apoio: FG021/FG023 x4; intermediária (BC, CD, DE, EF, FG):
  FG012/FG017/FG020 x4.
- Posições de cada faixa: AB = A,B; BC = B,BC,C; CD = C,CD,D; DE = D,DE,E; EF = E,EF,F; FG = F,FG,G; GH = G,H.

- **Oitões (eixos 01 e 20): 21 vigas, não 13.** Os demais eixos têm as 13 letras (A a H); nos oitões o IFC traz 21 peças
  da família VIGA COBERTURA (marcas VC08 a VC16), e o apontamento passa a identificar cada uma pelo trecho entre as
  estações do projeto (`A2-A`, `B-A1`, `B1-A3` ... `H-G2`, em `vigas_oitao` e `criterio_por_letra` do `regras_baixa.json`).
  Conta fecha com o contrato do BM: 18 eixos x 13 + 2 oitões x 21 = 276 vigas. No mapa, o eixo 20 mostra os 21 quadrados
  entre as estações; em "Digitar vigas" o eixo 20 lista os 21 chips; o servidor recusa letra comum no oitão e trecho de
  oitão nos demais eixos. O quadrante da rua 19-20 (e 01-02) só libera quando as vigas do oitão da faixa (3, 3, 3, 4, 3, 3, 2
  de AB a GH) estão montadas.
- **Kit de fixadores da viga do oitão** (evento `VIGA_OITAO_MONTADA`, lido do IFC e do desenho OF.198-MET-DM-001): o IFC não traz
  parafusos, só porcas e arruelas. No oitão há 84 porcas e 84 arruelas Ø1/2" (14 emendas de 6 parafusos Ø1/2"x2"), ou 4 por viga:
  **4 parafusos FG007 + 4 porcas FG015 + 4 arruelas FG018 por viga**. Os 22 pilaretes de cada oitão (8 porcas e 4 arruelas Ø3/4"
  cada, 176 e 88 no total) foram localizados no IFC pela posição ao longo do oitão: cada pilarete pertence à viga que o cobre
  (`pilaretes` de cada trecho). **Ao apontar a viga baixam também FG022 x8 e FG024 x4 por pilarete que ela cobre.** A H-G2 e a A2-A
  cobrem 2 pilaretes cada, a D2-D1 (central) nenhum, as outras 18 um. Conferência: 21 vigas apontadas baixam 176 porcas e 88
  arruelas Ø3/4" e 84 parafusos, porcas e arruelas Ø1/2", igual ao IFC. Chumbadores dos pilaretes não entram.
- **Apontamento baixa o estoque (sistema online):** ao montar o modelo, o servidor converte cada joist apontada em um evento
  `JOIST_ICADA` e cada viga no evento do tipo da letra (`eventos_de_apontamentos` em `modelo.php`, a mesma regra do programa
  local), somados aos eventos lançados à mão em `estoque_eventos`. Não há linha duplicada para apagar: excluir o apontamento
  devolve a baixa. O consumo virtual (Materiais, Inventário, Baixa automática) já subtrai as joists apontadas do consumo
  genérico por produção e soma o kit exato do apontamento. Não lance à mão em `estoque_eventos` o que já foi apontado.

## Histórico e conciliação

- O estado de 30/09/2026 foi carregado a partir do desenho (`docs/conciliacao_desenho_2026-09-30.md`) como
  regularização: 266 joists e 102 vigas já aparecem montadas no mapa, sem alterar a produção lançada.
- O bloco **Conciliação com os lançamentos** (abaixo do mapa) compara, por empresa, o lançado na produção com o
  apontado no mapa (joists e vigas) e mostra a diferença ("a apontar").
- Registros do histórico sem empresa ficam como "A DEFINIR" (hoje, 48 vigas). O painel "Definir empresa do
  histórico" atribui a empresa por região (peça, eixos, letras). Só vale para regularização; o BM vem dos lançamentos.
- O mapa alinha as estações de viga (A a H) aos retângulos: cada faixa ocupa o trecho das suas joists (a DE tem 7).

## Regras e proteções

- Viga já apontada não entra de novo (evita contar duas vezes a mesma viga).
- **43 joists por rua** (19 ruas x 43 = 817, o plano): são 43 retângulos por rua, e o servidor recusa a mesma joist
  apontada duas vezes, número fora de 1 a 43 e rua que passaria de 43. O lote é atômico: se uma peça for recusada,
  nada é gravado.
- A empresa é obrigatória em todo apontamento.
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

- Viga intermediária = 8 parafusos/porcas/arruelas Ø7/8". Confirmado com o desenho x retiradas físicas (ver `docs/conciliacao_desenho_2026-09-30.md`): com 4, FG012 daria 216 contra 405 retirados.
- O parafuso baixa quando a joist é apontada no quadrante (fixação), não no içamento genérico.
- Letra EF (VC03, FG005) adicionada: faltava no critério por letra.

## Limitações

- A viga de apoio de cada joist vem do `layout_joists` (estimativa calibrada com as retiradas de FG005/006/007),
  não do desenho: se a posição real for outra, ajuste a tabela. A orientação assume a letra A no topo.
- Registros antigos, sem nº de joist, ocupam os primeiros retângulos livres da mesma viga de apoio.
- O sistema PHP (online) não tem esta tela nem as rotas de estoque: o menu fica oculto nele.
- O apontamento não altera o histórico do Lançamentos. Para classificar o que já foi produzido, aponte com
  "Regularização" marcada.
- A baixa automática antiga por movimentação (ESTOQUE MOVIMENTOS) continua ligada aos lançamentos manuais; o
  Inventário e o Controle de Materiais usam o apontamento.

## Frentes de fechamento, marquise e contraventamento

Além do mapa das joists e das vigas, a aba Apontar montagem tem três mapas vindos do IFC do galpão
(`ferramentas/ifc_frentes_montagem.py` → `dados/ifc_frentes_montagem.json`):

| Aba | Peças no IFC | Células | Famílias | Soma no serviço |
|---|---|---|---|---|
| Fechamento lateral | 3.944 | 52 | terça, espaçador e telha de fechamento | FECH. LATERAL – ESTRUTURA |
| Marquise | 2.095 | 38 | terça marquise, mão francesa, telha marquise | a etapa escolhida (MARQUISE – …) |
| Contraventamento | 1.264 | 133 | contraventamento, suporte cont. | nenhum (só controle) |

- **Endereço de cada célula:** o código de posição do Tekla (`11-12/H`, `01/D1-D`, `14a-15/<H`) dá a rua ou o
  eixo e o trecho de letras. Eixos intermediários (01a, 02a…) caem na rua inteira; peça ancorada num eixo
  serve a rua seguinte.
- **Fechamento:** lado A e lado H com uma célula por rua, mais os oitões dos eixos 01 e 20 com uma por faixa.
- **Marquise:** lados A> e <H com uma célula por rua, e um seletor de etapa (vigas principais, pré-montagem de
  terças, terças, testeira), já que cada etapa é uma coluna diferente no controle de produção.
- **Contraventamento:** **planta do galpão inteiro**, como o OF.198-MET-DM-001: as 19 ruas na horizontal,
  estações de letra de A (topo) a H (base) e um X por kit, só nas 8 ruas contraventadas, que ficam
  destacadas. As demais aparecem vazias, para o contraventamento ficar na proporção real do projeto.
  O desenho sai na **escala do projeto**: a posição de cada eixo e de cada estação vem da malha do IFC
  (`malha.eixos_mm` e `malha.estacoes_mm`), então os vãos aparecem como no desenho — 9.000 e 13.500 mm
  alternados entre eixos, 8.380 mm entre estações e 4.190 mm junto às bordas (A1 a A3 e G1 a G3).
  O galpão tem 427,5 m × 176,0 m. Três escalas (compacto, normal e grande) mudam quantos milímetros
  cabem em cada pixel; no normal o galpão inteiro cabe na tela. Cada kit são 2 diagonais
  cruzadas (2 conjuntos do IFC) e leva a marca do Tekla. Não há coluna no controle de produção, então o
  apontamento serve de controle e não soma na produção nem no BM.

  | Ruas | Kits |
  |---|---|
  | 1 e 19 (01-02 e 19-20) | 2 CTH01, 1 em cada borda + 40 CTH02 ao longo da rua |
  | 4, 7, 9, 11, 13 e 16 | 2 CTH03, 1 em cada borda + 16 CTH04 + 2 CTH05 na cumeeira |

  São **204 kits** em 8 ruas, conferidos com as tags CTH da planta de locação (os rótulos do PDF caem nas
  mesmas 8 ruas e nas mesmas estações). O **CTH06 fica de fora**: ele é das bordas da marquise (A> e <H),
  não é contraventamento da cobertura. O apontamento guarda a marca do kit, a rua e o trecho de letras.
- **Montantes:** os 145 do IFC estão no miolo (letras C a F, Z ≈ 78 m), são da cumeeira e ficam fora do
  fechamento lateral.

Cada trecho só pode ser apontado uma vez (por etapa, na marquise). O apontamento grava em APONTAMENTO MONTAGEM
com `tipo` = FECHAMENTO / MARQUISE / CONTRAVENTAMENTO, `faixa` = parte do mapa, `rua` = trecho e `letra` = etapa.


## Baixa de fixadores das frentes novas

> Os dados que o programa lê (`regras_baixa.json`, `ifc_frentes_montagem.json`, `ifc_r0d_inventario.json`,
> `catalogo_bm.json`, `bm_medido_bm1.json`) ficam **dentro de `programa_obra198/`**, porque a atualização
> automática só copia essa pasta. O que o programa **grava** (a planilha e `dados/estoque_obra198.json`) fica
> fora dela, para a atualização nunca sobrescrever lançamento.

Ao apontar um trecho de **fechamento lateral** ou de **marquise**, o sistema baixa os fixadores daquele trecho:
o kit de cada família (do projeto) multiplicado pelas peças que o IFC tem naquela célula. O contraventamento
não tem baixa, a pedido.

Os kits vêm do **OF.198-MET-DM-001 — LOCAÇÃO PLANTA BAIXA R01** e estão em `regras_baixa.json`
(`consumo_por_servico`), cada linha com o detalhe do desenho que a originou:

| Família | Fixadores por peça | Detalhe do projeto |
|---|---|---|
| Terça de fechamento | 4 PARAF. Ø1/2" x 1 3/4" + 4 porca + 4 arruela Ø1/2" | CORTE B-B, C-C e K-K |
| Espaçador de fechamento | 2 PARAF. AB_TCP3 | autobrocante — **conferir em obra** |
| Pilarete | 4 PORCA Ø3/4" + 4 ARRUELA Ø3/4" + 3 PARAF. Ø3/8" x 1" | DETALHE 1 a 5 |
| Mão francesa (marquise, vigas principais) | 3 PARAF. Ø5/8" x 2" + 4 PORCA Ø1" + 4 ARRUELA Ø1" | CORTE G-G |
| Terça de marquise (etapa Terças) | 6 PORCA Ø1" + 6 ARRUELA Ø1" | DETELHE TÍPICO - VIGAS MARQUISES |

O bloco `fixadores_do_projeto` do mesmo arquivo guarda todos os fixadores lidos do desenho, por detalhe
(emendas de viga, travamentos TV02 a TV07, hardbolts dos cortes J-J a Q-Q), para rastreabilidade.

A baixa da **joist** segue como era: o kit por joist içada, sem detalhar por posição, para não duplicar com o
consumo que já existe.

### O fluxo depois do apontamento

O apontamento do trecho não para na tela: assim que é salvo, o consumo entra no estoque.

```
apontar trecho no mapa  →  prévio dos fixadores na própria tela
                        →  salvar
                        →  consumo virtual do material sobe em Suprimentos
                           (Materiais, Inventário e Fixadores críticos)
```

É a mesma função que calcula as duas pontas (`fixadoresDoTrecho`), então o que o prévio mostra é exatamente o
que entra no estoque. Num teste: um trecho do lado A baixou 48 autobrocantes e 32 parafusos Ø1/2" x 1 3/4",
e o consumo do FG005 em Materiais subiu de 1.488 para 1.520, o do FG003 de 528 para 576.
