const express = require('express');
const QRCode = require('qrcode');
const { exigir } = require('./auth');
const { ErroHttp, CATEGORIAS_ITENS, UNIDADES, agoraLocal } = require('../utils');
const { gerarPayloadPix, normalizarChave, TIPOS_CHAVE } = require('../servicos/pix');
const { reciboPix, declaracaoAnual } = require('../servicos/recibos');

const SELECT_NECESSIDADE = `
  SELECT n.*,
    COALESCE((SELECT SUM(quantidade) FROM doacoes_itens d WHERE d.necessidade_id = n.id AND d.status = 'entregue'), 0) AS entregue,
    COALESCE((SELECT SUM(quantidade) FROM doacoes_itens d WHERE d.necessidade_id = n.id AND d.status = 'prometida'), 0) AS prometido
  FROM necessidades n`;

const fmtNecessidade = (n) => ({ ...n, urgente: !!n.urgente, ativa: !!n.ativa, falta: Math.max(0, n.meta - n.entregue - n.prometido) });

const CAMPOS_PUBLICOS_ONG = 'id, nome, descricao, historia, endereco, cidade, whatsapp, cnpj, pix_tipo, pix_chave, pix_nome, pix_cidade';

/** Monta os dados que os PDFs precisam para uma doação PIX. */
async function dadosRecibo(db, id) {
  const doacao = (await db.get('SELECT * FROM doacoes_pix WHERE id = ?', id));
  const ong = (await db.get('SELECT * FROM ongs WHERE id = ?', doacao.ong_id));
  const doador = (await db.get('SELECT nome, email FROM usuarios WHERE id = ?', doacao.doador_id));
  const hist = (await db.get(`
    SELECT COUNT(*) AS ordem, SUM(valor_centavos) AS total FROM doacoes_pix
     WHERE ong_id = ? AND doador_id = ? AND status = 'confirmada' AND id <= ?`, doacao.ong_id, doacao.doador_id, doacao.id));
  return { doacao, ong, doador, ordem: hist.ordem, totalConfirmado: hist.total };
}

function enviarPdf(res, nomeArquivo, gerar) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo}"`);
  gerar(res);
}

