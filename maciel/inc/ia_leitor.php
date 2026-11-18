<?php
// Leitor de orçamento / planilha de medição por INTELIGÊNCIA ARTIFICIAL (Claude, API da Anthropic).
// Usado pelo pop-up "Importar orçamento" da aba Medição (BM) quando o leitor padrão (leitura_orcamento,
// que só entende o memorial no formato item / descrição / QTD / UNIDADE / VALOR % / PESO) não reconhece
// o arquivo: cada obra pode mandar o BM num formato diferente (planilha livre, PDF, foto escaneada).
//
// Devolve o MESMO formato de leitura_orcamento(), para o resto do fluxo (prévia, catálogo, colunas de
// produção, cortes de BM) não mudar: ['itens' => [...], 'periodos' => [...], 'contrato_total' => x, 'avisos' => [...]].
//
// Chave: config.php → 'anthropic_api_key' (nunca vai para o Git). Sem a chave o leitor fica desligado.
// Chamada HTTP direta (cURL) e não o SDK PHP: o SDK exige o Composer com ~4.800 arquivos de dependências,
// inviável de publicar arquivo a arquivo nesta hospedagem; a chamada é a mesma do POST /v1/messages.

const IA_MODELO = 'claude-opus-5-5';
const IA_LIMITE_TEXTO = 600000;   // caracteres da planilha convertida em texto (~150 mil tokens)

function ia_chave()
{
    $c = config() ?: [];
    $k = trim((string)($c['anthropic_api_key'] ?? getenv('ANTHROPIC_API_KEY') ?: ''));
    return $k !== '' ? $k : null;
}

function ia_disponivel()
{
    return ia_chave() !== null && function_exists('curl_init');
}

/** Esquema da resposta (saída estruturada: o modelo é obrigado a devolver exatamente este JSON). */
function ia_esquema_orcamento()
{
    $num = ['type' => ['number', 'null']];
    return [
        'type' => 'object',
        'additionalProperties' => false,
        'required' => ['contrato_total', 'itens', 'periodos', 'avisos'],
        'properties' => [
            'contrato_total' => $num,
            'itens' => ['type' => 'array', 'items' => [
                'type' => 'object', 'additionalProperties' => false,
                'required' => ['codigo', 'descricao', 'valor', 'atividades'],
                'properties' => [
                    'codigo' => ['type' => 'string'],
                    'descricao' => ['type' => 'string'],
                    'valor' => $num,
                    'atividades' => ['type' => 'array', 'items' => [
                        'type' => 'object', 'additionalProperties' => false,
                        'required' => ['descricao', 'qtd', 'unidade', 'valor'],
                        'properties' => [
                            'descricao' => ['type' => 'string'],
                            'qtd' => $num,
                            'unidade' => ['type' => 'string'],
                            'valor' => $num,
                        ],
                    ]],
                ],
            ]],
            'periodos' => ['type' => 'array', 'items' => [
                'type' => 'object', 'additionalProperties' => false,
                'required' => ['bm', 'corte'],
                'properties' => ['bm' => ['type' => 'integer'], 'corte' => ['type' => 'string', 'format' => 'date']],
            ]],
            'avisos' => ['type' => 'array', 'items' => ['type' => 'string']],
        ],
    ];
}

function ia_instrucoes_orcamento()
{
    return "Você lê orçamentos e planilhas de medição (boletim de medição, BM) de obras de construção civil, principalmente estruturas metálicas.\n"
        . "Extraia o catálogo de medição do documento:\n"
        . "- ITENS: cada item/etapa do orçamento que agrupa serviços (ex.: \"3.1.1 Montagem de estrutura\"). 'codigo' = numeração do item como está no documento (ex.: \"3.1.1\"); se o documento não numerar, use 1, 2, 3… na ordem. Não inclua títulos que só agrupam outros itens (ex.: \"3\" ou \"3.1\" quando existem 3.1.1, 3.1.2).\n"
        . "- ATIVIDADES: as linhas mensuráveis de cada item (serviço com quantidade e unidade). Se o item não tiver subdivisão, repita o próprio item como única atividade.\n"
        . "- 'qtd' = quantidade CONTRATADA (não a medida em um BM). 'unidade' como no documento (un, m², m, kg, t, vb, %…).\n"
        . "- 'valor' = valor total em R$ (com centavos) da atividade e do item, para a empresa executora. Se só houver percentual do contrato, calcule percentual × valor total do contrato. Desconhecido = null. Nunca invente números.\n"
        . "- 'contrato_total' = valor total do contrato em R$, se o documento informar; senão null.\n"
        . "- 'periodos' = boletins de medição com data de corte (ex.: \"BM1 - 30/09/26\" → bm 1, corte 2026-09-30), se existirem; senão lista vazia.\n"
        . "- 'avisos' = frases curtas em português, para um engenheiro, sobre o que ficou incerto (valores somados que não fecham, linhas ilegíveis, colunas que você interpretou). Lista vazia se tudo estiver claro.\n"
        . "Números no documento estão em formato brasileiro (1.234,56). Devolva os números como número JSON (1234.56).";
}

