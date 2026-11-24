// Autoatendimento do cliente pelo WhatsApp (NexumCell): responde na hora, sem esperar atendente.
//   vencimento · pede a troca do dia de vencimento (pedido VENCIMENTO, igual ao app)
//   roubo      · comunica roubo, furto ou perda e trava o aparelho (com confirmação)
//   pedidos    · andamento dos pedidos + declaração de quitação dos contratos quitados
//   comprar    · crédito pré-aprovado, vitrine e lojas da cidade · indique: link e valor da indicação
//   comprovante· lê a foto do comprovante, confere e libera 24 h enquanto o financeiro dá baixa
//   pagar    · valor de hoje + link de pagamento (PIX) de cada contrato
//   contrato · link do contrato em PDF
//   guia     · passo a passo com imagens de como pagar e usar o app
//   acordo   · renegociação: atraso de hoje, quitação com desconto, e o pedido de acordo em X vezes
//   liberar  · celular travado: libera 20 minutos para pagar (até 2 vezes por parcela)
// Usado pelo menu do robô, por palavras-chave e pela fila waSaida ({auto:'pagar'|...}) que a IA e o CRM gravam.

const so = (s) => String(s || '').replace(/\D/g, '');
const r2 = (n) => Math.round(n * 100) / 100;
const brl = (n) => 'R$ ' + (Number(n) || 0).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const fmtD = (d) => String(d || '').slice(0, 10).split('-').reverse().join('/');
const hoje = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const dias = (a, b) => Math.round((new Date(b) - new Date(a)) / 864e5);
export const URL_CLIENTE = (process.env.CLIENTE_URL || 'https://nexumrh.github.io/cliente/').replace(/\/?$/, '/');
const linkPagar = (tk) => URL_CLIENTE + '?pagar=' + encodeURIComponent(tk);
const linkContrato = (tk) => URL_CLIENTE + '?contrato=' + encodeURIComponent(tk) + '&pdf=1';

export const GUIA = [
  ['Entre no app NexumCell', 'Use CPF, data de nascimento e os 4 últimos dígitos do celular. Pelo link de pagamento você já cai direto nas parcelas.'],
  ['Toque em "Pagar com PIX"', 'A parcela do mês aparece primeiro, com o valor de hoje.'],
  ['Toque em "Copiar código PIX"', 'O código fica copiado no seu celular.'],
  ['Pague no app do seu banco', 'Abra o banco, entre em Pix, escolha "Pix Copia e Cola", cole o código e confirme.'],
  ['Pronto: pagamento confirmado', 'Confirma sozinho em até 1 minuto, e o celular libera se estava travado.'],
  ['Atrasou? Veja tudo em Faturas', 'Em Faturas você vê o que falta, baixa recibos e pode pedir acordo do atraso.'],
].map(([t, s], i) => ({ url: URL_CLIENTE + `ajuda/pagar-${i + 1}.png`, legenda: `*Passo ${i + 1} de 6 · ${t}*\n${s}` }));

export function valorHoje(p, ap) {
  const d = dias(p.venc, hoje());
  if (d < 0) return r2(p.valor * (1 - (+ap.descontoPct || 0) / 100));
  if (d === 0) return +p.valor;
  return r2(p.valor * (1 + (+ap.multaPct || 0) / 100 + ((+ap.moraDiaPct || 0) / 100) * d));
}
// mesma conta do app do cliente: parcelas futuras saem pelo valor principal (sem os juros)
export function quitacao(ap) {
  const n = +ap.nParcelas || (ap.parcelas || []).length, princ = n ? (+ap.financiado || 0) / n : 0, h = hoje();
  let total = 0, cheio = 0;
  for (const p of (ap.parcelas || []).filter((x) => !x.pago)) {
    const vh = valorHoje(p, ap), fut = p.venc > h;
    if (fut && princ > 0) { total += Math.min(princ, p.valor); cheio += p.valor; } else { total += vh; cheio += fut ? p.valor : vh; }
  }
  return { total: r2(total), desconto: r2(cheio - total) };
}
const linkQuitacao = (tk) => URL_CLIENTE + '?quitacao=' + encodeURIComponent(tk) + '&pdf=1';
const encerrado = (ap) => ap.quitado || ['QUITADO', 'CANCELADO', 'CANCELADA', 'REPROVADA'].includes(ap.status);

