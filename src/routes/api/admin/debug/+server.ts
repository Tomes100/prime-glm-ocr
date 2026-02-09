import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { addDebugLog, getDebugLogs } from '$lib/scan-store';
import type { RequestHandler } from './$types';

// POST: store debug log from client (no auth needed — it's diagnostic data)
export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json();
		addDebugLog(body);
		return json({ ok: true });
	} catch {
		return json({ error: 'Invalid data' }, { status: 400 });
	}
};

// GET: fetch debug logs (admin only)
export const GET: RequestHandler = async ({ url }) => {
	const password = env.ADMIN_PASSWORD;
	if (!password) return json({ error: 'Admin not configured' }, { status: 500 });

	const key = url.searchParams.get('key');
	if (key !== password) return json({ error: 'Unauthorized' }, { status: 401 });

	return json(getDebugLogs());
};
