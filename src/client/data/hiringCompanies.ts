/**
 * The companies in the Hiring Companies panel on the Jobs page. A fixed list, made up for now, and NOT connected to the Remotive
 * results: the panel stays the same whatever the jobs list shows. Replace it with a real source when there is one.
 */

export interface HiringCompany {
  id: string;
  name: string;
  address: string;
  industry: string;
  /** One line shown under the name. */
  blurb: string;
  /** How many jobs the company has open (made up). */
  openPositions: number;
  /** Banner colour (a CSS gradient), so each company looks different. */
  banner: string;
}

export const HIRING_COMPANIES: readonly HiringCompany[] = [
  { id: "hc-1", name: "Summit Group", address: "1200 Congress Ave, Austin, TX 78701", industry: "Construction", blurb: "We're hiring site leads and laborers for commercial builds!", openPositions: 12, banner: "linear-gradient(135deg,#0ea5b7,#0b3b5a)" },
  { id: "hc-2", name: "Northwind Services", address: "455 N Clark St, Chicago, IL 60654", industry: "Cleaning Services", blurb: "Join our growing crew of commercial cleaning professionals.", openPositions: 7, banner: "linear-gradient(135deg,#7c3aed,#312e81)" },
  { id: "hc-3", name: "Bluepeak Co", address: "88 Blake St, Denver, CO 80202", industry: "HVAC", blurb: "Service technicians and installers wanted, with paid training.", openPositions: 9, banner: "linear-gradient(135deg,#2563eb,#0f172a)" },
  { id: "hc-4", name: "Ironbridge Builders", address: "2100 Peachtree Rd NW, Atlanta, GA 30309", industry: "Construction", blurb: "Looking for carpenters and project coordinators.", openPositions: 4, banner: "linear-gradient(135deg,#f97316,#7c2d12)" },
  { id: "hc-5", name: "Harbor Works", address: "700 Brickell Ave, Miami, FL 33131", industry: "Plumbing", blurb: "Licensed plumbers and apprentices, start this month.", openPositions: 6, banner: "linear-gradient(135deg,#06b6d4,#164e63)" },
  { id: "hc-6", name: "Evergreen Partners", address: "1500 4th Ave, Seattle, WA 98101", industry: "Landscaping", blurb: "Seasonal and full-time landscape crews.", openPositions: 5, banner: "linear-gradient(135deg,#22c55e,#14532d)" },
  { id: "hc-7", name: "Redwood Supply", address: "3900 Howard Hughes Pkwy, Las Vegas, NV 89169", industry: "Roofing", blurb: "Roofing foremen and estimators for a busy season.", openPositions: 3, banner: "linear-gradient(135deg,#ef4444,#7f1d1d)" },
  { id: "hc-8", name: "Silverline Systems", address: "350 Fifth Ave, New York, NY 10118", industry: "Electrical", blurb: "Electricians and low-voltage technicians across the city.", openPositions: 8, banner: "linear-gradient(135deg,#64748b,#0f172a)" },
  { id: "hc-9", name: "Brightpath Labs", address: "333 S Grand Ave, Los Angeles, CA 90071", industry: "Marketing", blurb: "We're growing our email and SEO team!", openPositions: 2, banner: "linear-gradient(135deg,#ec4899,#701a75)" },
  { id: "hc-10", name: "Granite Holdings", address: "2 N Central Ave, Phoenix, AZ 85004", industry: "Painting", blurb: "Interior and exterior painters, steady year-round work.", openPositions: 6, banner: "linear-gradient(135deg,#eab308,#713f12)" },
];

