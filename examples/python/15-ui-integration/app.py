"""UI Integration — PraisonAIUI alongside Gradio and Streamlit.

What's New (vs widget/):
    • Mount PraisonAIUI as a Starlette sub-app inside another framework
    • Side-by-side with Gradio (ASGI mount)
    • Streamlit-compatible via iframe embedding pattern
    • Shows how to add AI chat to any existing web UI

Requires: pip install praisonaiui gradio
Optional: pip install streamlit (for the Streamlit pattern)

Run:
    python app.py
    # Landing page at http://localhost:8082
    # Or with Gradio: python app.py --gradio
"""

import os
import sys

# Use shared seed data helper
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from _shared.seed_data import seed_demo_data


# ── Pattern 1: Gradio + PraisonAIUI (ASGI mount) ────────────────────

def run_with_gradio():
    """Mount PraisonAIUI as a sub-app inside Gradio's FastAPI server."""
    import gradio as gr
    from praisonaiui.server import create_app

    aiui_app = create_app()
    seed_demo_data()

    with gr.Blocks(title="AI Agent Dashboard", theme=gr.themes.Soft()) as demo:
        gr.Markdown("# 🤖 AI Agent Dashboard")
        gr.Markdown("PraisonAIUI is mounted at `/aiui/` — try the API endpoints below.")

        with gr.Row():
            with gr.Column(scale=2):
                chatbot = gr.Chatbot(label="Agent Chat", height=400)
                msg = gr.Textbox(label="Message", placeholder="Ask the agent anything...")
                send_btn = gr.Button("Send", variant="primary")
            with gr.Column(scale=1):
                gr.Markdown("### Quick Links\n- [Features](/aiui/api/features)\n- [Channels](/aiui/api/channels)")
                status = gr.JSON(label="Server Status", value={"status": "ready"})
                refresh_btn = gr.Button("Refresh Status")

        def chat(message, history):
            history = history or []
            history.append((message, f"Echo: {message}"))
            return history, ""

        def get_status():
            import httpx
            try:
                return httpx.get("http://localhost:7860/aiui/health", timeout=2).json()
            except Exception:
                return {"status": "connecting..."}

        send_btn.click(chat, [msg, chatbot], [chatbot, msg])
        msg.submit(chat, [msg, chatbot], [chatbot, msg])
        refresh_btn.click(get_status, outputs=status)

    demo.launch(server_port=7860, prevent_thread_lock=True)
    gradio_app = demo.server.running_app
    gradio_app.mount("/aiui", aiui_app)

    print("\n✅ PraisonAIUI mounted at http://localhost:7860/aiui/")
    import time
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        pass


# ── Pattern 2: Standalone with HTML embedding page ───────────────────

LANDING_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>PraisonAIUI — UI Integration Demo</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: 'Inter', -apple-system, sans-serif; background: #0a0a0f; color: #e0e0e8; }
.header { background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
           padding: 2rem; border-bottom: 1px solid #2a2a4a; text-align: center; }
.header h1 { font-size: 2rem; background: linear-gradient(90deg, #7c3aed, #06b6d4);
              -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
.header p { color: #94a3b8; margin-top: 0.5rem; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
         gap: 1.5rem; padding: 2rem; max-width: 1200px; margin: 0 auto; }
.card { background: #12121f; border: 1px solid #2a2a4a; border-radius: 12px;
        padding: 1.5rem; transition: border-color 0.3s; }
.card:hover { border-color: #7c3aed; }
.card h3 { color: #c4b5fd; margin-bottom: 0.75rem; }
.card p { color: #94a3b8; font-size: 0.9rem; line-height: 1.6; }
.badge { display: inline-block; background: #7c3aed22; color: #c4b5fd;
         padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; margin-bottom: 0.5rem; }
pre { background: #1a1a2e; padding: 1rem; border-radius: 8px; overflow-x: auto;
      font-size: 0.85rem; margin-top: 1rem; color: #a5b4fc; }
.live-data { background: #0d1117; border: 1px solid #2a2a4a; border-radius: 8px;
             padding: 1rem; margin-top: 1rem; font-family: monospace; font-size: 0.8rem;
             max-height: 200px; overflow-y: auto; color: #06b6d4; }
</style>
</head>
<body>
<div class="header">
    <h1>🔌 PraisonAIUI — UI Integration Demo</h1>
    <p>Embed AI agent APIs into Gradio, Streamlit, or any web framework</p>
</div>
<div class="grid">
    <div class="card">
        <span class="badge">Pattern 1</span>
        <h3>🟣 Gradio Integration</h3>
        <p>Mount PraisonAIUI as an ASGI sub-app inside Gradio's FastAPI server.</p>
        <pre>gradio_app.mount("/aiui", create_app())</pre>
        <p style="margin-top:0.75rem;font-size:0.85rem">Run: <code>python app.py --gradio</code></p>
    </div>
    <div class="card">
        <span class="badge">Pattern 2</span>
        <h3>🟠 Streamlit Integration</h3>
        <p>Run PraisonAIUI as a sidecar, embed via <code>st.components.iframe()</code>.</p>
        <pre>st.components.v1.iframe("http://localhost:8000/api/features", height=400)</pre>
    </div>
    <div class="card">
        <span class="badge">Pattern 3</span>
        <h3>🔵 REST API Embedding</h3>
        <p>Call PraisonAIUI endpoints from any frontend using fetch/axios.</p>
        <pre>fetch('/api/channels').then(r =&gt; r.json())</pre>
        <div class="live-data" id="live-features">Loading...</div>
    </div>
    <div class="card"><span class="badge">Live</span><h3>📡 Channels API</h3>
        <div class="live-data" id="live-channels">Loading...</div></div>
    <div class="card"><span class="badge">Live</span><h3>🖥️ Nodes API</h3>
        <div class="live-data" id="live-nodes">Loading...</div></div>
    <div class="card"><span class="badge">Live</span><h3>⏰ Schedules API</h3>
        <div class="live-data" id="live-schedules">Loading...</div></div>
</div>
<script>
async function loadData(url, id) {
    try { const d = await (await fetch(url)).json();
          document.getElementById(id).textContent = JSON.stringify(d, null, 2);
    } catch (e) { document.getElementById(id).textContent = 'Error: ' + e.message; }
}
loadData('/api/features', 'live-features');
loadData('/api/channels', 'live-channels');
loadData('/api/nodes', 'live-nodes');
loadData('/api/schedules', 'live-schedules');
</script>
</body>
</html>"""


def run_standalone():
    """Run PraisonAIUI with an HTML page showing integration patterns."""
    from praisonaiui.server import create_app
    from starlette.responses import HTMLResponse
    from starlette.routing import Route
    import uvicorn

    aiui_app = create_app()
    seed_demo_data()

    async def landing(request):
        return HTMLResponse(LANDING_HTML)

    aiui_app.routes.insert(0, Route("/", landing, methods=["GET"]))
    print("✅ UI Integration Demo at http://localhost:8082")
    uvicorn.run(aiui_app, host="0.0.0.0", port=8082, log_level="info")


if __name__ == "__main__":
    if "--gradio" in sys.argv:
        try:
            import gradio
            run_with_gradio()
        except ImportError:
            print("❌ Gradio not installed. Falling back to standalone...\n")
            run_standalone()
    else:
        run_standalone()
