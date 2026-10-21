/* ===== Funções compartilhadas pelo front-end ===== */

/** Chamada à API com JSON. Lança Error com a mensagem do servidor. */
async function api(metodo, url, corpo) {
  const opcoes = { method: metodo, headers: {} };
  if (corpo !== undefined) {
    opcoes.headers['Content-Type'] = 'application/json';
    opcoes.body = JSON.stringify(corpo);
  }
  const resp = await fetch(url, opcoes);
  const dados = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    let msg = dados.erro || 'Algo deu errado. Tente novamente.';
    if (resp.status === 401 && !url.startsWith('/api/auth/')) {
      msg = 'Sua sessão expirou. Entre novamente (abra o sistema em outra aba) e depois clique em salvar de novo.';
    }
    const erro = new Error(msg);
    erro.status = resp.status;
    throw erro;
  }
  return dados;
}

/**
 * Garante que há um usuário logado do tipo esperado.
 * Se não houver, manda para o login (ou para a área certa).
 */
async function exigirLogin(tipo) {
  try {
    const { usuario } = await api('GET', '/api/auth/me');
    if (tipo && usuario.tipo !== tipo) {
      location.href = usuario.tipo === 'ong' ? '/ong/painel.html' : '/turnos.html';
      return new Promise(() => {});
    }
    return usuario;
  } catch {
    location.href = '/index.html';
    return new Promise(() => {});
  }
}

async function sair() {
  await api('POST', '/api/auth/logout').catch(() => {});
  location.href = '/index.html';
}

/** Escapa texto para inserir com segurança em HTML. */
function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** Data local no formato AAAA-MM-DD, somando `dias` a hoje. */
function dataISO(dias = 0) {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function paraData(iso) { const [a, m, d] = iso.split('-').map(Number); return new Date(a, m - 1, d); }
/** "2026-10-24" → "Sáb, 24/out" */
function fmtData(iso) { const d = paraData(iso); return `${DIAS[d.getDay()]}, ${String(d.getDate()).padStart(2, '0')}/${MESES[d.getMonth()]}`; }
/** "2026-10-24" → "24/10/2026" */
function fmtDataCompleta(iso) { return iso.split('-').reverse().join('/'); }
/** "17:00" → "17h", "17:30" → "17h30" */
function fmtHora(h) { const [hh, mm] = h.split(':'); return `${Number(hh)}h${mm === '00' ? '' : mm}`; }
function fmtHorario(i, f) { return `${fmtHora(i)} às ${fmtHora(f)}`; }
function fmtHoras(n) { const v = Math.round(n * 10) / 10; return `${String(v).replace('.', ',')}h`; }
function iniciais(nome) { return nome.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase(); }
function diaMes(iso) { const d = paraData(iso); return { dia: String(d.getDate()).padStart(2, '0'), mes: MESES[d.getMonth()].toUpperCase() }; }

/** "há 5 min", "há 2 h", "ontem"… a partir de "AAAA-MM-DD HH:MM:SS" (hora local do servidor). */
function tempoRelativo(dt) {
  const d = new Date(dt.replace(' ', 'T'));
  const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'agora';
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  if (s < 172800) return 'ontem';
  return `há ${Math.floor(s / 86400)} dias`;
}

/** Mensagem rápida no rodapé. */
function toast(msg, erro = false) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className = erro ? 'erro' : '';
  el.hidden = false;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.hidden = true; }, 3500);
}

/** Ícones (SVG de traço) usados nas telas. */
const ICONE = {
  calendario: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/></svg>',
  local: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
  ok: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex:0 0 auto"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9.5"/></svg>',
  qr: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3M21 14v7h-7"/></svg>',
  download: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
  logo: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="17" rx="3"/><path d="M8 2v4M16 2v4M3 9h18"/><path d="M12 18s-3.5-2-3.5-4.2a1.8 1.8 0 0 1 3.5-.6 1.8 1.8 0 0 1 3.5.6C15.5 16 12 18 12 18z"/></svg>'
};

/** Barra de navegação inferior do app do voluntário/doador. */
function tabbar(ativa) {
  const svg = (d) => `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const item = (href, chave, rotulo, icone) =>
    `<a href="${href}" ${ativa === chave ? 'aria-current="page"' : ''}>${svg(icone)}${rotulo}</a>`;
  return `<nav class="tabbar" aria-label="Navegação principal">
    ${item('/turnos.html', 'explorar', 'Turnos', '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>')}
    ${item('/doar.html', 'doar', 'Doar', '<path d="M12 20s-7-4.4-7-9.5A4 4 0 0 1 12 8a4 4 0 0 1 7 2.5C19 15.6 12 20 12 20z"/>')}
    ${item('/meus-turnos.html', 'meus', 'Agenda', '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18M8 15l2.5 2.5L16 13"/>')}
    ${item('/minhas-doacoes.html', 'doacoes', 'Doações', '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h7M9 17h5"/>')}
    <button type="button" onclick="sair()">${svg('<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/>')}Sair</button>
  </nav>`;
}

/** Link do WhatsApp com mensagem pronta (wa.me). Devolve null se não houver número. */
function waLink(numero, texto) {
  let d = String(numero || '').replace(/\D/g, '');
  if (!d) return null;
  if (d.length <= 11) d = '55' + d;
  return `https://wa.me/${d}?text=${encodeURIComponent(texto)}`;
}
const ICONE_WHATS = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20l1.3-3.9A8 8 0 1 1 8 19z"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1-1.5-2-1-1 1a3.5 3.5 0 0 1-2-2l1-1-1-2z"/></svg>';

/** Centavos → "R$ 50,00" */
function brl(centavos) { return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
function plural(u, n) { return n === 1 || u === 'kg' ? u : `${u}s`; }

/** Menu lateral do painel da ONG. */
function menuOng(ativa, usuario) {
  const item = (href, chave, rotulo) => `<a href="${href}" ${ativa === chave ? 'aria-current="page"' : ''}>${rotulo}</a>`;
  return `<aside class="menu-lateral">
    <div class="marca"><div class="logo">${ICONE.logo}</div>Escala Solidária</div>
    <nav aria-label="Menu da ONG">
      ${item('/ong/painel.html', 'painel', 'Painel')}
      ${item('/ong/novo-turno.html', 'novo', 'Novo turno')}
      ${item('/ong/turnos.html', 'turnos', 'Todos os turnos')}
      ${item('/ong/doacoes.html', 'doacoes', 'Doações')}
      ${item('/ong/perfil.html', 'perfil', 'Perfil, PIX e WhatsApp')}
    </nav>
    <div class="perfil">
      <div class="avatar" aria-hidden="true">${esc(iniciais(usuario.ongNome || usuario.nome))}</div>
      <div style="display:flex;flex-direction:column;min-width:0;flex:1">
        <span style="font-size:13px;font-weight:700">${esc(usuario.ongNome || '')}</span>
        <button type="button" onclick="sair()" style="all:unset;cursor:pointer;font-size:12px;color:var(--verde);font-weight:700">Sair</button>
      </div>
    </div>
  </aside>`;
}
