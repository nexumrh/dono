// Resposta automática da IA no CRM: quando ninguém da equipe responde o cliente no app ou no WhatsApp
// (programa do WhatsApp ligado) em X minutos — ou fora do horário — a IA responde com base na ficha,
// nas orientações do dono e nas respostas rápidas aprovadas. Pedido de humano, reclamação, acordo,
// desconto ou liberação: a IA avisa que um atendente continua e deixa a conversa marcada para a equipe.
// Liga em CRM → Configurações → Resposta automática da IA. Roda na rotina de 15 minutos.
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

async function responder(base, canal, cliente, ficha, conversa) {
  const t = await groq([{ role: 'system', content: REGRAS + '\n\n' + base.texto }, { role: 'user', content: `Canal: ${canal}\nCliente: ${cliente}\n\nFicha do cliente:\n${ficha}\n\nConversa:\n${conversa}\n\n${PEDIDO_AUTO}` }], { temperatura: 0.2, max: 350, json: true });
  let j = {}; try { j = JSON.parse(t); } catch (e) { j = { resposta: '', humano: true }; }
  const resposta = String(j.resposta || '').trim() || 'Recebemos a sua mensagem. Um atendente da NexumCell vai continuar o seu atendimento assim que possível.';
  return { resposta, humano: !!j.humano };
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
    for (const s of wa.slice(0, 25)) {
      const c = s.data(); if ((c.iaHumano && (c.iaUltimaEm || 0) > agora - 864e5) || c.aguardandoMenu || c.fim || (c.atualizadoEm || 0) > agora - espera) continue;
      const msgs = (await s.ref.collection('msgs').get()).docs.map((d) => d.data()).sort((a, b) => a.em - b.em), ult = msgs[msgs.length - 1];
      if (!ult || ult.de !== 'cliente' || ult.em > agora - espera || seguidasIA(msgs, (m) => m.de === 'cliente') >= MAX_SEGUIDAS) continue;
      try {
        const conversa = msgs.slice(-14).map((m) => `${m.de === 'cliente' ? 'Cliente' : 'NexumCell'}: ${String(m.t || '').slice(0, 500)}`).join('\n');
        const x = await responder(base, 'WhatsApp', c.nome || 'Cliente', await fichaDe({ cpf: c.cpf }), conversa);
        await db.collection('waSaida').add({ numero: s.id, texto: x.resposta, status: 'PENDENTE', em: Date.now(), por: 'Assistente NexumCell (IA)', ia: true });
        await s.ref.collection('msgs').add({ de: 'equipe', t: x.resposta, em: Date.now(), por: 'Assistente NexumCell (IA)', auto: true, ia: true });
        await s.ref.set({ ultimaMsg: x.resposta.slice(0, 200), ultimaDe: 'equipe', iaUltimaEm: Date.now(), ...(x.humano ? { iaHumano: true } : {}) }, { merge: true });
        r.iaWa++; if (x.humano) r.iaHumano++;
      } catch (e) { console.error('ia wa', e.message); if (/sem chave/.test(e.message)) return { iaAuto: e.message }; }
    }
  }
  return r;
}
