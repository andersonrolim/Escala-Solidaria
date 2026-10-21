const express = require('express');
const QRCode = require('qrcode');
const { exigir } = require('./auth');
const { ErroHttp, agoraLocal, duracaoHoras, SQL_DURACAO, CATEGORIAS } = require('../utils');
const { inscrever, cancelar } = require('../servicos/inscricoes');

const SELECT_TURNO = `
  SELECT t.*, o.nome AS ong_nome, o.cidade AS ong_cidade,
         (SELECT COUNT(*) FROM inscricoes x WHERE x.turno_id = t.id AND x.status = 'confirmada') AS ocupadas,
         mi.id AS minha_inscricao_id, mi.status AS minha_inscricao
    FROM turnos t
    JOIN ongs o ON o.id = t.ong_id
    LEFT JOIN inscricoes mi ON mi.turno_id = t.id AND mi.voluntario_id = ? AND mi.status != 'cancelada'`;

function formatarTurno(t) {
  return {
    ...t,
    online: !!t.online,
    lista_espera: !!t.lista_espera,
    lembrete_whatsapp: !!t.lembrete_whatsapp,
    lembrete_email: !!t.lembrete_email,
    duracao: duracaoHoras(t.hora_inicio, t.hora_fim),
    vagas_livres: Math.max(0, t.vagas - t.ocupadas)
  };
}

/** Rotas públicas de turnos (listagem/detalhe) e inscrição do voluntário. */
function rotasTurnos(db) {
  const r = express.Router();

  r.get('/categorias', (req, res) => res.json({ categorias: CATEGORIAS }));

  r.get('/', (req, res) => {
    const uid = req.session.usuario?.id ?? 0;
    const params = [uid, agoraLocal().dt];
    let sql = `${SELECT_TURNO} WHERE t.status = 'publicado' AND (t.data || ' ' || t.hora_inicio) > ?`;
    if (req.query.categoria && req.query.categoria !== 'Todos') {
      sql += ' AND t.categoria = ?';
      params.push(String(req.query.categoria));
    }
    if (req.query.q) {
      sql += ' AND (t.titulo LIKE ? OR o.nome LIKE ? OR t.endereco LIKE ?)';
      const q = `%${String(req.query.q).trim()}%`;
      params.push(q, q, q);
    }
    sql += ' ORDER BY t.data, t.hora_inicio LIMIT 200';
    res.json({ turnos: db.prepare(sql).all(...params).map(formatarTurno) });
  });

  r.get('/:id', (req, res) => {
    const uid = req.session.usuario?.id ?? 0;
    const t = db.prepare(`${SELECT_TURNO} WHERE t.id = ? AND t.status != 'rascunho'`).get(uid, Number(req.params.id));
    if (!t) throw new ErroHttp(404, 'Turno não encontrado.');
    res.json({ turno: formatarTurno(t) });
  });

  r.post('/:id/inscricao', exigir('voluntario'), (req, res) => {
    const i = inscrever(db, Number(req.params.id), req.session.usuario.id);
    res.status(201).json({
      inscricao: i,
      mensagem: i.status === 'confirmada'
        ? 'Inscrição confirmada! Você vai receber um lembrete 24h antes do turno.'
        : 'Turno lotado: você entrou na lista de espera e será avisado se abrir vaga.'
    });
  });

  r.delete('/:id/inscricao', exigir('voluntario'), (req, res) => {
    res.json(cancelar(db, Number(req.params.id), req.session.usuario.id));
  });

  return r;
}

/** Rotas da área "Meus turnos" do voluntário. */
function rotasMe(db) {
  const r = express.Router();
  r.use(exigir('voluntario'));

  r.get('/inscricoes', (req, res) => {
    const agora = agoraLocal().dt;
    const linhas = db.prepare(`
      SELECT i.id, i.status, i.presenca, i.codigo, i.checkin_em,
             t.id AS turno_id, t.titulo, t.categoria, t.data, t.hora_inicio, t.hora_fim, t.status AS turno_status,
             o.nome AS ong_nome
        FROM inscricoes i JOIN turnos t ON t.id = i.turno_id JOIN ongs o ON o.id = t.ong_id
       WHERE i.voluntario_id = ? AND i.status != 'cancelada'`).all(req.session.usuario.id);
    const proximos = [];
    const historico = [];
    for (const l of linhas) {
      const item = { ...l, horas: l.presenca === 'presente' ? duracaoHoras(l.hora_inicio, l.hora_fim) : 0 };
      if (`${l.data} ${l.hora_fim}` > agora && l.turno_status !== 'cancelado') proximos.push(item);
      else if (l.status === 'confirmada') historico.push(item);
    }
    proximos.sort((a, b) => (a.data + a.hora_inicio).localeCompare(b.data + b.hora_inicio));
    historico.sort((a, b) => (b.data + b.hora_inicio).localeCompare(a.data + a.hora_inicio));
    res.json({ proximos, historico });
  });

  r.get('/resumo', (req, res) => {
    const ano = /^\d{4}$/.test(req.query.ano || '') ? req.query.ano : String(new Date().getFullYear());
    const s = db.prepare(`
      SELECT COALESCE(SUM(${SQL_DURACAO}), 0) AS horas, COUNT(*) AS turnos, COUNT(DISTINCT t.ong_id) AS ongs
        FROM inscricoes i JOIN turnos t ON t.id = i.turno_id
       WHERE i.voluntario_id = ? AND i.status = 'confirmada' AND i.presenca = 'presente' AND substr(t.data, 1, 4) = ?`)
      .get(req.session.usuario.id, ano);
    const detalhes = db.prepare(`
      SELECT t.titulo, t.data, t.hora_inicio, t.hora_fim, o.nome AS ong_nome, ${SQL_DURACAO} AS horas
        FROM inscricoes i JOIN turnos t ON t.id = i.turno_id JOIN ongs o ON o.id = t.ong_id
       WHERE i.voluntario_id = ? AND i.status = 'confirmada' AND i.presenca = 'presente' AND substr(t.data, 1, 4) = ?
       ORDER BY t.data`).all(req.session.usuario.id, ano);
    res.json({ ano: Number(ano), nome: req.session.usuario.nome, horas: s.horas, turnos: s.turnos, ongs: s.ongs, detalhes });
  });

  r.get('/inscricoes/:id/checkin', async (req, res) => {
    const i = db.prepare(`
      SELECT i.id, i.status, i.presenca, i.codigo, i.checkin_em,
             t.titulo, t.data, t.hora_inicio, t.hora_fim, o.nome AS ong_nome
        FROM inscricoes i JOIN turnos t ON t.id = i.turno_id JOIN ongs o ON o.id = t.ong_id
       WHERE i.id = ? AND i.voluntario_id = ? AND i.status != 'cancelada'`).get(Number(req.params.id), req.session.usuario.id);
    if (!i) throw new ErroHttp(404, 'Inscrição não encontrada.');
    const qr = await QRCode.toDataURL(i.codigo, { width: 440, margin: 1, color: { dark: '#1B2430', light: '#FFFFFF' } });
    res.json({ inscricao: i, qr });
  });

  return r;
}

module.exports = { rotasTurnos, rotasMe, formatarTurno };
