// POST /api/instalacao {vendaId} — conclui a venda quando o PRÓPRIO aparelho confirmou a trava.
// O portal tenta gravar direto; se as regras do Firestore recusarem (regras antigas, etc.), conclui por aqui.
import { db, cors, exigirEquipe, config } from './_base.js';

const erro = (m, s = 400) => Object.assign(new Error(m), { status: s });

export function travaConfirmada(ck, cfg) {
  if (!ck || !ck.em) return false;
  if (ck.imeiConfere === false) return false;
  if (ck.deviceOwner === true) return true;
  return ck.modo === 'link' && ck.adminAtivo === true && cfg.instalacaoLink !== 'nao';
}

export async function concluirVenda(vendaId, por) {
  const ref = db.collection('vendas').doc(vendaId), snap = await ref.get();
  if (!snap.exists) throw erro('venda não encontrada', 404);
  const v = snap.data();
  if (v.status === 'ATIVA') return { ja: true };
  if (v.status !== 'INSTALANDO') throw erro('a venda não está aguardando a trava');
  if (!v.aparelhoToken) throw erro('venda sem trava gerada');
  const ap = (await db.collection('aparelhos').doc(v.aparelhoToken).get()).data() || {};
  const cfg = await config();
  if (!travaConfirmada(ap.checkin, cfg)) throw erro('o aparelho ainda não confirmou a trava', 409);
  const agora = Date.now();
  await ref.set({ status: 'ATIVA', instaladoEm: agora, instalacao: { ...(v.instalacao || {}), falha: null, concluidaEm: agora, concluidaPor: por } }, { merge: true });
  if (v.aparelho?.estoqueId) await db.collection('estoque').doc(v.aparelho.estoqueId).set({ status: 'VENDIDO', vendaId, vendidoEm: agora }, { merge: true }).catch(() => {});
  await db.collection('logs').add({ em: agora, acao: 'Trava instalada — venda concluída', alvo: vendaId, detalhe: `IMEI ${ap.checkin?.imei || ''} · ${por}`, nome: por });
  return { ok: true };
}

// rotina: vendas presas em INSTALANDO cujo aparelho já confirmou
export async function instalacoesRotina() {
  const vs = (await db.collection('vendas').where('status', '==', 'INSTALANDO').get()).docs;
  let n = 0;
  for (const d of vs) { try { const r = await concluirVenda(d.id, 'rotina automática'); if (r.ok) n++; } catch (e) { /* ainda não confirmou */ } }
  return n;
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    if (req.method !== 'POST') throw erro('use POST', 405);
    const eu = await exigirEquipe(req);
    const id = String(req.body?.vendaId || '');
    const v = (await db.collection('vendas').doc(id).get()).data();
    if (!v) throw erro('venda não encontrada', 404);
    if (eu.role === 'VENDEDOR' && v.vendedorUid !== eu.uid) throw erro('sem permissão', 403);
    if (eu.role === 'GERENTE' && v.lojaId !== eu.lojaId) throw erro('sem permissão', 403);
    res.json(await concluirVenda(id, eu.nome || eu.role));
  } catch (e) { res.status(e.status || 500).json({ erro: e.message }); }
}
