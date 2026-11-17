<?php
// Estrutura comercial separada das permissões e dos espelhos das obras.
function garantir_organizacao_estrutura()
{
    static $ok = false;
    if ($ok) { return; }
    $fim = (config()['driver'] ?? 'mysql') === 'sqlite' ? '' : ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4';
    bd()->exec("CREATE TABLE IF NOT EXISTS organizacao_estrutura (organizacao_id INT PRIMARY KEY, tipo VARCHAR(16) NOT NULL, gerenciadora_id INT NULL, atualizado_por INT NOT NULL, atualizado_em VARCHAR(19) NOT NULL)$fim");
    if ((config()['driver'] ?? 'mysql') === 'sqlite') {
        bd()->exec('CREATE INDEX IF NOT EXISTS idx_org_estrutura_gerenciadora ON organizacao_estrutura (gerenciadora_id)');
    } elseif (!(int)q_global("SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'organizacao_estrutura' AND INDEX_NAME = 'idx_org_estrutura_gerenciadora'")->fetchColumn()) {
        bd()->exec('CREATE INDEX idx_org_estrutura_gerenciadora ON organizacao_estrutura (gerenciadora_id)');
    }
    $ok = true;
}

function org_estrutura_ler($id)
{
    $r = q_global('SELECT tipo, gerenciadora_id FROM organizacao_estrutura WHERE organizacao_id = ?', [(int)$id])->fetch();
    $executoras = q_global('SELECT e.organizacao_id AS id, o.nome FROM organizacao_estrutura e JOIN organizacoes o ON o.id = e.organizacao_id WHERE e.gerenciadora_id = ? ORDER BY o.nome', [(int)$id])->fetchAll();
    $gerenciadora = $r && !empty($r['gerenciadora_id']) ? q_global('SELECT id, nome FROM organizacoes WHERE id = ?', [(int)$r['gerenciadora_id']])->fetch() : null;
    return ['organizacao_id' => (int)$id, 'tipo_empresa' => $r['tipo'] ?? '', 'gerenciadora_id' => (int)($r['gerenciadora_id'] ?? 0), 'gerenciadora' => $gerenciadora ?: null,
        'executoras_ids' => array_map('intval', array_column($executoras, 'id')), 'executoras' => $executoras];
}

function org_estrutura_pode_alterar(array $u, $id)
{
    if (($u['perfil'] ?? '') === 'admin') { return true; }
    return (bool)q_global('SELECT 1 FROM usuarios WHERE id = ? AND organizacao_id = ? AND admin_organizacao = 1 AND ativo = 1', [(int)($u['id'] ?? 0), (int)$id])->fetchColumn();
}

/** Valida o grafo inteiro antes de persistir. Uma executora tem zero ou uma gerenciadora. */
function org_estrutura_validar_grafo(array $grafo)
{
    $filhas = [];
    foreach ($grafo as $id => $r) {
        if (!in_array($r['tipo'], ['GERENCIADORA', 'EXECUTORA'], true)) { throw new InvalidArgumentException('Tipo de empresa inválido.'); }
        $pai = (int)($r['gerenciadora_id'] ?? 0);
        if ($pai) {
            if ((int)$id === $pai || $r['tipo'] !== 'EXECUTORA' || !isset($grafo[$pai]) || $grafo[$pai]['tipo'] !== 'GERENCIADORA') {
                throw new InvalidArgumentException('O vínculo deve ligar uma executora a uma gerenciadora diferente dela.');
            }
            $filhas[$pai] = ($filhas[$pai] ?? 0) + 1;
        }
    }
    // O cadastro inicial da gerenciadora e a criação da obra podem preceder a executora.
}

