import type { ExportCreate, ExportFormat, ExportScope } from '@wealthpilot/contracts';

export const EXPORT_SCOPE_LABELS: Record<ExportScope, { title: string; helper: string }> = {
  balances: { title: 'Balances', helper: 'Accounts, valuations and their provenance' },
  assumptions: { title: 'Assumptions', helper: 'Saved scenario versions and their inputs' },
  run: { title: 'Scenario run report', helper: 'One run’s stored results, assumptions and warnings' },
};

export const EXPORT_FORMAT_LABELS: Record<ExportFormat, string> = { csv: 'CSV', json: 'JSON', pdf: 'PDF report' };

/** Formats allowed for a scope (contract: PDF only for scope=run). */
export function formatsFor(scope: ExportScope): ExportFormat[] {
  return scope === 'run' ? ['pdf', 'csv', 'json'] : ['csv', 'json'];
}

export function buildExportRequest(scope: ExportScope, format: ExportFormat, runId?: string): ExportCreate {
  return scope === 'run' ? { scope, format, run_id: runId } : { scope, format };
}

/** A download file name such as "wealthpilot-run-2026-10-10.pdf". */
export function exportFileName(scope: ExportScope, format: ExportFormat, date: string): string {
  return `wealthpilot-${scope}-${date}.${format}`;
}
