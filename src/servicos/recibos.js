const PDFDocument = require('pdfkit');
const { reaisPorExtenso } = require('./extenso');

const VERDE = '#0F6E5A';
const TEXTO = '#1B2430';
const MUTED = '#5B6573';

const plural = (u, n) => (n === 1 || u === 'kg' ? u : `${u}s`);
const brl = (centavos) => (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBR = (dt) => (dt ? dt.slice(0, 10).split('-').reverse().join('/') : '');
const horaBR = (dt) => (dt && dt.length >= 16 ? dt.slice(11, 16) : '');

function cabecalho(doc, ong, titulo, subtitulo) {
  doc.rect(0, 0, doc.page.width, 8).fill(VERDE);
  doc.fillColor(VERDE).font('Helvetica-Bold').fontSize(18).text(ong.nome, 56, 40, { width: 330 });
  doc.fillColor(MUTED).font('Helvetica').fontSize(9);
  const cnpj = ong.semCnpj ? '' : ong.cnpj ? `CNPJ: ${ong.cnpj}` : 'CNPJ: não informado';
  const linhas = [cnpj, [ong.endereco, ong.cidade].filter(Boolean).join(' — ')]
    .filter(Boolean);
  doc.text(linhas.join('\n'), 56, doc.y + 4, { width: 330 });
  doc.fillColor(TEXTO).font('Helvetica-Bold').fontSize(13).text(titulo, 380, 42, { width: 160, align: 'right' });
  doc.fillColor(MUTED).font('Helvetica').fontSize(10).text(subtitulo, 380, doc.y + 2, { width: 160, align: 'right' });
  doc.moveTo(56, 118).lineTo(doc.page.width - 56, 118).lineWidth(1).strokeColor('#E3E7EB').stroke();
  doc.x = 56;
  doc.y = 140;
}

function rodape(doc) {
  const y = doc.page.height - 112;
  doc.moveTo(56, y).lineTo(doc.page.width - 56, y).lineWidth(0.5).strokeColor('#E3E7EB').stroke();
  doc.fillColor(MUTED).font('Helvetica').fontSize(8).text(
    'Documento emitido pelo sistema Escala Solidária com base na confirmação da própria organização. ' +
    'Não é documento fiscal. A dedutibilidade no Imposto de Renda depende da situação da entidade e do doador.',
    56, y + 10, { width: doc.page.width - 112, align: 'center' }
  );
}

/**
 * Recibo de uma doação PIX confirmada.
 * @param {object} d { ong, doador, doacao, ordem, totalConfirmado }
 */
function reciboPix(d, destino) {
  const doc = new PDFDocument({ size: 'A4', margin: 56, info: { Title: `Recibo ${d.doacao.recibo_numero}`, Author: d.ong.nome } });
  doc.pipe(destino);
  cabecalho(doc, d.ong, 'RECIBO DE DOAÇÃO', `Nº ${d.doacao.recibo_numero}`);

  doc.fillColor(TEXTO).font('Helvetica').fontSize(12).text('Recebemos de ', { continued: true })
    .font('Helvetica-Bold').text(d.doador.nome, { continued: true })
    .font('Helvetica').text(d.doador.email ? ` (${d.doador.email})` : '', { continued: true })
    .text(', a título de doação, a quantia de:', { lineGap: 4 });

  const yBox = doc.y + 12;
  doc.roundedRect(56, yBox, doc.page.width - 112, 78, 10).fill('#E6F2EE');
  doc.fillColor(VERDE).font('Helvetica-Bold').fontSize(28).text(brl(d.doacao.valor_centavos), 76, yBox + 14);
  doc.fillColor('#0B5A49').font('Helvetica').fontSize(11)
    .text(`(${reaisPorExtenso(d.doacao.valor_centavos / 100)})`, 76, yBox + 50, { width: doc.page.width - 152 });
  doc.y = yBox + 100;

  const linha = (rotulo, valor) => {
    doc.fillColor(MUTED).font('Helvetica').fontSize(10).text(rotulo, 56, doc.y, { continued: true, width: 480 })
      .fillColor(TEXTO).font('Helvetica-Bold').text(`  ${valor}`);
    doc.moveDown(0.4);
  };
  linha('Forma de pagamento:', 'PIX');
  linha('Data informada pelo doador:', `${dataBR(d.doacao.criado_em)} ${horaBR(d.doacao.criado_em)}`);
  linha('Recebimento confirmado pela ONG em:', `${dataBR(d.doacao.confirmado_em)} ${horaBR(d.doacao.confirmado_em)}`);
  if (d.doacao.mensagem) linha('Mensagem do doador:', `“${d.doacao.mensagem}”`);

  doc.moveDown(1);
  doc.roundedRect(56, doc.y, doc.page.width - 112, 54, 10).lineWidth(1).strokeColor('#CFE7DF').stroke();
  const yA = doc.y + 12;
  doc.fillColor(TEXTO).font('Helvetica-Bold').fontSize(11)
    .text(`Esta foi a ${d.ordem}ª doação de ${d.doador.nome.split(' ')[0]} para a ${d.ong.nome}.`, 72, yA, { width: doc.page.width - 144 });
  doc.font('Helvetica').fillColor(MUTED).fontSize(10)
    .text(`Total já doado via PIX: ${brl(d.totalConfirmado)}. Muito obrigado por fazer parte desta história!`, 72, doc.y + 2, { width: doc.page.width - 144 });

  const yAss = doc.page.height - 190;
  doc.moveTo(170, yAss).lineTo(doc.page.width - 170, yAss).lineWidth(0.8).strokeColor(TEXTO).stroke();
  doc.fillColor(TEXTO).font('Helvetica-Bold').fontSize(10).text(d.ong.nome, 56, yAss + 6, { align: 'center', width: doc.page.width - 112 });
  doc.fillColor(MUTED).font('Helvetica').fontSize(9).text('Confirmado eletronicamente no sistema', { align: 'center', width: doc.page.width - 112 });

  rodape(doc);
  doc.end();
}

/**
 * Declaração anual com todas as doações confirmadas do doador (PIX e itens).
 * @param {object} d { doador, ano, pix: [...], itens: [...] }
 */
function declaracaoAnual(d, destino) {
  const doc = new PDFDocument({ size: 'A4', margin: 56, info: { Title: `Declaração de doações ${d.ano}` } });
  doc.pipe(destino);
  cabecalho(doc, { nome: 'Escala Solidária', cidade: 'Plataforma de voluntariado e doações', semCnpj: true }, 'DECLARAÇÃO ANUAL', `Ano de ${d.ano}`);

  const totalPix = d.pix.reduce((s, p) => s + p.valor_centavos, 0);
  doc.fillColor(TEXTO).font('Helvetica').fontSize(12)
    .text('Declaramos que ', { continued: true }).font('Helvetica-Bold').text(d.doador.nome, { continued: true })
    .font('Helvetica').text(` realizou ${d.pix.length + d.itens.length} doação(ões) confirmada(s) pelas organizações em ${d.ano}, ` +
      `sendo ${d.pix.length} via PIX, no total de ${brl(totalPix)}, e ${d.itens.length} entrega(s) de itens.`, { lineGap: 4 });
  doc.moveDown(1.2);

  const tabela = (titulo, colunas, linhas) => {
    doc.fillColor(VERDE).font('Helvetica-Bold').fontSize(12).text(titulo, 56);
    doc.moveDown(0.4);
    const larguras = colunas.map((c) => c.w);
    let y = doc.y;
    let x = 56;
    doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(8);
    colunas.forEach((c, i) => { doc.text(c.t.toUpperCase(), x, y, { width: larguras[i], align: c.a || 'left' }); x += larguras[i]; });
    y += 16;
    doc.font('Helvetica').fontSize(10).fillColor(TEXTO);
    if (!linhas.length) { doc.fillColor(MUTED).text('Nenhum registro.', 56, y); y += 18; }
    for (const l of linhas) {
      if (y > doc.page.height - 120) { doc.addPage(); y = 56; }
      doc.moveTo(56, y - 4).lineTo(doc.page.width - 56, y - 4).lineWidth(0.5).strokeColor('#EEF1F4').stroke();
      x = 56;
      l.forEach((v, i) => { doc.fillColor(TEXTO).text(String(v), x, y, { width: larguras[i] - 6, align: colunas[i].a || 'left' }); x += larguras[i]; });
      y += 20;
    }
    doc.y = y + 10;
  };

  tabela('Doações via PIX', [{ t: 'Data', w: 80 }, { t: 'Organização', w: 210 }, { t: 'Recibo', w: 110 }, { t: 'Valor', w: 83, a: 'right' }],
    d.pix.map((p) => [dataBR(p.confirmado_em), p.ong_nome, p.recibo_numero, brl(p.valor_centavos)]));
  tabela('Doações de itens', [{ t: 'Entrega', w: 80 }, { t: 'Organização', w: 180 }, { t: 'Item', w: 160 }, { t: 'Qtd.', w: 63, a: 'right' }],
    d.itens.map((i) => [dataBR(i.entregue_em), i.ong_nome, i.nome, `${i.quantidade} ${plural(i.unidade, i.quantidade)}`]));

  rodape(doc);
  doc.end();
}

module.exports = { reciboPix, declaracaoAnual, brl };
