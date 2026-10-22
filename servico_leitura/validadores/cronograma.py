"""Cronograma do cliente: XML do MS Project, planilha (.xlsx) ou PDF com texto."""
import re
import xml.etree.ElementTree as ET

import openpyxl
import pypdf

from ._base import fechar, novo
from ._planilha import acha_cabecalho

_CHAVES = {
    "nome": [r"nome", r"tarefa", r"atividade", r"descri"],
    "inicio": [r"inicio", r"start", r"comeco"],
    "fim": [r"termino", r"\bfim\b", r"finish", r"conclusao"],
}


def _tag(e):
    return e.tag.rsplit("}", 1)[-1]


def _xml(caminho, r):
    tarefas, ini, fim, raiz_ok = 0, None, None, False
    for _, e in ET.iterparse(caminho, events=("end",)):
        t = _tag(e)
        if t == "Project":
            raiz_ok = True
        if t == "Task":
            filhos = {_tag(c): (c.text or "") for c in e}
            if filhos.get("Name"):
                tarefas += 1
                s, f = filhos.get("Start", "")[:10], filhos.get("Finish", "")[:10]
                if s and (ini is None or s < ini):
                    ini = s
                if f and (fim is None or f > fim):
                    fim = f
            e.clear()
    if not raiz_ok:
        r["erros"].append("O XML não é um cronograma do MS Project (falta o elemento Project).")
    elif tarefas == 0:
        r["erros"].append("O cronograma não tem tarefas.")
    r["resumo"] = {"formato": "XML do MS Project", "tarefas": tarefas, "inicio": ini or "", "fim": fim or ""}


def _xlsx(caminho, r):
    wb = openpyxl.load_workbook(caminho, read_only=True, data_only=True)
    for ws in wb.worksheets[:12]:
        linhas = [list(l) for l in ws.iter_rows(values_only=True, max_row=5000)]
        n, cols = acha_cabecalho(linhas, _CHAVES, ["nome", "inicio", "fim"])
        if n is None:
            continue
        tarefas = sum(1 for l in linhas[n + 1:] if len(l) > cols["nome"] and l[cols["nome"]])
        r["resumo"] = {"formato": "Planilha", "aba": ws.title, "tarefas": tarefas}
        if tarefas == 0:
            r["erros"].append("A planilha de cronograma não tem tarefas abaixo do cabeçalho.")
        return
    r["erros"].append("Não encontrei a tabela do cronograma: preciso das colunas nome da tarefa, início e término.")


def _pdf(caminho, r):
    leitor = pypdf.PdfReader(caminho)
    texto = ""
    for pg in leitor.pages[: min(len(leitor.pages), 12)]:
        texto += (pg.extract_text() or "") + "\n"
    datas = re.findall(r"\b\d{2}/\d{2}/\d{2,4}\b", texto)
    r["resumo"] = {"formato": "PDF", "paginas": len(leitor.pages), "datas_no_texto": len(datas)}
    if len(texto.strip()) < 50:
        r["erros"].append("O PDF não tem texto selecionável (imagem escaneada). Exporte o cronograma em XML, XLSX ou PDF com texto.")
    elif len(datas) < 6:
        r["erros"].append("Não encontrei datas suficientes no PDF para identificar um cronograma.")
    else:
        r["avisos"].append("Cronograma em PDF: nomes longos podem vir cortados e as datas são lidas por texto. Prefira XML ou XLSX.")


def validar(caminho, ext):
    r = novo()
    if ext == "xml":
        _xml(caminho, r)
    elif ext in ("xlsx", "xlsm"):
        _xlsx(caminho, r)
    elif ext == "pdf":
        _pdf(caminho, r)
    else:
        r["erros"].append("Formato .%s não é aceito para cronograma." % ext)
    return fechar(r)
