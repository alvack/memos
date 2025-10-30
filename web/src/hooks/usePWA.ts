import { useState, useEffect } from "react";

interface UsePWAReturn {
  isOnline: boolean;
  needsRefresh: boolean;
  waitingServiceWorker: ServiceWorker | null;
  updateServiceWorker: () => Promise<void>;
  isInstallable: boolean;
}

export const usePWA = (): UsePWAReturn => {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [waitingServiceWorker, setWaitingServiceWorker] = useState<ServiceWorker | null>(null);

  // Monitor online/offline status
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Handle service worker updates
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      // Listen for waiting service worker
      navigator.serviceWorker.ready.then((registration) => {
        if (registration.waiting) {
          setWaitingServiceWorker(registration.waiting);
          setNeedsRefresh(true);
        }

        // Listen for new service worker waiting
        registration.addEventListener("updatefound", () => {
          const newWorker = registration.installing;
          if (newWorker) {
            newWorker.addEventListener("statechange", () => {
              if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
                setWaitingServiceWorker(newWorker);
                setNeedsRefresh(true);
              }
            });
          }
        });
      });

      // Listen for controlling service worker changes
      const handleControllerChange = () => {
        console.log("Service Worker controller changed, reloading page");
        window.location.reload();
      };

      navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);

      return () => {
        navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange);
      };
    }
  }, []);

  const updateServiceWorker = async (): Promise<void> => {
    if (waitingServiceWorker) {
      waitingServiceWorker.postMessage({ type: "SKIP_WAITING" });
      setNeedsRefresh(false);
      setWaitingServiceWorker(null);
    }
  };

  // Check if PWA is installable (this will be detected by the PWAUpdatePrompt component)
  const isInstallable = false; // This will be handled by the component

  return {
    isOnline,
    needsRefresh,
    waitingServiceWorker,
    updateServiceWorker,
    isInstallable,
  };
};