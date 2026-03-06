"""Agent Dashboard — OpenClaw/agent-ui style admin panel.

What's New (vs full-dashboard/):
    • Rendered HTML dashboard — not just JSON APIs
    • Sidebar navigation with live page switching
    • Status badges, toggle buttons, real-time data
    • Glassmorphism dark theme
    • All data from PraisonAIUI feature APIs

Run:
    PYTHONPATH=src python app.py
    # Dashboard at http://localhost:8082
"""

import os
import sys
import uvicorn
from starlette.responses import HTMLResponse
from starlette.routing import Route

from praisonaiui.server import create_app

# Use shared seed data helper
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from _shared.seed_data import seed_demo_data


# ── HTML Template ────────────────────────────────────────────────────

DASHBOARD_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Agent Dashboard — PraisonAIUI</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
:root {
    --bg-primary: #0a0a12;
    --bg-card: #12121f;
    --bg-hover: #1a1a2e;
    --border: #2a2a4a;
    --text-primary: #e0e0e8;
    --text-secondary: #94a3b8;
    --accent-purple: #7c3aed;
    --accent-cyan: #06b6d4;
    --accent-green: #22c55e;
    --accent-amber: #f59e0b;
    --accent-red: #ef4444;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: 'Inter', -apple-system, sans-serif; background: var(--bg-primary);
       color: var(--text-primary); display: flex; min-height: 100vh; }

/* Sidebar */
.sidebar { width: 240px; background: var(--bg-card); border-right: 1px solid var(--border);
           display: flex; flex-direction: column; position: fixed; height: 100vh; z-index: 10; }
.sidebar-header { padding: 1.25rem; border-bottom: 1px solid var(--border); }
.sidebar-header h1 { font-size: 1.1rem; font-weight: 700;
    background: linear-gradient(90deg, var(--accent-purple), var(--accent-cyan));
    -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
.sidebar-header p { font-size: 0.7rem; color: var(--text-secondary); margin-top: 2px; }
.nav-group { padding: 0.75rem 0; }
.nav-group-label { font-size: 0.65rem; color: var(--text-secondary); text-transform: uppercase;
                    letter-spacing: 0.1em; padding: 0 1rem; margin-bottom: 0.25rem; font-weight: 600; }
.nav-item { display: flex; align-items: center; gap: 0.6rem; padding: 0.5rem 1rem;
            cursor: pointer; transition: all 0.2s; font-size: 0.85rem; color: var(--text-secondary);
            border-left: 3px solid transparent; }
.nav-item:hover { background: var(--bg-hover); color: var(--text-primary); }
.nav-item.active { background: var(--bg-hover); color: var(--accent-purple);
                    border-left-color: var(--accent-purple); font-weight: 500; }
.nav-icon { font-size: 1rem; width: 1.5rem; text-align: center; }
.nav-badge { margin-left: auto; background: var(--accent-purple); color: white;
             font-size: 0.65rem; padding: 1px 6px; border-radius: 10px; }

/* Main content */
.main { margin-left: 240px; flex: 1; padding: 1.5rem; }
.page-header { margin-bottom: 1.5rem; }
.page-header h2 { font-size: 1.5rem; font-weight: 600; }
.page-header p { color: var(--text-secondary); font-size: 0.9rem; margin-top: 0.25rem; }

/* Cards grid */
.stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
              gap: 1rem; margin-bottom: 1.5rem; }
.stat-card { background: var(--bg-card); border: 1px solid var(--border); border-radius: 10px;
             padding: 1.25rem; transition: border-color 0.3s; }
.stat-card:hover { border-color: var(--accent-purple); }
.stat-label { font-size: 0.75rem; color: var(--text-secondary); text-transform: uppercase;
              letter-spacing: 0.05em; }
