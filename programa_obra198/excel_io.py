"""Leitura e gravação da planilha de produção.

Leitura: openpyxl (somente leitura, não altera o arquivo).
Gravação: edição cirúrgica do XML das células alteradas dentro do .xlsm,
preservando macros, gráficos, formatação e todas as demais abas.
"""
import datetime as dt
import os
import re
import shutil
import tempfile
import zipfile

import openpyxl
from lxml import etree

NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NS_PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships"

ABA_CONSOLIDADO = "CONTROLE PRODUÇÃO POR EMPRESAS"
ABA_METAS = "METAS EMPRESAS"
ABA_CLIENTE = "METAS CLIENTE"
ABA_ESCOPO = "ESCOPO POR EMPRESA"
ABA_IMPACTO = "LISTA DE IMPACTO"
ABA_PAINEL = "PAINEL KPI"
ABAS_IGNORADAS = {ABA_CONSOLIDADO, "CONTROLE KPI"}

LINHA_INICIO_DADOS = 8
LINHA_FIM_DADOS = 364
LINHA_INICIO_METAS = 17
LINHAS_IMPACTO = range(5, 35)
EXCEL_EPOCH = dt.date(1899, 12, 30)


class PlanilhaBloqueada(Exception):
    pass


class CelulaProtegida(Exception):
    pass


# ---------------------------------------------------------------- utilidades

def col_letra(n):
    s = ""
    while n:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s


def col_numero(letras):
    n = 0
    for ch in letras:
        n = n * 26 + ord(ch) - 64
    return n


def separa_ref(ref):
    m = re.match(r"([A-Z]+)(\d+)$", ref)
    return m.group(1), int(m.group(2))


def iso(v):
    if isinstance(v, dt.datetime):
        return v.date().isoformat()
    if isinstance(v, dt.date):
        return v.isoformat()
    return None


def numero(v):
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return v
    if isinstance(v, str):
        t = v.strip().replace(",", ".")
        try:
            return float(t) if t else None
        except ValueError:
            return None
    return None


def eh_formula(v):
    return isinstance(v, str) and v.startswith("=")


# ------------------------------------------------------------------- leitura

def _linhas(ws, max_col=None):
    return [list(r) for r in ws.iter_rows(values_only=True, max_col=max_col)]


def _cel(linhas, linha, col):
    """linha/col 1-based; devolve None fora dos limites."""
    if linha - 1 >= len(linhas):
        return None
    r = linhas[linha - 1]
    return r[col - 1] if col - 1 < len(r) else None


