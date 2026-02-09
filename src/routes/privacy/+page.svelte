<svelte:head>
	<title>Privacy Policy — Prime OCR</title>
</svelte:head>

<div class="min-h-screen bg-[#0A1628] text-slate-100 font-sans">
	<header class="border-b border-white/10 bg-[#0F1D32]/80 backdrop-blur-xl">
		<div class="max-w-3xl mx-auto px-4 sm:px-6 py-4 flex items-center gap-3">
			<a href="/" class="flex items-center gap-2.5 hover:opacity-80 transition-opacity">
				<div class="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-400 to-cyan-600 flex items-center justify-center text-white font-bold text-sm shadow-lg shadow-cyan-500/20">P</div>
				<span class="text-sm font-bold tracking-tight">Prime OCR</span>
			</a>
		</div>
	</header>

	<main class="max-w-3xl mx-auto px-4 sm:px-6 py-12">
		<h1 class="text-3xl font-bold mb-2">Privacy Policy</h1>
		<p class="text-sm text-slate-400 mb-10">Last updated: February 2026</p>

		<div class="space-y-8 text-slate-300 leading-relaxed">
			<section>
				<h2 class="text-lg font-semibold text-white mb-3">1. Who We Are</h2>
				<p>Prime OCR is operated by <strong>Prime Robotics</strong> (prime-robotics.eu), a company registered in Romania. This service provides optical character recognition (OCR) for document scanning.</p>
			</section>

			<section>
				<h2 class="text-lg font-semibold text-white mb-3">2. What Data We Process</h2>
				<ul class="list-disc list-inside space-y-2 text-slate-300">
					<li><strong>Uploaded documents:</strong> Images and PDFs you upload are processed by our OCR engine for text extraction. <strong>We do not store your documents.</strong> They are processed in real-time and discarded immediately after the result is returned.</li>
					<li><strong>Scan count:</strong> We store a counter in your browser's local storage to track how many free scans you've used. This data never leaves your device.</li>
					<li><strong>GDPR consent:</strong> Your cookie consent preference is stored in your browser's local storage.</li>
					<li><strong>Basic analytics:</strong> We log anonymized scan events (hashed IP, timestamp, file name) in server memory for operational monitoring. This data is not persisted and is lost on server restart.</li>
				</ul>
			</section>

			<section>
				<h2 class="text-lg font-semibold text-white mb-3">3. Third-Party Services</h2>
				<p>Document processing is handled by our proprietary OCR pipeline. We recommend not uploading documents containing highly sensitive personal information unless necessary.</p>
			</section>

			<section>
				<h2 class="text-lg font-semibold text-white mb-3">4. Cookies & Local Storage</h2>
				<p>We use browser local storage (not traditional cookies) for:</p>
				<ul class="list-disc list-inside space-y-1 mt-2 text-slate-300">
					<li><strong>prime_ocr_scans</strong> — Your free scan counter (strictly necessary)</li>
					<li><strong>prime_ocr_gdpr</strong> — Your consent preference (strictly necessary)</li>
				</ul>
				<p class="mt-2">We do not use tracking cookies, advertising cookies, or any third-party analytics.</p>
			</section>

			<section>
				<h2 class="text-lg font-semibold text-white mb-3">5. Your Rights (GDPR)</h2>
				<p>Under the General Data Protection Regulation, you have the right to:</p>
				<ul class="list-disc list-inside space-y-1 mt-2 text-slate-300">
					<li>Access any personal data we hold about you</li>
					<li>Request deletion of your data</li>
					<li>Withdraw consent at any time</li>
					<li>Lodge a complaint with your local data protection authority</li>
				</ul>
				<p class="mt-2">Since we don't store personal data beyond browser local storage (which you control), you can exercise most of these rights by clearing your browser data.</p>
			</section>

			<section>
				<h2 class="text-lg font-semibold text-white mb-3">6. Data Retention</h2>
				<p>We do not retain uploaded documents. Browser local storage persists until you clear it. Server-side analytics are kept only in volatile memory.</p>
			</section>

			<section>
				<h2 class="text-lg font-semibold text-white mb-3">7. Contact</h2>
				<p>For privacy-related inquiries:</p>
				<p class="mt-2">
					<strong>Prime Robotics</strong><br/>
					Email: <a href="mailto:office@prime-robotics.eu" class="text-cyan-400 hover:underline">office@prime-robotics.eu</a><br/>
					Website: <a href="https://prime-robotics.eu" class="text-cyan-400 hover:underline">prime-robotics.eu</a>
				</p>
			</section>
		</div>
	</main>
</div>