// contratos do cliente: pelo CPF da conversa ou pelo número de WhatsApp cadastrado
export async function contratosDe(db, numero, cpf) {
  const tel = so(numero).replace(/^55(?=\d{10,11}$)/, ''), variantes = [...new Set([tel, tel.length === 11 ? tel.slice(0, 2) + tel.slice(3) : tel.slice(0, 2) + '9' + tel.slice(2)])];
  let vendas = [];
  try {
    if (!cpf) for (const t of variantes) { const q = await db.collection('clientes').where('telefones', 'array-contains', t).limit(1).get(); if (!q.empty) { cpf = q.docs[0].id; break; } }
    if (cpf) vendas = (await db.collection('vendas').where('clienteCpf', '==', so(cpf)).get()).docs.map((d) => ({ id: d.id, ...d.data() }));
    if (!vendas.length) for (const t of variantes) { const q = await db.collection('vendas').where('cliente.telefones', 'array-contains', t).get(); if (!q.empty) { vendas = q.docs.map((d) => ({ id: d.id, ...d.data() })); break; } }
  } catch (e) { console.error('contratos', e.message); }
  const out = [];
  for (const v of vendas.filter((x) => x.aparelhoToken && !['REPROVADA', 'CANCELADA', 'PENDENTE', 'EM_ANALISE'].includes(x.status))) {
    try { const s = await db.collection('aparelhos').doc(v.aparelhoToken).get(); if (s.exists) out.push({ venda: v, ap: s.data(), tk: v.aparelhoToken }); } catch (e) { }
  }
  return { cpf, lista: out.sort((a, b) => (+b.venda.numero || 0) - (+a.venda.numero || 0)) };
}

const SEM_CONTRATO = 'Não encontrei um contrato NexumCell ligado a este número de WhatsApp. Para eu achar, envie numa mensagem só o *CPF do titular* e a *data de nascimento*, assim:\n123.456.789-00 10/05/1990';
const nomeAp = (c) => [c.ap.marca, c.ap.modelo].filter(Boolean).join(' ') || 'celular';

function textoPagar(c) {
  const ap = c.ap, h = hoje(), ab = (ap.parcelas || []).filter((p) => !p.pago).sort((a, b) => a.venc.localeCompare(b.venc)), atr = ab.filter((p) => p.venc < h);
  if (encerrado(ap) || !ab.length) return `*Contrato nº ${ap.vendaNumero}* (${nomeAp(c)}): está quitado, não há parcelas para pagar.`;
  const linhas = [`*Contrato nº ${ap.vendaNumero}* · ${nomeAp(c)}`];
  if (atr.length) linhas.push(`${atr.length} parcela(s) em atraso: *${brl(atr.reduce((s, p) => s + valorHoje(p, ap), 0))}* hoje (com multa e juros).`);
  else linhas.push(`Próxima parcela: ${ab[0].n}ª de ${ab.length + (ap.parcelas || []).filter((p) => p.pago).length}, *${brl(valorHoje(ab[0], ap))}*${ab[0].venc === h ? ' (vence hoje)' : ` (vence ${fmtD(ab[0].venc)})`}${ab[0].venc > h && +ap.descontoPct ? `, já com ${+ap.descontoPct}% de desconto por pagar antes` : ''}.`);
  linhas.push(`Pague pelo PIX neste link (abre direto, sem senha):\n${linkPagar(c.tk)}`);
  return linhas.join('\n');
}

