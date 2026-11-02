<?php
// Tabela SINAPI dentro do sistema (insumos e composições da Caixa) + catálogo próprio de estrutura metálica.
// A planilha mensal oficial ("SINAPI_Referência_AAAA_MM.xlsx", abas ISD/ICD/ISE para insumos e CSD/CCD/CSE para composições) é importada pelo
// administrador do sistema, por estado (UF) e regime; todas as empresas clientes pesquisam e levam o item para o orçamento com o custo da tabela.
// Os preços NUNCA são digitados por nós: vêm do arquivo oficial importado. O catálogo próprio (EM-nnn) traz só descrição e unidade, sem preço.

require_once __DIR__ . '/leitura_util.php';

function sinapi_regimes()
{
    return ['SD' => 'Sem desoneração', 'CD' => 'Com desoneração', 'SE' => 'Sem encargos complementares'];
}

function sinapi_ufs()
{
    return ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];
}

function garantir_sinapi()
{
    static $ok = false;
    if ($ok) { return; }
    $sqlite = (config()['driver'] ?? 'mysql') === 'sqlite';
    $pk = $sqlite ? 'INTEGER PRIMARY KEY AUTOINCREMENT' : 'INT AUTO_INCREMENT PRIMARY KEY';
    $fim = $sqlite ? '' : ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4';
    bd()->exec("CREATE TABLE IF NOT EXISTS sinapi_itens (id $pk, ref VARCHAR(7) NOT NULL, uf VARCHAR(2) NOT NULL, regime VARCHAR(2) NOT NULL, tipo VARCHAR(1) NOT NULL,
        codigo VARCHAR(14) NOT NULL, descricao VARCHAR(500) NOT NULL, busca VARCHAR(500) NOT NULL, unidade VARCHAR(14) NULL, classe VARCHAR(160) NULL, preco DOUBLE NOT NULL DEFAULT 0)$fim");
    bd()->exec("CREATE TABLE IF NOT EXISTS sinapi_cargas (id $pk, ref VARCHAR(7) NOT NULL, uf VARCHAR(2) NOT NULL, regime VARCHAR(2) NOT NULL,
        insumos INT NOT NULL DEFAULT 0, composicoes INT NOT NULL DEFAULT 0, arquivo VARCHAR(200) NULL, por VARCHAR(100) NULL, em VARCHAR(19) NULL)$fim");
    try { bd()->exec('CREATE INDEX idx_sinapi_busca ON sinapi_itens (ref, uf, regime, tipo)'); } catch (Throwable $e) { /* já existe */ }
    try { bd()->exec('CREATE INDEX idx_sinapi_cod ON sinapi_itens (codigo)'); } catch (Throwable $e) { /* já existe */ }
    $ok = true;
}

/** Texto sem acento e em maiúsculas, para comparar e buscar. */
function sinapi_norm($t)
{
    $t = mb_strtoupper(trim((string)$t), 'UTF-8');
    $de = ['Á', 'À', 'Â', 'Ã', 'Ä', 'É', 'È', 'Ê', 'Ë', 'Í', 'Ì', 'Î', 'Ï', 'Ó', 'Ò', 'Ô', 'Õ', 'Ö', 'Ú', 'Ù', 'Û', 'Ü', 'Ç', 'Ñ', '²', '³', 'º', 'ª', '"', '“', '”'];
    $pa = ['A', 'A', 'A', 'A', 'A', 'E', 'E', 'E', 'E', 'I', 'I', 'I', 'I', 'O', 'O', 'O', 'O', 'O', 'U', 'U', 'U', 'U', 'C', 'N', '2', '3', 'O', 'A', '', '', ''];
    return preg_replace('/\s+/', ' ', str_replace($de, $pa, $t));
}

/** Número do SINAPI: aceita 1234.56 e "1.234,56"; vazio, "-" e texto viram null. */
function sinapi_preco($v)
{
    if ($v === null || $v === '' || $v === '-' || is_bool($v)) { return null; }
    if (is_int($v) || is_float($v)) { return $v > 0 ? round((float)$v, 2) : null; }
    $t = trim(str_replace(['R$', ' '], '', (string)$v));
    if ($t === '' || !preg_match('/^[\d.,]+$/', $t)) { return null; }
    $t = strpos($t, ',') !== false ? str_replace(',', '.', str_replace('.', '', $t)) : $t;
    $n = (float)$t;
    return $n > 0 ? round($n, 2) : null;
}

/**
 * Lê uma aba da planilha da Caixa e devolve as linhas {codigo, descricao, unidade, classe, preco} do estado pedido.
 * Acha o cabeçalho (linha com "Código" e "Descrição") e a coluna do estado (sigla de duas letras no cabeçalho ou na linha de cima).
 */
