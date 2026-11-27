// NexumCell WhatsApp — liga o WhatsApp ao CRM NexumCell pelo QR code.
// Firestore (projeto nexumcell, conta de serviço em conta-servico.json):
//   plataforma/waWebStatus {status: 'qr'|'conectado'|'desconectado', numero, nome, vivoEm, conectadoEm, robo, versao}
//   plataforma/waWebQr     {qr: dataURL, em}            (só o dono lê)
//   plataforma/waWebCmd    {cmd: 'desconectar'|'novoqr', em}
//   waConversas/{numero}   {numero, nome, ultimaMsg, ultimaDe, atualizadoEm, naoLido, fila, cpf} + /msgs
//   waSaida/{id}           {numero, texto, arquivo?, status:'PENDENTE'|'ENVIADO'|'ERRO'}  ← o CRM grava, o programa envia
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import admin from 'firebase-admin';
import QRCode from 'qrcode';
import pino from 'pino';
import baileys, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, downloadMediaMessage } from '@whiskeysockets/baileys';

const VERSAO = '1.3';
import { montar, pedirAcordo, conferirCpf, intencao, pedirVencimento, passoRoubo, conferirComprovante, ehEspanhol } from './autoatendimento.js';
const DIR = path.dirname(fileURLToPath(import.meta.url));
const arqConta = path.join(DIR, 'conta-servico.json');
if (!fs.existsSync(arqConta)) { console.error('Falta o arquivo conta-servico.json nesta pasta. Veja o LEIA-ME.'); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(arqConta, 'utf8'))) });
const db = admin.firestore();
const st = db.doc('plataforma/waWebStatus'), qrDoc = db.doc('plataforma/waWebQr');
const makeWASocket = baileys.default || baileys;
let sock = null, numeroConectado = '', robo = true;

const so = (s) => String(s || '').replace(/\D/g, '');
// Contas com número oculto: o WhatsApp manda um código interno (LID, ex.: 61864792834257@lid) no lugar do telefone.
// Guardamos o endereço real de cada conversa (campo jid) e respondemos sempre para ele.
const jids = new Map();
async function jidDe(n) {
  const d = so(n); if (jids.has(d)) return jids.get(d);
  for (const id of [d, d.replace(/^55/, '')]) { try { const j = (await db.collection('waConversas').doc(id).get()).data()?.jid; if (j) { jids.set(d, j); return j; } } catch (e) { } }
  return d + (d.length >= 14 ? '@lid' : '@s.whatsapp.net');   // conversas antigas sem jid: 14+ dígitos é código LID, não telefone
}
async function enderecoDe(key) {
  const rj = key.remoteJid || '', pn = [key.senderPn, key.remoteJidAlt, key.participantPn].find((x) => /@s\.whatsapp\.net$/.test(x || ''));
  if (!rj.endsWith('@lid')) { const n = so(rj.split('@')[0].split(':')[0]); return { numero: n, jid: n + '@s.whatsapp.net', lid: false }; }
  let tel = pn; if (!tel) try { tel = await sock?.signalRepository?.lidMapping?.getPNForLID?.(rj); } catch (e) { }
  if (tel && /@s\.whatsapp\.net$/.test(tel)) { const n = so(tel.split('@')[0].split(':')[0]); return { numero: n, jid: n + '@s.whatsapp.net', lid: false, lidJid: rj }; }
  return { numero: so(rj.split('@')[0]), jid: rj, lid: true };
}
const MENU = 'Olá! Você está falando com a *NexumCell*. Responda com o número:\n\n*1* Pagar minha parcela (link do PIX)\n*2* Meu contrato em PDF\n*3* Como pagar e usar o app (com imagens)\n*4* Renegociar atraso ou quitar\n*5* Celular travado: liberar 20 min para pagar\n*6* Mudar o dia do vencimento\n*7* Celular roubado, furtado ou perdido\n*8* Meus pedidos e declaração de quitação\n*9* Comprar outro celular · Indique e ganhe\n*10* Falar com o Suporte\n*11* Falar com o Financeiro\n*12* Ser loja parceira (Comercial)\n\nPagou por fora? Mande a *foto do comprovante* aqui. Digite *0* para ver este menu.';
const MENU_ES = '¡Hola! Estás hablando con *NexumCell*. Responde con el número:\n\n*1* Pagar mi cuota (link de PIX)\n*2* Mi contrato en PDF\n*3* Cómo pagar y usar la app (con imágenes)\n*4* Renegociar atraso o cancelar la deuda\n*5* Celular bloqueado: liberar 20 min para pagar\n*6* Cambiar el día de vencimiento\n*7* Celular robado, hurtado o perdido\n*8* Mis pedidos y declaración de pago total\n*9* Comprar otro celular · Recomienda y gana\n*10* Hablar con Soporte\n*11* Hablar con Financiero\n*12* Ser tienda asociada (Comercial)\n\n¿Pagaste por fuera? Envía aquí la *foto del comprobante*. Escribe *0* para ver este menú.';
const FILA_OPC = { '10': 'suporte', '11': 'financeiro', '12': 'comercial' };
const AUTO_OPC = { '1': 'pagar', '2': 'contrato', '3': 'guia', '4': 'acordo', '5': 'liberar', '6': 'vencimento', '7': 'roubo', '8': 'pedidos', '9': 'comprar' };
let _cfg = null;
async function cfgSistema() { if (_cfg && _cfg.em > Date.now() - 300e3) return _cfg.d; let d = {}; try { d = (await db.collection('config').doc('sistema').get()).data() || {}; } catch (e) { } _cfg = { em: Date.now(), d }; return d; }
const NOME_FILA = { suporte: 'Suporte', financeiro: 'Financeiro', comercial: 'Comercial' };

