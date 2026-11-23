<?php
// Publicação CLI exclusiva do relatório de consumo em app.js.
if (PHP_SAPI !== 'cli') { http_response_code(403); exit; }
$helper = '/home/u502500687/.codex-publicacoes/qualidade-20261123-3cafd08/publicar_seletivo.php';
if (!is_file($helper) || hash_file('sha256', $helper) !== '76e3f10991d481e21430dbd00645e9c6f1531cc004895c847d0a01c14d33bb7e') { throw new RuntimeException('Publicador divergente.'); }
require $helper;
$manifest = json_decode(<<<'JSON'
{
  "target": "/home/u502500687/domains/mtecengenharia.net/public_html/solucoes/obras",
  "repository": "xpfelipe258/pasta-claude",
  "assets_commit": "76e60b2db8b2aa5ed2f443dda230d59985468a19",
  "report": "publicacao_consumo_20261123.json",
  "file_count": 1,
  "files": [
    {
      "path": "app.js",
      "bytes": 625379,
      "sha256": "7787e77023a21f848fafa6adef11eedcdd3915f7ef563710ac88eabee88fe45b",
      "md5": "de358edd04e027ef3d3b1085fb91f702",
      "before_git_sha1_normalized": "c2cdc03b787e506a6ba639c81733021c9aacf088"
    }
  ],
  "commits": [
    {
      "sha": "76e60b2db8b2aa5ed2f443dda230d59985468a19",
      "message": "Consumo: mensal só na estimativa, dias do período e dias efetivos de uso no relatório"
    }
  ]
}
JSON
, true, 512, JSON_THROW_ON_ERROR);
$result = ps_publicar($manifest, '/home/u502500687/.codex-publicacoes/consumo-20261123-76e60b2', getenv('PUB_REV') ?: '76e60b2db8b2aa5ed2f443dda230d59985468a19');
echo json_encode($result, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE) . "\n";
exit($result['status'] === 'concluida' ? 0 : 1);
