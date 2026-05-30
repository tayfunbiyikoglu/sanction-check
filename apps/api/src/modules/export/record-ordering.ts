import type { SanctionsDeltaRecord } from "@sanctions/domain";

export function orderRecordsForExport(records: SanctionsDeltaRecord[]): SanctionsDeltaRecord[] {
  return [...records].sort((left, right) => {
    return (
      left.sourceOrder - right.sourceOrder ||
      (left.affectedAnnex ?? "").localeCompare(right.affectedAnnex ?? "") ||
      (left.sourceLocation ?? "").localeCompare(right.sourceLocation ?? "") ||
      left.id.localeCompare(right.id)
    );
  });
}
