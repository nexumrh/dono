// Ações extras do CRM (chamadas por POST /api/crm-ia {acao}):
//  transcrever  · áudio gravado pelo atendente vira texto (Whisper no Groq)
//  traduzir     · mensagens em espanhol para português e a resposta do atendente para espanhol
//  qualidade    · a IA avalia o atendimento ao concluir (nota interna) e sugere artigo novo para a Central de ajuda
// E também: escala de horários da equipe, incidentes (erro em massa) e artigos aprovados públicos (GET /api/ajuda-artigos)
import { db, cors } from './_base.js';
import { groq } from './crm-ia.js';
import { chaveIA } from './ia-autonoma.js';
import { ERROS } from './erros.js';
import { brevoLigado, enviarEmail } from './_brevo.js';

const erro = (m, s = 400) => Object.assign(new Error(m), { status: s });
const kSafe = k => String(k).replace(/[/:]/g, '_');

export async function transcrever(b) {
  const chave = await chaveIA(); if (!chave) throw erro('IA sem chave');
  const b64 = String(b.audio || '').replace(/^data:[^,]+,/, ''); if (!b64 || b64.length > 9e6) throw erro('Áudio vazio ou longo demais (máximo 3 minutos)');
  const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0)), tipo = String(b.tipo || 'audio/webm');
  const fd = new FormData(); fd.append('file', new Blob([bin], { type: tipo }), 'audio.' + (tipo.includes('mp4') ? 'mp4' : tipo.includes('ogg') ? 'ogg' : 'webm'));
  fd.append('model', 'whisper-large-v3-turbo'); fd.append('language', b.idioma === 'es' ? 'es' : 'pt'); fd.append('response_format', 'json');
  const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: 'Bearer ' + chave }, body: fd });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw erro('Transcrição: ' + (j.error?.message || r.status), 502);
  return { texto: String(j.text || '').trim() };
}

export async function traduzir(b) {
  const textos = (Array.isArray(b.textos) ? b.textos : [b.texto]).filter(Boolean).slice(0, 20).map(t => String(t).slice(0, 1200)), para = b.para === 'es' ? 'espanhol' : 'português do Brasil';
  if (!textos.length) return { textos: [] };
  const t = await groq([{ role: 'system', content: `Você traduz mensagens de atendimento para ${para}, mantendo o tom, os números, os links e os nomes. Responda só em JSON: {"t":["tradução 1","tradução 2",...]} na mesma ordem.` }, { role: 'user', content: JSON.stringify(textos) }], { temperatura: 0, max: 1500, json: true });
  let j = {}; try { j = JSON.parse(t); } catch (e) { }
  return { textos: Array.isArray(j.t) ? j.t.map(String) : [] };
}

export async function qualidade(b, eu) {
  const conversa = String(b.conversa || '').slice(-9000); if (conversa.length < 20) return { pulado: true };
  const artigos = (await db.collection('crmArtigos').where('status', 'in', ['aprovado', 'sugerido']).get().catch(() => ({ docs: [] }))).docs.map(d => d.data().titulo).filter(Boolean);
  const temas = [...Object.values(ERROS).map(e => e.t), ...artigos, 'Instalar a trava pelo QR', 'Instalar a trava pela USB', 'Cliente pagou e não liberou', 'Pix das parcelas', 'Cadastrar notebook', 'Venda a distância', 'Foto do documento', 'Licenças', 'Senha e acesso'];
  const t = await groq([{ role: 'system', content: 'Você é o controle de qualidade do atendimento da NexumCell (celular parcelado com trava). Avalie com justiça o trabalho do ATENDENTE da NexumCell na conversa (não o cliente). Considere: educação, se resolveu ou encaminhou certo, agilidade e clareza. Responda só em JSON.' },
    { role: 'user', content: `Atendente: ${String(b.atendenteNome || '').slice(0, 40)}\nCanal: ${String(b.canal || '').slice(0, 30)}\n\nConversa:\n${conversa}\n\nTemas que já têm artigo na Central de ajuda: ${temas.join('; ')}\n\nJSON: {"nota":0-10,"educacao":0-10,"agilidade":0-10,"clareza":0-10,"resolveu":true|false,"pontos_fortes":["até 2"],"melhorar":["até 2, concretos"],"resumo":"1 frase","artigo":{"novo":true|false,"titulo":"","problema":"","passos":["passo 1","..."]}}. Só marque artigo.novo=true se a conversa ensinou uma solução útil para outras lojas que NÃO está nos temas acima.` }], { temperatura: 0.1, max: 700, json: true });
  let j = {}; try { j = JSON.parse(t); } catch (e) { return { pulado: true }; }
  const n = v => Math.max(0, Math.min(10, Math.round(+v || 0)));
  const q = { key: String(b.key || ''), canal: String(b.canal || ''), uid: String(b.atendenteUid || ''), nome: String(b.atendenteNome || ''), nota: n(j.nota), educacao: n(j.educacao), agilidade: n(j.agilidade), clareza: n(j.clareza), resolveu: !!j.resolveu,
    fortes: (j.pontos_fortes || []).slice(0, 2).map(String), melhorar: (j.melhorar || []).slice(0, 2).map(String), resumo: String(j.resumo || '').slice(0, 240), em: Date.now(), por: 'IA', pedidoPor: eu.nome || '' };
  if (q.key) await db.collection('crmQualidade').doc(kSafe(q.key)).set(q);
  const a = j.artigo || {}; let artigo = null;
  if (a.novo && a.titulo && Array.isArray(a.passos) && a.passos.length >= 2) {
    artigo = { titulo: String(a.titulo).slice(0, 90), problema: String(a.problema || '').slice(0, 300), passos: a.passos.slice(0, 8).map(p => String(p).slice(0, 300)), status: 'sugerido', origem: q.key, sugeridoEm: Date.now(), atendente: q.nome };
    const ref = await db.collection('crmArtigos').add(artigo); artigo.id = ref.id;
  }
  return { ...q, artigo };
}