/** Rotas públicas e do doador (prefixo /api). */
function rotasDoacoes(db) {
  const r = express.Router();

  r.get('/doacoes/opcoes', async (req, res) => res.json({ categorias: CATEGORIAS_ITENS, unidades: UNIDADES, tipos_chave: TIPOS_CHAVE }));

  r.get('/ongs', async (req, res) => {
    const ongs = (await db.all(`
      SELECT o.id, o.nome, o.descricao, o.cidade, (o.pix_chave IS NOT NULL AND o.pix_chave != '') AS tem_pix,
        (SELECT COUNT(*) FROM necessidades n WHERE n.ong_id = o.id AND n.ativa = 1) AS necessidades,
        (SELECT COUNT(*) FROM necessidades n WHERE n.ong_id = o.id AND n.ativa = 1 AND n.urgente = 1) AS urgentes
      FROM ongs o ORDER BY urgentes DESC, necessidades DESC, o.nome`));
    res.json({ ongs: ongs.map((o) => ({ ...o, tem_pix: !!o.tem_pix })) });
  });

  r.get('/ongs/:id', async (req, res) => {
    const ong = (await db.get(`SELECT ${CAMPOS_PUBLICOS_ONG} FROM ongs WHERE id = ?`, Number(req.params.id)));
    if (!ong) throw new ErroHttp(404, 'ONG não encontrada.');
    const necessidades = (await db.all(`${SELECT_NECESSIDADE} WHERE n.ong_id = ? AND n.ativa = 1 ORDER BY n.urgente DESC, n.criado_em DESC`, ong.id)).map(fmtNecessidade);
    const agora = agoraLocal().dt;
    const stats = (await db.get(`
      SELECT (SELECT COUNT(DISTINCT doador_id) FROM (
                SELECT doador_id FROM doacoes_pix WHERE ong_id = ? AND status = 'confirmada'
                UNION SELECT d.doador_id FROM doacoes_itens d JOIN necessidades n ON n.id = d.necessidade_id
                 WHERE n.ong_id = ? AND d.status = 'entregue') AS doadores_unicos) AS doadores,
             (SELECT COUNT(*) FROM turnos WHERE ong_id = ? AND status = 'publicado' AND (data || ' ' || hora_inicio) > ?) AS turnos_abertos`, ong.id, ong.id, ong.id, agora));
    res.json({ ong, necessidades, stats });
  });

  r.get('/ongs/:id/pix', async (req, res) => {
    const ong = (await db.get('SELECT * FROM ongs WHERE id = ?', Number(req.params.id)));
    if (!ong) throw new ErroHttp(404, 'ONG não encontrada.');
    if (!ong.pix_chave) throw new ErroHttp(400, 'Esta ONG ainda não cadastrou uma chave PIX.');
    const valor = Number(String(req.query.valor || '0').replace(',', '.'));
    const payload = gerarPayloadPix({
      chave: ong.pix_chave, nome: ong.pix_nome || ong.nome, cidade: ong.pix_cidade || ong.cidade,
      valor: valor > 0 ? valor : undefined
    });
    const qr = await QRCode.toDataURL(payload, { width: 440, margin: 1, color: { dark: '#1B2430', light: '#FFFFFF' } });
    res.json({ payload, qr, chave: ong.pix_chave, tipo: ong.pix_tipo, recebedor: ong.pix_nome || ong.nome });
  });

  // ---- Ações do doador ----
  r.post('/necessidades/:id/doacoes', exigir('voluntario'), async (req, res) => {
    const n = (await db.get('SELECT * FROM necessidades WHERE id = ?', Number(req.params.id)));
    if (!n || !n.ativa) throw new ErroHttp(404, 'Este pedido de doação não está mais ativo.');
    const quantidade = Number(req.body.quantidade);
    if (!Number.isInteger(quantidade) || quantidade < 1 || quantidade > 10000) throw new ErroHttp(400, 'Informe uma quantidade válida.');
    const previsao = /^\d{4}-\d{2}-\d{2}$/.test(req.body.previsao_entrega || '') ? req.body.previsao_entrega : null;
    const info = (await db.run(`INSERT INTO doacoes_itens (necessidade_id, doador_id, quantidade, previsao_entrega, observacao)
                             VALUES (?, ?, ?, ?, ?)`, n.id, req.session.usuario.id, quantidade, previsao, String(req.body.observacao || '').trim().slice(0, 300)));
    res.status(201).json({
      doacao: (await db.get('SELECT * FROM doacoes_itens WHERE id = ?', info.lastInsertRowid)),
      mensagem: 'Obrigado! Sua doação foi registrada. Combine a entrega com a ONG pelo WhatsApp.'
    });
  });

  r.post('/ongs/:id/doacoes-pix', exigir('voluntario'), async (req, res) => {
    const ong = (await db.get('SELECT id, pix_chave FROM ongs WHERE id = ?', Number(req.params.id)));
    if (!ong) throw new ErroHttp(404, 'ONG não encontrada.');
    if (!ong.pix_chave) throw new ErroHttp(400, 'Esta ONG ainda não cadastrou uma chave PIX.');
    const valor = Number(String(req.body.valor ?? '').replace(',', '.'));
    if (!(valor >= 1 && valor <= 100000)) throw new ErroHttp(400, 'Informe um valor entre R$ 1,00 e R$ 100.000,00.');
    const info = (await db.run(`INSERT INTO doacoes_pix (ong_id, doador_id, valor_centavos, mensagem) VALUES (?, ?, ?, ?)`, ong.id, req.session.usuario.id, Math.round(valor * 100), String(req.body.mensagem || '').trim().slice(0, 200)));
    res.status(201).json({
      doacao: (await db.get('SELECT * FROM doacoes_pix WHERE id = ?', info.lastInsertRowid)),
      mensagem: 'Obrigado! A ONG vai conferir o PIX no extrato e, ao confirmar, seu recibo fica disponível em "Minhas doações".'
    });
  });

  r.get('/me/doacoes', exigir('voluntario'), async (req, res) => {
    const uid = req.session.usuario.id;
    const pix = (await db.all(`
      SELECT p.*, o.nome AS ong_nome, o.whatsapp AS ong_whatsapp FROM doacoes_pix p JOIN ongs o ON o.id = p.ong_id
       WHERE p.doador_id = ? ORDER BY p.criado_em DESC, p.id DESC`, uid));
    const itens = (await db.all(`
      SELECT d.*, n.nome, n.unidade, n.categoria, o.id AS ong_id, o.nome AS ong_nome, o.whatsapp AS ong_whatsapp
        FROM doacoes_itens d JOIN necessidades n ON n.id = d.necessidade_id JOIN ongs o ON o.id = n.ong_id
       WHERE d.doador_id = ? ORDER BY d.criado_em DESC, d.id DESC`, uid));
    const confirmadas = pix.filter((p) => p.status === 'confirmada');
    const entregues = itens.filter((i) => i.status === 'entregue');
    const ongs = new Set([...confirmadas.map((p) => p.ong_id), ...entregues.map((i) => i.ong_id)]);
    res.json({
      resumo: {
        vezes: confirmadas.length + entregues.length,
        pix_confirmados: confirmadas.length,
        total_pix_centavos: confirmadas.reduce((s, p) => s + p.valor_centavos, 0),
        itens_entregues: entregues.length,
        ongs: ongs.size
      },
      pix,
      itens
    });
  });

  r.delete('/me/doacoes-itens/:id', exigir('voluntario'), async (req, res) => {
    const d = (await db.get('SELECT * FROM doacoes_itens WHERE id = ? AND doador_id = ?', Number(req.params.id), req.session.usuario.id));
    if (!d) throw new ErroHttp(404, 'Doação não encontrada.');
    if (d.status !== 'prometida') throw new ErroHttp(409, 'Só é possível cancelar doações que ainda não foram entregues.');
    (await db.run(`UPDATE doacoes_itens SET status = 'cancelada' WHERE id = ?`, d.id));
    res.json({ ok: true });
  });

  r.get('/me/doacoes-pix/:id/recibo', exigir('voluntario'), async (req, res) => {
    const d = (await db.get('SELECT * FROM doacoes_pix WHERE id = ? AND doador_id = ?', Number(req.params.id), req.session.usuario.id));
    if (!d) throw new ErroHttp(404, 'Doação não encontrada.');
    if (d.status !== 'confirmada') throw new ErroHttp(409, 'O recibo fica disponível depois que a ONG confirmar o recebimento.');
    const dados = await dadosRecibo(db, d.id);
    enviarPdf(res, `recibo-${d.recibo_numero}.pdf`, (out) => reciboPix(dados, out));
  });

  r.get('/me/doacoes/declaracao', exigir('voluntario'), async (req, res) => {
    const ano = /^\d{4}$/.test(req.query.ano || '') ? req.query.ano : String(new Date().getFullYear());
    const uid = req.session.usuario.id;
    const pix = (await db.all(`
      SELECT p.*, o.nome AS ong_nome FROM doacoes_pix p JOIN ongs o ON o.id = p.ong_id
       WHERE p.doador_id = ? AND p.status = 'confirmada' AND substr(p.confirmado_em, 1, 4) = ? ORDER BY p.confirmado_em`, uid, ano));
    const itens = (await db.all(`
      SELECT d.*, n.nome, n.unidade, o.nome AS ong_nome FROM doacoes_itens d
        JOIN necessidades n ON n.id = d.necessidade_id JOIN ongs o ON o.id = n.ong_id
       WHERE d.doador_id = ? AND d.status = 'entregue' AND substr(d.entregue_em, 1, 4) = ? ORDER BY d.entregue_em`, uid, ano));
    const doador = (await db.get('SELECT nome, email FROM usuarios WHERE id = ?', uid));
    enviarPdf(res, `declaracao-doacoes-${ano}.pdf`, (out) => declaracaoAnual({ doador, ano, pix, itens }, out));
  });

  return r;
}

