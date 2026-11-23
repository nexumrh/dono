// Rotinas do atendimento (CRM):
//  - relatorioDiarioCrm: todo fim de dia (cron da noite) o dono recebe o resumo do dia e ele fica salvo em relatoriosCrm/{data}
//  - lembretePesquisa: 24 h depois de concluído, o chat lembra uma vez o vendedor/gerente de avaliar o atendimento
//  - avisoPrioridade: atendimento marcado como prioridade (pessoa irritada ou urgência alta) avisa o dono por e-mail, uma vez
//  - exemplosBons: respostas da equipe em atendimentos que receberam nota 5, para a IA escrever no mesmo jeito
import { db, hoje } from './_base.js';
import { brevoLigado, enviarEmail } from './_brevo.js';
import { ERROS } from './erros.js';

const lista = async (c, campo, desde) => (await db.collection(c).where(campo, '>=', desde).get()).docs.map(d => ({ id: d.id, ...d.data() }));
const minFmt = m => m == null ? '—' : m < 60 ? Math.round(m) + ' min' : Math.floor(m / 60) + ' h ' + String(Math.round(m % 60)).padStart(2, '0');

export async function relatorioDiarioCrm(cfg = {}, forcar = false) {
  if (cfg.relCrmDiario === 'nao') return { relDiario: 'desligado' };
  const h = hoje(), ref = db.collection('relatoriosCrm').doc(h);
  if (!forcar && (await ref.get()).exists) return { relDiario: 'já feito hoje' };
  const ini = new Date(h + 'T00:00:00-03:00').getTime();
  const [at, ch, atr, av, wa, app, mk] = await Promise.all([lista('atendimentos', 'atualizadoEm', ini), lista('chamados', 'criadoEm', ini), lista('crmAtrib', 'em', ini - 7 * 864e5), lista('crmAvaliacoes', 'em', ini), lista('waConversas', 'atualizadoEm', ini), lista('suporteApp', 'atualizadoEm', ini), lista('crmMarcas', 'atualizadoEm', ini)]);
  const humanos = at.filter(a => a.status !== 'BOT' && (a.encaminhadoEm || 0) >= ini);
  // tempo até a 1ª resposta humana nos chats dos portais
  const tempos = humanos.map(a => { const r = (a.msgs || []).find(m => m.de === 'atendente' && !m.auto && (+m.em || 0) >= (+a.encaminhadoEm || 0)); return r ? (r.em - a.encaminhadoEm) / 60e3 : null; }).filter(x => x != null && x >= 0);
  const tmr = tempos.length ? tempos.reduce((s, x) => s + x, 0) / tempos.length : null;
  const resolvidosBot = at.filter(a => (a.criadoEm || 0) >= ini && a.status === 'CONCLUIDO' && !a.encaminhadoEm).length;
  const fin = atr.filter(a => (a.finalizadoEm || 0) >= ini), porAt = {};
  fin.forEach(a => { const k = a.finalizadoPor || a.nome || '—'; (porAt[k] ||= { fin: 0, notas: [] }).fin++; });
  av.forEach(a => { const k = a.nome || '—'; (porAt[k] ||= { fin: 0, notas: [] }).notas.push(+a.nota || 0); });
  const media = av.length ? av.reduce((s, a) => s + (+a.nota || 0), 0) / av.length : null;
  const erros = {}; at.forEach(a => (a.codigos || []).forEach(c => { erros[c] = (erros[c] || 0) + 1; }));
  const errosLoja = {}; at.forEach(a => (a.codigos || []).forEach(c => { const k = `${a.lojaNome || 'Sem loja'} · ${c}`; errosLoja[k] = (errosLoja[k] || 0) + 1; }));
  const prioridade = mk.filter(a => a.prioridade && (a.prioridadeEm || 0) >= ini).length;
  const dados = { data: h, em: Date.now(), chatsPortais: at.filter(a => (a.criadoEm || 0) >= ini).length, comEquipe: humanos.length, resolvidosAssistente: resolvidosBot, chamados: ch.length, whatsapp: wa.length, app: app.length,
    finalizados: fin.length, tmrMin: tmr == null ? null : Math.round(tmr * 10) / 10, notaMedia: media == null ? null : Math.round(media * 10) / 10, avaliacoes: av.length, prioridade,
    porAtendente: Object.entries(porAt).map(([nome, v]) => ({ nome, finalizados: v.fin, avaliacoes: v.notas.length, media: v.notas.length ? Math.round(v.notas.reduce((s, x) => s + x, 0) / v.notas.length * 10) / 10 : null })).sort((a, b) => b.finalizados - a.finalizados),
    erros: Object.entries(erros).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([c, n]) => ({ c, n, t: ERROS[c]?.t || '' })), errosLoja: Object.entries(errosLoja).filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => ({ k, n })) };
  await ref.set(dados);
  if (brevoLigado() && process.env.DONO_EMAIL) {
    const tr = (a, b) => `<tr><td style="padding:5px 10px 5px 0;color:#5B6478">${a}</td><td style="padding:5px 0;text-align:right"><b>${b}</b></td></tr>`;
    const html = `<div style="font-family:Arial,sans-serif;color:#0A1733;max-width:640px"><h2 style="margin:0 0 4px">Atendimento de hoje · ${h.split('-').reverse().join('/')}</h2><p style="color:#5B6478;margin:0 0 14px">Resumo automático do CRM da NexumCell.</p>
      <table style="width:100%;border-collapse:collapse;margin-bottom:14px">${tr('Chats dos portais abertos', dados.chatsPortais)}${tr('Resolvidos só pela assistente', dados.resolvidosAssistente)}${tr('Passaram para a equipe', dados.comEquipe)}${tr('Tempo médio até a 1ª resposta', minFmt(dados.tmrMin))}${tr('Chamados', dados.chamados)}${tr('Conversas no WhatsApp', dados.whatsapp)}${tr('Finalizados', dados.finalizados)}${tr('Nota média', dados.notaMedia == null ? '—' : dados.notaMedia + ' de 5 (' + dados.avaliacoes + ')')}${tr('Marcados como prioridade', dados.prioridade)}</table>
      <h3 style="margin:0 0 6px;font-size:15px">Quem atendeu</h3><table style="width:100%;margin-bottom:14px">${dados.porAtendente.map(p => tr(p.nome, `${p.finalizados} finalizado(s) · nota ${p.media ?? '—'}`)).join('') || tr('Ninguém finalizou atendimentos hoje', '')}</table>
      <h3 style="margin:0 0 6px;font-size:15px">Erros mais comuns</h3><table style="width:100%;margin-bottom:14px">${dados.erros.map(e => tr(`${e.c} · ${e.t}`, e.n)).join('') || tr('Nenhum código de erro hoje', '')}</table>
      ${dados.errosLoja.length ? `<h3 style="margin:0 0 6px;font-size:15px">Erros repetidos na mesma loja</h3><table style="width:100%">${dados.errosLoja.map(e => tr(e.k, e.n + 'x')).join('')}</table>` : ''}</div>`;
    try { await enviarEmail({ para: process.env.DONO_EMAIL, assunto: `Atendimento de hoje: ${dados.chatsPortais + dados.chamados + dados.whatsapp} contatos, nota ${dados.notaMedia ?? '—'}, 1ª resposta em ${minFmt(dados.tmrMin)}`, html }); } catch (e) { console.error('reldiario email', e.message); }
  }
  return { relDiario: 'feito' };
}