// artigos aprovados: texto para a IA e lista pública para a Central de ajuda
export async function artigosAprovados() {
  return (await db.collection('crmArtigos').where('status', '==', 'aprovado').get()).docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.titulo || '').localeCompare(b.titulo || ''));
}
export async function artigosTexto() {
  const l = await artigosAprovados().catch(() => []); if (!l.length) return '';
  return 'Artigos da Central de ajuda aprovados pela equipe:\n' + l.map(a => `- ${a.titulo}: ${a.problema || ''} Passos: ${(a.passos || []).join(' ')}`).join('\n');
}
export async function ajudaArtigos(req, res) {
  if (cors(req, res)) return;
  try { const l = await artigosAprovados(); res.setHeader?.('Cache-Control', 'public, max-age=300'); return res.json({ artigos: l.map(a => ({ id: a.id, titulo: a.titulo, problema: a.problema || '', passos: a.passos || [] })) }); }
  catch (e) { return res.status(500).json({ erro: e.message }); }
}

// escala: o atendente só recebe atendimento dentro do turno (quando o dono configurou a escala dele)
export function noTurno(e, agora = Date.now()) {
  if (!e || !Array.isArray(e.dias)) return true;
  const br = new Date(agora - 3 * 3600e3), d = br.getUTCDay(), min = br.getUTCHours() * 60 + br.getUTCMinutes(), hm = s => { const [h, m] = String(s || '0:0').split(':').map(Number); return h * 60 + (m || 0); };
  return e.dias.includes(d) && min >= hm(e.ini || '00:00') && min < hm(e.fim || '23:59');
}

// erro em massa: o mesmo código em 3 ou mais lojas na última hora vira incidente e o dono é avisado
export async function incidentesRotina() {
  const agora = Date.now(), l = (await db.collection('atendimentos').where('criadoEm', '>=', agora - 60 * 60e3).get()).docs.map(d => ({ id: d.id, ...d.data() }));
  const por = {}; l.forEach(a => (a.codigos || []).forEach(c => { (por[c] ||= { lojas: new Set(), keys: [] }); por[c].lojas.add(a.lojaNome || a.lojaId || a.abertoPor); por[c].keys.push('portal:' + a.id); }));
  let n = 0;
  for (const [c, v] of Object.entries(por)) {
    if (v.lojas.size < 3) continue;
    const id = `inc_${c}_${new Date(agora - 3 * 3600e3).toISOString().slice(0, 13)}`, ref = db.collection('crmIncidentes').doc(id), s = await ref.get();
    if (s.exists && s.data().avisadoEm) continue;
    await ref.set({ codigo: c, titulo: ERROS[c]?.t || 'Erro ' + c, lojas: [...v.lojas].slice(0, 30), keys: [...new Set([...(s.exists ? s.data().keys || [] : []), ...v.keys])].slice(0, 200), aberto: true, em: s.exists ? s.data().em : agora, origem: 'automático', avisadoEm: agora }, { merge: true });
    if (brevoLigado() && process.env.DONO_EMAIL) await enviarEmail({ para: process.env.DONO_EMAIL, assunto: `Possível problema geral: erro ${c} em ${v.lojas.size} lojas na última hora`, html: `<div style="font-family:Arial,sans-serif;color:#0A1733"><h2 style="margin:0 0 8px">Erro ${c} · ${ERROS[c]?.t || ''}</h2><p>${v.lojas.size} lojas mandaram o mesmo código na última hora: ${[...v.lojas].slice(0, 10).join(', ')}.</p><p>Pode ser um problema geral (servidor, app ou configuração). No CRM, o incidente já aparece no topo da caixa de entrada: dá para responder todos de uma vez e, ao resolver, avisar todo mundo automaticamente.</p></div>` }).catch(() => { });
    n++;
  }
  return { incidentes: n };
}
