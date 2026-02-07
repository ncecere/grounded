import { FormSection } from "@/components/ui/form-section";
import type { SystemSetting } from "../../lib/api";
import { SettingInput } from "./SettingInput";

interface SettingsSectionProps {
  title: string;
  description: string;
  settings: SystemSetting[];
  onUpdate: (key: string, value: string | number | boolean) => void;
  isUpdating: boolean;
}

export function SettingsSection({
  title,
  description,
  settings,
  onUpdate,
  isUpdating
}: SettingsSectionProps) {
  return (
    <FormSection title={title} description={description}>
      {settings.map((setting) => (
        <SettingInput
          key={setting.key}
          setting={setting}
          onUpdate={onUpdate}
          isUpdating={isUpdating}
        />
      ))}
    </FormSection>
  );
}
