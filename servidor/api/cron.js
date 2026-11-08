// Rotinas automáticas (todo dia):
//   manhã (9h de Brasília): lembretes de vencimento e atraso aos clientes (Brevo) + liga o robô de voz do Asaas
//                           para quem passou de X dias de atraso (e desliga quando regulariza)
//   noite (19h de Brasília): resumo do dia para o dono (notificação no portal + e-mail + WhatsApp/SMS)
// Cloudflare: roda sozinho pelos "Cron Triggers" do wrangler.toml.
// Vercel: vercel.json chama GET /api/cron?r=manha e ?r=noite com o cabeçalho Authorization: Bearer CRON_SECRET.
import { db, asaas, hoje, r2, encargos, config } from './_base.js';
import { brevoLigado, enviarEmail, avisarCliente, enviarWhatsapp, enviarSms, MODELOS, moldura } from './_brevo.js';

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
async function lembretes(cfg, vendas) {
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
  if (cfg.roboVoz !== 'sim' || !process.env.ASAAS_API_KEY) return { roboVoz: 'desligado' };
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
  const porLoja = {}; ativadas.forEach((v) => { porLoja[v.lojaNome || 'Loja'] = (porLoja[v.lojaNome || 'Loja'] || 0) + 1; });
  const linhas = [
    `Vendas hoje: ${ativadas.length} ativada(s)${novas.length > ativadas.length ? ` + ${novas.length - ativadas.length} em andamento` : ''}${Object.keys(porLoja).length ? ' (' + Object.entries(porLoja).map(([l, n]) => `${l}: ${n}`).join(', ') + ')' : ''}`,
    `Entradas recebidas: ${brl(entradas)}`,
    `Parcelas recebidas: ${nParc} · ${brl(recebido)}`,
    `Em atraso: ${atrasados.size} contrato(s) · ${brl(atrasoValor)}`,
    `Vencem amanhã: ${amanha.length} contrato(s)`,
    analise ? `Propostas esperando análise: ${analise}` : '',
  ].filter(Boolean);
  const texto = linhas.join('\n'), titulo = `Resumo de ${dataBR(h)} — ${cfg.empresa || 'NexumCell'}`;
  const r = { texto, enviado: {} };
  await db.collection('notificacoes').doc('resumo-' + h).set({ tipo: 'RESUMO', para: 'DONO', titulo, texto, em: Date.now(), dia: h, lida: false,
    numeros: { vendas: ativadas.length, entradas: r2(entradas), recebido: r2(recebido), parcelas: nParc, atrasados: atrasados.size, atrasoValor: r2(atrasoValor), analise } });
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

export async function rotinas(qual) {
  const cfg = await config();
  if (qual === 'noite') return resumoDoDia(cfg);
  const vendas = await vendasAtivas();
  return { ...(await lembretes(cfg, vendas)), ...(await roboVoz(cfg, vendas)) };
}

export default async function handler(req, res) {
  const seg = process.env.CRON_SECRET;
  if (!seg || req.headers.authorization !== 'Bearer ' + seg) return res.status(401).json({ erro: 'não autorizado' });
  try { return res.status(200).json(await rotinas(req.query?.r === 'noite' ? 'noite' : 'manha')); }
  catch (e) { console.error(e); return res.status(500).json({ erro: e.message }); }
}
