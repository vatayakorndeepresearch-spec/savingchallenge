import { describe, expect, it } from "vitest";
import { parseSlipOcrText } from "./slipOcr";

describe("parseSlipOcrText", () => {
    it("prefers transfer amount over balance and fee", () => {
        const raw = `
            โอนเงินสำเร็จ
            จำนวนเงิน 1,250.00 บาท
            ค่าธรรมเนียม 10.00 บาท
            ยอดคงเหลือ 54,321.19 บาท
            วันที่ 22/02/2026
        `;

        const parsed = parseSlipOcrText(raw, 92.34);
        expect(parsed.amount).toBe(1250);
        expect(parsed.date).toBe("2026-02-22");
        expect(parsed.confidence).toBe(92.34);
    });

    it("extracts english date and income hint", () => {
        const raw = `
            Receive Transfer
            Amount: 2,000.00 THB
            Available Balance 35,200.15 THB
            5 Feb 2026
        `;

        const parsed = parseSlipOcrText(raw, 88.1);
        expect(parsed.amount).toBe(2000);
        expect(parsed.date).toBe("2026-02-05");
        expect(parsed.inferredType).toBe("income");
    });

    it("parses thai buddhist date format", () => {
        const raw = `
            รายการชำระเงิน
            ยอดชำระ 999.00 บาท
            วันที่ 7 ก.พ. 2569
        `;

        const parsed = parseSlipOcrText(raw, 75.5);
        expect(parsed.amount).toBe(999);
        expect(parsed.date).toBe("2026-02-07");
        expect(parsed.inferredType).toBe("expense");
    });

    it("keeps confidence null when not provided", () => {
        const parsed = parseSlipOcrText("Amount 100.00 THB");
        expect(parsed.confidence).toBeNull();
    });
});
