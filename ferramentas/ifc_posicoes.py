"""Lê o IFC do galpão e resume, por eixo e por faixa, os suportes de joist e as porcas/arruelas.

Cada conjunto do IFC (Tekla) traz o código de posição 'Assembly/Cast unit position code',
por exemplo '05/B1-B' (eixo 05, trecho de letras B1-B) ou '05-05a/C-B2' (rua entre 05 e 05a).
O trecho de letras é agrupado nas faixas do galpão (AB, BC, CD, DE, EF, FG, GH).

Uso: python ifc_posicoes.py LSF-MET-EX-200-200-BIM-R0D.ifc [saida.json]
Requer: pip install ifcopenshell
"""
import collections
import json
import os
import sys

import ifcopenshell
import ifcopenshell.util.element as el

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# trechos de letras (nome do eixo intermediário incluso) -> faixa entre eixos principais
FAIXA = {}
for faixa, trechos in {
    "AB": ["A", "A1-A", "A2-A1", "A3-A2", "B-A3"],
    "BC": ["B1-B", "B2-B1", "C-B2"],
    "CD": ["C1-C", "C2-C1", "D-C2"],
    "DE": ["D1-D", "D2-D1", "E-D2"],
    "EF": ["E1-E", "E2-E1", "F-E2"],
    "FG": ["F1-F", "F2-F1", "G-F2"],
    "GH": ["G1-G", "G2-G1", "G3-G2", "H-G3", "H"],
}.items():
    for t in trechos:
        FAIXA[t] = faixa

PARAFUSOS_POR_PONTA_DA_JOIST = 4  # regra da planilha de estoque: 4 por eixo, 8 por joist


def posicao(a):
    return el.get_psets(a).get("Tekla Assembly", {}).get("Assembly/Cast unit position code") or ""


def perfil(a):
    for r in a.IsDecomposedBy or []:
        for o in r.RelatedObjects:
            return o.ObjectType
    return None


def resumir(caminho):
    f = ifcopenshell.open(caminho)
    suportes = collections.defaultdict(lambda: collections.Counter())   # eixo -> faixa -> n
    fix = collections.defaultdict(lambda: collections.Counter())         # diâmetro/tipo -> eixo -> n
    sem_faixa = collections.Counter()
    for a in f.by_type("IfcElementAssembly"):
        nome = a.Name or ""
        if nome not in ("SUPORTE JOIST", "PORCA", "ARRUELA"):
            continue
        eixo, _, trecho = posicao(a).partition("/")
        if nome == "SUPORTE JOIST":
            faixa = FAIXA.get(trecho)
            if faixa is None:
                sem_faixa[trecho] += 1
                continue
            suportes[eixo][faixa] += 1
        else:
            fix[perfil(a) or nome][eixo] += 1
    return suportes, fix, sem_faixa


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    suportes, fix, sem_faixa = resumir(sys.argv[1])
    saida = sys.argv[2] if len(sys.argv) > 2 else os.path.join(RAIZ, "dados", "ifc_r0d_posicoes.json")
    faixas = ["AB", "BC", "CD", "DE", "EF", "FG", "GH"]
    eixos = sorted(suportes)
    total = sum(sum(c.values()) for c in suportes.values())
    print(f"suportes de joist: {total} em {len(eixos)} eixos | sem faixa: {dict(sem_faixa)}")
    print("eixo  " + " ".join(f"{x:>4}" for x in faixas) + "  total")
    for e in eixos:
        print(f"{e:<5} " + " ".join(f"{suportes[e][x]:>4}" for x in faixas) + f"  {sum(suportes[e].values()):>5}")
    ruas = len(eixos) - 1
    joists = total / 2 / PARAFUSOS_POR_PONTA_DA_JOIST
    print(f"\nse cada ponta de joist usa {PARAFUSOS_POR_PONTA_DA_JOIST} suportes: {joists:.0f} joists "
          f"({joists / ruas:.1f} por rua em {ruas} ruas; {joists / ruas / len(faixas):.1f} por faixa)")
    os.makedirs(os.path.dirname(saida), exist_ok=True)
    with open(saida, "w", encoding="utf-8") as g:
        json.dump({
            "fonte": os.path.basename(sys.argv[1]),
            "regra": f"cada suporte de joist recebe 1 parafuso; {PARAFUSOS_POR_PONTA_DA_JOIST} suportes por ponta de joist",
            "suportes_joist_por_eixo_faixa": {e: dict(suportes[e]) for e in eixos},
            "porcas_arruelas_por_perfil_e_eixo": {p: dict(c) for p, c in fix.items()},
        }, g, ensure_ascii=False, indent=1)
    print("gravado:", saida)
