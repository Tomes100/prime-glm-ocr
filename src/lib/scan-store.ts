// In-memory scan stats for admin dashboard.
// Resets on deploy/restart — fine for MVP.

interface ScanRecord {
	timestamp: number;
	ipHash: string;
	fileName: string;
}

let totalScans = 0;
let scanHistory: ScanRecord[] = [];
let debugLogs: any[] = [];
const startTime = Date.now();

function hashIP(ip: string): string {
	// Simple hash for privacy — don't store raw IPs
	let hash = 0;
	for (let i = 0; i < ip.length; i++) {
		const char = ip.charCodeAt(i);
		hash = ((hash << 5) - hash) + char;
		hash |= 0;
	}
	return Math.abs(hash).toString(36);
}

export function recordScan(ip: string, fileName: string) {
	totalScans++;
	scanHistory.push({
		timestamp: Date.now(),
		ipHash: hashIP(ip),
		fileName: fileName || 'unknown'
	});
	// Keep last 500 entries
	if (scanHistory.length > 500) scanHistory = scanHistory.slice(-500);
}

export function addDebugLog(log: any) {
	debugLogs.push({ ...log, serverTimestamp: Date.now() });
	if (debugLogs.length > 20) debugLogs = debugLogs.slice(-20);
}

export function getDebugLogs() {
	return debugLogs.slice().reverse();
}

export function getStats() {
	const now = Date.now();
	const oneDayAgo = now - 86400000;
	const oneHourAgo = now - 3600000;

	const todayScans = scanHistory.filter(s => s.timestamp > oneDayAgo).length;
	const hourScans = scanHistory.filter(s => s.timestamp > oneHourAgo).length;
	const uniqueVisitors = new Set(scanHistory.map(s => s.ipHash)).size;

	return {
		totalScans,
		todayScans,
		hourScans,
		uniqueVisitors,
		recentScans: scanHistory.slice(-30).reverse(),
		upSince: startTime,
		uptimeMs: now - startTime
	};
}
