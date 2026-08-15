# Procasais Web

Versão **multiusuário** do sistema de gestão do Encontro de Casais.
Cada pessoa cria sua própria conta e só enxerga/edita/apaga os registros que
ela mesma cadastrou — mesmo que outra pessoa da mesma paróquia também use o
sistema. O isolamento é garantido **no banco de dados** (Postgres + Row Level
Security do Supabase), não apenas na tela — ou seja, não tem como um usuário
acessar dado de outro nem manipulando a URL ou a API diretamente.

**Etapa atual: sistema completo** — Cadastros, Buscas, Funções, Datas e
Utilidades (Recibo, Agenda, Caixa, Subsídios, Painel), tudo multiusuário,
idêntico em telas e regras ao sistema local.

## Status atual deste projeto

✅ **Já provisionado automaticamente**, via conector Supabase:
- Projeto: **Sistema Procasais Web** (região `sa-east-1`, ref `crbuvppytbssdjsuucny`)
- As 12 tabelas do módulo Cadastros criadas, com RLS habilitado e 48 políticas
  (select/insert/update/delete "somente próprio usuário") conferidas uma a uma
- Catálogos de Palestras (31 itens) e Testemunhos (4 itens) já semeados
- Checagem de segurança do Supabase (`get_advisors`) rodada: **nenhum alerta**
- `public/config.js` já preenchido com a Project URL e a chave pública (`anon`/`publishable`) reais

⚠️ **Ainda precisa ser feito manualmente** (por segurança, o Supabase não expõe
isso por API para nenhum conector — nem para mim):
1. Pegar a **service role key** em Project Settings → API → "service_role"
   (secret) e colar no seu `.env` local, junto com `ADMIN_EMAILS`
2. Configurar as credenciais **SMTP** no `.env` (envio de e-mail é serviço à parte, não é do Supabase)
3. Criar sua própria conta de administrador em Authentication → Users → Add user, e colocar esse e-mail em `ADMIN_EMAILS`
4. Em Authentication → URL Configuration, adicionar a URL onde o site vai
   rodar em "Redirect URLs" (para o link de troca de senha funcionar)

## Como funciona

