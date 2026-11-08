-- Deletes ALL tenant data from the LOCAL database: every tenant, user, contact, campaign and import.
-- Kept: the tables, the migration history (d1_migrations), and the `access` table (Administrator,
-- Campaign Manager, Viewer), which is reference data seeded by a migration, not tenant data.
--
-- Run with:  npm run db:clear:local     (afterwards: npm run db:seed:tenant:local recreates the default tenant)
-- Or in one step:  npm run db:reset:local
-- Those scripts pass --local, so they can only ever touch the simulated database in .wrangler/.
-- Children first, so no foreign key is ever violated.
DELETE FROM import_rows;
DELETE FROM campaign_recipients;
DELETE FROM imports;
DELETE FROM campaigns;
DELETE FROM contacts;
DELETE FROM users;
DELETE FROM tenants;
