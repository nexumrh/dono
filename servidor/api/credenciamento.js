// Cadastro de lojas parceiras (site de vendas e link ?credenciamento do Portal do Gerente).
// A empresa escolhe o plano e cadastra a matriz e as filiais, cada uma com o seu gerente.
// O servidor grava em solicitacoesLoja e avisa o Dono. Só o Dono aprova e cria o login de cada gerente.
// POST /api/credenciamento
//   {"acao":"planos"}                                  → planos e preços do site
//   {"acao":"enviar", empresa:{...}, plano, lojas:[{..., gerente:{...}}], aceite:true}
//   {"acao":"ver", cnpj, email}                         → situação do cadastro (só com o e-mail do responsável)
//   {"acao":"filial", cnpj, email, loja:{..., gerente:{...}}} → nova filial de empresa já parceira
import { db, cors, hoje, config } from './_base.js';
import { enviarEmail, brevoLigado } from './_brevo.js';

const dig = (s) => String(s || '').replace(/\D/g, '');
const txt = (s, n) => String(s ?? '').replace(/[<>]/g, '').trim().slice(0, n);
const erro = (msg, status = 400) => Object.assign(new Error(msg), { status });
const emailOk = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
export function cnpjOk(c) {
  c = dig(c); if (c.length !== 14 || /^(\d)\1+$/.test(c)) return false;
  const calc = (n) => { const w = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]; const s = w.reduce((a, x, i) => a + x * +c[i], 0) % 11; return s < 2 ? 0 : 11 - s; };
  return calc(12) === +c[12] && calc(13) === +c[13];
}
export function cpfOk(c) {
  c = dig(c); if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false;
  for (const t of [9, 10]) { let s = 0; for (let i = 0; i < t; i++) s += +c[i] * (t + 1 - i); if ((s * 10) % 11 % 10 !== +c[t]) return false; }
  return true;
}
export const PLANOS_PADRAO = [
  { id: 'START', nome: 'Start', porLoja: 199, destaque: false, itens: ['Crediário com trava do aparelho', 'Análise de crédito pela NexumCell', 'Cobrança automática por PIX', 'Até 3 vendedores por loja'] },
  { id: 'PRO', nome: 'Pro', porLoja: 349, destaque: true, itens: ['Tudo do Start', 'Vendedores ilimitados', 'Comissões com comprovante', 'Painel da TV e metas', 'Suporte prioritário no chat'] },
  { id: 'REDE', nome: 'Rede', porLoja: 299, minimoLojas: 3, destaque: false, itens: ['Tudo do Pro', 'A partir de 3 lojas', 'Relatórios da rede', 'Gerente de conta'] },
];
export async function planos() {
  const c = await config().catch(() => ({}));
  const l = Array.isArray(c.planosLojas) && c.planosLojas.length ? c.planosLojas : PLANOS_PADRAO;
  return { planos: l, adesao: Number(c.saasAdesao) || 0, diasTeste: Number(c.saasDiasTeste ?? 7) || 0, empresa: c.empresa || 'NexumCell' };
}
function lojaLimpa(l, i) {
  const g = l.gerente || {}, n = i + 1;
  const loja = { nome: txt(l.nome, 80), cnpj: dig(l.cnpj), telefone: dig(l.telefone), cep: dig(l.cep).slice(0, 8), endereco: txt(l.endereco, 200), cidade: txt(l.cidade, 60), uf: txt(l.uf, 2).toUpperCase(),
    gerente: { nome: txt(g.nome, 120), cpf: dig(g.cpf), email: txt(g.email, 120).toLowerCase(), telefone: dig(g.telefone) }, status: 'PENDENTE' };
  if (loja.nome.length < 2 || loja.cidade.length < 2) throw erro(`Loja ${n}: informe o nome e a cidade.`);
  if (loja.cnpj && !cnpjOk(loja.cnpj)) throw erro(`Loja ${n}: CNPJ da filial inválido.`);
  if (loja.telefone.length < 10 || loja.telefone.length > 11) throw erro(`Loja ${n}: telefone com DDD.`);
  if (loja.gerente.nome.split(' ').length < 2) throw erro(`Loja ${n}: nome completo do gerente.`);
  if (!cpfOk(loja.gerente.cpf)) throw erro(`Loja ${n}: CPF do gerente inválido.`);
  if (!emailOk(loja.gerente.email)) throw erro(`Loja ${n}: e-mail do gerente inválido.`);
  if (loja.gerente.telefone.length < 10 || loja.gerente.telefone.length > 11) throw erro(`Loja ${n}: WhatsApp do gerente com DDD.`);
  return loja;
}
async function avisarDono(assunto, texto) {
  if (!brevoLigado() || !process.env.DONO_EMAIL) return;
  try { await enviarEmail({ para: process.env.DONO_EMAIL, assunto, titulo: assunto, texto }); } catch (e) { console.error('aviso dono', e.message); }
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const b = req.body || {};
    if (b.acao === 'planos') return res.status(200).json(await planos());

    if (b.acao === 'enviar') {
      // compatível com o formulário antigo (uma loja, responsável = gerente)
      const e = b.empresa || { razao: b.razao, fantasia: b.fantasia, cnpj: b.cnpj, telefone: b.telefone, cidade: b.cidade, uf: b.uf, endereco: b.endereco, cep: b.cep,
        respNome: b.respNome, respCpf: b.respCpf, respEmail: b.respEmail, respTelefone: b.respTelefone };
      const lojasIn = Array.isArray(b.lojas) && b.lojas.length ? b.lojas : [{ nome: e.fantasia, telefone: e.telefone, cep: e.cep, endereco: e.endereco, cidade: e.cidade, uf: e.uf,
        gerente: { nome: e.respNome, cpf: e.respCpf, email: e.respEmail, telefone: e.respTelefone } }];
      const cnpj = dig(e.cnpj), email = txt(e.respEmail, 120).toLowerCase();
      if (!cnpjOk(cnpj)) throw erro('CNPJ da empresa inválido.');
      if (!cpfOk(e.respCpf)) throw erro('CPF do responsável inválido.');
      if (!emailOk(email)) throw erro('E-mail do responsável inválido.');
      const empresa = { cnpj, razao: txt(e.razao, 140), fantasia: txt(e.fantasia, 80), telefone: dig(e.telefone), cidade: txt(e.cidade, 60), uf: txt(e.uf, 2).toUpperCase(),
        respNome: txt(e.respNome, 120), respCpf: dig(e.respCpf), respEmail: email, respTelefone: dig(e.respTelefone) };
      { const s0 = await db.collection('solicitacoesLoja').doc('cnpj_' + cnpj).get();
        if (s0.exists && ['PENDENTE', 'APROVADA'].includes(s0.data().status)) throw erro(s0.data().status === 'APROVADA' ? 'Esta empresa já é parceira. Para abrir uma filial, use “Adicionar filial”.' : 'Já recebemos o cadastro desta empresa. Acompanhe pelo site em “Acompanhar meu cadastro”.', 409); }
      if (empresa.razao.length < 3 || empresa.fantasia.length < 2 || empresa.respNome.split(' ').length < 2) throw erro('Preencha razão social, nome fantasia e o nome completo do responsável.');
      if (lojasIn.length > 30) throw erro('No máximo 30 lojas por cadastro. Fale com a NexumCell para redes maiores.');
      const lojas = lojasIn.map(lojaLimpa);
      const emails = lojas.map((l) => l.gerente.email); if (new Set(emails).size !== emails.length) throw erro('Cada loja precisa de um gerente com e-mail diferente.');
      if (b.aceite !== true) throw erro('Aceite os termos para continuar.');
      const P = await planos(), plano = P.planos.find((p) => p.id === b.plano) || P.planos[0];
      if (plano.minimoLojas && lojas.length < plano.minimoLojas) throw erro(`O plano ${plano.nome} é a partir de ${plano.minimoLojas} lojas.`);
      const ref = db.collection('solicitacoesLoja').doc('cnpj_' + cnpj), s = await ref.get();
      if (s.exists && ['PENDENTE', 'APROVADA'].includes(s.data().status)) throw erro(s.data().status === 'APROVADA' ? 'Esta empresa já é parceira. Para abrir uma filial, use “Adicionar filial”.' : 'Já recebemos o cadastro desta empresa. Acompanhe pelo site em “Acompanhar meu cadastro”.', 409);
      const dados = { tipo: 'EMPRESA', ...empresa, fantasia: empresa.fantasia, plano: plano.id, planoNome: plano.nome, porLoja: Number(plano.porLoja) || 0,
        mensalidade: Math.round((Number(plano.porLoja) || 0) * lojas.length * 100) / 100, lojas, obs: txt(b.obs, 500), aceite: true, status: 'PENDENTE', criadoEm: Date.now(), dia: hoje(), via: b.via === 'site' ? 'site' : 'link' };
      await ref.set(dados);
      await avisarDono('Nova empresa pedindo cadastro — ' + empresa.fantasia,
        `${empresa.fantasia} (${empresa.razao}) · CNPJ ${cnpj}\nPlano ${plano.nome} · ${lojas.length} loja(s)\n${lojas.map((l) => `• ${l.nome} (${l.cidade}) — gerente ${l.gerente.nome}`).join('\n')}\n\nAprove no Painel do Dono → Lojas parceiras.`);
      return res.status(200).json({ id: ref.id, status: 'PENDENTE', mensalidade: dados.mensalidade });
    }

    if (b.acao === 'ver' || b.acao === 'filial') {
      const cnpj = dig(b.cnpj), email = txt(b.email, 120).toLowerCase();
      const s = await db.collection('solicitacoesLoja').doc('cnpj_' + cnpj).get();
      if (!s.exists || s.data().respEmail !== email) throw erro('Não encontramos cadastro com esse CNPJ e e-mail do responsável.', 404);
      const x = s.data();
      if (b.acao === 'ver') {
        const fil = (await db.collection('solicitacoesLoja').where('cnpj', '==', cnpj).get()).docs.map((d) => d.data()).filter((f) => f.tipo === 'FILIAL');
        const unidades = [...(x.lojas || []), ...fil.flatMap((f) => (f.lojas || []).map((l) => ({ ...l, status: l.status === 'PENDENTE' && f.status !== 'PENDENTE' ? f.status : l.status })))]
          .map((l) => ({ nome: l.nome, cidade: l.cidade, gerente: l.gerente?.nome || '', status: l.status || x.status }));
        return res.status(200).json({ fantasia: x.fantasia, status: x.status, plano: x.planoNome || '', resposta: x.resposta || '', criadoEm: x.criadoEm, unidades });
      }
      if (x.status !== 'APROVADA') throw erro('A empresa ainda não foi aprovada. Depois da aprovação você pode adicionar filiais.');
      const loja = lojaLimpa(b.loja || {}, 0);
      const id = 'f_' + cnpj + '_' + Date.now();
      await db.collection('solicitacoesLoja').doc(id).set({ tipo: 'FILIAL', cnpj, empresaId: x.empresaId || ('e_' + cnpj), fantasia: x.fantasia, razao: x.razao, respNome: x.respNome, respEmail: x.respEmail,
        plano: x.plano, porLoja: x.porLoja || 0, lojas: [loja], status: 'PENDENTE', criadoEm: Date.now(), dia: hoje(), via: 'site' });
      await avisarDono('Nova filial para aprovar — ' + x.fantasia, `${x.fantasia}: ${loja.nome} (${loja.cidade}) — gerente ${loja.gerente.nome} (${loja.gerente.email}).\n\nAprove no Painel do Dono → Lojas parceiras.`);
      return res.status(200).json({ id, status: 'PENDENTE' });
    }
    return res.status(400).json({ erro: 'ação desconhecida' });
  } catch (e) {
    console.error(e);
    return res.status(e.status || 500).json({ erro: e.status ? e.message : 'Não foi possível enviar agora. Tente de novo.' });
  }
}
