#!/usr/bin/env python3
"""Extrai o quantitativo de um IFC (STEP) exportado com BaseQuantities.

Liga cada elemento ao seu IfcElementQuantity via IfcRelDefinesByProperties e
soma peças, comprimento, área e peso por tipo e família.

Comprimentos vêm em milímetros (IFCSIUNIT .LENGTHUNIT. .MILLI.) e são
convertidos para metro. Área já vem em m², massa em kg.

Uso: python3 ferramentas/ifc_quantitativo.py arquivo.ifc [--json saida.json]
"""
import json
import re
import sys
from collections import defaultdict

ENTIDADE = re.compile(r"#(\d+)\s*=\s*([A-Z0-9_]+)\s*\((.*)\)\s*;\s*$", re.S)

ELEMENTOS = {
    'IFCBEAM', 'IFCCOLUMN', 'IFCMEMBER', 'IFCPLATE', 'IFCSLAB', 'IFCWALL',
    'IFCWALLSTANDARDCASE', 'IFCDISCRETEACCESSORY', 'IFCMECHANICALFASTENER',
    'IFCBUILDINGELEMENTPROXY', 'IFCCOVERING', 'IFCRAILING', 'IFCSTAIR',
    'IFCSTAIRFLIGHT', 'IFCROOF', 'IFCFOOTING',
}

# Tekla grava acento como \S\<letra>, que é a letra com o bit alto ligado (latin-1).
ACENTO = re.compile(r"\\S\\(.)")


def limpa(txt):
    txt = ACENTO.sub(lambda m: bytes([ord(m.group(1)) | 0x80]).decode('latin-1'), txt)
    return txt.replace("\\X\\", '').replace("''", "'").strip()


def ler_entidades(caminho):
    ents, buf, dentro = {}, '', False
    with open(caminho, 'r', encoding='latin-1') as fh:
        for linha in fh:
            s = linha.strip()
            if not dentro:
                if s == 'DATA;':
                    dentro = True
                continue
            if not buf and not s.startswith('#'):
                continue
            buf += s
            if not buf.endswith(';'):
                continue
            m = ENTIDADE.match(buf)
            if m:
                ents[int(m.group(1))] = (m.group(2), m.group(3))
            buf = ''
    return ents


def campos(texto):
    out, nivel, atual, aspas, i = [], 0, '', False, 0
    while i < len(texto):
        c = texto[i]
        if aspas:
            atual += c
            if c == "'":
                if i + 1 < len(texto) and texto[i + 1] == "'":
                    atual += texto[i + 1]
                    i += 1
                else:
                    aspas = False
        elif c == "'":
            aspas, atual = True, atual + c
        elif c in '([':
            nivel, atual = nivel + 1, atual + c
        elif c in ')]':
            nivel, atual = nivel - 1, atual + c
        elif c == ',' and nivel == 0:
            out.append(atual.strip())
            atual = ''
        else:
            atual += c
        i += 1
    out.append(atual.strip())
    return out


def texto(v):
    v = (v or '').strip()
    return limpa(v[1:-1]) if v.startswith("'") and v.endswith("'") else None


def numero(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def refs(v):
    return [int(x) for x in re.findall(r'#(\d+)', v or '')]


def extrair(caminho):
    ents = ler_entidades(caminho)

    qtd = {}
    for eid, (tipo, args) in ents.items():
        if not tipo.startswith('IFCQUANTITY'):
            continue
        c = campos(args)
        nome = texto(c[0]) if c else None
        val = next((numero(x) for x in reversed(c) if numero(x) is not None), None)
        if nome and val is not None:
            qtd[eid] = (nome, val)

    conj = {eid: [qtd[q] for q in refs(campos(args)[-1]) if q in qtd]
            for eid, (tipo, args) in ents.items() if tipo == 'IFCELEMENTQUANTITY'}

    liga = defaultdict(list)
    for eid, (tipo, args) in ents.items():
        if tipo != 'IFCRELDEFINESBYPROPERTIES':
            continue
        c = campos(args)
        if len(c) < 6:
            continue
        rel = refs(c[5])
        if rel and rel[0] in conj:
            for o in refs(c[4]):
                liga[o].extend(conj[rel[0]])

    resumo = defaultdict(lambda: defaultdict(float))
    for eid, (tipo, args) in ents.items():
        if tipo not in ELEMENTOS:
            continue
        c = campos(args)
        nome = texto(c[2]) if len(c) > 2 else None
        r = resumo[(tipo.replace('IFC', ''), nome or 'SEM NOME')]
        r['pecas'] += 1
        for qnome, qval in liga.get(eid, []):
            if qnome == 'Length':
                r['compr_m'] += qval / 1000.0
            elif qnome in ('GrossArea', 'NetArea'):
                r['area_m2'] += qval
            elif qnome == 'OuterSurfaceArea':
                r['sup_m2'] += qval
            elif qnome in ('NetWeight', 'GrossWeight'):
                r['peso_kg'] += qval
    return resumo


def main():
    caminho = sys.argv[1]
    resumo = extrair(caminho)
    linhas = sorted(resumo.items(), key=lambda kv: -kv[1]['pecas'])
    print('%-22s %-30s %6s %10s %10s %11s' % ('TIPO', 'FAMÍLIA', 'PEÇAS', 'COMPR m', 'ÁREA m²', 'PESO kg'))
    tot = defaultdict(float)
    for (tipo, nome), v in linhas:
        print('%-22s %-30s %6d %10.1f %10.1f %11.1f'
              % (tipo, nome[:30], v['pecas'], v['compr_m'], v['area_m2'], v['peso_kg']))
        for k, x in v.items():
            tot[k] += x
    print('-' * 95)
    print('%-53s %6d %10.1f %10.1f %11.1f'
          % ('TOTAL', tot['pecas'], tot['compr_m'], tot['area_m2'], tot['peso_kg']))

    if '--json' in sys.argv:
        saida = sys.argv[sys.argv.index('--json') + 1]
        with open(saida, 'w', encoding='utf-8') as fh:
            json.dump({'fonte': caminho,
                       'itens': [{'tipo': t, 'familia': n, **{k: round(x, 2) for k, x in v.items()}}
                                 for (t, n), v in linhas]},
                      fh, ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
