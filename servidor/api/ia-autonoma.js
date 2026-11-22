// IA autônoma da NexumCell: trabalha sozinha, sem depender do dono, a cada 15 minutos (cron "*/15 * * * *").
//   1) Aprovações: decide pedidos de liberação 24 h, liberação definitiva e baixa com desconto por regras rígidas;
//      o que for duvidoso fica para o dono, com o parecer da IA.
//   2) Pré-análises online: responde em até 15 minutos; dúvida fica para o dono aprovar ou recusar.
//   3) Lista negra: inclui sozinha quem deu golpe (aparelho retomado com dívida, sumiu com o aparelho, dados de outra pessoa).
//   4) Atendimento: manda a mensagem automática quando a assistente passa o cliente para a equipe (CRM).
// A IA (Groq) escreve o parecer em português; as decisões seguem as regras abaixo, nunca só a IA.
// Chave: segredos/ia.chave (Painel do Dono → Configurações → IA autônoma) ou GROQ_API_KEY_2 / GROQ_API_KEY.
import { db, config, hoje, r2, baixarParcela, pushAparelho } from './_base.js';
import { decidir as decidirPre } from './preanalise.js';

const MODELO = process.env.GROQ_MODELO_AUTONOMA || 'llama-3.3-70b-versatile';
const dias = (a, b) => Math.round((new Date(String(b).slice(0, 10) + 'T12:00:00') - new Date(String(a).slice(0, 10) + 'T12:00:00')) / 86400e3);
const POR = 'IA NexumCell';

let _chave = null;
async function chaveIA() {
  if (_chave && _chave.em > Date.now() - 300e3) return _chave.v;
  let v = process.env.GROQ_API_KEY_2 || '';
  if (!v) { try { v = (await db.collection('segredos').doc('ia').get()).data()?.chave || ''; } catch (e) { v = ''; } }
  if (!v) v = process.env.GROQ_API_KEY || (await config()).iaChave || '';
  _chave = { em: Date.now(), v }; return v;
}

// parecer curto da IA (nunca é ela sozinha que decide: a regra decide, ela explica e sinaliza risco)
export async function parecerIA(tarefa, dados) {
  const chave = await chaveIA(); if (!chave) return null;
  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST', headers: { Authorization: 'Bearer ' + chave, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODELO, temperature: 0.1, max_tokens: 300, response_format: { type: 'json_object' }, messages: [
        { role: 'system', content: 'Você é o analista de risco da NexumCell, financeira de celulares com trava para clientes negativados. Responda SOMENTE em JSON {"parecer":"até 2 frases em português do Brasil, objetivas","risco":"baixo|medio|alto"}. Use só os dados recebidos; não invente.' },
        { role: 'user', content: tarefa + '\nDADOS: ' + JSON.stringify(dados).slice(0, 6000) }] }) });
    if (!r.ok) return null;
    const j = await r.json(); return JSON.parse(j.choices?.[0]?.message?.content || '{}');
  } catch (e) { return null; }
}

// histórico de pagamento de um contrato
function historico(v) {
  const ps = v.parcelas || [], pagas = ps.filter((p) => p.pago), h = hoje();
  const emDia = pagas.filter((p) => !p.pagoEm || dias(p.venc, p.pagoEm) <= 3).length;
  const atr = ps.filter((p) => !p.pago && p.venc < h), diasAtr = atr.length ? dias(atr.sort((a, b) => a.venc.localeCompare(b.venc))[0].venc, h) : 0;
  return { total: ps.length, pagas: pagas.length, emDiaPct: pagas.length ? Math.round(emDia / pagas.length * 100) : 0, diasAtraso: diasAtr, parcelasAtraso: atr.length, acordos: (v.acordos || []).length };
}

