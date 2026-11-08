// Webhook do Asaas. Configure no Asaas: Integrações > Webhooks > URL https://SEU-PROJETO.vercel.app/api/asaas-webhook
// Eventos de cobrança (PAYMENT_RECEIVED, PAYMENT_CONFIRMED) e do PIX Automático. Token = ASAAS_WEBHOOK_TOKEN.
import { db, asaas, baixarParcela, parcelaDaCobranca, config } from './_base.js';
import { brevoLigado, avisarCliente } from './_brevo.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  if (req.headers['asaas-access-token'] !== process.env.ASAAS_WEBHOOK_TOKEN) return res.status(401).json({ erro: 'token inválido' });
  const { event, payment } = req.body || {};
  try {
    // ---- PIX Automático: autorização ativada / cancelada / instrução recusada ----
    if (String(event || '').startsWith('PIX_AUTOMATIC')) {
      const a = req.body.pixAutomaticAuthorization || req.body.authorization || req.body.pixAutomaticRecurringAuthorization || {};
      const contrato = String(a.contractId || '');
      if (contrato.startsWith('v')) {
        const st = event.includes('ACTIVATED') ? 'ATIVO' : event.includes('CANCEL') || event.includes('REFUSED') && event.includes('AUTHORIZATION') ? 'CANCELADO' : null;
        const dados = { pixAutomatico: { id: a.id || '', status: st || 'EVENTO', ultimoEvento: event, em: Date.now() } };
        await db.collection('vendas').doc(contrato).set(dados, { merge: true });
        const vt = (await db.collection('vendas').doc(contrato).get()).data()?.aparelhoToken;
        if (vt) await db.collection('aparelhos').doc(vt).set({ pixAutomatico: { status: dados.pixAutomatico.status, em: Date.now() } }, { merge: true });
        // débito automático ativo: apaga as cobranças avulsas das próximas parcelas para não cobrar duas vezes
        if (st === 'ATIVO') {
          const v = (await db.collection('vendas').doc(contrato).get()).data() || {}, parcelas = [...(v.parcelas || [])];
          for (const p of parcelas) if (!p.pago && p.asaasId && p.n !== v.pixAutomatico?.parcelaInicial) { try { await asaas('/payments/' + p.asaasId, { method: 'DELETE' }); } catch (e) {} delete p.asaasId; delete p.asaasLink; }
          await db.collection('vendas').doc(contrato).update({ parcelas });
        }
        if (event.includes('INSTRUCTION_REFUSED')) await db.collection('logs').add({ em: Date.now(), acao: 'PIX Automático: débito recusado', alvo: contrato, det: event, por: 'Asaas' });
      }
      return res.status(200).json({ ok: true });
    }
    // ---- link de pagamento no cartão (venda sem crediário) ----
    if (['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED'].includes(event) && String(payment?.externalReference || '').startsWith('cartao:')) {
      const id = payment.externalReference.slice(7);
      await db.collection('linksCartao').doc(id).set({ status: 'PAGO', pagoEm: Date.now(), valorLiquido: payment.netValue || null }, { merge: true });
      return res.status(200).json({ ok: true });
    }
    if (!['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED'].includes(event) || !payment) return res.status(200).json({ ok: true, ignorado: event });
    const alvo = await parcelaDaCobranca(payment);
    if (!alvo) return res.status(200).json({ ok: true, ignorado: 'sem referência NexumCell' });
    const forma = payment.billingType === 'PIX' ? (payment.pixAutomaticAuthorizationId ? 'PIX Automático (Asaas)' : 'PIX (Asaas)') : payment.billingType === 'BOLETO' ? 'Boleto (Asaas)' : payment.billingType === 'CREDIT_CARD' ? 'Cartão (Asaas)' : payment.billingType + ' (Asaas)';
    await baixarParcela(alvo.vendaId, alvo.n, payment.value, forma, 'Cobrança ' + payment.id);
    // recibo automático ao cliente (WhatsApp/SMS pelo Brevo), se ligado nas Configurações
    try {
      const cfg = await config();
      if (brevoLigado() && cfg.brevoRecibo === 'sim' && (cfg.brevoCanal || 'nenhum') !== 'nenhum') {
        const v = (await db.collection('vendas').doc(alvo.vendaId).get()).data() || {}, tel = (v.cliente?.telefones || [])[0];
        const valor = 'R$ ' + Number(payment.value).toFixed(2).replace('.', ','), nome = String(v.clienteNome || '').split(' ')[0];
        if (tel) await avisarCliente(tel, cfg.brevoCanal, { modelo: 'recibo', params: { NOME: nome, VALOR: valor, PARCELA: `${alvo.n}/${(v.parcelas || []).length}` },
          texto: `${cfg.empresa || 'NexumCell'}: ${nome}, recebemos ${valor} da parcela ${alvo.n}/${(v.parcelas || []).length}. Obrigado!` });
      }
    } catch (e) { console.error('recibo', e.message); }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ erro: e.message }); // o Asaas tenta de novo depois
  }
}
