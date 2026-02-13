import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { recordScan } from '$lib/scan-store';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	const apiKey = env.GLM_OCR_API_KEY;
	if (!apiKey) {
		return json({ error: 'API key not configured' }, { status: 500 });
	}

	try {
		// Limit payload to 20MB (base64 encoded images)
		const raw = await request.text();
		if (raw.length > 20_000_000) {
			return json({ error: 'File too large (max 20MB)' }, { status: 413 });
		}
		const body = JSON.parse(raw);
		let file = body.file;
		if (!file) {
			return json({ error: 'No file provided' }, { status: 400 });
		}

		const response = await fetch('https://api.z.ai/api/paas/v4/layout_parsing', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${apiKey}`
			},
			body: JSON.stringify({ model: 'glm-ocr', file })
		});

		if (!response.ok) {
			const text = await response.text();
			let errorMsg = `API error: ${response.status}`;
			try {
				const errData = JSON.parse(text);
				if (errData?.error?.message) errorMsg = errData.error.message;
			} catch {}
			return json({ error: errorMsg, details: text }, { status: response.status });
		}

		const data = await response.json();

		// Record the scan for admin stats
		try {
			const ip = getClientAddress();
			recordScan(ip, body.fileName || 'unknown');
		} catch { /* don't fail the request over stats */ }

		return json(data);
	} catch (err) {
		return json({ error: 'Server error', details: String(err) }, { status: 500 });
	}
};
