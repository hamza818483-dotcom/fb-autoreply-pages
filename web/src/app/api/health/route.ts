export const runtime = "edge";

export async function GET() {
  return new Response(JSON.stringify({ ok: true, service: "ATLAS FB Auto-Reply (dashboard-hosted)" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
