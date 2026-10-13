<?php
// FINANÇAS: controle financeiro pessoal/PJ. Módulo isolado: tabelas próprias (fin_*), dados POR USUÁRIO
// (nem o administrador vê os lançamentos de outra pessoa) e nenhuma ligação com as tabelas das obras.
require_once __DIR__ . '/financas_calculos.php';

const FIN_ESQUEMA_VERSAO = 1;
const FIN_MAX_REPETIR = 120;

// ----------------------------------------------------------------- acesso e esquema

/** Liberação explícita (como o SESMT): administrador ou usuário marcado no módulo "financas". */
function fin_pode_ver(array $u)
{
    if (($u['perfil'] ?? '') === 'admin') {
        return true;
    }
    return (bool)q_global("SELECT 1 FROM usuarios_modulos WHERE usuario_id = ? AND modulo = 'financas' AND permitido = 1", [(int)$u['id']])->fetchColumn();
}

function fin_driver()
{
    $c = config();
    return $c['driver'] === 'sqlite' ? 'sqlite' : 'mysql';
}

function fin_garantir_esquema()
{
    static $feito = false;
    if ($feito) {
        return;
    }
    $feito = true;
    if ((int)global_ler('fin_esquema', '0') >= FIN_ESQUEMA_VERSAO) {
        return;
    }
    $pdo = bd();
    $sqlite = fin_driver() === 'sqlite';
    $pk = $sqlite ? 'INTEGER PRIMARY KEY AUTOINCREMENT' : 'INT AUTO_INCREMENT PRIMARY KEY';
    $fim = $sqlite ? '' : ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4';
    $pdo->exec("CREATE TABLE IF NOT EXISTS fin_lancamentos (id $pk, usuario_id INT NOT NULL, data VARCHAR(10) NOT NULL,
        tipo VARCHAR(10) NOT NULL, natureza VARCHAR(10) NOT NULL, categoria VARCHAR(60) NOT NULL, descricao VARCHAR(200) NULL,
        valor DECIMAL(14,2) NOT NULL, pago TINYINT NOT NULL DEFAULT 1, serie VARCHAR(32) NULL, criado_em VARCHAR(19) NULL)$fim");
    $pdo->exec("CREATE TABLE IF NOT EXISTS fin_config (usuario_id INT NOT NULL, chave VARCHAR(40) NOT NULL, valor VARCHAR(255) NULL,
        PRIMARY KEY (usuario_id, chave))$fim");
    if ($sqlite) {
        $pdo->exec('CREATE INDEX IF NOT EXISTS idx_fin_lanc_usuario ON fin_lancamentos (usuario_id, data)');
    } else {
        try {
            $pdo->exec('ALTER TABLE fin_lancamentos ADD KEY idx_fin_lanc_usuario (usuario_id, data)');
        } catch (Throwable $e) {
        }
    }
    global_gravar('fin_esquema', (string)FIN_ESQUEMA_VERSAO);
}

// ----------------------------------------------------------------- utilidades

function fin_agora_br()
{
    return new DateTimeImmutable('now', new DateTimeZone('America/Sao_Paulo'));
}

function fin_hoje()
{
    return fin_agora_br()->format('Y-m-d');
}

function fin_brl($v)
{
    return ($v < 0 ? '-' : '') . 'R$ ' . number_format(abs((float)$v), 2, ',', '.');
}

function fin_pct($v, $casas = 1)
{
    return number_format($v * 100, $casas, ',', '.') . '%';
}

function fin_rotulo_mes($ym)
{
    $m = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
    return $m[(int)substr($ym, 5, 2) - 1] . '/' . substr($ym, 2, 2);
}

function fin_mes_valido($v)
{
    return is_string($v) && preg_match('/^\d{4}-(0[1-9]|1[0-2])$/', $v);
}

/** Lista de meses (Y-m) de $ini a $fim, inclusive. */
function fin_intervalo_meses($ini, $fim)
{
    $out = [];
    $d = new DateTimeImmutable($ini . '-01');
    $f = new DateTimeImmutable($fim . '-01');
    while ($d <= $f && count($out) < 600) {
        $out[] = $d->format('Y-m');
        $d = $d->modify('+1 month');
    }
    return $out;
}

function fin_categorias()
{
    return [
        'Receita' => ['Salário', 'Pró-labore', 'Serviços / PJ', 'Rendimentos', 'Outras receitas'],
        'Fixa' => ['Aluguel / Moradia', 'Parcela do carro', 'Condomínio', 'Internet e telefone', 'Plano de saúde', 'Seguros',
            'Educação', 'Impostos (DAS/INSS)', 'Assinaturas'],
        'Variável' => ['Cartão de crédito', 'Mercado', 'Combustível', 'Restaurantes', 'Lazer', 'Saúde', 'Vestuário', 'Outras despesas'],
    ];
}

