// Nota fiscal do aparelho (NFC-e, modelo 65) pela Focus NFe (focusnfe.com.br).
// O Asaas só emite nota de SERVIÇO; celular é PRODUTO, por isso a nota sai por um emissor de NF-e/NFC-e.
// Variáveis: FOCUS_NFE_TOKEN (token da empresa na Focus) e FOCUS_NFE_URL
//   (https://homologacao.focusnfe.com.br para testes · https://api.focusnfe.com.br em produção)
// POST /api/nf {"acao":"emitir","vendaId":".."} · {"acao":"consultar","vendaId":".."} · {"acao":"cancelar","vendaId":"..","motivo":".."}
// IMPORTANTE: NCM, CFOP e situação tributária (CSOSN/CST) mudam conforme o regime da loja. Confirme com o seu contador
// e ajuste em Configurações > Nota fiscal antes de emitir em produção.
import { db, cors, exigirEquipe, r2, config } from './_base.js';

const URL_ = () => (process.env.FOCUS_NFE_URL || 'https://homologacao.focusnfe.com.br').replace(/\/$/, '');
async function focus(caminho, opts = {}) {
  if (!process.env.FOCUS_NFE_TOKEN) throw new Error('Nota fiscal não configurada (falta FOCUS_NFE_TOKEN no servidor)');
  const r = await fetch(URL_() + caminho, { ...opts, headers: { Authorization: 'Basic ' + btoa(process.env.FOCUS_NFE_TOKEN + ':'), 'Content-Type': 'application/json' } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok && r.status !== 422) throw new Error('Focus NFe ' + r.status + ': ' + (j.mensagem || JSON.stringify(j.erros || j)));
  return { status: r.status, ...j };
}
const FORMA = { PIX: '17', Dinheiro: '01', 'Cartão de débito': '04', 'Cartão de crédito': '03' };

export function montarNfce(v, cfg) {
  const dig = (x) => String(x || '').replace(/\D/g, ''), ap = v.aparelho || {};
  const itens = [{ desc: `CELULAR ${ap.marca || ''} ${ap.modelo || ''} ${ap.capacidade || ''}`.replace(/\s+/g, ' ').trim().toUpperCase(), valor: r2(v.valor - (v.acessoriosValor || 0)), cod: ap.catalogoId || 'CEL', ncm: cfg.nfNcm || '85171300', extra: `IMEI ${ap.imei || ''}${ap.imei2 ? ' / ' + ap.imei2 : ''}` }];
  (v.acessorios || []).forEach((a) => itens.push({ desc: String(a.nome || 'ACESSORIO').toUpperCase(), valor: r2(a.preco), cod: a.id || 'ACS', ncm: cfg.nfNcmAcessorio || '85177900', extra: '' }));
  const total = r2(itens.reduce((s, i) => s + i.valor, 0));
  const entradaDin = r2(Math.min(total, (v.entradaPaga?.valor || v.entrada || 0)));
  const usado = r2(v.usado?.valor || 0), aPrazo = r2(Math.max(0, total - entradaDin - usado));
  const formas = [];
  if (entradaDin > 0) formas.push({ forma_pagamento: FORMA[v.entradaPaga?.forma] || '99', valor_pagamento: entradaDin.toFixed(2), ...(['03', '04'].includes(FORMA[v.entradaPaga?.forma]) ? { tipo_integracao: '2' } : {}) });
  if (usado > 0) formas.push({ forma_pagamento: '99', descricao_pagamento: 'Aparelho usado na troca', valor_pagamento: usado.toFixed(2) });
  if (aPrazo > 0) formas.push({ forma_pagamento: '05', valor_pagamento: aPrazo.toFixed(2) });   // 05 = crédito loja (crediário)
  return {
    cnpj_emitente: dig(cfg.cnpj), data_emissao: new Date().toISOString(), natureza_operacao: 'VENDA AO CONSUMIDOR',
    tipo_documento: '1', presenca_comprador: '1', finalidade_emissao: '1', consumidor_final: '1', modalidade_frete: '9', local_destino: '1',
    nome_destinatario: String(v.clienteNome || '').slice(0, 60), cpf_destinatario: dig(v.clienteCpf),
    valor_produtos: total.toFixed(2), valor_desconto: '0.00', valor_total: total.toFixed(2),
    informacoes_adicionais_contribuinte: `Contrato ${v.numero} · venda a prazo: entrada + ${v.nParcelas}x de R$ ${Number(v.valorParcela || 0).toFixed(2)}`.slice(0, 500),
    items: itens.map((i, k) => ({
      numero_item: String(k + 1), codigo_produto: String(i.cod).slice(0, 60), descricao: i.desc.slice(0, 120), codigo_ncm: i.ncm, cfop: cfg.nfCfop || '5102',
      unidade_comercial: 'UN', quantidade_comercial: '1.00', valor_unitario_comercial: i.valor.toFixed(2), valor_bruto: i.valor.toFixed(2),
      unidade_tributavel: 'UN', quantidade_tributavel: '1.00', valor_unitario_tributavel: i.valor.toFixed(2), inclui_no_total: '1',
      icms_origem: cfg.nfOrigem || '0', icms_situacao_tributaria: cfg.nfCsosn || '102',
      pis_situacao_tributaria: cfg.nfPisCst || '07', cofins_situacao_tributaria: cfg.nfPisCst || '07',
      ...(i.extra ? { informacoes_adicionais_item: i.extra } : {}),
    })),
    formas_pagamento: formas,
  };
}

const resumo = (j) => ({ status: j.status, ref: j.ref, numero: j.numero || '', serie: j.serie || '', chave: j.chave_nfe || '', mensagem: j.mensagem_sefaz || j.mensagem || '',
  danfe: j.caminho_danfe ? (j.caminho_danfe.startsWith('http') ? j.caminho_danfe : URL_() + j.caminho_danfe) : '', xml: j.caminho_xml_nota_fiscal ? URL_() + j.caminho_xml_nota_fiscal : '',
  qrcode: j.qrcode_url || '', em: Date.now() });

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const b = req.body || {}, quem = await exigirEquipe(req, ['DONO', 'FINANCEIRO', 'GERENTE']);
    const ref = db.collection('vendas').doc(String(b.vendaId)), v = (await ref.get()).data();
    if (!v) throw Object.assign(new Error('venda não encontrada'), { status: 404 });
    if (quem.role === 'GERENTE') { const u = (await db.collection('users').doc(quem.uid).get()).data() || {}; if (u.lojaId !== v.lojaId) throw Object.assign(new Error('sem permissão'), { status: 403 }); }
    const nref = 'nxc-' + String(b.vendaId).replace(/[^A-Za-z0-9-]/g, '');
    if (b.acao === 'emitir') {
      if (v.notaFiscal?.status === 'autorizado') return res.status(200).json(v.notaFiscal);
      const cfg = await config();
      if (!String(cfg.cnpj || '').replace(/\D/g, '')) throw new Error('Preencha o CNPJ da empresa em Configurações');
      const j = await focus('/v2/nfce?ref=' + nref, { method: 'POST', body: JSON.stringify(montarNfce(v, cfg)) });
      const nf = { ...resumo(j), ref: nref, por: quem.nome };
      await ref.set({ notaFiscal: nf }, { merge: true });
      await db.collection('logs').add({ em: Date.now(), acao: 'Nota fiscal (NFC-e)', alvo: b.vendaId, det: `${nf.status} ${nf.numero || ''} ${nf.mensagem || ''}`.slice(0, 200), por: quem.nome });
      return res.status(200).json(nf);
    }
    if (b.acao === 'consultar') {
      const j = await focus('/v2/nfce/' + nref + '?completa=0');
      const nf = { ...(v.notaFiscal || {}), ...resumo(j), ref: nref };
      await ref.set({ notaFiscal: nf }, { merge: true });
      return res.status(200).json(nf);
    }
    if (b.acao === 'cancelar') {
      if (quem.role === 'GERENTE') throw Object.assign(new Error('só o Dono ou o Financeiro cancelam nota'), { status: 403 });
      const just = String(b.motivo || '').trim(); if (just.length < 15) throw new Error('Escreva o motivo do cancelamento (mínimo 15 letras)');
      const j = await focus('/v2/nfce/' + nref, { method: 'DELETE', body: JSON.stringify({ justificativa: just.slice(0, 255) }) });
      const nf = { ...(v.notaFiscal || {}), status: j.status || 'cancelado', mensagem: j.mensagem_sefaz || '', canceladaEm: Date.now(), motivoCancelamento: just };
      await ref.set({ notaFiscal: nf }, { merge: true });
      return res.status(200).json(nf);
    }
    return res.status(400).json({ erro: 'ação desconhecida' });
  } catch (e) {
    console.error(e);
    return res.status(e.status || 500).json({ erro: e.message });
  }
}
