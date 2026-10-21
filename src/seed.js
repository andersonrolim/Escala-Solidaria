/**
 * Popula o banco com dados de demonstração.
 * ATENÇÃO: apaga o banco atual (data/escala.db) antes de recriar.
 *
 * A ONG principal é FICTÍCIA: "Associação Girassol Azul", uma creche inclusiva
 * para crianças autistas em Santo André (história completa em materiais/).
 * Telefones, chave PIX e endereços são fictícios — troque antes de usar de verdade.
 *
 * Usuários criados (senha de todos: 123456):
 *   ONG:              ong@demo.com         (Associação Girassol Azul)
 *   Voluntário/doador: voluntario@demo.com (Mariana Souza)
 */
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { abrirBanco } = require('./db');
const { somarDias, gerarCodigo } = require('./utils');

const arquivo = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'escala.db');
for (const ext of ['', '-wal', '-shm']) fs.rmSync(arquivo + ext, { force: true });
const db = abrirBanco(arquivo);

const hash = bcrypt.hashSync('123456', 10);
const criarUsuario = (nome, email, telefone, tipo) =>
  db.prepare('INSERT INTO usuarios (nome, email, senha_hash, telefone, tipo) VALUES (?, ?, ?, ?, ?)')
    .run(nome, email, hash, telefone, tipo).lastInsertRowid;
const criarOng = (usuarioId, o) =>
  db.prepare(`INSERT INTO ongs (usuario_id, nome, descricao, historia, endereco, cidade, whatsapp, pix_tipo, pix_chave, pix_nome, pix_cidade)
              VALUES (@usuario_id, @nome, @descricao, @historia, @endereco, 'Santo André', @whatsapp, @pix_tipo, @pix_chave, @pix_nome, 'Santo Andre')`)
    .run({ historia: '', whatsapp: '', pix_tipo: null, pix_chave: null, pix_nome: '', ...o, usuario_id: usuarioId }).lastInsertRowid;

const criarTurno = (t) => db.prepare(`
  INSERT INTO turnos (ong_id, titulo, categoria, descricao, requisitos, data, hora_inicio, hora_fim, online, endereco,
                      vagas, lembrete_whatsapp, lembrete_email, lista_espera, status)
  VALUES (@ong_id, @titulo, @categoria, @descricao, @requisitos, @data, @hora_inicio, @hora_fim, @online, @endereco,
          @vagas, 1, 1, @lista_espera, 'publicado')`)
  .run({ descricao: '', requisitos: '', online: 0, endereco: '', lista_espera: 0, ...t }).lastInsertRowid;

