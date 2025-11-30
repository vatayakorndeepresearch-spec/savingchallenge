<script lang="ts">
    import { onMount } from "svelte";
    import { supabase } from "$lib/supabaseClient";
    import { format } from "date-fns";
    import { ChevronRight, Gem } from "lucide-svelte";
    import { currentUser } from "$lib/userStore";

    let transactions: any[] = [];
    let loading = true;
    let selectedMonth = new Date().toISOString().slice(0, 7); // YYYY-MM

    $: if ($currentUser) {
        loadTransactions();
    }

    async function loadTransactions() {
        loading = true;
        const [year, month] = selectedMonth.split("-");
        const startOfMonth = new Date(
            parseInt(year),
            parseInt(month) - 1,
            1,
        ).toISOString();
        const endOfMonth = new Date(
            parseInt(year),
            parseInt(month),
            0,
            23,
            59,
            59,
        ).toISOString();

        const { data, error } = await supabase
            .from("transactions")
            .select("*")
            .gte("date", startOfMonth)
            .lte("date", endOfMonth)
            .eq("owner", $currentUser) // Filter by owner
            .order("date", { ascending: false });

        if (error) console.error(error);
        else transactions = data || [];

        loading = false;
    }

    onMount(loadTransactions);
</script>

<div class="space-y-4">
    <div class="flex justify-between items-center">
        <h2 class="text-xl font-bold text-slate-800">รายการของฉัน</h2>
        <input
            type="month"
            bind:value={selectedMonth}
            on:change={loadTransactions}
            class="border border-slate-200 rounded-lg px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-pink-500"
        />
    </div>

    {#if loading}
        <div class="text-center py-10 text-slate-400">กำลังโหลด...</div>
    {:else if transactions.length === 0}
        <div
            class="text-center py-10 bg-white rounded-xl border border-slate-100"
        >
            <p class="text-slate-500">ไม่พบรายการในเดือนนี้</p>
        </div>
    {:else}
        <div
            class="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden"
        >
            {#each transactions as tx}
                <a
                    href="/transactions/{tx.id}"
                    class="block hover:bg-slate-50 transition-colors border-b border-slate-100 last:border-0"
                >
                    <div class="p-4 flex items-center justify-between">
                        <div class="flex items-center gap-4">
                            <div
                                class="w-12 h-12 rounded-full flex items-center justify-center text-xl font-bold {tx.type ===
                                'income'
                                    ? 'bg-emerald-100 text-emerald-600'
                                    : 'bg-rose-100 text-rose-600'}"
                            >
                                {tx.type === "income" ? "+" : "-"}
                            </div>
                            <div>
                                <div
                                    class="font-medium text-slate-800 flex items-center gap-2"
                                >
                                    {tx.category}
                                    {#if tx.category.toLowerCase() === "luxury"}
                                        <span
                                            class="bg-purple-100 text-purple-600 text-xs px-2 py-0.5 rounded-full flex items-center gap-1"
                                        >
                                            <Gem size={10} /> Luxury
                                        </span>
                                    {/if}
                                </div>
                                <div class="text-xs text-slate-500">
                                    {format(new Date(tx.date), "dd MMM yyyy")}
                                </div>
                            </div>
                        </div>
                        <div class="flex items-center gap-2">
                            <span
                                class="font-bold {tx.type === 'income'
                                    ? 'text-emerald-600'
                                    : 'text-slate-700'}"
                            >
                                {tx.type === "income"
                                    ? "+"
                                    : "-"}฿{tx.amount.toLocaleString()}
                            </span>
                            <ChevronRight size={16} class="text-slate-300" />
                        </div>
                    </div>
                </a>
            {/each}
        </div>
    {/if}
</div>