// ----------------------------------------------------------------- configuração por usuário

function fin_cfg_padrao()
{
    return ['reserva' => '28000', 'selic' => '0.15', 'cdi' => '0.149', 'ipca' => '0.045'];
}

function fin_cfg($uid)
{
    $cfg = fin_cfg_padrao();
    foreach (q_global('SELECT chave, valor FROM fin_config WHERE usuario_id = ?', [(int)$uid])->fetchAll() as $r) {
        if (isset($cfg[$r['chave']])) {
            $cfg[$r['chave']] = $r['valor'];
        }
    }
    return ['reserva' => (float)$cfg['reserva'], 'selic' => (float)$cfg['selic'], 'cdi' => (float)$cfg['cdi'], 'ipca' => (float)$cfg['ipca']];
}

function fin_cfg_gravar($uid, array $valores)
{
    foreach ($valores as $k => $v) {
        if (!array_key_exists($k, fin_cfg_padrao())) {
            continue;
        }
        q_global('DELETE FROM fin_config WHERE usuario_id = ? AND chave = ?', [(int)$uid, $k]);
        q_global('INSERT INTO fin_config (usuario_id, chave, valor) VALUES (?, ?, ?)', [(int)$uid, $k, (string)$v]);
    }
}

// ----------------------------------------------------------------- lançamentos

/** Valida os campos do formulário. @return array [dados limpos, erros] */
function fin_validar(array $p)
{
    $erros = [];
    $tipo = $p['tipo'] ?? '';
    if (!in_array($tipo, ['Receita', 'Despesa'], true)) {
        $erros[] = 'Escolha se é receita ou despesa.';
    }
    $natureza = $tipo === 'Receita' ? '—' : ($p['natureza'] ?? '');
    if ($tipo === 'Despesa' && !in_array($natureza, ['Fixa', 'Variável'], true)) {
        $erros[] = 'Escolha se a despesa é fixa ou variável.';
    }
    $categoria = trim((string)($p['categoria'] ?? ''));
    if ($categoria === '' || mb_strlen($categoria, 'UTF-8') > 60) {
        $erros[] = 'Informe a categoria (até 60 caracteres).';
    }
    $descricao = trim((string)($p['descricao'] ?? ''));
    if (mb_strlen($descricao, 'UTF-8') > 200) {
        $erros[] = 'A descrição pode ter no máximo 200 caracteres.';
    }
    $valor = numero($p['valor'] ?? '');
    if ($valor === null || $valor <= 0 || $valor > 1e11) {
        $erros[] = 'Informe um valor maior que zero.';
    }
    $data = (string)($p['data'] ?? '');
    if (!data_valida($data)) {
        $erros[] = 'Informe uma data válida.';
    }
    return [[
        'tipo' => $tipo, 'natureza' => $natureza, 'categoria' => $categoria, 'descricao' => $descricao,
        'valor' => $valor === null ? 0 : round((float)$valor, 2), 'data' => $data,
    ], $erros];
}

/** Soma $n meses à data sem estourar o fim do mês (31/01 + 1 mês = 28/02). */
function fin_somar_meses($data, $n)
{
    $d = new DateTimeImmutable($data);
    $dia = (int)$d->format('j');
    $alvo = $d->modify('first day of this month')->modify('+' . (int)$n . ' month');
    return $alvo->setDate((int)$alvo->format('Y'), (int)$alvo->format('n'), min($dia, (int)$alvo->format('t')))->format('Y-m-d');
}

/** Cria 1..N lançamentos (parcelas, aluguel, salário recorrente). Devolve quantos criou. */
function fin_adicionar($uid, array $d, $repetir, $serie = null)
{
    $repetir = max(1, min(FIN_MAX_REPETIR, (int)$repetir));
    $hoje = fin_hoje();
    $serieId = $serie ?? ($repetir > 1 ? bin2hex(random_bytes(8)) : null);
    $pdo = bd();
    $pdo->beginTransaction();
    try {
        for ($i = 0; $i < $repetir; $i++) {
            $data = fin_somar_meses($d['data'], $i);
            $desc = $d['descricao'] !== '' ? $d['descricao'] : $d['categoria'];
            if ($repetir > 1) {
                $desc = mb_substr($desc, 0, 185, 'UTF-8') . ' (' . ($i + 1) . '/' . $repetir . ')';
            }
            q_global('INSERT INTO fin_lancamentos (usuario_id, data, tipo, natureza, categoria, descricao, valor, pago, serie, criado_em)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [(int)$uid, $data, $d['tipo'], $d['natureza'], $d['categoria'], $desc,
                $d['valor'], $data <= $hoje ? 1 : 0, $serieId, fin_agora_br()->format('Y-m-d H:i:s')]);
        }
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }
    return $repetir;
}

