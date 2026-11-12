// NexumCell — servidor em UM arquivo (copiar e colar no Cloudflare: Workers › nexumcell-servidor › Edit code).
// Gerado automaticamente a partir da pasta servidor/. Não edite aqui: edite os arquivos de servidor/ e gere de novo.
// worker/firebase-rest.js
var conta = () => {
  const raw = globalThis.process?.env?.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT n\xE3o configurado");
  return typeof raw === "string" ? JSON.parse(raw) : raw;
};
var b64url = (buf) => {
  const s = typeof buf === "string" ? btoa(unescape(encodeURIComponent(buf))) : btoa(String.fromCharCode(...new Uint8Array(buf)));
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
var deB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
var pemParaDer = (pem) => Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "")), (c) => c.charCodeAt(0));
var cacheToken = null;
async function tokenAcesso() {
  if (cacheToken && cacheToken.exp > Date.now() + 6e4) return cacheToken.t;
  const sa = conta(), agora = Math.floor(Date.now() / 1e3);
  const cab = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const corpo = b64url(JSON.stringify({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/cloud-platform", aud: "https://oauth2.googleapis.com/token", iat: agora, exp: agora + 3600 }));
  const chave = await crypto.subtle.importKey("pkcs8", pemParaDer(sa.private_key), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const ass = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", chave, new TextEncoder().encode(cab + "." + corpo));
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=" + cab + "." + corpo + "." + b64url(ass)
  });
  const j = await r.json();
  if (!j.access_token) throw new Error("Login da conta de servi\xE7o falhou: " + JSON.stringify(j));
  cacheToken = { t: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1e3 };
  return cacheToken.t;
}
function paraFs(v) {
  if (v === null || v === void 0) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) && Math.abs(v) < 2 ** 53 ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === "string") return { stringValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.filter((x) => x !== void 0).map(paraFs) } };
  if (typeof v === "object") return { mapValue: { fields: campos(v) } };
  return { stringValue: String(v) };
}
var campos = (o) => Object.fromEntries(Object.entries(o).filter(([, x]) => x !== void 0).map(([k, x]) => [k, paraFs(x)]));
function deFs(v) {
  if (!v) return null;
  if ("nullValue" in v) return null;
  if ("booleanValue" in v) return v.booleanValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return Number(v.doubleValue);
  if ("stringValue" in v) return v.stringValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(deFs);
  if ("mapValue" in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, deFs(x)]));
  if ("referenceValue" in v) return v.referenceValue;
  if ("geoPointValue" in v) return v.geoPointValue;
  return null;
}
var caminhoCampo = (k) => /^[A-Za-z_][A-Za-z_0-9]*$/.test(k) ? k : "`" + k.replace(/[`\\]/g, (c) => "\\" + c) + "`";
var caminhoConsulta = (k) => String(k).split(".").map(caminhoCampo).join(".");
var autoId = () => {
  const a = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789", b = crypto.getRandomValues(new Uint8Array(20));
  return [...b].map((x) => a[x % 62]).join("");
};
var projeto = () => conta().project_id;
var raiz = () => `projects/${projeto()}/databases/(default)/documents`;
var base = () => "https://firestore.googleapis.com/v1/";
async function rest(caminho, opts = {}) {
  const r = await fetch(base() + caminho, { ...opts, headers: { Authorization: "Bearer " + await tokenAcesso(), "Content-Type": "application/json", ...opts.headers || {} } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error("Firestore " + r.status + ": " + (j.error?.message || JSON.stringify(j)));
    e.code = r.status;
    throw e;
  }
  return j;
}
var snap = (id, doc) => ({ id, exists: !!doc, ref: null, data: () => doc ? deFs({ mapValue: { fields: doc.fields || {} } }) : void 0 });
function escrita(nome, dados, modo) {
  const w = { update: { name: nome, fields: campos(dados) } };
  if (modo === "merge" || modo === "update") w.updateMask = { fieldPaths: Object.keys(dados).filter((k) => dados[k] !== void 0).map(caminhoCampo) };
  if (modo === "update") w.currentDocument = { exists: true };
  return w;
}
var DocRef = class {
  constructor(col, id) {
    this.col = col;
    this.id = id;
    this.path = `${col}/${id}`;
  }
  get nome() {
    return `${raiz()}/${this.path}`;
  }
  async get() {
    try {
      return snap(this.id, await rest(this.nome));
    } catch (e) {
      if (e.code === 404) return snap(this.id, null);
      throw e;
    }
  }
  async set(dados, opt = {}) {
    await commit([escrita(this.nome, dados, opt.merge ? "merge" : "set")]);
  }
  async update(dados) {
    await commit([escrita(this.nome, dados, "update")]);
  }
  async delete() {
    await commit([{ delete: this.nome }]);
  }
  collection(sub) {
    return new Consulta(`${this.path}/${sub}`);
  }
};
var Consulta = class _Consulta {
  constructor(col, filtros = [], lim = 0, ordem = null) {
    this.col = col;
    this.filtros = filtros;
    this.lim = lim;
    this.ordem = ordem;
  }
  doc(id) {
    return new DocRef(this.col, id || autoId());
  }
  async add(dados) {
    const d = this.doc();
    await d.set(dados);
    return d;
  }
  where(campo, op, valor) {
    return new _Consulta(this.col, [...this.filtros, [campo, op, valor]], this.lim, this.ordem);
  }
  limit(n) {
    return new _Consulta(this.col, this.filtros, n, this.ordem);
  }
  orderBy(campo, dir = "asc") {
    return new _Consulta(this.col, this.filtros, this.lim, [campo, dir]);
  }
  async get() {
    const partes = this.col.split("/"), colId = partes.pop(), pai = partes.length ? `${raiz()}/${partes.join("/")}` : raiz();
    const OPS = { "==": "EQUAL", "!=": "NOT_EQUAL", "<": "LESS_THAN", "<=": "LESS_THAN_OR_EQUAL", ">": "GREATER_THAN", ">=": "GREATER_THAN_OR_EQUAL", "array-contains": "ARRAY_CONTAINS", in: "IN" };
    const f = this.filtros.map(([c, op, v]) => ({ fieldFilter: { field: { fieldPath: caminhoConsulta(c) }, op: OPS[op], value: paraFs(v) } }));
    const q = { from: [{ collectionId: colId }] };
    if (f.length === 1) q.where = f[0];
    else if (f.length > 1) q.where = { compositeFilter: { op: "AND", filters: f } };
    if (this.ordem) q.orderBy = [{ field: { fieldPath: caminhoConsulta(this.ordem[0]) }, direction: this.ordem[1] === "desc" ? "DESCENDING" : "ASCENDING" }];
    if (this.lim) q.limit = this.lim;
    const r = await rest(pai.replace(base(), "") + ":runQuery", { method: "POST", body: JSON.stringify({ structuredQuery: q }) });
    const docs = (Array.isArray(r) ? r : []).filter((x) => x.document).map((x) => {
      const id = x.document.name.split("/").pop();
      const s = snap(id, x.document);
      s.ref = new DocRef(this.col, id);
      return s;
    });
    return { empty: !docs.length, size: docs.length, docs, forEach: (fn) => docs.forEach(fn) };
  }
};
async function commit(writes, transaction) {
  return rest(`projects/${projeto()}/databases/(default)/documents:commit`, { method: "POST", body: JSON.stringify({ writes, ...transaction ? { transaction } : {} }) });
}
var firestore = {
  collection: (c) => new Consulta(c),
  doc: (p) => {
    const i = p.lastIndexOf("/");
    return new DocRef(p.slice(0, i), p.slice(i + 1));
  },
  batch() {
    const ws = [];
    return { set: (ref, d, o = {}) => ws.push(escrita(ref.nome, d, o.merge ? "merge" : "set")), update: (ref, d) => ws.push(escrita(ref.nome, d, "update")), delete: (ref) => ws.push({ delete: ref.nome }), commit: () => commit(ws) };
  },
  // transação de verdade: leituras com o id da transação, escritas no commit (o Firestore recusa se alguém mudou no meio)
  async runTransaction(fn) {
    for (let tentativa = 0; tentativa < 5; tentativa++) {
      const { transaction } = await rest(`projects/${projeto()}/databases/(default)/documents:beginTransaction`, { method: "POST", body: "{}" });
      const ws = [];
      const t = {
        get: async (ref) => {
          try {
            return snap(ref.id, await rest(ref.nome + "?transaction=" + encodeURIComponent(transaction)));
          } catch (e) {
            if (e.code === 404) return snap(ref.id, null);
            throw e;
          }
        },
        set: (ref, d, o = {}) => {
          ws.push(escrita(ref.nome, d, o.merge ? "merge" : "set"));
          return t;
        },
        update: (ref, d) => {
          ws.push(escrita(ref.nome, d, "update"));
          return t;
        },
        delete: (ref) => {
          ws.push({ delete: ref.nome });
          return t;
        }
      };
      const res = await fn(t);
      try {
        await commit(ws, transaction);
        return res;
      } catch (e) {
        if (e.code !== 409 && e.code !== 400 && e.code !== 412) throw e;
      }
    }
    throw new Error("transa\xE7\xE3o n\xE3o conclu\xEDda depois de 5 tentativas");
  }
};
var chavesGoogle = null;
async function chavePublica(kid) {
  if (!chavesGoogle || chavesGoogle.exp < Date.now() || !chavesGoogle.k[kid]) {
    const r = await fetch("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com");
    const j = await r.json(), m = /max-age=(\d+)/.exec(r.headers.get("cache-control") || "");
    chavesGoogle = { exp: Date.now() + (m ? +m[1] : 3600) * 1e3, k: Object.fromEntries((j.keys || []).map((k) => [k.kid, k])) };
  }
  const jwk = chavesGoogle.k[kid];
  if (!jwk) throw new Error("chave do token desconhecida");
  return crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
}
async function verifyIdToken(token) {
  const [h, p, s] = String(token || "").split(".");
  if (!s) throw Object.assign(new Error("login ausente"), { status: 401 });
  const cab = JSON.parse(new TextDecoder().decode(deB64url(h))), c = JSON.parse(new TextDecoder().decode(deB64url(p)));
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", await chavePublica(cab.kid), deB64url(s), new TextEncoder().encode(h + "." + p));
  const agora = Date.now() / 1e3, pid = projeto();
  if (!ok || cab.alg !== "RS256" || c.aud !== pid || c.iss !== "https://securetoken.google.com/" + pid || c.exp < agora || c.iat > agora + 300 || !c.sub)
    throw Object.assign(new Error("login inv\xE1lido ou vencido"), { status: 401 });
  return { ...c, uid: c.sub };
}
async function updateUser(uid, dados) {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${projeto()}/accounts:update`, {
    method: "POST",
    headers: { Authorization: "Bearer " + await tokenAcesso(), "Content-Type": "application/json" },
    body: JSON.stringify({ localId: uid, ...dados.password ? { password: dados.password } : {} })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("N\xE3o foi poss\xEDvel trocar a senha: " + (j.error?.message || r.status));
  return { uid };
}
async function enviarFcm(msg) {
  const m = { ...msg };
  if (m.android && typeof m.android.ttl === "number") m.android = { ...m.android, ttl: Math.round(m.android.ttl / 1e3) + "s" };
  const r = await fetch(`https://fcm.googleapis.com/v1/projects/${projeto()}/messages:send`, {
    method: "POST",
    headers: { Authorization: "Bearer " + await tokenAcesso(), "Content-Type": "application/json" },
    body: JSON.stringify({ message: m })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error("FCM " + r.status + ": " + (j.error?.message || "")), { codigo: j.error?.details?.[0]?.errorCode || j.error?.status });
  return j.name;
}
var admin = {
  apps: [],
  initializeApp() {
    admin.apps.push({});
    return {};
  },
  credential: { cert: (x) => x },
  firestore: () => firestore,
  auth: () => ({ verifyIdToken, updateUser }),
  messaging: () => ({ send: enviarFcm })
};
var firebase_rest_default = admin;

// api/_ios.js
var BASE = "https://a.simplemdm.com/api/v1";
var DIA = 864e5;
var mdmLigado = () => !!process.env.SIMPLEMDM_API_KEY;
async function mdm(path, { method = "GET", form } = {}) {
  const k = process.env.SIMPLEMDM_API_KEY;
  if (!k) throw Object.assign(new Error("Trava do iPhone n\xE3o configurada: falta a chave do MDM (SIMPLEMDM_API_KEY) no servidor."), { status: 400 });
  const r = await fetch(BASE + path, {
    method,
    headers: { Authorization: "Basic " + btoa(k + ":"), ...form ? { "content-type": "application/x-www-form-urlencoded" } : {} },
    ...form ? { body: new URLSearchParams(form).toString() } : {}
  });
  const t = await r.text();
  let j = {};
  try {
    j = t ? JSON.parse(t) : {};
  } catch (e) {
    j = { texto: t };
  }
  if (!r.ok) throw Object.assign(new Error("MDM: " + (j.errors?.[0]?.title || j.error || "erro " + r.status)), { status: r.status === 404 ? 404 : 502 });
  return j;
}
async function acharPorSerie(serial) {
  const s = String(serial || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (s.length < 8) throw Object.assign(new Error("N\xFAmero de s\xE9rie inv\xE1lido."), { status: 400 });
  const j = await mdm("/devices?limit=20&include_awaiting_enrollment=true&search=" + encodeURIComponent(s));
  const lista = (j.data || []).map((d) => ({ id: d.id, ...d.attributes }));
  return lista.find((d) => String(d.serial_number || "").toUpperCase() === s) || null;
}
var hojeBR = () => new Date(Date.now() - 3 * 36e5).toISOString().slice(0, 10);
function etapaTotal(d) {
  if (d.etapaTotalDias != null) return Math.max(1, +d.etapaTotalDias || 7);
  return (+d.toleranciaDias || 0) + 1;
}
function avaliarIos(d, agora = Date.now()) {
  if (d.quitado || d.status === "QUITADO") return { travar: false, final: true, motivo: "Contrato quitado" };
  if (d.status === "CANCELADO") return { travar: false, final: true, motivo: "Contrato cancelado" };
  if (d.removerRemoto) return { travar: false, final: true, motivo: "Remo\xE7\xE3o autorizada pela loja" };
  if (d.roubo && !d.roubo.liberadoEm) return { travar: true, motivo: `Aparelho com comunica\xE7\xE3o de ${String(d.roubo.tipo || "roubo").toLowerCase()}` };
  if (d.modo === "TRAVAR") return { travar: true, motivo: "Bloqueio solicitado pela loja" };
  if (d.modo === "LIBERAR") return { travar: false, motivo: "Liberado pela loja" };
  if ((+d.liberadoAte || 0) > agora) return { travar: false, motivo: "Libera\xE7\xE3o tempor\xE1ria" };
  if ((+d.confianca?.ate || 0) > agora) return { travar: false, motivo: "Libera\xE7\xE3o de confian\xE7a (24 h)" };
  const hoje2 = Date.parse(hojeBR());
  let maior = 0, atrasadas = 0;
  for (const p of d.parcelas || []) {
    if (p.pago || !p.venc) continue;
    const dias3 = Math.floor((hoje2 - Date.parse(p.venc)) / DIA);
    if (dias3 > 0) {
      atrasadas++;
      maior = Math.max(maior, dias3);
    }
  }
  if (maior >= etapaTotal(d)) return { travar: true, motivo: atrasadas === 1 ? "1 parcela em atraso" : `${atrasadas} parcelas em atraso` };
  return { travar: false, motivo: maior ? `Parcela em atraso h\xE1 ${maior} dia(s)` : "Em dia" };
}
async function sincronizarIos(db2, token, dados) {
  const ref = db2.collection("aparelhos").doc(String(token));
  const d = dados || (await ref.get()).data();
  if (!d?.ios) return false;
  if (!d.mdmId) return { ok: false, motivo: "iPhone ainda n\xE3o vinculado ao MDM" };
  const r = avaliarIos(d), ant = d.mdm || {};
  const novo = { ...ant, verificadoEm: Date.now(), motivo: r.motivo, erro: "" };
  try {
    if (r.travar && !ant.perdido) {
      const fone = String(d.lojaTelefone || d.telefoneSuporte || "").replace(/\D/g, "");
      await mdm(`/devices/${d.mdmId}/lost_mode`, { method: "POST", form: {
        message: `${d.lojaNome || d.recebedor || "NexumCell"}: ${r.motivo}. Regularize o pagamento para liberar o iPhone${d.portal ? " pelo portal " + d.portal : ""}.`.slice(0, 380),
        ...fone ? { phone_number: fone } : {},
        footnote: `Contrato n\xBA ${d.vendaNumero || ""} \xB7 ${d.clienteNome || ""}`.slice(0, 120)
      } });
      Object.assign(novo, { perdido: true, travadoEm: Date.now() });
    } else if (!r.travar && ant.perdido) {
      await mdm(`/devices/${d.mdmId}/lost_mode`, { method: "DELETE" });
      Object.assign(novo, { perdido: false, liberadoEm: Date.now() });
    }
    if (r.final && !ant.final) Object.assign(novo, { final: true, finalEm: Date.now(), aviso: "Contrato encerrado: libere o iPhone tamb\xE9m no Apple Business Manager (Liberar dispositivo) para o cliente ficar livre do gerenciamento." });
  } catch (e) {
    novo.erro = String(e.message || e).slice(0, 200);
  }
  await ref.set({ mdm: novo, travado: !!novo.perdido }, { merge: true });
  return { ok: !novo.erro, ...novo };
}
async function iosRotina(db2) {
  if (!mdmLigado()) return { ios: "MDM n\xE3o configurado" };
  const aps = (await db2.collection("aparelhos").where("ios", "==", true).get()).docs;
  let travados = 0, liberados = 0, erros = 0;
  for (const a of aps) {
    const d = a.data();
    if (!d.mdmId || d.mdm?.final) continue;
    const r = await sincronizarIos(db2, a.id, d);
    if (r?.erro) erros++;
    else if (r?.perdido && !d.mdm?.perdido) travados++;
    else if (r && !r.perdido && d.mdm?.perdido) liberados++;
  }
  return { iosTotal: aps.length, iosTravados: travados, iosLiberados: liberados, iosErros: erros };
}

// api/_base.js
if (!firebase_rest_default.apps.length && process.env.FIREBASE_SERVICE_ACCOUNT) {
  firebase_rest_default.initializeApp({ credential: firebase_rest_default.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
}
var db = firebase_rest_default.firestore();
var auth = firebase_rest_default.auth();
var ASAAS = () => process.env.ASAAS_URL || "https://api.asaas.com/v3";
var _cofre = null;
async function asaasConf() {
  if (!_cofre || _cofre.em < Date.now() - 6e4) {
    let d2 = {};
    try {
      d2 = (await db.collection("segredos").doc("asaas").get()).data() || {};
    } catch (e) {
      d2 = {};
    }
    _cofre = { em: Date.now(), d: d2 };
  }
  const d = _cofre.d, chave = String(d.chave || "").trim();
  if (chave) return { chave, url: d.ambiente === "producao" ? "https://api.asaas.com/v3" : "https://api-sandbox.asaas.com/v3", webhookToken: d.webhookToken || process.env.ASAAS_WEBHOOK_TOKEN || "", origem: "painel", ambiente: d.ambiente === "producao" ? "producao" : "sandbox" };
  return { chave: process.env.ASAAS_API_KEY || "", url: ASAAS(), webhookToken: process.env.ASAAS_WEBHOOK_TOKEN || "", origem: "servidor", ambiente: ASAAS().includes("sandbox") ? "sandbox" : "producao" };
}
var asaasLigadoSrv = async () => !!(await asaasConf()).chave;
var _cfg = null;
async function config() {
  if (_cfg && _cfg.em > Date.now() - 3e5) return _cfg.d;
  const d = (await db.collection("config").doc("sistema").get()).data() || {};
  _cfg = { em: Date.now(), d };
  return d;
}
async function asaas(path, opts = {}) {
  const ac = await asaasConf();
  if (!ac.chave) throw new Error("Asaas n\xE3o configurado: cole a chave em Configura\xE7\xF5es \u2192 Asaas");
  const r = await fetch(ac.url + path, {
    ...opts,
    headers: { "Content-Type": "application/json", access_token: ac.chave, "User-Agent": "nexumcell", ...opts.headers || {} }
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("Asaas " + r.status + ": " + JSON.stringify(j.errors || j));
  return j;
}
function cors(req, res) {
  res.setHeader("Access-Control-Allow-Origin", process.env.PORTAL_ORIGEM || "https://nexumrh.github.io");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return true;
  }
  return false;
}
var r2 = (n) => Math.round(n * 100) / 100;
var hoje = () => new Date(Date.now() - 3 * 36e5).toISOString().slice(0, 10);
function encargos(p, ap, data = hoje()) {
  const dias3 = Math.round((new Date(data) - new Date(p.venc)) / 864e5);
  if (dias3 < 0) return r2(p.valor * (1 - (ap.descontoPct || 0) / 100));
  if (dias3 === 0) return p.valor;
  return r2(p.valor * (1 + (ap.multaPct || 0) / 100 + (ap.moraDiaPct || 0) / 100 * dias3));
}
async function baixarParcela(vendaId, n, valorPago, forma, obs) {
  const ref = db.collection("vendas").doc(vendaId);
  await db.runTransaction(async (t) => {
    const s = await t.get(ref);
    if (!s.exists) throw new Error("venda n\xE3o encontrada");
    const v2 = s.data();
    const parcelas = (v2.parcelas || []).map(
      (p) => p.n === n && !p.pago ? { ...p, pago: true, pagoEm: hoje(), valorPago: r2(valorPago), forma, obs, por: "Asaas (autom\xE1tico)", baixadoEm: Date.now() } : p
    );
    const quitado = parcelas.every((p) => p.pago);
    t.update(ref, { parcelas, status: quitado ? "QUITADA" : v2.status, ...quitado ? { quitadoEm: Date.now() } : {} });
    if (v2.aparelhoToken) {
      t.update(db.collection("aparelhos").doc(v2.aparelhoToken), {
        parcelas: parcelas.map(paraAparelho),
        quitado,
        status: quitado ? "QUITADO" : "ATIVO"
      });
    }
    t.set(db.collection("logs").doc(), { em: Date.now(), acao: "Pagamento autom\xE1tico (Asaas)", alvo: vendaId, det: `parcela ${n} \xB7 R$ ${valorPago} \xB7 ${forma}`, por: "Asaas" });
  });
  const v = (await ref.get()).data();
  if (v?.aparelhoToken) await pushAparelho(v.aparelhoToken);
}
async function pushNotificacao(token, titulo, texto) {
  try {
    if (!token) return false;
    const a = (await db.collection("aparelhos").doc(String(token)).get()).data();
    const t = a?.checkin?.push;
    if (!t) return false;
    await firebase_rest_default.messaging().send({ token: t, notification: { title: titulo, body: String(texto).slice(0, 230) }, data: { acao: "sync", em: String(Date.now()) }, android: { priority: "high", ttl: 86400 * 1e3 } });
    return true;
  } catch (e) {
    console.warn("push", token, e.message);
    return false;
  }
}
async function pushAparelho(token) {
  try {
    if (!token) return false;
    const a = (await db.collection("aparelhos").doc(String(token)).get()).data();
    if (a?.ios) return !!await sincronizarIos(db, token, a);
    const t = a?.checkin?.push;
    if (!t) return false;
    await firebase_rest_default.messaging().send({ token: t, data: { acao: "sync", em: String(Date.now()) }, android: { priority: "high", ttl: 3600 * 1e3 } });
    return true;
  } catch (e) {
    console.warn("push", token, e.message);
    return false;
  }
}
async function exigirEquipe(req, perfis = ["DONO", "FINANCEIRO", "GERENTE", "SUPORTE", "VENDEDOR"]) {
  const idt = String(req.headers.authorization || "").replace("Bearer ", "");
  const u = await auth.verifyIdToken(idt);
  const me = await db.collection("users").doc(u.uid).get();
  const dono = (u.email || "").toLowerCase() === String(process.env.DONO_EMAIL || "").toLowerCase();
  const role = dono ? "DONO" : me.exists ? me.data().role : "";
  if (!perfis.includes(role)) {
    const e = new Error("sem permiss\xE3o");
    e.status = 403;
    throw e;
  }
  return { uid: u.uid, role, nome: dono ? "Dono" : me.data()?.nome || "", lojaId: me.data()?.lojaId || "" };
}
async function clienteAsaas(v) {
  if (v.asaas?.customer) return { id: v.asaas.customer };
  const cpf = String(v.clienteCpf || "").replace(/\D/g, "");
  const achado = (await asaas("/customers?cpfCnpj=" + cpf)).data?.[0];
  if (achado) return achado;
  const c = v.cliente || {};
  return asaas("/customers", { method: "POST", body: JSON.stringify({
    name: v.clienteNome,
    cpfCnpj: cpf,
    email: c.email || void 0,
    mobilePhone: String((c.telefones || [])[0] || "").replace(/\D/g, "") || void 0,
    phone: String((c.telefones || [])[1] || "").replace(/\D/g, "") || void 0,
    postalCode: String(c.cep || "").replace(/\D/g, "") || void 0,
    address: c.endereco || void 0,
    province: c.bairro || void 0,
    externalReference: "cpf:" + cpf,
    notificationDisabled: false
  }) });
}
async function gerarCobrancas(vendaId) {
  const ref = db.collection("vendas").doc(vendaId), s = await ref.get();
  if (!s.exists) throw new Error("venda n\xE3o encontrada");
  const v = s.data(), ap = v.aparelhoToken ? (await db.collection("aparelhos").doc(v.aparelhoToken).get()).data() || {} : {};
  if (["CANCELADA", "RETOMADA", "REPROVADA"].includes(v.status)) return { criadas: 0, ignorado: v.status };
  if (v.pixAutomatico?.status === "ATIVO") return { criadas: 0, pixAutomatico: true };
  let split = await splitDoVendedor(v);
  const cli = await clienteAsaas(v), parcelas = [...v.parcelas || []], vivos = new Set(parcelas.map((p) => p.asaasId).filter(Boolean));
  let criadas = 0, atualizadas = 0, apagadas = 0, emDinheiro = 0;
  for (const id of v.asaas?.ids || []) if (!vivos.has(id)) {
    try {
      await asaas("/payments/" + id, { method: "DELETE" });
      apagadas++;
    } catch (e) {
    }
  }
  for (const p of parcelas) {
    if (p.pago) {
      if (p.asaasId && !p.asaasPago && !String(p.forma || "").includes("Asaas")) {
        try {
          await asaas(`/payments/${p.asaasId}/receiveInCash`, { method: "POST", body: JSON.stringify({ paymentDate: p.pagoEm || hoje(), value: +(p.valorPago ?? p.valor), notifyCustomer: false }) });
          emDinheiro++;
        } catch (e) {
        }
        p.asaasPago = true;
      }
      continue;
    }
    const venc = p.venc < hoje() ? hoje() : p.venc;
    if (p.asaasId) {
      if (p.asaasValor !== p.valor || p.asaasVenc !== p.venc) {
        try {
          await asaas("/payments/" + p.asaasId, { method: "POST", body: JSON.stringify({ value: p.valor, dueDate: venc }) });
          p.asaasValor = p.valor;
          p.asaasVenc = p.venc;
          atualizadas++;
        } catch (e) {
        }
      }
      continue;
    }
    if (p.semCobranca) continue;
    const corpo = {
      customer: cli.id,
      billingType: "UNDEFINED",
      value: p.valor,
      dueDate: venc,
      description: `${ap.recebedor || "NexumCell"} \xB7 contrato ${v.numero} \xB7 parcela ${p.n}/${parcelas.length}`.slice(0, 500),
      externalReference: `${vendaId}:${p.n}`,
      discount: { value: Number(ap.descontoPct) || 0, dueDateLimitDays: 0, type: "PERCENTAGE" },
      fine: { value: Number(ap.multaPct) || 0, type: "PERCENTAGE" },
      interest: { value: r2((Number(ap.moraDiaPct) || 0) * 30) }
      // Asaas: juros ao mês
    };
    if (split) corpo.splits = [split];
    let cob;
    try {
      cob = await asaas("/payments", { method: "POST", body: JSON.stringify(corpo) });
    } catch (e) {
      if (!split) throw e;
      delete corpo.splits;
      split = null;
      cob = await asaas("/payments", { method: "POST", body: JSON.stringify(corpo) });
      await db.collection("logs").add({ em: Date.now(), acao: "Split da comiss\xE3o recusado pelo Asaas", alvo: vendaId, det: String(e.message).slice(0, 300), por: "Servidor" });
    }
    if (corpo.splits) p.split = { walletId: split.walletId, pct: split.percentualValue };
    Object.assign(p, { asaasId: cob.id, asaasLink: cob.invoiceUrl, asaasValor: p.valor, asaasVenc: p.venc });
    criadas++;
  }
  const ids = [...new Set(parcelas.map((p) => p.asaasId).filter(Boolean))];
  await ref.update({ parcelas, asaas: { customer: cli.id, ids, sincronizadoEm: Date.now() } });
  if (v.aparelhoToken) await db.collection("aparelhos").doc(v.aparelhoToken).set({ parcelas: parcelas.map(paraAparelho) }, { merge: true });
  return { criadas, atualizadas, apagadas, emDinheiro, customer: cli.id };
}
async function splitDoVendedor(v) {
  const cfg = await config();
  if (cfg.splitComissao !== "sim" || !v.vendedorUid) return null;
  const u = (await db.collection("users").doc(v.vendedorUid).get()).data() || {};
  const pct = Number(u.comissaoPct ?? cfg.comissaoPct) || 0;
  if (!u.asaasWalletId || !(pct > 0)) return null;
  return { walletId: u.asaasWalletId, percentualValue: Math.min(50, pct) };
}
async function parcelaDaCobranca(payment) {
  const [vendaId, n] = String(payment.externalReference || "").split(":");
  if (vendaId && n) return { vendaId, n: +n };
  let vid = vendaId && vendaId.startsWith("v") ? vendaId : null;
  if (!vid && payment.pixAutomaticAuthorizationId) {
    const q = await db.collection("vendas").where("pixAutomatico.id", "==", payment.pixAutomaticAuthorizationId).limit(1).get();
    if (!q.empty) vid = q.docs[0].id;
  }
  if (vid) {
    const vendaId2 = vid;
    const v = (await db.collection("vendas").doc(vendaId2).get()).data();
    const p = (v?.parcelas || []).filter((x) => !x.pago).sort((a, b) => Math.abs(new Date(a.venc) - new Date(payment.dueDate)) - Math.abs(new Date(b.venc) - new Date(payment.dueDate)))[0];
    if (p) return { vendaId: vendaId2, n: p.n };
  }
  return null;
}
function paraAparelho(p) {
  const o = { n: p.n, venc: p.venc, valor: p.valor, pago: !!p.pago };
  if (p.pago) Object.assign(o, { pagoEm: p.pagoEm || "", valorPago: +(p.valorPago ?? p.valor), emDia: !!p.pagoEm && p.pagoEm <= p.venc && !p.acordo });
  if (p.pagoParcial) o.pagoParcial = p.pagoParcial;
  if (!p.pago && p.asaasLink) o.asaasLink = p.asaasLink;
  return o;
}

// api/pix.js
async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== "POST") return res.status(405).end();
  try {
    const { token, vendaId: vid, n } = req.body || {};
    let vendaId = vid;
    if (token) {
      const ap = await db.collection("aparelhos").doc(String(token)).get();
      if (!ap.exists) return res.status(404).json({ erro: "aparelho n\xE3o encontrado" });
      vendaId = ap.data().vendaId;
    } else {
      const idt = String(req.headers.authorization || "").replace("Bearer ", "");
      const u = await auth.verifyIdToken(idt);
      const me = await db.collection("users").doc(u.uid).get();
      if (!me.exists || !["DONO", "FINANCEIRO", "GERENTE"].includes(me.data().role)) return res.status(403).json({ erro: "sem permiss\xE3o" });
    }
    const vs = await db.collection("vendas").doc(String(vendaId)).get();
    if (!vs.exists) return res.status(404).json({ erro: "venda n\xE3o encontrada" });
    const v = vs.data();
    const p = (v.parcelas || []).find((x) => x.n === +n);
    if (!p || p.pago) return res.status(400).json({ erro: "parcela inexistente ou j\xE1 paga" });
    const apDoc = v.aparelhoToken ? (await db.collection("aparelhos").doc(v.aparelhoToken).get()).data() : {};
    const valor = encargos(p, apDoc || {});
    if (p.asaasId) {
      const qr2 = await asaas(`/payments/${p.asaasId}/pixQrCode`);
      return res.status(200).json({ valor, copiaECola: qr2.payload, qrBase64: qr2.encodedImage, expira: qr2.expirationDate, cobranca: p.asaasId });
    }
    const cpf = String(v.clienteCpf || "").replace(/\D/g, "");
    let cli = (await asaas("/customers?cpfCnpj=" + cpf)).data?.[0];
    if (!cli) cli = await asaas("/customers", { method: "POST", body: JSON.stringify({ name: v.clienteNome, cpfCnpj: cpf, mobilePhone: String(v.clienteTel1 || "").replace(/\D/g, "") }) });
    const ref = `${vs.id}:${p.n}`;
    let cob = (await asaas("/payments?externalReference=" + encodeURIComponent(ref) + "&status=PENDING")).data?.find((c) => c.value === valor);
    if (!cob) {
      cob = await asaas("/payments", {
        method: "POST",
        body: JSON.stringify({ customer: cli.id, billingType: "PIX", value: valor, dueDate: hoje(), externalReference: ref, description: `NexumCell contrato ${v.numero} parcela ${p.n}` })
      });
    }
    const qr = await asaas(`/payments/${cob.id}/pixQrCode`);
    return res.status(200).json({ valor, copiaECola: qr.payload, qrBase64: qr.encodedImage, expira: qr.expirationDate, cobranca: cob.id });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ erro: e.message });
  }
}

// api/loja.js
async function pedirNegativacao(v2, p, por) {
  const c = v2.cliente || {}, num = (String(c.endereco || "").match(/,\s*(\d+)/) || [])[1] || "S/N";
  const r = await asaas("/paymentDunnings", { method: "POST", body: JSON.stringify({
    payment: p.asaasId,
    type: "CREDIT_BUREAU",
    description: `Compra a prazo de aparelho celular \u2014 contrato ${v2.numero}`,
    customerName: v2.clienteNome,
    customerCpfCnpj: String(v2.clienteCpf).replace(/\D/g, ""),
    customerPrimaryPhone: String((c.telefones || [])[0] || "").replace(/\D/g, ""),
    customerSecondaryPhone: String((c.telefones || [])[1] || "").replace(/\D/g, ""),
    customerPostalCode: String(c.cep || "").replace(/\D/g, ""),
    customerAddress: c.endereco || "",
    customerAddressNumber: num,
    customerProvince: c.bairro || ""
  }) });
  await db.collection("vendas").doc(v2.id).set({ negativacao: { id: r.id, status: r.status || "PENDING", parcela: p.n, em: Date.now(), por } }, { merge: true });
  return r;
}
async function handler2(req, res) {
  if (cors(req, res)) return;
  if (req.method !== "POST") return res.status(405).end();
  try {
    const b = req.body || {};
    if (b.acao === "cobrancas") {
      await exigirEquipe(req);
      return res.status(200).json(await gerarCobrancas(String(b.vendaId)));
    }
    if (b.acao === "serasa") {
      await exigirEquipe(req, ["DONO", "FINANCEIRO"]);
      const r = await asaas("/creditBureauReport", { method: "POST", body: JSON.stringify({ cpfCnpj: String(b.cpf || "").replace(/\D/g, ""), state: b.uf || "PR" }) });
      return res.status(200).json({ id: r.id, link: r.downloadUrl || r.reportFile || null, criadoEm: r.dateCreated || null, bruto: r });
    }
    if (b.acao === "negativar") {
      const quem = await exigirEquipe(req, ["DONO", "FINANCEIRO"]);
      const v = (await db.collection("vendas").doc(String(b.vendaId)).get()).data();
      if (!v) throw new Error("venda n\xE3o encontrada");
      if ((v.parcelas || []).every((p2) => !p2.asaasId)) await gerarCobrancas(String(b.vendaId));
      const v2 = { id: String(b.vendaId), ...(await db.collection("vendas").doc(String(b.vendaId)).get()).data() };
      const p = (v2.parcelas || []).find((x) => x.n === +b.n) || (v2.parcelas || []).find((x) => !x.pago && x.venc < hoje());
      if (!p?.asaasId) throw new Error("parcela sem cobran\xE7a no Asaas");
      const r = await pedirNegativacao(v2, p, quem.nome);
      return res.status(200).json({ id: r.id, status: r.status });
    }
    if (b.acao === "cartao") {
      const quem = await exigirEquipe(req);
      const cli = await clienteAsaas({ clienteCpf: b.cpf, clienteNome: b.nome, cliente: { telefones: [b.telefone] } });
      const ref = db.collection("linksCartao").doc();
      const n = Math.max(1, Math.min(21, +b.parcelas || 1)), valor = r2(+b.valor);
      const cob = await asaas("/payments", { method: "POST", body: JSON.stringify({
        customer: cli.id,
        billingType: "CREDIT_CARD",
        dueDate: hoje(),
        externalReference: "cartao:" + ref.id,
        description: String(b.descricao || "Compra NexumCell").slice(0, 500),
        ...n > 1 ? { installmentCount: n, totalValue: valor } : { value: valor }
      }) });
      await ref.set({ status: "AGUARDANDO", valor, parcelas: n, descricao: b.descricao || "", cliente: b.nome, cpf: String(b.cpf || "").replace(/\D/g, ""), link: cob.invoiceUrl, asaasId: cob.id, lojaId: b.lojaId || "", por: quem.nome, criadoEm: Date.now() });
      return res.status(200).json({ id: ref.id, link: cob.invoiceUrl });
    }
    if (b.acao === "antecipar") {
      await exigirEquipe(req, ["DONO", "FINANCEIRO"]);
      let bruto = 0, liquido = 0, qtd = 0, erros = 0;
      for (const id of (b.vendaIds || []).slice(0, 30)) {
        const v = (await db.collection("vendas").doc(String(id)).get()).data();
        for (const p of (v?.parcelas || []).filter((x) => !x.pago && x.asaasId && x.venc > hoje()).slice(0, 3)) {
          try {
            const s = await asaas("/anticipations/simulate", { method: "POST", body: JSON.stringify({ payment: p.asaasId }) });
            bruto += +s.value || p.valor;
            liquido += +s.netValue || 0;
            qtd++;
          } catch (e) {
            erros++;
          }
        }
      }
      return res.status(200).json({ qtd, bruto: r2(bruto), liquido: r2(liquido), custo: r2(bruto - liquido), erros });
    }
    if (b.acao === "cancelarBoleto" || b.acao === "reativarBoleto") {
      const quem = await exigirEquipe(req, ["DONO", "FINANCEIRO"]);
      const ref = db.collection("vendas").doc(String(b.vendaId)), v = (await ref.get()).data();
      if (!v) throw new Error("venda n\xE3o encontrada");
      const parcelas = (v.parcelas || []).map((p2) => ({ ...p2 })), p = parcelas.find((x) => x.n === +b.n);
      if (!p) throw new Error("parcela n\xE3o encontrada");
      if (p.pago) throw new Error("parcela j\xE1 paga: use Estornar");
      if (b.acao === "cancelarBoleto") {
        const id = p.asaasId;
        if (id) {
          try {
            await asaas("/payments/" + id, { method: "DELETE" });
          } catch (e) {
            if (!/404|not.?found|removed|deleted/i.test(e.message)) throw e;
          }
        }
        delete p.asaasId;
        delete p.asaasLink;
        delete p.asaasValor;
        delete p.asaasVenc;
        p.semCobranca = true;
        p.boletoCancelado = { em: Date.now(), por: quem.nome, motivo: String(b.motivo || "").slice(0, 200), asaasId: id || "" };
        await ref.update({ parcelas, asaas: { ...v.asaas || {}, ids: (v.asaas?.ids || []).filter((x) => x !== id) } });
        if (v.aparelhoToken) await db.collection("aparelhos").doc(v.aparelhoToken).set({ parcelas: parcelas.map(paraAparelho) }, { merge: true });
        await db.collection("logs").add({ em: Date.now(), acao: "Boleto cancelado no Asaas", alvo: b.vendaId, det: `parcela ${p.n} \xB7 ${b.motivo || ""}`.slice(0, 200), por: quem.nome });
        return res.status(200).json({ ok: true, cancelado: id || null });
      }
      delete p.semCobranca;
      delete p.boletoCancelado;
      await ref.update({ parcelas });
      const r = await gerarCobrancas(String(b.vendaId));
      await db.collection("logs").add({ em: Date.now(), acao: "Boleto gerado de novo no Asaas", alvo: b.vendaId, det: `parcela ${p.n}`, por: quem.nome });
      return res.status(200).json(r);
    }
    if (b.acao === "cancelarCobrancas") {
      const quem = await exigirEquipe(req, ["DONO", "FINANCEIRO"]);
      const ref = db.collection("vendas").doc(String(b.vendaId)), v = (await ref.get()).data();
      if (!v) throw new Error("venda n\xE3o encontrada");
      if (!["CANCELADA", "RETOMADA"].includes(v.status)) throw new Error("s\xF3 para venda cancelada ou retomada");
      let apagadas = 0;
      const parcelas = (v.parcelas || []).map((p) => ({ ...p }));
      for (const p of parcelas) if (!p.pago && p.asaasId) {
        try {
          await asaas("/payments/" + p.asaasId, { method: "DELETE" });
          apagadas++;
        } catch (e) {
        }
        delete p.asaasId;
        delete p.asaasLink;
      }
      await ref.update({ parcelas, asaas: { ...v.asaas || {}, ids: [], canceladoEm: Date.now() } });
      await db.collection("logs").add({ em: Date.now(), acao: "Cobran\xE7as apagadas no Asaas", alvo: b.vendaId, det: `${apagadas} cobran\xE7a(s)`, por: quem.nome });
      return res.status(200).json({ apagadas });
    }
    return res.status(400).json({ erro: "a\xE7\xE3o desconhecida" });
  } catch (e) {
    console.error(e);
    return res.status(e.status || 500).json({ erro: e.message });
  }
}

// api/pix-automatico.js
async function handler3(req, res) {
  if (cors(req, res)) return;
  if (req.method !== "POST") return res.status(405).end();
  try {
    const { token } = req.body || {};
    const as = await db.collection("aparelhos").doc(String(token)).get();
    if (!as.exists) return res.status(404).json({ erro: "contrato n\xE3o encontrado" });
    const ap = as.data(), vref = db.collection("vendas").doc(ap.vendaId), v = (await vref.get()).data();
    if (v.pixAutomatico?.status === "ATIVO") return res.status(200).json({ jaAtivo: true });
    const abertas = (v.parcelas || []).filter((p) => !p.pago);
    if (abertas.length < 2) return res.status(400).json({ erro: "poucas parcelas em aberto" });
    const [prox, ...resto] = abertas, cli = await clienteAsaas(v);
    const valorAgora = encargos(prox, ap), valorMensal = r2(resto[0].valor);
    const aut = await asaas("/pix/automatic/authorizations", { method: "POST", body: JSON.stringify({
      customerId: cli.id,
      frequency: "MONTHLY",
      contractId: ap.vendaId.slice(0, 35),
      description: `Contrato ${v.numero}`.slice(0, 35),
      startDate: resto[0].venc,
      finishDate: resto[resto.length - 1].venc,
      value: valorMensal,
      paymentCreationMode: "SUBSCRIPTION",
      retryPolicy: "ALLOW_THREE_IN_SEVEN_DAYS",
      immediateQrCode: { originalValue: valorAgora, expirationSeconds: 86400, description: `Parcela ${prox.n} \u2014 contrato ${v.numero}`.slice(0, 35) }
    }) });
    await vref.set({ pixAutomatico: { id: aut.id, status: "AGUARDANDO", parcelaInicial: prox.n, valorMensal, em: Date.now() } }, { merge: true });
    const qr = aut.immediateQrCode || aut.qrCode || {};
    return res.status(200).json({ valor: valorAgora, valorMensal, copiaECola: qr.payload || qr.copyPaste || "", qrBase64: qr.encodedImage || "", autorizacao: aut.id });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ erro: e.message });
  }
}

