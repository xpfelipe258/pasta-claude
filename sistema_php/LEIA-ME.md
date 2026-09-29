# Obra 198 — Sistema online (PHP 7.4+)

Mesmas telas do programa local, acessíveis pelo navegador e pelo celular, com login e banco de dados.

## Instalação na hospedagem

1. No painel da hospedagem, crie um **banco MySQL** e anote: servidor (geralmente `localhost`), nome do banco, usuário e senha.
2. Envie **todo o conteúdo desta pasta** (`sistema_php`) para a pasta pública do site (`public_html` ou uma subpasta, ex.: `public_html/obra198`), pelo Gerenciador de Arquivos ou FTP. Inclua os arquivos ocultos `.htaccess`.
3. Acesse `https://seu-dominio/instalar.php` (ou `/obra198/instalar.php`) e preencha:
   - dados do MySQL (ou escolha SQLite, que dispensa o banco);
   - nome da obra, seu login e uma senha com pelo menos 8 caracteres;
   - token de leitura do GitHub (opcional, para atualizar pelo painel).
4. A instalação carrega automaticamente os dados da planilha (produção, metas, cliente, impactos e equipamentos).
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

- Para levar os dados da planilha para o sistema: no programa local, clique em **Exportar dados para o sistema online** e envie o arquivo em **Administração → Importar dados** (substitui os dados da obra, mantém os usuários).
- **Baixar backup completo (JSON)** gera uma cópia de todos os dados; guarde periodicamente.

## Atualização

Com o token configurado, **Administração → Buscar atualização no GitHub** baixa a versão nova do sistema. A configuração (`inc/config.php`) e o banco (`dados/`) nunca são alterados.
