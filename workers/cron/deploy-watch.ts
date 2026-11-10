/**
 * Port `bin/ecamx-deploy-watch.py` — hlídač zamrzlého deploye.
 *
 * Hlídá SYMPTOM, ne konkrétní guard: jak starý je nasazený build a jak skončil
 * poslední běh CI. Vznikl 26. 8. 2026, kdy padal deploy pětkrát za sebou
 * a deset hodin o tom nikdo nevěděl (D56).
 *
 * **Proč je ve Workeru a ne na Malině:** web má na Malině přestat záviset
 * (D77). Worker umí totéž až na jedno — neumí nasadit pracovní kopii. To je
 * záměr: záloha z Maliny se ruší, protože nasazovala necommitnutý stav
 * (past 117). Zůstává nakopnutí CI a hláška, což je přesně to, co se dá dělat
 * poctivě.
 *
 * Prahy: kick 16 h, poplach 18 h. Mezera mezi buildy je 12 h a GitHub
 * plánované běhy odkládá (naměřeno 2–5 h), takže stáří běžně vystoupá na ~15 h.
 * Nižší prahy by kickovaly každý den a spálily minuty, které se tím šetří —
 * přesně to se dělo 22. 9. (past 113).
 */

import {
	discord, fetchWithTimeout, loadState, logf, saveState, SITE, REPO, WORKFLOW_FILE,
	type Env, type WatchState,
} from "./shared.ts";

/** Normální mezera je 12 h; kick je mezera + 4, poplach + 6. */
const KICK_AFTER_HOURS = 16;
const MAX_AGE_HOURS = 18;
/** Jak dlouho mlčet o témže incidentu (a 24 h, když web drží záloha). */
const REPEAT_HOURS = 6;
const REPEAT_HOURS_FRESH = 24;
/** Kick nejvýš jednou za hodinu — dvojité nakopnutí stojí ~12 min rozpočtu. */
const KICK_COOLDOWN_SEC = 3600;

export interface WatchPlan {
	ageHours: number | null;
	ageNote: string | null;
	conclusion: string;
	running: boolean;
	displayTitle: string;
	runId: number | null;
	problems: string[];
	action: "none" | "kick" | "alert";
	message: string;
}

/** Věk nasazeného buildu z `<meta name="ecamx-built">`. Cache se obchází. */
async function buildAge(): Promise<{ age: number | null; note: string | null }> {
	// Cache-buster i hlavička: Cloudflare drží HTML na edge a bez obojího by
	// hlídač četl vlastní starou odpověď a hlásil zamrznutí, které nenastalo.
	const url = `${SITE}?deploy-watch=${Math.floor(Date.now() / 1000)}`;
	let html: string;
	try {
		const res = await fetchWithTimeout(url, {
			headers: { "User-Agent": "ecamx-cron/1.0 (+https://ecamx.com)", "Cache-Control": "no-cache" },
		}, 30_000);
		html = await res.text();
	} catch (e) {
		return { age: null, note: `web neodpovídá: ${(e as Error).name}` };
	}
	const m = /<meta name="ecamx-built" content="([^"]+)"/.exec(html);
	if (!m) {
		// Nasazená verze je starší než zavedení té značky — pak se hlídá jen CI.
		return { age: null, note: "stránka značku `ecamx-built` nemá (starý build)" };
	}
	const built = Date.parse(m[1]);
	if (Number.isNaN(built)) return { age: null, note: `nečitelný čas buildu: ${m[1].slice(0, 40)}` };
	return { age: (Date.now() - built) / 3_600_000, note: null };
}

interface RunInfo {
	conclusion: string;
	status: string;
	displayTitle: string;
	databaseId: number | null;
	createdAt: string;
	error?: string;
}

/** Poslední běh workflow. */
async function lastRun(env: Env): Promise<RunInfo> {
	const empty: RunInfo = { conclusion: "?", status: "?", displayTitle: "?", databaseId: null, createdAt: "?" };
	try {
		const res = await fetchWithTimeout(
			`https://api.github.com/repos/${REPO}/actions/runs?per_page=1`,
			{
				headers: {
					Authorization: `Bearer ${env.GITHUB_TOKEN}`,
					Accept: "application/vnd.github+json",
					"User-Agent": "ecamx-cron/1.0",
				},
			},
		);
		if (!res.ok) return { ...empty, error: `HTTP ${res.status}` };
		const data = await res.json() as { workflow_runs?: Array<Record<string, unknown>> };
		const r = data.workflow_runs?.[0];
		if (!r) return empty;
		return {
			conclusion: (r.conclusion as string) ?? "",
			status: (r.status as string) ?? "?",
			displayTitle: (r.display_title as string) ?? "?",
			databaseId: (r.id as number) ?? null,
			createdAt: (r.created_at as string) ?? "?",
		};
	} catch (e) {
		// Chyba GitHub API NEMÁ vyrábět poplach — to by hlídač strašil kvůli
		// vlastnímu výpadku. Python to dělá taky tak (`last_run` chybu polyká).
		return { ...empty, error: (e as Error).name };
	}
}

