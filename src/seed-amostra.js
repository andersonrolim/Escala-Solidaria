/**
 * Acrescenta dados fictícios de demonstração ao banco SQLite local sem apagar nada.
 * Contas ONG e voluntário criadas por este script usam a senha 123456.
 */
const path = require('path');
const bcrypt = require('bcryptjs');
const { abrirBanco } = require('./db');
const { somarDias, gerarCodigo } = require('./utils');

const ARQUIVO_LOCAL = path.join(__dirname, '..', 'data', 'escala.db');
const SENHA_DEMO = '123456';

async function criarOngSeNecessario(db, dados) {
  let usuario = await db.get('SELECT id FROM usuarios WHERE email = ?', dados.email);
  if (!usuario) {
    const hash = bcrypt.hashSync(SENHA_DEMO, 10);
    const inserido = await db.run(
      'INSERT INTO usuarios (nome, email, senha_hash, telefone, tipo) VALUES (?, ?, ?, ?, ?)',
      dados.responsavel, dados.email, hash, '', 'ong'
    );
    usuario = { id: inserido.lastInsertRowid };
  }

  let ong = await db.get('SELECT id FROM ongs WHERE usuario_id = ?', usuario.id);
  if (!ong) {
    const inserido = await db.run(
      `INSERT INTO ongs (usuario_id, nome, descricao, endereco, cidade, historia)
       VALUES (?, ?, ?, ?, ?, ?)`,
      usuario.id, dados.nome, dados.descricao, dados.endereco, 'Santo André', dados.historia
    );
    ong = { id: inserido.lastInsertRowid };
  }
  return ong.id;
}

async function criarTurnoSeNecessario(db, ongId, turno) {
  const data = somarDias(turno.dias);
  const existente = await db.get(
    'SELECT id FROM turnos WHERE ong_id = ? AND titulo = ? AND data = ?',
    ongId, turno.titulo, data
  );
  if (existente) return existente.id;

  const inserido = await db.run(
    `INSERT INTO turnos (ong_id, titulo, categoria, descricao, requisitos, data,
       hora_inicio, hora_fim, online, endereco, vagas, lembrete_whatsapp,
       lembrete_email, lista_espera, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 1, 1, 1, 'publicado')`,
    ongId, turno.titulo, turno.categoria, turno.descricao, turno.requisitos || '', data,
    turno.inicio, turno.fim, turno.endereco, turno.vagas
  );
  return inserido.lastInsertRowid;
}

