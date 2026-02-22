<script lang="ts">
    import { onMount } from "svelte";
    import { supabase } from "$lib/supabaseClient";
    import { PieChart, PiggyBank } from "lucide-svelte";
    import { currentUser } from "$lib/userStore";
    import {
        getJarAllocations,
        resolveJarForExpenseCategory,
        type JarAllocation,
        type JarKey,
    } from "$lib/jars";

    let loading = true;
    let totalIncome = 0;
    let totalExpense = 0;
    let totalLuxury = 0;
    let categoryBreakdown: {
        category: string;
        amount: number;
        count: number;
    }[] = [];
    type JarAnalytics = JarAllocation & { actual: number; progress: number };
    let jarBreakdown: JarAnalytics[] = [];
    let insight = "";

    const today = new Date();
    const currentMonth = today.getMonth() + 1;
    const currentYear = today.getFullYear();

    $: if ($currentUser) {
        loadData();
    }

    async function loadData() {
        loading = true;
        totalIncome = 0;
        totalExpense = 0;
        totalLuxury = 0;
        categoryBreakdown = [];
        jarBreakdown = getJarAllocations(0).map((jar) => ({
            ...jar,
            actual: 0,
            progress: 0,
        }));
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

        const { data: transactions, error } = await supabase
            .from("transactions")
            .select("*")
            .gte("date", startOfMonth)
            .lte("date", endOfMonth)
            .eq("owner", $currentUser); // Filter by owner

        if (error) console.error(error);

        if (transactions) {
            const expenses = transactions.filter((t) => t.type === "expense");
            const incomes = transactions.filter((t) => t.type === "income");

            totalExpense = expenses.reduce((sum, t) => sum + t.amount, 0);
            totalIncome = incomes.reduce((sum, t) => sum + t.amount, 0);
            totalLuxury = expenses
                .filter(
                    (t) =>
                        t.category.toLowerCase().includes("luxury") ||
                        t.category.includes("ฟุ่มเฟือย"),
                )
                .reduce((sum, t) => sum + t.amount, 0);

            // Group by category
            const breakdownMap = new Map<
                string,
                { amount: number; count: number }
            >();
            expenses.forEach((t) => {
                const current = breakdownMap.get(t.category) || {
                    amount: 0,
                    count: 0,
                };
                breakdownMap.set(t.category, {
                    amount: current.amount + t.amount,
                    count: current.count + 1,
                });
            });

            categoryBreakdown = Array.from(breakdownMap.entries())
                .map(([category, data]) => ({ category, ...data }))
                .sort((a, b) => b.amount - a.amount);

            const actualByJar: Record<JarKey, number> = {
                expense: 0,
                saving: 0,
                investment: 0,
                debt: 0,
            };

            expenses.forEach((tx) => {
                const resolvedJar = resolveJarForExpenseCategory(tx.category);
                actualByJar[resolvedJar] += tx.amount;
            });

            jarBreakdown = getJarAllocations(totalIncome).map((jar) => ({
                ...jar,
                actual: actualByJar[jar.key],
                progress:
                    jar.amount > 0 ? (actualByJar[jar.key] / jar.amount) * 100 : 0,
            }));

            // Generate Insight
            const luxuryRatio =
                totalExpense > 0 ? totalLuxury / totalExpense : 0;
            if (luxuryRatio > 0.3) {
                insight =
                    "สัดส่วนค่าใช้จ่ายฟุ่มเฟือยของคุณค่อนข้างสูง ลองท้าตัวเองลดลงในเดือนหน้าดูไหมครับ?";
            } else if (
                totalIncome > 0 &&
                (totalIncome - totalExpense) / totalIncome > 0.2
            ) {
                insight =
                    "คุณออมเงินได้มากกว่า 20% ของรายรับ สุดยอดมากครับ! 👏";
            } else {
                insight =
                    "ลองตรวจสอบรายการค่าใช้จ่ายดูนะครับ ว่ามีส่วนไหนลดได้บ้าง";
            }
        }
        loading = false;
    }
