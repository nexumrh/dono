// Motor de crédito com regras próprias + alerta de fraude entre lojas.
// O portal do vendedor chama logo depois de enviar a proposta: POST /api/motor {"vendaId":"..."}
// Resultado: APROVA sozinho, REPROVA sozinho ou deixa para a análise manual (com o parecer e os alertas).
// Regras em config/sistema.motor (o Dono edita no painel). Modo "sugerir" só grava a recomendação.
import { db, cors, exigirEquipe, hoje, config, asaas, asaasLigadoSrv } from './_base.js';

export const MOTOR_PADRAO = {
  modo: 'sugerir',            // desligado | sugerir | automatico
  idadeMin: 18, idadeMax: 75, rendaMin: 1000,
  fatorRendaNovo: 1.0,        // limite do cliente novo = renda × fator
  limiteMaxNovo: 2500,        // teto do valor financiado para cliente novo
  scoreAprovar: 600,          // nota interna mínima para aprovar sozinho
  scoreReprovar: 300,         // nota interna abaixo disso reprova sozinho
  exigirDocOriginal: true, exigirRosto: true, aceitarEditados: false,
  maxContratosAtivos: 2,
  cidades: '',                // lista separada por vírgula; vazio = qualquer cidade
  fraudeDias: 7,              // procura o mesmo CPF/telefone/e-mail em outra loja nesse período
  fraudeReprova: false,       // true = reprova; false = manda para análise manual
  serasaAuto: false,          // consulta Serasa (Asaas, paga) para cliente novo antes de aprovar
};
const r2 = (x) => Math.round(x * 100) / 100;
const dias = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000);
const sem = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export function nota(hist, renda) {
  let s = 500; let atrasoAberto = 0, emDia = 0, atrasadas = 0, quitados = 0; const motivos = []; const h = hoje();
  for (const v of hist) {
    if (v.status === 'QUITADA') { s += 80; quitados++; }
    if (v.status === 'RETOMADA') { s -= 250; motivos.push('aparelho já retomado'); }
    if (v.reprovadoPorImei) { s -= 300; motivos.push('tentativa com IMEI irregular'); }
    for (const p of v.parcelas || []) {
      if (p.pago) { const d = p.pagoEm ? dias(p.venc, String(p.pagoEm).slice(0, 10)) : 0; if (d <= 0) { s += 25; emDia++; } else { s -= Math.min(60, 5 + 2 * d); atrasadas++; } }
      else if (['ATIVA', 'INSTALANDO'].includes(v.status) && p.venc < h) { s -= 120; atrasoAberto++; }
    }
  }
  s = Math.max(0, Math.min(1000, Math.round(s)));
  if (!hist.length) motivos.push('cliente novo'); if (emDia) motivos.push(`${emDia} parcela(s) em dia`); if (atrasadas) motivos.push(`${atrasadas} paga(s) com atraso`);
  if (quitados) motivos.push(`${quitados} contrato(s) quitado(s)`); if (atrasoAberto) motivos.push(`${atrasoAberto} parcela(s) em atraso agora`);
  const faixa = atrasoAberto ? 'Risco' : s >= 750 ? 'Ouro' : s >= 600 ? 'Prata' : s >= 450 ? 'Bronze' : 'Risco';
  const mult = { Ouro: 2.5, Prata: 1.8, Bronze: 1.2, Risco: 0.5 }[faixa] * (hist.length ? 1 : 0.9);
  return { score: s, faixa, limite: atrasoAberto ? 0 : Math.round(((renda || 0) * mult) / 50) * 50, motivos, atrasoAberto, quitados };
}

