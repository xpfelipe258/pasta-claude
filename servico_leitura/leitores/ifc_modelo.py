"""Leitor dos IFC do Tekla (padrão Rótula): conjuntos por fase, lista de material, fixadores, malha de eixos e posição de cada peça.

Entrada: lista de (nome do arquivo, caminho do .ifc). Saída: dicionário JSON-serializável.
Convenções do modelo (propriedades lidas):
  ROTULA CONJUNTO  -> PHASE.NAME, ASSEMBLY NAME/MARK/PREFIX, WEIGHT_GROSS
  Tekla Assembly   -> Assembly/Cast unit position code ("V23/H10-H9": eixo vertical / faixa de eixos horizontais), elevações
  RÓTULA PARTE     -> PROFILE, LENGTH, MATERIAL, WEIGHT, NAME
  ROTULA PARAFUSO  -> NUMBER, TIPO (BOLT conta; HOLE é só furo), PRF_NAME   |  Tekla Bolt -> arruelas, porcas, Location (Site = obra)
"""
import collections
import re
import zipfile

import ifcopenshell
import ifcopenshell.util.element as E

_POS = re.compile(r"^<?\s*(V\d+[A-Za-z]?)(?:\s*-\s*(V\d+[A-Za-z]?))?\s*>?\s*/\s*(H\d+[A-Za-z]?)(?:\s*-\s*(H\d+[A-Za-z]?))?\s*>?$")
_FASE_NUM = re.compile(r"^\s*(\d+(?:\.\d+)+)\s+(.*)$")
_NUM_EIXO = re.compile(r"(\d+)")


def _ps(e, nome):
    try:
        return E.get_psets(e).get(nome) or {}
    except Exception:
        return {}


def _psets(e):
    try:
        return E.get_psets(e)
    except Exception:
        return {}


def _abrir(caminho):
    """Abre o .ifc (ou o primeiro .ifc dentro de um .zip)."""
    if zipfile.is_zipfile(caminho):
        raise ValueError("passe o .ifc já extraído")
    return ifcopenshell.open(caminho)


def posicao(codigo):
    """'V23/H10-H9' -> {'v': ['V23','V23'], 'h': ['H10','H9']}; vazio/estranho -> None."""
    if not codigo:
        return None
    m = _POS.match(str(codigo).strip())
    if not m:
        return None
    v1, v2, h1, h2 = m.group(1), m.group(2) or m.group(1), m.group(3), m.group(4) or m.group(3)
    return {"v": [v1, v2], "h": [h1, h2]}


def eixo_num(rotulo):
    m = _NUM_EIXO.search(rotulo or "")
    return int(m.group(1)) if m else 0


def fase_info(nome):
    """'3.1.5 ESM FECHAMENTO LATERAL' -> ('3.1.5', 'ESM FECHAMENTO LATERAL'); sem número -> ('', nome)."""
    nome = (nome or "").strip()
    m = _FASE_NUM.match(nome)
    return (m.group(1), m.group(2).strip()) if m else ("", nome)


def _tipo_fixador(nome):
    n = (nome or "").upper()
    if "ARRUELA" in n:
        return "arruela"
    if "PORCA" in n:
        return "porca"
    return "parafuso"


def _falso(nome):
    return "FALSA" in (nome or "").upper()


