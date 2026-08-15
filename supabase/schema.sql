-- =========================================================
-- Procasais Web — Schema do banco (Supabase / PostgreSQL)
-- Módulo Cadastros — multiusuário com isolamento estrito por usuário
--
-- Como rodar: Supabase → seu projeto → SQL Editor → cole este arquivo → Run.
-- Pode rodar quantas vezes quiser (tudo usa IF NOT EXISTS / OR REPLACE).
-- =========================================================

-- ---------------------------------------------------------
-- 1) Tabelas do módulo Cadastros
--    Todas (exceto os catálogos fixos) têm:
--      - user_id: preenchido AUTOMATICAMENTE com o usuário logado (auth.uid())
--      - RLS: cada usuário só enxerga / altera / apaga as próprias linhas
-- ---------------------------------------------------------

create table if not exists diocese (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nome text, bispo text, endereco text, cidade text, estado text, telefone text, email text,
  created_at timestamptz not null default now()
);

create table if not exists paroquia (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nome text, diocese text, endereco text, cidade text, estado text, paroco text, telefone text, email text,
  created_at timestamptz not null default now()
);

create table if not exists sacerdotes (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nome text, endereco text, telefone text, email text,
  created_at timestamptz not null default now()
);

create table if not exists jovens (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nome text, endereco text, telefone text, email text,
  created_at timestamptz not null default now()
);

create table if not exists viuvos (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nome text, endereco text, telefone text, email text,
  created_at timestamptz not null default now()
);

create table if not exists circulos (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  cor text,
  created_at timestamptz not null default now()
);

create table if not exists habilidades (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nome text,
  created_at timestamptz not null default now()
);

create table if not exists casais (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  diocese text, cidade_sede text, paroquia text,
  nome_esposo text, apelido_esposo text, nasc_esposo text, celular_esposo text, profissao_esposo text, email_esposo text,
  nome_esposa text, apelido_esposa text, nasc_esposa text, celular_esposa text, tel_proximo text, profissao_esposa text, email_esposa text,
  casamento_data text, situacao text, habilidade text,
  cep text, endereco_residencial text, bairro text, cidade text, estado text,
  encontro1 text, etapa1 text, data1 text, local1 text, circulo1 text, coordenadores1 text,
  encontro2 text, etapa2 text, data2 text, local2 text, circulo2 text, coordenadores2 text,
  encontro3 text, etapa3 text, data3 text, local3 text, circulo3 text, coordenadores3 text,
  created_at timestamptz not null default now()
);

create table if not exists funcoes (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  apelido_ele text, apelido_ela text, equipe text, encontro text, etapa text, coordenou text,
  created_at timestamptz not null default now()
);

create table if not exists dirigentes (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  apelido_ele text, apelido_ela text, funcao_dirigente text, periodo text, etapa text,
  created_at timestamptz not null default now()
);

create table if not exists palestras (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  sacerdote text, apelido_ele text, apelido_ela text, encontro text, etapa text, palestra text,
  created_at timestamptz not null default now()
);

create table if not exists testemunhos (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  jovem text, viuvo text, apelido_ele text, apelido_ela text, encontro text, etapa text, testemunho text,
  created_at timestamptz not null default now()
);

-- Catálogos fixos (títulos de Palestras/Testemunhos por etapa) — compartilhados entre
-- todos os usuários, iguais ao sistema original. Todo usuário logado pode LER;
-- só o painel do Supabase (ou um admin futuro) edita.
create table if not exists palestras_catalogo (
  id bigint generated always as identity primary key,
  titulo text, etapa text
);

create table if not exists testemunhos_catalogo (
  id bigint generated always as identity primary key,
  titulo text, etapa text
);

-- Utilidades: Agenda de Compromissos e Controle de Caixa
create table if not exists agenda (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nome text, descricao text, data_inicial text, hora_inicial text, data_final text, hora_final text,
  created_at timestamptz not null default now()
);

create table if not exists caixa (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  tipo text, data text, descricao text, valor numeric,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------
-- 2) Row Level Security — isolamento estrito por usuário
-- ---------------------------------------------------------
do $$
declare
  t text;
