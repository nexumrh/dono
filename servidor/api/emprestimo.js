// Empréstimos e crédito da NexumCell: consignado CLT (Crédito do Trabalhador), empréstimo pessoal e iPhone no cartão.
// POST /api/emprestimo
//   {acao:'dataprev', cpf}                         equipe — margem consignável pela API do banco parceiro / Dataprev (segredos/dataprev)
//   {acao:'biometria', id, documento, selfie, selfie2}  equipe — biometria facial feita na loja; confere o rosto e analisa
//   {acao:'analisar', id}                          equipe — análise automática pelas regras de config/emprestimos
//   {acao:'decidir', id, status, obs}              dono e financeiro — aprovar, recusar, contratado, cancelar
//   {acao:'cliente', t}                            público — o cliente abre o link da análise virtual e vê a proposta
//   {acao:'clienteEnviar', t, documento, selfie, selfie2, aceite}  público — biometria e aceite pelo celular do cliente
// Consignado CLT e empréstimo pessoal só saem de "simulação" com a instituição preenchida (autorização do Banco Central
// ou correspondente bancário; no consignado CLT, habilitação no MTE e contrato com a Dataprev).
import { db, cors, exigirEquipe, hoje } from './_base.js';
import { chaveIA } from './ia-autonoma.js';
import { scoreDe } from './score.js';
import { asaas } from './_base.js';

const PAD = {
  instituicao: { tipo: 'NENHUMA' }, dataprev: { modo: 'MANUAL' },
  clt: { ativo: false, taxaMes: 3.4, prazoMax: 48, valorMin: 500, valorMax: 50000, tempoMin: 6, idadeMax: 70, margemPct: 35 },
  pessoal: { ativo: false, modoTaxa: 'TOTAL', taxa: 100, prazoMax: 12, valorMin: 200, valorMax: 5000, comprometeMax: 30, limiteNovo: 500, limiteBom: 2000, iof: true },
  cartao: { ativo: true },
};
const NOME = { clt: 'Consignado CLT', pessoal: 'Empréstimo pessoal', cartao: 'iPhone no cartão' };
const ST = { APROVADO: 'Aprovado', RECUSADO: 'Recusado', PENDENTE: 'Aguardando decisão', CONTRATADO: 'Contratado', CANCELADO: 'Cancelado', EM_ANALISE: 'Em análise' };
const VISAO = process.env.GROQ_MODELO_VISAO || 'meta-llama/llama-4-scout-17b-16e-instruct';
const soD = (s) => String(s || '').replace(/\D/g, '');
const brl = (n) => 'R$ ' + (Number(n) || 0).toFixed(2).replace('.', ',');
const meses = (a, b) => { const x = new Date(a + 'T12:00'), y = new Date(b + 'T12:00'); return (y.getFullYear() - x.getFullYear()) * 12 + y.getMonth() - x.getMonth() - (y.getDate() < x.getDate() ? 1 : 0); };
const erro = (m, s = 400) => Object.assign(new Error(m), { status: s });

async function cfgEmp() { const d = (await db.collection('config').doc('emprestimos').get()).data() || {}; const c = {}; for (const k of Object.keys(PAD)) c[k] = { ...PAD[k], ...(d[k] || {}) }; return c; }
const autorizada = (c) => (c.instituicao?.tipo || 'NENHUMA') !== 'NENHUMA';

async function historicoCpf(cpf) {
  const vs = (await db.collection('vendas').where('clienteCpf', '==', cpf).get()).docs.map((d) => d.data()), h = hoje();
  let pagas = 0, emDia = 0, atrasoMax = 0, atrasadas = 0;
  for (const v of vs) for (const p of v.parcelas || []) {
    if (p.pago) { pagas++; const d = p.pagoEm ? Math.round((new Date(p.pagoEm) - new Date(p.venc)) / 864e5) : 0; if (d <= 3) emDia++; atrasoMax = Math.max(atrasoMax, d); }
    else if (p.venc < h) { atrasadas++; atrasoMax = Math.max(atrasoMax, Math.round((new Date(h) - new Date(p.venc)) / 864e5)); }
  }
  return { contratos: vs.length, pagas, emDia, atrasoMax, atrasadas };
}

