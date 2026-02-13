import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const apiKey = env.KIMI_API_KEY;
	if (!apiKey) {
		return json({ error: 'Enhancement API key not configured' }, { status: 500 });
	}

	try {
		// Limit payload to 20MB
		const raw = await request.text();
		if (raw.length > 20_000_000) {
			return json({ error: 'Payload too large (max 20MB)' }, { status: 413 });
		}
		const { image, extractedText } = JSON.parse(raw);
		if (!image || !extractedText) {
			return json({ error: 'Missing image or extracted text' }, { status: 400 });
		}

		// image is a data URL like "data:image/png;base64,..."
		let imageUrl = image;
		// Ensure it's a proper data URL
		if (!image.startsWith('data:')) {
			imageUrl = `data:image/png;base64,${image}`;
		}

		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 120000); // 2 min timeout

		const response = await fetch('https://api.moonshot.ai/v1/chat/completions', {
			signal: controller.signal,
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${apiKey}`
			},
			body: JSON.stringify({
				model: 'moonshot-v1-128k-vision-preview',
				messages: [
					{
						role: 'system',
						content: `You are a document reconstruction expert. You receive a document image and a first-pass OCR extraction of it. Your job is to produce a perfect, corrected version of the extracted text.

Rules:
- Fix any misread characters, broken words, or encoding errors
- Reconstruct tables with proper markdown table syntax, preserving all columns, rows, merged cells
- Maintain the exact document structure: headings, paragraphs, lists, tables in correct order
- Preserve all numbers, dates, and proper nouns exactly as they appear in the image
- Do NOT add content that isn't in the original document
- Do NOT add commentary, explanations, or notes — output ONLY the corrected document text
- Use markdown formatting (headings, bold, tables, lists) to match the original layout
- If the OCR extraction is already perfect, return it unchanged`
					},
					{
						role: 'user',
						content: [
							{
								type: 'image_url',
								image_url: { url: imageUrl }
							},
							{
								type: 'text',
								text: `Here is the first-pass OCR extraction of this document. Please correct any errors and reconstruct it with 100% fidelity to the original:\n\n${extractedText}`
							}
						]
					}
				],
				temperature: 0.1,
				max_tokens: 8192
			})
		});

		clearTimeout(timeout);

		if (!response.ok) {
			const text = await response.text();
			let errorMsg = `Enhancement API error: ${response.status}`;
			try {
				const errData = JSON.parse(text);
				if (errData?.error?.message) errorMsg = errData.error.message;
			} catch {}
			return json({ error: errorMsg }, { status: response.status });
		}

		const data = await response.json();
		const enhanced = data.choices?.[0]?.message?.content;

		if (!enhanced) {
			return json({ error: 'No enhanced text returned' }, { status: 500 });
		}

		return json({ enhanced });
	} catch (err) {
		return json({ error: 'Enhancement failed: ' + String(err) }, { status: 500 });
	}
};
