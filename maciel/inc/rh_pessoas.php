<?php
// Cadastro central de colaboradores da EMPRESA (Painel pessoal): a pessoa existe na empresa, esteja ou não alocada numa obra.
// Alocação = obra onde ela trabalha agora (pode ficar vazia: "sem obra / quadro da empresa") e pode mudar quando quiser.
// Cada colaborador tem seus documentos (NR, documentos pessoais, contrato, certificados…) gravados na ficha dele.
// Os colaboradores cadastrados DENTRO de cada obra (Gestão › Pessoal, ligados ao SESMT) continuam existindo e entram na folha como antes;
// este cadastro é o da empresa. Salário e custo só aparecem para quem tem a área Financeiro (rh_pode_ver_salarios).

require_once __DIR__ . '/rh_custos.php';
require_once __DIR__ . '/sesmt_modelo.php';

function rhp_status_lista()
{
    return ['Contratado', 'Experiência', 'Jovem aprendiz', 'Autônomo', 'PJ', 'Estágio', 'Afastado', 'Demitido'];
}

function rhp_tipos_documento()
{
    return ['Documento pessoal (RG / CPF / CNH)', 'CTPS', 'Comprovante de residência', 'Contrato de trabalho', 'ASO (atestado de saúde)', 'NR-06 (EPI)', 'NR-10 (eletricidade)', 'NR-12 (máquinas)',
        'NR-18 (construção civil)', 'NR-33 (espaço confinado)', 'NR-35 (trabalho em altura)', 'Outra NR / certificado de treinamento', 'Ficha de EPI', 'Ordem de serviço (OS)', 'Atestado / afastamento', 'Advertência',
        'Habilitação / registro profissional (CREA…)', 'Outro documento'];
}

function rhp_extensoes_documento()
{
    return ['pdf', 'jpg', 'jpeg', 'png', 'webp', 'doc', 'docx', 'xls', 'xlsx', 'zip'];
}

function garantir_rh_pessoas()
{
    static $ok = false;
    if ($ok) { return; }
    $sqlite = (config()['driver'] ?? 'mysql') === 'sqlite';
    $pk = $sqlite ? 'INTEGER PRIMARY KEY AUTOINCREMENT' : 'INT AUTO_INCREMENT PRIMARY KEY';
    $longo = $sqlite ? 'TEXT' : 'MEDIUMTEXT';
    $fim = $sqlite ? '' : ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4';
    bd()->exec("CREATE TABLE IF NOT EXISTS rh_pessoas (id $pk, organizacao_id INT NOT NULL DEFAULT 0, nome VARCHAR(160) NOT NULL, cpf VARCHAR(14) NULL, rg VARCHAR(30) NULL,
        nascimento DATE NULL, sexo VARCHAR(12) NULL, celular VARCHAR(30) NULL, email VARCHAR(150) NULL, endereco VARCHAR(255) NULL, funcao VARCHAR(100) NULL, setor VARCHAR(60) NULL,
        empresa VARCHAR(120) NULL, status VARCHAR(20) NOT NULL DEFAULT 'Contratado', admissao DATE NULL, desligamento DATE NULL, obra_id INT NULL, alocado_em DATE NULL,
        tipo_salario VARCHAR(8) NOT NULL DEFAULT 'Mensal', salario DOUBLE NULL, adicional VARCHAR(30) NULL, vale_transporte DOUBLE NULL, alimentacao DOUBLE NULL, outros_beneficios DOUBLE NULL,
        ctps VARCHAR(30) NULL, serie VARCHAR(20) NULL, obs $longo NULL, criado_por INT NOT NULL DEFAULT 0, criado_em VARCHAR(19) NULL, atualizado_em VARCHAR(19) NULL)$fim");
    bd()->exec("CREATE TABLE IF NOT EXISTS rh_documentos (id $pk, organizacao_id INT NOT NULL DEFAULT 0, origem VARCHAR(1) NOT NULL DEFAULT 'p', pessoa_id INT NOT NULL, obra_id INT NULL,
        tipo VARCHAR(80) NOT NULL, titulo VARCHAR(160) NULL, validade DATE NULL, arquivo VARCHAR(80) NOT NULL, arquivo_nome VARCHAR(200) NOT NULL, mime VARCHAR(80) NULL,
        tamanho INT NOT NULL DEFAULT 0, enviado_por VARCHAR(100) NULL, enviado_em VARCHAR(19) NULL)$fim");
    if ((int)global_ler('rh_esquema', 0) < 2) {   // cidade e estado do colaborador (endereço completo)
        foreach (['cidade VARCHAR(100) NULL', 'uf VARCHAR(2) NULL'] as $col_) { try { bd()->exec('ALTER TABLE rh_pessoas ADD COLUMN ' . $col_); } catch (Throwable $e) { /* já existe */ } }
        global_gravar('rh_esquema', '2');
    }
    try { bd()->exec('CREATE INDEX idx_rh_pessoas_org ON rh_pessoas (organizacao_id, obra_id)'); } catch (Throwable $e) { /* já existe */ }
    try { bd()->exec('CREATE INDEX idx_rh_doc_pessoa ON rh_documentos (origem, pessoa_id)'); } catch (Throwable $e) { /* já existe */ }
    $ok = true;
}

