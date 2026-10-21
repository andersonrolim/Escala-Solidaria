const express = require('express');
const bcrypt = require('bcryptjs');
const { ErroHttp, RE_EMAIL } = require('../utils');

/** Middleware: exige usuário logado (e, opcionalmente, de um tipo). */
function exigir(tipo) {
  return (req, res, next) => {
    const u = req.session.usuario;
    if (!u) return res.status(401).json({ erro: 'Faça login para continuar.' });
    if (tipo && u.tipo !== tipo) return res.status(403).json({ erro: 'Você não tem permissão para esta ação.' });
    next();
  };
}

function rotasAuth(db) {
  const r = express.Router();

  const sessaoDe = (usuario) => {
    const ong = usuario.tipo === 'ong' ? db.prepare('SELECT id, nome FROM ongs WHERE usuario_id = ?').get(usuario.id) : null;
    return { id: usuario.id, nome: usuario.nome, email: usuario.email, tipo: usuario.tipo, ongId: ong?.id ?? null, ongNome: ong?.nome ?? null };
  };

  r.post('/register', (req, res) => {
    const nome = String(req.body.nome || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const senha = String(req.body.senha || '');
    const telefone = String(req.body.telefone || '').trim();
    const tipo = req.body.tipo === 'ong' ? 'ong' : 'voluntario';
    const ongNome = String(req.body.ong_nome || '').trim();

    const erros = [];
    if (nome.length < 2) erros.push('Informe seu nome.');
    if (!RE_EMAIL.test(email)) erros.push('E-mail inválido.');
    if (senha.length < 6) erros.push('A senha precisa ter pelo menos 6 caracteres.');
    if (tipo === 'ong' && ongNome.length < 2) erros.push('Informe o nome da ONG.');
    if (erros.length) throw new ErroHttp(400, erros.join(' '));
    if (db.prepare('SELECT 1 FROM usuarios WHERE email = ?').get(email)) throw new ErroHttp(409, 'Já existe uma conta com este e-mail.');

    const usuario = db.transaction(() => {
      const info = db.prepare('INSERT INTO usuarios (nome, email, senha_hash, telefone, tipo) VALUES (?, ?, ?, ?, ?)')
        .run(nome, email, bcrypt.hashSync(senha, 10), telefone, tipo);
      if (tipo === 'ong') {
        db.prepare('INSERT INTO ongs (usuario_id, nome, cidade) VALUES (?, ?, ?)').run(info.lastInsertRowid, ongNome, String(req.body.cidade || '').trim());
      }
      return db.prepare('SELECT * FROM usuarios WHERE id = ?').get(info.lastInsertRowid);
    })();

    req.session.usuario = sessaoDe(usuario);
    res.status(201).json({ usuario: req.session.usuario });
  });

  r.post('/login', (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const usuario = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(email);
    if (!usuario || !bcrypt.compareSync(String(req.body.senha || ''), usuario.senha_hash)) {
      throw new ErroHttp(401, 'E-mail ou senha incorretos.');
    }
    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ erro: 'Erro ao iniciar sessão.' });
      req.session.usuario = sessaoDe(usuario);
      res.json({ usuario: req.session.usuario });
    });
  });

  r.post('/logout', (req, res) => {
    req.session.destroy(() => res.json({ ok: true }));
  });

  r.get('/me', exigir(), (req, res) => res.json({ usuario: req.session.usuario }));

  return r;
}

module.exports = { rotasAuth, exigir };
