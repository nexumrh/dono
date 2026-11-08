// Envio de e-mail, SMS e WhatsApp pelo Brevo (brevo.com).
// Variáveis (Cloudflare: Settings > Variables and Secrets · Vercel: Settings > Environment Variables):
//   BREVO_API_KEY          -> chave de API do Brevo (SMTP & API > API Keys). SECRETA.
//   BREVO_REMETENTE        -> e-mail remetente verificado no Brevo (ex.: avisos@sualoja.com.br ou seu Gmail verificado)
//   BREVO_REMETENTE_NOME   -> nome que aparece no e-mail (ex.: NexumCell)
//   BREVO_SMS_REMETENTE    -> nome do SMS, até 11 letras sem espaço (ex.: NexumCell)
//   BREVO_WHATSAPP_NUMERO  -> número do WhatsApp Business ligado ao Brevo, com 55 e DDD (ex.: 5545999990000)
//   BREVO_WA_TEMPLATE_*    -> números dos modelos de WhatsApp aprovados (veja GUIA-BREVO.md)

const env = () => globalThis.process?.env || {};
export const brevoLigado = () => !!env().BREVO_API_KEY;

async function brevo(caminho, corpo) {
  if (!brevoLigado()) throw new Error('Brevo não configurado (falta BREVO_API_KEY)');
  const r = await fetch('https://api.brevo.com/v3' + caminho, {
    method: 'POST',
    headers: { 'api-key': env().BREVO_API_KEY, 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(corpo),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('Brevo ' + r.status + ': ' + (j.message || j.code || JSON.stringify(j)));
  return j;
}

const escHtml = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// moldura simples e bonita para todos os e-mails (texto puro vira parágrafos)
export function moldura(titulo, corpoTexto, rodape = '') {
  const corpo = String(corpoTexto).split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px">${escHtml(p).replace(/\n/g, '<br>')}</p>`).join('');
  return `<!doctype html><html><body style="margin:0;background:#F2F4F8;font-family:Arial,Helvetica,sans-serif;color:#1B2540">
  <div style="max-width:560px;margin:0 auto;padding:24px 14px"><div style="background:#0E1A3A;color:#F3D98B;border-radius:14px 14px 0 0;padding:18px 22px;font-size:19px;font-weight:bold">${escHtml(titulo)}</div>
  <div style="background:#fff;border-radius:0 0 14px 14px;padding:22px;font-size:15px;line-height:1.5">${corpo}</div>
  <p style="font-size:12px;color:#7A86A3;text-align:center;margin-top:14px">${escHtml(rodape || 'Mensagem automática do sistema NexumCell.')}</p></div></body></html>`;
}

// para: "email" ou [{email,name}] · html: HTML pronto (ou use texto)
export async function enviarEmail({ para, assunto, html, texto, titulo, anexos }) {
  const to = (Array.isArray(para) ? para : [para]).filter(Boolean).map((x) => (typeof x === 'string' ? { email: x } : x));
  if (!to.length) throw new Error('sem destinatário');
  return brevo('/smtp/email', {
    sender: { email: env().BREVO_REMETENTE, name: env().BREVO_REMETENTE_NOME || 'NexumCell' },
    to, subject: String(assunto).slice(0, 200),
    htmlContent: html || moldura(titulo || assunto, texto || ''),
    ...(texto ? { textContent: texto } : {}),
    ...(anexos?.length ? { attachment: anexos } : {}),   // [{name:'relatorio.csv', content:'<base64>'}]
  });
}

// telefone brasileiro → 55DDDNÚMERO (só dígitos)
export const telInter = (t) => { const d = String(t || '').replace(/\D/g, ''); if (!d) return ''; return d.startsWith('55') && d.length >= 12 ? d : '55' + d; };

export async function enviarSms(tel, texto) {
  const n = telInter(tel); if (!n) throw new Error('sem telefone');
  return brevo('/transactionalSMS/send', { sender: (env().BREVO_SMS_REMETENTE || 'NexumCell').replace(/\s/g, '').slice(0, 11), recipient: n, content: String(texto).slice(0, 640), type: 'transactional', unicodeEnabled: false });
}

// WhatsApp: a primeira mensagem para um cliente PRECISA ser de um modelo aprovado pela Meta (templateId).
// params preenche os {{params.NOME}} do modelo. Texto livre só funciona se o cliente respondeu nas últimas 24 h.
export async function enviarWhatsapp(tel, { templateId, params, texto }) {
  const n = telInter(tel); if (!n) throw new Error('sem telefone');
  if (!env().BREVO_WHATSAPP_NUMERO) throw new Error('falta BREVO_WHATSAPP_NUMERO');
  const corpo = { senderNumber: telInter(env().BREVO_WHATSAPP_NUMERO), contactNumbers: [n] };
  if (templateId) Object.assign(corpo, { templateId: +templateId, params: params || {} }); else corpo.text = String(texto || '');
  return brevo('/whatsapp/sendMessage', corpo);
}

// Modelos de WhatsApp (crie no Brevo e coloque os números nas variáveis)
export const MODELOS = {
  lembrete: () => env().BREVO_WA_TEMPLATE_LEMBRETE,   // parcela vencendo: NOME, VALOR, VENCIMENTO, LINK
  atraso: () => env().BREVO_WA_TEMPLATE_ATRASO,       // parcela atrasada: NOME, VALOR, DIAS, LINK
  recibo: () => env().BREVO_WA_TEMPLATE_RECIBO,       // pagamento recebido: NOME, VALOR, PARCELA
  resumo: () => env().BREVO_WA_TEMPLATE_RESUMO,       // resumo do dono: TEXTO
};

// Manda pelo canal escolhido nas Configurações (whatsapp, sms ou os dois), com o texto pronto para SMS
// e os parâmetros para o modelo de WhatsApp. Devolve o que deu certo e o que falhou.
export async function avisarCliente(tel, canal, { modelo, params, texto }) {
  const r = { whatsapp: null, sms: null };
  if (['whatsapp', 'ambos', 'whatsapp_ou_sms'].includes(canal)) {
    try { const id = MODELOS[modelo]?.(); if (!id) throw new Error('modelo de WhatsApp "' + modelo + '" não configurado'); await enviarWhatsapp(tel, { templateId: id, params }); r.whatsapp = 'ok'; } catch (e) { r.whatsapp = e.message; }
  }
  if (['sms', 'ambos'].includes(canal) || (canal === 'whatsapp_ou_sms' && r.whatsapp !== 'ok')) {
    try { await enviarSms(tel, texto); r.sms = 'ok'; } catch (e) { r.sms = e.message; }
  }
  return r;
}