.stat-value { font-size: 1.75rem; font-weight: 700; margin-top: 0.25rem;
              background: linear-gradient(90deg, var(--accent-purple), var(--accent-cyan));
              -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
.stat-sub { font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.25rem; }

/* Table */
.data-table { width: 100%; background: var(--bg-card); border: 1px solid var(--border);
              border-radius: 10px; overflow: hidden; }
.data-table th { text-align: left; padding: 0.75rem 1rem; font-size: 0.75rem;
                 text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-secondary);
                 background: var(--bg-hover); border-bottom: 1px solid var(--border); font-weight: 600; }
.data-table td { padding: 0.75rem 1rem; font-size: 0.85rem; border-bottom: 1px solid var(--border); }
.data-table tr:last-child td { border-bottom: none; }
.data-table tr:hover td { background: rgba(124, 58, 237, 0.05); }

/* Badges */
.badge { padding: 2px 8px; border-radius: 4px; font-size: 0.7rem; font-weight: 600; }
.badge-online { background: rgba(34, 197, 94, 0.15); color: var(--accent-green); }
.badge-offline { background: rgba(239, 68, 68, 0.15); color: var(--accent-red); }
.badge-enabled { background: rgba(34, 197, 94, 0.15); color: var(--accent-green); }
.badge-disabled { background: rgba(148, 163, 184, 0.15); color: var(--text-secondary); }
.badge-running { background: rgba(6, 182, 212, 0.15); color: var(--accent-cyan); }
.badge-platform { background: rgba(124, 58, 237, 0.1); color: var(--accent-purple); }

/* Toggle switch */
.toggle { position: relative; width: 36px; height: 20px; cursor: pointer; }
.toggle input { display: none; }
.toggle-slider { position: absolute; inset: 0; background: #333; border-radius: 10px;
                 transition: 0.3s; }
.toggle-slider::before { content: ''; position: absolute; left: 2px; top: 2px; width: 16px;
                         height: 16px; background: white; border-radius: 50%; transition: 0.3s; }
.toggle input:checked + .toggle-slider { background: var(--accent-purple); }
.toggle input:checked + .toggle-slider::before { transform: translateX(16px); }

/* Section */
.section { margin-bottom: 1.5rem; }
.section-title { font-size: 0.85rem; color: var(--text-secondary); font-weight: 600;
                 text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.75rem;
                 display: flex; align-items: center; gap: 0.5rem; }
.section-count { background: var(--accent-purple); color: white; font-size: 0.65rem;
                 padding: 1px 6px; border-radius: 10px; }

/* Page display */
.page { display: none; }
.page.active { display: block; }

/* Animations */
@keyframes fadeIn { from { opacity: 0; transform: translateY(8px); }
                    to { opacity: 1; transform: translateY(0); } }
.page.active { animation: fadeIn 0.3s ease; }

/* Feature list */
.feature-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
                gap: 1rem; }
.feature-card { background: var(--bg-card); border: 1px solid var(--border); border-radius: 10px;
                padding: 1.25rem; transition: all 0.3s; }
.feature-card:hover { border-color: var(--accent-purple); transform: translateY(-2px); }
.feature-name { font-weight: 600; margin-bottom: 0.25rem; }
.feature-desc { font-size: 0.8rem; color: var(--text-secondary); }
.feature-routes { margin-top: 0.75rem; font-size: 0.75rem; color: var(--text-secondary); }
.feature-route { font-family: monospace; font-size: 0.7rem; color: var(--accent-cyan);
                 display: block; margin-top: 2px; }

