<script lang="ts">
	import { marked } from 'marked';

	let darkMode = $state(true);
	let dragging = $state(false);
	let loading = $state(false);
	let result = $state('');
	let htmlResult = $state('');
	let rawResponse: any = $state(null);
	let outputMode: 'formatted' | 'layout' | 'text' | 'markdown' | 'full' = $state('formatted');
	let error = $state('');
	let copied = $state(false);
	let previewUrl = $state('');
	let hoveredIndex: number | null = $state(null);
	let imageEl: HTMLImageElement | null = $state(null);
	let imageContainerEl: HTMLDivElement | null = $state(null);

	interface LayoutItem {
		index: number;
		label: string;
		content?: string;
		bbox_2d: number[]; // [x1%, y1%, x2%, y2%] as percentage of width/height
		width: number;
		height: number;
	}

	let layoutItems: LayoutItem[] = $derived(
		rawResponse?.layout_details?.[0]?.filter((item: LayoutItem) => item.content) || []
	);

	// Compute highlight box position relative to displayed image
	let highlightStyle = $derived.by(() => {
		if (hoveredIndex === null || !imageEl || !imageContainerEl) return '';
		const item = layoutItems.find((l: LayoutItem) => l.index === hoveredIndex);
		if (!item) return '';

		const imgRect = imageEl.getBoundingClientRect();
		const containerRect = imageContainerEl.getBoundingClientRect();

		// bbox_2d values are in pixels of original image, item.width/height are original dimensions
		const origW = item.width;
		const origH = item.height;
		const [x1, y1, x2, y2] = item.bbox_2d;

		// Scale to displayed image size
		const scaleX = imgRect.width / origW;
		const scaleY = imgRect.height / origH;

		// Offset of image within container
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

	function handleDrop(e: DragEvent) {
		e.preventDefault();
		dragging = false;
		if (e.dataTransfer?.files?.length) {
			processFile(e.dataTransfer.files[0]);
		}
	}

	function handleFileInput(e: Event) {
		const input = e.target as HTMLInputElement;
		if (input.files?.length) {
			processFile(input.files[0]);
		}
	}

	async function processFile(file: File) {
		error = '';
		result = '';
		htmlResult = '';
		rawResponse = null;
		hoveredIndex = null;

		const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
		if (!validTypes.includes(file.type)) {
			error = 'Unsupported file type. Please upload JPG, PNG, WebP, or PDF.';
			return;
		}

		if (file.type.startsWith('image/')) {
			previewUrl = URL.createObjectURL(file);
		} else if (file.type === 'application/pdf') {
			previewUrl = '';
			// Render first page of PDF to image using pdf.js from CDN
			try {
				const cdnBase = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174';

				// Load pdf.js from CDN if not already loaded
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

	function updateResult() {
		if (!rawResponse) return;
		const md = rawResponse.md_results || rawResponse.data?.md_results || extractText(rawResponse);
		if (outputMode === 'full') {
			result = JSON.stringify(rawResponse, null, 2);
			htmlResult = '';
		} else if (outputMode === 'formatted') {
			result = '';
			htmlResult = marked.parse(md, { async: false }) as string;
		} else if (outputMode === 'layout') {
			// Layout mode uses layout_details for interactive bbox hover
			result = '';
			htmlResult = '';
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
</script>

<div class="min-h-screen transition-colors duration-300 {darkMode ? 'bg-dark text-slate-100' : 'bg-light-surface text-slate-900'}">
	<!-- Header -->
	<header class="border-b {darkMode ? 'border-slate-700/50 bg-dark/80' : 'border-slate-200 bg-white/80'} backdrop-blur-xl sticky top-0 z-50">
		<div class="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
			<div class="flex items-center gap-3">
				<div class="w-10 h-10 rounded-xl bg-brand flex items-center justify-center text-white font-bold text-lg shadow-lg shadow-brand/30">P</div>
				<div>
					<h1 class="text-lg font-bold tracking-tight">Prime OCR</h1>
					<p class="text-xs {darkMode ? 'text-slate-400' : 'text-slate-500'}">Business Document Scanner</p>
				</div>
			</div>
			<button onclick={toggleDark} class="p-2.5 rounded-xl transition-all {darkMode ? 'bg-slate-800 hover:bg-slate-700 text-yellow-400' : 'bg-slate-100 hover:bg-slate-200 text-slate-600'}">
				{darkMode ? '☀️' : '🌙'}
			</button>
		</div>
	</header>

	<main class="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-8">
		<!-- Upload Area -->
		<div
			class="relative rounded-2xl border-2 border-dashed p-8 sm:p-12 text-center transition-all duration-300 cursor-pointer
				{dragging ? 'border-brand bg-brand/10 scale-[1.01]' : darkMode ? 'border-slate-600 hover:border-brand/60 bg-dark-card/50' : 'border-slate-300 hover:border-brand/60 bg-white'}"
			ondragover={(e) => { e.preventDefault(); dragging = true; }}
			ondragleave={() => dragging = false}
			ondrop={handleDrop}
			role="button"
			tabindex="0"
		>
			<input type="file" accept=".jpg,.jpeg,.png,.webp,.pdf" class="absolute inset-0 w-full h-full opacity-0 cursor-pointer" onchange={handleFileInput} />
			<div class="space-y-4">
				<div class="w-16 h-16 mx-auto rounded-2xl {darkMode ? 'bg-slate-700/50' : 'bg-slate-100'} flex items-center justify-center text-3xl">
					📄
				</div>
				<div>
					<p class="text-lg font-semibold">Drop your document here</p>
					<p class="text-sm {darkMode ? 'text-slate-400' : 'text-slate-500'} mt-1">or click to browse · JPG, PNG, WebP, PDF</p>
				</div>
			</div>
		</div>

		{#if loading}
			<div class="flex items-center justify-center gap-3 py-12">
				<div class="w-6 h-6 border-2 border-brand border-t-transparent rounded-full animate-spin"></div>
				<span class="{darkMode ? 'text-slate-300' : 'text-slate-600'} font-medium">Processing document…</span>
			</div>
		{/if}

		{#if error}
			<div class="rounded-2xl p-4 bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{error}</div>
		{/if}

		{#if result || htmlResult || (outputMode === 'layout' && layoutItems.length > 0)}
			<!-- Controls -->
			<div class="flex flex-wrap items-center gap-3">
				<div class="flex rounded-xl overflow-hidden border {darkMode ? 'border-slate-700 bg-dark-card' : 'border-slate-200 bg-white'}">
					{#each [['formatted', 'Formatted'], ['layout', 'Layout'], ['text', 'Text'], ['markdown', 'Markdown'], ['full', 'Full JSON']] as [val, label]}
						<button
							onclick={() => outputMode = val as any}
							class="px-4 py-2 text-sm font-medium transition-all {outputMode === val ? 'bg-brand text-white' : darkMode ? 'text-slate-300 hover:bg-slate-700' : 'text-slate-600 hover:bg-slate-100'}"
						>{label}</button>
					{/each}
				</div>
				<div class="flex gap-2 ml-auto">
					<button onclick={copyToClipboard} class="px-4 py-2 rounded-xl text-sm font-medium transition-all {darkMode ? 'bg-slate-700 hover:bg-slate-600 text-slate-200' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'}">
						{copied ? '✓ Copied' : '📋 Copy'}
					</button>
					<button onclick={() => download('txt')} class="px-4 py-2 rounded-xl text-sm font-medium transition-all {darkMode ? 'bg-slate-700 hover:bg-slate-600 text-slate-200' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'}">
						💾 .txt
					</button>
					<button onclick={() => download('md')} class="px-4 py-2 rounded-xl text-sm font-medium transition-all {darkMode ? 'bg-slate-700 hover:bg-slate-600 text-slate-200' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'}">
						💾 .md
					</button>
				</div>
			</div>

			<!-- Result with Image Preview -->
			<div class="grid gap-6 lg:grid-cols-2">
				<!-- Image with highlight overlay -->
				{#if previewUrl}
					<div
						bind:this={imageContainerEl}
						class="relative rounded-2xl overflow-hidden shadow-md {darkMode ? 'bg-dark-card' : 'bg-white'} p-2"
					>
						<img
							bind:this={imageEl}
							src={previewUrl}
							alt="Preview"
							class="w-full rounded-xl object-contain max-h-[700px]"
						/>
						{#if hoveredIndex !== null && highlightStyle}
							<div
								class="absolute pointer-events-none rounded-sm border-2 border-brand bg-brand/20 transition-all duration-150"
								style={highlightStyle}
							></div>
						{/if}
					</div>
				{/if}

				<!-- Text output -->
				<div class="rounded-2xl shadow-md transition-shadow hover:shadow-xl {darkMode ? 'bg-dark-card border border-slate-700/50' : 'bg-white border border-slate-200'}">
					{#if outputMode === 'layout' && layoutItems.length > 0}
						<!-- Interactive layout items with hover highlighting -->
						<div class="p-6 text-sm leading-relaxed overflow-auto max-h-[700px] space-y-1">
							{#each layoutItems as item (item.index)}
								<div
									class="px-2 py-1 rounded cursor-default transition-colors duration-100
										{hoveredIndex === item.index
											? 'bg-brand/20 border-l-2 border-brand'
											: darkMode ? 'hover:bg-slate-700/50' : 'hover:bg-slate-100'}"
									onmouseenter={() => hoveredIndex = item.index}
									onmouseleave={() => hoveredIndex = null}
									role="listitem"
								>
									{#if item.label === 'paragraph_title'}
										<strong class="{darkMode ? 'text-slate-100' : 'text-slate-900'}">{item.content}</strong>
									{:else}
										<span class="{darkMode ? 'text-slate-300' : 'text-slate-700'}">{item.content}</span>
									{/if}
								</div>
							{/each}
						</div>
					{:else if outputMode === 'formatted' && htmlResult}
						<div class="p-6 text-sm leading-relaxed overflow-auto max-h-[700px] formatted-content {darkMode ? 'text-slate-200' : 'text-slate-800'}">{@html htmlResult}</div>
					{:else}
						<pre class="p-6 text-sm leading-relaxed overflow-auto max-h-[700px] whitespace-pre-wrap break-words {darkMode ? 'text-slate-200' : 'text-slate-800'}">{result}</pre>
					{/if}
				</div>

				<!-- If no preview, show text full width (already handled by grid) -->
			</div>
		{/if}

		{#if !result && !htmlResult && !rawResponse && !loading && !error}
			<!-- Features -->
			<div class="grid sm:grid-cols-3 gap-4 pt-4">
				{#each [
					['🔍', 'Smart OCR', 'Extract text from images and PDFs with high accuracy'],
					['📊', 'Layout Detection', 'Preserve document structure, tables, and formatting'],
					['⚡', 'Instant Results', 'Get results in seconds, download as TXT or Markdown']
				] as [icon, title, desc]}
					<div class="rounded-2xl p-6 transition-all duration-300 hover:shadow-xl {darkMode ? 'bg-dark-card/50 border border-slate-700/30 hover:border-brand/30' : 'bg-white border border-slate-200 hover:border-brand/30'}">
						<span class="text-2xl">{icon}</span>
						<h3 class="font-semibold mt-3">{title}</h3>
						<p class="text-sm mt-1 {darkMode ? 'text-slate-400' : 'text-slate-500'}">{desc}</p>
					</div>
				{/each}
			</div>
		{/if}
	</main>

	<footer class="text-center py-6 text-xs {darkMode ? 'text-slate-500' : 'text-slate-400'}">
		Prime OCR · Powered by GLM-OCR
	</footer>
</div>
