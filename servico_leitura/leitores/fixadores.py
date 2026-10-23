"""Lista de fixadores (planilha ou CSV): geral e por tipo de joist; classifica tipo, diâmetro, comprimento e norma."""
import csv
import re

import openpyxl

from ._util import numero, texto

_DIAM = re.compile(r'[ØO∅]?\s*(\d+(?:[ ./]\d+/\d+|/\d+|\.\d+)?)\s*"', re.I)
_COMP = re.compile(r'\bX\s*(\d+(?:\s\d+/\d+|/\d+|[.,]\d+)?)\s*"', re.I)


def classificar(desc):
    d = texto(desc).upper()
    tipo = ("porca" if d.startswith("PORCA") else "arruela" if d.startswith("ARRUELA") else "hardbolt" if "HARDBOLT" in d else
            "autobrocante" if "AUTOBROC" in d else "chumbador" if "CHUMB" in d or "PARABOLT" in d else "parafuso" if d.startswith(("PARAF", "AB ")) else "outro")
    m = _DIAM.search(d)
    mc = _COMP.search(d)
    return {"tipo": tipo, "diametro": m.group(1).strip() if m else "", "comprimento_pol": mc.group(1).strip() if mc else ""}


def _linha(l, col):
    q = numero(l[col["qtd"]])
    desc = texto(l[col["desc"]])
    if q is None or not desc:
        return None
    r = {"qtd": q, "descricao": desc, "comprimento_mm": numero(l[col["comp"]]) if "comp" in col else None,
         "peso_unit_kg": numero(l[col["pu"]]) if "pu" in col else None, "peso_total_kg": numero(l[col["pt"]]) if "pt" in col else None,
         "norma": texto(l[col["mat"]]) if "mat" in col else "", "aplicacao": texto(l[col["apl"]]) if "apl" in col else ""}
    r.update(classificar(desc))
    return r


def _colunas(l):
    cel = [texto(c).upper() for c in l]
    if not ("QTD" in cel or "QTD." in cel) or not any(c.startswith("DESCRI") for c in cel):
        return None
    col = {"qtd": next(j for j, c in enumerate(cel) if c.startswith("QTD")), "desc": next(j for j, c in enumerate(cel) if c.startswith("DESCRI"))}
    for j, c in enumerate(cel):
        if c.startswith("COMP"):
            col["comp"] = j
        elif c.startswith("PESO UNIT"):
            col["pu"] = j
        elif c.startswith("PESO TOTAL"):
            col["pt"] = j
        elif c.startswith("MATERIAL"):
            col["mat"] = j
    if "mat" in col and col["mat"] + 1 < len(cel) and not cel[col["mat"] + 1]:
        col["apl"] = col["mat"] + 1
    return col


def _planilha(linhas):
    """Devolve (lista geral, blocos por joist)."""
    geral, blocos, atual, col = [], [], None, None
    for l in linhas:
        c = _colunas(l)
        if c:
            col = c
            continue
        cel = [texto(x) for x in l]
        titulo = next((x for x in cel if re.match(r"^JOIST\s*\d+", x, re.I)), None)
        if titulo:
            mult = re.search(r"\(\s*(\d+)\s*X\s*\)", titulo, re.I)
            atual = {"joist": re.match(r"^(JOIST\s*\d+)", titulo, re.I).group(1).upper().replace(" ", ""), "titulo": titulo, "quantidade_de_joists": int(mult.group(1)) if mult else 1, "itens": []}
            blocos.append(atual)
            continue
        if col is None:
            continue
        r = _linha(tuple(l) + (None,) * 14, col)
        if r:
            (atual["itens"] if atual else geral).append(r)
    return geral, blocos


def ler(caminho, nome_arquivo):
    ext = re.sub(r".*\.", "", nome_arquivo.lower())
    avisos = []
    geral, por_joist = [], []
    if ext in ("xlsx", "xlsm"):
        wb = openpyxl.load_workbook(caminho, data_only=True, read_only=True)
        for ws in wb.worksheets:
            g, b = _planilha([tuple(r) for r in ws.iter_rows(values_only=True, max_col=14)])
            geral += g
            por_joist += b
    elif ext == "csv":
        with open(caminho, newline="", encoding="utf-8-sig", errors="replace") as f:
            amostra = f.read(4096)
            f.seek(0)
            dial = csv.Sniffer().sniff(amostra, delimiters=";,\t") if amostra else csv.excel
            geral, por_joist = _planilha([tuple(r) for r in csv.reader(f, dial)])
    else:
        avisos.append("Lista de parafusos no formato .trb não é lida aqui: os parafusos do IFC (Bolts:On) e a lista em planilha são usados.")
    if not geral and not por_joist and ext != "trb":
        avisos.append("Não encontrei a tabela de fixadores (colunas Qtd e Descrição).")
    return {"geral": geral, "por_joist": por_joist, "avisos": avisos}


def _pol(txt):
    """'1"1/2' | '4.1/4"' | '1 1/2"' | '3/4"' -> polegadas (float)."""
    s = re.sub(r"(\d)\.(?=\d+/\d)", r"\1 ", txt.replace('"', " ")).strip()
    total = 0.0
    for t in s.split():
        try:
            if "/" in t:
                a, b = t.split("/")
                total += float(a) / float(b)
            else:
                total += float(t.replace(",", "."))
        except ValueError:
            return None
    return total or None


def chave(nome, norma=""):
    """Chave comparável entre o nome do IFC (PARAF_1/2"X1"1/2_A307) e o da lista (PARAF. Ø1/2" X 1 1/2" + norma A307)."""
    d = texto(nome).upper().replace("Ø", "").replace("∅", "")
    tipo = ("porca" if d.startswith("PORCA") else "arruela" if d.startswith("ARRUELA") else "parabolt" if "PARABOLT" in d else "hardbolt" if "HARDBOLT" in d else
            "ab" if re.match(r"^(PARAF\.?\s+)?AB\b", d) else "parafuso" if d.startswith("PARAF") else "")
    if not tipo:
        return ""
    if tipo == "hardbolt":
        m = re.search(r"M(\d+)\s*X\s*(\d+)", d)
        return "hardbolt|M%s|%s" % (m.group(1), m.group(2)) if m else ""
    m = re.search(r'(\d+/\d+|\d+)\s*"', d)
    diam = m.group(1) if m else ""
    comp = ""
    if tipo in ("parafuso", "parabolt", "ab"):
        mx = re.search(r'"\s*X\s*([0-9"./ ]+?)(?:_|\s*$|\s+[A-Z])', d[m.end() - 1:] if m else d)
        v = _pol(mx.group(1)) if mx else None
        comp = ("%g" % round(v, 3)) if v else ""
    n = re.sub(r"[\s._\-]", "", texto(norma).upper())
    if not n or n == "-":
        n = re.sub(r"[\s._\-]", "", d.rsplit("_", 1)[1]) if "_" in d else ""
    n = {"HEX": "", "LISA": "", "ABTCP3": "", "TCP3": ""}.get(n, n)
    if tipo in ("porca", "arruela", "ab", "parabolt"):
        n = ""
    return "|".join([tipo, diam, comp, n])