// api/_brevo.js
var env = () => globalThis.process?.env || {};
var brevoLigado = () => !!env().BREVO_API_KEY;
async function brevo(caminho, corpo) {
  if (!brevoLigado()) throw new Error("Brevo n\xE3o configurado (falta BREVO_API_KEY)");
  const r = await fetch("https://api.brevo.com/v3" + caminho, {
    method: "POST",
    headers: { "api-key": env().BREVO_API_KEY, "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify(corpo)
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("Brevo " + r.status + ": " + (j.message || j.code || JSON.stringify(j)));
  return j;
}
var escHtml = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
function moldura(titulo, corpoTexto, rodape = "") {
  const corpo = String(corpoTexto).split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px">${escHtml(p).replace(/\n/g, "<br>")}</p>`).join("");
  return `<!doctype html><html><body style="margin:0;background:#F2F4F8;font-family:Arial,Helvetica,sans-serif;color:#1B2540">
  <div style="max-width:560px;margin:0 auto;padding:24px 14px"><div style="background:#0E1A3A;color:#F3D98B;border-radius:14px 14px 0 0;padding:18px 22px;font-size:19px;font-weight:bold">${escHtml(titulo)}</div>
  <div style="background:#fff;border-radius:0 0 14px 14px;padding:22px;font-size:15px;line-height:1.5">${corpo}</div>
  <p style="font-size:12px;color:#7A86A3;text-align:center;margin-top:14px">${escHtml(rodape || "Mensagem autom\xE1tica do sistema NexumCell.")}</p></div></body></html>`;
}
async function enviarEmail({ para, assunto, html, texto, titulo, anexos }) {
  const to = (Array.isArray(para) ? para : [para]).filter(Boolean).map((x) => typeof x === "string" ? { email: x } : x);
  if (!to.length) throw new Error("sem destinat\xE1rio");
  return brevo("/smtp/email", {
    sender: { email: env().BREVO_REMETENTE, name: env().BREVO_REMETENTE_NOME || "NexumCell" },
    to,
    subject: String(assunto).slice(0, 200),
    htmlContent: html || moldura(titulo || assunto, texto || ""),
    ...texto ? { textContent: texto } : {},
    ...anexos?.length ? { attachment: anexos } : {}
    // [{name:'relatorio.csv', content:'<base64>'}]
  });
}
var telInter = (t) => {
  const d = String(t || "").replace(/\D/g, "");
  if (!d) return "";
  return d.startsWith("55") && d.length >= 12 ? d : "55" + d;
};
async function enviarSms(tel, texto) {
  const n = telInter(tel);
  if (!n) throw new Error("sem telefone");
  return brevo("/transactionalSMS/send", { sender: (env().BREVO_SMS_REMETENTE || "NexumCell").replace(/\s/g, "").slice(0, 11), recipient: n, content: String(texto).slice(0, 640), type: "transactional", unicodeEnabled: false });
}
async function enviarWhatsapp(tel, { templateId, params, texto }) {
  const n = telInter(tel);
  if (!n) throw new Error("sem telefone");
  if (!env().BREVO_WHATSAPP_NUMERO) throw new Error("falta BREVO_WHATSAPP_NUMERO");
  const corpo = { senderNumber: telInter(env().BREVO_WHATSAPP_NUMERO), contactNumbers: [n] };
  if (templateId) Object.assign(corpo, { templateId: +templateId, params: params || {} });
  else corpo.text = String(texto || "");
  return brevo("/whatsapp/sendMessage", corpo);
}
var MODELOS = {
  lembrete: () => env().BREVO_WA_TEMPLATE_LEMBRETE,
  // parcela vencendo: NOME, VALOR, VENCIMENTO, LINK
  atraso: () => env().BREVO_WA_TEMPLATE_ATRASO,
  // parcela atrasada: NOME, VALOR, DIAS, LINK
  recibo: () => env().BREVO_WA_TEMPLATE_RECIBO,
  // pagamento recebido: NOME, VALOR, PARCELA
  resumo: () => env().BREVO_WA_TEMPLATE_RESUMO
  // resumo do dono: TEXTO
};
async function avisarCliente(tel, canal, { modelo, params, texto }) {
  const r = { whatsapp: null, sms: null };
  if (["whatsapp", "ambos", "whatsapp_ou_sms"].includes(canal)) {
    try {
      const id = MODELOS[modelo]?.();
      if (!id) throw new Error('modelo de WhatsApp "' + modelo + '" n\xE3o configurado');
      await enviarWhatsapp(tel, { templateId: id, params });
      r.whatsapp = "ok";
    } catch (e) {
      r.whatsapp = e.message;
    }
  }
  if (["sms", "ambos"].includes(canal) || canal === "whatsapp_ou_sms" && r.whatsapp !== "ok") {
    try {
      await enviarSms(tel, texto);
      r.sms = "ok";
    } catch (e) {
      r.sms = e.message;
    }
  }
  return r;
}

// api/saas.js
var addDias = (iso, n) => {
  const d = /* @__PURE__ */ new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
async function valorEmpresa(empresaId) {
  const e = (await db.collection("empresas").doc(empresaId).get()).data();
  if (!e) throw Object.assign(new Error("Empresa n\xE3o encontrada"), { status: 404 });
  const lojas = (await db.collection("lojas").where("empresaId", "==", empresaId).get()).docs.map((d) => d.data()).filter((l) => !l.encerrada);
  const valor = Math.round((Number(e.porLoja) || 0) * Math.max(1, lojas.length) * 100) / 100;
  return { e, lojas: lojas.length, valor };
}
async function handler4(req, res) {
  if (cors(req, res)) return;
  if (req.method !== "POST") return res.status(405).end();
  try {
    const b0 = req.body || {};
    if (b0.acao === "licSaldo" || b0.acao === "licComprar") {
      const eu = await exigirEquipe(req, b0.acao === "licSaldo" ? void 0 : ["DONO", "GERENTE"]);
      const lojaId = ["DONO", "FINANCEIRO", "SUPORTE"].includes(eu.role) ? String(b0.lojaId || "") : eu.lojaId;
      if (!lojaId) throw Object.assign(new Error("loja n\xE3o informada"), { status: 400 });
      if (b0.acao === "licSaldo") return res.status(200).json({ ok: true, ...await saldoLicencas(lojaId) });
      return res.status(200).json(await comprarLicencas(lojaId, b0.q, eu));
    }
    if (b0.acao === "senhaPadrao") {
      const eu = await exigirEquipe(req, ["DONO", "GERENTE"]), uid = String(b0.uid || "");
      const ur = db.collection("users").doc(uid), u = (await ur.get()).data();
      if (!u || !["GERENTE", "VENDEDOR"].includes(u.role)) throw Object.assign(new Error("Usu\xE1rio n\xE3o encontrado"), { status: 404 });
      if (eu.role === "GERENTE" && (u.role !== "VENDEDOR" || u.lojaId !== eu.lojaId)) throw Object.assign(new Error("sem permiss\xE3o"), { status: 403 });
      await auth.updateUser(uid, { password: "nx-12345" });
      await ur.set({ senhaTemporaria: true, senhaResetEm: Date.now(), senhaResetPor: eu.nome }, { merge: true });
      await db.collection("logs").add({ em: Date.now(), acao: "Senha voltou para a inicial", alvo: uid, det: u.nome || "", por: eu.nome });
      return res.status(200).json({ ok: true });
    }
    await exigirEquipe(req, ["DONO"]);
    if (!await asaasLigadoSrv()) throw Object.assign(new Error("Asaas n\xE3o configurado: cole a chave em Configura\xE7\xF5es \u2192 Asaas."), { status: 400 });
    const b = req.body || {}, id = String(b.empresaId || "");
    if (!/^e_\d{14}$/.test(id)) throw Object.assign(new Error("empresa inv\xE1lida"), { status: 400 });
    const ref = db.collection("empresas").doc(id);
    const { e, lojas, valor } = await valorEmpresa(id);
    if (b.acao === "assinar") {
      if (e.asaasAssinatura) return res.status(200).json({ ok: true, ja: true, assinatura: e.asaasAssinatura, valor });
      const cfg = await config();
      let cliente = e.asaasCliente;
      if (!cliente) {
        const c = await asaas("/customers", { method: "POST", body: JSON.stringify({ name: e.razao || e.fantasia, cpfCnpj: e.cnpj, email: e.respEmail, mobilePhone: e.respTelefone, externalReference: "saas:" + id, notificationDisabled: false }) });
        cliente = c.id;
      }
      const venc = addDias(hoje(), Math.max(1, Number(cfg.saasDiasTeste ?? 7) || 1));
      const s = await asaas("/subscriptions", { method: "POST", body: JSON.stringify({
        customer: cliente,
        billingType: "UNDEFINED",
        value: valor,
        nextDueDate: venc,
        cycle: "MONTHLY",
        description: `${cfg.empresa || "NexumCell"} \u2014 plano ${e.planoNome || e.plano} (${lojas} loja(s))`,
        externalReference: "saas:" + id
      }) });
      if (Number(cfg.saasAdesao) > 0 && !e.adesaoCobrada) {
        await asaas("/payments", { method: "POST", body: JSON.stringify({ customer: cliente, billingType: "UNDEFINED", value: Number(cfg.saasAdesao), dueDate: addDias(hoje(), 3), description: "Taxa de ades\xE3o", externalReference: "saas:" + id }) });
      }
      await ref.set({ asaasCliente: cliente, asaasAssinatura: s.id, mensalidade: valor, lojasCobradas: lojas, situacao: "TESTE", primeiroVencimento: venc, assinadaEm: Date.now(), ...Number(cfg.saasAdesao) > 0 ? { adesaoCobrada: true } : {} }, { merge: true });
      return res.status(200).json({ ok: true, assinatura: s.id, valor, vencimento: venc });
    }
    if (b.acao === "atualizar") {
      if (!e.asaasAssinatura) return res.status(200).json({ ok: true, semAssinatura: true, valor });
      await asaas("/subscriptions/" + e.asaasAssinatura, { method: "POST", body: JSON.stringify({ value: valor, updatePendingPayments: true }) });
      await ref.set({ mensalidade: valor, lojasCobradas: lojas, atualizadaEm: Date.now() }, { merge: true });
      return res.status(200).json({ ok: true, valor });
    }
    if (b.acao === "cancelar") {
      if (e.asaasAssinatura) await asaas("/subscriptions/" + e.asaasAssinatura, { method: "DELETE" });
      await ref.set({ asaasAssinatura: "", situacao: "CANCELADA", canceladaEm: Date.now() }, { merge: true });
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ erro: "a\xE7\xE3o desconhecida" });
  } catch (e) {
    console.error(e);
    return res.status(e.status || 500).json({ erro: e.message });
  }
}
var USA_LICENCA = ["ATIVA", "QUITADA", "INSTALANDO", "RETOMADA", "CANCELADA"];
async function saldoLicencas(lojaId) {
  const lr = await db.collection("lojas").doc(lojaId).get();
  if (!lr.exists) throw Object.assign(new Error("Loja n\xE3o encontrada"), { status: 404 });
  const l = lr.data(), cfg = await config();
  const vs = (await db.collection("vendas").where("lojaId", "==", lojaId).get()).docs.map((d) => d.data()).filter((v) => USA_LICENCA.includes(v.status));
  const usadas = vs.reduce((s, v) => s + (Number(v.licencas) || Math.max(1, Math.ceil((Number(v.nParcelas) || 0) / 12))), 0);
  const compradas = Number(l.licencasCompradas) || 0;
  let cortesia = false;
  if (l.empresaId) {
    const e = (await db.collection("empresas").doc(l.empresaId).get()).data();
    cortesia = !!e?.cortesia;
  }
  return { compradas, usadas, saldo: compradas - usadas, valor: Number(cfg.saasLicencaValor) || 54.99, obrigatoria: cfg.licencaObrigatoria === "sim" && !cortesia, cortesia };
}
async function comprarLicencas(lojaId, q, eu) {
  q = Math.floor(Number(q) || 0);
  if (q < 1 || q > 500) throw Object.assign(new Error("Quantidade de licen\xE7as inv\xE1lida (1 a 500)."), { status: 400 });
  if (!await asaasLigadoSrv()) throw Object.assign(new Error("Cobran\xE7a indispon\xEDvel: o Asaas n\xE3o est\xE1 configurado. Fale com a NexumCell."), { status: 400 });
  const l = (await db.collection("lojas").doc(lojaId).get()).data();
  if (!l) throw Object.assign(new Error("Loja n\xE3o encontrada"), { status: 404 });
  if (!l.empresaId) throw Object.assign(new Error("Esta loja n\xE3o tem empresa cadastrada. Fale com a NexumCell."), { status: 400 });
  const eref = db.collection("empresas").doc(l.empresaId), e = (await eref.get()).data();
  if (!e) throw Object.assign(new Error("Empresa n\xE3o encontrada"), { status: 404 });
  const cfg = await config(), unit = Number(cfg.saasLicencaValor) || 54.99, valor = Math.round(unit * q * 100) / 100;
  let cliente = e.asaasCliente;
  if (!cliente) {
    const c = await asaas("/customers", { method: "POST", body: JSON.stringify({ name: e.razao || e.fantasia, cpfCnpj: e.cnpj, email: e.respEmail, mobilePhone: e.respTelefone, externalReference: "saas:" + l.empresaId }) });
    cliente = c.id;
    await eref.set({ asaasCliente: cliente }, { merge: true });
  }
  const ped = db.collection("licencasPedidos").doc(), venc = addDias(hoje(), 3);
  const p = await asaas("/payments", { method: "POST", body: JSON.stringify({ customer: cliente, billingType: "UNDEFINED", value: valor, dueDate: venc, description: `${cfg.empresa || "NexumCell"} \u2014 ${q} licen\xE7a(s) de venda \xB7 ${l.nome || ""}`, externalReference: "lic:" + ped.id }) });
  await ped.set({ lojaId, lojaNome: l.nome || "", empresaId: l.empresaId, q, unit, valor, status: "PENDENTE", pagamento: p.id, link: p.invoiceUrl || "", vencimento: venc, criadoEm: Date.now(), por: eu.nome, porUid: eu.uid });
  await db.collection("logs").add({ em: Date.now(), acao: "Pedido de licen\xE7as", alvo: lojaId, det: `${q} licen\xE7a(s) \xB7 R$ ${valor}`, por: eu.nome });
  return { ok: true, pedido: ped.id, valor, link: p.invoiceUrl || "", vencimento: venc };
}
async function licPagamento(event, payment) {
  if (!["PAYMENT_RECEIVED", "PAYMENT_CONFIRMED"].includes(event)) return;
  const ref = db.collection("licencasPedidos").doc(String(payment.externalReference || "").slice(4)), ped = (await ref.get()).data();
  if (!ped || ped.status === "PAGO") return;
  await ref.set({ status: "PAGO", pagoEm: Date.now() }, { merge: true });
  const lref = db.collection("lojas").doc(ped.lojaId), l = (await lref.get()).data() || {};
  await lref.set({ licencasCompradas: (Number(l.licencasCompradas) || 0) + ped.q, licencasHist: [...l.licencasHist || [], { q: ped.q, valor: ped.valor, em: Date.now(), por: "Asaas (pago)" }] }, { merge: true });
  await db.collection("logs").add({ em: Date.now(), acao: "Licen\xE7as pagas (Asaas)", alvo: ped.lojaId, det: `${ped.q} licen\xE7a(s) \xB7 R$ ${ped.valor}`, por: "Asaas" });
}
async function mudarBloqueio(empresaId, bloquear, motivo) {
  const lojas = (await db.collection("lojas").where("empresaId", "==", empresaId).get()).docs;
  for (const l of lojas) {
    const d = l.data();
    if (bloquear && d.bloqueada) continue;
    if (!bloquear && !d.bloqueioAuto) continue;
    await db.collection("lojas").doc(l.id).set(bloquear ? { bloqueada: true, bloqueioAuto: true, motivoBloqueio: motivo, bloqueadaEm: Date.now(), bloqueadaPor: "Sistema (mensalidade)" } : { bloqueada: false, bloqueioAuto: false, motivoBloqueio: "", desbloqueadaEm: Date.now(), desbloqueadaPor: "Sistema (pagamento)" }, { merge: true });
    const us = (await db.collection("users").where("lojaId", "==", l.id).get()).docs;
    for (const u of us) await db.collection("users").doc(u.id).set(bloquear ? { lojaBloqueada: true, motivoBloqueio: motivo, lojaNome: d.nome || "" } : { lojaBloqueada: false, ...u.data().bloqueadoPeloDono ? {} : { motivoBloqueio: "" } }, { merge: true });
  }
}
async function saasPagamento(event, payment) {
  const empresaId = String(payment.externalReference || "").slice(5), ref = db.collection("empresas").doc(empresaId);
  if (!(await ref.get()).exists) return;
  if (["PAYMENT_RECEIVED", "PAYMENT_CONFIRMED"].includes(event)) {
    await ref.set({ situacao: "EM_DIA", atrasadaDesde: null, ultimoPagamento: { valor: payment.value, em: Date.now(), vencimento: payment.dueDate || "" } }, { merge: true });
    await mudarBloqueio(empresaId, false);
    await db.collection("logs").add({ em: Date.now(), acao: "Mensalidade paga (Asaas)", alvo: empresaId, det: `R$ ${payment.value}`, por: "Asaas" });
  } else if (event === "PAYMENT_OVERDUE") {
    const e = (await ref.get()).data();
    await ref.set({ situacao: "ATRASADA", atrasadaDesde: e.atrasadaDesde || payment.dueDate || hoje(), linkPagamento: payment.invoiceUrl || "" }, { merge: true });
  }
}
async function saasRotina() {
  const cfg = await config(), dias3 = Number(cfg.saasDiasBloqueio ?? 5);
  if (!(dias3 > 0)) return { bloqueadas: 0 };
  const limite = addDias(hoje(), -dias3);
  const atras = (await db.collection("empresas").where("situacao", "==", "ATRASADA").get()).docs.map((d) => ({ id: d.id, ...d.data() })).filter((e) => e.atrasadaDesde && e.atrasadaDesde <= limite && !e.bloqueadaPorAtraso);
  for (const e of atras) {
    await mudarBloqueio(e.id, true, `Mensalidade do sistema em atraso desde ${e.atrasadaDesde.split("-").reverse().join("/")}. Pague pelo link enviado por e-mail para liberar na hora.`);
    await db.collection("empresas").doc(e.id).set({ bloqueadaPorAtraso: true, bloqueadaEm: Date.now() }, { merge: true });
  }
  const pagas = (await db.collection("empresas").where("situacao", "==", "EM_DIA").get()).docs.filter((d) => d.data().bloqueadaPorAtraso);
  for (const d of pagas) await db.collection("empresas").doc(d.id).set({ bloqueadaPorAtraso: false }, { merge: true });
  return { bloqueadas: atras.length };
}

// api/asaas-webhook.js
async function handler5(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  {
    const tk = (await asaasConf()).webhookToken;
    if (!tk || req.headers["asaas-access-token"] !== tk) return res.status(401).json({ erro: "token inv\xE1lido" });
  }
  const { event, payment } = req.body || {};
  try {
    if (String(event || "").startsWith("PIX_AUTOMATIC")) {
      const a = req.body.pixAutomaticAuthorization || req.body.authorization || req.body.pixAutomaticRecurringAuthorization || {};
      const contrato = String(a.contractId || "");
      if (contrato.startsWith("v")) {
        const st = event.includes("ACTIVATED") ? "ATIVO" : event.includes("CANCEL") || event.includes("REFUSED") && event.includes("AUTHORIZATION") ? "CANCELADO" : null;
        const dados = { pixAutomatico: { id: a.id || "", status: st || "EVENTO", ultimoEvento: event, em: Date.now() } };
        await db.collection("vendas").doc(contrato).set(dados, { merge: true });
        const vt = (await db.collection("vendas").doc(contrato).get()).data()?.aparelhoToken;
        if (vt) await db.collection("aparelhos").doc(vt).set({ pixAutomatico: { status: dados.pixAutomatico.status, em: Date.now() } }, { merge: true });
        if (st === "ATIVO") {
          const v = (await db.collection("vendas").doc(contrato).get()).data() || {}, parcelas = [...v.parcelas || []];
          for (const p of parcelas) if (!p.pago && p.asaasId && p.n !== v.pixAutomatico?.parcelaInicial) {
            try {
              await asaas("/payments/" + p.asaasId, { method: "DELETE" });
            } catch (e) {
            }
            delete p.asaasId;
            delete p.asaasLink;
          }
          await db.collection("vendas").doc(contrato).update({ parcelas });
        }
        if (event.includes("INSTRUCTION_REFUSED")) await db.collection("logs").add({ em: Date.now(), acao: "PIX Autom\xE1tico: d\xE9bito recusado", alvo: contrato, det: event, por: "Asaas" });
      }
      return res.status(200).json({ ok: true });
    }
    if (["PAYMENT_RECEIVED", "PAYMENT_CONFIRMED"].includes(event) && String(payment?.externalReference || "").startsWith("cartao:")) {
      const id = payment.externalReference.slice(7);
      await db.collection("linksCartao").doc(id).set({ status: "PAGO", pagoEm: Date.now(), valorLiquido: payment.netValue || null }, { merge: true });
      return res.status(200).json({ ok: true });
    }
    if (String(payment?.externalReference || "").startsWith("lic:")) {
      await licPagamento(event, payment);
      return res.status(200).json({ ok: true });
    }
    if (String(payment?.externalReference || "").startsWith("saas:")) {
      await saasPagamento(event, payment);
      return res.status(200).json({ ok: true });
    }
    if (!["PAYMENT_RECEIVED", "PAYMENT_CONFIRMED"].includes(event) || !payment) return res.status(200).json({ ok: true, ignorado: event });
    const alvo = await parcelaDaCobranca(payment);
    if (!alvo) return res.status(200).json({ ok: true, ignorado: "sem refer\xEAncia NexumCell" });
    const forma = payment.billingType === "PIX" ? payment.pixAutomaticAuthorizationId ? "PIX Autom\xE1tico (Asaas)" : "PIX (Asaas)" : payment.billingType === "BOLETO" ? "Boleto (Asaas)" : payment.billingType === "CREDIT_CARD" ? "Cart\xE3o (Asaas)" : payment.billingType + " (Asaas)";
    await baixarParcela(alvo.vendaId, alvo.n, payment.value, forma, "Cobran\xE7a " + payment.id);
    try {
      const cfg = await config();
      if (brevoLigado() && cfg.brevoRecibo === "sim" && (cfg.brevoCanal || "nenhum") !== "nenhum") {
        const v = (await db.collection("vendas").doc(alvo.vendaId).get()).data() || {}, tel = (v.cliente?.telefones || [])[0];
        const valor = "R$ " + Number(payment.value).toFixed(2).replace(".", ","), nome = String(v.clienteNome || "").split(" ")[0];
        if (tel) await avisarCliente(tel, cfg.brevoCanal, {
          modelo: "recibo",
          params: { NOME: nome, VALOR: valor, PARCELA: `${alvo.n}/${(v.parcelas || []).length}` },
          texto: `${cfg.empresa || "NexumCell"}: ${nome}, recebemos ${valor} da parcela ${alvo.n}/${(v.parcelas || []).length}. Obrigado!`
        });
      }
    } catch (e) {
      console.error("recibo", e.message);
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ erro: e.message });
  }
}

// api/assistente.js
var MODELO = process.env.GROQ_MODELO || "openai/gpt-oss-120b";
async function handler6(req, res) {
  if (cors(req, res)) return;
  if (req.method !== "POST") return res.status(405).end();
  try {
    const { token, pergunta } = req.body || {};
    if (!token || !pergunta || String(pergunta).length > 500) return res.status(400).json({ erro: "pedido inv\xE1lido" });
    const chave = process.env.GROQ_API_KEY || (await config()).iaChave || "";
    if (!chave) return res.status(200).json({ resposta: null });
    const s = await db.collection("aparelhos").doc(String(token)).get();
    if (!s.exists) return res.status(404).json({ erro: "contrato n\xE3o encontrado" });
    const ap = s.data();
    const parcelas = (ap.parcelas || []).map((p) => ({ n: p.n, vencimento: p.venc, valor: p.valor, pago: !!p.pago, valorHoje: p.pago ? 0 : encargos(p, ap) }));
    const contexto = {
      hoje: hoje(),
      loja: ap.lojaNome,
      telefoneLoja: ap.lojaTelefone,
      chavePix: ap.chavePix,
      aparelho: `${ap.marca} ${ap.modelo}`,
      contrato: ap.vendaNumero,
      cliente: ap.clienteNome,
      descontoAntecipadoPct: ap.descontoPct,
      multaPct: ap.multaPct,
      jurosDiaPct: ap.moraDiaPct,
      quitado: !!ap.quitado,
      bloqueioTotalComDiasDeAtraso: ap.etapaTotalDias,
      limitacaoComDiasDeAtraso: ap.etapaParcialDias,
      parcelas
    };
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer " + chave, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODELO,
        temperature: 0.2,
        max_tokens: 400,
        messages: [
          { role: "system", content: "Voc\xEA \xE9 o assistente da loja de celulares parcelados NexumCell no portal do cliente. Responda em portugu\xEAs do Brasil, curto (at\xE9 3 frases), educado e s\xF3 com base nos DADOS DO CONTRATO. Nunca invente valores, datas, promo\xE7\xF5es ou regras. N\xE3o prometa descontos nem libera\xE7\xE3o. Se n\xE3o souber ou for algo que precisa de uma pessoa, oriente a falar com a loja pelo WhatsApp. Bot\xF5es que existem no portal: Pagar (gera PIX), Quitar com PIX, Mudar dia do vencimento, Meu aparelho deu defeito, Roubo/furto/perda, Meus dados (LGPD), Recibo." },
          { role: "system", content: "DADOS DO CONTRATO: " + JSON.stringify(contexto) },
          { role: "user", content: String(pergunta) }
        ]
      })
    });
    const j = await r.json();
    return res.status(200).json({ resposta: j.choices?.[0]?.message?.content?.trim() || null });
  } catch (e) {
    console.error(e);
    return res.status(200).json({ resposta: null });
  }
}

