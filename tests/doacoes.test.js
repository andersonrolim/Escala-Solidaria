const request = require('supertest');
const { abrirBanco, apagarTudo } = require('../src/db');

// Por padrão os testes usam SQLite em memória. Para testar o cliente do Turso (libSQL):
//   TEST_DB=file:/caminho/teste.db npm test
const TEST_DB = process.env.TEST_DB || ':memory:';
const { criarApp } = require('../src/app');
const { gerarPayloadPix, crc16, normalizarChave } = require('../src/servicos/pix');
const { reaisPorExtenso } = require('../src/servicos/extenso');

let db;
let app;

async function cadastrar(dados) {
  const agente = request.agent(app);
  const r = await agente.post('/api/auth/register').send({ senha: '123456', ...dados });
  expect(r.status).toBe(201);
  return agente;
}

/** Lê a resposta binária (PDF) do supertest. */
const binario = (res, cb) => {
  const partes = [];
  res.on('data', (c) => partes.push(c));
  res.on('end', () => cb(null, Buffer.concat(partes)));
};

const CHAVE = '123e4567-e12b-12d1-a456-426655440000';

async function ongComPix() {
  const ong = await cadastrar({ nome: 'Cláudia', email: 'ong@teste.com', tipo: 'ong', ong_nome: 'Girassol Azul' });
  const r = await ong.put('/api/ong/perfil').send({
    nome: 'Associação Girassol Azul', cidade: 'Santo André', whatsapp: '(11) 99999-0000',
    pix_tipo: 'aleatoria', pix_chave: CHAVE, pix_nome: 'Girassol Azul', pix_cidade: 'Santo Andre'
  });
  expect(r.status).toBe(200);
  const ongId = (await ong.get('/api/auth/me')).body.usuario.ongId;
  return { ong, ongId };
}

beforeEach(async () => {
  db = await abrirBanco(TEST_DB);
  if (TEST_DB !== ':memory:') await apagarTudo(db);
  app = criarApp(db, { segredoSessao: 'teste' });
});
afterEach(async () => db.fechar());

describe('PIX (BR Code)', () => {
  test('CRC16 bate com o exemplo oficial do Banco Central', () => {
    const semCrc = '00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***6304';
    expect(crc16(semCrc)).toBe('1D3D');
  });

  test('payload com valor, sem acentos e com CRC válido', () => {
    const p = gerarPayloadPix({ chave: CHAVE, nome: 'Associação Girassol Azul', cidade: 'Santo André', valor: 50 });
    expect(p).toContain('540550.00');
    expect(p).toContain('ASSOCIACAO GIRASSOL AZUL');
    expect(p).toContain('6011SANTO ANDRE');
    expect(crc16(p.slice(0, -4))).toBe(p.slice(-4));
  });

  test('normaliza e valida chaves', () => {
    expect(normalizarChave('telefone', '(11) 99999-0000')).toBe('+5511999990000');
    expect(normalizarChave('cnpj', '12.345.678/0001-90')).toBe('12345678000190');
    expect(() => normalizarChave('cpf', '123')).toThrow(/11 dígitos/);
  });
});

describe('Valor por extenso', () => {
  test.each([
    [1, 'um real'],
    [50, 'cinquenta reais'],
    [100, 'cem reais'],
    [1250.75, 'mil duzentos e cinquenta reais e setenta e cinco centavos'],
    [0.5, 'cinquenta centavos']
  ])('%p → %p', (v, esperado) => expect(reaisPorExtenso(v)).toBe(esperado));
});

describe('Perfil da ONG', () => {
  test('rejeita chave PIX inválida', async () => {
    const ong = await cadastrar({ nome: 'Coord', email: 'ong@teste.com', tipo: 'ong', ong_nome: 'ONG X' });
    const r = await ong.put('/api/ong/perfil').send({ nome: 'ONG X', pix_tipo: 'cpf', pix_chave: '123' });
    expect(r.body.erro).toMatch(/11 dígitos/);
    expect(r.status).toBe(400);
  });

  test('página pública mostra PIX e WhatsApp', async () => {
    const { ongId } = await ongComPix();
    const r = await request(app).get(`/api/ongs/${ongId}`);
    expect(r.body.ong).toMatchObject({ pix_chave: CHAVE, whatsapp: '11999990000' });
    const pix = await request(app).get(`/api/ongs/${ongId}/pix?valor=25`);
    expect(pix.body.payload).toContain('540525.00');
    expect(pix.body.qr).toMatch(/^data:image\/png/);
  });
});

