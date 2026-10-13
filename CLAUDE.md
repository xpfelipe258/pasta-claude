# CLAUDE.md — Contexto permanente do projeto

> Atualizado em: 2026-10-07  
> Responsável: Felipe (xpfelipe258@gmail.com)  
> Engenheiro Civil — gestão de obras com estruturas metálicas

---

## O que é este projeto

Sistema web de **gestão de obra** desenvolvido em PHP, rodando no Hostinger.  
Objetivo: controle total da obra via dados, KPIs, dashboards e tomadas de decisão.  
Módulos: Estoque, Produção (apontamentos), DP (ponto/efetivo), Materiais, Mapa de montagem, Admin.

---

## Stack técnica

| Componente | Detalhe |
|---|---|
| Backend | PHP 8.x, MVC, PDO com prepared statements |
| Banco | MySQL 8 — `u502500687_maciel` |
| Servidor | Hostinger — `u502500687` |
| Domínio | `mtecengenharia.net/claude/maciel/` |
| Repositório | `xpfelipe258/pasta-claude` (GitHub) |
| Branch ativa | `claude/brave-bardeen-jyxlhm` |
| Pasta no repo | `maciel/` |

---

## Arquivos principais

| Arquivo | Função |
|---|---|
| `maciel/inc/nucleo.php` | Bootstrap, sessão, autenticação, DB |
| `maciel/inc/modelo.php` | Funções de negócio (estoque, produção, DP) |
| `maciel/inc/atualizar.php` | Sync Hostinger → GitHub e atualização pelo GitHub |
| `maciel/inc/config.php` | **GITIGNORED** — credenciais DB + token GitHub |
| `maciel/admin.php` | Administração: usuários, obra, sync, importação |
| `maciel/index.php` | Dashboard principal |

---

## Regras críticas (nunca violar)

- **`maciel/inc/config.php` nunca vai para o Git** — contém senha do banco e token GitHub
- Sempre usar `DateTimeZone('America/Sao_Paulo')` em timestamps (horário de Brasília)
- Prepared statements PDO em todas as queries — nunca concatenar SQL
- Nunca gravar senhas ou tokens em código-fonte commitado

---

## Credenciais de acesso (estrutura — nunca commitar os valores)

- **Banco MySQL:** host `localhost`, banco/user `u502500687_maciel` — senha em `inc/config.php`
- **GitHub token:** em `inc/config.php` → chave `github_token`
- **Hostinger upload:** gerar via `hosting_files_generate-upload-url` (user `u502500687`, domain `mtecengenharia.net`)

---

## Como fazer upload para o Hostinger

```bash
# 1. Gerar credenciais via Hostinger MCP
# operation: hosting_files_generate-upload-url
# params: { username: "u502500687", domain: "mtecengenharia.net" }
# Retorna: url, auth_key, rest_auth_key

# 2. POST (criar sessão TUS)
curl -i -X POST "{url}/claude/maciel/{arquivo}?override=true" \
  -H "X-Auth: {auth_key}" \
  -H "X-Auth-Rest: {rest_auth_key}" \
  -H "Tus-Resumable: 1.0.0" \
  -H "Upload-Length: {bytes}" \
  -H "Upload-Offset: 0"

# 3. PATCH (enviar conteúdo)
curl -i -X PATCH "{url}/claude/maciel/{arquivo}?override=true" \
  -H "X-Auth: {auth_key}" \
  -H "X-Auth-Rest: {rest_auth_key}" \
  -H "Tus-Resumable: 1.0.0" \
  -H "Content-Type: application/offset+octet-stream" \
  -H "Upload-Offset: 0" \
  --data-binary "@{arquivo_local}"
```

---

## Fluxo de trabalho padrão

```
Editar código (local/Claude Code)
    ↓
php -l {arquivo}   ← verificar sintaxe
    ↓
git add + git commit + git push (branch: claude/brave-bardeen-jyxlhm)
    ↓
Upload para Hostinger via TUS
    ↓
Testar em mtecengenharia.net/claude/maciel/
```

---

## Sincronização automática (Hostinger → GitHub)

- Implementada em `admin.php`: após qualquer ação POST bem-sucedida, auto-sync dispara
- Função: `sincronizar_para_github($cfg)` em `inc/atualizar.php`
- Commit message usa `DateTimeImmutable` + `DateTimeZone('America/Sao_Paulo')` → horário BRT
- O botão manual "Sincronizar Hostinger → GitHub" também existe na tela de Admin

---

