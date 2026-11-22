// IA do CRM: resumo da conversa e sugestão de resposta (Groq). Só para a equipe NexumCell.
// POST /api/crm-ia {acao:'resumo'|'sugestao', canal, cliente, conversa, ficha, atendente}
import { cors, exigirEquipe } from './_base.js';
import { chaveIA } from './ia-autonoma.js';

const MODELO = process.env.GROQ_MODELO_CRM || 'llama-3.3-70b-versatile';
const REGRAS = 'Você trabalha no atendimento da NexumCell, que vende celulares parcelados com trava do aparelho e oferece crédito. Responda sempre em português do Brasil, com educação e frases curtas. Nunca prometa aprovação de crédito, desconto ou liberação que a equipe não confirmou. Nunca peça senha, código ou pagamento em conta de terceiros. Pagamento é só pelo app NexumCell (aba Parcelas → Pix) ou pelo Pix enviado pela equipe.';

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    await exigirEquipe(req, ['DONO', 'SUPORTE', 'FINANCEIRO', 'COMERCIAL']);
    const b = req.body || {}, chave = await chaveIA();
    if (!chave) return res.status(400).json({ erro: 'IA sem chave: coloque a chave da IA em Configurações do Painel do Dono' });
    const conversa = String(b.conversa || '').slice(-9000), ficha = String(b.ficha || '').slice(0, 2500);
    const pedido = b.acao === 'resumo'
      ? 'Resuma este atendimento em no máximo 3 linhas curtas: o que o cliente quer, o que já foi feito e o que falta fazer. Use tópicos iniciados por "- ".'
      : `Escreva a próxima mensagem que o atendente ${String(b.atendente || '').slice(0, 30)} deve mandar ao cliente, pronta para enviar, com no máximo 3 frases. Use os dados da ficha quando ajudarem (parcelas, atraso, aparelho). Não use emojis.`;
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer ' + chave, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODELO, temperature: b.acao === 'resumo' ? 0.1 : 0.4, max_tokens: 300, messages: [{ role: 'system', content: REGRAS },
        { role: 'user', content: `Canal: ${String(b.canal || '').slice(0, 40)}\nCliente: ${String(b.cliente || '').slice(0, 80)}\n\nFicha do cliente:\n${ficha}\n\nConversa:\n${conversa}\n\n${pedido}` }] }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(502).json({ erro: 'IA: ' + (j.error?.message || r.status) });
    return res.json({ texto: String(j.choices?.[0]?.message?.content || '').trim() });
  } catch (e) { return res.status(e.status || 500).json({ erro: e.message }); }
}
