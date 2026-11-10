// E-mails e mensagens pelo Brevo, pedidos pelos portais da equipe (exige login: Authorization: Bearer <idToken>)
// POST /api/avisos {"acao":"status"}                                   → o que está configurado no servidor
// POST /api/avisos {"acao":"email","para":"x@y","assunto":"..","texto":".."[,"anexo":{"nome":"a.csv","base64":".."}]}
// POST /api/avisos {"acao":"cliente","vendaId":"..","tipo":"lembrete|atraso|livre","texto":".."} → WhatsApp/SMS ao cliente
// POST /api/avisos {"acao":"teste","telefone":"45999990000"}           → e-mail de teste ao dono (+ SMS/WhatsApp de teste)
// POST /api/avisos {"acao":"rotina","qual":"manha|noite"}               → roda agora a rotina automática (só o Dono)
import { db, cors, exigirEquipe, hoje, config, asaasConf, asaas } from './_base.js';
import { brevoLigado, enviarEmail, avisarCliente, enviarSms, enviarWhatsapp, MODELOS } from './_brevo.js';
import { rotinas, dadosAviso } from './cron.js';
import { relatorioSemanal } from './relatorio-semanal.js';

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const b = req.body || {}, E = process.env;
    if (b.acao === 'relSemanal') { await exigirEquipe(req, ['DONO']); return res.status(200).json(await relatorioSemanal(await config(), true)); }
    if (b.acao === 'status') {
      await exigirEquipe(req);
      const ac = await asaasConf();
      return res.status(200).json({
        brevo: brevoLigado(), email: !!(E.BREVO_API_KEY && E.BREVO_REMETENTE), sms: !!E.BREVO_API_KEY, whatsapp: !!(E.BREVO_API_KEY && E.BREVO_WHATSAPP_NUMERO),
        modelos: Object.fromEntries(Object.keys(MODELOS).map((k) => [k, !!MODELOS[k]()])),
        asaas: !!ac.chave, asaasSandbox: ac.ambiente === 'sandbox', asaasOrigem: ac.origem, asaasWebhook: !!ac.webhookToken, notaFiscal: !!E.FOCUS_NFE_TOKEN, zapsign: !!E.ZAPSIGN_TOKEN, ia: !!E.GROQ_API_KEY,
        plataforma: globalThis.navigator?.userAgent === 'Cloudflare-Workers' ? 'Cloudflare' : 'Vercel',
      });
    }
    if (b.acao === 'testarAsaas') {
      await exigirEquipe(req, ['DONO']);
      const ac = await asaasConf();
      if (!ac.chave) return res.status(200).json({ ok: false, erro: 'nenhuma chave do Asaas configurada' });
      try { const c = await asaas('/myAccount/commercialInfo'); return res.status(200).json({ ok: true, ambiente: ac.ambiente, conta: c.name || c.companyName || c.email || '' }); }
      catch (e) { return res.status(200).json({ ok: false, ambiente: ac.ambiente, erro: e.message }); }
    }
    if (b.acao === 'email') {
      const quem = await exigirEquipe(req, ['DONO', 'FINANCEIRO', 'GERENTE', 'SUPORTE']);
      const para = String(b.para || '').trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(para)) throw Object.assign(new Error('e-mail inválido'), { status: 400 });
      const anexos = b.anexo?.base64 ? [{ name: String(b.anexo.nome || 'arquivo.csv').slice(0, 80), content: String(b.anexo.base64) }] : undefined;
      await enviarEmail({ para, assunto: b.assunto || 'NexumCell', titulo: b.titulo || b.assunto, texto: String(b.texto || '').slice(0, 20000), anexos });
      await db.collection('logs').add({ em: Date.now(), acao: 'E-mail enviado (Brevo)', alvo: para, det: String(b.assunto || '').slice(0, 120), por: quem.nome });
      return res.status(200).json({ ok: true });
    }
    if (b.acao === 'cliente') {
      const quem = await exigirEquipe(req);
      const s = await db.collection('vendas').doc(String(b.vendaId)).get();
      if (!s.exists) throw Object.assign(new Error('venda não encontrada'), { status: 404 });
      const v = s.data(), cfg = await config();
      if (quem.role === 'VENDEDOR' && v.vendedorUid !== quem.uid) throw Object.assign(new Error('sem permissão'), { status: 403 });
      const d = dadosAviso(v, cfg, b.tipo === 'atraso' ? 'atraso' : 'lembrete');
      if (b.tipo === 'livre') d.texto = String(b.texto || '').slice(0, 600);
      if (!d.tel) throw new Error('cliente sem telefone');
      const canal = b.canal || cfg.brevoCanal || 'whatsapp_ou_sms';
      const r = b.tipo === 'livre' ? { sms: await enviarSms(d.tel, d.texto).then(() => 'ok', (e) => e.message) } : await avisarCliente(d.tel, canal, d);
      await db.collection('logs').add({ em: Date.now(), acao: 'Mensagem ao cliente (Brevo)', alvo: b.vendaId, det: JSON.stringify(r).slice(0, 200), por: quem.nome });
      return res.status(200).json(r);
    }
    if (b.acao === 'teste') {
      await exigirEquipe(req, ['DONO']);
      const r = {};
      try { await enviarEmail({ para: E.DONO_EMAIL, assunto: 'Teste do Brevo — NexumCell', texto: 'Se você recebeu este e-mail, o Brevo está ligado no servidor da NexumCell.\n\nData: ' + hoje() }); r.email = 'ok'; } catch (e) { r.email = e.message; }
      if (b.telefone) {
        try { await enviarSms(b.telefone, 'NexumCell: teste de SMS pelo Brevo. Tudo certo!'); r.sms = 'ok'; } catch (e) { r.sms = e.message; }
        if (MODELOS.lembrete()) { try { await enviarWhatsapp(b.telefone, { templateId: MODELOS.lembrete(), params: { NOME: 'Teste', VALOR: 'R$ 1,00', VENCIMENTO: hoje().split('-').reverse().join('/'), LINK: 'nexumcell' } }); r.whatsapp = 'ok'; } catch (e) { r.whatsapp = e.message; } }
        else r.whatsapp = 'modelo de lembrete não configurado';
      }
      return res.status(200).json(r);
    }
    if (b.acao === 'rotina') {
      await exigirEquipe(req, ['DONO']);
      return res.status(200).json(await rotinas(b.qual === 'noite' ? 'noite' : 'manha'));
    }
    return res.status(400).json({ erro: 'ação desconhecida' });
  } catch (e) {
    console.error(e);
    return res.status(e.status || 500).json({ erro: e.message });
  }
}
