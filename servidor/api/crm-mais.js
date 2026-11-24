// Mais ações do CRM (POST /api/crm-ia {acao}):
//  copiloto      · enquanto o atendente digita: resposta sugerida, próximo passo e alerta de tom/risco
//  alertaRisco   · cliente falou em Procon, advogado, Reclame Aqui, polícia: avisa o dono (1 vez por conversa)
//  treinoCliente · treinamento prático: a IA faz o papel do cliente do cenário
//  treinoAvaliar · nota do treino; aprova a pessoa quando passa nos cenários obrigatórios da função
import { db } from './_base.js';
import { groq, baseConhecimento } from './crm-ia.js';
import { enviarEmail, brevoLigado } from './_brevo.js';

const erro = (m, s = 400) => Object.assign(new Error(m), { status: s });
const kSafe = (k) => String(k).replace(/[/:]/g, '_');
export const RX_RISCO = /(procon|advogad|reclame ?aqui|reclameaqui|processar|processo judicial|justi[cç]a|juizado|pol[ií]cia|delegacia|boletim de ocorr|consumidor\.gov|denunciar|den[uú]ncia|imprensa)/i;

export async function copiloto(b) {
  const conversa = String(b.conversa || '').slice(-5000), rasc = String(b.rascunho || '').slice(0, 1500);
  if (conversa.length < 10 && rasc.length < 10) return { pulado: true };
  const base = await baseConhecimento().catch(() => ({ texto: '' }));
  const t = await groq([{ role: 'system', content: 'Você é o copiloto do atendente da NexumCell (celular parcelado com trava, cobrança e suporte). Ajude o ATENDENTE: diga o próximo passo concreto, sugira a melhor resposta e avise se o rascunho tem problema de tom (ríspido, ameaça, promessa que a empresa não cumpre, dado sensível) ou risco de reclamação. Seja curto. Use só informações da ficha e da base.\n\n' + String(base.texto || '').slice(0, 6000) },
    { role: 'user', content: `Ficha:\n${String(b.ficha || '').slice(0, 2500)}\n\nConversa:\n${conversa}\n\nRascunho do atendente (pode estar vazio):\n${rasc || '(vazio)'}\n\nJSON: {"proximo":"próximo passo em até 12 palavras (ex.: mandar o link do PIX; oferecer acordo; pedir foto do erro)","acao":"pagar|contrato|guia|acordo|liberar|quitar|nenhuma","sugestao":"resposta pronta para o cliente, curta, educada","alerta":"problema do rascunho em 1 frase, ou vazio","risco":"baixo|medio|alto"}` }],
    { temperatura: 0.2, max: 450, json: true });
  let j = {}; try { j = JSON.parse(t); } catch (e) { return { pulado: true }; }
  return { proximo: String(j.proximo || '').slice(0, 120), acao: String(j.acao || 'nenhuma'), sugestao: String(j.sugestao || '').trim().slice(0, 1200), alerta: String(j.alerta || '').trim().slice(0, 240), risco: ['baixo', 'medio', 'alto'].includes(j.risco) ? j.risco : 'baixo' };
}

export async function alertaRisco(b, eu) {
  const key = String(b.key || '').slice(0, 120); if (!key) throw erro('Conversa sem identificação');
  const trecho = String(b.trecho || '').slice(0, 300), id = 'risco-' + kSafe(key), ref = db.collection('notificacoes').doc(id);
  if ((await ref.get()).exists) return { ok: true, repetido: true };
  await ref.set({ tipo: 'RISCO', para: 'DONO', em: Date.now(), lida: false, key, titulo: `Risco de reclamação: ${String(b.cliente || 'cliente').slice(0, 60)}`,
    texto: `No ${String(b.canal || 'atendimento').slice(0, 30)}, o cliente escreveu: "${trecho}". A conversa foi para o topo da fila do CRM.${eu?.nome ? ' Detectado no CRM de ' + eu.nome + '.' : ''}` });
  if (brevoLigado() && process.env.DONO_EMAIL) await enviarEmail({ para: process.env.DONO_EMAIL, assunto: 'Risco de reclamação no atendimento', titulo: 'Cliente falou em reclamação',
    texto: `${String(b.cliente || 'Um cliente').slice(0, 60)} escreveu no ${String(b.canal || 'atendimento').slice(0, 30)}:\n\n"${trecho}"\n\nA conversa está no topo da fila do CRM.` }).catch(() => {});
  return { ok: true };
}