/** Empresa cliente do usuário e se ele vê todas (administrador do sistema). */
function rhp_contexto(array $u)
{
    list($org) = usuario_organizacao_id($u);
    return ['org' => (int)$org, 'todas' => ($u['perfil'] ?? '') === 'admin', 'uid' => (int)$u['id']];
}

/** Condição SQL que limita os colaboradores ao que o usuário pode ver. */
function rhp_escopo(array $u, $alias = '')
{
    $c = rhp_contexto($u);
    $a = $alias !== '' ? $alias . '.' : '';
    if ($c['todas']) { return ['1=1', []]; }
    if ($c['org'] > 0) { return [$a . 'organizacao_id = ?', [$c['org']]]; }
    return ['(' . $a . 'organizacao_id = 0 AND ' . $a . 'criado_por = ?)', [$c['uid']]];
}

function rhp_obter($id, array $u)
{
    garantir_rh_pessoas();
    list($w, $p) = rhp_escopo($u);
    $r = q_global("SELECT * FROM rh_pessoas WHERE id = ? AND $w", array_merge([(int)$id], $p))->fetch();
    return $r ?: null;
}

/** Obras que o usuário pode escolher na alocação: as obras ativas que ele administra (a lista do Painel das obras). */
function rhp_obras_permitidas(array $u)
{
    $r = [];
    foreach (dashobras_obras_do_usuario($u) as $o) { $r[(int)$o['id']] = $o['nome']; }
    return $r;
}

/** Erros de validação do formulário, por campo (campo => mensagem). */
class RhpValidacao extends InvalidArgumentException
{
    public $campos;
    public function __construct(array $campos)
    {
        $this->campos = $campos;
        parent::__construct(count($campos) === 1 ? reset($campos) : 'Corrija os ' . count($campos) . ' campos marcados em vermelho.');
    }
}

function rhp_data($v, $rot)
{
    $v = trim((string)$v);
    if ($v === '') { return null; }
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $v) || !checkdate((int)substr($v, 5, 2), (int)substr($v, 8, 2), (int)substr($v, 0, 4))) {
        throw new InvalidArgumentException($rot . ' inválida.');
    }
    return $v;
}

function rhp_valor($v)
{
    $n = numero($v);
    return $n === null ? null : round((float)$n, 2);
}

// ---------------------------------------------------------------- listas de função e de setor (escolha na lista + cadastro de nova)

function rhp_ufs()
{
    return ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];
}

function rhp_listas_padrao()
{
    return [
        'funcao' => ['Montador', 'Soldador', 'Ajudante', 'Encarregado', 'Mestre de obras', 'Engenheiro', 'Técnico em segurança', 'Almoxarife', 'Auxiliar administrativo', 'Operador de equipamento', 'Projetista'],
        'setor' => ['Operacional', 'Administrativo', 'Projetos', 'SMS', 'Financeiro', 'Comercial'],
    ];
}

