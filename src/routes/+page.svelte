<script lang="ts">
    import { onMount } from "svelte";
    import { supabase } from "$lib/supabaseClient";
    import { Wallet, TrendingUp, TrendingDown } from "lucide-svelte";
    import { currentUser, users } from "$lib/userStore";
    import { resolveOwner } from "$lib/owner";
    import {
        getJarAllocations,
        resolveJarForTransaction,
        type JarAllocation,
        type JarKey,
    } from "$lib/jars";

    let loading = true;
    let totalIncome = 0;
    let totalExpense = 0;
    let budgetAmount: number | null = null;
    let score = 0;
    let insight = "";
    type JarProgress = JarAllocation & {
        actual: number;
        delta: number;
        progress: number;
    };
    let jarProgress: JarProgress[] = getJarAllocations(0).map((jar) => ({
        ...jar,
        actual: 0,
        delta: 0,
        progress: 0,
    }));

    interface CategoryTotal {
        category: string;
        amount: number;
        percent: number;
        color: string;
    }
    let expenseByCategory: CategoryTotal[] = [];

    const categoryColors = [
        "#f43f5e", // rose-500
        "#3b82f6", // blue-500
        "#10b981", // emerald-500
        "#f59e0b", // amber-500
        "#8b5cf6", // violet-500
        "#ec4899", // pink-500
        "#06b6d4", // cyan-500
        "#84cc16", // lime-500
        "#6366f1", // indigo-500
        "#f97316", // orange-500
    ];

    interface PieSegment {
        d: string;
        color: string;
    }
    let pieSegments: PieSegment[] = [];

    function computePieSegments(categories: CategoryTotal[]): PieSegment[] {
        let cumulativePercent = 0;
        return categories.map((cat) => {
            const startPercent = cumulativePercent;
            cumulativePercent += cat.percent;
            const x1 = Math.cos(2 * Math.PI * (startPercent / 100));
            const y1 = Math.sin(2 * Math.PI * (startPercent / 100));
            const x2 = Math.cos(2 * Math.PI * (cumulativePercent / 100));
            const y2 = Math.sin(2 * Math.PI * (cumulativePercent / 100));
            const largeArcFlag = cat.percent > 50 ? 1 : 0;
            return {
                d: `M 50 50 L ${50 + 40 * x1} ${50 + 40 * y1} A 40 40 0 ${largeArcFlag} 1 ${50 + 40 * x2} ${50 + 40 * y2} Z`,
                color: cat.color,
            };
        });
    }

    const jarStyles: Record<
        JarKey,
        { bg: string; border: string; text: string; bar: string }
    > = {
        expense: {
            bg: "bg-rose-50",
            border: "border-rose-100",
            text: "text-rose-700",
            bar: "bg-rose-500",
        },
        saving: {
            bg: "bg-emerald-50",
            border: "border-emerald-100",
            text: "text-emerald-700",
            bar: "bg-emerald-500",
        },
        investment: {
            bg: "bg-blue-50",
            border: "border-blue-100",
            text: "text-blue-700",
            bar: "bg-blue-500",
        },
        debt: {
            bg: "bg-amber-50",
            border: "border-amber-100",
            text: "text-amber-700",
            bar: "bg-amber-500",
        },
    };

    const today = new Date();
    const currentMonth = today.getMonth() + 1;
    const currentYear = today.getFullYear();

    // Reactive statement to reload data when user changes
    $: if ($currentUser) {
        loadData();
    }

    async function loadData() {
        loading = true;
        totalIncome = 0;
        totalExpense = 0;
        score = 0;
        insight = "สู้ๆ นะครับ ช่วยกันเก็บออมเพื่ออนาคต! 💪";
        jarProgress = getJarAllocations(0).map((jar) => ({
            ...jar,
            actual: 0,
            delta: 0,
            progress: 0,
        }));

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
        const { owner } = await resolveOwner(supabase, $currentUser);
        if (!owner) {
            loading = false;
            insight = "ยังไม่พบผู้ใช้ที่ใช้งานอยู่";
            return;
        }

        const { data: transactions, error: txError } = await supabase
            .from("transactions")
            .select("*")
            .gte("date", startOfMonth)
            .lte("date", endOfMonth)
            .eq("owner", owner);

        if (txError) console.error("Error loading transactions:", txError);

        // Get budget for current month
        const { data: budget, error: budgetError } = await supabase
            .from("budgets")
            .select("amount")
            .eq("year", currentYear)
            .eq("month", currentMonth)
            .eq("owner", owner)
            .single();

        if (budgetError && budgetError.code !== "PGRST116")
            console.error("Error loading budget:", budgetError);

        budgetAmount = budget?.amount || null;

        if (transactions) {
            const expenses = transactions.filter((t) => t.type === "expense");
            const incomes = transactions.filter((t) => t.type === "income");

            totalExpense = expenses.reduce((sum, t) => sum + t.amount, 0);
            totalIncome = incomes.reduce((sum, t) => sum + t.amount, 0);

            const actualByJar: Record<JarKey, number> = {
                expense: 0,
                saving: 0,
                investment: 0,
                debt: 0,
            };

            expenses.forEach((tx) => {
                const resolvedJar = resolveJarForTransaction({
                    jar_key: tx.jar_key,
                    category: tx.category,
                });
                actualByJar[resolvedJar] += tx.amount;
            });

            jarProgress = getJarAllocations(totalIncome).map((jar) => {
                const actual = actualByJar[jar.key];
                const delta = jar.amount - actual;
                const progress = jar.amount > 0 ? (actual / jar.amount) * 100 : 0;
                return { ...jar, actual, delta, progress };
            });

            // Calculate Personal Score
            score = 0;
            if (budgetAmount && budgetAmount > 0) {
                if (totalExpense <= budgetAmount) score += 100;
                else score -= 100;
            }

            const luxuryCount = expenses.filter(
                (t) =>
                    t.category.toLowerCase().includes("luxury") ||
                    t.category.includes("ฟุ่มเฟือย"),
            ).length;
            score -= luxuryCount * 10;

            if (luxuryCount === 0 && expenses.length > 0) {
                score += 50;
            }

            // Calculate Expense By Category
            const catMap = new Map<string, number>();
            expenses.forEach((tx) => {
                const current = catMap.get(tx.category) || 0;
                catMap.set(tx.category, current + tx.amount);
            });

            expenseByCategory = Array.from(catMap.entries())
                .map(([category, amount], index) => ({
                    category,
                    amount,
                    percent: totalExpense > 0 ? (amount / totalExpense) * 100 : 0,
                    color: categoryColors[index % categoryColors.length],
                }))
                .sort((a, b) => b.amount - a.amount);

            pieSegments = computePieSegments(expenseByCategory);

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

    <!-- 4-Jar Allocation -->
    <div class="bg-white p-5 rounded-xl shadow-sm border border-slate-100">
        <h3 class="font-bold text-slate-700 mb-1">แผน 4 กระปุกอัตโนมัติ</h3>
        <p class="text-xs text-slate-500 mb-4">
            ระบบคำนวณจากรายรับเดือนนี้ตามสูตร 40/20/20/20
        </p>

        <div class="space-y-3">
            {#each jarProgress as jar}
                <div
                    class="rounded-xl border p-3 {jarStyles[jar.key].bg} {jarStyles[jar.key]
                    .border}"
                >
                    <div class="flex justify-between items-start mb-2">
                        <div>
                            <div class="text-xs text-slate-500">
                                {jar.label} ({Math.round(jar.percent * 100)}%)
                            </div>
                            <div
                                class="text-sm font-semibold {jarStyles[jar.key].text}"
                            >
                                {jar.labelTh}
                            </div>
                        </div>
                        <div class="text-right text-xs">
                            <div class="text-slate-500">Allocated</div>
                            <div class="font-bold text-slate-800">
                                ฿{jar.amount.toLocaleString()}
                            </div>
                        </div>
                    </div>

                    <div class="overflow-hidden h-2 rounded bg-white/70 mb-2">
                        <div
                            style="width: {Math.min(100, Math.max(0, jar.progress))}%"
                            class="h-2 rounded {jarStyles[jar.key].bar}"
                        ></div>
                    </div>

                    <div class="flex justify-between text-xs">
                        <span class="text-slate-600"
                            >ใช้งานจริง: ฿{jar.actual.toLocaleString()}</span
                        >
                        <span
                            class={jar.delta >= 0
                                ? "text-emerald-700 font-medium"
                                : "text-rose-700 font-medium"}
                        >
                            {jar.delta >= 0 ? "เหลือ" : "เกิน"} ฿{Math.abs(
                                jar.delta,
                            ).toLocaleString()}
                        </span>
                    </div>
                </div>
            {/each}
        </div>
    </div>

    <!-- Expense Breakdown -->
    <div class="bg-white p-5 rounded-xl shadow-sm border border-slate-100">
        <div class="flex justify-between items-center mb-4">
            <h3 class="font-bold text-slate-700 flex items-center gap-2">
                <Wallet size={20} class="text-blue-500" />
                ค่าใช้จ่ายเดือนนี้
            </h3>
        </div>

        {#if expenseByCategory.length > 0}
            <div class="flex flex-col items-center">
                <!-- SVG Pie Chart -->
                <div class="relative w-48 h-48 mb-6">
                    <svg viewBox="0 0 100 100" class="w-full h-full -rotate-90">
                        {#each pieSegments as seg}
                            <path d={seg.d} fill={seg.color} class="transition-all duration-300 hover:opacity-80" />
                        {/each}
                        <circle cx="50" cy="50" r="25" fill="white" />
                    </svg>
                    <div class="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                        {#if budgetAmount}
                            <span class="text-2xl font-bold text-slate-800">{Math.round((totalExpense / budgetAmount) * 100)}%</span>
                            <span class="text-[10px] text-slate-400 uppercase font-medium">ของงบ</span>
                        {:else}
                            <span class="text-lg font-bold text-slate-800">฿{totalExpense.toLocaleString()}</span>
                            <span class="text-[10px] text-slate-400 uppercase font-medium">รายจ่าย</span>
                        {/if}
                    </div>
                </div>

                <!-- Legend -->
                <div class="w-full grid grid-cols-2 gap-x-4 gap-y-2">
                    {#each expenseByCategory as cat}
                        <div class="flex items-center justify-between text-xs py-1 border-b border-slate-50 last:border-0">
                            <div class="flex items-center gap-2 truncate">
                                <div class="w-2 h-2 rounded-full shrink-0" style="background-color: {cat.color}"></div>
                                <span class="text-slate-600 truncate">{cat.category.split('(')[0].trim()}</span>
                            </div>
                            <span class="font-bold text-slate-800 ml-1">{cat.percent.toFixed(1)}%</span>
                        </div>
                    {/each}
                </div>

                <div class="w-full mt-4 flex justify-between text-xs pt-3 border-t border-slate-100">
                    <span class="text-slate-500">ใช้ไป: ฿{totalExpense.toLocaleString()}</span>
                    {#if budgetAmount}
                        <span class="font-medium text-slate-700">งบ: ฿{budgetAmount.toLocaleString()}</span>
                    {/if}
                </div>
            </div>
        {:else}
            <div class="text-center py-8">
                <div class="text-slate-300 mb-2">
                    <TrendingDown size={40} class="mx-auto opacity-20" />
                </div>
                <p class="text-slate-500 text-sm">ยังไม่มีค่าใช้จ่ายในเดือนนี้</p>
                {#if budgetAmount}
                    <div class="mt-2 text-xs text-slate-400">งบประมาณ: ฿{budgetAmount.toLocaleString()}</div>
                {/if}
            </div>
        {/if}
    </div>
</div>
