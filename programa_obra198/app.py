"""Obra 198 — Sistema de Controle de Produção.

Servidor local que usa a planilha .xlsm como fonte de dados e armazenamento.
Execute:  python app.py  [caminho_da_planilha.xlsm]
"""
import datetime as dt
import glob
import json
import mimetypes
import os
import sys
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

import atualizador
import excel_io as xio

BASE = os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(BASE, "static")
CONFIG_PADRAO = {"planilha": "", "planilha_estoque": "", "porta": 8198, "acesso_rede": False, "abrir_navegador": True}

_trava = threading.Lock()
_cache = {"chave": None, "modelo": None}


def carregar_config():
    cfg = dict(CONFIG_PADRAO)
    caminho = os.path.join(BASE, "config.json")
    if os.path.exists(caminho):
        with open(caminho, encoding="utf-8") as f:
            cfg.update(json.load(f))
    if len(sys.argv) > 1:
        cfg["planilha"] = sys.argv[1]
    pastas = (BASE, os.path.dirname(BASE))
    candidatos = [p for pasta in pastas for ext in ("*.xlsm", "*.xlsx")
                  for p in sorted(glob.glob(os.path.join(pasta, ext))) if not os.path.basename(p).startswith("~$")]
    if not cfg["planilha"]:
        producao = [p for p in candidatos if xio.eh_planilha_producao(p)]
        if not producao:
            sys.exit("Nenhuma planilha de produção encontrada. Informe o caminho em config.json (campo \"planilha\").")
        cfg["planilha"] = producao[0]
    elif not os.path.isabs(cfg["planilha"]):
        cfg["planilha"] = os.path.join(BASE, cfg["planilha"])
    cfg["planilha"] = os.path.abspath(cfg["planilha"])
    if not os.path.exists(cfg["planilha"]):
        sys.exit(f"Planilha não encontrada: {cfg['planilha']}")
    est = cfg.get("planilha_estoque") or ""
    if est and not os.path.isabs(est):
        est = os.path.join(BASE, est)
    if not est:
        est = next((p for p in candidatos if os.path.abspath(p) != cfg["planilha"] and xio.eh_planilha_estoque(p)), "")
    cfg["planilha_estoque"] = os.path.abspath(est) if est and os.path.exists(est) else ""
    return cfg


CFG = None


def versao():
    st = os.stat(CFG["planilha"])
    v = f"{st.st_mtime_ns}-{st.st_size}"
    if CFG.get("planilha_estoque") and os.path.exists(CFG["planilha_estoque"]):
        v += f"-{os.stat(CFG['planilha_estoque']).st_mtime_ns}"
    return v


def modelo():
    v = versao()
    if _cache["chave"] != v:
        m = xio.ler_planilha(CFG["planilha"])
        m["estoque_externo"] = None
        if CFG.get("planilha_estoque"):
            try:
                m["estoque_externo"] = xio.ler_estoque_externo(CFG["planilha_estoque"])
            except Exception as e:
                print(f" Aviso: não foi possível ler a planilha de estoque ({e}).")
        _cache["modelo"] = m
        _cache["chave"] = v
    return _cache["modelo"]


def gravar(alteracoes):
    n = xio.gravar_celulas(CFG["planilha"], alteracoes,
                           pasta_backup=os.path.join(os.path.dirname(CFG["planilha"]), "backups_obra198"))
    _cache["chave"] = None
    return n


class ErroValidacao(Exception):
    pass


# ------------------------------------------------------------------ ações