## Estado atual do banco (esquema v12)

Tabelas presentes: `usuarios`, `obras`, `obras_dados`, `sistema`, `historico`,
`estoque_materiais`, `estoque_remessas`, `estoque_remessas_itens`,
`producao`, `apontamentos`, `dp_efetivo`, `bm_*`, `medicoes`, `empresas`.

Obra ativa: **OBRA 198** (id=1)

---

## Módulos implementados

- [x] Estoque com consumo virtual e alertas
- [x] Apontamentos de montagem (por empresa/quadrante/viga)
- [x] Mapa SVG de montagem (43 joists por rua)
- [x] DP — efetivo diário
- [x] Materiais com baixa automática por atividade
- [x] Contraventamento em vista elevada
- [x] Admin com sync GitHub automático
- [x] Dashboard administrativo multi-obra
- [x] SESMT GERAL — cadastros de SST (24 tabelas `sesmt_*`), painel, listas editáveis e acesso por usuário

---

## Histórico de sessões

### 2026-10-13 (2)
**Planejamento — botão "Baixar planejamento":** gera um documento HTML único (abre em qualquer navegador; botão interno ou Ctrl+P salva em PDF) com resumo, fluxo executivo colorido por situação, curva S, quadro das atividades e cada etapa do fluxo explicada (o que é, por que importa, **impacto se não alcançar o objetivo**, como recuperar) + cartão de cada atividade do plano (5W2H, situação, atraso projetado e efeito em cascata nas etapas seguintes). Arquivo novo: `maciel/planos_doc.js` (botão `data-pl-doc` em `plRenderPainel`, `planos.js`; script carregado em `inc/painel.html`, versionado por `filemtime` em `index.php`). Fluxos em `PLD_FLUXOS`: galpão principal (17 etapas: chegada de material … rufos e acabamentos) e anexos (8 etapas); o enquadramento da atividade do cronograma na etapa é por nome (`PLD_REGRAS`, só frentes `GALPÃO…` entram no fluxo do galpão; o resto vai para anexos). Chegada de material, descarregamento e checklist não têm linha no cronograma: aparecem como etapas de apoio.

**Planejamento — Liberação do fluxo (perguntas de portão):** nova aba "Liberação do fluxo" no painel do plano. Chegada de material, descarregamento e checklist não têm linha no cronograma, então viram perguntas por atividade, em ordem: *o material chegou?* → *foi descarregado?* → *checklist aprovado?* (checklist só para o que vem depois dele no galpão). **Sim = prossegue; Não = retorna** à etapa e a atividade fica bloqueada (campo opcional "chega em" calcula o atraso sobre o início previsto). Resposta gravada em `itens[].portoes[material|descarga|checklist] = {r, em, por, prev, obs}`; data/hora (BRT) e autor são carimbados no servidor (`plano_portoes()` em `maciel/api.php`, só quando a resposta muda). O documento "Baixar planejamento" mostra as perguntas nas etapas 1, 2 e 7 (anexos: a1, a2), lista as atividades bloqueadas como causa-raiz e inclui o bloqueio no atraso/cascata. Fluxo do galpão agora tem 17 etapas: suporte + terças do fechamento lateral são **uma etapa só** (g10) e a **calha da marquise** é etapa própria (g16, depois das telhas da marquise). Código em `maciel/planos_doc.js` (`PLD_FLUXOS`, `PLD_REGRAS`, `PLD_PORTOES`, `plLiberacao`).

**Relatório só com as atividades do plano:** o fluxo padrão (`PLD_FLUXOS`) é apenas FONTE DE DADOS. `pldFluxoDoPlano()` (`maciel/planos_doc.js`) monta o fluxo do plano a partir das atividades inseridas no 5W2H: entram só as etapas que têm atividade no plano (na ordem do fluxo da obra, numeradas de 1..n) e as perguntas de liberação que valem para elas (material/descarga; checklist só se houver atividade depois dele); fluxo sem atividade identificada (galpão ou anexos) não aparece. Fluxo visual, blocos de etapa e gargalos usam só isso.