// monta as mensagens de cada ação: [{texto} | {imagem:{url,legenda}}]; e devolve estado para gravar na conversa
export async function montar(db, acao, { numero, cpf, c: conversa = {}, cfg = {} }) {
  const { cpf: cpfAchado, lista } = await contratosDe(db, numero, cpf);
  const msgs = [], estado = cpfAchado && !cpf ? { cpf: cpfAchado, cliente: true } : {};
  const ativos = lista.filter((c) => !encerrado(c.ap)), h = hoje();
  if (acao === 'guia') {
    msgs.push({ texto: 'Veja como pagar sua parcela e usar o app NexumCell, passo a passo:' });
    GUIA.forEach((g) => msgs.push({ imagem: g }));
    const c = ativos[0];
    msgs.push({ texto: c ? `Seu link para pagar agora:\n${linkPagar(c.tk)}\n\nO app completo fica em ${URL_CLIENTE} (no Android, toque em "Instalar" ou "Adicionar à tela inicial").` : `O app fica em ${URL_CLIENTE} (no Android, toque em "Instalar" ou "Adicionar à tela inicial").` });
    return { msgs, estado };
  }
  if (!lista.length) return { msgs: [{ texto: SEM_CONTRATO }], estado: { ...estado, aguardandoCpf: acao } };
  if (acao === 'pagar') {
    (ativos.length ? ativos : lista).slice(0, 3).forEach((c) => msgs.push({ texto: textoPagar(c) }));
    if (ativos.length) msgs.push({ texto: 'Pagou? O app confirma sozinho e o celular libera em até 1 minuto. Quer ver como pagar com imagens? Responda *3*. Menu: *0*.' });
  } else if (acao === 'contrato') {
    lista.slice(0, 3).forEach((c) => msgs.push({ texto: `*Contrato nº ${c.ap.vendaNumero}* · ${nomeAp(c)} · ${c.ap.lojaNome || 'NexumCell'}\nAbra e toque em *Salvar como PDF* (ou Imprimir):\n${linkContrato(c.tk)}` }));
    msgs.push({ texto: 'Os recibos das parcelas pagas ficam no app, em *Faturas*.' });
  } else if (acao === 'acordo') {
    const c = ativos.find((x) => (x.ap.parcelas || []).some((p) => !p.pago && p.venc < h)) || ativos[0];
    if (!c) { msgs.push({ texto: 'Seus contratos estão quitados. Não há nada para renegociar.' }); return { msgs, estado }; }
    const ap = c.ap, atr = (ap.parcelas || []).filter((p) => !p.pago && p.venc < h), q = quitacao(ap);
    const tAtr = r2(atr.reduce((s, p) => s + valorHoje(p, ap), 0)), sMulta = r2(atr.reduce((s, p) => s + (+p.valor || 0), 0));
    const max = Math.min(12, Math.max(2, +cfg.acordoMaxParcelas || 4));
    const t = [`*Renegociação · contrato nº ${ap.vendaNumero}* (${nomeAp(c)})`];
    if (atr.length) t.push(`Em atraso: ${atr.length} parcela(s), *${brl(tAtr)}* hoje com multa e juros.`);
    else t.push('Você não tem parcelas em atraso.');
    t.push(`Quitar o contrato inteiro hoje: *${brl(q.total)}*${q.desconto > 0 ? ` (desconto de ${brl(q.desconto)} nos juros)` : ''}.`);
    t.push(`Pagar à vista pelo PIX (atraso ou quitação):\n${linkPagar(c.tk)}`);
    if (atr.length && cfg.acordoCliente !== 'nao' && !(ap.acordoPedidoEm && Date.now() - ap.acordoPedidoEm < 30 * 864e5)) {
      t.push(`\n*Parcelar o atraso:* responda com o número de vezes, de *1 a ${max}* (o atraso sem multa é ${brl(sMulta)}; a loja confirma os valores finais).${cfg.acordoLiberar !== 'nao' && !ap.roubo ? ` Ao pedir, o celular é liberado por ${Math.min(120, Math.max(0, +cfg.acordoLiberarHoras || 48))} h enquanto a loja formaliza.` : ''}`);
      estado.aguardandoAcordo = { tk: c.tk, max, ate: Date.now() + 2 * 3600e3 };
    } else if (atr.length && ap.acordoPedidoEm) t.push('\nVocê já pediu um acordo este mês: a loja vai entrar em contato por aqui.');
    msgs.push({ texto: t.join('\n') });
  } else if (acao === 'liberar') {
    const c = ativos.find((x) => (x.ap.parcelas || []).some((p) => !p.pago)) || null;
    if (!c) { msgs.push({ texto: 'Não encontrei parcela em aberto. Se o celular está travado mesmo assim, responda *10* para falar com o Suporte.' }); return { msgs, estado }; }
    const r = await liberar20(db, c);
    msgs.push({ texto: r.ok
      ? `Pronto! Liberei o seu ${nomeAp(c)} por *20 minutos* para você pagar a parcela ${r.parcela} (${r.usadas}ª de 2 liberações desta parcela). Pode levar até 1 minuto para destravar com internet ligada.\n\n${textoPagar(c)}`
      : `${r.erro}\n\nVocê ainda pode pagar por outro celular ou computador:\n${linkPagar(c.tk)}\n\nPara falar com o Suporte, responda *10*.` });
  } else if (acao === 'vencimento') {
    const c = ativos[0];
    if (!c) { msgs.push({ texto: 'Seus contratos estão quitados.' }); return { msgs, estado }; }
    const ab = (c.ap.parcelas || []).filter((p) => !p.pago).sort((a, b) => a.venc.localeCompare(b.venc));
    msgs.push({ texto: `*Mudar o dia do vencimento · contrato nº ${c.ap.vendaNumero}*\nHoje suas parcelas vencem todo dia *${+String(ab[0]?.venc || '').slice(8, 10) || '—'}*.\nResponda com o *novo dia* (de 1 a 28). A loja confere e confirma por aqui; pode haver ajuste proporcional na próxima parcela.` });
    estado.aguardandoVenc = { tk: c.tk, ate: Date.now() + 2 * 3600e3 };
  } else if (acao === 'roubo') {
    const c = ativos.find((x) => !(x.ap.roubo && !x.ap.roubo.liberadoEm)) || ativos[0];
    if (!c) { msgs.push({ texto: 'Não encontrei contrato ativo para travar. Responda *10* para falar com o Suporte.' }); return { msgs, estado }; }
    if (c.ap.roubo && !c.ap.roubo.liberadoEm) { msgs.push({ texto: `O ${nomeAp(c)} (contrato nº ${c.ap.vendaNumero}) já está com o comunicado de ${String(c.ap.roubo.tipo || 'roubo').toLowerCase()} ativo e travado. Responda *10* se precisar falar com o Suporte.` }); return { msgs, estado }; }
    msgs.push({ texto: `*Celular roubado, furtado ou perdido · ${nomeAp(c)} (contrato nº ${c.ap.vendaNumero})*\nO aparelho será *travado* assim que se conectar à internet, para ninguém usar. As parcelas continuam valendo.\n\nResponda numa mensagem só: *o que aconteceu* (roubo, furto ou perda) e *onde* (bairro e cidade).\nEx.: Roubo, Centro, Foz do Iguaçu` });
    estado.aguardandoRoubo = { tk: c.tk, passo: 1, ate: Date.now() + 2 * 3600e3 };
  } else if (acao === 'pedidos') {
    const nomes = { ACORDO: 'Acordo do atraso', VENCIMENTO: 'Troca do vencimento', ASSISTENCIA: 'Assistência técnica', PROTECAO: 'Proteção do aparelho', DADOS: 'Atualização de cadastro', COMPROVANTE: 'Conferência de comprovante', TROCA: 'Troca do aparelho' };
    const st = { ABERTO: 'recebido, aguardando a loja', RECEBIDO: 'em análise', ANDAMENTO: 'em andamento', CONCLUIDO: 'concluído', APROVADO: 'aprovado', RECUSADO: 'recusado', CANCELADO: 'cancelado' };
    let peds = [];
    for (const c of lista.slice(0, 3)) { try { (await db.collection('pedidos').where('token', '==', c.tk).get()).docs.forEach((d) => peds.push(d.data())); } catch (e) { } }
    peds = peds.sort((a, b) => (b.criadoEm || 0) - (a.criadoEm || 0)).slice(0, 5);
    msgs.push({ texto: peds.length ? '*Seus pedidos*\n' + peds.map((p) => `• ${nomes[p.tipo] || p.tipo} · contrato nº ${p.vendaNumero} · ${new Date(p.criadoEm).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}: *${st[p.status] || String(p.status || '').toLowerCase()}*${p.resposta ? `\n  Resposta: ${String(p.resposta).slice(0, 200)}` : ''}`).join('\n') : 'Você não tem pedidos abertos.' });
    const quit = lista.filter((c) => encerrado(c.ap) && c.ap.status !== 'CANCELADO' && (c.ap.parcelas || []).every((p) => p.pago));
    if (quit.length) msgs.push({ texto: '*Declaração de quitação*\n' + quit.slice(0, 3).map((c) => `Contrato nº ${c.ap.vendaNumero} · ${nomeAp(c)}: abra e toque em Salvar como PDF\n${linkQuitacao(c.tk)}`).join('\n\n') });
    else if (ativos.length) msgs.push({ texto: 'A declaração de quitação fica disponível aqui quando o contrato for quitado. Para quitar agora com desconto, responda *4*.' });
  } else if (acao === 'comprar') {
    const c = lista[0], ap = c.ap, pre = lista.map((x) => x.ap.preAprovado).find(Boolean);
    let vit = {}; try { vit = (await db.collection('publico').doc('vitrine').get()).data() || {}; } catch (e) { }
    const t = [];
    if (pre) t.push(`*Você tem crédito pré-aprovado para trocar de celular${pre.valor ? ` até ${brl(pre.valor)}` : ''}!* É só ir numa loja NexumCell com documento.`);
    else t.push('*Quer um celular novo?* Faça a pré-análise grátis pelo celular, sem compromisso:');
    t.push(URL_CLIENTE + 'seja-cliente.html' + (ap.lojaId ? '?l=' + encodeURIComponent(ap.lojaId) : ''));
    try { const lj = ap.lojaId ? (await db.collection('lojas').doc(ap.lojaId).get()).data() || {} : {};
      if (lj.cidade) { const q = (await db.collection('lojas').where('cidade', '==', lj.cidade).get()).docs.map((d) => d.data()).filter((l) => !l.encerrada).slice(0, 4);
        if (q.length) t.push(`\n*Lojas NexumCell em ${lj.cidade}:*\n` + q.map((l) => `• ${l.nome}${l.endereco ? ' · ' + l.endereco : ''}${l.telefone ? ' · ' + l.telefone : ''}`).join('\n')); } } catch (e) { }
    msgs.push({ texto: t.join('\n') });
    const tag = nxTag(ap.vendaNumero), link = URL_CLIENTE + 'seja-cliente.html?ind=' + tag + (ap.lojaId ? '&l=' + encodeURIComponent(ap.lojaId) : '');
    msgs.push({ texto: `*Indique e ganhe*${+vit.indicacaoValor ? `: ${brl(vit.indicacaoValor)} de desconto na sua parcela` : ': desconto na sua parcela'} por amigo que comprar.\nMande este link para os amigos:\n${link}\nNa loja, o amigo também pode dizer o código *NXC-${ap.vendaNumero}*.` });
  }
  return { msgs, estado };
}
function nxTag(n) { let x = (Math.max(0, Math.floor(+n || 0)) * 1103515245 + 12345) % 8031810176, s = ''; for (let i = 0; i < 7; i++) { s = String.fromCharCode(65 + (x % 26)) + s; x = Math.floor(x / 26); } return 'N' + s; }

