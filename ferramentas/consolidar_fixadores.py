#!/usr/bin/env python3
"""Consolida os fixadores do estoque em uma linha por especificação.

Fixador não pertence a prédio: a mesma porca Ø1/2" usada no galpão, na
eclusa e no refeitório é uma linha só, com a soma de todos os usos. As
linhas por local que vieram dos modelos IFC são substituídas pela contagem
por peça de ferramentas/ifc_fixadores.py.

Também cria a entrada em `remessas` para todo material que ainda não tem,
com as mesmas colunas de remessa já existentes e quantidade zero — o item
aparece na tabela aguardando entrega.
"""
import json
import re
import sys

# produtos genéricos: a especificação está no campo material, não no produto
GENERICOS = {'CHUMBADOR', 'PORCA', 'ARRUELA', 'NUT', 'WASHER', 'BARRA ROSCADA',
             'CONTRAVENTAMENTO', 'PARAFUSO'}
LOCAL_FIX = 'Todos os locais'


def spec_de(produto, material):
    """A especificação do fixador.

    Quando o produto é genérico ("PORCA", "CHUMBADOR"), a especificação está
    no material ("PORCA Ø1/2", "BARRA.RED.19"). Quando o produto já traz a
    bitola ("PARAF. Ø3/8 X 1"), o material é a classe do aço (A307, GR.8) e
    faz parte da identidade: parafuso da mesma medida em classes diferentes
    são itens diferentes e não podem virar uma linha só.
    """
    p = (produto or '').strip()
    m = (material or '').strip()
    if p.upper() in GENERICOS and m:
        return m
    return (p + ' | ' + m).strip(' |') if m and m != '-' else p


def chave(spec):
    s = (spec or '').upper()
    s = s.replace('Ø', '').replace('"', '').replace("'", '')
    return re.sub(r'[^A-Z0-9/.|]+', ' ', s).strip()


def main():
    cam = 'maciel/inc/estoque_inicial.json'
    est = json.load(open(cam, encoding='utf-8'))
    fix_ifc = json.load(open(sys.argv[1], encoding='utf-8'))

    mats = est['materiais']
    # 1) fora as linhas de fixador que vieram agrupadas por conjunto do IFC
    antes = len(mats)
    mats = [m for m in mats if not (m.get('tipo_material') == 'FIXADOR' and m.get('origem') == 'IFC')]
    removidas = antes - len(mats)

    # 2) índice dos fixadores que restaram (os do galpão, vindos da planilha)
    indice, fundidas = {}, []
    restantes = []
    for m in mats:
        if m.get('tipo_material') != 'FIXADOR':
            restantes.append(m)
            continue
        k = chave(spec_de(m.get('produto'), m.get('material')))
        alvo = indice.get(k)
        if alvo is None:
            indice[k] = m
            restantes.append(m)
            continue
        # mesma especificação já presente: soma e descarta a linha repetida
        for campo in ('planejado', 'chegou', 'consumido', 'necessario_real', 'peso_total'):
            alvo[campo] = (alvo.get(campo) or 0) + (m.get(campo) or 0)
        fundidas.append((m['tag'], alvo['tag'], k))
    mats = restantes

    # O IFC não grava a classe do aço, só a bitola. Então um "PORCA Ø1/2" do
    # modelo deve cair na linha de porca Ø1/2" que já existe (seja A307 ou
    # outra), em vez de abrir uma linha paralela. Daí o índice por bitola.
    por_bitola = {}
    for k, m in indice.items():
        b = k.split('|')[0].strip()
        por_bitola.setdefault(b, []).append(m)

    somados, criados, ambiguos = [], [], []
    for f in fix_ifc:
        k = chave(f['spec'])
        alvo = indice.get(k)
        if alvo is None:
            cand = por_bitola.get(k.split('|')[0].strip(), [])
            if len(cand) == 1:
                alvo = cand[0]
            elif len(cand) > 1:
                ambiguos.append((f['spec'], [c['tag'] for c in cand]))
        if alvo:
            alvo['planejado'] = (alvo.get('planejado') or 0) + f['pecas']
            alvo['necessario_real'] = (alvo.get('necessario_real') or 0) + f['pecas']
            alvo['falta_enviar'] = (alvo.get('planejado') or 0) - (alvo.get('chegou') or 0)
            if alvo.get('planejado'):
                alvo['atendimento'] = (alvo.get('chegou') or 0) / alvo['planejado']
            alvo['local'] = LOCAL_FIX
            somados.append((alvo['tag'], f['spec'], f['pecas'], alvo['planejado']))
        else:
            tag = 'FX%03d' % (300 + len(criados) + 1)
            usadas = {m['tag'] for m in mats}
            while tag in usadas:
                tag = 'FX%03d' % (300 + len(criados) + 1 + len(usadas))
            novo = {
                'tag': tag, 'peso_unitario': f['peso_unitario'],
                'peso_total': f['peso_total'], 'comp_mm': 0.0,
                'material': f['spec'], 'produto': (f['produtos'] or [f['spec']])[0],
                'planejado': float(f['pecas']), 'chegou': 0.0,
                'necessario_real': float(f['pecas']), 'falta_enviar': float(f['pecas']),
                'consumido': 0.0, 'estoque_pos_baixa': 0.0, 'atendimento': 0.0,
                'status_logistico': 'Pendente', 'tipo_material': 'FIXADOR',
                'prioridade': 'P2', 'etapa': 'Fixação', 'local': LOCAL_FIX,
                'origem': 'IFC',
            }
            mats.append(novo)
            criados.append((tag, f['spec'], f['pecas']))

    # todo fixador deixa de ter prédio
    for m in mats:
        if m.get('tipo_material') == 'FIXADOR':
            m['local'] = LOCAL_FIX
    est['materiais'] = mats

    # 3) remessas: cria a linha de quem ainda não tem, com quantidade zero
    rem = est['remessas']
    ja = {i.get('tag') for i in rem['itens']}
    novos_rem = 0
    for m in mats:
        if m['tag'] in ja:
            continue
        rem['itens'].append({
            'material': m.get('material', ''), 'produto': m.get('produto', ''),
            'tag': m['tag'], 'etapa': m.get('etapa', ''),
            'qtd_por_remessa': {}, 'total_recebido': 0.0,
        })
        ja.add(m['tag'])
        novos_rem += 1

    json.dump(est, open(cam, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

    print('linhas de fixador por conjunto removidas: %d' % removidas)
    if fundidas:
        print('\nlinhas de fixador repetidas, fundidas:')
        for de, para, k in fundidas:
            print('   %-8s -> %-8s  (%s)' % (de, para, k[:40]))
    print('\nfixadores somados a uma linha existente:')
    for t, s, q, tot in somados:
        print('   %-8s %-22s +%5d  -> planejado %g' % (t, s[:22], q, tot))
    if ambiguos:
        print('\nbitola com mais de uma classe no estoque (não fundi, decida qual):')
        for sp, tags in ambiguos:
            print('   %-22s candidatos: %s' % (sp[:22], ', '.join(tags)))
    print('\nfixadores novos (não existiam no galpão):')
    for t, s, q in criados:
        print('   %-8s %-22s %6d' % (t, s[:22], q))
    fx = [m for m in mats if m.get('tipo_material') == 'FIXADOR']
    print('\nmateriais: %d   fixadores: %d linhas' % (len(mats), len(fx)))
    print('remessas: %d itens (+%d novos)' % (len(rem['itens']), novos_rem))


if __name__ == '__main__':
    main()
