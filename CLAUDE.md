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

## Estado atual do banco (esquema v15)

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

### 2026-10-14 (2)
**"Telhar" → "Instalação de telhas" (nome do catálogo do BM, GLO-3.2.1-02) em todos os lugares; KPI removido; Tendências em m²; impactos da mesma atividade consolidados:**
- **ESQUEMA_VERSAO = 15** — `renomear_telhar_v15()` em `maciel/inc/nucleo.php` troca `TELHAR` (qualquer caixa) por `Instalação de telhas` em `servicos.nome`, `metas.servico`, `cliente.servico`, `impactos.servico`, `materiais.servico` e, por substituição de texto, nos JSON de `obra_config`/`sistema` (planos 5W2H, `contratos_cliente`, planilha de estoque) — só quando "telhar" é o valor inteiro ou parte de uma chave separada por `|`. Sementes (`inc/dados_iniciais.json`) já com o nome novo.
- Código (`maciel/app.js`): `ehTelhar(n)` aceita os dois nomes; `CLIENTE_FONTES` usa a chave `INSTALACAO DE TELHAS` (`clienteFonte()` ainda entende `TELHAR`); Gantt (`GAN_CRONOGRAMA_CLIENTE`, `GAN_AJUSTES_DATAS_PADRAO`) com o nome novo; datas editadas no Gantt (localStorage `obra198_gantt_datas`) com chave antiga são migradas sozinhas; `cap()` não força mais maiúsculas em nome já escrito com maiúsculas e minúsculas.
- **Área KPI removida:** grupo "KPI / Insights" do menu (`inc/painel.html`, `dashboard_admin.php`), seção `#aba-kpi`, `renderKPI`/`renderKpiProntidao`/`atualizarContadorKpi` (`app.js`) e o módulo `kpi` em `modulos_sistema()`. `kpi()`/`kpiPer()` ficam (Painel, Semana e Tendências usam).
- **Tendências — Instalação de telhas:** para a Globo Aços usa `telharM2()` (`app.js`): previsto = cronograma do cliente em m² (`prevCliente`, contrato do catálogo do BM) e realizado = `realizadoPeriodoItem` (maior entre lançamentos e BM), igual ao Dashboard cliente. Antes comparava a meta semanal em telhas com produção em m². Vale nos 3 gráficos. Painel/farol continuam com `kpiPer` (meta em telhas) — ainda não conciliado.
- **Impactos — dias REAIS do calendário, proporcionais ao período do relatório (corrige "600 dias úteis" numa obra de 3 meses):** o total somava os dias de cada impacto/remessa, e serviços parados no mesmo dia ou remessas sobrepostas contavam várias vezes. Agora `diasPorImpacto(i, lim)` (`app.js`) transforma cada impacto nos dias úteis em que valeu, **recortados ao período do relatório** (`lim = {ini, min(fim, ref)}`); `mapaImpactos()` une os dias (o mesmo dia conta uma vez por setor e por empresa; horas valem a fração do dia). `rankingImpactos(imp, empFiltro, lim)` devolve: dias por **setor** (quantos dias do período o setor impactou a obra), por **empresa** (dias parada direto + dias por cascata sem repetir os dias já parados) e o total de dias do período com algum impacto, sempre com % dos dias úteis do período (`uteis`). O relatório ganhou a matriz **Empresa × setor** (ex.: dias que a Globo Aços ficou parada por Suprimentos). Mesma atividade com vários impactos continua aparecendo uma só vez (`resumoImpactosPorAtividade`, trechos de dias úteis seguidos = 1 trecho; com interrupção, trechos se somam; aba Impactos `#tabImpAtiv`). Tabela de remessas do relatório: total = dias úteis do período com remessa em atraso, sem repetir o dia. Registros continuam separados para editar/solucionar.
- **Impactos — setor Fornecedor exige o fornecedor; coluna "Dias úteis impactados (direto)":** no ranking de empresas a coluna deixou de dizer "parada" (ainda não houve parada direta). No formulário, ao digitar/escolher o setor "Fornecedor" aparece "Qual fornecedor?" (CMM, EJ, GLOBO AÇOS — vindos das empresas cadastradas — ou Outros com nome livre); é obrigatório e fica gravado em `impactos.setor` como `Fornecedor — CMM` (sem coluna nova; `fornecedorDeSetor()`, `atualizarFornecedorImpacto()` em `app.js`, campo `#impFornecedorBox` em `inc/painel.html`). Como o texto do setor muda, o ranking e a matriz Empresa × setor separam cada fornecedor automaticamente; ao editar, o setor volta como "Fornecedor" + fornecedor escolhido.
- **BM → Catálogo de atividades: "Salvar" não salvava (corrigido):** `salvarDialogo()` lia `f.elements[k]` e o campo `item` (Item do BM) colide com `form.elements.item()` do navegador (`undefined.trim()`, erro silencioso). Agora usa `f.elements.namedItem(k)`. Vale para qualquer formulário do diálogo com campo `item`/`length`/`namedItem`. Peso é digitado de 0 a 1 (0,25 = 25%).
- **Painel e Faróis: telhas em m² + planejamento 5W2H dentro do dashboard:** (1) `kpiPer()` (`app.js`) usa `telharM2()` para os serviços de telha da Globo Aços (instalação de telhas, perfilagem, fechamento): meta, previsto e realizado em m² do catálogo do BM, iguais ao Dashboard cliente (a meta cadastrada em telhas deixou de ser comparada com produção em m²); a linha do Farol mostra "(m²)". Vale para Painel, tiles, alertas e Tendências. O Plano de ação semanal (escopo por empresa) não foi alterado. (2) Novo bloco **"Planejamento 5W2H — planejado × executado"** no Painel (`#painelPlanos`, `renderPainelPlanos()` em `planos.js`): planos ativos que cruzam o período do Painel, filtro por plano e por atividade, cartões (planejado até hoje, executado, falta, atividades/situação), **curva S** (planejado × executado × projeção × necessário, `plDesenharCurva(pl, c, 'gPainelPlano', atv)`) e tabela por atividade com % do plano executado, meta/dia, necessário/dia e situação; respeita o filtro de empresa do Painel. Vários planos são somados em `plPlanoCombinado()` (cada item mantém a janela do próprio plano, `it._plano`, usada por `plCalcItem`). (3) **Farol do período** ganhou a coluna "Plano 5W2H" (% do plano executado e % do previsto, `plResumoFarol`/`plCasaLinha`: casa empresa + serviço, atividades de frente anexa só por nome exato) e os **Pontos de atenção** listam atividades de plano atrasadas/no limite (`plAlertasPainel`). Os planos são relidos do servidor no máximo a cada 60 s ao abrir o Painel.
- Testes de ponta a ponta (banco v14 com nomes antigos → migração → Chromium): `scratchpad/t/e2e_telhar.py` (fora do repo).