async function status(d) { await st.set({ ...d, vivoEm: Date.now(), versao: VERSAO }, { merge: true }).catch((e) => console.error('status', e.message)); }
setInterval(() => status({}), 60e3);
st.onSnapshot((s) => { robo = s.data()?.robo !== false; });

async function acharCliente(numero) {
  const t = so(numero).replace(/^55(?=\d{10,11}$)/, '');
  try { const q = await db.collection('clientes').where('telefones', 'array-contains', t).limit(1).get(); if (!q.empty) return { cpf: q.docs[0].id, nome: q.docs[0].data().nome || '' }; } catch (e) { }
  return null;
}

const CRM_URL = (process.env.CRM_URL || 'https://nexumrh.github.io/dono/crm/').replace(/\/?$/, '/');
let _chaveIA = null;
async function chaveIA() { if (_chaveIA && _chaveIA.em > Date.now() - 600e3) return _chaveIA.v; let v = process.env.GROQ_API_KEY || '';
  if (!v) try { v = (await db.collection('segredos').doc('ia').get()).data()?.chave || ''; } catch (e) { }
  if (!v) try { v = (await db.collection('config').doc('sistema').get()).data()?.iaChave || ''; } catch (e) { }
  _chaveIA = { em: Date.now(), v }; return v; }
let _modelos = null;
async function modelos() { if (_modelos && _modelos.em > Date.now() - 3600e3) return _modelos.v; const chave = await chaveIA(); if (!chave) return [];
  try { const r = await fetch('https://api.groq.com/openai/v1/models', { headers: { Authorization: 'Bearer ' + chave } }); const ids = ((await r.json()).data || []).filter((m) => m.active !== false).map((m) => m.id); _modelos = { em: Date.now(), v: ids }; return ids; } catch (e) { return []; } }
async function groqChat(msgs, { visao = false, json = false, max = 600 } = {}) {
  const chave = await chaveIA(); if (!chave) throw new Error('sem chave de IA'); const ids = await modelos();
  const pref = visao ? [/llama-4-(scout|maverick)/, /vision/] : [/gpt-oss-120b/, /llama-3\.3-70b/, /gpt-oss-20b/, /llama-4/];
  const modelo = process.env[visao ? 'GROQ_MODELO_VISAO' : 'GROQ_MODELO'] || pref.map((rx) => ids.find((i) => rx.test(i))).find(Boolean) || (visao ? 'meta-llama/llama-4-scout-17b-16e-instruct' : 'llama-3.3-70b-versatile');
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer ' + chave, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: modelo, messages: msgs, temperature: 0, max_tokens: max, ...(json ? { response_format: { type: 'json_object' } } : {}) }) });
  if (!r.ok) throw new Error('IA ' + r.status + ' ' + (await r.text().catch(() => '')).slice(0, 200)); return (await r.json()).choices?.[0]?.message?.content || ''; }
