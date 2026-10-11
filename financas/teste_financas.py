"""Testes rápidos dos cálculos:  python teste_financas.py"""
import impostos as i
import investimentos as v
import dados


def aprox(a, b, tol=0.01):
    assert abs(a - b) <= tol, f"{a} != {b}"


aprox(i.calcular_inss(3000), 248.60)                      # progressivo
aprox(i.calcular_inss(20000), 988.09)                     # teto
aprox(i.calcular_irrf(5000, i.calcular_inss(5000)), 0)    # isenção efetiva até 5 mil (2026)
aprox(i.calcular_irrf(8000, i.calcular_inss(8000)), 1037.85)
assert i.mei(6000).das == 86.05 and i.mei(7000).dentro_do_limite is False
aprox(i.aliquota_efetiva_simples(300_000, i.ANEXO_III)[0], (300_000 * .112 - 9360) / 300_000, 1e-9)
assert i.me_simples(15000, 4200).anexo == "III" and i.me_simples(15000, 1621).anexo == "V"
assert i.me_simples(15000, 4200).liquido_no_bolso > i.me_simples(15000, 1621).liquido_no_bolso
assert v.aliquota_ir(100) == .225 and v.aliquota_ir(800) == .15
m = v.ParametrosMercado()
cdb = v.simular("CDB", 1.0, 10_000, 0, 12, m).iloc[-1]
assert cdb.liquido < cdb.bruto and v.simular("LCI/LCA", 1.0, 10_000, 0, 12, m).iloc[-1].ir == 0
assert len(dados.exemplo()) == 84
print("ok — todos os testes passaram")
