import { writable } from 'svelte/store';
import { browser } from '$app/environment';

export type UserType = 'bear' | 'rabbit';

const defaultValue: UserType = 'bear';

// Initialize from localStorage if available, otherwise default
const storedValue = browser ? localStorage.getItem('currentUser') as UserType : null;
const initialValue = (storedValue === 'bear' || storedValue === 'rabbit') ? storedValue : defaultValue;

export const currentUser = writable<UserType>(initialValue);

if (browser) {
    currentUser.subscribe((value) => {
        console.log('User changed to:', value);
        localStorage.setItem('currentUser', value);
    });
}

export const users = {
    bear: { id: 'bear', name: 'พี่หมี', emoji: '🐻', color: 'text-brown-600', bg: 'bg-orange-100' },
    rabbit: { id: 'rabbit', name: 'น้องต่าย', emoji: '🐰', color: 'text-pink-600', bg: 'bg-pink-100' }
};
