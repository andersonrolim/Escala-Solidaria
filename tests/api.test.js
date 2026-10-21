const request = require('supertest');
const { abrirBanco, apagarTudo } = require('../src/db');

// Por padrão os testes usam SQLite em memória. Para testar o cliente do Turso (libSQL):
//   TEST_DB=file:/caminho/teste.db npm test
const TEST_DB = process.env.TEST_DB || ':memory:';
const { criarApp } = require('../src/app');
const { somarDias } = require('../src/utils');
const { processarLembretes } = require('../src/servicos/lembretes');

let db;
let app;

/** Cria um "navegador" com cookie de sessão já logado. */
async function cadastrar(dados) {
  const agente = request.agent(app);
  const r = await agente.post('/api/auth/register').send({ senha: '123456', ...dados });
  expect(r.status).toBe(201);
  return agente;
}

const turnoBase = () => ({
  titulo: 'Sopão comunitário',
  categoria: 'Alimentação',
  descricao: 'Preparar a sopa',
  data: somarDias(3),
  hora_inicio: '17:00',
  hora_fim: '20:00',
  endereco: 'Rua das Flores, 100',
  vagas: 2
});

beforeEach(async () => {
  db = await abrirBanco(TEST_DB);
  if (TEST_DB !== ':memory:') await apagarTudo(db);
  app = criarApp(db, { segredoSessao: 'teste' });
});
afterEach(async () => db.fechar());

describe('Autenticação', () => {
  test('cadastra voluntário e retorna a sessão', async () => {
    const agente = await cadastrar({ nome: 'Mariana', email: 'mari@teste.com', tipo: 'voluntario' });
    const me = await agente.get('/api/auth/me');
    expect(me.body.usuario).toMatchObject({ nome: 'Mariana', tipo: 'voluntario' });
  });

  test('não permite e-mail duplicado', async () => {
    await cadastrar({ nome: 'Ana', email: 'a@teste.com' });
    const r = await request(app).post('/api/auth/register').send({ nome: 'Bia', email: 'a@teste.com', senha: '123456' });
    expect(r.status).toBe(409);
  });

  test('valida senha curta e e-mail inválido', async () => {
    const r = await request(app).post('/api/auth/register').send({ nome: 'X', email: 'invalido', senha: '1' });
    expect(r.status).toBe(400);
    expect(r.body.erro).toMatch(/E-mail inválido/);
    expect(r.body.erro).toMatch(/6 caracteres/);
  });

  test('login com senha errada retorna 401', async () => {
    await cadastrar({ nome: 'Ana', email: 'a@teste.com' });
    const r = await request(app).post('/api/auth/login').send({ email: 'a@teste.com', senha: 'errada' });
    expect(r.status).toBe(401);
  });

  test('rotas protegidas exigem login', async () => {
    expect((await request(app).get('/api/me/inscricoes')).status).toBe(401);
    expect((await request(app).get('/api/ong/painel')).status).toBe(401);
  });
});

describe('ONG gerencia turnos', () => {
  test('cria turno e ele aparece na listagem pública', async () => {
    const ong = await cadastrar({ nome: 'Coord', email: 'ong@teste.com', tipo: 'ong', ong_nome: 'Mesa Cheia' });
    const r = await ong.post('/api/ong/turnos').send(turnoBase());
    expect(r.status).toBe(201);
    const lista = await request(app).get('/api/turnos');
    expect(lista.body.turnos).toHaveLength(1);
    expect(lista.body.turnos[0]).toMatchObject({ titulo: 'Sopão comunitário', ong_nome: 'Mesa Cheia', vagas_livres: 2, duracao: 3 });
  });

  test('rascunho não aparece para voluntários', async () => {
    const ong = await cadastrar({ nome: 'Coord', email: 'ong@teste.com', tipo: 'ong', ong_nome: 'Mesa Cheia' });
    await ong.post('/api/ong/turnos').send({ ...turnoBase(), status: 'rascunho' });
    expect((await request(app).get('/api/turnos')).body.turnos).toHaveLength(0);
  });

  test('rejeita turno no passado e horário invertido', async () => {
    const ong = await cadastrar({ nome: 'Coord', email: 'ong@teste.com', tipo: 'ong', ong_nome: 'Mesa Cheia' });
    expect((await ong.post('/api/ong/turnos').send({ ...turnoBase(), data: somarDias(-1) })).status).toBe(400);
    const r = await ong.post('/api/ong/turnos').send({ ...turnoBase(), hora_inicio: '20:00', hora_fim: '17:00' });
    expect(r.status).toBe(400);
    expect(r.body.erro).toMatch(/término precisa ser depois/);
  });

  test('voluntário não pode criar turno (403)', async () => {
    const vol = await cadastrar({ nome: 'Vol', email: 'vol@teste.com' });
    expect((await vol.post('/api/ong/turnos').send(turnoBase())).status).toBe(403);
  });

  test('ONG não acessa turno de outra ONG', async () => {
    const ong1 = await cadastrar({ nome: 'C1', email: 'o1@teste.com', tipo: 'ong', ong_nome: 'ONG 1' });
    const ong2 = await cadastrar({ nome: 'C2', email: 'o2@teste.com', tipo: 'ong', ong_nome: 'ONG 2' });
    const { body } = await ong1.post('/api/ong/turnos').send(turnoBase());
    expect((await ong2.get(`/api/ong/turnos/${body.turno.id}/presenca`)).status).toBe(404);
  });
});

