import { env } from "$env/dynamic/private";
import { json } from "@sveltejs/kit";

type TokenCacheEntry = {
    userId: string;
    expiresAt: number;
};

type RateState = {
    count: number;
    resetAt: number;
};

export type ApiGuardResult =
    | {
          ok: true;
          userId: string;
      }
    | {
          ok: false;
          response: Response;
      };

const tokenCache = new Map<string, TokenCacheEntry>();
const rateLimiter = new Map<string, RateState>();

const TOKEN_TTL_MS = 5 * 60 * 1000;
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX_REQUESTS = 24;

function resolveSupabaseUrl(): string {
    return (
        env.SUPABASE_URL?.trim() ||
        env.VITE_SUPABASE_URL?.trim() ||
        ""
    ).replace(/\/$/, "");
}

function resolveSupabaseAnonKey(): string {
    return (
        env.SUPABASE_ANON_KEY?.trim() ||
        env.VITE_SUPABASE_ANON_KEY?.trim() ||
        ""
    );
}

function extractBearerToken(request: Request): string | null {
    const authHeader = request.headers.get("authorization") || "";
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    return match?.[1]?.trim() || null;
}

function applyRateLimit(rateKey: string): { allowed: boolean; retryAfterSec: number } {
    const now = Date.now();
    const current = rateLimiter.get(rateKey);

    if (!current || now >= current.resetAt) {
        rateLimiter.set(rateKey, { count: 1, resetAt: now + RATE_WINDOW_MS });
        return { allowed: true, retryAfterSec: 0 };
    }

    if (current.count >= RATE_MAX_REQUESTS) {
        return {
            allowed: false,
            retryAfterSec: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
        };
    }

    current.count += 1;
    rateLimiter.set(rateKey, current);
    return { allowed: true, retryAfterSec: 0 };
}

export function applyApiRouteRateLimit(
    routeKey: string,
    subjectKey: string,
): { allowed: boolean; retryAfterSec: number } {
    return applyRateLimit(`${routeKey}:${subjectKey}`);
}

async function verifySupabaseUser(accessToken: string): Promise<string | null> {
    const now = Date.now();
    const cached = tokenCache.get(accessToken);
    if (cached && cached.expiresAt > now) {
        return cached.userId;
    }

    const supabaseUrl = resolveSupabaseUrl();
    const supabaseAnonKey = resolveSupabaseAnonKey();
    if (!supabaseUrl || !supabaseAnonKey) {
        console.error(
            "API guard missing Supabase env. Set SUPABASE_URL/SUPABASE_ANON_KEY or VITE_* equivalents.",
        );
        return null;
    }

    const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
        method: "GET",
        headers: {
            apikey: supabaseAnonKey,
            authorization: `Bearer ${accessToken}`,
        },
    });

    if (!response.ok) return null;

    const payload = await response.json();
    const userId = String(payload?.id || "").trim();
    if (!userId) return null;

    tokenCache.set(accessToken, {
        userId,
        expiresAt: now + TOKEN_TTL_MS,
    });
    return userId;
}

export async function guardApiRequest(
    request: Request,
    routeKey: string,
): Promise<ApiGuardResult> {
    const accessToken = extractBearerToken(request);
    if (!accessToken) {
        return {
            ok: false,
            response: json(
                {
                    error: "Unauthorized: missing bearer token",
                },
                { status: 401 },
            ),
        };
    }

    const userId = await verifySupabaseUser(accessToken);
    if (!userId) {
        return {
            ok: false,
            response: json(
                {
                    error: "Unauthorized: invalid session token",
                },
                { status: 401 },
            ),
        };
    }

    const { allowed, retryAfterSec } = applyRateLimit(`${routeKey}:${userId}`);
    if (!allowed) {
        return {
            ok: false,
            response: json(
                {
                    error: "Too many requests",
                    retry_after_sec: retryAfterSec,
                },
                { status: 429 },
            ),
        };
    }

    return {
        ok: true,
        userId,
    };
}
