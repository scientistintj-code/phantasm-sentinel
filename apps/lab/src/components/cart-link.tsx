"use client";

import Link from "next/link";

import { useLabState } from "@/components/lab-state";

export function CartLink() {
  const { cart } = useLabState();
  const count = cart.reduce((sum, line) => sum + line.quantity, 0);
  return (
    <Link href="/intake" className="btn btn-ghost">
      Cart ({count})
    </Link>
  );
}
