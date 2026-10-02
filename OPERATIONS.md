# 3annak Production Operations

## Health monitoring
- Admin dashboard shows operational health.
- Hourly job `3annak-ops-health-hourly` checks payment/order consistency, completed workflow state, hard-copy delivery state, agent earnings, overdue ID purges, purge-job failures, and missing Storage objects.
- Admins receive in-app alerts for detected issues. Repeated alerts are limited to once every 12 hours per issue type.
- Cron run history older than 30 days is removed weekly.

## Backups and recovery
Supabase database backups protect PostgreSQL data, subject to the project's Supabase plan and backup configuration.

Important: Supabase database backups do **not** include the actual files stored in Supabase Storage. The database contains only their metadata.

Before public launch:
1. Confirm the project's available database backup/restore window in Supabase Dashboard > Database > Backups.
2. Decide whether Point-in-Time Recovery is needed for the production volume/risk level.
3. Configure an independent backup destination for `order-files` and `agent-files`. Do not use a public Git repository for customer documents.
4. Keep `customer-id-files` under the existing 90-day retention policy rather than creating long-lived copies that defeat the retention rule.
5. Perform a restore drill before launch or shortly after launch: restore/clone the database into an isolated environment, disable outbound cron/network jobs there, and verify orders/payments/auth metadata.
6. Document who is authorized to initiate a production restore.

## Recovery caveats
- Restoring a database does not restore Storage objects deleted after the backup.
- Edge Functions, Auth settings, Storage configuration, API keys, and some project-level settings may require separate reconfiguration in a cloned/recovered project.
- Disable external-action cron jobs on any restored clone before testing it.
