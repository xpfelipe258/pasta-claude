"""Inventário dos IFCs dos anexos (Portaria, Vestiário, Refeitório) por local e família.

Cada arquivo traz mais de um prédio: o IFC da Portaria também tem a Eclusa e a platibanda da Eclusa.
O local de cada conjunto vem da fase (`ROTULA CONJUNTO` › `PHASE.NAME`, ex.: "1.3.1 E.M. COB. ECLUSA");
fase sem nome de prédio (ex.: "1.4.1 TELHA COB. ANEXOS", "JOIST_ECLUSA") cai no prédio do arquivo
ou no nome citado. O local usa a mesma grafia do cadastro de Materiais (Eclusa, Portaria, Refeitório, Vestiário).

Saída (maciel/inc/ifc_anexos.json): { "fontes": [...], "locais": { "Portaria": { "TERÇA": {"qtd": 30, "peso_kg": 0.0}, ... } },
"fases": { "Portaria": { "1.3.3. E.M. COB. PORTARIA": 194, ... } } }

Uso: python ifc_anexos.py <arquivo.ifc> [<arquivo.ifc> ...]   (grava em maciel/inc/ifc_anexos.json)
Requer: pip install ifcopenshell
"""
import collections
import json
import os
import sys

import ifcopenshell
import ifcopenshell.util.element as el

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAIDA = os.path.join(RAIZ, "maciel", "inc", "ifc_anexos.json")

# nome citado na fase -> local (grafia do cadastro de Materiais)
LOCAIS = [("ECLUSA", "Eclusa"), ("PORTARIA", "Portaria"),
          ("REFEITÓRIO", "Refeitório"), ("REFEITORIO", "Refeitório"),
          ("VESTIÁRIO", "Vestiário"), ("VESTIARIO", "Vestiário")]
# prédio do arquivo, quando a fase não cita nenhum (ex.: "TELHA COB. ANEXOS")
PREDIO_DO_ARQUIVO = {"220": "Portaria", "230": "Vestiário", "235": "Refeitório"}


def local_da_fase(fase, padrao):
    up = (fase or "").upper()
    for chave, local in LOCAIS:
        if chave in up:
            return local
    return padrao


def inventariar(caminho, acc, fases, fontes):
    base = os.path.basename(caminho)
    padrao = PREDIO_DO_ARQUIVO.get(base.split("-")[3] if base.count("-") >= 4 else "", "Anexos")
    f = ifcopenshell.open(caminho)
    n = 0
    for a in f.by_type("IfcElementAssembly"):
        ps = el.get_psets(a)
        rc = ps.get("ROTULA CONJUNTO", {})
        fase = rc.get("PHASE.NAME") or ""
        local = local_da_fase(fase, padrao)
        nome = (a.Name or "").strip()
        peso = rc.get("WEIGHT_GROSS") or 0
        acc[local][nome]["qtd"] += 1
        acc[local][nome]["peso_kg"] += float(peso)
        fases[local][fase or "(sem fase)"] += 1
        n += 1
    fontes.append({"arquivo": base, "conjuntos": n, "projeto": f.by_type("IfcProject")[0].Name})


def main(caminhos):
    acc = collections.defaultdict(lambda: collections.defaultdict(lambda: {"qtd": 0, "peso_kg": 0.0}))
    fases = collections.defaultdict(collections.Counter)
    fontes = []
    for c in caminhos:
        inventariar(c, acc, fases, fontes)
    saida = {
        "fontes": fontes,
        "locais": {l: {n: {"qtd": v["qtd"], "peso_kg": round(v["peso_kg"], 1)} for n, v in sorted(fam.items())}
                   for l, fam in sorted(acc.items())},
        "fases": {l: dict(c) for l, c in sorted(fases.items())},
    }
    with open(SAIDA, "w", encoding="utf-8") as g:
        json.dump(saida, g, ensure_ascii=False, indent=1)
    print("gravado:", SAIDA)
    for l, fam in saida["locais"].items():
        print(f"  {l}: {sum(v['qtd'] for v in fam.values())} conjuntos em {len(fam)} famílias")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    main(sys.argv[1:])