/* Empty state */
.empty { text-align: center; padding: 3rem; color: var(--text-secondary); }
.empty-icon { font-size: 3rem; margin-bottom: 1rem; }
</style>
</head>
<body>
<aside class="sidebar">
    <div class="sidebar-header">
        <h1>🤖 Agent Dashboard</h1>
        <p>PraisonAIUI Admin</p>
    </div>
    <nav>
        <div class="nav-group">
            <div class="nav-group-label">Overview</div>
            <div class="nav-item active" data-page="overview">
                <span class="nav-icon">📊</span> Overview
            </div>
            <div class="nav-item" data-page="features">
                <span class="nav-icon">⚡</span> Features
                <span class="nav-badge" id="nav-feature-count">—</span>
            </div>
        </div>
        <div class="nav-group">
            <div class="nav-group-label">Messaging</div>
            <div class="nav-item" data-page="channels">
                <span class="nav-icon">📡</span> Channels
                <span class="nav-badge" id="nav-channel-count">—</span>
            </div>
        </div>
        <div class="nav-group">
            <div class="nav-group-label">Infrastructure</div>
            <div class="nav-item" data-page="nodes">
                <span class="nav-icon">🖥️</span> Nodes
                <span class="nav-badge" id="nav-node-count">—</span>
            </div>
            <div class="nav-item" data-page="instances">
                <span class="nav-icon">📻</span> Instances
                <span class="nav-badge" id="nav-instance-count">—</span>
            </div>
        </div>
        <div class="nav-group">
            <div class="nav-group-label">Automation</div>
            <div class="nav-item" data-page="schedules">
                <span class="nav-icon">⏰</span> Schedules
                <span class="nav-badge" id="nav-schedule-count">—</span>
            </div>
            <div class="nav-item" data-page="skills">
                <span class="nav-icon">🧩</span> Skills
                <span class="nav-badge" id="nav-skill-count">—</span>
            </div>
        </div>
    </nav>
</aside>

<main class="main">
    <!-- OVERVIEW PAGE -->
    <div class="page active" id="page-overview">
        <div class="page-header">
            <h2>Overview</h2>
            <p>Real-time system status at a glance</p>
        </div>
        <div class="stats-grid" id="overview-stats"></div>
    </div>

    <!-- FEATURES PAGE -->
    <div class="page" id="page-features">
        <div class="page-header">
            <h2>Features</h2>
            <p>All registered protocol feature modules</p>
        </div>
        <div class="feature-grid" id="features-grid"></div>
    </div>

    <!-- CHANNELS PAGE -->
    <div class="page" id="page-channels">
        <div class="page-header">
            <h2>Channels</h2>
            <p>Multi-platform messaging channels</p>
        </div>
        <div class="section">
            <div class="section-title">Active Channels <span class="section-count" id="channel-count">0</span></div>
            <table class="data-table" id="channels-table">
                <thead><tr>
                    <th>Name</th><th>Platform</th><th>Status</th><th>Enabled</th><th>Last Activity</th>
                </tr></thead>
                <tbody></tbody>
            </table>
        </div>
    </div>

    <!-- NODES PAGE -->
    <div class="page" id="page-nodes">
        <div class="page-header">
            <h2>Nodes</h2>
            <p>Execution nodes and agent bindings</p>
        </div>
        <div class="section">
            <div class="section-title">Registered Nodes <span class="section-count" id="node-count">0</span></div>
            <table class="data-table" id="nodes-table">
                <thead><tr>
                    <th>Name</th><th>Host</th><th>Platform</th><th>Status</th><th>Agents</th><th>Policy</th>
                </tr></thead>
                <tbody></tbody>
            </table>
        </div>
    </div>

    <!-- INSTANCES PAGE -->
    <div class="page" id="page-instances">
        <div class="page-header">
            <h2>Instances</h2>
            <p>Connected clients and workers</p>
        </div>
        <div class="section">
            <div class="section-title">Connected Instances <span class="section-count" id="instance-count">0</span></div>
            <table class="data-table" id="instances-table">
                <thead><tr>
                    <th>ID</th><th>Host</th><th>Platform</th><th>Mode</th><th>Roles</th><th>Last Seen</th>
                </tr></thead>
                <tbody></tbody>
            </table>
        </div>
    </div>

    <!-- SCHEDULES PAGE -->
    <div class="page" id="page-schedules">
        <div class="page-header">
            <h2>Schedules</h2>
            <p>Cron jobs and scheduled tasks</p>
        </div>
        <div class="section">
            <div class="section-title">Scheduled Jobs <span class="section-count" id="schedule-count">0</span></div>
            <table class="data-table" id="schedules-table">
                <thead><tr>
                    <th>Name</th><th>Schedule</th><th>Agent</th><th>Enabled</th><th>Runs</th><th>Last Run</th>
                </tr></thead>
                <tbody></tbody>
            </table>
        </div>
    </div>

    <!-- SKILLS PAGE -->
    <div class="page" id="page-skills">
        <div class="page-header">
            <h2>Skills</h2>
            <p>Registered agent capabilities</p>
        </div>
        <div class="section">
            <div class="section-title">Agent Skills <span class="section-count" id="skill-count">0</span></div>
            <table class="data-table" id="skills-table">
                <thead><tr>
                    <th>Name</th><th>ID</th><th>Enabled</th><th>Config</th>
                </tr></thead>
                <tbody></tbody>
            </table>
        </div>
    </div>
