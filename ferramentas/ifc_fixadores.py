#!/usr/bin/env python3
"""Conta fixadores de um IFC por especificação, somando todos os locais.

Fixador não pertence a prédio: a mesma porca Ø1/2" usada na eclusa, na
portaria e no refeitório é uma linha só de estoque. Por isso a contagem é
feita por PEÇA (não por conjunto) e agrupada pelo PROFILE, que é onde está
a especificação ("PORCA Ø1/2", "ARRUELA Ø3/4").

Uso: python3 ferramentas/ifc_fixadores.py a.ifc [b.ifc ...] [--json saida.json]
"""
import json
import re
import sys
from collections import defaultdict

sys.path.insert(0, __file__.rsplit('/', 1)[0])
from ifc_quantitativo import campos, ler_entidades, refs, texto
from ifc_materiais_estoque import props_de

FIXADOR = ('PORCA', 'ARRUELA', 'PARAF', 'PARABOLT', 'CHUMBADOR', 'BARRA.ROSC',
           'BARRA ROSC', 'NUT', 'WASHER', 'BOLT', 'SCREW', 'REBITE', 'PINO')
PECAS = {'IFCBEAM', 'IFCMEMBER', 'IFCPLATE', 'IFCDISCRETEACCESSORY',
         'IFCMECHANICALFASTENER', 'IFCCOLUMN', 'IFCBUILDINGELEMENTPROXY'}


def eh_fixador(*textos):
    alvo = ' '.join(t for t in textos if t).upper()
    return any(x in alvo for x in FIXADOR)


def extrair(caminho):
    ents = ler_entidades(caminho)

    props = {}
    for eid, (tipo, args) in ents.items():
        if tipo == 'IFCPROPERTYSINGLEVALUE':
            n, v = props_de(args)
            if n is not None:
                props[eid] = (n, v)

    pset = {}
    for eid, (tipo, args) in ents.items():
        if tipo == 'IFCPROPERTYSET':
            d = {props[p][0]: props[p][1] for p in refs(campos(args)[-1]) if p in props}
            if d:
                pset[eid] = d

    liga = defaultdict(dict)
    for eid, (tipo, args) in ents.items():
        if tipo != 'IFCRELDEFINESBYPROPERTIES':
            continue
        c = campos(args)
        if len(c) < 6:
            continue
        r = refs(c[5])
        if r and r[0] in pset:
            for o in refs(c[4]):
                liga[o].update(pset[r[0]])

    por_spec = defaultdict(lambda: {'pecas': 0, 'peso': 0.0, 'produtos': set()})
    for eid, (tipo, args) in ents.items():
        if tipo not in PECAS:
            continue
        c = campos(args)
        nome = texto(c[2]) if len(c) > 2 else ''
        p = liga.get(eid, {})
        perfil = p.get('PROFILE') or ''
        if not eh_fixador(nome, str(perfil)):
            continue
        spec = str(perfil).strip() or (nome or '').strip()
        g = por_spec[spec]
        g['pecas'] += 1
        if isinstance(p.get('WEIGHT'), (int, float)):
            g['peso'] += p['WEIGHT']
        if nome:
            g['produtos'].add(nome)
    return por_spec


def main():
    arquivos = [a for a in sys.argv[1:] if a.endswith('.ifc')]
    geral = defaultdict(lambda: {'pecas': 0, 'peso': 0.0, 'produtos': set()})
    for f in arquivos:
        for spec, v in extrair(f).items():
            g = geral[spec]
            g['pecas'] += v['pecas']
            g['peso'] += v['peso']
            g['produtos'] |= v['produtos']

    linhas = [{'spec': s, 'pecas': v['pecas'], 'peso_total': round(v['peso'], 2),
               'peso_unitario': round(v['peso'] / v['pecas'], 4) if v['pecas'] else 0.0,
               'produtos': sorted(v['produtos'])}
              for s, v in sorted(geral.items(), key=lambda kv: -kv[1]['pecas'])]

    print('%-28s %8s %10s %s' % ('ESPECIFICAÇÃO', 'PEÇAS', 'PESO kg', 'PRODUTOS'))
    for l in linhas:
        print('%-28s %8d %10.2f %s' % (l['spec'][:28], l['pecas'], l['peso_total'], ', '.join(l['produtos'])[:38]))
    print('-' * 84)
    print('%-28s %8d %10.2f' % ('TOTAL', sum(l['pecas'] for l in linhas), sum(l['peso_total'] for l in linhas)))

    if '--json' in sys.argv:
        with open(sys.argv[sys.argv.index('--json') + 1], 'w', encoding='utf-8') as fh:
            json.dump(linhas, fh, ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
