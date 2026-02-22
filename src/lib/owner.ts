import type { SupabaseClient } from "@supabase/supabase-js";

export type OwnerSource =
    | "auth_claim_owner"
    | "auth_uid"
    | "fallback_store"
    | "none";

export type OwnerResolution = {
    owner: string | null;
    source: OwnerSource;
};

export async function resolveOwner(
    supabase: SupabaseClient,
    fallbackOwner?: string | null,
): Promise<OwnerResolution> {
    try {
        const { data, error } = await supabase.auth.getUser();
        if (!error && data?.user) {
            const claimOwner =
                typeof data.user.app_metadata?.owner === "string"
                    ? data.user.app_metadata.owner.trim()
                    : "";
            if (claimOwner) {
                return { owner: claimOwner, source: "auth_claim_owner" };
            }
            if (data.user.id) {
                return { owner: data.user.id, source: "auth_uid" };
            }
        }
    } catch (error) {
        console.error("resolveOwner auth lookup failed:", error);
    }

    const normalizedFallback =
        typeof fallbackOwner === "string" && fallbackOwner.trim()
            ? fallbackOwner.trim()
            : null;
    if (normalizedFallback) {
        return { owner: normalizedFallback, source: "fallback_store" };
    }

    return { owner: null, source: "none" };
}
