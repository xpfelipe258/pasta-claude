<?php
// Importação automática de uma obra nova: documentos obrigatórios, envio em partes, validação básica e conversa com o serviço de leitura (Python).
// Fase 1: recebe, guarda e valida os documentos; a leitura profunda e a geração (lista de material, baixa, BM, mapa) vêm do serviço separado.

const IMPORTACAO_TAMANHO_MAX = 524288000;   // 500 MB por arquivo
const IMPORTACAO_PARTE_MAX = 16777216;      // 16 MB por parte enviada

// Os 5 documentos que a obra precisa ter para chegar ao nível de automação do sistema. Todos são obrigatórios.
function importacao_tipos()
{
    return [
        'ifc' => [
            'rotulo' => 'Modelos IFC (Tekla)', 'ext' => ['ifc', 'zip'], 'minimo' => 1,
            'ajuda' => 'Um IFC por edificação (galpão, anexos…). Pode enviar .ifc ou .zip com o .ifc dentro. Exportar do Tekla com Assemblies e código de posição.',
            'gera' => ['Lista de material por local e família', 'Inventário da obra', 'Mapa de apontamento (joists, vigas, fechamento, marquise, contraventamento, telhas)', 'Fluxo de baixa por peça'],
        ],
        'fixadores' => [
            'rotulo' => 'Lista de parafusos e fixadores', 'ext' => ['trb', 'xlsx', 'xlsm', 'csv'], 'minimo' => 1,
            'ajuda' => 'Relatório de parafusos do Tekla (.xlsx ou .csv) ou o modelo .trb. Precisa ter diâmetro, comprimento, norma e quantidade.',
            'gera' => ['Fixadores do projeto por local', 'Kit de parafuso, porca e arruela por peça', 'Baixa de fixador'],
        ],
        'cronograma' => [
            'ext' => ['xml', 'xlsx', 'xlsm', 'pdf'], 'rotulo' => 'Cronograma do cliente', 'minimo' => 1,
            'ajuda' => 'Preferir .xml do MS Project ou .xlsx (leitura exata). PDF também é aceito, mas é menos confiável.',
            'gera' => ['Cronograma (Gantt) e previsto', 'Fases e frentes', 'Ligação atividade × frente de montagem'],
        ],
        'orcamento' => [
            'ext' => ['xlsx', 'xlsm'], 'rotulo' => 'Orçamento / planilha de medição por empresa', 'minimo' => 1,
            'ajuda' => 'Um arquivo por empresa executora, com item, descrição, quantidade, unidade e valor. Salve em .xlsx.',
            'gera' => ['Catálogo de atividades do BM', 'Valores, pesos e contratos', 'Boletim de medição (BM)'],
        ],
        'projetos' => [
            'ext' => ['pdf'], 'rotulo' => 'Projetos em PDF', 'minimo' => 1,
            'ajuda' => 'Pranchas e memoriais em PDF com texto selecionável (não escaneado): quantidade de telhas, vãos, unidades e m² por serviço.',
            'gera' => ['Biblioteca de projetos com revisão', 'Quantidades de telha e fechamento (vão, unidade, m²)', 'Lista de material por serviço'],
        ],
    ];
}

function importacao_diretorio($obraId)
{
    $base = __DIR__ . '/../dados_obras';
    if (!is_dir($base)) {
        @mkdir($base, 0755, true);
    }
    // nada deste diretório é público: os arquivos só saem por obra_importar.php (login) ou pelo link assinado do serviço de leitura
    if (!is_file($base . '/.htaccess')) {
        @file_put_contents($base . '/.htaccess', "Require all denied\nOptions -Indexes\n<IfModule !mod_authz_core.c>\nDeny from all\n</IfModule>\n");
    }
    $d = $base . '/' . (int)$obraId;
    if (!is_dir($d)) {
        @mkdir($d, 0755, true);
    }
    return $d;
}

