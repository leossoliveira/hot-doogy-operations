// careers-submit: receives a job application from the public careers site.
// Deployed with JWT verification OFF (applicants are anonymous). The anon key never
// touches careers tables: this function validates the multipart payload, applies
// per-network throttling through careers_submit (service role), uploads the optional
// résumé and selfie to the private `careers-uploads` bucket and records them with
// careers_attach_file.
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const MAX_FILE = 5 * 1024 * 1024;
const MIME_BY_EXT: Record<string, string> = { pdf: "application/pdf", jpg: "image/jpeg", png: "image/png" };
const ENUMS: Record<string, string[]> = {
 position: ["team_member", "manager"],
 hours_per_week: ["under_15", "15_25", "25_35", "full_time", "flexible"],
 work_experience: ["first_job", "some_experience", "several_years"],
 english_proficiency: ["none", "basic", "intermediate", "fluent"],
 locale: ["en", "pt"],
};

function corsHeaders(req: Request): HeadersInit {
 const allowed = (Deno.env.get("CAREERS_ALLOWED_ORIGINS") || "*").split(",").map((x) => x.trim()).filter(Boolean);
 const origin = req.headers.get("origin") || "";
 const allow = allowed.includes("*") ? "*" : allowed.includes(origin) ? origin : allowed[0] || "";
 return { "Access-Control-Allow-Origin": allow, "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin" };
}

const sha256 = async (bytes: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map((x) => x.toString(16).padStart(2, "0")).join("");
const text = (v: FormDataEntryValue | null, max: number) => typeof v === "string" ? v.trim().slice(0, max) : "";

// Sniff the real content type; browsers trust the extension, we do not.
function sniff(bytes: Uint8Array): string | null {
 if (bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return "application/pdf";
 if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
 if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
 return null;
}

// Throttle key. The gateway appends the real client address as the LAST x-forwarded-for
// entry (a client can prepend fake ones), so take the last. With no address at all, every
// such request shares one bucket instead of skipping the throttle. The hash is salted with a
// secret so stored hashes cannot be reversed over the IPv4 space.
async function ipHash(req: Request): Promise<string> {
 const forwarded = (req.headers.get("x-forwarded-for") || "").split(",").map((x) => x.trim()).filter(Boolean);
 const ip = req.headers.get("cf-connecting-ip") || forwarded.at(-1) || "unknown";
 const salt = Deno.env.get("CAREERS_IP_SALT") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
 return sha256(new TextEncoder().encode(`${salt}:${ip}`));
}

function validate(form: FormData): { ok: true; payload: Record<string, unknown> } | { ok: false; error: string } {
 const p: Record<string, unknown> = {};
 for (const key of ["first_name", "last_name", "city"]) { p[key] = text(form.get(key), 100); if (!p[key]) return { ok: false, error: `${key} is required` }; }
 p.state = text(form.get("state"), 40) || "MA";
 p.email = text(form.get("email"), 254).toLowerCase();
 if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.email as string)) return { ok: false, error: "A valid email is required" };
 p.phone = text(form.get("phone"), 32);
 if ((p.phone as string).replace(/\D/g, "").length < 7) return { ok: false, error: "A valid phone number is required" };
 for (const [key, values] of Object.entries(ENUMS)) { const v = text(form.get(key), 40); if (key === "locale" && !v) { p.locale = "en"; continue; } if (!values.includes(v)) return { ok: false, error: `${key} is invalid` }; p[key] = v; }
 for (const key of ["at_least_16", "work_authorized"]) { const v = text(form.get(key), 5); if (!["true", "false"].includes(v)) return { ok: false, error: `${key} is required` }; p[key] = v === "true"; }
 if (p.at_least_16 === false) return { ok: false, error: "Applicants must be at least 16 years old" };
 const start = text(form.get("earliest_start"), 10);
 if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || Number.isNaN(Date.parse(start))) return { ok: false, error: "earliest_start is invalid" };
 p.earliest_start = start;
 const anyLocation = text(form.get("any_location"), 5) === "true";
 const locationCode = text(form.get("preferred_location_code"), 40);
 if (!anyLocation && !locationCode) return { ok: false, error: "preferred_location is required" };
 p.any_location = anyLocation; if (!anyLocation) p.preferred_location_code = locationCode;
 let availability: unknown;
 try { availability = JSON.parse(text(form.get("availability"), 4000) || "[]"); } catch { return { ok: false, error: "availability is invalid" }; }
 if (!Array.isArray(availability) || !availability.length || availability.length > 7) return { ok: false, error: "Select at least one available day" };
 p.availability = availability.map((x) => ({ day: String(x?.day || ""), from: String(x?.from || ""), to: String(x?.to || "") }));
 p.other_languages = text(form.get("other_languages"), 200) || null;
 p.pitch = text(form.get("pitch"), 2000) || null;
 p.referral_source = text(form.get("referral_source"), 200) || null;
 if (text(form.get("consent"), 5) !== "true") return { ok: false, error: "Consent is required" };
 if (text(form.get("website"), 50)) return { ok: false, error: "Rejected" }; // honeypot
 return { ok: true, payload: p };
}

