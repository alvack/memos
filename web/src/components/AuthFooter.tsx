import { observer } from "mobx-react-lite";
import { cn } from "@/lib/utils";
import { workspaceStore } from "@/store";
import LocaleSelect from "./LocaleSelect";
import ThemeSelect from "./ThemeSelect";

interface Props {
  className?: string;
}

const AuthFooter = observer(({ className }: Props) => {
  const handleLocaleChange = (locale: Locale) => {
    console.log("AuthFooter: Language changed from", workspaceStore.state.locale, "to", locale);
    workspaceStore.state.setPartial({ locale });
  };

  return (
    <div className={cn("mt-4 flex flex-row items-center justify-center w-full gap-2", className)}>
      <LocaleSelect value={workspaceStore.state.locale} onChange={handleLocaleChange} />
      <ThemeSelect value={workspaceStore.state.theme} onValueChange={(theme) => workspaceStore.state.setPartial({ theme })} />
    </div>
  );
});

export default AuthFooter;
