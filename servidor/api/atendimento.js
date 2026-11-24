// Chat de atendimento dos portais (vendedor e gerente) com a equipe NexumCell.
// POST /api/atendimento {acao:'ia', id}                       → IA responde a última mensagem (chave fica só no servidor)
//                       {acao:'fila', id}                     → posição na fila, atendentes online e previsão para começar
//                       {acao:'avaliar', id, nota, resolvido, comentario} → pesquisa de satisfação (vale para a comissão do suporte)
import { db, cors, exigirEquipe, config } from './_base.js';
import { groq } from './crm-ia.js';
import { exemplosBons } from './crm-rotinas.js';
import { noTurno, artigosTexto } from './crm-extra.js';
import { ERROS, errosTexto, codigosNoTexto, resolucaoTexto, AJUDA_URL } from './erros.js';

const ONLINE_MS = 3 * 60e3;           // atendente sem sinal do CRM há mais de 3 min = offline
const TMA_PAD = 5;                    // minutos por atendimento, quando o dono não configurou
const erro = (m, s = 400) => Object.assign(new Error(m), { status: s });
const DIAS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

// horário de atendimento (o mesmo dos portais: config/sistema atendHoraIni, atendHoraFim, atendDomingo)
export function horario(cfg, agora = Date.now()) {
  const ini = +(cfg.atendHoraIni ?? 8), fim = +(cfg.atendHoraFim ?? 20), dom = cfg.atendDomingo === 'sim';
  const br = new Date(agora - 3 * 3600e3), h = br.getUTCHours() + br.getUTCMinutes() / 60, dia = br.getUTCDay();
  const abreNoDia = d => d !== 0 || dom;
  const aberto = abreNoDia(dia) && h >= ini && h < fim;
  let proximo = '';
  if (!aberto) {
    if (abreNoDia(dia) && h < ini) proximo = `hoje às ${ini}h`;
    else { let k = 1; while (!abreNoDia((dia + k) % 7) && k < 7) k++; proximo = k === 1 ? `amanhã às ${ini}h` : `${DIAS[(dia + k) % 7]} às ${ini}h`; }
  }
  return { ini, fim, aberto, proximo, domingo: dom };
}
// quem está com o CRM aberto e disponível
export function onlineDe(pres, fila, agora = Date.now()) {
  return Object.entries(pres || {}).filter(([, p]) => p && agora - (+p.em || 0) < ONLINE_MS && !/^(off|pausa)/.test(String(p.status || '')) && (p.fila === fila || p.fila === 'dono'))
    .map(([uid, p]) => ({ uid, nome: p.nome || '', fila: p.fila }));
}
// esperando o primeiro atendente humano (depois que a assistente passou para a equipe)
const esperando = a => a.status === 'HUMANO' && !(a.msgs || []).some(m => m.de === 'atendente' && !m.auto && (+m.em || 0) >= (+a.encaminhadoEm || 0));

async function meu(req, id) {
  const eu = await exigirEquipe(req, ['VENDEDOR', 'GERENTE', 'DONO']);
  const ref = db.collection('atendimentos').doc(String(id || '')), s = await ref.get();
  if (!s.exists) throw erro('Atendimento não encontrado', 404);
  const a = s.data(); if (a.abertoPor !== eu.uid && eu.role !== 'DONO') throw erro('Este atendimento não é seu', 403);
  return { eu, ref, a };
}

