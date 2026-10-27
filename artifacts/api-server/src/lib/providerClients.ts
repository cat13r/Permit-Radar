import { ReplitConnectors } from "@replit/connectors-sdk";

const connectors = new ReplitConnectors();

export async function stripeRequest<T>(
  path: string,
  fields?: Record<string, string>,
): Promise<T> {
  const response = await connectors.proxy("stripe", path, {
    method: fields ? "POST" : "GET",
    ...(fields
      ? {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams(fields).toString(),
        }
      : {}),
  });
  const body = await response.text();
  let payload: unknown = {};
  try {
    payload = body ? JSON.parse(body) : {};
  } catch {
    payload = { message: body };
  }
  if (!response.ok) {
    const message =
      typeof payload === "object" &&
      payload !== null &&
      "error" in payload &&
      typeof payload.error === "object" &&
      payload.error !== null &&
      "message" in payload.error
        ? String(payload.error.message)
        : `Stripe request failed with status ${response.status}`;
    throw new Error(message);
  }
  return payload as T;
}

export async function sendResendEmail(message: {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
}): Promise<void> {
  const response = await connectors.proxy("resend", "/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": message.idempotencyKey,
    },
    body: JSON.stringify({
      from: message.from,
      to: [message.to],
      subject: message.subject,
      html: message.html,
      text: message.text,
    }),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(
      `Resend rejected the daily digest (${response.status}): ${body.slice(0, 400)}`,
    );
  }
}
