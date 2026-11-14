<?php
// Modelo 3D / planejamento 4D: envio do IFC, entrega do arquivo e do modelo já convertido, grupos de montagem e vínculo dos elementos (GUID).
// Os arquivos ficam em dados_obras/{obra}/modelo3d (pasta fechada) e só saem daqui, para quem está logado, tem a obra e a área Produção.
// Quem é somente leitura abre o modelo e a simulação 4D, mas não envia, não altera prazos e não exclui.
require __DIR__ . '/inc/nucleo.php';

function m3d_resp($cod, array $d)
{
    http_response_code($cod);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($d, JSON_UNESCAPED_UNICODE);
    exit;
}

function m3d_enviar_arquivo($caminho, $etag)
{
    if (!$caminho || !is_file($caminho)) {
        http_response_code(404);
        exit('Arquivo não encontrado.');
    }
    session_write_close();
    if (($_SERVER['HTTP_IF_NONE_MATCH'] ?? '') === '"' . $etag . '"') {
        http_response_code(304);
        exit;
    }
    @set_time_limit(0);
    while (ob_get_level()) { ob_end_clean(); }
    header('Content-Type: application/octet-stream');
    header('Content-Length: ' . filesize($caminho));
    header('ETag: "' . $etag . '"');
    header('Cache-Control: private, max-age=0, must-revalidate');
    header('X-Content-Type-Options: nosniff');
    readfile($caminho);
    exit;
}

if (!config()) {
    m3d_resp(503, ['erro' => 'Sistema não instalado.']);
}
$u = usuario_atual();
if (!$u) {
    m3d_resp(401, ['erro' => 'Faça login novamente.']);
}
$obraId = obra_atual_id();
$obra = $obraId ? q_global("SELECT id FROM obras WHERE id = ? AND status = 'ativa'", [$obraId])->fetch() : null;
if (!$obra || !usuario_pode_obra($u, $obraId)) {
    m3d_resp(409, ['erro' => 'Selecione uma obra na Central de Obras.']);
}
definir_obra_atual($obraId);
if (!usuario_pode_modulo($u, 'producao')) {
    m3d_resp(403, ['erro' => 'Seu usuário não possui acesso à área Produção (modelo 3D).']);
}
$acao = (string)($_GET['acao'] ?? '');