// api/repasse.js
var r22 = (x) => Math.round(x * 100) / 100;
var TIPOS = { CPF: "CPF", CNPJ: "CNPJ", EMAIL: "EMAIL", TELEFONE: "PHONE", ALEATORIA: "EVP" };
var valorRepasse = (v) => r22(Math.max(0, (+v.valor || 0) - (+v.entrada || 0)));
async function repassar(vendaId, por) {
  const ref = db.collection("vendas").doc(vendaId), v = (await ref.get()).data();
  if (!v) throw new Error("venda n\xE3o encontrada");
  if (v.repasse?.status === "PAGO" || v.repasse?.status === "PROCESSANDO") return { ja: true };
  if (!["ATIVA", "QUITADA"].includes(v.status)) throw new Error(`venda n\xBA ${v.numero} n\xE3o est\xE1 ativa`);
  const loja = (await db.collection("lojas").doc(v.lojaId).get()).data() || {};
  if (!loja.pixChave) throw new Error(`a loja ${loja.nome || v.lojaNome} n\xE3o tem chave PIX cadastrada`);
  if (loja.bloqueada || loja.encerrada) throw new Error(`a loja ${loja.nome || v.lojaNome} est\xE1 bloqueada ou inativa: repasse suspenso`);
  if (loja.pixTipo !== "CNPJ") throw new Error(`a chave PIX da loja ${loja.nome || ""} n\xE3o \xE9 CNPJ: o repasse s\xF3 vai para a chave PIX do CNPJ da empresa`);
  {
    const dg = (x) => String(x || "").replace(/\D/g, ""), emp = loja.empresaId ? (await db.collection("empresas").doc(loja.empresaId).get()).data() : null;
    const raizes = [loja.cnpj, emp?.cnpj].map(dg).filter((c) => c.length === 14).map((c) => c.slice(0, 8));
    if (raizes.length && !raizes.includes(dg(loja.pixChave).slice(0, 8))) throw new Error(`a chave PIX da loja ${loja.nome || ""} n\xE3o \xE9 do CNPJ da empresa cadastrada`);
    if (loja.pixValidado !== true) throw new Error(`a titularidade da conta da loja ${loja.nome || ""} ainda n\xE3o foi validada pela NexumCell`);
  }
  const valor = valorRepasse(v);
  if (!(valor > 0)) throw new Error("valor do repasse zerado");
  await ref.set({ repasse: { status: "PROCESSANDO", valor, em: Date.now(), por } }, { merge: true });
  try {
    const t = await asaas("/transfers", { method: "POST", body: JSON.stringify({
      value: valor,
      operationType: "PIX",
      pixAddressKey: loja.pixChave,
      pixAddressKeyType: TIPOS[loja.pixTipo] || "EVP",
      description: `Repasse venda n\xBA ${v.numero} \u2014 ${v.clienteNome || ""}`.slice(0, 120),
      externalReference: "repasse:" + vendaId
    }) });
    await ref.set({ repasse: { status: "PAGO", valor, pagoEm: hoje(), forma: "PIX autom\xE1tico (Asaas)", obs: t.id || "", asaasTransferencia: t.id || "", situacaoAsaas: t.status || "", por, em: Date.now(), automatico: true } }, { merge: true });
    await db.collection("logs").add({ em: Date.now(), acao: "Repasse autom\xE1tico (Asaas)", alvo: vendaId, det: `n\xBA ${v.numero} \xB7 R$ ${valor} \u2192 ${loja.nome}`, por });
    return { ok: true, valor, transferencia: t.id };
  } catch (e) {
    await ref.set({ repasse: { status: "PENDENTE", erroAuto: e.message.slice(0, 200), tentouEm: Date.now() } }, { merge: true });
    throw e;
  }
}
async function repasseRotina(cfg) {
  if (cfg.repasseAuto !== "sim" || !await asaasLigadoSrv().catch(() => false)) return { repassados: 0 };
  const max = Math.min(5, Number(process.env.ROTINA_MAX) || 5);
  const vs = (await db.collection("vendas").where("status", "==", "ATIVA").get()).docs.map((d) => ({ id: d.id, ...d.data() })).filter((v) => !v.repasse || v.repasse.status === "PENDENTE" && !v.repasse.erroAuto).slice(0, max);
  let n = 0;
  for (const v of vs) {
    try {
      await repassar(v.id, "Rotina autom\xE1tica");
      n++;
    } catch (e) {
      console.warn("repasse", v.id, e.message);
    }
  }
  return { repassados: n };
}
async function handler7(req, res) {
  if (cors(req, res)) return;
  if (req.method !== "POST") return res.status(405).end();
  try {
    const q = await exigirEquipe(req, ["DONO", "FINANCEIRO"]);
    if (!await asaasLigadoSrv()) throw Object.assign(new Error("Asaas n\xE3o configurado"), { status: 400 });
    const ids = [...new Set((req.body?.vendaIds || []).map(String))].slice(0, 10), out = [];
    for (const id of ids) {
      try {
        out.push({ id, ...await repassar(id, q.nome || "Dono") });
      } catch (e) {
        out.push({ id, erro: e.message });
      }
    }
    return res.status(200).json({ resultados: out });
  } catch (e) {
    return res.status(e.status || 500).json({ erro: e.message });
  }
}

