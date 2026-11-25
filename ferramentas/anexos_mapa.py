"""Mapa de apontamento dos anexos (G200): planta de cada prédio com a posição de cada peça montável (conjunto do Tekla).

Lê os IFCs dos anexos (220 Portaria/Eclusa, 230 Vestiário, 235 Refeitório) e grava maciel/inc/anexos_mapa.json:
{ "predios": { "Portaria": { "x0":…, "y0":…, "x1":…, "y1":… } , … },
  "pecas": [ [prédio, produto, marca, x0, y0, x1, y1, guid, z0, z1, posicao], … ] }   (mm, planta do mundo)
O formato das 3 primeiras posições e do guid (índice 7) é o mesmo do mapa por peça (apontamento-pecas).

Uso: python ferramentas/anexos_mapa.py <arquivo.ifc> [...]   (requer ifcopenshell)
"""
import json, math, multiprocessing, os, sys
import numpy as np
import ifcopenshell, ifcopenshell.geom as geom, ifcopenshell.util.element as el
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ifc_anexos import local_da_fase, PREDIO_DO_ARQUIVO

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAIDA = os.path.join(RAIZ, "maciel", "inc", "anexos_mapa.json")
FIXADOR = ("PORCA", "ARRUELA", "PARAF", "CHUMBADOR", "NUT", "WASHER", "BOLT", "BARRA ROSCADA")


def retangulo(xy):
    # retângulo de menor área que contém os pontos (calipers sobre o casco convexo)
    xy = np.unique(np.round(xy, 1), axis=0)
    if len(xy) < 3:
        x0, y0 = xy.min(0); x1, y1 = xy.max(0); return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
    def casco(P):
        P = sorted(map(tuple, P))
        def cr(o, a, b): return (a[0]-o[0])*(b[1]-o[1]) - (a[1]-o[1])*(b[0]-o[0])
        lo, up = [], []
        for p in P:
            while len(lo) >= 2 and cr(lo[-2], lo[-1], p) <= 0: lo.pop()
            lo.append(p)
        for p in reversed(P):
            while len(up) >= 2 and cr(up[-2], up[-1], p) <= 0: up.pop()
            up.append(p)
        return np.array(lo[:-1] + up[:-1])
    h = casco(xy); melhor = None
    for i in range(len(h)):
        e = h[(i + 1) % len(h)] - h[i]; n = np.hypot(*e)
        if n == 0: continue
        u = e / n; v = np.array([-u[1], u[0]])
        pu, pv = h @ u, h @ v
        area = (pu.max() - pu.min()) * (pv.max() - pv.min())
        if melhor is None or area < melhor[0]: melhor = (area, u, v, pu.min(), pu.max(), pv.min(), pv.max())
    _, u, v, a0, a1, b0, b1 = melhor
    return [list(u * a + v * b) for a, b in ((a0, b0), (a1, b0), (a1, b1), (a0, b1))]


def ler(caminho, pecas):
    base = os.path.basename(caminho)
    padrao = PREDIO_DO_ARQUIVO.get(base.split("-")[3] if base.count("-") >= 4 else "", "Anexos")
    f = ifcopenshell.open(caminho)
    dono = {}   # parte -> conjunto
    for a in f.by_type("IfcElementAssembly"):
        for rel in a.IsDecomposedBy or []:
            for p in rel.RelatedObjects:
                dono[p.id()] = a
    caixa, pts = {}, {}
    st = geom.settings(); st.set("use-world-coords", True)
    it = geom.iterator(st, f, multiprocessing.cpu_count())
    if it.initialize():
        while True:
            s = it.get()
            a = dono.get(s.id)
            if a is not None:
                v = s.geometry.verts
                xs, ys, zs = v[0::3], v[1::3], v[2::3]
                pts.setdefault(a.id(), []).append(np.c_[np.array(xs), np.array(ys)])
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
        rect = retangulo(np.vstack(pts[a.id()]) * mm)   # contorno real visto de cima (retângulo mínimo, gira com a peça)
        pecas.append([local, nome, marca] + [round(b[i] * mm) for i in (0, 1, 3, 4)] + [a.GlobalId, round(b[2] * mm), round(b[5] * mm), ta.get("Assembly/Cast unit position code") or "", rect])


def main(caminhos):
    pecas = []
    for c in caminhos:
        ler(c, pecas)
        print(c, len(pecas))
    vistos, unicas = set(), []
    for p in pecas:   # o mesmo conjunto pode estar em mais de um arquivo
        if p[7] not in vistos:
            vistos.add(p[7]); unicas.append(p)
    # cada prédio é girado para ficar alinhado aos próprios eixos (direção das peças longas), como a vista de cima do 3D
    ang = {}
    for pr in {p[0] for p in unicas}:
        hist = {}
        for p in unicas:
            if p[0] != pr: continue
            r = p[11]; e = np.array(r[1]) - np.array(r[0]); f = np.array(r[3]) - np.array(r[0])
            lg, d = (e, np.hypot(*e)) if np.hypot(*e) >= np.hypot(*f) else (f, np.hypot(*f))
            if d < 3000: continue
            a = round(math.degrees(math.atan2(lg[1], lg[0])) % 90, 0)
            hist[a] = hist.get(a, 0) + d
        ang[pr] = math.radians(max(hist, key=hist.get)) if hist else 0.0
    for p in unicas:
        c, s_ = math.cos(-ang[p[0]]), math.sin(-ang[p[0]])
        r = [[round(x * c - y * s_), round(x * s_ + y * c)] for x, y in p[11]]
        xs, ys = [q[0] for q in r], [q[1] for q in r]
        p[3], p[4], p[5], p[6] = min(xs), min(ys), max(xs), max(ys)
        p[11] = [v for q in r for v in q]
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
