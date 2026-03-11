import express from "express";
import fetch from "node-fetch";
import crypto from "crypto";
import fs from "fs";

const app = express();
app.use(express.json());

const MAP_FILE = "./slackGitHubMap.json";

// Load existing mapping on startup
let slackToGitHubMap = {};
if (fs.existsSync(MAP_FILE)) {
  slackToGitHubMap = JSON.parse(fs.readFileSync(MAP_FILE));
}

// Helper: save mapping to disk
function saveMapping() {
  fs.writeFileSync(MAP_FILE, JSON.stringify(slackToGitHubMap, null, 2));
}

// Environment variables
const SLACK_TOKEN = process.env.SLACK_BOT_TOKEN;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;         
const GITHUB_REPO = process.env.GITHUB_REPO;            
const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;

// ------------------------
// Helper: Verify Slack requests
// ------------------------
function verifySlack(req) {
  const timestamp = req.headers["x-slack-request-timestamp"];
  const sig = req.headers["x-slack-signature"];
  if (!timestamp || !sig) return false;

  if (Math.abs(Date.now()/1000 - timestamp) > 300) return false;

  const base = `v0:${timestamp}:${JSON.stringify(req.body)}`;
  const mySig = "v0=" + crypto.createHmac("sha256", SLACK_SIGNING_SECRET)
                               .update(base)
                               .digest("hex");

  return crypto.timingSafeEqual(Buffer.from(mySig), Buffer.from(sig));
}

// ------------------------
// Slack Events Endpoint
// ------------------------
app.post("/slack/events", async (req, res) => {
  console.log("Incoming Slack payload:", JSON.stringify(req.body, null, 2));
  const { type, challenge, event } = req.body;

  if (type === "url_verification") return res.json({ challenge });

  if (!verifySlack(req)) return res.status(401).send("Invalid request");

  if (event && event.type === "message" && !event.bot_id) {
    const text = event.text.toLowerCase();

    if (text.includes("issue")) {
      try {
        // Create GitHub issue
        const ghResp = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/issues`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${GITHUB_TOKEN}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            title: `Client Issue: ${text.slice(0,80)}`,
            body: `Reported from Slack by <@${event.user}>\n\n${text}`
          })
        });

        const issue = await ghResp.json();

        // Store mapping and persist
        slackToGitHubMap[issue.number] = {
          thread_ts: event.ts,
          channel: event.channel
        };
        saveMapping();

        // Reply in Slack thread
        await fetch("https://slack.com/api/chat.postMessage", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${SLACK_TOKEN}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            channel: event.channel,
            thread_ts: event.ts,
            text: `GitHub issue created: ${issue.html_url}`
          })
        });

      } catch (err) {
        console.error("Error creating GitHub issue or replying:", err);
      }
    }
  }

  res.sendStatus(200);
});

app.get('/slack/events', (req, res) => {
  res.send('Slack endpoint is alive! Use POST to send events.');
});

// ------------------------
// GitHub Webhook Endpoint
// ------------------------
app.post("/github/webhook", async (req, res) => {
  const { action, issue, comment } = req.body;

  if (action === "created" && comment && issue) {
    try {
      const mapping = slackToGitHubMap[issue.number];
      if (!mapping) return res.sendStatus(200);

      await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SLACK_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          channel: mapping.channel,
          thread_ts: mapping.thread_ts,
          text: `💬 GitHub comment by ${comment.user.login}: ${comment.body}`
        })
      });

    } catch(err) {
      console.error("Error posting GitHub comment to Slack:", err);
    }
  }

  res.sendStatus(200);
});

// ------------------------
// Root endpoint
// ------------------------
app.get("/", (req, res) => {
  res.send("Slack-GitHub Bot is running 🚀");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Slack-GitHub Bot running on port ${PORT}`));