/* ---------- 1) aprovações ---------- */
async function regraAprovacao(x) {
  const d = x.dados || {};
  if (x.tipo === 'LIB24H') {
    const ap = (await db.collection('aparelhos').doc(String(x.alvo)).get()).data(); if (!ap) return ['DUVIDA', 'aparelho não encontrado'];
    const v = ap.vendaId ? (await db.collection('vendas').doc(ap.vendaId).get()).data() : null; if (!v) return ['DUVIDA', 'contrato não encontrado'];
    const h = historico(v), ult = Number(ap.ultimaLib24h) || 0;
    if (ap.roubo && !ap.roubo.liberadoEm) return ['RECUSADA', 'aparelho com roubo/perda comunicado'];
    if (Date.now() - ult < 30 * 86400e3) return ['RECUSADA', 'já teve uma liberação de 24 h nos últimos 30 dias'];
    if (h.diasAtraso > 20) return ['RECUSADA', `atraso de ${h.diasAtraso} dias: acima do limite para liberar`];
    if (h.pagas >= 1 && h.emDiaPct >= 60 && h.diasAtraso <= 10) return ['APROVADA', `bom pagador (${h.emDiaPct}% em dia), atraso de ${h.diasAtraso} dia(s)`, { v, h }];
    return ['DUVIDA', `histórico curto ou irregular (${h.pagas} paga(s), ${h.emDiaPct}% em dia)`, { v, h }];
  }
  if (x.tipo === 'LIBERAR_APARELHO') {
    const ap = (await db.collection('aparelhos').doc(String(x.alvo)).get()).data(); if (!ap) return ['DUVIDA', 'aparelho não encontrado'];
    const v = ap.vendaId ? (await db.collection('vendas').doc(ap.vendaId).get()).data() : null;
    if (v && ['QUITADA', 'CANCELADA'].includes(v.status)) return ['APROVADA', `contrato ${v.status === 'QUITADA' ? 'quitado' : 'cancelado'}: pode liberar`];
    if (v && (v.parcelas || []).every((p) => p.pago)) return ['APROVADA', 'todas as parcelas pagas'];
    return ['DUVIDA', 'liberação definitiva com parcelas em aberto: decisão do dono', { v: v ? { numero: v.numero, status: v.status } : null }];
  }
  if (x.tipo === 'DESCONTO_BAIXA') {
    const v = (await db.collection('vendas').doc(String(x.alvo)).get()).data(); if (!v) return ['DUVIDA', 'contrato não encontrado'];
    const p = (v.parcelas || [])[Number(d.i)]; if (!p) return ['DUVIDA', 'parcela não encontrada']; if (p.pago) return ['RECUSADA', 'a parcela já está paga'];
    const desc = p.valor > 0 ? Math.round((1 - Number(d.valor || 0) / p.valor) * 100) : 100, h = historico(v);
    if (desc <= 10 && h.diasAtraso <= 30) return ['APROVADA', `desconto de ${desc}% dentro do limite de 10%`, { desc, h }];
    if (desc > 25) return ['RECUSADA', `desconto de ${desc}% acima do máximo de 25%`, { desc, h }];
    return ['DUVIDA', `desconto de ${desc}%: entre 10% e 25%, decisão do dono`, { desc, h }];
  }
  return ['DUVIDA', 'tipo de pedido sem regra automática'];
}
async function executarAprovacao(x) {
  const d = x.dados || {}, quem = `${x.solicitanteNome || ''} (aprovado pela ${POR})`;
  if (x.tipo === 'LIBERAR_APARELHO') { await db.collection('aparelhos').doc(String(x.alvo)).set({ modo: 'LIBERAR', modoPor: quem, modoEm: Date.now(), modoMotivo: d.motivo || '' }, { merge: true }); await pushAparelho(String(x.alvo)).catch(() => {}); }
  if (x.tipo === 'LIB24H') { await db.collection('aparelhos').doc(String(x.alvo)).set({ modo: 'AUTO', liberadoAte: Date.now() + 86400e3, ultimaLib24h: Date.now(), modoPor: quem, modoMotivo: d.motivo || '' }, { merge: true }); await pushAparelho(String(x.alvo)).catch(() => {}); }
  if (x.tipo === 'DESCONTO_BAIXA') { const v = (await db.collection('vendas').doc(String(x.alvo)).get()).data() || {}, p = (v.parcelas || [])[Number(d.i)] || {};
    await baixarParcela(String(x.alvo), p.n ?? Number(d.i) + 1, Number(d.valor), d.forma || 'Desconto aprovado', `${d.obs ? d.obs + ' · ' : ''}desconto aprovado pela ${POR}`, x.solicitanteNome || POR); }
}
export async function aprovacoesIA(max = 15) {
  const cfg = await config(); if (cfg.iaAutonoma === 'nao') return { aprovacoes: 0 };
  const pend = (await db.collection('aprovacoes').where('status', '==', 'PENDENTE').get()).docs.filter((s) => !s.data().iaAnalisadaEm).slice(0, max);
  let n = 0;
  for (const s of pend) {
    const x = { id: s.id, ...s.data() };
    try {
      const [dec, motivo, extra] = await regraAprovacao(x);
      const ia = await parecerIA(`Pedido "${x.tipo}" feito por ${x.solicitanteNome}: ${x.resumo}. Regra aplicada: ${dec} — ${motivo}. Explique a decisão e o risco.`, { pedido: x.dados, extra });
      const base = { iaAnalisadaEm: Date.now(), iaDecisao: dec, iaMotivo: motivo, iaParecer: ia?.parecer || motivo, iaRisco: ia?.risco || '' };
      if (dec === 'DUVIDA') { await s.ref.set({ ...base, aguardandoDono: true }, { merge: true }); continue; }
      if (dec === 'APROVADA') await executarAprovacao(x);
      await s.ref.set({ ...base, status: dec, decididoPor: POR, decididoEm: Date.now() }, { merge: true });
      await db.collection('logs').add({ em: Date.now(), acao: dec === 'APROVADA' ? 'Aprovação concedida pela IA' : 'Aprovação recusada pela IA', alvo: x.alvo || '', detalhe: `${x.resumo} · ${motivo}`, nome: POR });
      n++;
    } catch (e) { await s.ref.set({ iaAnalisadaEm: Date.now(), iaDecisao: 'DUVIDA', iaMotivo: 'erro: ' + e.message, aguardandoDono: true }, { merge: true }); }
  }
  return { aprovacoes: n };
}