export async function handler(req: Request): Promise<Response> {
 const cors = corsHeaders(req);
 const reply = (status: number, body: unknown) => Response.json(body, { status, headers: { ...cors, "Cache-Control": "no-store" } });
 if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
 if (req.method !== "POST") return reply(405, { error: "POST required" });
 if (Number(req.headers.get("content-length") || 0) > 2 * MAX_FILE + 64 * 1024) return reply(413, { error: "Request too large" });
 let form: FormData;
 try { form = await req.formData(); } catch { return reply(400, { error: "Expected multipart form data" }); }
 const checked = validate(form);
 if (!checked.ok) return reply(400, { error: checked.error });

 // Validate files before touching the database so a bad upload never leaves a half application.
 const files: { kind: "resume" | "selfie"; bytes: Uint8Array; mime: string; name: string; hash: string }[] = [];
 for (const kind of ["resume", "selfie"] as const) {
  const file = form.get(kind);
  if (!(file instanceof File) || file.size === 0) continue;
  if (file.size > MAX_FILE) return reply(413, { error: `${kind} must be 5 MB or smaller` });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = sniff(bytes);
  if (!mime || (kind === "selfie" && mime === "application/pdf")) return reply(415, { error: `${kind} must be a ${kind === "selfie" ? "JPG or PNG" : "PDF, JPG or PNG"} file` });
  files.push({ kind, bytes, mime, name: (file.name || kind).replace(/[^\w.\- ()]/g, "_").slice(0, 120), hash: await sha256(bytes) });
 }

 const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
 const { data: created, error } = await admin.rpc("careers_submit", { p: checked.payload, p_ip_hash: await ipHash(req), p_user_agent: req.headers.get("user-agent") || null });
 if (error) {
  const code = (error as { code?: string }).code;
  if (code === "P0002") return reply(429, { error: error.message });
  if (code === "P0003") return reply(409, { error: error.message });
  if (code === "22023") return reply(400, { error: error.message });
  if (code === "23514") return reply(400, { error: "Some answers are invalid. Please review the form." });
  console.error("careers_submit failed", error);
  return reply(500, { error: "We could not save your application. Please try again." });
 }
 const application = created as { id: string; reference: string; organization_id: string };

 const attached: Record<string, boolean> = {};
 for (const file of files) {
  const ext = Object.entries(MIME_BY_EXT).find(([, m]) => m === file.mime)![0];
  const path = `${application.organization_id}/${application.id}/${file.kind}-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}.${ext}`;
  const upload = await admin.storage.from("careers-uploads").upload(path, file.bytes, { contentType: file.mime, upsert: false });
  if (upload.error) { console.error("upload failed", file.kind, upload.error.message); attached[file.kind] = false; continue; }
  const { error: attachError } = await admin.rpc("careers_attach_file", { p_application: application.id, p_kind: file.kind, p_path: path, p_file_name: file.name, p_mime: file.mime, p_size: file.bytes.length, p_sha256: file.hash });
  if (attachError) { console.error("attach failed", file.kind, attachError.message); await admin.storage.from("careers-uploads").remove([path]); attached[file.kind] = false; continue; }
  attached[file.kind] = true;
 }
 return reply(201, { id: application.id, reference: application.reference, files: attached });
}

Deno.serve(handler);
