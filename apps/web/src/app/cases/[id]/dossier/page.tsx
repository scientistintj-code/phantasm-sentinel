import { Dossier } from "@/components/Dossier";
import { isPrintQuery } from "@/lib/dossier";
import { isReplayQuery } from "@/lib/ledger";
import { loadMethodology } from "@/lib/risk-source";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Dossier",
  openGraph: { title: "Dossier · Phantasm Sentinel" },
};

export default async function DossierPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ replay?: string | string[]; print?: string | string[] }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const methodology = await loadMethodology();
  return (
    <main className="stack">
      <Dossier
        caseId={id}
        replay={isReplayQuery(query.replay)}
        autoPrint={isPrintQuery(query.print)}
        methodology={methodology}
      />
    </main>
  );
}
