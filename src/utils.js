const crypto = require('crypto');

const CATEGORIAS = ['Alimentação', 'Educação', 'Inclusão', 'Doações', 'Animais', 'Saúde', 'Meio ambiente'];

/** Categorias e unidades dos itens que as ONGs podem pedir como doação. */
const CATEGORIAS_ITENS = ['Alimentos', 'Fraldas e higiene', 'Limpeza', 'Material pedagógico', 'Brinquedos e sensorial',
  'Roupas e calçados', 'Móveis e equipamentos', 'Outros'];
const UNIDADES = ['unidade', 'pacote', 'kg', 'litro', 'caixa', 'kit'];

const pad = (n) => String(n).padStart(2, '0');

/** Data/hora local no formato usado no banco. */
function agoraLocal(d = new Date()) {
  const data = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const hora = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return { data, hora, dt: `${data} ${hora}` };
}

/** Soma dias a uma data e devolve AAAA-MM-DD. */
function somarDias(dias, base = new Date()) {
  const d = new Date(base);
  d.setDate(d.getDate() + dias);
  return agoraLocal(d).data;
}

/** Duração do turno em horas (ex.: 17:00 → 20:00 = 3). */
function duracaoHoras(inicio, fim) {
  const min = (h) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
  return Math.max(0, (min(fim) - min(inicio)) / 60);
}

/** Expressão SQL equivalente a duracaoHoras(), para somas no banco. */
const SQL_DURACAO = `((CAST(substr(t.hora_fim,1,2) AS INTEGER)*60 + CAST(substr(t.hora_fim,4,2) AS INTEGER))
  - (CAST(substr(t.hora_inicio,1,2) AS INTEGER)*60 + CAST(substr(t.hora_inicio,4,2) AS INTEGER))) / 60.0`;

/** Código curto e legível para o check-in (sem 0/O/1/I para evitar confusão). */
function gerarCodigo() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(6);
  let s = '';
  for (const b of bytes) s += chars[b % chars.length];
  return `ES-${s}`;
}

class ErroHttp extends Error {
  constructor(status, mensagem) {
    super(mensagem);
    this.status = status;
  }
}

const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;
const RE_HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Valida e normaliza os dados de um turno vindos do formulário. */
function validarTurno(b) {
  const erros = [];
  const titulo = String(b.titulo || '').trim();
  const categoria = String(b.categoria || '').trim();
  const vagas = Number(b.vagas);
  if (titulo.length < 3) erros.push('Informe um título com pelo menos 3 caracteres.');
  if (!CATEGORIAS.includes(categoria)) erros.push('Categoria inválida.');
  if (!RE_DATA.test(b.data || '')) erros.push('Data inválida.');
  if (!RE_HORA.test(b.hora_inicio || '')) erros.push('Horário de início inválido.');
  if (!RE_HORA.test(b.hora_fim || '')) erros.push('Horário de término inválido.');
  if (RE_HORA.test(b.hora_inicio || '') && RE_HORA.test(b.hora_fim || '') && b.hora_fim <= b.hora_inicio) {
    erros.push('O término precisa ser depois do início.');
  }
  if (!Number.isInteger(vagas) || vagas < 1 || vagas > 500) erros.push('Número de vagas deve ser entre 1 e 500.');
  const online = b.online === true || b.online === 1 || b.online === '1' || b.online === 'true';
  if (!online && String(b.endereco || '').trim().length < 5) erros.push('Informe o endereço (ou marque como online).');
  const status = b.status === 'rascunho' ? 'rascunho' : 'publicado';
  if (erros.length) throw new ErroHttp(400, erros.join(' '));
  const bool = (v, padrao) => (v === undefined ? padrao : v === true || v === 1 || v === '1' || v === 'true');
  return {
    titulo,
    categoria,
    descricao: String(b.descricao || '').trim(),
    requisitos: String(b.requisitos || '').trim(),
    data: b.data,
    hora_inicio: b.hora_inicio,
    hora_fim: b.hora_fim,
    online: online ? 1 : 0,
    endereco: online ? '' : String(b.endereco).trim(),
    vagas,
    lembrete_whatsapp: bool(b.lembrete_whatsapp, true) ? 1 : 0,
    lembrete_email: bool(b.lembrete_email, true) ? 1 : 0,
    lista_espera: bool(b.lista_espera, false) ? 1 : 0,
    status
  };
}

module.exports = {
  CATEGORIAS, CATEGORIAS_ITENS, UNIDADES, agoraLocal, somarDias, duracaoHoras, SQL_DURACAO, gerarCodigo,
  ErroHttp, validarTurno, RE_EMAIL
};
