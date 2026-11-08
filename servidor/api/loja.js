// Ações da equipe com o Asaas (exige login no portal: Authorization: Bearer <idToken do Firebase>)
// POST /api/loja {"acao":"cobrancas","vendaId":"..."}          → gera as cobranças das parcelas no Asaas
// POST /api/loja {"acao":"serasa","cpf":"...","uf":"PR"}         → consulta Serasa (paga, pelo Asaas)
// POST /api/loja {"acao":"negativar","vendaId":"...","n":3}      → pede a negativação da parcela (precisa estar liberado na conta)
// POST /api/loja {"acao":"cartao","valor":1299,"parcelas":10,...} → link de pagamento no cartão de crédito
// POST /api/loja {"acao":"antecipar","vendaIds":[...]}           → simula antecipação das parcelas a vencer
import { db, asaas, cors, gerarCobrancas, clienteAsaas, exigirEquipe, r2, hoje } from './_base.js';

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const b = req.body || {};
    if (b.acao === 'cobrancas') {
      await exigirEquipe(req);
      return res.status(200).json(await gerarCobrancas(String(b.vendaId)));
    }
    if (b.acao === 'serasa') {
      await exigirEquipe(req, ['DONO', 'FINANCEIRO']);
      const r = await asaas('/creditBureauReport', { method: 'POST', body: JSON.stringify({ cpfCnpj: String(b.cpf || '').replace(/\D/g, ''), state: b.uf || 'PR' }) });
      return res.status(200).json({ id: r.id, link: r.downloadUrl || r.reportFile || null, criadoEm: r.dateCreated || null, bruto: r });
    }
    if (b.acao === 'negativar') {
      const quem = await exigirEquipe(req, ['DONO', 'FINANCEIRO']);
      const v = (await db.collection('vendas').doc(String(b.vendaId)).get()).data();
      if (!v) throw new Error('venda não encontrada');
      if ((v.parcelas || []).every((p) => !p.asaasId)) await gerarCobrancas(String(b.vendaId));
      const v2 = (await db.collection('vendas').doc(String(b.vendaId)).get()).data();
      const p = (v2.parcelas || []).find((x) => x.n === +b.n) || (v2.parcelas || []).find((x) => !x.pago && x.venc < hoje());
      if (!p?.asaasId) throw new Error('parcela sem cobrança no Asaas');
      const c = v2.cliente || {}, num = (String(c.endereco || '').match(/,\s*(\d+)/) || [])[1] || 'S/N';
      const r = await asaas('/paymentDunnings', { method: 'POST', body: JSON.stringify({
        payment: p.asaasId, type: 'CREDIT_BUREAU', description: `Compra a prazo de aparelho celular — contrato ${v2.numero}`,
        customerName: v2.clienteNome, customerCpfCnpj: String(v2.clienteCpf).replace(/\D/g, ''),
        customerPrimaryPhone: String((c.telefones || [])[0] || '').replace(/\D/g, ''), customerSecondaryPhone: String((c.telefones || [])[1] || '').replace(/\D/g, ''),
        customerPostalCode: String(c.cep || '').replace(/\D/g, ''), customerAddress: c.endereco || '', customerAddressNumber: num, customerProvince: c.bairro || '',
      }) });
      await db.collection('vendas').doc(String(b.vendaId)).set({ negativacao: { id: r.id, status: r.status || 'PENDING', parcela: p.n, em: Date.now(), por: quem.nome } }, { merge: true });
      return res.status(200).json({ id: r.id, status: r.status });
    }
    if (b.acao === 'cartao') {
      const quem = await exigirEquipe(req);
      const cli = await clienteAsaas({ clienteCpf: b.cpf, clienteNome: b.nome, cliente: { telefones: [b.telefone] } });
      const ref = db.collection('linksCartao').doc();
      const n = Math.max(1, Math.min(21, +b.parcelas || 1)), valor = r2(+b.valor);
      const cob = await asaas('/payments', { method: 'POST', body: JSON.stringify({
        customer: cli.id, billingType: 'CREDIT_CARD', dueDate: hoje(), externalReference: 'cartao:' + ref.id,
        description: String(b.descricao || 'Compra NexumCell').slice(0, 500),
        ...(n > 1 ? { installmentCount: n, totalValue: valor } : { value: valor }),
      }) });
      await ref.set({ status: 'AGUARDANDO', valor, parcelas: n, descricao: b.descricao || '', cliente: b.nome, cpf: String(b.cpf || '').replace(/\D/g, ''), link: cob.invoiceUrl, asaasId: cob.id, lojaId: b.lojaId || '', por: quem.nome, criadoEm: Date.now() });
      return res.status(200).json({ id: ref.id, link: cob.invoiceUrl });
    }
    if (b.acao === 'antecipar') {
      await exigirEquipe(req, ['DONO', 'FINANCEIRO']);
      let bruto = 0, liquido = 0, qtd = 0, erros = 0;
      for (const id of (b.vendaIds || []).slice(0, 30)) {
        const v = (await db.collection('vendas').doc(String(id)).get()).data();
        for (const p of (v?.parcelas || []).filter((x) => !x.pago && x.asaasId && x.venc > hoje()).slice(0, 3)) {
          try { const s = await asaas('/anticipations/simulate', { method: 'POST', body: JSON.stringify({ payment: p.asaasId }) });
            bruto += +s.value || p.valor; liquido += +s.netValue || 0; qtd++; } catch (e) { erros++; }
        }
      }
      return res.status(200).json({ qtd, bruto: r2(bruto), liquido: r2(liquido), custo: r2(bruto - liquido), erros });
    }
    return res.status(400).json({ erro: 'ação desconhecida' });
  } catch (e) {
    console.error(e);
    return res.status(e.status || 500).json({ erro: e.message });
  }
}
