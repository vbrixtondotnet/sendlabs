/**
 * MOCKUP: made-up jobs and hiring companies for the Jobs page, until they come from the server. Replace `JOBS` and
 * `HIRING_COMPANIES` with API calls (hooks in services/) and keep `JOB_CATEGORIES` / `JOB_LOCATIONS` as the filter choices
 * (or load them too).
 */

export interface Job {
  id: string;
  title: string;
  company: string;
  category: string;
  /** City and state. A remote job still has the place its company is based. */
  location: string;
  /** Can be done remotely: the card then says "Remote" instead of the city. */
  remote: boolean;
  type: "Full-time" | "Part-time" | "Contract";
  /** Pay range as shown, e.g. "$3,000-$5,000". */
  salary: string;
  skills: string[];
  /** Whole hours since it was posted (0 = just now). */
  postedHoursAgo: number;
}

export const JOB_CATEGORIES = ["Carpentry", "Cleaning Services", "Construction", "Electrical", "HVAC", "Landscaping", "Marketing", "Painting", "Plumbing", "Roofing"] as const;

export const JOB_LOCATIONS = [
  "Atlanta, GA", "Austin, TX", "Chicago, IL", "Denver, CO", "Las Vegas, NV", "Los Angeles, CA", "Miami, FL", "New York, NY", "Phoenix, AZ", "Raleigh, NC", "Seattle, WA",
] as const;

const TITLES: Record<string, string[]> = {
  Carpentry: ["Finish Carpenter", "Framing Lead", "Cabinet Installer"],
  "Cleaning Services": ["Commercial Cleaner", "Janitorial Supervisor", "Post-Construction Cleaning Crew"],
  Construction: ["Site Superintendent", "Project Coordinator", "General Laborer"],
  Electrical: ["Journeyman Electrician", "Electrical Apprentice", "Low-Voltage Technician"],
  HVAC: ["HVAC Installer", "Service Technician", "Refrigeration Mechanic"],
  Landscaping: ["Landscape Crew Lead", "Irrigation Technician", "Lawn Care Specialist"],
  Marketing: ["Digital Marketing Specialist", "Local SEO Analyst", "Email Campaign Manager"],
  Painting: ["Interior Painter", "Exterior Painting Lead", "Drywall Finisher"],
  Plumbing: ["Licensed Plumber", "Plumbing Apprentice", "Drain Cleaning Technician"],
  Roofing: ["Roofing Foreman", "Shingle Installer", "Roof Estimator"],
};
const SKILLS: Record<string, string[]> = {
  Carpentry: ["Framing", "Trim work", "Blueprint reading", "Power tools", "Cabinetry"],
  "Cleaning Services": ["Floor care", "Sanitizing", "Equipment handling", "Scheduling", "Safety"],
  Construction: ["Scheduling", "OSHA 30", "Procore", "Blueprint reading", "Subcontractors"],
  Electrical: ["NEC code", "Conduit", "Panel upgrades", "Troubleshooting", "Blueprint reading"],
  HVAC: ["EPA 608", "Ductwork", "Load calculations", "Troubleshooting", "Refrigerants"],
  Landscaping: ["Irrigation", "Hardscape", "Plant care", "Equipment operation", "Estimating"],
  Marketing: ["SEO", "Email marketing", "Google Ads", "Analytics", "Copywriting"],
  Painting: ["Surface prep", "Spraying", "Color matching", "Drywall", "Trim"],
  Plumbing: ["Pipe fitting", "Water heaters", "Drain cleaning", "Code compliance", "Troubleshooting"],
  Roofing: ["Shingles", "Flashing", "Safety harness", "Estimating", "Metal roofing"],
};
const COMPANIES = ["Summit Group", "Northwind Services", "Bluepeak Co", "Ironbridge Builders", "Harbor Works", "Evergreen Partners", "Redwood Supply", "Silverline Systems", "Brightpath Labs", "Granite Holdings"];
const TYPES: Job["type"][] = ["Full-time", "Full-time", "Full-time", "Part-time", "Contract"];
const PAY = ["$2,000-$3,000", "$3,000-$5,000", "$4,000-$6,000", "$5,000-$8,000", "$18-$25 / hour", "$25-$35 / hour"];