- **Frontend**: HTML/CSS/JS puro (sem build), igual ao sistema original.
- **Backend/Banco**: [Supabase](https://supabase.com) — Postgres gerenciado +
  autenticação por e-mail/senha + Row Level Security.
- **server.js**: agora é um pequeno backend Node/Express com **uma única
  rota protegida** (`/api/admin/criar-usuario`), usada pela tela oculta de
  cadastro de usuários. Guarda a *service role key* do Supabase e as
  credenciais de SMTP — nunca ficam expostas no navegador.

## Cadastro de usuários (só o administrador)

Não existe mais autocadastro público. Só quem tem acesso à página oculta
**`/admin.html`** (não aparece em nenhum menu do sistema) consegue criar
novos usuários, e mesmo assim só se o e-mail logado estiver na lista
`ADMIN_EMAILS` do `.env` — essa checagem acontece no servidor, então não dá
para burlar mesmo sabendo a URL da página.

Fluxo do formulário:
1. Administrador preenche **Nome**, **Telefone**, **E-mail (login)**.
2. O campo **Senha** já vem preenchido com 6 caracteres aleatórios
   (letras minúsculas + números) — dá pra gerar outra com "🎲 Gerar" ou
   ver/ocultar com "👁 Ver".
3. Ao clicar **Cadastrar**: o usuário é criado no Supabase já com essa senha
   e a senha é enviada por e-mail para o endereço cadastrado. O botão
   **Cancelar** só limpa o formulário.

Como o próprio administrador precisa existir antes de poder cadastrar
qualquer um pelo formulário, crie a **sua** conta direto pelo painel do
Supabase (Authentication → Users → Add user, com e-mail e senha à sua
escolha) e coloque esse e-mail em `ADMIN_EMAILS`.

## Trocar senha (qualquer usuário)

Na tela de login, o link **"Esqueci minha senha"** pede o e-mail e envia um
link de redefinição (via Supabase Auth). O link abre `/reset.html`, onde a
pessoa define a nova senha.

⚠️ **Atenção — dois sistemas de e-mail diferentes:** a senha inicial (do
cadastro em `/admin.html`) é enviada pelo **nosso servidor** (`.env` →
`SMTP_*`). Já o link de "esqueci minha senha" é enviado **pelo próprio
Supabase**, que tem sua própria configuração de SMTP, separada, em
Project Settings → Authentication → Emails → SMTP Settings. Sem configurar
o SMTP *dentro do Supabase*, o serviço de e-mail padrão dele só entrega
mensagens para e-mails que fazem parte da sua equipe (Team) na Supabase —
qualquer outro endereço falha silenciosamente (por design, para não revelar
quais e-mails existem no banco). Configure os dois lugares com as mesmas
credenciais SMTP para tudo funcionar.

## Configuração restante (única, manual — só o que exige acesso ao painel)

Os passos de criar o projeto, rodar o `schema.sql` e preencher a URL/chave
pública **já foram feitos automaticamente** (ver "Status atual" acima). Só
falta:

1. Acesse https://supabase.com/dashboard/project/crbuvppytbssdjsuucny →
   **Project Settings → API** → copie a **service_role key** (em "Project
   API keys", clique para revelar).
2. Copie `.env.example` para `.env` e preencha:
   - `SUPABASE_URL=https://crbuvppytbssdjsuucny.supabase.co`
   - `SUPABASE_SERVICE_ROLE_KEY` (do passo 1)
   - `ADMIN_EMAILS` com o(s) e-mail(s) que poderão acessar `/admin.html`
   - `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM`,
     com as credenciais de um provedor de e-mail (Gmail com "senha de app",
     Brevo, SendGrid, Amazon SES, etc.) — é por aí que a senha inicial e o
     link de troca de senha são enviados.
3. Em **Authentication → URL Configuration**, adicione a URL onde o site vai
   rodar (ex.: `http://localhost:3000` em desenvolvimento, ou o domínio
   final em produção) em "Redirect URLs", para o link de troca de senha
   funcionar.
4. No mesmo projeto, crie sua própria conta de administrador em
   **Authentication → Users → Add user** e adicione esse e-mail em
   `ADMIN_EMAILS` no `.env`.

## Rodando localmente

```bash
npm install
npm start
```

Acesse `http://localhost:3000` para o login normal, ou
`http://localhost:3000/admin.html` (logado como administrador) para
cadastrar novos usuários.

## Publicando na internet

Agora o `server.js` é um backend de verdade (guarda a service role key e as
credenciais de SMTP), então precisa rodar em um serviço que execute Node.js
com variáveis de ambiente configuráveis — Render, Railway, Fly.io, um VPS
próprio, etc. Configure lá as mesmas variáveis do `.env`. Não é possível
publicar isso em uma hospedagem puramente estática (Netlify/GitHub Pages)
por causa da rota `/api/admin/criar-usuario`.

## Estrutura do projeto

```
procasais-web/
├── public/
│   ├── index.html      → tela de login + "esqueci minha senha"
│   ├── admin.html        → página OCULTA (não linkada em lugar nenhum):
│   │                        cadastro de usuários pelo administrador
│   ├── reset.html         → página que abre a partir do link de e-mail,
│   │                        para definir a nova senha
│   ├── styles.css         → visual (idêntico ao sistema local)
│   ├── app.js              → toda a lógica das telas de Cadastros
│   └── config.js           → URL + anon key do seu projeto Supabase (públicas)
├── supabase/
│   └── schema.sql          → script único: cria tabelas + regras de isolamento
├── server.js                → backend: static files + rota admin protegida
├── .env.example              → modelo das variáveis secretas do servidor
└── package.json
```

## Próximas etapas (fora do escopo desta entrega)

- Importador de dados legados (Access/Excel) para o Supabase
- Recomendação de segurança opcional: em **Authentication → Policies** do
  Supabase, ativar "Leaked Password Protection" (verifica senhas vazadas
  contra o HaveIBeenPwned antes de aceitar o cadastro/troca de senha)
