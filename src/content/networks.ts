/**
 * Recenze cam sítí. Nejcennější stránky na webu — „chaturbate review" a spol.
 * mají reálný nákupní záměr, na rozdíl od profilů modelek.
 *
 * ZÁMĚRNĚ tu nejsou konkrétní ceny v dolarech. Sítě je mění a špatná cena je
 * horší než žádná. Popisuje se cenový MODEL (tokeny vs. minuty), ten je stabilní.
 */
import type { NetworkId } from '../lib/data';

export interface NetworkReview {
	/** Jednovětné shrnutí pod H1. */
	tagline: string;
	/** Odstavce úvodu. */
	intro: string[];
	howItWorks: string[];
	free: string[];
	bestFor: string;
	watchOut: string;
	verdict: string;
	/** Kdy byla recenze naposledy revidovaná. */
	updated: string;
}

export const NETWORK_REVIEWS: Record<NetworkId, NetworkReview> = {
	chaturbate: {
		tagline: 'The biggest freemium cam site, and the one where most people start.',
		intro: [
			'Chaturbate is the largest cam platform by active broadcasters, and it is the backbone of most cam directories including this one. On any given evening it has more models online than the next two sites combined.',
			'Its defining feature is that the public room is genuinely free. You can watch a full show without an account, without a card, and without a countdown timer. The site makes its money when viewers choose to tip.',
		],
		howItWorks: [
			'Everything runs on tokens. You buy tokens in bulk, then tip them to performers — either freely or toward a goal the model sets for the room.',
			'Most rooms run on a goal system: the room shows a target, tips push a bar toward it, and the model does something specific when it fills. This is why Chaturbate rooms feel collective rather than one-to-one.',
			'Private shows exist and are billed per minute in tokens, but they are a minority of activity. The public room is the main event.',
			'Lovense and similar toys are deeply integrated — tips trigger the device directly, which is why you will see "lovense" as one of the most common tags on this site.',
		],
		free: [
			'Full public shows, unlimited, with no account.',
			'Chat is read-only until you register; registering is free and needs no card.',
			'Model profiles, schedules and photo galleries.',
		],
		bestFor: 'Anyone who wants to watch without spending, and anyone who likes the energy of a busy room. The amateur end of the market is far better represented here than on premium sites.',
		watchOut: 'Because entry is free, rooms can be crowded and chat moves fast. If you want undivided attention you will be paying for a private, and at that point premium sites are competitive.',
		verdict: 'The default choice. If you only ever use one cam site, this is the rational one — the free tier is real and the roster is the deepest.',
		updated: '16 August 2026',
	},

	camsoda: {
		tagline: 'Freemium like Chaturbate, but smaller, cheaper and more experimental.',
		intro: [
			'CamSoda runs the same broad model as Chaturbate — free public rooms funded by tips — but with a smaller roster and a noticeably more playful approach. It is the site that keeps trying gimmicks: celebrity guest streams, VR experiments, unusual promotions.',
			'For viewers, the practical difference is price. Tips tend to go further here, and models often set lower goals than they would on a bigger platform.',
		],
		howItWorks: [
			'Token-based, same as Chaturbate. Buy tokens, tip them into the room.',
			'Goal-driven public shows are standard, with private and group options available per minute.',
			'The site pushes bundles and first-purchase promotions hard; if you intend to spend anything, it is worth waiting for one.',
		],
		free: [
			'Public rooms are free to watch without an account.',
			'Preview thumbnails update live, so you can see what is happening before clicking in.',
		],
		bestFor: 'Viewers who want the freemium format but find the biggest sites overwhelming, and anyone who is price-sensitive about tipping.',
		watchOut: 'A smaller roster means quieter hours. Early mornings in Europe can be thin compared with Chaturbate.',
		verdict: 'A genuine alternative rather than a clone. Worth having open alongside a bigger site rather than instead of one.',
		updated: '16 August 2026',
	},

	cam4: {
		tagline: 'The most balanced site for gay, male and couple broadcasters.',
		intro: [
			'Cam4 has been running since the mid-2000s and has a distinctly European character. Where most cam platforms are overwhelmingly female-performer sites with a small male section bolted on, Cam4 has a real audience across all categories.',
			'If you are looking for male or couple broadcasters, this is the platform where you will find the deepest roster rather than a token handful.',
		],
		howItWorks: [
			'Freemium with tokens. Public rooms are free, tipping drives the show.',
			'Private shows are available per minute, and group shows let several viewers split the cost.',
			'Broadcast quality varies more than on premium sites — Cam4 is permissive about who can stream, which is both its strength and its weakness.',
		],
		free: [
			'Full public rooms without an account.',
			'A large amount of genuinely amateur content that never appears on curated sites.',
		],
		bestFor: 'Gay, bi and couple audiences, and anyone who prefers amateur broadcasters over polished studio production.',
		watchOut: 'Stream quality and reliability are inconsistent. Expect some rooms to be low resolution or to drop.',
		verdict: 'The best site on this list if your interests fall outside the straight-male-viewer default that the industry is built around.',
		updated: '16 August 2026',
	},

	amateur: {
		tagline: 'Spanish-language focused, genuinely amateur, small but distinctive.',
		intro: [
			'Amateur.tv is the smallest platform in this directory and the most specific. Its roster is heavily Spanish and Latin American, and the site makes no attempt to be a global all-rounder.',
			'The trade-off is character. Rooms feel less like a production and more like someone broadcasting from their bedroom, which is exactly what a substantial audience wants.',
		],
		howItWorks: [
			'Freemium with a credit system. Public rooms are open, private shows are billed separately.',
			'The player is a JavaScript widget rather than a standard iframe, which is why streams from this platform occasionally behave differently on aggregator sites like this one.',
		],
		free: [
			'Public rooms without registration.',
			'A roster you will not find duplicated across the bigger platforms.',
		],
		bestFor: 'Spanish speakers, and anyone specifically looking for amateur rather than professional broadcasters.',
		watchOut: 'Expect around a hundred models online rather than thousands. If you want choice by volume, look elsewhere.',
		verdict: 'A niche site that knows what it is. Worth a look if the mainstream platforms feel too polished.',
		updated: '16 August 2026',
	},

	bongacams: {
		tagline: 'Huge Eastern European roster, aggressive promotions, busy interface.',
		intro: [
			'BongaCams is one of the largest platforms in Europe, with a roster weighted heavily toward Eastern Europe and Russia. It is also the most promotion-driven site on this list — free token offers, bonuses and loyalty tiers are constant.',
			'The interface is busier than its competitors, with more of the screen given over to upsells. Whether that is energetic or exhausting depends on your tolerance.',
		],
		howItWorks: [
			'Token-based freemium. Public rooms are free, tipping unlocks activity.',
			'Private and group shows are billed per minute.',
			'The site runs a tiered loyalty system that reduces effective costs for regular spenders, which is unusual in this market.',
		],
		free: [
			'Public rooms without an account.',
			'New accounts are routinely given free tokens — the offer changes but is almost always running.',
		],
		bestFor: 'Viewers who want a large Eastern European roster and who do not mind a hard-sell interface.',
		watchOut: 'The promotional pressure is relentless, and the model profile data is more detailed than most, which can make browsing feel like filling in a form.',
		verdict: 'Strong roster, weaker experience. Best reached through a directory like this one, where you can pick a room without wading through the upsells.',
		updated: '16 August 2026',
	},

	xlovecam: {
		tagline: 'European, private-show oriented, pay by the minute.',
		intro: [
			'XLoveCam comes out of the French market and operates closer to the premium end than the freemium one. The emphasis is on one-to-one private shows rather than crowded public rooms funded by tips.',
			'That makes it a different proposition from Chaturbate: less free content, but more attention when you do pay.',
		],
		howItWorks: [
			'Per-minute billing for private shows is the primary model, rather than tipping into a public room.',
			'Free previews let you see the model before committing, but the substantive show happens in private.',
			'Because pricing is per minute, costs are predictable in a way that open-ended tipping is not.',
		],
		free: [
			'Preview access to rooms.',
			'Browsing full model profiles and schedules.',
		],
		bestFor: 'Viewers who prefer one-to-one interaction and want to know exactly what a session will cost before starting it.',
		watchOut: 'If you are looking for free entertainment, this is the wrong platform. The free tier is a shop window, not the product.',
		verdict: 'A sound choice for private shows and a poor one for casual browsing. Know which you want before you arrive.',
		updated: '16 August 2026',
	},

	livejasmin: {
		tagline: 'The premium end: highest production quality, least free content.',
		intro: [
			'LiveJasmin is the most polished platform in this directory and the most commercial. Streams are consistently high definition, models are typically working from purpose-built setups, and the whole experience is closer to a studio than a bedroom.',
			'It is also the platform where the free tier is thinnest. The business model is private shows, and everything is arranged to move you toward one.',
		],
		howItWorks: [
			'Per-minute billing for private shows, purchased in credits.',
			'Free chat rooms exist but function as a preview — explicit activity happens in private.',
			'Model profiles are unusually detailed, with verified attributes, which is why this platform supplies most of the ethnicity, hair and body data you see in our filters.',
		],
		free: [
			'Free chat with models, including video preview.',
			'Full profile browsing and scheduling.',
		],
		bestFor: 'Viewers who prioritise production quality and are prepared to pay for private time. Also the best platform if you want reliable, structured information about who you are watching.',
		watchOut: 'Costs add up quickly at per-minute rates, and the free tier will not satisfy anyone looking for a free show.',
		verdict: 'The premium option, and honest about it. If Chaturbate is a bar, LiveJasmin is a hotel — you get what you pay for, and you do pay.',
		updated: '16 August 2026',
	},

	stripchat: {
		tagline: 'The other giant freemium site — as big as Chaturbate, built around toys and filters.',
		intro: [
			'Stripchat is the second platform in this directory that can put thousands of models online at once, and on some evenings it beats Chaturbate on raw numbers. It runs the same freemium logic: public rooms are free, tips pay for everything.',
			'What sets it apart is how aggressively it is organised. Almost every model carries a full set of attributes — body type, hair, ethnicity, languages — which is why this site fills our filters better than most. Age is the one thing it usually leaves blank.',
		],
		howItWorks: [
			'Tokens, bought in bundles and tipped into the room or spent on private time.',
			'Interactive toys are central here rather than optional; a large share of rooms respond to tips directly.',
			'Alongside free public rooms there are private, spy and group modes, priced per minute in tokens.',
			'The site pushes a paid membership tier that mostly buys perks and discounts rather than content.',
		],
		free: [
			'Public rooms, unlimited, without an account.',
			'Filtering by attributes and tags, which is unusually good on this platform.',
			'Model profiles with photos and, where the model sets one, a schedule.',
		],
		bestFor: 'Viewers who want the scale of Chaturbate with better browsing, and anyone specifically after toy-driven rooms.',
		watchOut: 'The interface pushes upsells harder than Chaturbate does, and public ages are often missing, so "how old is she" is frequently unanswerable from the profile alone.',
		verdict: 'A genuine alternative to Chaturbate rather than a smaller copy. If the room you wanted is dark, this is the first place to look next.',
		updated: '25 August 2026',
	},

	streamate: {
		tagline: 'Per-minute premium with the most complete profiles in this directory.',
		intro: [
			'Streamate does not use tokens. Shows are billed by the minute, in currency, which makes it the most predictable platform here for anyone who dislikes converting money into points first.',
			'It is also the best-documented roster we ingest: country, age, languages, ethnicity, body type, hair and eye colour are filled in for effectively every model, and every room carries a live preview image.',
		],
		howItWorks: [
			'Per-minute billing for shows, charged directly rather than through a token balance.',
			'Free chat and a video preview come first; explicit content happens in the paid show.',
			'Gold and premium tiers exist and mostly buy discounts and perks rather than access.',
		],
		free: [
			'Browsing, previews and text chat without paying.',
			'Full profile data — this is the platform where "who am I watching" is actually answered.',
		],
		bestFor: 'Viewers who want a clear price per minute instead of a token maths problem, and anyone who filters by concrete attributes.',
		watchOut: 'The free tier is a preview, not a show. A card is required before anything explicit, and per-minute rates add up faster than they look.',
		verdict: 'The most transparent pricing model in this directory paired with the best data. Worth it if you know what you want and dislike surprises.',
		updated: '25 August 2026',
	},

	imlive: {
		tagline: 'One of the oldest cam sites, built around per-minute shows and constant discounts.',
		intro: [
			'ImLive has been running since the early 2000s and its structure reflects that era: shows are paid by the minute from a credit balance, and the site leans heavily on discounts, bundles and loyalty tiers.',
			'The roster is the smallest we ingest — hundreds of rooms rather than thousands — but the profiles are detailed, with age filled in for effectively everyone.',
		],
		howItWorks: [
			'Credits bought up front, spent per minute in private or group shows.',
			'Group shows split the per-minute cost between viewers, which is the cheapest way to see paid content on this platform.',
			'Discount mechanics are permanent rather than promotional; the advertised rate is rarely the rate you pay.',
		],
		free: [
			'Browsing and previews without paying.',
			'Free chat before a show starts.',
		],
		bestFor: 'Viewers who like group shows and do not mind an older interface. The small roster makes it easy to see everyone who is online.',
		watchOut: 'The feed gives no country information at all, so location filters do not reach this platform. Expect the site to steer you toward bundles.',
		verdict: 'A small, old-school platform that still does group shows better than the freemium giants. Not a first stop, but not a filler either.',
		updated: '25 August 2026',
	},
};
