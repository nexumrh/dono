// Ações do próprio cliente (portal e app da trava), autenticadas pelo token do aparelho.
// POST /api/cliente-app {"acao":"promessa","token":"...","data":"AAAA-MM-DD"}
//      {"acao":"prazo","token":"..."}  → até 48 h a mais para pagar (1 vez por parcela)
//      {"acao":"liberar","token":"...","pedido":"..."} → aparelho bloqueado: a assistente libera 24 h ou manda para o suporte
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


// ---- prazo extra e liberação pelo chat do app (assistente) ----
// prazo: até 48 h a mais para pagar, 1 vez por parcela. liberar: aparelho bloqueado por atraso → a assistente libera 24 h
// (1 vez por parcela) se o histórico permitir; senão vira um pedido para o suporte/dono liberar 24 h ou 48 h.
const erroBot = (m, s = 400) => Object.assign(new Error(m), { status: s });
const addDiasBot = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const etapaTotalBot = (ap) => ap.etapaTotalDias != null ? Math.max(1, Number(ap.etapaTotalDias) || 7) : (Number(ap.toleranciaDias) || 0) + 1;
async function contratoBot(token) {
  const aref = db.collection('aparelhos').doc(String(token)), as = await aref.get();
  if (!as.exists) throw erroBot('Contrato não encontrado', 404);
  const ap = as.data();
  if (ap.quitado || ap.status !== 'ATIVO') throw erroBot('Este contrato não está ativo.');
  if (ap.roubo && !ap.roubo.liberadoEm) throw erroBot('Este aparelho tem comunicação de roubo ou perda. Só a loja pode liberar.', 409);
  if (ap.modo === 'TRAVAR') throw erroBot('O bloqueio deste aparelho foi pedido pela loja. Só a equipe pode liberar.', 409);
  const v = (await db.collection('vendas').doc(ap.vendaId).get()).data();
  if (!v || v.status !== 'ATIVA') throw erroBot('Este contrato não está ativo.');
  return { aref, ap, v };
}
function historicoBot(v, h) {
  const ps = v.parcelas || [], pagas = ps.filter((p) => p.pago);
  const emDia = pagas.filter((p) => !p.pagoEm || String(p.pagoEm).slice(0, 10) <= p.venc).length;
  const atr = ps.filter((p) => !p.pago && p.venc < h).sort((a, b) => (a.venc < b.venc ? -1 : 1));
  const maior = atr.length ? Math.round((Date.parse(h + 'T12:00:00Z') - Date.parse(atr[0].venc + 'T12:00:00Z')) / 86400000) : 0;
  return { pagas: pagas.length, emDia, pctEmDia: pagas.length ? emDia / pagas.length : null, atr, maior };
}
async function registrarBot(ap, v, txt, em) {
  try {
    const cref = db.collection('cobrancas').doc(ap.vendaId), c = (await cref.get()).data() || {};
    await cref.set({ vendaId: ap.vendaId, numero: v.numero, clienteNome: v.clienteNome, lojaId: v.lojaId, atualizadoEm: em,
      contatos: [...(c.contatos || []), { em, canal: 'Assistente do app', resultado: 'Pedido do cliente', obs: txt, por: 'Cliente' }] }, { merge: true });
    await db.collection('logs').add({ em, acao: 'Assistente do app', alvo: ap.vendaId, det: txt, por: 'Cliente' });
  } catch (e) { console.warn('registrarBot', e.message); }
}

