// PWA utilities and constants
export const PWA_CONFIG = {
  name: "灵记",
  shortName: "灵记",
  description: "一个开源的、自托管的笔记管理服务",
  themeColor: "#5b21b6",
  backgroundColor: "#ffffff",
  display: "standalone" as const,
  orientation: "portrait" as const,
  scope: "/",
  startUrl: "/",
};

// Service Worker cache names
export const CACHE_NAMES = {
  STATIC: "static-cache-v1",
  DYNAMIC: "dynamic-cache-v1",
  API: "api-cache-v1",
  IMAGES: "images-cache-v1",
};

// Cache strategies
export const CACHE_STRATEGIES = {
  CACHE_FIRST: "CacheFirst",
  NETWORK_FIRST: "NetworkFirst",
  STALE_WHILE_REVALIDATE: "StaleWhileRevalidate",
  NETWORK_ONLY: "NetworkOnly",
  CACHE_ONLY: "CacheOnly",
} as const;

// PWA event types
export const PWA_EVENTS = {
  BEFORE_INSTALL_PROMPT: "beforeinstallprompt",
  APP_INSTALLED: "appinstalled",
  CONTROLLER_CHANGE: "controllerchange",
  UPDATE_FOUND: "updatefound",
  STATE_CHANGE: "statechange",
} as const;

// Check if PWA is supported
export const isPWASupported = () => {
  return "serviceWorker" in navigator && "PushManager" in window;
};

// Check if app is running in standalone mode (PWA)
export const isStandaloneMode = () => {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as any).standalone ||
    document.referrer.includes("android-app://")
  );
};

// Check if app is installed
export const isAppInstalled = () => {
  return window.matchMedia("(display-mode: standalone)").matches;
};

// Register for periodic sync (if supported)
export const registerPeriodicSync = async (tag: string, minInterval: number) => {
  if ("serviceWorker" in navigator && "periodicSync" in window.ServiceWorkerRegistration) {
    const registration = await navigator.serviceWorker.ready;
    try {
      await (registration as any).periodicSync.register(tag, {
        minInterval, // Minimum interval in milliseconds
      });
      return true;
    } catch (error) {
      console.error("Periodic sync registration failed:", error);
      return false;
    }
  }
  return false;
};

// Request notification permission
export const requestNotificationPermission = async () => {
  if ("Notification" in window) {
    const permission = await Notification.requestPermission();
    return permission === "granted";
  }
  return false;
};

// Show notification
export const showNotification = (title: string, options?: NotificationOptions) => {
  if ("Notification" in window && Notification.permission === "granted") {
    return new Notification(title, {
      icon: "/logo.webp",
      badge: "/android-chrome-192x192.png",
      tag: "memos-notification",
      ...options,
    });
  }
  return null;
};