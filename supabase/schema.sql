-- Stockage partagé du planning d'astreinte.
--
-- À coller une fois dans Supabase : SQL Editor → New query → Run.
--
-- Un planning = une ligne, identifiée par un « code d'équipe » long et
-- aléatoire, généré par l'application. Ce code sert de mot de passe : la
-- table n'est jamais lisible directement, seulement au travers des deux
-- fonctions ci-dessous, qui exigent le code.
--
-- `version` sert à détecter deux enregistrements simultanés : l'application
-- envoie la version qu'elle connaît ; si un collègue a enregistré entre-temps,
-- l'enregistrement est refusé et l'application fusionne les deux.

create table if not exists public.plans (
  team_code  text primary key check (length(team_code) >= 16),
  data       jsonb not null,
  version    integer not null default 1,
  updated_at timestamptz not null default now()
);

alter table public.plans enable row level security;
revoke all on public.plans from anon, authenticated;

create or replace function public.get_plan(p_code text)
returns table (plan jsonb, plan_version integer, plan_updated_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select p.data, p.version, p.updated_at from public.plans p where p.team_code = p_code;
$$;

create or replace function public.save_plan(p_code text, p_data jsonb, p_version integer)
returns table (ok boolean, plan_version integer, plan jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
  cur public.plans%rowtype;
begin
  if p_code is null or length(p_code) < 16 then
    raise exception 'code d''équipe invalide';
  end if;
  if octet_length(p_data::text) > 2000000 then
    raise exception 'planning trop volumineux';
  end if;

  select * into cur from public.plans p where p.team_code = p_code for update;

  if not found then
    insert into public.plans (team_code, data, version) values (p_code, p_data, 1);
    return query select true, 1, p_data;
  elsif cur.version <> p_version then
    -- Un collègue a enregistré entre-temps : on renvoie sa version.
    return query select false, cur.version, cur.data;
  else
    update public.plans p
       set data = p_data, version = cur.version + 1, updated_at = now()
     where p.team_code = p_code;
    return query select true, cur.version + 1, p_data;
  end if;
end;
$$;

revoke all on function public.get_plan(text) from public;
revoke all on function public.save_plan(text, jsonb, integer) from public;
grant execute on function public.get_plan(text) to anon, authenticated;
grant execute on function public.save_plan(text, jsonb, integer) to anon, authenticated;