// ---- roubo, furto ou perda comunicado pelo chat do app: a assistente bloqueia na hora todos os aparelhos do cliente ----
export async function rouboBot(token, tipo, relato, bo) {
  const aref = db.collection('aparelhos').doc(String(token)), as = await aref.get();
  if (!as.exists) throw erroBot('Contrato não encontrado', 404);
  const ap = as.data(), agora = Date.now();
  const T = ['Roubo', 'Furto', 'Perda'].includes(tipo) ? tipo : 'Roubo';
  const v = ap.vendaId ? (await db.collection('vendas').doc(ap.vendaId).get()).data() : null;
  const cpf = String(v?.clienteCpf || ap.clienteCpf || '').replace(/\D/g, '');
  // todos os contratos ativos do mesmo CPF
  const tokens = new Set([String(token)]);
  if (cpf) {
    const vs = await db.collection('vendas').where('clienteCpf', '==', cpf).get().catch(() => null);
    vs?.forEach((d) => { const x = d.data(); if (x.aparelhoToken && ['ATIVA', 'INSTALANDO'].includes(x.status)) tokens.add(String(x.aparelhoToken)); });
  }
  const bloqueados = [];
  for (const tk of tokens) {
    const r = db.collection('aparelhos').doc(tk), d = (await r.get()).data();
    if (!d || d.quitado) continue;
    if (d.roubo && !d.roubo.liberadoEm) { if (bo) await r.set({ roubo: { ...d.roubo, bo: String(bo).slice(0, 60) } }, { merge: true }); bloqueados.push(tk); continue; }
    await r.set({ roubo: { tipo: T, data: hoje(), relato: String(relato || '').slice(0, 300), bo: String(bo || '').slice(0, 60), em: agora, via: 'APP', localizar: false } }, { merge: true });
    bloqueados.push(tk);
    await pushAparelho(tk).catch(() => {});
  }
  if (v) await registrarBot(ap, v, `Comunicou ${T.toLowerCase()} pelo chat do app. A assistente bloqueou ${bloqueados.length} aparelho(s).${bo ? ' BO: ' + bo : ''}`, agora);
  try { await db.collection('chamados').add({ em: agora, assunto: `${T} comunicado pelo app`, setor: 'Suporte', cliente: v?.clienteNome || '', imei: ap.imei || '', desc: `Cliente comunicou ${T.toLowerCase()} pela assistente do app. Aparelhos bloqueados: ${bloqueados.length}.${relato ? ' Relato: ' + relato : ''}${bo ? ' BO: ' + bo : ''}`, status: 'ABERTO', por: 'Assistente do app', vendaId: ap.vendaId || '' }); } catch (e) {}
  return { ok: true, bloqueados: bloqueados.length, tipo: T };
}

// cliente toca em "Quero meu celular novo" no app: vira um pedido de recompra para o suporte/financeiro
export async function recompraBot(token) {
  const as = await db.collection('aparelhos').doc(String(token)).get();
  if (!as.exists) throw erroBot('Contrato não encontrado', 404);
  const ap = as.data(), pre = ap.preAprovado, agora = Date.now();
  if (!pre || !(pre.valor > 0) || String(pre.ate || '') < hoje()) throw erroBot('Você ainda não tem crédito pré-aprovado. Continue pagando em dia!');
  const v = ap.vendaId ? (await db.collection('vendas').doc(ap.vendaId).get()).data() || {} : {};
  const cpf = String(v.clienteCpf || ap.clienteCpf || '').replace(/\D/g, '');
  await db.collection('recompras').doc(cpf || String(token)).set({ status: 'INTERESSE', via: 'APP', em: agora, cpf, vendaId: ap.vendaId || '', numero: v.numero || 0,
    clienteNome: v.clienteNome || ap.clienteNome || '', tel: (v.cliente?.telefones || [])[0] || '', lojaId: v.lojaId || '', lojaNome: v.lojaNome || ap.lojaNome || '',
    valor: pre.valor, entradaPct: pre.entradaPct ?? null, descontoPct: pre.descontoPct ?? null }, { merge: true });
  if (v.clienteNome) await registrarBot(ap, v, `Pediu um celular novo pelo app (crédito pré-aprovado de R$ ${pre.valor}).`, agora).catch(() => {});
  return { ok: true };
}

