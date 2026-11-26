import { Hono } from "hono";
import type { AppEnv } from "../app";
import { ApiError } from "../lib/errors";
import { publicShare } from "../services/job-share";

/** The public job page's data: GET /api/share/:id. No sign-in; it is only the copy of the job saved when someone shared it. */
export const sharePublicRoutes = new Hono<AppEnv>();
sharePublicRoutes.get("/:id", async (c) => {
  c.header("Cache-Control", "public, max-age=300");
  return c.json(await publicShare(c.get("db"), c.req.param("id")));
});

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * GET /share/:id in a deployed Worker: the app's own page (index.html) with the job's title, company and logo written into the head as
 * Open Graph tags, so LinkedIn and Facebook can show a proper preview card for the link. Everything inserted is escaped. Needs the ASSETS
 * binding (deployed only); without it, or for an unknown id, the request falls through to the app and its router.
 */
export async function sharePage(c: import("hono").Context<AppEnv>) {
  const assets = c.env.ASSETS;
  if (!assets) throw new ApiError(404, "NOT_FOUND", "Route not found");
  let shared;
  try {
    shared = await publicShare(c.get("db"), c.req.param("id") ?? "");
  } catch {
    return assets.fetch(new Request(new URL("/", c.req.url)));
  }
  const html = await (await assets.fetch(new Request(new URL("/", c.req.url)))).text();
  const { job } = shared;
  const title = `${job.title}${job.companyName ? ` at ${job.companyName}` : ""}`;
  const description = [job.remote ? "Remote" : job.location, job.employmentType, job.salary].filter(Boolean).join(" · ") || "View this job on Sendrix";
  const tags = [
    `<meta property="og:type" content="article">`,
    `<meta property="og:site_name" content="Sendrix">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(description)}">`,
    `<meta property="og:url" content="${esc(c.req.url)}">`,
    ...(job.companyLogo ? [`<meta property="og:image" content="${esc(job.companyLogo)}">`] : []),
    `<meta name="twitter:card" content="summary">`,
  ].join("\n    ");
  const withTitle = html.replace(/<title>.*?<\/title>/s, `<title>${esc(title)} | Sendrix</title>`);
  return new Response(withTitle.replace("</head>", `    ${tags}\n  </head>`), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" } });
}
