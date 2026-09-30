"""Desenho de montagem (planta colorida) -> dados compactos -> apontamento de regularização.

Convenção do desenho: eixos numerados no topo (círculos vermelhos); estações de viga A..H (quadrados azuis) de cima
para baixo; barras amarelas horizontais = joists montadas (uma coluna de ~43 por rua, 6 por faixa); faixas amarelas
verticais sobre os eixos = vigas montadas; verde = peças feitas marcadas à mão (faixa vertical entre estações = vigas,
pontos dentro da rua = joists); cinza = pendente.

Uso:
  python ferramentas/desenho_montagem.py extrair desenho.png dados/desenho_montagem_AAAA-MM-DD.json
  python ferramentas/desenho_montagem.py carregar dados/desenho_montagem_AAAA-MM-DD.json PLANILHA.xlsm [--rotulo 30/09/2026]

Requer numpy e Pillow. "carregar" grava linhas em APONTAMENTO MONTAGEM com "Somou na produção? = NÃO" (regularização):
não altera a grade de produção já lançada. Joists ficam com a empresa do lado (AB a DE = EJ, EF a GH = CMM); vigas do
lado EJ (A a DE) ficam EJ e as do lado CMM ficam "A DEFINIR" (quem montou é definido na tela).
"""
import argparse
import datetime as dt
import json
import os
import sys
from collections import deque

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FAIXAS = ["AB", "BC", "CD", "DE", "EF", "FG", "GH"]
ESTACOES = list("ABCDEFGH")
# vigas (letras) que pertencem a cada segmento entre estações consecutivas
LETRAS_SEGMENTO = [["A"], ["B", "BC"], ["C", "CD"], ["D", "DE"], ["E", "EF"], ["F", "FG"], ["G", "H"]]
POSICOES = {"AB": ["A", "B"], "BC": ["B", "BC", "C"], "CD": ["C", "CD", "D"], "DE": ["D", "DE", "E"],
            "EF": ["E", "EF", "F"], "FG": ["F", "FG", "G"], "GH": ["G", "H"]}
LADO_EJ_FAIXAS = {"AB", "BC", "CD", "DE"}
LADO_EJ_LETRAS = {"A", "B", "BC", "C", "CD", "D", "DE"}
JOISTS_POR_FAIXA = 6
# Como as 6 joists de cada faixa se distribuem entre as vigas de apoio (de cima para baixo). O desenho não mostra em
# qual viga cada joist apoia; este padrão (1/4/1 nas faixas com viga intermediária, 3/3 nas de borda) é o que mais
# se aproxima das retiradas físicas de parafuso FG005/FG006/FG007 (erro de 12 pontos percentuais, contra 46 dos
# terços iguais e 19 do padrão 1/3/2 da planilha). É uma estimativa: corrija no mapa se souber a distribuição real.
DISTRIBUICAO = {3: [1, 4, 1], 2: [3, 3]}
COBERTURA_BARRA = 0.42  # fração amarela mínima de uma faixa horizontal para contar a barra como montada


def _mascaras(png):
    import numpy as np
    from PIL import Image
    im = np.array(Image.open(png).convert("RGB")).astype(int)
    r, g, b = im[..., 0], im[..., 1], im[..., 2]
    return {
        "amarelo": (r > 200) & (g > 200) & (b < 150),
        "azul": (r < 60) & (g < 70) & (b > 60) & (b < 140),
        "verde": (g > 200) & (r < 130) & (b > 110) & (b < 200) & (abs(g - b) > 25),
        "vermelho": (r > 180) & (g < 60) & (b < 60),
    }, im.shape


def _grupos(valores, tol):
    saida, cur = [], []
    for v in sorted(valores):
        if cur and v - cur[-1] > tol:
            saida.append(cur)
            cur = []
        cur.append(v)
    if cur:
        saida.append(cur)
    return saida


def _componentes(mask, minimo):
    alt, larg = mask.shape
    visto = mask.copy() * 0 != 0
    comps = []
    for y in range(alt):
        for x in range(larg):
            if mask[y, x] and not visto[y, x]:
                fila, pts = deque([(y, x)]), []
                visto[y, x] = True
                while fila:
                    cy, cx = fila.popleft()
                    pts.append((cy, cx))
                    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        ny, nx = cy + dy, cx + dx
                        if 0 <= ny < alt and 0 <= nx < larg and mask[ny, nx] and not visto[ny, nx]:
                            visto[ny, nx] = True
                            fila.append((ny, nx))
                if len(pts) >= minimo:
                    ys, xs = [p[0] for p in pts], [p[1] for p in pts]
                    comps.append({"px": len(pts), "x0": min(xs), "x1": max(xs), "y0": min(ys), "y1": max(ys)})
    return comps