async function fila(req, id) {
  const { a } = await meu(req, id);
  const [cfg, crm, pres, atr, lista] = await Promise.all([config(), db.collection('config').doc('crm').get().then(s => s.data() || {}),
    db.collection('plataforma').doc('presencaCrm').get().then(s => s.data() || {}), db.collection('crmAtrib').doc('portal_' + id).get().then(s => s.data() || {}),
    db.collection('atendimentos').where('status', '==', 'HUMANO').get().then(q => q.docs.map(d => ({ id: d.id, ...d.data() })))]);
  const escala = Object.fromEntries((crm.escalaV2 || []).map(e => [e.uid, e])), hr = horario(cfg), filaNome = atr.fila || 'suporte', on = onlineDe(pres, filaNome).filter(o => noTurno(escala[o.uid])), tma = Math.max(1, Math.min(60, +crm.tmaMin || TMA_PAD));
  const espera = lista.filter(esperando).sort((x, y) => (+x.encaminhadoEm || +x.atualizadoEm || 0) - (+y.encaminhadoEm || +y.atualizadoEm || 0));
  const pos = espera.findIndex(x => x.id === id);
  const atendido = a.status !== 'HUMANO' || !esperando(a);
  const aFrente = pos < 0 ? 0 : pos;
  const estimativaMin = atendido ? 0 : aFrente === 0 ? (on.length ? 1 : tma) : Math.ceil(aFrente / Math.max(1, on.length)) * tma;
  const resp = atr.uid ? { nome: String(atr.nome || '').split(' ')[0], online: on.some(o => o.uid === atr.uid) } : null;
  return { atendido, posicao: pos < 0 ? null : pos + 1, aFrente, online: on.length, tma, estimativaMin, aberto: hr.aberto, proximo: hr.proximo, horario: `${hr.ini}h às ${hr.fim}h${hr.domingo ? '' : ', de segunda a sábado'}`, responsavel: resp, em: Date.now() };
}

async function avaliar(req, b) {
  const { eu, ref, a } = await meu(req, b.id);
  const nota = Math.round(+b.nota); if (!(nota >= 1 && nota <= 5)) throw erro('Escolha uma nota de 1 a 5');
  if (a.status !== 'CONCLUIDO') throw erro('A avaliação abre quando o atendimento for concluído');
  if (a.pesquisa) throw erro('Este atendimento já foi avaliado', 409);
  const atr = (await db.collection('crmAtrib').doc('portal_' + b.id).get()).data() || {};
  // quem atendeu: o responsável no CRM ou, se não tiver, o último atendente que escreveu
  let uid = atr.uid || '', nome = atr.nome || '';
  if (!uid) { const ult = [...(a.msgs || [])].reverse().find(m => m.de === 'atendente' && !m.auto && m.por); nome = ult?.por || a.concluidoPor || '';
    if (nome) { const q = await db.collection('users').where('nome', '==', nome).limit(1).get(); uid = q.docs[0]?.id || ''; } }
  const pesquisa = { nota, resolvido: b.resolvido === undefined ? null : !!b.resolvido, comentario: String(b.comentario || '').trim().slice(0, 500), em: Date.now(), atendente: nome, atendenteUid: uid };
  await ref.set({ pesquisa, atualizadoEm: Date.now() }, { merge: true });
  await db.collection('crmAvaliacoes').doc('portal_' + b.id).set({ key: 'portal:' + b.id, nota, resolvido: pesquisa.resolvido, comentario: pesquisa.comentario, uid, nome, fila: atr.fila || 'suporte', canal: 'portal',
    protocolo: a.protocolo || '', avaliador: eu.nome || a.nome || '', avaliadorRole: eu.role, lojaNome: a.lojaNome || '', via: 'chat', em: Date.now() });
  return { ok: true };
}

// limite simples: 40 respostas da IA por pessoa por hora
async function limite(uid) {
  const h = new Date().toISOString().slice(0, 13), ref = db.collection('atendIaUso').doc(uid), d = (await ref.get()).data() || {};
  const n = d.h === h ? (+d.n || 0) + 1 : 1; if (n > 40) throw erro('Muitas perguntas seguidas. Espere alguns minutos ou chame um atendente.', 429);
  await ref.set({ h, n }, { merge: true });
}