def acao_producao(corpo):
    m = modelo()
    emp = next((e for e in m["empresas"] if e["aba"] == corpo.get("aba")), None)
    if not emp:
        raise ErroValidacao("Empresa inválida.")
    cols = {s["col"]: s for s in emp["servicos"]}
    alteracoes = []
    novos = {d: dict(r["v"]) for d, r in emp["registros"].items()}
    for a in corpo.get("alteracoes", []):
        data, col, valor = a.get("data"), a.get("col"), a.get("valor")
        linha = m["linhas_por_data"].get(data)
        if not linha:
            raise ErroValidacao(f"Data fora do calendário da planilha: {data}")
        if col != emp["col_obs"] and col not in cols:
            raise ErroValidacao(f"Coluna inválida: {col}")
        if isinstance(valor, str):
            valor = valor.strip()
            n = xio.numero(valor)
            if n is not None:
                valor = int(n) if float(n).is_integer() else n
        if valor == "":
            valor = None
        if col != emp["col_obs"] and isinstance(valor, (int, float)) and valor < 0:
            raise ErroValidacao("Quantidade não pode ser negativa.")
        alteracoes.append((emp["aba"], f"{col}{linha}", valor, None))
        if col in cols:
            if valor is None:
                novos.setdefault(data, {}).pop(col, None)
            else:
                novos.setdefault(data, {})[col] = valor

    # Mantém o "Realizado Semana" digitado em METAS EMPRESAS coerente com os lançamentos.
    nomes = {s["nome"]: c for c, s in cols.items()}
    tocadas = {(a.get("data"), a.get("col")) for a in corpo.get("alteracoes", [])}
    for meta in m["metas"]:
        if meta["empresa"] != emp["nome"] or not meta["realizado_manual"]:
            continue
        col = nomes.get(meta["servico"])
        if not col or not any(c == col and meta["inicio"] <= d <= meta["fim"] for d, c in tocadas):
            continue
        total = sum(v for d, vals in novos.items() if meta["inicio"] <= d <= meta["fim"]
                    for c, v in vals.items() if c == col and isinstance(v, (int, float)))
        alteracoes.append((xio.ABA_METAS, f"L{meta['linha']}", total, None))
    return gravar(alteracoes)


def acao_metas(corpo):
    linhas = {mt["linha"] for mt in modelo()["metas"]}
    alteracoes = []
    for a in corpo.get("alteracoes", []):
        lin = a.get("linha")
        if lin not in linhas:
            raise ErroValidacao(f"Linha de meta inválida: {lin}")
        for campo, col in (("meta_dia", "F"), ("du", "G"), ("gap", "I")):
            if campo in a:
                v = xio.numero(a[campo]) if a[campo] not in (None, "") else 0
                if v is None or v < 0 and campo != "gap":
                    raise ErroValidacao(f"Valor inválido em {campo}.")
                alteracoes.append((xio.ABA_METAS, f"{col}{lin}", v, None))
    return gravar(alteracoes)


def _eh_data(v):
    try:
        dt.date.fromisoformat(v)
        return True
    except (TypeError, ValueError):
        return False


def acao_impacto(corpo):
    lin = corpo.get("linha")
    if lin is None:
        lin = xio.primeira_linha_impacto_livre(CFG["planilha"])
        if lin is None:
            raise ErroValidacao("A LISTA DE IMPACTO está cheia (linhas 5 a 34).")
    elif lin not in xio.LINHAS_IMPACTO:
        raise ErroValidacao("Linha de impacto inválida.")
    alteracoes = []
    if corpo.get("excluir"):
        for col in "BCDEFGH":
            alteracoes.append((xio.ABA_IMPACTO, f"{col}{lin}", None, None))
        return gravar(alteracoes)
    campos = (("data", "B"), ("servico", "C"), ("motivo", "D"), ("solucionado", "E"),
              ("tempo", "F"), ("quando", "G"), ("paralisacao", "H"))
    for campo, col in campos:
        if campo not in corpo:
            continue
        v = corpo[campo]
        v = v.strip() if isinstance(v, str) else v
        alteracoes.append((xio.ABA_IMPACTO, f"{col}{lin}", v or None, "data" if _eh_data(v) else None))
    return gravar(alteracoes)


def acao_referencia(corpo):
    d = corpo.get("data")
    if not _eh_data(d):
        raise ErroValidacao("Data inválida.")
    return gravar([(xio.ABA_PAINEL, "B3", d, "data"), (xio.ABA_METAS, "B3", d, "data")])


def _proxima_linha_livre(tabela, reservadas=()):
    usadas = {r["linha"] for r in modelo()["tabelas"][tabela]} | set(reservadas)
    lin = xio.LINHA_DADOS_TABELA
    while lin in usadas:
        lin += 1
    return lin


def _garantir():
    xio.garantir_abas(CFG["planilha"], pasta_backup=os.path.join(os.path.dirname(CFG["planilha"]), "backups_obra198"))
    _cache["chave"] = None


def _preparar_campos(tabela, campos):
    campos = dict(campos)
    if tabela == "usos":
        litros, preco = xio.numero(campos.get("litros")), xio.numero(campos.get("preco_litro"))
        if litros and preco and not campos.get("custo_combustivel"):
            campos["custo_combustivel"] = round(litros * preco, 2)
    if tabela == "materiais" and not campos.get("codigo"):
        existentes = {m.get("codigo") for m in modelo()["tabelas"]["materiais"]}
        campos["codigo"] = next(f"MAT-{i:03d}" for i in range(1, 10000) if f"MAT-{i:03d}" not in existentes)
    if tabela == "movimentos" and campos.get("tipo"):
        campos["tipo"] = str(campos["tipo"]).upper()
        if campos["tipo"] not in ("ENTRADA", "SAÍDA", "AJUSTE"):
            raise ErroValidacao("Tipo de movimentação deve ser ENTRADA, SAÍDA ou AJUSTE.")
    return campos