### 2026-10-13 (2)
**Planejamento — botão "Baixar planejamento":** gera um documento HTML único (abre em qualquer navegador; botão interno ou Ctrl+P salva em PDF) com resumo, fluxo executivo colorido por situação, curva S, quadro das atividades e cada etapa do fluxo explicada (o que é, por que importa, **impacto se não alcançar o objetivo**, como recuperar) + cartão de cada atividade do plano (5W2H, situação, atraso projetado e efeito em cascata nas etapas seguintes). Arquivo novo: `maciel/planos_doc.js` (botão `data-pl-doc` em `plRenderPainel`, `planos.js`; script carregado em `inc/painel.html`, versionado por `filemtime` em `index.php`). Fluxos em `PLD_FLUXOS`: galpão principal (17 etapas: chegada de material … rufos e acabamentos) e anexos (8 etapas); o enquadramento da atividade do cronograma na etapa é por nome (`PLD_REGRAS`, só frentes `GALPÃO…` entram no fluxo do galpão; o resto vai para anexos). Chegada de material, descarregamento e checklist não têm linha no cronograma: aparecem como etapas de apoio.

**Planejamento — Liberação do fluxo (perguntas de portão):** nova aba "Liberação do fluxo" no painel do plano. Chegada de material, descarregamento e checklist não têm linha no cronograma, então viram perguntas por atividade, em ordem: *o material chegou?* → *foi descarregado?* → *checklist aprovado?* (checklist só para o que vem depois dele no galpão). **Sim = prossegue; Não = retorna** à etapa e a atividade fica bloqueada (campo opcional "chega em" calcula o atraso sobre o início previsto). Resposta gravada em `itens[].portoes[material|descarga|checklist] = {r, em, por, prev, obs}`; data/hora (BRT) e autor são carimbados no servidor (`plano_portoes()` em `maciel/api.php`, só quando a resposta muda). O documento "Baixar planejamento" mostra as perguntas nas etapas 1, 2 e 7 (anexos: a1, a2), lista as atividades bloqueadas como causa-raiz e inclui o bloqueio no atraso/cascata. Fluxo do galpão agora tem 17 etapas: suporte + terças do fechamento lateral são **uma etapa só** (g10) e a **calha da marquise** é etapa própria (g16, depois das telhas da marquise). Código em `maciel/planos_doc.js` (`PLD_FLUXOS`, `PLD_REGRAS`, `PLD_PORTOES`, `plLiberacao`).

