/**
 * „Čím se X liší od Chaturbate" — text pro `/site/{síť}/alternatives/`.
 *
 * Cílový dotaz je měřený: „sites like chaturbate" 748/měs + „websites like
 * chaturbate" 340 při **KD 21**, plus „chaturbate alternatives" 321 při KD 0.
 * To je nejlepší poměr objemu a obtížnosti, jaký na tomhle webu je.
 *
 * **Nerecykluje se `intro`/`verdict` z `networks.ts`.** Ty popisují síť samu
 * o sobě a jsou na `/site/{síť}/`; kdyby se sem zkopírovaly, vznikne duplicita
 * dvou URL na tutéž věc. Tady se píše výhradně **rozdíl proti Chaturbate**.
 *
 * Čísla ve větách se sem NEPÍŠOU — jsou živá a mění se každé 2 h, takže je
 * doplňuje šablona z `networkStats()`. Ručně psaný je jen ten rozdíl, který
 * z dat nevyčteš.
 */
import type { NetworkId } from '../lib/data';

export interface NetworkCompare {
	/** Jedna věta do tabulky: kdy sáhnout po téhle síti místo Chaturbate. */
	insteadWhen: string;
	/** Dva až tři odstavce rozdílu. */
	body: string[];
}

/**
 * Pro které sítě stránka „sites like X" existuje. Jedna, protože jen u Chaturbate
 * je poptávka změřená — u ostatních se nejdřív měří, pak se přidává URL.
 * Čte to `getStaticPaths()`, odkaz na recenzi i sitemapa, ať to nemá tři pravdy.
 */
export const ALTERNATIVES_FOR: NetworkId[] = ['chaturbate'];

/** Klíčem je síť, se kterou se Chaturbate porovnává. */
export const COMPARE_WITH_CHATURBATE: Partial<Record<NetworkId, NetworkCompare>> = {
	camsoda: {
		insteadWhen: 'You want the same free-to-watch format but cheaper goals and a smaller, less frantic room.',
		body: [
			'CamSoda runs the identical model to Chaturbate — public rooms funded by tips — so nothing about how you watch changes. What changes is scale. Chaturbate is several times larger, and that shows up in the rooms: on Chaturbate the median room has single-digit viewers while the big rooms run into the tens of thousands, which means the popular shows move fast and a tip has to compete for attention. CamSoda rooms sit in the middle of that range far more often.',
			'The practical trade-off is discovery versus attention. If you know what you are looking for, Chaturbate almost certainly has more of it live right now. If you want to be noticed in chat without spending a lot, CamSoda is the better room to walk into.',
			'One structural difference worth knowing before you filter: CamSoda publishes almost nothing about its models in its feed — no age, no country, no HD flag. That is a property of the site, not of its performers, and it is why searching CamSoda by attributes anywhere on the web gives thin results.',
		],
	},
	bongacams: {
		insteadWhen: 'You want Eastern European performers, or you care about filtering by ethnicity, hair and body type.',
		body: [
			'BongaCams is where the catalogue tilts hardest towards Eastern Europe — Russia, Ukraine, Latvia and their neighbours dominate its roster in a way they do not on Chaturbate, which skews Latin American. If that is what you are looking for, you are choosing between a big site with a smaller share and a smaller site with a much larger share.',
			'It is also one of only two networks we track that publishes structured appearance data (ethnicity and hair colour) alongside every model. Chaturbate publishes none of it — its rooms are described by free-text tags the performer writes herself. That is invisible on the sites themselves, but it is exactly why some filters on eCamx cover BongaCams and LiveJasmin and skip the rest.',
			'Interactive toys are the other visible difference: BongaCams flags them in its feed on the majority of rooms. Chaturbate rooms use them at least as much, but you have to read the tags to find out.',
		],
	},
	cam4: {
		insteadWhen: 'You are looking for men, couples or trans performers rather than solo women.',
		body: [
			'Every cam site is majority women, but the majorities differ enormously, and Cam4 has the most mixed roster of the seven we track. If you open Chaturbate looking for male or couple broadcasters you are filtering a small slice of a very large site; on Cam4 you are browsing a much larger share of a smaller one.',
			'The viewing model is the same freemium one, so nothing you learned on Chaturbate stops applying. Room sizes are smaller across the board, which cuts both ways — less spectacle, more chance of being talked to.',
		],
	},
	livejasmin: {
		insteadWhen: 'You want a premium one-to-one show and production quality rather than a busy free room.',
		body: [
			'LiveJasmin is the one genuine format change on this list. Chaturbate is built around a public room where the show is collective and free, and tipping pushes a shared goal. LiveJasmin is built around the private show: the free area is a preview, and the actual experience is billed per minute, one-to-one.',
			'That difference shows in the roster too. Production values are consistently higher — lighting, cameras, sets — because performers are competing on the paid experience rather than on keeping a free room entertained. If you have ever felt that a free room is a lottery, this is the trade you are looking for.',
			'It is also the only network we track that publishes body type alongside ethnicity and hair, which makes it the most filterable of the seven — and the reason its models turn up in appearance-based categories more often than their share of the catalogue would suggest.',
		],
	},
	xlovecam: {
		insteadWhen: 'You want European performers, especially French-speaking ones.',
		body: [
			'XLoveCam is the most European roster of the seven, with a French and Southern European core that barely registers on Chaturbate. It is a small site by comparison, so treat it as a specific place to look rather than a replacement.',
			'Be aware of one thing before you compare numbers anywhere: XLoveCam does not publish viewer counts at all. Any "most popular" list that ranks it against Chaturbate is either guessing or quietly leaving it out. We say "not published" instead of writing a zero.',
		],
	},
	amateur: {
		insteadWhen: 'You want Spanish-language rooms and a genuinely amateur, small-room feel.',
		body: [
			'Amateur.tv is the smallest network we track and the most Spanish-language one. It is not a Chaturbate replacement by size — it is a different neighbourhood, with rooms that stay small enough that chat is a conversation rather than a scroll.',
			'Technically it is also the odd one out: it has no embeddable player of the kind the other six provide, which is why its models appear here with a link out rather than an inline stream.',
		],
	},
};
