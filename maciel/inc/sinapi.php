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

/** Importa a planilha oficial para um estado e vários regimes. Devolve linhas de resumo (texto). */
function sinapi_importar($caminho, $nomeArquivo, $ref, $uf, array $regimes, array $u)
{
    garantir_sinapi();
    if (!preg_match('/^\d{4}-\d{2}$/', $ref)) { throw new InvalidArgumentException('Informe o mês de referência (AAAA-MM).'); }
    if (!in_array($uf, sinapi_ufs(), true)) { throw new InvalidArgumentException('Estado inválido.'); }
    $regimes = array_values(array_intersect($regimes, array_keys(sinapi_regimes())));
    if (!$regimes) { throw new InvalidArgumentException('Escolha ao menos um regime (sem desoneração, com desoneração ou sem encargos).'); }
    @set_time_limit(600);
    @ini_set('memory_limit', '512M');
    $resumo = [];
    $ins = bd()->prepare('INSERT INTO sinapi_itens (ref, uf, regime, tipo, codigo, descricao, busca, unidade, classe, preco) VALUES (?,?,?,?,?,?,?,?,?,?)');
    foreach ($regimes as $rg) {
        $abas = ['I' => 'I' . $rg, 'C' => 'C' . $rg];   // ISD/ICD/ISE = insumos; CSD/CCD/CSE = composições
        $qtd = ['I' => 0, 'C' => 0];
        foreach ($abas as $tipo => $nomeAba) {
            $folhas = xlsx_ler($caminho, 40000, 120, [$nomeAba]);
            if (!$folhas) { $resumo[] = "Aba $nomeAba não encontrada: ignorada."; continue; }
            try { $itens = sinapi_extrair_aba($folhas[0]['linhas'], $uf); }
            catch (RuntimeException $e) { $resumo[] = "Aba $nomeAba: " . $e->getMessage() . '.'; continue; }
            bd()->beginTransaction();
            try {
                q_global('DELETE FROM sinapi_itens WHERE ref = ? AND uf = ? AND regime = ? AND tipo = ?', [$ref, $uf, $rg, $tipo]);
                foreach ($itens as $it) {
                    $ins->execute([$ref, $uf, $rg, $tipo, $it['codigo'], $it['descricao'], sinapi_norm($it['descricao']), $it['unidade'], $it['classe'], $it['preco']]);
                }
                bd()->commit();
            } catch (Throwable $e) { bd()->rollBack(); throw $e; }
            $qtd[$tipo] = count($itens);
            unset($folhas, $itens);
        }
        if ($qtd['I'] + $qtd['C'] > 0) {
            q_global('DELETE FROM sinapi_cargas WHERE ref = ? AND uf = ? AND regime = ?', [$ref, $uf, $rg]);
            q_global('INSERT INTO sinapi_cargas (ref, uf, regime, insumos, composicoes, arquivo, por, em) VALUES (?,?,?,?,?,?,?,?)',
                [$ref, $uf, $rg, $qtd['I'], $qtd['C'], mb_substr($nomeArquivo, 0, 200), $u['login'] ?? '', agora()]);
        }
        $resumo[] = sinapi_regimes()[$rg] . ': ' . number_format($qtd['I'], 0, ',', '.') . ' insumos e ' . number_format($qtd['C'], 0, ',', '.') . ' composições de ' . $uf . ' (' . substr($ref, 5) . '/' . substr($ref, 0, 4) . ').';
    }
    return $resumo;
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
