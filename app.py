import praisonaiui as aiui

@aiui.reply
async def handle(msg):
    return msg.reply(f"Echo: {msg.text}")
