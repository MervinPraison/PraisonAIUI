# What Makes PraisonAIUI Different

PraisonAIUI is a **protocol-driven UI framework** for building AI applications. This page explains how it differs from other popular tools.

## Quick Comparison

| Feature | PraisonAIUI | Streamlit | Gradio |
|---------|-------------|-----------|--------|
| **Architecture** | Protocol-driven (SDK→JSON→Client) | Script re-run | Input→Output |
| **UI Styles** | 6 (chat, agents, dashboard, playground, docs, custom) | 1 | 1 |
| **Components** | 48 structured | ~30 widgets | ~20 blocks |
| **Custom Pages** | `@aiui.page()` decorator | Multipage apps | Tabs |
| **Theme System** | 22 presets + custom CSS variables | Limited | Limited |
| **Agent-First** | ✅ Built for agents | ❌ General | ❌ ML demos |
| **Extensibility** | Plugin architecture | ❌ | ❌ |
| **YAML Config** | ✅ Full config | ❌ | ❌ |

---

## vs Streamlit

### How Streamlit Works

Streamlit re-runs your entire Python script on every interaction. The server renders HTML and sends it to the browser.

```python
# Streamlit
import streamlit as st

if st.button("Click me"):
    st.write("Clicked!")  # Entire script re-runs
```

### How PraisonAIUI Works

PraisonAIUI uses a **protocol-driven architecture**. Python functions return JSON dicts, which the client renders independently.

```python
# PraisonAIUI
import praisonaiui as aiui

@aiui.page("dashboard")
async def dashboard():
    return aiui.layout([
        aiui.card("Users", value=42),  # Returns JSON, client renders
    ])
```

### Key Differences

| Aspect | PraisonAIUI | Streamlit |
|--------|-------------|-----------|
| **Rendering** | Client-side from JSON | Server-side HTML |
| **State** | WebSocket + sessions | Script re-run |
| **Chat** | Real-time WebSocket streaming | Polling |
| **Extensibility** | `window.aiui.registerView()` | Limited |

**When to use PraisonAIUI**: Real-time chat, agent dashboards, multi-page admin panels, custom themes.

**When to use Streamlit**: Quick data apps, ML prototypes, simple dashboards.

---

## vs Gradio

### How Gradio Works

Gradio is designed for ML demos with an **input→output paradigm**. You define inputs, a function, and outputs.

```python
# Gradio
import gradio as gr

def greet(name):
    return f"Hello {name}!"

gr.Interface(fn=greet, inputs="text", outputs="text").launch()
```

### How PraisonAIUI Works

PraisonAIUI is designed for **conversational AI** with callbacks and structured components.

```python
# PraisonAIUI
import praisonaiui as aiui

@aiui.reply
async def on_message(message):
    await aiui.say(f"Hello {message.content}!")
```

### Key Differences

| Aspect | PraisonAIUI | Gradio |
|--------|-------------|--------|
| **Paradigm** | Conversational callbacks | Input→Output |
| **Components** | 48 structured (cards, tables, charts) | ~20 blocks |
| **Dashboard** | Full admin panel with pages | Tabs only |
| **Agent Support** | Built-in profiles, tools, memory | Manual |

**When to use PraisonAIUI**: Chat agents, admin dashboards, multi-agent systems.

**When to use Gradio**: ML model demos, quick input/output interfaces.

---

## Unique to PraisonAIUI

### 1. Protocol-Driven Architecture

Every feature implements a `FeatureProtocol` ABC with SDK-first fallback:

```
FeatureProtocol (ABC)
  ├── SDKFeatureManager  ← wraps praisonaiagents SDK
  └── SimpleFeatureManager  ← in-memory fallback
```

### 2. 48 Structured Components

Python functions return JSON dicts that the client renders:

```python
aiui.card("Revenue", value="$1,500", footer="+8%")
# → {"type": "card", "title": "Revenue", "value": "$1,500", "footer": "+8%"}
```

Components include: cards, tables, charts, forms, alerts, badges, tabs, accordions, and more.

### 3. 6 UI Styles

| Style | Use Case |
|-------|----------|
| `chat` | Conversational AI |
| `agents` | Multi-agent playground |
| `playground` | Prompt testing |
| `dashboard` | Admin panels |
| `docs` | Documentation sites |
| `custom` | Full control |

### 4. Client-Driven Plugin Architecture

Extend the dashboard with custom views:

```javascript
window.aiui.registerView('my-page', async (container) => {
    container.innerHTML = '<h1>Custom Page</h1>';
});
```

### 5. Theme System

22 Tailwind presets + custom CSS variables + dark/light mode:

```python
aiui.set_theme(preset="blue", dark_mode=True, radius="lg")
aiui.set_custom_css(":root { --db-accent: #22c55e; }")
aiui.register_theme("ocean", {"accent": "#0077b6"})
```

### 6. YAML + Python Dual Config

Same features configurable either way:

```yaml
# YAML
site:
  theme:
    preset: blue
    darkMode: true
```

```python
# Python
aiui.set_theme(preset="blue", dark_mode=True)
```

---

## When to Choose PraisonAIUI

✅ **Choose PraisonAIUI when you need:**

- Real-time chat with WebSocket streaming
- Multi-agent systems with profile switching
- Admin dashboards with custom pages
- 48 structured UI components
- Extensible plugin architecture
- YAML-driven configuration
- Custom themes with CSS variables
- Documentation sites

❌ **Consider alternatives when you need:**

- Quick ML model demos → Gradio
- Simple data dashboards → Streamlit

---

## Related Pages

- [UI Styles](styles.md) — The 6 UI styles
- [CSS Architecture](css-architecture.md) — Theme system deep dive
- [Component API](../api/components.md) — All 48 components
- [Dashboard](dashboard.md) — Custom pages with `@aiui.page()`
