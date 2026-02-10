import { json } from '@sveltejs/kit';
import sharp from 'sharp';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const { file } = await request.json();
		if (!file) return json({ error: 'No file provided' }, { status: 400 });

		// Strip data URL prefix
		const base64Data = file.replace(/^data:[^;]+;base64,/, '');
		const buffer = Buffer.from(base64Data, 'base64');

		const image = sharp(buffer);
		const metadata = await image.metadata();
		const stats = await image.stats();

		const width = metadata.width || 0;
		const height = metadata.height || 0;
		const pixels = width * height;

		// 1. Resolution score (0-100)
		let resolutionScore: number;
		if (pixels >= 1500 * 1500) resolutionScore = 100;
		else if (pixels <= 500 * 500) resolutionScore = 20;
		else resolutionScore = 20 + 80 * ((pixels - 250000) / (2250000 - 250000));

		// 2. Sharpness/blur proxy: average stddev across channels
		// Higher stddev = more detail/edges = sharper
		const avgStdDev = stats.channels.reduce((sum, ch) => sum + ch.stdev, 0) / stats.channels.length;
		let sharpnessScore: number;
		if (avgStdDev >= 60) sharpnessScore = 100;
		else if (avgStdDev <= 10) sharpnessScore = 10;
		else sharpnessScore = 10 + 90 * ((avgStdDev - 10) / 50);

		// 3. Contrast: range between min and max across channels
		const avgRange = stats.channels.reduce((sum, ch) => sum + (ch.maxVal - ch.minVal), 0) / stats.channels.length;
		let contrastScore: number;
		if (avgRange >= 200) contrastScore = 100;
		else if (avgRange <= 30) contrastScore = 10;
		else contrastScore = 10 + 90 * ((avgRange - 30) / 170);

		// Weighted image quality score
		const imageScore = Math.round(
			resolutionScore * 0.3 + sharpnessScore * 0.4 + contrastScore * 0.3
		);

		return json({
			imageScore,
			breakdown: {
				resolution: Math.round(resolutionScore),
				sharpness: Math.round(sharpnessScore),
				contrast: Math.round(contrastScore)
			},
			meta: { width, height, avgStdDev: Math.round(avgStdDev * 10) / 10, avgRange: Math.round(avgRange) }
		});
	} catch (err) {
		console.error('Grade endpoint error:', err);
		return json({ error: 'Failed to analyze image quality' }, { status: 500 });
	}
};
