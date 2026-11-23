// NexumCell — servidor em UM arquivo (copiar e colar no Cloudflare: Workers › nexumcell-servidor › Edit code).
// Gerado automaticamente a partir da pasta servidor/. Não edite aqui: edite os arquivos de servidor/ e gere de novo.
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// worker/firebase-rest.js
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
function escrita(nome, dados, modo) {
  const w = { update: { name: nome, fields: campos(dados) } };
  if (modo === "merge" || modo === "update") w.updateMask = { fieldPaths: Object.keys(dados).filter((k) => dados[k] !== void 0).map(caminhoCampo) };
  if (modo === "update") w.currentDocument = { exists: true };
  return w;
}
async function commit(writes, transaction) {
  return rest(`projects/${projeto()}/databases/(default)/documents:commit`, { method: "POST", body: JSON.stringify({ writes, ...transaction ? { transaction } : {} }) });
}
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
async function createUser(dados) {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${projeto()}/accounts`, {
    method: "POST",
    headers: { Authorization: "Bearer " + await tokenAcesso(), "Content-Type": "application/json" },
    body: JSON.stringify({ email: dados.email, password: dados.password, displayName: dados.displayName || void 0 })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error("N\xE3o foi poss\xEDvel criar o login: " + (j.error?.message || r.status)), { code: /EMAIL_EXISTS/.test(j.error?.message || "") ? "auth/email-already-exists" : "" });
  return { uid: j.localId };
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
var conta, b64url, deB64url, pemParaDer, cacheToken, campos, caminhoCampo, caminhoConsulta, autoId, projeto, raiz, base, snap, DocRef, Consulta, firestore, chavesGoogle, admin, firebase_rest_default;
var init_firebase_rest = __esm({
  "worker/firebase-rest.js"() {
    conta = () => {
      const raw = globalThis.process?.env?.FIREBASE_SERVICE_ACCOUNT;
      if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT n\xE3o configurado");
      return typeof raw === "string" ? JSON.parse(raw) : raw;
    };
    b64url = (buf) => {
      const s = typeof buf === "string" ? btoa(unescape(encodeURIComponent(buf))) : btoa(String.fromCharCode(...new Uint8Array(buf)));
      return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    };
    deB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
    pemParaDer = (pem) => Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "")), (c) => c.charCodeAt(0));
    cacheToken = null;
    campos = (o) => Object.fromEntries(Object.entries(o).filter(([, x]) => x !== void 0).map(([k, x]) => [k, paraFs(x)]));
    caminhoCampo = (k) => /^[A-Za-z_][A-Za-z_0-9]*$/.test(k) ? k : "`" + k.replace(/[`\\]/g, (c) => "\\" + c) + "`";
    caminhoConsulta = (k) => String(k).split(".").map(caminhoCampo).join(".");
    autoId = () => {
      const a = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789", b = crypto.getRandomValues(new Uint8Array(20));
      return [...b].map((x) => a[x % 62]).join("");
    };
    projeto = () => conta().project_id;
    raiz = () => `projects/${projeto()}/databases/(default)/documents`;
    base = () => "https://firestore.googleapis.com/v1/";
    snap = (id, doc) => ({ id, exists: !!doc, ref: null, data: () => doc ? deFs({ mapValue: { fields: doc.fields || {} } }) : void 0 });
    DocRef = class {
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
    Consulta = class _Consulta {
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
    firestore = {
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
    chavesGoogle = null;
    admin = {
      apps: [],
      initializeApp() {
        admin.apps.push({});
        return {};
      },
      credential: { cert: (x) => x },
      firestore: () => firestore,
      auth: () => ({ verifyIdToken, updateUser, createUser }),
      messaging: () => ({ send: enviarFcm })
    };
    firebase_rest_default = admin;
  }
});

// api/_ios.js
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
  const lista3 = (j.data || []).map((d) => ({ id: d.id, ...d.attributes }));
  return lista3.find((d) => String(d.serial_number || "").toUpperCase() === s) || null;
}
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
    const dias6 = Math.floor((hoje2 - Date.parse(p.venc)) / DIA);
    if (dias6 > 0) {
      atrasadas++;
      maior = Math.max(maior, dias6);
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
var BASE, DIA, mdmLigado, hojeBR;
var init_ios = __esm({
  "api/_ios.js"() {
    BASE = "https://a.simplemdm.com/api/v1";
    DIA = 864e5;
    mdmLigado = () => !!process.env.SIMPLEMDM_API_KEY;
    hojeBR = () => new Date(Date.now() - 3 * 36e5).toISOString().slice(0, 10);
  }
});

// api/_base.js
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
function encargos(p, ap, data = hoje()) {
  const dias6 = Math.round((new Date(data) - new Date(p.venc)) / 864e5);
  if (dias6 < 0) return r2(p.valor * (1 - (ap.descontoPct || 0) / 100));
  if (dias6 === 0) return p.valor;
  return r2(p.valor * (1 + (ap.multaPct || 0) / 100 + (ap.moraDiaPct || 0) / 100 * dias6));
}
async function baixarParcela(vendaId, n, valorPago, forma, obs, por = "Asaas (autom\xE1tico)") {
  const ref = db.collection("vendas").doc(vendaId);
  let acabouDeQuitar = false;
  await db.runTransaction(async (t) => {
    const s = await t.get(ref);
    if (!s.exists) throw new Error("venda n\xE3o encontrada");
    const v2 = s.data();
    const parcelas = (v2.parcelas || []).map(
      (p) => p.n === n && !p.pago ? { ...p, pago: true, pagoEm: hoje(), valorPago: r2(valorPago), forma, obs, por, baixadoEm: Date.now() } : p
    );
    const quitado = parcelas.every((p) => p.pago);
    acabouDeQuitar = quitado && !v2.quitadoEm;
    t.update(ref, { parcelas, status: quitado ? "QUITADA" : v2.status, ...quitado ? { quitadoEm: Date.now() } : {} });
    if (v2.aparelhoToken) {
      t.update(db.collection("aparelhos").doc(v2.aparelhoToken), {
        parcelas: parcelas.map(paraAparelho),
        quitado,
        status: quitado ? "QUITADO" : "ATIVO"
      });
    }
    t.set(db.collection("logs").doc(), { em: Date.now(), acao: por.startsWith("Asaas") ? "Pagamento autom\xE1tico (Asaas)" : "Baixa de parcela", alvo: vendaId, det: `parcela ${n} \xB7 R$ ${valorPago} \xB7 ${forma}`, por });
  });
  const v = (await ref.get()).data();
  if (v?.aparelhoToken) await pushAparelho(v.aparelhoToken);
  if (acabouDeQuitar && v) {
    v.id = vendaId;
    await preAprovarAoQuitar(v);
  } else if (v && (v.parcelas || []).length >= 2 && (v.parcelas || []).filter((p) => !p.pago).length === 1) {
    const emDia = (v.parcelas || []).filter((p) => p.pago).every((p) => !p.pagoEm || (new Date(String(p.pagoEm).slice(0, 10)) - new Date(p.venc)) / 864e5 <= 3);
    if (emDia && !(v.acordos || []).length) {
      v.id = vendaId;
      await preAprovarAoQuitar(v, "falta s\xF3 a \xFAltima parcela, tudo pago em dia");
    }
  }
}
async function preAprovarAoQuitar(v, motivo = "quitou um contrato") {
  try {
    const cpf = v.clienteCpf;
    const renda = Number(v.cliente?.renda) || 0;
    if (!cpf || !(renda > 0)) return;
    const h = hoje();
    const hist = (await db.collection("vendas").where("clienteCpf", "==", cpf).get()).docs.map((d) => d.data());
    if (hist.some((x) => ["ATIVA", "INSTALANDO"].includes(x.status) && (x.parcelas || []).some((p) => !p.pago && p.venc < h))) return;
    const cfg = (await db.collection("config").doc("sistema").get()).data() || {};
    const mult = Number(cfg.preAprovadoMult) || 2.5;
    const valor = Math.round(Math.min(renda * mult, Number(cfg.preAprovadoMax) || 6e3) / 50) * 50;
    if (!(valor > 0)) return;
    const ate = new Date(Date.now() + 90 * 864e5).toISOString().slice(0, 10);
    const atual = (await db.collection("clientes").doc(cpf).get()).data()?.preAprovado;
    if (atual && atual.ate >= h && Number(atual.valor) >= valor) return;
    const cond = { entradaPct: Math.max(0, Math.min(90, Number(cfg.recompraEntradaPct ?? 20))), descontoPct: Math.max(0, Math.min(50, Number(cfg.recompraDescontoPct ?? 5))) };
    const pre = { valor, ate, em: Date.now(), vendaId: v.id, loja: v.lojaNome || "", motivo, ...cond };
    await db.collection("clientes").doc(cpf).set({ preAprovado: pre }, { merge: true });
    if (v.aparelhoToken) await db.collection("aparelhos").doc(v.aparelhoToken).set({ preAprovado: { valor, ate, em: pre.em, loja: pre.loja, ...cond } }, { merge: true });
    await db.collection("logs").add({ em: Date.now(), acao: "Pr\xE9-aprova\xE7\xE3o do Bom Pagador (" + motivo + ")", alvo: cpf, det: `R$ ${valor} at\xE9 ${ate}`, por: "Sistema" });
  } catch (e) {
    console.warn("preAprovarAoQuitar", e.message);
  }
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
var db, auth, ASAAS, _cofre, asaasLigadoSrv, _cfg, r2, hoje;
var init_base = __esm({
  "api/_base.js"() {
    init_firebase_rest();
    init_ios();
    if (!firebase_rest_default.apps.length && process.env.FIREBASE_SERVICE_ACCOUNT) {
      firebase_rest_default.initializeApp({ credential: firebase_rest_default.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
    }
    db = firebase_rest_default.firestore();
    auth = firebase_rest_default.auth();
    ASAAS = () => process.env.ASAAS_URL || "https://api.asaas.com/v3";
    _cofre = null;
    asaasLigadoSrv = async () => !!(await asaasConf()).chave;
    _cfg = null;
    r2 = (n) => Math.round(n * 100) / 100;
    hoje = () => new Date(Date.now() - 3 * 36e5).toISOString().slice(0, 10);
  }
});

// api/_brevo.js
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
var env, brevoLigado, escHtml, telInter, MODELOS;
var init_brevo = __esm({
  "api/_brevo.js"() {
    env = () => globalThis.process?.env || {};
    brevoLigado = () => !!env().BREVO_API_KEY;
    escHtml = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
    telInter = (t) => {
      const d = String(t || "").replace(/\D/g, "");
      if (!d) return "";
      return d.startsWith("55") && d.length >= 12 ? d : "55" + d;
    };
    MODELOS = {
      lembrete: () => env().BREVO_WA_TEMPLATE_LEMBRETE,
      // parcela vencendo: NOME, VALOR, VENCIMENTO, LINK
      atraso: () => env().BREVO_WA_TEMPLATE_ATRASO,
      // parcela atrasada: NOME, VALOR, DIAS, LINK
      recibo: () => env().BREVO_WA_TEMPLATE_RECIBO,
      // pagamento recebido: NOME, VALOR, PARCELA
      resumo: () => env().BREVO_WA_TEMPLATE_RESUMO
      // resumo do dono: TEXTO
    };
  }
});

// api/erros.js
function codigosNoTexto(t) {
  const s = String(t || ""), achados = /* @__PURE__ */ new Set();
  const so = s.trim().match(/^#?(\d{3,4})$/);
  if (so && ERROS[so[1]]) achados.add(so[1]);
  const rx = /(?:erro|c[oó]d(?:igo)?\.?|cod\.?|apareceu|aparece|mensagem|tela|deu)\D{0,25}?(\d{3,4})\b/gi;
  let m;
  while (m = rx.exec(s)) if (ERROS[m[1]]) achados.add(m[1]);
  return [...achados];
}
function resolucaoTexto(c) {
  const e = ERROS[c];
  if (!e) return "";
  return `C\xF3digo ${c} \u2014 ${e.t}
O que \xE9: ${e.x}

O que fazer:
${e.v.map((p, k) => `${k + 1}. ${p}`).join("\n")}

Passo a passo completo: ${AJUDA_URL}#erro-${c}`;
}
function errosTexto() {
  return Object.entries(ERROS).map(([c, e]) => `- ${c} ${e.t}: ${e.x} O vendedor/gerente faz: ${e.v.join(" ")} Suporte: ${e.chat}${e.cliente ? ' Mensagem para o cliente: "' + e.cliente + '"' : ""}`).join("\n");
}
var ERROS, AJUDA_URL;
var init_erros = __esm({
  "api/erros.js"() {
    ERROS = { "314": { "t": "Vendedor ou gerente suspenso", "g": "acesso", "x": "O acesso foi desativado pela loja ou pela NexumCell.", "v": ["Vendedor: fale com o gerente da sua loja para reativar o seu acesso.", "Gerente: use o chat da tela de acesso restrito para falar com a NexumCell."], "chat": "Confirme quem desativou. Se foi a NexumCell, oriente o gerente a falar pelo chat da tela de bloqueio; se foi a loja, com o gerente dela." }, "315": { "t": "Treinamento obrigat\xF3rio pendente", "g": "acesso", "x": "A pessoa ainda n\xE3o concluiu os m\xF3dulos obrigat\xF3rios do Treinamento.", "v": ["Abra Treinamento no menu.", "Conclua os m\xF3dulos marcados como obrigat\xF3rios, com o teste no final.", "As vendas s\xE3o liberadas assim que voc\xEA terminar."], "chat": "Oriente a concluir o Treinamento (aba Treinamento). As vendas liberam ao terminar." }, "316": { "t": "Sess\xE3o encerrada", "g": "acesso", "x": "A sess\xE3o expirou ou foi aberta em outro aparelho.", "v": ["Entre de novo com o seu ID e a sua senha.", "Use o sistema em um aparelho por vez.", "Se cair de novo, confira a internet e recarregue a p\xE1gina (Ctrl + Shift + R)."], "chat": "Pe\xE7a para entrar de novo. Se persistir, confira a internet." }, "403": { "t": "Venda fora da loja", "g": "venda", "x": "A localiza\xE7\xE3o do notebook n\xE3o bate com a da loja cadastrada.", "v": ["Fa\xE7a a venda dentro da loja, no notebook autorizado.", "Ligue a localiza\xE7\xE3o do navegador: cadeado ao lado do endere\xE7o \u2192 Localiza\xE7\xE3o \u2192 Permitir.", "Recarregue a p\xE1gina e tente de novo."], "chat": "Oriente a fazer a venda dentro da loja, com a localiza\xE7\xE3o do navegador permitida." }, "409": { "t": "Um aparelho por CPF", "g": "venda", "x": "O CPF j\xE1 tem um aparelho financiado em aberto.", "v": ["Explique ao cliente que \xE9 um aparelho por vez, at\xE9 quitar o atual.", "Mostre quanto falta para quitar (Atendimento \u2192 Valor para quitar).", "Caso de bom pagador: s\xF3 o dono pode liberar um segundo aparelho."], "chat": "Explique a regra. S\xF3 com o anterior quitado, ou libera\xE7\xE3o do dono para bom pagador.", "cliente": "Ol\xE1! No momento n\xE3o \xE9 poss\xEDvel um novo financiamento porque j\xE1 existe um aparelho em aberto neste CPF. Assim que ele for quitado, voc\xEA pode financiar outro. Qualquer d\xFAvida, estamos \xE0 disposi\xE7\xE3o." }, "410": { "t": "Cliente na lista negra", "g": "venda", "x": "O CPF ou o telefone do cliente est\xE1 na lista negra.", "v": ["N\xE3o continue a venda.", "Diga ao cliente apenas que a an\xE1lise n\xE3o aprovou neste momento.", "Se o cliente contestar, abra um atendimento aqui."], "chat": "N\xE3o prometa venda. Encaminhe ao dono ou ao financeiro se o cliente contestar." }, "411": { "t": "Cliente menor de 18 anos", "g": "venda", "x": "N\xE3o \xE9 poss\xEDvel contratar cr\xE9dito para menor de idade.", "v": ["Explique com educa\xE7\xE3o que o cr\xE9dito exige 18 anos ou mais.", "A compra pode ser feita no nome de um respons\xE1vel maior de idade, com os documentos dele."], "chat": "Explique com educa\xE7\xE3o que o cr\xE9dito exige maioridade.", "cliente": "Ol\xE1! Para o financiamento \xE9 necess\xE1rio ter 18 anos ou mais. Assim que poss\xEDvel, teremos prazer em atender voc\xEA." }, "412": { "t": "Proposta j\xE1 em andamento", "g": "venda", "x": "J\xE1 existe uma proposta em an\xE1lise ou aprovada para este CPF.", "v": ["N\xE3o crie outra proposta.", "Em Vendas, procure pelo CPF do cliente e abra a proposta com o n\xFAmero informado.", "Continue de onde ela parou."], "chat": "Oriente a continuar a proposta que j\xE1 existe, pelo n\xFAmero informado." }, "413": { "t": "Telefone da equipe no cadastro", "g": "venda", "x": "O telefone informado \xE9 de algu\xE9m da equipe.", "v": ["Troque pelos dois telefones do pr\xF3prio cliente, diferentes entre si.", "Nunca use o seu telefone ou de algu\xE9m da loja: isso \xE9 tratado como fraude."], "chat": "Pe\xE7a dois telefones do pr\xF3prio cliente. Isso \xE9 tratado como fraude." }, "420": { "t": "Aparelho fora do estoque", "g": "venda", "x": "O IMEI informado n\xE3o est\xE1 no estoque da loja.", "v": ["Confira se o IMEI foi digitado certo (na caixa ou discando *#06#).", "Gerente: cadastre o aparelho em Estoque.", "Volte na venda e informe o IMEI de novo."], "chat": "Oriente o gerente a cadastrar o aparelho no estoque antes de vender." }, "421": { "t": "Cidade fora da \xE1rea atendida", "g": "venda", "x": "A cidade do cliente est\xE1 fora da \xE1rea configurada.", "v": ["N\xE3o precisa refazer a proposta.", "Ela segue para an\xE1lise manual da NexumCell: acompanhe o resultado na tela da venda."], "chat": "A proposta vai para an\xE1lise manual da NexumCell; aguarde o parecer." }, "515": { "t": "Parcela em atraso: aparelho bloqueado", "g": "pagamento", "x": "H\xE1 parcela vencida al\xE9m da toler\xE2ncia e o aparelho travou.", "v": ["O cliente paga pelo Pix no app NexumCell (aba Parcelas).", "Pagando, o aparelho libera sozinho em poucos minutos.", 'Se ele j\xE1 pagou: pe\xE7a para ligar a internet e tocar em "J\xE1 paguei \u2014 verificar agora".', "Se ainda assim n\xE3o liberar, chame o atendente aqui com o n\xFAmero do contrato."], "chat": 'Confirme a parcela em atraso. Oriente a pagar pelo Pix no app; ao registrar, o aparelho libera sozinho. Se j\xE1 pagou, pe\xE7a para abrir o app com internet e tocar em "J\xE1 paguei".', "cliente": "Ol\xE1! Seu aparelho foi bloqueado porque h\xE1 uma parcela em atraso. Assim que o pagamento for feito pelo Pix no app NexumCell (aba Parcelas), ele \xE9 liberado em poucos minutos." }, "516": { "t": "Aparelho sem internet h\xE1 muitos dias", "g": "pagamento", "x": "O aparelho ficou muitos dias sem conex\xE3o e travou por seguran\xE7a.", "v": ["Pe\xE7a ao cliente para ligar o Wi-Fi ou os dados m\xF3veis.", "Abrir o app NexumCell uma vez: ele libera sozinho.", "Se o cliente estiver sem internet nenhuma, chame o atendente aqui para receber um c\xF3digo de libera\xE7\xE3o."], "chat": "Pe\xE7a para ligar o Wi-Fi ou os dados e abrir o app uma vez. Se n\xE3o liberar, gere um c\xF3digo de libera\xE7\xE3o tempor\xE1ria.", "cliente": "Ol\xE1! Seu aparelho ficou muitos dias sem conex\xE3o e foi bloqueado por seguran\xE7a. \xC9 s\xF3 ligar o Wi-Fi ou os dados m\xF3veis e abrir o app NexumCell que ele libera sozinho." }, "517": { "t": "Promessa de pagamento quebrada", "g": "pagamento", "x": "A data prometida passou sem pagamento e o aparelho travou de novo.", "v": ["O cliente precisa pagar a parcela pelo Pix no app para liberar.", "Uma nova promessa s\xF3 com autoriza\xE7\xE3o do financeiro: chame o atendente aqui."], "chat": "Oriente a pagar. N\xE3o h\xE1 segunda promessa no mesmo contrato sem autoriza\xE7\xE3o.", "cliente": "Ol\xE1! A data de pagamento que combinamos passou e o aparelho foi bloqueado novamente. Assim que a parcela for paga, ele \xE9 liberado na hora." }, "600": { "t": "Cr\xE9dito reprovado", "g": "credito", "x": "A an\xE1lise de cr\xE9dito reprovou pelas regras.", "v": ["Explique com educa\xE7\xE3o que o cr\xE9dito n\xE3o foi aprovado desta vez.", "O cliente pode tentar de novo depois de 30 dias.", "N\xE3o prometa aprova\xE7\xE3o."], "chat": "Explique com educa\xE7\xE3o que pode tentar de novo depois de 30 dias.", "cliente": "Ol\xE1! Infelizmente n\xE3o foi poss\xEDvel aprovar o financiamento desta vez. Voc\xEA pode tentar novamente ap\xF3s 30 dias. Agradecemos o interesse!" }, "601": { "t": "Renda insuficiente para a parcela", "g": "credito", "x": "A parcela passa do limite de comprometimento da renda.", "v": ["Ofere\xE7a uma entrada maior, mais parcelas ou um aparelho mais barato.", "Simule de novo: o Assistente da venda mostra quando a parcela cabe."], "chat": "Sugira aumentar a entrada, mais parcelas ou um aparelho mais barato." }, "602": { "t": "Documento irregular", "g": "credito", "x": "O documento est\xE1 ileg\xEDvel, editado ou vencido.", "v": ["Tire novas fotos do documento original, frente e verso.", "Sem reflexo, sem cortar as bordas e com a c\xE2mera parada.", "A proposta vai para an\xE1lise manual."], "chat": "Pe\xE7a novas fotos do documento original; a proposta vai para an\xE1lise manual." }, "900": { "t": "Acesso bloqueado pela NexumCell", "g": "acesso", "x": "O dono bloqueou este acesso.", "v": ["Fale com a NexumCell pelo chat da tela de bloqueio."], "chat": "Oriente a falar com a NexumCell pelo chat da tela de bloqueio." }, "1001": { "t": "Loja bloqueada", "g": "loja", "x": "A NexumCell bloqueou a loja.", "v": ["O gerente fala com a NexumCell pelo chat da tela de bloqueio.", "Os contratos dos clientes continuam funcionando normalmente."], "chat": "O gerente fala com a NexumCell pelo chat da tela de bloqueio. Os contratos dos clientes continuam normalmente." }, "1002": { "t": "Loja bloqueada por mensalidade", "g": "loja", "x": "A mensalidade da loja est\xE1 atrasada.", "v": ["O gerente paga a mensalidade em Licen\xE7as.", "A loja desbloqueia assim que o pagamento cair."], "chat": "Oriente o pagamento da mensalidade; a loja desbloqueia na hora." }, "1003": { "t": "Loja acima do limite de carteira", "g": "loja", "x": "A loja passou do teto de carteira em aberto.", "v": ["Continue vendendo normalmente.", "As novas vendas v\xE3o para an\xE1lise manual at\xE9 a carteira baixar, ent\xE3o a aprova\xE7\xE3o pode demorar um pouco mais."], "chat": "Novas vendas v\xE3o para an\xE1lise manual at\xE9 reduzir a carteira." }, "1004": { "t": "Loja acima da inadimpl\xEAncia", "g": "loja", "x": "A inadimpl\xEAncia da loja passou do limite.", "v": ["As novas vendas v\xE3o para an\xE1lise manual.", "Ajude a cobrar os clientes em atraso pela Fila de cobran\xE7a."], "chat": "Novas vendas v\xE3o para an\xE1lise manual; oriente a loja a cobrar os atrasos." }, "1005": { "t": "Loja sem licen\xE7as", "g": "loja", "x": "A loja n\xE3o tem saldo de licen\xE7as para a venda (1 licen\xE7a a cada 12 parcelas).", "v": ["A proposta fica salva: n\xE3o precisa refazer.", "O gerente compra mais licen\xE7as no menu Licen\xE7as.", "Assim que o pagamento cair, a venda \xE9 liberada."], "chat": "Oriente o gerente a comprar licen\xE7as no menu Licen\xE7as; a venda libera assim que o pagamento cai." }, "1010": { "t": "A trava n\xE3o subiu", "g": "trava", "x": "A instala\xE7\xE3o da trava n\xE3o concluiu.", "v": ["Confira se o celular foi restaurado de f\xE1brica, sem conta Google.", "Conecte no Wi-Fi da loja.", "Na tela de boas-vindas, toque 6 vezes e leia o QR da venda de novo.", 'Se aparecer "app bloqueado para proteger o dispositivo", instale pelo computador (USB).', "Nunca entregue o aparelho sem a trava confirmada (tela verde)."], "chat": "Oriente a refazer pelo QR ou instalar pelo computador (USB). Nunca entregar o aparelho sem a trava." }, "1011": { "t": "IMEI irregular", "g": "trava", "x": "O IMEI lido no aparelho n\xE3o \xE9 o do contrato.", "v": ["Confira se pegou o aparelho certo no estoque (IMEI na caixa e discando *#06#).", "N\xE3o entregue o aparelho.", "Chame o atendente aqui para corrigir o contrato."], "chat": "O aparelho foi bloqueado. Oriente a conferir se pegou o aparelho certo do estoque." }, "1012": { "t": "A trava n\xE3o confirmou", "g": "trava", "x": "O aparelho n\xE3o confirmou a trava a tempo.", "v": ["Deixe o celular no Wi-Fi e abra o app NexumCell uma vez.", "Espere 1 ou 2 minutos: a tela da venda fica verde quando confirmar.", "Se n\xE3o confirmar em 10 minutos, chame o atendente aqui."], "chat": "Pe\xE7a para conferir o Wi-Fi e abrir o app uma vez; a tela da venda fica verde ao confirmar." }, "1013": { "t": "Sem resposta do servidor", "g": "trava", "x": "O servidor n\xE3o respondeu durante a opera\xE7\xE3o.", "v": ["Espere 2 minutos e tente de novo.", "Veja em Ajuda e status se o servidor est\xE1 verde.", "Se continuar, mande aqui o c\xF3digo e um print da tela."], "chat": "Pe\xE7a para tentar de novo em alguns minutos; confira o Status do sistema na Ajuda." } };
    AJUDA_URL = "https://nexumrh.github.io/gerente/ajuda.html";
  }
});

