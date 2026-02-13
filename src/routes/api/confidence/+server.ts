import { json } from '@sveltejs/kit';
import sharp from 'sharp';
import Tesseract from 'tesseract.js';
import path from 'path';
import type { RequestHandler } from './$types';

const MAX_PAYLOAD = 20 * 1024 * 1024; // 20MB

export const POST: RequestHandler = async ({ request }) => {
	try {
		const contentLength = parseInt(request.headers.get('content-length') || '0');
		if (contentLength > MAX_PAYLOAD) {
			return json({ error: 'Payload too large (max 20MB)' }, { status: 413 });
		}

		const { file } = await request.json();
		if (!file) return json({ error: 'No file provided' }, { status: 400 });

		const base64Data = file.replace(/^data:[^;]+;base64,/, '');
		const buffer = Buffer.from(base64Data, 'base64');

		// Convert to PNG for Tesseract
		const pngBuffer = await sharp(buffer).png().toBuffer();

		// Use local traineddata if available
		const langPath = path.resolve('eng.traineddata');
		
		const { data } = await Tesseract.recognize(pngBuffer, 'eng', {
			logger: () => {}
		});

		const words = (data.words || []).map((w: any) => ({
			text: w.text,
			confidence: w.confidence,
			bbox: {
				x0: w.bbox.x0,
				y0: w.bbox.y0,
				x1: w.bbox.x1,
				y1: w.bbox.y1
			}
		}));

		return json({ words });
	} catch (err) {
		console.error('Confidence endpoint error:', err);
		return json({ error: 'Failed to analyze confidence' }, { status: 500 });
	}
};
