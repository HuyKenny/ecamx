/**
 * Ikony webu z vektorové značky (`public/logo-mark.svg`, D83). Ruční krok —
 * spouští se jen když se změní logo, výstupy jsou commitnuté v `public/`.
 *
 *   node scripts/assets.mjs
 *
 * Zdroje grafiky z Canvy (logo, maskot, OG) leží v `design/src/`.
 */
import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'node:fs';

const SVG = readFileSync('public/logo-mark.svg');
const BG = '#16161c';

async function png(size, { pad = 0, bg = null } = {}) {
	const inner = Math.round(size * (1 - pad * 2));
	let img = sharp(SVG, { density: 512 }).resize(inner, inner);
	const buf = await img.png().toBuffer();
	const base = sharp({
		create: { width: size, height: size, channels: 4, background: bg ?? { r: 0, g: 0, b: 0, alpha: 0 } },
	});
	return base.composite([{ input: buf, gravity: 'center' }]).png({ compressionLevel: 9 }).toBuffer();
}

const out = {
	'public/favicon-32.png': await png(32),
	'public/favicon-180.png': await png(180, { pad: 0.08, bg: BG }),
	'public/icon-192.png': await png(192, { pad: 0.04 }),
	'public/icon-512.png': await png(512, { pad: 0.04 }),
	// Maskable: obsah v bezpečné zóně (80 %), pozadí přes celou plochu.
	'public/icon-maskable-512.png': await png(512, { pad: 0.14, bg: BG }),
};
for (const [p, b] of Object.entries(out)) writeFileSync(p, b);

// favicon.ico = PNG uvnitř ICO kontejneru (podporují všechny prohlížeče od IE11).
const ico32 = out['public/favicon-32.png'];
const head = Buffer.alloc(22);
head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(1, 4);
head.writeUInt8(32, 6); head.writeUInt8(32, 7); head.writeUInt8(0, 8); head.writeUInt8(0, 9);
head.writeUInt16LE(1, 10); head.writeUInt16LE(32, 12);
head.writeUInt32LE(ico32.length, 14); head.writeUInt32LE(22, 18);
writeFileSync('public/favicon.ico', Buffer.concat([head, ico32]));

writeFileSync('public/manifest.webmanifest', JSON.stringify({
	name: 'eCamx — live cams',
	short_name: 'eCamx',
	start_url: '/',
	display: 'standalone',
	background_color: BG,
	theme_color: BG,
	icons: [
		{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
		{ src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
		{ src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
	],
}, null, '\t') + '\n');

console.log('ikony hotové:', Object.keys(out).length + 2, 'souborů');
