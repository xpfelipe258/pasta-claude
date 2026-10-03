#!/usr/bin/env python3
"""Integra os materiais extraídos dos IFC dos anexos em estoque_inicial.json.

Preserva remessas, inventário e consumo físico: só acrescenta linhas em
`materiais`, mantendo todos os campos da tabela.

Regras de tag:
- marcas "nd.."/"ND.." são o "não definido" do Tekla, não marcas reais;
  ganham tag derivada do produto, no padrão de prefixo já usado no estoque.
- marcas reais que se repetem entre prédios ganham sufixo do prédio, para
  não colidir (a tag é usada como chave nos ajustes de inventário).
"""
import json
import re
import sys
from collections import defaultdict

PREFIXO = {
    'ARRUELA': 'ARR', 'PORCA': 'PR', 'TELHA COBERTURA': 'TLH', 'TELHA_COB': 'TLH',
    'TELHA PLATIBANDA INT': 'TLP', 'BOCAL DE CALHA': 'BCL', 'CALHA': 'CA',
    'CALHA ECLUSA': 'CAE', 'RUFO': 'RF', 'RUFO CADEIRA': 'RDC', 'RUFO CHAPÉU': 'RCH',
    'PARAFUSO': 'PAR', 'CHUMBADOR': 'CBB', 'BARRA ROSCADA': 'BRR', 'GROUT': 'GRP',
    'CHAPA': 'CH', 'CANTONEIRA': 'CA', 'MONTANTE': 'MT', 'SUPORTE': 'SP',
}
SIGLA = {'Anexos / Portaria e Eclusa': 'PE', 'Anexos / Vestiário': 'VT',
         'Anexos / Refeitório': 'RF'}
NAO_DEF = re.compile(r'^nd\d*$', re.I)


def sigla(etapa):
    return SIGLA.get(etapa, re.sub(r'[^A-Z]', '', etapa.upper())[:2] or 'AX')


def prefixo_de(produto):
    up = produto.upper().strip()
    if up in PREFIXO:
        return PREFIXO[up]
    for chave, pre in PREFIXO.items():
        if chave in up:
            return pre
    return re.sub(r'[^A-Z]', '', up)[:3] or 'MAT'


def main():
    est_cam = 'maciel/inc/estoque_inicial.json'
    est = json.load(open(est_cam, encoding='utf-8'))
    usadas = {m['tag'] for m in est['materiais']}

    # Os materiais que já existiam são todos do galpão; recebem o local para
    # a tabela poder ser lida e filtrada por prédio.
    FIX = ('PORCA', 'ARRUELA', 'PARAFUSO', 'PARABOLT', 'CHUMBADOR',
           'BARRA ROSCADA', 'PINO', 'REBITE', 'BUCHA', 'NUT', 'WASHER')
    for m in est['materiais']:
        m.setdefault('local', 'Galpão')
        texto = ((m.get('produto') or '') + ' ' + (m.get('material') or '')).upper()
        if any(x in texto for x in FIX):
            m['tipo_material'] = 'FIXADOR'
        elif not m.get('tipo_material'):
            m['tipo_material'] = 'ESTRUTURAL'

    novos = []
    for f in sys.argv[1:]:
        if f.endswith('.json'):
            novos += json.load(open(f, encoding='utf-8'))

    # quais marcas reais aparecem em mais de um prédio
    por_marca = defaultdict(set)
    for n in novos:
        if not NAO_DEF.match(n['tag']):
            por_marca[n['tag']].add(n['etapa'])
    repetidas = {t for t, e in por_marca.items() if len(e) > 1}

    seq = defaultdict(int)
    for n in novos:
        if NAO_DEF.match(n['tag']):
            pre = prefixo_de(n['produto'])
            seq[pre] += 1
            tag = '%s%03d' % (pre, 300 + seq[pre])
            n['tag_modelo'] = n['tag']
        elif n['tag'] in repetidas:
            tag = '%s-%s' % (n['tag'], sigla(n['etapa']))
            n['tag_modelo'] = n['tag']
        else:
            tag = n['tag']
        while tag in usadas:
            seq[tag] += 1
            tag = '%s_%d' % (tag.split('_')[0], seq[tag])
        n['tag'] = tag
        usadas.add(tag)

    est['materiais'].extend(novos)
    est['fonte'] = est.get('fonte', '') + ' + IFC anexos'
    json.dump(est, open(est_cam, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

    print('materiais: %d -> %d  (+%d dos anexos)'
          % (len(est['materiais']) - len(novos), len(est['materiais']), len(novos)))
    print('remessas preservadas: %d itens' % len(est['remessas']['itens']))
    print('inventário preservado: %d linhas' % len(est['inventario']))
    print('tags duplicadas no resultado: %d'
          % (len(est['materiais']) - len({m['tag'] for m in est['materiais']})))


if __name__ == '__main__':
    main()
