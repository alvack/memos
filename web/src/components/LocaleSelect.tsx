import { GlobeIcon } from "lucide-react";
import { FC } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { locales } from "@/i18n";
import { getLocaleDisplayName } from "@/utils/i18n";

interface Props {
  value: Locale;
  onChange: (locale: Locale) => void;
}

const LocaleSelect: FC<Props> = (props: Props) => {
  const { onChange, value } = props;

  const handleSelectChange = async (locale: Locale) => {
    onChange(locale);
  };

  return (
    <Select value={value} onValueChange={handleSelectChange}>
      <SelectTrigger>
        <div className="flex items-center gap-2">
          <GlobeIcon className="w-4 h-auto" />
          <SelectValue placeholder="Select language" />
        </div>
      </SelectTrigger>
      <SelectContent>
        {locales.map((locale) => {
          const languageNames = {
            "zh-Hans": "简体中文",
            "zh-Hant": "繁體中文",
            "en": "English",
          };

          return (
            <SelectItem key={locale} value={locale}>
              {languageNames[locale as keyof typeof languageNames] || locale}
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
};

export default LocaleSelect;