function sinapi_extrair_aba(array $linhas, $uf)
{
    $cab = -1;
    for ($i = 0; $i < min(40, count($linhas)); $i++) {
        $n = array_map('sinapi_norm', array_map(function ($c) { return is_scalar($c) ? (string)$c : ''; }, $linhas[$i] ?? []));
        $temCod = false; $temDesc = false;
        foreach ($n as $c) { if (strpos($c, 'CODIGO') === 0) { $temCod = true; } if (strpos($c, 'DESCRI') === 0) { $temDesc = true; } }
        if ($temCod && $temDesc) { $cab = $i; break; }
    }
    if ($cab < 0) { throw new RuntimeException('não encontrei o cabeçalho (Código / Descrição) nesta aba'); }
    $iCod = $iDesc = $iUn = $iCls = $iUf = -1;
    foreach ($linhas[$cab] as $j => $c) {
        $n = sinapi_norm(is_scalar($c) ? (string)$c : '');
        if ($iCod < 0 && strpos($n, 'CODIGO') === 0) { $iCod = $j; }
        elseif ($iDesc < 0 && strpos($n, 'DESCRI') === 0) { $iDesc = $j; }
        elseif ($iUn < 0 && strpos($n, 'UNIDADE') === 0) { $iUn = $j; }
        elseif ($iCls < 0 && (strpos($n, 'CLASSIFICACAO') === 0 || strpos($n, 'GRUPO') === 0)) { $iCls = $j; }
    }
    for ($i = $cab; $i >= max(0, $cab - 3) && $iUf < 0; $i--) {   // a sigla do estado fica no cabeçalho ou até 3 linhas acima (células mescladas)
        foreach ($linhas[$i] ?? [] as $j => $c) { if (is_string($c) && strtoupper(trim($c)) === $uf) { $iUf = $j; break; } }
    }
    if ($iUf < 0) { throw new RuntimeException('não achei a coluna do estado ' . $uf); }
    $out = [];
    for ($i = $cab + 1; $i < count($linhas); $i++) {
        $l = $linhas[$i] ?? [];
        $cod = isset($l[$iCod]) ? preg_replace('/\D/', '', (string)$l[$iCod]) : '';
        $desc = isset($l[$iDesc]) ? trim((string)$l[$iDesc]) : '';
        if ($cod === '' || $desc === '') { continue; }
        $preco = sinapi_preco($l[$iUf] ?? null);
        if ($preco === null) { continue; }
        $out[] = ['codigo' => $cod, 'descricao' => mb_substr($desc, 0, 500), 'unidade' => $iUn >= 0 ? mb_substr(trim((string)($l[$iUn] ?? '')), 0, 14) : '',
            'classe' => $iCls >= 0 && isset($l[$iCls]) ? mb_substr(trim((string)$l[$iCls]), 0, 160) : '', 'preco' => $preco];
    }
    return $out;
}

/** Regime (SD/CD/SE) pelo texto (nome do arquivo ou cabeçalho do PDF); null se não der para saber. */
function sinapi_regime_do_texto($t)
{
    $n = preg_replace('/[^A-Z0-9]/', '', sinapi_norm($t));
    if (preg_match('/NAODESONERAD|SEMDESONERAC|SEMDESON|NDESONERAD/', $n)) { return 'SD'; }
    if (preg_match('/SEMENCARGOS|SEMENCARGO/', $n)) { return 'SE'; }
    if (preg_match('/DESONERAD|COMDESONERAC|COMDESON/', $n)) { return 'CD'; }
    return null;
}

/** Insumo (I) ou composição (C) pelo texto; null se não der para saber. */
function sinapi_tipo_do_texto($t)
{
    $n = sinapi_norm($t);
    $i = preg_match('/INSUMO/', $n); $c = preg_match('/COMPOSIC/', $n);
    if ($i && !$c) { return 'I'; }
    if ($c && !$i) { return 'C'; }
    return null;
}

/**
 * Lê o texto de um PDF do SINAPI (relatório por estado) e devolve as linhas {codigo, descricao, unidade, classe, preco}.
 * Linha de item = código (3 a 8 números) + descrição + unidade + [origem do preço: C, CR ou AS] + preço (1.234,56). A descrição pode quebrar em várias linhas.
 * Quando há mais de uma coluna de preço, vale a primeira. Devolve também quantas linhas não foram entendidas.
 */
