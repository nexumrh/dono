// Negativação automática (Serasa via Asaas) e retirada automática quando o cliente paga.
// Roda na rotina da noite. Ligada em Configurações → Cobrança (negativarAuto = 'sim').
// - Pede a negativação de contratos com parcela vencida há X dias (negativarDias, padrão 60),
//   no máximo negativarMax por noite (padrão 10), pulando quem tem acordo em andamento ou liberação.
// - Cancela a negativação quando a parcela negativada foi paga por fora do boleto do Asaas
//   (dinheiro na loja, PIX avulso, acordo). Se foi paga pelo próprio boleto, o Asaas já retira sozinho.
import { db, asaas, asaasLigadoSrv, gerarCobrancas, hoje } from './_base.js';
import { pedirNegativacao } from './loja.js';

const diasEntre = (a, b) => Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 86400000);
const ATIVAS = ['PENDING', 'AWAITING_APPROVAL', 'AWAITING_CANCELLATION', 'PROCESSED', 'PAID', 'PARTIALLY_PAID'];

export async function negativacaoRotina(cfg) {
  if (!(await asaasLigadoSrv().catch(() => false))) return { negativacao: 'Asaas desligado' };
  const r = { pedidas: 0, canceladas: 0, erros: [] }, h = hoje();
  // 1) retirar quando já pagou (vale mesmo com a automática desligada)
  const negs = (await db.collection('vendas').where('negativacao.status', 'in', ['PENDING', 'AWAITING_APPROVAL', 'PROCESSED', 'PAID', 'PARTIALLY_PAID']).get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  for (const v of negs) {
    const n = v.negativacao, p = (v.parcelas || []).find((x) => x.n === n.parcela);
    const pagou = v.status === 'QUITADA' || (p && p.pago) || v.status === 'CANCELADA';
    if (!pagou) continue;
    try {
      if (p && p.pago && p.forma && !/asaas/i.test(String(p.por || '')) && p.asaasId) {
        try { await asaas(`/payments/${p.asaasId}/receiveInCash`, { method: 'POST', body: JSON.stringify({ paymentDate: p.pagoEm || h, value: p.valorPago || p.valor, notifyCustomer: false }) }); } catch (e) { /* já baixada */ }
      }
      try { await asaas(`/paymentDunnings/${n.id}/cancel`, { method: 'POST' }); } catch (e) { if (!/already|cancel|not.?found|404/i.test(e.message)) throw e; }
      await db.collection('vendas').doc(v.id).set({ negativacao: { ...n, status: 'CANCELADA', canceladaEm: Date.now(), motivo: 'pagamento recebido' } }, { merge: true });
      await db.collection('logs').add({ em: Date.now(), acao: 'Negativação retirada (pagou)', alvo: v.id, det: `parcela ${n.parcela}`, por: 'Rotina automática' });
      r.canceladas++;
    } catch (e) { r.erros.push(`${v.numero}: ${e.message}`); }
  }
  // 2) pedir as novas
  if (cfg.negativarAuto !== 'sim') return r;
  const dias = Math.max(30, Number(cfg.negativarDias) || 60), max = Math.max(1, Number(cfg.negativarMax) || 10);
  const ativas = (await db.collection('vendas').where('status', '==', 'ATIVA').get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  const alvo = ativas.map((v) => ({ v, p: (v.parcelas || []).filter((x) => !x.pago && x.venc < h).sort((a, b) => a.venc < b.venc ? -1 : 1)[0] }))
    .filter(({ v, p }) => p && diasEntre(p.venc, h) >= dias && !(v.negativacao && ATIVAS.includes(v.negativacao.status)) && !v.naoNegativar
      && !(v.acordo && v.acordo.status !== 'QUEBRADO') && !(v.liberadoAte && v.liberadoAte > Date.now()))
    .sort((a, b) => a.p.venc < b.p.venc ? -1 : 1).slice(0, max);
  for (const { v, p } of alvo) {
    try {
      let parc = p;
      if (!parc.asaasId) { await gerarCobrancas(v.id); const v2 = (await db.collection('vendas').doc(v.id).get()).data(); parc = (v2.parcelas || []).find((x) => x.n === p.n) || p; }
      if (!parc.asaasId) throw new Error('parcela sem cobrança no Asaas');
      await pedirNegativacao(v, parc, 'Rotina automática');
      await db.collection('logs').add({ em: Date.now(), acao: 'Negativação pedida (automática)', alvo: v.id, det: `parcela ${p.n} · ${diasEntre(p.venc, h)} dias de atraso`, por: 'Rotina automática' });
      r.pedidas++;
    } catch (e) { r.erros.push(`${v.numero}: ${e.message}`); }
  }
  return r;
}
