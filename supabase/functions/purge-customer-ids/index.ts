import { createClient } from 'npm:@supabase/supabase-js@2'

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  const provided = req.headers.get('x-cron-secret') ?? ''
  const { data: expected, error: secretError } = await admin.rpc('get_customer_id_purge_secret')
  if (secretError || !expected || provided !== expected) return json({ error: 'unauthorized' }, 401)

  const { data: rows, error: listError } = await admin.rpc('list_expired_customer_ids')
  if (listError) return json({ error: 'list_failed' }, 500)

  let purged = 0
  const failed: string[] = []

  for (const row of rows ?? []) {
    const path = String(row.storage_path ?? '')
    if (!path) continue

    const { error: removeError } = await admin.storage.from('customer-id-files').remove([path])
    if (removeError) {
      failed.push(String(row.user_id))
      continue
    }

    const { error: markError } = await admin.rpc('mark_customer_id_purged', {
      p_user_id: row.user_id,
      p_storage_path: path,
    })
    if (markError) {
      failed.push(String(row.user_id))
      continue
    }
    purged++
  }

  return json({ purged, failed_count: failed.length })
})
