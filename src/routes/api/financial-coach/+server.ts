import { env } from "$env/dynamic/private";
import { json } from "@sveltejs/kit";
import { applyApiRouteRateLimit, guardApiRequest } from "$lib/server/apiGuard";
import {
    PASSCODE_COOKIE_NAME,
    isPasscodeEnabled,
    isUnlockedSessionToken,
} from "$lib/server/passcode";

type Priority = "high" | "medium" | "low";
type JarKeyHint = "expense" | "saving" | "investment" | "debt";

type JarSnapshot = {
    key: string;
    label: string;
    target: number;
    actual: number;
};

type CategorySnapshot = {
    category: string;
    amount: number;
    count: number;
};

type CoachRequest = {
    month: string;
    totalIncome: number;
    totalExpense: number;
    totalLuxury: number;
    savingRate: number;
    netSaving: number;
    jarBreakdown: JarSnapshot[];
    topCategories: CategorySnapshot[];
};

type CoachRecommendation = {
    title: string;
    action: string;
    priority: Priority;
    jar_key?: JarKeyHint;
    category_hint?: string;
    note_hint?: string;
};

type CoachResult = {
    summary: string;
    recommendations: CoachRecommendation[];
    confidence: number;
    source: "minimax" | "fallback";
};

function resolveRequestIp(request: Request): string {
    const xForwardedFor = request.headers.get("x-forwarded-for");
    const forwardedIp = xForwardedFor?.split(",")[0]?.trim();
    if (forwardedIp) return forwardedIp;
    return request.headers.get("x-real-ip")?.trim() || "unknown";
}

function toNumber(value: unknown, fallback = 0): number {
    const parsed = Number.parseFloat(String(value ?? ""));
    return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeConfidence(input: unknown): number {
    const parsed = toNumber(input, 0.5);
    if (parsed > 1) return Math.max(0, Math.min(1, parsed / 100));
    return Math.max(0, Math.min(1, parsed));
}

function stripReasoningArtifacts(input: string): string {
    return input
        .replace(/<think>[\s\S]*?<\/think>/gi, "")
        .replace(/<\/?think>/gi, "")
        .trim();
}

function sanitizeLooseJsonText(input: string): string {
    return input
        .replace(/^\uFEFF/, "")
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, "'")
        .replace(/,\s*([}\]])/g, "$1")
        .trim();
}

function closeTruncatedJson(input: string): string {
    let text = input.trim();
    if (!text) return text;

    const first = text[0];
    if (first !== "{" && first !== "[") return text;

    const closers: string[] = [];
    let inString = false;
    let escaped = false;

    for (let i = 0; i < text.length; i += 1) {
        const ch = text[i];
        if (inString) {
            if (escaped) {
                escaped = false;
                continue;
            }
            if (ch === "\\") {
                escaped = true;
                continue;
            }
            if (ch === '"') {
                inString = false;
            }
            continue;
        }

        if (ch === '"') {
            inString = true;
            continue;
        }
        if (ch === "{") {
            closers.push("}");
            continue;
        }
        if (ch === "[") {
            closers.push("]");
            continue;
        }
        if ((ch === "}" || ch === "]") && closers.length > 0) {
            const expected = closers[closers.length - 1];
            if (ch === expected) {
                closers.pop();
            }
        }
    }

    if (escaped && text.endsWith("\\")) {
        text = text.slice(0, -1);
    }
    if (inString) {
        text += '"';
    }
    for (let i = closers.length - 1; i >= 0; i -= 1) {
        text += closers[i];
    }
    return text;
}

function collectJsonObjectCandidates(input: string): string[] {
    const candidates: string[] = [];
    const fencedMatches = input.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi);
    for (const match of fencedMatches) {
        const block = String(match[1] || "").trim();
        if (block) candidates.push(block);
    }

    let depth = 0;
    let start = -1;
    let inString = false;
    let escaped = false;

    for (let i = 0; i < input.length; i += 1) {
        const ch = input[i];
        if (inString) {
            if (escaped) {
                escaped = false;
                continue;
            }
            if (ch === "\\") {
                escaped = true;
                continue;
            }
            if (ch === '"') {
                inString = false;
            }
            continue;
        }

        if (ch === '"') {
            inString = true;
            continue;
        }
        if (ch === "{") {
            if (depth === 0) start = i;
            depth += 1;
            continue;
        }
        if (ch === "}" && depth > 0) {
            depth -= 1;
            if (depth === 0 && start >= 0) {
                candidates.push(input.slice(start, i + 1).trim());
                start = -1;
            }
        }
    }

    const deduped = Array.from(new Set(candidates.filter(Boolean)));
    return deduped;
}

