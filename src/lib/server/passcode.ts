import { dev } from "$app/environment";
import { env } from "$env/dynamic/private";
import { createHash, timingSafeEqual } from "node:crypto";

export const PASSCODE_COOKIE_NAME = "app_passcode_session";

const PASSCODE_MIN_LENGTH = 4;
const PASSCODE_TOKEN_SALT = "saving-challenge-passcode-v1";
const PASSCODE_COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

function getConfiguredPasscode(): string | null {
    const raw = getRawPasscode();
    if (!raw) return null;

    if (!/^\d+$/.test(raw)) {
        console.error("APP_PASSCODE must contain digits only.");
        return null;
    }

    if (raw.length < PASSCODE_MIN_LENGTH) {
        console.error(`APP_PASSCODE must be at least ${PASSCODE_MIN_LENGTH} digits.`);
        return null;
    }

    return raw;
}

function getRawPasscode(): string {
    return (env.APP_PASSCODE || "").trim();
}

function toComparableBuffer(value: string): Buffer {
    return Buffer.from(value, "utf8");
}

function safeStringEquals(left: string, right: string): boolean {
    const leftBuf = toComparableBuffer(left);
    const rightBuf = toComparableBuffer(right);
    if (leftBuf.length !== rightBuf.length) return false;
    return timingSafeEqual(leftBuf, rightBuf);
}

function buildSessionToken(passcode: string): string {
    return createHash("sha256")
        .update(`${PASSCODE_TOKEN_SALT}:${passcode}`)
        .digest("hex");
}

export function isPasscodeEnabled(): boolean {
    return getRawPasscode().length > 0;
}

export function isValidPasscodeInput(input: unknown): boolean {
    const configured = getConfiguredPasscode();
    if (!configured) return false;

    const normalized = String(input || "").trim();
    if (!/^\d+$/.test(normalized)) return false;
    return safeStringEquals(normalized, configured);
}

export function isUnlockedSessionToken(token: string | undefined): boolean {
    const configured = getConfiguredPasscode();
    if (!configured || !token) return false;
    const expectedToken = buildSessionToken(configured);
    return safeStringEquals(String(token), expectedToken);
}

export function createUnlockedSessionToken(): string | null {
    const configured = getConfiguredPasscode();
    if (!configured) return null;
    return buildSessionToken(configured);
}

export function getPasscodeCookieOptions() {
    return {
        path: "/",
        httpOnly: true,
        sameSite: "lax" as const,
        secure: !dev,
        maxAge: PASSCODE_COOKIE_MAX_AGE,
    };
}

export function normalizeNextPath(input: string | null | undefined): string {
    const candidate = String(input || "").trim();
    if (!candidate.startsWith("/") || candidate.startsWith("//")) return "/";
    if (candidate.startsWith("/unlock")) return "/";
    return candidate;
}