/** Monta o conteúdo do pedido conforme o tipo do arquivo (planilha vira texto; PDF e imagem vão como estão). */
function ia_conteudo_documento($arquivo, $nome)
{
    $ext = strtolower(pathinfo((string)$nome, PATHINFO_EXTENSION));
    $tam = (int)@filesize($arquivo);
    if (in_array($ext, ['xlsx', 'xlsm'], true)) {
        $abas = xlsx_ler($arquivo, 6000, 60);
        $txt = '';
        foreach ($abas as $a) {
            $txt .= "\n### Aba: " . $a['nome'] . "\n";
            foreach ($a['linhas'] as $i => $l) {
                $cel = array_map(function ($c) { return str_replace(["\t", "\r", "\n"], ' ', (string)lt_texto($c)); }, (array)$l);
                while ($cel && end($cel) === '') { array_pop($cel); }
                if ($cel) { $txt .= ($i + 1) . "\t" . implode("\t", $cel) . "\n"; }
            }
        }
        if (mb_strlen($txt) > IA_LIMITE_TEXTO) {
            throw new InvalidArgumentException('A planilha é grande demais para a leitura por IA (' . number_format(mb_strlen($txt), 0, ',', '.') . ' caracteres). Apague as abas que não são do orçamento/medição e envie de novo.');
        }
        return [['type' => 'text', 'text' => "Planilha (colunas separadas por TAB; o primeiro número é a linha):\n" . $txt]];
    }
    if (in_array($ext, ['csv', 'txt'], true)) {
        $txt = (string)file_get_contents($arquivo);
        if (!mb_check_encoding($txt, 'UTF-8')) { $txt = mb_convert_encoding($txt, 'UTF-8', 'Windows-1252'); }
        if (mb_strlen($txt) > IA_LIMITE_TEXTO) { throw new InvalidArgumentException('O arquivo é grande demais para a leitura por IA.'); }
        return [['type' => 'text', 'text' => "Arquivo de texto:\n" . $txt]];
    }
    if ($ext === 'pdf') {
        if ($tam > 30 * 1024 * 1024) { throw new InvalidArgumentException('O PDF passa de 30 MB: envie só as páginas do orçamento/medição.'); }
        return [['type' => 'document', 'source' => ['type' => 'base64', 'media_type' => 'application/pdf', 'data' => base64_encode(file_get_contents($arquivo))]]];
    }
    $img = ['jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'png' => 'image/png', 'webp' => 'image/webp'];
    if (isset($img[$ext])) {
        if ($tam > 5 * 1024 * 1024) { throw new InvalidArgumentException('A imagem passa de 5 MB: reduza o tamanho e envie de novo.'); }
        return [['type' => 'image', 'source' => ['type' => 'base64', 'media_type' => $img[$ext], 'data' => base64_encode(file_get_contents($arquivo))]]];
    }
    throw new InvalidArgumentException('Formato não lido pela IA. Envie .xlsx, .xlsm, .csv, .pdf ou foto (.jpg/.png). Planilha .xls antiga: salve como .xlsx.');
}

/** Lê o documento com a IA e devolve no formato de leitura_orcamento(). */
function ia_ler_orcamento($arquivo, $nome)
{
    $chave = ia_chave();
    if (!$chave) {
        throw new InvalidArgumentException('A leitura por inteligência artificial não está ligada neste servidor (falta a chave da API em inc/config.php → anthropic_api_key).');
    }
    $conteudo = ia_conteudo_documento($arquivo, $nome);
    $conteudo[] = ['type' => 'text', 'text' => 'Extraia o catálogo de medição deste documento (arquivo: ' . basename((string)$nome) . ').'];
    $corpo = [
        'model' => IA_MODELO,
        'max_tokens' => 32000,
        'system' => ia_instrucoes_orcamento(),
        'messages' => [['role' => 'user', 'content' => $conteudo]],
        'output_config' => ['effort' => 'medium', 'format' => ['type' => 'json_schema', 'schema' => ia_esquema_orcamento()]],
        'fallbacks' => 'default',   // se o modelo recusar, a própria API tenta outro modelo na mesma chamada
    ];
    @set_time_limit(300);
    $ch = curl_init(rtrim(getenv('ANTHROPIC_BASE_URL') ?: 'https://api.anthropic.com', '/') . '/v1/messages');
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 280,
        CURLOPT_CONNECTTIMEOUT => 15,
        CURLOPT_HTTPHEADER => [
            'content-type: application/json',
            'x-api-key: ' . $chave,
            'anthropic-version: 2023-06-01',
            'anthropic-beta: server-side-fallback-2026-07-01',
        ],
        CURLOPT_POSTFIELDS => json_encode($corpo, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
    ]);
    $resp = curl_exec($ch);
    $cod = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    if ($resp === false) { throw new RuntimeException('Não consegui falar com o serviço de IA: ' . $err); }
    $j = json_decode((string)$resp, true);
    if ($cod !== 200) {
        $m = $j['error']['message'] ?? substr((string)$resp, 0, 200);
        if ($cod === 401) { $m = 'chave da API inválida'; }
        if ($cod === 429 || $cod === 529) { $m = 'serviço de IA ocupado; tente de novo em alguns minutos'; }
        throw new RuntimeException('A leitura por IA falhou (' . $cod . '): ' . $m);
    }
    if (($j['stop_reason'] ?? '') === 'refusal') { throw new RuntimeException('A IA não leu este documento. Confira se é um orçamento/medição.'); }
    if (($j['stop_reason'] ?? '') === 'max_tokens') { throw new RuntimeException('O documento tem itens demais para uma leitura só. Envie o orçamento em partes (por exemplo, uma aba por vez).'); }
    $txt = '';
    foreach ((array)($j['content'] ?? []) as $b) { if (($b['type'] ?? '') === 'text') { $txt .= $b['text']; } }
    $d = json_decode($txt, true);
    if (!is_array($d) || !isset($d['itens'])) { throw new RuntimeException('A IA devolveu uma resposta que não consegui entender. Tente de novo.'); }
    return ia_normalizar_orcamento($d);
}

