"""Example 19: Email Bot — Deploy an AI agent to your mailbox.

Unique Concept: Email as a messaging platform — IMAP polling + SMTP replies.

This example demonstrates how to use the EmailBot from the praisonai SDK
to monitor an inbox and respond to emails using an AI agent.

Features:
    • EmailBot with IMAP polling (configurable interval)
    • SMTP reply with proper thread headers (In-Reply-To, References)
    • Auto-reply detection (prevents infinite loops)
    • Custom subject-based commands (@bot.on_command)
    • BotSessionManager for per-sender conversation history
    • BotConfig for sender allowlists and rate limiting

Requires:
    pip install praisonai[email] praisonaiagents
    export OPENAI_API_KEY=sk-...
    export EMAIL_ADDRESS=support@example.com
    export EMAIL_APP_PASSWORD=your_16_char_app_password

    Optional:
    export EMAIL_IMAP_SERVER=imap.gmail.com   (default)
    export EMAIL_SMTP_SERVER=smtp.gmail.com   (default)

Run:
    python app.py              # Start email bot
    python app.py --probe      # Test connectivity only
"""

import asyncio
import os
import sys

# ── Check prerequisites ─────────────────────────────────────────────

try:
    from praisonai.bots import Bot, EmailBot
    from praisonaiagents import Agent, BotConfig
    SDK_OK = True
except ImportError:
    SDK_OK = False
    print("⚠️  Missing dependencies. Install with:")
    print("   pip install praisonai[email] praisonaiagents")
    sys.exit(1)


# ── Agent setup ─────────────────────────────────────────────────────

agent = Agent(
    name="email_assistant",
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
    """Start email bot with automatic env var resolution."""
    bot = Bot("email", agent=agent)
    print(f"📧 Starting email bot for: {os.getenv('EMAIL_ADDRESS', '(not set)')}")
    print("   Listening for new emails... (Ctrl+C to stop)")
    await bot.start()


# ── Approach 2: Direct EmailBot with config + handlers ──────────────

async def run_with_handlers():
    """Start email bot with custom handlers and configuration."""
    config = BotConfig(
        polling_interval=30.0,
        max_message_length=10000,
        session_ttl=86400,             # 24h session TTL
        allowed_users=[],              # Empty = allow all senders
        metadata={"imap_folder": "INBOX"},
    )

    bot = EmailBot(
        token=os.environ.get("EMAIL_APP_PASSWORD", ""),
        agent=agent,
        config=config,
        email_address=os.environ.get("EMAIL_ADDRESS", ""),
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
                    f"🤖 Email Bot Status\n\n"
                    f"• Running: {bot.is_running}\n"
                    f"• Emails processed: {bot._emails_processed}\n"
                    f"• Platform: {bot.platform}\n"
                    f"• Email: {bot._email_address}\n"
                ),
            },
            reply_to=message.message_id,
        )

    print(f"📧 Starting email bot with custom handlers")
    print(f"   Email: {bot._email_address}")
    print(f"   Poll interval: {config.polling_interval}s")
    print(f"   Allowed senders: {'all' if not config.allowed_users else config.allowed_users}")
    print("   Listening... (Ctrl+C to stop)")
    await bot.start()


# ── Probe: Test connectivity without starting ───────────────────────

async def run_probe():
    """Test email server connectivity."""
    bot = Bot("email", agent=agent)
    print("🔍 Testing email server connectivity...")
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
    else:
        asyncio.run(run_simple())
