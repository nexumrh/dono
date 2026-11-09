// Funções compartilhadas. Variáveis de ambiente (configure na Vercel, NUNCA no GitHub):
//   FIREBASE_SERVICE_ACCOUNT  -> JSON da conta de serviço do Firebase (Configurações do projeto > Contas de serviço)
//   ASAAS_API_KEY             -> chave de API do Asaas
//   ASAAS_WEBHOOK_TOKEN       -> o mesmo token que você colocar no webhook do Asaas
//   ASAAS_URL                 -> https://api.asaas.com/v3 (produção) ou https://api-sandbox.asaas.com/v3 (testes)
//   PORTAL_ORIGEM             -> https://nexumrh.github.io
import admin from 'firebase-admin';

// Na Vercel é o firebase-admin de verdade; no Cloudflare o wrangler.toml troca por worker/firebase-rest.js
if (!admin.apps.length && process.env.FIREBASE_SERVICE_ACCOUNT) {
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
}
export const db = admin.firestore();
export const auth = admin.auth();
export const ASAAS = () => process.env.ASAAS_URL || 'https://api.asaas.com/v3';

// Chave do Asaas: o Dono pode colar no Painel (cofre segredos/asaas, que nenhum portal consegue ler; só o servidor).
// Se estiver lá, vale ela (e o ambiente escolhido no Painel); senão, usa as variáveis do Cloudflare/Vercel.
let _cofre = null;
export async function asaasConf() {
  if (!_cofre || _cofre.em < Date.now() - 60e3) {
    let d = {};
    try { d = (await db.collection('segredos').doc('asaas').get()).data() || {}; } catch (e) { d = {}; }
    _cofre = { em: Date.now(), d };
  }
  const d = _cofre.d, chave = String(d.chave || '').trim();
  if (chave) return { chave, url: d.ambiente === 'producao' ? 'https://api.asaas.com/v3' : 'https://api-sandbox.asaas.com/v3', webhookToken: d.webhookToken || process.env.ASAAS_WEBHOOK_TOKEN || '', origem: 'painel', ambiente: d.ambiente === 'producao' ? 'producao' : 'sandbox' };
  return { chave: process.env.ASAAS_API_KEY || '', url: ASAAS(), webhookToken: process.env.ASAAS_WEBHOOK_TOKEN || '', origem: 'servidor', ambiente: ASAAS().includes('sandbox') ? 'sandbox' : 'producao' };
}
export const asaasLigadoSrv = async () => !!(await asaasConf()).chave;

// Configurações do Painel do Dono (Firestore config/sistema), guardadas por 5 minutos
let _cfg = null;
export async function config() {
  if (_cfg && _cfg.em > Date.now() - 300e3) return _cfg.d;
  const d = (await db.collection('config').doc('sistema').get()).data() || {};
  _cfg = { em: Date.now(), d }; return d;
}

export async function asaas(path, opts = {}) {
  const ac = await asaasConf();
  if (!ac.chave) throw new Error('Asaas não configurado: cole a chave em Configurações → Asaas');
  const r = await fetch(ac.url + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', access_token: ac.chave, 'User-Agent': 'nexumcell', ...(opts.headers || {}) },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('Asaas ' + r.status + ': ' + JSON.stringify(j.errors || j));
  return j;
}

export function cors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.PORTAL_ORIGEM || 'https://nexumrh.github.io');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).end(); return true; }
  return false;
}

export const r2 = (n) => Math.round(n * 100) / 100;
export const hoje = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10); // horário de Brasília

// Mesma regra do portal: desconto se pago antes do vencimento, multa + juros/dia se atrasado
export function encargos(p, ap, data = hoje()) {
  const dias = Math.round((new Date(data) - new Date(p.venc)) / 86400e3);
  if (dias < 0) return r2(p.valor * (1 - (ap.descontoPct || 0) / 100));
  if (dias === 0) return p.valor;
  return r2(p.valor * (1 + (ap.multaPct || 0) / 100 + ((ap.moraDiaPct || 0) / 100) * dias));
}

// Dá baixa numa parcela e sincroniza venda + aparelho (igual salvarParcelas do portal)
export async function baixarParcela(vendaId, n, valorPago, forma, obs) {
  const ref = db.collection('vendas').doc(vendaId);
  await db.runTransaction(async (t) => {
    const s = await t.get(ref);
    if (!s.exists) throw new Error('venda não encontrada');
    const v = s.data();
    const parcelas = (v.parcelas || []).map((p) =>
      p.n === n && !p.pago ? { ...p, pago: true, pagoEm: hoje(), valorPago: r2(valorPago), forma, obs, por: 'Asaas (automático)', baixadoEm: Date.now() } : p
    );
    const quitado = parcelas.every((p) => p.pago);
    t.update(ref, { parcelas, status: quitado ? 'QUITADA' : v.status, ...(quitado ? { quitadoEm: Date.now() } : {}) });
    if (v.aparelhoToken) {
      t.update(db.collection('aparelhos').doc(v.aparelhoToken), {
        parcelas: parcelas.map(paraAparelho),
        quitado,
        status: quitado ? 'QUITADO' : 'ATIVO',
      });
    }
    t.set(db.collection('logs').doc(), { em: Date.now(), acao: 'Pagamento automático (Asaas)', alvo: vendaId, det: `parcela ${n} · R$ ${valorPago} · ${forma}`, por: 'Asaas' });
  });
}

