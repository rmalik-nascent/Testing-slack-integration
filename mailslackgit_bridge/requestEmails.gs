// ======================
// CONFIG
// ======================
const WEBHOOKS = {
  humanise: PropertiesService.getScriptProperties().getProperty("WEBHOOK_HUMANISE"),
  default: PropertiesService.getScriptProperties().getProperty("WEBHOOK_DEFAULT")
};

const REPO_MAP = {
  humanise: { owner: "rmalik-nascent", repo: "Testing-slack-integration" },
  parkland: { owner: "rmalik-nascent", repo: "Testing-slack-integration" },
  default: { owner: "rmalik-nascent", repo: "Testing-slack-integration" }
};

const GITHUB_TOKEN = PropertiesService.getScriptProperties().getProperty("GITHUB_TOKEN");

// ======================
// MAIN PROCESS
// ======================
function processRequestEmails() {
  const labelName = "processed";
  const processedLabel = GmailApp.getUserLabelByName(labelName) || GmailApp.createLabel(labelName);

  const threads = GmailApp.search('is:unread -label:"processed"'); // All unread emails

  threads.forEach(thread => {
    const messages = thread.getMessages().filter(m => m.isUnread());

    messages.forEach(message => {
      try {
        const sender = extractEmail(message.getFrom());

        if (!isClientEmail(sender)) {
          message.markRead();
          Logger.log("Skipping system email: " + sender);
          return;
        }

        const subject = (message.getSubject() || "").trim();
        const body = message.getPlainBody() || "";
        const gmailUrl = "https://mail.google.com/mail/u/0/#inbox/" + thread.getId();
        const ticketId = "REQ-" + message.getId();

        const data = parseTemplate(body, subject);

        safeSlack(data, ticketId, sender, gmailUrl);
        safeGitHub(data, ticketId, sender, gmailUrl);
        sendConfirmation(sender, data.title, ticketId, message.getAttachments());

        message.markRead();
        thread.addLabel(processedLabel);
      } catch (e) {
        Logger.log("Non-blocking error: " + e);
      }
    });
  });
}

// ======================
// TEMPLATE PARSING
// ======================
function parseTemplate(body, subject) {
  const clientMatch = body.match(/client\s*:\s*(.+)/i);
  const priorityMatch = body.match(/priority\s*:\s*(low|medium|high)/i);

  // Remove template lines from description
  const cleanBody = body
    .replace(/client\s*:.*/i, "")
    .replace(/priority\s*:.*/i, "")
    .trim();

  return {
    client: clientMatch ? clientMatch[1].trim().toLowerCase() : "unknown",
    title: extractSubjectTitle(subject),
    priority: priorityMatch ? capitalize(priorityMatch[1]) : "Medium",
    description: cleanBody || "No details provided",
    isTemplate: !!(clientMatch || priorityMatch)
  };
}

function capitalize(s) {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function extractSubjectTitle(subject) {
  return subject || "No Title";
}

// ======================
// CLIENT EMAIL CHECK
// ======================
function isClientEmail(sender) {
  sender = sender.toLowerCase();
  const blockedEmails = [
    "workspace-noreply@google.com",
    "noreply@google.com",
    "no-reply@accounts.google.com"
  ];
  if (blockedEmails.includes(sender)) return false;

  const domain = sender.split("@")[1];
  if (domain && domain.includes("google.com")) return false;

  return true; // Everything else is considered client
}

// ======================
// UTILS
// ======================
function extractEmail(sender) {
  const match = sender.match(/<(.+)>/);
  return match ? match[1] : sender;
}

// ======================
// SLACK
// ======================
function generateMessage(data, ticketId, sender, gmailUrl) {
  return `
🆕 New Request

Ticket: ${ticketId}
Title: ${data.title}
Client: ${data.client}
Priority: ${data.priority}
From: ${sender}

${data.description}

Original Email:
${gmailUrl}
  `.trim();
}

function safeSlack(data, ticketId, sender, gmailUrl) {
  try {
    const clientKey = detectClient(data, sender);
    const webhookUrl = WEBHOOKS[clientKey] || WEBHOOKS.default;
    const messageText = generateMessage(data, ticketId, sender, gmailUrl);

    UrlFetchApp.fetch(webhookUrl, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify({ text: messageText }),
      muteHttpExceptions: true
    });
  } catch (e) {
    Logger.log("Slack error: " + e);
  }
}

// ======================
// GITHUB
// ======================
function safeGitHub(data, ticketId, sender, gmailUrl) {
  try {
    const clientKey = detectClient(data, sender);
    const repo = REPO_MAP[clientKey];
    if (!repo || !repo.owner || !repo.repo) return;

    const messageText = generateMessage(data, ticketId, sender, gmailUrl);

    const payload = {
      title: `[${ticketId}] ${data.title || "No Title"}`,
      body: messageText
    };

    const response = UrlFetchApp.fetch(
      `https://api.github.com/repos/${repo.owner}/${repo.repo}/issues`,
      {
        method: "post",
        contentType: "application/json",
        headers: {
          Authorization: "Bearer " + GITHUB_TOKEN,
          "Accept": "application/vnd.github+json"
        },
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      }
    );

    Logger.log(`GitHub response code: ${response.getResponseCode()}`);
    Logger.log(`GitHub response body: ${response.getContentText()}`);
  } catch (e) {
    Logger.log("GitHub error: " + e);
  }
}

// ======================
// CLIENT DETECTION
// ======================
function detectClient(data, sender) {
  const brand = (data.client || "").toLowerCase();
  if (REPO_MAP[brand]) return brand;

  const domain = sender.split("@")[1]?.toLowerCase();
  if (domain) {
    const key = domain.split(".")[0];
    if (REPO_MAP[key]) return key;
  }
  return "default";
}

// ======================
// CONFIRMATION EMAIL
// ======================
function sendConfirmation(email, title, ticketId, attachments = []) {
  try {
    GmailApp.sendEmail(
      email,
      "Request Received",
      "Your email client does not support HTML.", // fallback (plain text)
      {
        htmlBody: `
          <p>Hi,</p>

          <p>Your request has been received.</p>

          <p><strong>Ticket ID:</strong> ${ticketId}<br>
          <strong>Title:</strong> ${title}</p>

          <p>
          If this is a new request, please fill out the 
          <a href="https://docs.google.com/forms/d/e/1FAIpQLSdUY6H-LcXDSTpAmwBz3zo-YsBeqWHmPWeAlvREwgsm1Qvrkw/viewform?usp=sharing&ouid=105082127515900957965">
          form
          </a> 
          to ensure a timely response.
          </p>

          <p>We will get back to you soon.</p>

          <p>Thanks!</p>
        `,
        attachments: attachments
      }
    );
  } catch (e) {
    Logger.log("Email error: " + e);
  }
}
