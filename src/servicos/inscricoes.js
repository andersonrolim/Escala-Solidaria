const { ErroHttp, gerarCodigo, agoraLocal } = require('../utils');

/** Conta inscrições confirmadas de um turno. */
function contarOcupadas(db, turnoId) {
  return db.prepare(`SELECT COUNT(*) AS n FROM inscricoes WHERE turno_id = ? AND status = 'confirmada'`).get(turnoId).n;
}

function codigoUnico(db) {
  const existe = db.prepare('SELECT 1 FROM inscricoes WHERE codigo = ?');
  for (let i = 0; i < 10; i++) {
    const c = gerarCodigo();
    if (!existe.get(c)) return c;
  }
  throw new Error('Não foi possível gerar um código único.');
}

/**
 * Promove voluntários da lista de espera enquanto houver vaga.
 * Registra uma notificação (simulada) para cada promovido.
 * @returns {number} quantos foram promovidos
 */
function promoverEspera(db, turnoId) {
  const turno = db.prepare('SELECT * FROM turnos WHERE id = ?').get(turnoId);
  let livres = turno.vagas - contarOcupadas(db, turnoId);
  let promovidos = 0;
  while (livres > 0) {
    const prox = db.prepare(`SELECT id FROM inscricoes WHERE turno_id = ? AND status = 'espera'
                             ORDER BY criado_em, id LIMIT 1`).get(turnoId);
    if (!prox) break;
    db.prepare(`UPDATE inscricoes SET status = 'confirmada', atualizado_em = datetime('now','localtime') WHERE id = ?`).run(prox.id);
    const msg = `Abriu uma vaga! Sua inscrição em "${turno.titulo}" (${turno.data} às ${turno.hora_inicio}) foi confirmada.`;
    const ins = db.prepare(`INSERT OR IGNORE INTO notificacoes (inscricao_id, canal, tipo, mensagem) VALUES (?, ?, 'promovido_espera', ?)`);
    if (turno.lembrete_whatsapp) ins.run(prox.id, 'whatsapp', msg);
    if (turno.lembrete_email) ins.run(prox.id, 'email', msg);
    livres--;
    promovidos++;
  }
  return promovidos;
}

/**
 * Inscreve um voluntário num turno.
 * - Com vaga: confirmada.
 * - Lotado com lista de espera: espera.
 * - Lotado sem lista de espera: erro 409.
 */
function inscrever(db, turnoId, voluntarioId, agora = agoraLocal()) {
  return db.transaction(() => {
    const turno = db.prepare('SELECT * FROM turnos WHERE id = ?').get(turnoId);
    if (!turno || turno.status === 'rascunho') throw new ErroHttp(404, 'Turno não encontrado.');
    if (turno.status === 'cancelado') throw new ErroHttp(409, 'Este turno foi cancelado pela ONG.');
    if (`${turno.data} ${turno.hora_inicio}` <= agora.dt) throw new ErroHttp(409, 'Este turno já começou ou já passou.');

    const atual = db.prepare('SELECT * FROM inscricoes WHERE turno_id = ? AND voluntario_id = ?').get(turnoId, voluntarioId);
    if (atual && atual.status !== 'cancelada') throw new ErroHttp(409, 'Você já está inscrito neste turno.');

    const ocupadas = contarOcupadas(db, turnoId);
    let status;
    if (ocupadas < turno.vagas) status = 'confirmada';
    else if (turno.lista_espera) status = 'espera';
    else throw new ErroHttp(409, 'Turno lotado. Não há mais vagas.');

    if (atual) {
      db.prepare(`UPDATE inscricoes SET status = ?, presenca = 'aguardando', checkin_em = NULL,
                  criado_em = datetime('now','localtime'), atualizado_em = datetime('now','localtime') WHERE id = ?`)
        .run(status, atual.id);
      return db.prepare('SELECT * FROM inscricoes WHERE id = ?').get(atual.id);
    }
    const r = db.prepare(`INSERT INTO inscricoes (turno_id, voluntario_id, status, codigo) VALUES (?, ?, ?, ?)`)
      .run(turnoId, voluntarioId, status, codigoUnico(db));
    return db.prepare('SELECT * FROM inscricoes WHERE id = ?').get(r.lastInsertRowid);
  })();
}

/** Cancela a inscrição do voluntário e, se liberou vaga, promove a lista de espera. */
function cancelar(db, turnoId, voluntarioId, agora = agoraLocal()) {
  return db.transaction(() => {
    const turno = db.prepare('SELECT * FROM turnos WHERE id = ?').get(turnoId);
    if (!turno) throw new ErroHttp(404, 'Turno não encontrado.');
    const atual = db.prepare(`SELECT * FROM inscricoes WHERE turno_id = ? AND voluntario_id = ? AND status != 'cancelada'`)
      .get(turnoId, voluntarioId);
    if (!atual) throw new ErroHttp(404, 'Você não está inscrito neste turno.');
    if (`${turno.data} ${turno.hora_inicio}` <= agora.dt) throw new ErroHttp(409, 'Não é possível cancelar um turno que já começou.');
    db.prepare(`UPDATE inscricoes SET status = 'cancelada', atualizado_em = datetime('now','localtime') WHERE id = ?`).run(atual.id);
    const promovidos = atual.status === 'confirmada' ? promoverEspera(db, turnoId) : 0;
    return { cancelada: true, promovidos };
  })();
}

module.exports = { inscrever, cancelar, promoverEspera, contarOcupadas };
