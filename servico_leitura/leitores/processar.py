"""Fase 2: lê todos os documentos da obra e monta o "pacote" (JSON) que o sistema PHP revisa e publica."""
import datetime
import re
import unicodedata

from . import cronograma, fixadores, ifc_modelo, orcamento, projetos

VERSAO_PACOTE = 1
_PARADAS = {"de", "da", "do", "das", "dos", "e", "a", "o", "em", "para", "com", "no", "na", "nas", "nos", "ao", "instalacao", "montagem", "estrutura"}


def _norm(s):
    s = unicodedata.normalize("NFD", s or "").encode("ascii", "ignore").decode().lower()
    return [w for w in re.findall(r"[a-z0-9]+", s) if w not in _PARADAS and len(w) > 1]


def _similar(a, b):
    A, B = set(_norm(a)), set(_norm(b))
    return len(A & B) / len(A | B) if A and B else 0.0


def _cruzar(modelo, bm, crono):
    """Liga fase do IFC ↔ item do BM, monta a lista de material por item/serviço, resume as telhas e sugere atividade do BM para cada tarefa do cronograma."""
    avisos = []
    itens = {i["codigo"]: i for i in bm["itens"]}
    fase_item, sem_item = {}, []
    for f in modelo["fases"]:
        cod = f["codigo"]
        if cod and cod in itens:
            fase_item[f["fase"]] = cod
        else:
            sem_item.append(f["fase"])
    itens_sem_fase = [c for c in itens if c not in fase_item.values()]
    material_por_item = {}
    for m in modelo["material"]:
        cod = fase_item.get(m["fase"])
        if cod:
            material_por_item.setdefault(cod, []).append({k: m[k] for k in ("produto", "perfil", "qtd", "peso_kg", "area_m2", "comprimento_total_m")})
    telhas = [m for m in modelo["material"] if re.search(r"TELHA", m["produto"], re.I)]
    resumo_telhas = {"conjuntos": sum(m["qtd"] for m in telhas), "area_m2": round(sum(m["area_m2"] for m in telhas), 1),
                     "por_produto": [{"fase": m["fase"], "produto": m["produto"], "perfil": m["perfil"], "qtd": m["qtd"], "area_m2": m["area_m2"], "comprimento_total_m": m["comprimento_total_m"]} for m in telhas]}
    atividades = [dict(a, item=i["codigo"]) for i in bm["itens"] for a in i["atividades"]]
    ligacoes = []
    for t in crono.get("atividades", []):
        melhor, nota = None, 0.0
        for a in atividades:
            s = _similar(t["nome"], a["descricao"] + " " + itens[a["item"]]["descricao"])
            if s > nota:
                melhor, nota = a, s
        ligacoes.append({"tarefa": t["nome"], "atividade": melhor["descricao"] if melhor and nota >= 0.45 else "", "item": melhor["item"] if melhor and nota >= 0.45 else "", "confianca": round(nota, 2)})
    if sem_item:
        avisos.append("Fases do IFC sem item correspondente no BM (ficam sem atividade de medição): " + "; ".join(sem_item[:10]) + ("…" if len(sem_item) > 10 else ""))
    if itens_sem_fase:
        avisos.append("Itens do BM sem fase correspondente no IFC: " + ", ".join(itens_sem_fase[:10]))
    return {"fase_para_item": fase_item, "fases_sem_item": sem_item, "itens_sem_fase": itens_sem_fase, "material_por_item": material_por_item,
            "telhas": resumo_telhas, "tarefa_para_atividade": ligacoes, "avisos": avisos}


def _nome_fixador(chave_):
    """Nome padrão da TAG a partir da chave (PARAF. Ø1/2" X 1 1/2" A307)."""
    t = chave_.split("|")
    if t[0] == "hardbolt":
        return "HARDBOLT %sX%s" % (t[1], t[2])

    def frac(v):
        if not v:
            return ""
        x = float(v)
        inteiro, resto = int(x), round(x - int(x), 3)
        fr = {0.125: "1/8", 0.25: "1/4", 0.375: "3/8", 0.5: "1/2", 0.625: "5/8", 0.75: "3/4", 0.875: "7/8"}.get(resto, "")
        return ("%d %s" % (inteiro, fr)).strip() if inteiro and fr else (fr or str(inteiro))
    rotulo = {"parafuso": "PARAF.", "parabolt": "PARABOLT", "ab": "PARAF. AB", "porca": "PORCA", "arruela": "ARRUELA"}[t[0]]
    nome = '%s Ø%s"' % (rotulo, t[1])
    if len(t) > 2 and t[2]:
        nome += ' X %s"' % frac(t[2])
    if len(t) > 3 and t[3]:
        nome += " " + t[3].replace("GR8", "Gr.8")
    return nome


