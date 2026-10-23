"""Serviço de leitura de documentos da obra nova (separado do sistema em PHP).

O sistema PHP envia um pedido assinado (HMAC-SHA256 do corpo com o segredo compartilhado), o serviço baixa o arquivo por um
link assinado, valida/lê e devolve o resultado para o callback, também assinado.

  fase 1: POST /jobs/validar   validação profunda de cada documento enviado
  fase 2: POST /jobs/processar leitura completa da obra (lista de material, fixadores, BM, cronograma, pranchas, mapa) -> pacote JSON no callback

Variável de ambiente: SEGREDO_LEITURA (o mesmo valor de config.php → servico_leitura → segredo).
"""
import hashlib
import hmac
import json
import os
import shutil
import tempfile
import zipfile

import requests
from fastapi import BackgroundTasks, FastAPI, Request
from fastapi.responses import JSONResponse

import validadores

app = FastAPI(title="Serviço de leitura de obras", version="1.0")
TAMANHO_MAX = 600 * 1024 * 1024


def segredo():
    return os.environ.get("SEGREDO_LEITURA", "")


def assinar(corpo: bytes) -> str:
    return hmac.new(segredo().encode(), corpo, hashlib.sha256).hexdigest()


def assinatura_valida(corpo: bytes, recebida: str) -> bool:
    return bool(segredo()) and hmac.compare_digest(assinar(corpo), recebida or "")


@app.get("/saude")
def saude():
    return {"ok": True, "versao": app.version, "segredo_configurado": bool(segredo())}


def _baixar(url: str, destino: str, tamanho_esperado: int) -> str:
    h = hashlib.sha256()
    total = 0
    with requests.get(url, stream=True, timeout=(10, 120)) as r:
        r.raise_for_status()
        with open(destino, "wb") as f:
            for bloco in r.iter_content(1024 * 1024):
                total += len(bloco)
                if total > TAMANHO_MAX:
                    raise ValueError("arquivo maior que o limite do serviço")
                h.update(bloco)
                f.write(bloco)
    if tamanho_esperado and total != tamanho_esperado:
        raise ValueError("o arquivo baixado tem %d bytes; esperado %d" % (total, tamanho_esperado))
    return h.hexdigest()


def _responder(callback: str, resultado: dict):
    corpo = json.dumps(resultado, ensure_ascii=False).encode()
    requests.post(callback, data=corpo, timeout=30,
                  headers={"Content-Type": "application/json", "X-Assinatura": assinar(corpo)})


def _validar_documento(job: dict):
    resultado = {"documento_id": job["documento_id"], "ok": False, "resumo": {}, "avisos": [], "erros": []}
    caminho = None
    try:
        ext = os.path.splitext(job.get("nome", ""))[1].lower()[:8]   # o openpyxl e outros leem o formato pela extensão
        fd, caminho = tempfile.mkstemp(prefix="doc_", suffix=ext if ext.replace(".", "").isalnum() else ".bin")
        os.close(fd)
        sha = _baixar(job["url_download"], caminho, int(job.get("tamanho") or 0))
        if job.get("sha256") and sha != job["sha256"]:
            resultado["erros"].append("O arquivo recebido pelo serviço difere do enviado (checksum).")
        else:
            r = validadores.validar(job["tipo"], caminho, job.get("nome", ""))
            resultado.update({k: r[k] for k in ("ok", "resumo", "avisos", "erros")})
    except Exception as e:
        resultado["erros"].append("Falha ao baixar ou ler o documento (%s: %s)." % (type(e).__name__, e))
    finally:
        if caminho and os.path.exists(caminho):
            os.remove(caminho)
    try:
        _responder(job["callback"], resultado)
    except Exception as e:  # o PHP mostra "Validando…" até chegar; "Revalidar" refaz
        print("Falha ao responder o callback:", e)


@app.post("/jobs/validar")
async def jobs_validar(req: Request, tarefas: BackgroundTasks):
    corpo = await req.body()
    if not assinatura_valida(corpo, req.headers.get("X-Assinatura", "")):
        return JSONResponse({"erro": "Assinatura inválida."}, status_code=401)
    try:
        job = json.loads(corpo)
        for k in ("documento_id", "tipo", "url_download", "callback"):
            if k not in job:
                raise KeyError(k)
    except Exception:
        return JSONResponse({"erro": "Pedido inválido."}, status_code=400)
    tarefas.add_task(_validar_documento, job)
    return JSONResponse({"ok": True, "aceito": job["documento_id"]}, status_code=202)


def _processar_obra(job: dict):
    """Baixa todos os documentos da obra, monta o pacote e o devolve ao callback (assinado)."""
    from leitores import processar
    pasta = tempfile.mkdtemp(prefix="obra_")
    resultado = {"obra_id": job["obra_id"], "ok": False, "erros": [], "avisos": [], "pacote": None}
    try:
        docs = {}
        for d in job["documentos"]:
            ext = os.path.splitext(d.get("nome", ""))[1].lower()[:8]
            fd, caminho = tempfile.mkstemp(dir=pasta, suffix=ext if ext.replace(".", "").isalnum() else ".bin")
            os.close(fd)
            sha = _baixar(d["url_download"], caminho, int(d.get("tamanho") or 0))
            if d.get("sha256") and sha != d["sha256"]:
                raise ValueError("o arquivo %s recebido difere do enviado (checksum)" % d.get("nome"))
            if d["tipo"] == "ifc" and zipfile.is_zipfile(caminho):
                with zipfile.ZipFile(caminho) as z:
                    for n in z.namelist():
                        if n.lower().endswith(".ifc"):
                            alvo = os.path.join(pasta, "%d_%s" % (len(docs.get("ifc", [])), os.path.basename(n)))
                            with z.open(n) as o, open(alvo, "wb") as f:
                                shutil.copyfileobj(o, f)
                            docs.setdefault("ifc", []).append((os.path.basename(n), alvo))
                continue
            docs.setdefault(d["tipo"], []).append((d.get("nome", ""), caminho))
        pacote = processar.montar(docs, job.get("nome_obra", ""))
        resultado.update(ok=not pacote["erros"], erros=pacote["erros"], avisos=pacote["avisos"], pacote=pacote)
    except Exception as e:
        resultado["erros"].append("Falha na leitura completa (%s: %s)." % (type(e).__name__, e))
    finally:
        shutil.rmtree(pasta, ignore_errors=True)
    try:
        _responder(job["callback"], resultado)
    except Exception as e:
        print("Falha ao responder o callback:", e)


@app.post("/jobs/processar")
async def jobs_processar(req: Request, tarefas: BackgroundTasks):
    corpo = await req.body()
    if not assinatura_valida(corpo, req.headers.get("X-Assinatura", "")):
        return JSONResponse({"erro": "Assinatura inválida."}, status_code=401)
    try:
        job = json.loads(corpo)
        for k in ("obra_id", "documentos", "callback"):
            if k not in job:
                raise KeyError(k)
    except Exception:
        return JSONResponse({"erro": "Pedido inválido."}, status_code=400)
    tarefas.add_task(_processar_obra, job)
    return JSONResponse({"ok": True, "aceito": job["obra_id"]}, status_code=202)
