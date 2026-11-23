// Assistente do dono: responde perguntas sobre o negócio com os números que o próprio portal calculou.
// POST /api/assistente-dono {pergunta, dados, historico}  · só DONO e FINANCEIRO
// O portal manda um resumo da carteira (vendas, recebimentos, atrasos, lojas, vendedores). A IA só usa esses números.
import { cors, exigirEquipe } from './_base.js';
import { groq } from './crm-ia.js';

const SISTEMA = `Você é o assistente financeiro da NexumCell, uma financeira que vende celulares parcelados com trava do aparelho, em várias lojas.
Responda em português do Brasil, direto e curto (no máximo 8 linhas ou uma lista curta), para o dono do negócio.
Use SOMENTE os números do JSON "dados". Valores em reais no formato R$ 1.234,56. Nunca invente número, loja, vendedor ou cliente.
Se a resposta não estiver nos dados, diga o que falta e em qual tela do sistema ver (Relatórios da carteira, Parcelas e cobrança, Fila de cobrança, Aparelhos e trava, Vendas).
Quando fizer sentido, termine com uma sugestão prática de ação em uma frase. Não use emojis nem tabelas grandes.`;

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).end();
  try {
    await exigirEquipe(req, ['DONO', 'FINANCEIRO']);
    const b = req.body || {}, pergunta = String(b.pergunta || '').trim().slice(0, 600);
    if (pergunta.length < 3) return res.status(400).json({ erro: 'Escreva a pergunta' });
    const dados = JSON.stringify(b.dados || {}).slice(0, 60000);
    const hist = (Array.isArray(b.historico) ? b.historico : []).slice(-6).map((m) => ({ role: m.de === 'eu' ? 'user' : 'assistant', content: String(m.t || '').slice(0, 1500) }));
    const resposta = await groq([{ role: 'system', content: SISTEMA + '\n\ndados = ' + dados }, ...hist, { role: 'user', content: pergunta }], { temperatura: 0.2, max: 700 });
    return res.json({ resposta: String(resposta || '').trim() });
  } catch (e) { return res.status(e.status || 500).json({ erro: e.message }); }
}