**Relatório em fluxogramas (escolha do usuário: A + B, caixas curtas, só fluxogramas e dados):** em `maciel/planos_doc.js` os textos viraram caixas e setas em HTML/CSS (helpers `pldNo`, `pldSeta`, `pldDec`). (B) Seção 1: fluxo único do plano (`pldFluxoVisual`) com setas vermelhas sob cada etapa atrasada/bloqueada (`+N d.u. empurra <próxima etapa>`). (A) Seção 5: um fluxograma por etapa (`pldFluxogramaEtapa`): etapa anterior ▶ etapa ▶ decisão "objetivo cumprido?" ─SIM▶ libera a próxima / ─NÃO▼ caixas de IMPACTO por categoria (prazo, custo, qualidade, contrato/BM) ▼ AÇÕES de recuperação ↩ volta à decisão. Etapas de portão (material, descarga, checklist) usam a pergunta como decisão. Cada atividade do plano tem seu fluxo (`pldFluxoAtividade`): liberação ✓/✗ ▶ atividade ▶ "fecha no prazo?" → atraso em dias úteis, o que empurra (novas datas) e o ritmo necessário. Seção 4 (plano não cumprido) também em fluxograma. Removidos os parágrafos "O que é / Por que importa" (fica 1 linha na caixa da etapa).

**Impactos — Setor responsável e ranking no relatório:** coluna nova `setor` na tabela `impactos` (migração automática em `inc/nucleo.php`; lida em `inc/modelo.php`, gravada por `acao_impacto` em `api.php`), campo "Setor responsável" no formulário (lista de sugestões `SETORES_IMPACTO` em `maciel/app.js`: Suprimentos, Planejamento, Engenharia/Projeto, Produção/Montagem, Qualidade, SESMT, Equipamentos, Cliente, Fornecedor, Clima/Externo, Outro; aceita outro nome digitado) e coluna na tabela da aba. Impacto automático de remessa atrasada = setor Suprimentos. O relatório "Baixar relatório" (`baixarRelImpacto`) ganhou a seção **Impacto por setor responsável — ranking** (`htmlRankingImpactos`/`rankingImpactos`): cartões (setor que mais impactou, empresa mais afetada, total), ranking dos setores por horas perdidas (nº de impactos, horas, em aberto, % das horas) e ranking das empresas mais afetadas com o principal setor causador. Horas lidas do campo "Tempo perdido" (`horasDoTempo`: H, DIAS, SEMANA, MIN; **1 dia = 8 h**, `HORAS_POR_DIA`); remessa atrasada = dias × 8 h; impacto sem tempo conta no nº mas não nas horas; setor vazio = "Não informado"; nomes de setor agrupados sem diferenciar maiúsculas/acentos.

### 2026-10-13
**Finanças ARQUIVADO:** módulo removido do sistema (menu, `modulos_sistema()`, Admin, `sesmt_alterar_acesso`) e guardado em `arquivados/financas/` (código PHP, testes, programa Python e `integracao.patch`; ver `arquivados/financas/README.md` para restaurar). Tabelas `fin_*` não foram apagadas.

### 2026-10-11
**Finanças (histórico, hoje arquivado)** (programa Python `financas/` portado para PHP, aba isolada no sistema):
- Arquivos novos: `maciel/financas.php`, `maciel/inc/financas_modelo.php` (tabelas `fin_lancamentos`/`fin_config`, CRUD, painel), `maciel/inc/financas_calculos.php` (INSS/IRRF 2026, MEI, Simples Anexo III/V com Fator R, CDB/LCI/LCA/Tesouro/poupança — funções puras), `ferramentas/teste_financas_php.py` (26 testes, inclui paridade PHP × Python)
- Alterações em arquivos existentes (só acréscimos): módulo `financas` em `modulos_sistema()` (`inc/nucleo.php`), grupo "Finanças" no menu (`inc/painel.html`), rótulo "Finanças" e padrão desmarcado para `financas` em `admin.php`, e `sesmt_alterar_acesso()` não concede `financas` junto com o SESMT
- Privacidade: dados financeiros são POR USUÁRIO (`usuario_id`); nem o admin vê os de outra pessoa. Acesso só para admin ou usuário marcado em Administração → Usuários → "Finanças" (liberação explícita, como o SESMT)
- Parâmetros fiscais de 2026 ficam no topo de `financas_calculos.php` (e `financas/impostos.py`); são estimativas — validar com o contador. Selic/CDI/IPCA iniciais são valores de referência: botão "Buscar taxas no Banco Central" atualiza
- Arredondamento de centavos "meio para cima" (Python `round()` dava 121,57 em vez de 121,58 no INSS; corrigido em `financas/impostos.py`)
- Testes: `python ferramentas/teste_financas_php.py` (PHP + SQLite em pasta temporária)

