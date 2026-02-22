import { preprocessImage } from "$lib/utils/imageProcessor";

export type OcrProgressCallback = (progress: number) => void;

export type SlipOcrResult = {
    rawText: string;
    confidence: number | null; // 0-100
    amount: number | null;
    date: string | null; // YYYY-MM-DD
    note: string;
    inferredType: "income" | "expense" | null;
};

let sharedWorkerPromise: Promise<any> | null = null;
let queuedJob: Promise<void> = Promise.resolve();
let activeProgressCallback: OcrProgressCallback | null = null;

function normalizeConfidence(value: number | null | undefined): number | null {
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    return Math.max(0, Math.min(100, Math.round((value + Number.EPSILON) * 100) / 100));
}

function toIsoDate(year: number, month: number, day: number): string | null {
    if (
        !Number.isInteger(year) ||
        !Number.isInteger(month) ||
        !Number.isInteger(day) ||
        year < 2000 ||
        year > 2100 ||
        month < 1 ||
        month > 12 ||
        day < 1 ||
        day > 31
    ) {
        return null;
    }

    const utc = new Date(Date.UTC(year, month - 1, day));
    if (
        utc.getUTCFullYear() !== year ||
        utc.getUTCMonth() !== month - 1 ||
        utc.getUTCDate() !== day
    ) {
        return null;
    }

    const pad = (n: number) => String(n).padStart(2, "0");
    return `${year}-${pad(month)}-${pad(day)}`;
}

function parseAmount(lines: string[]): number | null {
    // SharePay logic: prefer explicit "จำนวน" line first
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        const sameLineMatch = line.match(/(?:จำนวน|จํานวน)\s*[:.]?\s*([\d,]+\.?\d*)/i);
        if (sameLineMatch && sameLineMatch[1]) {
            const val = Number.parseFloat(sameLineMatch[1].replace(/,/g, ""));
            if (!Number.isNaN(val) && val > 0) return val;
        }

        if (line.match(/(?:จำนวน|จํานวน)\s*[:.]?\s*$/i) && i + 1 < lines.length) {
            const nextLine = lines[i + 1].trim();
            const nextMatch = nextLine.match(/([\d,]+\.?\d*)\s*(?:บาท|THB)?/i);
            if (nextMatch && nextMatch[1]) {
                const val = Number.parseFloat(nextMatch[1].replace(/,/g, ""));
                if (!Number.isNaN(val) && val > 0) return val;
            }
        }
    }

    // SharePay fallback: ignore fee lines
    for (const line of lines) {
        if (line.match(/ค่าธรรมเนียม|fee/i)) continue;
        const match = line.match(/([\d,]+\.\d{2})\s*(?:บาท|THB)/i);
        if (!match) continue;
        const val = Number.parseFloat(match[1].replace(/,/g, ""));
        if (!Number.isNaN(val) && val > 0) return val;
    }

    return null;
}

