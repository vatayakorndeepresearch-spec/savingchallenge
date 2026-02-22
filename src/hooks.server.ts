import { json, redirect, type Handle } from "@sveltejs/kit";
import {
    PASSCODE_COOKIE_NAME,
    isPasscodeEnabled,
    isUnlockedSessionToken,
    normalizeNextPath,
} from "$lib/server/passcode";

function isPublicPath(pathname: string): boolean {
    return (
        pathname === "/unlock" ||
        pathname.startsWith("/_app/") ||
        pathname === "/favicon.ico" ||
        pathname === "/robots.txt"
    );
}

function isApiPath(pathname: string): boolean {
    return pathname.startsWith("/api/");
}

export const handle: Handle = async ({ event, resolve }) => {
    if (!isPasscodeEnabled()) {
        return resolve(event);
    }

    const { pathname, search } = event.url;

    if (isPublicPath(pathname)) {
        const unlocked = isUnlockedSessionToken(
            event.cookies.get(PASSCODE_COOKIE_NAME),
        );

        if (pathname === "/unlock" && unlocked && event.request.method === "GET") {
            const next = normalizeNextPath(event.url.searchParams.get("next"));
            throw redirect(303, next || "/");
        }

        return resolve(event);
    }

    const unlocked = isUnlockedSessionToken(event.cookies.get(PASSCODE_COOKIE_NAME));
    if (unlocked) {
        return resolve(event);
    }

    if (isApiPath(pathname)) {
        return json(
            {
                error: "Passcode required",
                code: "PASSCODE_REQUIRED",
            },
            { status: 401 },
        );
    }

    const next = normalizeNextPath(`${pathname}${search}`);
    throw redirect(303, `/unlock?next=${encodeURIComponent(next)}`);
};
