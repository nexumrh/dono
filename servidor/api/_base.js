// Funções compartilhadas. Variáveis de ambiente (configure na Vercel, NUNCA no GitHub):
//   FIREBASE_SERVICE_ACCOUNT  -> JSON da conta de serviço do Firebase (Configurações do projeto > Contas de serviço)
//   ASAAS_API_KEY             -> chave de API do Asaas
//   ASAAS_WEBHOOK_TOKEN       -> o mesmo token que você colocar no webhook do Asaas
//   ASAAS_URL                 -> https://api.asaas.com/v3 (produção) ou https://api-sandbox.asaas.com/v3 (testes)
//   PORTAL_ORIGEM             -> https://nexumrh.github.io
import admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
}
export const db = admin.firestore();
export const auth = admin.auth();
export const ASAAS = process.env.ASAAS_URL || 'https://api.asaas.com/v3';

export async function asaas(path, opts = {}) {
  const r = await fetch(ASAAS + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', access_token: process.env.ASAAS_API_KEY, 'User-Agent': 'nexumcell', ...(opts.headers || {}) },
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
        parcelas: parcelas.map((p) => ({ n: p.n, venc: p.venc, valor: p.valor, pago: !!p.pago })),
        quitado,
        status: quitado ? 'QUITADO' : 'ATIVO',
      });
    }
    t.set(db.collection('logs').doc(), { em: Date.now(), acao: 'Pagamento automático (Asaas)', alvo: vendaId, det: `parcela ${n} · R$ ${valorPago} · ${forma}`, por: 'Asaas' });
  });
}
