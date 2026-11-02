<?php
// Financeiro › Contas a pagar da obra. Três tipos de conta:
//  • IMPOSTO — percentual (informado no cadastro) sobre o valor a faturar da Medição (BM) do mês; o valor é calculado na tela com a mesma conta do BM.
//  • FOLHA   — puxa o custo mensal de todos os colaboradores cadastrados em Gestão › Pessoal (salário + encargos + provisões + benefícios; ver rh_custos.php).
//  • OUTROS  — valor fixo (aluguel, seguro, fornecedor, taxa…), mensal ou único.
// Cada conta é uma regra (recorrente ou única); o pagamento de cada mês é registrado em contas_pagar_baixas.
// As tabelas ficam fora de tabelas_spec() de propósito: o modelo que todo usuário recebe não pode levar salários nem valores a pagar.

function contas_pagar_sql($pk, $longo, $fim)
{
    return "CREATE TABLE IF NOT EXISTS contas_pagar (id $pk, obra_id INT NOT NULL, tipo VARCHAR(10) NOT NULL, descricao VARCHAR(160) NOT NULL,
        categoria VARCHAR(60) NULL, empresa VARCHAR(100) NULL, percentual DOUBLE NULL, valor DOUBLE NULL, base_folha VARCHAR(10) NULL,
        recorrencia VARCHAR(10) NOT NULL DEFAULT 'MENSAL', comp_inicio VARCHAR(7) NOT NULL, comp_fim VARCHAR(7) NULL,
        dia_venc INT NOT NULL DEFAULT 10, venc_mes_seguinte INT NOT NULL DEFAULT 1, ativo INT NOT NULL DEFAULT 1,
        obs $longo NULL, criado_por VARCHAR(100) NULL, criado_em VARCHAR(19) NULL, atualizado_em VARCHAR(19) NULL)$fim";
}

function contas_pagar_baixas_sql($pk, $fim)
{
    return "CREATE TABLE IF NOT EXISTS contas_pagar_baixas (id $pk, obra_id INT NOT NULL, conta_id INT NOT NULL, competencia VARCHAR(7) NOT NULL,
        valor_pago DOUBLE NOT NULL DEFAULT 0, data_pagamento DATE NULL, obs VARCHAR(255) NULL, por VARCHAR(100) NULL, em VARCHAR(19) NULL,
        UNIQUE (conta_id, competencia))$fim";
}

function cp_tipos()
{
    return ['IMPOSTO' => 'Imposto', 'FOLHA' => 'Folha salarial', 'OUTROS' => 'Outros'];
}

function cp_mes_valido($ym)
{
    return is_string($ym) && preg_match('/^\d{4}-(0[1-9]|1[0-2])$/', $ym) === 1;
}

