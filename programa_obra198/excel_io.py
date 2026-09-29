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
    if hasattr(ws, "reset_dimensions"):
        ws.reset_dimensions()
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
        "tabelas": ler_tabelas(wb),
        "abas_mensais_equip": [n for n in wb.sheetnames if n.upper().startswith("USO DE EQUIPAMENTO")],
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
            "peso": numero(_cel(linhas, lin, 12)) or 1,
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


# --------------------------------------------------------- tabelas do sistema
# Abas criadas pelo programa (título na linha 1, cabeçalho na linha 2, dados a partir da 3).

TABELAS = {
    "materiais": {
        "aba": "ESTOQUE MATERIAIS",
        "titulo": "ESTOQUE DE MATERIAIS — cadastro. Consumo por unidade = quanto do material é gasto para executar 1 unidade do serviço vinculado.",
        "cor": "FF7F6000",
        "campos": [
            ("codigo", "Código", "txt", 12), ("material", "Material", "txt", 34), ("unidade", "Unidade", "txt", 10),
            ("servico", "Serviço vinculado", "txt", 22), ("empresa", "Empresa (vazio = todas)", "txt", 16),
            ("coef", "Consumo por unidade de serviço", "num", 14), ("saldo_inicial", "Saldo inicial", "num", 12),
            ("data_saldo", "Data do saldo inicial", "data", 14), ("minimo", "Estoque mínimo", "num", 12),
            ("fornecedor", "Fornecedor", "txt", 20), ("prazo_reposicao", "Prazo reposição (dias)", "num", 12),
            ("obs", "Observação", "txt", 30),
        ],
    },
    "movimentos": {
        "aba": "MOVIMENTAÇÃO ESTOQUE",
        "titulo": "MOVIMENTAÇÃO DE ESTOQUE — ENTRADA (recebimento), SAÍDA (perda, transferência, consumo não apropriado) ou AJUSTE (+/−, inventário).",
        "cor": "FF7F6000",
        "campos": [
            ("data", "Data", "data", 12), ("codigo", "Código material", "txt", 14), ("tipo", "Tipo", "txt", 10),
            ("quantidade", "Quantidade", "num", 12), ("documento", "Documento (NF / romaneio)", "txt", 20),
            ("empresa", "Empresa", "txt", 14), ("obs", "Observação", "txt", 34),
        ],
    },
    "equipamentos": {
        "aba": "CADASTRO EQUIPAMENTOS",
        "titulo": "CADASTRO DE EQUIPAMENTOS — valor unitário conforme a forma de cobrança (diária, hora, turno ou mensal).",
        "cor": "FF375623",
        "campos": [
            ("equipamento", "Equipamento", "txt", 22), ("tipo", "Tipo", "txt", 16), ("locadora", "Locadora / proprietário", "txt", 20),
            ("cobranca", "Cobrança", "txt", 12), ("valor", "Valor unitário (R$)", "num", 14),
            ("consumo_lh", "Consumo estimado (L/h)", "num", 14), ("situacao", "Situação", "txt", 14), ("obs", "Observação", "txt", 30),
        ],
    },
    "usos": {
        "aba": "USO EQUIPAMENTOS",
        "titulo": "USO DE EQUIPAMENTOS E ABASTECIMENTO — uma linha por uso ou abastecimento. Empresa compartilhada: EJ/CMM (custo dividido igualmente).",
        "cor": "FF375623",
        "campos": [
            ("data", "Data", "data", 12), ("equipamento", "Equipamento", "txt", 18), ("empresa", "Empresa", "txt", 14),
            ("uso", "Uso", "txt", 14), ("quantidade", "Qtd (diárias/horas)", "num", 12), ("custo", "Custo equipamento (R$)", "num", 14),
            ("litros", "Combustível (L)", "num", 12), ("preco_litro", "Preço litro (R$)", "num", 12),
            ("custo_combustivel", "Custo combustível (R$)", "num", 14), ("operador", "Operador", "txt", 14),
            ("obs", "Observação", "txt", 28), ("origem", "Origem", "txt", 30),
        ],
    },
}
LINHA_DADOS_TABELA = 3

