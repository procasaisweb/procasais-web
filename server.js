/* Procasais Web — servidor
   - Serve os arquivos estáticos de /public
   - Expõe UMA rota protegida (/api/admin/criar-usuario) que só o
     administrador consegue usar, para cadastrar novos usuários com
     senha inicial já definida e enviá-la por e-mail.

   IMPORTANTE: a service_role key do Supabase e as credenciais de SMTP só
   existem aqui no servidor (via .env) — nunca são enviadas ao navegador. */
require('dotenv').config();
const path = require('path');
const express = require('express');
const nodemailer = require('nodemailer');
const { createClient } = require('@supabase/supabase-js');

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  ADMIN_EMAILS,
  SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM,
  PORT
} = process.env;

const camposObrigatorios = { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ADMIN_EMAILS };
const faltando = Object.entries(camposObrigatorios).filter(([, v]) => !v).map(([k]) => k);
if (faltando.length) {
  console.warn(`[aviso] Variáveis de ambiente não configuradas: ${faltando.join(', ')}. ` +
    'Copie ".env.example" para ".env" e preencha antes de usar o cadastro de usuários.');
}

// Cliente Supabase com privilégios de administrador (só roda no servidor)
const supaAdmin = (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
  : null;

const adminEmailList = (ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);

let mailer = null;
if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
  mailer = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT || 587),
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Atalhos sem ".html", pra não precisar decorar o nome exato do arquivo
app.get('/admin', (req, res) => res.redirect('/admin.html'));
app.get('/reset', (req, res) => res.redirect('/reset.html'));

/* ---------- middleware: exige token válido de um e-mail administrador ---------- */
async function exigirAdmin(req, res, next) {
  try {
    if (!supaAdmin) return res.status(500).json({ erro: 'Servidor não configurado (ver .env).' });
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ erro: 'Não autenticado.' });

    const { data, error } = await supaAdmin.auth.getUser(token);
    if (error || !data?.user) return res.status(401).json({ erro: 'Sessão inválida.' });

    const email = (data.user.email || '').toLowerCase();
    if (!adminEmailList.includes(email)) {
      return res.status(403).json({ erro: 'Apenas o administrador pode cadastrar usuários.' });
    }
    req.adminUser = data.user;
    next();
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao validar sessão.' });
  }
}

/* ---------- GET /api/admin/usuarios — lista todos os usuários ---------- */
app.get('/api/admin/usuarios', exigirAdmin, async (req, res) => {
  try {
    const usuarios = [];
    let page = 1;
    const perPage = 200;
    // pagina até acabar (listUsers devolve no máx. perPage por vez)
    while (true) {
      const { data, error } = await supaAdmin.auth.admin.listUsers({ page, perPage });
      if (error) return res.status(400).json({ erro: error.message });
      usuarios.push(...data.users.map(u => ({
        id: u.id,
        nome: u.user_metadata?.nome || '',
        telefone: u.user_metadata?.telefone || '',
        email: u.email,
        criado_em: u.created_at,
        ultimo_acesso: u.last_sign_in_at,
        bloqueado: !!(u.banned_until && new Date(u.banned_until) > new Date())
      })));
      if (data.users.length < perPage) break;
      page++;
    }
    usuarios.sort((a, b) => (a.nome || a.email).localeCompare(b.nome || b.email, 'pt-BR'));
    res.json(usuarios);
  } catch (err) {
    res.status(500).json({ erro: err.message || 'Erro ao listar usuários.' });
  }
});

/* ---------- POST /api/admin/usuarios/:id/bloqueio — bloqueia/libera o acesso ---------- */
app.post('/api/admin/usuarios/:id/bloqueio', exigirAdmin, async (req, res) => {
  if (req.params.id === req.adminUser.id) {
    return res.status(400).json({ erro: 'Você não pode bloquear a própria conta de administrador.' });
  }
  const { bloqueado } = req.body || {};
  try {
    // ban_duration nativo do Supabase: impede o login de fato (não é só
    // esconder na tela) — '876000h' ≈ 100 anos, 'none' remove o bloqueio.
    const { error } = await supaAdmin.auth.admin.updateUserById(req.params.id, {
      ban_duration: bloqueado ? '876000h' : 'none'
    });
    if (error) return res.status(400).json({ erro: error.message });
    res.json({ ok: true, bloqueado: !!bloqueado });
  } catch (err) {
    res.status(500).json({ erro: err.message || 'Erro ao alterar bloqueio.' });
  }
});

/* ---------- PUT /api/admin/usuarios/:id — edita nome/telefone/e-mail ---------- */
app.put('/api/admin/usuarios/:id', exigirAdmin, async (req, res) => {
  const { nome, telefone, email } = req.body || {};
  if (!nome || !telefone || !email) {
    return res.status(400).json({ erro: 'Preencha nome, telefone e e-mail.' });
  }
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    return res.status(400).json({ erro: 'E-mail inválido.' });
  }
  try {
    const { error } = await supaAdmin.auth.admin.updateUserById(req.params.id, {
      email,
      email_confirm: true,
      user_metadata: { nome, telefone }
    });
    if (error) return res.status(400).json({ erro: error.message });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ erro: err.message || 'Erro ao editar usuário.' });
  }
});

