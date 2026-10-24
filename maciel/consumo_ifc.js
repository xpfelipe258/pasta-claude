'use strict';
// Consumo virtual das obras novas. Não grava movimentos físicos e não altera o catálogo/BM.
// Apontamentos por GUID substituem a parcela estimada, sem somar a mesma produção duas vezes.
function consumoIdentidadeIfc(regras, decisoes, atividades, apontamentos, realizado, manuais = {}) {
  const mapa = new Map(), porAtividade = new Map();
  const add = (tag, qtd, local, estimado, detalhe) => {
    if (!tag || !(qtd >= 0) || !Number.isFinite(qtd)) return;
    const v = mapa.get(tag) || { cv: 0, origem: 'producao', estimado: false, parcial: false, partes: [], locais: {} };
    v.cv += qtd;
    v.locais[local] = (v.locais[local] || 0) + qtd;
    v.estimado ||= estimado && qtd > 0;
    if (!estimado && qtd > 0) v.origem = 'apontamento';
    if (qtd > 0) v.partes.push(`${local || '(local não informado)'}: ${qtd.toLocaleString('pt-BR', {maximumFractionDigits: 3})} · ${detalhe}`);
    mapa.set(tag, v);
  };
  const cat = new Map(atividades.map(a => [a.codigo, a]));
  Object.entries(regras.vinculos_ifc || {}).forEach(([key, g]) => {
    const d = decisoes[key], a = d?.estado === 'confirmado' ? cat.get(d.atividade) : null;
    // Mesmo sem produção/decisão, há consumo zero conhecido; nunca herdar consumo da planilha.
    Object.entries(g.pecas || {}).forEach(([, p]) => {
      add(p.tag, 0, g.local, false, '');
      Object.keys(p.kit || {}).forEach(tag => add(tag, 0, g.local, false, ''));
    });
    if (!a || !(Number(a.qtd) > 0)) return;
    if (!porAtividade.has(a.codigo)) porAtividade.set(a.codigo, { a, pecas: new Map() });
    const v = porAtividade.get(a.codigo);
    Object.entries(g.pecas || {}).forEach(([guid, p]) => v.pecas.set(guid, { ...p, local: g.local }));
  });
  Object.keys(manuais).forEach(cod => {
    if (cat.has(cod) && !porAtividade.has(cod)) porAtividade.set(cod, {a: cat.get(cod), pecas: new Map()});
  });
  porAtividade.forEach(({ a, pecas }) => {
    const manual = new Map();
    (manuais[a.codigo]?.linhas || []).forEach(l => [[l.tag,l.por_unidade],[l.arruela,l.arruela_qtd ?? l.por_unidade],[l.porca,l.porca_qtd ?? l.por_unidade]].forEach(([tag,q]) => {
      if (tag && Number(q) >= 0) manual.set(tag, (manual.get(tag)||0) + Number(q));
    }));
    const aps = new Map();
    apontamentos.forEach(p => {
      if (String(p.tipo).toUpperCase() === 'PECA' && p.eixo === a.codigo && p.empresa === a.empresa && Number(p.qtd) > 0 && pecas.has(p.letra)) aps.set(p.letra, p);
    });
    const credito = [...aps.values()].reduce((n, p) => n + Number(p.qtd), 0);
    const real = Math.max(0, Number(realizado(a)) || 0);
    const restante = Math.max(0, Number(a.qtd) - credito);
    const fracao = restante > 0 ? Math.min(1, Math.max(0, real - credito) / restante) : 0;
    pecas.forEach((p, guid) => {
      const exata = aps.has(guid), n = exata ? 1 : fracao;
      const rot = exata ? `peça apontada · ${a.codigo}` : `estimativa pelo catálogo · ${a.codigo}`;
      const conflito = (regras.tags_conflitantes || []).includes(p.tag);
      add(p.tag, conflito && !exata ? 0 : n, p.local, !exata, rot);
      if (conflito && mapa.has(p.tag)) {
        mapa.get(p.tag).parcial = true;
        mapa.get(p.tag).partes.push('TAG com especificações diferentes na fonte: consumo da peça somente por apontamento; conferir recebimentos por local/perfil');
      }
      Object.entries(p.kit || {}).forEach(([tag, q]) => { if (!manual.has(tag)) add(tag, n * q, p.local, !exata, rot); });
    });
    manual.forEach((por,tag) => add(tag, por*real, [...new Set([...pecas.values()].map(p=>p.local))].join(' / '), true, `regra cadastrada · ${a.codigo}`));
    // Não esconder lançamento menor que as peças já apontadas: exige conciliação da produção.
    if (credito > real + 1e-6) pecas.forEach(p => {
      [p.tag, ...Object.keys(p.kit || {})].forEach(tag => { if (mapa.has(tag)) mapa.get(tag).parcial = true; });
    });
  });
  mapa.forEach(v => {
    v.cv = Math.round(v.cv * 1e6) / 1e6;
    v.nota = [...new Set(v.partes)].join(' + ') + (v.estimado ? ' (produção sem identificação individual: distribuição estimada nos locais)' : '') + (v.parcial ? ' (conciliar quantidade produzida com peças apontadas)' : '');
    delete v.partes;
  });
  return mapa;
}

