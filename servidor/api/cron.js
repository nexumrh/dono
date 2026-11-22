// Rotinas automáticas (todo dia):
//   manhã (9h de Brasília): lembretes de vencimento e atraso aos clientes (Brevo) + liga o robô de voz do Asaas
//                           para quem passou de X dias de atraso (e desliga quando regulariza)
//   noite (19h de Brasília): resumo do dia para o dono (notificação no portal + e-mail + WhatsApp/SMS)
// Cloudflare: roda sozinho pelos "Cron Triggers" do wrangler.toml.
// Vercel: vercel.json chama GET /api/cron?r=manha e ?r=noite com o cabeçalho Authorization: Bearer CRON_SECRET.
import { emprestimoRotina } from './emprestimo.js';
import { db, asaas, hoje, r2, encargos, config, asaasLigadoSrv, pushNotificacao } from './_base.js';
import { saasRotina } from './saas.js';
import { repasseRotina } from './repasse.js';
import { backupRotina } from './seguranca.js';
import { instalacoesRotina } from './instalacao.js';
import { negativacaoRotina } from './negativacao.js';
import { cashbackRotina, aniversarioRotina, posVendaRotina } from './fidelidade.js';
import { relatorioSemanal } from './relatorio-semanal.js';
import { relatorioCrm } from './relatorio-crm.js';
import { nota } from './motor.js';
import { brevoLigado, enviarEmail, avisarCliente, enviarWhatsapp, enviarSms, MODELOS, moldura } from './_brevo.js';
import { iosRotina } from './_ios.js';
import { autoAprovarEquipe } from './equipe.js';
import { iaAutonomaRotina } from './ia-autonoma.js';
import { crmIaAutomatica, agendadasRotina } from './crm-auto.js';
import { alertasComportamento } from './comportamento.js';

const dias = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400e3);
const brl = (n) => 'R$ ' + Number(n || 0).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const dataBR = (d) => String(d || '').split('-').reverse().join('/');
const primeiroNome = (n) => String(n || '').trim().split(/\s+/)[0] || '';
const urlCliente = () => process.env.PORTAL_CLIENTE_URL || (process.env.PORTAL_ORIGEM || 'https://nexumrh.github.io') + '/cliente/';

// texto do SMS e parâmetros do modelo de WhatsApp para um contrato
export function dadosAviso(v, cfg, tipo) {
  const abertas = (v.parcelas || []).filter((p) => !p.pago).sort((a, b) => a.venc.localeCompare(b.venc));
  const atrasadas = abertas.filter((p) => p.venc < hoje()), p = (tipo === 'atraso' ? atrasadas[0] : abertas[0]) || abertas[0] || {};
  const ap = { descontoPct: cfg.descontoAntecipadoPct, multaPct: cfg.multaPct, moraDiaPct: cfg.moraDiaPct };
  const valor = tipo === 'atraso' ? r2(atrasadas.reduce((s, x) => s + encargos(x, ap), 0)) : p.valor ? encargos(p, ap) : 0;
  const nome = primeiroNome(v.clienteNome), loja = cfg.empresa || 'NexumCell', d = p.venc ? Math.max(0, dias(p.venc, hoje())) : 0;
  const texto = tipo === 'atraso'
    ? `${loja}: ${nome}, sua parcela esta atrasada ha ${d} dia(s). Valor hoje ${brl(valor)}. Pague pelo portal ${urlCliente()} e evite o bloqueio do aparelho.`
    : `${loja}: ${nome}, sua parcela de ${brl(valor)} vence ${p.venc === hoje() ? 'HOJE' : 'em ' + dataBR(p.venc)}. Pagando antes voce ganha desconto: ${urlCliente()}`;
  return { tel: (v.cliente?.telefones || [])[0] || v.clienteTel1 || '', modelo: tipo, texto, params: { NOME: nome, VALOR: brl(valor), VENCIMENTO: dataBR(p.venc), DIAS: String(d), LINK: urlCliente(), LOJA: loja } };
}

async function vendasAtivas() { return (await db.collection('vendas').where('status', '==', 'ATIVA').get()).docs.map((d) => ({ id: d.id, ...d.data() })); }

