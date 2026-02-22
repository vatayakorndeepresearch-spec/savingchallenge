<script lang="ts">
    import { supabase } from "$lib/supabaseClient";
    import { goto } from "$app/navigation";
    import { Upload, Loader2 } from "lucide-svelte";
    import { currentUser } from "$lib/userStore";
    import { getJarAllocations, type JarAllocation } from "$lib/jars";

    import { page } from "$app/stores";
    import { onMount } from "svelte";

    let type: "income" | "expense" = "expense";
    let amount: number | null = null;
    let category = "";
    let date = new Date().toISOString().split("T")[0];
    let note = "";
    let file: File | null = null;
    let loading = false;
    let isEditMode = false;
    let transactionId: string | null = null;
    let currentImagePath: string | null = null;

    const expenseCategories = [
        "Food (อาหาร)",
        "Transport (เดินทาง)",
        "Shopping (ช้อปปิ้ง)",
        "Luxury (ฟุ่มเฟือย)",
        "Bills (บิล/สาธารณูปโภค)",
        "Health (สุขภาพ)",
        "Entertainment (บันเทิง)",
        "Donation (บริจาค)",
        "Saving (ออม)",
        "Investment (ลงทุน)",
        "Debt (หนี้)",
        "No Spend",
        "Other (อื่นๆ)",
    ];

    const incomeCategories = [
        "Salary (เงินเดือน)",
        "Bonus (โบนัส)",
        "Freelance (ฟรีแลนซ์)",
        "Other (อื่นๆ)",
    ];

    function getCategoriesByType(targetType: "income" | "expense") {
        return targetType === "income" ? incomeCategories : expenseCategories;
    }

    let categories = getCategoriesByType(type);
    $: categories = getCategoriesByType(type);

    let incomeAllocationPreview: JarAllocation[] = [];
    $: incomeAllocationPreview =
        type === "income" && amount && amount > 0 ? getJarAllocations(amount) : [];

    let customCategory = "";

    onMount(async () => {
        transactionId = $page.url.searchParams.get("id");
        if (transactionId) {
            isEditMode = true;
            loading = true;
            const { data, error } = await supabase
                .from("transactions")
                .select("*")
                .eq("id", transactionId)
                .single();

            if (data) {
                type = data.type;
                amount = data.amount;
                date = data.date;
                note = data.note || "";
                currentImagePath = data.image_path;

                // Handle category
                const availableCategories = getCategoriesByType(data.type);
                if (availableCategories.includes(data.category)) {
                    category = data.category;
                } else {
                    category = "Other (อื่นๆ)";
                    customCategory = data.category;
                }

                if (currentImagePath) {
                    const { data: publicUrlData } = supabase.storage
                        .from("receipts")
                        .getPublicUrl(currentImagePath);
                    previewUrl = publicUrlData.publicUrl;
                }
            }
            loading = false;
        } else {
            // Ensure date is always today when adding new transaction
            date = new Date().toISOString().split("T")[0];
        }
    });

    $: if (category && !categories.includes(category)) {
        category = "";
    }

    $: if (!category.startsWith("Other")) {
        customCategory = "";
    }

    async function handleSubmit() {
        // Use custom category if 'Other' is selected
        const finalCategory =
            category.startsWith("Other") && customCategory
                ? customCategory
                : category;

        if (!amount || !finalCategory) return;
        loading = true;

        let image_path = currentImagePath;

        if (file) {
            const fileExt = file.name.split(".").pop();
            const fileName = `${Math.random()}.${fileExt}`;
            const filePath = `${$currentUser}/${fileName}`;

            const { error: uploadError } = await supabase.storage
                .from("receipts")
                .upload(filePath, file);

            if (uploadError) {
                console.error("Upload error:", uploadError);
                alert("Failed to upload image");
                loading = false;
                return;
            }
            image_path = filePath;
        }

        const payload = {
            type,
            amount,
            category: finalCategory,
            date,
            note,
            image_path,
            owner: $currentUser,
        };

        let error;
        if (isEditMode && transactionId) {
            const { error: updateError } = await supabase
                .from("transactions")
                .update(payload)
                .eq("id", transactionId);
            error = updateError;
        } else {
            const { error: insertError } = await supabase
                .from("transactions")
                .insert(payload);
            error = insertError;
        }

        if (error) {
            console.error("Error saving transaction:", error);
            alert("Failed to save transaction");
        } else {
            if (isEditMode) {
                goto(`/transactions/${transactionId}`);
            } else {
                goto("/");
            }
        }
        loading = false;
    }

    let previewUrl: string | null = null;

    async function handleNoSpend() {
        if (!confirm("ยืนยันว่าวันนี้ไม่ได้ใช้เงินเลย? (สุดยอด! 🎉)")) return;

        loading = true;
        const { error } = await supabase.from("transactions").insert({
            type: "expense",
            amount: 0,
            category: "No Spend",
            date,
            note: "No Spend Day! 🎉",
            owner: $currentUser,
        });

        if (error) {
            console.error("Error saving no spend day:", error);
            alert("Failed to save no spend day");
        } else {
            goto("/");
        }
        loading = false;
    }

    function handleFileSelect(e: Event) {
        const target = e.target as HTMLInputElement;
        if (target.files && target.files.length > 0) {
            file = target.files[0];
            const reader = new FileReader();
            reader.onload = (e) => {
                previewUrl = e.target?.result as string;
            };
            reader.readAsDataURL(file);
        }
    }
</script>