function cp_ler_dados($mes)
{
    $contas = q('SELECT * FROM contas_pagar ORDER BY tipo, descricao, id')->fetchAll();
    foreach ($contas as &$c) {
        $c['id'] = (int)$c['id'];
        $c['percentual'] = $c['percentual'] === null ? null : (float)$c['percentual'];
        $c['valor'] = $c['valor'] === null ? null : (float)$c['valor'];
        $c['dia_venc'] = (int)$c['dia_venc'];
        $c['venc_mes_seguinte'] = (int)$c['venc_mes_seguinte'];
        $c['ativo'] = (int)$c['ativo'];
        unset($c['obra_id']);
    }
    unset($c);
    $baixas = q('SELECT * FROM contas_pagar_baixas ORDER BY competencia, id')->fetchAll();
    foreach ($baixas as &$b) {
        $b['id'] = (int)$b['id'];
        $b['conta_id'] = (int)$b['conta_id'];
        $b['valor_pago'] = (float)$b['valor_pago'];
        unset($b['obra_id']);
    }
    unset($b);
    $p = rh_params();
    // folha de uma janela de meses (resumo) + a lista de colaboradores do mês aberto. Tudo calculado no servidor (salário não vai para o modelo geral).
    $folha = [];
    $ini = new DateTimeImmutable($mes . '-01', new DateTimeZone('America/Sao_Paulo'));
    for ($i = -2; $i <= 9; $i++) {
        $ym = $ini->modify(($i >= 0 ? '+' : '') . $i . ' month')->format('Y-m');
        $f = rh_folha_mes($ym, $p);
        $resumo = $f;
        unset($resumo['colaboradores'], $resumo['sem_salario_nomes']);
        if ($ym === $mes) {
            $resumo['colaboradores'] = $f['colaboradores'];
            $resumo['sem_salario_nomes'] = $f['sem_salario_nomes'];
        }
        $folha[$ym] = $resumo;
    }
    $sesmtEmpresas = array_values(array_unique(array_filter(array_map(function ($c) { return $c['empresa']; }, $folha[$mes]['colaboradores'] ?? []))));
    return ['mes' => $mes, 'contas' => $contas, 'baixas' => $baixas, 'folha' => $folha, 'parametros' => $p, 'parametros_padrao' => rh_params_padrao(),
        'parametros_rotulos' => rh_params_rotulos(), 'empresas_folha' => $sesmtEmpresas, 'hoje' => (new DateTimeImmutable('now', new DateTimeZone('America/Sao_Paulo')))->format('Y-m-d')];
}

function cp_conta_dados(array $c, $idAtual)
{
    $erros = [];
    $tipo = strtoupper(trim((string)($c['tipo'] ?? '')));
    if (!isset(cp_tipos()[$tipo])) {
        $erros[] = 'Escolha o tipo da conta: imposto, folha salarial ou outros.';
    }
    $desc = trim((string)($c['descricao'] ?? ''));
    if ($desc === '' && $tipo === 'FOLHA') {
        $desc = 'Folha salarial';
    }
    if ($desc === '' || mb_strlen($desc, 'UTF-8') > 160) {
        $erros[] = 'Informe a descrição da conta (até 160 caracteres).';
    }
    $categoria = trim((string)($c['categoria'] ?? ''));
    $empresa = trim((string)($c['empresa'] ?? ''));
    if ($empresa !== '' && function_exists('sesmt_norm_empresa')) {
        $empresa = sesmt_norm_empresa($empresa);
    }
    $perc = null;
    $valor = null;
    $baseFolha = null;
    if ($tipo === 'IMPOSTO') {
        $perc = numero($c['percentual'] ?? null);
        if ($perc === null || $perc <= 0 || $perc > 100) {
            $erros[] = 'Imposto: informe o percentual (entre 0,01% e 100%) que incide sobre o valor a faturar do mês.';
        } else {
            $perc = round((float)$perc, 4);
        }
    } elseif ($tipo === 'OUTROS') {
        $valor = numero($c['valor'] ?? null);
        if ($valor === null || $valor <= 0) {
            $erros[] = 'Informe o valor da conta (maior que zero).';
        } else {
            $valor = round((float)$valor, 2);
        }
    } elseif ($tipo === 'FOLHA') {
        $baseFolha = ($c['base_folha'] ?? 'total') === 'caixa' ? 'caixa' : 'total';
    }
    $rec = strtoupper(trim((string)($c['recorrencia'] ?? 'MENSAL')));
    if (!in_array($rec, ['MENSAL', 'UNICA'], true)) {
        $erros[] = 'Recorrência inválida.';
    }
    if ($tipo === 'IMPOSTO' || $tipo === 'FOLHA') {
        $rec = 'MENSAL';   // são sempre mensais
    }
    $ci = (string)($c['comp_inicio'] ?? '');
    $cf = trim((string)($c['comp_fim'] ?? ''));
    if (!cp_mes_valido($ci)) {
        $erros[] = 'Informe o mês de início (competência).';
    }
    if ($rec === 'UNICA') {
        $cf = $ci;
    } elseif ($cf !== '' && !cp_mes_valido($cf)) {
        $erros[] = 'Mês final inválido.';
    } elseif ($cf !== '' && cp_mes_valido($ci) && $cf < $ci) {
        $erros[] = 'O mês final não pode ser anterior ao mês de início.';
    }
    $dia = (int)($c['dia_venc'] ?? 10);
    if ($dia < 1 || $dia > 31) {
        $erros[] = 'Dia de vencimento: use um número de 1 a 31.';
    }
    if ($tipo === 'FOLHA' && !$erros) {   // uma folha só por empresa (ou uma geral): duas folhas somariam os mesmos colaboradores duas vezes
        foreach (q("SELECT id, empresa FROM contas_pagar WHERE tipo = 'FOLHA' AND ativo = 1 AND id <> ?", [(int)$idAtual])->fetchAll() as $o) {
            $oe = trim((string)$o['empresa']);
            if ($oe === '' || $empresa === '' || mb_strtoupper($oe, 'UTF-8') === mb_strtoupper($empresa, 'UTF-8')) {
                $erros[] = 'Já existe uma conta de folha salarial que cobre ' . ($empresa === '' || $oe === '' ? 'estes colaboradores' : $empresa) . '. Edite a existente (ou use uma folha por empresa).';
                break;
            }
        }
    }
    $dados = ['tipo' => $tipo, 'descricao' => $desc, 'categoria' => $categoria !== '' ? mb_substr($categoria, 0, 60, 'UTF-8') : null,
        'empresa' => $empresa !== '' ? $empresa : null, 'percentual' => $perc, 'valor' => $valor, 'base_folha' => $baseFolha, 'recorrencia' => $rec,
        'comp_inicio' => $ci, 'comp_fim' => $cf !== '' ? $cf : null, 'dia_venc' => $dia,
        'venc_mes_seguinte' => !empty($c['venc_mes_seguinte']) ? 1 : 0, 'ativo' => array_key_exists('ativo', $c) ? (empty($c['ativo']) ? 0 : 1) : 1,
        'obs' => texto_ou_nulo($c['obs'] ?? null)];
    return [$dados, $erros];
}