// ---------- 9h: lembretes aos clientes ----------
// ---------- Régua de cobrança configurável (Painel do Dono → Régua de cobrança) ----------
// cfg.regua = [{ dia: -3, canais: ['sms','email','app'], texto: '...' }]  dia < 0 = antes do vencimento, 0 = no dia, > 0 = dias de atraso
const preencher = (t, dd) => String(t || '').replace(/\{(\w+)\}/g, (m, k) => ({ nome: dd.params.NOME, valor: dd.params.VALOR, vencimento: dd.params.VENCIMENTO, dias: dd.params.DIAS, link: dd.params.LINK, loja: dd.params.LOJA }[k.toLowerCase()] ?? m));
async function regua(cfg, vendas) {
  const passos = (cfg.regua || []).filter((x) => x && Number.isFinite(+x.dia) && (x.canais || []).length);
  const max = Number(process.env.ROTINA_MAX) || 1000; let enviados = 0, falhas = 0, restantes = 0;
  const promessas = {}; try { (await db.collection('crmPromessas').where('status', '==', 'PENDENTE').get()).docs.forEach((d) => { const p = d.data(); if (p.vendaId && p.data) promessas[p.vendaId] = p.data > (promessas[p.vendaId] || '') ? p.data : promessas[p.vendaId]; }); } catch (e) { }
  for (const v of vendas) {
    if (v.pixAutomatico?.status === 'ATIVO') continue;
    const abertas = (v.parcelas || []).filter((p) => !p.pago).sort((a, b) => a.venc.localeCompare(b.venc)); if (!abertas.length) continue;
    const atrasada = abertas.find((p) => p.venc < hoje()), p = atrasada || abertas[0], d = dias(p.venc, hoje());   // d: dias após o vencimento
    const passo = passos.find((x) => +x.dia === d); if (!passo) continue;
    if (promessas[v.id] && promessas[v.id] >= hoje()) continue;   // cliente prometeu pagar (CRM → Cobrança): a régua espera a data
    const chave = `${p.n}:R${d}`; if (v.avisosBrevo?.[chave]) continue;
    if (enviados + falhas >= max) { restantes++; continue; }
    const dd = dadosAviso(v, cfg, d > 0 ? 'atraso' : 'lembrete'); const texto = passo.texto ? preencher(passo.texto, dd) : dd.texto; const r = {};
    for (const c of passo.canais) {
      try {
        if (c === 'sms' || c === 'whatsapp') { if (!brevoLigado() || !dd.tel) throw new Error('sem Brevo ou telefone'); Object.assign(r, await avisarCliente(dd.tel, c === 'sms' ? 'sms' : 'whatsapp_ou_sms', { ...dd, texto })); }
        if (c === 'email') { const em = v.cliente?.email; if (!brevoLigado() || !em) throw new Error('sem Brevo ou e-mail'); await enviarEmail({ para: em, assunto: d > 0 ? 'Parcela em atraso' : 'Lembrete de vencimento', titulo: d > 0 ? 'Parcela em atraso' : 'Sua parcela está chegando', texto }); r.email = 'ok'; }
        if (c === 'app') { const ok = await pushNotificacao(v.aparelhoToken, d > 0 ? 'Parcela em atraso' : 'Lembrete de vencimento', texto); r.app = ok ? 'ok' : 'sem app'; }
      } catch (e) { r[c] = e.message; }
    }
    Object.values(r).some((x) => x === 'ok') ? enviados++ : falhas++;
    await db.collection('vendas').doc(v.id).set({ avisosBrevo: { ...(v.avisosBrevo || {}), [chave]: { em: Date.now(), ...r } } }, { merge: true });
  }
  return { regua: enviados, falhas, ficaramParaDepois: restantes };
}

