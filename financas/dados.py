"""Lançamentos financeiros: armazenamento em CSV, parcelamentos e dados de exemplo."""
from __future__ import annotations

from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd

ARQUIVO = Path(__file__).parent / "dados" / "lancamentos.csv"
COLUNAS = ["data", "tipo", "natureza", "categoria", "descricao", "valor", "pago"]

CATEGORIAS_RECEITA = ["Salário", "Pró-labore", "Serviços / PJ", "Rendimentos", "Outras receitas"]
CATEGORIAS_FIXAS = ["Aluguel / Moradia", "Parcela do carro", "Condomínio", "Internet e telefone",
                    "Plano de saúde", "Seguros", "Educação", "Impostos (DAS/INSS)", "Assinaturas"]
CATEGORIAS_VARIAVEIS = ["Cartão de crédito", "Mercado", "Combustível", "Restaurantes",
                        "Lazer", "Saúde", "Vestuário", "Outras despesas"]


def vazio() -> pd.DataFrame:
    return pd.DataFrame({
        "data": pd.Series(dtype="datetime64[ns]"), "tipo": pd.Series(dtype="object"),
        "natureza": pd.Series(dtype="object"), "categoria": pd.Series(dtype="object"),
        "descricao": pd.Series(dtype="object"), "valor": pd.Series(dtype="float64"),
        "pago": pd.Series(dtype="bool"),
    })


def normalizar(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    for c in COLUNAS:
        if c not in df:
            df[c] = None
    df = df[COLUNAS]
    df["data"] = pd.to_datetime(df["data"], errors="coerce").astype("datetime64[ns]")
    df["valor"] = pd.to_numeric(df["valor"], errors="coerce").fillna(0.0).abs()
    df["pago"] = df["pago"].fillna(True).astype(bool)
    df["natureza"] = np.where(df["tipo"] == "Receita", "—", df["natureza"].fillna("Variável"))
    df = df.dropna(subset=["data", "tipo"])
    return df.sort_values("data").reset_index(drop=True)


def carregar() -> tuple[pd.DataFrame, bool]:
    """Retorna (dataframe, é_exemplo)."""
    if ARQUIVO.exists():
        return normalizar(pd.read_csv(ARQUIVO)), False
    return exemplo(), True


def salvar(df: pd.DataFrame) -> None:
    ARQUIVO.parent.mkdir(parents=True, exist_ok=True)
    normalizar(df).to_csv(ARQUIVO, index=False)


def gerar_parcelas(primeira: date, meses: int, valor: float, tipo: str, natureza: str,
                   categoria: str, descricao: str) -> pd.DataFrame:
    """Cria um lançamento por mês (parcelas, aluguel, salário recorrente...)."""
    datas = pd.date_range(pd.Timestamp(primeira), periods=meses, freq="MS") + pd.Timedelta(days=primeira.day - 1)
    linhas = []
    for i, d in enumerate(datas, 1):
        sufixo = f" ({i}/{meses})" if meses > 1 else ""
        linhas.append({"data": d, "tipo": tipo, "natureza": natureza, "categoria": categoria,
                       "descricao": descricao + sufixo, "valor": valor, "pago": d.date() <= date.today()})
    return pd.DataFrame(linhas)


def exemplo() -> pd.DataFrame:
    """Seis meses de dados FICTÍCIOS só para demonstrar o painel."""
    rng = np.random.default_rng(7)
    linhas = []
    for mes in pd.period_range("2026-05", "2026-10", freq="M"):
        d = lambda dia: mes.to_timestamp() + pd.Timedelta(days=dia - 1)  # noqa: E731
        linhas += [
            (d(5), "Receita", "—", "Pró-labore", "Pró-labore da empresa", 4200.0),
            (d(10), "Receita", "—", "Serviços / PJ", "Projeto estrutura metálica", float(rng.integers(9000, 15500))),
            (d(20), "Receita", "—", "Rendimentos", "CDB / Tesouro Selic", float(rng.integers(380, 520))),
            (d(5), "Despesa", "Fixa", "Aluguel / Moradia", "Aluguel", 2800.0),
            (d(5), "Despesa", "Fixa", "Condomínio", "Condomínio", 520.0),
            (d(10), "Despesa", "Fixa", "Parcela do carro", "Financiamento do carro", 1450.0),
            (d(12), "Despesa", "Fixa", "Internet e telefone", "Internet + celular", 240.0),
            (d(15), "Despesa", "Fixa", "Plano de saúde", "Plano de saúde", 780.0),
            (d(20), "Despesa", "Fixa", "Impostos (DAS/INSS)", "DAS Simples + INSS pró-labore", float(rng.integers(900, 1500))),
            (d(8), "Despesa", "Variável", "Cartão de crédito", "Fatura do cartão", float(rng.integers(2400, 4200))),
            (d(14), "Despesa", "Variável", "Mercado", "Supermercado", float(rng.integers(1300, 1900))),
            (d(16), "Despesa", "Variável", "Combustível", "Combustível", float(rng.integers(520, 880))),
            (d(22), "Despesa", "Variável", "Restaurantes", "Restaurantes e delivery", float(rng.integers(450, 900))),
            (d(25), "Despesa", "Variável", "Lazer", "Lazer e viagens", float(rng.integers(200, 1100))),
        ]
    df = pd.DataFrame(linhas, columns=["data", "tipo", "natureza", "categoria", "descricao", "valor"])
    df["pago"] = df["data"].dt.date <= date(2026, 10, 11)
    return normalizar(df)
