/**
 * Guides (D91): `/guides/{slug}/`, Markdown in `src/content/guides/`.
 *
 * Numbers in the text never come from the writer's head: live counts are
 * placeholders (`{{live:chaturbate}}`, see `src/lib/guide-stats.ts`) filled
 * at build, everything else is a dated measurement or a cited source (D26/D48).
 */
import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const guides = defineCollection({
	loader: glob({ pattern: '*.md', base: './src/content/guides' }),
	schema: z.object({
		title: z.string().max(65),
		description: z.string().max(160),
		h1: z.string(),
		/** Main search phrase the guide is written for (from the keyword report). */
		keyword: z.string(),
		updated: z.coerce.date(),
		/** Order on /guides/ — lower first. */
		order: z.number().default(50),
		photo: z.object({
			src: z.string(),
			width: z.number(),
			height: z.number(),
			alt: z.string(),
			by: z.string(),
			url: z.string().url(),
		}),
		faq: z.array(z.object({ q: z.string(), a: z.string() })).default([]),
		/** Our own pages this guide should send readers to. */
		related: z.array(z.object({ href: z.string(), label: z.string() })).default([]),
		sources: z.array(z.object({ label: z.string(), url: z.string().url() })).default([]),
	}),
});

export const collections = { guides };
