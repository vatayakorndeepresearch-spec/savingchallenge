<script lang="ts">
    import { onMount } from "svelte";
    import { supabase } from "$lib/supabaseClient";
    import { Wallet, TrendingUp, TrendingDown } from "lucide-svelte";
    import { currentUser, users } from "$lib/userStore";

    let loading = true;
    let totalIncome = 0;
    let totalExpense = 0;
    let budgetAmount: number | null = null;
    let score = 0;
    let insight = "";

    const today = new Date();
    const currentMonth = today.getMonth() + 1;
    const currentYear = today.getFullYear();

    // Reactive statement to reload data when user changes
    $: if ($currentUser) {
        loadData();
    }

    async function loadData() {
        loading = true;

        // Get transactions for current month
        const startOfMonth = new Date(
            currentYear,
            currentMonth - 1,
            1,
        ).toISOString();
        const endOfMonth = new Date(
            currentYear,
            currentMonth,
            0,
            23,
            59,
            59,
        ).toISOString();

        const { data: transactions, error: txError } = await supabase
            .from("transactions")
            .select("*")
            .gte("date", startOfMonth)
            .lte("date", endOfMonth)
            .eq("owner", $currentUser); // Only current user

        if (txError) console.error("Error loading transactions:", txError);

        // Get budget for current month
        const { data: budget, error: budgetError } = await supabase
            .from("budgets")
            .select("amount")
            .eq("year", currentYear)
            .eq("month", currentMonth)
            .eq("owner", $currentUser)
            .single();

        if (budgetError && budgetError.code !== "PGRST116")
            console.error("Error loading budget:", budgetError);

        budgetAmount = budget?.amount || null;

        if (transactions) {
            const expenses = transactions.filter((t) => t.type === "expense");
            const incomes = transactions.filter((t) => t.type === "income");

            totalExpense = expenses.reduce((sum, t) => sum + t.amount, 0);
            totalIncome = incomes.reduce((sum, t) => sum + t.amount, 0);

            // Calculate Personal Score
            score = 0;
            if (budgetAmount && budgetAmount > 0) {
                if (totalExpense <= budgetAmount) score += 100;
                else score -= 100;
            }

            const luxuryCount = expenses.filter(
                (t) => t.category.toLowerCase() === "luxury",
            ).length;
            score -= luxuryCount * 10;

            if (luxuryCount === 0 && expenses.length > 0) {
                score += 50;
            }

            // Generate Insight
            if (budgetAmount && totalExpense > budgetAmount * 0.8) {
                insight =
                    "เดือนนี้ใช้ไปเกิน 80% ของงบแล้ว ระวังจะเกินงบนะครับ 💸";
            } else if (luxuryCount === 0 && expenses.length > 0) {
                insight =
                    "เดือนนี้ยังไม่มีค่าใช้จ่ายฟุ่มเฟือยเลย เก่งมากครับ 🎉";
            } else {
                insight = "สู้ๆ นะครับ ช่วยกันเก็บออมเพื่ออนาคต! 💪";
            }
        }

        loading = false;
    }

    onMount(loadData);
</script>

<div class="space-y-6">
    <!-- Welcome Message -->
    <div class="flex items-center gap-2 text-slate-500 text-sm">
        <span>สวัสดี</span>
        <span class="font-bold {users[$currentUser].color}"
            >{users[$currentUser].name}</span
        >
        <span>มาเช็คสุขภาพการเงินกันเถอะ!</span>
    </div>

    <!-- Score Card -->
    <div
        class="bg-gradient-to-br from-pink-500 to-rose-500 rounded-2xl p-6 text-white shadow-lg text-center relative overflow-hidden"
    >
        <div
            class="absolute top-0 left-0 w-full h-full bg-white opacity-10 transform -skew-x-12"
        ></div>
        <h2 class="text-lg font-medium opacity-90 relative z-10">
            คะแนนความประหยัด
        </h2>
        <div class="text-5xl font-bold mt-2 relative z-10">{score}</div>
        <p class="mt-2 text-sm opacity-90 relative z-10">{insight}</p>
    </div>

    <!-- Summary Cards -->
    <div class="grid grid-cols-2 gap-4">
        <div class="bg-white p-4 rounded-xl shadow-sm border border-slate-100">
            <div class="flex items-center gap-2 text-emerald-500 mb-2">
                <TrendingUp size={20} />
                <span class="font-medium">รายรับ</span>
            </div>
            <div class="text-xl font-bold text-slate-800">
                ฿{totalIncome.toLocaleString()}
            </div>
        </div>
        <div class="bg-white p-4 rounded-xl shadow-sm border border-slate-100">
            <div class="flex items-center gap-2 text-rose-500 mb-2">
                <TrendingDown size={20} />
                <span class="font-medium">รายจ่าย</span>
            </div>
            <div class="text-xl font-bold text-slate-800">
                ฿{totalExpense.toLocaleString()}
            </div>
        </div>
    </div>

    <!-- Budget Status -->
    <div class="bg-white p-5 rounded-xl shadow-sm border border-slate-100">
        <div class="flex justify-between items-center mb-4">
            <h3 class="font-bold text-slate-700 flex items-center gap-2">
                <Wallet size={20} class="text-blue-500" />
                งบประมาณเดือนนี้
            </h3>
            <a
                href="/budget"
                class="text-sm text-pink-500 font-medium hover:underline"
                >ตั้งงบ</a
            >
        </div>

        {#if budgetAmount}
            <div class="relative pt-1">
                <div class="flex mb-2 items-center justify-between">
                    <div class="text-right">
                        <span
                            class="text-xs font-semibold inline-block text-slate-600"
                        >
                            ใช้ไป {Math.min(
                                100,
                                Math.round((totalExpense / budgetAmount) * 100),
                            )}%
                        </span>
                    </div>
                </div>
                <div
                    class="overflow-hidden h-2 mb-4 text-xs flex rounded bg-slate-100"
                >
                    <div
                        style="width: {Math.min(
                            100,
                            (totalExpense / budgetAmount) * 100,
                        )}%"
                        class="shadow-none flex flex-col text-center whitespace-nowrap text-white justify-center {totalExpense >
                        budgetAmount
                            ? 'bg-rose-500'
                            : 'bg-emerald-500'} transition-all duration-500"
                    ></div>
                </div>
                <div class="flex justify-between text-sm">
                    <span class="text-slate-500"
                        >ใช้ไป: ฿{totalExpense.toLocaleString()}</span
                    >
                    <span class="font-medium text-slate-700"
                        >งบ: ฿{budgetAmount.toLocaleString()}</span
                    >
                </div>
            </div>
        {:else}
            <p class="text-slate-500 text-sm text-center py-2">
                ยังไม่ได้ตั้งงบประมาณ
            </p>
        {/if}
    </div>
</div>
