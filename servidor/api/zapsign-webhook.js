// Webhook da ZapSign (Configurações > Integrações > Webhooks na ZapSign).
// URL: https://SEU-SERVIDOR/api/zapsign-webhook · cabeçalho X-Nexum-Token = ZAPSIGN_WEBHOOK_TOKEN
// Mesmo assim o servidor confere o documento direto na API da ZapSign antes de aceitar (ninguém consegue forjar).
import { db } from './_base.js';
import { zapsign } from './assinatura.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  if (process.env.ZAPSIGN_WEBHOOK_TOKEN && req.headers['x-nexum-token'] !== process.env.ZAPSIGN_WEBHOOK_TOKEN) return res.status(401).json({ erro: 'token inválido' });
  try {
    const b = req.body || {}, vendaId = String(b.external_id || '');
    if (!vendaId || !b.token) return res.status(200).json({ ok: true, ignorado: 'sem referência' });
    const d = await zapsign('/docs/' + b.token + '/');                 // confirmação na própria ZapSign
    if (String(d.external_id) !== vendaId) return res.status(200).json({ ok: true, ignorado: 'documento não confere' });
    const ref = db.collection('vendas').doc(vendaId), v = (await ref.get()).data();
    if (!v || v.zapsign?.docToken !== d.token) return res.status(200).json({ ok: true, ignorado: 'venda não confere' });
    const sg = (d.signers || [])[0] || {};
    if (d.status === 'signed') {
      if (v.zapsign.status === 'assinado') return res.status(200).json({ ok: true });
      const z = { ...v.zapsign, status: 'assinado', assinadoEm: Date.parse(sg.signed_at || '') || Date.now(), ip: sg.ip || '', selfie: !!sg.selfie_photo_url, documento: !!sg.document_photo_url };
      const dados = { zapsign: z };
      // venda parada no passo do contrato: segue para a entrada (igual à assinatura na loja)
      if (v.status === 'APROVADA')
        Object.assign(dados, { status: 'AGUARDANDO_ENTRADA', assinadoEm: z.assinadoEm, aceiteBloqueio: true, aceiteLgpd: true, assinaturaPendente: null,
          assinaturaDigital: { via: 'ZAPSIGN', codigo: String(d.token).slice(0, 10).toUpperCase(), hash: d.token, por: 'ZapSign', dispositivo: 'ZapSign · selfie + documento' } });
      await ref.set(dados, { merge: true });
      await db.collection('logs').add({ em: Date.now(), acao: 'Contrato assinado (ZapSign)', alvo: vendaId, det: d.token, por: 'ZapSign' });
    } else if (d.status === 'refused' || sg.status === 'refused' || d.status === 'recusado') {
      await ref.set({ zapsign: { ...v.zapsign, status: 'recusado', em: Date.now() } }, { merge: true });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ erro: e.message });
  }
}
