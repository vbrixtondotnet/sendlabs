/**
 * Tells English text from German, French, Dutch, Spanish, Italian... without a model: it counts the very common small words of
 * each language ("the / and / with" against "der / und / mit", "le / et / pour", "het / een / voor"...). Those words are in nearly
 * every sentence, so a few hundred characters are enough, and it works on a job's title and the start of its description.
 *
 * It is a filter, not a translator: it answers "is this written in English?" for ordinary job posts. Text with too few words to
 * judge (a title like "Developer") is given the benefit of the doubt only when `fallback` says so.
 */

const ENGLISH = new Set(
  "the and of to in for with you we our is are will be your as on at an or by from this that have has it their they who can all new us about help work team role join".split(" "),
);

/** Small words of the other languages that appear in Arbeitnow's job posts. None of them is also a common English word. */
const OTHER = new Set(
  (
    // German
    "der die das den dem des und oder mit für fuer von vom zu zum zur im ist sind wir sie ihr ihre ihnen eine einen einem einer ein auf bei nach aus als auch nicht wird werden sich über ueber unser unsere unseren deine dein uns dich mehr oder wenn dass " +
    // French
    "le la les des du un une et pour vous nous dans est sont avec sur par votre vos notre nos au aux ce cette ces qui que ou où plus être avoir sera serez " +
    // Dutch
    "het een van voor met wij je jij zijn op aan bij naar ook dat niet wordt worden onze ons jouw deze die als maar of te " +
    // Spanish / Italian / Portuguese
    "el los las del y con para por una nuestro nuestra su sus es son se lo al della dei delle degli il gli per con che sono nel nella uma não para com"
  ).split(" "),
);
/** Words shared by English and another language that must not count for the other side. */
const SHARED = new Set(["die", "an", "in", "as", "on", "or", "is", "us", "all", "to", "no", "ce", "la", "se", "me", "te", "do"]);

const words = (text: string): string[] => text.toLowerCase().normalize("NFC").match(/[a-zà-ÿ']+/g) ?? [];

export interface LanguageScore {
  english: number;
  other: number;
}

/** How many of the text's small words are English, and how many are another language's. */
export function scoreLanguage(text: string): LanguageScore {
  let english = 0;
  let other = 0;
  for (const w of words(text)) {
    if (SHARED.has(w)) continue;
    if (ENGLISH.has(w)) english++;
    else if (OTHER.has(w)) other++;
  }
  return { english, other };
}

/**
 * True when the text is English: its common words are mostly English, and not just a couple. When there are too few small words to
 * tell (a one-line title), the answer is `fallback`.
 */
export function looksEnglish(text: string, fallback = true): boolean {
  const { english, other } = scoreLanguage(text);
  if (english + other < 4) return fallback;
  return english / (english + other) >= 0.7;
}
