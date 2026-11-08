# Guia passo a passo — colocar o servidor da NexumCell no Cloudflare

Tempo: uns 30 minutos. Custo: **grátis** para começar.

## O que é o "servidor" e por que ele existe

Os portais (Dono, Gerente, Vendedor…) rodam no GitHub Pages, que é público. Por isso **nenhuma chave secreta pode ficar neles**: chave do Asaas, do Brevo, da nota fiscal, da IA. O servidor é um pequeno programa que roda no Cloudflare, guarda essas chaves escondidas e faz o trabalho:

| Endereço | O que faz |
|---|---|
| `/api/loja` | Cria as cobranças no Asaas, consulta Serasa, negativa, gera link do cartão, simula antecipação, apaga cobranças de venda devolvida |
| `/api/asaas-webhook` | O Asaas avisa quando o cliente pagou → baixa a parcela e destrava o aparelho sozinho |
| `/api/pix` e `/api/pix-automatico` | PIX com valor certo e débito automático no PIX |
| `/api/avisos` | E-mails e WhatsApp/SMS pelo Brevo |
| `/api/nf` | Nota fiscal (NFC-e) pela Focus NFe |
| `/api/assinatura` e `/api/zapsign-webhook` | Carimbo da assinatura (IP, data, hash) e assinatura ZapSign |
| `/api/assistente` | Assistente com IA no portal do cliente |
| Rotinas | **9h**: lembretes aos clientes e robô de voz · **19h**: resumo do dia para você |

O mesmo código também funciona na Vercel. Use **um ou outro**: este guia é o do Cloudflare.

---

## Parte 1 — Criar a conta no Cloudflare

1. Entre em **https://dash.cloudflare.com/sign-up**.
2. Cadastre o e-mail `wevellenerrera21@gmail.com` (ou outro seu) e uma senha forte.
3. Abra o e-mail de confirmação do Cloudflare e clique no link.
4. Ative a verificação em duas etapas: canto superior direito → **Meu perfil** → **Autenticação** → **Adicionar 2FA**. Quem entra nessa conta controla as cobranças: proteja.

> Não precisa cadastrar domínio nem cartão para usar o Workers grátis.

## Parte 2 — Pegar a "chave da conta de serviço" do Firebase

É ela que deixa o servidor ler e gravar no banco de dados.

1. Entre em **https://console.firebase.google.com** e abra o projeto da NexumCell.
2. Clique na engrenagem ⚙️ ao lado de "Visão geral do projeto" → **Configurações do projeto**.
3. Aba **Contas de serviço** → botão **Gerar nova chave privada** → **Gerar chave**.
4. Vai baixar um arquivo `.json`. **Guarde num lugar seguro** (Google Drive particular, por exemplo).
   - Nunca mande esse arquivo no WhatsApp, nunca coloque no GitHub.
   - Se vazar: volte nessa tela, apague a chave e gere outra.

## Parte 3 — Criar o Worker ligado ao GitHub

O código do servidor já está no repositório `nexumrh/nexumcell-dono`, na pasta `servidor`. O Cloudflare vai buscar de lá e publicar sozinho, inclusive toda vez que eu atualizar o código.

1. No Cloudflare, menu da esquerda: **Compute (Workers)** → **Workers & Pages** → botão **Create** (Criar).
2. Escolha **Import a repository** (Importar um repositório) → **Connect GitHub**.
3. O GitHub vai pedir permissão. Escolha a organização **nexumrh** e marque **Only select repositories** → `nexumcell-dono` → **Install & Authorize**.
4. De volta ao Cloudflare, escolha o repositório `nexumcell-dono`.
5. Preencha:
   - **Project name**: `nexumcell-servidor` (tem que ser exatamente esse nome, igual ao do arquivo `wrangler.toml`)
   - **Build command**: deixe vazio
   - **Deploy command**: `npx wrangler deploy`
   - Abra **Advanced settings** → **Path / Root directory**: `servidor`
