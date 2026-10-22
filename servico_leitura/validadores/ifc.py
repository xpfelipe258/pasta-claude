"""IFC (Tekla): esquema, conjuntos, código de posição, eixos e fases — lendo o texto em blocos, sem carregar o modelo na memória."""
import collections
import re
import zipfile

from ._base import fechar, novo

_TIPO = re.compile(rb"^#\d+\s*=\s*(IFC[A-Z0-9]+)", re.M)
_FASE = re.compile(rb"IFCPROPERTYSINGLEVALUE\('PHASE\.NAME',\$?,?\s*IFC\w+\('([^']*)'\)", re.I)
_PECAS = {"IFCBEAM", "IFCCOLUMN", "IFCMEMBER", "IFCPLATE", "IFCFOOTING", "IFCSLAB", "IFCBUILDINGELEMENTPROXY", "IFCSTAIR", "IFCRAMP"}


def _abrir(caminho, ext):
    if ext == "zip" or zipfile.is_zipfile(caminho):
        z = zipfile.ZipFile(caminho)
        for n in z.namelist():
            if n.lower().endswith(".ifc"):
                return z.open(n), n
        raise ValueError("o .zip não contém nenhum .ifc")
    return open(caminho, "rb"), None


def validar(caminho, ext):
    r = novo()
    f, dentro = _abrir(caminho, ext)
    with f:
        ini = f.read(65536)
        if b"ISO-10303-21" not in ini:
            r["erros"].append("O arquivo não é um IFC (falta o cabeçalho ISO-10303-21).")
            return fechar(r)
        m = re.search(rb"FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'", ini)
        esquema = m.group(1).decode() if m else ""
        if not esquema.upper().startswith("IFC"):
            r["erros"].append("IFC sem esquema reconhecido (FILE_SCHEMA).")
            return fechar(r)
        cab = ini.decode("latin-1", "replace")
        tekla = "tekla" in cab.lower()
        bolts = re.search(r"Option \[Bolts:(On|Off)\]", cab, re.I)
        tipos = collections.Counter()
        posicao = 0
        fases = set()
        resto = b""
        bloco = ini
        while bloco:
            dado = resto + bloco
            corte = dado.rfind(b"\n")
            if corte < 0:
                resto, bloco = dado, f.read(4 * 1024 * 1024)
                continue
            texto, resto = dado[: corte + 1], dado[corte + 1:]
            tipos.update(t.decode() for t in _TIPO.findall(texto))
            posicao += texto.count(b"'Assembly/Cast unit position code'")
            for fa in _FASE.findall(texto):
                fases.add(fa.decode("latin-1"))
            bloco = f.read(4 * 1024 * 1024)
        if resto:
            tipos.update(t.decode() for t in _TIPO.findall(resto))
    conjuntos = tipos.get("IFCELEMENTASSEMBLY", 0)
    pecas = sum(n for t, n in tipos.items() if t in _PECAS)
    eixos = tipos.get("IFCGRIDAXIS", 0)
    r["resumo"] = {
        "arquivo": dentro or "", "esquema": esquema, "sistema_tekla": tekla, "conjuntos": conjuntos, "pecas": pecas,
        "eixos_da_malha": eixos, "codigos_de_posicao": posicao, "fases": len(fases), "parafusos_no_modelo": (bolts.group(1).lower() == "on") if bolts else None,
    }
    if conjuntos == 0 and pecas == 0:
        r["erros"].append("O modelo não tem conjuntos nem peças (IFCELEMENTASSEMBLY/IFCBEAM…): exporte do Tekla com Assemblies.")
    if not tekla:
        r["avisos"].append("O modelo não parece ter sido exportado do Tekla; a leitura pode não reconhecer as propriedades.")
    if conjuntos and posicao == 0:
        r["avisos"].append("Sem o código de posição das peças (Assembly/Cast unit position code): o mapa de apontamento será gerado pela geometria, com menos precisão.")
    if eixos == 0:
        r["avisos"].append("O modelo não traz a malha de eixos (IFCGRID): sem ela os eixos/ruas do mapa serão deduzidos.")
    if not fases:
        r["avisos"].append("Nenhuma fase (PHASE.NAME) encontrada: a divisão por fase/edificação será pedida na revisão.")
    if bolts and bolts.group(1).lower() == "off":
        r["avisos"].append("Este IFC não traz parafusos (Bolts:Off); eles vêm do documento de fixadores.")
    return fechar(r)
