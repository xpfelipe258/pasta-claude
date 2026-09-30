# Obra 198 — Controle de Produção

Programa local que usa a planilha `PLANO_DE_PRODUCAO_198_POR_EMPRESA_V3.xlsm` como **fonte de dados e local de armazenamento**.
Tudo o que é lançado no sistema é gravado na própria planilha, e o que é alterado na planilha aparece no sistema em até 4 segundos.

## Como usar (Windows)

1. Instale o Python 3.10 ou superior em <https://www.python.org/downloads/> e marque **"Add python.exe to PATH"**.
2. Deixe a pasta `programa_obra198` **na mesma pasta da planilha** (ou dentro dela).
3. Dê dois cliques em **`INICIAR.bat`**. Na primeira vez, ele instala os componentes (precisa de internet).
4. O navegador abre em `http://localhost:8198`. Mantenha a janela preta aberta enquanto usar o sistema.

Para escolher outra planilha, informe o caminho em `config.json`, no campo `"planilha"`.

## Planilha de estoque (integração)

Se a planilha de estoque (a que tem as abas `Consumo_Joists` e `Controle_Materiais`) estiver na mesma pasta, o programa a encontra sozinho. Para indicar outro local, use o campo `"planilha_estoque"` do `config.json`.

Ela é **somente lida**, nunca alterada: o programa usa os valores que a própria planilha calculou na última vez que foi salva no Excel (rode as macros e salve para atualizar). Na aba **Estoque** aparecem:

- quantas joists o material em obra permite premontar e montar (e o item limitante), comparadas com a meta restante da semana e com a meta da próxima;
- cada componente (banzos, diagonais, reforços, travamentos, fixadores) com consumo por joist, necessidade da semana e cobertura em joists;
- fixadores de montagem dos quadrantes e inventário físico × virtual (acuracidade).

Faltas também aparecem nos pontos de atenção do Painel e do Dashboard do cliente.

## Atualização automática (configuração única)

Toda vez que o `INICIAR.bat` abre, o programa verifica o GitHub e, se houver versão nova, atualiza os próprios arquivos e reinicia sozinho. A planilha, os backups e o `config.json` nunca são alterados.

Como o repositório é privado, é preciso um token de leitura (uma vez só):

1. Em github.com, entre em **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. Em **Repository access**, escolha **Only select repositories** e marque `pasta-claude`.
3. Em **Permissions → Repository permissions → Contents**, escolha **Read-only**. Gere e copie o token.
4. Na primeira vez que abrir o `INICIAR.bat` com esta versão, cole o token quando ele pedir. Ele fica gravado no `config.json`, na seção `"atualizacao"`.

**Em tempo real, sem fechar o programa:** com o programa aberto ele volta a conferir o GitHub sozinho (a cada 1 minuto com token, 3 minutos sem). Quando sai versão nova:

- mudança só de tela: a página aberta se recarrega sozinha em poucos segundos;
- mudança de regras ou do programa: o servidor reinicia sozinho (a janela do `INICIAR.bat` continua aberta) e a página volta já na versão nova, sem abrir outra aba.

Se houver alterações ainda não salvas na tela, ela só recarrega depois que você salvar ou descartar. O intervalo pode ser mudado em `config.json`, em `"atualizacao"`, com `"intervalo_segundos"` (mínimo 30).

Sem internet, o programa segue normalmente com a versão atual.

## Levar os dados para o sistema online

No topo da tela, clique em **Exportar dados para o sistema online**. O arquivo `obra198_dados.json` é enviado em **Administração → Importar dados** do sistema PHP.

## Telas

| Tela | O que faz | Onde grava na planilha |
|---|---|---|
| Painel | KPIs, farol por serviço e pontos de atenção para o período escolhido (data início e data fim) | leitura |
| Programação semanal | Meta × realizado dia a dia e o que está planejado para a semana | leitura |
| Lançamentos | Grade editável por empresa e dia, com todos os serviços e o nº do RDO. O modo **Por serviço (BM)** mostra uma linha por atividade do boletim de medição | abas CONTROLE EJ / CMM / GLOBO AÇOS e BM APONTAMENTO |
| Avanço físico | Escopo, acumulado, ritmo e projeção de término versus prazo | leitura |
| Dashboard cliente | Avanço ponderado, curva S, previsto do cliente × realizado por serviço e frente, insights e resumo para enviar | leitura |
| Estoque | Saldo de cada material × necessidade da meta desta semana e da próxima, sugestão de compra | ESTOQUE MATERIAIS e MOVIMENTAÇÃO ESTOQUE |
| Equipamentos | Custo de equipamentos e combustível por empresa, por equipamento e por semana | CADASTRO EQUIPAMENTOS e USO EQUIPAMENTOS |
| Medição (BM) | Boletim por empresa: avanço por item e atividade, valores nos contratos QPC e RÓTULA, deduções de equipamento e combustível, valor a faturar e evolução. Também cadastra períodos (cortes), deduções manuais e o catálogo de atividades | BM ATIVIDADES, BM PERÍODOS, BM APONTAMENTO e BM DEDUÇÕES |
| Metas | Meta/dia, dias úteis e GAP por semana, com opção de aplicar às semanas seguintes | METAS EMPRESAS (F, G e I) |
| Impactos | Registrar, editar, solucionar e excluir impactos | LISTA DE IMPACTO |
| Tendências | Para o serviço escolhido, compara as empresas semana a semana e no período | leitura |

A barra **Data início / Data fim** aparece no Painel, Dashboard cliente, Equipamentos e Tendências. Os resultados são apurados até a data de referência do topo.

### Abas criadas pelo programa

Na primeira execução, o programa cria 4 abas no final da planilha: `ESTOQUE MATERIAIS`, `MOVIMENTAÇÃO ESTOQUE`, `CADASTRO EQUIPAMENTOS` e `USO EQUIPAMENTOS`. Elas podem ser preenchidas pelo sistema ou direto no Excel (dados a partir da linha 3).

**Estoque:** cadastre cada material com o serviço que o consome e o consumo por unidade (ex.: 8 parafusos por joist içado, 1,05 m² de telha por m² telhado). O saldo desconta automaticamente o consumo pela produção lançada a partir da data do saldo inicial (considerada no início do dia).

**Equipamentos:** o botão **Importar abas mensais** traz os registros das abas `USO DE EQUIPAMENTO <MÊS>` (diárias e abastecimentos) sem duplicar o que já foi importado. Use EJ/CMM na empresa quando o custo for dividido.

## Segurança dos dados

- **Feche a planilha no Excel antes de salvar pelo sistema.** Com ela aberta, o Windows bloqueia o arquivo e o sistema avisa sem gravar nada.
- Antes de cada gravação, é feita uma cópia em `backups_obra198/` (as 40 mais recentes ficam guardadas).
- O sistema altera somente as células de lançamento. Células com fórmula são protegidas e nunca são sobrescritas. Macros, gráficos e formatação são preservados.
- Ao abrir a planilha no Excel depois de lançar pelo sistema, as fórmulas são recalculadas automaticamente.

## Usar pela equipe na rede da obra

Em `config.json`, mude `"acesso_rede"` para `true` e reinicie. Os outros computadores ou celulares da mesma rede acessam por `http://IP-DESTE-COMPUTADOR:8198`.
Não há senha: habilite somente em redes internas confiáveis.