function garantir_importacao()
{
    static $ok = false;
    if ($ok) {
        return;
    }
    $driver = config()['driver'] ?? 'mysql';
    $pdo = bd();
    $pdo->exec(importacao_sql($driver === 'sqlite' ? 'INTEGER PRIMARY KEY AUTOINCREMENT' : 'INT AUTO_INCREMENT PRIMARY KEY',
        $driver === 'mysql' ? 'MEDIUMTEXT' : 'TEXT', $driver === 'mysql' ? ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4' : ''));
    if (!in_array('importacao', colunas_tabela($pdo, $driver, 'obras'), true)) {
        $pdo->exec('ALTER TABLE obras ADD COLUMN importacao VARCHAR(25) NULL');
    }
    $ok = true;
}

function importacao_segredo()
{
    $s = config()['servico_leitura']['segredo'] ?? '';
    return is_string($s) ? $s : '';
}

function importacao_servico_url()
{
    $u = config()['servico_leitura']['url'] ?? '';
    return is_string($u) ? rtrim($u, '/') : '';
}

function importacao_servico_ativo()
{
    return importacao_servico_url() !== '' && importacao_segredo() !== '';
}

function importacao_url_base()
{
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
    $dir = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '')), '/');
    return ($https ? 'https' : 'http') . '://' . ($_SERVER['HTTP_HOST'] ?? 'localhost') . $dir;
}

function importacao_assinar($texto)
{
    return hash_hmac('sha256', $texto, importacao_segredo());
}

function importacao_nome_seguro($nome)
{
    $nome = preg_replace('/[\x00-\x1f\x7f\/\\\\]+/', '_', (string)$nome);
    $nome = trim($nome);
    return mb_substr($nome === '' ? 'arquivo' : $nome, 0, 200);
}

function importacao_extensao($nome)
{
    return strtolower(pathinfo((string)$nome, PATHINFO_EXTENSION));
}

// ---------------------------------------------------------------- validação básica (no próprio PHP, sem ler o arquivo inteiro na memória)

// Lê o IFC (direto ou dentro de um .zip) em blocos, procurando o código de posição do Tekla.
function importacao_ler_ifc($caminho, $ehZip, &$msgs)
{
    $r = ['schema' => null, 'tekla' => false, 'codigo_posicao' => false, 'bolts_on' => null, 'bytes' => 0];
    $origem = $caminho;
    if ($ehZip) {
        if (!class_exists('ZipArchive')) {
            $msgs[] = ['aviso', 'O servidor não lê .zip; o conteúdo será conferido pelo serviço de leitura.'];
            return $r;
        }
        $z = new ZipArchive();
        if ($z->open($caminho) !== true) {
            $msgs[] = ['erro', 'Não foi possível abrir o .zip.'];
            return null;
        }
        $entrada = null;
        for ($i = 0; $i < $z->numFiles; $i++) {
            $n = $z->getNameIndex($i);
            if (strtolower(pathinfo($n, PATHINFO_EXTENSION)) === 'ifc') {
                $entrada = $n;
                break;
            }
        }
        $z->close();
        if ($entrada === null) {
            $msgs[] = ['erro', 'O .zip não contém nenhum arquivo .ifc.'];
            return null;
        }
        $origem = 'zip://' . $caminho . '#' . $entrada;
    }
    $f = @fopen($origem, 'rb');
    if (!$f) {
        $msgs[] = ['erro', 'Não foi possível ler o arquivo enviado.'];
        return null;
    }
    $ini = (string)fread($f, 65536);
    if (strpos($ini, 'ISO-10303-21') === false) {
        fclose($f);
        $msgs[] = ['erro', 'O arquivo não é um IFC (falta o cabeçalho ISO-10303-21).'];
        return null;
    }
    if (preg_match('/FILE_SCHEMA\s*\(\s*\(\s*\'([^\']+)\'/i', $ini, $m)) {
        $r['schema'] = strtoupper($m[1]);
    }
    if (!$r['schema'] || strpos($r['schema'], 'IFC') !== 0) {
        fclose($f);
        $msgs[] = ['erro', 'IFC sem esquema reconhecido (FILE_SCHEMA).'];
        return null;
    }
    $r['tekla'] = stripos($ini, 'tekla') !== false;
    if (preg_match('/Option \[Bolts:(On|Off)\]/i', $ini, $m)) {
        $r['bolts_on'] = strtolower($m[1]) === 'on';
    }
    $r['bytes'] = strlen($ini);
    $achou = stripos($ini, 'Assembly/Cast unit position code') !== false;
    $cauda = substr($ini, -64);
    while (!$achou && !feof($f)) {
        $bloco = (string)fread($f, 1048576);
        if ($bloco === '') {
            break;
        }
        $r['bytes'] += strlen($bloco);
        $achou = stripos($cauda . $bloco, 'Assembly/Cast unit position code') !== false;
        $cauda = substr($bloco, -64);
        if (!$r['tekla'] && stripos($bloco, 'tekla') !== false) {
            $r['tekla'] = true;
        }
    }
    fclose($f);
    $r['codigo_posicao'] = $achou;
    return $r;
}

