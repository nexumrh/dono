// Trava do iPhone pelo MDM (Apple Business Manager + SimpleMDM).
// O iPhone precisa estar SUPERVISIONADO: comprado de revendedor autorizado com o número de cliente do
// Apple Business Manager (ABM) da empresa, ou adicionado ao ABM pelo Apple Configurator, e atribuído
// ao servidor MDM. Assim o aparelho se inscreve sozinho no MDM na primeira configuração e o cliente
// não consegue remover o gerenciamento.
// Bloqueio = Modo Perdido: a tela fica travada com a mensagem e o telefone da loja até o pagamento.
// Variável de ambiente: SIMPLEMDM_API_KEY (Settings → API no SimpleMDM, permissão de dispositivos).
// Não importa nada de _base.js (evita import circular): quem chama passa o db.

const BASE = 'https://a.simplemdm.com/api/v1';
const DIA = 86400000;
export const mdmLigado = () => !!process.env.SIMPLEMDM_API_KEY;

export async function mdm(path, { method = 'GET', form } = {}) {
  const k = process.env.SIMPLEMDM_API_KEY;
  if (!k) throw Object.assign(new Error('Trava do iPhone não configurada: falta a chave do MDM (SIMPLEMDM_API_KEY) no servidor.'), { status: 400 });
  const r = await fetch(BASE + path, {
    method,
    headers: { Authorization: 'Basic ' + btoa(k + ':'), ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
    ...(form ? { body: new URLSearchParams(form).toString() } : {}),
  });
  const t = await r.text(); let j = {}; try { j = t ? JSON.parse(t) : {}; } catch (e) { j = { texto: t }; }
  if (!r.ok) throw Object.assign(new Error('MDM: ' + (j.errors?.[0]?.title || j.error || ('erro ' + r.status))), { status: r.status === 404 ? 404 : 502 });
  return j;
}

/** Dispositivo do MDM pelo número de série (inclui os que ainda aguardam inscrição). */
export async function acharPorSerie(serial) {
  const s = String(serial || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s.length < 8) throw Object.assign(new Error('Número de série inválido.'), { status: 400 });
  const j = await mdm('/devices?limit=20&include_awaiting_enrollment=true&search=' + encodeURIComponent(s));
  const lista = (j.data || []).map((d) => ({ id: d.id, ...d.attributes }));
  return lista.find((d) => String(d.serial_number || '').toUpperCase() === s) || null;
}

const hojeBR = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
function etapaTotal(d) {
  if (d.etapaTotalDias != null) return Math.max(1, +d.etapaTotalDias || 7);
  return (+d.toleranciaDias || 0) + 1;
}

/** Mesma regra do app Android (Decisao.kt), sem as etapas parciais: no iPhone o bloqueio é total ou nada. */
export function avaliarIos(d, agora = Date.now()) {
  if (d.quitado || d.status === 'QUITADO') return { travar: false, final: true, motivo: 'Contrato quitado' };
  if (d.status === 'CANCELADO') return { travar: false, final: true, motivo: 'Contrato cancelado' };
  if (d.removerRemoto) return { travar: false, final: true, motivo: 'Remoção autorizada pela loja' };
  if (d.roubo && !d.roubo.liberadoEm) return { travar: true, motivo: `Aparelho com comunicação de ${String(d.roubo.tipo || 'roubo').toLowerCase()}` };
  if (d.modo === 'TRAVAR') return { travar: true, motivo: 'Bloqueio solicitado pela loja' };
  if (d.modo === 'LIBERAR') return { travar: false, motivo: 'Liberado pela loja' };
  if ((+d.liberadoAte || 0) > agora) return { travar: false, motivo: 'Liberação temporária' };
  if ((+d.confianca?.ate || 0) > agora) return { travar: false, motivo: 'Liberação de confiança (24 h)' };
  const hoje = Date.parse(hojeBR());
  let maior = 0, atrasadas = 0;
  for (const p of d.parcelas || []) {
    if (p.pago || !p.venc) continue;
    const dias = Math.floor((hoje - Date.parse(p.venc)) / DIA);
    if (dias > 0) { atrasadas++; maior = Math.max(maior, dias); }
  }
  if (maior >= etapaTotal(d)) return { travar: true, motivo: atrasadas === 1 ? '1 parcela em atraso' : `${atrasadas} parcelas em atraso` };
  return { travar: false, motivo: maior ? `Parcela em atraso há ${maior} dia(s)` : 'Em dia' };
}

/** Aplica no iPhone o que a regra manda (liga/desliga o Modo Perdido). Devolve o estado gravado. */
export async function sincronizarIos(db, token, dados) {
  const ref = db.collection('aparelhos').doc(String(token));
  const d = dados || (await ref.get()).data();
  if (!d?.ios) return false;
  if (!d.mdmId) return { ok: false, motivo: 'iPhone ainda não vinculado ao MDM' };
  const r = avaliarIos(d), ant = d.mdm || {};
  const novo = { ...ant, verificadoEm: Date.now(), motivo: r.motivo, erro: '' };
  try {
    if (r.travar && !ant.perdido) {
      const fone = String(d.lojaTelefone || d.telefoneSuporte || '').replace(/\D/g, '');
      await mdm(`/devices/${d.mdmId}/lost_mode`, { method: 'POST', form: {
        message: `${d.lojaNome || d.recebedor || 'NexumCell'}: ${r.motivo}. Regularize o pagamento para liberar o iPhone${d.portal ? ' pelo portal ' + d.portal : ''}.`.slice(0, 380),
        ...(fone ? { phone_number: fone } : {}),
        footnote: `Contrato nº ${d.vendaNumero || ''} · ${d.clienteNome || ''}`.slice(0, 120),
      } });
      Object.assign(novo, { perdido: true, travadoEm: Date.now() });
    } else if (!r.travar && ant.perdido) {
      await mdm(`/devices/${d.mdmId}/lost_mode`, { method: 'DELETE' });
      Object.assign(novo, { perdido: false, liberadoEm: Date.now() });
    }
    if (r.final && !ant.final) Object.assign(novo, { final: true, finalEm: Date.now(), aviso: 'Contrato encerrado: libere o iPhone também no Apple Business Manager (Liberar dispositivo) para o cliente ficar livre do gerenciamento.' });
  } catch (e) { novo.erro = String(e.message || e).slice(0, 200); }
  await ref.set({ mdm: novo, travado: !!novo.perdido }, { merge: true });
  return { ok: !novo.erro, ...novo };
}

/** Rotina (manhã e noite): confere todos os iPhones ativos. */
export async function iosRotina(db) {
  if (!mdmLigado()) return { ios: 'MDM não configurado' };
  const aps = (await db.collection('aparelhos').where('ios', '==', true).get()).docs;
  let travados = 0, liberados = 0, erros = 0;
  for (const a of aps) {
    const d = a.data(); if (!d.mdmId || d.mdm?.final) continue;
    const r = await sincronizarIos(db, a.id, d);
    if (r?.erro) erros++; else if (r?.perdido && !d.mdm?.perdido) travados++; else if (r && !r.perdido && d.mdm?.perdido) liberados++;
  }
  return { iosTotal: aps.length, iosTravados: travados, iosLiberados: liberados, iosErros: erros };
}
