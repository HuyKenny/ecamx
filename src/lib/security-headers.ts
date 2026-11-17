/**
 * Bezpečnostní hlavičky pro odpovědi WORKERU (D85). Na Worker routy
 * `public/_headers` neplatí, takže dynamická stránka `/watch/`, 404 z Workeru
 * a API si je musí nastavit samy — dřív každá jinak a `/watch/` bez HSTS.
 * Drž v souladu s `public/_headers`. CSP doplňuje volající (placeholder
 * `__ECAMX_CSP__` nahrazuje `scripts/build-csp.ts`).
 */
export const SECURITY_HEADERS: Record<string, string> = {
	'x-content-type-options': 'nosniff',
	'referrer-policy': 'strict-origin-when-cross-origin',
	'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), interest-cohort=()',
	'x-frame-options': 'DENY',
	'strict-transport-security': 'max-age=31536000; includeSubDomains',
};

export function withSecurityHeaders(h: Headers, csp?: string): Headers {
	for (const [k, v] of Object.entries(SECURITY_HEADERS)) h.set(k, v);
	if (csp) h.set('content-security-policy', csp);
	return h;
}
