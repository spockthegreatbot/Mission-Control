const VPS_URL = process.env.VPS_URL || 'http://45.76.125.57';

module.exports = async (req, res) => {
    const action = req.query.action || 'login';
    const url = `${VPS_URL}/auth/${action}`;

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const fetch = (await import('node-fetch')).default;
        const options = {
            method: req.method,
            headers: { 'Content-Type': 'application/json' },
            timeout: 10000
        };
        if (req.headers.authorization) {
            options.headers['Authorization'] = req.headers.authorization;
        }
        if (req.method === 'POST' && req.body) {
            options.body = JSON.stringify(req.body);
        }
        const response = await fetch(url, options);
        const data = await response.json();
        res.status(response.status).json(data);
    } catch (err) {
        res.status(502).json({ error: 'VPS unreachable', detail: err.message });
    }
};
