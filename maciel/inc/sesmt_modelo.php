<?php
// SESMT GERAL: regras de negócio, esquema, validação e consultas. Usa só tabelas sesmt_* (nada das existentes é alterado).
// Compatível com PHP 7.4+. Toda consulta usa PDO com parâmetros; nomes de tabela e coluna vêm apenas das definições.

require_once __DIR__ . '/sesmt_registros.php';

const SESMT_ESQUEMA_VERSAO = 1;
const SESMT_POR_PAGINA = 50;

// ----------------------------------------------------------------- tempo (horário de Brasília)

function sesmt_agora_dt()
{
    return new DateTimeImmutable('now', new DateTimeZone('America/Sao_Paulo'));
}

function sesmt_hoje()
{
    return sesmt_agora_dt()->format('Y-m-d');
}

function sesmt_agora()
{
    return sesmt_agora_dt()->format('Y-m-d H:i:s');
}

function sesmt_data_iso($v)
{
    $t = trim((string)$v);
    if ($t === '') {
        return null;
    }
    if (preg_match('/^(\d{4})-(\d{2})-(\d{2})/', $t, $m) && checkdate((int)$m[2], (int)$m[3], (int)$m[1])) {
        return $m[1] . '-' . $m[2] . '-' . $m[3];
    }
    if (preg_match('/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/', $t, $m) && checkdate((int)$m[2], (int)$m[1], (int)$m[3])) {
        return sprintf('%04d-%02d-%02d', $m[3], $m[2], $m[1]);
    }
    return false;
}

function sesmt_dt($iso)
{
    return new DateTimeImmutable($iso . ' 00:00:00', new DateTimeZone('America/Sao_Paulo'));
}

function sesmt_dias_entre($de, $ate)
{
    return (int)sesmt_dt($de)->diff(sesmt_dt($ate))->format('%r%a');
}

function sesmt_mais_dias($iso, $n)
{
    return sesmt_dt($iso)->modify(($n >= 0 ? '+' : '') . (int)$n . ' days')->format('Y-m-d');
}

/** Soma meses sem estourar o fim do mês (31/01 + 1 mês = 28/02). */
function sesmt_mais_meses($iso, $n)
{
    $d = sesmt_dt($iso);
    $dia = (int)$d->format('j');
    $x = $d->modify('first day of this month')->modify(($n >= 0 ? '+' : '') . (int)$n . ' months');
    $ultimo = (int)$x->format('t');
    return $x->setDate((int)$x->format('Y'), (int)$x->format('n'), min($dia, $ultimo))->format('Y-m-d');
}

function sesmt_fmt_data($iso)
{
    return $iso && preg_match('/^(\d{4})-(\d{2})-(\d{2})/', $iso, $m) ? $m[3] . '/' . $m[2] . '/' . $m[1] : '';
}

function sesmt_fmt_num($v, $casas = 0)
{
    return $v === null || $v === '' ? '' : number_format((float)$v, $casas, ',', '.');
}

// ----------------------------------------------------------------- CPF e empresa

function sesmt_cpf_digitos($v)
{
    return preg_replace('/\D+/', '', (string)$v);
}

function sesmt_cpf_valido($d)
{
    if (!preg_match('/^\d{11}$/', $d) || preg_match('/^(\d)\1{10}$/', $d)) {
        return false;
    }
    for ($t = 9; $t < 11; $t++) {
        $soma = 0;
        for ($i = 0; $i < $t; $i++) {
            $soma += (int)$d[$i] * (($t + 1) - $i);
        }
        $dv = ((10 * $soma) % 11) % 10;
        if ((int)$d[$t] !== $dv) {
            return false;
        }
    }
    return true;
}

/** Mostra só os 6 dígitos do meio (LGPD). Com $ocultar=false devolve o CPF completo formatado. */
function sesmt_cpf_exibir($d, $ocultar = true)
{
    $d = sesmt_cpf_digitos($d);
    if (strlen($d) !== 11) {
        return (string)$d;
    }
    return $ocultar
        ? '***.' . substr($d, 3, 3) . '.' . substr($d, 6, 3) . '-**'
        : substr($d, 0, 3) . '.' . substr($d, 3, 3) . '.' . substr($d, 6, 3) . '-' . substr($d, 9, 2);
}

function sesmt_norm_empresa($n)
{
    return mb_strtoupper(trim(preg_replace('/\s+/', ' ', (string)$n)), 'UTF-8');
}

// ----------------------------------------------------------------- situação de validade (vencido / a vencer / válido)

/** Mesma regra da planilha: vence em menos de 1 dia = VENCIDO; até 30 dias = A VENCER; senão VÁLIDO. */
function sesmt_situacao_validade($venc, $hoje)
{
    if (!$venc) {
        return ['v' => '', 'tom' => null, 'dias' => null, 'venc' => null];
    }
    $dias = sesmt_dias_entre($hoje, $venc);
    if ($dias < 1) {
        $atraso = abs($dias);
        return ['v' => 'VENCIDO' . ($atraso > 0 ? ' há ' . $atraso . ' dia' . ($atraso > 1 ? 's' : '') : ' hoje'), 'tom' => 'vermelho', 'dias' => $dias, 'venc' => $venc];
    }
    if ($dias < 31) {
        return ['v' => $dias . ' DIA' . ($dias > 1 ? 'S' : '') . ' PARA VENCER', 'tom' => 'amarelo', 'dias' => $dias, 'venc' => $venc];
    }
    return ['v' => 'VÁLIDO', 'tom' => 'verde', 'dias' => $dias, 'venc' => $venc];
}

// ----------------------------------------------------------------- esquema

function sesmt_driver()
{
    $c = config();
    return $c['driver'] === 'sqlite' ? 'sqlite' : 'mysql';
}

function sesmt_tipo_sql($tipo)
{
    $base = explode(':', $tipo)[0];
    switch ($base) {
        case 'longo':
            return 'TEXT NULL';
        case 'num':
            return 'DOUBLE NULL';
        case 'int':
        case 'ref':
            return 'INT NULL';
        case 'data':
            return 'DATE NULL';
        case 'hora':
            return 'VARCHAR(5) NULL';
        case 'cpf':
            return 'VARCHAR(14) NULL';
        case 'empresa':
            return 'VARCHAR(100) NULL';
        default:
            return 'VARCHAR(255) NULL';
    }
}

function sesmt_tabela($reg)
{
    if (!isset(sesmt_registros()[$reg])) {
        throw new InvalidArgumentException('Cadastro inválido.');
    }
    return 'sesmt_' . $reg;
}