// ---------- usados pelas novas rotas ----------
export async function exigirEquipe(req, perfis = ['DONO', 'FINANCEIRO', 'GERENTE', 'SUPORTE', 'VENDEDOR']) {
  const idt = String(req.headers.authorization || '').replace('Bearer ', '');
  const u = await auth.verifyIdToken(idt);
  const me = await db.collection('users').doc(u.uid).get();
  const dono = (u.email || '').toLowerCase() === String(process.env.DONO_EMAIL || '').toLowerCase();
  const role = dono ? 'DONO' : me.exists ? me.data().role : '';
  if (!perfis.includes(role)) { const e = new Error('sem permissão'); e.status = 403; throw e; }
  return { uid: u.uid, role, nome: dono ? 'Dono' : me.data()?.nome || '' };
}

// Cliente no Asaas: procura pelo CPF, cria se não existir (com WhatsApp/SMS/e-mail de cobrança ligados)
export async function clienteAsaas(v) {
  if (v.asaas?.customer) return { id: v.asaas.customer };
  const cpf = String(v.clienteCpf || '').replace(/\D/g, '');
  const achado = (await asaas('/customers?cpfCnpj=' + cpf)).data?.[0];
  if (achado) return achado;
  const c = v.cliente || {};
  return asaas('/customers', { method: 'POST', body: JSON.stringify({
    name: v.clienteNome, cpfCnpj: cpf, email: c.email || undefined,
    mobilePhone: String((c.telefones || [])[0] || '').replace(/\D/g, '') || undefined,
    phone: String((c.telefones || [])[1] || '').replace(/\D/g, '') || undefined,
    postalCode: String(c.cep || '').replace(/\D/g, '') || undefined, address: c.endereco || undefined, province: c.bairro || undefined,
    externalReference: 'cpf:' + cpf, notificationDisabled: false,
  }) });
}

