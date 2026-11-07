<?php
// Envio do RDO do cliente por e-mail (depois de validado). A configuração (destinatários, envio automático, assunto e mensagem) e o histórico
// de envios ficam por obra em sistema.rdo_email e sistema.rdo_email_envios. O PDF é montado no navegador de quem valida (é o mesmo "RDO para o cliente"
// que o botão gera) e enviado a rdo_email.php, que manda o e-mail com o PDF em anexo para cada destinatário.

function rdo_email_padroes()
{
    return [
        'destinatarios' => [], 'copias' => [], 'auto' => 0, 'copia' => 1,
        'assunto' => 'RDO {obra} — {data}',
        'mensagem' => "Prezados,\n\nSegue em anexo o Relatório Diário de Obra (RDO) do dia {data}, validado pela gestão da obra.\n\nQualquer dúvida, é só responder este e-mail.",
    ];
}

function rdo_email_cfg()
{
    $c = json_decode((string)sistema_ler('rdo_email', '{}'), true);
    $c = is_array($c) ? array_merge(rdo_email_padroes(), $c) : rdo_email_padroes();
    $c['destinatarios'] = array_values(array_filter(array_map('trim', (array)$c['destinatarios'])));
    $c['copias'] = array_values(array_filter(array_map('trim', (array)$c['copias'])));
    $c['auto'] = !empty($c['auto']) ? 1 : 0;
    $c['copia'] = !empty($c['copia']) ? 1 : 0;
    return $c;
}

/** Lê o texto digitado (um e-mail por linha, ou separados por vírgula/ponto e vírgula) e devolve [válidos, inválidos]. */
function rdo_email_lista($texto)
{
    $ok = $ruim = [];
    foreach (preg_split('/[\s,;]+/u', (string)$texto, -1, PREG_SPLIT_NO_EMPTY) as $e) {
        $e = mb_strtolower(trim($e), 'UTF-8');
        if (filter_var($e, FILTER_VALIDATE_EMAIL)) { $ok[$e] = $e; } else { $ruim[] = $e; }
    }
    return [array_values($ok), $ruim];
}

function rdo_email_envios($dia = null)
{
    $e = json_decode((string)sistema_ler('rdo_email_envios', '{}'), true);
    $e = is_array($e) ? $e : [];
    return $dia === null ? $e : ($e[$dia] ?? []);
}

/** O que vai ao navegador: administrador da obra recebe tudo; os demais só sabem se o envio está ligado (sem os endereços do cliente). */
function rdo_email_para_modelo(array $u)
{
    $c = rdo_email_cfg();
    if (!usuario_admin_da_obra($u)) {
        return (object)['admin' => false, 'auto' => $c['auto'], 'n' => count($c['destinatarios'])];
    }
    return (object)['admin' => true, 'cfg' => (object)$c, 'envios' => (object)rdo_email_envios()];
}

function rdo_email_texto($modelo, array $v)
{
    return strtr((string)$modelo, ['{obra}' => $v['obra'], '{data}' => $v['data']]);
}

/** Corpo do e-mail (HTML e texto simples). $resumo = números do dia calculados na tela (só inteiros e o clima). */
function rdo_email_corpo(array $cfg, $dia, array $resumo, array $u, $anterior)
{
    $obra = obra_ficha();
    $dataBr = date('d/m/Y', strtotime($dia));
    $v = ['obra' => (string)$obra['nome'], 'data' => $dataBr];
    $assunto = rdo_email_texto($cfg['assunto'], $v);
    $mensagem = rdo_email_texto($cfg['mensagem'], $v);
    $cor = '#d97706';
    try {
        $c = q_global('SELECT cor_primaria FROM obras WHERE id = ?', [obra_atual_id()])->fetchColumn();
        $cor = cor_segura($c ?: '', '#d97706');
    } catch (Throwable $e) { /* cor padrão */ }
    $val = rdo_dia_validacao($dia);
    $sistema = config() ? global_ler('nome_sistema', 'Núcleo de Obras') : 'Núcleo de Obras';
    $linhas = [];
    $num = function ($k) use ($resumo) { return isset($resumo[$k]) && is_numeric($resumo[$k]) ? (int)$resumo[$k] : null; };
    foreach ([['atividades', 'Atividades com produção'], ['efetivo', 'Efetivo no dia (pessoas)'], ['maquinas', 'Máquinas usadas'], ['remessas', 'Remessas que chegaram'], ['fotos', 'Fotos no relatório']] as $it) {
        if (($n = $num($it[0])) !== null) { $linhas[] = [$it[1], (string)$n]; }
    }
    $clima = mb_substr(trim((string)($resumo['clima'] ?? '')), 0, 160);
    if ($clima !== '') { $linhas[] = ['Clima', $clima]; }
    $quem = $val ? ($val['por'] ?? $u['nome']) : (string)$u['nome'];
    $subst = $anterior ? 'Esta versão substitui a enviada em ' . date('d/m/Y \à\s H:i', strtotime($anterior)) . '.' : '';
    $h = fn($s) => htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8');
    $tab = '';
    foreach ($linhas as $l) { $tab .= '<tr><td style="padding:7px 12px;color:#667085;border-bottom:1px solid #eef0f3">' . $h($l[0]) . '</td><td style="padding:7px 12px;text-align:right;font-weight:700;color:#101828;border-bottom:1px solid #eef0f3">' . $h($l[1]) . '</td></tr>'; }
    $html = '<!doctype html><html><body style="margin:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;color:#101828">'
        . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">'
        . '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e4e7ec">'
        . '<tr><td style="background:' . $cor . ';padding:22px 26px;color:#ffffff"><div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;opacity:.9">Relatório Diário de Obra</div>'
        . '<div style="font-size:22px;font-weight:700;margin-top:4px">' . $h($v['obra']) . '</div><div style="font-size:15px;margin-top:2px">' . $h($dataBr) . '</div></td></tr>'
        . '<tr><td style="padding:24px 26px;font-size:15px;line-height:1.55">' . nl2br($h($mensagem)) . ($subst ? '<p style="margin:14px 0 0;color:#b54708"><b>' . $h($subst) . '</b></p>' : '') . '</td></tr>'
        . ($tab ? '<tr><td style="padding:0 26px 8px"><div style="font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#667085;margin-bottom:6px">Resumo do dia</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;border:1px solid #eef0f3;border-radius:8px">' . $tab . '</table></td></tr>' : '')
        . '<tr><td style="padding:16px 26px 24px;font-size:14px;line-height:1.5"><table role="presentation" cellpadding="0" cellspacing="0" style="background:#f9fafb;border:1px solid #e4e7ec;border-radius:8px;width:100%"><tr><td style="padding:12px 14px">'
        . '<b>📎 RDO-' . $h($dia) . '.pdf</b><br><span style="color:#667085">O relatório completo está no anexo deste e-mail (PDF).</span></td></tr></table></td></tr>'
        . '<tr><td style="padding:14px 26px;background:#f9fafb;border-top:1px solid #e4e7ec;font-size:12px;color:#667085;line-height:1.5">RDO validado por <b>' . $h($quem) . '</b>' . ($val && !empty($val['em']) ? ' em ' . $h(date('d/m/Y H:i', strtotime($val['em']))) : '') . '.<br>'
        . 'Enviado pelo sistema ' . $h($sistema) . '. Ao responder este e-mail, a resposta vai para ' . $h($u['nome']) . '.</td></tr>'
        . '</table></td></tr></table></body></html>';
    $txt = "Relatório Diário de Obra — {$v['obra']} — {$dataBr}\n\n" . $mensagem . ($subst ? "\n\n$subst" : '') . "\n\n";
    foreach ($linhas as $l) { $txt .= $l[0] . ': ' . $l[1] . "\n"; }
    $txt .= "\nO relatório completo está no PDF anexo (RDO-$dia.pdf).\nRDO validado por $quem. Enviado pelo sistema $sistema.\n";
    return ['assunto' => $assunto, 'html' => $html, 'texto' => $txt];
}

