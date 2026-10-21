/**
 * Camada de banco de dados — sempre SQLite, em dois lugares:
 *
 * - No computador (padrão): arquivo `data/escala.db`, pelo módulo nativo node:sqlite (Node 22.13+).
 * - Em produção (Render): **Turso**, um SQLite na nuvem. Basta definir as variáveis
 *   TURSO_DATABASE_URL (libsql://…) e TURSO_AUTH_TOKEN. Isso é necessário porque o disco
 *   do plano gratuito do Render é apagado a cada reinício ou atualização.
 *
 * As duas versões usam o MESMO SQL e expõem a mesma interface assíncrona:
 *   await db.get(sql, ...params)   → primeira linha (ou undefined)
 *   await db.all(sql, ...params)   → todas as linhas
 *   await db.run(sql, ...params)   → { changes, lastInsertRowid }
 *   await db.exec(sql)             → executa vários comandos
 *   db.transaction(async fn)       → função que roda fn dentro de BEGIN/COMMIT
 *   db.AGORA                       → expressão SQL de "agora" no horário de Brasília (texto AAAA-MM-DD HH:MM:SS)
 * Parâmetros: `?` posicionais ou `@nome` com um objeto.
 */
const path = require('path');
const fs = require('fs');
const { AsyncLocalStorage } = require('async_hooks');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS usuarios (
  id          {{ID}},
  nome        TEXT    NOT NULL,
  email       TEXT    NOT NULL UNIQUE,
  senha_hash  TEXT    NOT NULL,
  telefone    TEXT,
  tipo        TEXT    NOT NULL CHECK (tipo IN ('voluntario', 'ong')),
  criado_em   TEXT    NOT NULL DEFAULT {{AGORA}}
);

CREATE TABLE IF NOT EXISTS ongs (
  id          {{ID}},
  usuario_id  INTEGER NOT NULL UNIQUE REFERENCES usuarios(id) ON DELETE CASCADE,
  nome        TEXT    NOT NULL,
  descricao   TEXT,
  endereco    TEXT,
  cidade      TEXT,
  historia    TEXT,
  cnpj        TEXT,
  whatsapp    TEXT,
  pix_tipo    TEXT,
  pix_chave   TEXT,
  pix_nome    TEXT,
  pix_cidade  TEXT,
  criado_em   TEXT    NOT NULL DEFAULT {{AGORA}}
);

CREATE TABLE IF NOT EXISTS turnos (
  id                 {{ID}},
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
  criado_em          TEXT    NOT NULL DEFAULT {{AGORA}}
);

CREATE TABLE IF NOT EXISTS inscricoes (
  id             {{ID}},
  turno_id       INTEGER NOT NULL REFERENCES turnos(id) ON DELETE CASCADE,
  voluntario_id  INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  status         TEXT    NOT NULL CHECK (status IN ('confirmada', 'espera', 'cancelada')),
  presenca       TEXT    NOT NULL DEFAULT 'aguardando'
                 CHECK (presenca IN ('aguardando', 'presente', 'ausente')),
  codigo         TEXT    NOT NULL UNIQUE,           -- código do QR de check-in
  checkin_em     TEXT,
  criado_em      TEXT    NOT NULL DEFAULT {{AGORA}},
  atualizado_em  TEXT    NOT NULL DEFAULT {{AGORA}},
  UNIQUE (turno_id, voluntario_id)
);

CREATE TABLE IF NOT EXISTS notificacoes (
  id            {{ID}},
  inscricao_id  INTEGER NOT NULL REFERENCES inscricoes(id) ON DELETE CASCADE,
  canal         TEXT    NOT NULL CHECK (canal IN ('whatsapp', 'email')),
  tipo          TEXT    NOT NULL CHECK (tipo IN ('lembrete_24h', 'promovido_espera')),
  mensagem      TEXT    NOT NULL,
  enviado_em    TEXT    NOT NULL DEFAULT {{AGORA}},
  UNIQUE (inscricao_id, canal, tipo)
);

-- ===== Módulo de doações =====

-- Itens que a ONG precisa receber (ex.: "Fraldas tamanho G", meta 200 pacotes)
CREATE TABLE IF NOT EXISTS necessidades (
  id          {{ID}},
  ong_id      INTEGER NOT NULL REFERENCES ongs(id) ON DELETE CASCADE,
  nome        TEXT    NOT NULL,
  categoria   TEXT    NOT NULL,
  unidade     TEXT    NOT NULL,                 -- pacote, kg, unidade, litro, caixa
  meta        INTEGER NOT NULL CHECK (meta > 0),
  urgente     INTEGER NOT NULL DEFAULT 0,
  descricao   TEXT,
  ativa       INTEGER NOT NULL DEFAULT 1,
  criado_em   TEXT    NOT NULL DEFAULT {{AGORA}}
);