// Para a "Atividade recente" ficar realista, cada inscrição futura recebe um horário
// alguns minutos/horas atrás; as de turnos passados usam a data do próprio turno.
let minutosAtras = 2000;
const inscrever = (turnoId, volId, status = 'confirmada', presenca = 'aguardando', checkin = null) => {
  const t = db.prepare('SELECT data FROM turnos WHERE id = ?').get(turnoId);
  minutosAtras = Math.max(5, minutosAtras - 47);
  const quando = checkin || presenca === 'ausente'
    ? `${t.data} 08:00:00`
    : db.prepare(`SELECT datetime('now', 'localtime', ?) AS d`).get(`-${minutosAtras} minutes`).d;
  return db.prepare(`INSERT INTO inscricoes (turno_id, voluntario_id, status, presenca, codigo, checkin_em, criado_em, atualizado_em)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(turnoId, volId, status, presenca, gerarCodigo(), checkin, quando, quando);
};

const criarNecessidade = (ongId, nome, categoria, unidade, meta, urgente = 0, descricao = '') =>
  db.prepare(`INSERT INTO necessidades (ong_id, nome, categoria, unidade, meta, urgente, descricao) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(ongId, nome, categoria, unidade, meta, urgente, descricao).lastInsertRowid;

const doarItem = (necId, doadorId, qtd, status, diasAtras, previsao = null) => {
  const quando = `${somarDias(-diasAtras)} 10:30:00`;
  db.prepare(`INSERT INTO doacoes_itens (necessidade_id, doador_id, quantidade, status, previsao_entrega, criado_em, entregue_em)
              VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(necId, doadorId, qtd, status, previsao, quando, status === 'entregue' ? `${somarDias(-diasAtras + 1)} 15:00:00` : null);
};

const doarPix = (ongId, doadorId, reais, status, diasAtras, mensagem = '') => {
  const criado = `${somarDias(-diasAtras)} 08:42:00`;
  const confirmado = status === 'confirmada' ? `${somarDias(-diasAtras + 1)} 09:10:00` : null;
  const id = db.prepare(`INSERT INTO doacoes_pix (ong_id, doador_id, valor_centavos, status, mensagem, criado_em, confirmado_em)
                         VALUES (?, ?, ?, ?, ?, ?, ?)`).run(ongId, doadorId, Math.round(reais * 100), status, mensagem, criado, confirmado).lastInsertRowid;
  if (status === 'confirmada') {
    db.prepare('UPDATE doacoes_pix SET recibo_numero = ? WHERE id = ?').run(`REC-${confirmado.slice(0, 4)}-${String(id).padStart(6, '0')}`, id);
  }
};

const HISTORIA_GIRASSOL = `A Associação Girassol Azul nasceu em 2016, na garagem da casa da pedagoga Cláudia Ribeiro, em Santo André. ` +
  `Mãe do Theo, diagnosticado com autismo aos 3 anos, ela ouviu "não temos estrutura" em quatro creches seguidas. ` +
  `Decidiu então criar o espaço que gostaria de ter encontrado: começou cuidando de 4 crianças com a ajuda de duas vizinhas.\n\n` +
  `Hoje a Girassol Azul atende 38 crianças de 2 a 6 anos, autistas e não autistas, em período integral. ` +
  `As turmas têm no máximo 8 crianças, a rotina é apresentada com pictogramas e existe o "Cantinho Calmo", ` +
  `uma sala com luz baixa e materiais sensoriais para quando o barulho fica demais. Uma vez por mês, as famílias se encontram ` +
  `na Roda de Conversa para trocar experiências.\n\n` +
  `Tudo isso é mantido com doações, um bazar mensal e muito trabalho voluntário. ` +
  `Há 52 famílias na lista de espera. Cada pacote de fralda, cada abafador de ruído e cada hora de voluntariado ` +
  `ajuda uma criança a ser acolhida do jeito que ela é.`;

db.transaction(() => {
  // ---------- ONGs ----------
  const girassol = criarOng(criarUsuario('Cláudia Ribeiro', 'ong@demo.com', '(11) 99999-0000', 'ong'), {
    nome: 'Associação Girassol Azul',
    descricao: 'Creche inclusiva que acolhe crianças autistas de 2 a 6 anos em Santo André.',
    historia: HISTORIA_GIRASSOL,
    endereco: 'Rua das Hortênsias, 210 — Vila Assunção',
    whatsapp: '11999990000',
    pix_tipo: 'aleatoria',
    pix_chave: '7f3c2a10-5b8e-4d21-9a6f-0c4e8b1d2f37',   // chave fictícia
    pix_nome: 'Girassol Azul'
  });
  const mesaCheia = criarOng(criarUsuario('Coordenação Mesa Cheia', 'mesa@demo.com', '(11) 4000-0001', 'ong'), {
    nome: 'Associação Mesa Cheia', descricao: 'Sopão comunitário e distribuição de cestas básicas.',
    endereco: 'Rua das Flores, 100 — Vila Assunção', whatsapp: '11999990001'
  });
  const vestir = criarOng(criarUsuario('Coordenação Vestir Bem', 'vestir@demo.com', '(11) 4000-0002', 'ong'), {
    nome: 'Instituto Vestir Bem', descricao: 'Arrecadação e triagem de roupas.', endereco: 'Av. Central, 250 — Centro'
  });
  const aprender = criarOng(criarUsuario('Coordenação Aprender Juntos', 'aprender@demo.com', '(11) 4000-0003', 'ong'), {
    nome: 'Projeto Aprender Juntos', descricao: 'Reforço escolar gratuito.', endereco: ''
  });
  const peludos = criarOng(criarUsuario('Coordenação Lar dos Peludos', 'peludos@demo.com', '(11) 4000-0004', 'ong'), {
    nome: 'Lar dos Peludos', descricao: 'Abrigo de cães e gatos.', endereco: 'Estrada do Parque, 50', whatsapp: '11999990004'
  });

  // ---------- Voluntários / doadores ----------
  const mariana = criarUsuario('Mariana Souza', 'voluntario@demo.com', '(11) 98888-4821', 'voluntario');
  const outros = [
    ['Rafael Costa', '(11) 97777-1190'], ['Beatriz Lima', '(11) 96666-3307'], ['Carlos Mendes', '(11) 95555-7745'],
    ['Juliana Rocha', '(11) 94444-6612'], ['Pedro Alves', '(11) 93333-2058'], ['Larissa Nunes', '(11) 92222-9934'],
    ['Thiago Martins', '(11) 91111-5170'], ['Ana Lopes', '(11) 90000-1234']
  ].map(([nome, tel], i) => criarUsuario(nome, `vol${i + 1}@demo.com`, tel, 'voluntario'));

  const END_GIRASSOL = 'Rua das Hortênsias, 210 — Vila Assunção, Santo André';
  const REQ_GIRASSOL = 'Fale com calma, evite perfumes fortes e roupas com estampas muito chamativas. ' +
    'Nos primeiros 30 minutos há uma orientação rápida da equipe. Maior de 16 anos.';
  const cantinho = {
    titulo: 'Apoio no Cantinho Calmo e no recreio', categoria: 'Inclusão',
    descricao: 'Acompanhar as crianças no recreio junto com as educadoras\nOrganizar os materiais sensoriais do Cantinho Calmo\nAjudar na hora do lanche',
    requisitos: REQ_GIRASSOL, endereco: END_GIRASSOL, hora_inicio: '08:00', hora_fim: '12:00', vagas: 8
  };

  // ---------- Turnos futuros ----------
  const t1 = criarTurno({ ...cantinho, ong_id: girassol, data: somarDias(4) });
  outros.slice(0, 5).forEach((v) => inscrever(t1, v));

  const t2 = criarTurno({ ong_id: girassol, titulo: 'Mutirão de pintura das salas', categoria: 'Inclusão',
    descricao: 'Pintar as paredes com cores suaves (tons claros ajudam a reduzir o excesso de estímulo)\nMontar os painéis da rotina visual',
    requisitos: 'Roupa que possa sujar. Tintas e rolos fornecidos. Não há crianças no local neste dia.',
    endereco: END_GIRASSOL, data: somarDias(2), hora_inicio: '09:00', hora_fim: '13:00', vagas: 10 });
  outros.slice(5, 7).forEach((v) => inscrever(t2, v));

  const t3 = criarTurno({ ong_id: girassol, titulo: 'Contação de histórias com pictogramas', categoria: 'Educação',
    descricao: 'Ler histórias curtas usando cartões com figuras\nAjudar as crianças a montar a sequência da história',
    requisitos: REQ_GIRASSOL, endereco: END_GIRASSOL, data: somarDias(11), hora_inicio: '14:00', hora_fim: '16:00', vagas: 8, lista_espera: 1 });
  outros.forEach((v) => inscrever(t3, v));          // 8 de 8 → lotado
  inscrever(t3, mariana, 'espera');                  // Mariana na lista de espera

  const t4 = criarTurno({ ong_id: girassol, titulo: 'Bazar beneficente Girassol Azul', categoria: 'Doações',
    descricao: 'Organizar as peças por tamanho e preço\nAtender no caixa e na arrumação', endereco: 'Praça do Carmo, Santo André',
    data: somarDias(12), hora_inicio: '09:00', hora_fim: '13:00', vagas: 12 });
  outros.slice(2, 6).forEach((v) => inscrever(t4, v));

  const t5 = criarTurno({ ong_id: vestir, titulo: 'Triagem de roupas doadas', categoria: 'Doações',
    descricao: 'Separar roupas por tamanho e estado\nDobrar e guardar nas caixas', endereco: 'Av. Central, 250 — Centro, Santo André',
    data: somarDias(5), hora_inicio: '09:00', hora_fim: '12:00', vagas: 10 });
  outros.slice(0, 5).forEach((v) => inscrever(t5, v));

  criarTurno({ ong_id: mesaCheia, titulo: 'Sopão comunitário — preparo e entrega', categoria: 'Alimentação',
    descricao: 'Ajudar no preparo da sopa\nEntregar as refeições', endereco: 'Rua das Flores, 100 — Vila Assunção, Santo André',
    data: somarDias(6), hora_inicio: '17:00', hora_fim: '20:00', vagas: 8 });

  criarTurno({ ong_id: aprender, titulo: 'Reforço escolar de matemática', categoria: 'Educação',
    descricao: 'Ajudar alunos do 6º ao 9º ano com exercícios', requisitos: 'Computador com câmera e internet.',
    online: 1, data: somarDias(7), hora_inicio: '14:00', hora_fim: '16:00', vagas: 4 });

  criarTurno({ ong_id: peludos, titulo: 'Passeio com cães do abrigo', categoria: 'Animais',
    descricao: 'Levar os cães para passear no parque\nAjudar no banho e na escovação', requisitos: 'Maior de 16 anos.',
    endereco: 'Estrada do Parque, 50 — Santo André', data: somarDias(10), hora_inicio: '08:00', hora_fim: '11:00', vagas: 6 });

  inscrever(t1, mariana);

  // ---------- Turnos passados (histórico e horas) ----------
  const passados = [
    { ...cantinho, ong_id: girassol, data: somarDias(-3) },
    { ong_id: vestir, titulo: 'Triagem de roupas doadas', categoria: 'Doações', endereco: 'Av. Central, 250 — Centro',
      data: somarDias(-16), hora_inicio: '09:00', hora_fim: '12:00', vagas: 10 },
    { ong_id: aprender, titulo: 'Reforço escolar de matemática', categoria: 'Educação', online: 1,
      data: somarDias(-28), hora_inicio: '14:00', hora_fim: '16:00', vagas: 4 },
    { ...cantinho, ong_id: girassol, data: somarDias(-38) }
  ];
  for (const p of passados) {
    const id = criarTurno(p);
    inscrever(id, mariana, 'confirmada', 'presente', `${p.data} ${p.hora_inicio}`);
    outros.slice(0, 6).forEach((v, i) => inscrever(id, v, 'confirmada', i === 5 ? 'ausente' : 'presente', i === 5 ? null : `${p.data} ${p.hora_inicio}`));
  }

  // ---------- Necessidades (o que a creche precisa) ----------
  const [rafael, beatriz, carlos, juliana, pedro] = outros;
  const fraldaG = criarNecessidade(girassol, 'Fraldas infantis tamanho G', 'Fraldas e higiene', 'pacote', 120, 1,
    'Muitas crianças autistas desfraldam mais tarde. É o item que mais falta todo mês.');
  const fraldaXG = criarNecessidade(girassol, 'Fraldas infantis tamanho XG/XXG', 'Fraldas e higiene', 'pacote', 80, 1,
    'Para as crianças maiores, de 4 a 6 anos.');
  const lencos = criarNecessidade(girassol, 'Lenços umedecidos sem perfume', 'Fraldas e higiene', 'pacote', 100, 0,
    'Sem perfume, por causa da sensibilidade de algumas crianças a cheiros.');
  const abafador = criarNecessidade(girassol, 'Abafadores de ruído infantis', 'Brinquedos e sensorial', 'unidade', 20, 1,
    'Protetor auricular tipo concha, tamanho infantil. Ajuda em festas, sirenes e ambientes barulhentos.');
  const sensorial = criarNecessidade(girassol, 'Kits sensoriais (massinha, areia cinética, bolinhas)', 'Brinquedos e sensorial', 'kit', 30, 0,
    'Materiais atóxicos para o Cantinho Calmo.');
  const frutas = criarNecessidade(girassol, 'Frutas para o lanche', 'Alimentos', 'kg', 150, 0, 'Banana, maçã, mamão e pera.');
  const leite = criarNecessidade(girassol, 'Leite integral', 'Alimentos', 'litro', 200, 0, '');
  const papel = criarNecessidade(girassol, 'Papel sulfite e folhas de plastificação', 'Material pedagógico', 'pacote', 40, 0,
    'Para imprimir e plastificar os cartões de comunicação (pictogramas).');
  criarNecessidade(girassol, 'Produtos de limpeza', 'Limpeza', 'kit', 25, 0, 'Desinfetante, sabão em pó e água sanitária.');
  criarNecessidade(mesaCheia, 'Arroz', 'Alimentos', 'kg', 300, 1, '');
  criarNecessidade(mesaCheia, 'Feijão', 'Alimentos', 'kg', 150, 0, '');
  criarNecessidade(peludos, 'Ração para cães adultos', 'Alimentos', 'kg', 400, 1, '');

  // Itens já entregues e prometidos
  doarItem(fraldaG, mariana, 5, 'entregue', 20);
  doarItem(fraldaG, rafael, 25, 'entregue', 15);
  doarItem(fraldaG, carlos, 16, 'entregue', 9);
  doarItem(fraldaG, juliana, 18, 'prometida', 1, somarDias(3));
  doarItem(fraldaXG, beatriz, 20, 'entregue', 12);
  doarItem(lencos, pedro, 36, 'entregue', 18);
  doarItem(lencos, mariana, 25, 'entregue', 6);
  doarItem(abafador, rafael, 6, 'entregue', 25);
  doarItem(abafador, mariana, 2, 'prometida', 0, somarDias(4));
  doarItem(sensorial, juliana, 12, 'entregue', 14);
  doarItem(frutas, carlos, 90, 'entregue', 4);
  doarItem(leite, pedro, 120, 'entregue', 8);
  doarItem(papel, beatriz, 15, 'entregue', 10);

  // PIX: Mariana já doou 3 vezes (confirmadas) e tem 1 aguardando confirmação
  doarPix(girassol, mariana, 50, 'confirmada', 40, 'Para as fraldas!');
  doarPix(girassol, mariana, 30, 'confirmada', 22);
  doarPix(girassol, mariana, 100, 'confirmada', 7, 'Em homenagem ao meu sobrinho Lucas');
  doarPix(girassol, mariana, 25, 'informada', 0);
  doarPix(girassol, rafael, 200, 'confirmada', 11);
  doarPix(girassol, carlos, 50, 'confirmada', 3);
  doarPix(girassol, beatriz, 20, 'informada', 1, 'Pouquinho mas de coração');
})();

console.log('Banco de demonstração criado em', arquivo);
console.log('  ONG (creche Girassol Azul): ong@demo.com / 123456');
console.log('  Voluntário/doador:          voluntario@demo.com / 123456');
