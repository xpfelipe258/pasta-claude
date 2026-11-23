<?php
// Publicação seletiva da pizza de status de Qualidade.
if (PHP_SAPI !== 'cli') { http_response_code(403); exit; }
$helper = '/home/u502500687/.codex-publicacoes/qualidade-20261123-3cafd08/publicar_seletivo.php';
if (!is_file($helper) || hash_file('sha256', $helper) !== '76e3f10991d481e21430dbd00645e9c6f1531cc004895c847d0a01c14d33bb7e') { throw new RuntimeException('Publicador divergente.'); }
require $helper;
$manifest = json_decode(<<<'JSON'
{
  "target": "/home/u502500687/domains/mtecengenharia.net/public_html/solucoes/obras",
  "repository": "xpfelipe258/pasta-claude",
  "assets_commit": "e3191a15fe73444f7b25dd0b7bfc35fbba6b7d57",
  "report": "publicacao_pizza_qualidade_20261123.json",
  "file_count": 2,
  "files": [
    {
      "path": "qualidade.js",
      "bytes": 67091,
      "sha256": "cf930aad5f893c18cf6125f5ace0b241ed5493bbdfff0d8f82001634d831377a",
      "md5": "0c6e6e06c1e2780a9861196cd4969013",
      "before_git_sha1_normalized": "725e1b70882a70f472cf4673b6a93cb098803c96"
    },
    {
      "path": "style.css",
      "bytes": 180631,
      "sha256": "4fb71a9d9aedfc1abb5d74cf739ddf601eb16597c3f8a854e7c9394030ad5826",
      "md5": "c64a25fc38146794cda9dab78c549df6",
      "before_git_sha1_normalized": "aa04753e0c15f840baad9051e42c491d5b61651b"
    }
  ],
  "commits": [
    {
      "sha": "5b5a8821d2f69ea9cedacd92000e82b36047f18f",
      "message": "Distribuição das NCs em gráfico de pizza com filtros"
    },
    {
      "sha": "e3191a15fe73444f7b25dd0b7bfc35fbba6b7d57",
      "message": "Estilos responsivos da pizza de Qualidade"
    }
  ]
}
JSON
, true, 512, JSON_THROW_ON_ERROR);
$result = ps_publicar($manifest, '/home/u502500687/.codex-publicacoes/pizza-qualidade-20261123-e3191a1', getenv('PUB_REV') ?: 'e3191a15fe73444f7b25dd0b7bfc35fbba6b7d57');
echo json_encode($result, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE) . "\n";
exit($result['status'] === 'concluida' ? 0 : 1);
