import { LuCheck } from "react-icons/lu";

const PHASE_LABELS = [
  "Initialize Cloud Browser",
  "Load Site",
  "Bypass Popups",
  "Navigate Checkout",
  "Collect Evidence",
  "Validate Payload",
  "Build Graph",
] as const;

export function Stepper({ phaseIndex, complete }: { phaseIndex: number; complete: boolean }) {
  return (
    <div className="stepper">
      {PHASE_LABELS.map((label, index) => {
        const done = complete || index < phaseIndex;
        const current = !done && index === phaseIndex;
        const className = `step${done ? " done" : ""}${current ? " current" : ""}`;
        return (
          <div className={className} key={label}>
            <span>{done ? <LuCheck size={12} /> : index + 1}</span>
            <em>{label}</em>
            {index < PHASE_LABELS.length - 1 ? <i /> : null}
          </div>
        );
      })}
    </div>
  );
}