async function criarNecessidadeSeNecessario(db, ongId, necessidade) {
  const existente = await db.get(
    'SELECT id FROM necessidades WHERE ong_id = ? AND nome = ?', ongId, necessidade.nome
  );
  if (existente) return;
  await db.run(
    `INSERT INTO necessidades (ong_id, nome, categoria, unidade, meta, urgente, descricao)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ongId, necessidade.nome, necessidade.categoria, necessidade.unidade,
    necessidade.meta, necessidade.urgente ? 1 : 0, necessidade.descricao
  );
}

async function inscreverVoluntarios(db, turnoId, voluntarios, quantidade) {
  for (const voluntario of voluntarios.slice(0, quantidade)) {
    const existente = await db.get(
      'SELECT id FROM inscricoes WHERE turno_id = ? AND voluntario_id = ?', turnoId, voluntario.id
    );
    if (!existente) {
      await db.run(
        `INSERT INTO inscricoes (turno_id, voluntario_id, status, presenca, codigo)
         VALUES (?, ?, 'confirmada', 'aguardando', ?)`,
        turnoId, voluntario.id, gerarCodigo()
      );
    }
  }
}

async function popularAmostra(db) {
  const ongs = [
    {
      responsavel: 'Equipe Sementes do Amanhã',
      email: 'demo.sementes@demo.com',
      nome: 'Instituto Sementes do Amanhã',
      descricao: 'Apoio educacional e atividades comunitárias para crianças e famílias.',
      endereco: 'Rua das Acácias, 145 — Jardim Bela Vista',
      historia: 'Organização fictícia criada para demonstração do sistema. Atua com oficinas educativas e ações comunitárias.',
      turnos: [
        { dias: 2, titulo: 'Oficina de leitura para crianças', categoria: 'Educação', descricao: 'Apoiar a leitura em pequenos grupos e organizar os livros ao final.', inicio: '09:00', fim: '12:00', vagas: 8, endereco: 'Rua das Acácias, 145 — Jardim Bela Vista, Santo André' },
        { dias: 4, titulo: 'Montagem de kits escolares', categoria: 'Doações', descricao: 'Separar cadernos, lápis e materiais para as famílias atendidas.', inicio: '13:00', fim: '16:00', vagas: 10, endereco: 'Rua das Acácias, 145 — Jardim Bela Vista, Santo André' },
        { dias: 7, titulo: 'Mutirão da horta comunitária', categoria: 'Meio ambiente', descricao: 'Preparar canteiros, plantar mudas e cuidar da horta do espaço.', requisitos: 'Levar roupa confortável e calçado fechado.', inicio: '08:30', fim: '11:30', vagas: 12, endereco: 'Rua das Acácias, 145 — Jardim Bela Vista, Santo André' }
      ],
      necessidades: [
        { nome: 'Cadernos universitários', categoria: 'Material pedagógico', unidade: 'unidade', meta: 60, urgente: true, descricao: 'Cadernos novos para as atividades de reforço escolar.' },
        { nome: 'Lápis de cor e giz de cera', categoria: 'Material pedagógico', unidade: 'kit', meta: 25, descricao: 'Materiais para as oficinas de arte e leitura.' }
      ]
    },
    {
      responsavel: 'Equipe Patas e Afeto',
      email: 'demo.patas@demo.com',
      nome: 'Projeto Patas e Afeto',
      descricao: 'Acolhimento temporário e incentivo à adoção responsável de cães e gatos.',
      endereco: 'Av. dos Ipês, 520 — Parque das Nações',
      historia: 'Organização fictícia criada para demonstração do sistema. Promove cuidado animal e adoção responsável.',
      turnos: [
        { dias: 3, titulo: 'Passeio e socialização dos cães', categoria: 'Animais', descricao: 'Passear com os cães acompanhados pela equipe e ajudar na socialização.', requisitos: 'Orientação inicial no local. Menores acompanhados por responsável.', inicio: '08:00', fim: '11:00', vagas: 8, endereco: 'Av. dos Ipês, 520 — Parque das Nações, Santo André' },
        { dias: 5, titulo: 'Organização do abrigo e banho', categoria: 'Animais', descricao: 'Organizar os espaços, higienizar materiais e ajudar no banho dos animais.', inicio: '09:00', fim: '12:00', vagas: 6, endereco: 'Av. dos Ipês, 520 — Parque das Nações, Santo André' },
        { dias: 9, titulo: 'Feira de adoção responsável', categoria: 'Animais', descricao: 'Apoiar a recepção de visitantes e compartilhar informações sobre adoção.', inicio: '10:00', fim: '14:00', vagas: 10, endereco: 'Praça Central, Santo André' }
      ],
      necessidades: [
        { nome: 'Ração para cães adultos', categoria: 'Alimentos', unidade: 'kg', meta: 120, urgente: true, descricao: 'Ração seca para cães adultos acolhidos no abrigo.' },
        { nome: 'Cobertores e mantas laváveis', categoria: 'Outros', unidade: 'unidade', meta: 30, descricao: 'Mantas limpas para os espaços de descanso dos animais.' }
      ]
    }
  ];

  const voluntarios = await db.all(
    "SELECT id FROM usuarios WHERE tipo = 'voluntario' ORDER BY id LIMIT 8"
  );
  let totalTurnos = 0;
  let totalOngs = 0;

  await db.transaction(async () => {
    for (const dados of ongs) {
      const ongId = await criarOngSeNecessario(db, dados);
      totalOngs += 1;
      for (const turno of dados.turnos) {
        const turnoId = await criarTurnoSeNecessario(db, ongId, turno);
        await inscreverVoluntarios(db, turnoId, voluntarios, turno.vagas > 8 ? 2 : 1);
        totalTurnos += 1;
      }
      for (const necessidade of dados.necessidades) {
        await criarNecessidadeSeNecessario(db, ongId, necessidade);
      }
    }
  })();

  return { ongs: totalOngs, turnos: totalTurnos };
}

if (require.main === module) {
  (async () => {
    const db = await abrirBanco(ARQUIVO_LOCAL);
    const resultado = await popularAmostra(db);
    await db.fechar();
    console.log(`Amostra local pronta: ${resultado.ongs} ONGs e ${resultado.turnos} atividades garantidas.`);
    console.log('Contas ONG: demo.sementes@demo.com e demo.patas@demo.com / senha 123456.');
    console.log('Os dados existentes foram preservados; executar novamente não duplica as amostras.');
  })().catch((erro) => {
    console.error('Não foi possível criar a amostra local:', erro);
    process.exit(1);
  });
}

module.exports = { popularAmostra };