// api/crm-rotinas.js
var crm_rotinas_exports = {};
__export(crm_rotinas_exports, {
  autoEncerrar: () => autoEncerrar,
  avisoPrioridade: () => avisoPrioridade,
  exemplosBons: () => exemplosBons,
  lembretePesquisa: () => lembretePesquisa,
  relatorioDiarioCrm: () => relatorioDiarioCrm
});
async function relatorioDiarioCrm(cfg = {}, forcar = false) {
  if (cfg.relCrmDiario === "nao") return { relDiario: "desligado" };
  const h = hoje(), ref = db.collection("relatoriosCrm").doc(h);
  if (!forcar && (await ref.get()).exists) return { relDiario: "j\xE1 feito hoje" };
  const ini = (/* @__PURE__ */ new Date(h + "T00:00:00-03:00")).getTime();
  const [at, ch, atr, av, wa, app, mk] = await Promise.all([lista2("atendimentos", "atualizadoEm", ini), lista2("chamados", "criadoEm", ini), lista2("crmAtrib", "em", ini - 7 * 864e5), lista2("crmAvaliacoes", "em", ini), lista2("waConversas", "atualizadoEm", ini), lista2("suporteApp", "atualizadoEm", ini), lista2("crmMarcas", "atualizadoEm", ini)]);
  const humanos = at.filter((a) => a.status !== "BOT" && (a.encaminhadoEm || 0) >= ini);
  const tempos = humanos.map((a) => {
    const r = (a.msgs || []).find((m) => m.de === "atendente" && !m.auto && (+m.em || 0) >= (+a.encaminhadoEm || 0));
    return r ? (r.em - a.encaminhadoEm) / 6e4 : null;
  }).filter((x) => x != null && x >= 0);
  const tmr = tempos.length ? tempos.reduce((s, x) => s + x, 0) / tempos.length : null;
  const resolvidosBot = at.filter((a) => (a.criadoEm || 0) >= ini && a.status === "CONCLUIDO" && !a.encaminhadoEm).length;
  const fin = atr.filter((a) => (a.finalizadoEm || 0) >= ini), porAt = {};
  fin.forEach((a) => {
    const k = a.finalizadoPor || a.nome || "\u2014";
    (porAt[k] ||= { fin: 0, notas: [] }).fin++;
  });
  av.forEach((a) => {
    const k = a.nome || "\u2014";
    (porAt[k] ||= { fin: 0, notas: [] }).notas.push(+a.nota || 0);
  });
  const media = av.length ? av.reduce((s, a) => s + (+a.nota || 0), 0) / av.length : null;
  const erros = {};
  at.forEach((a) => (a.codigos || []).forEach((c) => {
    erros[c] = (erros[c] || 0) + 1;
  }));
  const errosLoja = {};
  at.forEach((a) => (a.codigos || []).forEach((c) => {
    const k = `${a.lojaNome || "Sem loja"} \xB7 ${c}`;
    errosLoja[k] = (errosLoja[k] || 0) + 1;
  }));
  const prioridade = mk.filter((a) => a.prioridade && (a.prioridadeEm || 0) >= ini).length;
  const dados = {
    data: h,
    em: Date.now(),
    chatsPortais: at.filter((a) => (a.criadoEm || 0) >= ini).length,
    comEquipe: humanos.length,
    resolvidosAssistente: resolvidosBot,
    chamados: ch.length,
    whatsapp: wa.length,
    app: app.length,
    finalizados: fin.length,
    tmrMin: tmr == null ? null : Math.round(tmr * 10) / 10,
    notaMedia: media == null ? null : Math.round(media * 10) / 10,
    avaliacoes: av.length,
    prioridade,
    porAtendente: Object.entries(porAt).map(([nome, v]) => ({ nome, finalizados: v.fin, avaliacoes: v.notas.length, media: v.notas.length ? Math.round(v.notas.reduce((s, x) => s + x, 0) / v.notas.length * 10) / 10 : null })).sort((a, b) => b.finalizados - a.finalizados),
    erros: Object.entries(erros).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([c, n]) => ({ c, n, t: ERROS[c]?.t || "" })),
    errosLoja: Object.entries(errosLoja).filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => ({ k, n }))
  };
  await ref.set(dados);
  if (brevoLigado() && process.env.DONO_EMAIL) {
    const tr = (a, b) => `<tr><td style="padding:5px 10px 5px 0;color:#5B6478">${a}</td><td style="padding:5px 0;text-align:right"><b>${b}</b></td></tr>`;
    const html = `<div style="font-family:Arial,sans-serif;color:#0A1733;max-width:640px"><h2 style="margin:0 0 4px">Atendimento de hoje \xB7 ${h.split("-").reverse().join("/")}</h2><p style="color:#5B6478;margin:0 0 14px">Resumo autom\xE1tico do CRM da NexumCell.</p>
      <table style="width:100%;border-collapse:collapse;margin-bottom:14px">${tr("Chats dos portais abertos", dados.chatsPortais)}${tr("Resolvidos s\xF3 pela assistente", dados.resolvidosAssistente)}${tr("Passaram para a equipe", dados.comEquipe)}${tr("Tempo m\xE9dio at\xE9 a 1\xAA resposta", minFmt(dados.tmrMin))}${tr("Chamados", dados.chamados)}${tr("Conversas no WhatsApp", dados.whatsapp)}${tr("Finalizados", dados.finalizados)}${tr("Nota m\xE9dia", dados.notaMedia == null ? "\u2014" : dados.notaMedia + " de 5 (" + dados.avaliacoes + ")")}${tr("Marcados como prioridade", dados.prioridade)}</table>
      <h3 style="margin:0 0 6px;font-size:15px">Quem atendeu</h3><table style="width:100%;margin-bottom:14px">${dados.porAtendente.map((p) => tr(p.nome, `${p.finalizados} finalizado(s) \xB7 nota ${p.media ?? "\u2014"}`)).join("") || tr("Ningu\xE9m finalizou atendimentos hoje", "")}</table>
      <h3 style="margin:0 0 6px;font-size:15px">Erros mais comuns</h3><table style="width:100%;margin-bottom:14px">${dados.erros.map((e) => tr(`${e.c} \xB7 ${e.t}`, e.n)).join("") || tr("Nenhum c\xF3digo de erro hoje", "")}</table>
      ${dados.errosLoja.length ? `<h3 style="margin:0 0 6px;font-size:15px">Erros repetidos na mesma loja</h3><table style="width:100%">${dados.errosLoja.map((e) => tr(e.k, e.n + "x")).join("")}</table>` : ""}</div>`;
    try {
      await enviarEmail({ para: process.env.DONO_EMAIL, assunto: `Atendimento de hoje: ${dados.chatsPortais + dados.chamados + dados.whatsapp} contatos, nota ${dados.notaMedia ?? "\u2014"}, 1\xAA resposta em ${minFmt(dados.tmrMin)}`, html });
    } catch (e) {
      console.error("reldiario email", e.message);
    }
  }
  return { relDiario: "feito" };
}
async function lembretePesquisa() {
  const agora = Date.now();
  let n = 0;
  const l = await lista2("atendimentos", "concluidoEm", agora - 48 * 36e5);
  for (const a of l) {
    if (a.status !== "CONCLUIDO" || a.pesquisa || a.lembretePesquisaEm || (a.concluidoEm || 0) > agora - 24 * 36e5) continue;
    if (!(a.msgs || []).some((m) => m.de === "atendente" && !m.auto)) continue;
    await db.collection("atendimentos").doc(a.id).set({ lembretePesquisaEm: agora, naoLidoUser: true, msgs: [...a.msgs || [], { de: "bot", t: "Voc\xEA ainda n\xE3o avaliou este atendimento. Leva 5 segundos: escolha as estrelas logo abaixo. Sua nota ajuda a melhorar o suporte.", em: agora }] }, { merge: true });
    n++;
  }
  return { lembretesPesquisa: n };
}
async function avisoPrioridade() {
  if (!brevoLigado() || !process.env.DONO_EMAIL) return { prioridade: "sem e-mail" };
  const l = (await lista2("crmMarcas", "atualizadoEm", Date.now() - 6 * 36e5)).filter((a) => a.prioridade && (a.prioridadeEm || 0) > Date.now() - 6 * 36e5 && !a.prioridadeAvisadoEm);
  if (!l.length) return { prioridade: 0 };
  const linhas = l.slice(0, 10).map((a) => `<li><b>${a.prioridadeNome || a.key}</b> \xB7 ${a.prioridadeMotivo || "prioridade alta"}</li>`).join("");
  await enviarEmail({ para: process.env.DONO_EMAIL, assunto: `${l.length} atendimento(s) com prioridade alta no CRM`, html: `<div style="font-family:Arial,sans-serif;color:#0A1733"><h2 style="margin:0 0 8px">Atendimentos que pedem aten\xE7\xE3o</h2><p style="color:#5B6478">Pessoa irritada ou urg\xEAncia alta. Eles j\xE1 est\xE3o no topo da fila do CRM.</p><ul>${linhas}</ul></div>` });
  for (const a of l) await db.collection("crmMarcas").doc(a.id).set({ prioridadeAvisadoEm: Date.now() }, { merge: true });
  return { prioridade: l.length };
}
async function exemplosBons() {
  if (_ex && _ex.em > Date.now() - 15 * 6e4) return _ex.t;
  let t = "";
  try {
    const av = (await db.collection("crmAvaliacoes").where("nota", "==", 5).limit(40).get()).docs.map((d) => d.data()).filter((a) => a.canal === "portal" && a.key).sort((a, b) => b.em - a.em).slice(0, 8);
    const ex = [];
    for (const a of av) {
      const s = await db.collection("atendimentos").doc(String(a.key).replace(/^portal:/, "")).get();
      if (!s.exists) continue;
      const ms = s.data().msgs || [];
      const perg = ms.filter((m) => m.de === "user").slice(-1)[0]?.t, resp = ms.filter((m) => m.de === "atendente" && !m.auto).slice(-2).map((m) => m.t).join(" ");
      if (perg && resp) ex.push(`Pergunta: ${String(perg).slice(0, 200)}
Resposta que recebeu nota 5: ${String(resp).slice(0, 400)}`);
      if (ex.length >= 5) break;
    }
    t = ex.length ? "Exemplos de respostas da equipe que receberam nota 5 (siga o mesmo tom e o mesmo n\xEDvel de detalhe):\n" + ex.join("\n---\n") : "";
  } catch (e) {
    t = "";
  }
  _ex = { em: Date.now(), t };
  return t;
}
async function autoEncerrar() {
  const agora = Date.now();
  let n = 0;
  for (const d of (await db.collection("atendimentos").where("status", "==", "HUMANO").get()).docs) {
    const a = d.data(), ms = (a.msgs || []).filter((m) => !m.auto && m.de !== "bot"), u = ms[ms.length - 1];
    if (!u || u.de !== "atendente" || (+u.em || 0) > agora - 24 * 36e5) continue;
    await d.ref.set({
      status: "CONCLUIDO",
      concluidoEm: agora,
      concluidoPor: "Encerramento autom\xE1tico",
      naoLidoUser: true,
      atualizadoEm: agora,
      msgs: [...a.msgs || [], { de: "bot", t: "Como n\xE3o tivemos resposta nas \xFAltimas 24 horas, encerramos este atendimento. Se ainda precisar de ajuda, \xE9 s\xF3 abrir um novo chat. Antes, avalie como foi o atendimento logo abaixo.", em: agora, auto: true }]
    }, { merge: true });
    n++;
  }
  return { autoEncerrados: n };
}
var lista2, minFmt, _ex;
var init_crm_rotinas = __esm({
  "api/crm-rotinas.js"() {
    init_base();
    init_brevo();
    init_erros();
    lista2 = async (c, campo, desde) => (await db.collection(c).where(campo, ">=", desde).get()).docs.map((d) => ({ id: d.id, ...d.data() }));
    minFmt = (m) => m == null ? "\u2014" : m < 60 ? Math.round(m) + " min" : Math.floor(m / 60) + " h " + String(Math.round(m % 60)).padStart(2, "0");
    _ex = null;
  }
});

// api/pix.js
init_base();
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
init_base();
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
init_base();
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

// api/emprestimo.js
init_base();

// api/ia-autonoma.js
init_base();

// api/preanalise.js
init_base();
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
var brl = (n) => "R$ " + Number(n || 0).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
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
  let limite2 = r2(parcelaMax * n / (1 + juros / 100 - entPct / 100));
  if (maxLim > 0) limite2 = Math.min(limite2, maxLim);
  const quitou = hist.some((v) => v.status === "QUITADA");
  if (ap) {
    const entMin = r2(ap.preco * entPct / 100), ent = Math.max(p.entrada || 0, entMin);
    const parcela = r2((ap.preco * (1 + juros / 100) - ent) / n);
    if (parcela <= parcelaMax && (!maxLim || ap.preco <= maxLim))
      return { status: "PRE_APROVADO", resposta: `Pr\xE9-aprovado! ${p.aparelho}: entrada de ${brl(ent)} + ${n}x de ${brl(parcela)}.${(p.entrada || 0) < entMin ? ` (A entrada m\xEDnima \xE9 ${brl(entMin)}.)` : ""}${quitou ? " Obrigado por voltar!" : ""} Agende abaixo e traga RG ou CNH.`, auto: { parcela, entrada: ent, n, limite: limite2, parcelaMax } };
  }
  const maisBarato = Math.min(...(vit.aparelhos || []).map((a) => +a.preco).filter((x) => x > 0), Infinity);
  if (limite2 >= minLim && limite2 >= (isFinite(maisBarato) ? maisBarato : 0)) return { status: "PRE_APROVADO", resposta: `Pr\xE9-aprovado para celulares de at\xE9 ${brl(limite2)}${ap ? ` (o ${p.aparelho} passou do seu limite)` : ""}, com entrada a partir de ${entPct}% e parcelas de at\xE9 ${brl(parcelaMax)}. Agende abaixo e escolha o aparelho na loja.`, auto: { limite: limite2, parcelaMax, n } };
  return { status: "RECUSADA", resposta: "Com a renda informada n\xE3o conseguimos aprovar online agora. Se tiver uma entrada maior, passe na loja para conversar.", auto: { limite: limite2, parcelaMax } };
}
var erro = (msg, status = 400) => Object.assign(new Error(msg), { status });
async function handler4(req, res) {
  if (cors(req, res)) return;
  if (req.method !== "POST") return res.status(405).end();
  try {
    const b = req.body || {};
    if (b.acao === "enviar") {
      const cpf = dig(b.cpf), tel = dig(b.telefone), nasc = String(b.nasc || "");
      if (!cpfOk(cpf)) throw erro("CPF inv\xE1lido.");
      if (tel.length < 10 || tel.length > 13) throw erro("WhatsApp com DDD.");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(nasc)) throw erro("Data de nascimento inv\xE1lida.");
      const idade = Math.floor((Date.now() - new Date(nasc)) / 315576e5);
      if (idade < 18 || idade > 110) throw erro("\xC9 preciso ter 18 anos ou mais.");
      if (b.aceiteLgpd !== true) throw erro("Marque a autoriza\xE7\xE3o para continuar.");
      const nome = txt(b.nome, 120);
      if (nome.length < 3) throw erro("Nome completo.");
      const ini = (/* @__PURE__ */ new Date(hoje() + "T00:00:00-03:00")).getTime();
      const doDia = (await db.collection("preanalises").where("cpf", "==", cpf).get()).docs.filter((d) => (d.data().criadoEm || 0) >= ini).length;
      if (doDia >= 3) throw erro("Voc\xEA j\xE1 enviou pr\xE9-an\xE1lises hoje. Aguarde o contato da loja.", 429);
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
        ...b.vendedorUid ? { vendedorUid: txt(b.vendedorUid, 64), vendedorNome: txt(b.vendedorNome, 80) } : {},
        .../^N[A-Z]{7}$/.test(String(b.indicadoPor || "")) ? { indicadoPor: b.indicadoPor } : {}
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
      if (!/^[A-Za-z0-9_-]{6,40}$/.test(id)) throw erro("Pr\xE9-an\xE1lise n\xE3o encontrada.", 404);
      const ref = db.collection("preanalises").doc(id), s = await ref.get();
      if (!s.exists) throw erro("Pr\xE9-an\xE1lise n\xE3o encontrada.", 404);
      const x = s.data();
      if (b.acao === "agendar") {
        if (x.status !== "PRE_APROVADO") throw erro("S\xF3 d\xE1 para agendar depois da pr\xE9-aprova\xE7\xE3o.");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.data)) || b.data < hoje() || !/^\d{2}:\d{2}$/.test(String(b.hora))) throw erro("Escolha o dia e o hor\xE1rio.");
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

// api/ia-autonoma.js
init_base();
var MODELO = process.env.GROQ_MODELO_AUTONOMA || "llama-3.3-70b-versatile";
var dias = (a, b) => Math.round((/* @__PURE__ */ new Date(String(b).slice(0, 10) + "T12:00:00") - /* @__PURE__ */ new Date(String(a).slice(0, 10) + "T12:00:00")) / 864e5);
var POR = "IA NexumCell";
var _chave = null;
async function chaveIA() {
  if (_chave && _chave.em > Date.now() - 3e5) return _chave.v;
  let v = process.env.GROQ_API_KEY_2 || "";
  if (!v) {
    try {
      v = (await db.collection("segredos").doc("ia").get()).data()?.chave || "";
    } catch (e) {
      v = "";
    }
  }
  if (!v) v = process.env.GROQ_API_KEY || (await config()).iaChave || "";
  _chave = { em: Date.now(), v };
  return v;
}
async function parecerIA(tarefa, dados) {
  const chave = await chaveIA();
  if (!chave) return null;
  try {
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer " + chave, "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODELO, temperature: 0.1, max_tokens: 300, response_format: { type: "json_object" }, messages: [
        { role: "system", content: 'Voc\xEA \xE9 o analista de risco da NexumCell, financeira de celulares com trava para clientes negativados. Responda SOMENTE em JSON {"parecer":"at\xE9 2 frases em portugu\xEAs do Brasil, objetivas","risco":"baixo|medio|alto"}. Use s\xF3 os dados recebidos; n\xE3o invente.' },
        { role: "user", content: tarefa + "\nDADOS: " + JSON.stringify(dados).slice(0, 6e3) }
      ] })
    });
    if (!r.ok) return null;
    const j = await r.json();
    return JSON.parse(j.choices?.[0]?.message?.content || "{}");
  } catch (e) {
    return null;
  }
}
function historico(v) {
  const ps = v.parcelas || [], pagas = ps.filter((p) => p.pago), h = hoje();
  const emDia = pagas.filter((p) => !p.pagoEm || dias(p.venc, p.pagoEm) <= 3).length;
  const atr = ps.filter((p) => !p.pago && p.venc < h), diasAtr = atr.length ? dias(atr.sort((a, b) => a.venc.localeCompare(b.venc))[0].venc, h) : 0;
  return { total: ps.length, pagas: pagas.length, emDiaPct: pagas.length ? Math.round(emDia / pagas.length * 100) : 0, diasAtraso: diasAtr, parcelasAtraso: atr.length, acordos: (v.acordos || []).length };
}
async function regraAprovacao(x) {
  const d = x.dados || {};
  if (x.tipo === "LIB24H") {
    const ap = (await db.collection("aparelhos").doc(String(x.alvo)).get()).data();
    if (!ap) return ["DUVIDA", "aparelho n\xE3o encontrado"];
    const v = ap.vendaId ? (await db.collection("vendas").doc(ap.vendaId).get()).data() : null;
    if (!v) return ["DUVIDA", "contrato n\xE3o encontrado"];
    const h = historico(v), ult = Number(ap.ultimaLib24h) || 0;
    if (ap.roubo && !ap.roubo.liberadoEm) return ["RECUSADA", "aparelho com roubo/perda comunicado"];
    if (Date.now() - ult < 30 * 864e5) return ["RECUSADA", "j\xE1 teve uma libera\xE7\xE3o de 24 h nos \xFAltimos 30 dias"];
    if (h.diasAtraso > 20) return ["RECUSADA", `atraso de ${h.diasAtraso} dias: acima do limite para liberar`];
    if (h.pagas >= 1 && h.emDiaPct >= 60 && h.diasAtraso <= 10) return ["APROVADA", `bom pagador (${h.emDiaPct}% em dia), atraso de ${h.diasAtraso} dia(s)`, { v, h }];
    return ["DUVIDA", `hist\xF3rico curto ou irregular (${h.pagas} paga(s), ${h.emDiaPct}% em dia)`, { v, h }];
  }
  if (x.tipo === "LIBERAR_APARELHO") {
    const ap = (await db.collection("aparelhos").doc(String(x.alvo)).get()).data();
    if (!ap) return ["DUVIDA", "aparelho n\xE3o encontrado"];
    const v = ap.vendaId ? (await db.collection("vendas").doc(ap.vendaId).get()).data() : null;
    if (v && ["QUITADA", "CANCELADA"].includes(v.status)) return ["APROVADA", `contrato ${v.status === "QUITADA" ? "quitado" : "cancelado"}: pode liberar`];
    if (v && (v.parcelas || []).every((p) => p.pago)) return ["APROVADA", "todas as parcelas pagas"];
    return ["DUVIDA", "libera\xE7\xE3o definitiva com parcelas em aberto: decis\xE3o do dono", { v: v ? { numero: v.numero, status: v.status } : null }];
  }
  if (x.tipo === "DESCONTO_BAIXA") {
    const v = (await db.collection("vendas").doc(String(x.alvo)).get()).data();
    if (!v) return ["DUVIDA", "contrato n\xE3o encontrado"];
    const p = (v.parcelas || [])[Number(d.i)];
    if (!p) return ["DUVIDA", "parcela n\xE3o encontrada"];
    if (p.pago) return ["RECUSADA", "a parcela j\xE1 est\xE1 paga"];
    const desc = p.valor > 0 ? Math.round((1 - Number(d.valor || 0) / p.valor) * 100) : 100, h = historico(v);
    if (desc <= 10 && h.diasAtraso <= 30) return ["APROVADA", `desconto de ${desc}% dentro do limite de 10%`, { desc, h }];
    if (desc > 25) return ["RECUSADA", `desconto de ${desc}% acima do m\xE1ximo de 25%`, { desc, h }];
    return ["DUVIDA", `desconto de ${desc}%: entre 10% e 25%, decis\xE3o do dono`, { desc, h }];
  }
  return ["DUVIDA", "tipo de pedido sem regra autom\xE1tica"];
}
async function executarAprovacao(x) {
  const d = x.dados || {}, quem = `${x.solicitanteNome || ""} (aprovado pela ${POR})`;
  if (x.tipo === "LIBERAR_APARELHO") {
    await db.collection("aparelhos").doc(String(x.alvo)).set({ modo: "LIBERAR", modoPor: quem, modoEm: Date.now(), modoMotivo: d.motivo || "" }, { merge: true });
    await pushAparelho(String(x.alvo)).catch(() => {
    });
  }
  if (x.tipo === "LIB24H") {
    await db.collection("aparelhos").doc(String(x.alvo)).set({ modo: "AUTO", liberadoAte: Date.now() + 864e5, ultimaLib24h: Date.now(), modoPor: quem, modoMotivo: d.motivo || "" }, { merge: true });
    await pushAparelho(String(x.alvo)).catch(() => {
    });
  }
  if (x.tipo === "DESCONTO_BAIXA") {
    const v = (await db.collection("vendas").doc(String(x.alvo)).get()).data() || {}, p = (v.parcelas || [])[Number(d.i)] || {};
    await baixarParcela(String(x.alvo), p.n ?? Number(d.i) + 1, Number(d.valor), d.forma || "Desconto aprovado", `${d.obs ? d.obs + " \xB7 " : ""}desconto aprovado pela ${POR}`, x.solicitanteNome || POR);
  }
}
async function aprovacoesIA(max = 15) {
  const cfg = await config();
  if (cfg.iaAutonoma === "nao") return { aprovacoes: 0 };
  const pend = (await db.collection("aprovacoes").where("status", "==", "PENDENTE").get()).docs.filter((s) => !s.data().iaAnalisadaEm).slice(0, max);
  let n = 0;
  for (const s of pend) {
    const x = { id: s.id, ...s.data() };
    try {
      const [dec, motivo, extra] = await regraAprovacao(x);
      const ia2 = await parecerIA(`Pedido "${x.tipo}" feito por ${x.solicitanteNome}: ${x.resumo}. Regra aplicada: ${dec} \u2014 ${motivo}. Explique a decis\xE3o e o risco.`, { pedido: x.dados, extra });
      const base2 = { iaAnalisadaEm: Date.now(), iaDecisao: dec, iaMotivo: motivo, iaParecer: ia2?.parecer || motivo, iaRisco: ia2?.risco || "" };
      if (dec === "DUVIDA") {
        await s.ref.set({ ...base2, aguardandoDono: true }, { merge: true });
        continue;
      }
      if (dec === "APROVADA") await executarAprovacao(x);
      await s.ref.set({ ...base2, status: dec, decididoPor: POR, decididoEm: Date.now() }, { merge: true });
      await db.collection("logs").add({ em: Date.now(), acao: dec === "APROVADA" ? "Aprova\xE7\xE3o concedida pela IA" : "Aprova\xE7\xE3o recusada pela IA", alvo: x.alvo || "", detalhe: `${x.resumo} \xB7 ${motivo}`, nome: POR });
      n++;
    } catch (e) {
      await s.ref.set({ iaAnalisadaEm: Date.now(), iaDecisao: "DUVIDA", iaMotivo: "erro: " + e.message, aguardandoDono: true }, { merge: true });
    }
  }
  return { aprovacoes: n };
}
async function preanalisesIA(max = 20) {
  const cfg = await config();
  if (cfg.iaAutonoma === "nao") return { preanalises: 0 };
  const vit = (await db.collection("publico").doc("vitrine").get()).data() || {};
  const l = (await db.collection("preanalises").where("status", "in", ["NOVA", "CONTATADO"]).get()).docs.filter((s) => {
    const p = s.data();
    return !p.iaAnalisadaEm && !p.respondidoPorHumano && (p.status === "NOVA" || p.respondidoPor === "An\xE1lise autom\xE1tica");
  }).slice(0, max);
  let n = 0;
  for (const s of l) {
    const p = s.data();
    try {
      const d = await decidir(p, vit, cfg);
      const ia2 = await parecerIA(`Pr\xE9-an\xE1lise online de ${p.nome} (${p.cidade || ""}), renda ${p.renda}, profiss\xE3o ${p.profissao || "\u2014"}, quer ${p.aparelho || "\u2014"} com entrada ${p.entrada || 0}. Resultado das regras: ${d.status}. D\xEA o parecer.`, { regras: d.auto, status: d.status });
      if (d.status === "CONTATADO") {
        await s.ref.set({ status: "CONTATADO", resposta: d.resposta, respondidoEm: Date.now(), respondidoPor: POR, auto: d.auto || null, iaAnalisadaEm: Date.now(), aguardandoDono: true, iaParecer: ia2?.parecer || `Ficou para o dono: ${d.auto?.motivo || "caso fora das regras"}.`, iaRisco: ia2?.risco || "" }, { merge: true });
      } else {
        await s.ref.set({ status: d.status, resposta: d.resposta, respondidoEm: Date.now(), respondidoPor: POR, auto: d.auto || null, iaAnalisadaEm: Date.now(), aguardandoDono: false, iaParecer: ia2?.parecer || "", iaRisco: ia2?.risco || "" }, { merge: true });
        n++;
      }
    } catch (e) {
      console.warn("preanalise IA", s.id, e.message);
    }
  }
  return { preanalises: n };
}
async function incluirLN(v, motivo, tipoOrigem) {
  const cpf = String(v.clienteCpf || "").replace(/\D/g, "");
  if (!cpf) return false;
  const ref = db.collection("listanegra").doc("cpf_" + cpf);
  if ((await ref.get()).exists) return false;
  const base2 = { nome: v.clienteNome || "", cpf, motivo, vendaId: v.id, vendaNumero: v.numero || 0, em: Date.now(), por: POR, ativo: true, origem: "IA", regra: tipoOrigem };
  await ref.set({ ...base2, tipo: "CPF", valor: cpf });
  for (const t of (v.cliente?.telefones || []).filter(Boolean)) await db.collection("listanegra").doc("tel_" + String(t).replace(/\D/g, "")).set({ ...base2, tipo: "TELEFONE", valor: String(t).replace(/\D/g, "") }, { merge: true });
  await db.collection("logs").add({ em: Date.now(), acao: "Lista negra: inclu\xEDdo pela IA", alvo: v.id, detalhe: `${v.clienteNome} \xB7 ${motivo}`, nome: POR });
  return true;
}
async function listaNegraIA() {
  const cfg = await config();
  if (cfg.iaAutonoma === "nao" || cfg.listaNegraAuto === "nao") return { listaNegra: 0 };
  const vs = (await db.collection("vendas").where("status", "in", ["ATIVA", "RETOMADA"]).get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  let n = 0;
  const h = hoje();
  for (const v of vs) {
    const hi = historico(v);
    if (v.status === "RETOMADA" && (v.parcelas || []).some((p) => !p.pago)) {
      if (await incluirLN(v, "Aparelho retomado com parcelas em aberto", "retomada")) n++;
      continue;
    }
    if (v.status === "ATIVA" && hi.diasAtraso >= 90 && v.aparelhoToken) {
      const ap = (await db.collection("aparelhos").doc(v.aparelhoToken).get()).data() || {};
      const sinal = Number(ap.checkin?.em) || 0;
      if (!sinal || Date.now() - sinal > 30 * 864e5) {
        if (await incluirLN(v, `${hi.diasAtraso} dias de atraso e o aparelho sem sinal h\xE1 mais de 30 dias`, "sumiu")) n++;
        continue;
      }
    }
    if (v.status === "ATIVA" && hi.pagas === 0 && hi.diasAtraso >= 60) {
      if (await incluirLN(v, "N\xE3o pagou nenhuma parcela (60+ dias de atraso)", "nunca pagou")) n++;
      continue;
    }
    if ((v.alertasFraude || []).some((a) => /outro CPF/.test(a.motivo || "")) && hi.diasAtraso >= 15) {
      if (await incluirLN(v, "Telefone usado por outro CPF e parcela em atraso", "fraude")) n++;
    }
  }
  return { listaNegra: n, h };
}
var MSG_ACK = (nome, prot) => `Ol\xE1${nome ? ", " + String(nome).split(" ")[0] : ""}! Recebemos o seu atendimento${prot ? " (protocolo " + prot + ")" : ""}. Um especialista da NexumCell j\xE1 foi avisado e responde por aqui em instantes. Enquanto isso, se puder, descreva com detalhes o que aconteceu.`;
async function atendimentoIA() {
  let n = 0;
  const ats = (await db.collection("atendimentos").where("status", "==", "HUMANO").get()).docs.filter((s) => !s.data().autoAckEm);
  for (const s of ats) {
    const a = s.data(), msgs = [...a.msgs || []];
    if (msgs.some((m) => m.de === "atendente")) {
      await s.ref.set({ autoAckEm: Date.now() }, { merge: true });
      continue;
    }
    msgs.push({ de: "atendente", t: MSG_ACK(a.nome || a.abertoPorNome, a.protocolo), em: Date.now(), por: "Suporte NexumCell", auto: true });
    await s.ref.set({ msgs, autoAckEm: Date.now(), naoLidoUser: true, atualizadoEm: Date.now() }, { merge: true });
    n++;
  }
  const sa = (await db.collection("suporteApp").where("naoLidoSuporte", "==", true).get()).docs.filter((s) => !s.data().autoAckEm);
  for (const s of sa) {
    const c = s.data();
    await s.ref.collection("msgs").add({ de: "suporte", texto: MSG_ACK(c.clienteNome, ""), em: Date.now(), porNome: "Suporte", auto: true });
    await s.ref.set({ autoAckEm: Date.now(), naoLidoCliente: true, atualizadoEm: Date.now() }, { merge: true });
    n++;
  }
  return { atendimento: n };
}
async function iaAutonomaRotina() {
  const r = {};
  for (const [k, f] of [["aprovacoes", aprovacoesIA], ["preanalises", preanalisesIA], ["listaNegra", listaNegraIA], ["atendimento", atendimentoIA]]) {
    try {
      Object.assign(r, await f());
    } catch (e) {
      console.error("ia", k, e.message);
      r[k + "Erro"] = e.message;
    }
  }
  return r;
}
async function handler5(req, res) {
  if (cors(req, res)) return;
  try {
    await exigirEquipe(req, ["DONO", "FINANCEIRO", "SUPORTE"]);
    res.json({ ok: true, ...await iaAutonomaRotina() });
  } catch (e) {
    res.status(e.status || 500).json({ erro: e.message });
  }
}

// api/score.js
function scoreDe(vendas, h = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10)) {
  const vs = (vendas || []).filter((v) => !["REPROVADA", "CANCELADA"].includes(v.status));
  if (!vs.length) return { score: 500, faixa: "Sem hist\xF3rico", pagas: 0, atrasadas: 0 };
  const dias6 = (a, b) => Math.round((/* @__PURE__ */ new Date(b + "T12:00:00Z") - /* @__PURE__ */ new Date(String(a).slice(0, 10) + "T12:00:00Z")) / 864e5);
  let s = 550, pagas = 0, atrasadas = 0;
  for (const v of vs) {
    if (v.status === "QUITADA") s += 60;
    if (v.status === "RETOMADA") s -= 300;
    for (const p of v.parcelas || []) {
      if (p.pago) {
        pagas++;
        const d = p.pagoEm ? dias6(p.venc, String(p.pagoEm).slice(0, 10)) : 0;
        s += d <= 3 ? 12 : d <= 15 ? 4 : d <= 30 ? -10 : -30;
      } else if (p.venc < h) {
        atrasadas++;
        s -= Math.min(250, 40 + dias6(p.venc, h) * 2);
      }
    }
  }
  const score = Math.max(0, Math.min(1e3, Math.round(s)));
  return { score, faixa: score >= 750 ? "Excelente" : score >= 600 ? "Bom" : score >= 450 ? "Regular" : "Risco", pagas, atrasadas };
}