/* ---------- 2) pré-análises online: resposta em até 15 minutos ---------- */
export async function preanalisesIA(max = 20) {
  const cfg = await config(); if (cfg.iaAutonoma === 'nao') return { preanalises: 0 };
  const vit = (await db.collection('publico').doc('vitrine').get()).data() || {};
  const l = (await db.collection('preanalises').where('status', 'in', ['NOVA', 'CONTATADO']).get()).docs
    .filter((s) => { const p = s.data(); return !p.iaAnalisadaEm && !p.respondidoPorHumano && (p.status === 'NOVA' || p.respondidoPor === 'Análise automática'); }).slice(0, max);
  let n = 0;
  for (const s of l) {
    const p = s.data();
    try {
      const d = await decidirPre(p, vit, cfg);
      const ia = await parecerIA(`Pré-análise online de ${p.nome} (${p.cidade || ''}), renda ${p.renda}, profissão ${p.profissao || '—'}, quer ${p.aparelho || '—'} com entrada ${p.entrada || 0}. Resultado das regras: ${d.status}. Dê o parecer.`, { regras: d.auto, status: d.status });
      if (d.status === 'CONTATADO') {   // dúvida: o dono aprova ou recusa
        await s.ref.set({ status: 'CONTATADO', resposta: d.resposta, respondidoEm: Date.now(), respondidoPor: POR, auto: d.auto || null, iaAnalisadaEm: Date.now(), aguardandoDono: true, iaParecer: ia?.parecer || `Ficou para o dono: ${d.auto?.motivo || 'caso fora das regras'}.`, iaRisco: ia?.risco || '' }, { merge: true });
      } else {
        await s.ref.set({ status: d.status, resposta: d.resposta, respondidoEm: Date.now(), respondidoPor: POR, auto: d.auto || null, iaAnalisadaEm: Date.now(), aguardandoDono: false, iaParecer: ia?.parecer || '', iaRisco: ia?.risco || '' }, { merge: true });
        n++;
      }
    } catch (e) { console.warn('preanalise IA', s.id, e.message); }
  }
  return { preanalises: n };
}