function parseDate(lines: string[]): string | null {
    // SharePay month mapping (including OCR-misread aliases)
    const thaiMonthMap: Record<string, number> = {
        มค: 1,
        กพ: 2,
        มีค: 3,
        เมย: 4,
        พค: 5,
        มิย: 6,
        กค: 7,
        สค: 8,
        กย: 9,
        ตค: 10,
        พย: 11,
        ธค: 12,
        มกราคม: 1,
        กุมภาพันธ์: 2,
        มีนาคม: 3,
        เมษายน: 4,
        พฤษภาคม: 5,
        มิถุนายน: 6,
        กรกฎาคม: 7,
        สิงหาคม: 8,
        กันยายน: 9,
        ตุลาคม: 10,
        พฤศจิกายน: 11,
        ธันวาคม: 12,
        jan: 1,
        feb: 2,
        mar: 3,
        apr: 4,
        may: 5,
        jun: 6,
        jul: 7,
        aug: 8,
        sep: 9,
        oct: 10,
        nov: 11,
        dec: 12,
        "5m": 12,
        sm: 12,
        "8m": 12,
        "s.m": 12,
        "5.m": 12,
        sh: 12,
        "5h": 12,
        sk: 12,
        sn: 12,
        "5n": 12,
        "5k": 12,
        "1m": 1,
        nm: 1,
        wk: 1,
        mk: 1,
        nw: 2,
        "n.w": 2,
        aw: 2,
        "a.w": 2,
    };

    let dateLine: string | null = null;

    for (const line of lines) {
        if (line.includes("วันที่") || line.includes("วนท") || line.includes("วันท")) {
            dateLine = line;
            break;
        }
        if (
            (line.match(/\d{1,2}:\d{2}/) || line.includes("น.") || line.includes("น,")) &&
            line.match(/^\d{1,2}\s/)
        ) {
            dateLine = line;
            break;
        }
    }

    if (!dateLine) {
        for (const line of lines) {
            if (line.match(/^\d{1,2}\s+[ก-๙a-zA-Z0-9\.\-]+\s+\d{2,4}/)) {
                dateLine = line;
                break;
            }
        }
    }

    if (!dateLine) {
        // Extra fallback for dd/mm/yyyy style lines
        for (const line of lines) {
            const slashMatch = line.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
            if (!slashMatch) continue;

            const d = Number.parseInt(slashMatch[1], 10);
            const m = Number.parseInt(slashMatch[2], 10);
            let y = Number.parseInt(slashMatch[3], 10);

            if (y > 2500) y -= 543;
            else if (y < 100) y = y > 40 ? 2500 + y - 543 : 2000 + y;

            const iso = toIsoDate(y, m, d);
            if (iso) return iso;
        }

        return null;
    }

    const fullMatch =
        dateLine.match(/^(\d{1,2})[\s\.\/-]+([ก-๙a-zA-Z0-9\.\-]+)[\s\.\/-]+(\d{2,4})/) ||
        dateLine.match(
            /(?:วันที่|วนท|วันท)[\s:]*(\d{1,2})[\s\.\/-]+([ก-๙a-zA-Z0-9\.\-]+)[\s\.\/-]+(\d{2,4})/,
        );

    if (!fullMatch) {
        const slashMatch = dateLine.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
        if (!slashMatch) return null;

        const d = Number.parseInt(slashMatch[1], 10);
        const m = Number.parseInt(slashMatch[2], 10);
        let y = Number.parseInt(slashMatch[3], 10);

        if (y > 2500) y -= 543;
        else if (y < 100) y = y > 40 ? 2500 + y - 543 : 2000 + y;

        return toIsoDate(y, m, d);
    }

    const day = Number.parseInt(fullMatch[1], 10);
    const monthRaw = fullMatch[2].toLowerCase().replace(/[\.\s\-]/g, "");
    const yearRaw = Number.parseInt(fullMatch[3], 10);
    if (Number.isNaN(day) || Number.isNaN(yearRaw) || day < 1 || day > 31) return null;

    let month = thaiMonthMap[monthRaw];
    if (!month && monthRaw.match(/^\d{1,2}$/)) {
        const parsedMonth = Number.parseInt(monthRaw, 10);
        if (parsedMonth >= 1 && parsedMonth <= 12) month = parsedMonth;
    }

    if (!month) {
        for (const [key, value] of Object.entries(thaiMonthMap)) {
            if (
                monthRaw.length >= 2 &&
                (monthRaw.startsWith(key) || key.startsWith(monthRaw) || monthRaw.includes(key))
            ) {
                month = value;
                break;
            }
        }
    }

    if (!month) {
        if (
            (monthRaw.includes("m") ||
                monthRaw.includes("n") ||
                monthRaw.includes("k") ||
                monthRaw.includes("h")) &&
            (monthRaw.includes("5") || monthRaw.includes("s") || monthRaw.includes("8"))
        ) {
            month = 12;
        }
        if (monthRaw.includes("ค") || monthRaw.includes("ธ")) month = 12;
        if (monthRaw.includes("ม") && (monthRaw.includes("ค") || monthRaw.length <= 3)) {
            month = 1;
        }
    }

    if (!month) return null;

    let finalYear = yearRaw;
    if (finalYear > 2500) finalYear -= 543;
    else if (finalYear < 100) {
        if (finalYear > 40) finalYear = 2500 + finalYear - 543;
        else finalYear = 2000 + finalYear;
    }

    if (finalYear < 2000 || finalYear > 2100) return null;

    return toIsoDate(finalYear, month, day);
}

