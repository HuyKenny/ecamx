// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://ecamx.com',

  // KRITICKÉ: 'static', ne 'server'. Katalog se generuje při buildu do ~2 000
  // statických stránek — requesty na statické assety jsou na Cloudflare zdarma
  // a neomezeně, takže Worker se u běžné návštěvy vůbec nespustí.
  // Jediná dynamická route je /api/online/[network], která má prerender = false.
  // Limit free plánu je 20 000 souborů na deployment → viz docs/DECISIONS.md D1.
  output: 'static',

  // `imageService: 'passthrough'` — obrázky jsou cizí hotlinky z CDN sítí, nic
  // nezpracováváme. Bez tohohle adaptér přidá binding `IMAGES`, který nepoužijeme.
  adapter: cloudflare({ imageService: 'passthrough' }),

  // Sessions vypnuté. Adaptér je jinak zapíná automaticky a vygeneruje
  // `kv_namespaces: [{binding: "SESSION"}]` BEZ `id` — s tím `wrangler deploy`
  // buď spadne, nebo si založí zbytečný namespace. Web je statický a nemá stav.
  session: false,

  // Trailing slash držíme konzistentně, jinak vznikají duplicitní URL
  // (starý WP web jel s lomítkem, zachováváme kvůli /live/{slug}/).
  trailingSlash: 'always',

  vite: { plugins: [tailwindcss()] },
});
