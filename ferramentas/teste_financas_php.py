"""Teste de ponta a ponta do módulo FINANÇAS (maciel/financas.php).

Copia o sistema PHP para uma pasta temporária, usa SQLite (nunca o config.php real), sobe o servidor embutido do PHP
e exercita a página por HTTP com usuários diferentes. Também compara os cálculos em PHP com os do programa Python
(financas/impostos.py e financas/investimentos.py). Nada na pasta real é alterado.

Uso:  python ferramentas/teste_financas_php.py        (precisa de php com pdo_sqlite e do pacote requests)
"""
import json
import os
import re
import shutil
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest

import requests

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SENHA = "senha-teste-123"
sys.path.insert(0, os.path.join(RAIZ, "financas"))
import impostos as imp  # noqa: E402
import investimentos as inv  # noqa: E402


def porta_livre():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Sessao:
    def __init__(self, base):
        self.base, self.s = base, requests.Session()

    def csrf(self, caminho="/login.php"):
        html = self.s.get(self.base + caminho).text
        return re.search(r'name="csrf" value="([^"]+)"', html).group(1)

    def entrar(self, login):
        r = self.s.post(self.base + "/login.php", data={"csrf": self.csrf(), "login": login, "senha": SENHA}, allow_redirects=False)
        assert r.status_code == 302, f"login de {login} falhou"
        html = self.s.get(self.base + "/obras.php").text
        self.s.post(self.base + "/obras.php", data={"csrf": re.search(r'name="csrf" value="([^"]+)"', html).group(1), "acao": "abrir", "obra_id": 1})
        return self

    def pagina(self, **params):
        return self.s.get(self.base + "/financas.php", params=params, allow_redirects=False)

    def post(self, **dados):
        dados.setdefault("csrf", self.csrf("/financas.php?v=lanc"))
        return self.s.post(self.base + "/financas.php", data=dados, allow_redirects=False)


class Ambiente:
    def __init__(self):
        self.tmp = tempfile.mkdtemp(prefix="financas_teste_")
        self.maciel = os.path.join(self.tmp, "maciel")
        shutil.copytree(os.path.join(RAIZ, "maciel"), self.maciel,
                        ignore=shutil.ignore_patterns("tcpdf", "fonts", "config.php", "dados", "*.pdf"))
        os.makedirs(os.path.join(self.maciel, "dados"))
        self.db = os.path.join(self.maciel, "dados", "teste.sqlite")
        with open(os.path.join(self.maciel, "inc", "config.php"), "w") as f:
            f.write("<?php return ['driver'=>'sqlite','host'=>'','porta'=>'','banco'=>'','usuario'=>'','senha'=>'','sqlite_arquivo'=>%r];" % self.db)
        subprocess.run(["php", "-r", """
            require 'inc/nucleo.php'; $pdo = conectar(config()); criar_esquema($pdo, 'sqlite');
            $h = password_hash('%s', PASSWORD_DEFAULT);
            foreach ([['Admin','admin','admin'],['Ana','ana','editor'],['Beto','beto','editor'],['Leitor','leitor','leitura']] as $u)
                $pdo->prepare('INSERT INTO usuarios (nome,login,senha,perfil,ativo) VALUES (?,?,?,?,1)')->execute([$u[0],$u[1],$h,$u[2]]);
            $pdo->exec('INSERT INTO usuarios_obras (usuario_id, obra_id) SELECT id, 1 FROM usuarios');
            $pdo->prepare("INSERT INTO sistema (chave,valor) VALUES ('esquema',?)")->execute([(string)ESQUEMA_VERSAO]);
        """ % SENHA], cwd=self.maciel, check=True)
        self.porta = porta_livre()
        self.log = open(os.path.join(self.tmp, "php.log"), "w")
        self.proc = subprocess.Popen(["php", "-S", f"127.0.0.1:{self.porta}"], cwd=self.maciel, stdout=self.log, stderr=subprocess.STDOUT)
        self.base = f"http://127.0.0.1:{self.porta}"
        for _ in range(50):
            try:
                requests.get(self.base + "/login.php", timeout=2)
                break
            except requests.RequestException:
                time.sleep(0.2)

    def sql(self, consulta, params=()):
        con = sqlite3.connect(self.db)
        try:
            return con.execute(consulta, params).fetchall()
        finally:
            con.close()

    def uid(self, login):
        return self.sql("SELECT id FROM usuarios WHERE login=?", (login,))[0][0]

    def php(self, codigo):
        r = subprocess.run(["php", "-r", "require 'inc/financas_calculos.php'; " + codigo], cwd=self.maciel, capture_output=True, text=True, check=True)
        return json.loads(r.stdout)

    def parar(self):
        self.proc.terminate()
        self.proc.wait(10)
        self.log.close()
        shutil.rmtree(self.tmp, ignore_errors=True)