function parseNote(lines: string[]): string {
    // SharePay logic: prefer explicit Note/Memo label
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const noteLabelMatch = line.match(/(?:บันทึกช่วยจำ|บันทึกช่วยจํา|Note|Memo)/i);
        if (!noteLabelMatch) continue;

        let content = line
            .substring(noteLabelMatch.index! + noteLabelMatch[0].length)
            .replace(/^[:.\s]+/, "")
            .trim();

        if (!content && i + 1 < lines.length) content = lines[i + 1].trim();
        if (content) return content.slice(0, 180);
    }

    // SharePay fallback
    for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        const noteMatch = line.match(/ค่า[ก-๙a-zA-Z]+/);
        if (noteMatch) return noteMatch[0].slice(0, 180);
    }

    return "OCR จากสลิป";
}

function inferTransactionType(textLower: string): "income" | "expense" | null {
    const incomeHints = [
        "receive",
        "received",
        "incoming",
        "credit",
        "โอนเข้า",
        "รับโอน",
        "รับเงิน",
        "เงินเข้า",
        "ได้รับเงิน",
    ];
    const expenseHints = [
        "transfer to",
        "payment",
        "debit",
        "withdraw",
        "โอนเงิน",
        "จ่าย",
        "ชำระ",
        "ชำระเงิน",
        "ถอนเงิน",
        "เงินออก",
    ];

    const hasIncomeHint = incomeHints.some((hint) => textLower.includes(hint));
    const hasExpenseHint = expenseHints.some((hint) => textLower.includes(hint));

    if (hasIncomeHint && !hasExpenseHint) return "income";
    if (hasExpenseHint && !hasIncomeHint) return "expense";
    return null;
}

async function getSharedWorker(): Promise<any> {
    if (!sharedWorkerPromise) {
        sharedWorkerPromise = (async () => {
            const { createWorker } = await import("tesseract.js");
            return createWorker("tha+eng", 1, {
                logger: (message: { status?: string; progress?: number }) => {
                    if (
                        message.status === "recognizing text" &&
                        typeof message.progress === "number"
                    ) {
                        activeProgressCallback?.(message.progress);
                    }
                },
            });
        })();
    }
    return sharedWorkerPromise;
}

export function parseSlipOcrText(
    rawText: string,
    confidence: number | null = null,
): SlipOcrResult {
    const lines = rawText
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

    const normalized = lines.join("\n");

    return {
        rawText: normalized,
        confidence: normalizeConfidence(confidence),
        amount: parseAmount(lines),
        date: parseDate(lines),
        note: parseNote(lines),
        inferredType: inferTransactionType(normalized.toLowerCase()),
    };
}

export async function runSlipOcr(
    file: File,
    onProgress?: OcrProgressCallback,
): Promise<SlipOcrResult> {
    const execute = async () => {
        const worker = await getSharedWorker();
        activeProgressCallback = onProgress ?? null;
        onProgress?.(0);

        try {
            const processedImageUrl = await preprocessImage(file);
            const result = await worker.recognize(processedImageUrl);
            const rawText = result?.data?.text || "";
            const confidence = normalizeConfidence(result?.data?.confidence);
            return parseSlipOcrText(rawText, confidence);
        } finally {
            activeProgressCallback = null;
            onProgress?.(1);
        }
    };

    const queuedExecution = queuedJob.then(execute, execute);
    queuedJob = queuedExecution.then(
        () => undefined,
        () => undefined,
    );

    return queuedExecution;
}

export async function terminateSlipOcrWorker(): Promise<void> {
    if (!sharedWorkerPromise) return;
    const worker = await sharedWorkerPromise;
    await worker.terminate();
    sharedWorkerPromise = null;
}
