"""Controle Financeiro — dashboard (Streamlit).  Rodar:  streamlit run app.py"""
from __future__ import annotations

import re
from datetime import date

import pandas as pd
import plotly.graph_objects as go
import streamlit as st

import dados
import impostos as imp
import investimentos as inv

st.set_page_config(page_title="Controle Financeiro", page_icon="💰", layout="wide")

AZUL, LARANJA, VERDE, CINZA = "#2a78d6", "#eb6834", "#1baf7a", "#6b6a66"
MAGENTA, AMARELO, VIOLETA, VERMELHO = "#e87ba4", "#eda100", "#6250d6", "#e34948"
SERIE = [AZUL, LARANJA, VERDE, AMARELO, MAGENTA, VIOLETA, VERMELHO, CINZA]
MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"]

st.markdown("""
<style>
.block-container {padding-top: 2rem; max-width: 1280px;}
[data-testid="stMetric"] {background:#fff; border:1px solid #e6e4df; border-radius:10px; padding:14px 16px;}
[data-testid="stMetricLabel"] p {color:#52514e; font-size:.85rem;}
[data-testid="stMetricValue"] {font-size:1.6rem;}
[data-testid="stMetricValue"] div {text-overflow:clip !important;}
.insight {border-left:4px solid var(--c); background:#fff; border:1px solid #e6e4df;
          border-left:4px solid var(--c); border-radius:8px; padding:10px 14px; margin-bottom:8px; font-size:.92rem;}
.nota {color:#52514e; font-size:.82rem;}
</style>""", unsafe_allow_html=True)


def brl(v: float) -> str:
    s = f"{abs(v):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return f"{'-' if v < 0 else ''}R$ {s}"


def md(t: str) -> str:
    """Escapa $ para o Markdown do Streamlit não interpretar R$ ... R$ como fórmula."""
    return t.replace("$", "\\$")


def pct(v: float, casas: int = 1) -> str:
    return f"{v * 100:.{casas}f}%".replace(".", ",")


def rotulo_mes(p: pd.Period) -> str:
    return f"{MESES[p.month - 1]}/{str(p.year)[2:]}"


def estilo(fig: go.Figure, altura: int = 330) -> go.Figure:
    fig.update_layout(
        height=altura, margin=dict(l=8, r=8, t=8, b=8), paper_bgcolor="rgba(0,0,0,0)",
        plot_bgcolor="rgba(0,0,0,0)", font=dict(size=12, color="#52514e"),
        legend=dict(orientation="h", y=1.12, x=0), hovermode="x unified",
    )
    fig.update_xaxes(showgrid=False, linecolor="#d8d6d0")
    fig.update_yaxes(gridcolor="#eceae5", zeroline=False, tickprefix="R$ ", separatethousands=True)
    return fig


def mostrar(fig: go.Figure) -> None:
    st.plotly_chart(fig, width="stretch", config={"displayModeBar": False})


# ------------------------------------------------------------------ dados
if "df" not in st.session_state:
    st.session_state.df, st.session_state.exemplo = dados.carregar()
df: pd.DataFrame = st.session_state.df

st.title("💰 Controle Financeiro")
if st.session_state.exemplo:
    st.info("Você está vendo **dados fictícios de exemplo**. Cadastre seus lançamentos na aba "
            "**Lançamentos** e clique em *Salvar* — o exemplo some.")

tab_painel, tab_lanc, tab_imp, tab_inv = st.tabs(
    ["📊 Painel", "🧾 Lançamentos", "🏛️ Impostos (CLT · MEI · ME)", "📈 Investimentos"])

