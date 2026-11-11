-- Écran shop Tesla - configuration Supabase
-- À coller une seule fois dans Supabase : SQL Editor → New query → Run.

-- 1. L'état de l'écran (une seule ligne)
create table if not exists public.screen (
  id int primary key default 1 check (id = 1),
  message jsonb,                                   -- { title, sub, at, until, by } ou null
  presets jsonb not null default '[]'::jsonb,      -- raccourcis
  media jsonb not null default '[]'::jsonb,        -- [{ path, type }] dans l'ordre du diaporama
  slide_seconds int not null default 8 check (slide_seconds between 3 and 120),
  test_drive_url text not null default 'https://www.tesla.com/fr_be/drive' check (test_drive_url ~ '^https://'),
  updated_at timestamptz not null default now()
);

insert into public.screen (id, presets) values (1, '[
  {"id":"p1","title":"Nous sommes en Test Drive","sub":"Installez-vous et découvrez nos véhicules en attendant.","minutes":10},
  {"id":"p2","title":"Nous sommes en Test Drive","sub":"Installez-vous et découvrez nos véhicules en attendant.","minutes":20},
  {"id":"p3","title":"Nous sommes en Test Drive","sub":"Installez-vous et découvrez nos véhicules en attendant.","minutes":30},
  {"id":"p4","title":"Nous sommes en Test Drive","sub":"Installez-vous et découvrez nos véhicules en attendant.","minutes":0},
  {"id":"p5","title":"De retour dans quelques instants","sub":"Merci de votre patience.","minutes":5},
  {"id":"p6","title":"De retour dans quelques instants","sub":"Merci de votre patience.","minutes":0},
  {"id":"p7","title":"Un conseiller arrive","sub":"Merci de patienter quelques instants.","minutes":0}
]'::jsonb) on conflict (id) do nothing;

create or replace function public.screen_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists screen_touch on public.screen;
create trigger screen_touch before update on public.screen for each row execute function public.screen_touch();

-- Heure du serveur, pour que la TV et les téléphones affichent le même compte à rebours
create or replace function public.server_now() returns timestamptz language sql stable as $$ select now() $$;
grant execute on function public.server_now() to anon, authenticated;

-- 2. Sécurité : tout le monde lit (la TV), seule l'équipe connectée modifie
alter table public.screen enable row level security;
drop policy if exists "lecture publique" on public.screen;
create policy "lecture publique" on public.screen for select using (true);
drop policy if exists "modification equipe" on public.screen;
create policy "modification equipe" on public.screen for update to authenticated using (true) with check (true);
revoke insert, delete, truncate on public.screen from anon, authenticated;
revoke update on public.screen from anon;

-- 3. Mise à jour instantanée sur les téléphones
do $$ begin
  alter publication supabase_realtime add table public.screen;
exception when duplicate_object then null; end $$;

-- 4. Photos et vidéos (50 Mo max par fichier sur le plan gratuit)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 52428800, array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "media lecture" on storage.objects;
create policy "media lecture" on storage.objects for select using (bucket_id = 'media');
drop policy if exists "media ajout equipe" on storage.objects;
create policy "media ajout equipe" on storage.objects for insert to authenticated with check (bucket_id = 'media');
drop policy if exists "media suppression equipe" on storage.objects;
create policy "media suppression equipe" on storage.objects for delete to authenticated using (bucket_id = 'media');