AMB = None
ADMIN = ANA = BETO = LEITOR = None


def setUpModule():
    global AMB, ADMIN, ANA, BETO, LEITOR
    AMB = Ambiente()
    ADMIN, ANA, BETO, LEITOR = (Sessao(AMB.base).entrar(x) for x in ("admin", "ana", "beto", "leitor"))
    # o administrador libera "Finanças" para Ana e Beto pela tela real de Administração
    for login in ("ana", "beto"):
        html = ADMIN.s.get(AMB.base + "/admin.php").text
        csrf = re.search(r'name="csrf" value="([^"]+)"', html).group(1)
        r = ADMIN.s.post(AMB.base + "/admin.php", data={"csrf": csrf, "acao": "salvar_modulos", "id": AMB.uid(login), "modulos[]": ["producao", "financas"]})
        assert r.status_code == 200


def tearDownModule():
    if AMB:
        AMB.parar()


def lanc(sessao, **campos):
    base = dict(acao="salvar", id=0, tipo="Despesa", natureza="Fixa", categoria="Aluguel / Moradia", descricao="", valor="1000,00", data="2026-10-05", repetir=1)
    base.update(campos)
    return sessao.post(**base)


class T01_Acesso(unittest.TestCase):
    def test_admin_ve_o_painel_vazio(self):
        r = ADMIN.pagina()
        self.assertEqual(r.status_code, 200)
        self.assertIn("Você ainda não tem lançamentos", r.text)

    def test_endpoint_de_acesso(self):
        self.assertEqual(ADMIN.pagina(acesso=1).json(), {"ok": True})
        self.assertEqual(ANA.pagina(acesso=1).json(), {"ok": True})
        self.assertEqual(LEITOR.pagina(acesso=1).json(), {"ok": False})

    def test_sem_liberacao_recebe_403_e_nenhum_dado(self):
        r = LEITOR.pagina(v="lanc")
        self.assertEqual(r.status_code, 403)
        self.assertNotIn("<table", r.text)

    def test_menu_do_sistema_tem_o_grupo_isolado(self):
        html = ADMIN.s.get(AMB.base + "/index.php").text
        self.assertIn('data-grupo="financas"', html)
        self.assertIn("financas.php?v=imp", html)

    def test_admin_lista_o_modulo_com_rotulo_proprio(self):
        self.assertIn("Finanças (pessoal)", ADMIN.s.get(AMB.base + "/admin.php").text)

    def test_csrf_obrigatorio(self):
        s = requests.Session()
        s.cookies.update(ANA.s.cookies)
        r = s.post(AMB.base + "/financas.php", data={"acao": "salvar", "valor": "10"}, allow_redirects=False)
        self.assertEqual(r.status_code, 400)

    def test_liberar_sesmt_nao_libera_financas_junto(self):
        html = ADMIN.s.get(AMB.base + "/sesmt.php?v=acessos").text
        csrf = re.search(r'name="csrf" value="([^"]+)"', html).group(1)
        r = ADMIN.s.post(AMB.base + "/sesmt.php", data={"csrf": csrf, "acao": "acesso", "usuario": AMB.uid("leitor"), "liberar": 1}, allow_redirects=False)
        self.assertEqual(r.status_code, 302)
        self.assertEqual(LEITOR.pagina(acesso=1).json(), {"ok": False}, "SESMT liberado não pode abrir Finanças")
        mods = {m for (m,) in AMB.sql("SELECT modulo FROM usuarios_modulos WHERE usuario_id=?", (AMB.uid("leitor"),))}
        self.assertIn("sesmt", mods)
        self.assertNotIn("financas", mods)


