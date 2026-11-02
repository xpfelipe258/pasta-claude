<?php
// Folha de pagamento da obra: custo mensal de cada colaborador (salário + encargos + provisões + benefícios).
//
// PREMISSAS (estimativa gerencial — o fechamento oficial é do contador/DP; tudo abaixo é editável em Contas a pagar › Parâmetros da folha):
//  • Regime de competência: o custo do mês inclui as provisões de 13º, férias + 1/3 e rescisão (não é o caixa do mês).
//  • Grupo A (sobre a remuneração bruta): INSS patronal 20% + RAT (3% = grau de risco 3 da construção civil × FAP) + terceiros 5,8%
//    (salário-educação 2,5 + INCRA 0,2 + SESI 1,5 + SENAI 1,0 + SEBRAE 0,6) + FGTS 8%.
//  • Provisões: 13º (1/12), férias + 1/3 (1/12 × 4/3), incidência do Grupo A sobre as duas, multa de 40% do FGTS e aviso prévio (1/12),
//    ambos × a rotatividade (100% = todos os contratos terminam quando a obra acaba).
//  • Autônomo, PJ e estagiário: sem encargos (custo = valor combinado + benefícios informados). Jovem aprendiz: FGTS de 2%.
//  • Horista: valor da hora × horas do mês (220 já inclui o descanso semanal remunerado).
//  • Adicionais: insalubridade sobre o salário mínimo (10/20/40%) ou periculosidade de 30% sobre o salário base.
//  • Vale-transporte: a empresa paga o valor que passa de 6% do salário base.
//  • Regime CPRB (desoneração): o INSS patronal de 20% sai da folha; a contribuição sobre a receita vira uma conta de Imposto (% sobre o faturamento).

const RH_SEM_ENCARGOS = ['Autônomo', 'PJ', 'Estágio'];

function rh_params_padrao()
{
    return [
        'regime' => 'normal',        // normal | cprb
        'salario_minimo' => 1621.00, // confirmar o valor vigente
        'horas_mes' => 220,
        'inss_patronal' => 20.0,
        'rat' => 3.0,
        'fap' => 1.0,
        'terceiros' => 5.8,
        'fgts' => 8.0,
        'multa_fgts' => 40.0,
        'rotatividade' => 100.0,
        'aviso_previo' => 1,         // 1 = provisiona o aviso prévio indenizado
        'vt_desconto' => 6.0,
        'seguro_vida' => 0.0,        // R$ por colaborador/mês (CCT)
        'epi_uniforme' => 0.0,       // R$ por colaborador/mês
    ];
}

function rh_params_rotulos()
{
    return [
        'regime' => ['Regime da folha', 'sel:normal=Normal (INSS patronal 20%)|cprb=CPRB / desonerada (sem o INSS patronal)'],
        'salario_minimo' => ['Salário mínimo (R$) — base da insalubridade', 'moeda'],
        'horas_mes' => ['Horas por mês do horista', 'num'],
        'inss_patronal' => ['INSS patronal (%)', 'perc'],
        'rat' => ['RAT / SAT (%) — risco da atividade', 'perc'],
        'fap' => ['FAP (multiplicador do RAT)', 'num'],
        'terceiros' => ['Terceiros / Sistema S (%)', 'perc'],
        'fgts' => ['FGTS (%)', 'perc'],
        'multa_fgts' => ['Multa rescisória sobre o FGTS (%)', 'perc'],
        'rotatividade' => ['Rotatividade provisionada (%)', 'perc'],
        'aviso_previo' => ['Provisionar aviso prévio indenizado', 'sel:1=Sim|0=Não'],
        'vt_desconto' => ['Desconto de vale-transporte do empregado (%)', 'perc'],
        'seguro_vida' => ['Seguro de vida em grupo (R$/colaborador/mês)', 'moeda'],
        'epi_uniforme' => ['EPI, uniforme e ferramentas (R$/colaborador/mês)', 'moeda'],
    ];
}

function rh_obra_params_id()
{
    return qualidade_obra_id();   // a mesma obra do cadastro de colaboradores (sesmt_obra_id)
}

