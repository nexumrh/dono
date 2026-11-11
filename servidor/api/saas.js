// Mensalidade das lojas parceiras (SaaS): assinatura recorrente no Asaas, uma por empresa.
// POST /api/saas {"acao":"assinar","empresaId":"e_..."}   → cria cliente + assinatura (Dono)
// POST /api/saas {"acao":"atualizar","empresaId":"e_..."} → recalcula o valor (filial nova ou mudança de plano)
// POST /api/saas {"acao":"cancelar","empresaId":"e_..."}
// O webhook do Asaas (externalReference "saas:<empresaId>") marca pago/atrasado; a rotina diária bloqueia por atraso.
import { db, auth, cors, exigirEquipe, asaas, asaasLigadoSrv, config, hoje } from './_base.js';

const addDias = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export async function valorEmpresa(empresaId) {
  const e = (await db.collection('empresas').doc(empresaId).get()).data();
  if (!e) throw Object.assign(new Error('Empresa não encontrada'), { status: 404 });
  const lojas = (await db.collection('lojas').where('empresaId', '==', empresaId).get()).docs.map((d) => d.data()).filter((l) => !l.encerrada);
  const valor = Math.round((Number(e.porLoja) || 0) * Math.max(1, lojas.length) * 100) / 100;
  return { e, lojas: lojas.length, valor };
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const b0 = req.body || {};
    // ---- licenças por venda (saldo: qualquer pessoa da equipe; compra: gerente da loja ou Dono) ----
    if (b0.acao === 'licSaldo' || b0.acao === 'licComprar') {
      const eu = await exigirEquipe(req, b0.acao === 'licSaldo' ? undefined : ['DONO', 'GERENTE']);
      const lojaId = ['DONO', 'FINANCEIRO', 'SUPORTE'].includes(eu.role) ? String(b0.lojaId || '') : eu.lojaId;
      if (!lojaId) throw Object.assign(new Error('loja não informada'), { status: 400 });
      if (b0.acao === 'licSaldo') return res.status(200).json({ ok: true, ...(await saldoLicencas(lojaId)) });
      return res.status(200).json(await comprarLicencas(lojaId, b0.q, eu));
    }
    // ---- voltar a senha de um gerente/vendedor para a senha inicial (Dono; gerente só para vendedor da própria loja) ----
    if (b0.acao === 'senhaPadrao') {
      const eu = await exigirEquipe(req, ['DONO', 'GERENTE']), uid = String(b0.uid || '');
      const ur = db.collection('users').doc(uid), u = (await ur.get()).data();
      if (!u || !['GERENTE', 'VENDEDOR'].includes(u.role)) throw Object.assign(new Error('Usuário não encontrado'), { status: 404 });
      if (eu.role === 'GERENTE' && (u.role !== 'VENDEDOR' || u.lojaId !== eu.lojaId)) throw Object.assign(new Error('sem permissão'), { status: 403 });
      await auth.updateUser(uid, { password: 'nx-12345' });   // o portal acrescenta "nx-" às senhas de 5 dígitos
      await ur.set({ senhaTemporaria: true, senhaResetEm: Date.now(), senhaResetPor: eu.nome }, { merge: true });
      await db.collection('logs').add({ em: Date.now(), acao: 'Senha voltou para a inicial', alvo: uid, det: u.nome || '', por: eu.nome });
      return res.status(200).json({ ok: true });
    }
    await exigirEquipe(req, ['DONO']);
    if (!(await asaasLigadoSrv())) throw Object.assign(new Error('Asaas não configurado: cole a chave em Configurações → Asaas.'), { status: 400 });
    const b = req.body || {}, id = String(b.empresaId || '');
    if (!/^e_\d{14}$/.test(id)) throw Object.assign(new Error('empresa inválida'), { status: 400 });
    const ref = db.collection('empresas').doc(id);
    const { e, lojas, valor } = await valorEmpresa(id);
    if (b.acao === 'assinar') {
      if (e.asaasAssinatura) return res.status(200).json({ ok: true, ja: true, assinatura: e.asaasAssinatura, valor });
      const cfg = await config();
      let cliente = e.asaasCliente;
      if (!cliente) {
        const c = await asaas('/customers', { method: 'POST', body: JSON.stringify({ name: e.razao || e.fantasia, cpfCnpj: e.cnpj, email: e.respEmail, mobilePhone: e.respTelefone, externalReference: 'saas:' + id, notificationDisabled: false }) });
        cliente = c.id;
      }
      const venc = addDias(hoje(), Math.max(1, Number(cfg.saasDiasTeste ?? 7) || 1));
      const s = await asaas('/subscriptions', { method: 'POST', body: JSON.stringify({ customer: cliente, billingType: 'UNDEFINED', value: valor, nextDueDate: venc, cycle: 'MONTHLY',
        description: `${cfg.empresa || 'NexumCell'} — plano ${e.planoNome || e.plano} (${lojas} loja(s))`, externalReference: 'saas:' + id }) });
      if (Number(cfg.saasAdesao) > 0 && !e.adesaoCobrada) {
        await asaas('/payments', { method: 'POST', body: JSON.stringify({ customer: cliente, billingType: 'UNDEFINED', value: Number(cfg.saasAdesao), dueDate: addDias(hoje(), 3), description: 'Taxa de adesão', externalReference: 'saas:' + id }) });
      }
      await ref.set({ asaasCliente: cliente, asaasAssinatura: s.id, mensalidade: valor, lojasCobradas: lojas, situacao: 'TESTE', primeiroVencimento: venc, assinadaEm: Date.now(), ...(Number(cfg.saasAdesao) > 0 ? { adesaoCobrada: true } : {}) }, { merge: true });
      return res.status(200).json({ ok: true, assinatura: s.id, valor, vencimento: venc });
    }
    if (b.acao === 'atualizar') {
      if (!e.asaasAssinatura) return res.status(200).json({ ok: true, semAssinatura: true, valor });
      await asaas('/subscriptions/' + e.asaasAssinatura, { method: 'POST', body: JSON.stringify({ value: valor, updatePendingPayments: true }) });
      await ref.set({ mensalidade: valor, lojasCobradas: lojas, atualizadaEm: Date.now() }, { merge: true });
      return res.status(200).json({ ok: true, valor });
    }
    if (b.acao === 'cancelar') {
      if (e.asaasAssinatura) await asaas('/subscriptions/' + e.asaasAssinatura, { method: 'DELETE' });
      await ref.set({ asaasAssinatura: '', situacao: 'CANCELADA', canceladaEm: Date.now() }, { merge: true });
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ erro: 'ação desconhecida' });
  } catch (e) {
    console.error(e);
    return res.status(e.status || 500).json({ erro: e.message });
  }
}

