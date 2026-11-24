import { describe, expect, it } from "vitest";
import { looksEnglish, scoreLanguage } from "../../src/server/lib/language";

const EN = "We are looking for a senior engineer to join our team. You will work with the product group and help us build the platform for our customers.";
const DE = "Wir suchen einen erfahrenen Entwickler für unser Team. Sie arbeiten mit der Produktgruppe und helfen uns, die Plattform für unsere Kunden zu bauen.";
const FR = "Nous recherchons un ingénieur expérimenté pour rejoindre notre équipe. Vous travaillerez avec le groupe produit et vous nous aiderez à construire la plateforme pour nos clients.";
const NL = "Wij zoeken een ervaren ontwikkelaar voor ons team. Je werkt met de productgroep en helpt ons het platform te bouwen voor onze klanten.";
const ES = "Buscamos un ingeniero con experiencia para unirse a nuestro equipo. Trabajarás con el grupo de producto y nos ayudarás a construir la plataforma para nuestros clientes.";

describe("looksEnglish", () => {
  it("recognises English, and German, French, Dutch and Spanish as not English", () => {
    expect(looksEnglish(EN)).toBe(true);
    for (const [name, text] of [["German", DE], ["French", FR], ["Dutch", NL], ["Spanish", ES]] as const) expect(looksEnglish(text), name).toBe(false);
  });

  it("is not fooled by English job-title words inside a foreign text, or foreign words inside an English one", () => {
    expect(looksEnglish("Senior Java Developer im GKV Umfeld (m/w/d). Sie arbeiten mit unserem Team und der Software für die Krankenversicherung.")).toBe(false);
    expect(looksEnglish("Account Manager Customer Success. Wij zoeken een ervaren accountmanager voor ons team en je werkt met de klanten van het bedrijf.")).toBe(false);
    expect(looksEnglish("AI Data Specialist - Dutch. We are looking for a specialist to join our team in Amsterdam and help the customers with the data.")).toBe(true);
  });

  it("gives a text with too few small words to judge (a bare title) the fallback, true unless told otherwise", () => {
    expect(looksEnglish("Developer")).toBe(true);
    expect(looksEnglish("Elektroingenieur (m/w/d)")).toBe(true);
    expect(looksEnglish("Elektroingenieur (m/w/d)", false)).toBe(false);
    expect(looksEnglish("")).toBe(true);
  });

  it("counts small words of each language, ignoring words that are the same in two (die, in, an, as...)", () => {
    expect(scoreLanguage("the and with you")).toEqual({ english: 4, other: 0 });
    expect(scoreLanguage("der und mit für")).toEqual({ english: 0, other: 4 });
    expect(scoreLanguage("die in an as on")).toEqual({ english: 0, other: 0 });
  });
});
