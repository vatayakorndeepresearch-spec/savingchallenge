export type OcrProgressCallback = (progress: number) => void;

export type SlipOcrResult = {
    rawText: string;
    amount: number | null;
    date: string | null; // YYYY-MM-DD
    note: string;
    inferredType: "income" | "expense" | null;
};

const THAI_MONTH_MAP: Record<string, number> = {
    "ม.ค.": 1,
    "ก.พ.": 2,
    "มี.ค.": 3,
    "เม.ย.": 4,
    "พ.ค.": 5,
    "มิ.ย.": 6,
    "ก.ค.": 7,
    "ส.ค.": 8,
    "ก.ย.": 9,
    "ต.ค.": 10,
    "พ.ย.": 11,
    "ธ.ค.": 12,
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
};

function normalizeText(input: string): string {
    return input
        .replace(/\u0e33/g, "\u0e4d\u0e32")
        .replace(/[|]/g, " ")
        .replace(/[ ]{2,}/g, " ")
        .trim();
}

function toISODate(day: number, month: number, year: number): string | null {
    if (!Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(year)) {
        return null;
    }

    let normalizedYear = year;
    if (normalizedYear > 2400) {
        normalizedYear -= 543;
    } else if (normalizedYear < 100) {
        normalizedYear += 2000;
    }

    if (
        normalizedYear < 2000 ||
        normalizedYear > 2100 ||
        month < 1 ||
        month > 12 ||
        day < 1 ||
        day > 31
    ) {
        return null;
    }

    const date = new Date(Date.UTC(normalizedYear, month - 1, day));
    if (
        date.getUTCFullYear() !== normalizedYear ||
        date.getUTCMonth() + 1 !== month ||
        date.getUTCDate() !== day
    ) {
        return null;
    }

    const yyyy = String(normalizedYear);
    const mm = String(month).padStart(2, "0");
    const dd = String(day).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
}

function extractDate(text: string): string | null {
    const slashMatch = text.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
    if (slashMatch) {
        const iso = toISODate(
            Number.parseInt(slashMatch[1], 10),
            Number.parseInt(slashMatch[2], 10),
            Number.parseInt(slashMatch[3], 10),
        );
        if (iso) return iso;
    }

    const thaiMonthKeys = Object.keys(THAI_MONTH_MAP).sort(
        (a, b) => b.length - a.length,
    );
    for (const monthText of thaiMonthKeys) {
        const escapedMonth = monthText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const thaiMatch = text.match(
            new RegExp(`(\\d{1,2})\\s*${escapedMonth}\\s*(\\d{2,4})`),
        );
        if (thaiMatch) {
            const iso = toISODate(
                Number.parseInt(thaiMatch[1], 10),
                THAI_MONTH_MAP[monthText],
                Number.parseInt(thaiMatch[2], 10),
            );
            if (iso) return iso;
        }
    }

    const enMatch = text.match(
        /(\d{1,2})\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s*(\d{2,4})/i,
    );
    if (enMatch) {
        const monthLookup: Record<string, number> = {
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
        };
        const month = monthLookup[enMatch[2].slice(0, 3).toLowerCase()];
        const iso = toISODate(
            Number.parseInt(enMatch[1], 10),
            month,
            Number.parseInt(enMatch[3], 10),
        );
        if (iso) return iso;
    }

    return null;
}

function parseAmountFromToken(amountText: string): number | null {
    const numeric = Number.parseFloat(amountText.replace(/,/g, ""));
    if (!Number.isFinite(numeric) || numeric <= 0) return null;
    if (numeric > 1_000_000_000) return null;
    return Math.round((numeric + Number.EPSILON) * 100) / 100;
}

function extractAmount(text: string): number | null {
    const contextPatterns = [
        /(amount|ยอด|จำนวนเงิน|บาท|thb|baht)\s*[:\-]?\s*([0-9][0-9,]*\.[0-9]{2})/i,
        /([0-9][0-9,]*\.[0-9]{2})\s*(บาท|thb|baht)/i,
    ];

    for (const pattern of contextPatterns) {
        const match = text.match(pattern);
        if (match) {
            const amountText = match[2] || match[1];
            const amount = parseAmountFromToken(amountText);
            if (amount) return amount;
        }
    }

    const allMatches = text.match(/[0-9][0-9,]*\.[0-9]{2}/g) || [];
    const candidates = allMatches
        .map((token) => parseAmountFromToken(token))
        .filter((value): value is number => value !== null)
        .sort((a, b) => b - a);

    return candidates[0] ?? null;
}

function inferTransactionType(textLower: string): "income" | "expense" | null {
    const incomeHints = [
        "received",
        "incoming",
        "credit",
        "โอนเข้า",
        "รับโอน",
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
        "ถอนเงิน",
        "เงินออก",
    ];

    const hasIncomeHint = incomeHints.some((hint) => textLower.includes(hint));
    const hasExpenseHint = expenseHints.some((hint) => textLower.includes(hint));

    if (hasIncomeHint && !hasExpenseHint) return "income";
    if (hasExpenseHint && !hasIncomeHint) return "expense";
    return null;
}

function buildNote(rawText: string): string {
    const lines = rawText
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .filter((line) => !/^[0-9:\/\-. ]+$/.test(line));

    if (lines.length === 0) return "OCR จากสลิป";
    const concise = lines.slice(0, 4).join(" | ");
    return concise.slice(0, 180);
}

export function parseSlipOcrText(rawText: string): SlipOcrResult {
    const normalized = normalizeText(rawText);
    const lowered = normalized.toLowerCase();

    return {
        rawText: normalized,
        amount: extractAmount(normalized),
        date: extractDate(normalized),
        note: buildNote(rawText),
        inferredType: inferTransactionType(lowered),
    };
}

export async function runSlipOcr(
    file: File,
    onProgress?: OcrProgressCallback,
): Promise<SlipOcrResult> {
    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker("eng+tha", 1, {
        logger: (message: { status: string; progress: number }) => {
            if (message.status === "recognizing text") {
                onProgress?.(message.progress);
            }
        },
    });

    try {
        const result = await worker.recognize(file);
        return parseSlipOcrText(result.data.text || "");
    } finally {
        await worker.terminate();
    }
}
