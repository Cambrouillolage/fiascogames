-- Chat de règles GAV : stockage des conversations + lecture réservée à l'admin.
-- Aucune policy d'écriture n'est créée pour anon/authenticated : seule
-- l'Edge Function "gav-chat" (clé service role, qui contourne RLS) écrit
-- dans ces tables. Voir supabase/functions/gav-chat/index.ts.

create extension if not exists pgcrypto;

create table public.conversations (
  id uuid primary key,
  game text not null default 'gav',
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  message_count int not null default 0,
  client_ip inet,
  user_agent text,
  status text not null default 'active'
);

create table public.messages (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

create index messages_conversation_id_created_at_idx
  on public.messages (conversation_id, created_at);

create index conversations_game_last_message_at_idx
  on public.conversations (game, last_message_at desc);

create index conversations_client_ip_created_at_idx
  on public.conversations (client_ip, created_at);

alter table public.conversations enable row level security;
alter table public.messages enable row level security;

-- Seul le compte admin (florian@fiascogames.fr) peut lire les conversations
-- et messages, via l'espace gav/admin/. Tout le reste (anon compris) n'a
-- accès à rien : ni lecture ni écriture directe sur ces tables.
create policy "admin can read conversations"
  on public.conversations for select
  to authenticated
  using (auth.jwt() ->> 'email' = 'florian@fiascogames.fr');

create policy "admin can read messages"
  on public.messages for select
  to authenticated
  using (auth.jwt() ->> 'email' = 'florian@fiascogames.fr');
