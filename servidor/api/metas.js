// App Minhas Metas: entrada do funcionário pelo CPF.
// O gerente (ou o dono) cadastra a pessoa com CPF e data de nascimento em metasPessoas/{escopo}_{cpf}.
// POST /api/metas {acao:'status', cpf}               → {existe, ativado, nome}
// POST /api/metas {acao:'ativar', cpf, nasc, senha}  → cria (ou troca) a senha e devolve o e-mail interno do login
// O login usa o Firebase Auth com o e-mail interno {cpf}@metas.nexumcell.app.
import { db, auth, cors, hoje } from './_base.js';

const soD = (s) => String(s || '').replace(/\D/g, '');
const cpfOk = (c) => { c = soD(c); if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false; for (const t of [9, 10]) { let s = 0; for (let i = 0; i < t; i++) s += +c[i] * (t + 1 - i); if (((s * 10) % 11) % 10 !== +c[t]) return false; } return true; };
const erro = (m, s = 400) => Object.assign(new Error(m), { status: s });

async function pessoaDo(cpf) {
  const l = (await db.collection('metasPessoas').where('cpf', '==', cpf).get()).docs.map((d) => ({ id: d.id, ref: d.ref, ...d.data() })).filter((p) => p.ativo !== false);
  return l.sort((a, b) => (b.atualizadoEm || 0) - (a.atualizadoEm || 0))[0] || null;
}
async function limitar(chave, max = 6) {
  const ref = db.collection('metasTentativas').doc(chave), d = (await ref.get()).data() || {}, agora = Date.now();
  const n = d.desde > agora - 15 * 60e3 ? (d.n || 0) : 0;
  if (n >= max) throw erro('Muitas tentativas. Espere 15 minutos e tente de novo.', 429);
  await ref.set({ n: n + 1, desde: n ? d.desde : agora }, { merge: true });
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    const b = req.body || {}, cpf = soD(b.cpf);
    if (!cpfOk(cpf)) throw erro('CPF inválido.');
    if (b.acao === 'status') {
      const ip = String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || 'x').split(',')[0].trim();
      await limitar('ip_' + ip.replace(/[^\w]/g, '_') + '_' + hoje(), 60);
      const p = await pessoaDo(cpf);
      if (!p) return res.json({ existe: false });
      return res.json({ existe: true, ativado: !!(p.ativado && p.uid), nome: String(p.nome || '').split(' ')[0] });
    }
    if (b.acao === 'ativar') {
      await limitar('cpf_' + cpf);
      const p = await pessoaDo(cpf); if (!p) throw erro('CPF não cadastrado. Peça ao seu gerente para cadastrar você nas metas.', 404);
      if (p.ativado && p.uid) throw erro('Você já criou a sua senha. Entre com o CPF e a senha. Esqueceu? Peça ao gerente para liberar um novo primeiro acesso.', 409);
      if (!p.nasc || String(b.nasc || '').slice(0, 10) !== String(p.nasc).slice(0, 10)) throw erro('A data de nascimento não confere com o cadastro feito pelo seu gerente.', 403);
      const senha = String(b.senha || ''); if (senha.length < 6) throw erro('A senha precisa ter pelo menos 6 caracteres.');
      const email = `${cpf}@metas.nexumcell.app`; let uid = p.uid;
      if (uid) await auth.updateUser(uid, { password: senha });
      else {
        try { uid = (await auth.createUser({ email, password: senha, displayName: p.nome || '' })).uid; }
        catch (e) { if (e.code === 'auth/email-already-exists') throw erro('Este CPF já tinha um acesso antigo. Peça ao gerente para liberar um novo primeiro acesso.', 409); throw e; }
      }
      await p.ref.set({ uid, ativado: true, ativadoEm: Date.now(), email }, { merge: true });
      await db.collection('metasAcesso').doc(uid).set({ cpf, escopo: p.escopo, pessoaId: p.id, nome: p.nome || '', em: Date.now() });
      await db.collection('metasTentativas').doc('cpf_' + cpf).set({ n: 0 }, { merge: true });
      return res.json({ ok: true, email });
    }
    throw erro('Ação inválida.');
  } catch (e) { return res.status(e.status || 500).json({ erro: e.message }); }
}

// Rotina de hora em hora: conta os aparelhos vendidos e o faturamento no mês de quem está ligado a um vendedor do sistema
export async function metasRotina() {
  const mes = hoje().slice(0, 7), ini = new Date(mes + '-01T00:00:00-03:00').getTime();
  const ps = (await db.collection('metasPessoas').get()).docs.map((d) => d.data()).filter((p) => p.ativo !== false && p.vendedorUid);
  const porEsc = {}; let n = 0;
  for (const p of ps) {
    const vs = (await db.collection('vendas').where('vendedorUid', '==', p.vendedorUid).get()).docs.map((d) => d.data()).filter((v) => (v.criadoEm || 0) >= ini && ['ATIVA', 'QUITADA'].includes(v.status));
    (porEsc[p.escopo] ||= {})[p.cpf] = { aparelhos: vs.length, faturamento: Math.round(vs.reduce((s, v) => s + (+v.valor || 0), 0) * 100) / 100, em: Date.now() }; n++;
  }
  for (const [esc, auto] of Object.entries(porEsc)) await db.collection('metasPlano').doc(`${esc}_${mes}`).set({ escopo: esc, mes, auto }, { merge: true });
  return { metasAuto: n };
}
