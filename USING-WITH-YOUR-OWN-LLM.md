# Using the Handwrytten MCP Server with Your Own LLM (API Key Method)

So you're not using Claude.ai or Claude Desktop — you've got your own AI agent, your own app, Cursor, some LangChain thing you vibe-coded at 2am, whatever. You still want it to send real handwritten cards. This guide gets you there, step by step.

**The one thing to understand before anything else:**

> The hosted server at `https://mcp.handwrytten.com/mcp` is **OAuth only**. You cannot send it an API key. There is no header, no query param, no secret trick. If you want to use an API key, **you run the server yourself**. Don't worry — it's one command.

There are two ways to run it, depending on what your LLM setup looks like:

| Your situation | Use this |
|---|---|
| Your tool launches MCP servers as local programs (Cursor, Windsurf, Claude Desktop, OpenAI Agents SDK, most agent frameworks) | **Path A: stdio mode** (easiest) |
| Your tool/code connects to MCP servers by **URL** (Anthropic API MCP connector, HTTP-based clients, agents running on a different machine) | **Path B: self-hosted HTTP mode** |

Not sure? Start with Path A.

---

## Step 0: Get the two things you need

1. **Node.js 18 or newer.** Check with:
   ```bash
   node --version
   ```
   If that errors or says something like `v16.x`, install Node from [nodejs.org](https://nodejs.org) (grab the LTS version).

2. **A Handwrytten API key.**
   - Sign up at [handwrytten.com](https://www.handwrytten.com)
   - Get your key from the [API settings page](https://www.handwrytten.com/api/)
   - It's tied to your account and your card credits. **Treat it like a password.**

---

## Path A: stdio mode (your tool launches the server)

In this setup, your MCP client (Cursor, an agent framework, etc.) starts the server as a background program and talks to it over stdin/stdout. You never see it running. You just configure it once.

### Step 1: Install the server

```bash
npm install -g @handwrytten/mcp-server
```

This gives you a command called `handwrytten-mcp`. Verify it exists:

```bash
handwrytten-mcp --help
```

(It may just sit there waiting for input or complain about a missing API key — that's fine, it means it's installed. Ctrl+C to exit.)

### Step 2: Tell your MCP client about it

Almost every MCP client uses the same JSON shape. The magic words are: **command** = `handwrytten-mcp`, **env** = your API key.

**Cursor** — create/edit `.cursor/mcp.json` in your project (or `~/.cursor/mcp.json` for all projects):

```json
{
  "mcpServers": {
    "handwrytten": {
      "command": "handwrytten-mcp",
      "env": {
        "HANDWRYTTEN_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

**Windsurf** — same JSON, in `~/.codeium/windsurf/mcp_config.json`.

**VS Code (GitHub Copilot agent mode)** — `.vscode/mcp.json`:

```json
{
  "servers": {
    "handwrytten": {
      "command": "handwrytten-mcp",
      "env": {
        "HANDWRYTTEN_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

**Anything else** — look for "MCP servers" in its settings and give it:
- Command: `handwrytten-mcp`
- Environment variable: `HANDWRYTTEN_API_KEY` = your key

### Step 3: Restart your client and test

Restart the app so it picks up the config, then ask your AI:

> "What Handwrytten cards are available?"

If it lists cards, you're done. Go send a note:

> "Send a thank-you card to Jane Doe at 123 Main St, Phoenix, AZ 85001"

### Using it from your own agent code (stdio)

If you're writing your own agent instead of using an app, your framework almost certainly supports stdio MCP servers.

**OpenAI Agents SDK (Python):**

```python
from agents import Agent, Runner
from agents.mcp import MCPServerStdio

async def main():
    async with MCPServerStdio(
        params={
            "command": "handwrytten-mcp",
            "env": {"HANDWRYTTEN_API_KEY": "your_api_key_here"},
        }
    ) as hw_server:
        agent = Agent(
            name="Card Sender",
            instructions="You help send handwritten cards via Handwrytten.",
            mcp_servers=[hw_server],
        )
        result = await Runner.run(agent, "List available thank-you cards")
        print(result.final_output)
```

**Plain Python with the official `mcp` package** (works with any LLM — you feed the tools to whatever model you like):

```python
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

server = StdioServerParameters(
    command="handwrytten-mcp",
    env={"HANDWRYTTEN_API_KEY": "your_api_key_here"},
)

async with stdio_client(server) as (read, write):
    async with ClientSession(read, write) as session:
        await session.initialize()
        tools = await session.list_tools()          # hand these to your LLM
        result = await session.call_tool("list_cards", {})
        print(result)
```

**LangChain / LlamaIndex / CrewAI / etc.** — all have MCP adapters. Search their docs for "MCP" and plug in the same `command` + `env` combo. The pattern never changes.

---

## Path B: self-hosted HTTP mode (connect by URL)

Use this when your LLM setup connects to MCP servers over HTTP — for example the **Anthropic API MCP connector**, or an agent running somewhere that can't spawn local processes.

Here you run the server as a little web server. Requests coming in don't need any auth — the server uses **your** API key for everything. Which leads to the big warning:

> ⚠️ **Anyone who can reach this URL can send cards on your account and spend your money.** Run it on `localhost`, inside a private network, or behind your own auth. Do NOT put it on the open internet as-is.

### Step 1: Install (same as before)

```bash
npm install -g @handwrytten/mcp-server
```

### Step 2: Run it in HTTP mode

**Mac/Linux:**

```bash
MCP_TRANSPORT=http \
MCP_SERVER_URL=http://localhost:3000 \
HANDWRYTTEN_API_KEY=your_api_key_here \
handwrytten-mcp
```

**Windows (PowerShell):**

```powershell
$env:MCP_TRANSPORT = "http"
$env:MCP_SERVER_URL = "http://localhost:3000"
$env:HANDWRYTTEN_API_KEY = "your_api_key_here"
handwrytten-mcp
```

You should see:

```
Dev mode: OAuth routes disabled (using HANDWRYTTEN_API_KEY)
Handwrytten MCP server listening on http://0.0.0.0:3000
MCP endpoint:   http://localhost:3000/mcp
```

Sanity-check it in another terminal:

```bash
curl http://localhost:3000/health
```

You should get `{"status":"ok",...}`.

### Step 3: Point your client at `http://localhost:3000/mcp`

**Python with the official `mcp` package (Streamable HTTP):**

```python
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

async with streamablehttp_client("http://localhost:3000/mcp") as (read, write, _):
    async with ClientSession(read, write) as session:
        await session.initialize()
        tools = await session.list_tools()
        result = await session.call_tool("list_cards", {})
```

**Anthropic API MCP connector** — note the URL must be reachable *from Anthropic's servers*, so `localhost` won't work here. Deploy the server somewhere private-but-reachable (and read the warning above again — put a proxy with auth in front of it):

```python
import anthropic

client = anthropic.Anthropic()
response = client.beta.messages.create(
    model="claude-sonnet-5",
    max_tokens=2000,
    messages=[{"role": "user", "content": "List available thank-you cards"}],
    mcp_servers=[{
        "type": "url",
        "url": "https://your-deployed-server.example.com/mcp",
        "name": "handwrytten",
    }],
    betas=["mcp-client-2025-04-04"],
)
```

(If you deploy it publicly, set `MCP_SERVER_URL` to the real public URL instead of `http://localhost:3000`.)

### Keeping it running

For anything beyond testing, run it under a process manager so it survives reboots:

```bash
npm install -g pm2
pm2 start handwrytten-mcp --name handwrytten \
  --env MCP_TRANSPORT=http \
  --env MCP_SERVER_URL=http://localhost:3000 \
  --env HANDWRYTTEN_API_KEY=your_api_key_here
```

Or use Docker, systemd, whatever you already know. It's just a Node web server.

---

## What tools does your LLM get?

Once connected, your model can call 40+ tools. The ones it'll use most:

- `list_cards` / `list_fonts` — browse stationery and handwriting styles (call these first)
- `send_order` — the big one: sends a real handwritten card (single or bulk recipients)
- `get_order` / `list_orders` — track what you sent
- `list_recipients` / `add_recipient` — address book
- `get_user` — check your account and credit balance

Full list in the [README](README.md).

---

## Troubleshooting

**"command not found: handwrytten-mcp"**
Global npm installs aren't on your PATH. Either fix your PATH, or skip the install entirely and use `npx` as the command: `npx -y @handwrytten/mcp-server` (with the same `HANDWRYTTEN_API_KEY` env var).

**"HANDWRYTTEN_API_KEY environment variable is required"**
The key isn't reaching the server. In client configs, make sure it's inside the `"env": { ... }` block for the server, not somewhere else.

**Tools appear but every call fails with an auth/permission error**
Your API key is wrong, expired, or copied with a stray space. Get a fresh one from [handwrytten.com/api](https://www.handwrytten.com/api/).

**HTTP mode: "MCP_SERVER_URL environment variable is required"**
HTTP mode needs `MCP_SERVER_URL` set (use `http://localhost:3000` for local testing).

**HTTP mode: client complains about GET / SSE**
This server is stateless — all MCP traffic is `POST /mcp`. Make sure your client uses **Streamable HTTP** transport, not the old SSE transport.

**My AI can see the tools but says it can't send cards**
Some clients require you to enable/approve tools per-server. Check for a tool toggle or approval prompt in your client's UI.

---

## FAQ

**Can I just pass my API key to `https://mcp.handwrytten.com/mcp` somehow?**
No. The hosted server only speaks OAuth. API key = run it yourself. That's the whole deal.

**Does this cost money?**
The server is free (MIT licensed). The cards cost money — they're real cards, written by real robots, sent through real mail, billed to the Handwrytten account that owns the API key.

**Which LLM should I use?**
Any model that supports tool calling works. The server doesn't care — it just answers MCP requests.

**Where do I get help?**
[handwrytten.com/contact](https://www.handwrytten.com/contact) or email mcp@handwrytten.com.
