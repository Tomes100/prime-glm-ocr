<script lang="ts">
	let darkMode = $state(true);
	let files: FileList | null = $state(null);
	let dragging = $state(false);
	let loading = $state(false);
	let result = $state('');
	let rawResponse: any = $state(null);
	let outputMode: 'text' | 'markdown' | 'full' = $state('text');
	let error = $state('');
	let copied = $state(false);
	let previewUrl = $state('');

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
		rawResponse = null;

		const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
		if (!validTypes.includes(file.type)) {
			error = 'Unsupported file type. Please upload JPG, PNG, WebP, or PDF.';
			return;
		}

		if (file.type.startsWith('image/')) {
			previewUrl = URL.createObjectURL(file);
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
				error = data.error || 'OCR failed';
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
		if (outputMode === 'full') {
			result = JSON.stringify(rawResponse, null, 2);
		} else if (outputMode === 'markdown') {
			result = rawResponse.md_results || rawResponse.data?.md_results || extractText(rawResponse);
		} else {
			const md = rawResponse.md_results || rawResponse.data?.md_results || extractText(rawResponse);
			result = md.replace(/[#*_`~>\[\]()!|]/g, '').replace(/\n{3,}/g, '\n\n').trim();
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
		await navigator.clipboard.writeText(result);
		copied = true;
		setTimeout(() => copied = false, 2000);
	}

	function download(ext: 'txt' | 'md') {
		const blob = new Blob([result], { type: 'text/plain' });
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

		{#if result}
			<!-- Controls -->
			<div class="flex flex-wrap items-center gap-3">
				<div class="flex rounded-xl overflow-hidden border {darkMode ? 'border-slate-700 bg-dark-card' : 'border-slate-200 bg-white'}">
					{#each [['text', 'Text'], ['markdown', 'Markdown'], ['full', 'Full JSON']] as [val, label]}
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

			<!-- Result -->
			<div class="grid gap-6 {previewUrl ? 'lg:grid-cols-2' : ''}">
				{#if previewUrl}
					<div class="rounded-2xl overflow-hidden shadow-md {darkMode ? 'bg-dark-card' : 'bg-white'} p-2">
						<img src={previewUrl} alt="Preview" class="w-full rounded-xl object-contain max-h-[500px]" />
					</div>
				{/if}
				<div class="rounded-2xl shadow-md transition-shadow hover:shadow-xl {darkMode ? 'bg-dark-card border border-slate-700/50' : 'bg-white border border-slate-200'}">
					<pre class="p-6 text-sm leading-relaxed overflow-auto max-h-[600px] whitespace-pre-wrap break-words {darkMode ? 'text-slate-200' : 'text-slate-800'}">{result}</pre>
				</div>
			</div>
		{/if}

		{#if !result && !loading && !error}
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
