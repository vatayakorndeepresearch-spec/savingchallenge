import { fail, redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import {
    PASSCODE_COOKIE_NAME,
    createUnlockedSessionToken,
    getPasscodeCookieOptions,
    isPasscodeEnabled,
    isUnlockedSessionToken,
    isValidPasscodeInput,
    normalizeNextPath,
} from "$lib/server/passcode";

type UnlockActionData = {
    error?: string;
    next: string;
};

type UnlockRateState = {
    failedAttempts: number;
    windowResetAt: number;
    lockedUntil: number;
};

const unlockRateLimiter = new Map<string, UnlockRateState>();

const UNLOCK_MAX_FAILED_ATTEMPTS = 5;
const UNLOCK_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const UNLOCK_LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes
const UNLOCK_MAX_TRACKED_KEYS = 5000;

function resolveClientAddress(
    request: Request,
    getClientAddress: (() => string) | undefined,
): string {
    const xForwardedFor = request.headers.get("x-forwarded-for");
    const forwardedIp = xForwardedFor?.split(",")[0]?.trim();
    if (forwardedIp) return forwardedIp;

    const realIp = request.headers.get("x-real-ip")?.trim();
    if (realIp) return realIp;

    const cfConnectingIp = request.headers.get("cf-connecting-ip")?.trim();
    if (cfConnectingIp) return cfConnectingIp;

    if (!getClientAddress) return "unknown";
    try {
        return getClientAddress();
    } catch {
        return "unknown";
    }
}

function buildUnlockRateKey(
    request: Request,
    getClientAddress: (() => string) | undefined,
): string {
    const ip = resolveClientAddress(request, getClientAddress);
    const userAgent = String(request.headers.get("user-agent") || "unknown")
        .trim()
        .slice(0, 120);
    return `${ip}|${userAgent}`;
}

function pruneUnlockRateLimiter(now: number): void {
    if (unlockRateLimiter.size < UNLOCK_MAX_TRACKED_KEYS) return;

    for (const [key, state] of unlockRateLimiter.entries()) {
        const isExpired = now >= state.windowResetAt && now >= state.lockedUntil;
        if (isExpired) {
            unlockRateLimiter.delete(key);
        }
    }

    while (unlockRateLimiter.size > UNLOCK_MAX_TRACKED_KEYS) {
        const firstKey = unlockRateLimiter.keys().next().value as string | undefined;
        if (!firstKey) break;
        unlockRateLimiter.delete(firstKey);
    }
}

function getLockRemainingSec(rateKey: string, now: number): number {
    const state = unlockRateLimiter.get(rateKey);
    if (!state || now >= state.lockedUntil) return 0;
    return Math.max(1, Math.ceil((state.lockedUntil - now) / 1000));
}

function registerFailedUnlock(rateKey: string, now: number): number {
    const existing = unlockRateLimiter.get(rateKey);
    const baseState: UnlockRateState =
        !existing || now >= existing.windowResetAt
            ? {
                  failedAttempts: 0,
                  windowResetAt: now + UNLOCK_WINDOW_MS,
                  lockedUntil: 0,
              }
            : existing;

    baseState.failedAttempts += 1;

    if (baseState.failedAttempts >= UNLOCK_MAX_FAILED_ATTEMPTS) {
        baseState.failedAttempts = 0;
        baseState.windowResetAt = now + UNLOCK_WINDOW_MS;
        baseState.lockedUntil = now + UNLOCK_LOCKOUT_MS;
    }

    unlockRateLimiter.set(rateKey, baseState);
    return getLockRemainingSec(rateKey, now);
}

function clearUnlockRateLimit(rateKey: string): void {
    unlockRateLimiter.delete(rateKey);
}

export const load: PageServerLoad = async ({ cookies, url }) => {
    if (!isPasscodeEnabled()) {
        throw redirect(303, "/");
    }

    const unlocked = isUnlockedSessionToken(cookies.get(PASSCODE_COOKIE_NAME));
    const next = normalizeNextPath(url.searchParams.get("next"));
    if (unlocked) {
        throw redirect(303, next);
    }

    return { next };
};

export const actions: Actions = {
    default: async ({ request, cookies, getClientAddress }) => {
        if (!isPasscodeEnabled()) {
            return fail(500, {
                error: "ยังไม่ได้ตั้งค่า APP_PASSCODE ในระบบ",
                next: "/",
            } satisfies UnlockActionData);
        }

        const formData = await request.formData();
        const passcode = String(formData.get("passcode") || "").trim();
        const next = normalizeNextPath(String(formData.get("next") || "/"));
        const now = Date.now();
        const rateKey = buildUnlockRateKey(request, getClientAddress);

        pruneUnlockRateLimiter(now);

        const lockRemainingSec = getLockRemainingSec(rateKey, now);
        if (lockRemainingSec > 0) {
            return fail(429, {
                error: `พยายามหลายครั้งเกินไป กรุณาลองใหม่ใน ${lockRemainingSec} วินาที`,
                next,
            } satisfies UnlockActionData);
        }

        if (!isValidPasscodeInput(passcode)) {
            const lockedAfterFailureSec = registerFailedUnlock(rateKey, now);
            if (lockedAfterFailureSec > 0) {
                return fail(429, {
                    error: `พยายามหลายครั้งเกินไป กรุณาลองใหม่ใน ${lockedAfterFailureSec} วินาที`,
                    next,
                } satisfies UnlockActionData);
            }

            return fail(400, {
                error: "รหัสไม่ถูกต้อง กรุณาลองใหม่",
                next,
            } satisfies UnlockActionData);
        }

        const token = createUnlockedSessionToken();
        if (!token) {
            return fail(500, {
                error: "ไม่สามารถเริ่ม session ได้",
                next,
            } satisfies UnlockActionData);
        }

        clearUnlockRateLimit(rateKey);
        cookies.set(PASSCODE_COOKIE_NAME, token, getPasscodeCookieOptions());
        throw redirect(303, next);
    },
};