// ---- licenças: 1 por venda de até 12 parcelas, 2 acima de 12 ----
const USA_LICENCA = ['ATIVA', 'QUITADA', 'INSTALANDO', 'RETOMADA', 'CANCELADA'];
export async function saldoLicencas(lojaId) {
  const lr = await db.collection('lojas').doc(lojaId).get(); if (!lr.exists) throw Object.assign(new Error('Loja não encontrada'), { status: 404 });
  const l = lr.data(), cfg = await config();
  const vs = (await db.collection('vendas').where('lojaId', '==', lojaId).get()).docs.map((d) => d.data()).filter((v) => USA_LICENCA.includes(v.status));
  const usadas = vs.reduce((s, v) => s + (Number(v.licencas) || Math.max(1, Math.ceil((Number(v.nParcelas) || 0) / 12))), 0);
  const compradas = Number(l.licencasCompradas) || 0;
  let cortesia = false;
  if (l.empresaId) { const e = (await db.collection('empresas').doc(l.empresaId).get()).data(); cortesia = !!e?.cortesia; }
  return { compradas, usadas, saldo: compradas - usadas, valor: Number(cfg.saasLicencaValor) || 54.99, obrigatoria: cfg.licencaObrigatoria === 'sim' && !cortesia, cortesia };
}
async function comprarLicencas(lojaId, q, eu) {
  q = Math.floor(Number(q) || 0); if (q < 1 || q > 500) throw Object.assign(new Error('Quantidade de licenças inválida (1 a 500).'), { status: 400 });
  if (!(await asaasLigadoSrv())) throw Object.assign(new Error('Cobrança indisponível: o Asaas não está configurado. Fale com a NexumCell.'), { status: 400 });
  const l = (await db.collection('lojas').doc(lojaId).get()).data(); if (!l) throw Object.assign(new Error('Loja não encontrada'), { status: 404 });
  if (!l.empresaId) throw Object.assign(new Error('Esta loja não tem empresa cadastrada. Fale com a NexumCell.'), { status: 400 });
  const eref = db.collection('empresas').doc(l.empresaId), e = (await eref.get()).data(); if (!e) throw Object.assign(new Error('Empresa não encontrada'), { status: 404 });
  const cfg = await config(), unit = Number(cfg.saasLicencaValor) || 54.99, valor = Math.round(unit * q * 100) / 100;
  let cliente = e.asaasCliente;
  if (!cliente) { const c = await asaas('/customers', { method: 'POST', body: JSON.stringify({ name: e.razao || e.fantasia, cpfCnpj: e.cnpj, email: e.respEmail, mobilePhone: e.respTelefone, externalReference: 'saas:' + l.empresaId }) }); cliente = c.id; await eref.set({ asaasCliente: cliente }, { merge: true }); }
  const ped = db.collection('licencasPedidos').doc(), venc = addDias(hoje(), 3);
  const p = await asaas('/payments', { method: 'POST', body: JSON.stringify({ customer: cliente, billingType: 'UNDEFINED', value: valor, dueDate: venc, description: `${cfg.empresa || 'NexumCell'} — ${q} licença(s) de venda · ${l.nome || ''}`, externalReference: 'lic:' + ped.id }) });
  await ped.set({ lojaId, lojaNome: l.nome || '', empresaId: l.empresaId, q, unit, valor, status: 'PENDENTE', pagamento: p.id, link: p.invoiceUrl || '', vencimento: venc, criadoEm: Date.now(), por: eu.nome, porUid: eu.uid });
  await db.collection('logs').add({ em: Date.now(), acao: 'Pedido de licenças', alvo: lojaId, det: `${q} licença(s) · R$ ${valor}`, por: eu.nome });
  return { ok: true, pedido: ped.id, valor, link: p.invoiceUrl || '', vencimento: venc };
}
export async function licPagamento(event, payment) {
  if (!['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED'].includes(event)) return;
  const ref = db.collection('licencasPedidos').doc(String(payment.externalReference || '').slice(4)), ped = (await ref.get()).data();
  if (!ped || ped.status === 'PAGO') return;
  await ref.set({ status: 'PAGO', pagoEm: Date.now() }, { merge: true });
  const lref = db.collection('lojas').doc(ped.lojaId), l = (await lref.get()).data() || {};
  await lref.set({ licencasCompradas: (Number(l.licencasCompradas) || 0) + ped.q, licencasHist: [...(l.licencasHist || []), { q: ped.q, valor: ped.valor, em: Date.now(), por: 'Asaas (pago)' }] }, { merge: true });
  await db.collection('logs').add({ em: Date.now(), acao: 'Licenças pagas (Asaas)', alvo: ped.lojaId, det: `${ped.q} licença(s) · R$ ${ped.valor}`, por: 'Asaas' });
}