**Relatório só com as atividades do plano:** o fluxo padrão (`PLD_FLUXOS`) é apenas FONTE DE DADOS. `pldFluxoDoPlano()` (`maciel/planos_doc.js`) monta o fluxo do plano a partir das atividades inseridas no 5W2H: entram só as etapas que têm atividade no plano (na ordem do fluxo da obra, numeradas de 1..n) e as perguntas de liberação que valem para elas (material/descarga; checklist só se houver atividade depois dele); fluxo sem atividade identificada (galpão ou anexos) não aparece. Fluxo visual, blocos de etapa e gargalos usam só isso.

**Relatório em fluxogramas (escolha do usuário: A + B, caixas curtas, só fluxogramas e dados):** em `maciel/planos_doc.js` os textos viraram caixas e setas em HTML/CSS (helpers `pldNo`, `pldSeta`, `pldDec`). (B) Seção 1: fluxo único do plano (`pldFluxoVisual`) com setas vermelhas sob cada etapa atrasada/bloqueada (`+N d.u. empurra <próxima etapa>`). (A) Seção 5: um fluxograma por etapa (`pldFluxogramaEtapa`): etapa anterior ▶ etapa ▶ decisão "objetivo cumprido?" ─SIM▶ libera a próxima / ─NÃO▼ caixas de IMPACTO por categoria (prazo, custo, qualidade, contrato/BM) ▼ AÇÕES de recuperação ↩ volta à decisão. Etapas de portão (material, descarga, checklist) usam a pergunta como decisão. Cada atividade do plano tem seu fluxo (`pldFluxoAtividade`): liberação ✓/✗ ▶ atividade ▶ "fecha no prazo?" → atraso em dias úteis, o que empurra (novas datas) e o ritmo necessário. Seção 4 (plano não cumprido) também em fluxograma. Removidos os parágrafos "O que é / Por que importa" (fica 1 linha na caixa da etapa).