function fin_obter($uid, $id)
{
    $r = q_global('SELECT * FROM fin_lancamentos WHERE id = ? AND usuario_id = ?', [(int)$id, (int)$uid])->fetch();
    return $r ?: null;
}

function fin_atualizar($uid, $id, array $d, $pago)
{
    $n = q_global('UPDATE fin_lancamentos SET data = ?, tipo = ?, natureza = ?, categoria = ?, descricao = ?, valor = ?, pago = ?
        WHERE id = ? AND usuario_id = ?', [$d['data'], $d['tipo'], $d['natureza'], $d['categoria'], $d['descricao'], $d['valor'],
        $pago ? 1 : 0, (int)$id, (int)$uid])->rowCount();
    return $n > 0;
}

/** Exclui um lançamento ou, com $serie, todos os que vieram da mesma repetição. */
function fin_excluir($uid, $id, $serie = false)
{
    $r = fin_obter($uid, $id);
    if (!$r) {
        return 0;
    }
    if ($serie && $r['serie']) {
        return q_global('DELETE FROM fin_lancamentos WHERE usuario_id = ? AND serie = ?', [(int)$uid, $r['serie']])->rowCount();
    }
    return q_global('DELETE FROM fin_lancamentos WHERE id = ? AND usuario_id = ?', [(int)$id, (int)$uid])->rowCount();
}

function fin_alternar_pago($uid, $id)
{
    q_global('UPDATE fin_lancamentos SET pago = 1 - pago WHERE id = ? AND usuario_id = ?', [(int)$id, (int)$uid]);
}

function fin_tem_dados($uid)
{
    return (int)q_global('SELECT COUNT(*) FROM fin_lancamentos WHERE usuario_id = ?', [(int)$uid])->fetchColumn() > 0;
}

function fin_tem_exemplo($uid)
{
    return (int)q_global("SELECT COUNT(*) FROM fin_lancamentos WHERE usuario_id = ? AND serie = 'exemplo'", [(int)$uid])->fetchColumn() > 0;
}

function fin_meses_com_dados($uid)
{
    return q_global('SELECT DISTINCT SUBSTR(data, 1, 7) AS m FROM fin_lancamentos WHERE usuario_id = ? ORDER BY m', [(int)$uid])->fetchAll(PDO::FETCH_COLUMN);
}

/** Filtros: mes (Y-m), tipo, q (texto). Devolve [linhas, total]. */
function fin_listar($uid, array $f, $pagina = 1, $porPagina = 30)
{
    $onde = 'usuario_id = ?';
    $par = [(int)$uid];
    if (!empty($f['mes']) && fin_mes_valido($f['mes'])) {
        $onde .= ' AND SUBSTR(data, 1, 7) = ?';
        $par[] = $f['mes'];
    }
    if (!empty($f['tipo']) && in_array($f['tipo'], ['Receita', 'Despesa'], true)) {
        $onde .= ' AND tipo = ?';
        $par[] = $f['tipo'];
    }
    if (!empty($f['natureza']) && in_array($f['natureza'], ['Fixa', 'Variável'], true)) {
        $onde .= ' AND natureza = ?';
        $par[] = $f['natureza'];
    }
    if (isset($f['q']) && trim($f['q']) !== '') {
        $onde .= " AND (descricao LIKE ? ESCAPE '!' OR categoria LIKE ? ESCAPE '!')";
        $like = '%' . str_replace(['!', '%', '_'], ['!!', '!%', '!_'], trim($f['q'])) . '%';
        array_push($par, $like, $like);
    }
    $total = (int)q_global("SELECT COUNT(*) FROM fin_lancamentos WHERE $onde", $par)->fetchColumn();
    $pagina = max(1, (int)$pagina);
    $porPagina = $porPagina === 0 ? 100000 : max(1, (int)$porPagina);
    $linhas = q_global("SELECT * FROM fin_lancamentos WHERE $onde ORDER BY data DESC, id DESC LIMIT " . (int)$porPagina . ' OFFSET ' . (int)(($pagina - 1) * $porPagina), $par)->fetchAll();
    return [$linhas, $total];
}

// ----------------------------------------------------------------- painel

