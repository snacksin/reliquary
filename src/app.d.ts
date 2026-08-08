// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		/**
		 * Stamped by the auth gate in hooks.server.ts on every request.
		 * gated = a password is set (the gate enforces); authed = this
		 * request carries a valid session. Both false when the app is
		 * open (no password — the switch model).
		 */
		interface Locals {
			gated: boolean;
			authed: boolean;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
