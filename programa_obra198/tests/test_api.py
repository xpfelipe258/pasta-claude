"""Testes de integração da API do programa Python (programa_obra198).

Cada execução copia o programa, as planilhas e a pasta dados/ para um diretório temporário e sobe o servidor
nessa cópia (atualização automática desligada). Nada na pasta real é alterado.

Uso:  python -m unittest discover -s programa_obra198/tests -v
"""
import glob
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request

AQUI = os.path.dirname(os.path.abspath(__file__))
PROGRAMA = os.path.dirname(AQUI)
REPO = os.path.dirname(PROGRAMA)


def _porta_livre():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Servidor:
    def __init__(self):
        self.tmp = tempfile.mkdtemp(prefix="obra198_teste_")
        self.prog = os.path.join(self.tmp, "programa_obra198")
        shutil.copytree(PROGRAMA, self.prog, ignore=shutil.ignore_patterns("__pycache__", "tests", "backups_obra198"))
        for arq in glob.glob(os.path.join(REPO, "*.xlsm")) + glob.glob(os.path.join(REPO, "*.xlsx")):
            shutil.copy(arq, self.tmp)
        shutil.copytree(os.path.join(REPO, "dados"), os.path.join(self.tmp, "dados"))
        self.porta = _porta_livre()
        with open(os.path.join(self.prog, "config.json"), "w", encoding="utf-8") as f:
            json.dump({"planilha": "", "porta": self.porta, "acesso_rede": False, "abrir_navegador": False,
                       "atualizacao": {"ativo": False}}, f)
        env = dict(os.environ, OBRA198_SEM_ATUALIZAR="1", PYTHONIOENCODING="utf-8")
        self.log = open(os.path.join(self.tmp, "servidor.log"), "w")
        self.proc = subprocess.Popen([sys.executable, "app.py"], cwd=self.prog, env=env,
                                     stdout=self.log, stderr=subprocess.STDOUT)
        self.base = f"http://127.0.0.1:{self.porta}"
        self._esperar()

    def _esperar(self):
        limite = time.time() + 90
        while time.time() < limite:
            if self.proc.poll() is not None:
                raise RuntimeError("Servidor encerrou ao iniciar:\n" + self.ler_log())
            try:
                urllib.request.urlopen(self.base + "/api/versao", timeout=2).read()
                return
            except OSError:
                time.sleep(0.5)
        raise RuntimeError("Servidor não respondeu a tempo:\n" + self.ler_log())

    def ler_log(self):
        self.log.flush()
        with open(os.path.join(self.tmp, "servidor.log"), encoding="utf-8", errors="replace") as f:
            return f.read()

    def parar(self):
        self.proc.terminate()
        try:
            self.proc.wait(10)
        except subprocess.TimeoutExpired:
            self.proc.kill()
        self.log.close()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def get(self, caminho):
        with urllib.request.urlopen(self.base + caminho, timeout=60) as r:
            return json.load(r)

    def post(self, caminho, corpo):
        req = urllib.request.Request(self.base + caminho, data=json.dumps(corpo).encode("utf-8"),
                                     headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.status, json.load(r)
        except urllib.error.HTTPError as e:
            return e.code, json.load(e)

    def modelo(self):
        return self.get("/api/dados")["modelo"]


SRV = None


def setUpModule():
    global SRV
    SRV = Servidor()


def tearDownModule():
    if SRV:
        SRV.parar()


def celula(modelo, nome_empresa, data, servico):
    emp = next(e for e in modelo["empresas"] if e["nome"] == nome_empresa)
    col = next(s["col"] for s in emp["servicos"] if s["nome"] == servico)
    return emp["registros"].get(data, {}).get("v", {}).get(col) or 0


class TestLeitura(unittest.TestCase):
    def test_dados_tem_empresas_datas_e_tabelas(self):
        m = SRV.modelo()
        self.assertEqual({e["nome"] for e in m["empresas"]}, {"EJ", "CMM", "GLOBO AÇOS"})
        self.assertGreater(len(m["datas"]), 300)
        self.assertEqual(m["datas"], sorted(m["datas"]))
        for tabela in ("materiais", "movimentos", "apontamentos", "estoque_remessas"):
            self.assertIn(tabela, m["tabelas"])

    def test_cada_servico_tem_coluna_unica_por_empresa(self):
        for e in SRV.modelo()["empresas"]:
            colunas = [s["col"] for s in e["servicos"]]
            self.assertEqual(len(colunas), len(set(colunas)), e["nome"])

    def test_versao_muda_quando_planilha_muda(self):
        antes = SRV.get("/api/versao")["versao"]
        m = SRV.modelo()
        data = m["referencia"]
        atual = celula(m, "EJ", data, "VIGAS")
        status, _ = SRV.post("/api/producao", {"aba": "CONTROLE EJ", "alteracoes": [{"data": data, "col": "D", "valor": atual + 1}]})
        self.assertEqual(status, 200)
        depois = SRV.get("/api/versao")["versao"]
        self.assertNotEqual(antes, depois)
        SRV.post("/api/producao", {"aba": "CONTROLE EJ", "alteracoes": [{"data": data, "col": "D", "valor": atual or None}]})

    def test_regras_frentes_planejamento_e_exportar(self):
        regras = SRV.get("/api/regras-baixa")
        self.assertIn("PREMONTAGEM", regras["consumo_por_servico"])
        self.assertEqual(regras["limites_ifc"]["joists_por_rua_maximo"], 43)
        self.assertIn("frentes", SRV.get("/api/frentes-montagem"))
        self.assertIn("setores", SRV.get("/api/planejamento"))
        pacote = SRV.get("/api/exportar")
        self.assertEqual(pacote["formato"], "obra198")
        self.assertIsNotNone(pacote["estoque_planilha"])

    def test_estatico_serve_index_e_bloqueia_fuga_de_pasta(self):
        with urllib.request.urlopen(SRV.base + "/") as r:
            self.assertEqual(r.status, 200)
            self.assertIn(b"<html", r.read(2000).lower())
        for caminho in ("/../app.py", "/..%2fapp.py", "/%2e%2e/config.json"):
            try:
                urllib.request.urlopen(SRV.base + caminho)
                self.fail(f"{caminho} devia ser negado")
            except urllib.error.HTTPError as e:
                self.assertEqual(e.code, 404, caminho)

    def test_acao_desconhecida_retorna_404(self):
        status, corpo = SRV.post("/api/nao-existe", {})
        self.assertEqual(status, 404)
        self.assertIn("erro", corpo)


class TestProducao(unittest.TestCase):
    ABA = "CONTROLE EJ"

    def _enviar(self, data, col, valor):
        return SRV.post("/api/producao", {"aba": self.ABA, "alteracoes": [{"data": data, "col": col, "valor": valor}]})

    def test_validacoes(self):
        m = SRV.modelo()
        data = m["referencia"]
        self.assertEqual(SRV.post("/api/producao", {"aba": "NAO EXISTE", "alteracoes": []})[0], 400)
        self.assertEqual(self._enviar("1999-01-01", "B", 1)[0], 400, "data fora do calendário")
        self.assertEqual(self._enviar(data, "ZZ", 1)[0], 400, "coluna inexistente")
        self.assertEqual(self._enviar(data, "B", -3)[0], 400, "quantidade negativa")

    def test_baixa_automatica_gera_saidas_proporcionais_a_regra(self):
        m = SRV.modelo()
        data = m["referencia"]
        regras = SRV.get("/api/regras-baixa")
        itens = regras["consumo_por_servico"]["PREMONTAGEM"]["itens"]
        antes = celula(m, "EJ", data, "PREMONTAGEM")
        movs_antes = len(m["tabelas"]["movimentos"])

        status, resp = self._enviar(data, "B", antes + 3)
        self.assertEqual(status, 200, resp)
        baixa = {b["codigo"]: b["quantidade"] for b in resp["baixa_auto"]}
        for it in itens:
            self.assertAlmostEqual(baixa[it["codigo"]], round(it["por_unidade"] * 3, 2), msg=it["codigo"])

        m2 = SRV.modelo()
        self.assertEqual(celula(m2, "EJ", data, "PREMONTAGEM"), antes + 3)
        novos = m2["tabelas"]["movimentos"][movs_antes:]
        self.assertEqual(len(novos), len(itens))
        for mov in novos:
            self.assertEqual(mov["tipo"], "SAÍDA")
            self.assertEqual(mov["empresa"], "EJ")
            self.assertEqual(mov["data"], data)
            self.assertTrue(mov["documento"].startswith("BAIXA AUTO"))
        self.assertEqual(len({mov["linha"] for mov in novos}), len(novos), "linhas de movimento não podem colidir")

        # reler o mesmo valor não duplica a baixa
        self._enviar(data, "B", antes + 3)
        self.assertEqual(len(SRV.modelo()["tabelas"]["movimentos"]), movs_antes + len(itens))

    def test_reduzir_producao_nao_gera_nova_saida(self):
        """Comportamento atual: reduzir a produção não estorna a baixa já feita (nem gera saída negativa)."""
        m = SRV.modelo()
        data = m["referencia"]
        base = celula(m, "EJ", data, "PREMONTAGEM")
        self._enviar(data, "B", base + 2)
        total = len(SRV.modelo()["tabelas"]["movimentos"])
        status, resp = self._enviar(data, "B", base)
        self.assertEqual(status, 200)
        self.assertNotIn("baixa_auto", resp)
        self.assertEqual(len(SRV.modelo()["tabelas"]["movimentos"]), total)

    def test_gravacoes_simultaneas_nao_se_perdem(self):
        m = SRV.modelo()
        datas = m["datas"][-8:]
        antes = {d: celula(m, "CMM", d, "PREMONTAGEM") for d in datas}
        resultados = []

        def gravar(d):
            resultados.append(SRV.post("/api/producao", {"aba": "CONTROLE CMM", "alteracoes": [{"data": d, "col": "B", "valor": antes[d] + 7}]})[0])

        fios = [threading.Thread(target=gravar, args=(d,)) for d in datas]
        [f.start() for f in fios]
        [f.join() for f in fios]
        self.assertEqual(resultados, [200] * len(datas))
        m2 = SRV.modelo()
        for d in datas:
            self.assertEqual(celula(m2, "CMM", d, "PREMONTAGEM"), antes[d] + 7, d)

    def test_cada_gravacao_cria_backup(self):
        pasta = os.path.join(SRV.tmp, "backups_obra198")
        m = SRV.modelo()
        data = m["referencia"]
        self._enviar(data, "D", celula(m, "EJ", data, "VIGAS") + 1)
        self.assertTrue(os.path.isdir(pasta))
        self.assertGreaterEqual(len(os.listdir(pasta)), 1)
        self._enviar(data, "D", celula(m, "EJ", data, "VIGAS") or None)


class TestApontamento(unittest.TestCase):
    def _joists_usadas(self, rua):
        ap = SRV.modelo()["tabelas"]["apontamentos"]
        return {a["slot"] for a in ap if (a.get("tipo") or "").upper() == "JOIST" and a.get("rua") == rua and a.get("slot")}

    def _joist(self, rua, slots, data, empresa="EJ", **extra):
        return SRV.post("/api/apontamento", {"data": data, "lote": [{"tipo": "JOIST", "empresa": empresa, "rua": rua, "slots": slots}], **extra})

    def test_joist_soma_na_grade_e_excluir_desfaz(self):
        m = SRV.modelo()
        data = m["referencia"]
        livres = [s for s in range(1, 44) if s not in self._joists_usadas("11-12")][:2]
        self.assertEqual(len(livres), 2, "precisa de 2 slots livres na rua 11-12")
        grade_antes = celula(m, "EJ", data, "IÇAMENTO JOIST")
        n_antes = len(m["tabelas"]["apontamentos"])

        status, resp = self._joist("11-12", livres, data)
        self.assertEqual(status, 200, resp)
        self.assertEqual(resp["salvos"], 2)
        m2 = SRV.modelo()
        self.assertEqual(celula(m2, "EJ", data, "IÇAMENTO JOIST"), grade_antes + 2)
        self.assertEqual(len(m2["tabelas"]["apontamentos"]), n_antes + 2)
        novos = [a for a in m2["tabelas"]["apontamentos"] if a["linha"] in resp["linhas"]]
        self.assertEqual({a["slot"] for a in novos}, set(livres))
        self.assertTrue(all(a["faixa"] and a["letra"] for a in novos), "faixa e letra vêm do layout")

        status, _ = SRV.post("/api/apontamento", {"excluir": True, "linhas": resp["linhas"]})
        self.assertEqual(status, 200)
        m3 = SRV.modelo()
        self.assertEqual(celula(m3, "EJ", data, "IÇAMENTO JOIST"), grade_antes)
        self.assertEqual(len(m3["tabelas"]["apontamentos"]), n_antes)

    @unittest.expectedFailure
    def test_excluir_apontamento_estorna_a_baixa_de_estoque(self):
        """Defeito conhecido: excluir remove a produção da grade, mas as saídas BAIXA AUTO continuam na MOVIMENTAÇÃO ESTOQUE."""
        m = SRV.modelo()
        data = m["referencia"]
        livre = next(s for s in range(1, 44) if s not in self._joists_usadas("14-15"))
        saidas_antes = sum(x["quantidade"] for x in m["tabelas"]["movimentos"] if x["tipo"] == "SAÍDA")
        _, resp = self._joist("14-15", [livre], data)
        SRV.post("/api/apontamento", {"excluir": True, "linhas": resp["linhas"]})
        saidas_depois = sum(x["quantidade"] for x in SRV.modelo()["tabelas"]["movimentos"] if x["tipo"] == "SAÍDA")
        self.assertAlmostEqual(saidas_depois, saidas_antes, msg="a baixa de estoque devia voltar ao valor anterior")

    def test_joist_ja_apontada_e_recusada(self):
        usadas = sorted(self._joists_usadas("11-12"))
        self.assertTrue(usadas)
        status, resp = self._joist("11-12", [usadas[0]], SRV.modelo()["referencia"])
        self.assertEqual(status, 400)
        self.assertIn("já foi apontada", resp["erro"])

    def test_entradas_invalidas(self):
        data = SRV.modelo()["referencia"]
        self.assertEqual(self._joist("11-13", [1], data)[0], 400, "rua com eixos não consecutivos")
        self.assertEqual(self._joist("99-98", [1], data)[0], 400, "eixos inexistentes")
        self.assertEqual(self._joist("11-12", [44], data)[0], 400, "slot acima de 43")
        self.assertEqual(self._joist("11-12", [0], data)[0], 400, "slot zero")
        self.assertEqual(self._joist("11-12", ["x"], data)[0], 400, "slot não numérico")
        self.assertEqual(self._joist("11-12", [1], data, empresa="NAO EXISTE")[0], 400, "empresa inexistente")
        self.assertEqual(self._joist("11-12", [1], "1999-01-01")[0], 400, "data fora do calendário")
        self.assertEqual(SRV.post("/api/apontamento", {"data": data, "lote": [{"tipo": "XYZ", "empresa": "EJ"}]})[0], 400)
        self.assertEqual(SRV.post("/api/apontamento", {"data": data, "lote": [{"tipo": "JOIST", "empresa": "EJ", "rua": "11-12", "slots": []}]})[0], 400, "nada selecionado")

    def test_lote_invalido_nao_grava_nada(self):
        m = SRV.modelo()
        data = m["referencia"]
        livre = next(s for s in range(1, 44) if s not in self._joists_usadas("11-12"))
        grade = celula(m, "EJ", data, "IÇAMENTO JOIST")
        n = len(m["tabelas"]["apontamentos"])
        status, _ = SRV.post("/api/apontamento", {"data": data, "lote": [
            {"tipo": "JOIST", "empresa": "EJ", "rua": "11-12", "slots": [livre]},
            {"tipo": "JOIST", "empresa": "EJ", "rua": "11-12", "slots": [99]},
        ]})
        self.assertEqual(status, 400)
        m2 = SRV.modelo()
        self.assertEqual(len(m2["tabelas"]["apontamentos"]), n)
        self.assertEqual(celula(m2, "EJ", data, "IÇAMENTO JOIST"), grade)

    def test_sem_lanca_producao_nao_altera_a_grade(self):
        m = SRV.modelo()
        data = m["referencia"]
        livre = next(s for s in range(1, 44) if s not in self._joists_usadas("12-13"))
        grade = celula(m, "EJ", data, "IÇAMENTO JOIST")
        status, resp = self._joist("12-13", [livre], data, lanca_producao=False)
        self.assertEqual(status, 200, resp)
        self.assertEqual(celula(SRV.modelo(), "EJ", data, "IÇAMENTO JOIST"), grade)
        SRV.post("/api/apontamento", {"excluir": True, "linhas": resp["linhas"]})
        self.assertEqual(celula(SRV.modelo(), "EJ", data, "IÇAMENTO JOIST"), grade)

    def test_viga_nao_pode_ser_apontada_duas_vezes(self):
        m = SRV.modelo()
        data = m["referencia"]
        crit = SRV.get("/api/regras-baixa")["criterio_por_letra"]
        ja = {a["viga_id"] for a in m["tabelas"]["apontamentos"] if (a.get("tipo") or "").upper() == "VIGA"}
        alvo = next(((e, l) for e in ("01", "02", "03") for l in crit if len(l) == 1 and f"E{e}-{l}-{crit[l]['viga']}" not in ja), None)
        self.assertIsNotNone(alvo, "nenhuma viga livre para testar")
        eixo, letra = alvo
        grade = celula(m, "EJ", data, "VIGAS")
        corpo = {"data": data, "lote": [{"tipo": "VIGA", "empresa": "EJ", "eixo": eixo, "letras": [letra]}]}
        status, resp = SRV.post("/api/apontamento", corpo)
        self.assertEqual(status, 200, resp)
        self.assertEqual(celula(SRV.modelo(), "EJ", data, "VIGAS"), grade + 1)
        status, erro = SRV.post("/api/apontamento", corpo)
        self.assertEqual(status, 400)
        self.assertIn("já foi apontada", erro["erro"])
        self.assertEqual(SRV.post("/api/apontamento", {"data": data, "lote": [{"tipo": "VIGA", "empresa": "EJ", "eixo": "99", "letras": [letra]}]})[0], 400)
        self.assertEqual(SRV.post("/api/apontamento", {"data": data, "lote": [{"tipo": "VIGA", "empresa": "EJ", "eixo": eixo, "letras": ["??"]}]})[0], 400)
        SRV.post("/api/apontamento", {"excluir": True, "linhas": resp["linhas"]})
        self.assertEqual(celula(SRV.modelo(), "EJ", data, "VIGAS"), grade)

    def test_excluir_linha_inexistente(self):
        status, resp = SRV.post("/api/apontamento", {"excluir": True, "linhas": [999999]})
        self.assertEqual(status, 400)
        self.assertIn("não encontrado", resp["erro"])

    def test_nao_redefine_empresa_de_apontamento_que_somou_na_producao(self):
        m = SRV.modelo()
        data = m["referencia"]
        livre = next(s for s in range(1, 44) if s not in self._joists_usadas("13-14"))
        _, resp = self._joist("13-14", [livre], data)
        status, erro = SRV.post("/api/apontamento", {"reatribuir": True, "empresa": "CMM", "linhas": resp["linhas"]})
        self.assertEqual(status, 400)
        SRV.post("/api/apontamento", {"excluir": True, "linhas": resp["linhas"]})


class TestEstoquePlanilha(unittest.TestCase):
    def _estoque(self):
        return SRV.get("/api/estoque-planilha")

    def _tag(self, estoque):
        return next(i["tag"] for i in estoque["remessas"]["itens"])

    def test_remessa_soma_e_mantem_materiais_coerentes(self):
        antes = self._estoque()
        tag = self._tag(antes)
        item = next(i for i in antes["remessas"]["itens"] if i["tag"] == tag)
        status, _ = SRV.post("/api/estoque-planilha/remessa", {"remessa": "REMESSA TESTE", "itens": [{"tag": tag.lower(), "quantidade": "12,5"}]})
        self.assertEqual(status, 200)
        depois = self._estoque()
        novo = next(i for i in depois["remessas"]["itens"] if i["tag"] == tag)
        self.assertAlmostEqual(novo["total_recebido"], item["total_recebido"] + 12.5)
        self.assertEqual(novo["total_recebido"], sum(novo["qtd_por_remessa"].values()))
        self.assertIn("REMESSA TESTE", depois["remessas"]["colunas"])
        mat = next(m for m in depois["materiais"] if m["tag"] == tag)
        self.assertEqual(mat["chegou"], novo["total_recebido"])
        self.assertAlmostEqual(mat["estoque_pos_baixa"], mat["chegou"] - mat.get("consumido", 0))

    def test_remessa_e_tudo_ou_nada(self):
        antes = self._estoque()
        tag = self._tag(antes)
        status, resp = SRV.post("/api/estoque-planilha/remessa", {"remessa": "REMESSA FALHA", "itens": [
            {"tag": tag, "quantidade": 5}, {"tag": "TAG-INEXISTENTE", "quantidade": 1}]})
        self.assertEqual(status, 400)
        self.assertIn("TAG-INEXISTENTE", resp["erro"])
        depois = self._estoque()
        self.assertNotIn("REMESSA FALHA", depois["remessas"]["colunas"])
        self.assertEqual(next(i for i in depois["remessas"]["itens"] if i["tag"] == tag)["total_recebido"],
                         next(i for i in antes["remessas"]["itens"] if i["tag"] == tag)["total_recebido"])

    def test_remessa_validacoes(self):
        tag = self._tag(self._estoque())
        post = lambda c: SRV.post("/api/estoque-planilha/remessa", c)[0]
        self.assertEqual(post({"remessa": "", "itens": [{"tag": tag, "quantidade": 1}]}), 400, "sem nome")
        self.assertEqual(post({"remessa": "X", "itens": []}), 400, "sem itens")
        self.assertEqual(post({"remessa": "X", "itens": [{"tag": tag, "quantidade": 0}]}), 400, "zero")
        self.assertEqual(post({"remessa": "X", "itens": [{"tag": tag, "quantidade": -4}]}), 400, "negativa")
        self.assertEqual(post({"remessa": "X", "itens": [{"tag": tag, "quantidade": "abc"}]}), 400, "texto")
        self.assertEqual(post({"remessa": "X", "itens": [{"tag": "", "quantidade": 1}]}), 400, "sem TAG")

    def test_consumo_fisico_atualiza_saldo(self):
        antes = self._estoque()
        tag = next(i["tag"] for i in antes["consumo_fisico"]["itens"] if any(m["tag"] == i["tag"] for m in antes["materiais"]))
        total0 = next(i for i in antes["consumo_fisico"]["itens"] if i["tag"] == tag)["total_consumo"]
        status, _ = SRV.post("/api/estoque-planilha/consumo", {"semana": "SEMANA TESTE", "itens": [
            {"tag": tag, "empresa": "ej", "quantidade": 3}, {"tag": tag, "empresa": "CMM", "quantidade": 4}]})
        self.assertEqual(status, 200)
        depois = self._estoque()
        item = next(i for i in depois["consumo_fisico"]["itens"] if i["tag"] == tag)
        self.assertAlmostEqual(item["total_consumo"], total0 + 7)
        self.assertEqual(item["consumo_semanas"]["SEMANA TESTE"], {"EJ": 3, "CMM": 4, "total": 7})
        mat = next(m for m in depois["materiais"] if m["tag"] == tag)
        self.assertEqual(mat["consumido"], item["total_consumo"])
        self.assertAlmostEqual(mat["estoque_pos_baixa"], mat["chegou"] - mat["consumido"])

    def test_consumo_validacoes(self):
        tag = next(i["tag"] for i in self._estoque()["consumo_fisico"]["itens"])
        post = lambda c: SRV.post("/api/estoque-planilha/consumo", c)[0]
        self.assertEqual(post({"semana": "S", "itens": [{"tag": tag, "empresa": "XX", "quantidade": 1}]}), 400, "empresa inválida")
        self.assertEqual(post({"semana": "", "itens": [{"tag": tag, "empresa": "EJ", "quantidade": 1}]}), 400, "sem semana")
        self.assertEqual(post({"semana": "S", "itens": [{"tag": "ZZZ", "empresa": "EJ", "quantidade": 1}]}), 400, "TAG inexistente")


class TestPlanejamento(unittest.TestCase):
    def test_salvar_mescla_sem_perder_outros_setores(self):
        status, _ = SRV.post("/api/planejamento", {"setores": [
            {"chave": "joist|91-92", "data_plan_inicio": "2026-11-01", "data_plan_fim": "2026-11-05", "obs": "a"}]})
        self.assertEqual(status, 200)
        status, _ = SRV.post("/api/planejamento", {"setores": [
            {"chave": "joist|93-94", "data_plan_inicio": "2026-11-10", "data_plan_fim": None, "obs": ""}]})
        self.assertEqual(status, 200)
        por_chave = {s["chave"]: s for s in SRV.get("/api/planejamento")["setores"]}
        self.assertEqual(por_chave["joist|91-92"]["data_plan_fim"], "2026-11-05")
        self.assertEqual(por_chave["joist|93-94"]["data_plan_inicio"], "2026-11-10")
        SRV.post("/api/planejamento", {"setores": [{"chave": "joist|91-92", "data_plan_inicio": None, "data_plan_fim": None, "obs": "b"}]})
        por_chave = {s["chave"]: s for s in SRV.get("/api/planejamento")["setores"]}
        self.assertIsNone(por_chave["joist|91-92"]["data_plan_inicio"])
        self.assertEqual(por_chave["joist|91-92"]["obs"], "b")

    def test_corpo_invalido(self):
        self.assertEqual(SRV.post("/api/planejamento", {"setores": "x"})[0], 400)
        self.assertEqual(SRV.post("/api/planejamento", {})[0], 400)

    def test_ignora_setor_sem_chave(self):
        antes = len(SRV.get("/api/planejamento")["setores"])
        status, _ = SRV.post("/api/planejamento", {"setores": [{"data_plan_inicio": "2026-11-01"}]})
        self.assertEqual(status, 200)
        self.assertEqual(len(SRV.get("/api/planejamento")["setores"]), antes)


if __name__ == "__main__":
    unittest.main(verbosity=2)
