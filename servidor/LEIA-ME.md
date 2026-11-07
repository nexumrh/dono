# NexumCell — servidor de pagamentos (Asaas)

Só é necessário quando você tiver conta no **Asaas**. Sem ele, tudo continua funcionando com o PIX estático + baixa manual no portal.

O que ele faz:
- **/api/pix** — gera um PIX com valor exato (desconto de 5% ou multa já calculados) para cada parcela.
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
5. No Asaas: Integrações → Webhooks → URL `https://SEU-PROJETO.vercel.app/api/asaas-webhook`, eventos **PAYMENT_RECEIVED** e **PAYMENT_CONFIRMED**, token = o mesmo do passo 4.
6. No Painel do Dono → Lojas e configurações, preencha **Servidor de pagamentos** com `https://SEU-PROJETO.vercel.app`.