describe('Inscrição do voluntário', () => {
  let ong;
  let turnoId;

  beforeEach(async () => {
    ong = await cadastrar({ nome: 'Coord', email: 'ong@teste.com', tipo: 'ong', ong_nome: 'Mesa Cheia' });
    turnoId = (await ong.post('/api/ong/turnos').send({ ...turnoBase(), lista_espera: true })).body.turno.id;
  });

  test('inscreve, impede duplicidade e aparece em "meus turnos"', async () => {
    const vol = await cadastrar({ nome: 'Vol', email: 'vol@teste.com' });
    const r = await vol.post(`/api/turnos/${turnoId}/inscricao`);
    expect(r.status).toBe(201);
    expect(r.body.inscricao.status).toBe('confirmada');
    expect(r.body.inscricao.codigo).toMatch(/^ES-[A-Z0-9]{6}$/);
    expect((await vol.post(`/api/turnos/${turnoId}/inscricao`)).status).toBe(409);
    const meus = await vol.get('/api/me/inscricoes');
    expect(meus.body.proximos).toHaveLength(1);
  });

  test('lotado vai para lista de espera e é promovido quando alguém cancela', async () => {
    const v1 = await cadastrar({ nome: 'V1', email: 'v1@teste.com' });
    const v2 = await cadastrar({ nome: 'V2', email: 'v2@teste.com' });
    const v3 = await cadastrar({ nome: 'V3', email: 'v3@teste.com', telefone: '11999990000' });
    await v1.post(`/api/turnos/${turnoId}/inscricao`);
    await v2.post(`/api/turnos/${turnoId}/inscricao`);
    const r3 = await v3.post(`/api/turnos/${turnoId}/inscricao`);
    expect(r3.body.inscricao.status).toBe('espera');

    const c = await v1.delete(`/api/turnos/${turnoId}/inscricao`);
    expect(c.body).toEqual({ cancelada: true, promovidos: 1 });

    const meus = await v3.get('/api/me/inscricoes');
    expect(meus.body.proximos[0].status).toBe('confirmada');
    const notifs = await db.all(`SELECT canal FROM notificacoes WHERE tipo = 'promovido_espera'`);
    expect(notifs.map((n) => n.canal).sort()).toEqual(['email', 'whatsapp']);
  });

  test('lotado sem lista de espera retorna 409', async () => {
    const id = (await ong.post('/api/ong/turnos').send({ ...turnoBase(), vagas: 1 })).body.turno.id;
    const v1 = await cadastrar({ nome: 'V1', email: 'v1@teste.com' });
    const v2 = await cadastrar({ nome: 'V2', email: 'v2@teste.com' });
    expect((await v1.post(`/api/turnos/${id}/inscricao`)).status).toBe(201);
    const r = await v2.post(`/api/turnos/${id}/inscricao`);
    expect(r.status).toBe(409);
    expect(r.body.erro).toMatch(/lotado/i);
  });

  test('ONG não pode reduzir vagas abaixo dos confirmados', async () => {
    const v1 = await cadastrar({ nome: 'V1', email: 'v1@teste.com' });
    const v2 = await cadastrar({ nome: 'V2', email: 'v2@teste.com' });
    await v1.post(`/api/turnos/${turnoId}/inscricao`);
    await v2.post(`/api/turnos/${turnoId}/inscricao`);
    const r = await ong.put(`/api/ong/turnos/${turnoId}`).send({ ...turnoBase(), vagas: 1 });
    expect(r.status).toBe(400);
  });

  test('QR Code de check-in é gerado para o dono da inscrição', async () => {
    const vol = await cadastrar({ nome: 'Vol', email: 'vol@teste.com' });
    const { body } = await vol.post(`/api/turnos/${turnoId}/inscricao`);
    const r = await vol.get(`/api/me/inscricoes/${body.inscricao.id}/checkin`);
    expect(r.status).toBe(200);
    expect(r.body.qr).toMatch(/^data:image\/png;base64,/);
    const outro = await cadastrar({ nome: 'Outro', email: 'outro@teste.com' });
    expect((await outro.get(`/api/me/inscricoes/${body.inscricao.id}/checkin`)).status).toBe(404);
  });
});

