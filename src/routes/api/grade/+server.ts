import { json } from '@sveltejs/kit';
import sharp from 'sharp';
import Tesseract from 'tesseract.js';
import type { RequestHandler } from './$types';

/**
 * Document Readability Grade
 * 
 * Answers: "Can I trust the OCR output from this document?"
 * 
 * Focuses on real-world document damage:
 * - Wrinkled/folded paper → distorted text, broken words
 * - Water damage/stains → patches unreadable
 * - Creased from pocket → bent lines, misread chars
 * - Torn edges → missing text
 * - Yellowed/aged → reduced local contrast
 * 
 * These all manifest as Tesseract struggling — the core signal is OCR confidence.
 * Image quality is a minor secondary factor.
 */

export const POST: RequestHandler = async ({ request }) => {
	try {
		const { file, ocrText } = await request.json();
		if (!file) return json({ error: 'No file provided' }, { status: 400 });

		const base64Data = file.replace(/^data:[^;]+;base64,/, '');
		const buffer = Buffer.from(base64Data, 'base64');

		// Run Tesseract OCR + image analysis in parallel
		const [tesseractResult, imageMetrics] = await Promise.all([
			runTesseract(buffer),
			analyzeImage(buffer)
		]);

		// === DOCUMENT READABILITY SCORE ===
		// Primary signal (70%): Tesseract confidence — directly measures text readability
		// Secondary signal (15%): Text coherence — garbled/broken words indicate damage
		// Tertiary signal (15%): Image legibility — contrast and sharpness in text regions

		const tessScore = tesseractResult.confidence;
		const coherenceScore = analyzeTextCoherence(tesseractResult.text);
		const legibilityScore = imageMetrics.legibilityScore;

		// If OCR text was provided (from GLM), compare with Tesseract for divergence
		let divergenceScore = 100; // assume good if no comparison
		if (ocrText) {
			divergenceScore = compareOcrOutputs(tesseractResult.text, ocrText);
		}

		// Weighted composite — OCR readability is king
		const compositeScore = Math.round(
			tessScore * 0.55 +
			coherenceScore * 0.15 +
			legibilityScore * 0.15 +
			divergenceScore * 0.15
		);

		return json({
			compositeScore,
			breakdown: {
				ocrConfidence: Math.round(tessScore),
				textCoherence: Math.round(coherenceScore),
				legibility: Math.round(legibilityScore),
				...(ocrText ? { crossCheck: Math.round(divergenceScore) } : {})
			},
			meta: { width: imageMetrics.width, height: imageMetrics.height },
			tesseractText: tesseractResult.text
		});
	} catch (err) {
		console.error('Grade endpoint error:', err);
		return json({ error: 'Failed to analyze document quality' }, { status: 500 });
	}
};

// ─── Tesseract OCR ──────────────────────────────────────

async function runTesseract(buffer: Buffer): Promise<{ confidence: number; text: string }> {
	try {
		const pngBuffer = await sharp(buffer).png().toBuffer();
		const { data } = await Tesseract.recognize(pngBuffer, 'eng', {
			logger: () => {}
		});
		return {
			confidence: data.confidence ?? 0,
			text: data.text ?? ''
		};
	} catch {
		return { confidence: 0, text: '' };
	}
}

// ─── Text Coherence ─────────────────────────────────────
// Detects garbled/broken text typical of damaged documents

