/// <reference types="@sveltejs/kit" />
import { build, files, version } from "$service-worker";

const CACHE = `app-cache-${version}`;
const ASSETS = [...build, ...files];

self.addEventListener("install", (event) => {
    event.waitUntil(
        (async () => {
            const cache = await caches.open(CACHE);
            await cache.addAll(ASSETS);
            await self.skipWaiting();
        })(),
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        (async () => {
            const cacheKeys = await caches.keys();
            await Promise.all(
                cacheKeys
                    .filter((key) => key !== CACHE)
                    .map((key) => caches.delete(key)),
            );
            await self.clients.claim();
        })(),
    );
});

self.addEventListener("fetch", (event) => {
    const { request } = event;
    if (request.method !== "GET") return;

    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;
    if (url.pathname.startsWith("/api/")) return;

    const isAsset =
        ASSETS.includes(url.pathname) || url.pathname.startsWith("/_app/");

    if (isAsset) {
        event.respondWith(
            (async () => {
                const cache = await caches.open(CACHE);
                const cached = await cache.match(request);
                if (cached) return cached;

                const response = await fetch(request);
                cache.put(request, response.clone());
                return response;
            })(),
        );
        return;
    }

    if (request.mode === "navigate") {
        event.respondWith(
            (async () => {
                try {
                    const response = await fetch(request);
                    const cache = await caches.open(CACHE);
                    cache.put(request, response.clone());
                    return response;
                } catch {
                    const cache = await caches.open(CACHE);
                    const cached = await cache.match(request);
                    if (cached) return cached;

                    return (
                        (await cache.match("/")) ||
                        new Response("Offline", {
                            status: 503,
                            statusText: "Offline",
                        })
                    );
                }
            })(),
        );
    }
});
