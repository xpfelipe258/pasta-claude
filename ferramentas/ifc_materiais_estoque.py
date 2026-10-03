#!/usr/bin/env python3
"""Gera o quantitativo de materiais de um IFC na estrutura da tabela de estoque.

Usa as marcas do próprio modelo (ASSEMBLY MARK) como tag, e lê PROFILE,
MATERIAL, WEIGHT e LENGTH de cada conjunto. Agrupa conjuntos iguais e
devolve uma linha por marca, com os mesmos campos de `materiais` em
estoque_inicial.json.

Uso: python3 ferramentas/ifc_materiais_estoque.py a.ifc [b.ifc ...] --etapa "Anexos / X" --json saida.json
"""
import json
import re
import sys
from collections import defaultdict

sys.path.insert(0, __file__.rsplit('/', 1)[0])
from ifc_quantitativo import campos, ler_entidades, limpa, numero, refs, texto
from ifc_quantitativo_bm import fase_para_item_bm

FIXADORES = ('PORCA', 'ARRUELA', 'PARAFUSO', 'CHUMBADOR', 'BARRA ROSCADA',
              'PARABOLT', 'PINO', 'REBITE', 'REBITES', 'BUCHA')

# O PHASE.NAME diz a que prédio a peça pertence. Um mesmo IFC pode conter
# mais de um: o modelo da portaria traz também a eclusa.
LOCAIS = [
    ('ECLUSA', 'Eclusa'),
    ('PORTARIA', 'Portaria'),
    ('VESTI', 'Vestiário'),
    ('REFEIT', 'Refeitório'),
    ('PASSAREL', 'Passarelas'),
    ('VIV', 'Área de Vivência'),
    ('QDF', 'QDF CAG'),
    ('MARQUISE', 'Marquise'),
    ('GALP', 'Galpão'),
]


def local_de(fases, padrao='Anexos'):
    achados = {nome for f in fases for chave, nome in LOCAIS if chave in f.upper()}
    if len(achados) == 1:
        return achados.pop()
    if achados:
        return ' + '.join(sorted(achados))
    return padrao

# O Tekla acrescenta "(?)" à marca quando o conjunto tem marcação ambígua.
AMBIGUA = re.compile(r"\(\?\)\s*$")
TEXTO_IFC = re.compile(r"IFC[A-Z]+\('(.*)'\)\s*$", re.S)
NUM_IFC = re.compile(r"IFC[A-Z]+\(([-0-9.E+]+)\)\s*$")


def props_de(args):
    """Nome e valor de um IFCPROPERTYSINGLEVALUE.

    O valor vem embrulhado no tipo IFC (IFCLABEL, IFCMASSMEASURE, ...). Textos
    podem conter parênteses, então são lidos até a aspa final, não até o
    primeiro ")".
    """
    c = campos(args)
    nome = texto(c[0]) if c else None
    if not nome or len(c) < 3:
        return None, None
    bruto = c[2].strip()
    m = TEXTO_IFC.match(bruto)
    if m:
        return nome, limpa(m.group(1))
    m = NUM_IFC.match(bruto)
    if m:
        return nome, numero(m.group(1))
    return nome, None


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
            d = {}
            for p in refs(campos(args)[-1]):
                if p in props:
                    d[props[p][0]] = props[p][1]
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

    # WEIGHT, PROFILE e LENGTH ficam nas peças; a marca fica no conjunto.
    # IFCRELAGGREGATES liga um ao outro.
    partes = defaultdict(list)
    for eid, (tipo, args) in ents.items():
        if tipo != 'IFCRELAGGREGATES':
            continue
        c = campos(args)
        if len(c) < 6:
            continue
        pai = refs(c[4])
        if pai:
            partes[pai[0]].extend(refs(c[5]))

    grupos = defaultdict(lambda: {'pecas': 0, 'peso': [], 'comp': [],
                                  'perfil': set(), 'material': set(), 'fase': set()})
    for eid, (tipo, args) in ents.items():
        if tipo != 'IFCELEMENTASSEMBLY':
            continue
        c = campos(args)
        nome = texto(c[2]) if len(c) > 2 else None
        p = dict(liga.get(eid, {}))
        # herda das peças o que o conjunto não traz
        peso_conj, comp_conj = 0.0, []
        for parte in partes.get(eid, []):
            pp = liga.get(parte, {})
            if isinstance(pp.get('WEIGHT'), (int, float)):
                peso_conj += pp['WEIGHT']
            if isinstance(pp.get('LENGTH'), (int, float)):
                comp_conj.append(pp['LENGTH'])
            for chave in ('PROFILE', 'MATERIAL'):
                if pp.get(chave) and not p.get(chave):
                    p[chave] = pp[chave]
        if peso_conj and not isinstance(p.get('WEIGHT'), (int, float)):
            p['WEIGHT'] = peso_conj
        if comp_conj and not isinstance(p.get('LENGTH'), (int, float)):
            p['LENGTH'] = max(comp_conj)
        marca = p.get('ASSEMBLY MARK') or p.get('PART MARK')
        if not (nome and marca):
            continue
        marca = str(marca)
        ambigua = bool(AMBIGUA.search(marca))
        marca = AMBIGUA.sub('', marca).strip()
        # agrupa por local: a mesma marca em prédios diferentes vira linhas
        # diferentes, para o estoque poder ser lido por local.
        fase_peca = p.get('PHASE.NAME')
        onde = local_de([str(fase_peca)] if fase_peca else [], '')
        g = grupos[(marca, nome, onde)]
        g['ambigua'] = g.get('ambigua') or ambigua
        g['pecas'] += 1
        for chave, destino in (('WEIGHT', 'peso'), ('LENGTH', 'comp')):
            v = p.get(chave)
            if isinstance(v, (int, float)):
                g[destino].append(v)
        for chave, destino in (('PROFILE', 'perfil'), ('MATERIAL', 'material')):
            if p.get(chave):
                g[destino].add(str(p[chave]))
        if p.get('PHASE.NAME'):
            g['fase'].add(str(p['PHASE.NAME']))
    return grupos


