// Segurança e autoatendimento:
//  POST /api/codigo  {acao:'enviar'|'verificar', codigo}   — código por e-mail para entrar (Dono e Financeiro)
//  POST /api/acordo  {token, parcelas, obs}                  — o cliente pede um acordo do atraso pelo portal
//  backupRotina()                                            — cópia de segurança diária por e-mail (rotina da noite)
import { db, auth, cors, config, hoje, r2, pushAparelho } from './_base.js';
import { enviarEmail, brevoLigado, moldura } from './_brevo.js';

const erro = (m, s = 400) => Object.assign(new Error(m), { status: s });
const sha = async (t) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)))].map((b) => b.toString(16).padStart(2, '0')).join('');

/* ---------------- código de acesso por e-mail ---------------- */
export async function codigo(req, res) {
  if (cors(req, res)) return;
  try {
    if (req.method !== 'POST') throw erro('use POST', 405);
    const idt = String(req.headers.authorization || '').replace('Bearer ', '');
    const u = await auth.verifyIdToken(idt).catch(() => null);
    if (!u) throw erro('entre de novo', 401);
    const email = String(u.email || '').toLowerCase();
    const me = (await db.collection('users').doc(u.uid).get()).data() || {};
    const dono = email && email === String(process.env.DONO_EMAIL || '').toLowerCase();
    if (!dono && !['DONO', 'FINANCEIRO'].includes(me.role)) throw erro('sem permissão', 403);
    const ref = db.collection('segredos').doc('codigo_' + u.uid);
    const b = req.body || {};
    if (b.acao === 'enviar') {
      if (!brevoLigado()) throw erro('O envio de e-mail (Brevo) não está configurado no servidor.', 503);
      const ant = (await ref.get()).data() || {};
      if (ant.enviadoEm && Date.now() - ant.enviadoEm < 45000) throw erro('Aguarde 1 minuto para pedir outro código.', 429);
      const c = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
      await ref.set({ hash: await sha(u.uid + ':' + c), exp: Date.now() + 10 * 60000, tentativas: 0, enviadoEm: Date.now() });
      await enviarEmail({ para: email, assunto: `Seu código de acesso: ${c}`, titulo: 'Código de acesso',
        html: moldura('Código de acesso', `Use este código para entrar no NexumCell:\n\n${c}\n\nEle vale por 10 minutos.\n\nSe não foi você, troque a sua senha agora.`).replace(`>${c}</p>`, `><b style="font-size:26px;letter-spacing:4px">${c}</b></p>`),
        texto: `Seu código de acesso NexumCell: ${c} (vale por 10 minutos).` });
      return res.json({ ok: true, email: email.replace(/^(.{2}).*(@.*)$/, '$1***$2') });
    }
    if (b.acao === 'verificar') {
      const s = (await ref.get()).data();
      if (!s || s.exp < Date.now()) throw erro('Código vencido. Peça outro.', 410);
      if ((s.tentativas || 0) >= 5) throw erro('Muitas tentativas. Peça outro código.', 429);
      if (s.hash !== (await sha(u.uid + ':' + String(b.codigo || '').trim()))) {
        await ref.set({ tentativas: (s.tentativas || 0) + 1 }, { merge: true });
        throw erro('Código errado.', 403);
      }
      const ate = Date.now() + 12 * 3600e3;
      await ref.set({ hash: '', exp: 0, usadoEm: Date.now() }, { merge: true });
      await db.collection('users').doc(u.uid).set({ verificadoAte: ate, verificadoEm: Date.now() }, { merge: true });
      await db.collection('logs').add({ acao: 'Entrada confirmada com código por e-mail', alvo: u.uid, detalhe: email, por: me.nome || email, em: Date.now() });
      return res.json({ ok: true, ate });
    }
    throw erro('ação inválida');
  } catch (e) { res.status(e.status || 500).json({ erro: e.message }); }
}