/** Parâmetros em vigor (guardados na obra principal, onde moram os colaboradores). $recarregar = true descarta o cache da requisição. */
function rh_params($recarregar = false)
{
    static $cache = [];
    $obra = rh_obra_params_id();
    if ($recarregar) {
        unset($cache[$obra]);
    }
    if (!isset($cache[$obra])) {
        $salvo = json_decode((string)q_global("SELECT valor FROM obra_config WHERE obra_id = ? AND chave = 'rh_parametros'", [$obra])->fetchColumn(), true);
        $p = rh_params_padrao();
        if (is_array($salvo)) {
            foreach ($p as $k => $v) {
                if ($k === 'regime') {
                    if (isset($salvo[$k]) && in_array($salvo[$k], ['normal', 'cprb'], true)) {
                        $p[$k] = $salvo[$k];
                    }
                } elseif (isset($salvo[$k]) && is_numeric($salvo[$k])) {
                    $p[$k] = (float)$salvo[$k];
                }
            }
        }
        $cache[$obra] = $p;
    }
    return $cache[$obra];
}

function rh_params_salvar(array $entrada)
{
    $p = rh_params_padrao();
    $erros = [];
    $rot = rh_params_rotulos();
    foreach ($p as $k => $padrao) {
        if (!array_key_exists($k, $entrada)) {
            continue;
        }
        if ($k === 'regime') {
            if (!in_array($entrada[$k], ['normal', 'cprb'], true)) {
                $erros[] = 'Regime da folha inválido.';
            } else {
                $p[$k] = $entrada[$k];
            }
            continue;
        }
        $n = numero($entrada[$k]);
        if ($n === null || $n < 0) {
            $erros[] = $rot[$k][0] . ': informe um número igual ou maior que zero.';
            continue;
        }
        if (($rot[$k][1] === 'perc' || $k === 'fap') && $n > ($k === 'fap' ? 5 : 100)) {
            $erros[] = $rot[$k][0] . ': valor fora do limite.';
            continue;
        }
        $p[$k] = round((float)$n, 4);
    }
    if ($p['horas_mes'] < 1 || $p['horas_mes'] > 300) {
        $erros[] = 'Horas por mês do horista: use um valor entre 1 e 300.';
    }
    if ($erros) {
        return [null, $erros];
    }
    $obra = rh_obra_params_id();
    q_global("DELETE FROM obra_config WHERE obra_id = ? AND chave = 'rh_parametros'", [$obra]);
    q_global("INSERT INTO obra_config (obra_id, chave, valor) VALUES (?, 'rh_parametros', ?)", [$obra, json_encode($p)]);
    return [rh_params(true), []];
}

/** Quem enxerga salários e custos da folha: administrador, administrador da obra e quem tem a área Financeiro. */
function rh_pode_ver_salarios($u = null)
{
    $u = $u ?: usuario_atual();
    return $u && usuario_pode_modulo($u, 'financeiro');
}

function rh_vinculo(array $c)
{
    $s = (string)($c['status'] ?? '');
    if (in_array($s, RH_SEM_ENCARGOS, true)) {
        return 'sem_encargos';
    }
    return $s === 'Jovem aprendiz' ? 'aprendiz' : 'clt';
}

function rh_rotulo_vinculo($v)
{
    return ['clt' => 'CLT', 'aprendiz' => 'Jovem aprendiz', 'sem_encargos' => 'Sem encargos (autônomo / PJ / estágio)'][$v] ?? $v;
}

/** Fração do mês (0 a 1) em que o colaborador está na folha; $ym = 'AAAA-MM' (null = mês cheio). */
function rh_fracao_mes(array $c, $ym)
{
    if ($ym === null) {
        return ($c['status'] ?? '') === 'Demitido' && empty($c['desligamento']) ? 0.0 : 1.0;
    }
    if (!preg_match('/^\d{4}-(0[1-9]|1[0-2])$/', $ym)) {
        return 0.0;
    }
    $ini = $ym . '-01';
    $dias = (int)date('t', strtotime($ini));
    $fim = $ym . '-' . sprintf('%02d', $dias);
    if (($c['status'] ?? '') === 'Demitido' && empty($c['desligamento'])) {
        return 0.0;
    }
    $de = !empty($c['admissao']) && $c['admissao'] > $ini ? $c['admissao'] : $ini;
    $ate = !empty($c['desligamento']) && $c['desligamento'] < $fim ? $c['desligamento'] : $fim;
    if ($de > $ate) {
        return 0.0;
    }
    $n = (int)round((strtotime($ate) - strtotime($de)) / 86400) + 1;
    return min(1.0, $n / $dias);
}

function rh_r($v)
{
    return round((float)$v + 1e-9, 2);
}

/**
 * Custo mensal de um colaborador. Devolve as linhas (com grupo: remuneracao | encargos | provisoes | beneficios), os totais e o fator
 * (custo ÷ remuneração bruta). Sem salário informado: sem_salario = true e custo zero.
 */
