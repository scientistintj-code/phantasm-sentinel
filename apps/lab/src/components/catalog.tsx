"use client";

import { useState } from "react";

import { useLabState } from "@/components/lab-state";
import { formatPrice } from "@/lib/format";
import type { Product } from "@/lib/storefronts";

export function Catalog({ products }: { products: readonly Product[] }) {
  const { add, ready } = useLabState();
  const [note, setNote] = useState("");

  return (
    <>
      <p className="cart-status" aria-live="polite">
        {note}
      </p>
      <ul className="catalog">
        {products.map((product) => (
          <li key={product.id} className="product">
            <h2>{product.name}</h2>
            <p className="blurb">{product.blurb}</p>
            <p className="price">{formatPrice(product.priceCents)}</p>
            <button
              type="button"
              className="btn"
              disabled={!ready}
              onClick={() => {
                add(product);
                setNote(`${product.name} added to cart.`);
              }}
            >
              Add to cart
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