def _avaliar_escopo(escopo, cliente, ref):
    """Avalia a célula de ESCOPO POR EMPRESA sem depender do cache do Excel."""
    m = re.match(r"([A-Z]+)(\d+)$", ref)
    if not m:
        return None
    col, lin = m.group(1), int(m.group(2))

    def qtd_cliente(l):
        return numero(_cel(cliente, l, 2))

    def valor(c, l, prof=0):
        if prof > 5:
            return None
        v = _cel(escopo, l, col_numero(c))
        if not eh_formula(v):
            return numero(v)
        f = v.replace(" ", "")
        if "'METASCLIENTE'!B" in f.replace(" ", ""):
            return qtd_cliente(l)
        if "ROUNDUP" in f:
            d = valor("D", l, prof + 1)
            return None if d is None else -(-d // 2)
        if "-N(E" in f:
            d = valor("D", l, prof + 1)
            e = valor("E", l, prof + 1) or 0
            return None if d is None else d - e
        mm = re.match(r"=([A-Z]+)(\d+)$", f)
        if mm:
            return valor(mm.group(1), int(mm.group(2)), prof + 1)
        return None

    return valor(col, lin)


def ler_planilha(caminho):
    wb = openpyxl.load_workbook(caminho, read_only=True, keep_vba=False)
    try:
        return _montar_modelo(wb)
    finally:
        wb.close()


def _montar_modelo(wb):
    cons = _linhas(wb[ABA_CONSOLIDADO], max_col=1)
    datas = {}
    for i in range(6, len(cons) + 1):
        d = iso(_cel(cons, i, 1))
        if d:
            datas[i + 2] = d  # linha na aba da empresa = linha do consolidado + 2

    escopo = _linhas(wb[ABA_ESCOPO], max_col=10)
    cliente = _linhas(wb[ABA_CLIENTE], max_col=14)

    empresas = []
    for ws in wb.worksheets:
        if not ws.title.startswith("CONTROLE ") or ws.title in ABAS_IGNORADAS:
            continue
        linhas = _linhas(ws)
        cab = linhas[6] if len(linhas) > 6 else []
        servicos, col_obs, frente = [], None, ""
        for c in range(2, len(cab) + 1):
            nome = _cel(linhas, 7, c)
            if nome is None:
                continue
            if str(nome).upper().startswith("OBSERVA"):
                col_obs = c
                break
            frente = _cel(linhas, 2, c) or frente
            ref_escopo = _cel(linhas, 4, c)
            qtd = None
            m = re.search(r"'ESCOPO POR EMPRESA'!([A-Z]+\d+)", str(ref_escopo or ""))
            if m:
                qtd = _avaliar_escopo(escopo, cliente, m.group(1))
            elif not eh_formula(ref_escopo):
                qtd = numero(ref_escopo)
            servicos.append({
                "col": col_letra(c),
                "nome": str(nome).strip(),
                "frente": str(frente).strip(),
                "id": str(_cel(linhas, 3, c) or "").strip(),
                "escopo": qtd,
            })

        registros = {}
        for lin, data in datas.items():
            if lin > LINHA_FIM_DADOS:
                continue
            vals = {}
            for s in servicos:
                v = _cel(linhas, lin, col_numero(s["col"]))
                if v is not None and v != "":
                    vals[s["col"]] = v if isinstance(v, (int, float)) else str(v)
            obs = _cel(linhas, lin, col_obs) if col_obs else None
            if vals or obs:
                reg = {"v": vals}
                if obs:
                    reg["obs"] = str(obs)
                registros[data] = reg

        empresas.append({
            "aba": ws.title,
            "nome": ws.title[len("CONTROLE "):],
            "servicos": servicos,
            "col_obs": col_letra(col_obs) if col_obs else None,
            "registros": registros,
        })

    return {
        "datas": sorted(datas.values()),
        "linhas_por_data": {d: l for l, d in datas.items()},
        "empresas": empresas,
        "metas": _ler_metas(wb[ABA_METAS]),
        "cliente": _ler_cliente(cliente),
        "impactos": _ler_impactos(wb[ABA_IMPACTO]),
        "referencia": iso(wb[ABA_PAINEL]["B3"].value) if ABA_PAINEL in wb.sheetnames else None,
    }


def _ler_metas(ws):
    linhas = _linhas(ws, max_col=14)
    metas = []
    for lin in range(LINHA_INICIO_METAS, len(linhas) + 1):
        emp = _cel(linhas, lin, 1)
        ini = iso(_cel(linhas, lin, 3))
        if not emp or not ini:
            continue
        real = _cel(linhas, lin, 12)
        metas.append({
            "linha": lin,
            "empresa": str(emp).strip(),
            "servico": str(_cel(linhas, lin, 2) or "").strip(),
            "inicio": ini,
            "fim": iso(_cel(linhas, lin, 4)) or ini,
            "corte": iso(_cel(linhas, lin, 5)),
            "meta_dia": numero(_cel(linhas, lin, 6)) or 0,
            "du": numero(_cel(linhas, lin, 7)) or 0,
            "gap": numero(_cel(linhas, lin, 9)) or 0,
            "realizado_manual": not eh_formula(real),
        })
    return metas


def _ler_cliente(linhas):
    itens = []
    for lin in range(5, len(linhas) + 1):
        serv = _cel(linhas, lin, 1)
        if not serv or eh_formula(serv):
            continue
        itens.append({
            "linha": lin,
            "servico": str(serv).strip(),
            "qtd": numero(_cel(linhas, lin, 2)),
            "inicio_plan": iso(_cel(linhas, lin, 3)),
            "meta_dia": numero(_cel(linhas, lin, 5)),
            "du_semana": numero(_cel(linhas, lin, 6)),
            "responsavel": _cel(linhas, lin, 9),
            "obs": _cel(linhas, lin, 10),
            "prazo": iso(_cel(linhas, lin, 13)),
            "frente": None if eh_formula(_cel(linhas, lin, 14)) else _cel(linhas, lin, 14),
        })
    return itens


def _ler_impactos(ws):
    linhas = _linhas(ws, max_col=8)
    itens = []
    for lin in LINHAS_IMPACTO:
        vals = [_cel(linhas, lin, c) for c in range(1, 9)]
        if not any(v not in (None, "") for v in vals[1:]):
            continue
        itens.append({
            "linha": lin,
            "data": iso(vals[1]) or (str(vals[1]) if vals[1] else None),
            "servico": vals[2],
            "motivo": vals[3],
            "solucionado": iso(vals[4]) or (str(vals[4]) if vals[4] else None),
            "tempo": vals[5],
            "quando": iso(vals[6]) or (str(vals[6]).strip() if vals[6] else None),
            "paralisacao": vals[7],
        })
    return itens


def primeira_linha_impacto_livre(caminho):
    wb = openpyxl.load_workbook(caminho, read_only=True)
    try:
        linhas = _linhas(wb[ABA_IMPACTO], max_col=8)
    finally:
        wb.close()
    for lin in LINHAS_IMPACTO:
        if all(_cel(linhas, lin, c) in (None, "") for c in range(2, 9)):
            return lin
    return None


# ------------------------------------------------------------------ gravação

def _mapa_abas(zf):
    wb = etree.fromstring(zf.read("xl/workbook.xml"))
    rels = etree.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
    alvo = {}
    for r in rels.findall(f"{{{NS_PKG_REL}}}Relationship"):
        t = r.get("Target")
        t = t.lstrip("/") if t.startswith("/") else "xl/" + t
        alvo[r.get("Id")] = t
    return {s.get("name"): alvo[s.get(f"{{{NS_REL}}}id")]
            for s in wb.iter(f"{{{NS}}}sheet")}


def _para_serial(data_iso):
    d = dt.date.fromisoformat(data_iso)
    return (d - EXCEL_EPOCH).days


def _obter_linha(sheet_data, n):
    for row in sheet_data.findall(f"{{{NS}}}row"):
        rn = int(row.get("r"))
        if rn == n:
            return row
        if rn > n:
            novo = etree.Element(f"{{{NS}}}row", r=str(n))
            row.addprevious(novo)
            return novo
    novo = etree.SubElement(sheet_data, f"{{{NS}}}row", r=str(n))
    return novo


def _estilo_coluna(sheet_data, col):
    """Estilo de uma célula existente na mesma coluna, para células novas."""
    for c in sheet_data.iter(f"{{{NS}}}c"):
        letras, lin = separa_ref(c.get("r"))
        if letras == col and lin >= LINHA_INICIO_DADOS and c.get("s"):
            return c.get("s")
    return None


def _obter_celula(sheet_data, ref):
    col, lin = separa_ref(ref)
    row = _obter_linha(sheet_data, lin)
    alvo = col_numero(col)
    for c in row.findall(f"{{{NS}}}c"):
        cn = col_numero(separa_ref(c.get("r"))[0])
        if cn == alvo:
            return c
        if cn > alvo:
            novo = etree.Element(f"{{{NS}}}c", r=ref)
            c.addprevious(novo)
            break
    else:
        novo = etree.SubElement(row, f"{{{NS}}}c", r=ref)
    estilo = _estilo_coluna(sheet_data, col)
    if estilo:
        novo.set("s", estilo)
    if row.get("spans"):
        del row.attrib["spans"]
    return novo


def _definir_valor(cel, valor, tipo):
    if cel.find(f"{{{NS}}}f") is not None:
        raise CelulaProtegida(f"A célula {cel.get('r')} contém fórmula e não pode ser sobrescrita.")
    for filho in list(cel):
        cel.remove(filho)
    cel.attrib.pop("t", None)
    if valor is None or valor == "":
        return
    if tipo == "data":
        etree.SubElement(cel, f"{{{NS}}}v").text = str(_para_serial(valor))
    elif isinstance(valor, (int, float)) and not isinstance(valor, bool):
        cel.set("t", "n")
        v = int(valor) if float(valor).is_integer() else valor
        etree.SubElement(cel, f"{{{NS}}}v").text = repr(v)
    else:
        cel.set("t", "inlineStr")
        is_ = etree.SubElement(cel, f"{{{NS}}}is")
        t = etree.SubElement(is_, f"{{{NS}}}t")
        t.text = str(valor)
        if t.text != t.text.strip():
            t.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")


def gravar_celulas(caminho, alteracoes, pasta_backup=None, manter_backups=40):
    """alteracoes: lista de (aba, ref, valor, tipo) — tipo 'data' converte ISO em data do Excel."""
    if not alteracoes:
        return 0
    try:
        with open(caminho, "r+b"):
            pass
    except PermissionError as e:
        raise PlanilhaBloqueada(
            "A planilha está aberta no Excel (arquivo bloqueado). Feche-a e tente salvar novamente.") from e

    por_aba = {}
    for aba, ref, valor, tipo in alteracoes:
        por_aba.setdefault(aba, []).append((ref, valor, tipo))

    with zipfile.ZipFile(caminho) as zin:
        mapa = _mapa_abas(zin)
        novos = {}
        for aba, itens in por_aba.items():
            if aba not in mapa:
                raise KeyError(f"Aba não encontrada: {aba}")
            parte = mapa[aba]
            raiz = etree.fromstring(zin.read(parte), etree.XMLParser(huge_tree=True, remove_blank_text=False))
            sheet_data = raiz.find(f"{{{NS}}}sheetData")
            for ref, valor, tipo in itens:
                _definir_valor(_obter_celula(sheet_data, ref), valor, tipo)
            novos[parte] = etree.tostring(raiz, xml_declaration=True, encoding="UTF-8", standalone=True)

        wbxml = etree.fromstring(zin.read("xl/workbook.xml"))
        calc = wbxml.find(f"{{{NS}}}calcPr")
        if calc is None:
            calc = etree.SubElement(wbxml, f"{{{NS}}}calcPr")
        if calc.get("fullCalcOnLoad") != "1":
            calc.set("fullCalcOnLoad", "1")
            novos["xl/workbook.xml"] = etree.tostring(wbxml, xml_declaration=True, encoding="UTF-8", standalone=True)

        pasta = os.path.dirname(os.path.abspath(caminho))
        fd, tmp = tempfile.mkstemp(suffix=".xlsm", dir=pasta)
        os.close(fd)
        try:
            with zipfile.ZipFile(tmp, "w") as zout:
                for info in zin.infolist():
                    dados = novos.get(info.filename)
                    if dados is None:
                        dados = zin.read(info.filename)
                    zout.writestr(info, dados, compress_type=info.compress_type)
        except Exception:
            os.remove(tmp)
            raise

    if pasta_backup:
        _backup(caminho, pasta_backup, manter_backups)
    try:
        os.replace(tmp, caminho)
    except PermissionError as e:
        os.remove(tmp)
        raise PlanilhaBloqueada(
            "A planilha está aberta no Excel (arquivo bloqueado). Feche-a e tente salvar novamente.") from e
    return len(alteracoes)


def _backup(caminho, pasta, manter):
    os.makedirs(pasta, exist_ok=True)
    base, ext = os.path.splitext(os.path.basename(caminho))
    carimbo = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
    shutil.copy2(caminho, os.path.join(pasta, f"{base}_{carimbo}{ext}"))
    antigos = sorted(f for f in os.listdir(pasta) if f.startswith(base + "_"))
    for f in antigos[:-manter]:
        os.remove(os.path.join(pasta, f))
