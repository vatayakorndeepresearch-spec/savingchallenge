<script lang="ts">
    import { onDestroy } from "svelte";
    import { goto } from "$app/navigation";
    import { supabase } from "$lib/supabaseClient";
    import { currentUser } from "$lib/userStore";
    import { resolveOwner } from "$lib/owner";
    import { resolveJarForExpenseCategory, type JarKey } from "$lib/jars";
    import { runSlipOcr, type SlipOcrResult } from "$lib/slipOcr";
    import { prepareReceiptUpload } from "$lib/utils/receiptUpload";
    import {
        getCategoriesByType,
        getAiAllowedCategories,
        type TransactionType,
    } from "$lib/categories";
    import {
        Upload,
        Loader2,
        Trash2,
        Save,
        RefreshCcw,
        CheckCircle2,
        XCircle,
        Wand2,
        Sparkles,
        ArrowLeft,
        ScanLine,
        Image as ImageIcon,
    } from "lucide-svelte";

    type TxType = TransactionType;
    type ItemStatus =
        | "queued"
        | "scanning"
        | "ready"
        | "error"
        | "saving"
        | "saved"
        | "save_error";

    type AiSource = "minimax" | "fallback" | null;
    type AiStatus = "idle" | "running" | "done" | "error";

    type BulkItem = {
        id: string;
        file: File;
        previewUrl: string;
        sourceFileName: string;
        type: TxType;
        amount: number | null;
        category: string;
        customCategory: string;
        date: string;
        note: string;
        status: ItemStatus;
        ocrProgress: number;
        ocrResult: SlipOcrResult | null;
        ocrPendingApply: boolean;
        ocrError: string;
        aiStatus: AiStatus;
        aiMessage: string;
        aiConfidence: number | null;
        aiSource: AiSource;
        saveError: string;
        saveWarning: string;
        savedId: number | null;
    };

    const MAX_FILES = 20;
    const MAX_FILE_SIZE_BYTES = 8 * 1024 * 1024;
    const SAVE_CONCURRENCY = 3;
    const MAX_OCR_RAW_TEXT_LENGTH = 12000;
    const OCR_METADATA_WARNING_MESSAGE =
        "บันทึกได้ แต่ฐานข้อมูลยังไม่รองรับข้อมูล OCR จึงข้าม metadata OCR";

    let items: BulkItem[] = [];
    let selectedPreview: string | null = null;
    let scanningBatch = false;
    let savingAll = false;
    let classifyingAll = false;
    let globalError = "";
    let batchSummary = "";

    let supportsBatchColumns: boolean | null = null;
    let supportsOcrColumns: boolean | null = null;
    $: unsavedCount = items.filter((item) => item.status !== "saved").length;

    function todayIso() {
        return new Date().toISOString().split("T")[0];
    }

    function makeId() {
        if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
            return crypto.randomUUID();
        }
        return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    }

    function statusClass(status: ItemStatus): string {
        if (status === "saved") return "bg-emerald-50 text-emerald-700 border-emerald-100";
        if (status === "save_error" || status === "error") {
            return "bg-rose-50 text-rose-700 border-rose-100";
        }
        if (status === "saving" || status === "scanning") {
            return "bg-blue-50 text-blue-700 border-blue-100";
        }
        return "bg-slate-50 text-slate-600 border-slate-100";
    }

    function statusLabel(status: ItemStatus): string {
        if (status === "queued") return "รอ OCR";
        if (status === "scanning") return "กำลังอ่านสลิป";
        if (status === "ready") return "พร้อมบันทึก";
        if (status === "error") return "OCR ไม่สำเร็จ";
        if (status === "saving") return "กำลังบันทึก";
        if (status === "saved") return "บันทึกสำเร็จ";
        return "บันทึกล้มเหลว";
    }

    function createItem(file: File): BulkItem {
        return {
            id: makeId(),
            file,
            previewUrl: URL.createObjectURL(file),
            sourceFileName: file.name,
            type: "expense",
            amount: null,
            category: "",
            customCategory: "",
            date: todayIso(),
            note: "",
            status: "queued",
            ocrProgress: 0,
            ocrResult: null,
            ocrPendingApply: false,
            ocrError: "",
            aiStatus: "idle",
            aiMessage: "",
            aiConfidence: null,
            aiSource: null,
            saveError: "",
            saveWarning: "",
            savedId: null,
        };
    }

    function updateItem(itemId: string, updater: (item: BulkItem) => BulkItem) {
        items = items.map((item) => (item.id === itemId ? updater(item) : item));
    }

    function findItem(itemId: string): BulkItem | null {
        return items.find((item) => item.id === itemId) || null;
    }

    function setItemField<K extends keyof BulkItem>(
        itemId: string,
        key: K,
        value: BulkItem[K],
    ) {
        updateItem(itemId, (item) => ({ ...item, [key]: value }));
    }

    function revokePreview(url: string) {
        if (!url) return;
        try {
            URL.revokeObjectURL(url);
        } catch {
            // Ignore invalid object URL errors.
        }
    }

    function clearAllItems() {
        items.forEach((item) => revokePreview(item.previewUrl));
        items = [];
        globalError = "";
        batchSummary = "";
        selectedPreview = null;
    }

    function removeItem(itemId: string) {
        const item = findItem(itemId);
        if (!item) return;
        revokePreview(item.previewUrl);
        if (selectedPreview === item.previewUrl) {
            selectedPreview = null;
        }
        items = items.filter((entry) => entry.id !== itemId);
    }

    onDestroy(() => {
        items.forEach((item) => revokePreview(item.previewUrl));
    });

    async function handleFileChange(event: Event) {
        globalError = "";
        batchSummary = "";

        const input = event.currentTarget as HTMLInputElement;
        const selectedFiles = Array.from(input.files || []);
        input.value = "";

        if (selectedFiles.length === 0) return;

        const availableSlots = Math.max(0, MAX_FILES - items.length);
        if (availableSlots === 0) {
            globalError = `อัปโหลดได้สูงสุด ${MAX_FILES} รูปต่อรอบ`;
            return;
        }

        const acceptedFiles: File[] = [];
        for (const file of selectedFiles.slice(0, availableSlots)) {
            if (!file.type.startsWith("image/")) {
                globalError = `ข้ามไฟล์ ${file.name}: รองรับเฉพาะรูปภาพ`;
                continue;
            }
            if (file.size > MAX_FILE_SIZE_BYTES) {
                globalError = `ข้ามไฟล์ ${file.name}: ขนาดต้องไม่เกิน 8MB`;
                continue;
            }
            acceptedFiles.push(file);
        }

        if (acceptedFiles.length === 0) return;

        const newItems = acceptedFiles.map((file) => createItem(file));
        const newIds = newItems.map((item) => item.id);
        items = [...items, ...newItems];

        scanningBatch = true;
        for (const itemId of newIds) {
            await scanItem(itemId);
        }
        scanningBatch = false;
    }

    async function scanItem(itemId: string) {
        const item = findItem(itemId);
        if (!item) return;

        updateItem(itemId, (entry) => ({
            ...entry,
            status: "scanning",
            ocrProgress: 0,
            ocrError: "",
            saveError: "",
            saveWarning: "",
            aiMessage: "",
        }));

        try {
            const result = await runSlipOcr(item.file, (progress) => {
                updateItem(itemId, (entry) => ({ ...entry, ocrProgress: progress }));
            });

            updateItem(itemId, (entry) => ({
                ...entry,
                status: "ready",
                ocrProgress: 1,
                ocrResult: result,
                ocrPendingApply: true,
                ocrError: "",
            }));
        } catch (error) {
            console.error("Bulk OCR error:", error);
            updateItem(itemId, (entry) => ({
                ...entry,
                status: "error",
                ocrProgress: 0,
                ocrPendingApply: false,
                ocrError: "อ่านสลิปไม่สำเร็จ ลองรูปที่คมชัดขึ้น",
            }));
        }
    }

    function willOverwrite(item: BulkItem, result: SlipOcrResult): boolean {
        const amountWillChange =
            result.amount !== null && item.amount !== null && item.amount !== result.amount;
        const dateWillChange = !!result.date && !!item.date && item.date !== result.date;
        const noteWillChange =
            !!result.note.trim() &&
            !!item.note.trim() &&
            item.note.trim() !== result.note.trim();

        return amountWillChange || dateWillChange || noteWillChange;
    }

    function applyOcrToItem(itemId: string, force = false) {
        const item = findItem(itemId);
        if (!item || !item.ocrResult) return;

        if (!force && willOverwrite(item, item.ocrResult)) {
            const confirmed = confirm(
                "OCR จะเขียนทับค่าที่คุณแก้ไว้บางส่วน ต้องการดำเนินการต่อหรือไม่?",
            );
            if (!confirmed) return;
        }

        updateItem(itemId, (entry) => {
            const result = entry.ocrResult;
            if (!result) return entry;

            const nextType = result.inferredType || entry.type;
            const validCategories = getCategoriesByType(nextType);
            const fallbackCategory = nextType === "income" ? "Salary (เงินเดือน)" : "Other (อื่นๆ)";

            let nextCategory = entry.category;
            if (!nextCategory) {
                nextCategory = fallbackCategory;
            }
            if (!validCategories.includes(nextCategory)) {
                nextCategory = fallbackCategory;
            }

            return {
                ...entry,
                type: nextType,
                amount: result.amount ?? entry.amount,
                date: result.date ?? entry.date,
                note: result.note && (force || !entry.note.trim()) ? result.note : entry.note,
                category: nextCategory,
                customCategory: nextCategory.startsWith("Other") ? entry.customCategory : "",
                ocrPendingApply: false,
                status: entry.status === "error" ? "ready" : entry.status,
            };
        });
    }

    function onTypeChange(itemId: string, nextTypeRaw: string) {
        const nextType: TxType = nextTypeRaw === "income" ? "income" : "expense";
        updateItem(itemId, (item) => {
            const validCategories = getCategoriesByType(nextType);
            let nextCategory = item.category;
            let nextCustomCategory = item.customCategory;

            if (!validCategories.includes(nextCategory)) {
                nextCategory = "";
                nextCustomCategory = "";
            }

            return {
                ...item,
                type: nextType,
                category: nextCategory,
                customCategory: nextCustomCategory,
            };
        });
    }

    function getFinalCategory(item: BulkItem): string {
        if (item.category.startsWith("Other")) {
            return item.customCategory.trim();
        }
        return item.category.trim();
    }

    function sanitizeDbText(value: unknown, maxLength = 2000): string {
        const normalized =
            typeof value === "string"
                ? value
                      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
                      .replace(/[\uD800-\uDFFF]/g, "")
                      .replace(/\s+/g, " ")
                      .trim()
                : "";
        if (!normalized) return "";
        return normalized.length > maxLength
            ? normalized.slice(0, maxLength).trim()
            : normalized;
    }

    function validateItem(item: BulkItem): string | null {
        if (!item.amount || !Number.isFinite(item.amount) || item.amount <= 0) {
            return "จำนวนเงินต้องมากกว่า 0";
        }

        if (!item.date) {
            return "กรุณาเลือกวันที่";
        }

        const finalCategory = sanitizeDbText(getFinalCategory(item), 120);
        if (!finalCategory) {
            return "กรุณาเลือกหรือระบุหมวดหมู่";
        }

        return null;
    }

    async function classifyItemWithAI(itemId: string) {
        const item = findItem(itemId);
        if (!item) return;

        const trimmedNote = item.note.trim();
        if (!trimmedNote) {
            updateItem(itemId, (entry) => ({
                ...entry,
                aiStatus: "error",
                aiMessage: "กรุณาใส่บันทึกช่วยจำก่อนใช้ AI",
                aiConfidence: null,
                aiSource: null,
            }));
            return;
        }

        updateItem(itemId, (entry) => ({
            ...entry,
            aiStatus: "running",
            aiMessage: "",
            aiConfidence: null,
            aiSource: null,
        }));

        try {
            const response = await fetch("/api/classify-note", {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                },
                body: JSON.stringify({
                    note: trimmedNote,
                    type: item.type,
                    categories: getAiAllowedCategories(item.type),
                }),
            });

            const result = await response.json();
            if (!response.ok) {
                throw new Error(String(result?.error || "AI classify failed"));
            }

            updateItem(itemId, (entry) => {
                const allowedCategories = getCategoriesByType(entry.type);
                const pickedCategory = String(result?.category || "").trim();
                const nextCategory = allowedCategories.includes(pickedCategory)
                    ? pickedCategory
                    : "Other (อื่นๆ)";

                return {
                    ...entry,
                    category: nextCategory,
                    customCategory: nextCategory.startsWith("Other")
                        ? entry.customCategory
                        : "",
                    aiStatus: "done",
                    aiMessage:
                        String(result?.reason || "").trim() || "จัดหมวดด้วย AI สำเร็จ",
                    aiConfidence: Number.isFinite(Number(result?.confidence))
                        ? Math.max(0, Math.min(1, Number(result.confidence)))
                        : null,
                    aiSource:
                        result?.source === "minimax" || result?.source === "fallback"
                            ? result.source
                            : null,
                };
            });
        } catch (error) {
            console.error("Bulk AI categorize failed:", error);
            updateItem(itemId, (entry) => ({
                ...entry,
                aiStatus: "error",
                aiMessage: "ไม่สามารถจัดหมวดด้วย AI ได้ในขณะนี้",
                aiConfidence: null,
                aiSource: null,
            }));
        }
    }

    async function classifyAll() {
        if (classifyingAll) return;
        classifyingAll = true;

        const targetIds = items
            .filter((item) => item.note.trim().length > 0 && item.status !== "saved")
            .map((item) => item.id);

        for (const itemId of targetIds) {
            await classifyItemWithAI(itemId);
        }

        classifyingAll = false;
    }

    async function uploadReceipt(owner: string, file: File): Promise<string> {
        const prepared = await prepareReceiptUpload(file);
        const fileName = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}.${prepared.ext}`;
        const filePath = `${owner}/${fileName}`;

        const { error } = await supabase.storage
            .from("receipts")
            .upload(filePath, prepared.body, {
                contentType: prepared.contentType,
            });

        if (error) throw new Error(error.message || "upload failed");
        return filePath;
    }

    async function cleanupReceiptUpload(filePath: string | null): Promise<void> {
        if (!filePath) return;
        const { error } = await supabase.storage.from("receipts").remove([filePath]);
        if (error) {
            console.warn("Bulk receipt cleanup failed:", error);
        }
    }

    function normalizeOcrRawText(value: string | null): string | null {
        const text = sanitizeDbText(value, MAX_OCR_RAW_TEXT_LENGTH);
        if (!text) return null;
        return text;
    }

    function normalizeOcrConfidence(value: number | null): number | null {
        if (typeof value !== "number" || !Number.isFinite(value)) return null;
        const clamped = Math.max(0, Math.min(100, value));
        return Math.round((clamped + Number.EPSILON) * 100) / 100;
    }

    function hasMissingBatchColumnsError(message: string): boolean {
        return message.includes("batch_id") || message.includes("source_file_name");
    }

    function hasOcrMetadataError(message: string): boolean {
        return message.includes("ocr_raw_text") || message.includes("ocr_confidence");
    }

    async function insertTransactionWithOptionalColumns(
        basePayload: Record<string, unknown>,
        optionalBatchPayload: Record<string, unknown>,
        optionalOcrPayload: Record<string, unknown>,
    ): Promise<{ id: number | null; error: Error | null; ocrMetadataDropped: boolean }> {
        const runInsert = async (payload: Record<string, unknown>) => {
            const { data, error } = await supabase
                .from("transactions")
                .insert(payload)
                .select("id")
                .single();

            const insertedId =
                data && Number.isFinite(Number((data as { id?: unknown }).id))
                    ? Number((data as { id?: unknown }).id)
                    : null;

            return {
                id: insertedId,
                error: error ? new Error(error.message) : null,
            };
        };

        const hasBatchOptional = Object.keys(optionalBatchPayload).length > 0;
        const hasOcrOptional = Object.keys(optionalOcrPayload).length > 0;

        let includeBatchOptional = supportsBatchColumns !== false && hasBatchOptional;
        let includeOcrOptional = supportsOcrColumns !== false && hasOcrOptional;
        let ocrMetadataDropped = hasOcrOptional && !includeOcrOptional;

        for (let attempt = 0; attempt < 3; attempt += 1) {
            const payload = {
                ...basePayload,
                ...(includeBatchOptional ? optionalBatchPayload : {}),
                ...(includeOcrOptional ? optionalOcrPayload : {}),
            };
            const result = await runInsert(payload);
            if (!result.error) {
                supportsBatchColumns = includeBatchOptional;
                supportsOcrColumns = includeOcrOptional;
                return {
                    ...result,
                    ocrMetadataDropped,
                };
            }

            const message = String(result.error.message || "").toLowerCase();

            if (includeBatchOptional && hasMissingBatchColumnsError(message)) {
                includeBatchOptional = false;
                supportsBatchColumns = false;
                continue;
            }
            if (includeOcrOptional && hasOcrMetadataError(message)) {
                includeOcrOptional = false;
                supportsOcrColumns = false;
                ocrMetadataDropped = hasOcrOptional;
                continue;
            }

            return {
                ...result,
                ocrMetadataDropped,
            };
        }

        return {
            id: null,
            error: new Error("Insert failed after fallback attempts"),
            ocrMetadataDropped,
        };
    }

    async function saveSingleItem(itemId: string, owner: string, batchId: string) {
        const current = findItem(itemId);
        if (!current || current.status === "saved") {
            return { ok: false, skipped: true, ocrMetadataDropped: false };
        }

        const validationError = validateItem(current);
        if (validationError) {
            updateItem(itemId, (entry) => ({
                ...entry,
                status: "save_error",
                saveError: validationError,
                saveWarning: "",
            }));
            return { ok: false, skipped: false, ocrMetadataDropped: false };
        }

        updateItem(itemId, (entry) => ({
            ...entry,
            status: "saving",
            saveError: "",
            saveWarning: "",
        }));

        let imagePath: string | null = null;
        try {
            imagePath = await uploadReceipt(owner, current.file);
            const finalCategory = sanitizeDbText(getFinalCategory(current), 120);
            const sanitizedNote = sanitizeDbText(current.note, 4000);
            const jarKey: JarKey | null =
                current.type === "expense"
                    ? resolveJarForExpenseCategory(finalCategory)
                    : null;

            const basePayload = {
                type: current.type,
                amount: current.amount,
                category: finalCategory,
                date: current.date,
                note: sanitizedNote || null,
                image_path: imagePath,
                jar_key: jarKey,
                owner,
            };

            const optionalBatchPayload = {
                batch_id: batchId,
                source_file_name: current.sourceFileName,
            };
            const optionalOcrPayload: Record<string, unknown> = {};
            const normalizedRawText = normalizeOcrRawText(current.ocrResult?.rawText || null);
            const normalizedConfidence = normalizeOcrConfidence(
                typeof current.ocrResult?.confidence === "number"
                    ? current.ocrResult.confidence
                    : null,
            );
            if (normalizedRawText !== null) {
                optionalOcrPayload.ocr_raw_text = normalizedRawText;
            }
            if (normalizedConfidence !== null) {
                optionalOcrPayload.ocr_confidence = normalizedConfidence;
            }

            const inserted = await insertTransactionWithOptionalColumns(
                basePayload,
                optionalBatchPayload,
                optionalOcrPayload,
            );

            if (inserted.error) throw inserted.error;

            updateItem(itemId, (entry) => ({
                ...entry,
                status: "saved",
                saveError: "",
                saveWarning: inserted.ocrMetadataDropped
                    ? OCR_METADATA_WARNING_MESSAGE
                    : "",
                savedId: inserted.id,
            }));
            return {
                ok: true,
                skipped: false,
                ocrMetadataDropped: inserted.ocrMetadataDropped,
            };
        } catch (error) {
            await cleanupReceiptUpload(imagePath);
            const message =
                error instanceof Error && error.message
                    ? error.message
                    : "บันทึกไม่สำเร็จ";

            updateItem(itemId, (entry) => ({
                ...entry,
                status: "save_error",
                saveError: message,
                saveWarning: "",
            }));
            return { ok: false, skipped: false, ocrMetadataDropped: false };
        }
    }

    async function runSavePool(owner: string, itemIds: string[], batchId: string) {
        let cursor = 0;
        let successCount = 0;
        let failCount = 0;
        let skipCount = 0;
        let ocrDroppedCount = 0;

        const worker = async () => {
            while (cursor < itemIds.length) {
                const targetId = itemIds[cursor];
                cursor += 1;
                const result = await saveSingleItem(targetId, owner, batchId);
                if (result.skipped) {
                    skipCount += 1;
                } else if (result.ok) {
                    successCount += 1;
                    if (result.ocrMetadataDropped) {
                        ocrDroppedCount += 1;
                    }
                } else {
                    failCount += 1;
                }
            }
        };

        const runners = Array.from(
            { length: Math.min(SAVE_CONCURRENCY, itemIds.length) },
            () => worker(),
        );
        await Promise.all(runners);

        return { successCount, failCount, skipCount, ocrDroppedCount };
    }

    async function saveAllItems() {
        if (savingAll || items.length === 0) return;

        savingAll = true;
        globalError = "";
        batchSummary = "";

        const { owner } = await resolveOwner(supabase, $currentUser);
        if (!owner) {
            globalError = "ไม่พบผู้ใช้สำหรับบันทึกข้อมูล";
            savingAll = false;
            return;
        }

        const batchId = makeId();
        const pendingIds = items
            .filter((item) => item.status !== "saved")
            .map((item) => item.id);

        const { successCount, failCount, skipCount, ocrDroppedCount } = await runSavePool(
            owner,
            pendingIds,
            batchId,
        );

        batchSummary = `บันทึกสำเร็จ ${successCount} รายการ • ไม่สำเร็จ ${failCount} รายการ • ข้าม ${skipCount} รายการ`;
        if (ocrDroppedCount > 0) {
            batchSummary += ` • ข้าม OCR metadata ${ocrDroppedCount} รายการ`;
        }
        savingAll = false;
    }

    function parseNumberInput(rawValue: string): number | null {
        if (!rawValue.trim()) return null;
        const value = Number(rawValue);
        if (!Number.isFinite(value)) return null;
        return value;
    }

    function selectValue(event: Event): string {
        return (event.currentTarget as HTMLSelectElement).value;
    }

    function inputValue(event: Event): string {
        return (event.currentTarget as HTMLInputElement).value;
    }

    function textareaValue(event: Event): string {
        return (event.currentTarget as HTMLTextAreaElement).value;
    }
</script>

<div class="space-y-5 pb-24">
    <div class="flex items-center justify-between gap-3">
        <div class="flex items-center gap-2">
            <a
                href="/add"
                class="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"
            >
                <ArrowLeft size={16} /> กลับ
            </a>
            <h2 class="text-xl font-bold text-slate-800">บันทึกหลายสลิป</h2>
        </div>

        <label
            class="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 cursor-pointer"
        >
            <Upload size={14} /> เพิ่มสลิป
            <input
                type="file"
                accept="image/*"
                multiple
                class="hidden"
                on:change={handleFileChange}
            />
        </label>
    </div>

    {#if globalError}
        <div class="rounded-lg border border-rose-100 bg-rose-50 p-3 text-sm text-rose-700">
            {globalError}
        </div>
    {/if}

    {#if batchSummary}
        <div class="rounded-lg border border-emerald-100 bg-emerald-50 p-3 text-sm text-emerald-700">
            {batchSummary}
        </div>
    {/if}

    {#if items.length === 0}
        <label
            class="block rounded-xl border-2 border-dashed border-slate-200 bg-white p-8 text-center cursor-pointer hover:border-pink-400 transition-colors"
        >
            <div class="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-pink-50 text-pink-600">
                <ImageIcon size={22} />
            </div>
            <div class="font-semibold text-slate-700">เลือกหลายสลิปพร้อมกัน</div>
            <p class="mt-1 text-xs text-slate-500">
                รองรับสูงสุด {MAX_FILES} รูป, ไม่เกิน 8MB ต่อรูป
            </p>
            <input
                type="file"
                accept="image/*"
                multiple
                class="hidden"
                on:change={handleFileChange}
            />
        </label>
    {:else}
        <div class="flex flex-wrap items-center gap-2">
            <button
                type="button"
                on:click={saveAllItems}
                disabled={savingAll || scanningBatch || classifyingAll || unsavedCount === 0}
                class="inline-flex items-center gap-1 rounded-lg bg-pink-500 px-3 py-2 text-xs font-bold text-white hover:bg-pink-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
                {#if savingAll}
                    <Loader2 size={14} class="animate-spin" />
                    กำลังบันทึก...
                {:else}
                    <Save size={14} />
                    บันทึกหลายสลิป ({unsavedCount})
                {/if}
            </button>

            <button
                type="button"
                on:click={classifyAll}
                disabled={classifyingAll || savingAll}
                class="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed"
            >
                {#if classifyingAll}
                    <Loader2 size={14} class="animate-spin" />
                    AI กำลังจัดหมวดทั้งชุด...
                {:else}
                    <Wand2 size={14} />
                    ใช้ AI จัดหมวดทั้งชุด
                {/if}
            </button>

            <button
                type="button"
                on:click={clearAllItems}
                disabled={savingAll}
                class="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
                <Trash2 size={14} />
                ล้างทั้งหมด
            </button>

            <a
                href="/transactions"
                class="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
                ดูรายการทั้งหมด
            </a>
        </div>

        <div class="space-y-3">
            {#each items as item}
                <div class="rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
                    <div class="flex items-start justify-between gap-3">
                        <div class="flex items-start gap-3 min-w-0">
                            <button
                                type="button"
                                class="h-20 w-16 overflow-hidden rounded-lg border border-slate-100 bg-slate-50"
                                on:click={() => (selectedPreview = item.previewUrl)}
                            >
                                <img
                                    src={item.previewUrl}
                                    alt={item.sourceFileName}
                                    class="h-full w-full object-cover"
                                />
                            </button>

                            <div class="min-w-0">
                                <div class="truncate text-sm font-semibold text-slate-800">
                                    {item.sourceFileName}
                                </div>
                                <div
                                    class="mt-1 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] {statusClass(item.status)}"
                                >
                                    {#if item.status === "saved"}
                                        <CheckCircle2 size={12} />
                                    {:else if item.status === "save_error" || item.status === "error"}
                                        <XCircle size={12} />
                                    {:else if item.status === "saving" || item.status === "scanning"}
                                        <Loader2 size={12} class="animate-spin" />
                                    {:else}
                                        <ScanLine size={12} />
                                    {/if}
                                    {statusLabel(item.status)}
                                </div>

                                {#if item.status === "scanning"}
                                    <div class="mt-2 w-40">
                                        <div class="h-1.5 rounded bg-slate-100 overflow-hidden">
                                            <div
                                                class="h-1.5 bg-blue-500 transition-all"
                                                style="width: {Math.round(item.ocrProgress * 100)}%"
                                            ></div>
                                        </div>
                                        <div class="mt-1 text-[11px] text-slate-500">
                                            OCR {Math.round(item.ocrProgress * 100)}%
                                        </div>
                                    </div>
                                {/if}

                                {#if item.saveError}
                                    <div class="mt-1 text-[11px] text-rose-600">{item.saveError}</div>
                                {/if}
                                {#if item.saveWarning}
                                    <div class="mt-1 text-[11px] text-amber-700">{item.saveWarning}</div>
                                {/if}
                                {#if item.ocrError}
                                    <div class="mt-1 text-[11px] text-rose-600">{item.ocrError}</div>
                                {/if}
                            </div>
                        </div>

                        <div class="flex items-center gap-1">
                            <button
                                type="button"
                                on:click={() => scanItem(item.id)}
                                disabled={item.status === "scanning" || item.status === "saving"}
                                class="rounded-md p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-50"
                                title="รัน OCR ใหม่"
                            >
                                <RefreshCcw size={14} />
                            </button>
                            <button
                                type="button"
                                on:click={() => removeItem(item.id)}
                                disabled={item.status === "saving"}
                                class="rounded-md p-2 text-rose-500 hover:bg-rose-50 disabled:opacity-50"
                                title="ลบรายการนี้"
                            >
                                <Trash2 size={14} />
                            </button>
                        </div>
                    </div>

                    <div class="mt-3 grid grid-cols-2 gap-3">
                        <div>
                            <div class="mb-1 block text-xs text-slate-500">ประเภท</div>
                            <select
                                value={item.type}
                                on:change={(event) =>
                                    onTypeChange(item.id, selectValue(event))}
                                class="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                            >
                                <option value="expense">รายจ่าย</option>
                                <option value="income">รายรับ</option>
                            </select>
                        </div>

                        <div>
                            <div class="mb-1 block text-xs text-slate-500">จำนวนเงิน</div>
                            <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={item.amount ?? ""}
                                on:input={(event) =>
                                    setItemField(
                                        item.id,
                                        "amount",
                                        parseNumberInput(inputValue(event)),
                                    )}
                                class="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                                placeholder="0.00"
                            />
                        </div>

                        <div>
                            <div class="mb-1 block text-xs text-slate-500">วันที่</div>
                            <input
                                type="date"
                                value={item.date}
                                on:input={(event) =>
                                    setItemField(item.id, "date", inputValue(event))}
                                class="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                            />
                        </div>

                        <div>
                            <div class="mb-1 block text-xs text-slate-500">หมวดหมู่</div>
                            <select
                                value={item.category}
                                on:change={(event) =>
                                    setItemField(item.id, "category", selectValue(event))}
                                class="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                            >
                                <option value="">เลือกหมวดหมู่</option>
                                {#each getCategoriesByType(item.type) as cat}
                                    <option value={cat}>{cat}</option>
                                {/each}
                            </select>
                        </div>

                        {#if item.category.startsWith("Other")}
                            <div class="col-span-2">
                                <div class="mb-1 block text-xs text-slate-500">ระบุหมวดหมู่เอง</div>
                                <input
                                    type="text"
                                    value={item.customCategory}
                                    on:input={(event) =>
                                        setItemField(
                                            item.id,
                                            "customCategory",
                                            inputValue(event),
                                        )}
                                    class="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                                    placeholder="เช่น กาแฟประชุม"
                                />
                            </div>
                        {/if}

                        <div class="col-span-2">
                            <div class="mb-1 block text-xs text-slate-500">บันทึกช่วยจำ</div>
                            <textarea
                                rows="2"
                                value={item.note}
                                on:input={(event) =>
                                    setItemField(item.id, "note", textareaValue(event))}
                                class="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                                placeholder="รายละเอียดเพิ่มเติม..."
                            ></textarea>
                        </div>
                    </div>

                    <div class="mt-3 flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            on:click={() => applyOcrToItem(item.id)}
                            disabled={!item.ocrResult || item.status === "scanning" || item.status === "saving"}
                            class="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                        >
                            <Sparkles size={13} />
                            {item.ocrPendingApply ? "Apply OCR" : "Apply OCR อีกครั้ง"}
                        </button>

                        <button
                            type="button"
                            on:click={() => classifyItemWithAI(item.id)}
                            disabled={item.aiStatus === "running" || !item.note.trim() || item.status === "saving"}
                            class="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
                        >
                            {#if item.aiStatus === "running"}
                                <Loader2 size={13} class="animate-spin" />
                                AI วิเคราะห์...
                            {:else}
                                <Wand2 size={13} />
                                AI จัดหมวด
                            {/if}
                        </button>

                        {#if item.aiConfidence !== null}
                            <span class="text-[11px] text-slate-500">
                                ความมั่นใจ {Math.round(item.aiConfidence * 100)}%
                            </span>
                        {/if}

                        {#if item.aiSource}
                            <span class="text-[11px] text-slate-400">({item.aiSource})</span>
                        {/if}
                    </div>

                    {#if item.aiMessage}
                        <div
                            class="mt-2 rounded-lg border p-2 text-xs {item.aiStatus === 'error'
                                ? 'border-rose-100 bg-rose-50 text-rose-700'
                                : 'border-blue-100 bg-blue-50 text-blue-700'}"
                        >
                            {item.aiMessage}
                        </div>
                    {/if}

                    {#if item.ocrResult}
                        <div class="mt-2 rounded-lg border border-slate-100 bg-slate-50 p-2 text-[11px] text-slate-600">
                            OCR: amount {item.ocrResult.amount !== null
                                ? `฿${item.ocrResult.amount.toLocaleString()}`
                                : "-"}
                            • date {item.ocrResult.date || "-"}
                            • confidence {item.ocrResult.confidence !== null
                                ? `${item.ocrResult.confidence.toFixed(1)}%`
                                : "-"}
                            {#if item.ocrPendingApply}
                                <span class="ml-2 text-amber-700">(รอ Apply OCR)</span>
                            {/if}
                        </div>
                    {/if}
                </div>
            {/each}
        </div>

        <div class="fixed bottom-0 left-0 right-0 border-t border-slate-200 bg-white/95 backdrop-blur p-4">
            <div class="mx-auto flex max-w-md gap-2">
                <button
                    type="button"
                    on:click={saveAllItems}
                    disabled={savingAll || scanningBatch || classifyingAll || unsavedCount === 0}
                    class="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-pink-500 px-4 py-3 text-sm font-bold text-white hover:bg-pink-600 disabled:opacity-50"
                >
                    {#if savingAll}
                        <Loader2 size={16} class="animate-spin" />
                        กำลังบันทึกทั้งหมด...
                    {:else}
                        <Save size={16} />
                        บันทึกหลายสลิป ({unsavedCount})
                    {/if}
                </button>
                <button
                    type="button"
                    on:click={() => goto("/add")}
                    class="inline-flex items-center justify-center rounded-xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-600 hover:bg-slate-50"
                >
                    ย้อนกลับ
                </button>
            </div>
        </div>
    {/if}
</div>

{#if selectedPreview}
    <button
        type="button"
        class="fixed inset-0 z-50 bg-slate-900/90 p-4"
        on:click={() => (selectedPreview = null)}
    >
        <img
            src={selectedPreview}
            alt="Slip preview"
            class="mx-auto h-full max-h-[92vh] w-auto max-w-full object-contain rounded-lg"
        />
    </button>
{/if}