</script>

<div class="space-y-6">
    <h2 class="text-xl font-bold text-slate-800 flex items-center gap-2">
        <PieChart class="text-pink-500" />
        ภาพรวมเดือนนี้
    </h2>

    {#if loading}
        <div class="text-center py-10 text-slate-400">กำลังโหลด...</div>
    {:else}
        <!-- Summary Cards -->
        <div class="grid grid-cols-2 gap-4">
            <div
                class="bg-white p-4 rounded-xl shadow-sm border border-slate-100"
            >
                <div class="text-xs text-slate-500 mb-1">เงินออมสุทธิ</div>
                <div class="text-xl font-bold text-emerald-600">
                    ฿{(totalIncome - totalExpense).toLocaleString()}
                </div>
            </div>
            <div
                class="bg-white p-4 rounded-xl shadow-sm border border-slate-100"
            >
                <div class="text-xs text-slate-500 mb-1">อัตราการออม</div>
                <div class="text-xl font-bold text-blue-600">
                    {totalIncome > 0
                        ? (
                              ((totalIncome - totalExpense) / totalIncome) *
                              100
                          ).toFixed(1)
                        : 0}%
                </div>
            </div>
        </div>

        <!-- 4-Jar Progress -->
        <div class="bg-white rounded-xl shadow-sm border border-slate-100 p-4">
            <h3 class="font-bold text-slate-700 flex items-center gap-2 mb-3">
                <PiggyBank size={18} class="text-emerald-600" />
                แผน 4 กระปุก (รายรับเดือนนี้)
            </h3>
            <div class="space-y-3">
                {#each jarBreakdown as jar}
                    <div>
                        <div class="flex justify-between text-xs mb-1">
                            <span class="text-slate-600"
                                >{jar.label} ({Math.round(jar.percent * 100)}%)
                                - {jar.labelTh}</span
                            >
                            <span class="text-slate-700 font-medium">
                                ฿{jar.actual.toLocaleString()} / ฿{jar.amount.toLocaleString()}
                            </span>
                        </div>
                        <div class="h-2 bg-slate-100 rounded overflow-hidden">
                            <div
                                class="h-2 bg-emerald-500"
                                style="width: {Math.min(100, Math.max(0, jar.progress))}%"
                            ></div>
                        </div>
                    </div>
                {/each}
            </div>
        </div>

        <!-- Luxury Insight -->
        <div class="bg-purple-50 p-4 rounded-xl border border-purple-100">
            <h3 class="font-bold text-purple-800 mb-1">ค่าใช้จ่ายฟุ่มเฟือย</h3>
            <div class="text-2xl font-bold text-purple-600 mb-2">
                ฿{totalLuxury.toLocaleString()}
            </div>
            <p class="text-sm text-purple-700 bg-white/50 p-2 rounded-lg">
                💡 {insight}
            </p>
        </div>

        <!-- Breakdown Table -->
        <div
            class="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden"
        >
            <div
                class="px-4 py-3 border-b border-slate-100 font-bold text-slate-700"
            >
                แบ่งตามหมวดหมู่
            </div>
            <table class="w-full text-sm">
                <thead class="bg-slate-50 text-slate-500">
                    <tr>
                        <th class="px-4 py-2 text-left font-medium">หมวดหมู่</th
                        >
                        <th class="px-4 py-2 text-right font-medium">จำนวน</th>
                        <th class="px-4 py-2 text-right font-medium">ยอดรวม</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-slate-100">
                    {#each categoryBreakdown as item}
                        <tr>
                            <td class="px-4 py-3 text-slate-700"
                                >{item.category}</td
                            >
                            <td class="px-4 py-3 text-right text-slate-500"
                                >{item.count}</td
                            >
                            <td
                                class="px-4 py-3 text-right font-medium text-slate-700"
                                >฿{item.amount.toLocaleString()}</td
                            >
                        </tr>
                    {/each}
                </tbody>
            </table>
        </div>
    {/if}
</div>