// rosto: selfie de frente x documento, e as duas selfies (prova de vida: ângulos diferentes, não é foto de tela)
async function conferirRosto(b) {
  const chave = await chaveIA(); if (!chave) return { status: 'DUVIDA', observacao: 'IA sem chave: a equipe confere as fotos.' };
  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer ' + chave, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: VISAO, temperature: 0, max_tokens: 350, response_format: { type: 'json_object' }, messages: [{ role: 'user', content: [
        { type: 'text', text: 'Imagem 1: documento de identidade com foto. Imagem 2: selfie de frente tirada agora. Imagem 3: selfie tirada agora virando o rosto. Responda SOMENTE em JSON: {"documento_legivel":true,"rosto_no_documento":true,"mesma_pessoa":"sim|nao|incerto","confianca":0,"selfies_mesma_pessoa":true,"angulos_diferentes":true,"foto_de_tela_ou_papel":false,"observacao":"1 frase em português"}. "confianca" de 0 a 100 para a selfie ser a pessoa do documento.' },
        ...[b.documento, b.selfie, b.selfie2].map((u) => ({ type: 'image_url', image_url: { url: u } }))] }] }) });
    if (!r.ok) return { status: 'DUVIDA', observacao: 'A IA não respondeu (' + r.status + '): a equipe confere as fotos.' };
    const j = JSON.parse((await r.json()).choices?.[0]?.message?.content || '{}'), conf = +j.confianca || 0;
    const reprova = j.foto_de_tela_ou_papel || j.mesma_pessoa === 'nao' || j.selfies_mesma_pessoa === false;
    const status = reprova ? 'REPROVADA' : j.mesma_pessoa === 'sim' && conf >= 70 && j.angulos_diferentes !== false && j.documento_legivel !== false ? 'APROVADA' : 'DUVIDA';
    return { status, confianca: conf, observacao: j.observacao || '', ia: j };
  } catch (e) { return { status: 'DUVIDA', observacao: 'Falha na IA: a equipe confere as fotos.' }; }
}

async function salvarBiometria(id, p, b, extra) {
  for (const k of ['documento', 'selfie', 'selfie2']) if (!/^data:image\/(jpeg|png|webp);base64,/.test(String(b[k] || '')) || b[k].length > 400000) throw erro('Foto inválida ou grande demais: ' + k);
  const bio = await conferirRosto(b);
  await db.collection('empBiometria').doc(id).set({ documento: b.documento, selfie: b.selfie, selfie2: b.selfie2, em: Date.now(), cpf: p.cpf, lojaId: p.lojaId || '', ...extra });
  const biometria = { status: bio.status, confianca: bio.confianca ?? null, observacao: bio.observacao, em: Date.now(), modo: extra.modo };
  await db.collection('emprestimos').doc(id).set({ biometria, atualizadoEm: Date.now() }, { merge: true });
  return biometria;
}