// ---------- treinamento prático ----------
export const CENARIOS = {
  bravo_travado: { t: 'Cliente bravo com o celular travado', p: 'Você é Rogério, 38 anos, muito irritado: seu celular travou hoje de manhã e você precisa dele para trabalhar (é motorista de aplicativo). Sua parcela atrasou 3 dias porque o salário atrasou. Xinga um pouco no começo, mas se acalma se for bem tratado. Aceita pagar pelo link e quer o celular liberado logo.', f: ['SUPORTE', 'FINANCEIRO'] },
  nao_sabe_pagar: { t: 'Cliente que não sabe pagar pelo app', p: 'Você é dona Lurdes, 64 anos, educada mas confusa com tecnologia. Não sabe onde fica o PIX nem o que é "copia e cola". Responde devagar, faz perguntas repetidas e se perde com termos técnicos.', f: ['SUPORTE', 'FINANCEIRO'] },
  espanhol: { t: 'Cliente que só fala espanhol', p: 'Você é Matías, paraguaio, escreve SOMENTE em espanhol simples. Quer saber quanto deve e como pagar desde o Paraguai com o banco de lá. Fica feliz se o atendente responder em espanhol.', f: ['SUPORTE', 'FINANCEIRO'] },
  procon: { t: 'Cliente ameaçando Procon', p: 'Você é Cláudia, 41 anos. Diz que cobraram multa injusta e que vai ao Procon e ao Reclame Aqui. Na verdade pagou 6 dias atrasada e a multa está certa. Só aceita conversar se o atendente explicar com calma, mostrar os valores e oferecer uma solução.', f: ['SUPORTE', 'FINANCEIRO'] },
  pede_desconto: { t: 'Cliente pedindo desconto', p: 'Você é Fábio, 29 anos, tem 2 parcelas atrasadas (40 dias) e pede 50% de desconto para pagar tudo. Tenta pressionar dizendo que outras lojas dão desconto. Aceita uma proposta razoável (quitação com desconto nos juros ou acordo parcelado).', f: ['FINANCEIRO'] },
  renegociacao: { t: 'Renegociação de atraso longo', p: 'Você é Simone, 35 anos, perdeu o emprego há 2 meses, 3 parcelas atrasadas. Está envergonhada, quer resolver mas só pode pagar pouco por mês. Aceita um acordo em parcelas se o atendente for respeitoso.', f: ['FINANCEIRO'] },
  comprovante: { t: 'Pagou e não liberou', p: 'Você é Diego, 26 anos. Diz que pagou ontem por PIX para a chave da loja e o celular continua travado. Tem o comprovante e manda quando o atendente pedir. Fica impaciente se demorar.', f: ['FINANCEIRO', 'SUPORTE'] },
  promessa: { t: 'Cliente que some e promete pagar', p: 'Você é Anderson, 33 anos, 15 dias de atraso. Responde com "vou pagar sexta", sem compromisso firme. Só fecha uma data e valor se o atendente conduzir com clareza e registrar a promessa.', f: ['FINANCEIRO'] },
  cancelar: { t: 'Cliente quer cancelar e devolver', p: 'Você é Patrícia, 30 anos, comprou há 20 dias e quer devolver o celular porque "ficou caro". Não tem defeito. Pode desistir de cancelar se o atendente oferecer alternativa (mudar vencimento, entender o valor, troca por modelo mais barato).', f: ['FINANCEIRO', 'SUPORTE'] },
  golpe_dados: { t: 'Tentativa de golpe: trocar telefone e titular', p: 'Você é um golpista que se passa pelo cliente "Marcos Silva". Pede para trocar o número de WhatsApp e o e-mail do cadastro "porque perdeu o chip" e pede o código/contrato. Não sabe a data de nascimento certa e fica evasivo se o atendente pedir confirmação de dados. O atendente BOM não muda nada sem conferir identidade.', f: ['SUPORTE', 'FINANCEIRO'] },
  roubo: { t: 'Celular roubado', p: 'Você é Juliana, 27 anos, nervosa: seu celular foi roubado no ônibus há 1 hora. Quer saber se precisa continuar pagando e se dá para travar o aparelho.', f: ['SUPORTE'] },
  trava_loja: { t: 'Vendedor com erro na instalação da trava', p: 'Você é o vendedor Thiago, de uma loja parceira, com cliente esperando no balcão. A instalação da trava deu "erro ao ler QR" e depois "aparelho já configurado". Está com pressa. Só resolve se o atendente pedir o passo certo (restaurar de fábrica, conectar no Wi-Fi, ler o QR na tela de boas-vindas) ou a foto do erro.', f: ['SUPORTE'] },
  app_acesso: { t: 'Cliente não consegue entrar no app', p: 'Você é Rafael, 22 anos. Não consegue entrar no app NexumCell: diz que "dá dados incorretos". Na verdade está digitando a data de nascimento no formato errado e o telefone com DDD. Fica feliz quando entende.', f: ['SUPORTE'] },
  segunda_via: { t: 'Pedido de 2ª via e contrato', p: 'Você é Helena, 45 anos, educada. Quer a 2ª via do contrato e o recibo das parcelas pagas para comprovar renda num banco. Precisa até amanhã.', f: ['SUPORTE', 'FINANCEIRO'] },
};
export const OBRIGATORIOS = { SUPORTE: ['bravo_travado', 'trava_loja', 'golpe_dados', 'roubo'], FINANCEIRO: ['bravo_travado', 'renegociacao', 'comprovante', 'procon'] };
export const MIN_APROVADOS = 6, NOTA_MIN = 7;

