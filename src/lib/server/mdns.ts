/**
 * reliquary.local mDNS responder — M2.2 Step 5B.
 *
 * Answers multicast DNS queries for exactly `reliquary.local` with this
 * machine's CURRENT LAN IPv4, looked up per answer — nothing is ever
 * pinned, so DHCP renewal can't break it (the 5A lesson). Coexists
 * with macOS's own mDNSResponder via a shared bind of UDP 5353
 * (empirically proven in 5B plan mode: queries arrive, answers are
 * accepted through the OS's standard resolver path). Zero
 * dependencies: hand-assembled DNS wire format over node:dgram.
 *
 * ⚠️ FAIL-OPEN, ALWAYS — the OPPOSITE of the sanitize/auth boot
 * contract. Those fail closed because serving without them is unsafe;
 * this is a convenience name, and the library is the product. Any
 * failure here (bind, membership, parse, send) logs and is otherwise
 * swallowed; the server must come up and serve normally without the
 * broadcast. A name-broadcast feature must never prevent reading fics.
 *
 * Off-switch: RELIQUARY_MDNS=off (or 0/false). Pi day: the Pi's avahi
 * serves reliquary.local natively (hostname = reliquary) — set the
 * off-switch on any laptop server run after the Pi is up, because this
 * responder has NO conflict arbitration (see below and PI.md).
 *
 * ── Wire-format map (all integers big-endian) ──────────────────────
 * Query datagram: [12-byte header][questions...]
 *   header: ID(2) FLAGS(2) QDCOUNT(2) ANCOUNT(2) NSCOUNT(2) ARCOUNT(2)
 *   FLAGS bit 15 (0x8000) = QR: 0 query / 1 response — we only read
 *   queries and only ever send responses, so this bit also stops us
 *   answering ourselves.
 *   question: NAME as length-prefixed labels ("\x09reliquary\x05local\x00"),
 *   then QTYPE(2), QCLASS(2). mDNS question names are sent uncompressed;
 *   a pointer byte (>= 0xC0) makes us bail on that packet.
 * Answer datagram we send: header ID=0 (mDNS multicast responses carry
 *   ID 0), FLAGS 0x8400 (QR=1, AA=1 — mDNS answers are authoritative
 *   by definition), QDCOUNT 0, ANCOUNT 1; then one RR:
 *   NAME labels · TYPE 1 (A) · CLASS 0x8001 (IN + cache-flush bit —
 *   "replace any cached A records for this name, don't append") ·
 *   TTL 120 (the mDNS host-record convention; also AC5's decay window:
 *   kill the server and the name dies within ~2 minutes) · RDLENGTH 4 ·
 *   RDATA the IPv4 bytes. Sent multicast to 224.0.0.251:5353 so every
 *   cache on the LAN hears it.
 *
 * ── Deliberately NOT implemented (and why) ─────────────────────────
 *  - AAAA / NSEC negative responses: A-only resolution is sufficient
 *    (proven via the OS resolver path in plan mode); clients fall back.
 *  - RFC 6762 probing & conflict ARBITRATION: we never probe before
 *    claiming the name and never yield to a competing claimant. The
 *    accepted mitigation is detection-not-arbitration: the startup
 *    probe below LOGS a warning if anything else already answers for
 *    the name, and PI.md's off-switch line keeps us away from avahi.
 *  - Service enumeration (PTR/SRV/TXT records, _http._tcp browsing):
 *    phones type a URL; nothing browses for services.
 *  - Goodbye packets (TTL-0 answers) on shutdown: TTL decay is the
 *    retirement path — proven clean in plan mode.
 * Sleep/wake & network changes: multicast membership can silently die
 * when an interface bounces, so a 60-second tick re-joins the group
 * (drop+add, errors swallowed) and re-announces — caches repopulate
 * within a tick of the network coming back.
 */
import dgram from 'node:dgram';
import { networkInterfaces } from 'node:os';
import { env } from '$env/dynamic/private';

const MDNS_ADDR = '224.0.0.251';
const MDNS_PORT = 5353;
const NAME_LABELS = ['reliquary', 'local'];
const TTL_SECONDS = 120;
const REJOIN_MS = 60_000;
const CONFLICT_PROBE_MS = 2_000;

const NAME_WIRE = Buffer.concat([
	...NAME_LABELS.map((l) => Buffer.concat([Buffer.from([l.length]), Buffer.from(l, 'ascii')])),
	Buffer.from([0])
]);

function currentIPv4(): string | null {
	for (const addrs of Object.values(networkInterfaces())) {
		for (const a of addrs ?? []) {
			if (a.family === 'IPv4' && !a.internal) return a.address;
		}
	}
	return null;
}

/** Parse the first question's name; null when absent/compressed/malformed. */
function firstQuestion(msg: Buffer): { labels: string[]; qtype: number } | null {
	if (msg.length < 12 || msg.readUInt16BE(4) < 1) return null;
	const labels: string[] = [];
	let o = 12;
	for (;;) {
		if (o >= msg.length) return null;
		const len = msg[o];
		if (len === 0) {
			o += 1;
			break;
		}
		if (len >= 0xc0) return null; // compression pointer — not expected in questions
		if (o + 1 + len > msg.length) return null;
		labels.push(
			msg
				.subarray(o + 1, o + 1 + len)
				.toString('ascii')
				.toLowerCase()
		);
		o += 1 + len;
	}
	if (o + 4 > msg.length) return null;
	return { labels, qtype: msg.readUInt16BE(o) };
}

