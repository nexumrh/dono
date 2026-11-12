// Cadastro de lojas parceiras (site de vendas e link ?credenciamento do Portal do Gerente).
// A empresa escolhe o plano e cadastra a matriz e as filiais, cada uma com o seu gerente.
// O servidor grava em solicitacoesLoja e avisa o Dono. Só o Dono aprova e cria o login de cada gerente.
// POST /api/credenciamento
//   {"acao":"planos"}                                  → planos e preços do site
//   {"acao":"cnpj", cnpj}                             → consulta o CNPJ na Receita Federal (BrasilAPI)
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

export const MARCAS_LOJA = ['Samsung', 'Motorola', 'Xiaomi', 'Redmi', 'POCO', 'Realme', 'Tecno', 'Honor', 'Infinix', 'Outras Android'];
export const FOTOS_LOJA = ['fachada', 'entrada', 'interior', 'atendimento', 'mesas', 'ambiente'];
const BANCO_TIPOS = ['CORRENTE', 'PAGAMENTO', 'POUPANCA'];
/** Situação do CNPJ na Receita Federal (BrasilAPI, dados públicos). null = não deu para consultar agora. */
export async function consultarCnpj(cnpj) {
  try {
    const r = await fetch('https://brasilapi.com.br/api/cnpj/v1/' + dig(cnpj), { headers: { accept: 'application/json' } });
    if (r.status === 404) return { encontrado: false };
    if (!r.ok) return null;
    const j = await r.json();
    return { encontrado: true, situacao: String(j.descricao_situacao_cadastral || '').toUpperCase(), razao: j.razao_social || '', fantasia: j.nome_fantasia || '',
      abertura: j.data_inicio_atividade || '', cep: dig(j.cep), uf: j.uf || '', cidade: j.municipio || '', bairro: j.bairro || '',
      rua: [j.descricao_tipo_de_logradouro, j.logradouro].filter(Boolean).join(' '), numero: j.numero || '', complemento: j.complemento || '', atividade: j.cnae_fiscal_descricao || '', em: Date.now() };
  } catch (e) { return null; }
}
function enderecoLimpo(a, ond) {
  const e = { cep: dig(a.cep).slice(0, 8), uf: txt(a.uf, 2).toUpperCase(), cidade: txt(a.cidade, 60), bairro: txt(a.bairro, 80), rua: txt(a.rua, 120), numero: txt(a.numero, 12), complemento: txt(a.complemento, 60) };
  if (e.cep.length !== 8) throw erro(`${ond}: CEP com 8 números.`);
  if (e.uf.length !== 2 || e.cidade.length < 2 || e.bairro.length < 2 || e.rua.length < 3 || !e.numero) throw erro(`${ond}: preencha o endereço completo (rua, número, bairro, cidade e UF).`);
  return e;
}
const endTexto = (e) => [e.rua && `${e.rua}, ${e.numero}`, e.complemento, e.bairro].filter(Boolean).join(' · ');
function pessoaLimpa(g, ond, comCargo) {
  const o = { nome: txt(g.nome, 120), cpf: dig(g.cpf), email: txt(g.email, 120).toLowerCase(), telefone: dig(g.telefone), ...(comCargo ? { cargo: txt(g.cargo, 60) || 'Gerente' } : {}) };
  if (o.nome.split(' ').filter(Boolean).length < 2) throw erro(`${ond}: nome completo.`);
  if (!cpfOk(o.cpf)) throw erro(`${ond}: CPF inválido.`);
  if (!emailOk(o.email)) throw erro(`${ond}: e-mail inválido.`);
  if (o.telefone.length < 10 || o.telefone.length > 11) throw erro(`${ond}: telefone com DDD.`);
  return o;
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
function lojaLimpa(l, i, filial) {
  const n = i + 1, ond = filial || i > 0 ? `Filial ${filial ? '' : i}`.trim() : 'Matriz';
  const end = l.rua || l.bairro ? enderecoLimpo(l, ond) : null;   // formulário antigo: só endereço em uma linha
  const loja = { tipo: filial || i > 0 ? 'FILIAL' : 'MATRIZ', nome: txt(l.nome, 80), cnpj: dig(l.cnpj), telefone: dig(l.telefone),
    ...(end ? { ...end, endereco: endTexto(end) } : { cep: dig(l.cep).slice(0, 8), endereco: txt(l.endereco, 200), cidade: txt(l.cidade, 60), uf: txt(l.uf, 2).toUpperCase() }),
    gerente: pessoaLimpa(l.gerente || {}, `${ond} — gerente`, true), status: 'PENDENTE' };
  if (loja.nome.length < 2 || loja.cidade.length < 2) throw erro(`${ond}: informe o nome de identificação da loja e a cidade.`);
  if (loja.cnpj && !cnpjOk(loja.cnpj)) throw erro(`${ond}: CNPJ da loja inválido.`);
  if (loja.telefone.length < 10 || loja.telefone.length > 11) throw erro(`${ond}: telefone com DDD.`);
  if (l.geo) { const lat = +l.geo.lat, lng = +l.geo.lng;
    if (!(lat >= -34 && lat <= 6 && lng >= -74 && lng <= -32)) throw erro(`${ond}: a localização (GPS) não está no Brasil. Marque de novo.`);
    loja.geo = { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6, via: l.geo.via === 'GPS' ? 'GPS' : 'MAPA', precisao: Math.round(+l.geo.precisao || 0) }; }
  if (Array.isArray(l.marcas)) {   // iPhone/Apple não entra aqui: só a NexumCell libera, loja por loja
    loja.marcas = [...new Set(l.marcas.map(String))].filter((m) => MARCAS_LOJA.includes(m));
    if (!loja.marcas.length) throw erro(`${ond}: marque as marcas de celular que a loja vende.`);
  }
  if (l.vendedoresAgora === true) {
    const vs = (Array.isArray(l.vendedores) ? l.vendedores : []).slice(0, 30);
    if (!vs.length) throw erro(`${ond}: adicione os vendedores ou marque “Não” em cadastrar vendedores agora.`);
    loja.vendedores = vs.map((v, j) => ({ ...pessoaLimpa(v, `${ond} — vendedor ${j + 1}`), status: 'PENDENTE' }));
  }
  return loja;
}
function bancoLimpo(b, empresa) {
  const o = { banco: txt(b.banco, 80), agencia: dig(b.agencia).slice(0, 6), conta: txt(b.conta, 20).replace(/[^0-9Xx-]/g, ''), tipoConta: BANCO_TIPOS.includes(b.tipoConta) ? b.tipoConta : 'CORRENTE',
    titular: empresa.razao, titularCnpj: empresa.cnpj, pixTipo: 'CNPJ', pixChave: dig(b.pixChave) };
  if (o.banco.length < 2 || o.agencia.length < 3 || o.conta.replace(/\D/g, '').length < 3) throw erro('Dados bancários: banco, agência e conta.');
  if (dig(b.titularCnpj || empresa.cnpj) !== empresa.cnpj) throw erro('A conta precisa estar no CNPJ da empresa cadastrada.');
  // REGRA: repasse só para chave PIX do CNPJ da empresa (nada de CPF ou terceiros)
  if (o.pixChave !== empresa.cnpj) throw erro('A chave PIX do repasse precisa ser o CNPJ da empresa (' + empresa.cnpj + '). Chaves de CPF, e-mail, telefone ou de terceiros não são aceitas.');
  return { ...o, validado: false };
}
/** Fotos da loja: guardadas uma por documento (fora do cadastro), só o Dono vê. */
async function gravarFotos(solId, lojas, fotosIn, exigir) {
  for (const [i, l] of lojas.entries()) {
    const f = (fotosIn || [])[i] || {}, cont = {};
    for (const t of FOTOS_LOJA) {
      const lista = (Array.isArray(f[t]) ? f[t] : []).slice(0, 3).filter((x) => typeof x === 'string' && /^data:image\/(jpeg|webp|png);base64,/.test(x));
      for (const x of lista) if (x.length > 700000) throw erro(`${l.nome}: uma foto ficou grande demais. Envie de novo.`);
      if (exigir && !lista.length) throw erro(`${l.nome}: falta a foto “${t}”.`);
      cont[t] = lista.length;
      for (const [j, x] of lista.entries()) await db.collection('lojaFotos').doc(`${solId}_${i}_${t}_${j}`).set({ solicitacaoId: solId, loja: i, tipo: t, n: j, foto: x, criadoEm: Date.now() });
    }
    l.fotos = cont;
  }
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
    if (b.acao === 'cnpj') {
      if (!cnpjOk(b.cnpj)) throw erro('CNPJ inválido.');
      const r = await consultarCnpj(b.cnpj);
      if (!r) return res.status(200).json({ indisponivel: true });
      return res.status(200).json(r);
    }

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
      const end = e.rua || e.bairro ? enderecoLimpo(e, 'Endereço da empresa') : null;
      const empresa = { cnpj, razao: txt(e.razao, 140), fantasia: txt(e.fantasia, 80), telefone: dig(e.telefone), emailCorp: txt(e.emailCorp, 120).toLowerCase(),
        ...(end ? { ...end, endereco: endTexto(end) } : { cidade: txt(e.cidade, 60), uf: txt(e.uf, 2).toUpperCase() }),
        respNome: txt(e.respNome, 120), respCpf: dig(e.respCpf), respEmail: email, respTelefone: dig(e.respTelefone) };
      if (empresa.emailCorp && !emailOk(empresa.emailCorp)) throw erro('E-mail corporativo inválido.');
      { const s0 = await db.collection('solicitacoesLoja').doc('cnpj_' + cnpj).get();
        if (s0.exists && ['PENDENTE', 'EM_ANALISE', 'APROVADA'].includes(s0.data().status)) throw erro(s0.data().status === 'APROVADA' ? 'Esta empresa já é parceira. Para abrir uma filial, use “Adicionar filial”.' : 'Já recebemos o cadastro desta empresa. Acompanhe pelo site em “Acompanhar meu cadastro”.', 409); }
      // CNPJ precisa estar ATIVO na Receita Federal
      const receita = await consultarCnpj(cnpj);
      if (receita && receita.encontrado === false) throw erro('CNPJ não encontrado na Receita Federal.');
      if (receita?.situacao && receita.situacao !== 'ATIVA') throw erro(`O CNPJ está ${receita.situacao.toLowerCase()} na Receita Federal. Só aceitamos empresas com CNPJ ativo.`);
      if (empresa.razao.length < 3 || empresa.fantasia.length < 2 || empresa.respNome.split(' ').length < 2) throw erro('Preencha razão social, nome fantasia e o nome completo do responsável.');
      if (lojasIn.length > 30) throw erro('No máximo 30 lojas por cadastro. Fale com a NexumCell para redes maiores.');
      const lojas = lojasIn.map((l, i) => lojaLimpa(l, i, false));
      const emails = lojas.map((l) => l.gerente.email); if (new Set(emails).size !== emails.length) throw erro('Cada loja precisa de um gerente com e-mail diferente.');
      { const todos = [...emails, ...lojas.flatMap((l) => (l.vendedores || []).map((v) => v.email))]; if (new Set(todos).size !== todos.length) throw erro('Gerentes e vendedores precisam de e-mails diferentes (cada e-mail vira um login).'); }
      const novo = !!b.banco;   // formulário novo (com dados bancários e fotos)
      const banco = novo ? bancoLimpo(b.banco, empresa) : null;
      if (novo && b.lgpd !== true) throw erro('Aceite o tratamento de dados (LGPD) para continuar.');
      if (b.aceite !== true) throw erro('Aceite os termos para continuar.');
      const P = await planos(), plano = P.planos.find((p) => p.id === b.plano) || P.planos[0];
      if (plano.minimoLojas && lojas.length < plano.minimoLojas) throw erro(`O plano ${plano.nome} é a partir de ${plano.minimoLojas} lojas.`);
      const ref = db.collection('solicitacoesLoja').doc('cnpj_' + cnpj), s = await ref.get();
      if (s.exists && ['PENDENTE', 'EM_ANALISE', 'APROVADA'].includes(s.data().status)) throw erro(s.data().status === 'APROVADA' ? 'Esta empresa já é parceira. Para abrir uma filial, use “Adicionar filial”.' : 'Já recebemos o cadastro desta empresa. Acompanhe pelo site em “Acompanhar meu cadastro”.', 409);
      const dados = { tipo: 'EMPRESA', ...empresa, fantasia: empresa.fantasia, plano: plano.id, planoNome: plano.nome, porLoja: Number(plano.porLoja) || 0,
        mensalidade: Math.round((Number(plano.porLoja) || 0) * lojas.length * 100) / 100, lojas, obs: txt(b.obs, 500), aceite: true, status: 'PENDENTE', criadoEm: Date.now(), dia: hoje(), via: b.via === 'site' ? 'site' : 'link',
        ...(banco ? { banco } : {}), receita: receita || { indisponivel: true, em: Date.now() }, ...(novo ? { lgpdEm: Date.now(), ip: req.headers['cf-connecting-ip'] || '' } : {}),
        historico: [{ em: Date.now(), status: 'PENDENTE', por: 'Site', obs: 'Cadastro enviado' }] };
      if (novo) await gravarFotos(ref.id, lojas, b.fotos, true);
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
        return res.status(200).json({ fantasia: x.fantasia, status: x.status, plano: x.planoNome || '', resposta: x.resposta || '', criadoEm: x.criadoEm, unidades, historico: (x.historico || []).map((h) => ({ em: h.em, status: h.status, obs: h.obs || '' })) });
      }
      if (x.status !== 'APROVADA') throw erro('A empresa ainda não foi aprovada. Depois da aprovação você pode adicionar filiais.');
      const loja = lojaLimpa(b.loja || {}, 0, true);
      if (!loja.cnpj) throw erro('Informe o CNPJ da filial.');
      if (loja.cnpj.slice(0, 8) !== cnpj.slice(0, 8)) throw erro('O CNPJ da filial precisa ser da mesma empresa (mesma raiz do CNPJ da matriz).');
      const id = 'f_' + cnpj + '_' + Date.now();
      if (b.fotos) await gravarFotos(id, [loja], [b.fotos], true);
      await db.collection('solicitacoesLoja').doc(id).set({ tipo: 'FILIAL', cnpj, empresaId: x.empresaId || ('e_' + cnpj), fantasia: x.fantasia, razao: x.razao, respNome: x.respNome, respEmail: x.respEmail,
        plano: x.plano, porLoja: x.porLoja || 0, lojas: [loja], status: 'PENDENTE', criadoEm: Date.now(), dia: hoje(), via: 'site', historico: [{ em: Date.now(), status: 'PENDENTE', por: 'Site', obs: 'Nova filial' }] });
      await avisarDono('Nova filial para aprovar — ' + x.fantasia, `${x.fantasia}: ${loja.nome} (${loja.cidade}) — gerente ${loja.gerente.nome} (${loja.gerente.email}).\n\nAprove no Painel do Dono → Lojas parceiras.`);
      return res.status(200).json({ id, status: 'PENDENTE' });
    }
    return res.status(400).json({ erro: 'ação desconhecida' });
  } catch (e) {
    console.error(e);
    return res.status(e.status || 500).json({ erro: e.status ? e.message : 'Não foi possível enviar agora. Tente de novo.' });
  }
}
