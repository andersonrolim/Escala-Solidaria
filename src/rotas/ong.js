const express = require('express');
const { exigir } = require('./auth');
const { ErroHttp, agoraLocal, somarDias, SQL_DURACAO, validarTurno, duracaoHoras } = require('../utils');
const { promoverEspera, contarOcupadas } = require('../servicos/inscricoes');

function rotasOng(db) {
  const r = express.Router();
  r.use(exigir('ong'));

  /** Busca um turno garantindo que pertence à ONG logada. */
  const turnoDaOng = async (req, id) => {
    const t = (await db.get('SELECT * FROM turnos WHERE id = ? AND ong_id = ?', Number(id), req.session.usuario.ongId));
    if (!t) throw new ErroHttp(404, 'Turno não encontrado.');
    return t;
  };

  const SELECT_LISTA = `
    SELECT t.*,
      (SELECT COUNT(*) FROM inscricoes x WHERE x.turno_id = t.id AND x.status = 'confirmada') AS ocupadas,
      (SELECT COUNT(*) FROM inscricoes x WHERE x.turno_id = t.id AND x.status = 'espera') AS em_espera
    FROM turnos t WHERE t.ong_id = ?`;

  r.get('/painel', async (req, res) => {
    const ongId = req.session.usuario.ongId;
    const agora = agoraLocal();
    const fimSemana = somarDias(7);
    const inicio30 = somarDias(-30);
    const mes = agora.data.slice(0, 7);

    const semana = (await db.get(`
      SELECT COUNT(DISTINCT t.id) AS turnos,
             COUNT(i.id) AS inscritos
        FROM turnos t LEFT JOIN inscricoes i ON i.turno_id = t.id AND i.status = 'confirmada'
       WHERE t.ong_id = ? AND t.status = 'publicado' AND t.data BETWEEN ? AND ?`, ongId, agora.data, fimSemana));

    // Taxa de presença: entre os confirmados de turnos já encerrados nos últimos 30 dias.
    const presenca = (await db.get(`
      SELECT COUNT(*) AS total, SUM(CASE WHEN i.presenca = 'presente' THEN 1 ELSE 0 END) AS presentes
        FROM inscricoes i JOIN turnos t ON t.id = i.turno_id
       WHERE t.ong_id = ? AND t.status = 'publicado' AND i.status = 'confirmada'
         AND t.data >= ? AND (t.data || ' ' || t.hora_fim) <= ?`, ongId, inicio30, agora.dt));

    const horasMes = (await db.get(`
      SELECT COALESCE(SUM(${SQL_DURACAO}), 0) AS horas
        FROM inscricoes i JOIN turnos t ON t.id = i.turno_id
       WHERE t.ong_id = ? AND i.status = 'confirmada' AND i.presenca = 'presente' AND substr(t.data, 1, 7) = ?`, ongId, mes));

    const proximos = (await db.all(`${SELECT_LISTA} AND t.status != 'cancelado' AND (t.data || ' ' || t.hora_fim) > ?
                                 ORDER BY t.data, t.hora_inicio LIMIT 10`, ongId, agora.dt));

    const atividade = (await db.all(`
      SELECT i.status, i.presenca, i.checkin_em, i.atualizado_em, u.nome, t.titulo, t.data
        FROM inscricoes i JOIN turnos t ON t.id = i.turno_id JOIN usuarios u ON u.id = i.voluntario_id
       WHERE t.ong_id = ? ORDER BY i.atualizado_em DESC, i.id DESC LIMIT 8`, ongId));

    res.json({
      ong: req.session.usuario.ongNome,
      kpis: {
        turnos_semana: semana.turnos,
        inscritos_semana: semana.inscritos,
        precisam_gente: proximos.filter((t) => t.status === 'publicado' && t.ocupadas < t.vagas / 2).length,
        taxa_presenca: presenca.total ? Math.round((presenca.presentes / presenca.total) * 100) : null,
        horas_mes: horasMes.horas
      },
      proximos,
      atividade
    });
  });

  r.get('/turnos', async (req, res) => {
    res.json({ turnos: (await db.all(`${SELECT_LISTA} ORDER BY t.data DESC, t.hora_inicio DESC`, req.session.usuario.ongId)) });
  });

  r.get('/turnos/:id', async (req, res) => {
    await turnoDaOng(req, req.params.id);
    const t = (await db.get(`${SELECT_LISTA} AND t.id = ?`, req.session.usuario.ongId, Number(req.params.id)));
    res.json({ turno: t });
  });

  r.post('/turnos', async (req, res) => {
    const d = validarTurno(req.body);
    if (d.status === 'publicado' && `${d.data} ${d.hora_inicio}` <= agoraLocal().dt) {
      throw new ErroHttp(400, 'A data e o horário de início precisam estar no futuro.');
    }
    const info = (await db.run(`
      INSERT INTO turnos (ong_id, titulo, categoria, descricao, requisitos, data, hora_inicio, hora_fim, online, endereco,
                          vagas, lembrete_whatsapp, lembrete_email, lista_espera, status)
      VALUES (@ong_id, @titulo, @categoria, @descricao, @requisitos, @data, @hora_inicio, @hora_fim, @online, @endereco,
              @vagas, @lembrete_whatsapp, @lembrete_email, @lista_espera, @status)`, { ...d, ong_id: req.session.usuario.ongId }));
    res.status(201).json({ turno: (await db.get('SELECT * FROM turnos WHERE id = ?', info.lastInsertRowid)) });
  });

  r.put('/turnos/:id', async (req, res) => {
    const atual = await turnoDaOng(req, req.params.id);
    if (atual.status === 'cancelado') throw new ErroHttp(409, 'Turno cancelado não pode ser editado.');
    const d = validarTurno(req.body);
    const ocupadas = await contarOcupadas(db, atual.id);
    if (d.vagas < ocupadas) throw new ErroHttp(400, `Já existem ${ocupadas} voluntários confirmados. Não dá para reduzir as vagas abaixo disso.`);
    await db.transaction(async () => {
      (await db.run(`
        UPDATE turnos SET titulo=@titulo, categoria=@categoria, descricao=@descricao, requisitos=@requisitos, data=@data,
               hora_inicio=@hora_inicio, hora_fim=@hora_fim, online=@online, endereco=@endereco, vagas=@vagas,
               lembrete_whatsapp=@lembrete_whatsapp, lembrete_email=@lembrete_email, lista_espera=@lista_espera, status=@status
         WHERE id=@id`, { ...d, id: atual.id }));
      await promoverEspera(db, atual.id);
    })();
    res.json({ turno: (await db.get('SELECT * FROM turnos WHERE id = ?', atual.id)) });
  });

  r.post('/turnos/:id/cancelar', async (req, res) => {
    const t = await turnoDaOng(req, req.params.id);
    (await db.run(`UPDATE turnos SET status = 'cancelado' WHERE id = ?`, t.id));
    res.json({ ok: true });
  });

  const listaPresenca = async (turnoId) => (await db.all(`
    SELECT i.id, i.status, i.presenca, i.codigo, i.checkin_em, i.criado_em,
           u.nome, u.email, u.telefone,
           (SELECT COUNT(*) FROM inscricoes y WHERE y.voluntario_id = u.id AND y.presenca = 'presente') AS turnos_feitos
      FROM inscricoes i JOIN usuarios u ON u.id = i.voluntario_id
     WHERE i.turno_id = ? AND i.status != 'cancelada'
     ORDER BY CASE i.status WHEN 'confirmada' THEN 0 ELSE 1 END, u.nome`, turnoId));

  r.get('/turnos/:id/presenca', async (req, res) => {
    const t = await turnoDaOng(req, req.params.id);
    const lista = await listaPresenca(t.id);
    const conf = lista.filter((l) => l.status === 'confirmada');
    res.json({
      turno: { ...t, duracao: duracaoHoras(t.hora_inicio, t.hora_fim) },
      resumo: {
        inscritos: conf.length,
        presentes: conf.filter((l) => l.presenca === 'presente').length,
        aguardando: conf.filter((l) => l.presenca === 'aguardando').length,
        ausentes: conf.filter((l) => l.presenca === 'ausente').length,
        em_espera: lista.length - conf.length
      },
      lista
    });
  });

  r.get('/turnos/:id/presenca-csv', async (req, res) => {
    const t = await turnoDaOng(req, req.params.id);
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const linhas = [['Nome', 'E-mail', 'Telefone', 'Inscrição', 'Presença', 'Check-in'].map(esc).join(';')];
    for (const l of await listaPresenca(t.id)) {
      linhas.push([l.nome, l.email, l.telefone, l.status, l.presenca, l.checkin_em].map(esc).join(';'));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="presenca-turno-${t.id}.csv"`);
    res.send('﻿' + linhas.join('\r\n'));
  });

  r.patch('/inscricoes/:id/presenca', async (req, res) => {
    const presenca = req.body.presenca;
    if (!['aguardando', 'presente', 'ausente'].includes(presenca)) throw new ErroHttp(400, 'Valor de presença inválido.');
    const i = (await db.get(`
      SELECT i.* FROM inscricoes i JOIN turnos t ON t.id = i.turno_id
       WHERE i.id = ? AND t.ong_id = ?`, Number(req.params.id), req.session.usuario.ongId));
    if (!i) throw new ErroHttp(404, 'Inscrição não encontrada.');
    if (i.status !== 'confirmada') throw new ErroHttp(409, 'Só é possível marcar presença de inscrições confirmadas.');
    const checkin = presenca === 'presente' ? (i.checkin_em || agoraLocal().dt) : null;
    (await db.run(`UPDATE inscricoes SET presenca = ?, checkin_em = ?, atualizado_em = ${db.AGORA} WHERE id = ?`, presenca, checkin, i.id));
    res.json({ inscricao: (await db.get('SELECT * FROM inscricoes WHERE id = ?', i.id)) });
  });

  r.post('/checkin', async (req, res) => {
    const codigo = String(req.body.codigo || '').trim().toUpperCase();
    if (!codigo) throw new ErroHttp(400, 'Informe o código.');
    const i = (await db.get(`
      SELECT i.*, u.nome, t.titulo FROM inscricoes i
        JOIN turnos t ON t.id = i.turno_id JOIN usuarios u ON u.id = i.voluntario_id
       WHERE i.codigo = ? AND t.ong_id = ?`, codigo, req.session.usuario.ongId));
    if (!i) throw new ErroHttp(404, 'Código não encontrado nos turnos desta ONG.');
    if (req.body.turno_id && Number(req.body.turno_id) !== i.turno_id) throw new ErroHttp(409, `Este código é de outro turno ("${i.titulo}").`);
    if (i.status !== 'confirmada') throw new ErroHttp(409, 'Esta inscrição não está confirmada.');
    if (i.presenca === 'presente') return res.json({ ja_registrado: true, nome: i.nome, checkin_em: i.checkin_em });
    const agora = agoraLocal().dt;
    (await db.run(`UPDATE inscricoes SET presenca = 'presente', checkin_em = ?, atualizado_em = ${db.AGORA} WHERE id = ?`, agora, i.id));
    res.json({ ja_registrado: false, nome: i.nome, checkin_em: agora });
  });

  return r;
}

module.exports = { rotasOng };
