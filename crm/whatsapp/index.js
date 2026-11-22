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
import baileys, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';

const VERSAO = '1.0';
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
const MENU = 'Olá! Você está falando com a *NexumCell*. Para agilizar, responda com o número:\n\n*1* Suporte (aparelho, trava, app)\n*2* Financeiro (parcelas, pagamento, liberação)\n*3* Quero comprar um celular ou ser loja parceira';
const FILA_OPC = { '1': 'suporte', '2': 'financeiro', '3': 'comercial' };
const NOME_FILA = { suporte: 'Suporte', financeiro: 'Financeiro', comercial: 'Comercial' };

async function status(d) { await st.set({ ...d, vivoEm: Date.now(), versao: VERSAO }, { merge: true }).catch((e) => console.error('status', e.message)); }
setInterval(() => status({}), 60e3);
st.onSnapshot((s) => { robo = s.data()?.robo !== false; });

async function acharCliente(numero) {
  const t = so(numero).replace(/^55(?=\d{10,11}$)/, '');
  try { const q = await db.collection('clientes').where('telefones', 'array-contains', t).limit(1).get(); if (!q.empty) return { cpf: q.docs[0].id, nome: q.docs[0].data().nome || '' }; } catch (e) { }
  return null;
}

async function recebida(m) {
  if (!m.message || m.key.fromMe || m.key.remoteJid.endsWith('@g.us') || m.key.remoteJid === 'status@broadcast') return;
  const numero = so(m.key.remoteJid.split('@')[0]);
  const msg = m.message, texto = msg.conversation || msg.extendedTextMessage?.text || msg.imageMessage?.caption || msg.documentMessage?.fileName || (msg.audioMessage ? '[áudio]' : msg.imageMessage ? '[foto]' : msg.stickerMessage ? '[figurinha]' : '[mensagem]');
  const ref = db.collection('waConversas').doc(numero), c = (await ref.get()).data() || {}, agora = Date.now();
  const dados = { numero, nome: c.nome || m.pushName || '', ultimaMsg: texto.slice(0, 200), ultimaDe: 'cliente', atualizadoEm: agora, naoLido: true, fim: false };
  if (!c.criadoEm) { dados.criadoEm = agora; const cli = await acharCliente(numero); if (cli) Object.assign(dados, { cpf: cli.cpf, nome: cli.nome || dados.nome, cliente: true }); }
  await ref.collection('msgs').add({ de: 'cliente', t: texto, em: agora, id: m.key.id });
  // robô de triagem: conversa nova (ou finalizada) pergunta a fila; a resposta 1/2/3 escolhe
  if (robo && (!c.fila || c.fim)) {
    const opc = FILA_OPC[texto.trim().slice(0, 1)];
    if (opc && c.aguardandoMenu) { dados.fila = opc; dados.aguardandoMenu = false; await enviarTexto(numero, `Certo! Você está na fila do *${NOME_FILA[opc]}*. Um atendente da NexumCell responde por aqui em instantes.`, true); }
    else if (!c.aguardandoMenu || c.fim) { dados.aguardandoMenu = true; dados.fila = null; await enviarTexto(numero, MENU, true); }
  }
  await ref.set(dados, { merge: true });
}

async function enviarTexto(numero, texto, doRobo) {
  if (!sock) throw new Error('WhatsApp desconectado');
  await sock.sendMessage(jidDe(numero), { text: texto });
  if (doRobo) await db.collection('waConversas').doc(so(numero)).collection('msgs').add({ de: 'robo', t: texto, em: Date.now() });
}

// fila de saída gravada pelo CRM
function ouvirSaida() {
  return db.collection('waSaida').where('status', '==', 'PENDENTE').onSnapshot(async (s) => {
    for (const d of s.docs) {
      const x = d.data();
      try {
        await d.ref.update({ status: 'ENVIANDO' });
        let t = x.texto || ''; if (x.arquivo?.url) t = (t ? t + '\n' : '') + `📎 ${x.arquivo.nome}: ${x.arquivo.url}`;
        await enviarTexto(x.numero, t || ' ');
        await d.ref.update({ status: 'ENVIADO', enviadoEm: Date.now() });
      } catch (e) { await d.ref.update({ status: 'ERRO', erro: e.message }).catch(() => {}); }
    }
  }, (e) => console.error('waSaida', e.message));
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
