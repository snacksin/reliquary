// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		/**
		 * Error hygiene (M2.2 Step 4): `id` is the short server-log
		 * correlation id minted by handleError for unexpected errors —
		 * the only extra detail an error response ever carries.
		 */
		interface Error {
			message: string;
			id?: string;
		}
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
