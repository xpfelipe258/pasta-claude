"""Apoio para localizar a linha de cabeçalho e as colunas de uma planilha, sem depender do layout exato."""
import re
import unicodedata


def norm(v):
    s = "" if v is None else str(v)
    s = unicodedata.normalize("NFD", s).encode("ascii", "ignore").decode().lower()
    return re.sub(r"\s+", " ", s).strip()


def acha_colunas(linha, chaves):
    """chaves: {nome: [padrões regex]}. Devolve {nome: índice} só para as que aparecem na linha."""
    achou = {}
    for i, cel in enumerate(linha):
        t = norm(cel)
        if not t:
            continue
        for nome, pads in chaves.items():
            if nome not in achou and any(re.search(p, t) for p in pads):
                achou[nome] = i
    return achou


def acha_cabecalho(linhas, chaves, obrigatorias, limite=40):
    """Primeira linha (nas `limite` primeiras) que tem todas as colunas obrigatórias. Devolve (índice, colunas) ou (None, {})."""
    for n, linha in enumerate(linhas):
        if n >= limite:
            break
        cols = acha_colunas(linha, chaves)
        if all(k in cols for k in obrigatorias):
            return n, cols
    return None, {}


def numero(v):
    if isinstance(v, (int, float)):
        return float(v)
    t = str(v or "").strip().replace("R$", "").replace(" ", "")
    if not t:
        return None
    if "," in t:
        t = t.replace(".", "").replace(",", ".")
    try:
        return float(t)
    except ValueError:
        return None