function sesmt_garantir_esquema()
{
    static $feito = false;
    if ($feito) {
        return;
    }
    $feito = true;
    $pdo = bd();
    $driver = sesmt_driver();
    $versao = (int)global_ler('sesmt_esquema', '0');
    if ($versao < SESMT_ESQUEMA_VERSAO) {
        $pk = $driver === 'sqlite' ? 'INTEGER PRIMARY KEY AUTOINCREMENT' : 'INT AUTO_INCREMENT PRIMARY KEY';
        $fim = $driver === 'mysql' ? ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4' : '';
        $pdo->exec("CREATE TABLE IF NOT EXISTS sesmt_listas (id $pk, lista VARCHAR(60) NOT NULL, valor VARCHAR(150) NOT NULL,
            ordem INT NOT NULL DEFAULT 0, UNIQUE (lista, valor))$fim");
        foreach (sesmt_registros() as $reg => $def) {
            $cols = [];
            foreach ($def['campos'] as $campo => $c) {
                $cols[] = "`$campo` " . sesmt_tipo_sql($c['tipo']);
            }
            $indice = $driver === 'mysql' ? ", KEY idx_sesmt_{$reg}_obra (obra_id)" : '';
            $pdo->exec("CREATE TABLE IF NOT EXISTS sesmt_$reg (id $pk, obra_id INT NOT NULL, criado_em VARCHAR(19) NULL,
                atualizado_em VARCHAR(19) NULL, " . implode(', ', $cols) . "$indice)$fim");
            if ($driver === 'sqlite') {
                $pdo->exec("CREATE INDEX IF NOT EXISTS idx_sesmt_{$reg}_obra ON sesmt_$reg (obra_id)");
            }
            $existentes = colunas_tabela($pdo, $driver, "sesmt_$reg");
            foreach ($def['campos'] as $campo => $c) {
                if (!in_array($campo, $existentes, true)) {
                    $pdo->exec("ALTER TABLE sesmt_$reg ADD COLUMN `$campo` " . sesmt_tipo_sql($c['tipo']));
                }
            }
        }
        global_gravar('sesmt_esquema', (string)SESMT_ESQUEMA_VERSAO);
    }
    sesmt_semear_listas();
}

/** Carrega as listas da planilha uma única vez por lista; o que o usuário editar depois nunca é recriado. */
function sesmt_semear_listas()
{
    $feitas = json_decode((string)global_ler('sesmt_listas_semeadas', '[]'), true);
    $feitas = is_array($feitas) ? $feitas : [];
    $mudou = false;
    foreach (sesmt_listas_iniciais() as $nome => $def) {
        if (in_array($nome, $feitas, true)) {
            continue;
        }
        foreach ($def[1] as $i => $valor) {
            if (!q_global('SELECT 1 FROM sesmt_listas WHERE lista = ? AND valor = ?', [$nome, $valor])->fetchColumn()) {
                q_global('INSERT INTO sesmt_listas (lista, valor, ordem) VALUES (?, ?, ?)', [$nome, $valor, $i + 1]);
            }
        }
        $feitas[] = $nome;
        $mudou = true;
    }
    if ($mudou) {
        global_gravar('sesmt_listas_semeadas', json_encode($feitas));
    }
}

// ----------------------------------------------------------------- listas (fontes de dados das caixas de seleção)

function sesmt_opcoes($lista)
{
    static $cache = [];
    if (!isset($cache[$lista])) {
        $cache[$lista] = q_global('SELECT valor FROM sesmt_listas WHERE lista = ? ORDER BY ordem, id', [$lista])->fetchAll(PDO::FETCH_COLUMN);
    }
    return $cache[$lista];
}

function sesmt_lista_fixa($lista)
{
    $d = sesmt_listas_iniciais();
    return !empty($d[$lista][2]);
}

function sesmt_lista_adicionar($lista, $valor)
{
    $d = sesmt_listas_iniciais();
    if (!isset($d[$lista])) {
        throw new InvalidArgumentException('Lista inválida.');
    }
    if (sesmt_lista_fixa($lista)) {
        throw new InvalidArgumentException('Esta lista é usada em cálculos e não pode ser alterada.');
    }
    $valor = trim(preg_replace('/\s+/', ' ', (string)$valor));
    if ($valor === '' || mb_strlen($valor, 'UTF-8') > 150) {
        throw new InvalidArgumentException('Informe um valor de até 150 caracteres.');
    }
    $existe = q_global('SELECT 1 FROM sesmt_listas WHERE lista = ? AND valor = ?', [$lista, $valor])->fetchColumn();
    if ($existe) {
        throw new InvalidArgumentException('Esse valor já existe na lista.');
    }
    $max = (int)q_global('SELECT COALESCE(MAX(ordem), 0) FROM sesmt_listas WHERE lista = ?', [$lista])->fetchColumn();
    q_global('INSERT INTO sesmt_listas (lista, valor, ordem) VALUES (?, ?, ?)', [$lista, $valor, $max + 1]);
}

function sesmt_lista_remover($lista, $valor)
{
    if (sesmt_lista_fixa($lista)) {
        throw new InvalidArgumentException('Esta lista é usada em cálculos e não pode ser alterada.');
    }
    q_global('DELETE FROM sesmt_listas WHERE lista = ? AND valor = ?', [$lista, $valor]);
}

// ----------------------------------------------------------------- configurações

function sesmt_cfg_padrao()
{
    return [
        'meta_dias' => 100, 'jornada' => 8, 'dias_mes' => 27,
        'hidro_extintor_dias' => 1800, 'hidro_hidrante_dias' => 360,
        'empresa' => ['nome' => '', 'cnpj' => '', 'atividade' => '', 'grau_risco' => '', 'endereco' => '', 'cidade' => '', 'uf' => '', 'fundacao' => '', 'responsavel' => ''],
    ];
}

function sesmt_cfg()
{
    static $c = null;
    if ($c === null) {
        $salvo = json_decode((string)global_ler('sesmt_cfg', '{}'), true);
        $salvo = is_array($salvo) ? $salvo : [];
        $c = array_replace(sesmt_cfg_padrao(), $salvo);
        $c['empresa'] = array_replace(sesmt_cfg_padrao()['empresa'], is_array($salvo['empresa'] ?? null) ? $salvo['empresa'] : []);
    }
    return $c;
}

function sesmt_cfg_salvar(array $post)
{
    $novo = sesmt_cfg_padrao();
    foreach (['meta_dias', 'jornada', 'dias_mes', 'hidro_extintor_dias', 'hidro_hidrante_dias'] as $k) {
        $v = numero($post[$k] ?? null);
        if ($v === null || $v <= 0) {
            throw new InvalidArgumentException('Os valores de configuração devem ser números maiores que zero.');
        }
        $novo[$k] = $v;
    }
    foreach (array_keys($novo['empresa']) as $k) {
        $novo['empresa'][$k] = mb_substr(trim((string)($post['empresa_' . $k] ?? '')), 0, 200, 'UTF-8');
    }
    global_gravar('sesmt_cfg', json_encode($novo, JSON_UNESCAPED_UNICODE));
}

// ----------------------------------------------------------------- acesso (dados pessoais e de saúde: liberação explícita)

function sesmt_pode_ver(array $u)
{
    if (($u['perfil'] ?? '') === 'admin') {
        return true;
    }
    return (bool)q_global("SELECT 1 FROM usuarios_modulos WHERE usuario_id = ? AND modulo = 'sesmt' AND permitido = 1", [(int)$u['id']])->fetchColumn();
}

function sesmt_pode_editar(array $u)
{
    return sesmt_pode_ver($u) && in_array($u['perfil'] ?? '', ['admin', 'editor'], true);
}

