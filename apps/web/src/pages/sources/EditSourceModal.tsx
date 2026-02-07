import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { Button } from "@/components/ui/button";

export interface EditSourceData {
  id: string;
  name: string;
  type: "web" | "upload";
  schedule: "daily" | "weekly" | null;
  depth: number;
}

interface EditSourceModalProps {
  editSource: EditSourceData;
  setEditSource: (value: EditSourceData) => void;
  onClose: () => void;
  onEdit: (e: React.FormEvent) => void;
  updateIsPending: boolean;
}

export function EditSourceModal({
  editSource,
  setEditSource,
  onClose,
  onEdit,
  updateIsPending,
}: EditSourceModalProps) {
  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-card rounded-lg shadow-xl w-full max-w-md mx-4 border border-border">
        <form onSubmit={onEdit}>
          <div className="p-6">
            <h2 className="text-lg font-semibold text-foreground">Edit Source</h2>
            <div className="mt-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground">Name</label>
                <input
                  type="text"
                  value={editSource.name}
                  onChange={(e) => setEditSource({ ...editSource, name: e.target.value })}
                  className="mt-1 block w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:ring-primary"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Max Depth</label>
                <Select
                  value={String(editSource.depth)}
                  onValueChange={(value) => setEditSource({ ...editSource, depth: parseInt(value) })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select max depth" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1 level</SelectItem>
                    <SelectItem value="2">2 levels</SelectItem>
                    <SelectItem value="3">3 levels</SelectItem>
                    <SelectItem value="5">5 levels</SelectItem>
                    <SelectItem value="10">10 levels</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Auto-Refresh Schedule</label>
                <Select
                  value={editSource.schedule || "none"}
                  onValueChange={(value) => setEditSource({ ...editSource, schedule: value === "none" ? null : value as "daily" | "weekly" })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select refresh schedule" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No auto-refresh</SelectItem>
                    <SelectItem value="daily">Daily</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                  </SelectContent>
                </Select>
                <p className="mt-1 text-xs text-muted-foreground">
                  Automatically re-scrape this source on a schedule
                </p>
              </div>
            </div>
          </div>
          <div className="px-6 py-4 bg-muted/50 rounded-b-lg flex justify-end gap-3 border-t border-border">
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={updateIsPending}
            >
              {updateIsPending ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