function parseModelJsonObject(raw: string): Record<string, unknown> {
    const cleaned = stripReasoningArtifacts(raw);
    const candidates = collectJsonObjectCandidates(cleaned);
    if (cleaned) {
        candidates.push(cleaned);
    }

    for (const candidate of candidates) {
        const normalized = sanitizeLooseJsonText(candidate);
        const repaired = sanitizeLooseJsonText(closeTruncatedJson(normalized));
        const variants = Array.from(
            new Set([candidate, normalized, repaired].filter(Boolean)),
        );
        for (const variant of variants) {
            try {
                const parsed = JSON.parse(variant);
                if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                    return parsed as Record<string, unknown>;
                }
            } catch {
                // try next candidate variant
            }
        }
    }

    const preview = cleaned.slice(0, 160).replace(/\s+/g, " ");
    throw new Error(`MiniMax returned non-JSON content: ${preview}`);
}

function normalizePriority(input: unknown): Priority {
    const value = String(input || "")
        .trim()
        .toLowerCase();
    if (value === "high" || value === "medium" || value === "low") return value;
    return "medium";
}

function normalizeJarKey(input: unknown): JarKeyHint | undefined {
    const value = String(input || "")
        .trim()
        .toLowerCase();
    if (
        value === "expense" ||
        value === "saving" ||
        value === "investment" ||
        value === "debt"
    ) {
        return value;
    }
    return undefined;
}

function normalizeHint(input: unknown, maxLength = 180): string | undefined {
    const value = String(input || "").trim();
    if (!value) return undefined;
    return value.slice(0, maxLength);
}

function normalizeRecommendations(input: unknown): CoachRecommendation[] {
    if (!Array.isArray(input)) return [];
    return input
        .map((item) => ({
            title: String(item?.title || "").trim(),
            action: String(item?.action || "").trim(),
            priority: normalizePriority(item?.priority),
            jar_key: normalizeJarKey(item?.jar_key),
            category_hint: normalizeHint(item?.category_hint, 80),
            note_hint: normalizeHint(item?.note_hint),
        }))
        .filter((item) => item.title && item.action)
        .slice(0, 5);
}

function extractModelContent(data: any): string {
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
        return content
            .map((part) => {
                if (typeof part === "string") return part;
                if (typeof part?.text === "string") return part.text;
                return "";
            })
            .join("\n")
            .trim();
    }
    return "";
}

