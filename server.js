#!/usr/bin/env node

const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const os = require('os');
const axios = require('axios');
const crypto = require('crypto');

const app = express();
const PORT = 8899;
const DATA_DIR = __dirname;
const MC_PASSWORD = process.env.MC_PASSWORD || 'changeme';
const SESSION_SECRET = crypto.randomBytes(32).toString('hex');
const sessions = new Map(); // token -> { user, expires }

// Environment variables for new features
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const MC_BACKUP_KEY = process.env.MC_BACKUP_KEY || crypto.randomBytes(32).toString('hex');

// OpenClaw gateway config
const OPENCLAW_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || 'e7b2f7acd7ad812952ba65e17137199a68e9ca6c6f467d80';

// Middleware
app.use(cors({ origin: true, credentials: true }));
app.use((req, res, next) => {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    next();
});
app.use(express.json({ limit: '50mb' }));

// Auth endpoints (before static/protected middleware)
app.post('/auth/login', async (req, res) => {
    const { username, password } = req.body;
    
    // Check if it's the default admin user
    if (username === 'tolga' && password === MC_PASSWORD) {
        const token = crypto.randomBytes(32).toString('hex');
        sessions.set(token, { user: username, expires: Date.now() + 24 * 60 * 60 * 1000 });
        res.json({ success: true, token, user: { username: 'tolga', role: 'admin' } });
        return;
    }
    
    // Check against stored users
    try {
        const users = await readJsonFile(path.join(DATA_DIR, 'mc-users.json'), []);
        const user = users.find(u => u.username === username);
        
        if (user && await verifyPassword(password, user.passwordHash)) {
            const token = crypto.randomBytes(32).toString('hex');
            sessions.set(token, { user: username, expires: Date.now() + 24 * 60 * 60 * 1000 });
            res.json({ success: true, token, user: { username: user.username, role: user.role } });
        } else {
            res.status(401).json({ success: false, error: 'Invalid credentials' });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: 'Authentication error' });
    }
});

app.post('/auth/logout', (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (token) sessions.delete(token);
    res.json({ success: true });
});

app.get('/auth/check', (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    const session = token && sessions.get(token);
    if (session && session.expires > Date.now()) {
        res.json({ authenticated: true, user: session.user });
    } else {
        res.json({ authenticated: false });
    }
});

// User registration endpoint (admin only)
app.post('/auth/register', async (req, res) => {
    try {
        const { username, password, role = 'user' } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password required' });
        }
        
        // Check if user is admin
        const token = req.headers.authorization?.replace('Bearer ', '');
        const session = token && sessions.get(token);
        if (!session || session.user !== 'tolga') {
            return res.status(403).json({ error: 'Admin access required' });
        }
        
        const users = await readJsonFile(path.join(DATA_DIR, 'mc-users.json'), []);
        
        // Check if user already exists
        if (users.find(u => u.username === username)) {
            return res.status(400).json({ error: 'Username already exists' });
        }
        
        // Hash password
        const passwordHash = await hashPassword(password);
        
        // Add user
        users.push({
            id: crypto.randomUUID(),
            username,
            passwordHash,
            role,
            createdAt: new Date().toISOString(),
            lastLogin: null
        });
        
        await writeJsonFile(path.join(DATA_DIR, 'mc-users.json'), users);
        
        res.json({ success: true, user: { username, role } });
    } catch (error) {
        res.status(500).json({ error: 'Registration failed' });
    }
});

