// iPhone: vincular ao MDM na entrega e aplicar a trava (Modo Perdido).
// POST /api/ios (equipe logada)
//   {"acao":"status"}                        → MDM configurado?
//   {"acao":"buscar", serial}                 → acha o iPhone no MDM pelo número de série
//   {"acao":"vincular", token, serial}        → liga o contrato ao iPhone, confere supervisão e conclui a venda
//   {"acao":"sincronizar", token}             → aplica agora a regra (trava/libera)
import { db, cors, exigirEquipe } from './_base.js';
import { mdmLigado, acharPorSerie, sincronizarIos } from './_ios.js';

const erro = (m, s = 400) => Object.assign(new Error(m), { status: s });

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const eu = await exigirEquipe(req);
    const b = req.body || {};
    if (b.acao === 'status') return res.status(200).json({ ligado: mdmLigado() });

    if (b.acao === 'buscar') {
      const d = await acharPorSerie(b.serial);
      if (!d) throw erro('Este número de série não está no MDM. Confira se o iPhone foi adicionado ao Apple Business Manager e atribuído ao servidor MDM.', 404);
      return res.status(200).json({ id: d.id, nome: d.name || '', modelo: d.model_name || d.product_name || '', status: d.status || '', supervisionado: d.is_supervised === true });
    }

    if (b.acao === 'vincular' || b.acao === 'sincronizar') {
      const tk = String(b.token || '');
      const ref = db.collection('aparelhos').doc(tk), s = await ref.get();
      if (!s.exists) throw erro('Contrato do aparelho não encontrado.', 404);
      const a = s.data();
      if (!a.ios) throw erro('Este contrato não é de iPhone.');
      if (eu.role !== 'DONO' && eu.role !== 'FINANCEIRO' && eu.role !== 'SUPORTE' && a.lojaId !== eu.lojaId) throw erro('Este aparelho é de outra loja.', 403);

      if (b.acao === 'sincronizar') return res.status(200).json(await sincronizarIos(db, tk, a));

      const d = await acharPorSerie(b.serial);
      if (!d) throw erro('Este número de série não está no MDM. O iPhone precisa estar no Apple Business Manager da empresa e atribuído ao servidor MDM.', 404);
      if (d.is_supervised !== true) throw erro('O iPhone não está supervisionado. Sem supervisão o cliente pode remover a trava: não entregue. Restaure o iPhone e faça a configuração pelo Apple Business Manager.');
      if (String(d.status || '').toLowerCase() !== 'enrolled') throw erro('O iPhone ainda não se inscreveu no MDM. Termine a configuração inicial no aparelho (tela “Gerenciamento remoto” → Inscrever) com internet e tente de novo.');
      const outro = (await db.collection('aparelhos').where('mdmId', '==', d.id).get()).docs.find((x) => x.id !== tk && !x.data().quitado && x.data().status !== 'CANCELADO');
      if (outro) throw erro('Este iPhone já está vinculado a outro contrato ativo (nº ' + (outro.data().vendaNumero || '') + ').', 409);
      const serial = String(d.serial_number || b.serial).toUpperCase();
      if (d.imei && a.imei && String(d.imei).replace(/\D/g, '') !== String(a.imei)) throw erro(`O IMEI deste iPhone (${d.imei}) não é o do contrato (${a.imei}). Confira se pegou o aparelho certo.`, 409);
      const agora = Date.now();
      await ref.set({ mdmId: d.id, serial, mdm: { vinculadoEm: agora, vinculadoPor: eu.nome, modelo: d.model_name || '', perdido: false }, checkin: { em: agora, imei: a.imei, deviceOwner: true, modo: 'mdm', modelo: d.model_name || 'iPhone' } }, { merge: true });
      // conclui a venda (mesmo efeito da confirmação do app Android)
      const vref = db.collection('vendas').doc(a.vendaId), v = (await vref.get()).data() || {};
      if (v.status === 'INSTALANDO') {
        await vref.set({ status: 'ATIVA', instaladoEm: agora, instalacao: { ...(v.instalacao || {}), falha: null, concluidaEm: agora, via: 'MDM', serial } }, { merge: true });
        if (v.aparelho?.estoqueId) await db.collection('estoque').doc(v.aparelho.estoqueId).set({ status: 'VENDIDO', vendaId: a.vendaId, vendidoEm: agora }, { merge: true });
      }
      await db.collection('logs').add({ em: agora, acao: 'iPhone vinculado ao MDM (trava ativa)', alvo: a.vendaId, det: `nº ${a.vendaNumero || ''} · série ${serial}`, por: eu.nome });
      const r = await sincronizarIos(db, tk, { ...a, mdmId: d.id, mdm: { perdido: false } });
      return res.status(200).json({ ok: true, serial, modelo: d.model_name || '', trava: r, concluida: v.status === 'INSTALANDO' });
    }
    throw erro('ação desconhecida');
  } catch (e) {
    console.error(e);
    return res.status(e.status || 500).json({ erro: e.status ? e.message : 'Não foi possível falar com o MDM agora. Tente de novo.' });
  }
}
