<?php

declare(strict_types=1);

require __DIR__ . '/inc/nucleo.php';

$u    = exigir_login_pagina();
$obra = exigir_obra_pagina();

/* Impactos pertence à área de gestão/produção. Não exigimos o módulo financeiro. */
require_once __DIR__ . '/tcpdf/tcpdf.php';

if (!class_exists('TCPDF')) {
    http_response_code(500);
    exit('TCPDF não encontrado em /tcpdf/tcpdf.php.');
}

function imp_h($v): string
{
    return htmlspecialchars((string)$v, ENT_QUOTES, 'UTF-8');
}

function imp_data_br(string $data): string
{
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $data)) {
        return $data !== '' ? $data : '—';
    }
    $d = DateTime::createFromFormat('Y-m-d', $data);
    return $d ? $d->format('d/m/Y') : $data;
}

function imp_texto($v): string
{
    $v = trim((string)$v);
    return $v !== '' ? $v : '—';
}

$filtro = (string)($_POST['filtro'] ?? 'abertos');
if (!in_array($filtro, ['abertos', 'todos'], true)) {
    $filtro = 'abertos';
}

$referencia = trim((string)($_POST['referencia'] ?? ''));
if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $referencia)) {
    $referencia = date('Y-m-d');
}

$dadosJson = (string)($_POST['dados'] ?? '');
$impactos  = json_decode($dadosJson, true);

if (!is_array($impactos)) {
    http_response_code(400);
    exit('Dados do relatório inválidos.');
}

/* Segurança adicional: mesmo que alguém altere o POST manualmente,
   o filtro "Em aberto" nunca imprime linhas solucionadas. */
if ($filtro === 'abertos') {
    $impactos = array_values(array_filter($impactos, static function ($i): bool {
        return empty($i['solucionado']);
    }));
}

usort($impactos, static function ($a, $b): int {
    return strcmp((string)($b['data'] ?? ''), (string)($a['data'] ?? ''));
});

$obraNome = trim((string)($obra['nome'] ?? 'OBRA'));
$tituloFiltro = $filtro === 'todos' ? 'TODOS OS IMPACTOS' : 'IMPACTOS EM ABERTO';

$total       = count($impactos);
$abertos     = 0;
$solucionados = 0;
$maisAntigo  = '';
$maiorDias   = 0;

foreach ($impactos as $i) {
    $solucionado = trim((string)($i['solucionado'] ?? ''));
    if ($solucionado !== '') {
        $solucionados++;
    } else {
        $abertos++;
    }

    $data = trim((string)($i['data'] ?? ''));
    if ($data !== '' && ($maisAntigo === '' || $data < $maisAntigo)) {
        $maisAntigo = $data;
    }

    $dias = isset($i['dias_aberto']) && is_numeric($i['dias_aberto'])
        ? (int)$i['dias_aberto']
        : 0;
    if ($dias > $maiorDias) {
        $maiorDias = $dias;
    }
}

class PDFImpactos extends TCPDF
{
    public function Footer(): void
    {
        $this->SetY(-8);
        $this->SetFont('helvetica', '', 6.5);
        $this->SetTextColor(105, 125, 140);
        $this->Cell(135, 4, 'Controle de Produção • Gestão de Impactos', 0, 0, 'L');
        $this->Cell(0, 4, 'Página ' . $this->getAliasNumPage() . ' de ' . $this->getAliasNbPages(), 0, 0, 'R');
    }
}

$pdf = new PDFImpactos('L', 'mm', 'A4', true, 'UTF-8', false);
$pdf->SetCreator('Sistema de Controle de Produção');
$pdf->SetAuthor((string)($u['nome'] ?? $u['login'] ?? ''));
$pdf->SetTitle('Relatório de Impactos - ' . $obraNome);
$pdf->SetSubject('Relatório de impactos da obra');
$pdf->setPrintHeader(false);
$pdf->setPrintFooter(true);
$pdf->SetMargins(10, 8, 10);
$pdf->SetAutoPageBreak(true, 12);
$pdf->SetFooterMargin(5);
$pdf->AddPage();

/* ============================================================
   CABEÇALHO — desenhado diretamente no TCPDF e SEM borda preta
   ============================================================ */
$y = $pdf->GetY();

