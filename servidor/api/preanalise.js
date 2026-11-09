// Pré-análise online do portal do cliente (link público ?pre), gravada pelo servidor.
// POST /api/preanalise {"acao":"enviar", ...dados}  → cria (valida CPF, idade, tamanho; no máximo 3 por CPF por dia)
// POST /api/preanalise {"acao":"ver","id":".."}      → situação (só os campos que o cliente pode ver)
// POST /api/preanalise {"acao":"agendar","id":"..","data":"AAAA-MM-DD","hora":"HH:MM"} → agenda a retirada (só pré-aprovado)
import { db, cors, hoje, config, r2 } from './_base.js';

const dig = (s) => String(s || '').replace(/\D/g, '');
function cpfOk(c) {
  c = dig(c); if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false;
  for (const t of [9, 10]) { let s = 0; for (let i = 0; i < t; i++) s += +c[i] * (t + 1 - i); if ((s * 10) % 11 % 10 !== +c[t]) return false; }
  return true;
}
const txt = (s, n) => String(s ?? '').replace(/[<>]/g, '').trim().slice(0, n);
const brl = (n) => 'R$ ' + Number(n || 0).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const diasAtraso = (venc) => Math.floor((new Date(hoje()) - new Date(venc)) / 86400e3);

// Pré-aprovação automática: responde na hora, com regras simples. A análise de verdade (documento,
// biometria, Serasa) continua na loja; isto só diz ao cliente se vale a pena ir até lá e com quanto.
export async function decidir(p, vit, cfg) {
  const pct = Number(cfg.preRendaPct) || 30, minLim = Number(cfg.preLimiteMin) || 300, maxLim = Number(cfg.preLimiteMax) || 0;
  const entPct = Number(vit.entradaPct ?? cfg.entradaPct) || 30;
  const n = Math.max(...String(vit.parcelasOpcoes || cfg.parcelasOpcoes || '12').split(',').map(Number).filter((x) => x > 0), 1);
  // 1) lista negra (CPF ou telefone): não explica o motivo ao cliente
  const ln = await Promise.all([db.collection('listanegra').doc('cpf_' + p.cpf).get(), db.collection('listanegra').doc('tel_' + p.telefone).get()]);
  if (ln.some((d) => d.exists && d.data()?.ativo !== false)) return { status: 'CONTATADO', resposta: 'Recebemos seus dados. A loja vai analisar e falar com você pelo WhatsApp.', auto: { motivo: 'lista negra' } };
  // 2) histórico na loja
  const hist = (await db.collection('vendas').where('clienteCpf', '==', p.cpf).get()).docs.map((d) => d.data());
  const atrasoAberto = Math.max(0, ...hist.filter((v) => v.status === 'ATIVA').flatMap((v) => (v.parcelas || []).filter((x) => !x.pago).map((x) => diasAtraso(x.venc))));
  if (hist.some((v) => v.status === 'RETOMADA') || atrasoAberto > 30) return { status: 'RECUSADA', resposta: 'No momento não conseguimos aprovar uma nova compra. Regularize o contrato em aberto e tente de novo.', auto: { motivo: 'histórico' } };
  if (hist.some((v) => v.status === 'ATIVA')) return { status: 'CONTATADO', resposta: 'Você já tem um contrato com a gente. A loja vai falar com você pelo WhatsApp sobre a nova compra.', auto: { motivo: 'contrato ativo' } };
  if (!(p.renda > 0)) return { status: 'CONTATADO', resposta: 'Recebemos seus dados. A loja vai falar com você pelo WhatsApp.', auto: { motivo: 'sem renda' } };
  // 3) capacidade: a parcela cabe em até X% da renda
  const parcelaMax = r2((p.renda * pct) / 100);
  const ap = (vit.aparelhos || []).find((a) => `${a.marca} ${a.modelo} ${a.capacidade}` === p.aparelho);
  const juros = Number(ap?.juros ?? vit.jurosPadrao ?? cfg.jurosFinanciamentoPct ?? 25);
  // total a prazo = preço × (1 + juros); parcelas = total − entrada → preço máximo = parcelas / (1 + juros − entrada%)
  let limite = r2((parcelaMax * n) / (1 + juros / 100 - entPct / 100));
  if (maxLim > 0) limite = Math.min(limite, maxLim);
  const quitou = hist.some((v) => v.status === 'QUITADA');
  if (ap) {
    const entMin = r2((ap.preco * entPct) / 100), ent = Math.max(p.entrada || 0, entMin);
    const parcela = r2((ap.preco * (1 + juros / 100) - ent) / n);
    if (parcela <= parcelaMax && (!maxLim || ap.preco <= maxLim))
      return { status: 'PRE_APROVADO', resposta: `Pré-aprovado! ${p.aparelho}: entrada de ${brl(ent)} + ${n}x de ${brl(parcela)}.${(p.entrada || 0) < entMin ? ` (A entrada mínima é ${brl(entMin)}.)` : ''}${quitou ? ' Obrigado por voltar!' : ''} Agende abaixo e traga RG ou CNH.`, auto: { parcela, entrada: ent, n, limite, parcelaMax } };
  }
  // o limite precisa comprar pelo menos o celular mais barato da vitrine
  const maisBarato = Math.min(...(vit.aparelhos || []).map((a) => +a.preco).filter((x) => x > 0), Infinity);
  if (limite >= minLim && limite >= (isFinite(maisBarato) ? maisBarato : 0)) return { status: 'PRE_APROVADO', resposta: `Pré-aprovado para celulares de até ${brl(limite)}${ap ? ` (o ${p.aparelho} passou do seu limite)` : ''}, com entrada a partir de ${entPct}% e parcelas de até ${brl(parcelaMax)}. Agende abaixo e escolha o aparelho na loja.`, auto: { limite, parcelaMax, n } };
  return { status: 'RECUSADA', resposta: 'Com a renda informada não conseguimos aprovar online agora. Se tiver uma entrada maior, passe na loja para conversar.', auto: { limite, parcelaMax } };
}

