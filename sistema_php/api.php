<?php
// API JSON consumida pela interface (mesmos contratos do programa local).
require __DIR__ . '/inc/nucleo.php';
require __DIR__ . '/inc/modelo.php';

class ErroValidacao extends Exception
{
}

if (!config()) {
    responder_json(503, ['erro' => 'Sistema não instalado. Acesse instalar.php.']);
}
$usuario = usuario_atual();
if (!$usuario) {
    responder_json(401, ['erro' => 'Faça login novamente.']);
}
session_write_close();

$rota = isset($_GET['r']) ? (string)$_GET['r'] : '';

try {
    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        if ($rota === 'versao') {
            responder_json(200, ['versao' => sistema_ler('versao', '0')]);
        }
        if ($rota === 'dados') {
            responder_json(200, [
                'versao' => sistema_ler('versao', '0'),
                'arquivo' => obra_info()['nome'] . ' · sistema online',
                'modificado' => sistema_ler('modificado', date('c')),
                'usuario' => ['nome' => $usuario['nome'], 'perfil' => $usuario['perfil'], 'empresa' => $usuario['empresa']],
                'recursos' => ['importar_mensal' => false, 'exportar' => false, 'online' => true],
                'modelo' => montar_modelo(),
            ]);
        }
        responder_json(404, ['erro' => 'Rota desconhecida.']);
    }

    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        responder_json(405, ['erro' => 'Método não permitido.']);
    }
    if (stripos($_SERVER['CONTENT_TYPE'] ?? '', 'application/json') !== 0) {
        responder_json(415, ['erro' => 'Envie os dados em JSON.']);
    }
    if ($usuario['perfil'] === 'leitura') {
        responder_json(403, ['erro' => 'Seu usuário é somente leitura.']);
    }
    $corpo = json_decode(file_get_contents('php://input'), true);
    if (!is_array($corpo)) {
        throw new ErroValidacao('Dados inválidos.');
    }
    $acoes = [
        'producao' => 'acao_producao', 'metas' => 'acao_metas', 'impacto' => 'acao_impacto',
        'registro' => 'acao_registro', 'equip/importar' => 'acao_importar_mensal',
    ];
    if (!isset($acoes[$rota])) {
        responder_json(404, ['erro' => 'Ação desconhecida.']);
    }
    $pdo = bd();
    $pdo->beginTransaction();
    try {
        $n = call_user_func($acoes[$rota], $corpo, $usuario);
        registrar_alteracao($rota, $corpo);
        $pdo->commit();
    } catch (Exception $e) {
        $pdo->rollBack();
        throw $e;
    }
    responder_json(200, ['ok' => true, 'celulas' => $n, 'versao' => sistema_ler('versao', '0')]);
} catch (ErroValidacao $e) {
    responder_json(400, ['erro' => $e->getMessage()]);
} catch (Exception $e) {
    error_log('obra198: ' . $e->getMessage());
    responder_json(500, ['erro' => 'Falha ao gravar no banco de dados.']);
}

// ----------------------------------------------------------------- ações

function acao_producao(array $corpo, array $usuario)
{
    $emp = q('SELECT * FROM empresas WHERE aba = ?', [$corpo['aba'] ?? ''])->fetch();
    if (!$emp) {
        throw new ErroValidacao('Empresa inválida.');
    }
    if (!empty($usuario['empresa']) && $usuario['empresa'] !== $emp['nome']) {
        throw new ErroValidacao('Seu usuário só pode lançar produção da empresa ' . $usuario['empresa'] . '.');
    }
    $cols = q('SELECT col FROM servicos WHERE empresa_id = ?', [$emp['id']])->fetchAll(PDO::FETCH_COLUMN);
    $o = obra_info();
    $del = bd()->prepare('DELETE FROM producao WHERE empresa_id = ? AND data = ? AND col = ?');
    $ins = bd()->prepare('INSERT INTO producao (empresa_id, data, col, valor_num, valor_txt) VALUES (?, ?, ?, ?, ?)');
    $n = 0;
    foreach (($corpo['alteracoes'] ?? []) as $a) {
        $data = $a['data'] ?? '';
        $col = $a['col'] ?? '';
        if (!data_valida($data) || $data < $o['data_inicio'] || $data > $o['data_fim']) {
            throw new ErroValidacao("Data fora do calendário da obra: $data");
        }
        $ehObs = $col === $emp['col_obs'];
        if (!$ehObs && !in_array($col, $cols, true)) {
            throw new ErroValidacao("Coluna inválida: $col");
        }
        $valor = $a['valor'] ?? null;
        $valor = is_string($valor) ? trim($valor) : $valor;
        $del->execute([$emp['id'], $data, $col]);
        $n++;
        if ($valor === null || $valor === '') {
            continue;
        }
        $num = $ehObs ? null : numero($valor);
        if ($num !== null && $num < 0) {
            throw new ErroValidacao('Quantidade não pode ser negativa.');
        }
        $ins->execute([$emp['id'], $data, $col, $num, $num === null ? mb_substr((string)$valor, 0, 255) : null]);
    }
    return $n;
}