/** Opções de função ou setor: as padrão + as cadastradas pela empresa + as já usadas nos colaboradores. $org = 0 junta as de todas as empresas (administrador do sistema). */
function rhp_opcoes($campo, $org = 0)
{
    $campo = $campo === 'setor' ? 'setor' : 'funcao';
    $padrao = rhp_listas_padrao();
    $tudo = $padrao[$campo];
    $custom = cfg_json_ler('rh_listas');
    foreach ($custom as $o => $l) {
        if ($org > 0 && (int)$o !== (int)$org && (int)$o !== 0) { continue; }   // chave 0 = lista de todas as empresas
        foreach ((array)($l[$campo] ?? []) as $v) { $tudo[] = (string)$v; }
    }
    garantir_rh_pessoas();
    $sql = "SELECT DISTINCT $campo FROM rh_pessoas WHERE $campo IS NOT NULL AND $campo <> ''" . ($org > 0 ? ' AND organizacao_id = ?' : '');
    foreach (q_global($sql, $org > 0 ? [(int)$org] : [])->fetchAll(PDO::FETCH_COLUMN) as $v) { $tudo[] = (string)$v; }
    $out = [];
    foreach ($tudo as $v) { $v = trim($v); if ($v !== '' && !isset($out[mb_strtolower($v)])) { $out[mb_strtolower($v)] = $v; } }
    $v = array_values($out);
    usort($v, function ($a, $b) { return strcasecmp($a, $b); });
    return $v;
}

/** Guarda uma função/setor novo na lista da empresa. Devolve o nome gravado (se já existe, devolve o nome que já estava na lista). */
function rhp_opcao_adicionar($campo, $org, $valor, $todas = false)
{
    if ($todas) { $org = 0; }   // vale para todas as empresas e usuários
    $campo = $campo === 'setor' ? 'setor' : 'funcao';
    $valor = trim(preg_replace('/\s+/u', ' ', (string)$valor));
    $t = cfg_json_ler('rh_listas');
    $ja = $todas ? array_merge(rhp_listas_padrao()[$campo], (array)($t['0'][$campo] ?? [])) : rhp_opcoes($campo, (int)$org);
    foreach ($ja as $o) { if (mb_strtolower($o) === mb_strtolower($valor)) { return $o; } }
    $t[(string)(int)$org][$campo][] = $valor;
    global_gravar('rh_listas', json_encode($t, JSON_UNESCAPED_UNICODE));
    return $valor;
}

