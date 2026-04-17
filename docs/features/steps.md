# Steps / Chain-of-Thought

Visualize agent reasoning and tool calls as collapsible, nested steps in the chat interface.

## Basic Usage

```python
import praisonaiui as aiui

@aiui.reply
async def agent_response(message):
    # Tool call step
    async with aiui.Step(name="🔧 Tool: web_search") as step:
        await step.stream_token("Input: { query: 'rust async ecosystem 2026' }")
        # ... perform actual tool call
        await step.stream_token("Output: [ 10 search results ]")
    
    # Reasoning step
    async with aiui.Step(name="🧠 Reasoning: Synthesizing results") as step:
        await step.stream_token("I see three major async runtimes...")
    
    return "Rust's async ecosystem in 2026 is dominated by..."
```

## Nested Steps

Steps can be nested to show hierarchical reasoning:

```python
async with aiui.Step(name="Multi-agent research") as parent:
    await parent.stream_token("Starting research task...")
    
    # Sub-agent step
    async with aiui.Step(name="🤖 Sub-agent: Technical Analysis", parent=parent) as sub:
        await sub.stream_token("Analyzing technical details...")
        
        # Tool called by sub-agent
        async with aiui.Step(name="🔧 Tool: code_search", parent=sub) as tool:
            await tool.stream_token("Searching codebase...")
```

## Step Types

Common step patterns:

```python
# Tool calls
async with aiui.Step(name="🔧 Tool: database_query") as step:
    await step.stream_token("Querying user database...")

# Reasoning/thinking
async with aiui.Step(name="🧠 Reasoning: Plan evaluation") as step:
    await step.stream_token("Evaluating different approaches...")

# Sub-agents
async with aiui.Step(name="🤖 Sub-agent: Code reviewer") as step:
    await step.stream_token("Reviewing code quality...")

# Retrieval
async with aiui.Step(name="📚 Retrieval: Knowledge search") as step:
    await step.stream_token("Searching knowledge base...")

# Custom
async with aiui.Step(name="⚡ Custom: Data processing") as step:
    await step.stream_token("Processing large dataset...")
```

## Frontend Visualization

Steps appear in the chat as collapsible panels showing:

- **Icons** indicating step type (🔧 🧠 🤖 📚 ⚡)
- **Expandable content** with input/output details
- **Nested hierarchy** for complex reasoning chains
- **Real-time updates** as steps stream content

## API Reference

### `aiui.Step(name, parent=None, metadata={})`

**Parameters:**
- `name` (str): Display name for the step
- `parent` (Step, optional): Parent step for nesting
- `metadata` (dict, optional): Additional step metadata

**Methods:**
- `async stream_token(token)`: Stream content to the step
- Context manager protocol: `async with step: ...`

### Events Emitted

Steps emit these `RunEventType` events:
- `REASONING_STARTED`: Step begins
- `REASONING_STEP`: Content streamed 
- `REASONING_COMPLETED`: Step finishes

## Chainlit Migration

Direct replacement for `cl.Step`:

```python
# Chainlit
async with cl.Step(name="Tool call", type="tool") as step:
    step.input = {"query": "rust async"}
    # ... tool execution
    step.output = ["result1", "result2"]

# PraisonAIUI equivalent
async with aiui.Step(name="🔧 Tool call") as step:
    await step.stream_token("Input: { query: 'rust async' }")
    # ... tool execution  
    await step.stream_token("Output: ['result1', 'result2']")
```