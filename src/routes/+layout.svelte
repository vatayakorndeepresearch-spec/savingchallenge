<script>
  import "../app.css";
  import { Home, PlusCircle, List, PieChart, Trophy } from "lucide-svelte";
  import { currentUser, users } from "$lib/userStore";

  function toggleUser() {
    $currentUser = $currentUser === "bear" ? "rabbit" : "bear";
    // Simple visual feedback could be added here if needed,
    // but the button change is reactive.
  }
</script>

<div class="min-h-screen bg-slate-50 pb-20">
  <header class="bg-white shadow-sm sticky top-0 z-10">
    <div class="max-w-md mx-auto px-4 py-3 flex justify-between items-center">
      <h1 class="text-lg font-bold text-pink-500">Couple Saving 💖</h1>

      <!-- User Switcher Button -->
      <button
        on:click={toggleUser}
        class="flex items-center gap-2 px-3 py-1.5 rounded-full transition-all active:scale-95 shadow-sm border border-transparent hover:border-slate-200 {users[
          $currentUser
        ].bg}"
        title="กดเพื่อสลับผู้ใช้"
      >
        <span class="text-xl">{users[$currentUser].emoji}</span>
        <div class="flex flex-col items-start leading-none">
          <span class="text-[10px] text-slate-500 font-normal">กำลังใช้งาน</span
          >
          <span class="text-sm font-bold {users[$currentUser].color}"
            >{users[$currentUser].name}</span
          >
        </div>
      </button>
    </div>
  </header>

  <main class="max-w-md mx-auto px-4 py-6">
    <slot />
  </main>

  <nav
    class="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-4 py-2 z-20"
  >
    <div
      class="max-w-md mx-auto flex justify-between items-center text-xs text-slate-500"
    >
      <a
        href="/"
        class="flex flex-col items-center gap-1 p-2 hover:text-pink-500"
      >
        <Home size={24} />
        <span>Home</span>
      </a>
      <a
        href="/transactions"
        class="flex flex-col items-center gap-1 p-2 hover:text-pink-500"
      >
        <List size={24} />
        <span>List</span>
      </a>
      <a
        href="/add"
        class="flex flex-col items-center gap-1 p-2 text-pink-500 -mt-8"
      >
        <div
          class="bg-pink-500 text-white rounded-full p-3 shadow-lg hover:bg-pink-600 transition-transform hover:scale-105"
        >
          <PlusCircle size={32} />
        </div>
      </a>
      <a
        href="/analytics"
        class="flex flex-col items-center gap-1 p-2 hover:text-pink-500"
      >
        <PieChart size={24} />
        <span>Stats</span>
      </a>
      <a
        href="/game"
        class="flex flex-col items-center gap-1 p-2 hover:text-pink-500"
      >
        <Trophy size={24} />
        <span>Game</span>
      </a>
    </div>
  </nav>
</div>