def acao_registro(corpo):
    tabela = corpo.get("tabela")
    if tabela not in xio.TABELAS:
        raise ErroValidacao("Tabela inválida.")
    _garantir()
    spec = xio.TABELAS[tabela]
    lin = corpo.get("linha")
    if lin is not None and lin not in {r["linha"] for r in modelo()["tabelas"][tabela]}:
        raise ErroValidacao("Registro não encontrado (a planilha pode ter sido alterada). Recarregue a tela.")
    if corpo.get("excluir"):
        if lin is None:
            raise ErroValidacao("Informe o registro a excluir.")
        return gravar([(spec["aba"], f"{xio.col_letra(i)}{lin}", None, None) for i in range(1, len(spec["campos"]) + 1)])
    if lin is None:
        lin = _proxima_linha_livre(tabela)
    try:
        celulas = xio.valores_registro(tabela, _preparar_campos(tabela, corpo.get("campos") or {}))
    except ValueError as e:
        raise ErroValidacao(str(e))
    return gravar([(spec["aba"], f"{col}{lin}", v, t) for col, v, t in celulas])


def acao_importar_equip(corpo):
    _garantir()
    m = modelo()
    ja = {u.get("origem") for u in m["tabelas"]["usos"] if u.get("origem")}
    novos = [r for r in xio.extrair_usos_mensais(CFG["planilha"]) if r["origem"] not in ja]
    alteracoes, reservadas = [], []
    for r in novos:
        r["equipamento"] = r.get("equipamento") or "NÃO INFORMADO"
        lin = _proxima_linha_livre("usos", reservadas)
        reservadas.append(lin)
        for col, v, t in xio.valores_registro("usos", r):
            alteracoes.append((xio.TABELAS["usos"]["aba"], f"{col}{lin}", v, t))
    cadastrados = {e.get("equipamento") for e in m["tabelas"]["equipamentos"]}
    reservadas = []
    for nome in sorted({r["equipamento"] for r in novos} - cadastrados):
        custos = [r["custo"] for r in novos if r["equipamento"] == nome and r.get("custo")]
        valor = max(set(custos), key=custos.count) if custos else None
        tipo = ("GUINDASTE" if "SANY" in nome or "GUINDASTE" in nome else "PLATAFORMA (PTA)" if "SKYJACK" in nome
                else "MUNCK" if "MUNCK" in nome else None)
        lin = _proxima_linha_livre("equipamentos", reservadas)
        reservadas.append(lin)
        campos = {"equipamento": nome, "tipo": tipo, "cobranca": "DIÁRIA" if valor else None, "valor": valor,
                  "situacao": "ATIVO", "obs": "Cadastrado pela importação das abas mensais"}
        for col, v, t in xio.valores_registro("equipamentos", campos):
            alteracoes.append((xio.TABELAS["equipamentos"]["aba"], f"{col}{lin}", v, t))
    gravar(alteracoes)
    return {"importados": len(novos)}


ACOES = {
    "/api/registro": acao_registro,
    "/api/equip/importar": acao_importar_equip,
    "/api/producao": acao_producao,
    "/api/metas": acao_metas,
    "/api/impacto": acao_impacto,
    "/api/referencia": acao_referencia,
}


# --------------------------------------------------------------- servidor