/**
 * Proč běh selhal. **Nečte se ZIP s logy** (`gh run view --log-failed` vrací
 * archiv a Worker by potřeboval mini-čtečku ZIPu) — místo toho se zeptáme na
 * jméno spadlého kroku a na anotace check-runu.
 *
 * Anotace jsou důležité: 28. 8. GitHub běh vůbec nespustil kvůli fakturaci
 * a v logu nebylo nic — důvod byl jen v anotaci (past 101).
 */
async function failureReason(env: Env, runId: number): Promise<string> {
	const headers = {
		Authorization: `Bearer ${env.GITHUB_TOKEN}`,
		Accept: "application/vnd.github+json",
		"User-Agent": "ecamx-cron/1.0",
	};
	const out: string[] = [];
	try {
		const jobsRes = await fetchWithTimeout(
			`https://api.github.com/repos/${REPO}/actions/runs/${runId}/jobs`, { headers });
		if (jobsRes.ok) {
			const data = await jobsRes.json() as { jobs?: Array<Record<string, unknown>> };
			for (const job of data.jobs ?? []) {
				const steps = (job.steps as Array<Record<string, unknown>>) ?? [];
				for (const s of steps) {
					if (s.conclusion === "failure") out.push(`spadl krok: ${s.name}`);
				}
			}
		}
	} catch { /* doplní se anotacemi níž */ }
	if (!out.length) {
		try {
			const jobsRes = await fetchWithTimeout(
				`https://api.github.com/repos/${REPO}/actions/runs/${runId}/jobs`, { headers });
			const data = await jobsRes.json() as { jobs?: Array<{ id: number }> };
			const jobId = data.jobs?.[0]?.id;
			if (jobId) {
				const annRes = await fetchWithTimeout(
					`https://api.github.com/repos/${REPO}/check-runs/${jobId}/annotations`, { headers });
				if (annRes.ok) {
					const anns = await annRes.json() as Array<{ annotation_level: string; message: string }>;
					for (const a of anns.slice(0, 4)) out.push(`${a.annotation_level}: ${a.message}`);
				}
			}
		} catch { /* bez důvodu je zpráva pořád užitečná */ }
	}
	return out.join("\n").slice(0, 600);
}

/** Nakopnout deploy ručním spuštěním workflow. */
async function kick(env: Env, dry: boolean): Promise<boolean> {
	if (dry) return true;
	try {
		const res = await fetchWithTimeout(
			`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${env.GITHUB_TOKEN}`,
					Accept: "application/vnd.github+json",
					"User-Agent": "ecamx-cron/1.0",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ ref: "main" }),
			});
		// `workflow_dispatch` vrací 204 bez těla.
		return res.status === 204 || res.ok;
	} catch {
		return false;
	}
}

/**
 * Rozhodne, co s tím. Bez vedlejších účinků — používá se i pro `?dry=1`,
 * aby se plán dal porovnat s `ecamx-deploy-watch.py --dry-run` znak po znaku.
 */