/* ---------- POST /api/admin/usuarios/:id/redefinir-senha — gera nova senha e envia por e-mail ---------- */
app.post('/api/admin/usuarios/:id/redefinir-senha', exigirAdmin, async (req, res) => {
  const { senha } = req.body || {};
  if (!senha || String(senha).length < 6) {
    return res.status(400).json({ erro: 'Senha deve ter ao menos 6 caracteres.' });
  }
  try {
    const { data, error } = await supaAdmin.auth.admin.updateUserById(req.params.id, { password: senha });
    if (error) return res.status(400).json({ erro: error.message });

    let emailEnviado = false;
    if (mailer && data.user?.email) {
      try {
        await mailer.sendMail({
          from: SMTP_FROM || SMTP_USER,
          to: data.user.email,
          subject: 'Sua senha foi redefinida — Procasais Web',
          text: `Olá!\n\nSua senha de acesso ao Procasais Web foi redefinida pelo administrador.\n\nE-mail de login: ${data.user.email}\nNova senha: ${senha}\n\n— Procasais Web`,
          html: `<p>Olá!</p><p>Sua senha de acesso ao <strong>Procasais Web</strong> foi redefinida pelo administrador.</p>
                 <p><strong>E-mail de login:</strong> ${data.user.email}<br><strong>Nova senha:</strong> ${senha}</p>`
        });
        emailEnviado = true;
      } catch (mailErr) {
        console.error('Falha ao enviar e-mail:', mailErr.message);
      }
    }
    res.json({ ok: true, emailEnviado });
  } catch (err) {
    res.status(500).json({ erro: err.message || 'Erro ao redefinir senha.' });
  }
});

/* ---------- DELETE /api/admin/usuarios/:id — exclui usuário ---------- */
app.delete('/api/admin/usuarios/:id', exigirAdmin, async (req, res) => {
  if (req.params.id === req.adminUser.id) {
    return res.status(400).json({ erro: 'Você não pode excluir a própria conta de administrador por aqui.' });
  }
  try {
    const { error } = await supaAdmin.auth.admin.deleteUser(req.params.id);
    if (error) return res.status(400).json({ erro: error.message });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ erro: err.message || 'Erro ao excluir usuário.' });
  }
});

/* ---------- POST /api/admin/criar-usuario ---------- */
app.post('/api/admin/criar-usuario', exigirAdmin, async (req, res) => {
  const { nome, telefone, email, senha } = req.body || {};

  if (!nome || !telefone || !email || !senha) {
    return res.status(400).json({ erro: 'Preencha nome, telefone, e-mail e senha.' });
  }
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    return res.status(400).json({ erro: 'E-mail inválido.' });
  }
  if (String(senha).length < 6) {
    return res.status(400).json({ erro: 'Senha deve ter ao menos 6 caracteres.' });
  }

  try {
    const { data, error } = await supaAdmin.auth.admin.createUser({
      email,
      password: senha,
      email_confirm: true, // já entra confirmado: a pessoa recebe a senha por e-mail e loga direto
      user_metadata: { nome, telefone }
    });
    if (error) return res.status(400).json({ erro: error.message });

    let emailEnviado = false;
    if (mailer) {
      try {
        await mailer.sendMail({
          from: SMTP_FROM || SMTP_USER,
          to: email,
          subject: 'Seu acesso ao Procasais Web',
          text: `Olá, ${nome}!\n\nSeu acesso ao Procasais Web foi criado.\n\nE-mail de login: ${email}\nSenha inicial: ${senha}\n\nRecomendamos trocar a senha no primeiro acesso, usando a opção "Esqueci minha senha" na tela de login.\n\n— Procasais Web`,
          html: `<p>Olá, <strong>${nome}</strong>!</p>
                 <p>Seu acesso ao <strong>Procasais Web</strong> foi criado.</p>
                 <p><strong>E-mail de login:</strong> ${email}<br>
                 <strong>Senha inicial:</strong> ${senha}</p>
                 <p>Recomendamos trocar a senha no primeiro acesso, usando a opção
                 "Esqueci minha senha" na tela de login.</p>`
        });
        emailEnviado = true;
      } catch (mailErr) {
        console.error('Falha ao enviar e-mail:', mailErr.message);
      }
    }

    res.json({ ok: true, usuario: { id: data.user.id, email }, emailEnviado });
  } catch (err) {
    res.status(500).json({ erro: err.message || 'Erro ao criar usuário.' });
  }
});

const porta = PORT || 3000;
app.listen(porta, () => {
  console.log(`Procasais Web rodando em http://localhost:${porta}`);
});
