import { MethodologyView } from "@/components/MethodologyView";
import { loadMethodology } from "@/lib/risk-source";

export const dynamic = "force-dynamic";

export const metadata = { title: "Methodology" };

export default async function MethodologyPage() {
  let text: string | null = null;
  let error: string | null = null;
  try {
    const loaded = await loadMethodology();
    text = loaded.trim() === "" ? null : loaded;
  } catch {
    error = "Methodology could not be loaded.";
  }

  return (
    <main className="stack">
      <MethodologyView text={text} error={error} />
    </main>
  );
}
