import datetime
import os
import sys
import tempfile
import unittest

import openpyxl

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from leitores import cronograma, fixadores, ifc_modelo, orcamento  # noqa: E402


def planilha(abas):
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    for nome, linhas in abas.items():
        ws = wb.create_sheet(nome)
        for l in linhas:
            ws.append(l)
    fd, caminho = tempfile.mkstemp(suffix=".xlsx")
    os.close(fd)
    wb.save(caminho)
    return caminho


class TestPosicao(unittest.TestCase):
    def test_codigos_do_tekla(self):
        self.assertEqual(ifc_modelo.posicao("V23/H10-H9"), {"v": ["V23", "V23"], "h": ["H10", "H9"]})
        self.assertEqual(ifc_modelo.posicao("V1-V2/H3"), {"v": ["V1", "V2"], "h": ["H3", "H3"]})
        self.assertEqual(ifc_modelo.posicao("<V4-V5/H1-H2>"), {"v": ["V4", "V5"], "h": ["H1", "H2"]})
        self.assertIsNone(ifc_modelo.posicao(""))
        self.assertIsNone(ifc_modelo.posicao("sem código"))

    def test_fase(self):
        self.assertEqual(ifc_modelo.fase_info("3.1.5 ESM FECHAMENTO LATERAL"), ("3.1.5", "ESM FECHAMENTO LATERAL"))
        self.assertEqual(ifc_modelo.fase_info("CHUMBADORES"), ("", "CHUMBADORES"))


class TestOrcamento(unittest.TestCase):
    def test_memorial_com_item_repetido(self):
        c = planilha({"MC-Montagem": [
            ["ÍTEM", "", "DESCRIÇÃO DO ITEM", "MEMÓRIAL DE CÁLCULO"],
            ["", "", "", "QTD", "UNIDADE", "VALOR %", "PESO ATVD"],
            ["1", 100000.0, "TOTAL DO CONTRATO MONTAGEM", "", "", "", ""],
            ["3.1.1", "", "ESTRUTURA DO GALPÃO", 100, "", 0.6, ""],
            ["", "", "Instalação de vigas", 10, "un", 0.2, 0.4],
            ["", "", "Instalação de joist", 20, "un", 0.4, 0.6],
            ["3.1.2", "", "FECHAMENTO", 50, "", 0.2, ""],
            ["", "", "Instalação de terças", 5, "un", 0.2, 1.0],
            ["3.1.2", "", "MARQUISE", 30, "", 0.2, ""],     # código repetido na planilha
            ["", "", "Instalação de vigas da marquise", 3, "un", 0.2, 1.0],
        ]})
        r = orcamento.ler(c)
        self.assertEqual([i["codigo"] for i in r["itens"]], ["3.1.1", "3.1.2", "3.1.3"])
        self.assertEqual(r["contrato_total"], 100000.0)
        gal = r["itens"][0]
        self.assertAlmostEqual(gal["valor"], 60000.0)
        self.assertAlmostEqual(sum(a["peso"] for a in gal["atividades"]), 1.0)
        self.assertTrue(any("duas vezes" in a for a in r["avisos"]))

    def test_so_escopo(self):
        c = planilha({"OF": [["ITEM", "DESCRIÇÃO", "FORNECEDOR", "UNIDADE", "QTDE."], ["1.1", "Cobertura", "X", "m²", 100.0]]})
        r = orcamento.ler(c)
        self.assertEqual(len(r["itens"]), 1)
        self.assertEqual(r["itens"][0]["atividades"], [])


class TestCronograma(unittest.TestCase):
    def test_planilha_de_curto_prazo(self):
        d = datetime.datetime
        c = planilha({"CRONOGRAMA": [
            ["Item", "TAREFAS NORMAIS", "PRODUTIVIDADE/DIA", "Total de unidades", "INICIO", "CONCLUSÃO"],
            ["Setor A", None, None, None, None, None],
            [1, "Pré montagem Joist", 2, 45, d(2026, 5, 6), d(2026, 7, 3)],
            [2, "Telha de cobertura", 29, 466, d(2026, 6, 13), d(2026, 7, 10)],
        ]})
        r = cronograma.ler(c, "crono.xlsx")
        self.assertEqual(len(r["atividades"]), 2)
        self.assertEqual(r["atividades"][0]["setor"], "Setor A")
        self.assertEqual(r["inicio"], "2026-05-06")
        self.assertEqual(r["fim"], "2026-07-10")

    def test_pdf_nao_e_lido(self):
        r = cronograma.ler("/nao/existe.pdf", "crono.pdf")
        self.assertEqual(r["atividades"], [])
        self.assertTrue(r["avisos"])


class TestFixadores(unittest.TestCase):
    def test_chave_igual_entre_ifc_e_lista(self):
        pares = [('PARAF_1/2"X1"1/2_A307', 'PARAF. Ø1/2" X 1 1/2"', "A307"),
                 ('PARAF_3/8"X3/4"_A325', 'PARAF. Ø3/8" X 3/4"', "A325"),
                 ('PORCA_3/8"_HEX', 'PORCA Ø3/8"', "-"),
                 ('ARRUELA_5/8"_LISA', 'ARRUELA Ø5/8"', "-"),
                 ('PARABOLT_1/2"X4.1/4"', 'PARABOLT Ø1/2" X 4 1/4"', ""),
                 ('AB 1/4"X3/4"_TCP3', 'PARAF. AB Ø1/4" X 3/4"', "AB_TCP3"),
                 ('PARAF_3/8"X1"_GR.8', 'PARAF. Ø3/8" X 1"', "Gr.8")]
        for ifc, lista, norma in pares:
            self.assertEqual(fixadores.chave(ifc), fixadores.chave(lista, norma), (ifc, lista))

    def test_normas_diferentes_nao_se_misturam(self):
        self.assertNotEqual(fixadores.chave('PARAF_3/8"X1"_A307'), fixadores.chave('PARAF_3/8"X1"_A325'))

    def test_lista_geral_e_por_joist(self):
        c = planilha({"Fix": [
            ["JOIST01 DUPLA ( 4X )"],
            ["Qtd", "Descrição", "Comp. (mm)", "Peso Unit. (kg)", "Peso Total (kg)", "Material"],
            [16, 'PARAF. Ø3/8" X 1"', 25, 0.02, 0.32, "A307"],
            [16, 'PORCA Ø3/8"', "-", 0.01, 0.16, "-"],
        ]})
        r = fixadores.ler(c, "f.xlsx")
        self.assertEqual(len(r["por_joist"]), 1)
        self.assertEqual(r["por_joist"][0]["quantidade_de_joists"], 4)
        self.assertEqual(len(r["por_joist"][0]["itens"]), 2)
        self.assertEqual(r["por_joist"][0]["itens"][0]["tipo"], "parafuso")


if __name__ == "__main__":
    unittest.main()