/** Valida o formulário e grava (novo ou edição). Salário e benefícios só mudam para quem pode ver salários. Devolve o id. */
function rhp_salvar(array $post, array $u, $id = 0)
{
    garantir_rh_pessoas();
    $ver = rh_pode_ver_salarios($u);
    $ctx = rhp_contexto($u);
    $atual = $id ? rhp_obter($id, $u) : null;
    if ($id && !$atual) { throw new InvalidArgumentException('Colaborador não encontrado.'); }
    $erros = [];   // campo => o que falta/está errado (mostrado em vermelho embaixo de cada campo)
    $data = function ($campo, $rot) use ($post, &$erros) {
        try { return rhp_data($post[$campo] ?? '', $rot); } catch (InvalidArgumentException $e) { $erros[$campo] = $rot . ' inválida: use o formato dd/mm/aaaa com uma data que exista.'; return null; }
    };
    $nome = trim(preg_replace('/\s+/u', ' ', (string)($post['nome'] ?? '')));
    if ($nome === '') { $erros['nome'] = 'Falta preencher o nome completo do colaborador.'; }
    elseif (mb_strlen($nome) < 3) { $erros['nome'] = 'O nome está curto demais: informe o nome completo (mínimo 3 letras).'; }
    $cpf = sesmt_cpf_digitos($post['cpf'] ?? '');
    if ($cpf !== '') {
        if (!sesmt_cpf_valido($cpf)) { $erros['cpf'] = (strlen($cpf) !== 11 ? 'CPF incompleto: tem ' . strlen($cpf) . ' números e precisa ter 11.' : 'CPF inválido: os números digitados não formam um CPF válido, confira.'); }
        else {
            list($w, $p) = rhp_escopo($u);
            $dup = q_global("SELECT nome FROM rh_pessoas WHERE cpf = ? AND id <> ? AND $w", array_merge([$cpf, (int)$id], $p))->fetchColumn();
            if ($dup) { $erros['cpf'] = 'Já existe um colaborador com este CPF (' . $dup . ').'; }
        }
    }
    $status = (string)($post['status'] ?? 'Contratado');
    if (!in_array($status, rhp_status_lista(), true)) { $erros['status'] = 'Escolha uma situação da lista.'; }
    $email = trim((string)($post['email'] ?? ''));
    if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) { $erros['email'] = 'E-mail inválido: use o formato nome@empresa.com.'; }
    $adm = $data('admissao', 'Data de admissão');
    $des = $data('desligamento', 'Data de desligamento');
    $nasc = $data('nascimento', 'Nascimento');
    if ($adm && $des && $des < $adm) { $erros['desligamento'] = 'O desligamento não pode ser antes da admissão.'; }
    // empresa cliente: a do usuário; o administrador do sistema informa qual
    $org = $atual ? (int)$atual['organizacao_id'] : ($ctx['todas'] ? (int)($post['org'] ?? 0) : $ctx['org']);
    if ($ctx['todas'] && !$atual && $org <= 0) { $erros['org'] = 'Falta escolher a empresa cliente do colaborador.'; }
    // alocação
    $obraId = (int)($post['obra_id'] ?? 0);
    $obras = rhp_obras_permitidas($u);
    if ($obraId > 0 && !isset($obras[$obraId])) { $erros['obra_id'] = 'Obra inválida para este usuário: escolha uma da lista.'; }
    $alocadoEm = $atual ? ($atual['alocado_em'] ?? null) : null;
    $obraAntes = $atual ? (int)($atual['obra_id'] ?? 0) : 0;
    if ($obraId !== $obraAntes) { $alocadoEm = $obraId > 0 ? ($data('alocado_em', 'Data da alocação') ?: planos_hoje()) : null; }
    elseif ($obraId > 0 && !empty($post['alocado_em'])) { $alocadoEm = $data('alocado_em', 'Data da alocação'); }
    // função e setor: escolhidos na lista ou cadastrados na hora ("__nova")
    $rotulos = ['funcao' => 'função', 'setor' => 'setor'];
    $novo = ['funcao' => 'a nova função', 'setor' => 'o novo setor'];
    $escolha = [];
    foreach ($rotulos as $c_ => $r_) {
        $v_ = trim((string)($post[$c_] ?? ''));
        if ($v_ === '__nova') {
            $novo_ = trim(preg_replace('/\s+/u', ' ', (string)($post[$c_ . '_nova'] ?? '')));
            if ($novo_ === '') { $erros[$c_] = 'Falta digitar o nome d' . $novo[$c_] . '.'; }
            elseif (mb_strlen($novo_) < 2 || mb_strlen($novo_) > 60) { $erros[$c_] = 'O nome d' . $novo[$c_] . ' deve ter de 2 a 60 letras.'; }
            else { $escolha[$c_] = ['novo' => $novo_]; }
        } else { $escolha[$c_] = ['valor' => mb_substr($v_, 0, 100)]; }
    }
    $cidade = trim(preg_replace('/\s+/u', ' ', (string)($post['cidade'] ?? '')));
    if (mb_strlen($cidade) > 100) { $erros['cidade'] = 'A cidade passou de 100 letras.'; }
    $uf = strtoupper(trim((string)($post['uf'] ?? '')));
    if ($uf !== '' && !in_array($uf, rhp_ufs(), true)) { $erros['uf'] = 'Escolha um estado da lista.'; }
    if (($cidade !== '' && $uf === '') && !isset($erros['uf'])) { $erros['uf'] = 'Falta escolher o estado da cidade ' . $cidade . '.'; }
    if (($uf !== '' && $cidade === '') && !isset($erros['cidade'])) { $erros['cidade'] = 'Falta informar a cidade do estado ' . $uf . '.'; }
    $adicional = (string)($post['adicional'] ?? 'Nenhum');
    if (!in_array($adicional, ['Nenhum', 'Insalubridade 10%', 'Insalubridade 20%', 'Insalubridade 40%', 'Periculosidade 30%'], true)) { $adicional = 'Nenhum'; }
    $sal = null;
    if ($ver) {
        $salTxt = trim((string)($post['salario'] ?? ''));
        $sal = rhp_valor($salTxt);
        if ($salTxt === '') { $erros['salario'] = 'Falta informar o salário (ou o valor combinado) do colaborador.'; }
        elseif ($sal === null) { $erros['salario'] = 'Salário inválido: digite só números, por exemplo 3.500,00.'; }
        elseif ($sal <= 0) { $erros['salario'] = 'O salário precisa ser maior que zero.'; }
        foreach (['vale_transporte' => 'Vale-transporte', 'alimentacao' => 'Alimentação', 'outros_beneficios' => 'Outros benefícios'] as $c_ => $r_) {
            $t_ = trim((string)($post[$c_] ?? ''));
            if ($t_ !== '' && rhp_valor($t_) === null) { $erros[$c_] = $r_ . ' inválido: digite só números, por exemplo 250,00.'; }
        }
    }
    if ($erros) { throw new RhpValidacao($erros); }
    foreach ($escolha as $c_ => $e_) {   // só grava na lista depois que o resto do formulário está certo
        $escolha[$c_] = isset($e_['novo']) ? rhp_opcao_adicionar($c_, $org, $e_['novo'], ($u['perfil'] ?? '') === 'admin' && !empty($post[$c_ . '_todas'])) : $e_['valor'];
    }
    $orgNome = $org > 0 ? (string)(organizacao_ler($org)['nome'] ?? '') : '';
    $empresa = trim((string)($post['empresa'] ?? '')) !== '' ? mb_substr(trim($post['empresa']), 0, 120) : $orgNome;
    $dados = [
        'nome' => mb_substr($nome, 0, 160), 'cpf' => $cpf ?: null, 'rg' => mb_substr(trim((string)($post['rg'] ?? '')), 0, 30) ?: null,
        'nascimento' => $nasc, 'sexo' => in_array($post['sexo'] ?? '', ['Masculino', 'Feminino', 'Outro'], true) ? $post['sexo'] : null,
        'celular' => mb_substr(trim((string)($post['celular'] ?? '')), 0, 30) ?: null, 'email' => $email ?: null, 'endereco' => mb_substr(trim((string)($post['endereco'] ?? '')), 0, 255) ?: null,
        'cidade' => $cidade !== '' ? $cidade : null, 'uf' => $uf !== '' ? $uf : null,
        'funcao' => ($escolha['funcao'] ?? '') !== '' ? mb_substr($escolha['funcao'], 0, 100) : null, 'setor' => ($escolha['setor'] ?? '') !== '' ? mb_substr($escolha['setor'], 0, 60) : null,
        'empresa' => $empresa ?: null, 'status' => $status, 'admissao' => $adm, 'desligamento' => $des, 'obra_id' => $obraId > 0 ? $obraId : null, 'alocado_em' => $alocadoEm,
        'ctps' => mb_substr(trim((string)($post['ctps'] ?? '')), 0, 30) ?: null, 'serie' => mb_substr(trim((string)($post['serie'] ?? '')), 0, 20) ?: null,
        'obs' => mb_substr(trim((string)($post['obs'] ?? '')), 0, 4000) ?: null,
    ];
    if ($ver) {
        $dados += ['tipo_salario' => ($post['tipo_salario'] ?? 'Mensal') === 'Hora' ? 'Hora' : 'Mensal', 'salario' => $sal, 'adicional' => $adicional,
            'vale_transporte' => rhp_valor($post['vale_transporte'] ?? ''), 'alimentacao' => rhp_valor($post['alimentacao'] ?? ''), 'outros_beneficios' => rhp_valor($post['outros_beneficios'] ?? '')];
    }
    $agora = agora();
    if ($atual) {
        $dados['atualizado_em'] = $agora;
        $sets = implode(', ', array_map(function ($k) { return "$k = ?"; }, array_keys($dados)));
        q_global("UPDATE rh_pessoas SET $sets WHERE id = ?", array_merge(array_values($dados), [(int)$id]));
        if ($obraId !== $obraAntes) { registrar_global('rh_alocacao', ['colaborador' => $nome, 'de' => $obraAntes, 'para' => $obraId, 'por' => $u['login'] ?? '']); }
        return (int)$id;
    }
    $dados += ['organizacao_id' => $org, 'criado_por' => (int)$u['id'], 'criado_em' => $agora, 'atualizado_em' => $agora];
    $cols = implode(', ', array_keys($dados));
    q_global("INSERT INTO rh_pessoas ($cols) VALUES (" . implode(',', array_fill(0, count($dados), '?')) . ')', array_values($dados));
    $novo = (int)bd()->lastInsertId();
    registrar_global('rh_colaborador_novo', ['colaborador' => $nome, 'obra' => $obraId, 'por' => $u['login'] ?? '']);
    return $novo;
}