try {
    garantir_modelo3d();
    $dir = m3d_dir($obraId);

    // ------------------------------------------------------------ leitura
    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        if ($acao === 'estado') {
            m3d_resp(200, m3d_estado($u));
        }
        if ($acao === 'grupos') {
            if (!m3d_modelo($_GET['modelo'] ?? 0)) { m3d_resp(404, ['erro' => 'Modelo não encontrado.']); }
            m3d_resp(200, m3d_grupos_ler((int)$_GET['modelo']));
        }
        if ($acao === 'arquivo' || $acao === 'cache') {
            $m = m3d_modelo($_GET['id'] ?? 0);
            if (!$m) {
                http_response_code(404);
                exit('Modelo não encontrado.');
            }
            if ($acao === 'arquivo') {
                m3d_enviar_arquivo(m3d_caminho_ifc($m, $obraId), 'ifc-' . (int)$m['id'] . '-' . substr((string)$m['sha256'], 0, 16));
            }
            $tipo = ($_GET['tipo'] ?? '') === 'props' ? 'cache_props' : 'cache_geo';
            if ((int)$m['cache_v'] !== M3D_CACHE_VERSAO || !$m[$tipo]) {
                http_response_code(404);
                exit('Modelo ainda não convertido.');
            }
            m3d_enviar_arquivo($dir . '/' . basename((string)$m[$tipo]), substr((string)$m[$tipo], 0, 20));
        }
        m3d_resp(400, ['erro' => 'Ação desconhecida.']);
    }

    // ------------------------------------------------------------ gravação
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        m3d_resp(405, ['erro' => 'Método não permitido.']);
    }
    $csrf = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
    if (!is_string($csrf) || !hash_equals(token_csrf(), $csrf)) {
        m3d_resp(400, ['erro' => 'Sessão expirada. Atualize a página e tente de novo.']);
    }
    if (!m3d_pode_editar($u)) {
        m3d_resp(403, ['erro' => 'Seu usuário é somente leitura no modelo 3D.']);
    }
    $agora = m3d_agora();

    if ($acao === 'enviar') {   // IFC em partes (corpo cru)
        $nome = mb_substr(preg_replace('/[^\p{L}\p{N}._\- ()]/u', '', (string)($_GET['nome'] ?? 'modelo.ifc')), 0, 150);
        if (strtolower(pathinfo($nome, PATHINFO_EXTENSION)) !== 'ifc') {
            m3d_resp(400, ['erro' => 'Envie o modelo em IFC (arquivo .ifc exportado do Tekla ou do Trimble Connect).']);
        }
        $parte = m3d_receber_parte($dir, $_GET['upload'] ?? '', (int)($_GET['offset'] ?? 0), (int)($_GET['tamanho'] ?? 0), ($_GET['final'] ?? '') === '1');
        if ($parte === null) {
            m3d_resp(200, ['ok' => true]);
        }
        if (!m3d_ifc_valido($parte)) {
            @unlink($parte);
            m3d_resp(400, ['erro' => 'O arquivo não é um IFC válido (esperado IFC em texto, formato STEP).']);
        }
        $arq = bin2hex(random_bytes(10)) . '.dat';
        rename($parte, $dir . '/' . $arq);
        q('INSERT INTO modelos_3d (nome, arquivo, tamanho, sha256, por, em) VALUES (?, ?, ?, ?, ?, ?)',
            [pathinfo($nome, PATHINFO_FILENAME), $arq, filesize($dir . '/' . $arq), hash_file('sha256', $dir . '/' . $arq), (string)$u['nome'], $agora]);
        m3d_resp(200, ['ok' => true, 'id' => (int)bd()->lastInsertId()]);
    }

    if ($acao === 'cache') {   // modelo já convertido pelo navegador (geometria ou propriedades), em partes
        $m = m3d_modelo($_GET['id'] ?? 0);
        if (!$m) { m3d_resp(404, ['erro' => 'Modelo não encontrado.']); }
        $tipo = ($_GET['tipo'] ?? '') === 'props' ? 'cache_props' : 'cache_geo';
        $parte = m3d_receber_parte($dir, $_GET['upload'] ?? '', (int)($_GET['offset'] ?? 0), (int)($_GET['tamanho'] ?? 0), ($_GET['final'] ?? '') === '1');
        if ($parte === null) {
            m3d_resp(200, ['ok' => true]);
        }
        $arq = bin2hex(random_bytes(10)) . '.bin';
        rename($parte, $dir . '/' . $arq);
        if ($m[$tipo]) { @unlink($dir . '/' . basename((string)$m[$tipo])); }
        if ($tipo === 'cache_geo') {   // a geometria fecha a conversão: a partir daqui todos abrem o modelo pronto
            q('UPDATE modelos_3d SET cache_geo = ?, cache_v = ?, n_elementos = ?, n_unidades = ? WHERE id = ?',
                [$arq, M3D_CACHE_VERSAO, max(0, (int)($_GET['elementos'] ?? 0)), max(0, (int)($_GET['unidades'] ?? 0)), (int)$m['id']]);
        } else {
            q('UPDATE modelos_3d SET cache_props = ? WHERE id = ?', [$arq, (int)$m['id']]);
        }
        m3d_resp(200, ['ok' => true]);
    }

    $c = json_decode((string)file_get_contents('php://input'), true);
    if (!is_array($c)) {
        m3d_resp(400, ['erro' => 'Dados inválidos.']);
    }
    $pdo = bd();
    $pdo->beginTransaction();
    try {
        if ($acao === 'usar_doc') {   // IFC que a importação da obra já guardou: vira modelo sem novo envio
            $d = q_global("SELECT * FROM obra_documentos WHERE id = ? AND obra_id = ? AND tipo = 'ifc' AND status = 'valido'", [(int)($c['doc_id'] ?? 0), $obraId])->fetch();
            if (!$d || strtolower(pathinfo((string)$d['nome_original'], PATHINFO_EXTENSION)) !== 'ifc') {
                throw new ErroValidacao('Documento IFC não encontrado nesta obra.');
            }
            if (q('SELECT id FROM modelos_3d WHERE doc_id = ?', [(int)$d['id']])->fetch()) {
                throw new ErroValidacao('Este IFC já está na lista de modelos.');
            }
            q('INSERT INTO modelos_3d (nome, doc_id, tamanho, sha256, por, em) VALUES (?, ?, ?, ?, ?, ?)',
                [pathinfo((string)$d['nome_original'], PATHINFO_FILENAME), (int)$d['id'], (float)$d['tamanho'], (string)$d['sha256'], (string)$u['nome'], $agora]);
            $r = ['ok' => true, 'id' => (int)$pdo->lastInsertId()];
        } elseif ($acao === 'modelo_renomear') {
            $nome = trim((string)($c['nome'] ?? ''));
            if (!m3d_modelo($c['id'] ?? 0) || mb_strlen($nome) < 2 || mb_strlen($nome) > 160) { throw new ErroValidacao('Informe o nome do modelo (2 a 160 caracteres).'); }
            q('UPDATE modelos_3d SET nome = ? WHERE id = ?', [$nome, (int)$c['id']]);
            $r = ['ok' => true];
        } elseif ($acao === 'modelo_excluir') {
            if (usuario_empresa_restrita($u) !== '') { throw new ErroValidacao('Só a gestão da obra exclui um modelo.'); }
            $r = m3d_modelo_excluir($c);
        } elseif ($acao === 'grupo_salvar') {
            $r = m3d_grupo_salvar($c, $u);
        } elseif ($acao === 'grupo_excluir') {
            $r = m3d_grupo_excluir($c, $u);
        } elseif ($acao === 'soltar') {
            $r = m3d_elementos_soltar($c, $u);
        } else {
            throw new ErroValidacao('Ação desconhecida.');
        }
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) { $pdo->rollBack(); }
        throw $e;
    }
    m3d_resp(200, $r);
} catch (ErroValidacao $e) {
    m3d_resp(400, ['erro' => $e->getMessage()]);
} catch (Throwable $e) {
    error_log('modelo3d: ' . $e->getMessage());
    m3d_resp(500, ['erro' => 'Falha no servidor ao processar o modelo 3D.']);
}
