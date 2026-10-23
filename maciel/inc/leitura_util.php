<?php
// Leitura dos documentos da obra dentro do sistema (sem serviço externo): utilitários comuns e leitor de planilhas .xlsx.

function lt_texto($v)
{
    return $v === null ? '' : trim(str_replace("\xC2\xA0", ' ', (string)$v));
}

// Número vindo de célula (aceita pt-BR "1.234,5"); null se não for número.
function lt_numero($v)
{
    if ($v === null || is_bool($v)) {
        return null;
    }
    if (is_int($v) || is_float($v)) {
        return (float)$v;
    }
    $s = trim(str_replace(["\xC2\xA0", 'R$', '%'], '', (string)$v));
    if ($s === '' || !preg_match('/^-?[\d.,\s]+$/', $s)) {
        return null;
    }
    $s = str_replace(' ', '', $s);
    if (strpos($s, ',') !== false) {
        $s = str_replace(',', '.', str_replace('.', '', $s));
    }
    return is_numeric($s) ? (float)$s : null;
}

function lt_unidade($v)
{
    $s = mb_strtolower(lt_texto($v), 'UTF-8');
    $s = str_replace(['m2', 'm3'], ['m²', 'm³'], $s);
    $mapa = ['und' => 'un', 'unid' => 'un', 'unidade' => 'un', 'unidades' => 'un', 'pç' => 'un', 'pc' => 'un', 'peça' => 'un'];
    return $mapa[$s] ?? $s;
}

function lt_data_iso($v)
{
    if ($v instanceof DateTimeInterface) {
        return $v->format('Y-m-d');
    }
    $s = lt_texto($v);
    if (preg_match('/^(\d{2})\/(\d{2})\/(\d{2,4})$/', $s, $m)) {
        $a = (int)$m[3];
        $a += $a < 100 ? 2000 : 0;
        return checkdate((int)$m[2], (int)$m[1], $a) ? sprintf('%04d-%02d-%02d', $a, $m[2], $m[1]) : null;
    }
    return preg_match('/^(\d{4}-\d{2}-\d{2})/', $s, $m) ? $m[1] : null;
}

function lt_up($s)
{
    return mb_strtoupper(lt_texto($s), 'UTF-8');
}

// ---------------------------------------------------------------- .xlsx (ZIP + XML), sem bibliotecas externas

function xlsx_coluna($ref)
{
    preg_match('/^([A-Z]+)/', $ref, $m);
    $n = 0;
    foreach (str_split($m[1] ?? 'A') as $c) {
        $n = $n * 26 + (ord($c) - 64);
    }
    return $n - 1;
}

/**
 * Lê as abas do .xlsx: [['nome' => 'Aba', 'linhas' => [[col0, col1, ...], ...]], ...].
 * Datas viram 'YYYY-MM-DD'. $maxLinhas e $maxCols limitam abas enormes (ex.: planilha com 16.384 colunas declaradas).
 */