**Impactos — Setor responsável e ranking no relatório:** coluna nova `setor` na tabela `impactos` (migração automática em `inc/nucleo.php`; lida em `inc/modelo.php`, gravada por `acao_impacto` em `api.php`), campo "Setor responsável" no formulário (lista de sugestões `SETORES_IMPACTO` em `maciel/app.js`: Suprimentos, Planejamento, Engenharia/Projeto, Produção/Montagem, Qualidade, SESMT, Equipamentos, Cliente, Fornecedor, Clima/Externo, Outro; aceita outro nome digitado) e coluna na tabela da aba. Impacto automático de remessa atrasada = setor Suprimentos. O relatório "Baixar relatório" (`baixarRelImpacto`) ganhou a seção **Impacto por setor responsável — ranking** (`htmlRankingImpactos`/`rankingImpactos`): cartões (setor que mais impactou, empresa mais afetada, total), ranking dos setores por horas perdidas (nº de impactos, horas, em aberto, % das horas) e ranking das empresas mais afetadas com o principal setor causador. Horas lidas do campo "Tempo perdido" (`horasDoTempo`: H, DIAS, SEMANA, MIN; **1 dia = 8 h**, `HORAS_POR_DIA`); remessa atrasada = dias × 8 h; impacto sem tempo conta no nº mas não nas horas; setor vazio = "Não informado"; nomes de setor agrupados sem diferenciar maiúsculas/acentos.

**Temas (Administração → Aparência) e novo Dashboard geral:** tema por usuário em `usuarios.tema` (`light` branco, `dark` preto, `space` ESPACIAL nebulosa; vazio = automático pelo aparelho). Aplicado no servidor como `<html data-theme>` (`tema_do_usuario()`/`tema_attr()` em `inc/nucleo.php`, usados por `pagina_inicio()` e por `index.php`); CSS `:root[data-theme="space"]` em `maciel/style.css` (variáveis + estrelas/nebulosa + cartões de vidro); seletor com prévia imediata em `admin.php` (`acao=salvar_tema`). Telas do portal (`login.php`, `obras.php`, `portal.css`) seguem claras. **ESQUEMA_VERSAO = 14**: as migrações (`criar_esquema`) só rodam quando a versão sobe — colunas novas (`usuarios.tema`, `impactos.setor`) PRECISAM de bump de versão. `dashboard_admin.php` reescrito: sem alertas críticos nem contadores vermelhos do menu; só 3 cartões de Suprimentos — **Material que chegou** (% por peso = Σ min(chegou, planejado) × peso unitário ÷ Σ planejado × peso; por tipo JOIST/FIXADOR/ESTRUTURAL), **Consumo de joist** e **Consumo de material** (consumido ÷ chegou e consumido ÷ planejado). Peso só é usado quando ≥ 80% dos itens do grupo têm peso unitário; senão usa quantidade (o cartão informa a base).

**Impactos — correções após teste em produção:** salvar impacto com setor falhava ("Falha ao gravar no banco de dados") porque a coluna `impactos.setor` só existe após a migração do esquema 14; agora `acao_impacto` chama `garantir_coluna_impacto_setor()` (cria a coluna na hora se faltar). Remessa com data fora do padrão (duas datas no mesmo campo) gerava impacto automático "NaN dia(s)/NaNh" e quebrava o ranking: `remessasAtrasadas()` agora ignora essas remessas. Teste de ponta a ponta (PHP+SQLite+Chromium): banco v13 → migração → salvar setor pela tela → baixar relatório com o ranking.

**Relatório de impactos — produtividade em m² e Pessoal por dia:** na tabela "Produtividade das empresas nas atividades impactadas", Perfilagem, Telhar e Fechamento (telhas) da Globo passam a usar o MESMO previsto e realizado do Dashboard cliente / Avanço físico, em m² (`relItemCatalogoM2()` em `maciel/app.js` → item do cliente com `clienteComFontes`; previsto = `prevCliente(fim) − prevCliente(véspera do início)`; realizado = `realizadoPeriodoItem` = maior entre lançamentos e BM, sem somar os dois). Antes o previsto vinha da meta em telhas e o realizado somava grade + BM em m² (Ating. de 3.600%). Aceita cadastro do cliente com outro nome (ex.: "PERFILAGEM DE TELHAS"). A tabela "Pessoal por dia" virou uma linha por data com uma coluna por empresa (efetivo lançado no DP), **Total do efetivo no dia**, **Impactos em andamento** no dia e rodapé com total (homem-dia), média por dia lançado e pico.