const erro = (msg, status = 400) => Object.assign(new Error(msg), { status });

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const b = req.body || {};
    if (b.acao === 'enviar') {
      const cpf = dig(b.cpf), tel = dig(b.telefone), nasc = String(b.nasc || '');
      if (!cpfOk(cpf)) throw erro('CPF inválido.');
      if (tel.length < 10 || tel.length > 13) throw erro('WhatsApp com DDD.');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(nasc)) throw erro('Data de nascimento inválida.');
      const idade = Math.floor((Date.now() - new Date(nasc)) / 31557600000);
      if (idade < 18 || idade > 110) throw erro('É preciso ter 18 anos ou mais.');
      if (b.aceiteLgpd !== true) throw erro('Marque a autorização para continuar.');
      const nome = txt(b.nome, 120); if (nome.length < 3) throw erro('Nome completo.');
      // trava contra robô/abuso: no máximo 3 envios do mesmo CPF por dia
      const ini = new Date(hoje() + 'T00:00:00-03:00').getTime();
      const doDia = (await db.collection('preanalises').where('cpf', '==', cpf).get()).docs.filter((d) => (d.data().criadoEm || 0) >= ini).length;
      if (doDia >= 3) throw erro('Você já enviou pré-análises hoje. Aguarde o contato da loja.', 429);
      const vit = (await db.collection('publico').doc('vitrine').get()).data() || {};
      const loja = (vit.lojas || []).find((l) => l.id === b.lojaId) || {};
      const dados = {
        nome, cpf, nasc, telefone: tel, cidade: txt(b.cidade, 60), renda: Math.max(0, Number(b.renda) || 0), profissao: txt(b.profissao, 60),
        aparelho: txt(b.aparelho, 120), entrada: Math.max(0, Number(b.entrada) || 0), lojaId: loja.id || '', lojaNome: loja.nome || '',
        aceiteLgpd: true, status: 'NOVA', criadoEm: Date.now(), via: 'servidor',
      };
      const cfg = await config();
      if (cfg.preAutomatica !== 'nao') {
        try { const d = await decidir(dados, vit, cfg); Object.assign(dados, { status: d.status, resposta: d.resposta, respondidoEm: Date.now(), respondidoPor: 'Análise automática', auto: d.auto, limite: d.status === 'PRE_APROVADO' ? (d.auto?.limite || 0) : 0 }); }
        catch (e) { console.error('decidir', e); }
      }
      const ref = await db.collection('preanalises').add(dados);
      return res.status(200).json({ id: ref.id, status: dados.status, resposta: dados.resposta || '', lojaNome: loja.nome || '', lojaTelefone: loja.telefone || '' });
    }
    if (b.acao === 'ver' || b.acao === 'agendar') {
      const id = String(b.id || '');
      if (!/^[A-Za-z0-9_-]{6,40}$/.test(id)) throw erro('Pré-análise não encontrada.', 404);
      const ref = db.collection('preanalises').doc(id), s = await ref.get();
      if (!s.exists) throw erro('Pré-análise não encontrada.', 404);
      const x = s.data();
      if (b.acao === 'agendar') {
        if (x.status !== 'PRE_APROVADO') throw erro('Só dá para agendar depois da pré-aprovação.');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.data)) || b.data < hoje() || !/^\d{2}:\d{2}$/.test(String(b.hora))) throw erro('Escolha o dia e o horário.');
        x.agendamento = { data: b.data, hora: b.hora, em: Date.now() };
        await ref.set({ agendamento: x.agendamento }, { merge: true });
      }
      return res.status(200).json({ id, nome: String(x.nome || '').split(' ')[0], aparelho: x.aparelho || '', lojaNome: x.lojaNome || '', status: x.status, resposta: x.resposta || '', criadoEm: x.criadoEm, agendamento: x.agendamento || null });
    }
    return res.status(400).json({ erro: 'ação desconhecida' });
  } catch (e) {
    console.error(e);
    return res.status(e.status || 500).json({ erro: e.status ? e.message : 'Não foi possível enviar agora. Tente de novo.' });
  }
}