// troca do vencimento: o cliente respondeu o novo dia
export async function pedirVencimento(db, pend, dia) {
  const ap = (await db.collection('aparelhos').doc(pend.tk).get()).data() || {};
  await db.collection('pedidos').add({ tipo: 'VENCIMENTO', token: pend.tk, vendaId: ap.vendaId || '', vendaNumero: ap.vendaNumero || 0, lojaId: ap.lojaId || '', lojaNome: ap.lojaNome || '', clienteNome: ap.clienteNome || '',
    marca: ap.marca || '', modelo: ap.modelo || '', imei: ap.imei || '', descricao: `Novo dia: ${dia} · pedido pelo WhatsApp`, status: 'ABERTO', criadoEm: Date.now(), novoDia: dia, origem: 'whatsapp' });
  return `Pedido registrado: vencimento para todo dia *${dia}* no contrato nº ${ap.vendaNumero}. A loja confere e confirma por aqui. Para acompanhar, responda *8*.`;
}
// roubo/furto/perda: passo 1 (o que e onde) → passo 2 (CONFIRMO) → trava
export async function passoRoubo(db, pend, texto) {
  const t = String(texto || '').trim();
  if (pend.passo === 1) {
    const tipo = /furt/i.test(t) ? 'Furto' : /perd|perdi/i.test(t) ? 'Perda' : /roub|assalt/i.test(t) ? 'Roubo' : '';
    const local = t.replace(/^\s*(roubo|furto|perda|perdi|fui roubad[oa]|assalto)\s*[,.:;-]?\s*/i, '').slice(0, 120);
    if (!tipo || local.length < 3) return { resposta: 'Me diga numa mensagem só o que aconteceu (roubo, furto ou perda) e onde. Ex.: Roubo, Centro, Foz do Iguaçu', pend };
    return { resposta: `Confirma que o celular *não está com você* e quer que ele seja *travado*?\n${tipo} · ${local}\n\nResponda *CONFIRMO* para travar agora, ou *0* para cancelar.`, pend: { ...pend, passo: 2, tipo, local } };
  }
  if (!/^confirmo\b/i.test(t)) return { resposta: 'Para travar, responda *CONFIRMO*. Para cancelar, responda *0*.', pend };
  const ref = db.collection('aparelhos').doc(pend.tk), ap = (await ref.get()).data() || {};
  const roubo = { tipo: pend.tipo, data: hoje(), local: pend.local, bo: '', relato: 'Comunicado pelo WhatsApp', em: Date.now(), via: 'WHATSAPP', localizar: false };
  await ref.set({ roubo }, { merge: true });
  await db.collection('logs').add({ em: Date.now(), acao: 'Roubo/perda comunicado pelo WhatsApp', alvo: pend.tk, detalhe: `nº ${ap.vendaNumero} · ${ap.clienteNome || ''} · ${pend.tipo} · ${pend.local}`, nome: 'Assistente NexumCell (WhatsApp)', role: 'IA' }).catch(() => {});
  return { resposta: `Pronto. O ${[ap.marca, ap.modelo].filter(Boolean).join(' ')} (contrato nº ${ap.vendaNumero}) será *travado* assim que se conectar à internet. A loja e o Suporte já foram avisados.\n\n*Agora faça isto:*\n1. Registre o boletim de ocorrência (na delegacia ou pela Delegacia Online da Polícia Civil).\n2. Peça à operadora o bloqueio do chip.\n3. Troque as senhas do e-mail, banco e redes sociais.\nQuando tiver o número do B.O., mande aqui.`, pend: null, fila: 'suporte' };
}