const PROMPT = (a, eu, extra) => `Você é a assistente virtual de suporte da NexumCell e conversa com um ${eu.role === 'GERENTE' ? 'gerente' : 'vendedor'} de loja parceira (${a.lojaNome || 'loja parceira'}), não com o cliente final. A NexumCell vende celular parcelado com trava do aparelho, faz análise de crédito própria e oferece empréstimo.
Responda em português do Brasil, com educação, frases curtas e passos numerados quando for "como faço". Vá direto ao ponto: primeiro a solução, depois os detalhes. No máximo 8 linhas. Não use emojis. Nunca invente valores, prazos, regras ou telas: se não souber, diga que vai chamar um atendente.
Como o sistema funciona: Nova venda tem 8 passos (documento, biometria, contato, análise, aparelho, contrato, entrada e trava). A trava é instalada pelo QR code na tela de boas-vindas do celular restaurado de fábrica (tocar 6 vezes), ou pelo computador com cabo USB quando aparece "app bloqueado para proteger o dispositivo". O cliente paga as parcelas pelo Pix no app NexumCell (aba Parcelas) e o aparelho libera sozinho minutos depois. Liberar ou remover a trava manualmente, mudar dado de contrato, estorno, cancelamento e acordo são feitos só pela equipe NexumCell. Vendas só no notebook autorizado da loja, dentro da loja. Cada CPF pode ter um aparelho financiado em aberto. Uma licença a cada 12 parcelas.
Códigos de erro do sistema (quando a pessoa citar um número, explique o que é e o passo a passo para resolver; no fim, indique o link ${AJUDA_URL}#erro-CODIGO):
${errosTexto()}
Central de ajuda com passo a passo: ${AJUDA_URL} (artigos: #trava-qr, #trava-usb, #pagou-nao-liberou, #pix-cliente, #notebook, #venda-distancia, #foto-documento, #licencas, #acesso).
${extra.orientacoes ? 'Orientações do dono:\n' + extra.orientacoes + '\n' : ''}${a.contrato ? `Contrato em pauta: nº ${a.contrato.numero} · cliente ${a.contrato.cliente || ''}.\n` : ''}Seu trabalho é RESOLVER. Se a pessoa só pedir um atendente sem dizer o problema, NÃO chame: pergunte em uma frase o que aconteceu e diga que você resolve na hora. Se ela descrever o problema, dê a solução completa mesmo que tenha pedido atendente. Marque "atendente": true SOMENTE quando: (1) for algo que só a equipe faz (liberar ou bloquear aparelho, mudar contrato, conferir comprovante de pagamento, estorno, cancelamento, acordo); (2) for reclamação; (3) a pessoa já tentou a sua solução e disse que não resolveu; ou (4) insistir no atendente depois que você perguntou o problema. Nesses casos escreva em "resposta" uma frase curta avisando que vai chamar um atendente. Para trava pelo cabo USB, explique os 5 passos (restaurar sem conta Google; tocar 7 vezes em Número da versão; ligar Depuração USB; na venda, passo Trava, baixar o instalador, ligar o cabo e tocar em Permitir; esperar PRONTO) e diga que o guia com imagens está em ${AJUDA_URL}#trava-usb.
Responda só em JSON: {"resposta":"texto pronto para mostrar","atendente":true|false,"resumo":"uma linha descrevendo o problema para a equipe"}.`;