function sinapi_ler_texto_pdf($texto)
{
    $preco = '(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2,4}';
    $un = '[A-Z][A-Z0-9²³]{0,5}(?:\/[A-Z0-9²³]{1,5})?|%';
    $reCompleta = '/^(\d{3,8})\s+(.+?)\s+(' . $un . ')\s+(?:(?:CR|AS|C)\s+)?(' . $preco . ')(?:\s+[\d.,%\-]+)*\s*$/u';
    $reCodigo = '/^(\d{3,8})\s+(\S.*)$/u';
    $reCauda = '/(?:^|\s)(' . $un . ')\s+(?:(?:CR|AS|C)\s+)?(' . $preco . ')(?:\s+[\d.,%\-]+)*\s*$/u';
    $lixo = '/^(POWERED|PAGINA|P[ÁA]GINA|SINAPI|CAIXA|REFER[ÊE]NCIA|C[ÓO]DIGO|DESCRI|UNIDADE|ORIGEM|PRE[ÇC]O|MEDIANO|DATA|UF\b|LOCAL|TABELA|RELAT[ÓO]RIO|INSUMOS?\b|COMPOSI|CUSTO|M[ÊE]S|COLETA|FONTE|\d+\s*(\/|DE)\s*\d+$)/iu';
    $itens = []; $descartadas = 0;
    $fecha = function ($cod, $desc, $un_, $pr) use (&$itens) {
        $p = sinapi_preco($pr);
        if ($p === null) { return false; }
        $itens[] = ['codigo' => $cod, 'descricao' => mb_substr(trim(preg_replace('/\s+/u', ' ', $desc)), 0, 500), 'unidade' => mb_substr($un_, 0, 14), 'classe' => '', 'preco' => $p];
        return count($itens) - 1;
    };
    // 1) divide em blocos (linhas em branco separam as linhas da tabela; a descrição quebrada fica toda no mesmo bloco)
    $blocos = []; $atual = [];
    foreach (preg_split('/\R/u', (string)$texto) as $linha) {
        $l = trim(preg_replace('/\s+/u', ' ', $linha));
        if ($l === '') { if ($atual) { $blocos[] = $atual; $atual = []; } continue; }
        if (preg_match($lixo, $l) && !preg_match('/^\d{3,8}\s/', $l)) { continue; }   // cabeçalho/rodapé
        $atual[] = $l;
    }
    if ($atual) { $blocos[] = $atual; }
    // 2) lê cada bloco
    $ultimo = null;
    foreach ($blocos as $bl) {
        $cods = [];
        foreach ($bl as $i => $l) { if (preg_match('/^\d{3,8}(\s|$)/', $l)) { $cods[] = $i; } }
        if (count($cods) === 1) {
            // uma linha da tabela (talvez com a descrição quebrada em cima e embaixo do código): junta tudo e acha unidade + preço no fim de alguma das linhas
            $i = $cods[0];
            preg_match('/^(\d{3,8})\s*(.*)$/u', $bl[$i], $m);
            $cod = $m[1]; $bl[$i] = $m[2];
            $un_ = null; $pr = null;
            foreach (array_merge([$i], array_keys($bl)) as $j) {
                if (isset($bl[$j]) && preg_match($reCauda, $bl[$j], $mc)) { $un_ = $mc[1]; $pr = $mc[2]; $bl[$j] = trim(substr($bl[$j], 0, strlen($bl[$j]) - strlen($mc[0]))); break; }
            }
            if ($un_ === null) { $descartadas++; $ultimo = null; continue; }
            $k = $fecha($cod, implode(' ', array_filter($bl, 'strlen')), $un_, $pr); $ultimo = $k === false ? null : $k;
            continue;
        }
        if (!$cods) {   // texto solto: continuação da descrição do item anterior (quebra de página)
            $txt = implode(' ', $bl);
            if ($ultimo !== null && !preg_match('/\d,\d{2}/', $txt) && mb_strlen($txt) <= 110) { $itens[$ultimo]['descricao'] = mb_substr($itens[$ultimo]['descricao'] . ' ' . $txt, 0, 500); }
            continue;
        }
        // várias linhas da tabela coladas (sem espaço entre elas): linha a linha
        $pend = null; $ultimo = null;
        foreach ($bl as $l) {
            if (preg_match($reCompleta, $l, $m)) {
                if ($pend) { $descartadas++; $pend = null; }
                $k = $fecha($m[1], $m[2], $m[3], $m[4]); $ultimo = $k === false ? null : $k; continue;
            }
            if (preg_match($reCodigo, $l, $m) && preg_match('/[A-Za-zÀ-ú]{3,}/u', $m[2])) {
                if ($pend) { $descartadas++; }
                $pend = ['cod' => $m[1], 'desc' => $m[2]]; $ultimo = null; continue;
            }
            if ($pend) {
                if (preg_match($reCauda, $l, $m)) {
                    $resto = trim(substr($l, 0, strlen($l) - strlen($m[0])));
                    $k = $fecha($pend['cod'], $pend['desc'] . ' ' . $resto, $m[1], $m[2]); $ultimo = $k === false ? null : $k; $pend = null;
                } else { $pend['desc'] .= ' ' . $l; }
                continue;
            }
            if ($ultimo !== null && !preg_match('/\d,\d{2}/', $l) && mb_strlen($l) <= 110) { $itens[$ultimo]['descricao'] = mb_substr($itens[$ultimo]['descricao'] . ' ' . $l, 0, 500); }
        }
        if ($pend) { $descartadas++; }
    }
    return ['itens' => $itens, 'descartadas' => $descartadas];
}

