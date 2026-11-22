// Lead do site de vendas → coleção leads → CRM (funil comercial).
// POST /api/lead {"nome","loja","cidade","whatsapp","mensagem","origem", utm?, demo?:{quando:'AAAA-MM-DDTHH:MM'}}
// POST /api/lead {acao:'chat', mensagens:[{de:'cliente'|'nexum', t}]}   — chat com IA do site (público, com limite por IP)
import { db, cors } from './_base.js';
import { groq } from './crm-ia.js';
import { enviarEmail, brevoLigado } from './_brevo.js';

const txt = (s, n) => String(s ?? '').replace(/[<>]/g, '').trim().slice(0, n || 120);
const dig = (s) => String(s || '').replace(/\D/g, '');
const sha = async (t) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)))].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 24);

const SOBRE = `Você é o consultor virtual do site de vendas da NexumCell para LOJISTAS (lojas de celular) que querem vender celular parcelado no crediário.
Fatos que você pode usar:
- A NexumCell dá à loja os sistemas (portal do vendedor, do gerente e do dono, app do cliente) e a trava do aparelho, que limita funções do celular em caso de atraso e libera quando o cliente paga.
- A análise de crédito é própria, sem consulta ao SPC/Serasa, então a loja vende para quem os bancos recusam.
- O cliente paga as parcelas por Pix ou boleto pelo app; a cobrança tem régua de avisos e a equipe NexumCell acompanha os atrasos.
- O cadastro da loja é feito no próprio site (matriz e filiais) e a loja recebe treinamento em vídeo para vendedores e gerentes.
- Preços: há mensalidade por loja e licença por venda. NUNCA diga valores: peça para a pessoa ver a seção "Planos" do site ou falar com um consultor.
Regras: responda em português do Brasil (ou em espanhol se a pessoa escrever em espanhol), no máximo 3 frases, sem emojis. Não prometa aprovação, lucro, prazos ou condições que não estão acima. Se não souber, diga que um consultor responde. Quando a pessoa mostrar interesse (quer cadastrar, quer preço, quer conversar, quer demonstração), convide a deixar nome da loja, cidade e WhatsApp e marque pedirContato=true.
Responda em JSON: {"resposta":"...","pedirContato":true|false}`;

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' });
  try {
    const b = req.body || {};
    if (b.acao === 'chat') {
      const ip = String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || 'x').split(',')[0].trim(), hora = new Date().toISOString().slice(0, 13);
      const ref = db.collection('siteChat').doc(await sha(ip + hora)), c = (await ref.get()).data() || {};
      if ((c.n || 0) >= 25) return res.status(429).json({ erro: 'Muitas mensagens. Deixe seu WhatsApp que um consultor responde.' });
      await ref.set({ n: (c.n || 0) + 1, em: Date.now() }, { merge: true });
      const ms = (Array.isArray(b.mensagens) ? b.mensagens : []).slice(-10).map((m) => ({ role: m.de === 'nexum' ? 'assistant' : 'user', content: txt(m.t, 600) })).filter((m) => m.content);
      if (!ms.length || ms[ms.length - 1].role !== 'user') return res.status(400).json({ erro: 'Escreva a sua pergunta' });
      let extra = ''; try { extra = String((await db.collection('config').doc('crm').get()).data()?.iaSite || '').slice(0, 2000); } catch (e) { }
      const t = await groq([{ role: 'system', content: SOBRE + (extra ? '\n\nInformações do dono:\n' + extra : '') }, ...ms], { temperatura: 0.3, max: 300, json: true });
      let j = {}; try { j = JSON.parse(t); } catch (e) { j = { resposta: t, pedirContato: false }; }
      return res.json({ resposta: txt(j.resposta, 800) || 'Um consultor da NexumCell pode te ajudar. Deixe seu WhatsApp.', pedirContato: !!j.pedirContato });
    }
    const whatsapp = dig(b.whatsapp), u = b.utm || {};
    const demo = b.demo && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(b.demo.quando || '')) ? { quando: String(b.demo.quando), confirmado: false } : null;
    const lead = {
      nome: txt(b.nome, 80), loja: txt(b.loja, 80), cidade: txt(b.cidade, 80),
      whatsapp, mensagem: txt(b.mensagem, 1500), origem: txt(b.origem, 40) || 'site',
      status: 'NOVO', criadoEm: Date.now(),
      ...(demo ? { demo } : {}),
      ...(u.source || u.campaign ? { utm: { source: txt(u.source, 60), medium: txt(u.medium, 60), campaign: txt(u.campaign, 80), pagina: txt(u.pagina, 120) } } : {}),
      historico: [{ em: Date.now(), status: 'NOVO', obs: demo ? `Pediu demonstração para ${demo.quando.replace('T', ' às ').split('-').reverse().join('/')}` : 'Veio pelo site de vendas' }]
    };
    if (!whatsapp && !lead.loja && !lead.nome) return res.status(400).json({ erro: 'Informe ao menos o WhatsApp ou o nome da loja.' });
    const id = 'lead_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    await db.collection('leads').doc(id).set({ id, ...lead });
    if (demo && brevoLigado() && process.env.DONO_EMAIL) {
      const [d, h] = demo.quando.split('T');
      await enviarEmail({ para: process.env.DONO_EMAIL, assunto: `Demonstração agendada: ${lead.loja || lead.nome} (${d.split('-').reverse().join('/')} às ${h})`, titulo: 'Nova demonstração pelo site', texto: `${lead.nome || ''} · ${lead.loja || ''} · ${lead.cidade || ''}\nWhatsApp: ${whatsapp}\nQuando: ${d.split('-').reverse().join('/')} às ${h}\n\nO lead está no CRM, no funil comercial. Confirme o horário pelo WhatsApp.` }).catch(() => {});
    }
    return res.status(200).json({ ok: true, id });
  } catch (e) { console.error(e); return res.status(e.status || 500).json({ erro: e.message }); }
}
