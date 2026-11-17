/**
 * Chaturbate embed s chatem (D86) má pevné desktopové rozvržení: pod ~900 px
 * se chat nevejde a z rámce zbude useknuté video nad bílou plochou. Na úzké
 * obrazovce proto jede jen video (16:9, `.theater.is-chat` tam drží výchozí
 * poměr v CSS) a chat obstará CTA pod přehrávačem.
 */
export const NARROW_MQ = '(max-width: 899px)';

export function fitEmbed(src: string): string {
	if (!/^https:\/\/chaturbate\.com\/embed\//.test(src) || src.includes('embed_video_only')) return src;
	if (typeof matchMedia !== 'function' || !matchMedia(NARROW_MQ).matches) return src;
	return src + (src.includes('?') ? '&' : '?') + 'embed_video_only=1';
}
