-- Deletes ALL rows from the application tables of the LOCAL database. The tables, indexes and
-- the migration history (d1_migrations) are left untouched, so nothing needs re-migrating.
--
-- Run with:  npm run db:clear:local
-- That script passes --local, so it can only ever touch the simulated database in .wrangler/.
-- Children first, so no foreign key is ever violated.
DELETE FROM import_rows;
DELETE FROM campaign_recipients;
DELETE FROM imports;
DELETE FROM campaigns;
DELETE FROM contacts;