async function lerComprovante(dataUrl) {
  const t = await groqChat([{ role: 'system', content: 'Você lê comprovantes de pagamento brasileiros (Pix, TED, boleto, depósito). Extraia os dados exatamente como aparecem. Não invente: campo que não aparece fica vazio.' },
    { role: 'user', content: [{ type: 'text', text: 'Leia esta imagem e responda em JSON: {"ehComprovante":true|false,"tipo":"PIX|TED|BOLETO|DEPOSITO|OUTRO","valor":0.00,"data":"AAAA-MM-DD","hora":"HH:MM","pagador":"","recebedor":"","banco":"","idTransacao":"código/ID/autenticação","duvidas":"algo estranho (editada, cortada, valor ilegível) ou vazio"}' }, { type: 'image_url', image_url: { url: dataUrl } }] }], { visao: true, json: true, max: 400 });
  return JSON.parse(t); }
const _trad = new Map();
async function paraEspanhol(t) { if (!t || t.length < 2) return t; if (_trad.has(t)) return _trad.get(t);
  try { const r = await groqChat([{ role: 'system', content: 'Traduza a mensagem de WhatsApp do português do Brasil para o espanhol (Paraguai/Argentina), com o mesmo tom. Mantenha exatamente: links, números, valores em R$, *negritos*, quebras de linha e nomes. Responda só com a tradução.' }, { role: 'user', content: t }], { max: 900 });
    const v = r.trim() || t; if (_trad.size > 300) _trad.clear(); _trad.set(t, v); return v; } catch (e) { return t; } }
const idioma = new Map();   // número → 'es' quando o cliente escreve em espanhol
async function idiomaDe(numero) { const n = so(numero); if (!idioma.has(n)) { try { idioma.set(n, (await db.collection('waConversas').doc(n).get()).data()?.idioma || 'pt'); } catch (e) { idioma.set(n, 'pt'); } } return idioma.get(n); }
async function traduz(numero, t) { if (await idiomaDe(numero) !== 'es') return t; if (t === MENU) return MENU_ES; return paraEspanhol(t); }
async function transcrever(buf, tipo) { const chave = await chaveIA(); if (!chave || buf.length > 20e6) return '';
  const fd = new FormData(); fd.append('file', new Blob([buf], { type: tipo.split(';')[0] }), 'audio.ogg'); fd.append('model', 'whisper-large-v3-turbo'); fd.append('language', 'pt'); fd.append('response_format', 'json');
  const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: 'Bearer ' + chave }, body: fd });
  if (!r.ok) { console.error('transcrição', r.status, await r.text().catch(() => '')); return ''; } return String((await r.json()).text || '').trim(); }

