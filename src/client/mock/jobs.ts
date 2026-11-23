/**
 * MOCKUP: made-up jobs for the Jobs page, until jobs come from the server. Replace `JOBS` with an API call (a `useJobs` hook
 * in services/) and keep `JOB_CATEGORIES` / `JOB_LOCATIONS` as the filter choices (or load them too).
 */

export interface Job {
  id: string;
  title: string;
  company: string;
  category: string;
  /** City and state, without any "(Remote)" mark. */
  location: string;
  /** Can be done remotely: shown as "(Remote)" after the location. */
  remote: boolean;
  /** A label for how well it fits you ("Strong applicant"), or null. Made up here. */
  match: "Strong applicant" | "Early applicant" | null;
  type: "Full-time" | "Part-time" | "Contract";
  /** Whole days since it was posted (0 = today). */
  postedDaysAgo: number;
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
const COMPANIES = ["Summit Group", "Northwind Services", "Bluepeak Co", "Ironbridge Builders", "Harbor Works", "Evergreen Partners", "Redwood Supply", "Silverline Systems", "Brightpath Labs", "Granite Holdings"];
const TYPES: Job["type"][] = ["Full-time", "Full-time", "Full-time", "Part-time", "Contract"];
const MATCHES: Job["match"][] = ["Strong applicant", null, null, "Early applicant", null];

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
    jobs.push({
      id: `job-${i + 1}`,
      title: pick(TITLES[category]!),
      company: pick(COMPANIES),
      category,
      location: pick(JOB_LOCATIONS),
      remote: r() < 0.35,
      match: pick(MATCHES),
      type: pick(TYPES),
      postedDaysAgo: Math.floor(r() * 45),
    });
  }
  // newest first
  return jobs.sort((a, b) => a.postedDaysAgo - b.postedDaysAgo || a.id.localeCompare(b.id));
}

export const JOBS: readonly Job[] = build(84);

/** "Today", "3d ago", "2w ago", "1mo ago". */
export function postedAgo(days: number): string {
  if (days < 1) return "Today";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

/** MOCKUP: companies that are hiring, for the panel beside the job list. */
export interface HiringCompany {
  id: string;
  name: string;
  address: string;
  industry: string;
}

export const HIRING_COMPANIES: readonly HiringCompany[] = [
  { id: "hc-1", name: "Summit Group", address: "1200 Congress Ave, Austin, TX 78701", industry: "Construction" },
  { id: "hc-2", name: "Northwind Services", address: "455 N Clark St, Chicago, IL 60654", industry: "Cleaning Services" },
  { id: "hc-3", name: "Bluepeak Co", address: "88 Blake St, Denver, CO 80202", industry: "HVAC" },
  { id: "hc-4", name: "Ironbridge Builders", address: "2100 Peachtree Rd NW, Atlanta, GA 30309", industry: "Construction" },
  { id: "hc-5", name: "Harbor Works", address: "700 Brickell Ave, Miami, FL 33131", industry: "Plumbing" },
  { id: "hc-6", name: "Evergreen Partners", address: "1500 4th Ave, Seattle, WA 98101", industry: "Landscaping" },
  { id: "hc-7", name: "Redwood Supply", address: "3900 Howard Hughes Pkwy, Las Vegas, NV 89169", industry: "Roofing" },
  { id: "hc-8", name: "Silverline Systems", address: "350 Fifth Ave, New York, NY 10118", industry: "Electrical" },
  { id: "hc-9", name: "Brightpath Labs", address: "333 S Grand Ave, Los Angeles, CA 90071", industry: "Marketing" },
  { id: "hc-10", name: "Granite Holdings", address: "2 N Central Ave, Phoenix, AZ 85004", industry: "Painting" },
];