/* ---------- 3) lista negra automática ---------- */
async function incluirLN(v, motivo, tipoOrigem) {
  const cpf = String(v.clienteCpf || '').replace(/\D/g, ''); if (!cpf) return false;
  const ref = db.collection('listanegra').doc('cpf_' + cpf); if ((await ref.get()).exists) return false;
  const base = { nome: v.clienteNome || '', cpf, motivo, vendaId: v.id, vendaNumero: v.numero || 0, em: Date.now(), por: POR, ativo: true, origem: 'IA', regra: tipoOrigem };
  await ref.set({ ...base, tipo: 'CPF', valor: cpf });
  for (const t of (v.cliente?.telefones || []).filter(Boolean)) await db.collection('listanegra').doc('tel_' + String(t).replace(/\D/g, '')).set({ ...base, tipo: 'TELEFONE', valor: String(t).replace(/\D/g, '') }, { merge: true });
  await db.collection('logs').add({ em: Date.now(), acao: 'Lista negra: incluído pela IA', alvo: v.id, detalhe: `${v.clienteNome} · ${motivo}`, nome: POR });
  return true;
}
export async function listaNegraIA() {
  const cfg = await config(); if (cfg.iaAutonoma === 'nao' || cfg.listaNegraAuto === 'nao') return { listaNegra: 0 };
  const vs = (await db.collection('vendas').where('status', 'in', ['ATIVA', 'RETOMADA']).get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  let n = 0; const h = hoje();
  for (const v of vs) {
    const hi = historico(v);
    // retomado com dívida
    if (v.status === 'RETOMADA' && (v.parcelas || []).some((p) => !p.pago)) { if (await incluirLN(v, 'Aparelho retomado com parcelas em aberto', 'retomada')) n++; continue; }
    // sumiu com o aparelho: 90+ dias de atraso e o aparelho sem dar sinal há 30+ dias
    if (v.status === 'ATIVA' && hi.diasAtraso >= 90 && v.aparelhoToken) {
      const ap = (await db.collection('aparelhos').doc(v.aparelhoToken).get()).data() || {};
      const sinal = Number(ap.checkin?.em) || 0;
      if (!sinal || Date.now() - sinal > 30 * 86400e3) { if (await incluirLN(v, `${hi.diasAtraso} dias de atraso e o aparelho sem sinal há mais de 30 dias`, 'sumiu')) n++; continue; }
    }
    // nunca pagou nenhuma parcela e já passou 60 dias da primeira
    if (v.status === 'ATIVA' && hi.pagas === 0 && hi.diasAtraso >= 60) { if (await incluirLN(v, 'Não pagou nenhuma parcela (60+ dias de atraso)', 'nunca pagou')) n++; continue; }
    // telefone de outro CPF (mesmo número em clientes diferentes) apontado pelo motor
    if ((v.alertasFraude || []).some((a) => /outro CPF/.test(a.motivo || '')) && hi.diasAtraso >= 15) { if (await incluirLN(v, 'Telefone usado por outro CPF e parcela em atraso', 'fraude')) n++; }
  }
  return { listaNegra: n, h };
}

/* ---------- 4) atendimento: aviso automático quando a assistente passa para a equipe ---------- */
const MSG_ACK = (nome, prot) => `Olá${nome ? ', ' + String(nome).split(' ')[0] : ''}! Recebemos o seu atendimento${prot ? ' (protocolo ' + prot + ')' : ''}. Um especialista da NexumCell já foi avisado e responde por aqui em instantes. Enquanto isso, se puder, descreva com detalhes o que aconteceu.`;
export async function atendimentoIA() {
  let n = 0;
  const ats = (await db.collection('atendimentos').where('status', '==', 'HUMANO').get()).docs.filter((s) => !s.data().autoAckEm);
  for (const s of ats) { const a = s.data(), msgs = [...(a.msgs || [])];
    if (msgs.some((m) => m.de === 'atendente')) { await s.ref.set({ autoAckEm: Date.now() }, { merge: true }); continue; }
    msgs.push({ de: 'atendente', t: MSG_ACK(a.nome || a.abertoPorNome, a.protocolo), em: Date.now(), por: 'Suporte NexumCell', auto: true });
    await s.ref.set({ msgs, autoAckEm: Date.now(), naoLidoUser: true, atualizadoEm: Date.now() }, { merge: true }); n++; }
  const sa = (await db.collection('suporteApp').where('naoLidoSuporte', '==', true).get()).docs.filter((s) => !s.data().autoAckEm);
  for (const s of sa) { const c = s.data();
    await s.ref.collection('msgs').add({ de: 'suporte', texto: MSG_ACK(c.clienteNome, ''), em: Date.now(), porNome: 'Suporte', auto: true });
    await s.ref.set({ autoAckEm: Date.now(), naoLidoCliente: true, atualizadoEm: Date.now() }, { merge: true }); n++; }
  return { atendimento: n };
}

export async function iaAutonomaRotina() {
  const r = {};
  for (const [k, f] of [['aprovacoes', aprovacoesIA], ['preanalises', preanalisesIA], ['listaNegra', listaNegraIA], ['atendimento', atendimentoIA]]) {
    try { Object.assign(r, await f()); } catch (e) { console.error('ia', k, e.message); r[k + 'Erro'] = e.message; }
  }
  return r;
}

// POST /api/ia {acao:'rodar'} — o dono roda a IA agora (sem esperar os 15 minutos)
import { cors, exigirEquipe } from './_base.js';
export default async function handler(req, res) {
  if (cors(req, res)) return;
  try { await exigirEquipe(req, ['DONO', 'FINANCEIRO', 'SUPORTE']); res.json({ ok: true, ...(await iaAutonomaRotina()) }); }
  catch (e) { res.status(e.status || 500).json({ erro: e.message }); }
}