/* ---------------- acordo do atraso pedido pelo cliente ---------------- */
export async function acordo(req, res) {
  if (cors(req, res)) return;
  try {
    if (req.method !== 'POST') throw erro('use POST', 405);
    const b = req.body || {}, tk = String(b.token || '');
    if (!/^[A-Za-z0-9_-]{10,60}$/.test(tk)) throw erro('contrato inválido');
    const cfg = await config();
    if (cfg.acordoCliente === 'nao') throw erro('Acordo pelo portal desligado. Fale com a loja.', 403);
    const ref = db.collection('aparelhos').doc(tk), snap = await ref.get();
    if (!snap.exists) throw erro('contrato não encontrado', 404);
    const ap = snap.data();
    if (ap.quitado || ['QUITADO', 'CANCELADO'].includes(ap.status)) throw erro('Contrato encerrado.');
    const h = hoje(), atraso = (ap.parcelas || []).filter((p) => !p.pago && p.venc < h);
    if (!atraso.length) throw erro('Não há parcelas em atraso.');
    if (ap.acordoPedidoEm && Date.now() - ap.acordoPedidoEm < 30 * 86400000) throw erro('Você já pediu um acordo este mês. A loja vai entrar em contato.', 409);
    const max = Math.min(12, Math.max(2, +cfg.acordoMaxParcelas || 4)), n = Math.round(+b.parcelas || 0);
    if (n < 1 || n > max) throw erro(`Escolha de 1 a ${max} parcelas.`);
    const valor = r2(atraso.reduce((s, p) => s + (+p.valor || 0), 0));
    const horas = Math.min(120, Math.max(0, +cfg.acordoLiberarHoras || 48)), agora = Date.now();
    const libera = cfg.acordoLiberar !== 'nao' && horas > 0 && !ap.roubo;
    await db.collection('pedidos').add({ tipo: 'ACORDO', token: tk, vendaId: ap.vendaId || '', vendaNumero: ap.vendaNumero || 0, lojaId: ap.lojaId || '', lojaNome: ap.lojaNome || '',
      clienteNome: ap.clienteNome || '', marca: ap.marca || '', modelo: ap.modelo || '', imei: ap.imei || '', status: 'ABERTO', criadoEm: agora,
      descricao: `Quer acertar ${atraso.length} parcela(s) em atraso (R$ ${valor.toFixed(2).replace('.', ',')}) em ${n}x.${b.obs ? ' Obs.: ' + String(b.obs).slice(0, 300) : ''}`,
      acordo: { parcelas: n, valorAtraso: valor, qtdAtraso: atraso.length, liberadoAte: libera ? agora + horas * 3600e3 : 0 } });
    await ref.set({ acordoPedidoEm: agora, ...(libera ? { liberadoAte: agora + horas * 3600e3, modoPor: 'Pedido de acordo pelo portal', modoMotivo: `Liberado ${horas} h enquanto a loja formaliza o acordo` } : {}) }, { merge: true });
    if (libera) await pushAparelho(tk).catch(() => {});
    res.json({ ok: true, liberadoAte: libera ? agora + horas * 3600e3 : 0, horas: libera ? horas : 0 });
  } catch (e) { res.status(e.status || 500).json({ erro: e.message }); }
}

/* ---------------- cópia de segurança diária por e-mail ---------------- */
const COLECOES = ['config', 'users', 'lojas', 'empresas', 'clientes', 'vendas', 'aparelhos', 'catalogo', 'estoque', 'listanegra', 'metas', 'cobrancas', 'caixas', 'pedidos', 'seminovos', 'chamados', 'despesas', 'comissoesPagas', 'retornos', 'atendimentos', 'ajuda'];
const semFotos = (o) => JSON.parse(JSON.stringify(o, (k, v) => (typeof v === 'string' && v.startsWith('data:') && v.length > 2000 ? '[foto]' : v)));

export async function backupRotina(cfg) {
  if (cfg.backupAuto === 'nao' || !brevoLigado()) return { backup: 'desligado' };
  const dados = { geradoEm: new Date().toISOString(), colecoes: {} };
  for (const c of COLECOES) {
    try { dados.colecoes[c] = (await db.collection(c).get()).docs.map((d) => semFotos({ id: d.id, ...d.data() })); } catch (e) { dados.colecoes[c] = { erro: e.message }; }
  }
  const bruto = new TextEncoder().encode(JSON.stringify(dados));
  const gz = new Uint8Array(await new Response(new Blob([bruto]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
  if (gz.length > 7 * 1024 * 1024) return { backup: 'grande demais para e-mail (' + Math.round(gz.length / 1048576) + ' MB): use Configurações → Baixar cópia' };
  let bin = ''; for (let i = 0; i < gz.length; i += 0x8000) bin += String.fromCharCode(...gz.subarray(i, i + 0x8000));
  const para = [process.env.DONO_EMAIL, ...String(cfg.backupEmail || '').split(/[,; ]+/)].map((x) => String(x || '').trim()).filter((x) => /@/.test(x));
  const total = Object.values(dados.colecoes).reduce((s, l) => s + (Array.isArray(l) ? l.length : 0), 0);
  await enviarEmail({ para: [...new Set(para)], assunto: `Cópia de segurança NexumCell ${hoje()}`, titulo: 'Cópia de segurança diária',
    texto: `Segue em anexo a cópia dos dados do sistema (${total} registros, sem as fotos).\n\nGuarde este e-mail. Para restaurar, fale com o suporte do sistema.`,
    anexos: [{ name: `nexumcell-backup-${hoje()}.json.gz`, content: btoa(bin) }] });
  return { backup: total + ' registros' };
}
