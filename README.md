# عنّك (3annak)

منصة لمعاملات ومستندات العقارات في لبنان: العميل يرسل الطلب، وكيل مستقل مؤهل يقبله، ثم يتابع العميل المراحل ويستلم الملفات.

## Production foundation
- Supabase project: `runerfftltmjlzvacjua`
- Frontend: Vite + vanilla JS
- Customer access: invisible anonymous Supabase session; customer only enters contact email/phone, with no verification step during testing.
- Staff/agent authentication can be added separately before public launch.
- Storage: private bucket `order-files`
- Security: RLS على كل جداول العمل + RPCs للعمليات الحساسة.
- Roles: customer / agent / admin.
- Agent marketplace: fixed payout, no bidding, atomic first-accept.
- Tracking: submitted → accepted → in progress → authority → processing → collection → completed.
- Finance schema: payments, official expenses, agent ledger, payouts.
- Operations: ratings, disputes, notifications, audit log, service pricing and agent verification.

## Run
```bash
npm install
npm run dev
```

## Build
```bash
npm run build
```

## Environment
The app can run with the checked-in Supabase publishable key. For another environment use:
```
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
```
Never commit a Supabase secret/service-role key.

## Before public launch
1. Enable **Anonymous Sign-Ins** in Supabase Authentication → Providers for frictionless customer testing.
2. Create a separate protected admin/agent login flow before public launch.
3. Choose payment provider and implement its server-side webhook before accepting real payments.
4. Add CAPTCHA/Turnstile before public anonymous traffic.
5. Add privacy policy / terms and operational SLA.
6. Run an end-to-end test with one customer and one approved agent.