function xlsx_ler($caminho, $maxLinhas = 6000, $maxCols = 40)
{
    if (!class_exists('ZipArchive')) {
        throw new RuntimeException('O servidor não tem a extensão ZIP do PHP (necessária para ler .xlsx).');
    }
    $zip = new ZipArchive();
    if ($zip->open($caminho) !== true) {
        throw new RuntimeException('Não consegui abrir a planilha (arquivo .xlsx inválido).');
    }
    $xml = function ($nome) use ($zip) {
        $t = $zip->getFromName($nome);
        return $t === false ? null : $t;
    };
    // textos compartilhados
    $textos = [];
    if (($t = $xml('xl/sharedStrings.xml')) !== null) {
        $r = new XMLReader();
        $r->XML($t);
        while ($r->read()) {
            if ($r->nodeType === XMLReader::ELEMENT && $r->name === 'si') {
                $no = new SimpleXMLElement($r->readOuterXml());
                $s = '';
                foreach ($no->xpath('.//*[local-name()="t"]') as $x) {
                    $s .= (string)$x;
                }
                $textos[] = $s;
            }
        }
        $r->close();
    }
    // estilos: quais formatos são data
    $datas = [];
    if (($t = $xml('xl/styles.xml')) !== null) {
        $st = new SimpleXMLElement($t);
        $fmtData = [];
        foreach ($st->xpath('//*[local-name()="numFmt"]') as $nf) {
            $code = strtolower(preg_replace('/"[^"]*"|\[[^\]]*\]|\\\\./', '', (string)$nf['formatCode']));
            if (preg_match('/[dmy]/', $code) && !preg_match('/[hs]{2}|0\.0|#/', $code)) {
                $fmtData[(int)$nf['numFmtId']] = true;
            }
        }
        $i = 0;
        foreach ($st->xpath('//*[local-name()="cellXfs"]/*[local-name()="xf"]') as $xf) {
            $id = (int)$xf['numFmtId'];
            $datas[$i++] = ($id >= 14 && $id <= 22) || ($id >= 45 && $id <= 47) || isset($fmtData[$id]);
        }
    }
    // abas
    $wb = new SimpleXMLElement((string)$xml('xl/workbook.xml'));
    $rels = [];
    if (($t = $xml('xl/_rels/workbook.xml.rels')) !== null) {
        foreach ((new SimpleXMLElement($t))->xpath('//*[local-name()="Relationship"]') as $rel) {
            $rels[(string)$rel['Id']] = (string)$rel['Target'];
        }
    }
    $saida = [];
    foreach ($wb->xpath('//*[local-name()="sheets"]/*[local-name()="sheet"]') as $sh) {
        $rid = (string)$sh->attributes('http://schemas.openxmlformats.org/officeDocument/2006/relationships')['id'];
        $alvo = $rels[$rid] ?? '';
        $alvo = ltrim($alvo[0] === '/' ? substr($alvo, 1) : 'xl/' . $alvo, '/');
        $conteudo = $xml($alvo);
        if ($conteudo === null) {
            continue;
        }
        $linhas = [];
        $r = new XMLReader();
        $r->XML($conteudo);
        while ($r->read() && count($linhas) < $maxLinhas) {
            if ($r->nodeType !== XMLReader::ELEMENT || $r->name !== 'row') {
                continue;
            }
            $linha = new SimpleXMLElement($r->readOuterXml());
            $n = (int)$linha['r'];
            $vals = [];
            foreach ($linha->c as $c) {
                $col = xlsx_coluna((string)$c['r']);
                if ($col >= $maxCols) {
                    continue;
                }
                $tipo = (string)$c['t'];
                $v = isset($c->v) ? (string)$c->v : null;
                if ($tipo === 's') {
                    $v = $textos[(int)$v] ?? '';
                } elseif ($tipo === 'inlineStr') {
                    $v = (string)$c->is->t;
                } elseif ($tipo === 'b') {
                    $v = $v === '1';
                } elseif ($tipo === 'str' || $tipo === 'e') {
                    $v = $tipo === 'e' ? null : $v;
                } elseif ($v !== null && $v !== '') {
                    $v = is_numeric($v) ? $v + 0 : $v;
                    if (is_numeric($v) && !empty($datas[(int)$c['s']])) {
                        $v = gmdate('Y-m-d', (int)round(($v - 25569) * 86400));
                    }
                }
                $vals[$col] = $v === '' ? null : $v;
            }
            if ($vals) {
                $max = max(array_keys($vals));
                $l = array_fill(0, $max + 1, null);
                foreach ($vals as $k => $v) {
                    $l[$k] = $v;
                }
                while (count($linhas) < $n - 1) {
                    $linhas[] = [];     // linhas vazias mantêm a numeração
                }
                $linhas[] = $l;
            }
        }
        $r->close();
        $saida[] = ['nome' => (string)$sh['name'], 'linhas' => $linhas];
    }
    $zip->close();
    return $saida;
}
