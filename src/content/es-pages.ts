/**
 * Texty španělských stránek (D94). Ručně psané, každá stránka jiné věty —
 * šablona s vyměněným slovem by byla „scaled content". Čísla se sem NEPÍŠOU:
 * doplňuje je šablona z dat při buildu (`{n}` = modelek v kategorii živě,
 * `{sites}` = počet sítí). Cílové fráze z Ahrefs MX/global 22. 11. 2026.
 */
export interface EsPage {
	title: string;
	description: string;
	h1: string;
	/** Breadcrumb / odkaz v seznamu. */
	label: string;
	intro: string[];
	faq: Array<{ q: string; a: string }>;
}

export const ES_PAGES: Record<string, EsPage> = {
	'': {
		// sexo en vivo 136k (KD 18) · porno en vivo 458k (KD 48) · xxx en vivo 81k · videos porno en vivo 17k (KD 0)
		title: 'Sexo en Vivo – {n} Cams Porno en Directo Gratis',
		description: 'Sexo en vivo gratis: {n} webcams porno en directo de {sites} sitios en una sola página. Sin registro, solo cams que están emitiendo ahora mismo.',
		h1: 'Sexo en vivo: porno en directo, ahora mismo',
		label: 'Inicio',
		intro: [
			'eCamx junta los grandes sitios de webcams para adultos en una sola cuadrícula. En lugar de abrir Chaturbate, Stripchat, CamSoda y los demás por separado, ves aquí a quién está emitiendo en este momento y entras con un clic. Mirar es gratis y no hace falta crear cuenta.',
			'Comprobamos cada sitio cada cinco minutos, así que lo que aparece no son vídeos grabados ni perfiles abandonados: son shows de porno en vivo que están ocurriendo ahora. Si una modelo se desconecta, desaparece de la cuadrícula en la siguiente comprobación.',
		],
		faq: [
			{ q: '¿Es gratis ver sexo en vivo aquí?', a: 'Sí. Las salas públicas se ven gratis y sin registro. Solo pagas si decides dar propinas o pedir un show privado, y eso se hace en el propio sitio de la modelo.' },
			{ q: '¿Son vídeos grabados?', a: 'No. Solo mostramos salas que estaban emitiendo en nuestra última comprobación, hecha cada cinco minutos. No alojamos ni enlazamos grabaciones.' },
			{ q: '¿De qué sitios vienen las cams?', a: 'De {sites} sitios de webcams, entre ellos Chaturbate, Stripchat, CamSoda, BongaCams y Cam4. Al abrir una cam ves en qué sitio emite la modelo.' },
		],
	},
	'mujeres-desnudas': {
		// mujeres desnudas en vivo 20k (KD 1) · chicas desnudas en vivo 5,2k (KD 9) · chicas en vivo 2,1k
		title: 'Mujeres Desnudas en Vivo – {n} Chicas en Cam Ahora',
		description: 'Mujeres desnudas en vivo: {n} chicas en webcam emitiendo ahora mismo en {sites} sitios. Gratis, sin registro, actualizado cada cinco minutos.',
		h1: 'Mujeres desnudas en vivo',
		label: 'Chicas',
		intro: [
			'Aquí están solo las chicas: modelos que se presentan como mujeres y que están emitiendo en este momento. Hay de todo, desde salas tranquilas donde se charla hasta shows con meta de propinas, y puedes filtrar por sitio, edad o país.',
			'Las mujeres son la mayoría en todos los sitios de cams, pero no en la misma proporción: en unos casi todas las salas son de chicas solas y en otros hay muchas más parejas y hombres. Por eso juntarlas todas en una página te ahorra saltar de sitio en sitio.',
		],
		faq: [
			{ q: '¿Cuántas chicas hay en vivo ahora?', a: 'En nuestra última comprobación había {n} mujeres emitiendo en los {sites} sitios que seguimos. El número cambia a lo largo del día; de noche en Europa y América suele haber más.' },
			{ q: '¿Necesito una cuenta para verlas?', a: 'No. Las salas públicas se ven sin cuenta. La cuenta solo hace falta en el sitio de la modelo si quieres escribir en el chat o dar propinas.' },
			{ q: '¿Hay chicas latinas?', a: 'Muchas. Colombia es el país con más modelos en vivo en nuestras comprobaciones, y las encuentras todas en la categoría Latina (en inglés).' },
		],
	},
	tetonas: {
		// tetonas en vivo 3,5k (KD 0) · tetas en vivo 2k (KD 0)
		title: 'Tetonas en Vivo – {n} Cams de Tetas Grandes Ahora',
		description: 'Tetonas en vivo: {n} chicas de tetas grandes emitiendo en webcam ahora mismo. Gratis y sin registro, de {sites} sitios de cams a la vez.',
		h1: 'Tetonas en vivo',
		label: 'Tetonas',
		intro: [
			'Chicas con tetas grandes que están en cam ahora mismo. La lista sale de las etiquetas que cada modelo pone en su propia sala, así que no es una opinión nuestra: si ella se describe así, aparece aquí.',
			'Es una de las categorías más grandes en todos los sitios. Si buscas algo más concreto, combínala con el filtro de país o de edad encima de la cuadrícula.',
		],
		faq: [
			{ q: '¿Cómo decidís quién aparece como tetona?', a: 'No lo decidimos nosotros. Usamos las etiquetas que la propia modelo pone en su sala (por ejemplo «big tits» o «big boobs») en cualquiera de los {sites} sitios.' },
			{ q: '¿Están en vivo de verdad?', a: 'Sí. Solo mostramos salas que emitían en nuestra última comprobación; la cuadrícula se refresca sola mientras navegas.' },
			{ q: '¿Es gratis?', a: 'Mirar sí. Las propinas y los shows privados se pagan en el sitio de la modelo con sus fichas (tokens).' },
		],
	},
	gay: {
		// porno gay en vivo 11k (KD 0) · cam gay 18k (KD 1) · webcam gay 6,4k (KD 9) · sexo gay en vivo 4,9k (KD 6)
		title: 'Porno Gay en Vivo – {n} Cams Gay en Directo Ahora',
		description: 'Porno gay en vivo: {n} chicos en cam gay emitiendo ahora mismo en {sites} sitios. Webcams gay gratis, sin registro, solo salas en directo.',
		h1: 'Porno gay en vivo: cams gay en directo',
		label: 'Gay',
		intro: [
			'Cams gay que están en directo ahora: chicos solos, parejas de hombres y salas donde se charla antes de nada. Juntamos las webcams gay de todos los sitios que seguimos en una página, porque en la portada de cada sitio suelen quedar enterradas debajo de las chicas.',
			'No todos los sitios tienen la misma cantidad. Chaturbate concentra la mayor parte de los chicos en vivo y en algunos sitios casi no hay ninguno. Aquí no tienes que saber cuál es cuál.',
		],
		faq: [
			{ q: '¿Dónde hay más cams gay?', a: 'En nuestras comprobaciones, la mayoría de los hombres en vivo están en Chaturbate, el sitio más grande; el resto se reparte entre los demás. Esta página los junta todos para que no tengas que mirar sitio por sitio.' },
			{ q: '¿Cuál es la diferencia con la página de hombres?', a: 'Aquí están las salas que se etiquetan como gay. En «hombres» aparecen todos los chicos en vivo, incluidos los que emiten para un público femenino o bisexual.' },
			{ q: '¿Puedo ver sexo gay en vivo gratis?', a: 'Sí. Las salas públicas son gratis y no piden registro; solo pagas si das propinas o pides un privado.' },
		],
	},
	hombres: {
		// hombres desnudos en vivo 2k (KD 5) · hombres en vivo
		title: 'Hombres Desnudos en Vivo – {n} Chicos en Cam Ahora',
		description: 'Hombres desnudos en vivo: {n} chicos emitiendo en webcam ahora mismo en {sites} sitios. Gratis, sin registro, comprobado cada cinco minutos.',
		h1: 'Hombres desnudos en vivo',
		label: 'Hombres',
		intro: [
			'Todos los chicos que están en cam ahora mismo, sean gay, hetero o bisexuales. Es la vista más amplia: si buscas solo salas gay, la página de porno gay en vivo filtra por las etiquetas que ellos mismos ponen.',
			'Los hombres son minoría en los sitios de webcams y están repartidos de forma muy desigual, así que una página que los junta todos ahorra mucho tiempo.',
		],
		faq: [
			{ q: '¿Cuántos hombres hay en vivo?', a: 'En nuestra última comprobación había {n} chicos emitiendo en los {sites} sitios que seguimos.' },
			{ q: '¿Hay hombres heteros?', a: 'Sí. Esta página no filtra por orientación: aparecen todos los modelos que se presentan como hombres.' },
			{ q: '¿Hace falta registrarse?', a: 'No para mirar. Solo para escribir en el chat o dar propinas en el sitio del modelo.' },
		],
	},
	trans: {
		// webcam trans 2,9k (KD 7) · trans en vivo 600 (KD 0)
		title: 'Trans en Vivo – {n} Webcams Trans en Directo Ahora',
		description: 'Webcams trans en vivo: {n} chicas trans emitiendo ahora mismo en {sites} sitios de cams. Gratis, sin registro, solo salas en directo.',
		h1: 'Webcams trans en vivo',
		label: 'Trans',
		intro: [
			'Modelos trans que están en directo ahora mismo. Usamos la categoría que cada sitio asigna a la sala, así que la lista es la misma que verías en el sitio original, solo que de todos a la vez.',
			'Hay sitios donde las chicas trans son una parte visible del catálogo y otros donde casi no hay; aquí aparecen juntas, ordenadas por cuánta gente está mirando.',
		],
		faq: [
			{ q: '¿Cuántas modelos trans hay en vivo?', a: 'En nuestra última comprobación había {n} salas trans emitiendo en los {sites} sitios que seguimos.' },
			{ q: '¿En qué sitios hay más?', a: 'Chaturbate es, con diferencia, el sitio con más salas trans en nuestras comprobaciones; los demás aportan bastantes menos.' },
			{ q: '¿Es gratis?', a: 'Sí, mirar las salas públicas no cuesta nada. Pagas solo si quieres dar propinas o un show privado.' },
		],
	},
	milf: {
		// milf en vivo 800 (KD 1)
		title: 'MILF en Vivo – {n} Maduras en Webcam Ahora',
		description: 'MILF en vivo: {n} mujeres maduras emitiendo en webcam ahora mismo en {sites} sitios. Gratis y sin registro, solo cams en directo.',
		h1: 'MILF en vivo',
		label: 'MILF',
		intro: [
			'Mujeres maduras en cam ahora mismo. Entran aquí las modelos que se etiquetan como MILF o «mom» en su propia sala; no adivinamos edades por la imagen.',
			'Las salas de maduras suelen ser más tranquilas que las de chicas jóvenes, con menos gente y más conversación, así que es más fácil que te respondan en el chat.',
		],
		faq: [
			{ q: '¿Qué cuenta como MILF?', a: 'Una modelo que se describe así en su sala, con etiquetas como «milf» o «mom». La etiqueta la pone ella, no nosotros.' },
			{ q: '¿Cuántas hay ahora?', a: 'En nuestra última comprobación había {n} MILF en vivo en los {sites} sitios que seguimos.' },
			{ q: '¿Necesito cuenta?', a: 'No para mirar. Solo en el sitio de la modelo, si quieres chatear o dar propinas.' },
		],
	},
	anal: {
		// anal en vivo 1,8k (KD 0)
		title: 'Anal en Vivo – {n} Cams Anal en Directo Ahora',
		description: 'Anal en vivo: {n} modelos con shows anales en webcam ahora mismo en {sites} sitios. Gratis, sin registro, comprobado cada cinco minutos.',
		h1: 'Anal en vivo',
		label: 'Anal',
		intro: [
			'Salas cuya modelo usa la etiqueta anal. La lista sale de las etiquetas de la propia sala, en cualquiera de los sitios que seguimos, así que no es una clasificación nuestra.',
			'Que una sala tenga la etiqueta no significa que el show esté pasando justo ahora: es habitual que quede reservado para cuando se alcanza la meta de propinas, y el contador de la sala te dice cuánto falta.',
		],
		faq: [
			{ q: '¿El show anal es gratis?', a: 'Mirar la sala es gratis. Lo que pase en ella depende de la modelo y de las propinas; los shows privados se pagan en su sitio.' },
			{ q: '¿Cuántas salas hay ahora?', a: 'En nuestra última comprobación había {n} salas con la etiqueta anal en los {sites} sitios.' },
			{ q: '¿Son grabaciones?', a: 'No. Solo enlazamos salas en directo; no alojamos vídeos.' },
		],
	},
	squirt: {
		// squirt en vivo 700 (KD 0)
		title: 'Squirt en Vivo – {n} Cams de Squirt Ahora',
		description: 'Squirt en vivo: {n} chicas que anuncian squirt en su sala de webcam ahora mismo. Gratis, sin registro, de {sites} sitios de cams.',
		h1: 'Squirt en vivo',
		label: 'Squirt',
		intro: [
			'Modelos que usan la etiqueta squirt en su sala. La etiqueta la pone ella: nosotros solo juntamos las salas de todos los sitios y quitamos las que ya no están en directo.',
			'En muchas salas el show depende de una meta de propinas, así que vale la pena mirar el contador para saber si está cerca o si todavía falta mucho.',
		],
		faq: [
			{ q: '¿Cuándo pasa el squirt?', a: 'Depende de la modelo. Si lo ata a una meta de propinas, la cuenta atrás se ve en la propia sala.' },
			{ q: '¿Cuántas salas hay ahora?', a: 'En nuestra última comprobación había {n} salas con la etiqueta squirt en los {sites} sitios.' },
			{ q: '¿Es gratis mirar?', a: 'Sí, las salas públicas son gratis y sin registro.' },
		],
	},
};