// comprovante (foto): a IA lê, confere com a parcela e o recebedor, e libera 24 h enquanto o financeiro dá baixa
export async function conferirComprovante(db, { numero, cpf, dataUrl, arquivo, ler, cfg = {} }) {
  const { lista } = await contratosDe(db, numero, cpf), h = hoje();
  const c = lista.filter((x) => !encerrado(x.ap)).find((x) => (x.ap.parcelas || []).some((p) => !p.pago));
  if (!c) return null;                                   // sem contrato em aberto: a foto segue para a equipe
  let j = {}; try { j = await ler(dataUrl); } catch (e) { console.error('comprovante', e.message); return null; }
  if (!j || !j.ehComprovante) return null;               // não é comprovante (foto do aparelho, documento...)
  const ap = c.ap, ab = (ap.parcelas || []).filter((p) => !p.pago).sort((a, b) => a.venc.localeCompare(b.venc)), par = ab[0];
  const valor = Math.round((+String(j.valor || 0).replace(',', '.') || 0) * 100) / 100, data = String(j.data || '').slice(0, 10);
  const id = String(j.idTransacao || '').replace(/\s+/g, '').slice(0, 80), idDoc = id.replace(/[\/]/g, '_');
  const problemas = [];
  if (!(valor > 0)) problemas.push('valor ilegível');
  else if (valor < valorHoje(par, ap) * 0.98 && valor < par.valor * 0.98) problemas.push(`valor ${brl(valor)} menor que a parcela (${brl(valorHoje(par, ap))})`);
  if (!data || dias(data, h) > 3 || dias(data, h) < 0) problemas.push(data ? `data ${fmtD(data)} fora do prazo` : 'sem data');
  const receb = String(ap.recebedor || cfg.recebedor || 'NEXUMCELL').toLowerCase().split(/\s+/)[0];
  if (j.recebedor && receb && !String(j.recebedor).toLowerCase().includes(receb)) problemas.push(`recebedor "${j.recebedor}"`);
  if (String(j.duvidas || '').trim()) problemas.push('imagem com sinal de edição ou corte');
  if (id) { try { const a = await db.collection('comprovantes').doc(idDoc).get(), b = await db.collection('comprovantesWa').doc(idDoc).get(); if (a.exists || b.exists) problemas.push('comprovante já enviado antes'); } catch (e) { } }
  else problemas.push('sem ID da transação');
  const ok = !problemas.length, agora = Date.now(), horas = Math.max(0, Math.min(72, +cfg.comprovanteLiberarHoras || 24));
  if (ok && id) await db.collection('comprovantesWa').doc(idDoc).set({ em: agora, token: c.tk, vendaNumero: ap.vendaNumero, n: par.n, valor, data, numero });
  const libera = ok && horas > 0 && !ap.roubo;
  if (libera) await db.collection('aparelhos').doc(c.tk).set({ liberadoAte: Math.max(+ap.liberadoAte || 0, agora + horas * 3600e3), modoPor: 'Comprovante enviado pelo WhatsApp', modoMotivo: `Liberado ${horas} h enquanto o financeiro confere o comprovante da parcela ${par.n}` }, { merge: true });
  await db.collection('pedidos').add({ tipo: 'COMPROVANTE', token: c.tk, vendaId: ap.vendaId || '', vendaNumero: ap.vendaNumero || 0, lojaId: ap.lojaId || '', lojaNome: ap.lojaNome || '', clienteNome: ap.clienteNome || '',
    marca: ap.marca || '', modelo: ap.modelo || '', imei: ap.imei || '', status: 'ABERTO', criadoEm: agora, origem: 'whatsapp', arquivo: arquivo || null,
    descricao: `Comprovante pelo WhatsApp: ${j.tipo || 'PIX'} de ${brl(valor)}${data ? ' em ' + fmtD(data) : ''}${j.pagador ? ' · pagador ' + j.pagador : ''}${id ? ' · ID ' + id : ''} · parcela ${par.n}. ${ok ? `Conferido pela IA${libera ? `; celular liberado ${horas} h` : ''}. Falta dar a baixa no CRM.` : 'Conferir: ' + problemas.join('; ') + '.'}${arquivo?.url ? ' Foto: ' + arquivo.url : ''}`,
    comprovante: { valor, data, id, pagador: j.pagador || '', recebedor: j.recebedor || '', n: par.n, ok, problemas } });
  return { ok, texto: ok
    ? `Recebi o seu comprovante de *${brl(valor)}* (${fmtD(data)}), parcela ${par.n} do contrato nº ${ap.vendaNumero}. Está tudo certo.${libera ? ` Liberei o celular por *${horas} horas* enquanto o financeiro confirma a baixa.` : ''} Obrigado!`
    : `Recebi o seu comprovante. Vou passar para o *financeiro* conferir (${problemas[0]}). Eles respondem por aqui. Se pagou pelo link da NexumCell, a baixa e a liberação são automáticas em até 1 minuto.` };
}

