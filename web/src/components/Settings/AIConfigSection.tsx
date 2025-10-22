import { isEqual } from "lodash-es";
import { observer } from "mobx-react-lite";
import { useEffect, useState } from "react";
import { toast } from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { aiServiceClient } from "@/grpcweb";
import { workspaceStore } from "@/store";
import { workspaceSettingNamePrefix } from "@/store/common";
import { WorkspaceSetting_AISetting, WorkspaceSetting_Key } from "@/types/proto/api/v1/workspace_service";
import { useTranslate } from "@/utils/i18n";

// 支持的语言列表
const SUPPORTED_LANGUAGES = [
  { code: "zh-CN", label: "简体中文" },
  { code: "zh-TW", label: "繁體中文" },
  { code: "en", label: "English" },
];

// 多语言System Prompt类型
interface MultiLanguagePrompt {
  [languageCode: string]: string;
}

const AIConfigSection = observer(() => {
  const t = useTranslate();
  const originalSetting = WorkspaceSetting_AISetting.fromPartial(
    workspaceStore.getWorkspaceSettingByKey(WorkspaceSetting_Key.AI_CONFIG)?.aiSetting || {},
  );
  const [aiSetting, setAiSetting] = useState<WorkspaceSetting_AISetting>(originalSetting);
  const [testingConnection, setTestingConnection] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [activeLanguage, setActiveLanguage] = useState<string>("zh-CN");
  
  // 解析多语言System Prompt
  const parseSystemPrompt = (systemPrompt: string): MultiLanguagePrompt => {
    if (!systemPrompt) return {};
    try {
      const parsed = JSON.parse(systemPrompt);
      return typeof parsed === "object" ? parsed : {};
    } catch {
      // 如果不是JSON，作为默认语言（中文）
      return { "zh-CN": systemPrompt };
    }
  };

  const [multiLangPrompts, setMultiLangPrompts] = useState<MultiLanguagePrompt>(
    parseSystemPrompt(originalSetting.systemPrompt)
  );

  useEffect(() => {
    const currentSetting = workspaceStore.getWorkspaceSettingByKey(WorkspaceSetting_Key.AI_CONFIG)?.aiSetting;
    if (currentSetting) {
      const newSetting = WorkspaceSetting_AISetting.fromPartial(currentSetting);
      setAiSetting(newSetting);
      setMultiLangPrompts(parseSystemPrompt(newSetting.systemPrompt));
    }
  }, [workspaceStore.getWorkspaceSettingByKey(WorkspaceSetting_Key.AI_CONFIG)]);

  const updatePartialSetting = (partial: Partial<WorkspaceSetting_AISetting>) => {
    setAiSetting(
      WorkspaceSetting_AISetting.fromPartial({
        ...aiSetting,
        ...partial,
      }),
    );
  };

  const updatePromptForLanguage = (languageCode: string, prompt: string) => {
    const updated = { ...multiLangPrompts, [languageCode]: prompt };
    setMultiLangPrompts(updated);
    // 将多语言Prompt序列化为JSON存储
    updatePartialSetting({ systemPrompt: JSON.stringify(updated) });
  };

  const handleSaveAISetting = async () => {
    try {
      await workspaceStore.upsertWorkspaceSetting({
        name: `${workspaceSettingNamePrefix}${WorkspaceSetting_Key.AI_CONFIG}`,
        aiSetting: aiSetting,
      });
      toast.success(t("message.update-succeed"));
    } catch (error: any) {
      toast.error(error.details || error.message);
      console.error(error);
    }
  };

  const handleTestConnection = async () => {
    setTestingConnection(true);
    setTestResult(null);

    try {
      // First, save the current configuration
      await workspaceStore.upsertWorkspaceSetting({
        name: `${workspaceSettingNamePrefix}${WorkspaceSetting_Key.AI_CONFIG}`,
        aiSetting: aiSetting,
      });

      // Then test the configuration
      const response = await aiServiceClient.testAIConfig({});

      if (response.success) {
        setTestResult({ success: true, message: t("ai.test-success") });
        toast.success(t("ai.test-success"));
      } else {
        setTestResult({ success: false, message: response.errorMessage || t("ai.test-failed") });
        toast.error(response.errorMessage || t("ai.test-failed"));
      }
    } catch (error: any) {
      const errorMessage = error.details || error.message || t("ai.test-failed");
      setTestResult({ success: false, message: errorMessage });
      toast.error(errorMessage);
      console.error(error);
    } finally {
      setTestingConnection(false);
    }
  };

  return (
    <div className="w-full flex flex-col gap-2 pt-2 pb-4">
      <p className="font-medium text-foreground">{t("ai.config")}</p>
      <Separator />

      <div className="w-full flex flex-col gap-4 mt-2">
        <div className="w-full flex flex-col gap-2">
          <Label htmlFor="ai-endpoint">{t("ai.endpoint")}</Label>
          <Input
            id="ai-endpoint"
            className="w-full"
            placeholder={t("ai.endpoint-placeholder")}
            value={aiSetting.endpoint}
            onChange={(e) => updatePartialSetting({ endpoint: e.target.value })}
          />
        </div>

        <div className="w-full flex flex-col gap-2">
          <Label htmlFor="ai-api-key">{t("ai.api-key")}</Label>
          <Input
            id="ai-api-key"
            type="password"
            className="w-full font-mono"
            placeholder={t("ai.api-key-placeholder")}
            value={aiSetting.apiKey}
            onChange={(e) => updatePartialSetting({ apiKey: e.target.value })}
          />
        </div>

        <div className="w-full flex flex-col gap-2">
          <Label htmlFor="ai-model">{t("ai.model")}</Label>
          <Input
            id="ai-model"
            className="w-full"
            placeholder={t("ai.model-placeholder")}
            value={aiSetting.model}
            onChange={(e) => updatePartialSetting({ model: e.target.value })}
          />
        </div>

        <div className="w-full flex flex-col gap-2">
          <Label>{t("ai.system-prompt")}</Label>
          <Tabs value={activeLanguage} onValueChange={setActiveLanguage}>
            <TabsList>
              {SUPPORTED_LANGUAGES.map((lang) => (
                <TabsTrigger key={lang.code} value={lang.code}>
                  {lang.label}
                </TabsTrigger>
              ))}
            </TabsList>
            {SUPPORTED_LANGUAGES.map((lang) => (
              <TabsContent key={lang.code} value={lang.code}>
                <Textarea
                  className="font-mono w-full min-h-[200px]"
                  placeholder={t("ai.system-prompt-placeholder")}
                  value={multiLangPrompts[lang.code] || ""}
                  onChange={(e) => updatePromptForLanguage(lang.code, e.target.value)}
                />
              </TabsContent>
            ))}
          </Tabs>
          <p className="text-xs text-muted-foreground">
            {t("ai.system-prompt-hint")}
          </p>
        </div>

        <div className="w-full flex flex-row gap-2 items-center">
          <Button variant="outline" onClick={handleTestConnection} disabled={testingConnection || !aiSetting.endpoint || !aiSetting.apiKey}>
            {testingConnection ? t("ai.generating") : t("ai.test-connection")}
          </Button>
          {testResult && (
            <span className={testResult.success ? "text-green-600" : "text-red-600"}>
              {testResult.message}
            </span>
          )}
        </div>

        <div className="mt-2 w-full flex justify-end">
          <Button disabled={isEqual(aiSetting, originalSetting)} onClick={handleSaveAISetting}>
            {t("common.save")}
          </Button>
        </div>
      </div>
    </div>
  );
});

export default AIConfigSection;
