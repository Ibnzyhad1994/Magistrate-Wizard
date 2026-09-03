export const WEBHOOK_EVENTS = [
  "share.granted",
  "share.revoked",
  "judgment.final",
  "hearing.tomorrow",
  "clerk_request.created",
] as const

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number]

export const notificationTypeToWebhookEvent = (type: string): WebhookEvent | null => {
  switch (type) {
    case "share_granted":
      return "share.granted"
    case "share_revoked":
      return "share.revoked"
    case "judgment_final":
      return "judgment.final"
    case "hearing_tomorrow":
      return "hearing.tomorrow"
    case "clerk_request":
      return "clerk_request.created"
    default:
      return null
  }
}

const bytesToHex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("")

export const signWebhookBody = async (secret: string, body: string) => {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body))
  return bytesToHex(signature)
}

export const webhookSignatureHeader = (hexDigest: string) => `sha256=${hexDigest}`
