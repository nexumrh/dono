// Relatório semanal do atendimento (CRM): toda segunda de manhã o dono recebe por e-mail os números da semana.
// Atendimentos, finalizados, notas da pesquisa, motivos, promessas e acordos de cobrança e o valor recuperado.
import { db, hoje } from './_base.js';
import { brevoLigado, enviarEmail } from './_brevo.js';

const brl = (n) => 'R$ ' + (Number(n) || 0).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const lista = async (c, campo, desde) => (await db.collection(c).where(campo, '>=', desde).get()).docs.map((d) => ({ id: d.id, ...d.data() }));

export async function relatorioCrm(cfg, forcar = false) {
  if (cfg.relCrm === 'nao') return { relatorioCrm: 'desligado' };
  const h = hoje();
  if (!forcar && new Date(h + 'T12:00:00Z').getUTCDay() !== 1) return { relatorioCrm: 'não é segunda' };
  if (!brevoLigado()) return { relatorioCrm: 'sem e-mail configurado' };
  const para = process.env.DONO_EMAIL; if (!para) return { relatorioCrm: 'sem DONO_EMAIL' };
  const marca = db.collection('notificacoes').doc('relcrm-' + h);
  if (!forcar && (await marca.get()).exists) return { relatorioCrm: 'já enviado hoje' };
  const desde = Date.now() - 7 * 864e5, desdeIso = new Date(desde).toISOString().slice(0, 10);
  const [at, app, ch, ped, wa, atr, av, pr, ac] = await Promise.all([lista('atendimentos', 'criadoEm', desde), lista('suporteApp', 'atualizadoEm', desde), lista('chamados', 'criadoEm', desde), lista('pedidos', 'criadoEm', desde),
    lista('waConversas', 'atualizadoEm', desde), lista('crmAtrib', 'em', desde), lista('crmAvaliacoes', 'em', desde), lista('crmPromessas', 'em', desde), lista('crmAcordos', 'em', desde)]);
  const total = at.length + app.length + ch.length + ped.length + wa.length, fin = atr.filter((a) => (a.finalizadoEm || 0) >= desde);
  const media = av.length ? (av.reduce((s, a) => s + (+a.nota || 0), 0) / av.length).toFixed(1) : '—';
  const porAt = {}; av.forEach((a) => { (porAt[a.nome || '—'] ||= []).push(+a.nota || 0); });
  const mot = {}; fin.filter((a) => a.motivo).forEach((a) => (mot[a.motivo] = (mot[a.motivo] || 0) + 1));
  // valor recuperado: parcelas que estavam em atraso e foram pagas na semana
  let recuperado = 0, qtdRec = 0;
  for (const d of (await db.collection('vendas').where('status', 'in', ['ATIVA', 'QUITADA']).get()).docs) for (const p of d.data().parcelas || [])
    if (p.pago && p.pagoEm && String(p.pagoEm).slice(0, 10) >= desdeIso && String(p.pagoEm).slice(0, 10) > p.venc) { recuperado += +p.valorPago || +p.valor || 0; qtdRec++; }
  const linhas = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `<tr><td style="padding:4px 10px 4px 0">${k}</td><td style="padding:4px 0;text-align:right"><b>${v}</b></td></tr>`).join('');
  const html = `<div style="font-family:Arial,sans-serif;color:#0A1733;max-width:640px"><h2 style="margin:0 0 4px">Atendimento NexumCell · semana até ${h.split('-').reverse().join('/')}</h2><p style="color:#5B6478;margin:0 0 16px">Resumo automático do CRM.</p>
    <table style="width:100%;border-collapse:collapse;margin-bottom:16px">${[['Atendimentos na semana', total], ['Finalizados com motivo', fin.length], ['Nota média da pesquisa', `${media} de 5 (${av.length} nota(s))`], ['Promessas de pagamento', `${pr.length} · cumpridas ${pr.filter((p) => p.status === 'CUMPRIDA').length} · quebradas ${pr.filter((p) => p.status === 'QUEBRADA').length}`], ['Acordos propostos', `${ac.length} · ${brl(ac.reduce((s, a) => s + (+a.total || 0), 0))}`], ['Recuperado da cobrança', `${brl(recuperado)} (${qtdRec} parcela(s) atrasadas pagas)`]].map(([k, v]) => `<tr><td style="padding:8px 10px 8px 0;border-bottom:1px solid #EEF1F7;color:#5B6478">${k}</td><td style="padding:8px 0;border-bottom:1px solid #EEF1F7;text-align:right"><b>${v}</b></td></tr>`).join('')}</table>
    <h3 style="margin:0 0 6px;font-size:15px">Principais motivos de contato</h3><table style="width:100%;margin-bottom:16px">${linhas(mot) || '<tr><td style="color:#5B6478">Sem motivos registrados.</td></tr>'}</table>
    <h3 style="margin:0 0 6px;font-size:15px">Nota por atendente</h3><table style="width:100%">${Object.entries(porAt).map(([k, l]) => `<tr><td style="padding:4px 10px 4px 0">${k}</td><td style="text-align:right"><b>${(l.reduce((s, x) => s + x, 0) / l.length).toFixed(1)}</b> (${l.length})</td></tr>`).join('') || '<tr><td style="color:#5B6478">Sem notas na semana.</td></tr>'}</table></div>`;
  await enviarEmail({ para, assunto: `Atendimento NexumCell: ${total} atendimentos, nota ${media}, ${brl(recuperado)} recuperado`, html });
  await marca.set({ em: Date.now(), total });
  return { relatorioCrm: 'enviado', total };
}
