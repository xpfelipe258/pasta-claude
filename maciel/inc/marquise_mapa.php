<?php
// Vigas de marquise por eixo/pilar do IFC. As demais etapas mantêm seu mapa.
function marquise_mapa_etapas(array $dados)
{
    if (empty($dados['frentes']['marquise'])) return $dados;
    $marquise = $dados['frentes']['marquise'];
    $etapas = array_values(array_filter($marquise['etapas'] ?? [], function ($etapa) {
        $nome = mb_strtoupper(str_replace(['É', 'é', '–', '-'], ['E', 'E', ' ', ' '], $etapa));
        return !(strpos($nome, 'MONT') !== false && strpos($nome, 'TER') !== false && preg_match('/PR[EÉ]/u', $nome));
    }));
    $marquise['etapas'] = $etapas;
    $mapa = json_decode((string)sistema_ler('marquise_ifc', 'null'), true);
    if (!is_array($mapa) && sistema_ler('dados_legados', '0') === '1') {
        $arquivo = __DIR__ . '/marquise_ifc.json';
        if (is_file($arquivo)) $mapa = json_decode(file_get_contents($arquivo), true);
    }
    if (is_array($mapa) && !empty($mapa['partes'])) {
        foreach ($etapas as $etapa) {
            if (mb_strpos(mb_strtoupper($etapa), 'VIGAS') === false) continue;
            $marquise['por_etapa'][$etapa] = [
                'titulo' => 'Vigas da marquise por eixo dos pilares',
                'servico' => $etapa, 'etapas' => $etapas, 'por_eixo' => true,
                'partes' => $mapa['partes'], 'total' => (int)$mapa['total'],
                'familias' => ['VIGA MARQUISE'], 'fonte' => $mapa['fonte']
            ];
        }
    }
    $dados['frentes']['marquise'] = $marquise;
    return $dados;
}

function marquise_etapa_premontagem($etapa)
{
    $nome = mb_strtoupper(str_replace(['É', 'é', '–', '-'], ['E', 'E', ' ', ' '], (string)$etapa));
    return strpos($nome, 'MARQUISE') !== false && strpos($nome, 'TER') !== false
        && strpos($nome, 'MONT') !== false && preg_match('/PR[EÉ]/u', $nome);
}