**Administração — 504 Gateway Time-out ao salvar (corrigido):** depois de qualquer ação POST em `admin.php`, o auto-sync enviava TODOS os arquivos ao GitHub (um blob por chamada, ~46 arquivos) dentro do mesmo pedido: passava de 60 s e o nginx devolvia 504 (a ação em si já tinha sido gravada). Agora: (1) `sincronizar_para_github()` (`inc/atualizar.php`) lê a tree do ramo e só envia os arquivos cujo SHA git mudou (nada mudou = sem commit); (2) a sincronização roda DEPOIS de a página ser entregue (`fastcgi_finish_request()` no fim de `admin.php`, `$sincronizarDepois`); (3) `salvar_tema` não sincroniza. O botão manual "Sincronizar Hostinger → GitHub" continua síncrono (agora rápido).

**Planejamento — Eclusa (Vigas e Joists) em unidades:** no Planejamento (`maciel/planos.js`) o item "ECLUSA – VIGAS E JOISTS" deixou de ser % do BM: **contratado = 27 un** (catálogo do BM: instalação das vigas EJ-3.3.1-01 = 9 + instalação de joists EJ-3.3.1-03 = 18, `PL_ECLUSA_VJ_COD`) e **realizado = acumulado lançado** (EJ + CMM, desde o início) nas colunas de montagem de vigas e de joist da Eclusa (`plEclusaVJSerie()`; pré-montagem não entra). O plano e a Sugestão do cronograma passam a levar os 27 un; o que saiu antes do início do período (`r0`) conta como já feito: o previsto do plano distribui só o restante e as curvas somam `r0`. Planos salvos antes recalculam com 27 un ao abrir. Dashboard cliente e Gantt continuam com o avanço em % do BM (não foram alterados).

**Dashboard cliente — contrato editável; Impactos — serviço por empresa, cascata e ranking em dias úteis (2026-10-14):**
- **Contrato inline** na tabela "previsto × realizado" do Dashboard cliente (`data-ctr-chave`, handler em `app.js`): grava à parte em `sistema.contratos_cliente` (JSON `{ "frente|servico": qtd }`, rota `cliente-contrato` → `acao_cliente_contrato` em `api.php`; vem no modelo como `M.contratos_cliente`) e vale sobre o catálogo do BM em `clienteComFontes()` (também reflete no Avanço físico). Apagar o valor volta ao catálogo. NÃO mexe em `cliente.qtd` nem em `servicos.escopo`. Linha % (fechamento lateral – estrutura) não edita. Gantt não usa o override.
- **Serviço do impacto = serviço de cada empresa:** o formulário pede primeiro a(s) empresa(s) e o campo Serviço vira lista com SÓ os serviços cadastrados nas empresas marcadas (nome exato, sem maiúsculas forçadas; `preencherServicosImpacto`). Tabela e relatório mostram o nome exato.
- **Efeito cascata:** `impactoCascata(servico, frente)` em `maciel/planos_doc.js` — impacto numa atividade atinge as POSTERIORES do fluxo (ordem de `PLD_FLUXOS`; nos anexos só o mesmo anexo; ignora concluídas; Fase 1 e 2 rotuladas). Aparece na prévia do formulário, numa coluna da aba Impactos e no relatório (seção "Efeito cascata registrado": por etapa, início previsto → início empurrado pelos dias úteis do impacto).
- **Ranking em DIAS ÚTEIS (sem horas):** `diasUteisImpacto()` = remessa: dias úteis entre previsto e chegada; impacto lançado: "Tempo perdido" convertido (8 h = 1 dia útil, 1 semana = 5) ou, sem tempo, duração útil até a solução/referência. Ranking dos setores (impactos, dias úteis, atividades atingidas em cascata, em aberto, %) e das empresas (dias diretos + dias por cascata, uma vez por impacto, só para quem não foi atingida diretamente; "Todas / não informada" é balde e fica por último). Tabela de remessas do relatório: dias corridos e dias úteis (sem horas).

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
