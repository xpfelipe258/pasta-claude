'use strict';
// ------------------------------------------------------------------------------------------------
// RELATÓRIOS DE SUPRIMENTOS — botões "Relatório executivo" (1 página, gargalos) e "Relatório geral" (completo), abas Materiais, Remessas, Consumo físico e Inventário.
// Uma visão logística completa, até a data de referência:
//  1. Resumo executivo e pontos de atenção
//  2. Remessas: datas prevista × NF × chegada na obra, com FARÓIS de prazo (no prazo / atraso leve / atrasada / a chegar / vencida)
//  3. Logística: trânsito NF → obra, peso recebido, pontualidade por mês, curva de recebimento e programação do que falta chegar
//  4. Planejado × chegou × falta chegar (por etapa, produto, local e item a item, em quantidade e peso)
//  5. Acuracidade dos itens (inventário: consumo virtual × físico, perda real)
//  6. Maior uso de itens (consumo por peso e por quantidade)
//  7. Capacidade (quantas unidades de produção o saldo de cada item sustenta) e cobertura de estoque em semanas
//  8. Impactos causados pelo setor de Suprimentos (impactos lançados + remessas em atraso)
// Depende de app.js (estoque, regras de baixa, impactos), rel_empresa.js (reAbrirPrevia) e template_doc.js.
// ------------------------------------------------------------------------------------------------

// Critérios dos faróis (dias corridos de diferença entre a data prevista e a chegada na obra)
const RS_ATRASO_LEVE = 3;      // 1 a 3 dias de atraso = amarelo; acima disso = vermelho
const RS_JANELA_PROXIMA = 3;   // a chegar em até 3 dias da referência = "chega em breve"
const RS_CAP_ATENCAO = 25;     // capacidade (unidades de produção) até 25 = atenção, igual à tela de Materiais críticos

const rsNorm = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
const rsPct = (v, d = 1) => (v == null || !Number.isFinite(v) ? '—' : nf(v * 100, d) + '%');
const rsT = kg => (kg == null || !Number.isFinite(kg) ? '—' : nf(kg / 1000, 1) + ' t');

// Datas digitadas à mão ("27/07/2026", "15/07/2026 (OE-02) e 17/07/2026 (OE-04)", "2026-07-27"): devolve todas em ISO, em ordem
function rsDatas(txt) {
  const t = String(txt == null ? '' : txt), out = [];
  for (const m of t.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g)) { const iso = `${m[3]}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`; if (ehISO(iso) && !isNaN(dU(iso))) out.push(iso); }
  for (const m of t.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) { const iso = m[0]; if (!isNaN(dU(iso))) out.push(iso); }
  return [...new Set(out)].sort();
}

