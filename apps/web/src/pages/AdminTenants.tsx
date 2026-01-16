import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type Tenant, type TenantAlertSettings } from "../lib/api";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../components/ui/collapsible";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { PageHeader } from "../components/ui/page-header";
import { InfoBox } from "../components/ui/info-box";
import { LoadingSkeleton } from "../components/ui/loading-skeleton";
import { Switch } from "../components/ui/switch";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Badge } from "../components/ui/badge";
import { X, ChevronDown } from "lucide-react";

export function AdminTenants() {
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["admin-tenants"],
    queryFn: api.listAllTenants,
  });

  const createMutation = useMutation({
    mutationFn: api.createTenant,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-tenants"] });
      setIsCreateModalOpen(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: api.deleteTenant,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-tenants"] });
    },
  });

  if (isLoading) {
    return (
      <div className="p-6">
        <LoadingSkeleton variant="page" />
      </div>
    );
  }

  return (
    <div className="p-6">
      <PageHeader
        title="Tenant Management"
        description="Create and manage tenants. Only system administrators can access this page."
        actions={
          <Button onClick={() => setIsCreateModalOpen(true)}>
            Create Tenant
          </Button>
        }
      />

      {/* Tenants Table */}
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tenant</TableHead>
              <TableHead>Slug</TableHead>
              <TableHead>Members</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.tenants.map((tenant) => (
              <TableRow key={tenant.id}>
                <TableCell>
                  <div className="text-sm font-medium text-foreground">{tenant.name}</div>
                  <div className="text-xs text-muted-foreground">{tenant.id}</div>
                </TableCell>
                <TableCell>
                  <Badge variant="secondary">
                    {tenant.slug}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {tenant.memberCount || 0}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {new Date(tenant.createdAt).toLocaleDateString()}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="link"
                    onClick={() => setSelectedTenant(tenant)}
                    className="mr-2"
                  >
                    Manage
                  </Button>
                  <Button
                    variant="link"
                    onClick={() => {
                      if (confirm(`Delete tenant "${tenant.name}"? This cannot be undone.`)) {
                        deleteMutation.mutate(tenant.id);
                      }
                    }}
                    className="text-destructive"
                  >
                    Delete
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {(!data?.tenants || data.tenants.length === 0) && (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-12 text-muted-foreground">
                  No tenants yet. Create one to get started.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      {/* Create Tenant Modal */}
      <CreateTenantModal
        open={isCreateModalOpen}
        onOpenChange={setIsCreateModalOpen}
        onSubmit={(data) => createMutation.mutate(data)}
        isLoading={createMutation.isPending}
        error={createMutation.error?.message}
      />

      {/* Tenant Members Modal */}
      {selectedTenant && (
        <TenantMembersModal
          tenant={selectedTenant}
          onClose={() => setSelectedTenant(null)}
        />
      )}
    </div>
  );
}

interface QuotaOverrides {
  maxKbs?: number;
  maxAgents?: number;
  maxUploadedDocsPerMonth?: number;
  maxScrapedPagesPerMonth?: number;
  maxCrawlConcurrency?: number;
  chatRateLimitPerMinute?: number;
}

const defaultQuotas: Required<QuotaOverrides> = {
  maxKbs: 10,
  maxAgents: 10,
  maxUploadedDocsPerMonth: 1000,
  maxScrapedPagesPerMonth: 1000,
  maxCrawlConcurrency: 5,
  chatRateLimitPerMinute: 60,
};

function CreateTenantModal({
  open,
  onOpenChange,
  onSubmit,
  isLoading,
  error,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: { name: string; slug: string; ownerEmail?: string; quotas?: QuotaOverrides }) => void;
  isLoading: boolean;
  error?: string;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [quotaSettingsOpen, setQuotaSettingsOpen] = useState(false);
  const [quotas, setQuotas] = useState<QuotaOverrides>({});

  const handleNameChange = (value: string) => {
    setName(value);
    setSlug(value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
  };

  const handleQuotaChange = (key: keyof QuotaOverrides, value: string) => {
    const numValue = parseInt(value, 10);
    if (isNaN(numValue) || value === "") {
      const newQuotas = { ...quotas };
      delete newQuotas[key];
      setQuotas(newQuotas);
    } else {
      setQuotas({ ...quotas, [key]: numValue });
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      name,
      slug,
      ownerEmail: ownerEmail || undefined,
      quotas: Object.keys(quotas).length > 0 ? quotas : undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create New Tenant</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Tenant Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="Acme Corp"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="slug">Slug</Label>
            <Input
              id="slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
              placeholder="acme-corp"
              pattern="[a-z0-9-]+"
              required
            />
            <p className="text-xs text-muted-foreground">
              URL-friendly identifier. Lowercase letters, numbers, and hyphens only.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ownerEmail">Owner Email (optional)</Label>
            <Input
              id="ownerEmail"
              type="email"
              value={ownerEmail}
              onChange={(e) => setOwnerEmail(e.target.value)}
              placeholder="owner@example.com"
            />
            <p className="text-xs text-muted-foreground">
              If specified, this user will be the owner. Otherwise, you become the owner.
            </p>
          </div>

          {/* Quota Settings - Collapsible */}
          <Collapsible open={quotaSettingsOpen} onOpenChange={setQuotaSettingsOpen}>
            <div className="pt-4 border-t border-border">
              <CollapsibleTrigger className="flex items-center justify-between w-full py-2 text-left">
                <h3 className="text-sm font-medium text-foreground">Quota Settings</h3>
                <ChevronDown
                  className={`w-5 h-5 text-muted-foreground transition-transform ${quotaSettingsOpen ? "rotate-180" : ""}`}
                />
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-3">
                <p className="text-xs text-muted-foreground mb-4">
                  Override default quota limits for this tenant. Leave empty to use system defaults.
                </p>
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Max Knowledge Bases</Label>
                      <Input
                        type="number"
                        value={quotas.maxKbs ?? ""}
                        onChange={(e) => handleQuotaChange("maxKbs", e.target.value)}
                        placeholder={String(defaultQuotas.maxKbs)}
                        min="1"
                        max="1000"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Max Agents</Label>
                      <Input
                        type="number"
                        value={quotas.maxAgents ?? ""}
                        onChange={(e) => handleQuotaChange("maxAgents", e.target.value)}
                        placeholder={String(defaultQuotas.maxAgents)}
                        min="1"
                        max="1000"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Uploads / Month</Label>
                      <Input
                        type="number"
                        value={quotas.maxUploadedDocsPerMonth ?? ""}
                        onChange={(e) => handleQuotaChange("maxUploadedDocsPerMonth", e.target.value)}
                        placeholder={String(defaultQuotas.maxUploadedDocsPerMonth)}
                        min="1"
                        max="100000"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Pages Scraped / Month</Label>
                      <Input
                        type="number"
                        value={quotas.maxScrapedPagesPerMonth ?? ""}
                        onChange={(e) => handleQuotaChange("maxScrapedPagesPerMonth", e.target.value)}
                        placeholder={String(defaultQuotas.maxScrapedPagesPerMonth)}
                        min="1"
                        max="100000"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Crawl Concurrency</Label>
                      <Input
                        type="number"
                        value={quotas.maxCrawlConcurrency ?? ""}
                        onChange={(e) => handleQuotaChange("maxCrawlConcurrency", e.target.value)}
                        placeholder={String(defaultQuotas.maxCrawlConcurrency)}
                        min="1"
                        max="50"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Chat Rate / Min</Label>
                      <Input
                        type="number"
                        value={quotas.chatRateLimitPerMinute ?? ""}
                        onChange={(e) => handleQuotaChange("chatRateLimitPerMinute", e.target.value)}
                        placeholder={String(defaultQuotas.chatRateLimitPerMinute)}
                        min="1"
                        max="1000"
                      />
                    </div>
                  </div>
                </div>
              </CollapsibleContent>
            </div>
          </Collapsible>

          {error && (
            <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isLoading || !name || !slug}
            >
              {isLoading ? "Creating..." : "Create Tenant"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TenantMembersModal({
  tenant,
  onClose,
}: {
  tenant: Tenant;
  onClose: () => void;
}) {
  const [addEmail, setAddEmail] = useState("");
  const [addRole, setAddRole] = useState<string>("member");
  const queryClient = useQueryClient();

  const { data: membersData, isLoading } = useQuery({
    queryKey: ["tenant-members", tenant.id],
    queryFn: () => api.listTenantMembers(tenant.id),
  });

  const addMemberMutation = useMutation({
    mutationFn: (data: { email: string; role: string }) =>
      api.addTenantMember(tenant.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenant-members", tenant.id] });
      queryClient.invalidateQueries({ queryKey: ["admin-tenants"] });
      setAddEmail("");
    },
  });

  const updateRoleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      api.updateTenantMember(tenant.id, userId, { role }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenant-members", tenant.id] });
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: (userId: string) => api.removeTenantMember(tenant.id, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenant-members", tenant.id] });
      queryClient.invalidateQueries({ queryKey: ["admin-tenants"] });
    },
  });

  const handleAddMember = (e: React.FormEvent) => {
    e.preventDefault();
    if (addEmail) {
      addMemberMutation.mutate({ email: addEmail, role: addRole });
    }
  };

  return (
    <div className="fixed inset-0 overlay-dim backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-card rounded-lg shadow-xl w-full max-w-2xl p-6 max-h-[80vh] overflow-y-auto border border-border">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">{tenant.name}</h2>
            <p className="text-sm text-muted-foreground">Manage tenant settings</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-5 h-5" />
          </Button>
        </div>

        <Tabs defaultValue="members">
          <TabsList>
            <TabsTrigger value="members">Members</TabsTrigger>
            <TabsTrigger value="alerts">Alert Settings</TabsTrigger>
          </TabsList>

          <TabsContent value="members" className="mt-4">
            {/* Add Member Form */}
            <form onSubmit={handleAddMember} className="mb-6 p-4 bg-muted rounded-lg">
              <h3 className="text-sm font-medium text-foreground mb-3">Add Member</h3>
              <div className="flex gap-3">
                <Input
                  type="email"
                  value={addEmail}
                  onChange={(e) => setAddEmail(e.target.value)}
                  className="flex-1"
                  placeholder="user@example.com"
                />
                <select
                  value={addRole}
                  onChange={(e) => setAddRole(e.target.value)}
                  className="rounded-lg border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="owner">Owner</option>
                  <option value="admin">Admin</option>
                  <option value="member">Member</option>
                  <option value="viewer">Viewer</option>
                </select>
                <Button
                  type="submit"
                  disabled={!addEmail || addMemberMutation.isPending}
                >
                  Add
                </Button>
              </div>
              {addMemberMutation.error && (
                <p className="mt-2 text-sm text-destructive">{addMemberMutation.error.message}</p>
              )}
            </form>

            {/* Members List */}
            {isLoading ? (
              <LoadingSkeleton variant="table" count={3} />
            ) : (
              <div className="space-y-2">
                {membersData?.members.map((member) => (
                  <div
                    key={member.userId}
                    className="flex items-center justify-between p-3 bg-card border border-border rounded-lg"
                  >
                    <div>
                      <p className="text-sm font-medium text-foreground">{member.email}</p>
                      <p className="text-xs text-muted-foreground">
                        Added {new Date(member.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <select
                        value={member.role}
                        onChange={(e) =>
                          updateRoleMutation.mutate({
                            userId: member.userId,
                            role: e.target.value,
                          })
                        }
                        className="rounded border border-input bg-background px-2 py-1 text-sm"
                      >
                        <option value="owner">Owner</option>
                        <option value="admin">Admin</option>
                        <option value="member">Member</option>
                        <option value="viewer">Viewer</option>
                      </select>
                      <Button
                        variant="link"
                        onClick={() => {
                          if (confirm(`Remove ${member.email} from this tenant?`)) {
                            removeMemberMutation.mutate(member.userId);
                          }
                        }}
                        className="text-destructive"
                      >
                        Remove
                      </Button>
                    </div>
                  </div>
                ))}
                {(!membersData?.members || membersData.members.length === 0) && (
                  <p className="text-center text-muted-foreground py-4">No members yet.</p>
                )}
              </div>
            )}
          </TabsContent>

          <TabsContent value="alerts" className="mt-4">
            <TenantAlertSettingsTab tenantId={tenant.id} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function TenantAlertSettingsTab({ tenantId }: { tenantId: string }) {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["tenant-alert-settings", tenantId],
    queryFn: () => api.getTenantAlertSettings(tenantId),
  });

  const updateMutation = useMutation({
    mutationFn: (settings: Partial<Omit<TenantAlertSettings, "tenantId" | "createdAt" | "updatedAt">>) =>
      api.updateTenantAlertSettings(tenantId, settings),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenant-alert-settings", tenantId] });
    },
  });

  const [localSettings, setLocalSettings] = useState<Partial<TenantAlertSettings>>({});

  const settings = data?.alertSettings;

  const handleChange = <K extends keyof TenantAlertSettings>(
    key: K,
    value: TenantAlertSettings[K]
  ) => {
    setLocalSettings((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = () => {
    updateMutation.mutate(localSettings);
    setLocalSettings({});
  };

  const hasChanges = Object.keys(localSettings).length > 0;

  const getValue = <K extends keyof TenantAlertSettings>(key: K): TenantAlertSettings[K] | undefined => {
    if (key in localSettings) {
      return localSettings[key] as TenantAlertSettings[K];
    }
    return settings?.[key];
  };

  if (isLoading) {
    return <LoadingSkeleton variant="form" count={3} />;
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
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium text-foreground">Enable Alerts</h3>
              <p className="text-xs text-muted-foreground">Receive health alerts for this tenant</p>
            </div>
            <Switch
              checked={getValue("enabled") ?? true}
              onCheckedChange={(checked) => handleChange("enabled", checked)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Notification Recipients */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Notification Recipients</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-foreground">Notify Owners</p>
              <p className="text-xs text-muted-foreground">All tenant owners receive alerts</p>
            </div>
            <Switch
              checked={getValue("notifyOwners") ?? true}
              onCheckedChange={(checked) => handleChange("notifyOwners", checked)}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-foreground">Notify Admins</p>
              <p className="text-xs text-muted-foreground">All tenant admins receive alerts</p>
            </div>
            <Switch
              checked={getValue("notifyAdmins") ?? false}
              onCheckedChange={(checked) => handleChange("notifyAdmins", checked)}
            />
          </div>

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
          <div className="grid grid-cols-3 gap-4">
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
        <div className="p-3 bg-success/10 border border-success/20 rounded-lg">
          <p className="text-sm text-success">Alert settings saved successfully!</p>
        </div>
      )}

      {updateMutation.error && (
        <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
          <p className="text-sm text-destructive">{updateMutation.error.message}</p>
        </div>
      )}
    </div>
  );
}
