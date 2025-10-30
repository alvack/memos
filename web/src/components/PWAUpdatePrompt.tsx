import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Download, X, RefreshCw, Smartphone } from "lucide-react";
import toast from "react-hot-toast";

interface PWAUpdatePromptProps {
  needsRefresh: boolean;
  updateServiceWorker: () => Promise<void>;
  waitingServiceWorker: ServiceWorker | null;
}

const PWAUpdatePrompt = ({ needsRefresh, updateServiceWorker, waitingServiceWorker }: PWAUpdatePromptProps) => {
  const { t } = useTranslation();
  const [isVisible, setIsVisible] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<Event | null>(null);

  // Handle PWA install prompt
  useEffect(() => {
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setIsVisible(true);
    };

    const handleAppInstalled = () => {
      setDeferredPrompt(null);
      setIsVisible(false);
      toast.success(t("pwa.installed", "应用已安装到您的设备！"));
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, [t]);

  // Show update prompt when new version is available
  useEffect(() => {
    if (needsRefresh && waitingServiceWorker) {
      setIsVisible(true);
    }
  }, [needsRefresh, waitingServiceWorker]);

  const handleInstall = async () => {
    if (!deferredPrompt) return;

    setIsInstalling(true);
    try {
      const promptEvent = deferredPrompt as any;
      await promptEvent.prompt();
      const { outcome } = await promptEvent.userChoice;

      if (outcome === "accepted") {
        toast.success(t("pwa.install-accepted", "安装已接受！"));
      }

      setDeferredPrompt(null);
      setIsVisible(false);
    } catch (error) {
      console.error("PWA install error:", error);
      toast.error(t("pwa.install-error", "安装失败，请重试"));
    } finally {
      setIsInstalling(false);
    }
  };

  const handleUpdate = async () => {
    try {
      await updateServiceWorker();
      setIsVisible(false);
      toast.success(t("pwa.updated", "应用已更新！"));
    } catch (error) {
      console.error("PWA update error:", error);
      toast.error(t("pwa.update-error", "更新失败，请刷新页面"));
    }
  };

  const handleDismiss = () => {
    setIsVisible(false);
    setDeferredPrompt(null);
  };

  if (!isVisible) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm">
      <Card className="shadow-lg border-2">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Smartphone className="h-5 w-5 text-primary" />
              <Badge variant="secondary" className="text-xs">
                {needsRefresh ? t("pwa.update-available", "有新版本") : t("pwa.install-available", "可安装")}
              </Badge>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDismiss}
              className="h-6 w-6 p-0"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <CardTitle className="text-lg">
            {needsRefresh
              ? t("pwa.update-title", "应用有新版本")
              : t("pwa.install-title", "安装灵记应用")
            }
          </CardTitle>
          <CardDescription>
            {needsRefresh
              ? t("pwa.update-description", "新版本包含性能改进和错误修复。")
              : t("pwa.install-description", "将应用安装到您的设备，获得更好的体验。")
            }
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="flex space-x-2">
            {needsRefresh ? (
              <>
                <Button onClick={handleUpdate} className="flex-1">
                  <RefreshCw className="mr-2 h-4 w-4" />
                  {t("pwa.update-button", "立即更新")}
                </Button>
                <Button variant="outline" onClick={handleDismiss}>
                  {t("common.later", "稍后")}
                </Button>
              </>
            ) : (
              <>
                <Button
                  onClick={handleInstall}
                  disabled={isInstalling}
                  className="flex-1"
                >
                  <Download className="mr-2 h-4 w-4" />
                  {isInstalling
                    ? t("pwa.installing", "安装中...")
                    : t("pwa.install-button", "安装应用")
                  }
                </Button>
                <Button variant="outline" onClick={handleDismiss}>
                  {t("common.cancel", "取消")}
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default PWAUpdatePrompt;