<?php
// PDF do orçamento: tipo=proposta (documento para o cliente: só preço de venda) ou tipo=orcamento (planilha interna com custo, BDI, desconto e margem).
// Gerado no servidor (TCPDF), com texto selecionável, logo e dados da empresa cliente (Central › Configurações).
require __DIR__ . '/inc/nucleo.php';
require __DIR__ . '/inc/modelo.php';
require __DIR__ . '/inc/central.php';
require_once __DIR__ . '/tcpdf/tcpdf.php';

$eu = central_exigir();
$tipo = ($_GET['tipo'] ?? 'proposta') === 'orcamento' ? 'orcamento' : 'proposta';
$o = com_obter((int)($_GET['id'] ?? 0), $eu);
if (!$o) { http_response_code(404); exit('Orçamento não encontrado.'); }
if ($tipo === 'proposta' && $o['status'] === 'perdida') { /* permitido: apenas gera o documento */ }
$c = com_calcular($o, com_itens($o['id']));
if (!$c['itens']) { http_response_code(400); exit('O orçamento não tem itens. Volte e adicione itens antes de gerar o PDF.'); }

$orgId = com_org($eu) ?: (int)$o['organizacao_id'];
$org = $orgId ? organizacao_ler($orgId) : null;
$empresa = $org ? $org['nome'] : global_ler('nome_sistema', 'Núcleo de Obras');
$perfil = $org ? cfg_perfil_ler((int)$org['id']) : null;
$ident = $org ? cfg_identidade_ler((int)$org['id']) : ['logo' => '', 'cor' => ''];
$cor = cor_segura($ident['cor'] ?: global_ler('cor_primaria', '#d97706'), '#d97706');
$rgb = [hexdec(substr($cor, 1, 2)), hexdec(substr($cor, 3, 2)), hexdec(substr($cor, 5, 2))];
$logoBin = '';
if (!empty($ident['logo']) && preg_match('#^data:image/(?:png|jpeg|webp);base64,(.+)$#', $ident['logo'], $m)) { $logoBin = base64_decode($m[1], true) ?: ''; }
$valida = date('d/m/Y', strtotime(($o['data_ref'] ?: date('Y-m-d')) . ' +' . (int)$o['validade_dias'] . ' days'));
$rodape = $perfil && trim($perfil['rodape']) !== '' ? $perfil['rodape'] : $empresa;
$titDoc = $tipo === 'proposta' ? 'PROPOSTA COMERCIAL' : 'ORÇAMENTO — USO INTERNO';

class PdfOrcamento extends TCPDF
{
    public $rodapeTxt = '';
    public $rotuloDoc = '';
    public function Header() {}
    public function Footer()
    {
        $this->SetY(-14);
        $this->SetFont('helvetica', '', 7);
        $this->SetTextColor(110, 120, 135);
        $this->Cell(0, 4, mb_substr(str_replace(["\r", "\n"], ' ', $this->rodapeTxt), 0, 150), 0, 1, 'C');
        $this->Cell(0, 4, $this->rotuloDoc . '  |  Página ' . $this->getAliasNumPage() . ' de ' . $this->getAliasNbPages(), 0, 0, 'C');
    }
}

$pdf = new PdfOrcamento('P', 'mm', 'A4', true, 'UTF-8', false);
$pdf->rodapeTxt = $rodape;
$pdf->rotuloDoc = $o['numero'] . ' · ' . ($tipo === 'proposta' ? 'Proposta comercial' : 'Orçamento interno');
$pdf->SetCreator('Gestão de Obras');
$pdf->SetAuthor($empresa);
$pdf->SetTitle(($tipo === 'proposta' ? 'Proposta ' : 'Orçamento ') . $o['numero']);
$pdf->SetMargins(14, 14, 14);
$pdf->SetAutoPageBreak(true, 20);
$pdf->AddPage();

