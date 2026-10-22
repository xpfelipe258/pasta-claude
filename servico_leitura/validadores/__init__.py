"""Validação profunda dos documentos da obra nova.

Cada validador recebe o caminho do arquivo e devolve:
    {"ok": bool, "resumo": {...}, "avisos": [...], "erros": [...]}
`ok` é falso quando há qualquer erro. Avisos não bloqueiam: pedem atenção na revisão.
"""
import os

from . import cronograma, fixadores, ifc, orcamento, projetos
from ._base import fechar, novo

_POR_TIPO = {
    "ifc": ifc.validar,
    "fixadores": fixadores.validar,
    "cronograma": cronograma.validar,
    "orcamento": orcamento.validar,
    "projetos": projetos.validar,
}


def validar(tipo, caminho, nome_original):
    """Roda o validador do tipo; qualquer exceção vira erro (o arquivo não pôde ser lido)."""
    ext = os.path.splitext(nome_original or "")[1].lower().lstrip(".")
    if tipo not in _POR_TIPO:
        r = novo()
        r["erros"].append("Tipo de documento desconhecido: %s." % tipo)
        return fechar(r)
    try:
        return _POR_TIPO[tipo](caminho, ext)
    except Exception as e:  # arquivo corrompido, formato inesperado…
        r = novo()
        r["erros"].append("Não foi possível ler o arquivo (%s: %s)." % (type(e).__name__, e))
        return fechar(r)
