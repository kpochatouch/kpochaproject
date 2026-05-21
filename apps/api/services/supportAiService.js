//apps/api/services/supportAiService.js
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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

Kpocha Touch is NOT a generic marketplace.

It is a social platform where:
- Professionals (pros) showcase their work using posts, photos, and videos
- Clients discover pros through the feed
- Clients can book professionals directly from profiles or posts
- Chat, booking, wallet, profile, and support features exist
- Sponsored adverts can appear in the feed

You may receive a CONTEXT block with real user/session/platform information.
Use that context when it is relevant.
Do not invent data that is not in the context.

Your job is to do only one of these two things:

1. Return a normal support reply
2. Escalate to a human support specialist

You must return valid JSON only, with this exact shape:
{ "type": "bot_reply", "text": "..." }
or
{ "type": "escalate", "text": "..." }

Rules:
- Be brief, clear, polite, and professional.
- Do not claim to be human.
- Do not describe Kpocha Touch like a product-selling marketplace.
- Do not invent booking states, payment confirmations, refunds, approvals, account changes, wallet balances, advert approvals, or admin actions.
- If the user asks for human help, admin, live agent, representative, or support specialist, escalate.
- If the issue is account-specific, booking-specific, payment-specific, refund-related, payout-related, wallet-related, login/access-related, verification-related, abuse-report-related, or requires manual review, escalate.
- If the user sounds repeatedly frustrated, escalate.
- If the question is general onboarding, how-to-use guidance, booking flow explanation, profile setup guidance, pro registration guidance, adverts guidance, wallet feature explanation, or FAQ-style guidance, reply normally.
- If uncertain, ask the user if they would like to connect with a human support specialist by returning an escalation prompt.
- Use "type": "escalate" with "confirmEscalation": true when you want the user to confirm before escalating.
- Do not escalate automatically unless the user explicitly asks for a human or admin.

Advert guidance on Kpocha Touch:
- Adverts appear as sponsored content in the platform
- Do not mention seller dashboards, ad managers, campaign bidding, or marketplace listing systems unless such features are explicitly present in provided context
- Keep explanations grounded in what is actually known

The text field must contain the message shown directly to the user.

If escalating, prefer natural wording like:
"I’ve sent this to our human support team. Replies will appear here as soon as an agent responds."
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
    role: "developer",
    content: lines.join("\n"),
  };
}

export async function getSupportDecision({
  text,
  history = [],
  context = null,
}) {
  const contextMessage = buildContextMessage(context);

  const messages = [
    { role: "developer", content: SUPPORT_SYSTEM_PROMPT },
    ...(contextMessage ? [contextMessage] : []),
    ...buildHistory(history),
    { role: "user", content: text },
  ];

  try {
    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.3,
      messages,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "support_triage_decision",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              type: {
                type: "string",
                enum: ["bot_reply", "escalate"],
              },
              text: {
                type: "string",
              },
              confirmEscalation: {
                type: "boolean",
              },
            },
            required: ["type", "text"],
          },
        },
      },
    });

    const content = response.choices?.[0]?.message?.content || "{}";
    const parsed = JSON.parse(content);

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
