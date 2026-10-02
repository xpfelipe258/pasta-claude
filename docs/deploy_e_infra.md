# Deploy e infraestrutura

Registro de como o sistema chega ao servidor, para não repetir a investigação.

## Deploy automático (ativo)

A Hostinger faz deploy a cada push:

| item | valor |
|---|---|
| repositório | `xpfelipe258/pasta-claude` (privado) |
| ramo | `claude/brave-bardeen-jyxlhm` |
| destino | `public_html/claude/` |
| ativo | sim |

A pasta `maciel/` do repositório vira `public_html/claude/maciel/` no servidor.

## O que NÃO vai pelo git

`maciel/inc/config.php` é ignorado por `maciel/inc/.gitignore`, de propósito:
contém a senha do MySQL. Ele existe só no servidor e sobrevive aos deploys.
A senha fica no painel da Hostinger e no próprio arquivo — nunca no repositório.

Idem `maciel/dados/`: sessões e dados de execução não são versionados.

## Banco

- banco e usuário: `u502500687_maciel`
- host: `localhost` (o app roda no mesmo servidor)
- a Hostinger exige senha com maiúscula e minúscula; senhas só-minúsculas
  são recusadas pela API e nunca chegam a ser aplicadas

## Atualizador interno: desativado

`inc/atualizar.php` tem a função `atualizar_pelo_github()`, mas `admin.php:79`
bloqueia a ação com "Atualização automática pausada nesta edição multiobras".
Usar o deploy automático acima, não essa função.

## Instalador: destrutivo

`instalar.php` chama `importar_pacote()`, que roda `DELETE FROM` em todas as
tabelas da obra antes de recarregar o seed (`inc/modelo.php:363`).
Nunca rodar em banco com dados reais.

## Cache do navegador

`inc/painel.html` carrega `app.js` sem query string. Sem versionamento, o
navegador serve a cópia antiga indefinidamente e qualquer alteração no JS
fica invisível.

`index.php` resolve anexando `?v=<filemtime>` ao `app.js`. Não fazer o mesmo
com `chart.umd.js`: a linha que injeta `API_BASE`, `CSRF_TOKEN` e
`OBRA_ATUAL` procura pela tag exata `<script src="chart.umd.js"></script>`,
e versioná-la quebra a injeção — o app sobe sem token e sem endpoint.

Ao conferir se um deploy chegou, comparar o tamanho do arquivo no servidor
com o local (listagem de arquivos da API da Hostinger) em vez de confiar no
que o navegador mostra.