/** Cadastro inicial sem plano, cobrança ou usuário; a empresa pode ser completada depois. */
function org_cadastro_inicial(array $dados, $tipo, array $u)
{
    if (($u['perfil'] ?? '') !== 'admin' && !usuario_admin_organizacao($u)) { throw new InvalidArgumentException('Somente o administrador da empresa ou o administrador geral cadastra empresas parceiras.'); }
    if (!bd()->inTransaction()) { throw new RuntimeException('O cadastro inicial deve ser transacional.'); }
    if (!in_array($tipo, ['GERENCIADORA','EXECUTORA'], true)) { throw new InvalidArgumentException('Escolha o tipo de empresa.'); }
    $nome = trim((string)($dados['nome'] ?? ''));
    $documento = trim((string)($dados['documento'] ?? ''));
    $email = trim((string)($dados['email'] ?? ''));
    if ($nome === '' || mb_strlen($nome,'UTF-8') > 120) { throw new InvalidArgumentException('Informe o nome da empresa (até 120 caracteres).'); }
    if (mb_strlen($documento,'UTF-8') > 30) { throw new InvalidArgumentException('Documento da empresa: até 30 caracteres.'); }
    if ($email !== '' && !filter_var($email,FILTER_VALIDATE_EMAIL)) { throw new InvalidArgumentException('E-mail da empresa inválido.'); }
    foreach (q_global('SELECT id, nome, documento FROM organizacoes')->fetchAll() as $o) {
        $doc = preg_replace('/\D/', '', $documento);
        if (mb_strtoupper(trim($o['nome']),'UTF-8') === mb_strtoupper($nome,'UTF-8') || ($doc !== '' && preg_replace('/\D/', '', (string)$o['documento']) === $doc)) {
            throw new InvalidArgumentException('Esta empresa já está cadastrada. Selecione o cadastro existente.');
        }
    }
    q_global("INSERT INTO organizacoes (nome,documento,email,telefone,contato,status,inicio,criado_em,atualizado_em) VALUES (?,?,?,?,?,'TESTE',?,?,?)",
        [$nome,texto_ou_nulo($documento),texto_ou_nulo($email),texto_ou_nulo(mb_substr((string)($dados['telefone']??''),0,30,'UTF-8')),
        texto_ou_nulo(mb_substr((string)($dados['contato']??''),0,120,'UTF-8')),planos_hoje(),planos_agora(),planos_agora()]);
    $id=(int)bd()->lastInsertId();
    q_global('INSERT INTO organizacao_estrutura (organizacao_id,tipo,gerenciadora_id,atualizado_por,atualizado_em) VALUES (?,?,NULL,?,?)',[$id,$tipo,(int)$u['id'],planos_agora()]);
    registrar_global('empresa_cadastro_inicial',['organizacao_id'=>$id,'nome'=>$nome,'tipo'=>$tipo]);
    return $id;
}

/** Chamado na mesma transação do cadastro/edição; não altera acessos, planos ou dados das obras. */
function org_estrutura_salvar($id, array $post, array $u, $publico = false)
{
    $id = (int)$id;
    if (!org_estrutura_pode_alterar($u, $id)) { throw new InvalidArgumentException('Somente o administrador geral ou o administrador desta empresa pode alterar seus vínculos.'); }
    $tipo = (string)($post['tipo_empresa'] ?? '');
    if (!in_array($tipo, ['GERENCIADORA', 'EXECUTORA'], true)) { throw new InvalidArgumentException('Escolha o tipo da empresa: gerenciadora ou executora.'); }
    if (!bd()->inTransaction()) { throw new RuntimeException('O cadastro empresarial deve ser salvo em uma transação.'); }
    $gerenciadora = (int)($post['gerenciadora_id'] ?? 0);
    $executoras = array_values(array_unique(array_filter(array_map('intval', (array)($post['executoras_ids'] ?? [])))));
    if ($publico && ($gerenciadora || $executoras)) { throw new InvalidArgumentException('O vínculo com empresas já cadastradas é definido após entrar no sistema.'); }
    $lock = (config()['driver'] ?? 'mysql') === 'sqlite' ? '' : ' FOR UPDATE';
    $empresas = [];
    foreach (q_global('SELECT id, nome FROM organizacoes ORDER BY id' . $lock)->fetchAll() as $o) { $empresas[(int)$o['id']] = $o['nome']; }
    if (!isset($empresas[$id])) { throw new InvalidArgumentException('Empresa não encontrada.'); }
    $antes = [];
    foreach (q_global('SELECT organizacao_id, tipo, gerenciadora_id FROM organizacao_estrutura ORDER BY organizacao_id' . $lock)->fetchAll() as $r) {
        $antes[(int)$r['organizacao_id']] = ['tipo' => $r['tipo'], 'gerenciadora_id' => (int)$r['gerenciadora_id']];
    }
    $grafo = $antes;
    if ($tipo === 'GERENCIADORA' && !empty($post['cadastrar_executora'])) {
        $nova = (array)($post['nova_executora'] ?? []);
        $novoId = org_cadastro_inicial($nova,'EXECUTORA',$u);
        $empresas[$novoId] = $nova['nome'];
        $grafo[$novoId] = ['tipo' => 'EXECUTORA', 'gerenciadora_id' => 0];
        $executoras[] = $novoId;
    }
    // Troca de tipo ou remoção de filhas: a executora pode permanecer sem gerenciadora.
    foreach ($grafo as &$r) { if ((int)$r['gerenciadora_id'] === $id) { $r['gerenciadora_id'] = 0; } } unset($r);
    $grafo[$id] = ['tipo' => $tipo, 'gerenciadora_id' => 0];
    if ($tipo === 'EXECUTORA' && $gerenciadora) {
        if ($gerenciadora === $id || !isset($empresas[$gerenciadora]) || (isset($grafo[$gerenciadora]) && $grafo[$gerenciadora]['tipo'] !== 'GERENCIADORA')) {
            throw new InvalidArgumentException('Escolha uma gerenciadora cadastrada válida.');
        }
        $grafo[$gerenciadora] = $grafo[$gerenciadora] ?? ['tipo' => 'GERENCIADORA', 'gerenciadora_id' => 0];
        $grafo[$id]['gerenciadora_id'] = $gerenciadora;
    } elseif ($tipo === 'GERENCIADORA') {
        foreach ($executoras as $exec) {
            if ($exec === $id || !isset($empresas[$exec]) || (isset($grafo[$exec]) && $grafo[$exec]['tipo'] !== 'EXECUTORA')) {
                throw new InvalidArgumentException('Escolha executoras cadastradas válidas, diferentes da gerenciadora.');
            }
            $grafo[$exec] = ['tipo' => 'EXECUTORA', 'gerenciadora_id' => $id];
        }
    }
    org_estrutura_validar_grafo($grafo);
    foreach ($grafo as $oid => $r) {
        if (isset($antes[$oid]) && $antes[$oid] === $r) { continue; }
        q_global('DELETE FROM organizacao_estrutura WHERE organizacao_id = ?', [$oid]);
        q_global('INSERT INTO organizacao_estrutura (organizacao_id, tipo, gerenciadora_id, atualizado_por, atualizado_em) VALUES (?, ?, ?, ?, ?)',
            [$oid, $r['tipo'], $r['gerenciadora_id'] ?: null, (int)($u['id'] ?? 0), planos_agora()]);
        registrar_global('empresa_tipo_vinculo', ['organizacao_id' => $oid, 'antes' => $antes[$oid] ?? null, 'depois' => $r]);
    }
}

