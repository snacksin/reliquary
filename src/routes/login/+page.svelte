<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { login } from '$lib/api';

	/**
	 * The login screen — pixel port of Allie's Login.dc.html mock.
	 * Owns its fixed lavender identity across all app themes (its own
	 * look by decision — no --reader-* vars anywhere here). Fonts are
	 * self-hosted (static/fonts) per the offline principle. The canvas
	 * sparkle system, the logo's open-the-book easter egg, and the
	 * wrong-passphrase shake all honor prefers-reduced-motion.
	 */

	let pass = $state('');
	let busy = $state(false);
	let error = $state<string | null>(null);
	let shaking = $state(false);
	let playing = $state(false);
	let canvasEl: HTMLCanvasElement | undefined = $state();

	// M2.2 Step 3: the bouncer's countdown. Set from the server's 429
	// ('too many attempts — try again in Ns'), ticked down locally, and
	// rendered in the design's voice instead of the raw message. No
	// shake for a throttle — it's a different mood than a wrong guess.
	let throttleSeconds = $state(0);
	let throttleTimer: ReturnType<typeof setInterval> | undefined;

	function startThrottleCountdown(seconds: number) {
		throttleSeconds = seconds;
		clearInterval(throttleTimer);
		throttleTimer = setInterval(() => {
			throttleSeconds -= 1;
			if (throttleSeconds <= 0) {
				throttleSeconds = 0;
				clearInterval(throttleTimer);
			}
		}, 1000);
	}

	$effect(() => {
		return () => clearInterval(throttleTimer);
	});

	// Resolved in the canvas $effect (client-only); handlers consult it.
	let reduced = false;

	// Post-login destination: the gate sends ?from=<path>. Validated —
	// same-origin paths only ('//' would be a protocol-relative escape).
	const dest = $derived.by(() => {
		const from = page.url.searchParams.get('from');
		return from && from.startsWith('/') && !from.startsWith('//') ? from : '/';
	});

	// ─── Canvas sparkle system (ported from the mock) ────────────────
	type Particle = {
		x: number;
		y: number;
		vx: number;
		vy: number;
		born: number;
		life: number;
		r: number;
		c: string;
		g: number;
		spin: number;
		star: boolean;
	};
	const HUES = ['#E9C46A', '#F6DFA6', '#C9A8F0', '#8A5CC4', '#FFFFFF'];
	let parts: Particle[] = [];
	let ctx: CanvasRenderingContext2D | null = null;
	let raf = 0;
	let bookTimers: ReturnType<typeof setTimeout>[] = [];

	function spawn(x: number, y: number, sp: number, life: number, grav: number) {
		const a = Math.random() * Math.PI * 2;
		parts.push({
			x,
			y,
			vx: Math.cos(a) * sp,
			vy: Math.sin(a) * sp - 0.2,
			born: performance.now(),
			life: life * (0.6 + Math.random() * 0.7),
			r: 0.8 + Math.random() * 2.2,
			c: HUES[Math.floor(Math.random() * HUES.length)],
			g: grav,
			spin: Math.random() * Math.PI,
			star: Math.random() < 0.35
		});
	}

	function burst(x: number, y: number, n: number) {
		if (reduced || !ctx) return;
		for (let i = 0; i < n; i++) spawn(x, y, 1.5 + Math.random() * 6, 1200, 0.9);
		for (let i = 0; i < 8; i++) {
			const p = parts[parts.length - 1 - i];
			if (p) {
				p.r *= 2.2;
				p.star = true;
			}
		}
	}

	$effect(() => {
		reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		const cv = canvasEl;
		if (reduced || !cv) return;
		ctx = cv.getContext('2d');
		if (!ctx) return;
		const c2d = ctx;
		const dpr = Math.min(window.devicePixelRatio || 1, 2);
		const resize = () => {
			cv.width = window.innerWidth * dpr;
			cv.height = window.innerHeight * dpr;
			c2d.setTransform(dpr, 0, 0, dpr, 0, 0);
		};
		resize();
		let last = { x: 0, y: 0, t: 0 };
		const onMove = (e: PointerEvent) => {
			const now = performance.now();
			const dx = e.clientX - last.x;
			const dy = e.clientY - last.y;
			const speed = Math.min(Math.hypot(dx, dy), 40);
			if (now - last.t < 12) return;
			last = { x: e.clientX, y: e.clientY, t: now };
			const n = 1 + Math.floor(speed / 9);
			for (let i = 0; i < n; i++) spawn(e.clientX, e.clientY, 0.5 + Math.random() * 1.4, 900, 0.5);
		};
		const onDown = (e: PointerEvent) => burst(e.clientX, e.clientY, 46);
		window.addEventListener('resize', resize);
		window.addEventListener('pointermove', onMove, { passive: true });
		window.addEventListener('pointerdown', onDown, { passive: true });
		const tick = () => {
			const now = performance.now();
			c2d.clearRect(0, 0, window.innerWidth, window.innerHeight);
			c2d.globalCompositeOperation = 'lighter';
			parts = parts.filter((p) => {
				const age = (now - p.born) / p.life;
				if (age >= 1) return false;
				p.x += p.vx;
				p.y += p.vy;
				p.vy += p.g * 0.06;
				p.vx *= 0.985;
				p.vy *= 0.985;
				const alpha = (1 - age) * (1 - age);
				c2d.save();
				c2d.translate(p.x, p.y);
				c2d.rotate(p.spin + age * 2);
				c2d.globalAlpha = alpha;
				c2d.fillStyle = p.c;
				c2d.shadowColor = p.c;
				c2d.shadowBlur = p.r * 4;
				if (p.star) {
					const R = p.r * 2.6;
					const r = p.r * 0.7;
					c2d.beginPath();
					for (let i = 0; i < 8; i++) {
						const rad = i % 2 ? r : R;
						const a = (i / 8) * Math.PI * 2;
						if (i) c2d.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
						else c2d.moveTo(Math.cos(a) * rad, Math.sin(a) * rad);
					}
					c2d.closePath();
					c2d.fill();
				} else {
					c2d.beginPath();
					c2d.arc(0, 0, p.r, 0, Math.PI * 2);
					c2d.fill();
				}
				c2d.restore();
				return true;
			});
			c2d.globalAlpha = 1;
			c2d.globalCompositeOperation = 'source-over';
			raf = requestAnimationFrame(tick);
		};
		tick();
		return () => {
			cancelAnimationFrame(raf);
			for (const t of bookTimers) clearTimeout(t);
			window.removeEventListener('resize', resize);
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerdown', onDown);
			ctx = null;
		};
	});

	// ─── The easter egg: open the book ───────────────────────────────
	function onLogo(e: MouseEvent) {
		if (playing || reduced) return;
		playing = true;
		for (const t of bookTimers) clearTimeout(t);
		bookTimers = [];
		for (let i = 0; i < 6; i++) {
			bookTimers.push(setTimeout(() => burst(e.clientX + 20, e.clientY - 20, 12), 950 + i * 160));
		}
		bookTimers.push(setTimeout(() => burst(e.clientX, e.clientY + 10, 20), 2500));
		bookTimers.push(setTimeout(() => (playing = false), 2650));
	}

	// ─── Submit ──────────────────────────────────────────────────────
	async function submit(e: SubmitEvent) {
		e.preventDefault();
		if (busy) return;
		error = null;
		busy = true;
		try {
			await login(pass, fetch);
			if (!reduced) {
				burst(window.innerWidth / 2, window.innerHeight / 2, 60);
				await new Promise((r) => setTimeout(r, 500));
			}
			await goto(dest);
		} catch (err) {
			const msg = err instanceof Error ? err.message : 'login failed';
			if (msg === 'no password set') {
				// Password removed out-of-band (CLI reset) — app is open.
				await goto('/');
				return;
			}
			const throttled = /^too many attempts — try again in (\d+)s$/.exec(msg);
			if (throttled) {
				error = null;
				startThrottleCountdown(Number(throttled[1]));
				return;
			}
			throttleSeconds = 0;
			error = msg === 'incorrect password' ? "That's not the phrase — try again." : msg;
			if (!reduced) {
				shaking = true;
				setTimeout(() => (shaking = false), 420);
			}
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head><title>Reliquary — Unlock</title></svelte:head>

<div class="login">
	<canvas bind:this={canvasEl} class="sparkles"></canvas>

	<div class="card" class:shaking>
		<button
			type="button"
			class="logo"
			class:mark-pop={playing}
			title="open the book"
			aria-label="Open the book"
			onclick={onLogo}
		>
			<svg viewBox="0 -18 100 118" width="112" height="132" fill="none">
				<rect
					x="20"
					y="30"
					width="16"
					height="18"
					fill="#8A5CC4"
					stroke="#B98A2E"
					stroke-width="1.8"
				></rect>
				<path d="M18 30 h4.16 v-5 h3.84 v5 h3.84 v-5 h4.16 v5" fill="#B98A2E"></path>
				<rect
					x="64"
					y="30"
					width="16"
					height="18"
					fill="#8A5CC4"
					stroke="#B98A2E"
					stroke-width="1.8"
				></rect>
				<path d="M62 30 h4.16 v-5 h3.84 v5 h3.84 v-5 h4.16 v5" fill="#B98A2E"></path>
				<path d="M38 20 h5.2 v-5 h4.8 v5 h4.8 v-5 h5.2 v5" fill="#B98A2E"></path>
				<rect
					x="40"
					y="20"
					width="20"
					height="28"
					fill="#5B2C91"
					stroke="#B98A2E"
					stroke-width="1.8"
				></rect>
				<path d="M46 34 V29 a4 4 0 0 1 8 0 V34 Z" fill="#B98A2E"></path>
				<rect x="16" y="50" width="68" height="13" rx="2" fill={playing ? '#C3B0DC' : '#B98A2E'}
				></rect>
				<rect
					x="20"
					y="66"
					width="60"
					height="13"
					rx="2"
					fill="#6D3FA8"
					stroke="#B98A2E"
					stroke-width="1.8"
				></rect>
				<path
					d="M50 -14 L52.4 -6 L60 -3.5 L52.4 -1 L50 7 L47.6 -1 L40 -3.5 L47.6 -6 Z"
					fill="#D9A93F"
				></path>
				<circle cx="8" cy="30" r="2.2" fill="#B98A2E"></circle>
				<circle cx="92" cy="26" r="2.2" fill="#B98A2E"></circle>
				<circle cx="6" cy="46" r="1.4" fill="#8A5CC4"></circle>
				<circle cx="94" cy="44" r="1.4" fill="#8A5CC4"></circle>
				<circle cx="14" cy="12" r="1.6" fill="#8A5CC4"></circle>
				<circle cx="86" cy="8" r="1.8" fill="#B98A2E"></circle>
				<rect x="24" y="82" width="52" height="13" rx="2" fill="#A783D6"></rect>
			</svg>
			{#if playing}
				<div class="book">
					<div class="cover-l"></div>
					<div class="cover-r"></div>
					<div class="leaf-static leaf-static-l"></div>
					<div class="leaf-lines leaf-lines-l"></div>
					<div class="leaf-static leaf-static-r"></div>
					<div class="leaf-lines leaf-lines-r"></div>
					<div class="leaf-turn t1"></div>
					<div class="leaf-turn t2"></div>
					<div class="leaf-turn t3"></div>
					<div class="leaf-turn t4"></div>
					<div class="leaf-turn t5"></div>
					<div class="leaf-turn t6"></div>
					<div class="spine"></div>
				</div>
			{/if}
		</button>

		<div class="title-block">
			<div class="title">Reliquary</div>
			<div class="subtitle">Enter your passphrase</div>
		</div>

		<form onsubmit={submit}>
			<input
				type="password"
				autocomplete="current-password"
				placeholder="six words, or one you'll remember"
				bind:value={pass}
				disabled={busy}
			/>
			{#if throttleSeconds > 0}
				<p class="error-line" role="alert">
					The door is catching its breath — give it {throttleSeconds} second{throttleSeconds === 1
						? ''
						: 's'}.
				</p>
			{:else if error}
				<p class="error-line" role="alert">{error}</p>
			{/if}
			<button type="submit" class="unlock" disabled={busy || throttleSeconds > 0}>
				Unlock the library
			</button>
		</form>

		<div class="footer">
			This library never leaves your wifi — and its passphrase can only be reset from the machine
			that holds it.
		</div>
	</div>
</div>

<style>
	@font-face {
		font-family: 'Cormorant Garamond';
		font-style: normal;
		font-weight: 400;
		font-display: swap;
		src: url('/fonts/cormorant-garamond-latin-400.woff2') format('woff2');
	}
	@font-face {
		font-family: 'Jost';
		font-style: normal;
		font-weight: 400 500;
		font-display: swap;
		src: url('/fonts/jost-latin-400-500.woff2') format('woff2');
	}

	/* The page's own identity — fixed lavender across all app themes. */
	.login {
		position: fixed;
		inset: 0;
		overflow-y: auto;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 48px 24px;
		box-sizing: border-box;
		font-family: 'Jost', Helvetica, sans-serif;
		background: radial-gradient(120% 100% at 50% 0%, #f0e7fb 0%, #e4d8f4 45%, #d2c0ec 100%);
		color-scheme: light;
	}
	.sparkles {
		position: fixed;
		inset: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
		z-index: 2;
	}
	.card {
		position: relative;
		z-index: 1;
		margin: auto;
		width: 100%;
		max-width: 412px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 30px;
		padding: 52px 44px 44px;
		background: rgba(255, 253, 255, 0.72);
		border: 1px solid rgba(109, 63, 168, 0.18);
		border-radius: 20px;
		box-shadow:
			0 30px 70px -30px rgba(52, 20, 90, 0.45),
			0 2px 0 rgba(255, 255, 255, 0.8) inset;
		backdrop-filter: blur(6px);
	}
	.card.shaking {
		animation: shake 0.42s ease-in-out;
	}

	.logo {
		position: relative;
		cursor: pointer;
		line-height: 0;
		background: none;
		border: none;
		padding: 0;
	}
	.logo.mark-pop {
		animation: relMarkPop 2.6s ease-in-out;
	}

	.title-block {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
	}
	.title {
		font-family: 'Cormorant Garamond', Georgia, serif;
		font-size: 40px;
		line-height: 1;
		letter-spacing: 0.05em;
		color: #2e1250;
	}
	.subtitle {
		font-size: 12px;
		letter-spacing: 0.26em;
		text-transform: uppercase;
		color: #7e62a6;
	}

	form {
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	input {
		width: 100%;
		box-sizing: border-box;
		padding: 16px 18px;
		font-family: 'Jost', Helvetica, sans-serif;
		font-size: 16px;
		letter-spacing: 0.04em;
		color: #2e1250;
		background: rgba(255, 255, 255, 0.86);
		border: 1px solid rgba(109, 63, 168, 0.28);
		border-radius: 11px;
		outline: none;
	}
	input::placeholder {
		color: #9e86be;
	}
	input:focus {
		border-color: #8a5cc4;
		box-shadow: 0 0 0 4px rgba(138, 92, 196, 0.16);
	}
	.error-line {
		margin: 0;
		font-size: 13px;
		line-height: 1.6;
		color: #7e62a6;
	}
	.unlock {
		width: 100%;
		padding: 16px 18px;
		font-family: 'Jost', Helvetica, sans-serif;
		font-size: 14px;
		font-weight: 400;
		letter-spacing: 0.2em;
		text-transform: uppercase;
		color: #fcf6e6;
		background: linear-gradient(180deg, #6d3fa8, #54297f);
		border: none;
		border-radius: 11px;
		cursor: pointer;
	}
	.unlock:hover:not(:disabled) {
		background: linear-gradient(180deg, #7c4bbc, #5e2f8d);
	}
	.unlock:active:not(:disabled) {
		transform: translateY(1px);
	}
	.unlock:disabled {
		opacity: 0.7;
		cursor: default;
	}

	.footer {
		font-size: 13px;
		line-height: 1.6;
		text-align: center;
		color: #7e62a6;
		text-wrap: pretty;
	}

	/* ─── The open-the-book overlay (mock's sc-if block, classed) ─── */
	.book {
		position: absolute;
		left: -32px;
		top: -9px;
		width: 176px;
		height: 150px;
		transform-origin: 0 0;
		perspective: 820px;
		pointer-events: none;
		animation: relPull 2.6s cubic-bezier(0.5, 0.05, 0.3, 1) forwards;
	}
	.cover-l {
		position: absolute;
		left: 0;
		top: 0;
		width: 88px;
		height: 150px;
		background: linear-gradient(120deg, #d0a03c, #a87a24);
		border: 1.5px solid #8a6218;
		border-radius: 6px 2px 2px 6px;
		transform-origin: right center;
		transform-style: preserve-3d;
		animation: relCoverL 2.6s ease-in-out forwards;
	}
	.cover-r {
		position: absolute;
		left: 88px;
		top: 0;
		width: 88px;
		height: 150px;
		background: linear-gradient(240deg, #d0a03c, #a87a24);
		border: 1.5px solid #8a6218;
		border-radius: 2px 6px 6px 2px;
		transform-origin: left center;
		transform-style: preserve-3d;
		animation: relCoverR 2.6s ease-in-out forwards;
	}
	.leaf-static {
		position: absolute;
		top: 9px;
		width: 70px;
		height: 132px;
		background: linear-gradient(180deg, #fffdf7, #f3eafc);
		animation: relLeafFade 2.6s linear forwards;
	}
	.leaf-static-l {
		left: 18px;
		border-radius: 5px 2px 2px 5px;
		box-shadow: inset -8px 0 14px -10px rgba(74, 34, 112, 0.45);
	}
	.leaf-static-r {
		left: 88px;
		border-radius: 2px 5px 5px 2px;
		box-shadow: inset 8px 0 14px -10px rgba(74, 34, 112, 0.45);
	}
	.leaf-lines {
		position: absolute;
		top: 24px;
		width: 54px;
		height: 102px;
		background: repeating-linear-gradient(
			180deg,
			rgba(109, 63, 168, 0.28) 0 1px,
			transparent 1px 11px
		);
		border-radius: 2px;
		animation: relLeafFade 2.6s linear forwards;
	}
	.leaf-lines-l {
		left: 25px;
	}
	.leaf-lines-r {
		left: 97px;
	}
	.leaf-turn {
		position: absolute;
		left: 88px;
		top: 9px;
		width: 70px;
		height: 132px;
		background:
			repeating-linear-gradient(180deg, transparent 0 16px, rgba(109, 63, 168, 0.26) 16px 17px)
				no-repeat 9px 15px / 54px 102px,
			linear-gradient(180deg, #fffdf7, #f3eafc);
		border-radius: 2px 5px 5px 2px;
		transform-origin: left center;
		animation:
			relLeaf 0.34s ease-in forwards,
			relLeafFade 2.6s linear forwards;
	}
	.leaf-turn.t1 {
		animation-delay: 0.95s, 0s;
	}
	.leaf-turn.t2 {
		animation-delay: 1.11s, 0s;
	}
	.leaf-turn.t3 {
		animation-delay: 1.27s, 0s;
	}
	.leaf-turn.t4 {
		animation-delay: 1.43s, 0s;
	}
	.leaf-turn.t5 {
		animation-delay: 1.59s, 0s;
	}
	.leaf-turn.t6 {
		animation-delay: 1.75s, 0s;
	}
	.spine {
		position: absolute;
		left: 86px;
		top: 3px;
		width: 4px;
		height: 144px;
		background: #8a6218;
		border-radius: 2px;
	}

	@keyframes relPull {
		0% {
			transform: translate(50px, 85px) scale(0.433, 0.097);
		}
		9% {
			transform: translate(92px, 85px) scale(0.433, 0.097);
		}
		16% {
			transform: translate(92px, 80px) scale(0.47, 0.22);
		}
		30% {
			transform: translate(0px, 0px) scale(1, 1);
		}
		84% {
			transform: translate(0px, 0px) scale(1, 1);
		}
		90% {
			transform: translate(92px, 80px) scale(0.47, 0.22);
		}
		95% {
			transform: translate(92px, 85px) scale(0.433, 0.097);
		}
		100% {
			transform: translate(50px, 85px) scale(0.433, 0.097);
		}
	}
	@keyframes relCoverL {
		0%,
		30% {
			transform: rotateY(0deg);
		}
		44%,
		80% {
			transform: rotateY(-26deg);
		}
		90%,
		100% {
			transform: rotateY(0deg);
		}
	}
	@keyframes relCoverR {
		0%,
		30% {
			transform: rotateY(0deg);
		}
		44%,
		80% {
			transform: rotateY(26deg);
		}
		90%,
		100% {
			transform: rotateY(0deg);
		}
	}
	@keyframes relLeaf {
		from {
			transform: rotateY(0deg);
		}
		to {
			transform: rotateY(-166deg);
		}
	}
	@keyframes relLeafFade {
		0%,
		27% {
			opacity: 0;
		}
		31%,
		84% {
			opacity: 1;
		}
		90%,
		100% {
			opacity: 0;
		}
	}
	@keyframes relMarkPop {
		0% {
			transform: scale(1);
		}
		18% {
			transform: scale(0.96);
		}
		60% {
			transform: scale(1.02);
		}
		100% {
			transform: scale(1);
		}
	}
	@keyframes shake {
		0%,
		100% {
			transform: translateX(0);
		}
		15% {
			transform: translateX(-7px);
		}
		30% {
			transform: translateX(6px);
		}
		45% {
			transform: translateX(-5px);
		}
		60% {
			transform: translateX(4px);
		}
		75% {
			transform: translateX(-2px);
		}
	}

	/* Belt-and-suspenders on top of the JS gating. */
	@media (prefers-reduced-motion: reduce) {
		.card,
		.logo,
		.book,
		.book * {
			animation: none !important;
		}
	}
</style>
