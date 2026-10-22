"""Lista de parafusos e fixadores: planilha/CSV com diâmetro, comprimento, norma e quantidade (ou o modelo .trb)."""
import csv
import io

import openpyxl

from ._base import fechar, novo
from ._planilha import acha_cabecalho, numero

_CHAVES = {
    "diametro": [r"di[a]?metro", r"bitola", r"^o\b", r"diam"],
    "comprimento": [r"comprimento", r"\bcomp\b", r"length"],
    "norma": [r"norma", r"classe", r"grau", r"astm", r"material"],
    "quantidade": [r"quant", r"\bqtd", r"qtde", r"\bqty", r"count"],
    "descricao": [r"descri", r"produto", r"nome", r"item"],
}


def _linhas_xlsx(caminho):
    wb = openpyxl.load_workbook(caminho, read_only=True, data_only=True)
    for ws in wb.worksheets[:12]:
        yield ws.title, (list(r) for r in ws.iter_rows(values_only=True, max_row=20000))


def _linhas_csv(caminho):
    with open(caminho, "rb") as f:
        dado = f.read().decode("utf-8-sig", "replace")
    try:
        dialeto = csv.Sniffer().sniff(dado[:4096], delimiters=";,\t|")
    except csv.Error:
        dialeto = csv.excel
    yield "csv", (list(l) for l in csv.reader(io.StringIO(dado), dialeto))


def validar(caminho, ext):
    r = novo()
    if ext == "trb":
        r["resumo"] = {"formato": "TRB (Trimble Connect)"}
        r["avisos"].append("Modelo .trb: a quantidade de parafusos só é lida na etapa de leitura. Se puder, envie também o relatório .xlsx/.csv do Tekla (mais robusto).")
        return fechar(r)
    fonte = _linhas_csv(caminho) if ext == "csv" else _linhas_xlsx(caminho)
    itens, aba_ok, total = 0, None, 0.0
    for nome, linhas in fonte:
        linhas = list(linhas)
        n, cols = acha_cabecalho(linhas, _CHAVES, ["quantidade"])
        if n is None or not ("diametro" in cols or "descricao" in cols):
            continue
        aba_ok = nome
        for l in linhas[n + 1:]:
            q = numero(l[cols["quantidade"]]) if cols["quantidade"] < len(l) else None
            if q:
                itens += 1
                total += q
        r["resumo"] = {"aba": nome, "linhas_com_quantidade": itens, "total_de_pecas": total,
                       "colunas_reconhecidas": ", ".join(sorted(cols))}
        for falta, rot in (("diametro", "diâmetro"), ("comprimento", "comprimento"), ("norma", "norma/classe")):
            if falta not in cols:
                r["avisos"].append("Coluna de %s não encontrada: a conferência com o cadastro de materiais fica menos precisa." % rot)
        break
    if aba_ok is None or itens == 0:
        r["erros"].append("Não encontrei a lista de fixadores: preciso de uma tabela com quantidade e (diâmetro ou descrição).")
    return fechar(r)
