// Lead do site de vendas (chat e contato rápido) → coleção leads → CRM do Dono (aba Comercial).
// POST /api/lead {"nome","loja","cidade","whatsapp","mensagem","origem"}
import { db, cors } from './_base.js';

const txt = (s, n) => String(s ?? '').replace(/[<>]/g, '').trim().slice(0, n || 120);
const dig = (s) => String(s || '').replace(/\D/g, '');

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' });
  try {
    const b = req.body || {};
    const whatsapp = dig(b.whatsapp);
    const lead = {
      nome: txt(b.nome, 80), loja: txt(b.loja, 80), cidade: txt(b.cidade, 80),
      whatsapp, mensagem: txt(b.mensagem, 500), origem: txt(b.origem, 40) || 'site',
      status: 'NOVO', criadoEm: Date.now(),
      historico: [{ em: Date.now(), status: 'NOVO', obs: 'Veio pelo site de vendas' }]
    };
    if (!whatsapp && !lead.loja && !lead.nome) return res.status(400).json({ erro: 'Informe ao menos o WhatsApp ou o nome da loja.' });
    const id = 'lead_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    await db.collection('leads').doc(id).set({ id, ...lead });
    return res.status(200).json({ ok: true, id });
  } catch (e) { console.error(e); return res.status(e.status || 500).json({ erro: e.message }); }
}
