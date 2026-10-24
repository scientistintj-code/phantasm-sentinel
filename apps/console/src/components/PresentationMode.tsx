import { LuMaximize2, LuMinimize2 } from "react-icons/lu";

export function PresentationMode({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  return (
    <button type="button" className={`btn btn-ghost presentation-btn ${active ? "active" : ""}`} onClick={onToggle}>
      <span className="morph-icon" key={active ? "on" : "off"}>
        {active ? <LuMinimize2 size={16} /> : <LuMaximize2 size={16} />}
      </span>
      Presentation Mode
    </button>
  );
}
