import { json } from '@sveltejs/kit';
import sharp from 'sharp';
import Tesseract from 'tesseract.js';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const { file } = await request.json();
		if (!file) return json({ error: 'No file provided' }, { status: 400 });

		// Strip data URL prefix
		const base64Data = file.replace(/^data:[^;]+;base64,/, '');
		const buffer = Buffer.from(base64Data, 'base64');

		// Run image quality analysis and Tesseract OCR in parallel
		const [imageMetrics, tesseractResult] = await Promise.all([
			analyzeImageQuality(buffer),
			analyzeTesseractConfidence(buffer)
		]);

		// Composite: 40% image quality + 60% Tesseract confidence
		const compositeScore = Math.round(
			imageMetrics.imageScore * 0.4 + tesseractResult.confidenceScore * 0.6
		);

		return json({
			imageScore: imageMetrics.imageScore,
			tesseractScore: tesseractResult.confidenceScore,
			compositeScore,
			breakdown: {
				...imageMetrics.breakdown,
				...tesseractResult.breakdown
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

	// Resolution score (0-100)
	let resolutionScore: number;
	if (pixels >= 1500 * 1500) resolutionScore = 100;
	else if (pixels <= 500 * 500) resolutionScore = 20;
	else resolutionScore = 20 + 80 * ((pixels - 250000) / (2250000 - 250000));

	// Sharpness: channel stddev
	const avgStdDev = stats.channels.reduce((sum, ch) => sum + ch.stdev, 0) / stats.channels.length;
	let sharpnessScore: number;
	if (avgStdDev >= 60) sharpnessScore = 100;
	else if (avgStdDev <= 10) sharpnessScore = 10;
	else sharpnessScore = 10 + 90 * ((avgStdDev - 10) / 50);

	// Contrast: min-max range
	const avgRange = stats.channels.reduce((sum, ch) => sum + (ch.maxVal - ch.minVal), 0) / stats.channels.length;
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
		meta: {
			width, height,
			avgStdDev: Math.round(avgStdDev * 10) / 10,
			avgRange: Math.round(avgRange)
		}
	};
}

async function analyzeTesseractConfidence(buffer: Buffer): Promise<{ confidenceScore: number; breakdown: Record<string, number> }> {
	try {
		// Convert to PNG for Tesseract compatibility
		const pngBuffer = await sharp(buffer).png().toBuffer();

		const { data } = await Tesseract.recognize(pngBuffer, 'eng', {
			logger: () => {} // silent
		});

		const words = data.words || [];
		if (words.length === 0) {
			return { confidenceScore: 20, breakdown: { wordConfidence: 20, lowConfWords: 0, totalWords: 0 } };
		}

		// Average word confidence (Tesseract gives 0-100 per word)
		const avgConfidence = words.reduce((sum, w) => sum + w.confidence, 0) / words.length;

		// Ratio of low-confidence words (< 60)
		const lowConfWords = words.filter(w => w.confidence < 60).length;
		const lowConfRatio = lowConfWords / words.length;

		// Word confidence score (0-100)
		const wordConfScore = Math.min(100, Math.max(0, avgConfidence));

		// Low-conf penalty
		let lowConfPenalty: number;
		if (lowConfRatio > 0.5) lowConfPenalty = 20;
		else if (lowConfRatio > 0.3) lowConfPenalty = 50;
		else if (lowConfRatio > 0.1) lowConfPenalty = 75;
		else lowConfPenalty = 95;

		const confidenceScore = Math.round(wordConfScore * 0.7 + lowConfPenalty * 0.3);

		return {
			confidenceScore,
			breakdown: {
				wordConfidence: Math.round(wordConfScore),
				lowConfWords: Math.round(lowConfPenalty),
				totalWords: words.length
			}
		};
	} catch (err) {
		console.error('Tesseract analysis failed:', err);
		// Fallback — don't block grading if Tesseract fails
		return { confidenceScore: 50, breakdown: { wordConfidence: 50, lowConfWords: 50, totalWords: 0 } };
	}
}
