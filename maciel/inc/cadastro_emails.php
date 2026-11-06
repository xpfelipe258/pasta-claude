<?php
// Modelos de e-mail do cadastro público. CSS inline para clientes de e-mail.
function cadastro_email_esc($valor)
{
    return htmlspecialchars((string)$valor, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function cadastro_email_layout($nomeSistema, $titulo, $subtitulo, $conteudo, $rodape)
{
    $marca = cadastro_email_esc($nomeSistema);
    $titulo = cadastro_email_esc($titulo);
    $subtitulo = cadastro_email_esc($subtitulo);
    $rodape = cadastro_email_esc($rodape);
    return '<!doctype html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' . $titulo . '</title></head>'
        . '<body style="margin:0;padding:0;background:#f3f5f8;font-family:Arial,Helvetica,sans-serif;color:#14213d;">'
        . '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f3f5f8;"><tr><td align="center" style="padding:32px 12px;">'
        . '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:600px;background:#ffffff;border:1px solid #dfe5ed;border-radius:14px;overflow:hidden;">'
        . '<tr><td style="background:#14213d;padding:24px 32px;border-bottom:4px solid #e07a18;">'
        . '<span style="display:inline-block;background:#e07a18;color:#ffffff;font-size:14px;font-weight:bold;line-height:34px;text-align:center;width:34px;height:34px;border-radius:8px;vertical-align:middle;">NO</span>'
        . '<span style="color:#ffffff;font-size:18px;font-weight:bold;vertical-align:middle;padding-left:10px;">' . $marca . '</span></td></tr>'
        . '<tr><td style="padding:32px;">'
        . '<p style="margin:0 0 10px;color:#e07a18;font-size:12px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;">MTEC OBRAS</p>'
        . '<h1 style="margin:0 0 10px;font-size:27px;line-height:1.2;color:#14213d;">' . $titulo . '</h1>'
        . '<p style="margin:0 0 24px;color:#526176;font-size:16px;line-height:1.5;">' . $subtitulo . '</p>'
        . $conteudo
        . '</td></tr><tr><td style="padding:20px 32px;background:#f7f9fb;border-top:1px solid #e5eaf0;color:#64748b;font-size:12px;line-height:1.5;">'
        . $rodape . '</td></tr></table></td></tr></table></body></html>';
}

function cadastro_email_linha($rotulo, $valor)
{
    return '<tr><td style="padding:9px 12px;color:#64748b;font-size:13px;vertical-align:top;border-bottom:1px solid #edf0f4;">'
        . cadastro_email_esc($rotulo) . '</td><td style="padding:9px 12px;color:#14213d;font-size:13px;font-weight:bold;vertical-align:top;border-bottom:1px solid #edf0f4;word-break:break-word;">'
        . cadastro_email_esc($valor) . '</td></tr>';
}

function cadastro_email_botao($url, $rotulo)
{
    $urlSeguro = cadastro_email_esc($url);
    return '<p style="margin:26px 0 12px;"><a href="' . $urlSeguro . '" style="display:inline-block;background:#e07a18;color:#ffffff;text-decoration:none;font-size:15px;font-weight:bold;padding:14px 22px;border-radius:8px;">'
        . cadastro_email_esc($rotulo) . '</a></p>'
        . '<p style="margin:0;color:#64748b;font-size:12px;line-height:1.5;word-break:break-all;">Se o botão não abrir, copie este endereço: <a href="' . $urlSeguro . '" style="color:#14213d;">' . $urlSeguro . '</a></p>';
}

function cadastro_email_boas_vindas(array $d)
{
    $nome = cadastro_email_esc($d['admin_nome']);
    $empresa = cadastro_email_esc($d['empresa']);
    $conteudo = '<p style="margin:0 0 18px;font-size:15px;line-height:1.6;">Olá, <strong>' . $nome . '</strong>! A empresa <strong>' . $empresa . '</strong> já está cadastrada. Confirme seu e-mail para liberar o acesso e começar a organizar as obras e a equipe.</p>'
        . '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border:1px solid #e3e9f0;border-radius:8px;border-collapse:separate;border-spacing:0;background:#f8fafc;">'
        . cadastro_email_linha('Plano', $d['plano'])
        . cadastro_email_linha('Teste até', $d['vencimento'])
        . cadastro_email_linha('Seu login', $d['login'])
        . '</table>'
        . cadastro_email_botao($d['link_verificacao'], 'Confirmar meu e-mail')
        . '<p style="margin:16px 0 0;color:#526176;font-size:13px;line-height:1.6;">O link de confirmação é válido por 24 horas. Depois de confirmar, acesse <a href="' . cadastro_email_esc($d['link']) . '" style="color:#14213d;">a página de login</a>.</p>'
        . '<h2 style="margin:30px 0 12px;font-size:17px;color:#14213d;">Primeiros passos</h2>'
        . '<ol style="margin:0;padding-left:22px;color:#526176;font-size:14px;line-height:1.8;">'
        . '<li>Cadastre sua primeira obra.</li><li>Convide os profissionais da equipe.</li><li>Registre a produção e acompanhe os indicadores.</li></ol>'
        . '<p style="margin:22px 0 0;color:#526176;font-size:13px;line-height:1.6;">Use o login e a senha que você criou no cadastro. Por segurança, sua senha não é enviada por e-mail.</p>';
    return cadastro_email_layout($d['sistema'], 'Boas-vindas ao ' . $d['sistema'] . '!', 'Seu período de teste começou. Confirme seu e-mail para acessar a plataforma.', $conteudo,
        'Esta mensagem foi enviada após o cadastro de sua empresa no ' . $d['sistema'] . '. Se você não realizou esse cadastro, desconsidere este e-mail.');
}

function cadastro_email_aviso_admin(array $d)
{
    $conteudo = '<p style="margin:0 0 18px;color:#526176;font-size:15px;line-height:1.6;">Uma empresa concluiu o cadastro pela página de acesso e iniciou o período de teste. Confira os dados para acompanhar o novo cliente.</p>'
        . '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border:1px solid #e3e9f0;border-radius:8px;border-collapse:separate;border-spacing:0;background:#f8fafc;">'
        . cadastro_email_linha('Empresa', $d['empresa'])
        . cadastro_email_linha('CNPJ', $d['documento'] ?: 'Não informado')
        . cadastro_email_linha('Responsável', $d['admin_nome'])
        . cadastro_email_linha('E-mail', $d['email'])
        . cadastro_email_linha('Telefone', $d['telefone'] ?: 'Não informado')
        . cadastro_email_linha('Plano', $d['plano'] . ' · ciclo ' . strtolower($d['ciclo']))
        . cadastro_email_linha('Teste até', $d['vencimento'])
        . '</table>'
        . cadastro_email_botao($d['link_admin'], 'Acompanhar em Comercial');
    return cadastro_email_layout($d['sistema'], 'Novo cliente cadastrado', 'Cadastro de empresa iniciado na plataforma.', $conteudo,
        'Aviso automático do ' . $d['sistema'] . ' para a equipe administradora.');
}

function cadastro_email_reenvio_verificacao(array $d)
{
    $conteudo = '<p style="margin:0 0 18px;font-size:15px;line-height:1.6;">Olá, <strong>' . cadastro_email_esc($d['admin_nome']) . '</strong>. Recebemos uma solicitação para confirmar o e-mail da sua conta.</p>'
        . cadastro_email_botao($d['link_verificacao'], 'Confirmar meu e-mail')
        . '<p style="margin:20px 0 0;color:#526176;font-size:13px;line-height:1.6;">O link é válido por 24 horas. Se você não solicitou o reenvio, desconsidere esta mensagem.</p>';
    return cadastro_email_layout($d['sistema'], 'Confirme seu e-mail', 'Falta um passo para acessar o ' . $d['sistema'] . '.', $conteudo,
        'Mensagem automática do ' . $d['sistema'] . '. Sua senha nunca é enviada por e-mail.');
}
