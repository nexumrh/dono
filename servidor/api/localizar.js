// Localizar o aparelho para recuperação (dono e financeiro). POST /api/localizar
//   {acao:'pedir', vendaId, motivo:'atraso'|'roubo', obs}  → cria o pedido e acorda o app da trava
//   {acao:'resultado', id}                                  → confere se o aparelho já respondeu e grava a posição no registro
// Regras: só com a autorização de localização assinada no contrato (aceiteLocalizacao), contrato em aberto,
// atraso acima do prazo das configurações (ou roubo comunicado), no máximo 3 pedidos por contrato em 24 h.
// O app lê a posição UMA vez por pedido (não acompanha o cliente). Tudo fica registrado em localizacoes/{id}.
import { db, cors, exigirEquipe, pushAparelho, config, hoje } from './_base.js';

const dias = (a, b) => Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 864e5);
const atrasoDe = (v, h = hoje()) => Math.max(0, ...(v.parcelas || []).filter((p) => !p.pago && p.venc && p.venc < h).map((p) => dias(p.venc, h)));
const erro = (m, s = 400) => Object.assign(new Error(m), { status: s });

async function pedir(b, eu) {
  const vendaId = String(b.vendaId || ''), motivo = b.motivo === 'roubo' ? 'roubo' : 'atraso', obs = String(b.obs || '').trim().slice(0, 300);
  if (!vendaId) throw erro('Informe o contrato');
  const vs = await db.collection('vendas').doc(vendaId).get(); if (!vs.exists) throw erro('Contrato não encontrado', 404);
  const v = vs.data(), tk = v.aparelhoToken;
  if (v.status !== 'ATIVA') throw erro('Só é possível localizar aparelho de contrato em aberto');
  if (!tk) throw erro('Este contrato não tem trava instalada');
  if (v.aceiteLocalizacao !== true) throw erro('Este contrato não tem a autorização de localização assinada pelo cliente (contratos assinados antes da cláusula). Não é possível localizar.');
  const as = await db.collection('aparelhos').doc(tk).get(), ap = as.exists ? as.data() : {};
  const cfg = await config(), min = +cfg.localizarDias || 30, at = atrasoDe(v);
  if (motivo === 'atraso' && at < min) throw erro(`O atraso é de ${at} dia(s). Só pode localizar com ${min} dias ou mais de atraso.`);
  if (motivo === 'roubo' && !(ap.roubo && !ap.roubo.liberadoEm)) throw erro('Não há roubo, furto ou perda comunicado neste contrato');
  if (obs.length < 5) throw erro('Escreva o motivo do pedido (para o registro)');
  const recentes = await db.collection('localizacoes').where('vendaId', '==', vendaId).get();
  if (recentes.docs.filter((d) => (d.data().em || 0) > Date.now() - 864e5).length >= 3) throw erro('Limite de 3 pedidos por contrato em 24 horas');
  const ref = db.collection('localizacoes').doc(), em = Date.now();
  await ref.set({ vendaId, token: tk, numero: v.numero || null, clienteNome: v.clienteNome || '', lojaNome: v.lojaNome || '', motivo, obs, atrasoDias: at,
    por: eu.nome, porUid: eu.uid, role: eu.role, em, status: 'AGUARDANDO' });
  await db.collection('aparelhos').doc(tk).set({ localizarPedido: { id: ref.id, em, motivo } }, { merge: true });
  const push = await pushAparelho(tk).catch(() => false);
  await db.collection('logs').add({ em, uid: eu.uid, nome: eu.nome, role: eu.role, acao: 'Pedido de localização do aparelho', alvo: vendaId, detalhe: `${motivo === 'roubo' ? 'Roubo' : 'Atraso de ' + at + ' dias'}: ${obs}` });
  return { ok: true, id: ref.id, push };
}

async function resultado(b, eu) {
  const ref = db.collection('localizacoes').doc(String(b.id || '')), s = await ref.get(); if (!s.exists) throw erro('Pedido não encontrado', 404);
  const p = s.data(); if (p.status === 'OK') return { status: 'OK', local: p.local, recebidoEm: p.recebidoEm };
  const ap = (await db.collection('aparelhos').doc(p.token).get()).data() || {}, c = ap.checkin || {};
  if (c.localPedido === s.id && c.local?.lat != null) {
    const local = { lat: +c.local.lat, lng: +c.local.lng, precisao: Math.round(+c.local.precisao || 0), em: +c.local.em || +c.em || Date.now() };
    await ref.set({ status: 'OK', local, recebidoEm: Date.now(), bateria: c.bateria ?? null }, { merge: true });
    return { status: 'OK', local, recebidoEm: Date.now() };
  }
  if (c.localPedido === s.id) { await ref.set({ status: 'SEM_SINAL', recebidoEm: Date.now() }, { merge: true }); return { status: 'SEM_SINAL' }; }
  if (Date.now() - p.em > 24 * 3600e3) { await ref.set({ status: 'EXPIRADO' }, { merge: true }); return { status: 'EXPIRADO' }; }
  return { status: 'AGUARDANDO', ultimoContato: c.em || null };
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const eu = await exigirEquipe(req, ['DONO', 'FINANCEIRO']), b = req.body || {};
    if (b.acao === 'pedir') return res.json(await pedir(b, eu));
    if (b.acao === 'resultado') return res.json(await resultado(b, eu));
    return res.status(400).json({ erro: 'ação inválida' });
  } catch (e) { return res.status(e.status || 500).json({ erro: e.message }); }
}
