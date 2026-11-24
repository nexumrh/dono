// Autoatendimento do cliente pelo WhatsApp (NexumCell): responde na hora, sem esperar atendente.
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
    if (!c) { msgs.push({ texto: 'Não encontrei parcela em aberto. Se o celular está travado mesmo assim, responda *6* para falar com o Suporte.' }); return { msgs, estado }; }
    const r = await liberar20(db, c);
    msgs.push({ texto: r.ok
      ? `Pronto! Liberei o seu ${nomeAp(c)} por *20 minutos* para você pagar a parcela ${r.parcela} (${r.usadas}ª de 2 liberações desta parcela). Pode levar até 1 minuto para destravar com internet ligada.\n\n${textoPagar(c)}`
      : `${r.erro}\n\nVocê ainda pode pagar por outro celular ou computador:\n${linkPagar(c.tk)}\n\nPara falar com o Suporte, responda *6*.` });
  }
  return { msgs, estado };
}

async function liberar20(db, c) {
  const ref = db.collection('aparelhos').doc(c.tk), ap = (await ref.get()).data() || {}, agora = Date.now(), h = hoje();
  if (ap.roubo) return { erro: 'Este aparelho está com bloqueio especial. Responda *6* para falar com o Suporte.' };
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
  if (/(renegoci|acordo|parcelar (o )?atraso|negociar|quitar|quitacao|desconto pra quitar|valor pra quitar)/.test(s)) return 'acordo';
  if (/(bloquead|travad|trancad|liberar? (o )?(cel|aparelho)|desbloque)/.test(s)) return 'liberar';
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
  return { erro: 'CPF e data de nascimento não conferem com nenhum contrato NexumCell. Confira e envie de novo, ou responda *6* para falar com o Suporte.' };
}
