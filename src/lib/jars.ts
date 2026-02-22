export type JarKey = "expense" | "saving" | "investment" | "debt";

export type JarRule = {
    key: JarKey;
    label: string;
    labelTh: string;
    percent: number;
};

export type JarAllocation = JarRule & {
    amount: number;
};

export const JAR_RULES: JarRule[] = [
    {
        key: "expense",
        label: "Expense",
        labelTh: "ค่าใช้จ่ายประจำวัน",
        percent: 0.4,
    },
    {
        key: "saving",
        label: "Saving",
        labelTh: "เงินออม",
        percent: 0.2,
    },
    {
        key: "investment",
        label: "Investment",
        labelTh: "เงินลงทุน",
        percent: 0.2,
    },
    {
        key: "debt",
        label: "Debt",
        labelTh: "ชำระหนี้",
        percent: 0.2,
    },
];

function roundCurrency(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function getJarAllocations(incomeAmount: number): JarAllocation[] {
    const safeIncome = Number.isFinite(incomeAmount)
        ? Math.max(0, incomeAmount)
        : 0;

    let remainder = roundCurrency(safeIncome);

    return JAR_RULES.map((rule, index) => {
        const isLastRule = index === JAR_RULES.length - 1;
        const amount = isLastRule
            ? remainder
            : roundCurrency(safeIncome * rule.percent);

        remainder = roundCurrency(remainder - amount);
        return { ...rule, amount };
    });
}

export function inferJarFromCategory(category: string): JarKey | null {
    const normalized = category.toLowerCase().trim();

    if (normalized.includes("saving") || normalized.includes("ออม")) {
        return "saving";
    }
    if (normalized.includes("investment") || normalized.includes("ลงทุน")) {
        return "investment";
    }
    if (normalized.includes("debt") || normalized.includes("หนี้")) {
        return "debt";
    }
    return null;
}