# ================================================================= PAINEL
with tab_painel:
    if df.empty:
        st.warning("Sem lançamentos ainda. Vá em **Lançamentos**.")
    else:
        df = df.assign(mes=df["data"].dt.to_period("M"))
        periodos = sorted(df["mes"].unique())
        c1, c2 = st.columns([3, 2])
        with c1:
            ini, fim = st.select_slider("Período", options=periodos, value=(periodos[0], periodos[-1]),
                                        format_func=rotulo_mes)
        with c2:
            reserva = st.number_input("Minha reserva de emergência hoje (R$)", min_value=0.0, value=28_000.0,
                                      step=1000.0, format="%.0f")
        f = df[(df["mes"] >= ini) & (df["mes"] <= fim)]
        rec = f.loc[f.tipo == "Receita", "valor"].sum()
        desp = f.loc[f.tipo == "Despesa", "valor"].sum()
        fixa = f.loc[(f.tipo == "Despesa") & (f.natureza == "Fixa"), "valor"].sum()
        var = f.loc[(f.tipo == "Despesa") & (f.natureza == "Variável"), "valor"].sum()
        saldo = rec - desp
        n_meses = max(len(pd.period_range(ini, fim, freq="M")), 1)
        poup = saldo / rec if rec else 0.0

        k = st.columns(5)
        k[0].metric("Receitas", brl(rec))
        k[1].metric("Despesas", brl(desp))
        k[2].metric("Saldo", brl(saldo), f"{pct(poup)} da renda", delta_arrow="off", delta_color="normal" if saldo >= 0 else "inverse")
        k[3].metric("Custos fixos", brl(fixa), f"{pct(fixa / rec if rec else 0, 0)} da renda", delta_color="off", delta_arrow="off")
        k[4].metric("Custos variáveis", brl(var), f"{pct(var / rec if rec else 0, 0)} da renda", delta_color="off", delta_arrow="off")

        mensal = (f.groupby(["mes", "tipo", "natureza"])["valor"].sum().reset_index())
        meses_idx = list(pd.period_range(ini, fim, freq="M"))
        x = [rotulo_mes(m) for m in meses_idx]

        def serie(tipo: str, nat: str | None = None) -> list[float]:
            m = mensal[mensal.tipo == tipo]
            if nat:
                m = m[m.natureza == nat]
            s = m.groupby("mes")["valor"].sum()
            return [float(s.get(p, 0.0)) for p in meses_idx]

        g1, g2 = st.columns(2)
        with g1:
            st.subheader("Receitas × despesas por mês")
            fig = go.Figure()
            fig.add_bar(x=x, y=serie("Receita"), name="Receitas", marker_color=AZUL, marker_cornerradius=4)
            fig.add_bar(x=x, y=serie("Despesa"), name="Despesas", marker_color=LARANJA, marker_cornerradius=4)
            fig.update_layout(barmode="group", bargap=0.35, bargroupgap=0.08)
            saldos = [a - b for a, b in zip(serie("Receita"), serie("Despesa"))]
            fig.add_scatter(x=x, y=saldos, name="Saldo", mode="lines+markers",
                            line=dict(color="#0b0b0b", width=2), marker=dict(size=8, line=dict(width=2, color="#fcfcfb")))
            mostrar(estilo(fig))
        with g2:
            st.subheader("Custos fixos × variáveis")
            fig = go.Figure()
            fig.add_bar(x=x, y=serie("Despesa", "Fixa"), name="Fixos", marker_color=LARANJA)
            fig.add_bar(x=x, y=serie("Despesa", "Variável"), name="Variáveis", marker_color=VERDE,
                        marker_line=dict(width=2, color="#fcfcfb"))
            fig.update_layout(barmode="stack", bargap=0.45)
            mostrar(estilo(fig))

        g3, g4 = st.columns(2)
        with g3:
            st.subheader("Para onde vai o dinheiro")
            cat = (f[f.tipo == "Despesa"].groupby(["categoria", "natureza"])["valor"].sum()
                   .reset_index().sort_values("valor"))
            fig = go.Figure(go.Bar(
                x=cat["valor"], y=cat["categoria"], orientation="h",
                marker_color=[LARANJA if n == "Fixa" else VERDE for n in cat["natureza"]],
                marker_cornerradius=4, text=[brl(v) for v in cat["valor"]], textposition="outside",
                cliponaxis=False, customdata=cat["natureza"],
                hovertemplate="%{y}<br>%{x:,.2f} (%{customdata})<extra></extra>"))
            estilo(fig, 360)
            fig.update_layout(hovermode="closest", showlegend=False)
            fig.update_xaxes(visible=False, range=[0, cat["valor"].max() * 1.28])
            fig.update_yaxes(tickprefix="", gridcolor="rgba(0,0,0,0)")
            mostrar(fig)
            st.markdown('<span class="nota">🟧 fixo · 🟩 variável</span>', unsafe_allow_html=True)
        with g4:
            st.subheader("Saldo acumulado")
            acum = pd.Series(saldos).cumsum()
            fig = go.Figure(go.Scatter(x=x, y=acum, mode="lines+markers", fill="tozeroy",
                                       line=dict(color=AZUL, width=2), fillcolor="rgba(42,120,214,.12)",
                                       marker=dict(size=8, line=dict(width=2, color="#fcfcfb")), name="Acumulado"))
            mostrar(estilo(fig, 360))

        # ---------- insights do "especialista"
        st.subheader("Diagnóstico financeiro")
        dm = desp / n_meses
        alvo_reserva = 6 * (fixa / n_meses)
        itens: list[tuple[str, str, str]] = []
        if poup >= 0.20:
            itens.append((VERDE, "✔", f"Taxa de poupança de **{pct(poup)}** — acima dos 20% da regra 50/30/20. Ótimo ritmo."))
        elif poup >= 0.10:
            itens.append((AMARELO, "▲", f"Taxa de poupança de **{pct(poup)}**. Meta saudável: 20%. Faltam {brl(rec * 0.2 - saldo)} no período."))
        else:
            itens.append((VERMELHO, "✖", f"Taxa de poupança de **{pct(poup)}** — abaixo de 10%. Revise despesas variáveis primeiro."))
        if rec and fixa / rec > 0.5:
            itens.append((VERMELHO, "✖", f"Custos fixos consomem **{pct(fixa / rec, 0)}** da renda (limite recomendado: 50%). Pouca flexibilidade se a receita cair."))
        else:
            itens.append((VERDE, "✔", f"Custos fixos em **{pct(fixa / rec if rec else 0, 0)}** da renda — dentro do limite de 50%."))
        cartao = f.loc[f.categoria == "Cartão de crédito", "valor"].sum()
        if rec and cartao / rec > 0.2:
            itens.append((AMARELO, "▲", f"Cartão de crédito = **{pct(cartao / rec, 0)}** da renda. Evite o rotativo (juros acima de 400% a.a.) e pague a fatura integral."))
        meses_cobertos = reserva / (fixa / n_meses) if fixa else 0
        if reserva >= alvo_reserva:
            itens.append((VERDE, "✔", f"Reserva de emergência cobre **{str(round(meses_cobertos, 1)).replace('.', ',')} meses** de custos fixos (meta: 6). Mantenha em liquidez diária (Tesouro Selic ou CDB 100% CDI)."))
        else:
            itens.append((AMARELO, "▲", f"Reserva cobre **{str(round(meses_cobertos, 1)).replace('.', ',')} meses** de custos fixos; meta de 6 meses = {brl(alvo_reserva)}. Faltam {brl(alvo_reserva - reserva)}."))
        if len(meses_idx) >= 2:
            ult, ant = serie("Despesa")[-1], serie("Despesa")[-2]
            if ant and ult > ant * 1.1:
                itens.append((AMARELO, "▲", f"Despesas do último mês subiram **{pct(ult / ant - 1, 0)}** frente ao mês anterior."))
        for cor, icone, txt in itens:
            html = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", txt)
            st.markdown(f'<div class="insight" style="--c:{cor}">{icone} {html}</div>', unsafe_allow_html=True)

        pend = df[(~df.pago) & (df.tipo == "Despesa")]
        if not pend.empty:
            st.caption(md(f"Contas a pagar em aberto: {len(pend)} lançamento(s), {brl(pend.valor.sum())}."))