// Devolve ['status' => 'valido'|'invalido', 'mensagens' => [[nivel, texto], ...], 'resumo' => [...]]
function importacao_validar_basico($tipo, $caminho, $nomeOriginal, $tamanho)
{
    $tipos = importacao_tipos();
    $msgs = [];
    $resumo = [];
    $ext = importacao_extensao($nomeOriginal);
    if (!isset($tipos[$tipo])) {
        return ['status' => 'invalido', 'mensagens' => [['erro', 'Tipo de documento desconhecido.']], 'resumo' => []];
    }
    if (!in_array($ext, $tipos[$tipo]['ext'], true)) {
        return ['status' => 'invalido', 'mensagens' => [['erro', 'Formato .' . $ext . ' não é aceito aqui. Aceitos: ' . implode(', ', array_map(function ($e) { return '.' . $e; }, $tipos[$tipo]['ext'])) . '.']], 'resumo' => []];
    }
    if ($tamanho <= 0) {
        return ['status' => 'invalido', 'mensagens' => [['erro', 'Arquivo vazio.']], 'resumo' => []];
    }
    $cabeca = (string)@file_get_contents($caminho, false, null, 0, 4096);
    $ehZipArq = substr($cabeca, 0, 2) === 'PK';
    $erro = null;
    if ($tipo === 'ifc') {
        $r = importacao_ler_ifc($caminho, $ext === 'zip' || $ehZipArq, $msgs);
        if ($r === null) {
            $erro = true;
        } else {
            $resumo = ['esquema' => $r['schema'], 'tekla' => $r['tekla'], 'codigo_posicao' => $r['codigo_posicao'], 'parafusos_no_modelo' => $r['bolts_on']];
            if (!$r['tekla']) {
                $msgs[] = ['aviso', 'O modelo não parece ter sido exportado do Tekla; o serviço de leitura confirma se o código de posição existe.'];
            }
            if (!$r['codigo_posicao'] && $r['bytes'] > 0) {
                $msgs[] = ['aviso', 'Não encontrei o código de posição das peças (Assembly/Cast unit position code). Sem ele o mapa de apontamento não é gerado; exporte com Assemblies.'];
            }
            if ($r['bolts_on'] === false) {
                $msgs[] = ['info', 'Este IFC não traz parafusos (Bolts:Off). Eles vêm do documento de fixadores.'];
            }
        }
    } elseif ($tipo === 'fixadores') {
        if ($ext === 'trb') {
            if ($tamanho < 1024) {
                $msgs[] = ['erro', 'Arquivo .trb pequeno demais para ser um modelo.'];
                $erro = true;
            }
        } elseif ($ext === 'csv') {
            if (!preg_match('/di[aâ]metro|bitola|comprimento|quant|qtd/i', substr($cabeca, 0, 4096))) {
                $msgs[] = ['aviso', 'Não achei colunas de diâmetro, comprimento ou quantidade no início do CSV; o serviço de leitura confere.'];
            }
        } elseif (!$ehZipArq) {
            $msgs[] = ['erro', 'Planilha inválida (não é .xlsx).'];
            $erro = true;
        }
    } elseif ($tipo === 'cronograma') {
        if ($ext === 'xml' && stripos($cabeca, '<Project') === false) {
            $msgs[] = ['erro', 'O XML não é um cronograma do MS Project (falta o elemento Project).'];
            $erro = true;
        } elseif ($ext === 'pdf' && substr($cabeca, 0, 5) !== '%PDF-') {
            $msgs[] = ['erro', 'O arquivo não é um PDF válido.'];
            $erro = true;
        } elseif ($ext === 'pdf') {
            $msgs[] = ['aviso', 'Cronograma em PDF é lido por texto e pode ter tarefas cortadas; prefira .xml ou .xlsx.'];
        } elseif (in_array($ext, ['xlsx', 'xlsm'], true) && !$ehZipArq) {
            $msgs[] = ['erro', 'Planilha inválida (não é .xlsx).'];
            $erro = true;
        }
    } elseif ($tipo === 'orcamento') {
        if (!$ehZipArq) {
            $msgs[] = ['erro', 'Planilha inválida (não é .xlsx). Salve a planilha como Pasta de Trabalho do Excel (.xlsx).'];
            $erro = true;
        }
    } elseif ($tipo === 'projetos') {
        if (substr($cabeca, 0, 5) !== '%PDF-') {
            $msgs[] = ['erro', 'O arquivo não é um PDF válido.'];
            $erro = true;
        }
    }
    $temErro = $erro || (bool)array_filter($msgs, function ($m) { return $m[0] === 'erro'; });
    return ['status' => $temErro ? 'invalido' : 'valido', 'mensagens' => $msgs, 'resumo' => $resumo];
}