$pdf->SetTextColor(11, 65, 107);
$pdf->SetFont('helvetica', 'B', 17);
$pdf->SetXY(10, $y + 2);
$pdf->Cell(55, 7, 'RÓTULA', 0, 0, 'L');

$pdf->SetTextColor(105, 125, 145);
$pdf->SetFont('helvetica', '', 5.8);
$pdf->SetXY(10, $y + 10);
$pdf->Cell(55, 3, 'ENGENHARIA', 0, 0, 'L');

$pdf->SetTextColor(11, 65, 107);
$pdf->SetFont('helvetica', 'B', 15);
$pdf->SetXY(65, $y + 2);
$pdf->Cell(162, 7, 'RELATÓRIO DE IMPACTOS', 0, 0, 'C');

$pdf->SetTextColor(105, 125, 145);
$pdf->SetFont('helvetica', '', 6.2);
$pdf->SetXY(65, $y + 10);
$pdf->Cell(162, 3, 'CONTROLE DE PRODUÇÃO • GESTÃO', 0, 0, 'C');

$pdf->SetFillColor(28, 111, 159);
$pdf->Rect(232, $y, 55, 18, 'F');
$pdf->SetTextColor(255, 255, 255);
$pdf->SetFont('helvetica', '', 5.5);
$pdf->SetXY(232, $y + 1);
$pdf->Cell(55, 3, 'RELATÓRIO', 0, 0, 'C');
$pdf->SetFont('helvetica', 'B', 11.5);
$pdf->SetXY(232, $y + 5);
$pdf->Cell(55, 6, $filtro === 'todos' ? 'GERAL' : 'EM ABERTO', 0, 0, 'C');
$pdf->SetFont('helvetica', 'B', 6.5);
$pdf->SetXY(232, $y + 12);
$pdf->Cell(55, 4, $obraNome, 0, 0, 'C');

$pdf->SetDrawColor(207, 221, 231);
$pdf->SetLineWidth(0.2);
$pdf->Line(10, $y + 19, 287, $y + 19);

/* Metadados */
$metaY = $y + 20;
$metaX = [10, 80, 150, 220];
$metaW = [70, 70, 70, 67];
$metaLabel = ['OBRA', 'VISUALIZAÇÃO', 'DATA DE REFERÊNCIA', 'EMITIDO EM'];
$metaValor = [$obraNome, $tituloFiltro, imp_data_br($referencia), date('d/m/Y, H:i:s')];

for ($i = 0; $i < 4; $i++) {
    $pdf->SetFillColor(247, 250, 252);
    $pdf->Rect($metaX[$i], $metaY, $metaW[$i], 10, 'F');
    $pdf->SetTextColor(105, 125, 145);
    $pdf->SetFont('helvetica', 'B', 5.4);
    $pdf->SetXY($metaX[$i] + 2, $metaY + 1);
    $pdf->Cell($metaW[$i] - 4, 3, $metaLabel[$i], 0, 0, 'L');
    $pdf->SetTextColor(18, 61, 91);
    $pdf->SetFont('helvetica', 'B', 7);
    $pdf->SetXY($metaX[$i] + 2, $metaY + 4);
    $pdf->Cell($metaW[$i] - 4, 4, $metaValor[$i], 0, 0, 'L');
}

$pdf->SetY($metaY + 13);
$pdf->SetFont('helvetica', '', 8);

