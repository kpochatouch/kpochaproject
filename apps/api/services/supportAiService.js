//apps/api/services/supportAiService.js
import OpenAI from "openai";

let client = null;
try {
  const config = {};
  if (process.env.OPENAI_API_KEY) {
    config.apiKey = process.env.OPENAI_API_KEY;
  }
  client = new OpenAI(config);
} catch (err) {
  console.error("[support-ai] openai client init failed:", err?.message || err);
  client = null;
}

async function callChatbase({ text, history = [], context = {} }) {
  const url = process.env.CHATBASE_URL;
  const apiKey = process.env.CHATBASE_API_KEY;
  const agentId = process.env.CHATBASE_AGENT_ID || null;

  if (!url || !apiKey) return null;

  try {
    const payload = {
      agent: agentId,
      input: String(text || ""),
      history: (history || []).map((m) => ({
        role: m.sender === "user" ? "user" : "assistant",
        content: String(m.text || ""),
      })),
      context: context || {},
    };

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) return null;

    const json = await resp.json().catch(() => null);
    if (!json) return null;

    const reply =
      json.reply || json.answer || json.text || json.message || null;
    if (!reply || !String(reply).trim()) return null;

    return {
      type: "bot_reply",
      text: String(reply).trim(),
    };
  } catch (err) {
    console.warn("[support-ai] chatbase fallback failed:", err?.message || err);
    return null;
  }
}

const SUPPORT_SYSTEM_PROMPT = `
You are Kpocha Touch support assistant.

Kpocha Touch is a marketplace connecting clients with verified professionals in Nigeria.

Key platform features:
- Professionals showcase services with pricing
- Clients book professionals directly from profiles or social feed
- Chat, booking, wallet, profile, and support features exist
- Sponsored adverts appear as promoted content in the feed
- All bookings and payments processed through the platform

CRITICAL BUSINESS MECHANICS (explain clearly to reduce escalations):

BOOKING & PAYMENT FLOW:
- Client pays booking amount upfront at booking time (held in escrow)
- Professional must accept booking to proceed
- If client cancels BEFORE pro accepts: full refund to client wallet
- If client cancels AFTER pro accepts: 3% cancellation fee (1.5% platform, 1.5% pro), remainder refunded
- Professional no-show or failed booking: full refund to client wallet

PROFESSIONAL HOLDINGS WALLET & PAYOUTS:
- When client marks booking Completed, payment goes to professional's holdings wallet
- Holdings wallet amount locked for 3 calendar days (fraud/dispute safety hold)
- After 3 days, funds automatically move to available balance (withdrawable)
- If professional waits until 7-day scheduled cashout: receives 75% of booking, platform 25%
- If professional cannot wait, can request early release after 3-day hold: subject to 3% maintenance fee
  Example: ₦10,000 early release costs ₦300 fee, net ₦9,700 available

COMPLETION TIMING:
- Client must mark booking Completed for payment to enter professional's holdings wallet
- If client does not complete within 2 hours after expected end time, professional gets notification to end booking with reason
- Platform reviews and applies normal payout/refund rules

WITHDRAWAL & PIN:
- Professionals must set 4-digit withdrawal PIN to withdraw to bank account
- PIN hashed securely server-side
- Bank withdrawals require verified bank account
- Instant/early cashouts available with 3% fee

You may receive a CONTEXT block with real user/session/platform information.
Use that context when relevant. Do not invent data not in context.

Your job is to do only one of these:
1. Return a normal support reply
2. Escalate to a human support specialist

You must return valid JSON only:
{ "type": "bot_reply", "text": "..." }
or
{ "type": "escalate", "text": "..." }

WHEN TO REPLY (handle these WITHOUT escalating):
- General how-to: booking, profile setup, pro registration, wallet topup
- Payment/payout: explain holdings wallet, 3-day hold, 7-day cashout split, early release fee
- Cancellation: explain before/after accept rules, refund amounts, fees
- Completion timing: explain 2-hour notification, holdings wallet entry
- Review and ratings: how they work, visibility impact
- PIN and withdrawal: general setup
- Verification and onboarding: general process

WHEN TO ESCALATE (account-specific, manual action needed):
- User explicitly asks for human/agent/representative
- Account access, login, or verification requiring manual review
- Specific booking dispute (verify context first before escalating)
- Payment/refund where user claims money not received (check context first)
- Payout/withdrawal failures or missing funds (context may show actual issue)
- Repeated frustration or complex multi-issue scenarios
- Abuse/safety reports
- Policy override or special exception requests

Rules:
- Be brief, clear, polite, professional
- Do not claim to be human
- Do not invent booking states, balances, transaction confirmations, or approvals
- If uncertain, explain the topic clearly first; only escalate if user remains unsatisfied
- Use "type": "escalate" with "confirmEscalation": true to ask confirmation before escalating
- Do not auto-escalate unless user explicitly requests human help

The text field must contain the message shown directly to the user.

If escalating, prefer natural wording:
"I've sent this to our human support team. You'll hear back as soon as an agent responds."
`;

function buildHistory(history = []) {
  return history.slice(-12).map((m) => ({
    role: m.sender === "user" ? "user" : "assistant",
    content: String(m.text || ""),
  }));
}

