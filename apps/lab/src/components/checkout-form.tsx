"use client";

import Link from "next/link";

import { sumCart, useLabState } from "@/components/lab-state";
import { formatPrice } from "@/lib/format";

export function CheckoutForm() {
  const { cart, intake, ready } = useLabState();
  const name = intake.shipping.name.trim();
  const city = intake.shipping.city.trim();

  return (
    <>
      <section aria-labelledby="order-heading">
        <h2 id="order-heading">Order</h2>
        {!ready ? (
          <p>Loading the order saved in this browser.</p>
        ) : cart.length === 0 ? (
          <p>Your cart is empty.</p>
        ) : (
          <ul className="order-list">
            {cart.map((line) => (
              <li key={line.id}>
                <span>
                  {line.name} × {line.quantity}
                </span>
                <span>{formatPrice(line.priceCents * line.quantity)}</span>
              </li>
            ))}
          </ul>
        )}
        {ready ? <p>Total {formatPrice(sumCart(cart))}</p> : null}
        {name !== "" ? (
          <p>{`Ship to ${name}${city !== "" ? `, ${city}` : ""}`}</p>
        ) : (
          <p>Shipping details stay in this browser.</p>
        )}
      </section>
      <p className="hint">
        Synthetic checkout. Do not enter a real card number. This form is
        declined locally, and the card fields are not stored or logged.
      </p>
      <form method="post" action="/api/checkout" autoComplete="off">
        <label className="stack-label">
          Name on card
          <input
            name="lab_card_name"
            autoComplete="off"
            required
            maxLength={80}
          />
        </label>
        <label className="stack-label">
          Card number
          <input
            name="lab_card_number"
            inputMode="numeric"
            autoComplete="off"
            required
            maxLength={19}
            placeholder="0000 0000 0000 0000"
          />
        </label>
        <label className="stack-label">
          Expiry
          <input
            name="lab_card_expiry"
            autoComplete="off"
            required
            maxLength={5}
            placeholder="MM/YY"
          />
        </label>
        <label className="stack-label">
          Security code
          <input
            name="lab_card_cvc"
            autoComplete="off"
            required
            maxLength={4}
          />
        </label>
        <div className="actions">
          <button type="submit" className="btn">
            Place order
          </button>
          <Link href="/intake" className="btn btn-ghost">
            Back to the questionnaire
          </Link>
        </div>
      </form>
    </>
  );
}
