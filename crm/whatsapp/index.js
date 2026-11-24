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

const VERSAO = '1.1';
import { montar, pedirAcordo, conferirCpf, intencao } from './autoatendimento.js';
const DIR = path.dirname(fileURLToPath(import.meta.url));
const arqConta = path.join(DIR, 'conta-servico.json');
if (!fs.existsSync(arqConta)) { console.error('Falta o arquivo conta-servico.json nesta pasta. Veja o LEIA-ME.'); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(arqConta, 'utf8'))) });
const db = admin.firestore();
const st = db.doc('plataforma/waWebStatus'), qrDoc = db.doc('plataforma/waWebQr');
const makeWASocket = baileys.default || baileys;
let sock = null, numeroConectado = '', robo = true;

const so = (s) => String(s || '').replace(/\D/g, '');
const jidDe = (n) => so(n) + '@s.whatsapp.net';
const MENU = 'Olá! Você está falando com a *NexumCell*. Responda com o número:\n\n*1* Pagar minha parcela (link do PIX)\n*2* Meu contrato em PDF\n*3* Como pagar e usar o app (com imagens)\n*4* Renegociar atraso ou quitar\n*5* Celular travado: liberar 20 min para pagar\n*6* Falar com o Suporte\n*7* Falar com o Financeiro\n*8* Comprar celular ou ser loja parceira\n\nDigite *0* a qualquer momento para ver este menu.';
const FILA_OPC = { '6': 'suporte', '7': 'financeiro', '8': 'comercial' };
const AUTO_OPC = { '1': 'pagar', '2': 'contrato', '3': 'guia', '4': 'acordo', '5': 'liberar' };
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
async function transcrever(buf, tipo) { const chave = await chaveIA(); if (!chave || buf.length > 20e6) return '';
  const fd = new FormData(); fd.append('file', new Blob([buf], { type: tipo.split(';')[0] }), 'audio.ogg'); fd.append('model', 'whisper-large-v3-turbo'); fd.append('language', 'pt'); fd.append('response_format', 'json');
  const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: 'Bearer ' + chave }, body: fd });
  if (!r.ok) { console.error('transcrição', r.status, await r.text().catch(() => '')); return ''; } return String((await r.json()).text || '').trim(); }