function buildContextMessage(context = null) {
  if (!context || typeof context !== "object") return null;

  const lines = [];

  if (context.user) {
    lines.push("USER CONTEXT:");
    if (context.user.uid) lines.push(`- uid: ${context.user.uid}`);
    if (context.user.email) lines.push(`- email: ${context.user.email}`);
    if (context.user.displayName)
      lines.push(`- displayName: ${context.user.displayName}`);
    if (typeof context.user.isPro === "boolean")
      lines.push(`- isPro: ${context.user.isPro ? "yes" : "no"}`);
  }

  if (context.session) {
    lines.push("SESSION CONTEXT:");
    if (context.session.mode) lines.push(`- mode: ${context.session.mode}`);
    if (context.session.status)
      lines.push(`- status: ${context.session.status}`);
    if (typeof context.session.escalated === "boolean") {
      lines.push(`- escalated: ${context.session.escalated ? "yes" : "no"}`);
    }
  }

  if (context.platform) {
    lines.push("PLATFORM CONTEXT:");
    for (const item of context.platform) {
      lines.push(`- ${item}`);
    }
  }

  if (!lines.length) return null;

  return {
    role: "system",
    content: lines.join("\n"),
  };
}

function parseJsonResponse(content) {
  const raw = String(content || "").trim();
  if (!raw) return null;

  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) return null;

  const jsonText = raw.slice(first, last + 1);
  try {
    return JSON.parse(jsonText);
  } catch (err) {
    console.warn("[support-ai] failed to parse JSON response", {
      raw,
      error: err?.message || String(err),
    });
    return null;
  }
}

export async function getSupportDecision({
  text,
  history = [],
  context = null,
}) {
  console.debug("[support-ai] getSupportDecision called", {
    text: String(text || "").slice(0, 120),
    historyCount: history.length,
    openAIApiKey: process.env.OPENAI_API_KEY ? "SET" : "MISSING",
  });

  const contextMessage = buildContextMessage(context);

  const messages = [
    { role: "system", content: SUPPORT_SYSTEM_PROMPT },
    ...(contextMessage ? [contextMessage] : []),
    ...buildHistory(history),
    { role: "user", content: text },
  ];

  try {
    if (!client || !process.env.OPENAI_API_KEY) {
      console.warn(
        "[support-ai] skipping OpenAI request because OPENAI_API_KEY is not configured or client initialization failed",
      );
      throw new Error("openai_not_available");
    }

    console.debug("[support-ai] openai request start", {
      model: "gpt-4o-mini",
      messagesCount: messages.length,
      historyCount: history.length,
      openAIApiKey: process.env.OPENAI_API_KEY ? "SET" : "MISSING",
    });

    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.3,
      messages,
    });

    const content = response.choices?.[0]?.message?.content;
    const parsed = parseJsonResponse(content);

    console.debug("[support-ai] openai request success", {
      choices: response.choices?.length ?? 0,
      usage: response.usage || null,
      contentPreview: String(content || "").slice(0, 200),
    });

    if (
      parsed &&
      (parsed.type === "bot_reply" || parsed.type === "escalate") &&
      String(parsed.text || "").trim()
    ) {
      return {
        type: parsed.type,
        text: String(parsed.text).trim(),
        confirmEscalation: parsed.confirmEscalation === true,
      };
    }

    // If OpenAI returned plain text instead of JSON, attempt a single
    // reformat request asking the model to output ONLY the required JSON.
    const plainText = String(content || "").trim();
    if (plainText) {
      console.debug(
        "[support-ai] openai returned plain-text response; attempting reformat",
        {
          preview: plainText.slice(0, 500),
          length: plainText.length,
        },
      );

      try {
        const reformatMessages = [
          {
            role: "system",
            content:
              'You are a JSON formatter. The assistant previously replied with a plain-text support response. Extract and return ONLY a single valid JSON object with one of the two exact shapes: { "type": "bot_reply", "text": "..." } or { "type": "escalate", "text": "...", "confirmEscalation": true|false }. Do not include any extra text, explanation, or code fences.',
          },
          { role: "assistant", content: plainText },
        ];

        console.debug("[support-ai] openai reformat request start");
        const reformatResp = await client.chat.completions.create({
          model: "gpt-4o-mini",
          temperature: 0,
          messages: reformatMessages,
        });

        const reformatContent = reformatResp.choices?.[0]?.message?.content;
        const reparsed = parseJsonResponse(reformatContent);

        console.debug("[support-ai] openai reformat response", {
          choices: reformatResp.choices?.length ?? 0,
          usage: reformatResp.usage || null,
          contentPreview: String(reformatContent || "").slice(0, 300),
        });

        if (
          reparsed &&
          (reparsed.type === "bot_reply" || reparsed.type === "escalate") &&
          String(reparsed.text || "").trim()
        ) {
          return {
            type: reparsed.type,
            text: String(reparsed.text).trim(),
            confirmEscalation: reparsed.confirmEscalation === true,
          };
        }

        console.warn(
          "[support-ai] reformat attempt did not yield valid JSON; falling back to plain text reply",
        );
      } catch (err) {
        console.warn(
          "[support-ai] reformat attempt failed:",
          err?.message || String(err),
        );
      }

      // As a last resort, use the plain text as bot reply to avoid degrading UX.
      return {
        type: "bot_reply",
        text: plainText,
      };
    }

    console.warn("[support-ai] openai returned invalid JSON response", {
      raw: content,
    });
  } catch (err) {
    console.error("[support-ai] openai call failed:", {
      error: err?.message || String(err),
      code: err?.code,
      status: err?.status,
      apiKey: process.env.OPENAI_API_KEY ? "SET" : "MISSING",
    });
  }

  const fallback = await callChatbase({ text, history, context });
  if (fallback && fallback.type === "bot_reply") {
    return fallback;
  }

  return {
    type: "bot_reply",
    text: "I’m here to help. Can you tell me more about your issue, or would you like me to connect you with a human support specialist?",
  };
}