function fallbackCoach(payload: CoachRequest): CoachResult {
    const recommendations: CoachRecommendation[] = [];
    const luxuryRatio =
        payload.totalExpense > 0 ? payload.totalLuxury / payload.totalExpense : 0;

    const debtJar = payload.jarBreakdown.find((jar) => jar.key === "debt");
    const savingJar = payload.jarBreakdown.find((jar) => jar.key === "saving");
    const investmentJar = payload.jarBreakdown.find((jar) => jar.key === "investment");

    if (luxuryRatio > 0.25) {
        recommendations.push({
            title: "ลดรายจ่ายฟุ่มเฟือย",
            action: `สัดส่วนฟุ่มเฟือย ${Math.round(luxuryRatio * 100)}% สูงเกินไป ลองตั้งเพดานไม่เกิน 15% ของรายจ่าย`,
            priority: "high",
            jar_key: "expense",
            category_hint: "Luxury (ฟุ่มเฟือย)",
            note_hint: "ลดรายจ่ายฟุ่มเฟือยให้ไม่เกิน 15%",
        });
    }

    if (debtJar && debtJar.actual < debtJar.target) {
        const gap = Math.max(0, debtJar.target - debtJar.actual);
        recommendations.push({
            title: "เร่งปิดหนี้ตามแผน",
            action: `เดือนนี้ Debt ต่ำกว่าเป้า ฿${gap.toLocaleString()} เพิ่มรายการจ่ายหนี้ให้ถึงเป้า 20%`,
            priority: "high",
            jar_key: "debt",
            category_hint: "Debt (หนี้)",
            note_hint: "เพิ่มการชำระหนี้ให้ถึงเป้าเดือนนี้",
        });
    }

    if (savingJar && savingJar.actual < savingJar.target) {
        const gap = Math.max(0, savingJar.target - savingJar.actual);
        recommendations.push({
            title: "เติมกระปุกเงินออม",
            action: `Saving ต่ำกว่าเป้า ฿${gap.toLocaleString()} ให้ตัดเงินเข้าออมทันทีหลังรายรับเข้า`,
            priority: "medium",
            jar_key: "saving",
            category_hint: "Saving (ออม)",
            note_hint: "เติมกระปุกเงินออมรายเดือน",
        });
    }

    if (investmentJar && investmentJar.actual < investmentJar.target) {
        const gap = Math.max(0, investmentJar.target - investmentJar.actual);
        recommendations.push({
            title: "วินัยการลงทุนรายเดือน",
            action: `Investment ยังขาด ฿${gap.toLocaleString()} ลองตั้ง Auto DCA รายสัปดาห์`,
            priority: "medium",
            jar_key: "investment",
            category_hint: "Investment (ลงทุน)",
            note_hint: "ลงทุนแบบ DCA รายสัปดาห์",
        });
    }

    if (payload.savingRate < 0.2) {
        recommendations.push({
            title: "เพิ่มอัตราการออม",
            action: `อัตราการออมปัจจุบัน ${(payload.savingRate * 100).toFixed(1)}% ควรดันให้เกิน 20%`,
            priority: "high",
            jar_key: "saving",
            category_hint: "Saving (ออม)",
            note_hint: "เพิ่มอัตราการออมให้เกิน 20%",
        });
    }

    if (recommendations.length === 0) {
        recommendations.push({
            title: "รักษาวินัยการเงินต่อเนื่อง",
            action: "ภาพรวมดีแล้ว ให้ติดตาม 4 กระปุกรายสัปดาห์และทบทวนหมวดใช้จ่ายหลักทุกสิ้นเดือน",
            priority: "low",
            jar_key: "expense",
            category_hint: "Other (อื่นๆ)",
            note_hint: "รีวิวแผนการเงินประจำสัปดาห์",
        });
    }

    return {
        summary: `เดือน ${payload.month} ภาพรวมสุทธิ ฿${payload.netSaving.toLocaleString()} และอัตราการออม ${(payload.savingRate * 100).toFixed(1)}%`,
        recommendations: recommendations.slice(0, 4),
        confidence: 0.62,
        source: "fallback",
    };
}