// A mesma apuração alimenta Baixa automática, Materiais e Inventário.
function renderBaixaIdentidadeIfc() {
  const reg = M.estoque_ifc.regras, consumo = consumoVirtualPorTag(reg);
  const mats = estMateriaisComCadastros(), receb = new Map(estRemessasComCadastros().itens.map(r => [r.tag, r.total_recebido || 0]));
  const pend = Object.keys(reg.vinculos_ifc).filter(k => M.vinculos_material?.[k]?.estado !== 'confirmado');
  const tiles = (nome, n) => `<div class="tile"><div class="rot">${esc(nome)}</div><div class="val">${nf(n)}</div></div>`;
  $('#estIfcNota').textContent = 'Produção na unidade do catálogo → vínculo de atividade e local → TAG original. Apontamentos identificam peças; produção sem peças identificadas gera consumo estimado.';
  $('#estIfcTiles').innerHTML = tiles('TAGs cadastradas', mats.length) + tiles('Grupos vinculados', Object.keys(reg.vinculos_ifc).length - pend.length) + tiles('Vínculos a conferir', pend.length);
  $('#estIfcResumo').textContent = 'Quantidades de projeto não são saldo recebido. A baixa é virtual e recalculada com os lançamentos; retiradas físicas continuam no Consumo físico.';
  $('#tabEstIfc').innerHTML = '<thead><tr><th>TAG original</th><th>Material</th><th>Projeto</th><th>Recebido</th><th>Consumo virtual</th><th>Saldo virtual</th><th>Origem / locais</th></tr></thead><tbody>' + mats.map(m => {
    const c=consumo.get(m.tag), rec=receb.get(m.tag)||0, n=c?.cv||0;
    return `<tr><td>${esc(m.tag)}</td><td>${esc(m.produto)}</td><td>${nf(m.planejado)}</td><td>${nf(rec)}</td><td>${nf(n,3)}${c?.estimado ? ' ≈' : ''}</td><td class="${rec-n<0 ? 'valor-neg' : ''}">${nf(rec-n,3)}</td><td>${esc(c?.nota || 'Sem produção vinculada')}</td></tr>`;
  }).join('')+'</tbody>';
  $('#tabEstIfcRuas').innerHTML = '<thead><tr><th>Local original</th><th>Produto</th><th>Peças previstas</th><th>Atividade do catálogo</th><th>Vínculo</th></tr></thead><tbody>' + Object.entries(reg.vinculos_ifc).map(([k,g]) => {
    const d=M.vinculos_material?.[k];
    return `<tr><td>${esc(g.local)}</td><td>${esc(g.produto)}</td><td>${nf(g.qtd)}</td><td>${esc(d?.atividade||'—')}</td><td>${esc(d?.estado||'pendente')}</td></tr>`;
  }).join('')+'</tbody>';
  $('#tabEstEventos').innerHTML = '<thead><tr><th>Data</th><th>Empresa</th><th>TAG</th><th>Local</th><th>Atividade</th><th>Quantidade do catálogo</th></tr></thead><tbody>' + (T.apontamentos||[]).filter(p=>p.tipo==='PECA').map(p=>`<tr><td>${fdA(p.data)}</td><td>${esc(p.empresa)}</td><td>${esc(p.viga_id)}</td><td>${esc(p.rua)}</td><td>${esc(p.eixo)}</td><td>${nf(p.qtd,3)}</td></tr>`).join('')+'</tbody>';
  $('#estIfcAlertas').innerHTML = (pend.length ? `<li class="alerta a-amarelo">${nf(pend.length)} grupo(s) aguardam conferência em Suprimentos › Vínculos. Esses grupos não geram baixa automática.</li>` : '') + ((reg.tags_conflitantes || []).length ? `<li class="alerta a-amarelo">TAGs com especificações distintas no IFC: ${esc(reg.tags_conflitantes.join(', '))}. Confira o local e o perfil. A baixa dessas peças exige apontamento individual.</li>` : '');
}