function rhp_alocar($id, $obraId, array $u, $data = '')
{
    $p = rhp_obter($id, $u);
    if (!$p) { throw new InvalidArgumentException('Colaborador não encontrado.'); }
    $obras = rhp_obras_permitidas($u);
    if ($obraId > 0 && !isset($obras[$obraId])) { throw new InvalidArgumentException('Obra inválida para este usuário.'); }
    q_global('UPDATE rh_pessoas SET obra_id = ?, alocado_em = ?, atualizado_em = ? WHERE id = ?', [$obraId > 0 ? $obraId : null, $obraId > 0 ? (rhp_data($data, 'Data da alocação') ?: planos_hoje()) : null, agora(), (int)$id]);
    registrar_global('rh_alocacao', ['colaborador' => $p['nome'], 'de' => (int)$p['obra_id'], 'para' => $obraId, 'por' => $u['login'] ?? '']);
}

function rhp_excluir($id, array $u)
{
    $p = rhp_obter($id, $u);
    if (!$p) { throw new InvalidArgumentException('Colaborador não encontrado.'); }
    foreach (q_global("SELECT id FROM rh_documentos WHERE origem = 'p' AND pessoa_id = ?", [(int)$id])->fetchAll(PDO::FETCH_COLUMN) as $did) { rhp_documento_excluir($did, $u, true); }
    q_global('DELETE FROM rh_pessoas WHERE id = ?', [(int)$id]);
    registrar_global('rh_colaborador_excluido', ['colaborador' => $p['nome'], 'por' => $u['login'] ?? '']);
}

