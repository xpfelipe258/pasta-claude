<?php
// Empresas da obra e catálogo de serviços: cadastra uma empresa nova (no início da obra ou com a obra em andamento),
// as colunas de produção (serviços) dela e o catálogo de atividades da medição (BM). Tudo é gravado na obra aberta.
// Usado pela Administração (admin.php › "Empresas e catálogo de serviços").

require_once __DIR__ . '/leitura_util.php';
require_once __DIR__ . '/leitura_docs.php';

/** Letra da coluna de produção do serviço de número $i (0 = B, 1 = C … a coluna A fica livre, como nas demais obras). */
function eo_coluna($i)
{
    $n = $i + 1;
    $s = '';
    do {
        $s = chr(65 + $n % 26) . $s;
        $n = intdiv($n, 26) - 1;
    } while ($n >= 0);
    return $s;
}

/** Número digitado em pt-BR: 2.000 = dois mil, 1.234,56 = mil duzentos e trinta e quatro vírgula cinquenta e seis, 2,5 = dois e meio. */
function eo_numero($v)
{
    $t = trim((string)$v);
    if ($t === '') { return null; }
    if (strpos($t, ',') !== false) { return numero(str_replace('.', '', $t)); }
    if (preg_match('/^\d{1,3}(\.\d{3})+$/', $t)) { return numero(str_replace('.', '', $t)); }
    return numero($t);
}

function eo_maiusculas($t)
{
    return mb_strtoupper(trim((string)$t), 'UTF-8');
}

/** Valida e normaliza o nome da empresa (sigla que aparece nas abas, no BM e nos relatórios). */
function eo_nome_valido($nome)
{
    $nome = preg_replace('/\s+/u', ' ', eo_maiusculas($nome));
    if (mb_strlen($nome) < 2 || mb_strlen($nome) > 30 || !preg_match('/^[\p{L}\p{N} .\-\/&]+$/u', $nome)) {
        throw new InvalidArgumentException('Informe o nome da empresa (2 a 30 caracteres: letras, números, espaço, ponto, hífen, barra ou &).');
    }
    foreach (q('SELECT nome, aba FROM empresas')->fetchAll() as $e) {
        if (eo_maiusculas($e['nome']) === $nome || eo_maiusculas($e['aba']) === $nome) {
            throw new InvalidArgumentException('Já existe uma empresa com o nome ' . $nome . ' nesta obra.');
        }
    }
    return $nome;
}

/** Prefixo dos códigos do catálogo (ex.: GLO → GLO-3.1.1-01). Sem informar, vem do nome da empresa. */
function eo_prefixo($prefixo, $nome)
{
    $p = eo_maiusculas($prefixo);
    if ($p === '') {
        $p = eo_maiusculas(preg_replace('/[^\p{L}\p{N}]+/u', '', iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $nome) ?: $nome));
        $p = mb_substr($p, 0, 6);
    }
    if (!preg_match('/^[A-Z0-9]{2,10}$/', $p)) {
        throw new InvalidArgumentException('O prefixo dos códigos deve ter de 2 a 10 letras ou números (sem acento nem espaço).');
    }
    return $p;
}

function eo_empresa($id)
{
    $e = q('SELECT * FROM empresas WHERE id = ?', [(int)$id])->fetch();
    if (!$e) {
        throw new InvalidArgumentException('Empresa não encontrada nesta obra.');
    }
    return $e;
}

/** Empresas da obra com os totais do que já foi cadastrado e lançado. */
function eo_listar()
{
    $out = [];
    foreach (q('SELECT * FROM empresas ORDER BY ordem, id')->fetchAll() as $e) {
        $nome = $e['nome'];
        $out[] = $e + [
            'servicos' => (int)q('SELECT COUNT(*) FROM servicos WHERE empresa_id = ?', [$e['id']])->fetchColumn(),
            'atividades' => (int)q('SELECT COUNT(*) FROM bm_atividades WHERE empresa = ?', [$nome])->fetchColumn(),
            'valor' => array_sum(array_map('floatval', q('SELECT MAX(valor_rotula) FROM bm_atividades WHERE empresa = ? GROUP BY item', [$nome])->fetchAll(PDO::FETCH_COLUMN))),
            'lancamentos' => eo_lancamentos($e),
            'lista_servicos' => q('SELECT * FROM servicos WHERE empresa_id = ? ORDER BY ordem, id', [$e['id']])->fetchAll(),
        ];
    }
    return $out;
}

