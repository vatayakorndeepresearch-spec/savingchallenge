<script lang="ts">
    import { onMount } from "svelte";
    import { supabase } from "$lib/supabaseClient";
    import { Save } from "lucide-svelte";

    import { currentUser } from "$lib/userStore";

    let amount: number | null = null;
    let loading = true;
    let saving = false;

    const today = new Date();
    const currentMonth = today.getMonth() + 1;
    const currentYear = today.getFullYear();

    // Reload when user changes
    $: if ($currentUser) {
        loadBudget();
    }

    async function loadBudget() {
        loading = true;
        const { data, error } = await supabase
            .from("budgets")
            .select("amount")
            .eq("year", currentYear)
            .eq("month", currentMonth)
            .eq("owner", $currentUser)
            .single();

        if (data) {
            amount = data.amount;
        } else {
            amount = null;
        }
        loading = false;
    }

    onMount(loadBudget);

    async function handleSave() {
        if (amount === null) return;
        saving = true;

        const { error } = await supabase.from("budgets").upsert(
            {
                year: currentYear,
                month: currentMonth,
                amount: amount,
                owner: $currentUser,
            },
            { onConflict: "year,month,owner" },
        );

        if (error) {
            console.error(error);
            alert("Failed to save budget");
        } else {
            alert("บันทึกงบประมาณเรียบร้อยแล้ว");
        }
        saving = false;
    }
</script>

<div class="bg-white rounded-xl shadow-sm border border-slate-100 p-6">
    <h2 class="text-xl font-bold text-slate-800 mb-2">ตั้งงบประมาณรายเดือน</h2>
    <p class="text-slate-500 text-sm mb-6">
        กำหนดงบประมาณสำหรับเดือน {currentMonth}/{currentYear}
    </p>

    {#if loading}
        <div class="text-center py-4">กำลังโหลด...</div>
    {:else}
        <form on:submit|preventDefault={handleSave} class="space-y-4">
            <div>
                <label
                    for="budget-amount"
                    class="block text-sm font-medium text-slate-700 mb-1"
                    >วงเงินงบประมาณ (บาท)</label
                >
                <input
                    id="budget-amount"
                    type="number"
                    bind:value={amount}
                    required
                    min="0"
                    step="0.01"
                    class="w-full px-4 py-3 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent text-xl font-bold text-slate-800"
                    placeholder="0.00"
                />
            </div>

            <button
                type="submit"
                disabled={saving}
                class="w-full bg-slate-800 text-white font-bold py-3 rounded-xl hover:bg-slate-900 transition-colors shadow-md disabled:opacity-50 flex justify-center items-center gap-2"
            >
                <Save size={20} />
                {saving ? "กำลังบันทึก..." : "บันทึกงบประมาณ"}
            </button>
        </form>
    {/if}
</div>
