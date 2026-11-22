// Score NexumCell (0 a 1000): nota própria do cliente pelo histórico de pagamento na NexumCell.
// Mesma conta no CRM, no Painel do Dono e na análise de empréstimo.
export function scoreDe(vendas, h = new Date().toISOString().slice(0, 10)) {
  const vs = (vendas || []).filter((v) => !['REPROVADA', 'CANCELADA'].includes(v.status));
  if (!vs.length) return { score: 500, faixa: 'Sem histórico', pagas: 0, atrasadas: 0 };
  const dias = (a, b) => Math.round((new Date(b + 'T12:00:00Z') - new Date(String(a).slice(0, 10) + 'T12:00:00Z')) / 864e5);
  let s = 550, pagas = 0, atrasadas = 0;
  for (const v of vs) {
    if (v.status === 'QUITADA') s += 60;
    if (v.status === 'RETOMADA') s -= 300;
    for (const p of v.parcelas || []) {
      if (p.pago) { pagas++; const d = p.pagoEm ? dias(p.venc, String(p.pagoEm).slice(0, 10)) : 0; s += d <= 3 ? 12 : d <= 15 ? 4 : d <= 30 ? -10 : -30; }
      else if (p.venc < h) { atrasadas++; s -= Math.min(250, 40 + dias(p.venc, h) * 2); }
    }
  }
  const score = Math.max(0, Math.min(1000, Math.round(s)));
  return { score, faixa: score >= 750 ? 'Excelente' : score >= 600 ? 'Bom' : score >= 450 ? 'Regular' : 'Risco', pagas, atrasadas };
}
