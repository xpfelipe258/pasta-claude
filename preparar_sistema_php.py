"""Prepara a pasta sistema_php: copia a interface do programa local e gera os dados iniciais da planilha.

Uso: python preparar_sistema_php.py [planilha.xlsm]
"""
import datetime as dt
import json
import os
import shutil
import sys
import tempfile

RAIZ = os.path.dirname(os.path.abspath(__file__))
PROG = os.path.join(RAIZ, "programa_obra198")
PHP = os.path.join(RAIZ, "sistema_php")
sys.path.insert(0, PROG)
os.environ["OBRA198_SEM_ATUALIZAR"] = "1"

import excel_io as xio  # noqa: E402


def copiar_interface():
    est = os.path.join(PROG, "static")
    for nome in ("app.js", "style.css", "chart.umd.js"):
        shutil.copy2(os.path.join(est, nome), os.path.join(PHP, nome))
    shutil.copy2(os.path.join(est, "index.html"), os.path.join(PHP, "inc", "painel.html"))
    # regras e dados que a API PHP serve do mesmo jeito que o programa local
    for origem, destino in ((os.path.join(PROG, "regras_baixa.json"), "regras_baixa.json"),
                            (os.path.join(RAIZ, "dados", "ifc_r0d_inventario.json"), "ifc_inventario.json"),
                            (os.path.join(RAIZ, "dados", "estoque_obra198.json"), "estoque_inicial.json")):
        if os.path.exists(origem):
            shutil.copy2(origem, os.path.join(PHP, "inc", destino))


def gerar_dados_iniciais(planilha):
    with tempfile.TemporaryDirectory() as tmp:
        copia = os.path.join(tmp, "planilha.xlsm")
        shutil.copy2(planilha, copia)
        sys.argv = ["app.py", copia]
        import app
        app.CFG = app.carregar_config()
        est = next((os.path.join(RAIZ, f) for f in sorted(os.listdir(RAIZ))
                    if f.lower().endswith((".xlsm", ".xlsx")) and xio.eh_planilha_estoque(os.path.join(RAIZ, f))), "")
        app.CFG["planilha_estoque"] = est
        xio.garantir_abas(copia)
        xio.semear_catalogo_bm(copia)
        app.acao_importar_equip({})
        m = app.modelo()
    pacote = {
        "formato": "obra198", "versao_formato": 1,
        "gerado_em": dt.datetime.now().isoformat(timespec="seconds"),
        "origem": os.path.basename(planilha),
        "obra": {"nome": "OBRA 198", "data_inicio": m["datas"][0], "data_fim": m["datas"][-1]},
        "modelo": {k: v for k, v in m.items() if k != "linhas_por_data"},
    }
    destino = os.path.join(PHP, "inc", "dados_iniciais.json")
    with open(destino, "w", encoding="utf-8") as f:
        json.dump(pacote, f, ensure_ascii=False, default=str)
    return destino, m


if __name__ == "__main__":
    planilha = sys.argv[1] if len(sys.argv) > 1 else os.path.join(RAIZ, "PLANO_DE_PRODUCAO_198_POR_EMPRESA_V3.xlsm")
    copiar_interface()
    destino, m = gerar_dados_iniciais(planilha)
    print("Interface copiada para sistema_php/")
    print(f"Dados iniciais: {destino} ({len(m['metas'])} metas, {len(m['tabelas']['usos'])} usos de equipamento)")