// ---------------------------------------------------------------- documentos da obra

function importacao_documentos($obraId)
{
    garantir_importacao();
    $linhas = q_global('SELECT * FROM obra_documentos WHERE obra_id = ? ORDER BY tipo, id', [(int)$obraId])->fetchAll();
    foreach ($linhas as &$l) {
        $l['id'] = (int)$l['id'];
        $l['tamanho'] = (int)$l['tamanho'];
        $l['mensagens'] = json_decode((string)$l['mensagens'], true) ?: [];
        $l['resumo'] = json_decode((string)$l['resumo'], true) ?: [];
        $l['profunda'] = $l['profunda'] ? (json_decode((string)$l['profunda'], true) ?: null) : null;
    }
    unset($l);
    return $linhas;
}

// Situação de cada tipo obrigatório e se a obra já pode seguir para a leitura.
function importacao_situacao($obraId)
{
    $docs = importacao_documentos($obraId);
    $servico = importacao_servico_ativo();
    $tipos = importacao_tipos();
    $porTipo = [];
    foreach ($tipos as $k => $t) {
        $porTipo[$k] = ['rotulo' => $t['rotulo'], 'documentos' => [], 'ok' => false, 'pendente' => false, 'motivo' => 'Nenhum arquivo enviado.'];
    }
    foreach ($docs as $d) {
        if (!isset($porTipo[$d['tipo']])) {
            continue;
        }
        $porTipo[$d['tipo']]['documentos'][] = $d;
    }
    foreach ($porTipo as $k => &$p) {
        $validos = 0;
        $pendentes = 0;
        $invalidos = 0;
        foreach ($p['documentos'] as $d) {
            if ($d['status'] !== 'valido') {
                $invalidos++;
            } elseif ($servico && ($d['profunda_status'] ?? '') === 'erro') {
                $invalidos++;
            } elseif ($servico && ($d['profunda_status'] ?? '') !== 'ok') {
                $pendentes++;
            } else {
                $validos++;
            }
        }
        $p['ok'] = $validos >= $tipos[$k]['minimo'] && $invalidos === 0 && $pendentes === 0;
        $p['pendente'] = $pendentes > 0;
        if ($p['ok']) {
            $p['motivo'] = '';
        } elseif ($invalidos) {
            $p['motivo'] = 'Há arquivo recusado: remova ou substitua.';
        } elseif ($pendentes) {
            $p['motivo'] = 'Aguardando a leitura profunda do serviço…';
        } elseif (!$p['documentos']) {
            $p['motivo'] = 'Nenhum arquivo enviado.';
        } else {
            $p['motivo'] = 'Arquivos insuficientes.';
        }
    }
    unset($p);
    $completos = count(array_filter($porTipo, function ($p) { return $p['ok']; }));
    return ['tipos' => $porTipo, 'completos' => $completos, 'total' => count($tipos), 'pronta' => $completos === count($tipos), 'servico' => $servico];
}

