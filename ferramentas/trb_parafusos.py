"""Parafusos dos modelos TRB (Trimble Connect, formato TRB8) — contagem e localização.

Os IFC de texto exportados do Tekla (R0A) saem com `Bolts:Off`: não trazem parafuso nenhum. Os parafusos só existem
nos modelos `OF.198 - LYON G200 *.ifc.trb`. O TRB8 é um FlatBuffers sem esquema público; o que foi decodificado aqui:

  raiz.f0.f0  vetor de 64 bytes por entidade: bytes 16..40 = posição (x, y, z) em metros, no sistema do projeto
  raiz.f1.f7  linhas de propriedades: {f0 = modelo de propriedades, f1 = valores (índices), f2 = ids das entidades}
  raiz.f1.f9  nomes das propriedades; raiz.f1.f10 modelos de propriedades (lista nome+tipo);
  raiz.f1.f11 doubles (valores numéricos, mm);   raiz.f1.f16 textos (valores de texto)
  modelo com NUMBER+TIPO = "Bolt assembly" (valores: NUMBER, TIPO, furo Y, furo X, furo Ø, PRF_NAME, Ø parafuso, comprimento)
  modelo com "Washer count" = arruelas/porcas do conjunto (… Location = Site/Shop, Bolt count, tamanho, comprimento, norma, nome)

TIPO = BOLT é parafuso; TIPO = HOLE é só furo (sem parafuso) e NÃO entra na contagem de parafusos.
Cada entidade "Bolt assembly" tem NUMBER parafusos (com a mesma quantidade de arruelas e porcas no kit).

Uso: python trb_parafusos.py <modelo.ifc.trb> [<modelo.ifc.trb> ...]
Grava maciel/inc/ifc_parafusos.json (resumos) e maciel/inc/ifc_parafusos_locais.json (um registro por conjunto).
Requer: numpy.
"""
import collections
import json
import os
import re
import struct
import sys

import numpy as np

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAIDA_RESUMO = os.path.join(RAIZ, "maciel", "inc", "ifc_parafusos.json")
SAIDA_LOCAIS = os.path.join(RAIZ, "maciel", "inc", "ifc_parafusos_locais.json")

# nome citado na fase -> local (ordem importa: o mais específico primeiro)
LOCAIS = [
    ("MQ REFEITÓRIO E VESTIÁRIO", "Marquise Refeitório/Vestiário"),
    ("MQ REF. E VEST", "Marquise Refeitório/Vestiário"),
    ("PASSARELA", "Passarela"), ("PASARELA", "Passarela"),
    ("PONTO DE ÔNIBUS", "Ponto de ônibus"), ("PONTO DE ONIBUS", "Ponto de ônibus"),
    ("VIVÊNCIA", "Área de vivência"), ("VIVENCIA", "Área de vivência"),
    ("ECLUSA", "Eclusa"), ("PORTARIA", "Portaria"),
    ("REFEITÓRIO", "Refeitório"), ("REFEITORIO", "Refeitório"),
    ("VESTIÁRIO", "Vestiário"), ("VESTIARIO", "Vestiário"),
]
GENERICOS = ("ANEXOS",)   # fase de anexos sem prédio definido (telha, calha, linha de vida)


