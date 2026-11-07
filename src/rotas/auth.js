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

  const sessaoDe = async (usuario) => {
    const ong = usuario.tipo === 'ong' ? (await db.get('SELECT id, nome FROM ongs WHERE usuario_id = ?', usuario.id)) : null;
    return { id: usuario.id, nome: usuario.nome, email: usuario.email, tipo: usuario.tipo, ongId: ong?.id ?? null, ongNome: ong?.nome ?? null };
  };

  r.post('/register', async (req, res) => {
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
    if ((await db.get('SELECT 1 FROM usuarios WHERE email = ?', email))) throw new ErroHttp(409, 'Já existe uma conta com este e-mail.');

    const usuario = await db.transaction(async () => {
      const info = (await db.run('INSERT INTO usuarios (nome, email, senha_hash, telefone, tipo) VALUES (?, ?, ?, ?, ?)', nome, email, bcrypt.hashSync(senha, 10), telefone, tipo));
      if (tipo === 'ong') {
        (await db.run('INSERT INTO ongs (usuario_id, nome, cidade) VALUES (?, ?, ?)', info.lastInsertRowid, ongNome, String(req.body.cidade || '').trim()));
      }
      return (await db.get('SELECT * FROM usuarios WHERE id = ?', info.lastInsertRowid));
    })();

    req.session.usuario = await sessaoDe(usuario);
    res.status(201).json({ usuario: req.session.usuario });
  });

  r.post('/login', async (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const usuario = (await db.get('SELECT * FROM usuarios WHERE email = ?', email));
    if (!usuario || !bcrypt.compareSync(String(req.body.senha || ''), usuario.senha_hash)) {
      throw new ErroHttp(401, 'E-mail ou senha incorretos.');
    }
    const dados = await sessaoDe(usuario);
    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ erro: 'Erro ao iniciar sessão.' });
      req.session.usuario = dados;
      res.json({ usuario: req.session.usuario });
    });
  });

  r.post('/logout', async (req, res) => {
    req.session.destroy(() => res.json({ ok: true }));
  });

  r.get('/me', exigir(), async (req, res) => {
    const usuario = await db.get('SELECT id, nome, email, telefone, tipo FROM usuarios WHERE id = ?', req.session.usuario.id);
    if (!usuario) throw new ErroHttp(404, 'Conta não encontrada.');
    const ong = usuario.tipo === 'ong' ? await db.get('SELECT id, nome FROM ongs WHERE usuario_id = ?', usuario.id) : null;
    res.json({ usuario: { ...usuario, ongId: ong?.id ?? null, ongNome: ong?.nome ?? null } });
  });

  r.put('/me', exigir(), async (req, res) => {
    const id = req.session.usuario.id;
    const nome = String(req.body.nome || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const telefone = String(req.body.telefone || '').trim();
    const senhaAtual = String(req.body.senha_atual || '');
    const novaSenha = String(req.body.nova_senha || '');
    const erros = [];

    if (nome.length < 2 || nome.length > 120) erros.push('O nome deve ter entre 2 e 120 caracteres.');
    if (!RE_EMAIL.test(email) || email.length > 254) erros.push('Informe um e-mail válido.');
    if (telefone.length > 30) erros.push('O telefone deve ter no máximo 30 caracteres.');
    if (Boolean(senhaAtual) !== Boolean(novaSenha)) erros.push('Para trocar a senha, informe a senha atual e a nova senha.');
    if (novaSenha && novaSenha.length < 6) erros.push('A nova senha precisa ter pelo menos 6 caracteres.');
    if (erros.length) throw new ErroHttp(400, erros.join(' '));

    const existente = await db.get('SELECT id FROM usuarios WHERE email = ? AND id != ?', email, id);
    if (existente) throw new ErroHttp(409, 'Já existe uma conta com este e-mail.');

    const usuarioAtual = await db.get('SELECT senha_hash FROM usuarios WHERE id = ?', id);
    if (!usuarioAtual) throw new ErroHttp(404, 'Conta não encontrada.');
    if (senhaAtual && !bcrypt.compareSync(senhaAtual, usuarioAtual.senha_hash)) {
      throw new ErroHttp(401, 'A senha atual está incorreta.');
    }

    if (novaSenha) {
      await db.run('UPDATE usuarios SET nome = ?, email = ?, telefone = ?, senha_hash = ? WHERE id = ?',
        nome, email, telefone, bcrypt.hashSync(novaSenha, 10), id);
    } else {
      await db.run('UPDATE usuarios SET nome = ?, email = ?, telefone = ? WHERE id = ?', nome, email, telefone, id);
    }

    const ong = req.session.usuario.tipo === 'ong'
      ? await db.get('SELECT id, nome FROM ongs WHERE usuario_id = ?', id)
      : null;
    req.session.usuario = {
      ...req.session.usuario,
      nome,
      email,
      telefone,
      ongId: ong?.id ?? null,
      ongNome: ong?.nome ?? null
    };
    res.json({ usuario: req.session.usuario });
  });

  return r;
}

module.exports = { rotasAuth, exigir };
