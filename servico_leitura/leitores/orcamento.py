"""Orçamento / planilha de medição -> catálogo do BM (itens e atividades com quantidade, unidade, peso e valor).

Reconhece o desenho da planilha de memorial de cálculo (item "3.1.1" seguido das atividades, com colunas QTD, UNIDADE, VALOR % e
PESO) e o quadro do boletim de medição (BM1 - dd/mm/aa ...). Se a planilha só traz o escopo (item, descrição, unidade, qtde.),
os itens entram sem atividades e o sistema pede para detalhá-las na revisão.
"""
import re

import openpyxl

from ._util import data_iso, numero, texto, unidade

_COD = re.compile(r"^\s*(\d+(?:[.,]\d+)*)\s*$")


def _cod(v):
    m = _COD.match(texto(v)) if not isinstance(v, (int, float)) else None
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return None
    return m.group(1).replace(",", ".") if m else None


def _achar_cabecalho(linhas):
    """Procura a linha 'ITEM ... DESCRIÇÃO' e, nas 4 seguintes, as colunas QTD, UNIDADE, VALOR %, PESO."""
    for i, l in enumerate(linhas[:30]):
        cel = [texto(c).upper() for c in l]
        ci = next((j for j, c in enumerate(cel) if c in ("ITEM", "ÍTEM", "ITEM DE VENDA")), None)
        if ci is None or not any("DESCRI" in c for c in cel):
            continue
        col = {"item": ci, "desc": next(j for j, c in enumerate(cel) if "DESCRI" in c)}
        for l2 in linhas[i: i + 5]:
            for j, c in enumerate(l2):
                u = texto(c).upper()
                if u in ("QTD", "QTD.", "QUANTIDADE", "QTDE", "QTDE.") and "qtd" not in col:
                    col["qtd"] = j
                elif u.startswith("UNIDADE") or u in ("UN", "UND"):
                    col.setdefault("un", j)
                elif u.startswith("VALOR %") or u == "% VALOR":
                    col.setdefault("valor_pct", j)
                elif u.startswith("PESO") and "ATV" in u:
                    col.setdefault("peso", j)
        if "qtd" in col and "valor_pct" in col:
            return i, col
    return None, None


def _ler_memorial(linhas):
    i0, col = _achar_cabecalho(linhas)
    if col is None:
        return None
    total, itens, atual = None, [], None
    for l in linhas[i0 + 1:]:
        if len(l) <= max(col.values()):
            l = tuple(l) + (None,) * (max(col.values()) + 1 - len(l))
        desc = texto(l[col["desc"]])
        if total is None and "TOTAL DO CONTRATO" in desc.upper():
            v = [numero(c) for c in l if numero(c) and numero(c) > 1000]
            total = v[0] if v else None
            continue
        cod = _cod(l[col["item"]])
        q = numero(l[col["qtd"]])
        f = numero(l[col["valor_pct"]])
        if cod:
            atual = {"codigo": cod, "descricao": desc, "qtd": q, "unidade": unidade(l[col["un"]]) if "un" in col else "", "valor_pct": f or 0.0, "atividades": []}
            itens.append(atual)
        elif atual is not None and desc and q is not None:
            atual["atividades"].append({
                "descricao": desc, "qtd": q, "unidade": unidade(l[col["un"]]) if "un" in col else "",
                "valor_pct": f or 0.0, "peso": (numero(l[col["peso"]]) if "peso" in col else None) or 0.0,
            })
    if not itens:
        return None
    return {"total": total, "itens": itens}


def _periodos(linhas):
    """'BM1 - 19/06/26' nos cabeçalhos do quadro de medição -> [{bm, corte}]."""
    achados = {}
    for l in linhas[:15]:
        for c in l:
            m = re.match(r"^\s*BM\s*(\d+)\s*[-–]\s*(\d{2}/\d{2}/\d{2,4})", texto(c), re.I)
            if m:
                achados[int(m.group(1))] = data_iso(m.group(2))
    saida, ultimo = [], ""
    for k, v in sorted(achados.items()):
        if v and v < ultimo:
            break                         # colunas de modelo sem uso (datas que voltam no tempo)
        saida.append({"bm": k, "corte": v})
        ultimo = v or ultimo
    return saida


