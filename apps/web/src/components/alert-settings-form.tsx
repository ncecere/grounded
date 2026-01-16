import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { api, type TenantAlertSettings } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { InfoBox } from "@/components/ui/info-box"
import { LoadingSkeleton } from "@/components/ui/loading-skeleton"
import { ToggleField } from "@/components/ui/toggle-field"

interface AlertSettingsFormProps {
  tenantId: string
}

export function AlertSettingsForm({ tenantId }: AlertSettingsFormProps) {
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ["tenant-alert-settings", tenantId],
    queryFn: () => api.getTenantAlertSettings(tenantId),
  })

  const updateMutation = useMutation({
    mutationFn: (settings: Partial<Omit<TenantAlertSettings, "tenantId" | "createdAt" | "updatedAt">>) =>
      api.updateTenantAlertSettings(tenantId, settings),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenant-alert-settings", tenantId] })
    },
  })

  const [localSettings, setLocalSettings] = useState<Partial<TenantAlertSettings>>({})

  const settings = data?.alertSettings

  const handleChange = <K extends keyof TenantAlertSettings>(
    key: K,
    value: TenantAlertSettings[K]
  ) => {
    setLocalSettings((prev) => ({ ...prev, [key]: value }))
  }

  const handleSave = () => {
    updateMutation.mutate(localSettings)
    setLocalSettings({})
  }

  const hasChanges = Object.keys(localSettings).length > 0

  const getValue = <K extends keyof TenantAlertSettings>(key: K): TenantAlertSettings[K] | undefined => {
    if (key in localSettings) {
      return localSettings[key] as TenantAlertSettings[K]
    }
    return settings?.[key]
  }

  if (isLoading) {
    return <LoadingSkeleton variant="form" count={3} />
  }

  return (
    <div className="space-y-6">
      <InfoBox variant="info">
        Configure health alert notifications for this tenant. Owners and admins can receive
        automated alerts when issues are detected.
      </InfoBox>

      {/* Enable/Disable Alerts */}
      <Card>
        <CardContent className="pt-6">
          <ToggleField
            label="Enable Alerts"
            description="Receive health alerts for this tenant"
            checked={getValue("enabled") ?? true}
            onCheckedChange={(checked) => handleChange("enabled", checked)}
          />
        </CardContent>
      </Card>

      {/* Notification Recipients */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Notification Recipients</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ToggleField
            label="Notify Owners"
            description="All tenant owners receive alerts"
            checked={getValue("notifyOwners") ?? true}
            onCheckedChange={(checked) => handleChange("notifyOwners", checked)}
          />

          <ToggleField
            label="Notify Admins"
            description="All tenant admins receive alerts"
            checked={getValue("notifyAdmins") ?? false}
            onCheckedChange={(checked) => handleChange("notifyAdmins", checked)}
          />

          <div className="space-y-2">
            <Label>Additional Emails</Label>
            <Input
              value={getValue("additionalEmails") || ""}
              onChange={(e) => handleChange("additionalEmails", e.target.value || null)}
              placeholder="email1@example.com, email2@example.com"
            />
            <p className="text-xs text-muted-foreground">Comma-separated list of additional email addresses</p>
          </div>
        </CardContent>
      </Card>

      {/* Threshold Overrides */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Threshold Overrides</CardTitle>
          <p className="text-xs text-muted-foreground">Leave empty to use system defaults</p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Error Rate (%)</Label>
              <Input
                type="number"
                value={getValue("errorRateThreshold") ?? ""}
                onChange={(e) =>
                  handleChange("errorRateThreshold", e.target.value ? parseInt(e.target.value) : null)
                }
                placeholder="10"
                min="1"
                max="100"
              />
            </div>
            <div className="space-y-2">
              <Label>Quota Warning (%)</Label>
              <Input
                type="number"
                value={getValue("quotaWarningThreshold") ?? ""}
                onChange={(e) =>
                  handleChange("quotaWarningThreshold", e.target.value ? parseInt(e.target.value) : null)
                }
                placeholder="80"
                min="1"
                max="100"
              />
            </div>
            <div className="space-y-2">
              <Label>Inactivity (days)</Label>
              <Input
                type="number"
                value={getValue("inactivityDays") ?? ""}
                onChange={(e) =>
                  handleChange("inactivityDays", e.target.value ? parseInt(e.target.value) : null)
                }
                placeholder="7"
                min="0"
                max="365"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Save Button */}
      {hasChanges && (
        <div className="flex justify-end gap-3">
          <Button
            variant="ghost"
            onClick={() => setLocalSettings({})}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={updateMutation.isPending}
          >
            {updateMutation.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      )}

      {updateMutation.isSuccess && !hasChanges && (
        <InfoBox variant="success">
          Alert settings saved successfully!
        </InfoBox>
      )}

      {updateMutation.error && (
        <InfoBox variant="destructive">
          {updateMutation.error.message}
        </InfoBox>
      )}
    </div>
  )
}
