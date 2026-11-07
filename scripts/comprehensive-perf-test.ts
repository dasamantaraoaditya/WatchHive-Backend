import autocannon from 'autocannon';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { generateAccessToken } from '../src/utils/jwt.util.js';

const TARGET_URL = process.env.TARGET_URL || 'https://watchhive-api-production.up.railway.app';
const TEST_USER = {
    userId: '9c6c76d9-01b7-49d3-a1c7-8a2ef6145b02',
    email: 'tester@gmail.com',
    isEmailVerified: true,
    tokenVersion: 1,
};

interface Scenario {
    category: string;
    feature: string;
    path: string;
    method: 'GET' | 'POST';
    authenticated: boolean;
    body?: any;
    connections?: number;
    duration?: number;
}

interface BenchmarkRecord {
    category: string;
    feature: string;
    endpoint: string;
    method: string;
    reqPerSecAvg: number;
    latencyAvgMs: number;
    latencyP50Ms: number;
    latencyP90Ms: number;
    latencyP99Ms: number;
    totalRequests: number;
    status2xx: number;
    errors: number;
    timeouts: number;
    successRate: string;
}

async function main() {
    console.log('================================================================');
    console.log('🐝 WATCHERSHIVE ECOSYSTEM — COMPREHENSIVE PERFORMANCE SUITE');
    console.log(`🎯 Target API: ${TARGET_URL}`);
    console.log(`⏱️  Timestamp: ${new Date().toISOString()}`);
    console.log('================================================================\n');

    // 1. Generate test token
    const token = generateAccessToken(TEST_USER);
    console.log(`🔑 Test token generated for ${TEST_USER.email} (userId: ${TEST_USER.userId})`);

    // Verify token with production
    try {
        const verifyRes = await axios.get(`${TARGET_URL}/api/v1/users/me`, {
            headers: { Authorization: `Bearer ${token}` },
            timeout: 8000,
        });
        console.log(`✅ Production token verified successfully! Signed in as: @${verifyRes.data.username}\n`);
    } catch (err: any) {
        console.error('❌ Failed to verify auth token with production:', err.message);
        process.exit(1);
    }

    const scenarios: Scenario[] = [
        // ─── 1. Core Health & System ──────────────────────────────
        {
            category: '1. Core Infrastructure',
            feature: 'Health Probe',
            path: '/health',
            method: 'GET',
            authenticated: false,
        },
        {
            category: '1. Core Infrastructure',
            feature: 'App Version Check',
            path: '/api/v1/app/version?platform=ios',
            method: 'GET',
            authenticated: false,
        },

        // ─── 2. TMDb Media Catalog (SWR & Edge Caching) ───────────
        {
            category: '2. TMDb Media Catalog',
            feature: 'Movie Details (Fight Club)',
            path: '/api/v1/tmdb/movie/550',
            method: 'GET',
            authenticated: false,
        },
        {
            category: '2. TMDb Media Catalog',
            feature: 'TV Show Details (GoT)',
            path: '/api/v1/tmdb/tv/1399',
            method: 'GET',
            authenticated: false,
        },
        {
            category: '2. TMDb Media Catalog',
            feature: 'TV Season 1 Details',
            path: '/api/v1/tmdb/tv/1399/season/1',
            method: 'GET',
            authenticated: false,
        },
        {
            category: '2. TMDb Media Catalog',
            feature: 'Movie Recommendations',
            path: '/api/v1/tmdb/movie/550/recommendations',
            method: 'GET',
            authenticated: false,
        },
        {
            category: '2. TMDb Media Catalog',
            feature: 'TV Recommendations',
            path: '/api/v1/tmdb/tv/1399/recommendations',
            method: 'GET',
            authenticated: false,
        },
        {
            category: '2. TMDb Media Catalog',
            feature: 'Multi-Search (Inception)',
            path: '/api/v1/tmdb/search/multi?query=Inception&page=1',
            method: 'GET',
            authenticated: false,
        },
        {
            category: '2. TMDb Media Catalog',
            feature: 'Popular Movies',
            path: '/api/v1/tmdb/popular',
            method: 'GET',
            authenticated: false,
        },
        {
            category: '2. TMDb Media Catalog',
            feature: 'Trending All Media',
            path: '/api/v1/tmdb/trending',
            method: 'GET',
            authenticated: false,
        },

        // ─── 3. Episode & Season Tracking ────────────────────────
        {
            category: '3. TV Episode Tracking',
            feature: 'Show Progress Calculation',
            path: '/api/v1/shows/1399/progress',
            method: 'GET',
            authenticated: true,
        },
        {
            category: '3. TV Episode Tracking',
            feature: 'Friends Progress Sync',
            path: '/api/v1/shows/1399/friends-progress',
            method: 'GET',
            authenticated: true,
        },

        // ─── 4. Community Activity Feed & Social ──────────────────
        {
            category: '4. Social Activity Feed',
            feature: 'Swarm Activity Feed (Page 1)',
            path: '/api/v1/feed?page=1',
            method: 'GET',
            authenticated: true,
        },
        {
            category: '4. Social Activity Feed',
            feature: 'Trending Activity Feed',
            path: '/api/v1/feed/trending',
            method: 'GET',
            authenticated: true,
        },
        {
            category: '4. Social Activity Feed',
            feature: 'Who to Follow (Suggested Users)',
            path: '/api/v1/users/suggested',
            method: 'GET',
            authenticated: true,
        },

        // ─── 5. SmartSuggest AI Engine ───────────────────────────
        {
            category: '5. AI Recommendations',
            feature: 'SmartSuggest Engine',
            path: '/api/v1/suggestions/smart-suggest',
            method: 'GET',
            authenticated: true,
        },

        // ─── 6. MindLens 2.0 Behavioral Telemetry ────────────────
        {
            category: '6. Behavioral Telemetry',
            feature: 'MindLens Insights (Entropy/Affect)',
            path: '/api/v1/mindlens/insights',
            method: 'GET',
            authenticated: true,
        },

        // ─── 7. Watch Tracking & Entries Engine ───────────────────
        {
            category: '7. Watch Tracking Catalog',
            feature: 'User Watch Entries',
            path: '/api/v1/entries',
            method: 'GET',
            authenticated: true,
        },
        {
            category: '7. Watch Tracking Catalog',
            feature: 'Catalog Stats Summary',
            path: '/api/v1/entries/stats/summary',
            method: 'GET',
            authenticated: true,
        },
        {
            category: '7. Watch Tracking Catalog',
            feature: 'Detailed Viewing Analytics',
            path: '/api/v1/stats/detailed',
            method: 'GET',
            authenticated: true,
        },

        // ─── 8. Curated Lists & Stacks ────────────────────────────
        {
            category: '8. Cinephile Stacks',
            feature: 'User Lists & Stacks',
            path: '/api/v1/lists',
            method: 'GET',
            authenticated: true,
        },

        // ─── 9. Direct Suggestions Loop ───────────────────────────
        {
            category: '9. Peer Suggestions Loop',
            feature: 'Received Suggestions',
            path: '/api/v1/suggestions',
            method: 'GET',
            authenticated: true,
        },
        {
            category: '9. Peer Suggestions Loop',
            feature: 'Sent Suggestions',
            path: '/api/v1/suggestions/sent',
            method: 'GET',
            authenticated: true,
        },

        // ─── 10. User Profile & Social Graph ──────────────────────
        {
            category: '10. User Profile',
            feature: 'Full Profile (/me with cache)',
            path: '/api/v1/users/me',
            method: 'GET',
            authenticated: true,
        },
    ];

    const results: BenchmarkRecord[] = [];

    for (let i = 0; i < scenarios.length; i++) {
        const s = scenarios[i];
        const headers: Record<string, string> = {};
        if (s.authenticated) {
            headers.authorization = `Bearer ${token}`;
        }

        console.log(`[${i + 1}/${scenarios.length}] Testing: ${s.feature} (${s.path})...`);

        // Warm up connection/cache with 1 request first
        try {
            await axios({
                method: s.method,
                url: `${TARGET_URL}${s.path}`,
                headers,
                timeout: 10000,
            });
        } catch (_) {}

        // Execute load benchmark (5 seconds, 8 concurrent connections to be representative yet polite)
        const instance = autocannon({
            url: `${TARGET_URL}${s.path}`,
            method: s.method,
            headers,
            connections: s.connections || 8,
            duration: s.duration || 5,
        });

        const res = await instance;

        const successRate = res.requests.total > 0
            ? ((res['2xx'] / res.requests.total) * 100).toFixed(1) + '%'
            : '0%';

        const record: BenchmarkRecord = {
            category: s.category,
            feature: s.feature,
            endpoint: s.path,
            method: s.method,
            reqPerSecAvg: Math.round(res.requests.average),
            latencyAvgMs: Math.round(res.latency.average),
            latencyP50Ms: Math.round(res.latency.p50),
            latencyP90Ms: Math.round(res.latency.p90),
            latencyP99Ms: Math.round(res.latency.p99),
            totalRequests: res.requests.total,
            status2xx: res['2xx'],
            errors: res.errors,
            timeouts: res.timeouts,
            successRate,
        };

        results.push(record);
        console.log(`     ⚡ Avg: ${record.latencyAvgMs}ms | p50: ${record.latencyP50Ms}ms | p99: ${record.latencyP99Ms}ms | ${record.reqPerSecAvg} req/s | Success: ${record.successRate}`);
    }

    console.log('\n================================================================');
    console.log('📊 FINAL COMPREHENSIVE BENCHMARK REPORT');
    console.log('================================================================\n');

    console.log('| Category | Feature | Endpoint | Avg Latency | p50 | p90 | p99 | Throughput | Success Rate |');
    console.log('| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |');
    for (const r of results) {
        console.log(`| ${r.category} | ${r.feature} | \`${r.endpoint.split('?')[0]}\` | **${r.latencyAvgMs} ms** | ${r.latencyP50Ms} ms | ${r.latencyP90Ms} ms | ${r.latencyP99Ms} ms | ${r.reqPerSecAvg} req/s | ${r.successRate} |`);
    }

    // Save JSON results to disk for documentation update
    const outputPath = path.resolve('benchmark-results.json');
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
    console.log(`\n💾 Saved detailed benchmark metrics to: ${outputPath}\n`);
}

main().catch(console.error);