/** Libera ou bloqueia o SESMT para um usuário sem perder os demais menus (usuário sem configuração enxerga tudo). */
function sesmt_alterar_acesso($usuarioId, $liberar)
{
    $alvo = q_global('SELECT id, perfil FROM usuarios WHERE id = ?', [(int)$usuarioId])->fetch();
    if (!$alvo || $alvo['perfil'] === 'admin') {
        throw new InvalidArgumentException('Usuário inválido.');
    }
    $tem = (int)q_global('SELECT COUNT(*) FROM usuarios_modulos WHERE usuario_id = ?', [(int)$usuarioId])->fetchColumn();
    if ($tem === 0) {
        foreach (modulos_sistema() as $m) {
            if ($m !== 'sesmt') {
                q_global('INSERT INTO usuarios_modulos (usuario_id, modulo, permitido) VALUES (?, ?, 1)', [(int)$usuarioId, $m]);
            }
        }
    }
    q_global("DELETE FROM usuarios_modulos WHERE usuario_id = ? AND modulo = 'sesmt'", [(int)$usuarioId]);
    if ($liberar) {
        q_global("INSERT INTO usuarios_modulos (usuario_id, modulo, permitido) VALUES (?, 'sesmt', 1)", [(int)$usuarioId]);
    }
}

// ----------------------------------------------------------------- empresas

function sesmt_empresas()
{
    $nomes = ['RÓTULA'];
    try {
        foreach (q('SELECT nome FROM empresas ORDER BY ordem')->fetchAll(PDO::FETCH_COLUMN) as $n) {
            $nomes[] = sesmt_norm_empresa($n);
        }
    } catch (Throwable $e) {
    }
    $obra = obra_atual_id();
    foreach (sesmt_registros() as $reg => $def) {
        if (isset($def['campos']['empresa'])) {
            $st = q_global("SELECT DISTINCT empresa FROM sesmt_$reg WHERE obra_id = ? AND empresa IS NOT NULL AND empresa <> ''", [$obra]);
            foreach ($st->fetchAll(PDO::FETCH_COLUMN) as $n) {
                $nomes[] = $n;
            }
        }
    }
    $nomes = array_values(array_unique(array_filter($nomes)));
    sort($nomes, SORT_STRING);
    return $nomes;
}

// ----------------------------------------------------------------- referências entre cadastros

function sesmt_ref_alvo($tipo)
{
    return strpos($tipo, 'ref:') === 0 ? substr($tipo, 4) : null;
}

function sesmt_campos_ref($reg)
{
    $o = [];
    foreach (sesmt_registros()[$reg]['campos'] as $k => $c) {
        if (sesmt_ref_alvo($c['tipo'])) {
            $o[$k] = sesmt_ref_alvo($c['tipo']);
        }
    }
    return $o;
}

function sesmt_ref_rotulo($alvo, array $r)
{
    switch ($alvo) {
        case 'colaboradores':
            return $r['nome'] . ($r['status'] === 'Demitido' ? ' (Demitido)' : '') . ' — ' . ($r['empresa'] ?: 'sem empresa');
        case 'treinamentos':
            return $r['treinamento'] . ($r['data_final'] ? ' · ' . sesmt_fmt_data($r['data_final']) : '');
        case 'epi':
            return $r['descricao'] . ($r['ca'] ? ' · CA ' . $r['ca'] : '');
        case 'equipamentos':
            return $r['nome'] . ($r['modelo'] ? ' · ' . $r['modelo'] : '');
        case 'veiculos':
            return $r['placa'] . ' — ' . $r['veiculo'];
    }
    return (string)$r['id'];
}

function sesmt_opcoes_ref($alvo)
{
    $obra = obra_atual_id();
    $t = sesmt_tabela($alvo);
    $ordem = $alvo === 'colaboradores' ? 'empresa, nome' : sesmt_registros()[$alvo]['ordem'];
    $o = [];
    foreach (q_global("SELECT * FROM $t WHERE obra_id = ? ORDER BY $ordem", [$obra])->fetchAll() as $r) {
        $o[(int)$r['id']] = sesmt_ref_rotulo($alvo, $r);
    }
    return $o;
}

function sesmt_mapa($reg)
{
    $m = [];
    foreach (q_global('SELECT * FROM ' . sesmt_tabela($reg) . ' WHERE obra_id = ?', [obra_atual_id()])->fetchAll() as $r) {
        $m[(int)$r['id']] = $r;
    }
    return $m;
}

// ----------------------------------------------------------------- contexto e cálculos

function sesmt_contexto($reg)
{
    $ctx = ['hoje' => sesmt_hoje(), 'cfg' => sesmt_cfg()];
    $precisa = array_values(sesmt_campos_ref($reg));
    if ($reg === 'presenca') {
        $precisa[] = 'treinamentos';
    }
    foreach (array_unique($precisa) as $alvo) {
        $ctx[$alvo] = sesmt_mapa($alvo);
    }
    if ($reg === 'treinamentos') {
        $ctx['alunos'] = [];
        foreach (q_global('SELECT treinamento_id, COUNT(*) n FROM sesmt_presenca WHERE obra_id = ? GROUP BY treinamento_id', [obra_atual_id()])->fetchAll() as $x) {
            $ctx['alunos'][(int)$x['treinamento_id']] = (int)$x['n'];
        }
    }
    if ($reg === 'epi' || $reg === 'mov_epi') {
        $ctx['saldo'] = sesmt_saldo_epi();
    }
    return $ctx;
}

function sesmt_saldo_epi($ignorarMov = 0)
{
    $s = [];
    $sql = 'SELECT epi_id, movimento, SUM(qtd) q FROM sesmt_mov_epi WHERE obra_id = ?' . ($ignorarMov ? ' AND id <> ?' : '') . ' GROUP BY epi_id, movimento';
    $p = $ignorarMov ? [obra_atual_id(), (int)$ignorarMov] : [obra_atual_id()];
    foreach (q_global($sql, $p)->fetchAll() as $x) {
        $id = (int)$x['epi_id'];
        $s[$id] = $s[$id] ?? ['ent' => 0.0, 'sai' => 0.0];
        $s[$id][$x['movimento'] === 'ENTRADA' ? 'ent' : 'sai'] += (float)$x['q'];
    }
    return $s;
}

function sesmt_cel($v, $tom = null)
{
    return ['v' => (string)$v, 'tom' => $tom];
}

function sesmt_cel_venc($venc, $hoje, $semDado = '')
{
    if (!$venc) {
        return sesmt_cel($semDado);
    }
    $s = sesmt_situacao_validade($venc, $hoje);
    return ['v' => $s['v'], 'tom' => $s['tom'], 'dias' => $s['dias'], 'venc' => $venc];
}

function sesmt_validade_treinamento(array $t, $hoje)
{
    if ($t['status'] !== 'Concluído' || ($t['controlar'] ?? 'Sim') === 'Não') {
        return ['venc' => null, 'cel' => sesmt_cel('-')];
    }
    if (!$t['data_final']) {
        return ['venc' => null, 'cel' => sesmt_cel('')];
    }
    if (!$t['validade_meses']) {
        return ['venc' => null, 'cel' => sesmt_cel('VÁLIDO', 'verde')];
    }
    $venc = sesmt_mais_meses($t['data_final'], (int)$t['validade_meses']);
    return ['venc' => $venc, 'cel' => sesmt_cel_venc($venc, $hoje)];
}