export async function analisar(id) {
  const ref = db.collection('emprestimos').doc(id), p = (await ref.get()).data(); if (!p) throw erro('Proposta não encontrada', 404);
  if (!['EM_ANALISE'].includes(p.status)) return { status: p.status, motivos: p.analise?.motivos || [] };
  const c = await cfgEmp(), cf = c[p.produto], m = [], ok = (t) => m.push({ t, ok: true }), nao = (t) => m.push({ t }), alerta = (t) => m.push({ t, alerta: true });
  let status = 'APROVADO';
  const recusa = (t) => { nao(t); status = 'RECUSADO'; }, duvida = (t) => { alerta(t); if (status !== 'RECUSADO') status = 'PENDENTE'; };
  if (!cf) recusa('Produto desconhecido');
  else {
    if (!cf.ativo) recusa(NOME[p.produto] + ' está desligado');
    if (p.produto !== 'cartao' && !autorizada(c)) recusa('NexumCell ainda não habilitada para este produto (só simulação)');
    if (p.lojaId) { const l = (await db.collection('lojas').doc(p.lojaId).get()).data() || {}; if (!l.emprestimos?.[p.produto]) recusa('Produto não liberado para a loja'); }
    if (p.valor < cf.valorMin || p.valor > cf.valorMax) recusa(`Valor fora da faixa (${brl(cf.valorMin)} a ${brl(cf.valorMax)})`);
    if (p.prazo > cf.prazoMax) recusa(`Prazo acima de ${cf.prazoMax} meses`);
    const nasc = p.cliente?.nascimento, idade = nasc ? Math.floor(meses(nasc, hoje()) / 12) : null;
    if (idade == null) duvida('Sem data de nascimento'); else if (idade < 18) recusa('Menor de 18 anos'); else if (idade > (p.produto === 'clt' ? cf.idadeMax : 75)) recusa(`Idade ${idade} acima do limite`); else ok(`Idade ${idade} anos`);
    if ((await db.collection('listanegra').doc('cpf_' + p.cpf).get()).exists) recusa('CPF na lista negra da NexumCell');
    const b = p.biometria;
    if (!b) duvida('Sem biometria facial');
    else if (b.status === 'REPROVADA') recusa('Biometria facial: o rosto não confere com o documento' + (b.observacao ? ` (${b.observacao})` : ''));
    else if (b.status === 'DUVIDA') duvida('Biometria facial em dúvida: a equipe confere as fotos');
    else ok(`Biometria facial confere (${b.confianca ?? '—'}%)`);
    const h = await historicoCpf(p.cpf), sc = scoreDe((await db.collection('vendas').where('clienteCpf', '==', p.cpf).get()).docs.map((d) => d.data()));
    if (h.contratos) { if (sc.score < 300) recusa(`Score NexumCell ${sc.score} (${sc.faixa})`); else if (sc.score < 450) duvida(`Score NexumCell ${sc.score} (${sc.faixa})`); else ok(`Score NexumCell ${sc.score} (${sc.faixa})`); }
    if (h.atrasadas) recusa(`${h.atrasadas} parcela(s) em atraso na NexumCell`);
    else if (h.atrasoMax > 30) recusa(`Já atrasou ${h.atrasoMax} dias na NexumCell`);
    else if (h.pagas) ok(`${h.pagas} parcela(s) paga(s) na NexumCell, ${h.emDia} em dia`);
    if (p.produto === 'clt') {
      const e = p.emprego || {}, mg = +p.margem?.disponivel || 0;
      if (e.admissao) { const t = meses(e.admissao, hoje()); t < cf.tempoMin ? recusa(`${t} mês(es) de empresa (mínimo ${cf.tempoMin})`) : ok(`${t} meses de empresa`); } else duvida('Sem data de admissão');
      if (p.parcela > mg) recusa(`Parcela ${brl(p.parcela)} passa da margem ${brl(mg)}`); else ok(`Parcela ${brl(p.parcela)} cabe na margem ${brl(mg)}`);
      if (p.margem?.fonte !== 'DATAPREV') duvida('Margem informada pelo holerite: a equipe confere o documento');
    }
    if (p.produto === 'pessoal') {
      const ren = +p.renda?.mensal || 0, mx = ren * cf.comprometeMax / 100;
      if (!ren) recusa('Sem renda informada'); else if (p.parcela > mx) recusa(`Parcela ${brl(p.parcela)} passa de ${cf.comprometeMax}% da renda (${brl(mx)})`); else ok(`Parcela até ${cf.comprometeMax}% da renda`);
      const lim = (await db.collection('limitesCliente').doc(p.cpf).get()).data();
      if (lim?.bloqueado) recusa('Limite do cliente bloqueado');
      const teto = lim ? Math.max(0, (+lim.limite || 0) - (+lim.usado || 0)) : h.pagas >= 6 && !h.atrasoMax ? cf.limiteBom : cf.limiteNovo;
      if (p.valor > teto) duvida(`Valor acima do limite disponível (${brl(teto)})`); else ok(`Dentro do limite disponível (${brl(teto)})`);
    }
  }
  const analise = { em: Date.now(), por: 'Análise automática', motivos: m };
  await ref.set({ status, analise, atualizadoEm: Date.now(), historico: [...(p.historico || []), { em: Date.now(), por: 'Análise automática', obs: ST[status] }] }, { merge: true });
  return { status, motivos: m };
}

