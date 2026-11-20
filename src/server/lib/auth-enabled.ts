/**
 * Whether signing in and the protected API are switched on for this deployment.
 *
 * Outside local development everything protected fails closed, so a build that is deployed by accident cannot expose
 * anyone's data. It is opened on purpose, one deployment at a time, by setting `AUTH_ENABLED` to exactly "true" in that
 * environment's vars (see wrangler.jsonc). Any other value, or none, leaves it closed.
 *
 * Opening it turns on sessions only: sign in with email and password, and a session cookie. The shortcut that runs a
 * request as `DEV_ACTOR_EMAIL` is NOT part of it and works in the local environment only.
 */
export const authEnabled = (env: { ENVIRONMENT?: string | undefined; AUTH_ENABLED?: string | undefined }): boolean =>
  env.ENVIRONMENT === "local" || env.AUTH_ENABLED === "true";

/** The shortcut user is for trying the API on your own machine: never anywhere else, whatever else is switched on. */
export const devShortcutAllowed = (env: { ENVIRONMENT?: string | undefined }): boolean => env.ENVIRONMENT === "local";
