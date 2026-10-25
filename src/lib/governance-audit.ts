import { z } from "zod";

export const auditQuerySchema = z.object({
  action: z.string().max(64).optional(),
  actorId: z.string().uuid().optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  search: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export type AuditQuery = z.infer<typeof auditQuerySchema>;
export type AuditRow = {
  id: string;
  actor_id: string | null;
  action: string;
  provider: string | null;
  created_at: string;
  metadata: Record<string, unknown>;
};

/** Filters a single organization-scoped audit result set; never accepts an org id. */
export function filterAuditEvents(events: AuditRow[], query: AuditQuery) {
  const from = query.from ? new Date(`${query.from}T00:00:00.000Z`) : undefined;
  const to = query.to ? new Date(`${query.to}T23:59:59.999Z`) : undefined;
  const needle = query.search?.toLowerCase();
  const filtered = events.filter((event) => {
    const occurred = new Date(event.created_at);
    if (query.action && event.action !== query.action) return false;
    if (query.actorId && event.actor_id !== query.actorId) return false;
    if (from && occurred < from) return false;
    if (to && occurred > to) return false;
    if (needle) {
      const searchable = [event.action, event.provider ?? "", event.actor_id ?? "", JSON.stringify(event.metadata)].join(" ").toLowerCase();
      if (!searchable.includes(needle)) return false;
    }
    return true;
  });
  const offset = (query.page - 1) * query.pageSize;
  return { events: filtered.slice(offset, offset + query.pageSize), total: filtered.length, page: query.page, pageSize: query.pageSize };
}