### 2026-10-09
**SESMT GERAL** (planilha "Gestão SST - Rótula" convertida para PHP):
- Arquivos novos: `maciel/sesmt.php`, `maciel/inc/sesmt_modelo.php`, `maciel/inc/sesmt_registros.php`, `ferramentas/teste_sesmt.py`
- Alterações em arquivos existentes (só acréscimos): módulo `sesmt` em `modulos_sistema()` (`inc/nucleo.php`) e grupo "SESMT GERAL" no menu (`inc/painel.html`)
- Colaboradores NÃO foram importados da planilha: são cadastrados no sistema, com coluna Empresa; as listas das caixas de seleção (fontes de dados) estão em `sesmt_listas`
- Dados pessoais e de saúde: acesso só para admin ou usuário liberado em SESMT GERAL → Acessos; CPF mascarado nas listas e no CSV
- Testes: `python ferramentas/teste_sesmt.py` (PHP + SQLite em pasta temporária, 36 testes)
**Cronograma (Gantt):** previsto do Telhar em m². A meta cadastrada (7 telhas/dia) era aplicada sobre a quantidade do catálogo do BM (m²). Em `clienteComContratoAtual()` (`maciel/app.js`), quando a quantidade vem do catálogo em m² e a meta não fecha com ela no prazo, a meta passa a ser m² ÷ dias úteis entre início planejado e prazo; o tooltip do Gantt mostra a unidade m².
**Cronograma (Gantt) — Telhar F1 e Eclusa:** datas padrão do Telhar F1 = 01/10 a 27/11/2026 (`GAN_AJUSTES_DATAS_PADRAO`, busca sem diferenciar maiúsculas/acentos). Eclusa deixou de ter o avanço suprimido: Vigas e Joists (BM 3.3.1, ponderado por peso), Calhas (3.4.10) e Telhas (3.4.1) usam as atividades do BM da própria Eclusa, em % (`ganBmAtividadesEspecificas`, `ganBmPercentual`). Fechamento ACM e Rufos seguem sem avanço.
**Dashboard cliente — realizado da Eclusa:** a Eclusa mostrava produção do galpão (`servicoCompat` por substring deixava 'VIGAS' do galpão contar em 'ECLUSA – VIGAS E JOISTS'). Frentes anexas (`ehFrenteAnexa()` em `maciel/app.js`: tudo que não é Galpão ou é Marquise) agora só somam colunas da própria frente (`servicosDaFrente()`, `realizadoAnexo()`) e, na Eclusa, o avanço do BM em % (`realizadoAnexoBm()`), valendo o maior; `renderCliente` usa o mesmo critério no realizado do período.
**Planejamento 5W2H (aba Planejamento, nova):** fluxo Novo planejamento → período da execução → atividades (todas as do cronograma/Gantt, via `ganLinhas`, de todas as frentes e fases) → 5W2H de cada uma (What/Why/Where/When/Who/How/How much) → painel. Painel: curva S planejado × realizado × projeção × necessário (geral ponderado ou por atividade), o que falta (necessário/dia × ritmo atual), divisão automática por dia útil (plano original ou replanejado com o saldo ÷ dias que restam; por dia ou semana), Gantt do plano, linha do tempo, tabela 5W2H, CSV, editar/concluir/excluir. Arquivos: `maciel/planos.js` (módulo), `.pl-*` em `maciel/style.css`, rota `planos` (`acao_planos`, `planos_ler` em `maciel/api.php`, módulo producao, JSON `planos_5w2h` em `obra_config` por obra), `#planoNovo`/`#planoLegado` em `maciel/inc/painel.html`. **Planejamento abre na SUGESTÃO do cronograma** (sub-aba padrão, `renderSugestao`/`plSugestao` em `planos.js`): para o período escolhido (semana da referência, próxima, esta+próxima, até o fim do mês ou datas livres) lista as atividades do cronograma com contrato, previsto até a data de referência (`prevCliente`), realizado, desvio, previsto até o fim do período, **precisa realizar** (= previsto até o fim − realizado, limitado ao saldo; inclui o atraso), por dia útil e **quem executa** (empresas que têm o serviço na grade; sem nenhuma, o responsável do cadastro). Curva do cronograma previsto × realizado × rumo ao previsto, visão por atividade ou por quem executa, e botão "Criar planejamento com N selecionadas" que abre o assistente já no 5W2H com quantidade = meta do período, datas, quem e o porquê preenchidos (`plItemPadrao`). Abas: Sugestão do cronograma | Planos 5W2H | Setores e impacto logístico. **Divisão por dia = meta ou ritmo (não igual):** o plano original reparte a quantidade à razão da meta/dia de cada atividade (a digitada no 5W2H ou, em branco, a meta atual do cronograma: `plMeta`, `plDistribuirTaxa` em `planos.js`; meta/dia gravada em `meta_dia` por item, aceita por `acao_planos`); sem fechar no período, aparece o aviso e a coluna "Fecha em". A visão "Pelo ritmo atual" mantém a meta até a data de referência e, dos dias seguintes em diante, distribui o saldo no ritmo real (média dos últimos 5 dias úteis; sem lançamentos, na meta). Resumo mostra Meta/dia, Necessário/dia, Ritmo, Fecha em (meta) e Fecha em (ritmo). O plano guarda só o planejado; o realizado vem da produção lançada (Eclusa em %, só BM). Base do realizado = data de referência. A tela antiga virou a sub-aba "Setores e impacto logístico" (`renderPlanejamentoLegado`). `index.php` passou a versionar `planos.js` e `style.css` por `filemtime`.

