import { LedgerTab } from "@/components/LedgerTab";
import { isReplayQuery } from "@/lib/ledger";

export const dynamic = "force-dynamic";

export default async function LedgerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ replay?: string | string[] }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  return (
    <main className="stack">
      <LedgerTab caseId={id} replay={isReplayQuery(query.replay)} />
    </main>
  );
}
