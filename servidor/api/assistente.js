// Assistente do portal do cliente: responde dúvidas livres sobre o contrato usando IA (Groq).
// A chave da IA fica só aqui no servidor (variável GROQ_API_KEY na Vercel), nunca no portal.
// POST /api/assistente  {"token":"<token do aparelho>","pergunta":"..."}
import { db, cors, encargos, hoje } from './_base.js';

const MODELO = process.env.GROQ_MODELO || 'llama-3.3-70b-versatile';

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const { token, pergunta } = req.body || {};
    if (!token || !pergunta || String(pergunta).length > 500) return res.status(400).json({ erro: 'pedido inválido' });
    if (!process.env.GROQ_API_KEY) return res.status(200).json({ resposta: null });
    const s = await db.collection('aparelhos').doc(String(token)).get();
    if (!s.exists) return res.status(404).json({ erro: 'contrato não encontrado' });
    const ap = s.data();
    const parcelas = (ap.parcelas || []).map((p) => ({ n: p.n, vencimento: p.venc, valor: p.valor, pago: !!p.pago, valorHoje: p.pago ? 0 : encargos(p, ap) }));
    const contexto = {
      hoje: hoje(), loja: ap.lojaNome, telefoneLoja: ap.lojaTelefone, chavePix: ap.chavePix, aparelho: `${ap.marca} ${ap.modelo}`,
      contrato: ap.vendaNumero, cliente: ap.clienteNome, descontoAntecipadoPct: ap.descontoPct, multaPct: ap.multaPct, jurosDiaPct: ap.moraDiaPct,
      quitado: !!ap.quitado, bloqueioTotalComDiasDeAtraso: ap.etapaTotalDias, limitacaoComDiasDeAtraso: ap.etapaParcialDias, parcelas,
    };
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + process.env.GROQ_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODELO, temperature: 0.2, max_tokens: 300,
        messages: [
          { role: 'system', content: 'Você é o assistente da loja de celulares parcelados NexumCell no portal do cliente. Responda em português do Brasil, curto (até 3 frases), educado e só com base nos DADOS DO CONTRATO. Nunca invente valores, datas, promoções ou regras. Não prometa descontos nem liberação. Se não souber ou for algo que precisa de uma pessoa, oriente a falar com a loja pelo WhatsApp. Botões que existem no portal: Pagar (gera PIX), Quitar com PIX, Mudar dia do vencimento, Meu aparelho deu defeito, Roubo/furto/perda, Meus dados (LGPD), Recibo.' },
          { role: 'system', content: 'DADOS DO CONTRATO: ' + JSON.stringify(contexto) },
          { role: 'user', content: String(pergunta) },
        ],
      }),
    });
    const j = await r.json();
    return res.status(200).json({ resposta: j.choices?.[0]?.message?.content?.trim() || null });
  } catch (e) {
    console.error(e);
    return res.status(200).json({ resposta: null });
  }
}
