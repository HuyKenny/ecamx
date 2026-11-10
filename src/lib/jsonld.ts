/**
 * Bezpečná serializace JSON-LD do <script type="application/ld+json">.
 * `JSON.stringify` neescapuje `<`/`>`/`&` ani U+2028/U+2029 → data z feedu
 * (name, description) by mohla ukončit <script> a vést ke stored XSS.
 * Escapujeme na \uXXXX (validní JSON i uvnitř <script>).
 */
const ESCAPES: Record<string, string> = {
	"<": "\\u003c",
	">": "\\u003e",
	"&": "\\u0026",
	" ": "\\u2028",
	" ": "\\u2029",
};

const ESCAPE_RE = new RegExp("[<>&\\u2028\\u2029]", "g");

export function safeJsonLd(data: unknown): string {
	return JSON.stringify(data).replace(ESCAPE_RE, (c) => ESCAPES[c]);
}
