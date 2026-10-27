#!/usr/bin/env bash
# Registra os commits do repositório num bloco de notas (.txt) na Hostinger:
# código do commit, data e hora (Brasília) e mensagem. Só acrescenta o que ainda
# não está no arquivo (confere pelo código), então pode rodar quantas vezes quiser.
#
# Arquivo no servidor: solucoes/obras/dados_obras/registro_commits.txt
#   - fica em dados_obras/, pasta fechada pelo .htaccess (não abre pelo navegador)
#   - não entra na sincronização Hostinger -> GitHub (dados_obras/ é excluída)
#
# Uso: BASE=... AUTH=... REST=... ferramentas/registrar_commits_hostinger.sh [rev]
#   BASE = url devolvida por hosting_files_generate-upload-url, sem "/api/tus/public_html"
#   AUTH = auth_key    REST = rest_auth_key
#   rev  = ponto de partida (padrão: HEAD)
set -euo pipefail

: "${BASE:?defina BASE}" "${AUTH:?defina AUTH}" "${REST:?defina REST}"
REV="${1:-HEAD}"
ALVO="solucoes/obras/dados_obras/registro_commits.txt"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cabecalho() {
  printf 'REGISTRO DE COMMITS - Gestao de Obras (xpfelipe258/pasta-claude)\r\n'
  printf 'Formato: data hora (Brasilia) | codigo do commit | mensagem\r\n'
  printf -- '------------------------------------------------------------\r\n'
}

# 1) baixa o registro atual (404 = ainda não existe)
code=$(curl -s -m 60 -o "$TMP/atual.txt" -w '%{http_code}' \
  -H "X-Auth: $AUTH" -H "X-Auth-Rest: $REST" "$BASE/api/raw/public_html/$ALVO" || true)
[ "$code" = 200 ] || { cabecalho > "$TMP/atual.txt"; }

# 2) acrescenta os commits que faltam, do mais antigo para o mais novo
novos=0
while IFS=$'\t' read -r hash ts msg; do
  grep -q -F "| $hash |" "$TMP/atual.txt" && continue
  quando=$(TZ=America/Sao_Paulo date -d "@$ts" '+%Y-%m-%d %H:%M:%S')
  printf '%s | %s | %s\r\n' "$quando" "$hash" "$msg" >> "$TMP/atual.txt"
  novos=$((novos + 1))
done < <(git log --reverse --format='%h%x09%ct%x09%s' "$REV")

if [ "$novos" -eq 0 ]; then echo "Registro já está em dia (nenhum commit novo)."; exit 0; fi

# 3) envia (TUS: cria e depois grava o conteúdo, substituindo o arquivo)
tam=$(stat -c%s "$TMP/atual.txt")
c1=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/tus/public_html/$ALVO?override=true" \
  -H "X-Auth: $AUTH" -H "X-Auth-Rest: $REST" -H "Tus-Resumable: 1.0.0" \
  -H "Upload-Length: $tam" -H "Upload-Offset: 0")
c2=$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "$BASE/api/tus/public_html/$ALVO?override=true" \
  -H "X-Auth: $AUTH" -H "X-Auth-Rest: $REST" -H "Tus-Resumable: 1.0.0" \
  -H "Content-Type: application/offset+octet-stream" -H "Upload-Offset: 0" \
  --data-binary "@$TMP/atual.txt")
[ "$c1" = 201 ] && [ "$c2" = 204 ] || { echo "Falha no envio (POST=$c1 PATCH=$c2)"; exit 1; }
echo "Registro atualizado: $novos commit(s) acrescentado(s) em $ALVO"
