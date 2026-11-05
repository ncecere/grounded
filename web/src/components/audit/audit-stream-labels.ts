/* Audit actions of audit streaming (docs/specs/audit-streaming/DESIGN.md). */
export const auditStreamActionLabels: Record<string, string> = {
  "platform.audit_streaming": "Changed audit streaming",
  "platform.audit_stream_create": "Added an audit streaming destination",
  "platform.audit_stream_update": "Changed an audit streaming destination",
  "platform.audit_stream_delete": "Deleted an audit streaming destination",
  "platform.audit_stream_enable": "Turned an audit streaming destination on",
  "platform.audit_stream_disable": "Turned an audit streaming destination off",
  "platform.audit_stream_test": "Tested an audit streaming destination",
};