async function recebida(m) {
  if (!m.message || m.key.fromMe || m.key.remoteJid.endsWith('@g.us') || m.key.remoteJid === 'status@broadcast') return;
  const numero = so(m.key.remoteJid.split('@')[0]);
  const msg = m.message; let texto = msg.conversation || msg.extendedTextMessage?.text || msg.imageMessage?.caption || msg.documentMessage?.fileName || (msg.audioMessage ? '[áudio]' : msg.imageMessage ? '[foto]' : msg.stickerMessage ? '[figurinha]' : '[mensagem]');
  const ref = db.collection('waConversas').doc(numero), c = (await ref.get()).data() || {}, agora = Date.now();
  const dados = { numero, nome: c.nome || m.pushName || '', ultimaMsg: texto.slice(0, 200), ultimaDe: 'cliente', atualizadoEm: agora, naoLido: true, fim: false };
  if (!c.criadoEm) { dados.criadoEm = agora; const cli = await acharCliente(numero); if (cli) Object.assign(dados, { cpf: cli.cpf, nome: cli.nome || dados.nome, cliente: true }); }
  const extra = {};
  // áudio: transcreve com a IA (Groq Whisper) para a equipe ler no CRM
  if (msg.audioMessage) { try { const buf = await downloadMediaMessage(m, 'buffer', {}); const tr = await transcrever(buf, msg.audioMessage.mimetype || 'audio/ogg'); if (tr) { texto = '[áudio] ' + tr; extra.transcrito = true; } } catch (e) { console.error('áudio', e.message); } }
  // foto ou PDF: guarda para o CRM abrir (e ler o comprovante com a IA)
  const midia = msg.imageMessage || (msg.documentMessage && /pdf|image/.test(msg.documentMessage.mimetype || '') ? msg.documentMessage : null);
  if (midia) { try { const buf = await downloadMediaMessage(m, 'buffer', {}); if (buf.length <= 900000) { const tipo = midia.mimetype || 'image/jpeg', nome = midia.fileName || (tipo.includes('pdf') ? 'documento.pdf' : 'foto.jpg');
    const a = await db.collection('crmArquivos').add({ nome, tipo, data: `data:${tipo};base64,${buf.toString('base64')}`, em: agora, por: 'Cliente (WhatsApp)', key: 'wa:' + numero });
    extra.arquivo = { nome, tipo, id: a.id, url: CRM_URL + 'arquivo.html?id=' + a.id }; } } catch (e) { console.error('mídia', e.message); } }
  dados.ultimaMsg = texto.slice(0, 200);
  await ref.collection('msgs').add({ de: 'cliente', t: texto, em: agora, id: m.key.id, ...extra });
  // resposta da pesquisa de satisfação (nota de 1 a 5) enviada ao finalizar o atendimento
  if (c.pesquisaEm && agora - c.pesquisaEm < 24 * 3600e3 && /^[1-5]$/.test(texto.trim())) {
    await db.collection('crmAvaliacoes').add({ key: c.pesquisaKey || 'wa:' + numero, nota: +texto.trim(), uid: c.pesquisaUid || '', nome: c.pesquisaAtendente || '', fila: c.pesquisaFila || '', canal: 'wa', numero, em: agora, via: 'whatsapp' });
    await enviarTexto(numero, 'Obrigado pela sua avaliação! A NexumCell agradece.', true);
    await ref.set({ ...dados, naoLido: false, fim: true, pesquisaEm: null }, { merge: true }); return;
  }
  const txt = texto.trim(), aberto = !c.fila || c.fim;
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
  if (robo && txt === '0') { dados.aguardandoMenu = true; dados.fila = null; dados.fim = false; await enviarTexto(numero, MENU, true); await ref.set(dados, { merge: true }); return; }
  if (robo && aberto) {
    const opc = txt.replace(/[^0-9]/g, '').slice(0, 1), soNumero = /^\*?\d\*?$/.test(txt);
    if (soNumero && FILA_OPC[opc] && c.aguardandoMenu) { dados.fila = FILA_OPC[opc]; dados.aguardandoMenu = false; await enviarTexto(numero, `Certo! Você está na fila do *${NOME_FILA[FILA_OPC[opc]]}*. Um atendente da NexumCell responde por aqui em instantes.`, true); }
    else if (soNumero && AUTO_OPC[opc] && c.aguardandoMenu) { await ref.set({ ...dados, naoLido: false }, { merge: true }); await autoatender(numero, AUTO_OPC[opc], { ...c, ...dados }); return; }
    else if (intencao(txt)) { await ref.set({ ...dados, naoLido: false, aguardandoMenu: true }, { merge: true }); await autoatender(numero, intencao(txt), { ...c, ...dados }); return; }
    else if (!c.aguardandoMenu || c.fim) { dados.aguardandoMenu = true; dados.fila = null; await enviarTexto(numero, MENU, true); }
  }
  await ref.set(dados, { merge: true });
}

async function enviarTexto(numero, texto, doRobo) {
  if (!sock) throw new Error('WhatsApp desconectado');
  await sock.sendMessage(jidDe(numero), { text: texto });
  if (doRobo) await db.collection('waConversas').doc(so(numero)).collection('msgs').add({ de: 'robo', t: texto, em: Date.now() });
}

// envia textos e imagens (guia) e registra na conversa para o CRM ver
async function enviarItens(numero, itens, por) {
  const conv = db.collection('waConversas').doc(so(numero)).collection('msgs');
  for (const it of itens) {
    if (it.imagem) {
      try { await sock.sendMessage(jidDe(numero), { image: { url: it.imagem.url }, caption: it.imagem.legenda || '' }); }
      catch (e) { console.error('imagem', e.message); await sock.sendMessage(jidDe(numero), { text: (it.imagem.legenda ? it.imagem.legenda + '\n' : '') + it.imagem.url }); }
      await conv.add({ de: 'robo', t: it.imagem.legenda || '', em: Date.now(), por: por || 'Autoatendimento', arquivo: { nome: it.imagem.url.split('/').pop(), tipo: 'image/png', url: it.imagem.url } });
      await new Promise((r) => setTimeout(r, 1200));
    } else if (it.texto) { await sock.sendMessage(jidDe(numero), { text: it.texto }); await conv.add({ de: 'robo', t: it.texto, em: Date.now(), por: por || 'Autoatendimento' }); }
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
  if (fonte && /^image\//.test(tipo)) return sock.sendMessage(jidDe(numero), { image: fonte, caption: texto || '' });
  if (fonte && /pdf/.test(tipo)) { if (texto) await sock.sendMessage(jidDe(numero), { text: texto }); return sock.sendMessage(jidDe(numero), { document: fonte, mimetype: 'application/pdf', fileName: a.nome || 'documento.pdf' }); }
  return sock.sendMessage(jidDe(numero), { text: (texto ? texto + '\n' : '') + `${a.nome || 'Arquivo'}: ${a.url}` });
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