/** Agregados do período [ini, fim] (Y-m): totais, séries mensais, categorias e pendências. */
function fin_painel($uid, $ini, $fim)
{
    $meses = fin_intervalo_meses($ini, $fim);
    $serie = [];
    foreach ($meses as $m) {
        $serie[$m] = ['rec' => 0.0, 'desp' => 0.0, 'fixa' => 0.0, 'var' => 0.0];
    }
    $rows = q_global('SELECT SUBSTR(data, 1, 7) AS m, tipo, natureza, SUM(valor) AS s FROM fin_lancamentos
        WHERE usuario_id = ? AND SUBSTR(data, 1, 7) >= ? AND SUBSTR(data, 1, 7) <= ? GROUP BY SUBSTR(data, 1, 7), tipo, natureza', [(int)$uid, $ini, $fim])->fetchAll();
    foreach ($rows as $r) {
        if (!isset($serie[$r['m']])) {
            continue;
        }
        $s = (float)$r['s'];
        if ($r['tipo'] === 'Receita') {
            $serie[$r['m']]['rec'] += $s;
        } else {
            $serie[$r['m']]['desp'] += $s;
            $serie[$r['m']][$r['natureza'] === 'Fixa' ? 'fixa' : 'var'] += $s;
        }
    }
    $rec = $desp = $fixa = $var = 0.0;
    foreach ($serie as $s) {
        $rec += $s['rec'];
        $desp += $s['desp'];
        $fixa += $s['fixa'];
        $var += $s['var'];
    }
    $cats = q_global("SELECT categoria, natureza, SUM(valor) AS s FROM fin_lancamentos WHERE usuario_id = ? AND tipo = 'Despesa'
        AND SUBSTR(data, 1, 7) >= ? AND SUBSTR(data, 1, 7) <= ? GROUP BY categoria, natureza ORDER BY s DESC", [(int)$uid, $ini, $fim])->fetchAll();
    $cartao = 0.0;
    foreach ($cats as &$c) {
        $c['s'] = (float)$c['s'];
        if ($c['categoria'] === 'Cartão de crédito') {
            $cartao += $c['s'];
        }
    }
    unset($c);
    $pend = q_global("SELECT COUNT(*) AS n, COALESCE(SUM(valor), 0) AS s FROM fin_lancamentos WHERE usuario_id = ? AND tipo = 'Despesa' AND pago = 0", [(int)$uid])->fetch();
    return [
        'meses' => $meses, 'serie' => $serie, 'rec' => $rec, 'desp' => $desp, 'fixa' => $fixa, 'var' => $var, 'saldo' => $rec - $desp,
        'poupanca' => $rec > 0 ? ($rec - $desp) / $rec : 0.0, 'n_meses' => max(count($meses), 1), 'categorias' => $cats, 'cartao' => $cartao,
        'pendentes_n' => (int)$pend['n'], 'pendentes_valor' => (float)$pend['s'],
    ];
}

/** Diagnóstico do "especialista": lista de [cor, ícone, texto com **negrito**]. */
function fin_diagnostico(array $P, $reserva)
{
    $it = [];
    $rec = $P['rec'];
    $poup = $P['poupanca'];
    if ($poup >= 0.20) {
        $it[] = ['verde', '✔', 'Taxa de poupança de **' . fin_pct($poup) . '** — acima dos 20% da regra 50/30/20. Ótimo ritmo.'];
    } elseif ($poup >= 0.10) {
        $it[] = ['amarelo', '▲', 'Taxa de poupança de **' . fin_pct($poup) . '**. Meta saudável: 20%. Faltam ' . fin_brl($rec * 0.2 - $P['saldo']) . ' no período.'];
    } else {
        $it[] = ['vermelho', '✖', 'Taxa de poupança de **' . fin_pct($poup) . '** — abaixo de 10%. Revise primeiro as despesas variáveis.'];
    }
    if ($rec > 0 && $P['fixa'] / $rec > 0.5) {
        $it[] = ['vermelho', '✖', 'Custos fixos consomem **' . fin_pct($P['fixa'] / $rec, 0) . '** da renda (limite recomendado: 50%). Pouca flexibilidade se a receita cair.'];
    } else {
        $it[] = ['verde', '✔', 'Custos fixos em **' . fin_pct($rec > 0 ? $P['fixa'] / $rec : 0, 0) . '** da renda — dentro do limite de 50%.'];
    }
    if ($rec > 0 && $P['cartao'] / $rec > 0.2) {
        $it[] = ['amarelo', '▲', 'Cartão de crédito = **' . fin_pct($P['cartao'] / $rec, 0) . '** da renda. Evite o rotativo (juros acima de 400% a.a.) e pague a fatura integral.'];
    }
    $fixaMes = $P['fixa'] / $P['n_meses'];
    if ($fixaMes > 0) {
        $cobre = $reserva / $fixaMes;
        $alvo = 6 * $fixaMes;
        if ($reserva >= $alvo) {
            $it[] = ['verde', '✔', 'Reserva de emergência cobre **' . number_format($cobre, 1, ',', '.') . ' meses** de custos fixos (meta: 6). Mantenha em liquidez diária (Tesouro Selic ou CDB 100% do CDI).'];
        } else {
            $it[] = ['amarelo', '▲', 'Reserva cobre **' . number_format($cobre, 1, ',', '.') . ' meses** de custos fixos; meta de 6 meses = ' . fin_brl($alvo) . '. Faltam ' . fin_brl($alvo - $reserva) . '.'];
        }
    }
    $m = array_values($P['serie']);
    $n = count($m);
    if ($n >= 2 && $m[$n - 2]['desp'] > 0 && $m[$n - 1]['desp'] > $m[$n - 2]['desp'] * 1.1) {
        $it[] = ['amarelo', '▲', 'Despesas do último mês subiram **' . fin_pct($m[$n - 1]['desp'] / $m[$n - 2]['desp'] - 1, 0) . '** frente ao mês anterior.'];
    }
    return $it;
}

// ----------------------------------------------------------------- dados de exemplo

/** Seis meses FICTÍCIOS (marcados serie='exemplo') só para conhecer o painel. */
function fin_exemplo_carregar($uid)
{
    $hoje = fin_hoje();
    $base = new DateTimeImmutable(substr($hoje, 0, 7) . '-01');
    $itens = [
        // [dia, tipo, natureza, categoria, descrição, valor fixo ou [mín, máx]]
        [5, 'Receita', '—', 'Pró-labore', 'Pró-labore da empresa', 4200],
        [10, 'Receita', '—', 'Serviços / PJ', 'Projeto de estrutura metálica', [14500, 21000]],
        [20, 'Receita', '—', 'Rendimentos', 'CDB / Tesouro Selic', [380, 520]],
        [5, 'Despesa', 'Fixa', 'Aluguel / Moradia', 'Aluguel', 2800],
        [5, 'Despesa', 'Fixa', 'Condomínio', 'Condomínio', 520],
        [10, 'Despesa', 'Fixa', 'Parcela do carro', 'Financiamento do carro', 1450],
        [12, 'Despesa', 'Fixa', 'Internet e telefone', 'Internet + celular', 240],
        [15, 'Despesa', 'Fixa', 'Plano de saúde', 'Plano de saúde', 780],
        [20, 'Despesa', 'Fixa', 'Impostos (DAS/INSS)', 'DAS Simples + INSS pró-labore', [900, 1500]],
        [8, 'Despesa', 'Variável', 'Cartão de crédito', 'Fatura do cartão', [2400, 4200]],
        [14, 'Despesa', 'Variável', 'Mercado', 'Supermercado', [1300, 1900]],
        [16, 'Despesa', 'Variável', 'Combustível', 'Combustível', [520, 880]],
        [22, 'Despesa', 'Variável', 'Restaurantes', 'Restaurantes e delivery', [450, 900]],
        [25, 'Despesa', 'Variável', 'Lazer', 'Lazer e viagens', [200, 1100]],
    ];
    $pdo = bd();
    $pdo->beginTransaction();
    try {
        for ($k = 5; $k >= 0; $k--) {
            $mes = $base->modify("-$k month");
            foreach ($itens as $j => $it) {
                $dia = min($it[0], (int)$mes->format('t'));
                $data = $mes->format('Y-m-') . sprintf('%02d', $dia);
                $v = $it[5];
                if (is_array($v)) {
                    $v = $v[0] + (($k * 37 + $j * 91) % ($v[1] - $v[0] + 1));
                }
                q_global('INSERT INTO fin_lancamentos (usuario_id, data, tipo, natureza, categoria, descricao, valor, pago, serie, criado_em)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [(int)$uid, $data, $it[1], $it[2], $it[3], $it[4], $v, $data <= $hoje ? 1 : 0,
                    'exemplo', fin_agora_br()->format('Y-m-d H:i:s')]);
            }
        }
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }
}

function fin_exemplo_remover($uid)
{
    return q_global("DELETE FROM fin_lancamentos WHERE usuario_id = ? AND serie = 'exemplo'", [(int)$uid])->rowCount();
}