# ============================================================= LANÇAMENTOS
with tab_lanc:
    st.subheader("Novo lançamento")
    with st.form("novo", clear_on_submit=True):
        a, b, c, d_ = st.columns([1, 1, 2, 2])
        tipo = a.selectbox("Tipo", ["Despesa", "Receita"])
        nat = b.selectbox("Natureza", ["Fixa", "Variável"], help="Só vale para despesas")
        cats = dados.CATEGORIAS_RECEITA + dados.CATEGORIAS_FIXAS + dados.CATEGORIAS_VARIAVEIS
        categoria = c.selectbox("Categoria", cats, index=len(dados.CATEGORIAS_RECEITA))
        desc = d_.text_input("Descrição")
        e, f_, g, h = st.columns(4)
        valor = e.number_input("Valor (R$)", min_value=0.0, step=50.0, format="%.2f")
        data_ = f_.date_input("Data (1ª parcela)", value=date.today(), format="DD/MM/YYYY")
        parcelas = g.number_input("Repetir por quantos meses?", 1, 120, 1,
                                  help="Parcela do carro, aluguel, salário... gera um lançamento por mês")
        if h.form_submit_button("➕ Adicionar", width="stretch"):
            if valor > 0:
                novo = dados.gerar_parcelas(data_, int(parcelas), valor, tipo, nat, categoria, desc or categoria)
                base = st.session_state.df if not st.session_state.exemplo else dados.vazio()
                st.session_state.df = dados.normalizar(pd.concat([base, novo], ignore_index=True))
                st.session_state.exemplo = False
                dados.salvar(st.session_state.df)
                st.rerun()
            else:
                st.warning("Informe um valor maior que zero.")

    st.subheader("Todos os lançamentos")
    st.caption("Edite direto na tabela (clique na célula). Para apagar, selecione a linha e use a lixeira.")
    editado = st.data_editor(
        st.session_state.df, num_rows="dynamic", width="stretch", hide_index=True, key="editor",
        column_config={
            "data": st.column_config.DateColumn("Data", format="DD/MM/YYYY"),
            "tipo": st.column_config.SelectboxColumn("Tipo", options=["Receita", "Despesa"]),
            "natureza": st.column_config.SelectboxColumn("Natureza", options=["Fixa", "Variável", "—"]),
            "categoria": st.column_config.SelectboxColumn(
                "Categoria", options=dados.CATEGORIAS_RECEITA + dados.CATEGORIAS_FIXAS + dados.CATEGORIAS_VARIAVEIS),
            "descricao": "Descrição",
            "valor": st.column_config.NumberColumn("Valor", format="R$ %.2f"),
            "pago": st.column_config.CheckboxColumn("Pago/Recebido"),
        })
    cs, cx, _ = st.columns([1, 1, 4])
    if cs.button("💾 Salvar alterações", type="primary"):
        st.session_state.df = dados.normalizar(editado)
        st.session_state.exemplo = False
        dados.salvar(st.session_state.df)
        st.success("Salvo em financas/dados/lancamentos.csv")
        st.rerun()
    cx.download_button("⬇️ Exportar CSV", st.session_state.df.to_csv(index=False).encode("utf-8"),
                       "lancamentos.csv", "text/csv")