6. Clique em **Deploy** (Salvar e publicar). Espere 1 ou 2 minutos.
7. Quando terminar, aparece o endereço do seu servidor, parecido com
   `https://nexumcell-servidor.SEU-NOME.workers.dev`
   Abra no navegador: tem que aparecer **"NexumCell: servidor no ar ✔"**.

> Se der erro de nome: o nome do Worker no Cloudflare precisa ser igual ao `name` do `wrangler.toml` (`nexumcell-servidor`).

## Parte 4 — Colocar os segredos

No Worker `nexumcell-servidor`: **Settings** (Configurações) → **Variables and Secrets** → **Add**. Para cada linha abaixo escolha o tipo **Secret** (fica escondido), cole o valor e salve. Depois de colocar todos, clique em **Deploy** para valer.

| Nome (exatamente assim) | Valor | Onde conseguir |
|---|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | o **conteúdo inteiro** do arquivo `.json` da Parte 2 (abra no bloco de notas, copie tudo, das chaves `{` até `}`) | Parte 2 |
| `DONO_EMAIL` | `wevellenerrera21@gmail.com` | o seu e-mail de dono |
| `ASAAS_API_KEY` | chave de API do Asaas | Asaas → Integrações → Chave de API |
| `ASAAS_WEBHOOK_TOKEN` | uma senha que você inventar (ex.: 30 letras e números) | você cria |
| `BREVO_API_KEY` | chave de API do Brevo | veja o **GUIA-BREVO.md** |
| `BREVO_REMETENTE` | e-mail remetente verificado no Brevo | GUIA-BREVO.md |
| `BREVO_WHATSAPP_NUMERO` | número do WhatsApp Business no Brevo, ex.: `5545999990000` | GUIA-BREVO.md (só se for usar WhatsApp) |
| `BREVO_WA_TEMPLATE_LEMBRETE` | número do modelo de lembrete | GUIA-BREVO.md |
| `BREVO_WA_TEMPLATE_ATRASO` | número do modelo de atraso | GUIA-BREVO.md |
| `BREVO_WA_TEMPLATE_RECIBO` | número do modelo de recibo | GUIA-BREVO.md |
| `BREVO_WA_TEMPLATE_RESUMO` | número do modelo do resumo do dono (opcional) | GUIA-BREVO.md |
| `GROQ_API_KEY` | chave da IA (opcional, assistente do cliente) | console.groq.com → API Keys |
| `FOCUS_NFE_TOKEN` | token da empresa na Focus NFe (opcional, nota fiscal) | focusnfe.com.br → painel → Empresas → Tokens |
| `ZAPSIGN_TOKEN` | token da API da ZapSign (opcional) | ZapSign → Configurações → Integração → API |
| `ZAPSIGN_WEBHOOK_TOKEN` | outra senha que você inventar (opcional) | você cria |

Comece só com os 4 primeiros + Brevo. Os opcionais você coloca quando contratar o serviço.

### As configurações que NÃO são secretas

Ficam no arquivo `servidor/wrangler.toml`, no GitHub (no bloco `[vars]`). Para mudar, edite o arquivo no próprio site do GitHub (ícone de lápis) e salve: o Cloudflare publica de novo sozinho.

| Nome | Como vem | Quando mudar |
|---|---|---|
| `ASAAS_URL` | `https://api-sandbox.asaas.com/v3` (testes) | quando for usar de verdade: `https://api.asaas.com/v3` |
| `FOCUS_NFE_URL` | homologação (testes) | produção: `https://api.focusnfe.com.br` |
| `ZAPSIGN_URL` | sandbox (testes) | produção: `https://api.zapsign.com.br/api/v1` |
| `ROTINA_MAX` | `10` | se assinar o plano pago do Workers: `1000` |
| `BREVO_REMETENTE_NOME` / `BREVO_SMS_REMETENTE` | `NexumCell` | se quiser outro nome |