// ---------------------------------------------------------------- custo (folha) dos colaboradores da empresa

/** Parâmetros da folha de uma obra (ou os padrões quando o colaborador não tem obra). */
function rhp_params_da_obra($obraId)
{
    static $c = [];
    $k = (int)$obraId;
    if (!isset($c[$k])) {
        if ($k > 0) {
            try { obra_override($k); $c[$k] = rh_params(true); } catch (Throwable $e) { $c[$k] = rh_params_padrao(); }
            obra_override(0);
        } else { $c[$k] = rh_params_padrao(); }
    }
    return $c[$k];
}

function rhp_custo(array $p, $ym)
{
    return rh_custo_colaborador($p, rhp_params_da_obra((int)($p['obra_id'] ?? 0)), $ym);
}

/** Todos os colaboradores do escopo (com nome da obra), ordenados por nome. */
function rhp_listar(array $u, array $f = [])
{
    garantir_rh_pessoas();
    list($w, $p) = rhp_escopo($u, 'c');
    $where = [$w]; $par = $p;
    if (($f['obra'] ?? '') === 'sem') { $where[] = '(c.obra_id IS NULL OR c.obra_id = 0)'; }
    elseif ((int)($f['obra'] ?? 0) > 0) { $where[] = 'c.obra_id = ?'; $par[] = (int)$f['obra']; }
    if (!empty($f['status'])) { $where[] = 'c.status = ?'; $par[] = $f['status']; }
    if (!empty($f['org']) && rhp_contexto($u)['todas']) { $where[] = 'c.organizacao_id = ?'; $par[] = (int)$f['org']; }
    $q = trim((string)($f['q'] ?? ''));
    if ($q !== '') {
        $busca = ['c.nome LIKE ?', 'c.funcao LIKE ?']; $par[] = "%$q%"; $par[] = "%$q%";
        $cpf = sesmt_cpf_digitos($q);
        if ($cpf !== '') { $busca[] = 'c.cpf LIKE ?'; $par[] = "%$cpf%"; }
        $where[] = '(' . implode(' OR ', $busca) . ')';
    }
    $rows = q_global('SELECT c.*, o.nome AS obra_nome FROM rh_pessoas c LEFT JOIN obras o ON o.id = c.obra_id WHERE ' . implode(' AND ', $where) . ' ORDER BY c.nome', $par)->fetchAll();
    $docs = [];
    $hoje = planos_hoje();
    foreach (q_global("SELECT pessoa_id, COUNT(*) AS n, SUM(CASE WHEN validade IS NOT NULL AND validade < ? THEN 1 ELSE 0 END) AS venc FROM rh_documentos WHERE origem = 'p' GROUP BY pessoa_id", [$hoje])->fetchAll() as $d) { $docs[(int)$d['pessoa_id']] = $d; }
    foreach ($rows as &$r) { $r['docs_n'] = (int)($docs[(int)$r['id']]['n'] ?? 0); $r['docs_venc'] = (int)($docs[(int)$r['id']]['venc'] ?? 0); }
    unset($r);
    return $rows;
}

