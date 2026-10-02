#!/usr/bin/env python3
"""Soma o quantitativo do IFC agrupado pelo item de medição (BM).

Os modelos da obra 198 gravam em cada elemento a propriedade PHASE.NAME com
o código do item, no formato "1.x.y DESCRIÇÃO". Esse código corresponde ao
item do BM trocando o "1" inicial por "3" (1.4.2 -> 3.4.2).

Uso: python3 ferramentas/ifc_quantitativo_bm.py a.ifc [b.ifc ...] [--json saida.json]
"""
import json
import re
import sys
from collections import defaultdict

sys.path.insert(0, __file__.rsplit('/', 1)[0])
from ifc_quantitativo import ELEMENTOS, campos, ler_entidades, limpa, numero, refs, texto

CODIGO = re.compile(r'^(\d+\.\d+\.\d+)\.?\s*(.*)$')


def fase_para_item_bm(fase):
    """"1.4.2 TELHA COB. X" -> ("3.4.2", "TELHA COB. X")."""
    m = CODIGO.match(fase.strip())
    if not m:
        return None, fase
    cod, desc = m.group(1), m.group(2)
    partes = cod.split('.')
    if partes[0] == '1':
        partes[0] = '3'
    return '.'.join(partes), desc


def analisar(caminho):
    ents = ler_entidades(caminho)

    qtd = {}
    fases = {}
    for eid, (tipo, args) in ents.items():
        if tipo.startswith('IFCQUANTITY'):
            c = campos(args)
            nome = texto(c[0]) if c else None
            val = next((numero(x) for x in reversed(c) if numero(x) is not None), None)
            if nome and val is not None:
                qtd[eid] = (nome, val)
        elif tipo == 'IFCPROPERTYSINGLEVALUE':
            c = campos(args)
            if c and texto(c[0]) == 'PHASE.NAME' and len(c) > 2:
                v = re.search(r"\('([^']*)'\)", c[2])
                if v:
                    fases[eid] = limpa(v.group(1))

    conj, pset = {}, {}
    for eid, (tipo, args) in ents.items():
        if tipo == 'IFCELEMENTQUANTITY':
            conj[eid] = [qtd[q] for q in refs(campos(args)[-1]) if q in qtd]
        elif tipo == 'IFCPROPERTYSET':
            achou = [fases[p] for p in refs(campos(args)[-1]) if p in fases]
            if achou:
                pset[eid] = achou[0]

    liga_q, liga_f = defaultdict(list), {}
    for eid, (tipo, args) in ents.items():
        if tipo != 'IFCRELDEFINESBYPROPERTIES':
            continue
        c = campos(args)
        if len(c) < 6:
            continue
        alvo = refs(c[5])
        if not alvo:
            continue
        a = alvo[0]
        for o in refs(c[4]):
            if a in conj:
                liga_q[o].extend(conj[a])
            if a in pset:
                liga_f[o] = pset[a]

    saida = defaultdict(lambda: defaultdict(lambda: defaultdict(float)))
    for eid, (tipo, args) in ents.items():
        if tipo not in ELEMENTOS:
            continue
        c = campos(args)
        nome = (texto(c[2]) if len(c) > 2 else None) or 'SEM NOME'
        fase = liga_f.get(eid)
        if not fase:
            continue
        item, _ = fase_para_item_bm(fase)
        r = saida[(item, fase)][nome]
        r['pecas'] += 1
        for qn, qv in liga_q.get(eid, []):
            if qn == 'Length':
                r['compr_m'] += qv / 1000.0
            elif qn in ('GrossArea', 'NetArea'):
                r['area_m2'] += qv
            elif qn in ('NetWeight', 'GrossWeight'):
                r['peso_kg'] += qv
    return saida


def main():
    arquivos = [a for a in sys.argv[1:] if a.endswith('.ifc')]
    geral = defaultdict(lambda: defaultdict(lambda: defaultdict(float)))
    for f in arquivos:
        for chave, fams in analisar(f).items():
            for nome, v in fams.items():
                for k, x in v.items():
                    geral[chave][nome][k] += x

    registro = []
    for (item, fase), fams in sorted(geral.items(), key=lambda kv: kv[0][0] or 'zz'):
        tot = defaultdict(float)
        for v in fams.values():
            for k, x in v.items():
                tot[k] += x
        print('\n=== BM %s  |  %s' % (item or '(sem código)', fase))
        print('    %-32s %6s %10s %10s %11s' % ('família', 'peças', 'compr m', 'área m²', 'peso kg'))
        for nome, v in sorted(fams.items(), key=lambda kv: -kv[1]['pecas']):
            print('    %-32s %6d %10.1f %10.1f %11.1f'
                  % (nome[:32], v['pecas'], v['compr_m'], v['area_m2'], v['peso_kg']))
            registro.append({'item_bm': item, 'fase': fase, 'familia': nome,
                             **{k: round(x, 2) for k, x in v.items()}})
        print('    %-32s %6d %10.1f %10.1f %11.1f'
              % ('TOTAL', tot['pecas'], tot['compr_m'], tot['area_m2'], tot['peso_kg']))

    if '--json' in sys.argv:
        with open(sys.argv[sys.argv.index('--json') + 1], 'w', encoding='utf-8') as fh:
            json.dump({'fontes': arquivos, 'itens': registro}, fh, ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
