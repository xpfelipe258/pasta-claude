<?php
// Publicação CLI dos dois arquivos do dashboard de Qualidade.
if (PHP_SAPI !== 'cli') { http_response_code(403); exit; }
umask(0077);
$work = '/home/u502500687/.codex-publicacoes/qualidade-20261123-3cafd08';
if (!is_dir($work) && !mkdir($work, 0700, true)) { throw new RuntimeException('Falha ao preparar publicação.'); }
foreach (['completed.json', 'failed.json'] as $marker) {
    if (is_file($work . '/' . $marker)) { echo file_get_contents($work . '/' . $marker); exit; }
}
$url = 'https://raw.githubusercontent.com/xpfelipe258/pasta-claude/3cafd08fecb026508db36c4b203b57f7ba05fb9a/ferramentas/publicar_seletivo.php';
$c = curl_init($url);
curl_setopt_array($c, [CURLOPT_RETURNTRANSFER=>true, CURLOPT_CONNECTTIMEOUT=>15, CURLOPT_TIMEOUT=>60,
    CURLOPT_FAILONERROR=>true, CURLOPT_PROTOCOLS=>CURLPROTO_HTTPS, CURLOPT_SSL_VERIFYHOST=>2,
    CURLOPT_SSL_VERIFYPEER=>true, CURLOPT_USERAGENT=>'MTEC-Publicacao-Seletiva/1.0']);
$data = curl_exec($c); $error = curl_error($c); curl_close($c);
if ($data === false || hash('sha256', $data) !== '76e3f10991d481e21430dbd00645e9c6f1531cc004895c847d0a01c14d33bb7e') { throw new RuntimeException('Falha na conferência do publicador: ' . $error); }
$script = $work . '/publicar_seletivo.php';
if (file_put_contents($script . '.tmp', $data) !== strlen($data) || !rename($script . '.tmp', $script)) { throw new RuntimeException('Falha ao preparar publicador.'); }
require $script;
$manifest = json_decode(<<<'JSON'
{
  "target": "/home/u502500687/domains/mtecengenharia.net/public_html/solucoes/obras",
  "repository": "xpfelipe258/pasta-claude",
  "assets_commit": "3cafd08fecb026508db36c4b203b57f7ba05fb9a",
  "report": "publicacao_qualidade_20261123.json",
  "file_count": 2,
  "files": [
    {
      "path": "qualidade.js",
      "bytes": 65396,
      "md5": "7ff7583251730711fda59974777359b6",
      "sha256": "6c1f14d24c91ea82a88e62b3cce82fbf7851f351e7d48b1eedce3bc2494f1f13",
      "before_git_sha1_normalized": "9f1583cb6df0514aeb08b6c199156963bb30af50"
    },
    {
      "path": "style.css",
      "bytes": 179960,
      "md5": "fb9dc2d8c48c655857c45e3fe95e26e1",
      "sha256": "9587867ffc28ade498a7fe0079bf49b79d51a46dc2a76aee894c99cba5aef699",
      "before_git_sha1_normalized": "20fdd8fe9ccf552ee311773e782e88b7afe1b349"
    }
  ],
  "commits": [
    {
      "sha": "e6d2f14a2540b5075631f8d16aaf1bd1ab36bf9b",
      "message": "Dashboard de status de não conformidades e filtros por empresa"
    },
    {
      "sha": "c4e3cddfba3f96f4c5c8dcca8d124ecb8d163e8f",
      "message": "Layout responsivo do dashboard de Qualidade"
    },
    {
      "sha": "3cafd08fecb026508db36c4b203b57f7ba05fb9a",
      "message": "Publicação seletiva permite CSS com backup e verificação de hashes"
    }
  ]
}
JSON
, true, 512, JSON_THROW_ON_ERROR);
$result = ps_publicar($manifest, $work, getenv('PUB_REV') ?: '3cafd08fecb026508db36c4b203b57f7ba05fb9a');
echo json_encode($result, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE) . "\n";
exit($result['status'] === 'concluida' ? 0 : 1);
