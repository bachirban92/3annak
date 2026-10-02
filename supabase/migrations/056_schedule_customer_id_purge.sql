create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if not exists(select 1 from vault.decrypted_secrets where name='customer_id_purge_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'customer_id_purge_secret');
  end if;
end $$;

select cron.schedule(
  'purge-customer-id-files-daily',
  '30 2 * * *',
  $job$
  select net.http_post(
    url := 'https://runerfftltmjlzvacjua.supabase.co/functions/v1/purge-customer-ids',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='customer_id_purge_secret')
    ),
    body := jsonb_build_object('source','cron'),
    timeout_milliseconds := 10000
  );
  $job$
);