class T02_Lancamentos(unittest.TestCase):
    def test_validacoes(self):
        for campos in ({"valor": "0"}, {"valor": "abc"}, {"data": "2026-02-31"}, {"categoria": ""}, {"tipo": "Outro"}, {"repetir": 999}):
            antes = AMB.sql("SELECT COUNT(*) FROM fin_lancamentos")[0][0] if AMB.sql("SELECT name FROM sqlite_master WHERE name='fin_lancamentos'") else 0
            r = lanc(ANA, **campos)
            self.assertEqual(r.status_code, 200, campos)
            self.assertIn("Corrija antes de salvar", r.text)
            self.assertEqual(AMB.sql("SELECT COUNT(*) FROM fin_lancamentos")[0][0], antes)

    def test_cadastro_valor_brasileiro_e_repeticao_com_fim_de_mes(self):
        r = lanc(ANA, descricao="Parcela do carro", categoria="Parcela do carro", valor="1.450,50", data="2026-01-31", repetir=3)
        self.assertEqual(r.status_code, 302)
        rows = AMB.sql("SELECT data, descricao, valor, serie FROM fin_lancamentos WHERE usuario_id=? AND descricao LIKE 'Parcela do carro%' ORDER BY data", (AMB.uid("ana"),))
        self.assertEqual([x[0] for x in rows], ["2026-01-31", "2026-02-28", "2026-03-31"], "31/01 + 1 mês não pode estourar")
        self.assertEqual([x[1] for x in rows], [f"Parcela do carro ({i}/3)" for i in (1, 2, 3)])
        self.assertTrue(all(abs(x[2] - 1450.50) < 1e-9 for x in rows))
        self.assertEqual(len({x[3] for x in rows}), 1)

    def test_receita_ignora_natureza(self):
        lanc(ANA, tipo="Receita", natureza="Fixa", categoria="Salário", valor="8000", descricao="Salario teste")
        self.assertEqual(AMB.sql("SELECT natureza FROM fin_lancamentos WHERE descricao='Salario teste'")[0][0], "—")

    def test_editar_pagar_e_excluir(self):
        lanc(ANA, descricao="Editar-me", valor="100")
        lid = AMB.sql("SELECT id FROM fin_lancamentos WHERE descricao='Editar-me'")[0][0]
        self.assertIn("Editar lançamento", ANA.pagina(v="lanc", editar=lid).text)
        r = lanc(ANA, id=lid, descricao="Editado", valor="250,00", pago=1)
        self.assertEqual(r.status_code, 302)
        row = AMB.sql("SELECT descricao, valor, pago FROM fin_lancamentos WHERE id=?", (lid,))[0]
        self.assertEqual((row[0], row[1], row[2]), ("Editado", 250.0, 1))
        ANA.post(acao="pago", id=lid)
        self.assertEqual(AMB.sql("SELECT pago FROM fin_lancamentos WHERE id=?", (lid,))[0][0], 0)
        ANA.post(acao="excluir", id=lid)
        self.assertEqual(AMB.sql("SELECT COUNT(*) FROM fin_lancamentos WHERE id=?", (lid,))[0][0], 0)

    def test_excluir_serie_inteira(self):
        lanc(ANA, descricao="Serie-X", valor="10", repetir=4, data="2027-01-10")
        ids = [x[0] for x in AMB.sql("SELECT id FROM fin_lancamentos WHERE descricao LIKE 'Serie-X%'")]
        self.assertEqual(len(ids), 4)
        ANA.post(acao="excluir", id=ids[1], serie=1)
        self.assertEqual(AMB.sql("SELECT COUNT(*) FROM fin_lancamentos WHERE descricao LIKE 'Serie-X%'")[0][0], 0)

    def test_html_e_escapado(self):
        lanc(ANA, descricao="<script>alert(1)</script>", valor="5")
        html = ANA.pagina(v="lanc").text
        self.assertNotIn("<script>alert(1)</script>", html)
        self.assertIn("&lt;script&gt;alert(1)&lt;/script&gt;", html)

    def test_busca_filtra_e_trata_curinga(self):
        lanc(ANA, descricao="Busca 100% unica", valor="7")
        self.assertIn("Busca 100% unica", ANA.pagina(v="lanc", q="100%").text)
        self.assertNotIn("Busca 100% unica", ANA.pagina(v="lanc", q="zzz-nao-existe").text)

    def test_csv(self):
        r = ANA.pagina(v="lanc", export="csv")
        self.assertIn("text/csv", r.headers["Content-Type"])
        self.assertTrue(r.content.startswith(b"\xef\xbb\xbfData;Tipo;Natureza"))
        self.assertIn("Parcela do carro (1/3)", r.text)