export async function plan(env: Env): Promise<WatchPlan> {
	const { age, note } = await buildAge();
	/**
	 * **Bez `GITHUB_TOKEN` se dá žít — jen se nedá nakopnout CI.**
	 *
	 * Token, který má `gh` na Malině, má scopes `repo` + `workflow` pro CELÝ
	 * účet; takový do Workeru nepatří (viz D77). Než Kenny vytvoří
	 * fine-grained PAT jen na `HuyKenny/ecamx`, poběží Worker v tomhle režimu:
	 * **hlásí dál** (to je hlavní hodnota), ale kick nezkusí a napíše to.
	 * Tichý půlprovoz by byl horší než žádný.
	 */
	const hasGh = Boolean(env.GITHUB_TOKEN);
	const run = hasGh ? await lastRun(env) : {
		conclusion: "", status: "?", displayTitle: "?", databaseId: null, createdAt: "?",
		error: "bez GITHUB_TOKEN",
	};
	const concl = run.conclusion || run.status || "?";
	const problems: string[] = [];
	if (concl === "failure") {
		problems.push(`poslední CI běh selhal (${run.createdAt.slice(0, 16)} UTC)`);
	}
	if (age !== null && age > MAX_AGE_HOURS) {
		problems.push(`nasazený build je ${age.toFixed(1)} h starý`);
	}
	if (age === null && note && note.includes("neodpovídá")) problems.push(note);

	const running = run.status === "in_progress" || run.status === "queued";
	const staleOnly = age !== null && age > KICK_AFTER_HOURS && concl !== "failure" && !running;

	const base = {
		ageHours: age === null ? null : Math.round(age * 10) / 10,
		ageNote: note, conclusion: concl, running, displayTitle: run.displayTitle,
		runId: run.databaseId, problems,
	};

	// **Zastaralý build zkusit nejdřív spravit, ne hned hlásit.** Když CI
	// neselhalo a nic neběží, je to jen nespuštěný plán GitHubu — na to stačí
	// `workflow_dispatch`. Poplach přijde, až když ani to nepomůže.
	if (staleOnly && !hasGh) {
		// Kick není čím provést → rovnou se hlásí. Pocit „zařídili jsme to"
		// by tu byl lež.
		problems.push("nelze nakopnout CI — chybí GITHUB_TOKEN ve Workeru");
	} else if (staleOnly) {
		const st = await loadState(env);
		const fresh = st.kicked && (Date.now() - Date.parse(st.kicked)) / 1000 < KICK_COOLDOWN_SEC;
		if (!fresh) {
			return { ...base, action: "kick", message: `build ${age.toFixed(1)} h starý, CI je zelené a nic neběží → nakopnuto` };
		}
	}

	// Když zrovna běh probíhá, nemá smysl křičet — počká se na výsledek.
	if (running && problems.length && concl !== "failure") {
		return { ...base, action: "none", message: `běh právě probíhá (${run.status}), poplach se odkládá` };
	}

	if (!problems.length) {
		return {
			...base, action: "none",
			message: `ok: CI ${concl}, build ${age !== null ? `${age.toFixed(1)} h` : `? (${note})`}`,
		};
	}

	// Když je nasazený build čerstvý, web NEZAMRZL — jen CI nejede. Hlásit
	// „web zamrzl" by bylo zavádějící: spravit se musí CI, ne web.
	const fresh = age !== null && age <= MAX_AGE_HOURS;
	const head = fresh
		? "🟠 **ecamx.com: CI nejede, web je zálohovaný**"
		: "🔴 **ecamx.com: web zamrzl**";
	let message = head + "\n"
		+ problems.map((p) => `• ${p}`).join("\n")
		+ `\n• poslední běh: \`${run.displayTitle.slice(0, 70)}\` → \`${concl}\``;
	if (concl === "failure" && run.databaseId) {
		const why = await failureReason(env, run.databaseId);
		if (why) message += `\n\`\`\`\n${why}\n\`\`\``;
	}
	return { ...base, action: "alert", message };
}

/** Provede plán: nakopne, nebo pošle hlášku (s potlačením opakování). */
export async function run(env: Env, dry = false): Promise<WatchPlan> {
	const p = await plan(env);
	logf("deploy-watch", { ...p });

	if (p.action === "kick") {
		if (await kick(env, dry)) {
			if (!dry) await saveState(env, { ...(await loadState(env)), kicked: new Date().toISOString() });
		}
		return p;
	}

	const state = await loadState(env);
	if (p.action === "none" && !p.problems.length) {
		if (state.open) {
			if (!dry) {
				await discord(env, `✅ **ecamx.com**: deploy zase jede — CI \`${p.conclusion}\`, build `
					+ (p.ageHours !== null ? `${p.ageHours.toFixed(1)} h starý.` : "nasazen."));
			}
			await saveState(env, {});
		} else if (state.kicked && !dry) {
			// Nakopnutí zabralo a nikdo se to nedozvěděl — přesně tak to má být.
			await saveState(env, {});
		}
		return p;
	}

	if (p.action !== "alert") return p;

	const since = state.last_alert ? (Date.now() - Date.parse(state.last_alert)) / 3_600_000 : 1e9;
	const repeat = p.ageHours !== null && p.ageHours <= MAX_AGE_HOURS ? REPEAT_HOURS_FRESH : REPEAT_HOURS;
	if (since < repeat) {
		logf("deploy-watch", { suppressed: true, sinceHours: Math.round(since * 10) / 10 });
		return p;
	}
	if (dry) return p;
	if (await discord(env, p.message)) {
		await saveState(env, { ...state, open: true, last_alert: new Date().toISOString() } satisfies WatchState);
	}
	return p;
}
