create or replace function public.update_my_profile(
  p_full_name text,
  p_phone text,
  p_locale text default 'ar',
  p_email text default null
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare v_profile public.profiles;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  update public.profiles
  set full_name = nullif(trim(p_full_name),''),
      phone = nullif(trim(p_phone),''),
      email = nullif(trim(p_email),''),
      locale = case when p_locale in ('ar','en','fr') then p_locale else 'ar' end
  where id = auth.uid()
  returning * into v_profile;
  return v_profile;
end;
$$;

revoke execute on function public.update_my_profile(text,text,text,text) from public,anon;
grant execute on function public.update_my_profile(text,text,text,text) to authenticated;
