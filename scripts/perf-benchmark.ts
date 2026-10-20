import autocannon from 'autocannon';
import axios from 'axios';

const BASE_URL = process.env.TARGET_URL || 'https://watchhive-api-staging.up.railway.app';

interface BenchmarkResult {
    name: string;
    endpoint: string;
    method: string;
    reqPerSecAvg: number;
    latencyAvgMs: number;
    latencyP99Ms: number;
    totalRequests: number;
    errors: number;
    timeouts: number;
    status2xx: number;
}

async function runBenchmark() {
    console.log(`\n======================================================`);
    console.log(`🚀 WatchersHive Staging Performance Benchmark Suite`);
    console.log(`🎯 Target API: ${BASE_URL}`);
    console.log(`======================================================\n`);

    // 1. Obtain JWT token for authenticated tests
    console.log('🔑 Authenticating test account (aditya.test@watchershive.com)...');
    let token = '';
    try {
        const loginRes = await axios.post(`${BASE_URL}/api/v1/auth/login`, {
            email: 'aditya.test@watchershive.com',
            password: 'TestPass123!',
        });
        token = loginRes.data.accessToken;
        console.log('✅ Authentication successful! Token acquired.\n');
    } catch (err: any) {
        console.error('❌ Failed to authenticate:', err.message);
        process.exit(1);
    }

    const results: BenchmarkResult[] = [];

    const scenarios = [
        {
            name: '1. Baseline Health Check',
            path: '/health',
            method: 'GET',
            headers: {},
            connections: 10,
            duration: 10,
        },
        {
            name: '2. User Profile (Auth + DB Single Row)',
            path: '/api/v1/users/me',
            method: 'GET',
            headers: { authorization: `Bearer ${token}` },
            connections: 10,
            duration: 10,
        },
        {
            name: '3. Watch Entries (Auth + Paginated Query)',
            path: '/api/v1/entries',
            method: 'GET',
            headers: { authorization: `Bearer ${token}` },
            connections: 10,
            duration: 10,
        },
        {
            name: '4. Activity Feed Trending (Multi-table Aggregation)',
            path: '/api/v1/feed/trending',
            method: 'GET',
            headers: { authorization: `Bearer ${token}` },
            connections: 10,
            duration: 10,
        },
        {
            name: '5. Login Throughput (CPU / bcrypt)',
            path: '/api/v1/auth/login',
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                email: 'aditya.test@watchershive.com',
                password: 'TestPass123!',
            }),
            connections: 5,
            duration: 10,
        },
    ];

    for (const scenario of scenarios) {
        console.log(`⏳ Running Scenario: ${scenario.name}...`);
        const instance = autocannon({
            url: `${BASE_URL}${scenario.path}`,
            method: scenario.method as any,
            headers: scenario.headers,
            body: scenario.body,
            connections: scenario.connections,
            duration: scenario.duration,
        });

        const res = await instance;

        results.push({
            name: scenario.name,
            endpoint: scenario.path,
            method: scenario.method,
            reqPerSecAvg: Math.round(res.requests.average),
            latencyAvgMs: Math.round(res.latency.average),
            latencyP99Ms: Math.round(res.latency.p99),
            totalRequests: res.requests.total,
            errors: res.errors,
            timeouts: res.timeouts,
            status2xx: res['2xx'],
        });
        console.log(`   👉 Avg RPS: ${Math.round(res.requests.average)} req/s | Avg Latency: ${Math.round(res.latency.average)}ms | 2xx: ${res['2xx']}/${res.requests.total}`);
    }

    console.log(`\n======================================================`);
    console.log(`📊 PERFORMANCE BENCHMARK SUMMARY REPORT`);
    console.log(`======================================================\n`);

    console.log('| Scenario | Method & Path | Avg RPS | Avg Latency | p99 Latency | Total Reqs | Success Rate |');
    console.log('| :--- | :--- | :--- | :--- | :--- | :--- | :--- |');
    for (const r of results) {
        const successRate = r.totalRequests > 0 ? ((r.status2xx / r.totalRequests) * 100).toFixed(1) + '%' : '0%';
        console.log(`| ${r.name} | \`${r.method} ${r.endpoint}\` | **${r.reqPerSecAvg} req/s** | ${r.latencyAvgMs}ms | ${r.latencyP99Ms}ms | ${r.totalRequests} | ${successRate} |`);
    }
    console.log(`\n======================================================\n`);
}

runBenchmark().catch(console.error);