/** Colunas calculadas de uma linha. Cada item: ['v' => texto, 'tom' => verde|amarelo|vermelho|null]. */
function sesmt_calcular($reg, array $r, array $ctx)
{
    $hoje = $ctx['hoje'];
    $c = [];
    switch ($reg) {
        case 'colaboradores':
            $c['idade'] = sesmt_cel($r['nascimento'] ? (int)sesmt_dt($r['nascimento'])->diff(sesmt_dt($hoje))->y . ' anos' : '');
            $fim = $r['desligamento'] ?: $hoje;
            $c['tempo'] = sesmt_cel($r['admissao'] && $r['admissao'] <= $fim ? sesmt_fmt_num(sesmt_dias_entre($r['admissao'], $fim)) . ' dias' : '');
            break;
        case 'aso':
            if (($r['atualizou'] ?? '') === 'Sim') {
                $c['vencimento'] = sesmt_cel($r['data_emissao'] && $r['validade_dias'] ? sesmt_fmt_data(sesmt_mais_dias($r['data_emissao'], (int)$r['validade_dias'])) : '');
                $c['situacao'] = sesmt_cel('SUBSTITUÍDO');
            } else {
                $venc = $r['data_emissao'] && $r['validade_dias'] ? sesmt_mais_dias($r['data_emissao'], (int)$r['validade_dias']) : null;
                $c['vencimento'] = sesmt_cel($venc ? sesmt_fmt_data($venc) : '');
                $c['situacao'] = sesmt_cel_venc($venc, $hoje);
            }
            break;
        case 'treinamentos':
            $val = sesmt_validade_treinamento($r, $hoje);
            $c['alunos'] = sesmt_cel($ctx['alunos'][(int)$r['id']] ?? 0);
            $c['vencimento'] = sesmt_cel($val['venc'] ? sesmt_fmt_data($val['venc']) : '');
            $c['situacao'] = $val['cel'];
            break;
        case 'presenca':
            $t = $ctx['treinamentos'][(int)$r['treinamento_id']] ?? null;
            if ($t) {
                $val = sesmt_validade_treinamento($t, $hoje);
                $c['norma'] = sesmt_cel($t['norma']);
                $c['conclusao'] = sesmt_cel(sesmt_fmt_data($t['data_final']));
                $c['vencimento'] = sesmt_cel($val['venc'] ? sesmt_fmt_data($val['venc']) : '');
                $c['situacao'] = $val['cel'];
            } else {
                $c = ['norma' => sesmt_cel(''), 'conclusao' => sesmt_cel(''), 'vencimento' => sesmt_cel(''), 'situacao' => sesmt_cel('')];
            }
            break;
        case 'advertencias':
            $col = $ctx['colaboradores'][(int)$r['colaborador_id']] ?? [];
            $c['setor'] = sesmt_cel($col['setor'] ?? '');
            $c['funcao'] = sesmt_cel($col['funcao'] ?? '');
            break;
        case 'cipa':
            if (($r['controlar'] ?? 'Sim') === 'Não' || !$r['data_posse']) {
                $c = ['fim_mandato' => sesmt_cel(''), 'situacao' => sesmt_cel(''), 'fim_estab' => sesmt_cel(''), 'situacao2' => sesmt_cel('')];
            } else {
                $fm = sesmt_mais_meses($r['data_posse'], 12);
                $fe = sesmt_mais_meses($r['data_posse'], 24);
                $c['fim_mandato'] = sesmt_cel(sesmt_fmt_data($fm));
                $c['situacao'] = sesmt_cel_venc($fm, $hoje);
                $c['fim_estab'] = sesmt_cel(sesmt_fmt_data($fe));
                $c['situacao2'] = sesmt_cel_venc($fe, $hoje);
            }
            break;
        case 'acidentes':
            $d = ($r['afastamento'] === 'Sim' && $r['data_retorno'] && $r['data'] && $r['data_retorno'] >= $r['data']) ? sesmt_dias_entre($r['data'], $r['data_retorno']) : 0;
            $c['dias'] = sesmt_cel($d ? $d . ' dias' : '0');
            $c['dias']['num'] = $d;
            break;
        case 'desvios':
            if ($r['conclusao']) {
                $c['situacao'] = sesmt_cel('CONCLUÍDO', 'verde');
            } elseif (!$r['prazo']) {
                $c['situacao'] = sesmt_cel(trim((string)$r['acoes']) === '' ? 'SEM AÇÃO' : 'SEM PRAZO', 'amarelo');
            } elseif ($r['prazo'] < $hoje) {
                $c['situacao'] = sesmt_cel('ATRASADO', 'vermelho');
            } else {
                $c['situacao'] = sesmt_cel('EM ABERTO', 'amarelo');
            }
            break;
        case 'auditorias':
            $e = (int)$r['nc_encontradas'];
            $x = (int)$r['nc_resolvidas'];
            $c['percentual'] = $e > 0 ? sesmt_cel(round($x / $e * 100) . '%', $x >= $e ? 'verde' : 'amarelo') : sesmt_cel('');
            break;
        case 'planos':
            if ($r['status'] === 'REALIZADO') {
                $c['situacao'] = sesmt_cel('REALIZADO', 'verde');
            } elseif ($r['status'] === 'CANCELADO') {
                $c['situacao'] = sesmt_cel('CANCELADO');
            } elseif ($r['conclusao'] && $r['conclusao'] < $hoje) {
                $c['situacao'] = sesmt_cel('ATRASADO', 'vermelho');
            } elseif ($r['conclusao'] && sesmt_dias_entre($hoje, $r['conclusao']) <= 7) {
                $c['situacao'] = sesmt_cel('VENCE EM ' . sesmt_dias_entre($hoje, $r['conclusao']) . ' DIA(S)', 'amarelo');
            } else {
                $c['situacao'] = sesmt_cel($r['conclusao'] ? 'NO PRAZO' : 'SEM PRAZO', $r['conclusao'] ? 'verde' : 'amarelo');
            }
            break;
        case 'epi':
            $s = $ctx['saldo'][(int)$r['id']] ?? ['ent' => 0.0, 'sai' => 0.0];
            $estoque = max(0, $s['ent'] - $s['sai']);
            $c['entradas'] = sesmt_cel(sesmt_fmt_num($s['ent'], 2));
            $c['saidas'] = sesmt_cel(sesmt_fmt_num($s['sai'], 2));
            $c['estoque'] = sesmt_cel(sesmt_fmt_num($estoque, 2));
            if ($r['minimo'] === null || $r['maximo'] === null) {
                $c['situacao_estoque'] = sesmt_cel('');
            } elseif ($estoque <= 0) {
                $c['situacao_estoque'] = sesmt_cel('SEM ESTOQUE', 'vermelho');
            } elseif ($estoque < (float)$r['minimo']) {
                $c['situacao_estoque'] = sesmt_cel('ABAIXO', 'amarelo');
            } elseif ($estoque > (float)$r['maximo']) {
                $c['situacao_estoque'] = sesmt_cel('ACIMA', 'amarelo');
            } else {
                $c['situacao_estoque'] = sesmt_cel('ÓTIMO', 'verde');
            }
            $c['valor'] = sesmt_cel($r['preco'] !== null && $estoque > 0 ? 'R$ ' . sesmt_fmt_num($estoque * (float)$r['preco'], 2) : '');
            $c['situacao'] = ($r['controlar'] ?? 'Sim') === 'Não' ? sesmt_cel('') : sesmt_cel_venc($r['vencimento'], $hoje);
            break;
        case 'mov_epi':
            $e = $ctx['epi'][(int)$r['epi_id']] ?? null;
            $c['ca'] = sesmt_cel($e['ca'] ?? '');
            $c['total'] = sesmt_cel($e && $e['preco'] !== null && $r['qtd'] !== null ? 'R$ ' . sesmt_fmt_num((float)$e['preco'] * (float)$r['qtd'], 2) : '');
            break;
        case 'riscos':
            $p = array_search($r['probabilidade'], ['REMOTA', 'BAIXA', 'MÉDIA', 'ALTA', 'MUITO ALTA'], true);
            $s = array_search($r['severidade'], ['SEM IMPACTO', 'LEVE', 'MÉDIO', 'GRAVE', 'GRAVÍSSIMO'], true);
            if ($p === false || $s === false) {
                $c['valor'] = sesmt_cel('');
                $c['classe'] = sesmt_cel('');
                break;
            }
            $pts = ($p + 1) * ($s + 1);
            $c['valor'] = sesmt_cel($pts);
            $c['classe'] = sesmt_cel('');
            foreach (sesmt_faixas_risco() as $f) {
                if ($pts >= $f[0] && $pts <= $f[1]) {
                    $c['classe'] = sesmt_cel($f[2], $f[3]);
                }
            }
            $c['classe']['num'] = $pts;
            break;
        case 'extintores':
            $prox = $r['data_recarga'] && $r['validade_meses'] ? sesmt_mais_meses($r['data_recarga'], (int)$r['validade_meses']) : null;
            $c['proxima'] = sesmt_cel($prox ? sesmt_fmt_data($prox) : '');
            $c['situacao'] = sesmt_cel_venc($prox, $hoje, $r['data_recarga'] ? '< INFORME A VALIDADE' : '');
            $pt = $r['data_teste'] ? sesmt_mais_dias($r['data_teste'], (int)$ctx['cfg']['hidro_extintor_dias']) : null;
            $c['proximo_teste'] = sesmt_cel($pt ? sesmt_fmt_data($pt) : '');
            $c['situacao2'] = sesmt_cel_venc($pt, $hoje);
            break;
        case 'hidrantes':
            $pt = $r['data_teste'] ? sesmt_mais_dias($r['data_teste'], (int)$ctx['cfg']['hidro_hidrante_dias']) : null;
            $c['proximo_teste'] = sesmt_cel($pt ? sesmt_fmt_data($pt) : '');
            $c['situacao'] = sesmt_cel_venc($pt, $hoje);
            break;
        case 'documentos':
            if (($r['controlar'] ?? 'Sim') === 'Não' || !$r['data']) {
                $c = ['vencimento' => sesmt_cel(''), 'situacao' => sesmt_cel('')];
            } elseif (!$r['validade_meses']) {
                $c = ['vencimento' => sesmt_cel(''), 'situacao' => sesmt_cel('VÁLIDO', 'verde')];
            } else {
                $v = sesmt_mais_meses($r['data'], (int)$r['validade_meses']);
                $c = ['vencimento' => sesmt_cel(sesmt_fmt_data($v)), 'situacao' => sesmt_cel_venc($v, $hoje)];
            }
            break;
    }
    return $c;
}

