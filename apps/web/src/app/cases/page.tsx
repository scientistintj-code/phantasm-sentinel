import { CasesTable } from "@/components/CasesTable";
import { isReplayQuery } from "@/lib/ledger";

export const dynamic = "force-dynamic";

export const metadata = { title: "Cases" };

export default async function CasesPage({
  searchParams,
}: {
  searchParams: Promise<{ replay?: string | string[] }>;
}) {
  const query = await searchParams;
  return (
    <main className="stack">
      <CasesTable replay={isReplayQuery(query.replay)} />
    </main>
  );
}