// ---- cabeçalho: logo + empresa | título do documento
$y0 = 14;
if ($logoBin !== '') { try { $pdf->Image('@' . $logoBin, 14, $y0, 0, 14, '', '', '', false, 300); } catch (Throwable $e) { $logoBin = ''; } }
$xTxt = $logoBin !== '' ? 66 : 14; $wTxt = 196 - $xTxt; $alin = $logoBin !== '' ? 'R' : 'L';
$pdf->SetXY($xTxt, $y0);
$pdf->SetFont('helvetica', 'B', 13); $pdf->SetTextColor(16, 24, 40);
$pdf->MultiCell($wTxt, 6, $empresa, 0, $alin, false, 1);
$linha = array_filter([$org && $org['documento'] ? 'CNPJ ' . $org['documento'] : '', $perfil ? $perfil['cidade'] : '', $org ? $org['telefone'] : '', $org ? $org['email'] : '', $perfil ? $perfil['site'] : '']);
if ($linha) { $pdf->SetFont('helvetica', '', 8); $pdf->SetTextColor(100, 110, 125); $pdf->SetX($xTxt); $pdf->MultiCell($wTxt, 4, implode('  ·  ', $linha), 0, $alin, false, 1); }
$pdf->SetY(max($pdf->GetY() + 2, $y0 + 18));
$pdf->SetDrawColor($rgb[0], $rgb[1], $rgb[2]); $pdf->SetLineWidth(0.9); $pdf->Line(14, $pdf->GetY(), 196, $pdf->GetY()); $pdf->Ln(4);
$pdf->SetFont('helvetica', 'B', 8); $pdf->SetTextColor($rgb[0], $rgb[1], $rgb[2]); $pdf->Cell(0, 4, $titDoc, 0, 1);
$pdf->SetFont('helvetica', 'B', 16); $pdf->SetTextColor(16, 24, 40); $pdf->MultiCell(0, 7, $o['titulo'], 0, 'L', false, 1);
$pdf->SetFont('helvetica', '', 8.5); $pdf->SetTextColor(100, 110, 125); $pdf->Cell(0, 5, $o['numero'] . '  ·  ' . central_dt($o['data_ref']), 0, 1);
$pdf->Ln(2);

$e = function ($t) { return htmlspecialchars((string)$t, ENT_QUOTES, 'UTF-8'); };
$brl = function ($v) { return 'R$ ' . number_format((float)$v, 2, ',', '.'); };
$qtdf = function ($v) { return rtrim(rtrim(number_format((float)$v, 4, ',', '.'), '0'), ','); };
$corHex = $cor;

// ---- dados do cliente
$dados = [['Cliente', $o['cliente']], ['Contato', trim($o['contato'] . ($o['telefone'] ? ' · ' . $o['telefone'] : '')) ?: '—'], ['Local da obra', $o['local_obra'] ?: '—'], ['E-mail', $o['email'] ?: '—'],
    ['Validade', $valida . ' (' . (int)$o['validade_dias'] . ' dias)'], ['Prazo de execução', $o['prazo_dias'] ? (int)$o['prazo_dias'] . ' dias' : 'a combinar']];
$h = '<table cellpadding="3" cellspacing="0" style="font-size:8.5pt">';
for ($i = 0; $i < count($dados); $i += 2) {
    $h .= '<tr><td width="50%"><span style="color:#667085;font-size:7pt">' . $e(mb_strtoupper($dados[$i][0], 'UTF-8')) . '</span><br><b>' . $e($dados[$i][1]) . '</b></td><td width="50%"><span style="color:#667085;font-size:7pt">' . $e(mb_strtoupper($dados[$i + 1][0], 'UTF-8')) . '</span><br><b>' . $e($dados[$i + 1][1]) . '</b></td></tr>';
}
$h .= '</table>';
$pdf->SetTextColor(16, 24, 40);
$pdf->writeHTML($h, true, false, true, false, '');

$secao = function ($titulo) use ($pdf, $corHex) {
    $pdf->writeHTML('<br><span style="font-size:10pt;font-weight:bold;color:' . $corHex . '">' . htmlspecialchars(mb_strtoupper($titulo, 'UTF-8'), ENT_QUOTES, 'UTF-8') . '</span><hr style="color:#d0d5dd">', true, false, true, false, '');
};

$etapas = [];
foreach ($c['itens'] as $it) { $et = trim((string)$it['etapa']) !== '' ? trim($it['etapa']) : 'Itens'; $etapas[$et][] = $it; }
$varias = count($etapas) > 1 || !isset($etapas['Itens']);

