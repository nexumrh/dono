// Pré-análise online do portal do cliente (link público ?pre), gravada pelo servidor.
// POST /api/preanalise {"acao":"enviar", ...dados}  → cria (valida CPF, idade, tamanho; no máximo 3 por CPF por dia)
// POST /api/preanalise {"acao":"ver","id":".."}      → situação (só os campos que o cliente pode ver)
// POST /api/preanalise {"acao":"agendar","id":"..","data":"AAAA-MM-DD","hora":"HH:MM"} → agenda a retirada (só pré-aprovado)
import { db, cors, hoje } from './_base.js';

const dig = (s) => String(s || '').replace(/\D/g, '');
function cpfOk(c) {
  c = dig(c); if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false;
  for (const t of [9, 10]) { let s = 0; for (let i = 0; i < t; i++) s += +c[i] * (t + 1 - i); if ((s * 10) % 11 % 10 !== +c[t]) return false; }
  return true;
}
const txt = (s, n) => String(s ?? '').replace(/[<>]/g, '').trim().slice(0, n);
const erro = (msg, status = 400) => Object.assign(new Error(msg), { status });

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const b = req.body || {};
    if (b.acao === 'enviar') {
      const cpf = dig(b.cpf), tel = dig(b.telefone), nasc = String(b.nasc || '');
      if (!cpfOk(cpf)) throw erro('CPF inválido.');
      if (tel.length < 10 || tel.length > 13) throw erro('WhatsApp com DDD.');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(nasc)) throw erro('Data de nascimento inválida.');
      const idade = Math.floor((Date.now() - new Date(nasc)) / 31557600000);
      if (idade < 18 || idade > 110) throw erro('É preciso ter 18 anos ou mais.');
      if (b.aceiteLgpd !== true) throw erro('Marque a autorização para continuar.');
      const nome = txt(b.nome, 120); if (nome.length < 3) throw erro('Nome completo.');
      // trava contra robô/abuso: no máximo 3 envios do mesmo CPF por dia
      const ini = new Date(hoje() + 'T00:00:00-03:00').getTime();
      const doDia = (await db.collection('preanalises').where('cpf', '==', cpf).get()).docs.filter((d) => (d.data().criadoEm || 0) >= ini).length;
      if (doDia >= 3) throw erro('Você já enviou pré-análises hoje. Aguarde o contato da loja.', 429);
      const vit = (await db.collection('publico').doc('vitrine').get()).data() || {};
      const loja = (vit.lojas || []).find((l) => l.id === b.lojaId) || {};
      const ref = await db.collection('preanalises').add({
        nome, cpf, nasc, telefone: tel, cidade: txt(b.cidade, 60), renda: Math.max(0, Number(b.renda) || 0), profissao: txt(b.profissao, 60),
        aparelho: txt(b.aparelho, 120), entrada: Math.max(0, Number(b.entrada) || 0), lojaId: loja.id || '', lojaNome: loja.nome || '',
        aceiteLgpd: true, status: 'NOVA', criadoEm: Date.now(), via: 'servidor',
      });
      return res.status(200).json({ id: ref.id, lojaNome: loja.nome || '', lojaTelefone: loja.telefone || '' });
    }
    if (b.acao === 'ver' || b.acao === 'agendar') {
      const id = String(b.id || '');
      if (!/^[A-Za-z0-9_-]{6,40}$/.test(id)) throw erro('Pré-análise não encontrada.', 404);
      const ref = db.collection('preanalises').doc(id), s = await ref.get();
      if (!s.exists) throw erro('Pré-análise não encontrada.', 404);
      const x = s.data();
      if (b.acao === 'agendar') {
        if (x.status !== 'PRE_APROVADO') throw erro('Só dá para agendar depois da pré-aprovação.');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.data)) || b.data < hoje() || !/^\d{2}:\d{2}$/.test(String(b.hora))) throw erro('Escolha o dia e o horário.');
        x.agendamento = { data: b.data, hora: b.hora, em: Date.now() };
        await ref.set({ agendamento: x.agendamento }, { merge: true });
      }
      return res.status(200).json({ id, nome: String(x.nome || '').split(' ')[0], aparelho: x.aparelho || '', lojaNome: x.lojaNome || '', status: x.status, resposta: x.resposta || '', criadoEm: x.criadoEm, agendamento: x.agendamento || null });
    }
    return res.status(400).json({ erro: 'ação desconhecida' });
  } catch (e) {
    console.error(e);
    return res.status(e.status || 500).json({ erro: e.status ? e.message : 'Não foi possível enviar agora. Tente de novo.' });
  }
}