// ---------- Score NexumCell visível no app e no portal do cliente ----------
const FAIXAS = [['Bronze', 0], ['Prata', 600], ['Ouro', 750], ['Diamante', 900]];
export async function scoreRotina() {
  const todas = (await db.collection('vendas').where('status', 'in', ['ATIVA', 'QUITADA', 'RETOMADA']).get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  const porCpf = {}; todas.forEach((v) => (porCpf[v.clienteCpf] = porCpf[v.clienteCpf] || []).push(v));
  const max = Number(process.env.ROTINA_MAX) || 1000; let n = 0;
  for (const vs of Object.values(porCpf)) {
    const ativa = vs.find((v) => v.status === 'ATIVA' && v.aparelhoToken); if (!ativa) continue;
    const N = nota(vs, ativa.cliente?.renda), faixa = [...FAIXAS].reverse().find(([, m]) => N.score >= m)[0], prox = FAIXAS.find(([, m]) => m > N.score);
    const sc = { valor: N.score, faixa: N.atrasoAberto ? 'Em atraso' : faixa, proxima: prox ? { faixa: prox[0], falta: prox[1] - N.score } : null, em: hoje() };
    if (ativa.score?.valor === sc.valor && ativa.score?.faixa === sc.faixa) continue;
    if (n >= max) break;
    await db.collection('aparelhos').doc(ativa.aparelhoToken).set({ score: sc }, { merge: true });
    await db.collection('vendas').doc(ativa.id).set({ score: sc }, { merge: true }); n++;
  }
  return n;
}

// ---------- Limite pré-aprovado para recompra (bom pagador) ----------
// condições especiais de recompra (Painel do Dono → Recompra): entrada menor e desconto no aparelho novo
export const condRecompra = (cfg) => ({ entradaPct: Math.max(0, Math.min(90, Number(cfg.recompraEntradaPct ?? 20))), descontoPct: Math.max(0, Math.min(50, Number(cfg.recompraDescontoPct ?? 5))) });

// ---------- Fila de cobrança compartilhada com os vendedores (filaCobranca/{vendaId}) ----------
// O vendedor não lê os contratos da loja; ele vê só esta lista enxuta para mandar a mensagem de cobrança.
export async function filaRotina(vendas) {
  vendas = vendas || await vendasAtivas();
  const h = hoje(), amanha = new Date(Date.now() + 86400e3).toISOString().slice(0, 10);
  const vivos = new Set(); let n = 0;
  for (const v of vendas) {
    if (!v.lojaId) continue;
    const abertas = (v.parcelas || []).filter((p) => !p.pago).sort((a, b) => a.venc.localeCompare(b.venc)); if (!abertas.length) continue;
    const atr = abertas.filter((p) => p.venc < h), lem = !atr.length && [h, amanha].includes(abertas[0].venc);
    if (!atr.length && !lem) continue;
    vivos.add(v.id);
    const d = { vendaId: v.id, lojaId: v.lojaId, numero: v.numero || 0, clienteNome: v.clienteNome || '', tel: (v.cliente?.telefones || [])[0] || '',
      aparelho: [v.aparelho?.marca, v.aparelho?.modelo].filter(Boolean).join(' '), dias: atr.length ? dias(atr[0].venc, h) : 0,
      valor: r2((atr.length ? atr : [abertas[0]]).reduce((s, p) => s + (+p.valor || 0), 0)), venc: (atr[0] || abertas[0]).venc, lembrete: !atr.length, ativo: true, atualizadoEm: Date.now() };
    await db.collection('filaCobranca').doc(v.id).set(d, { merge: true }); n++;
  }
  const antigos = (await db.collection('filaCobranca').where('ativo', '==', true).get()).docs.filter((d) => !vivos.has(d.id));
  for (const d of antigos) await d.ref.set({ ativo: false, atualizadoEm: Date.now() }, { merge: true });
  return n;
}
// Pagou 60%+ do contrato (ou quitou), nunca atrasou mais de 3 dias, sem acordo, sem atraso aberto → ganha limite por 90 dias.
export async function preAprovados(cfg) {
  const todas = (await db.collection('vendas').where('status', 'in', ['ATIVA', 'QUITADA']).get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  const porCpf = {}; todas.forEach((v) => (porCpf[v.clienteCpf] = porCpf[v.clienteCpf] || []).push(v));
  const max = Number(process.env.ROTINA_MAX) || 1000; let n = 0;
  for (const [cpf, vs] of Object.entries(porCpf)) {
    if (n >= max) break;
    const ok = vs.every((v) => { const ps = v.parcelas || [], pagas = ps.filter((p) => p.pago); const atrasoMax = Math.max(0, ...pagas.map((p) => (p.pagoEm ? dias(p.venc, String(p.pagoEm).slice(0, 10)) : 0)));
      // libera quando falta só a última parcela (ou já quitou): o crédito aparece no app ANTES de a trava sair do aparelho
      const aberto = ps.some((p) => !p.pago && p.venc < hoje()), faltam = ps.length - pagas.length;
      return !aberto && atrasoMax <= 3 && !(v.acordos || []).length && (v.status === 'QUITADA' || (ps.length >= 2 && faltam <= 1)); });
    if (!ok) continue;
    const ult = vs.sort((a, b) => b.criadoEm - a.criadoEm)[0]; const renda = ult.cliente?.renda || 0;
    const quitados = vs.filter((v) => v.status === 'QUITADA').length, mult = Number(cfg.preAprovadoMult) || (quitados ? 2.5 : 1.8);
    const valor = Math.round(Math.min(renda * mult, Number(cfg.preAprovadoMax) || 6000) / 50) * 50; if (!(valor > 0)) continue;
    const ate = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10), atual = (await db.collection('clientes').doc(cpf).get()).data()?.preAprovado;
    if (atual && atual.valor === valor && atual.ate >= hoje()) continue;
    const cond = condRecompra(cfg);
    await db.collection('clientes').doc(cpf).set({ preAprovado: { valor, ate, em: Date.now(), vendaId: ult.id, loja: ult.lojaNome || '', ...cond } }, { merge: true });
    if (ult.aparelhoToken && ult.status === 'ATIVA') await db.collection('aparelhos').doc(ult.aparelhoToken).set({ preAprovado: { valor, ate, em: Date.now(), loja: ult.lojaNome || '', ...cond } }, { merge: true });
    n++;
  }
  return n;
}

async function lembretes(cfg, vendas) {
  if (Array.isArray(cfg.regua) && cfg.regua.length) return regua(cfg, vendas);
  const canal = cfg.brevoCanal || 'nenhum';
  if (!brevoLigado() || canal === 'nenhum' || cfg.brevoLembretes !== 'sim') return { lembretes: 'desligado' };
  const antes = Number(cfg.lembreteDiasAntes ?? 2), atrasos = String(cfg.lembreteDiasAtraso || '1,3,7').split(',').map(Number).filter((x) => x > 0);
  // Cloudflare grátis: no máximo 50 chamadas externas por execução → poucas mensagens por rodada
  // (a rotina da manhã roda 3 vezes seguidas e continua de onde parou). Plano pago: ROTINA_MAX alto.
  const max = Number(process.env.ROTINA_MAX) || 1000;
  let enviados = 0, falhas = 0, restantes = 0;
  for (const v of vendas) {
    if (v.pixAutomatico?.status === 'ATIVO') continue;                       // débito automático: não precisa lembrar
    const abertas = (v.parcelas || []).filter((p) => !p.pago).sort((a, b) => a.venc.localeCompare(b.venc));
    if (!abertas.length) continue;
    const p = abertas[0], d = dias(hoje(), p.venc);                           // d > 0: falta; d < 0: atraso
    let tipo = null, chave = '';
    if (d === antes || d === 0) { tipo = 'lembrete'; chave = `${p.n}:L${d}`; }
    else if (d < 0 && atrasos.includes(-d)) { tipo = 'atraso'; chave = `${p.n}:A${-d}`; }
    if (!tipo || v.avisosBrevo?.[chave]) continue;
    const dd = dadosAviso(v, cfg, tipo); if (!dd.tel) continue;
    if (enviados + falhas >= max) { restantes++; continue; }
    const r = await avisarCliente(dd.tel, canal, dd);
    const ok = r.whatsapp === 'ok' || r.sms === 'ok'; ok ? enviados++ : falhas++;
    await db.collection('vendas').doc(v.id).set({ avisosBrevo: { ...(v.avisosBrevo || {}), [chave]: { em: Date.now(), ...r } } }, { merge: true });
  }
  return { lembretes: enviados, falhas, ficaramParaDepois: restantes };
}

// ---------- 9h: robô de voz do Asaas para atraso longo ----------
async function roboVoz(cfg, vendas) {
  if (cfg.roboVoz !== 'sim' || !(await asaasLigadoSrv())) return { roboVoz: 'desligado' };
  const limite = Number(cfg.roboVozDias) || 15, max = Math.max(1, Math.round((Number(process.env.ROTINA_MAX) || 1000) / 4)); let ligados = 0, desligados = 0, erros = 0;
  for (const v of vendas) {
    if (ligados + desligados + erros >= max) break;
    const cust = v.asaas?.customer; if (!cust) continue;
    const atraso = Math.max(0, ...(v.parcelas || []).filter((p) => !p.pago).map((p) => dias(p.venc, hoje())));
    const querLigado = atraso >= limite;
    if (querLigado === !!v.roboVoz?.ligado) continue;
    try {
      const nots = (await asaas(`/customers/${cust}/notifications`)).data || [];
      for (const n of nots.filter((x) => x.event === 'PAYMENT_OVERDUE'))
        await asaas('/notifications/' + n.id, { method: 'PUT', body: JSON.stringify({ enabled: true, phoneCallEnabledForCustomer: querLigado }) });
      await db.collection('vendas').doc(v.id).set({ roboVoz: { ligado: querLigado, em: Date.now(), atraso } }, { merge: true });
      await db.collection('logs').add({ em: Date.now(), acao: querLigado ? 'Robô de voz ligado (Asaas)' : 'Robô de voz desligado (regularizou)', alvo: v.id, det: `${atraso} dia(s) de atraso`, por: 'Rotina automática' });
      querLigado ? ligados++ : desligados++;
    } catch (e) { erros++; console.error('robo', v.id, e.message); }
  }
  return { roboVozLigados: ligados, roboVozDesligados: desligados, erros };
}

// ---------- 19h: resumo do dia para o dono ----------
export async function resumoDoDia(cfg) {
  const h = hoje(), todas = (await db.collection('vendas').get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  const ini = new Date(h + 'T00:00:00-03:00').getTime();
  const novas = todas.filter((v) => (v.criadoEm || 0) >= ini && !['REPROVADA', 'CANCELADA', 'RASCUNHO'].includes(v.status));
  const ativadas = novas.filter((v) => ['ATIVA', 'QUITADA'].includes(v.status));
  let recebido = 0, nParc = 0, atrasoValor = 0; const atrasados = new Set();
  todas.forEach((v) => (v.parcelas || []).forEach((p) => {
    if (p.pago && p.pagoEm === h) { recebido += +(p.valorPago ?? p.valor); nParc++; }
    if (!p.pago && v.status === 'ATIVA' && p.venc < h) { atrasoValor += p.valor; atrasados.add(v.id); }
  }));
  const entradas = ativadas.reduce((s, v) => s + (+v.entradaPaga?.valor || 0), 0);
  const analise = todas.filter((v) => v.status === 'ANALISE').length;
  const amanha = todas.filter((v) => v.status === 'ATIVA' && (v.parcelas || []).some((p) => !p.pago && p.venc === new Date(Date.now() + 21 * 3600e3).toISOString().slice(0, 10)));
  // aparelhos que pararam de dar sinal (trava desligada, celular parado, revendido…)
  const semSinalDias = Math.max(1, Number(cfg.alertaSemSinalDias) || 5);
  let semSinal = [];
  try {
    const aps = (await db.collection('aparelhos').where('status', '==', 'ATIVO').get()).docs.map((d) => d.data());
    semSinal = aps.filter((a) => !a.quitado && a.checkin?.em && Date.now() - a.checkin.em > semSinalDias * 86400e3);
  } catch (e) { console.warn('semSinal', e.message); }
  const porLoja = {}; ativadas.forEach((v) => { porLoja[v.lojaNome || 'Loja'] = (porLoja[v.lojaNome || 'Loja'] || 0) + 1; });
  const linhas = [
    `Vendas hoje: ${ativadas.length} ativada(s)${novas.length > ativadas.length ? ` + ${novas.length - ativadas.length} em andamento` : ''}${Object.keys(porLoja).length ? ' (' + Object.entries(porLoja).map(([l, n]) => `${l}: ${n}`).join(', ') + ')' : ''}`,
    `Entradas recebidas: ${brl(entradas)}`,
    `Parcelas recebidas: ${nParc} · ${brl(recebido)}`,
    `Em atraso: ${atrasados.size} contrato(s) · ${brl(atrasoValor)}`,
    `Vencem amanhã: ${amanha.length} contrato(s)`,
    analise ? `Propostas esperando análise: ${analise}` : '',
    semSinal.length ? `⚠️ Aparelhos sem sinal há mais de ${semSinalDias} dias: ${semSinal.length} (${semSinal.slice(0, 5).map((a) => 'nº ' + a.vendaNumero).join(', ')}${semSinal.length > 5 ? '…' : ''})` : '',
  ].filter(Boolean);
  const texto = linhas.join('\n'), titulo = `Resumo de ${dataBR(h)} — ${cfg.empresa || 'NexumCell'}`;
  const r = { texto, enviado: {} };
  await db.collection('notificacoes').doc('resumo-' + h).set({ tipo: 'RESUMO', para: 'DONO', titulo, texto, em: Date.now(), dia: h, lida: false,
    numeros: { vendas: ativadas.length, entradas: r2(entradas), recebido: r2(recebido), parcelas: nParc, atrasados: atrasados.size, atrasoValor: r2(atrasoValor), analise, semSinal: semSinal.length } });
  if (brevoLigado() && cfg.resumoEmail !== 'nao') {
    const para = [process.env.DONO_EMAIL, ...String(cfg.resumoEmailsExtras || '').split(/[,;\s]+/)].filter((x) => /@/.test(x || ''));
    try { await enviarEmail({ para, assunto: titulo, html: moldura(titulo, texto + '\n\nAbra o Painel do Dono para ver os detalhes.'), texto }); r.enviado.email = 'ok'; } catch (e) { r.enviado.email = e.message; }
  }
  if (brevoLigado() && cfg.donoTelefone && ['whatsapp', 'sms'].includes(cfg.resumoCanal)) {
    try {
      if (cfg.resumoCanal === 'whatsapp' && MODELOS.resumo()) await enviarWhatsapp(cfg.donoTelefone, { templateId: MODELOS.resumo(), params: { TEXTO: linhas.slice(0, 4).join(' | ') } });
      else await enviarSms(cfg.donoTelefone, (titulo + ': ' + linhas.slice(0, 4).join('; ')).normalize('NFD').replace(/[̀-ͯ]/g, ''));
      r.enviado.celular = 'ok';
    } catch (e) { r.enviado.celular = e.message; }
  }
  return r;
}

// ---------- Limite dinâmico da loja (só lojas com limiteAuto ligado) ----------
export async function limitesDinamicos() {
  const h = hoje();
  const lojas = (await db.collection('lojas').get()).docs.map((d) => ({ id: d.id, ...d.data() })).filter((l) => l.limiteAuto);
  if (!lojas.length) return 0;
  let n = 0;
  for (const l of lojas) {
    const vs = (await db.collection('vendas').where('lojaId', '==', l.id).get()).docs.map((d) => d.data());
    let aberto = 0, venc = 0, vencAb = 0;
    vs.filter((v) => ['ATIVA', 'INSTALANDO'].includes(v.status)).forEach((v) => (v.parcelas || []).forEach((p) => { const val = Number(p.valor) || 0; if (!p.pago) aberto += val; if (p.venc < h) { venc += val; if (!p.pago) vencAb += val; } }));
    const inad = venc ? (vencAb / venc) * 100 : 0;
    const fator = inad < 5 ? 1.5 : inad < 8 ? 1.25 : inad < 12 ? 1 : inad < 20 ? 0.8 : 0.6;
    const carteira = Math.max(1000, Math.round((aberto * fator) / 500) * 500);
    const tetoInad = inad < 10 ? 12 : 10;
    if (Number(l.limiteCarteira) === carteira && Number(l.limiteInad) === tetoInad) continue;
    await db.collection('lojas').doc(l.id).set({ limiteCarteira: carteira, limiteInad: tetoInad, limiteAutoEm: Date.now() }, { merge: true });
    await db.collection('logs').add({ em: Date.now(), acao: 'Limite dinâmico da loja', alvo: l.id, det: `${l.nome || l.id}: carteira R$ ${carteira} · inad ${tetoInad}% (atual ${inad.toFixed(1)}%)`, por: 'Sistema' });
    n++;
  }
  return n;
}

/* Resumo de indicações por indicador, carimbado no aparelho para o portal do cliente exibir o progresso. */
export async function statsIndicacao(cfg) {
  const bonus = Number(cfg.bonusIndicacao) || 0;
  if (!bonus) return 0;
  const vs = (await db.collection('vendas').get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  const num = (c) => Number(String(c || '').replace(/\D/g, ''));
  const porInd = {};
  vs.forEach((v) => {
    const cod = v.cliente && v.cliente.indicacao; if (!cod) return;
    const ni = num(cod); if (!ni) return;
    const r = porInd[ni] || (porInd[ni] = { conv: 0, pend: 0 });
    if (['ATIVA', 'QUITADA', 'RETOMADA'].includes(v.status)) r.conv++;
    else if (!['REPROVADA', 'CANCELADA', 'RASCUNHO'].includes(v.status)) r.pend++;
  });
  let n = 0;
  for (const ni of Object.keys(porInd)) {
    const r = porInd[ni];
    const ind = vs.find((v) => Number(v.numero) === Number(ni) && v.aparelhoToken && ['ATIVA', 'QUITADA'].includes(v.status));
    if (!ind) continue;
    await db.collection('aparelhos').doc(ind.aparelhoToken).set({ indicacaoInfo: { indicados: r.conv, pendentes: r.pend, ganho: r.conv * bonus, em: Date.now() } }, { merge: true });
    n++;
  }
  return n;
}

export async function rotinas(qual) {
  const cfg = await config();
  if (qual === 'hora') { const r = {}; try { r.equipe = await autoAprovarEquipe(); } catch (e) { console.error('equipe', e.message); } try { r.fila = await filaRotina(); } catch (e) { console.error('fila', e.message); } try { r.ia = await iaAutonomaRotina(); } catch (e) { console.error('ia', e.message); } try { r.emp = await emprestimoRotina(); } catch (e) { console.error('emprestimo', e.message); } try { r.crmIa = await crmIaAutomatica(); } catch (e) { console.error('crmIa', e.message); } try { r.agendadas = await agendadasRotina(); } catch (e) { console.error('agendadas', e.message); } return r; }
  let ios = {}; try { ios = await iosRotina(db); } catch (e) { console.error('ios', e.message); }
  if (qual === 'noite') { const r = await resumoDoDia(cfg); try { Object.assign(r, await alertasComportamento(cfg)); } catch (e) { console.error('comportamento', e.message); } try { r.saas = await saasRotina(); } catch (e) { console.error('saas', e.message); } try { r.preAprovados = await preAprovados(cfg); } catch (e) { console.error('pre', e.message); } try { r.scores = await scoreRotina(); } catch (e) { console.error('score', e.message); } try { r.repasses = await repasseRotina(cfg); } catch (e) { console.error('repasse', e.message); } try { r.backup = await backupRotina(cfg); } catch (e) { console.error('backup', e.message); } try { r.instalacoes = await instalacoesRotina(); } catch (e) { console.error('instalacoes', e.message); } try { r.negativacao = await negativacaoRotina(cfg); } catch (e) { console.error('negativacao', e.message); } try { r.cashback = await cashbackRotina(cfg); } catch (e) { console.error('cashback', e.message); } try { r.limites = await limitesDinamicos(); } catch (e) { console.error('limites', e.message); } try { r.indicacoes = await statsIndicacao(cfg); } catch (e) { console.error('indicacoes', e.message); } return { ...r, ...ios }; }
  const vendas = await vendasAtivas();
  try { await autoAprovarEquipe(); } catch (e) { console.error('equipe', e.message); }
  try { await filaRotina(vendas); } catch (e) { console.error('fila', e.message); }
  let aniv = {}; try { aniv = await aniversarioRotina(cfg); } catch (e) { console.error('aniversario', e.message); }
  try { Object.assign(aniv, await relatorioSemanal(cfg)); } catch (e) { console.error('relsemanal', e.message); }
  try { Object.assign(aniv, await relatorioCrm(cfg)); } catch (e) { console.error('relcrm', e.message); }
  try { Object.assign(aniv, await posVendaRotina(cfg)); } catch (e) { console.error('posvenda', e.message); }
  return { ...(await lembretes(cfg, vendas)), ...(await roboVoz(cfg, vendas)), ...aniv, ...ios };
}

export default async function handler(req, res) {
  const seg = process.env.CRON_SECRET;
  if (!seg || req.headers.authorization !== 'Bearer ' + seg) return res.status(401).json({ erro: 'não autorizado' });
  try { return res.status(200).json(await rotinas(['noite', 'hora'].includes(req.query?.r) ? req.query.r : 'manha')); }
  catch (e) { console.error(e); return res.status(500).json({ erro: e.message }); }
}
