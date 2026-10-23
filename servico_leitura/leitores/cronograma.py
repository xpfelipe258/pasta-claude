"""Cronograma -> atividades com início, conclusão, quantidade e produtividade.

Formatos: planilha de planejamento de curto prazo (TAREFAS / INICIO / CONCLUSÃO), planilha genérica (nome + início + término)
e MS Project em XML. PDF de cronograma não é lido (vira aviso)."""
import re
import xml.etree.ElementTree as ET

import openpyxl

from ._util import data_iso, numero, texto


def _xlsx(caminho):
    wb = openpyxl.load_workbook(caminho, data_only=True, read_only=True)
    melhores = []
    for ws in wb.worksheets:
        linhas = [tuple(r) for r in ws.iter_rows(values_only=True, max_col=14)]
        cab = None
        for i, l in enumerate(linhas[:40]):
            cel = [texto(c).upper() for c in l]
            nome = next((j for j, c in enumerate(cel) if c.startswith(("TAREFA", "ATIVIDADE", "NOME", "DESCRI", "SERVI"))), None)
            ini = next((j for j, c in enumerate(cel) if c.startswith(("INICIO", "INÍCIO", "START", "DATA INI"))), None)
            fim = next((j for j, c in enumerate(cel) if c.startswith(("CONCLUS", "TÉRMINO", "TERMINO", "FIM", "FINISH", "DATA FIM"))), None)
            if nome is not None and ini is not None and fim is not None:
                cab = (i, nome, ini, fim,
                       next((j for j, c in enumerate(cel) if c.startswith("PRODUTIVIDADE")), None),
                       next((j for j, c in enumerate(cel) if c.startswith(("TOTAL DE UNID", "QUANT", "QTD", "TOTAL"))), None),
                       next((j for j, c in enumerate(cel) if c.strip() in ("ITEM", "ÍTEM")), None))
                break
        if not cab:
            continue
        i0, cn, ci, cf, cp, cq, cit = cab
        setor, ativ = "", []
        for l in linhas[i0 + 1:]:
            l = tuple(l) + (None,) * (14 - len(l))
            nome = texto(l[cn])
            d1, d2 = data_iso(l[ci]), data_iso(l[cf])
            if not nome and cit is not None and texto(l[cit]) and not d1:
                setor = texto(l[cit])                       # linha de setor ("Setor A (Casa + Apoio)")
                continue
            if nome and d1 and d2:
                ativ.append({"ordem": len(ativ) + 1, "item": texto(l[cit]) if cit is not None else "", "nome": nome, "setor": setor, "inicio": d1, "fim": d2,
                             "qtd": numero(l[cq]) if cq is not None else None, "produtividade_dia": numero(l[cp]) if cp is not None else None})
            elif nome and not d1 and not d2 and cit is not None and not texto(l[cit]) and len(nome) > 3 and not any(l[k] for k in range(cn + 1, 8) if k < len(l)):
                setor = nome
        if ativ:
            melhores.append((len(ativ), ws.title, ativ))
    if not melhores:
        return None
    melhores.sort(key=lambda x: -x[0])
    return {"aba": melhores[0][1], "atividades": melhores[0][2]}


def _xml(caminho):
    arv = ET.parse(caminho)
    raiz = arv.getroot()
    ns = raiz.tag.split("}")[0] + "}" if raiz.tag.startswith("{") else ""
    ativ = []
    for t in raiz.iter(ns + "Task"):
        nome = (t.findtext(ns + "Name") or "").strip()
        ini, fim = data_iso((t.findtext(ns + "Start") or "")[:10]), data_iso((t.findtext(ns + "Finish") or "")[:10])
        if not nome or not ini or not fim or (t.findtext(ns + "Summary") == "1"):
            continue
        ativ.append({"ordem": len(ativ) + 1, "item": (t.findtext(ns + "WBS") or t.findtext(ns + "OutlineNumber") or "").strip(), "nome": nome, "setor": "",
                     "inicio": ini, "fim": fim, "qtd": None, "produtividade_dia": None})
    return {"aba": "MS Project", "atividades": ativ} if ativ else None


def ler(caminho, nome_arquivo):
    ext = re.sub(r".*\.", "", nome_arquivo.lower())
    avisos, r = [], None
    if ext == "xml":
        r = _xml(caminho)
    elif ext in ("xlsx", "xlsm"):
        r = _xlsx(caminho)
    elif ext == "pdf":
        avisos.append("Cronograma em PDF não é lido automaticamente: envie o MS Project (.xml) ou a planilha (.xlsx) para gerar as datas.")
    if r is None:
        if ext != "pdf":
            avisos.append("Não encontrei atividades com início e término no cronograma.")
        return {"atividades": [], "avisos": avisos}
    r["avisos"] = avisos
    if r["atividades"]:
        r["inicio"] = min(a["inicio"] for a in r["atividades"])
        r["fim"] = max(a["fim"] for a in r["atividades"])
    return r
