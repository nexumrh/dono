// Fidelidade: cashback para quem paga em dia e aniversário do cliente.
// cashbackRotina (noite): saldo por CPF = % das parcelas pagas em dia (desde que o cashback foi ligado)
//   menos o que já foi usado em entradas. Grava em clientes/{cpf}.cashback e no app (aparelhos/{token}.cashback).
// aniversarioRotina (manhã): notificação no celular do cliente e, se configurado, desconto na próxima parcela.
import { db, asaas, hoje, r2, pushNotificacao, paraAparelho } from './_base.js';

const ENCERRADAS = ['CANCELADA', 'REPROVADA', 'RASCUNHO'];

export async function cashbackRotina(cfg) {
  if (cfg.cashbackAtivo !== 'sim') return { cashback: 'desligado' };
  let desde = cfg.cashbackDesde;
  if (!desde) { desde = hoje(); await db.collection('config').doc('sistema').set({ cashbackDesde: desde }, { merge: true }); }
  const pct = Math.min(10, Math.max(0, Number(cfg.cashbackPct) || 0));
  const vendas = (await db.collection('vendas').where('status', 'in', ['ATIVA', 'QUITADA', 'INSTALANDO', 'APROVADA', 'AGUARDANDO_ENTRADA', 'RETOMADA']).get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  const por = {};
  for (const v of vendas) {
    const cpf = String(v.clienteCpf || '').replace(/\D/g, ''); if (cpf.length !== 11) continue;
    const o = (por[cpf] ||= { ganho: 0, usado: 0, tokens: [] });
    if (!ENCERRADAS.includes(v.status)) o.usado += Number(v.cashbackUsado) || 0;
    if (v.status === 'RETOMADA') continue; // quem teve o aparelho retomado não acumula
    for (const p of v.parcelas || []) {
      if (p.pago && p.pagoEm && p.pagoEm <= p.venc && p.pagoEm >= desde && !p.acordo && p.forma !== 'Entrada do acordo') o.ganho += Math.min(+(p.valorPago ?? p.valor) || 0, +p.valor || 0) * pct / 100;
    }
    if (v.aparelhoToken && ['ATIVA', 'QUITADA'].includes(v.status)) o.tokens.push(v.aparelhoToken);
  }
  let n = 0;
  for (const [cpf, o] of Object.entries(por)) {
    if (!o.ganho && !o.usado) continue;
    const c = { saldo: r2(Math.max(0, o.ganho - o.usado)), ganho: r2(o.ganho), usado: r2(o.usado), pct, em: Date.now() };
    await db.collection('clientes').doc(cpf).set({ cashback: c }, { merge: true });
    for (const tk of o.tokens) await db.collection('aparelhos').doc(tk).set({ cashback: { saldo: c.saldo, pct } }, { merge: true }).catch(() => {});
    n++;
  }
  return { clientes: n };
}

export async function aniversarioRotina(cfg) {
  if (cfg.aniversarioAtivo === 'nao') return { aniversario: 'desligado' };
  const h = hoje(), ano = +h.slice(0, 4), md = h.slice(5);
  const bissexto = (ano % 4 === 0 && ano % 100 !== 0) || ano % 400 === 0;
  const fazHoje = (nasc) => { const m = String(nasc || '').slice(5, 10); return m === md || (!bissexto && m === '02-29' && md === '02-28'); };
  const desc = Math.max(0, Number(cfg.aniversarioDesconto) || 0);
  const vendas = (await db.collection('vendas').where('status', '==', 'ATIVA').get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  const feitos = new Set(); let n = 0;
  for (const v of vendas) {
    const cpf = String(v.clienteCpf || '');
    if (!fazHoje(v.cliente?.nasc) || v.aniversarioAno === ano || feitos.has(cpf)) continue;
    feitos.add(cpf);
    const nome = String(v.clienteNome || '').split(' ')[0];
    let descontoAplicado = 0;
    try {
      if (desc > 0) {
        const parcelas = [...(v.parcelas || [])], i = parcelas.findIndex((p) => !p.pago && p.venc >= h);
        if (i >= 0) {
          const p = parcelas[i], novo = r2(Math.max(0, p.valor - desc));
          if (p.asaasId) await asaas('/payments/' + p.asaasId, { method: 'PUT', body: JSON.stringify({ value: novo, dueDate: p.venc }) });
          parcelas[i] = { ...p, valor: novo, descontoAniversario: r2(p.valor - novo), ...(p.asaasId ? { asaasValor: novo } : {}) };
          await db.collection('vendas').doc(v.id).update({ parcelas });
          if (v.aparelhoToken) await db.collection('aparelhos').doc(v.aparelhoToken).set({ parcelas: parcelas.map(paraAparelho) }, { merge: true });
          descontoAplicado = r2(p.valor - novo);
        }
      }
      const msg = `Feliz aniversário, ${nome}! A ${cfg.empresa || 'NexumCell'} deseja um ano incrível para você.` + (descontoAplicado ? ` De presente, sua próxima parcela ficou R$ ${descontoAplicado.toFixed(2).replace('.', ',')} mais barata.` : '');
      if (v.aparelhoToken) {
        await db.collection('aparelhos').doc(v.aparelhoToken).set({ aniversario: { ano, dia: h, msg, desconto: descontoAplicado } }, { merge: true });
        await pushNotificacao(v.aparelhoToken, `Feliz aniversário, ${nome}!`, msg).catch(() => {});
      }
      await db.collection('vendas').doc(v.id).set({ aniversarioAno: ano }, { merge: true });
      await db.collection('logs').add({ em: Date.now(), acao: 'Aniversário do cliente', alvo: v.id, det: descontoAplicado ? `desconto de R$ ${descontoAplicado} na parcela` : 'mensagem enviada', por: 'Rotina automática' });
      n++;
    } catch (e) { console.error('aniversario', v.id, e.message); }
  }
  return { aniversarios: n };
}

// Pós-venda (manhã): no 3º dia depois da trava ativa, o cliente recebe um aviso no app perguntando se está tudo certo.
export async function posVendaRotina(cfg) {
  if (cfg.posVenda === 'nao') return { posVenda: 'desligado' };
  const agora = Date.now(), vendas = (await db.collection('vendas').where('status', '==', 'ATIVA').get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  let n = 0;
  for (const v of vendas) {
    const ini = v.ativadaEm || v.entradaPaga?.em || v.assinadoEm || 0, d = (agora - ini) / 86400000;
    if (!ini || v.posVendaEm || d < 3 || d > 10 || !v.aparelhoToken) continue;
    try {
      const nome = String(v.clienteNome || '').split(' ')[0], loja = v.lojaNome || cfg.empresa || 'NexumCell';
      const msg = `${nome}, tudo certo com o seu aparelho novo? Qualquer dúvida ou defeito, fale com a ${loja} pelo portal. Pagando em dia você ganha limite para a próxima compra.`;
      await pushNotificacao(v.aparelhoToken, 'Como está o seu aparelho?', msg).catch(() => {});
      await db.collection('vendas').doc(v.id).set({ posVendaEm: agora }, { merge: true });
      n++;
    } catch (e) { console.error('posvenda', v.id, e.message); }
  }
  return { posVenda: n };
}