/** Pior cor entre as situações calculadas da linha (vermelho > amarelo > verde). */
function sesmt_pior_tom(array $calc)
{
    $pior = null;
    foreach ($calc as $k => $cel) {
        if (strpos($k, 'situacao') !== 0 || empty($cel['tom'])) {
            continue;
        }
        $ordem = ['verde' => 1, 'amarelo' => 2, 'vermelho' => 3];
        if ($pior === null || $ordem[$cel['tom']] > $ordem[$pior]) {
            $pior = $cel['tom'];
        }
    }
    return $pior;
}

// ----------------------------------------------------------------- consulta

function sesmt_escapar_like($t)
{
    return str_replace(['!', '%', '_'], ['!!', '!%', '!_'], $t);
}

/** Filtro de busca textual: campos do cadastro e, por referência, os do cadastro ligado (ex.: nome do colaborador). */
function sesmt_where_busca($reg, $q, array &$params, $profundidade = 0)
{
    $def = sesmt_registros()[$reg];
    $ors = [];
    $like = '%' . sesmt_escapar_like($q) . '%';
    foreach ($def['campos'] as $k => $c) {
        if (!empty($c['q'])) {
            if ($c['tipo'] === 'cpf') {
                $dig = sesmt_cpf_digitos($q);
                if (strlen($dig) >= 3) {
                    $ors[] = "`$k` LIKE ? ESCAPE '!'";
                    $params[] = '%' . $dig . '%';
                }
                continue;
            }
            $ors[] = "`$k` LIKE ? ESCAPE '!'";
            $params[] = $like;
        }
    }
    if ($profundidade < 1) {
        foreach (sesmt_campos_ref($reg) as $k => $alvo) {
            $sub = [];
            $w = sesmt_where_busca($alvo, $q, $sub, $profundidade + 1);
            if ($w !== '') {
                $ors[] = "`$k` IN (SELECT id FROM sesmt_$alvo WHERE obra_id = ? AND ($w))";
                $params[] = obra_atual_id();
                foreach ($sub as $p) {
                    $params[] = $p;
                }
            }
        }
    }
    return implode(' OR ', $ors);
}

function sesmt_empresa_da_linha($reg, array $r, array $ctx)
{
    $def = sesmt_registros()[$reg];
    if (isset($def['campos']['empresa'])) {
        return (string)$r['empresa'];
    }
    foreach (sesmt_campos_ref($reg) as $k => $alvo) {
        if ($alvo === 'colaboradores' && !empty($r[$k]) && isset($ctx['colaboradores'][(int)$r[$k]])) {
            return (string)$ctx['colaboradores'][(int)$r[$k]]['empresa'];
        }
    }
    return '';
}

/**
 * Lista os registros da obra com filtros. Filtros: empresa, q (busca), sit (critico|atencao|ok).
 * Devolve cada linha com 'calc' (colunas calculadas), 'empresa_exib' e 'tom'.
 */
