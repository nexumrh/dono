// Ouvidoria NexumCell: reclamações, denúncias, sugestões e elogios, com protocolo e prazo de resposta.
// POST /api/ouvidoria {acao:'abrir', nome, cpf, telefone, email, tipo, assunto, relato}   público
// POST /api/ouvidoria {acao:'consultar', protocolo, cpfFim}                              público
// POST /api/ouvidoria {acao:'responder', protocolo, resposta, status}                    equipe (dono, financeiro, suporte)
import { db, cors, exigirEquipe } from './_base.js';
import { brevoLigado, enviarEmail } from './_brevo.js';

const PRAZO_UTEIS = 10;
const soD = (s) => String(s || '').replace(/\D/g, '');
const txt = (s, n) => String(s || '').replace(/[<>]/g, '').trim().slice(0, n);
const erro = (m, s = 400) => Object.assign(new Error(m), { status: s });
const TIPOS = ['RECLAMACAO', 'DENUNCIA', 'SUGESTAO', 'ELOGIO', 'LGPD'];
function maisUteis(d, n) { const x = new Date(d); while (n > 0) { x.setDate(x.getDate() + 1); if (x.getDay() !== 0 && x.getDay() !== 6) n--; } return x.toISOString().slice(0, 10); }
function cpfOk(c) { c = soD(c); if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false; for (let t = 9; t < 11; t++) { let s = 0; for (let i = 0; i < t; i++) s += +c[i] * (t + 1 - i); if (((s * 10) % 11) % 10 !== +c[t]) return false; } return true; }

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    const b = req.body || {};
    if (b.acao === 'abrir') {
      const cpf = soD(b.cpf), nome = txt(b.nome, 100), relato = txt(b.relato, 4000), tipo = TIPOS.includes(b.tipo) ? b.tipo : 'RECLAMACAO';
      if (nome.length < 3) throw erro('Informe o seu nome.'); if (!cpfOk(cpf)) throw erro('CPF inválido.'); if (relato.length < 15) throw erro('Conte o que aconteceu (pelo menos 15 letras).');
      if (soD(b.telefone).length < 10 && !/@/.test(b.email || '')) throw erro('Informe um WhatsApp ou e-mail para a resposta.');
      const ini = Date.now() - 864e5, doDia = (await db.collection('ouvidoria').where('cpf', '==', cpf).get()).docs.filter((d) => (d.data().em || 0) >= ini).length;
      if (doDia >= 3) throw erro('Você já abriu protocolos hoje. Aguarde a resposta.', 429);
      const protocolo = 'OUV' + new Date().toISOString().slice(2, 10).replace(/-/g, '') + String(Math.floor(Math.random() * 1e5)).padStart(5, '0');
      const doc = { protocolo, cpf, nome, telefone: soD(b.telefone).slice(0, 13), email: txt(b.email, 120), tipo, assunto: txt(b.assunto, 120), relato, status: 'ABERTO', em: Date.now(), prazo: maisUteis(new Date(), PRAZO_UTEIS), historico: [{ em: Date.now(), por: 'Cliente', obs: 'Protocolo aberto' }], ip: req.headers['cf-connecting-ip'] || '' };
      await db.collection('ouvidoria').doc(protocolo).set(doc);
      try { if (brevoLigado() && process.env.DONO_EMAIL) await enviarEmail({ para: process.env.DONO_EMAIL, assunto: `Ouvidoria ${protocolo}: ${tipo.toLowerCase()} de ${nome}`, titulo: 'Novo protocolo na ouvidoria', texto: `${nome} (CPF final ${cpf.slice(-3)})\nTipo: ${tipo}\nAssunto: ${doc.assunto}\n\n${relato}\n\nPrazo de resposta: ${doc.prazo.split('-').reverse().join('/')}` }); } catch (e) { }
      return res.json({ protocolo, prazo: doc.prazo });
    }
    if (b.acao === 'consultar') {
      const p = (await db.collection('ouvidoria').doc(txt(b.protocolo, 20).toUpperCase()).get()).data();
      if (!p || p.cpf.slice(-4) !== soD(b.cpfFim)) throw erro('Protocolo não encontrado. Confira o número e os 4 últimos dígitos do CPF.', 404);
      return res.json({ protocolo: p.protocolo, status: p.status, prazo: p.prazo, tipo: p.tipo, assunto: p.assunto, em: p.em, resposta: p.resposta || '', respondidoEm: p.respondidoEm || null });
    }
    if (b.acao === 'responder') {
      const eu = await exigirEquipe(req, ['DONO', 'FINANCEIRO', 'SUPORTE']);
      const ref = db.collection('ouvidoria').doc(txt(b.protocolo, 20)), p = (await ref.get()).data(); if (!p) throw erro('Protocolo não encontrado', 404);
      const status = ['EM_ANALISE', 'RESPONDIDO', 'ENCERRADO'].includes(b.status) ? b.status : 'RESPONDIDO', resposta = txt(b.resposta, 4000);
      await ref.set({ status, ...(resposta ? { resposta, respondidoEm: Date.now(), respondidoPor: eu.nome } : {}), historico: [...(p.historico || []), { em: Date.now(), por: eu.nome, obs: status + (resposta ? ': ' + resposta.slice(0, 200) : '') }] }, { merge: true });
      return res.json({ ok: true });
    }
    throw erro('ação inválida');
  } catch (e) { return res.status(e.status || 500).json({ erro: e.message }); }
}