if ($tipo === 'proposta') {
    if (trim((string)$o['escopo']) !== '') { $secao('Escopo do fornecimento'); $pdf->SetFont('helvetica', '', 9); $pdf->writeHTML('<div style="font-size:9pt;color:#344054">' . nl2br($e($o['escopo'])) . '</div>', true, false, true, false, ''); }
    $secao('Preços');
    $t = '<table cellpadding="4" cellspacing="0" border="0" style="font-size:8pt"><tr style="background-color:#f2f4f7;color:#475467;font-weight:bold"><td width="11%">Código</td><td width="38%">Descrição</td><td width="6%">Un</td><td width="12%" align="right">Quantidade</td><td width="16%" align="right">Preço unit. (R$)</td><td width="17%" align="right">Total (R$)</td></tr>';
    foreach ($etapas as $nome => $lista) {
        $sub = 0;
        if ($varias) { $t .= '<tr style="background-color:#fafafa"><td colspan="6"><b>' . $e($nome) . '</b></td></tr>'; }
        foreach ($lista as $it) {
            $sub += $it['venda'];
            $t .= '<tr><td style="border-bottom:0.3px solid #eaecf0">' . $e($it['codigo']) . '</td><td style="border-bottom:0.3px solid #eaecf0">' . $e($it['descricao']) . '</td><td style="border-bottom:0.3px solid #eaecf0">' . $e($it['unidade']) . '</td><td align="right" style="border-bottom:0.3px solid #eaecf0">' . $e($qtdf($it['quantidade'])) . '</td><td align="right" style="border-bottom:0.3px solid #eaecf0">' . $e(number_format($it['preco_unit'], 2, ',', '.')) . '</td><td align="right" style="border-bottom:0.3px solid #eaecf0">' . $e(number_format($it['venda'], 2, ',', '.')) . '</td></tr>';
        }
        if ($varias) { $t .= '<tr><td colspan="5" align="right"><b>Subtotal - ' . $e($nome) . '</b></td><td align="right"><b>' . $e(number_format($sub, 2, ',', '.')) . '</b></td></tr>'; }
    }
    $t .= '</table>';
    $pdf->SetFont('helvetica', '', 8);
    $pdf->writeHTML($t, true, false, true, false, '');
    $pdf->Ln(2);
    $pdf->SetFillColor($rgb[0], $rgb[1], $rgb[2]); $pdf->SetTextColor(255, 255, 255);
    $pdf->SetFont('helvetica', 'B', 8); $pdf->SetX(120); $pdf->Cell(76, 5, 'VALOR TOTAL DA PROPOSTA', 0, 1, 'R', true);
    $pdf->SetFont('helvetica', 'B', 15); $pdf->SetX(120); $pdf->Cell(76, 9, $brl($c['total']), 0, 1, 'R', true);
    $pdf->SetTextColor(16, 24, 40);
    foreach (['pagamento' => 'Condições de pagamento', 'exclusoes' => 'Itens não incluídos', 'observacoes' => 'Observações'] as $k => $tt) {
        if (trim((string)$o[$k]) === '') { continue; }
        $secao($tt); $pdf->writeHTML('<div style="font-size:9pt;color:#344054">' . nl2br($e($o[$k])) . '</div>', true, false, true, false, '');
    }
    // assinaturas (não corta em duas páginas)
    if ($pdf->GetY() > 235) { $pdf->AddPage(); }
    $pdf->SetY(max($pdf->GetY() + 22, 248));
    $pdf->SetDrawColor(16, 24, 40); $pdf->SetLineWidth(0.2);
    $pdf->Line(18, $pdf->GetY(), 92, $pdf->GetY()); $pdf->Line(118, $pdf->GetY(), 192, $pdf->GetY());
    $pdf->SetFont('helvetica', '', 8); $pdf->SetTextColor(71, 84, 103);
    $resp = $perfil && ($perfil['resp_tecnico'] || $perfil['crea']) ? "\n" . trim($perfil['resp_tecnico'] . ($perfil['crea'] ? ' · ' . $perfil['crea'] : ''), ' ·') : '';
    $pdf->SetXY(18, $pdf->GetY() + 1); $pdf->MultiCell(74, 4, $empresa . $resp, 0, 'C', false, 0);
    $pdf->SetX(118); $pdf->MultiCell(74, 4, $o['cliente'] . "\nde acordo", 0, 'C', false, 1);
} else {
    $secao('Planilha de custos e preço de venda');
    $t = '<table cellpadding="3" cellspacing="0" border="0" style="font-size:7pt"><tr style="background-color:#f2f4f7;color:#475467;font-weight:bold"><td width="9%">Código</td><td width="27%">Descrição</td><td width="5%">Un</td><td width="9%" align="right">Qtd</td><td width="11%" align="right">Custo unit.</td><td width="12%" align="right">Custo total</td><td width="11%" align="right">Preço unit.</td><td width="12%" align="right">Venda</td><td width="4%">Or.</td></tr>';
    foreach ($etapas as $nome => $lista) {
        $subD = 0; $subV = 0;
        if ($varias) { $t .= '<tr style="background-color:#fafafa"><td colspan="9"><b>' . $e($nome) . '</b></td></tr>'; }
        foreach ($lista as $it) {
            $subD += $it['direto']; $subV += $it['venda'];
            $b = 'style="border-bottom:0.3px solid #eaecf0"';
            $t .= '<tr><td ' . $b . '>' . $e($it['codigo']) . '</td><td ' . $b . '>' . $e($it['descricao']) . '</td><td ' . $b . '>' . $e($it['unidade']) . '</td><td align="right" ' . $b . '>' . $e($qtdf($it['quantidade'])) . '</td><td align="right" ' . $b . '>' . $e(number_format($it['custo_unit'], 2, ',', '.')) . '</td><td align="right" ' . $b . '>' . $e(number_format($it['direto'], 2, ',', '.')) . '</td><td align="right" ' . $b . '>' . $e(number_format($it['preco_unit'], 2, ',', '.')) . '</td><td align="right" ' . $b . '>' . $e(number_format($it['venda'], 2, ',', '.')) . '</td><td ' . $b . '>' . $e(['sinapi' => 'SIN', 'propria' => 'CAT'][$it['origem'] ?? ''] ?? 'MAN') . '</td></tr>';
        }
        if ($varias) { $t .= '<tr><td colspan="5" align="right"><b>Subtotal - ' . $e($nome) . '</b></td><td align="right"><b>' . $e(number_format($subD, 2, ',', '.')) . '</b></td><td></td><td align="right"><b>' . $e(number_format($subV, 2, ',', '.')) . '</b></td><td></td></tr>'; }
    }
    $t .= '</table><span style="font-size:6.5pt;color:#667085">Or. = origem do item: SIN = tabela SINAPI, CAT = catálogo próprio de estrutura metálica, MAN = digitado.</span>';
    $pdf->writeHTML($t, true, false, true, false, '');
    $secao('Resumo');
    $r = '<table cellpadding="4" cellspacing="0" style="font-size:9pt">';
    foreach ([['Custo direto', $brl($c['direto'])], ['BDI (' . rtrim(rtrim(number_format((float)$o['bdi_pct'], 2, ',', '.'), '0'), ',') . '%)', '+ ' . $brl($c['bdi_valor'])],
        ['Desconto comercial (' . rtrim(rtrim(number_format((float)$o['desconto_pct'], 2, ',', '.'), '0'), ',') . '%)', '- ' . $brl($c['desconto_valor'])], ['PREÇO DE VENDA', $brl($c['total'])],
        ['Margem bruta (venda - custo direto)', $brl($c['margem']) . ' · ' . number_format($c['margem_pct'], 1, ',', '.') . '%']] as $i => $l) {
        $neg = $i === 3 ? ' style="font-weight:bold;background-color:#f2f4f7"' : '';
        $r .= '<tr' . $neg . '><td width="60%" style="border-bottom:0.3px solid #eaecf0">' . $e($l[0]) . '</td><td width="40%" align="right" style="border-bottom:0.3px solid #eaecf0">' . $e($l[1]) . '</td></tr>';
    }
    $pdf->writeHTML($r . '</table>', true, false, true, false, '');
    $pdf->Ln(3); $pdf->SetFont('helvetica', 'I', 8); $pdf->SetTextColor(180, 35, 24);
    $pdf->MultiCell(0, 4, 'Documento de uso interno: contém custo, BDI e margem. Não envie ao cliente — para ele, gere a proposta comercial.', 0, 'L', false, 1);
}

$nome = preg_replace('/[^A-Za-z0-9._ -]+/', '', ($tipo === 'proposta' ? 'Proposta ' : 'Orcamento interno ') . $o['numero'] . ' - ' . $o['cliente']);
$pdf->Output(trim($nome) . '.pdf', 'D');
