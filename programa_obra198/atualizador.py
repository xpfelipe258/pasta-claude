"""Atualização automática do programa a partir do repositório no GitHub.

Baixa somente a pasta do programa; nunca altera a planilha, os backups nem o config.json.
"""
import io
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
import zipfile

PROTEGIDOS = {"config.json", ".instalado", ".versao"}
PADRAO = {"ativo": True, "repositorio": "xpfelipe258/pasta-claude",
          "ramo": "claude/brave-bardeen-jyxlhm", "pasta": "programa_obra198", "token": ""}


def _get(url, token, bruto=False):
    req = urllib.request.Request(url, headers={"User-Agent": "obra198-atualizador",
                                               "Accept": "application/vnd.github+json"})
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(req, timeout=20) as r:
        dados = r.read()
    return dados if bruto else json.loads(dados)


def aplicar_pacote(conteudo_zip, pasta_repo, destino):
    """Copia os arquivos de <raiz>/<pasta_repo>/ do zip para destino. Devolve os arquivos alterados."""
    alterados = []
    with zipfile.ZipFile(io.BytesIO(conteudo_zip)) as z:
        for info in z.infolist():
            partes = info.filename.split("/", 1)
            if len(partes) < 2 or info.is_dir():
                continue
            rel = partes[1]
            if not rel.startswith(pasta_repo + "/"):
                continue
            rel = rel[len(pasta_repo) + 1:]
            if not rel or rel in PROTEGIDOS or rel.startswith("backups_obra198/") or ".." in rel.split("/"):
                continue
            alvo = os.path.join(destino, *rel.split("/"))
            novo = z.read(info)
            if os.path.exists(alvo):
                with open(alvo, "rb") as f:
                    if f.read() == novo:
                        continue
            os.makedirs(os.path.dirname(alvo), exist_ok=True)
            tmp = alvo + ".novo"
            with open(tmp, "wb") as f:
                f.write(novo)
            os.replace(tmp, alvo)
            alterados.append(rel)
    return alterados


def atualizar(base, cfg_at):
    """Devolve True se o código foi atualizado (o programa deve reiniciar)."""
    at = dict(PADRAO)
    at.update(cfg_at or {})
    if not at.get("ativo") or not at.get("repositorio"):
        return False
    arq_versao = os.path.join(base, ".versao")
    atual = open(arq_versao).read().strip() if os.path.exists(arq_versao) else ""
    api = f"https://api.github.com/repos/{at['repositorio']}"
    try:
        sha = _get(f"{api}/commits/{at['ramo']}", at["token"])["sha"]
        if sha == atual:
            print(" Programa atualizado (versão " + sha[:7] + ").")
            return False
        print(" Nova versão encontrada. Baixando atualização...")
        pacote = _get(f"{api}/zipball/{sha}", at["token"], bruto=True)
    except urllib.error.HTTPError as e:
        if e.code in (401, 403, 404):
            print(" Atualização automática: acesso negado ao repositório. Confira o token em config.json.")
        else:
            print(f" Atualização automática indisponível agora (HTTP {e.code}). Seguindo com a versão atual.")
        return False
    except Exception as e:
        print(f" Sem conexão para verificar atualizações ({e.__class__.__name__}). Seguindo com a versão atual.")
        return False
    alterados = aplicar_pacote(pacote, at["pasta"], base)
    with open(arq_versao, "w") as f:
        f.write(sha)
    if "requirements.txt" in alterados:
        subprocess.call([sys.executable, "-m", "pip", "install", "--quiet", "--disable-pip-version-check",
                         "-r", os.path.join(base, "requirements.txt")])
    print(f" Atualização aplicada ({len(alterados)} arquivo(s)). Reiniciando...")
    return bool(alterados)


def configurar_token(caminho_config, cfg_arquivo):
    """Na primeira execução, pergunta o token do GitHub e grava em config.json."""
    if "atualizacao" in cfg_arquivo or not sys.stdin or not sys.stdin.isatty():
        return cfg_arquivo
    print("-" * 60)
    print(" ATUALIZAÇÃO AUTOMÁTICA (configuração única)")
    print(" Cole o token de leitura do GitHub e pressione Enter.")
    print(" Para pular, apenas pressione Enter (dá para configurar depois no config.json).")
    try:
        token = input(" Token: ").strip()
    except EOFError:
        token = ""
    at = dict(PADRAO)
    at["token"] = token
    at["ativo"] = bool(token)
    cfg_arquivo["atualizacao"] = at
    with open(caminho_config, "w", encoding="utf-8") as f:
        json.dump(cfg_arquivo, f, ensure_ascii=False, indent=2)
    print("-" * 60)
    return cfg_arquivo
