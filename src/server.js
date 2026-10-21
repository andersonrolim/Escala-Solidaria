const { abrirBanco } = require('./db');
const { criarApp } = require('./app');
const { processarLembretes } = require('./servicos/lembretes');

const PORTA = Number(process.env.PORT) || 3000;
const db = abrirBanco();
const app = criarApp(db);

app.listen(PORTA, () => {
  console.log(`Escala Solidária rodando em http://localhost:${PORTA}`);
});

// Verifica lembretes de 24h a cada minuto (envio simulado — veja src/servicos/lembretes.js)
processarLembretes(db);
setInterval(() => processarLembretes(db), 60 * 1000);