def _ler_escopo(linhas):
    """Quadro 'ESCOPO DA OBRA' (ITEM, DESCRIÇÃO, FORNECEDOR, UNIDADE, QTDE.)."""
    for i, l in enumerate(linhas[:60]):
        cel = [texto(c).upper() for c in l]
        if "ITEM" in cel and any("DESCRI" in c for c in cel) and any(c.startswith("QTD") for c in cel):
            ci = cel.index("ITEM")
            cd = next(j for j, c in enumerate(cel) if "DESCRI" in c)
            cq = next(j for j, c in enumerate(cel) if c.startswith("QTD"))
            cu = next((j for j, c in enumerate(cel) if c.startswith("UNID")), None)
            cf = next((j for j, c in enumerate(cel) if c.startswith("FORNEC")), None)
            itens = []
            for l2 in linhas[i + 1:]:
                cod = _cod(l2[ci]) if len(l2) > ci else None
                if not cod:
                    continue
                q = numero(l2[cq]) if len(l2) > cq else None
                if q is None:
                    continue
                itens.append({"codigo": cod, "descricao": texto(l2[cd]), "qtd": q, "unidade": unidade(l2[cu]) if cu is not None else "",
                              "fornecedor": texto(l2[cf]) if cf is not None else ""})
            if itens:
                return itens
    return []


def ler(caminho):
    wb = openpyxl.load_workbook(caminho, data_only=True, read_only=True)
    memorial, periodos, escopo, avisos, aba = None, [], [], [], ""
    for ws in wb.worksheets:
        linhas = [tuple(r) for r in ws.iter_rows(values_only=True, max_col=30)]
        if memorial is None:
            m = _ler_memorial(linhas)
            if m and any(it["atividades"] for it in m["itens"]):
                memorial, aba = m, ws.title
        if not periodos and not ws.title.upper().startswith(("PESO", "MC")):
            periodos = _periodos(linhas)
        if not escopo:
            escopo = _ler_escopo(linhas)
    saida = {"aba": aba, "periodos": periodos, "escopo": escopo, "avisos": avisos, "contrato_total": None, "itens": []}
    if memorial is None:
        if escopo:
            avisos.append("Só encontrei o escopo (itens e quantidades): as atividades de medição precisam ser detalhadas na revisão.")
            saida["itens"] = [dict(i, atividades=[], valor=0.0) for i in escopo]
        else:
            avisos.append("Não reconheci a estrutura da planilha (item, descrição, quantidade, unidade, valor %): informe o mapeamento na revisão.")
        return saida
    total = memorial["total"] or 0.0
    saida["contrato_total"] = total
    # código repetido na planilha (erro comum de digitação): o repetido recebe o número que falta na sequência
    vistos = set()
    for k, it in enumerate(memorial["itens"]):
        if it["codigo"] in vistos:
            partes = it["codigo"].split(".")
            anterior = memorial["itens"][k - 1]["codigo"].split(".")
            novo = ".".join(partes[:-1] + [str(int(anterior[-1]) + 1)]) if len(anterior) == len(partes) and anterior[-1].isdigit() else it["codigo"] + "b"
            while novo in vistos:
                novo += "b"
            avisos.append("O item %s aparece duas vezes na planilha (%s); o segundo foi numerado %s." % (it["codigo"], it["descricao"][:40], novo))
            it["codigo"] = novo
        vistos.add(it["codigo"])
    codigos = {it["codigo"] for it in memorial["itens"]}
    folhas = []
    for it in memorial["itens"]:
        tem_filhos = any(c != it["codigo"] and c.startswith(it["codigo"] + ".") for c in codigos)
        if not it["atividades"] and tem_filhos:
            continue                      # seção (3, 3.1, 3.2): só agrupa
        va = sum(a["valor_pct"] for a in it["atividades"]) * total
        it["valor"] = round(va if va else it["valor_pct"] * total, 2)
        soma_pesos = sum(a["peso"] for a in it["atividades"])
        for a in it["atividades"]:
            a["valor"] = round(a["valor_pct"] * total, 2)
            if not a["peso"]:
                a["peso"] = (a["valor_pct"] / sum(x["valor_pct"] for x in it["atividades"])) if sum(x["valor_pct"] for x in it["atividades"]) else 1.0 / len(it["atividades"])
        if it["atividades"] and abs(soma_pesos - 1) > 0.01 and soma_pesos:
            for a in it["atividades"]:
                a["peso"] = round(a["peso"] / soma_pesos, 6)
        folhas.append(it)
    soma_itens = round(sum(i["valor"] for i in folhas), 2)
    if total and abs(soma_itens - total) / total > 0.02:
        avisos.append("A soma dos itens lidos (R$ %s) difere do total do contrato (R$ %s): confira os valores na revisão." % (format(soma_itens, ",.2f"), format(total, ",.2f")))
    sem_ativ = [i["codigo"] for i in folhas if not i["atividades"]]
    if sem_ativ:
        avisos.append("Itens sem atividades de medição: " + ", ".join(sem_ativ[:12]))
    saida["itens"] = folhas
    return saida
