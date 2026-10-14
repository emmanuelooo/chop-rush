// Cloudflare Pages Function: verifies every purchase with Vatar before the game gives anything.
// Setting needed in Cloudflare: VATAR_SECRET (stored as a Secret, never in the code)
const API = "https://lagoslife.app/api/games/v1"
const PRODUCTS = new Set(["extra_life", "starter_pack", "double_round", "mega_pack"])
const SESSION = /^[A-Za-z0-9._\-]{20,2000}$/
const PID = /^[A-Za-z0-9_\-]{6,64}$/
const HDR = { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }
const reply = (code, obj = {}) => new Response(JSON.stringify(obj), { status: code, headers: HDR })

export const onRequest = async () => reply(405)   // anything that is not POST

export async function onRequestPost({ request, env }) {
  try {
    if (!env.VATAR_SECRET) return reply(500)
    if (request.headers.get("Origin") !== new URL(request.url).origin) return reply(403)      // only our own page
    if (!(request.headers.get("Content-Type") || "").startsWith("application/json")) return reply(415)
    const raw = await request.text()
    if (raw.length > 4096) return reply(413)
    let b; try { b = JSON.parse(raw) } catch { return reply(400) }
    if (!b || typeof b.session !== "string" || typeof b.purchaseId !== "string" ||
        !SESSION.test(b.session) || !PID.test(b.purchaseId)) return reply(400)

    const call = async (path, payload) => {
      const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 6000)
      try {
        const r = await fetch(API + path, { method: payload ? "POST" : "GET", body: payload && JSON.stringify(payload),
          signal: ctl.signal, redirect: "error",
          headers: { Authorization: `Bearer ${env.VATAR_SECRET}`, "Content-Type": "application/json" } })
        return { ...(await r.json().catch(() => ({}))), http: r.status }
      } finally { clearTimeout(t) }
    }

    const me = await call("/session/verify", { session: b.session })           // who is asking?
    if (me.http >= 500 || me.http === 429) return reply(502)
    if (me.http !== 200 || typeof me.playerId !== "string") return reply(403)
    const p = await call(`/purchases/${b.purchaseId}`)                         // is the purchase real?
    if (p.http >= 500 || p.http === 429) return reply(502)
    if (p.http !== 200 || p.playerId !== me.playerId || !PRODUCTS.has(p.productId)) return reply(403)
    if (p.status === "refunded") return reply(409)
    if (p.status !== "paid" && p.status !== "delivered") return reply(403)
    await call(`/purchases/${p.id}/deliver`, {})                               // mark delivered (safe to repeat)
    return reply(200, { productId: p.productId })
  } catch { return reply(502) }                                                // never leak details
}
