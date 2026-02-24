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

// Middleware
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '50mb' }));

// Auth endpoints (before static/protected middleware)
app.post('/auth/login', (req, res) => {
    const { username, password } = req.body;
    if (username === 'tolga' && password === MC_PASSWORD) {
        const token = crypto.randomBytes(32).toString('hex');
        sessions.set(token, { user: username, expires: Date.now() + 24 * 60 * 60 * 1000 });
        res.json({ success: true, token });
    } else {
        res.status(401).json({ success: false, error: 'Invalid credentials' });
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
    if (req.path === '/login' || req.path.startsWith('/auth/')) return next();
    const token = req.headers.authorization?.replace('Bearer ', '') || req.query.token;
    const session = token && sessions.get(token);
    if (session && session.expires > Date.now()) {
        session.expires = Date.now() + 24 * 60 * 60 * 1000; // refresh
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

// GET /mc/status - Server uptime, last refresh timestamp, health
app.get('/mc/status', (req, res) => {
    const uptime = Math.floor((Date.now() - startTime.getTime()) / 1000);
    res.json({
        health: 'online',
        uptime: uptime,
        lastRefresh: new Date().toISOString(),
        startTime: startTime.toISOString(),
        version: '1.0.0',
        status: 'operational'
    });
});

// GET /mc/data - Read from mc-data.json
app.get('/mc/data', async (req, res) => {
    try {
        const dataPath = path.join(DATA_DIR, 'mc-data.json');
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
        const dataPath = path.join(DATA_DIR, 'mc-data.json');
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

// GET /mc/weather - Fetch from wttr.in API
app.get('/mc/weather', async (req, res) => {
    try {
        const city = req.query.city || 'Gold+Coast';
        const url = `https://wttr.in/${city.replace(/\s+/g, '_')}?format=j1`;
        
        const response = await axios.get(url, {
            timeout: 5000,
            headers: {
                'User-Agent': 'Mission-Control-Dashboard/1.0'
            }
        });
        
        if (response.data && response.data.current_condition && response.data.current_condition[0]) {
            const current = response.data.current_condition[0];
            const weather = {
                temp: current.temp_C,
                tempF: current.temp_F,
                condition: current.weatherDesc[0].value,
                feels_like: current.FeelsLikeC,
                feels_likeF: current.FeelsLikeF,
                humidity: current.humidity,
                windSpeed: current.windspeedKmph,
                city: city.replace(/\+/g, ' ')
            };
            
            res.json(weather);
        } else {
            throw new Error('Invalid weather data format');
        }
    } catch (error) {
        console.error('Error fetching weather:', error);
        res.status(500).json({ 
            error: 'Failed to fetch weather',
            temp: '--',
            condition: 'Unavailable',
            feels_like: '--'
        });
    }
});

// GET /mc/activity - Read from mc-activity.json, return last 50 entries
app.get('/mc/activity', async (req, res) => {
    try {
        const activityPath = path.join(DATA_DIR, 'mc-activity.json');
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
        
        const activityPath = path.join(DATA_DIR, 'mc-activity.json');
        const activities = await readJsonFile(activityPath, []);
        
        const newActivity = {
            id: Date.now().toString(),
            description,
            type,
            metadata,
            timestamp: new Date().toISOString()
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
});