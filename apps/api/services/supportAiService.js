//apps/api/services/supportAiService.js
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const SUPPORT_SYSTEM_PROMPT = `
You are Kpocha Touch support assistant.

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
- Do not invent booking states, payment confirmations, refunds, approvals, account changes, wallet balances, or admin actions.
- If the user asks for human help, admin, live agent, representative, or support specialist, escalate.
- If the issue is account-specific, booking-specific, payment-specific, refund-related, payout-related, wallet-related, login/access-related, verification-related, abuse-report-related, or requires manual review, escalate.
- If the user sounds repeatedly frustrated, escalate.
- If the question is general onboarding, how-to-use guidance, booking flow explanation, profile setup guidance, pro registration guidance, wallet feature explanation, or FAQ-style guidance, reply normally.
- If uncertain, escalate.

The text field must contain the message shown directly to the user.
If escalating, use natural wording such as:
"I’m escalating this conversation to a support specialist."
`;

function buildHistory(history = []) {
  return history.slice(-12).map((m) => ({
    role: m.sender === "user" ? "user" : "assistant",
    content: String(m.text || ""),
  }));
}

export async function getSupportDecision({ text, history = [] }) {
  const response = await client.chat.completions.create({
    model: "gpt-5-nano",
    messages: [
      { role: "developer", content: SUPPORT_SYSTEM_PROMPT },
      ...buildHistory(history),
      { role: "user", content: text },
    ],
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
          },
          required: ["type", "text"],
        },
      },
    },
  });

  const content = response.choices?.[0]?.message?.content || "{}";
  const parsed = JSON.parse(content);

  if (
    !parsed ||
    (parsed.type !== "bot_reply" && parsed.type !== "escalate") ||
    !String(parsed.text || "").trim()
  ) {
    return {
      type: "escalate",
      text: "I’m escalating this conversation to a support specialist.",
    };
  }

  return {
    type: parsed.type,
    text: String(parsed.text).trim(),
  };
}
