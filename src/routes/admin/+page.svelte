<script lang="ts">
	let password = $state('');
	let authenticated = $state(false);
	let error = $state('');
	let stats: any = $state(null);
	let debugLogs: any[] = $state([]);
	let localDebug: any = $state(null);
	let loading = $state(false);
	let showDebug = $state(false);

	async function login() {
		error = '';
		loading = true;
		try {
			const res = await fetch(`/api/admin/stats?key=${encodeURIComponent(password)}`);
			if (!res.ok) {
				error = res.status === 401 ? 'Wrong password' : 'Server error';
				loading = false;
				return;
			}
			stats = await res.json();
			authenticated = true;
			localStorage.setItem('prime_ocr_admin', 'true');
			loadDebugData();
		} catch (err) {
			error = 'Failed to connect';
		} finally {
			loading = false;
		}
	}

	async function refreshStats() {
		try {
			const res = await fetch(`/api/admin/stats?key=${encodeURIComponent(password)}`);
			if (res.ok) stats = await res.json();
			loadDebugData();
		} catch {}
	}

	async function loadDebugData() {
		// Local debug from localStorage (same browser)
		try {
			const raw = localStorage.getItem('prime_ocr_debug');
			if (raw) localDebug = JSON.parse(raw);
		} catch {}
		// Server debug logs
		try {
			const res = await fetch(`/api/admin/debug?key=${encodeURIComponent(password)}`);
			if (res.ok) debugLogs = await res.json();
		} catch {}
	}

	function formatUptime(ms: number): string {
		const hours = Math.floor(ms / 3600000);
		const mins = Math.floor((ms % 3600000) / 60000);
		if (hours > 24) {
			const days = Math.floor(hours / 24);
			return `${days}d ${hours % 24}h`;
		}
		return `${hours}h ${mins}m`;
	}

	function formatTime(ts: number): string {
		return new Date(ts).toLocaleString();
	}
</script>

<svelte:head>
	<title>Admin — Prime OCR</title>
</svelte:head>