export async function prazoBot(token) {
  const cfg = await config();
  if (cfg.prazoBot === 'nao') throw erroBot('O prazo extra pelo app não está disponível. Fale com a loja.');
  const horas = Math.min(72, Math.max(12, Number(cfg.prazoBotHoras) || 48));
  const { aref, ap, v } = await contratoBot(token), h = hoje();
  const p = (v.parcelas || []).filter((x) => !x.pago && x.venc <= addDiasBot(h, 3)).sort((a, b) => (a.venc < b.venc ? -1 : 1))[0];
  if (!p) throw erroBot('Você não tem parcela vencida nem vencendo nos próximos 3 dias. O prazo extra pode ser pedido perto do vencimento.');
  const usados = ap.prazosBot || {};
  if (usados[p.n]) throw erroBot(`Você já usou o prazo extra da parcela ${p.n}. Ele vale 1 vez por parcela.`, 409);
  const bloqueio = Date.parse(addDiasBot(p.venc, etapaTotalBot(ap)) + 'T00:00:00-03:00'), agora = Date.now();
  const ate = Math.max(agora, bloqueio) + horas * 3600000;
  await aref.set({ liberadoAte: Math.max(ate, Number(ap.liberadoAte) || 0), prazosBot: { ...usados, [p.n]: { em: agora, ate } } }, { merge: true });
  await registrarBot(ap, v, `Pediu ${horas} h a mais para pagar a parcela ${p.n} (vence ${p.venc})`, agora);
  await pushAparelho(String(token)).catch(() => {});
  return { ok: true, parcela: p.n, venc: p.venc, liberadoAte: ate, horas };
}
export async function liberarBot(token, pedido) {
  const cfg = await config(), { aref, ap, v } = await contratoBot(token), h = hoje(), agora = Date.now();
  const H = historicoBot(v, h);
  if (!H.atr.length) throw erroBot('Não encontrei parcela em atraso. Se o aparelho continua bloqueado, toque em Verificar na tela de bloqueio.');
  if ((Number(ap.liberadoAte) || 0) > agora) return { ok: true, jaLiberado: true, liberadoAte: ap.liberadoAte };
  const n = H.atr[0].n, usados = ap.liberacoesBot || {}, maxDias = Number(cfg.botLiberarMaxDias) || 15;
  const bomPagador = H.pctEmDia == null ? H.maior <= 7 : H.pctEmDia >= 0.5;
  if (cfg.botLiberar !== 'nao' && !usados[n] && H.maior <= maxDias && bomPagador) {
    const ate = agora + 24 * 3600000;
    await aref.set({ liberadoAte: ate, liberacoesBot: { ...usados, [n]: { em: agora, ate } } }, { merge: true });
    await registrarBot(ap, v, `Liberado 24 h pela assistente (parcela ${n} em atraso há ${H.maior} dia(s))`, agora);
    await pushAparelho(String(token)).catch(() => {});
    return { ok: true, liberadoAte: ate, horas: 24 };
  }
  const sugestao = H.pctEmDia != null && H.pctEmDia >= 0.8 && H.atr.length === 1 ? 48 : 24;
  const motivoBot = usados[n] ? `já usou a liberação automática da parcela ${n}` : H.maior > maxDias ? `atraso de ${H.maior} dias (a assistente libera até ${maxDias})` : 'mais da metade das parcelas pagas com atraso';
  const ref = db.collection('liberacoes').doc('lib_' + String(token).slice(0, 16) + '_' + n), ja = (await ref.get()).data();
  if (ja?.status === 'PENDENTE') return { ok: false, pendente: true, sugestao: ja.sugestaoHoras };
  await ref.set({ token: String(token), vendaId: ap.vendaId, numero: v.numero, clienteNome: v.clienteNome || '', lojaId: v.lojaId || '', lojaNome: v.lojaNome || '',
    parcela: n, diasAtraso: H.maior, parcelasAtraso: H.atr.length, pagas: H.pagas, pagasEmDia: H.emDia, sugestaoHoras: sugestao, motivoBot,
    pedidoCliente: String(pedido || '').slice(0, 300), status: 'PENDENTE', em: agora });
  await registrarBot(ap, v, `Pediu liberação pelo app; a assistente não liberou (${motivoBot}). Pedido enviado ao suporte.`, agora);
  return { ok: false, pendente: true, sugestao };
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const b = req.body || {};
    if (!b.token || String(b.token).length < 16) throw erro('pedido inválido');
    if (b.acao === 'promessa') return res.status(200).json(await promessa(b.token, b.data));
    if (b.acao === 'prazo') return res.status(200).json(await prazoBot(b.token));
    if (b.acao === 'liberar') return res.status(200).json(await liberarBot(b.token, b.pedido));
    if (b.acao === 'recompra') return res.status(200).json(await recompraBot(b.token));
    if (b.acao === 'roubo') return res.status(200).json(await rouboBot(b.token, b.tipo, b.relato, b.bo));
    throw erro('ação desconhecida');
  } catch (e) { return res.status(e.status || 500).json({ erro: e.status ? e.message : 'Não foi possível agora. Tente de novo.' }); }
}
