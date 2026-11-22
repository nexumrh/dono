// Alertas de comportamento estranho nas vendas (rotina da noite). Os alertas aparecem no Painel do Dono →
// Segurança das vendas → Alertas, junto com os de notebook, horário e rosto.
//  - vendedor com muitos cancelamentos            - entrada abaixo do mínimo (desconto fora do padrão)
//  - venda feita fora do horário da loja          - o mesmo telefone em CPFs diferentes
//  - vendedor com muitas 1ª parcelas não pagas
import { db, hoje } from './_base.js';

const dias = (a, b) => Math.round((new Date(b + 'T12:00:00Z') - new Date(String(a).slice(0, 10) + 'T12:00:00Z')) / 864e5);
const soD = (s) => String(s || '').replace(/\D/g, '');
const isoBr = (ms) => new Date(ms - 3 * 3600e3).toISOString();

async function alertar(id, a) {
  const ref = db.collection('alertasSeg').doc(id.replace(/[^\w-]/g, '_').slice(0, 140));
  if ((await ref.get()).exists) return 0;
  await ref.set({ em: Date.now(), visto: false, origem: 'comportamento', ...a }); return 1;
}

export async function alertasComportamento(cfg = {}) {
  const agora = Date.now(), h = hoje(), desde = agora - 120 * 864e5;
  const vs = (await db.collection('vendas').where('criadoEm', '>=', desde).get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  const lojas = Object.fromEntries((await db.collection('lojas').get()).docs.map((d) => [d.id, d.data()]));
  let n = 0; const minEnt = Number(cfg.entradaPct) || 0;

  // por vendedor (últimos 30 dias): cancelamentos
  const v30 = vs.filter((v) => v.criadoEm >= agora - 30 * 864e5), porVend = {};
  v30.forEach((v) => { const k = v.vendedorUid || v.criadoPorUid; if (k) (porVend[k] ||= []).push(v); });
  for (const [uid, l] of Object.entries(porVend)) {
    const canc = l.filter((v) => v.status === 'CANCELADA'); if (canc.length >= 3 && canc.length / l.length >= 0.25)
      n += await alertar(`cmp_canc_${uid}_${h.slice(0, 7)}`, { tipo: 'Muitos cancelamentos', detalhe: `${canc.length} de ${l.length} vendas canceladas nos últimos 30 dias. Confira os motivos e se o aparelho voltou para o estoque.`, nome: l[0].vendedorNome || '', role: 'VENDEDOR', lojaNome: l[0].lojaNome || '', grav: canc.length >= 5 ? 'alta' : 'media', uid }); }

  // por venda (últimos 7 dias): entrada abaixo do mínimo e venda fora do horário
  for (const v of vs.filter((x) => x.criadoEm >= agora - 7 * 864e5 && !['CANCELADA', 'REPROVADA'].includes(x.status))) {
    const val = Number(v.valor) || 0, ent = Number(v.entrada) || 0;
    if (minEnt && val > 0 && (ent / val) * 100 < minEnt - 5)
      n += await alertar(`cmp_ent_${v.id}`, { tipo: 'Entrada abaixo do mínimo', detalhe: `Contrato nº ${v.numero}: entrada de ${Math.round((ent / val) * 100)}% (mínimo ${minEnt}%). Confira se houve desconto autorizado.`, nome: v.vendedorNome || '', role: 'VENDEDOR', lojaNome: v.lojaNome || '', grav: (ent / val) * 100 < minEnt / 2 ? 'alta' : 'media', vendaId: v.id });
    const hr = lojas[v.lojaId]?.horario; if (hr?.abre && hr?.fecha) {
      const t = isoBr(v.criadoEm), hm = t.slice(11, 16), dow = new Date(t.slice(0, 10) + 'T12:00:00Z').getUTCDay(), fecha = dow === 6 && hr.sabadoFecha ? hr.sabadoFecha : hr.fecha;
      if ((dow === 0 && !hr.domingo) || hm < hr.abre || hm > fecha)
        n += await alertar(`cmp_hor_${v.id}`, { tipo: 'Venda fora do horário da loja', detalhe: `Contrato nº ${v.numero} feito em ${t.slice(0, 10).split('-').reverse().join('/')} às ${hm} (loja abre ${hr.abre}–${fecha}${dow === 0 ? ', domingo' : ''}).`, nome: v.vendedorNome || '', role: 'VENDEDOR', lojaNome: v.lojaNome || '', grav: 'media', vendaId: v.id });
    }
  }

  // mesmo telefone em CPFs diferentes (últimos 120 dias)
  const porTel = {};
  vs.filter((v) => !['REPROVADA'].includes(v.status)).forEach((v) => { const t = soD((v.cliente?.telefones || [])[0] || v.clienteTel1 || v.cliente?.telefone).slice(-11); if (t.length >= 10) (porTel[t] ||= []).push(v); });
  for (const [t, l] of Object.entries(porTel)) { const cpfs = [...new Set(l.map((v) => v.clienteCpf))]; if (cpfs.length < 2) continue;
    n += await alertar(`cmp_tel_${t}_${cpfs.sort().join('_')}`, { tipo: 'Mesmo telefone em CPFs diferentes', detalhe: `O telefone final ${t.slice(-4)} aparece em ${cpfs.length} clientes: ${l.map((v) => `${v.clienteNome} (nº ${v.numero}, ${v.lojaNome || ''})`).join('; ')}.`, nome: [...new Set(l.map((v) => v.vendedorNome).filter(Boolean))].join(', '), role: 'VENDEDOR', lojaNome: [...new Set(l.map((v) => v.lojaNome).filter(Boolean))].join(', '), grav: 'alta' }); }

  // vendedor com muitas 1ª parcelas não pagas (vendas de 30 a 120 dias)
  const fpd = {};
  vs.filter((v) => v.status !== 'CANCELADA' && v.status !== 'REPROVADA' && (v.parcelas || [])[0]).forEach((v) => { const p = v.parcelas[0]; if (dias(p.venc, h) < 5) return; const k = v.vendedorUid || v.criadoPorUid; if (!k) return;
    const r = (fpd[k] ||= { n: 0, ruins: 0, nome: v.vendedorNome || '', loja: v.lojaNome || '' }); r.n++; if (!p.pago) r.ruins++; });
  for (const [uid, r] of Object.entries(fpd)) if (r.ruins >= 3 && r.ruins / r.n >= 0.3)
    n += await alertar(`cmp_fpd_${uid}_${h.slice(0, 7)}`, { tipo: 'Muitas 1ª parcelas não pagas', detalhe: `${r.ruins} de ${r.n} clientes deste vendedor não pagaram a 1ª parcela. Revise as vendas e o treinamento de análise.`, nome: r.nome, role: 'VENDEDOR', lojaNome: r.loja, grav: r.ruins / r.n >= 0.5 ? 'alta' : 'media', uid });
  return { alertasComportamento: n };
}