/** Rotas da ONG para o módulo de doações (prefixo /api/ong). */
function rotasDoacoesOng(db) {
  const r = express.Router();
  r.use(exigir('ong'));
  const ongId = (req) => req.session.usuario.ongId;

  r.get('/perfil', async (req, res) => {
    res.json({ ong: (await db.get('SELECT * FROM ongs WHERE id = ?', ongId(req))) });
  });

  r.put('/perfil', async (req, res) => {
    const b = req.body;
    const nome = String(b.nome || '').trim();
    if (nome.length < 2) throw new ErroHttp(400, 'Informe o nome da ONG.');
    let pixTipo = null;
    let pixChave = null;
    if (String(b.pix_chave || '').trim()) {
      if (!TIPOS_CHAVE.includes(b.pix_tipo)) throw new ErroHttp(400, 'Escolha o tipo da chave PIX.');
      try { pixChave = normalizarChave(b.pix_tipo, b.pix_chave); } catch (e) { throw new ErroHttp(400, e.message); }
      pixTipo = b.pix_tipo;
    }
    const whatsapp = String(b.whatsapp || '').replace(/\D/g, '');
    if (whatsapp && (whatsapp.length < 10 || whatsapp.length > 13)) throw new ErroHttp(400, 'WhatsApp deve ter DDD + número.');
    const t = (v, max = 2000) => String(v || '').trim().slice(0, max);
    (await db.run(`UPDATE ongs SET nome = ?, descricao = ?, historia = ?, endereco = ?, cidade = ?, cnpj = ?, whatsapp = ?,
                pix_tipo = ?, pix_chave = ?, pix_nome = ?, pix_cidade = ? WHERE id = ?`, nome, t(b.descricao, 300), t(b.historia, 4000), t(b.endereco, 200), t(b.cidade, 80), t(b.cnpj, 20), whatsapp,
        pixTipo, pixChave, t(b.pix_nome, 25), t(b.pix_cidade, 15), ongId(req)));
    req.session.usuario.ongNome = nome;
    res.json({ ong: (await db.get('SELECT * FROM ongs WHERE id = ?', ongId(req))) });
  });

  const validarNecessidade = (b) => {
    const nome = String(b.nome || '').trim();
    const meta = Number(b.meta);
    const erros = [];
    if (nome.length < 2) erros.push('Informe o nome do item.');
    if (!CATEGORIAS_ITENS.includes(b.categoria)) erros.push('Categoria inválida.');
    if (!UNIDADES.includes(b.unidade)) erros.push('Unidade inválida.');
    if (!Number.isInteger(meta) || meta < 1 || meta > 100000) erros.push('A meta deve ser um número inteiro maior que zero.');
    if (erros.length) throw new ErroHttp(400, erros.join(' '));
    const urgente = b.urgente === true || b.urgente === 1 || b.urgente === '1' || b.urgente === 'true';
    return { nome, categoria: b.categoria, unidade: b.unidade, meta, urgente: urgente ? 1 : 0, descricao: String(b.descricao || '').trim().slice(0, 500) };
  };

  const necessidadeDaOng = async (req) => {
    const n = (await db.get('SELECT * FROM necessidades WHERE id = ? AND ong_id = ?', Number(req.params.id), ongId(req)));
    if (!n) throw new ErroHttp(404, 'Item não encontrado.');
    return n;
  };

  r.get('/necessidades', async (req, res) => {
    res.json({ necessidades: (await db.all(`${SELECT_NECESSIDADE} WHERE n.ong_id = ? ORDER BY n.ativa DESC, n.urgente DESC, n.criado_em DESC`, ongId(req))).map(fmtNecessidade) });
  });

  r.post('/necessidades', async (req, res) => {
    const d = validarNecessidade(req.body);
    const info = (await db.run(`INSERT INTO necessidades (ong_id, nome, categoria, unidade, meta, urgente, descricao)
                             VALUES (@ong_id, @nome, @categoria, @unidade, @meta, @urgente, @descricao)`, { ...d, ong_id: ongId(req) }));
    res.status(201).json({ necessidade: (await db.get('SELECT * FROM necessidades WHERE id = ?', info.lastInsertRowid)) });
  });

  r.put('/necessidades/:id', async (req, res) => {
    const n = await necessidadeDaOng(req);
    const d = validarNecessidade(req.body);
    (await db.run(`UPDATE necessidades SET nome=@nome, categoria=@categoria, unidade=@unidade, meta=@meta, urgente=@urgente, descricao=@descricao
                WHERE id=@id`, { ...d, id: n.id }));
    res.json({ necessidade: (await db.get('SELECT * FROM necessidades WHERE id = ?', n.id)) });
  });

  r.post('/necessidades/:id/encerrar', async (req, res) => {
    (await db.run('UPDATE necessidades SET ativa = 0 WHERE id = ?', (await necessidadeDaOng(req)).id));
    res.json({ ok: true });
  });

  r.post('/necessidades/:id/reabrir', async (req, res) => {
    (await db.run('UPDATE necessidades SET ativa = 1 WHERE id = ?', (await necessidadeDaOng(req)).id));
    res.json({ ok: true });
  });

  r.get('/doacoes', async (req, res) => {
    const id = ongId(req);
    const itens = (await db.all(`
      SELECT d.*, n.nome, n.unidade, u.nome AS doador_nome, u.telefone AS doador_telefone, u.email AS doador_email
        FROM doacoes_itens d JOIN necessidades n ON n.id = d.necessidade_id JOIN usuarios u ON u.id = d.doador_id
       WHERE n.ong_id = ? ORDER BY CASE d.status WHEN 'prometida' THEN 0 ELSE 1 END, d.criado_em DESC LIMIT 300`, id));
    const pix = (await db.all(`
      SELECT p.*, u.nome AS doador_nome, u.telefone AS doador_telefone, u.email AS doador_email,
        (SELECT COUNT(*) FROM doacoes_pix x WHERE x.doador_id = p.doador_id AND x.ong_id = p.ong_id AND x.status = 'confirmada') AS vezes_doador
        FROM doacoes_pix p JOIN usuarios u ON u.id = p.doador_id
       WHERE p.ong_id = ? ORDER BY CASE p.status WHEN 'informada' THEN 0 ELSE 1 END, p.criado_em DESC LIMIT 300`, id));
    const mes = agoraLocal().data.slice(0, 7);
    res.json({
      resumo: {
        pix_pendentes: pix.filter((p) => p.status === 'informada').length,
        itens_pendentes: itens.filter((i) => i.status === 'prometida').length,
        pix_mes_centavos: pix.filter((p) => p.status === 'confirmada' && (p.confirmado_em || '').startsWith(mes))
          .reduce((s, p) => s + p.valor_centavos, 0),
        doadores: new Set([...pix.filter((p) => p.status === 'confirmada').map((p) => p.doador_id),
          ...itens.filter((i) => i.status === 'entregue').map((i) => i.doador_id)]).size
      },
      itens,
      pix
    });
  });

  r.patch('/doacoes-itens/:id', async (req, res) => {
    const d = (await db.get(`SELECT d.* FROM doacoes_itens d JOIN necessidades n ON n.id = d.necessidade_id
                          WHERE d.id = ? AND n.ong_id = ?`, Number(req.params.id), ongId(req)));
    if (!d) throw new ErroHttp(404, 'Doação não encontrada.');
    const status = req.body.status;
    if (!['entregue', 'cancelada', 'prometida'].includes(status)) throw new ErroHttp(400, 'Status inválido.');
    (await db.run('UPDATE doacoes_itens SET status = ?, entregue_em = ? WHERE id = ?', status, status === 'entregue' ? agoraLocal().dt + ':00' : null, d.id));
    res.json({ doacao: (await db.get('SELECT * FROM doacoes_itens WHERE id = ?', d.id)) });
  });

  r.patch('/doacoes-pix/:id', async (req, res) => {
    const p = (await db.get('SELECT * FROM doacoes_pix WHERE id = ? AND ong_id = ?', Number(req.params.id), ongId(req)));
    if (!p) throw new ErroHttp(404, 'Doação não encontrada.');
    const status = req.body.status;
    if (!['confirmada', 'recusada'].includes(status)) throw new ErroHttp(400, 'Status inválido.');
    if (p.status === 'confirmada') throw new ErroHttp(409, 'Esta doação já foi confirmada e o recibo já foi emitido.');
    const agora = agoraLocal().dt + ':00';
    const recibo = status === 'confirmada' ? `REC-${agora.slice(0, 4)}-${String(p.id).padStart(6, '0')}` : null;
    (await db.run('UPDATE doacoes_pix SET status = ?, confirmado_em = ?, recibo_numero = ? WHERE id = ?', status, status === 'confirmada' ? agora : null, recibo, p.id));
    res.json({ doacao: (await db.get('SELECT * FROM doacoes_pix WHERE id = ?', p.id)) });
  });

  r.get('/doacoes-pix/:id/recibo', async (req, res) => {
    const p = (await db.get('SELECT * FROM doacoes_pix WHERE id = ? AND ong_id = ?', Number(req.params.id), ongId(req)));
    if (!p) throw new ErroHttp(404, 'Doação não encontrada.');
    if (p.status !== 'confirmada') throw new ErroHttp(409, 'Confirme a doação para gerar o recibo.');
    const dados = await dadosRecibo(db, p.id);
    enviarPdf(res, `recibo-${p.recibo_numero}.pdf`, (out) => reciboPix(dados, out));
  });

  return r;
}

module.exports = { rotasDoacoes, rotasDoacoesOng };