async function recebida(m) {
  if (!m.message || m.key.fromMe || m.key.remoteJid.endsWith('@g.us') || m.key.remoteJid === 'status@broadcast') return;
  const end = await enderecoDe(m.key), numero = end.numero; jids.set(numero, end.jid);
  const msg = m.message; let texto = msg.conversation || msg.extendedTextMessage?.text || msg.imageMessage?.caption || msg.documentMessage?.fileName || (msg.audioMessage ? '[áudio]' : msg.imageMessage ? '[foto]' : msg.stickerMessage ? '[figurinha]' : '[mensagem]');
  const ref = db.collection('waConversas').doc(numero), c = (await ref.get()).data() || {}, agora = Date.now();
  const dados = { numero, jid: end.jid, lid: end.lid, ...(end.lidJid ? { lidJid: end.lidJid } : {}), nome: c.nome || m.pushName || '', ultimaMsg: texto.slice(0, 200), ultimaDe: 'cliente', atualizadoEm: agora, naoLido: true, fim: false };
  if (!c.criadoEm) { dados.criadoEm = agora; const cli = await acharCliente(numero); if (cli) Object.assign(dados, { cpf: cli.cpf, nome: cli.nome || dados.nome, cliente: true }); }
  const extra = {};
  // áudio: transcreve com a IA (Groq Whisper) para a equipe ler no CRM
  if (msg.audioMessage) { try { const buf = await downloadMediaMessage(m, 'buffer', {}); const tr = await transcrever(buf, msg.audioMessage.mimetype || 'audio/ogg'); if (tr) { texto = '[áudio] ' + tr; extra.transcrito = true; } } catch (e) { console.error('áudio', e.message); } }
  // foto ou PDF: guarda para o CRM abrir (e ler o comprovante com a IA)
  const midia = msg.imageMessage || (msg.documentMessage && /pdf|image/.test(msg.documentMessage.mimetype || '') ? msg.documentMessage : null);
  if (midia) { try { const buf = await downloadMediaMessage(m, 'buffer', {}); if (buf.length <= 900000) { const tipo = midia.mimetype || 'image/jpeg', nome = midia.fileName || (tipo.includes('pdf') ? 'documento.pdf' : 'foto.jpg');
    const a = await db.collection('crmArquivos').add({ nome, tipo, data: `data:${tipo};base64,${buf.toString('base64')}`, em: agora, por: 'Cliente (WhatsApp)', key: 'wa:' + numero });
    extra.arquivo = { nome, tipo, id: a.id, url: CRM_URL + 'arquivo.html?id=' + a.id }; extra._dataUrl = `data:${tipo};base64,${buf.toString('base64')}`; } } catch (e) { console.error('mídia', e.message); } }
  dados.ultimaMsg = texto.slice(0, 200);
  { const { _dataUrl, ...gravar } = extra; await ref.collection('msgs').add({ de: 'cliente', t: texto, em: agora, id: m.key.id, ...gravar }); }
  // resposta da pesquisa de satisfação (nota de 1 a 5) enviada ao finalizar o atendimento
  if (c.pesquisaEm && agora - c.pesquisaEm < 24 * 3600e3 && /^[1-5]$/.test(texto.trim())) {
    await db.collection('crmAvaliacoes').add({ key: c.pesquisaKey || 'wa:' + numero, nota: +texto.trim(), uid: c.pesquisaUid || '', nome: c.pesquisaAtendente || '', fila: c.pesquisaFila || '', canal: 'wa', numero, em: agora, via: 'whatsapp' });
    await enviarTexto(numero, 'Obrigado pela sua avaliação! A NexumCell agradece.', true);
    await ref.set({ ...dados, naoLido: false, fim: true, pesquisaEm: null }, { merge: true }); return;
  }
  const txt = texto.trim(), aberto = !c.fila || c.fim;
  if (!msg.audioMessage && !midia && txt.length > 3) { const es = ehEspanhol(txt) ? 'es' : (/^(oi|ola|olá|bom dia|boa tarde|boa noite|quero|preciso|obrigad)/i.test(txt) ? 'pt' : ''); if (es && es !== (c.idioma || 'pt')) { dados.idioma = es; idioma.set(numero, es); } }
  // comprovante: a IA lê a foto, confere e libera enquanto o financeiro dá baixa
  if (robo && extra.arquivo && /^image\//.test(extra.arquivo.tipo) && extra._dataUrl) {
    const r = await conferirComprovante(db, { numero, cpf: c.cpf || dados.cpf, dataUrl: extra._dataUrl, arquivo: { id: extra.arquivo.id, url: extra.arquivo.url, nome: extra.arquivo.nome }, ler: lerComprovante, cfg: await cfgSistema() }).catch((e) => { console.error('comprovante', e.message); return null; });
    if (r) { await enviarItens(numero, [{ texto: r.texto }]); await ref.set({ ...dados, ...(r.ok ? { naoLido: false } : { fila: 'financeiro', aguardandoMenu: false }) }, { merge: true }); return; }
  }
  // troca do vencimento: o cliente respondeu o novo dia
  if (c.aguardandoVenc && c.aguardandoVenc.ate > agora && /^(dia\s*)?\d{1,2}$/i.test(txt)) {
    const dia = parseInt(txt.replace(/\D/g, ''), 10);
    if (dia >= 1 && dia <= 28) { await enviarItens(numero, [{ texto: await pedirVencimento(db, c.aguardandoVenc, dia) }]); await ref.set({ ...dados, aguardandoVenc: null, naoLido: true, fila: c.fila || 'financeiro', aguardandoMenu: false }, { merge: true }); return; }
    await enviarTexto(numero, 'Escolha um dia de 1 a 28. Responda só o número.', true); await ref.set(dados, { merge: true }); return;
  }
  // roubo, furto ou perda: o que e onde → CONFIRMO → trava
  if (c.aguardandoRoubo && c.aguardandoRoubo.ate > agora && txt !== '0') {
    const r = await passoRoubo(db, c.aguardandoRoubo, txt); await enviarItens(numero, [{ texto: r.resposta }]);
    await ref.set({ ...dados, aguardandoRoubo: r.pend, ...(r.fila ? { fila: r.fila, aguardandoMenu: false, naoLido: true } : {}) }, { merge: true }); return;
  }
  // renegociação: o cliente respondeu em quantas vezes quer o acordo
  if (c.aguardandoAcordo && c.aguardandoAcordo.ate > agora && /^\d{1,2}(x| vezes)?$/i.test(txt)) {
    const n = parseInt(txt, 10), max = c.aguardandoAcordo.max || 4;
    if (n >= 1 && n <= max) { const r = await pedirAcordo(db, c.aguardandoAcordo, n, await cfgSistema()); await enviarItens(numero, [{ texto: r }]); await ref.set({ ...dados, aguardandoAcordo: null, fila: 'financeiro', aguardandoMenu: false }, { merge: true }); return; }
    await enviarTexto(numero, `Escolha de 1 a ${max} vezes. Responda só o número.`, true); await ref.set(dados, { merge: true }); return;
  }
  // o cliente mandou CPF + nascimento para achar o contrato
  if (c.aguardandoCpf && /\d{3}\.?\d{3}\.?\d{3}-?\d{2}/.test(txt)) {
    const r = await conferirCpf(db, txt);
    if (r.erro) { await enviarTexto(numero, r.erro, true); await ref.set(dados, { merge: true }); return; }
    Object.assign(dados, { cpf: r.cpf, cliente: true, aguardandoCpf: null, ...(r.nome && !c.nome ? { nome: r.nome } : {}) });
    await ref.set(dados, { merge: true }); await autoatender(numero, c.aguardandoCpf, { ...c, ...dados }); return;
  }
  if (robo && txt === '0') { Object.assign(dados, { aguardandoMenu: true, fila: null, fim: false, aguardandoRoubo: null, aguardandoVenc: null, aguardandoAcordo: null, aguardandoCpf: null }); await enviarTexto(numero, MENU, true); await ref.set(dados, { merge: true }); return; }
  if (robo && aberto) {
    const opc = String(parseInt(txt.replace(/[^0-9]/g, ''), 10) || ''), soNumero = /^\*?\d{1,2}\*?$/.test(txt);
    if (soNumero && FILA_OPC[opc] && c.aguardandoMenu) { dados.fila = FILA_OPC[opc]; dados.aguardandoMenu = false; await enviarTexto(numero, `Certo! Você está na fila do *${NOME_FILA[FILA_OPC[opc]]}*. Um atendente da NexumCell responde por aqui em instantes.`, true); }
    else if (soNumero && AUTO_OPC[opc] && c.aguardandoMenu) { await ref.set({ ...dados, naoLido: false }, { merge: true }); await autoatender(numero, AUTO_OPC[opc], { ...c, ...dados }); return; }
    else if (intencao(txt)) { await ref.set({ ...dados, naoLido: false, aguardandoMenu: true }, { merge: true }); await autoatender(numero, intencao(txt), { ...c, ...dados }); return; }
    else if (!c.aguardandoMenu || c.fim) { dados.aguardandoMenu = true; dados.fila = null; await enviarTexto(numero, MENU, true); }
  }
  await ref.set(dados, { merge: true });
}

