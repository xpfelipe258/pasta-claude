import datetime
import re


def texto(v):
    return "" if v is None else str(v).replace("\xa0", " ").strip()


def numero(v):
    """Número vindo de célula: aceita int/float e texto pt-BR ('1.234,5'); devolve None se não for número."""
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace("\xa0", "").replace("R$", "").replace("%", "").strip()
    if not s or not re.match(r"^-?[\d.,\s]+$", s):
        return None
    s = s.replace(" ", "")
    if "," in s:
        s = s.replace(".", "").replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def data_iso(v):
    if isinstance(v, datetime.datetime):
        return v.date().isoformat()
    if isinstance(v, datetime.date):
        return v.isoformat()
    s = texto(v)
    m = re.match(r"^(\d{2})/(\d{2})/(\d{2,4})$", s)
    if m:
        a = int(m.group(3))
        a += 2000 if a < 100 else 0
        try:
            return datetime.date(a, int(m.group(2)), int(m.group(1))).isoformat()
        except ValueError:
            return None
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", s)
    return s[:10] if m else None


def unidade(v):
    s = texto(v).lower().replace("m2", "m²").replace("m3", "m³")
    return {"und": "un", "unid": "un", "unidade": "un", "unidades": "un", "pç": "un", "pc": "un", "peça": "un"}.get(s, s)
