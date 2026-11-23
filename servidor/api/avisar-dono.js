// Aviso por e-mail ao dono quando alguém do suporte, financeiro ou comercial manda mensagem na conversa direta.
// POST /api/avisar-dono {texto}. No máximo 1 e-mail a cada 15 minutos por pessoa.
import { cors, exigirEquipe, db } from './_base.js';
import { enviarEmail, brevoLigado } from './_brevo.js';
export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    const eu = await exigirEquipe(req, ['SUPORTE', 'FINANCEIRO', 'COMERCIAL']);
    const ref = db.collection('chatDono').doc(eu.uid), c = (await ref.get()).data() || {};
    if ((c.avisadoEm || 0) > Date.now() - 15 * 60e3 || !brevoLigado() || !process.env.DONO_EMAIL) return res.json({ ok: true, enviado: false });
    await ref.set({ avisadoEm: Date.now() }, { merge: true });
    await enviarEmail({ para: process.env.DONO_EMAIL, assunto: `Mensagem de ${eu.nome} (${eu.role.toLowerCase()})`, titulo: 'Nova mensagem da equipe',
      texto: `${eu.nome} mandou uma mensagem para você:\n\n"${String(req.body?.texto || '').slice(0, 300)}"\n\nResponda no Painel do Dono, no botão de conversa no canto da tela.` });
    return res.json({ ok: true, enviado: true });
  } catch (e) { return res.status(e.status || 500).json({ erro: e.message }); }
}