function rh_custo_colaborador(array $c, array $p, $ym = null)
{
    $fr = rh_fracao_mes($c, $ym);
    $vinc = rh_vinculo($c);
    $sal = numero($c['salario'] ?? null);
    $out = ['fracao' => $fr, 'ativo' => $fr > 0, 'vinculo' => $vinc, 'sem_salario' => $sal === null || $sal <= 0, 'linhas' => [],
        'base' => 0.0, 'adicional' => 0.0, 'bruto' => 0.0, 'remuneracao' => 0.0, 'encargos' => 0.0, 'provisoes' => 0.0, 'beneficios' => 0.0, 'total' => 0.0, 'fator' => 0.0, 'fator_enc' => 0.0];
    if ($out['sem_salario'] || $fr <= 0) {
        return $out;
    }
    $base = ($c['tipo_salario'] ?? 'Mensal') === 'Hora' ? $sal * $p['horas_mes'] : (float)$sal;
    $adic = 0.0;
    $at = (string)($c['adicional'] ?? '');
    if (preg_match('/^Insalubridade (\d+)%$/u', $at, $m)) {
        $adic = $p['salario_minimo'] * (int)$m[1] / 100;
    } elseif (preg_match('/^Periculosidade (\d+)%$/u', $at, $m)) {
        $adic = $base * (int)$m[1] / 100;
    }
    $bruto = $base + $adic;
    $L = [];
    $add = function ($grupo, $chave, $rotulo, $valor, $nota = '') use (&$L, $fr) {
        $v = rh_r($valor * $fr);
        if ($v != 0.0) {
            $L[] = ['grupo' => $grupo, 'chave' => $chave, 'rotulo' => $rotulo, 'valor' => $v, 'nota' => $nota];
        }
    };
    $add('remuneracao', 'salario', ($c['tipo_salario'] ?? 'Mensal') === 'Hora' ? 'Salário (valor da hora × ' . rtrim(rtrim(number_format($p['horas_mes'], 2, ',', ''), '0'), ',') . ' h)' : 'Salário base', $base);
    $add('remuneracao', 'adicional', 'Adicional (' . $at . ')', $adic);
    if ($vinc !== 'sem_encargos') {
        $inss = $p['regime'] === 'cprb' ? 0.0 : $p['inss_patronal'];
        $rat = $p['rat'] * $p['fap'];
        $fgts = $vinc === 'aprendiz' ? 2.0 : $p['fgts'];
        $grupoA = ($inss + $rat + $p['terceiros'] + $fgts) / 100;
        $add('encargos', 'inss', 'INSS patronal (' . rh_pct($inss) . ')', $bruto * $inss / 100);
        $add('encargos', 'rat', 'RAT/SAT × FAP (' . rh_pct($rat) . ')', $bruto * $rat / 100);
        $add('encargos', 'terceiros', 'Terceiros / Sistema S (' . rh_pct($p['terceiros']) . ')', $bruto * $p['terceiros'] / 100);
        $add('encargos', 'fgts', 'FGTS (' . rh_pct($fgts) . ')', $bruto * $fgts / 100);
        $p13 = $bruto / 12;
        $pfe = $bruto / 12 * 4 / 3;
        $add('provisoes', 'p13', 'Provisão de 13º salário (1/12)', $p13);
        $add('provisoes', 'pferias', 'Provisão de férias + 1/3', $pfe);
        $add('provisoes', 'pincid', 'Encargos sobre 13º e férias (' . rh_pct($grupoA * 100) . ')', ($p13 + $pfe) * $grupoA);
        $rot = $p['rotatividade'] / 100;
        $add('provisoes', 'pmulta', 'Provisão da multa de ' . rh_pct($p['multa_fgts']) . ' do FGTS (rotatividade ' . rh_pct($p['rotatividade']) . ')', ($bruto + $p13 + $pfe) * $fgts / 100 * $p['multa_fgts'] / 100 * $rot);
        if ($p['aviso_previo']) {
            $add('provisoes', 'paviso', 'Provisão de aviso prévio (1/12 × rotatividade)', $bruto / 12 * $rot);
        }
    }
    $vt = max(0.0, (float)numero($c['vale_transporte'] ?? 0) - $base * $p['vt_desconto'] / 100);
    $add('beneficios', 'vt', 'Vale-transporte (parte da empresa)', $vt);
    $add('beneficios', 'alimentacao', 'Alimentação / refeição', (float)numero($c['alimentacao'] ?? 0));
    $add('beneficios', 'outros', 'Outros benefícios', (float)numero($c['outros_beneficios'] ?? 0));
    $add('beneficios', 'seguro', 'Seguro de vida em grupo', $p['seguro_vida']);
    $add('beneficios', 'epi', 'EPI, uniforme e ferramentas', $p['epi_uniforme']);
    foreach ($L as $l) {
        $out[$l['grupo']] = ($out[$l['grupo']] ?? 0.0) + $l['valor'];
        $out['total'] += $l['valor'];
    }
    foreach (['remuneracao', 'encargos', 'provisoes', 'beneficios', 'total'] as $g) {
        $out[$g] = rh_r($out[$g]);
    }
    $out['linhas'] = $L;
    $out['base'] = rh_r($base * $fr);
    $out['adicional'] = rh_r($adic * $fr);
    $out['bruto'] = rh_r($bruto * $fr);
    $out['fator'] = $out['bruto'] > 0 ? round($out['total'] / $out['bruto'], 4) : 0.0;
    $out['fator_enc'] = $out['bruto'] > 0 ? round(($out['encargos'] + $out['provisoes']) / $out['bruto'], 4) : 0.0;   // só encargos + provisões, sem benefícios
    return $out;
}

