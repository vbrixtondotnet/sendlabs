/**
 * Pulls the latest remote jobs from Remotive into the global_jobs table (the Jobs page reads them from there).
 *
 *   npm run jobs:sync                                    # into DATABASE_URL (.dev.vars)
 *   npm run jobs:sync -- --url "postgresql://..."        # into another database
 *   npm run jobs:sync -- --search react --category "Software Development" --limit 20
 *
 * The deployed Worker does this by itself every few hours (see services/scheduled.ts); this is for local development and for
 * filling a database by hand. Remotive asks for no more than about 4 requests a day: do not loop it.
 */
import { REMOTIVE } from "../src/shared/jobs";
import { RemotiveJobService } from "../src/server/services/remotive-jobs";
import { arg } from "./lib/env";
import { openDb } from "./lib/db";

const { db, url, close } = openDb();
try {
  const limit = arg("limit");
  const service = new RemotiveJobService({ db, fetch });
  const result = await service.sync({
    ...(arg("search") ? { search: arg("search")! } : {}),
    ...(arg("category") ? { category: arg("category")! } : {}),
    ...(arg("company") ? { companyName: arg("company")! } : {}),
    ...(limit ? { limit: Number(limit) } : {}),
  });
  console.log(`\n${REMOTIVE.name}: fetched ${result.fetched}, created ${result.created}, updated ${result.updated}, closed ${result.deactivated}`);
  console.log(`(into ${url.replace(/\/\/([^:/@]+):[^@]*@/, "//$1:****@")})`);
} catch (e) {
  console.error(`\nSync failed: ${e instanceof Error ? e.message : e}`);
  process.exitCode = 1;
} finally {
  await close();
}