/** Converte a resposta da IA no formato do leitor padrão (pesos = valor da atividade ÷ valor do item). */
function ia_normalizar_orcamento(array $d)
{
    $itens = [];
    $vistos = [];
    foreach ((array)$d['itens'] as $n => $it) {
        $cod = trim(preg_replace('/[^0-9A-Za-z.]/', '', (string)($it['codigo'] ?? ''))) ?: (string)($n + 1);
        while (isset($vistos[$cod])) { $cod .= 'b'; }
        $vistos[$cod] = true;
        $ativ = [];
        foreach ((array)($it['atividades'] ?? []) as $a) {
            $desc = trim((string)($a['descricao'] ?? ''));
            if ($desc === '') { continue; }
            $ativ[] = ['descricao' => mb_substr($desc, 0, 250), 'qtd' => (float)($a['qtd'] ?? 0), 'unidade' => mb_substr(trim((string)($a['unidade'] ?? '')) ?: 'un', 0, 12), 'valor' => round((float)($a['valor'] ?? 0), 2)];
        }
        $somaAt = array_sum(array_column($ativ, 'valor'));
        $valor = round((float)($it['valor'] ?? 0) ?: $somaAt, 2);
        foreach ($ativ as &$a) {
            $a['peso'] = $somaAt > 0 ? round($a['valor'] / $somaAt, 6) : (count($ativ) ? round(1 / count($ativ), 6) : 1.0);
        }
        unset($a);
        $desc = trim((string)($it['descricao'] ?? '')) ?: ('Item ' . $cod);
        $itens[] = ['codigo' => $cod, 'descricao' => mb_substr($desc, 0, 250), 'qtd' => null, 'unidade' => '', 'valor' => $valor, 'atividades' => $ativ];
    }
    $periodos = [];
    foreach ((array)($d['periodos'] ?? []) as $p) {
        if (preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)($p['corte'] ?? '')) && (int)($p['bm'] ?? 0) > 0) {
            $periodos[] = ['bm' => (int)$p['bm'], 'corte' => $p['corte']];
        }
    }
    $avisos = array_values(array_filter(array_map('strval', (array)($d['avisos'] ?? []))));
    array_unshift($avisos, 'Lido por inteligência artificial: confira quantidades e valores antes de gerar.');
    return ['itens' => $itens, 'periodos' => $periodos, 'contrato_total' => isset($d['contrato_total']) ? (float)$d['contrato_total'] : null, 'avisos' => $avisos, 'leitor' => 'ia'];
}