def _eixos_e_estacoes(m, shape):
    import numpy as np
    alt, larg = shape[:2]
    ys, xs = np.where(m["vermelho"][: int(alt * 0.09), :])
    colunas = [int(np.mean(g)) for g in _grupos(set(xs.tolist()), 3) if len(g) >= 3]
    # o último eixo numerado do desenho é o 20; numera de trás para frente a partir dele
    numeros = list(range(20 - len(colunas) + 1, 21))
    eixos = dict(zip(numeros, colunas))
    ny, nx = np.where(m["azul"])
    ys_est = []
    for x in colunas:
        sel = abs(nx - x) <= 7
        ys_est += [int(np.mean(g)) for g in _grupos(set(ny[sel].tolist()), 2) if len(g) >= 3]
    centros = [int(np.median(g)) for g in _grupos(ys_est, 8) if len(g) >= 3]
    if len(centros) != len(ESTACOES):
        sys.exit(f"Esperava {len(ESTACOES)} estações de viga (A..H) e achei {len(centros)}: {centros}")
    return eixos, dict(zip(ESTACOES, centros))


def extrair(png):
    m, shape = _mascaras(png)
    eixos, est = _eixos_e_estacoes(m, shape)
    amarelo = m["amarelo"]
    ys = [est[e] for e in ESTACOES]
    joists, vigas = {}, {}
    numeros = sorted(eixos)
    for e in numeros[:-1]:
        xa, xb = eixos[e] + 9, min(eixos[e] + 40, eixos[e + 1] - 6)
        lin = amarelo[:, xa:xb].mean(axis=1)
        rua = f"{e:02d}-{e + 1:02d}"
        por_faixa = {}
        for k, f in enumerate(FAIXAS):
            a, b = ys[k], ys[k + 1]
            slots = []
            for j in range(JOISTS_POR_FAIXA):
                ya, yb = int(round(a + (b - a) * j / JOISTS_POR_FAIXA)), int(round(a + (b - a) * (j + 1) / JOISTS_POR_FAIXA))
                slots.append(int(lin[ya:yb].mean() > COBERTURA_BARRA))
            por_faixa[f] = slots
        if any(any(s) for s in por_faixa.values()):
            joists[rua] = por_faixa
    for e in numeros:
        xa, xb = eixos[e] - 3, eixos[e] + 4
        letras = []
        for k in range(7):
            if amarelo[ys[k] + 4: ys[k + 1] - 4, xa:xb].mean() > 0.45:
                letras += LETRAS_SEGMENTO[k]
        if letras:
            vigas[f"{e:02d}"] = letras

    # verde: faixa vertical sobre o eixo = vigas do segmento; ponto dentro da rua = joist
    verde_vigas, verde_joists = {}, []
    verde = m["verde"].copy()
    verde[int(shape[0] * 0.94):, :] = False  # barra de fase na base do desenho
    for c in _componentes(verde, 12):
        cx, altura = (c["x0"] + c["x1"]) / 2, c["y1"] - c["y0"]
        eixo = next((e for e in numeros if abs(eixos[e] - cx) <= 8), None)
        if eixo is not None and altura >= 25:
            for k in range(7):
                sobreposto = min(c["y1"], ys[k + 1]) - max(c["y0"], ys[k])
                if sobreposto >= 0.5 * (ys[k + 1] - ys[k]):
                    verde_vigas.setdefault(f"{eixo:02d}", []).extend(LETRAS_SEGMENTO[k])
        else:
            e = max((n for n in numeros if eixos[n] < cx), default=None)
            if e is None or e + 1 not in eixos:
                continue
            k = next((i for i in range(7) if ys[i] <= (c["y0"] + c["y1"]) / 2 < ys[i + 1]), None)
            if k is None:
                continue
            n_pontos = max(1, round(c["px"] / 80))
            for i in range(n_pontos):
                y = c["y0"] + (c["y1"] - c["y0"]) * (i + 0.5) / n_pontos
                j = min(JOISTS_POR_FAIXA - 1, int((y - ys[k]) / (ys[k + 1] - ys[k]) * JOISTS_POR_FAIXA))
                verde_joists.append({"rua": f"{e:02d}-{e + 1:02d}", "faixa": FAIXAS[k], "slot": j})
    return {
        "fonte": os.path.basename(png), "gerado_em": dt.date.today().isoformat(),
        "metodo": "cor: amarelo=montada, verde=marcada à mão como feita, cinza=pendente; 6 barras por faixa (slots de cima para baixo)",
        "eixos_px": {str(k): v for k, v in eixos.items()}, "estacoes_px": est,
        "joists_amarelo": joists, "vigas_amarelo": vigas,
        "verde": {"vigas": verde_vigas, "joists": verde_joists},
    }


def _letra_do_slot(faixa, j):
    pos, acumulado = POSICOES[faixa], 0
    for letra, n in zip(pos, DISTRIBUICAO[len(pos)]):
        acumulado += n
        if j < acumulado:
            return letra
    return pos[-1]


