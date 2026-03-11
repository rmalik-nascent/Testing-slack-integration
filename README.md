# Slack-GitHub Bot

A bot that automatically creates GitHub issues from Slack messages and posts GitHub comments back into the corresponding Slack threads. Fully persistent mapping ensures comments survive server restarts.

---

## Features

- Creates GitHub issues when Slack messages contain `"issue"`.
- Posts GitHub comments back to the same Slack thread.
- Thread + channel mapping is persisted to a JSON file.
- Logs incoming Slack payloads for debugging.
- Easy setup for Replit deployment or any Node.js hosting platform.

---

## How It Works

This bot runs as a **Node.js web server** hosted on Replit (or any similar service). The server listens for incoming HTTP requests from both Slack and GitHub:

1. **Slack events** (`/slack/events`):  
   - Receives messages from channels where the bot is present.  
   - Creates GitHub issues from messages containing `"issue"`.  

2. **GitHub webhooks** (`/github/webhook`):  
   - Receives issue comment events.  
   - Posts comments back to the corresponding Slack thread using a persistent mapping.
