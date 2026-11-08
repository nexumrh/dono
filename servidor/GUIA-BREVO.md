# Guia passo a passo — Brevo (e-mails, SMS e WhatsApp automáticos)

O Brevo é o serviço que **envia** as mensagens. O servidor da NexumCell (Cloudflare) diz o que mandar e para quem. Faça antes o **GUIA-CLOUDFLARE.md** (pelo menos até a Parte 3).

O que vai funcionar depois deste guia:

| Mensagem | Para quem | Quando |
|---|---|---|
| ID e senha de acesso | vendedor/gerente novo | na hora em que você cria o acesso (sai sozinho) |
| Planilha de recebimentos | contador | botão em Relatórios |
| Resumo do dia | você (dono) | todo dia às 19h (e-mail e, se quiser, SMS/WhatsApp) |
| Lembrete de vencimento | cliente | 9h, X dias antes e no dia |
| Aviso de atraso | cliente | 9h, com 1, 3 e 7 dias de atraso (você escolhe) |
| Recibo do pagamento | cliente | quando o Asaas confirma o pagamento |
| Lembrete manual | cliente | botão "Lembrete automático" na Fila de cobrança |

---

## Parte 1 — Criar a conta

1. Entre em **https://www.brevo.com** → **Cadastre-se grátis**.
2. Use o e-mail da loja, confirme o e-mail e preencha os dados da empresa (nome, CNPJ, endereço em Foz do Iguaçu).
3. O plano grátis tem um limite diário de e-mails (confira em brevo.com/pricing), suficiente para os avisos do sistema. SMS e WhatsApp são pagos por mensagem, com créditos que você compra.

## Parte 2 — Remetente dos e-mails

1. No Brevo, clique no nome da conta (canto superior direito) → **Senders, Domains & Dedicated IPs** → aba **Senders** → **Add a sender**.
2. Nome: `NexumCell`. E-mail: o e-mail que vai aparecer como remetente.
3. Abra o e-mail de confirmação que o Brevo mandou e clique em confirmar.
4. Esse e-mail vai no segredo `BREVO_REMETENTE` do Cloudflare.

**Sobre usar Gmail como remetente:** funciona, mas o Brevo não consegue "autenticar" endereços @gmail.com. Para os e-mails chegarem ao Gmail/Yahoo dos clientes, o Brevo **troca o remetente** por um endereço dele (algo como `@brevosend.com`). A mensagem chega, mas o remetente fica estranho e pode cair no spam.

**O ideal (quando puder):** ter um domínio próprio, por exemplo `nexumcell.com.br` (uns R$ 40 por ano no registro.br), e usar `avisos@nexumcell.com.br`. Depois, no Brevo: **Senders, Domains & Dedicated IPs** → **Domains** → **Add a domain** → siga a autenticação (o Brevo mostra 3 registros para colocar no DNS; se o domínio estiver no Cloudflare, ele faz sozinho).

## Parte 3 — Chave de API (e o bloqueio de IP)

1. Conta → **Settings** → **SMTP & API** → aba **API Keys** → **Generate a new API key**.
2. Nome: `nexumcell-servidor`. Copie a chave (começa com `xkeysib-`). **Ela só aparece uma vez.**
3. Cole no Cloudflare como segredo `BREVO_API_KEY` e clique em Deploy.
4. **Importante:** o Brevo pode bloquear chamadas de endereços de internet (IP) desconhecidos, e o Cloudflare usa IPs que mudam o tempo todo. Desligue esse bloqueio só para a API:
   - Conta → **Settings** → **Security** → **Authorized IPs**
   - Em "Blocking unauthorized IP addresses", na linha **API keys**, clique em **Deactivate** e confirme.
   - Se não desligar, um dia os e-mails param e chega um e-mail do Brevo falando de "IP não autorizado".
5. A chave continua protegida: ela fica só no Cloudflare. Se vazar, apague-a no Brevo e gere outra.

**Teste:** Painel do Dono → Configurações → **Testar Brevo** (deixe o celular vazio). Tem que chegar um e-mail "Teste do Brevo — NexumCell" no e-mail de dono.

## Parte 4 — SMS

1. No Brevo, compre créditos de SMS: conta → **Plans & Billing** (ou **Plano**) → **SMS credits** → escolha o pacote e o país **Brasil**.
2. No Cloudflare, o nome do remetente fica em `BREVO_SMS_REMETENTE` (no `wrangler.toml`, já vem `NexumCell`; até 11 letras, sem espaço). No Brasil as operadoras podem trocar o nome por um número curto: é normal.
3. **Teste:** Configurações → **Testar Brevo** → digite o seu celular com DDD. Tem que chegar "NexumCell: teste de SMS pelo Brevo".

Os SMS saem sem acento (as operadoras cobram mais e às vezes quebram as letras acentuadas).

## Parte 5 — WhatsApp (opcional, mas o mais eficiente)

Regras do WhatsApp (da Meta, não do Brevo):
- Precisa de um **número só para isso**, que **não** esteja instalado no WhatsApp normal nem no WhatsApp Business do celular. Pode ser um chip novo da loja.
- A primeira mensagem para cada cliente tem que ser um **modelo aprovado** pela Meta. Texto livre só depois que o cliente responder.
- A Meta cobra por conversa e o Brevo desconta dos créditos de WhatsApp.

