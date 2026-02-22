<script lang="ts">
    import { supabase } from "$lib/supabaseClient";
    import { PieChart, PiggyBank, ArrowUpRight } from "lucide-svelte";
    import { currentUser } from "$lib/userStore";
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
    let totalLuxury = 0;
    let categoryBreakdown: {
        category: string;
        amount: number;
        count: number;
    }[] = [];
    type JarAnalytics = JarAllocation & { actual: number; progress: number };
    type JarAction = {
        key: JarKey;
        title: string;
        summary: string;
        category: string;
        note: string;
        cta: string;
        positive: boolean;
    };
    type CoachPriority = "high" | "medium" | "low";
    type CoachRecommendation = {
        title: string;
        action: string;
        priority: CoachPriority;
        jar_key?: JarKey;
        category_hint?: string;
        note_hint?: string;
    };
    type CoachRecommendationPayload = {
        title?: unknown;
        action?: unknown;
        priority?: unknown;
        jar_key?: unknown;
        category_hint?: unknown;
        note_hint?: unknown;
    };
    let jarBreakdown: JarAnalytics[] = [];
    let jarActions: JarAction[] = [];
    let insight = "";
    let coachSummary = "";
    let coachRecommendations: CoachRecommendation[] = [];
    let coachConfidence: number | null = null;
    let coachSource: "minimax" | "fallback" | null = null;
    let coachLoading = false;
    let coachError = "";
    let coachRequestToken = 0;

    const jarCategoryMap: Record<JarKey, string> = {
        expense: "Other (อื่นๆ)",
        saving: "Saving (ออม)",
        investment: "Investment (ลงทุน)",
        debt: "Debt (หนี้)",
    };

    const jarCtaMap: Record<JarKey, string> = {
        expense: "เพิ่มรายการรายจ่าย",
        saving: "เพิ่มรายการออม",
        investment: "เพิ่มรายการลงทุน",
        debt: "เพิ่มรายการจ่ายหนี้",
    };

    function buildAddLink(action: JarAction): string {
        return `/add?type=expense&category=${encodeURIComponent(action.category)}&note=${encodeURIComponent(action.note)}`;
    }

    function buildJarActions(jars: JarAnalytics[]): JarAction[] {
        return jars
            .filter((jar) => jar.key !== "expense")
            .map((jar) => {
                const gap = jar.amount - jar.actual;
                const positive = gap <= 0;
                const absGap = Math.abs(gap).toLocaleString();
                return {
                    key: jar.key,
                    title: positive
                        ? `${jar.label} เกินเป้า ฿${absGap}`
                        : `${jar.label} ต่ำกว่าเป้า ฿${absGap}`,
                    summary: positive
                        ? `ทำได้ ฿${jar.actual.toLocaleString()} จากเป้า ฿${jar.amount.toLocaleString()}`
                        : `ตอนนี้ทำได้ ฿${jar.actual.toLocaleString()} จากเป้า ฿${jar.amount.toLocaleString()}`,
                    category: jarCategoryMap[jar.key],
                    note: positive
                        ? `ติดตามกระปุก ${jar.label} ต่อเนื่องตามแผน 4 กระปุก`
                        : `เติมกระปุก ${jar.label} ให้ถึงเป้าเดือนนี้`,
                    cta: jarCtaMap[jar.key],
                    positive,
                };
            });
    }

    function normalizeCoachJarKey(input: unknown): JarKey | null {
        const value = String(input || "")
            .trim()
            .toLowerCase();
        if (
            value === "expense" ||
            value === "saving" ||
            value === "investment" ||
            value === "debt"
        ) {
            return value;
        }
        return null;
    }

    function normalizeCoachPriority(input: unknown): CoachPriority {
        const value = String(input || "")
            .trim()
            .toLowerCase();
        if (value === "high" || value === "medium" || value === "low") {
            return value;
        }
        return "medium";
    }

    function priorityBadgeClass(priority: CoachPriority): string {
        if (priority === "high") return "bg-rose-100 text-rose-700";
        if (priority === "medium") return "bg-amber-100 text-amber-700";
        return "bg-emerald-100 text-emerald-700";
    }

    function priorityLabel(priority: CoachPriority): string {
        if (priority === "high") return "เร่งด่วน";
        if (priority === "medium") return "ปานกลาง";
        return "ติดตาม";
    }

    function buildCoachAddLink(recommendation: CoachRecommendation): string {
        const normalizedJar = normalizeCoachJarKey(recommendation.jar_key);
        const fallbackCategory = normalizedJar
            ? jarCategoryMap[normalizedJar]
            : "Other (อื่นๆ)";
        const category = recommendation.category_hint?.trim() || fallbackCategory;
        const noteSeed =
            recommendation.note_hint?.trim() ||
            `${recommendation.title}: ${recommendation.action}`;
        const note = noteSeed.slice(0, 180);
        return `/add?type=expense&category=${encodeURIComponent(category)}&note=${encodeURIComponent(note)}`;
    }

    function resetCoachState() {
        coachSummary = "";
        coachRecommendations = [];
        coachConfidence = null;
        coachSource = null;
        coachError = "";
        coachLoading = false;
    }

    function getThaiMonthLabel(year: number, month: number): string {
        return new Intl.DateTimeFormat("th-TH", {
            month: "long",
            year: "numeric",
        }).format(new Date(year, month - 1, 1));
    }

    async function loadCoachAdvice() {
        if (!$currentUser) return;

        const requestToken = ++coachRequestToken;
        coachLoading = true;
        coachError = "";

        const netSaving = totalIncome - totalExpense;
        const savingRate = totalIncome > 0 ? netSaving / totalIncome : 0;
        const payload = {
            month: getThaiMonthLabel(currentYear, currentMonth),
            totalIncome,
            totalExpense,
            totalLuxury,
            netSaving,
            savingRate: Math.max(0, Math.min(1, savingRate)),
            jarBreakdown: jarBreakdown.map((jar) => ({
                key: jar.key,
                label: jar.label,
                target: jar.amount,
                actual: jar.actual,
            })),
            topCategories: categoryBreakdown.slice(0, 5),
        };

        try {
            const response = await fetch("/api/financial-coach", {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                },
                body: JSON.stringify(payload),
            });
            const result = await response.json();

            if (requestToken !== coachRequestToken) return;
            if (!response.ok) {
                throw new Error(String(result?.error || `HTTP ${response.status}`));
            }

            const rawRecommendations: CoachRecommendationPayload[] = Array.isArray(
                result?.recommendations,
            )
                ? result.recommendations
                : [];
            const recommendations: CoachRecommendation[] = rawRecommendations
                .map((item: CoachRecommendationPayload) => ({
                    title: String(item?.title || "").trim(),
                    action: String(item?.action || "").trim(),
                    priority: normalizeCoachPriority(item?.priority),
                    jar_key: normalizeCoachJarKey(item?.jar_key) || undefined,
                    category_hint: String(item?.category_hint || "")
                        .trim()
                        .slice(0, 80),
                    note_hint: String(item?.note_hint || "")
                        .trim()
                        .slice(0, 180),
                }))
                .filter((item: CoachRecommendation) => item.title && item.action)
                .slice(0, 4);

            coachSummary = String(result?.summary || "").trim();
            coachRecommendations = recommendations;
            coachSource =
                result?.source === "minimax" || result?.source === "fallback"
                    ? result.source
                    : null;

            const confidenceRaw = Number.parseFloat(
                String(result?.confidence ?? ""),
            );
            coachConfidence = Number.isFinite(confidenceRaw)
                ? Math.max(0, Math.min(1, confidenceRaw))
                : null;
        } catch (error) {
            if (requestToken !== coachRequestToken) return;
            console.error("Failed to fetch financial coach:", error);
            coachError = "โหลดคำแนะนำ AI ไม่สำเร็จ ลองใหม่อีกครั้ง";
            coachSummary = "";
            coachRecommendations = [];
            coachConfidence = null;
            coachSource = null;
        } finally {
            if (requestToken === coachRequestToken) {
                coachLoading = false;
            }
        }
    }

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
        jarActions = [];
        jarBreakdown = getJarAllocations(0).map((jar) => ({
            ...jar,
            actual: 0,
            progress: 0,
        }));
        coachRequestToken += 1;
        resetCoachState();
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

        const { data: transactions, error } = await supabase
            .from("transactions")
            .select("*")
            .gte("date", startOfMonth)
            .lte("date", endOfMonth)
            .eq("owner", owner);

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
                const resolvedJar = resolveJarForTransaction({
                    jar_key: tx.jar_key,
                    category: tx.category,
                });
                actualByJar[resolvedJar] += tx.amount;
            });

            jarBreakdown = getJarAllocations(totalIncome).map((jar) => ({
                ...jar,
                actual: actualByJar[jar.key],
                progress:
                    jar.amount > 0 ? (actualByJar[jar.key] / jar.amount) * 100 : 0,
            }));
            jarActions = buildJarActions(jarBreakdown);

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

            if (transactions.length > 0) {
                void loadCoachAdvice();
            } else {
                coachSummary =
                    "ยังไม่มีข้อมูลเดือนนี้ เพิ่มรายการเพื่อให้ AI วิเคราะห์พฤติกรรมการเงิน";
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

        <!-- Actionable Advice -->
        <div class="bg-white rounded-xl shadow-sm border border-slate-100 p-4">
            <h3 class="font-bold text-slate-700 mb-3">คำแนะนำที่ทำได้ทันที</h3>
            {#if jarActions.length === 0}
                <div class="text-xs text-slate-500">ยังไม่มีคำแนะนำในเดือนนี้</div>
            {:else}
                <div class="space-y-2">
                    {#each jarActions as action}
                        <div
                            class="rounded-lg border p-3 {action.positive
                                ? 'border-emerald-100 bg-emerald-50'
                                : 'border-amber-100 bg-amber-50'}"
                        >
                            <div
                                class="font-semibold text-sm {action.positive
                                    ? 'text-emerald-800'
                                    : 'text-amber-800'}"
                            >
                                {action.title}
                            </div>
                            <div class="text-xs text-slate-600 mt-1">
                                {action.summary}
                            </div>
                            <a
                                href={buildAddLink(action)}
                                class="mt-2 inline-flex items-center gap-1 text-xs font-medium {action.positive
                                    ? 'text-emerald-700'
                                    : 'text-amber-700'} hover:underline"
                            >
                                {action.cta}
                                <ArrowUpRight size={12} />
                            </a>
                        </div>
                    {/each}
                </div>
            {/if}
        </div>

        <!-- AI Coach -->
        <div class="bg-white rounded-xl shadow-sm border border-slate-100 p-4">
            <div class="flex items-center justify-between gap-2 mb-3">
                <h3 class="font-bold text-slate-700">AI โค้ชนิสัยการเงิน</h3>
                <button
                    type="button"
                    on:click={loadCoachAdvice}
                    disabled={coachLoading ||
                        (totalIncome === 0 && totalExpense === 0 && categoryBreakdown.length === 0)}
                    class="text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {coachLoading ? "กำลังวิเคราะห์..." : "วิเคราะห์ใหม่"}
                </button>
            </div>

            {#if coachLoading}
                <div class="text-xs text-slate-500">
                    AI กำลังวิเคราะห์พฤติกรรมการเงิน...
                </div>
            {:else if coachError}
                <div class="text-xs text-rose-600">{coachError}</div>
            {:else if coachSummary}
                <p class="text-sm text-slate-700 bg-slate-50 rounded-lg border border-slate-100 p-3">
                    {coachSummary}
                </p>

                {#if coachRecommendations.length > 0}
                    <div class="space-y-2 mt-3">
                        {#each coachRecommendations as recommendation}
                            <div class="rounded-lg border border-slate-200 p-3">
                                <div class="flex items-center justify-between gap-2">
                                    <div class="font-semibold text-sm text-slate-800">
                                        {recommendation.title}
                                    </div>
                                    <span
                                        class="text-[11px] font-medium px-2 py-0.5 rounded-full {priorityBadgeClass(recommendation.priority)}"
                                    >
                                        {priorityLabel(recommendation.priority)}
                                    </span>
                                </div>
                                <div class="text-xs text-slate-600 mt-1">
                                    {recommendation.action}
                                </div>
                                <a
                                    href={buildCoachAddLink(recommendation)}
                                    class="mt-2 inline-flex items-center gap-1 text-xs font-medium text-slate-700 hover:underline"
                                >
                                    ไปเพิ่มรายการตามคำแนะนำ
                                    <ArrowUpRight size={12} />
                                </a>
                            </div>
                        {/each}
                    </div>
                {/if}

                {#if coachSource || coachConfidence !== null}
                    <div class="mt-3 text-[11px] text-slate-400">
                        แหล่งวิเคราะห์: {coachSource === "minimax"
                            ? "MiniMax"
                            : coachSource === "fallback"
                              ? "Fallback"
                              : "ไม่ระบุ"}
                        {#if coachConfidence !== null}
                            • ความมั่นใจ {Math.round(coachConfidence * 100)}%
                        {/if}
                    </div>
                {/if}
            {:else}
                <div class="text-xs text-slate-500">
                    ยังไม่มีข้อมูลเพียงพอสำหรับวิเคราะห์
                </div>
            {/if}
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
