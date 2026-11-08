// PIX Automático (débito automático no PIX), pedido pelo próprio cliente no portal.
// O QR code paga a PRÓXIMA parcela agora (com o desconto de pagamento antecipado) e autoriza
// o débito automático das seguintes, todo mês, no valor da parcela.
// POST /api/pix-automatico {"token":"<token do aparelho>"}
// ATENÇÃO: confira no sandbox do Asaas os nomes dos campos de "immediateQrCode" (a documentação
// pública não detalha os subcampos) antes de ligar em produção.
import { db, asaas, cors, clienteAsaas, encargos, hoje, r2 } from './_base.js';

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const { token } = req.body || {};
    const as = await db.collection('aparelhos').doc(String(token)).get();
    if (!as.exists) return res.status(404).json({ erro: 'contrato não encontrado' });
    const ap = as.data(), vref = db.collection('vendas').doc(ap.vendaId), v = (await vref.get()).data();
    if (v.pixAutomatico?.status === 'ATIVO') return res.status(200).json({ jaAtivo: true });
    const abertas = (v.parcelas || []).filter((p) => !p.pago);
    if (abertas.length < 2) return res.status(400).json({ erro: 'poucas parcelas em aberto' });
    const [prox, ...resto] = abertas, cli = await clienteAsaas(v);
    const valorAgora = encargos(prox, ap), valorMensal = r2(resto[0].valor);
    const aut = await asaas('/pix/automatic/authorizations', { method: 'POST', body: JSON.stringify({
      customerId: cli.id, frequency: 'MONTHLY', contractId: ap.vendaId.slice(0, 35), description: `Contrato ${v.numero}`.slice(0, 35),
      startDate: resto[0].venc, finishDate: resto[resto.length - 1].venc, value: valorMensal, paymentCreationMode: 'SUBSCRIPTION', retryPolicy: 'ALLOW_THREE_IN_SEVEN_DAYS',
      immediateQrCode: { originalValue: valorAgora, expirationSeconds: 86400, description: `Parcela ${prox.n} — contrato ${v.numero}`.slice(0, 35) },
    }) });
    // as cobranças desta autorização chegam no webhook e são casadas com a parcela pela data
    await vref.set({ pixAutomatico: { id: aut.id, status: 'AGUARDANDO', parcelaInicial: prox.n, valorMensal, em: Date.now() } }, { merge: true });
    const qr = aut.immediateQrCode || aut.qrCode || {};
    return res.status(200).json({ valor: valorAgora, valorMensal, copiaECola: qr.payload || qr.copyPaste || '', qrBase64: qr.encodedImage || '', autorizacao: aut.id });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ erro: e.message });
  }
}
