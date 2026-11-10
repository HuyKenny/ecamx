/**
 * Ověřovací sonda: zkusí všech 7 sítí a řekne, kolik modelek vrátily a jestli
 * mapování polí sedí. Nic nezapisuje. Spouštět po každé změně cam-networks.ts
 * a kdykoli se zdá, že sync vrací míň dat, než má.
 *
 *   node --experimental-strip-types scripts/probe-networks.ts
 */
import { readFileSync, existsSync } from 'node:fs';
import { NETWORKS, type NetworkDef, type Model } from './cam-networks.ts';

function loadEnv(path: string): void {
	if (!existsSync(path)) return;
	for (const line of readFileSync(path, 'utf8').split('\n')) {
		const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
		if (!m) continue;
		let v = m[2].trim();
		if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
			v = v.slice(1, -1);
		}
		if (!process.env[m[1]]) process.env[m[1]] = v;
	}
}

const FILLED = (m: Partial<Model>, k: keyof Model) => {
	const v = m[k];
	return Array.isArray(v) ? v.length > 0 : v !== null && v !== undefined && v !== '';
};

async function probe(net: NetworkDef) {
	const missing = net.requiredEnv.filter((k) => !process.env[k]);
	if (missing.length) return { id: net.id, status: `CHYBÍ ENV: ${missing.join(', ')}` };

	const { url, init } = net.buildRequest(process.env, 0);
	const t0 = Date.now();
	let res: Response;
	try {
		res = await fetch(url, { ...init, signal: AbortSignal.timeout(45_000) });
	} catch (e: any) {
		return { id: net.id, status: `SÍŤOVÁ CHYBA: ${e?.message ?? e}` };
	}
	const ms = Date.now() - t0;
	if (!res.ok) return { id: net.id, status: `HTTP ${res.status}`, ms };

	const text = await res.text();
	let payload: unknown;
	try { payload = JSON.parse(text); }
	catch { return { id: net.id, status: `ODPOVĚĎ NENÍ JSON (${text.slice(0, 80)}…)`, ms }; }

	const raw = net.extract(payload);
	if (!Array.isArray(raw) || raw.length === 0) {
		return { id: net.id, status: `PRÁZDNO — extract() nic nenašel (klíče: ${Object.keys(payload as object).join(',')})`, ms };
	}
	const mapped = raw.map((r) => net.map(r)).filter(Boolean) as Model[];

	// jaká pole se reálně plní (kvalita dat se mezi sítěmi hodně liší)
	const keys: (keyof Model)[] = ['gender', 'age', 'country', 'languages', 'tags',
		'ethnicity', 'hairColor', 'bodyType', 'subject', 'viewers', 'thumbnail'];
	const fill = keys
		.map((k) => [k, Math.round(100 * mapped.filter((m) => FILLED(m, k)).length / mapped.length)] as const)
		.filter(([, pct]) => pct > 0)
		.map(([k, pct]) => `${k} ${pct}%`);

	return {
		id: net.id, ms,
		status: raw.length < net.minExpected ? `POZOR: jen ${raw.length} < min ${net.minExpected}` : 'OK',
		raw: raw.length, mapped: mapped.length,
		fill: fill.join(', '),
		sample: mapped[0],
	};
}

loadEnv('/home/kenny/ai/credentials/.ecamx-credentials.env');

const results = await Promise.all(NETWORKS.map(probe));
let total = 0;
for (const r of results as any[]) {
	console.log(`\n── ${r.id} ${'─'.repeat(Math.max(0, 22 - r.id.length))} ${r.status}  ${r.ms ? r.ms + ' ms' : ''}`);
	if (r.raw) {
		total += r.mapped;
		console.log(`   modelek: ${r.raw} syrových → ${r.mapped} namapovaných`);
		console.log(`   plní se: ${r.fill}`);
		const s = r.sample;
		console.log(`   vzorek : ${s.slug} | ${s.gender ?? '–'} | ${s.age ?? '–'} | ${s.country ?? '–'} | ${s.viewers ?? '–'} diváků`);
		console.log(`   tagy   : ${s.tags.slice(0, 8).join(', ') || '–'}`);
		console.log(`   náhled : ${s.thumbnail ? s.thumbnail.slice(0, 78) : 'CHYBÍ'}`);
	}
}
console.log(`\n═══ celkem namapováno: ${total} modelek ═══`);