**Dashboard cliente — fontes por coluna** (`CLIENTE_FONTES`, `clienteComFontes()` em `maciel/app.js`; vale também para Avanço físico, curva S e tiles): contrato = soma das atividades do catálogo do BM (Pré-montagem, Instalação de joist e Vigas = EJ + CMM do item 3.1.1, galpão inteiro na linha da Fase 1; Perfilagem, Instalação de telhas e Instalação das telhas do fechamento = catálogo da Globo em m²); Fech. Lateral – Estrutura = % de avanço, média das duas empresas (pesos do item 3.1.2); nomes = nomes do catálogo (só na tela, vínculo interno intacto); início/prazo = cronograma do cliente (igual ao Gantt); meta/dia = contrato ÷ dias úteis; realizado = maior entre Lançamentos e BM; situação = % do previsto no período (>=100% adiantado, 95-100% no limite, <95% atrasado). Botão admin "Consolidar cadastro com as fontes" grava esses valores em METAS CLIENTE (via rota `registro`) depois de mostrar antes/depois. Escopo por empresa (servicos.escopo) e IFC não foram apagados: outras telas dependem deles.
**Dashboard cliente — correção do Previsto período:** `prevPer` = previsto acumulado no fim do período − previsto acumulado na véspera (`prevCliente`), por item; antes era meta × todos os dias úteis do período, sem respeitar início/prazo/contrato (estourava o contrato e deixava tudo ATRASADO). Linhas da Fase 2 de serviços com catálogo (`CLIENTE_FONTES`) saem do dashboard (o catálogo cobre o galpão inteiro na linha da Fase 1; antes somavam 100%+76% e 12.083+806 m²). Fechamento lateral (estrutura e telhas) começa em 01/10/2026 (`GAN_AJUSTES_DATAS_PADRAO`, vale também no Gantt). ATENÇÃO: a rota `registro` copia `cliente.qtd` para `servicos.escopo` (grade por empresa, outra unidade) — por isso "Consolidar cadastro com as fontes" grava só meta/dia, início e prazo, nunca o contrato.
**Apontar montagem — vigas dos oitões:** eixos 01 e 20 têm 21 vigas (IFC, VIGA COBERTURA VC08–VC16), identificadas pelo trecho (`B-A1`...) em `regras_baixa.json` (`vigas_oitao` + `criterio_por_letra` com `oitao:true`); demais eixos seguem com 13 (letras A–H). Mapa, "Digitar vigas", quadrante e validação do servidor (`acao_apontamento` em `api.php`) tratam os dois casos; total 276 = 18×13 + 2×21. Kit da viga do oitão (evento `VIGA_OITAO_MONTADA`, do IFC): 4 parafusos FG007 + 4 porcas FG015 + 4 arruelas FG018; cada pilarete (22 por oitão, localizado pela posição no IFC) pertence à viga que o cobre e, ao apontar a viga, baixa 8 porcas FG022 + 4 arruelas FG024 (`vigas_oitao.pilarete_baixa`, `pilaretes` por trecho). **Apontamento → estoque (online):** `eventos_de_apontamentos()` em `maciel/inc/modelo.php` transforma apontamentos de joist/viga em eventos de baixa ao montar `estoque_ifc.resumo` (antes só valiam eventos manuais). Fechamento lateral dos oitões segue por faixa (7 células por oitão), pendente de definição do usuário.