/** Quantidade de lançamentos já feitos pela empresa (produção da grade, BM, apontamentos, efetivo, uso de equipamentos). */
function eo_lancamentos(array $e)
{
    $n = (int)q('SELECT COUNT(*) FROM producao WHERE empresa_id = ?', [$e['id']])->fetchColumn();
    foreach (['bm_apontamentos', 'bm_fechamentos', 'bm_deducoes', 'apontamentos', 'dp_efetivo', 'usos'] as $t) {
        try {
            $n += (int)q("SELECT COUNT(*) FROM $t WHERE empresa = ?", [$e['nome']])->fetchColumn();
        } catch (Throwable $x) { /* tabela sem a coluna: ignora */ }
    }
    return $n;
}

/** Cria o serviço (coluna de produção) da empresa; a letra da coluna é a próxima livre. */
function eo_servico_criar($empresaId, $nome, $frente = null, $escopo = null, $idCrono = null)
{
    $nome = trim((string)$nome);
    if ($nome === '' || mb_strlen($nome) > 120) {
        throw new InvalidArgumentException('Informe o nome do serviço (até 120 caracteres).');
    }
    foreach (q('SELECT nome FROM servicos WHERE empresa_id = ?', [(int)$empresaId])->fetchAll(PDO::FETCH_COLUMN) as $existente) {
        if (eo_maiusculas($existente) === eo_maiusculas($nome)) {
            throw new InvalidArgumentException('Esta empresa já tem o serviço “' . $nome . '”.');
        }
    }
    $usadas = q('SELECT col FROM servicos WHERE empresa_id = ?', [(int)$empresaId])->fetchAll(PDO::FETCH_COLUMN);
    $i = 0;
    while (in_array(eo_coluna($i), $usadas, true)) {
        $i++;
    }
    $ordem = (float)q('SELECT COALESCE(MAX(ordem), -1) + 1 FROM servicos WHERE empresa_id = ?', [(int)$empresaId])->fetchColumn();
    $escopo = ($escopo === null || $escopo === '') ? null : eo_numero($escopo);
    q('INSERT INTO servicos (empresa_id, col, nome, frente, id_crono, escopo, ordem) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [(int)$empresaId, eo_coluna($i), $nome, ($frente !== null && trim((string)$frente) !== '') ? trim((string)$frente) : null, $idCrono, $escopo, $ordem]);
    return eo_coluna($i);
}

function eo_servico_salvar($servicoId, $nome, $frente, $escopo)
{
    $s = q('SELECT * FROM servicos WHERE id = ?', [(int)$servicoId])->fetch();
    if (!$s) {
        throw new InvalidArgumentException('Serviço não encontrado.');
    }
    $nome = trim((string)$nome);
    if ($nome === '' || mb_strlen($nome) > 120) {
        throw new InvalidArgumentException('Informe o nome do serviço (até 120 caracteres).');
    }
    foreach (q('SELECT nome FROM servicos WHERE empresa_id = ? AND id <> ?', [$s['empresa_id'], $s['id']])->fetchAll(PDO::FETCH_COLUMN) as $existente) {
        if (eo_maiusculas($existente) === eo_maiusculas($nome)) {
            throw new InvalidArgumentException('Esta empresa já tem o serviço “' . $nome . '”.');
        }
    }
    $emp = eo_empresa($s['empresa_id']);
    if ($nome !== $s['nome']) {   // o catálogo do BM e o cronograma do cliente ligam ao serviço pelo nome: acompanha a troca
        q('UPDATE bm_atividades SET controle = ? WHERE empresa = ? AND controle = ?', [$nome, $emp['nome'], $s['nome']]);
        // o cronograma do cliente é da obra e liga pelo nome: só acompanha a troca quando nenhuma outra empresa usa o nome antigo
        if (!(int)q('SELECT COUNT(*) FROM servicos WHERE nome = ? AND id <> ?', [$s['nome'], $s['id']])->fetchColumn()) {
            q('UPDATE cliente SET servico = ? WHERE servico = ?', [$nome, $s['nome']]);
        }
    }
    q('UPDATE servicos SET nome = ?, frente = ?, escopo = ? WHERE id = ?',
        [$nome, trim((string)$frente) !== '' ? trim((string)$frente) : null, ($escopo === null || $escopo === '') ? null : eo_numero($escopo), $s['id']]);
}

function eo_servico_excluir($servicoId)
{
    $s = q('SELECT * FROM servicos WHERE id = ?', [(int)$servicoId])->fetch();
    if (!$s) {
        throw new InvalidArgumentException('Serviço não encontrado.');
    }
    if ((int)q('SELECT COUNT(*) FROM producao WHERE empresa_id = ? AND col = ? AND (valor_num IS NOT NULL OR valor_txt IS NOT NULL)', [$s['empresa_id'], $s['col']])->fetchColumn() > 0) {
        throw new InvalidArgumentException('O serviço “' . $s['nome'] . '” já tem produção lançada e não pode ser excluído.');
    }
    $emp = eo_empresa($s['empresa_id']);
    q('UPDATE bm_atividades SET controle = NULL WHERE empresa = ? AND controle = ?', [$emp['nome'], $s['nome']]);
    q('DELETE FROM producao WHERE empresa_id = ? AND col = ?', [$s['empresa_id'], $s['col']]);
    q('DELETE FROM servicos WHERE id = ?', [$s['id']]);
}

/**
 * Cadastra a empresa e, conforme o modo:
 *  - 'vazia'   : só a empresa (serviços e catálogo depois, à mão);
 *  - 'copiar'  : copia serviços e catálogo de outra empresa da obra (códigos com o prefixo novo; ajuste quantidades e valores depois);
 *  - 'planilha': lê a planilha de orçamento/medição (a mesma da importação da obra) e cria o catálogo e os cortes de BM.
 * Devolve um resumo para a mensagem da tela.
 */
function eo_criar_empresa(array $d, $arquivoTmp = null)
{
    $nome = eo_nome_valido($d['nome'] ?? '');
    $prefixo = eo_prefixo($d['prefixo'] ?? '', $nome);
    $modo = $d['modo'] ?? 'vazia';
    if (!in_array($modo, ['vazia', 'copiar', 'planilha'], true)) {
        throw new InvalidArgumentException('Escolha como montar o catálogo da empresa.');
    }
    $ordem = (int)q('SELECT COALESCE(MAX(ordem), -1) + 1 FROM empresas')->fetchColumn();
    q('INSERT INTO empresas (aba, nome, col_obs, ordem) VALUES (?, ?, ?, ?)', [$nome, $nome, null, $ordem]);
    $empresaId = (int)bd()->lastInsertId();
    $resumo = ['empresa' => $nome, 'servicos' => 0, 'atividades' => 0, 'periodos' => 0, 'avisos' => []];

    if ($modo === 'copiar') {
        $origem = q('SELECT * FROM empresas WHERE id = ?', [(int)($d['origem'] ?? 0)])->fetch();
        if (!$origem) {
            throw new InvalidArgumentException('Escolha a empresa da qual o catálogo será copiado.');
        }
        foreach (q('SELECT * FROM servicos WHERE empresa_id = ? ORDER BY ordem, id', [$origem['id']])->fetchAll() as $s) {
            if (preg_match('/^ADITIVO\s/u', (string)$s['frente'])) { continue; }   // aditivo é do contrato da empresa de origem: não vai para a cópia
            eo_servico_criar($empresaId, $s['nome'], $s['frente'], $s['escopo'], $s['id_crono']);
            $resumo['servicos']++;
        }
        $prefOrigem = null;
        foreach (q('SELECT * FROM bm_atividades WHERE empresa = ? ORDER BY codigo', [$origem['nome']])->fetchAll() as $a) {
            if (preg_match('/^ADT\d+$/', (string)$a['item'])) { continue; }
            $cod = (string)$a['codigo'];
            $novo = preg_match('/^[A-Za-z0-9]+-(\d.*)$/', $cod, $m) ? $prefixo . '-' . $m[1] : $prefixo . '-' . $cod;
            if (q('SELECT 1 FROM bm_atividades WHERE codigo = ?', [$novo])->fetchColumn()) {
                throw new InvalidArgumentException('O código ' . $novo . ' já existe no catálogo. Use outro prefixo.');
            }
            q('INSERT INTO bm_atividades (codigo, empresa, item, item_desc, atividade, unidade, qtd, peso, valor_qpc, valor_rotula, controle, obs) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [$novo, $nome, $a['item'], $a['item_desc'], $a['atividade'], $a['unidade'], $a['qtd'], $a['peso'], $a['valor_qpc'], $a['valor_rotula'], $a['controle'], 'Copiado de ' . $origem['nome'] . ' — conferir quantidades e valores']);
            $resumo['atividades']++;
        }
        if (!empty($d['copiar_cortes'])) {
            foreach (q('SELECT bm, corte FROM bm_periodos WHERE empresa = ? ORDER BY bm', [$origem['nome']])->fetchAll() as $p) {
                q('INSERT INTO bm_periodos (empresa, bm, corte, obs) VALUES (?, ?, ?, ?)', [$nome, $p['bm'], $p['corte'], 'Copiado de ' . $origem['nome']]);
                $resumo['periodos']++;
            }
        }
        $resumo['avisos'][] = 'As quantidades e os valores foram copiados de ' . $origem['nome'] . ': ajuste em Financeiro › Medição (BM) › Catálogo de atividades.';
    } elseif ($modo === 'planilha') {
        $r = eo_importar_catalogo($empresaId, $nome, $prefixo, $arquivoTmp, !empty($d['criar_colunas']), !empty($d['importar_cortes']));
        $resumo = array_merge($resumo, array_intersect_key($r, ['servicos' => 1, 'atividades' => 1, 'periodos' => 1]));
        $resumo['avisos'] = array_merge($resumo['avisos'], $r['avisos']);
    }
    return $resumo;
}

/**
 * Lê a planilha de orçamento/medição (formato da importação: item, descrição, QTD, UNIDADE, VALOR %, PESO + cortes "BM1 - 30/09/26")
 * e acrescenta as atividades à empresa. Códigos já existentes não são repetidos (a linha é ignorada e avisada).
 */
function eo_importar_catalogo($empresaId, $nome, $prefixo, $arquivoTmp, $criarColunas, $importarCortes)
{
    if (!$arquivoTmp || !is_file($arquivoTmp)) {
        throw new InvalidArgumentException('Envie a planilha de orçamento/medição (.xlsx) da empresa.');
    }
    $o = leitura_orcamento($arquivoTmp);
    if (!$o['itens']) {
        throw new InvalidArgumentException('Não reconheci itens de medição nesta planilha. ' . implode(' ', $o['avisos']));
    }
    $res = ['servicos' => 0, 'atividades' => 0, 'periodos' => 0, 'avisos' => array_values($o['avisos'])];
    foreach ($o['itens'] as $it) {
        $lista = $it['atividades'] ?: [['descricao' => $it['descricao'], 'qtd' => $it['qtd'], 'unidade' => $it['unidade'], 'peso' => 1.0, 'valor' => $it['valor'] ?? 0]];
        foreach ($lista as $k => $a) {
            $codigo = $prefixo . '-' . $it['codigo'] . '-' . sprintf('%02d', $k + 1);
            if (q('SELECT 1 FROM bm_atividades WHERE codigo = ?', [$codigo])->fetchColumn()) {
                $res['avisos'][] = 'O código ' . $codigo . ' já existe e foi ignorado.';
                continue;
            }
            $controle = null;
            if ($criarColunas) {
                $nomeServico = trim((string)$a['descricao']);
                $existe = q('SELECT 1 FROM servicos WHERE empresa_id = ? AND nome = ?', [(int)$empresaId, $nomeServico])->fetchColumn();
                if ($existe) {
                    $nomeServico .= ' (' . $it['codigo'] . ')';
                }
                eo_servico_criar($empresaId, $nomeServico, eo_maiusculas($it['descricao']), $a['qtd'], $it['codigo']);
                $controle = $nomeServico;
                $res['servicos']++;
            }
            $valor = (float)($it['valor'] ?? 0);
            q('INSERT INTO bm_atividades (codigo, empresa, item, item_desc, atividade, unidade, qtd, peso, valor_qpc, valor_rotula, controle, obs) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [$codigo, $nome, $it['codigo'], $it['descricao'], $a['descricao'], $a['unidade'] ?: ($it['unidade'] ?: 'un'), $a['qtd'], $a['peso'], $valor, $valor, $controle, 'Importado da planilha de orçamento']);
            $res['atividades']++;
        }
    }
    if ($importarCortes) {
        foreach ($o['periodos'] as $per) {
            if (q('SELECT 1 FROM bm_periodos WHERE empresa = ? AND bm = ?', [$nome, $per['bm']])->fetchColumn()) {
                continue;
            }
            q('INSERT INTO bm_periodos (empresa, bm, corte, obs) VALUES (?, ?, ?, ?)', [$nome, $per['bm'], $per['corte'], 'Importado do boletim de medição']);
            $res['periodos']++;
        }
    }
    if (!empty($o['contrato_total'])) {
        $res['avisos'][] = 'Total do contrato lido na planilha: R$ ' . number_format((float)$o['contrato_total'], 2, ',', '.') . '.';
    }
    return $res;
}

/** Exclui a empresa (e o catálogo e os serviços dela) só quando ela ainda não tem nenhum lançamento. */
function eo_excluir_empresa($empresaId)
{
    $e = eo_empresa($empresaId);
    if (eo_lancamentos($e) > 0) {
        throw new InvalidArgumentException('A empresa ' . $e['nome'] . ' já tem lançamentos (produção, BM, apontamentos, efetivo ou equipamentos) e não pode ser excluída.');
    }
    q('DELETE FROM servicos WHERE empresa_id = ?', [$e['id']]);
    q('DELETE FROM bm_atividades WHERE empresa = ?', [$e['nome']]);
    q('DELETE FROM bm_periodos WHERE empresa = ?', [$e['nome']]);
    q('DELETE FROM empresas WHERE id = ?', [$e['id']]);
}

/** Executa o cadastro dentro de uma transação (nada fica pela metade se a planilha ou o catálogo der erro). */
function eo_transacao(callable $f)
{
    $pdo = bd();
    $pdo->beginTransaction();
    try {
        $r = $f();
        $pdo->commit();
        return $r;
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }
}

// ====================================================================================================================
// ADITIVOS DE CONTRATO. Cada aditivo vira um ITEM NOVO no catálogo da empresa (ADT01, ADT02…) com as atividades dele: nada do que
// já existe é alterado (itens, pesos, quantidades e valores originais ficam como estão), então o BM fechado, a medição em
// aberto, os lançamentos e os apontamentos continuam valendo, e o aditivo aparece SEPARADO em Lançamentos, na Medição (BM) e
// nos relatórios. Aumento de quantidade de uma atividade existente = atividade nova "… — aditivo" ligada à original.
// ====================================================================================================================

function eo_aditivos_ler()
{
    $j = json_decode((string)sistema_ler('aditivos', '[]'), true);
    return is_array($j) ? $j : [];
}

function eo_aditivo_registrar(array $reg)
{
    $lista = eo_aditivos_ler();
    $reg['id'] = $lista ? max(array_column($lista, 'id')) + 1 : 1;
    $u = usuario_atual();
    $reg['por'] = $u['nome'] ?? '';
    $reg['em'] = (new DateTimeImmutable('now', new DateTimeZone('America/Sao_Paulo')))->format('Y-m-d H:i');
    $lista[] = $reg;
    sistema_gravar('aditivos', json_encode($lista, JSON_UNESCAPED_UNICODE));
    return $reg;
}

function eo_data_ref($v)
{
    $v = trim((string)$v);
    if ($v === '') {
        return (new DateTimeImmutable('now', new DateTimeZone('America/Sao_Paulo')))->format('Y-m-d');
    }
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $v) || !checkdate((int)substr($v, 5, 2), (int)substr($v, 8, 2), (int)substr($v, 0, 4))) {
        throw new InvalidArgumentException('Informe a data do aditivo.');
    }
    return $v;
}

function eo_dinheiro($v, $campo, $obrigatorio = false)
{
    if ($v === null || trim((string)$v) === '') {
        if ($obrigatorio) { throw new InvalidArgumentException('Informe ' . $campo . '.'); }
        return null;
    }
    $n = eo_numero($v);
    if ($n === null || $n < 0 || $n > 1e10) {
        throw new InvalidArgumentException('Valor inválido em ' . $campo . ' (use 1.234,56).');
    }
    return round($n, 2);
}

/** Prefixo dos códigos já usados pela empresa (ex.: EJ-3.1.1-01 → EJ); sem catálogo, deriva do nome. */
function eo_prefixo_da_empresa(array $emp)
{
    foreach (q('SELECT codigo FROM bm_atividades WHERE empresa = ? ORDER BY id', [$emp['nome']])->fetchAll(PDO::FETCH_COLUMN) as $cod) {
        if (preg_match('/^([A-Za-z0-9]+)-\d/', (string)$cod, $m)) { return $m[1]; }
        if (preg_match('/^([A-Za-z]+)-/', (string)$cod, $m)) { return $m[1]; }
    }
    return eo_prefixo('', $emp['nome']);
}

/**
 * Registra um aditivo da empresa: item novo ADTnn com 1 ou mais atividades.
 * $d: data, motivo, valor_cliente (R$ total do aditivo para o cliente; vazio = igual ao valor da empresa), criar_colunas,
 *     linhas = lista de {atividade, unidade, qtd, valor (R$), origem (código da atividade original que ele complementa, opcional)}.
 */
function eo_aditivo($empresaId, array $d)
{
    $emp = eo_empresa($empresaId);
    $data = eo_data_ref($d['data'] ?? '');
    $motivo = mb_substr(trim((string)($d['motivo'] ?? '')), 0, 120);
    if ($motivo === '') { throw new InvalidArgumentException('Informe o motivo do aditivo (ex.: Aditivo 02 — marquise da portaria).'); }
    $linhas = [];
    foreach ((array)($d['linhas'] ?? []) as $l) {
        $nome = trim((string)($l['atividade'] ?? ''));
        $qtdTxt = trim((string)($l['qtd'] ?? ''));
        $valTxt = trim((string)($l['valor'] ?? ''));
        if ($nome === '' && $qtdTxt === '' && $valTxt === '') { continue; }   // linha em branco
        $un = trim((string)($l['unidade'] ?? ''));
        $qtd = eo_numero($qtdTxt);
        if ($nome === '' || mb_strlen($nome) > 150) { throw new InvalidArgumentException('Informe o nome de cada atividade do aditivo (até 150 caracteres).'); }
        if ($un === '' || mb_strlen($un) > 12) { throw new InvalidArgumentException('Informe a unidade da atividade “' . $nome . '” (un, m², m, kg…).'); }
        if ($qtd === null || $qtd <= 0) { throw new InvalidArgumentException('Informe a quantidade da atividade “' . $nome . '” (maior que zero).'); }
        $valor = eo_dinheiro($valTxt, 'o valor da atividade “' . $nome . '” (R$)', true);
        if ($valor <= 0) { throw new InvalidArgumentException('O valor da atividade “' . $nome . '” deve ser maior que zero.'); }
        $origem = trim((string)($l['origem'] ?? ''));
        if ($origem !== '' && !q('SELECT 1 FROM bm_atividades WHERE codigo = ? AND empresa = ?', [$origem, $emp['nome']])->fetchColumn()) { throw new InvalidArgumentException('A atividade original ' . $origem . ' não existe no catálogo de ' . $emp['nome'] . '.'); }
        $linhas[] = ['nome' => $nome, 'un' => $un, 'qtd' => $qtd, 'valor' => $valor, 'origem' => $origem];
    }
    if (!$linhas) { throw new InvalidArgumentException('Inclua ao menos uma atividade no aditivo.'); }
    $total = round(array_sum(array_column($linhas, 'valor')), 2);
    $totalQ = eo_dinheiro($d['valor_cliente'] ?? '', 'o valor para o cliente');
    $totalQ = $totalQ === null ? $total : $totalQ;
    // item do aditivo: ADT01, ADT02… (um por aditivo da empresa)
    $n = 1;
    do { $item = 'ADT' . sprintf('%02d', $n++); } while (q('SELECT 1 FROM bm_atividades WHERE empresa = ? AND item = ?', [$emp['nome'], $item])->fetchColumn());
    $itemDesc = 'ADITIVO ' . substr($item, 3) . ' — ' . $motivo;
    $prefixo = eo_prefixo_da_empresa($emp);
    $numGlobal = count(eo_aditivos_ler()) + 1;
    $dataBr = implode('/', array_reverse(explode('-', $data)));
    $codigos = [];
    foreach ($linhas as $k => $l) {
        $codigo = $prefixo . '-' . $item . '-' . sprintf('%02d', $k + 1);
        if (q('SELECT 1 FROM bm_atividades WHERE codigo = ?', [$codigo])->fetchColumn()) { throw new InvalidArgumentException('O código ' . $codigo . ' já existe no catálogo.'); }
        $controle = null;
        if (!empty($d['criar_colunas'])) {
            $nomeServ = $l['nome'];
            if (q('SELECT 1 FROM servicos WHERE empresa_id = ? AND nome = ?', [$emp['id'], $nomeServ])->fetchColumn()) { $nomeServ .= ' (' . $item . ')'; }
            eo_servico_criar($emp['id'], $nomeServ, 'ADITIVO ' . substr($item, 3), $l['qtd'], $item);
            $controle = $nomeServ;
        }
        $peso = round($l['valor'] / $total, 8);
        $obs = 'ADITIVO nº ' . $numGlobal . ' (' . $dataBr . '): ' . $motivo . ($l['origem'] !== '' ? ' — complementa ' . $l['origem'] : '');
        q('INSERT INTO bm_atividades (codigo, empresa, item, item_desc, atividade, unidade, qtd, peso, valor_qpc, valor_rotula, controle, obs) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [$codigo, $emp['nome'], $item, $itemDesc, $l['nome'], $l['un'], $l['qtd'], $peso, $totalQ, $total, $controle, mb_substr($obs, 0, 500)]);
        $codigos[] = ['codigo' => $codigo, 'atividade' => $l['nome'], 'unidade' => $l['un'], 'qtd' => $l['qtd'], 'valor' => $l['valor'], 'origem' => $l['origem']];
    }
    $reg = eo_aditivo_registrar(['data' => $data, 'empresa' => $emp['nome'], 'item' => $item, 'motivo' => $motivo, 'valor' => $total, 'valor_cliente' => $totalQ, 'atividades' => $codigos]);
    return ['aditivo' => $reg['id'], 'item' => $item, 'valor' => $total, 'atividades' => count($codigos), 'colunas' => !empty($d['criar_colunas'])];
}
