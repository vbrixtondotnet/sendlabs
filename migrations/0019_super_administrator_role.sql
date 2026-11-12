-- The SuperAdministrator access level (see SUPER_ADMINISTRATOR in src/shared/types.ts). Tenants cannot assign it: it is not
-- in ACCESS_LEVELS, so invitations and the role pickers never offer it.
INSERT INTO `access` (`id`, `name`, `description`, `sort_order`, `created_at`) VALUES
  ('super-administrator', 'SuperAdministrator', 'Platform-wide access, not tied to any tenant. Manages what every tenant shares, such as the Available Templates.', 0, CAST(strftime('%s', 'now') AS integer) * 1000);