**BM — Eclusa 3.3.1 e preços:** `EJ-3.3.1-02` (pré-montagem) e `EJ-3.3.1-03` (instalação de joists) passaram de 11 para 18 un. A correção é a migração `corrigir_dados_v13()` em `maciel/inc/nucleo.php` (esquema 13, roda uma vez e só mexe no que ainda vale 11: `bm_atividades`, escopo de servicos EJ da Eclusa e `cliente`); BMs fechados ficam congelados em 11. Sementes atualizadas (`dados_iniciais.json`, `catalogo_bm.json`). O valor do item (R$ 31.524,08) foi mantido, então o preço unitário cai. Colunas **Valor total (R$)** e **Valor unitário (R$)** (valor do item × peso normalizado da atividade; unitário = total ÷ quantidade contratada, `bmPrecoAtividade()`) no Boletim, na impressão do BM e no Catálogo de atividades.

**Estoque — fixadores novos em Consumo físico e Inventário:** todo material cadastrado em Materiais que seja fixador (tipo FIXADOR ou nome/código com parafuso, porca, arruela, chumbador) passa a existir também no Consumo físico e no Inventário, com a mesma TAG. Servidor: `estoque_incluir_fixador()` em `maciel/api.php` cria as linhas no JSON `estoque_planilha` ao cadastrar/editar (e `estoque_remover_fixador_cadastrado()` as remove ao excluir se não houver consumo); `acao_estoque_consumo` também cria a linha na hora quando a TAG só existe no cadastro. Tela: `estConsumoComCadastros()` e `estInventarioComCadastros()` em `maciel/app.js` mostram os fixadores já cadastrados antes dessa mudança, sem depender da planilha. **Todo material cadastrado vai para Remessas** (e para a lista de materiais da planilha) via `estoque_incluir_cadastro()`; só o fixador vai também para Consumo físico e Inventário. **TAG de fixador novo padronizada:** `FG###` (fixador geral) ou `FJ###` (fixador de joist, quando o nome/etapa/serviço cita JOIST); vazia = gera a próxima (`proximo_codigo_fixador()`, máximo +1 sobre cadastro e planilha); digitada é normalizada (`fg30` → `FG030`) e recusada se não for FG/FJ ou se já existir. Vale só para cadastro novo (editar não troca a TAG).

**Estoque — edição inline no Consumo físico:** cada célula (TAG × semana × EJ/CMM) da tabela de consumo é editável direto (clique, digite, Enter; Esc cancela; vazio limpa). Rota `estoque-planilha/consumo-celula` (`acao_estoque_consumo_celula` em `maciel/api.php`, módulo suprimentos) grava o valor no lugar do anterior e recalcula total da semana, `total_consumo` do item e `consumido`/`estoque_pos_baixa` do material; semanas novas continuam por "+ Registrar consumo". Tela: `celulaConsumo()` e `editarConsumoInline()` em `maciel/app.js`.

### 2026-10-08
**Planejamento (aba Planejamento):** filtro por status, edições não salvas preservadas ao trocar filtros, preenchimento de datas em lote em sequência, Gantt planejado × real, exportação CSV e indicador de alterações pendentes.

### 2026-10-07
**Corrigido:**
- HTTP 500 em `admin.php` — `$cfg` era usado antes de ser definido (TypeError PHP 8)
- Solução: `$cfg = config()` movido para linha 11 (antes do bloco POST)
- `catch(Exception)` trocado por `catch(Throwable)` para capturar qualquer erro PHP 8

**Implementado:**
- Auto-sync Hostinger → GitHub após qualquer ação POST bem-sucedida no `admin.php`
- Timestamps de commit em horário de Brasília (BRT) com `DateTimeImmutable` + `DateTimeZone('America/Sao_Paulo')`
- Este arquivo `CLAUDE.md` — memória persistente entre sessões
- Instruções do Claude Project para acesso via celular/outros dispositivos

**Commits:** `8c4a999`, `d641780` — branch `claude/brave-bardeen-jyxlhm`

### 2026-10-06
- Upload inicial dos arquivos `config.php`, `atualizar.php`, `admin.php` para Hostinger
- Botão de sincronização manual Hostinger → GitHub adicionado ao `admin.php`
- Token GitHub configurado em `inc/config.php` (gitignored)

---

## Próximos passos sugeridos

- [ ] Dashboard com KPIs visuais (gráficos por data, empresa, atividade)
- [ ] Exportação de relatórios em PDF
- [ ] Notificações de alertas de estoque por e-mail/WhatsApp
- [ ] Sincronização automática em outros módulos além do admin (estoque, DP)