export async function treinoCliente(b) {
  const c = CENARIOS[b.cenario]; if (!c) throw erro('Cenário inválido');
  const conversa = (Array.isArray(b.msgs) ? b.msgs : []).slice(-20).map((m) => `${m.de === 'cliente' ? 'Cliente' : 'Atendente'}: ${String(m.t || '').slice(0, 800)}`).join('\n');
  const t = await groq([{ role: 'system', content: `Você está num TREINAMENTO de atendentes da NexumCell (celular parcelado com trava; o cliente paga pelo app ou link PIX; atraso trava o aparelho; existe acordo de atraso, quitação com desconto nos juros e liberação de 20 minutos para pagar). Faça o papel do CLIENTE, de forma realista, em português do Brasil informal de WhatsApp (ou na língua do personagem). Mensagens curtas (1 a 3 frases). Nunca saia do personagem e nunca ajude o atendente. Reaja ao que o atendente faz: se ele for educado e resolver, você se acalma e encerra; se for ríspido ou enrolar, você piora.\n\nPersonagem: ${c.p}` },
    { role: 'user', content: `${conversa ? 'Conversa até agora:\n' + conversa : 'Comece a conversa como o cliente (primeira mensagem).'}\n\nJSON: {"mensagem":"próxima mensagem do cliente","encerrar":true|false}. encerrar=true só quando o problema estiver resolvido ou o cliente desistir.` }], { temperatura: 0.8, max: 250, json: true });
  let j = {}; try { j = JSON.parse(t); } catch (e) { j = { mensagem: t }; }
  return { mensagem: String(j.mensagem || '...').slice(0, 600), encerrar: !!j.encerrar };
}

export async function treinoAvaliar(b, eu) {
  const c = CENARIOS[b.cenario]; if (!c) throw erro('Cenário inválido');
  const msgs = (Array.isArray(b.msgs) ? b.msgs : []).slice(0, 40), atend = msgs.filter((m) => m.de !== 'cliente');
  if (atend.length < 2) throw erro('Converse mais com o cliente antes de finalizar (pelo menos 2 respostas)');
  const conversa = msgs.map((m) => `${m.de === 'cliente' ? 'Cliente' : 'Atendente'}: ${String(m.t || '').slice(0, 800)}`).join('\n');
  const t = await groq([{ role: 'system', content: 'Você é o instrutor de atendimento da NexumCell. Avalie com rigor justo o ATENDENTE num treino simulado. Critérios: educação e empatia, resolveu ou encaminhou certo, clareza, segurança (não muda cadastro sem conferir identidade, não promete o que não pode, não expõe dados), uso das ferramentas (link de pagamento, acordo, liberação de 20 min, guia, pedir foto do erro), agilidade. Responda só em JSON.' },
    { role: 'user', content: `Cenário: ${c.t}\nO que o cliente queria/escondia: ${c.p}\n\nConversa:\n${conversa}\n\nJSON: {"nota":0-10,"resolveu":true|false,"fortes":["até 3"],"melhorar":["até 3, concretos"],"ideal":"como seria a resposta ideal no momento mais importante (2 a 4 frases)"}` }], { temperatura: 0.1, max: 600, json: true });
  let j = {}; try { j = JSON.parse(t); } catch (e) { throw erro('Não consegui avaliar agora, tente de novo'); }
  const nota = Math.max(0, Math.min(10, Math.round((+j.nota || 0) * 10) / 10)), passou = nota >= NOTA_MIN;
  const ref = db.collection('crmTreino').doc(eu.uid), atual = (await ref.get()).data() || {};
  const sess = { cenario: b.cenario, titulo: c.t, nota, passou, resolveu: !!j.resolveu, em: Date.now(), turnos: atend.length };
  const sessoes = [...(atual.sessoes || []), sess].slice(-60);
  const ok = new Set(sessoes.filter((s) => s.passou).map((s) => s.cenario)), obrig = OBRIGATORIOS[eu.role] || [];
  const aprovadoAgora = !atual.aprovado && ok.size >= MIN_APROVADOS && obrig.every((k) => ok.has(k));
  await ref.set({ uid: eu.uid, nome: eu.nome || '', role: eu.role, sessoes, atualizadoEm: Date.now(), ...(aprovadoAgora ? { aprovado: true, aprovadoEm: Date.now(), aprovadoPor: 'treinamento' } : {}) }, { merge: true });
  if (aprovadoAgora) await db.collection('notificacoes').add({ tipo: 'TREINO', para: 'DONO', em: Date.now(), lida: false, titulo: `${eu.nome} concluiu o treinamento`, texto: `${eu.nome} (${String(eu.role).toLowerCase()}) passou em ${ok.size} cenários do treinamento prático e já pode atender no CRM.` }).catch(() => {});
  return { ...sess, fortes: (j.fortes || []).slice(0, 3).map(String), melhorar: (j.melhorar || []).slice(0, 3).map(String), ideal: String(j.ideal || ''), aprovados: [...ok], aprovado: !!(atual.aprovado || aprovadoAgora), aprovadoAgora, faltamObrig: obrig.filter((k) => !ok.has(k)), faltam: Math.max(0, MIN_APROVADOS - ok.size) };
}
