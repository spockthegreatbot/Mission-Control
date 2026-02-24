const VPS_URL = process.env.VPS_URL || 'http://45.76.125.57';

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const action = req.query.action || 'login';
    const url = `${VPS_URL}/auth/${action}`;

    try {
        const headers = { 'Content-Type': 'application/json' };
        if (req.headers.authorization) headers['Authorization'] = req.headers.authorization;

        const options = { method: req.method, headers, signal: AbortSignal.timeout(10000) };
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
