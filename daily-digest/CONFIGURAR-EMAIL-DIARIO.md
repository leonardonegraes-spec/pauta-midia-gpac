# E-mail diário da pauta — configuração

O robô roda todo dia às 08:00 (horário de Brasília) sozinho, via GitHub Actions — não depende
de ninguém abrir o board. Faltam 3 coisas, todas guardadas como **segredos do repositório**
(nunca aparecem no código, nem em texto puro pra ninguém além de você).

## 1. E-mail de cada pessoa do time

Me manda aqui no chat o e-mail de cada um (Bella, Eduardo, Anna, Leonardo, Rejane) — não é
segredo, só preciso pra saber pra quem mandar.

## 2. Chave do Firebase (service account)

Isso deixa o robô ler o banco de dados sem precisar de login interativo.

1. Abra **https://console.firebase.google.com/project/pauta-midia-gpac/settings/serviceaccounts/adminsdk**
2. Clique **"Gerar nova chave privada"** (Generate new private key)
3. Confirme — um arquivo `.json` é baixado no seu computador
4. Abra esse arquivo com o Bloco de Notas, selecione tudo (Ctrl+A) e copie (Ctrl+C)
5. Me avise que copiou — eu te aviso onde colar (é o passo 4 abaixo)

**Importante:** esse arquivo dá acesso total ao banco. Depois de colar como segredo no GitHub,
apague o arquivo `.json` baixado do seu computador (ou guarde em lugar seguro, não solto na
área de trabalho).

## 3. Senha de app do Gmail

Isso deixa o robô mandar e-mail pela conta de e-mail que você escolher (pode ser a sua, ou
criar um e-mail tipo `pautademidia@gmail.com` só pra isso).

1. Na conta Google que vai enviar os e-mails, acesse **https://myaccount.google.com/apppasswords**
   - Se pedir para ativar verificação em duas etapas primeiro, ative em
     **https://myaccount.google.com/signinoptions/two-step-verification** (obrigatório para
     gerar senha de app).
2. Em "Nome do app", escreva `pauta-midia` → **Criar**
3. Copia a senha de 16 letras que aparece (sem espaços)

## 4. Cadastrar tudo como segredo no GitHub

Acesse **https://github.com/leonardonegraes-spec/pauta-midia-gpac/settings/secrets/actions**

Clique **"New repository secret"** e crie, um de cada vez:

| Nome exato do segredo | Valor |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | o conteúdo inteiro do arquivo `.json` do passo 2 |
| `TEAM_EMAILS` | `{"Bella":"email@...","Eduardo":"email@...","Anna":"email@...","Leonardo":"email@...","Rejane":"email@..."}` (troque pelos e-mails reais, mantendo essas aspas e chaves) |
| `GMAIL_USER` | o e-mail que vai enviar (ex: `pautademidia@gmail.com`) |
| `GMAIL_APP_PASSWORD` | a senha de 16 letras do passo 3 |

## 5. Testar sem esperar o dia seguinte

Depois de cadastrar os 4 segredos:
1. Acesse a aba **Actions** do repositório
2. Clique no workflow **"Envio diário da pauta por e-mail"** na lista à esquerda
3. Clique **"Run workflow"** → **Run workflow** (botão verde)
4. Espera uns 30 segundos e atualiza a página — se aparecer um ✔️ verde, os e-mails foram
   enviados. Se aparecer um ✕ vermelho, clica em cima do resultado pra ver o erro e me manda.