async function liberar20(db, c) {
  const ref = db.collection('aparelhos').doc(c.tk), ap = (await ref.get()).data() || {}, agora = Date.now(), h = hoje();
  if (ap.roubo) return { erro: 'Este aparelho está com bloqueio especial. Responda *10* para falar com o Suporte.' };
  const parc = (ap.parcelas || []).filter((p) => !p.pago).sort((a, b) => a.venc.localeCompare(b.venc))[0];
  if (!parc) return { erro: 'Não há parcela em aberto neste contrato.' };
  const usos = { ...(ap.lib20Parcelas || {}) }, ja = +usos[parc.n] || 0;
  if (ja >= 2) return { erro: `A parcela ${parc.n} já usou as 2 liberações de 20 minutos.` };
  usos[parc.n] = ja + 1;
  await ref.set({ liberadoAte: Math.max(+ap.liberadoAte || 0, agora + 20 * 60e3), lib20Em: agora, lib20Parcelas: usos, modoPor: 'Assistente NexumCell (WhatsApp, 20 min para pagar)', modoMotivo: `Liberação de 20 minutos para pagar a parcela ${parc.n} (${usos[parc.n]}ª de 2)` }, { merge: true });
  await db.collection('logs').add({ em: agora, acao: 'Liberação de 20 min para pagar (WhatsApp)', alvo: c.tk, detalhe: `nº ${ap.vendaNumero} · ${ap.clienteNome || ''} · parcela ${parc.n}${parc.venc < h ? ' (atrasada)' : ''} · ${usos[parc.n]}ª de 2`, nome: 'Assistente NexumCell (WhatsApp)', role: 'IA' }).catch(() => {});
  return { ok: true, parcela: parc.n, usadas: usos[parc.n] };
}

