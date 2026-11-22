# NexumCell WhatsApp (QR code)

Programa que liga o WhatsApp da NexumCell ao **CRM NexumCell**. Ele precisa ficar ligado 24 horas
(num computador da empresa ou numa VPS). As mensagens entram no CRM e saem por ele; continuam no celular.

## Como ligar
1. Instale o **Node.js** (versão LTS) em https://nodejs.org
2. Coloque nesta pasta o arquivo **conta-servico.json** (Firebase → Configurações do projeto → Contas de serviço →
   Gerar nova chave privada). É a mesma conta de serviço do servidor.
3. Windows: dê dois cliques em **iniciar.bat**. VPS/Linux: `npm install` e depois `npm start` (use `pm2 start index.js` para ficar sempre ligado).
4. Abra o CRM → **WhatsApp** e leia o QR code com o celular da NexumCell (WhatsApp → Aparelhos conectados → Conectar um aparelho).

## O que ele faz
- Mensagem recebida vira atendimento no CRM (fila Suporte, Financeiro ou Comercial).
- Robô de triagem (liga/desliga no CRM): pergunta se é suporte, financeiro ou compra e já procura o cliente pelo telefone.
- Envia o que a equipe escreve no CRM, inclusive arquivos (link).
- A sessão fica salva na pasta `sessao/`: não precisa ler o QR code de novo ao reiniciar.

Conexão não oficial: não mande mensagens em massa nem para quem nunca falou com a NexumCell.
