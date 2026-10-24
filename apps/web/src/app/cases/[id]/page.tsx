import { CaseOverview } from "@/components/CaseOverview";
import { isReplayQuery } from "@/lib/ledger";

export const dynamic = "force-dynamic";

export const metadata = { title: "Case" };

export default async function CasePage({
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
      <CaseOverview caseId={id} replay={isReplayQuery(query.replay)} />
    </main>
  );
}
