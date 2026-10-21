const { ErroHttp, gerarCodigo, agoraLocal } = require('../utils');

/** Conta inscrições confirmadas de um turno. */
async function contarOcupadas(db, turnoId) {
  return (await db.get(`SELECT COUNT(*) AS n FROM inscricoes WHERE turno_id = ? AND status = 'confirmada'`, turnoId)).n;
}

async function codigoUnico(db) {
  for (let i = 0; i < 10; i++) {
    const c = gerarCodigo();
    if (!(await db.get('SELECT 1 FROM inscricoes WHERE codigo = ?', c))) return c;
  }
  throw new Error('Não foi possível gerar um código único.');
}

/**
 * Promove voluntários da lista de espera enquanto houver vaga.
 * Registra uma notificação (simulada) para cada promovido.
 * @returns {Promise<number>} quantos foram promovidos
 */
async function promoverEspera(db, turnoId) {
  const turno = await db.get('SELECT * FROM turnos WHERE id = ?', turnoId);
  let livres = turno.vagas - (await contarOcupadas(db, turnoId));
  let promovidos = 0;
  while (livres > 0) {
    const prox = await db.get(`SELECT id FROM inscricoes WHERE turno_id = ? AND status = 'espera'
                               ORDER BY criado_em, id LIMIT 1`, turnoId);
    if (!prox) break;
    await db.run(`UPDATE inscricoes SET status = 'confirmada', atualizado_em = ${db.AGORA} WHERE id = ?`, prox.id);
    const msg = `Abriu uma vaga! Sua inscrição em "${turno.titulo}" (${turno.data} às ${turno.hora_inicio}) foi confirmada.`;
    const sql = `INSERT INTO notificacoes (inscricao_id, canal, tipo, mensagem) VALUES (?, ?, 'promovido_espera', ?)
                 ON CONFLICT DO NOTHING`;
    if (turno.lembrete_whatsapp) await db.run(sql, prox.id, 'whatsapp', msg);
    if (turno.lembrete_email) await db.run(sql, prox.id, 'email', msg);
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
async function inscrever(db, turnoId, voluntarioId, agora = agoraLocal()) {
  return db.transaction(async () => {
    const turno = await db.get('SELECT * FROM turnos WHERE id = ?', turnoId);
    if (!turno || turno.status === 'rascunho') throw new ErroHttp(404, 'Turno não encontrado.');
    if (turno.status === 'cancelado') throw new ErroHttp(409, 'Este turno foi cancelado pela ONG.');
    if (`${turno.data} ${turno.hora_inicio}` <= agora.dt) throw new ErroHttp(409, 'Este turno já começou ou já passou.');

    const atual = await db.get('SELECT * FROM inscricoes WHERE turno_id = ? AND voluntario_id = ?', turnoId, voluntarioId);
    if (atual && atual.status !== 'cancelada') throw new ErroHttp(409, 'Você já está inscrito neste turno.');

    const ocupadas = await contarOcupadas(db, turnoId);
    let status;
    if (ocupadas < turno.vagas) status = 'confirmada';
    else if (turno.lista_espera) status = 'espera';
    else throw new ErroHttp(409, 'Turno lotado. Não há mais vagas.');

    if (atual) {
      await db.run(`UPDATE inscricoes SET status = ?, presenca = 'aguardando', checkin_em = NULL,
                    criado_em = ${db.AGORA}, atualizado_em = ${db.AGORA} WHERE id = ?`, status, atual.id);
      return db.get('SELECT * FROM inscricoes WHERE id = ?', atual.id);
    }
    const r = await db.run(`INSERT INTO inscricoes (turno_id, voluntario_id, status, codigo) VALUES (?, ?, ?, ?)`,
      turnoId, voluntarioId, status, await codigoUnico(db));
    return db.get('SELECT * FROM inscricoes WHERE id = ?', r.lastInsertRowid);
  })();
}

/** Cancela a inscrição do voluntário e, se liberou vaga, promove a lista de espera. */
async function cancelar(db, turnoId, voluntarioId, agora = agoraLocal()) {
  return db.transaction(async () => {
    const turno = await db.get('SELECT * FROM turnos WHERE id = ?', turnoId);
    if (!turno) throw new ErroHttp(404, 'Turno não encontrado.');
    const atual = await db.get(`SELECT * FROM inscricoes WHERE turno_id = ? AND voluntario_id = ? AND status != 'cancelada'`, turnoId, voluntarioId);
    if (!atual) throw new ErroHttp(404, 'Você não está inscrito neste turno.');
    if (`${turno.data} ${turno.hora_inicio}` <= agora.dt) throw new ErroHttp(409, 'Não é possível cancelar um turno que já começou.');
    await db.run(`UPDATE inscricoes SET status = 'cancelada', atualizado_em = ${db.AGORA} WHERE id = ?`, atual.id);
    const promovidos = atual.status === 'confirmada' ? await promoverEspera(db, turnoId) : 0;
    return { cancelada: true, promovidos };
  })();
}

module.exports = { inscrever, cancelar, promoverEspera, contarOcupadas };
