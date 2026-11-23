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
  "assets_commit": "88a686be22079c2eb241ab93b68b4f21443e611d",
  "report": "publicacao_coluna_uso_20261123.json",
  "file_count": 1,
  "files": [
    {
      "path": "app.js",
      "bytes": 625346,
      "sha256": "0c0a7d401e934600068eee3e5c64aaedbe7c7bee9045d1d248bd7afee00f0798",
      "md5": "ed8cf0a91ff25ce74f7ac7c648be76d9",
      "before_git_sha1_normalized": "5bbb2277781ad996bbe21f341e6030b6cd6310c4"
    }
  ],
  "commits": [
    {
      "sha": "88a686be22079c2eb241ab93b68b4f21443e611d",
      "message": "Relatório de equipamentos: tipo de cobrança em coluna USO separada"
    }
  ]
}
JSON
, true, 512, JSON_THROW_ON_ERROR);
$result = ps_publicar($manifest, '/home/u502500687/.codex-publicacoes/uso-20261123-88a686b', getenv('PUB_REV') ?: '88a686be22079c2eb241ab93b68b4f21443e611d');
echo json_encode($result, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE) . "\n";
exit($result['status'] === 'concluida' ? 0 : 1);