async function decidir(id, status, obs, quem) {
  if (!['APROVADO', 'RECUSADO', 'CONTRATADO', 'CANCELADO'].includes(status)) throw erro('Situação inválida');
  const ref = db.collection('emprestimos').doc(id), p = (await ref.get()).data(); if (!p) throw erro('Proposta não encontrada', 404);
  if (status === 'CONTRATADO' && p.produto === 'pessoal') {
    const lr = db.collection('limitesCliente').doc(p.cpf), l = (await lr.get()).data() || {};
    await lr.set({ nome: p.cliente?.nome || l.nome || '', limite: l.limite ?? p.valor, usado: (+l.usado || 0) + (+p.valor || 0), atualizadoEm: Date.now(), por: quem }, { merge: true });
  }
  let extra = {};
  if (status === 'CONTRATADO' && ['pessoal', 'clt'].includes(p.produto) && !p.parcelas) {
    const base = new Date(); base.setUTCDate(base.getUTCDate() + 30);
    extra.parcelas = Array.from({ length: +p.prazo || 1 }, (_, k) => { const d = new Date(base); d.setUTCMonth(d.getUTCMonth() + k); return { n: k + 1, venc: d.toISOString().slice(0, 10), valor: +p.parcela, pago: false, ...(p.produto === 'clt' ? { forma: 'FOLHA' } : {}) }; });
    extra.contratadoEm = Date.now();
  }
  await ref.set({ ...extra, status, decididoPor: quem, decididoEm: Date.now(), atualizadoEm: Date.now(), historico: [...(p.historico || []), { em: Date.now(), por: quem, obs: ST[status] + (obs ? ': ' + obs : '') }] }, { merge: true });
  return { status };
}

function textoContrato(p, c) {
  const brlx = brl, d = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }), cl = p.cliente || {};
  return [`CÉDULA DE CRÉDITO · ${NOME[p.produto].toUpperCase()} · Nº ${p.protocolo || ''}`,
    `CREDOR: ${c.instituicao?.nome || 'NexumCell'}${c.instituicao?.cnpj ? ', CNPJ ' + c.instituicao.cnpj : ''}${c.instituicao?.tipo === 'CORRESPONDENTE' ? ' (por meio da NexumCell, correspondente)' : ''}.`,
    `EMITENTE (CLIENTE): ${cl.nome || ''}, CPF ${String(p.cpf).replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')}, telefone ${cl.telefone || ''}.`,
    `1. VALOR E PAGAMENTO. O cliente recebe ${brlx(p.valor)} e pagará ${p.prazo} parcelas mensais de ${brlx(p.parcela)}, total de ${brlx(p.total)}, com a 1ª em 30 dias${p.produto === 'clt' ? ', descontadas em folha de pagamento pelo empregador, até o limite da margem consignável' : ', por Pix ou boleto'}.`,
    `2. CUSTO. Juros de ${p.taxa?.modo === 'TOTAL' ? p.taxa.valor + '% sobre o total' : (p.taxa?.valor || 0) + '% ao mês'}${p.iof ? `, IOF de ${brlx(p.iof)}` : ''}. Custo Efetivo Total (CET): ${p.cetMes ?? '—'}% ao mês e ${p.cetAno ?? '—'}% ao ano.`,
    `3. ATRASO. Parcela em atraso tem multa de 2% e juros de mora de 1% ao mês, e o nome pode ser incluído nos órgãos de proteção ao crédito após aviso prévio.`,
    `4. QUITAÇÃO ANTECIPADA. O cliente pode antecipar parcelas ou quitar o contrato com redução proporcional dos juros.`,
    `5. ARREPENDIMENTO. O cliente pode desistir em até 7 dias da assinatura, devolvendo o valor recebido, sem juros.`,
    `6. DADOS (LGPD). Os dados e a biometria facial são usados para identificar o cliente, analisar o crédito e cobrar, e ficam guardados com segurança pelo prazo legal.`,
    `7. ASSINATURA ELETRÔNICA. O cliente assina eletronicamente, com confirmação do CPF, selfie e registro de data, hora e endereço IP, que valem como prova de autoria.`,
    `Foz do Iguaçu/PR, ${d}.`].join('\n\n');
}
async function porContrato(t) {
  if (!/^[a-f0-9]{24,64}$/.test(String(t || ''))) throw erro('Link inválido', 404);
  const d = (await db.collection('emprestimos').where('contratoToken', '==', t).get()).docs[0]; if (!d) throw erro('Link inválido', 404);
  return { id: d.id, p: d.data() };
}
async function sha256(t) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)); return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join(''); }

