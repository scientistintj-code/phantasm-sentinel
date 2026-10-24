import type { IconType } from "react-icons";
import type { ReactNode } from "react";

export function Panel({
  title,
  icon: Icon,
  className = "",
  children,
}: {
  title: string;
  icon: IconType;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`panel ${className}`.trim()}>
      <div className="panel-title">
        <Icon size={16} />
        <span>{title}</span>
        <i />
      </div>
      {children}
    </section>
  );
}