/** Envia o e-mail (texto + HTML + PDF anexo) a um destinatário. Nos testes (GESTAO_EMAIL_ARQUIVO) grava em arquivo em vez de enviar. */
function rdo_email_enviar_um($para, array $corpo, $pdf, $nomePdf, $replyTo, $cc)
{
    if (!filter_var($para, FILTER_VALIDATE_EMAIL)) { return false; }
    $nome = config() ? global_ler('nome_sistema', 'Núcleo de Obras') : 'Núcleo de Obras';
    $dom = preg_replace('/^www\./', '', $_SERVER['HTTP_HOST'] ?? 'mtecengenharia.net');
    $b1 = 'mix_' . bin2hex(random_bytes(8));
    $b2 = 'alt_' . bin2hex(random_bytes(8));
    $h = ['MIME-Version: 1.0', 'From: ' . mb_encode_mimeheader($nome, 'UTF-8', 'B') . ' <no-reply@' . $dom . '>',
        'Reply-To: ' . (filter_var($replyTo, FILTER_VALIDATE_EMAIL) ? $replyTo : 'no-reply@' . $dom), 'X-Mailer: PHP/' . phpversion(),
        'Content-Type: multipart/mixed; boundary="' . $b1 . '"'];
    $ccs = array_values(array_filter((array)$cc, function ($e) use ($para) { return filter_var($e, FILTER_VALIDATE_EMAIL) && strcasecmp($e, $para) !== 0; }));
    if ($ccs) { $h[] = 'Cc: ' . implode(', ', $ccs); }
    $cc = implode(', ', $ccs);
    $corpoMime = "--$b1\r\nContent-Type: multipart/alternative; boundary=\"$b2\"\r\n\r\n"
        . "--$b2\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" . chunk_split(base64_encode($corpo['texto'])) . "\r\n"
        . "--$b2\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" . chunk_split(base64_encode($corpo['html'])) . "\r\n--$b2--\r\n"
        . "--$b1\r\nContent-Type: application/pdf; name=\"$nomePdf\"\r\nContent-Transfer-Encoding: base64\r\nContent-Disposition: attachment; filename=\"$nomePdf\"\r\n\r\n" . chunk_split(base64_encode($pdf)) . "\r\n--$b1--\r\n";
    $arqTeste = getenv('GESTAO_EMAIL_ARQUIVO');
    if ($arqTeste) {
        if (($pasta = getenv('GESTAO_EMAIL_HTML'))) { @file_put_contents($pasta, $corpo['html']); }
        if (($arqPdf = getenv('GESTAO_EMAIL_PDF'))) { @file_put_contents($arqPdf, $pdf); }   // só nos testes: guarda o PDF anexado
        return file_put_contents($arqTeste, "PARA: $para\nCC: " . ($cc ?: '-') . "\nREPLY-TO: $replyTo\nASSUNTO: {$corpo['assunto']}\nANEXO: $nomePdf (" . strlen($pdf) . " bytes)\nTEXTO:\n{$corpo['texto']}\n=====\n", FILE_APPEND) !== false;
    }
    return @mail($para, '=?UTF-8?B?' . base64_encode($corpo['assunto']) . '?=', $corpoMime, implode("\r\n", $h));
}