// Uma cobrança no Asaas para cada parcela em aberto. O próprio Asaas aplica desconto, multa e juros,
// e manda os lembretes (WhatsApp/SMS/e-mail) conforme a régua configurada no painel do Asaas.
export async function gerarCobrancas(vendaId) {
  const ref = db.collection('vendas').doc(vendaId), s = await ref.get();
  if (!s.exists) throw new Error('venda não encontrada');
  const v = s.data(), ap = v.aparelhoToken ? (await db.collection('aparelhos').doc(v.aparelhoToken).get()).data() || {} : {};
  if (['CANCELADA', 'RETOMADA', 'REPROVADA'].includes(v.status)) return { criadas: 0, ignorado: v.status };
  if (v.pixAutomatico?.status === 'ATIVO') return { criadas: 0, pixAutomatico: true };
  let split = await splitDoVendedor(v);
  const cli = await clienteAsaas(v), parcelas = [...(v.parcelas || [])], vivos = new Set(parcelas.map((p) => p.asaasId).filter(Boolean));
  let criadas = 0, atualizadas = 0, apagadas = 0, emDinheiro = 0;
  // 1) cobranças antigas que não existem mais (renegociação): apaga no Asaas para o cliente não receber lembrete errado
  for (const id of v.asaas?.ids || []) if (!vivos.has(id)) { try { await asaas('/payments/' + id, { method: 'DELETE' }); apagadas++; } catch (e) {} }
  for (const p of parcelas) {
    // 2) paga na loja (dinheiro, PIX direto, extrato): avisa o Asaas para parar de cobrar
    if (p.pago) { if (p.asaasId && !p.asaasPago && !String(p.forma || '').includes('Asaas')) { try { await asaas(`/payments/${p.asaasId}/receiveInCash`, { method: 'POST', body: JSON.stringify({ paymentDate: p.pagoEm || hoje(), value: +(p.valorPago ?? p.valor), notifyCustomer: false }) }); emDinheiro++; } catch (e) {} p.asaasPago = true; } continue; }
    const venc = p.venc < hoje() ? hoje() : p.venc;
    // 3) mudou valor ou data (pagamento parcial, troca de vencimento): atualiza a cobrança
    if (p.asaasId) {
      if (p.asaasValor !== p.valor || p.asaasVenc !== p.venc) { try { await asaas('/payments/' + p.asaasId, { method: 'POST', body: JSON.stringify({ value: p.valor, dueDate: venc }) }); p.asaasValor = p.valor; p.asaasVenc = p.venc; atualizadas++; } catch (e) {} }
      continue;
    }
    // boleto cancelado pelo Dono/Financeiro: não recria até alguém pedir "gerar de novo"
    if (p.semCobranca) continue;
    // 4) parcela nova: cria a cobrança (o Asaas aplica desconto, multa e juros e manda os lembretes)
    const corpo = {
      customer: cli.id, billingType: 'UNDEFINED', value: p.valor, dueDate: venc,
      description: `${ap.recebedor || 'NexumCell'} · contrato ${v.numero} · parcela ${p.n}/${parcelas.length}`.slice(0, 500),
      externalReference: `${vendaId}:${p.n}`,
      discount: { value: Number(ap.descontoPct) || 0, dueDateLimitDays: 0, type: 'PERCENTAGE' },
      fine: { value: Number(ap.multaPct) || 0, type: 'PERCENTAGE' },
      interest: { value: r2((Number(ap.moraDiaPct) || 0) * 30) },   // Asaas: juros ao mês
    };
    // split: a comissão do vendedor cai direto na conta Asaas dele quando o cliente paga a parcela
    if (split) corpo.splits = [split];
    let cob;
    try { cob = await asaas('/payments', { method: 'POST', body: JSON.stringify(corpo) }); }
    catch (e) { if (!split) throw e; delete corpo.splits; split = null; cob = await asaas('/payments', { method: 'POST', body: JSON.stringify(corpo) });
      await db.collection('logs').add({ em: Date.now(), acao: 'Split da comissão recusado pelo Asaas', alvo: vendaId, det: String(e.message).slice(0, 300), por: 'Servidor' }); }
    if (corpo.splits) p.split = { walletId: split.walletId, pct: split.percentualValue };
    Object.assign(p, { asaasId: cob.id, asaasLink: cob.invoiceUrl, asaasValor: p.valor, asaasVenc: p.venc }); criadas++;
  }
  const ids = [...new Set(parcelas.map((p) => p.asaasId).filter(Boolean))];
  await ref.update({ parcelas, asaas: { customer: cli.id, ids, sincronizadoEm: Date.now() } });
  if (v.aparelhoToken) await db.collection('aparelhos').doc(v.aparelhoToken).set({ parcelas: parcelas.map(paraAparelho) }, { merge: true });
  return { criadas, atualizadas, apagadas, emDinheiro, customer: cli.id };
}

// Comissão no split: vale quando o Dono liga "Pagar comissão por split" e o vendedor tem conta Asaas (walletId)
export async function splitDoVendedor(v) {
  const cfg = await config();
  if (cfg.splitComissao !== 'sim' || !v.vendedorUid) return null;
  const u = (await db.collection('users').doc(v.vendedorUid).get()).data() || {};
  const pct = Number(u.comissaoPct ?? cfg.comissaoPct) || 0;
  if (!u.asaasWalletId || !(pct > 0)) return null;
  return { walletId: u.asaasWalletId, percentualValue: Math.min(50, pct) };
}

// Acha a parcela de uma cobrança: pela referência "venda:parcela" ou, nas cobranças do PIX Automático, pela data
export async function parcelaDaCobranca(payment) {
  const [vendaId, n] = String(payment.externalReference || '').split(':');
  if (vendaId && n) return { vendaId, n: +n };
  let vid = vendaId && vendaId.startsWith('v') ? vendaId : null;
  if (!vid && payment.pixAutomaticAuthorizationId) {
    const q = await db.collection('vendas').where('pixAutomatico.id', '==', payment.pixAutomaticAuthorizationId).limit(1).get();
    if (!q.empty) vid = q.docs[0].id;
  }
  if (vid) { const vendaId = vid;
    const v = (await db.collection('vendas').doc(vendaId).get()).data();
    const p = (v?.parcelas || []).filter((x) => !x.pago).sort((a, b) => Math.abs(new Date(a.venc) - new Date(payment.dueDate)) - Math.abs(new Date(b.venc) - new Date(payment.dueDate)))[0];
    if (p) return { vendaId, n: p.n };
  }
  return null;
}

// mesmo formato que o portal grava no aparelho (app, portal do cliente, pontos e recibos)
export function paraAparelho(p) {
  const o = { n: p.n, venc: p.venc, valor: p.valor, pago: !!p.pago };
  if (p.pago) Object.assign(o, { pagoEm: p.pagoEm || '', valorPago: +(p.valorPago ?? p.valor), emDia: !!p.pagoEm && p.pagoEm <= p.venc && !p.acordo });
  if (p.pagoParcial) o.pagoParcial = p.pagoParcial;
  if (!p.pago && p.asaasLink) o.asaasLink = p.asaasLink;
  return o;
}