/** A tiny deterministic generator, so the list is the same on every visit. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function build(count: number): Job[] {
  const r = rng(7301);
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(r() * list.length)]!;
  const jobs: Job[] = [];
  for (let i = 0; i < count; i++) {
    const category = pick(JOB_CATEGORIES);
    const pool = [...SKILLS[category]!];
    const skills: string[] = [];
    for (let k = 0; k < 4; k++) skills.push(pool.splice(Math.floor(r() * pool.length), 1)[0]!);
    jobs.push({
      id: `job-${i + 1}`,
      title: pick(TITLES[category]!),
      company: pick(COMPANIES),
      category,
      location: pick(JOB_LOCATIONS),
      remote: r() < 0.4,
      type: pick(TYPES),
      salary: pick(PAY),
      skills,
      postedHoursAgo: Math.floor(r() * 24 * 30),
    });
  }
  // newest first
  return jobs.sort((a, b) => a.postedHoursAgo - b.postedHoursAgo || a.id.localeCompare(b.id));
}

export const JOBS: readonly Job[] = build(84);

/** "Posted just now", "Posted 2 hours ago", "Posted 3 days ago", "Posted 2 weeks ago", "Posted 1 month ago". */
export function postedAgo(hours: number): string {
  const unit = (n: number, word: string) => `Posted ${n} ${word}${n === 1 ? "" : "s"} ago`;
  if (hours < 1) return "Posted just now";
  if (hours < 24) return unit(hours, "hour");
  const days = Math.floor(hours / 24);
  if (days < 7) return unit(days, "day");
  if (days < 30) return unit(Math.floor(days / 7), "week");
  return unit(Math.floor(days / 30), "month");
}

/** The line under a job's company: "Remote · Full-time · $3,000-$5,000" (the city instead of Remote when it is on site). */
export const jobMeta = (j: Job): string => [j.remote ? "Remote" : j.location, j.type, j.salary].join(" · ");

export interface HiringCompany {
  id: string;
  name: string;
  address: string;
  industry: string;
  /** One line shown under the name. */
  blurb: string;
  /** Banner colour (a CSS gradient), so each company looks different. */
  banner: string;
}

export const HIRING_COMPANIES: readonly HiringCompany[] = [
  { id: "hc-1", name: "Summit Group", address: "1200 Congress Ave, Austin, TX 78701", industry: "Construction", blurb: "We're hiring site leads and laborers for commercial builds!", banner: "linear-gradient(135deg,#0ea5b7,#0b3b5a)" },
  { id: "hc-2", name: "Northwind Services", address: "455 N Clark St, Chicago, IL 60654", industry: "Cleaning Services", blurb: "Join our growing crew of commercial cleaning professionals.", banner: "linear-gradient(135deg,#7c3aed,#312e81)" },
  { id: "hc-3", name: "Bluepeak Co", address: "88 Blake St, Denver, CO 80202", industry: "HVAC", blurb: "Service technicians and installers wanted, with paid training.", banner: "linear-gradient(135deg,#2563eb,#0f172a)" },
  { id: "hc-4", name: "Ironbridge Builders", address: "2100 Peachtree Rd NW, Atlanta, GA 30309", industry: "Construction", blurb: "Looking for carpenters and project coordinators.", banner: "linear-gradient(135deg,#f97316,#7c2d12)" },
  { id: "hc-5", name: "Harbor Works", address: "700 Brickell Ave, Miami, FL 33131", industry: "Plumbing", blurb: "Licensed plumbers and apprentices, start this month.", banner: "linear-gradient(135deg,#06b6d4,#164e63)" },
  { id: "hc-6", name: "Evergreen Partners", address: "1500 4th Ave, Seattle, WA 98101", industry: "Landscaping", blurb: "Seasonal and full-time landscape crews.", banner: "linear-gradient(135deg,#22c55e,#14532d)" },
  { id: "hc-7", name: "Redwood Supply", address: "3900 Howard Hughes Pkwy, Las Vegas, NV 89169", industry: "Roofing", blurb: "Roofing foremen and estimators for a busy season.", banner: "linear-gradient(135deg,#ef4444,#7f1d1d)" },
  { id: "hc-8", name: "Silverline Systems", address: "350 Fifth Ave, New York, NY 10118", industry: "Electrical", blurb: "Electricians and low-voltage technicians across the city.", banner: "linear-gradient(135deg,#64748b,#0f172a)" },
  { id: "hc-9", name: "Brightpath Labs", address: "333 S Grand Ave, Los Angeles, CA 90071", industry: "Marketing", blurb: "We're growing our email and SEO team!", banner: "linear-gradient(135deg,#ec4899,#701a75)" },
  { id: "hc-10", name: "Granite Holdings", address: "2 N Central Ave, Phoenix, AZ 85004", industry: "Painting", blurb: "Interior and exterior painters, steady year-round work.", banner: "linear-gradient(135deg,#eab308,#713f12)" },
];

/** How many jobs in the list a company has open. */
export const openPositions = (company: string): number => JOBS.filter((j) => j.company === company).length;