function sesmt_listar($reg, array $filtros = [])
{
    $def = sesmt_registros()[$reg];
    $t = sesmt_tabela($reg);
    $obra = obra_atual_id();
    $where = ['obra_id = ?'];
    $params = [$obra];
    $emp = sesmt_norm_empresa($filtros['empresa'] ?? '');
    if ($emp !== '') {
        if (isset($def['campos']['empresa'])) {
            $where[] = 'empresa = ?';
            $params[] = $emp;
        } else {
            $ors = [];
            foreach (sesmt_campos_ref($reg) as $k => $alvo) {
                if ($alvo === 'colaboradores') {
                    $ors[] = "`$k` IN (SELECT id FROM sesmt_colaboradores WHERE obra_id = ? AND empresa = ?)";
                    $params[] = $obra;
                    $params[] = $emp;
                }
            }
            if ($ors) {
                $where[] = '(' . implode(' OR ', $ors) . ')';
            }
        }
    }
    $q = trim((string)($filtros['q'] ?? ''));
    if ($q !== '') {
        $sub = [];
        $w = sesmt_where_busca($reg, $q, $sub);
        if ($w !== '') {
            $where[] = "($w)";
            foreach ($sub as $p) {
                $params[] = $p;
            }
        }
    }
    foreach (($filtros['igual'] ?? []) as $campo => $valor) {
        if (isset($def['campos'][$campo]) && $valor !== '' && $valor !== null) {
            $where[] = "`$campo` = ?";
            $params[] = $valor;
        }
    }
    $linhas = q_global("SELECT * FROM $t WHERE " . implode(' AND ', $where) . ' ORDER BY ' . $def['ordem'], $params)->fetchAll();
    $ctx = sesmt_contexto($reg);
    $sit = $filtros['sit'] ?? '';
    $mapaTom = ['critico' => 'vermelho', 'atencao' => 'amarelo', 'ok' => 'verde'];
    $saida = [];
    foreach ($linhas as $r) {
        $calc = sesmt_calcular($reg, $r, $ctx);
        $tom = sesmt_pior_tom($calc);
        if ($sit !== '' && isset($mapaTom[$sit]) && $tom !== $mapaTom[$sit]) {
            continue;
        }
        $r['calc'] = $calc;
        $r['tom'] = $tom;
        $r['empresa_exib'] = sesmt_empresa_da_linha($reg, $r, $ctx);
        $r['refs'] = [];
        foreach (sesmt_campos_ref($reg) as $k => $alvo) {
            $r['refs'][$k] = !empty($r[$k]) && isset($ctx[$alvo][(int)$r[$k]]) ? sesmt_ref_rotulo($alvo, $ctx[$alvo][(int)$r[$k]]) : '';
            if ($alvo === 'colaboradores') {
                $r['refs'][$k] = !empty($r[$k]) && isset($ctx[$alvo][(int)$r[$k]]) ? $ctx[$alvo][(int)$r[$k]]['nome'] : '';
            }
        }
        $saida[] = $r;
    }
    return $saida;
}

function sesmt_obter($reg, $id)
{
    $r = q_global('SELECT * FROM ' . sesmt_tabela($reg) . ' WHERE id = ? AND obra_id = ?', [(int)$id, obra_atual_id()])->fetch();
    return $r ?: null;
}

// ----------------------------------------------------------------- gravação

function sesmt_normalizar_campo($reg, $k, array $c, $bruto, array &$erros, $idAtual)
{
    $rot = $c['rotulo'];
    $tipo = explode(':', $c['tipo'])[0];
    $lista = strpos($c['tipo'], ':') !== false ? explode(':', $c['tipo'])[1] : null;
    $v = is_string($bruto) ? trim($bruto) : $bruto;
    if ($v === '' || $v === null) {
        if (!empty($c['r'])) {
            $erros[] = "$rot é obrigatório.";
        }
        return null;
    }
    switch ($tipo) {
        case 'txt':
            if (mb_strlen($v, 'UTF-8') > 255) {
                $erros[] = "$rot aceita até 255 caracteres.";
            }
            return $v;
        case 'longo':
            if (mb_strlen($v, 'UTF-8') > 20000) {
                $erros[] = "$rot aceita até 20.000 caracteres.";
            }
            return $v;
        case 'num':
            $n = numero($v);
            if ($n === null) {
                $erros[] = "$rot deve ser um número.";
                return null;
            }
            if ($n < 0) {
                $erros[] = "$rot não pode ser negativo.";
            }
            return $n;
        case 'int':
            if (!preg_match('/^\d{1,9}$/', (string)$v)) {
                $erros[] = "$rot deve ser um número inteiro, sem sinal.";
                return null;
            }
            return (int)$v;
        case 'data':
            $d = sesmt_data_iso($v);
            if ($d === false) {
                $erros[] = "$rot tem uma data inválida.";
                return null;
            }
            return $d;
        case 'hora':
            if (!preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', $v)) {
                $erros[] = "$rot deve estar no formato HH:MM.";
                return null;
            }
            return $v;
        case 'cpf':
            $d = sesmt_cpf_digitos($v);
            if (!sesmt_cpf_valido($d)) {
                $erros[] = 'CPF inválido. Confira os 11 dígitos.';
                return null;
            }
            $dup = q_global('SELECT id FROM sesmt_colaboradores WHERE obra_id = ? AND cpf = ? AND id <> ?', [obra_atual_id(), $d, (int)$idAtual])->fetchColumn();
            if ($dup) {
                $erros[] = 'Já existe um colaborador com este CPF.';
            }
            return $d;
        case 'empresa':
            $e = sesmt_norm_empresa($v);
            if (mb_strlen($e, 'UTF-8') > 100) {
                $erros[] = "$rot aceita até 100 caracteres.";
            }
            return $e;
        case 'lista':
            $opcoes = sesmt_opcoes($lista);
            $atual = $idAtual ? (sesmt_obter($reg, $idAtual)[$k] ?? null) : null;
            if (!in_array($v, $opcoes, true) && $v !== $atual) {
                $erros[] = "$rot: escolha um valor da lista.";
            }
            return $v;
        case 'ref':
            $alvo = $lista;
            if (!preg_match('/^\d+$/', (string)$v) || !sesmt_obter($alvo, (int)$v)) {
                $erros[] = "$rot: escolha um item cadastrado.";
                return null;
            }
            return (int)$v;
    }
    return $v;
}