function acao_metas(array $corpo)
{
    $n = 0;
    $campos = ['meta_dia', 'du', 'gap'];
    foreach (($corpo['alteracoes'] ?? []) as $a) {
        $id = (int)($a['linha'] ?? 0);
        if (!q('SELECT id FROM metas WHERE id = ?', [$id])->fetch()) {
            throw new ErroValidacao("Meta inválida: $id");
        }
        foreach ($campos as $c) {
            if (!array_key_exists($c, $a)) {
                continue;
            }
            $v = numero($a[$c]);
            if ($v === null) {
                $v = 0;
            }
            if ($v < 0 && $c !== 'gap') {
                throw new ErroValidacao("Valor inválido em $c.");
            }
            q("UPDATE metas SET $c = ? WHERE id = ?", [$v, $id]);
            $n++;
        }
    }
    return $n;
}

function acao_impacto(array $corpo)
{
    $id = isset($corpo['linha']) ? (int)$corpo['linha'] : null;
    if ($id !== null && !q('SELECT id FROM impactos WHERE id = ?', [$id])->fetch()) {
        throw new ErroValidacao('Impacto não encontrado.');
    }
    if (!empty($corpo['excluir'])) {
        q('DELETE FROM impactos WHERE id = ?', [$id]);
        return 1;
    }
    $campos = ['data', 'servico', 'motivo', 'solucionado', 'tempo', 'quando', 'paralisacao'];
    $vals = [];
    foreach ($campos as $c) {
        if (array_key_exists($c, $corpo)) {
            $vals[$c] = texto_ou_nulo($corpo[$c]);
        }
    }
    return gravar_linha('impactos', $id, $vals);
}

function gravar_linha($tabela, $id, array $vals)
{
    if (!$vals) {
        return 0;
    }
    if ($id === null) {
        $cols = array_keys($vals);
        q("INSERT INTO $tabela (" . implode(', ', $cols) . ') VALUES (' . implode(', ', array_fill(0, count($cols), '?')) . ')', array_values($vals));
    } else {
        $sets = implode(', ', array_map(function ($c) {
            return "$c = ?";
        }, array_keys($vals)));
        q("UPDATE $tabela SET $sets WHERE id = ?", array_merge(array_values($vals), [$id]));
    }
    return count($vals);
}

function acao_registro(array $corpo)
{
    $specs = tabelas_spec();
    $tabela = $corpo['tabela'] ?? '';
    if (!isset($specs[$tabela])) {
        throw new ErroValidacao('Tabela inválida.');
    }
    $id = isset($corpo['linha']) && $corpo['linha'] !== null ? (int)$corpo['linha'] : null;
    if ($id !== null && !q("SELECT id FROM $tabela WHERE id = ?", [$id])->fetch()) {
        throw new ErroValidacao('Registro não encontrado. Recarregue a tela.');
    }
    if (!empty($corpo['excluir'])) {
        q("DELETE FROM $tabela WHERE id = ?", [$id]);
        return 1;
    }
    $campos = is_array($corpo['campos'] ?? null) ? $corpo['campos'] : [];
    if ($tabela === 'usos') {
        $l = numero($campos['litros'] ?? null);
        $p = numero($campos['preco_litro'] ?? null);
        if ($l && $p && empty($campos['custo_combustivel'])) {
            $campos['custo_combustivel'] = round($l * $p, 2);
        }
    }
    if ($tabela === 'materiais' && empty($campos['codigo']) && $id === null) {
        $existentes = q('SELECT codigo FROM materiais')->fetchAll(PDO::FETCH_COLUMN);
        for ($i = 1; in_array(sprintf('MAT-%03d', $i), $existentes, true); $i++) {
        }
        $campos['codigo'] = sprintf('MAT-%03d', $i);
    }
    if ($tabela === 'movimentos' && !empty($campos['tipo'])) {
        $campos['tipo'] = mb_strtoupper($campos['tipo']);
        if (!in_array($campos['tipo'], ['ENTRADA', 'SAÍDA', 'AJUSTE'], true)) {
            throw new ErroValidacao('Tipo de movimentação deve ser ENTRADA, SAÍDA ou AJUSTE.');
        }
    }
    $vals = [];
    foreach ($specs[$tabela] as $c => $tipo) {
        if (!array_key_exists($c, $campos)) {
            continue;
        }
        $v = $campos[$c];
        if ($v === null || (is_string($v) && trim($v) === '')) {
            $vals[$c] = null;
        } elseif ($tipo === 'num') {
            $n = numero($v);
            if ($n === null) {
                throw new ErroValidacao("Valor numérico inválido em '$c': $v");
            }
            $vals[$c] = $n;
        } elseif ($tipo === 'data') {
            if (!data_valida($v)) {
                throw new ErroValidacao("Data inválida em '$c'.");
            }
            $vals[$c] = $v;
        } else {
            $vals[$c] = mb_substr(trim((string)$v), 0, 255);
        }
    }
    return gravar_linha($tabela, $id, $vals);
}

function acao_importar_mensal()
{
    throw new ErroValidacao('A importação das abas mensais é feita no programa local (planilha). Depois use Administração → Importar dados.');
}
