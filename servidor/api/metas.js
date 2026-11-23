// App Metas & Bônus: entrada do funcionário pelo CPF.
// O gerente (ou o dono) cadastra a pessoa com CPF em metasPessoas/{escopo}_{cpf}.
// A senha inicial do funcionário é 123456; no primeiro acesso ele é obrigado a trocar.
// POST /api/metas {acao:'status', cpf}               → {existe, ativado, nome, precisaTrocar}
// POST /api/metas {acao:'preparar', cpf}             → garante o login com a senha inicial 123456 (1º acesso)
// POST /api/metas {acao:'trocar', cpf, senhaAtual, senha} → troca a senha e tira a obrigação de trocar
// O login usa o Firebase Auth com o e-mail interno {cpf}@metas.nexumcell.app.
const SENHA_INICIAL = '123456';
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
    const email = `${cpf}@metas.nexumcell.app`;
    if (b.acao === 'status') {
      const ip = String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || 'x').split(',')[0].trim();
      await limitar('ip_' + ip.replace(/[^\w]/g, '_') + '_' + hoje(), 60);
      const p = await pessoaDo(cpf);
      if (!p) return res.json({ existe: false });
      return res.json({ existe: true, ativado: !!(p.ativado && p.uid), precisaTrocar: !!(p.precisaTrocar !== false && !p.senhaTrocada), nome: String(p.nome || '').split(' ')[0] });
    }
    // 1º acesso: garante o login com a senha inicial 123456, para o app entrar e então obrigar a trocar
    if (b.acao === 'preparar') {
      await limitar('cpf_' + cpf);
      const p = await pessoaDo(cpf); if (!p) throw erro('CPF não cadastrado. Peça ao seu gerente para cadastrar você nas metas.', 404);
      if (p.senhaTrocada) throw erro('Você já tem uma senha. Entre com o CPF e a sua senha. Esqueceu? Peça ao gerente para liberar um novo primeiro acesso.', 409);
      let uid = p.uid;
      if (uid) await auth.updateUser(uid, { password: SENHA_INICIAL });
      else {
        try { uid = (await auth.createUser({ email, password: SENHA_INICIAL, displayName: p.nome || '' })).uid; }
        catch (e) {
          if (e.code === 'auth/email-already-exists') throw erro('Este CPF já tinha um acesso. Peça ao gerente para liberar um novo primeiro acesso.', 409);
          throw e;
        }
      }
      await p.ref.set({ uid, ativado: true, email, precisaTrocar: true, senhaTrocada: false, ativadoEm: p.ativadoEm || Date.now() }, { merge: true });
      await db.collection('metasAcesso').doc(uid).set({ cpf, escopo: p.escopo, pessoaId: p.id, nome: p.nome || '', em: Date.now() }, { merge: true });
      return res.json({ ok: true, email, senhaInicial: SENHA_INICIAL });
    }
    // troca de senha (obrigatória no 1º acesso). O app já entrou com o Firebase Auth e manda o token.
    if (b.acao === 'trocar') {
      await limitar('cpf_' + cpf);
      const idt = String(req.headers.authorization || '').replace('Bearer ', '');
      let u; try { u = await auth.verifyIdToken(idt); } catch (_) { throw erro('Entre de novo e tente outra vez.', 401); }
      const p = await pessoaDo(cpf); if (!p || !p.uid) throw erro('CPF não encontrado.', 404);
      if (u.uid !== p.uid) throw erro('Não foi possível confirmar o seu acesso. Entre de novo e tente outra vez.', 403);
      const senha = String(b.senha || ''); if (senha.length < 6) throw erro('A nova senha precisa ter pelo menos 6 caracteres.');
      if (senha === SENHA_INICIAL) throw erro('Escolha uma senha diferente de 123456.');
      await auth.updateUser(p.uid, { password: senha });
      await p.ref.set({ precisaTrocar: false, senhaTrocada: true, senhaTrocadaEm: Date.now() }, { merge: true });
      await db.collection('metasTentativas').doc('cpf_' + cpf).set({ n: 0 }, { merge: true });
      return res.json({ ok: true });
    }
    throw erro('Ação inválida.');
  } catch (e) { return res.status(e.status || 500).json({ erro: e.message }); }
}

// Rotina de hora em hora: conta os aparelhos vendidos e o faturamento no mês de quem está ligado a um vendedor do sistema
export async function metasRotina() {
  const mes = hoje().slice(0, 7), ini = new Date(mes + '-01T00:00:00-03:00').getTime();
  const todas = (await db.collection('metasPessoas').get()).docs.map((d) => d.data()).filter((p) => p.ativo !== false);
  const porEsc = {}; let n = 0;
  for (const p of todas.filter((x) => x.vendedorUid)) {
    const vs = (await db.collection('vendas').where('vendedorUid', '==', p.vendedorUid).get()).docs.map((d) => d.data()).filter((v) => (v.criadoEm || 0) >= ini && ['ATIVA', 'QUITADA'].includes(v.status));
    (porEsc[p.escopo] ||= {})[p.cpf] = { aparelhos: vs.length, faturamento: Math.round(vs.reduce((s, v) => s + (+v.valor || 0), 0) * 100) / 100, em: Date.now() }; n++;
  }
  // equipe NexumCell ligada a um usuário do CRM: satisfação e atendimentos finalizados contam sozinhos
  const crm = todas.filter((x) => x.usuarioUid);
  if (crm.length) {
    const [av, atr] = await Promise.all([db.collection('crmAvaliacoes').where('em', '>=', ini).get(), db.collection('crmAtrib').where('finalizadoEm', '>=', ini).get()]);
    const avs = av.docs.map((d) => d.data()), fins = atr.docs.map((d) => d.data());
    for (const p of crm) { const meu = avs.filter((a) => a.uid === p.usuarioUid), notas = meu.map((a) => +a.nota || 0);
      (porEsc[p.escopo] ||= {})[p.cpf] = { ...((porEsc[p.escopo] || {})[p.cpf] || {}), satMedia: notas.length ? Math.round(notas.reduce((s, x) => s + x, 0) / notas.length * 10) / 10 : 0, satBons: notas.filter((x) => x >= 4).length, satQtd: notas.length,
        atendidos: fins.filter((a) => a.finalizadoUid === p.usuarioUid).length, em: Date.now() }; n++; }
  }
  for (const [esc, auto] of Object.entries(porEsc)) await db.collection('metasPlano').doc(`${esc}_${mes}`).set({ escopo: esc, mes, auto }, { merge: true });
  return { metasAuto: n };
}
