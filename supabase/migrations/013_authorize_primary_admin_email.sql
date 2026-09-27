create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_role public.user_role := 'customer';
begin
  if lower(coalesce(new.email,''))='bachir.ban@gmail.com' then
    v_role := 'admin';
  end if;

  insert into public.profiles(id,role,full_name,phone,email)
  values(
    new.id,
    v_role,
    coalesce(new.raw_user_meta_data->>'full_name',''),
    new.phone,
    new.email
  )
  on conflict(id) do update
    set role=case
      when lower(coalesce(new.email,''))='bachir.ban@gmail.com' then 'admin'::public.user_role
      else public.profiles.role
    end,
    email=coalesce(new.email,public.profiles.email),
    updated_at=now();

  return new;
end;
$$;

update public.profiles p
set role='admin',
    email=coalesce(p.email,'bachir.ban@gmail.com'),
    updated_at=now()
from auth.users u
where p.id=u.id
  and lower(coalesce(u.email,''))='bachir.ban@gmail.com';
