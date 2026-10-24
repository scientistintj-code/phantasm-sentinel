import { CheckoutForm } from "@/components/checkout-form";
import { getCurrentStorefront, paymentWidgetPayload } from "@/lib/storefronts";

export default function CheckoutPage() {
  const store = getCurrentStorefront();
  return (
    <>
      <h1>Checkout</h1>
      <script
        id="lab-payment-widget"
        type="application/json"
        dangerouslySetInnerHTML={{
          __html: paymentWidgetPayload(store.payment),
        }}
      />
      <CheckoutForm />
    </>
  );
}
