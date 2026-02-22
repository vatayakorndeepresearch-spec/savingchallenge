<script lang="ts">
    export let data: {
        next: string;
    };

    export let form:
        | {
              error?: string;
              next?: string;
          }
        | undefined;
</script>

<div class="min-h-[70vh] flex items-center justify-center">
    <div class="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 class="text-xl font-bold text-slate-800">ใส่รหัสก่อนเข้าใช้งาน</h1>
        <p class="mt-1 text-sm text-slate-500">
            ระบบถูกล็อกด้วยรหัสตัวเลขเพื่อจำกัดการเข้าถึง
        </p>

        <form method="POST" class="mt-5 space-y-4">
            <input type="hidden" name="next" value={form?.next || data.next || "/"} />

            <div>
                <label for="passcode" class="mb-1 block text-sm font-medium text-slate-700"
                    >รหัสตัวเลข</label
                >
                <input
                    id="passcode"
                    name="passcode"
                    type="password"
                    inputmode="numeric"
                    pattern="[0-9]*"
                    autocomplete="current-password"
                    required
                    class="w-full rounded-lg border border-slate-300 px-3 py-2 text-lg tracking-widest focus:border-pink-500 focus:outline-none focus:ring-2 focus:ring-pink-200"
                    placeholder="••••••"
                />
            </div>

            {#if form?.error}
                <p class="rounded-lg border border-rose-200 bg-rose-50 p-2 text-sm text-rose-700">
                    {form.error}
                </p>
            {/if}

            <button
                type="submit"
                class="w-full rounded-lg bg-slate-800 px-4 py-2.5 font-semibold text-white transition-colors hover:bg-slate-900"
            >
                เข้าสู่ระบบ
            </button>
        </form>
    </div>
</div>
