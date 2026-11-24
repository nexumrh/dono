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
- Robô de triagem e **autoatendimento** (liga/desliga no CRM → WhatsApp). O menu tem 12 opções:
  1 pagar a parcela (valor de hoje e link do PIX) · 2 contrato em PDF · 3 como pagar e usar o app (6 imagens) ·
  4 renegociar (atraso, quitação com desconto e pedido de acordo) · 5 celular travado: libera 20 min para pagar (2 vezes por parcela) ·
  6 mudar o dia do vencimento · 7 celular roubado, furtado ou perdido (trava depois do CONFIRMO) · 8 meus pedidos e declaração de quitação ·
  9 comprar outro celular (pré-aprovado, lojas da cidade) e indique e ganhe · 10 Suporte · 11 Financeiro · 12 Comercial.
  Também entende frases como "quero o boleto", "como pago?", "meu celular travou", "fui roubado", "quero mudar o vencimento".
  Acha o contrato pelo número do WhatsApp; se não achar, pede CPF e data de nascimento (a mesma conferência do app).
- **Comprovante:** o cliente manda a foto, a IA lê (valor, data, recebedor, ID), confere com a parcela e, se estiver tudo certo,
  libera o celular por 24 h e abre um pedido "Comprovante (WhatsApp)" para o financeiro dar a baixa. O mesmo comprovante não vale duas vezes.
- **Espanhol:** quem escreve em espanhol recebe o menu e as respostas em espanhol (a IA traduz).
- **Avisos de cobrança** (liga/desliga no CRM → WhatsApp): 3 dias antes, no dia e 1, 3 e 7 dias de atraso, das 8h às 20h,
  com intervalo entre as mensagens. O cliente responde 1, 3, 4 ou 5 e o autoatendimento resolve.
- A IA do CRM (resposta automática) também manda esses itens sozinha quando o cliente pede.
- Envia o que a equipe escreve no CRM, inclusive fotos e PDFs como arquivo de verdade.

## Atualizar para a versão 1.2
Feche a janela do programa, troque os arquivos **index.js** e **autoatendimento.js** desta pasta e abra o
**iniciar.bat** de novo. Não precisa ler o QR code de novo. No CRM → WhatsApp aparece "versão 1.2".
- A sessão fica salva na pasta `sessao/`: não precisa ler o QR code de novo ao reiniciar.

Conexão não oficial: não mande mensagens em massa nem para quem nunca falou com a NexumCell.
