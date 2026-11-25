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
import { errosTexto, codigosNoTexto, AJUDA_URL } from './erros.js';
import { exemplosBons } from './crm-rotinas.js';
import { transcrever, traduzir, qualidade, artigosTexto } from './crm-extra.js';
import { copiloto, alertaRisco, treinoCliente, treinoAvaliar, RX_RISCO } from './crm-mais.js';

import { groqChat } from './groq-modelos.js';
let ULTIMO_MODELO = '';
const MODELO = process.env.GROQ_MODELO_CRM || '';
export const REGRAS = 'Você trabalha no atendimento da NexumCell, que vende celulares parcelados com trava do aparelho e oferece crédito. Responda sempre em português do Brasil, com educação e frases curtas. Nunca prometa aprovação de crédito, desconto ou liberação que a equipe não confirmou. Nunca peça senha, código ou pagamento em conta de terceiros. Pagamento é só pelo app NexumCell (aba Parcelas → Pix) ou pelo Pix enviado pela equipe. Não use emojis.';
const ESTILOS = {
  curta: 'Reescreva a mensagem de forma mais curta e direta, mantendo todas as informações importantes.',
  formal: 'Reescreva a mensagem num tom mais formal e profissional, como um banco.',
  empatica: 'Reescreva a mensagem num tom mais acolhedor e empático, mostrando que entendemos a situação do cliente, sem perder a clareza.',
  firme: 'Reescreva a mensagem num tom firme e respeitoso de cobrança, deixando claro o valor, o prazo e o que acontece se não pagar, sem ameaças.',
  corrigir: 'Corrija a ortografia, a pontuação e a clareza da mensagem, mudando o mínimo possível.',
};
const IDIOMAS = { es: 'espanhol (do Paraguai/Argentina, claro e simples)', pt: 'português do Brasil', en: 'inglês simples' };

export async function groq(mensagens, { temperatura = 0.3, max = 400, json = false, modelo = MODELO, tipo = 'texto' } = {}) {
  const chave = await chaveIA(); if (!chave) throw Object.assign(new Error('IA sem chave: coloque a chave da IA em Configurações do Painel do Dono'), { status: 400 });
  const r = await groqChat(chave, mensagens, { temperatura, max, json, tipo, preferido: modelo }); ULTIMO_MODELO = r.modelo; return r.texto;
}

/* base de conhecimento: respostas rápidas da equipe + orientações do dono */
export async function baseConhecimento() {
  const c = (await db.collection('config').doc('crm').get()).data() || {}, artTxt = await artigosTexto().catch(() => '');
  // respostas da equipe: formato novo (lista de objetos) ou antigo (grupos)
  const v2 = Array.isArray(c.respostasV2) ? c.respostasV2.map(r => [r.g, r.t, r.x]) : [];
  const v1 = Array.isArray(c.respostas) ? c.respostas.flatMap(g => Array.isArray(g) ? (g[1] || []).map(r => [g[0], r?.[0] ?? r?.t, r?.[1] ?? r?.x]) : []) : [];
  const rs = (v2.length ? v2 : v1).filter(r => r[2]).map(([g, t, x]) => `- ${g} / ${t}: ${String(x || '').replace(/\s+/g, ' ').slice(0, 400)}`).slice(0, 80).join('\n');
  return { cfg: c, texto: `${c.iaOrientacoes ? 'Orientações do dono:\n' + String(c.iaOrientacoes).slice(0, 2500) + '\n\n' : ''}Respostas aprovadas pela equipe (use como base, troque {variáveis} pelos dados reais ou deixe de fora):\n${rs}${artTxt ? '\n\n' + artTxt : ''}` };
}

export const PEDIDO_AUTO = 'Você está respondendo sozinho porque a equipe não está disponível agora. Responda a ÚLTIMA mensagem do cliente usando só as informações da ficha, das orientações e das respostas aprovadas. Se o cliente pedir para falar com uma pessoa, reclamar, pedir desconto, acordo, liberação do aparelho, cancelamento, troca, ou se você não tiver a informação, diga com educação que um atendente vai continuar o atendimento assim que possível e marque humano=true. Responda em JSON: {"resposta":"texto de no máximo 4 frases","humano":true|false}. Se o cliente escreveu em espanhol, responda em espanhol.';