-- Doação de itens: o doador promete, a ONG confirma quando recebe
CREATE TABLE IF NOT EXISTS doacoes_itens (
  id               {{ID}},
  necessidade_id   INTEGER NOT NULL REFERENCES necessidades(id) ON DELETE CASCADE,
  doador_id        INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  quantidade       INTEGER NOT NULL CHECK (quantidade > 0),
  status           TEXT    NOT NULL DEFAULT 'prometida' CHECK (status IN ('prometida', 'entregue', 'cancelada')),
  previsao_entrega TEXT,
  observacao       TEXT,
  criado_em        TEXT    NOT NULL DEFAULT {{AGORA}},
  entregue_em      TEXT
);

-- Doação em dinheiro via PIX: o doador informa, a ONG confere no extrato e confirma
CREATE TABLE IF NOT EXISTS doacoes_pix (
  id              {{ID}},
  ong_id          INTEGER NOT NULL REFERENCES ongs(id) ON DELETE CASCADE,
  doador_id       INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  valor_centavos  INTEGER NOT NULL CHECK (valor_centavos > 0),
  status          TEXT    NOT NULL DEFAULT 'informada' CHECK (status IN ('informada', 'confirmada', 'recusada')),
  mensagem        TEXT,
  recibo_numero   TEXT    UNIQUE,                -- gerado na confirmação (ex.: REC-2026-000012)
  criado_em       TEXT    NOT NULL DEFAULT {{AGORA}},
  confirmado_em   TEXT
);