async function porToken(t) {
  if (!/^[a-f0-9]{24,64}$/.test(String(t || ''))) throw erro('Link inválido', 404);
  const d = (await db.collection('emprestimos').where('linkToken', '==', t).get()).docs[0]; if (!d) throw erro('Link inválido', 404);
  return { id: d.id, p: d.data() };
}
const resumo = (p) => ({ nome: String(p.cliente?.nome || '').split(' ')[0], produto: NOME[p.produto], valor: p.valor, prazo: p.prazo, parcela: p.parcela, total: p.total, iof: p.iof || 0, cetMes: p.cetMes, cetAno: p.cetAno, taxa: p.taxa,
  loja: p.lojaNome || 'NexumCell', status: p.status, expirado: (p.linkExpira || 0) < Date.now(), protocolo: p.protocolo });

// rotina (a cada 15 min): analisa o que ficou parado
export async function emprestimoRotina() {
  const l = (await db.collection('emprestimos').where('status', '==', 'EM_ANALISE').get()).docs; let n = 0;
  for (const d of l) if (!d.data().analise && (d.data().atualizadoEm || 0) < Date.now() - 120e3) { try { await analisar(d.id); n++; } catch (e) { console.error('emprestimo', d.id, e.message); } }
  return { emprestimos: n };
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  const b = req.body || {};
  try {
    if (b.acao === 'cliente') { const { p } = await porToken(b.t); return res.json(resumo(p)); }
    if (b.acao === 'contrato') { const { p } = await porContrato(b.c); return res.json({ ...resumo(p), status: p.status, assinado: p.contrato?.status === 'ASSINADO', expirado: (p.contratoExpira || 0) < Date.now(), texto: p.contratoTexto || '' }); }
    if (b.acao === 'assinar') {
      const { id, p } = await porContrato(b.c);
      if (p.contrato?.status === 'ASSINADO') throw erro('Este contrato já foi assinado.');
      if ((p.contratoExpira || 0) < Date.now()) throw erro('O link venceu. Peça um novo à loja.');
      if (b.aceite !== true) throw erro('Marque que leu e aceita o contrato.');
      if (soD(b.cpfFim) !== String(p.cpf).slice(-4)) throw erro('Os 4 últimos números do CPF não conferem.');
      for (const k of ['assinatura', 'selfie']) if (!/^data:image\/(png|jpeg|webp);base64,/.test(String(b[k] || '')) || b[k].length > 400000) throw erro('Falta a ' + (k === 'selfie' ? 'selfie' : 'assinatura') + '.');
      const bio = (await db.collection('empBiometria').doc(id).get()).data(), conf = bio?.documento ? await conferirRosto({ documento: bio.documento, selfie: b.selfie, selfie2: b.selfie }) : { status: 'DUVIDA' };
      const ip = req.headers['cf-connecting-ip'] || '', hash = await sha256(p.contratoTexto || '');
      await db.collection('empContratos').doc(id).set({ texto: p.contratoTexto, hash, assinatura: b.assinatura, selfie: b.selfie, ip, aparelho: String(req.headers['user-agent'] || '').slice(0, 160), em: Date.now(), rosto: conf.status, confianca: conf.confianca ?? null });
      await db.collection('emprestimos').doc(id).set({ contrato: { status: 'ASSINADO', em: Date.now(), hash, ip, rosto: conf.status }, contratoToken: null, atualizadoEm: Date.now(), historico: [...(p.historico || []), { em: Date.now(), por: 'Cliente (link)', obs: 'Contrato assinado eletronicamente' + (conf.status === 'REPROVADA' ? ' · ATENÇÃO: rosto não confere' : '') }] }, { merge: true });
      return res.json({ ok: true, rosto: conf.status });
    }
    if (b.acao === 'clienteEnviar') {
      const { id, p } = await porToken(b.t);
      if (p.status !== 'AGUARDANDO_CLIENTE') throw erro('Esta proposta já foi enviada.');
      if ((p.linkExpira || 0) < Date.now()) throw erro('O link venceu. Peça um novo à loja.');
      if (b.aceite !== true) throw erro('Confirme que leu e aceita a proposta.');
      if (soD(b.cpfFim) !== String(p.cpf).slice(-4)) throw erro('Os 4 últimos números do CPF não conferem.');
      const ip = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || '';
      await salvarBiometria(id, p, b, { modo: 'VIRTUAL', ip, aparelho: String(req.headers['user-agent'] || '').slice(0, 160) });
      await db.collection('emprestimos').doc(id).set({ status: 'EM_ANALISE', aceite: { em: Date.now(), ip }, linkToken: null, historico: [...(p.historico || []), { em: Date.now(), por: 'Cliente (link)', obs: 'Biometria facial e aceite pelo celular' }] }, { merge: true });
      const r = await analisar(id);
      return res.json({ status: r.status });
    }
    const eu = await exigirEquipe(req, ['DONO', 'FINANCEIRO', 'COMERCIAL', 'GERENTE', 'VENDEDOR', 'SUPORTE']);
    const daLoja = async (id) => { const p = (await db.collection('emprestimos').doc(id).get()).data(); if (!p) throw erro('Proposta não encontrada', 404); if (['GERENTE', 'VENDEDOR'].includes(eu.role) && p.lojaId !== eu.lojaId) throw erro('sem permissão', 403); return p; };
    if (b.acao === 'dataprev') {
      const cpf = soD(b.cpf); if (cpf.length !== 11) throw erro('CPF inválido');
      const s = (await db.collection('segredos').doc('dataprev').get()).data();
      if ((await cfgEmp()).dataprev.modo !== 'PARCEIRO' || !s?.url) return res.json({ naoConfigurado: true });
      const r = await fetch(s.url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(s.token ? { Authorization: 'Bearer ' + s.token } : {}) }, body: JSON.stringify({ cpf, consentimento: true }) });
      const j = await r.json().catch(() => ({})); if (!r.ok) throw erro('Dataprev/parceiro: ' + (j.erro || j.message || r.status), 502);
      await db.collection('logs').add({ em: Date.now(), uid: eu.uid, nome: eu.nome, role: eu.role, acao: 'Consulta de margem (Dataprev)', alvo: 'cpf ***' + cpf.slice(-3), detalhe: '' });
      return res.json({ margemDisponivel: +(j.margemDisponivel ?? j.margem ?? 0), salarioLiquido: +(j.salarioLiquido ?? j.remuneracaoDisponivel ?? 0) || null, admissao: j.admissao || j.dataAdmissao || '', empregador: j.empregador || (j.cnpjEmpregador ? { cnpj: j.cnpjEmpregador, nome: j.nomeEmpregador || '' } : null) });
    }
    if (b.acao === 'biometria') { const p = await daLoja(b.id); await salvarBiometria(b.id, p, b, { modo: 'LOJA', por: eu.nome }); return res.json(await analisar(b.id)); }
    if (b.acao === 'analisar') { await daLoja(b.id); return res.json(await analisar(b.id)); }
    if (b.acao === 'gerarContrato') {
      if (!['DONO', 'FINANCEIRO'].includes(eu.role)) throw erro('sem permissão', 403);
      const p = await daLoja(b.id); if (p.status !== 'APROVADO') throw erro('Só proposta aprovada gera contrato.');
      const c = await cfgEmp(), tk = [...crypto.getRandomValues(new Uint8Array(18))].map((x) => x.toString(16).padStart(2, '0')).join('');
      await db.collection('emprestimos').doc(b.id).set({ contratoToken: tk, contratoExpira: Date.now() + 72 * 3600e3, contratoTexto: textoContrato(p, c), contrato: { status: 'ENVIADO', em: Date.now() }, historico: [...(p.historico || []), { em: Date.now(), por: eu.nome, obs: 'Contrato gerado e enviado para assinatura' }] }, { merge: true });
      return res.json({ token: tk });
    }
    if (b.acao === 'pix') {
      const p = await daLoja(b.id), parc = (p.parcelas || []).find((x) => x.n === +b.n); if (!parc || parc.pago) throw erro('Parcela inexistente ou já paga.'); if (parc.forma === 'FOLHA') throw erro('Esta parcela é descontada em folha.');
      let cli = (await asaas('/customers?cpfCnpj=' + p.cpf)).data?.[0];
      if (!cli) cli = await asaas('/customers', { method: 'POST', body: JSON.stringify({ name: p.cliente?.nome, cpfCnpj: p.cpf, mobilePhone: soD(p.cliente?.telefone) }) });
      const ref = `emp:${b.id}:${parc.n}`; let cob = (await asaas('/payments?externalReference=' + encodeURIComponent(ref) + '&status=PENDING')).data?.[0];
      if (!cob) cob = await asaas('/payments', { method: 'POST', body: JSON.stringify({ customer: cli.id, billingType: 'PIX', value: parc.valor, dueDate: hoje(), externalReference: ref, description: `NexumCell ${NOME[p.produto]} ${p.protocolo || ''} parcela ${parc.n}` }) });
      const qr = await asaas(`/payments/${cob.id}/pixQrCode`);
      return res.json({ valor: parc.valor, copiaECola: qr.payload, qrBase64: qr.encodedImage, cobranca: cob.id });
    }
    if (b.acao === 'decidir') { if (!['DONO', 'FINANCEIRO'].includes(eu.role)) throw erro('sem permissão', 403); return res.json(await decidir(b.id, b.status, String(b.obs || '').slice(0, 300), eu.nome)); }
    throw erro('ação inválida');
  } catch (e) { res.status(e.status || 500).json({ erro: e.message }); }
}

// baixa automática da parcela de empréstimo paga pelo Pix do Asaas (externalReference emp:<id>:<n>)
export async function baixarParcelaEmprestimo(ref, valor, cobrancaId) {
  const [, id, n] = String(ref).split(':'); const r = db.collection('emprestimos').doc(id), p = (await r.get()).data(); if (!p) return false;
  const parcelas = (p.parcelas || []).map((x) => (x.n === +n && !x.pago ? { ...x, pago: true, pagoEm: new Date().toISOString(), valorPago: +valor, forma: 'PIX (Asaas)', cobranca: cobrancaId } : x));
  const quitado = parcelas.every((x) => x.pago);
  await r.set({ parcelas, ...(quitado ? { quitadoEm: Date.now() } : {}), atualizadoEm: Date.now() }, { merge: true });
  if (quitado && p.produto === 'pessoal') { const lr = db.collection('limitesCliente').doc(p.cpf), l = (await lr.get()).data(); if (l) await lr.set({ usado: Math.max(0, (+l.usado || 0) - (+p.valor || 0)) }, { merge: true }); }
  return true;
}