/** Espalha o arquivo enviado em uma lista de arquivos para ler: .xlsx, .pdf e, dentro de .zip, o que houver (até 2 níveis). Devolve [lista, pasta temporária]. */
function sinapi_expandir($caminho, $nome, $pasta, $nivel = 0, array &$avisos = [])
{
    $ext = strtolower(pathinfo($nome, PATHINFO_EXTENSION));
    $lista = [];
    if ($ext === 'pdf') { return [['caminho' => $caminho, 'nome' => $nome, 'tipo' => 'pdf']]; }
    if (!class_exists('ZipArchive')) { throw new RuntimeException('O servidor não tem a extensão ZIP do PHP.'); }
    $zip = new ZipArchive();
    if ($zip->open($caminho) !== true) {
        if ($nivel > 0) { $avisos[] = '"' . $nome . '" dentro do ZIP está corrompido ou não é um arquivo válido: ignorado.'; return []; }
        throw new InvalidArgumentException('Não consegui abrir "' . $nome . '": o arquivo está corrompido ou não é ZIP/XLSX/PDF.');
    }
    if ($zip->locateName('xl/workbook.xml') !== false) { $zip->close(); return [['caminho' => $caminho, 'nome' => $nome, 'tipo' => 'xlsx']]; }   // .xlsx também é um ZIP
    if ($nivel >= 2) { $zip->close(); return []; }
    $total = 0;
    for ($i = 0; $i < $zip->numFiles; $i++) {
        $st = $zip->statIndex($i);
        $en = (string)$st['name'];
        if (substr($en, -1) === '/' || strpos($en, '__MACOSX') !== false) { continue; }
        $e = strtolower(pathinfo($en, PATHINFO_EXTENSION));
        if (!in_array($e, ['xlsx', 'pdf', 'zip'], true)) { continue; }
        if ($st['size'] > 400 * 1024 * 1024 || ($total += $st['size']) > 900 * 1024 * 1024) { throw new InvalidArgumentException('O ZIP é grande demais para importar de uma vez (limite 900 MB descompactado): envie por partes.'); }
        $dest = $pasta . '/' . bin2hex(random_bytes(6)) . '.' . $e;   // nome aleatório: nunca usa o caminho que veio dentro do ZIP
        $in = $zip->getStream($en);
        if (!$in) { continue; }
        $out = fopen($dest, 'wb'); stream_copy_to_stream($in, $out); fclose($out); fclose($in);
        foreach (sinapi_expandir($dest, basename($en), $pasta, $nivel + 1, $avisos) as $x) { $lista[] = $x; }
    }
    $zip->close();
    return $lista;
}

function sinapi_remover_pasta($pasta)
{
    foreach (glob($pasta . '/*') ?: [] as $f) { @unlink($f); }
    @rmdir($pasta);
}

/**
 * Importa o arquivo da Caixa (.xlsx, .zip com xlsx/pdf, ou .pdf) para um estado. Planilha: vários regimes de uma vez (abas ISD/ICD/ISE e CSD/CCD/CSE).
 * PDF: um relatório por estado; regime e tipo (insumo/composição) vêm do nome do arquivo ou do cabeçalho; sem isso vale o regime marcado (se for só um).
 * Devolve linhas de resumo (texto).
 */
