export type PreparedReceiptUpload = {
    body: Blob | File;
    ext: string;
    contentType: string;
};

const MAX_DIMENSION = 1800;
const JPEG_QUALITY = 0.86;
const DIRECT_UPLOAD_MAX_BYTES = 2.5 * 1024 * 1024;

function sanitizeFileExt(fileName: string): string {
    const nameParts = fileName.split(".");
    const raw = (nameParts.length > 1 ? nameParts.pop() : "jpg") || "jpg";
    return raw.toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
}

function inferContentType(ext: string): string {
    if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
    if (ext === "png") return "image/png";
    if (ext === "webp") return "image/webp";
    if (ext === "gif") return "image/gif";
    if (ext === "heic") return "image/heic";
    return "application/octet-stream";
}

function loadImage(file: File): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const objectUrl = URL.createObjectURL(file);

        img.onload = () => {
            URL.revokeObjectURL(objectUrl);
            resolve(img);
        };

        img.onerror = (error) => {
            URL.revokeObjectURL(objectUrl);
            reject(error);
        };

        img.src = objectUrl;
    });
}

function canvasToBlob(
    canvas: HTMLCanvasElement,
    type: string,
    quality: number,
): Promise<Blob | null> {
    return new Promise((resolve) => {
        canvas.toBlob((blob) => resolve(blob), type, quality);
    });
}

export async function prepareReceiptUpload(file: File): Promise<PreparedReceiptUpload> {
    const fallbackExt = sanitizeFileExt(file.name);
    const fallbackContentType = file.type || inferContentType(fallbackExt);

    if (!file.type.startsWith("image/")) {
        return {
            body: file,
            ext: fallbackExt,
            contentType: fallbackContentType,
        };
    }

    const normalizedType = file.type.toLowerCase();
    const canDirectUpload =
        (normalizedType === "image/jpeg" ||
            normalizedType === "image/png" ||
            normalizedType === "image/webp") &&
        file.size <= DIRECT_UPLOAD_MAX_BYTES;

    if (canDirectUpload) {
        return {
            body: file,
            ext: fallbackExt,
            contentType: fallbackContentType,
        };
    }

    try {
        const image = await loadImage(file);
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");

        if (!ctx) {
            throw new Error("Could not get canvas context");
        }

        let width = image.width;
        let height = image.height;
        const maxSide = Math.max(width, height);
        if (maxSide > MAX_DIMENSION) {
            const scale = MAX_DIMENSION / maxSide;
            width = Math.max(1, Math.round(width * scale));
            height = Math.max(1, Math.round(height * scale));
        }

        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(image, 0, 0, width, height);

        const blob = await canvasToBlob(canvas, "image/jpeg", JPEG_QUALITY);
        if (!blob) {
            throw new Error("Failed to encode image");
        }

        return {
            body: blob,
            ext: "jpg",
            contentType: "image/jpeg",
        };
    } catch (error) {
        console.warn("prepareReceiptUpload fallback to original file:", error);
        return {
            body: file,
            ext: fallbackExt,
            contentType: fallbackContentType,
        };
    }
}
