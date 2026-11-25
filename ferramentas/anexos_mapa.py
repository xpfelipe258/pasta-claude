"""Mapa de apontamento dos anexos (G200): planta de cada prédio com a posição de cada peça montável (conjunto do Tekla).

Lê os IFCs dos anexos (220 Portaria/Eclusa, 230 Vestiário, 235 Refeitório) e grava maciel/inc/anexos_mapa.json:
{ "predios": { "Portaria": { "x0":…, "y0":…, "x1":…, "y1":… } , … },
  "pecas": [ [prédio, produto, marca, x0, y0, x1, y1, guid, z0, z1, posicao], … ] }   (mm, planta do mundo)
O formato das 3 primeiras posições e do guid (índice 7) é o mesmo do mapa por peça (apontamento-pecas).

Uso: python ferramentas/anexos_mapa.py <arquivo.ifc> [...]   (requer ifcopenshell)
"""
import json, multiprocessing, os, sys
import ifcopenshell, ifcopenshell.geom as geom, ifcopenshell.util.element as el
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ifc_anexos import local_da_fase, PREDIO_DO_ARQUIVO

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAIDA = os.path.join(RAIZ, "maciel", "inc", "anexos_mapa.json")
FIXADOR = ("PORCA", "ARRUELA", "PARAF", "CHUMBADOR", "NUT", "WASHER", "BOLT", "BARRA ROSCADA")


def ler(caminho, pecas):
    base = os.path.basename(caminho)
    padrao = PREDIO_DO_ARQUIVO.get(base.split("-")[3] if base.count("-") >= 4 else "", "Anexos")
    f = ifcopenshell.open(caminho)
    dono = {}   # parte -> conjunto
    for a in f.by_type("IfcElementAssembly"):
        for rel in a.IsDecomposedBy or []:
            for p in rel.RelatedObjects:
                dono[p.id()] = a
    caixa = {}
    st = geom.settings(); st.set("use-world-coords", True)
    it = geom.iterator(st, f, multiprocessing.cpu_count())
    if it.initialize():
        while True:
            s = it.get()
            a = dono.get(s.id)
            if a is not None:
                v = s.geometry.verts
                xs, ys, zs = v[0::3], v[1::3], v[2::3]
                b = caixa.get(a.id())
                n = [min(xs), min(ys), min(zs), max(xs), max(ys), max(zs)]
                caixa[a.id()] = n if b is None else [min(b[0], n[0]), min(b[1], n[1]), min(b[2], n[2]), max(b[3], n[3]), max(b[4], n[4]), max(b[5], n[5])]
            if not it.next():
                break
    for a in f.by_type("IfcElementAssembly"):
        b = caixa.get(a.id())
        nome = (a.Name or "").strip().upper()
        if b is None or any(k in nome for k in FIXADOR):
            continue
        ps = el.get_psets(a)
        rc, ta = ps.get("ROTULA CONJUNTO", {}), ps.get("Tekla Assembly", {})
        local = local_da_fase(rc.get("PHASE.NAME") or "", padrao)
        marca = (rc.get("ASSEMBLY MARK") or ta.get("Assembly/Cast unit Mark") or a.Tag or "").replace("(?)", "")
        mm = 1000.0 if abs(b[0]) < 1e7 else 1.0   # geometria em metros
        pecas.append([local, nome, marca] + [round(b[i] * mm) for i in (0, 1, 3, 4)] + [a.GlobalId, round(b[2] * mm), round(b[5] * mm), ta.get("Assembly/Cast unit position code") or ""])


def main(caminhos):
    pecas = []
    for c in caminhos:
        ler(c, pecas)
        print(c, len(pecas))
    vistos, unicas = set(), []
    for p in pecas:   # o mesmo conjunto pode estar em mais de um arquivo
        if p[7] not in vistos:
            vistos.add(p[7]); unicas.append(p)
    predios = {}
    for p in unicas:
        b = predios.setdefault(p[0], [p[3], p[4], p[5], p[6]])
        predios[p[0]] = [min(b[0], p[3]), min(b[1], p[4]), max(b[2], p[5]), max(b[3], p[6])]
    saida = {"predios": {k: dict(zip(["x0", "y0", "x1", "y1"], v)) for k, v in sorted(predios.items())}, "pecas": unicas}
    with open(SAIDA, "w", encoding="utf-8") as g:
        json.dump(saida, g, ensure_ascii=False, separators=(",", ":"))
    for k in sorted(predios):
        print(k, sum(1 for p in unicas if p[0] == k))


if __name__ == "__main__":
    main(sys.argv[1:])
