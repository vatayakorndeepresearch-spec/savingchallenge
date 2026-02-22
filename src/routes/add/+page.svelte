<script lang="ts">
    import { supabase } from "$lib/supabaseClient";
    import { goto } from "$app/navigation";
    import { Upload, Loader2 } from "lucide-svelte";
    import { currentUser } from "$lib/userStore";
    import {
        getJarAllocations,
        resolveJarForExpenseCategory,
        type JarAllocation,
        type JarKey,
    } from "$lib/jars";
    import { runSlipOcr, type SlipOcrResult } from "$lib/slipOcr";
    import { resolveOwner } from "$lib/owner";
    import { getReceiptPreviewUrl } from "$lib/receiptUrl";
    import { prepareReceiptUpload } from "$lib/utils/receiptUpload";
    import {
        getCategoriesByType,
        getAiAllowedCategories,
        type TransactionType,
    } from "$lib/categories";

    import { page } from "$app/stores";
    import { onMount } from "svelte";

    let type: TransactionType = "expense";
    let amount: number | null = null;
    let category = "";
    let date = new Date().toISOString().split("T")[0];
    let note = "";
    let file: File | null = null;
    let loading = false;
    let isEditMode = false;
    let transactionId: string | null = null;
    let currentImagePath: string | null = null;

    let categories = getCategoriesByType(type);
    $: categories = getCategoriesByType(type);

    let incomeAllocationPreview: JarAllocation[] = [];
    $: incomeAllocationPreview =
        type === "income" && amount && amount > 0 ? getJarAllocations(amount) : [];

    let customCategory = "";
    let ocrLoading = false;
    let ocrProgress = 0;
    let ocrError = "";
    let ocrResult: SlipOcrResult | null = null;
    let ocrAutoFilled = false;
    let ocrPendingApply = false;
    let ocrRawText: string | null = null;
    let ocrConfidence: number | null = null;
    let ocrAnalysisToken = 0;
    let aiCategorizing = false;
    let aiCategoryMessage = "";
    let aiCategoryConfidence: number | null = null;
    let aiCategorySource: "minimax" | "fallback" | null = null;
    let supportsOcrColumns: boolean | null = null;

    const MAX_OCR_RAW_TEXT_LENGTH = 12000;

    onMount(async () => {
        transactionId = $page.url.searchParams.get("id");
        if (transactionId) {
            isEditMode = true;
            loading = true;
            const { owner } = await resolveOwner(supabase, $currentUser);
            if (!owner) {
                loading = false;
                alert("ไม่พบผู้ใช้สำหรับโหลดข้อมูล");
                return;
            }

            const { data, error } = await supabase
                .from("transactions")
                .select("*")
                .eq("id", transactionId)
                .eq("owner", owner)
                .single();

            if (data) {
                type = data.type;
                amount = data.amount;
                date = data.date;
                note = data.note || "";
                currentImagePath = data.image_path;
                ocrRawText = data.ocr_raw_text || null;
                const parsedConfidence = Number.parseFloat(
                    String(data.ocr_confidence ?? ""),
                );
                ocrConfidence = Number.isFinite(parsedConfidence)
                    ? parsedConfidence
                    : null;

                // Handle category
                const availableCategories = getCategoriesByType(data.type);
                if (availableCategories.includes(data.category)) {
                    category = data.category;
                } else {
                    category = "Other (อื่นๆ)";
                    customCategory = data.category;
                }

                if (currentImagePath) {
                    previewUrl = await getReceiptPreviewUrl(currentImagePath);
                }
            }
            loading = false;
        } else {
            // Ensure date is always today when adding new transaction
            date = new Date().toISOString().split("T")[0];

            const presetType = $page.url.searchParams.get("type");
            if (presetType === "income" || presetType === "expense") {
                type = presetType;
            }

            const presetCategory = $page.url.searchParams.get("category");
            if (presetCategory) {
                const availableCategories = getCategoriesByType(type);
                if (availableCategories.includes(presetCategory)) {
                    category = presetCategory;
                } else {
                    category = "Other (อื่นๆ)";
                    customCategory = presetCategory;
                }
            }

            const presetNote = $page.url.searchParams.get("note");
            if (presetNote) {
                note = presetNote;
            }
        }
    });

    $: if (category && !categories.includes(category)) {
        category = "";
    }

    $: if (!category.startsWith("Other")) {
        customCategory = "";
    }

    async function resolveOwnerForWrite(): Promise<string> {
        const { owner } = await resolveOwner(supabase, $currentUser);
        if (!owner) throw new Error("Owner is not available");
        return owner;
    }

    async function cleanupReceiptUpload(filePath: string | null): Promise<void> {
        if (!filePath) return;
        const { error } = await supabase.storage.from("receipts").remove([filePath]);
        if (error) {
            console.warn("Receipt cleanup failed:", error);
        }
    }

    function normalizeOcrRawText(value: string | null): string | null {
        const text = typeof value === "string" ? value.trim() : "";
        if (!text) return null;
        return text.length > MAX_OCR_RAW_TEXT_LENGTH
            ? text.slice(0, MAX_OCR_RAW_TEXT_LENGTH)
            : text;
    }

    function normalizeOcrConfidence(value: number | null): number | null {
        if (typeof value !== "number" || !Number.isFinite(value)) return null;
        const clamped = Math.max(0, Math.min(100, value));
        return Math.round((clamped + Number.EPSILON) * 100) / 100;
    }

    function isOcrMetadataError(message: string): boolean {
        const lowered = message.toLowerCase();
        return lowered.includes("ocr_raw_text") || lowered.includes("ocr_confidence");
    }

    async function writeTransactionWithOptionalOcrColumns(
        basePayload: Record<string, unknown>,
        optionalOcrPayload: Record<string, unknown>,
        ownerForWrite: string,
    ) {
        const hasOcrMetadata = Object.keys(optionalOcrPayload).length > 0;
        let includeOcrMetadata = supportsOcrColumns !== false && hasOcrMetadata;

        const runWrite = async (payload: Record<string, unknown>) => {
            if (isEditMode && transactionId) {
                const { error: updateError } = await supabase
                    .from("transactions")
                    .update(payload)
                    .eq("id", transactionId)
                    .eq("owner", ownerForWrite);
                return updateError;
            }

            const { error: insertError } = await supabase
                .from("transactions")
                .insert(payload);
            return insertError;
        };

        let error = await runWrite(
            includeOcrMetadata ? { ...basePayload, ...optionalOcrPayload } : basePayload,
        );

        if (!error && includeOcrMetadata) {
            supportsOcrColumns = true;
            return null;
        }

        const message =
            typeof error === "object" && error && "message" in error
                ? String((error as { message?: unknown }).message || "")
                : "";

        if (error && includeOcrMetadata && isOcrMetadataError(message)) {
            supportsOcrColumns = false;
            includeOcrMetadata = false;
            error = await runWrite(basePayload);
        }

        if (!error && hasOcrMetadata && includeOcrMetadata === false) {
            supportsOcrColumns = false;
        }

        return error;
    }

    async function handleSubmit() {
        // Use custom category if 'Other' is selected
        const finalCategory =
            category.startsWith("Other") && customCategory
                ? customCategory
                : category;
        const jar_key: JarKey | null =
            type === "expense" ? resolveJarForExpenseCategory(finalCategory) : null;

        if (!amount || !finalCategory) return;
        loading = true;
        let ownerForWrite: string;
        try {
            ownerForWrite = await resolveOwnerForWrite();
        } catch (error) {
            console.error("Resolve owner failed:", error);
            alert("ไม่สามารถระบุเจ้าของข้อมูลได้ กรุณาเข้าสู่ระบบใหม่");
            loading = false;
            return;
        }

        let image_path = currentImagePath;
        let uploadedImagePath: string | null = null;

        if (file) {
            const prepared = await prepareReceiptUpload(file);
            const fileName = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}.${prepared.ext}`;
            const filePath = `${ownerForWrite}/${fileName}`;

            const { error: uploadError } = await supabase.storage
                .from("receipts")
                .upload(filePath, prepared.body, {
                    contentType: prepared.contentType,
                });

            if (uploadError) {
                console.error("Upload error:", uploadError);
                alert(`Failed to upload image: ${uploadError.message}`);
                loading = false;
                return;
            }
            image_path = filePath;
            uploadedImagePath = filePath;
        }

        const basePayload = {
            type,
            amount,
            category: finalCategory,
            date,
            note,
            image_path,
            jar_key,
            owner: ownerForWrite,
        };
        const optionalOcrPayload: Record<string, unknown> = {};
        const normalizedRawText = normalizeOcrRawText(ocrRawText);
        const normalizedConfidence = normalizeOcrConfidence(ocrConfidence);
        if (normalizedRawText !== null) optionalOcrPayload.ocr_raw_text = normalizedRawText;
        if (normalizedConfidence !== null) {
            optionalOcrPayload.ocr_confidence = normalizedConfidence;
        }

        const error = await writeTransactionWithOptionalOcrColumns(
            basePayload,
            optionalOcrPayload,
            ownerForWrite,
        );

        if (error) {
            await cleanupReceiptUpload(uploadedImagePath);
            console.error("Error saving transaction:", error);
            const message =
                typeof error === "object" && error && "message" in error
                    ? String((error as { message?: unknown }).message || "")
                    : "";
            alert(
                message
                    ? `Failed to save transaction: ${message}`
                    : "Failed to save transaction",
            );
        } else {
            const shouldCleanupPreviousReceipt =
                isEditMode &&
                uploadedImagePath &&
                currentImagePath &&
                currentImagePath !== uploadedImagePath;
            if (shouldCleanupPreviousReceipt) {
                await cleanupReceiptUpload(currentImagePath);
            }

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
        let ownerForWrite: string;
        try {
            ownerForWrite = await resolveOwnerForWrite();
        } catch (error) {
            console.error("Resolve owner failed:", error);
            alert("ไม่สามารถระบุเจ้าของข้อมูลได้ กรุณาเข้าสู่ระบบใหม่");
            loading = false;
            return;
        }
        const { error } = await supabase.from("transactions").insert({
            type: "expense",
            amount: 0,
            category: "No Spend",
            date,
            note: "No Spend Day! 🎉",
            jar_key: "expense",
            owner: ownerForWrite,
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
            ocrAutoFilled = false;
            ocrPendingApply = false;
            ocrResult = null;
            ocrError = "";
            ocrProgress = 0;
            ocrRawText = null;
            ocrConfidence = null;
            const reader = new FileReader();
            reader.onload = (e) => {
                previewUrl = e.target?.result as string;
            };
            reader.readAsDataURL(file);

            void analyzeSlip(file);
        }
    }

    function applyOcrResult(result: SlipOcrResult, force = false) {
        if (result.inferredType) {
            type = result.inferredType;
        }

        if (result.amount !== null) {
            amount = result.amount;
        }

        if (result.date) {
            date = result.date;
        }

        if (result.note && (force || !note.trim())) {
            note = result.note;
        }

        if (!category) {
            category =
                result.inferredType === "income"
                    ? "Salary (เงินเดือน)"
                    : "Other (อื่นๆ)";
        }

        const availableCategories = getCategoriesByType(type);
        if (!availableCategories.includes(category)) {
            category = "Other (อื่นๆ)";
        }

        ocrRawText = result.rawText || null;
        ocrConfidence = result.confidence;
        ocrAutoFilled = true;
    }

    function willOverwriteExistingValues(result: SlipOcrResult): boolean {
        const amountWillChange =
            result.amount !== null && amount !== null && amount !== result.amount;
        const dateWillChange = !!result.date && !!date && date !== result.date;
        const noteWillChange =
            !!result.note.trim() &&
            !!note.trim() &&
            note.trim() !== result.note.trim();

        return amountWillChange || dateWillChange || noteWillChange;
    }

    function handleApplyOcr() {
        if (!ocrResult) return;

        if (willOverwriteExistingValues(ocrResult)) {
            const shouldOverwrite = confirm(
                "OCR จะเขียนทับข้อมูลที่คุณกรอกไว้บางส่วน ต้องการดำเนินการต่อหรือไม่?",
            );
            if (!shouldOverwrite) return;
        }

        applyOcrResult(ocrResult, true);
        ocrPendingApply = false;
    }

    async function analyzeSlip(targetFile: File) {
        const currentToken = ++ocrAnalysisToken;
        ocrLoading = true;
        ocrProgress = 0;
        ocrError = "";

        try {
            const result = await runSlipOcr(targetFile, (progress) => {
                if (currentToken === ocrAnalysisToken) {
                    ocrProgress = progress;
                }
            });

            if (currentToken !== ocrAnalysisToken) return;
            ocrResult = result;
            ocrPendingApply = true;
            ocrAutoFilled = false;
        } catch (error) {
            if (currentToken !== ocrAnalysisToken) return;
            console.error("OCR error:", error);
            ocrError = "อ่านสลิปไม่สำเร็จ ลองอัปโหลดรูปที่คมชัดขึ้นอีกครั้ง";
        } finally {
            if (currentToken === ocrAnalysisToken) {
                ocrLoading = false;
            }
        }
    }

    async function categorizeFromNoteWithAI() {
        const trimmedNote = note.trim();
        if (!trimmedNote) {
            alert("กรุณาใส่บันทึกช่วยจำก่อนใช้ AI จัดหมวด");
            return;
        }

        aiCategorizing = true;
        aiCategoryMessage = "";
        aiCategoryConfidence = null;
        aiCategorySource = null;

        try {
            const response = await fetch("/api/classify-note", {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                },
                body: JSON.stringify({
                    note: trimmedNote,
                    type,
                    categories: getAiAllowedCategories(type),
                }),
            });

            const result = await response.json();
            if (!response.ok) {
                throw new Error(result?.error || "AI classification failed");
            }

            const selectedCategory = String(result.category || "").trim();
            if (categories.includes(selectedCategory)) {
                category = selectedCategory;
                customCategory = "";
            } else {
                category = "Other (อื่นๆ)";
            }

            aiCategoryConfidence = Number.isFinite(Number(result.confidence))
                ? Math.max(0, Math.min(1, Number(result.confidence)))
                : null;
            aiCategorySource =
                result.source === "minimax" || result.source === "fallback"
                    ? result.source
                    : null;
            aiCategoryMessage =
                String(result.reason || "").trim() || "จัดหมวดหมู่สำเร็จ";
        } catch (error) {
            console.error("AI categorize error:", error);
            aiCategoryMessage =
                "ไม่สามารถจัดหมวดด้วย AI ได้ในขณะนี้ ลองใหม่อีกครั้ง";
        } finally {
            aiCategorizing = false;
        }
    }
</script>

<div class="bg-white rounded-xl shadow-sm border border-slate-100 p-6">
    <div class="flex justify-between items-center mb-6">
        <h2 class="text-xl font-bold text-slate-800">
            {isEditMode ? "แก้ไขรายการ" : "บันทึกรายการใหม่"}
        </h2>
        {#if !isEditMode}
            <div class="flex items-center gap-2">
                <a
                    href="/add/bulk"
                    class="text-xs bg-blue-50 border border-blue-200 text-blue-700 px-3 py-1.5 rounded-full font-bold hover:bg-blue-100 transition-colors"
                >
                    อัปหลายสลิป
                </a>
                <button
                    type="button"
                    on:click={handleNoSpend}
                    class="text-xs bg-gradient-to-r from-yellow-400 to-orange-500 text-white px-3 py-1.5 rounded-full font-bold shadow-sm hover:shadow-md transition-all transform hover:scale-105 active:scale-95 flex items-center gap-1"
                >
                    ✨ วันนี้ไม่ได้ใช้เงินเลย!
                </button>
            </div>
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

            <div class="mt-2 flex items-center justify-between gap-2">
                <button
                    type="button"
                    on:click={categorizeFromNoteWithAI}
                    disabled={aiCategorizing || !note.trim()}
                    class="text-xs font-medium px-3 py-1.5 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                >
                    {#if aiCategorizing}
                        <Loader2 size={12} class="animate-spin" />
                        AI กำลังวิเคราะห์...
                    {:else}
                        ใช้ AI จัดหมวดหมู่
                    {/if}
                </button>

                {#if aiCategoryConfidence !== null}
                    <span class="text-[11px] text-slate-500">
                        ความมั่นใจ {Math.round(aiCategoryConfidence * 100)}%
                    </span>
                {/if}
            </div>

            {#if aiCategoryMessage}
                <div
                    class="mt-2 text-xs rounded-lg p-2 {aiCategorySource ===
                    'fallback'
                        ? 'bg-amber-50 text-amber-700 border border-amber-100'
                        : 'bg-blue-50 text-blue-700 border border-blue-100'}"
                >
                    {aiCategoryMessage}
                    {#if aiCategorySource}
                        <span class="opacity-70"> ({aiCategorySource})</span>
                    {/if}
                </div>
            {/if}
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

            {#if ocrLoading}
                <div class="mt-3 rounded-lg border border-blue-100 bg-blue-50 p-3">
                    <div class="flex items-center gap-2 text-blue-700 text-sm font-medium mb-2">
                        <Loader2 size={16} class="animate-spin" />
                        กำลังอ่านข้อมูลจากสลิป...
                    </div>
                    <div class="h-2 bg-white rounded overflow-hidden">
                        <div
                            class="h-2 bg-blue-500 transition-all"
                            style="width: {Math.round(ocrProgress * 100)}%"
                        ></div>
                    </div>
                    <div class="text-xs text-blue-700 mt-1">
                        {Math.round(ocrProgress * 100)}%
                    </div>
                </div>
            {/if}

            {#if ocrError}
                <div class="mt-3 rounded-lg border border-rose-100 bg-rose-50 p-3 text-sm text-rose-700">
                    {ocrError}
                </div>
            {/if}

            {#if ocrResult && !ocrLoading}
                <div class="mt-3 rounded-lg border border-emerald-100 bg-emerald-50 p-3 space-y-2">
                    <div class="flex justify-between items-center">
                        <h4 class="text-sm font-bold text-emerald-800">
                            OCR อ่านสลิปสำเร็จ
                        </h4>
                        <button
                            type="button"
                            class="text-xs text-emerald-700 font-medium hover:underline"
                            on:click={handleApplyOcr}
                        >
                            {ocrAutoFilled ? "Apply OCR อีกครั้ง" : "Apply OCR"}
                        </button>
                    </div>
                    <div class="grid grid-cols-2 gap-2 text-xs">
                        <div class="rounded bg-white p-2 border border-emerald-100">
                            <div class="text-slate-500">ยอดเงิน</div>
                            <div class="font-semibold text-slate-700">
                                {ocrResult.amount !== null
                                    ? `฿${ocrResult.amount.toLocaleString()}`
                                    : "-"}
                            </div>
                        </div>
                        <div class="rounded bg-white p-2 border border-emerald-100">
                            <div class="text-slate-500">วันที่</div>
                            <div class="font-semibold text-slate-700">
                                {ocrResult.date || "-"}
                            </div>
                        </div>
                    </div>
                    <div class="text-xs text-slate-600">
                        ความมั่นใจ OCR: {ocrResult.confidence !== null
                            ? `${ocrResult.confidence.toFixed(1)}%`
                            : "-"}
                    </div>
                    <div class="text-xs text-slate-600">
                        โน้ตที่อ่านได้: {ocrResult.note}
                    </div>
                    {#if ocrPendingApply}
                        <div class="text-[11px] text-amber-700">
                            ยังไม่เติมค่าลงฟอร์ม กด Apply OCR เพื่อยืนยันก่อนใช้งาน
                        </div>
                    {/if}
                    {#if ocrAutoFilled}
                        <div class="text-[11px] text-emerald-700">
                            เติมค่าลงฟอร์มแล้ว คุณสามารถแก้ไขต่อได้
                        </div>
                    {/if}
                </div>
            {/if}
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
