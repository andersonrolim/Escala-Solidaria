const { abrirBanco } = require('./db');
const { criarApp } = require('./app');
const { processarLembretes } = require('./servicos/lembretes');
const { popularSeVazio } = require('./seed');

const PORTA = Number(process.env.PORT) || 3000;

(async () => {
  const db = await abrirBanco();
  console.log(`Banco: ${db.dialeto === 'turso' ? 'Turso (SQLite na nuvem)' : 'SQLite local'}`);

  // Com SEED_DEMO=true, um banco vazio recebe os dados de demonstração na primeira subida.
  if (process.env.SEED_DEMO === 'true' && (await popularSeVazio(db))) {
    console.log('Banco vazio: dados de demonstração criados (ong@demo.com / voluntario@demo.com, senha 123456).');
  }

  const app = criarApp(db);
  app.listen(PORTA, () => console.log(`Escala Solidária rodando na porta ${PORTA}`));

  // Verifica lembretes de 24h a cada 10 minutos (envio simulado — veja src/servicos/lembretes.js)
  const verificar = () => processarLembretes(db).catch((e) => console.error('Erro nos lembretes:', e.message));
  verificar();
  setInterval(verificar, 10 * 60 * 1000);
})().catch((e) => {
  console.error('Não foi possível iniciar:', e);
  process.exit(1);
});