function org_estrutura_resumo($id)
{
    $r = org_estrutura_ler($id);
    if (!$r['tipo_empresa']) { return 'Tipo ainda não definido'; }
    if ($r['tipo_empresa'] === 'EXECUTORA') { return 'Executora · ' . ($r['gerenciadora'] ? 'Gerenciadora: ' . $r['gerenciadora']['nome'] : 'Sem gerenciadora'); }
    return 'Gerenciadora · ' . ($r['executoras'] ? 'Executoras: ' . implode(', ', array_column($r['executoras'], 'nome')) : 'Executoras poderão ser adicionadas na obra');
}

/** Empresas executoras elegíveis para um espelho; o vínculo não cria espelhos sozinho. */
function org_espelho_opcoes($obraId, array $u)
{
    $org = (int)q_global('SELECT organizacao_id FROM obras WHERE id = ?', [(int)$obraId])->fetchColumn();
    if ($org > 0) {
        return q_global("SELECT o.id, o.nome FROM organizacoes o JOIN organizacao_estrutura e ON e.organizacao_id = o.id WHERE e.tipo = 'EXECUTORA' AND e.gerenciadora_id = ? ORDER BY o.nome", [$org])->fetchAll();
    }
    if (($u['perfil'] ?? '') === 'admin') {
        return q_global("SELECT o.id, o.nome FROM organizacoes o JOIN organizacao_estrutura e ON e.organizacao_id = o.id WHERE e.tipo = 'EXECUTORA' ORDER BY o.nome")->fetchAll();
    }
    return [];
}

function org_espelho_validar($obraId, $destino, array $u)
{
    if (!(int)$destino) { return 0; }
    foreach (org_espelho_opcoes($obraId, $u) as $o) {
        if ((int)$o['id'] === (int)$destino) {
            list($ok, $mensagem) = plano_verificar_usuario((int)$destino);
            if (!$ok) { throw new InvalidArgumentException($mensagem); }
            return (int)$destino;
        }
    }
    throw new InvalidArgumentException('A executora escolhida não está vinculada à gerenciadora desta obra.');
}

