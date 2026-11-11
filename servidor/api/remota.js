// Venda a distância: o cliente manda documento, selfie e dados pelo próprio celular (link do vendedor).
// POST /api/remota {"acao":"ver","token":"..."}           → dados básicos da proposta
// POST /api/remota {"acao":"enviar","token":"...", dados, frente, verso, selfie} → grava e manda para análise (roda o motor)
import { db, cors, hoje } from './_base.js';
import { avaliarVenda } from './motor.js';

const dig = (s) => String(s || '').replace(/\D/g, '');
const txt = (s, n) => String(s ?? '').replace(/[<>]/g, '').trim().slice(0, n);
const erro = (m, s = 400) => Object.assign(new Error(m), { status: s });
const img = (x) => { x = String(x || ''); if (!/^data:image\/(jpeg|png|webp);base64,/.test(x)) return ''; if (x.length > 320000) throw erro('Foto grande demais. Tente de novo.'); return x; };
function cpfOk(c) { c = dig(c); if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false; for (const t of [9, 10]) { let s = 0; for (let i = 0; i < t; i++) s += +c[i] * (t + 1 - i); if ((s * 10) % 11 % 10 !== +c[t]) return false; } return true; }

async function acharVenda(token) {
  if (!/^[A-Za-z0-9]{20,40}$/.test(String(token || ''))) throw erro('Link inválido.', 404);
  const q = (await db.collection('vendas').where('remota.token', '==', token).get()).docs;
  if (!q.length) throw erro('Link inválido ou já usado.', 404);
  const d = q[0], v = d.data();
  if (Date.now() - (v.remota?.criadoEm || 0) > 7 * 86400000) throw erro('Este link venceu. Peça um novo ao vendedor.', 410);
  return { id: d.id, v };
}
export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const b = req.body || {};
    const { id, v } = await acharVenda(b.token);
    if (b.acao === 'ver') return res.status(200).json({ numero: v.numero, nome: v.clienteNome || '', loja: v.lojaNome || '', vendedor: v.vendedorNome || '', status: v.status, enviado: v.status !== 'REMOTA' });
    if (b.acao === 'enviar') {
      if (v.status !== 'REMOTA') throw erro('Esta proposta já foi enviada. Aguarde o contato da loja.', 409);
      const d = b.dados || {}, cpf = dig(d.cpf);
      if (!cpfOk(cpf)) throw erro('CPF inválido.');
      if (txt(d.nome, 120).split(' ').length < 2 || !/^\d{4}-\d{2}-\d{2}$/.test(d.nasc || '')) throw erro('Informe o nome completo e a data de nascimento.');
      if (txt(d.mae, 120).split(' ').length < 2) throw erro('Informe o nome completo da mãe.');
      const tel = dig(d.telefone); if (tel.length < 10) throw erro('WhatsApp com DDD.');
      if (!(+d.renda > 0)) throw erro('Informe a renda mensal.');
      for (const k of ['cpf_' + cpf, 'tel_' + tel]) { const ln = await db.collection('listanegra').doc(k).get(); if (ln.exists) throw erro('Não foi possível seguir com a proposta. Procure a loja.', 403); }
      if (b.aceite !== true) throw erro('Aceite os termos para continuar.');
      const frente = img(b.frente), verso = img(b.verso), selfie = img(b.selfie);
      if (!frente || !selfie) throw erro('Envie a foto da frente do documento e a selfie.');
      const agora = Date.now(), tel2 = dig(d.telefone2), refNome = txt(d.ref1Nome, 80);
      if (tel2 && tel2 === tel) throw erro('O telefone da referência precisa ser de outra pessoa.');
      const fone = (t) => t.length === 11 ? `(${t.slice(0, 2)}) ${t.slice(2, 7)}-${t.slice(7)}` : `(${t.slice(0, 2)}) ${t.slice(2, 6)}-${t.slice(6)}`;
      const cliente = { ...(v.cliente || {}), cpf, nome: txt(d.nome, 120), nasc: d.nasc, rg: txt(d.rg, 30), orgao: txt(d.orgao, 20), mae: txt(d.mae, 120), docTipo: txt(d.docTipo, 5) || 'RG',
        tel: fone(tel), telefones: [tel, ...(tel2.length >= 10 && !refNome ? [tel2] : [])], ...(tel2.length >= 10 && refNome ? { referencias: [{ tel: tel2, nome: refNome, parentesco: txt(d.ref1Par, 40) }], refNome, refTel: fone(tel2) } : {}), nacionalidade: txt(d.nacionalidade, 40), email: txt(d.email, 120).toLowerCase(),
        cep: dig(d.cep).slice(0, 8), endereco: txt(d.endereco, 160), bairro: txt(d.bairro, 80), cidade: txt(d.cidade, 60), uf: txt(d.uf, 2).toUpperCase(), renda: +d.renda, profissao: txt(d.profissao, 80), lgpdAceiteEm: agora, remoto: true };
      // telefone já usado por outro cliente
      for (const t of cliente.telefones) {
        const o = (await db.collection('clientes').where('telefones', 'array-contains', t).get()).docs.filter((x) => x.id !== cpf);
        if (o.length) throw erro('Este telefone já está cadastrado para outra pessoa. Use o seu número.');
      }
      await db.collection('docs').doc(id).set({ vendaId: id, cpf, docTipo: cliente.docTipo, docDigital: d.docDigital === true, frente, verso, selfie, criadoEm: agora, vendedorUid: v.vendedorUid, via: 'remota' });
      await db.collection('clientes').doc(cpf).set({ ...cliente, atualizadoEm: agora }, { merge: true });
      await db.collection('vendas').doc(id).set({ status: 'ANALISE', clienteCpf: cpf, clienteNome: cliente.nome, cliente,
        verificacao: { remota: true, docTipo: cliente.docTipo, docDigital: d.docDigital === true, iaLeitura: false, documentoOriginal: true, editados: [], face: null, obs: 'Enviado pelo cliente a distância: confira documento e selfie com atenção.' },
        confirmacaoDados: { status: 'PENDENTE', prazo: agora + 3 * 86400000 },
        remota: { ...v.remota, enviadoEm: agora, ip: req.headers['cf-connecting-ip'] || '' } }, { merge: true });
      await db.collection('logs').add({ em: Date.now(), acao: 'Cliente enviou a proposta a distância', alvo: id, det: `nº ${v.numero} · ${cliente.nome}`, por: 'Cliente' });
      try { await avaliarVenda(id); } catch (e) { console.warn('motor', e.message); }
      return res.status(200).json({ ok: true, numero: v.numero });
    }
    return res.status(400).json({ erro: 'ação desconhecida' });
  } catch (e) { console.error(e); return res.status(e.status || 500).json({ erro: e.status ? e.message : 'Não foi possível enviar agora. Tente de novo.' }); }
}