// o cliente respondeu o número de vezes do acordo
export async function pedirAcordo(db, pend, n, cfg = {}) {
  const ref = db.collection('aparelhos').doc(pend.tk), ap = (await ref.get()).data() || {}, h = hoje(), agora = Date.now();
  const atraso = (ap.parcelas || []).filter((p) => !p.pago && p.venc < h);
  if (!atraso.length) return 'Não há mais parcelas em atraso neste contrato. Obrigado!';
  if (ap.acordoPedidoEm && agora - ap.acordoPedidoEm < 30 * 864e5) return 'Você já pediu um acordo este mês. A loja vai entrar em contato por aqui.';
  const valor = r2(atraso.reduce((s, p) => s + (+p.valor || 0), 0)), horas = Math.min(120, Math.max(0, +cfg.acordoLiberarHoras || 48));
  const libera = cfg.acordoLiberar !== 'nao' && horas > 0 && !ap.roubo;
  await db.collection('pedidos').add({ tipo: 'ACORDO', token: pend.tk, vendaId: ap.vendaId || '', vendaNumero: ap.vendaNumero || 0, lojaId: ap.lojaId || '', lojaNome: ap.lojaNome || '',
    clienteNome: ap.clienteNome || '', marca: ap.marca || '', modelo: ap.modelo || '', imei: ap.imei || '', status: 'ABERTO', criadoEm: agora, origem: 'whatsapp',
    descricao: `Quer acertar ${atraso.length} parcela(s) em atraso (${brl(valor)}) em ${n}x. Pedido pelo WhatsApp.`,
    acordo: { parcelas: n, valorAtraso: valor, qtdAtraso: atraso.length, liberadoAte: libera ? agora + horas * 3600e3 : 0 } });
  await ref.set({ acordoPedidoEm: agora, ...(libera ? { liberadoAte: Math.max(+ap.liberadoAte || 0, agora + horas * 3600e3), modoPor: 'Pedido de acordo pelo WhatsApp', modoMotivo: `Liberado ${horas} h enquanto a loja formaliza o acordo` } : {}) }, { merge: true });
  return `Pedido de acordo registrado: *${atraso.length} parcela(s)* em atraso (${brl(valor)}) em *${n}x*.${libera ? ` Seu celular foi liberado por ${horas} horas.` : ''}\nO financeiro da NexumCell confere e confirma os valores com você por aqui.`;
}

