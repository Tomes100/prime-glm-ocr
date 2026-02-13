import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { addDebugLog, getDebugLogs } from '$lib/scan-store';
import type { RequestHandler } from './$types';

const MAX_DEBUG_BODY_SIZE = 50_000; // 50KB max per debug log

// POST: store debug log from client (rate-limited, size-capped)
const recentPosts = new Map<string, number>();

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	try {
		// Simple rate limit: 1 debug log per IP per 10 seconds
		const ip = getClientAddress();
		const now = Date.now();
		const last = recentPosts.get(ip) || 0;
		if (now - last < 10_000) {
			return json({ error: 'Rate limited' }, { status: 429 });
		}
		recentPosts.set(ip, now);
		// Clean old entries periodically
		if (recentPosts.size > 1000) {
			for (const [k, v] of recentPosts) {
				if (now - v > 60_000) recentPosts.delete(k);
			}
		}

		const text = await request.text();
		if (text.length > MAX_DEBUG_BODY_SIZE) {
			return json({ error: 'Payload too large' }, { status: 413 });
		}

		const body = JSON.parse(text);
		addDebugLog(body);
		return json({ ok: true });
	} catch {
		return json({ error: 'Invalid data' }, { status: 400 });
	}
};

// GET: fetch debug logs (admin only)
export const GET: RequestHandler = async ({ request, url }) => {
	const password = env.ADMIN_PASSWORD;
	if (!password) return json({ error: 'Admin not configured' }, { status: 500 });

	const authHeader = request.headers.get('authorization');
	const key = authHeader?.replace('Bearer ', '') || url.searchParams.get('key');
	if (key !== password) return json({ error: 'Unauthorized' }, { status: 401 });

	return json(getDebugLogs());
};
