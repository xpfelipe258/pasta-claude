# Módulo Finanças (arquivado)

Retirado do sistema em 2026-10-13 a pedido do responsável. O código está guardado aqui e **não é carregado** pelo sistema
(`maciel/` não tem mais `financas.php`, o módulo `financas` saiu de `modulos_sistema()` e o menu "Finanças" foi removido).
As tabelas `fin_lancamentos` e `fin_config` (se já foram criadas no banco) **não foram apagadas**.

## Conteúdo
- `maciel/financas.php`, `maciel/inc/financas_modelo.php`, `maciel/inc/financas_calculos.php` — módulo PHP (painel, lançamentos, impostos CLT/MEI/ME, investimentos)
- `ferramentas/teste_financas_php.py` — testes (26) com paridade PHP × Python
- `financas/` — programa original em Python/Streamlit
- `integracao.patch` — as alterações que o módulo fazia em arquivos do sistema (`inc/nucleo.php`, `inc/painel.html`, `admin.php`, `inc/sesmt_modelo.php`)

## Como restaurar
```bash
cp arquivados/financas/maciel/financas.php maciel/
cp arquivados/financas/maciel/inc/financas_*.php maciel/inc/
cp arquivados/financas/ferramentas/teste_financas_php.py ferramentas/
cp -r arquivados/financas/financas ./financas
git apply arquivados/financas/integracao.patch   # se não aplicar limpo, aplique os trechos à mão
```
Depois envie os arquivos ao Hostinger e libere o módulo em Administração → Usuários.