function isOurName(labels: string[]): boolean {
	return labels.length === 2 && labels[0] === NAME_LABELS[0] && labels[1] === NAME_LABELS[1];
}

function buildAnswer(ip: string): Buffer {
	const header = Buffer.alloc(12);
	header.writeUInt16BE(0x8400, 2); // QR|AA, ID stays 0
	header.writeUInt16BE(1, 6); // ANCOUNT
	const rr = Buffer.alloc(NAME_WIRE.length + 14);
	NAME_WIRE.copy(rr, 0);
	const o = NAME_WIRE.length;
	rr.writeUInt16BE(1, o); // TYPE A
	rr.writeUInt16BE(0x8001, o + 2); // IN + cache-flush
	rr.writeUInt32BE(TTL_SECONDS, o + 4);
	rr.writeUInt16BE(4, o + 8);
	Buffer.from(ip.split('.').map(Number)).copy(rr, o + 10);
	return Buffer.concat([header, rr]);
}

function buildQuery(): Buffer {
	const header = Buffer.alloc(12);
	header.writeUInt16BE(1, 4); // QDCOUNT
	const q = Buffer.alloc(NAME_WIRE.length + 4);
	NAME_WIRE.copy(q, 0);
	q.writeUInt16BE(1, NAME_WIRE.length); // QTYPE A
	q.writeUInt16BE(1, NAME_WIRE.length + 2); // QCLASS IN
	return Buffer.concat([header, q]);
}

/** Does this datagram carry an A answer for our name? (conflict probe) */
function answersOurName(msg: Buffer): boolean {
	if (msg.length < 12 || !(msg.readUInt16BE(2) & 0x8000)) return false;
	return msg.includes(NAME_WIRE);
}

export function startMdnsResponder(): void {
	const flag = (env.RELIQUARY_MDNS ?? '').toLowerCase();
	if (flag === 'off' || flag === '0' || flag === 'false') {
		console.log('[mdns] disabled (RELIQUARY_MDNS off)');
		return;
	}

	try {
		const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
		let announcedConflict = false;
		let probing = true;

		const announce = () => {
			const ip = currentIPv4();
			if (!ip) return;
			sock.send(buildAnswer(ip), MDNS_PORT, MDNS_ADDR, () => {});
		};

		sock.on('message', (msg, rinfo) => {
			try {
				// Probe window (rider 3): we stay SILENT — no answers of our
				// own yet — so ANY answer for the name, from any source (a
				// same-machine claimant shares our IP), is someone else.
				if (probing) {
					if (answersOurName(msg) && !announcedConflict) {
						announcedConflict = true;
						console.error(
							`[mdns] WARNING: something else answers for reliquary.local (${rinfo.address}) — the name may resolve to the wrong machine`
						);
					}
					return;
				}
				if (msg.readUInt16BE(2) & 0x8000) return; // response — not ours to answer
				const q = firstQuestion(msg);
				if (!q || !isOurName(q.labels)) return;
				if (q.qtype !== 1 && q.qtype !== 255) return; // A or ANY only
				const ip = currentIPv4();
				if (!ip) return;
				sock.send(buildAnswer(ip), MDNS_PORT, MDNS_ADDR, () => {});
			} catch {
				// fail-open: a malformed packet never takes the responder down
			}
		});

		sock.on('error', (e) => {
			console.error(`[mdns] responder failed (${e.message}) — continuing without name broadcast`);
			try {
				sock.close();
			} catch {
				/* already closed */
			}
		});

		// unref: the responder must never keep the process ALIVE either —
		// without this, adapter-node's graceful SIGTERM shutdown closes the
		// HTTP server and then waits forever on our socket (found the hard
		// way: four wedged orphans still answering for the name). An
		// unref'd socket still receives; it just doesn't hold the loop.
		sock.unref();
		sock.bind(MDNS_PORT, () => {
			try {
				sock.addMembership(MDNS_ADDR);
				// Conflict probe (rider 3): ask for the name ourselves and
				// listen briefly before first announcing.
				sock.send(buildQuery(), MDNS_PORT, MDNS_ADDR, () => {});
				setTimeout(() => {
					probing = false;
					announce();
					console.log(`[mdns] broadcasting reliquary.local → ${currentIPv4() ?? '(no IPv4?)'}`);
				}, CONFLICT_PROBE_MS).unref();
				// Sleep/wake & interface-change recovery (rider 2): re-join
				// the multicast group and re-announce every minute. Silent
				// when healthy; errors swallowed (fail-open).
				setInterval(() => {
					try {
						try {
							sock.dropMembership(MDNS_ADDR);
						} catch {
							/* membership already gone — fine */
						}
						sock.addMembership(MDNS_ADDR);
						announce();
					} catch {
						/* interface down — next tick retries */
					}
				}, REJOIN_MS).unref();
			} catch (e) {
				console.error(
					`[mdns] responder failed (${e instanceof Error ? e.message : e}) — continuing without name broadcast`
				);
			}
		});
	} catch (e) {
		console.error(
			`[mdns] responder failed (${e instanceof Error ? e.message : e}) — continuing without name broadcast`
		);
	}
}
