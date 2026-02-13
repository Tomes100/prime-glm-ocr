import { json } from '@sveltejs/kit';
import sharp from 'sharp';
import Tesseract from 'tesseract.js';
import type { RequestHandler } from './$types';

const MAX_PAYLOAD = 20 * 1024 * 1024; // 20MB

export const POST: RequestHandler = async ({ request }) => {
	try {
		const raw = await request.text();
		if (raw.length > MAX_PAYLOAD) {
			return json({ error: 'Payload too large (max 20MB)' }, { status: 413 });
		}

		const { file } = JSON.parse(raw);
		if (!file) return json({ error: 'No file provided' }, { status: 400 });

		const base64Data = file.replace(/^data:[^;]+;base64,/, '');
		const buffer = Buffer.from(base64Data, 'base64');

		// Convert to PNG for Tesseract
		const pngBuffer = await sharp(buffer).png().toBuffer();

		const { data } = await Tesseract.recognize(pngBuffer, 'eng', {
			logger: () => {}
		});

		// Words are nested: blocks → paragraphs → lines → words
		const words: Array<{ text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }> = [];
		for (const block of (data.blocks || [])) {
			for (const para of (block.paragraphs || [])) {
				for (const line of (para.lines || [])) {
					for (const word of (line.words || [])) {
						if (word.text && word.text.trim()) {
							words.push({
								text: word.text,
								confidence: word.confidence,
								bbox: {
									x0: word.bbox.x0,
									y0: word.bbox.y0,
									x1: word.bbox.x1,
									y1: word.bbox.y1
								}
							});
						}
					}
				}
			}
		}

		return json({ words });
	} catch (err) {
		console.error('Confidence endpoint error:', err);
		return json({ error: 'Failed to analyze confidence' }, { status: 500 });
	}
};
