// Ações de venda feitas pelo chat dos portais e pelo CRM (nov/2026). POST /api/venda-acoes
//   {acao:'cancelar', vendaId, motivo, atendimentoId?}
//      dono, financeiro e suporte: cancelam qualquer venda em aberto
//      vendedor (venda dele) e gerente (venda da loja): só antes de ativar e sem entrada recebida; senão vai para o suporte
//   {acao:'cadastro', cpf, campos:{telefone, telefone2, email, cep, endereco, bairro, cidade, uf}, atendimentoId?}   · dono, financeiro e suporte
//   {acao:'buscar', q}  · CPF ou nº do contrato em toda a base NexumCell (dados para o chat ajudar o cliente)
//   {acao:'liberar20', vendaId, atendimentoId?}  · libera o aparelho por 20 minutos para o cliente pagar (até 2 vezes por parcela)
import { db, cors, exigirEquipe, asaas } from './_base.js';

const EQUIPE = ['DONO', 'FINANCEIRO', 'SUPORTE'];
const ANTES = ['ANALISE', 'APROVADA', 'AGUARDANDO_ENTRADA', 'INSTALANDO'];
const erro = (m, s = 400, extra = {}) => Object.assign(new Error(m), { status: s, ...extra });
const soD = (s) => String(s || '').replace(/\D/g, '');

async function vendaDe(eu, vendaId, qualquerLoja = false) {
  const ref = db.collection('vendas').doc(String(vendaId || '')), s = await ref.get();
  if (!s.exists) throw erro('Venda não encontrada', 404);
  const v = s.data();
  const dela = qualquerLoja || EQUIPE.includes(eu.role) || (eu.role === 'GERENTE' && v.lojaId === eu.lojaId) || (eu.role === 'VENDEDOR' && v.vendedorUid === eu.uid);
  if (!dela) throw erro('Esta venda não é da sua loja', 403);
  return { ref, v };
}
const log = (eu, acao, alvo, detalhe) => db.collection('logs').add({ em: Date.now(), uid: eu.uid, nome: eu.nome, role: eu.role, acao, alvo, detalhe }).catch(() => {});

async function cancelar(b, eu) {
  const { ref, v } = await vendaDe(eu, b.vendaId), motivo = String(b.motivo || '').trim().slice(0, 300);
  if (motivo.length < 3) throw erro('Escreva o motivo do cancelamento');
  if (['CANCELADA', 'QUITADA', 'REPROVADA', 'RETOMADA'].includes(v.status)) throw erro(`A venda nº ${v.numero} já está ${String(v.status).toLowerCase()}`);
  const entrada = +(v.entradaPaga?.valor || 0);
  if (!EQUIPE.includes(eu.role) && (!ANTES.includes(v.status) || entrada > 0))
    throw erro(v.status === 'ATIVA' ? 'Venda já ativa (contrato assinado e trava instalada): o cancelamento é feito pelo suporte, que confere a devolução do aparelho.' : 'Já tem entrada recebida: o suporte cancela e cuida da devolução do valor.', 409, { suporte: true });
  const agora = Date.now(), batch = db.batch();
  batch.update(ref, { status: 'CANCELADA', canceladoEm: agora, canceladoPor: eu.nome + (b.atendimentoId ? ' (chat)' : ''), motivoCancelamento: motivo });
  if (v.aparelhoToken) batch.set(db.collection('aparelhos').doc(v.aparelhoToken), { status: 'CANCELADO' }, { merge: true });
  let estoque = null; const eid = v.aparelho?.estoqueId || v.aparelho?.imei;
  let e = eid ? await db.collection('estoque').doc(String(eid)).get() : null;
  if (!e?.exists) { const q = await db.collection('estoque').where('vendaId', '==', ref.id).limit(1).get(); e = q.docs[0] || null; }
  if (e?.exists && e.data().status !== 'DISPONIVEL' && (!e.data().vendaId || e.data().vendaId === ref.id)) {
    estoque = e.data().imei || e.id;
    batch.set(e.ref, { status: 'DISPONIVEL', vendaId: '', vendidoEm: null, obs: `Voltou ao estoque: venda nº ${v.numero} cancelada (${motivo})`, atualizadoEm: agora }, { merge: true });
  }
  await batch.commit();
  let apagadas = 0;
  if (v.asaas) { const parcelas = (v.parcelas || []).map((p) => ({ ...p }));
    for (const p of parcelas) if (!p.pago && p.asaasId) { try { await asaas('/payments/' + p.asaasId, { method: 'DELETE' }); apagadas++; } catch (er) { /* segue */ } delete p.asaasId; delete p.asaasLink; }
    if (apagadas) await ref.update({ parcelas }).catch(() => {}); }
  await log(eu, 'Venda cancelada' + (b.atendimentoId ? ' pelo chat' : ' pelo CRM'), ref.id, `nº ${v.numero} · ${motivo}${estoque ? ` · IMEI ${estoque} voltou ao estoque` : ''}${entrada ? ` · entrada de R$ ${entrada.toFixed(2)} a devolver` : ''}`);
  return { ok: true, numero: v.numero, estoque, apagadas, entrada };
}