# ================================================================ IMPOSTOS
with tab_imp:
    st.caption("Estimativas com as tabelas de 2026 (arquivo `impostos.py`). Confirme sempre com o seu contador.")
    t_clt, t_mei, t_me, t_cmp = st.tabs(["Salário CLT", "MEI", "ME — Simples (Anexo III / V)", "Comparativo"])

    with t_clt:
        a, b, c = st.columns(3)
        bruto = a.number_input("Salário bruto (R$)", 0.0, value=8000.0, step=100.0, key="clt_b")
        dep = b.number_input("Dependentes", 0, 10, 0)
        outros = c.number_input("Outros descontos (VT, plano...)", 0.0, value=0.0, step=50.0)
        r = imp.salario_clt(bruto, dep, outros)
        k = st.columns(4)
        k[0].metric("INSS", brl(r.inss))
        k[1].metric("IRRF", brl(r.irrf))
        k[2].metric("Líquido mensal", brl(r.liquido))
        k[3].metric("Carga (INSS+IR)", pct(r.aliquota_efetiva))
        fig = go.Figure(go.Waterfall(
            x=["Bruto", "INSS", "IRRF", "Outros", "Líquido"], measure=["absolute", "relative", "relative", "relative", "total"],
            y=[r.bruto, -r.inss, -r.irrf, -r.outros, 0], connector=dict(line=dict(color="#d8d6d0")),
            increasing=dict(marker_color=AZUL), decreasing=dict(marker_color=LARANJA), totals=dict(marker_color=VERDE),
            text=[brl(v) for v in [r.bruto, r.inss, r.irrf, r.outros, r.liquido]], textposition="outside"))
        fig.update_layout(showlegend=False, hovermode="closest")
        mostrar(estilo(fig, 300))
        st.caption(md(f"FGTS depositado pelo empregador (8%): {brl(r.fgts)}/mês · líquido anual com 13º e férias+1/3 ≈ {brl(r.anual_liquido)}"))

    with t_mei:
        a, b, c = st.columns(3)
        rm = a.number_input("Faturamento mensal (R$)", 0.0, value=6000.0, step=250.0, key="mei_r")
        ativ = b.selectbox("Atividade", ["servicos", "comercio", "ambos"],
                           format_func={"servicos": "Serviços", "comercio": "Comércio/Indústria", "ambos": "Comércio + Serviços"}.get)
        dm_ = c.number_input("Despesas do negócio (R$/mês)", 0.0, value=500.0, step=50.0, key="mei_d")
        m = imp.mei(rm, ativ, dm_)
        k = st.columns(4)
        k[0].metric("DAS-MEI mensal", brl(m.das))
        k[1].metric("Imposto sobre faturamento", pct(m.das / rm if rm else 0, 2))
        k[2].metric("Sobra no bolso", brl(m.liquido))
        k[3].metric("Limite mensal (R$ 81 mil/ano)", brl(m.limite_mensal))
        if m.dentro_do_limite:
            st.success("✔ Dentro do limite anual de R$ 81.000 do MEI.")
        else:
            st.error(md(f"✖ Faturamento anual projetado ({brl(rm * 12)}) excede o limite do MEI — desenquadramento para ME."))
        st.warning("Atenção: **engenharia civil e outras profissões regulamentadas (CREA) não podem ser MEI.** "
                   "Para projetos e gestão de obras, o caminho é ME (Simples).")

    with t_me:
        a, b, c, d_ = st.columns(4)
        rec_me = a.number_input("Faturamento mensal (R$)", 0.0, value=15_000.0, step=500.0, key="me_r")
        pl = b.number_input("Pró-labore mensal (R$)", 0.0, value=4_200.0, step=100.0)
        dp = c.number_input("Despesas da empresa (R$/mês)", 0.0, value=800.0, step=50.0, help="Contador, software, etc.")
        rbt = d_.number_input("RBT12 (últimos 12 meses)", 0.0, value=rec_me * 12, step=1000.0)
        me = imp.me_simples(rec_me, pl, dp, rbt12=rbt)
        k = st.columns(5)
        k[0].metric("Anexo aplicado", f"Anexo {me.anexo}", f"Fator R {pct(me.fator_r, 1)}", delta_color="off", delta_arrow="off")
        k[1].metric("Alíquota efetiva", pct(me.aliquota_efetiva, 2), f"nominal {pct(me.aliquota_nominal)}", delta_color="off", delta_arrow="off")
        k[2].metric("DAS do mês", brl(me.das))
        k[3].metric("Carga total", pct(me.carga_total), "DAS + INSS + IRRF", delta_color="off", delta_arrow="off")
        k[4].metric("Líquido no bolso", brl(me.liquido_no_bolso))
        det = pd.DataFrame({
            "Item": ["Faturamento", "DAS (Simples)", "Despesas da empresa", "Pró-labore bruto",
                     "  INSS do pró-labore (11%)", "  IRRF do pró-labore", "Lucro distribuível (isento)", "Líquido no bolso"],
            "Valor": [me.receita, -me.das, -me.despesas_empresa, me.pro_labore, -me.inss_pro_labore,
                      -me.irrf_pro_labore, me.lucro_distribuivel, me.liquido_no_bolso]})
        det["Valor"] = det["Valor"].map(brl)
        st.dataframe(det, hide_index=True, width="stretch")
        if me.fator_r < imp.FATOR_R_MINIMO:
            st.warning(md(f"Fator R de {pct(me.fator_r)} < 28%: tributação pelo **Anexo V**. Com pró-labore de "
                          f"**{brl(me.pro_labore_para_fator_r)}** a empresa passa ao Anexo III — veja o comparativo."))
        else:
            st.success(f"✔ Fator R ≥ 28%: tributação pelo Anexo III (alíquota inicial 6%).")
        if me.epp:
            st.info("RBT12 acima de R$ 360 mil: a empresa deixa de ser ME e passa a EPP (mesmas tabelas).")
        st.markdown('<span class="nota">Lucros distribuídos são isentos para a PF, mas a Lei 15.270/2025 retém 10% de IR '
                    'sobre o que passar de R$ 50 mil/mês pago por uma mesma empresa.</span>', unsafe_allow_html=True)

    with t_cmp:
        st.markdown("**Mesmo faturamento, três formatos** — quanto sobra no bolso?")
        a, b = st.columns(2)
        rec_c = a.number_input("Faturamento mensal (R$)", 0.0, value=6000.0, step=500.0, key="cmp_r")
        desp_c = b.number_input("Despesas do negócio (R$/mês)", 0.0, value=800.0, step=50.0, key="cmp_d")
        opcoes = []
        if rec_c * 12 <= imp.MEI_LIMITE_ANUAL:
            opcoes.append(("MEI*", imp.mei(rec_c, "servicos", desp_c).liquido, imp.mei(rec_c).das))
        me_min = imp.me_simples(rec_c, imp.SALARIO_MINIMO, desp_c)
        me_fr = imp.me_simples(rec_c, rec_c * imp.FATOR_R_MINIMO, desp_c)
        opcoes.append((f"ME · pró-labore mínimo (Anexo {me_min.anexo})", me_min.liquido_no_bolso,
                       me_min.das + me_min.inss_pro_labore + me_min.irrf_pro_labore))
        opcoes.append((f"ME · Fator R 28% (Anexo {me_fr.anexo})", me_fr.liquido_no_bolso,
                       me_fr.das + me_fr.inss_pro_labore + me_fr.irrf_pro_labore))
        nomes = [o[0] for o in opcoes]
        fig = go.Figure()
        fig.add_bar(x=nomes, y=[o[1] for o in opcoes], name="Sobra no bolso", marker_color=AZUL, marker_cornerradius=4,
                    text=[brl(o[1]) for o in opcoes], textposition="outside")
        fig.add_bar(x=nomes, y=[o[2] for o in opcoes], name="Impostos", marker_color=LARANJA, marker_cornerradius=4,
                    text=[brl(o[2]) for o in opcoes], textposition="outside")
        fig.update_layout(barmode="group", bargap=0.4)
        mostrar(estilo(fig, 340))
        st.caption("*MEI só aparece se o faturamento anual couber no limite — e **engenharia não é atividade permitida ao MEI**.")