// intenção pela mensagem livre do cliente
export function intencao(t) {
  const s = String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (/(como (eu )?pag|como (usa|uso|funciona) o app|passo a passo|tutorial|nao sei pagar|ensina)/.test(s)) return 'guia';
  if (/(roubad|roubaram|furtad|furtaram|assaltad|robad|robaron)/.test(s)) return 'roubo';
  if (/(como pago|como se paga|como usar la app)/.test(s)) return 'guia';
  if (/(pagar (mi|la) cuota|link de pago|cuanto debo|mi cuota)/.test(s)) return 'pagar';
  if (/(renegoci|acordo|parcelar (o )?atraso|negociar|quitar|quitacao|desconto pra quitar|valor pra quitar)/.test(s)) return 'acordo';
  if (/(bloquead|travad|trancad|liberar? (o )?(cel|aparelho)|desbloque)/.test(s)) return 'liberar';
  if (/(roubad|roubaram|furtad|furtaram|perdi (o|meu) (cel|aparelho)|assaltad)/.test(s)) return 'roubo';
  if (/(mudar|trocar|alterar).{0,20}(dia|data).{0,15}venc/.test(s)) return 'vencimento';
  if (/(declaracao de quitacao|carta de quitacao|meus pedidos|meu pedido|andamento)/.test(s)) return 'pedidos';
  if (/(comprar (outro|um|mais um) (cel|aparelho)|celular novo|trocar de celular|pre.?aprovad|indicar|indicacao|indique)/.test(s)) return 'comprar';
  if (/(contrato|2 ?a via do contrato|segunda via do contrato)/.test(s)) return 'contrato';
  if (/(boleto|pix|link (de|pra|para) pag|pagar (a |minha )?parcela|segunda via|2 ?a via|fatura|quanto (eu )?devo|valor da parcela)/.test(s)) return 'pagar';
  return '';
}

// o cliente mandou "CPF + nascimento" para achar o contrato (mesma conferência do login do app)
export async function conferirCpf(db, texto) {
  const t = String(texto || ''), cpf = so((t.match(/\d{3}\.?\d{3}\.?\d{3}-?\d{2}/) || [''])[0]);
  const d = t.replace(/\d{3}\.?\d{3}\.?\d{3}-?\d{2}/, '').match(/(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/);
  if (cpf.length !== 11 || !d) return { erro: 'Envie numa mensagem só o CPF e a data de nascimento, assim:\n123.456.789-00 10/05/1990' };
  const ano = d[3].length === 2 ? (+d[3] > 30 ? '19' : '20') + d[3] : d[3], nasc = `${ano}-${d[2].padStart(2, '0')}-${d[1].padStart(2, '0')}`;
  try {
    const vs = (await db.collection('vendas').where('clienteCpf', '==', cpf).get()).docs.map((x) => x.data());
    let ok = vs.some((v) => String(v.cliente?.nasc || v.clienteNasc || '').slice(0, 10) === nasc);
    if (!ok) { const c = (await db.collection('clientes').doc(cpf).get()).data() || {}; ok = String(c.nasc || '').slice(0, 10) === nasc; }
    if (ok) return { cpf, nome: vs[0]?.clienteNome || '' };
  } catch (e) { console.error('cpf', e.message); }
  return { erro: 'CPF e data de nascimento não conferem com nenhum contrato NexumCell. Confira e envie de novo, ou responda *10* para falar com o Suporte.' };
}

// espanhol: clientes do Paraguai e da Argentina
export function ehEspanhol(t) { const s = ' ' + String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') + ' ';
  return /\b(hola|buen(os|as) (dias|tardes|noches)|quiero|necesito|cuota|celular bloqueado|como pago|gracias|por favor|tengo|puedo|ustedes|deuda|pagar la)\b/.test(s) && !/\b(obrigad|voce|quero|preciso|parcela)\b/.test(s); }
