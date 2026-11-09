// Credenciamento de loja parceira (link público do Portal do Gerente: ?credenciamento).
// A loja (empresa que contrata a NexumCell) manda os dados; o servidor grava em solicitacoesLoja
// e avisa o Dono por e-mail. Só o Dono aprova: ele cria a loja e o login do gerente no Painel do Dono.
// POST /api/credenciamento {"acao":"enviar", ...dados}
// POST /api/credenciamento {"acao":"ver","id":".."} → situação
import { db, cors, hoje } from './_base.js';
import { enviarEmail, brevoLigado } from './_brevo.js';

const dig = (s) => String(s || '').replace(/\D/g, '');
const txt = (s, n) => String(s ?? '').replace(/[<>]/g, '').trim().slice(0, n);
const erro = (msg, status = 400) => Object.assign(new Error(msg), { status });
export function cnpjOk(c) {
  c = dig(c); if (c.length !== 14 || /^(\d)\1+$/.test(c)) return false;
  const calc = (n) => { const w = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]; const s = w.reduce((a, x, i) => a + x * +c[i], 0) % 11; return s < 2 ? 0 : 11 - s; };
  return calc(12) === +c[12] && calc(13) === +c[13];
}
export function cpfOk(c) {
  c = dig(c); if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false;
  for (const t of [9, 10]) { let s = 0; for (let i = 0; i < t; i++) s += +c[i] * (t + 1 - i); if ((s * 10) % 11 % 10 !== +c[t]) return false; }
  return true;
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const b = req.body || {};
    if (b.acao === 'enviar') {
      const cnpj = dig(b.cnpj), cpf = dig(b.respCpf), tel = dig(b.telefone), rtel = dig(b.respTelefone), email = txt(b.respEmail, 120).toLowerCase();
      if (!cnpjOk(cnpj)) throw erro('CNPJ inválido.');
      if (!cpfOk(cpf)) throw erro('CPF do responsável inválido.');
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw erro('E-mail do responsável inválido.');
      if (tel.length < 10 || tel.length > 11 || rtel.length < 10 || rtel.length > 11) throw erro('Telefones com DDD.');
      const razao = txt(b.razao, 140), fantasia = txt(b.fantasia, 80), resp = txt(b.respNome, 120), cidade = txt(b.cidade, 60);
      if (razao.length < 3 || fantasia.length < 2 || resp.length < 5 || cidade.length < 2) throw erro('Preencha razão social, nome da loja, cidade e o nome do responsável.');
      if (b.aceite !== true) throw erro('Aceite os termos para continuar.');
      // uma solicitação por CNPJ: reenviar só depois de recusada
      const ref = db.collection('solicitacoesLoja').doc('cnpj_' + cnpj), s = await ref.get();
      if (s.exists && ['PENDENTE', 'APROVADA'].includes(s.data().status)) throw erro(s.data().status === 'APROVADA' ? 'Esta empresa já é parceira. Fale com a NexumCell.' : 'Já recebemos o pedido desta empresa. Aguarde o contato da NexumCell.', 409);
      const dados = {
        cnpj, razao, fantasia, cidade, uf: txt(b.uf, 2).toUpperCase(), endereco: txt(b.endereco, 200), cep: dig(b.cep).slice(0, 8), telefone: tel,
        respNome: resp, respCpf: cpf, respEmail: email, respTelefone: rtel, vendedoresPrevistos: Math.max(0, Math.min(200, Number(b.vendedores) || 0)),
        obs: txt(b.obs, 500), aceite: true, status: 'PENDENTE', criadoEm: Date.now(), dia: hoje(), via: 'servidor',
      };
      await ref.set(dados);
      if (brevoLigado() && process.env.DONO_EMAIL) {
        try { await enviarEmail({ para: process.env.DONO_EMAIL, assunto: 'Nova loja pedindo credenciamento — ' + fantasia, titulo: 'Nova loja para aprovar',
          texto: `${fantasia} (${razao})\nCNPJ ${cnpj} · ${cidade}${dados.uf ? '/' + dados.uf : ''}\nResponsável: ${resp} · ${email} · ${rtel}\n\nAprove ou recuse no Painel do Dono → Lojas parceiras.` }); } catch (e) { console.error('aviso dono', e.message); }
      }
      return res.status(200).json({ id: ref.id, status: 'PENDENTE' });
    }
    if (b.acao === 'ver') {
      const id = String(b.id || '');
      if (!/^cnpj_\d{14}$/.test(id)) throw erro('Pedido não encontrado.', 404);
      const s = await db.collection('solicitacoesLoja').doc(id).get();
      if (!s.exists) throw erro('Pedido não encontrado.', 404);
      const x = s.data();
      return res.status(200).json({ id, fantasia: x.fantasia, status: x.status, resposta: x.resposta || '', criadoEm: x.criadoEm });
    }
    return res.status(400).json({ erro: 'ação desconhecida' });
  } catch (e) {
    console.error(e);
    return res.status(e.status || 500).json({ erro: e.status ? e.message : 'Não foi possível enviar agora. Tente de novo.' });
  }
}