function sinapi_importar($caminho, $nomeArquivo, $ref, $uf, array $regimes, array $u)
{
    garantir_sinapi();
    if (!preg_match('/^\d{4}-\d{2}$/', $ref)) { throw new InvalidArgumentException('Informe o mês de referência (AAAA-MM).'); }
    if (!in_array($uf, sinapi_ufs(), true)) { throw new InvalidArgumentException('Estado inválido.'); }
    $regimes = array_values(array_intersect($regimes, array_keys(sinapi_regimes())));
    if (!$regimes) { throw new InvalidArgumentException('Escolha ao menos um regime (sem desoneração, com desoneração ou sem encargos).'); }
    @set_time_limit(900);
    @ini_set('memory_limit', '768M');
    require_once __DIR__ . '/pdf_texto.php';
    $pasta = sys_get_temp_dir() . '/sinapi_' . bin2hex(random_bytes(6));
    if (!@mkdir($pasta, 0700)) { throw new RuntimeException('Não consegui criar a pasta temporária do servidor para ler o arquivo.'); }
    $resumo = []; $acc = []; $aviso = [];
    try {
        $arquivos = sinapi_expandir($caminho, $nomeArquivo, $pasta, 0, $aviso);
        if (!$arquivos) { throw new InvalidArgumentException('Não achei planilha (.xlsx) nem PDF dentro do arquivo enviado.'); }
        $semDados = 0;
        foreach ($arquivos as $arq) {
            if ($arq['tipo'] === 'xlsx') {
                $achou = false;
                foreach ($regimes as $rg) {
                    foreach (['I' => 'I' . $rg, 'C' => 'C' . $rg] as $tipo => $nomeAba) {
                        try { $folhas = xlsx_ler($arq['caminho'], 40000, 120, [$nomeAba]); }
                        catch (RuntimeException $e) { $aviso[] = '"' . $arq['nome'] . '": ' . $e->getMessage(); break 2; }
                        if (!$folhas) { continue; }
                        try { $itens = sinapi_extrair_aba($folhas[0]['linhas'], $uf); }
                        catch (RuntimeException $e) { $aviso[] = $arq['nome'] . ' › aba ' . $nomeAba . ': ' . $e->getMessage() . '.'; continue; }
                        $achou = true;
                        foreach ($itens as $it) { $acc[$rg][$tipo][] = $it; }
                        unset($folhas, $itens);
                    }
                }
                if (!$achou) { $semDados++; $aviso[] = '"' . $arq['nome'] . '": sem as abas de insumos/composições (ISD, ICD, ISE, CSD, CCD, CSE): ignorado.'; }
            } else {
                $textos = pdf_textos($arq['caminho']);
                if (!$textos) { $aviso[] = '"' . $arq['nome'] . '": o PDF não tem texto selecionável (é imagem/escaneado). Envie o PDF original da Caixa ou a planilha .xlsx.'; continue; }
                $texto = $textos[0]; $r = null;
                foreach ($textos as $tx) { $rr = sinapi_ler_texto_pdf($tx); if ($r === null || count($rr['itens']) > count($r['itens'])) { $r = $rr; $texto = $tx; } }
                $cab = mb_substr($texto, 0, 4000);
                $rg = sinapi_regime_do_texto($arq['nome']) ?: sinapi_regime_do_texto($cab);
                if ($rg === null) {
                    if (count($regimes) !== 1) { throw new InvalidArgumentException('Não consegui descobrir o regime (com ou sem desoneração) do PDF "' . $arq['nome'] . '". Marque apenas UM regime e envie de novo.'); }
                    $rg = $regimes[0];
                }
                $tipo = sinapi_tipo_do_texto($arq['nome']) ?: sinapi_tipo_do_texto($cab);
                if ($tipo === null) { $tipo = 'I'; $aviso[] = '"' . $arq['nome'] . '": não deu para saber se é de insumos ou de composições: tratei como INSUMOS.'; }
                if (preg_match('/\b(?:UF|ESTADO)\s*[:\-]?\s*([A-Z]{2})\b/', mb_strtoupper($cab), $mu) && in_array($mu[1], sinapi_ufs(), true) && $mu[1] !== $uf) {
                    throw new InvalidArgumentException('O PDF "' . $arq['nome'] . '" parece ser do estado ' . $mu[1] . ', mas você escolheu ' . $uf . '. Corrija o estado e envie de novo.');
                }
                if (!$r['itens']) { $aviso[] = '"' . $arq['nome'] . '": não reconheci linhas de itens (código, descrição, unidade e preço). Se o PDF está em outro formato, envie a planilha .xlsx.'; continue; }
                foreach ($r['itens'] as $it) { $acc[$rg][$tipo][] = $it; }
                $aviso[] = 'PDF "' . $arq['nome'] . '": ' . number_format(count($r['itens']), 0, ',', '.') . ' linhas lidas como ' . ($tipo === 'I' ? 'insumos' : 'composições') . ' (' . sinapi_regimes()[$rg] . ')' . ($r['descartadas'] ? '; ' . $r['descartadas'] . ' linha(s) sem preço ignorada(s)' : '') . '. Confira a quantidade e o preço de alguns itens.';
            }
        }
    } finally { sinapi_remover_pasta($pasta); }
    $ins = bd()->prepare('INSERT INTO sinapi_itens (ref, uf, regime, tipo, codigo, descricao, busca, unidade, classe, preco) VALUES (?,?,?,?,?,?,?,?,?,?)');
    foreach ($acc as $rg => $porTipo) {
        $qtd = ['I' => 0, 'C' => 0];
        foreach ($porTipo as $tipo => $itens) {
            $vistos = [];
            bd()->beginTransaction();
            try {
                q_global('DELETE FROM sinapi_itens WHERE ref = ? AND uf = ? AND regime = ? AND tipo = ?', [$ref, $uf, $rg, $tipo]);
                foreach ($itens as $it) {
                    if (isset($vistos[$it['codigo']])) { continue; }   // mesmo código lido duas vezes (ex.: planilha e PDF): vale o primeiro
                    $vistos[$it['codigo']] = true;
                    $ins->execute([$ref, $uf, $rg, $tipo, $it['codigo'], $it['descricao'], sinapi_norm($it['descricao']), $it['unidade'], $it['classe'], $it['preco']]);
                }
                bd()->commit();
            } catch (Throwable $e) { bd()->rollBack(); throw $e; }
            $qtd[$tipo] = count($vistos);
        }
        // a carga registra o total que ficou no banco (um PDF de insumos não apaga as composições já importadas)
        $tot = ['I' => 0, 'C' => 0];
        foreach (q_global('SELECT tipo, COUNT(*) FROM sinapi_itens WHERE ref = ? AND uf = ? AND regime = ? GROUP BY tipo', [$ref, $uf, $rg])->fetchAll(PDO::FETCH_NUM) as $row) { $tot[$row[0]] = (int)$row[1]; }
        q_global('DELETE FROM sinapi_cargas WHERE ref = ? AND uf = ? AND regime = ?', [$ref, $uf, $rg]);
        q_global('INSERT INTO sinapi_cargas (ref, uf, regime, insumos, composicoes, arquivo, por, em) VALUES (?,?,?,?,?,?,?,?)',
            [$ref, $uf, $rg, $tot['I'], $tot['C'], mb_substr($nomeArquivo, 0, 200), $u['login'] ?? '', agora()]);
        $resumo[] = sinapi_regimes()[$rg] . ': ' . number_format($qtd['I'], 0, ',', '.') . ' insumos e ' . number_format($qtd['C'], 0, ',', '.') . ' composições de ' . $uf . ' (' . substr($ref, 5) . '/' . substr($ref, 0, 4) . ') importados agora.';
    }
    if (!$acc) { throw new InvalidArgumentException('Nada foi importado. ' . implode(' ', $aviso)); }
    return array_merge($resumo, $aviso);
}

