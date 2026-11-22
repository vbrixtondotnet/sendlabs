import type { PeopleSearchDto, PersonDto } from "../../shared/api";
import { PEOPLE_COUNTRIES, PEOPLE_INDUSTRIES } from "../../shared/people";
import type { PeopleSearchQuery } from "../../shared/schemas";

/**
 * Where people come from. Today only the sample data below; when the Apollo API is connected, add an `apollo` provider that
 * implements this interface (its People Search takes the same four filters) and pick it in `peopleProvider`. The route and the
 * page do not change.
 */
export interface PeopleProvider {
  search(query: PeopleSearchQuery): Promise<PeopleSearchDto>;
}

/* ------------------------------ sample data (made up) ------------------------------ */

/** A small deterministic generator, so the sample list is the same on every request and every restart. */
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

const FIRST = ["Ava", "Liam", "Noah", "Emma", "Olivia", "Lucas", "Mia", "Ethan", "Sofia", "Mason", "Isabella", "Logan", "Amelia", "Elijah", "Harper", "James", "Priya", "Arjun", "Mei", "Hiro", "Fatima", "Omar", "Chloe", "Hugo", "Elena", "Mateo", "Zara", "Kwame", "Ingrid", "Tomas"];
const LAST = ["Smith", "Johnson", "Garcia", "Brown", "Davis", "Miller", "Wilson", "Moore", "Taylor", "Anderson", "Thomas", "Martin", "Lee", "Walker", "Young", "Patel", "Nguyen", "Kim", "Silva", "Rossi", "Muller", "Dubois", "Kowalski", "Okafor", "Haddad", "Tanaka", "Lindqvist", "Fernandez", "Costa", "Novak"];
const TITLES = ["CEO", "Founder", "Chief Technology Officer", "VP of Sales", "Director of Marketing", "Head of Operations", "Marketing Manager", "Sales Manager", "Operations Manager", "Procurement Manager", "Chief Financial Officer", "HR Director", "Product Manager", "Owner"];
const COMPANY_A = ["Summit", "Northwind", "Bluepeak", "Ironbridge", "Harbor", "Evergreen", "Redwood", "Silverline", "Brightpath", "Granite", "Oakmont", "Clearwater", "Pinnacle", "Westgate", "Lakeshore", "Atlas"];
const COMPANY_B = ["Partners", "Group", "Industries", "Solutions", "Systems", "Holdings", "Works", "Labs", "Supply", "Logistics", "Builders", "Services"];
const PLACES: Record<string, [string, string][]> = {
  "United States": [["Austin", "Texas"], ["Denver", "Colorado"], ["Chicago", "Illinois"], ["Seattle", "Washington"], ["Miami", "Florida"]],
  "Canada": [["Toronto", "Ontario"], ["Vancouver", "British Columbia"], ["Calgary", "Alberta"]],
  "United Kingdom": [["London", "England"], ["Manchester", "England"], ["Edinburgh", "Scotland"]],
  "Germany": [["Berlin", "Berlin"], ["Munich", "Bavaria"], ["Hamburg", "Hamburg"]],
  "France": [["Paris", "Île-de-France"], ["Lyon", "Auvergne-Rhône-Alpes"]],
  "Australia": [["Sydney", "New South Wales"], ["Melbourne", "Victoria"]],
  "India": [["Bengaluru", "Karnataka"], ["Mumbai", "Maharashtra"], ["Pune", "Maharashtra"]],
  "Singapore": [["Singapore", ""]],
  "Philippines": [["Manila", "Metro Manila"], ["Cebu City", "Cebu"]],
  "Netherlands": [["Amsterdam", "North Holland"], ["Rotterdam", "South Holland"]],
  "Brazil": [["São Paulo", "São Paulo"], ["Rio de Janeiro", "Rio de Janeiro"]],
  "Japan": [["Tokyo", "Tokyo"], ["Osaka", "Osaka"]],
};
const EMPLOYEE_SAMPLES = [4, 8, 15, 28, 42, 75, 120, 180, 260, 410, 640, 850, 1400, 2600, 4200, 7800, 15000];

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

function buildPeople(count: number): PersonDto[] {
  const r = rng(20240611);
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(r() * list.length)]!;
  const placeCountries = Object.keys(PLACES);
  const people: PersonDto[] = [];
  for (let i = 0; i < count; i++) {
    const firstName = pick(FIRST);
    const lastName = pick(LAST);
    const company = `${pick(COMPANY_A)} ${pick(COMPANY_B)}`;
    const country = r() < 0.8 ? pick(placeCountries) : pick(PEOPLE_COUNTRIES);
    const places = PLACES[country];
    const [city, state] = places ? pick(places) : ["", ""];
    const domain = `${slug(company)}.example`; // .example never resolves: these are not real companies
    people.push({
      id: `sample-${i + 1}`,
      firstName,
      lastName,
      title: pick(TITLES),
      companyName: company,
      email: `${slug(firstName)}.${slug(lastName)}@${domain}`,
      employees: pick(EMPLOYEE_SAMPLES),
      industry: pick(PEOPLE_INDUSTRIES),
      linkedinUrl: `https://www.linkedin.com/in/${slug(firstName)}-${slug(lastName)}-${i + 1}`,
      website: `https://www.${domain}`,
      city: city ?? "",
      state: state ?? "",
      country,
    });
  }
  return people;
}

const SAMPLE_PEOPLE = buildPeople(240);

function inSizeRange(employees: number, range: string): boolean {
  const [min, max] = range.split(",");
  return employees >= Number(min) && (!max || employees <= Number(max));
}

export const mockPeopleProvider: PeopleProvider = {
  async search(q) {
    const titles = q.titles.map((t) => t.toLowerCase());
    const matches = SAMPLE_PEOPLE.filter(
      (p) =>
        (q.countries.length === 0 || q.countries.includes(p.country)) &&
        (!q.industry || p.industry === q.industry) &&
        (!q.companySize || inSizeRange(p.employees, q.companySize)) &&
        (titles.length === 0 || titles.some((t) => p.title.toLowerCase().includes(t))),
    );
    const start = (q.page - 1) * q.pageSize;
    return { items: matches.slice(start, start + q.pageSize), page: q.page, pageSize: q.pageSize, total: matches.length, source: "mock" };
  },
};

/** The provider in use. Swap for the Apollo one here once it exists. */
export const peopleProvider = (): PeopleProvider => mockPeopleProvider;