/** Regras entre campos. Recebe os dados já normalizados e devolve a lista de erros. */
function sesmt_validar($reg, array $d, $id)
{
    $e = [];
    switch ($reg) {
        case 'colaboradores':
            if ($d['admissao'] && $d['desligamento'] && $d['desligamento'] < $d['admissao']) {
                $e[] = 'A data do desligamento não pode ser anterior à admissão.';
            }
            if ($d['nascimento'] && $d['nascimento'] > sesmt_hoje()) {
                $e[] = 'O nascimento não pode estar no futuro.';
            }
            break;
        case 'treinamentos':
            if ($d['data_inicial'] && $d['data_final'] && $d['data_final'] < $d['data_inicial']) {
                $e[] = 'A data final não pode ser anterior à data inicial.';
            }
            break;
        case 'aso':
            if ($d['validade_dias'] !== null && $d['validade_dias'] < 1) {
                $e[] = 'A validade do ASO deve ter ao menos 1 dia.';
            }
            break;
        case 'acidentes':
            if ($d['data'] && $d['data_retorno'] && $d['data_retorno'] < $d['data']) {
                $e[] = 'A data de retorno não pode ser anterior à data do acidente.';
            }
            if ($d['data'] && $d['data'] > sesmt_hoje()) {
                $e[] = 'A data do acidente não pode estar no futuro.';
            }
            break;
        case 'desvios':
            if ($d['data'] && $d['conclusao'] && $d['conclusao'] < $d['data']) {
                $e[] = 'A conclusão não pode ser anterior à data do desvio.';
            }
            break;
        case 'auditorias':
            if ($d['nc_encontradas'] !== null && $d['nc_resolvidas'] !== null && $d['nc_resolvidas'] > $d['nc_encontradas']) {
                $e[] = 'As não conformidades resolvidas não podem passar das encontradas.';
            }
            break;
        case 'epi':
            if ($d['minimo'] !== null && $d['maximo'] !== null && $d['maximo'] < $d['minimo']) {
                $e[] = 'O estoque máximo não pode ser menor que o mínimo.';
            }
            break;
        case 'mov_epi':
            if ($d['parte'] === 'Funcionário' && !$d['colaborador_id']) {
                $e[] = 'Escolha o colaborador quando a movimentação for de funcionário.';
            }
            if ($d['parte'] === 'Fornecedor' && !$d['fornecedor']) {
                $e[] = 'Informe o fornecedor.';
            }
            if ($d['qtd'] !== null && $d['qtd'] <= 0) {
                $e[] = 'A quantidade deve ser maior que zero.';
            }
            if ($d['movimento'] === 'SAÍDA' && $d['epi_id'] && $d['qtd']) {
                $s = sesmt_saldo_epi($id)[(int)$d['epi_id']] ?? ['ent' => 0.0, 'sai' => 0.0];
                $disp = $s['ent'] - $s['sai'];
                if ($d['qtd'] > $disp + 1e-9) {
                    $e[] = 'Estoque insuficiente: há ' . sesmt_fmt_num(max(0, $disp), 2) . ' disponível(is) deste EPI.';
                }
            }
            break;
        case 'presenca':
            $dup = q_global('SELECT id FROM sesmt_presenca WHERE obra_id = ? AND treinamento_id = ? AND colaborador_id = ? AND id <> ?',
                [obra_atual_id(), (int)$d['treinamento_id'], (int)$d['colaborador_id'], (int)$id])->fetchColumn();
            if ($dup) {
                $e[] = 'Este colaborador já está na lista de presença do treinamento.';
            }
            break;
    }
    return $e;
}

function sesmt_dados_do_post($reg, array $post, $id)
{
    $erros = [];
    $dados = [];
    foreach (sesmt_registros()[$reg]['campos'] as $k => $c) {
        $dados[$k] = sesmt_normalizar_campo($reg, $k, $c, $post[$k] ?? null, $erros, $id);
    }
    if (!$erros) {
        $erros = sesmt_validar($reg, $dados, $id);
    }
    return [$dados, $erros];
}

/** Grava (insere ou atualiza). Devolve [id, erros]. */
function sesmt_salvar($reg, $id, array $post)
{
    $def = sesmt_registros()[$reg];
    if ($id && !sesmt_obter($reg, $id)) {
        return [0, ['Registro não encontrado.']];
    }
    list($dados, $erros) = sesmt_dados_do_post($reg, $post, $id);
    if ($erros) {
        return [(int)$id, $erros];
    }
    $t = sesmt_tabela($reg);
    $agora = sesmt_agora();
    $novo = !$id;
    if ($id) {
        $sets = [];
        $p = [];
        foreach ($dados as $k => $v) {
            $sets[] = "`$k` = ?";
            $p[] = $v;
        }
        $sets[] = 'atualizado_em = ?';
        $p[] = $agora;
        $p[] = (int)$id;
        $p[] = obra_atual_id();
        q_global("UPDATE $t SET " . implode(', ', $sets) . ' WHERE id = ? AND obra_id = ?', $p);
    } else {
        $cols = array_keys($dados);
        $marcas = implode(', ', array_fill(0, count($cols) + 3, '?'));
        $p = array_merge([obra_atual_id(), $agora, $agora], array_values($dados));
        q_global("INSERT INTO $t (obra_id, criado_em, atualizado_em, `" . implode('`, `', $cols) . "`) VALUES ($marcas)", $p);
        $id = (int)bd()->lastInsertId();
    }
    registrar_global($novo ? 'sesmt_criar' : 'sesmt_salvar', ['cadastro' => $reg, 'id' => (int)$id, 'obra' => obra_atual_id()]);
    return [(int)$id, []];
}

/** Lista de presença: um treinamento, vários colaboradores. Devolve [incluídos, ignorados, erros]. */
function sesmt_salvar_presenca_lote($treinamentoId, array $colaboradores, $obs)
{
    if (!sesmt_obter('treinamentos', $treinamentoId)) {
        return [0, 0, ['Escolha o treinamento.']];
    }
    $ok = 0;
    $ignorados = 0;
    foreach (array_unique(array_map('intval', $colaboradores)) as $cid) {
        if ($cid <= 0 || !sesmt_obter('colaboradores', $cid)) {
            continue;
        }
        $dup = q_global('SELECT 1 FROM sesmt_presenca WHERE obra_id = ? AND treinamento_id = ? AND colaborador_id = ?', [obra_atual_id(), (int)$treinamentoId, $cid])->fetchColumn();
        if ($dup) {
            $ignorados++;
            continue;
        }
        $agora = sesmt_agora();
        q_global('INSERT INTO sesmt_presenca (obra_id, criado_em, atualizado_em, treinamento_id, colaborador_id, obs) VALUES (?, ?, ?, ?, ?, ?)',
            [obra_atual_id(), $agora, $agora, (int)$treinamentoId, $cid, $obs !== '' ? mb_substr($obs, 0, 255, 'UTF-8') : null]);
        $ok++;
    }
    if ($ok) {
        registrar_global('sesmt_presenca_lote', ['treinamento' => (int)$treinamentoId, 'incluidos' => $ok, 'obra' => obra_atual_id()]);
    }
    return [$ok, $ignorados, $ok || $ignorados ? [] : ['Marque ao menos um colaborador.']];
}

/** Quem depende deste registro (impede apagar o que está em uso). */
function sesmt_dependentes($reg, $id)
{
    $out = [];
    foreach (sesmt_registros() as $outro => $def) {
        foreach (sesmt_campos_ref($outro) as $campo => $alvo) {
            if ($alvo === $reg) {
                $n = (int)q_global("SELECT COUNT(*) FROM sesmt_$outro WHERE obra_id = ? AND `$campo` = ?", [obra_atual_id(), (int)$id])->fetchColumn();
                if ($n) {
                    $out[] = $n . ' em ' . $def['titulo'];
                }
            }
        }
    }
    return $out;
}

function sesmt_excluir($reg, $id)
{
    if (!sesmt_obter($reg, $id)) {
        return 'Registro não encontrado.';
    }
    $dep = sesmt_dependentes($reg, $id);
    if ($dep) {
        return 'Não é possível excluir: há registros vinculados (' . implode(', ', $dep) . '). Remova-os antes'
            . ($reg === 'colaboradores' ? ' ou mude o status do colaborador para Demitido.' : '.');
    }
    q_global('DELETE FROM ' . sesmt_tabela($reg) . ' WHERE id = ? AND obra_id = ?', [(int)$id, obra_atual_id()]);
    registrar_global('sesmt_excluir', ['cadastro' => $reg, 'id' => (int)$id, 'obra' => obra_atual_id()]);
    return '';
}

// ----------------------------------------------------------------- painel (indicadores)