<div class="min-h-screen bg-[#0A1628] text-slate-100 font-sans">
	{#if !authenticated}
		<!-- Login -->
		<div class="flex items-center justify-center min-h-screen px-4">
			<div class="w-full max-w-sm space-y-6">
				<div class="text-center">
					<div class="w-12 h-12 mx-auto rounded-xl bg-gradient-to-br from-cyan-400 to-cyan-600 flex items-center justify-center text-white font-bold text-xl shadow-lg shadow-cyan-500/20 mb-4">P</div>
					<h1 class="text-xl font-bold">Prime OCR Admin</h1>
					<p class="text-sm text-slate-400 mt-1">Enter your admin password</p>
				</div>

				<form onsubmit={(e) => { e.preventDefault(); login(); }} class="space-y-4">
					<input
						type="password"
						bind:value={password}
						placeholder="Password"
						class="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/30 transition-all"
						autocomplete="current-password"
					/>
					{#if error}
						<p class="text-red-400 text-sm">{error}</p>
					{/if}
					<button
						type="submit"
						disabled={loading || !password}
						class="w-full py-3 rounded-xl bg-cyan-500 text-white font-semibold hover:bg-cyan-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
					>
						{loading ? 'Checking…' : 'Login'}
					</button>
				</form>

				<p class="text-center text-sm text-slate-500">
					<a href="/" class="hover:text-cyan-400 transition-colors">← Back to OCR</a>
				</p>
			</div>
		</div>
	{:else}
		<!-- Dashboard -->
		<header class="border-b border-white/10 bg-[#0F1D32]/80 backdrop-blur-xl">
			<div class="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
				<div class="flex items-center gap-3">
					<div class="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-400 to-cyan-600 flex items-center justify-center text-white font-bold text-sm">P</div>
					<h1 class="text-sm font-bold">Admin Dashboard</h1>
				</div>
				<div class="flex items-center gap-3">
					<button onclick={refreshStats} class="px-3 py-1.5 rounded-lg text-xs font-medium bg-white/5 hover:bg-white/10 border border-white/10 transition-all">
						↻ Refresh
					</button>
					<a href="/" class="px-3 py-1.5 rounded-lg text-xs font-medium bg-white/5 hover:bg-white/10 border border-white/10 transition-all">
						← OCR
					</a>
				</div>
			</div>
		</header>

		<main class="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-8">
			<!-- Stats Cards -->
			<div class="grid grid-cols-2 md:grid-cols-4 gap-4">
				<div class="rounded-xl bg-white/[0.03] border border-white/10 p-5">
					<p class="text-xs text-slate-400 font-medium uppercase tracking-wider">Total Scans</p>
					<p class="text-3xl font-bold mt-2 text-cyan-400">{stats?.totalScans ?? 0}</p>
				</div>
				<div class="rounded-xl bg-white/[0.03] border border-white/10 p-5">
					<p class="text-xs text-slate-400 font-medium uppercase tracking-wider">Today</p>
					<p class="text-3xl font-bold mt-2">{stats?.todayScans ?? 0}</p>
				</div>
				<div class="rounded-xl bg-white/[0.03] border border-white/10 p-5">
					<p class="text-xs text-slate-400 font-medium uppercase tracking-wider">Last Hour</p>
					<p class="text-3xl font-bold mt-2">{stats?.hourScans ?? 0}</p>
				</div>
				<div class="rounded-xl bg-white/[0.03] border border-white/10 p-5">
					<p class="text-xs text-slate-400 font-medium uppercase tracking-wider">Unique Visitors</p>
					<p class="text-3xl font-bold mt-2">{stats?.uniqueVisitors ?? 0}</p>
				</div>
			</div>

			<!-- Status -->
			<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
				<div class="rounded-xl bg-white/[0.03] border border-white/10 p-5 space-y-3">
					<h3 class="text-sm font-semibold text-slate-300">System Status</h3>
					<div class="space-y-2 text-sm">
						<div class="flex justify-between">
							<span class="text-slate-400">API Key</span>
							<span class="{stats?.apiKeySet ? 'text-emerald-400' : 'text-red-400'}">{stats?.apiKeySet ? '✓ Configured' : '✗ Missing'}</span>
						</div>
						<div class="flex justify-between">
							<span class="text-slate-400">Uptime</span>
							<span>{stats?.uptimeMs ? formatUptime(stats.uptimeMs) : '—'}</span>
						</div>
						<div class="flex justify-between">
							<span class="text-slate-400">Server Started</span>
							<span class="text-slate-300">{stats?.upSince ? formatTime(stats.upSince) : '—'}</span>
						</div>
					</div>
				</div>

				<div class="rounded-xl bg-white/[0.03] border border-white/10 p-5 space-y-3">
					<h3 class="text-sm font-semibold text-slate-300">Free Trial</h3>
					<div class="space-y-2 text-sm">
						<div class="flex justify-between">
							<span class="text-slate-400">Limit per browser</span>
							<span>5 scans</span>
						</div>
						<div class="flex justify-between">
							<span class="text-slate-400">Enforcement</span>
							<span class="text-slate-300">Client-side (localStorage)</span>
						</div>
						<div class="flex justify-between">
							<span class="text-slate-400">Auth system</span>
							<span class="text-yellow-400">Not yet — planned</span>
						</div>
					</div>
				</div>
			</div>

			<!-- Recent Scans -->
			{#if stats?.recentScans?.length > 0}
				<div class="rounded-xl bg-white/[0.03] border border-white/10 p-5 space-y-3">
					<h3 class="text-sm font-semibold text-slate-300">Recent Scans</h3>
					<div class="overflow-x-auto">
						<table class="w-full text-sm">
							<thead>
								<tr class="text-left text-slate-400 text-xs uppercase tracking-wider">
									<th class="pb-3 pr-4">Time</th>
									<th class="pb-3 pr-4">Visitor</th>
									<th class="pb-3">File</th>
								</tr>
							</thead>
							<tbody>
								{#each stats.recentScans as scan}
									<tr class="border-t border-white/5">
										<td class="py-2.5 pr-4 text-slate-300 whitespace-nowrap">{formatTime(scan.timestamp)}</td>
										<td class="py-2.5 pr-4 text-slate-400 font-mono text-xs">{scan.ipHash}</td>
										<td class="py-2.5 text-slate-300 truncate max-w-64">{scan.fileName}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				</div>
			{/if}

			<!-- Debug Log -->
			<div class="rounded-xl bg-white/[0.03] border border-white/10 p-5 space-y-3">
				<div class="flex items-center justify-between">
					<h3 class="text-sm font-semibold text-slate-300">🔍 Hover Debug Log</h3>
					<button onclick={() => { showDebug = !showDebug; if (showDebug) loadDebugData(); }} class="px-3 py-1.5 rounded-lg text-xs font-medium bg-white/5 hover:bg-white/10 border border-white/10 transition-all">
						{showDebug ? 'Hide' : 'Show'}
					</button>
				</div>

				{#if showDebug}
					<!-- Local debug (from this browser's localStorage) -->
					{#if localDebug}
						<div class="space-y-2">
							<div class="flex items-center gap-3 text-xs">
								<span class="text-slate-400">Last scan from this browser:</span>
								<span class="text-emerald-400 font-medium">{localDebug.matchedItems} matched</span>
								<span class="text-red-400 font-medium">{localDebug.unmatchedItems} unmatched</span>
								<span class="text-slate-500">of {localDebug.totalItems} total</span>
								<span class="text-slate-500">({formatTime(localDebug.timestamp)})</span>
							</div>

							<div class="overflow-x-auto max-h-96 overflow-y-auto">
								<table class="w-full text-xs">
									<thead class="sticky top-0 bg-[#0A1628]">
										<tr class="text-left text-slate-400 uppercase tracking-wider">
											<th class="pb-2 pr-3">Idx</th>
											<th class="pb-2 pr-3">Label</th>
											<th class="pb-2 pr-3">Status</th>
											<th class="pb-2 pr-3">Strategy</th>
											<th class="pb-2 pr-3">Len</th>
											<th class="pb-2">Content</th>
										</tr>
									</thead>
									<tbody>
										{#each localDebug.items as item}
											<tr class="border-t border-white/5 {item.matched ? '' : 'bg-red-500/5'}">
												<td class="py-2 pr-3 text-slate-400 font-mono">{item.index}</td>
												<td class="py-2 pr-3 text-slate-300">
													<span class="px-1.5 py-0.5 rounded text-[10px] bg-white/5 border border-white/10">{item.label}</span>
												</td>
												<td class="py-2 pr-3">
													{#if item.matched}
														<span class="text-emerald-400">✓</span>
													{:else}
														<span class="text-red-400">✗</span>
													{/if}
												</td>
												<td class="py-2 pr-3 text-slate-400 font-mono">{item.matchType}</td>
												<td class="py-2 pr-3 text-slate-400 font-mono">{item.contentLen}</td>
												<td class="py-2 text-slate-300 truncate max-w-sm font-mono" title={item.contentPreview}>{item.contentPreview}</td>
											</tr>
										{/each}
									</tbody>
								</table>
							</div>
						</div>
					{:else}
						<p class="text-xs text-slate-500">No local debug data. Run an OCR scan first.</p>
					{/if}

					<!-- Server debug logs -->
					{#if debugLogs.length > 0}
						<div class="mt-4 pt-4 border-t border-white/5 space-y-2">
							<h4 class="text-xs font-semibold text-slate-400">Server-side logs (last {debugLogs.length})</h4>
							{#each debugLogs as log, i}
								<details class="text-xs">
									<summary class="cursor-pointer text-slate-300 hover:text-white py-1">
										#{i + 1} — {formatTime(log.serverTimestamp || log.timestamp)}
										<span class="ml-2 text-emerald-400">{log.matchedItems}✓</span>
										<span class="ml-1 text-red-400">{log.unmatchedItems}✗</span>
										<span class="ml-1 text-slate-500">/ {log.totalItems}</span>
									</summary>
									<div class="ml-4 mt-1 overflow-x-auto max-h-48 overflow-y-auto">
										<table class="w-full text-[10px]">
											<thead>
												<tr class="text-slate-400">
													<th class="text-left pr-2">Idx</th>
													<th class="text-left pr-2">Label</th>
													<th class="text-left pr-2">Match</th>
													<th class="text-left pr-2">Strategy</th>
													<th class="text-left">Content</th>
												</tr>
											</thead>
											<tbody>
												{#each log.items || [] as item}
													<tr class="border-t border-white/5 {item.matched ? '' : 'bg-red-500/5'}">
														<td class="py-1 pr-2 font-mono text-slate-400">{item.index}</td>
														<td class="py-1 pr-2 text-slate-300">{item.label}</td>
														<td class="py-1 pr-2">{item.matched ? '✓' : '✗'}</td>
														<td class="py-1 pr-2 font-mono text-slate-400">{item.matchType}</td>
														<td class="py-1 text-slate-300 truncate max-w-xs" title={item.contentPreview}>{item.contentPreview}</td>
													</tr>
												{/each}
											</tbody>
										</table>
									</div>
								</details>
							{/each}
						</div>
					{/if}
				{/if}
			</div>
		</main>
	{/if}
</div>