def linhas_do_desenho(dados, rotulo):
    """Devolve as linhas de apontamento (um registro por rua/faixa/viga de apoio e por viga)."""
    obs = f"Histórico conciliado com o desenho de {rotulo}"
    cont = {}
    for rua, faixas in dados["joists_amarelo"].items():
        for f, slots in faixas.items():
            for j, feito in enumerate(slots):
                if feito:
                    cont[(rua, f, _letra_do_slot(f, j))] = cont.get((rua, f, _letra_do_slot(f, j)), 0) + 1
    for p in dados["verde"]["joists"]:
        chave = (p["rua"], p["faixa"], _letra_do_slot(p["faixa"], p["slot"]))
        cont[chave] = cont.get(chave, 0) + 1
    linhas = []
    for (rua, f, letra), n in sorted(cont.items()):
        linhas.append({"data": None, "empresa": "EJ" if f in LADO_EJ_FAIXAS else "CMM", "tipo": "JOIST", "rua": rua,
                       "faixa": f, "letra": letra, "qtd": n, "lanca_producao": "NÃO", "obs": obs})
    vigas = {e: set(ls) for e, ls in dados["vigas_amarelo"].items()}
    for e, ls in dados["verde"]["vigas"].items():
        vigas.setdefault(e, set()).update(ls)
    crit = json.load(open(os.path.join(RAIZ, "programa_obra198", "regras_baixa.json"), encoding="utf-8"))["criterio_por_letra"]
    ordem = list(crit)
    for e in sorted(vigas):
        for letra in sorted(vigas[e], key=ordem.index):
            linhas.append({"data": None, "empresa": "EJ" if letra in LADO_EJ_LETRAS else "A DEFINIR", "tipo": "VIGA",
                           "eixo": e, "letra": letra, "viga_id": f"E{e}-{letra}-{crit[letra]['viga']}", "qtd": 1,
                           "lanca_producao": "NÃO", "obs": obs})
    return linhas


def resumo(linhas):
    j = [l for l in linhas if l["tipo"] == "JOIST"]
    v = [l for l in linhas if l["tipo"] == "VIGA"]
    por = lambda ls, k: {e: sum(l["qtd"] for l in ls if l["empresa"] == e) for e in sorted({l["empresa"] for l in ls})}
    return {"joists": sum(l["qtd"] for l in j), "joists_por_empresa": por(j, "empresa"),
            "vigas": len(v), "vigas_por_empresa": por(v, "empresa")}


def carregar(dados, planilha, rotulo, refazer=False):
    sys.path.insert(0, os.path.join(RAIZ, "programa_obra198"))
    os.environ["OBRA198_SEM_ATUALIZAR"] = "1"
    import excel_io as xio
    backups = os.path.join(os.path.dirname(os.path.abspath(planilha)), "backups_obra198")
    xio.garantir_abas(planilha, pasta_backup=backups)
    existentes = xio.ler_planilha(planilha)["tabelas"]["apontamentos"]
    linhas = linhas_do_desenho(dados, rotulo)
    aba, celulas = xio.TABELAS["apontamentos"]["aba"], []
    antigos = [r for r in existentes if (r.get("obs") or "").startswith("Histórico conciliado com o desenho")]
    if antigos and not refazer:
        sys.exit("A planilha já tem apontamentos de histórico do desenho. Use --refazer para substituí-los.")
    for r in antigos:
        celulas += [(aba, f"{xio.col_letra(i)}{r['linha']}", None, None) for i in range(1, len(xio.TABELAS["apontamentos"]["campos"]) + 1)]
    existentes = [r for r in existentes if r not in antigos]
    ja_vigas = {r.get("viga_id") for r in existentes if (r.get("tipo") or "").upper() == "VIGA"}
    linhas = [l for l in linhas if l.get("viga_id") not in ja_vigas]
    lin = max([r["linha"] for r in xio.ler_planilha(planilha)["tabelas"]["apontamentos"]], default=xio.LINHA_DADOS_TABELA - 1) + 1
    for campos in linhas:
        for col, v, t in xio.valores_registro("apontamentos", campos):
            celulas.append((aba, f"{col}{lin}", v, t))
        lin += 1
    xio.gravar_celulas(planilha, celulas, pasta_backup=backups)
    return linhas


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    e = sub.add_parser("extrair")
    e.add_argument("png")
    e.add_argument("saida")
    c = sub.add_parser("carregar")
    c.add_argument("json")
    c.add_argument("planilha")
    c.add_argument("--rotulo", default=dt.date.today().strftime("%d/%m/%Y"))
    c.add_argument("--refazer", action="store_true", help="substitui o histórico do desenho já carregado")
    a = ap.parse_args()
    if a.cmd == "extrair":
        d = extrair(a.png)
        with open(a.saida, "w", encoding="utf-8") as f:
            json.dump(d, f, ensure_ascii=False, separators=(",", ":"))
        r = resumo(linhas_do_desenho(d, "rótulo"))
        print("Extraído:", json.dumps(r, ensure_ascii=False))
    else:
        d = json.load(open(a.json, encoding="utf-8"))
        linhas = carregar(d, a.planilha, a.rotulo, a.refazer)
        print("Gravado:", json.dumps(resumo(linhas), ensure_ascii=False))


if __name__ == "__main__":
    main()
