/**
 * Geração do "PIX Copia e Cola" (BR Code estático) seguindo o padrão EMV
 * do Banco Central. O mesmo texto vira o QR Code que o doador lê no app do banco.
 *
 * Importante: PIX estático NÃO avisa o sistema quando o pagamento cai.
 * Por isso o fluxo é: doador paga → clica "Já fiz o PIX" → ONG confere
 * no extrato do banco → confirma no painel → recibo liberado.
 */

const TIPOS_CHAVE = ['cpf', 'cnpj', 'email', 'telefone', 'aleatoria'];

/** Campo EMV: ID (2 dígitos) + tamanho (2 dígitos) + valor. */
function campo(id, valor) {
  return id + String(valor.length).padStart(2, '0') + valor;
}

/** CRC16/CCITT-FALSE (polinômio 0x1021, valor inicial 0xFFFF), exigido no campo 63. */
function crc16(texto) {
  let crc = 0xffff;
  for (const byte of Buffer.from(texto, 'utf8')) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/** Remove acentos e caracteres especiais (o padrão só aceita ASCII nesses campos). */
function limpar(texto, max) {
  return String(texto || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
    .toUpperCase().slice(0, max);
}

/** Normaliza e valida a chave PIX conforme o tipo. Lança Error com mensagem amigável. */
function normalizarChave(tipo, chave) {
  const c = String(chave || '').trim();
  const digitos = c.replace(/\D/g, '');
  switch (tipo) {
    case 'cpf':
      if (digitos.length !== 11) throw new Error('CPF da chave PIX deve ter 11 dígitos.');
      return digitos;
    case 'cnpj':
      if (digitos.length !== 14) throw new Error('CNPJ da chave PIX deve ter 14 dígitos.');
      return digitos;
    case 'email':
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c)) throw new Error('E-mail da chave PIX inválido.');
      return c.toLowerCase();
    case 'telefone': {
      const d = digitos.startsWith('55') && digitos.length >= 12 ? digitos : '55' + digitos;
      if (d.length < 12 || d.length > 13) throw new Error('Telefone da chave PIX deve ter DDD + número.');
      return '+' + d;
    }
    case 'aleatoria':
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(c)) throw new Error('Chave aleatória inválida (formato UUID).');
      return c.toLowerCase();
    default:
      throw new Error('Tipo de chave PIX inválido.');
  }
}

/**
 * Monta o payload "copia e cola".
 * @param {object} o
 * @param {string} o.chave     chave PIX já normalizada
 * @param {string} o.nome      nome do recebedor (até 25 caracteres)
 * @param {string} o.cidade    cidade do recebedor (até 15 caracteres)
 * @param {number} [o.valor]   valor em reais (opcional; sem valor o doador digita no app)
 * @param {string} [o.descricao] mensagem curta (opcional)
 */
function gerarPayloadPix({ chave, nome, cidade, valor, descricao }) {
  let conta = campo('00', 'br.gov.bcb.pix') + campo('01', chave);
  const desc = limpar(descricao, 40);
  if (desc) conta += campo('02', desc);

  let payload = campo('00', '01') + campo('26', conta) + campo('52', '0000') + campo('53', '986');
  if (valor && valor > 0) payload += campo('54', valor.toFixed(2));
  payload += campo('58', 'BR') + campo('59', limpar(nome, 25) || 'ONG') + campo('60', limpar(cidade, 15) || 'BRASIL');
  payload += campo('62', campo('05', '***'));
  payload += '6304';
  return payload + crc16(payload);
}

module.exports = { gerarPayloadPix, crc16, normalizarChave, TIPOS_CHAVE };
