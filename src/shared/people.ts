/**
 * People search (Apollo): the filter choices both the page and the API use. Kept in one place so the dropdowns and the
 * server's checks can never disagree.
 */

/** Countries offered in the multi-select. Apollo takes country names. */
export const PEOPLE_COUNTRIES = [
  "Argentina", "Australia", "Austria", "Belgium", "Brazil", "Canada", "Chile", "China", "Colombia", "Czechia", "Denmark", "Egypt",
  "Finland", "France", "Germany", "Greece", "Hong Kong", "Hungary", "India", "Indonesia", "Ireland", "Israel", "Italy", "Japan",
  "Kenya", "Malaysia", "Mexico", "Netherlands", "New Zealand", "Nigeria", "Norway", "Pakistan", "Peru", "Philippines", "Poland",
  "Portugal", "Romania", "Saudi Arabia", "Singapore", "South Africa", "South Korea", "Spain", "Sweden", "Switzerland", "Taiwan",
  "Thailand", "Turkey", "Ukraine", "United Arab Emirates", "United Kingdom", "United States", "Vietnam",
] as const;

/** Company size as Apollo's employee ranges: `value` is "min,max" (max empty = no upper limit). */
export const PEOPLE_COMPANY_SIZES = [
  { value: "1,10", label: "1-10" },
  { value: "11,50", label: "11-50" },
  { value: "51,200", label: "51-200" },
  { value: "201,500", label: "201-500" },
  { value: "501,1000", label: "501-1,000" },
  { value: "1001,5000", label: "1,001-5,000" },
  { value: "5001,", label: "5,001+" },
] as const;

/**
 * Other ways the stored data may spell a country in the filter list. The imported leads say "US", the list says "United States":
 * choosing one finds all of them.
 */
export const PEOPLE_COUNTRY_ALIASES: Record<string, readonly string[]> = {
  "United States": ["US", "USA", "U.S.", "U.S.A."],
  "United Kingdom": ["UK", "GB", "Great Britain"],
  "United Arab Emirates": ["UAE"],
};

export const PEOPLE_MAX_INDUSTRIES = 50;
export const PEOPLE_MAX_TITLES = 10;