export async function lembretePesquisa() {
  const agora = Date.now(); let n = 0;
  const l = await lista('atendimentos', 'concluidoEm', agora - 48 * 3600e3);
  for (const a of l) {
    if (a.status !== 'CONCLUIDO' || a.pesquisa || a.lembretePesquisaEm || (a.concluidoEm || 0) > agora - 24 * 3600e3) continue;
    if (!(a.msgs || []).some(m => m.de === 'atendente' && !m.auto)) continue; // só quem foi atendido por uma pessoa
    await db.collection('atendimentos').doc(a.id).set({ lembretePesquisaEm: agora, naoLidoUser: true, msgs: [...(a.msgs || []), { de: 'bot', t: 'Você ainda não avaliou este atendimento. Leva 5 segundos: escolha as estrelas logo abaixo. Sua nota ajuda a melhorar o suporte.', em: agora }] }, { merge: true });
    n++;
  }
  return { lembretesPesquisa: n };
}

export async function avisoPrioridade() {
  if (!brevoLigado() || !process.env.DONO_EMAIL) return { prioridade: 'sem e-mail' };
  const l = (await lista('crmMarcas', 'atualizadoEm', Date.now() - 6 * 3600e3)).filter(a => a.prioridade && (a.prioridadeEm || 0) > Date.now() - 6 * 3600e3 && !a.prioridadeAvisadoEm);
  if (!l.length) return { prioridade: 0 };
  const linhas = l.slice(0, 10).map(a => `<li><b>${a.prioridadeNome || a.key}</b> · ${a.prioridadeMotivo || 'prioridade alta'}</li>`).join('');
  await enviarEmail({ para: process.env.DONO_EMAIL, assunto: `${l.length} atendimento(s) com prioridade alta no CRM`, html: `<div style="font-family:Arial,sans-serif;color:#0A1733"><h2 style="margin:0 0 8px">Atendimentos que pedem atenção</h2><p style="color:#5B6478">Pessoa irritada ou urgência alta. Eles já estão no topo da fila do CRM.</p><ul>${linhas}</ul></div>` });
  for (const a of l) await db.collection('crmMarcas').doc(a.id).set({ prioridadeAvisadoEm: Date.now() }, { merge: true });
  return { prioridade: l.length };
}

