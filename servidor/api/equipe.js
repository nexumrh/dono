// Equipe das lojas: o gerente cadastra o funcionário (nome, e-mail, nascimento, CPF, telefone, cargo)
// e a NexumCell aprova. Se ninguém responder em 2 horas, o próprio sistema aprova, cria o login e manda
// o ID e a senha temporária para o e-mail do funcionário.
// POST /api/equipe {acao:'autoAprovar'} — qualquer pessoa da equipe pode pedir (o portal chama ao abrir).
// Rotina: roda também de hora em hora (cron "0 * * * *") e nas rotinas do dia.
import { db, auth, cors, exigirEquipe, config } from './_base.js';
import { enviarEmail, brevoLigado } from './_brevo.js';

export const PRAZO_AUTO_MS = 2 * 3600e3;
const PRE = { DONO: 'DON', GERENTE: 'GER', VENDEDOR: 'VND', FINANCEIRO: 'FIN', SUPORTE: 'SUP' };
const ORIGEM = () => process.env.PORTAL_ORIGEM || 'https://nexumrh.github.io';
const primeiroNome = (n) => String(n || '').trim().split(/\s+/)[0] || '';
const senha6 = () => String(Math.floor(100000 + Math.random() * 900000));

async function codigoLivre(role) {
  for (let i = 0; i < 30; i++) {
    const c = PRE[role] + '-' + String(Math.floor(1000 + Math.random() * 9000));
    if (!(await db.collection('logins').doc(c).get()).exists) return c;
  }
  throw new Error('não foi possível gerar o ID');
}

// cria o acesso de um cadastro pendente (aprovação automática ou chamada pelo Dono)
export async function aprovarCadastro(id, por = 'Aprovação automática (2 h)') {
  const ref = db.collection('cadastrosVendedor').doc(id), c = (await ref.get()).data();
  if (!c || c.status !== 'PENDENTE') return { ja: true };
  const loja = c.lojaId ? (await db.collection('lojas').doc(c.lojaId).get()).data() || {} : {};
  if (loja.bloqueada) return { pulou: 'loja bloqueada' };
  const email = String(c.email || '').trim().toLowerCase();
  const ja = await db.collection('users').where('email', '==', email).get();
  if (!ja.empty) { await ref.set({ status: 'RECUSADO', motivo: 'Este e-mail já tem acesso ao sistema', respondidoEm: Date.now(), respondidoPor: por }, { merge: true }); return { recusado: true }; }
  const role = 'VENDEDOR', codigo = await codigoLivre(role), senha = senha6();
  const u = await auth.createUser({ email, password: senha, displayName: c.nome });
  const agora = Date.now();
  await db.collection('users').doc(u.uid).set({
    nome: c.nome, email, telefone: c.telefone || '', codigo, role, lojaId: c.lojaId || '', ativo: true, senhaTemporaria: true,
    cpf: c.cpf || '', nascimento: c.nascimento || '', cargo: c.cargo || 'Vendedor(a)', cadastradoPor: c.gerenteNome || '',
    criadoEm: agora, criadoPor: por, ...(loja.bloqueada ? { lojaBloqueada: true } : {}),
  });
  await db.collection('logins').doc(codigo).set({ email, uid: u.uid });
  const url = ORIGEM() + '/vendedor/';
  const texto = `Olá, ${primeiroNome(c.nome)}!\n\nSeu acesso à NexumCell foi criado${loja.nome ? ` (${loja.nome})` : ''}.\n\nPortal: ${url}\nSeu ID: ${codigo}\nSenha temporária: ${senha}\n\nEntre com o ID e a senha temporária. No primeiro acesso você cria a sua própria senha e faz o treinamento obrigatório: as vendas liberam assim que você concluir.`;
  let emailOk = false;
  if (brevoLigado()) { try { await enviarEmail({ para: email, assunto: 'Seu acesso ao Portal do Vendedor — NexumCell', titulo: 'Seu acesso à NexumCell', texto }); emailOk = true; } catch (e) { console.warn('email acesso', e.message); } }
  await ref.set({ status: 'APROVADO', uid: u.uid, codigo, aprovadoEm: agora, aprovadoPor: por, automatico: por.startsWith('Aprovação automática'), emailEnviado: emailOk }, { merge: true });
  await db.collection('logs').add({ em: agora, acao: 'Acesso criado (aprovação automática)', alvo: u.uid, detalhe: `${c.nome} · ${codigo} · ${loja.nome || ''}${emailOk ? ' · e-mail enviado' : ' · e-mail NÃO enviado'}`, nome: por });
  if (c.gerenteUid) await db.collection('notificacoes').add({ para: c.gerenteUid, em: agora, lida: false, titulo: 'Vendedor aprovado', texto: `${c.nome} já pode entrar no Portal do Vendedor (ID ${codigo}).${emailOk ? ' O acesso foi enviado para o e-mail dele.' : ''}` }).catch(() => {});
  return { ok: true, codigo, emailOk };
}

export async function autoAprovarEquipe() {
  const cfg = await config();
  if (cfg.autoAprovarEquipe === 'nao') return 0;
  const limite = Date.now() - PRAZO_AUTO_MS;
  const pend = (await db.collection('cadastrosVendedor').where('status', '==', 'PENDENTE').get()).docs
    .filter((d) => (d.data().criadoEm || 0) <= limite).slice(0, 10);
  let n = 0;
  for (const d of pend) { try { const r = await aprovarCadastro(d.id); if (r.ok) n++; } catch (e) { console.warn('autoAprovar', d.id, e.message); } }
  return n;
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    if (req.method !== 'POST') return res.status(405).json({ erro: 'use POST' });
    await exigirEquipe(req, ['DONO', 'FINANCEIRO', 'GERENTE', 'SUPORTE']);
    const acao = String(req.body?.acao || 'autoAprovar');
    if (acao === 'autoAprovar') return res.json({ ok: true, aprovados: await autoAprovarEquipe() });
    res.status(400).json({ erro: 'ação desconhecida' });
  } catch (e) { res.status(e.status || 500).json({ erro: e.message }); }
}
