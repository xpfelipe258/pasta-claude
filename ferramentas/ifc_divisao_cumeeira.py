"""Divide o IFC do galpão G200 na cumeeira (linha média entre os eixos D e E)
e totaliza telhas (m²) e peso das peças (kg) de cada metade.

Uso: python ifc_divisao_cumeeira.py LSF-MET-EX-200-200-BIM-R0D.ifc
Requer: pip install ifcopenshell numpy
Lado D-A = EJ ou CMM (metade dos eixos D..A); lado E-H = a outra empresa.
"""
import collections
import sys

import ifcopenshell
import ifcopenshell.util.placement as pl
import numpy as np

f = ifcopenshell.open(sys.argv[1])

# Eixos D e E do grid +62.99, em coordenadas UTM do modelo (mm)
D0, D1 = np.array([565997504, 8593076392.]), np.array([566032898, 8592646346.])
E0 = np.array([565972449, 8593074330.])
u = (D1 - D0) / np.linalg.norm(D1 - D0)
n = np.array([-u[1], u[0]])
p0 = (D0 + E0) / 2
if n @ (D0 - p0) < 0:
    n = -n


def lado(e):
    m = pl.get_local_placement(e.ObjectPlacement)
    return "D-A" if n @ (np.array([m[0][3], m[1][3]]) - p0) > 0 else "E-H"


def quants(e):
    d = {}
    for rel in getattr(e, "IsDefinedBy", []) or []:
        pd = getattr(rel, "RelatingPropertyDefinition", None)
        if pd is not None and pd.is_a("IfcElementQuantity"):
            for q in pd.Quantities:
                for k, v in q.get_info().items():
                    if k.endswith("Value"):
                        d[q.Name] = v
    return d


def filho(a):
    for r in a.IsDecomposedBy or []:
        for o in r.RelatedObjects:
            return o


# A posição do conjunto (assembly) é a mesma para todos: usar a da peça filha.
area = collections.defaultdict(float)
n_telhas = collections.Counter()
for a in f.by_type("IfcElementAssembly"):
    nome = (a.Name or "")[:16]
    c = filho(a)
    if c is None or not nome.startswith("TELHA"):
        continue
    k = (nome, lado(c))
    n_telhas[k] += 1
    area[k] += quants(c).get("Length", 0) / 1000 * quants(a).get("Width", 490.9) / 1000

peso = collections.defaultdict(float)
for e in f.by_type("IfcElement"):
    if e.is_a("IfcElementAssembly") or e.is_a("IfcDiscreteAccessory"):
        continue
    peso[(e.is_a(), lado(e))] += quants(e).get("NetWeight", 0)

print("TELHAS (n, m²)")
for k in sorted(area):
    print(f"  {k[0]:<18}{k[1]}  n={n_telhas[k]:>5}  {area[k]:>11,.1f} m²")
print("PESO DAS PEÇAS (kg)")
for k in sorted(peso):
    print(f"  {k[0]:<12}{k[1]}  {peso[k]:>12,.0f}")