### 5.1 Ativar o WhatsApp no Brevo
1. No Brevo: menu **Campaigns** → **WhatsApp** → **Activate WhatsApp** (ou **Get started**).
2. Ele abre a tela da Meta: entre com o Facebook do dono, crie (ou escolha) a **conta comercial da Meta** com o nome e CNPJ da loja.
3. Digite o número novo, receba o código por SMS ou ligação e confirme.
4. Na Meta (business.facebook.com → Configurações da empresa → Central de segurança), faça a **verificação da empresa** com o CNPJ. Sem ela o limite de mensagens por dia fica bem baixo.
5. Compre créditos de WhatsApp no Brevo.
6. O número vai no segredo `BREVO_WHATSAPP_NUMERO`, só números com 55 e DDD: `5545999990000`.

### 5.2 Criar os modelos (templates)
No Brevo: **Campaigns** → **WhatsApp** → **Templates** → **Create a template**. Para cada um: categoria **Utility** (utilidade), idioma **Português (BR)**. Para inserir as variáveis, digite exatamente como abaixo (com as chaves duplas).

**Modelo 1 — lembrete** (vai em `BREVO_WA_TEMPLATE_LEMBRETE`)
```
Olá, {{ params.NOME }}! Aqui é da {{ params.LOJA }}. Sua parcela de {{ params.VALOR }} vence em {{ params.VENCIMENTO }}. Pagando antes você ganha desconto. Pague pelo portal: {{ params.LINK }}
```

**Modelo 2 — atraso** (vai em `BREVO_WA_TEMPLATE_ATRASO`)
```
Olá, {{ params.NOME }}. Sua parcela está em aberto há {{ params.DIAS }} dia(s). Valor hoje: {{ params.VALOR }}. Regularize pelo portal {{ params.LINK }} para evitar o bloqueio do aparelho. Se já pagou, desconsidere.
```

**Modelo 3 — recibo** (vai em `BREVO_WA_TEMPLATE_RECIBO`)
```
Olá, {{ params.NOME }}! Recebemos o seu pagamento de {{ params.VALOR }} referente à parcela {{ params.PARCELA }}. Obrigado por pagar em dia!
```

**Modelo 4 — resumo do dono** (opcional, vai em `BREVO_WA_TEMPLATE_RESUMO`)
```
Resumo do dia da NexumCell: {{ params.TEXTO }}
```

Envie cada modelo para aprovação. A Meta costuma aprovar em minutos ou poucas horas. Quando aparecer **Approved**, abra o modelo: o **ID** (número) aparece na lista ou no endereço da página. Coloque cada ID no segredo correspondente do Cloudflare e clique em Deploy.

> Se a Meta recusar, normalmente é porque o texto parece propaganda. Mantenha a categoria Utility e o texto só sobre a parcela.

**Teste:** Configurações → **Testar Brevo** → seu celular. Tem que chegar o lembrete de teste no WhatsApp.

## Parte 6 — Ligar tudo no Painel do Dono

Painel do Dono → **Lojas e configurações** → cartão **Servidor, Brevo e automações**:

1. **Mensagens automáticas ao cliente**: escolha **WhatsApp; se falhar, SMS** (recomendado). Se escolher "Desligado", só o Asaas avisa.
2. **Lembrete de vencimento e atraso (9h)**: Sim. Ajuste "quantos dias antes" (ex.: 2) e "com quantos dias de atraso" (ex.: `1,3,7`).
3. **Recibo automático**: Sim, se quiser o recibo pelo WhatsApp/SMS.
4. **Resumo das 19h**: e-mail Sim; no celular, SMS ou WhatsApp, e preencha o **celular do dono**.
5. **E-mail do contador**: para o botão "Enviar ao contador por e-mail" em Relatórios.
6. **Salvar configurações**.

### Não mandar duas vezes
O Asaas também manda lembretes (e-mail, SMS, WhatsApp e robô de voz) pela régua dele. Escolha um para cada coisa:
- **Recomendado:** lembretes e atraso pelo **Brevo** (mais baratos e com o link do portal) e, no Asaas, deixe ligado só o **e-mail** e o **robô de voz** (que o sistema liga sozinho com 15+ dias de atraso). No Asaas: **Configurações** → **Notificações**, desmarque SMS e WhatsApp.

## Parte 7 — Quanto custa (para planejar)

- **E-mail:** grátis dentro do limite diário do plano grátis.
- **SMS:** por mensagem, compra antecipada de créditos (veja o preço para o Brasil na tela de compra).
- **WhatsApp:** a Meta cobra por conversa de "utilidade" e o Brevo desconta dos créditos.
- **Dica:** com "WhatsApp; se falhar, SMS", o SMS só é usado quando o WhatsApp não chega.

## Problemas comuns

| Sintoma | Causa e solução |
|---|---|
| "Brevo não configurado" | Falta `BREVO_API_KEY` no Cloudflare (ou não clicou em Deploy) |
| `Brevo 401` | Chave errada, ou o bloqueio de IP da Parte 3 ainda está ligado |
| E-mail chega com remetente estranho | É o Gmail sem domínio próprio (Parte 2) |
| `modelo de WhatsApp "atraso" não configurado` | Falta o ID do modelo no segredo `BREVO_WA_TEMPLATE_ATRASO`. Com "WhatsApp; se falhar, SMS" o cliente recebe SMS no lugar |
| WhatsApp não chega | Modelo ainda não aprovado, sem créditos, ou o número do cliente está errado no cadastro |
| `Brevo 402` | Acabaram os créditos de SMS/WhatsApp |
