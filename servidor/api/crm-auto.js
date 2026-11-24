// Resposta automática da IA no CRM: quando ninguém da equipe responde o cliente no app ou no WhatsApp
// (programa do WhatsApp ligado) em X minutos — ou fora do horário — a IA responde com base na ficha,
// nas orientações do dono e nas respostas rápidas aprovadas. Pedido de humano, reclamação, acordo,
// desconto ou liberação: a IA avisa que um atendente continua e deixa a conversa marcada para a equipe.
// Liga em CRM → Configurações → Resposta automática da IA. Roda na rotina de 15 minutos.
import { alertaRisco, RX_RISCO } from './crm-mais.js';
import { db, hoje, pushNotificacao } from './_base.js';
import { groq, REGRAS, baseConhecimento, PEDIDO_AUTO } from './crm-ia.js';

const MAX_SEGUIDAS = 3;   // no máximo 3 respostas da IA seguidas sem uma pessoa da equipe entrar
const brl = (n) => 'R$ ' + (Number(n) || 0).toFixed(2).replace('.', ',');
const fmtD = (d) => String(d || '').slice(0, 10).split('-').reverse().join('/');

export function dentroDoHorario(cfg, agora = Date.now()) {
  const d = new Date(agora - 3 * 3600e3), dia = d.getUTCDay(), m = d.getUTCHours() * 60 + d.getUTCMinutes();
  const hm = (s, p) => { const [h, mi] = String(s || p).split(':').map(Number); return h * 60 + (mi || 0); };
  if (dia === 0 && !cfg.iaDomingo) return false;
  const ini = hm(cfg.iaHoraIni, '08:00'), fim = hm(dia === 6 ? (cfg.iaHoraFimSab || '13:00') : cfg.iaHoraFim, '19:00');
  return m >= ini && m < fim;
}

async function fichaDe({ cpf, token, numero }) {
  let vs = [];
  try {
    if (cpf) vs = (await db.collection('vendas').where('clienteCpf', '==', cpf).get()).docs.map((d) => d.data());
    else if (token) vs = (await db.collection('vendas').where('aparelhoToken', '==', token).get()).docs.map((d) => d.data());
    else if (numero) vs = (await db.collection('vendas').where('numero', '==', Number(numero)).get()).docs.map((d) => d.data());
  } catch (e) { }
  if (!vs.length) return 'Cliente sem contrato encontrado.';
  const h = hoje();
  return vs.filter((v) => !['REPROVADA', 'CANCELADA'].includes(v.status)).slice(0, 3).map((v) => {
    const ab = (v.parcelas || []).filter((p) => !p.pago).sort((a, b) => a.venc.localeCompare(b.venc)), atr = ab.filter((p) => p.venc < h);
    return `Contrato nº ${v.numero} (${v.status}) · ${[v.aparelho?.marca, v.aparelho?.modelo].filter(Boolean).join(' ')} · loja ${v.lojaNome || ''}. ` +
      `${ab.length} parcela(s) em aberto${ab[0] ? `, a próxima é a ${ab[0].n}ª de ${brl(ab[0].valor)} com vencimento em ${fmtD(ab[0].venc)}` : ''}. ` +
      (atr.length ? `${atr.length} em atraso, total ${brl(atr.reduce((s, p) => s + (+p.valor || 0), 0))} (desde ${fmtD(atr[0].venc)}).` : 'Sem atraso.');
  }).join('\n');
}

// No WhatsApp (programa 1.1 ou mais novo) a IA também manda sozinha: link de pagamento, contrato em PDF,
// guia com imagens, renegociação (atraso, quitação e pedido de acordo) e a liberação de 20 minutos.
const ACOES_WA = ['pagar', 'contrato', 'guia', 'acordo', 'liberar', 'vencimento', 'roubo', 'pedidos', 'comprar'];
const PEDIDO_WA = 'IMPORTANTE (WhatsApp): você pode ENVIAR AUTOMATICAMENTE ao cliente, colocando no campo "acoes" do JSON: "pagar" (valor de hoje e link do PIX de cada contrato; use para boleto, PIX, 2ª via, fatura, quanto devo), "contrato" (link do contrato em PDF), "guia" (imagens passo a passo de como pagar e usar o app), "acordo" (renegociação: valor do atraso, quitação com desconto e o pedido de acordo em parcelas, que o próprio cliente faz respondendo o número de vezes), "liberar" (celular travado: libera 20 minutos para pagar, até 2 vezes por parcela), "vencimento" (pedido para mudar o dia do vencimento), "roubo" (comunicar roubo, furto ou perda e travar o aparelho, com confirmação do cliente), "pedidos" (andamento dos pedidos e declaração de quitação), "comprar" (crédito pré-aprovado, lojas da cidade e link de indicação). Para esses pedidos NÃO marque humano: responda em 1 ou 2 frases que está enviando e coloque a ação em "acoes". Desconto além da quitação, cancelamento, troca, reclamação ou pedido de pessoa continuam humano=true. Responda em JSON: {"resposta":"...","humano":true|false,"acoes":[]}.';
const intencaoWa = (t) => { const s = String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (/(como (eu )?pag|como (usa|uso|funciona) o app|passo a passo|tutorial|nao sei pagar)/.test(s)) return 'guia';
  if (/(renegoci|acordo|negociar|quitar|quitacao)/.test(s)) return 'acordo';
  if (/(bloquead|travad|desbloque)/.test(s)) return 'liberar';
  if (/(roubad|furtad|perdi o cel|assaltad|robad)/.test(s)) return 'roubo';
  if (/(mudar|trocar|alterar).{0,20}(dia|data).{0,15}venc/.test(s)) return 'vencimento';
  if (/(declaracao de quitacao|meu pedido|meus pedidos)/.test(s)) return 'pedidos';
  if (/(celular novo|trocar de celular|pre.?aprovad|indicar|indicacao)/.test(s)) return 'comprar';
  if (/contrato/.test(s)) return 'contrato';
  if (/(boleto|pix|link (de|pra|para) pag|pagar (a |minha )?parcela|segunda via|2 ?a via|fatura|quanto (eu )?devo)/.test(s)) return 'pagar';
  return ''; };