// ---- usados pelo webhook e pela rotina diária ----
async function mudarBloqueio(empresaId, bloquear, motivo) {
  const lojas = (await db.collection('lojas').where('empresaId', '==', empresaId).get()).docs;
  for (const l of lojas) {
    const d = l.data();
    if (bloquear && d.bloqueada) continue;              // já bloqueada (pelo Dono ou antes)
    if (!bloquear && !d.bloqueioAuto) continue;         // só desbloqueia o que o sistema bloqueou
    await db.collection('lojas').doc(l.id).set(bloquear ? { bloqueada: true, bloqueioAuto: true, motivoBloqueio: motivo, bloqueadaEm: Date.now(), bloqueadaPor: 'Sistema (mensalidade)' }
      : { bloqueada: false, bloqueioAuto: false, motivoBloqueio: '', desbloqueadaEm: Date.now(), desbloqueadaPor: 'Sistema (pagamento)' }, { merge: true });
    const us = (await db.collection('users').where('lojaId', '==', l.id).get()).docs;
    for (const u of us) await db.collection('users').doc(u.id).set(bloquear ? { lojaBloqueada: true, motivoBloqueio: motivo, lojaNome: d.nome || '' } : { lojaBloqueada: false, ...(u.data().bloqueadoPeloDono ? {} : { motivoBloqueio: '' }) }, { merge: true });
  }
}
export async function saasPagamento(event, payment) {
  const empresaId = String(payment.externalReference || '').slice(5), ref = db.collection('empresas').doc(empresaId);
  if (!(await ref.get()).exists) return;
  if (['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED'].includes(event)) {
    await ref.set({ situacao: 'EM_DIA', atrasadaDesde: null, ultimoPagamento: { valor: payment.value, em: Date.now(), vencimento: payment.dueDate || '' } }, { merge: true });
    await mudarBloqueio(empresaId, false);
    await db.collection('logs').add({ em: Date.now(), acao: 'Mensalidade paga (Asaas)', alvo: empresaId, det: `R$ ${payment.value}`, por: 'Asaas' });
  } else if (event === 'PAYMENT_OVERDUE') {
    const e = (await ref.get()).data();
    await ref.set({ situacao: 'ATRASADA', atrasadaDesde: e.atrasadaDesde || payment.dueDate || hoje(), linkPagamento: payment.invoiceUrl || '' }, { merge: true });
  }
}
export async function saasRotina() {
  const cfg = await config(), dias = Number(cfg.saasDiasBloqueio ?? 5);
  if (!(dias > 0)) return { bloqueadas: 0 };
  const limite = addDias(hoje(), -dias);
  const atras = (await db.collection('empresas').where('situacao', '==', 'ATRASADA').get()).docs.map((d) => ({ id: d.id, ...d.data() })).filter((e) => e.atrasadaDesde && e.atrasadaDesde <= limite && !e.bloqueadaPorAtraso);
  for (const e of atras) {
    await mudarBloqueio(e.id, true, `Mensalidade do sistema em atraso desde ${e.atrasadaDesde.split('-').reverse().join('/')}. Pague pelo link enviado por e-mail para liberar na hora.`);
    await db.collection('empresas').doc(e.id).set({ bloqueadaPorAtraso: true, bloqueadaEm: Date.now() }, { merge: true });
  }
  // empresas que pagaram depois do bloqueio
  const pagas = (await db.collection('empresas').where('situacao', '==', 'EM_DIA').get()).docs.filter((d) => d.data().bloqueadaPorAtraso);
  for (const d of pagas) await db.collection('empresas').doc(d.id).set({ bloqueadaPorAtraso: false }, { merge: true });
  return { bloqueadas: atras.length };
}
