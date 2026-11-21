<?php
// Publicação pontual de rótulos, somente por CLI e com backup.
if (PHP_SAPI !== 'cli') { http_response_code(403); exit; }
$helper = '/home/u502500687/.codex-publicacoes/obras-20261118-cc0ff86/publicar_seletivo.php';
if (!is_file($helper) || hash_file('sha256', $helper) !== '3802695cd4139b8b4a14d858c338ffbe7b19feb4517ab751e276cce8550bd61d') { throw new RuntimeException('Publicador não confere. Nenhum arquivo foi alterado.'); }
require $helper;
$manifest = json_decode(<<<'JSON'
{
  "target": "/home/u502500687/domains/mtecengenharia.net/public_html/solucoes/obras",
  "repository": "xpfelipe258/pasta-claude",
  "assets_commit": "998e475cbb79c2a52521c22ca16c8eb6ecac9fa0",
  "report": "publicacao_rotulo_20261119.json",
  "file_count": 1,
  "files": [
    {
      "path": "app.js",
      "bytes": 618337,
      "sha256": "285987fb5487bdeac7b973bd0cacdd59a1d21859163b037c45da0ec63e83f91f",
      "md5": "8e8af50207e5f02a3b527a9d0c6e6075",
      "before_git_sha1_normalized": "c432130e1cf15804cef423758b6c36899f1092b0"
    }
  ],
  "commits": [
    {
      "sha": "998e475cbb79c2a52521c22ca16c8eb6ecac9fa0",
      "message": "Remove RÓTULA dos rótulos de valor do item no catálogo"
    }
  ]
}
JSON
, true, 512, JSON_THROW_ON_ERROR);
$result = ps_publicar($manifest, '/home/u502500687/.codex-publicacoes/rotulo-20261119-998e475', getenv('PUB_REV') ?: '998e475cbb79c2a52521c22ca16c8eb6ecac9fa0');
echo json_encode($result, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE) . "\n";
exit($result['status'] === 'concluida' ? 0 : 1);