class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def _json(self, status, obj):
        dados = json.dumps(obj, ensure_ascii=False, default=str).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(dados)))
        self.end_headers()
        self.wfile.write(dados)

    def do_GET(self):
        caminho = urlparse(self.path).path
        try:
            if caminho == "/api/versao":
                return self._json(200, {"versao": versao()})
            if caminho == "/api/dados":
                with _trava:
                    m = modelo()
                    v = _cache["chave"]
                return self._json(200, {
                    "versao": v,
                    "recursos": {"importar_mensal": True, "exportar": True},
                    "arquivo": os.path.basename(CFG["planilha"]),
                    "modificado": dt.datetime.fromtimestamp(os.path.getmtime(CFG["planilha"])).isoformat(timespec="seconds"),
                    "modelo": {k: v for k, v in m.items() if k != "linhas_por_data"},
                })
            if caminho == "/api/exportar":
                with _trava:
                    m = modelo()
                pacote = {"formato": "obra198", "versao_formato": 1,
                          "gerado_em": dt.datetime.now().isoformat(timespec="seconds"),
                          "origem": os.path.basename(CFG["planilha"]),
                          "obra": {"nome": "OBRA 198", "data_inicio": m["datas"][0], "data_fim": m["datas"][-1]},
                          "modelo": {k: v for k, v in m.items() if k != "linhas_por_data"}}
                dados = json.dumps(pacote, ensure_ascii=False, default=str).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Disposition", 'attachment; filename="obra198_dados.json"')
                self.send_header("Content-Length", str(len(dados)))
                self.end_headers()
                self.wfile.write(dados)
                return
        except Exception as e:  # leitura falhou (ex.: Excel salvando o arquivo no momento)
            return self._json(503, {"erro": f"Não foi possível ler a planilha: {e}"})
        self._estatico(caminho)

    def _estatico(self, caminho):
        if caminho in ("", "/"):
            caminho = "/index.html"
        arq = os.path.realpath(os.path.join(STATIC, caminho.lstrip("/")))
        if not arq.startswith(os.path.realpath(STATIC) + os.sep) or not os.path.isfile(arq):
            self.send_error(404)
            return
        with open(arq, "rb") as f:
            dados = f.read()
        tipo = mimetypes.guess_type(arq)[0] or "application/octet-stream"
        if tipo.startswith("text/") or tipo.endswith("javascript"):
            tipo += "; charset=utf-8"
        self.send_response(200)
        self.send_header("Content-Type", tipo)
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Content-Length", str(len(dados)))
        self.end_headers()
        self.wfile.write(dados)

    def do_POST(self):
        acao = ACOES.get(urlparse(self.path).path)
        if not acao:
            return self._json(404, {"erro": "Ação desconhecida."})
        try:
            tam = int(self.headers.get("Content-Length") or 0)
            corpo = json.loads(self.rfile.read(tam) or b"{}")
            with _trava:
                n = acao(corpo)
                v = versao()
            resp = {"ok": True, "versao": v}
            resp.update(n if isinstance(n, dict) else {"celulas": n})
            self._json(200, resp)
        except ErroValidacao as e:
            self._json(400, {"erro": str(e)})
        except xio.CelulaProtegida as e:
            self._json(409, {"erro": str(e)})
        except xio.PlanilhaBloqueada as e:
            self._json(423, {"erro": str(e)})
        except Exception as e:
            self._json(500, {"erro": f"Falha ao gravar: {e}"})


def verificar_atualizacao():
    if os.environ.get("OBRA198_SEM_ATUALIZAR"):
        return
    caminho = os.path.join(BASE, "config.json")
    arquivo = {}
    if os.path.exists(caminho):
        with open(caminho, encoding="utf-8") as f:
            arquivo = json.load(f)
    arquivo = atualizador.configurar_token(caminho, arquivo)
    if atualizador.atualizar(BASE, arquivo.get("atualizacao")):
        sys.exit(3)  # INICIAR.bat reinicia com o código novo


def main():
    global CFG
    verificar_atualizacao()
    CFG = carregar_config()
    host = "0.0.0.0" if CFG["acesso_rede"] else "127.0.0.1"
    porta = int(CFG["porta"])
    try:
        criadas = xio.garantir_abas(CFG["planilha"], pasta_backup=os.path.join(os.path.dirname(CFG["planilha"]), "backups_obra198"))
        if criadas:
            print(" Abas criadas na planilha: " + ", ".join(criadas))
    except xio.PlanilhaBloqueada:
        print(" Aviso: planilha aberta no Excel; as abas novas serão criadas no primeiro salvamento.")
    modelo()
    srv = ThreadingHTTPServer((host, porta), Handler)
    url = f"http://localhost:{porta}"
    print("=" * 60)
    print(" OBRA 198 — Controle de Produção")
    print(f" Planilha: {CFG['planilha']}")
    print(f" Estoque:  {CFG['planilha_estoque'] or 'não encontrada (opcional: campo planilha_estoque no config.json)'}")
    print(f" Acesse:   {url}")
    if CFG["acesso_rede"]:
        print(" Acesso pela rede local habilitado (use o IP deste computador).")
    print(" Para encerrar, feche esta janela ou pressione Ctrl+C.")
    print("=" * 60)
    if CFG["abrir_navegador"]:
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
