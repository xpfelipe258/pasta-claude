# Serviço de leitura de obras (Python)

Serviço separado do sistema em PHP. Recebe os documentos da obra nova, valida e (na fase 2) gera os dados da obra.

## Fases
- **Fase 1 (esta):** validação profunda dos 5 documentos obrigatórios (IFC, fixadores, cronograma, orçamento, projetos em PDF).
- **Fase 2:** leitura completa — lista de material, fluxo de baixa, mapa de apontamento, BM e cronograma (`/jobs/processar`).

## Instalar em um servidor (VPS Linux)
```bash
cd servico_leitura
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
export SEGREDO_LEITURA='um-segredo-longo-e-aleatorio'   # o MESMO valor do config.php
uvicorn app:app --host 127.0.0.1 --port 8765
```
Publique atrás de HTTPS (nginx ou Caddy) — o PHP chama `https://seu-dominio/jobs/validar`.

Exemplo de serviço systemd (`/etc/systemd/system/leitura-obras.service`):
```ini
[Service]
WorkingDirectory=/opt/pasta-claude/servico_leitura
Environment=SEGREDO_LEITURA=um-segredo-longo-e-aleatorio
ExecStart=/opt/pasta-claude/servico_leitura/.venv/bin/uvicorn app:app --host 127.0.0.1 --port 8765
Restart=always
```

## Ligar ao sistema (Hostinger)
Em `maciel/inc/config.php` (arquivo fora do Git) acrescente:
```php
'servico_leitura' => ['url' => 'https://leitura.seudominio.com', 'segredo' => 'um-segredo-longo-e-aleatorio'],
```
Sem essa chave o assistente de importação funciona só com a conferência básica (formato e cabeçalho).

## Como conversam
1. O PHP guarda o arquivo e chama `POST /jobs/validar` (corpo JSON assinado: `X-Assinatura` = HMAC-SHA256 do corpo).
2. O serviço baixa o arquivo pelo link assinado (`url_download`, expira em 1 h), valida e chama o `callback` (também assinado).
3. A tela da importação mostra o resultado (válido, avisos ou erro) e só libera o envio quando os 5 documentos estão completos.

## Testes
```bash
python -m unittest discover -s tests -v
```
