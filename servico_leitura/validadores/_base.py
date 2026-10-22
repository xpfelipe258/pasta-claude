def novo():
    return {"ok": True, "resumo": {}, "avisos": [], "erros": []}


def fechar(r):
    r["ok"] = not r["erros"]
    return r
