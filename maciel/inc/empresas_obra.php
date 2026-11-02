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
    $escopo = ($escopo === null || $escopo === '') ? null : numero($escopo);
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
        [$nome, trim((string)$frente) !== '' ? trim((string)$frente) : null, ($escopo === null || $escopo === '') ? null : numero($escopo), $s['id']]);
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
            eo_servico_criar($empresaId, $s['nome'], $s['frente'], $s['escopo'], $s['id_crono']);
            $resumo['servicos']++;
        }
        $prefOrigem = null;
        foreach (q('SELECT * FROM bm_atividades WHERE empresa = ? ORDER BY codigo', [$origem['nome']])->fetchAll() as $a) {
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
