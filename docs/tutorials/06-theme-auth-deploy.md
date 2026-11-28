# Step 6: Theme, Secure & Deploy Your App

> Add your brand theme, persistent storage, deny-by-default sign-in, health checks and production deployment.

Your app now streams AI replies, shows live tool steps, renders custom pages and pushes notifications. In this final step, you will brand it, persist conversations to disk, turn on sign-in and prepare it for real users.

**What's new in Step 6:** `aiui.configure()`, persistent datastores, sign-in auth, and `aiui doctor` / `aiui health`.

## Brand, secure and ship

1. **Configure branding, theme and persistent storage**

   Add one `aiui.configure(...)` call near the top of `app.py`:

   ```python title="app.py"
   aiui.configure(
       branding={"title": "Acme Assistant", "logo": "/static/logo.svg"},
       theme={"preset": "indigo", "dark": True, "radius": "md"},
       chat={"feedback": True, "file_upload": True},
       datastore="json",  # Saves sessions to ~/.praisonaiui/sessions/ (or use SQLAlchemyDataStore)
   )
   ```

   Focus the sidebar on just the pages you want users to see:

   ```python
   aiui.only_my_pages("chat")  # Shows Chat + your custom @aiui.page pages
   ```

2. **Turn on sign-in before exposing to the network**

   Never expose an unauthenticated AI app to the public internet. Set a password or configure auth in YAML so PraisonAIUI enforces deny-by-default authentication on every HTTP route and WebSocket:

   ```bash
   export AIUI_AUTH_PASSWORD="replace-with-a-strong-password"
   aiui run app.py --host 0.0.0.0 --port 8000
   ```

   For multi-user auth, OAuth, API tokens and reverse-proxy HTTPS headers (`X-Forwarded-Proto`, trusted hosts), follow [Deployment & security](https://ui.praison.ai/docs/features/deployment.md).

3. **Verify health and ship**

   While your app is running, run built-in diagnostics from another terminal:

   ```bash
   aiui doctor              # Checks config, ports, templates and runtime environment
   aiui health --detailed   # Verifies every mounted feature and datastore
   ```

   Want to publish user documentation alongside your app? Check out [Docs UI Overview](https://ui.praison.ai/docs/docs-ui/overview.md) and [Deploy to GitHub Pages](https://ui.praison.ai/docs/getting-started/github-pages.md).

## You made it! Where to go next

- [Agent UI Reference](https://ui.praison.ai/docs/chat-ui/overview.md)
  Dive deeper into attachments, voice, MCP tools and multi-agent trees.
- [App & Dashboard](https://ui.praison.ai/docs/app-ui/overview.md)
  Explore all 5 layouts, built-in dashboard pages and React plugins.
- [Docs UI](https://ui.praison.ai/docs/docs-ui/overview.md)
  Turn your team's Markdown into a fast, searchable documentation portal.
