
// This script uses dynamic import to load node-fetch if global fetch is not available, 
// or relies on global fetch (Node 18+).

const token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY5NzhmMzUxMDAwMjg0NzRmYWVlNmVkMyIsImlhdCI6MTc3MDQ4MTA4NSwiZXhwIjoxNzczMDczMDg1fQ.HP5jt5Har6_K6TAKGvnP8KhnfkXVeDAALYJMFxgFWm8";

async function testEndpoint(url) {
    console.log(`\nTesting ${url}...`);
    try {
        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        console.log(`Status: ${response.status}`);
        if (!response.ok) {
            const text = await response.text();
            console.log('Error text:', text);
            try {
                const json = JSON.parse(text);
                console.log('Error Message:', json.message);
                console.log('Error Stack:', json.stack);
            } catch (e) { }
        } else {
            console.log('Success.');
        }
    } catch (e) {
        console.error('Fetch error:', e);
    }
}

(async () => {
    // Wait for server to be ready - assume it is
    await testEndpoint('http://localhost:5000/api/projects');
    await testEndpoint('http://localhost:5000/api/audit/notifications');
    await testEndpoint('http://localhost:5000/api/finance/transactions?limit=100');
})();