$css = '
<style>
body{font-family:helvetica;color:#173247;font-size:8px;}
.sec{background-color:#0b416b;color:#ffffff;font-size:8.5px;font-weight:bold;padding:4px 6px;}
.cards td{border:1px solid #d6e2ea;background-color:#f7fafc;padding:7px;}
.cards .alerta{background-color:#fff3f2;border:1px solid #efc7c3;}
.cards .ok{background-color:#edf8f1;border:1px solid #b8dfc5;}
.ct{font-size:5.8px;color:#6e8496;font-weight:bold;}
.cv{font-size:14px;color:#0b416b;font-weight:bold;}
.cv-red{font-size:14px;color:#b42318;font-weight:bold;}
.cn{font-size:5.8px;color:#7c8e9b;}
th{background-color:#e4f0f7;color:#173a57;font-size:6.2px;font-weight:bold;border:1px solid #c8d9e4;padding:4px;}
td{font-size:6.8px;border:1px solid #dce6ec;padding:4px;vertical-align:middle;}
.status-aberto{color:#b42318;font-weight:bold;}
.status-ok{color:#147a43;font-weight:bold;}
.nota{font-size:6px;color:#74899a;}
</style>';

$html = $css;
$html .= '<div class="sec">RESUMO EXECUTIVO</div><br>';
$html .= '<table class="cards" cellpadding="0" cellspacing="0"><tr>';
$html .= '<td width="25%"><span class="ct">REGISTROS VISÍVEIS</span><br><span class="cv">' . $total . '</span><br><span class="cn">linhas incluídas neste PDF</span></td>';
$html .= '<td width="25%" class="alerta"><span class="ct">EM ABERTO</span><br><span class="cv-red">' . $abertos . '</span><br><span class="cn">impacto(s) pendente(s)</span></td>';
$html .= '<td width="25%" class="ok"><span class="ct">SOLUCIONADOS</span><br><span class="cv">' . $solucionados . '</span><br><span class="cn">impacto(s) finalizado(s)</span></td>';
$html .= '<td width="25%"><span class="ct">MAIOR TEMPO</span><br><span class="cv">' . $maiorDias . ' d</span><br><span class="cn">tempo calculado na referência</span></td>';
$html .= '</tr></table><br>';

$html .= '<div class="sec">' . imp_h($tituloFiltro) . '</div><br>';
$html .= '<table cellpadding="3" cellspacing="0">';
$html .= '<thead><tr>';
$html .= '<th width="8%">DATA</th>';
$html .= '<th width="10%">EMPRESAS</th>';
$html .= '<th width="10%">SERVIÇO</th>';
$html .= '<th width="21%">MOTIVO</th>';
$html .= '<th width="7%">TEMPO</th>';
$html .= '<th width="10%">QUANDO</th>';
$html .= '<th width="22%">PARALISAÇÃO / EFEITO</th>';
$html .= '<th width="12%">SITUAÇÃO</th>';
$html .= '</tr></thead><tbody>';

if (!$impactos) {
    $html .= '<tr><td colspan="8">Nenhum impacto para o filtro selecionado.</td></tr>';
} else {
    foreach ($impactos as $i) {
        $data        = imp_data_br(trim((string)($i['data'] ?? '')));
        $empresas    = imp_texto($i['empresas'] ?? '');
        $servico     = imp_texto($i['servico'] ?? '');
        $motivo      = imp_texto($i['motivo'] ?? '');
        $tempo       = imp_texto($i['tempo'] ?? '');
        $quandoRaw   = trim((string)($i['quando'] ?? ''));
        $quando      = preg_match('/^\d{4}-\d{2}-\d{2}$/', $quandoRaw) ? imp_data_br($quandoRaw) : imp_texto($quandoRaw);
        $paralisacao = imp_texto($i['paralisacao'] ?? '');
        $solucionado = trim((string)($i['solucionado'] ?? ''));
        $dias        = isset($i['dias_aberto']) && is_numeric($i['dias_aberto']) ? (int)$i['dias_aberto'] : null;

        if ($solucionado !== '') {
            $situacao = '<span class="status-ok">SOLUCIONADO</span><br><span class="nota">' . imp_h(imp_data_br($solucionado)) . '</span>';
        } else {
            $situacao = '<span class="status-aberto">EM ABERTO</span>';
            if ($dias !== null) {
                $situacao .= '<br><span class="nota">' . $dias . ' dia(s)</span>';
            }
        }

        $html .= '<tr>';
        $html .= '<td>' . imp_h($data) . '</td>';
        $html .= '<td>' . imp_h($empresas) . '</td>';
        $html .= '<td>' . imp_h($servico) . '</td>';
        $html .= '<td>' . imp_h($motivo) . '</td>';
        $html .= '<td>' . imp_h($tempo) . '</td>';
        $html .= '<td>' . imp_h($quando) . '</td>';
        $html .= '<td>' . imp_h($paralisacao) . '</td>';
        $html .= '<td>' . $situacao . '</td>';
        $html .= '</tr>';
    }
}

$html .= '</tbody></table>';

$pdf->writeHTML($html, true, false, true, false, '');

$arquivo = 'RELATORIO_IMPACTOS_' . ($filtro === 'todos' ? 'TODOS' : 'EM_ABERTO') . '_' . $referencia . '.pdf';
$pdf->Output($arquivo, 'I');
exit;
