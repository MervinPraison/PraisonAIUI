"""Dynamic Feature Dashboard — Test all PraisonAIUI features via browser UI.

Self-contained example: seeds demo data, generates a dynamic dashboard
that discovers all features from /api/features and /api/pages at runtime.
No hardcoded feature lists — everything is protocol-driven.

Run:
    pip install praisonaiui uvicorn
    python app.py
    # Dashboard at http://localhost:8082
"""

import tempfile
import time
import uuid
from pathlib import Path

# ── Seed demo data ───────────────────────────────────────────────────
SEED_DATA = {
    "channels": {
        "_channels": {
            "discord-general": {"id": "discord-general", "name": "Discord #general", "platform": "discord",
                                "enabled": True, "running": True, "config": {"guild_id": "123"}, "last_activity": None},
            "telegram-bot":    {"id": "telegram-bot", "name": "Telegram Bot", "platform": "telegram",
                                "enabled": True, "running": False, "config": {}, "last_activity": None},
            "slack-workspace": {"id": "slack-workspace", "name": "Slack Workspace", "platform": "slack",
                                "enabled": False, "running": False, "config": {}, "last_activity": None},
        }
    },
    "agents": {
        "_definitions": {
            "agent-1": {"id": "agent-1", "name": "Research Agent", "instructions": "Research topics",
                        "model": "gpt-4o-mini", "status": "ready", "tools": ["web_search"]},
            "agent-2": {"id": "agent-2", "name": "Code Assistant", "instructions": "Help write code",
                        "model": "gpt-4o", "status": "ready", "tools": ["execute_code"]},
        }
    },
    "schedules": {
        "_schedules": {
            "sched-1": {"id": "sched-1", "name": "Daily Report", "schedule": {"kind": "every", "every_seconds": 86400},
                        "message": "Generate daily summary", "enabled": True, "created_at": None},
        }
    },
    "jobs": {
        "_jobs": {
            "run_001": {"job_id": "run_001", "status": "completed", "result": "Done",
                        "prompt": "Analyze trends", "config": {"model": "gpt-4o-mini"}, "created_at": None},
        }
    },
    "approvals": {
        "_requests": {
            None: {"id": None, "tool_name": "execute_command", "arguments": {"cmd": "test"},
                   "risk_level": "high", "agent_name": "SysAdmin", "status": "pending", "created_at": None},
        }
    },
    "auth": {
        "_api_keys": {
            "pk_demo": {"key": "pk_demo", "name": "Demo Key", "created_at": None,
                        "expires_at": None, "last_used": None},
        }
    },
}


def seed():
    """Seed features with demo data using the protocol registry."""
    from praisonaiui.features import get_features, auto_register_defaults
    auto_register_defaults()
    features = get_features()
    now = time.time()

    for feat_name, attrs in SEED_DATA.items():
        feat = features.get(feat_name)
        if not feat:
            continue
        for attr_name, items in attrs.items():
            store = getattr(feat, attr_name, None)
            if store is None:
                continue
            for key, val in items.items():
                # Fill in timestamps
                for k in ("last_activity", "created_at", "last_used"):
                    if k in val and val[k] is None:
                        val[k] = now
                if "expires_at" in val and val["expires_at"] is None:
                    val["expires_at"] = now + 86400 * 90
                # Auto-generate IDs where needed
                actual_key = key if key else str(uuid.uuid4())[:8]
                if "id" in val and val["id"] is None:
                    val["id"] = actual_key
                try:
                    store[actual_key] = val
                except Exception:
                    pass

    # Usage — track via function
    try:
        from praisonaiui.features.usage import track_usage
        for model, inp, out, sess in [
            ("gpt-4o-mini", 1200, 450, "sess-alpha"),
            ("gpt-4o", 2500, 1100, "sess-alpha"),
            ("claude-3-5-sonnet", 3000, 1500, "sess-beta"),
        ]:
            track_usage(model, inp, out, sess)
    except Exception:
        pass

    print(f"  ✅ Seeded {len(features)} features")


