// Relatório semanal automático: toda segunda de manhã cada gerente recebe por e-mail
// a lista de clientes da loja dele com parcelas em atraso (com planilha anexada).
// Desliga em Configurações (relSemanal = 'nao'). Precisa do Brevo (e-mail) configurado.
import { db, hoje, encargos, r2 } from './_base.js';
import { brevoLigado, enviarEmail } from './_brevo.js';

const diasEntre = (a, b) => Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 86400000);
const brl = (n) => 'R$ ' + (Number(n) || 0).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');

export async function relatorioSemanal(cfg, forcar = false) {
  if (cfg.relSemanal === 'nao') return { relatorioSemanal: 'desligado' };
  const h = hoje();
  if (!forcar && new Date(h + 'T12:00:00Z').getUTCDay() !== 1) return { relatorioSemanal: 'não é segunda' };
  if (!brevoLigado()) return { relatorioSemanal: 'sem e-mail configurado' };
  const marca = await db.collection('notificacoes').doc('relsemanal-' + h).get();
  if (marca.exists && !forcar) return { relatorioSemanal: 'já enviado hoje' };
  const vendas = (await db.collection('vendas').where('status', '==', 'ATIVA').get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  const lojas = {};
  for (const v of vendas) {
    const atr = (v.parcelas || []).filter((p) => !p.pago && p.venc < h); if (!atr.length) continue;
    const dias = Math.max(...atr.map((p) => diasEntre(p.venc, h))), devido = r2(atr.reduce((s, p) => s + encargos(p, cfg), 0));
    (lojas[v.lojaId] ||= []).push({ v, dias, devido, n: atr.length });
  }
  const gerentes = (await db.collection('users').where('role', '==', 'GERENTE').get()).docs.map((d) => d.data()).filter((u) => u.ativo !== false && u.email);
  const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  let enviados = 0;
  for (const [lojaId, l] of Object.entries(lojas)) {
    const para = gerentes.filter((u) => u.lojaId === lojaId); if (!para.length) continue;
    l.sort((a, b) => b.dias - a.dias);
    const nome = l[0].v.lojaNome || 'loja', total = r2(l.reduce((s, x) => s + x.devido, 0));
    const csv = '﻿' + [['Contrato', 'Cliente', 'Telefone', 'Aparelho', 'IMEI', 'Parcelas em atraso', 'Dias de atraso', 'Valor devido'].map(q).join(';'),
      ...l.map((x) => [x.v.numero, q(x.v.clienteNome), q((x.v.cliente?.telefones || []).join(' / ')), q(`${x.v.aparelho?.marca || ''} ${x.v.aparelho?.modelo || ''}`), q(x.v.aparelho?.imei || ''), x.n, x.dias, String(x.devido).replace('.', ',')].join(';'))].join('\r\n');
    const texto = `Bom dia! Esta é a lista da semana dos clientes da ${nome} com parcelas em atraso: ${l.length} contrato(s), ${brl(total)} no total.\n\n`
      + l.slice(0, 60).map((x) => `• Nº ${x.v.numero} · ${x.v.clienteNome} · ${(x.v.cliente?.telefones || [])[0] || ''} · ${x.dias} dia(s) · ${brl(x.devido)}`).join('\n')
      + (l.length > 60 ? `\n… e mais ${l.length - 60} na planilha anexada.` : '')
      + `\n\nCobre cada cliente e registre o contato na Fila de cobrança do portal. A planilha completa está anexada.\n\n${cfg.empresa || 'NexumCell'}`;
    for (const u of para) {
      try { await enviarEmail({ para: u.email, assunto: `Clientes para cobrar esta semana — ${nome}`, titulo: `Clientes para cobrar — ${nome}`, texto, anexos: [{ name: `cobrar-${h}.csv`, content: Buffer.from(csv, 'utf8').toString('base64') }] }); enviados++; }
      catch (e) { console.error('relsemanal', u.email, e.message); }
    }
  }
  await db.collection('notificacoes').doc('relsemanal-' + h).set({ tipo: 'REL_SEMANAL', para: 'DONO', em: Date.now(), enviados, lojas: Object.keys(lojas).length, lida: true });
  return { relatorioSemanal: enviados };
}
