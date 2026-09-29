"""Inventário quantitativo do galpão a partir do IFC (Tekla 2X3).

Lê o IFC uma vez e devolve, para cada família de peças, a distribuição por rua, faixa
e eixo — que é o que o módulo de baixa automática consome como "base de projeto".

Cada conjunto do IFC traz `Assembly/Cast unit position code`, no formato:
  - `NN/tr`      -> conjunto ancorado no eixo NN, trecho de letras `tr`
  - `NN-MM/tr`   -> conjunto na rua entre eixos NN e MM
Os trechos de letras (`A`, `A1-A`, `B-A3`, ...) caem em uma das 7 faixas do galpão
(AB, BC, CD, DE, EF, FG, GH). Os que ficam fora (bordas `A>` e `<H`, cumeeira
`<H-D1` / `D2-A>`) são registrados separadamente para não sumirem do inventário.

Uso: python ifc_inventario.py <arquivo.ifc> [saida.json]
Requer: pip install ifcopenshell
"""
import collections
import json
import os
import re
import sys

import ifcopenshell
import ifcopenshell.util.element as el

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

FAIXAS = ["AB", "BC", "CD", "DE", "EF", "FG", "GH"]
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

# a cumeeira do telhado principal está entre os eixos-letras D e E; DE ainda é dos dois lados
LADO_CUMEEIRA = {"AB": "EJ", "BC": "EJ", "CD": "EJ", "DE": "CUMEEIRA",
                 "EF": "CMM", "FG": "CMM", "GH": "CMM"}

# 4 parafusos por ponta da joist (regra da planilha teste claude, aba Fluxo_Baixa etapa 4)
PARAFUSOS_POR_PONTA_JOIST = 4


def parse_pos(pos):
    """Devolve (tipo, chave, trecho). tipo é 'eixo' ou 'rua' ou None."""
    if not pos or "/" not in pos:
        return None, None, None
    esq, trecho = pos.split("/", 1)
    if "-" in esq:
        a, b = esq.split("-", 1)
        return "rua", f"{a}-{b}", trecho
    return "eixo", esq, trecho


def perfil_do_filho(a):
    for r in a.IsDecomposedBy or []:
        for o in r.RelatedObjects:
            return o.ObjectType
    return None


def pos_do_pset(a):
    return el.get_psets(a).get("Tekla Assembly", {}).get(
        "Assembly/Cast unit position code") or ""


def fase_do_pset(a):
    return el.get_psets(a).get("ROTULA CONJUNTO", {}).get("PHASE.NAME") or ""


def coletar(caminho):
    """Percorre o IFC uma única vez e agrupa por família."""
    f = ifcopenshell.open(caminho)
    familias = collections.defaultdict(list)
    for a in f.by_type("IfcElementAssembly"):
        nome = a.Name or ""
        tipo, chave, trecho = parse_pos(pos_do_pset(a))
        familias[nome].append({
            "marca": a.Tag,
            "tipo": tipo,
            "chave": chave,
            "trecho": trecho,
            "faixa": FAIXA.get(trecho),
            "perfil": perfil_do_filho(a),
            "fase": fase_do_pset(a),
        })
    return familias


def resumir_por_chave(itens, chave):
    """Conta itens por (tipo, chave, faixa)."""
    r = collections.defaultdict(lambda: collections.Counter())
    fora = collections.Counter()
    for x in itens:
        if x["tipo"] is None:
            fora["sem_posicao"] += 1
            continue
        if chave == "faixa" and x["faixa"] is None:
            fora[x["trecho"] or "?"] += 1
            continue
        k = (x["tipo"], x["chave"])
        r[k][x["faixa"] or "OUTROS"] += 1
    return r, fora


def joists_por_rua_faixa(suportes_eixo_faixa, eixos_ordenados):
    """Converte a malha de suportes em joists projetadas.

    Regra da planilha: cada ponta de joist ocupa 4 suportes; 8 suportes por joist.
    Para a rua entre eixos N e M, contribuem os suportes do lado direito de N e
    do lado esquerdo de M. Como o IFC não distingue lado, usamos a metade da soma
    dos suportes de cada eixo (24 por faixa nos eixos internos, 24 nos extremos).
    """
    joists = {}
    for i, e in enumerate(eixos_ordenados[:-1]):
        m = eixos_ordenados[i + 1]
        rua = f"{e}-{m}"
        joists[rua] = {}
        for fx in FAIXAS:
            a = suportes_eixo_faixa.get(e, {}).get(fx, 0)
            b = suportes_eixo_faixa.get(m, {}).get(fx, 0)
            lado_e = a if e in (eixos_ordenados[0], eixos_ordenados[-1]) else a // 2
            lado_m = b if m in (eixos_ordenados[0], eixos_ordenados[-1]) else b // 2
            joists[rua][fx] = (lado_e + lado_m) // (2 * PARAFUSOS_POR_PONTA_JOIST)
    return joists