async function cadastro(b, eu) {
  if (!EQUIPE.includes(eu.role)) throw erro('Só o suporte, o financeiro ou o dono alteram o cadastro', 403);
  const cpf = soD(b.cpf); if (cpf.length !== 11) throw erro('CPF inválido');
  const c = b.campos || {}, tel = soD(c.telefone), tel2 = soD(c.telefone2);
  if (tel && (tel.length < 10 || tel.length > 11)) throw erro('Telefone inválido: use DDD + número');
  if (c.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(c.email).trim())) throw erro('E-mail inválido');
  const end = {}; ['cep', 'endereco', 'bairro', 'cidade', 'uf'].forEach((k) => { if (c[k] !== undefined && String(c[k]).trim()) end[k] = k === 'cep' ? soD(c[k]) : k === 'uf' ? String(c[k]).trim().toUpperCase().slice(0, 2) : String(c[k]).trim().slice(0, 160); });
  const telefones = [tel, tel2].filter(Boolean);
  const cli = { ...end, ...(telefones.length ? { telefones } : {}), ...(c.email ? { email: String(c.email).trim().toLowerCase() } : {}), atualizadoEm: Date.now(), atualizadoPor: eu.nome };
  if (Object.keys(cli).length <= 2) throw erro('Nada para alterar');
  const antes = (await db.collection('clientes').doc(cpf).get()).data() || {};
  await db.collection('clientes').doc(cpf).set(cli, { merge: true });
  const vs = await db.collection('vendas').where('clienteCpf', '==', cpf).get(), batch = db.batch(); let n = 0;
  vs.docs.forEach((d) => { const upd = {}; Object.entries(cli).forEach(([k, val]) => { if (!['atualizadoEm', 'atualizadoPor'].includes(k)) upd['cliente.' + k] = val; }); if (telefones.length) upd.clienteTel = telefones[0]; batch.update(d.ref, upd); n++; });
  if (n) await batch.commit();
  const mudou = Object.keys(cli).filter((k) => !['atualizadoEm', 'atualizadoPor'].includes(k)).map((k) => `${k}: ${JSON.stringify(antes[k] ?? '')} → ${JSON.stringify(cli[k])}`).join('; ');
  await log(eu, 'Cadastro do cliente alterado', cpf, mudou.slice(0, 900));
  return { ok: true, vendas: n };
}

async function liberar20(b, eu) {
  const { v } = await vendaDe(eu, b.vendaId, true); // qualquer loja parceira ajuda um cliente NexumCell
  if (!v.aparelhoToken) throw erro('Este contrato não tem trava instalada');
  const ref = db.collection('aparelhos').doc(v.aparelhoToken), ap = (await ref.get()).data() || {}, agora = Date.now();
  if (ap.status === 'QUITADO' || ap.quitado) throw erro('Contrato quitado: o aparelho já está livre');
  if (ap.roubo && !ap.roubo.liberadoEm) throw erro('Aparelho com roubo ou perda comunicado: só o suporte libera', 409, { suporte: true });
  if (ap.modo === 'TRAVAR') throw erro('Bloqueado manualmente pela equipe: só o suporte libera', 409, { suporte: true });
  // até 2 liberações de 20 min por parcela (a parcela em aberto mais antiga)
  const hj = new Date(agora - 3 * 3600e3).toISOString().slice(0, 10), abertas = (ap.parcelas || v.parcelas || []).filter((p) => !p.pago).sort((x, y) => String(x.venc).localeCompare(String(y.venc)));
  const parc = abertas[0]; if (!parc) throw erro('Não há parcela em aberto: o aparelho não deveria estar travado. Fale com o suporte.', 409, { suporte: true });
  const usos = { ...(ap.lib20Parcelas || {}) }, ja = +usos[parc.n] || 0;
  if (ja >= 2) throw erro(`A parcela ${parc.n} já teve as 2 liberações de 20 minutos. Uma nova liberação é com o suporte.`, 409, { suporte: true });
  usos[parc.n] = ja + 1;
  const ate = Math.max(+ap.liberadoAte || 0, agora + 20 * 60e3);
  await ref.set({ liberadoAte: ate, lib20Em: agora, lib20Parcelas: usos, modoPor: eu.nome + ' (chat, 20 min para pagar)', modoMotivo: `Liberação de 20 minutos para pagar a parcela ${parc.n} (${usos[parc.n]}ª de 2)` }, { merge: true });
  await log(eu, 'Liberação de 20 min para pagar (chat)', v.aparelhoToken, `nº ${v.numero} · ${v.clienteNome || ''} · parcela ${parc.n}${parc.venc < hj ? ' (atrasada)' : ''} · ${usos[parc.n]}ª de 2`);
  return { ok: true, ate, parcela: parc.n, usadas: usos[parc.n], restam: 2 - usos[parc.n] };
}


