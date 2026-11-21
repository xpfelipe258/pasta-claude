<?php
// Publicação por CLI: lista fechada de arquivos, commit fixo, backup e rollback.
function ps_normalizar($s) { return rtrim(str_replace("\r\n", "\n", $s), "\r\n"); }
function ps_json($path, array $data) {
    $tmp = $path . '.tmp';
    if (file_put_contents($tmp, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), LOCK_EX) === false || !rename($tmp, $path)) {
        throw new RuntimeException('Não foi possível gravar o estado da publicação.');
    }
}
function ps_baixar($url) {
    $c = curl_init($url);
    curl_setopt_array($c, [CURLOPT_RETURNTRANSFER=>true, CURLOPT_CONNECTTIMEOUT=>15, CURLOPT_TIMEOUT=>60,
        CURLOPT_FAILONERROR=>true, CURLOPT_PROTOCOLS=>CURLPROTO_HTTPS, CURLOPT_SSL_VERIFYPEER=>true,
        CURLOPT_SSL_VERIFYHOST=>2, CURLOPT_USERAGENT=>'MTEC-Publicacao-Seletiva/1.0']);
    $data = curl_exec($c);
    $erro = curl_error($c);
    curl_close($c);
    if ($data === false) { throw new RuntimeException('Falha ao baixar o arquivo do commit: ' . $erro); }
    return $data;
}
function ps_publicar(array $m, $work, $revision, callable $fetch = null) {
    $fetch = $fetch ?: 'ps_baixar';
    $root = realpath($m['target'] ?? '');
    if (!$root || $root !== ($m['target'] ?? '') || !is_dir($root . '/inc') || !is_dir($root . '/dados_obras')) {
        throw new RuntimeException('Diretório de destino inválido.');
    }
    if (!preg_match('/^[a-f0-9]{40}$/D', $m['assets_commit'] ?? '') || !preg_match('/^[a-f0-9]{40}$/D', $revision)) { throw new RuntimeException('Commit inválido.'); }
    if (!preg_match('~^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$~D', $m['repository'] ?? '')) { throw new RuntimeException('Repositório inválido.'); }
    if (count($m['files'] ?? []) !== (int)($m['file_count'] ?? 0) || empty($m['files']) || count($m['files']) > 30) { throw new RuntimeException('Lista de arquivos inválida.'); }
    if (!preg_match('/^publicacao_[A-Za-z0-9_-]+\.json$/D', $m['report'] ?? '')) { throw new RuntimeException('Nome do relatório inválido.'); }
    $report = $root . '/dados_obras/' . $m['report'];
    if (is_link($root . '/dados_obras') || is_link($report) || is_link($root . '/dados_obras/registro_commits.txt')) { throw new RuntimeException('Destino com link simbólico.'); }
    if (!is_dir($work) && !mkdir($work, 0700, true)) { throw new RuntimeException('Pasta de trabalho indisponível.'); }
    $lock = fopen($work . '/lock', 'c');
    if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) { return ['status'=>'em_execucao']; }
    if (is_file($work . '/completed.json')) { return json_decode(file_get_contents($work . '/completed.json'), true); }
    if (is_file($work . '/failed.json')) { return json_decode(file_get_contents($work . '/failed.json'), true); }
    $state = ['status'=>'iniciada', 'commit'=>$revision, 'assets_commit'=>$m['assets_commit'], 'em'=>(new DateTimeImmutable('now', new DateTimeZone('America/Sao_Paulo')))->format('Y-m-d H:i:s'), 'arquivos'=>[]];
    $changed = [];
    $before = [];
    $seen = [];
    $attempt = bin2hex(random_bytes(6));
    $stage = $work . '/stage-' . $attempt;
    $backup = $work . '/backup-' . $attempt;
    try {
        ps_json($report, $state);
        foreach ($m['files'] as $f) {
            $p = $f['path'] ?? '';
            if (!preg_match('~^(?:inc/)?[A-Za-z0-9_-]+\.(?:php|js|json|html)$~D', $p) || isset($seen[$p])) { throw new RuntimeException('Caminho duplicado ou não permitido.'); }
            $seen[$p] = true;
            $dest = $root . '/' . $p;
            $parent = realpath(dirname($dest));
            if (!$parent || ($parent !== $root && $parent !== $root . '/inc') || is_link($dest) || is_link(dirname($dest))) { throw new RuntimeException('Caminho fora do destino: ' . $p); }
            if (!preg_match('/^[a-f0-9]{64}$/D', $f['sha256'] ?? '')) { throw new RuntimeException('Hash esperado inválido.'); }
            $old = is_file($dest) ? file_get_contents($dest) : null;
            $before[$p] = $old === null ? null : hash('sha256', $old);
            if ($old !== null && hash('sha256', $old) === $f['sha256']) { continue; }
            $normalized = $old === null ? null : ps_normalizar($old) . "\n";
            $oldNorm = $old === null ? null : sha1('blob ' . strlen($normalized) . "\0" . $normalized);
            if ($oldNorm !== ($f['before_git_sha1_normalized'] ?? null)) { throw new RuntimeException('O servidor tem outra alteração em ' . $p . '. Nenhum arquivo foi substituído. Hash atual: ' . ($oldNorm ?? 'ausente')); }
            $url = 'https://raw.githubusercontent.com/' . $m['repository'] . '/' . $m['assets_commit'] . '/maciel/' . implode('/', array_map('rawurlencode', explode('/', $p)));
            $data = $fetch($url);
            if (strlen($data) !== (int)$f['bytes'] || hash('sha256', $data) !== $f['sha256'] || hash('md5', $data) !== $f['md5']) { throw new RuntimeException('Arquivo baixado não confere: ' . $p); }
            if (substr($p, -4) === '.php') { token_get_all($data, TOKEN_PARSE); }
            if (!is_dir(dirname($stage . '/' . $p))) { mkdir(dirname($stage . '/' . $p), 0700, true); }
            if (file_put_contents($stage . '/' . $p, $data) !== strlen($data)) { throw new RuntimeException('Falha ao preparar ' . $p); }
        }
        $state['status'] = 'validada'; ps_json($report, $state);
        foreach ($m['files'] as $f) {
            $p = $f['path']; $dest = $root . '/' . $p;
            if (!is_file($stage . '/' . $p)) { continue; }
            $now = is_file($dest) ? hash_file('sha256', $dest) : null;
            if ($now !== $before[$p]) { throw new RuntimeException('Arquivo alterado durante a publicação: ' . $p); }
            if ($now !== null) {
                if (!is_dir(dirname($backup . '/' . $p))) { mkdir(dirname($backup . '/' . $p), 0700, true); }
                if (!copy($dest, $backup . '/' . $p)) { throw new RuntimeException('Falha ao copiar a versão anterior: ' . $p); }
            }
            $tmp = $dest . '.deploy-' . $attempt;
            if (!copy($stage . '/' . $p, $tmp)) { throw new RuntimeException('Falha ao preparar a substituição: ' . $p); }
            chmod($tmp, is_file($dest) ? (fileperms($dest) & 0777) : 0644);
            if (!rename($tmp, $dest)) { @unlink($tmp); throw new RuntimeException('Falha ao substituir ' . $p); }
            $changed[] = $f;
        }
        foreach ($m['files'] as $f) {
            $dest = $root . '/' . $f['path'];
            if (hash_file('sha256', $dest) !== $f['sha256'] || hash_file('md5', $dest) !== $f['md5']) { throw new RuntimeException('Conferência após publicação falhou: ' . $f['path']); }
            $state['arquivos'][] = ['arquivo'=>$f['path'], 'md5'=>$f['md5'], 'sha256'=>$f['sha256']];
        }
        $log = $root . '/dados_obras/registro_commits.txt';
        $handle = fopen($log, 'c+');
        if (!$handle || !flock($handle, LOCK_EX)) { throw new RuntimeException('Não foi possível abrir o registro de commits.'); }
        $text = stream_get_contents($handle);
        $commits = $m['commits'] ?? [];
        $commits[] = ['sha'=>$revision, 'message'=>'Publicação seletiva validada da importação de BM e marquise'];
        fseek($handle, 0, SEEK_END);
        foreach ($commits as $c) {
            if (!preg_match('/^[a-f0-9]{40}$/D', $c['sha'] ?? '')) { continue; }
            if (strpos($text, $c['sha']) !== false || preg_match('/\|\s*' . preg_quote(substr($c['sha'], 0, 7), '/') . '(?:\s|\|)/', $text)) { continue; }
            $line = $state['em'] . ' | ' . $c['sha'] . ' | ' . str_replace(["\r", "\n"], ' ', $c['message']) . "\n";
            if (fwrite($handle, $line) !== strlen($line)) { throw new RuntimeException('Falha ao acrescentar o registro de commits.'); }
            $text .= $line;
        }
        fflush($handle); flock($handle, LOCK_UN); fclose($handle);
        $state['status'] = 'concluida'; $state['backup'] = $backup;
        ps_json($report, $state); ps_json($work . '/completed.json', $state);
        return $state;
    } catch (Throwable $e) {
        $rollback = [];
        foreach (array_reverse($changed) as $f) {
            $p = $f['path']; $dest = $root . '/' . $p;
            if (!is_file($dest) || hash_file('sha256', $dest) !== $f['sha256']) { $rollback[] = $p . ': preservada alteração concorrente'; continue; }
            if (is_file($backup . '/' . $p)) {
                if (!copy($backup . '/' . $p, $dest)) { $rollback[] = $p; }
            } elseif (!unlink($dest)) { $rollback[] = $p; }
        }
        $state['status'] = 'falhou'; $state['erro'] = $e->getMessage(); $state['rollback_pendente'] = $rollback;
        ps_json($report, $state); ps_json($work . '/failed.json', $state);
        return $state;
    } finally { flock($lock, LOCK_UN); fclose($lock); }
}
if (isset($_SERVER['SCRIPT_FILENAME']) && realpath($_SERVER['SCRIPT_FILENAME']) === __FILE__) {
    if (PHP_SAPI !== 'cli') { http_response_code(403); exit; }
    $m = json_decode(file_get_contents($argv[1] ?? ''), true, 512, JSON_THROW_ON_ERROR);
    $result = ps_publicar($m, __DIR__, $argv[2] ?? '');
    echo json_encode($result, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT) . "\n";
    exit($result['status'] === 'concluida' ? 0 : 1);
}