async function coachWithMiniMax(payload: CoachRequest): Promise<CoachResult> {
    const apiKey = env.MINIMAX_API_KEY?.trim();
    if (!apiKey) {
        throw new Error("MINIMAX_API_KEY is missing");
    }

    const baseUrl = (env.MINIMAX_BASE_URL?.trim() || "https://api.minimax.io/v1").replace(
        /\/$/,
        "",
    );
    const model = env.MINIMAX_MODEL?.trim() || "MiniMax-M2.5";

    const systemPrompt = `You are a strict personal finance coach.
Return ONLY valid JSON in this exact format:
{
  "summary": "<short Thai summary>",
  "recommendations": [
    {
      "title":"<Thai short title>",
      "action":"<specific Thai action>",
      "priority":"high|medium|low",
      "jar_key":"expense|saving|investment|debt",
      "category_hint":"<optional category text>"
    }
  ],
  "confidence": 0.0-1.0
}
Rules:
- Focus on habit improvements from provided monthly data.
- Give concrete actions (numbers/limits/frequency).
- Include jar_key whenever possible for quick action routing.
- Max 3 recommendations.
- Keep summary <= 140 Thai characters.
- Keep each action <= 120 Thai characters.
- Output ONE compact JSON object only (single line), no markdown, no extra text.`;

    const userPrompt = JSON.stringify(
        {
            month: payload.month,
            metrics: {
                total_income: payload.totalIncome,
                total_expense: payload.totalExpense,
                total_luxury: payload.totalLuxury,
                net_saving: payload.netSaving,
                saving_rate: payload.savingRate,
            },
            jars: payload.jarBreakdown,
            top_categories: payload.topCategories,
        },
        null,
        2,
    );

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000);

    try {
        let response: Response;
        try {
            response = await fetch(`${baseUrl}/chat/completions`, {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    authorization: `Bearer ${apiKey}`,
                },
                body: JSON.stringify({
                    model,
                    messages: [
                        { role: "system", content: systemPrompt },
                        { role: "user", content: userPrompt },
                    ],
                    temperature: 0.1,
                    max_tokens: 900,
                }),
                signal: controller.signal,
            });
        } catch (error) {
            if (controller.signal.aborted) {
                throw new Error("MiniMax request timed out");
            }
            throw error;
        }

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`MiniMax HTTP ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        const content = extractModelContent(data);
        const parsed = parseModelJsonObject(content);

        const recommendations = normalizeRecommendations(parsed?.recommendations);
        const summary = String(parsed?.summary || "").trim();

        if (!summary || recommendations.length === 0) {
            throw new Error("MiniMax returned incomplete recommendation payload");
        }

        return {
            summary,
            recommendations,
            confidence: normalizeConfidence(parsed?.confidence),
            source: "minimax",
        };
    } finally {
        clearTimeout(timeoutId);
    }
}

function toErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error ?? "");
}

function isExpectedMiniMaxFallbackError(error: unknown): boolean {
    const errorName =
        error && typeof error === "object" && "name" in error
            ? String(error.name ?? "").toLowerCase()
            : "";
    const message = toErrorMessage(error).toLowerCase();
    if (errorName === "aborterror" || errorName === "timeouterror") return true;
    if (message.includes("aborterror")) return true;
    if (message.includes("operation was aborted")) return true;
    if (message.includes("request timed out")) return true;
    if (message.includes("non-json content")) return true;
    if (message.includes("incomplete recommendation payload")) return true;
    return false;
}

async function ensureAuthorizedAiRequest(
    request: Request,
    passcodeSessionToken: string | undefined,
): Promise<Response | null> {
    const passcodeAuthorized =
        isPasscodeEnabled() && isUnlockedSessionToken(passcodeSessionToken);
    if (passcodeAuthorized) {
        const { allowed, retryAfterSec } = applyApiRouteRateLimit(
            "api:financial-coach",
            `passcode:${resolveRequestIp(request)}`,
        );
        if (!allowed) {
            return json(
                {
                    error: "Too many requests",
                    retry_after_sec: retryAfterSec,
                },
                { status: 429 },
            );
        }
        return null;
    }

    const guarded = await guardApiRequest(request, "api:financial-coach");
    if (!guarded.ok) return guarded.response;
    return null;
}

export async function POST({ request, cookies }) {
    const unauthorizedResponse = await ensureAuthorizedAiRequest(
        request,
        cookies.get(PASSCODE_COOKIE_NAME),
    );
    if (unauthorizedResponse) {
        return unauthorizedResponse;
    }

    let payload: CoachRequest;

    try {
        payload = await request.json();
    } catch {
        return json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const month = String(payload?.month || "").trim();
    const jarBreakdown = Array.isArray(payload?.jarBreakdown)
        ? payload.jarBreakdown.slice(0, 8)
        : [];
    const topCategories = Array.isArray(payload?.topCategories)
        ? payload.topCategories.slice(0, 8)
        : [];

    const normalizedPayload: CoachRequest = {
        month: month || "เดือนนี้",
        totalIncome: toNumber(payload?.totalIncome),
        totalExpense: toNumber(payload?.totalExpense),
        totalLuxury: toNumber(payload?.totalLuxury),
        netSaving: toNumber(payload?.netSaving),
        savingRate: Math.max(0, Math.min(1, toNumber(payload?.savingRate))),
        jarBreakdown: jarBreakdown.map((jar) => ({
            key: String(jar?.key || ""),
            label: String(jar?.label || ""),
            target: toNumber(jar?.target),
            actual: toNumber(jar?.actual),
        })),
        topCategories: topCategories.map((item) => ({
            category: String(item?.category || ""),
            amount: toNumber(item?.amount),
            count: Math.max(0, Math.round(toNumber(item?.count))),
        })),
    };

    try {
        const result = await coachWithMiniMax(normalizedPayload);
        return json(result);
    } catch (error) {
        if (isExpectedMiniMaxFallbackError(error)) {
            console.warn(
                `MiniMax financial coach fallback: ${toErrorMessage(error)}`,
            );
        } else {
            console.error("MiniMax financial coach failed, fallback:", error);
        }
        return json(fallbackCoach(normalizedPayload));
    }
}
