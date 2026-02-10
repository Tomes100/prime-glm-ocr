<script lang="ts">
	import { marked } from 'marked';
	import { browser } from '$app/environment';

	const SCAN_LIMIT = 5;
	const STORAGE_KEY = 'prime_ocr_scans';

	let darkMode = $state(false);
	let dragging = $state(false);
	let loading = $state(false);
	let result = $state('');
	let htmlResult = $state('');
	let rawResponse: any = $state(null);
	let outputMode: 'formatted' | 'text' | 'markdown' | 'full' = $state('formatted');
	let error = $state('');
	let copied = $state(false);
	let previewUrl = $state('');
	let imageBase64 = $state('');
	let hoveredIndex: number | null = $state(null);
	let fileName = $state('');
	let enhancing = $state(false);
	let enhanced = $state(false);
	let enhancedMd = $state('');
	let splitRatio = $state(50);
	let resizing = $state(false);
	let mobileView: 'result' | 'preview' = $state('result');

	// ── Scan limit tracking ─────────────────────────────
	let scanCount = $state(0);
	let isAdmin = $state(false);
	let trialEnded = $derived(!isAdmin && scanCount >= SCAN_LIMIT);
	let scansRemaining = $derived(Math.max(0, SCAN_LIMIT - scanCount));

	$effect(() => {
		if (browser) {
			const stored = localStorage.getItem(STORAGE_KEY);
			if (stored) scanCount = parseInt(stored, 10) || 0;
			isAdmin = localStorage.getItem('prime_ocr_admin') === 'true';
		}
	});

	function incrementScanCount() {
		if (isAdmin) return; // admin doesn't burn scans
		scanCount++;
		if (browser) localStorage.setItem(STORAGE_KEY, String(scanCount));
	}

	interface LayoutItem {
		index: number;
		label: string;
		content?: string;
		bbox_2d: number[];
		width: number;
		height: number;
	}

	// All layout items with content
	let layoutItems: LayoutItem[] = $derived(
		rawResponse?.layout_details?.[0]?.filter((item: LayoutItem) => item.content) || []
	);

	// Sort by area descending so smaller (nested) boxes render on top
	let sortedOverlays: LayoutItem[] = $derived(
		[...layoutItems].sort((a, b) => {
			const areaA = (a.bbox_2d[2] - a.bbox_2d[0]) * (a.bbox_2d[3] - a.bbox_2d[1]);
			const areaB = (b.bbox_2d[2] - b.bbox_2d[0]) * (b.bbox_2d[3] - b.bbox_2d[1]);
			return areaB - areaA; // largest first → rendered first → smallest on top
		})
	);

	let hasDocument = $derived(!!(result || htmlResult || rawResponse));

	function toggleDark() {
		darkMode = !darkMode;
		document.documentElement.classList.toggle('dark', darkMode);
	}

	// ── Drag & drop (window-level) ──────────────────────
	let dragCounter = 0;

	function handleWindowDragEnter(e: DragEvent) {
		e.preventDefault();
		dragCounter++;
		if (dragCounter === 1) dragging = true;
	}

	function handleWindowDragLeave(e: DragEvent) {
		e.preventDefault();
		dragCounter--;
		if (dragCounter <= 0) { dragCounter = 0; dragging = false; }
	}

	function handleWindowDrop(e: DragEvent) {
		e.preventDefault();
		dragCounter = 0;
		dragging = false;
		if (e.dataTransfer?.files?.length) processFile(e.dataTransfer.files[0]);
	}

	function handleWindowDragOver(e: DragEvent) { e.preventDefault(); }

	function handleFileInput(e: Event) {
		const input = e.target as HTMLInputElement;
		if (input.files?.length) processFile(input.files[0]);
	}

	// ── Resize handle ───────────────────────────────────
	function startResize(e: MouseEvent) {
		e.preventDefault();
		resizing = true;
		const startX = e.clientX;
		const startRatio = splitRatio;
		const container = (e.target as HTMLElement).parentElement!;
		const containerWidth = container.getBoundingClientRect().width;

		function onMove(ev: MouseEvent) {
			const dx = ev.clientX - startX;
			splitRatio = Math.max(25, Math.min(75, startRatio + (dx / containerWidth) * 100));
		}
		function onUp() {
			resizing = false;
			window.removeEventListener('mousemove', onMove);
			window.removeEventListener('mouseup', onUp);
		}
		window.addEventListener('mousemove', onMove);
		window.addEventListener('mouseup', onUp);
	}

	// ── Compute overlay style as percentage of image ────
	function overlayStyle(item: LayoutItem): string {
		const [x1, y1, x2, y2] = item.bbox_2d;
		const w = item.width || 1;
		const h = item.height || 1;
		return `left:${(x1/w)*100}%;top:${(y1/h)*100}%;width:${((x2-x1)/w)*100}%;height:${((y2-y1)/h)*100}%;`;
	}

	// ── Clean markdown ──────────────────────────────────
	function cleanMarkdown(md: string): string {
		// 1. Remove ![...](page=...,bbox=...) patterns that marked can't render as images
		let cleaned = md.replace(/!\[[^\]]*\]\(page=[^)]*\)/g, '');

		// 2. Convert single-column markdown tables to plain text blocks.
		//    OCR often wraps receipt/doc text in tables which kills line breaks.
		cleaned = convertSingleColumnTables(cleaned);

		return cleaned;
	}

	function convertSingleColumnTables(md: string): string {
		const lines = md.split('\n');
		const output: string[] = [];
		let i = 0;

		while (i < lines.length) {
			const line = lines[i];

			// Detect table row: starts and ends with |
			if (/^\s*\|/.test(line) && /\|\s*$/.test(line)) {
				// Collect consecutive table lines
				const tableLines: string[] = [];
				const startIdx = i;
				while (i < lines.length && /^\s*\|/.test(lines[i])) {
					tableLines.push(lines[i]);
					i++;
				}

				// Check if single-column: filter out separator rows, then check for inner |
				const dataRows = tableLines.filter(r => !/^\s*\|[\s\-:]+\|\s*$/.test(r.trim()));
				const isSingleColumn = dataRows.every(r => {
					const inner = r.replace(/^\s*\|\s*/, '').replace(/\s*\|\s*$/, '');
					return !inner.includes('|');
				});

				if (isSingleColumn && dataRows.length > 0) {
					// Convert each row to a paragraph
					for (const row of dataRows) {
						const content = row.replace(/^\s*\|\s*/, '').replace(/\s*\|\s*$/, '').trim();
						if (content) {
							output.push(content);
							output.push(''); // blank line = paragraph break
						}
					}
				} else {
					// Multi-column table — keep as-is
					for (let j = startIdx; j < startIdx + tableLines.length; j++) {
						output.push(lines[j]);
					}
				}
			} else {
				output.push(line);
				i++;
			}
		}

		return output.join('\n');
	}

	// ── Use layout items to reconstruct line breaks ─────
	// If a layout item's bbox contains multiple child items stacked vertically,
	// replace the parent content with children joined by \n
	function insertLineBreaksFromLayout(md: string, items: LayoutItem[]): string {
		if (items.length < 2) return md;

		// Build parent→children map: parent = item whose bbox fully contains others
		const processed = new Set<number>();
		const replacements: [string, string][] = [];

		for (const parent of items) {
			const [px1, py1, px2, py2] = parent.bbox_2d;
			if (!parent.content || parent.content.trim().length < 10) continue;

			// Find children: smaller items fully inside parent's bbox
			const children = items.filter(child => {
				if (child.index === parent.index || !child.content) return false;
				if (processed.has(child.index)) return false;
				const [cx1, cy1, cx2, cy2] = child.bbox_2d;
				// Fully contained with some tolerance (2px)
				return cx1 >= px1 - 2 && cy1 >= py1 - 2 && cx2 <= px2 + 2 && cy2 <= py2 + 2;
			});

			if (children.length >= 2) {
				// Sort children top-to-bottom, then left-to-right
				children.sort((a, b) => {
					const dy = a.bbox_2d[1] - b.bbox_2d[1];
					if (Math.abs(dy) > 5) return dy; // different lines
					return a.bbox_2d[0] - b.bbox_2d[0]; // same line, left to right
				});

				const reconstructed = children
					.map(c => c.content!.trim())
					.filter(Boolean)
					.join('\n');

				if (reconstructed && parent.content) {
					replacements.push([parent.content.trim(), reconstructed]);
					children.forEach(c => processed.add(c.index));
				}
			}
		}

		// Apply replacements to the markdown (longest first to avoid partial matches)
		replacements.sort((a, b) => b[0].length - a[0].length);
		for (const [original, replacement] of replacements) {
			const escaped = original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
			try {
				md = md.replace(new RegExp(escaped, 's'), replacement);
			} catch { /* skip */ }
		}

		return md;
	}

	// ── File processing ─────────────────────────────────
	async function processFile(file: File) {
		error = '';
		result = '';
		htmlResult = '';
		rawResponse = null;
		hoveredIndex = null;
		fileName = file.name;

		const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
		if (!validTypes.includes(file.type)) {
			error = 'Unsupported file type. Please upload JPG, PNG, WebP, or PDF.';
			return;
		}

		if (file.type.startsWith('image/')) {
			previewUrl = URL.createObjectURL(file);
		} else if (file.type === 'application/pdf') {
			previewUrl = '';
			try {
				const cdnBase = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174';
				if (!(window as any).pdfjsLib) {
					await new Promise<void>((resolve, reject) => {
						const s = document.createElement('script');
						s.src = `${cdnBase}/pdf.min.js`;
						s.onload = () => resolve();
						s.onerror = reject;
						document.head.appendChild(s);
					});
				}
				const pdfjs = (window as any).pdfjsLib;
				if (pdfjs) {
					pdfjs.GlobalWorkerOptions.workerSrc = `${cdnBase}/pdf.worker.min.js`;
					const arrayBuf = await file.arrayBuffer();
					const pdf = await pdfjs.getDocument({ data: arrayBuf }).promise;
					const page = await pdf.getPage(1);
					const viewport = page.getViewport({ scale: 2 });
					const canvas = document.createElement('canvas');
					canvas.width = viewport.width;
					canvas.height = viewport.height;
					const ctx = canvas.getContext('2d')!;
					await page.render({ canvasContext: ctx, viewport }).promise;
					previewUrl = canvas.toDataURL('image/png');
				}
			} catch (pdfErr) {
				console.warn('PDF preview failed:', pdfErr);
				previewUrl = '';
			}
		} else {
			previewUrl = '';
		}

		// Check scan limit
		if (trialEnded) {
			error = 'Free trial ended. Contact us for continued access.';
			return;
		}

		loading = true;
		enhanced = false;
		enhancedMd = '';
		try {
			const base64 = await fileToBase64(file);
			imageBase64 = base64;
			const res = await fetch('/api/ocr', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ file: base64, fileName: file.name })
			});
			const data = await res.json();
			if (!res.ok) {
				error = data.error || `OCR failed (${res.status})`;
				loading = false;
				return;
			}
			rawResponse = data;
			incrementScanCount();
			updateResult();
		} catch (err) {
			error = 'Failed to process file: ' + String(err);
		} finally {
			loading = false;
		}
	}

	// ── Hover-wrap helpers ──────────────────────────────

	/** Strip markdown syntax so we search for plain text in rendered HTML */
	function stripMd(text: string): string {
		return text
			.replace(/^#{1,6}\s+/gm, '')
			.replace(/\*\*(.+?)\*\*/g, '$1')
			.replace(/\*(.+?)\*/g, '$1')
			.replace(/__(.+?)__/g, '$1')
			.replace(/_(.+?)_/g, '$1')
			.replace(/~~(.+?)~~/g, '$1')
			.replace(/`(.+?)`/g, '$1')
			.replace(/!\[.*?\]\(.*?\)/g, '')
			.replace(/\[([^\]]*)\]\(.*?\)/g, '$1')
			.trim();
	}

	/** HTML-encode special chars to match what marked outputs */
	function htmlEnc(text: string): string {
		return text
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;');
	}

	/** Build regex pattern that matches text across <br>, whitespace, &nbsp; */
	function buildMatchPattern(text: string, allowTags = false): string {
		const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		if (allowTags) {
			// Allow any HTML tags (like <td>, </td>, <tr>, etc.) between words
			return escaped.replace(/\s+/g, '(?:<[^>]*>|<br\\s*/?>|\\s|&nbsp;)*\\s*(?:<[^>]*>|<br\\s*/?>|\\s|&nbsp;)*');
		}
		return escaped.replace(/\s+/g, '(?:<br\\s*/?>|\\s|&nbsp;)+');
	}

	/** Try to wrap first valid (non-tag-interior) match in html */
	function tryWrapFirst(html: string, pattern: string, index: number): { html: string; matched: boolean } {
		try {
			const regex = new RegExp(pattern, 'gsi');
			let match;
			while ((match = regex.exec(html)) !== null) {
				const offset = match.index;
				const before = html.substring(Math.max(0, offset - 300), offset);
				if (/<[^>]*$/.test(before)) continue; // inside an HTML tag attribute, skip
				const wrapped = `<span class="ocr-hover" data-index="${index}">${match[0]}</span>`;
				return {
					html: html.substring(0, offset) + wrapped + html.substring(offset + match[0].length),
					matched: true
				};
			}
		} catch { /* regex too complex or invalid */ }
		return { html, matched: false };
	}

	function buildFormattedHtml(md: string): string {
		let processed = cleanMarkdown(md);
		processed = insertLineBreaksFromLayout(processed, layoutItems);
		let html = marked.parse(processed, { async: false, breaks: true }) as string;

		const debugItems: Array<{
			index: number;
			label: string;
			contentLen: number;
			contentPreview: string;
			matched: boolean;
			matchType: string;
			plainPreview: string;
		}> = [];

		// Sort by content length ASCENDING — small items (table cells) first,
		// so they get wrapped before larger parents consume their text
		const sortedItems = [...layoutItems]
			.filter(item => item.content && item.content.trim().length >= 2)
			.sort((a, b) => (a.content?.length || 0) - (b.content?.length || 0));

		for (const item of sortedItems) {
			const raw = item.content!.trim();
			const plain = htmlEnc(stripMd(raw));
			let matched = false;
			let matchType = 'none';

			// Strategy 1: Full content (up to 500 chars to avoid regex explosion)
			if (plain.length >= 2 && plain.length <= 500) {
				const pattern = buildMatchPattern(plain);
				const result = tryWrapFirst(html, pattern, item.index);
				if (result.matched) { html = result.html; matched = true; matchType = 'full'; }
			}

			// Strategy 2: First line only
			if (!matched) {
				const firstLine = htmlEnc(stripMd(raw.split(/\n/)[0].trim()));
				if (firstLine.length >= 3 && firstLine !== plain) {
					const pattern = buildMatchPattern(firstLine);
					const result = tryWrapFirst(html, pattern, item.index);
					if (result.matched) { html = result.html; matched = true; matchType = 'first-line'; }
				}
			}

			// Strategy 3: First 8 words (for very long or multi-paragraph content)
			if (!matched) {
				const words = plain.split(/\s+/).slice(0, 8).join(' ');
				if (words.length >= 5 && words !== plain) {
					const pattern = buildMatchPattern(words);
					const result = tryWrapFirst(html, pattern, item.index);
					if (result.matched) { html = result.html; matched = true; matchType = 'first-words'; }
				}
			}

			// Strategy 4: For very short content (2-20 chars), try exact substring in HTML text
			if (!matched && plain.length >= 2 && plain.length <= 20) {
				const escaped = plain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
				const result = tryWrapFirst(html, escaped, item.index);
				if (result.matched) { html = result.html; matched = true; matchType = 'exact-short'; }
			}

			// Strategy 5: Allow HTML tags between words (catches table cells, rows with <td>/<th> tags)
			if (!matched && plain.length >= 3 && plain.length <= 500) {
				const pattern = buildMatchPattern(plain, true);
				const result = tryWrapFirst(html, pattern, item.index);
				if (result.matched) { html = result.html; matched = true; matchType = 'tag-tolerant'; }
			}

			// Strategy 6: Tag-tolerant first line
			if (!matched) {
				const firstLine = htmlEnc(stripMd(raw.split(/\n/)[0].trim()));
				if (firstLine.length >= 3) {
					const pattern = buildMatchPattern(firstLine, true);
					const result = tryWrapFirst(html, pattern, item.index);
					if (result.matched) { html = result.html; matched = true; matchType = 'tag-tolerant-line'; }
				}
			}

			debugItems.push({
				index: item.index,
				label: item.label,
				contentLen: raw.length,
				contentPreview: raw.substring(0, 80),
				matched,
				matchType,
				plainPreview: plain.substring(0, 80)
			});
		}

		// Store debug log for admin inspection
		if (browser) {
			const debugLog = {
				timestamp: Date.now(),
				totalItems: layoutItems.length,
				matchedItems: debugItems.filter(d => d.matched).length,
				unmatchedItems: debugItems.filter(d => !d.matched).length,
				items: debugItems
			};
			localStorage.setItem('prime_ocr_debug', JSON.stringify(debugLog));
			// Also fire-and-forget to server
			fetch('/api/admin/debug', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(debugLog)
			}).catch(() => {});
		}

		return html;
	}

	async function enhanceDocument() {
		if (!rawResponse || !imageBase64 || enhancing) return;
		enhancing = true;
		try {
			const md = rawResponse.md_results || rawResponse.data?.md_results || extractText(rawResponse);
			const res = await fetch('/api/enhance', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ image: imageBase64, extractedText: md })
			});
			const data = await res.json();
			if (!res.ok) {
				error = data.error || 'Enhancement failed';
				return;
			}
			enhancedMd = data.enhanced;
			enhanced = true;
			updateResult();
		} catch (err) {
			error = 'Enhancement failed: ' + String(err);
		} finally {
			enhancing = false;
		}
	}

	function updateResult() {
		if (!rawResponse) return;
		let md = enhanced && enhancedMd ? enhancedMd : (rawResponse.md_results || rawResponse.data?.md_results || extractText(rawResponse));
		if (outputMode === 'full') {
			result = JSON.stringify(rawResponse, null, 2);
			htmlResult = '';
		} else if (outputMode === 'formatted') {
			result = '';
			htmlResult = buildFormattedHtml(md);
		} else if (outputMode === 'markdown') {
			result = insertLineBreaksFromLayout(cleanMarkdown(md), layoutItems);
			htmlResult = '';
		} else {
			result = insertLineBreaksFromLayout(cleanMarkdown(md), layoutItems)
				.replace(/!\[.*?\]\(.*?\)/g, '')
				.replace(/\[([^\]]*)\]\(.*?\)/g, '$1')
				.replace(/#{1,6}\s*/g, '')
				.replace(/[*_`~>|]/g, '')
				.replace(/\n{3,}/g, '\n\n')
				.trim();
			htmlResult = '';
		}
	}

	function extractText(data: any): string {
		if (typeof data === 'string') return data;
		if (data?.choices?.[0]?.message?.content) return data.choices[0].message.content;
		if (data?.result) return data.result;
		return JSON.stringify(data, null, 2);
	}

	$effect(() => {
		outputMode;
		updateResult();
	});

	function fileToBase64(file: File): Promise<string> {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(reader.result as string);
			reader.onerror = reject;
			reader.readAsDataURL(file);
		});
	}

	async function copyToClipboard() {
		const text = outputMode === 'formatted'
			? cleanMarkdown(rawResponse?.md_results || rawResponse?.data?.md_results || result)
			: result;
		await navigator.clipboard.writeText(text);
		copied = true;
		setTimeout(() => copied = false, 2000);
	}

	function download(ext: 'txt' | 'md') {
		const content = outputMode === 'formatted'
			? cleanMarkdown(rawResponse?.md_results || rawResponse?.data?.md_results || result)
			: result;
		const blob = new Blob([content], { type: 'text/plain' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `ocr-result.${ext}`;
		a.click();
		URL.revokeObjectURL(url);
	}

	function resetDocument() {
		result = '';
		htmlResult = '';
		rawResponse = null;
		error = '';
		previewUrl = '';
		fileName = '';
		hoveredIndex = null;
	}

	function handleFormattedHover(e: MouseEvent) {
		const target = (e.target as HTMLElement).closest('.ocr-hover');
		if (target) {
			hoveredIndex = parseInt(target.getAttribute('data-index') || '-1');
		} else {
			hoveredIndex = null;
		}
	}

	// Scroll text span into view when hovering image overlay
	function scrollTextIntoView(index: number) {
		const el = document.querySelector(`.ocr-hover[data-index="${index}"]`);
		if (el) {
			el.scrollIntoView({ behavior: 'smooth', block: 'center' });
		}
	}
</script>

<svelte:window
	ondragenter={handleWindowDragEnter}
	ondragleave={handleWindowDragLeave}
	ondragover={handleWindowDragOver}
	ondrop={handleWindowDrop}
/>

<div class="h-screen flex flex-col overflow-hidden transition-colors duration-300 {darkMode ? 'bg-navy-deeper text-slate-100' : 'bg-white text-navy'}">

	<!-- ── Full-screen drag overlay ────────────────────── -->
	{#if dragging}
		<div class="drag-overlay fixed inset-0 z-[100] flex items-center justify-center bg-navy-deeper/95 backdrop-blur-sm">
			<div class="text-center space-y-4">
				<div class="w-24 h-24 mx-auto rounded-3xl bg-cyan/20 border-2 border-dashed border-cyan flex items-center justify-center">
					<svg class="w-12 h-12 text-cyan" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/>
					</svg>
				</div>
				<p class="text-2xl font-semibold text-white">Drop your document</p>
				<p class="text-sm text-slate-400">JPG, PNG, WebP, PDF</p>
			</div>
		</div>
	{/if}

	<!-- ── App Header ─────────────────────────────────── -->
	<header class="flex-none h-14 {darkMode ? 'border-b border-white/10 bg-navy-dark' : 'bg-white shadow-md'} flex items-center px-4 lg:px-6 gap-4 z-40 transition-all duration-300">
		<a href="/" class="flex items-center gap-2.5">
			{#if darkMode}
				<img src="https://prime-robotics.eu/logo-white.png" alt="Prime Robotics" class="h-8 w-auto" />
			{:else}
				<img src="https://prime-robotics.eu/logo.png" alt="Prime Robotics" class="h-8 w-auto" />
			{/if}
			<div class="w-px h-5 {darkMode ? 'bg-white/15' : 'bg-slate-300'}"></div>
			<span class="text-sm font-bold {darkMode ? 'text-white' : 'text-navy'} tracking-tight">OCR</span>
		</a>

		{#if hasDocument && fileName}
			<div class="w-px h-5 {darkMode ? 'bg-white/10' : 'bg-slate-200'}"></div>
			<div class="flex items-center gap-2 text-sm {darkMode ? 'text-slate-400' : 'text-slate-500'}">
				<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
				<span class="truncate max-w-48">{fileName}</span>
			</div>

			<div class="flex-1"></div>

			<div class="hidden sm:flex items-center rounded-lg overflow-hidden border {darkMode ? 'border-white/10 bg-navy-dark/50' : 'border-gray-200 bg-gray-50'}">
				{#each [['formatted', 'Formatted'], ['text', 'Text'], ['markdown', 'MD'], ['full', 'JSON']] as [val, label]}
					<button
						onclick={() => outputMode = val as any}
						class="px-3 py-1.5 text-xs font-medium transition-all {outputMode === val ? 'bg-cyan text-white' : darkMode ? 'text-slate-400 hover:text-white hover:bg-white/5' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'}"
					>{label}</button>
				{/each}
			</div>

			<div class="flex items-center gap-1">
				<button onclick={copyToClipboard} class="p-2 rounded-lg text-sm transition-all {darkMode ? 'hover:bg-white/5 text-slate-400 hover:text-white' : 'hover:bg-slate-100 text-slate-500 hover:text-slate-900'}" title="Copy to clipboard">
					{#if copied}
						<svg class="w-4 h-4 text-cyan" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
					{:else}
						<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
					{/if}
				</button>
				<button onclick={() => download('txt')} class="p-2 rounded-lg text-sm transition-all {darkMode ? 'hover:bg-white/5 text-slate-400 hover:text-white' : 'hover:bg-slate-100 text-slate-500 hover:text-slate-900'}" title="Download .txt">
					<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
				</button>
				<button onclick={() => download('md')} class="p-2 rounded-lg text-sm transition-all {darkMode ? 'hover:bg-white/5 text-slate-400 hover:text-white' : 'hover:bg-slate-100 text-slate-500 hover:text-slate-900'}" title="Download .md">
					<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
				</button>
				<div class="w-px h-5 mx-1 {darkMode ? 'bg-white/10' : 'bg-slate-200'}"></div>
				{#if !enhanced}
					<button
						onclick={enhanceDocument}
						disabled={enhancing}
						class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all
							{enhancing
								? 'bg-amber-500/20 text-amber-400 cursor-wait'
								: 'bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 hover:text-amber-400 border border-amber-500/20'}"
						title="Enhance with AI — reconstruct with higher fidelity"
					>
						{#if enhancing}
							<div class="w-3.5 h-3.5 border-2 border-amber-400 border-t-transparent rounded-full animate-spin"></div>
							Enhancing…
						{:else}
							<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"/></svg>
							Enhance ✨
						{/if}
					</button>
				{:else}
					<span class="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-green-500/10 text-green-500 border border-green-500/20">
						<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
						Enhanced
					</span>
				{/if}
				<div class="w-px h-5 mx-1 {darkMode ? 'bg-white/10' : 'bg-slate-200'}"></div>
				<button onclick={resetDocument} class="p-2 rounded-lg text-sm transition-all {darkMode ? 'hover:bg-white/5 text-slate-400 hover:text-white' : 'hover:bg-slate-100 text-slate-500 hover:text-slate-900'}" title="New document">
					<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
				</button>
			</div>
		{:else}
			<div class="flex-1"></div>
			<nav class="hidden sm:flex items-center gap-1">
				<a href="https://prime-robotics.eu/services" target="_blank" rel="noopener" class="px-3 py-1.5 text-sm font-medium rounded-lg transition-all {darkMode ? 'text-slate-300 hover:text-white hover:bg-white/5' : 'text-slate-600 hover:text-navy hover:bg-slate-100'}">Services</a>
				<a href="https://prime-robotics.eu/about" target="_blank" rel="noopener" class="px-3 py-1.5 text-sm font-medium rounded-lg transition-all {darkMode ? 'text-slate-300 hover:text-white hover:bg-white/5' : 'text-slate-600 hover:text-navy hover:bg-slate-100'}">About</a>
				<a href="https://prime-robotics.eu/contact" target="_blank" rel="noopener" class="ml-1 px-4 py-1.5 text-sm font-semibold rounded-lg bg-cyan text-white hover:bg-cyan-dark transition-all">Contact Us</a>
			</nav>
		{/if}

		<button onclick={toggleDark} class="p-2 rounded-lg transition-all {darkMode ? 'hover:bg-white/5 text-yellow-400' : 'hover:bg-slate-100 text-slate-500'}" title="Toggle theme">
			{#if darkMode}
				<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"/></svg>
			{:else}
				<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"/></svg>
			{/if}
		</button>
	</header>

	<!-- ── Main Area ──────────────────────────────────── -->
	<main class="flex-1 min-h-0 overflow-hidden">

		{#if !hasDocument && !loading}
			<!-- ── Empty State — fills viewport, no scroll ── -->
			<div class="h-full flex flex-col px-6 relative overflow-hidden">
				{#if darkMode}
					<div class="absolute top-1/4 -left-32 w-96 h-96 rounded-full bg-cyan/5 blur-3xl pointer-events-none"></div>
					<div class="absolute bottom-1/4 -right-32 w-96 h-96 rounded-full bg-cyan/5 blur-3xl pointer-events-none"></div>
				{/if}

				<!-- Hero + Upload — centered in available space -->
				<div class="flex-1 flex items-center justify-center min-h-0">
					<div class="relative w-full max-w-lg text-center space-y-6">
						<div class="space-y-3">
							<p class="font-mono text-xs tracking-wider text-cyan font-medium">DOCUMENT INTELLIGENCE</p>
							<h1 class="text-2xl lg:text-3xl font-bold {darkMode ? 'text-white' : 'text-navy'}">Extract text from any document.</h1>
							<p class="text-sm max-w-md mx-auto {darkMode ? 'text-slate-400' : 'text-gray-500'}">Upload invoices, receipts, contracts, or handwritten notes. Structured text with layout detection — instantly.</p>
						</div>

						{#if trialEnded}
							<!-- Trial ended state -->
							<div class="rounded-lg border-2 p-8 text-center {darkMode ? 'bg-navy-dark border-white/10' : 'bg-white border-gray-100'}">
								<div class="space-y-4">
									<div class="w-14 h-14 mx-auto rounded-lg {darkMode ? 'bg-orange-500/10' : 'bg-orange-50'} flex items-center justify-center">
										<svg class="w-7 h-7 {darkMode ? 'text-orange-400' : 'text-orange-500'}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>
									</div>
									<div>
										<p class="text-lg font-semibold {darkMode ? 'text-white' : 'text-navy'}">Free trial ended</p>
										<p class="text-sm mt-1.5 {darkMode ? 'text-slate-400' : 'text-slate-500'}">You've used all {SCAN_LIMIT} free scans. Get in touch for full access.</p>
									</div>
									<a
										href="https://prime-robotics.eu/contact"
										target="_blank"
										rel="noopener noreferrer"
										class="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-cyan text-white font-semibold text-sm hover:bg-cyan-dark transition-all shadow-lg shadow-cyan/20"
									>
										Contact Us
										<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7l5 5m0 0l-5 5m5-5H6"/></svg>
									</a>
								</div>
							</div>
						{:else}
							<!-- Upload zone -->
							<div class="relative group">
								<input type="file" accept=".jpg,.jpeg,.png,.webp,.pdf" class="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" onchange={handleFileInput} />
								<div class="rounded-lg border-2 p-8 sm:p-10 transition-all duration-300
									{darkMode ? 'border-white/15 group-hover:border-cyan bg-navy-dark/60' : 'border-gray-200 group-hover:border-cyan bg-gray-50/80 hover:shadow-xl'}">
									<div class="space-y-4 text-center">
										<div class="w-12 h-12 mx-auto rounded-lg bg-cyan/10 flex items-center justify-center transition-all group-hover:bg-cyan group-hover:text-white duration-300 text-cyan">
											<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/></svg>
										</div>
										<div>
											<span class="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-cyan text-white font-semibold text-sm hover:bg-cyan-dark transition-all shadow-md shadow-cyan/20">
												<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>
												Upload Document
											</span>
											<p class="text-xs mt-2.5 {darkMode ? 'text-slate-500' : 'text-gray-400'}">or drag and drop · JPG, PNG, WebP, PDF</p>
										</div>
									</div>
								</div>
							</div>

							<!-- Scan counter -->
							{#if !isAdmin}
								<p class="text-xs {darkMode ? 'text-slate-500' : 'text-gray-400'}">{scansRemaining} of {SCAN_LIMIT} free scans remaining</p>
							{/if}
						{/if}
					</div>
				</div>

				<!-- Bottom row: feature pills + CTA — compact, no scroll -->
				{#if !trialEnded}
					<div class="flex-none pb-5 relative">
						<div class="max-w-3xl mx-auto space-y-3">
							<!-- Feature pills -->
							<div class="flex flex-wrap items-center justify-center gap-3">
								<div class="flex items-center gap-2 px-3.5 py-2 rounded-lg border {darkMode ? 'bg-navy-dark/60 border-white/8' : 'bg-white border-gray-100'}">
									<div class="w-7 h-7 rounded bg-cyan/10 flex items-center justify-center text-cyan flex-none">
										<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M10 21h7a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v11m0 5l4.879-4.879m0 0a3 3 0 104.243-4.242 3 3 0 00-4.243 4.242z"/></svg>
									</div>
									<span class="text-xs font-medium {darkMode ? 'text-slate-300' : 'text-slate-600'}">Text Extraction</span>
								</div>
								<div class="flex items-center gap-2 px-3.5 py-2 rounded-lg border {darkMode ? 'bg-navy-dark/60 border-white/8' : 'bg-white border-gray-100'}">
									<div class="w-7 h-7 rounded bg-cyan/10 flex items-center justify-center text-cyan flex-none">
										<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z"/></svg>
									</div>
									<span class="text-xs font-medium {darkMode ? 'text-slate-300' : 'text-slate-600'}">Layout Detection</span>
								</div>
								<div class="flex items-center gap-2 px-3.5 py-2 rounded-lg border {darkMode ? 'bg-navy-dark/60 border-white/8' : 'bg-white border-gray-100'}">
									<div class="w-7 h-7 rounded bg-cyan/10 flex items-center justify-center text-cyan flex-none">
										<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
									</div>
									<span class="text-xs font-medium {darkMode ? 'text-slate-300' : 'text-slate-600'}">Multiple Formats</span>
								</div>
							</div>
							<!-- Subtle CTA -->
							<p class="text-center text-xs {darkMode ? 'text-slate-500' : 'text-gray-400'}">
								Need more scans or a custom solution? <a href="https://prime-robotics.eu/contact" target="_blank" rel="noopener" class="text-cyan font-medium hover:underline">Talk to us</a>
							</p>
						</div>
					</div>
				{/if}
			</div>

		{:else if loading}
			<!-- ── Loading ────────────────────────────────── -->
			<div class="h-full flex flex-col items-center justify-center gap-4">
				<div class="w-16 h-16 rounded-lg bg-cyan/10 flex items-center justify-center">
					<div class="w-8 h-8 border-2 border-cyan border-t-transparent rounded-full animate-spin"></div>
				</div>
				<div class="text-center">
					<p class="font-medium {darkMode ? 'text-white' : 'text-slate-900'}">Processing document</p>
					{#if fileName}<p class="text-sm mt-1 {darkMode ? 'text-slate-400' : 'text-slate-500'}">{fileName}</p>{/if}
				</div>
			</div>

		{:else}
			<!-- ── Document View ──────────────────────────── -->
			{#if error}
				<div class="mx-4 mt-4 rounded-xl p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-center gap-2">
					<svg class="w-4 h-4 flex-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
					{error}
				</div>
			{/if}

			<!-- Mobile tabs -->
			<div class="md:hidden flex items-center gap-1 px-3 py-2 border-b {darkMode ? 'border-white/10 bg-navy-dark/50' : 'border-gray-200 bg-gray-50'}">
				{#if previewUrl}
					<button onclick={() => mobileView = 'preview'} class="px-3 py-1.5 rounded-md text-xs font-medium transition-all {mobileView === 'preview' ? 'bg-cyan text-white' : darkMode ? 'text-slate-400' : 'text-slate-500'}">
						<svg class="w-4 h-4 inline -mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
					</button>
					<div class="w-px h-5 {darkMode ? 'bg-white/10' : 'bg-slate-200'}"></div>
				{/if}
				{#each [['formatted', 'Formatted'], ['text', 'Text'], ['markdown', 'MD'], ['full', 'JSON']] as [val, label]}
					<button onclick={() => { outputMode = val as any; mobileView = 'result'; }} class="flex-1 px-2 py-1.5 rounded-md text-xs font-medium transition-all {outputMode === val && mobileView === 'result' ? 'bg-cyan text-white' : darkMode ? 'text-slate-400' : 'text-slate-500'}">{label}</button>
				{/each}
			</div>

			<!-- ── Mobile Preview (shown when mobileView=preview) ── -->
			{#if previewUrl && mobileView === 'preview'}
				<div class="md:hidden flex-1 overflow-auto p-4 flex items-start justify-center {darkMode ? 'bg-navy-dark/50' : 'bg-gray-100'}">
					<div class="relative inline-block max-w-full">
						<img src={previewUrl} alt="Document preview" class="block max-w-full max-h-[calc(100vh-10rem)] object-contain rounded-lg shadow-xl {darkMode ? 'shadow-black/30' : 'shadow-slate-300/50'}" />
						<!-- No hover overlays on mobile -->
					</div>
				</div>
			{/if}

			<div class="flex h-full min-h-0 panel-enter {mobileView === 'preview' ? 'hidden md:flex' : ''}">
				<!-- ── Left: Preview with bbox overlays ──── -->
				{#if previewUrl}
					<div class="hidden md:flex flex-col min-w-0 overflow-hidden" style="width: {splitRatio}%">
						<div class="flex-1 overflow-auto p-4 flex items-start justify-center {darkMode ? 'bg-navy-dark/50' : 'bg-gray-100'}">
							<!-- Image wrapper: overlays positioned as % of image -->
							<div class="relative inline-block max-w-full max-h-full">
								<img
									src={previewUrl}
									alt="Document preview"
									class="block max-w-full max-h-[calc(100vh-8rem)] object-contain rounded-lg shadow-xl {darkMode ? 'shadow-black/30' : 'shadow-slate-300/50'}"
								/>
								<!-- Bbox overlays for ALL layout items -->
								{#each sortedOverlays as item, i (item.index)}
									<!-- svelte-ignore a11y_no_static_element_interactions a11y_mouse_events_have_key_events -->
									<div
										class="absolute rounded-sm transition-all duration-100 cursor-pointer
											{hoveredIndex === item.index
												? 'border-2 border-cyan bg-cyan/25 shadow-[0_0_8px_rgba(6,182,212,0.4)]'
												: 'border border-transparent hover:border-cyan/60 hover:bg-cyan/10'}"
										style="{overlayStyle(item)}z-index:{10 + i};"
										onmouseenter={() => { hoveredIndex = item.index; scrollTextIntoView(item.index); }}
										onmouseleave={() => { if (hoveredIndex === item.index) hoveredIndex = null; }}
									>
										<!-- Tooltip on hover -->
										{#if hoveredIndex === item.index && item.content}
											<div class="absolute left-0 bottom-full mb-1 px-2 py-1 rounded text-[10px] leading-tight max-w-64 truncate whitespace-nowrap pointer-events-none
												{darkMode ? 'bg-navy-dark text-cyan-light border border-cyan/30' : 'bg-white text-gray-700 border border-gray-200 shadow-lg'}">
												<span class="font-medium text-cyan mr-1">{item.label}</span>
												{item.content.substring(0, 80)}{item.content.length > 80 ? '...' : ''}
											</div>
										{/if}
									</div>
								{/each}
							</div>
						</div>
					</div>

					<!-- Resize handle -->
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						class="hidden md:flex w-1 flex-none cursor-col-resize items-center justify-center resize-handle {darkMode ? 'bg-white/5 hover:bg-cyan/30' : 'bg-slate-200 hover:bg-cyan/30'} transition-colors"
						onmousedown={startResize}
					>
						<div class="w-0.5 h-8 rounded-full {darkMode ? 'bg-white/20' : 'bg-slate-400'}"></div>
					</div>
				{/if}

				<!-- ── Right: Results ─────────────────────── -->
				<div class="flex-1 min-w-0 flex flex-col overflow-hidden" style={previewUrl ? `width: ${100 - splitRatio}%` : ''}>
					{#if outputMode === 'formatted' && htmlResult}
						<!-- svelte-ignore a11y_no_static_element_interactions a11y_mouse_events_have_key_events -->
						<div
							class="flex-1 overflow-auto p-6 lg:p-8 text-sm leading-relaxed formatted-content {darkMode ? 'text-slate-200' : 'text-slate-800'}"
							onmouseover={handleFormattedHover}
							onmouseout={() => hoveredIndex = null}
						>{@html htmlResult}</div>
					{:else}
						<pre class="flex-1 overflow-auto p-6 lg:p-8 text-sm leading-relaxed whitespace-pre-wrap break-words {darkMode ? 'text-slate-200' : 'text-slate-800'}">{result}</pre>
					{/if}
				</div>
			</div>
		{/if}
	</main>

	<!-- ── Status Bar ─────────────────────────────────── -->
	<footer class="flex-none h-8 border-t {darkMode ? 'border-white/5 bg-navy-dark/80' : 'border-gray-200 bg-gray-50'} flex items-center px-4 lg:px-6 text-[11px] {darkMode ? 'text-slate-500' : 'text-gray-400'} gap-4">
		<span class="font-medium">© 2026 Prime Robotics</span>
		<span class="{darkMode ? 'text-white/10' : 'text-gray-200'}">·</span>
		<a href="https://prime-robotics.eu" target="_blank" rel="noopener" class="hover:text-cyan transition-colors">prime-robotics.eu</a>
		<span class="{darkMode ? 'text-white/10' : 'text-gray-200'}">·</span>
		<a href="/privacy" class="hover:text-cyan transition-colors">Privacy</a>
		<span class="{darkMode ? 'text-white/10' : 'text-gray-200'}">·</span>
		<a href="/terms" class="hover:text-cyan transition-colors">Terms</a>
		{#if hasDocument && layoutItems.length > 0}
			<span class="{darkMode ? 'text-white/10' : 'text-gray-200'}">·</span>
			<span>{layoutItems.length} layout elements</span>
		{/if}
		<div class="flex-1"></div>
		{#if !trialEnded && !isAdmin}
			<span>{scansRemaining}/{SCAN_LIMIT} free scans</span>
		{:else if trialEnded}
			<span class="text-orange-500/70">Trial ended</span>
		{/if}
	</footer>
</div>

<!-- Dynamic highlight style for hovered text spans -->
<svelte:head>
	{#if hoveredIndex !== null}
		{@html `<style>@media(min-width:768px){.ocr-hover[data-index="${hoveredIndex}"]{background:rgba(0,153,200,0.15);outline:2px solid rgba(0,153,200,0.5);border-radius:2px;}}</style>`}
	{/if}
</svelte:head>
