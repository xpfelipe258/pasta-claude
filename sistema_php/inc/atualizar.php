<?php
// Atualiza os arquivos do sistema a partir do GitHub, preservando configuração e banco de dados.

function http_get_github($url, $token)
{
    $cab = ['User-Agent: obra198-atualizador', 'Accept: application/vnd.github+json'];
    if ($token) {
        $cab[] = 'Authorization: Bearer ' . $token;
    }
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => true, CURLOPT_HTTPHEADER => $cab,
            CURLOPT_TIMEOUT => 60, CURLOPT_CONNECTTIMEOUT => 15]);
        $corpo = curl_exec($ch);
        $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $falha = curl_error($ch);
        curl_close($ch);
        if ($corpo === false) {
            throw new RuntimeException('Sem conexão com o GitHub: ' . $falha);
        }
    } else {
        $ctx = stream_context_create(['http' => ['header' => implode("\r\n", $cab), 'timeout' => 60, 'ignore_errors' => true]]);
        $corpo = @file_get_contents($url, false, $ctx);
        $status = 0;
        if (isset($http_response_header) && preg_match('/\s(\d{3})\s/', end($http_response_header), $m)) {
            $status = (int)$m[1];
        }
        if ($corpo === false) {
            throw new RuntimeException('Sem conexão com o GitHub (habilite cURL ou allow_url_fopen).');
        }
    }
    if ($status === 401 || $status === 403 || $status === 404) {
        throw new RuntimeException('Acesso negado ao repositório. Confira o token em inc/config.php.');
    }
    if ($status >= 400) {
        throw new RuntimeException("GitHub respondeu HTTP $status.");
    }
    return $corpo;
}

function atualizar_pelo_github(array $cfg)
{
    if (!class_exists('ZipArchive')) {
        throw new RuntimeException('A extensão zip do PHP não está habilitada na hospedagem.');
    }
    $repo = $cfg['github_repositorio'] ?? '';
    $ramo = $cfg['github_ramo'] ?? 'main';
    $pasta = $cfg['github_pasta'] ?? 'sistema_php';
    $token = $cfg['github_token'] ?? '';
    $api = "https://api.github.com/repos/$repo";
    $info = json_decode(http_get_github("$api/commits/" . str_replace('%2F', '/', rawurlencode($ramo)), $token), true);
    $sha = $info['sha'] ?? '';
    if (!$sha) {
        throw new RuntimeException('Não foi possível identificar a versão no GitHub.');
    }
    if ($sha === sistema_ler('versao_codigo')) {
        return ['mensagem' => 'O sistema já está na versão mais recente (' . substr($sha, 0, 7) . ').'];
    }
    $tmp = tempnam(sys_get_temp_dir(), 'o198');
    file_put_contents($tmp, http_get_github("$api/zipball/$sha", $token));
    $zip = new ZipArchive();
    if ($zip->open($tmp) !== true) {
        throw new RuntimeException('Pacote de atualização inválido.');
    }
    $protegidos = ['inc/config.php'];
    $alterados = 0;
    for ($i = 0; $i < $zip->numFiles; $i++) {
        $nome = $zip->getNameIndex($i);
        $partes = explode('/', $nome, 2);
        if (count($partes) < 2 || substr($nome, -1) === '/') {
            continue;
        }
        $rel = $partes[1];
        if (strpos($rel, $pasta . '/') !== 0) {
            continue;
        }
        $rel = substr($rel, strlen($pasta) + 1);
        if ($rel === '' || in_array($rel, $protegidos, true) || strpos($rel, 'dados/') === 0 || strpos($rel, '..') !== false) {
            continue;
        }
        $conteudo = $zip->getFromIndex($i);
        $alvo = RAIZ . '/' . $rel;
        if (file_exists($alvo) && file_get_contents($alvo) === $conteudo) {
            continue;
        }
        if (!is_dir(dirname($alvo))) {
            mkdir(dirname($alvo), 0755, true);
        }
        if (file_put_contents($alvo . '.novo', $conteudo) === false || !rename($alvo . '.novo', $alvo)) {
            throw new RuntimeException("Sem permissão para gravar $rel.");
        }
        $alterados++;
    }
    $zip->close();
    @unlink($tmp);
    sistema_gravar('versao_codigo', $sha);
    registrar_alteracao('atualizacao_sistema', ['versao' => substr($sha, 0, 7), 'arquivos' => $alterados]);
    return ['mensagem' => "Sistema atualizado para a versão " . substr($sha, 0, 7) . " ($alterados arquivo(s))."];
}
