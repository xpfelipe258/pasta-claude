# Obra 198 — Controle de Produção

Programa local que usa a planilha `PLANO_DE_PRODUCAO_198_POR_EMPRESA_V3.xlsm` como **fonte de dados e local de armazenamento**.
Tudo o que é lançado no sistema é gravado na própria planilha, e o que é alterado na planilha aparece no sistema em até 4 segundos.

## Como usar (Windows)

1. Instale o Python 3.10 ou superior em <https://www.python.org/downloads/> e marque **"Add python.exe to PATH"**.
2. Deixe a pasta `programa_obra198` **na mesma pasta da planilha** (ou dentro dela).
3. Dê dois cliques em **`INICIAR.bat`**. Na primeira vez, ele instala os componentes (precisa de internet).
4. O navegador abre em `http://localhost:8198`. Mantenha a janela preta aberta enquanto usar o sistema.

Para escolher outra planilha, informe o caminho em `config.json`, no campo `"planilha"`.

## Telas

| Tela | O que faz | Onde grava na planilha |
|---|---|---|
| Painel | KPIs da semana, farol por serviço, pontos de atenção | leitura |
| Programação semanal | Meta × realizado dia a dia e o que está planejado para a semana | leitura |
| Lançamentos | Grade editável por empresa e dia, com todos os serviços e o nº do RDO | abas CONTROLE EJ / CMM / GLOBO AÇOS |
| Avanço físico | Escopo, acumulado, ritmo e projeção de término versus prazo | leitura |
| Metas | Meta/dia, dias úteis e GAP por semana, com opção de aplicar às semanas seguintes | METAS EMPRESAS (F, G e I) |
| Impactos | Registrar, editar, solucionar e excluir impactos | LISTA DE IMPACTO |
| Tendências | Atingimento semanal por empresa e produção × meta por serviço | leitura |

## Segurança dos dados

- **Feche a planilha no Excel antes de salvar pelo sistema.** Com ela aberta, o Windows bloqueia o arquivo e o sistema avisa sem gravar nada.
- Antes de cada gravação, é feita uma cópia em `backups_obra198/` (as 40 mais recentes ficam guardadas).
- O sistema altera somente as células de lançamento. Células com fórmula são protegidas e nunca são sobrescritas. Macros, gráficos e formatação são preservados.
- Ao abrir a planilha no Excel depois de lançar pelo sistema, as fórmulas são recalculadas automaticamente.

## Usar pela equipe na rede da obra

Em `config.json`, mude `"acesso_rede"` para `true` e reinicie. Os outros computadores ou celulares da mesma rede acessam por `http://IP-DESTE-COMPUTADOR:8198`.
Não há senha: habilite somente em redes internas confiáveis.