> **Não** crie no painel uma variável com o mesmo nome de uma dessas: o Cloudflare dá conflito. As do `wrangler.toml` mandam.

## Parte 5 — Ligar o servidor nos portais

1. Painel do Dono → **Lojas e configurações** → campo **Endereço do servidor** → cole `https://nexumcell-servidor.SEU-NOME.workers.dev` (sem barra no final) → **Salvar configurações**.
2. Recarregue a página. No cartão **Servidor, Brevo e automações**, clique em **Conferir servidor**: tem que aparecer "Servidor: Cloudflare" e um ✓ em cada serviço que você configurou.

## Parte 6 — Avisar o Asaas (webhook)

1. No Asaas: **Integrações** → **Webhooks** → **Adicionar**.
2. URL: `https://nexumcell-servidor.SEU-NOME.workers.dev/api/asaas-webhook`
3. Token de autenticação: o mesmo `ASAAS_WEBHOOK_TOKEN` da Parte 4.
4. Eventos: **PAYMENT_RECEIVED**, **PAYMENT_CONFIRMED** e os do **PIX Automático**.
5. Salve. Faça um pagamento de teste no sandbox e veja a parcela ser baixada sozinha.

(ZapSign, se for usar: Configurações → Integração → Webhooks → URL `…/api/zapsign-webhook`, evento "Documento assinado", cabeçalho `X-Nexum-Token` com o valor do `ZAPSIGN_WEBHOOK_TOKEN`.)

## Parte 7 — Conferir as rotinas automáticas

No Worker → **Settings** → **Triggers** (Gatilhos) → **Cron Triggers**. Têm que aparecer 4 horários (em UTC, que é Brasília + 3 h):

- `0 12 * * *`, `20 12 * * *`, `40 12 * * *` → 9h, 9h20 e 9h40: lembretes e robô de voz
- `0 22 * * *` → 19h: resumo do dia

Para testar sem esperar: Painel do Dono → Configurações → **Enviar os lembretes de hoje agora** / **Gerar o resumo do dia agora**.

## Parte 8 — Ver erros

No Worker → **Logs** (ou **Observability**). Cada chamada aparece ali. Mensagens comuns:

| Mensagem | O que fazer |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT não configurado` | Faltou o segredo da Parte 4, ou não clicou em Deploy depois |
| `Login da conta de serviço falhou` | Colou o JSON pela metade. Cole de novo o arquivo inteiro |
| `login inválido ou vencido` | Saia e entre de novo no portal |
| `Brevo 401` / `unauthorized IP` | Veja o GUIA-BREVO.md, Parte 3 (bloqueio de IP) |
| `Exceeded CPU Limit` ou `Too many subrequests` | O plano grátis ficou pequeno (veja abaixo) |

## Plano grátis ou pago?

O plano grátis do Workers dá 100 mil chamadas por dia, mas cada execução pode usar só **10 ms de processador** e fazer no máximo **50 chamadas externas**. Para uma ou duas lojas começando, costuma bastar: por isso a rotina da manhã roda em 3 rodadas de 10 mensagens.

Passe para o **Workers Paid (US$ 5 por mês)** quando:
- aparecer `Exceeded CPU Limit` nos logs (normalmente com algumas centenas de contratos ativos), ou
- tiver mais de ~30 lembretes por dia.

Para assinar: Workers & Pages → **Plans** → Workers Paid. Depois mude `ROTINA_MAX` para `"1000"` no `wrangler.toml`.

## Segurança — resumo

- Segredos **só** no Cloudflare (Parte 4). Nunca no GitHub, nunca no WhatsApp, nunca nos portais.
- Se desconfiar que uma chave vazou: gere outra no serviço (Asaas, Brevo, Firebase…), troque o segredo no Cloudflare e clique em Deploy.
- O código do servidor fica público no GitHub, e tudo bem: sem os segredos ele não faz nada.
