"""Renda fixa brasileira: CDI, CDB, LCI/LCA, Tesouro Selic e poupança (estimativas)."""
from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

DIAS_UTEIS_ANO = 252
DIAS_UTEIS_MES = 21
CUSTODIA_TESOURO = 0.0020  # 0,20% a.a. (B3), isento para Tesouro Selic até R$ 10 mil — simplificação

PRODUTOS = ["CDB", "LCI/LCA", "Tesouro Selic", "Poupança"]


def aliquota_ir(dias_corridos: int) -> float:
    """Tabela regressiva da renda fixa."""
    if dias_corridos <= 180:
        return 0.225
    if dias_corridos <= 360:
        return 0.20
    if dias_corridos <= 720:
        return 0.175
    return 0.15


def taxa_mensal(taxa_anual: float) -> float:
    return (1 + taxa_anual) ** (DIAS_UTEIS_MES / DIAS_UTEIS_ANO) - 1


def rendimento_poupanca_anual(selic: float) -> float:
    """Selic > 8,5% a.a. -> 0,5% a.m. + TR (TR ≈ 0); senão 70% da Selic."""
    return (1.005) ** 12 - 1 if selic > 0.085 else 0.70 * selic


@dataclass
class ParametrosMercado:
    selic: float = 0.15  # a.a.
    cdi: float = 0.149  # a.a.
    ipca: float = 0.045  # a.a.


def taxa_bruta_anual(produto: str, taxa_contratada: float, m: ParametrosMercado) -> float:
    """taxa_contratada = % do CDI (CDB, LCI/LCA) ou spread a.a. sobre a Selic (Tesouro)."""
    if produto in ("CDB", "LCI/LCA"):
        return m.cdi * taxa_contratada
    if produto == "Tesouro Selic":
        return m.selic + taxa_contratada - CUSTODIA_TESOURO
    return rendimento_poupanca_anual(m.selic)


def simular(produto: str, taxa_contratada: float, inicial: float, aporte_mensal: float,
            meses: int, m: ParametrosMercado) -> pd.DataFrame:
    """Evolução mês a mês: investido, saldo bruto, IR, saldo líquido."""
    anual = taxa_bruta_anual(produto, taxa_contratada, m)
    mensal = taxa_mensal(anual)
    isento = produto in ("LCI/LCA", "Poupança")
    saldo, investido = inicial, inicial
    linhas = [(0, investido, saldo, 0.0, saldo)]
    # cada aporte tem prazo próprio para o IR regressivo
    lotes = [(0, inicial)] if inicial else []
    for mes in range(1, meses + 1):
        saldo = saldo * (1 + mensal) + aporte_mensal
        investido += aporte_mensal
        if aporte_mensal:
            lotes.append((mes, aporte_mensal))
        ir = 0.0
        if not isento:  # todos os lotes rendem à mesma taxa; IR depende da idade de cada lote
            ir = sum(v * ((1 + mensal) ** (mes - e) - 1) * aliquota_ir((mes - e) * 30) for e, v in lotes)
        linhas.append((mes, investido, saldo, ir, saldo - ir))
    return pd.DataFrame(linhas, columns=["mes", "investido", "bruto", "ir", "liquido"])


def equivalente_cdb(lci_percentual_cdi: float, dias: int) -> float:
    """% do CDI que um CDB precisa pagar para empatar com uma LCI/LCA isenta."""
    return lci_percentual_cdi / (1 - aliquota_ir(dias))


def comparar(inicial: float, aporte: float, meses: int, m: ParametrosMercado,
             pct_cdb: float, pct_lci: float, spread_tesouro: float) -> pd.DataFrame:
    linhas = []
    for prod, taxa in [("CDB", pct_cdb), ("LCI/LCA", pct_lci),
                       ("Tesouro Selic", spread_tesouro), ("Poupança", 0.0)]:
        df = simular(prod, taxa, inicial, aporte, meses, m)
        ult = df.iloc[-1]
        retorno = ult.liquido / ult.investido - 1 if ult.investido else 0.0
        linhas.append({
            "Produto": prod, "Investido": ult.investido, "Saldo bruto": ult.bruto,
            "IR": ult.ir, "Saldo líquido": ult.liquido,
            "Ganho líquido": ult.liquido - ult.investido,
            "Ganho s/ investido": retorno,
        })
    return pd.DataFrame(linhas)


def buscar_taxas_bcb(timeout: float = 5.0) -> ParametrosMercado | None:
    """Tenta ler Selic meta (432), CDI a.a. (4389) e IPCA 12m (13522) na API do Banco Central."""
    import json
    import urllib.request

    def ultimo(serie: int) -> float:
        url = f"https://api.bcb.gov.br/dados/serie/bcdata.sgs.{serie}/dados/ultimos/1?formato=json"
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return float(json.load(r)[0]["valor"].replace(",", ".")) / 100

    try:
        return ParametrosMercado(selic=ultimo(432), cdi=ultimo(4389), ipca=ultimo(13522))
    except Exception:
        return None
