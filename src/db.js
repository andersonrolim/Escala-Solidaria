const path = require('path');
const fs = require('fs');

// O módulo nativo node:sqlite (Node 22.13+) dispensa instalar/compilar driver de banco.
// Em algumas versões ele mostra um aviso "experimental"; escondemos só esse aviso.
const emitirAviso = process.emitWarning;
process.emitWarning = (aviso, ...resto) => {
  if (String(aviso?.message ?? aviso).includes('SQLite is an experimental')) return;
  return emitirAviso.call(process, aviso, ...resto);
};
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS usuarios (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  nome        TEXT    NOT NULL,
  email       TEXT    NOT NULL UNIQUE,
  senha_hash  TEXT    NOT NULL,
  telefone    TEXT,
  tipo        TEXT    NOT NULL CHECK (tipo IN ('voluntario', 'ong')),
  criado_em   TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS ongs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id  INTEGER NOT NULL UNIQUE REFERENCES usuarios(id) ON DELETE CASCADE,
  nome        TEXT    NOT NULL,
  descricao   TEXT,
  endereco    TEXT,
  cidade      TEXT,
  criado_em   TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS turnos (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  ong_id             INTEGER NOT NULL REFERENCES ongs(id) ON DELETE CASCADE,
  titulo             TEXT    NOT NULL,
  categoria          TEXT    NOT NULL,
  descricao          TEXT,
  requisitos         TEXT,
  data               TEXT    NOT NULL,             -- AAAA-MM-DD
  hora_inicio        TEXT    NOT NULL,             -- HH:MM
  hora_fim           TEXT    NOT NULL,             -- HH:MM
  online             INTEGER NOT NULL DEFAULT 0,
  endereco           TEXT,
  vagas              INTEGER NOT NULL CHECK (vagas > 0),
  lembrete_whatsapp  INTEGER NOT NULL DEFAULT 1,
  lembrete_email     INTEGER NOT NULL DEFAULT 1,
  lista_espera       INTEGER NOT NULL DEFAULT 0,
  status             TEXT    NOT NULL DEFAULT 'publicado'
                     CHECK (status IN ('rascunho', 'publicado', 'cancelado')),
  criado_em          TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS inscricoes (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  turno_id       INTEGER NOT NULL REFERENCES turnos(id) ON DELETE CASCADE,
  voluntario_id  INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  status         TEXT    NOT NULL CHECK (status IN ('confirmada', 'espera', 'cancelada')),
  presenca       TEXT    NOT NULL DEFAULT 'aguardando'
                 CHECK (presenca IN ('aguardando', 'presente', 'ausente')),
  codigo         TEXT    NOT NULL UNIQUE,           -- código do QR de check-in
  checkin_em     TEXT,
  criado_em      TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
  atualizado_em  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
  UNIQUE (turno_id, voluntario_id)
);

CREATE TABLE IF NOT EXISTS notificacoes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  inscricao_id  INTEGER NOT NULL REFERENCES inscricoes(id) ON DELETE CASCADE,
  canal         TEXT    NOT NULL CHECK (canal IN ('whatsapp', 'email')),
  tipo          TEXT    NOT NULL CHECK (tipo IN ('lembrete_24h', 'promovido_espera')),
  mensagem      TEXT    NOT NULL,
  enviado_em    TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
  UNIQUE (inscricao_id, canal, tipo)
);

-- ===== Módulo de doações =====

-- Itens que a ONG precisa receber (ex.: "Fraldas tamanho G", meta 200 pacotes)
CREATE TABLE IF NOT EXISTS necessidades (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ong_id      INTEGER NOT NULL REFERENCES ongs(id) ON DELETE CASCADE,
  nome        TEXT    NOT NULL,
  categoria   TEXT    NOT NULL,
  unidade     TEXT    NOT NULL,                 -- pacote, kg, unidade, litro, caixa
  meta        INTEGER NOT NULL CHECK (meta > 0),
  urgente     INTEGER NOT NULL DEFAULT 0,
  descricao   TEXT,
  ativa       INTEGER NOT NULL DEFAULT 1,
  criado_em   TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- Doação de itens: o doador promete, a ONG confirma quando recebe
CREATE TABLE IF NOT EXISTS doacoes_itens (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  necessidade_id   INTEGER NOT NULL REFERENCES necessidades(id) ON DELETE CASCADE,
  doador_id        INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  quantidade       INTEGER NOT NULL CHECK (quantidade > 0),
  status           TEXT    NOT NULL DEFAULT 'prometida' CHECK (status IN ('prometida', 'entregue', 'cancelada')),
  previsao_entrega TEXT,
  observacao       TEXT,
  criado_em        TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
  entregue_em      TEXT
);

-- Doação em dinheiro via PIX: o doador informa, a ONG confere no extrato e confirma
CREATE TABLE IF NOT EXISTS doacoes_pix (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ong_id          INTEGER NOT NULL REFERENCES ongs(id) ON DELETE CASCADE,
  doador_id       INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  valor_centavos  INTEGER NOT NULL CHECK (valor_centavos > 0),
  status          TEXT    NOT NULL DEFAULT 'informada' CHECK (status IN ('informada', 'confirmada', 'recusada')),
  mensagem        TEXT,
  recibo_numero   TEXT    UNIQUE,                -- gerado na confirmação (ex.: REC-2026-000012)
  criado_em       TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
  confirmado_em   TEXT
);

CREATE INDEX IF NOT EXISTS idx_turnos_data ON turnos (data, hora_inicio);
CREATE INDEX IF NOT EXISTS idx_necessidades_ong ON necessidades (ong_id);
CREATE INDEX IF NOT EXISTS idx_doacoes_itens_doador ON doacoes_itens (doador_id);
CREATE INDEX IF NOT EXISTS idx_doacoes_pix_doador ON doacoes_pix (doador_id);
CREATE INDEX IF NOT EXISTS idx_turnos_ong ON turnos (ong_id);
CREATE INDEX IF NOT EXISTS idx_inscricoes_vol ON inscricoes (voluntario_id);
`;

/**
 * Migração simples: adiciona à tabela `ongs` as colunas do módulo de doações
 * (para bancos criados antes desse módulo existir).
 */
function migrar(db) {
  const colunas = db.prepare('PRAGMA table_info(ongs)').all().map((c) => c.name);
  const novas = {
    historia: 'TEXT', cnpj: 'TEXT', whatsapp: 'TEXT',
    pix_tipo: 'TEXT', pix_chave: 'TEXT', pix_nome: 'TEXT', pix_cidade: 'TEXT'
  };
  for (const [nome, tipo] of Object.entries(novas)) {
    if (!colunas.includes(nome)) db.exec(`ALTER TABLE ongs ADD COLUMN ${nome} ${tipo}`);
  }
}

/**
 * Abre (ou cria) o banco SQLite e aplica o schema.
 * @param {string} arquivo caminho do arquivo .db ou ':memory:' (usado nos testes)
 */
function abrirBanco(arquivo = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'escala.db')) {
  if (arquivo !== ':memory:') fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  const db = new DatabaseSync(arquivo);
  if (arquivo !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
  migrar(db);

  /**
   * db.transaction(fn) devolve uma função que executa `fn` dentro de
   * BEGIN/COMMIT, desfazendo tudo (ROLLBACK) se der erro.
   * Transações aninhadas apenas reaproveitam a transação externa.
   */
  let profundidade = 0;
  db.transaction = (fn) => (...args) => {
    if (profundidade > 0) return fn(...args);
    db.exec('BEGIN');
    profundidade++;
    try {
      const r = fn(...args);
      db.exec('COMMIT');
      return r;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    } finally {
      profundidade--;
    }
  };
  return db;
}

module.exports = { abrirBanco };
