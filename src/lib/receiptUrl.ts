import { supabase } from "$lib/supabaseClient";

export async function getReceiptPreviewUrl(
    imagePath: string,
    expiresInSeconds = 60 * 30,
): Promise<string | null> {
    const safePath = imagePath.trim();
    if (!safePath) return null;

    const { data, error } = await supabase.storage
        .from("receipts")
        .createSignedUrl(safePath, expiresInSeconds);

    if (!error && data?.signedUrl) {
        return data.signedUrl;
    }

    if (error) {
        console.warn("createSignedUrl failed, fallback to getPublicUrl:", error);
    }

    const { data: publicUrlData } = supabase.storage
        .from("receipts")
        .getPublicUrl(safePath);
    return publicUrlData?.publicUrl || null;
}