// busca de cliente NexumCell em toda a base (qualquer loja parceira ajuda o cliente pelo chat)
async function buscar(b, eu) {
  const q = soD(b.q); if (q.length !== 11 && !(q.length >= 1 && q.length <= 9)) throw erro('Mande o CPF (11 dígitos) ou o número do contrato');
  const snap = q.length === 11 ? await db.collection('vendas').where('clienteCpf', '==', q).limit(15).get() : await db.collection('vendas').where('numero', '==', +q).limit(5).get();
  const lojas = {}, nomeLoja = async (id) => { if (!id) return ''; if (!(id in lojas)) lojas[id] = ((await db.collection('lojas').doc(id).get()).data() || {}).nome || ''; return lojas[id]; };
  const vendas = [];
  for (const d of snap.docs) { const v = d.data(); if (v.status === 'RASCUNHO') continue; const propria = EQUIPE.includes(eu.role) || v.lojaId === eu.lojaId;
    vendas.push({ id: d.id, numero: v.numero, status: v.status, clienteNome: v.clienteNome || '', clienteCpf: v.clienteCpf || '', lojaId: v.lojaId || '', lojaNome: v.lojaNome || await nomeLoja(v.lojaId), propria,
      vendedorUid: propria ? v.vendedorUid || '' : '', aparelho: { marca: v.aparelho?.marca || '', modelo: v.aparelho?.modelo || '' }, aparelhoToken: v.aparelhoToken || '', nParcelas: v.nParcelas || (v.parcelas || []).length, financiado: v.financiado || 0,
      parcelas: (v.parcelas || []).map((p) => ({ n: p.n, venc: p.venc, valor: p.valor, pago: !!p.pago, pagoEm: p.pagoEm || null, valorPago: p.valorPago ?? null, pagoParcial: p.pagoParcial || 0, asaasLink: p.pago ? null : p.asaasLink || null })),
      assinadoEm: v.assinadoEm || null, criadoEm: v.criadoEm || null, entradaPaga: v.entradaPaga?.valor ? { valor: v.entradaPaga.valor } : null, motivoReprovacao: v.status === 'REPROVADA' ? v.motivoReprovacao || '' : '',
      analisadoEm: v.analisadoEm || null, aprovadoEm: v.aprovadoEm || null, reprovadoEm: v.reprovadoEm || null, limiteAprovado: v.limiteAprovado || v.limite || null,
      cliente: { telefones: ((v.cliente?.telefones || []).length ? v.cliente.telefones : [v.cliente?.tel || v.cliente?.telefone].filter(Boolean)).slice(0, 1) } }); }
  vendas.sort((x, y) => (+y.criadoEm || 0) - (+x.criadoEm || 0));
  if (vendas.length) await log(eu, 'Busca de cliente no chat', q.length === 11 ? q.slice(0, 3) + '.***.***-' + q.slice(9) : 'nº ' + q, `${vendas.length} contrato(s)${vendas.some((v) => !v.propria) ? ' · inclui outra loja' : ''}`);
  return { vendas };
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const eu = await exigirEquipe(req, ['DONO', 'FINANCEIRO', 'SUPORTE', 'GERENTE', 'VENDEDOR']), b = req.body || {};
    const f = { cancelar, cadastro, liberar20, buscar }[b.acao]; if (!f) return res.status(400).json({ erro: 'ação inválida' });
    return res.json(await f(b, eu));
  } catch (e) { return res.status(e.status || 500).json({ erro: e.message, suporte: !!e.suporte }); }
}
