<script lang="ts">
    import { page } from "$app/stores";
    import { onMount } from "svelte";
    import { supabase } from "$lib/supabaseClient";
    import { format } from "date-fns";
    import { ArrowLeft, Gem, Trash2, Pencil } from "lucide-svelte";
    import { goto } from "$app/navigation";

    const { id } = $page.params;
    let transaction: any = null;
    let loading = true;
    let imageUrl: string | null = null;

    async function handleDelete() {
        if (!confirm("คุณแน่ใจหรือไม่ที่จะลบรายการนี้?")) return;

        const { error } = await supabase
            .from("transactions")
            .delete()
            .eq("id", id);

        if (error) {
            console.error("Error deleting transaction:", error);
            alert("Failed to delete transaction");
        } else {
            goto("/transactions");
        }
    }

    onMount(async () => {
        const { data, error } = await supabase
            .from("transactions")
            .select("*")
            .eq("id", id)
            .single();

        if (error) {
            console.error(error);
        } else {
            transaction = data;
            if (transaction.image_path) {
                const { data: publicUrlData } = supabase.storage
                    .from("receipts")
                    .getPublicUrl(transaction.image_path);
                imageUrl = publicUrlData.publicUrl;
            }
        }
        loading = false;
    });
</script>

<div class="space-y-6">
    <a
        href="/transactions"
        class="inline-flex items-center gap-2 text-slate-500 hover:text-slate-800 transition-colors"
    >
        <ArrowLeft size={20} />
        กลับไปหน้ารายการ
    </a>

    <div class="flex gap-2">
        <a
            href="/add?id={transaction?.id}"
            class="px-4 py-2 bg-blue-50 text-blue-600 rounded-lg text-sm font-medium hover:bg-blue-100 transition-colors flex items-center gap-2"
        >
            <Pencil size={16} />
            แก้ไข
        </a>
        <button
            on:click={handleDelete}
            class="px-4 py-2 bg-rose-50 text-rose-600 rounded-lg text-sm font-medium hover:bg-rose-100 transition-colors flex items-center gap-2"
        >
            <Trash2 size={16} />
            ลบ
        </button>
    </div>

    {#if loading}
        <div class="text-center py-10 text-slate-400">กำลังโหลด...</div>
    {:else if transaction}
        <div
            class="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden"
        >
            <div class="p-6 border-b border-slate-100">
                <div class="flex justify-between items-start mb-4">
                    <div>
                        <span
                            class="inline-block px-3 py-1 rounded-full text-xs font-medium mb-2 {transaction.type ===
                            'income'
                                ? 'bg-emerald-100 text-emerald-700'
                                : 'bg-rose-100 text-rose-700'}"
                        >
                            {transaction.type === "income"
                                ? "รายรับ"
                                : "รายจ่าย"}
                        </span>
                        <h1 class="text-2xl font-bold text-slate-800">
                            {transaction.category}
                        </h1>
                        {#if transaction.category.toLowerCase() === "luxury"}
                            <span
                                class="inline-flex items-center gap-1 text-purple-600 text-sm mt-1"
                            >
                                <Gem size={14} /> รายจ่ายฟุ่มเฟือย
                            </span>
                        {/if}
                    </div>
                    <div
                        class="text-2xl font-bold {transaction.type === 'income'
                            ? 'text-emerald-600'
                            : 'text-slate-700'}"
                    >
                        {transaction.type === "income"
                            ? "+"
                            : "-"}฿{transaction.amount.toLocaleString()}
                    </div>
                </div>

                <div class="text-slate-500 text-sm">
                    วันที่: {format(new Date(transaction.date), "dd MMMM yyyy")}
                </div>

                {#if transaction.note}
                    <div
                        class="mt-4 p-4 bg-slate-50 rounded-lg text-slate-700 text-sm"
                    >
                        {transaction.note}
                    </div>
                {/if}
            </div>

            {#if imageUrl}
                <div class="p-6">
                    <h3 class="text-sm font-medium text-slate-700 mb-3">
                        รูปใบเสร็จ / สลิป
                    </h3>
                    <img
                        src={imageUrl}
                        alt="Receipt"
                        class="w-full rounded-lg border border-slate-200"
                    />
                </div>
            {/if}
        </div>
    {:else}
        <div class="text-center py-10">ไม่พบข้อมูล</div>
    {/if}
</div>