/** Grupos de busca para estrutura metálica: qualquer palavra do grupo basta (OR); o texto digitado restringe (E). */
function sinapi_grupos()
{
    return [
        'estrutura' => ['Estrutura metálica', ['ESTRUTURA METALICA', 'ESTRUTURAS METALICAS', 'ACO ESTRUTURAL', 'ACO ASTM', 'ASTM A36', 'ASTM A572', 'VIGA METALICA', 'PILAR METALICO', 'TRELICA', 'TERCA', 'CONTRAVENTAMENTO', 'LONGARINA', 'TIRANTE', 'FERRAGEM DE ESTRUTURA', 'TESOURA']],
        'perfis' => ['Aço, perfis e chapas', ['PERFIL', 'CANTONEIRA', 'CHAPA DE ACO', 'CHAPA GROSSA', 'CHAPA FINA', 'LAMINADO', 'BARRA CHATA', 'BARRA REDONDA', 'TUBO ACO', 'TUBO DE ACO', 'METALON', 'ACO CA', 'VIGA I', 'PERFIL I', 'PERFIL U', 'PERFIL W']],
        'telhas' => ['Telhas e cobertura', ['TELHA DE ACO', 'TELHA METALICA', 'TELHA TRAPEZOIDAL', 'TELHA TERMOACUSTICA', 'TELHA SANDUICHE', 'TELHA GALVANIZADA', 'TELHA ZINCADA', 'CALHA', 'RUFO', 'CUMEEIRA', 'LANTERNIM', 'FECHAMENTO LATERAL']],
        'fixacao' => ['Fixação e solda', ['PARAFUSO', 'CHUMBADOR', 'PARABOLT', 'PORCA', 'ARRUELA', 'BARRA ROSCADA', 'SOLDA', 'ELETRODO', 'ARAME DE SOLDA', 'REBITE', 'FIXACAO']],
        'pintura' => ['Pintura e proteção', ['JATEAMENTO', 'PINTURA', 'ANTICORROSIV', 'GALVANIZ', 'ZARCAO', 'PRIMER', 'FUNDO PARA ACO', 'FUNDO EPOXI', 'TINTA EPOXI', 'TINTA POLIURETANO', 'ESMALTE SINTETICO', 'ESMALTE PARA ACO']],
        'equip' => ['Equipamentos e içamento', ['GUINDASTE', 'GUINCHO', 'PLATAFORMA ELEVATORIA', 'PLATAFORMA DE TRABALHO', 'CAMINHAO MUNCK', 'MUNCK', 'MAQUINA DE SOLDA', 'GERADOR DE SOLDA', 'ANDAIME', 'CESTO AEREO', 'TRATOR DE LAMINA']],
    ];
}

