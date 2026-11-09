// Substituto do "firebase-admin" para o Cloudflare Workers (lá o firebase-admin não funciona).
// Implementa só o que o servidor da NexumCell usa, falando com o Firestore pela API REST oficial
// e assinando o login da conta de serviço com WebCrypto. O wrangler.toml troca o import
// 'firebase-admin' por este arquivo; na Vercel continua o firebase-admin de verdade.
//
// Usa a variável FIREBASE_SERVICE_ACCOUNT (o JSON inteiro da conta de serviço), lida na hora do uso.

const conta = () => {
  const raw = globalThis.process?.env?.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT não configurado');
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
};
const b64url = (buf) => {
  const s = typeof buf === 'string' ? btoa(unescape(encodeURIComponent(buf))) : btoa(String.fromCharCode(...new Uint8Array(buf)));
  return s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const deB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const pemParaDer = (pem) => Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')), (c) => c.charCodeAt(0));

// ---------- token de acesso da conta de serviço (válido 1 h, guardado em memória) ----------
let cacheToken = null;
async function tokenAcesso() {
  if (cacheToken && cacheToken.exp > Date.now() + 60e3) return cacheToken.t;
  const sa = conta(), agora = Math.floor(Date.now() / 1000);
  const cab = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const corpo = b64url(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/cloud-platform', aud: 'https://oauth2.googleapis.com/token', iat: agora, exp: agora + 3600 }));
  const chave = await crypto.subtle.importKey('pkcs8', pemParaDer(sa.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const ass = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', chave, new TextEncoder().encode(cab + '.' + corpo));
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + cab + '.' + corpo + '.' + b64url(ass) });
  const j = await r.json();
  if (!j.access_token) throw new Error('Login da conta de serviço falhou: ' + JSON.stringify(j));
  cacheToken = { t: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return cacheToken.t;
}

// ---------- conversão de valores JS <-> Firestore ----------
function paraFs(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) && Math.abs(v) < 2 ** 53 ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.filter((x) => x !== undefined).map(paraFs) } };
  if (typeof v === 'object') return { mapValue: { fields: campos(v) } };
  return { stringValue: String(v) };
}
const campos = (o) => Object.fromEntries(Object.entries(o).filter(([, x]) => x !== undefined).map(([k, x]) => [k, paraFs(x)]));
function deFs(v) {
  if (!v) return null;
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('stringValue' in v) return v.stringValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(deFs);
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, deFs(x)]));
  if ('referenceValue' in v) return v.referenceValue;
  if ('geoPointValue' in v) return v.geoPointValue;
  return null;
}
const caminhoCampo = (k) => (/^[A-Za-z_][A-Za-z_0-9]*$/.test(k) ? k : '`' + k.replace(/[`\\]/g, (c) => '\\' + c) + '`');
const autoId = () => { const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', b = crypto.getRandomValues(new Uint8Array(20)); return [...b].map((x) => a[x % 62]).join(''); };

// ---------- cliente REST ----------
const projeto = () => conta().project_id;
const raiz = () => `projects/${projeto()}/databases/(default)/documents`;
const base = () => 'https://firestore.googleapis.com/v1/';
async function rest(caminho, opts = {}) {
  const r = await fetch(base() + caminho, { ...opts, headers: { Authorization: 'Bearer ' + (await tokenAcesso()), 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error('Firestore ' + r.status + ': ' + (j.error?.message || JSON.stringify(j))); e.code = r.status; throw e; }
  return j;
}
const snap = (id, doc) => ({ id, exists: !!doc, ref: null, data: () => (doc ? deFs({ mapValue: { fields: doc.fields || {} } }) : undefined) });

// escrita no formato do commit (usada fora e dentro de transação)
function escrita(nome, dados, modo) {
  const w = { update: { name: nome, fields: campos(dados) } };
  if (modo === 'merge' || modo === 'update') w.updateMask = { fieldPaths: Object.keys(dados).filter((k) => dados[k] !== undefined).map(caminhoCampo) };
  if (modo === 'update') w.currentDocument = { exists: true };
  return w;
}

class DocRef {
  constructor(col, id) { this.col = col; this.id = id; this.path = `${col}/${id}`; }
  get nome() { return `${raiz()}/${this.path}`; }
  async get() { try { return snap(this.id, await rest(this.nome)); } catch (e) { if (e.code === 404) return snap(this.id, null); throw e; } }
  async set(dados, opt = {}) { await commit([escrita(this.nome, dados, opt.merge ? 'merge' : 'set')]); }
  async update(dados) { await commit([escrita(this.nome, dados, 'update')]); }
  async delete() { await commit([{ delete: this.nome }]); }
  collection(sub) { return new Consulta(`${this.path}/${sub}`); }
}

class Consulta {
  constructor(col, filtros = [], lim = 0, ordem = null) { this.col = col; this.filtros = filtros; this.lim = lim; this.ordem = ordem; }
  doc(id) { return new DocRef(this.col, id || autoId()); }
  async add(dados) { const d = this.doc(); await d.set(dados); return d; }
  where(campo, op, valor) { return new Consulta(this.col, [...this.filtros, [campo, op, valor]], this.lim, this.ordem); }
  limit(n) { return new Consulta(this.col, this.filtros, n, this.ordem); }
  orderBy(campo, dir = 'asc') { return new Consulta(this.col, this.filtros, this.lim, [campo, dir]); }
  async get() {
    const partes = this.col.split('/'), colId = partes.pop(), pai = partes.length ? `${raiz()}/${partes.join('/')}` : raiz();
    const OPS = { '==': 'EQUAL', '!=': 'NOT_EQUAL', '<': 'LESS_THAN', '<=': 'LESS_THAN_OR_EQUAL', '>': 'GREATER_THAN', '>=': 'GREATER_THAN_OR_EQUAL', 'array-contains': 'ARRAY_CONTAINS', in: 'IN' };
    const f = this.filtros.map(([c, op, v]) => ({ fieldFilter: { field: { fieldPath: caminhoCampo(c) }, op: OPS[op], value: paraFs(v) } }));
    const q = { from: [{ collectionId: colId }] };
    if (f.length === 1) q.where = f[0]; else if (f.length > 1) q.where = { compositeFilter: { op: 'AND', filters: f } };
    if (this.ordem) q.orderBy = [{ field: { fieldPath: caminhoCampo(this.ordem[0]) }, direction: this.ordem[1] === 'desc' ? 'DESCENDING' : 'ASCENDING' }];
    if (this.lim) q.limit = this.lim;
    const r = await rest(pai.replace(base(), '') + ':runQuery', { method: 'POST', body: JSON.stringify({ structuredQuery: q }) });
    const docs = (Array.isArray(r) ? r : []).filter((x) => x.document).map((x) => { const id = x.document.name.split('/').pop(); const s = snap(id, x.document); s.ref = new DocRef(this.col, id); return s; });
    return { empty: !docs.length, size: docs.length, docs, forEach: (fn) => docs.forEach(fn) };
  }
}

async function commit(writes, transaction) {
  return rest(`projects/${projeto()}/databases/(default)/documents:commit`, { method: 'POST', body: JSON.stringify({ writes, ...(transaction ? { transaction } : {}) }) });
}

const firestore = {
  collection: (c) => new Consulta(c),
  doc: (p) => { const i = p.lastIndexOf('/'); return new DocRef(p.slice(0, i), p.slice(i + 1)); },
  batch() {
    const ws = [];
    return { set: (ref, d, o = {}) => ws.push(escrita(ref.nome, d, o.merge ? 'merge' : 'set')), update: (ref, d) => ws.push(escrita(ref.nome, d, 'update')), delete: (ref) => ws.push({ delete: ref.nome }), commit: () => commit(ws) };
  },
  // transação de verdade: leituras com o id da transação, escritas no commit (o Firestore recusa se alguém mudou no meio)
  async runTransaction(fn) {
    for (let tentativa = 0; tentativa < 5; tentativa++) {
      const { transaction } = await rest(`projects/${projeto()}/databases/(default)/documents:beginTransaction`, { method: 'POST', body: '{}' });
      const ws = [];
      const t = {
        get: async (ref) => { try { return snap(ref.id, await rest(ref.nome + '?transaction=' + encodeURIComponent(transaction))); } catch (e) { if (e.code === 404) return snap(ref.id, null); throw e; } },
        set: (ref, d, o = {}) => { ws.push(escrita(ref.nome, d, o.merge ? 'merge' : 'set')); return t; },
        update: (ref, d) => { ws.push(escrita(ref.nome, d, 'update')); return t; },
        delete: (ref) => { ws.push({ delete: ref.nome }); return t; },
      };
      const res = await fn(t);
      try { await commit(ws, transaction); return res; } catch (e) { if (e.code !== 409 && e.code !== 400 && e.code !== 412) throw e; }
    }
    throw new Error('transação não concluída depois de 5 tentativas');
  },
};

// ---------- conferência do login dos portais (ID token do Firebase) ----------
let chavesGoogle = null;
async function chavePublica(kid) {
  if (!chavesGoogle || chavesGoogle.exp < Date.now() || !chavesGoogle.k[kid]) {
    const r = await fetch('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
    const j = await r.json(), m = /max-age=(\d+)/.exec(r.headers.get('cache-control') || '');
    chavesGoogle = { exp: Date.now() + (m ? +m[1] : 3600) * 1000, k: Object.fromEntries((j.keys || []).map((k) => [k.kid, k])) };
  }
  const jwk = chavesGoogle.k[kid];
  if (!jwk) throw new Error('chave do token desconhecida');
  return crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
}
async function verifyIdToken(token) {
  const [h, p, s] = String(token || '').split('.');
  if (!s) throw Object.assign(new Error('login ausente'), { status: 401 });
  const cab = JSON.parse(new TextDecoder().decode(deB64url(h))), c = JSON.parse(new TextDecoder().decode(deB64url(p)));
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', await chavePublica(cab.kid), deB64url(s), new TextEncoder().encode(h + '.' + p));
  const agora = Date.now() / 1000, pid = projeto();
  if (!ok || cab.alg !== 'RS256' || c.aud !== pid || c.iss !== 'https://securetoken.google.com/' + pid || c.exp < agora || c.iat > agora + 300 || !c.sub)
    throw Object.assign(new Error('login inválido ou vencido'), { status: 401 });
  return { ...c, uid: c.sub };
}

// ---------- Firebase Cloud Messaging (aviso instantâneo para o app da trava) ----------
async function enviarFcm(msg) {
  const m = { ...msg };
  if (m.android && typeof m.android.ttl === 'number') m.android = { ...m.android, ttl: Math.round(m.android.ttl / 1000) + 's' };
  const r = await fetch(`https://fcm.googleapis.com/v1/projects/${projeto()}/messages:send`, {
    method: 'POST', headers: { Authorization: 'Bearer ' + (await tokenAcesso()), 'Content-Type': 'application/json' }, body: JSON.stringify({ message: m }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error('FCM ' + r.status + ': ' + (j.error?.message || '')), { codigo: j.error?.details?.[0]?.errorCode || j.error?.status });
  return j.name;
}

const admin = {
  apps: [],
  initializeApp() { admin.apps.push({}); return {}; },
  credential: { cert: (x) => x },
  firestore: () => firestore,
  auth: () => ({ verifyIdToken }),
  messaging: () => ({ send: enviarFcm }),
};
export default admin;
export const _interno = { paraFs, deFs, escrita, campos };
