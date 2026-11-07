# NexumCell — Painel do Dono

Todas as lojas, equipe, configurações de crédito, da trava e do app. **O primeiro login do sistema tem que ser feito aqui** (vira o Dono).

## Arquivos
- `index.html` — o portal (não precisa mexer).
- `nexumcell-config.js` — **cole aqui o `firebaseConfig`** do projeto NexumCell e os endereços dos portais. Use o **mesmo conteúdo** em todos os repositórios NexumCell.

## Publicar (GitHub Pages)
1. Estes arquivos ficam no repositório `nexumrh/dono`.
2. *Settings → Pages → Branch: main / (root) → Save*.
3. Endereço: `https://nexumrh.github.io/dono/` (ou domínio próprio em *Custom domain*).
4. No Firebase: *Authentication → Configurações → Domínios autorizados* → adicione o domínio.

Sem `apiKey` no config, o portal abre em **modo demonstração** (dados de exemplo só no navegador).
