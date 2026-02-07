import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SystemSetting } from "../../lib/api";

interface SettingInputProps {
  setting: SystemSetting;
  onUpdate: (key: string, value: string | number | boolean) => void;
  isUpdating: boolean;
}

export function SettingInput({ setting, onUpdate, isUpdating }: SettingInputProps) {
  const [localValue, setLocalValue] = useState<string>(
    setting.isSecret ? "" : String(setting.value)
  );
  const [hasChanged, setHasChanged] = useState(false);

  const handleChange = (value: string) => {
    setLocalValue(value);
    setHasChanged(true);
  };

  const handleSave = () => {
    if (!hasChanged) return;

    let parsedValue: string | number | boolean = localValue;

    // Try to parse as number or boolean
    if (localValue === "true") parsedValue = true;
    else if (localValue === "false") parsedValue = false;
    else if (!isNaN(Number(localValue)) && localValue !== "") parsedValue = Number(localValue);

    onUpdate(setting.key, parsedValue);
    setHasChanged(false);
  };

  const inputType = setting.isSecret ? "password" : "text";
  const placeholder = setting.isSecret ? "Enter new value to update" : "";

  return (
    <div className="py-4 border-b border-border last:border-0">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <Label className="text-sm font-medium text-foreground">
            {setting.key.split(".").pop()?.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}
          </Label>
          <p className="mt-1 text-xs text-muted-foreground">{setting.description}</p>
          {setting.isSecret && setting.isConfigured && (
            <p className="mt-1 text-xs text-success">Configured (hidden)</p>
          )}
        </div>
        <div className="flex items-center gap-2 w-80">
          <Input
            type={inputType}
            value={localValue}
            onChange={(e) => handleChange(e.target.value)}
            placeholder={placeholder}
            className="flex-1"
          />
          {hasChanged && (
            <Button
              onClick={handleSave}
              disabled={isUpdating}
              size="sm"
            >
              Save
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