def _confrontar_fixadores(modelo, lista):
    """Confere, por chave (tipo + diâmetro + comprimento + norma), os fixadores do IFC com a lista em planilha."""
    ifc, pl = {}, {}
    for f in modelo["fixadores"]:
        if f.get("chave"):
            ifc[f["chave"]] = ifc.get(f["chave"], 0) + f["qtd"]
    for f in lista:
        if f.get("chave"):
            pl[f["chave"]] = pl.get(f["chave"], 0) + f["qtd"]
    return [{"chave": k, "nome": _nome_fixador(k), "ifc": ifc.get(k, 0), "lista": pl.get(k, 0)} for k in sorted(set(ifc) | set(pl))]


def montar(docs, nome_obra=""):
    """docs: {tipo: [(nome, caminho)]} com os tipos ifc, fixadores, cronograma, orcamento, projetos."""
    avisos, erros = [], []
    ifcs = docs.get("ifc") or []
    modelo = ifc_modelo.ler(ifcs) if ifcs else None
    bm = {"itens": [], "avisos": [], "periodos": [], "escopo": [], "contrato_total": None, "aba": ""}
    lidos = [(nome, orcamento.ler(caminho)) for nome, caminho in docs.get("orcamento") or []]
    if lidos:
        # o que traz atividades de medição (memorial / BM) manda; os demais só completam o escopo e os boletins
        lidos.sort(key=lambda x: (-sum(len(i["atividades"]) for i in x[1]["itens"]), -len(x[1]["itens"])))
        bm = lidos[0][1]
        for nome, outro in lidos[1:]:
            if not bm["periodos"] and outro["periodos"]:
                bm["periodos"] = outro["periodos"]
            if not bm["escopo"] and outro["escopo"]:
                bm["escopo"] = outro["escopo"]
            bm["avisos"].append("Planilha %s usada só como complemento (a de medição com atividades é %s)." % (nome, lidos[0][0]))
        if not bm["itens"] or not any(i["atividades"] for i in bm["itens"]):
            bm["avisos"].append("Nenhuma planilha de orçamento trouxe as atividades de medição (memorial de cálculo do BM): cada item vira uma única atividade.")
    crono = cronograma.ler(docs["cronograma"][0][1], docs["cronograma"][0][0]) if docs.get("cronograma") else {"atividades": [], "avisos": []}
    fix = {"geral": [], "por_joist": [], "avisos": []}
    for nome, caminho in docs.get("fixadores") or []:
        r = fixadores.ler(caminho, nome)
        fix["geral"] += r["geral"]
        fix["por_joist"] += r["por_joist"]
        fix["avisos"] += r["avisos"]
    for f in fix["geral"]:
        f["chave"] = fixadores.chave(f["descricao"], f.get("norma", ""))
    for b in fix["por_joist"]:
        for f in b["itens"]:
            f["chave"] = fixadores.chave(f["descricao"], f.get("norma", ""))
    if modelo:
        for f in modelo["fixadores"]:
            f["chave"] = fixadores.chave(f["nome"])
    proj = projetos.ler_varios(docs.get("projetos") or [])
    for parte in (bm, crono, fix, proj):
        avisos += parte.get("avisos", [])
    if modelo:
        avisos += modelo.get("avisos", [])
    cruz = _cruzar(modelo, bm, crono) if modelo else {"avisos": []}
    avisos += cruz.get("avisos", [])
    conf = _confrontar_fixadores(modelo, fix["geral"]) if modelo and fix["geral"] else []
    dif = [c for c in conf if c["ifc"] and c["lista"] and abs(c["ifc"] - c["lista"]) / max(c["ifc"], c["lista"]) > 0.1]
    so_ifc = [c for c in conf if c["ifc"] and not c["lista"]]
    if dif or so_ifc:
        avisos.append("Fixadores: %d tipo(s) com quantidade diferente entre o IFC e a lista em planilha e %d só no IFC (a lista em planilha vale onde existe; veja a revisão)." % (len(dif), len(so_ifc)))
    if not modelo:
        erros.append("Nenhum IFC para ler.")
    elif not modelo["conjuntos"]:
        erros.append("O IFC não trouxe conjuntos (IfcElementAssembly).")
    return {
        "versao": VERSAO_PACOTE, "gerado_em": datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=-3))).strftime("%Y-%m-%d %H:%M"),
        "obra": nome_obra, "modelo": modelo, "bm": bm, "cronograma": crono, "fixadores": fix, "fixadores_confronto": conf, "projetos": proj,
        "cruzamentos": cruz, "avisos": avisos, "erros": erros,
    }