function acao_contas_pagar(array $corpo, array $usuario)
{
    if (!usuario_pode_modulo($usuario, 'financeiro')) {
        throw new ErroValidacao('Seu usuário não possui acesso ao módulo FINANCEIRO.');
    }
    if (($usuario['perfil'] ?? '') === 'leitura') {
        throw new ErroValidacao('Seu usuário é somente leitura.');
    }
    $acao = (string)($corpo['acao'] ?? '');
    $agora = (new DateTimeImmutable('now', new DateTimeZone('America/Sao_Paulo')))->format('Y-m-d H:i:s');
    $mes = cp_mes_valido($corpo['mes'] ?? '') ? $corpo['mes'] : (new DateTimeImmutable('now', new DateTimeZone('America/Sao_Paulo')))->format('Y-m');
    if ($acao === 'salvar') {
        $id = (int)($corpo['id'] ?? 0);
        if ($id && !q('SELECT id FROM contas_pagar WHERE id = ?', [$id])->fetch()) {
            throw new ErroValidacao('Conta não encontrada. Recarregue a tela.');
        }
        list($d, $erros) = cp_conta_dados($corpo, $id);
        if ($erros) {
            throw new ErroValidacao(implode(' ', $erros));
        }
        if ($id) {
            $sets = [];
            $p = [];
            foreach ($d as $k => $v) {
                $sets[] = "$k = ?";
                $p[] = $v;
            }
            $sets[] = 'atualizado_em = ?';
            $p[] = $agora;
            $p[] = $id;
            q('UPDATE contas_pagar SET ' . implode(', ', $sets) . ' WHERE id = ?', $p);
        } else {
            $cols = array_keys($d);
            q('INSERT INTO contas_pagar (' . implode(', ', $cols) . ', criado_por, criado_em, atualizado_em) VALUES (' . implode(', ', array_fill(0, count($cols) + 3, '?')) . ')',
                array_merge(array_values($d), [$usuario['nome'], $agora, $agora]));
            $id = (int)bd()->lastInsertId();
        }
        registrar_global($corpo['id'] ?? false ? 'conta_pagar_salvar' : 'conta_pagar_criar', ['id' => $id, 'tipo' => $d['tipo'], 'obra' => obra_atual_id()]);
        return cp_ler_dados($mes);
    }
    if ($acao === 'excluir') {
        $id = (int)($corpo['id'] ?? 0);
        if (!q('SELECT id FROM contas_pagar WHERE id = ?', [$id])->fetch()) {
            throw new ErroValidacao('Conta não encontrada. Recarregue a tela.');
        }
        q('DELETE FROM contas_pagar_baixas WHERE conta_id = ?', [$id]);
        q('DELETE FROM contas_pagar WHERE id = ?', [$id]);
        registrar_global('conta_pagar_excluir', ['id' => $id, 'obra' => obra_atual_id()]);
        return cp_ler_dados($mes);
    }
    if ($acao === 'baixar' || $acao === 'desfazer') {
        $id = (int)($corpo['conta_id'] ?? 0);
        $conta = q('SELECT * FROM contas_pagar WHERE id = ?', [$id])->fetch();
        $comp = (string)($corpo['competencia'] ?? '');
        if (!$conta || !cp_mes_valido($comp)) {
            throw new ErroValidacao('Conta ou competência inválida.');
        }
        if ($comp < $conta['comp_inicio'] || ($conta['comp_fim'] && $comp > $conta['comp_fim'])) {
            throw new ErroValidacao('Este mês está fora do período da conta.');
        }
        if ($acao === 'desfazer') {
            q('DELETE FROM contas_pagar_baixas WHERE conta_id = ? AND competencia = ?', [$id, $comp]);
            registrar_global('conta_pagar_desfazer', ['id' => $id, 'competencia' => $comp]);
            return cp_ler_dados($mes);
        }
        $valor = numero($corpo['valor_pago'] ?? null);
        if ($valor === null || $valor < 0) {
            throw new ErroValidacao('Informe o valor pago (zero ou maior).');
        }
        $data = (string)($corpo['data_pagamento'] ?? '');
        if (!data_valida($data)) {
            throw new ErroValidacao('Informe a data do pagamento.');
        }
        if ($data > (new DateTimeImmutable('now', new DateTimeZone('America/Sao_Paulo')))->format('Y-m-d')) {
            throw new ErroValidacao('A data do pagamento não pode estar no futuro.');
        }
        q('DELETE FROM contas_pagar_baixas WHERE conta_id = ? AND competencia = ?', [$id, $comp]);
        q('INSERT INTO contas_pagar_baixas (conta_id, competencia, valor_pago, data_pagamento, obs, por, em) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [$id, $comp, round((float)$valor, 2), $data, texto_ou_nulo(mb_substr((string)($corpo['obs'] ?? ''), 0, 255, 'UTF-8')), $usuario['nome'], $agora]);
        registrar_global('conta_pagar_baixa', ['id' => $id, 'competencia' => $comp, 'valor' => round((float)$valor, 2)]);
        return cp_ler_dados($mes);
    }
    if ($acao === 'parametros') {
        list($p, $erros) = rh_params_salvar(is_array($corpo['parametros'] ?? null) ? $corpo['parametros'] : []);
        if ($erros) {
            throw new ErroValidacao(implode(' ', $erros));
        }
        registrar_global('rh_parametros', ['obra' => rh_obra_params_id()]);
        return cp_ler_dados($mes);
    }
    throw new ErroValidacao('Ação inválida.');
}
