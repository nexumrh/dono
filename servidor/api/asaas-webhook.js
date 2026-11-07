// Webhook do Asaas: quando o cliente paga o PIX/boleto, a parcela é baixada sozinha
// e o aparelho destrava no próximo sincronismo (poucos minutos).
// No Asaas: Integrações > Webhooks > URL https://SEU-PROJETO.vercel.app/api/asaas-webhook
// Eventos: PAYMENT_RECEIVED e PAYMENT_CONFIRMED. Token de autenticação = ASAAS_WEBHOOK_TOKEN.
import { baixarParcela } from './_base.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  if (req.headers['asaas-access-token'] !== process.env.ASAAS_WEBHOOK_TOKEN) return res.status(401).json({ erro: 'token inválido' });
  const { event, payment } = req.body || {};
  if (!['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED'].includes(event) || !payment) return res.status(200).json({ ok: true, ignorado: event });
  // externalReference é gravado como "vendaId:numeroDaParcela" quando a cobrança é criada (api/pix.js)
  const [vendaId, n] = String(payment.externalReference || '').split(':');
  if (!vendaId || !n) return res.status(200).json({ ok: true, ignorado: 'sem referência NexumCell' });
  try {
    await baixarParcela(vendaId, +n, payment.value, payment.billingType === 'PIX' ? 'PIX (Asaas)' : payment.billingType + ' (Asaas)', 'Cobrança ' + payment.id);
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ erro: e.message }); // Asaas tenta de novo depois
  }
}
