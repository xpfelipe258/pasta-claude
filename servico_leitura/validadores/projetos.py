"""Projetos em PDF: precisa ter texto selecionável; conta páginas e procura os assuntos que alimentam quantidades de telha e fechamento."""
import re

import pypdf

from ._base import fechar, novo

_ASSUNTOS = {
    "telha": r"telha",
    "fechamento": r"fechamento",
    "cobertura": r"cobertura",
    "calha": r"calha",
    "vao": r"v[ãa]o",
    "area_m2": r"m\s?[²2]\b",
    "lista_de_material": r"lista de (material|materiais)",
}


def validar(caminho, ext):
    r = novo()
    leitor = pypdf.PdfReader(caminho)
    paginas = len(leitor.pages)
    amostra = list(range(paginas)) if paginas <= 40 else sorted(set(list(range(0, paginas, max(1, paginas // 40)))))
    texto, com_texto = "", 0
    for i in amostra:
        t = leitor.pages[i].extract_text() or ""
        if len(t.strip()) > 20:
            com_texto += 1
        texto += t + "\n"
    achados = {k: len(re.findall(p, texto, re.I)) for k, p in _ASSUNTOS.items()}
    r["resumo"] = {"paginas": paginas, "paginas_com_texto_na_amostra": com_texto, **{"cita_" + k: v for k, v in achados.items() if v}}
    if com_texto == 0:
        r["erros"].append("O PDF não tem texto selecionável (imagem escaneada): não dá para ler quantidades. Envie o PDF gerado pelo CAD/Tekla.")
    elif com_texto < len(amostra) * 0.5:
        r["avisos"].append("Menos da metade das páginas lidas tem texto: parte do projeto pode ser imagem.")
    if com_texto and not (achados["telha"] or achados["fechamento"] or achados["cobertura"]):
        r["avisos"].append("Não encontrei menção a telha, fechamento ou cobertura: confirme se este é o PDF com as quantidades de telhas.")
    return fechar(r)