class T03_Isolamento(unittest.TestCase):
    """Dados financeiros são pessoais: nem outro usuário, nem o administrador, enxergam ou mexem."""

    @classmethod
    def setUpClass(cls):
        lanc(ANA, descricao="SEGREDO-DA-ANA", valor="123,45")
        cls.lid = AMB.sql("SELECT id FROM fin_lancamentos WHERE descricao='SEGREDO-DA-ANA'")[0][0]

    def test_outros_nao_veem(self):
        for s in (BETO, ADMIN):
            self.assertNotIn("SEGREDO-DA-ANA", s.pagina(v="lanc").text)
            self.assertNotIn("SEGREDO-DA-ANA", s.pagina(v="lanc", export="csv").text)
        self.assertIn("SEGREDO-DA-ANA", ANA.pagina(v="lanc").text)

    def test_outros_nao_editam_nem_excluem_por_id(self):
        for s in (BETO, ADMIN):
            lanc(s, id=self.lid, descricao="INVADIDO", valor="1")
            s.post(acao="excluir", id=self.lid)
            s.post(acao="pago", id=self.lid)
        row = AMB.sql("SELECT descricao, valor, pago FROM fin_lancamentos WHERE id=?", (self.lid,))
        self.assertEqual(len(row), 1)
        self.assertEqual((row[0][0], row[0][1], row[0][2]), ("SEGREDO-DA-ANA", 123.45, 1))
        self.assertNotIn("SEGREDO-DA-ANA", BETO.pagina(v="lanc", editar=self.lid).text)


class T04_Painel(unittest.TestCase):
    def test_exemplo_painel_e_remocao(self):
        self.assertIn("Você ainda não tem lançamentos", BETO.pagina().text)
        BETO.post(acao="exemplo")
        n = AMB.sql("SELECT COUNT(*) FROM fin_lancamentos WHERE usuario_id=? AND serie='exemplo'", (AMB.uid("beto"),))[0][0]
        self.assertEqual(n, 84)
        html = BETO.pagina().text
        for trecho in ("Receitas", "Custos fixos", "gRecDesp", "Diagnóstico financeiro", "Resumo por mês", "Remover dados de exemplo"):
            self.assertIn(trecho, html)
        m = re.search(r"const D=(\{.*?\});\nconst AZ", html, re.S)
        D = json.loads(m.group(1))
        self.assertEqual(len(D["x"]), 6)
        self.assertAlmostEqual(sum(D["rec"]) - sum(D["desp"]), D["acum"][-1], places=2)
        BETO.post(acao="exemplo")  # com dados, não carrega de novo
        self.assertEqual(AMB.sql("SELECT COUNT(*) FROM fin_lancamentos WHERE usuario_id=?", (AMB.uid("beto"),))[0][0], 84)
        BETO.post(acao="remover_exemplo")
        self.assertEqual(AMB.sql("SELECT COUNT(*) FROM fin_lancamentos WHERE usuario_id=?", (AMB.uid("beto"),))[0][0], 0)

    def test_filtro_de_periodo_e_reserva(self):
        lanc(ANA, tipo="Receita", categoria="Serviços / PJ", valor="10000", data="2026-08-10", descricao="p-ago")
        lanc(ANA, descricao="d-set", valor="2000", data="2026-09-10", categoria="Mercado", natureza="Variável")
        html = ANA.pagina(de="2026-08", ate="2026-08").text
        D = json.loads(re.search(r"const D=(\{.*?\});\nconst AZ", html, re.S).group(1))
        self.assertEqual(D["x"], ["ago/26"])
        self.assertEqual(D["rec"], [10000.0])
        ANA.post(acao="reserva", reserva="12.000,00")
        self.assertEqual(AMB.sql("SELECT valor FROM fin_config WHERE usuario_id=? AND chave='reserva'", (AMB.uid("ana"),))[0][0], "12000")


