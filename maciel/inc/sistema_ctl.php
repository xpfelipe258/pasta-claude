<?php
// Controle do sistema: tela do ADMINISTRADOR GERAL (dono da plataforma). A Central da empresa que o cliente vê não muda; esta área é um acréscimo
// que só o perfil Administrador enxerga: visão da plataforma, empresas clientes, todas as obras, todos os usuários, configurações globais,
// modo de manutenção, auditoria e informações técnicas.

/** Pasta de dados das obras (IFC, fotos, documentos). Fica fora do Git. */
function sis_pasta_dados() { return realpath(__DIR__ . '/../dados_obras') ?: (__DIR__ . '/../dados_obras'); }

/** Tamanho em bytes de uma pasta (0 se não existir). Limita a varredura para não pesar a tela. */
function sis_tamanho_pasta($dir, $limiteArquivos = 20000)
{
    if (!is_dir($dir)) { return 0; }
    $t = 0; $n = 0;
    try {
        $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS));
        foreach ($it as $f) {
            if ($f->isFile()) { $t += $f->getSize(); if (++$n >= $limiteArquivos) { break; } }
        }
    } catch (Throwable $e) { /* pasta ilegível: conta o que deu */ }
    return $t;
}

function sis_bytes($b)
{
    $b = (float)$b;
    foreach (['B', 'KB', 'MB', 'GB'] as $i => $u) {
        if ($b < 1024 || $u === 'GB') { return ($i === 0 ? number_format($b, 0, ',', '.') : number_format($b, 1, ',', '.')) . ' ' . $u; }
        $b /= 1024;
    }
    return '';
}

function manutencao_salvar($ativo, $mensagem)
{
    $mensagem = trim(mb_substr((string)$mensagem, 0, 300));
    $atual = manutencao_info();
    $c = ['ativo' => $ativo ? 1 : 0, 'mensagem' => $mensagem, 'desde' => $ativo ? ($atual['ativo'] ? ($atual['desde'] ?: agora()) : agora()) : ''];
    global_gravar('manutencao', json_encode($c, JSON_UNESCAPED_UNICODE));
    return $c;
}

/** Últimos acessos (login) por usuário, em uma consulta só. */
function sis_ultimos_acessos()
{
    $r = [];
    foreach (q_global("SELECT usuario, MAX(quando) AS q FROM auditoria_global WHERE acao = 'login' GROUP BY usuario")->fetchAll() as $l) { $r[(string)$l['usuario']] = $l['q']; }
    return $r;
}

