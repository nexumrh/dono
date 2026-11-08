// Gera um PIX dinâmico do Asaas para uma parcela (valor já com desconto ou multa).
// Chamado pelo app da trava:   POST /api/pix  {"token":"<token do aparelho>","n":3}
// ou pelo portal (equipe):     POST /api/pix  {"vendaId":"...","n":3}  + Authorization: Bearer <idToken do Firebase>
import { db, auth, asaas, cors, encargos, hoje } from './_base.js';

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const { token, vendaId: vid, n } = req.body || {};
    let vendaId = vid;
    if (token) {
      const ap = await db.collection('aparelhos').doc(String(token)).get();
      if (!ap.exists) return res.status(404).json({ erro: 'aparelho não encontrado' });
      vendaId = ap.data().vendaId;
    } else {
      const idt = String(req.headers.authorization || '').replace('Bearer ', '');
      const u = await auth.verifyIdToken(idt);
      const me = await db.collection('users').doc(u.uid).get();
      if (!me.exists || !['DONO', 'FINANCEIRO', 'GERENTE'].includes(me.data().role)) return res.status(403).json({ erro: 'sem permissão' });
    }
    const vs = await db.collection('vendas').doc(String(vendaId)).get();
    if (!vs.exists) return res.status(404).json({ erro: 'venda não encontrada' });
    const v = vs.data();
    const p = (v.parcelas || []).find((x) => x.n === +n);
    if (!p || p.pago) return res.status(400).json({ erro: 'parcela inexistente ou já paga' });
    const apDoc = v.aparelhoToken ? (await db.collection('aparelhos').doc(v.aparelhoToken).get()).data() : {};
    const valor = encargos(p, apDoc || {});

    // parcela que já tem cobrança no Asaas (cobranças automáticas): usa o PIX dela (o Asaas aplica desconto/multa/juros)
    if (p.asaasId) {
      const qr = await asaas(`/payments/${p.asaasId}/pixQrCode`);
      return res.status(200).json({ valor, copiaECola: qr.payload, qrBase64: qr.encodedImage, expira: qr.expirationDate, cobranca: p.asaasId });
    }
    // cliente no Asaas (procura pelo CPF, cria se não existir)
    const cpf = String(v.clienteCpf || '').replace(/\D/g, '');
    let cli = (await asaas('/customers?cpfCnpj=' + cpf)).data?.[0];
    if (!cli) cli = await asaas('/customers', { method: 'POST', body: JSON.stringify({ name: v.clienteNome, cpfCnpj: cpf, mobilePhone: String(v.clienteTel1 || '').replace(/\D/g, '') }) });

    // reaproveita cobrança pendente da mesma parcela com o mesmo valor
    const ref = `${vs.id}:${p.n}`;
    let cob = (await asaas('/payments?externalReference=' + encodeURIComponent(ref) + '&status=PENDING')).data?.find((c) => c.value === valor);
    if (!cob) {
      cob = await asaas('/payments', {
        method: 'POST',
        body: JSON.stringify({ customer: cli.id, billingType: 'PIX', value: valor, dueDate: hoje(), externalReference: ref, description: `NexumCell contrato ${v.numero} parcela ${p.n}` }),
      });
    }
    const qr = await asaas(`/payments/${cob.id}/pixQrCode`);
    return res.status(200).json({ valor, copiaECola: qr.payload, qrBase64: qr.encodedImage, expira: qr.expirationDate, cobranca: cob.id });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ erro: e.message });
  }
}
