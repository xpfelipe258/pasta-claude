"""Teste de ponta a ponta do módulo SESMT GERAL (maciel/sesmt.php).

Copia o sistema PHP para uma pasta temporária, usa SQLite (nunca o config.php real), sobe o servidor embutido do PHP
e exercita a página por HTTP com usuários de perfis diferentes. Nada na pasta real é alterado.

Uso:  python ferramentas/teste_sesmt.py        (precisa de php com pdo_sqlite e do pacote requests)
"""
import csv
import io
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


def cpf_valido(base9):
    d = [int(x) for x in base9]
    for n in (9, 10):
        s = sum(d[i] * (n + 1 - i) for i in range(n))
        d.append((s * 10 % 11) % 10)
    return "".join(map(str, d))


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
        return self.s.get(self.base + "/sesmt.php", params=params, allow_redirects=False)

    def post(self, **dados):
        dados.setdefault("csrf", self.csrf_sesmt())
        return self.s.post(self.base + "/sesmt.php", data=dados, allow_redirects=False)

    def csrf_sesmt(self):
        return re.search(r'name="csrf" value="([^"]+)"', self.s.get(self.base + "/sesmt.php?v=config").text).group(1)


class Ambiente:
    def __init__(self):
        self.tmp = tempfile.mkdtemp(prefix="sesmt_teste_")
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
            foreach ([['Admin','admin','admin'],['Editor','editor','editor'],['Leitor','leitor','leitura'],['Outro','outro','editor']] as $u)
                $pdo->prepare('INSERT INTO usuarios (nome,login,senha,perfil,ativo) VALUES (?,?,?,?,1)')->execute([$u[0],$u[1],$h,$u[2]]);
            $pdo->exec('INSERT INTO usuarios_obras (usuario_id, obra_id) SELECT id, 1 FROM usuarios');
            $pdo->prepare("INSERT INTO sistema (chave,valor) VALUES ('esquema',?)")->execute([(string)ESQUEMA_VERSAO]);
            foreach ([['CONTROLE EJ','EJ',1],['CONTROLE CMM','CMM',2]] as $e)
                $pdo->prepare('INSERT INTO empresas (aba,nome,ordem,obra_id) VALUES (?,?,?,1)')->execute($e);
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

    def parar(self):
        self.proc.terminate()
        self.proc.wait(10)
        self.log.close()
        shutil.rmtree(self.tmp, ignore_errors=True)


AMB = None
ADMIN = EDITOR = LEITOR = OUTRO = None
CPFS = {n: cpf_valido(f"{n:09d}") for n in (123456789, 234567891, 345678912)}


def setUpModule():
    global AMB, ADMIN, EDITOR, LEITOR, OUTRO
    AMB = Ambiente()
    ADMIN, EDITOR, LEITOR, OUTRO = (Sessao(AMB.base).entrar(x) for x in ("admin", "editor", "leitor", "outro"))


def tearDownModule():
    if AMB:
        AMB.parar()


def novo(sessao, reg, **campos):
    return sessao.post(acao="salvar", reg=reg, id=0, **campos)