describe('Check-in, presença e horas', () => {
  test('check-in por código marca presença e conta horas no certificado', async () => {
    const ong = await cadastrar({ nome: 'Coord', email: 'ong@teste.com', tipo: 'ong', ong_nome: 'Mesa Cheia' });
    const turnoId = (await ong.post('/api/ong/turnos').send(turnoBase())).body.turno.id;
    const vol = await cadastrar({ nome: 'Vol', email: 'vol@teste.com' });
    const { body } = await vol.post(`/api/turnos/${turnoId}/inscricao`);

    const c = await ong.post('/api/ong/checkin').send({ codigo: body.inscricao.codigo.toLowerCase(), turno_id: turnoId });
    expect(c.status).toBe(200);
    expect(c.body).toMatchObject({ ja_registrado: false, nome: 'Vol' });

    const deNovo = await ong.post('/api/ong/checkin').send({ codigo: body.inscricao.codigo });
    expect(deNovo.body.ja_registrado).toBe(true);

    const ano = somarDias(3).slice(0, 4);
    const resumo = await vol.get(`/api/me/resumo?ano=${ano}`);
    expect(resumo.body).toMatchObject({ horas: 3, turnos: 1, ongs: 1 });

    const presenca = await ong.get(`/api/ong/turnos/${turnoId}/presenca`);
    expect(presenca.body.resumo).toMatchObject({ inscritos: 1, presentes: 1, aguardando: 0 });
  });

  test('código de outra ONG não é aceito', async () => {
    const ong1 = await cadastrar({ nome: 'C1', email: 'o1@teste.com', tipo: 'ong', ong_nome: 'ONG 1' });
    const ong2 = await cadastrar({ nome: 'C2', email: 'o2@teste.com', tipo: 'ong', ong_nome: 'ONG 2' });
    const turnoId = (await ong1.post('/api/ong/turnos').send(turnoBase())).body.turno.id;
    const vol = await cadastrar({ nome: 'Vol', email: 'vol@teste.com' });
    const { body } = await vol.post(`/api/turnos/${turnoId}/inscricao`);
    expect((await ong2.post('/api/ong/checkin').send({ codigo: body.inscricao.codigo })).status).toBe(404);
  });

  test('ONG marca falta e desfaz presença manualmente', async () => {
    const ong = await cadastrar({ nome: 'Coord', email: 'ong@teste.com', tipo: 'ong', ong_nome: 'Mesa Cheia' });
    const turnoId = (await ong.post('/api/ong/turnos').send(turnoBase())).body.turno.id;
    const vol = await cadastrar({ nome: 'Vol', email: 'vol@teste.com' });
    const { body } = await vol.post(`/api/turnos/${turnoId}/inscricao`);
    const id = body.inscricao.id;

    let r = await ong.patch(`/api/ong/inscricoes/${id}/presenca`).send({ presenca: 'presente' });
    expect(r.body.inscricao.checkin_em).toBeTruthy();
    r = await ong.patch(`/api/ong/inscricoes/${id}/presenca`).send({ presenca: 'ausente' });
    expect(r.body.inscricao).toMatchObject({ presenca: 'ausente', checkin_em: null });
    expect((await ong.patch(`/api/ong/inscricoes/${id}/presenca`).send({ presenca: 'talvez' })).status).toBe(400);
  });

  test('exporta a lista de presença em CSV', async () => {
    const ong = await cadastrar({ nome: 'Coord', email: 'ong@teste.com', tipo: 'ong', ong_nome: 'Mesa Cheia' });
    const turnoId = (await ong.post('/api/ong/turnos').send(turnoBase())).body.turno.id;
    const vol = await cadastrar({ nome: 'Vol "Aspas"', email: 'vol@teste.com' });
    await vol.post(`/api/turnos/${turnoId}/inscricao`);
    const r = await ong.get(`/api/ong/turnos/${turnoId}/presenca-csv`);
    expect(r.headers['content-type']).toMatch(/text\/csv/);
    expect(r.text).toContain('"Vol ""Aspas"""');
  });
});

describe('Lembretes de 24h', () => {
  test('registra um lembrete por canal, sem duplicar', async () => {
    const ong = await cadastrar({ nome: 'Coord', email: 'ong@teste.com', tipo: 'ong', ong_nome: 'Mesa Cheia' });
    const turnoId = (await ong.post('/api/ong/turnos').send(turnoBase())).body.turno.id;
    const vol = await cadastrar({ nome: 'Vol', email: 'vol@teste.com', telefone: '11999990000' });
    await vol.post(`/api/turnos/${turnoId}/inscricao`);

    // Simula "agora" = 2 dias e meio depois de hoje, ou seja, menos de 24h antes do turno (17h de daqui a 3 dias)
    const quase = new Date(`${somarDias(2)}T20:00:00`);
    const enviados = [];
    const espiao = (canal, destino) => enviados.push([canal, destino]);

    expect(await processarLembretes(db, quase, espiao)).toBe(2);
    expect(enviados).toEqual([['whatsapp', '11999990000'], ['email', 'vol@teste.com']]);
    expect(await processarLembretes(db, quase, espiao)).toBe(0); // não reenvia

    // Muito antes do turno: nada a enviar
    await db.run('DELETE FROM notificacoes');
    expect(await processarLembretes(db, new Date(), espiao)).toBe(0);
  });
});