class FB:
    """Leitor mínimo de FlatBuffers (tabelas, vetores e textos) — suficiente para o TRB8."""

    def __init__(s, caminho):
        with open(caminho, "rb") as g:
            s.b = g.read()
        s.n = len(s.b)
        if s.b[4:8] != b"TRB8":
            raise ValueError("não é um TRB8: " + caminho)

    def u32(s, o): return struct.unpack_from("<I", s.b, o)[0]
    def i32(s, o): return struct.unpack_from("<i", s.b, o)[0]

    def tbl(s, t):
        if t < 0 or t + 4 > s.n or t % 4:
            return None
        vt = t - s.i32(t)
        if vt < 0 or vt + 4 > s.n or vt % 2:
            return None
        vs, ts = struct.unpack_from("<HH", s.b, vt)
        if vs < 4 or vs > 400 or vs % 2 or ts < 4 or t + ts > s.n or vt + vs > s.n:
            return None
        offs = struct.unpack_from("<%dH" % ((vs - 4) // 2), s.b, vt + 4)
        if any(o >= ts or (o and o < 4) for o in offs):
            return None
        return offs

    def string(s, t):
        if t < 0 or t + 5 > s.n:
            return None
        L = s.u32(t)
        if L > 2000 or t + 5 + L > s.n or s.b[t + 4 + L] != 0:
            return None
        try:
            return s.b[t + 4:t + 4 + L].decode("utf-8")
        except UnicodeDecodeError:
            return None

    def campo(s, t, fi):
        """Posição do vetor/tabela apontado pelo campo `fi` da tabela `t` (None se ausente)."""
        offs = s.tbl(t)
        if offs is None or fi >= len(offs) or not offs[fi]:
            return None
        p = t + offs[fi]
        return p + s.u32(p)

    def vetor_u32(s, t):
        n = s.u32(t)
        return struct.unpack_from("<%dI" % n, s.b, t + 4)

    def vetor_textos(s, t):
        n = s.u32(t)
        return [s.string(t + 4 + 4 * k + s.u32(t + 4 + 4 * k)) for k in range(n)]


def carregar(caminho):
    f = FB(caminho)
    raiz = f.u32(0)
    r0, r1 = f.campo(raiz, 0), f.campo(raiz, 1)
    textos = f.vetor_textos(f.campo(r1, 16))
    props = f.vetor_textos(f.campo(r1, 9))
    v11 = f.campo(r1, 11)
    dbl = struct.unpack_from("<%dd" % f.u32(v11), f.b, v11 + 4)
    # modelos de propriedades: índice -> lista de nomes
    tp = f.campo(r1, 10)
    modelos = {}
    for k in range(f.u32(tp)):
        t = tp + 4 + 4 * k + f.u32(tp + 4 + 4 * k)
        v = f.campo(t, 1)
        if v is None:
            continue
        m = f.u32(v)
        if m > 2000 or v + 4 + 4 * m > f.n:
            continue
        w = struct.unpack_from("<%dI" % m, f.b, v + 4)
        modelos[k] = [props[x] for x in w[0::2] if x < len(props)]
    # linhas de propriedades
    v7 = f.campo(r1, 7)
    linhas = []
    for k in range(f.u32(v7)):
        t = v7 + 4 + 4 * k + f.u32(v7 + 4 + 4 * k)
        offs = f.tbl(t)
        mod = f.u32(t + offs[0]) if offs[0] else 0
        valores = f.vetor_u32(f.campo(t, 1))
        ids = f.vetor_u32(f.campo(t, 2))
        linhas.append((mod, valores, ids))
    vm = f.campo(r0, 0)
    n = f.u32(vm)
    pos = np.array([struct.unpack_from("<3d", f.b, vm + 4 + 64 * i + 16) for i in range(n)])
    return f, textos, dbl, modelos, linhas, pos


def local_da_fase(fase, padrao=None):
    up = (fase or "").upper()
    for chave, local in LOCAIS:
        if chave in up:
            return local
    if any(g in up for g in GENERICOS):
        return "Anexos (geral)"
    return padrao


def extrair(caminho):
    f, S, D, modelos, linhas, pos = carregar(caminho)
    m_bolt = [k for k, v in modelos.items() if "NUMBER" in v and "TIPO" in v]
    m_kit = [k for k, v in modelos.items() if "Washer count" in v]
    m_fase = {k: v.index("PHASE.NAME") for k, v in modelos.items() if "PHASE.NAME" in v}
    if not m_bolt:
        raise ValueError("sem parafusos neste modelo: " + caminho)
    txt = lambda i: S[i] if 0 <= i < len(S) and S[i] is not None else ""
    dd = lambda i: D[i] if 0 <= i < len(D) else 0.0

    # fase de cada peça (entidade com posição)
    fase_de = {}
    for mod, val, ids in linhas:
        if mod in m_fase and m_fase[mod] < len(val):
            ph = txt(val[m_fase[mod]])
            for e in ids:
                fase_de[e] = ph
    # kit (arruelas, porcas, local de montagem) por conjunto
    kit_de = {}
    for mod, val, ids in linhas:
        if mod in m_kit and len(val) >= 12:
            arr, por = txt(val[3]), txt(val[6])
            kit = {"arruelas": 0 if "FALSA" in arr.upper() else val[0], "arruela": "" if "FALSA" in arr.upper() else arr,
                   "porcas": 0 if "FALSA" in por.upper() else val[4], "porca": "" if "FALSA" in por.upper() else por,
                   "montagem": txt(val[10]), "norma": txt(val[14]) if len(val) > 14 else ""}
            for e in ids:
                kit_de[e] = kit

    conjuntos = []
    for mod, val, ids in linhas:
        if mod not in m_bolt or len(val) < 8:
            continue
        n, tipo, _, _, d_furo, prf, d_parafuso, comp = val[:8]
        for e in ids:
            conjuntos.append({"id": e, "n": n, "tipo": txt(tipo), "prf": txt(prf), "furo": dd(d_furo),
                              "diametro": dd(d_parafuso), "comprimento": dd(comp)})
    ids_bolt = {c["id"] for c in conjuntos}

    # peças com fase e posição (sem os conjuntos de parafuso) servem de referência de localização
    ref_ids = np.array([e for e in fase_de if e not in ids_bolt and e < len(pos) and np.abs(pos[e]).sum() > 0])
    ref_pos = pos[ref_ids]
    ref_fase = [fase_de[e] for e in ref_ids]
    ref_local = [local_da_fase(p) for p in ref_fase]
    padrao = local_da_fase(os.path.basename(caminho).replace("_", " ").upper())

    eb = np.array([c["id"] for c in conjuntos])
    pb = pos[eb]
    for ini in range(0, len(eb), 400):
        d = np.linalg.norm(pb[ini:ini + 400, None, :] - ref_pos[None, :, :], axis=2)
        for j in range(d.shape[0]):
            c = conjuntos[ini + j]
            dist = d[j]
            # prédios de peças a até 1,5 m (votação) — senão, a peça mais próxima
            perto = np.where(dist <= 1.5)[0]
            if len(perto):
                votos = collections.Counter(ref_local[i] for i in perto if ref_local[i] and ref_local[i] != "Anexos (geral)")
                if not votos:
                    votos = collections.Counter(ref_local[i] for i in perto if ref_local[i])
                local = votos.most_common(1)[0][0] if votos else None
            else:
                local = None
            mais = int(dist.argmin())
            if not local:
                local = ref_local[mais] or padrao or "Sem prédio"
            c["local"] = local
            c["fase"] = ref_fase[mais]
            c["dist_peca_m"] = round(float(dist[mais]), 2)
            c["x"], c["y"], c["z"] = (round(float(v), 3) for v in pos[c["id"]])
            c.update(kit_de.get(c["id"], {}))
    return {"arquivo": os.path.basename(caminho), "entidades": len(pos), "conjuntos": conjuntos}


def _agrupar(contador):
    """{'parafusos:X': 3, 'arruelas:Y': 3} -> {'parafusos': {'X': 3}, 'arruelas': {'Y': 3}}"""
    r = {}
    for k, v in contador.items():
        tipo, nome = k.split(":", 1)
        r.setdefault(tipo, {})[nome] = v
    return r


def resumir(modelos):
    por_local = collections.defaultdict(lambda: collections.Counter())
    por_tipo = {}
    arruelas, porcas = {}, {}
    por_local_fase = collections.defaultdict(lambda: collections.defaultdict(collections.Counter))
    por_local_tipo = collections.defaultdict(lambda: collections.Counter())
    for m in modelos:
        for c in m["conjuntos"]:
            k = (c["local"], c["tipo"], c["prf"], round(c["diametro"], 1), round(c["comprimento"], 1))
            r = por_local_tipo[k]
            r["conjuntos"] += 1
            r["qtd"] += c["n"]
            r["arruelas"] += c.get("arruelas", 0)
            r["porcas"] += c.get("porcas", 0)
            r["nome_arruela:" + (c.get("arruela") or "")] += c.get("arruelas", 0)
            r["nome_porca:" + (c.get("porca") or "")] += c.get("porcas", 0)
            if c.get("montagem") == "Site":
                r["em_obra"] += c["n"]
            por_local[c["local"]][c["tipo"] + "_conjuntos"] += 1
            por_local[c["local"]][c["tipo"] + "_qtd"] += c["n"]
            if c["tipo"] == "BOLT":
                por_local[c["local"]]["arruelas"] += c.get("arruelas", 0)
                por_local[c["local"]]["porcas"] += c.get("porcas", 0)
                lf = por_local_fase[c["local"]][c.get("fase") or "(sem fase)"]
                lf["parafusos:" + c["prf"]] += c["n"]
                if c.get("arruelas"):
                    lf["arruelas:" + c["arruela"]] += c["arruelas"]
                if c.get("porcas"):
                    lf["porcas:" + c["porca"]] += c["porcas"]
                t = por_tipo.setdefault(c["prf"], {"diametro_mm": round(c["diametro"], 1), "comprimento_mm": round(c["comprimento"], 1),
                                                   "qtd": 0, "locais": collections.Counter(), "arruelas": collections.Counter(),
                                                   "porcas": collections.Counter()})
                t["qtd"] += c["n"]
                t["locais"][c["local"]] += c["n"]
                if c.get("arruelas"):
                    t["arruelas"][c.get("arruela") or "(sem nome)"] += c["arruelas"]
                if c.get("porcas"):
                    t["porcas"][c.get("porca") or "(sem nome)"] += c["porcas"]
                for nome, q, dic in ((c.get("arruela"), c.get("arruelas", 0), arruelas), (c.get("porca"), c.get("porcas", 0), porcas)):
                    if q:
                        r = dic.setdefault(nome or "(sem nome)", {"qtd": 0, "locais": collections.Counter(), "parafusos": collections.Counter()})
                        r["qtd"] += q
                        r["locais"][c["local"]] += q
                        r["parafusos"][c["prf"]] += q
    fmt = lambda d: {k: dict(v, locais=dict(v["locais"]), parafusos=dict(v["parafusos"])) for k, v in sorted(d.items())}
    return {
        "por_local": {l: dict(v) for l, v in sorted(por_local.items())},
        "por_tipo": {p: dict(v, locais=dict(v["locais"]), arruelas=dict(v["arruelas"]), porcas=dict(v["porcas"])) for p, v in sorted(por_tipo.items())},
        "por_local_fase": {l: {f: _agrupar(c) for f, c in sorted(fs.items())} for l, fs in sorted(por_local_fase.items())},
        "por_arruela": fmt(arruelas),
        "por_porca": fmt(porcas),
        "por_local_tipo": [dict(local=k[0], tipo=k[1], prf=k[2], diametro_mm=k[3], comprimento_mm=k[4], **dict(v))
                           for k, v in sorted(por_local_tipo.items())],
    }


def main(caminhos):
    modelos = [extrair(c) for c in caminhos]
    resumo = resumir(modelos)
    resumo = {
        "observacao": "Parafusos lidos dos modelos TRB (os IFC R0A saem sem parafuso). TIPO BOLT = parafuso (qtd = NUMBER por conjunto); "
                      "TIPO HOLE = só furo, não conta como parafuso. Arruela/porca \"FALSA\" do modelo foi excluída das listas e dos totais. Local = prédio das peças vizinhas; coordenadas no sistema do projeto (m).",
        "fontes": [{"arquivo": m["arquivo"], "entidades": m["entidades"], "conjuntos_parafuso": len(m["conjuntos"])} for m in modelos],
        **resumo,
    }
    with open(SAIDA_RESUMO, "w", encoding="utf-8") as g:
        json.dump(resumo, g, ensure_ascii=False, indent=1)
    # registros por conjunto, compactos: colunas + linhas
    cols = ["modelo", "local", "tipo", "prf", "n", "arruelas", "porcas", "montagem", "x", "y", "z", "fase_vizinha", "dist_m", "arruela", "porca"]
    pools = {"modelo": [], "local": [], "tipo": [], "prf": [], "montagem": [], "fase_vizinha": [], "arruela": [], "porca": []}

    def ix(pool, v):
        if v not in pools[pool]:
            pools[pool].append(v)
        return pools[pool].index(v)

    linhas = []
    for m in modelos:
        for c in m["conjuntos"]:
            linhas.append([ix("modelo", m["arquivo"]), ix("local", c["local"]), ix("tipo", c["tipo"]), ix("prf", c["prf"]), c["n"],
                           c.get("arruelas", 0), c.get("porcas", 0), ix("montagem", c.get("montagem", "")),
                           c["x"], c["y"], c["z"], ix("fase_vizinha", c["fase"]), c["dist_peca_m"],
                           ix("arruela", c.get("arruela", "")), ix("porca", c.get("porca", ""))])
    with open(SAIDA_LOCAIS, "w", encoding="utf-8") as g:
        json.dump({"colunas": cols, "tabelas": pools, "linhas": linhas}, g, ensure_ascii=False, separators=(",", ":"))
    print("gravado:", SAIDA_RESUMO)
    print("gravado:", SAIDA_LOCAIS, "(%d conjuntos)" % len(linhas))
    for l, v in resumo["por_local"].items():
        print(f"  {l:32s} parafusos={v.get('BOLT_qtd', 0):6d} furos={v.get('HOLE_qtd', 0):6d}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    main(sys.argv[1:])
