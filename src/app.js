const express = require('express');
const session = require('express-session');
const path = require('path');
const { rotasAuth } = require('./rotas/auth');
const { rotasTurnos, rotasMe } = require('./rotas/voluntario');
const { rotasOng } = require('./rotas/ong');
const { rotasDoacoes, rotasDoacoesOng } = require('./rotas/doacoes');

/**
 * Monta a aplicação Express. Recebe o banco por parâmetro para
 * facilitar os testes (que usam um banco em memória).
 */
function criarApp(db, { segredoSessao = process.env.SESSION_SECRET || 'troque-este-segredo-em-producao' } = {}) {
  const app = express();

  app.use(express.json({ limit: '100kb' }));
  app.use(session({
    secret: segredoSessao,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 8 }
  }));

  app.use('/api/auth', rotasAuth(db));
  app.use('/api/turnos', rotasTurnos(db));
  app.use('/api/me', rotasMe(db));
  app.use('/api/ong', rotasOng(db));
  app.use('/api/ong', rotasDoacoesOng(db));
  app.use('/api', rotasDoacoes(db));

  app.use('/api', (req, res) => res.status(404).json({ erro: 'Rota não encontrada.' }));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // Tratamento central de erros
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.status && err.status < 500) return res.status(err.status).json({ erro: err.message });
    console.error(err);
    res.status(500).json({ erro: 'Erro interno. Tente novamente.' });
  });

  return app;
}

module.exports = { criarApp };