def ler(arquivos):
    """arquivos: [(nome, caminho)]. Devolve o pedaço 'modelo' do pacote."""
    conjuntos = []          # um por conjunto (assembly)
    vistos = set()
    duplicados = 0
    eixos = {"V": {}, "H": {}}
    resumo_arquivos = []
    fix_total = collections.Counter()     # (fase, tipo, nome) -> qtd
    fix_furos = 0
    fix_falsos = 0
    avisos = []
    for nome_arq, caminho in arquivos:
        f = _abrir(caminho)
        n_conj = n_fix = 0
        for g in f.by_type("IfcGrid"):
            for ax in list(g.UAxes or []) + list(g.VAxes or []):
                tag = (ax.AxisTag or "").strip()
                if tag[:1] in ("V", "H"):
                    eixos[tag[0]][tag] = eixo_num(tag)
        for a in f.by_type("IfcElementAssembly"):
            gid = a.GlobalId
            if gid in vistos:
                duplicados += 1
                continue
            vistos.add(gid)
            ps = _psets(a)
            rc, ta = ps.get("ROTULA CONJUNTO") or {}, ps.get("Tekla Assembly") or {}
            fase = (rc.get("PHASE.NAME") or "").strip()
            nome = (rc.get("ASSEMBLY NAME") or a.Name or "").strip()
            marca = rc.get("ASSEMBLY MARK") or ta.get("Assembly/Cast unit Mark") or a.Tag or ""
            peso = rc.get("WEIGHT_GROSS")
            if peso is None:
                peso = ta.get("Assembly/Cast unit weight")
            perfil, material, comp, peso_main, area, larg = "", "", 0.0, -1.0, 0.0, 0.0
            filhos = []
            try:
                filhos = list(E.get_decomposition(a))
            except Exception:
                pass
            partes = collections.Counter()
            for o in filhos:
                if o.is_a("IfcMechanicalFastener"):
                    n_fix += 1
                    pp = _ps(o, "ROTULA PARAFUSO")
                    tb = _ps(o, "Tekla Bolt")
                    if (pp.get("TIPO") or "").upper() == "HOLE":
                        fix_furos += 1
                        continue
                    if (tb.get("Location") or "Site") != "Site":
                        continue          # montado na oficina: não é parafuso de obra
                    nm = pp.get("PRF_NAME") or o.Name or ""
                    qtd = int(pp.get("NUMBER") or tb.get("Bolt count") or 1)
                    if not _falso(nm):
                        fix_total[(fase, "parafuso", nm)] += qtd
                    else:
                        fix_falsos += qtd
                    for chave, cont in (("Washer name", "Washer count"), ("Nut name", "Nut count")):
                        nn = tb.get(chave) or ""
                        qq = int(tb.get(cont) or 0)
                        if nn and qq:
                            if _falso(nn):
                                fix_falsos += qq
                            else:
                                fix_total[(fase, _tipo_fixador(nn), nn)] += qq
                    continue
                pr = _ps(o, "RÓTULA PARTE") or _ps(o, "ROTULA PARTE")
                if pr:
                    p = pr.get("WEIGHT") or 0.0
                    partes[(pr.get("NAME") or o.Name or "", pr.get("PROFILE") or "", pr.get("MATERIAL") or "")] += 1
                    if p > peso_main:
                        peso_main, perfil, material, comp = p, pr.get("PROFILE") or "", pr.get("MATERIAL") or "", pr.get("LENGTH") or 0.0
                        tq = _ps(o, "Tekla Quantity")
                        area, larg = float(tq.get("Net surface area") or 0.0), float(tq.get("Width") or 0.0)
            pos = posicao(ta.get("Assembly/Cast unit position code"))
            conjuntos.append({
                "arquivo": nome_arq, "fase": fase, "produto": nome, "marca": marca, "perfil": perfil, "material": material,
                "comprimento_mm": round(float(comp or 0), 1), "largura_mm": round(larg, 1), "area_m2": round(area, 3), "peso_kg": round(float(peso or 0), 3), "pos": pos,
                "cota": (ta.get("Assembly/Cast unit bottom elevation") or "").strip(),
                "partes": [{"nome": k[0], "perfil": k[1], "material": k[2], "qtd": n} for k, n in partes.items()],
            })
            n_conj += 1
        resumo_arquivos.append({"arquivo": nome_arq, "conjuntos": n_conj, "fixadores": n_fix})
    if duplicados:
        avisos.append("%d conjunto(s) repetido(s) entre os arquivos (mesmo GUID) foram contados uma só vez." % duplicados)

    # fases
    fases = collections.OrderedDict()
    for c in conjuntos:
        d = fases.setdefault(c["fase"], {"fase": c["fase"], "conjuntos": 0, "peso_kg": 0.0})
        d["conjuntos"] += 1
        d["peso_kg"] += c["peso_kg"]
    for d in fases.values():
        d["codigo"], d["titulo"] = fase_info(d["fase"])
        d["peso_kg"] = round(d["peso_kg"], 1)

    # lista de material (conjunto = produto + perfil, por fase)
    agg = collections.OrderedDict()
    for c in conjuntos:
        k = (c["fase"], c["produto"], c["perfil"])
        d = agg.setdefault(k, {"fase": c["fase"], "produto": c["produto"], "perfil": c["perfil"], "material": c["material"], "qtd": 0, "peso_kg": 0.0, "comprimento_mm": 0.0, "area_m2": 0.0})
        d["qtd"] += 1
        d["peso_kg"] += c["peso_kg"]
        d["comprimento_mm"] += c["comprimento_mm"]
        d["area_m2"] += c["area_m2"]
    material = []
    for d in agg.values():
        d["peso_kg"] = round(d["peso_kg"], 2)
        d["peso_unit_kg"] = round(d["peso_kg"] / d["qtd"], 3) if d["qtd"] else 0
        d["comprimento_total_m"] = round(d.pop("comprimento_mm") / 1000.0, 2)
        d["area_m2"] = round(d["area_m2"], 2)
        material.append(d)
    material.sort(key=lambda d: (fase_info(d["fase"])[0].zfill(12) if fase_info(d["fase"])[0] else "~" + d["fase"], d["produto"], d["perfil"]))

    fixadores = [{"fase": k[0], "tipo": k[1], "nome": k[2], "qtd": n} for k, n in sorted(fix_total.items(), key=lambda x: (x[0][0], x[0][1], x[0][2]))]
    sem_pos = sum(1 for c in conjuntos if not c["pos"])
    return {
        "arquivos": resumo_arquivos,
        "malha": {"V": sorted(eixos["V"], key=eixo_num), "H": sorted(eixos["H"], key=eixo_num)},
        "fases": list(fases.values()),
        "material": material,
        "fixadores": fixadores,
        "fixadores_resumo": {"furos_sem_parafuso": fix_furos, "falsos_excluidos": fix_falsos},
        "conjuntos": conjuntos,
        "totais": {"conjuntos": len(conjuntos), "peso_kg": round(sum(c["peso_kg"] for c in conjuntos), 1), "sem_posicao": sem_pos,
                   "parafusos": sum(n for (fa, t, nm), n in fix_total.items() if t == "parafuso")},
        "avisos": avisos,
    }
