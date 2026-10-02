-- Migração de referência para MariaDB/MySQL.
-- O sistema executa esta migração automaticamente no primeiro acesso.
-- Faça backup do banco antes de qualquer alteração manual.

CREATE TABLE IF NOT EXISTS obras (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(150) NOT NULL,
  codigo VARCHAR(50) NULL,
  cliente VARCHAR(150) NULL,
  cidade VARCHAR(150) NULL,
  data_inicio DATE NULL,
  data_fim DATE NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'ativa',
  cor_primaria VARCHAR(20) NULL,
  cor_secundaria VARCHAR(20) NULL,
  logo MEDIUMTEXT NULL,
  criado_em VARCHAR(19) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS usuarios_obras (
  usuario_id INT NOT NULL,
  obra_id INT NOT NULL,
  PRIMARY KEY (usuario_id, obra_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS obra_config (
  obra_id INT NOT NULL,
  chave VARCHAR(50) NOT NULL,
  valor MEDIUMTEXT NULL,
  PRIMARY KEY (obra_id, chave)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS config_global (
  chave VARCHAR(50) PRIMARY KEY,
  valor MEDIUMTEXT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS auditoria_global (
  id INT AUTO_INCREMENT PRIMARY KEY,
  quando VARCHAR(19) NOT NULL,
  usuario VARCHAR(50) NULL,
  acao VARCHAR(50) NOT NULL,
  detalhe TEXT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO obras (nome,codigo,data_inicio,data_fim,status,cor_primaria,cor_secundaria,criado_em)
SELECT COALESCE((SELECT valor FROM sistema WHERE chave='obra_nome'),'Obra principal'),
       'OBRA-001',(SELECT valor FROM sistema WHERE chave='data_inicio'),
       (SELECT valor FROM sistema WHERE chave='data_fim'),'ativa','#d97706','#111827',NOW()
WHERE NOT EXISTS (SELECT 1 FROM obras);

ALTER TABLE empresas ADD COLUMN IF NOT EXISTS obra_id INT NOT NULL DEFAULT 1;
ALTER TABLE servicos ADD COLUMN IF NOT EXISTS obra_id INT NOT NULL DEFAULT 1;
ALTER TABLE producao ADD COLUMN IF NOT EXISTS obra_id INT NOT NULL DEFAULT 1;
ALTER TABLE metas ADD COLUMN IF NOT EXISTS obra_id INT NOT NULL DEFAULT 1;
ALTER TABLE cliente ADD COLUMN IF NOT EXISTS obra_id INT NOT NULL DEFAULT 1;
ALTER TABLE impactos ADD COLUMN IF NOT EXISTS obra_id INT NOT NULL DEFAULT 1;
ALTER TABLE historico ADD COLUMN IF NOT EXISTS obra_id INT NOT NULL DEFAULT 1;
ALTER TABLE materiais ADD COLUMN IF NOT EXISTS obra_id INT NOT NULL DEFAULT 1;
ALTER TABLE movimentos ADD COLUMN IF NOT EXISTS obra_id INT NOT NULL DEFAULT 1;
ALTER TABLE equipamentos ADD COLUMN IF NOT EXISTS obra_id INT NOT NULL DEFAULT 1;
ALTER TABLE usos ADD COLUMN IF NOT EXISTS obra_id INT NOT NULL DEFAULT 1;
ALTER TABLE bm_atividades ADD COLUMN IF NOT EXISTS obra_id INT NOT NULL DEFAULT 1;
ALTER TABLE bm_periodos ADD COLUMN IF NOT EXISTS obra_id INT NOT NULL DEFAULT 1;
ALTER TABLE bm_apontamentos ADD COLUMN IF NOT EXISTS obra_id INT NOT NULL DEFAULT 1;
ALTER TABLE bm_deducoes ADD COLUMN IF NOT EXISTS obra_id INT NOT NULL DEFAULT 1;
ALTER TABLE bm_fechamentos ADD COLUMN IF NOT EXISTS obra_id INT NOT NULL DEFAULT 1;
ALTER TABLE bm_fech_atividades ADD COLUMN IF NOT EXISTS obra_id INT NOT NULL DEFAULT 1;
ALTER TABLE estoque_eventos ADD COLUMN IF NOT EXISTS obra_id INT NOT NULL DEFAULT 1;
ALTER TABLE estoque_remessas ADD COLUMN IF NOT EXISTS obra_id INT NOT NULL DEFAULT 1;
ALTER TABLE estoque_inventario ADD COLUMN IF NOT EXISTS obra_id INT NOT NULL DEFAULT 1;
ALTER TABLE apontamentos ADD COLUMN IF NOT EXISTS obra_id INT NOT NULL DEFAULT 1;

INSERT IGNORE INTO usuarios_obras (usuario_id,obra_id)
SELECT id,(SELECT id FROM obras ORDER BY id LIMIT 1) FROM usuarios;

INSERT IGNORE INTO config_global (chave,valor) VALUES
('nome_sistema','Núcleo de Obras'),('cor_primaria','#d97706'),
('cor_secundaria','#111827'),('cor_fundo','#f4f6f8'),('logo','');

INSERT IGNORE INTO obra_config (obra_id,chave,valor)
SELECT (SELECT id FROM obras ORDER BY id LIMIT 1),chave,valor
FROM sistema WHERE chave IN ('obra_nome','data_inicio','data_fim','referencia','versao','modificado','estoque_externo','estoque_planilha');

INSERT IGNORE INTO obra_config (obra_id,chave,valor)
SELECT id,'dados_legados','1' FROM obras ORDER BY id LIMIT 1;
