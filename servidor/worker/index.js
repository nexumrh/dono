// Servidor da NexumCell no Cloudflare Workers: um único Worker atende todas as rotas /api/...
// Os arquivos de api/ são os mesmos da Vercel; aqui só traduzimos o pedido/resposta do Cloudflare
// para o formato (req, res) que eles usam. Rotinas diárias: [triggers] crons no wrangler.toml.
import pix from '../api/pix.js';
import loja from '../api/loja.js';
import pixAutomatico from '../api/pix-automatico.js';
import asaasWebhook from '../api/asaas-webhook.js';
import assistente from '../api/assistente.js';
import avisos from '../api/avisos.js';
import nf from '../api/nf.js';
import assinatura from '../api/assinatura.js';
import zapsignWebhook from '../api/zapsign-webhook.js';
import preanalise from '../api/preanalise.js';
import credenciamento from '../api/credenciamento.js';
import push from '../api/push.js';
import saas from '../api/saas.js';
import motor from '../api/motor.js';
import repasse from '../api/repasse.js';
import remota from '../api/remota.js';
import { rotinas } from '../api/cron.js';

const ROTAS = { pix, loja, 'pix-automatico': pixAutomatico, 'asaas-webhook': asaasWebhook, assistente, avisos, nf, assinatura, 'zapsign-webhook': zapsignWebhook, preanalise, credenciamento, push, saas, motor, repasse, remota };

function carregarEnv(env) {
  globalThis.process = globalThis.process || { env: {} };
  globalThis.process.env = globalThis.process.env || {};
  for (const [k, v] of Object.entries(env || {})) if (typeof v === 'string') globalThis.process.env[k] = v;
}

async function atender(request) {
  const url = new URL(request.url), nome = url.pathname.replace(/^\/api\//, '').replace(/\/$/, '');
  if (url.pathname === '/' || url.pathname === '/api') return new Response('NexumCell: servidor no ar ✔', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
  const fn = ROTAS[nome];
  if (!fn) return new Response(JSON.stringify({ erro: 'rota não existe' }), { status: 404, headers: { 'content-type': 'application/json' } });
  const headers = {}; request.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
  let body = {};
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) { const t = await request.text(); try { body = t ? JSON.parse(t) : {}; } catch (e) { body = {}; } }
  const req = { method: request.method, headers, body, query: Object.fromEntries(url.searchParams), url: url.pathname + url.search };
  let status = 200, saida = null, feito = false; const h = new Headers();
  const res = {
    setHeader: (k, v) => { h.set(k, v); return res; },
    status: (n) => { status = n; return res; },
    json: (o) => { h.set('content-type', 'application/json; charset=utf-8'); saida = JSON.stringify(o); feito = true; return res; },
    send: (t) => { saida = t; feito = true; return res; },
    end: (t) => { if (t !== undefined) saida = t; feito = true; return res; },
  };
  await fn(req, res);
  if (!feito) status = status || 204;
  return new Response(status === 204 ? null : saida, { status, headers: h });
}

export default {
  async fetch(request, env) {
    carregarEnv(env);
    try { return await atender(request); }
    catch (e) { console.error(e); return new Response(JSON.stringify({ erro: e.message }), { status: e.status || 500, headers: { 'content-type': 'application/json' } }); }
  },
  async scheduled(event, env, ctx) {
    carregarEnv(env);
    const qual = event.cron === (env.CRON_NOITE || '0 22 * * *') ? 'noite' : 'manha';
    ctx.waitUntil(rotinas(qual).then((r) => console.log('rotina', qual, JSON.stringify(r))).catch((e) => console.error('rotina', qual, e)));
  },
};
