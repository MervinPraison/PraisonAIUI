"""Starter app.py templates for ``aiui init --template <name>``."""

from __future__ import annotations

AGENT_TEMPLATE = '''"""Minimal PraisonAIUI agent app — run with: aiui run app.py"""

import praisonaiui as aiui


@aiui.starters
def starters():
    return [
        {"label": "Show metrics", "message": "Show me live agent metrics"},
        {"label": "Summarize text", "message": "Summarize what PraisonAIUI can build"},
    ]


@aiui.reply
async def on_message(message: str):
    await aiui.say(f"You asked: **{message}**")
    # Render any of the 81 UI blocks inline inside chat:
    await aiui.send_block(
        aiui.columns([
            aiui.metric("Status", value="Online", delta="Ready"),
            aiui.metric("Blocks", value=81, delta="Zero JS"),
        ])
    )
'''

OPENAI_TEMPLATE = '''"""OpenAI streaming agent UI — pip install openai && export OPENAI_API_KEY=..."""

import os
from openai import AsyncOpenAI
import praisonaiui as aiui

client = AsyncOpenAI(api_key=os.environ.get("OPENAI_API_KEY"))


@aiui.reply
async def on_message(message: str):
    stream = await client.chat.completions.create(
        model=os.environ.get("OPENAI_MODEL", "gpt-4o-mini"),
        messages=[{"role": "user", "content": message}],
        stream=True,
    )
    async for chunk in stream:
        token = chunk.choices[0].delta.content if chunk.choices else None
        if token:
            await aiui.stream_token(token)
'''

ANTHROPIC_TEMPLATE = '''"""Anthropic Claude streaming agent UI — pip install anthropic && export ANTHROPIC_API_KEY=..."""

import os
import anthropic
import praisonaiui as aiui

client = anthropic.AsyncAnthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))


@aiui.reply
async def on_message(message: str):
    async with client.messages.stream(
        model=os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-20250514"),
        max_tokens=1024,
        messages=[{"role": "user", "content": message}],
    ) as stream:
        async for text in stream.text_stream:
            await aiui.stream_token(text)
'''

LANGGRAPH_TEMPLATE = '''"""LangGraph agent UI — pip install langgraph langchain-openai"""

from langchain_core.messages import HumanMessage
from langgraph.prebuilt import create_react_agent
import praisonaiui as aiui

graph = create_react_agent("openai:gpt-4o-mini", tools=[])


@aiui.reply
async def on_message(message: str):
    async for event in graph.astream_events(
        {"messages": [HumanMessage(content=message)]}, version="v2"
    ):
        if event["event"] == "on_chat_model_stream":
            chunk = event["data"]["chunk"].content
            if chunk:
                await aiui.stream_token(str(chunk))
'''

CREWAI_TEMPLATE = '''"""CrewAI agent UI — pip install crewai"""

import asyncio
from crewai import Agent, Crew, Task
import praisonaiui as aiui


@aiui.reply
async def on_message(message: str):
    await aiui.think("Running CrewAI researcher...")
    researcher = Agent(
        role="Researcher",
        goal="Give concise, accurate answers",
        backstory="Expert technical analyst",
    )
    task = Task(description=message, expected_output="Clear markdown answer", agent=researcher)
    result = await asyncio.to_thread(Crew(agents=[researcher], tasks=[task]).kickoff)
    await aiui.say(str(result))
'''

PYDANTIC_AI_TEMPLATE = '''"""PydanticAI agent UI — pip install pydantic-ai"""

from pydantic_ai import Agent
import praisonaiui as aiui

agent = Agent("openai:gpt-4o-mini", instructions="Be concise and helpful.")


@aiui.reply
async def on_message(message: str):
    async with agent.run_stream(message) as result:
        async for chunk in result.stream_text(delta=True):
            await aiui.stream_token(chunk)
'''

PRAISONAI_TEMPLATE = '''"""PraisonAI agent UI — pip install praisonaiagents"""

from praisonaiagents import Agent
import praisonaiui as aiui

agent = Agent(
    name="Assistant",
    instructions="You are a helpful AI assistant.",
    llm="gpt-4o-mini",
)


@aiui.reply
async def on_message(message: str):
    response = await agent.achat(message)
    await aiui.say(str(response))
'''

DASHBOARD_TEMPLATE = '''"""Split-pane Agent + Dashboard app — run with: aiui run app.py"""

import praisonaiui as aiui


@aiui.reply
async def on_message(message: str):
    await aiui.say(f"Analyzing: **{message}**")
    await aiui.send_block(
        aiui.table([{"Metric": "Latency", "Value": "42 ms"}, {"Metric": "Status", "Value": "Healthy"}])
    )


@aiui.page("workspace", title="Workspace", icon="layout-dashboard", group="App", order=1)
async def workspace():
    return aiui.layout([
        aiui.columns([
            aiui.container([
                aiui.metric("Active Runs", value=12, delta="+3"),
                aiui.chart(
                    "Requests",
                    chart_type="bar",
                    data=[{"day": "Mon", "reqs": 120}, {"day": "Tue", "reqs": 180}, {"day": "Wed", "reqs": 165}],
                    x="day",
                    y="reqs",
                ),
            ]),
            aiui.chat_panel(title="Workspace Assistant", height=460),
        ])
    ])


def summarize_file(doc):
    if not doc:
        return "Upload a text or CSV file to inspect it."
    with open(doc["path"], "r", encoding="utf-8", errors="replace") as f:
        preview = f.read(1200)
    return f"### `{doc['filename']}` ({doc['size']} bytes)\\n\\n```\\n{preview}\\n```"


aiui.interface(
    summarize_file,
    inputs=[aiui.file_upload("Drop a file", name="doc", accept=".txt,.csv,.md,.json")],
    title="File Inspector",
    group="App",
    order=2,
)
'''

APP_TEMPLATES: dict[str, str] = {
    "agent": AGENT_TEMPLATE,
    "openai": OPENAI_TEMPLATE,
    "anthropic": ANTHROPIC_TEMPLATE,
    "langgraph": LANGGRAPH_TEMPLATE,
    "crewai": CREWAI_TEMPLATE,
    "pydantic-ai": PYDANTIC_AI_TEMPLATE,
    "praisonai": PRAISONAI_TEMPLATE,
    "dashboard": DASHBOARD_TEMPLATE,
}

DOCS_TEMPLATES: tuple[str, ...] = ("minimal", "docs", "marketing")
