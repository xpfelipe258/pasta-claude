"""Projetos em PDF: índice de pranchas (código, título, revisão) e listas de material encontradas nas tabelas."""
import re

import pdfplumber
import pypdf

from ._util import texto

_COD = re.compile(r"\b(OF\.?\s?\d+[-–][A-Z]{2,5}[-–][A-Z]{2,4}[-–]\d{2,4})[-–](.+?)[-–](R\d{2})\b")
_ESC = re.compile(r"Escala\s*([\d:./]+)", re.I)


_LISTA = re.compile(r"^([A-Z]{1,4}\d{1,4})\s+(\S+)\s+([A-Z]{1,4}-?\d{2,3}(?:[-.][A-Z0-9.]+)?)\s+(\d+)\s+(\d+(?:[.,]\d+)?)\s+(\d+(?:[.,]\d+)?)\s+(\d+(?:[.,]\d+)?)\s*$", re.M)
_ASSUNTOS = (("telha", r"telha"), ("calha", r"calha"), ("fechamento", r"fechamento"), ("linha_de_vida", r"linha de vida"), ("chumbador", r"chumbador"),
             ("joist", r"joist"), ("marquise", r"marquise"), ("mezanino", r"mezanino"))


def _num(v):
    return float(v.replace(",", "."))


def _prancha(texto_pg, nome):
    t = texto_pg
    m = _COD.search(t.replace("\n", " "))
    return {"codigo": re.sub(r"\s", "", m.group(1)) if m else "", "titulo": texto(m.group(2)) if m else "", "revisao": m.group(3) if m else "",
            "escala": (_ESC.search(t).group(1) if _ESC.search(t) else ""), "tem_texto": len(t.strip()) > 20,
            "assuntos": sorted(k for k, p in _ASSUNTOS if re.search(p, t, re.I))}


def _lista_de_material(caminho, nome, codigo):
    """Quadro 'LISTA DE MATERIAL' da prancha do Tekla: ITEM, DESCRIÇÃO (perfil), MATERIAL, QTE, COMP (mm), MASSA unit., total."""
    with pdfplumber.open(caminho) as pdf:
        t = pdf.pages[0].extract_text() or ""
    linhas = [{"item": m.group(1), "perfil": m.group(2), "material": m.group(3), "qtd": int(m.group(4)), "comprimento_mm": _num(m.group(5)),
               "massa_unit_kg": _num(m.group(6)), "massa_total_kg": _num(m.group(7))} for m in _LISTA.finditer(t)]
    return {"arquivo": nome, "prancha": codigo, "itens": linhas, "massa_kg": round(sum(l["massa_total_kg"] for l in linhas), 1)} if linhas else None


def ler_varios(arquivos):
    """arquivos: [(nome, caminho)]."""
    pranchas, listas, avisos = [], [], []
    for nome, caminho in arquivos:
        try:
            leitor = pypdf.PdfReader(caminho)
            for pg in leitor.pages[:6]:
                t = pg.extract_text() or ""
                p = _prancha(t, nome)
                pranchas.append(dict(p, arquivo=nome))
                if re.search(r"lista de materia", t, re.I):
                    l = _lista_de_material(caminho, nome, p["codigo"])
                    if l:
                        listas.append(l)
                break                      # as pranchas do Tekla têm uma página
        except Exception as e:
            avisos.append("Não consegui ler %s: %s" % (nome, e))
    sem_codigo = sum(1 for p in pranchas if not p["codigo"])
    if pranchas and sem_codigo == len(pranchas):
        avisos.append("Nenhuma prancha seguiu o padrão de código (OF.nnn-MET-DM-nnn-TÍTULO-Rnn); o índice usa só o nome do arquivo.")
    return {"pranchas": pranchas, "listas_de_material": listas, "avisos": avisos}