# ============================================================ INVESTIMENTOS
with tab_inv:
    if "mercado" not in st.session_state:
        st.session_state.mercado = inv.ParametrosMercado()
    mk = st.session_state.mercado
    top = st.columns([1, 1, 1, 1.4])
    selic = top[0].number_input("Selic meta (% a.a.)", 0.0, 40.0, mk.selic * 100, 0.25) / 100
    cdi = top[1].number_input("CDI (% a.a.)", 0.0, 40.0, mk.cdi * 100, 0.05) / 100
    ipca = top[2].number_input("IPCA 12m (%)", 0.0, 30.0, mk.ipca * 100, 0.1) / 100
    if top[3].button("🔄 Buscar taxas no Banco Central"):
        novo = inv.buscar_taxas_bcb()
        if novo:
            st.session_state.mercado = novo
            st.rerun()
        else:
            st.warning("Não consegui acessar a API do BCB agora; ajuste as taxas manualmente.")
    m = inv.ParametrosMercado(selic, cdi, ipca)

    a, b, c, d_ = st.columns(4)
    ini_v = a.number_input("Valor inicial (R$)", 0.0, value=10_000.0, step=1000.0)
    aporte = b.number_input("Aporte mensal (R$)", 0.0, value=1_000.0, step=100.0)
    prazo = c.slider("Prazo (meses)", 6, 120, 36)
    pct_cdb = d_.slider("CDB (% do CDI)", 80, 130, 105)
    e, f_ = st.columns(2)
    pct_lci = e.slider("LCI/LCA (% do CDI)", 70, 110, 90)
    spread = f_.slider("Tesouro Selic — spread (% a.a.)", 0.0, 0.5, 0.05, 0.01)

    prods = [("CDB", pct_cdb / 100, AZUL), ("LCI/LCA", pct_lci / 100, VERDE),
             ("Tesouro Selic", spread / 100, LARANJA), ("Poupança", 0.0, CINZA)]
    fig = go.Figure()
    for nome, taxa, cor in prods:
        sim = inv.simular(nome, taxa, ini_v, aporte, prazo, m)
        fig.add_scatter(x=sim["mes"], y=sim["liquido"], name=nome, mode="lines", line=dict(color=cor, width=2))
    fig.add_scatter(x=sim["mes"], y=sim["investido"], name="Total investido", mode="lines",
                    line=dict(color="#0b0b0b", width=1.5, dash="dot"))
    fig.update_xaxes(title="meses")
    st.subheader("Saldo líquido (após IR) ao longo do tempo")
    mostrar(estilo(fig, 360))

    tabela = inv.comparar(ini_v, aporte, prazo, m, pct_cdb / 100, pct_lci / 100, spread / 100)
    tabela_fmt = tabela.copy()
    for col in ["Investido", "Saldo bruto", "IR", "Saldo líquido", "Ganho líquido"]:
        tabela_fmt[col] = tabela_fmt[col].map(brl)
    tabela_fmt["Ganho s/ investido"] = tabela["Ganho s/ investido"].map(lambda v: pct(v, 2))
    st.dataframe(tabela_fmt, hide_index=True, width="stretch")
    melhor = tabela.loc[tabela["Saldo líquido"].idxmax(), "Produto"]
    dias = prazo * 30
    eq = inv.equivalente_cdb(pct_lci / 100, dias)
    st.markdown(md(
        f"**Leitura do especialista:** no prazo de {prazo} meses o melhor líquido é **{melhor}**. "
        f"Alíquota de IR regressivo para {prazo} meses: **{pct(inv.aliquota_ir(dias), 1)}**. "
        f"Uma LCI/LCA a {pct_lci}% do CDI (isenta) equivale a um CDB de **{pct(eq, 1)} do CDI**. "
        f"Rendimento real (descontada a inflação) do CDB: **{pct(((1 + m.cdi * pct_cdb / 100) / (1 + m.ipca)) - 1, 2)} a.a.** antes do IR."))
    st.markdown('<span class="nota">Simplificações: CDI constante, 252 dias úteis/ano, 30 dias por mês, sem IOF '
                '(isento após 30 dias) e sem FGC. LCI/LCA e poupança isentas de IR para pessoa física.</span>',
                unsafe_allow_html=True)