INICIO_DADOS_ABA = {ABA_IMPACTO: 5, ABA_METAS: LINHA_INICIO_METAS}
INICIO_DADOS_ABA.update({t["aba"]: LINHA_DADOS_TABELA for t in TABELAS.values()})


def _ler_tabela(wb, spec):
    if spec["aba"] not in wb.sheetnames:
        return []
    campos = spec["campos"]
    linhas = _linhas(wb[spec["aba"]], max_col=len(campos))
    itens = []
    for lin in range(LINHA_DADOS_TABELA, len(linhas) + 1):
        vals = [_cel(linhas, lin, c) for c in range(1, len(campos) + 1)]
        if all(v in (None, "") for v in vals):
            continue
        item = {"linha": lin}
        for (chave, _, tipo, _), v in zip(campos, vals):
            if tipo == "data":
                item[chave] = iso(v) or (str(v) if v not in (None, "") else None)
            elif tipo == "num":
                item[chave] = numero(v)
            else:
                item[chave] = None if v in (None, "") else str(v).strip()
        itens.append(item)
    return itens


def ler_tabelas(wb):
    return {nome: _ler_tabela(wb, spec) for nome, spec in TABELAS.items()}


def valores_registro(tabela, campos):
    """Converte o dicionário vindo da tela em células (col, valor, tipo) da tabela."""
    spec = TABELAS[tabela]
    saida = []
    for i, (chave, _, tipo, _) in enumerate(spec["campos"], start=1):
        if chave not in campos:
            continue
        v = campos[chave]
        if isinstance(v, str):
            v = v.strip()
        if v in ("", None):
            v = None
        elif tipo == "num":
            n = numero(v)
            if n is None:
                raise ValueError(f"Valor numérico inválido em '{chave}': {v}")
            v = int(n) if float(n).is_integer() else n
        elif tipo == "data":
            dt.date.fromisoformat(v)
        saida.append((col_letra(i), v, "data" if tipo == "data" and v else None))
    return saida


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


def _estilo_coluna(sheet_data, col, inicio):
    """Estilo de uma célula de dados existente na mesma coluna, para células novas."""
    for c in sheet_data.iter(f"{{{NS}}}c"):
        letras, lin = separa_ref(c.get("r"))
        if letras == col and lin >= inicio and c.get("s"):
            return c.get("s")
    return None


def _obter_celula(sheet_data, ref, inicio):
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
    estilo = _estilo_coluna(sheet_data, col, inicio)
    if estilo:
        novo.set("s", estilo)
    if row.get("spans"):
        del row.attrib["spans"]
    return novo


def _definir_valor(cel, valor, tipo, estilo_data=None):
    if cel.find(f"{{{NS}}}f") is not None:
        raise CelulaProtegida(f"A célula {cel.get('r')} contém fórmula e não pode ser sobrescrita.")
    for filho in list(cel):
        cel.remove(filho)
    cel.attrib.pop("t", None)
    if valor is None or valor == "":
        return
    if tipo == "data":
        if estilo_data and not cel.get("s"):
            cel.set("s", estilo_data)
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


def _atualizar_dimensao(raiz, sheet_data):
    max_lin, max_col = 1, 1
    for c in sheet_data.iter(f"{{{NS}}}c"):
        letras, lin = separa_ref(c.get("r"))
        max_lin, max_col = max(max_lin, lin), max(max_col, col_numero(letras))
    dim = raiz.find(f"{{{NS}}}dimension")
    if dim is not None:
        dim.set("ref", f"A1:{col_letra(max_col)}{max_lin}")


def _xml(raiz):
    return etree.tostring(raiz, xml_declaration=True, encoding="UTF-8", standalone=True)


def _parse(dados):
    return etree.fromstring(dados, etree.XMLParser(huge_tree=True, remove_blank_text=False))


def _estilo_celula(zin, mapa, aba, ref):
    if aba not in mapa:
        return None
    raiz = _parse(zin.read(mapa[aba]))
    for c in raiz.iter(f"{{{NS}}}c"):
        if c.get("r") == ref:
            return c.get("s")
    return None


def _verificar_desbloqueio(caminho):
    try:
        with open(caminho, "r+b"):
            pass
    except PermissionError as e:
        raise PlanilhaBloqueada(
            "A planilha está aberta no Excel (arquivo bloqueado). Feche-a e tente salvar novamente.") from e


