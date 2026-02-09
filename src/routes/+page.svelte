<script lang="ts">
	import { marked } from 'marked';

	let darkMode = $state(true);
	let dragging = $state(false);
	let loading = $state(false);
	let result = $state('');
	let htmlResult = $state('');
	let rawResponse: any = $state(null);
	let outputMode: 'formatted' | 'text' | 'markdown' | 'full' = $state('formatted');
	let error = $state('');
	let copied = $state(false);
	let previewUrl = $state('');
	let hoveredIndex: number | null = $state(null);
	let imageEl: HTMLImageElement | null = $state(null);
	let imageContainerEl: HTMLDivElement | null = $state(null);
	let fileName = $state('');
	let splitRatio = $state(50); // percentage for left panel
	let resizing = $state(false);

	interface LayoutItem {
		index: number;
		label: string;
		content?: string;
		bbox_2d: number[];
		width: number;
		height: number;
	}

	let layoutItems: LayoutItem[] = $derived(
		rawResponse?.layout_details?.[0]?.filter((item: LayoutItem) => item.content) || []
	);

	let hasDocument = $derived(!!(result || htmlResult || rawResponse));

	let highlightStyle = $derived.by(() => {
		if (hoveredIndex === null || !imageEl || !imageContainerEl) return '';
		const item = layoutItems.find((l: LayoutItem) => l.index === hoveredIndex);
		if (!item) return '';

		const imgRect = imageEl.getBoundingClientRect();
		const containerRect = imageContainerEl.getBoundingClientRect();

		const origW = item.width;
		const origH = item.height;
		const [x1, y1, x2, y2] = item.bbox_2d;

		const scaleX = imgRect.width / origW;
		const scaleY = imgRect.height / origH;

		const offsetX = imgRect.left - containerRect.left;
		const offsetY = imgRect.top - containerRect.top;

		const left = offsetX + x1 * scaleX;
		const top = offsetY + y1 * scaleY;
		const width = (x2 - x1) * scaleX;
		const height = (y2 - y1) * scaleY;

		return `left:${left}px;top:${top}px;width:${width}px;height:${height}px;`;
	});

	function toggleDark() {
		darkMode = !darkMode;
		document.documentElement.classList.toggle('dark', darkMode);
	}

	// ── Drag & drop ─────────────────────────────────────
	let dragCounter = 0;

	function handleWindowDragEnter(e: DragEvent) {
		e.preventDefault();
		dragCounter++;
		if (dragCounter === 1) dragging = true;
	}

	function handleWindowDragLeave(e: DragEvent) {
		e.preventDefault();
		dragCounter--;
		if (dragCounter <= 0) {
			dragCounter = 0;
			dragging = false;
		}
	}

	function handleWindowDrop(e: DragEvent) {
		e.preventDefault();
		dragCounter = 0;
		dragging = false;
		if (e.dataTransfer?.files?.length) {
			processFile(e.dataTransfer.files[0]);
		}
	}

	function handleWindowDragOver(e: DragEvent) {
		e.preventDefault();
	}

	function handleFileInput(e: Event) {
		const input = e.target as HTMLInputElement;
		if (input.files?.length) {
			processFile(input.files[0]);
		}
	}

	// ── Resize ──────────────────────────────────────────
	function startResize(e: MouseEvent) {
		e.preventDefault();
		resizing = true;
		const startX = e.clientX;
		const startRatio = splitRatio;
		const container = (e.target as HTMLElement).parentElement!;
		const containerWidth = container.getBoundingClientRect().width;

		function onMove(ev: MouseEvent) {
			const dx = ev.clientX - startX;
			const newRatio = startRatio + (dx / containerWidth) * 100;
			splitRatio = Math.max(25, Math.min(75, newRatio));
		}

		function onUp() {
			resizing = false;
			window.removeEventListener('mousemove', onMove);
			window.removeEventListener('mouseup', onUp);
		}

		window.addEventListener('mousemove', onMove);
		window.addEventListener('mouseup', onUp);
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

		loading = true;
		try {
			const base64 = await fileToBase64(file);
			const res = await fetch('/api/ocr', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ file: base64 })
			});
			const data = await res.json();
			if (!res.ok) {
				error = data.error || `OCR failed (${res.status})`;
				loading = false;
				return;
			}
			rawResponse = data;
			updateResult();
		} catch (err) {
			error = 'Failed to process file: ' + String(err);
		} finally {
			loading = false;
		}
	}

	function buildFormattedHtml(md: string): string {
		let html = marked.parse(md, { async: false }) as string;
		if (layoutItems.length > 0) {
			for (const item of layoutItems) {
				if (!item.content || item.content.length < 3) continue;
				const escaped = item.content.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
				const regex = new RegExp(`(?<!data-index="\\d*">)(${escaped})`, '');
				html = html.replace(regex, `<span class="ocr-hover" data-index="${item.index}">$1</span>`);
			}
		}
		return html;
	}

	function updateResult() {
		if (!rawResponse) return;
		const md = rawResponse.md_results || rawResponse.data?.md_results || extractText(rawResponse);
		if (outputMode === 'full') {
			result = JSON.stringify(rawResponse, null, 2);
			htmlResult = '';
		} else if (outputMode === 'formatted') {
			result = '';
			htmlResult = buildFormattedHtml(md);
		} else if (outputMode === 'markdown') {
			result = md;
			htmlResult = '';
		} else {
			result = md
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
			? (rawResponse?.md_results || rawResponse?.data?.md_results || result)
			: result;
		await navigator.clipboard.writeText(text);
		copied = true;
		setTimeout(() => copied = false, 2000);
	}

	function download(ext: 'txt' | 'md') {
		const content = outputMode === 'formatted'
			? (rawResponse?.md_results || rawResponse?.data?.md_results || result)
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
</script>

<svelte:window
	ondragenter={handleWindowDragEnter}
	ondragleave={handleWindowDragLeave}
	ondragover={handleWindowDragOver}
	ondrop={handleWindowDrop}
/>

<div class="h-screen flex flex-col overflow-hidden transition-colors duration-300 {darkMode ? 'bg-navy text-slate-100' : 'bg-surface text-slate-900'}">

	<!-- ── Full-screen drag overlay ────────────────────── -->
	{#if dragging}
		<div class="drag-overlay fixed inset-0 z-[100] flex items-center justify-center bg-navy/90 backdrop-blur-sm">
			<div class="text-center space-y-4">
				<div class="w-24 h-24 mx-auto rounded-3xl bg-cyan/20 border-2 border-dashed border-cyan flex items-center justify-center">
					<svg class="w-12 h-12 text-cyan" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/>
					</svg>
				</div>
				<p class="text-2xl font-semibold text-white">Drop your document</p>
				<p class="text-sm text-slate-400">JPG · PNG · WebP · PDF</p>
			</div>
		</div>
	{/if}

	<!-- ── App Header ─────────────────────────────────── -->
	<header class="flex-none h-14 border-b {darkMode ? 'border-white/10 bg-navy-light/80' : 'border-slate-200 bg-white/80'} backdrop-blur-xl flex items-center px-4 gap-3 z-40">
		<!-- Logo -->
		<div class="flex items-center gap-2.5">
			<div class="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan to-cyan-dark flex items-center justify-center text-white font-bold text-sm shadow-lg shadow-cyan/20">P</div>
			<span class="text-sm font-bold tracking-tight">Prime OCR</span>
		</div>

		<!-- Divider -->
		<div class="w-px h-5 {darkMode ? 'bg-white/10' : 'bg-slate-200'}"></div>

		{#if hasDocument && fileName}
			<!-- File name -->
			<div class="flex items-center gap-2 text-sm {darkMode ? 'text-slate-400' : 'text-slate-500'}">
				<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
				</svg>
				<span class="truncate max-w-48">{fileName}</span>
			</div>

			<!-- Spacer -->
			<div class="flex-1"></div>

			<!-- Output mode tabs -->
			<div class="hidden sm:flex items-center rounded-lg overflow-hidden border {darkMode ? 'border-white/10 bg-navy-lighter/50' : 'border-slate-200 bg-slate-50'}">
				{#each [['formatted', 'Formatted'], ['text', 'Text'], ['markdown', 'MD'], ['full', 'JSON']] as [val, label]}
					<button
						onclick={() => outputMode = val as any}
						class="px-3 py-1.5 text-xs font-medium transition-all {outputMode === val ? 'bg-cyan text-white' : darkMode ? 'text-slate-400 hover:text-white hover:bg-white/5' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'}"
					>{label}</button>
				{/each}
			</div>

			<!-- Actions -->
			<div class="flex items-center gap-1">
				<button onclick={copyToClipboard} class="p-2 rounded-lg text-sm transition-all {darkMode ? 'hover:bg-white/5 text-slate-400 hover:text-white' : 'hover:bg-slate-100 text-slate-500 hover:text-slate-900'}" title="Copy to clipboard">
					{#if copied}
						<svg class="w-4 h-4 text-cyan" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
					{:else}
						<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
					{/if}
				</button>
				<button onclick={() => download('txt')} class="p-2 rounded-lg text-sm transition-all {darkMode ? 'hover:bg-white/5 text-slate-400 hover:text-white' : 'hover:bg-slate-100 text-slate-500 hover:text-slate-900'}" title="Download as .txt">
					<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
				</button>
				<button onclick={() => download('md')} class="p-2 rounded-lg text-sm transition-all {darkMode ? 'hover:bg-white/5 text-slate-400 hover:text-white' : 'hover:bg-slate-100 text-slate-500 hover:text-slate-900'}" title="Download as .md">
					<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
				</button>

				<div class="w-px h-5 mx-1 {darkMode ? 'bg-white/10' : 'bg-slate-200'}"></div>

				<!-- New document -->
				<button onclick={resetDocument} class="p-2 rounded-lg text-sm transition-all {darkMode ? 'hover:bg-white/5 text-slate-400 hover:text-white' : 'hover:bg-slate-100 text-slate-500 hover:text-slate-900'}" title="New document">
					<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
				</button>
			</div>
		{:else}
			<div class="flex-1"></div>
		{/if}

		<!-- Theme toggle -->
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
			<!-- ── Empty State: Upload ───────────────────── -->
			<div class="h-full flex flex-col items-center justify-center px-6 relative">
				<!-- Background gradient orbs (prime-robotics style) -->
				{#if darkMode}
					<div class="absolute top-1/4 -left-32 w-96 h-96 rounded-full bg-cyan/5 blur-3xl pointer-events-none"></div>
					<div class="absolute bottom-1/4 -right-32 w-96 h-96 rounded-full bg-cyan/5 blur-3xl pointer-events-none"></div>
				{/if}

				<div class="relative w-full max-w-xl space-y-8 text-center">
					<!-- Upload zone -->
					<div class="relative group">
						<input
							type="file"
							accept=".jpg,.jpeg,.png,.webp,.pdf"
							class="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
							onchange={handleFileInput}
						/>
						<div class="rounded-2xl border-2 border-dashed p-12 sm:p-16 transition-all duration-300
							{darkMode ? 'border-white/15 group-hover:border-cyan/50 bg-white/[0.02]' : 'border-slate-300 group-hover:border-cyan/50 bg-white'}">
							<div class="space-y-5">
								<div class="w-20 h-20 mx-auto rounded-2xl {darkMode ? 'bg-cyan/10' : 'bg-cyan/5'} flex items-center justify-center transition-transform group-hover:scale-110 duration-300">
									<svg class="w-10 h-10 text-cyan" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/>
									</svg>
								</div>
								<div>
									<p class="text-xl font-semibold">Drop your document here</p>
									<p class="text-sm mt-2 {darkMode ? 'text-slate-400' : 'text-slate-500'}">or click to browse · JPG, PNG, WebP, PDF</p>
								</div>
							</div>
						</div>
					</div>

					<!-- Feature badges -->
					<div class="flex flex-wrap items-center justify-center gap-3">
						{#each [
							['🔍', 'Smart OCR'],
							['📊', 'Layout Detection'],
							['⚡', 'Instant Export']
						] as [icon, label]}
							<div class="flex items-center gap-2 px-4 py-2 rounded-full text-sm
								{darkMode ? 'bg-white/[0.04] border border-white/10 text-slate-300' : 'bg-slate-50 border border-slate-200 text-slate-600'}">
								<span>{icon}</span>
								<span class="font-medium">{label}</span>
							</div>
						{/each}
					</div>
				</div>
			</div>

		{:else if loading}
			<!-- ── Loading State ─────────────────────────── -->
			<div class="h-full flex flex-col items-center justify-center gap-4">
				<div class="relative">
					<div class="w-16 h-16 rounded-2xl bg-cyan/10 flex items-center justify-center">
						<div class="w-8 h-8 border-2 border-cyan border-t-transparent rounded-full animate-spin"></div>
					</div>
				</div>
				<div class="text-center">
					<p class="font-medium {darkMode ? 'text-white' : 'text-slate-900'}">Processing document…</p>
					{#if fileName}
						<p class="text-sm mt-1 {darkMode ? 'text-slate-400' : 'text-slate-500'}">{fileName}</p>
					{/if}
				</div>
			</div>

		{:else}
			<!-- ── Document View: Split Pane ─────────────── -->
			{#if error}
				<div class="mx-4 mt-4 rounded-xl p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-center gap-2">
					<svg class="w-4 h-4 flex-none" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
					{error}
				</div>
			{/if}

			<!-- Mobile output mode tabs -->
			<div class="sm:hidden flex items-center gap-1 px-3 py-2 border-b {darkMode ? 'border-white/10 bg-navy-light/50' : 'border-slate-200 bg-slate-50'}">
				{#each [['formatted', 'Formatted'], ['text', 'Text'], ['markdown', 'MD'], ['full', 'JSON']] as [val, label]}
					<button
						onclick={() => outputMode = val as any}
						class="flex-1 px-2 py-1.5 rounded-md text-xs font-medium transition-all {outputMode === val ? 'bg-cyan text-white' : darkMode ? 'text-slate-400' : 'text-slate-500'}"
					>{label}</button>
				{/each}
			</div>

			<div class="flex h-full min-h-0 panel-enter {error ? 'pt-0' : ''}">
				<!-- ── Left: Preview ──────────────────────── -->
				{#if previewUrl}
					<div
						class="hidden md:flex flex-col min-w-0 overflow-hidden"
						style="width: {splitRatio}%"
					>
						<div
							bind:this={imageContainerEl}
							class="flex-1 overflow-auto p-4 relative flex items-start justify-center {darkMode ? 'bg-navy/50' : 'bg-slate-50'}"
						>
							<img
								bind:this={imageEl}
								src={previewUrl}
								alt="Document preview"
								class="max-w-full max-h-full object-contain rounded-lg shadow-xl {darkMode ? 'shadow-black/30' : 'shadow-slate-300/50'}"
							/>
							{#if hoveredIndex !== null && highlightStyle}
								<div
									class="absolute pointer-events-none rounded-sm border-2 border-cyan bg-cyan/20 transition-all duration-150"
									style={highlightStyle}
								></div>
							{/if}
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
				<div
					class="flex-1 min-w-0 flex flex-col overflow-hidden"
					style={previewUrl ? `width: ${100 - splitRatio}%` : ''}
				>
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
	<footer class="flex-none h-7 border-t {darkMode ? 'border-white/5 bg-navy-light/50' : 'border-slate-200 bg-white/50'} backdrop-blur-sm flex items-center px-4 text-[11px] {darkMode ? 'text-slate-500' : 'text-slate-400'} gap-4">
		<span>Prime OCR</span>
		<span class="{darkMode ? 'text-white/10' : 'text-slate-200'}">·</span>
		<span>Powered by GLM-OCR</span>
		{#if hasDocument && layoutItems.length > 0}
			<span class="{darkMode ? 'text-white/10' : 'text-slate-200'}">·</span>
			<span>{layoutItems.length} layout elements detected</span>
		{/if}
		<div class="flex-1"></div>
		{#if hasDocument}
			<span class="text-cyan/60">Hover text to highlight on preview</span>
		{/if}
	</footer>
</div>
