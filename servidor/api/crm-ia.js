// IA do CRM (Groq). Só para a equipe NexumCell.
// POST /api/crm-ia {acao:'resumo'|'sugestao', canal, cliente, conversa, ficha, atendente, estilo?}
//                  {acao:'reescrever', texto, estilo:'curta'|'formal'|'empatica'|'corrigir'|'firme'}
//                  {acao:'traduzir', texto, idioma:'es'|'pt'|'en'}
//                  {acao:'modelo', pedido}                       — escreve uma resposta rápida nova (com variáveis)
//                  {acao:'automatica', canal, cliente, conversa, ficha} — teste da resposta automática (não envia)
//                  {acao:'comprovante', imagem}                  — lê a foto do comprovante (valor, data, quem pagou, ID da transação)
//                  {acao:'baixarComprovante', vendaId, n, valor, data, idTransacao, arquivoId} — dá baixa (Dono e Financeiro)
import { cors, exigirEquipe, db, baixarParcela, asaas } from './_base.js';
import { chaveIA } from './ia-autonoma.js';

const MODELO = process.env.GROQ_MODELO_CRM || 'llama-3.3-70b-versatile';
export const REGRAS = 'Você trabalha no atendimento da NexumCell, que vende celulares parcelados com trava do aparelho e oferece crédito. Responda sempre em português do Brasil, com educação e frases curtas. Nunca prometa aprovação de crédito, desconto ou liberação que a equipe não confirmou. Nunca peça senha, código ou pagamento em conta de terceiros. Pagamento é só pelo app NexumCell (aba Parcelas → Pix) ou pelo Pix enviado pela equipe. Não use emojis.';
const ESTILOS = {
  curta: 'Reescreva a mensagem de forma mais curta e direta, mantendo todas as informações importantes.',
  formal: 'Reescreva a mensagem num tom mais formal e profissional, como um banco.',
  empatica: 'Reescreva a mensagem num tom mais acolhedor e empático, mostrando que entendemos a situação do cliente, sem perder a clareza.',
  firme: 'Reescreva a mensagem num tom firme e respeitoso de cobrança, deixando claro o valor, o prazo e o que acontece se não pagar, sem ameaças.',
  corrigir: 'Corrija a ortografia, a pontuação e a clareza da mensagem, mudando o mínimo possível.',
};
const IDIOMAS = { es: 'espanhol (do Paraguai/Argentina, claro e simples)', pt: 'português do Brasil', en: 'inglês simples' };

export async function groq(mensagens, { temperatura = 0.3, max = 400, json = false, modelo = MODELO } = {}) {
  const chave = await chaveIA(); if (!chave) throw Object.assign(new Error('IA sem chave: coloque a chave da IA em Configurações do Painel do Dono'), { status: 400 });
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer ' + chave, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: modelo, temperature: temperatura, max_tokens: max, ...(json ? { response_format: { type: 'json_object' } } : {}), messages: mensagens }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error('IA: ' + (j.error?.message || r.status)), { status: 502 });
  return String(j.choices?.[0]?.message?.content || '').trim();
}

/* base de conhecimento: respostas rápidas da equipe + orientações do dono */
export async function baseConhecimento() {
  const c = (await db.collection('config').doc('crm').get()).data() || {};
  const rs = (c.respostas || []).flatMap(([g, l]) => (l || []).map(([t, x]) => `- ${g} / ${t}: ${String(x || '').replace(/\s+/g, ' ').slice(0, 400)}`)).slice(0, 60).join('\n');
  return { cfg: c, texto: `${c.iaOrientacoes ? 'Orientações do dono:\n' + String(c.iaOrientacoes).slice(0, 2500) + '\n\n' : ''}Respostas aprovadas pela equipe (use como base, troque {variáveis} pelos dados reais ou deixe de fora):\n${rs}` };
}

