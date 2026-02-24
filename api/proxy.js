const https = require('http');

const VPS_URL = process.env.VPS_URL || 'http://45.76.125.57';

module.exports = async (req, res) => {
    const targetPath = req.query.path || '/mc/status';
    const url = `${VPS_URL}${targetPath}`;
    
    // Forward auth header
    const headers = { 'Content-Type': 'application/json' };
    if (req.headers.authorization) {
        headers['Authorization'] = req.headers.authorization;
    }

    try {
        const fetch = (await import('node-fetch')).default;
        const options = {
            method: req.method,
            headers,
            timeout: 10000
        };
        
        if (req.method === 'POST' && req.body) {
            options.body = JSON.stringify(req.body);
        }

        const response = await fetch(url, options);
        const data = await response.text();
        
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        
        if (req.method === 'OPTIONS') {
            return res.status(200).end();
        }
        
        res.status(response.status);
        try {
            res.json(JSON.parse(data));
        } catch {
            res.send(data);
        }
    } catch (err) {
        res.status(502).json({ error: 'VPS unreachable', detail: err.message });
    }
};
