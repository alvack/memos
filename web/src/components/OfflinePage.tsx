import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { WifiOff, RefreshCw } from "lucide-react";

const OfflinePage = () => {
  const { t } = useTranslation();

  const handleRefresh = () => {
    window.location.reload();
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-4 text-center">
      <div className="space-y-6 max-w-md">
        <div className="space-y-2">
          <WifiOff className="mx-auto h-16 w-16 text-muted-foreground" />
          <h1 className="text-2xl font-bold">{t("offline.title", "离线模式")}</h1>
          <p className="text-muted-foreground">
            {t("offline.description", "您当前处于离线状态。一些功能可能无法使用。")}
          </p>
        </div>

        <div className="space-y-4">
          <div className="rounded-lg border p-4 bg-muted/50">
            <h2 className="font-semibold mb-2">{t("offline.available", "仍可使用")}</h2>
            <ul className="text-sm text-muted-foreground space-y-1 text-left">
              <li>• {t("offline.view-notes", "查看已缓存的笔记")}</li>
              <li>• {t("offline.create-notes", "创建新笔记（将在联网后同步）")}</li>
              <li>• {t("offline.browse", "浏览已缓存的内容")}</li>
            </ul>
          </div>

          <div className="rounded-lg border p-4 bg-muted/50">
            <h2 className="font-semibold mb-2">{t("offline.unavailable", "暂时不可用")}</h2>
            <ul className="text-sm text-muted-foreground space-y-1 text-left">
              <li>• {t("offline.sync", "数据同步")}</li>
              <li>• {t("offline.new-content", "加载新内容")}</li>
              <li>• {t("online.upload", "上传文件")}</li>
            </ul>
          </div>
        </div>

        <Button onClick={handleRefresh} className="w-full" variant="outline">
          <RefreshCw className="mr-2 h-4 w-4" />
          {t("offline.retry", "重新连接")}
        </Button>
      </div>
    </div>
  );
};

export default OfflinePage;