"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { Product } from "@/lib/storefronts";

export type CartLine = {
  id: string;
  name: string;
  priceCents: number;
  quantity: number;
};

export type ShippingDraft = {
  name: string;
  line1: string;
  city: string;
  region: string;
  postal: string;
};

export type IntakeDraft = {
  answers: Record<string, string>;
  shipping: ShippingDraft;
};

type LabContextValue = {
  ready: boolean;
  cart: CartLine[];
  intake: IntakeDraft;
  add: (product: Product) => void;
  setAnswer: (id: string, value: string) => void;
  setShipping: (patch: Partial<ShippingDraft>) => void;
};

const LabContext = createContext<LabContextValue | null>(null);

function emptyShipping(): ShippingDraft {
  return { name: "", line1: "", city: "", region: "", postal: "" };
}

function emptyIntake(): IntakeDraft {
  return { answers: {}, shipping: emptyShipping() };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clip(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.slice(0, 200);
}

function readCart(value: unknown): CartLine[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => (isCartLine(item) ? [item] : []));
}

function isCartLine(value: unknown): value is CartLine {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.id === "string" &&
    value.id.length > 0 &&
    value.id.length < 80 &&
    typeof value.name === "string" &&
    value.name.length > 0 &&
    value.name.length < 200 &&
    typeof value.priceCents === "number" &&
    Number.isInteger(value.priceCents) &&
    value.priceCents > 0 &&
    typeof value.quantity === "number" &&
    Number.isInteger(value.quantity) &&
    value.quantity > 0 &&
    value.quantity < 100
  );
}

function readIntake(value: unknown): IntakeDraft {
  const source = isRecord(value) ? value : {};
  const answers: Record<string, string> = {};
  if (isRecord(source.answers)) {
    for (const [key, entry] of Object.entries(source.answers)) {
      if (key.length > 0 && key.length < 80) {
        const text = clip(entry);
        if (text.length > 0) {
          answers[key] = text;
        }
      }
    }
  }
  const shipping = isRecord(source.shipping) ? source.shipping : {};
  return {
    answers,
    shipping: {
      name: clip(shipping.name),
      line1: clip(shipping.line1),
      city: clip(shipping.city),
      region: clip(shipping.region),
      postal: clip(shipping.postal),
    },
  };
}

function readJson<T>(
  key: string,
  parse: (value: unknown) => T,
  fallback: T,
): T {
  try {
    const raw = sessionStorage.getItem(key);
    if (raw === null) {
      return fallback;
    }
    return parse(JSON.parse(raw) as unknown);
  } catch {
    return fallback;
  }
}

export function sumCart(cart: readonly CartLine[]): number {
  return cart.reduce((sum, line) => sum + line.priceCents * line.quantity, 0);
}

export function useLabState(): LabContextValue {
  const value = useContext(LabContext);
  if (value === null) {
    throw new Error("useLabState must be used inside LabProvider");
  }
  return value;
}

export function LabProvider({
  storeId,
  children,
}: {
  storeId: string;
  children: ReactNode;
}) {
  const cartKey = `lab-cart-${storeId}`;
  const intakeKey = `lab-intake-${storeId}`;
  const [cart, setCart] = useState<CartLine[]>([]);
  const [intake, setIntake] = useState<IntakeDraft>(emptyIntake);
  const [ready, setReady] = useState(false);
  const dirty = useRef(false);

  useEffect(() => {
    if (!dirty.current) {
      setCart(readJson(cartKey, readCart, []));
      setIntake(readJson(intakeKey, readIntake, emptyIntake()));
    }
    setReady(true);
  }, [cartKey, intakeKey]);

  useEffect(() => {
    if (!ready) {
      return;
    }
    sessionStorage.setItem(cartKey, JSON.stringify(cart));
  }, [ready, cart, cartKey]);

  useEffect(() => {
    if (!ready) {
      return;
    }
    sessionStorage.setItem(intakeKey, JSON.stringify(intake));
  }, [ready, intake, intakeKey]);

  const add = useCallback((product: Product) => {
    dirty.current = true;
    setCart((current) => {
      const existing = current.find((line) => line.id === product.id);
      if (!existing) {
        return [
          ...current,
          {
            id: product.id,
            name: product.name,
            priceCents: product.priceCents,
            quantity: 1,
          },
        ];
      }
      return current.map((line) =>
        line.id === product.id
          ? { ...line, quantity: Math.min(line.quantity + 1, 99) }
          : line,
      );
    });
  }, []);

  const setAnswer = useCallback((id: string, value: string) => {
    dirty.current = true;
    setIntake((current) => ({
      ...current,
      answers: { ...current.answers, [id]: value },
    }));
  }, []);

  const setShipping = useCallback((patch: Partial<ShippingDraft>) => {
    dirty.current = true;
    setIntake((current) => {
      const shipping = { ...current.shipping };
      const fields: (keyof ShippingDraft)[] = [
        "name",
        "line1",
        "city",
        "region",
        "postal",
      ];
      for (const field of fields) {
        const next = patch[field];
        if (typeof next === "string") {
          shipping[field] = next;
        }
      }
      return { ...current, shipping };
    });
  }, []);

  const value = useMemo(
    () => ({ ready, cart, intake, add, setAnswer, setShipping }),
    [ready, cart, intake, add, setAnswer, setShipping],
  );

  return <LabContext.Provider value={value}>{children}</LabContext.Provider>;
}
