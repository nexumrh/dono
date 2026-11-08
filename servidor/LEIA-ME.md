# NexumCell — servidor de pagamentos (Asaas)

Só é necessário quando você tiver conta no **Asaas**. Sem ele, tudo continua funcionando com o PIX estático + baixa manual no portal.

O que ele faz:
- **/api/pix** — gera um PIX com valor exato (desconto de 5% ou multa já calculados) para cada parcela.
- **/api/assistente** — o assistente do portal do cliente responde perguntas livres com IA. Crie também a variável `GROQ_API_KEY` com a sua chave da Groq (fica só no servidor, nunca no portal).
- **/api/asaas-webhook** — quando o cliente paga, o Asaas avisa o servidor, a parcela é baixada sozinha e o aparelho destrava em poucos minutos. Ninguém precisa conferir comprovante.

## Como ativar (uma vez)
1. Crie a conta no Asaas e gere a **chave de API** (Integrações → Chave de API).
2. No Firebase: Configurações do projeto → Contas de serviço → **Gerar nova chave privada** (baixa um JSON). Guarde-o com cuidado, não coloque no GitHub.
3. Crie uma conta grátis na **Vercel** e importe esta pasta `servidor` (pode ser um repositório privado novo).
4. Em Vercel → Settings → Environment Variables, crie:
   - `FIREBASE_SERVICE_ACCOUNT` = conteúdo inteiro do JSON do passo 2
   - `ASAAS_API_KEY` = chave do passo 1
   - `ASAAS_WEBHOOK_TOKEN` = uma senha qualquer que você inventar
   - `ASAAS_URL` = `https://api.asaas.com/v3` (ou `https://api-sandbox.asaas.com/v3` para testar)
   - `PORTAL_ORIGEM` = `https://nexumrh.github.io`
   - `DONO_EMAIL` = o e-mail do dono (o mesmo dos portais)
   - `GROQ_API_KEY` = chave da IA (opcional, para o assistente do cliente)
5. No Asaas: Integrações → Webhooks → URL `https://SEU-PROJETO.vercel.app/api/asaas-webhook`, eventos **PAYMENT_RECEIVED** e **PAYMENT_CONFIRMED**, token = o mesmo do passo 4.
6. No Painel do Dono → Lojas e configurações, preencha **Servidor de pagamentos** com `https://SEU-PROJETO.vercel.app`.

## O que o servidor faz com o Asaas
- **Cobranças automáticas**: quando a venda fica ativa, cada parcela vira uma cobrança no Asaas (PIX, boleto ou cartão, à escolha do cliente), com desconto antecipado, multa e juros iguais aos do contrato. Renegociação, troca de vencimento, pagamento parcial e baixa na loja são sincronizados sozinhos.
- **Lembretes por WhatsApp, SMS e e-mail**: ligue no painel do Asaas em *Configurações → Notificações* (cobrado por mensagem enviada).
- **PIX Automático**: o cliente ativa no portal; o QR paga a próxima parcela e autoriza o débito mensal das seguintes. **Teste no sandbox antes** (os nomes dos campos do QR imediato precisam ser conferidos).
- **Consulta Serasa** (na análise) e **negativação** (na fila de cobrança): pagas por uso. A negativação via API precisa ser liberada pelo gerente de contas do Asaas e pode exigir o contrato assinado.
- **Link de pagamento no cartão** (Simulador de balcão) e **simulação de antecipação** (Relatórios).
- No webhook do Asaas, marque também os eventos do **PIX Automático**.