class T05_Impostos(unittest.TestCase):
    def test_telas_mostram_os_mesmos_numeros_do_programa_python(self):
        clt = ANA.pagina(v="imp", t="clt", bruto="8000").text
        for esperado in ("R$ 921,51", "R$ 1.037,85", "R$ 6.040,64", "24,5%"):
            self.assertIn(esperado, clt)
        me = ANA.pagina(v="imp", t="me", receita="15000", pro_labore="4200", despesas="800").text
        for esperado in ("Anexo III", "R$ 12.838,00", "R$ 900,00", "6,00%"):
            self.assertIn(esperado, me)
        v = ANA.pagina(v="imp", t="me", receita="15000", pro_labore="1621", despesas="800").text
        self.assertIn("Anexo V", v)
        self.assertIn("R$ 4.200,00", v)
        self.assertIn("R$ 86,05", ANA.pagina(v="imp", t="mei", receita="6000").text)
        self.assertIn("excede o limite do MEI", ANA.pagina(v="imp", t="mei", receita="9000").text)
        cmp_ = ANA.pagina(v="imp", t="cmp", receita="6000", despesas="800").text
        self.assertIn("MEI*", cmp_)
        self.assertIn("Fator R 28% (Anexo III)", cmp_)
        self.assertNotIn("MEI*</td>", ANA.pagina(v="imp", t="cmp", receita="12000").text)

    def test_paridade_php_python_clt(self):
        brutos = [0, 1200, 1621, 2500, 3500, 4999.99, 5000, 5500, 6200, 7000, 7350, 7351, 8000, 12000, 30000]
        for dep in (0, 2):
            saida = AMB.php("echo json_encode(array_map(function($b){return fin_salario_clt($b,%d);}, %s));" % (dep, json.dumps(brutos)))
            for b, r in zip(brutos, saida):
                py = imp.salario_clt(b, dep)
                for campo in ("inss", "irrf", "liquido", "fgts", "anual_liquido"):
                    self.assertAlmostEqual(r[campo], getattr(py, campo), delta=0.011, msg=f"{campo} bruto={b} dep={dep}")

    def test_paridade_php_python_me_e_mei(self):
        casos = [(6000, 1621, 0), (15000, 4200, 800), (15000, 1621, 800), (30000, 8400, 2000), (50000, 5000, 0), (3000, 840, 100)]
        saida = AMB.php("echo json_encode(array_map(function($c){return fin_me_simples($c[0],$c[1],$c[2]);}, %s));" % json.dumps(casos))
        for (rec, pl, dp), r in zip(casos, saida):
            py = imp.me_simples(rec, pl, dp)
            self.assertEqual(r["anexo"], py.anexo)
            for campo in ("das", "inss_pro_labore", "irrf_pro_labore", "lucro_distribuivel", "liquido_no_bolso"):
                self.assertAlmostEqual(r[campo], getattr(py, campo), delta=0.011, msg=f"{campo} {rec}/{pl}")
            self.assertAlmostEqual(r["aliquota_efetiva"], py.aliquota_efetiva, places=9)
        for rec in (3000, 6750, 7000):
            for ativ in ("servicos", "comercio", "ambos"):
                r = AMB.php("echo json_encode(fin_mei(%s, '%s', 100));" % (rec, ativ))
                py = imp.mei(rec, ativ, 100)
                self.assertAlmostEqual(r["das"], py.das, places=2)
                self.assertEqual(r["dentro_do_limite"], py.dentro_do_limite)


class T06_Investimentos(unittest.TestCase):
    def test_paridade_php_python_renda_fixa(self):
        m = inv.ParametrosMercado(selic=0.15, cdi=0.149, ipca=0.045)
        casos = [("CDB", 1.05), ("LCI/LCA", 0.9), ("Tesouro Selic", 0.0005), ("Poupança", 0.0)]
        for produto, taxa in casos:
            for inicial, aporte, meses in ((10000, 1000, 36), (0, 500, 24), (5000, 0, 8)):
                php = AMB.php("echo json_encode(fin_simular('%s', %s, %s, %s, %s, ['selic'=>.15,'cdi'=>.149,'ipca'=>.045]));" % (produto, taxa, inicial, aporte, meses))[-1]
                py = inv.simular(produto, taxa, inicial, aporte, meses, m).iloc[-1]
                self.assertAlmostEqual(php["bruto"], py.bruto, delta=0.01, msg=produto)
                self.assertAlmostEqual(php["ir"], py.ir, delta=0.01, msg=produto)
                self.assertAlmostEqual(php["liquido"], py.liquido, delta=0.01, msg=produto)

    def test_tela(self):
        html = ANA.pagina(v="inv", prazo=36, cdb=105, lci=90).text
        for trecho in ("Leitura do especialista", "gInv", "Tesouro Selic", "Poupança", "melhor líquido", "equivale a um CDB de"):
            self.assertIn(trecho, html)

    def test_salvar_taxas_como_padrao(self):
        ANA.post(acao="taxas_salvar", selic="13,75", cdi="13,65", ipca="4,2")
        html = ANA.pagina(v="inv").text
        self.assertIn('name="selic" value="13,75"', html)
        self.assertIn('name="cdi" value="13,65"', html)

    def test_equivalencia_cdb_lci(self):
        self.assertAlmostEqual(AMB.php("echo json_encode(fin_equivalente_cdb(0.9, 400));"), inv.equivalente_cdb(0.9, 400), places=9)


if __name__ == "__main__":
    unittest.main(verbosity=2)
