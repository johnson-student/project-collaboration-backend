// Minimal Gemini REST client — uses Node's global fetch, no SDK dependency.
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const REQUEST_TIMEOUT_MS = 45000;

// 429/5xx from Gemini are usually transient demand spikes: retry the primary
// model with backoff, then try the fallback model once before giving up.
const RETRYABLE_STATUS = new Set([429, 500, 503]);
const RETRY_DELAYS_MS = [1000, 2500];
// High enough for one create_subtasks round per task when the user asks to
// cover "all tasks" in a project.
const MAX_TOOL_ROUNDS = 12;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const requestOnce = async (model, apiKey, body) => {
  let res;
  try {
    res = await fetch(`${GEMINI_BASE}/${model}:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw Object.assign(
      new Error("Could not reach the Gemini API — check the server's network connection"),
      { status: 502, retryable: true },
    );
  }

  if (!res.ok) {
    let detail = "";
    let retryAfterSec = null;
    try {
      detail = (await res.json())?.error?.message || "";
      const m = detail.match(/retry in ([\d.]+)s/i);
      if (m) retryAfterSec = Math.ceil(parseFloat(m[1]));
    } catch { /* non-JSON error body */ }
    const message =
      res.status === 429
        ? `Gemini rate limit reached (free tier)${retryAfterSec ? ` — try again in about ${retryAfterSec} seconds` : " — please wait a minute and try again"}.`
        : res.status === 503
          ? "Gemini is experiencing high demand right now — please try again in a moment."
          : `Gemini API error (${res.status})${detail ? `: ${detail}` : ""}`;
    throw Object.assign(new Error(message), {
      status: res.status === 429 ? 429 : 502,
      retryable: RETRYABLE_STATUS.has(res.status),
      rateLimited: res.status === 429,
    });
  }

  const data = await res.json();
  const content = data?.candidates?.[0]?.content;
  const parts = content?.parts || [];
  const hasText = parts.some((p) => typeof p.text === "string" && p.text.trim());
  const hasCall = parts.some((p) => p.functionCall);
  if (!hasText && !hasCall) {
    throw Object.assign(
      new Error("Gemini returned an empty response — please try again"),
      { status: 502, retryable: true },
    );
  }
  return content;
};

// contents: [{ role: "user"|"model", parts: [{ text }] }]
// responseSchema (optional): forces structured JSON output
// tools (optional): Gemini functionDeclarations; requires executeTool(name, args)
//   which runs the call and returns a JSON-serializable result for the model.
const callGemini = async ({ systemPrompt, contents, responseSchema, tools, executeTool }) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw Object.assign(
      new Error("AI assistant is not configured — set GEMINI_API_KEY in the server .env"),
      { status: 503 },
    );
  }
  const primaryModel = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const fallbackModel = process.env.GEMINI_FALLBACK_MODEL || "gemini-2.5-flash-lite";

  // Grows across tool rounds: model turn with functionCall, then our
  // functionResponse turn, then the next request.
  const convo = [...contents];

  // Once the primary model reports quota exhaustion, later tool rounds go
  // straight to the fallback instead of burning a doomed request each time.
  let primaryExhausted = false;

  const requestWithRetry = async () => {
    const body = {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: convo,
      ...(tools && { tools }),
      generationConfig: {
        temperature: 0.7,
        // Generous cap: on thinking models (2.5 family) reasoning tokens
        // count against this limit too.
        maxOutputTokens: 8192,
        ...(responseSchema && {
          responseMimeType: "application/json",
          responseSchema,
        }),
      },
    };

    let lastErr;
    if (!primaryExhausted) {
      for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
        if (attempt > 0) await sleep(RETRY_DELAYS_MS[attempt - 1]);
        try {
          return await requestOnce(primaryModel, apiKey, body);
        } catch (err) {
          if (!err.retryable) throw err;
          lastErr = err;
          // Quota errors won't clear within our short backoff — retrying just
          // burns more quota. Go straight to the fallback model, which has its
          // own separate free-tier quota.
          if (err.rateLimited) {
            primaryExhausted = true;
            break;
          }
        }
      }
    }
    if (fallbackModel && fallbackModel !== primaryModel) {
      let fallbackErr;
      for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
        if (attempt > 0) await sleep(RETRY_DELAYS_MS[attempt - 1]);
        try {
          return await requestOnce(fallbackModel, apiKey, body);
        } catch (err) {
          if (!err.retryable) throw err;
          fallbackErr = err;
          if (err.rateLimited) break;
        }
      }
      lastErr = fallbackErr || lastErr;
    }
    throw lastErr;
  };

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const content = await requestWithRetry();
    const parts = content?.parts || [];
    const calls = parts.filter((p) => p.functionCall).map((p) => p.functionCall);
    const text = parts.map((p) => p.text || "").join("").trim();

    if (!calls.length || !executeTool) return text;

    convo.push({ role: "model", parts });
    const responseParts = [];
    for (const call of calls) {
      let response;
      try {
        response = await executeTool(call.name, call.args || {});
      } catch (err) {
        response = { success: false, error: err.message || "Tool execution failed" };
      }
      responseParts.push({ functionResponse: { name: call.name, response } });
    }
    convo.push({ role: "user", parts: responseParts });
  }

  throw Object.assign(
    new Error("The AI made too many tool calls without finishing — please try again."),
    { status: 502 },
  );
};

module.exports = { callGemini };