export default async function handler(req, res) {
  if (cors(req, res)) return;
  try {
    const eu = await exigirEquipe(req, ['DONO', 'SUPORTE', 'FINANCEIRO', 'COMERCIAL']);
    const b = req.body || {}, txt = String(b.texto || '').slice(0, 4000);
    const EXTRA = { transcrever, traduzir, qualidade, copiloto, alertaRisco, treinoCliente, treinoAvaliar }; if (EXTRA[b.acao]) return res.json(await EXTRA[b.acao](b, eu));
    if (b.acao === 'relatorioHoje') { const { relatorioDiarioCrm } = await import('./crm-rotinas.js'); await relatorioDiarioCrm({}, true); return res.json({ ok: true }); }
    if (b.acao === 'status') { const chave = await chaveIA().catch(() => ''); if (!chave) return res.json({ chave: false, ok: false, erro: 'Nenhuma chave da IA salva. Cole a chave do Groq (começa com gsk_) em Ajustes do CRM ou no Painel do Dono → Configurações → Inteligência artificial.' });
      const t0 = Date.now(); try { const r = await groq([{ role: 'user', content: 'Responda só: OK' }], { max: 5, temperatura: 0 }); return res.json({ chave: true, ok: /ok/i.test(r), ms: Date.now() - t0, modelo: ULTIMO_MODELO, final: chave.slice(-4) }); }
      catch (e) { return res.json({ chave: true, ok: false, ms: Date.now() - t0, modelo: ULTIMO_MODELO || '(nenhum)', final: chave.slice(-4), erro: e.message }); } }
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
        { temperatura: 0, max: 400, json: true, tipo: 'visao', modelo: process.env.GROQ_MODELO_VISAO || '' });
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
    if (!conversa.trim()) throw Object.assign(new Error('A conversa ainda está vazia'), { status: 400 });
    const base = await baseConhecimento().catch(() => ({ texto: '' }));
    const cods = codigosNoTexto(conversa), equipe = /portais|chamado/i.test(String(b.canal || ''));
    const quem = equipe ? 'um vendedor ou gerente de loja parceira (equipe da loja, não o cliente final)' : 'o cliente';
    const conhecimento = `${REGRAS}\n\nCódigos de erro do sistema (use quando aparecerem na conversa; explique o passo a passo direto na mensagem, sem mandar links de ajuda):\n${errosTexto()}\n\n${base.texto || ''}`;
    if (b.acao === 'resumo') {
      const t = await groq([{ role: 'system', content: conhecimento }, { role: 'user', content: `Canal: ${String(b.canal || '').slice(0, 40)}\nQuem escreve: ${quem} (${String(b.cliente || '').slice(0, 80)})\n\nFicha:\n${ficha}\n\nConversa:\n${conversa}\n\nFaça o resumo para o atendente em JSON: {"pedido":"o que a pessoa quer, em 1 frase","feito":"o que já foi feito, em 1 frase (ou vazio)","falta":"próximo passo do atendente, em 1 frase","humor":"calmo|ansioso|irritado","urgencia":"baixa|media|alta","codigos":["códigos de erro citados"]}` }], { temperatura: 0.1, max: 350, json: true });
      let j = {}; try { j = JSON.parse(t); } catch (e) { j = { pedido: t }; }
      const texto = [j.pedido && '- Pedido: ' + j.pedido, j.feito && '- Já feito: ' + j.feito, j.falta && '- Próximo passo: ' + j.falta].filter(Boolean).join('\n');
      return res.json({ texto, ...j, codigos: [...new Set([...(j.codigos || []).map(String), ...cods])] });
    }
    const ex = await exemplosBons();
    const t = await groq([{ role: 'system', content: conhecimento + (ex ? '\n\n' + ex : '') }, { role: 'user', content: `Canal: ${String(b.canal || '').slice(0, 40)}\nQuem escreve: ${quem} (${String(b.cliente || '').slice(0, 80)})\nAtendente: ${String(b.atendente || '').slice(0, 30)}\n\nFicha:\n${ficha}\n\nConversa:\n${conversa}\n\nEscreva a PRÓXIMA mensagem que o atendente deve mandar, pronta para enviar: resolva o que foi pedido com passos claros (numerados se for um procedimento), use os dados da ficha quando ajudarem, as respostas aprovadas como base e, se houver código de erro, o passo a passo dele. No máximo 6 linhas, sem saudação repetida se a conversa já começou. ${ESTILOS[b.estilo] ? 'Estilo: ' + ESTILOS[b.estilo] : ''} Se a pessoa escreveu em espanhol, responda em espanhol. Responda em JSON: {"resposta":"mensagem pronta","alternativa":"uma segunda versão mais curta","motivo":"por que essa é a melhor resposta, em 1 frase"}` }], { temperatura: 0.35, max: 600, json: true });
    let j = {}; try { j = JSON.parse(t); } catch (e) { j = { resposta: t }; }
    return res.json({ texto: String(j.resposta || '').trim(), alternativa: String(j.alternativa || '').trim(), motivo: String(j.motivo || ''), codigos: cods });
  } catch (e) { return res.status(e.status || 500).json({ erro: e.message }); }
}