</main>

<script>
// ── Navigation ──────────────────────────────────────────────────────
document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
        document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        item.classList.add('active');
        document.getElementById('page-' + item.dataset.page).classList.add('active');
    });
});

// ── Data loading ────────────────────────────────────────────────────
async function fetchJSON(url) {
    const r = await fetch(url);
    return r.json();
}

function timeAgo(ts) {
    if (!ts) return '—';
    const s = Math.floor(Date.now() / 1000 - ts);
    if (s < 60) return s + 's ago';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return Math.floor(s / 86400) + 'd ago';
}

async function loadOverview() {
    const [features, channels, nodes, instances, schedules, skills] = await Promise.all([
        fetchJSON('/api/features'),
        fetchJSON('/api/channels'),
        fetchJSON('/api/nodes'),
        fetchJSON('/api/instances'),
        fetchJSON('/api/schedules'),
        fetchJSON('/api/skills'),
    ]);

    // Nav badges
    document.getElementById('nav-feature-count').textContent = features.count;
    document.getElementById('nav-channel-count').textContent = channels.count;
    document.getElementById('nav-node-count').textContent = nodes.count;
    document.getElementById('nav-instance-count').textContent = instances.count;
    document.getElementById('nav-schedule-count').textContent = schedules.count;
    document.getElementById('nav-skill-count').textContent = skills.count;

    // Overview stats
    const statsEl = document.getElementById('overview-stats');
    const runningChannels = channels.channels.filter(c => c.running).length;
    const onlineNodes = nodes.nodes.filter(n => n.status === 'online').length;
    statsEl.innerHTML = `
        <div class="stat-card">
            <div class="stat-label">Features</div>
            <div class="stat-value">${features.count}</div>
            <div class="stat-sub">Protocol modules active</div>
        </div>
        <div class="stat-card">
            <div class="stat-label">Channels</div>
            <div class="stat-value">${channels.count}</div>
            <div class="stat-sub">${runningChannels} running</div>
        </div>
        <div class="stat-card">
            <div class="stat-label">Nodes</div>
            <div class="stat-value">${nodes.count}</div>
            <div class="stat-sub">${onlineNodes} online</div>
        </div>
        <div class="stat-card">
            <div class="stat-label">Instances</div>
            <div class="stat-value">${instances.count}</div>
            <div class="stat-sub">Connected clients & workers</div>
        </div>
        <div class="stat-card">
            <div class="stat-label">Schedules</div>
            <div class="stat-value">${schedules.count}</div>
            <div class="stat-sub">Cron jobs registered</div>
        </div>
        <div class="stat-card">
            <div class="stat-label">Skills</div>
            <div class="stat-value">${skills.count}</div>
            <div class="stat-sub">Agent capabilities</div>
        </div>
    `;

    // Features grid
    const fg = document.getElementById('features-grid');
    fg.innerHTML = features.features.map(f => `
        <div class="feature-card">
            <div class="feature-name">${f.name}</div>
            <div class="feature-desc">${f.description}</div>
            <div class="feature-routes">${f.routes.length} routes
                ${f.routes.slice(0, 3).map(r => '<span class="feature-route">' + r + '</span>').join('')}
                ${f.routes.length > 3 ? '<span class="feature-route">... +' + (f.routes.length - 3) + ' more</span>' : ''}
            </div>
        </div>
    `).join('');

    // Channels table
    document.getElementById('channel-count').textContent = channels.count;
    document.querySelector('#channels-table tbody').innerHTML = channels.channels.map(c => `
        <tr>
            <td><strong>${c.name}</strong></td>
            <td><span class="badge badge-platform">${c.platform}</span></td>
            <td>${c.running ? '<span class="badge badge-running">● running</span>' : '<span class="badge badge-offline">● stopped</span>'}</td>
            <td>${c.enabled ? '<span class="badge badge-enabled">enabled</span>' : '<span class="badge badge-disabled">disabled</span>'}</td>
            <td>${timeAgo(c.last_activity)}</td>
        </tr>
    `).join('');

    // Nodes table
    document.getElementById('node-count').textContent = nodes.count;
    document.querySelector('#nodes-table tbody').innerHTML = nodes.nodes.map(n => `
        <tr>
            <td><strong>${n.name}</strong></td>
            <td><code>${n.host}</code></td>
            <td>${n.platform}</td>
            <td>${n.status === 'online' ? '<span class="badge badge-online">● online</span>' : '<span class="badge badge-offline">● offline</span>'}</td>
            <td>${(n.agents || []).map(a => '<span class="badge badge-platform">' + a + '</span> ').join('')}</td>
            <td><span class="badge">${n.approval_policy}</span></td>
        </tr>
    `).join('');

    // Instances table
    document.getElementById('instance-count').textContent = instances.count;
    document.querySelector('#instances-table tbody').innerHTML = instances.instances.map(i => `
        <tr>
            <td><code>${i.id}</code></td>
            <td>${i.host}</td>
            <td>${i.platform}</td>
            <td><span class="badge badge-${i.mode === 'worker' ? 'running' : 'enabled'}">${i.mode}</span></td>
            <td>${(i.roles || []).join(', ')}</td>
            <td>${timeAgo(i.last_seen)}</td>
        </tr>
    `).join('');

    // Schedules table
    document.getElementById('schedule-count').textContent = schedules.count;
    document.querySelector('#schedules-table tbody').innerHTML = schedules.schedules.map(s => `
        <tr>
            <td><strong>${s.name}</strong></td>
            <td><code>${s.schedule}</code></td>
            <td>${s.agent_id || '—'}</td>
            <td>${s.enabled ? '<span class="badge badge-enabled">enabled</span>' : '<span class="badge badge-disabled">disabled</span>'}</td>
            <td>${s.run_count || 0}</td>
            <td>${timeAgo(s.last_run)}</td>
        </tr>
    `).join('');

    // Skills table
    document.getElementById('skill-count').textContent = skills.count;
    document.querySelector('#skills-table tbody').innerHTML = skills.skills.map(s => `
        <tr>
            <td><strong>${s.name}</strong></td>
            <td><code>${s.id}</code></td>
            <td>${s.enabled ? '<span class="badge badge-enabled">enabled</span>' : '<span class="badge badge-disabled">disabled</span>'}</td>
            <td><code>${JSON.stringify(s.config || {})}</code></td>
        </tr>
    `).join('');
}

// Auto-refresh every 10 seconds
loadOverview();
setInterval(loadOverview, 10000);
</script>
</body>
</html>"""



# ── Entry point ──────────────────────────────────────────────────────

seed_demo_data()

if __name__ == "__main__":
    app = create_app()

    # Add the dashboard HTML landing page
    async def dashboard_landing(request):
        return HTMLResponse(DASHBOARD_HTML)

    app.routes.insert(0, Route("/", dashboard_landing, methods=["GET"]))

    print("✅ Agent Dashboard at http://localhost:8082")
    print("   JSON API: http://localhost:8082/api/features")
    uvicorn.run(app, host="0.0.0.0", port=8082, log_level="info")
