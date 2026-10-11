"""Cálculos tributários (estimativas) — salário CLT, pró-labore, MEI e ME (Simples Anexos III/V).

Parâmetros de 2026 concentrados no topo do arquivo: ao mudar a tabela oficial,
basta ajustar aqui. São ESTIMATIVAS para planejamento — confirme com seu contador.
"""
from __future__ import annotations

from dataclasses import dataclass

# ---------------------------------------------------------------- parâmetros
SALARIO_MINIMO = 1621.00
TETO_INSS = 8475.55

# (teto da faixa, alíquota) — INSS progressivo (empregado/contribuinte individual)
INSS_FAIXAS = [(1621.00, 0.075), (2902.84, 0.09), (4354.27, 0.12), (8475.55, 0.14)]

# (limite superior, alíquota, parcela a deduzir) — IRRF mensal
IRRF_FAIXAS = [
    (2428.80, 0.0, 0.0),
    (2826.65, 0.075, 182.16),
    (3751.05, 0.15, 394.16),
    (4664.68, 0.225, 675.49),
    (float("inf"), 0.275, 908.73),
]
DEDUCAO_DEPENDENTE = 189.59
DESCONTO_SIMPLIFICADO = 607.20
# Lei 15.270/2025 (a partir de 2026): isenção efetiva até R$ 5.000 e redutor até R$ 7.350
IRRF_ISENCAO_TOTAL = 5000.00
IRRF_LIMITE_REDUTOR = 7350.00
IRRF_REDUTOR_A = 978.62
IRRF_REDUTOR_B = 0.133145

# MEI
MEI_LIMITE_ANUAL = 81_000.00
MEI_ICMS = 1.00
MEI_ISS = 5.00
MEI_INSS_PERC = 0.05  # 5% do salário mínimo

# Simples Nacional — (limite RBT12, alíquota nominal, parcela a deduzir)
ANEXO_III = [
    (180_000, 0.060, 0.0),
    (360_000, 0.112, 9_360.0),
    (720_000, 0.135, 17_640.0),
    (1_800_000, 0.160, 35_640.0),
    (3_600_000, 0.210, 125_640.0),
    (4_800_000, 0.330, 648_000.0),
]
ANEXO_V = [
    (180_000, 0.155, 0.0),
    (360_000, 0.180, 4_500.0),
    (720_000, 0.195, 9_900.0),
    (1_800_000, 0.205, 17_100.0),
    (3_600_000, 0.230, 62_100.0),
    (4_800_000, 0.305, 540_000.0),
]
LIMITE_ME = 360_000.00  # acima disso a empresa é EPP (mesmas tabelas)
FATOR_R_MINIMO = 0.28


# ------------------------------------------------------------------- INSS/IRRF
def calcular_inss(base: float) -> float:
    """INSS progressivo, limitado ao teto."""
    base = min(max(base, 0.0), TETO_INSS)
    total, anterior = 0.0, 0.0
    for teto, aliquota in INSS_FAIXAS:
        if base > anterior:
            total += (min(base, teto) - anterior) * aliquota
        anterior = teto
    return round(total, 2)


def calcular_irrf(bruto: float, inss: float, dependentes: int = 0) -> float:
    """IRRF mensal com a regra de 2026 (isenção efetiva até R$ 5 mil + redutor)."""
    if bruto <= 0:
        return 0.0
    deducoes = max(inss + dependentes * DEDUCAO_DEPENDENTE, DESCONTO_SIMPLIFICADO)
    base = max(bruto - deducoes, 0.0)
    imposto = 0.0
    for limite, aliquota, parcela in IRRF_FAIXAS:
        if base <= limite:
            imposto = max(base * aliquota - parcela, 0.0)
            break
    if bruto <= IRRF_ISENCAO_TOTAL:
        return 0.0
    if bruto <= IRRF_LIMITE_REDUTOR:
        imposto -= max(IRRF_REDUTOR_A - IRRF_REDUTOR_B * bruto, 0.0)
    return round(max(imposto, 0.0), 2)


@dataclass
class ResultadoCLT:
    bruto: float
    inss: float
    irrf: float
    outros: float
    liquido: float
    fgts: float  # depósito do empregador (não sai do seu bolso)
    aliquota_efetiva: float
    anual_liquido: float  # 12 meses + 13º + 1/3 de férias (aprox., sem descontos extras)