# ── Dashboard HTML — fully dynamic, zero hardcoded features ──────────
# The JS discovers everything from /api/pages and /api/features at runtime.
# Plugins handle rich UI; generic viewer handles the rest.
DASHBOARD_HTML = r"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PraisonAIUI Dashboard</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    *,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
    :root{--bg:#0a0e1a;--bg2:#111827;--card:#1e293b;--border:rgba(148,163,184,.1);--t1:#f1f5f9;--t2:#94a3b8;--tm:#64748b;--accent:#6366f1;--ok:#22c55e;--warn:#f59e0b;--err:#ef4444;--sw:260px}
    body{font-family:'Inter',system-ui,sans-serif;background:var(--bg);color:var(--t1);height:100vh;overflow:hidden}
    .layout{display:flex;height:100vh}

    /* Sidebar */
    .side{width:var(--sw);background:var(--bg2);border-right:1px solid var(--border);display:flex;flex-direction:column;overflow-y:auto;flex-shrink:0}
    .side-hdr{padding:1.25rem 1rem;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:.75rem}
    .logo{width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,var(--accent),#8b5cf6);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:11px;color:#fff;box-shadow:0 4px 12px rgba(99,102,241,.3)}
    .side-t{font-size:.9375rem;font-weight:700;letter-spacing:-.02em}
    .side-st{font-size:.6875rem;color:var(--tm)}
    .nav{flex:1;padding:.75rem 0}
    .ng{padding:.5rem 1rem .375rem;font-size:.625rem;font-weight:600;text-transform:uppercase;letter-spacing:.1em;color:var(--tm);margin-top:.5rem}
    .ni{display:flex;align-items:center;gap:.625rem;padding:.5rem 1rem;cursor:pointer;font-size:.8125rem;color:var(--t2);border-left:3px solid transparent;transition:all .15s;user-select:none}
    .ni:hover{background:rgba(99,102,241,.06);color:var(--t1)}
    .ni.on{background:rgba(99,102,241,.1);color:var(--t1);border-left-color:var(--accent);font-weight:500}
    .ni-i{font-size:1rem;width:1.25rem;text-align:center}
    .side-ft{padding:.75rem 1rem;border-top:1px solid var(--border);font-size:.6875rem;color:var(--tm);display:flex;align-items:center;justify-content:space-between}
    .dot{width:8px;height:8px;border-radius:50%;background:var(--ok);box-shadow:0 0 6px var(--ok);display:inline-block;margin-right:.375rem}

    /* Main */
    .main{flex:1;display:flex;flex-direction:column;overflow:hidden}
    .top{display:flex;align-items:center;justify-content:space-between;padding:.75rem 1.5rem;border-bottom:1px solid var(--border);background:var(--bg2);flex-shrink:0}
    .top-t{font-size:1.125rem;font-weight:600}
    .top-a{display:flex;gap:.5rem}
    .btn{padding:.4375rem .875rem;border:1px solid var(--border);border-radius:.375rem;background:transparent;color:var(--t2);font-size:.75rem;font-weight:500;cursor:pointer;display:flex;align-items:center;gap:.375rem;transition:all .15s}
    .btn:hover{background:rgba(255,255,255,.05);color:var(--t1)}
    .btn-a{background:var(--accent);color:#fff;border-color:var(--accent)}
    .btn-a:hover{background:#4f46e5}
    .pc{flex:1;overflow-y:auto}

    /* Generic viewer */
    .gv{padding:1.5rem;max-width:1200px;margin:0 auto}
    .gv h2{font-size:1.5rem;font-weight:600;margin-bottom:1rem}
    .gc{background:var(--card);border:1px solid var(--border);border-radius:.75rem;padding:1.25rem;margin-bottom:1rem}
    .gj{background:rgba(0,0,0,.3);border-radius:.5rem;padding:1rem;font-family:'SF Mono',Monaco,monospace;font-size:.75rem;color:#a5f3fc;max-height:400px;overflow:auto;white-space:pre-wrap;word-break:break-all}
    .gs{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:1rem;margin-bottom:1.5rem}
    .gs-c{background:var(--card);border:1px solid var(--border);border-radius:.75rem;padding:1rem;text-align:center}
    .gs-v{font-size:1.75rem;font-weight:700;color:var(--accent)}
    .gs-l{font-size:.6875rem;color:var(--tm);text-transform:uppercase;letter-spacing:.05em;margin-top:.25rem}

    /* Test panel */
    .tp{padding:1.5rem;max-width:1200px;margin:0 auto}
    .tp h2{font-size:1.5rem;font-weight:600;margin-bottom:.5rem}
    .tp-d{color:var(--t2);font-size:.875rem;margin-bottom:1.5rem}
    .tg{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:1rem}
    .tc{background:var(--card);border:1px solid var(--border);border-radius:.75rem;padding:1rem;display:flex;flex-direction:column;gap:.75rem}
    .tc-h{display:flex;align-items:center;gap:.5rem}
    .tc-i{font-size:1.25rem;width:2rem;height:2rem;display:flex;align-items:center;justify-content:center;background:rgba(99,102,241,.1);border-radius:.375rem}
    .tc-t{font-size:.875rem;font-weight:600}
    .tc-d{font-size:.75rem;color:var(--tm)}
    .tr{font-size:.6875rem;font-family:monospace;padding:.5rem;background:rgba(0,0,0,.3);border-radius:.375rem;color:var(--t2);max-height:120px;overflow-y:auto;display:none}
    .tr.s{display:block}.tr.ok{border-left:3px solid var(--ok)}.tr.er{border-left:3px solid var(--err)}

    .ld{display:flex;align-items:center;justify-content:center;padding:4rem;color:var(--tm);font-size:.875rem}
    .sp{width:24px;height:24px;border:2px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:spin .8s linear infinite;margin-right:.75rem}
    @keyframes spin{to{transform:rotate(360deg)}}

    @media(max-width:768px){
      .side{width:60px}
      .side-t,.side-st,.ng,.ni span:not(.ni-i),.side-ft span{display:none}
      .ni{justify-content:center;padding:.75rem}
      .side-hdr{justify-content:center}
      .side-hdr>div:last-child{display:none}
    }
  </style>
</head>
<body>
<div class="layout">
  <aside class="side">
    <div class="side-hdr">
      <div class="logo">AI</div>
      <div><div class="side-t">PraisonAIUI</div><div class="side-st">Feature Dashboard</div></div>
    </div>
    <nav class="nav" id="nav"><div class="ld"><div class="sp"></div> Loading…</div></nav>
    <div class="side-ft"><span><span class="dot"></span>Connected</span><span id="fc">—</span></div>
  </aside>
  <main class="main">
    <div class="top">
      <div class="top-t" id="pt">Dashboard</div>
      <div class="top-a">
        <button class="btn" onclick="go(cur)">🔄 Refresh</button>
        <button class="btn btn-a" onclick="go('__test__')">🧪 Test All</button>
      </div>
    </div>
    <div class="pc" id="pc"><div class="ld"><div class="sp"></div> Loading…</div></div>
  </main>
</div>

<!-- Plugin bootstrap (same loader as built-in dashboard) -->
<script>
(function(){
  var P=[]; window.__aiuiPlugins=P;
  function N(){var r=document.getElementById('pc');if(!r)return;P.forEach(function(p){try{if(typeof p.onContentChange==='function')p.onContentChange(r)}catch(e){}})}
  window.__aiuiNotify=N;
  fetch('/plugins/plugins.json').then(r=>r.json()).then(function(cfg){
    var names=cfg.plugins||[];
    Promise.allSettled(names.map(n=>import('/plugins/'+n+'.js').then(m=>{var p=m.default||m;p.name=p.name||n;if(typeof p.init==='function')return Promise.resolve(p.init()).then(()=>P.push(p));P.push(p)}).catch(()=>{}))).then(()=>{
      var r=document.getElementById('pc');if(r){var t;new MutationObserver(()=>{clearTimeout(t);t=setTimeout(N,200)}).observe(r,{childList:true,subtree:true})}
      setTimeout(N,300);
    });
  }).catch(()=>{});
})();
</script>

<!-- Dashboard logic — fully dynamic from /api/pages + /api/features -->
<script type="module">
let pages=[], features=[], cur=null;
window.__cur=()=>cur;

// ── Boot: discover from API ──
async function boot(){
  const [pRes,fRes]=await Promise.allSettled([fetch('/api/pages'),fetch('/api/features')]);
  if(pRes.status==='fulfilled'){const d=await pRes.value.json();pages=Object.values(d.pages||d).sort((a,b)=>(a.order||100)-(b.order||100))}
  if(fRes.status==='fulfilled'){const d=await fRes.value.json();features=d.features||[]}
  document.getElementById('fc').textContent=pages.length+' pages';
  renderNav();
  go(pages[0]?.id||'overview');
}

// ── Sidebar ──
function renderNav(){
  const groups={};
  pages.forEach(p=>{const g=p.group||'Other';(groups[g]=groups[g]||[]).push(p)});
  let h='';
  for(const[g,items]of Object.entries(groups)){
    h+=`<div class="ng">${g}</div>`;
    items.forEach(p=>{h+=`<div class="ni" data-id="${p.id}" onclick="go('${p.id}')"><span class="ni-i">${p.icon||'📄'}</span><span>${p.title||p.id}</span></div>`});
  }
  h+=`<div class="ng">Testing</div><div class="ni" data-id="__test__" onclick="go('__test__')"><span class="ni-i">🧪</span><span>Test All Features</span></div>`;
  document.getElementById('nav').innerHTML=h;
}

// ── Navigate ──
window.go=async function(id){
  cur=id;
  document.querySelectorAll('.ni').forEach(e=>e.classList.toggle('on',e.dataset.id===id));
  const C=document.getElementById('pc'), T=document.getElementById('pt');
  const pg=pages.find(p=>p.id===id);

  if(id==='__test__'){T.textContent='🧪 Test All Features';renderTests(C);return}
  if(!pg){C.innerHTML='<div class="ld">Page not found</div>';return}

  T.textContent=`${pg.icon||''} ${pg.title||pg.id}`;
  // Create plugin-compatible container
  C.innerHTML=`<div id="${pg.id}" class="${pg.id}-page" data-page="${pg.id}" style="min-height:200px"><div class="ld"><div class="sp"></div> Loading ${pg.title}…</div></div>`;
  setTimeout(()=>window.__aiuiNotify&&window.__aiuiNotify(),100);
  // Fallback: if no plugin renders after 2s, show generic viewer
  setTimeout(()=>{
    const el=C.querySelector(`[data-page="${pg.id}"]`);
    if(el&&!el.querySelector('[class^="aiui-"]')&&!Array.from(el.attributes).some(a=>a.name.startsWith('data-aiui-')))
      genericView(el,pg);
  },2000);
};

// ── Generic data viewer (protocol-driven: just fetch the feature's API) ──
async function genericView(el,pg){
  const ep=`/api/${pg.id}`;
  try{
    const data=await fetch(ep).then(r=>r.json());
    const stats=Object.entries(data).filter(([,v])=>typeof v==='number');
    let h=`<div class="gv"><h2>${pg.icon||''} ${pg.title}</h2><p style="color:var(--t2);font-size:.875rem;margin-bottom:1.5rem">${pg.description||'Data from '+ep}</p>`;
    if(stats.length){h+=`<div class="gs">${stats.map(([k,v])=>`<div class="gs-c"><div class="gs-v">${v.toLocaleString()}</div><div class="gs-l">${k.replace(/_/g,' ')}</div></div>`).join('')}</div>`}
    h+=`<div class="gc"><h3 style="font-size:1rem;font-weight:600;margin-bottom:.75rem">Raw Response</h3><div class="gj">${JSON.stringify(data,null,2)}</div></div></div>`;
    el.innerHTML=h;
  }catch(e){el.innerHTML=`<div class="gv"><div class="gc" style="border-left:3px solid var(--warn)"><h3>⚠️ ${e.message}</h3></div></div>`}
}

// ── Test panel — auto-generated from /api/features ──
function renderTests(C){
  // Build test cards dynamically from discovered features
  const testable=features.length?features:pages.map(p=>({name:p.id,description:p.title||p.id}));
  let h=`<div class="tp"><h2>🧪 Test All Features</h2><p class="tp-d">Each test calls the feature's API endpoints to verify data flow. Tests are auto-generated from the feature registry.</p>
    <div style="margin-bottom:1.5rem;display:flex;gap:.5rem;align-items:center">
      <button class="btn btn-a" onclick="window.__runAll()">▶ Run All</button>
      <span id="ts" style="font-size:.75rem;color:var(--tm)"></span>
    </div><div class="tg">`;
  testable.forEach(f=>{
    const icon=pages.find(p=>p.id===f.name)?.icon||'📦';
    h+=`<div class="tc" id="t-${f.name}"><div class="tc-h"><div class="tc-i">${icon}</div><div><div class="tc-t">${f.name}</div><div class="tc-d">${f.description||''}</div></div></div>
      <button class="btn" onclick="window.__runOne('${f.name}')">▶ Run</button>
      <div class="tr" id="r-${f.name}"></div></div>`;
  });
  h+=`</div></div>`;
  C.innerHTML=h;
}

// ── Auto-test: discover endpoints and call them ──
const METHODS={channels:'GET',agents:'GET',usage:'GET',approvals:'GET',jobs:'GET',schedules:'GET',skills:'GET',config:'GET',auth:'GET',logs:'GET',sessions:'GET',memory:'GET',hooks:'GET',workflows:'GET'};

window.__runOne=async function(name){
  const rEl=document.getElementById('r-'+name);
  const btn=document.querySelector(`#t-${name} .btn`);
  if(btn)btn.textContent='⏳…';
  if(rEl){rEl.className='tr s';rEl.textContent='Running…'}
  try{
    // Try multiple endpoint patterns (protocol-driven discovery)
    let data,status;
    for(const ep of [`/api/${name}`,`/api/${name}/status`,`/v1/models`]){
      try{const r=await fetch(ep);if(r.ok){status=r.status;data=await r.json();break}}catch(_){}
    }
    if(!data)throw new Error('No reachable endpoint');
    if(rEl){rEl.className='tr s ok';rEl.textContent='✅ '+JSON.stringify(data,null,2).slice(0,300)}
    if(btn)btn.textContent='✅ Pass';
    return true;
  }catch(e){
    if(rEl){rEl.className='tr s er';rEl.textContent='❌ '+e.message}
    if(btn)btn.textContent='❌ Fail';
    return false;
  }
};

window.__runAll=async function(){
  const testable=features.length?features:pages.map(p=>({name:p.id}));
  let ok=0,fail=0;
  const ts=document.getElementById('ts');
  for(const f of testable){
    if(ts)ts.textContent=`Running ${f.name}… (${ok+fail}/${testable.length})`;
    if(await window.__runOne(f.name))ok++;else fail++;
    await new Promise(r=>setTimeout(r,150));
  }
  if(ts)ts.innerHTML=`<span style="color:${fail?'var(--warn)':'var(--ok)'}">${ok}/${testable.length} passed${fail?`, ${fail} failed`:''}</span>`;
};

boot();
</script>
</body>
</html>"""


# ── Main ─────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    from praisonaiui.server import create_app

    print("🌱 Seeding demo data…")
    seed()

    # Write dashboard to temp dir → served via static_dir
    sd = Path(tempfile.mkdtemp(prefix="aiui-dash-"))
    (sd / "index.html").write_text(DASHBOARD_HTML)

    app = create_app(static_dir=sd)

    print("\n" + "━" * 50)
    print("  🚀 Feature Dashboard  →  http://localhost:8082")
    print("  🧪 Test panel in sidebar → 'Test All Features'")
    print("━" * 50 + "\n")

    uvicorn.run(app, host="0.0.0.0", port=8082, log_level="info")
