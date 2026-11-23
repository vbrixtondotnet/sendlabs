/**
 * MOCKUP: made-up jobs for the Jobs page, until jobs come from the server. Replace `JOBS` with an API call (a `useJobs` hook
 * in services/) and keep `JOB_CATEGORIES` / `JOB_LOCATIONS` as the filter choices (or load them too).
 */

export interface Job {
  id: string;
  title: string;
  company: string;
  category: string;
  location: string;
  type: "Full-time" | "Part-time" | "Contract";
  /** ISO date (YYYY-MM-DD). */
  posted: string;
}

export const JOB_CATEGORIES = ["Carpentry", "Cleaning Services", "Construction", "Electrical", "HVAC", "Landscaping", "Marketing", "Painting", "Plumbing", "Roofing"] as const;

export const JOB_LOCATIONS = [
  "Atlanta, GA", "Austin, TX", "Chicago, IL", "Denver, CO", "Las Vegas, NV", "Los Angeles, CA", "Miami, FL", "New York, NY", "Phoenix, AZ", "Raleigh, NC", "Seattle, WA", "Remote",
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
    const daysAgo = Math.floor(r() * 45);
    const d = new Date(Date.UTC(2026, 10, 24) - daysAgo * 86_400_000);
    jobs.push({
      id: `job-${i + 1}`,
      title: pick(TITLES[category]!),
      company: pick(COMPANIES),
      category,
      location: pick(JOB_LOCATIONS),
      type: pick(TYPES),
      posted: d.toISOString().slice(0, 10),
    });
  }
  // newest first
  return jobs.sort((a, b) => (a.posted < b.posted ? 1 : a.posted > b.posted ? -1 : a.id.localeCompare(b.id)));
}

export const JOBS: readonly Job[] = build(84);
