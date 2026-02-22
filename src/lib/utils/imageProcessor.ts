/**
 * Preprocesses an image for better OCR accuracy.
 * Based on the same pipeline used in SharePay.
 */
export async function preprocessImage(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const objectUrl = URL.createObjectURL(file);

        img.onload = () => {
            try {
                const canvas = document.createElement("canvas");
                const ctx = canvas.getContext("2d");

                if (!ctx) {
                    reject(new Error("Could not get canvas context"));
                    return;
                }

                // Resize for OCR speed/accuracy balance
                let width = img.width;
                let height = img.height;
                const TARGET_WIDTH = 1800;

                if (width > TARGET_WIDTH) {
                    const ratio = TARGET_WIDTH / width;
                    width = TARGET_WIDTH;
                    height = img.height * ratio;
                }

                canvas.width = width;
                canvas.height = height;
                ctx.drawImage(img, 0, 0, width, height);

                const imageData = ctx.getImageData(0, 0, width, height);
                const data = imageData.data;
                const histogram = new Array(256).fill(0);

                // Grayscale + histogram
                for (let i = 0; i < data.length; i += 4) {
                    const r = data[i];
                    const g = data[i + 1];
                    const b = data[i + 2];
                    let gray = 0.299 * r + 0.587 * g + 0.114 * b;
                    data[i] = gray;
                    histogram[Math.floor(gray)]++;
                }

                // Dynamic threshold from bright-side histogram peak
                let maxCount = 0;
                let backgroundPeak = 255;
                for (let i = 128; i < 256; i++) {
                    if (histogram[i] > maxCount) {
                        maxCount = histogram[i];
                        backgroundPeak = i;
                    }
                }

                const THRESHOLD_OFFSET = 25;
                const threshold = Math.max(100, backgroundPeak - THRESHOLD_OFFSET);

                // Contrast + threshold
                for (let i = 0; i < data.length; i += 4) {
                    let gray = data[i];
                    const contrast = 60;
                    const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));
                    gray = factor * (gray - 128) + 128;
                    gray = Math.max(0, Math.min(255, gray));
                    gray = gray > threshold ? 255 : Math.max(0, gray - 40);

                    data[i] = gray;
                    data[i + 1] = gray;
                    data[i + 2] = gray;
                }

                ctx.putImageData(imageData, 0, 0);
                resolve(canvas.toDataURL("image/png"));
            } catch (error) {
                reject(error);
            } finally {
                URL.revokeObjectURL(objectUrl);
            }
        };

        img.onerror = (err) => {
            URL.revokeObjectURL(objectUrl);
            reject(err);
        };

        img.src = objectUrl;
    });
}