function org_estrutura_campos($id = 0, $publico = false)
{
    $r = $id ? org_estrutura_ler($id) : ['tipo_empresa' => '', 'gerenciadora_id' => 0, 'executoras_ids' => []];
    $empresas = $publico ? [] : q_global('SELECT o.id, o.nome, e.tipo FROM organizacoes o LEFT JOIN organizacao_estrutura e ON e.organizacao_id = o.id ORDER BY o.nome')->fetchAll();
    ?>
    <fieldset class="pl-fs" data-org-estrutura data-atual="<?= h(json_encode($r, JSON_UNESCAPED_UNICODE)) ?>" style="grid-column:1/-1">
      <legend>Tipo e vínculos da empresa</legend>
      <label>Tipo de empresa *<select name="tipo_empresa" required><option value="">Selecione…</option><option value="GERENCIADORA">Gerenciadora</option><option value="EXECUTORA">Executora</option></select></label>
      <div data-estrutura-executora><label>Gerenciadora (opcional)<select name="gerenciadora_id"><option value="0">Sem gerenciadora</option><?php foreach ($empresas as $o): if ((int)$o['id'] === (int)$id || ($o['tipo'] && $o['tipo'] !== 'GERENCIADORA')) continue; ?><option value="<?= (int)$o['id'] ?>"><?= h($o['nome']) ?></option><?php endforeach; ?></select></label><?php if ($publico): ?><p>Depois de entrar, o administrador pode vincular uma gerenciadora já cadastrada.</p><?php endif; ?></div>
      <div data-estrutura-gerenciadora>
        <?php if (!$publico): ?><label>Executoras gerenciadas<select name="executoras_ids[]" multiple size="5"><?php foreach ($empresas as $o): if ((int)$o['id'] === (int)$id || ($o['tipo'] && $o['tipo'] !== 'EXECUTORA')) continue; ?><option value="<?= (int)$o['id'] ?>"><?= h($o['nome']) ?></option><?php endforeach; ?></select></label><?php endif; ?>
        <p>As executoras podem ser adicionadas agora ou depois, ao cadastrar ou editar a obra. O vínculo aparecerá nas duas empresas.</p>
        <label><input type="checkbox" name="cadastrar_executora" value="1"> Cadastrar uma executora agora</label>
        <div data-estrutura-nova class="pl-form">
          <label>Nome da executora *<input name="nova_executora[nome]" maxlength="120" data-obrigatorio></label>
          <label>Documento<input name="nova_executora[documento]" maxlength="30"></label>
          <label>E-mail da executora<input type="email" name="nova_executora[email]"></label>
          <label>Contato<input name="nova_executora[contato]" maxlength="120"></label>
          <label>Telefone<input name="nova_executora[telefone]" maxlength="30"></label>
          <p>Cadastro inicial somente com os dados da empresa. O administrador e o plano podem ser definidos depois; nenhum login ou pagamento é criado aqui.</p>
        </div>
      </div>
      <p>Este vínculo não libera usuários em obras de outra empresa nem altera os espelhos existentes.</p>
    </fieldset>
    <script>
    window.orgEstruturaPreencher = function (form, d) {
      var box = form.querySelector('[data-org-estrutura]'); if (!box) return;
      box.querySelector('[name=tipo_empresa]').value = d.tipo_empresa || '';
      box.querySelector('[name=gerenciadora_id]').value = String(d.gerenciadora_id || 0);
      box.querySelectorAll('[name=gerenciadora_id] option,[name="executoras_ids[]"] option').forEach(function(o){o.disabled=Number(o.value)>0&&Number(o.value)===Number(d.organizacao_id||0);});
      box.querySelectorAll('[name="executoras_ids[]"] option').forEach(function(o){o.selected=(d.executoras_ids||[]).map(Number).indexOf(Number(o.value))>=0;});
      box.querySelector('[name=cadastrar_executora]').checked = false;
      box.dispatchEvent(new Event('change'));
    };
    (function(){
      var boxes=document.querySelectorAll('[data-org-estrutura]');
      boxes.forEach(function(box){if(box.dataset.pronto)return;box.dataset.pronto='1';
        function grupo(sel,visivel){var g=box.querySelector(sel);g.hidden=!visivel;g.querySelectorAll('input,select').forEach(function(el){el.disabled=!visivel;el.required=visivel&&el.hasAttribute('data-obrigatorio');});}
        function sync(){var ger=box.querySelector('[name=tipo_empresa]').value==='GERENCIADORA';grupo('[data-estrutura-executora]',!ger);grupo('[data-estrutura-gerenciadora]',ger);grupo('[data-estrutura-nova]',ger&&box.querySelector('[name=cadastrar_executora]').checked);}
        box.addEventListener('change',sync);orgEstruturaPreencher(box.closest('form'),JSON.parse(box.dataset.atual));
      });
    })();
    </script>
    <?php
}
