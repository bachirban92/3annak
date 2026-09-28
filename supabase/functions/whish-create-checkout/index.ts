import { createClient } from 'npm:@supabase/supabase-js@2'

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return json({ error: 'unauthorized' }, 401)

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } },
  )

  const token = authHeader.slice(7)
  const { data: authData, error: authError } = await supabase.auth.getUser(token)
  if (authError || !authData.user) return json({ error: 'unauthorized' }, 401)

  let body: { order_id?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }

  const orderId = String(body.order_id ?? '').trim()
  if (!orderId) return json({ error: 'order_id_required' }, 400)

  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('id,customer_id,assigned_agent_id,total_amount,status')
    .eq('id', orderId)
    .single()

  if (orderError || !order || order.customer_id !== authData.user.id) {
    return json({ error: 'order_not_found' }, 404)
  }

  if (!order.assigned_agent_id) return json({ error: 'agent_not_assigned' }, 409)
  if (Number(order.total_amount ?? 0) <= 0) return json({ error: 'payment_not_required' }, 409)

  const { data: payments, error: paymentError } = await supabase
    .from('payments')
    .select('id,status')
    .eq('order_id', orderId)
    .order('created_at', { ascending: false })
    .limit(1)

  if (paymentError) return json({ error: 'payment_lookup_failed' }, 500)
  if (payments?.[0]?.status === 'paid') return json({ error: 'already_paid' }, 409)

  // Intentionally inert until Whish provides official merchant credentials and API documentation.
  // No provider request is made and no payment state is changed here.
  return json({ error: 'whish_not_configured' }, 503)
})
