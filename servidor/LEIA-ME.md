# NexumCell — servidor (Asaas, Brevo, nota fiscal, assinatura e rotinas)

Sem ele tudo continua funcionando com PIX estático e baixa manual. Com ele, as cobranças, e-mails, WhatsApp/SMS, nota fiscal e as rotinas das 9h e das 19h ficam automáticas.

**Onde rodar** (o mesmo código serve para os dois):
- **Cloudflare Workers** (recomendado, grátis para começar): siga **GUIA-CLOUDFLARE.md**. Arquivos: `wrangler.toml` e `worker/`.
- **Vercel**: importe esta pasta; as rotinas usam `vercel.json` (crie também o segredo `CRON_SECRET`).

**Mensagens (Brevo)**: siga **GUIA-BREVO.md**.

## Rotas
| Rota | Quem chama | Para quê |
|---|---|---|
| `/api/loja` | portais (login) | cobranças Asaas, Serasa, negativação, link do cartão, antecipação, apagar cobranças de devolução |
| `/api/asaas-webhook` | Asaas | baixa automática + recibo pelo Brevo |
| `/api/pix`, `/api/pix-automatico` | app da trava e portal do cliente | PIX com valor certo e débito automático |
| `/api/avisos` | portais (login) | e-mails, WhatsApp/SMS, teste e rotinas manuais |
| `/api/nf` | portais (login) | NFC-e pela Focus NFe (emitir, consultar, cancelar) |
| `/api/assinatura` | portal do cliente e portais | carimbo da assinatura; ZapSign |
| `/api/zapsign-webhook` | ZapSign | contrato assinado → venda segue para a entrada |
| `/api/assistente` | portal do cliente | IA (Groq) |
| `/api/cron` (só Vercel) | agendador | rotinas 9h e 19h |

## Variáveis
Segredos (nunca no GitHub): `FIREBASE_SERVICE_ACCOUNT`, `DONO_EMAIL`, `ASAAS_API_KEY`, `ASAAS_WEBHOOK_TOKEN`, `BREVO_API_KEY`, `BREVO_REMETENTE`, `BREVO_WHATSAPP_NUMERO`, `BREVO_WA_TEMPLATE_LEMBRETE`, `BREVO_WA_TEMPLATE_ATRASO`, `BREVO_WA_TEMPLATE_RECIBO`, `BREVO_WA_TEMPLATE_RESUMO`, `GROQ_API_KEY`, `FOCUS_NFE_TOKEN`, `ZAPSIGN_TOKEN`, `ZAPSIGN_WEBHOOK_TOKEN`, `CRON_SECRET` (só Vercel).

Não secretas (no `wrangler.toml` → `[vars]`): `ASAAS_URL`, `PORTAL_ORIGEM`, `PORTAL_CLIENTE_URL`, `BREVO_REMETENTE_NOME`, `BREVO_SMS_REMETENTE`, `FOCUS_NFE_URL`, `ZAPSIGN_URL`, `ROTINA_MAX`.

## O que o servidor faz com o Asaas
- **Cobranças automáticas** de cada parcela (PIX, boleto ou cartão), com desconto, multa e juros do contrato. Renegociação, troca de vencimento, pagamento parcial e baixa na loja são sincronizados.
- **Split da comissão**: com "Pagar a comissão direto na conta do vendedor" ligado, cada cobrança leva a comissão para o Wallet ID do vendedor (percentual sobre o valor líquido da parcela).
- **Robô de voz**: liga a ligação automática do Asaas nas notificações de atraso de quem passou do limite de dias e desliga quando regulariza.
- **PIX Automático**, **Serasa**, **negativação**, **cartão** e **antecipação** como antes. Teste o PIX Automático no sandbox antes de usar.
- No webhook do Asaas, marque PAYMENT_RECEIVED, PAYMENT_CONFIRMED e os eventos do PIX Automático.
