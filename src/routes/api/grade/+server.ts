import { json } from '@sveltejs/kit';
import sharp from 'sharp';
import Tesseract from 'tesseract.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const { file } = await request.json();
		if (!file) return json({ error: 'No file provided' }, { status: 400 });

		const base64Data = file.replace(/^data:[^;]+;base64,/, '');
		const buffer = Buffer.from(base64Data, 'base64');

		// Run image quality analysis and Tesseract in parallel
		const [imageMetrics, tesseractConf] = await Promise.all([
			analyzeImageQuality(buffer),
			getTesseractConfidence(buffer)
		]);

		// Composite: 40% image quality + 60% Tesseract confidence
		const compositeScore = Math.round(
			imageMetrics.imageScore * 0.4 + tesseractConf * 0.6
		);

		return json({
			compositeScore,
			breakdown: {
				...imageMetrics.breakdown,
				tesseractConfidence: Math.round(tesseractConf)
			},
			meta: imageMetrics.meta
		});
	} catch (err) {
		console.error('Grade endpoint error:', err);
		return json({ error: 'Failed to analyze document quality' }, { status: 500 });
	}
};

async function analyzeImageQuality(buffer: Buffer) {
	const image = sharp(buffer);
	const metadata = await image.metadata();
	const stats = await image.stats();

	const width = metadata.width || 0;
	const height = metadata.height || 0;
	const pixels = width * height;

	// Resolution (0-100)
	let resolutionScore: number;
	if (pixels >= 2250000) resolutionScore = 100;
	else if (pixels <= 250000) resolutionScore = 20;
	else resolutionScore = 20 + 80 * ((pixels - 250000) / 2000000);

	// Sharpness via channel stddev (only RGB, skip alpha)
	const rgbChannels = stats.channels.slice(0, 3);
	const avgStdDev = rgbChannels.reduce((sum, ch) => sum + ch.stdev, 0) / rgbChannels.length;
	let sharpnessScore: number;
	if (avgStdDev >= 60) sharpnessScore = 100;
	else if (avgStdDev <= 10) sharpnessScore = 10;
	else sharpnessScore = 10 + 90 * ((avgStdDev - 10) / 50);

	// Contrast via min-max range
	const avgRange = rgbChannels.reduce((sum, ch) => sum + (ch.max - ch.min), 0) / rgbChannels.length;
	let contrastScore: number;
	if (avgRange >= 200) contrastScore = 100;
	else if (avgRange <= 30) contrastScore = 10;
	else contrastScore = 10 + 90 * ((avgRange - 30) / 170);

	const imageScore = Math.round(resolutionScore * 0.3 + sharpnessScore * 0.4 + contrastScore * 0.3);

	return {
		imageScore,
		breakdown: {
			resolution: Math.round(resolutionScore),
			sharpness: Math.round(sharpnessScore),
			contrast: Math.round(contrastScore)
		},
		meta: { width, height }
	};
}

async function getTesseractConfidence(buffer: Buffer): Promise<number> {
	try {
		const pngBuffer = await sharp(buffer).png().toBuffer();
		const { data } = await Tesseract.recognize(pngBuffer, 'eng', {
			logger: () => {}
		});
		// data.confidence is the overall page confidence (0-100) from Tesseract v7
		return data.confidence ?? 0;
	} catch (err) {
		console.error('Tesseract failed:', err);
		return 50; // neutral fallback
	}
}
