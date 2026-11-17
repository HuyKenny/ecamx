/**
 * Model z katalogu → `CardData` pro `cardHtml()`. Jen pro build (sahá na
 * `data.ts`); prohlížeč a Worker dostávají `CardData` rovnou z API.
 */
import { linkableCategories, type Model } from './data';
import type { CardData } from './card';

export function toCard(m: Model, stale = true): CardData {
	return {
		n: m.network, u: m.displayName, p: m.page, s: m.slug,
		t: m.thumbnail ?? '',
		...(m.thumbnailFallback ? { tf: m.thumbnailFallback } : {}),
		...(m.viewers ? { v: m.viewers } : {}),
		...(m.isHd ? { h: 1 as const } : {}),
		...(m.isNew ? { nw: 1 as const } : {}),
		...(m.toy ? { ty: 1 as const } : {}),
		...(m.country ? { c: m.country } : {}),
		...(m.age ? { a: m.age } : {}),
		...(m.previewVideo ? { pv: m.previewVideo } : {}),
		tg: linkableCategories(m, 2).map((f) => f.slug),
		...(stale ? { stale: 1 as const } : {}),
	};
}

/** Seznam modelek → karty pro `LiveGrid` (statické, „stale" do živého průchodu). */
export function toCards(models: Model[]): CardData[] {
	return models.map((m) => toCard(m));
}

/**
 * Odkazy v textech kategorií na `/cams/{slug}/`, které v tomhle buildu
 * neexistují (faseta spadla pod práh, D44), se mění v obyčejný text — jinak
 * by každý pokles nabídky rozbil build guardem rozbitých odkazů (17. 11. 2026
 * `findom` → `goddess`).
 */
export function unlinkMissingCategories(html: string, exists: (slug: string) => boolean): string {
	return html.replace(/<a href="\/cams\/([a-z0-9-]+)\/">([^<]*)<\/a>/g,
		(m, slug: string, label: string) => (exists(slug) ? m : label));
}
