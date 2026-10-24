"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

import {
  sumCart,
  useLabState,
  type ShippingDraft,
} from "@/components/lab-state";
import { formatPrice } from "@/lib/format";
import type { Question } from "@/lib/storefronts";

const shippingFields = [
  ["name", "Full name", "name"],
  ["line1", "Street address", "address-line1"],
  ["city", "City", "address-level2"],
  ["region", "Region", "address-level1"],
  ["postal", "Postal code", "postal-code"],
] as const;

const stepLabels = ["Questionnaire", "Shipping", "Review"] as const;

export function IntakeWizard({
  questions,
}: {
  questions: readonly Question[];
}) {
  const { cart, intake, ready, setAnswer, setShipping } = useLabState();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [error, setError] = useState("");
  const errorId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [step]);

  if (!ready) {
    return (
      <>
        <h1>Before checkout</h1>
        <p>Loading your cart.</p>
      </>
    );
  }

  if (cart.length === 0) {
    return (
      <>
        <h1>Before checkout</h1>
        <p>Your cart is empty.</p>
        <Link href="/" className="btn">
          Back to the catalog
        </Link>
      </>
    );
  }

  function continueStep() {
    if (step === 1) {
      const missing = questions.some((question) => {
        const answer = intake.answers[question.id];
        return answer === undefined || answer.trim() === "";
      });
      if (missing) {
        setError("Answer every question before continuing.");
        return;
      }
      setError("");
      setStep(2);
      return;
    }
    const missing = shippingFields.some(
      ([field]) => intake.shipping[field].trim() === "",
    );
    if (missing) {
      setError("Fill in every shipping field before continuing.");
      return;
    }
    setError("");
    setStep(3);
  }

  const heading =
    step === 1 ? "Questionnaire" : step === 2 ? "Shipping details" : "Review";

  return (
    <>
      <h1>Before checkout</h1>
      <ol className="steps">
        {stepLabels.map((label, index) => {
          const current = step === index + 1;
          return (
            <li
              key={label}
              className={current ? "current" : undefined}
              aria-current={current ? "step" : undefined}
            >
              {index + 1}. {label}
            </li>
          );
        })}
      </ol>
      <h2 ref={headingRef} tabIndex={-1}>
        {heading}
      </h2>
      {error !== "" ? (
        <p id={errorId} className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {step === 1 ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            continueStep();
          }}
          aria-describedby={error !== "" ? errorId : undefined}
        >
          {questions.map((question) => (
            <fieldset key={question.id}>
              <legend>{question.prompt}</legend>
              {question.options.map((option) => {
                const selected = intake.answers[question.id] === option;
                return (
                  <label key={option} className="choice">
                    <input
                      type="radio"
                      name={question.id}
                      value={option}
                      checked={selected}
                      onChange={() => setAnswer(question.id, option)}
                    />
                    {option}
                  </label>
                );
              })}
            </fieldset>
          ))}
          <div className="actions">
            <button type="submit" className="btn">
              Continue
            </button>
          </div>
        </form>
      ) : null}
      {step === 2 ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            continueStep();
          }}
          aria-describedby={error !== "" ? errorId : undefined}
        >
          {shippingFields.map(([field, label, autoComplete]) => (
            <label key={field} className="stack-label">
              {label}
              <input
                type="text"
                value={intake.shipping[field]}
                autoComplete={autoComplete}
                maxLength={200}
                onChange={(event) => {
                  const patch: Partial<ShippingDraft> = {
                    [field]: event.target.value,
                  };
                  setShipping(patch);
                }}
              />
            </label>
          ))}
          <div className="actions">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setError("");
                setStep(1);
              }}
            >
              Back
            </button>
            <button type="submit" className="btn">
              Continue
            </button>
          </div>
        </form>
      ) : null}
      {step === 3 ? (
        <>
          <h3>Answers</h3>
          <ul className="review">
            {questions.map((question) => (
              <li key={question.id}>
                {question.prompt} <strong>{intake.answers[question.id]}</strong>
              </li>
            ))}
          </ul>
          <h3>Shipping</h3>
          <ul className="review">
            {shippingFields.map(([field, label]) => (
              <li key={field}>
                {label} <strong>{intake.shipping[field]}</strong>
              </li>
            ))}
          </ul>
          <h3>Cart</h3>
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
          <p>Total {formatPrice(sumCart(cart))}</p>
          <div className="actions">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setError("");
                setStep(2);
              }}
            >
              Back
            </button>
            <Link href="/checkout" className="btn">
              Continue to checkout
            </Link>
          </div>
        </>
      ) : null}
    </>
  );
}
