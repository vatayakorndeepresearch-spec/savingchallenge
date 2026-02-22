export type TransactionType = "income" | "expense";

export const expenseCategories = [
    "Food (อาหาร)",
    "Groceries (ของใช้ในบ้าน)",
    "Coffee (กาแฟ)",
    "Transport (เดินทาง)",
    "Housing (ที่อยู่อาศัย)",
    "Bills (บิล/สาธารณูปโภค)",
    "Subscription (สมาชิก/ซับสคริปชัน)",
    "Health (สุขภาพ)",
    "Education (การศึกษา)",
    "Travel (ท่องเที่ยว)",
    "Family (ครอบครัว/ลูก)",
    "Pet (สัตว์เลี้ยง)",
    "Insurance (ประกัน)",
    "Tax (ภาษี)",
    "Shopping (ช้อปปิ้ง)",
    "Beauty (ความงาม)",
    "Entertainment (บันเทิง)",
    "Business (งาน/ธุรกิจ)",
    "Donation (บริจาค)",
    "Gift (ของขวัญ)",
    "Luxury (ฟุ่มเฟือย)",
    "Saving (ออม)",
    "Investment (ลงทุน)",
    "Debt (หนี้)",
    "No Spend",
    "Other (อื่นๆ)",
];

export const incomeCategories = [
    "Salary (เงินเดือน)",
    "Bonus (โบนัส)",
    "Freelance (ฟรีแลนซ์)",
    "Business Income (รายได้ธุรกิจ)",
    "Commission (คอมมิชชั่น)",
    "Interest/Dividend (ดอกเบี้ย/ปันผล)",
    "Rental Income (ค่าเช่า)",
    "Gift/Support (ของขวัญ/สนับสนุน)",
    "Refund/Cashback (คืนเงิน/แคชแบ็ก)",
    "Sale of Asset (ขายทรัพย์สิน)",
    "Other (อื่นๆ)",
];

export function getCategoriesByType(type: TransactionType): string[] {
    return type === "income" ? incomeCategories : expenseCategories;
}

export function getAiAllowedCategories(type: TransactionType): string[] {
    return getCategoriesByType(type).filter((category) => category !== "No Spend");
}