/** Catálogo próprio de estrutura metálica: só descrição e unidade (sem preço). Serve de roteiro para montar o orçamento quando o SINAPI não traz o item. */
function sinapi_catalogo_proprio()
{
    $l = [
        ['Projeto executivo e detalhamento de estrutura metálica', 'kg', 'estrutura'], ['Fabricação de estrutura metálica em aço ASTM A572 Gr. 50 (perfis soldados)', 'kg', 'estrutura'],
        ['Fabricação de estrutura metálica em aço ASTM A36 (perfis laminados)', 'kg', 'estrutura'], ['Fornecimento e montagem de joist (treliça leve) de cobertura', 'kg', 'estrutura'],
        ['Fornecimento e montagem de vigas principais de cobertura', 'kg', 'estrutura'], ['Fornecimento e montagem de pilares metálicos', 'kg', 'estrutura'],
        ['Fornecimento e montagem de terças de cobertura (perfil U enrijecido)', 'kg', 'estrutura'], ['Fornecimento e montagem de terças e espaçadores de fechamento lateral', 'kg', 'estrutura'],
        ['Contraventamento em barra redonda / cantoneira, com esticadores', 'kg', 'estrutura'], ['Mão-francesa e travamentos de pilar', 'kg', 'estrutura'], ['Escada metálica marinheiro com guarda-corpo', 'kg', 'estrutura'],
        ['Passarela e plataforma metálica com piso de chapa xadrez / grating', 'm²', 'estrutura'], ['Marquise metálica', 'm²', 'estrutura'], ['Guarda-corpo e corrimão metálico', 'm', 'estrutura'],
        ['Linha de vida em cabo de aço', 'm', 'estrutura'], ['Chumbador químico / mecânico (parabolt) Ø1/2"', 'un', 'fixacao'], ['Chumbador de ancoragem CBB Ø1"', 'un', 'fixacao'],
        ['Parafuso estrutural ASTM A325 com porca e arruela', 'un', 'fixacao'], ['Parafuso estrutural ASTM A307 com porca e arruela', 'un', 'fixacao'], ['Parafuso autobrocante para fixação de telhas e terças', 'un', 'fixacao'],
        ['Grout de nivelamento de placa de base', 'm³', 'fixacao'], ['Solda de campo com inspeção por líquido penetrante / ultrassom', 'm', 'fixacao'],
        ['Jateamento abrasivo ao grau Sa 2½', 'm²', 'pintura'], ['Pintura epóxi + poliuretano (esquema anticorrosivo, 3 demãos)', 'm²', 'pintura'], ['Galvanização a fogo de perfis e peças', 'kg', 'pintura'], ['Retoque de pintura em campo', 'm²', 'pintura'],
        ['Telha trapezoidal de aço pré-pintada, instalação com acessórios', 'm²', 'telhas'], ['Telha termoacústica tipo sanduíche, instalação', 'm²', 'telhas'], ['Telha de fechamento lateral em aço pré-pintado', 'm²', 'telhas'],
        ['Isolamento acústico / manta sob telha (facefelt)', 'm²', 'telhas'], ['Calha de chapa galvanizada, fornecimento e instalação', 'm', 'telhas'], ['Rufos, cumeeira e arremates em chapa pré-pintada', 'm', 'telhas'], ['Testeira de marquise', 'm', 'telhas'],
        ['Locação de guindaste para içamento de estrutura', 'diária', 'equip'], ['Locação de plataforma elevatória (PTA)', 'diária', 'equip'], ['Caminhão munck para descarga e transporte interno', 'h', 'equip'],
        ['Transporte de estrutura metálica (frete rodoviário)', 'kg', 'equip'], ['Mobilização e desmobilização de equipe e equipamentos', 'vb', 'equip'], ['Canteiro de obras, alojamento e segurança do trabalho (SESMT)', 'vb', 'equip'],
    ];
    $out = [];
    foreach ($l as $i => $x) { $out[] = ['codigo' => sprintf('EM-%03d', $i + 1), 'descricao' => $x[0], 'unidade' => $x[1], 'grupo' => $x[2], 'preco' => null, 'origem' => 'propria', 'tipo' => 'P']; }
    return $out;
}

