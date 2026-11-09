// Aviso instantâneo para o app da trava: o portal chama depois de travar, liberar, mudar regras etc.
// POST /api/push {"ids":["token1","token2"]}  (equipe logada; no máximo 15 por chamada)
import { cors, exigirEquipe, pushAparelho } from './_base.js';

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).end();
  try {
    await exigirEquipe(req, ['DONO', 'FINANCEIRO', 'SUPORTE', 'GERENTE']);
    const ids = [...new Set((req.body?.ids || []).map(String).filter((x) => /^[A-Za-z0-9_-]{8,64}$/.test(x)))].slice(0, 15);
    let enviados = 0;
    for (const id of ids) if (await pushAparelho(id)) enviados++;
    return res.status(200).json({ ok: true, enviados, total: ids.length });
  } catch (e) {
    return res.status(e.status || 500).json({ erro: e.message });
  }
}