async function responder(base, canal, cliente, ficha, conversa, extra = '') {
  const t = await groq([{ role: 'system', content: REGRAS + '\n\n' + base.texto }, { role: 'user', content: `Canal: ${canal}\nCliente: ${cliente}\n\nFicha do cliente:\n${ficha}\n\nConversa:\n${conversa}\n\n${PEDIDO_AUTO}${extra ? '\n\n' + extra : ''}` }], { temperatura: 0.2, max: 400, json: true });
  let j = {}; try { j = JSON.parse(t); } catch (e) { j = { resposta: '', humano: true }; }
  const resposta = String(j.resposta || '').trim() || 'Recebemos a sua mensagem. Um atendente da NexumCell vai continuar o seu atendimento assim que possível.';
  const acoes = (Array.isArray(j.acoes) ? j.acoes : []).map((a) => String(a).toLowerCase()).filter((a) => ACOES_WA.includes(a));
  return { resposta, humano: !!j.humano, acoes: [...new Set(acoes)].slice(0, 2) };
}
const seguidasIA = (msgs, ehCliente) => { let n = 0; for (let i = msgs.length - 1; i >= 0; i--) { const m = msgs[i]; if (ehCliente(m)) continue; if (m.ia) n++; else if (!m.auto) break; } return n; };

