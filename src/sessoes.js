const session = require('express-session');

/**
 * Guarda as sessões de login na tabela `sessoes` (SQLite local ou Turso).
 * No Render gratuito o servidor reinicia quando "dorme" ou recebe atualização;
 * com as sessões no banco, ninguém precisa entrar de novo depois disso.
 */
class SessoesNoBanco extends session.Store {
  constructor(db) {
    super();
    this.db = db;
  }

  get(sid, cb) {
    this.db.get('SELECT dados, expira FROM sessoes WHERE sid = ?', sid)
      .then((r) => {
        if (!r) return cb(null, null);
        if (Number(r.expira) < Date.now()) return this.destroy(sid, () => cb(null, null));
        cb(null, JSON.parse(r.dados));
      })
      .catch(cb);
  }

  set(sid, sess, cb = () => {}) {
    const expira = sess.cookie?.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + 1000 * 60 * 60 * 24;
    this.db.run(`INSERT INTO sessoes (sid, dados, expira) VALUES (?, ?, ?)
                 ON CONFLICT(sid) DO UPDATE SET dados = excluded.dados, expira = excluded.expira`,
      sid, JSON.stringify(sess), expira)
      .then(() => {
        // De vez em quando, apaga sessões vencidas
        if (Math.random() < 0.05) this.db.run('DELETE FROM sessoes WHERE expira < ?', Date.now()).catch(() => {});
        cb(null);
      })
      .catch(cb);
  }

  destroy(sid, cb = () => {}) {
    this.db.run('DELETE FROM sessoes WHERE sid = ?', sid).then(() => cb(null)).catch(cb);
  }
}

module.exports = { SessoesNoBanco };
