# Pauta de Mídia — versão GitHub (sem conta Claude)

Mesmo board/app que já existia (calendário, arrastar pauta, campanha livre, praças editáveis),
só que hospedado como página estática no GitHub Pages e usando **Firebase Firestore** (gratuito)
como banco compartilhado no lugar do banco do Claude — assim ninguém do time precisa criar
conta em nada além do que já é pedido aqui.

## Passo 1 — Criar o projeto Firebase (~5 minutos, só você precisa fazer isso uma vez)

1. Acesse **console.firebase.google.com** e entre com uma conta Google (pode ser a da GPAC).
2. **Adicionar projeto** → dê um nome (ex: `pauta-midia-gpac`) → pode desativar o Google
   Analytics (não é necessário) → **Criar projeto**.
3. No menu lateral, vá em **Compilação → Firestore Database** → **Criar banco de dados**.
   - Escolha uma localização (ex: `southamerica-east1` / São Paulo).
   - Em "regras de segurança", escolha **modo de teste** por enquanto (deixamos as regras
     definitivas no passo 3 abaixo).
4. Volte para a página inicial do projeto (ícone de casa) → clique no ícone **`</>`** (Web) para
   registrar um app da Web.
   - Dê um apelido (ex: `pauta-web`) → **não** precisa marcar Firebase Hosting.
   - Copie o bloco `firebaseConfig` que aparece (algo como `{ apiKey: "...", authDomain: "...", ... }`).

## Passo 2 — Colar a configuração no arquivo

Abra `index.html` e substitua o bloco no topo do `<script type="module">`:

```js
const firebaseConfig = {
  apiKey: "COLE_AQUI_SUA_API_KEY",
  authDomain: "COLE_AQUI.firebaseapp.com",
  projectId: "COLE_AQUI",
  storageBucket: "COLE_AQUI.appspot.com",
  messagingSenderId: "COLE_AQUI",
  appId: "COLE_AQUI"
};
```

pelos valores reais que o Firebase te deu. Esses valores **não são secretos** — foram feitos
para ir no código do site (a segurança de verdade vem das regras do Firestore, passo 3).

## Passo 3 — Regras do Firestore (define quem pode ler/escrever)

No Firestore, aba **Regras**, cole:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
```

Isso deixa o banco aberto para qualquer pessoa que tenha o link do site — igual ao
funcionamento do board original (qualquer um com o link edita). Se um dia quiser travar mais,
dá para trocar por autenticação, mas para o time de 5 pessoas isso não costuma valer a pena.

## Passo 4 — Subir no GitHub Pages

1. Crie um repositório no GitHub (pode ser privado ou público — o conteúdo do board não é
   sensível, mas privado funciona igual no GitHub Pages de contas Pro/organização; em conta
   free o Pages só funciona com repositório **público**).
2. Suba o arquivo `index.html` (o desta pasta, já com sua configuração colada) para a **raiz**
   do repositório.
3. Vá em **Settings → Pages** do repositório → em "Branch", escolha `main` (ou a branch que
   você usou) e pasta `/ (root)` → Salvar.
4. Em alguns minutos o GitHub mostra o link, algo como
   `https://SEU-USUARIO.github.io/NOME-DO-REPO/`.

## Passo 5 — Compartilhar com o time

Mande esse link para Bella, Eduardo, Anna, Leonardo e Rejane. Não precisam de conta em nada —
é uma página normal, abre em qualquer navegador, celular incluso, e as edições sincronizam
para todo mundo em tempo real.

## Se algo não funcionar

Abra o Console do navegador (F12 → aba Console) na página publicada — qualquer erro de
configuração do Firebase aparece ali. Me mande o texto do erro que eu ajudo a resolver.
