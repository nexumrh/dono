// Código MESTRE de remoção da trava (aparelho travado / sem internet / sem contrato).
// O segredo fica SÓ aqui (env MESTRE_REMOCAO) e no app (Remocao.kt MESTRE) — nunca no navegador.
//   POST /api/remover-codigo {acao:'codigo'}  (DONO/SUPORTE) -> { codigo, dia }
//   POST /api/remover-codigo {acao:'link'}     (DONO/SUPORTE) -> { token, expira }  (o portal monta a URL)
//   GET  /api/remover-codigo?t=TOKEN                          -> página HTML com o código (link pro vendedor/gerente)
import { cors, exigirEquipe } from './_base.js';

const SEG = () => String(process.env.MESTRE_REMOCAO || '');
const LINK = () => String(process.env.LINK_SECRET || process.env.MESTRE_REMOCAO || '');

const diaSP = (d = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

async function hmac(secret, msg) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg)));
}
async function codigoDoDia(dia = diaSP()) {
  const h = await hmac(SEG(), `REMOVER-USB|${dia}`);
  let v = 0; for (let i = 0; i < 5; i++) v = v * 256 + h[i];
  return String(v % 10000000000).padStart(10, '0');
}
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function assinarLink(expMs) {
  const exp = String(expMs);
  const mac = await hmac(LINK(), 'LINK|' + exp);
  return b64url(new TextEncoder().encode(exp)) + '.' + b64url(mac);
}
async function conferirLink(tok) {
  const [a, b] = String(tok || '').split('.');
  if (!a || !b) return false;
  let exp;
  try { exp = new TextDecoder().decode(Uint8Array.from(atob(a.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))); }
  catch (e) { return false; }
  if (!/^\d+$/.test(exp) || Date.now() > Number(exp)) return false;
  const mac = await hmac(LINK(), 'LINK|' + exp);
  return b64url(mac) === b;
}
function pagina(cod, erro) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NexumCell — Remover a trava</title>
<style>body{margin:0;font-family:system-ui,Arial,sans-serif;background:#0B1E35;color:#fff;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:20px}
.card{background:#071424;border:1px solid #1b3350;border-radius:14px;padding:24px;max-width:460px;width:100%}
h1{font-size:18px;margin:0 0 6px}.cod{font-size:42px;letter-spacing:6px;font-weight:800;color:#C9A84C;text-align:center;margin:18px 0}
ol{line-height:1.7;font-size:15px;padding-left:18px;margin:8px 0}.muted{color:#9FB0C3;font-size:13px}.err{color:#E07A5F}</style></head>
<body><div class="card">${erro
    ? `<h1>Remover a trava</h1><p class="err">${erro}</p>`
    : `<h1>NexumCell — Remover a trava</h1>
<p class="muted">No aparelho, na tela do app NexumCell, toque em “Problema? Inserir código de remoção da loja” e digite o código:</p>
<div class="cod">${cod}</div>
<ol><li>Toque em <b>Remover</b> no aparelho.</li><li>A trava sai e o app se desinstala.</li><li>Depois, reinstale a trava (QR ou cabo USB) para refazer a venda.</li></ol>
<p class="muted">Código válido só hoje. Dúvidas: fale com o Dono/Suporte Nexum.</p>`}</div></body></html>`;
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (!SEG()) return res.status(500).json({ erro: 'MESTRE_REMOCAO não configurado no servidor.' });

  if (req.method === 'GET') {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    if (!(await conferirLink(req.query.t))) return res.status(410).send(pagina(null, 'Link expirado ou inválido. Peça um novo ao Dono/Suporte.'));
    return res.status(200).send(pagina(await codigoDoDia(), null));
  }
  if (req.method !== 'POST') return res.status(405).end();

  await exigirEquipe(req, ['DONO', 'SUPORTE']);
  const acao = (req.body || {}).acao || 'codigo';
  if (acao === 'link') {
    const exp = Date.now() + 3 * 3600 * 1000; // vale 3 horas
    return res.status(200).json({ token: await assinarLink(exp), expira: exp });
  }
  return res.status(200).json({ codigo: await codigoDoDia(), dia: diaSP() });
}