// api/seguranca.js
var erro = (m, s = 400) => Object.assign(new Error(m), { status: s });
var sha = async (t) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)))].map((b) => b.toString(16).padStart(2, "0")).join("");
async function codigo(req, res) {
  if (cors(req, res)) return;
  try {
    if (req.method !== "POST") throw erro("use POST", 405);
    const idt = String(req.headers.authorization || "").replace("Bearer ", "");
    const u = await auth.verifyIdToken(idt).catch(() => null);
    if (!u) throw erro("entre de novo", 401);
    const email = String(u.email || "").toLowerCase();
    const me = (await db.collection("users").doc(u.uid).get()).data() || {};
    const dono = email && email === String(process.env.DONO_EMAIL || "").toLowerCase();
    if (!dono && !["DONO", "FINANCEIRO"].includes(me.role)) throw erro("sem permiss\xE3o", 403);
    const ref = db.collection("segredos").doc("codigo_" + u.uid);
    const b = req.body || {};
    if (b.acao === "enviar") {
      if (!brevoLigado()) throw erro("O envio de e-mail (Brevo) n\xE3o est\xE1 configurado no servidor.", 503);
      const ant = (await ref.get()).data() || {};
      if (ant.enviadoEm && Date.now() - ant.enviadoEm < 45e3) throw erro("Aguarde 1 minuto para pedir outro c\xF3digo.", 429);
      const c = String(1e5 + crypto.getRandomValues(new Uint32Array(1))[0] % 9e5);
      await ref.set({ hash: await sha(u.uid + ":" + c), exp: Date.now() + 10 * 6e4, tentativas: 0, enviadoEm: Date.now() });
      await enviarEmail({
        para: email,
        assunto: `Seu c\xF3digo de acesso: ${c}`,
        titulo: "C\xF3digo de acesso",
        html: moldura("C\xF3digo de acesso", `Use este c\xF3digo para entrar no NexumCell:

${c}

Ele vale por 10 minutos.

Se n\xE3o foi voc\xEA, troque a sua senha agora.`).replace(`>${c}</p>`, `><b style="font-size:26px;letter-spacing:4px">${c}</b></p>`),
        texto: `Seu c\xF3digo de acesso NexumCell: ${c} (vale por 10 minutos).`
      });
      return res.json({ ok: true, email: email.replace(/^(.{2}).*(@.*)$/, "$1***$2") });
    }
    if (b.acao === "verificar") {
      const s = (await ref.get()).data();
      if (!s || s.exp < Date.now()) throw erro("C\xF3digo vencido. Pe\xE7a outro.", 410);
      if ((s.tentativas || 0) >= 5) throw erro("Muitas tentativas. Pe\xE7a outro c\xF3digo.", 429);
      if (s.hash !== await sha(u.uid + ":" + String(b.codigo || "").trim())) {
        await ref.set({ tentativas: (s.tentativas || 0) + 1 }, { merge: true });
        throw erro("C\xF3digo errado.", 403);
      }
      const ate = Date.now() + 12 * 36e5;
      await ref.set({ hash: "", exp: 0, usadoEm: Date.now() }, { merge: true });
      await db.collection("users").doc(u.uid).set({ verificadoAte: ate, verificadoEm: Date.now() }, { merge: true });
      await db.collection("logs").add({ acao: "Entrada confirmada com c\xF3digo por e-mail", alvo: u.uid, detalhe: email, por: me.nome || email, em: Date.now() });
      return res.json({ ok: true, ate });
    }
    throw erro("a\xE7\xE3o inv\xE1lida");
  } catch (e) {
    res.status(e.status || 500).json({ erro: e.message });
  }
}
async function acordo(req, res) {
  if (cors(req, res)) return;
  try {
    if (req.method !== "POST") throw erro("use POST", 405);
    const b = req.body || {}, tk = String(b.token || "");
    if (!/^[A-Za-z0-9_-]{10,60}$/.test(tk)) throw erro("contrato inv\xE1lido");
    const cfg = await config();
    if (cfg.acordoCliente === "nao") throw erro("Acordo pelo portal desligado. Fale com a loja.", 403);
    const ref = db.collection("aparelhos").doc(tk), snap2 = await ref.get();
    if (!snap2.exists) throw erro("contrato n\xE3o encontrado", 404);
    const ap = snap2.data();
    if (ap.quitado || ["QUITADO", "CANCELADO"].includes(ap.status)) throw erro("Contrato encerrado.");
    const h = hoje(), atraso = (ap.parcelas || []).filter((p) => !p.pago && p.venc < h);
    if (!atraso.length) throw erro("N\xE3o h\xE1 parcelas em atraso.");
    if (ap.acordoPedidoEm && Date.now() - ap.acordoPedidoEm < 30 * 864e5) throw erro("Voc\xEA j\xE1 pediu um acordo este m\xEAs. A loja vai entrar em contato.", 409);
    const max = Math.min(12, Math.max(2, +cfg.acordoMaxParcelas || 4)), n = Math.round(+b.parcelas || 0);
    if (n < 1 || n > max) throw erro(`Escolha de 1 a ${max} parcelas.`);
    const valor = r2(atraso.reduce((s, p) => s + (+p.valor || 0), 0));
    const horas = Math.min(120, Math.max(0, +cfg.acordoLiberarHoras || 48)), agora = Date.now();
    const libera = cfg.acordoLiberar !== "nao" && horas > 0 && !ap.roubo;
    await db.collection("pedidos").add({
      tipo: "ACORDO",
      token: tk,
      vendaId: ap.vendaId || "",
      vendaNumero: ap.vendaNumero || 0,
      lojaId: ap.lojaId || "",
      lojaNome: ap.lojaNome || "",
      clienteNome: ap.clienteNome || "",
      marca: ap.marca || "",
      modelo: ap.modelo || "",
      imei: ap.imei || "",
      status: "ABERTO",
      criadoEm: agora,
      descricao: `Quer acertar ${atraso.length} parcela(s) em atraso (R$ ${valor.toFixed(2).replace(".", ",")}) em ${n}x.${b.obs ? " Obs.: " + String(b.obs).slice(0, 300) : ""}`,
      acordo: { parcelas: n, valorAtraso: valor, qtdAtraso: atraso.length, liberadoAte: libera ? agora + horas * 36e5 : 0 }
    });
    await ref.set({ acordoPedidoEm: agora, ...libera ? { liberadoAte: agora + horas * 36e5, modoPor: "Pedido de acordo pelo portal", modoMotivo: `Liberado ${horas} h enquanto a loja formaliza o acordo` } : {} }, { merge: true });
    if (libera) await pushAparelho(tk).catch(() => {
    });
    res.json({ ok: true, liberadoAte: libera ? agora + horas * 36e5 : 0, horas: libera ? horas : 0 });
  } catch (e) {
    res.status(e.status || 500).json({ erro: e.message });
  }
}
var COLECOES = ["config", "users", "lojas", "empresas", "clientes", "vendas", "aparelhos", "catalogo", "estoque", "listanegra", "metas", "cobrancas", "caixas", "pedidos", "seminovos", "chamados", "despesas", "comissoesPagas", "retornos", "atendimentos", "ajuda"];
var semFotos = (o) => JSON.parse(JSON.stringify(o, (k, v) => typeof v === "string" && v.startsWith("data:") && v.length > 2e3 ? "[foto]" : v));
async function backupRotina(cfg) {
  if (cfg.backupAuto === "nao" || !brevoLigado()) return { backup: "desligado" };
  const dados = { geradoEm: (/* @__PURE__ */ new Date()).toISOString(), colecoes: {} };
  for (const c of COLECOES) {
    try {
      dados.colecoes[c] = (await db.collection(c).get()).docs.map((d) => semFotos({ id: d.id, ...d.data() }));
    } catch (e) {
      dados.colecoes[c] = { erro: e.message };
    }
  }
  const bruto = new TextEncoder().encode(JSON.stringify(dados));
  const gz = new Uint8Array(await new Response(new Blob([bruto]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer());
  if (gz.length > 7 * 1024 * 1024) return { backup: "grande demais para e-mail (" + Math.round(gz.length / 1048576) + " MB): use Configura\xE7\xF5es \u2192 Baixar c\xF3pia" };
  let bin = "";
  for (let i = 0; i < gz.length; i += 32768) bin += String.fromCharCode(...gz.subarray(i, i + 32768));
  const para = [process.env.DONO_EMAIL, ...String(cfg.backupEmail || "").split(/[,; ]+/)].map((x) => String(x || "").trim()).filter((x) => /@/.test(x));
  const total = Object.values(dados.colecoes).reduce((s, l) => s + (Array.isArray(l) ? l.length : 0), 0);
  await enviarEmail({
    para: [...new Set(para)],
    assunto: `C\xF3pia de seguran\xE7a NexumCell ${hoje()}`,
    titulo: "C\xF3pia de seguran\xE7a di\xE1ria",
    texto: `Segue em anexo a c\xF3pia dos dados do sistema (${total} registros, sem as fotos).

Guarde este e-mail. Para restaurar, fale com o suporte do sistema.`,
    anexos: [{ name: `nexumcell-backup-${hoje()}.json.gz`, content: btoa(bin) }]
  });
  return { backup: total + " registros" };
}

// api/instalacao.js
var erro2 = (m, s = 400) => Object.assign(new Error(m), { status: s });
function travaConfirmada(ck, cfg) {
  if (!ck || !ck.em) return false;
  if (ck.imeiConfere === false) return false;
  if (ck.deviceOwner === true) return true;
  return ck.modo === "link" && ck.adminAtivo === true && cfg.instalacaoLink !== "nao";
}
async function concluirVenda(vendaId, por) {
  const ref = db.collection("vendas").doc(vendaId), snap2 = await ref.get();
  if (!snap2.exists) throw erro2("venda n\xE3o encontrada", 404);
  const v = snap2.data();
  if (v.status === "ATIVA") return { ja: true };
  if (v.status !== "INSTALANDO") throw erro2("a venda n\xE3o est\xE1 aguardando a trava");
  if (!v.aparelhoToken) throw erro2("venda sem trava gerada");
  const ap = (await db.collection("aparelhos").doc(v.aparelhoToken).get()).data() || {};
  const cfg = await config();
  if (!travaConfirmada(ap.checkin, cfg)) throw erro2("o aparelho ainda n\xE3o confirmou a trava", 409);
  const agora = Date.now();
  await ref.set({ status: "ATIVA", instaladoEm: agora, instalacao: { ...v.instalacao || {}, falha: null, concluidaEm: agora, concluidaPor: por } }, { merge: true });
  if (v.aparelho?.estoqueId) await db.collection("estoque").doc(v.aparelho.estoqueId).set({ status: "VENDIDO", vendaId, vendidoEm: agora }, { merge: true }).catch(() => {
  });
  await db.collection("logs").add({ em: agora, acao: "Trava instalada \u2014 venda conclu\xEDda", alvo: vendaId, detalhe: `IMEI ${ap.checkin?.imei || ""} \xB7 ${por}`, nome: por });
  return { ok: true };
}
async function instalacoesRotina() {
  const vs = (await db.collection("vendas").where("status", "==", "INSTALANDO").get()).docs;
  let n = 0;
  for (const d of vs) {
    try {
      const r = await concluirVenda(d.id, "rotina autom\xE1tica");
      if (r.ok) n++;
    } catch (e) {
    }
  }
  return n;
}
async function handler8(req, res) {
  if (cors(req, res)) return;
  try {
    if (req.method !== "POST") throw erro2("use POST", 405);
    const eu = await exigirEquipe(req);
    const id = String(req.body?.vendaId || "");
    const v = (await db.collection("vendas").doc(id).get()).data();
    if (!v) throw erro2("venda n\xE3o encontrada", 404);
    if (eu.role === "VENDEDOR" && v.vendedorUid !== eu.uid) throw erro2("sem permiss\xE3o", 403);
    if (eu.role === "GERENTE" && v.lojaId !== eu.lojaId) throw erro2("sem permiss\xE3o", 403);
    res.json(await concluirVenda(id, eu.nome || eu.role));
  } catch (e) {
    res.status(e.status || 500).json({ erro: e.message });
  }
}

// api/negativacao.js
var diasEntre = (a, b) => Math.round((/* @__PURE__ */ new Date(b + "T12:00:00Z") - /* @__PURE__ */ new Date(a + "T12:00:00Z")) / 864e5);
var ATIVAS = ["PENDING", "AWAITING_APPROVAL", "AWAITING_CANCELLATION", "PROCESSED", "PAID", "PARTIALLY_PAID"];
async function negativacaoRotina(cfg) {
  if (!await asaasLigadoSrv().catch(() => false)) return { negativacao: "Asaas desligado" };
  const r = { pedidas: 0, canceladas: 0, erros: [] }, h = hoje();
  const negs = (await db.collection("vendas").where("negativacao.status", "in", ["PENDING", "AWAITING_APPROVAL", "PROCESSED", "PAID", "PARTIALLY_PAID"]).get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  for (const v of negs) {
    const n = v.negativacao, p = (v.parcelas || []).find((x) => x.n === n.parcela);
    const pagou = v.status === "QUITADA" || p && p.pago || v.status === "CANCELADA";
    if (!pagou) continue;
    try {
      if (p && p.pago && p.forma && !/asaas/i.test(String(p.por || "")) && p.asaasId) {
        try {
          await asaas(`/payments/${p.asaasId}/receiveInCash`, { method: "POST", body: JSON.stringify({ paymentDate: p.pagoEm || h, value: p.valorPago || p.valor, notifyCustomer: false }) });
        } catch (e) {
        }
      }
      try {
        await asaas(`/paymentDunnings/${n.id}/cancel`, { method: "POST" });
      } catch (e) {
        if (!/already|cancel|not.?found|404/i.test(e.message)) throw e;
      }
      await db.collection("vendas").doc(v.id).set({ negativacao: { ...n, status: "CANCELADA", canceladaEm: Date.now(), motivo: "pagamento recebido" } }, { merge: true });
      await db.collection("logs").add({ em: Date.now(), acao: "Negativa\xE7\xE3o retirada (pagou)", alvo: v.id, det: `parcela ${n.parcela}`, por: "Rotina autom\xE1tica" });
      r.canceladas++;
    } catch (e) {
      r.erros.push(`${v.numero}: ${e.message}`);
    }
  }
  if (cfg.negativarAuto !== "sim") return r;
  const dias3 = Math.max(30, Number(cfg.negativarDias) || 60), max = Math.max(1, Number(cfg.negativarMax) || 10);
  const ativas = (await db.collection("vendas").where("status", "==", "ATIVA").get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  const alvo = ativas.map((v) => ({ v, p: (v.parcelas || []).filter((x) => !x.pago && x.venc < h).sort((a, b) => a.venc < b.venc ? -1 : 1)[0] })).filter(({ v, p }) => p && diasEntre(p.venc, h) >= dias3 && !(v.negativacao && ATIVAS.includes(v.negativacao.status)) && !v.naoNegativar && !(v.acordo && v.acordo.status !== "QUEBRADO") && !(v.liberadoAte && v.liberadoAte > Date.now())).sort((a, b) => a.p.venc < b.p.venc ? -1 : 1).slice(0, max);
  for (const { v, p } of alvo) {
    try {
      let parc = p;
      if (!parc.asaasId) {
        await gerarCobrancas(v.id);
        const v2 = (await db.collection("vendas").doc(v.id).get()).data();
        parc = (v2.parcelas || []).find((x) => x.n === p.n) || p;
      }
      if (!parc.asaasId) throw new Error("parcela sem cobran\xE7a no Asaas");
      await pedirNegativacao(v, parc, "Rotina autom\xE1tica");
      await db.collection("logs").add({ em: Date.now(), acao: "Negativa\xE7\xE3o pedida (autom\xE1tica)", alvo: v.id, det: `parcela ${p.n} \xB7 ${diasEntre(p.venc, h)} dias de atraso`, por: "Rotina autom\xE1tica" });
      r.pedidas++;
    } catch (e) {
      r.erros.push(`${v.numero}: ${e.message}`);
    }
  }
  return r;
}

// api/fidelidade.js
var ENCERRADAS = ["CANCELADA", "REPROVADA", "RASCUNHO"];
async function cashbackRotina(cfg) {
  if (cfg.cashbackAtivo !== "sim") return { cashback: "desligado" };
  let desde = cfg.cashbackDesde;
  if (!desde) {
    desde = hoje();
    await db.collection("config").doc("sistema").set({ cashbackDesde: desde }, { merge: true });
  }
  const pct = Math.min(10, Math.max(0, Number(cfg.cashbackPct) || 0));
  const vendas = (await db.collection("vendas").where("status", "in", ["ATIVA", "QUITADA", "INSTALANDO", "APROVADA", "AGUARDANDO_ENTRADA", "RETOMADA"]).get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  const por = {};
  for (const v of vendas) {
    const cpf = String(v.clienteCpf || "").replace(/\D/g, "");
    if (cpf.length !== 11) continue;
    const o = por[cpf] ||= { ganho: 0, usado: 0, tokens: [] };
    if (!ENCERRADAS.includes(v.status)) o.usado += Number(v.cashbackUsado) || 0;
    if (v.status === "RETOMADA") continue;
    for (const p of v.parcelas || []) {
      if (p.pago && p.pagoEm && p.pagoEm <= p.venc && p.pagoEm >= desde && !p.acordo && p.forma !== "Entrada do acordo") o.ganho += Math.min(+(p.valorPago ?? p.valor) || 0, +p.valor || 0) * pct / 100;
    }
    if (v.aparelhoToken && ["ATIVA", "QUITADA"].includes(v.status)) o.tokens.push(v.aparelhoToken);
  }
  let n = 0;
  for (const [cpf, o] of Object.entries(por)) {
    if (!o.ganho && !o.usado) continue;
    const c = { saldo: r2(Math.max(0, o.ganho - o.usado)), ganho: r2(o.ganho), usado: r2(o.usado), pct, em: Date.now() };
    await db.collection("clientes").doc(cpf).set({ cashback: c }, { merge: true });
    for (const tk of o.tokens) await db.collection("aparelhos").doc(tk).set({ cashback: { saldo: c.saldo, pct } }, { merge: true }).catch(() => {
    });
    n++;
  }
  return { clientes: n };
}
async function aniversarioRotina(cfg) {
  if (cfg.aniversarioAtivo === "nao") return { aniversario: "desligado" };
  const h = hoje(), ano = +h.slice(0, 4), md = h.slice(5);
  const bissexto = ano % 4 === 0 && ano % 100 !== 0 || ano % 400 === 0;
  const fazHoje = (nasc) => {
    const m = String(nasc || "").slice(5, 10);
    return m === md || !bissexto && m === "02-29" && md === "02-28";
  };
  const desc = Math.max(0, Number(cfg.aniversarioDesconto) || 0);
  const vendas = (await db.collection("vendas").where("status", "==", "ATIVA").get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  const feitos = /* @__PURE__ */ new Set();
  let n = 0;
  for (const v of vendas) {
    const cpf = String(v.clienteCpf || "");
    if (!fazHoje(v.cliente?.nasc) || v.aniversarioAno === ano || feitos.has(cpf)) continue;
    feitos.add(cpf);
    const nome = String(v.clienteNome || "").split(" ")[0];
    let descontoAplicado = 0;
    try {
      if (desc > 0) {
        const parcelas = [...v.parcelas || []], i = parcelas.findIndex((p) => !p.pago && p.venc >= h);
        if (i >= 0) {
          const p = parcelas[i], novo = r2(Math.max(0, p.valor - desc));
          if (p.asaasId) await asaas("/payments/" + p.asaasId, { method: "PUT", body: JSON.stringify({ value: novo, dueDate: p.venc }) });
          parcelas[i] = { ...p, valor: novo, descontoAniversario: r2(p.valor - novo), ...p.asaasId ? { asaasValor: novo } : {} };
          await db.collection("vendas").doc(v.id).update({ parcelas });
          if (v.aparelhoToken) await db.collection("aparelhos").doc(v.aparelhoToken).set({ parcelas: parcelas.map(paraAparelho) }, { merge: true });
          descontoAplicado = r2(p.valor - novo);
        }
      }
      const msg = `Feliz anivers\xE1rio, ${nome}! A ${cfg.empresa || "NexumCell"} deseja um ano incr\xEDvel para voc\xEA.` + (descontoAplicado ? ` De presente, sua pr\xF3xima parcela ficou R$ ${descontoAplicado.toFixed(2).replace(".", ",")} mais barata.` : "");
      if (v.aparelhoToken) {
        await db.collection("aparelhos").doc(v.aparelhoToken).set({ aniversario: { ano, dia: h, msg, desconto: descontoAplicado } }, { merge: true });
        await pushNotificacao(v.aparelhoToken, `Feliz anivers\xE1rio, ${nome}!`, msg).catch(() => {
        });
      }
      await db.collection("vendas").doc(v.id).set({ aniversarioAno: ano }, { merge: true });
      await db.collection("logs").add({ em: Date.now(), acao: "Anivers\xE1rio do cliente", alvo: v.id, det: descontoAplicado ? `desconto de R$ ${descontoAplicado} na parcela` : "mensagem enviada", por: "Rotina autom\xE1tica" });
      n++;
    } catch (e) {
      console.error("aniversario", v.id, e.message);
    }
  }
  return { aniversarios: n };
}
async function posVendaRotina(cfg) {
  if (cfg.posVenda === "nao") return { posVenda: "desligado" };
  const agora = Date.now(), vendas = (await db.collection("vendas").where("status", "==", "ATIVA").get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  let n = 0;
  for (const v of vendas) {
    const ini = v.ativadaEm || v.entradaPaga?.em || v.assinadoEm || 0, d = (agora - ini) / 864e5;
    if (!ini || v.posVendaEm || d < 3 || d > 10 || !v.aparelhoToken) continue;
    try {
      const nome = String(v.clienteNome || "").split(" ")[0], loja = v.lojaNome || cfg.empresa || "NexumCell";
      const msg = `${nome}, tudo certo com o seu aparelho novo? Qualquer d\xFAvida ou defeito, fale com a ${loja} pelo portal. Pagando em dia voc\xEA ganha limite para a pr\xF3xima compra.`;
      await pushNotificacao(v.aparelhoToken, "Como est\xE1 o seu aparelho?", msg).catch(() => {
      });
      await db.collection("vendas").doc(v.id).set({ posVendaEm: agora }, { merge: true });
      n++;
    } catch (e) {
      console.error("posvenda", v.id, e.message);
    }
  }
  return { posVenda: n };
}

// api/relatorio-semanal.js
var diasEntre2 = (a, b) => Math.round((/* @__PURE__ */ new Date(b + "T12:00:00Z") - /* @__PURE__ */ new Date(a + "T12:00:00Z")) / 864e5);
var brl = (n) => "R$ " + (Number(n) || 0).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
async function relatorioSemanal(cfg, forcar = false) {
  if (cfg.relSemanal === "nao") return { relatorioSemanal: "desligado" };
  const h = hoje();
  if (!forcar && (/* @__PURE__ */ new Date(h + "T12:00:00Z")).getUTCDay() !== 1) return { relatorioSemanal: "n\xE3o \xE9 segunda" };
  if (!brevoLigado()) return { relatorioSemanal: "sem e-mail configurado" };
  const marca = await db.collection("notificacoes").doc("relsemanal-" + h).get();
  if (marca.exists && !forcar) return { relatorioSemanal: "j\xE1 enviado hoje" };
  const vendas = (await db.collection("vendas").where("status", "==", "ATIVA").get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  const lojas = {};
  for (const v of vendas) {
    const atr = (v.parcelas || []).filter((p) => !p.pago && p.venc < h);
    if (!atr.length) continue;
    const dias3 = Math.max(...atr.map((p) => diasEntre2(p.venc, h))), devido = r2(atr.reduce((s, p) => s + encargos(p, cfg), 0));
    (lojas[v.lojaId] ||= []).push({ v, dias: dias3, devido, n: atr.length });
  }
  const gerentes = (await db.collection("users").where("role", "==", "GERENTE").get()).docs.map((d) => d.data()).filter((u) => u.ativo !== false && u.email);
  const q = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;
  let enviados = 0;
  for (const [lojaId, l] of Object.entries(lojas)) {
    const para = gerentes.filter((u) => u.lojaId === lojaId);
    if (!para.length) continue;
    l.sort((a, b) => b.dias - a.dias);
    const nome = l[0].v.lojaNome || "loja", total = r2(l.reduce((s, x) => s + x.devido, 0));
    const csv = "\uFEFF" + [
      ["Contrato", "Cliente", "Telefone", "Aparelho", "IMEI", "Parcelas em atraso", "Dias de atraso", "Valor devido"].map(q).join(";"),
      ...l.map((x) => [x.v.numero, q(x.v.clienteNome), q((x.v.cliente?.telefones || []).join(" / ")), q(`${x.v.aparelho?.marca || ""} ${x.v.aparelho?.modelo || ""}`), q(x.v.aparelho?.imei || ""), x.n, x.dias, String(x.devido).replace(".", ",")].join(";"))
    ].join("\r\n");
    const texto = `Bom dia! Esta \xE9 a lista da semana dos clientes da ${nome} com parcelas em atraso: ${l.length} contrato(s), ${brl(total)} no total.

` + l.slice(0, 60).map((x) => `\u2022 N\xBA ${x.v.numero} \xB7 ${x.v.clienteNome} \xB7 ${(x.v.cliente?.telefones || [])[0] || ""} \xB7 ${x.dias} dia(s) \xB7 ${brl(x.devido)}`).join("\n") + (l.length > 60 ? `
\u2026 e mais ${l.length - 60} na planilha anexada.` : "") + `

Cobre cada cliente e registre o contato na Fila de cobran\xE7a do portal. A planilha completa est\xE1 anexada.

${cfg.empresa || "NexumCell"}`;
    for (const u of para) {
      try {
        await enviarEmail({ para: u.email, assunto: `Clientes para cobrar esta semana \u2014 ${nome}`, titulo: `Clientes para cobrar \u2014 ${nome}`, texto, anexos: [{ name: `cobrar-${h}.csv`, content: Buffer.from(csv, "utf8").toString("base64") }] });
        enviados++;
      } catch (e) {
        console.error("relsemanal", u.email, e.message);
      }
    }
  }
  await db.collection("notificacoes").doc("relsemanal-" + h).set({ tipo: "REL_SEMANAL", para: "DONO", em: Date.now(), enviados, lojas: Object.keys(lojas).length, lida: true });
  return { relatorioSemanal: enviados };
}

// api/motor.js
var MOTOR_PADRAO = {
  modo: "sugerir",
  // desligado | sugerir | automatico
  idadeMin: 18,
  idadeMax: 75,
  rendaMin: 1e3,
  fatorRendaNovo: 1,
  // limite do cliente novo = renda × fator
  limiteMaxNovo: 2500,
  // teto do valor financiado para cliente novo
  scoreAprovar: 600,
  // nota interna mínima para aprovar sozinho
  scoreReprovar: 300,
  // nota interna abaixo disso reprova sozinho
  exigirDocOriginal: true,
  exigirRosto: true,
  aceitarEditados: false,
  maxContratosAtivos: 2,
  cidades: "",
  // lista separada por vírgula; vazio = qualquer cidade
  fraudeDias: 7,
  // procura o mesmo CPF/telefone/e-mail em outra loja nesse período
  fraudeReprova: false,
  // true = reprova; false = manda para análise manual
  serasaAuto: false
  // consulta Serasa (Asaas, paga) para cliente novo antes de aprovar
};
var dias = (a, b) => Math.round((/* @__PURE__ */ new Date(b + "T12:00:00") - /* @__PURE__ */ new Date(a + "T12:00:00")) / 864e5);
var sem = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
function nota(hist, renda) {
  let s = 500;
  let atrasoAberto = 0, emDia = 0, atrasadas = 0, quitados = 0;
  const motivos = [];
  const h = hoje();
  for (const v of hist) {
    if (v.status === "QUITADA") {
      s += 80;
      quitados++;
    }
    if (v.status === "RETOMADA") {
      s -= 250;
      motivos.push("aparelho j\xE1 retomado");
    }
    if (v.reprovadoPorImei) {
      s -= 300;
      motivos.push("tentativa com IMEI irregular");
    }
    for (const p of v.parcelas || []) {
      if (p.pago) {
        const d = p.pagoEm ? dias(p.venc, String(p.pagoEm).slice(0, 10)) : 0;
        if (d <= 0) {
          s += 25;
          emDia++;
        } else {
          s -= Math.min(60, 5 + 2 * d);
          atrasadas++;
        }
      } else if (["ATIVA", "INSTALANDO"].includes(v.status) && p.venc < h) {
        s -= 120;
        atrasoAberto++;
      }
    }
  }
  s = Math.max(0, Math.min(1e3, Math.round(s)));
  if (!hist.length) motivos.push("cliente novo");
  if (emDia) motivos.push(`${emDia} parcela(s) em dia`);
  if (atrasadas) motivos.push(`${atrasadas} paga(s) com atraso`);
  if (quitados) motivos.push(`${quitados} contrato(s) quitado(s)`);
  if (atrasoAberto) motivos.push(`${atrasoAberto} parcela(s) em atraso agora`);
  const faixa = atrasoAberto ? "Risco" : s >= 750 ? "Ouro" : s >= 600 ? "Prata" : s >= 450 ? "Bronze" : "Risco";
  const mult = { Ouro: 2.5, Prata: 1.8, Bronze: 1.2, Risco: 0.5 }[faixa] * (hist.length ? 1 : 0.9);
  return { score: s, faixa, limite: atrasoAberto ? 0 : Math.round((renda || 0) * mult / 50) * 50, motivos, atrasoAberto, quitados };
}
async function avaliarVenda(vendaId) {
  const cfg = (await db.collection("config").doc("sistema").get()).data() || {};
  const R = { ...MOTOR_PADRAO, ...cfg.motor || {} };
  const ref = db.collection("vendas").doc(vendaId);
  const v = (await ref.get()).data();
  if (!v) throw Object.assign(new Error("venda n\xE3o encontrada"), { status: 404 });
  if (v.status !== "ANALISE") return { resultado: "IGNORADO", motivo: "venda n\xE3o est\xE1 em an\xE1lise" };
  const c = v.cliente || {}, vf = v.verificacao || {};
  const reprova = [], manual = [], ok = [], alertas = [];
  const hist = (await db.collection("vendas").where("clienteCpf", "==", v.clienteCpf).get()).docs.map((d) => ({ id: d.id, ...d.data() })).filter((x) => x.id !== vendaId);
  const N = nota(hist, c.renda);
  const lnIds = ["cpf_" + v.clienteCpf, ...(c.telefones || []).map((t) => "tel_" + String(t).replace(/\D/g, ""))];
  const ln = (await Promise.all(lnIds.map((i) => db.collection("listanegra").doc(i).get()))).filter((d) => d.exists && d.data().ativo !== false).length;
  if (ln) reprova.push("cliente ou telefone na lista negra");
  const idade = c.nasc ? Math.floor((Date.now() - /* @__PURE__ */ new Date(c.nasc + "T12:00:00")) / 315576e5) : null;
  if (idade == null) manual.push("sem data de nascimento");
  else if (idade < R.idadeMin) reprova.push(`idade ${idade} abaixo de ${R.idadeMin}`);
  else if (idade > R.idadeMax) reprova.push(`idade ${idade} acima de ${R.idadeMax}`);
  if (!(c.renda >= R.rendaMin)) reprova.push(`renda abaixo do m\xEDnimo (R$ ${R.rendaMin})`);
  if (R.cidades) {
    const lista = R.cidades.split(",").map(sem).filter(Boolean);
    if (lista.length && !lista.includes(sem(c.cidade))) manual.push(`cidade fora da \xE1rea (${c.cidade || "\u2014"})`);
  }
  if (R.exigirDocOriginal && vf.documentoOriginal === false) manual.push("documento parece c\xF3pia ou foto de tela");
  if (R.exigirRosto && vf.face?.mesma_pessoa && vf.face.mesma_pessoa !== "sim") manual.push(`rosto x documento: ${vf.face.mesma_pessoa}`);
  if (!R.aceitarEditados && (vf.editados || []).length) manual.push("dados do documento editados \xE0 m\xE3o: " + vf.editados.join(", "));
  if ((c.docDuvidas || []).length) manual.push("campos do documento lidos com d\xFAvida: " + c.docDuvidas.join(", "));
  if (c.docValidade && c.docValidade < hoje()) manual.push("documento vencido");
  if (N.atrasoAberto) reprova.push("tem parcela em atraso em outro contrato");
  const ativos = hist.filter((x) => ["ATIVA", "INSTALANDO", "APROVADA", "AGUARDANDO_ENTRADA"].includes(x.status)).length;
  if (ativos >= R.maxContratosAtivos) manual.push(`j\xE1 tem ${ativos} contrato(s) em andamento`);
  const pre = (await db.collection("clientes").doc(v.clienteCpf).get()).data()?.preAprovado;
  const preOk = pre && pre.ate >= hoje() && pre.valor > 0;
  if (preOk) ok.push(`cliente pr\xE9-aprovado at\xE9 R$ ${pre.valor}`);
  if (preOk && !N.atrasoAberto) {
  } else if (N.score < R.scoreReprovar) reprova.push(`nota interna ${N.score} abaixo de ${R.scoreReprovar}`);
  else if (N.score < R.scoreAprovar) manual.push(`nota interna ${N.score} abaixo de ${R.scoreAprovar}`);
  else ok.push(`nota interna ${N.score} (${N.faixa})`);
  const desde = Date.now() - (Number(R.fraudeDias) || 7) * 864e5;
  const recentes = (await db.collection("vendas").where("criadoEm", ">=", desde).get()).docs.map((d) => ({ id: d.id, ...d.data() })).filter((x) => x.id !== vendaId && x.lojaId !== v.lojaId);
  const tels = new Set(c.telefones || []), email = sem(c.email);
  for (const x of recentes) {
    const xc = x.cliente || {}, mot = [];
    if (x.clienteCpf === v.clienteCpf) mot.push("mesmo CPF");
    if ((xc.telefones || []).some((t) => tels.has(t))) mot.push("mesmo telefone" + (x.clienteCpf !== v.clienteCpf ? " com outro CPF" : ""));
    if (email && sem(xc.email) === email && x.clienteCpf !== v.clienteCpf) mot.push("mesmo e-mail com outro CPF");
    if (mot.length) alertas.push({ vendaId: x.id, numero: x.numero, loja: x.lojaNome || "", status: x.status, quando: x.criadoEm, motivo: mot.join(", ") });
  }
  if (alertas.length) (R.fraudeReprova ? reprova : manual).push(`fraude entre lojas: ${alertas.map((a) => `n\xBA ${a.numero} em ${a.loja} (${a.motivo})`).join("; ")}`);
  let serasa = v.serasa || null;
  if (R.serasaAuto && !hist.length && !serasa && !reprova.length && await asaasLigadoSrv().catch(() => false)) {
    try {
      const r = await asaas("/creditBureauReport", { method: "POST", body: JSON.stringify({ cpfCnpj: v.clienteCpf, state: c.uf || "PR" }) });
      serasa = { em: Date.now(), por: "Motor de cr\xE9dito", link: r.downloadUrl || r.reportFile || "", id: r.id || "" };
      manual.push("Serasa consultado: confira o relat\xF3rio antes de aprovar");
    } catch (e) {
      manual.push("n\xE3o consegui consultar o Serasa: " + e.message);
    }
  }
  try {
    const loja = (await db.collection("lojas").doc(v.lojaId).get()).data() || {}, teto = Number(loja.limiteCarteira) || 0, tetoInad = Number(loja.limiteInad) || 0;
    if (teto > 0 || tetoInad > 0) {
      const h = hoje();
      let aberto = 0, vencido = 0, vencAberto = 0;
      (await db.collection("vendas").where("lojaId", "==", v.lojaId).get()).docs.map((d) => d.data()).filter((x) => ["ATIVA", "INSTALANDO", "QUITADA", "RETOMADA"].includes(x.status)).forEach((x) => (x.parcelas || []).forEach((p) => {
        const val = Number(p.valor) || 0;
        if (!p.pago && ["ATIVA", "INSTALANDO"].includes(x.status)) aberto += val;
        if (p.venc < h) {
          vencido += val;
          if (!p.pago) vencAberto += val;
        }
      }));
      const pct = vencido ? vencAberto / vencido * 100 : 0;
      if (teto > 0 && aberto >= teto) manual.push(`loja acima do limite de carteira (R$ ${Math.round(aberto)} em aberto, teto R$ ${teto})`);
      if (tetoInad > 0 && pct > tetoInad) manual.push(`loja com inadimpl\xEAncia de ${pct.toFixed(1)}%, acima do teto de ${tetoInad}%`);
    }
  } catch (e) {
    console.warn("limite da loja", e.message);
  }
  const limite = preOk ? Math.max(pre.valor, N.limite) : Math.max(0, hist.length ? N.limite : Math.min(Math.round((c.renda || 0) * R.fatorRendaNovo / 50) * 50, R.limiteMaxNovo, N.limite || Infinity));
  const resultado = reprova.length ? "REPROVAR" : manual.length ? "MANUAL" : "APROVAR";
  const parecer = { resultado, modo: R.modo, score: N.score, faixa: N.faixa, limite, reprova, manual, ok: [...ok, ...N.motivos], alertas, em: Date.now() };
  const upd = { motor: parecer, ...alertas.length ? { alertasFraude: alertas } : {}, ...serasa ? { serasa } : {} };
  if (R.modo === "automatico" && resultado !== "MANUAL") {
    const status = resultado === "APROVAR" ? "APROVADA" : "REPROVADA";
    Object.assign(upd, { status, analise: {
      resultado: status,
      por: "motor",
      porNome: "Motor de cr\xE9dito",
      em: Date.now(),
      score: N.score,
      limite: status === "APROVADA" ? limite : 0,
      obs: status === "APROVADA" ? "Aprovado automaticamente pelas regras de cr\xE9dito." : "Reprovado pelas regras: " + reprova.join("; "),
      checklist: { cpf: true, bio: true, doc: true },
      automatico: true
    } });
  }
  await ref.set(upd, { merge: true });
  await db.collection("logs").add({ em: Date.now(), acao: "Motor de cr\xE9dito: " + (upd.status || resultado), alvo: vendaId, det: [...reprova, ...manual].join("; ").slice(0, 400), por: "Motor de cr\xE9dito" });
  return { resultado, status: upd.status || "ANALISE", limite, score: N.score };
}
async function handler9(req, res) {
  if (cors(req, res)) return;
  if (req.method !== "POST") return res.status(405).end();
  try {
    const quem = await exigirEquipe(req, ["DONO", "FINANCEIRO", "SUPORTE", "GERENTE", "VENDEDOR"]);
    const id = String(req.body?.vendaId || "");
    const v = (await db.collection("vendas").doc(id).get()).data();
    if (!v) throw Object.assign(new Error("venda n\xE3o encontrada"), { status: 404 });
    if (quem.role === "VENDEDOR" && v.vendedorUid !== quem.uid) throw Object.assign(new Error("sem permiss\xE3o"), { status: 403 });
    if (quem.role === "GERENTE" && v.lojaId !== quem.lojaId) throw Object.assign(new Error("sem permiss\xE3o"), { status: 403 });
    const cfg = (await db.collection("config").doc("sistema").get()).data() || {};
    if ((cfg.motor?.modo || MOTOR_PADRAO.modo) === "desligado") return res.status(200).json({ resultado: "DESLIGADO" });
    return res.status(200).json(await avaliarVenda(id));
  } catch (e) {
    console.error(e);
    return res.status(e.status || 500).json({ erro: e.message });
  }
}

// api/cron.js
var dias2 = (a, b) => Math.round((new Date(b) - new Date(a)) / 864e5);
var brl2 = (n) => "R$ " + Number(n || 0).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
var dataBR = (d) => String(d || "").split("-").reverse().join("/");
var primeiroNome = (n) => String(n || "").trim().split(/\s+/)[0] || "";
var urlCliente = () => process.env.PORTAL_CLIENTE_URL || (process.env.PORTAL_ORIGEM || "https://nexumrh.github.io") + "/cliente/";
function dadosAviso(v, cfg, tipo) {
  const abertas = (v.parcelas || []).filter((p2) => !p2.pago).sort((a, b) => a.venc.localeCompare(b.venc));
  const atrasadas = abertas.filter((p2) => p2.venc < hoje()), p = (tipo === "atraso" ? atrasadas[0] : abertas[0]) || abertas[0] || {};
  const ap = { descontoPct: cfg.descontoAntecipadoPct, multaPct: cfg.multaPct, moraDiaPct: cfg.moraDiaPct };
  const valor = tipo === "atraso" ? r2(atrasadas.reduce((s, x) => s + encargos(x, ap), 0)) : p.valor ? encargos(p, ap) : 0;
  const nome = primeiroNome(v.clienteNome), loja = cfg.empresa || "NexumCell", d = p.venc ? Math.max(0, dias2(p.venc, hoje())) : 0;
  const texto = tipo === "atraso" ? `${loja}: ${nome}, sua parcela esta atrasada ha ${d} dia(s). Valor hoje ${brl2(valor)}. Pague pelo portal ${urlCliente()} e evite o bloqueio do aparelho.` : `${loja}: ${nome}, sua parcela de ${brl2(valor)} vence ${p.venc === hoje() ? "HOJE" : "em " + dataBR(p.venc)}. Pagando antes voce ganha desconto: ${urlCliente()}`;
  return { tel: (v.cliente?.telefones || [])[0] || v.clienteTel1 || "", modelo: tipo, texto, params: { NOME: nome, VALOR: brl2(valor), VENCIMENTO: dataBR(p.venc), DIAS: String(d), LINK: urlCliente(), LOJA: loja } };
}
async function vendasAtivas() {
  return (await db.collection("vendas").where("status", "==", "ATIVA").get()).docs.map((d) => ({ id: d.id, ...d.data() }));
}
var preencher = (t, dd) => String(t || "").replace(/\{(\w+)\}/g, (m, k) => ({ nome: dd.params.NOME, valor: dd.params.VALOR, vencimento: dd.params.VENCIMENTO, dias: dd.params.DIAS, link: dd.params.LINK, loja: dd.params.LOJA })[k.toLowerCase()] ?? m);
async function regua(cfg, vendas) {
  const passos = (cfg.regua || []).filter((x) => x && Number.isFinite(+x.dia) && (x.canais || []).length);
  const max = Number(process.env.ROTINA_MAX) || 1e3;
  let enviados = 0, falhas = 0, restantes = 0;
  for (const v of vendas) {
    if (v.pixAutomatico?.status === "ATIVO") continue;
    const abertas = (v.parcelas || []).filter((p2) => !p2.pago).sort((a, b) => a.venc.localeCompare(b.venc));
    if (!abertas.length) continue;
    const atrasada = abertas.find((p2) => p2.venc < hoje()), p = atrasada || abertas[0], d = dias2(p.venc, hoje());
    const passo = passos.find((x) => +x.dia === d);
    if (!passo) continue;
    const chave = `${p.n}:R${d}`;
    if (v.avisosBrevo?.[chave]) continue;
    if (enviados + falhas >= max) {
      restantes++;
      continue;
    }
    const dd = dadosAviso(v, cfg, d > 0 ? "atraso" : "lembrete");
    const texto = passo.texto ? preencher(passo.texto, dd) : dd.texto;
    const r = {};
    for (const c of passo.canais) {
      try {
        if (c === "sms" || c === "whatsapp") {
          if (!brevoLigado() || !dd.tel) throw new Error("sem Brevo ou telefone");
          Object.assign(r, await avisarCliente(dd.tel, c === "sms" ? "sms" : "whatsapp_ou_sms", { ...dd, texto }));
        }
        if (c === "email") {
          const em = v.cliente?.email;
          if (!brevoLigado() || !em) throw new Error("sem Brevo ou e-mail");
          await enviarEmail({ para: em, assunto: d > 0 ? "Parcela em atraso" : "Lembrete de vencimento", titulo: d > 0 ? "Parcela em atraso" : "Sua parcela est\xE1 chegando", texto });
          r.email = "ok";
        }
        if (c === "app") {
          const ok = await pushNotificacao(v.aparelhoToken, d > 0 ? "Parcela em atraso" : "Lembrete de vencimento", texto);
          r.app = ok ? "ok" : "sem app";
        }
      } catch (e) {
        r[c] = e.message;
      }
    }
    Object.values(r).some((x) => x === "ok") ? enviados++ : falhas++;
    await db.collection("vendas").doc(v.id).set({ avisosBrevo: { ...v.avisosBrevo || {}, [chave]: { em: Date.now(), ...r } } }, { merge: true });
  }
  return { regua: enviados, falhas, ficaramParaDepois: restantes };
}
var FAIXAS = [["Bronze", 0], ["Prata", 600], ["Ouro", 750], ["Diamante", 900]];
async function scoreRotina() {
  const todas = (await db.collection("vendas").where("status", "in", ["ATIVA", "QUITADA", "RETOMADA"]).get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  const porCpf = {};
  todas.forEach((v) => (porCpf[v.clienteCpf] = porCpf[v.clienteCpf] || []).push(v));
  const max = Number(process.env.ROTINA_MAX) || 1e3;
  let n = 0;
  for (const vs of Object.values(porCpf)) {
    const ativa = vs.find((v) => v.status === "ATIVA" && v.aparelhoToken);
    if (!ativa) continue;
    const N = nota(vs, ativa.cliente?.renda), faixa = [...FAIXAS].reverse().find(([, m]) => N.score >= m)[0], prox = FAIXAS.find(([, m]) => m > N.score);
    const sc = { valor: N.score, faixa: N.atrasoAberto ? "Em atraso" : faixa, proxima: prox ? { faixa: prox[0], falta: prox[1] - N.score } : null, em: hoje() };
    if (ativa.score?.valor === sc.valor && ativa.score?.faixa === sc.faixa) continue;
    if (n >= max) break;
    await db.collection("aparelhos").doc(ativa.aparelhoToken).set({ score: sc }, { merge: true });
    await db.collection("vendas").doc(ativa.id).set({ score: sc }, { merge: true });
    n++;
  }
  return n;
}
async function preAprovados(cfg) {
  const todas = (await db.collection("vendas").where("status", "in", ["ATIVA", "QUITADA"]).get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  const porCpf = {};
  todas.forEach((v) => (porCpf[v.clienteCpf] = porCpf[v.clienteCpf] || []).push(v));
  const max = Number(process.env.ROTINA_MAX) || 1e3;
  let n = 0;
  for (const [cpf, vs] of Object.entries(porCpf)) {
    if (n >= max) break;
    const ok = vs.every((v) => {
      const ps = v.parcelas || [], pagas = ps.filter((p) => p.pago);
      const atrasoMax = Math.max(0, ...pagas.map((p) => p.pagoEm ? dias2(p.venc, String(p.pagoEm).slice(0, 10)) : 0));
      const aberto = ps.some((p) => !p.pago && p.venc < hoje());
      return !aberto && atrasoMax <= 3 && !(v.acordos || []).length && (v.status === "QUITADA" || pagas.length / (ps.length || 1) >= 0.6);
    });
    if (!ok) continue;
    const ult = vs.sort((a, b) => b.criadoEm - a.criadoEm)[0];
    const renda = ult.cliente?.renda || 0;
    const quitados = vs.filter((v) => v.status === "QUITADA").length, mult = Number(cfg.preAprovadoMult) || (quitados ? 2.5 : 1.8);
    const valor = Math.round(Math.min(renda * mult, Number(cfg.preAprovadoMax) || 6e3) / 50) * 50;
    if (!(valor > 0)) continue;
    const ate = new Date(Date.now() + 90 * 864e5).toISOString().slice(0, 10), atual = (await db.collection("clientes").doc(cpf).get()).data()?.preAprovado;
    if (atual && atual.valor === valor && atual.ate >= hoje()) continue;
    await db.collection("clientes").doc(cpf).set({ preAprovado: { valor, ate, em: Date.now(), vendaId: ult.id, loja: ult.lojaNome || "" } }, { merge: true });
    if (ult.aparelhoToken && ult.status === "ATIVA") await db.collection("aparelhos").doc(ult.aparelhoToken).set({ preAprovado: { valor, ate, em: Date.now(), loja: ult.lojaNome || "" } }, { merge: true });
    n++;
  }
  return n;
}
async function lembretes(cfg, vendas) {
  if (Array.isArray(cfg.regua) && cfg.regua.length) return regua(cfg, vendas);
  const canal = cfg.brevoCanal || "nenhum";
  if (!brevoLigado() || canal === "nenhum" || cfg.brevoLembretes !== "sim") return { lembretes: "desligado" };
  const antes = Number(cfg.lembreteDiasAntes ?? 2), atrasos = String(cfg.lembreteDiasAtraso || "1,3,7").split(",").map(Number).filter((x) => x > 0);
  const max = Number(process.env.ROTINA_MAX) || 1e3;
  let enviados = 0, falhas = 0, restantes = 0;
  for (const v of vendas) {
    if (v.pixAutomatico?.status === "ATIVO") continue;
    const abertas = (v.parcelas || []).filter((p2) => !p2.pago).sort((a, b) => a.venc.localeCompare(b.venc));
    if (!abertas.length) continue;
    const p = abertas[0], d = dias2(hoje(), p.venc);
    let tipo = null, chave = "";
    if (d === antes || d === 0) {
      tipo = "lembrete";
      chave = `${p.n}:L${d}`;
    } else if (d < 0 && atrasos.includes(-d)) {
      tipo = "atraso";
      chave = `${p.n}:A${-d}`;
    }
    if (!tipo || v.avisosBrevo?.[chave]) continue;
    const dd = dadosAviso(v, cfg, tipo);
    if (!dd.tel) continue;
    if (enviados + falhas >= max) {
      restantes++;
      continue;
    }
    const r = await avisarCliente(dd.tel, canal, dd);
    const ok = r.whatsapp === "ok" || r.sms === "ok";
    ok ? enviados++ : falhas++;
    await db.collection("vendas").doc(v.id).set({ avisosBrevo: { ...v.avisosBrevo || {}, [chave]: { em: Date.now(), ...r } } }, { merge: true });
  }
  return { lembretes: enviados, falhas, ficaramParaDepois: restantes };
}
async function roboVoz(cfg, vendas) {
  if (cfg.roboVoz !== "sim" || !await asaasLigadoSrv()) return { roboVoz: "desligado" };
  const limite = Number(cfg.roboVozDias) || 15, max = Math.max(1, Math.round((Number(process.env.ROTINA_MAX) || 1e3) / 4));
  let ligados = 0, desligados = 0, erros = 0;
  for (const v of vendas) {
    if (ligados + desligados + erros >= max) break;
    const cust = v.asaas?.customer;
    if (!cust) continue;
    const atraso = Math.max(0, ...(v.parcelas || []).filter((p) => !p.pago).map((p) => dias2(p.venc, hoje())));
    const querLigado = atraso >= limite;
    if (querLigado === !!v.roboVoz?.ligado) continue;
    try {
      const nots = (await asaas(`/customers/${cust}/notifications`)).data || [];
      for (const n of nots.filter((x) => x.event === "PAYMENT_OVERDUE"))
        await asaas("/notifications/" + n.id, { method: "PUT", body: JSON.stringify({ enabled: true, phoneCallEnabledForCustomer: querLigado }) });
      await db.collection("vendas").doc(v.id).set({ roboVoz: { ligado: querLigado, em: Date.now(), atraso } }, { merge: true });
      await db.collection("logs").add({ em: Date.now(), acao: querLigado ? "Rob\xF4 de voz ligado (Asaas)" : "Rob\xF4 de voz desligado (regularizou)", alvo: v.id, det: `${atraso} dia(s) de atraso`, por: "Rotina autom\xE1tica" });
      querLigado ? ligados++ : desligados++;
    } catch (e) {
      erros++;
      console.error("robo", v.id, e.message);
    }
  }
  return { roboVozLigados: ligados, roboVozDesligados: desligados, erros };
}
async function resumoDoDia(cfg) {
  const h = hoje(), todas = (await db.collection("vendas").get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  const ini = (/* @__PURE__ */ new Date(h + "T00:00:00-03:00")).getTime();
  const novas = todas.filter((v) => (v.criadoEm || 0) >= ini && !["REPROVADA", "CANCELADA", "RASCUNHO"].includes(v.status));
  const ativadas = novas.filter((v) => ["ATIVA", "QUITADA"].includes(v.status));
  let recebido = 0, nParc = 0, atrasoValor = 0;
  const atrasados = /* @__PURE__ */ new Set();
  todas.forEach((v) => (v.parcelas || []).forEach((p) => {
    if (p.pago && p.pagoEm === h) {
      recebido += +(p.valorPago ?? p.valor);
      nParc++;
    }
    if (!p.pago && v.status === "ATIVA" && p.venc < h) {
      atrasoValor += p.valor;
      atrasados.add(v.id);
    }
  }));
  const entradas = ativadas.reduce((s, v) => s + (+v.entradaPaga?.valor || 0), 0);
  const analise = todas.filter((v) => v.status === "ANALISE").length;
  const amanha = todas.filter((v) => v.status === "ATIVA" && (v.parcelas || []).some((p) => !p.pago && p.venc === new Date(Date.now() + 21 * 36e5).toISOString().slice(0, 10)));
  const semSinalDias = Math.max(1, Number(cfg.alertaSemSinalDias) || 5);
  let semSinal = [];
  try {
    const aps = (await db.collection("aparelhos").where("status", "==", "ATIVO").get()).docs.map((d) => d.data());
    semSinal = aps.filter((a) => !a.quitado && a.checkin?.em && Date.now() - a.checkin.em > semSinalDias * 864e5);
  } catch (e) {
    console.warn("semSinal", e.message);
  }
  const porLoja = {};
  ativadas.forEach((v) => {
    porLoja[v.lojaNome || "Loja"] = (porLoja[v.lojaNome || "Loja"] || 0) + 1;
  });
  const linhas = [
    `Vendas hoje: ${ativadas.length} ativada(s)${novas.length > ativadas.length ? ` + ${novas.length - ativadas.length} em andamento` : ""}${Object.keys(porLoja).length ? " (" + Object.entries(porLoja).map(([l, n]) => `${l}: ${n}`).join(", ") + ")" : ""}`,
    `Entradas recebidas: ${brl2(entradas)}`,
    `Parcelas recebidas: ${nParc} \xB7 ${brl2(recebido)}`,
    `Em atraso: ${atrasados.size} contrato(s) \xB7 ${brl2(atrasoValor)}`,
    `Vencem amanh\xE3: ${amanha.length} contrato(s)`,
    analise ? `Propostas esperando an\xE1lise: ${analise}` : "",
    semSinal.length ? `\u26A0\uFE0F Aparelhos sem sinal h\xE1 mais de ${semSinalDias} dias: ${semSinal.length} (${semSinal.slice(0, 5).map((a) => "n\xBA " + a.vendaNumero).join(", ")}${semSinal.length > 5 ? "\u2026" : ""})` : ""
  ].filter(Boolean);
  const texto = linhas.join("\n"), titulo = `Resumo de ${dataBR(h)} \u2014 ${cfg.empresa || "NexumCell"}`;
  const r = { texto, enviado: {} };
  await db.collection("notificacoes").doc("resumo-" + h).set({
    tipo: "RESUMO",
    para: "DONO",
    titulo,
    texto,
    em: Date.now(),
    dia: h,
    lida: false,
    numeros: { vendas: ativadas.length, entradas: r2(entradas), recebido: r2(recebido), parcelas: nParc, atrasados: atrasados.size, atrasoValor: r2(atrasoValor), analise, semSinal: semSinal.length }
  });
  if (brevoLigado() && cfg.resumoEmail !== "nao") {
    const para = [process.env.DONO_EMAIL, ...String(cfg.resumoEmailsExtras || "").split(/[,;\s]+/)].filter((x) => /@/.test(x || ""));
    try {
      await enviarEmail({ para, assunto: titulo, html: moldura(titulo, texto + "\n\nAbra o Painel do Dono para ver os detalhes."), texto });
      r.enviado.email = "ok";
    } catch (e) {
      r.enviado.email = e.message;
    }
  }
  if (brevoLigado() && cfg.donoTelefone && ["whatsapp", "sms"].includes(cfg.resumoCanal)) {
    try {
      if (cfg.resumoCanal === "whatsapp" && MODELOS.resumo()) await enviarWhatsapp(cfg.donoTelefone, { templateId: MODELOS.resumo(), params: { TEXTO: linhas.slice(0, 4).join(" | ") } });
      else await enviarSms(cfg.donoTelefone, (titulo + ": " + linhas.slice(0, 4).join("; ")).normalize("NFD").replace(/[̀-ͯ]/g, ""));
      r.enviado.celular = "ok";
    } catch (e) {
      r.enviado.celular = e.message;
    }
  }
  return r;
}
async function rotinas(qual) {
  const cfg = await config();
  let ios = {};
  try {
    ios = await iosRotina(db);
  } catch (e) {
    console.error("ios", e.message);
  }
  if (qual === "noite") {
    const r = await resumoDoDia(cfg);
    try {
      r.saas = await saasRotina();
    } catch (e) {
      console.error("saas", e.message);
    }
    try {
      r.preAprovados = await preAprovados(cfg);
    } catch (e) {
      console.error("pre", e.message);
    }
    try {
      r.scores = await scoreRotina();
    } catch (e) {
      console.error("score", e.message);
    }
    try {
      r.repasses = await repasseRotina(cfg);
    } catch (e) {
      console.error("repasse", e.message);
    }
    try {
      r.backup = await backupRotina(cfg);
    } catch (e) {
      console.error("backup", e.message);
    }
    try {
      r.instalacoes = await instalacoesRotina();
    } catch (e) {
      console.error("instalacoes", e.message);
    }
    try {
      r.negativacao = await negativacaoRotina(cfg);
    } catch (e) {
      console.error("negativacao", e.message);
    }
    try {
      r.cashback = await cashbackRotina(cfg);
    } catch (e) {
      console.error("cashback", e.message);
    }
    return { ...r, ...ios };
  }
  const vendas = await vendasAtivas();
  let aniv = {};
  try {
    aniv = await aniversarioRotina(cfg);
  } catch (e) {
    console.error("aniversario", e.message);
  }
  try {
    Object.assign(aniv, await relatorioSemanal(cfg));
  } catch (e) {
    console.error("relsemanal", e.message);
  }
  try {
    Object.assign(aniv, await posVendaRotina(cfg));
  } catch (e) {
    console.error("posvenda", e.message);
  }
  return { ...await lembretes(cfg, vendas), ...await roboVoz(cfg, vendas), ...aniv, ...ios };
}

// api/avisos.js
async function handler10(req, res) {
  if (cors(req, res)) return;
  if (req.method !== "POST") return res.status(405).end();
  try {
    const b = req.body || {}, E = process.env;
    if (b.acao === "relSemanal") {
      await exigirEquipe(req, ["DONO"]);
      return res.status(200).json(await relatorioSemanal(await config(), true));
    }
    if (b.acao === "status") {
      await exigirEquipe(req);
      const ac = await asaasConf();
      return res.status(200).json({
        brevo: brevoLigado(),
        email: !!(E.BREVO_API_KEY && E.BREVO_REMETENTE),
        sms: !!E.BREVO_API_KEY,
        whatsapp: !!(E.BREVO_API_KEY && E.BREVO_WHATSAPP_NUMERO),
        modelos: Object.fromEntries(Object.keys(MODELOS).map((k) => [k, !!MODELOS[k]()])),
        asaas: !!ac.chave,
        asaasSandbox: ac.ambiente === "sandbox",
        asaasOrigem: ac.origem,
        asaasWebhook: !!ac.webhookToken,
        notaFiscal: !!E.FOCUS_NFE_TOKEN,
        zapsign: !!E.ZAPSIGN_TOKEN,
        ia: !!E.GROQ_API_KEY,
        plataforma: globalThis.navigator?.userAgent === "Cloudflare-Workers" ? "Cloudflare" : "Vercel"
      });
    }
    if (b.acao === "testarAsaas") {
      await exigirEquipe(req, ["DONO"]);
      const ac = await asaasConf();
      if (!ac.chave) return res.status(200).json({ ok: false, erro: "nenhuma chave do Asaas configurada" });
      try {
        const c = await asaas("/myAccount/commercialInfo");
        return res.status(200).json({ ok: true, ambiente: ac.ambiente, conta: c.name || c.companyName || c.email || "" });
      } catch (e) {
        return res.status(200).json({ ok: false, ambiente: ac.ambiente, erro: e.message });
      }
    }
    if (b.acao === "email") {
      const quem = await exigirEquipe(req, ["DONO", "FINANCEIRO", "GERENTE", "SUPORTE"]);
      const para = String(b.para || "").trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(para)) throw Object.assign(new Error("e-mail inv\xE1lido"), { status: 400 });
      const anexos = b.anexo?.base64 ? [{ name: String(b.anexo.nome || "arquivo.csv").slice(0, 80), content: String(b.anexo.base64) }] : void 0;
      await enviarEmail({ para, assunto: b.assunto || "NexumCell", titulo: b.titulo || b.assunto, texto: String(b.texto || "").slice(0, 2e4), anexos });
      await db.collection("logs").add({ em: Date.now(), acao: "E-mail enviado (Brevo)", alvo: para, det: String(b.assunto || "").slice(0, 120), por: quem.nome });
      return res.status(200).json({ ok: true });
    }
    if (b.acao === "cliente") {
      const quem = await exigirEquipe(req);
      const s = await db.collection("vendas").doc(String(b.vendaId)).get();
      if (!s.exists) throw Object.assign(new Error("venda n\xE3o encontrada"), { status: 404 });
      const v = s.data(), cfg = await config();
      if (quem.role === "VENDEDOR" && v.vendedorUid !== quem.uid) throw Object.assign(new Error("sem permiss\xE3o"), { status: 403 });
      const d = dadosAviso(v, cfg, b.tipo === "atraso" ? "atraso" : "lembrete");
      if (b.tipo === "livre") d.texto = String(b.texto || "").slice(0, 600);
      if (!d.tel) throw new Error("cliente sem telefone");
      const canal = b.canal || cfg.brevoCanal || "whatsapp_ou_sms";
      const r = b.tipo === "livre" ? { sms: await enviarSms(d.tel, d.texto).then(() => "ok", (e) => e.message) } : await avisarCliente(d.tel, canal, d);
      await db.collection("logs").add({ em: Date.now(), acao: "Mensagem ao cliente (Brevo)", alvo: b.vendaId, det: JSON.stringify(r).slice(0, 200), por: quem.nome });
      return res.status(200).json(r);
    }
    if (b.acao === "teste") {
      await exigirEquipe(req, ["DONO"]);
      const r = {};
      try {
        await enviarEmail({ para: E.DONO_EMAIL, assunto: "Teste do Brevo \u2014 NexumCell", texto: "Se voc\xEA recebeu este e-mail, o Brevo est\xE1 ligado no servidor da NexumCell.\n\nData: " + hoje() });
        r.email = "ok";
      } catch (e) {
        r.email = e.message;
      }
      if (b.telefone) {
        try {
          await enviarSms(b.telefone, "NexumCell: teste de SMS pelo Brevo. Tudo certo!");
          r.sms = "ok";
        } catch (e) {
          r.sms = e.message;
        }
        if (MODELOS.lembrete()) {
          try {
            await enviarWhatsapp(b.telefone, { templateId: MODELOS.lembrete(), params: { NOME: "Teste", VALOR: "R$ 1,00", VENCIMENTO: hoje().split("-").reverse().join("/"), LINK: "nexumcell" } });
            r.whatsapp = "ok";
          } catch (e) {
            r.whatsapp = e.message;
          }
        } else r.whatsapp = "modelo de lembrete n\xE3o configurado";
      }
      return res.status(200).json(r);
    }
    if (b.acao === "rotina") {
      await exigirEquipe(req, ["DONO"]);
      return res.status(200).json(await rotinas(b.qual === "noite" ? "noite" : "manha"));
    }
    return res.status(400).json({ erro: "a\xE7\xE3o desconhecida" });
  } catch (e) {
    console.error(e);
    return res.status(e.status || 500).json({ erro: e.message });
  }
}

// api/nf.js
var URL_ = () => (process.env.FOCUS_NFE_URL || "https://homologacao.focusnfe.com.br").replace(/\/$/, "");
async function focus(caminho, opts = {}) {
  if (!process.env.FOCUS_NFE_TOKEN) throw new Error("Nota fiscal n\xE3o configurada (falta FOCUS_NFE_TOKEN no servidor)");
  const r = await fetch(URL_() + caminho, { ...opts, headers: { Authorization: "Basic " + btoa(process.env.FOCUS_NFE_TOKEN + ":"), "Content-Type": "application/json" } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok && r.status !== 422) throw new Error("Focus NFe " + r.status + ": " + (j.mensagem || JSON.stringify(j.erros || j)));
  return { status: r.status, ...j };
}
var FORMA = { PIX: "17", Dinheiro: "01", "Cart\xE3o de d\xE9bito": "04", "Cart\xE3o de cr\xE9dito": "03" };
function montarNfce(v, cfg) {
  const dig4 = (x) => String(x || "").replace(/\D/g, ""), ap = v.aparelho || {};
  const itens = [{ desc: `CELULAR ${ap.marca || ""} ${ap.modelo || ""} ${ap.capacidade || ""}`.replace(/\s+/g, " ").trim().toUpperCase(), valor: r2(v.valor - (v.acessoriosValor || 0)), cod: ap.catalogoId || "CEL", ncm: cfg.nfNcm || "85171300", extra: `IMEI ${ap.imei || ""}${ap.imei2 ? " / " + ap.imei2 : ""}` }];
  (v.acessorios || []).forEach((a) => itens.push({ desc: String(a.nome || "ACESSORIO").toUpperCase(), valor: r2(a.preco), cod: a.id || "ACS", ncm: cfg.nfNcmAcessorio || "85177900", extra: "" }));
  const total = r2(itens.reduce((s, i) => s + i.valor, 0));
  const entradaDin = r2(Math.min(total, v.entradaPaga?.valor || v.entrada || 0));
  const usado = r2(v.usado?.valor || 0), aPrazo = r2(Math.max(0, total - entradaDin - usado));
  const formas = [];
  if (entradaDin > 0) formas.push({ forma_pagamento: FORMA[v.entradaPaga?.forma] || "99", valor_pagamento: entradaDin.toFixed(2), ...["03", "04"].includes(FORMA[v.entradaPaga?.forma]) ? { tipo_integracao: "2" } : {} });
  if (usado > 0) formas.push({ forma_pagamento: "99", descricao_pagamento: "Aparelho usado na troca", valor_pagamento: usado.toFixed(2) });
  if (aPrazo > 0) formas.push({ forma_pagamento: "05", valor_pagamento: aPrazo.toFixed(2) });
  return {
    cnpj_emitente: dig4(cfg.cnpj),
    data_emissao: (/* @__PURE__ */ new Date()).toISOString(),
    natureza_operacao: "VENDA AO CONSUMIDOR",
    tipo_documento: "1",
    presenca_comprador: "1",
    finalidade_emissao: "1",
    consumidor_final: "1",
    modalidade_frete: "9",
    local_destino: "1",
    nome_destinatario: String(v.clienteNome || "").slice(0, 60),
    cpf_destinatario: dig4(v.clienteCpf),
    valor_produtos: total.toFixed(2),
    valor_desconto: "0.00",
    valor_total: total.toFixed(2),
    informacoes_adicionais_contribuinte: `Contrato ${v.numero} \xB7 venda a prazo: entrada + ${v.nParcelas}x de R$ ${Number(v.valorParcela || 0).toFixed(2)}`.slice(0, 500),
    items: itens.map((i, k) => ({
      numero_item: String(k + 1),
      codigo_produto: String(i.cod).slice(0, 60),
      descricao: i.desc.slice(0, 120),
      codigo_ncm: i.ncm,
      cfop: cfg.nfCfop || "5102",
      unidade_comercial: "UN",
      quantidade_comercial: "1.00",
      valor_unitario_comercial: i.valor.toFixed(2),
      valor_bruto: i.valor.toFixed(2),
      unidade_tributavel: "UN",
      quantidade_tributavel: "1.00",
      valor_unitario_tributavel: i.valor.toFixed(2),
      inclui_no_total: "1",
      icms_origem: cfg.nfOrigem || "0",
      icms_situacao_tributaria: cfg.nfCsosn || "102",
      pis_situacao_tributaria: cfg.nfPisCst || "07",
      cofins_situacao_tributaria: cfg.nfPisCst || "07",
      ...i.extra ? { informacoes_adicionais_item: i.extra } : {}
    })),
    formas_pagamento: formas
  };
}
var resumo = (j) => ({
  status: j.status,
  ref: j.ref,
  numero: j.numero || "",
  serie: j.serie || "",
  chave: j.chave_nfe || "",
  mensagem: j.mensagem_sefaz || j.mensagem || "",
  danfe: j.caminho_danfe ? j.caminho_danfe.startsWith("http") ? j.caminho_danfe : URL_() + j.caminho_danfe : "",
  xml: j.caminho_xml_nota_fiscal ? URL_() + j.caminho_xml_nota_fiscal : "",
  qrcode: j.qrcode_url || "",
  em: Date.now()
});
async function handler11(req, res) {
  if (cors(req, res)) return;
  if (req.method !== "POST") return res.status(405).end();
  try {
    const b = req.body || {}, quem = await exigirEquipe(req, ["DONO", "FINANCEIRO", "GERENTE"]);
    const ref = db.collection("vendas").doc(String(b.vendaId)), v = (await ref.get()).data();
    if (!v) throw Object.assign(new Error("venda n\xE3o encontrada"), { status: 404 });
    if (quem.role === "GERENTE") {
      const u = (await db.collection("users").doc(quem.uid).get()).data() || {};
      if (u.lojaId !== v.lojaId) throw Object.assign(new Error("sem permiss\xE3o"), { status: 403 });
    }
    const nref = "nxc-" + String(b.vendaId).replace(/[^A-Za-z0-9-]/g, "");
    if (b.acao === "emitir") {
      if (v.notaFiscal?.status === "autorizado") return res.status(200).json(v.notaFiscal);
      const cfg = await config();
      if (!String(cfg.cnpj || "").replace(/\D/g, "")) throw new Error("Preencha o CNPJ da empresa em Configura\xE7\xF5es");
      const j = await focus("/v2/nfce?ref=" + nref, { method: "POST", body: JSON.stringify(montarNfce(v, cfg)) });
      const nf = { ...resumo(j), ref: nref, por: quem.nome };
      await ref.set({ notaFiscal: nf }, { merge: true });
      await db.collection("logs").add({ em: Date.now(), acao: "Nota fiscal (NFC-e)", alvo: b.vendaId, det: `${nf.status} ${nf.numero || ""} ${nf.mensagem || ""}`.slice(0, 200), por: quem.nome });
      return res.status(200).json(nf);
    }
    if (b.acao === "consultar") {
      const j = await focus("/v2/nfce/" + nref + "?completa=0");
      const nf = { ...v.notaFiscal || {}, ...resumo(j), ref: nref };
      await ref.set({ notaFiscal: nf }, { merge: true });
      return res.status(200).json(nf);
    }
    if (b.acao === "cancelar") {
      if (quem.role === "GERENTE") throw Object.assign(new Error("s\xF3 o Dono ou o Financeiro cancelam nota"), { status: 403 });
      const just = String(b.motivo || "").trim();
      if (just.length < 15) throw new Error("Escreva o motivo do cancelamento (m\xEDnimo 15 letras)");
      const j = await focus("/v2/nfce/" + nref, { method: "DELETE", body: JSON.stringify({ justificativa: just.slice(0, 255) }) });
      const nf = { ...v.notaFiscal || {}, status: j.status || "cancelado", mensagem: j.mensagem_sefaz || "", canceladaEm: Date.now(), motivoCancelamento: just };
      await ref.set({ notaFiscal: nf }, { merge: true });
      return res.status(200).json(nf);
    }
    return res.status(400).json({ erro: "a\xE7\xE3o desconhecida" });
  } catch (e) {
    console.error(e);
    return res.status(e.status || 500).json({ erro: e.message });
  }
}

// api/assinatura.js
var ZURL = () => (process.env.ZAPSIGN_URL || "https://sandbox.api.zapsign.com.br/api/v1").replace(/\/$/, "");
async function zapsign(caminho, opts = {}) {
  if (!process.env.ZAPSIGN_TOKEN) throw new Error("ZapSign n\xE3o configurada (falta ZAPSIGN_TOKEN no servidor)");
  const r = await fetch(ZURL() + caminho, { ...opts, headers: { Authorization: "Bearer " + process.env.ZAPSIGN_TOKEN, "Content-Type": "application/json" } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("ZapSign " + r.status + ": " + (j.detail || j.message || JSON.stringify(j)));
  return j;
}
async function sha256(txt4) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(txt4));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function htmlParaMarkdown(html) {
  return String(html || "").replace(/<h[1-3][^>]*>(.*?)<\/h[1-3]>/gis, "\n## $1\n").replace(/<h4[^>]*>(.*?)<\/h4>/gis, "\n### $1\n").replace(/<(b|strong)>(.*?)<\/\1>/gis, "**$2**").replace(/<li[^>]*>/gi, "\n- ").replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}
var ipDo = (req) => String(req.headers["cf-connecting-ip"] || req.headers["x-real-ip"] || String(req.headers["x-forwarded-for"] || "").split(",")[0] || "").trim();
async function handler12(req, res) {
  if (cors(req, res)) return;
  if (req.method !== "POST") return res.status(405).end();
  try {
    const b = req.body || {};
    if (b.acao === "carimbo") {
      const ref = db.collection("assinaturas").doc(String(b.tk || "")), s = await ref.get();
      if (!s.exists) return res.status(404).json({ erro: "link n\xE3o encontrado" });
      const a = s.data();
      if (a.status !== "ASSINADO") return res.status(400).json({ erro: "ainda n\xE3o assinado" });
      if (a.carimbo) return res.status(200).json(a.carimbo);
      if (Date.now() - (a.assinadoEm || 0) > 15 * 6e4) return res.status(400).json({ erro: "assinatura antiga: carimbo s\xF3 na hora da assinatura" });
      const hashConteudo = await sha256([a.contrato, a.assinatura, a.assinadoEm, a.vendaId].join("|"));
      const carimbo = {
        servidorEm: Date.now(),
        servidorData: (/* @__PURE__ */ new Date()).toISOString(),
        ip: ipDo(req),
        pais: String(req.headers["cf-ipcountry"] || ""),
        navegador: String(req.headers["user-agent"] || "").slice(0, 250),
        hashConteudo,
        codigo: hashConteudo.slice(0, 10).toUpperCase()
      };
      await ref.set({ carimbo }, { merge: true });
      if (a.vendaId) await db.collection("vendas").doc(a.vendaId).set({ carimboAssinatura: carimbo }, { merge: true });
      return res.status(200).json(carimbo);
    }
    if (b.acao === "zapsign") {
      const quem = await exigirEquipe(req);
      const vref = db.collection("vendas").doc(String(b.vendaId)), v = (await vref.get()).data();
      if (!v) throw Object.assign(new Error("venda n\xE3o encontrada"), { status: 404 });
      if (v.zapsign?.status === "pendente" && v.zapsign.signUrl) return res.status(200).json(v.zapsign);
      const tel = String((v.cliente?.telefones || [])[0] || "").replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
      const doc = await zapsign("/docs/", { method: "POST", body: JSON.stringify({
        name: `Contrato ${v.numero} \u2014 ${v.clienteNome}`.slice(0, 255),
        markdown_text: htmlParaMarkdown(b.contratoHtml || v.contratoTexto || ""),
        lang: "pt-br",
        external_id: String(b.vendaId),
        disable_signer_emails: true,
        brand_primary_color: "#0E1A3A",
        signers: [{
          name: v.clienteNome,
          email: v.cliente?.email || "",
          phone_country: "55",
          phone_number: tel,
          auth_mode: "assinaturaTela",
          require_selfie_photo: true,
          require_document_photo: true,
          lock_name: true,
          external_id: String(v.clienteCpf || ""),
          send_automatic_email: false,
          send_automatic_whatsapp: false
        }]
      }) });
      const sg = (doc.signers || [])[0] || {};
      const z = { docToken: doc.token, signerToken: sg.token || "", signUrl: sg.sign_url || "", status: "pendente", criadoEm: Date.now(), por: quem.nome };
      await vref.set({ zapsign: z, contratoTexto: b.contratoHtml || v.contratoTexto || "" }, { merge: true });
      await db.collection("logs").add({ em: Date.now(), acao: "Contrato enviado para assinatura ZapSign", alvo: b.vendaId, det: doc.token, por: quem.nome });
      return res.status(200).json(z);
    }
    if (b.acao === "zapsignArquivo") {
      await exigirEquipe(req);
      const v = (await db.collection("vendas").doc(String(b.vendaId)).get()).data();
      if (!v?.zapsign?.docToken) throw new Error("este contrato n\xE3o foi assinado pela ZapSign");
      const d = await zapsign("/docs/" + v.zapsign.docToken + "/");
      return res.status(200).json({ status: d.status, arquivo: d.signed_file || d.original_file || "" });
    }
    return res.status(400).json({ erro: "a\xE7\xE3o desconhecida" });
  } catch (e) {
    console.error(e);
    return res.status(e.status || 500).json({ erro: e.message });
  }
}

// api/zapsign-webhook.js
async function handler13(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  if (process.env.ZAPSIGN_WEBHOOK_TOKEN && req.headers["x-nexum-token"] !== process.env.ZAPSIGN_WEBHOOK_TOKEN) return res.status(401).json({ erro: "token inv\xE1lido" });
  try {
    const b = req.body || {}, vendaId = String(b.external_id || "");
    if (!vendaId || !b.token) return res.status(200).json({ ok: true, ignorado: "sem refer\xEAncia" });
    const d = await zapsign("/docs/" + b.token + "/");
    if (String(d.external_id) !== vendaId) return res.status(200).json({ ok: true, ignorado: "documento n\xE3o confere" });
    const ref = db.collection("vendas").doc(vendaId), v = (await ref.get()).data();
    if (!v || v.zapsign?.docToken !== d.token) return res.status(200).json({ ok: true, ignorado: "venda n\xE3o confere" });
    const sg = (d.signers || [])[0] || {};
    if (d.status === "signed") {
      if (v.zapsign.status === "assinado") return res.status(200).json({ ok: true });
      const z = { ...v.zapsign, status: "assinado", assinadoEm: Date.parse(sg.signed_at || "") || Date.now(), ip: sg.ip || "", selfie: !!sg.selfie_photo_url, documento: !!sg.document_photo_url };
      const dados = { zapsign: z };
      if (v.status === "APROVADA")
        Object.assign(dados, {
          status: "AGUARDANDO_ENTRADA",
          assinadoEm: z.assinadoEm,
          aceiteBloqueio: true,
          aceiteLgpd: true,
          assinaturaPendente: null,
          assinaturaDigital: { via: "ZAPSIGN", codigo: String(d.token).slice(0, 10).toUpperCase(), hash: d.token, por: "ZapSign", dispositivo: "ZapSign \xB7 selfie + documento" }
        });
      await ref.set(dados, { merge: true });
      await db.collection("logs").add({ em: Date.now(), acao: "Contrato assinado (ZapSign)", alvo: vendaId, det: d.token, por: "ZapSign" });
    } else if (d.status === "refused" || sg.status === "refused" || d.status === "recusado") {
      await ref.set({ zapsign: { ...v.zapsign, status: "recusado", em: Date.now() } }, { merge: true });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ erro: e.message });
  }
}

// api/preanalise.js
var dig = (s) => String(s || "").replace(/\D/g, "");
function cpfOk(c) {
  c = dig(c);
  if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false;
  for (const t of [9, 10]) {
    let s = 0;
    for (let i = 0; i < t; i++) s += +c[i] * (t + 1 - i);
    if (s * 10 % 11 % 10 !== +c[t]) return false;
  }
  return true;
}
var txt = (s, n) => String(s ?? "").replace(/[<>]/g, "").trim().slice(0, n);
var brl3 = (n) => "R$ " + Number(n || 0).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
var diasAtraso = (venc) => Math.floor((new Date(hoje()) - new Date(venc)) / 864e5);
async function decidir(p, vit, cfg) {
  const pct = Number(cfg.preRendaPct) || 30, minLim = Number(cfg.preLimiteMin) || 300, maxLim = Number(cfg.preLimiteMax) || 0;
  const entPct = Number(vit.entradaPct ?? cfg.entradaPct) || 30;
  const n = Math.max(...String(vit.parcelasOpcoes || cfg.parcelasOpcoes || "12").split(",").map(Number).filter((x) => x > 0), 1);
  const ln = await Promise.all([db.collection("listanegra").doc("cpf_" + p.cpf).get(), db.collection("listanegra").doc("tel_" + p.telefone).get()]);
  if (ln.some((d) => d.exists && d.data()?.ativo !== false)) return { status: "CONTATADO", resposta: "Recebemos seus dados. A loja vai analisar e falar com voc\xEA pelo WhatsApp.", auto: { motivo: "lista negra" } };
  const hist = (await db.collection("vendas").where("clienteCpf", "==", p.cpf).get()).docs.map((d) => d.data());
  const atrasoAberto = Math.max(0, ...hist.filter((v) => v.status === "ATIVA").flatMap((v) => (v.parcelas || []).filter((x) => !x.pago).map((x) => diasAtraso(x.venc))));
  if (hist.some((v) => v.status === "RETOMADA") || atrasoAberto > 30) return { status: "RECUSADA", resposta: "No momento n\xE3o conseguimos aprovar uma nova compra. Regularize o contrato em aberto e tente de novo.", auto: { motivo: "hist\xF3rico" } };
  if (hist.some((v) => v.status === "ATIVA")) return { status: "CONTATADO", resposta: "Voc\xEA j\xE1 tem um contrato com a gente. A loja vai falar com voc\xEA pelo WhatsApp sobre a nova compra.", auto: { motivo: "contrato ativo" } };
  if (!(p.renda > 0)) return { status: "CONTATADO", resposta: "Recebemos seus dados. A loja vai falar com voc\xEA pelo WhatsApp.", auto: { motivo: "sem renda" } };
  const parcelaMax = r2(p.renda * pct / 100);
  const ap = (vit.aparelhos || []).find((a) => `${a.marca} ${a.modelo} ${a.capacidade}` === p.aparelho);
  const juros = Number(ap?.juros ?? vit.jurosPadrao ?? cfg.jurosFinanciamentoPct ?? 25);
  let limite = r2(parcelaMax * n / (1 + juros / 100 - entPct / 100));
  if (maxLim > 0) limite = Math.min(limite, maxLim);
  const quitou = hist.some((v) => v.status === "QUITADA");
  if (ap) {
    const entMin = r2(ap.preco * entPct / 100), ent = Math.max(p.entrada || 0, entMin);
    const parcela = r2((ap.preco * (1 + juros / 100) - ent) / n);
    if (parcela <= parcelaMax && (!maxLim || ap.preco <= maxLim))
      return { status: "PRE_APROVADO", resposta: `Pr\xE9-aprovado! ${p.aparelho}: entrada de ${brl3(ent)} + ${n}x de ${brl3(parcela)}.${(p.entrada || 0) < entMin ? ` (A entrada m\xEDnima \xE9 ${brl3(entMin)}.)` : ""}${quitou ? " Obrigado por voltar!" : ""} Agende abaixo e traga RG ou CNH.`, auto: { parcela, entrada: ent, n, limite, parcelaMax } };
  }
  const maisBarato = Math.min(...(vit.aparelhos || []).map((a) => +a.preco).filter((x) => x > 0), Infinity);
  if (limite >= minLim && limite >= (isFinite(maisBarato) ? maisBarato : 0)) return { status: "PRE_APROVADO", resposta: `Pr\xE9-aprovado para celulares de at\xE9 ${brl3(limite)}${ap ? ` (o ${p.aparelho} passou do seu limite)` : ""}, com entrada a partir de ${entPct}% e parcelas de at\xE9 ${brl3(parcelaMax)}. Agende abaixo e escolha o aparelho na loja.`, auto: { limite, parcelaMax, n } };
  return { status: "RECUSADA", resposta: "Com a renda informada n\xE3o conseguimos aprovar online agora. Se tiver uma entrada maior, passe na loja para conversar.", auto: { limite, parcelaMax } };
}
var erro3 = (msg, status = 400) => Object.assign(new Error(msg), { status });
async function handler14(req, res) {
  if (cors(req, res)) return;
  if (req.method !== "POST") return res.status(405).end();
  try {
    const b = req.body || {};
    if (b.acao === "enviar") {
      const cpf = dig(b.cpf), tel = dig(b.telefone), nasc = String(b.nasc || "");
      if (!cpfOk(cpf)) throw erro3("CPF inv\xE1lido.");
      if (tel.length < 10 || tel.length > 13) throw erro3("WhatsApp com DDD.");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(nasc)) throw erro3("Data de nascimento inv\xE1lida.");
      const idade = Math.floor((Date.now() - new Date(nasc)) / 315576e5);
      if (idade < 18 || idade > 110) throw erro3("\xC9 preciso ter 18 anos ou mais.");
      if (b.aceiteLgpd !== true) throw erro3("Marque a autoriza\xE7\xE3o para continuar.");
      const nome = txt(b.nome, 120);
      if (nome.length < 3) throw erro3("Nome completo.");
      const ini = (/* @__PURE__ */ new Date(hoje() + "T00:00:00-03:00")).getTime();
      const doDia = (await db.collection("preanalises").where("cpf", "==", cpf).get()).docs.filter((d) => (d.data().criadoEm || 0) >= ini).length;
      if (doDia >= 3) throw erro3("Voc\xEA j\xE1 enviou pr\xE9-an\xE1lises hoje. Aguarde o contato da loja.", 429);
      const vit = (await db.collection("publico").doc("vitrine").get()).data() || {};
      const loja = (vit.lojas || []).find((l) => l.id === b.lojaId) || {};
      const dados = {
        nome,
        cpf,
        nasc,
        telefone: tel,
        cidade: txt(b.cidade, 60),
        renda: Math.max(0, Number(b.renda) || 0),
        profissao: txt(b.profissao, 60),
        aparelho: txt(b.aparelho, 120),
        entrada: Math.max(0, Number(b.entrada) || 0),
        lojaId: loja.id || "",
        lojaNome: loja.nome || "",
        aceiteLgpd: true,
        status: "NOVA",
        criadoEm: Date.now(),
        via: b.vendedorUid ? "link do vendedor" : "servidor",
        ...b.vendedorUid ? { vendedorUid: txt(b.vendedorUid, 64), vendedorNome: txt(b.vendedorNome, 80) } : {}
      };
      const cfg = await config();
      if (cfg.preAutomatica !== "nao") {
        try {
          const d = await decidir(dados, vit, cfg);
          Object.assign(dados, { status: d.status, resposta: d.resposta, respondidoEm: Date.now(), respondidoPor: "An\xE1lise autom\xE1tica", auto: d.auto, limite: d.status === "PRE_APROVADO" ? d.auto?.limite || 0 : 0 });
        } catch (e) {
          console.error("decidir", e);
        }
      }
      const ref = await db.collection("preanalises").add(dados);
      return res.status(200).json({ id: ref.id, status: dados.status, resposta: dados.resposta || "", lojaNome: loja.nome || "", lojaTelefone: loja.telefone || "" });
    }
    if (b.acao === "ver" || b.acao === "agendar") {
      const id = String(b.id || "");
      if (!/^[A-Za-z0-9_-]{6,40}$/.test(id)) throw erro3("Pr\xE9-an\xE1lise n\xE3o encontrada.", 404);
      const ref = db.collection("preanalises").doc(id), s = await ref.get();
      if (!s.exists) throw erro3("Pr\xE9-an\xE1lise n\xE3o encontrada.", 404);
      const x = s.data();
      if (b.acao === "agendar") {
        if (x.status !== "PRE_APROVADO") throw erro3("S\xF3 d\xE1 para agendar depois da pr\xE9-aprova\xE7\xE3o.");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.data)) || b.data < hoje() || !/^\d{2}:\d{2}$/.test(String(b.hora))) throw erro3("Escolha o dia e o hor\xE1rio.");
        x.agendamento = { data: b.data, hora: b.hora, em: Date.now() };
        await ref.set({ agendamento: x.agendamento }, { merge: true });
      }
      return res.status(200).json({ id, nome: String(x.nome || "").split(" ")[0], aparelho: x.aparelho || "", lojaNome: x.lojaNome || "", status: x.status, resposta: x.resposta || "", criadoEm: x.criadoEm, agendamento: x.agendamento || null });
    }
    return res.status(400).json({ erro: "a\xE7\xE3o desconhecida" });
  } catch (e) {
    console.error(e);
    return res.status(e.status || 500).json({ erro: e.status ? e.message : "N\xE3o foi poss\xEDvel enviar agora. Tente de novo." });
  }
}

// api/credenciamento.js
var dig2 = (s) => String(s || "").replace(/\D/g, "");
var txt2 = (s, n) => String(s ?? "").replace(/[<>]/g, "").trim().slice(0, n);
var erro4 = (msg, status = 400) => Object.assign(new Error(msg), { status });
var emailOk = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
function cnpjOk(c) {
  c = dig2(c);
  if (c.length !== 14 || /^(\d)\1+$/.test(c)) return false;
  const calc = (n) => {
    const w = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const s = w.reduce((a, x, i) => a + x * +c[i], 0) % 11;
    return s < 2 ? 0 : 11 - s;
  };
  return calc(12) === +c[12] && calc(13) === +c[13];
}
function cpfOk2(c) {
  c = dig2(c);
  if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false;
  for (const t of [9, 10]) {
    let s = 0;
    for (let i = 0; i < t; i++) s += +c[i] * (t + 1 - i);
    if (s * 10 % 11 % 10 !== +c[t]) return false;
  }
  return true;
}
var MARCAS_LOJA = ["Samsung", "Motorola", "Xiaomi", "Redmi", "POCO", "Realme", "Tecno", "Honor", "Infinix", "Outras Android"];
var FOTOS_LOJA = ["fachada", "entrada", "interior", "atendimento", "mesas", "ambiente"];
var BANCO_TIPOS = ["CORRENTE", "PAGAMENTO", "POUPANCA"];
async function consultarCnpj(cnpj) {
  try {
    const r = await fetch("https://brasilapi.com.br/api/cnpj/v1/" + dig2(cnpj), { headers: { accept: "application/json" } });
    if (r.status === 404) return { encontrado: false };
    if (!r.ok) return null;
    const j = await r.json();
    return {
      encontrado: true,
      situacao: String(j.descricao_situacao_cadastral || "").toUpperCase(),
      razao: j.razao_social || "",
      fantasia: j.nome_fantasia || "",
      abertura: j.data_inicio_atividade || "",
      cep: dig2(j.cep),
      uf: j.uf || "",
      cidade: j.municipio || "",
      bairro: j.bairro || "",
      rua: [j.descricao_tipo_de_logradouro, j.logradouro].filter(Boolean).join(" "),
      numero: j.numero || "",
      complemento: j.complemento || "",
      atividade: j.cnae_fiscal_descricao || "",
      em: Date.now()
    };
  } catch (e) {
    return null;
  }
}
function enderecoLimpo(a, ond) {
  const e = { cep: dig2(a.cep).slice(0, 8), uf: txt2(a.uf, 2).toUpperCase(), cidade: txt2(a.cidade, 60), bairro: txt2(a.bairro, 80), rua: txt2(a.rua, 120), numero: txt2(a.numero, 12), complemento: txt2(a.complemento, 60) };
  if (e.cep.length !== 8) throw erro4(`${ond}: CEP com 8 n\xFAmeros.`);
  if (e.uf.length !== 2 || e.cidade.length < 2 || e.bairro.length < 2 || e.rua.length < 3 || !e.numero) throw erro4(`${ond}: preencha o endere\xE7o completo (rua, n\xFAmero, bairro, cidade e UF).`);
  return e;
}
var endTexto = (e) => [e.rua && `${e.rua}, ${e.numero}`, e.complemento, e.bairro].filter(Boolean).join(" \xB7 ");
function pessoaLimpa(g, ond, comCargo) {
  const o = { nome: txt2(g.nome, 120), cpf: dig2(g.cpf), email: txt2(g.email, 120).toLowerCase(), telefone: dig2(g.telefone), ...comCargo ? { cargo: txt2(g.cargo, 60) || "Gerente" } : {} };
  if (o.nome.split(" ").filter(Boolean).length < 2) throw erro4(`${ond}: nome completo.`);
  if (!cpfOk2(o.cpf)) throw erro4(`${ond}: CPF inv\xE1lido.`);
  if (!emailOk(o.email)) throw erro4(`${ond}: e-mail inv\xE1lido.`);
  if (o.telefone.length < 10 || o.telefone.length > 11) throw erro4(`${ond}: telefone com DDD.`);
  return o;
}
var PLANOS_PADRAO = [
  { id: "START", nome: "Start", porLoja: 199, destaque: false, itens: ["Credi\xE1rio com trava do aparelho", "An\xE1lise de cr\xE9dito pela NexumCell", "Cobran\xE7a autom\xE1tica por PIX", "At\xE9 3 vendedores por loja"] },
  { id: "PRO", nome: "Pro", porLoja: 349, destaque: true, itens: ["Tudo do Start", "Vendedores ilimitados", "Comiss\xF5es com comprovante", "Painel da TV e metas", "Suporte priorit\xE1rio no chat"] },
  { id: "REDE", nome: "Rede", porLoja: 299, minimoLojas: 3, destaque: false, itens: ["Tudo do Pro", "A partir de 3 lojas", "Relat\xF3rios da rede", "Gerente de conta"] }
];
async function planos() {
  const c = await config().catch(() => ({}));
  const l = Array.isArray(c.planosLojas) && c.planosLojas.length ? c.planosLojas : PLANOS_PADRAO;
  return { planos: l, adesao: Number(c.saasAdesao) || 0, diasTeste: Number(c.saasDiasTeste ?? 7) || 0, empresa: c.empresa || "NexumCell" };
}
function lojaLimpa(l, i, filial) {
  const n = i + 1, ond = filial || i > 0 ? `Filial ${filial ? "" : i}`.trim() : "Matriz";
  const end = l.rua || l.bairro ? enderecoLimpo(l, ond) : null;
  const loja = {
    tipo: filial || i > 0 ? "FILIAL" : "MATRIZ",
    nome: txt2(l.nome, 80),
    cnpj: dig2(l.cnpj),
    telefone: dig2(l.telefone),
    ...end ? { ...end, endereco: endTexto(end) } : { cep: dig2(l.cep).slice(0, 8), endereco: txt2(l.endereco, 200), cidade: txt2(l.cidade, 60), uf: txt2(l.uf, 2).toUpperCase() },
    gerente: pessoaLimpa(l.gerente || {}, `${ond} \u2014 gerente`, true),
    status: "PENDENTE"
  };
  if (loja.nome.length < 2 || loja.cidade.length < 2) throw erro4(`${ond}: informe o nome de identifica\xE7\xE3o da loja e a cidade.`);
  if (loja.cnpj && !cnpjOk(loja.cnpj)) throw erro4(`${ond}: CNPJ da loja inv\xE1lido.`);
  if (loja.telefone.length < 10 || loja.telefone.length > 11) throw erro4(`${ond}: telefone com DDD.`);
  if (l.geo) {
    const lat = +l.geo.lat, lng = +l.geo.lng;
    if (!(lat >= -34 && lat <= 6 && lng >= -74 && lng <= -32)) throw erro4(`${ond}: a localiza\xE7\xE3o (GPS) n\xE3o est\xE1 no Brasil. Marque de novo.`);
    loja.geo = { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6, via: l.geo.via === "GPS" ? "GPS" : "MAPA", precisao: Math.round(+l.geo.precisao || 0) };
  }
  if (Array.isArray(l.marcas)) {
    loja.marcas = [...new Set(l.marcas.map(String))].filter((m) => MARCAS_LOJA.includes(m));
    if (!loja.marcas.length) throw erro4(`${ond}: marque as marcas de celular que a loja vende.`);
  }
  if (l.vendedoresAgora === true) {
    const vs = (Array.isArray(l.vendedores) ? l.vendedores : []).slice(0, 30);
    if (!vs.length) throw erro4(`${ond}: adicione os vendedores ou marque \u201CN\xE3o\u201D em cadastrar vendedores agora.`);
    loja.vendedores = vs.map((v, j) => ({ ...pessoaLimpa(v, `${ond} \u2014 vendedor ${j + 1}`), status: "PENDENTE" }));
  }
  return loja;
}
function bancoLimpo(b, empresa) {
  const o = {
    banco: txt2(b.banco, 80),
    agencia: dig2(b.agencia).slice(0, 6),
    conta: txt2(b.conta, 20).replace(/[^0-9Xx-]/g, ""),
    tipoConta: BANCO_TIPOS.includes(b.tipoConta) ? b.tipoConta : "CORRENTE",
    titular: empresa.razao,
    titularCnpj: empresa.cnpj,
    pixTipo: "CNPJ",
    pixChave: dig2(b.pixChave)
  };
  if (o.banco.length < 2 || o.agencia.length < 3 || o.conta.replace(/\D/g, "").length < 3) throw erro4("Dados banc\xE1rios: banco, ag\xEAncia e conta.");
  if (dig2(b.titularCnpj || empresa.cnpj) !== empresa.cnpj) throw erro4("A conta precisa estar no CNPJ da empresa cadastrada.");
  if (o.pixChave !== empresa.cnpj) throw erro4("A chave PIX do repasse precisa ser o CNPJ da empresa (" + empresa.cnpj + "). Chaves de CPF, e-mail, telefone ou de terceiros n\xE3o s\xE3o aceitas.");
  return { ...o, validado: false };
}
async function gravarFotos(solId, lojas, fotosIn, exigir) {
  for (const [i, l] of lojas.entries()) {
    const f = (fotosIn || [])[i] || {}, cont = {};
    for (const t of FOTOS_LOJA) {
      const lista = (Array.isArray(f[t]) ? f[t] : []).slice(0, 3).filter((x) => typeof x === "string" && /^data:image\/(jpeg|webp|png);base64,/.test(x));
      for (const x of lista) if (x.length > 7e5) throw erro4(`${l.nome}: uma foto ficou grande demais. Envie de novo.`);
      if (exigir && !lista.length) throw erro4(`${l.nome}: falta a foto \u201C${t}\u201D.`);
      cont[t] = lista.length;
      for (const [j, x] of lista.entries()) await db.collection("lojaFotos").doc(`${solId}_${i}_${t}_${j}`).set({ solicitacaoId: solId, loja: i, tipo: t, n: j, foto: x, criadoEm: Date.now() });
    }
    l.fotos = cont;
  }
}
async function avisarDono(assunto, texto) {
  if (!brevoLigado() || !process.env.DONO_EMAIL) return;
  try {
    await enviarEmail({ para: process.env.DONO_EMAIL, assunto, titulo: assunto, texto });
  } catch (e) {
    console.error("aviso dono", e.message);
  }
}
async function handler15(req, res) {
  if (cors(req, res)) return;
  if (req.method !== "POST") return res.status(405).end();
  try {
    const b = req.body || {};
    if (b.acao === "planos") return res.status(200).json(await planos());
    if (b.acao === "cnpj") {
      if (!cnpjOk(b.cnpj)) throw erro4("CNPJ inv\xE1lido.");
      const r = await consultarCnpj(b.cnpj);
      if (!r) return res.status(200).json({ indisponivel: true });
      return res.status(200).json(r);
    }
    if (b.acao === "enviar") {
      const e = b.empresa || {
        razao: b.razao,
        fantasia: b.fantasia,
        cnpj: b.cnpj,
        telefone: b.telefone,
        cidade: b.cidade,
        uf: b.uf,
        endereco: b.endereco,
        cep: b.cep,
        respNome: b.respNome,
        respCpf: b.respCpf,
        respEmail: b.respEmail,
        respTelefone: b.respTelefone
      };
      const lojasIn = Array.isArray(b.lojas) && b.lojas.length ? b.lojas : [{
        nome: e.fantasia,
        telefone: e.telefone,
        cep: e.cep,
        endereco: e.endereco,
        cidade: e.cidade,
        uf: e.uf,
        gerente: { nome: e.respNome, cpf: e.respCpf, email: e.respEmail, telefone: e.respTelefone }
      }];
      const cnpj = dig2(e.cnpj), email = txt2(e.respEmail, 120).toLowerCase();
      if (!cnpjOk(cnpj)) throw erro4("CNPJ da empresa inv\xE1lido.");
      if (!cpfOk2(e.respCpf)) throw erro4("CPF do respons\xE1vel inv\xE1lido.");
      if (!emailOk(email)) throw erro4("E-mail do respons\xE1vel inv\xE1lido.");
      const end = e.rua || e.bairro ? enderecoLimpo(e, "Endere\xE7o da empresa") : null;
      const empresa = {
        cnpj,
        razao: txt2(e.razao, 140),
        fantasia: txt2(e.fantasia, 80),
        telefone: dig2(e.telefone),
        emailCorp: txt2(e.emailCorp, 120).toLowerCase(),
        ...end ? { ...end, endereco: endTexto(end) } : { cidade: txt2(e.cidade, 60), uf: txt2(e.uf, 2).toUpperCase() },
        respNome: txt2(e.respNome, 120),
        respCpf: dig2(e.respCpf),
        respEmail: email,
        respTelefone: dig2(e.respTelefone)
      };
      if (empresa.emailCorp && !emailOk(empresa.emailCorp)) throw erro4("E-mail corporativo inv\xE1lido.");
      {
        const s0 = await db.collection("solicitacoesLoja").doc("cnpj_" + cnpj).get();
        if (s0.exists && ["PENDENTE", "EM_ANALISE", "APROVADA"].includes(s0.data().status)) throw erro4(s0.data().status === "APROVADA" ? "Esta empresa j\xE1 \xE9 parceira. Para abrir uma filial, use \u201CAdicionar filial\u201D." : "J\xE1 recebemos o cadastro desta empresa. Acompanhe pelo site em \u201CAcompanhar meu cadastro\u201D.", 409);
      }
      const receita = await consultarCnpj(cnpj);
      if (receita && receita.encontrado === false) throw erro4("CNPJ n\xE3o encontrado na Receita Federal.");
      if (receita?.situacao && receita.situacao !== "ATIVA") throw erro4(`O CNPJ est\xE1 ${receita.situacao.toLowerCase()} na Receita Federal. S\xF3 aceitamos empresas com CNPJ ativo.`);
      if (empresa.razao.length < 3 || empresa.fantasia.length < 2 || empresa.respNome.split(" ").length < 2) throw erro4("Preencha raz\xE3o social, nome fantasia e o nome completo do respons\xE1vel.");
      if (lojasIn.length > 30) throw erro4("No m\xE1ximo 30 lojas por cadastro. Fale com a NexumCell para redes maiores.");
      const lojas = lojasIn.map((l, i) => lojaLimpa(l, i, false));
      const emails = lojas.map((l) => l.gerente.email);
      if (new Set(emails).size !== emails.length) throw erro4("Cada loja precisa de um gerente com e-mail diferente.");
      {
        const todos = [...emails, ...lojas.flatMap((l) => (l.vendedores || []).map((v) => v.email))];
        if (new Set(todos).size !== todos.length) throw erro4("Gerentes e vendedores precisam de e-mails diferentes (cada e-mail vira um login).");
      }
      const novo = !!b.banco;
      const banco = novo ? bancoLimpo(b.banco, empresa) : null;
      if (novo && b.lgpd !== true) throw erro4("Aceite o tratamento de dados (LGPD) para continuar.");
      if (b.aceite !== true) throw erro4("Aceite os termos para continuar.");
      const P = await planos(), plano = P.planos.find((p) => p.id === b.plano) || P.planos[0];
      if (plano.minimoLojas && lojas.length < plano.minimoLojas) throw erro4(`O plano ${plano.nome} \xE9 a partir de ${plano.minimoLojas} lojas.`);
      const ref = db.collection("solicitacoesLoja").doc("cnpj_" + cnpj), s = await ref.get();
      if (s.exists && ["PENDENTE", "EM_ANALISE", "APROVADA"].includes(s.data().status)) throw erro4(s.data().status === "APROVADA" ? "Esta empresa j\xE1 \xE9 parceira. Para abrir uma filial, use \u201CAdicionar filial\u201D." : "J\xE1 recebemos o cadastro desta empresa. Acompanhe pelo site em \u201CAcompanhar meu cadastro\u201D.", 409);
      const dados = {
        tipo: "EMPRESA",
        ...empresa,
        fantasia: empresa.fantasia,
        plano: plano.id,
        planoNome: plano.nome,
        porLoja: Number(plano.porLoja) || 0,
        mensalidade: Math.round((Number(plano.porLoja) || 0) * lojas.length * 100) / 100,
        lojas,
        obs: txt2(b.obs, 500),
        aceite: true,
        status: "PENDENTE",
        criadoEm: Date.now(),
        dia: hoje(),
        via: b.via === "site" ? "site" : "link",
        ...banco ? { banco } : {},
        receita: receita || { indisponivel: true, em: Date.now() },
        ...novo ? { lgpdEm: Date.now(), ip: req.headers["cf-connecting-ip"] || "" } : {},
        historico: [{ em: Date.now(), status: "PENDENTE", por: "Site", obs: "Cadastro enviado" }]
      };
      if (novo) await gravarFotos(ref.id, lojas, b.fotos, true);
      await ref.set(dados);
      await avisarDono(
        "Nova empresa pedindo cadastro \u2014 " + empresa.fantasia,
        `${empresa.fantasia} (${empresa.razao}) \xB7 CNPJ ${cnpj}
Plano ${plano.nome} \xB7 ${lojas.length} loja(s)
${lojas.map((l) => `\u2022 ${l.nome} (${l.cidade}) \u2014 gerente ${l.gerente.nome}`).join("\n")}

Aprove no Painel do Dono \u2192 Lojas parceiras.`
      );
      return res.status(200).json({ id: ref.id, status: "PENDENTE", mensalidade: dados.mensalidade });
    }
    if (b.acao === "ver" || b.acao === "filial") {
      const cnpj = dig2(b.cnpj), email = txt2(b.email, 120).toLowerCase();
      const s = await db.collection("solicitacoesLoja").doc("cnpj_" + cnpj).get();
      if (!s.exists || s.data().respEmail !== email) throw erro4("N\xE3o encontramos cadastro com esse CNPJ e e-mail do respons\xE1vel.", 404);
      const x = s.data();
      if (b.acao === "ver") {
        const fil = (await db.collection("solicitacoesLoja").where("cnpj", "==", cnpj).get()).docs.map((d) => d.data()).filter((f) => f.tipo === "FILIAL");
        const unidades = [...x.lojas || [], ...fil.flatMap((f) => (f.lojas || []).map((l) => ({ ...l, status: l.status === "PENDENTE" && f.status !== "PENDENTE" ? f.status : l.status })))].map((l) => ({ nome: l.nome, cidade: l.cidade, gerente: l.gerente?.nome || "", status: l.status || x.status }));
        return res.status(200).json({ fantasia: x.fantasia, status: x.status, plano: x.planoNome || "", resposta: x.resposta || "", criadoEm: x.criadoEm, unidades, historico: (x.historico || []).map((h) => ({ em: h.em, status: h.status, obs: h.obs || "" })) });
      }
      if (x.status !== "APROVADA") throw erro4("A empresa ainda n\xE3o foi aprovada. Depois da aprova\xE7\xE3o voc\xEA pode adicionar filiais.");
      const loja = lojaLimpa(b.loja || {}, 0, true);
      if (!loja.cnpj) throw erro4("Informe o CNPJ da filial.");
      if (loja.cnpj.slice(0, 8) !== cnpj.slice(0, 8)) throw erro4("O CNPJ da filial precisa ser da mesma empresa (mesma raiz do CNPJ da matriz).");
      const id = "f_" + cnpj + "_" + Date.now();
      if (b.fotos) await gravarFotos(id, [loja], [b.fotos], true);
      await db.collection("solicitacoesLoja").doc(id).set({
        tipo: "FILIAL",
        cnpj,
        empresaId: x.empresaId || "e_" + cnpj,
        fantasia: x.fantasia,
        razao: x.razao,
        respNome: x.respNome,
        respEmail: x.respEmail,
        plano: x.plano,
        porLoja: x.porLoja || 0,
        lojas: [loja],
        status: "PENDENTE",
        criadoEm: Date.now(),
        dia: hoje(),
        via: "site",
        historico: [{ em: Date.now(), status: "PENDENTE", por: "Site", obs: "Nova filial" }]
      });
      await avisarDono("Nova filial para aprovar \u2014 " + x.fantasia, `${x.fantasia}: ${loja.nome} (${loja.cidade}) \u2014 gerente ${loja.gerente.nome} (${loja.gerente.email}).

Aprove no Painel do Dono \u2192 Lojas parceiras.`);
      return res.status(200).json({ id, status: "PENDENTE" });
    }
    return res.status(400).json({ erro: "a\xE7\xE3o desconhecida" });
  } catch (e) {
    console.error(e);
    return res.status(e.status || 500).json({ erro: e.status ? e.message : "N\xE3o foi poss\xEDvel enviar agora. Tente de novo." });
  }
}

// api/push.js
async function handler16(req, res) {
  if (cors(req, res)) return;
  if (req.method !== "POST") return res.status(405).end();
  try {
    await exigirEquipe(req, ["DONO", "FINANCEIRO", "SUPORTE", "GERENTE"]);
    const ids = [...new Set((req.body?.ids || []).map(String).filter((x) => /^[A-Za-z0-9_-]{8,64}$/.test(x)))].slice(0, 15);
    let enviados = 0;
    for (const id of ids) if (await pushAparelho(id)) enviados++;
    return res.status(200).json({ ok: true, enviados, total: ids.length });
  } catch (e) {
    return res.status(e.status || 500).json({ erro: e.message });
  }
}

// api/remota.js
var dig3 = (s) => String(s || "").replace(/\D/g, "");
var txt3 = (s, n) => String(s ?? "").replace(/[<>]/g, "").trim().slice(0, n);
var erro5 = (m, s = 400) => Object.assign(new Error(m), { status: s });
var img = (x) => {
  x = String(x || "");
  if (!/^data:image\/(jpeg|png|webp);base64,/.test(x)) return "";
  if (x.length > 32e4) throw erro5("Foto grande demais. Tente de novo.");
  return x;
};
function cpfOk3(c) {
  c = dig3(c);
  if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false;
  for (const t of [9, 10]) {
    let s = 0;
    for (let i = 0; i < t; i++) s += +c[i] * (t + 1 - i);
    if (s * 10 % 11 % 10 !== +c[t]) return false;
  }
  return true;
}
async function acharVenda(token) {
  if (!/^[A-Za-z0-9]{20,40}$/.test(String(token || ""))) throw erro5("Link inv\xE1lido.", 404);
  const q = (await db.collection("vendas").where("remota.token", "==", token).get()).docs;
  if (!q.length) throw erro5("Link inv\xE1lido ou j\xE1 usado.", 404);
  const d = q[0], v = d.data();
  if (Date.now() - (v.remota?.criadoEm || 0) > 7 * 864e5) throw erro5("Este link venceu. Pe\xE7a um novo ao vendedor.", 410);
  return { id: d.id, v };
}
async function handler17(req, res) {
  if (cors(req, res)) return;
  if (req.method !== "POST") return res.status(405).end();
  try {
    const b = req.body || {};
    const { id, v } = await acharVenda(b.token);
    if (b.acao === "ver") return res.status(200).json({ numero: v.numero, nome: v.clienteNome || "", loja: v.lojaNome || "", vendedor: v.vendedorNome || "", status: v.status, enviado: v.status !== "REMOTA" });
    if (b.acao === "enviar") {
      if (v.status !== "REMOTA") throw erro5("Esta proposta j\xE1 foi enviada. Aguarde o contato da loja.", 409);
      const d = b.dados || {}, cpf = dig3(d.cpf);
      if (!cpfOk3(cpf)) throw erro5("CPF inv\xE1lido.");
      if (txt3(d.nome, 120).split(" ").length < 2 || !/^\d{4}-\d{2}-\d{2}$/.test(d.nasc || "")) throw erro5("Informe o nome completo e a data de nascimento.");
      if (txt3(d.mae, 120).split(" ").length < 2) throw erro5("Informe o nome completo da m\xE3e.");
      const tel = dig3(d.telefone);
      if (tel.length < 10) throw erro5("WhatsApp com DDD.");
      if (!(+d.renda > 0)) throw erro5("Informe a renda mensal.");
      for (const k of ["cpf_" + cpf, "tel_" + tel]) {
        const ln = await db.collection("listanegra").doc(k).get();
        if (ln.exists) throw erro5("N\xE3o foi poss\xEDvel seguir com a proposta. Procure a loja.", 403);
      }
      if (b.aceite !== true) throw erro5("Aceite os termos para continuar.");
      const frente = img(b.frente), verso = img(b.verso), selfie = img(b.selfie), mosaico = img(b.mosaico), mov = b.vidaMov == null ? null : Number(b.vidaMov);
      const vida = mov == null ? { ok: null, metodo: "ARQUIVO", via: "REMOTA" } : { ok: mov > 4, metodo: "MOVIMENTO", d: Math.round(mov), via: "REMOTA" };
      if (!frente || !selfie) throw erro5("Envie a foto da frente do documento e a selfie.");
      const agora = Date.now(), tel2 = dig3(d.telefone2), refNome = txt3(d.ref1Nome, 80);
      if (tel2 && tel2 === tel) throw erro5("O telefone da refer\xEAncia precisa ser de outra pessoa.");
      const fone = (t) => t.length === 11 ? `(${t.slice(0, 2)}) ${t.slice(2, 7)}-${t.slice(7)}` : `(${t.slice(0, 2)}) ${t.slice(2, 6)}-${t.slice(6)}`;
      const cliente = {
        ...v.cliente || {},
        cpf,
        nome: txt3(d.nome, 120),
        nasc: d.nasc,
        rg: txt3(d.rg, 30),
        orgao: txt3(d.orgao, 20),
        mae: txt3(d.mae, 120),
        docTipo: txt3(d.docTipo, 5) || "RG",
        tel: fone(tel),
        telefones: [tel, ...tel2.length >= 10 && !refNome ? [tel2] : []],
        ...tel2.length >= 10 && refNome ? { referencias: [{ tel: tel2, nome: refNome, parentesco: txt3(d.ref1Par, 40) }], refNome, refTel: fone(tel2) } : {},
        nacionalidade: txt3(d.nacionalidade, 40),
        email: txt3(d.email, 120).toLowerCase(),
        cep: dig3(d.cep).slice(0, 8),
        endereco: txt3(d.endereco, 160),
        bairro: txt3(d.bairro, 80),
        cidade: txt3(d.cidade, 60),
        uf: txt3(d.uf, 2).toUpperCase(),
        renda: +d.renda,
        profissao: txt3(d.profissao, 80),
        lgpdAceiteEm: agora,
        remoto: true
      };
      for (const t of cliente.telefones) {
        const o = (await db.collection("clientes").where("telefones", "array-contains", t).get()).docs.filter((x) => x.id !== cpf);
        if (o.length) throw erro5("Este telefone j\xE1 est\xE1 cadastrado para outra pessoa. Use o seu n\xFAmero.");
      }
      await db.collection("docs").doc(id).set({ vendaId: id, cpf, docTipo: cliente.docTipo, docDigital: d.docDigital === true, frente, verso, selfie, ...mosaico ? { vidaQuadros: mosaico } : {}, criadoEm: agora, vendedorUid: v.vendedorUid, via: "remota" });
      await db.collection("clientes").doc(cpf).set({ ...cliente, atualizadoEm: agora }, { merge: true });
      await db.collection("vendas").doc(id).set({
        status: "ANALISE",
        clienteCpf: cpf,
        clienteNome: cliente.nome,
        cliente,
        verificacao: { remota: true, docTipo: cliente.docTipo, docDigital: d.docDigital === true, iaLeitura: false, documentoOriginal: true, editados: [], face: null, vida, obs: "Enviado pelo cliente a dist\xE2ncia: confira documento e selfie com aten\xE7\xE3o." },
        confirmacaoDados: { status: "PENDENTE", prazo: agora + 3 * 864e5 },
        remota: { ...v.remota, enviadoEm: agora, ip: req.headers["cf-connecting-ip"] || "" }
      }, { merge: true });
      await db.collection("logs").add({ em: Date.now(), acao: "Cliente enviou a proposta a dist\xE2ncia", alvo: id, det: `n\xBA ${v.numero} \xB7 ${cliente.nome}`, por: "Cliente" });
      try {
        await avaliarVenda(id);
      } catch (e) {
        console.warn("motor", e.message);
      }
      return res.status(200).json({ ok: true, numero: v.numero });
    }
    return res.status(400).json({ erro: "a\xE7\xE3o desconhecida" });
  } catch (e) {
    console.error(e);
    return res.status(e.status || 500).json({ erro: e.status ? e.message : "N\xE3o foi poss\xEDvel enviar agora. Tente de novo." });
  }
}

// api/cliente-app.js
var addDias2 = (iso, n) => {
  const d = /* @__PURE__ */ new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
var erro6 = (m, s = 400) => Object.assign(new Error(m), { status: s });
async function promessa(token, data) {
  const cfg = await config();
  if (cfg.promessaApp === "nao") throw erro6("A promessa de pagamento pelo celular n\xE3o est\xE1 dispon\xEDvel. Fale com a loja.");
  const max = Math.min(10, Math.max(1, Number(cfg.promessaMaxDias) || 5)), h = hoje();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data || "")) || data <= h || data > addDias2(h, max)) throw erro6(`Escolha uma data entre amanh\xE3 e ${max} dia(s) a partir de hoje.`);
  const aref = db.collection("aparelhos").doc(String(token)), as = await aref.get();
  if (!as.exists) throw erro6("Contrato n\xE3o encontrado", 404);
  const ap = as.data();
  if (ap.quitado || ap.status !== "ATIVO") throw erro6("Este contrato n\xE3o est\xE1 ativo.");
  if (ap.promessaApp?.em) throw erro6("Voc\xEA j\xE1 usou a promessa de pagamento neste contrato. Pague pelo PIX ou fale com a loja.", 409);
  if (ap.roubo && !ap.roubo.liberadoEm) throw erro6("Aparelho com roubo/perda comunicado. Fale com a loja.");
  const vref = db.collection("vendas").doc(ap.vendaId), v = (await vref.get()).data();
  if (!v || v.status !== "ATIVA") throw erro6("Este contrato n\xE3o est\xE1 ativo.");
  const atr = (v.parcelas || []).filter((p) => !p.pago && p.venc < h);
  if (!atr.length) throw erro6("Voc\xEA n\xE3o tem parcelas em atraso.");
  const valor = r2(atr.reduce((s, p) => s + encargos(p, ap), 0));
  const ate = Date.parse(data + "T23:59:59-03:00"), em = Date.now();
  await aref.set({ liberadoAte: Math.max(ate, Number(ap.liberadoAte) || 0), promessaApp: { data, valor, em, ate } }, { merge: true });
  const cref = db.collection("cobrancas").doc(ap.vendaId), c = (await cref.get()).data() || {};
  const promessas = (c.promessas || []).map((p) => p.status === "ABERTA" ? { ...p, status: "SUBSTITUIDA", fimEm: em } : p);
  promessas.push({ data, valor, em, por: "Cliente (pelo celular)", status: "ABERTA", origem: "APP" });
  await cref.set({
    vendaId: ap.vendaId,
    numero: v.numero,
    clienteNome: v.clienteNome,
    lojaId: v.lojaId,
    promessas,
    atualizadoEm: em,
    contatos: [...c.contatos || [], { em, canal: "App do cliente", resultado: "Prometeu pagar", obs: `Prometeu pagar ${valor.toFixed(2)} at\xE9 ${data} pelo celular`, por: "Cliente", promessa: data }]
  }, { merge: true });
  await db.collection("logs").add({ em, acao: "Promessa de pagamento pelo celular", alvo: ap.vendaId, det: `at\xE9 ${data} \xB7 R$ ${valor}`, por: "Cliente" });
  await pushAparelho(String(token)).catch(() => {
  });
  return { ok: true, data, valor, liberadoAte: ate };
}
async function handler18(req, res) {
  if (cors(req, res)) return;
  if (req.method !== "POST") return res.status(405).end();
  try {
    const b = req.body || {};
    if (!b.token || String(b.token).length < 16) throw erro6("pedido inv\xE1lido");
    if (b.acao === "promessa") return res.status(200).json(await promessa(b.token, b.data));
    throw erro6("a\xE7\xE3o desconhecida");
  } catch (e) {
    return res.status(e.status || 500).json({ erro: e.status ? e.message : "N\xE3o foi poss\xEDvel agora. Tente de novo." });
  }
}

// api/ios.js
var erro7 = (m, s = 400) => Object.assign(new Error(m), { status: s });
async function handler19(req, res) {
  if (cors(req, res)) return;
  if (req.method !== "POST") return res.status(405).end();
  try {
    const eu = await exigirEquipe(req);
    const b = req.body || {};
    if (b.acao === "status") return res.status(200).json({ ligado: mdmLigado() });
    if (b.acao === "buscar") {
      const d = await acharPorSerie(b.serial);
      if (!d) throw erro7("Este n\xFAmero de s\xE9rie n\xE3o est\xE1 no MDM. Confira se o iPhone foi adicionado ao Apple Business Manager e atribu\xEDdo ao servidor MDM.", 404);
      return res.status(200).json({ id: d.id, nome: d.name || "", modelo: d.model_name || d.product_name || "", status: d.status || "", supervisionado: d.is_supervised === true });
    }
    if (b.acao === "vincular" || b.acao === "sincronizar") {
      const tk = String(b.token || "");
      const ref = db.collection("aparelhos").doc(tk), s = await ref.get();
      if (!s.exists) throw erro7("Contrato do aparelho n\xE3o encontrado.", 404);
      const a = s.data();
      if (!a.ios) throw erro7("Este contrato n\xE3o \xE9 de iPhone.");
      if (eu.role !== "DONO" && eu.role !== "FINANCEIRO" && eu.role !== "SUPORTE" && a.lojaId !== eu.lojaId) throw erro7("Este aparelho \xE9 de outra loja.", 403);
      if (b.acao === "sincronizar") return res.status(200).json(await sincronizarIos(db, tk, a));
      const d = await acharPorSerie(b.serial);
      if (!d) throw erro7("Este n\xFAmero de s\xE9rie n\xE3o est\xE1 no MDM. O iPhone precisa estar no Apple Business Manager da empresa e atribu\xEDdo ao servidor MDM.", 404);
      if (d.is_supervised !== true) throw erro7("O iPhone n\xE3o est\xE1 supervisionado. Sem supervis\xE3o o cliente pode remover a trava: n\xE3o entregue. Restaure o iPhone e fa\xE7a a configura\xE7\xE3o pelo Apple Business Manager.");
      if (String(d.status || "").toLowerCase() !== "enrolled") throw erro7("O iPhone ainda n\xE3o se inscreveu no MDM. Termine a configura\xE7\xE3o inicial no aparelho (tela \u201CGerenciamento remoto\u201D \u2192 Inscrever) com internet e tente de novo.");
      const outro = (await db.collection("aparelhos").where("mdmId", "==", d.id).get()).docs.find((x) => x.id !== tk && !x.data().quitado && x.data().status !== "CANCELADO");
      if (outro) throw erro7("Este iPhone j\xE1 est\xE1 vinculado a outro contrato ativo (n\xBA " + (outro.data().vendaNumero || "") + ").", 409);
      const serial = String(d.serial_number || b.serial).toUpperCase();
      if (d.imei && a.imei && String(d.imei).replace(/\D/g, "") !== String(a.imei)) throw erro7(`O IMEI deste iPhone (${d.imei}) n\xE3o \xE9 o do contrato (${a.imei}). Confira se pegou o aparelho certo.`, 409);
      const agora = Date.now();
      await ref.set({ mdmId: d.id, serial, mdm: { vinculadoEm: agora, vinculadoPor: eu.nome, modelo: d.model_name || "", perdido: false }, checkin: { em: agora, imei: a.imei, deviceOwner: true, modo: "mdm", modelo: d.model_name || "iPhone" } }, { merge: true });
      const vref = db.collection("vendas").doc(a.vendaId), v = (await vref.get()).data() || {};
      if (v.status === "INSTALANDO") {
        await vref.set({ status: "ATIVA", instaladoEm: agora, instalacao: { ...v.instalacao || {}, falha: null, concluidaEm: agora, via: "MDM", serial } }, { merge: true });
        if (v.aparelho?.estoqueId) await db.collection("estoque").doc(v.aparelho.estoqueId).set({ status: "VENDIDO", vendaId: a.vendaId, vendidoEm: agora }, { merge: true });
      }
      await db.collection("logs").add({ em: agora, acao: "iPhone vinculado ao MDM (trava ativa)", alvo: a.vendaId, det: `n\xBA ${a.vendaNumero || ""} \xB7 s\xE9rie ${serial}`, por: eu.nome });
      const r = await sincronizarIos(db, tk, { ...a, mdmId: d.id, mdm: { perdido: false } });
      return res.status(200).json({ ok: true, serial, modelo: d.model_name || "", trava: r, concluida: v.status === "INSTALANDO" });
    }
    throw erro7("a\xE7\xE3o desconhecida");
  } catch (e) {
    console.error(e);
    return res.status(e.status || 500).json({ erro: e.status ? e.message : "N\xE3o foi poss\xEDvel falar com o MDM agora. Tente de novo." });
  }
}

// worker/index.js
var ROTAS = { ios: handler19, codigo, acordo, instalacao: handler8, "cliente-app": handler18, pix: handler, loja: handler2, "pix-automatico": handler3, "asaas-webhook": handler5, assistente: handler6, avisos: handler10, nf: handler11, assinatura: handler12, "zapsign-webhook": handler13, preanalise: handler14, credenciamento: handler15, push: handler16, saas: handler4, motor: handler9, repasse: handler7, remota: handler17 };
function carregarEnv(env2) {
  globalThis.process = globalThis.process || { env: {} };
  globalThis.process.env = globalThis.process.env || {};
  for (const [k, v] of Object.entries(env2 || {})) if (typeof v === "string") globalThis.process.env[k] = v;
}
async function atender(request) {
  const url = new URL(request.url), nome = url.pathname.replace(/^\/api\//, "").replace(/\/$/, "");
  if (url.pathname === "/" || url.pathname === "/api") return new Response("NexumCell: servidor no ar \u2714", { headers: { "content-type": "text/plain; charset=utf-8" } });
  const fn = ROTAS[nome];
  if (!fn) return new Response(JSON.stringify({ erro: "rota n\xE3o existe" }), { status: 404, headers: { "content-type": "application/json" } });
  const headers = {};
  request.headers.forEach((v, k) => {
    headers[k.toLowerCase()] = v;
  });
  let body = {};
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    const t = await request.text();
    try {
      body = t ? JSON.parse(t) : {};
    } catch (e) {
      body = {};
    }
  }
  const req = { method: request.method, headers, body, query: Object.fromEntries(url.searchParams), url: url.pathname + url.search };
  let status = 200, saida = null, feito = false;
  const h = new Headers();
  const res = {
    setHeader: (k, v) => {
      h.set(k, v);
      return res;
    },
    status: (n) => {
      status = n;
      return res;
    },
    json: (o) => {
      h.set("content-type", "application/json; charset=utf-8");
      saida = JSON.stringify(o);
      feito = true;
      return res;
    },
    send: (t) => {
      saida = t;
      feito = true;
      return res;
    },
    end: (t) => {
      if (t !== void 0) saida = t;
      feito = true;
      return res;
    }
  };
  await fn(req, res);
  if (!feito) status = status || 204;
  return new Response(status === 204 ? null : saida, { status, headers: h });
}
var index_default = {
  async fetch(request, env2) {
    carregarEnv(env2);
    try {
      return await atender(request);
    } catch (e) {
      console.error(e);
      return new Response(JSON.stringify({ erro: e.message }), { status: e.status || 500, headers: { "content-type": "application/json" } });
    }
  },
  async scheduled(event, env2, ctx) {
    carregarEnv(env2);
    const qual = event.cron === (env2.CRON_NOITE || "0 22 * * *") ? "noite" : "manha";
    ctx.waitUntil(rotinas(qual).then((r) => console.log("rotina", qual, JSON.stringify(r))).catch((e) => console.error("rotina", qual, e)));
  }
};
export {
  index_default as default
};