def montar_inventario(caminho):
    familias = coletar(caminho)

    # SUPORTE JOIST -> matriz eixo x faixa
    suportes = collections.defaultdict(lambda: collections.Counter())
    for x in familias.get("SUPORTE JOIST", []):
        if x["tipo"] == "eixo" and x["faixa"]:
            suportes[x["chave"]][x["faixa"]] += 1
    eixos = sorted(suportes)

    joists = joists_por_rua_faixa(
        {e: dict(v) for e, v in suportes.items()}, eixos)

    # porcas e arruelas por perfil (diâmetro) e eixo
    porcas_arruelas = collections.defaultdict(lambda: collections.Counter())
    for nome in ("PORCA", "ARRUELA"):
        for x in familias.get(nome, []):
            if x["perfil"] and x["tipo"]:
                porcas_arruelas[x["perfil"]][x["chave"]] += 1

    # famílias com resumo por (eixo|rua, faixa)
    por_chave = {}
    fora = {}
    for nome in ("TRAVAMENTO VIGA", "CLIPE ARANHA", "SUPORTE DE TERÇA",
                 "CONTRAVENTAMENTO", "APOIO PRINCIPAL", "APOIO INTERMEDIÁRIO",
                 "PILARETE", "VIGA COBERTURA", "VIGA", "TERÇA FECHAMENTO",
                 "MONTANTE", "MÃO FRANCESA", "CHUMBADOR", "CANTONEIRA",
                 "ESPAÇADOR FECHAMENTO", "SUPORTE"):
        itens = familias.get(nome, [])
        d, f = resumir_por_chave(itens, "faixa")
        por_chave[nome] = {
            "total": len(itens),
            "por_tipo_chave_faixa": {f"{t}:{c}": dict(v) for (t, c), v in d.items()},
        }
        if f:
            fora[nome] = dict(f)

    # telhas e itens de borda (cumeeira, calha, rufo) — sem faixa mas com totalização por borda
    bordas = {}
    for nome in ("TELHA COBERTURA", "TELHA FECHAMENTO", "TELHA MARQUISE",
                 "SUPORTE RUFO CUM.", "SUPORTE DE CALHA", "GRAPA",
                 "CALHA", "RUFO SUPERIOR", "RUFO PINGADEIRA", "RUFO TESTEIRA",
                 "RUFO CADEIRA", "RUFO OITÃO", "RUFO DE CANTO", "RUFO",
                 "TUBO DE QUEDA", "TERÇA MARQUISE"):
        itens = familias.get(nome, [])
        c = collections.Counter()
        for x in itens:
            c[x["trecho"] or "?"] += 1
        bordas[nome] = {"total": len(itens), "por_trecho": dict(c)}

    total = sum(len(v) for v in familias.values())
    return {
        "fonte": os.path.basename(caminho),
        "totais": {"conjuntos": total,
                   "familias": {n: len(v) for n, v in sorted(familias.items())}},
        "malha": {
            "faixas": FAIXAS,
            "eixos": eixos,
            "ruas": [f"{eixos[i]}-{eixos[i + 1]}" for i in range(len(eixos) - 1)],
            "lado_cumeeira": LADO_CUMEEIRA,
        },
        "regras_derivadas": {
            "parafusos_por_ponta_joist": PARAFUSOS_POR_PONTA_JOIST,
            "parafusos_por_joist": PARAFUSOS_POR_PONTA_JOIST * 2,
            "porca_e_arruela_por_parafuso": {"porca": 1, "arruela": 1},
        },
        "suportes_joist": {
            "por_eixo_faixa": {e: dict(v) for e, v in suportes.items()},
            "total": sum(sum(v.values()) for v in suportes.values()),
        },
        "joists_projetadas": {
            "por_rua_faixa": joists,
            "total": sum(sum(v.values()) for v in joists.values()),
            "por_rua": {r: sum(v.values()) for r, v in joists.items()},
        },
        "porcas_arruelas_por_perfil_e_eixo": {
            p: dict(c) for p, c in porcas_arruelas.items()},
        "familias": por_chave,
        "familias_fora_da_malha": fora,
        "bordas_e_cobertura": bordas,
    }


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    saida = sys.argv[2] if len(sys.argv) > 2 else os.path.join(
        RAIZ, "dados", "ifc_r0d_inventario.json")
    inv = montar_inventario(sys.argv[1])
    os.makedirs(os.path.dirname(saida), exist_ok=True)
    with open(saida, "w", encoding="utf-8") as g:
        json.dump(inv, g, ensure_ascii=False, indent=1)
    print(f"gravado: {saida}")
    print(f"conjuntos: {inv['totais']['conjuntos']}"
          f" | suportes: {inv['suportes_joist']['total']}"
          f" | joists projetadas: {inv['joists_projetadas']['total']}"
          f" ({inv['joists_projetadas']['total'] // (len(inv['malha']['ruas']) or 1)}"
          f" por rua)")
