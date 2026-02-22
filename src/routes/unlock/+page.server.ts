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
    default: async ({ request, cookies }) => {
        if (!isPasscodeEnabled()) {
            return fail(500, {
                error: "ยังไม่ได้ตั้งค่า APP_PASSCODE ในระบบ",
                next: "/",
            } satisfies UnlockActionData);
        }

        const formData = await request.formData();
        const passcode = String(formData.get("passcode") || "").trim();
        const next = normalizeNextPath(String(formData.get("next") || "/"));

        if (!isValidPasscodeInput(passcode)) {
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

        cookies.set(PASSCODE_COOKIE_NAME, token, getPasscodeCookieOptions());
        throw redirect(303, next);
    },
};
