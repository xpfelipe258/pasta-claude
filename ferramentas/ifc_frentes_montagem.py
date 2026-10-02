"""Inventário do IFC para as frentes de fechamento lateral, marquise e contraventamento.

Cada frente vira um mapa de apontamento no programa, com uma célula por trecho montável:

  fechamento        lado A e lado H (uma célula por rua) + oitão do eixo 01 e do 20 (uma por faixa)
  marquise          marquise A> e marquise <H (uma célula por rua)
  contraventamento  uma célula por rua e faixa (19 x 7), no plano da cobertura

O código de posição do Tekla ('Assembly/Cast unit position code') dá o endereço de cada peça:
`11-12/H` (rua entre os eixos 11 e 12, linha H), `01/D1-D` (eixo 01, trecho de letras D1-D),
`14a-15/<H` (rua, marquise do lado H). Eixos intermediários (01a, 02a...) caem na rua inteira.

Uso: python ifc_frentes_montagem.py <galpao.ifc> [saida.json]
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
# estações de letra da elevação, de A (topo) a H (base), como na planta do projeto
ESTACOES = ["A", "A1", "A2", "A3", "B", "B1", "B2", "C", "C1", "C2", "D", "D1", "D2",
            "E", "E1", "E2", "F", "F1", "F2", "G", "G1", "G2", "G3", "H"]
EIXOS = [f"{n:02d}" for n in range(1, 21)]
RUAS = [f"{EIXOS[i]}-{EIXOS[i + 1]}" for i in range(len(EIXOS) - 1)]

FAMILIAS = {
    # MONTANTE fica de fora: os 145 do IFC estão no miolo (letras C a F, Z~78 m), são da cumeeira, não do fechamento
    "fechamento": ["TERÇA FECHAMENTO", "ESPAÇADOR FECHAMENTO", "TELHA FECHAMENTO"],
    "marquise": ["TERÇA MARQUISE", "MÃO FRANCESA", "TELHA MARQUISE"],
    "contraventamento": ["CONTRAVENTAMENTO", "SUPORTE CONT."],
}
DE_FAMILIA = {f: frente for frente, fs in FAMILIAS.items() for f in fs}

# trecho de letras -> faixa entre eixos principais (a letra do meio do trecho decide)
_LETRAS = "ABCDEFGH"


def faixa_do_trecho(trecho):
    letras = sorted({c for c in re.findall(r"[A-H]", str(trecho or ""))})
    if not letras:
        return None
    i = _LETRAS.index(letras[0])
    j = _LETRAS.index(letras[-1])
    if j == i:                      # trecho dentro de uma única letra (ex.: A1-A) -> faixa que começa nela
        i, j = (i - 1, i) if i == len(_LETRAS) - 1 else (i, i + 1)
    return f"{_LETRAS[i]}{_LETRAS[i + 1]}" if j - i == 1 else f"{_LETRAS[i]}{_LETRAS[j]}"


def rua_do_codigo(codigo):
    """'11-12' e '11a-12' viram '11-12'; '12-12a' também (o eixo intermediário fica na rua anterior)."""
    nums = [int(n) for n in re.findall(r"\d+", str(codigo or ""))]
    if "-" not in str(codigo) or len(nums) < 2:
        return None
    a, b = min(nums), max(nums)
    if b == a:
        b = a + 1
    return f"{a:02d}-{a + 1:02d}" if a < 20 else None


def eixo_do_codigo(codigo):
    nums = re.findall(r"\d+", str(codigo or ""))
    return f"{int(nums[0]):02d}" if nums and "-" not in str(codigo) else None


def celula(frente, lugar, trecho):
    """Endereço da célula de apontamento: (parte do mapa, trecho)."""
    rua, eixo = rua_do_codigo(lugar), eixo_do_codigo(lugar)
    if eixo:                                             # peça ancorada num eixo serve a rua seguinte (20 -> 19-20)
        rua = f"{eixo}-{int(eixo) + 1:02d}" if int(eixo) < 20 else "19-20"
    if frente == "marquise":
        lado = "A>" if trecho in ("A>", "A") else "<H" if trecho in ("<H", "H") else None
        return (lado, rua) if lado and rua else None
    if frente == "contraventamento":
        return (faixa_do_trecho(trecho), rua) if rua else None
    if trecho in ("A", "H") and rua:                     # fechamento das laterais longas
        return (trecho, rua)
    if eixo_do_codigo(lugar) in ("01", "20"):            # oitões (fechamento do topo e do fundo)
        return (f"OITÃO {eixo_do_codigo(lugar)}", faixa_do_trecho(trecho))
    return None


def elevacao(contagem_bruta):
    """Vista elevada do contraventamento: um painel em X entre duas estações de letra, por rua.

    É assim que o projeto desenha (OF.198-MET-DM-001): as diagonais CTH ligam duas estações
    consecutivas dentro de uma rua, formando o X da elevação."""
    ordem = {e: i for i, e in enumerate(ESTACOES)}
    paineis = {}
    for (rua, trecho), familias in contagem_bruta.items():
        pontas = [e for e in re.split(r"-", trecho) if e in ordem]
        if len(pontas) != 2:
            continue
        de, ate = sorted(pontas, key=lambda e: ordem[e])
        chave = (rua, de, ate)
        alvo = paineis.setdefault(chave, collections.Counter())
        alvo.update(familias)
    return {"estacoes": ESTACOES, "ruas": RUAS,
            "paineis": [{"rua": r, "de": d, "ate": a, "pecas": dict(c), "total": sum(c.values())}
                        for (r, d, a), c in sorted(paineis.items(), key=lambda x: (x[0][0], ordem[x[0][1]]))]}


def extrair(caminho):
    arquivo = ifcopenshell.open(caminho)
    dono = {}
    for r in arquivo.by_type("IfcRelAggregates"):
        if r.RelatingObject.is_a("IfcElementAssembly"):
            for p in r.RelatedObjects:
                dono[p.id()] = r.RelatingObject
    contagem = {f: collections.defaultdict(collections.Counter) for f in FAMILIAS}
    bruta = collections.defaultdict(collections.Counter)   # (rua, trecho de letras) -> famílias, para a elevação
    fora = collections.Counter()
    for conjunto in set(dono.values()):
        familia = (conjunto.Name or "").split("/")[0].strip()
        frente = DE_FAMILIA.get(familia)
        if not frente:
            continue
        codigo = None
        for ps in el.get_psets(conjunto).values():
            for k, v in ps.items():
                if "position code" in k.lower():
                    codigo = v
        lugar, _, trecho = str(codigo or "").partition("/")
        if frente == "contraventamento":
            eixo = eixo_do_codigo(lugar.strip())
            rua = rua_do_codigo(lugar.strip()) or (f"{eixo}-{int(eixo) + 1:02d}" if eixo and int(eixo) < 20 else "19-20" if eixo else None)
            if rua:
                bruta[(rua, trecho.strip())][familia] += 1
        alvo = celula(frente, lugar.strip(), trecho.strip())
        if not alvo or not all(alvo):
            fora[f"{frente}/{familia}"] += 1
            continue
        contagem[frente]["|".join(alvo)][familia] += 1
    return contagem, bruta, fora


def montar(contagem, bruta):
    mapas = {
        "fechamento": {"titulo": "Fechamento lateral — estrutura", "servico": "FECH. LATERAL – ESTRUTURA",
                       "partes": [{"id": "A", "nome": "Lado A", "trechos": RUAS},
                                  {"id": "H", "nome": "Lado H", "trechos": RUAS},
                                  {"id": "OITÃO 01", "nome": "Oitão eixo 01", "trechos": FAIXAS},
                                  {"id": "OITÃO 20", "nome": "Oitão eixo 20", "trechos": FAIXAS}]},
        "marquise": {"titulo": "Marquise", "servico": "MARQUISE – TERÇAS",
                     "etapas": ["MARQUISE – VIGAS PRINCIPAIS", "MARQUISE – PRÉ-MONT. TERÇAS",
                                "MARQUISE – TERÇAS", "MARQUISE – TESTEIRA"],
                     "partes": [{"id": "A>", "nome": "Marquise lado A", "trechos": RUAS},
                                {"id": "<H", "nome": "Marquise lado H", "trechos": RUAS}]},
        # sem coluna própria no controle de produção: o apontamento serve de controle e não soma na produção
        "contraventamento": {"titulo": "Contraventamento da cobertura", "servico": None,
                             "partes": [{"id": f, "nome": f"Faixa {f}", "trechos": RUAS} for f in FAIXAS]},
    }
    for frente, mapa in mapas.items():
        g = contagem[frente]
        total = 0
        for parte in mapa["partes"]:
            parte["celulas"] = []
            for trecho in parte["trechos"]:
                pecas = dict(g.get(f"{parte['id']}|{trecho}", {}))
                parte["celulas"].append({"trecho": trecho, "pecas": pecas, "total": sum(pecas.values())})
            parte["total"] = sum(c["total"] for c in parte["celulas"])
            total += parte["total"]
            del parte["trechos"]
        mapa["total"] = total
        mapa["familias"] = FAMILIAS[frente]
    mapas["contraventamento"]["elevacao"] = elevacao(bruta)
    return mapas


def main():
    ifc = sys.argv[1] if len(sys.argv) > 1 else os.path.join(RAIZ, "LSF-MET-EX-200-200-BIM-R0D.ifc")
    saida = sys.argv[2] if len(sys.argv) > 2 else os.path.join(RAIZ, "dados", "ifc_frentes_montagem.json")
    contagem, bruta, fora = extrair(ifc)
    mapas = montar(contagem, bruta)
    with open(saida, "w", encoding="utf-8") as f:
        json.dump({"fonte": os.path.basename(ifc), "malha": {"eixos": EIXOS, "ruas": RUAS, "faixas": FAIXAS},
                   "frentes": mapas, "fora_do_mapa": dict(fora)}, f, ensure_ascii=False, indent=1)
    for nome, m in mapas.items():
        print(f"{nome:17} {m['total']:5} peças em {sum(len(p['celulas']) for p in m['partes'])} células "
              f"({', '.join(p['nome'] + ': ' + str(p['total']) for p in m['partes'])})")
    el = mapas["contraventamento"]["elevacao"]
    print(f"elevação do contraventamento: {len(el['paineis'])} painéis em X, {len(el['estacoes'])} estações")
    if fora:
        print("fora do mapa:", dict(fora))
    print("Gravado:", saida)


if __name__ == "__main__":
    main()