async function enviarTexto(numero, texto, doRobo) {
  if (!sock) throw new Error('WhatsApp desconectado');
  await sock.sendMessage(await jidDe(numero), { text: await traduz(numero, texto) });
  if (doRobo) await db.collection('waConversas').doc(so(numero)).collection('msgs').add({ de: 'robo', t: texto, em: Date.now() });
}

// envia textos e imagens (guia) e registra na conversa para o CRM ver
async function enviarItens(numero, itens, por) {
  const conv = db.collection('waConversas').doc(so(numero)).collection('msgs');
  for (const it of itens) {
    if (it.imagem) {
      try { await sock.sendMessage(await jidDe(numero), { image: { url: it.imagem.url }, caption: await traduz(numero, it.imagem.legenda || '') }); }
      catch (e) { console.error('imagem', e.message); await sock.sendMessage(await jidDe(numero), { text: (it.imagem.legenda ? it.imagem.legenda + '\n' : '') + it.imagem.url }); }
      await conv.add({ de: 'robo', t: it.imagem.legenda || '', em: Date.now(), por: por || 'Autoatendimento', arquivo: { nome: it.imagem.url.split('/').pop(), tipo: 'image/png', url: it.imagem.url } });
      await new Promise((r) => setTimeout(r, 1200));
    } else if (it.texto) { await sock.sendMessage(await jidDe(numero), { text: await traduz(numero, it.texto) }); await conv.add({ de: 'robo', t: it.texto, em: Date.now(), por: por || 'Autoatendimento' }); }
  }
}
async function autoatender(numero, acao, c, por) {
  if (!sock) throw new Error('WhatsApp desconectado');
  const r = await montar(db, acao, { numero, cpf: c.cpf, c, cfg: await cfgSistema() });
  await enviarItens(numero, r.msgs, por);
  const ult = [...r.msgs].reverse().find((m) => m.texto);
  await db.collection('waConversas').doc(so(numero)).set({ ...r.estado, ...(ult ? { ultimaMsg: ult.texto.slice(0, 200), ultimaDe: 'equipe' } : {}), autoUltima: acao, autoEm: Date.now() }, { merge: true });
}
// anexo da fila: foto ou PDF de verdade (arquivos do CRM vêm do crmArquivos); se falhar, manda o link
async function enviarArquivo(numero, a, texto) {
  let buf = null, tipo = a.tipo || '';
  if (a.id) { try { const d = (await db.collection('crmArquivos').doc(a.id).get()).data(); const m = String(d?.data || '').match(/^data:([^;]+);base64,(.*)$/); if (m) { tipo = m[1]; buf = Buffer.from(m[2], 'base64'); } } catch (e) { } }
  const fonte = buf || (/\.(png|jpe?g|webp|pdf)(\?|$)/i.test(a.url || '') ? { url: a.url } : null);
  if (!tipo && /\.pdf/i.test(a.url || '')) tipo = 'application/pdf'; if (!tipo && fonte) tipo = 'image/png';
  if (fonte && /^image\//.test(tipo)) return sock.sendMessage(await jidDe(numero), { image: fonte, caption: texto || '' });
  if (fonte && /pdf/.test(tipo)) { if (texto) await sock.sendMessage(await jidDe(numero), { text: texto }); return sock.sendMessage(await jidDe(numero), { document: fonte, mimetype: 'application/pdf', fileName: a.nome || 'documento.pdf' }); }
  return sock.sendMessage(await jidDe(numero), { text: (texto ? texto + '\n' : '') + `${a.nome || 'Arquivo'}: ${a.url}` });
}

// fila de saída gravada pelo CRM: uma de cada vez; mensagens em massa respeitam o horário (naoAntes) e um intervalo entre elas
let saidaOcupada = false;
async function processarSaida() {
  if (saidaOcupada || !sock) return; saidaOcupada = true;
  try {
    const s = await db.collection('waSaida').where('status', '==', 'PENDENTE').limit(30).get();
    const docs = s.docs.sort((a, b) => (a.data().em || 0) - (b.data().em || 0));
    for (const d of docs) {
      const x = d.data(); if ((x.naoAntes || 0) > Date.now()) continue;
      try {
        await d.ref.update({ status: 'ENVIANDO' });
        if (x.auto) { const c = (await db.collection('waConversas').doc(so(x.numero)).get()).data() || {}; if (x.cpf && !c.cpf) c.cpf = x.cpf; await autoatender(x.numero, x.auto, c, x.por); }
        else if (x.arquivo?.url) { try { await enviarArquivo(x.numero, x.arquivo, x.texto || ''); } catch (e) { console.error('anexo', e.message); await enviarTexto(x.numero, (x.texto ? x.texto + '\n' : '') + `${x.arquivo.nome}: ${x.arquivo.url}`); } }
        else await enviarTexto(x.numero, x.texto || ' ');
        await d.ref.update({ status: 'ENVIADO', enviadoEm: Date.now() });
        if (x.campanha) await new Promise((r) => setTimeout(r, 10000 + Math.random() * 8000));
      } catch (e) { await d.ref.update({ status: 'ERRO', erro: e.message }).catch(() => {}); }
    }
  } catch (e) { console.error('waSaida', e.message); } finally { saidaOcupada = false; }
}
function ouvirSaida() {
  setInterval(processarSaida, 5000);
  return db.collection('waSaida').where('status', '==', 'PENDENTE').onSnapshot(() => processarSaida(), (e) => console.error('waSaida', e.message));
}

async function conectar() {
  const { state, saveCreds } = await useMultiFileAuthState(path.join(DIR, 'sessao'));
  const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));
  sock = makeWASocket({ auth: state, version, logger: pino({ level: 'silent' }), printQRInTerminal: false, browser: ['NexumCell CRM', 'Chrome', VERSAO] });
  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', async (u) => {
    if (u.qr) { await qrDoc.set({ qr: await QRCode.toDataURL(u.qr, { margin: 1, width: 320 }), em: Date.now() }); await status({ status: 'qr' }); console.log('QR code novo: leia pelo CRM → WhatsApp'); }
    if (u.connection === 'open') { numeroConectado = so(sock.user?.id?.split(':')[0]); await qrDoc.set({ qr: null, em: Date.now() }); await status({ status: 'conectado', numero: numeroConectado, nome: sock.user?.name || '', conectadoEm: Date.now() }); console.log('Conectado:', numeroConectado); }
    if (u.connection === 'close') {
      const cod = u.lastDisconnect?.error?.output?.statusCode;
      await status({ status: 'desconectado' });
      if (cod === DisconnectReason.loggedOut) { fs.rmSync(path.join(DIR, 'sessao'), { recursive: true, force: true }); console.log('Desconectado pelo celular. Gerando QR novo…'); }
      setTimeout(conectar, 3000);
    }
  });
  sock.ev.on('messages.upsert', async ({ messages, type }) => { if (type !== 'notify') return; for (const m of messages) await recebida(m).catch((e) => console.error('recebida', e.message)); });
}

db.doc('plataforma/waWebCmd').onSnapshot(async (s) => {
  const c = s.data(); if (!c || !c.em || c.em < Date.now() - 60e3 || c.feito) return;
  await s.ref.set({ feito: true }, { merge: true });
  if (c.cmd === 'desconectar' || c.cmd === 'novoqr') { try { await sock?.logout(); } catch (e) { } fs.rmSync(path.join(DIR, 'sessao'), { recursive: true, force: true }); setTimeout(conectar, 1500); }
});

console.log(`NexumCell WhatsApp ${VERSAO} — deixe esta janela aberta.`);
await status({ status: 'iniciando' });
ouvirSaida();
conectar();