// ---------------------------------------------------------------- remessas
function rsRemessas(refDia) {
  const rem = estRemessasComCadastros(), fix = remTagsFixador();
  const mats = new Map(estMateriaisComCadastros().map(m => [matChaveTag(m.tag), m]));
  const cols = rem.colunas && rem.colunas.length ? rem.colunas : Object.keys(rem.datas || {});
  return cols.map((nome, ordem) => {
    const dt = (rem.datas || {})[nome] || {};
    const dPrev = rsDatas(dt.prevista_chegada), dCh = rsDatas(dt.chegada_obra), dNf = rsDatas(dt.emissao_nota);
    const prev = dPrev.length ? dPrev[dPrev.length - 1] : null, ch = dCh.length ? dCh[dCh.length - 1] : null, nfd = dNf.length ? dNf[dNf.length - 1] : null;
    const itens = (rem.itens || []).map(i => {
      const q = Number((i.qtd_por_remessa || {})[nome] || 0);
      if (!(q > 0)) return null;
      const m = mats.get(matChaveTag(i.tag)), pu = m && Number(m.peso_unitario) > 0 ? Number(m.peso_unitario) : null;
      return { tag: i.tag, material: i.material || i.produto || i.tag, produto: i.produto || '', etapa: i.etapa || '', qtd: q, kg: pu ? q * pu : null };
    }).filter(Boolean);
    const qtd = soma0(itens, x => x.qtd), kg = soma0(itens, x => x.kg), comPeso = itens.filter(x => x.kg != null).length;
    const porProd = new Map(); itens.forEach(x => { const k = x.produto || x.material; porProd.set(k, (porProd.get(k) || 0) + x.qtd); });
    const principais = [...porProd.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${nf(v)}`);
    // atraso (+) ou antecipação (−) em dias corridos e úteis
    let status, rotulo, atraso = null, atrasoUteis = null, aCh = null;
    if (ch) {
      if (prev) {
        atraso = diasEntre(prev, ch); atrasoUteis = atraso > 0 ? contarDiasUteis(prev, ch) : 0;
        if (atraso <= 0) { status = 'vd'; rotulo = atraso < 0 ? `ANTECIPADA ${-atraso} d` : 'NO PRAZO'; }
        else if (atraso <= RS_ATRASO_LEVE) { status = 'am'; rotulo = `ATRASO LEVE ${atraso} d`; }
        else { status = 'vm'; rotulo = `ATRASADA ${atraso} d`; }
      } else { status = 'nd'; rotulo = 'CHEGOU · SEM PREVISÃO'; }
    } else if (prev) {
      aCh = diasEntre(refDia, prev);   // > 0 faltam dias; < 0 vencida
      if (aCh < 0) { status = 'vm'; rotulo = `VENCIDA HÁ ${-aCh} d`; atraso = -aCh; atrasoUteis = contarDiasUteis(prev, refDia); }
      else if (aCh <= RS_JANELA_PROXIMA) { status = 'az'; rotulo = aCh === 0 ? 'CHEGA HOJE' : `CHEGA EM ${aCh} d`; }
      else { status = 'az'; rotulo = `A CHEGAR · ${aCh} d`; }
    } else { status = 'nd'; rotulo = itens.length || nfd ? 'SEM DATA PREVISTA' : 'SEM DATAS'; }
    const transito = ch && nfd ? diasEntre(nfd, ch) : null;
    const tipo = remTipoDe(rem, nome, fix);
    const num = (String(nome).match(/^\s*(\d+)/) || [])[1];
    return { nome, ordem, num: num ? Number(num) : null, tipo, prev, ch, nf: nfd, compostaPrev: dPrev.length > 1, compostaCh: dCh.length > 1, prevTxt: dt.prevista_chegada || '', chTxt: dt.chegada_obra || '',
      itens, nItens: itens.length, qtd, kg: comPeso ? kg : null, pesoParcial: comPeso > 0 && comPeso < itens.length, principais,
      status, rotulo, atraso, atrasoUteis, aCh, transito, chegou: !!ch };
  });
}

// ---------------------------------------------------------------- itens: planejado × chegou × falta, consumo, acuracidade, capacidade
function rsItens(regras) {
  const rem = estRemessasComCadastros(), recebido = new Map(rem.itens.map(r => [matChaveTag(r.tag), Number(r.total_recebido) || 0]));
  const fix = remTagsFixador();
  let cv = new Map(); try { cv = consumoVirtualPorTag(regras); } catch (e) { console.error('RS consumo virtual', e); }
  let inv = []; try { inv = inventarioCalculado(regras); } catch (e) { console.error('RS inventário', e); }
  const invMap = new Map(inv.map(i => [matChaveTag(i.tag), i]));
  const cf = estConsumoComCadastros(), fisMap = new Map((cf.itens || []).map(c => [matChaveTag(c.tag), c]));
  return estMateriaisComCadastros().map(m => {
    const k = matChaveTag(m.tag), plan = Number(m.planejado) || 0;
    const chegou = recebido.has(k) ? recebido.get(k) : (Number(m.chegou) || 0);
    const falta = Math.max(0, plan - chegou), exc = Math.max(0, chegou - plan);
    const pu = Number(m.peso_unitario) > 0 ? Number(m.peso_unitario) : null;
    const iv = invMap.get(k), fis = fisMap.get(k);
    const consVirtual = cv.has(m.tag) ? Number(cv.get(m.tag).cv) || 0 : (iv ? Number(iv.consumo_virtual) || 0 : Number(m.consumido) || 0);
    const consFisico = fis ? Number(fis.total_consumo) || 0 : (iv ? Number(iv.consumo_fisico) || 0 : 0);
    const consumo = consFisico > 0 ? consFisico : consVirtual;
    let st = 'SEM PLANEJADO';
    if (plan > 0) st = chegou >= plan - 1e-9 ? 'COMPLETO' : chegou > 0 ? 'PARCIAL' : 'NÃO CHEGOU';
    const fixador = fix.has(m.tag) || /FIXADOR/i.test(m.tipo_material || '');
    return { tag: m.tag, material: m.material || '', produto: m.produto || m.material || '', etapa: m.etapa || '—', local: m.local || '—', tipo: fixador ? 'FIXADOR' : 'ESTRUTURA',
      plan, chegou, falta, exc, pct: plan > 0 ? chegou / plan : null, st, pu,
      kgPlan: pu ? plan * pu : null, kgChegou: pu ? chegou * pu : null, kgFalta: pu ? falta * pu : null,
      consVirtual, consFisico, consumo, kgCons: pu ? consumo * pu : null,
      saldo: iv ? Number(iv.estoque_virtual_atual) || 0 : chegou - consVirtual,
      saldoFisico: iv ? Number(iv.estoque_fisico) || 0 : chegou - consFisico,
      inv: iv || null, statusLog: m.status_logistico || '', prioridade: m.prioridade || '' };
  });
}

function rsCapacidade(regras, itens) {
  const inv = new Map(itens.map(i => [matChaveTag(i.tag), i]));
  const servs = [];
  const fontes = regras.consumo_por_servico || {};
  Object.entries(fontes).forEach(([nome, def]) => {
    if (nome.startsWith('_') || /^PREMONTAGEM_J\d+$/.test(nome) || !def || !Array.isArray(def.itens) || !def.itens.length) return;   // J01–J04 repetem a composição da PREMONTAGEM
    const linhas = def.itens.map(it => {
      const pu = Number(it.por_unidade) || 0, x = inv.get(matChaveTag(it.codigo));
      const saldoV = x ? Math.max(0, x.saldo) : 0;
      const ult = x && x.inv && typeof ultimoInventarioFisicoItem === 'function' ? ultimoInventarioFisicoItem(x.inv) : null;
      const saldoR = ult ? ult.valor : (x ? Math.max(0, x.saldoFisico) : 0);
      const capV = pu > 0 ? Math.floor(saldoV / pu) : null, capR = pu > 0 ? Math.floor(Math.max(0, saldoR) / pu) : null;
      const cap = pu > 0 ? Math.min(capV, capR) : null;
      let nivel = 'verde', status = 'OK';
      if (pu <= 0) { nivel = 'nd'; status = 'SEM REGRA'; }
      else if (cap <= 0 || saldoR < pu || saldoV < pu) { nivel = 'vm'; status = 'CRÍTICO'; }
      else if (cap <= RS_CAP_ATENCAO) { nivel = 'am'; status = 'ATENÇÃO'; }
      else nivel = 'vd';
      return { codigo: it.codigo, descricao: it.descricao || (x && x.material) || '', pu, saldoV, saldoR, capV, capR, cap, nivel, status, inventarioFisico: !!ult, consumo: x ? x.consumo : 0 };
    }).sort((a, b) => (a.cap == null) - (b.cap == null) || (a.cap - b.cap) || String(a.codigo).localeCompare(String(b.codigo)));
    const regrasOk = linhas.filter(l => l.pu > 0);
    const gargalo = regrasOk[0] || null;
    servs.push({ nome, descricao: def.descricao || '', linhas, gargalo, possivel: gargalo ? gargalo.cap : null, criticos: linhas.filter(l => l.nivel === 'vm').length, atencao: linhas.filter(l => l.nivel === 'am').length });
  });
  return servs;
}

// Cobertura de estoque: saldo ÷ consumo médio por semana (retirada física lançada no Consumo físico, ou consumo virtual quando não há retirada)
function rsCobertura(itens, refDia) {
  const cf = estConsumoComCadastros(), datas = consSemanasDatas(cf);
  const sems = (cf.semanas || []).filter(s => { const d = datas.get(s); return !d || d.data <= refDia; });
  const primeira = [...datas.values()].map(d => d.data).filter(Boolean).sort()[0] || (M.datas && M.datas[0]) || refDia;
  const semanasPeriodo = Math.max(1, sems.length, Math.round(diasEntre(primeira, refDia) / 7) || 1);
  return itens.filter(i => i.consumo > 0 && i.plan > 0).map(i => {
    const porSem = i.consumo / semanasPeriodo, saldo = Math.max(0, i.consFisico > 0 ? i.saldoFisico : i.saldo);
    const cob = porSem > 0 ? saldo / porSem : null;
    return { ...i, porSem, saldoCob: saldo, cob, cobDias: cob == null ? null : cob * 7 };
  }).sort((a, b) => (a.cob == null) - (b.cob == null) || a.cob - b.cob);
}

// ---------------------------------------------------------------- SVG
function rsSvgAtrasos(rems) {
  const lista = rems.filter(r => r.atraso != null && (r.chegou || r.status === 'vm')).slice(0, 60);
  if (!lista.length) return '<p class="nota">Sem remessas com data prevista e chegada para desenhar.</p>';
  const W = 1040, H = 230, ml = 46, mb = 54, mt = 14, n = lista.length, bw = Math.max(8, Math.min(30, (W - ml - 10) / n - 4));
  const max = Math.max(5, ...lista.map(r => Math.abs(r.atraso))), min = Math.min(0, ...lista.map(r => r.atraso));
  const h0 = H - mb - mt, esc2 = h0 / (max - min), y0 = mt + max * esc2;
  const cor = s => ({ vd: '#16a34a', am: '#d99a00', vm: '#dc2626', az: '#2563eb', nd: '#94a3b8' })[s] || '#94a3b8';
  let g = '';
  for (let v = Math.ceil(min / 5) * 5; v <= max; v += 5) g += `<line x1="${ml}" x2="${W - 6}" y1="${y0 - v * esc2}" y2="${y0 - v * esc2}" stroke="#e5eaf0"/><text x="${ml - 5}" y="${y0 - v * esc2 + 3}" font-size="9" text-anchor="end" fill="#51606f">${v}</text>`;
  g += `<line x1="${ml}" x2="${W - 6}" y1="${y0}" y2="${y0}" stroke="#51606f"/>`;
  lista.forEach((r, k) => {
    const x = ml + 6 + k * ((W - ml - 14) / n), h = Math.abs(r.atraso) * esc2, y = r.atraso >= 0 ? y0 - h : y0;
    g += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw}" height="${Math.max(1, h).toFixed(1)}" fill="${cor(r.status)}" rx="2"><title>${esc(r.nome)}: ${esc(r.rotulo)}</title></rect>`;
    const rot = (r.num != null ? r.num : k + 1) + (r.chegou ? '' : '*');
    g += `<text x="${(x + bw / 2).toFixed(1)}" y="${H - mb + 14}" font-size="9" text-anchor="middle" fill="#14202b">${esc(rot)}</text>`;
  });
  g += `<text x="${ml}" y="${H - 8}" font-size="9" fill="#51606f">Dias de atraso (+) ou antecipação (−) em relação à data prevista · número = nº da remessa · * = ainda não chegou (atraso até a data de referência)</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Atraso por remessa">${g}</svg>`;
}
function rsSvgCurva(rems, kgPlan, tPlan) {
  const pts = rems.filter(r => r.ch && r.kg != null).sort((a, b) => a.ch.localeCompare(b.ch));
  if (pts.length < 2) return '<p class="nota">Sem remessas com peso e data de chegada suficientes para a curva de recebimento.</p>';
  const W = 1040, H = 250, ml = 56, mb = 40, mt = 16, d0 = pts[0].ch, d1 = pts[pts.length - 1].ch;
  const span = Math.max(1, diasEntre(d0, d1)), maxKg = Math.max(kgPlan || 0, soma0(pts, p => p.kg)) || 1;
  const X = d => ml + diasEntre(d0, d) / span * (W - ml - 16), Y = kg => mt + (1 - kg / maxKg) * (H - mt - mb);
  let acc = 0, d = `M${X(d0).toFixed(1)},${Y(0).toFixed(1)}`;
  pts.forEach(p => { acc += p.kg; d += ` L${X(p.ch).toFixed(1)},${Y(acc).toFixed(1)}`; });
  let g = '';
  for (let k = 0; k <= 4; k++) { const v = maxKg * k / 4; g += `<line x1="${ml}" x2="${W - 10}" y1="${Y(v)}" y2="${Y(v)}" stroke="#e5eaf0"/><text x="${ml - 6}" y="${Y(v) + 3}" font-size="9" text-anchor="end" fill="#51606f">${nf(v / 1000, 0)} t</text>`; }
  if (kgPlan) g += `<line x1="${ml}" x2="${W - 10}" y1="${Y(kgPlan)}" y2="${Y(kgPlan)}" stroke="#dc2626" stroke-dasharray="6 4"/><text x="${W - 12}" y="${Y(kgPlan) - 4}" font-size="10" text-anchor="end" fill="#dc2626">planejado ${nf(kgPlan / 1000, 0)} t</text>`;
  g += `<path d="${d}" fill="none" stroke="#2563eb" stroke-width="2.2"/>`;
  acc = 0; pts.forEach(p => { acc += p.kg; g += `<circle cx="${X(p.ch).toFixed(1)}" cy="${Y(acc).toFixed(1)}" r="3.2" fill="#2563eb"><title>${esc(p.nome)} · ${fdA(p.ch)} · ${nf(acc / 1000, 1)} t acumuladas</title></circle>`; });
  const meses = new Set(); pts.forEach(p => meses.add(p.ch.slice(0, 7)));
  [...meses].forEach(mm => { const dd = mm + '-01'; const x = X(dd < d0 ? d0 : dd); g += `<text x="${x.toFixed(1)}" y="${H - 20}" font-size="9" text-anchor="middle" fill="#51606f">${mm.slice(5)}/${mm.slice(0, 4)}</text>`; });
  g += `<text x="${ml}" y="${H - 4}" font-size="9" fill="#51606f">Peso acumulado recebido na obra (t) ao longo do tempo — somente remessas com peso cadastrado (${nf(pts.length)} remessas)</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Curva de recebimento">${g}</svg>`;
}

// ---------------------------------------------------------------- HTML
const RS_CSS = `<style>
.fr{display:inline-block;padding:2px 8px;border-radius:10px;font-size:9.5px;font-weight:700;color:#fff;white-space:nowrap}
.fr.vd{background:#16a34a}.fr.am{background:#c98a00}.fr.vm{background:#dc2626}.fr.az{background:#2563eb}.fr.nd{background:#7b8794}
.rs-leg{display:flex;flex-wrap:wrap;gap:8px 14px;margin:6px 0 4px;font-size:10.5px}
.rs-barra{background:#e5eaf0;border-radius:3px;height:8px;min-width:70px}.rs-barra i{display:block;height:8px;border-radius:3px;background:#2563eb}
.rs-barra i.vd{background:#16a34a}.rs-barra i.am{background:#d99a00}.rs-barra i.vm{background:#dc2626}
.rs-aten li{margin:3px 0}.rs-aten{padding-left:20px}
td.c,th.c{text-align:center}
table.rs-rem{font-size:10.5px}table.rs-rem td .nota{font-size:9.5px}
</style>`;
const rsFr = (cls, txt) => `<span class="fr ${cls}">${esc(txt)}</span>`;
const rsTabela = (cab, linhas, vazio = 'Sem dados.') => `<table><thead><tr>${cab.map(c => `<th${/^\s*[#>]?\s*n:/.test(c) ? ' class="n"' : ''}>${esc(String(c).replace(/^\s*[#>]?\s*n:/, ''))}</th>`).join('')}</tr></thead><tbody>${linhas.length ? linhas.join('') : `<tr><td colspan="${cab.length}" class="vazio">${vazio}</td></tr>`}</tbody></table>`;
function rsTry(nome, fn) { try { return fn(); } catch (e) { console.error('Relatório de Suprimentos — ' + nome, e); return `<p class="aviso">Esta parte não pôde ser montada (${esc(nome)}): ${esc(e && e.message || e)}</p>`; } }
const rsBarraPct = (p, cls) => `<div class="rs-barra"><i class="${cls || ''}" style="width:${Math.max(0, Math.min(100, (p || 0) * 100)).toFixed(0)}%"></i></div>`;
const rsClsPct = p => (p == null ? '' : p >= 1 ? 'vd' : p >= .7 ? 'am' : 'vm');

function rsSecResumo(D) {
  const { rems, itens, ref: dia } = D;
  const chegadas = rems.filter(r => r.chegou), comPrev = chegadas.filter(r => r.atraso != null);
  const noPrazo = comPrev.filter(r => r.status === 'vd').length, leves = comPrev.filter(r => r.status === 'am').length, atras = comPrev.filter(r => r.status === 'vm').length;
  const vencidas = rems.filter(r => !r.chegou && r.status === 'vm'), aChegar = rems.filter(r => !r.chegou && r.status === 'az'), semData = rems.filter(r => r.status === 'nd');
  const atrasoMed = (() => { const l = comPrev.filter(r => r.atraso > 0); return l.length ? soma0(l, r => r.atraso) / l.length : 0; })();
  const trans = chegadas.filter(r => r.transito != null && r.transito >= 0), transMed = trans.length ? soma0(trans, r => r.transito) / trans.length : null;
  const comPlan = itens.filter(i => i.plan > 0);
  const pesoPlan = soma0(comPlan, i => i.kgPlan), pesoChegou = soma0(comPlan, i => Math.min(i.kgChegou || 0, i.kgPlan || 0));
  const itensCompl = comPlan.filter(i => i.st === 'COMPLETO').length, itensNao = comPlan.filter(i => i.st === 'NÃO CHEGOU').length, itensParc = comPlan.filter(i => i.st === 'PARCIAL').length;
  const aten = D.acu.avaliados.length ? soma0(D.acu.avaliados, i => i.inv.acuracidade || 0) / D.acu.avaliados.length : null;
  const sup = D.impSup, supDias = D.rank ? D.rank.dias : 0;
  const card = (rot, val, sub, cls) => `<div class="card ${cls}"><div class="rot">${rot}</div><div class="val">${val}</div><div class="sub">${sub}</div></div>`;
  const pont = comPrev.length ? noPrazo / comPrev.length : null;
  const cards = [
    card('Remessas', nf(rems.length), `${nf(chegadas.length)} chegaram · ${nf(rems.length - chegadas.length)} pendentes`, 'az'),
    card('Pontualidade de chegada', rsPct(pont, 0), `${nf(noPrazo)} no prazo · ${nf(leves)} atraso leve · ${nf(atras)} atrasadas`, pont == null ? 'nd' : pont >= .9 ? 'vd' : pont >= .7 ? 'am' : 'vm'),
    card('Atraso médio (das atrasadas)', atrasoMed ? nf(atrasoMed, 1) + ' d' : '—', 'dias corridos após a data prevista', atrasoMed > RS_ATRASO_LEVE ? 'vm' : atrasoMed ? 'am' : 'vd'),
    card('Remessas vencidas (não chegaram)', nf(vencidas.length), vencidas.length ? 'data prevista já passou em ' + fdA(dia) : 'nenhuma vencida', vencidas.length ? 'vm' : 'vd'),
    card('A chegar no prazo', nf(aChegar.length), aChegar.length ? 'próxima: ' + fdA(aChegar.map(r => r.prev).sort()[0]) : 'sem remessas futuras', 'az'),
    card('Trânsito médio NF → obra', transMed == null ? '—' : nf(transMed, 1) + ' d', `${nf(trans.length)} remessas com NF e chegada`, 'nd'),
    card('Material que chegou (por peso)', pesoPlan ? rsPct(pesoChegou / pesoPlan, 0) : '—', `${rsT(pesoChegou)} de ${rsT(pesoPlan)} planejados`, pesoPlan ? (pesoChegou / pesoPlan >= .9 ? 'vd' : pesoChegou / pesoPlan >= .6 ? 'am' : 'vm') : 'nd'),
    card('Itens completos', `${nf(itensCompl)} / ${nf(comPlan.length)}`, `${nf(itensParc)} parciais · ${nf(itensNao)} sem chegada`, itensNao ? 'vm' : itensParc ? 'am' : 'vd'),
    card('Acuracidade média do inventário', aten == null ? '—' : nf(aten * 100, 1) + '%', `meta ≥ 98% · ${nf(D.acu.criticos.length)} críticos · ${nf(D.acu.atencao.length)} em atenção`, aten == null ? 'nd' : aten >= .98 ? 'vd' : aten >= .95 ? 'am' : 'vm'),
    card('Impactos de Suprimentos', nf(sup.length), `${nf(supDias, supDias % 1 ? 1 : 0)} dias úteis do período`, sup.length ? (supDias > 5 ? 'vm' : 'am') : 'vd'),
  ].join('');
  const pontos = [];
  if (vencidas.length) pontos.push(`<b>${nf(vencidas.length)} remessa(s) vencida(s) sem chegada</b>: ${vencidas.slice(0, 6).map(r => `${esc(r.nome)} (prevista ${fdA(r.prev)})`).join('; ')}${vencidas.length > 6 ? '…' : ''}.`);
  if (atras) pontos.push(`<b>${nf(atras)} remessa(s) chegaram com atraso superior a ${RS_ATRASO_LEVE} dias</b>; atraso médio de ${nf(atrasoMed, 1)} dias nas atrasadas.`);
  if (itensNao) pontos.push(`<b>${nf(itensNao)} item(ns) planejados ainda sem nenhuma chegada</b> (falta chegar ${rsT(soma0(comPlan.filter(i => i.st === 'NÃO CHEGOU'), i => i.kgFalta))} em peso).`);
  const gargalos = D.cap.filter(s => s.gargalo && s.gargalo.nivel !== 'vd');
  gargalos.forEach(s => pontos.push(`<b>Capacidade — ${esc(s.nome)}</b>: o saldo sustenta ${nf(s.possivel)} unidade(s), limitado por <b>${esc(s.gargalo.codigo)}</b> (${esc(s.gargalo.status)}).`));
  if (D.acu.criticos.length) pontos.push(`<b>${nf(D.acu.criticos.length)} item(ns) com acuracidade crítica (&lt; 95%)</b> no inventário — pior: ${esc(D.acu.criticos[0].tag)} (${nf(D.acu.criticos[0].inv.acuracidade * 100, 1)}%).`);
  if (supDias > 0) pontos.push(`<b>Suprimentos gerou ${nf(supDias, supDias % 1 ? 1 : 0)} dia(s) útil(eis) de impacto</b> na obra (${nf(sup.length)} registro[s], incluindo remessas em atraso).`);
  if (semData.length) pontos.push(`${nf(semData.length)} remessa(s) sem data prevista — não entram no farol de prazo até serem preenchidas em Remessas.`);
  if (!pontos.length) pontos.push('Sem pontos críticos na data de referência.');
  return `<div class="cards">${cards}</div><h3>Pontos de atenção</h3><ul class="rs-aten">${pontos.map(p => `<li>${p}</li>`).join('')}</ul>
    <div class="rs-leg"><span>${rsFr('vd', 'NO PRAZO')} chegou na data prevista ou antes</span><span>${rsFr('am', 'ATRASO LEVE')} 1 a ${RS_ATRASO_LEVE} dias</span><span>${rsFr('vm', 'ATRASADA / VENCIDA')} mais de ${RS_ATRASO_LEVE} dias, ou data prevista passou e não chegou</span><span>${rsFr('az', 'A CHEGAR')} dentro do prazo</span><span>${rsFr('nd', 'SEM DATA')} sem data prevista</span></div>`;
}

function rsSecRemessas(D) {
  const { rems } = D;
  const tipoTxt = r => (r.tipo === 'FIXADOR' ? 'fixador' : r.tipo === 'MISTA' ? 'carga + fixador' : 'carga');
  const linhas = rems.map(r => `<tr><td><b>${esc(r.nome)}</b><div class="nota">${tipoTxt(r)}${r.compostaPrev || r.compostaCh ? ' · datas compostas (vale a mais tardia)' : ''}</div></td>
    <td>${r.prev ? fdA(r.prev) : '—'}</td><td>${r.nf ? fdA(r.nf) : '—'}</td><td>${r.ch ? fdA(r.ch) : '—'}</td>
    <td class="n ${r.atraso > 0 ? 'neg' : r.atraso < 0 ? 'pos' : ''}">${r.atraso == null ? '—' : (r.atraso > 0 ? '+' : '') + nf(r.atraso)}${r.atrasoUteis ? `<div class="nota">${nf(r.atrasoUteis)} útil(eis)</div>` : ''}</td><td class="n">${r.transito != null ? nf(r.transito) : '—'}</td>
    <td class="n">${nf(r.nItens)}</td><td class="n">${r.kg != null ? nf(r.kg / 1000, 1) + (r.pesoParcial ? '*' : '') : '—'}</td>
    <td class="sub">${esc(r.principais.join(' · ') || '—')}</td><td>${rsFr(r.status, r.rotulo)}</td></tr>`);
  const tot = `<tfoot><tr><th colspan="6">Total (${nf(rems.length)} remessas)</th><th class="n">${nf(new Set(rems.flatMap(r => r.itens.map(i => i.tag))).size)}</th><th class="n">${nf(soma0(rems, r => r.kg) / 1000, 1)}</th><th colspan="2"></th></tr></tfoot>`;
  const tab = `<table class="rs-rem"><thead><tr><th>Remessa</th><th>Prevista</th><th>Emissão NF</th><th>Chegada na obra</th><th class="n">Atraso (dias)</th><th class="n">NF → obra (d)</th><th class="n">TAGs</th><th class="n">Peso (t)</th><th>Principais produtos (qtd.)</th><th>Farol</th></tr></thead><tbody>${linhas.join('') || '<tr><td colspan="10" class="vazio">Sem remessas lançadas.</td></tr>'}</tbody>${tot}</table>`;
  return `<p>Atraso = data de chegada na obra − data prevista (dias corridos; entre parênteses, os dias úteis). Remessa que ainda não chegou e já passou da data prevista é contada como atraso até a data de referência (${fdA(D.ref)}). Peso com * = só parte dos itens tem peso cadastrado.</p>${tab}
    <h3>Atraso ou antecipação por remessa</h3><div class="mapa-fig">${rsSvgAtrasos(rems)}</div>`;
}

function rsSecLogistica(D) {
  const { rems, itens } = D;
  const cheg = rems.filter(r => r.chegou && r.ch);
  const porMes = new Map();
  cheg.forEach(r => { const k = r.ch.slice(0, 7); const o = porMes.get(k) || { n: 0, ok: 0, am: 0, vm: 0, sp: 0, atr: 0, nAtr: 0, kg: 0, qtd: 0 }; o.n++; o.qtd += r.qtd; o.kg += r.kg || 0; if (r.status === 'vd') o.ok++; else if (r.status === 'am') o.am++; else if (r.status === 'vm') o.vm++; else o.sp++; if (r.atraso > 0) { o.atr += r.atraso; o.nAtr++; } porMes.set(k, o); });
  const linhasMes = [...porMes.entries()].sort().map(([k, o]) => `<tr><td><b>${k.slice(5)}/${k.slice(0, 4)}</b></td><td class="n">${nf(o.n)}</td><td class="n">${nf(o.ok)}</td><td class="n">${nf(o.am)}</td><td class="n">${nf(o.vm)}</td><td class="n">${o.nAtr ? nf(o.atr / o.nAtr, 1) : '—'}</td><td class="n">${(o.ok + o.am + o.vm) ? nf(o.ok / (o.ok + o.am + o.vm) * 100, 0) + '%' : '—'}</td><td class="n">${nf(o.qtd)}</td><td class="n">${o.kg ? nf(o.kg / 1000, 1) : '—'}</td></tr>`);
  const comPlan = itens.filter(i => i.plan > 0), kgPlan = soma0(comPlan, i => i.kgPlan);
  const pend = rems.filter(r => !r.chegou).sort((a, b) => String(a.prev || '9999').localeCompare(String(b.prev || '9999')));
  const linhasPend = pend.map(r => `<tr><td><b>${esc(r.nome)}</b></td><td>${esc(r.tipo === 'FIXADOR' ? 'Fixador' : r.tipo === 'MISTA' ? 'Mista' : 'Carga')}</td><td>${r.prev ? fdA(r.prev) : '—'}</td><td class="n ${r.aCh != null && r.aCh < 0 ? 'neg' : ''}">${r.aCh == null ? '—' : (r.aCh > 0 ? 'em ' + nf(r.aCh) + ' d' : r.aCh === 0 ? 'hoje' : 'vencida há ' + nf(-r.aCh) + ' d')}</td>
    <td>${r.nf ? fdA(r.nf) : '—'}</td><td class="n">${nf(r.nItens)}</td><td class="n">${r.kg != null ? nf(r.kg / 1000, 1) : '—'}</td><td class="sub">${esc(r.principais.join(' · ') || '—')}</td><td>${rsFr(r.status, r.rotulo)}</td></tr>`);
  const transOrd = cheg.filter(r => r.transito != null && r.transito >= 0).sort((a, b) => b.transito - a.transito).slice(0, 8);
  const forn = (T.materiais || []).filter(m => m.fornecedor || m.prazo_reposicao);
  const fornMap = new Map(); forn.forEach(m => { const k = String(m.fornecedor || 'Sem fornecedor informado').trim(); const o = fornMap.get(k) || { n: 0, prazos: [] }; o.n++; if (m.prazo_reposicao) o.prazos.push(String(m.prazo_reposicao)); fornMap.set(k, o); });
  return `<h3>Pontualidade e peso recebido por mês de chegada</h3>${rsTabela(['Mês', 'n:Remessas', 'n:No prazo', 'n:Atraso leve', 'n:Atrasadas', 'n:Atraso médio (d)', 'n:% no prazo', 'n:Qtd. recebida', 'n:Peso (t)'], linhasMes, 'Sem remessas com data de chegada.')}
    <h3>Curva de recebimento (peso acumulado × planejado)</h3><div class="mapa-fig">${rsSvgCurva(rems, kgPlan)}</div>
    <h3>Programação — remessas que ainda não chegaram</h3>${rsTabela(['Remessa', 'Tipo', 'Prevista', 'n:Situação do prazo', 'Emissão NF', 'n:TAGs', 'n:Peso (t)', 'Principais produtos (qtd.)', 'Farol'], linhasPend, 'Todas as remessas lançadas já chegaram na obra.')}
    ${transOrd.length ? `<h3>Maiores tempos de trânsito (NF → obra)</h3>${rsTabela(['Remessa', 'Emissão NF', 'Chegada', 'n:Dias'], transOrd.map(r => `<tr><td>${esc(r.nome)}</td><td>${fdA(r.nf)}</td><td>${fdA(r.ch)}</td><td class="n">${nf(r.transito)}</td></tr>`))}` : ''}
    ${forn.length ? `<h3>Fornecedores e prazo de reposição cadastrados</h3>${rsTabela(['Fornecedor', 'n:Materiais', 'Prazo de reposição informado'], [...fornMap.entries()].map(([k, o]) => `<tr><td>${esc(k)}</td><td class="n">${nf(o.n)}</td><td>${esc([...new Set(o.prazos)].join(' · ') || '—')}</td></tr>`))}` : '<p class="nota">Fornecedor e prazo de reposição não estão preenchidos no cadastro de Materiais; preenchê-los (Materiais › editar) habilita o quadro de fornecedores neste relatório.</p>'}`;
}

function rsGrupo(itens, chave) {
  const m = new Map();
  itens.forEach(i => { const k = chave(i) || '—'; const o = m.get(k) || { nome: k, n: 0, plan: 0, chegou: 0, falta: 0, kgPlan: 0, kgChegou: 0, kgFalta: 0, completos: 0, semChegada: 0 }; o.n++; o.plan += i.plan; o.chegou += Math.min(i.chegou, i.plan || i.chegou); o.falta += i.falta; o.kgPlan += i.kgPlan || 0; o.kgChegou += i.kgChegou ? Math.min(i.kgChegou, i.kgPlan || i.kgChegou) : 0; o.kgFalta += i.kgFalta || 0; if (i.st === 'COMPLETO') o.completos++; if (i.st === 'NÃO CHEGOU') o.semChegada++; m.set(k, o); });
  return [...m.values()].sort((a, b) => b.kgFalta - a.kgFalta || b.falta - a.falta || a.nome.localeCompare(b.nome, 'pt'));
}
function rsSecPlanejado(D, opc) {
  opc = opc || { visoes: { total: true, tipo: true, etapa: true, produto: true, local: true, item: true }, agrupar: 'etapa' };
  const vis = opc.visoes || {};
  const itens = D.itens.filter(i => i.plan > 0 || i.chegou > 0);
  const linhaGrupo = o => { const p = o.plan ? o.chegou / o.plan : null, pp = o.kgPlan ? o.kgChegou / o.kgPlan : null; return `<tr><td><b>${esc(o.nome)}</b></td><td class="n">${nf(o.n)}</td><td class="n">${nf(o.plan)}</td><td class="n">${nf(o.chegou)}</td><td class="n ${o.falta ? 'neg' : ''}">${nf(o.falta)}</td><td>${rsBarraPct(p, rsClsPct(p))}</td><td class="n">${rsPct(p, 0)}</td><td class="n">${o.kgPlan ? nf(o.kgPlan / 1000, 1) : '—'}</td><td class="n">${o.kgChegou ? nf(o.kgChegou / 1000, 1) : '—'}</td><td class="n ${o.kgFalta ? 'neg' : ''}">${o.kgFalta ? nf(o.kgFalta / 1000, 1) : '—'}</td><td class="n">${nf(o.completos)} / ${nf(o.n)}</td></tr>`; };
  const cab = ['Grupo', 'n:Itens', 'n:Planejado (un)', 'n:Chegou (un)', 'n:Falta chegar (un)', 'Avanço', 'n:% un', 'n:Peso plan. (t)', 'n:Peso chegou (t)', 'n:Falta chegar (t)', 'n:Itens completos'];
  const porTipo = rsGrupo(itens, i => i.tipo === 'FIXADOR' ? 'Fixadores' : 'Estrutura');
  const tot = itens.length ? linhaGrupo({ nome: 'TOTAL', n: itens.length, plan: soma0(itens, i => i.plan), chegou: soma0(itens, i => Math.min(i.chegou, i.plan || i.chegou)), falta: soma0(itens, i => i.falta), kgPlan: soma0(itens, i => i.kgPlan), kgChegou: soma0(itens, i => i.kgChegou ? Math.min(i.kgChegou, i.kgPlan || i.kgChegou) : 0), kgFalta: soma0(itens, i => i.kgFalta), completos: itens.filter(i => i.st === 'COMPLETO').length }) : '';
  // detalhe item a item: agrupado por etapa, local ou tipo (opção do filtro), o que mais falta primeiro
  const chaveAgr = { etapa: i => i.etapa, local: i => i.local, produto: i => i.produto, tipo: i => (i.tipo === 'FIXADOR' ? 'Fixadores' : 'Estrutura'), nenhum: () => 'Todos os itens' }[opc.agrupar] || (i => i.etapa);
  const rotAgr = { etapa: 'Etapa', local: 'Local', produto: 'Produto', tipo: 'Tipo', nenhum: '' }[opc.agrupar] || 'Etapa';
  const porEtapa = new Map(); itens.forEach(i => { const k = (chaveAgr(i) && chaveAgr(i) !== '—') ? chaveAgr(i) : '(sem informação)'; if (!porEtapa.has(k)) porEtapa.set(k, []); porEtapa.get(k).push(i); });
  const farolSt = { COMPLETO: 'vd', PARCIAL: 'am', 'NÃO CHEGOU': 'vm', 'SEM PLANEJADO': 'nd' };
  // o título das colunas acompanha cada grupo: repete logo abaixo da linha do grupo (etapa, local, tipo…)
  const cabItem = `<tr class="rs-cab"><th>TAG</th><th>Produto / material</th><th>Local</th><th class="n">Planejado</th><th class="n">Chegou</th><th class="n">Falta chegar</th><th class="n">%</th><th class="n">Falta (t)</th><th>Avanço</th><th>Situação</th><th>Status logístico</th></tr>`;
  const det = [...porEtapa.entries()].sort((a, b) => a[0].localeCompare(b[0], 'pt')).map(([et, l]) => `<tr class="grupo"><td colspan="11"><b>${esc(et)}</b> — ${nf(l.length)} item(ns) · planejado ${nf(soma0(l, i => i.plan))} · chegou ${nf(soma0(l, i => Math.min(i.chegou, i.plan || i.chegou)))} · falta ${nf(soma0(l, i => i.falta))}</td></tr>` + cabItem + l.sort((a, b) => (b.kgFalta || 0) - (a.kgFalta || 0) || b.falta - a.falta || a.tag.localeCompare(b.tag)).map(i => `<tr><td><b>${esc(i.tag)}</b></td><td>${esc(i.produto)}<div class="nota">${esc(i.material)}</div></td><td>${esc(i.local)}</td><td class="n">${nf(i.plan)}</td><td class="n">${nf(i.chegou)}</td>
      <td class="n ${i.falta ? 'neg' : ''}">${i.falta ? nf(i.falta) : i.exc ? '+' + nf(i.exc) : '0'}</td><td class="n">${rsPct(i.pct, 0)}</td><td class="n">${i.kgFalta ? nf(i.kgFalta / 1000, 2) : '—'}</td><td>${rsBarraPct(i.pct, rsClsPct(i.pct))}</td><td>${rsFr(farolSt[i.st] || 'nd', i.st)}</td><td class="sub">${esc(i.statusLog)}</td></tr>`).join('')).join('');
  const nota = `<p>“Chegou” soma as quantidades recebidas em todas as remessas; “falta chegar” = planejado − chegou (sem negativo). Quantidade excedente aparece com +. Peso = quantidade × peso unitário do cadastro (itens sem peso cadastrado não entram nas colunas de toneladas).</p>`;
  const cabTxt = tit => `<thead><tr>${cab.map(c => `<th${c.startsWith('n:') ? ' class="n"' : ''}>${esc(c.replace(/^n:/, '').replace('Grupo', tit))}</th>`).join('')}</tr></thead>`;
  const tabGrupo = (tit, linhas) => `<table>${cabTxt(tit)}<tbody>${linhas.join('') || `<tr><td colspan="${cab.length}" class="vazio">Sem itens.</td></tr>`}</tbody></table>`;
  const resumos = [
    vis.total ? `<h3>Total</h3>${tabGrupo('Total', tot ? [tot] : [])}` : '',
    vis.tipo ? `<h3>Por tipo (estrutura × fixadores)</h3>${tabGrupo('Tipo', porTipo.map(linhaGrupo))}` : '',
    vis.etapa ? `<h3>Por etapa</h3>${tabGrupo('Etapa', rsGrupo(itens, i => i.etapa).map(linhaGrupo))}` : '',
    vis.produto ? `<h3>Por produto (famílias com maior falta de peso primeiro)</h3>${tabGrupo('Produto', rsGrupo(itens, i => i.produto).map(linhaGrupo))}` : '',
    vis.local ? `<h3>Por local</h3>${tabGrupo('Local', rsGrupo(itens, i => i.local).map(linhaGrupo))}` : '',
  ].join('');
  const itemAItem = vis.item ? `<h3>Item a item — planejado × chegou × falta chegar${rotAgr ? ` <span class="nota">(agrupado por ${rotAgr.toLowerCase()})</span>` : ''}</h3>
    <table>${det ? '' : `<thead>${cabItem}</thead>`}<tbody>${det || '<tr><td colspan="11" class="vazio">Sem itens.</td></tr>'}</tbody></table>` : '';
  return nota + resumos + itemAItem;
}

function rsSecAcuracidade(D) {
  const a = D.acu, av = a.avaliados;
  if (!av.length) return '<p class="nota">Nenhum item com inventário físico lançado até a data de referência. A acuracidade só é calculada quando há inventário físico (Consumo físico › inventário) para comparar com o consumo virtual.</p>';
  const media = soma0(av, i => i.inv.acuracidade || 0) / av.length;
  const perda = soma0(av, i => Math.max(0, i.inv.perda_real || 0));
  const fr = i => { const s = rsNorm(i.inv.status); return s === 'CONFORME' ? 'vd' : s === 'ATENCAO' ? 'am' : s === 'CRITICO' ? 'vm' : 'nd'; };
  const linha = i => `<tr><td><b>${esc(i.tag)}</b></td><td>${esc(i.produto)}</td><td class="n">${nf(i.plan)}</td><td class="n">${nf(i.chegou)}</td><td class="n">${nf(i.inv.consumo_virtual)}</td><td class="n">${nf(i.inv.consumo_fisico)}</td><td class="n">${nf(i.inv.estoque_virtual_atual)}</td><td class="n">${nf(i.inv.estoque_fisico)}</td><td class="n ${i.inv.perda_real < 0 ? 'neg' : ''}">${nf(i.inv.perda_real)}</td><td class="n">${nf((i.inv.taxa_perda || 0) * 100, 1)}%</td><td class="n"><b>${nf(i.inv.acuracidade * 100, 1)}%</b></td><td>${rsFr(fr(i), i.inv.status)}</td><td class="sub">${esc(i.inv.acao || '')}</td></tr>`;
  const cab = ['TAG', 'Produto', 'n:Planejado', 'n:Chegou', 'n:Consumo virtual', 'n:Consumo físico', 'n:Estoque virtual', 'n:Estoque físico', 'n:Perda real', 'n:% perda', 'n:Acuracidade', 'Status', 'Ação'];
  const porProd = new Map(); av.forEach(i => { const o = porProd.get(i.produto) || { n: 0, s: 0, crit: 0 }; o.n++; o.s += i.inv.acuracidade || 0; if (rsNorm(i.inv.status) === 'CRITICO') o.crit++; porProd.set(i.produto, o); });
  const linhasProd = [...porProd.entries()].map(([k, o]) => ({ k, n: o.n, m: o.s / o.n, crit: o.crit })).sort((x, y) => x.m - y.m).slice(0, 15).map(o => `<tr><td>${esc(o.k)}</td><td class="n">${nf(o.n)}</td><td class="n">${nf(o.m * 100, 1)}%</td><td class="n">${nf(o.crit)}</td></tr>`);
  return `<div class="cards"><div class="card az"><div class="rot">Itens avaliados</div><div class="val">${nf(av.length)}</div><div class="sub">com inventário físico lançado</div></div>
    <div class="card ${media >= .98 ? 'vd' : media >= .95 ? 'am' : 'vm'}"><div class="rot">Acuracidade média</div><div class="val">${nf(media * 100, 1)}%</div><div class="sub">meta ≥ 98%</div></div>
    <div class="card vd"><div class="rot">Conformes</div><div class="val">${nf(a.conformes.length)}</div><div class="sub">≥ 98%</div></div>
    <div class="card am"><div class="rot">Atenção</div><div class="val">${nf(a.atencao.length)}</div><div class="sub">95% a 98%</div></div>
    <div class="card vm"><div class="rot">Críticos</div><div class="val">${nf(a.criticos.length)}</div><div class="sub">&lt; 95%</div></div>
    <div class="card nd"><div class="rot">Perda real acumulada</div><div class="val">${nf(perda)}</div><div class="sub">unidades (soma das perdas positivas)</div></div></div>
    <p>Acuracidade = quanto o estoque físico contado confere com o estoque virtual (recebido − consumo pelas regras de baixa). Consumo virtual é calculado pela produção lançada; consumo físico, pelas retiradas lançadas em Consumo físico.</p>
    <h3>Itens críticos e em atenção (pior acuracidade primeiro)</h3>${rsTabela(cab, [...a.criticos, ...a.atencao].map(linha), 'Nenhum item crítico ou em atenção.')}
    <h3>Acuracidade média por produto (15 menores)</h3>${rsTabela(['Produto', 'n:Itens avaliados', 'n:Acuracidade média', 'n:Críticos'], linhasProd)}
    <h3>Itens conformes</h3>${rsTabela(cab, a.conformes.map(linha), 'Nenhum item conforme.')}`;
}

function rsSecUso(D) {
  const comCons = D.itens.filter(i => i.consumo > 0);
  if (!comCons.length) return '<p class="nota">Ainda não há consumo lançado nem calculado pelas regras de baixa.</p>';
  const estr = comCons.filter(i => i.tipo !== 'FIXADOR'), fixs = comCons.filter(i => i.tipo === 'FIXADOR');
  const totKg = soma0(estr, i => i.kgCons) || 0, totQtdFix = soma0(fixs, i => i.consumo) || 0;
  const linha = (i, ref, usaPeso) => `<tr><td><b>${esc(i.tag)}</b></td><td>${esc(i.produto)}<div class="nota">${esc(i.material)}</div></td><td>${esc(i.etapa)}</td><td class="n"><b>${nf(i.consumo)}</b></td><td class="n">${i.kgCons ? nf(i.kgCons / 1000, 2) : '—'}</td><td class="n">${i.plan ? nf(i.consumo / i.plan * 100, 0) + '%' : '—'}</td><td class="n">${ref ? nf((usaPeso ? i.kgCons : i.consumo) / ref * 100, 1) + '%' : '—'}</td><td>${i.consFisico > 0 ? 'físico' : 'virtual'}</td></tr>`;
  const cab = ['#', 'TAG', 'Produto / material', 'Etapa', 'n:Consumo (un)', 'n:Peso (t)', 'n:% do planejado', 'n:% do total', 'Origem do consumo'];
  const rank = (lista, ref, usaPeso) => lista.map((i, k) => `<tr><td class="c">${k + 1}</td>${linha(i, ref, usaPeso).slice(4)}`);
  const topE = [...estr].sort((a, b) => (b.kgCons || 0) - (a.kgCons || 0) || b.consumo - a.consumo).slice(0, 20);
  const topF = [...fixs].sort((a, b) => b.consumo - a.consumo).slice(0, 20);
  // curva ABC pelo peso consumido da estrutura
  let acum = 0; const abc = [...estr].filter(i => i.kgCons).sort((a, b) => b.kgCons - a.kgCons).map(i => { acum += i.kgCons; return { ...i, acum: acum / (totKg || 1) }; });
  const cls = x => (x.acum <= .8 ? 'A' : x.acum <= .95 ? 'B' : 'C');
  const nA = abc.filter(x => cls(x) === 'A').length, nB = abc.filter(x => cls(x) === 'B').length, nC = abc.filter(x => cls(x) === 'C').length;
  const porProd = new Map(); comCons.forEach(i => { const o = porProd.get(i.produto) || { n: 0, un: 0, kg: 0 }; o.n++; o.un += i.consumo; o.kg += i.kgCons || 0; porProd.set(i.produto, o); });
  const linhasProd = [...porProd.entries()].sort((a, b) => b[1].kg - a[1].kg || b[1].un - a[1].un).slice(0, 20).map(([k, o]) => `<tr><td>${esc(k)}</td><td class="n">${nf(o.n)}</td><td class="n">${nf(o.un)}</td><td class="n">${o.kg ? nf(o.kg / 1000, 2) : '—'}</td></tr>`);
  const cf = estConsumoComCadastros(), empr = (typeof relConsEmpresas === 'function' ? relConsEmpresas() : cf.empresas || []);
  const datas = consSemanasDatas(cf), per = consSemanasPeriodos(cf);
  const mapPeso = new Map(D.itens.map(i => [matChaveTag(i.tag), i.pu]));
  const semanas = (cf.semanas || []).map(s => { let itensN = 0, qtd = 0, kg = 0; (cf.itens || []).forEach(m => { const d = m.consumo_semanas && m.consumo_semanas[s]; if (!d) return; const q = soma0(empr, e => Number(d[e]) || 0); if (q > 0) { itensN++; qtd += q; const pu = mapPeso.get(matChaveTag(m.tag)); if (pu) kg += q * pu; } }); const p = per[s]; const dd = datas.get(s);
    return { s, itensN, qtd, kg, ini: p && p.ini ? p.ini : (dd ? dd.bruta : null), fim: p && p.fim ? p.fim : null }; }).filter(x => x.qtd > 0);
  return `<p>Uso = retirada física lançada em Consumo físico; quando não há retirada, vale o consumo virtual calculado pelas regras de baixa. Estrutura é ordenada pelo peso consumido e fixadores pela quantidade (unidades diferentes não se somam).</p>
    <div class="cards"><div class="card az"><div class="rot">Itens com consumo</div><div class="val">${nf(comCons.length)}</div><div class="sub">${nf(estr.length)} de estrutura · ${nf(fixs.length)} fixadores</div></div>
    <div class="card nd"><div class="rot">Peso de estrutura consumido</div><div class="val">${rsT(totKg)}</div><div class="sub">${totKg && D.kgPlanEstr ? rsPct(totKg / D.kgPlanEstr, 0) + ' do planejado' : 'itens com peso cadastrado'}</div></div>
    <div class="card nd"><div class="rot">Fixadores consumidos</div><div class="val">${nf(totQtdFix)}</div><div class="sub">unidades</div></div>
    <div class="card nd"><div class="rot">Curva ABC (peso)</div><div class="val">A ${nf(nA)} · B ${nf(nB)} · C ${nf(nC)}</div><div class="sub">A = 80% do peso · B = até 95%</div></div></div>
    <h3>Estrutura — 20 itens de maior uso (por peso consumido)</h3>${rsTabela(cab, rank(topE, totKg, true))}
    <h3>Fixadores — 20 itens de maior uso (por quantidade)</h3>${rsTabela(cab, rank(topF, totQtdFix, false))}
    <h3>Uso por família de produto (20 maiores)</h3>${rsTabela(['Produto', 'n:Itens', 'n:Consumo (un)', 'n:Peso (t)'], linhasProd)}
    ${semanas.length ? `<h3>Retiradas por semana (Consumo físico)</h3>${rsTabela(['Semana', 'Período', 'n:Itens retirados', 'n:Quantidade', 'n:Peso (t)'], semanas.map(x => `<tr><td>${esc(x.s)}</td><td>${x.ini ? fdA(x.ini) + (x.fim && x.fim !== x.ini ? ' a ' + fdA(x.fim) : '') : '—'}</td><td class="n">${nf(x.itensN)}</td><td class="n">${nf(x.qtd)}</td><td class="n">${x.kg ? nf(x.kg / 1000, 2) : '—'}</td></tr>`))}` : ''}`;
}

function rsSecCapacidade(D) {
  const servs = D.cap;
  if (!servs.length) return '<p class="nota">As regras de baixa desta obra não ligam materiais a serviços (nada a calcular). A cobertura por consumo médio está no quadro abaixo.</p>' + rsCobTabela(D);
  const blocos = servs.map(s => {
    const lin = s.linhas.map(l => `<tr><td><b>${esc(l.codigo)}</b></td><td>${esc(l.descricao)}</td><td class="n">${l.pu ? nf(l.pu, l.pu % 1 ? 2 : 0) : '—'}</td><td class="n">${nf(l.saldoV)}</td><td class="n">${nf(l.saldoR)}${l.inventarioFisico ? '' : '<span class="nota"> (calc.)</span>'}</td><td class="n">${l.capV == null ? '—' : nf(l.capV)}</td><td class="n">${l.capR == null ? '—' : nf(l.capR)}</td><td class="n"><b>${l.cap == null ? '—' : nf(l.cap)}</b></td><td>${rsFr(l.nivel === 'verde' ? 'vd' : l.nivel, l.status)}</td></tr>`);
    return `<h3>${esc(s.nome)} — pode produzir ${s.possivel == null ? '—' : nf(s.possivel)} unidade(s)${s.gargalo ? ` · limitante ${esc(s.gargalo.codigo)}` : ''}</h3>${s.descricao ? `<p class="nota">${esc(s.descricao)}</p>` : ''}
      ${rsTabela(['TAG', 'Descrição', 'n:Por unidade', 'n:Saldo virtual', 'n:Saldo físico', 'n:Capacidade virtual', 'n:Capacidade física', 'n:Capacidade', 'Situação'], lin)}`;
  }).join('');
  return `<p>Capacidade de um item = quantas unidades do serviço o saldo atual sustenta (saldo ÷ consumo por unidade da regra de baixa); vale o menor entre o saldo virtual (recebido − consumo calculado) e o saldo físico (último inventário lançado, ou o calculado pelas retiradas). A capacidade do serviço é a do item limitante (gargalo). Atenção até ${RS_CAP_ATENCAO} unidades; crítico quando o saldo não cobre nem 1 unidade.</p>
    <div class="cards">${servs.map(s => `<div class="card ${!s.gargalo ? 'nd' : s.gargalo.nivel === 'verde' ? 'vd' : s.gargalo.nivel}"><div class="rot">Posso produzir — ${esc(s.nome)}</div><div class="val">${s.possivel == null ? '—' : nf(s.possivel)}</div><div class="sub">${s.gargalo ? 'limitado por ' + esc(s.gargalo.codigo) : 'sem regra'} · ${nf(s.criticos)} críticos · ${nf(s.atencao)} atenção</div></div>`).join('')}</div>
    ${blocos}${rsCobTabela(D)}`;
}
function rsCobTabela(D) {
  const cob = D.cob;
  if (!cob.length) return '';
  const lin = cob.slice(0, 80).map(i => { const nv = i.cob == null ? 'nd' : i.cob < 1 ? 'vm' : i.cob < 3 ? 'am' : 'vd'; return `<tr><td><b>${esc(i.tag)}</b></td><td>${esc(i.produto)}</td><td class="n">${nf(i.consumo)}</td><td class="n">${nf(i.porSem, 1)}</td><td class="n">${nf(i.saldoCob)}</td><td class="n"><b>${i.cob == null ? '—' : nf(i.cob, 1)}</b></td><td class="n">${i.cobDias == null ? '—' : nf(i.cobDias, 0)}</td><td>${rsFr(nv, i.cob == null ? 'SEM CONSUMO' : i.cob < 1 ? 'MENOS DE 1 SEMANA' : i.cob < 3 ? 'ATENÇÃO' : 'OK')}</td></tr>`; });
  return `<h3>Cobertura de estoque por item — saldo ÷ consumo médio por semana (${nf(cob.length)} itens com consumo${cob.length > 80 ? '; 80 de menor cobertura' : ''})</h3>
    ${rsTabela(['TAG', 'Produto', 'n:Consumo acumulado', 'n:Consumo médio / semana', 'n:Saldo', 'n:Cobertura (semanas)', 'n:Cobertura (dias)', 'Situação'], lin)}
    <p class="nota">Cobertura em dias corridos = semanas × 7. Consumo médio = consumo acumulado ÷ semanas decorridas até ${fdA(D.ref)}.</p>`;
}

function rsSecImpactos(D) {
  const imp = D.impSup, lim = D.lim;
  if (!imp.length) return '<p>Nenhum impacto atribuído ao setor Suprimentos até a data de referência (nem remessas em atraso).</p>';
  const lancados = imp.filter(i => !i._autoRemessa), autos = imp.filter(i => i._autoRemessa);
  const linhasL = lancados.sort((a, b) => String(b.data).localeCompare(String(a.data))).map(i => `<tr><td>${ehISO(i.data) ? fdA(i.data) : esc(i.data || '—')}</td><td>${esc(impactoEmpresasTexto(i))}</td><td>${esc(i.servico || '—')}</td><td>${esc(i.motivo || i.paralisacao || '—')}</td><td class="n">${nf(diasUteisImpacto(i), 1)}</td><td>${i.solucionado ? 'SOLUCIONADO ' + fdA(i.solucionado) : '<span class="neg">EM ABERTO</span>'}${i.solucao ? `<div class="nota">${esc(i.solucao)}${i.solucionado_por ? ' · por ' + esc(i.solucionado_por) : ''}</div>` : ''}</td></tr>`);
  const linhasA = autos.sort((a, b) => String(b.data).localeCompare(String(a.data))).map(i => `<tr><td>${fdA(i.data)}</td><td>${esc((String(i.linha || '').replace(/^REM-/, '')))}</td><td class="n">${nf(i.diasUteis)}</td><td>${esc(i.motivo || '')}</td></tr>`);
  return `<p>Considera os impactos lançados com setor responsável <b>Suprimentos</b> e as remessas que chegaram depois da data prevista (impacto automático). Dias úteis reais do período (${fdA(lim.ini)} a ${fdA(lim.fim)}), sem repetir o mesmo dia.</p>
    <p class="nota">Impactos automáticos de remessa não têm empresa identificada (afetam a obra como um todo) e por isso aparecem em “Todas / não informada”; os impactos lançados à mão trazem as empresas atingidas.</p>
    ${htmlRankingImpactos(imp, [], lim).replace('<h2>', '<h3>').replace('</h2>', '</h3>')}
    ${linhasL.length ? `<h3>Impactos lançados pelo setor de Suprimentos</h3>${rsTabela(['Data', 'Empresa(s)', 'Atividade', 'Motivo', 'n:Dias úteis', 'Situação · solução'], linhasL)}` : ''}
    ${linhasA.length ? `<h3>Impactos automáticos — remessas que chegaram após a data prevista</h3>${rsTabela(['Data prevista', 'Remessa', 'n:Dias úteis de atraso', 'Detalhe'], linhasA)}` : ''}`;
}

function rsNotas(D) {
  return `<ul class="rs-aten">
    <li><b>Data de referência:</b> ${fdA(D.ref)} — tudo é calculado até essa data (a mesma do topo do sistema).</li>
    <li><b>Faróis de prazo:</b> verde = chegou na data prevista ou antes; amarelo = 1 a ${RS_ATRASO_LEVE} dias de atraso; vermelho = mais de ${RS_ATRASO_LEVE} dias, ou data prevista já passou sem chegada; azul = a chegar dentro do prazo; cinza = sem data prevista.</li>
    <li><b>Datas compostas:</b> quando a data de uma remessa traz mais de uma (ex.: duas ordens de entrega), vale a mais tardia.</li>
    <li><b>Planejado, chegou e falta:</b> “chegou” é a soma das remessas lançadas por TAG; peso = quantidade × peso unitário do cadastro (TAGs sem peso ficam de fora das toneladas).</li>
    <li><b>Acuracidade:</b> só itens com inventário físico lançado; meta ≥ 98% (conforme), 95% a 98% (atenção), abaixo de 95% (crítico).</li>
    <li><b>Capacidade:</b> saldo ÷ consumo por unidade das regras de baixa; o serviço fica limitado pelo item de menor capacidade.</li>
    <li><b>Impactos:</b> setor responsável Suprimentos (lançados) e remessas chegadas após a data prevista; dias úteis reais, sem repetir o mesmo dia.</li>
  </ul>`;
}

// ---------------------------------------------------------------- montagem
async function rsDados(filtro) {
  // dados sempre atuais: remessas, estoque e consumo vêm do servidor no momento de gerar
  try { const j = await fetch(API + 'estoque-planilha', { cache: 'no-store' }).then(r => r.ok ? r.json() : null); if (j) EP = j; } catch (e) { /* segue com o que está na tela */ }
  if (!EP) throw new Error('Os dados de Suprimentos ainda não foram carregados. Abra uma aba de Suprimentos e tente de novo.');
  if (!window._regras_baixa) { regrasBaixa(() => {}); await window._regras_pend; }
  if (!window._frentes) { frentesMontagem(() => {}); await window._frentes_pend; }
  const regras = window._regras_baixa || {}, dia = ref;
  const itensTodos = rsItens(regras);
  const itens = filtro ? itensTodos.filter(i => (!filtro.locais || filtro.locais.has(rsNorm(i.local))) && (!filtro.tipo || filtro.tipo === 'todos' || (filtro.tipo === 'fixador') === (i.tipo === 'FIXADOR'))) : itensTodos;
  const rems = rsRemessas(dia);
  const avaliados = itens.filter(i => i.inv && i.inv.status);
  const ordenaAcu = l => l.sort((a, b) => (a.inv.acuracidade || 0) - (b.inv.acuracidade || 0));
  const acu = { avaliados, conformes: ordenaAcu(avaliados.filter(i => rsNorm(i.inv.status) === 'CONFORME')), atencao: ordenaAcu(avaliados.filter(i => rsNorm(i.inv.status) === 'ATENCAO')), criticos: ordenaAcu(avaliados.filter(i => rsNorm(i.inv.status) === 'CRITICO')) };
  const lim = { ini: (M.datas && M.datas[0]) || add(dia, -90), fim: dia };
  let impSup = [], rank = null;
  try { impSup = impactosComAutomaticos().filter(i => normSetor(impactoSetor(i)) === 'suprimentos'); rank = rankingImpactos(impSup, [], lim); } catch (e) { console.error('RS impactos', e); }
  return { ref: dia, regras, itens, rems, acu, cap: rsTry('capacidade', () => rsCapacidade(regras, itensTodos)) , cob: rsTry('cobertura', () => rsCobertura(itens, dia)), itensTodos, filtro: filtro || null, impSup, rank, lim,
    kgPlanEstr: soma0(itens.filter(i => i.tipo !== 'FIXADOR'), i => i.kgPlan) };
}
async function rsHtml(f) {
  f = f || rsFiltroPadrao();
  const filtro = { locais: f.locais && f.locais.length ? new Set(f.locais.map(rsNorm)) : null, tipo: f.tipo || 'todos' };
  const D = await rsDados(filtro);
  if (typeof D.cap === 'string') D.cap = [];   // rsTry devolveu aviso em HTML
  if (typeof D.cob === 'string') D.cob = [];
  await tplLogosCarregar();
  const sec = (t, h) => `<h2>${t}</h2>${h}`;
  const quer = k => f.secoes[k] !== false;
  const opc = { visoes: f.visoes, agrupar: f.agrupar || 'etapa' };
  const filtrado = !!(filtro.locais || filtro.tipo !== 'todos');
  const textoFiltro = [filtro.locais ? `Local: ${[...f.locais].sort((a, b) => a.localeCompare(b, 'pt')).join(', ')}` : 'Todos os locais', filtro.tipo === 'estrutura' ? 'Só estrutura' : filtro.tipo === 'fixador' ? 'Só fixadores' : 'Estrutura e fixadores'].join(' · ');
  const avisoFiltro = filtrado ? `<p class="nota"><b>Filtros aplicados:</b> ${esc(textoFiltro)}. Valem para os itens (resumo, planejado × chegou, acuracidade, maior uso e cobertura). ${quer('remessas') || quer('logistica') ? 'As remessas e a logística mostram todas as remessas da obra; a capacidade por serviço usa todos os itens (um serviço depende de itens de vários locais).' : 'A capacidade por serviço usa todos os itens (um serviço depende de itens de vários locais).'}</p>` : '';
  const partes = [
    ['resumo', () => sec('Resumo executivo', rsTry('resumo', () => rsSecResumo(D)))],
    ['remessas', () => sec('1. Remessas — datas e faróis de prazo', rsTry('remessas', () => rsSecRemessas(D)))],
    ['logistica', () => sec('2. Logística — trânsito, pontualidade, recebimento e programação', rsTry('logística', () => rsSecLogistica(D)))],
    ['planejado', () => sec('3. Planejado × chegou × falta chegar', rsTry('planejado', () => rsSecPlanejado(D, opc)))],
    ['acuracidade', () => sec('4. Acuracidade dos itens', rsTry('acuracidade', () => rsSecAcuracidade(D)))],
    ['uso', () => sec('5. Maior uso de itens', rsTry('uso', () => rsSecUso(D)))],
    ['capacidade', () => sec('6. Capacidade de produção e cobertura de cada item', rsTry('capacidade', () => rsSecCapacidade(D)))],
    ['impactos', () => sec('7. Impactos causados pelo setor de Suprimentos', rsTry('impactos', () => rsSecImpactos(D)))],
    ['notas', () => sec('Notas e critérios', rsNotas(D))],
  ].filter(([k]) => quer(k)).map(([, fn]) => fn());
  const soItem = quer('planejado') && partes.length === 1;
  const corpo = avisoFiltro + partes.join('');
  return tplDocumento({ titulo: 'Relatório geral de Suprimentos', subtitulo: `${soItem ? 'Item a item · ' : ''}${filtrado ? textoFiltro + ' · ' : ''}posição em ${fdA(D.ref)} (data de referência)`, meta: soItem ? 'Planejado × chegou × falta chegar, item a item' : 'Remessas e faróis de prazo · logística · planejado × chegou × falta · acuracidade · maior uso · capacidade · impactos de Suprimentos', corpo, css: RS_CSS });
}

// ---------------------------------------------------------------- filtro do relatório geral (o que entra, local e tipo)
const RS_SECOES = [['resumo', 'Resumo executivo'], ['remessas', '1. Remessas — datas e faróis'], ['logistica', '2. Logística'], ['planejado', '3. Planejado × chegou × falta chegar'], ['acuracidade', '4. Acuracidade'], ['uso', '5. Maior uso de itens'], ['capacidade', '6. Capacidade e cobertura'], ['impactos', '7. Impactos de Suprimentos'], ['notas', 'Notas e critérios']];
const RS_VISOES = [['total', 'Total'], ['tipo', 'Por tipo'], ['etapa', 'Por etapa'], ['produto', 'Por produto'], ['local', 'Por local'], ['item', 'Item a item']];
function rsFiltroPadrao() {
  const base = { secoes: {}, visoes: { total: true, tipo: true, etapa: true, produto: true, local: true, item: true }, agrupar: 'etapa', locais: null, tipo: 'todos' };
  try {
    const salvo = JSON.parse(localStorage.getItem('rsFiltro') || 'null');
    if (salvo && typeof salvo === 'object') {
      const vi = salvo.visoes || (salvo.resumos !== undefined ? { total: salvo.resumos, tipo: salvo.resumos, etapa: salvo.resumos, produto: salvo.resumos, local: salvo.resumos, item: salvo.item !== false } : base.visoes);   // escolha salva na versão anterior
      return { ...base, ...salvo, visoes: { ...base.visoes, ...vi }, secoes: { ...(salvo.secoes || {}) } };
    }
  } catch (e) { /* sem filtro salvo */ }
  return base;
}
// locais agrupados sem diferenciar maiúsculas/acentos ("galpão" e "Galpão" são o mesmo local); o rótulo é a grafia mais usada
function rsFiltroLocais() {
  const g = new Map();
  estMateriaisComCadastros().forEach(m => {
    const l = m.local || '—', k = rsNorm(l), o = g.get(k) || { n: 0, graf: new Map() };
    o.n++; o.graf.set(l, (o.graf.get(l) || 0) + 1); g.set(k, o);
  });
  return [...g.values()].map(o => [[...o.graf.entries()].sort((a, b) => b[1] - a[1])[0][0], o.n]).sort((a, b) => a[0].localeCompare(b[0], 'pt'));
}
function rsFiltroAbrir() {
  const dlg = document.getElementById('dlgRelSup');
  if (!dlg) return rsGerar(null, rsFiltroPadrao());
  const f = rsFiltroPadrao(), locais = rsFiltroLocais();
  const salvos = f.locais ? new Set(f.locais.map(rsNorm)) : null, marcado = l => !salvos || salvos.has(rsNorm(l));
  dlg.querySelector('form').innerHTML = `<div class="bloco-cab"><h2>Relatório geral de Suprimentos — o que entra</h2></div>
    <div class="rs-filtro">
      <fieldset><legend>Atalhos</legend>
        <button type="button" class="btn" data-rs-atalho="item-galpao">Só item a item do galpão</button>
        <button type="button" class="btn" data-rs-atalho="item">Só item a item (todos os locais)</button>
        <button type="button" class="btn" data-rs-atalho="produto">Só por produto</button>
        <button type="button" class="btn" data-rs-atalho="etapa">Só por etapa</button>
        <button type="button" class="btn" data-rs-atalho="local">Só por local</button>
        <button type="button" class="btn" data-rs-atalho="tudo">Relatório completo</button></fieldset>
      <fieldset><legend>Seções do relatório</legend><div class="rs-grade">${RS_SECOES.map(([k, t]) => `<label><input type="checkbox" data-rs-sec="${k}" ${f.secoes[k] === false ? '' : 'checked'}> ${esc(t)}</label>`).join('')}</div>
        <div class="rs-sub"><b>Seção 3 — como mostrar:</b>
          ${RS_VISOES.map(([k, t]) => `<label><input type="checkbox" data-rs-vis="${k}" ${f.visoes[k] === false ? '' : 'checked'}> ${t}</label>`).join('')}</div>
        <div class="rs-sub"><label>Item a item agrupado por <select id="rsAgrupar">${[['etapa', 'etapa'], ['produto', 'produto'], ['local', 'local'], ['tipo', 'tipo (estrutura/fixador)'], ['nenhum', 'não agrupar']].map(([v, t]) => `<option value="${v}" ${f.agrupar === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label></div></fieldset>
      <fieldset><legend>Tipo de item</legend><label><input type="radio" name="rsTipo" value="todos" ${f.tipo === 'todos' ? 'checked' : ''}> Estrutura e fixadores</label> <label><input type="radio" name="rsTipo" value="estrutura" ${f.tipo === 'estrutura' ? 'checked' : ''}> Só estrutura</label> <label><input type="radio" name="rsTipo" value="fixador" ${f.tipo === 'fixador' ? 'checked' : ''}> Só fixadores</label></fieldset>
      <fieldset><legend>Local <span class="nota">(marque os que quer ver)</span></legend>
        <div class="rs-locais-barra"><button type="button" class="btn" data-rs-loc="todos">Todos</button> <button type="button" class="btn" data-rs-loc="nenhum">Nenhum</button> <button type="button" class="btn" data-rs-loc="galpao">Só galpão</button></div>
        <div class="rs-grade rs-locais">${locais.map(([l, n]) => `<label><input type="checkbox" data-rs-local value="${esc(l)}" ${marcado(l) ? 'checked' : ''}> ${esc(l)} <span class="nota">${nf(n)} item(ns)</span></label>`).join('')}</div></fieldset>
    </div>
    <div class="acoes"><span class="espaco"></span><button type="button" class="btn" id="rsCancelar">Cancelar</button><button type="submit" class="btn primario">Visualizar relatório</button></div>`;
  dlg.showModal();
}
function rsFiltroLer(dlg) {
  const secoes = {}; dlg.querySelectorAll('[data-rs-sec]').forEach(c => { secoes[c.dataset.rsSec] = c.checked; });
  const caixas = [...dlg.querySelectorAll('[data-rs-local]')], marcadas = caixas.filter(c => c.checked).map(c => c.value);
  return { secoes, visoes: Object.fromEntries([...dlg.querySelectorAll('[data-rs-vis]')].map(c => [c.dataset.rsVis, c.checked])), agrupar: dlg.querySelector('#rsAgrupar').value,
    tipo: (dlg.querySelector('input[name=rsTipo]:checked') || {}).value || 'todos', locais: marcadas.length === caixas.length ? null : marcadas, _nenhumLocal: !marcadas.length };
}
document.addEventListener('click', e => {
  const dlg = document.getElementById('dlgRelSup');
  if (!dlg || !dlg.open) return;
  if (e.target.closest('#rsCancelar')) return dlg.close();
  const at = e.target.closest('[data-rs-atalho]');
  if (at) {
    const k = at.dataset.rsAtalho, soSec3 = k !== 'tudo';
    dlg.querySelectorAll('[data-rs-sec]').forEach(c => { c.checked = !soSec3 || c.dataset.rsSec === 'planejado'; });
    const vis = { 'item-galpao': ['item'], item: ['item'], produto: ['produto'], etapa: ['etapa'], local: ['local'] }[k];   // 'tudo' = todas as formas
    dlg.querySelectorAll('[data-rs-vis]').forEach(c => { c.checked = !vis || vis.includes(c.dataset.rsVis); });
    dlg.querySelectorAll('[data-rs-local]').forEach(c => { c.checked = k === 'item-galpao' ? /galp/i.test(c.value) : (k === 'tudo' || k === 'item' || c.checked); });
    return;
  }
  const lo = e.target.closest('[data-rs-loc]');
  if (lo) dlg.querySelectorAll('[data-rs-local]').forEach(c => { c.checked = lo.dataset.rsLoc === 'todos' ? true : lo.dataset.rsLoc === 'nenhum' ? false : /galp/i.test(c.value); });
});
document.addEventListener('submit', e => {
  if (!e.target.closest || !e.target.closest('#dlgRelSup')) return;
  e.preventDefault();
  const dlg = document.getElementById('dlgRelSup'), f = rsFiltroLer(dlg);
  if (f._nenhumLocal) return toast('Marque pelo menos um local.', true);
  if (!Object.values(f.secoes).some(Boolean)) return toast('Marque pelo menos uma seção.', true);
  if (f.secoes.planejado && !Object.values(f.visoes).some(Boolean)) return toast('Na seção 3, marque pelo menos uma forma de mostrar (total, por produto, item a item…).', true);
  delete f._nenhumLocal;
  try { localStorage.setItem('rsFiltro', JSON.stringify(f)); } catch (err) { /* sem armazenamento */ }
  dlg.close();
  rsGerar(document.querySelector('[data-rel-suprim="geral"]'), f);
});

// ---------------------------------------------------------------- RELATÓRIO EXECUTIVO (1 página, para a diretoria): saúde do suprimento + gargalos ordenados por prioridade
const RS_CSS_EXEC = `<style>
.ex-sel{display:inline-block;padding:4px 14px;border-radius:5px;color:#fff;font-weight:800;letter-spacing:.5px}
.ex-sel.vm{background:#dc2626}.ex-sel.am{background:#c98a00}.ex-sel.vd{background:#16a34a}
.ex-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:10px}
.ex-box{border:1px solid #dfe4ea;border-radius:6px;padding:8px 10px}
.ex-box h3{margin:0 0 6px}
.ex-pilha{display:flex;height:20px;border-radius:3px;overflow:hidden;margin:4px 0 6px}
.ex-pilha div{color:#fff;font-size:10px;font-weight:700;text-align:center;line-height:20px}
table.ex-g td,table.ex-g th{font-size:10.5px}
</style>`;
// gargalos: cada candidato traz nível, pontuação (ordem de prioridade), título, evidência, efeito e ação
function rsGargalos(D) {
  const g = [], { rems, itens } = D;
  const comPlan = itens.filter(i => i.plan > 0);
  // 1) serviços sem capacidade: o material trava a produção
  D.cap.filter(s => s.gargalo && s.gargalo.nivel !== 'verde' && s.gargalo.nivel !== 'vd' && s.gargalo.nivel !== 'nd').forEach(s => {
    const l = s.gargalo, crit = l.nivel === 'vm';
    g.push({ nivel: crit ? 'vm' : 'am', score: (crit ? 100 : 55) + (crit && s.possivel === 0 ? 5 : 0), titulo: `${s.nome}: ${crit ? 'material não sustenta a produção' : 'capacidade baixa'}`,
      evidencia: `Limitante <b>${esc(l.codigo)}</b> ${esc(l.descricao)}: saldo ${nf(Math.min(l.saldoV, l.saldoR))} para ${nf(l.pu, l.pu % 1 ? 2 : 0)} por unidade`,
      efeito: `Pode produzir ${nf(s.possivel)} unidade(s) com o saldo atual${s.criticos > 1 ? ` · ${nf(s.criticos)} itens críticos no serviço` : ''}`, acao: `Antecipar a reposição de ${esc(l.codigo)} (compra local ou remessa extra)` });
  });
  // 2) remessas vencidas (prevista já passou e não chegou): as piores
  rems.filter(r => !r.chegou && r.status === 'vm').sort((a, b) => b.atraso - a.atraso).slice(0, 3).forEach(r => {
    g.push({ nivel: 'vm', score: 90 + Math.min(9, r.atraso / 10), titulo: `${r.nome} vencida há ${nf(r.atraso)} dias`, evidencia: `Prevista ${fdA(r.prev)} · ${nf(r.nItens)} TAG(s)${r.kg ? ` · ${nf(r.kg / 1000, 1)} t` : ''}`,
      efeito: r.principais.length ? `Material pendente: ${esc(r.principais.join(', '))}` : 'Material pendente de chegada', acao: 'Confirmar a chegada ou cobrar o fornecedor; lançar a data real em Remessas' });
  });
  // 3) falta chegar
  const kgPlan = soma0(comPlan, i => i.kgPlan), kgFalta = soma0(comPlan, i => i.kgFalta), semCheg = comPlan.filter(i => i.st === 'NÃO CHEGOU');
  if (comPlan.length && (kgFalta > 0 || semCheg.length)) {
    const pct = kgPlan ? kgFalta / kgPlan : null, topEt = rsGrupo(comPlan, i => i.etapa)[0];
    g.push({ nivel: pct != null && pct > .4 ? 'vm' : 'am', score: pct != null && pct > .4 ? 85 : 50, titulo: `${rsT(kgFalta)} ainda a chegar${pct != null ? ` (${nf(pct * 100, 0)}% do planejado)` : ''}`,
      evidencia: `${nf(semCheg.length)} item(ns) sem nenhuma chegada${topEt ? ` · maior falta em <b>${esc(topEt.nome)}</b> (${rsT(topEt.kgFalta)})` : ''}`, efeito: 'Material de obra ainda não disponível para as próximas frentes', acao: 'Reprogramar com o fornecedor; priorizar pela data de início das atividades' });
  }
  // 4) remessas sem data prevista (risco invisível)
  const semData = rems.filter(r => r.status === 'nd' && !r.chegou);
  if (semData.length) g.push({ nivel: 'am', score: 45, titulo: `${nf(semData.length)} de ${nf(rems.length)} remessas sem data prevista`, evidencia: 'O farol de prazo não consegue ser calculado para elas', efeito: 'Atraso invisível: nada aparece como vencido', acao: 'Preencher a data prevista de chegada em Suprimentos › Remessas' });
  // 5) acuracidade
  if (D.acu.avaliados.length) {
    const med = soma0(D.acu.avaliados, i => i.inv.acuracidade || 0) / D.acu.avaliados.length;
    if (med < .98) { const pior = D.acu.criticos[0] || D.acu.atencao[0]; g.push({ nivel: med < .95 ? 'vm' : 'am', score: med < .95 ? 70 : 40, titulo: `Acuracidade do inventário em ${nf(med * 100, 1)}% (meta 98%)`,
      evidencia: `${nf(D.acu.criticos.length)} crítico(s) · ${nf(D.acu.atencao.length)} em atenção${pior ? ` · pior ${esc(pior.tag)} (${nf(pior.inv.acuracidade * 100, 1)}%)` : ''}`, efeito: 'Saldo virtual pouco confiável para decidir reposição', acao: 'Inventário físico nos itens críticos e conferência das regras de baixa' }); }
  }
  // 6) cobertura de estoque
  const baixaCob = D.cob.filter(i => i.cob != null && i.cob < 1);
  if (baixaCob.length) g.push({ nivel: 'am', score: 60, titulo: `${nf(baixaCob.length)} item(ns) com cobertura menor que 1 semana`, evidencia: baixaCob.slice(0, 4).map(i => `${esc(i.tag)} (${nf(i.cobDias, 0)} d)`).join(' · '), efeito: 'Ruptura prevista em até 7 dias no ritmo de consumo atual', acao: 'Pedido de reposição imediato' });
  // 7) impactos de Suprimentos
  const dias = D.rank ? D.rank.dias : 0;
  if (dias > 0) g.push({ nivel: dias > 5 ? 'vm' : 'am', score: dias > 5 ? 65 : 35, titulo: `Suprimentos já gerou ${nf(dias, dias % 1 ? 1 : 0)} dia(s) útil(eis) de impacto`, evidencia: `${nf(D.impSup.length)} registro(s) no período, incluindo remessas em atraso`, efeito: 'Perda de produção atribuída ao setor', acao: 'Tratar as causas (prazo de pedido, remessas em atraso, material crítico)' });
  return g.sort((a, b) => b.score - a.score);
}
function rsHtmlExecCorpo(D) {
  const { rems, itens } = D;
  const chegadas = rems.filter(r => r.chegou), comPrev = chegadas.filter(r => r.atraso != null), noPrazo = comPrev.filter(r => r.status === 'vd').length;
  const vencidas = rems.filter(r => !r.chegou && r.status === 'vm'), aChegar = rems.filter(r => !r.chegou && r.status === 'az'), semData = rems.filter(r => r.status === 'nd' && !r.chegou);
  const pont = comPrev.length ? noPrazo / comPrev.length : null;
  const comPlan = itens.filter(i => i.plan > 0), pesoPlan = soma0(comPlan, i => i.kgPlan), pesoCh = soma0(comPlan, i => Math.min(i.kgChegou || 0, i.kgPlan || 0));
  const servs = D.cap.filter(s => s.gargalo), travados = servs.filter(s => s.gargalo.nivel === 'vm');
  const med = D.acu.avaliados.length ? soma0(D.acu.avaliados, i => i.inv.acuracidade || 0) / D.acu.avaliados.length : null;
  const dias = D.rank ? D.rank.dias : 0;
  const gar = rsGargalos(D), nCrit = gar.filter(x => x.nivel === 'vm').length;
  const geral = nCrit >= 2 || travados.length ? 'vm' : gar.length ? 'am' : 'vd';
  const card = (rot, val, sub, cls) => `<div class="card ${cls}"><div class="rot">${rot}</div><div class="val">${val}</div><div class="sub">${sub}</div></div>`;
  const cards = [
    card('Pontualidade das remessas', rsPct(pont, 0), `${nf(noPrazo)} de ${nf(comPrev.length)} no prazo`, pont == null ? 'nd' : pont >= .9 ? 'vd' : pont >= .7 ? 'am' : 'vm'),
    card('Material recebido (peso)', pesoPlan ? rsPct(pesoCh / pesoPlan, 0) : '—', `${rsT(pesoCh)} de ${rsT(pesoPlan)}`, pesoPlan ? (pesoCh / pesoPlan >= .9 ? 'vd' : pesoCh / pesoPlan >= .6 ? 'am' : 'vm') : 'nd'),
    card('Remessas vencidas', nf(vencidas.length), vencidas.length ? `maior: ${nf(Math.max(...vencidas.map(r => r.atraso)))} dias` : 'nenhuma', vencidas.length ? 'vm' : 'vd'),
    card('Serviços travados por material', servs.length ? `${nf(travados.length)} de ${nf(servs.length)}` : '—', travados.length ? 'capacidade crítica' : 'nenhum sem capacidade', travados.length ? 'vm' : servs.length ? 'vd' : 'nd'),
    card('Acuracidade do inventário', med == null ? '—' : nf(med * 100, 1) + '%', med == null ? 'sem inventário lançado' : `${nf(D.acu.criticos.length)} crítico(s)`, med == null ? 'nd' : med >= .98 ? 'vd' : med >= .95 ? 'am' : 'vm'),
    card('Impacto de Suprimentos', `${nf(dias, dias % 1 ? 1 : 0)} d.u.`, 'dias úteis na obra', dias > 5 ? 'vm' : dias > 0 ? 'am' : 'vd'),
  ].join('');
  const nivelPill = n => rsFr(n === 'vm' ? 'vm' : n === 'am' ? 'am' : 'vd', n === 'vm' ? 'CRÍTICO' : n === 'am' ? 'ATENÇÃO' : 'OK');
  const linhasG = gar.slice(0, 6).map((x, k) => `<tr><td class="c">${k + 1}</td><td>${nivelPill(x.nivel)}</td><td><b>${esc(x.titulo)}</b></td><td>${x.evidencia}</td><td>${x.efeito}</td><td>${x.acao}</td></tr>`);
  const tabG = `<table class="ex-g"><thead><tr><th>#</th><th>Nível</th><th>Gargalo</th><th>Evidência</th><th>Efeito na obra</th><th>Ação sugerida</th></tr></thead><tbody>${linhasG.join('') || '<tr><td colspan="6" class="vazio">Nenhum gargalo identificado na data de referência.</td></tr>'}</tbody></table>${gar.length > 6 ? `<p class="nota">+ ${nf(gar.length - 6)} ponto(s) menos prioritário(s) no relatório geral.</p>` : ''}`;
  // remessas: barra de faróis + as 4 que pedem atenção
  const cont = { vd: 0, am: 0, vm: 0, az: 0, nd: 0 }; rems.forEach(r => { cont[r.status] = (cont[r.status] || 0) + 1; });
  const tot = Math.max(1, rems.length), seg = (k, cor, rot) => cont[k] ? `<div style="width:${(cont[k] / tot * 100).toFixed(1)}%;background:${cor}" title="${rot}">${cont[k]}</div>` : '';
  const foco = [...vencidas.sort((a, b) => b.atraso - a.atraso), ...aChegar.sort((a, b) => a.prev.localeCompare(b.prev))].slice(0, 4);
  const linhasR = foco.map(r => `<tr><td><b>${esc(r.nome)}</b></td><td>${fdA(r.prev)}</td><td>${rsFr(r.status, r.rotulo)}</td><td class="n">${r.kg != null ? nf(r.kg / 1000, 1) + ' t' : '—'}</td></tr>`);
  const boxRem = `<div class="ex-box"><h3>Remessas — farol (${nf(rems.length)})</h3><div class="ex-pilha">${seg('vd', '#16a34a', 'no prazo')}${seg('am', '#c98a00', 'atraso leve')}${seg('vm', '#dc2626', 'atrasadas / vencidas')}${seg('az', '#2563eb', 'a chegar')}${seg('nd', '#7b8794', 'sem data')}</div>
    <div class="rs-leg"><span>${rsFr('vd', 'NO PRAZO')} ${cont.vd}</span><span>${rsFr('am', 'LEVE')} ${cont.am}</span><span>${rsFr('vm', 'ATRASO/VENCIDA')} ${cont.vm}</span><span>${rsFr('az', 'A CHEGAR')} ${cont.az}</span><span>${rsFr('nd', 'SEM DATA')} ${cont.nd}</span></div>
    ${rsTabela(['Remessa', 'Prevista', 'Situação', 'n:Peso'], linhasR, 'Nenhuma remessa vencida nem a chegar.')}</div>`;
  const linhasC = servs.slice(0, 8).map(s => `<tr><td><b>${esc(s.nome)}</b></td><td class="n"><b>${s.possivel == null ? '—' : nf(s.possivel)}</b></td><td>${esc(s.gargalo.codigo)}</td><td>${rsFr(s.gargalo.nivel === 'verde' ? 'vd' : s.gargalo.nivel, s.gargalo.status)}</td></tr>`);
  const boxCap = `<div class="ex-box"><h3>Capacidade por serviço — o que o saldo sustenta</h3>${rsTabela(['Serviço', 'n:Pode produzir', 'Limitante', 'Situação'], linhasC, 'As regras de baixa desta obra não ligam materiais a serviços.')}</div>`;
  const etapas = rsGrupo(comPlan, i => i.etapa).filter(o => o.kgFalta > 0 || o.falta > 0).slice(0, 5);
  const linhasE = etapas.map(o => { const p = o.kgPlan ? o.kgChegou / o.kgPlan : (o.plan ? o.chegou / o.plan : null); return `<tr><td>${esc(o.nome)}</td><td>${rsBarraPct(p, rsClsPct(p))}</td><td class="n">${rsPct(p, 0)}</td><td class="n">${o.kgFalta ? rsT(o.kgFalta) : '—'}</td></tr>`; });
  const boxFalta = `<div class="ex-box"><h3>Falta chegar × planejado — por etapa</h3>${rsTabela(['Etapa', 'Chegou', 'n:%', 'n:Falta'], linhasE, 'Tudo o que foi planejado já chegou.')}</div>`;
  const crit = [...D.acu.criticos, ...D.acu.atencao].slice(0, 5).map(i => `<tr><td><b>${esc(i.tag)}</b></td><td>${esc(i.produto)}</td><td class="n"><b>${nf(i.inv.acuracidade * 100, 0)}%</b></td><td class="n">${nf(Math.max(0, i.inv.perda_real || 0))}</td></tr>`);
  const boxAcu = `<div class="ex-box"><h3>Itens críticos de inventário — top 5</h3>${rsTabela(['TAG', 'Item', 'n:Acur.', 'n:Perda'], crit, D.acu.avaliados.length ? 'Nenhum item crítico ou em atenção.' : 'Sem inventário físico lançado.')}</div>`;
  return `<p>Situação geral: <span class="ex-sel ${geral}">${geral === 'vm' ? 'CRÍTICA' : geral === 'am' ? 'ATENÇÃO' : 'CONTROLADA'}</span> &nbsp; <span class="nota">${nf(nCrit)} gargalo(s) crítico(s) · ${nf(gar.length - nCrit)} de atenção · posição em ${fdA(D.ref)}</span></p>
    <div class="cards">${cards}</div>
    <h2>Principais gargalos — ordenados pelo efeito na obra</h2>${tabG}
    <div class="ex-grid">${boxRem}${boxCap}${boxFalta}${boxAcu}</div>
    <p class="nota">Versão executiva (1 página). Detalhe completo de remessas, logística, planejado × chegou, acuracidade, maior uso, capacidade e impactos: use o <b>Relatório geral</b>. As ações são sugestões automáticas; prazos e responsáveis ficam com a equipe.</p>`;
}
async function rsHtmlExec() {
  const D = await rsDados();
  if (typeof D.cap === 'string') D.cap = [];
  if (typeof D.cob === 'string') D.cob = [];
  await tplLogosCarregar();
  return tplDocumento({ titulo: 'Suprimentos — Painel de gargalos', subtitulo: `Relatório executivo · posição em ${fdA(D.ref)}`, meta: 'Saúde do suprimento · gargalos por prioridade · remessas · capacidade · falta chegar · acuracidade', corpo: rsTry('executivo', () => rsHtmlExecCorpo(D)), css: RS_CSS + RS_CSS_EXEC });
}
let RS_GERANDO = false;
async function rsGerar(btn, filtro) {
  if (RS_GERANDO) return;
  RS_GERANDO = true;
  const exec = !filtro;
  const rot = btn && btn.textContent;
  if (btn) { btn.disabled = true; btn.textContent = 'Gerando relatório…'; }
  try {
    const html = exec ? await rsHtmlExec() : await rsHtml(filtro);
    reAbrirPrevia(html, `Relatorio-Suprimentos-${exec ? 'executivo' : 'geral'}-${ref}.html`, exec ? 'Relatório executivo de Suprimentos' : 'Relatório geral de Suprimentos');
  } catch (e) {
    console.error('Relatório de Suprimentos', e);
    toast('Não foi possível gerar o relatório de Suprimentos: ' + (e && e.message || e), true, 6000);
  } finally { RS_GERANDO = false; if (btn) { btn.disabled = false; btn.textContent = rot; } }
}
// executivo gera direto; o geral abre antes a janela para escolher o que entra (seções, local e tipo)
async function rsAbrir(btn) {
  if (RS_GERANDO) return;
  if (btn && btn.dataset.relSuprim === 'exec') return rsGerar(btn, null);
  if (!EP) { try { const j = await fetch(API + 'estoque-planilha', { cache: 'no-store' }).then(r => r.ok ? r.json() : null); if (j) EP = j; } catch (e) { /* abaixo */ } }
  if (!EP) return toast('Os dados de Suprimentos ainda não foram carregados. Abra uma aba de Suprimentos e tente de novo.', true);
  rsFiltroAbrir();
}
document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('[data-rel-suprim]'); if (b) rsAbrir(b); });