def salario_clt(bruto: float, dependentes: int = 0, outros_descontos: float = 0.0) -> ResultadoCLT:
    inss = calcular_inss(bruto)
    irrf = calcular_irrf(bruto, inss, dependentes)
    liquido = bruto - inss - irrf - outros_descontos
    ferias_terco = bruto / 3
    inss13 = calcular_inss(bruto)
    ir13 = calcular_irrf(bruto, inss13, dependentes)
    liq13 = bruto - inss13 - ir13
    bruto_ferias = bruto + ferias_terco
    inss_f = calcular_inss(bruto_ferias)
    ir_f = calcular_irrf(bruto_ferias, inss_f, dependentes)
    liq_ferias_extra = ferias_terco - (inss_f - inss) - (ir_f - irrf)
    anual = liquido * 12 + liq13 + liq_ferias_extra
    return ResultadoCLT(
        bruto=bruto, inss=inss, irrf=irrf, outros=outros_descontos, liquido=round(liquido, 2),
        fgts=round(bruto * 0.08, 2),
        aliquota_efetiva=(inss + irrf) / bruto if bruto else 0.0,
        anual_liquido=round(anual, 2),
    )


# ------------------------------------------------------------------------- MEI
@dataclass
class ResultadoMEI:
    das: float
    inss: float
    iss: float
    icms: float
    limite_mensal: float
    dentro_do_limite: bool
    liquido: float
    receita: float


def mei(receita_mensal: float, atividade: str = "servicos", despesas: float = 0.0) -> ResultadoMEI:
    """DAS-MEI fixo. atividade: 'servicos', 'comercio' ou 'ambos'."""
    inss = SALARIO_MINIMO * MEI_INSS_PERC
    icms = MEI_ICMS if atividade in ("comercio", "ambos") else 0.0
    iss = MEI_ISS if atividade in ("servicos", "ambos") else 0.0
    das = inss + icms + iss
    return ResultadoMEI(
        das=round(das, 2), inss=round(inss, 2), iss=iss, icms=icms,
        limite_mensal=MEI_LIMITE_ANUAL / 12,
        dentro_do_limite=receita_mensal * 12 <= MEI_LIMITE_ANUAL,
        liquido=round(receita_mensal - das - despesas, 2),
        receita=receita_mensal,
    )


# -------------------------------------------------------------- Simples (ME/EPP)
def aliquota_efetiva_simples(rbt12: float, tabela) -> tuple[float, float, float]:
    """Retorna (alíquota efetiva, alíquota nominal, parcela a deduzir)."""
    if rbt12 <= 0:
        return tabela[0][1], tabela[0][1], 0.0
    for limite, nominal, deduzir in tabela:
        if rbt12 <= limite:
            return (rbt12 * nominal - deduzir) / rbt12, nominal, deduzir
    limite, nominal, deduzir = tabela[-1]
    return (rbt12 * nominal - deduzir) / rbt12, nominal, deduzir


@dataclass
class ResultadoME:
    anexo: str
    receita: float
    rbt12: float
    fator_r: float
    aliquota_efetiva: float
    aliquota_nominal: float
    das: float
    pro_labore: float
    inss_pro_labore: float
    irrf_pro_labore: float
    despesas_empresa: float
    lucro_distribuivel: float
    liquido_no_bolso: float
    carga_total: float  # (DAS + INSS + IRRF) / receita
    epp: bool
    pro_labore_para_fator_r: float


def me_simples(receita_mensal: float, pro_labore: float, despesas_empresa: float = 0.0,
               dependentes: int = 0, rbt12: float | None = None, forcar_anexo: str | None = None) -> ResultadoME:
    """ME optante pelo Simples: Anexo III se Fator R >= 28%, senão Anexo V (ex.: engenharia).

    O Fator R usa folha ÷ receita (ambos em 12 meses); com receita estável equivale à razão mensal.
    """
    rbt12 = rbt12 if rbt12 is not None else receita_mensal * 12
    fator_r = pro_labore / receita_mensal if receita_mensal else 0.0
    anexo = forcar_anexo or ("III" if fator_r >= FATOR_R_MINIMO else "V")
    tabela = ANEXO_III if anexo == "III" else ANEXO_V
    efetiva, nominal, _ = aliquota_efetiva_simples(rbt12, tabela)
    das = receita_mensal * efetiva
    inss_pl = round(min(pro_labore, TETO_INSS) * 0.11, 2)
    irrf_pl = calcular_irrf(pro_labore, inss_pl, dependentes)
    lucro = receita_mensal - das - despesas_empresa - pro_labore
    liquido = pro_labore - inss_pl - irrf_pl + max(lucro, 0.0)
    carga = (das + inss_pl + irrf_pl) / receita_mensal if receita_mensal else 0.0
    return ResultadoME(
        anexo=anexo, receita=receita_mensal, rbt12=rbt12, fator_r=fator_r,
        aliquota_efetiva=efetiva, aliquota_nominal=nominal, das=round(das, 2),
        pro_labore=pro_labore, inss_pro_labore=inss_pl, irrf_pro_labore=irrf_pl,
        despesas_empresa=despesas_empresa, lucro_distribuivel=round(lucro, 2),
        liquido_no_bolso=round(liquido, 2), carga_total=carga, epp=rbt12 > LIMITE_ME,
        pro_labore_para_fator_r=round(receita_mensal * FATOR_R_MINIMO, 2),
    )
