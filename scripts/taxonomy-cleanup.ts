/**
 * Úklid taxonomií. Starý web měl 5 930 kategorií, z nichž 64 % mělo count 0
 * a 84 % míň než 5 modelek — to je thin-content bomba, ne struktura webu.
 *
 * Tenhle modul rozhoduje, co se vůbec stane veřejnou stránkou. Pravidla jsou
 * odvozená z reálného rozložení dat (viz seed/terms.tsv, analýza 16. 8. 2026).
 */

/**
 * Prahy pro publikaci — pod nimi se term použije jen jako filtr, ne jako URL.
 *
 * Měří se proti JEDNOMU live snapshotu (~7 600 modelek online), ne proti
 * kumulaci za 9 měsíců jako na starém webu. Práh 50 znamená „na stránce je
 * vždycky aspoň 50 živých modelek" — to je plná stránka, ne thin content.
 */
export const THRESHOLDS = {
	category: 50,
	country: 20,
	language: 50,
	attribute: 40,
} as const;

// Kanonizace žije v `src/lib/taxonomy.ts`, protože ji potřebuje sync i render.
// Dvě kopie tu už jednou byly a rozešly se — viz komentář v tom modulu.
export {
	canonicalTerm, slugifyTerm, CANONICAL, JUNK, NICHE_ARTIFACT,
	ageBucket, AGE_BUCKETS, canonicalLanguage, LANGUAGE_MAP,
} from '../src/lib/taxonomy.ts';
import { canonicalTerm } from '../src/lib/taxonomy.ts';

export const NOT_A_CATEGORY = new Set([
	'solo', 'normal', 'free', 'prive', 'private-show', 'group-show',
	'skinny', 'curvy', 'athletic', 'medium', 'bbw', 'muscular', 'chunky', 'average',
	'blonde', 'brunette', 'black', 'brown', 'redhead', 'auburn',
	'english', 'spanish', 'french', 'german', 'italian', 'portuguese', 'russian',
	'white-caucasian', 'latin', 'asian', 'ebony', 'indian', 'middle-eastern',
	'female', 'male', 'couple', 'trans', 'group',
	'brown-eyes', 'blue-eyes', 'green-eyes',
]);

/** Rozhodne, jestli se z termu stane veřejná stránka. */
export function isPublishableCategory(slug: string, count: number): boolean {
	return count >= THRESHOLDS.category && !NOT_A_CATEGORY.has(slug);
}