/** Referências já importadas: [['ref','uf','regime','insumos','composicoes','em'], ...] da mais nova para a mais antiga. */
function sinapi_cargas()
{
    garantir_sinapi();
    return q_global('SELECT ref, uf, regime, insumos, composicoes, arquivo, por, em FROM sinapi_cargas ORDER BY ref DESC, uf, regime')->fetchAll();
}

/**
 * Pesquisa. $f: q (texto: todas as palavras), grupo (chave de sinapi_grupos), tipo (I, C, P = catálogo próprio, '' = todos), uf, regime, ref ('' = mais recente).
 * Devolve ['itens' => [...até 80], 'total' => n, 'ref' => 'AAAA-MM', 'tem_tabela' => bool].
 */
function sinapi_buscar(array $f)
{
    garantir_sinapi();
    $q = sinapi_norm($f['q'] ?? '');
    $grupo = (string)($f['grupo'] ?? '');
    $tipo = in_array($f['tipo'] ?? '', ['I', 'C', 'P'], true) ? $f['tipo'] : '';
    $uf = in_array($f['uf'] ?? '', sinapi_ufs(), true) ? $f['uf'] : '';
    $rg = isset(sinapi_regimes()[$f['regime'] ?? '']) ? $f['regime'] : 'SD';
    $grupos = sinapi_grupos();
    $palavras = array_values(array_filter(explode(' ', $q), function ($p) { return $p !== ''; }));
    $itens = [];
    $total = 0;
    $ref = preg_match('/^\d{4}-\d{2}$/', (string)($f['ref'] ?? '')) ? $f['ref'] : '';
    $tem = false;
    if ($tipo !== 'P') {
        if ($uf === '') {   // sem estado escolhido: o primeiro que tenha carga
            $c = q_global('SELECT uf FROM sinapi_cargas ORDER BY ref DESC, em DESC LIMIT 1')->fetchColumn();
            $uf = $c ?: '';
        }
        if ($uf !== '') {
            if ($ref === '') { $ref = (string)q_global('SELECT MAX(ref) FROM sinapi_cargas WHERE uf = ? AND regime = ?', [$uf, $rg])->fetchColumn(); }
            $tem = $ref !== '';
        }
        if ($tem) {
            $w = ['ref = ?', 'uf = ?', 'regime = ?']; $p = [$ref, $uf, $rg];
            if ($tipo !== '') { $w[] = 'tipo = ?'; $p[] = $tipo; }
            if (preg_match('/^\d{3,}$/', $q)) { $w[] = 'codigo LIKE ?'; $p[] = $q . '%'; }
            else {
                foreach ($palavras as $pl) { $w[] = 'busca LIKE ?'; $p[] = '%' . str_replace(['%', '_'], '', $pl) . '%'; }
            }
            if (isset($grupos[$grupo])) {
                $or = [];
                foreach ($grupos[$grupo][1] as $k) { $or[] = 'busca LIKE ?'; $p[] = '%' . $k . '%'; }
                $w[] = '(' . implode(' OR ', $or) . ')';
            }
            $where = implode(' AND ', $w);
            $total = (int)q_global("SELECT COUNT(*) FROM sinapi_itens WHERE $where", $p)->fetchColumn();
            foreach (q_global("SELECT tipo, codigo, descricao, unidade, preco, classe FROM sinapi_itens WHERE $where ORDER BY descricao LIMIT 80", $p)->fetchAll() as $r) {
                $itens[] = ['codigo' => $r['codigo'], 'descricao' => $r['descricao'], 'unidade' => $r['unidade'], 'preco' => (float)$r['preco'], 'origem' => 'sinapi', 'tipo' => $r['tipo'], 'classe' => $r['classe']];
            }
        }
    }
    if ($tipo === '' || $tipo === 'P') {   // catálogo próprio entra depois, sempre sem preço
        foreach (sinapi_catalogo_proprio() as $c) {
            if (isset($grupos[$grupo]) && $c['grupo'] !== $grupo) { continue; }
            $n = sinapi_norm($c['descricao'] . ' ' . $c['codigo']);
            $ok = true;
            foreach ($palavras as $pl) { if (strpos($n, $pl) === false) { $ok = false; break; } }
            if ($ok) { $itens[] = $c; $total++; }
        }
    }
    return ['itens' => array_slice($itens, 0, 120), 'total' => $total, 'ref' => $ref, 'uf' => $uf, 'regime' => $rg, 'tem_tabela' => $tem];
}
