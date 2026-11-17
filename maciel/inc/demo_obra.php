<?php
// Obra de demonstração ("Galpão Exemplo"): a G200 anonimizada, com o modelo 3D já convertido e as frentes de montagem com datas
// em volta do dia em que ela é criada (umas concluídas, uma atrasada, outras em andamento e a iniciar), para quem testa o sistema
// clicar sem enviar arquivo nenhum. O modelo e as frentes vêm de maciel/demo/g200 (gerados por ferramentas/demo_modelo3d.cjs).
// A obra é marcada com codigo = 'DEMO' e obra_config.demo = 1; não conta no limite de obras do plano (planos_assinatura.php).

const DEMO_CODIGO = 'DEMO';

function demo_pasta_modelo()
{
    return dirname(__DIR__) . '/demo/g200';
}

function demo_disponivel()
{
    $d = demo_pasta_modelo();
    return is_file($d . '/geo.bin') && is_file($d . '/props.bin') && is_file($d . '/frentes.bin');
}

function obra_eh_demo($obraId)
{
    return (string)q_global('SELECT codigo FROM obras WHERE id = ?', [(int)$obraId])->fetchColumn() === DEMO_CODIGO;
}

/** Obra de demonstração ativa que o usuário já tem (0 = nenhuma). */
function demo_obra_do_usuario($uid)
{
    return (int)q_global("SELECT o.id FROM obras o JOIN usuarios_obras uo ON uo.obra_id = o.id WHERE uo.usuario_id = ? AND o.codigo = ? AND o.status = 'ativa' ORDER BY o.id DESC LIMIT 1",
        [(int)$uid, DEMO_CODIGO])->fetchColumn();
}

/** Cria a obra de demonstração para o usuário (administrador dela) e devolve o id. */
function demo_criar_obra($uid, $orgId = 0)
{
    if (!demo_disponivel()) {
        throw new RuntimeException('Os arquivos da obra de demonstração não estão no servidor (pasta demo/g200).');
    }
    $existente = demo_obra_do_usuario($uid);
    if ($existente) {
        return $existente;
    }
    require_once __DIR__ . '/modelo3d.php';
    $fuso = new DateTimeZone('America/Sao_Paulo');
    $hoje = new DateTimeImmutable('today', $fuso);
    $dia = function ($desloc) use ($hoje) { return $desloc === null ? null : $hoje->modify(($desloc >= 0 ? '+' : '') . (int)$desloc . ' days')->format('Y-m-d'); };
    $tpl = json_decode((string)gzdecode((string)file_get_contents(demo_pasta_modelo() . '/frentes.bin')), true);
    if (!is_array($tpl) || empty($tpl['frentes'])) {
        throw new RuntimeException('Arquivo de frentes da demonstração inválido.');
    }
    if ((int)($tpl['v'] ?? 0) !== M3D_CACHE_VERSAO) {
        throw new RuntimeException('O modelo da demonstração é de uma versão antiga do conversor: gere de novo com ferramentas/demo_modelo3d.cjs.');
    }
    $agora = $hoje->setTime((int)date('H'), (int)date('i'))->format('Y-m-d H:i:s');
    $ini = $dia(-65);
    $fim = $dia(50);
    $pdo = bd();
    $dono = $pdo->inTransaction() ? false : $pdo->beginTransaction();
    try {
        q_global("INSERT INTO obras (nome, codigo, cliente, cidade, responsavel, responsavel_cliente, data_inicio, data_fim, status, cor_primaria, cor_secundaria, observacoes, criado_em)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ativa', ?, ?, ?, ?)", [
            'Galpão Exemplo — demonstração', DEMO_CODIGO, 'Cliente Exemplo', 'Cidade Exemplo', 'Equipe de demonstração', 'Fiscal do cliente',
            $ini, $fim, '#2563eb', '#0f172a', 'Obra de demonstração criada automaticamente: galpão metálico com o modelo 3D pronto. Pode ser excluída a qualquer momento.', $agora]);
        $obraId = (int)$pdo->lastInsertId();
        foreach (['obra_nome' => 'Galpão Exemplo — demonstração', 'data_inicio' => $ini, 'data_fim' => $fim, 'versao' => '0', 'modificado' => date('c'), 'dados_legados' => '0', 'demo' => '1'] as $k => $v) {
            q_global('INSERT INTO obra_config (obra_id, chave, valor) VALUES (?, ?, ?)', [$obraId, $k, $v]);
        }
        obra_ligar_usuario((int)$uid, $obraId, 'admin');
        q_global('UPDATE obras SET criador_id = ? WHERE id = ?', [(int)$uid, $obraId]);
        if ($orgId) {
            q_global('UPDATE obras SET organizacao_id = ? WHERE id = ?', [(int)$orgId, $obraId]);
        }
        // modelo 3D já convertido: os arquivos são copiados para a pasta da obra
        $dir = m3d_dir($obraId);
        $geo = bin2hex(random_bytes(10)) . '.bin';
        $props = bin2hex(random_bytes(10)) . '.bin';
        if (!copy(demo_pasta_modelo() . '/geo.bin', $dir . '/' . $geo) || !copy(demo_pasta_modelo() . '/props.bin', $dir . '/' . $props)) {
            throw new RuntimeException('Não consegui copiar o modelo 3D da demonstração.');
        }
        garantir_modelo3d();
        $pdo->prepare('INSERT INTO modelos_3d (obra_id, nome, tamanho, cache_geo, cache_props, cache_v, n_elementos, n_unidades, frentes_auto, por, em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)')
            ->execute([$obraId, 'Galpão Exemplo — estrutura metálica', filesize($dir . '/' . $geo), $geo, $props, M3D_CACHE_VERSAO,
                (int)($tpl['elementos'] ?? 0), (int)($tpl['unidades'] ?? 0), 'Demonstração', $agora]);
        $modeloId = (int)$pdo->lastInsertId();
        $empresas = ['Montadora A', 'Montadora B'];
        $insG = $pdo->prepare('INSERT INTO m3d_grupos (obra_id, modelo_id, nome, atividade, empresa, responsavel, inicio, fim, status, concluido_em, obs, por, em, atualizado_por, atualizado_em)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)');
        $insE = $pdo->prepare('INSERT INTO m3d_elementos (obra_id, modelo_id, grupo_id, guid, rotulo) VALUES (?, ?, ?, ?, NULL)');
        foreach ($tpl['frentes'] as $k => $f) {
            $emp = stripos($f['nome'], 'telha') !== false ? 'Telhas C' : $empresas[$k % 2];
            $insG->execute([$obraId, $modeloId, $f['nome'], $f['atividade'], $emp, 'Encarregado ' . chr(65 + $k % 4), $dia($f['ini']), $dia($f['fim']),
                $f['status'], $dia($f['concl']), 'Demonstração', $agora, 'Demonstração', $agora]);
            $gid = (int)$pdo->lastInsertId();
            foreach ($f['guids'] as $g) {
                $insE->execute([$obraId, $modeloId, $gid, $g]);
            }
        }
        if ($dono) {
            $pdo->commit();
        }
    } catch (Throwable $e) {
        if ($dono && $pdo->inTransaction()) {
            $pdo->rollBack();
        }
        if (isset($obraId)) {
            @array_map('unlink', glob(m3d_dir($obraId) . '/*.bin') ?: []);
        }
        throw $e;
    }
    registrar_global('obra_demo_criada', ['obra_id' => $obraId, 'usuario' => (int)$uid]);
    return $obraId;
}
