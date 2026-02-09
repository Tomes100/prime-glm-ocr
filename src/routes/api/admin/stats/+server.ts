import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getStats } from '$lib/scan-store';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const password = env.ADMIN_PASSWORD;
	if (!password) {
		return json({ error: 'Admin not configured' }, { status: 500 });
	}

	const key = url.searchParams.get('key');
	if (key !== password) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const stats = getStats();
	return json({
		...stats,
		apiKeySet: !!env.GLM_OCR_API_KEY || !!env.OCR_API_KEY
	});
};