def _reescrever(caminho, preparar, pasta_backup=None, manter_backups=40):
    """preparar(zin) -> dict {parte: bytes}; partes inexistentes são adicionadas ao pacote."""
    _verificar_desbloqueio(caminho)
    with zipfile.ZipFile(caminho) as zin:
        novos = preparar(zin)
        if not novos:
            return False
        pasta = os.path.dirname(os.path.abspath(caminho))
        fd, tmp = tempfile.mkstemp(suffix=".xlsm", dir=pasta)
        os.close(fd)
        try:
            existentes = set()
            with zipfile.ZipFile(tmp, "w") as zout:
                for info in zin.infolist():
                    existentes.add(info.filename)
                    dados = novos.get(info.filename)
                    if dados is None:
                        dados = zin.read(info.filename)
                    zout.writestr(info, dados, compress_type=info.compress_type)
                for parte, dados in novos.items():
                    if parte not in existentes:
                        zout.writestr(parte, dados, compress_type=zipfile.ZIP_DEFLATED)
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
    return True


def gravar_celulas(caminho, alteracoes, pasta_backup=None, manter_backups=40):
    """alteracoes: lista de (aba, ref, valor, tipo) — tipo 'data' converte ISO em data do Excel."""
    if not alteracoes:
        return 0
    por_aba = {}
    for aba, ref, valor, tipo in alteracoes:
        por_aba.setdefault(aba, []).append((ref, valor, tipo))

    def preparar(zin):
        mapa = _mapa_abas(zin)
        estilo_data = _estilo_celula(zin, mapa, ABA_CONSOLIDADO, "A6")
        novos = {}
        for aba, itens in por_aba.items():
            if aba not in mapa:
                raise KeyError(f"Aba não encontrada: {aba}")
            parte = mapa[aba]
            raiz = _parse(zin.read(parte))
            sheet_data = raiz.find(f"{{{NS}}}sheetData")
            inicio = INICIO_DADOS_ABA.get(aba, LINHA_INICIO_DADOS)
            for ref, valor, tipo in itens:
                _definir_valor(_obter_celula(sheet_data, ref, inicio), valor, tipo, estilo_data)
            _atualizar_dimensao(raiz, sheet_data)
            novos[parte] = _xml(raiz)
        wbxml = _parse(zin.read("xl/workbook.xml"))
        calc = wbxml.find(f"{{{NS}}}calcPr")
        if calc is None:
            calc = etree.SubElement(wbxml, f"{{{NS}}}calcPr")
        if calc.get("fullCalcOnLoad") != "1":
            calc.set("fullCalcOnLoad", "1")
            novos["xl/workbook.xml"] = _xml(wbxml)
        return novos

    _reescrever(caminho, preparar, pasta_backup, manter_backups)
    return len(alteracoes)


def _xml_nova_aba(spec, estilo_titulo, estilo_cab):
    def cel_txt(ref, texto, estilo):
        s = f' s="{estilo}"' if estilo else ""
        return f'<c r="{ref}"{s} t="inlineStr"><is><t>{_esc_xml(texto)}</t></is></c>'
    cols = "".join(f'<col min="{i}" max="{i}" width="{w}" customWidth="1"/>'
                   for i, (_, _, _, w) in enumerate(spec["campos"], start=1))
    cab = "".join(cel_txt(f"{col_letra(i)}2", rot, estilo_cab) for i, (_, rot, _, _) in enumerate(spec["campos"], start=1))
    ultima = col_letra(len(spec["campos"]))
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<worksheet xmlns="{NS}" xmlns:r="{NS_REL}">'
        f'<sheetPr><tabColor rgb="{spec["cor"]}"/></sheetPr><dimension ref="A1:{ultima}2"/>'
        '<sheetViews><sheetView workbookViewId="0"><pane ySplit="2" topLeftCell="A3" activePane="bottomLeft" state="frozen"/>'
        '<selection pane="bottomLeft" activeCell="A3" sqref="A3"/></sheetView></sheetViews>'
        f'<sheetFormatPr defaultRowHeight="15"/><cols>{cols}</cols>'
        f'<sheetData><row r="1">{cel_txt("A1", spec["titulo"], estilo_titulo)}</row>'
        f'<row r="2" ht="32" customHeight="1">{cab}</row></sheetData>'
        '<pageMargins left="0.5" right="0.5" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>'
        '</worksheet>'
    ).encode("utf-8")