export const PEDIDO_AUTO = 'Você está respondendo sozinho porque a equipe não está disponível agora. Responda a ÚLTIMA mensagem do cliente usando só as informações da ficha, das orientações e das respostas aprovadas. Se o cliente pedir para falar com uma pessoa, reclamar, pedir desconto, acordo, liberação do aparelho, cancelamento, troca, ou se você não tiver a informação, diga com educação que um atendente vai continuar o atendimento assim que possível e marque humano=true. Responda em JSON: {"resposta":"texto de no máximo 4 frases","humano":true|false}. Se o cliente escreveu em espanhol, responda em espanhol.';

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    await exigirEquipe(req, ['DONO', 'SUPORTE', 'FINANCEIRO', 'COMERCIAL']);
    const b = req.body || {}, txt = String(b.texto || '').slice(0, 4000);
    if (b.acao === 'reescrever') { if (!txt.trim()) throw Object.assign(new Error('Escreva a mensagem primeiro'), { status: 400 });
      return res.json({ texto: await groq([{ role: 'system', content: REGRAS }, { role: 'user', content: `${ESTILOS[b.estilo] || ESTILOS.corrigir} Devolva só a mensagem pronta, sem aspas e sem comentários.\n\nMensagem:\n${txt}` }], { temperatura: 0.3 }) }); }
    if (b.acao === 'traduzir') { if (!txt.trim()) throw Object.assign(new Error('Nada para traduzir'), { status: 400 });
      return res.json({ texto: await groq([{ role: 'system', content: 'Você é um tradutor. Devolva só a tradução, sem aspas e sem comentários.' }, { role: 'user', content: `Traduza para ${IDIOMAS[b.idioma] || IDIOMAS.pt}:\n\n${txt}` }], { temperatura: 0.1 }) }); }
    if (b.acao === 'modelo') { const p = String(b.pedido || '').slice(0, 600); if (p.length < 5) throw Object.assign(new Error('Descreva a situação'), { status: 400 });
      const t = await groq([{ role: 'system', content: REGRAS }, { role: 'user', content: `Escreva uma resposta rápida (modelo reutilizável) para o atendimento usar nesta situação: "${p}". Use estas variáveis quando fizer sentido: {nome} (primeiro nome do cliente), {atendente}, {protocolo}, {contrato}, {parcela}, {valor}, {venc}, {loja}. No máximo 4 frases. Responda em JSON: {"titulo":"título curto de até 4 palavras","categoria":"Saudação|Pagamento|Cobrança|Aparelho|Crédito|Suporte|Encerramento","texto":"..."}` }], { temperatura: 0.4, json: true });
      let j = {}; try { j = JSON.parse(t); } catch (e) { j = { titulo: 'Nova resposta', categoria: 'Suporte', texto: t }; } return res.json(j); }
    if (b.acao === 'comprovante') { const img = String(b.imagem || ''); if (!/^data:image\/(png|jpe?g|webp);base64,/.test(img) || img.length > 5.5e6) throw Object.assign(new Error('Mande uma foto (JPG ou PNG) de até 4 MB'), { status: 400 });
      const t = await groq([{ role: 'system', content: 'Você lê comprovantes de pagamento brasileiros (Pix, TED, boleto, depósito). Extraia os dados exatamente como aparecem. Não invente: campo que não aparece fica vazio.' },
        { role: 'user', content: [{ type: 'text', text: 'Leia este comprovante e responda em JSON: {"ehComprovante":true|false,"tipo":"PIX|TED|BOLETO|DEPOSITO|OUTRO","valor":0.00,"data":"AAAA-MM-DD","hora":"HH:MM","pagador":"nome de quem pagou","recebedor":"nome de quem recebeu","banco":"banco ou app","idTransacao":"código/ID/autenticação da transação","duvidas":"algo estranho na imagem (editada, cortada, valor ilegível) ou vazio"}' }, { type: 'image_url', image_url: { url: img } }] }],
        { temperatura: 0, max: 400, json: true, modelo: process.env.GROQ_MODELO_VISAO || 'meta-llama/llama-4-scout-17b-16e-instruct' });
      let j = {}; try { j = JSON.parse(t); } catch (e) { throw Object.assign(new Error('A IA não conseguiu ler o comprovante'), { status: 502 }); }
      const id = String(j.idTransacao || '').replace(/\s+/g, '').slice(0, 80), usado = id ? (await db.collection('comprovantes').doc(id.replace(/[\/]/g, '_')).get()).data() : null;
      return res.json({ ...j, valor: Math.round((+String(j.valor || 0).toString().replace(',', '.') || 0) * 100) / 100, idTransacao: id, jaUsado: usado ? { em: usado.em, vendaNumero: usado.vendaNumero, parcela: usado.n, por: usado.por } : null }); }
    if (b.acao === 'baixarComprovante') { const eu = await exigirEquipe(req, ['DONO', 'FINANCEIRO']);
      const id = String(b.idTransacao || '').replace(/\s+/g, '').slice(0, 80), n = +b.n, valor = Math.round(+b.valor * 100) / 100;
      if (!b.vendaId || !(n > 0) || !(valor > 0)) throw Object.assign(new Error('Escolha a parcela e o valor'), { status: 400 });
      const vref = db.collection('vendas').doc(String(b.vendaId)), v = (await vref.get()).data(); if (!v) throw Object.assign(new Error('Contrato não encontrado'), { status: 404 });
      const p = (v.parcelas || []).find((x) => x.n === n); if (!p || p.pago) throw Object.assign(new Error('Essa parcela já está paga'), { status: 409 });
      if (id) { const cref = db.collection('comprovantes').doc(id.replace(/[\/]/g, '_'));
        await db.runTransaction(async (t) => { const c = await t.get(cref); if (c.exists) throw Object.assign(new Error(`Este comprovante já foi usado no contrato nº ${c.data().vendaNumero}, parcela ${c.data().n}`), { status: 409 }); t.set(cref, { em: Date.now(), vendaId: b.vendaId, vendaNumero: v.numero, n, valor, data: String(b.data || '').slice(0, 10), por: eu.nome, arquivoId: String(b.arquivoId || '').slice(0, 60) }); }); }
      await baixarParcela(String(b.vendaId), n, valor, 'PIX (comprovante)', `Comprovante lido no CRM${id ? ' · ID ' + id : ''}${b.data ? ' · pago em ' + String(b.data).slice(0, 10) : ''}`, eu.nome + ' (CRM)');
      if (p.asaasId) await asaas('/payments/' + p.asaasId, { method: 'DELETE' }).catch(() => {});
      return res.json({ ok: true }); }
    const conversa = String(b.conversa || '').slice(-9000), ficha = String(b.ficha || '').slice(0, 2500);
    if (b.acao === 'automatica') { const base = await baseConhecimento();
      const t = await groq([{ role: 'system', content: REGRAS + '\n\n' + base.texto }, { role: 'user', content: `Canal: ${String(b.canal || '').slice(0, 40)}\nCliente: ${String(b.cliente || '').slice(0, 80)}\n\nFicha do cliente:\n${ficha}\n\nConversa:\n${conversa}\n\n${PEDIDO_AUTO}` }], { temperatura: 0.2, json: true });
      let j = {}; try { j = JSON.parse(t); } catch (e) { j = { resposta: t, humano: true }; } return res.json({ texto: String(j.resposta || ''), humano: !!j.humano }); }
    const base = b.acao === 'sugestao' ? await baseConhecimento().catch(() => ({ texto: '' })) : { texto: '' };
    const pedido = b.acao === 'resumo'
      ? 'Resuma este atendimento em no máximo 3 linhas curtas: o que o cliente quer, o que já foi feito e o que falta fazer. Use tópicos iniciados por "- ".'
      : `Escreva a próxima mensagem que o atendente ${String(b.atendente || '').slice(0, 30)} deve mandar ao cliente, pronta para enviar, com no máximo 3 frases. Use os dados da ficha quando ajudarem (parcelas, atraso, aparelho) e as respostas aprovadas como base. ${ESTILOS[b.estilo] ? 'Estilo: ' + ESTILOS[b.estilo] : ''} Se o cliente escreveu em espanhol, responda em espanhol.`;
    const texto = await groq([{ role: 'system', content: REGRAS + (base.texto ? '\n\n' + base.texto : '') },
      { role: 'user', content: `Canal: ${String(b.canal || '').slice(0, 40)}\nCliente: ${String(b.cliente || '').slice(0, 80)}\n\nFicha do cliente:\n${ficha}\n\nConversa:\n${conversa}\n\n${pedido}` }], { temperatura: b.acao === 'resumo' ? 0.1 : 0.4, max: 300 });
    return res.json({ texto });
  } catch (e) { return res.status(e.status || 500).json({ erro: e.message }); }
}
