/**
 * `hls.js/light` je tentýž kód bez titulků, alternativních zvukových stop a EME
 * — menší o polovinu, a nic z vynechaného u cam streamů nepotřebujeme. Balík
 * ale pro tuhle podcestu neposílá typy (`exports` u `./light` nemá `types`),
 * takže se ukazují na hlavní build. Bez tohohle je `Hls` typu `any` a
 * `astro check` na tom padá. Viz D62.
 */
declare module 'hls.js/light' {
	export * from 'hls.js';
	export { default } from 'hls.js';
}
