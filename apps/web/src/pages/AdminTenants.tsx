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
import { EmptyState } from "../components/ui/empty-state";
import { ConfirmDialog } from "../components/ui/confirm-dialog";
import { Switch } from "../components/ui/switch";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
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
import { Building2, Settings, Trash2, ChevronDown, Users, Bell } from "lucide-react";

export function AdminTenants() {
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null);
  const [tenantToDelete, setTenantToDelete] = useState<Tenant | null>(null);
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
      setTenantToDelete(null);
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
      {(!data?.tenants || data.tenants.length === 0) ? (
        <EmptyState
          icon={Building2}
          title="No tenants yet"
          description="Create a tenant to get started."
          action={{
            label: "Create Tenant",
            onClick: () => setIsCreateModalOpen(true),
          }}
        />
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead>Tenant</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead>Members</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.tenants.map((tenant) => (
                <TableRow key={tenant.id}>
                  <TableCell>
                    <div className="text-sm font-medium text-foreground">{tenant.name}</div>
                    <div className="text-xs text-muted-foreground font-mono">{tenant.id.substring(0, 8)}...</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      {tenant.slug}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                      <Users className="w-4 h-4" />
                      {tenant.memberCount || 0}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(tenant.createdAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => setSelectedTenant(tenant)}
                        title="Manage tenant"
                      >
                        <Settings className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive"
                        onClick={() => setTenantToDelete(tenant)}
                        title="Delete tenant"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Create Tenant Modal */}
      <CreateTenantModal
        open={isCreateModalOpen}
        onOpenChange={setIsCreateModalOpen}
        onSubmit={(data) => createMutation.mutate(data)}
        isLoading={createMutation.isPending}
        error={createMutation.error?.message}
      />

      {/* Tenant Management Modal */}
      {selectedTenant && (
        <TenantManagementModal
          tenant={selectedTenant}
          open={true}
          onOpenChange={(open) => {
            if (!open) setSelectedTenant(null);
          }}
        />
      )}

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={!!tenantToDelete}
        onOpenChange={(open) => {
          if (!open) setTenantToDelete(null);
        }}
        title="Delete Tenant"
        description={`Are you sure you want to delete "${tenantToDelete?.name}"? This will remove all associated data including knowledge bases, agents, and members. This action cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => {
          if (tenantToDelete) {
            deleteMutation.mutate(tenantToDelete.id);
          }
        }}
        isLoading={deleteMutation.isPending}
      />
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
              variant="outline"
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

function TenantManagementModal({
  tenant,
  open,
  onOpenChange,
}: {
  tenant: Tenant;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [addEmail, setAddEmail] = useState("");
  const [addRole, setAddRole] = useState<string>("member");
  const [memberToRemove, setMemberToRemove] = useState<{ userId: string; email: string } | null>(null);
  const queryClient = useQueryClient();

  const { data: membersData, isLoading } = useQuery({
    queryKey: ["tenant-members", tenant.id],
    queryFn: () => api.listTenantMembers(tenant.id),
    enabled: open,
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
      setMemberToRemove(null);
    },
  });

  const handleAddMember = (e: React.FormEvent) => {
    e.preventDefault();
    if (addEmail) {
      addMemberMutation.mutate({ email: addEmail, role: addRole });
    }
  };

  const roles = [
    { value: "owner", label: "Owner" },
    { value: "admin", label: "Admin" },
    { value: "member", label: "Member" },
    { value: "viewer", label: "Viewer" },
  ];

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{tenant.name}</DialogTitle>
          </DialogHeader>

          <Tabs defaultValue="members">
            <TabsList>
              <TabsTrigger value="members" className="gap-2">
                <Users className="w-4 h-4" />
                Members
              </TabsTrigger>
              <TabsTrigger value="alerts" className="gap-2">
                <Bell className="w-4 h-4" />
                Alert Settings
              </TabsTrigger>
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
                  <Select value={addRole} onValueChange={setAddRole}>
                    <SelectTrigger className="w-[130px]">
                      <SelectValue placeholder="Select role" />
                    </SelectTrigger>
                    <SelectContent>
                      {roles.map((role) => (
                        <SelectItem key={role.value} value={role.value}>
                          {role.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="submit"
                    disabled={!addEmail || addMemberMutation.isPending}
                  >
                    {addMemberMutation.isPending ? "Adding..." : "Add"}
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
                        <Select
                          value={member.role}
                          onValueChange={(value) =>
                            updateRoleMutation.mutate({
                              userId: member.userId,
                              role: value,
                            })
                          }
                        >
                          <SelectTrigger className="w-[110px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {roles.map((role) => (
                              <SelectItem key={role.value} value={role.value}>
                                {role.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive"
                          onClick={() => setMemberToRemove({ userId: member.userId, email: member.email })}
                          title="Remove member"
                        >
                          <Trash2 className="w-4 h-4" />
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

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove Member Confirmation */}
      <ConfirmDialog
        open={!!memberToRemove}
        onOpenChange={(open) => {
          if (!open) setMemberToRemove(null);
        }}
        title="Remove Member"
        description={`Are you sure you want to remove ${memberToRemove?.email} from this tenant?`}
        confirmLabel="Remove"
        variant="destructive"
        onConfirm={() => {
          if (memberToRemove) {
            removeMemberMutation.mutate(memberToRemove.userId);
          }
        }}
        isLoading={removeMemberMutation.isPending}
      />
    </>
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
            variant="outline"
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