def _esc_xml(t):
    return str(t).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def garantir_abas(caminho, pasta_backup=None):
    """Cria as abas do sistema que ainda não existem na planilha. Devolve os nomes criados."""
    with zipfile.ZipFile(caminho) as z:
        faltando = [t for t in TABELAS.values() if t["aba"] not in _mapa_abas(z)]
    if not faltando:
        return []

    def preparar(zin):
        mapa = _mapa_abas(zin)
        estilo_titulo = _estilo_celula(zin, mapa, "CONTROLE EJ", "A1")
        estilo_cab = _estilo_celula(zin, mapa, "CONTROLE EJ", "B7")
        wbxml = _parse(zin.read("xl/workbook.xml"))
        rels = _parse(zin.read("xl/_rels/workbook.xml.rels"))
        tipos = _parse(zin.read("[Content_Types].xml"))
        sheets = wbxml.find(f"{{{NS}}}sheets")
        ids = [int(s.get("sheetId")) for s in sheets]
        rids = [r.get("Id") for r in rels]
        numeros = [int(m.group(1)) for n in zin.namelist() if (m := re.match(r"xl/worksheets/sheet(\d+)\.xml$", n))]
        prefixo = "/xl/" if any(r.get("Target", "").startswith("/") for r in rels
                                if r.get("Type", "").endswith("/worksheet")) else ""
        novos = {}
        for spec in faltando:
            n = max(numeros) + 1
            numeros.append(n)
            rid = next(f"rId{i}" for i in range(1, 10000) if f"rId{i}" not in rids)
            rids.append(rid)
            sid = max(ids) + 1
            ids.append(sid)
            parte = f"xl/worksheets/sheet{n}.xml"
            novos[parte] = _xml_nova_aba(spec, estilo_titulo, estilo_cab)
            etree.SubElement(rels, f"{{{NS_PKG_REL}}}Relationship", Id=rid,
                             Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet",
                             Target=f"{prefixo}worksheets/sheet{n}.xml")
            etree.SubElement(sheets, f"{{{NS}}}sheet", name=spec["aba"], sheetId=str(sid),
                             attrib={f"{{{NS_REL}}}id": rid})
            etree.SubElement(tipos, "{http://schemas.openxmlformats.org/package/2006/content-types}Override",
                             PartName=f"/{parte}",
                             ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml")
        novos["xl/workbook.xml"] = _xml(wbxml)
        novos["xl/_rels/workbook.xml.rels"] = _xml(rels)
        novos["[Content_Types].xml"] = _xml(tipos)
        return novos

    _reescrever(caminho, preparar, pasta_backup)
    return [t["aba"] for t in faltando]


def _backup(caminho, pasta, manter):
    os.makedirs(pasta, exist_ok=True)
    base, ext = os.path.splitext(os.path.basename(caminho))
    carimbo = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
    shutil.copy2(caminho, os.path.join(pasta, f"{base}_{carimbo}{ext}"))
    antigos = sorted(f for f in os.listdir(pasta) if f.startswith(base + "_"))
    for f in antigos[:-manter]:
        os.remove(os.path.join(pasta, f))


# ------------------------------------------- importação das abas mensais de equipamento

def _normalizar_empresa(v):
    t = re.sub(r"\s+", " ", str(v or "")).strip().upper()
    if not t:
        return None
    partes = []
    for p in re.split(r"\s*/\s*", t):
        if p in ("GA",) or p.startswith("GLOBO"):
            p = "GLOBO AÇOS"
        partes.append(p)
    return "/".join(partes)


def _avaliar_formula(f, linha_vals):
    """Avalia fórmulas aritméticas simples (ex.: =7.58*O5, =3000+522) usando valores da mesma linha."""
    import ast
    import operator as op
    expr = f.lstrip("=")

    def troca(m):
        v = linha_vals.get(m.group(1))
        n = numero(v)
        return repr(n if n is not None else 0)
    expr = re.sub(r"\$?([A-Z]{1,3})\$?\d+", troca, expr)
    ops = {ast.Add: op.add, ast.Sub: op.sub, ast.Mult: op.mul, ast.Div: op.truediv, ast.USub: op.neg}

    def ev(n):
        if isinstance(n, ast.Expression):
            return ev(n.body)
        if isinstance(n, ast.Constant) and isinstance(n.value, (int, float)):
            return n.value
        if isinstance(n, ast.BinOp) and type(n.op) in ops:
            return ops[type(n.op)](ev(n.left), ev(n.right))
        if isinstance(n, ast.UnaryOp) and type(n.op) in ops:
            return ops[type(n.op)](ev(n.operand))
        raise ValueError(f)
    try:
        return ev(ast.parse(expr, mode="eval"))
    except (ValueError, SyntaxError, ZeroDivisionError):
        return None


def _preco_da_formula(f):
    m = re.match(r"=\s*([\d.]+)\s*\*", str(f or ""))
    return float(m.group(1)) if m else None


def _nome_equip(titulo):
    t = re.sub(r"\s+", " ", str(titulo or "")).strip().upper()
    if "SANY" in t:
        return "SANY"
    return t or None


def extrair_usos_mensais(caminho):
    """Lê as abas 'USO DE EQUIPAMENTO <MÊS>' (blocos lado a lado: título na linha 3, cabeçalho na 4)."""
    wb = openpyxl.load_workbook(caminho, read_only=True)
    registros = []
    try:
        for aba in [n for n in wb.sheetnames if n.upper().startswith("USO DE EQUIPAMENTO")]:
            linhas = _linhas(wb[aba])
            if len(linhas) < 5:
                continue
            cab = {c: str(_cel(linhas, 4, c) or "").strip().upper() for c in range(1, len(linhas[3]) + 1)}
            inicios = [c for c, h in cab.items() if h == "DATA"]
            for i, c0 in enumerate(inicios):
                c1 = (inicios[i + 1] - 1) if i + 1 < len(inicios) else max(cab)
                titulo = next((_cel(linhas, 3, c) for c in range(c0, c1 + 1) if _cel(linhas, 3, c)), None)
                if not titulo:
                    continue
                cols = {cab[c]: c for c in range(c0 + 1, c1 + 1) if cab[c]}
                abastecimento = "ABASTEC" in str(titulo).upper()
                col_emp = cols.get("EMPRESA") or cols.get("USO")
                col_val = cols.get("VALOR")
                col_obs = next((c for c in range(c0 + 1, c1 + 1) if not cab[c]), None)
                if abastecimento and not cols.get("LITROS"):
                    continue
                for lin in range(5, len(linhas) + 1):
                    data = iso(_cel(linhas, lin, c0))
                    if not data:
                        continue
                    vals = {col_letra(c): _cel(linhas, lin, c) for c in range(1, len(linhas[lin - 1]) + 1)}
                    empresa = _normalizar_empresa(_cel(linhas, lin, col_emp)) if col_emp else None
                    bruto = _cel(linhas, lin, col_val) if col_val else None
                    valor = _avaliar_formula(bruto, vals) if eh_formula(bruto) else numero(bruto)
                    reg = {"data": data, "empresa": empresa, "origem": f"{aba}!{col_letra(c0)}{lin}",
                           "operador": _cel(linhas, lin, cols["OPERADOR"]) if "OPERADOR" in cols else None,
                           "obs": _cel(linhas, lin, col_obs) if col_obs and not abastecimento else None}
                    if abastecimento:
                        litros = numero(_cel(linhas, lin, cols["LITROS"]))
                        if not litros:
                            continue
                        preco = _preco_da_formula(bruto) if eh_formula(bruto) else (valor / litros if valor else None)
                        reg.update(equipamento=_nome_equip(_cel(linhas, lin, cols.get("MAQUINA", 0)) if cols.get("MAQUINA") else None),
                                   uso="ABASTECIMENTO", litros=litros, preco_litro=preco,
                                   custo_combustivel=round(valor, 2) if valor else (round(litros * preco, 2) if preco else None))
                    else:
                        if not valor or not empresa or empresa in ("FERIADO", "NÃO USO", "CHEGADA"):
                            continue
                        reg.update(equipamento=_nome_equip(titulo), uso="DIÁRIA", quantidade=1, custo=round(valor, 2))
                    registros.append(reg)
    finally:
        wb.close()
    return registros