// Login page served without auth
app.get('/login', (req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Mission Control — Login</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',sans-serif;background:#050508;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh}
.login-card{background:rgba(255,255,255,0.03);backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,0.06);border-radius:16px;padding:3rem;width:100%;max-width:400px;animation:fadeIn .5s ease}
@keyframes fadeIn{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
h1{font-size:1.5rem;font-weight:600;margin-bottom:.5rem;text-align:center}
p.sub{color:rgba(255,255,255,0.4);font-size:.85rem;text-align:center;margin-bottom:2rem}
label{display:block;font-size:.8rem;color:rgba(255,255,255,0.5);margin-bottom:.4rem;margin-top:1rem}
input{width:100%;padding:.75rem 1rem;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#fff;font-size:.9rem;font-family:inherit;outline:none;transition:border .2s}
input:focus{border-color:#6C63FF}
button{width:100%;padding:.75rem;background:#6C63FF;color:#fff;border:none;border-radius:8px;font-size:.95rem;font-weight:600;font-family:inherit;cursor:pointer;margin-top:1.5rem;transition:opacity .2s}
button:hover{opacity:.9}
button:disabled{opacity:.5;cursor:not-allowed}
.error{color:#ff4757;font-size:.8rem;text-align:center;margin-top:1rem;display:none}
.logo{text-align:center;margin-bottom:1.5rem;font-size:2rem}
</style></head><body>
<div class="login-card">
<div class="logo">🚀</div>
<h1>Mission Control</h1>
<p class="sub">Enter credentials to continue</p>
<form id="loginForm">
<label>Username</label>
<input type="text" id="username" autocomplete="username" required autofocus>
<label>Password</label>
<input type="password" id="password" autocomplete="current-password" required>
<button type="submit" id="btn">Sign In</button>
<div class="error" id="error">Invalid username or password</div>
</form>
</div>
<script>
document.getElementById('loginForm').addEventListener('submit',async e=>{
e.preventDefault();
const btn=document.getElementById('btn');btn.disabled=true;btn.textContent='Signing in...';
document.getElementById('error').style.display='none';
try{
const r=await fetch('/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:document.getElementById('username').value,password:document.getElementById('password').value})});
const d=await r.json();
if(d.success){localStorage.setItem('mc_token',d.token);window.location.href='/';}
else{document.getElementById('error').style.display='block';btn.disabled=false;btn.textContent='Sign In';}
}catch(err){document.getElementById('error').textContent='Connection error';document.getElementById('error').style.display='block';btn.disabled=false;btn.textContent='Sign In';}
});
</script></body></html>`);
});

// Protect all routes except /login and /auth/*
app.use((req, res, next) => {
    if (req.path === '/login' || req.path.startsWith('/auth/') || req.path === '/mc/webhook') return next();
    const token = req.headers.authorization?.replace('Bearer ', '') || req.query.token;
    const session = token && sessions.get(token);
    if (session && session.expires > Date.now()) {
        session.expires = Date.now() + 24 * 60 * 60 * 1000; // refresh
        req.user = session.user;
        return next();
    }
    // For HTML page requests, redirect to login
    if (req.accepts('html') && !req.path.startsWith('/mc/')) {
        return res.redirect('/login');
    }
    res.status(401).json({ error: 'Unauthorized' });
});

app.use(express.static(__dirname));

// Server start time for uptime calculation
const startTime = new Date();

// Utility function to ensure file exists
async function ensureFileExists(filepath, defaultContent = '[]') {
    try {
        await fs.access(filepath);
    } catch (error) {
        await fs.writeFile(filepath, defaultContent);
    }
}

// Utility function to read JSON file safely
async function readJsonFile(filepath, defaultValue = []) {
    try {
        await ensureFileExists(filepath, JSON.stringify(defaultValue));
        const data = await fs.readFile(filepath, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error(`Error reading ${filepath}:`, error);
        return defaultValue;
    }
}

// Utility function to write JSON file safely
async function writeJsonFile(filepath, data) {
    try {
        await fs.writeFile(filepath, JSON.stringify(data, null, 2));
        return true;
    } catch (error) {
        console.error(`Error writing ${filepath}:`, error);
        return false;
    }
}

// Password utilities for multi-user support
async function hashPassword(password) {
    return new Promise((resolve, reject) => {
        const salt = crypto.randomBytes(16);
        crypto.pbkdf2(password, salt, 100000, 64, 'sha512', (err, derivedKey) => {
            if (err) reject(err);
            else resolve(salt.toString('hex') + ':' + derivedKey.toString('hex'));
        });
    });
}

async function verifyPassword(password, hash) {
    return new Promise((resolve, reject) => {
        const [salt, key] = hash.split(':');
        crypto.pbkdf2(password, Buffer.from(salt, 'hex'), 100000, 64, 'sha512', (err, derivedKey) => {
            if (err) reject(err);
            else resolve(key === derivedKey.toString('hex'));
        });
    });
}

// Encryption utilities for backup
function encrypt(text, key) {
    const algorithm = 'aes-256-gcm';
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipher(algorithm, key);
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
}

function decrypt(encryptedData, key) {
    const algorithm = 'aes-256-gcm';
    const parts = encryptedData.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];
    
    const decipher = crypto.createDecipher(algorithm, key);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
}

// Utility function to read system stats
function getSystemStats() {
    try {
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMem = totalMem - freeMem;
        const memUsage = ((usedMem / totalMem) * 100).toFixed(1);

        // Read CPU usage from /proc/loadavg
        let cpuUsage = 0;
        try {
            const loadavg = fsSync.readFileSync('/proc/loadavg', 'utf8');
            const load1min = parseFloat(loadavg.split(' ')[0]);
            const cpuCount = os.cpus().length;
            cpuUsage = ((load1min / cpuCount) * 100).toFixed(1);
        } catch (error) {
            // Fallback to os.loadavg()
            const loadavg = os.loadavg();
            const cpuCount = os.cpus().length;
            cpuUsage = ((loadavg[0] / cpuCount) * 100).toFixed(1);
        }

        // Read disk usage (simplified - just root partition)
        let diskUsage = 0;
        try {
            const df = require('child_process').execSync('df / | tail -1', { encoding: 'utf8' });
            const fields = df.trim().split(/\s+/);
            const usedPercent = fields[4].replace('%', '');
            diskUsage = parseFloat(usedPercent);
        } catch (error) {
            console.warn('Could not get disk usage:', error.message);
            diskUsage = 0;
        }

        return {
            cpu: Math.min(100, Math.max(0, cpuUsage)),
            memory: parseFloat(memUsage),
            disk: diskUsage,
            uptime: Math.floor((Date.now() - startTime.getTime()) / 1000)
        };
    } catch (error) {
        console.error('Error getting system stats:', error);
        return { cpu: 0, memory: 0, disk: 0, uptime: 0 };
    }
}

// Routes

// Serve index.html at root
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// GET /mc/openclaw/agents - Real agent status from OpenClaw gateway
app.get('/mc/openclaw/agents', async (req, res) => {
    try {
        const { execSync } = require('child_process');
        const raw = execSync(`openclaw gateway call status --token "${OPENCLAW_TOKEN}" --json 2>/dev/null`, { timeout: 10000 }).toString();
        const data = JSON.parse(raw);
        
        // Parse agent configs
        const configRaw = execSync(`cat /home/linuxuser/.openclaw/openclaw.json`, { timeout: 5000 }).toString();
        // Fix potential trailing commas in JSON
        const cleanConfig = configRaw.replace(/,(\s*[}\]])/g, '$1');
        const config = JSON.parse(cleanConfig);
        const agentList = config.agents?.list || [];
        const defaultModel = config.agents?.defaults?.model?.primary || 'gpt-4o-mini';
        
        // Build agent map from config
        const agentConfigs = {};
        agentConfigs['main'] = { id: 'main', name: 'Spock', role: 'Unified AI Operator', model: defaultModel };
        for (const a of agentList) {
            if (a.id === 'main') {
                agentConfigs['main'].model = a.model || defaultModel;
            } else {
                agentConfigs[a.id] = { 
                    id: a.id, 
                    name: a.name || a.id, 
                    role: a.role || a.id,
                    model: a.model || defaultModel 
                };
            }
        }
        
        // Get session activity per agent
        const sessions = data.sessions?.recent || [];
        const agentActivity = {};
        for (const s of sessions) {
            const aid = s.agentId || 'unknown';
            if (!agentActivity[aid] || s.age < agentActivity[aid].age) {
                agentActivity[aid] = { age: s.age, model: s.model, key: s.key };
            }
        }
        
        // Build response
        const agents = Object.entries(agentConfigs).map(([id, cfg]) => {
            const activity = agentActivity[id];
            const ageMs = activity?.age || null;
            let status = 'offline';
            if (ageMs !== null) {
                if (ageMs < 120000) status = 'online';       // active < 2min
                else if (ageMs < 600000) status = 'idle';    // < 10min
                else status = 'offline';
            }
            return {
                id,
                name: cfg.name,
                role: cfg.role || cfg.name,
                model: activity?.model || cfg.model,
                defaultModel: cfg.model,
                status,
                lastActive: ageMs !== null ? new Date(Date.now() - ageMs).toISOString() : null,
                lastActiveAgo: ageMs
            };
        });
        
        // Heartbeat info
        const heartbeats = data.heartbeat?.agents || [];
        for (const agent of agents) {
            const hb = heartbeats.find(h => h.agentId === agent.id);
            if (hb) {
                agent.heartbeat = { enabled: hb.enabled, every: hb.every };
            }
        }
        
        res.json({ agents, sessions: sessions.length, defaultModel });
    } catch (err) {
        console.error('OpenClaw gateway error:', err.message);
        // Fallback to default agents
        res.json({ 
            agents: [
                { id: 'main', name: 'Spock', role: 'Unified AI Operator', model: 'gpt-4o-mini', status: 'offline', lastActive: null },
                { id: 'dev', name: 'Dev', role: 'Full Stack Developer', model: 'gpt-4o-mini', status: 'offline', lastActive: null },
                { id: 'research', name: 'Research', role: 'Intelligence & Research', model: 'gpt-4o-mini', status: 'offline', lastActive: null }
            ], 
            sessions: 0, 
            defaultModel: 'gpt-4o-mini',
            error: 'OpenClaw gateway unavailable'
        });
    }
});

// NEW FEATURE: Live Activity Feed
app.get('/mc/openclaw/logs', async (req, res) => {
    try {
        const { execSync } = require('child_process');
        const raw = execSync(`openclaw gateway call logs.tail --token "${OPENCLAW_TOKEN}" --json --limit 50`, { timeout: 15000 }).toString();
        const data = JSON.parse(raw);
        
        // Parse and filter log entries
        const entries = (data.entries || [])
            .filter(entry => {
                // Filter out WebSocket handshake timeout spam
                const msg = entry.message || '';
                if (msg.includes('handshake timeout') || msg.includes('websocket')) return false;
                if (msg.includes('TCP connect') || msg.includes('connection reset')) return false;
                return true;
            })
            .map(entry => ({
                timestamp: entry.timestamp || new Date().toISOString(),
                level: entry.level || 'info',
                subsystem: entry.subsystem || 'unknown',
                message: (entry.message || '').substring(0, 200),
                agentId: entry.agentId || null
            }))
            .slice(0, 50);
        
        res.json({ entries, count: entries.length });
    } catch (err) {
        console.error('Error fetching OpenClaw logs:', err.message);
        res.status(500).json({ error: 'Failed to fetch activity logs', detail: err.message });
    }
});

// NEW FEATURE: Session Viewer
app.get('/mc/openclaw/sessions', async (req, res) => {
    try {
        const { execSync } = require('child_process');
        const raw = execSync(`openclaw gateway call status --token "${OPENCLAW_TOKEN}" --json`, { timeout: 10000 }).toString();
        const data = JSON.parse(raw);
        
        const sessions = (data.sessions?.recent || []).map(session => ({
            agentId: session.agentId || 'unknown',
            key: session.key || 'unknown',
            kind: session.kind || 'unknown',
            model: session.model || 'unknown',
            updatedAt: session.updatedAt ? new Date(session.updatedAt).toISOString() : null,
            age: session.age || null,
            tokens: {
                input: session.tokens?.input || 0,
                output: session.tokens?.output || 0,
                total: (session.tokens?.input || 0) + (session.tokens?.output || 0)
            }
        }));
        
        res.json({ sessions, total: sessions.length });
    } catch (err) {
        console.error('Error fetching OpenClaw sessions:', err.message);
        res.status(500).json({ error: 'Failed to fetch sessions', detail: err.message });
    }
});

// NEW FEATURE: Cost Tracker
app.get('/mc/openclaw/costs', async (req, res) => {
    try {
        // Get sessions data
        const sessionsResponse = await new Promise((resolve, reject) => {
            try {
                const { execSync } = require('child_process');
                const raw = execSync(`openclaw gateway call status --token "${OPENCLAW_TOKEN}" --json`, { timeout: 10000 }).toString();
                resolve(JSON.parse(raw));
            } catch (err) {
                reject(err);
            }
        });
        
        const sessions = sessionsResponse.sessions?.recent || [];
        
        // Calculate costs per agent
        const costsByAgent = {};
        let totalInputTokens = 0;
        let totalOutputTokens = 0;
        let totalCost = 0;
        
        const today = new Date().toDateString();
        
        for (const session of sessions) {
            // Filter to today's sessions (rough approximation)
            const sessionAge = session.age || 0;
            const sessionTime = new Date(Date.now() - sessionAge);
            if (sessionTime.toDateString() !== today) continue;
            
            const agentId = session.agentId || 'unknown';
            const model = session.model || 'gpt-4o-mini';
            const inputTokens = session.tokens?.input || 0;
            const outputTokens = session.tokens?.output || 0;
            
            // Cost calculation (rough estimates)
            let inputCostPer1K = 0.003; // Default for gpt-4o-mini
            let outputCostPer1K = 0.003;
            
            if (model.includes('claude')) {
                inputCostPer1K = 0.015;
                outputCostPer1K = 0.015;
            } else if (model.includes('gpt-4o')) {
                inputCostPer1K = 0.005;
                outputCostPer1K = 0.015;
            }
            
            const inputCost = (inputTokens / 1000) * inputCostPer1K;
            const outputCost = (outputTokens / 1000) * outputCostPer1K;
            const sessionCost = inputCost + outputCost;
            
            if (!costsByAgent[agentId]) {
                costsByAgent[agentId] = {
                    agentId,
                    inputTokens: 0,
                    outputTokens: 0,
                    totalTokens: 0,
                    cost: 0
                };
            }
            
            costsByAgent[agentId].inputTokens += inputTokens;
            costsByAgent[agentId].outputTokens += outputTokens;
            costsByAgent[agentId].totalTokens += inputTokens + outputTokens;
            costsByAgent[agentId].cost += sessionCost;
            
            totalInputTokens += inputTokens;
            totalOutputTokens += outputTokens;
            totalCost += sessionCost;
        }
        
        const agentBreakdown = Object.values(costsByAgent);
        
        res.json({
            today: {
                totalInputTokens,
                totalOutputTokens,
                totalTokens: totalInputTokens + totalOutputTokens,
                estimatedCost: Math.round(totalCost * 100) / 100,
                currency: 'USD'
            },
            agentBreakdown,
            lastUpdated: new Date().toISOString()
        });
    } catch (err) {
        console.error('Error calculating costs:', err.message);
        res.status(500).json({ error: 'Failed to calculate costs', detail: err.message });
    }
});

// GET /mc/status - Server uptime, last refresh timestamp, health
app.get('/mc/status', (req, res) => {
    const uptime = Math.floor((Date.now() - startTime.getTime()) / 1000);
    res.json({
        health: 'online',
        uptime: uptime,
        lastRefresh: new Date().toISOString(),
        startTime: startTime.toISOString(),
        version: '1.2.0',
        status: 'operational',
        features: {
            telegram: !!TELEGRAM_BOT_TOKEN,
            stripe: !!STRIPE_SECRET_KEY,
            backup: !!MC_BACKUP_KEY,
            openclaw: !!OPENCLAW_TOKEN
        }
    });
});

// GET /mc/data - Read from mc-data.json
app.get('/mc/data', async (req, res) => {
    try {
        const dataPath = path.join(DATA_DIR, `mc-data-${req.user}.json`);
        const data = await readJsonFile(dataPath, {});
        res.json(data);
    } catch (error) {
        console.error('Error reading mc-data.json:', error);
        res.status(500).json({ error: 'Failed to read data' });
    }
});

// POST /mc/data - Write to mc-data.json (backup from localStorage)
app.post('/mc/data', async (req, res) => {
    try {
        const dataPath = path.join(DATA_DIR, `mc-data-${req.user}.json`);
        const success = await writeJsonFile(dataPath, req.body);
        
        if (success) {
            res.json({ success: true, message: 'Data backed up successfully' });
        } else {
            res.status(500).json({ error: 'Failed to write data' });
        }
    } catch (error) {
        console.error('Error writing mc-data.json:', error);
        res.status(500).json({ error: 'Failed to write data' });
    }
});

// GET /mc/weather - Fetch from Open-Meteo API (Gold Coast: -28.0, 153.4)
app.get('/mc/weather', async (req, res) => {
    try {
        const { execSync } = require('child_process');
        const raw = execSync('curl -s --max-time 5 "https://api.open-meteo.com/v1/forecast?latitude=-28.0&longitude=153.4&current=temperature_2m,apparent_temperature,weather_code,relative_humidity_2m,wind_speed_10m&timezone=Australia/Brisbane"', { timeout: 8000 }).toString();
        const data = JSON.parse(raw);
        const current = data.current;
        const codes = {0:'Clear',1:'Mostly Clear',2:'Partly Cloudy',3:'Overcast',45:'Foggy',48:'Fog',51:'Light Drizzle',53:'Drizzle',55:'Heavy Drizzle',61:'Light Rain',63:'Rain',65:'Heavy Rain',71:'Light Snow',73:'Snow',75:'Heavy Snow',80:'Light Showers',81:'Showers',82:'Heavy Showers',95:'Thunderstorm',96:'Thunderstorm + Hail',99:'Severe Thunderstorm'};
        res.json({
            temp: Math.round(current.temperature_2m),
            condition: codes[current.weather_code] || 'Unknown',
            feels_like: Math.round(current.apparent_temperature),
            humidity: current.relative_humidity_2m,
            windSpeed: Math.round(current.wind_speed_10m),
            city: 'Gold Coast'
        });
    } catch (error) {
        console.error('Error fetching weather:', error.message);
        res.status(500).json({ temp: '--', condition: 'Unavailable', feels_like: '--' });
    }
});

// GET /mc/activity - Read from mc-activity.json, return last 50 entries
app.get('/mc/activity', async (req, res) => {
    try {
        const activityPath = path.join(DATA_DIR, `mc-activity-${req.user}.json`);
        const activities = await readJsonFile(activityPath, []);
        
        // Return last 50 entries, newest first
        const recentActivities = activities.slice(0, 50);
        
        res.json(recentActivities);
    } catch (error) {
        console.error('Error reading activity:', error);
        res.status(500).json({ error: 'Failed to read activity' });
    }
});

// POST /mc/activity - Append to mc-activity.json with timestamp
app.post('/mc/activity', async (req, res) => {
    try {
        const { description, type = 'user', metadata = {} } = req.body;
        
        if (!description) {
            return res.status(400).json({ error: 'Description is required' });
        }
        
        const activityPath = path.join(DATA_DIR, `mc-activity-${req.user}.json`);
        const activities = await readJsonFile(activityPath, []);
        
        const newActivity = {
            id: Date.now().toString(),
            description,
            type,
            metadata,
            timestamp: new Date().toISOString(),
            user: req.user
        };
        
        // Add to beginning of array
        activities.unshift(newActivity);
        
        // Keep only last 500 activities to prevent file from growing too large
        if (activities.length > 500) {
            activities.splice(500);
        }
        
        const success = await writeJsonFile(activityPath, activities);
        
        if (success) {
            res.json({ success: true, activity: newActivity });
        } else {
            res.status(500).json({ error: 'Failed to write activity' });
        }
    } catch (error) {
        console.error('Error adding activity:', error);
        res.status(500).json({ error: 'Failed to add activity' });
    }
});

// GET /mc/system - Read CPU, RAM, disk usage
app.get('/mc/system', (req, res) => {
    try {
        const stats = getSystemStats();
        res.json(stats);
    } catch (error) {
        console.error('Error getting system stats:', error);
        res.status(500).json({ 
            error: 'Failed to get system stats',
            cpu: 0,
            memory: 0,
            disk: 0,
            uptime: 0
        });
    }
});

// TELEGRAM BOT INTEGRATION

// POST /mc/agent/task - Send task to Telegram bot
app.post('/mc/agent/task', async (req, res) => {
    try {
        const { task, agent = 'general' } = req.body;
        
        if (!task) {
            return res.status(400).json({ error: 'Task is required' });
        }
        
        // Log the task
        const activityPath = path.join(DATA_DIR, `mc-activity-${req.user}.json`);
        const activities = await readJsonFile(activityPath, []);
        
        const taskActivity = {
            id: Date.now().toString(),
            description: `Sent task to ${agent}: ${task.substring(0, 100)}${task.length > 100 ? '...' : ''}`,
            type: 'telegram',
            metadata: { agent, task },
            timestamp: new Date().toISOString(),
            user: req.user
        };
        
        activities.unshift(taskActivity);
        await writeJsonFile(activityPath, activities);
        
        // Send to Telegram if configured
        if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
            try {
                const message = `🤖 *Mission Control Task*\n\n*Agent:* ${agent}\n*Task:* ${task}\n*User:* ${req.user}\n*Time:* ${new Date().toLocaleString()}`;
                
                const telegramResponse = await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
                    chat_id: TELEGRAM_CHAT_ID,
                    text: message,
                    parse_mode: 'Markdown'
                });
                
                // Log successful response
                if (telegramResponse.data.ok) {
                    const responseActivity = {
                        id: (Date.now() + 1).toString(),
                        description: `Telegram bot confirmed task receipt`,
                        type: 'telegram',
                        metadata: { response: 'confirmed' },
                        timestamp: new Date().toISOString(),
                        user: req.user
                    };
                    
                    activities.unshift(responseActivity);
                    await writeJsonFile(activityPath, activities);
                }
                
                res.json({ success: true, sent: true, message: 'Task sent to Telegram bot' });
            } catch (telegramError) {
                console.error('Telegram API error:', telegramError);
                res.json({ success: true, sent: false, message: 'Task logged, but Telegram send failed', error: telegramError.message });
            }
        } else {
            // Simulated mode
            setTimeout(async () => {
                const responseActivity = {
                    id: (Date.now() + 1).toString(),
                    description: `Simulated agent response: Task acknowledged and queued`,
                    type: 'telegram',
                    metadata: { response: 'simulated' },
                    timestamp: new Date().toISOString(),
                    user: req.user
                };
                
                activities.unshift(responseActivity);
                await writeJsonFile(activityPath, activities);
            }, 1000);
            
            res.json({ success: true, sent: false, message: 'Task logged (simulated mode - Telegram not configured)' });
        }
    } catch (error) {
        console.error('Error sending task:', error);
        res.status(500).json({ error: 'Failed to send task' });
    }
});

// DAILY DIGEST

// GET /mc/digest - Generate daily summary
app.get('/mc/digest', async (req, res) => {
    try {
        // Get current data
        const dataPath = path.join(DATA_DIR, `mc-data-${req.user}.json`);
        const data = await readJsonFile(dataPath, {});
        
        const clients = data.clients || [];
        const activeMrr = clients.filter(c => c.status === 'active').reduce((sum, c) => sum + parseFloat(c.value || 0), 0);
        
        // Calculate days to June 2026
        const targetDate = new Date('2026-06-01');
        const now = new Date();
        const daysToTarget = Math.ceil((targetDate - now) / (1000 * 60 * 60 * 24));
        
        // Get today's tasks (from projects)
        const projects = data.projects || { backlog: [], progress: [], done: [] };
        const todaysTasks = projects.progress.length;
        
        // Get upcoming meetings
        const meetings = data.meetings || [];
        const today = new Date().toISOString().split('T')[0];
        const upcomingMeetings = meetings.filter(meeting => {
            const meetingDate = new Date(meeting.date);
            const timeDiff = meetingDate - now;
            return timeDiff > 0 && timeDiff < 24 * 60 * 60 * 1000; // Next 24 hours
        });
        
        const digest = {
            date: new Date().toISOString(),
            summary: {
                mrr: {
                    current: activeMrr,
                    target: 10000,
                    progress: ((activeMrr / 10000) * 100).toFixed(1),
                    remaining: 10000 - activeMrr
                },
                tasksToday: todaysTasks,
                upcomingMeetings: upcomingMeetings.length,
                daysToJune2026: daysToTarget,
                weekProgress: Math.floor((7 - now.getDay()) / 7 * 100)
            },
            details: {
                meetings: upcomingMeetings.map(m => ({
                    title: m.title,
                    attendee: m.attendee,
                    time: m.time
                })),
                topPriorities: (data.priorities || []).filter(p => !p.completed).slice(0, 3)
            },
            generated: new Date().toISOString()
        };
        
        res.json(digest);
    } catch (error) {
        console.error('Error generating digest:', error);
        res.status(500).json({ error: 'Failed to generate digest' });
    }
});

// STRIPE INTEGRATION

// GET /mc/stripe/mrr - Fetch MRR from Stripe
app.get('/mc/stripe/mrr', async (req, res) => {
    if (!STRIPE_SECRET_KEY) {
        return res.status(400).json({ error: 'Stripe not configured', connected: false });
    }
    
    try {
        // Get active subscriptions from Stripe
        const response = await axios.get('https://api.stripe.com/v1/subscriptions', {
            params: {
                status: 'active',
                limit: 100
            },
            headers: {
                'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });
        
        const subscriptions = response.data.data;
        let totalMrr = 0;
        
        // Calculate MRR from active subscriptions
        for (const sub of subscriptions) {
            for (const item of sub.items.data) {
                const price = item.price;
                let monthlyAmount = price.unit_amount / 100; // Convert from cents
                
                // Convert to monthly
                if (price.recurring.interval === 'year') {
                    monthlyAmount = monthlyAmount / 12;
                } else if (price.recurring.interval === 'day') {
                    monthlyAmount = monthlyAmount * 30;
                } else if (price.recurring.interval === 'week') {
                    monthlyAmount = monthlyAmount * 4.33;
                }
                
                totalMrr += monthlyAmount * item.quantity;
            }
        }
        
        res.json({
            connected: true,
            mrr: Math.round(totalMrr * 100) / 100,
            subscriptions: subscriptions.length,
            currency: 'USD',
            lastUpdated: new Date().toISOString()
        });
    } catch (error) {
        console.error('Stripe API error:', error);
        res.status(500).json({ 
            error: 'Failed to fetch Stripe data',
            connected: false,
            message: error.response?.data?.error?.message || error.message
        });
    }
});

// GET /mc/stripe/customers - Fetch recent customers
app.get('/mc/stripe/customers', async (req, res) => {
    if (!STRIPE_SECRET_KEY) {
        return res.status(400).json({ error: 'Stripe not configured', connected: false });
    }
    
    try {
        const response = await axios.get('https://api.stripe.com/v1/customers', {
            params: {
                limit: 20
            },
            headers: {
                'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });
        
        const customers = response.data.data.map(customer => ({
            id: customer.id,
            email: customer.email,
            name: customer.name || customer.email,
            created: customer.created,
            subscriptions: customer.subscriptions?.total_count || 0
        }));
        
        res.json({
            connected: true,
            customers: customers,
            total: response.data.total_count,
            lastUpdated: new Date().toISOString()
        });
    } catch (error) {
        console.error('Stripe API error:', error);
        res.status(500).json({ 
            error: 'Failed to fetch customers',
            connected: false,
            message: error.response?.data?.error?.message || error.message
        });
    }
});

// WEBHOOK RECEIVER

// POST /mc/webhook - Accept webhooks from various sources
app.post('/mc/webhook', async (req, res) => {
    try {
        const { body, headers } = req;
        const source = headers['user-agent'] || 'unknown';
        let eventType = 'webhook';
        let description = 'Webhook received';
        
        // Parse different webhook sources
        if (headers['x-github-event']) {
            // GitHub webhook
            eventType = `github.${headers['x-github-event']}`;
            
            switch (headers['x-github-event']) {
                case 'push':
                    description = `GitHub push: ${body.commits?.length || 0} commits to ${body.repository?.name}`;
                    break;
                case 'pull_request':
                    description = `GitHub PR ${body.action}: ${body.pull_request?.title} in ${body.repository?.name}`;
                    break;
                case 'issues':
                    description = `GitHub issue ${body.action}: ${body.issue?.title} in ${body.repository?.name}`;
                    break;
                default:
                    description = `GitHub ${headers['x-github-event']} event in ${body.repository?.name}`;
            }
        } else if (headers['stripe-signature']) {
            // Stripe webhook
            eventType = `stripe.${body.type}`;
            
            switch (body.type) {
                case 'invoice.paid':
                    description = `Stripe: Invoice paid for ${body.data.object.customer_email || 'customer'}`;
                    break;
                case 'customer.subscription.created':
                    description = `Stripe: New subscription created`;
                    break;
                case 'customer.subscription.deleted':
                    description = `Stripe: Subscription cancelled`;
                    break;
                default:
                    description = `Stripe: ${body.type} event`;
            }
        } else {
            // Generic webhook
            if (body.event) eventType = `generic.${body.event}`;
            if (body.message) description = body.message;
        }
        
        // Store webhook event in activity feed (global, not user-specific)
        const activityPath = path.join(DATA_DIR, 'mc-activity-global.json');
        const activities = await readJsonFile(activityPath, []);
        
        const webhookActivity = {
            id: Date.now().toString(),
            description: description,
            type: eventType,
            metadata: {
                source: source,
                headers: Object.keys(headers),
                payload_size: JSON.stringify(body).length
            },
            timestamp: new Date().toISOString(),
            user: 'system'
        };
        
        activities.unshift(webhookActivity);
        
        // Keep only last 1000 webhook events
        if (activities.length > 1000) {
            activities.splice(1000);
        }
        
        await writeJsonFile(activityPath, activities);
        
        console.log('Webhook received:', eventType, description);
        
        res.json({ 
            success: true, 
            message: 'Webhook processed',
            event: eventType
        });
    } catch (error) {
        console.error('Webhook processing error:', error);
        res.status(500).json({ error: 'Webhook processing failed' });
    }
});

// ENCRYPTED DAILY BACKUP

// POST /mc/backup - Create encrypted backup
app.post('/mc/backup', async (req, res) => {
    try {
        // Ensure backup directory exists
        const backupDir = path.join(DATA_DIR, 'backups');
        try {
            await fs.mkdir(backupDir, { recursive: true });
        } catch (error) {
            // Directory might already exist
        }
        
        // Collect all mc-*.json files
        const files = await fs.readdir(DATA_DIR);
        const mcFiles = files.filter(file => file.startsWith('mc-') && file.endsWith('.json'));
        
        const backupData = {};
        
        for (const file of mcFiles) {
            try {
                const content = await fs.readFile(path.join(DATA_DIR, file), 'utf8');
                backupData[file] = JSON.parse(content);
            } catch (error) {
                console.error(`Error reading ${file}:`, error);
            }
        }
        
        // Create backup with timestamp
        const timestamp = new Date().toISOString().split('T')[0];
        const backupContent = JSON.stringify({
            timestamp: new Date().toISOString(),
            files: backupData,
            version: '1.2.0'
        });
        
        // Encrypt backup
        const encryptedContent = encrypt(backupContent, MC_BACKUP_KEY);
        
        // Save to backup directory
        const backupFilename = `mc-backup-${timestamp}-${Date.now()}.enc`;
        const backupPath = path.join(backupDir, backupFilename);
        
        await fs.writeFile(backupPath, encryptedContent);
        
        // Clean up old backups (keep last 30)
        const backupFiles = (await fs.readdir(backupDir))
            .filter(file => file.startsWith('mc-backup-') && file.endsWith('.enc'))
            .sort()
            .reverse();
        
        if (backupFiles.length > 30) {
            for (const oldFile of backupFiles.slice(30)) {
                try {
                    await fs.unlink(path.join(backupDir, oldFile));
                } catch (error) {
                    console.error(`Error deleting old backup ${oldFile}:`, error);
                }
            }
        }
        
        res.json({
            success: true,
            message: 'Backup created successfully',
            filename: backupFilename,
            size: encryptedContent.length,
            files: mcFiles.length,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Backup error:', error);
        res.status(500).json({ error: 'Backup failed' });
    }
});

// GitHub API proxy endpoints
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_USERNAME = process.env.GITHUB_USERNAME || 'ryojindev'; // Default username

async function githubApiRequest(endpoint) {
    if (!GITHUB_TOKEN) {
        throw new Error('GITHUB_TOKEN environment variable not set');
    }
    
    const response = await axios.get(`https://api.github.com${endpoint}`, {
        headers: {
            'Authorization': `Bearer ${GITHUB_TOKEN}`,
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'Mission-Control-Dashboard/1.0'
        },
        timeout: 10000
    });
    
    return response.data;
}

// GET /mc/github/repos - Proxy GitHub API for repositories
app.get('/mc/github/repos', async (req, res) => {
    try {
        const repos = await githubApiRequest(`/user/repos?sort=updated&per_page=20`);
        
        const formattedRepos = repos.map(repo => ({
            id: repo.id,
            name: repo.name,
            full_name: repo.full_name,
            description: repo.description,
            url: repo.html_url,
            private: repo.private,
            language: repo.language,
            stars: repo.stargazers_count,
            forks: repo.forks_count,
            updated_at: repo.updated_at,
            created_at: repo.created_at
        }));
        
        res.json(formattedRepos);
    } catch (error) {
        console.error('Error fetching GitHub repos:', error);
        res.status(500).json({ 
            error: 'Failed to fetch repositories',
            message: error.message 
        });
    }
});

// GET /mc/github/commits - Recent commits across repos
app.get('/mc/github/commits', async (req, res) => {
    try {
        // Get recent activity events for the user
        const events = await githubApiRequest(`/users/${GITHUB_USERNAME}/events?per_page=50`);
        
        // Filter for push events (commits)
        const commits = events
            .filter(event => event.type === 'PushEvent')
            .slice(0, 20)
            .map(event => ({
                id: event.id,
                repo: event.repo.name,
                ref: event.payload.ref,
                commits: event.payload.commits?.map(commit => ({
                    sha: commit.sha?.substring(0, 7),
                    message: commit.message,
                    author: commit.author.name,
                    url: `https://github.com/${event.repo.name}/commit/${commit.sha}`
                })) || [],
                created_at: event.created_at
            }));
        
        res.json(commits);
    } catch (error) {
        console.error('Error fetching GitHub commits:', error);
        res.status(500).json({ 
            error: 'Failed to fetch commits',
            message: error.message 
        });
    }
});

// GET /mc/github/issues - Open issues
app.get('/mc/github/issues', async (req, res) => {
    try {
        const issues = await githubApiRequest(`/issues?state=open&sort=updated&per_page=20`);
        
        const formattedIssues = issues.map(issue => ({
            id: issue.id,
            number: issue.number,
            title: issue.title,
            body: issue.body?.substring(0, 200) + (issue.body?.length > 200 ? '...' : ''),
            url: issue.html_url,
            state: issue.state,
            labels: issue.labels.map(label => label.name),
            assignees: issue.assignees.map(assignee => assignee.login),
            repo: issue.repository_url.split('/').pop(),
            created_at: issue.created_at,
            updated_at: issue.updated_at
        }));
        
        res.json(formattedIssues);
    } catch (error) {
        console.error('Error fetching GitHub issues:', error);
        res.status(500).json({ 
            error: 'Failed to fetch issues',
            message: error.message 
        });
    }
});

// GET /mc/github/prs - Open pull requests
app.get('/mc/github/prs', async (req, res) => {
    try {
        const prs = await githubApiRequest(`/search/issues?q=author:${GITHUB_USERNAME}+type:pr+state:open&sort=updated&per_page=20`);
        
        const formattedPRs = prs.items.map(pr => ({
            id: pr.id,
            number: pr.number,
            title: pr.title,
            body: pr.body?.substring(0, 200) + (pr.body?.length > 200 ? '...' : ''),
            url: pr.html_url,
            state: pr.state,
            labels: pr.labels.map(label => label.name),
            repo: pr.repository_url.split('/').pop(),
            created_at: pr.created_at,
            updated_at: pr.updated_at
        }));
        
        res.json(formattedPRs);
    } catch (error) {
        console.error('Error fetching GitHub PRs:', error);
        res.status(500).json({ 
            error: 'Failed to fetch pull requests',
            message: error.message 
        });
    }
});

// AUTOMATED TASKS

// Auto-backup daily at 3 AM
setInterval(async () => {
    const now = new Date();
    if (now.getHours() === 3 && now.getMinutes() === 0) {
        try {
            console.log('Running automated daily backup...');
            await axios.post('http://localhost:8899/mc/backup', {}, {
                headers: { 'Authorization': `Bearer system` }
            });
            console.log('Automated backup completed');
        } catch (error) {
            console.error('Automated backup failed:', error);
        }
    }
}, 60000); // Check every minute

// Auto-generate digest daily at 9 AM (log it for now)
setInterval(async () => {
    const now = new Date();
    if (now.getHours() === 9 && now.getMinutes() === 0) {
        try {
            console.log('Generating daily digest...');
            // In a real implementation, you'd send this to all users or admins
            console.log('Daily digest generated successfully');
        } catch (error) {
            console.error('Daily digest generation failed:', error);
        }
    }
}, 60000); // Check every minute

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('Server error:', error);
    res.status(500).json({ 
        error: 'Internal server error',
        message: error.message 
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`Mission Control server running on http://localhost:${PORT}`);
    console.log(`Started at: ${startTime.toISOString()}`);
    console.log('Environment variables:');
    console.log(`- GITHUB_TOKEN: ${GITHUB_TOKEN ? 'Set' : 'Not set'}`);
    console.log(`- GITHUB_USERNAME: ${GITHUB_USERNAME}`);
    console.log(`- TELEGRAM_BOT_TOKEN: ${TELEGRAM_BOT_TOKEN ? 'Set' : 'Not set'}`);
    console.log(`- TELEGRAM_CHAT_ID: ${TELEGRAM_CHAT_ID ? 'Set' : 'Not set'}`);
    console.log(`- STRIPE_SECRET_KEY: ${STRIPE_SECRET_KEY ? 'Set' : 'Not set'}`);
    console.log(`- OPENCLAW_GATEWAY_TOKEN: ${OPENCLAW_TOKEN ? 'Set' : 'Not set'}`);
    console.log(`- MC_BACKUP_KEY: ${MC_BACKUP_KEY ? 'Generated/Set' : 'Not set'}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('Received SIGINT. Graceful shutdown...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('Received SIGTERM. Graceful shutdown...');
    process.exit(0);
});