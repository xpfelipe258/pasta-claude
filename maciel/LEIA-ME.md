# Obra 198 — Sistema online (PHP 7.4+)

## Versão multiobras

Esta edição transforma o sistema em uma central multiobras. O login abre a Central de Obras; somente depois de escolher uma obra são carregados produção, planejamento, estoque, equipamentos, medições, impactos e histórico daquele projeto.

- Os dados já existentes são preservados e associados automaticamente à primeira obra.
- Novas obras começam vazias; opcionalmente é possível copiar apenas empresas e serviços da obra atualmente aberta.
- Administradores personalizam nome, cores e logo do sistema principal e de cada obra.
- Editores e leitores podem receber acesso a obras específicas.
- A migração do banco ocorre no primeiro acesso. O arquivo protegido `inc/migracao_multiobras.sql` existe apenas como referência ou alternativa manual.
- As sessões ficam em `dados/sessoes`, corrigindo hospedagens cPanel cujo caminho global de sessões está ausente.

Antes de atualizar a hospedagem, faça backup do banco e de `inc/config.php`. Envie todos os arquivos, incluindo `.htaccess`, e então acesse `login.php` normalmente.

Mesmas telas do programa local, acessíveis pelo navegador e pelo celular, com login e banco de dados.

## Instalação na hospedagem

1. No painel da hospedagem, crie um **banco MySQL** e anote: servidor (geralmente `localhost`), nome do banco, usuário e senha.
2. Envie **todo o conteúdo desta pasta** (`sistema_php`) para a pasta pública do site (`public_html` ou uma subpasta, ex.: `public_html/obra198`), pelo Gerenciador de Arquivos ou FTP. Inclua os arquivos ocultos `.htaccess`.
3. Acesse `https://seu-dominio/instalar.php` (ou `/obra198/instalar.php`) e preencha:
   - dados do MySQL (ou escolha SQLite, que dispensa o banco);
   - nome da obra, seu login e uma senha com pelo menos 8 caracteres;
   - token de leitura do GitHub (opcional, para atualizar pelo painel).
4. A instalação carrega automaticamente os dados da planilha: produção, metas, cliente, impactos, equipamentos, medição (BM),
   apontamento de montagem e todo o estoque (materiais, remessas, consumo físico e inventário).
5. Apague o arquivo `instalar.php` da hospedagem.

Requisitos: PHP 7.4 ou superior com as extensões `pdo_mysql` (ou `pdo_sqlite`), `mbstring`, `json` e, para atualizar pelo GitHub, `zip` e `curl`. Use HTTPS no domínio.

## Usuários e permissões

Em **Administração** (link no topo, só para administradores):

| Perfil | Pode |
|---|---|
| Admin | tudo, inclusive usuários, importação, backup e atualização |
| Editor | lançar produção, metas, impactos, estoque e equipamentos |
| Leitura | apenas consultar (ideal para o cliente ou a diretoria) |

Um usuário com **empresa** definida (ex.: EJ) só consegue lançar produção dessa empresa: o encarregado de cada subempreiteira lança a sua própria produção pelo celular.

Todas as alterações ficam registradas no **Histórico** (quem, quando e o quê).

## Planilha × sistema online

- Para levar os dados da planilha para o sistema: no programa local, clique em **Exportar dados para o sistema online** e envie o arquivo em **Administração → Importar dados** (substitui os dados da obra, mantém os usuários). O arquivo leva junto o estoque da planilha e os apontamentos de montagem.
- O caminho é de mão única: a planilha alimenta o sistema online, e o que for lançado online fica só no sistema.
- **Baixar backup completo (JSON)** gera uma cópia de todos os dados; guarde periodicamente.

## O que funciona online

Todas as abas do programa local funcionam no sistema online, com os mesmos cálculos:

| Área | Abas |
|---|---|
| Produção | Painel, Programação semanal, Lançamentos, Apontar montagem (mapa das 43 joists por rua e das vigas), Avanço físico, Cronograma (Gantt), Dashboard cliente, Tendências |
| Suprimentos | Materiais, Remessas, Consumo físico, Inventário, Fixadores críticos, Baixa automática |
| Consumo | Equipamentos |
| Financeiro | Medição (BM) |
| KPI e Gestão | Visão geral, Metas, Impactos |

Só duas coisas são exclusivas do programa local, por dependerem da planilha: **importar as abas mensais de equipamento** e
**exportar os dados**. O resto grava direto no banco, dentro de uma transação (nada é salvo pela metade).

## Atualização

Com o token configurado, **Administração → Buscar atualização no GitHub** baixa a versão nova do sistema. A configuração (`inc/config.php`) e o banco (`dados/`) nunca são alterados.
