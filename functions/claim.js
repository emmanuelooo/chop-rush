// Cloudflare Pages Function: checks every purchase with Vatar before giving anything.
// Needs one setting in Cloudflare: VATAR_SECRET (your vtr_test_... / vtr_live_... key)
const API = "https://lagoslife.app/api/games/v1"
const reply = (code, obj = {}) =>
  new Response(JSON.stringify(obj), { status: code, headers: { "Content-Type": "application/json" } })

export async function onRequestPost({ request, env }) {
  const call = async (path, body) => {
    const r = await fetch(API + path, {
      method: body ? "POST" : "GET",
      body: body && JSON.stringify(body),
      headers: { Authorization: `Bearer ${env.VATAR_SECRET}`, "Content-Type": "application/json" },
    })
    return { http: r.status, ...(await r.json().catch(() => ({}))) }
  }
  let body
  try { body = await request.json() } catch { return reply(400) }

  const me = await call("/session/verify", { session: body.session })              // who is asking?
  const p = await call(`/purchases/${encodeURIComponent(body.purchaseId)}`)        // is it real?
  if (me.http !== 200 || p.http !== 200 || p.playerId !== me.playerId) return reply(403)
  if (p.status === "refunded") return reply(409)

  await call(`/purchases/${p.id}/deliver`, {})                                     // mark delivered
  return reply(200, { productId: p.productId })
}