class T01_Acesso(unittest.TestCase):
    def test_admin_entra_e_ve_painel_vazio(self):
        r = ADMIN.pagina()
        self.assertEqual(r.status_code, 200)
        self.assertIn("SESMT GERAL", r.text)
        self.assertIn("Nenhum colaborador cadastrado", r.text)

    def test_endpoint_de_acesso(self):
        self.assertEqual(ADMIN.pagina(acesso=1).json(), {"ok": True})
        self.assertEqual(EDITOR.pagina(acesso=1).json(), {"ok": False})

    def test_sem_liberacao_nao_ve_dados_pessoais(self):
        r = EDITOR.pagina(reg="colaboradores")
        self.assertEqual(r.status_code, 403)
        self.assertNotIn("<table", r.text)

    def test_menu_lateral_tem_o_grupo_e_o_modulo_novo(self):
        html = ADMIN.s.get(AMB.base + "/index.php").text
        self.assertIn('data-grupo="sesmt"', html)
        self.assertIn("SESMT GERAL", html)
        with open(os.path.join(AMB.maciel, "inc", "nucleo.php"), encoding="utf-8") as f:
            self.assertIn("'sesmt'", f.read())

    def test_liberar_acesso_preserva_os_outros_menus(self):
        antes = AMB.sql("SELECT COUNT(*) FROM usuarios_modulos WHERE usuario_id=(SELECT id FROM usuarios WHERE login='outro')")[0][0]
        self.assertEqual(antes, 0)
        r = ADMIN.post(acao="acesso", usuario=AMB.sql("SELECT id FROM usuarios WHERE login='outro'")[0][0], liberar=1)
        self.assertEqual(r.status_code, 302)
        mods = {m for (m,) in AMB.sql("SELECT modulo FROM usuarios_modulos WHERE usuario_id=(SELECT id FROM usuarios WHERE login='outro')")}
        self.assertEqual(mods, {"producao", "suprimentos", "consumo", "financeiro", "kpi", "gestao", "sesmt"})
        self.assertEqual(OUTRO.pagina(acesso=1).json(), {"ok": True})
        ADMIN.post(acao="acesso", usuario=AMB.sql("SELECT id FROM usuarios WHERE login='outro'")[0][0], liberar=0)
        self.assertEqual(OUTRO.pagina(acesso=1).json(), {"ok": False})
        mods = {m for (m,) in AMB.sql("SELECT modulo FROM usuarios_modulos WHERE usuario_id=(SELECT id FROM usuarios WHERE login='outro')")}
        self.assertNotIn("sesmt", mods)
        self.assertEqual(len(mods), 6)

    def test_somente_admin_libera_acesso(self):
        r = ADMIN.s.get(AMB.base + "/sesmt.php?v=acessos")
        self.assertIn("Acessos ao SESMT GERAL", r.text)

    def test_csrf_obrigatorio(self):
        r = requests.Session()
        r.cookies.update(ADMIN.s.cookies)
        resp = r.post(AMB.base + "/sesmt.php", data={"acao": "salvar", "reg": "colaboradores"}, allow_redirects=False)
        self.assertEqual(resp.status_code, 400)