def main():
    arquivos = [a for a in sys.argv[1:] if a.endswith('.ifc')]
    etapa = sys.argv[sys.argv.index('--etapa') + 1] if '--etapa' in sys.argv else ''
    # quando a fase diz só "ANEXOS", sem nomear o prédio, vale o local do modelo
    padrao = sys.argv[sys.argv.index('--local') + 1] if '--local' in sys.argv else ''

    geral = defaultdict(lambda: {'pecas': 0, 'peso': [], 'comp': [],
                                 'perfil': set(), 'material': set(), 'fase': set()})
    for f in arquivos:
        for k, v in extrair(f).items():
            g = geral[k]
            g['pecas'] += v['pecas']
            g['peso'] += v['peso']
            g['comp'] += v['comp']
            for c in ('perfil', 'material', 'fase'):
                g[c] |= v[c]

    linhas = []
    for (marca, nome, onde), g in sorted(geral.items(), key=lambda kv: (kv[0][2], -kv[1]['pecas'])):
        pu = round(sum(g['peso']) / len(g['peso']), 2) if g['peso'] else 0.0
        cm = round(sum(g['comp']) / len(g['comp']), 1) if g['comp'] else 0.0
        perfil = ' / '.join(sorted(g['perfil'])) or ' / '.join(sorted(g['material']))
        # fixador se o produto OU o perfil indicar (ex.: produto "NUT", perfil "PORCA Ø3/4")
        up = (nome + ' ' + perfil).upper()
        item_bm = sorted({fase_para_item_bm(f)[0] for f in g['fase'] if fase_para_item_bm(f)[0]})
        linhas.append({
            'tag': marca,
            'peso_unitario': pu,
            'peso_total': round(pu * g['pecas'], 2),
            'comp_mm': cm,
            'material': perfil,
            'produto': nome,
            'planejado': float(g['pecas']),
            'chegou': 0.0,
            'necessario_real': float(g['pecas']),
            'falta_enviar': float(g['pecas']),
            'consumido': 0.0,
            'estoque_pos_baixa': 0.0,
            'atendimento': 0.0,
            'status_logistico': 'Pendente',
            'tipo_material': 'FIXADOR' if any(x in up for x in FIXADORES) else 'ESTRUTURAL',
            'prioridade': 'P2',
            'etapa': etapa,
            'local': onde or padrao or local_de(g['fase'], etapa),
            'item_bm': ', '.join(item_bm),
            'origem': 'IFC',
            'marca_ambigua': bool(g.get('ambigua')),
        })

    print('%-14s %-28s %-18s %7s %9s %11s %s' % ('TAG', 'PRODUTO', 'PERFIL', 'PEÇAS', 'PESO un', 'PESO tot', 'BM'))
    for l in linhas[:40]:
        print('%-14s %-28s %-18s %7.0f %9.2f %11.1f %s'
              % (l['tag'][:14], l['produto'][:28], l['material'][:18], l['planejado'],
                 l['peso_unitario'], l['peso_total'], l['item_bm']))
    print('... %d marcas, %d peças, %.1f kg'
          % (len(linhas), sum(l['planejado'] for l in linhas), sum(l['peso_total'] for l in linhas)))

    if '--json' in sys.argv:
        with open(sys.argv[sys.argv.index('--json') + 1], 'w', encoding='utf-8') as fh:
            json.dump(linhas, fh, ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
