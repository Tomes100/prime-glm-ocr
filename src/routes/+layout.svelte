<script lang="ts">
	import '../app.css';
	import { browser } from '$app/environment';
	import { page } from '$app/stores';

	let { children } = $props();

	let showBanner = $state(false);

	// Check GDPR consent on mount
	$effect(() => {
		if (browser) {
			const consent = localStorage.getItem('prime_ocr_gdpr');
			if (!consent) showBanner = true;
		}
	});

	function acceptCookies() {
		localStorage.setItem('prime_ocr_gdpr', 'accepted');
		showBanner = false;
	}

	function declineCookies() {
		localStorage.setItem('prime_ocr_gdpr', 'declined');
		showBanner = false;
	}
</script>

{@render children()}

<!-- GDPR Cookie Banner -->
{#if showBanner}
	<div class="fixed bottom-0 left-0 right-0 z-[200] p-4 sm:p-0">
		<div class="sm:mx-4 sm:mb-4 max-w-2xl sm:ml-4 rounded-2xl bg-[#1A2942] border border-white/10 shadow-2xl shadow-black/40 backdrop-blur-xl p-5 sm:p-6">
			<div class="space-y-3">
				<div class="flex items-start gap-3">
					<span class="text-lg mt-0.5">🍪</span>
					<div class="space-y-1.5">
						<p class="text-sm font-medium text-white">We value your privacy</p>
						<p class="text-xs text-slate-400 leading-relaxed">
							We use browser local storage to track your free scan count and consent preference. We do not use tracking cookies or third-party analytics. Uploaded documents are processed in real-time and not stored.
							<a href="/privacy" class="text-cyan-400 hover:underline ml-1">Privacy Policy</a>
						</p>
					</div>
				</div>
				<div class="flex items-center gap-2 ml-8">
					<button
						onclick={acceptCookies}
						class="px-4 py-2 rounded-lg bg-cyan-500 text-white text-xs font-semibold hover:bg-cyan-400 transition-all"
					>
						Accept
					</button>
					<button
						onclick={declineCookies}
						class="px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-slate-300 text-xs font-medium hover:bg-white/10 transition-all"
					>
						Essential only
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}
