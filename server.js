#!/usr/bin/env node

const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const os = require('os');
const axios = require('axios');

const app = express();
const PORT = 8899;
const DATA_DIR = __dirname;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
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
        const url = `https://wttr.in/${encodeURIComponent(city)}?format=j1`;
        
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