async function ia(req, b) {
  const { eu, a } = await meu(req, b.id);
  if (a.status === 'CONCLUIDO') throw erro('Atendimento concluído');
  await limite(eu.uid);
  const msgs = (a.msgs || []).filter(m => (m.t || m.arquivo) && ['user', 'bot', 'atendente'].includes(m.de)).slice(-14);
  const ultM = [...msgs].reverse().find(m => m.de === 'user'), foto = await lerFotoTela(ultM);
  const ult = (ultM?.t || '') + (foto ? ' ' + foto.texto : '');
  const cods = [...new Set([...codigosNoTexto(ult), ...((foto?.codigos || []).map(String).filter(c => ERROS[c]))])];
  const crm = (await db.collection('config').doc('crm').get()).data() || {};
  const hist = msgs.map(m => ({ role: m.de === 'user' ? 'user' : 'assistant', content: (String(m.t || (m.arquivo ? '[foto]' : '')).slice(0, 1500)) + (m === ultM && foto ? `\n[Foto da tela enviada. O que mostra: ${foto.tela}. Texto na tela: ${foto.texto || '(nenhum)'}${foto.marca ? '. Aparelho: ' + foto.marca + ' ' + (foto.modelo || '') : ''}${cods.length ? '. Códigos do catálogo: ' + cods.map(c => c + ' = ' + ERROS[c].t).join('; ') : ''}]` : '') }));
  let j = {};
  try {
    const ex = await exemplosBons(), art = await artigosTexto().catch(() => '');
    const t = await groq([{ role: 'system', content: PROMPT(a, eu, { orientacoes: String(crm.iaOrientacoes || '').slice(0, 2500) }) + (art ? '\n\n' + art : '') + (ex ? '\n\n' + ex : '') }, ...hist], { temperatura: 0.2, max: 600, json: true });
    j = JSON.parse(t);
  } catch (e) {
    if (cods.length) return { texto: cods.map(resolucaoTexto).join('\n\n'), atendente: false, codigos: cods, fonte: 'catalogo' };
    throw erro(e.message || 'A IA não respondeu', e.status || 502);
  }
  return { texto: String(j.resposta || '').trim(), atendente: !!j.atendente, resumo: String(j.resumo || '').slice(0, 200), codigos: cods, fonte: 'ia', ...(foto ? { foto: { tela: foto.tela, texto: String(foto.texto || '').slice(0, 300) } } : {}) };
}
// diagnóstico pela foto: a IA lê a tela (erro da trava, leitor de QR, tela do portal) e transcreve os códigos
async function lerFotoTela(m) {
  if (!m?.arquivo?.id || !/^image\//.test(m.arquivo.tipo || '')) return null;
  try {
    const d = (await db.collection('crmArquivos').doc(String(m.arquivo.id)).get()).data(); if (!d?.data || !/^data:image\//.test(d.data)) return null;
    const t = await groq([{ role: 'system', content: 'Você lê fotos de tela de celular Android e do sistema NexumCell (portal da loja, app NexumCell Trava, leitor de QR da configuração do Android). Transcreva exatamente; não invente.' },
      { role: 'user', content: [{ type: 'text', text: 'Responda em JSON: {"tela":"o que a tela mostra em 1 frase (ex.: erro no app NexumCell Trava; tela de boas-vindas do Android; leitor de QR; tela da venda no portal)","texto":"todo o texto visível, principalmente mensagens de erro","codigos":["números de erro de 3 ou 4 dígitos que aparecem"],"marca":"","modelo":""}' }, { type: 'image_url', image_url: { url: d.data } }] }],
      { temperatura: 0, max: 500, json: true, tipo: 'visao', modelo: process.env.GROQ_MODELO_VISAO || '' });
    const j = JSON.parse(t); return { tela: String(j.tela || '').slice(0, 200), texto: String(j.texto || '').slice(0, 1200), codigos: Array.isArray(j.codigos) ? j.codigos.slice(0, 5) : [], marca: String(j.marca || ''), modelo: String(j.modelo || '') };
  } catch (e) { console.error('foto da tela', e.message); return null; }
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    const b = req.body || {};
    if (b.acao === 'fila') return res.json(await fila(req, b.id));
    if (b.acao === 'avaliar') return res.json(await avaliar(req, b));
    if (b.acao === 'ia') return res.json(await ia(req, b));
    if (b.acao === 'resolucao') { const c = String(b.codigo || ''); if (!ERROS[c]) throw erro('Código não encontrado', 404); return res.json({ texto: resolucaoTexto(c), ...ERROS[c] }); }
    throw erro('Ação inválida');
  } catch (e) { return res.status(e.status || 500).json({ erro: e.message }); }
}