// api/emprestimo.js
init_base();
var PAD = {
  instituicao: { tipo: "NENHUMA" },
  dataprev: { modo: "MANUAL" },
  clt: { ativo: false, taxaMes: 3.4, prazoMax: 48, valorMin: 500, valorMax: 5e4, tempoMin: 6, idadeMax: 70, margemPct: 35 },
  pessoal: { ativo: false, modoTaxa: "TOTAL", taxa: 100, prazoMax: 12, valorMin: 200, valorMax: 5e3, comprometeMax: 30, limiteNovo: 500, limiteBom: 2e3, iof: true },
  cartao: { ativo: true }
};
var NOME = { clt: "Consignado CLT", pessoal: "Empr\xE9stimo pessoal", cartao: "iPhone no cart\xE3o" };
var ST = { APROVADO: "Aprovado", RECUSADO: "Recusado", PENDENTE: "Aguardando decis\xE3o", CONTRATADO: "Contratado", CANCELADO: "Cancelado", EM_ANALISE: "Em an\xE1lise" };
var VISAO = process.env.GROQ_MODELO_VISAO || "meta-llama/llama-4-scout-17b-16e-instruct";
var soD = (s) => String(s || "").replace(/\D/g, "");
var brl2 = (n) => "R$ " + (Number(n) || 0).toFixed(2).replace(".", ",");
var meses = (a, b) => {
  const x = /* @__PURE__ */ new Date(a + "T12:00"), y = /* @__PURE__ */ new Date(b + "T12:00");
  return (y.getFullYear() - x.getFullYear()) * 12 + y.getMonth() - x.getMonth() - (y.getDate() < x.getDate() ? 1 : 0);
};
var erro2 = (m, s = 400) => Object.assign(new Error(m), { status: s });
async function cfgEmp() {
  const d = (await db.collection("config").doc("emprestimos").get()).data() || {};
  const c = {};
  for (const k of Object.keys(PAD)) c[k] = { ...PAD[k], ...d[k] || {} };
  return c;
}
var autorizada = (c) => (c.instituicao?.tipo || "NENHUMA") !== "NENHUMA";
async function historicoCpf(cpf) {
  const vs = (await db.collection("vendas").where("clienteCpf", "==", cpf).get()).docs.map((d) => d.data()), h = hoje();
  let pagas = 0, emDia = 0, atrasoMax = 0, atrasadas = 0;
  for (const v of vs) for (const p of v.parcelas || []) {
    if (p.pago) {
      pagas++;
      const d = p.pagoEm ? Math.round((new Date(p.pagoEm) - new Date(p.venc)) / 864e5) : 0;
      if (d <= 3) emDia++;
      atrasoMax = Math.max(atrasoMax, d);
    } else if (p.venc < h) {
      atrasadas++;
      atrasoMax = Math.max(atrasoMax, Math.round((new Date(h) - new Date(p.venc)) / 864e5));
    }
  }
  return { contratos: vs.length, pagas, emDia, atrasoMax, atrasadas };
}
async function conferirRosto(b) {
  const chave = await chaveIA();
  if (!chave) return { status: "DUVIDA", observacao: "IA sem chave: a equipe confere as fotos." };
  try {
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer " + chave, "Content-Type": "application/json" },
      body: JSON.stringify({ model: VISAO, temperature: 0, max_tokens: 350, response_format: { type: "json_object" }, messages: [{ role: "user", content: [
        { type: "text", text: 'Imagem 1: documento de identidade com foto. Imagem 2: selfie de frente tirada agora. Imagem 3: selfie tirada agora virando o rosto. Responda SOMENTE em JSON: {"documento_legivel":true,"rosto_no_documento":true,"mesma_pessoa":"sim|nao|incerto","confianca":0,"selfies_mesma_pessoa":true,"angulos_diferentes":true,"foto_de_tela_ou_papel":false,"observacao":"1 frase em portugu\xEAs"}. "confianca" de 0 a 100 para a selfie ser a pessoa do documento.' },
        ...[b.documento, b.selfie, b.selfie2].map((u) => ({ type: "image_url", image_url: { url: u } }))
      ] }] })
    });
    if (!r.ok) return { status: "DUVIDA", observacao: "A IA n\xE3o respondeu (" + r.status + "): a equipe confere as fotos." };
    const j = JSON.parse((await r.json()).choices?.[0]?.message?.content || "{}"), conf = +j.confianca || 0;
    const reprova = j.foto_de_tela_ou_papel || j.mesma_pessoa === "nao" || j.selfies_mesma_pessoa === false;
    const status = reprova ? "REPROVADA" : j.mesma_pessoa === "sim" && conf >= 70 && j.angulos_diferentes !== false && j.documento_legivel !== false ? "APROVADA" : "DUVIDA";
    return { status, confianca: conf, observacao: j.observacao || "", ia: j };
  } catch (e) {
    return { status: "DUVIDA", observacao: "Falha na IA: a equipe confere as fotos." };
  }
}
async function salvarBiometria(id, p, b, extra) {
  for (const k of ["documento", "selfie", "selfie2"]) if (!/^data:image\/(jpeg|png|webp);base64,/.test(String(b[k] || "")) || b[k].length > 4e5) throw erro2("Foto inv\xE1lida ou grande demais: " + k);
  const bio = await conferirRosto(b);
  await db.collection("empBiometria").doc(id).set({ documento: b.documento, selfie: b.selfie, selfie2: b.selfie2, em: Date.now(), cpf: p.cpf, lojaId: p.lojaId || "", ...extra });
  const biometria = { status: bio.status, confianca: bio.confianca ?? null, observacao: bio.observacao, em: Date.now(), modo: extra.modo };
  await db.collection("emprestimos").doc(id).set({ biometria, atualizadoEm: Date.now() }, { merge: true });
  return biometria;
}
async function analisar(id) {
  const ref = db.collection("emprestimos").doc(id), p = (await ref.get()).data();
  if (!p) throw erro2("Proposta n\xE3o encontrada", 404);
  if (!["EM_ANALISE"].includes(p.status)) return { status: p.status, motivos: p.analise?.motivos || [] };
  const c = await cfgEmp(), cf = c[p.produto], m = [], ok = (t) => m.push({ t, ok: true }), nao = (t) => m.push({ t }), alerta = (t) => m.push({ t, alerta: true });
  let status = "APROVADO";
  const recusa = (t) => {
    nao(t);
    status = "RECUSADO";
  }, duvida = (t) => {
    alerta(t);
    if (status !== "RECUSADO") status = "PENDENTE";
  };
  if (!cf) recusa("Produto desconhecido");
  else {
    if (!cf.ativo) recusa(NOME[p.produto] + " est\xE1 desligado");
    if (p.produto !== "cartao" && !autorizada(c)) recusa("NexumCell ainda n\xE3o habilitada para este produto (s\xF3 simula\xE7\xE3o)");
    if (p.lojaId) {
      const l = (await db.collection("lojas").doc(p.lojaId).get()).data() || {};
      if (!l.emprestimos?.[p.produto]) recusa("Produto n\xE3o liberado para a loja");
    }
    if (p.valor < cf.valorMin || p.valor > cf.valorMax) recusa(`Valor fora da faixa (${brl2(cf.valorMin)} a ${brl2(cf.valorMax)})`);
    if (p.prazo > cf.prazoMax) recusa(`Prazo acima de ${cf.prazoMax} meses`);
    const nasc = p.cliente?.nascimento, idade = nasc ? Math.floor(meses(nasc, hoje()) / 12) : null;
    if (idade == null) duvida("Sem data de nascimento");
    else if (idade < 18) recusa("Menor de 18 anos");
    else if (idade > (p.produto === "clt" ? cf.idadeMax : 75)) recusa(`Idade ${idade} acima do limite`);
    else ok(`Idade ${idade} anos`);
    if ((await db.collection("listanegra").doc("cpf_" + p.cpf).get()).exists) recusa("CPF na lista negra da NexumCell");
    const b = p.biometria;
    if (!b) duvida("Sem biometria facial");
    else if (b.status === "REPROVADA") recusa("Biometria facial: o rosto n\xE3o confere com o documento" + (b.observacao ? ` (${b.observacao})` : ""));
    else if (b.status === "DUVIDA") duvida("Biometria facial em d\xFAvida: a equipe confere as fotos");
    else ok(`Biometria facial confere (${b.confianca ?? "\u2014"}%)`);
    const h = await historicoCpf(p.cpf), sc = scoreDe((await db.collection("vendas").where("clienteCpf", "==", p.cpf).get()).docs.map((d) => d.data()));
    if (h.contratos) {
      if (sc.score < 300) recusa(`Score NexumCell ${sc.score} (${sc.faixa})`);
      else if (sc.score < 450) duvida(`Score NexumCell ${sc.score} (${sc.faixa})`);
      else ok(`Score NexumCell ${sc.score} (${sc.faixa})`);
    }
    if (h.atrasadas) recusa(`${h.atrasadas} parcela(s) em atraso na NexumCell`);
    else if (h.atrasoMax > 30) recusa(`J\xE1 atrasou ${h.atrasoMax} dias na NexumCell`);
    else if (h.pagas) ok(`${h.pagas} parcela(s) paga(s) na NexumCell, ${h.emDia} em dia`);
    if (p.produto === "clt") {
      const e = p.emprego || {}, mg = +p.margem?.disponivel || 0;
      if (e.admissao) {
        const t = meses(e.admissao, hoje());
        t < cf.tempoMin ? recusa(`${t} m\xEAs(es) de empresa (m\xEDnimo ${cf.tempoMin})`) : ok(`${t} meses de empresa`);
      } else duvida("Sem data de admiss\xE3o");
      if (p.parcela > mg) recusa(`Parcela ${brl2(p.parcela)} passa da margem ${brl2(mg)}`);
      else ok(`Parcela ${brl2(p.parcela)} cabe na margem ${brl2(mg)}`);
      if (p.margem?.fonte !== "DATAPREV") duvida("Margem informada pelo holerite: a equipe confere o documento");
    }
    if (p.produto === "pessoal") {
      const ren = +p.renda?.mensal || 0, mx = ren * cf.comprometeMax / 100;
      if (!ren) recusa("Sem renda informada");
      else if (p.parcela > mx) recusa(`Parcela ${brl2(p.parcela)} passa de ${cf.comprometeMax}% da renda (${brl2(mx)})`);
      else ok(`Parcela at\xE9 ${cf.comprometeMax}% da renda`);
      const lim = (await db.collection("limitesCliente").doc(p.cpf).get()).data();
      if (lim?.bloqueado) recusa("Limite do cliente bloqueado");
      const teto = lim ? Math.max(0, (+lim.limite || 0) - (+lim.usado || 0)) : h.pagas >= 6 && !h.atrasoMax ? cf.limiteBom : cf.limiteNovo;
      if (p.valor > teto) duvida(`Valor acima do limite dispon\xEDvel (${brl2(teto)})`);
      else ok(`Dentro do limite dispon\xEDvel (${brl2(teto)})`);
    }
  }
  const analise = { em: Date.now(), por: "An\xE1lise autom\xE1tica", motivos: m };
  await ref.set({ status, analise, atualizadoEm: Date.now(), historico: [...p.historico || [], { em: Date.now(), por: "An\xE1lise autom\xE1tica", obs: ST[status] }] }, { merge: true });
  return { status, motivos: m };
}
async function decidir2(id, status, obs, quem) {
  if (!["APROVADO", "RECUSADO", "CONTRATADO", "CANCELADO"].includes(status)) throw erro2("Situa\xE7\xE3o inv\xE1lida");
  const ref = db.collection("emprestimos").doc(id), p = (await ref.get()).data();
  if (!p) throw erro2("Proposta n\xE3o encontrada", 404);
  if (status === "CONTRATADO" && p.produto === "pessoal") {
    const lr = db.collection("limitesCliente").doc(p.cpf), l = (await lr.get()).data() || {};
    await lr.set({ nome: p.cliente?.nome || l.nome || "", limite: l.limite ?? p.valor, usado: (+l.usado || 0) + (+p.valor || 0), atualizadoEm: Date.now(), por: quem }, { merge: true });
  }
  let extra = {};
  if (status === "CONTRATADO" && ["pessoal", "clt"].includes(p.produto) && !p.parcelas) {
    const base2 = /* @__PURE__ */ new Date();
    base2.setUTCDate(base2.getUTCDate() + 30);
    extra.parcelas = Array.from({ length: +p.prazo || 1 }, (_, k) => {
      const d = new Date(base2);
      d.setUTCMonth(d.getUTCMonth() + k);
      return { n: k + 1, venc: d.toISOString().slice(0, 10), valor: +p.parcela, pago: false, ...p.produto === "clt" ? { forma: "FOLHA" } : {} };
    });
    extra.contratadoEm = Date.now();
  }
  await ref.set({ ...extra, status, decididoPor: quem, decididoEm: Date.now(), atualizadoEm: Date.now(), historico: [...p.historico || [], { em: Date.now(), por: quem, obs: ST[status] + (obs ? ": " + obs : "") }] }, { merge: true });
  return { status };
}
function textoContrato(p, c) {
  const brlx = brl2, d = (/* @__PURE__ */ new Date()).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }), cl = p.cliente || {};
  return [
    `C\xC9DULA DE CR\xC9DITO \xB7 ${NOME[p.produto].toUpperCase()} \xB7 N\xBA ${p.protocolo || ""}`,
    `CREDOR: ${c.instituicao?.nome || "NexumCell"}${c.instituicao?.cnpj ? ", CNPJ " + c.instituicao.cnpj : ""}${c.instituicao?.tipo === "CORRESPONDENTE" ? " (por meio da NexumCell, correspondente)" : ""}.`,
    `EMITENTE (CLIENTE): ${cl.nome || ""}, CPF ${String(p.cpf).replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4")}, telefone ${cl.telefone || ""}.`,
    `1. VALOR E PAGAMENTO. O cliente recebe ${brlx(p.valor)} e pagar\xE1 ${p.prazo} parcelas mensais de ${brlx(p.parcela)}, total de ${brlx(p.total)}, com a 1\xAA em 30 dias${p.produto === "clt" ? ", descontadas em folha de pagamento pelo empregador, at\xE9 o limite da margem consign\xE1vel" : ", por Pix ou boleto"}.`,
    `2. CUSTO. Juros de ${p.taxa?.modo === "TOTAL" ? p.taxa.valor + "% sobre o total" : (p.taxa?.valor || 0) + "% ao m\xEAs"}${p.iof ? `, IOF de ${brlx(p.iof)}` : ""}. Custo Efetivo Total (CET): ${p.cetMes ?? "\u2014"}% ao m\xEAs e ${p.cetAno ?? "\u2014"}% ao ano.`,
    `3. ATRASO. Parcela em atraso tem multa de 2% e juros de mora de 1% ao m\xEAs, e o nome pode ser inclu\xEDdo nos \xF3rg\xE3os de prote\xE7\xE3o ao cr\xE9dito ap\xF3s aviso pr\xE9vio.`,
    `4. QUITA\xC7\xC3O ANTECIPADA. O cliente pode antecipar parcelas ou quitar o contrato com redu\xE7\xE3o proporcional dos juros.`,
    `5. ARREPENDIMENTO. O cliente pode desistir em at\xE9 7 dias da assinatura, devolvendo o valor recebido, sem juros.`,
    `6. DADOS (LGPD). Os dados e a biometria facial s\xE3o usados para identificar o cliente, analisar o cr\xE9dito e cobrar, e ficam guardados com seguran\xE7a pelo prazo legal.`,
    `7. ASSINATURA ELETR\xD4NICA. O cliente assina eletronicamente, com confirma\xE7\xE3o do CPF, selfie e registro de data, hora e endere\xE7o IP, que valem como prova de autoria.`,
    `Foz do Igua\xE7u/PR, ${d}.`
  ].join("\n\n");
}
async function porContrato(t) {
  if (!/^[a-f0-9]{24,64}$/.test(String(t || ""))) throw erro2("Link inv\xE1lido", 404);
  const d = (await db.collection("emprestimos").where("contratoToken", "==", t).get()).docs[0];
  if (!d) throw erro2("Link inv\xE1lido", 404);
  return { id: d.id, p: d.data() };
}
async function sha256(t) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
async function porToken(t) {
  if (!/^[a-f0-9]{24,64}$/.test(String(t || ""))) throw erro2("Link inv\xE1lido", 404);
  const d = (await db.collection("emprestimos").where("linkToken", "==", t).get()).docs[0];
  if (!d) throw erro2("Link inv\xE1lido", 404);
  return { id: d.id, p: d.data() };
}
var resumo = (p) => ({
  nome: String(p.cliente?.nome || "").split(" ")[0],
  produto: NOME[p.produto],
  valor: p.valor,
  prazo: p.prazo,
  parcela: p.parcela,
  total: p.total,
  iof: p.iof || 0,
  cetMes: p.cetMes,
  cetAno: p.cetAno,
  taxa: p.taxa,
  loja: p.lojaNome || "NexumCell",
  status: p.status,
  expirado: (p.linkExpira || 0) < Date.now(),
  protocolo: p.protocolo
});
async function emprestimoRotina() {
  const l = (await db.collection("emprestimos").where("status", "==", "EM_ANALISE").get()).docs;
  let n = 0;
  for (const d of l) if (!d.data().analise && (d.data().atualizadoEm || 0) < Date.now() - 12e4) {
    try {
      await analisar(d.id);
      n++;
    } catch (e) {
      console.error("emprestimo", d.id, e.message);
    }
  }
  return { emprestimos: n };
}
async function handler6(req, res) {
  if (cors(req, res)) return;
  const b = req.body || {};
  try {
    if (b.acao === "cliente") {
      const { p } = await porToken(b.t);
      return res.json(resumo(p));
    }
    if (b.acao === "contrato") {
      const { p } = await porContrato(b.c);
      return res.json({ ...resumo(p), status: p.status, assinado: p.contrato?.status === "ASSINADO", expirado: (p.contratoExpira || 0) < Date.now(), texto: p.contratoTexto || "" });
    }
    if (b.acao === "assinar") {
      const { id, p } = await porContrato(b.c);
      if (p.contrato?.status === "ASSINADO") throw erro2("Este contrato j\xE1 foi assinado.");
      if ((p.contratoExpira || 0) < Date.now()) throw erro2("O link venceu. Pe\xE7a um novo \xE0 loja.");
      if (b.aceite !== true) throw erro2("Marque que leu e aceita o contrato.");
      if (soD(b.cpfFim) !== String(p.cpf).slice(-4)) throw erro2("Os 4 \xFAltimos n\xFAmeros do CPF n\xE3o conferem.");
      for (const k of ["assinatura", "selfie"]) if (!/^data:image\/(png|jpeg|webp);base64,/.test(String(b[k] || "")) || b[k].length > 4e5) throw erro2("Falta a " + (k === "selfie" ? "selfie" : "assinatura") + ".");
      const bio = (await db.collection("empBiometria").doc(id).get()).data(), conf = bio?.documento ? await conferirRosto({ documento: bio.documento, selfie: b.selfie, selfie2: b.selfie }) : { status: "DUVIDA" };
      const ip = req.headers["cf-connecting-ip"] || "", hash = await sha256(p.contratoTexto || "");
      await db.collection("empContratos").doc(id).set({ texto: p.contratoTexto, hash, assinatura: b.assinatura, selfie: b.selfie, ip, aparelho: String(req.headers["user-agent"] || "").slice(0, 160), em: Date.now(), rosto: conf.status, confianca: conf.confianca ?? null });
      await db.collection("emprestimos").doc(id).set({ contrato: { status: "ASSINADO", em: Date.now(), hash, ip, rosto: conf.status }, contratoToken: null, atualizadoEm: Date.now(), historico: [...p.historico || [], { em: Date.now(), por: "Cliente (link)", obs: "Contrato assinado eletronicamente" + (conf.status === "REPROVADA" ? " \xB7 ATEN\xC7\xC3O: rosto n\xE3o confere" : "") }] }, { merge: true });
      return res.json({ ok: true, rosto: conf.status });
    }
    if (b.acao === "clienteEnviar") {
      const { id, p } = await porToken(b.t);
      if (p.status !== "AGUARDANDO_CLIENTE") throw erro2("Esta proposta j\xE1 foi enviada.");
      if ((p.linkExpira || 0) < Date.now()) throw erro2("O link venceu. Pe\xE7a um novo \xE0 loja.");
      if (b.aceite !== true) throw erro2("Confirme que leu e aceita a proposta.");
      if (soD(b.cpfFim) !== String(p.cpf).slice(-4)) throw erro2("Os 4 \xFAltimos n\xFAmeros do CPF n\xE3o conferem.");
      const ip = req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"] || "";
      await salvarBiometria(id, p, b, { modo: "VIRTUAL", ip, aparelho: String(req.headers["user-agent"] || "").slice(0, 160) });
      await db.collection("emprestimos").doc(id).set({ status: "EM_ANALISE", aceite: { em: Date.now(), ip }, linkToken: null, historico: [...p.historico || [], { em: Date.now(), por: "Cliente (link)", obs: "Biometria facial e aceite pelo celular" }] }, { merge: true });
      const r = await analisar(id);
      return res.json({ status: r.status });
    }
    const eu = await exigirEquipe(req, ["DONO", "FINANCEIRO", "COMERCIAL", "GERENTE", "VENDEDOR", "SUPORTE"]);
    const daLoja = async (id) => {
      const p = (await db.collection("emprestimos").doc(id).get()).data();
      if (!p) throw erro2("Proposta n\xE3o encontrada", 404);
      if (["GERENTE", "VENDEDOR"].includes(eu.role) && p.lojaId !== eu.lojaId) throw erro2("sem permiss\xE3o", 403);
      return p;
    };
    if (b.acao === "dataprev") {
      const cpf = soD(b.cpf);
      if (cpf.length !== 11) throw erro2("CPF inv\xE1lido");
      const s = (await db.collection("segredos").doc("dataprev").get()).data();
      if ((await cfgEmp()).dataprev.modo !== "PARCEIRO" || !s?.url) return res.json({ naoConfigurado: true });
      const r = await fetch(s.url, { method: "POST", headers: { "Content-Type": "application/json", ...s.token ? { Authorization: "Bearer " + s.token } : {} }, body: JSON.stringify({ cpf, consentimento: true }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw erro2("Dataprev/parceiro: " + (j.erro || j.message || r.status), 502);
      await db.collection("logs").add({ em: Date.now(), uid: eu.uid, nome: eu.nome, role: eu.role, acao: "Consulta de margem (Dataprev)", alvo: "cpf ***" + cpf.slice(-3), detalhe: "" });
      return res.json({ margemDisponivel: +(j.margemDisponivel ?? j.margem ?? 0), salarioLiquido: +(j.salarioLiquido ?? j.remuneracaoDisponivel ?? 0) || null, admissao: j.admissao || j.dataAdmissao || "", empregador: j.empregador || (j.cnpjEmpregador ? { cnpj: j.cnpjEmpregador, nome: j.nomeEmpregador || "" } : null) });
    }
    if (b.acao === "biometria") {
      const p = await daLoja(b.id);
      await salvarBiometria(b.id, p, b, { modo: "LOJA", por: eu.nome });
      return res.json(await analisar(b.id));
    }
    if (b.acao === "analisar") {
      await daLoja(b.id);
      return res.json(await analisar(b.id));
    }
    if (b.acao === "gerarContrato") {
      if (!["DONO", "FINANCEIRO"].includes(eu.role)) throw erro2("sem permiss\xE3o", 403);
      const p = await daLoja(b.id);
      if (p.status !== "APROVADO") throw erro2("S\xF3 proposta aprovada gera contrato.");
      const c = await cfgEmp(), tk = [...crypto.getRandomValues(new Uint8Array(18))].map((x) => x.toString(16).padStart(2, "0")).join("");
      await db.collection("emprestimos").doc(b.id).set({ contratoToken: tk, contratoExpira: Date.now() + 72 * 36e5, contratoTexto: textoContrato(p, c), contrato: { status: "ENVIADO", em: Date.now() }, historico: [...p.historico || [], { em: Date.now(), por: eu.nome, obs: "Contrato gerado e enviado para assinatura" }] }, { merge: true });
      return res.json({ token: tk });
    }
    if (b.acao === "pix") {
      const p = await daLoja(b.id), parc = (p.parcelas || []).find((x) => x.n === +b.n);
      if (!parc || parc.pago) throw erro2("Parcela inexistente ou j\xE1 paga.");
      if (parc.forma === "FOLHA") throw erro2("Esta parcela \xE9 descontada em folha.");
      let cli = (await asaas("/customers?cpfCnpj=" + p.cpf)).data?.[0];
      if (!cli) cli = await asaas("/customers", { method: "POST", body: JSON.stringify({ name: p.cliente?.nome, cpfCnpj: p.cpf, mobilePhone: soD(p.cliente?.telefone) }) });
      const ref = `emp:${b.id}:${parc.n}`;
      let cob = (await asaas("/payments?externalReference=" + encodeURIComponent(ref) + "&status=PENDING")).data?.[0];
      if (!cob) cob = await asaas("/payments", { method: "POST", body: JSON.stringify({ customer: cli.id, billingType: "PIX", value: parc.valor, dueDate: hoje(), externalReference: ref, description: `NexumCell ${NOME[p.produto]} ${p.protocolo || ""} parcela ${parc.n}` }) });
      const qr = await asaas(`/payments/${cob.id}/pixQrCode`);
      return res.json({ valor: parc.valor, copiaECola: qr.payload, qrBase64: qr.encodedImage, cobranca: cob.id });
    }
    if (b.acao === "decidir") {
      if (!["DONO", "FINANCEIRO"].includes(eu.role)) throw erro2("sem permiss\xE3o", 403);
      return res.json(await decidir2(b.id, b.status, String(b.obs || "").slice(0, 300), eu.nome));
    }
    throw erro2("a\xE7\xE3o inv\xE1lida");
  } catch (e) {
    res.status(e.status || 500).json({ erro: e.message });
  }
}
async function baixarParcelaEmprestimo(ref, valor, cobrancaId) {
  const [, id, n] = String(ref).split(":");
  const r = db.collection("emprestimos").doc(id), p = (await r.get()).data();
  if (!p) return false;
  const parcelas = (p.parcelas || []).map((x) => x.n === +n && !x.pago ? { ...x, pago: true, pagoEm: (/* @__PURE__ */ new Date()).toISOString(), valorPago: +valor, forma: "PIX (Asaas)", cobranca: cobrancaId } : x);
  const quitado = parcelas.every((x) => x.pago);
  await r.set({ parcelas, ...quitado ? { quitadoEm: Date.now() } : {}, atualizadoEm: Date.now() }, { merge: true });
  if (quitado && p.produto === "pessoal") {
    const lr = db.collection("limitesCliente").doc(p.cpf), l = (await lr.get()).data();
    if (l) await lr.set({ usado: Math.max(0, (+l.usado || 0) - (+p.valor || 0)) }, { merge: true });
  }
  return true;
}

// api/asaas-webhook.js
init_base();
init_brevo();

// api/saas.js
init_base();
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
async function handler7(req, res) {
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
  return { compradas, usadas, saldo: compradas - usadas, valor: Number(cfg.saasLicencaValor) || 54.99, obrigatoria: !cortesia, cortesia };
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
  const cfg = await config(), dias6 = Number(cfg.saasDiasBloqueio ?? 5);
  if (!(dias6 > 0)) return { bloqueadas: 0 };
  const limite2 = addDias(hoje(), -dias6);
  const atras = (await db.collection("empresas").where("situacao", "==", "ATRASADA").get()).docs.map((d) => ({ id: d.id, ...d.data() })).filter((e) => e.atrasadaDesde && e.atrasadaDesde <= limite2 && !e.bloqueadaPorAtraso);
  for (const e of atras) {
    await mudarBloqueio(e.id, true, `Mensalidade do sistema em atraso desde ${e.atrasadaDesde.split("-").reverse().join("/")}. Pague pelo link enviado por e-mail para liberar na hora.`);
    await db.collection("empresas").doc(e.id).set({ bloqueadaPorAtraso: true, bloqueadaEm: Date.now() }, { merge: true });
  }
  const pagas = (await db.collection("empresas").where("situacao", "==", "EM_DIA").get()).docs.filter((d) => d.data().bloqueadaPorAtraso);
  for (const d of pagas) await db.collection("empresas").doc(d.id).set({ bloqueadaPorAtraso: false }, { merge: true });
  return { bloqueadas: atras.length };
}

// api/asaas-webhook.js
async function handler8(req, res) {
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
    if (["PAYMENT_RECEIVED", "PAYMENT_CONFIRMED"].includes(event) && String(payment?.externalReference || "").startsWith("emp:")) {
      await baixarParcelaEmprestimo(payment.externalReference, payment.value, payment.id);
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
init_base();
var MODELO2 = process.env.GROQ_MODELO || "openai/gpt-oss-120b";
async function handler9(req, res) {
  if (cors(req, res)) return;
  if (req.method !== "POST") return res.status(405).end();
  try {
    const { token, pergunta, origem } = req.body || {};
    if (!token || !pergunta || String(pergunta).length > 500) return res.status(400).json({ erro: "pedido inv\xE1lido" });
    const chave = await chaveIA().catch(() => "") || process.env.GROQ_API_KEY || (await config()).iaChave || "";
    if (!chave) return res.status(200).json({ resposta: null });
    const s = await db.collection("aparelhos").doc(String(token)).get();
    if (!s.exists) return res.status(404).json({ erro: "contrato n\xE3o encontrado" });
    const ap = s.data();
    const parcelas = (ap.parcelas || []).map((p) => ({ n: p.n, vencimento: p.venc, valor: p.valor, pago: !!p.pago, valorHoje: p.pago ? 0 : encargos(p, ap) }));
    const contexto = {
      hoje: hoje(),
      loja: ap.lojaNome,
      telefoneLoja: origem === "app" ? void 0 : ap.lojaTelefone,
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
        model: MODELO2,
        temperature: 0.2,
        max_tokens: 400,
        messages: [
          { role: "system", content: origem === "app" ? "Voc\xEA \xE9 a assistente virtual da NexumCell dentro do app do cliente, no celular financiado. Responda em portugu\xEAs do Brasil, em texto simples, sem markdown, sem asteriscos e sem listas com s\xEDmbolos; no m\xE1ximo 4 frases curtas. Use s\xF3 os DADOS DO CONTRATO; nunca invente valores, datas, promo\xE7\xF5es ou regras e n\xE3o prometa descontos nem libera\xE7\xE3o. Valores sempre no formato R$ 0,00 e datas dd/mm/aaaa. Nunca cite telefone, WhatsApp, e-mail ou site. Caminhos que existem no app: aba Parcelas \u2192 Pagar com PIX ou Cart\xE3o ou boleto em cada parcela; aba Parcelas \u2192 Quitar com PIX; aba Parcelas \u2192 Atualizar; aba Contrato \u2192 Baixar contrato assinado e Mudar dia do vencimento; aba Suporte \u2192 Iniciar atendimento. O aparelho libera sozinho alguns minutos depois que o pagamento \xE9 confirmado. Se o caso precisar de uma pessoa (defeito, roubo, contesta\xE7\xE3o, pagamento que n\xE3o caiu depois de 30 minutos), diga para tocar em N\xE3o, logo abaixo da resposta, que a assistente chama a equipe." : "Voc\xEA \xE9 o assistente da loja de celulares parcelados NexumCell no portal do cliente. Responda em portugu\xEAs do Brasil, curto (at\xE9 3 frases), educado e s\xF3 com base nos DADOS DO CONTRATO. Nunca invente valores, datas, promo\xE7\xF5es ou regras. N\xE3o prometa descontos nem libera\xE7\xE3o. Se n\xE3o souber ou for algo que precisa de uma pessoa, oriente a falar com a loja pelo WhatsApp informado em telefoneLoja, exatamente como est\xE1 nos dados. Bot\xF5es que existem no portal: Pagar (gera PIX), Quitar com PIX, Mudar dia do vencimento, Meu aparelho deu defeito, Roubo/furto/perda, Meus dados (LGPD), Recibo." },
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

// api/avisos.js
init_base();
init_brevo();

// api/cron.js
init_base();

// api/repasse.js
init_base();
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
async function handler10(req, res) {
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
init_base();
init_brevo();
var erro3 = (m, s = 400) => Object.assign(new Error(m), { status: s });
var sha = async (t) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)))].map((b) => b.toString(16).padStart(2, "0")).join("");
async function codigo(req, res) {
  if (cors(req, res)) return;
  try {
    if (req.method !== "POST") throw erro3("use POST", 405);
    const idt = String(req.headers.authorization || "").replace("Bearer ", "");
    const u = await auth.verifyIdToken(idt).catch(() => null);
    if (!u) throw erro3("entre de novo", 401);
    const email = String(u.email || "").toLowerCase();
    const me = (await db.collection("users").doc(u.uid).get()).data() || {};
    const dono = email && email === String(process.env.DONO_EMAIL || "").toLowerCase();
    if (!dono && !["DONO", "FINANCEIRO"].includes(me.role)) throw erro3("sem permiss\xE3o", 403);
    const ref = db.collection("segredos").doc("codigo_" + u.uid);
    const b = req.body || {};
    if (b.acao === "enviar") {
      if (!brevoLigado()) throw erro3("O envio de e-mail (Brevo) n\xE3o est\xE1 configurado no servidor.", 503);
      const ant = (await ref.get()).data() || {};
      if (ant.enviadoEm && Date.now() - ant.enviadoEm < 45e3) throw erro3("Aguarde 1 minuto para pedir outro c\xF3digo.", 429);
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
      if (!s || s.exp < Date.now()) throw erro3("C\xF3digo vencido. Pe\xE7a outro.", 410);
      if ((s.tentativas || 0) >= 5) throw erro3("Muitas tentativas. Pe\xE7a outro c\xF3digo.", 429);
      if (s.hash !== await sha(u.uid + ":" + String(b.codigo || "").trim())) {
        await ref.set({ tentativas: (s.tentativas || 0) + 1 }, { merge: true });
        throw erro3("C\xF3digo errado.", 403);
      }
      const ate = Date.now() + 12 * 36e5;
      await ref.set({ hash: "", exp: 0, usadoEm: Date.now() }, { merge: true });
      await db.collection("users").doc(u.uid).set({ verificadoAte: ate, verificadoEm: Date.now() }, { merge: true });
      await db.collection("logs").add({ acao: "Entrada confirmada com c\xF3digo por e-mail", alvo: u.uid, detalhe: email, por: me.nome || email, em: Date.now() });
      return res.json({ ok: true, ate });
    }
    throw erro3("a\xE7\xE3o inv\xE1lida");
  } catch (e) {
    res.status(e.status || 500).json({ erro: e.message });
  }
}
async function acordo(req, res) {
  if (cors(req, res)) return;
  try {
    if (req.method !== "POST") throw erro3("use POST", 405);
    const b = req.body || {}, tk = String(b.token || "");
    if (!/^[A-Za-z0-9_-]{10,60}$/.test(tk)) throw erro3("contrato inv\xE1lido");
    const cfg = await config();
    if (cfg.acordoCliente === "nao") throw erro3("Acordo pelo portal desligado. Fale com a loja.", 403);
    const ref = db.collection("aparelhos").doc(tk), snap2 = await ref.get();
    if (!snap2.exists) throw erro3("contrato n\xE3o encontrado", 404);
    const ap = snap2.data();
    if (ap.quitado || ["QUITADO", "CANCELADO"].includes(ap.status)) throw erro3("Contrato encerrado.");
    const h = hoje(), atraso = (ap.parcelas || []).filter((p) => !p.pago && p.venc < h);
    if (!atraso.length) throw erro3("N\xE3o h\xE1 parcelas em atraso.");
    if (ap.acordoPedidoEm && Date.now() - ap.acordoPedidoEm < 30 * 864e5) throw erro3("Voc\xEA j\xE1 pediu um acordo este m\xEAs. A loja vai entrar em contato.", 409);
    const max = Math.min(12, Math.max(2, +cfg.acordoMaxParcelas || 4)), n = Math.round(+b.parcelas || 0);
    if (n < 1 || n > max) throw erro3(`Escolha de 1 a ${max} parcelas.`);
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
init_base();
var erro4 = (m, s = 400) => Object.assign(new Error(m), { status: s });
function travaConfirmada(ck, cfg) {
  if (!ck || !ck.em) return false;
  if (ck.imeiConfere === false) return false;
  if (ck.deviceOwner === true) return true;
  return ck.modo === "link" && ck.adminAtivo === true && cfg.instalacaoLink !== "nao";
}
async function concluirVenda(vendaId, por) {
  const ref = db.collection("vendas").doc(vendaId), snap2 = await ref.get();
  if (!snap2.exists) throw erro4("venda n\xE3o encontrada", 404);
  const v = snap2.data();
  if (v.status === "ATIVA") return { ja: true };
  if (v.status !== "INSTALANDO") throw erro4("a venda n\xE3o est\xE1 aguardando a trava");
  if (!v.aparelhoToken) throw erro4("venda sem trava gerada");
  const ap = (await db.collection("aparelhos").doc(v.aparelhoToken).get()).data() || {};
  const cfg = await config();
  if (!travaConfirmada(ap.checkin, cfg)) throw erro4("o aparelho ainda n\xE3o confirmou a trava", 409);
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
async function handler11(req, res) {
  if (cors(req, res)) return;
  try {
    if (req.method !== "POST") throw erro4("use POST", 405);
    const eu = await exigirEquipe(req);
    const id = String(req.body?.vendaId || "");
    const v = (await db.collection("vendas").doc(id).get()).data();
    if (!v) throw erro4("venda n\xE3o encontrada", 404);
    if (eu.role === "VENDEDOR" && v.vendedorUid !== eu.uid) throw erro4("sem permiss\xE3o", 403);
    if (eu.role === "GERENTE" && v.lojaId !== eu.lojaId) throw erro4("sem permiss\xE3o", 403);
    res.json(await concluirVenda(id, eu.nome || eu.role));
  } catch (e) {
    res.status(e.status || 500).json({ erro: e.message });
  }
}

// api/negativacao.js
init_base();
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
  const dias6 = Math.max(30, Number(cfg.negativarDias) || 60), max = Math.max(1, Number(cfg.negativarMax) || 10);
  const ativas = (await db.collection("vendas").where("status", "==", "ATIVA").get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  const alvo = ativas.map((v) => ({ v, p: (v.parcelas || []).filter((x) => !x.pago && x.venc < h).sort((a, b) => a.venc < b.venc ? -1 : 1)[0] })).filter(({ v, p }) => p && diasEntre(p.venc, h) >= dias6 && !(v.negativacao && ATIVAS.includes(v.negativacao.status)) && !v.naoNegativar && !(v.acordo && v.acordo.status !== "QUEBRADO") && !(v.liberadoAte && v.liberadoAte > Date.now())).sort((a, b) => a.p.venc < b.p.venc ? -1 : 1).slice(0, max);
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
init_base();
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
init_base();
init_brevo();
var diasEntre2 = (a, b) => Math.round((/* @__PURE__ */ new Date(b + "T12:00:00Z") - /* @__PURE__ */ new Date(a + "T12:00:00Z")) / 864e5);
var brl3 = (n) => "R$ " + (Number(n) || 0).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
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
    const dias6 = Math.max(...atr.map((p) => diasEntre2(p.venc, h))), devido = r2(atr.reduce((s, p) => s + encargos(p, cfg), 0));
    (lojas[v.lojaId] ||= []).push({ v, dias: dias6, devido, n: atr.length });
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
    const texto = `Bom dia! Esta \xE9 a lista da semana dos clientes da ${nome} com parcelas em atraso: ${l.length} contrato(s), ${brl3(total)} no total.

` + l.slice(0, 60).map((x) => `\u2022 N\xBA ${x.v.numero} \xB7 ${x.v.clienteNome} \xB7 ${(x.v.cliente?.telefones || [])[0] || ""} \xB7 ${x.dias} dia(s) \xB7 ${brl3(x.devido)}`).join("\n") + (l.length > 60 ? `
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

// api/relatorio-crm.js
init_base();
init_brevo();
var brl4 = (n) => "R$ " + (Number(n) || 0).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
var lista = async (c, campo, desde) => (await db.collection(c).where(campo, ">=", desde).get()).docs.map((d) => ({ id: d.id, ...d.data() }));
async function relatorioCrm(cfg, forcar = false) {
  if (cfg.relCrm === "nao") return { relatorioCrm: "desligado" };
  const h = hoje();
  if (!forcar && (/* @__PURE__ */ new Date(h + "T12:00:00Z")).getUTCDay() !== 1) return { relatorioCrm: "n\xE3o \xE9 segunda" };
  if (!brevoLigado()) return { relatorioCrm: "sem e-mail configurado" };
  const para = process.env.DONO_EMAIL;
  if (!para) return { relatorioCrm: "sem DONO_EMAIL" };
  const marca = db.collection("notificacoes").doc("relcrm-" + h);
  if (!forcar && (await marca.get()).exists) return { relatorioCrm: "j\xE1 enviado hoje" };
  const desde = Date.now() - 7 * 864e5, desdeIso = new Date(desde).toISOString().slice(0, 10);
  const [at, app, ch, ped, wa, atr, av, pr, ac] = await Promise.all([
    lista("atendimentos", "criadoEm", desde),
    lista("suporteApp", "atualizadoEm", desde),
    lista("chamados", "criadoEm", desde),
    lista("pedidos", "criadoEm", desde),
    lista("waConversas", "atualizadoEm", desde),
    lista("crmAtrib", "em", desde),
    lista("crmAvaliacoes", "em", desde),
    lista("crmPromessas", "em", desde),
    lista("crmAcordos", "em", desde)
  ]);
  const total = at.length + app.length + ch.length + ped.length + wa.length, fin = atr.filter((a) => (a.finalizadoEm || 0) >= desde);
  const media = av.length ? (av.reduce((s, a) => s + (+a.nota || 0), 0) / av.length).toFixed(1) : "\u2014";
  const porAt = {};
  av.forEach((a) => {
    (porAt[a.nome || "\u2014"] ||= []).push(+a.nota || 0);
  });
  const mot = {};
  fin.filter((a) => a.motivo).forEach((a) => mot[a.motivo] = (mot[a.motivo] || 0) + 1);
  let recuperado = 0, qtdRec = 0;
  for (const d of (await db.collection("vendas").where("status", "in", ["ATIVA", "QUITADA"]).get()).docs) for (const p of d.data().parcelas || [])
    if (p.pago && p.pagoEm && String(p.pagoEm).slice(0, 10) >= desdeIso && String(p.pagoEm).slice(0, 10) > p.venc) {
      recuperado += +p.valorPago || +p.valor || 0;
      qtdRec++;
    }
  const linhas = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `<tr><td style="padding:4px 10px 4px 0">${k}</td><td style="padding:4px 0;text-align:right"><b>${v}</b></td></tr>`).join("");
  const html = `<div style="font-family:Arial,sans-serif;color:#0A1733;max-width:640px"><h2 style="margin:0 0 4px">Atendimento NexumCell \xB7 semana at\xE9 ${h.split("-").reverse().join("/")}</h2><p style="color:#5B6478;margin:0 0 16px">Resumo autom\xE1tico do CRM.</p>
    <table style="width:100%;border-collapse:collapse;margin-bottom:16px">${[["Atendimentos na semana", total], ["Finalizados com motivo", fin.length], ["Nota m\xE9dia da pesquisa", `${media} de 5 (${av.length} nota(s))`], ["Promessas de pagamento", `${pr.length} \xB7 cumpridas ${pr.filter((p) => p.status === "CUMPRIDA").length} \xB7 quebradas ${pr.filter((p) => p.status === "QUEBRADA").length}`], ["Acordos propostos", `${ac.length} \xB7 ${brl4(ac.reduce((s, a) => s + (+a.total || 0), 0))}`], ["Recuperado da cobran\xE7a", `${brl4(recuperado)} (${qtdRec} parcela(s) atrasadas pagas)`]].map(([k, v]) => `<tr><td style="padding:8px 10px 8px 0;border-bottom:1px solid #EEF1F7;color:#5B6478">${k}</td><td style="padding:8px 0;border-bottom:1px solid #EEF1F7;text-align:right"><b>${v}</b></td></tr>`).join("")}</table>
    <h3 style="margin:0 0 6px;font-size:15px">Principais motivos de contato</h3><table style="width:100%;margin-bottom:16px">${linhas(mot) || '<tr><td style="color:#5B6478">Sem motivos registrados.</td></tr>'}</table>
    <h3 style="margin:0 0 6px;font-size:15px">Nota por atendente</h3><table style="width:100%">${Object.entries(porAt).map(([k, l]) => `<tr><td style="padding:4px 10px 4px 0">${k}</td><td style="text-align:right"><b>${(l.reduce((s, x) => s + x, 0) / l.length).toFixed(1)}</b> (${l.length})</td></tr>`).join("") || '<tr><td style="color:#5B6478">Sem notas na semana.</td></tr>'}</table></div>`;
  await enviarEmail({ para, assunto: `Atendimento NexumCell: ${total} atendimentos, nota ${media}, ${brl4(recuperado)} recuperado`, html });
  await marca.set({ em: Date.now(), total });
  return { relatorioCrm: "enviado", total };
}

// api/motor.js
init_base();
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
  serasaAuto: false,
  // consulta Serasa (Asaas, paga) para cliente novo antes de aprovar
  comprometimentoMax: 30,
  // a parcela não pode passar deste % da renda do cliente
  comprPrazoRef: 10,
  // prazo de referência (parcelas) para calcular o comprometimento
  entOuroPct: 20,
  entPrataPct: 20,
  entBronzePct: 35,
  entRiscoPct: 50
  // entrada mínima sugerida por faixa de risco
};
function entradaDaFaixa(R, faixa) {
  const m = { Ouro: R.entOuroPct, Prata: R.entPrataPct, Bronze: R.entBronzePct, Risco: R.entRiscoPct };
  return Math.max(0, Math.min(90, Number(m[faixa]) || 0));
}
var r23 = (x) => Math.round(x * 100) / 100;
var dias2 = (a, b) => Math.round((/* @__PURE__ */ new Date(b + "T12:00:00") - /* @__PURE__ */ new Date(a + "T12:00:00")) / 864e5);
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
        const d = p.pagoEm ? dias2(p.venc, String(p.pagoEm).slice(0, 10)) : 0;
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
function notaProposta(v, hist) {
  const c = v.cliente || {}, vf = v.verificacao || {}, f = vf.face || {}, cp = vf.comprovantes || {};
  const N = nota(hist, c.renda);
  let s = N.score;
  const motivos = [...N.motivos];
  const add = (p, t) => {
    s += p;
    motivos.push(`${t} (${p > 0 ? "+" : ""}${p})`);
  };
  const idade = c.nasc ? Math.floor((Date.now() - /* @__PURE__ */ new Date(c.nasc + "T12:00:00")) / 315576e5) : null;
  if (idade == null || isNaN(idade)) add(-30, "sem data de nascimento");
  else if (idade < 21) add(-60, `${idade} anos`);
  else if (idade < 26) add(-20, `${idade} anos`);
  else if (idade <= 55) add(20, `${idade} anos`);
  else if (idade > 65) add(-20, `${idade} anos`);
  const renda = Number(c.renda) || 0;
  if (renda < 1200) add(-60, "renda abaixo de R$ 1.200");
  else if (renda < 2e3) add(-20, "renda at\xE9 R$ 2.000");
  else if (renda >= 4e3) add(40, "renda acima de R$ 4.000");
  else if (renda >= 2500) add(20, "renda acima de R$ 2.500");
  if (cp.renda?.ok) add(40, "renda comprovada");
  else if (cp.renda?.alerta) add(-60, "comprovante de renda com alerta");
  else add(-15, "renda sem comprovante");
  if (cp.endereco?.ok) add(30, "endere\xE7o comprovado");
  else if (cp.endereco?.alerta) add(-40, "comprovante de endere\xE7o com alerta");
  if (vf.documentoOriginal === false) add(-150, "documento parece c\xF3pia ou foto de tela");
  else if (vf.documentoOriginal) add(20, "documento original");
  const ed = (vf.editados || []).length;
  if (ed) add(-Math.min(120, 40 * ed), "dados do documento editados \xE0 m\xE3o");
  if (f.mesma_pessoa === "sim") add((Number(f.confianca) || 0) >= 85 ? 50 : 30, "rosto confere com o documento");
  else if (f.mesma_pessoa === "nao") add(-300, "rosto N\xC3O confere com o documento");
  else if (f.mesma_pessoa) add(-60, "rosto com d\xFAvida");
  const tels = (c.telefones || []).filter(Boolean).length;
  if (tels >= 2) add(15, "2 ou mais telefones");
  else add(-20, "s\xF3 1 telefone");
  const refs = [c.ref1Nome, c.ref2Nome].filter((x) => String(x || "").trim().length > 2).length;
  if (refs >= 2) add(25, "2 refer\xEAncias");
  else if (!refs) add(-40, "sem refer\xEAncias");
  if (c.email) add(5, "tem e-mail");
  if ((v.alertasFraude || []).length) add(-200, "mesmo CPF ou telefone em outra loja");
  if (c.docValidade && c.docValidade < hoje()) add(-40, "documento vencido");
  s = Math.max(0, Math.min(1e3, Math.round(s)));
  const faixa = N.atrasoAberto ? "Risco" : s >= 750 ? "Ouro" : s >= 600 ? "Prata" : s >= 450 ? "Bronze" : "Risco";
  const mult = { Ouro: 2.5, Prata: 1.8, Bronze: 1.2, Risco: 0.5 }[faixa] * (hist.length ? 1 : 0.9);
  return { ...N, score: s, faixa, motivos, limite: N.atrasoAberto ? 0 : Math.round(renda * mult / 50) * 50 };
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
  const N = notaProposta(v, hist);
  const lnIds = ["cpf_" + v.clienteCpf, ...(c.telefones || []).map((t) => "tel_" + String(t).replace(/\D/g, ""))];
  const ln = (await Promise.all(lnIds.map((i) => db.collection("listanegra").doc(i).get()))).filter((d) => d.exists && d.data().ativo !== false).length;
  if (ln) reprova.push("cliente ou telefone na lista negra");
  const idade = c.nasc ? Math.floor((Date.now() - /* @__PURE__ */ new Date(c.nasc + "T12:00:00")) / 315576e5) : null;
  if (idade == null) manual.push("sem data de nascimento");
  else if (idade < R.idadeMin) reprova.push(`idade ${idade} abaixo de ${R.idadeMin}`);
  else if (idade > R.idadeMax) reprova.push(`idade ${idade} acima de ${R.idadeMax}`);
  if (!(c.renda >= R.rendaMin)) reprova.push(`renda abaixo do m\xEDnimo (R$ ${R.rendaMin})`);
  if (R.cidades) {
    const lista3 = R.cidades.split(",").map(sem).filter(Boolean);
    if (lista3.length && !lista3.includes(sem(c.cidade))) manual.push(`cidade fora da \xE1rea (${c.cidade || "\u2014"})`);
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
  let limite2 = preOk ? Math.max(pre.valor, N.limite) : Math.max(0, hist.length ? N.limite : Math.min(Math.round((c.renda || 0) * R.fatorRendaNovo / 50) * 50, R.limiteMaxNovo, N.limite || Infinity));
  const comprMax = Math.max(0, Number(R.comprometimentoMax) || 0);
  const prazoRef = Math.max(1, Number(R.comprPrazoRef) || 10);
  const parcelaMax = comprMax > 0 ? r23((Number(c.renda) || 0) * comprMax / 100) : 0;
  if (parcelaMax > 0 && limite2 > 0) {
    const limiteComp = Math.floor(parcelaMax * prazoRef / 50) * 50;
    if (limiteComp < limite2) {
      limite2 = Math.max(0, limiteComp);
      manual.push(`limite reduzido pelo comprometimento de renda (parcela m\xE1x. R$ ${parcelaMax} = ${comprMax}% da renda, em at\xE9 ${prazoRef}x)`);
    } else {
      ok.push(`parcela cabe no comprometimento (m\xE1x. R$ ${parcelaMax} = ${comprMax}% da renda)`);
    }
  }
  const entradaMin = entradaDaFaixa(R, N.faixa);
  const resultado2 = reprova.length ? "REPROVAR" : manual.length ? "MANUAL" : "APROVAR";
  const parecer = { resultado: resultado2, modo: R.modo, score: N.score, faixa: N.faixa, limite: limite2, entradaMin, parcelaMax, comprometimentoMax: comprMax, reprova, manual, ok: [...ok, ...N.motivos], alertas, em: Date.now() };
  const upd = { motor: parecer, ...alertas.length ? { alertasFraude: alertas } : {}, ...serasa ? { serasa } : {} };
  if (R.modo === "automatico" && resultado2 !== "MANUAL") {
    const status = resultado2 === "APROVAR" ? "APROVADA" : "REPROVADA";
    const entBase = Number(cfg.entradaPct) || 30;
    const contra = status === "APROVADA" && entradaMin > entBase ? { entradaPct: entradaMin, limite: limite2 || null } : null;
    Object.assign(upd, { status, analise: {
      resultado: status,
      por: "motor",
      porNome: "Motor de cr\xE9dito",
      em: Date.now(),
      score: N.score,
      limite: status === "APROVADA" ? limite2 : 0,
      obs: status === "APROVADA" ? "Aprovado automaticamente pelas regras de cr\xE9dito." + (contra ? ` Entrada m\xEDnima ${entradaMin}% pela faixa ${N.faixa}.` : "") : "Reprovado pelas regras: " + reprova.join("; "),
      checklist: { cpf: true, bio: true, doc: true },
      automatico: true,
      ...contra ? { contraproposta: contra } : {}
    } });
  }
  if (upd.status === "APROVADA" && preOk && !upd.analise?.contraproposta && (pre.entradaPct != null || pre.descontoPct)) {
    upd.analise.recompra = { entradaPct: Number(pre.entradaPct ?? 0), descontoJuros: Number(pre.descontoPct || 0) };
    if (pre.descontoPct > 0 && !(Number(v.vip?.descontoJuros) >= Number(pre.descontoPct))) upd.vip = { nivel: "Recompra", descontoJuros: Number(pre.descontoPct) };
    upd.analise.obs += ` Recompra: entrada a partir de ${upd.analise.recompra.entradaPct}% e ${upd.analise.recompra.descontoJuros} ponto(s) a menos de juros.`;
  }
  await ref.set(upd, { merge: true });
  await db.collection("logs").add({ em: Date.now(), acao: "Motor de cr\xE9dito: " + (upd.status || resultado2), alvo: vendaId, det: [...reprova, ...manual].join("; ").slice(0, 400), por: "Motor de cr\xE9dito" });
  return { resultado: resultado2, status: upd.status || "ANALISE", limite: limite2, score: N.score };
}
async function handler12(req, res) {
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
    const out = await avaliarVenda(id);
    if (quem.role === "GERENTE" || quem.role === "VENDEDOR") return res.status(200).json({ ok: true, status: out.status });
    return res.status(200).json(out);
  } catch (e) {
    console.error(e);
    return res.status(e.status || 500).json({ erro: e.message });
  }
}

// api/cron.js
init_brevo();
init_ios();

// api/equipe.js
init_base();
init_brevo();
var PRAZO_AUTO_MS = 2 * 36e5;
var PRE = { DONO: "DON", GERENTE: "GER", VENDEDOR: "VND", FINANCEIRO: "FIN", SUPORTE: "SUP" };
var ORIGEM = () => process.env.PORTAL_ORIGEM || "https://nexumrh.github.io";
var primeiroNome = (n) => String(n || "").trim().split(/\s+/)[0] || "";
var senha6 = () => String(Math.floor(1e5 + Math.random() * 9e5));
async function codigoLivre(role) {
  for (let i = 0; i < 30; i++) {
    const c = PRE[role] + "-" + String(Math.floor(1e3 + Math.random() * 9e3));
    if (!(await db.collection("logins").doc(c).get()).exists) return c;
  }
  throw new Error("n\xE3o foi poss\xEDvel gerar o ID");
}
async function aprovarCadastro(id, por = "Aprova\xE7\xE3o autom\xE1tica (2 h)") {
  const ref = db.collection("cadastrosVendedor").doc(id), c = (await ref.get()).data();
  if (!c || c.status !== "PENDENTE") return { ja: true };
  const loja = c.lojaId ? (await db.collection("lojas").doc(c.lojaId).get()).data() || {} : {};
  if (loja.bloqueada) return { pulou: "loja bloqueada" };
  const email = String(c.email || "").trim().toLowerCase();
  const ja = await db.collection("users").where("email", "==", email).get();
  if (!ja.empty) {
    await ref.set({ status: "RECUSADO", motivo: "Este e-mail j\xE1 tem acesso ao sistema", respondidoEm: Date.now(), respondidoPor: por }, { merge: true });
    return { recusado: true };
  }
  const role = "VENDEDOR", codigo2 = await codigoLivre(role), senha = senha6();
  const u = await auth.createUser({ email, password: senha, displayName: c.nome });
  const agora = Date.now();
  await db.collection("users").doc(u.uid).set({
    nome: c.nome,
    email,
    telefone: c.telefone || "",
    codigo: codigo2,
    role,
    lojaId: c.lojaId || "",
    ativo: true,
    senhaTemporaria: true,
    cpf: c.cpf || "",
    nascimento: c.nascimento || "",
    cargo: c.cargo || "Vendedor(a)",
    cadastradoPor: c.gerenteNome || "",
    criadoEm: agora,
    criadoPor: por,
    ...loja.bloqueada ? { lojaBloqueada: true } : {}
  });
  await db.collection("logins").doc(codigo2).set({ email, uid: u.uid });
  const url = ORIGEM() + "/vendedor/";
  const texto = `Ol\xE1, ${primeiroNome(c.nome)}!

Seu acesso \xE0 NexumCell foi criado${loja.nome ? ` (${loja.nome})` : ""}.

Portal: ${url}
Seu ID: ${codigo2}
Senha tempor\xE1ria: ${senha}

Entre com o ID e a senha tempor\xE1ria. No primeiro acesso voc\xEA cria a sua pr\xF3pria senha e faz o treinamento obrigat\xF3rio: as vendas liberam assim que voc\xEA concluir.`;
  let emailOk2 = false;
  if (brevoLigado()) {
    try {
      await enviarEmail({ para: email, assunto: "Seu acesso ao Portal do Vendedor \u2014 NexumCell", titulo: "Seu acesso \xE0 NexumCell", texto });
      emailOk2 = true;
    } catch (e) {
      console.warn("email acesso", e.message);
    }
  }
  await ref.set({ status: "APROVADO", uid: u.uid, codigo: codigo2, aprovadoEm: agora, aprovadoPor: por, automatico: por.startsWith("Aprova\xE7\xE3o autom\xE1tica"), emailEnviado: emailOk2 }, { merge: true });
  await db.collection("logs").add({ em: agora, acao: "Acesso criado (aprova\xE7\xE3o autom\xE1tica)", alvo: u.uid, detalhe: `${c.nome} \xB7 ${codigo2} \xB7 ${loja.nome || ""}${emailOk2 ? " \xB7 e-mail enviado" : " \xB7 e-mail N\xC3O enviado"}`, nome: por });
  if (c.gerenteUid) await db.collection("notificacoes").add({ para: c.gerenteUid, em: agora, lida: false, titulo: "Vendedor aprovado", texto: `${c.nome} j\xE1 pode entrar no Portal do Vendedor (ID ${codigo2}).${emailOk2 ? " O acesso foi enviado para o e-mail dele." : ""}` }).catch(() => {
  });
  return { ok: true, codigo: codigo2, emailOk: emailOk2 };
}
async function autoAprovarEquipe() {
  const cfg = await config();
  if (cfg.autoAprovarEquipe === "nao") return 0;
  const limite2 = Date.now() - PRAZO_AUTO_MS;
  const pend = (await db.collection("cadastrosVendedor").where("status", "==", "PENDENTE").get()).docs.filter((d) => (d.data().criadoEm || 0) <= limite2).slice(0, 10);
  let n = 0;
  for (const d of pend) {
    try {
      const r = await aprovarCadastro(d.id);
      if (r.ok) n++;
    } catch (e) {
      console.warn("autoAprovar", d.id, e.message);
    }
  }
  return n;
}
async function handler13(req, res) {
  if (cors(req, res)) return;
  try {
    if (req.method !== "POST") return res.status(405).json({ erro: "use POST" });
    await exigirEquipe(req, ["DONO", "FINANCEIRO", "GERENTE", "SUPORTE"]);
    const acao = String(req.body?.acao || "autoAprovar");
    if (acao === "autoAprovar") return res.json({ ok: true, aprovados: await autoAprovarEquipe() });
    res.status(400).json({ erro: "a\xE7\xE3o desconhecida" });
  } catch (e) {
    res.status(e.status || 500).json({ erro: e.message });
  }
}

// api/crm-auto.js
init_base();

// api/crm-ia.js
init_base();
init_erros();
init_crm_rotinas();

// api/crm-extra.js
init_base();
init_erros();
init_brevo();
var erro5 = (m, s = 400) => Object.assign(new Error(m), { status: s });
var kSafe = (k) => String(k).replace(/[/:]/g, "_");
async function transcrever(b) {
  const chave = await chaveIA();
  if (!chave) throw erro5("IA sem chave");
  const b64 = String(b.audio || "").replace(/^data:[^,]+,/, "");
  if (!b64 || b64.length > 9e6) throw erro5("\xC1udio vazio ou longo demais (m\xE1ximo 3 minutos)");
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)), tipo = String(b.tipo || "audio/webm");
  const fd = new FormData();
  fd.append("file", new Blob([bin], { type: tipo }), "audio." + (tipo.includes("mp4") ? "mp4" : tipo.includes("ogg") ? "ogg" : "webm"));
  fd.append("model", "whisper-large-v3-turbo");
  fd.append("language", b.idioma === "es" ? "es" : "pt");
  fd.append("response_format", "json");
  const r = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", { method: "POST", headers: { Authorization: "Bearer " + chave }, body: fd });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw erro5("Transcri\xE7\xE3o: " + (j.error?.message || r.status), 502);
  return { texto: String(j.text || "").trim() };
}
async function traduzir(b) {
  const textos = (Array.isArray(b.textos) ? b.textos : [b.texto]).filter(Boolean).slice(0, 20).map((t2) => String(t2).slice(0, 1200)), para = b.para === "es" ? "espanhol" : "portugu\xEAs do Brasil";
  if (!textos.length) return { textos: [] };
  const t = await groq([{ role: "system", content: `Voc\xEA traduz mensagens de atendimento para ${para}, mantendo o tom, os n\xFAmeros, os links e os nomes. Responda s\xF3 em JSON: {"t":["tradu\xE7\xE3o 1","tradu\xE7\xE3o 2",...]} na mesma ordem.` }, { role: "user", content: JSON.stringify(textos) }], { temperatura: 0, max: 1500, json: true });
  let j = {};
  try {
    j = JSON.parse(t);
  } catch (e) {
  }
  return { textos: Array.isArray(j.t) ? j.t.map(String) : [] };
}
async function qualidade(b, eu) {
  const conversa = String(b.conversa || "").slice(-9e3);
  if (conversa.length < 20) return { pulado: true };
  const artigos = (await db.collection("crmArtigos").where("status", "in", ["aprovado", "sugerido"]).get().catch(() => ({ docs: [] }))).docs.map((d) => d.data().titulo).filter(Boolean);
  const temas = [...Object.values(ERROS).map((e) => e.t), ...artigos, "Instalar a trava pelo QR", "Instalar a trava pela USB", "Cliente pagou e n\xE3o liberou", "Pix das parcelas", "Cadastrar notebook", "Venda a dist\xE2ncia", "Foto do documento", "Licen\xE7as", "Senha e acesso"];
  const t = await groq([
    { role: "system", content: "Voc\xEA \xE9 o controle de qualidade do atendimento da NexumCell (celular parcelado com trava). Avalie com justi\xE7a o trabalho do ATENDENTE da NexumCell na conversa (n\xE3o o cliente). Considere: educa\xE7\xE3o, se resolveu ou encaminhou certo, agilidade e clareza. Responda s\xF3 em JSON." },
    { role: "user", content: `Atendente: ${String(b.atendenteNome || "").slice(0, 40)}
Canal: ${String(b.canal || "").slice(0, 30)}

Conversa:
${conversa}

Temas que j\xE1 t\xEAm artigo na Central de ajuda: ${temas.join("; ")}

JSON: {"nota":0-10,"educacao":0-10,"agilidade":0-10,"clareza":0-10,"resolveu":true|false,"pontos_fortes":["at\xE9 2"],"melhorar":["at\xE9 2, concretos"],"resumo":"1 frase","artigo":{"novo":true|false,"titulo":"","problema":"","passos":["passo 1","..."]}}. S\xF3 marque artigo.novo=true se a conversa ensinou uma solu\xE7\xE3o \xFAtil para outras lojas que N\xC3O est\xE1 nos temas acima.` }
  ], { temperatura: 0.1, max: 700, json: true });
  let j = {};
  try {
    j = JSON.parse(t);
  } catch (e) {
    return { pulado: true };
  }
  const n = (v) => Math.max(0, Math.min(10, Math.round(+v || 0)));
  const q = {
    key: String(b.key || ""),
    canal: String(b.canal || ""),
    uid: String(b.atendenteUid || ""),
    nome: String(b.atendenteNome || ""),
    nota: n(j.nota),
    educacao: n(j.educacao),
    agilidade: n(j.agilidade),
    clareza: n(j.clareza),
    resolveu: !!j.resolveu,
    fortes: (j.pontos_fortes || []).slice(0, 2).map(String),
    melhorar: (j.melhorar || []).slice(0, 2).map(String),
    resumo: String(j.resumo || "").slice(0, 240),
    em: Date.now(),
    por: "IA",
    pedidoPor: eu.nome || ""
  };
  if (q.key) await db.collection("crmQualidade").doc(kSafe(q.key)).set(q);
  const a = j.artigo || {};
  let artigo = null;
  if (a.novo && a.titulo && Array.isArray(a.passos) && a.passos.length >= 2) {
    artigo = { titulo: String(a.titulo).slice(0, 90), problema: String(a.problema || "").slice(0, 300), passos: a.passos.slice(0, 8).map((p) => String(p).slice(0, 300)), status: "sugerido", origem: q.key, sugeridoEm: Date.now(), atendente: q.nome };
    const ref = await db.collection("crmArtigos").add(artigo);
    artigo.id = ref.id;
  }
  return { ...q, artigo };
}
async function artigosAprovados() {
  return (await db.collection("crmArtigos").where("status", "==", "aprovado").get()).docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.titulo || "").localeCompare(b.titulo || ""));
}
async function artigosTexto() {
  const l = await artigosAprovados().catch(() => []);
  if (!l.length) return "";
  return "Artigos da Central de ajuda aprovados pela equipe:\n" + l.map((a) => `- ${a.titulo}: ${a.problema || ""} Passos: ${(a.passos || []).join(" ")}`).join("\n");
}
async function ajudaArtigos(req, res) {
  if (cors(req, res)) return;
  try {
    const l = await artigosAprovados();
    res.setHeader?.("Cache-Control", "public, max-age=300");
    return res.json({ artigos: l.map((a) => ({ id: a.id, titulo: a.titulo, problema: a.problema || "", passos: a.passos || [] })) });
  } catch (e) {
    return res.status(500).json({ erro: e.message });
  }
}
function noTurno(e, agora = Date.now()) {
  if (!e || !Array.isArray(e.dias)) return true;
  const br = new Date(agora - 3 * 36e5), d = br.getUTCDay(), min = br.getUTCHours() * 60 + br.getUTCMinutes(), hm = (s) => {
    const [h, m] = String(s || "0:0").split(":").map(Number);
    return h * 60 + (m || 0);
  };
  return e.dias.includes(d) && min >= hm(e.ini || "00:00") && min < hm(e.fim || "23:59");
}
async function incidentesRotina() {
  const agora = Date.now(), l = (await db.collection("atendimentos").where("criadoEm", ">=", agora - 60 * 6e4).get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  const por = {};
  l.forEach((a) => (a.codigos || []).forEach((c) => {
    por[c] ||= { lojas: /* @__PURE__ */ new Set(), keys: [] };
    por[c].lojas.add(a.lojaNome || a.lojaId || a.abertoPor);
    por[c].keys.push("portal:" + a.id);
  }));
  let n = 0;
  for (const [c, v] of Object.entries(por)) {
    if (v.lojas.size < 3) continue;
    const id = `inc_${c}_${new Date(agora - 3 * 36e5).toISOString().slice(0, 13)}`, ref = db.collection("crmIncidentes").doc(id), s = await ref.get();
    if (s.exists && s.data().avisadoEm) continue;
    await ref.set({ codigo: c, titulo: ERROS[c]?.t || "Erro " + c, lojas: [...v.lojas].slice(0, 30), keys: [.../* @__PURE__ */ new Set([...s.exists ? s.data().keys || [] : [], ...v.keys])].slice(0, 200), aberto: true, em: s.exists ? s.data().em : agora, origem: "autom\xE1tico", avisadoEm: agora }, { merge: true });
    if (brevoLigado() && process.env.DONO_EMAIL) await enviarEmail({ para: process.env.DONO_EMAIL, assunto: `Poss\xEDvel problema geral: erro ${c} em ${v.lojas.size} lojas na \xFAltima hora`, html: `<div style="font-family:Arial,sans-serif;color:#0A1733"><h2 style="margin:0 0 8px">Erro ${c} \xB7 ${ERROS[c]?.t || ""}</h2><p>${v.lojas.size} lojas mandaram o mesmo c\xF3digo na \xFAltima hora: ${[...v.lojas].slice(0, 10).join(", ")}.</p><p>Pode ser um problema geral (servidor, app ou configura\xE7\xE3o). No CRM, o incidente j\xE1 aparece no topo da caixa de entrada: d\xE1 para responder todos de uma vez e, ao resolver, avisar todo mundo automaticamente.</p></div>` }).catch(() => {
    });
    n++;
  }
  return { incidentes: n };
}

// api/crm-ia.js
var MODELO3 = process.env.GROQ_MODELO_CRM || "llama-3.3-70b-versatile";
var REGRAS = "Voc\xEA trabalha no atendimento da NexumCell, que vende celulares parcelados com trava do aparelho e oferece cr\xE9dito. Responda sempre em portugu\xEAs do Brasil, com educa\xE7\xE3o e frases curtas. Nunca prometa aprova\xE7\xE3o de cr\xE9dito, desconto ou libera\xE7\xE3o que a equipe n\xE3o confirmou. Nunca pe\xE7a senha, c\xF3digo ou pagamento em conta de terceiros. Pagamento \xE9 s\xF3 pelo app NexumCell (aba Parcelas \u2192 Pix) ou pelo Pix enviado pela equipe. N\xE3o use emojis.";
var ESTILOS = {
  curta: "Reescreva a mensagem de forma mais curta e direta, mantendo todas as informa\xE7\xF5es importantes.",
  formal: "Reescreva a mensagem num tom mais formal e profissional, como um banco.",
  empatica: "Reescreva a mensagem num tom mais acolhedor e emp\xE1tico, mostrando que entendemos a situa\xE7\xE3o do cliente, sem perder a clareza.",
  firme: "Reescreva a mensagem num tom firme e respeitoso de cobran\xE7a, deixando claro o valor, o prazo e o que acontece se n\xE3o pagar, sem amea\xE7as.",
  corrigir: "Corrija a ortografia, a pontua\xE7\xE3o e a clareza da mensagem, mudando o m\xEDnimo poss\xEDvel."
};
var IDIOMAS = { es: "espanhol (do Paraguai/Argentina, claro e simples)", pt: "portugu\xEAs do Brasil", en: "ingl\xEAs simples" };
async function groq(mensagens, { temperatura = 0.3, max = 400, json = false, modelo = MODELO3 } = {}) {
  const chave = await chaveIA();
  if (!chave) throw Object.assign(new Error("IA sem chave: coloque a chave da IA em Configura\xE7\xF5es do Painel do Dono"), { status: 400 });
  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: "Bearer " + chave, "Content-Type": "application/json" },
    body: JSON.stringify({ model: modelo, temperature: temperatura, max_tokens: max, ...json ? { response_format: { type: "json_object" } } : {}, messages: mensagens })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error("IA: " + (j.error?.message || r.status)), { status: 502 });
  return String(j.choices?.[0]?.message?.content || "").trim();
}
async function baseConhecimento() {
  const c = (await db.collection("config").doc("crm").get()).data() || {}, artTxt = await artigosTexto().catch(() => "");
  const v2 = Array.isArray(c.respostasV2) ? c.respostasV2.map((r) => [r.g, r.t, r.x]) : [];
  const v1 = Array.isArray(c.respostas) ? c.respostas.flatMap((g) => Array.isArray(g) ? (g[1] || []).map((r) => [g[0], r?.[0] ?? r?.t, r?.[1] ?? r?.x]) : []) : [];
  const rs = (v2.length ? v2 : v1).filter((r) => r[2]).map(([g, t, x]) => `- ${g} / ${t}: ${String(x || "").replace(/\s+/g, " ").slice(0, 400)}`).slice(0, 80).join("\n");
  return { cfg: c, texto: `${c.iaOrientacoes ? "Orienta\xE7\xF5es do dono:\n" + String(c.iaOrientacoes).slice(0, 2500) + "\n\n" : ""}Respostas aprovadas pela equipe (use como base, troque {vari\xE1veis} pelos dados reais ou deixe de fora):
${rs}${artTxt ? "\n\n" + artTxt : ""}` };
}
var PEDIDO_AUTO = 'Voc\xEA est\xE1 respondendo sozinho porque a equipe n\xE3o est\xE1 dispon\xEDvel agora. Responda a \xDALTIMA mensagem do cliente usando s\xF3 as informa\xE7\xF5es da ficha, das orienta\xE7\xF5es e das respostas aprovadas. Se o cliente pedir para falar com uma pessoa, reclamar, pedir desconto, acordo, libera\xE7\xE3o do aparelho, cancelamento, troca, ou se voc\xEA n\xE3o tiver a informa\xE7\xE3o, diga com educa\xE7\xE3o que um atendente vai continuar o atendimento assim que poss\xEDvel e marque humano=true. Responda em JSON: {"resposta":"texto de no m\xE1ximo 4 frases","humano":true|false}. Se o cliente escreveu em espanhol, responda em espanhol.';
async function handler14(req, res) {
  if (cors(req, res)) return;
  try {
    const eu = await exigirEquipe(req, ["DONO", "SUPORTE", "FINANCEIRO", "COMERCIAL"]);
    const b = req.body || {}, txt6 = String(b.texto || "").slice(0, 4e3);
    const EXTRA = { transcrever, traduzir, qualidade };
    if (EXTRA[b.acao]) return res.json(await EXTRA[b.acao](b, eu));
    if (b.acao === "relatorioHoje") {
      const { relatorioDiarioCrm: relatorioDiarioCrm2 } = await Promise.resolve().then(() => (init_crm_rotinas(), crm_rotinas_exports));
      await relatorioDiarioCrm2({}, true);
      return res.json({ ok: true });
    }
    if (b.acao === "status") {
      const chave = await chaveIA().catch(() => "");
      if (!chave) return res.json({ chave: false, ok: false, erro: "Nenhuma chave da IA salva. Cole a chave do Groq (come\xE7a com gsk_) em Ajustes do CRM ou no Painel do Dono \u2192 Configura\xE7\xF5es \u2192 Intelig\xEAncia artificial." });
      const t0 = Date.now();
      try {
        const r = await groq([{ role: "user", content: "Responda s\xF3: OK" }], { max: 5, temperatura: 0 });
        return res.json({ chave: true, ok: /ok/i.test(r), ms: Date.now() - t0, modelo: MODELO3, final: chave.slice(-4) });
      } catch (e) {
        return res.json({ chave: true, ok: false, ms: Date.now() - t0, modelo: MODELO3, final: chave.slice(-4), erro: e.message });
      }
    }
    if (b.acao === "reescrever") {
      if (!txt6.trim()) throw Object.assign(new Error("Escreva a mensagem primeiro"), { status: 400 });
      return res.json({ texto: await groq([{ role: "system", content: REGRAS }, { role: "user", content: `${ESTILOS[b.estilo] || ESTILOS.corrigir} Devolva s\xF3 a mensagem pronta, sem aspas e sem coment\xE1rios.

Mensagem:
${txt6}` }], { temperatura: 0.3 }) });
    }
    if (b.acao === "traduzir") {
      if (!txt6.trim()) throw Object.assign(new Error("Nada para traduzir"), { status: 400 });
      return res.json({ texto: await groq([{ role: "system", content: "Voc\xEA \xE9 um tradutor. Devolva s\xF3 a tradu\xE7\xE3o, sem aspas e sem coment\xE1rios." }, { role: "user", content: `Traduza para ${IDIOMAS[b.idioma] || IDIOMAS.pt}:

${txt6}` }], { temperatura: 0.1 }) });
    }
    if (b.acao === "modelo") {
      const p = String(b.pedido || "").slice(0, 600);
      if (p.length < 5) throw Object.assign(new Error("Descreva a situa\xE7\xE3o"), { status: 400 });
      const t2 = await groq([{ role: "system", content: REGRAS }, { role: "user", content: `Escreva uma resposta r\xE1pida (modelo reutiliz\xE1vel) para o atendimento usar nesta situa\xE7\xE3o: "${p}". Use estas vari\xE1veis quando fizer sentido: {nome} (primeiro nome do cliente), {atendente}, {protocolo}, {contrato}, {parcela}, {valor}, {venc}, {loja}. No m\xE1ximo 4 frases. Responda em JSON: {"titulo":"t\xEDtulo curto de at\xE9 4 palavras","categoria":"Sauda\xE7\xE3o|Pagamento|Cobran\xE7a|Aparelho|Cr\xE9dito|Suporte|Encerramento","texto":"..."}` }], { temperatura: 0.4, json: true });
      let j2 = {};
      try {
        j2 = JSON.parse(t2);
      } catch (e) {
        j2 = { titulo: "Nova resposta", categoria: "Suporte", texto: t2 };
      }
      return res.json(j2);
    }
    if (b.acao === "comprovante") {
      const img2 = String(b.imagem || "");
      if (!/^data:image\/(png|jpe?g|webp);base64,/.test(img2) || img2.length > 55e5) throw Object.assign(new Error("Mande uma foto (JPG ou PNG) de at\xE9 4 MB"), { status: 400 });
      const t2 = await groq(
        [
          { role: "system", content: "Voc\xEA l\xEA comprovantes de pagamento brasileiros (Pix, TED, boleto, dep\xF3sito). Extraia os dados exatamente como aparecem. N\xE3o invente: campo que n\xE3o aparece fica vazio." },
          { role: "user", content: [{ type: "text", text: 'Leia este comprovante e responda em JSON: {"ehComprovante":true|false,"tipo":"PIX|TED|BOLETO|DEPOSITO|OUTRO","valor":0.00,"data":"AAAA-MM-DD","hora":"HH:MM","pagador":"nome de quem pagou","recebedor":"nome de quem recebeu","banco":"banco ou app","idTransacao":"c\xF3digo/ID/autentica\xE7\xE3o da transa\xE7\xE3o","duvidas":"algo estranho na imagem (editada, cortada, valor ileg\xEDvel) ou vazio"}' }, { type: "image_url", image_url: { url: img2 } }] }
        ],
        { temperatura: 0, max: 400, json: true, modelo: process.env.GROQ_MODELO_VISAO || "meta-llama/llama-4-scout-17b-16e-instruct" }
      );
      let j2 = {};
      try {
        j2 = JSON.parse(t2);
      } catch (e) {
        throw Object.assign(new Error("A IA n\xE3o conseguiu ler o comprovante"), { status: 502 });
      }
      const id = String(j2.idTransacao || "").replace(/\s+/g, "").slice(0, 80), usado = id ? (await db.collection("comprovantes").doc(id.replace(/[\/]/g, "_")).get()).data() : null;
      return res.json({ ...j2, valor: Math.round((+String(j2.valor || 0).toString().replace(",", ".") || 0) * 100) / 100, idTransacao: id, jaUsado: usado ? { em: usado.em, vendaNumero: usado.vendaNumero, parcela: usado.n, por: usado.por } : null });
    }
    if (b.acao === "baixarComprovante") {
      const eu2 = await exigirEquipe(req, ["DONO", "FINANCEIRO"]);
      const id = String(b.idTransacao || "").replace(/\s+/g, "").slice(0, 80), n = +b.n, valor = Math.round(+b.valor * 100) / 100;
      if (!b.vendaId || !(n > 0) || !(valor > 0)) throw Object.assign(new Error("Escolha a parcela e o valor"), { status: 400 });
      const vref = db.collection("vendas").doc(String(b.vendaId)), v = (await vref.get()).data();
      if (!v) throw Object.assign(new Error("Contrato n\xE3o encontrado"), { status: 404 });
      const p = (v.parcelas || []).find((x) => x.n === n);
      if (!p || p.pago) throw Object.assign(new Error("Essa parcela j\xE1 est\xE1 paga"), { status: 409 });
      if (id) {
        const cref = db.collection("comprovantes").doc(id.replace(/[\/]/g, "_"));
        await db.runTransaction(async (t2) => {
          const c = await t2.get(cref);
          if (c.exists) throw Object.assign(new Error(`Este comprovante j\xE1 foi usado no contrato n\xBA ${c.data().vendaNumero}, parcela ${c.data().n}`), { status: 409 });
          t2.set(cref, { em: Date.now(), vendaId: b.vendaId, vendaNumero: v.numero, n, valor, data: String(b.data || "").slice(0, 10), por: eu2.nome, arquivoId: String(b.arquivoId || "").slice(0, 60) });
        });
      }
      await baixarParcela(String(b.vendaId), n, valor, "PIX (comprovante)", `Comprovante lido no CRM${id ? " \xB7 ID " + id : ""}${b.data ? " \xB7 pago em " + String(b.data).slice(0, 10) : ""}`, eu2.nome + " (CRM)");
      if (p.asaasId) await asaas("/payments/" + p.asaasId, { method: "DELETE" }).catch(() => {
      });
      return res.json({ ok: true });
    }
    const conversa = String(b.conversa || "").slice(-9e3), ficha = String(b.ficha || "").slice(0, 2500);
    if (b.acao === "automatica") {
      const base3 = await baseConhecimento();
      const t2 = await groq([{ role: "system", content: REGRAS + "\n\n" + base3.texto }, { role: "user", content: `Canal: ${String(b.canal || "").slice(0, 40)}
Cliente: ${String(b.cliente || "").slice(0, 80)}

Ficha do cliente:
${ficha}

Conversa:
${conversa}

${PEDIDO_AUTO}` }], { temperatura: 0.2, json: true });
      let j2 = {};
      try {
        j2 = JSON.parse(t2);
      } catch (e) {
        j2 = { resposta: t2, humano: true };
      }
      return res.json({ texto: String(j2.resposta || ""), humano: !!j2.humano });
    }
    if (!conversa.trim()) throw Object.assign(new Error("A conversa ainda est\xE1 vazia"), { status: 400 });
    const base2 = await baseConhecimento().catch(() => ({ texto: "" }));
    const cods = codigosNoTexto(conversa), equipe = /portais|chamado/i.test(String(b.canal || ""));
    const quem = equipe ? "um vendedor ou gerente de loja parceira (equipe da loja, n\xE3o o cliente final)" : "o cliente";
    const conhecimento = `${REGRAS}

C\xF3digos de erro do sistema (use quando aparecerem na conversa; para vendedor/gerente, indique o link ${AJUDA_URL}#erro-CODIGO):
${errosTexto()}

${base2.texto || ""}`;
    if (b.acao === "resumo") {
      const t2 = await groq([{ role: "system", content: conhecimento }, { role: "user", content: `Canal: ${String(b.canal || "").slice(0, 40)}
Quem escreve: ${quem} (${String(b.cliente || "").slice(0, 80)})

Ficha:
${ficha}

Conversa:
${conversa}

Fa\xE7a o resumo para o atendente em JSON: {"pedido":"o que a pessoa quer, em 1 frase","feito":"o que j\xE1 foi feito, em 1 frase (ou vazio)","falta":"pr\xF3ximo passo do atendente, em 1 frase","humor":"calmo|ansioso|irritado","urgencia":"baixa|media|alta","codigos":["c\xF3digos de erro citados"]}` }], { temperatura: 0.1, max: 350, json: true });
      let j2 = {};
      try {
        j2 = JSON.parse(t2);
      } catch (e) {
        j2 = { pedido: t2 };
      }
      const texto = [j2.pedido && "- Pedido: " + j2.pedido, j2.feito && "- J\xE1 feito: " + j2.feito, j2.falta && "- Pr\xF3ximo passo: " + j2.falta].filter(Boolean).join("\n");
      return res.json({ texto, ...j2, codigos: [.../* @__PURE__ */ new Set([...(j2.codigos || []).map(String), ...cods])] });
    }
    const ex = await exemplosBons();
    const t = await groq([{ role: "system", content: conhecimento + (ex ? "\n\n" + ex : "") }, { role: "user", content: `Canal: ${String(b.canal || "").slice(0, 40)}
Quem escreve: ${quem} (${String(b.cliente || "").slice(0, 80)})
Atendente: ${String(b.atendente || "").slice(0, 30)}

Ficha:
${ficha}

Conversa:
${conversa}

Escreva a PR\xD3XIMA mensagem que o atendente deve mandar, pronta para enviar: resolva o que foi pedido com passos claros (numerados se for um procedimento), use os dados da ficha quando ajudarem, as respostas aprovadas como base e, se houver c\xF3digo de erro, o passo a passo dele. No m\xE1ximo 6 linhas, sem sauda\xE7\xE3o repetida se a conversa j\xE1 come\xE7ou. ${ESTILOS[b.estilo] ? "Estilo: " + ESTILOS[b.estilo] : ""} Se a pessoa escreveu em espanhol, responda em espanhol. Responda em JSON: {"resposta":"mensagem pronta","alternativa":"uma segunda vers\xE3o mais curta","motivo":"por que essa \xE9 a melhor resposta, em 1 frase"}` }], { temperatura: 0.35, max: 600, json: true });
    let j = {};
    try {
      j = JSON.parse(t);
    } catch (e) {
      j = { resposta: t };
    }
    return res.json({ texto: String(j.resposta || "").trim(), alternativa: String(j.alternativa || "").trim(), motivo: String(j.motivo || ""), codigos: cods });
  } catch (e) {
    return res.status(e.status || 500).json({ erro: e.message });
  }
}

// api/crm-auto.js
var MAX_SEGUIDAS = 3;
var brl5 = (n) => "R$ " + (Number(n) || 0).toFixed(2).replace(".", ",");
var fmtD = (d) => String(d || "").slice(0, 10).split("-").reverse().join("/");
function dentroDoHorario(cfg, agora = Date.now()) {
  const d = new Date(agora - 3 * 36e5), dia = d.getUTCDay(), m = d.getUTCHours() * 60 + d.getUTCMinutes();
  const hm = (s, p) => {
    const [h, mi] = String(s || p).split(":").map(Number);
    return h * 60 + (mi || 0);
  };
  if (dia === 0 && !cfg.iaDomingo) return false;
  const ini = hm(cfg.iaHoraIni, "08:00"), fim = hm(dia === 6 ? cfg.iaHoraFimSab || "13:00" : cfg.iaHoraFim, "19:00");
  return m >= ini && m < fim;
}
async function fichaDe({ cpf, token, numero }) {
  let vs = [];
  try {
    if (cpf) vs = (await db.collection("vendas").where("clienteCpf", "==", cpf).get()).docs.map((d) => d.data());
    else if (token) vs = (await db.collection("vendas").where("aparelhoToken", "==", token).get()).docs.map((d) => d.data());
    else if (numero) vs = (await db.collection("vendas").where("numero", "==", Number(numero)).get()).docs.map((d) => d.data());
  } catch (e) {
  }
  if (!vs.length) return "Cliente sem contrato encontrado.";
  const h = hoje();
  return vs.filter((v) => !["REPROVADA", "CANCELADA"].includes(v.status)).slice(0, 3).map((v) => {
    const ab = (v.parcelas || []).filter((p) => !p.pago).sort((a, b) => a.venc.localeCompare(b.venc)), atr = ab.filter((p) => p.venc < h);
    return `Contrato n\xBA ${v.numero} (${v.status}) \xB7 ${[v.aparelho?.marca, v.aparelho?.modelo].filter(Boolean).join(" ")} \xB7 loja ${v.lojaNome || ""}. ${ab.length} parcela(s) em aberto${ab[0] ? `, a pr\xF3xima \xE9 a ${ab[0].n}\xAA de ${brl5(ab[0].valor)} com vencimento em ${fmtD(ab[0].venc)}` : ""}. ` + (atr.length ? `${atr.length} em atraso, total ${brl5(atr.reduce((s, p) => s + (+p.valor || 0), 0))} (desde ${fmtD(atr[0].venc)}).` : "Sem atraso.");
  }).join("\n");
}
async function responder(base2, canal, cliente, ficha, conversa) {
  const t = await groq([{ role: "system", content: REGRAS + "\n\n" + base2.texto }, { role: "user", content: `Canal: ${canal}
Cliente: ${cliente}

Ficha do cliente:
${ficha}

Conversa:
${conversa}

${PEDIDO_AUTO}` }], { temperatura: 0.2, max: 350, json: true });
  let j = {};
  try {
    j = JSON.parse(t);
  } catch (e) {
    j = { resposta: "", humano: true };
  }
  const resposta = String(j.resposta || "").trim() || "Recebemos a sua mensagem. Um atendente da NexumCell vai continuar o seu atendimento assim que poss\xEDvel.";
  return { resposta, humano: !!j.humano };
}
var seguidasIA = (msgs, ehCliente) => {
  let n = 0;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (ehCliente(m)) continue;
    if (m.ia) n++;
    else if (!m.auto) break;
  }
  return n;
};
async function crmIaAutomatica() {
  const base2 = await baseConhecimento(), cfg = base2.cfg;
  if (!cfg.iaAuto) return { iaAuto: "desligada" };
  if (cfg.iaAutoSoFora && dentroDoHorario(cfg)) return { iaAuto: "hor\xE1rio de atendimento" };
  const espera = Math.max(1, Number(cfg.iaAutoMin) || 5) * 6e4, agora = Date.now(), r = { iaApp: 0, iaWa: 0, iaHumano: 0 };
  const sa = (await db.collection("suporteApp").where("naoLidoSuporte", "==", true).get()).docs;
  for (const s of sa.slice(0, 25)) {
    const c = s.data();
    if (c.iaHumano && (c.iaUltimaEm || 0) > agora - 864e5 || (c.atualizadoEm || 0) > agora - espera) continue;
    const msgs = (await s.ref.collection("msgs").get()).docs.map((d) => d.data()).sort((a, b) => a.em - b.em), ult = msgs[msgs.length - 1];
    if (!ult || ult.de !== "cliente" || ult.em > agora - espera || seguidasIA(msgs, (m) => m.de === "cliente") >= MAX_SEGUIDAS) continue;
    try {
      const conversa = msgs.slice(-14).map((m) => `${m.de === "cliente" ? "Cliente" : "NexumCell"}: ${String(m.texto || "").slice(0, 500)}`).join("\n");
      const x = await responder(base2, "chat do app", c.clienteNome || "Cliente", await fichaDe({ token: s.id, numero: c.vendaNumero }), conversa);
      await s.ref.collection("msgs").add({ de: "suporte", texto: x.resposta, em: Date.now(), porNome: "Assistente NexumCell", auto: true, ia: true });
      await s.ref.set({ naoLidoCliente: true, ultimaMsg: x.resposta.slice(0, 200), iaUltimaEm: Date.now(), ...x.humano ? { iaHumano: true } : {} }, { merge: true });
      pushNotificacao(s.id, "NexumCell respondeu", x.resposta.slice(0, 120)).catch(() => {
      });
      r.iaApp++;
      if (x.humano) r.iaHumano++;
    } catch (e) {
      console.error("ia app", e.message);
      if (/sem chave/.test(e.message)) return { iaAuto: e.message };
    }
  }
  if (cfg.iaAutoWa !== false) {
    const wa = (await db.collection("waConversas").where("naoLido", "==", true).get()).docs;
    for (const s of wa.slice(0, 25)) {
      const c = s.data();
      if (c.iaHumano && (c.iaUltimaEm || 0) > agora - 864e5 || c.aguardandoMenu || c.fim || (c.atualizadoEm || 0) > agora - espera) continue;
      const msgs = (await s.ref.collection("msgs").get()).docs.map((d) => d.data()).sort((a, b) => a.em - b.em), ult = msgs[msgs.length - 1];
      if (!ult || ult.de !== "cliente" || ult.em > agora - espera || seguidasIA(msgs, (m) => m.de === "cliente") >= MAX_SEGUIDAS) continue;
      try {
        const conversa = msgs.slice(-14).map((m) => `${m.de === "cliente" ? "Cliente" : "NexumCell"}: ${String(m.t || "").slice(0, 500)}`).join("\n");
        const x = await responder(base2, "WhatsApp", c.nome || "Cliente", await fichaDe({ cpf: c.cpf }), conversa);
        await db.collection("waSaida").add({ numero: s.id, texto: x.resposta, status: "PENDENTE", em: Date.now(), por: "Assistente NexumCell (IA)", ia: true });
        await s.ref.collection("msgs").add({ de: "equipe", t: x.resposta, em: Date.now(), por: "Assistente NexumCell (IA)", auto: true, ia: true });
        await s.ref.set({ ultimaMsg: x.resposta.slice(0, 200), ultimaDe: "equipe", iaUltimaEm: Date.now(), ...x.humano ? { iaHumano: true } : {} }, { merge: true });
        r.iaWa++;
        if (x.humano) r.iaHumano++;
      } catch (e) {
        console.error("ia wa", e.message);
        if (/sem chave/.test(e.message)) return { iaAuto: e.message };
      }
    }
  }
  return r;
}
async function agendadasRotina() {
  const agora = Date.now();
  let n = 0;
  const l = (await db.collection("crmAgendadas").where("status", "==", "PENDENTE").get()).docs.filter((d) => (d.data().quando || 0) <= agora && ["app", "portal"].includes(d.data().canal));
  for (const d of l.slice(0, 50)) {
    const a = d.data();
    try {
      if (a.canal === "app") {
        const ref = db.collection("suporteApp").doc(a.alvoId);
        await ref.collection("msgs").add({ de: "suporte", texto: a.texto, em: Date.now(), porNome: a.por || "NexumCell", agendada: true });
        await ref.set({ naoLidoCliente: true, ultimaMsg: String(a.texto).slice(0, 200), atualizadoEm: Date.now() }, { merge: true });
        pushNotificacao(a.alvoId, "NexumCell", String(a.texto).slice(0, 120)).catch(() => {
        });
      }
      if (a.canal === "portal") {
        const ref = db.collection("atendimentos").doc(a.alvoId), at = (await ref.get()).data() || {};
        await ref.set({ msgs: [...at.msgs || [], { de: "atendente", t: a.texto, em: Date.now(), por: a.por || "NexumCell", agendada: true }], naoLidoUser: true, atualizadoEm: Date.now() }, { merge: true });
      }
      await d.ref.set({ status: "ENVIADA", enviadaEm: Date.now() }, { merge: true });
      n++;
    } catch (e) {
      await d.ref.set({ status: "ERRO", erro: e.message }, { merge: true }).catch(() => {
      });
    }
  }
  return { agendadas: n };
}

// api/metas.js
init_base();
var SENHA_INICIAL = "123456";
var soD2 = (s) => String(s || "").replace(/\D/g, "");
var cpfOk2 = (c) => {
  c = soD2(c);
  if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false;
  for (const t of [9, 10]) {
    let s = 0;
    for (let i = 0; i < t; i++) s += +c[i] * (t + 1 - i);
    if (s * 10 % 11 % 10 !== +c[t]) return false;
  }
  return true;
};
var erro6 = (m, s = 400) => Object.assign(new Error(m), { status: s });
async function pessoaDo(cpf) {
  const l = (await db.collection("metasPessoas").where("cpf", "==", cpf).get()).docs.map((d) => ({ id: d.id, ref: d.ref, ...d.data() })).filter((p) => p.ativo !== false);
  return l.sort((a, b) => (b.atualizadoEm || 0) - (a.atualizadoEm || 0))[0] || null;
}
async function limitar(chave, max = 6) {
  const ref = db.collection("metasTentativas").doc(chave), d = (await ref.get()).data() || {}, agora = Date.now();
  const n = d.desde > agora - 15 * 6e4 ? d.n || 0 : 0;
  if (n >= max) throw erro6("Muitas tentativas. Espere 15 minutos e tente de novo.", 429);
  await ref.set({ n: n + 1, desde: n ? d.desde : agora }, { merge: true });
}
async function handler15(req, res) {
  if (cors(req, res)) return;
  try {
    const b = req.body || {}, cpf = soD2(b.cpf);
    if (!cpfOk2(cpf)) throw erro6("CPF inv\xE1lido.");
    const email = `${cpf}@metas.nexumcell.app`;
    if (b.acao === "status") {
      const ip = String(req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"] || "x").split(",")[0].trim();
      await limitar("ip_" + ip.replace(/[^\w]/g, "_") + "_" + hoje(), 60);
      const p = await pessoaDo(cpf);
      if (!p) return res.json({ existe: false });
      return res.json({ existe: true, ativado: !!(p.ativado && p.uid), precisaTrocar: !!(p.precisaTrocar !== false && !p.senhaTrocada), nome: String(p.nome || "").split(" ")[0] });
    }
    if (b.acao === "preparar") {
      await limitar("cpf_" + cpf);
      const p = await pessoaDo(cpf);
      if (!p) throw erro6("CPF n\xE3o cadastrado. Pe\xE7a ao seu gerente para cadastrar voc\xEA nas metas.", 404);
      if (p.senhaTrocada) throw erro6("Voc\xEA j\xE1 tem uma senha. Entre com o CPF e a sua senha. Esqueceu? Pe\xE7a ao gerente para liberar um novo primeiro acesso.", 409);
      let uid = p.uid;
      if (uid) await auth.updateUser(uid, { password: SENHA_INICIAL });
      else {
        try {
          uid = (await auth.createUser({ email, password: SENHA_INICIAL, displayName: p.nome || "" })).uid;
        } catch (e) {
          if (e.code === "auth/email-already-exists") throw erro6("Este CPF j\xE1 tinha um acesso. Pe\xE7a ao gerente para liberar um novo primeiro acesso.", 409);
          throw e;
        }
      }
      await p.ref.set({ uid, ativado: true, email, precisaTrocar: true, senhaTrocada: false, ativadoEm: p.ativadoEm || Date.now() }, { merge: true });
      await db.collection("metasAcesso").doc(uid).set({ cpf, escopo: p.escopo, pessoaId: p.id, nome: p.nome || "", em: Date.now() }, { merge: true });
      return res.json({ ok: true, email, senhaInicial: SENHA_INICIAL });
    }
    if (b.acao === "trocar") {
      await limitar("cpf_" + cpf);
      const idt = String(req.headers.authorization || "").replace("Bearer ", "");
      let u;
      try {
        u = await auth.verifyIdToken(idt);
      } catch (_) {
        throw erro6("Entre de novo e tente outra vez.", 401);
      }
      const p = await pessoaDo(cpf);
      if (!p || !p.uid) throw erro6("CPF n\xE3o encontrado.", 404);
      if (u.uid !== p.uid) throw erro6("N\xE3o foi poss\xEDvel confirmar o seu acesso. Entre de novo e tente outra vez.", 403);
      const senha = String(b.senha || "");
      if (senha.length < 6) throw erro6("A nova senha precisa ter pelo menos 6 caracteres.");
      if (senha === SENHA_INICIAL) throw erro6("Escolha uma senha diferente de 123456.");
      await auth.updateUser(p.uid, { password: senha });
      await p.ref.set({ precisaTrocar: false, senhaTrocada: true, senhaTrocadaEm: Date.now() }, { merge: true });
      await db.collection("metasTentativas").doc("cpf_" + cpf).set({ n: 0 }, { merge: true });
      return res.json({ ok: true });
    }
    throw erro6("A\xE7\xE3o inv\xE1lida.");
  } catch (e) {
    return res.status(e.status || 500).json({ erro: e.message });
  }
}
async function metasRotina() {
  const mes = hoje().slice(0, 7), ini = (/* @__PURE__ */ new Date(mes + "-01T00:00:00-03:00")).getTime();
  const todas = (await db.collection("metasPessoas").get()).docs.map((d) => d.data()).filter((p) => p.ativo !== false);
  const porEsc = {};
  let n = 0;
  for (const p of todas.filter((x) => x.vendedorUid)) {
    const vs = (await db.collection("vendas").where("vendedorUid", "==", p.vendedorUid).get()).docs.map((d) => d.data()).filter((v) => (v.criadoEm || 0) >= ini && ["ATIVA", "QUITADA"].includes(v.status));
    (porEsc[p.escopo] ||= {})[p.cpf] = { aparelhos: vs.length, faturamento: Math.round(vs.reduce((s, v) => s + (+v.valor || 0), 0) * 100) / 100, em: Date.now() };
    n++;
  }
  const crm = todas.filter((x) => x.usuarioUid);
  if (crm.length) {
    const [av, atr] = await Promise.all([db.collection("crmAvaliacoes").where("em", ">=", ini).get(), db.collection("crmAtrib").where("finalizadoEm", ">=", ini).get()]);
    const avs = av.docs.map((d) => d.data()), fins = atr.docs.map((d) => d.data());
    for (const p of crm) {
      const meu2 = avs.filter((a) => a.uid === p.usuarioUid), notas = meu2.map((a) => +a.nota || 0);
      (porEsc[p.escopo] ||= {})[p.cpf] = {
        ...(porEsc[p.escopo] || {})[p.cpf] || {},
        satMedia: notas.length ? Math.round(notas.reduce((s, x) => s + x, 0) / notas.length * 10) / 10 : 0,
        satBons: notas.filter((x) => x >= 4).length,
        satQtd: notas.length,
        atendidos: fins.filter((a) => a.finalizadoUid === p.usuarioUid).length,
        em: Date.now()
      };
      n++;
    }
  }
  for (const [esc, auto] of Object.entries(porEsc)) await db.collection("metasPlano").doc(`${esc}_${mes}`).set({ escopo: esc, mes, auto }, { merge: true });
  return { metasAuto: n };
}

// api/cron.js
init_crm_rotinas();

// api/comportamento.js
init_base();
var dias3 = (a, b) => Math.round((/* @__PURE__ */ new Date(b + "T12:00:00Z") - /* @__PURE__ */ new Date(String(a).slice(0, 10) + "T12:00:00Z")) / 864e5);
var soD3 = (s) => String(s || "").replace(/\D/g, "");
var isoBr = (ms) => new Date(ms - 3 * 36e5).toISOString();
async function alertar(id, a) {
  const ref = db.collection("alertasSeg").doc(id.replace(/[^\w-]/g, "_").slice(0, 140));
  if ((await ref.get()).exists) return 0;
  await ref.set({ em: Date.now(), visto: false, origem: "comportamento", ...a });
  return 1;
}
async function alertasComportamento(cfg = {}) {
  const agora = Date.now(), h = hoje(), desde = agora - 120 * 864e5;
  const vs = (await db.collection("vendas").where("criadoEm", ">=", desde).get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  const lojas = Object.fromEntries((await db.collection("lojas").get()).docs.map((d) => [d.id, d.data()]));
  let n = 0;
  const minEnt = Number(cfg.entradaPct) || 0;
  const v30 = vs.filter((v) => v.criadoEm >= agora - 30 * 864e5), porVend = {};
  v30.forEach((v) => {
    const k = v.vendedorUid || v.criadoPorUid;
    if (k) (porVend[k] ||= []).push(v);
  });
  for (const [uid, l] of Object.entries(porVend)) {
    const canc = l.filter((v) => v.status === "CANCELADA");
    if (canc.length >= 3 && canc.length / l.length >= 0.25)
      n += await alertar(`cmp_canc_${uid}_${h.slice(0, 7)}`, { tipo: "Muitos cancelamentos", detalhe: `${canc.length} de ${l.length} vendas canceladas nos \xFAltimos 30 dias. Confira os motivos e se o aparelho voltou para o estoque.`, nome: l[0].vendedorNome || "", role: "VENDEDOR", lojaNome: l[0].lojaNome || "", grav: canc.length >= 5 ? "alta" : "media", uid });
  }
  for (const v of vs.filter((x) => x.criadoEm >= agora - 7 * 864e5 && !["CANCELADA", "REPROVADA"].includes(x.status))) {
    const val = Number(v.valor) || 0, ent = Number(v.entrada) || 0;
    if (minEnt && val > 0 && ent / val * 100 < minEnt - 5)
      n += await alertar(`cmp_ent_${v.id}`, { tipo: "Entrada abaixo do m\xEDnimo", detalhe: `Contrato n\xBA ${v.numero}: entrada de ${Math.round(ent / val * 100)}% (m\xEDnimo ${minEnt}%). Confira se houve desconto autorizado.`, nome: v.vendedorNome || "", role: "VENDEDOR", lojaNome: v.lojaNome || "", grav: ent / val * 100 < minEnt / 2 ? "alta" : "media", vendaId: v.id });
    const hr = lojas[v.lojaId]?.horario;
    if (hr?.abre && hr?.fecha) {
      const t = isoBr(v.criadoEm), hm = t.slice(11, 16), dow = (/* @__PURE__ */ new Date(t.slice(0, 10) + "T12:00:00Z")).getUTCDay(), fecha = dow === 6 && hr.sabadoFecha ? hr.sabadoFecha : hr.fecha;
      if (dow === 0 && !hr.domingo || hm < hr.abre || hm > fecha)
        n += await alertar(`cmp_hor_${v.id}`, { tipo: "Venda fora do hor\xE1rio da loja", detalhe: `Contrato n\xBA ${v.numero} feito em ${t.slice(0, 10).split("-").reverse().join("/")} \xE0s ${hm} (loja abre ${hr.abre}\u2013${fecha}${dow === 0 ? ", domingo" : ""}).`, nome: v.vendedorNome || "", role: "VENDEDOR", lojaNome: v.lojaNome || "", grav: "media", vendaId: v.id });
    }
  }
  const porTel = {};
  vs.filter((v) => !["REPROVADA"].includes(v.status)).forEach((v) => {
    const t = soD3((v.cliente?.telefones || [])[0] || v.clienteTel1 || v.cliente?.telefone).slice(-11);
    if (t.length >= 10) (porTel[t] ||= []).push(v);
  });
  for (const [t, l] of Object.entries(porTel)) {
    const cpfs = [...new Set(l.map((v) => v.clienteCpf))];
    if (cpfs.length < 2) continue;
    n += await alertar(`cmp_tel_${t}_${cpfs.sort().join("_")}`, { tipo: "Mesmo telefone em CPFs diferentes", detalhe: `O telefone final ${t.slice(-4)} aparece em ${cpfs.length} clientes: ${l.map((v) => `${v.clienteNome} (n\xBA ${v.numero}, ${v.lojaNome || ""})`).join("; ")}.`, nome: [...new Set(l.map((v) => v.vendedorNome).filter(Boolean))].join(", "), role: "VENDEDOR", lojaNome: [...new Set(l.map((v) => v.lojaNome).filter(Boolean))].join(", "), grav: "alta" });
  }
  const fpd = {};
  vs.filter((v) => v.status !== "CANCELADA" && v.status !== "REPROVADA" && (v.parcelas || [])[0]).forEach((v) => {
    const p = v.parcelas[0];
    if (dias3(p.venc, h) < 5) return;
    const k = v.vendedorUid || v.criadoPorUid;
    if (!k) return;
    const r = fpd[k] ||= { n: 0, ruins: 0, nome: v.vendedorNome || "", loja: v.lojaNome || "" };
    r.n++;
    if (!p.pago) r.ruins++;
  });
  for (const [uid, r] of Object.entries(fpd)) if (r.ruins >= 3 && r.ruins / r.n >= 0.3)
    n += await alertar(`cmp_fpd_${uid}_${h.slice(0, 7)}`, { tipo: "Muitas 1\xAA parcelas n\xE3o pagas", detalhe: `${r.ruins} de ${r.n} clientes deste vendedor n\xE3o pagaram a 1\xAA parcela. Revise as vendas e o treinamento de an\xE1lise.`, nome: r.nome, role: "VENDEDOR", lojaNome: r.loja, grav: r.ruins / r.n >= 0.5 ? "alta" : "media", uid });
  return { alertasComportamento: n };
}

// api/cron.js
var dias4 = (a, b) => Math.round((new Date(b) - new Date(a)) / 864e5);
var brl6 = (n) => "R$ " + Number(n || 0).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
var dataBR = (d) => String(d || "").split("-").reverse().join("/");
var primeiroNome2 = (n) => String(n || "").trim().split(/\s+/)[0] || "";
var urlCliente = () => process.env.PORTAL_CLIENTE_URL || (process.env.PORTAL_ORIGEM || "https://nexumrh.github.io") + "/cliente/";
function dadosAviso(v, cfg, tipo) {
  const abertas = (v.parcelas || []).filter((p2) => !p2.pago).sort((a, b) => a.venc.localeCompare(b.venc));
  const atrasadas = abertas.filter((p2) => p2.venc < hoje()), p = (tipo === "atraso" ? atrasadas[0] : abertas[0]) || abertas[0] || {};
  const ap = { descontoPct: cfg.descontoAntecipadoPct, multaPct: cfg.multaPct, moraDiaPct: cfg.moraDiaPct };
  const valor = tipo === "atraso" ? r2(atrasadas.reduce((s, x) => s + encargos(x, ap), 0)) : p.valor ? encargos(p, ap) : 0;
  const nome = primeiroNome2(v.clienteNome), loja = cfg.empresa || "NexumCell", d = p.venc ? Math.max(0, dias4(p.venc, hoje())) : 0;
  const texto = tipo === "atraso" ? `${loja}: ${nome}, sua parcela esta atrasada ha ${d} dia(s). Valor hoje ${brl6(valor)}. Pague pelo portal ${urlCliente()} e evite o bloqueio do aparelho.` : `${loja}: ${nome}, sua parcela de ${brl6(valor)} vence ${p.venc === hoje() ? "HOJE" : "em " + dataBR(p.venc)}. Pagando antes voce ganha desconto: ${urlCliente()}`;
  return { tel: (v.cliente?.telefones || [])[0] || v.clienteTel1 || "", modelo: tipo, texto, params: { NOME: nome, VALOR: brl6(valor), VENCIMENTO: dataBR(p.venc), DIAS: String(d), LINK: urlCliente(), LOJA: loja } };
}
async function vendasAtivas() {
  return (await db.collection("vendas").where("status", "==", "ATIVA").get()).docs.map((d) => ({ id: d.id, ...d.data() }));
}
var preencher = (t, dd) => String(t || "").replace(/\{(\w+)\}/g, (m, k) => ({ nome: dd.params.NOME, valor: dd.params.VALOR, vencimento: dd.params.VENCIMENTO, dias: dd.params.DIAS, link: dd.params.LINK, loja: dd.params.LOJA })[k.toLowerCase()] ?? m);
async function regua(cfg, vendas) {
  const passos = (cfg.regua || []).filter((x) => x && Number.isFinite(+x.dia) && (x.canais || []).length);
  const max = Number(process.env.ROTINA_MAX) || 1e3;
  let enviados = 0, falhas = 0, restantes = 0;
  const promessas = {};
  try {
    (await db.collection("crmPromessas").where("status", "==", "PENDENTE").get()).docs.forEach((d) => {
      const p = d.data();
      if (p.vendaId && p.data) promessas[p.vendaId] = p.data > (promessas[p.vendaId] || "") ? p.data : promessas[p.vendaId];
    });
  } catch (e) {
  }
  for (const v of vendas) {
    if (v.pixAutomatico?.status === "ATIVO") continue;
    const abertas = (v.parcelas || []).filter((p2) => !p2.pago).sort((a, b) => a.venc.localeCompare(b.venc));
    if (!abertas.length) continue;
    const atrasada = abertas.find((p2) => p2.venc < hoje()), p = atrasada || abertas[0], d = dias4(p.venc, hoje());
    const passo = passos.find((x) => +x.dia === d);
    if (!passo) continue;
    if (promessas[v.id] && promessas[v.id] >= hoje()) continue;
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
var condRecompra = (cfg) => ({ entradaPct: Math.max(0, Math.min(90, Number(cfg.recompraEntradaPct ?? 20))), descontoPct: Math.max(0, Math.min(50, Number(cfg.recompraDescontoPct ?? 5))) });
async function filaRotina(vendas) {
  vendas = vendas || await vendasAtivas();
  const h = hoje(), amanha = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
  const vivos = /* @__PURE__ */ new Set();
  let n = 0;
  for (const v of vendas) {
    if (!v.lojaId) continue;
    const abertas = (v.parcelas || []).filter((p) => !p.pago).sort((a, b) => a.venc.localeCompare(b.venc));
    if (!abertas.length) continue;
    const atr = abertas.filter((p) => p.venc < h), lem = !atr.length && [h, amanha].includes(abertas[0].venc);
    if (!atr.length && !lem) continue;
    vivos.add(v.id);
    const d = {
      vendaId: v.id,
      lojaId: v.lojaId,
      numero: v.numero || 0,
      clienteNome: v.clienteNome || "",
      tel: (v.cliente?.telefones || [])[0] || "",
      aparelho: [v.aparelho?.marca, v.aparelho?.modelo].filter(Boolean).join(" "),
      dias: atr.length ? dias4(atr[0].venc, h) : 0,
      valor: r2((atr.length ? atr : [abertas[0]]).reduce((s, p) => s + (+p.valor || 0), 0)),
      venc: (atr[0] || abertas[0]).venc,
      lembrete: !atr.length,
      ativo: true,
      atualizadoEm: Date.now()
    };
    await db.collection("filaCobranca").doc(v.id).set(d, { merge: true });
    n++;
  }
  const antigos = (await db.collection("filaCobranca").where("ativo", "==", true).get()).docs.filter((d) => !vivos.has(d.id));
  for (const d of antigos) await d.ref.set({ ativo: false, atualizadoEm: Date.now() }, { merge: true });
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
      const atrasoMax = Math.max(0, ...pagas.map((p) => p.pagoEm ? dias4(p.venc, String(p.pagoEm).slice(0, 10)) : 0));
      const aberto = ps.some((p) => !p.pago && p.venc < hoje()), faltam = ps.length - pagas.length;
      return !aberto && atrasoMax <= 3 && !(v.acordos || []).length && (v.status === "QUITADA" || ps.length >= 2 && faltam <= 1);
    });
    if (!ok) continue;
    const ult = vs.sort((a, b) => b.criadoEm - a.criadoEm)[0];
    const renda = ult.cliente?.renda || 0;
    const quitados = vs.filter((v) => v.status === "QUITADA").length, mult = Number(cfg.preAprovadoMult) || (quitados ? 2.5 : 1.8);
    const valor = Math.round(Math.min(renda * mult, Number(cfg.preAprovadoMax) || 6e3) / 50) * 50;
    if (!(valor > 0)) continue;
    const ate = new Date(Date.now() + 90 * 864e5).toISOString().slice(0, 10), atual = (await db.collection("clientes").doc(cpf).get()).data()?.preAprovado;
    if (atual && atual.valor === valor && atual.ate >= hoje()) continue;
    const cond = condRecompra(cfg);
    await db.collection("clientes").doc(cpf).set({ preAprovado: { valor, ate, em: Date.now(), vendaId: ult.id, loja: ult.lojaNome || "", ...cond } }, { merge: true });
    if (ult.aparelhoToken && ult.status === "ATIVA") await db.collection("aparelhos").doc(ult.aparelhoToken).set({ preAprovado: { valor, ate, em: Date.now(), loja: ult.lojaNome || "", ...cond } }, { merge: true });
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
    const p = abertas[0], d = dias4(hoje(), p.venc);
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
  const limite2 = Number(cfg.roboVozDias) || 15, max = Math.max(1, Math.round((Number(process.env.ROTINA_MAX) || 1e3) / 4));
  let ligados = 0, desligados = 0, erros = 0;
  for (const v of vendas) {
    if (ligados + desligados + erros >= max) break;
    const cust = v.asaas?.customer;
    if (!cust) continue;
    const atraso = Math.max(0, ...(v.parcelas || []).filter((p) => !p.pago).map((p) => dias4(p.venc, hoje())));
    const querLigado = atraso >= limite2;
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
    `Entradas recebidas: ${brl6(entradas)}`,
    `Parcelas recebidas: ${nParc} \xB7 ${brl6(recebido)}`,
    `Em atraso: ${atrasados.size} contrato(s) \xB7 ${brl6(atrasoValor)}`,
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
async function limitesDinamicos() {
  const h = hoje();
  const lojas = (await db.collection("lojas").get()).docs.map((d) => ({ id: d.id, ...d.data() })).filter((l) => l.limiteAuto);
  if (!lojas.length) return 0;
  let n = 0;
  for (const l of lojas) {
    const vs = (await db.collection("vendas").where("lojaId", "==", l.id).get()).docs.map((d) => d.data());
    let aberto = 0, venc = 0, vencAb = 0;
    vs.filter((v) => ["ATIVA", "INSTALANDO"].includes(v.status)).forEach((v) => (v.parcelas || []).forEach((p) => {
      const val = Number(p.valor) || 0;
      if (!p.pago) aberto += val;
      if (p.venc < h) {
        venc += val;
        if (!p.pago) vencAb += val;
      }
    }));
    const inad = venc ? vencAb / venc * 100 : 0;
    const fator = inad < 5 ? 1.5 : inad < 8 ? 1.25 : inad < 12 ? 1 : inad < 20 ? 0.8 : 0.6;
    const carteira = Math.max(1e3, Math.round(aberto * fator / 500) * 500);
    const tetoInad = inad < 10 ? 12 : 10;
    if (Number(l.limiteCarteira) === carteira && Number(l.limiteInad) === tetoInad) continue;
    await db.collection("lojas").doc(l.id).set({ limiteCarteira: carteira, limiteInad: tetoInad, limiteAutoEm: Date.now() }, { merge: true });
    await db.collection("logs").add({ em: Date.now(), acao: "Limite din\xE2mico da loja", alvo: l.id, det: `${l.nome || l.id}: carteira R$ ${carteira} \xB7 inad ${tetoInad}% (atual ${inad.toFixed(1)}%)`, por: "Sistema" });
    n++;
  }
  return n;
}
async function statsIndicacao(cfg) {
  const bonus = Number(cfg.bonusIndicacao) || 0;
  if (!bonus) return 0;
  const vs = (await db.collection("vendas").get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  const num = (c) => Number(String(c || "").replace(/\D/g, ""));
  const porInd = {};
  vs.forEach((v) => {
    const cod = v.cliente && v.cliente.indicacao;
    if (!cod) return;
    const ni = num(cod);
    if (!ni) return;
    const r = porInd[ni] || (porInd[ni] = { conv: 0, pend: 0 });
    if (["ATIVA", "QUITADA", "RETOMADA"].includes(v.status)) r.conv++;
    else if (!["REPROVADA", "CANCELADA", "RASCUNHO"].includes(v.status)) r.pend++;
  });
  let n = 0;
  for (const ni of Object.keys(porInd)) {
    const r = porInd[ni];
    const ind = vs.find((v) => Number(v.numero) === Number(ni) && v.aparelhoToken && ["ATIVA", "QUITADA"].includes(v.status));
    if (!ind) continue;
    await db.collection("aparelhos").doc(ind.aparelhoToken).set({ indicacaoInfo: { indicados: r.conv, pendentes: r.pend, ganho: r.conv * bonus, em: Date.now() } }, { merge: true });
    n++;
  }
  return n;
}
async function rotinas(qual) {
  const cfg = await config();
  if (qual === "hora") {
    const r = {};
    try {
      Object.assign(r, await lembretePesquisa(), await avisoPrioridade(), await autoEncerrar(), await incidentesRotina());
    } catch (e) {
      console.error("crm-rotinas", e.message);
    }
    try {
      r.equipe = await autoAprovarEquipe();
    } catch (e) {
      console.error("equipe", e.message);
    }
    try {
      r.fila = await filaRotina();
    } catch (e) {
      console.error("fila", e.message);
    }
    try {
      r.ia = await iaAutonomaRotina();
    } catch (e) {
      console.error("ia", e.message);
    }
    try {
      r.emp = await emprestimoRotina();
    } catch (e) {
      console.error("emprestimo", e.message);
    }
    try {
      r.crmIa = await crmIaAutomatica();
    } catch (e) {
      console.error("crmIa", e.message);
    }
    try {
      r.agendadas = await agendadasRotina();
    } catch (e) {
      console.error("agendadas", e.message);
    }
    if ((/* @__PURE__ */ new Date()).getUTCMinutes() < 15) {
      try {
        Object.assign(r, await metasRotina());
      } catch (e) {
        console.error("metas", e.message);
      }
    }
    return r;
  }
  let ios = {};
  try {
    ios = await iosRotina(db);
  } catch (e) {
    console.error("ios", e.message);
  }
  if (qual === "noite") {
    const r = await resumoDoDia(cfg);
    try {
      Object.assign(r, await relatorioDiarioCrm(cfg));
    } catch (e) {
      console.error("reldiario", e.message);
    }
    try {
      Object.assign(r, await alertasComportamento(cfg));
    } catch (e) {
      console.error("comportamento", e.message);
    }
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
    try {
      r.limites = await limitesDinamicos();
    } catch (e) {
      console.error("limites", e.message);
    }
    try {
      r.indicacoes = await statsIndicacao(cfg);
    } catch (e) {
      console.error("indicacoes", e.message);
    }
    return { ...r, ...ios };
  }
  const vendas = await vendasAtivas();
  try {
    await autoAprovarEquipe();
  } catch (e) {
    console.error("equipe", e.message);
  }
  try {
    await filaRotina(vendas);
  } catch (e) {
    console.error("fila", e.message);
  }
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
    Object.assign(aniv, await relatorioCrm(cfg));
  } catch (e) {
    console.error("relcrm", e.message);
  }
  try {
    Object.assign(aniv, await posVendaRotina(cfg));
  } catch (e) {
    console.error("posvenda", e.message);
  }
  return { ...await lembretes(cfg, vendas), ...await roboVoz(cfg, vendas), ...aniv, ...ios };
}

// api/avisos.js
async function handler16(req, res) {
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
init_base();
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
  const dig5 = (x) => String(x || "").replace(/\D/g, ""), ap = v.aparelho || {};
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
    cnpj_emitente: dig5(cfg.cnpj),
    data_emissao: (/* @__PURE__ */ new Date()).toISOString(),
    natureza_operacao: "VENDA AO CONSUMIDOR",
    tipo_documento: "1",
    presenca_comprador: "1",
    finalidade_emissao: "1",
    consumidor_final: "1",
    modalidade_frete: "9",
    local_destino: "1",
    nome_destinatario: String(v.clienteNome || "").slice(0, 60),
    cpf_destinatario: dig5(v.clienteCpf),
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
var resumo2 = (j) => ({
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
async function handler17(req, res) {
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
      const nf = { ...resumo2(j), ref: nref, por: quem.nome };
      await ref.set({ notaFiscal: nf }, { merge: true });
      await db.collection("logs").add({ em: Date.now(), acao: "Nota fiscal (NFC-e)", alvo: b.vendaId, det: `${nf.status} ${nf.numero || ""} ${nf.mensagem || ""}`.slice(0, 200), por: quem.nome });
      return res.status(200).json(nf);
    }
    if (b.acao === "consultar") {
      const j = await focus("/v2/nfce/" + nref + "?completa=0");
      const nf = { ...v.notaFiscal || {}, ...resumo2(j), ref: nref };
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
init_base();
var ZURL = () => (process.env.ZAPSIGN_URL || "https://sandbox.api.zapsign.com.br/api/v1").replace(/\/$/, "");
async function zapsign(caminho, opts = {}) {
  if (!process.env.ZAPSIGN_TOKEN) throw new Error("ZapSign n\xE3o configurada (falta ZAPSIGN_TOKEN no servidor)");
  const r = await fetch(ZURL() + caminho, { ...opts, headers: { Authorization: "Bearer " + process.env.ZAPSIGN_TOKEN, "Content-Type": "application/json" } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("ZapSign " + r.status + ": " + (j.detail || j.message || JSON.stringify(j)));
  return j;
}
async function sha2562(txt6) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(txt6));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function htmlParaMarkdown(html) {
  return String(html || "").replace(/<h[1-3][^>]*>(.*?)<\/h[1-3]>/gis, "\n## $1\n").replace(/<h4[^>]*>(.*?)<\/h4>/gis, "\n### $1\n").replace(/<(b|strong)>(.*?)<\/\1>/gis, "**$2**").replace(/<li[^>]*>/gi, "\n- ").replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}
var ipDo = (req) => String(req.headers["cf-connecting-ip"] || req.headers["x-real-ip"] || String(req.headers["x-forwarded-for"] || "").split(",")[0] || "").trim();
async function handler18(req, res) {
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
      const hashConteudo = await sha2562([a.contrato, a.assinatura, a.assinadoEm, a.vendaId].join("|"));
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
init_base();
async function handler19(req, res) {
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
          aceiteLocalizacao: true,
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

// api/credenciamento.js
init_base();
init_brevo();
var dig2 = (s) => String(s || "").replace(/\D/g, "");
var txt2 = (s, n) => String(s ?? "").replace(/[<>]/g, "").trim().slice(0, n);
var erro7 = (msg, status = 400) => Object.assign(new Error(msg), { status });
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
function cpfOk3(c) {
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
  if (e.cep.length !== 8) throw erro7(`${ond}: CEP com 8 n\xFAmeros.`);
  if (e.uf.length !== 2 || e.cidade.length < 2 || e.bairro.length < 2 || e.rua.length < 3 || !e.numero) throw erro7(`${ond}: preencha o endere\xE7o completo (rua, n\xFAmero, bairro, cidade e UF).`);
  return e;
}
var endTexto = (e) => [e.rua && `${e.rua}, ${e.numero}`, e.complemento, e.bairro].filter(Boolean).join(" \xB7 ");
function pessoaLimpa(g, ond, comCargo) {
  const o = { nome: txt2(g.nome, 120), cpf: dig2(g.cpf), email: txt2(g.email, 120).toLowerCase(), telefone: dig2(g.telefone), ...comCargo ? { cargo: txt2(g.cargo, 60) || "Gerente" } : {} };
  if (o.nome.split(" ").filter(Boolean).length < 2) throw erro7(`${ond}: nome completo.`);
  if (!cpfOk3(o.cpf)) throw erro7(`${ond}: CPF inv\xE1lido.`);
  if (!emailOk(o.email)) throw erro7(`${ond}: e-mail inv\xE1lido.`);
  if (o.telefone.length < 10 || o.telefone.length > 11) throw erro7(`${ond}: telefone com DDD.`);
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
  if (loja.nome.length < 2 || loja.cidade.length < 2) throw erro7(`${ond}: informe o nome de identifica\xE7\xE3o da loja e a cidade.`);
  if (loja.cnpj && !cnpjOk(loja.cnpj)) throw erro7(`${ond}: CNPJ da loja inv\xE1lido.`);
  if (loja.telefone.length < 10 || loja.telefone.length > 11) throw erro7(`${ond}: telefone com DDD.`);
  if (l.geo) {
    const lat = +l.geo.lat, lng = +l.geo.lng;
    if (!(lat >= -34 && lat <= 6 && lng >= -74 && lng <= -32)) throw erro7(`${ond}: a localiza\xE7\xE3o (GPS) n\xE3o est\xE1 no Brasil. Marque de novo.`);
    loja.geo = { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6, via: l.geo.via === "GPS" ? "GPS" : "MAPA", precisao: Math.round(+l.geo.precisao || 0) };
  }
  if (Array.isArray(l.marcas)) {
    loja.marcas = [...new Set(l.marcas.map(String))].filter((m) => MARCAS_LOJA.includes(m));
    if (!loja.marcas.length) throw erro7(`${ond}: marque as marcas de celular que a loja vende.`);
  }
  if (l.vendedoresAgora === true) {
    const vs = (Array.isArray(l.vendedores) ? l.vendedores : []).slice(0, 30);
    if (!vs.length) throw erro7(`${ond}: adicione os vendedores ou marque \u201CN\xE3o\u201D em cadastrar vendedores agora.`);
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
  if (o.banco.length < 2 || o.agencia.length < 3 || o.conta.replace(/\D/g, "").length < 3) throw erro7("Dados banc\xE1rios: banco, ag\xEAncia e conta.");
  if (dig2(b.titularCnpj || empresa.cnpj) !== empresa.cnpj) throw erro7("A conta precisa estar no CNPJ da empresa cadastrada.");
  if (o.pixChave !== empresa.cnpj) throw erro7("A chave PIX do repasse precisa ser o CNPJ da empresa (" + empresa.cnpj + "). Chaves de CPF, e-mail, telefone ou de terceiros n\xE3o s\xE3o aceitas.");
  return { ...o, validado: false };
}
async function gravarFotos(solId, lojas, fotosIn, exigir) {
  for (const [i, l] of lojas.entries()) {
    const f = (fotosIn || [])[i] || {}, cont = {};
    for (const t of FOTOS_LOJA) {
      const lista3 = (Array.isArray(f[t]) ? f[t] : []).slice(0, 3).filter((x) => typeof x === "string" && /^data:image\/(jpeg|webp|png);base64,/.test(x));
      for (const x of lista3) if (x.length > 7e5) throw erro7(`${l.nome}: uma foto ficou grande demais. Envie de novo.`);
      if (exigir && !lista3.length) throw erro7(`${l.nome}: falta a foto \u201C${t}\u201D.`);
      cont[t] = lista3.length;
      for (const [j, x] of lista3.entries()) await db.collection("lojaFotos").doc(`${solId}_${i}_${t}_${j}`).set({ solicitacaoId: solId, loja: i, tipo: t, n: j, foto: x, criadoEm: Date.now() });
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
async function handler20(req, res) {
  if (cors(req, res)) return;
  if (req.method !== "POST") return res.status(405).end();
  try {
    const b = req.body || {};
    if (b.acao === "planos") return res.status(200).json(await planos());
    if (b.acao === "cnpj") {
      if (!cnpjOk(b.cnpj)) throw erro7("CNPJ inv\xE1lido.");
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
      if (!cnpjOk(cnpj)) throw erro7("CNPJ da empresa inv\xE1lido.");
      if (!cpfOk3(e.respCpf)) throw erro7("CPF do respons\xE1vel inv\xE1lido.");
      if (!emailOk(email)) throw erro7("E-mail do respons\xE1vel inv\xE1lido.");
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
      if (empresa.emailCorp && !emailOk(empresa.emailCorp)) throw erro7("E-mail corporativo inv\xE1lido.");
      {
        const s0 = await db.collection("solicitacoesLoja").doc("cnpj_" + cnpj).get();
        if (s0.exists && ["PENDENTE", "EM_ANALISE", "APROVADA"].includes(s0.data().status)) throw erro7(s0.data().status === "APROVADA" ? "Esta empresa j\xE1 \xE9 parceira. Para abrir uma filial, use \u201CAdicionar filial\u201D." : "J\xE1 recebemos o cadastro desta empresa. Acompanhe pelo site em \u201CAcompanhar meu cadastro\u201D.", 409);
      }
      const receita = await consultarCnpj(cnpj);
      if (receita && receita.encontrado === false) throw erro7("CNPJ n\xE3o encontrado na Receita Federal.");
      if (receita?.situacao && receita.situacao !== "ATIVA") throw erro7(`O CNPJ est\xE1 ${receita.situacao.toLowerCase()} na Receita Federal. S\xF3 aceitamos empresas com CNPJ ativo.`);
      if (empresa.razao.length < 3 || empresa.fantasia.length < 2 || empresa.respNome.split(" ").length < 2) throw erro7("Preencha raz\xE3o social, nome fantasia e o nome completo do respons\xE1vel.");
      if (lojasIn.length > 30) throw erro7("No m\xE1ximo 30 lojas por cadastro. Fale com a NexumCell para redes maiores.");
      const lojas = lojasIn.map((l, i) => lojaLimpa(l, i, false));
      const emails = lojas.map((l) => l.gerente.email);
      if (new Set(emails).size !== emails.length) throw erro7("Cada loja precisa de um gerente com e-mail diferente.");
      {
        const todos = [...emails, ...lojas.flatMap((l) => (l.vendedores || []).map((v) => v.email))];
        if (new Set(todos).size !== todos.length) throw erro7("Gerentes e vendedores precisam de e-mails diferentes (cada e-mail vira um login).");
      }
      const novo = !!b.banco;
      const banco = novo ? bancoLimpo(b.banco, empresa) : null;
      if (novo && b.lgpd !== true) throw erro7("Aceite o tratamento de dados (LGPD) para continuar.");
      if (b.aceite !== true) throw erro7("Aceite os termos para continuar.");
      const P = await planos(), plano = P.planos.find((p) => p.id === b.plano) || P.planos[0];
      if (plano.minimoLojas && lojas.length < plano.minimoLojas) throw erro7(`O plano ${plano.nome} \xE9 a partir de ${plano.minimoLojas} lojas.`);
      const ref = db.collection("solicitacoesLoja").doc("cnpj_" + cnpj), s = await ref.get();
      if (s.exists && ["PENDENTE", "EM_ANALISE", "APROVADA"].includes(s.data().status)) throw erro7(s.data().status === "APROVADA" ? "Esta empresa j\xE1 \xE9 parceira. Para abrir uma filial, use \u201CAdicionar filial\u201D." : "J\xE1 recebemos o cadastro desta empresa. Acompanhe pelo site em \u201CAcompanhar meu cadastro\u201D.", 409);
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
      if (!s.exists || s.data().respEmail !== email) throw erro7("N\xE3o encontramos cadastro com esse CNPJ e e-mail do respons\xE1vel.", 404);
      const x = s.data();
      if (b.acao === "ver") {
        const fil = (await db.collection("solicitacoesLoja").where("cnpj", "==", cnpj).get()).docs.map((d) => d.data()).filter((f) => f.tipo === "FILIAL");
        const unidades = [...x.lojas || [], ...fil.flatMap((f) => (f.lojas || []).map((l) => ({ ...l, status: l.status === "PENDENTE" && f.status !== "PENDENTE" ? f.status : l.status })))].map((l) => ({ nome: l.nome, cidade: l.cidade, gerente: l.gerente?.nome || "", status: l.status || x.status }));
        return res.status(200).json({ fantasia: x.fantasia, status: x.status, plano: x.planoNome || "", resposta: x.resposta || "", criadoEm: x.criadoEm, unidades, historico: (x.historico || []).map((h) => ({ em: h.em, status: h.status, obs: h.obs || "" })) });
      }
      if (x.status !== "APROVADA") throw erro7("A empresa ainda n\xE3o foi aprovada. Depois da aprova\xE7\xE3o voc\xEA pode adicionar filiais.");
      const loja = lojaLimpa(b.loja || {}, 0, true);
      if (!loja.cnpj) throw erro7("Informe o CNPJ da filial.");
      if (loja.cnpj.slice(0, 8) !== cnpj.slice(0, 8)) throw erro7("O CNPJ da filial precisa ser da mesma empresa (mesma raiz do CNPJ da matriz).");
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
init_base();
async function handler21(req, res) {
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
init_base();
var dig3 = (s) => String(s || "").replace(/\D/g, "");
var txt3 = (s, n) => String(s ?? "").replace(/[<>]/g, "").trim().slice(0, n);
var erro8 = (m, s = 400) => Object.assign(new Error(m), { status: s });
var img = (x) => {
  x = String(x || "");
  if (!/^data:image\/(jpeg|png|webp);base64,/.test(x)) return "";
  if (x.length > 32e4) throw erro8("Foto grande demais. Tente de novo.");
  return x;
};
function cpfOk4(c) {
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
  if (!/^[A-Za-z0-9]{20,40}$/.test(String(token || ""))) throw erro8("Link inv\xE1lido.", 404);
  const q = (await db.collection("vendas").where("remota.token", "==", token).get()).docs;
  if (!q.length) throw erro8("Link inv\xE1lido ou j\xE1 usado.", 404);
  const d = q[0], v = d.data();
  if (Date.now() - (v.remota?.criadoEm || 0) > 7 * 864e5) throw erro8("Este link venceu. Pe\xE7a um novo ao vendedor.", 410);
  return { id: d.id, v };
}
async function handler22(req, res) {
  if (cors(req, res)) return;
  if (req.method !== "POST") return res.status(405).end();
  try {
    const b = req.body || {};
    const { id, v } = await acharVenda(b.token);
    if (b.acao === "ver") return res.status(200).json({ numero: v.numero, nome: v.clienteNome || "", loja: v.lojaNome || "", vendedor: v.vendedorNome || "", status: v.status, enviado: v.status !== "REMOTA" });
    if (b.acao === "enviar") {
      if (v.status !== "REMOTA") throw erro8("Esta proposta j\xE1 foi enviada. Aguarde o contato da loja.", 409);
      const d = b.dados || {}, cpf = dig3(d.cpf);
      if (!cpfOk4(cpf)) throw erro8("CPF inv\xE1lido.");
      if (txt3(d.nome, 120).split(" ").length < 2 || !/^\d{4}-\d{2}-\d{2}$/.test(d.nasc || "")) throw erro8("Informe o nome completo e a data de nascimento.");
      if (txt3(d.mae, 120).split(" ").length < 2) throw erro8("Informe o nome completo da m\xE3e.");
      const tel = dig3(d.telefone);
      if (tel.length < 10) throw erro8("WhatsApp com DDD.");
      if (!(+d.renda > 0)) throw erro8("Informe a renda mensal.");
      for (const k of ["cpf_" + cpf, "tel_" + tel]) {
        const ln = await db.collection("listanegra").doc(k).get();
        if (ln.exists) throw erro8("N\xE3o foi poss\xEDvel seguir com a proposta. Procure a loja.", 403);
      }
      if (b.aceite !== true) throw erro8("Aceite os termos para continuar.");
      const frente = img(b.frente), verso = img(b.verso), selfie = img(b.selfie), mosaico = img(b.mosaico), mov = b.vidaMov == null ? null : Number(b.vidaMov);
      const vida = mov == null ? { ok: null, metodo: "ARQUIVO", via: "REMOTA" } : { ok: mov > 4, metodo: "MOVIMENTO", d: Math.round(mov), via: "REMOTA" };
      if (!frente || !selfie) throw erro8("Envie a foto da frente do documento e a selfie.");
      const agora = Date.now(), tel2 = dig3(d.telefone2), refNome = txt3(d.ref1Nome, 80);
      if (tel2 && tel2 === tel) throw erro8("O telefone da refer\xEAncia precisa ser de outra pessoa.");
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
        if (o.length) throw erro8("Este telefone j\xE1 est\xE1 cadastrado para outra pessoa. Use o seu n\xFAmero.");
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
init_base();
var addDias2 = (iso, n) => {
  const d = /* @__PURE__ */ new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
var erro9 = (m, s = 400) => Object.assign(new Error(m), { status: s });
async function promessa(token, data) {
  const cfg = await config();
  if (cfg.promessaApp === "nao") throw erro9("A promessa de pagamento pelo celular n\xE3o est\xE1 dispon\xEDvel. Fale com a loja.");
  const max = Math.min(10, Math.max(1, Number(cfg.promessaMaxDias) || 5)), h = hoje();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data || "")) || data <= h || data > addDias2(h, max)) throw erro9(`Escolha uma data entre amanh\xE3 e ${max} dia(s) a partir de hoje.`);
  const aref = db.collection("aparelhos").doc(String(token)), as = await aref.get();
  if (!as.exists) throw erro9("Contrato n\xE3o encontrado", 404);
  const ap = as.data();
  if (ap.quitado || ap.status !== "ATIVO") throw erro9("Este contrato n\xE3o est\xE1 ativo.");
  if (ap.promessaApp?.em) throw erro9("Voc\xEA j\xE1 usou a promessa de pagamento neste contrato. Pague pelo PIX ou fale com a loja.", 409);
  if (ap.roubo && !ap.roubo.liberadoEm) throw erro9("Aparelho com roubo/perda comunicado. Fale com a loja.");
  const vref = db.collection("vendas").doc(ap.vendaId), v = (await vref.get()).data();
  if (!v || v.status !== "ATIVA") throw erro9("Este contrato n\xE3o est\xE1 ativo.");
  const atr = (v.parcelas || []).filter((p) => !p.pago && p.venc < h);
  if (!atr.length) throw erro9("Voc\xEA n\xE3o tem parcelas em atraso.");
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
var erroBot = (m, s = 400) => Object.assign(new Error(m), { status: s });
var addDiasBot = (iso, n) => {
  const d = /* @__PURE__ */ new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
var etapaTotalBot = (ap) => ap.etapaTotalDias != null ? Math.max(1, Number(ap.etapaTotalDias) || 7) : (Number(ap.toleranciaDias) || 0) + 1;
async function contratoBot(token) {
  const aref = db.collection("aparelhos").doc(String(token)), as = await aref.get();
  if (!as.exists) throw erroBot("Contrato n\xE3o encontrado", 404);
  const ap = as.data();
  if (ap.quitado || ap.status !== "ATIVO") throw erroBot("Este contrato n\xE3o est\xE1 ativo.");
  if (ap.roubo && !ap.roubo.liberadoEm) throw erroBot("Este aparelho tem comunica\xE7\xE3o de roubo ou perda. S\xF3 a loja pode liberar.", 409);
  if (ap.modo === "TRAVAR") throw erroBot("O bloqueio deste aparelho foi pedido pela loja. S\xF3 a equipe pode liberar.", 409);
  const v = (await db.collection("vendas").doc(ap.vendaId).get()).data();
  if (!v || v.status !== "ATIVA") throw erroBot("Este contrato n\xE3o est\xE1 ativo.");
  return { aref, ap, v };
}
function historicoBot(v, h) {
  const ps = v.parcelas || [], pagas = ps.filter((p) => p.pago);
  const emDia = pagas.filter((p) => !p.pagoEm || String(p.pagoEm).slice(0, 10) <= p.venc).length;
  const atr = ps.filter((p) => !p.pago && p.venc < h).sort((a, b) => a.venc < b.venc ? -1 : 1);
  const maior = atr.length ? Math.round((Date.parse(h + "T12:00:00Z") - Date.parse(atr[0].venc + "T12:00:00Z")) / 864e5) : 0;
  return { pagas: pagas.length, emDia, pctEmDia: pagas.length ? emDia / pagas.length : null, atr, maior };
}
async function registrarBot(ap, v, txt6, em) {
  try {
    const cref = db.collection("cobrancas").doc(ap.vendaId), c = (await cref.get()).data() || {};
    await cref.set({
      vendaId: ap.vendaId,
      numero: v.numero,
      clienteNome: v.clienteNome,
      lojaId: v.lojaId,
      atualizadoEm: em,
      contatos: [...c.contatos || [], { em, canal: "Assistente do app", resultado: "Pedido do cliente", obs: txt6, por: "Cliente" }]
    }, { merge: true });
    await db.collection("logs").add({ em, acao: "Assistente do app", alvo: ap.vendaId, det: txt6, por: "Cliente" });
  } catch (e) {
    console.warn("registrarBot", e.message);
  }
}
async function rouboBot(token, tipo, relato, bo) {
  const aref = db.collection("aparelhos").doc(String(token)), as = await aref.get();
  if (!as.exists) throw erroBot("Contrato n\xE3o encontrado", 404);
  const ap = as.data(), agora = Date.now();
  const T = ["Roubo", "Furto", "Perda"].includes(tipo) ? tipo : "Roubo";
  const v = ap.vendaId ? (await db.collection("vendas").doc(ap.vendaId).get()).data() : null;
  const cpf = String(v?.clienteCpf || ap.clienteCpf || "").replace(/\D/g, "");
  const tokens = /* @__PURE__ */ new Set([String(token)]);
  if (cpf) {
    const vs = await db.collection("vendas").where("clienteCpf", "==", cpf).get().catch(() => null);
    vs?.forEach((d) => {
      const x = d.data();
      if (x.aparelhoToken && ["ATIVA", "INSTALANDO"].includes(x.status)) tokens.add(String(x.aparelhoToken));
    });
  }
  const bloqueados = [];
  for (const tk of tokens) {
    const r = db.collection("aparelhos").doc(tk), d = (await r.get()).data();
    if (!d || d.quitado) continue;
    if (d.roubo && !d.roubo.liberadoEm) {
      if (bo) await r.set({ roubo: { ...d.roubo, bo: String(bo).slice(0, 60) } }, { merge: true });
      bloqueados.push(tk);
      continue;
    }
    await r.set({ roubo: { tipo: T, data: hoje(), relato: String(relato || "").slice(0, 300), bo: String(bo || "").slice(0, 60), em: agora, via: "APP", localizar: false } }, { merge: true });
    bloqueados.push(tk);
    await pushAparelho(tk).catch(() => {
    });
  }
  if (v) await registrarBot(ap, v, `Comunicou ${T.toLowerCase()} pelo chat do app. A assistente bloqueou ${bloqueados.length} aparelho(s).${bo ? " BO: " + bo : ""}`, agora);
  try {
    await db.collection("chamados").add({ em: agora, assunto: `${T} comunicado pelo app`, setor: "Suporte", cliente: v?.clienteNome || "", imei: ap.imei || "", desc: `Cliente comunicou ${T.toLowerCase()} pela assistente do app. Aparelhos bloqueados: ${bloqueados.length}.${relato ? " Relato: " + relato : ""}${bo ? " BO: " + bo : ""}`, status: "ABERTO", por: "Assistente do app", vendaId: ap.vendaId || "" });
  } catch (e) {
  }
  return { ok: true, bloqueados: bloqueados.length, tipo: T };
}
async function recompraBot(token) {
  const as = await db.collection("aparelhos").doc(String(token)).get();
  if (!as.exists) throw erroBot("Contrato n\xE3o encontrado", 404);
  const ap = as.data(), pre = ap.preAprovado, agora = Date.now();
  if (!pre || !(pre.valor > 0) || String(pre.ate || "") < hoje()) throw erroBot("Voc\xEA ainda n\xE3o tem cr\xE9dito pr\xE9-aprovado. Continue pagando em dia!");
  const v = ap.vendaId ? (await db.collection("vendas").doc(ap.vendaId).get()).data() || {} : {};
  const cpf = String(v.clienteCpf || ap.clienteCpf || "").replace(/\D/g, "");
  await db.collection("recompras").doc(cpf || String(token)).set({
    status: "INTERESSE",
    via: "APP",
    em: agora,
    cpf,
    vendaId: ap.vendaId || "",
    numero: v.numero || 0,
    clienteNome: v.clienteNome || ap.clienteNome || "",
    tel: (v.cliente?.telefones || [])[0] || "",
    lojaId: v.lojaId || "",
    lojaNome: v.lojaNome || ap.lojaNome || "",
    valor: pre.valor,
    entradaPct: pre.entradaPct ?? null,
    descontoPct: pre.descontoPct ?? null
  }, { merge: true });
  if (v.clienteNome) await registrarBot(ap, v, `Pediu um celular novo pelo app (cr\xE9dito pr\xE9-aprovado de R$ ${pre.valor}).`, agora).catch(() => {
  });
  return { ok: true };
}
async function prazoBot(token) {
  const cfg = await config();
  if (cfg.prazoBot === "nao") throw erroBot("O prazo extra pelo app n\xE3o est\xE1 dispon\xEDvel. Fale com a loja.");
  const horas = Math.min(72, Math.max(12, Number(cfg.prazoBotHoras) || 48));
  const { aref, ap, v } = await contratoBot(token), h = hoje();
  const p = (v.parcelas || []).filter((x) => !x.pago && x.venc <= addDiasBot(h, 3)).sort((a, b) => a.venc < b.venc ? -1 : 1)[0];
  if (!p) throw erroBot("Voc\xEA n\xE3o tem parcela vencida nem vencendo nos pr\xF3ximos 3 dias. O prazo extra pode ser pedido perto do vencimento.");
  const usados = ap.prazosBot || {};
  if (usados[p.n]) throw erroBot(`Voc\xEA j\xE1 usou o prazo extra da parcela ${p.n}. Ele vale 1 vez por parcela.`, 409);
  const bloqueio = Date.parse(addDiasBot(p.venc, etapaTotalBot(ap)) + "T00:00:00-03:00"), agora = Date.now();
  const ate = Math.max(agora, bloqueio) + horas * 36e5;
  await aref.set({ liberadoAte: Math.max(ate, Number(ap.liberadoAte) || 0), prazosBot: { ...usados, [p.n]: { em: agora, ate } } }, { merge: true });
  await registrarBot(ap, v, `Pediu ${horas} h a mais para pagar a parcela ${p.n} (vence ${p.venc})`, agora);
  await pushAparelho(String(token)).catch(() => {
  });
  return { ok: true, parcela: p.n, venc: p.venc, liberadoAte: ate, horas };
}
async function liberarBot(token, pedido) {
  const cfg = await config(), { aref, ap, v } = await contratoBot(token), h = hoje(), agora = Date.now();
  const H = historicoBot(v, h);
  if (!H.atr.length) throw erroBot("N\xE3o encontrei parcela em atraso. Se o aparelho continua bloqueado, toque em Verificar na tela de bloqueio.");
  if ((Number(ap.liberadoAte) || 0) > agora) return { ok: true, jaLiberado: true, liberadoAte: ap.liberadoAte };
  const n = H.atr[0].n, usados = ap.liberacoesBot || {}, maxDias = Number(cfg.botLiberarMaxDias) || 15;
  const bomPagador = H.pctEmDia == null ? H.maior <= 7 : H.pctEmDia >= 0.5;
  if (cfg.botLiberar !== "nao" && !usados[n] && H.maior <= maxDias && bomPagador) {
    const ate = agora + 24 * 36e5;
    await aref.set({ liberadoAte: ate, liberacoesBot: { ...usados, [n]: { em: agora, ate } } }, { merge: true });
    await registrarBot(ap, v, `Liberado 24 h pela assistente (parcela ${n} em atraso h\xE1 ${H.maior} dia(s))`, agora);
    await pushAparelho(String(token)).catch(() => {
    });
    return { ok: true, liberadoAte: ate, horas: 24 };
  }
  const sugestao = H.pctEmDia != null && H.pctEmDia >= 0.8 && H.atr.length === 1 ? 48 : 24;
  const motivoBot = usados[n] ? `j\xE1 usou a libera\xE7\xE3o autom\xE1tica da parcela ${n}` : H.maior > maxDias ? `atraso de ${H.maior} dias (a assistente libera at\xE9 ${maxDias})` : "mais da metade das parcelas pagas com atraso";
  const ref = db.collection("liberacoes").doc("lib_" + String(token).slice(0, 16) + "_" + n), ja = (await ref.get()).data();
  if (ja?.status === "PENDENTE") return { ok: false, pendente: true, sugestao: ja.sugestaoHoras };
  await ref.set({
    token: String(token),
    vendaId: ap.vendaId,
    numero: v.numero,
    clienteNome: v.clienteNome || "",
    lojaId: v.lojaId || "",
    lojaNome: v.lojaNome || "",
    parcela: n,
    diasAtraso: H.maior,
    parcelasAtraso: H.atr.length,
    pagas: H.pagas,
    pagasEmDia: H.emDia,
    sugestaoHoras: sugestao,
    motivoBot,
    pedidoCliente: String(pedido || "").slice(0, 300),
    status: "PENDENTE",
    em: agora
  });
  await registrarBot(ap, v, `Pediu libera\xE7\xE3o pelo app; a assistente n\xE3o liberou (${motivoBot}). Pedido enviado ao suporte.`, agora);
  return { ok: false, pendente: true, sugestao };
}
async function handler23(req, res) {
  if (cors(req, res)) return;
  if (req.method !== "POST") return res.status(405).end();
  try {
    const b = req.body || {};
    if (!b.token || String(b.token).length < 16) throw erro9("pedido inv\xE1lido");
    if (b.acao === "promessa") return res.status(200).json(await promessa(b.token, b.data));
    if (b.acao === "prazo") return res.status(200).json(await prazoBot(b.token));
    if (b.acao === "liberar") return res.status(200).json(await liberarBot(b.token, b.pedido));
    if (b.acao === "recompra") return res.status(200).json(await recompraBot(b.token));
    if (b.acao === "roubo") return res.status(200).json(await rouboBot(b.token, b.tipo, b.relato, b.bo));
    throw erro9("a\xE7\xE3o desconhecida");
  } catch (e) {
    return res.status(e.status || 500).json({ erro: e.status ? e.message : "N\xE3o foi poss\xEDvel agora. Tente de novo." });
  }
}

// api/ios.js
init_base();
init_ios();
var erro10 = (m, s = 400) => Object.assign(new Error(m), { status: s });
async function handler24(req, res) {
  if (cors(req, res)) return;
  if (req.method !== "POST") return res.status(405).end();
  try {
    const eu = await exigirEquipe(req);
    const b = req.body || {};
    if (b.acao === "status") return res.status(200).json({ ligado: mdmLigado() });
    if (b.acao === "buscar") {
      const d = await acharPorSerie(b.serial);
      if (!d) throw erro10("Este n\xFAmero de s\xE9rie n\xE3o est\xE1 no MDM. Confira se o iPhone foi adicionado ao Apple Business Manager e atribu\xEDdo ao servidor MDM.", 404);
      return res.status(200).json({ id: d.id, nome: d.name || "", modelo: d.model_name || d.product_name || "", status: d.status || "", supervisionado: d.is_supervised === true });
    }
    if (b.acao === "vincular" || b.acao === "sincronizar") {
      const tk = String(b.token || "");
      const ref = db.collection("aparelhos").doc(tk), s = await ref.get();
      if (!s.exists) throw erro10("Contrato do aparelho n\xE3o encontrado.", 404);
      const a = s.data();
      if (!a.ios) throw erro10("Este contrato n\xE3o \xE9 de iPhone.");
      if (eu.role !== "DONO" && eu.role !== "FINANCEIRO" && eu.role !== "SUPORTE" && a.lojaId !== eu.lojaId) throw erro10("Este aparelho \xE9 de outra loja.", 403);
      if (b.acao === "sincronizar") return res.status(200).json(await sincronizarIos(db, tk, a));
      const d = await acharPorSerie(b.serial);
      if (!d) throw erro10("Este n\xFAmero de s\xE9rie n\xE3o est\xE1 no MDM. O iPhone precisa estar no Apple Business Manager da empresa e atribu\xEDdo ao servidor MDM.", 404);
      if (d.is_supervised !== true) throw erro10("O iPhone n\xE3o est\xE1 supervisionado. Sem supervis\xE3o o cliente pode remover a trava: n\xE3o entregue. Restaure o iPhone e fa\xE7a a configura\xE7\xE3o pelo Apple Business Manager.");
      if (String(d.status || "").toLowerCase() !== "enrolled") throw erro10("O iPhone ainda n\xE3o se inscreveu no MDM. Termine a configura\xE7\xE3o inicial no aparelho (tela \u201CGerenciamento remoto\u201D \u2192 Inscrever) com internet e tente de novo.");
      const outro = (await db.collection("aparelhos").where("mdmId", "==", d.id).get()).docs.find((x) => x.id !== tk && !x.data().quitado && x.data().status !== "CANCELADO");
      if (outro) throw erro10("Este iPhone j\xE1 est\xE1 vinculado a outro contrato ativo (n\xBA " + (outro.data().vendaNumero || "") + ").", 409);
      const serial = String(d.serial_number || b.serial).toUpperCase();
      if (d.imei && a.imei && String(d.imei).replace(/\D/g, "") !== String(a.imei)) throw erro10(`O IMEI deste iPhone (${d.imei}) n\xE3o \xE9 o do contrato (${a.imei}). Confira se pegou o aparelho certo.`, 409);
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
    throw erro10("a\xE7\xE3o desconhecida");
  } catch (e) {
    console.error(e);
    return res.status(e.status || 500).json({ erro: e.status ? e.message : "N\xE3o foi poss\xEDvel falar com o MDM agora. Tente de novo." });
  }
}

// api/remover-codigo.js
init_base();
var SEG = () => String(process.env.MESTRE_REMOCAO || "");
var LINK = () => String(process.env.LINK_SECRET || process.env.MESTRE_REMOCAO || "");
var diaSP = (d = /* @__PURE__ */ new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
async function hmac(secret, msg) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg)));
}
async function codigoDoDia(dia = diaSP()) {
  const h = await hmac(SEG(), `REMOVER-USB|${dia}`);
  let v = 0;
  for (let i = 0; i < 5; i++) v = v * 256 + h[i];
  return String(v % 1e10).padStart(10, "0");
}
var b64url2 = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function assinarLink(expMs) {
  const exp = String(expMs);
  const mac = await hmac(LINK(), "LINK|" + exp);
  return b64url2(new TextEncoder().encode(exp)) + "." + b64url2(mac);
}
async function conferirLink(tok) {
  const [a, b] = String(tok || "").split(".");
  if (!a || !b) return false;
  let exp;
  try {
    exp = new TextDecoder().decode(Uint8Array.from(atob(a.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)));
  } catch (e) {
    return false;
  }
  if (!/^\d+$/.test(exp) || Date.now() > Number(exp)) return false;
  const mac = await hmac(LINK(), "LINK|" + exp);
  return b64url2(mac) === b;
}
function pagina(cod, erro14) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NexumCell \u2014 Remover a trava</title>
<style>body{margin:0;font-family:system-ui,Arial,sans-serif;background:#0B1E35;color:#fff;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:20px}
.card{background:#071424;border:1px solid #1b3350;border-radius:14px;padding:24px;max-width:460px;width:100%}
h1{font-size:18px;margin:0 0 6px}.cod{font-size:42px;letter-spacing:6px;font-weight:800;color:#C9A84C;text-align:center;margin:18px 0}
ol{line-height:1.7;font-size:15px;padding-left:18px;margin:8px 0}.muted{color:#9FB0C3;font-size:13px}.err{color:#E07A5F}</style></head>
<body><div class="card">${erro14 ? `<h1>Remover a trava</h1><p class="err">${erro14}</p>` : `<h1>NexumCell \u2014 Remover a trava</h1>
<p class="muted">No aparelho, na tela do app NexumCell, toque em \u201CProblema? Inserir c\xF3digo de remo\xE7\xE3o da loja\u201D e digite o c\xF3digo:</p>
<div class="cod">${cod}</div>
<ol><li>Toque em <b>Remover</b> no aparelho.</li><li>A trava sai e o app se desinstala.</li><li>Depois, reinstale a trava (QR ou cabo USB) para refazer a venda.</li></ol>
<p class="muted">C\xF3digo v\xE1lido s\xF3 hoje. D\xFAvidas: fale com o Dono/Suporte Nexum.</p>`}</div></body></html>`;
}
async function handler25(req, res) {
  if (cors(req, res)) return;
  if (!SEG()) return res.status(500).json({ erro: "MESTRE_REMOCAO n\xE3o configurado no servidor." });
  if (req.method === "GET") {
    res.setHeader("content-type", "text/html; charset=utf-8");
    if (!await conferirLink(req.query.t)) return res.status(410).send(pagina(null, "Link expirado ou inv\xE1lido. Pe\xE7a um novo ao Dono/Suporte."));
    return res.status(200).send(pagina(await codigoDoDia(), null));
  }
  if (req.method !== "POST") return res.status(405).end();
  await exigirEquipe(req, ["DONO", "SUPORTE"]);
  const acao = (req.body || {}).acao || "codigo";
  if (acao === "link") {
    const exp = Date.now() + 3 * 3600 * 1e3;
    return res.status(200).json({ token: await assinarLink(exp), expira: exp });
  }
  return res.status(200).json({ codigo: await codigoDoDia(), dia: diaSP() });
}

// api/lead.js
init_base();
init_brevo();
var txt4 = (s, n) => String(s ?? "").replace(/[<>]/g, "").trim().slice(0, n || 120);
var dig4 = (s) => String(s || "").replace(/\D/g, "");
var sha2 = async (t) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)))].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 24);
var SOBRE = `Voc\xEA \xE9 o consultor virtual do site de vendas da NexumCell para LOJISTAS (lojas de celular) que querem vender celular parcelado no credi\xE1rio.
Fatos que voc\xEA pode usar:
- A NexumCell d\xE1 \xE0 loja os sistemas (portal do vendedor, do gerente e do dono, app do cliente) e a trava do aparelho, que limita fun\xE7\xF5es do celular em caso de atraso e libera quando o cliente paga.
- A an\xE1lise de cr\xE9dito \xE9 pr\xF3pria, sem consulta ao SPC/Serasa, ent\xE3o a loja vende para quem os bancos recusam.
- O cliente paga as parcelas por Pix ou boleto pelo app; a cobran\xE7a tem r\xE9gua de avisos e a equipe NexumCell acompanha os atrasos.
- O cadastro da loja \xE9 feito no pr\xF3prio site (matriz e filiais) e a loja recebe treinamento em v\xEDdeo para vendedores e gerentes.
- Pre\xE7os: h\xE1 mensalidade por loja e licen\xE7a por venda. NUNCA diga valores: pe\xE7a para a pessoa ver a se\xE7\xE3o "Planos" do site ou falar com um consultor.
Regras: responda em portugu\xEAs do Brasil (ou em espanhol se a pessoa escrever em espanhol), no m\xE1ximo 3 frases, sem emojis. N\xE3o prometa aprova\xE7\xE3o, lucro, prazos ou condi\xE7\xF5es que n\xE3o est\xE3o acima. Se n\xE3o souber, diga que um consultor responde. Quando a pessoa mostrar interesse (quer cadastrar, quer pre\xE7o, quer conversar, quer demonstra\xE7\xE3o), convide a deixar nome da loja, cidade e WhatsApp e marque pedirContato=true.
Responda em JSON: {"resposta":"...","pedirContato":true|false}`;
async function handler26(req, res) {
  if (cors(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ erro: "M\xE9todo n\xE3o permitido" });
  try {
    const b = req.body || {};
    if (b.acao === "chat") {
      const ip = String(req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"] || "x").split(",")[0].trim(), hora = (/* @__PURE__ */ new Date()).toISOString().slice(0, 13);
      const ref = db.collection("siteChat").doc(await sha2(ip + hora)), c = (await ref.get()).data() || {};
      if ((c.n || 0) >= 25) return res.status(429).json({ erro: "Muitas mensagens. Deixe seu WhatsApp que um consultor responde." });
      await ref.set({ n: (c.n || 0) + 1, em: Date.now() }, { merge: true });
      const ms = (Array.isArray(b.mensagens) ? b.mensagens : []).slice(-10).map((m) => ({ role: m.de === "nexum" ? "assistant" : "user", content: txt4(m.t, 600) })).filter((m) => m.content);
      if (!ms.length || ms[ms.length - 1].role !== "user") return res.status(400).json({ erro: "Escreva a sua pergunta" });
      let extra = "";
      try {
        extra = String((await db.collection("config").doc("crm").get()).data()?.iaSite || "").slice(0, 2e3);
      } catch (e) {
      }
      const t = await groq([{ role: "system", content: SOBRE + (extra ? "\n\nInforma\xE7\xF5es do dono:\n" + extra : "") }, ...ms], { temperatura: 0.3, max: 300, json: true });
      let j = {};
      try {
        j = JSON.parse(t);
      } catch (e) {
        j = { resposta: t, pedirContato: false };
      }
      return res.json({ resposta: txt4(j.resposta, 800) || "Um consultor da NexumCell pode te ajudar. Deixe seu WhatsApp.", pedirContato: !!j.pedirContato });
    }
    const whatsapp = dig4(b.whatsapp), u = b.utm || {};
    const demo = b.demo && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(b.demo.quando || "")) ? { quando: String(b.demo.quando), confirmado: false } : null;
    const lead = {
      nome: txt4(b.nome, 80),
      loja: txt4(b.loja, 80),
      cidade: txt4(b.cidade, 80),
      whatsapp,
      mensagem: txt4(b.mensagem, 1500),
      origem: txt4(b.origem, 40) || "site",
      status: "NOVO",
      criadoEm: Date.now(),
      ...demo ? { demo } : {},
      ...u.source || u.campaign ? { utm: { source: txt4(u.source, 60), medium: txt4(u.medium, 60), campaign: txt4(u.campaign, 80), pagina: txt4(u.pagina, 120) } } : {},
      historico: [{ em: Date.now(), status: "NOVO", obs: demo ? `Pediu demonstra\xE7\xE3o para ${demo.quando.replace("T", " \xE0s ").split("-").reverse().join("/")}` : "Veio pelo site de vendas" }]
    };
    if (!whatsapp && !lead.loja && !lead.nome) return res.status(400).json({ erro: "Informe ao menos o WhatsApp ou o nome da loja." });
    const id = "lead_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
    await db.collection("leads").doc(id).set({ id, ...lead });
    if (demo && brevoLigado() && process.env.DONO_EMAIL) {
      const [d, h] = demo.quando.split("T");
      await enviarEmail({ para: process.env.DONO_EMAIL, assunto: `Demonstra\xE7\xE3o agendada: ${lead.loja || lead.nome} (${d.split("-").reverse().join("/")} \xE0s ${h})`, titulo: "Nova demonstra\xE7\xE3o pelo site", texto: `${lead.nome || ""} \xB7 ${lead.loja || ""} \xB7 ${lead.cidade || ""}
WhatsApp: ${whatsapp}
Quando: ${d.split("-").reverse().join("/")} \xE0s ${h}

O lead est\xE1 no CRM, no funil comercial. Confirme o hor\xE1rio pelo WhatsApp.` }).catch(() => {
      });
    }
    return res.status(200).json({ ok: true, id });
  } catch (e) {
    console.error(e);
    return res.status(e.status || 500).json({ erro: e.message });
  }
}

// api/ouvidoria.js
init_base();
init_brevo();
var PRAZO_UTEIS = 10;
var soD4 = (s) => String(s || "").replace(/\D/g, "");
var txt5 = (s, n) => String(s || "").replace(/[<>]/g, "").trim().slice(0, n);
var erro11 = (m, s = 400) => Object.assign(new Error(m), { status: s });
var TIPOS2 = ["RECLAMACAO", "DENUNCIA", "SUGESTAO", "ELOGIO", "LGPD"];
function maisUteis(d, n) {
  const x = new Date(d);
  while (n > 0) {
    x.setDate(x.getDate() + 1);
    if (x.getDay() !== 0 && x.getDay() !== 6) n--;
  }
  return x.toISOString().slice(0, 10);
}
function cpfOk5(c) {
  c = soD4(c);
  if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false;
  for (let t = 9; t < 11; t++) {
    let s = 0;
    for (let i = 0; i < t; i++) s += +c[i] * (t + 1 - i);
    if (s * 10 % 11 % 10 !== +c[t]) return false;
  }
  return true;
}
async function handler27(req, res) {
  if (cors(req, res)) return;
  try {
    const b = req.body || {};
    if (b.acao === "abrir") {
      const cpf = soD4(b.cpf), nome = txt5(b.nome, 100), relato = txt5(b.relato, 4e3), tipo = TIPOS2.includes(b.tipo) ? b.tipo : "RECLAMACAO";
      if (nome.length < 3) throw erro11("Informe o seu nome.");
      if (!cpfOk5(cpf)) throw erro11("CPF inv\xE1lido.");
      if (relato.length < 15) throw erro11("Conte o que aconteceu (pelo menos 15 letras).");
      if (soD4(b.telefone).length < 10 && !/@/.test(b.email || "")) throw erro11("Informe um WhatsApp ou e-mail para a resposta.");
      const ini = Date.now() - 864e5, doDia = (await db.collection("ouvidoria").where("cpf", "==", cpf).get()).docs.filter((d) => (d.data().em || 0) >= ini).length;
      if (doDia >= 3) throw erro11("Voc\xEA j\xE1 abriu protocolos hoje. Aguarde a resposta.", 429);
      const protocolo = "OUV" + (/* @__PURE__ */ new Date()).toISOString().slice(2, 10).replace(/-/g, "") + String(Math.floor(Math.random() * 1e5)).padStart(5, "0");
      const doc = { protocolo, cpf, nome, telefone: soD4(b.telefone).slice(0, 13), email: txt5(b.email, 120), tipo, assunto: txt5(b.assunto, 120), relato, status: "ABERTO", em: Date.now(), prazo: maisUteis(/* @__PURE__ */ new Date(), PRAZO_UTEIS), historico: [{ em: Date.now(), por: "Cliente", obs: "Protocolo aberto" }], ip: req.headers["cf-connecting-ip"] || "" };
      await db.collection("ouvidoria").doc(protocolo).set(doc);
      try {
        if (brevoLigado() && process.env.DONO_EMAIL) await enviarEmail({ para: process.env.DONO_EMAIL, assunto: `Ouvidoria ${protocolo}: ${tipo.toLowerCase()} de ${nome}`, titulo: "Novo protocolo na ouvidoria", texto: `${nome} (CPF final ${cpf.slice(-3)})
Tipo: ${tipo}
Assunto: ${doc.assunto}

${relato}

Prazo de resposta: ${doc.prazo.split("-").reverse().join("/")}` });
      } catch (e) {
      }
      return res.json({ protocolo, prazo: doc.prazo });
    }
    if (b.acao === "consultar") {
      const p = (await db.collection("ouvidoria").doc(txt5(b.protocolo, 20).toUpperCase()).get()).data();
      if (!p || p.cpf.slice(-4) !== soD4(b.cpfFim)) throw erro11("Protocolo n\xE3o encontrado. Confira o n\xFAmero e os 4 \xFAltimos d\xEDgitos do CPF.", 404);
      return res.json({ protocolo: p.protocolo, status: p.status, prazo: p.prazo, tipo: p.tipo, assunto: p.assunto, em: p.em, resposta: p.resposta || "", respondidoEm: p.respondidoEm || null });
    }
    if (b.acao === "responder") {
      const eu = await exigirEquipe(req, ["DONO", "FINANCEIRO", "SUPORTE"]);
      const ref = db.collection("ouvidoria").doc(txt5(b.protocolo, 20)), p = (await ref.get()).data();
      if (!p) throw erro11("Protocolo n\xE3o encontrado", 404);
      const status = ["EM_ANALISE", "RESPONDIDO", "ENCERRADO"].includes(b.status) ? b.status : "RESPONDIDO", resposta = txt5(b.resposta, 4e3);
      await ref.set({ status, ...resposta ? { resposta, respondidoEm: Date.now(), respondidoPor: eu.nome } : {}, historico: [...p.historico || [], { em: Date.now(), por: eu.nome, obs: status + (resposta ? ": " + resposta.slice(0, 200) : "") }] }, { merge: true });
      return res.json({ ok: true });
    }
    throw erro11("a\xE7\xE3o inv\xE1lida");
  } catch (e) {
    return res.status(e.status || 500).json({ erro: e.message });
  }
}

// api/avisar-dono.js
init_base();
init_brevo();
async function handler28(req, res) {
  if (cors(req, res)) return;
  try {
    const eu = await exigirEquipe(req, ["SUPORTE", "FINANCEIRO", "COMERCIAL"]);
    const ref = db.collection("chatDono").doc(eu.uid), c = (await ref.get()).data() || {};
    if ((c.avisadoEm || 0) > Date.now() - 15 * 6e4 || !brevoLigado() || !process.env.DONO_EMAIL) return res.json({ ok: true, enviado: false });
    await ref.set({ avisadoEm: Date.now() }, { merge: true });
    await enviarEmail({
      para: process.env.DONO_EMAIL,
      assunto: `Mensagem de ${eu.nome} (${eu.role.toLowerCase()})`,
      titulo: "Nova mensagem da equipe",
      texto: `${eu.nome} mandou uma mensagem para voc\xEA:

"${String(req.body?.texto || "").slice(0, 300)}"

Responda no Painel do Dono, no bot\xE3o de conversa no canto da tela.`
    });
    return res.json({ ok: true, enviado: true });
  } catch (e) {
    return res.status(e.status || 500).json({ erro: e.message });
  }
}

// api/atendimento.js
init_base();
init_crm_rotinas();
init_erros();
var ONLINE_MS = 3 * 6e4;
var TMA_PAD = 5;
var erro12 = (m, s = 400) => Object.assign(new Error(m), { status: s });
var DIAS = ["domingo", "segunda-feira", "ter\xE7a-feira", "quarta-feira", "quinta-feira", "sexta-feira", "s\xE1bado"];
function horario(cfg, agora = Date.now()) {
  const ini = +(cfg.atendHoraIni ?? 8), fim = +(cfg.atendHoraFim ?? 20), dom = cfg.atendDomingo === "sim";
  const br = new Date(agora - 3 * 36e5), h = br.getUTCHours() + br.getUTCMinutes() / 60, dia = br.getUTCDay();
  const abreNoDia = (d) => d !== 0 || dom;
  const aberto = abreNoDia(dia) && h >= ini && h < fim;
  let proximo = "";
  if (!aberto) {
    if (abreNoDia(dia) && h < ini) proximo = `hoje \xE0s ${ini}h`;
    else {
      let k = 1;
      while (!abreNoDia((dia + k) % 7) && k < 7) k++;
      proximo = k === 1 ? `amanh\xE3 \xE0s ${ini}h` : `${DIAS[(dia + k) % 7]} \xE0s ${ini}h`;
    }
  }
  return { ini, fim, aberto, proximo, domingo: dom };
}
function onlineDe(pres, fila2, agora = Date.now()) {
  return Object.entries(pres || {}).filter(([, p]) => p && agora - (+p.em || 0) < ONLINE_MS && !/^(off|pausa)/.test(String(p.status || "")) && (p.fila === fila2 || p.fila === "dono")).map(([uid, p]) => ({ uid, nome: p.nome || "", fila: p.fila }));
}
var esperando = (a) => a.status === "HUMANO" && !(a.msgs || []).some((m) => m.de === "atendente" && !m.auto && (+m.em || 0) >= (+a.encaminhadoEm || 0));
async function meu(req, id) {
  const eu = await exigirEquipe(req, ["VENDEDOR", "GERENTE", "DONO"]);
  const ref = db.collection("atendimentos").doc(String(id || "")), s = await ref.get();
  if (!s.exists) throw erro12("Atendimento n\xE3o encontrado", 404);
  const a = s.data();
  if (a.abertoPor !== eu.uid && eu.role !== "DONO") throw erro12("Este atendimento n\xE3o \xE9 seu", 403);
  return { eu, ref, a };
}
async function fila(req, id) {
  const { a } = await meu(req, id);
  const [cfg, crm, pres, atr, lista3] = await Promise.all([
    config(),
    db.collection("config").doc("crm").get().then((s) => s.data() || {}),
    db.collection("plataforma").doc("presencaCrm").get().then((s) => s.data() || {}),
    db.collection("crmAtrib").doc("portal_" + id).get().then((s) => s.data() || {}),
    db.collection("atendimentos").where("status", "==", "HUMANO").get().then((q) => q.docs.map((d) => ({ id: d.id, ...d.data() })))
  ]);
  const escala = Object.fromEntries((crm.escalaV2 || []).map((e) => [e.uid, e])), hr = horario(cfg), filaNome = atr.fila || "suporte", on = onlineDe(pres, filaNome).filter((o) => noTurno(escala[o.uid])), tma = Math.max(1, Math.min(60, +crm.tmaMin || TMA_PAD));
  const espera = lista3.filter(esperando).sort((x, y) => (+x.encaminhadoEm || +x.atualizadoEm || 0) - (+y.encaminhadoEm || +y.atualizadoEm || 0));
  const pos = espera.findIndex((x) => x.id === id);
  const atendido = a.status !== "HUMANO" || !esperando(a);
  const aFrente = pos < 0 ? 0 : pos;
  const estimativaMin = atendido ? 0 : aFrente === 0 ? on.length ? 1 : tma : Math.ceil(aFrente / Math.max(1, on.length)) * tma;
  const resp = atr.uid ? { nome: String(atr.nome || "").split(" ")[0], online: on.some((o) => o.uid === atr.uid) } : null;
  return { atendido, posicao: pos < 0 ? null : pos + 1, aFrente, online: on.length, tma, estimativaMin, aberto: hr.aberto, proximo: hr.proximo, horario: `${hr.ini}h \xE0s ${hr.fim}h${hr.domingo ? "" : ", de segunda a s\xE1bado"}`, responsavel: resp, em: Date.now() };
}
async function avaliar(req, b) {
  const { eu, ref, a } = await meu(req, b.id);
  const nota2 = Math.round(+b.nota);
  if (!(nota2 >= 1 && nota2 <= 5)) throw erro12("Escolha uma nota de 1 a 5");
  if (a.status !== "CONCLUIDO") throw erro12("A avalia\xE7\xE3o abre quando o atendimento for conclu\xEDdo");
  if (a.pesquisa) throw erro12("Este atendimento j\xE1 foi avaliado", 409);
  const atr = (await db.collection("crmAtrib").doc("portal_" + b.id).get()).data() || {};
  let uid = atr.uid || "", nome = atr.nome || "";
  if (!uid) {
    const ult = [...a.msgs || []].reverse().find((m) => m.de === "atendente" && !m.auto && m.por);
    nome = ult?.por || a.concluidoPor || "";
    if (nome) {
      const q = await db.collection("users").where("nome", "==", nome).limit(1).get();
      uid = q.docs[0]?.id || "";
    }
  }
  const pesquisa = { nota: nota2, resolvido: b.resolvido === void 0 ? null : !!b.resolvido, comentario: String(b.comentario || "").trim().slice(0, 500), em: Date.now(), atendente: nome, atendenteUid: uid };
  await ref.set({ pesquisa, atualizadoEm: Date.now() }, { merge: true });
  await db.collection("crmAvaliacoes").doc("portal_" + b.id).set({
    key: "portal:" + b.id,
    nota: nota2,
    resolvido: pesquisa.resolvido,
    comentario: pesquisa.comentario,
    uid,
    nome,
    fila: atr.fila || "suporte",
    canal: "portal",
    protocolo: a.protocolo || "",
    avaliador: eu.nome || a.nome || "",
    avaliadorRole: eu.role,
    lojaNome: a.lojaNome || "",
    via: "chat",
    em: Date.now()
  });
  return { ok: true };
}
async function limite(uid) {
  const h = (/* @__PURE__ */ new Date()).toISOString().slice(0, 13), ref = db.collection("atendIaUso").doc(uid), d = (await ref.get()).data() || {};
  const n = d.h === h ? (+d.n || 0) + 1 : 1;
  if (n > 40) throw erro12("Muitas perguntas seguidas. Espere alguns minutos ou chame um atendente.", 429);
  await ref.set({ h, n }, { merge: true });
}
var PROMPT = (a, eu, extra) => `Voc\xEA \xE9 a assistente virtual de suporte da NexumCell e conversa com um ${eu.role === "GERENTE" ? "gerente" : "vendedor"} de loja parceira (${a.lojaNome || "loja parceira"}), n\xE3o com o cliente final. A NexumCell vende celular parcelado com trava do aparelho, faz an\xE1lise de cr\xE9dito pr\xF3pria e oferece empr\xE9stimo.
Responda em portugu\xEAs do Brasil, com educa\xE7\xE3o, frases curtas e passos numerados quando for "como fa\xE7o". V\xE1 direto ao ponto: primeiro a solu\xE7\xE3o, depois os detalhes. No m\xE1ximo 8 linhas. N\xE3o use emojis. Nunca invente valores, prazos, regras ou telas: se n\xE3o souber, diga que vai chamar um atendente.
Como o sistema funciona: Nova venda tem 8 passos (documento, biometria, contato, an\xE1lise, aparelho, contrato, entrada e trava). A trava \xE9 instalada pelo QR code na tela de boas-vindas do celular restaurado de f\xE1brica (tocar 6 vezes), ou pelo computador com cabo USB quando aparece "app bloqueado para proteger o dispositivo". O cliente paga as parcelas pelo Pix no app NexumCell (aba Parcelas) e o aparelho libera sozinho minutos depois. Liberar ou remover a trava manualmente, mudar dado de contrato, estorno, cancelamento e acordo s\xE3o feitos s\xF3 pela equipe NexumCell. Vendas s\xF3 no notebook autorizado da loja, dentro da loja. Cada CPF pode ter um aparelho financiado em aberto. Uma licen\xE7a a cada 12 parcelas.
C\xF3digos de erro do sistema (quando a pessoa citar um n\xFAmero, explique o que \xE9 e o passo a passo para resolver; no fim, indique o link ${AJUDA_URL}#erro-CODIGO):
${errosTexto()}
Central de ajuda com passo a passo: ${AJUDA_URL} (artigos: #trava-qr, #trava-usb, #pagou-nao-liberou, #pix-cliente, #notebook, #venda-distancia, #foto-documento, #licencas, #acesso).
${extra.orientacoes ? "Orienta\xE7\xF5es do dono:\n" + extra.orientacoes + "\n" : ""}${a.contrato ? `Contrato em pauta: n\xBA ${a.contrato.numero} \xB7 cliente ${a.contrato.cliente || ""}.
` : ""}Quando precisar de algu\xE9m da equipe (liberar aparelho, mudar contrato, comprovante de pagamento, erro que os passos n\xE3o resolvem, reclama\xE7\xE3o, cancelamento, estorno, acordo) ou quando a pessoa pedir um atendente ou disser que n\xE3o resolveu duas vezes, marque "atendente": true e escreva em "resposta" uma frase curta avisando que vai chamar um atendente.
Responda s\xF3 em JSON: {"resposta":"texto pronto para mostrar","atendente":true|false,"resumo":"uma linha descrevendo o problema para a equipe"}.`;
async function ia(req, b) {
  const { eu, a } = await meu(req, b.id);
  if (a.status === "CONCLUIDO") throw erro12("Atendimento conclu\xEDdo");
  await limite(eu.uid);
  const msgs = (a.msgs || []).filter((m) => m.t && ["user", "bot", "atendente"].includes(m.de)).slice(-14);
  const ult = [...msgs].reverse().find((m) => m.de === "user")?.t || "";
  const cods = codigosNoTexto(ult);
  const crm = (await db.collection("config").doc("crm").get()).data() || {};
  const hist = msgs.map((m) => ({ role: m.de === "user" ? "user" : "assistant", content: String(m.t).slice(0, 1500) }));
  let j = {};
  try {
    const ex = await exemplosBons(), art = await artigosTexto().catch(() => "");
    const t = await groq([{ role: "system", content: PROMPT(a, eu, { orientacoes: String(crm.iaOrientacoes || "").slice(0, 2500) }) + (art ? "\n\n" + art : "") + (ex ? "\n\n" + ex : "") }, ...hist], { temperatura: 0.2, max: 600, json: true });
    j = JSON.parse(t);
  } catch (e) {
    if (cods.length) return { texto: cods.map(resolucaoTexto).join("\n\n"), atendente: false, codigos: cods, fonte: "catalogo" };
    throw erro12(e.message || "A IA n\xE3o respondeu", e.status || 502);
  }
  return { texto: String(j.resposta || "").trim(), atendente: !!j.atendente, resumo: String(j.resumo || "").slice(0, 200), codigos: cods, fonte: "ia" };
}
async function handler29(req, res) {
  if (cors(req, res)) return;
  try {
    const b = req.body || {};
    if (b.acao === "fila") return res.json(await fila(req, b.id));
    if (b.acao === "avaliar") return res.json(await avaliar(req, b));
    if (b.acao === "ia") return res.json(await ia(req, b));
    if (b.acao === "resolucao") {
      const c = String(b.codigo || "");
      if (!ERROS[c]) throw erro12("C\xF3digo n\xE3o encontrado", 404);
      return res.json({ texto: resolucaoTexto(c), ...ERROS[c] });
    }
    throw erro12("A\xE7\xE3o inv\xE1lida");
  } catch (e) {
    return res.status(e.status || 500).json({ erro: e.message });
  }
}

// api/localizar.js
init_base();
var dias5 = (a, b) => Math.round((/* @__PURE__ */ new Date(b + "T12:00:00Z") - /* @__PURE__ */ new Date(a + "T12:00:00Z")) / 864e5);
var atrasoDe = (v, h = hoje()) => Math.max(0, ...(v.parcelas || []).filter((p) => !p.pago && p.venc && p.venc < h).map((p) => dias5(p.venc, h)));
var erro13 = (m, s = 400) => Object.assign(new Error(m), { status: s });
async function pedir(b, eu) {
  const vendaId = String(b.vendaId || ""), motivo = b.motivo === "roubo" ? "roubo" : "atraso", obs = String(b.obs || "").trim().slice(0, 300);
  if (!vendaId) throw erro13("Informe o contrato");
  const vs = await db.collection("vendas").doc(vendaId).get();
  if (!vs.exists) throw erro13("Contrato n\xE3o encontrado", 404);
  const v = vs.data(), tk = v.aparelhoToken;
  if (v.status !== "ATIVA") throw erro13("S\xF3 \xE9 poss\xEDvel localizar aparelho de contrato em aberto");
  if (!tk) throw erro13("Este contrato n\xE3o tem trava instalada");
  if (v.aceiteLocalizacao !== true) throw erro13("Este contrato n\xE3o tem a autoriza\xE7\xE3o de localiza\xE7\xE3o assinada pelo cliente (contratos assinados antes da cl\xE1usula). N\xE3o \xE9 poss\xEDvel localizar.");
  const as = await db.collection("aparelhos").doc(tk).get(), ap = as.exists ? as.data() : {};
  const cfg = await config(), min = +cfg.localizarDias || 30, at = atrasoDe(v);
  if (motivo === "atraso" && at < min) throw erro13(`O atraso \xE9 de ${at} dia(s). S\xF3 pode localizar com ${min} dias ou mais de atraso.`);
  if (motivo === "roubo" && !(ap.roubo && !ap.roubo.liberadoEm)) throw erro13("N\xE3o h\xE1 roubo, furto ou perda comunicado neste contrato");
  if (obs.length < 5) throw erro13("Escreva o motivo do pedido (para o registro)");
  const recentes = await db.collection("localizacoes").where("vendaId", "==", vendaId).get();
  if (recentes.docs.filter((d) => (d.data().em || 0) > Date.now() - 864e5).length >= 3) throw erro13("Limite de 3 pedidos por contrato em 24 horas");
  const ref = db.collection("localizacoes").doc(), em = Date.now();
  await ref.set({
    vendaId,
    token: tk,
    numero: v.numero || null,
    clienteNome: v.clienteNome || "",
    lojaNome: v.lojaNome || "",
    motivo,
    obs,
    atrasoDias: at,
    por: eu.nome,
    porUid: eu.uid,
    role: eu.role,
    em,
    status: "AGUARDANDO"
  });
  await db.collection("aparelhos").doc(tk).set({ localizarPedido: { id: ref.id, em, motivo } }, { merge: true });
  const push = await pushAparelho(tk).catch(() => false);
  await db.collection("logs").add({ em, uid: eu.uid, nome: eu.nome, role: eu.role, acao: "Pedido de localiza\xE7\xE3o do aparelho", alvo: vendaId, detalhe: `${motivo === "roubo" ? "Roubo" : "Atraso de " + at + " dias"}: ${obs}` });
  return { ok: true, id: ref.id, push };
}
async function resultado(b, eu) {
  const ref = db.collection("localizacoes").doc(String(b.id || "")), s = await ref.get();
  if (!s.exists) throw erro13("Pedido n\xE3o encontrado", 404);
  const p = s.data();
  if (p.status === "OK") return { status: "OK", local: p.local, recebidoEm: p.recebidoEm };
  const ap = (await db.collection("aparelhos").doc(p.token).get()).data() || {}, c = ap.checkin || {};
  if (c.localPedido === s.id && c.local?.lat != null) {
    const local = { lat: +c.local.lat, lng: +c.local.lng, precisao: Math.round(+c.local.precisao || 0), em: +c.local.em || +c.em || Date.now() };
    await ref.set({ status: "OK", local, recebidoEm: Date.now(), bateria: c.bateria ?? null }, { merge: true });
    return { status: "OK", local, recebidoEm: Date.now() };
  }
  if (c.localPedido === s.id) {
    await ref.set({ status: "SEM_SINAL", recebidoEm: Date.now() }, { merge: true });
    return { status: "SEM_SINAL" };
  }
  if (Date.now() - p.em > 24 * 36e5) {
    await ref.set({ status: "EXPIRADO" }, { merge: true });
    return { status: "EXPIRADO" };
  }
  return { status: "AGUARDANDO", ultimoContato: c.em || null };
}
async function handler30(req, res) {
  if (cors(req, res)) return;
  if (req.method !== "POST") return res.status(405).end();
  try {
    const eu = await exigirEquipe(req, ["DONO", "FINANCEIRO"]), b = req.body || {};
    if (b.acao === "pedir") return res.json(await pedir(b, eu));
    if (b.acao === "resultado") return res.json(await resultado(b, eu));
    return res.status(400).json({ erro: "a\xE7\xE3o inv\xE1lida" });
  } catch (e) {
    return res.status(e.status || 500).json({ erro: e.message });
  }
}

// worker/index.js
var ROTAS = { metas: handler15, atendimento: handler29, localizar: handler30, "ajuda-artigos": ajudaArtigos, "avisar-dono": handler28, equipe: handler13, ia: handler5, emprestimo: handler6, "crm-ia": handler14, ouvidoria: handler27, ios: handler24, codigo, acordo, instalacao: handler11, "cliente-app": handler23, pix: handler, loja: handler2, "pix-automatico": handler3, "asaas-webhook": handler8, assistente: handler9, avisos: handler16, nf: handler17, assinatura: handler18, "zapsign-webhook": handler19, preanalise: handler4, credenciamento: handler20, push: handler21, saas: handler7, motor: handler12, repasse: handler10, remota: handler22, "remover-codigo": handler25, lead: handler26 };
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
    const qual = event.cron === (env2.CRON_NOITE || "0 22 * * *") ? "noite" : ["*/15 * * * *", "0 * * * *", env2.CRON_HORA].includes(event.cron) ? "hora" : "manha";
    ctx.waitUntil(rotinas(qual).then((r) => console.log("rotina", qual, JSON.stringify(r))).catch((e) => console.error("rotina", qual, e)));
  }
};
export {
  index_default as default
};
