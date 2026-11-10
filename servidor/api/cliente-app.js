// Ações do próprio cliente (portal e app da trava), autenticadas pelo token do aparelho.
// POST /api/cliente-app {"acao":"promessa","token":"...","data":"AAAA-MM-DD"}
//   → o cliente promete pagar até a data e o aparelho fica liberado até lá (uma vez por contrato).
//     A promessa entra na Fila de cobrança; se não pagar, ela vira "quebrada" e o aparelho volta a travar sozinho.
import { db, cors, hoje, config, encargos, r2, pushAparelho } from './_base.js';

const addDias = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const erro = (m, s = 400) => Object.assign(new Error(m), { status: s });

export async function promessa(token, data) {
  const cfg = await config();
  if (cfg.promessaApp === 'nao') throw erro('A promessa de pagamento pelo celular não está disponível. Fale com a loja.');
  const max = Math.min(10, Math.max(1, Number(cfg.promessaMaxDias) || 5)), h = hoje();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data || '')) || data <= h || data > addDias(h, max)) throw erro(`Escolha uma data entre amanhã e ${max} dia(s) a partir de hoje.`);
  const aref = db.collection('aparelhos').doc(String(token)), as = await aref.get();
  if (!as.exists) throw erro('Contrato não encontrado', 404);
  const ap = as.data();
  if (ap.quitado || ap.status !== 'ATIVO') throw erro('Este contrato não está ativo.');
  if (ap.promessaApp?.em) throw erro('Você já usou a promessa de pagamento neste contrato. Pague pelo PIX ou fale com a loja.', 409);
  if (ap.roubo && !ap.roubo.liberadoEm) throw erro('Aparelho com roubo/perda comunicado. Fale com a loja.');
  const vref = db.collection('vendas').doc(ap.vendaId), v = (await vref.get()).data();
  if (!v || v.status !== 'ATIVA') throw erro('Este contrato não está ativo.');
  const atr = (v.parcelas || []).filter((p) => !p.pago && p.venc < h);
  if (!atr.length) throw erro('Você não tem parcelas em atraso.');
  const valor = r2(atr.reduce((s, p) => s + encargos(p, ap), 0));
  const ate = Date.parse(data + 'T23:59:59-03:00'), em = Date.now();
  await aref.set({ liberadoAte: Math.max(ate, Number(ap.liberadoAte) || 0), promessaApp: { data, valor, em, ate } }, { merge: true });
  const cref = db.collection('cobrancas').doc(ap.vendaId), c = (await cref.get()).data() || {};
  const promessas = (c.promessas || []).map((p) => (p.status === 'ABERTA' ? { ...p, status: 'SUBSTITUIDA', fimEm: em } : p));
  promessas.push({ data, valor, em, por: 'Cliente (pelo celular)', status: 'ABERTA', origem: 'APP' });
  await cref.set({ vendaId: ap.vendaId, numero: v.numero, clienteNome: v.clienteNome, lojaId: v.lojaId, promessas, atualizadoEm: em,
    contatos: [...(c.contatos || []), { em, canal: 'App do cliente', resultado: 'Prometeu pagar', obs: `Prometeu pagar ${valor.toFixed(2)} até ${data} pelo celular`, por: 'Cliente', promessa: data }] }, { merge: true });
  await db.collection('logs').add({ em, acao: 'Promessa de pagamento pelo celular', alvo: ap.vendaId, det: `até ${data} · R$ ${valor}`, por: 'Cliente' });
  await pushAparelho(String(token)).catch(() => {});
  return { ok: true, data, valor, liberadoAte: ate };
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const b = req.body || {};
    if (!b.token || String(b.token).length < 16) throw erro('pedido inválido');
    if (b.acao === 'promessa') return res.status(200).json(await promessa(b.token, b.data));
    throw erro('ação desconhecida');
  } catch (e) { return res.status(e.status || 500).json({ erro: e.status ? e.message : 'Não foi possível agora. Tente de novo.' }); }
}