<div class="bg-white rounded-xl shadow-sm border border-slate-100 p-6">
    <div class="flex justify-between items-center mb-6">
        <h2 class="text-xl font-bold text-slate-800">
            {isEditMode ? "แก้ไขรายการ" : "บันทึกรายการใหม่"}
        </h2>
        {#if !isEditMode}
            <button
                type="button"
                on:click={handleNoSpend}
                class="text-xs bg-gradient-to-r from-yellow-400 to-orange-500 text-white px-3 py-1.5 rounded-full font-bold shadow-sm hover:shadow-md transition-all transform hover:scale-105 active:scale-95 flex items-center gap-1"
            >
                ✨ วันนี้ไม่ได้ใช้เงินเลย!
            </button>
        {/if}
    </div>

    <form on:submit|preventDefault={handleSubmit} class="space-y-4">
        <!-- Type Switcher -->
        <div class="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-lg">
            <button
                type="button"
                class="py-2 rounded-md font-medium transition-colors {type ===
                'income'
                    ? 'bg-white text-emerald-600 shadow-sm'
                    : 'text-slate-500'}"
                on:click={() => (type = "income")}
            >
                รายรับ
            </button>
            <button
                type="button"
                class="py-2 rounded-md font-medium transition-colors {type ===
                'expense'
                    ? 'bg-white text-rose-600 shadow-sm'
                    : 'text-slate-500'}"
                on:click={() => (type = "expense")}
            >
                รายจ่าย
            </button>
        </div>

        <!-- Amount -->
        <div>
            <label
                for="amount"
                class="block text-sm font-medium text-slate-700 mb-1"
                >จำนวนเงิน</label
            >
            <input
                id="amount"
                type="number"
                bind:value={amount}
                required
                min="0"
                step="0.01"
                class="w-full px-4 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent text-lg"
                placeholder="0.00"
            />
        </div>

        {#if type === "income" && incomeAllocationPreview.length > 0}
            <div class="rounded-xl border border-emerald-100 bg-emerald-50 p-4">
                <h3 class="font-bold text-emerald-800 mb-1">
                    Auto-Allocation 4 กระปุก
                </h3>
                <p class="text-xs text-emerald-700 mb-3">
                    ระบบแนะนำการแบ่งรายรับทันทีตามสัดส่วน 40/20/20/20
                </p>
                <div class="grid grid-cols-2 gap-2">
                    {#each incomeAllocationPreview as jar}
                        <div class="bg-white rounded-lg p-3 border border-emerald-100">
                            <div class="text-[11px] text-slate-500">
                                {jar.label} ({Math.round(jar.percent * 100)}%)
                            </div>
                            <div class="font-bold text-slate-800 text-sm">
                                ฿{jar.amount.toLocaleString()}
                            </div>
                            <div class="text-[11px] text-slate-500">
                                {jar.labelTh}
                            </div>
                        </div>
                    {/each}
                </div>
            </div>
        {/if}

        <!-- Category -->
        <div>
            <label
                for="category"
                class="block text-sm font-medium text-slate-700 mb-1"
                >หมวดหมู่</label
            >
            <select
                id="category"
                bind:value={category}
                required
                class="w-full px-4 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent bg-white"
            >
                <option value="" disabled selected>เลือกหมวดหมู่</option>
                {#each categories as cat}
                    <option value={cat}>{cat}</option>
                {/each}
            </select>

            {#if category.startsWith("Other")}
                <input
                    type="text"
                    bind:value={customCategory}
                    required
                    class="mt-2 w-full px-4 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent"
                    placeholder="ระบุชื่อหมวดหมู่..."
                    aria-label="ระบุชื่อหมวดหมู่"
                />
            {/if}
        </div>

        <!-- Date -->
        <div>
            <label
                for="date"
                class="block text-sm font-medium text-slate-700 mb-1"
                >วันที่</label
            >
            <input
                id="date"
                type="date"
                bind:value={date}
                required
                class="w-full px-4 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent"
            />
        </div>

        <!-- Note -->
        <div>
            <label
                for="note"
                class="block text-sm font-medium text-slate-700 mb-1"
                >บันทึกช่วยจำ (ถ้ามี)</label
            >
            <textarea
                id="note"
                bind:value={note}
                rows="2"
                class="w-full px-4 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent"
                placeholder="รายละเอียดเพิ่มเติม..."
            ></textarea>
        </div>

        <!-- Image Upload -->
        <div>
            <label
                for="file-upload-label"
                class="block text-sm font-medium text-slate-700 mb-1"
                >รูปสลิป / ใบเสร็จ</label
            >
            <div class="relative">
                <input
                    type="file"
                    accept="image/*"
                    on:change={handleFileSelect}
                    class="hidden"
                    id="file-upload"
                />
                <label
                    id="file-upload-label"
                    for="file-upload"
                    class="flex flex-col items-center justify-center gap-2 w-full px-4 py-3 border-2 border-dashed border-slate-300 rounded-lg cursor-pointer hover:border-pink-500 hover:text-pink-500 transition-colors text-slate-500 overflow-hidden"
                >
                    {#if previewUrl}
                        <img
                            src={previewUrl}
                            alt="Preview"
                            class="max-h-48 rounded-lg object-contain"
                        />
                        <span class="text-xs mt-2">แตะเพื่อเปลี่ยนรูป</span>
                    {:else}
                        <Upload size={20} />
                        <span>{file ? file.name : "อัพโหลดรูปภาพ"}</span>
                    {/if}
                </label>
            </div>
        </div>

        <!-- Submit Button -->
        <button
            type="submit"
            disabled={loading}
            class="w-full bg-pink-500 text-white font-bold py-3 rounded-xl hover:bg-pink-600 transition-colors shadow-md disabled:opacity-50 disabled:cursor-not-allowed flex justify-center items-center gap-2"
        >
            {#if loading}
                <Loader2 class="animate-spin" size={20} />
                กำลังบันทึก...
            {:else}
                {isEditMode ? "อัพเดทรายการ" : "บันทึกรายการ"}
            {/if}
        </button>
    </form>
</div>