function analyzeTextCoherence(text: string): number {
	if (!text || text.trim().length < 5) return 10;

	const words = text.split(/\s+/).filter(w => w.length > 0);
	if (words.length === 0) return 10;

	let issues = 0;

	// 1. Short fragment ratio — damaged docs produce many 1-2 char fragments
	const shortFrags = words.filter(w => w.length <= 2 && !/^(a|I|to|in|on|of|or|an|is|it|at|no|do|be|we|he|so|if|my|up)$/i.test(w)).length;
	const shortRatio = shortFrags / words.length;

	// 2. Garbage character ratio — non-alphanumeric noise
	const cleanText = text.replace(/\s+/g, '');
	const garbageChars = (cleanText.match(/[^a-zA-Z0-9.,;:!?'"()\-\/\\€$£%@#&+=\n\r\t]/g) || []).length;
	const garbageRatio = cleanText.length > 0 ? garbageChars / cleanText.length : 0;

	// 3. Repeated character sequences — OCR artifacts (e.g., "lllll", "||||")
	const repeats = (text.match(/(.)\1{4,}/g) || []).length;

	// 4. Words with mixed case mid-word (e.g., "hELlo" "InVoIcE") — distortion sign
	const mixedCase = words.filter(w => w.length > 3 && /[a-z]/.test(w) && /[A-Z]/.test(w.slice(1)) && !/^[A-Z][a-z]+[A-Z]/.test(w)).length;
	const mixedRatio = mixedCase / words.length;

	// Score each factor (0-100, higher = better)
	const shortScore = shortRatio > 0.4 ? 10 : shortRatio > 0.25 ? 30 : shortRatio > 0.15 ? 55 : shortRatio > 0.05 ? 80 : 95;
	const garbageScore = garbageRatio > 0.3 ? 10 : garbageRatio > 0.15 ? 35 : garbageRatio > 0.05 ? 65 : 95;
	const repeatScore = repeats > 5 ? 20 : repeats > 2 ? 50 : repeats > 0 ? 80 : 100;
	const mixedScore = mixedRatio > 0.2 ? 20 : mixedRatio > 0.1 ? 50 : mixedRatio > 0.03 ? 75 : 95;

	return Math.round(shortScore * 0.3 + garbageScore * 0.35 + repeatScore * 0.15 + mixedScore * 0.2);
}

// ─── Image Legibility ───────────────────────────────────
// Focuses on whether text regions are readable, not overall image quality

async function analyzeImage(buffer: Buffer) {
	const image = sharp(buffer);
	const metadata = await image.metadata();
	const stats = await image.stats();

	const width = metadata.width || 0;
	const height = metadata.height || 0;

	const rgbChannels = stats.channels.slice(0, 3);
	const avgStdDev = rgbChannels.reduce((sum, ch) => sum + ch.stdev, 0) / rgbChannels.length;
	const avgRange = rgbChannels.reduce((sum, ch) => sum + (ch.max - ch.min), 0) / rgbChannels.length;

	// Local contrast indicator — documents need high range for text vs background
	// Low stddev + low range = washed out / water damaged / faded
	let contrastScore: number;
	if (avgRange >= 180) contrastScore = 100;
	else if (avgRange <= 50) contrastScore = 15;
	else contrastScore = 15 + 85 * ((avgRange - 50) / 130);

	// Sharpness — blurry from creases/folds/bad scan
	let sharpScore: number;
	if (avgStdDev >= 50) sharpScore = 100;
	else if (avgStdDev <= 8) sharpScore = 10;
	else sharpScore = 10 + 90 * ((avgStdDev - 8) / 42);

	const legibilityScore = Math.round(contrastScore * 0.5 + sharpScore * 0.5);

	return { legibilityScore, width, height };
}

// ─── Cross-check: Tesseract vs GLM ─────────────────────
// High divergence = source document is unreliable

function compareOcrOutputs(tessText: string, glmText: string): number {
	if (!tessText.trim() || !glmText.trim()) return 50;

	// Normalize both texts
	const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
	const a = norm(tessText);
	const b = norm(glmText);

	if (!a || !b) return 50;

	// Word-level overlap (Jaccard-like)
	const wordsA = new Set(a.split(' '));
	const wordsB = new Set(b.split(' '));
	let overlap = 0;
	for (const w of wordsA) {
		if (wordsB.has(w)) overlap++;
	}
	const union = new Set([...wordsA, ...wordsB]).size;
	const similarity = union > 0 ? overlap / union : 0;

	// High similarity = both engines agree = trustworthy source
	// Low similarity = engines disagree = damaged/ambiguous source
	if (similarity >= 0.7) return 95;
	if (similarity >= 0.5) return 70;
	if (similarity >= 0.3) return 45;
	if (similarity >= 0.15) return 25;
	return 10;
}