function sesmt_painel()
{
    $hoje = sesmt_hoje();
    $cfg = sesmt_cfg();
    $ano = (int)substr($hoje, 0, 4);
    $p = ['hoje' => $hoje, 'cfg' => $cfg];

    // colaboradores
    $colabs = sesmt_mapa('colaboradores');
    $ativos = array_filter($colabs, function ($c) { return $c['status'] !== 'Demitido'; });
    $p['colab_total'] = count($colabs);
    $p['colab_ativos'] = count($ativos);
    $porEmp = [];
    foreach ($ativos as $c) {
        $e = $c['empresa'] ?: 'SEM EMPRESA';
        $porEmp[$e] = $porEmp[$e] ?? ['ativos' => 0, 'aso' => 0, 'sem_aso' => 0, 'trein' => 0, 'acid' => 0, 'adv' => 0];
        $porEmp[$e]['ativos']++;
    }

    // ASO: situação do ASO vigente de cada colaborador ativo
    $melhor = [];
    foreach (sesmt_mapa('aso') as $a) {
        if (($a['atualizou'] ?? '') === 'Sim' || !$a['data_emissao'] || !$a['validade_dias']) {
            continue;
        }
        $v = sesmt_mais_dias($a['data_emissao'], (int)$a['validade_dias']);
        $cid = (int)$a['colaborador_id'];
        if (!isset($melhor[$cid]) || $v > $melhor[$cid]) {
            $melhor[$cid] = $v;
        }
    }
    $aso = ['vencidos' => 0, 'a_vencer' => 0, 'sem_aso' => 0, 'validos' => 0];
    foreach ($ativos as $id => $c) {
        $e = $c['empresa'] ?: 'SEM EMPRESA';
        if (!isset($melhor[$id])) {
            $aso['sem_aso']++;
            $porEmp[$e]['sem_aso']++;
            continue;
        }
        $s = sesmt_situacao_validade($melhor[$id], $hoje);
        if ($s['tom'] === 'vermelho') {
            $aso['vencidos']++;
            $porEmp[$e]['aso']++;
        } elseif ($s['tom'] === 'amarelo') {
            $aso['a_vencer']++;
        } else {
            $aso['validos']++;
        }
    }
    $p['aso'] = $aso;

    // treinamentos e presença
    $trein = sesmt_mapa('treinamentos');
    $tr = ['vencidos' => 0, 'a_vencer' => 0, 'validos' => 0];
    foreach ($trein as $t) {
        $s = sesmt_validade_treinamento($t, $hoje)['cel'];
        if ($s['tom'] === 'vermelho') {
            $tr['vencidos']++;
        } elseif ($s['tom'] === 'amarelo') {
            $tr['a_vencer']++;
        } elseif ($s['tom'] === 'verde') {
            $tr['validos']++;
        }
    }
    $p['trein'] = $tr;
    foreach (sesmt_mapa('presenca') as $pr) {
        $t = $trein[(int)$pr['treinamento_id']] ?? null;
        $col = $colabs[(int)$pr['colaborador_id']] ?? null;
        if ($t && $col && $col['status'] !== 'Demitido' && sesmt_validade_treinamento($t, $hoje)['cel']['tom'] === 'vermelho') {
            $porEmp[$col['empresa'] ?: 'SEM EMPRESA']['trein']++;
        }
    }

    // acidentes
    $ult = null;
    $acAno = 0;
    $afast = 0;
    $diasPerdidos = 0;
    foreach (sesmt_mapa('acidentes') as $a) {
        if (!$a['data']) {
            continue;
        }
        if ($ult === null || $a['data'] > $ult) {
            $ult = $a['data'];
        }
        if ((int)substr($a['data'], 0, 4) === $ano) {
            $acAno++;
            $col = $colabs[(int)$a['colaborador_id']] ?? null;
            $e = $col ? ($col['empresa'] ?: 'SEM EMPRESA') : null;
            if ($e && isset($porEmp[$e])) {
                $porEmp[$e]['acid']++;
            } elseif ($e) {
                $porEmp[$e] = ['ativos' => 0, 'aso' => 0, 'sem_aso' => 0, 'trein' => 0, 'acid' => 1, 'adv' => 0];
            }
            if ($a['afastamento'] === 'Sim') {
                $afast++;
                if ($a['data_retorno'] && $a['data_retorno'] >= $a['data']) {
                    $diasPerdidos += sesmt_dias_entre($a['data'], $a['data_retorno']);
                }
            }
        }
    }
    $horas = $p['colab_ativos'] * $cfg['jornada'] * $cfg['dias_mes'] * (int)substr($hoje, 5, 2);
    $p['acid'] = [
        'ultimo' => $ult, 'dias_sem' => $ult ? sesmt_dias_entre($ult, $hoje) : null, 'meta' => (int)$cfg['meta_dias'],
        'ano' => $acAno, 'afastamento' => $afast, 'dias_perdidos' => $diasPerdidos, 'horas' => $horas,
        'tf' => $horas > 0 ? $afast * 1000000 / $horas : null, 'tg' => $horas > 0 ? $diasPerdidos * 1000000 / $horas : null,
    ];

    foreach (sesmt_mapa('advertencias') as $a) {
        $col = $colabs[(int)$a['colaborador_id']] ?? null;
        if ($col && $a['data'] && (int)substr($a['data'], 0, 4) === $ano) {
            $e = $col['empresa'] ?: 'SEM EMPRESA';
            if (isset($porEmp[$e])) {
                $porEmp[$e]['adv']++;
            }
        }
    }
    ksort($porEmp);
    $p['por_empresa'] = $porEmp;

    // alertas dos demais cadastros: contagem por cor da situação calculada
    $alertas = [];
    $alvos = [
        ['documentos', 'Documentos', 'situacao'], ['epi', 'Validade dos EPIs', 'situacao'], ['epi', 'Estoque de EPI', 'situacao_estoque'],
        ['extintores', 'Recarga de extintores', 'situacao'], ['extintores', 'Teste hidrostático dos extintores', 'situacao2'],
        ['hidrantes', 'Teste dos hidrantes', 'situacao'], ['cipa', 'Mandatos da CIPA', 'situacao'], ['cipa', 'Estabilidade da CIPA', 'situacao2'],
        ['desvios', 'Ações de desvios e incidentes', 'situacao'], ['planos', 'Planos 5W2H', 'situacao'],
    ];
    foreach ($alvos as $a) {
        $ctx = sesmt_contexto($a[0]);
        $n = ['vermelho' => 0, 'amarelo' => 0, 'verde' => 0];
        foreach (q_global('SELECT * FROM ' . sesmt_tabela($a[0]) . ' WHERE obra_id = ?', [obra_atual_id()])->fetchAll() as $r) {
            $cel = sesmt_calcular($a[0], $r, $ctx)[$a[2]] ?? null;
            if ($cel && $cel['tom']) {
                $n[$cel['tom']]++;
            }
        }
        $alertas[] = ['reg' => $a[0], 'rotulo' => $a[1], 'campo' => $a[2], 'n' => $n];
    }
    $p['alertas'] = $alertas;
    $nc = 0;
    foreach (sesmt_mapa('auditorias') as $a) {
        $nc += max(0, (int)$a['nc_encontradas'] - (int)$a['nc_resolvidas']);
    }
    $p['nc_pendentes'] = $nc;
    return $p;
}
