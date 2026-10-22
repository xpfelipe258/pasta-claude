"""Orçamento / planilha de medição por empresa: item, descrição, quantidade, unidade e valor."""
import openpyxl

from ._base import fechar, novo
from ._planilha import acha_cabecalho, numero

_CHAVES = {
    "item": [r"^item$", r"^it$", r"^n[o°º]?$", r"^cod"],
    "descricao": [r"descri", r"servico", r"atividade"],
    "quantidade": [r"quant", r"\bqtd", r"qtde"],
    "unidade": [r"unid", r"^un\.?$", r"^und$"],
    "valor_unitario": [r"unit", r"preco", r"p\.? ?u"],
    "valor": [r"^valor(?! unit)", r"^total", r"^subtotal"],
}


def validar(caminho, ext):
    r = novo()
    wb = openpyxl.load_workbook(caminho, read_only=True, data_only=True)
    abas = []
    itens_total, valor_total = 0, 0.0
    for ws in wb.worksheets[:25]:
        linhas = [list(l) for l in ws.iter_rows(values_only=True, max_row=6000)]
        n, cols = acha_cabecalho(linhas, _CHAVES, ["descricao", "quantidade"])
        if n is None or not ({"unidade", "valor", "valor_unitario"} & set(cols)):
            continue
        itens, valor = 0, 0.0
        for l in linhas[n + 1:]:
            q = numero(l[cols["quantidade"]]) if cols["quantidade"] < len(l) else None
            d = l[cols["descricao"]] if cols["descricao"] < len(l) else None
            if q and d:
                itens += 1
                col_v = cols.get("valor", cols.get("valor_unitario"))
                v = numero(l[col_v]) if col_v is not None and col_v < len(l) else None
                if v and "valor" in cols:
                    valor += v
        if itens:
            abas.append(ws.title)
            itens_total += itens
            valor_total += valor
    r["resumo"] = {"abas_com_itens": ", ".join(abas), "itens": itens_total, "valor_somado": round(valor_total, 2)}
    if not abas:
        r["erros"].append("Não encontrei a tabela de itens: preciso de colunas descrição, quantidade, unidade e valor (item opcional).")
        return fechar(r)
    if valor_total == 0:
        r["avisos"].append("Não consegui somar valores: confirme a coluna de valor do contrato.")
    if len(abas) > 1:
        r["avisos"].append("Várias abas com itens (%d): na revisão você escolhe quais viram contrato (QPC, RÓTULA…)." % len(abas))
    return fechar(r)
