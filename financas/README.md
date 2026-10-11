# Controle Financeiro

Dashboard em Python (Streamlit + Plotly) para finanças pessoais e da empresa.

```bash
pip install -r requirements.txt
streamlit run app.py
```

- **Painel** — receitas, despesas, custos fixos × variáveis, categorias, saldo acumulado e diagnóstico (regra 50/30/20, reserva de emergência, peso do cartão).
- **Lançamentos** — cadastro com repetição mensal (parcela do carro, aluguel, salário), edição na tabela, exportação CSV. Dados em `dados/lancamentos.csv` (fora do Git).
- **Impostos** — salário CLT (INSS + IRRF 2026), MEI, ME no Simples (Anexo III/V com Fator R) e comparativo.
- **Investimentos** — CDB, LCI/LCA, Tesouro Selic e poupança com CDI/Selic/IPCA (botão busca no Banco Central), IR regressivo e equivalência CDB × LCI.

Tabelas e alíquotas ficam em `impostos.py` / `investimentos.py`. São **estimativas** — valide com o contador.
Testes: `python teste_financas.py`.
