// Escolha automática do modelo do Groq (nov/2026).
// O Groq desliga modelos de tempos em tempos (llama-3.3-70b-versatile e llama-4-scout saíram em 2026).
// Aqui o servidor consulta os modelos ativos da chave e usa o primeiro da lista de preferência que existir.
// Se um modelo some no meio do caminho, groqChat tenta de novo com o próximo.
const TEXTO = ['openai/gpt-oss-120b', 'qwen/qwen3.6-27b', 'qwen/qwen3.8-27b', 'openai/gpt-oss-20b'];
const VISAO = ['qwen/qwen3.8-27b', 'qwen/qwen3.6-27b', 'meta-models/muse-spark-open'];
const RX_VISAO = /qwen3\.?[6-9]|muse|vision|-vl|gemma-?[34]|kimi|scout|maverick/i;
const RX_FORA = /guard|whisper|tts|orpheus|compound|safeguard|playai|distil/i;
let cache = null;

export async function modelosAtivos(chave, forcar = false) {
  if (!forcar && cache && cache.em > Date.now() - 3600e3) return cache.ids;
  try {
    const r = await fetch('https://api.groq.com/openai/v1/models', { headers: { Authorization: 'Bearer ' + chave } });
    const j = await r.json().catch(() => ({}));
    const ids = (j.data || []).filter((m) => m.active !== false).map((m) => m.id);
    if (ids.length) { cache = { em: Date.now(), ids }; return ids; }
  } catch (e) { /* sem lista: usa a preferência */ }
  return null;
}

export async function escolherModelo(chave, tipo = 'texto', preferido = '', evitar = []) {
  const pref = tipo === 'visao' ? VISAO : TEXTO, lista = [preferido, ...pref].filter((m) => m && !evitar.includes(m));
  const ids = await modelosAtivos(chave, evitar.length > 0);
  if (!ids) return lista[0] || pref[0];
  return lista.find((m) => ids.includes(m))
    || ids.find((m) => !evitar.includes(m) && !RX_FORA.test(m) && (tipo === 'visao' ? RX_VISAO.test(m) : /gpt-oss|qwen|llama|kimi|gemma|mistral/i.test(m)))
    || lista[0] || pref[0];
}

// modelos que "pensam" antes de responder precisam de folga de tokens e de pouco raciocínio
export const extrasModelo = (m) => (/gpt-oss/i.test(m) ? { reasoning_effort: 'low' } : /qwen3\.?8/i.test(m) ? { reasoning_effort: 'none' } : {});
export const tokensModelo = (m, max) => (/gpt-oss|qwen3/i.test(m) ? max + 800 : max);
const sumiu = (msg) => /does not exist|decommission|deprecat|not found|no access|not supported|model_not_found/i.test(msg || '');
const limpar = (t) => String(t || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();

// chamada única usada pelo servidor inteiro: devolve o texto da resposta
export async function groqChat(chave, mensagens, { temperatura = 0.3, max = 400, json = false, tipo = 'texto', preferido = '' } = {}) {
  const evitar = [];
  let modelo = await escolherModelo(chave, tipo, preferido, evitar), ultimo = '';
  for (let t = 0; t < 3; t++) {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST', headers: { Authorization: 'Bearer ' + chave, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelo, temperature: temperatura, max_tokens: tokensModelo(modelo, max), ...extrasModelo(modelo), ...(json ? { response_format: { type: 'json_object' } } : {}), messages: mensagens }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok) return { texto: limpar(j.choices?.[0]?.message?.content), modelo };
    ultimo = j.error?.message || String(r.status);
    if (!sumiu(ultimo)) break;
    evitar.push(modelo); modelo = await escolherModelo(chave, tipo, '', evitar);
  }
  throw Object.assign(new Error('IA: ' + ultimo), { status: 502 });
}
