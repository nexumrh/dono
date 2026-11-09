// Repasse automático às lojas: PIX pelo Asaas (transferência) para a chave PIX cadastrada na loja.
// POST /api/repasse {"vendaIds":[...]}  (Dono/Financeiro) → transfere e marca o repasse como PAGO
// A rotina da manhã também repassa sozinha as vendas ativas, se “Repasse automático” estiver ligado.
// Atenção: no Asaas, transferências por API podem exigir autorização (SMS/token ou webhook de validação).
import { db, cors, exigirEquipe, asaas, asaasLigadoSrv, hoje, config } from './_base.js';

const r2 = (x) => Math.round(x * 100) / 100;
const TIPOS = { CPF: 'CPF', CNPJ: 'CNPJ', EMAIL: 'EMAIL', TELEFONE: 'PHONE', ALEATORIA: 'EVP' };
export const valorRepasse = (v) => r2(Math.max(0, (+v.valor || 0) - (+v.entrada || 0)));

export async function repassar(vendaId, por) {
  const ref = db.collection('vendas').doc(vendaId), v = (await ref.get()).data();
  if (!v) throw new Error('venda não encontrada');
  if (v.repasse?.status === 'PAGO' || v.repasse?.status === 'PROCESSANDO') return { ja: true };
  if (!['ATIVA', 'QUITADA'].includes(v.status)) throw new Error(`venda nº ${v.numero} não está ativa`);
  const loja = (await db.collection('lojas').doc(v.lojaId).get()).data() || {};
  if (!loja.pixChave) throw new Error(`a loja ${loja.nome || v.lojaNome} não tem chave PIX cadastrada`);
  const valor = valorRepasse(v); if (!(valor > 0)) throw new Error('valor do repasse zerado');
  await ref.set({ repasse: { status: 'PROCESSANDO', valor, em: Date.now(), por } }, { merge: true });
  try {
    const t = await asaas('/transfers', { method: 'POST', body: JSON.stringify({ value: valor, operationType: 'PIX', pixAddressKey: loja.pixChave, pixAddressKeyType: TIPOS[loja.pixTipo] || 'EVP',
      description: `Repasse venda nº ${v.numero} — ${v.clienteNome || ''}`.slice(0, 120), externalReference: 'repasse:' + vendaId }) });
    await ref.set({ repasse: { status: 'PAGO', valor, pagoEm: hoje(), forma: 'PIX automático (Asaas)', obs: t.id || '', asaasTransferencia: t.id || '', situacaoAsaas: t.status || '', por, em: Date.now(), automatico: true } }, { merge: true });
    await db.collection('logs').add({ em: Date.now(), acao: 'Repasse automático (Asaas)', alvo: vendaId, det: `nº ${v.numero} · R$ ${valor} → ${loja.nome}`, por });
    return { ok: true, valor, transferencia: t.id };
  } catch (e) {
    await ref.set({ repasse: { status: 'PENDENTE', erroAuto: e.message.slice(0, 200), tentouEm: Date.now() } }, { merge: true });
    throw e;
  }
}
export async function repasseRotina(cfg) {
  if (cfg.repasseAuto !== 'sim' || !(await asaasLigadoSrv().catch(() => false))) return { repassados: 0 };
  const max = Math.min(5, Number(process.env.ROTINA_MAX) || 5);
  const vs = (await db.collection('vendas').where('status', '==', 'ATIVA').get()).docs.map((d) => ({ id: d.id, ...d.data() }))
    .filter((v) => !v.repasse || (v.repasse.status === 'PENDENTE' && !v.repasse.erroAuto)).slice(0, max);
  let n = 0; for (const v of vs) { try { await repassar(v.id, 'Rotina automática'); n++; } catch (e) { console.warn('repasse', v.id, e.message); } }
  return { repassados: n };
}
export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const q = await exigirEquipe(req, ['DONO', 'FINANCEIRO']);
    if (!(await asaasLigadoSrv())) throw Object.assign(new Error('Asaas não configurado'), { status: 400 });
    const ids = [...new Set((req.body?.vendaIds || []).map(String))].slice(0, 10), out = [];
    for (const id of ids) { try { out.push({ id, ...(await repassar(id, q.nome || 'Dono')) }); } catch (e) { out.push({ id, erro: e.message }); } }
    return res.status(200).json({ resultados: out });
  } catch (e) { return res.status(e.status || 500).json({ erro: e.message }); }
}
