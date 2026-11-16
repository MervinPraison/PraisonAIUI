# Steps / Chain-of-Thought

`aiui.Step` wraps a piece of work (a tool call, a reasoning pass, a sub-agent)
in a named step with streamed content, nesting and timing.

!!! warning "Steps from `@aiui.reply` do not render yet"
    On the current release the chat's WebSocket path forwards the
    `reasoning_started`, `reasoning_step` and `reasoning_completed` events of an
    `aiui.Step` as empty content events, so the step name and its streamed text
    do not reach the browser. Until that is fixed, send reasoning text with
    `await aiui.think("...")`, which arrives as a `reasoning_step` event and is
    shown in the chat's thinking area. Agent runs through the PraisonAI provider
    show their own reasoning and tool calls.

## Basic Usage

```python
import praisonaiui as aiui

@aiui.reply
async def agent_response(message):
    # Tool call step
    async with aiui.Step(name="🔧 Tool: web_search", type="tool_call") as step:
        await step.stream_token("Input: { query: 'rust async ecosystem 2026' }")
        # ... perform actual tool call
        await step.stream_token("Output: [ 10 search results ]")
    
    # Reasoning step  
    async with aiui.Step(name="🧠 Reasoning: Synthesizing results", type="reasoning") as step:
        await step.stream_token("I see three major async runtimes...")

    # The reply itself: a callback's return value is not sent
    await aiui.say("Rust's async ecosystem in 2026 is dominated by...")
```

## Nested Steps

Steps can be nested to show hierarchical reasoning:

```python
async with aiui.Step(name="Multi-agent research", type="reasoning") as parent:
    await parent.stream_token("Starting research task...")
    
    # Sub-agent step
    async with aiui.Step(name="🤖 Sub-agent: Technical Analysis", type="sub_agent", parent=parent) as sub:
        await sub.stream_token("Analyzing technical details...")
        
        # Tool called by sub-agent
        async with aiui.Step(name="🔧 Tool: code_search", type="tool_call", parent=sub) as tool:
            await tool.stream_token("Searching codebase...")
```

## Step Types

Common step patterns:

```python
# Tool calls
async with aiui.Step(name="🔧 Tool: database_query", type="tool_call") as step:
    await step.stream_token("Querying user database...")

# Reasoning/thinking  
async with aiui.Step(name="🧠 Reasoning: Plan evaluation", type="reasoning") as step:
    await step.stream_token("Evaluating different approaches...")

# Sub-agents
async with aiui.Step(name="🤖 Sub-agent: Code reviewer", type="sub_agent") as step:
    await step.stream_token("Reviewing code quality...")

# Retrieval
async with aiui.Step(name="📚 Retrieval: Knowledge search", type="retrieval") as step:
    await step.stream_token("Searching knowledge base...")

# Custom
async with aiui.Step(name="⚡ Custom: Data processing", type="custom") as step:
    await step.stream_token("Processing large dataset...")
```

## API Reference

### `aiui.Step(name, type="reasoning", parent=None, metadata={})`

**Parameters:**
- `name` (str): Display name for the step
- `type` (StepType, optional): Step type - one of `"tool_call"`, `"reasoning"`, `"sub_agent"`, `"retrieval"`, `"custom"` (default: `"reasoning"`)
- `parent` (Step, optional): Parent step for nesting
- `metadata` (dict, optional): Additional step metadata

**Methods:**
- `async stream_token(token)`: Stream content to the step
- Context manager protocol: `async with step: ...`

### `@aiui.step(name, type="reasoning", **metadata)`

**Decorator Parameters:**
- `name` (str): Display name for the step
- `type` (StepType, optional): Step type (default: `"reasoning"`)
- `**metadata`: Additional metadata to include with the step

**Usage:**
```python
@aiui.step("🔧 Tool: web_search", type="tool_call")
async def web_search(query: str):
    # Function will be wrapped in Step context
    result = await search_web(query)
    return result
```

### Events

A step puts these events on the reply's stream; each carries `step_id`,
`name` (start and end) and `step_type`:

- `reasoning_started`: the step begins (`parent_id`, `metadata`)
- `reasoning_step`: streamed content (`step`)
- `reasoning_completed`: the step ends (`duration` in seconds, `error` if the
  block raised, `metadata`)

A step created outside a reply callback has no stream and emits nothing.