function importacao_remover_documento($docId)
{
    $d = q_global('SELECT * FROM obra_documentos WHERE id = ?', [(int)$docId])->fetch();
    if (!$d) {
        return false;
    }
    $p = importacao_diretorio((int)$d['obra_id']) . '/' . basename((string)$d['arquivo']);
    if (is_file($p)) {
        @unlink($p);
    }
    q_global('DELETE FROM obra_documentos WHERE id = ?', [(int)$docId]);
    return true;
}

function importacao_apagar_pasta($obraId)
{
    $d = importacao_diretorio($obraId);
    foreach (glob($d . '/*') ?: [] as $f) {
        if (is_dir($f)) {
            foreach (glob($f . '/*') ?: [] as $g) {
                @unlink($g);
            }
            @rmdir($f);
        } else {
            @unlink($f);
        }
    }
    @rmdir($d);
}

// Pede ao serviço de leitura (Python) a validação profunda do documento. Responde 202 e devolve o resultado depois pelo callback assinado.
function importacao_despachar_validacao($docId)
{
    if (!importacao_servico_ativo()) {
        return ['ok' => false, 'erro' => 'Serviço de leitura não configurado.'];
    }
    $d = q_global('SELECT * FROM obra_documentos WHERE id = ?', [(int)$docId])->fetch();
    if (!$d) {
        return ['ok' => false, 'erro' => 'Documento não encontrado.'];
    }
    $exp = time() + 3600;
    $base = importacao_url_base();
    $corpo = json_encode([
        'documento_id' => (int)$d['id'], 'obra_id' => (int)$d['obra_id'], 'tipo' => $d['tipo'], 'nome' => $d['nome_original'], 'tamanho' => (int)$d['tamanho'],
        'sha256' => $d['sha256'],
        'url_download' => $base . '/obra_importar.php?acao=baixar&doc=' . (int)$d['id'] . '&exp=' . $exp . '&sig=' . importacao_assinar('baixar|' . (int)$d['id'] . '|' . $exp),
        'callback' => $base . '/obra_importar.php?acao=callback',
    ], JSON_UNESCAPED_UNICODE);
    $ch = curl_init(importacao_servico_url() . '/jobs/validar');
    curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => $corpo, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 10, CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'X-Assinatura: ' . importacao_assinar($corpo)]]);
    $resp = curl_exec($ch);
    $cod = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    if ($cod < 200 || $cod >= 300) {
        q_global("UPDATE obra_documentos SET profunda_status = 'erro', profunda = ? WHERE id = ?",
            [json_encode(['erros' => ['Serviço de leitura indisponível (' . ($err ?: 'HTTP ' . $cod) . '). Use "Revalidar" mais tarde.']], JSON_UNESCAPED_UNICODE), (int)$d['id']]);
        return ['ok' => false, 'erro' => $err ?: 'HTTP ' . $cod];
    }
    q_global("UPDATE obra_documentos SET profunda_status = 'pendente', profunda = NULL WHERE id = ?", [(int)$d['id']]);
    return ['ok' => true];
}
