/**
 * Escreve valores em reais por extenso (usado no recibo).
 * Ex.: 1250.5 → "mil, duzentos e cinquenta reais e cinquenta centavos"
 */
const UNIDADES = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez',
  'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const DEZENAS = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const CENTENAS = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];

/** 0–999 por extenso */
function ate999(n) {
  if (n === 0) return '';
  if (n === 100) return 'cem';
  const c = Math.floor(n / 100);
  const resto = n % 100;
  const partes = [];
  if (c) partes.push(CENTENAS[c]);
  if (resto) {
    if (resto < 20) partes.push(UNIDADES[resto]);
    else {
      const d = Math.floor(resto / 10);
      const u = resto % 10;
      partes.push(u ? `${DEZENAS[d]} e ${UNIDADES[u]}` : DEZENAS[d]);
    }
  }
  return partes.join(' e ');
}

/** Inteiro (até 999.999.999) por extenso */
function inteiroPorExtenso(n) {
  if (n === 0) return 'zero';
  const milhoes = Math.floor(n / 1e6);
  const milhares = Math.floor((n % 1e6) / 1000);
  const resto = n % 1000;
  const partes = [];
  if (milhoes) partes.push(milhoes === 1 ? 'um milhão' : `${ate999(milhoes)} milhões`);
  if (milhares) partes.push(milhares === 1 ? 'mil' : `${ate999(milhares)} mil`);
  if (resto) partes.push(ate999(resto));
  // "e" antes do último grupo quando ele é < 100 ou centena exata (ex.: "mil e cinquenta", "mil e duzentos")
  if (partes.length > 1 && (resto < 100 || resto % 100 === 0) && resto !== 0) {
    const ultimo = partes.pop();
    return `${partes.join(' ')} e ${ultimo}`;
  }
  return partes.join(' ');
}

function reaisPorExtenso(valor) {
  const centavosTotal = Math.round(valor * 100);
  const reais = Math.floor(centavosTotal / 100);
  const centavos = centavosTotal % 100;
  const partes = [];
  if (reais) {
    const exatoMilhao = reais % 1e6 === 0;
    partes.push(`${inteiroPorExtenso(reais)}${exatoMilhao ? ' de' : ''} ${reais === 1 ? 'real' : 'reais'}`);
  }
  if (centavos) partes.push(`${inteiroPorExtenso(centavos)} ${centavos === 1 ? 'centavo' : 'centavos'}`);
  return partes.join(' e ') || 'zero reais';
}

module.exports = { reaisPorExtenso, inteiroPorExtenso };