class T02_Colaboradores(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        sid = AMB.sql("SELECT id FROM usuarios WHERE login='editor'")[0][0]
        ADMIN.post(acao="acesso", usuario=sid, liberar=1)
        sid = AMB.sql("SELECT id FROM usuarios WHERE login='leitor'")[0][0]
        ADMIN.post(acao="acesso", usuario=sid, liberar=1)
        cls.r1 = novo(EDITOR, "colaboradores", empresa="rótula", status="Contratado", nome="Maria de Teste", cpf=CPFS[123456789],
                      setor="Operacional", funcao="Serralheiro", sexo="F", nascimento="1990-05-20", admissao="2024-01-10")
        cls.r2 = novo(EDITOR, "colaboradores", empresa="EJ", status="Contratado", nome="João de Teste", cpf=CPFS[234567891], funcao="Ajudante Geral")
        cls.r3 = novo(EDITOR, "colaboradores", empresa="CMM", status="Demitido", nome="Carlos Demitido", admissao="2023-01-01", desligamento="2024-01-01")

    def test_cadastro_com_empresa_cpf_mascarado_e_filtro(self):
        for r in (self.r1, self.r2, self.r3):
            self.assertEqual(r.status_code, 302, r.text[:400])
        emp = [e for (e,) in AMB.sql("SELECT empresa FROM sesmt_colaboradores WHERE nome IN ('Maria de Teste','João de Teste','Carlos Demitido') ORDER BY id")]
        self.assertEqual(emp, ["RÓTULA", "EJ", "CMM"], "a empresa é normalizada em maiúsculas")
        lista = EDITOR.pagina(reg="colaboradores").text
        self.assertIn("<th>Empresa</th>", lista)
        self.assertIn("***.456.789-**".replace("456", CPFS[123456789][3:6]).replace("789", CPFS[123456789][6:9]), lista)
        self.assertNotIn(CPFS[123456789], lista, "CPF completo não aparece na lista")
        so_ej = EDITOR.pagina(reg="colaboradores", empresa="EJ").text
        self.assertIn("João de Teste", so_ej)
        self.assertNotIn("Maria de Teste", so_ej)
        busca = EDITOR.pagina(reg="colaboradores", q=CPFS[123456789][:6]).text
        self.assertIn("Maria de Teste", busca)
        self.assertNotIn("João de Teste", busca)

    def test_empresa_e_nome_sao_obrigatorios(self):
        r = novo(EDITOR, "colaboradores", empresa="", status="Contratado", nome="")
        self.assertEqual(r.status_code, 200)
        self.assertIn("Empresa é obrigatório", r.text)
        self.assertIn("Nome do colaborador é obrigatório", r.text)

    def test_cpf_invalido_e_duplicado(self):
        r = novo(EDITOR, "colaboradores", empresa="EJ", status="Contratado", nome="Fulano", cpf="111.111.111-11")
        self.assertIn("CPF inválido", r.text)
        r = novo(EDITOR, "colaboradores", empresa="EJ", status="Contratado", nome="Outro Maria", cpf=CPFS[123456789])
        self.assertIn("Já existe um colaborador com este CPF", r.text)

    def test_datas_incoerentes(self):
        r = novo(EDITOR, "colaboradores", empresa="EJ", status="Contratado", nome="Data Errada", admissao="2024-05-01", desligamento="2024-01-01")
        self.assertIn("desligamento não pode ser anterior", r.text)
        r = novo(EDITOR, "colaboradores", empresa="EJ", status="Contratado", nome="Data Ruim", nascimento="31/02/2020")
        self.assertIn("data inválida", r.text)

    def test_valor_fora_da_lista_e_recusado(self):
        r = novo(EDITOR, "colaboradores", empresa="EJ", status="Inventado", nome="Fora Da Lista")
        self.assertIn("escolha um valor da lista", r.text)

    def test_leitura_nao_grava(self):
        antes = AMB.sql("SELECT COUNT(*) FROM sesmt_colaboradores")[0][0]
        r = novo(LEITOR, "colaboradores", empresa="EJ", status="Contratado", nome="Nao Deve Gravar")
        self.assertIn("somente consulta", r.text)
        self.assertEqual(AMB.sql("SELECT COUNT(*) FROM sesmt_colaboradores")[0][0], antes)

    def test_busca_resiste_a_injecao_e_curinga(self):
        for q in ("' OR 1=1 --", "%", "_", "\\", "'; DROP TABLE sesmt_colaboradores; --"):
            r = EDITOR.pagina(reg="colaboradores", q=q)
            self.assertEqual(r.status_code, 200, q)
        self.assertGreaterEqual(AMB.sql("SELECT COUNT(*) FROM sesmt_colaboradores")[0][0], 1)
        self.assertNotIn("Maria de Teste", EDITOR.pagina(reg="colaboradores", q="%zzz").text)

    def test_csv_mascara_cpf_e_respeita_filtro(self):
        r = EDITOR.pagina(reg="colaboradores", empresa="RÓTULA", export="csv")
        self.assertIn("text/csv", r.headers["Content-Type"])
        linhas = list(csv.reader(io.StringIO(r.content.decode("utf-8-sig")), delimiter=";"))
        self.assertEqual(linhas[0][0], "Empresa")
        nomes = [l for l in linhas[1:] if any("Maria de Teste" in c for c in l)]
        self.assertEqual(len(nomes), 1)
        self.assertNotIn(CPFS[123456789], r.content.decode("utf-8-sig"))
        self.assertNotIn("João de Teste", r.content.decode("utf-8-sig"))


class T03_Regras(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        for nome, emp in (("Ana ASO", "EJ"), ("Beto ASO", "CMM")):
            novo(EDITOR, "colaboradores", empresa=emp, status="Contratado", nome=nome, funcao="Pedreiro I")
        cls.ids = {n: i for i, n in AMB.sql("SELECT id, nome FROM sesmt_colaboradores")}

    def test_aso_vencido_e_a_vencer(self):
        from datetime import date, timedelta
        h = date.today()
        r = novo(EDITOR, "aso", colaborador_id=self.ids["Ana ASO"], tipo="Periódico", data_emissao=(h - timedelta(days=100)).isoformat(), validade_dias=90, apto="Apto", atualizou="Não")
        self.assertEqual(r.status_code, 302, r.text[:300])
        novo(EDITOR, "aso", colaborador_id=self.ids["Beto ASO"], tipo="Periódico", data_emissao=(h - timedelta(days=80)).isoformat(), validade_dias=90, apto="Apto", atualizou="Não")
        lista = EDITOR.pagina(reg="aso").text
        self.assertIn("VENCIDO há 10 dias", lista)
        self.assertIn("10 DIAS PARA VENCER", lista)
        so_crit = EDITOR.pagina(reg="aso", sit="critico").text
        self.assertIn("Ana ASO", so_crit)
        self.assertNotIn("Beto ASO", so_crit)
        self.assertIn("<b>EJ</b>", lista, "a empresa do colaborador aparece na lista de ASO")

    def test_painel_conta_aso_por_empresa(self):
        html = EDITOR.pagina().text
        self.assertIn("Por empresa", html)
        self.assertRegex(html, r"<b>EJ</b>")
        self.assertRegex(html, r"<b>CMM</b>")

    def test_treinamento_validade_e_presenca_em_lote(self):
        r = novo(EDITOR, "treinamentos", status="Concluído", treinamento="NR 35 Trabalho em altura", norma="NR 35", data_inicial="2020-01-01",
                 data_final="2020-01-02", validade_meses=24, controlar="Sim")
        self.assertEqual(r.status_code, 302, r.text[:300])
        tid = AMB.sql("SELECT id FROM sesmt_treinamentos")[0][0]
        r = EDITOR.post(acao="presenca_lote", treinamento_id=tid, obs="", **{"colaboradores[]": [self.ids["Ana ASO"], self.ids["Beto ASO"]]})
        self.assertEqual(r.status_code, 302)
        r = EDITOR.post(acao="presenca_lote", treinamento_id=tid, obs="", **{"colaboradores[]": [self.ids["Ana ASO"]]})
        self.assertEqual(AMB.sql("SELECT COUNT(*) FROM sesmt_presenca")[0][0], 2, "não duplica")
        lista = EDITOR.pagina(reg="presenca").text
        self.assertIn("VENCIDO", lista)
        self.assertIn("NR 35", lista)
        trein = EDITOR.pagina(reg="treinamentos").text
        self.assertRegex(trein, r"<td>2</td>", "contagem de participantes")
        r = EDITOR.post(acao="presenca_lote", treinamento_id=tid, obs="")
        self.assertEqual(r.status_code, 200)
        self.assertIn("Marque ao menos um colaborador", r.text)

    def test_datas_do_treinamento(self):
        r = novo(EDITOR, "treinamentos", status="Concluído", treinamento="Datas ruins", data_inicial="2024-05-10", data_final="2024-05-01")
        self.assertIn("data final não pode ser anterior", r.text)

    def test_acidente_dias_sem_acidente_e_taxas(self):
        from datetime import date, timedelta
        h = date.today()
        r = novo(EDITOR, "acidentes", colaborador_id=self.ids["Ana ASO"], data=(h - timedelta(days=12)).isoformat(), horario="09:30",
                 afastamento="Sim", data_retorno=(h - timedelta(days=2)).isoformat(), tipo="Típico")
        self.assertEqual(r.status_code, 302, r.text[:300])
        painel = EDITOR.pagina().text
        self.assertRegex(painel, r'<div class="val">12</div>')
        self.assertIn("10 dias", EDITOR.pagina(reg="acidentes").text)
        r = novo(EDITOR, "acidentes", colaborador_id=self.ids["Ana ASO"], data="2999-01-01")
        self.assertIn("não pode estar no futuro", r.text)

    def test_epi_estoque_e_saida_maior_que_o_saldo(self):
        r = novo(EDITOR, "epi", descricao="Capacete", fabricante="ACME", ca="12345", minimo=5, maximo=20, preco="10,50", controlar="Não")
        self.assertEqual(r.status_code, 302, r.text[:300])
        epi = AMB.sql("SELECT id FROM sesmt_epi")[0][0]
        r = novo(EDITOR, "mov_epi", epi_id=epi, movimento="ENTRADA", qtd=10, parte="Fornecedor", fornecedor="Loja X", data="2025-01-10")
        self.assertEqual(r.status_code, 302, r.text[:300])
        r = novo(EDITOR, "mov_epi", epi_id=epi, movimento="SAÍDA", qtd=3, parte="Funcionário", colaborador_id=self.ids["Ana ASO"], data="2025-01-11")
        self.assertEqual(r.status_code, 302, r.text[:300])
        lista = EDITOR.pagina(reg="epi").text
        self.assertIn("ÓTIMO", lista)
        self.assertIn("R$ 73,50", lista, "estoque 7 x 10,50")
        r = novo(EDITOR, "mov_epi", epi_id=epi, movimento="SAÍDA", qtd=8, parte="Funcionário", colaborador_id=self.ids["Ana ASO"], data="2025-01-12")
        self.assertIn("Estoque insuficiente", r.text)
        r = novo(EDITOR, "mov_epi", epi_id=epi, movimento="SAÍDA", qtd=1, parte="Funcionário", data="2025-01-12")
        self.assertIn("Escolha o colaborador", r.text)
        r = novo(EDITOR, "mov_epi", epi_id=epi, movimento="SAÍDA", qtd=6.5, parte="Funcionário", colaborador_id=self.ids["Beto ASO"], data="2025-01-12")
        self.assertEqual(r.status_code, 302)
        self.assertIn("ABAIXO", EDITOR.pagina(reg="epi").text)

    def test_risco_matriz_5x5(self):
        r = novo(EDITOR, "riscos", funcao="Serralheiro", setor="Operacional", tipo="ACIDENTE", descricao="Queda de altura", probabilidade="ALTA", severidade="GRAVÍSSIMO")
        self.assertEqual(r.status_code, 302, r.text[:300])
        lista = EDITOR.pagina(reg="riscos").text
        self.assertIn("EXTREMO", lista)
        self.assertRegex(lista, r">20<")

    def test_extintor_e_hidrante(self):
        from datetime import date, timedelta
        h = date.today()
        r = novo(EDITOR, "extintores", tipo="PQS ABC-6KG", localizacao="Portaria", data_recarga=(h - timedelta(days=400)).isoformat(), validade_meses=12,
                 data_teste=(h - timedelta(days=100)).isoformat())
        self.assertEqual(r.status_code, 302, r.text[:300])
        lista = EDITOR.pagina(reg="extintores").text
        self.assertIn("VENCIDO", lista)
        novo(EDITOR, "hidrantes", localizacao="Galpão", data_teste=(h - timedelta(days=350)).isoformat())
        self.assertIn("DIAS PARA VENCER", EDITOR.pagina(reg="hidrantes").text)

    def test_desvio_atrasado_e_plano(self):
        r = novo(EDITOR, "desvios", ocorrencia="Desvio", descricao="Sem cinto", data="2025-02-01", acoes="Treinar", prazo="2025-02-10")
        self.assertEqual(r.status_code, 302, r.text[:300])
        self.assertIn("ATRASADO", EDITOR.pagina(reg="desvios").text)
        r = novo(EDITOR, "planos", nome="Plano teste", status="EM ABERTO", prioridade="ALTA", conclusao="2025-01-01")
        self.assertEqual(r.status_code, 302)
        self.assertIn("ATRASADO", EDITOR.pagina(reg="planos").text)

    def test_nao_exclui_colaborador_com_vinculos(self):
        r = EDITOR.post(acao="excluir", reg="colaboradores", id=self.ids["Ana ASO"])
        self.assertEqual(r.status_code, 302)
        self.assertEqual(AMB.sql("SELECT COUNT(*) FROM sesmt_colaboradores WHERE nome='Ana ASO'")[0][0], 1)
        self.assertIn("vinculados", EDITOR.pagina(reg="colaboradores").text)

    def test_exclui_colaborador_sem_vinculos(self):
        novo(EDITOR, "colaboradores", empresa="EJ", status="Contratado", nome="Para Excluir")
        cid = AMB.sql("SELECT id FROM sesmt_colaboradores WHERE nome='Para Excluir'")[0][0]
        EDITOR.post(acao="excluir", reg="colaboradores", id=cid)
        self.assertEqual(AMB.sql("SELECT COUNT(*) FROM sesmt_colaboradores WHERE nome='Para Excluir'")[0][0], 0)

    def test_referencia_inexistente_e_recusada(self):
        r = novo(EDITOR, "aso", colaborador_id=99999, tipo="Periódico", data_emissao="2025-01-01", validade_dias=90)
        self.assertIn("escolha um item cadastrado", r.text)


class T04_Listas(unittest.TestCase):
    def test_listas_foram_semeadas_sem_nomes_de_colaboradores(self):
        tudo = [v for (v,) in AMB.sql("SELECT valor FROM sesmt_listas")]
        self.assertIn("Contratado", tudo)
        self.assertIn("NR 35", tudo)
        self.assertNotIn("ADAILTON AMARANTE DAS NEVES", tudo)
        listas = {l for (l,) in AMB.sql("SELECT DISTINCT lista FROM sesmt_listas")}
        self.assertFalse([l for l in listas if "colaborador" in l and l != "status_colaborador"])
        pagina = EDITOR.pagina(v="listas").text
        self.assertIn("não é uma fonte de dados", pagina)

    def test_adicionar_e_remover_valor(self):
        r = EDITOR.post(acao="lista_add", lista="norma", valor="NR 18-X")
        self.assertEqual(r.status_code, 302)
        self.assertIn("NR 18-X", EDITOR.pagina(reg="treinamentos", modo="form").text)
        r = EDITOR.post(acao="lista_add", lista="norma", valor="NR 18-X")
        self.assertIn("já existe", EDITOR.s.get(AMB.base + "/sesmt.php?v=listas").text)
        EDITOR.post(acao="lista_del", lista="norma", valor="NR 18-X")
        self.assertNotIn("NR 18-X", EDITOR.pagina(reg="treinamentos", modo="form").text)

    def test_lista_fixa_nao_muda(self):
        EDITOR.post(acao="lista_add", lista="severidade", valor="TESTE")
        self.assertNotIn("TESTE", [v for (v,) in AMB.sql("SELECT valor FROM sesmt_listas WHERE lista='severidade'")])

    def test_valor_apagado_nao_volta_na_proxima_carga(self):
        EDITOR.post(acao="lista_del", lista="agente_causador", valor="Rampa")
        EDITOR.pagina()
        self.assertNotIn("Rampa", [v for (v,) in AMB.sql("SELECT valor FROM sesmt_listas WHERE lista='agente_causador'")])


class T05_Configuracao(unittest.TestCase):
    def test_so_admin_salva(self):
        r = EDITOR.post(acao="cfg", meta_dias=50, jornada=8, dias_mes=26, hidro_extintor_dias=1800, hidro_hidrante_dias=360)
        self.assertEqual(r.status_code, 302)
        self.assertIn("Somente o administrador", EDITOR.s.get(AMB.base + "/sesmt.php?v=config").text)
        r = ADMIN.post(acao="cfg", meta_dias=50, jornada=8, dias_mes=26, hidro_extintor_dias=1800, hidro_hidrante_dias=360, empresa_nome="Rótula Metalúrgica")
        self.assertEqual(r.status_code, 302)
        pagina = ADMIN.s.get(AMB.base + "/sesmt.php?v=config").text
        self.assertIn("Configurações salvas", pagina)
        self.assertIn('value="50"', pagina)
        self.assertIn("Rótula Metalúrgica", pagina)

    def test_valores_invalidos(self):
        ADMIN.post(acao="cfg", meta_dias=0, jornada=8, dias_mes=26, hidro_extintor_dias=1800, hidro_hidrante_dias=360)
        self.assertIn("maiores que zero", ADMIN.s.get(AMB.base + "/sesmt.php?v=config").text)


class T06_Paginas(unittest.TestCase):
    def test_todas_as_telas_carregam_sem_erro(self):
        for reg in ("colaboradores", "aso", "treinamentos", "presenca", "advertencias", "cipa", "acidentes", "desvios", "auditorias", "planos", "dds",
                    "epi", "mov_epi", "riscos", "atividades", "oss", "equipamentos", "manutencoes", "extintores", "hidrantes", "veiculos",
                    "frota_manut", "quimicos", "documentos"):
            for modo in ("lista", "form"):
                r = ADMIN.pagina(reg=reg, modo=modo)
                self.assertEqual(r.status_code, 200, f"{reg}/{modo}")
                self.assertNotIn("Fatal error", r.text, f"{reg}/{modo}")
                self.assertNotIn("Warning:", r.text, f"{reg}/{modo}")
                self.assertNotIn("Notice:", r.text, f"{reg}/{modo}")
        for v in ("painel", "listas", "config", "acessos"):
            r = ADMIN.pagina(v=v)
            self.assertEqual(r.status_code, 200, v)
            self.assertNotIn("Fatal error", r.text, v)

    def test_cadastro_inexistente_cai_no_painel(self):
        self.assertIn("Painel SESMT", ADMIN.pagina(reg="nao-existe").text)

    def test_registros_de_outra_obra_nao_aparecem(self):
        AMB.sql("SELECT 1")
        con = sqlite3.connect(AMB.db)
        con.execute("INSERT INTO sesmt_colaboradores (obra_id, empresa, status, nome) VALUES (99, 'OUTRA', 'Contratado', 'Pessoa De Outra Obra')")
        con.commit()
        con.close()
        self.assertNotIn("Pessoa De Outra Obra", ADMIN.pagina(reg="colaboradores").text)
        self.assertNotIn("Pessoa De Outra Obra", ADMIN.pagina(reg="colaboradores", q="Pessoa").text)


if __name__ == "__main__":
    unittest.main(verbosity=2)