begin
  for t in select unnest(array[
    'diocese','paroquia','sacerdotes','jovens','viuvos','circulos','habilidades',
    'casais','funcoes','dirigentes','palestras','testemunhos','agenda','caixa'
  ])
  loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists "select_own" on %I;', t);
    execute format('create policy "select_own" on %I for select using (auth.uid() = user_id);', t);
    execute format('drop policy if exists "insert_own" on %I;', t);
    execute format('create policy "insert_own" on %I for insert with check (auth.uid() = user_id);', t);
    execute format('drop policy if exists "update_own" on %I;', t);
    execute format('create policy "update_own" on %I for update using (auth.uid() = user_id) with check (auth.uid() = user_id);', t);
    execute format('drop policy if exists "delete_own" on %I;', t);
    execute format('create policy "delete_own" on %I for delete using (auth.uid() = user_id);', t);
  end loop;
end $$;

-- Catálogos: RLS ligado, mas com política de leitura para qualquer usuário autenticado
alter table palestras_catalogo enable row level security;
drop policy if exists "select_all_logged" on palestras_catalogo;
create policy "select_all_logged" on palestras_catalogo for select using (auth.role() = 'authenticated');

alter table testemunhos_catalogo enable row level security;
drop policy if exists "select_all_logged" on testemunhos_catalogo;
create policy "select_all_logged" on testemunhos_catalogo for select using (auth.role() = 'authenticated');

-- ---------------------------------------------------------
-- 3) Diocese e Paróquia: no sistema original só existe 1 registro no banco inteiro.
--    Aqui, o equivalente correto é 1 registro POR USUÁRIO (cada usuário tem sua
--    própria Diocese/Paróquia). Isso é reforçado também pela tela (ver app.js),
--    mas a constraint abaixo garante no banco.
-- ---------------------------------------------------------
create unique index if not exists diocese_unica_por_usuario on diocese(user_id);
create unique index if not exists paroquia_unica_por_usuario on paroquia(user_id);

-- ---------------------------------------------------------
-- 4) Catálogos fixos — dados iniciais (mesmos do sistema local), só insere se vazio
-- ---------------------------------------------------------
insert into palestras_catalogo (titulo, etapa)
select * from (values
  ('Palestra Plano de Deus','1ª'),('Palestra Harmonia Conjugal','1ª'),('Palestra Diálogo com os Filhos','1ª'),
  ('Palestra Penitência','1ª'),('Palestra Nossa Senhora na Vida da Família','1ª'),('Palestra Ceia Eucarística','1ª'),
  ('Palestra Fé nos Revezes da Vida','1ª'),('Palestra Sentido da Vida','1ª'),('Palestra Oração','1ª'),
  ('Palestra Corresponsabilidade','1ª'),('Palestra A Vivência do Sacramento do Matrimônio','1ª'),
  ('Palestra O Casal Cristão no Mundo de Hoje','1ª'),
  ('Palestra Missão de Jesus Cristo','2ª'),('Palestra Igreja Comunidade de Salvação','2ª'),
  ('Palestra Família Formadora da Igreja','2ª'),('Palestra Magistério da Igreja','2ª'),
  ('Palestra Diretrizes Pastorais do Episcopado Nacional','2ª'),('Palestra Oração e Meditação','2ª'),
  ('Palestra Sacramentos da Iniciação Cristã','2ª'),('Palestra Pecado e Inferno','2ª'),
  ('Palestra Corresponsabilidade','2ª'),('Palestra Painel Sobre as Pastorais','2ª'),
  ('Palestra Fé e Esperança','2ª'),('Palestra A Família na Construção do Mundo','2ª'),
  ('Palestra A Realidade do Mundo à Luz dos Documentos da Igreja','3ª'),('Palestra A Dignidade da Pessoa Humana','3ª'),
  ('Palestra A Doutrina Social da Igreja','3ª'),('Palestra Justiça Social, Responsabilidade do Cristão','3ª'),
  ('Palestra A Família Renovadora do Mundo','3ª'),('Palestra Pessoas Engajadas na Justiça Social','3ª'),
  ('Palestra Jesus Cristo e o Projeto do Reino Consumado na Eucaristia','3ª')
) as v(titulo, etapa)
where not exists (select 1 from palestras_catalogo);

insert into testemunhos_catalogo (titulo, etapa)
select * from (values
  ('Testemunho Plano de Deus','1ª'),('Testemunho Jovem Vocacionado','1ª'),
  ('Testemunho Ceia Eucarística','1ª'),('Testemunho Sobre Viuvez','2ª')
) as v(titulo, etapa)
where not exists (select 1 from testemunhos_catalogo);