describe('Doação de itens', () => {
  test('doador promete, ONG confirma entrega e a meta avança', async () => {
    const { ong, ongId } = await ongComPix();
    const n = (await ong.post('/api/ong/necessidades').send({
      nome: 'Fraldas tamanho G', categoria: 'Fraldas e higiene', unidade: 'pacote', meta: 50, urgente: true
    })).body.necessidade;

    const doador = await cadastrar({ nome: 'Mariana', email: 'mari@teste.com', telefone: '11988887777' });
    const d = await doador.post(`/api/necessidades/${n.id}/doacoes`).send({ quantidade: 10 });
    expect(d.status).toBe(201);

    let pub = (await request(app).get(`/api/ongs/${ongId}`)).body.necessidades[0];
    expect(pub).toMatchObject({ prometido: 10, entregue: 0, falta: 40, urgente: true });

    const lista = await ong.get('/api/ong/doacoes');
    expect(lista.body.itens[0]).toMatchObject({ doador_nome: 'Mariana', doador_telefone: '11988887777' });
    await ong.patch(`/api/ong/doacoes-itens/${d.body.doacao.id}`).send({ status: 'entregue' });

    pub = (await request(app).get(`/api/ongs/${ongId}`)).body.necessidades[0];
    expect(pub).toMatchObject({ prometido: 0, entregue: 10 });
    expect((await doador.get('/api/me/doacoes')).body.resumo.itens_entregues).toBe(1);
  });

  test('ONG não doa e não enxerga itens de outra ONG', async () => {
    const { ong } = await ongComPix();
    const n = (await ong.post('/api/ong/necessidades').send({ nome: 'Leite', categoria: 'Alimentos', unidade: 'litro', meta: 10 })).body.necessidade;
    expect((await ong.post(`/api/necessidades/${n.id}/doacoes`).send({ quantidade: 1 })).status).toBe(403);
    const outra = await cadastrar({ nome: 'Outra', email: 'o2@teste.com', tipo: 'ong', ong_nome: 'Outra' });
    expect((await outra.put(`/api/ong/necessidades/${n.id}`).send({ nome: 'Leite', categoria: 'Alimentos', unidade: 'litro', meta: 5 })).status).toBe(404);
  });
});

describe('Doação via PIX e recibo', () => {
  test('fluxo completo: informa → ONG confirma → recibo PDF e contagem de doações', async () => {
    const { ong, ongId } = await ongComPix();
    const doador = await cadastrar({ nome: 'Mariana Souza', email: 'mari@teste.com' });

    const p1 = (await doador.post(`/api/ongs/${ongId}/doacoes-pix`).send({ valor: '50,00', mensagem: 'Para as fraldas' })).body.doacao;
    expect(p1).toMatchObject({ valor_centavos: 5000, status: 'informada' });

    // antes de confirmar, não há recibo
    expect((await doador.get(`/api/me/doacoes-pix/${p1.id}/recibo`)).status).toBe(409);

    const conf = await ong.patch(`/api/ong/doacoes-pix/${p1.id}`).send({ status: 'confirmada' });
    expect(conf.body.doacao.recibo_numero).toMatch(/^REC-\d{4}-\d{6}$/);
    expect((await ong.patch(`/api/ong/doacoes-pix/${p1.id}`).send({ status: 'recusada' })).status).toBe(409);

    const p2 = (await doador.post(`/api/ongs/${ongId}/doacoes-pix`).send({ valor: 30 })).body.doacao;
    await ong.patch(`/api/ong/doacoes-pix/${p2.id}`).send({ status: 'confirmada' });

    const meus = await doador.get('/api/me/doacoes');
    expect(meus.body.resumo).toMatchObject({ vezes: 2, pix_confirmados: 2, total_pix_centavos: 8000, ongs: 1 });

    const pdf = await doador.get(`/api/me/doacoes-pix/${p2.id}/recibo`).buffer(true).parse(binario);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.body.slice(0, 5).toString()).toBe('%PDF-');

    const decl = await doador.get('/api/me/doacoes/declaracao').buffer(true).parse(binario);
    expect(decl.body.slice(0, 5).toString()).toBe('%PDF-');

    // outro doador não baixa o recibo de Mariana
    const outro = await cadastrar({ nome: 'Outro', email: 'outro@teste.com' });
    expect((await outro.get(`/api/me/doacoes-pix/${p2.id}/recibo`)).status).toBe(404);
  });

  test('valida valor e exige chave PIX cadastrada', async () => {
    const ong = await cadastrar({ nome: 'Coord', email: 'semPix@teste.com', tipo: 'ong', ong_nome: 'Sem PIX' });
    const ongId = (await ong.get('/api/auth/me')).body.usuario.ongId;
    const doador = await cadastrar({ nome: 'Mariana', email: 'mari@teste.com' });
    expect((await doador.post(`/api/ongs/${ongId}/doacoes-pix`).send({ valor: 10 })).status).toBe(400);
    const { ongId: comPix } = await ongComPix();
    expect((await doador.post(`/api/ongs/${comPix}/doacoes-pix`).send({ valor: 0.5 })).status).toBe(400);
  });
});
