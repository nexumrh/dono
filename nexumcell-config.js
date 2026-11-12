/* NexumCell — configuração compartilhada.
   Use o MESMO arquivo em todos os repositórios (dono, gerente, vendedor, financeiro, suporte).

   1) Firebase: Console Firebase → Configurações do projeto → Seus apps → Web → copie o firebaseConfig.
      Enquanto o apiKey estiver vazio, os portais abrem em modo demonstração.
   2) Endereço de cada portal (GitHub Pages ou domínio próprio). Usado nos links
      "seu acesso é pelo portal X" e quando o Dono/Gerente cria um acesso. */
/* Dono do sistema: este e-mail entra em TODOS os portais com perfil de Dono. */
window.NEXUMCELL_DONO = "wevellenerrera21@gmail.com";

window.NEXUMCELL_FIREBASE = {
  apiKey: "AIzaSyAjIqm372XYqWRy9tYywy0snJmVLGd1Dyo",
  authDomain: "nexumcell.firebaseapp.com",
  projectId: "nexumcell",
  storageBucket: "nexumcell.firebasestorage.app",
  messagingSenderId: "157346082090",
  appId: "1:157346082090:web:628f1245e370a56a3e0253"
};

/* 3) IA: NÃO coloque a chave do Groq aqui (o repositório é público).
      Cole a chave no Painel do Dono → Lojas e configurações → Inteligência artificial. */
window.NEXUMCELL_IA = {
  chave: "",
  modelo: "meta-llama/llama-4-scout-17b-16e-instruct"
};

window.NEXUMCELL_URLS = {
  dono:       "https://nexumrh.github.io/dono/",
  gerente:    "https://nexumrh.github.io/gerente/",
  vendedor:   "https://nexumrh.github.io/vendedor/",
  financeiro: "https://nexumrh.github.io/financeiro/",
  suporte:    "https://nexumrh.github.io/suporte/",
  cliente:    "https://nexumrh.github.io/cliente/"
};

/* 4) Endereço do servidor (Cloudflare Workers). Não é segredo: usado no link público de credenciamento de lojas. */
window.NEXUMCELL_SERVIDOR = "https://nexumcell-servidor.wevellenerrera21.workers.dev";
window.NEXUMCELL_WHATS = "5545991187639"; // WhatsApp do site de vendas (DDI 55 + DDD + número)
