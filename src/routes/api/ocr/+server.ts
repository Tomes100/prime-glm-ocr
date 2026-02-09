import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const apiKey = env.GLM_OCR_API_KEY;
	if (!apiKey) {
		return json({ error: 'API key not configured' }, { status: 500 });
	}

	try {
		const { file } = await request.json();
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
			return json({ error: `API error: ${response.status}`, details: text }, { status: response.status });
		}

		const data = await response.json();
		return json(data);
	} catch (err) {
		return json({ error: 'Server error', details: String(err) }, { status: 500 });
	}
};
