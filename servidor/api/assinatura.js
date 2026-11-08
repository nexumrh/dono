// Assinatura do contrato com prova jurídica.
// 1) Carimbo do servidor (grátis, sempre ligado): quando o cliente assina pelo link, o portal do cliente chama
//    POST /api/assinatura {"acao":"carimbo","tk":".."} e o servidor grava IP, país, navegador, data e hora do servidor
//    e o hash SHA-256 do contrato assinado. Isso prova quando e de onde foi assinado (MP 2.200-2/2001, art. 10, §2º;
//    Lei 14.063/2020: assinatura eletrônica avançada quando há como identificar o signatário e detectar alteração).
// 2) ZapSign (opcional, pago por documento): POST {"acao":"zapsign","vendaId":".."} (equipe) cria o documento na ZapSign
//    com selfie + foto do documento do cliente e devolve o link de assinatura. A ZapSign guarda o PDF assinado com
//    trilha de auditoria e valida a assinatura. Variáveis: ZAPSIGN_TOKEN, ZAPSIGN_URL (sandbox ou produção).
//    POST {"acao":"zapsignArquivo","vendaId":".."} devolve o link (temporário, 60 min) do PDF assinado.
import { db, cors, exigirEquipe } from './_base.js';

const ZURL = () => (process.env.ZAPSIGN_URL || 'https://sandbox.api.zapsign.com.br/api/v1').replace(/\/$/, '');
export async function zapsign(caminho, opts = {}) {
  if (!process.env.ZAPSIGN_TOKEN) throw new Error('ZapSign não configurada (falta ZAPSIGN_TOKEN no servidor)');
  const r = await fetch(ZURL() + caminho, { ...opts, headers: { Authorization: 'Bearer ' + process.env.ZAPSIGN_TOKEN, 'Content-Type': 'application/json' } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('ZapSign ' + r.status + ': ' + (j.detail || j.message || JSON.stringify(j)));
  return j;
}
export async function sha256(txt) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
// contrato em HTML → markdown simples (a ZapSign monta o PDF a partir do markdown)
export function htmlParaMarkdown(html) {
  return String(html || '')
    .replace(/<h[1-3][^>]*>(.*?)<\/h[1-3]>/gis, '\n## $1\n').replace(/<h4[^>]*>(.*?)<\/h4>/gis, '\n### $1\n')
    .replace(/<(b|strong)>(.*?)<\/\1>/gis, '**$2**').replace(/<li[^>]*>/gi, '\n- ').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}
const ipDo = (req) => String(req.headers['cf-connecting-ip'] || req.headers['x-real-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0] || '').trim();

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const b = req.body || {};
    if (b.acao === 'carimbo') {
      const ref = db.collection('assinaturas').doc(String(b.tk || '')), s = await ref.get();
      if (!s.exists) return res.status(404).json({ erro: 'link não encontrado' });
      const a = s.data();
      if (a.status !== 'ASSINADO') return res.status(400).json({ erro: 'ainda não assinado' });
      if (a.carimbo) return res.status(200).json(a.carimbo);
      if (Date.now() - (a.assinadoEm || 0) > 15 * 60e3) return res.status(400).json({ erro: 'assinatura antiga: carimbo só na hora da assinatura' });
      const hashConteudo = await sha256([a.contrato, a.assinatura, a.assinadoEm, a.vendaId].join('|'));
      const carimbo = { servidorEm: Date.now(), servidorData: new Date().toISOString(), ip: ipDo(req), pais: String(req.headers['cf-ipcountry'] || ''),
        navegador: String(req.headers['user-agent'] || '').slice(0, 250), hashConteudo, codigo: hashConteudo.slice(0, 10).toUpperCase() };
      await ref.set({ carimbo }, { merge: true });
      if (a.vendaId) await db.collection('vendas').doc(a.vendaId).set({ carimboAssinatura: carimbo }, { merge: true });
      return res.status(200).json(carimbo);
    }
    if (b.acao === 'zapsign') {
      const quem = await exigirEquipe(req);
      const vref = db.collection('vendas').doc(String(b.vendaId)), v = (await vref.get()).data();
      if (!v) throw Object.assign(new Error('venda não encontrada'), { status: 404 });
      if (v.zapsign?.status === 'pendente' && v.zapsign.signUrl) return res.status(200).json(v.zapsign);
      const tel = String((v.cliente?.telefones || [])[0] || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
      const doc = await zapsign('/docs/', { method: 'POST', body: JSON.stringify({
        name: `Contrato ${v.numero} — ${v.clienteNome}`.slice(0, 255), markdown_text: htmlParaMarkdown(b.contratoHtml || v.contratoTexto || ''),
        lang: 'pt-br', external_id: String(b.vendaId), disable_signer_emails: true, brand_primary_color: '#0E1A3A',
        signers: [{ name: v.clienteNome, email: v.cliente?.email || '', phone_country: '55', phone_number: tel, auth_mode: 'assinaturaTela',
          require_selfie_photo: true, require_document_photo: true, lock_name: true, external_id: String(v.clienteCpf || ''), send_automatic_email: false, send_automatic_whatsapp: false }],
      }) });
      const sg = (doc.signers || [])[0] || {};
      const z = { docToken: doc.token, signerToken: sg.token || '', signUrl: sg.sign_url || '', status: 'pendente', criadoEm: Date.now(), por: quem.nome };
      await vref.set({ zapsign: z, contratoTexto: b.contratoHtml || v.contratoTexto || '' }, { merge: true });
      await db.collection('logs').add({ em: Date.now(), acao: 'Contrato enviado para assinatura ZapSign', alvo: b.vendaId, det: doc.token, por: quem.nome });
      return res.status(200).json(z);
    }
    if (b.acao === 'zapsignArquivo') {
      await exigirEquipe(req);
      const v = (await db.collection('vendas').doc(String(b.vendaId)).get()).data();
      if (!v?.zapsign?.docToken) throw new Error('este contrato não foi assinado pela ZapSign');
      const d = await zapsign('/docs/' + v.zapsign.docToken + '/');
      return res.status(200).json({ status: d.status, arquivo: d.signed_file || d.original_file || '' });
    }
    return res.status(400).json({ erro: 'ação desconhecida' });
  } catch (e) {
    console.error(e);
    return res.status(e.status || 500).json({ erro: e.message });
  }
}