export async function crmIaAutomatica() {
  const base = await baseConhecimento(), cfg = base.cfg;
  if (!cfg.iaAuto) return { iaAuto: 'desligada' };
  if (cfg.iaAutoSoFora && dentroDoHorario(cfg)) return { iaAuto: 'horário de atendimento' };
  const espera = Math.max(1, Number(cfg.iaAutoMin) || 5) * 60e3, agora = Date.now(), r = { iaApp: 0, iaWa: 0, iaHumano: 0 };

  // 1) chat do app do celular (suporteApp)
  const sa = (await db.collection('suporteApp').where('naoLidoSuporte', '==', true).get()).docs;
  for (const s of sa.slice(0, 25)) {
    const c = s.data(); if ((c.iaHumano && (c.iaUltimaEm || 0) > agora - 864e5) || (c.atualizadoEm || 0) > agora - espera) continue;
    const msgs = (await s.ref.collection('msgs').get()).docs.map((d) => d.data()).sort((a, b) => a.em - b.em), ult = msgs[msgs.length - 1];
    if (!ult || ult.de !== 'cliente' || ult.em > agora - espera || seguidasIA(msgs, (m) => m.de === 'cliente') >= MAX_SEGUIDAS) continue;
    try {
      const conversa = msgs.slice(-14).map((m) => `${m.de === 'cliente' ? 'Cliente' : 'NexumCell'}: ${String(m.texto || '').slice(0, 500)}`).join('\n');
      const x = await responder(base, 'chat do app', c.clienteNome || 'Cliente', await fichaDe({ token: s.id, numero: c.vendaNumero }), conversa);
      await s.ref.collection('msgs').add({ de: 'suporte', texto: x.resposta, em: Date.now(), porNome: 'Assistente NexumCell', auto: true, ia: true });
      await s.ref.set({ naoLidoCliente: true, ultimaMsg: x.resposta.slice(0, 200), iaUltimaEm: Date.now(), ...(x.humano ? { iaHumano: true } : {}) }, { merge: true });
      pushNotificacao(s.id, 'NexumCell respondeu', x.resposta.slice(0, 120)).catch(() => {});
      r.iaApp++; if (x.humano) r.iaHumano++;
    } catch (e) { console.error('ia app', e.message); if (/sem chave/.test(e.message)) return { iaAuto: e.message }; }
  }

  // 2) WhatsApp (só com o programa do WhatsApp ligado: a resposta sai pela fila waSaida)
  if (cfg.iaAutoWa !== false) {
    const wa = (await db.collection('waConversas').where('naoLido', '==', true).get()).docs;
    const st = (await db.doc('plataforma/waWebStatus').get().catch(() => null))?.data() || {};
    const ver = parseFloat(st.versao || '0'), autoOk = ver >= 1.1; // programa novo sabe montar link, contrato, guia e acordo (1.2: o resto)
    const NOVAS = ['vencimento', 'roubo', 'pedidos', 'comprar'];
    for (const s of wa.slice(0, 25)) {
      const c = s.data(); if ((c.iaHumano && (c.iaUltimaEm || 0) > agora - 864e5) || c.aguardandoMenu || c.fim || (c.atualizadoEm || 0) > agora - espera) continue;
      const msgs = (await s.ref.collection('msgs').get()).docs.map((d) => d.data()).sort((a, b) => a.em - b.em), ult = msgs[msgs.length - 1];
      if (!ult || ult.de !== 'cliente' || ult.em > agora - espera || seguidasIA(msgs, (m) => m.de === 'cliente') >= MAX_SEGUIDAS) continue;
      try {
        const conversa = msgs.slice(-14).map((m) => `${m.de === 'cliente' ? 'Cliente' : 'NexumCell'}: ${String(m.t || '').slice(0, 500)}`).join('\n');
        if (RX_RISCO.test(ult.t || '') && !c.risco) { await db.collection('waConversas').doc(s.id).set({ risco: true, riscoEm: Date.now() }, { merge: true }); await alertaRisco({ key: 'wa:' + s.id, canal: 'WhatsApp', cliente: c.nome || s.id, trecho: ult.t }).catch(() => {}); }
        const x = await responder(base, 'WhatsApp', c.nome || 'Cliente', await fichaDe({ cpf: c.cpf }), conversa, autoOk ? PEDIDO_WA : '');
        if (autoOk && !x.acoes.length) { const k = intencaoWa(ult.t); if (k && !/(cancel|troca|reclam|procon|advogad)/i.test(ult.t || '')) { x.acoes = [k]; x.humano = false; } }
        if (ver < 1.2) x.acoes = x.acoes.filter((a) => !NOVAS.includes(a));
        if (x.acoes.length) x.humano = false;
        const em = Date.now();
        await db.collection('waSaida').add({ numero: s.id, texto: x.resposta, status: 'PENDENTE', em, por: 'Assistente NexumCell (IA)', ia: true });
        for (const [i, a] of x.acoes.entries()) await db.collection('waSaida').add({ numero: s.id, auto: a, cpf: c.cpf || '', texto: '', status: 'PENDENTE', em: em + 1 + i, por: 'Assistente NexumCell (IA)', ia: true });
        await s.ref.collection('msgs').add({ de: 'equipe', t: x.resposta, em: Date.now(), por: 'Assistente NexumCell (IA)', auto: true, ia: true });
        await s.ref.set({ ultimaMsg: x.resposta.slice(0, 200), ultimaDe: 'equipe', iaUltimaEm: Date.now(), ...(x.humano ? { iaHumano: true } : {}) }, { merge: true });
        r.iaWa++; if (x.humano) r.iaHumano++;
      } catch (e) { console.error('ia wa', e.message); if (/sem chave/.test(e.message)) return { iaAuto: e.message }; }
    }
  }
  return r;
}

// Mensagens agendadas no CRM (crmAgendadas): na hora marcada vão para o chat do app ou dos portais.
// WhatsApp com o programa ligado já sai pela fila waSaida (com naoAntes); no WhatsApp Web vira lembrete no CRM.
export async function agendadasRotina() {
  const agora = Date.now(); let n = 0;
  const l = (await db.collection('crmAgendadas').where('status', '==', 'PENDENTE').get()).docs.filter((d) => (d.data().quando || 0) <= agora && ['app', 'portal'].includes(d.data().canal));
  for (const d of l.slice(0, 50)) { const a = d.data();
    try {
      if (a.canal === 'app') { const ref = db.collection('suporteApp').doc(a.alvoId);
        await ref.collection('msgs').add({ de: 'suporte', texto: a.texto, em: Date.now(), porNome: a.por || 'NexumCell', agendada: true });
        await ref.set({ naoLidoCliente: true, ultimaMsg: String(a.texto).slice(0, 200), atualizadoEm: Date.now() }, { merge: true });
        pushNotificacao(a.alvoId, 'NexumCell', String(a.texto).slice(0, 120)).catch(() => {}); }
      if (a.canal === 'portal') { const ref = db.collection('atendimentos').doc(a.alvoId), at = (await ref.get()).data() || {};
        await ref.set({ msgs: [...(at.msgs || []), { de: 'atendente', t: a.texto, em: Date.now(), por: a.por || 'NexumCell', agendada: true }], naoLidoUser: true, atualizadoEm: Date.now() }, { merge: true }); }
      await d.ref.set({ status: 'ENVIADA', enviadaEm: Date.now() }, { merge: true }); n++;
    } catch (e) { await d.ref.set({ status: 'ERRO', erro: e.message }, { merge: true }).catch(() => {}); }
  }
  return { agendadas: n };
}
