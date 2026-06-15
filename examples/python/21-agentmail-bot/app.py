"""Example 21: AgentMail Bot — API-first email with programmatic inboxes.

Unique Concept: Agent-native email — no IMAP/SMTP, just API calls.

Unlike the traditional EmailBot (Example 19) which uses IMAP polling + SMTP
replies, AgentMailBot uses the AgentMail API for zero-config email. Inboxes
are created programmatically and messages flow through the API.

Features:
    • Bot("agentmail") wrapper — 3 lines to start
    • Direct AgentMailBot with custom handlers and inbox lifecycle
    • Programmatic inbox creation / listing / deletion
    • Probe + health checks
    • API-based polling (no IMAP/SMTP servers needed)

Requires:
    pip install praisonai agentmail praisonaiagents
    export OPENAI_API_KEY=sk-...
    export AGENTMAIL_API_KEY=am_...

    Optional:
    export AGENTMAIL_INBOX_ID=inbox_...     (reuse existing inbox)
    export AGENTMAIL_DOMAIN=mycompany.com   (custom domain for new inboxes)

Run:
    python app.py              # Start agentmail bot
    python app.py --probe      # Test API connectivity only
    python app.py --handlers   # With custom command handlers
    python app.py --inbox      # Demo inbox lifecycle
"""

import asyncio
import os
import sys

# ── Check prerequisites ─────────────────────────────────────────────

try:
    from praisonai.bots import Bot, AgentMailBot
    from praisonaiagents import Agent
    SDK_OK = True
except ImportError:
    SDK_OK = False
    print("⚠️  Missing dependencies. Install with:")
    print("   pip install praisonai agentmail praisonaiagents")
    sys.exit(1)


# ── Agent setup ─────────────────────────────────────────────────────

agent = Agent(
    name="agentmail_assistant",
    instructions="""You are a professional email support assistant.

    Guidelines:
    - Read the email carefully and understand the request
    - Reply concisely and professionally
    - Use proper email etiquette (greeting, body, sign-off)
    - If the question is unclear, ask for clarification
    - Keep replies under 300 words
    - Sign off as "AI Assistant"
    """,
    llm="gpt-4o-mini",
)


# ── Approach 1: Bot() wrapper (simplest) ────────────────────────────

async def run_simple():
    """Start agentmail bot with automatic env var resolution."""
    bot = Bot("agentmail", agent=agent)
    print(f"📩 Starting AgentMail bot")
    print(f"   API key: {'✅ set' if os.getenv('AGENTMAIL_API_KEY') else '❌ not set'}")
    print("   Listening for new emails... (Ctrl+C to stop)")
    await bot.start()


# ── Approach 2: Direct AgentMailBot with handlers ───────────────────

async def run_with_handlers():
    """Start agentmail bot with custom handlers."""
    from praisonaiagents.bots import BotConfig

    config = BotConfig(
        polling_interval=15.0,
        max_message_length=10000,
        session_ttl=86400,
    )

    bot = AgentMailBot(
        token=os.environ.get("AGENTMAIL_API_KEY", ""),
        agent=agent,
        config=config,
        inbox_id=os.environ.get("AGENTMAIL_INBOX_ID"),
        domain=os.environ.get("AGENTMAIL_DOMAIN"),
    )

    # Log every incoming email
    @bot.on_message
    async def log_email(message):
        subject = message.metadata.get("subject", "(no subject)")
        print(f"📨 From: {message.sender.username}")
        print(f"   Subject: {subject}")
        print(f"   Preview: {message.text[:100]}...")

    # Custom command: emails with subject starting with "/status"
    @bot.on_command("status")
    async def handle_status(message):
        await bot.send_message(
            channel_id=message.sender.user_id,
            content={
                "subject": "Re: Bot Status Report",
                "body": (
                    f"🤖 AgentMail Bot Status\n\n"
                    f"• Running: {bot.is_running}\n"
                    f"• Platform: {bot.platform}\n"
                    f"• Email: {bot.email_address}\n"
                    f"• Emails processed: {bot._emails_processed}\n"
                ),
            },
            reply_to=message.message_id,
        )

    print(f"📩 Starting AgentMail bot with custom handlers")
    print(f"   Email: {bot.email_address or '(will be assigned on start)'}")
    print(f"   Poll interval: {config.polling_interval}s")
    print("   Listening... (Ctrl+C to stop)")
    await bot.start()


# ── Inbox lifecycle demo ────────────────────────────────────────────

async def run_inbox_demo():
    """Demonstrate programmatic inbox management."""
    bot = AgentMailBot(
        token=os.environ.get("AGENTMAIL_API_KEY", ""),
    )

    print("📩 AgentMail Inbox Lifecycle Demo")
    print("=" * 50)

    # Create inbox
    print("\n1. Creating inbox...")
    inbox = await bot.create_inbox(domain=os.getenv("AGENTMAIL_DOMAIN"))
    print(f"   ✅ Created: {inbox.get('email_address', 'unknown')}")
    print(f"   ID: {inbox.get('id', 'unknown')}")

    # List inboxes
    print("\n2. Listing inboxes...")
    inboxes = await bot.list_inboxes()
    print(f"   Found: {len(inboxes)} inbox(es)")
    for ib in inboxes:
        print(f"      📧 {ib.get('email_address', '?')} (id: {ib.get('id', '?')})")

    # Delete inbox
    inbox_id = inbox.get("id", "")
    if inbox_id:
        print(f"\n3. Deleting inbox {inbox_id}...")
        deleted = await bot.delete_inbox(inbox_id)
        print(f"   {'✅ Deleted' if deleted else '❌ Failed to delete'}")

    print("\n✅ Inbox lifecycle complete")


# ── Probe: Test connectivity ────────────────────────────────────────

async def run_probe():
    """Test AgentMail API connectivity."""
    bot = Bot("agentmail", agent=agent)
    print("🔍 Testing AgentMail API connectivity...")
    result = await bot.probe()

    print(f"\n   Connection: {'✅ OK' if result.ok else '❌ FAILED'}")
    print(f"   Platform:   {result.platform}")
    if result.bot_username:
        print(f"   Email:      {result.bot_username}")
    if result.elapsed_ms:
        print(f"   Latency:    {result.elapsed_ms:.0f}ms")
    if result.error:
        print(f"   Error:      {result.error}")


# ── Main ────────────────────────────────────────────────────────────

if __name__ == "__main__":
    if "--probe" in sys.argv:
        asyncio.run(run_probe())
    elif "--handlers" in sys.argv:
        asyncio.run(run_with_handlers())
    elif "--inbox" in sys.argv:
        asyncio.run(run_inbox_demo())
    else:
        asyncio.run(run_simple())