// respostas que deram nota 5: a IA usa como exemplo de tom e de solução
let _ex = null;
export async function exemplosBons() {
  if (_ex && _ex.em > Date.now() - 15 * 60e3) return _ex.t;
  let t = '';
  try {
    const av = (await db.collection('crmAvaliacoes').where('nota', '==', 5).limit(40).get()).docs.map(d => d.data()).filter(a => a.canal === 'portal' && a.key).sort((a, b) => b.em - a.em).slice(0, 8);
    const ex = [];
    for (const a of av) { const s = await db.collection('atendimentos').doc(String(a.key).replace(/^portal:/, '')).get(); if (!s.exists) continue; const ms = s.data().msgs || [];
      const perg = ms.filter(m => m.de === 'user').slice(-1)[0]?.t, resp = ms.filter(m => m.de === 'atendente' && !m.auto).slice(-2).map(m => m.t).join(' ');
      if (perg && resp) ex.push(`Pergunta: ${String(perg).slice(0, 200)}\nResposta que recebeu nota 5: ${String(resp).slice(0, 400)}`); if (ex.length >= 5) break; }
    t = ex.length ? 'Exemplos de respostas da equipe que receberam nota 5 (siga o mesmo tom e o mesmo nível de detalhe):\n' + ex.join('\n---\n') : '';
  } catch (e) { t = ''; }
  _ex = { em: Date.now(), t }; return t;
}

// conversa esperando a resposta do vendedor/gerente há mais de 24 h: encerra sozinha com aviso (pode abrir outra quando quiser)
export async function autoEncerrar() {
  const agora = Date.now(); let n = 0;
  for (const d of (await db.collection('atendimentos').where('status', '==', 'HUMANO').get()).docs) {
    const a = d.data(), ms = (a.msgs || []).filter(m => !m.auto && m.de !== 'bot'), u = ms[ms.length - 1];
    if (!u || u.de !== 'atendente' || (+u.em || 0) > agora - 24 * 3600e3) continue;
    await d.ref.set({ status: 'CONCLUIDO', concluidoEm: agora, concluidoPor: 'Encerramento automático', naoLidoUser: true, atualizadoEm: agora,
      msgs: [...(a.msgs || []), { de: 'bot', t: 'Como não tivemos resposta nas últimas 24 horas, encerramos este atendimento. Se ainda precisar de ajuda, é só abrir um novo chat. Antes, avalie como foi o atendimento logo abaixo.', em: agora, auto: true }] }, { merge: true });
    n++;
  }
  return { autoEncerrados: n };
}
