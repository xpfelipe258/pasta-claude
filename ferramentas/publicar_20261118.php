<?php
// Inicializador CLI curto para o limite de 255 caracteres dos comandos do hPanel.
if (PHP_SAPI !== 'cli') { http_response_code(403); exit; }
$work = '/home/u502500687/.codex-publicacoes/obras-20261118-cc0ff86';
umask(0077);
if (!is_dir($work) && !mkdir($work, 0700, true)) { throw new RuntimeException('Não foi possível preparar a publicação.'); }
foreach (['completed.json', 'failed.json'] as $marker) {
    if (is_file($work . '/' . $marker)) { echo file_get_contents($work . '/' . $marker); exit; }
}
function ps_boot_download($name, $expected, $work) {
    $url = 'https://raw.githubusercontent.com/xpfelipe258/pasta-claude/4f2dc24c57e86f7084ef6b009fa47faa5644c734/ferramentas/' . $name;
    $c = curl_init($url);
    curl_setopt_array($c, [CURLOPT_RETURNTRANSFER=>true, CURLOPT_CONNECTTIMEOUT=>15, CURLOPT_TIMEOUT=>60,
        CURLOPT_FAILONERROR=>true, CURLOPT_PROTOCOLS=>CURLPROTO_HTTPS, CURLOPT_SSL_VERIFYHOST=>2,
        CURLOPT_SSL_VERIFYPEER=>true, CURLOPT_USERAGENT=>'MTEC-Publicacao-Seletiva/1.0']);
    $data = curl_exec($c); $error = curl_error($c); curl_close($c);
    if ($data === false || hash('sha256', $data) !== $expected) { throw new RuntimeException('Falha na conferência do inicializador: ' . $name . ' ' . $error); }
    $tmp = $work . '/' . $name . '.tmp';
    if (file_put_contents($tmp, $data) !== strlen($data) || !rename($tmp, $work . '/' . $name)) { throw new RuntimeException('Falha ao preparar ' . $name); }
    return $work . '/' . $name;
}
$script = ps_boot_download('publicar_seletivo.php', '3802695cd4139b8b4a14d858c338ffbe7b19feb4517ab751e276cce8550bd61d', $work);
$manifest = ps_boot_download('publicacao-20261118.json', '33203d7f4bfa6306fe6540c21f60a2a632c7a8dfb6ba2e0a818d64c872b6e65c', $work);
require $script;
$m = json_decode(file_get_contents($manifest), true, 512, JSON_THROW_ON_ERROR);
$m['commits'][] = ['sha'=>'4f2dc24c57e86f7084ef6b009fa47faa5644c734', 'message'=>'Define o manifesto dos 11 arquivos para publicação seletiva'];
$result = ps_publicar($m, $work, getenv('PUB_REV') ?: '4f2dc24c57e86f7084ef6b009fa47faa5644c734');
echo json_encode($result, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE) . "\n";
exit($result['status'] === 'concluida' ? 0 : 1);