// ---------------------------------------------------------------- documentos

function rhp_pasta_docs()
{
    $d = tarefas_arquivos_dir();   // garante dados_obras/ fechado ao público
    $d = dirname($d) . '/_rh';
    if (!is_dir($d)) { @mkdir($d, 0755, true); }
    return $d;
}

function rhp_documentos($pessoaId, $origem = 'p')
{
    garantir_rh_pessoas();
    return q_global('SELECT * FROM rh_documentos WHERE origem = ? AND pessoa_id = ? ORDER BY tipo, validade, id', [$origem, (int)$pessoaId])->fetchAll();
}

function rhp_documento_enviar($pessoaId, array $post, array $u)
{
    garantir_rh_pessoas();
    $p = rhp_obter($pessoaId, $u);
    if (!$p) { throw new InvalidArgumentException('Colaborador não encontrado.'); }
    $tipo = (string)($post['tipo'] ?? '');
    if ($tipo === '__outro') { $tipo = trim((string)($post['tipo_outro'] ?? '')); }
    elseif (!in_array($tipo, rhp_tipos_documento(), true)) { $tipo = ''; }
    if ($tipo === '' || mb_strlen($tipo) > 80) { throw new InvalidArgumentException('Informe qual é o documento (escolha na lista ou digite o nome).'); }
    $f = $_FILES['arquivo'] ?? null;
    if (!$f || ($f['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE) { throw new InvalidArgumentException('Escolha o arquivo do documento.'); }
    if (($f['error'] ?? 0) !== UPLOAD_ERR_OK) { throw new InvalidArgumentException('Falha no envio do arquivo (tente um arquivo menor).'); }
    if ($f['size'] > 10 * 1024 * 1024) { throw new InvalidArgumentException('O arquivo passa de 10 MB.'); }
    $ext = strtolower(pathinfo((string)$f['name'], PATHINFO_EXTENSION));
    if (!in_array($ext, rhp_extensoes_documento(), true)) { throw new InvalidArgumentException('Formato não aceito. Use PDF, imagem (JPG/PNG/WEBP), Word, Excel ou ZIP.'); }
    if (in_array($ext, ['jpg', 'jpeg', 'png', 'webp'], true) && !@getimagesize($f['tmp_name'])) { throw new InvalidArgumentException('A imagem enviada é inválida.'); }
    if ($ext === 'pdf' && file_get_contents($f['tmp_name'], false, null, 0, 5) !== '%PDF-') { throw new InvalidArgumentException('O PDF enviado é inválido.'); }
    $validade = rhp_data($post['validade'] ?? '', 'Validade');
    $nome = bin2hex(random_bytes(12)) . '.dat';
    if (!move_uploaded_file($f['tmp_name'], rhp_pasta_docs() . '/' . $nome)) {
        if (!@copy($f['tmp_name'], rhp_pasta_docs() . '/' . $nome)) { throw new RuntimeException('Não consegui gravar o arquivo no servidor.'); }
    }
    q_global('INSERT INTO rh_documentos (organizacao_id, origem, pessoa_id, obra_id, tipo, titulo, validade, arquivo, arquivo_nome, mime, tamanho, enviado_por, enviado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [(int)$p['organizacao_id'], 'p', (int)$pessoaId, null, $tipo, mb_substr(trim((string)($post['titulo'] ?? '')), 0, 160) ?: null, $validade, $nome,
            mb_substr(preg_replace('/[^\p{L}\p{N}._\- ()]/u', '_', (string)$f['name']), 0, 200), $ext, (int)$f['size'], $u['nome'] ?? ($u['login'] ?? ''), agora()]);
}

function rhp_documento_obter($id, array $u)
{
    garantir_rh_pessoas();
    $d = q_global('SELECT * FROM rh_documentos WHERE id = ?', [(int)$id])->fetch();
    if (!$d) { return null; }
    if ($d['origem'] === 'p' && !rhp_obter((int)$d['pessoa_id'], $u)) { return null; }
    return $d;
}

function rhp_documento_excluir($id, array $u, $semChecar = false)
{
    $d = $semChecar ? q_global('SELECT * FROM rh_documentos WHERE id = ?', [(int)$id])->fetch() : rhp_documento_obter($id, $u);
    if (!$d) { throw new InvalidArgumentException('Documento não encontrado.'); }
    $p = rhp_pasta_docs() . '/' . basename((string)$d['arquivo']);
    if (is_file($p)) { @unlink($p); }
    q_global('DELETE FROM rh_documentos WHERE id = ?', [(int)$id]);
}

/** Situação do documento pela validade: sem validade, em dia, vence em até 30 dias ou vencido. */
function rhp_situacao_documento($validade)
{
    if (!$validade) { return ['sem', 'Sem validade', '']; }
    $dias = (int)floor((strtotime($validade) - strtotime(planos_hoje())) / 86400);
    if ($dias < 0) { return ['venc', 'Vencido há ' . abs($dias) . ' dia(s)', 'verm']; }
    if ($dias <= 30) { return ['logo', 'Vence em ' . $dias . ' dia(s)', 'amarelo']; }
    return ['ok', 'Em dia', 'verde'];
}

/** Documentos vencidos ou a vencer em 30 dias, de todos os colaboradores do escopo (cartão de alerta do painel). */
function rhp_alertas_documentos(array $u)
{
    garantir_rh_pessoas();
    list($w, $p) = rhp_escopo($u, 'c');
    $lim = date('Y-m-d', strtotime(planos_hoje() . ' +30 days'));
    return q_global("SELECT d.id, d.tipo, d.validade, c.id AS pessoa_id, c.nome FROM rh_documentos d JOIN rh_pessoas c ON c.id = d.pessoa_id AND d.origem = 'p'
        WHERE d.validade IS NOT NULL AND d.validade <= ? AND $w ORDER BY d.validade LIMIT 60", array_merge([$lim], $p))->fetchAll();
}
