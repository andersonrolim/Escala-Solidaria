const { agoraLocal } = require('../utils');

/**
 * Procura inscrições confirmadas cujo turno começa nas próximas 24h
 * e registra o lembrete (WhatsApp e/ou e-mail, conforme o turno).
 *
 * IMPORTANTE: o envio é SIMULADO — a mensagem é gravada na tabela
 * `notificacoes` e impressa no console. Para enviar de verdade, troque
 * a função `enviar` por uma integração (ex.: API oficial do WhatsApp
 * Business, Twilio, Nodemailer/SMTP).
 */
function processarLembretes(db, agoraDate = new Date(), enviar = (canal, destino, msg) => {
  console.log(`[lembrete simulado] ${canal} → ${destino}: ${msg}`);
}) {
  const agora = agoraLocal(agoraDate);
  const limite = agoraLocal(new Date(agoraDate.getTime() + 24 * 60 * 60 * 1000));
  const pendentes = db.prepare(`
    SELECT i.id AS inscricao_id, u.nome, u.email, u.telefone,
           t.titulo, t.data, t.hora_inicio, t.lembrete_whatsapp, t.lembrete_email, o.nome AS ong_nome
      FROM inscricoes i
      JOIN turnos t   ON t.id = i.turno_id
      JOIN usuarios u ON u.id = i.voluntario_id
      JOIN ongs o     ON o.id = t.ong_id
     WHERE i.status = 'confirmada' AND t.status = 'publicado'
       AND (t.data || ' ' || t.hora_inicio) > ?
       AND (t.data || ' ' || t.hora_inicio) <= ?`).all(agora.dt, limite.dt);

  const inserir = db.prepare(`INSERT OR IGNORE INTO notificacoes (inscricao_id, canal, tipo, mensagem)
                              VALUES (?, ?, 'lembrete_24h', ?)`);
  let enviados = 0;
  for (const p of pendentes) {
    const msg = `Olá, ${p.nome.split(' ')[0]}! Lembrete: amanhã você tem "${p.titulo}" com ${p.ong_nome}, ` +
      `${p.data.split('-').reverse().join('/')} às ${p.hora_inicio}. Leve seu QR Code de check-in.`;
    const canais = [];
    if (p.lembrete_whatsapp && p.telefone) canais.push(['whatsapp', p.telefone]);
    if (p.lembrete_email) canais.push(['email', p.email]);
    for (const [canal, destino] of canais) {
      if (inserir.run(p.inscricao_id, canal, msg).changes) {
        enviar(canal, destino, msg);
        enviados++;
      }
    }
  }
  return enviados;
}

module.exports = { processarLembretes };
