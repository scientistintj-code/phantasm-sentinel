import { IntakeWizard } from "@/components/intake-wizard";
import { getCurrentStorefront } from "@/lib/storefronts";

export default function IntakePage() {
  const store = getCurrentStorefront();
  return <IntakeWizard questions={store.questions} />;
}