CREATE INDEX IF NOT EXISTS idx_turnos_data ON turnos (data, hora_inicio);
CREATE INDEX IF NOT EXISTS idx_turnos_ong ON turnos (ong_id);
CREATE INDEX IF NOT EXISTS idx_inscricoes_vol ON inscricoes (voluntario_id);
CREATE INDEX IF NOT EXISTS idx_necessidades_ong ON necessidades (ong_id);
CREATE INDEX IF NOT EXISTS idx_doacoes_itens_doador ON doacoes_itens (doador_id);
CREATE INDEX IF NOT EXISTS idx_doacoes_pix_doador ON doacoes_pix (doador_id);
`;

const TABELAS = ['doacoes_pix', 'doacoes_itens', 'necessidades', 'notificacoes', 'inscricoes', 'turnos', 'ongs', 'usuarios'];
const COLUNAS_NOVAS_ONG = ['historia', 'cnpj', 'whatsapp', 'pix_tipo', 'pix_chave', 'pix_nome', 'pix_cidade'];

// ------------------------------------------------------------------ SQLite
function abrirSqlite(arquivo) {
  // Esconde só o aviso "experimental" do node:sqlite
  const emitirAviso = process.emitWarning;
  process.emitWarning = (aviso, ...resto) => {
    if (String(aviso?.message ?? aviso).includes('SQLite is an experimental')) return;
    return emitirAviso.call(process, aviso, ...resto);
  };
  const { DatabaseSync } = require('node:sqlite');

  if (arquivo !== ':memory:') fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  const conn = new DatabaseSync(arquivo);
  if (arquivo !== ':memory:') conn.exec('PRAGMA journal_mode = WAL');
  conn.exec('PRAGMA foreign_keys = ON');

  const args = (params) => params.map((v) => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : v));
  const linha = (r) => (r ? { ...r } : r);
  let profundidade = 0;

  const db = {
    dialeto: 'sqlite',
    AGORA: `(datetime('now', 'localtime'))`,  // horário local do computador (no Render, defina TZ=America/Sao_Paulo)
    async get(sql, ...p) { return linha(conn.prepare(sql).get(...args(p))); },
    async all(sql, ...p) { return conn.prepare(sql).all(...args(p)).map(linha); },
    async run(sql, ...p) {
      const r = conn.prepare(sql).run(...args(p));
      return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
    },
    async exec(sql) { conn.exec(sql); },
    transaction(fn) {
      return async (...a) => {
        if (profundidade > 0) return fn(...a);
        conn.exec('BEGIN');
        profundidade++;
        try {
          const r = await fn(...a);
          conn.exec('COMMIT');
          return r;
        } catch (e) {
          conn.exec('ROLLBACK');
          throw e;
        } finally {
          profundidade--;
        }
      };
    },
    async fechar() { conn.close(); },
    async criarSchema() {
      conn.exec(SCHEMA.replaceAll('{{ID}}', 'INTEGER PRIMARY KEY AUTOINCREMENT').replaceAll('{{AGORA}}', `(datetime('now', 'localtime'))`));
      // Migração: bancos criados antes do módulo de doações
      const cols = conn.prepare('PRAGMA table_info(ongs)').all().map((c) => c.name);
      for (const c of COLUNAS_NOVAS_ONG) if (!cols.includes(c)) conn.exec(`ALTER TABLE ongs ADD COLUMN ${c} TEXT`);
    }
  };
  return db;
}

// ------------------------------------------------------------- Turso (libSQL)
/**
 * O servidor do Turso roda em UTC. O Brasil não tem horário de verão desde 2019,
 * então "agora em Brasília" = UTC − 3 horas.
 */
const AGORA_TURSO = `(datetime('now', '-3 hours'))`;

function abrirTurso(url, authToken) {
  // URL remota → cliente 100% JavaScript (sem módulo nativo); file: → cliente completo (usado nos testes)
  const { createClient } = url.startsWith('file:') ? require('@libsql/client') : require('@libsql/client/web');
  const conn = createClient({ url, authToken });
  const transacao = new AsyncLocalStorage();
  const alvo = () => transacao.getStore() || conn;

  const args = (params) => {
    if (params.length === 1 && params[0] && typeof params[0] === 'object' && !Array.isArray(params[0])) {
      const o = {};
      for (const [k, v] of Object.entries(params[0])) o[k] = v === undefined ? null : typeof v === 'boolean' ? Number(v) : v;
      return o;
    }
    return params.map((v) => (v === undefined || Number.isNaN(v) ? null : typeof v === 'boolean' ? Number(v) : v));
  };
  const linhas = (r) => r.rows.map((row) => Object.fromEntries(r.columns.map((c) => [c, row[c]])));
  const executar = (sql, p) => alvo().execute({ sql, args: args(p) });

  const db = {
    dialeto: 'turso',
    AGORA: AGORA_TURSO,
    async get(sql, ...p) { return linhas(await executar(sql, p))[0]; },
    async all(sql, ...p) { return linhas(await executar(sql, p)); },
    async run(sql, ...p) {
      const r = await executar(sql, p);
      return { changes: r.rowsAffected, lastInsertRowid: r.lastInsertRowid === undefined ? undefined : Number(r.lastInsertRowid) };
    },
    async exec(sql) {
      if (transacao.getStore()) { for (const cmd of sql.split(';').map((x) => x.trim()).filter(Boolean)) await transacao.getStore().execute(cmd); return; }
      await conn.executeMultiple(sql);
    },
    transaction(fn) {
      return async (...a) => {
        if (transacao.getStore()) return fn(...a);
        const tx = await conn.transaction('write');
        try {
          const r = await transacao.run(tx, () => fn(...a));
          await tx.commit();
          return r;
        } catch (e) {
          await tx.rollback().catch(() => {});
          throw e;
        } finally {
          tx.close();
        }
      };
    },
    async fechar() { conn.close(); },
    async criarSchema() {
      await conn.execute('PRAGMA foreign_keys = ON');
      await conn.executeMultiple(SCHEMA.replaceAll('{{ID}}', 'INTEGER PRIMARY KEY AUTOINCREMENT').replaceAll('{{AGORA}}', AGORA_TURSO));
      const cols = (await conn.execute('PRAGMA table_info(ongs)')).rows.map((c) => c.name);
      for (const c of COLUNAS_NOVAS_ONG) if (!cols.includes(c)) await conn.execute(`ALTER TABLE ongs ADD COLUMN ${c} TEXT`);
    }
  };
  return db;
}

/**
 * Abre o banco e garante que as tabelas existem.
 * @param {string} [destino] ':memory:', caminho de arquivo, ou URL do Turso (libsql://, https://, file:)
 * @param {string} [token]   token do Turso
 */
async function abrirBanco(
  destino = process.env.TURSO_DATABASE_URL || process.env.DB_FILE || path.join(__dirname, '..', 'data', 'escala.db'),
  token = process.env.TURSO_AUTH_TOKEN
) {
  const remoto = /^(libsql|https?|wss?|file):/i.test(destino);
  const db = remoto ? abrirTurso(destino, token) : abrirSqlite(destino);
  await db.criarSchema();
  return db;
}

/** Apaga todas as tabelas e recria vazias (usado pelo `npm run seed`). */
async function apagarTudo(db) {
  for (const t of TABELAS) await db.exec(`DROP TABLE IF EXISTS ${t}`);
  await db.criarSchema();
}

module.exports = { abrirBanco, apagarTudo };