/** Resumo da plataforma para a visão geral. */
function sis_resumo()
{
    $r = ['ind' => planos_indicadores(), 'obras' => ['ativa' => 0, 'arquivada' => 0, 'rascunho' => 0, 'copias' => 0, 'total' => 0], 'usuarios' => ['total' => 0, 'ativos' => 0, 'admin' => 0, 'sem_email' => 0, 'org' => 0],
        'alertas' => [], 'orcamentos' => ['qtd' => 0, 'aprovados' => 0]];
    foreach (q_global('SELECT status, empresa_vinculada FROM obras')->fetchAll() as $o) {
        $r['obras']['total']++;
        if (trim((string)($o['empresa_vinculada'] ?? '')) !== '') { $r['obras']['copias']++; continue; }
        $s = in_array($o['status'], ['ativa', 'arquivada', 'rascunho'], true) ? $o['status'] : 'ativa';
        $r['obras'][$s]++;
    }
    foreach (q_global('SELECT perfil, ativo, email, organizacao_id FROM usuarios')->fetchAll() as $u) {
        $r['usuarios']['total']++;
        if ((int)$u['ativo'] !== 1) { continue; }
        $r['usuarios']['ativos']++;
        if ($u['perfil'] === 'admin') { $r['usuarios']['admin']++; }
        if (trim((string)$u['email']) === '') { $r['usuarios']['sem_email']++; }
        if ((int)$u['organizacao_id'] > 0) { $r['usuarios']['org']++; }
    }
    try {
        $r['orcamentos']['qtd'] = (int)q_global('SELECT COUNT(*) FROM com_orcamentos')->fetchColumn();
        $r['orcamentos']['aprovados'] = (int)q_global("SELECT COUNT(*) FROM com_orcamentos WHERE status = 'aprovada'")->fetchColumn();
    } catch (Throwable $e) { /* módulo comercial ainda sem uso */ }
    // alertas da plataforma
    $cfg = planos_config();
    foreach (q_global('SELECT id FROM organizacoes ORDER BY nome')->fetchAll(PDO::FETCH_COLUMN) as $oid) {
        $o = organizacao_ler($oid); $s = organizacao_situacao($o, $cfg);
        if (in_array($s['codigo'], ['VENCIDA', 'TOLERANCIA'], true)) { $r['alertas'][] = ['nivel' => 'verm', 'txt' => $o['nome'] . ': assinatura ' . mb_strtolower($s['rotulo'], 'UTF-8') . ($s['dias'] !== null ? ' há ' . abs($s['dias']) . ' dia(s)' : '') . '.', 'link' => 'admin_planos.php']; }
        elseif ($s['codigo'] === 'A_VENCER') { $r['alertas'][] = ['nivel' => 'amar', 'txt' => $o['nome'] . ': ' . mb_strtolower($s['rotulo'], 'UTF-8') . '.', 'link' => 'admin_planos.php']; }
        elseif ($s['codigo'] === 'SUSPENSA') { $r['alertas'][] = ['nivel' => 'verm', 'txt' => $o['nome'] . ': empresa suspensa.', 'link' => 'admin_planos.php']; }
        $lo = organizacao_limite_obras($o); $uo = organizacao_obras_em_uso($oid);
        if ($lo > 0 && $uo >= $lo) { $r['alertas'][] = ['nivel' => 'amar', 'txt' => $o['nome'] . ': no limite de obras do plano (' . $uo . ' de ' . $lo . ') — oportunidade de upgrade.', 'link' => 'admin_planos.php']; }
        $lu = organizacao_limite_usuarios($o); $uu = organizacao_usuarios_em_uso($oid);
        if ($lu > 0 && $uu >= $lu) { $r['alertas'][] = ['nivel' => 'amar', 'txt' => $o['nome'] . ': no limite de usuários do plano (' . $uu . ' de ' . $lu . ').', 'link' => 'admin_planos.php']; }
    }
    if (!$cfg['exigir_plano']) { $r['alertas'][] = ['nivel' => 'info', 'txt' => 'A regra de plano está DESLIGADA: os limites de obras, usuários e áreas das empresas não estão sendo aplicados.', 'link' => 'sistema.php?v=config']; }
    if (manutencao_info()['ativo']) { $r['alertas'][] = ['nivel' => 'verm', 'txt' => 'Modo de manutenção LIGADO: só administradores conseguem entrar.', 'link' => 'sistema.php?v=config']; }
    if ($r['usuarios']['sem_email'] > 0) { $r['alertas'][] = ['nivel' => 'info', 'txt' => $r['usuarios']['sem_email'] . ' usuário(s) ativo(s) sem e-mail: não recebem avisos nem link de senha.', 'link' => 'sistema.php?v=usuarios']; }
    if ($r['usuarios']['admin'] < 2) { $r['alertas'][] = ['nivel' => 'info', 'txt' => 'Só há ' . $r['usuarios']['admin'] . ' administrador ativo: considere ter um segundo para emergências.', 'link' => 'sistema.php?v=usuarios']; }
    return $r;
}

/** Pode desativar este usuário? (nunca você mesmo nem o último administrador ativo) */
function sis_pode_desativar(array $alvo, array $eu)
{
    if ((int)$alvo['id'] === (int)$eu['id']) { return 'Você não pode desativar o seu próprio usuário.'; }
    if ($alvo['perfil'] === 'admin' && (int)$alvo['ativo'] === 1) {
        $n = (int)q_global("SELECT COUNT(*) FROM usuarios WHERE perfil = 'admin' AND ativo = 1")->fetchColumn();
        if ($n <= 1) { return 'Este é o último administrador ativo: o sistema não pode ficar sem um.'; }
    }
    return '';
}