function rh_pct($v)
{
    return rtrim(rtrim(number_format((float)$v, 2, ',', ''), '0'), ',') . '%';
}

/** Colaboradores da obra com o custo do mês ($ym = 'AAAA-MM'). Usuário de empresa vê só os da própria empresa. */
function rh_folha_mes($ym, array $p = null)
{
    static $linhas = [];
    require_once __DIR__ . '/sesmt_modelo.php';
    $p = $p ?: rh_params();
    sesmt_garantir_esquema();
    $chave = sesmt_obra_id() . '|' . sesmt_escopo_empresa();
    if (!isset($linhas[$chave])) {
        $params = [sesmt_obra_id()];
        $sql = 'SELECT * FROM sesmt_colaboradores WHERE obra_id = ?';
        if (($esc = sesmt_escopo_empresa()) !== '') {
            $sql .= ' AND UPPER(TRIM(empresa)) = ?';
            $params[] = $esc;
        }
        $linhas[$chave] = q_global($sql . ' ORDER BY empresa, nome', $params)->fetchAll();
    }
    $zero = ['n' => 0, 'remuneracao' => 0.0, 'encargos' => 0.0, 'provisoes' => 0.0, 'beneficios' => 0.0, 'total' => 0.0];
    $f = $zero + ['mes' => $ym, 'sem_salario' => 0, 'colaboradores' => [], 'por_empresa' => [], 'sem_salario_nomes' => []];
    foreach ($linhas[$chave] as $c) {
        $k = rh_custo_colaborador($c, $p, $ym);
        if (!$k['ativo']) {
            continue;
        }
        $emp = trim((string)$c['empresa']) !== '' ? mb_strtoupper(trim($c['empresa']), 'UTF-8') : 'SEM EMPRESA';
        if (!isset($f['por_empresa'][$emp])) {
            $f['por_empresa'][$emp] = $zero;
        }
        $f['n']++;
        $f['por_empresa'][$emp]['n']++;
        if ($k['sem_salario']) {
            $f['sem_salario']++;
            $f['sem_salario_nomes'][] = $c['nome'];
        }
        foreach (['remuneracao', 'encargos', 'provisoes', 'beneficios', 'total'] as $g) {
            $f[$g] += $k[$g];
            $f['por_empresa'][$emp][$g] += $k[$g];
        }
        $f['colaboradores'][] = ['id' => (int)$c['id'], 'nome' => $c['nome'], 'empresa' => $c['empresa'], 'funcao' => $c['funcao'], 'status' => $c['status'],
            'vinculo' => rh_rotulo_vinculo($k['vinculo']), 'sem_salario' => $k['sem_salario'], 'fracao' => round($k['fracao'], 4),
            'bruto' => $k['bruto'], 'encargos' => $k['encargos'], 'provisoes' => $k['provisoes'], 'beneficios' => $k['beneficios'], 'total' => $k['total'], 'fator' => $k['fator']];
    }
    foreach (['remuneracao', 'encargos', 'provisoes', 'beneficios', 'total'] as $g) {
        $f[$g] = rh_r($f[$g]);
        foreach ($f['por_empresa'] as $e => $_) {
            $f['por_empresa'][$e][$g] = rh_r($f['por_empresa'][$e][$g]);
        }
    }
    return $f;
}
