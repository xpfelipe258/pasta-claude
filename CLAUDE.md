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

### 2026-10-09
**SESMT GERAL** (planilha "Gestão SST - Rótula" convertida para PHP):
- Arquivos novos: `maciel/sesmt.php`, `maciel/inc/sesmt_modelo.php`, `maciel/inc/sesmt_registros.php`, `ferramentas/teste_sesmt.py`
- Alterações em arquivos existentes (só acréscimos): módulo `sesmt` em `modulos_sistema()` (`inc/nucleo.php`) e grupo "SESMT GERAL" no menu (`inc/painel.html`)
- Colaboradores NÃO foram importados da planilha: são cadastrados no sistema, com coluna Empresa; as listas das caixas de seleção (fontes de dados) estão em `sesmt_listas`
- Dados pessoais e de saúde: acesso só para admin ou usuário liberado em SESMT GERAL → Acessos; CPF mascarado nas listas e no CSV
- Testes: `python ferramentas/teste_sesmt.py` (PHP + SQLite em pasta temporária, 36 testes)
**Cronograma (Gantt):** previsto do Telhar em m². A meta cadastrada (7 telhas/dia) era aplicada sobre a quantidade do catálogo do BM (m²). Em `clienteComContratoAtual()` (`maciel/app.js`), quando a quantidade vem do catálogo em m² e a meta não fecha com ela no prazo, a meta passa a ser m² ÷ dias úteis entre início planejado e prazo; o tooltip do Gantt mostra a unidade m².
**Cronograma (Gantt) — Telhar F1 e Eclusa:** datas padrão do Telhar F1 = 01/10 a 27/11/2026 (`GAN_AJUSTES_DATAS_PADRAO`, busca sem diferenciar maiúsculas/acentos). Eclusa deixou de ter o avanço suprimido: Vigas e Joists (BM 3.3.1, ponderado por peso), Calhas (3.4.10) e Telhas (3.4.1) usam as atividades do BM da própria Eclusa, em % (`ganBmAtividadesEspecificas`, `ganBmPercentual`). Fechamento ACM e Rufos seguem sem avanço.
**Dashboard cliente — fontes por coluna** (`CLIENTE_FONTES`, `clienteComFontes()` em `maciel/app.js`; vale também para Avanço físico, curva S e tiles): contrato = soma das atividades do catálogo do BM (Pré-montagem, Instalação de joist e Vigas = EJ + CMM do item 3.1.1, galpão inteiro na linha da Fase 1; Perfilagem, Instalação de telhas e Instalação das telhas do fechamento = catálogo da Globo em m²); Fech. Lateral – Estrutura = % de avanço, média das duas empresas (pesos do item 3.1.2); nomes = nomes do catálogo (só na tela, vínculo interno intacto); início/prazo = cronograma do cliente (igual ao Gantt); meta/dia = contrato ÷ dias úteis; realizado = maior entre Lançamentos e BM; situação = % do previsto no período (>=100% adiantado, 95-100% no limite, <95% atrasado). Botão admin "Consolidar cadastro com as fontes" grava esses valores em METAS CLIENTE (via rota `registro`) depois de mostrar antes/depois. Escopo por empresa (servicos.escopo) e IFC não foram apagados: outras telas dependem deles.
**Dashboard cliente — correção do Previsto período:** `prevPer` = previsto acumulado no fim do período − previsto acumulado na véspera (`prevCliente`), por item; antes era meta × todos os dias úteis do período, sem respeitar início/prazo/contrato (estourava o contrato e deixava tudo ATRASADO). Linhas da Fase 2 de serviços com catálogo (`CLIENTE_FONTES`) saem do dashboard (o catálogo cobre o galpão inteiro na linha da Fase 1; antes somavam 100%+76% e 12.083+806 m²). Fechamento lateral (estrutura e telhas) começa em 01/10/2026 (`GAN_AJUSTES_DATAS_PADRAO`, vale também no Gantt). ATENÇÃO: a rota `registro` copia `cliente.qtd` para `servicos.escopo` (grade por empresa, outra unidade) — por isso "Consolidar cadastro com as fontes" grava só meta/dia, início e prazo, nunca o contrato.
**Apontar montagem — vigas dos oitões:** eixos 01 e 20 têm 21 vigas (IFC, VIGA COBERTURA VC08–VC16), identificadas pelo trecho (`B-A1`...) em `regras_baixa.json` (`vigas_oitao` + `criterio_por_letra` com `oitao:true`); demais eixos seguem com 13 (letras A–H). Mapa, "Digitar vigas", quadrante e validação do servidor (`acao_apontamento` em `api.php`) tratam os dois casos; total 276 = 18×13 + 2×21. Kit de fixadores do oitão assumido como o da intermediária. Fechamento lateral dos oitões segue por faixa (7 células por oitão), pendente de definição do usuário.

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