export async function avaliarVenda(vendaId) {
  const cfg = (await db.collection('config').doc('sistema').get()).data() || {}; const R = { ...MOTOR_PADRAO, ...(cfg.motor || {}) }; // lido na hora: regra nova vale já
  const ref = db.collection('vendas').doc(vendaId); const v = (await ref.get()).data();
  if (!v) throw Object.assign(new Error('venda não encontrada'), { status: 404 });
  if (v.status !== 'ANALISE') return { resultado: 'IGNORADO', motivo: 'venda não está em análise' };
  const c = v.cliente || {}, vf = v.verificacao || {};
  const reprova = [], manual = [], ok = [], alertas = [];
  // ---- histórico e nota interna ----
  const hist = (await db.collection('vendas').where('clienteCpf', '==', v.clienteCpf).get()).docs.map((d) => ({ id: d.id, ...d.data() })).filter((x) => x.id !== vendaId);
  const N = nota(hist, c.renda);
  // ---- lista negra ----
  const lnIds = ['cpf_' + v.clienteCpf, ...(c.telefones || []).map((t) => 'tel_' + String(t).replace(/\D/g, ''))];
  const ln = (await Promise.all(lnIds.map((i) => db.collection('listanegra').doc(i).get()))).filter((d) => d.exists && d.data().ativo !== false).length;
  if (ln) reprova.push('cliente ou telefone na lista negra');
  // ---- regras do Dono ----
  const idade = c.nasc ? Math.floor((Date.now() - new Date(c.nasc + 'T12:00:00')) / 31557600000) : null;
  if (idade == null) manual.push('sem data de nascimento');
  else if (idade < R.idadeMin) reprova.push(`idade ${idade} abaixo de ${R.idadeMin}`);
  else if (idade > R.idadeMax) reprova.push(`idade ${idade} acima de ${R.idadeMax}`);
  if (!(c.renda >= R.rendaMin)) reprova.push(`renda abaixo do mínimo (R$ ${R.rendaMin})`);
  if (R.cidades) { const lista = R.cidades.split(',').map(sem).filter(Boolean); if (lista.length && !lista.includes(sem(c.cidade))) manual.push(`cidade fora da área (${c.cidade || '—'})`); }
  if (R.exigirDocOriginal && vf.documentoOriginal === false) manual.push('documento parece cópia ou foto de tela');
  if (R.exigirRosto && vf.face?.mesma_pessoa && vf.face.mesma_pessoa !== 'sim') manual.push(`rosto x documento: ${vf.face.mesma_pessoa}`);
  if (!R.aceitarEditados && (vf.editados || []).length) manual.push('dados do documento editados à mão: ' + vf.editados.join(', '));
  if ((c.docDuvidas || []).length) manual.push('campos do documento lidos com dúvida: ' + c.docDuvidas.join(', '));
  if (c.docValidade && c.docValidade < hoje()) manual.push('documento vencido');
  if (N.atrasoAberto) reprova.push('tem parcela em atraso em outro contrato');
  const ativos = hist.filter((x) => ['ATIVA', 'INSTALANDO', 'APROVADA', 'AGUARDANDO_ENTRADA'].includes(x.status)).length;
  if (ativos >= R.maxContratosAtivos) manual.push(`já tem ${ativos} contrato(s) em andamento`);
  const pre = (await db.collection('clientes').doc(v.clienteCpf).get()).data()?.preAprovado;
  const preOk = pre && pre.ate >= hoje() && pre.valor > 0;
  if (preOk) ok.push(`cliente pré-aprovado até R$ ${pre.valor}`);
  if (preOk && !N.atrasoAberto) { /* bom pagador: a nota interna não segura a aprovação */ }
  else   if (N.score < R.scoreReprovar) reprova.push(`nota interna ${N.score} abaixo de ${R.scoreReprovar}`);
  else if (N.score < R.scoreAprovar) manual.push(`nota interna ${N.score} abaixo de ${R.scoreAprovar}`);
  else ok.push(`nota interna ${N.score} (${N.faixa})`);
  // ---- fraude entre lojas: mesmo CPF, telefone ou e-mail em outra loja nos últimos dias ----
  const desde = Date.now() - (Number(R.fraudeDias) || 7) * 86400000;
  const recentes = (await db.collection('vendas').where('criadoEm', '>=', desde).get()).docs.map((d) => ({ id: d.id, ...d.data() })).filter((x) => x.id !== vendaId && x.lojaId !== v.lojaId);
  const tels = new Set(c.telefones || []), email = sem(c.email);
  for (const x of recentes) {
    const xc = x.cliente || {}, mot = [];
    if (x.clienteCpf === v.clienteCpf) mot.push('mesmo CPF');
    if ((xc.telefones || []).some((t) => tels.has(t))) mot.push('mesmo telefone' + (x.clienteCpf !== v.clienteCpf ? ' com outro CPF' : ''));
    if (email && sem(xc.email) === email && x.clienteCpf !== v.clienteCpf) mot.push('mesmo e-mail com outro CPF');
    if (mot.length) alertas.push({ vendaId: x.id, numero: x.numero, loja: x.lojaNome || '', status: x.status, quando: x.criadoEm, motivo: mot.join(', ') });
  }
  if (alertas.length) (R.fraudeReprova ? reprova : manual).push(`fraude entre lojas: ${alertas.map((a) => `nº ${a.numero} em ${a.loja} (${a.motivo})`).join('; ')}`);
  // ---- Serasa automático (cliente novo) ----
  let serasa = v.serasa || null;
  if (R.serasaAuto && !hist.length && !serasa && !reprova.length && (await asaasLigadoSrv().catch(() => false))) {
    try { const r = await asaas('/creditBureauReport', { method: 'POST', body: JSON.stringify({ cpfCnpj: v.clienteCpf, state: c.uf || 'PR' }) }); serasa = { em: Date.now(), por: 'Motor de crédito', link: r.downloadUrl || r.reportFile || '', id: r.id || '' }; manual.push('Serasa consultado: confira o relatório antes de aprovar'); }
    catch (e) { manual.push('não consegui consultar o Serasa: ' + e.message); }
  }
  // ---- decisão ----
  const limite = preOk ? Math.max(pre.valor, N.limite) : Math.max(0, hist.length ? N.limite : Math.min(Math.round((c.renda || 0) * R.fatorRendaNovo / 50) * 50, R.limiteMaxNovo, N.limite || Infinity));
  const resultado = reprova.length ? 'REPROVAR' : manual.length ? 'MANUAL' : 'APROVAR';
  const parecer = { resultado, modo: R.modo, score: N.score, faixa: N.faixa, limite, reprova, manual, ok: [...ok, ...N.motivos], alertas, em: Date.now() };
  const upd = { motor: parecer, ...(alertas.length ? { alertasFraude: alertas } : {}), ...(serasa ? { serasa } : {}) };
  if (R.modo === 'automatico' && resultado !== 'MANUAL') {
    const status = resultado === 'APROVAR' ? 'APROVADA' : 'REPROVADA';
    Object.assign(upd, { status, analise: { resultado: status, por: 'motor', porNome: 'Motor de crédito', em: Date.now(), score: N.score, limite: status === 'APROVADA' ? limite : 0,
      obs: status === 'APROVADA' ? 'Aprovado automaticamente pelas regras de crédito.' : 'Reprovado pelas regras: ' + reprova.join('; '), checklist: { cpf: true, bio: true, doc: true }, automatico: true } });
  }
  await ref.set(upd, { merge: true });
  await db.collection('logs').add({ em: Date.now(), acao: 'Motor de crédito: ' + (upd.status || resultado), alvo: vendaId, det: [...reprova, ...manual].join('; ').slice(0, 400), por: 'Motor de crédito' });
  return { resultado, status: upd.status || 'ANALISE', limite, score: N.score };
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const quem = await exigirEquipe(req, ['DONO', 'FINANCEIRO', 'SUPORTE', 'GERENTE', 'VENDEDOR']);
    const id = String(req.body?.vendaId || '');
    const v = (await db.collection('vendas').doc(id).get()).data();
    if (!v) throw Object.assign(new Error('venda não encontrada'), { status: 404 });
    if (quem.role === 'VENDEDOR' && v.vendedorUid !== quem.uid) throw Object.assign(new Error('sem permissão'), { status: 403 });
    if (quem.role === 'GERENTE' && v.lojaId !== quem.lojaId) throw Object.assign(new Error('sem permissão'), { status: 403 });
    const cfg = (await db.collection('config').doc('sistema').get()).data() || {}; if ((cfg.motor?.modo || MOTOR_PADRAO.modo) === 'desligado') return res.status(200).json({ resultado: 'DESLIGADO' });
    return res.status(200).json(await avaliarVenda(id));
  } catch (e) {
    console.error(e);
    return res.status(e.status || 500).json({ erro: e.message });
  }
}
