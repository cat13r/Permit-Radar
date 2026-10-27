function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

export async function stripeRequest<T>(
  path: string,
  fields?: Record<string, string>,
): Promise<T> {
  const response = await fetch(`https://api.stripe.com${path}`, {
    method: fields ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${requireEnv("STRIPE_SECRET_KEY")}`,
      ...(fields
        ? { "Content-Type": "application/x-www-form-urlencoded" }
        : {}),
    },
    ...(fields ? { body: new URLSearchParams(fields).toString() } : {}),
    signal: AbortSignal.timeout(20_000),
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
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requireEnv("RESEND_API_KEY")}`,
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
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(
      `Resend rejected the daily digest (${response.status}): ${body.slice(0, 400)}`,
    );
  }
}
