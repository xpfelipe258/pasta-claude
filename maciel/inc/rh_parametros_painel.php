<?php
// Parâmetros da folha no Painel pessoal, usando o mesmo cadastro de cada obra.
function rhp_parametros_painel(array $u, array $get, array $post)
{
    $salvar = ($post['acao'] ?? '') === 'rh_parametros_salvar';
    $obras = rhp_obras_permitidas($u);
    $id = (int)($salvar ? ($post['param_obra'] ?? 0) : ($get['param_obra'] ?? 0));
    if (!$id && !$salvar && !isset($get['param_obra'])) {
        $atual = obra_atual_id();
        $id = isset($obras[$atual]) ? $atual : (count($obras) === 1 ? (int)array_key_first($obras) : 0);
    }
    $r = ['aberto' => isset($get['parametros']) || $salvar, 'obras' => $obras, 'obra' => $id, 'valores' => null, 'editar' => false, 'erro' => '', 'salvo' => false];
    if (!$r['aberto']) { return $r; }
    $anterior = obra_override();
    try {
        if ($salvar) { conferir_csrf(); }
        if (!$id && !$salvar) { return $r; }
        if (!isset($obras[$id]) || !usuario_pode_obra($u, $id)) { throw new InvalidArgumentException('Escolha uma obra à qual você tenha acesso.'); }
        obra_override($id);
        if (!usuario_pode_modulo($u, 'financeiro')) { throw new InvalidArgumentException('Seu usuário não possui acesso ao módulo Financeiro.'); }
        $r['editar'] = !usuario_so_leitura($u, 'financeiro');
        $r['valores'] = rh_params(true);
        if ($salvar) {
            if (!$r['editar']) { throw new InvalidArgumentException('Seu usuário possui somente leitura no Financeiro.'); }
            $entrada = (array)($post['parametros'] ?? []);
            foreach (rh_params_rotulos() as $chave => $rotulo) {
                if (!isset($entrada[$chave]) || !is_scalar($entrada[$chave])) { throw new InvalidArgumentException('Preencha todos os parâmetros da folha.'); }
                if (strpos($rotulo[1], 'sel:') === 0) {
                    $opcoes = array_map(function ($o) { return explode('=', $o, 2)[0]; }, explode('|', substr($rotulo[1], 4)));
                    if (!in_array((string)$entrada[$chave], $opcoes, true)) { throw new InvalidArgumentException($rotulo[0] . ': opção inválida.'); }
                }
            }
            bd()->beginTransaction();
            try {
                list($valores, $erros) = rh_params_salvar($entrada);
                if ($erros) { throw new InvalidArgumentException(implode(' ', $erros)); }
                registrar_global('rh_parametros_salvos', ['obra_id' => $id, 'obra_parametros_id' => rh_obra_params_id()]);
                bd()->commit();
                $r['valores'] = $valores;
                $r['salvo'] = true;
            } catch (Throwable $e) {
                if (bd()->inTransaction()) { bd()->rollBack(); }
                throw $e;
            }
        }
    } catch (Throwable $e) {
        $r['erro'] = $e instanceof InvalidArgumentException ? $e->getMessage() : 'Não foi possível carregar ou salvar os parâmetros da folha.';
        if ($salvar && $r['valores'] !== null) {
            foreach (rh_params_padrao() as $k => $v) {
                if (isset($post['parametros'][$k]) && is_scalar($post['parametros'][$k])) { $r['valores'][$k] = $post['parametros'][$k]; }
            }
        }
    } finally { obra_override($anterior); }
    return $r;
}

function rhp_parametros_janela(array $r, $mes, $vista, $csrf)
{
    ?>
    <dialog id="rhParametros" style="width:min(880px,calc(100% - 32px));max-height:85vh;overflow:auto;border:1px solid #d0d5dd;border-radius:16px;padding:24px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:16px"><h2>Parâmetros da folha</h2><button type="button" class="btn" data-rh-param-fechar aria-label="Fechar parâmetros">Fechar</button></div>
      <p>Escolha a obra para consultar ou ajustar os encargos, provisões e benefícios usados no cálculo da folha.</p>
      <form method="get" class="ce-mes" style="margin-bottom:18px">
        <input type="hidden" name="v" value="<?= h($vista) ?>"><input type="hidden" name="mes" value="<?= h($mes) ?>"><input type="hidden" name="parametros" value="1">
        <label>Obra<select name="param_obra" required><option value="">Selecione a obra</option><?php foreach ($r['obras'] as $id => $nome): ?><option value="<?= (int)$id ?>" <?= (int)$r['obra'] === (int)$id ? 'selected' : '' ?>><?= h($nome) ?></option><?php endforeach; ?></select></label><button class="btn">Carregar parâmetros</button>
      </form>
      <?php if (!$r['obras']): ?><p class="ce-nota">Nenhuma obra disponível. Os parâmetros podem ser definidos depois que uma obra for criada ou liberada para você.</p><?php endif; ?>
      <?php if ($r['erro']): ?><div class="toast erro-form" role="alert"><?= h($r['erro']) ?></div><?php endif; ?>
      <?php if ($r['salvo']): ?><div class="toast ok-faixa" role="status">Parâmetros salvos. A folha foi recalculada.</div><?php endif; ?>
      <?php if ($r['valores'] !== null): ?>
      <form method="post">
        <input type="hidden" name="csrf" value="<?= h($csrf) ?>"><input type="hidden" name="acao" value="rh_parametros_salvar"><input type="hidden" name="param_obra" value="<?= (int)$r['obra'] ?>">
        <p class="ce-nota">Aplicação: <b><?= h($r['obras'][$r['obra']]) ?></b>. Estes são os mesmos parâmetros de Financeiro › Contas a pagar. Quando a obra usa o cadastro da obra principal, os parâmetros também são compartilhados.</p>
        <div class="ce-form">
        <?php foreach (rh_params_rotulos() as $k => $rot): $valor = (string)$r['valores'][$k]; ?>
          <label><?= h($rot[0]) ?>
          <?php if (strpos($rot[1], 'sel:') === 0): ?><select name="parametros[<?= h($k) ?>]" <?= !$r['editar'] ? 'disabled' : '' ?>><?php foreach (explode('|', substr($rot[1], 4)) as $op): list($v, $texto) = explode('=', $op, 2); ?><option value="<?= h($v) ?>" <?= $valor === $v ? 'selected' : '' ?>><?= h($texto) ?></option><?php endforeach; ?></select>
          <?php else: ?><input name="parametros[<?= h($k) ?>]" inputmode="decimal" required value="<?= h(str_replace('.', ',', $valor)) ?>" <?= !$r['editar'] ? 'readonly' : '' ?>><?php endif; ?>
          </label>
        <?php endforeach; ?>
        </div>
        <p class="ce-nota">Os colaboradores sem obra usam os parâmetros padrão. A folha é uma estimativa gerencial; confirme as premissas com o contador.</p>
        <?php if ($r['editar']): ?><button class="btn primario">Salvar parâmetros</button><?php endif; ?>
      </form>
      <?php endif; ?>
    </dialog>
    <script>
    (function () {
      var d = document.getElementById('rhParametros');
      d.querySelectorAll('[data-rh-param-fechar]').forEach(function (b) { b.addEventListener('click', function () { d.close(); }); });
      <?php if ($r['aberto']): ?>d.showModal();<?php endif; ?>
    })();
    </script>
    <?php
}
