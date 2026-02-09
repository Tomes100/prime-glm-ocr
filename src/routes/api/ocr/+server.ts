import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const apiKey = env.GLM_OCR_API_KEY;
	if (!apiKey) {
		return json({ error: 'API key not configured' }, { status: 500 });
	}

	try {
		const body = await request.json();
		let file = body.file;
		if (!file) {
			return json({ error: 'No file provided' }, { status: 400 });
		}

		// If it's a data URI, the Z.AI API may need it as-is or just base64
		// Try sending as-is first — the API accepts data URIs for images

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
		return json(data);
	} catch (err) {
		return json({ error: 'Server error', details: String(err) }, { status: 500 });
	}
};
